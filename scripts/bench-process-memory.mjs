import { readFile as readProcFile, readdir as readProcDirectory } from 'node:fs/promises';
import { join, basename } from 'node:path';

const METRICS = ['rssMB', 'pssMB', 'privateMB', 'swapMB', 'swapPssMB'];
const REQUIRED_FIELDS = ['Rss', 'Pss', 'Private_Clean', 'Private_Dirty', 'Swap', 'SwapPss'];
const MEMORY_FIELDS = new Set([...REQUIRED_FIELDS, 'Private_Hugetlb']);
const kbToMB = value => value * 1024 / 1e6;
const nullMetrics = () => Object.fromEntries(METRICS.map(key => [key, null]));
const zeroMetrics = () => Object.fromEntries(METRICS.map(key => [key, 0]));
const failure = (code, message) => Object.assign(new Error(message), {code});

// startTime is an exact decimal string of clock ticks, not a timestamp or a JS number.
export function parseProcStat(text) {
	const prefix = /^(\d+) \(/.exec(text);
	const end = text.lastIndexOf(')');
	const fields = text.slice(end + 1).trim().split(/\s+/);
	const pid = Number(prefix?.[1]);
	const ppid = Number(fields[1]);
	if (!prefix || end < prefix[0].length || fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) ||
		!Number.isSafeInteger(pid) || pid <= 0 || !/^\d+$/.test(fields[1]) ||
		!Number.isSafeInteger(ppid) || !/^\d+$/.test(fields[19]))
		throw failure('INVALID_STAT', 'Invalid /proc stat pid, ppid, or starttime');
	return {pid, ppid, startTime: fields[19]};
}

export function parseSmapsRollup(text) {
	const values = new Map();
	for (const line of text.split('\n')) {
		const key = /^\s*([^:\s]+)/.exec(line)?.[1];
		if (!MEMORY_FIELDS.has(key))
			continue;
		const match = /^\s*[^:\s]+:\s+(\d+)\s+kB\s*$/.exec(line);
		const value = Number(match?.[1]);
		if (!match || !Number.isSafeInteger(value * 1024) || values.has(key))
			throw failure('INVALID_SMAPS', `Invalid or duplicate smaps_rollup field ${key}`);
		values.set(key, value);
	}
	for (const key of REQUIRED_FIELDS) {
		if (!values.has(key))
			throw failure('INVALID_SMAPS', `Missing smaps_rollup field ${key}`);
	}
	const privateKB = values.get('Private_Clean') + values.get('Private_Dirty') + (values.get('Private_Hugetlb') ?? 0);
	if (!Number.isSafeInteger(privateKB * 1024))
		throw failure('INVALID_SMAPS', 'Invalid smaps_rollup private memory sum');
	return {
		rssMB: kbToMB(values.get('Rss')),
		pssMB: kbToMB(values.get('Pss')),
		privateMB: kbToMB(privateKB),
		swapMB: kbToMB(values.get('Swap')),
		swapPssMB: kbToMB(values.get('SwapPss')),
	};
}

export function classifyProcess(cmdline, isRoot = false) {
	const args = cmdline.split('\0');
	if (!args[0])
		throw failure('INVALID_CMDLINE', 'Empty /proc cmdline');
	if (isRoot)
		return 'browser';
	let type = null;
	for (let i = 1; i < args.length; i++) {
		let value;
		if (args[i] === '--type')
			value = args[++i];
		else if (args[i].startsWith('--type='))
			value = args[i].slice(7);
		else
			continue;
		if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value ?? '') || type !== null && type !== value)
			throw failure('INVALID_CMDLINE', 'Invalid or conflicting process --type arguments');
		type = value;
	}
	if (type !== null)
		return type;
	return ['chrome_crashpad_handler', 'crashpad_handler'].includes(basename(args[0])) ? 'crashpad-handler' : 'other';
}

// PPIDs in /proc/<tgid>/stat also cover children created by non-main threads.
export function discoverProcessTree(stats, rootPid) {
	const byPid = new Map();
	const children = new Map();
	for (const stat of stats) {
		if (byPid.has(stat.pid))
			throw failure('INVALID_STAT', `Duplicate stat for PID ${stat.pid}`);
		byPid.set(stat.pid, stat);
		if (!children.has(stat.ppid))
			children.set(stat.ppid, []);
		children.get(stat.ppid).push(stat);
	}
	if (!byPid.has(rootPid))
		return [];
	const result = [byPid.get(rootPid)];
	const seen = new Set([rootPid]);
	for (let i = 0; i < result.length; i++) {
		for (const child of children.get(result[i].pid) ?? []) {
			if (!seen.has(child.pid)) {
				seen.add(child.pid);
				result.push(child);
			}
		}
	}
	return result;
}

// RSS sums count shared mappings repeatedly; PSS sums retain the kernel's proportional shares.
export function aggregateProcessMemory(processes, complete = true) {
	const unavailable = () => ({complete: false, renderer: nullMetrics(), tree: nullMetrics()});
	if (!complete || processes.length === 0)
		return unavailable();
	const renderer = zeroMetrics();
	const tree = zeroMetrics();
	for (const process of processes) {
		if (typeof process.type !== 'string' || !process.type)
			return unavailable();
		for (const key of METRICS) {
			const value = process[key];
			if (!Number.isFinite(value) || value < 0)
				return unavailable();
			tree[key] += value;
			if (process.type === 'renderer')
				renderer[key] += value;
			if (!Number.isFinite(tree[key]))
				return unavailable();
		}
	}
	return {complete: true, renderer, tree};
}

async function mapBounded(items, fn) {
	const result = new Array(items.length);
	let next = 0;
	await Promise.all(Array.from({length: Math.min(16, items.length)}, async () => {
		while (next < items.length) {
			const i = next++;
			result[i] = await fn(items[i]);
		}
	}));
	return result;
}

const sameIdentity = (a, b) => a.pid === b.pid && a.startTime === b.startTime;
const sameProcess = (a, b) => sameIdentity(a, b) && a.ppid === b.ppid;

// One bounded sample, with no timers, subprocesses, or cross-sample caches.
// Options provide a proc mount and promise-based filesystem hooks for deterministic tests.
// processTypes is a fresh CDP SystemInfo.getProcessInfo PID-to-role Map for this call.
// CDP roles bypass cmdline reads. Unmapped processes use NUL-delimited argv, never space splitting.
// The map has no starttimes: proc guards detect reuse during this sample, not before its first scan.
// complete means all observed checks passed, not an atomic snapshot: processes that live
// entirely between scans cannot be detected. A hidepid mount can also hide whole entries.
export async function readProcessMemory(rootPid, {
	procRoot = '/proc', readFile = readProcFile, readdir = readProcDirectory,
	processTypes, requireRenderer = false,
} = {}) {
	if (!Number.isSafeInteger(rootPid) || rootPid <= 0)
		throw new TypeError('rootPid must be a positive safe integer');
	if (processTypes !== undefined && !(processTypes instanceof Map))
		throw new TypeError('processTypes must be a Map of numeric PIDs to process types');
	if (typeof requireRenderer !== 'boolean')
		throw new TypeError('requireRenderer must be a boolean');
	// Snapshot before the first await so caller mutation cannot change roles during a read.
	const types = new Map(processTypes);
	for (const [pid, type] of types) {
		if (!Number.isSafeInteger(pid) || pid <= 0 || typeof type !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(type))
			throw new TypeError(`processTypes requires positive safe-integer PIDs and nonempty process type tokens: ${JSON.stringify({pid, type})}`);
	}
	const issues = [];
	const record = (pid, stage, error) => issues.push({
		pid, stage, code: error.code ?? 'READ_ERROR', message: error.message ?? String(error),
	});
	const readStat = async pid => {
		const stat = parseProcStat(await readFile(join(procRoot, String(pid), 'stat'), 'utf8'));
		if (stat.pid !== pid)
			throw failure('PID_MISMATCH', `Expected PID ${pid}, read PID ${stat.pid}`);
		return stat;
	};
	const scan = async stage => {
		let entries;
		try {
			entries = await readdir(procRoot);
		}
		catch (error) {
			record(null, stage, error);
			return [];
		}
		const pids = entries.filter(name => /^[1-9]\d*$/.test(name)).map(Number).sort((a, b) => a - b);
		const stats = await mapBounded(pids, async pid => {
			try {
				return await readStat(pid);
			}
			catch (error) {
				// An unreadable stat could belong to an undiscovered descendant. Do not skip silently.
				record(pid, stage, error);
				return null;
			}
		});
		return discoverProcessTree(stats.filter(stat => stat !== null), rootPid);
	};

	const before = await scan('discover');
	if (before.length === 0) {
		record(rootPid, 'discover', failure('ROOT_MISSING', 'Root process is absent or unreadable'));
		return {...aggregateProcessMemory([], false), processes: [], issues};
	}
	const processes = await mapBounded(before, async expected => {
		const {pid} = expected;
		const result = {...expected, type: null, typeSource: null, ...nullMetrics()};
		try {
			if (!sameProcess(expected, await readStat(pid)))
				throw failure('PROCESS_CHANGED', 'Process identity or parent changed before memory read');
		}
		catch (error) {
			record(pid, 'before-read', error);
			return result;
		}
		const mapped = types.has(pid);
		if (mapped) {
			result.type = types.get(pid);
			result.typeSource = 'cdp';
		}
		await Promise.all((mapped ? ['smaps_rollup'] : ['cmdline', 'smaps_rollup']).map(async file => {
			try {
				const text = await readFile(join(procRoot, String(pid), file), 'utf8');
				if (file === 'cmdline') {
					result.type = classifyProcess(text, pid === rootPid);
					result.typeSource = 'cmdline';
				}
				else
					Object.assign(result, parseSmapsRollup(text));
			}
			catch (error) {
				record(pid, file, error);
			}
		}));
		try {
			if (!sameProcess(expected, await readStat(pid)))
				throw failure('PROCESS_CHANGED', 'Process identity or parent changed during memory read');
		}
		catch (error) {
			record(pid, 'after-read', error);
			// Neither the classification nor the memory can be attributed to this identity.
			Object.assign(result, {type: null, typeSource: null}, nullMetrics());
		}
		return result;
	});

	const after = await scan('verify-tree');
	const afterByPid = new Map(after.map(stat => [stat.pid, stat]));
	const beforeByPid = new Map(before.map(stat => [stat.pid, stat]));
	for (const process of processes) {
		const current = afterByPid.get(process.pid);
		if (!current || !sameProcess(process, current)) {
			record(process.pid, 'verify-tree', failure('PROCESS_CHANGED', 'Process exited, changed identity, or left the tree'));
			Object.assign(process, {type: null, typeSource: null}, nullMetrics());
		}
	}
	for (const current of after) {
		const previous = beforeByPid.get(current.pid);
		if (!previous || !sameIdentity(previous, current)) {
			record(current.pid, 'verify-tree', failure('PROCESS_ADDED', 'New process identity appeared during the sample'));
			processes.push({...current, type: null, typeSource: null, ...nullMetrics()});
		}
	}
	if (requireRenderer && !processes.some(process => process.type === 'renderer'))
		record(rootPid, 'classify', failure('NO_RENDERER', 'No renderer identified in the process tree'));
	const aggregate = aggregateProcessMemory(processes, issues.length === 0);
	if (!aggregate.complete && issues.length === 0)
		record(null, 'aggregate', failure('INVALID_METRICS', 'Cannot aggregate unavailable or invalid process memory'));
	return {...aggregate, processes, issues};
}
