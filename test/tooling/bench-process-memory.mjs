import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseProcStat, parseSmapsRollup, classifyProcess, discoverProcessTree,
	aggregateProcessMemory, readProcessMemory,
} from '../../scripts/bench-process-memory.mjs';

const METRICS = ['rssMB', 'pssMB', 'privateMB', 'swapMB', 'swapPssMB'];
const emptyMetrics = Object.fromEntries(METRICS.map(key => [key, null]));
const memory = {Rss: 1000, Pss: 600, Private_Clean: 100, Private_Dirty: 200, Swap: 40, SwapPss: 20};
const metrics = {rssMB: 1.024, pssMB: 0.6144, privateMB: 0.3072, swapMB: 0.04096, swapPssMB: 0.02048};

function stat(pid, ppid = 1, startTime = String(pid * 100), comm = 'chrome') {
	// Field 3 is state; field 22 is starttime. Later fields must not affect parsing.
	return `${pid} (${comm}) S ${ppid} ${Array(17).fill('0').join(' ')} ${startTime} 123 456\n`;
}

function smaps(fields = memory) {
	return '1000-2000 ---p 00000000 00:00 0 [rollup]\n' +
		Object.entries(fields).map(([key, value]) => `${key}: ${value} kB\n`).join('');
}

function fixture() {
	const files = new Map();
	const reads = new Map();
	const fake = {
		files, reads, scans: 0,
		add(pid, ppid, type = '', startTime = String(pid * 100)) {
			files.set(`${pid}/stat`, stat(pid, ppid, startTime));
			files.set(`${pid}/cmdline`, `/opt/chrome\0${type ? `--type=${type}\0` : ''}`);
			files.set(`${pid}/smaps_rollup`, smaps());
		},
		remove(pid) {
			for (const key of files.keys()) {
				if (key.startsWith(`${pid}/`))
					files.delete(key);
			}
		},
		onRead: null,
		onScan: null,
	};
	fake.options = {
		procRoot: '/fixture-proc',
		async readdir(path) {
			assert.equal(path, '/fixture-proc');
			fake.scans++;
			await fake.onScan?.(fake.scans);
			return [...new Set([...files.keys()].map(key => key.split('/')[0])), 'self', 'thread-self', 'sys', 'meminfo'];
		},
		async readFile(path, encoding) {
			assert.equal(encoding, 'utf8');
			assert.ok(path.startsWith('/fixture-proc/'));
			const key = path.slice('/fixture-proc/'.length);
			const count = (reads.get(key) ?? 0) + 1;
			reads.set(key, count);
			await fake.onRead?.(key, count);
			if (!files.has(key))
				throw Object.assign(new Error(`No such file: ${path}`), {code: 'ENOENT'});
			const value = files.get(key);
			if (value instanceof Error)
				throw value;
			return value;
		},
	};
	fake.add(10, 1);
	fake.add(20, 10, 'renderer');
	fake.read = () => readProcessMemory(10, fake.options);
	return fake;
}

function assertIncomplete(result, code, pid) {
	assert.equal(result.complete, false);
	assert.deepEqual(result.renderer, emptyMetrics);
	assert.deepEqual(result.tree, emptyMetrics);
	assert.ok(result.issues.some(issue => issue.code === code && (pid === undefined || issue.pid === pid)), JSON.stringify(result.issues));
	for (const issue of result.issues) {
		assert.equal(typeof issue.stage, 'string');
		assert.equal(typeof issue.message, 'string');
	}
}

function assertUnavailable(process) {
	for (const key of METRICS)
		assert.equal(process[key], null, key);
}

describe('process memory parsers', () => {
	it('parses stat names with spaces, parentheses, and newlines, preserving exact starttime', () => {
		assert.deepEqual(parseProcStat(stat(20, 10, '18446744073709551615', 'a ) b (c)\nd')), {
			pid: 20, ppid: 10, startTime: '18446744073709551615',
		});
		assert.equal(parseProcStat(stat(1, 0, '0')).ppid, 0);
	});

	it('rejects truncated or malformed identity fields', () => {
		for (const text of ['', '20 (chrome) S 10', stat(0), stat(20, -1), stat(20, 'no'),
			stat(20, 10, '-1'), stat(20, 10, '1.5'), stat(20, 10, 'NaN'),
			stat('9007199254740992'), stat(20, '9007199254740992'), stat(20).replace(' S ', ' SS '),
			stat(20).replace('(', '')])
			assert.throws(() => parseProcStat(text), {code: 'INVALID_STAT'});
	});

	it('converts kernel kB (1024 bytes) into decimal MB and sums private components', () => {
		assert.deepEqual(parseSmapsRollup(smaps()), metrics);
		const result = parseSmapsRollup(smaps({...memory, Rss: 1024, Private_Hugetlb: 50, Shared_Hugetlb: 900, Pss_Anon: 500}));
		assert.equal(result.rssMB, 1.048576);
		assert.equal(result.privateMB, 0.3584);
		assert.equal(result.pssMB, metrics.pssMB, 'do not add Pss_Anon to Pss');
	});

	it('accepts actual zero values and optional absent Private_Hugetlb', () => {
		assert.deepEqual(parseSmapsRollup(smaps(Object.fromEntries(Object.keys(memory).map(key => [key, 0])))),
			Object.fromEntries(METRICS.map(key => [key, 0])));
	});

	it('requires every mandatory smaps_rollup field instead of substituting zero', () => {
		for (const key of Object.keys(memory)) {
			const fields = {...memory};
			delete fields[key];
			assert.throws(() => parseSmapsRollup(smaps(fields)), new RegExp(`Missing.*${key}`));
		}
		assert.throws(() => parseSmapsRollup(''), /Missing.*Rss/);
	});

	it('rejects malformed values, units, duplicates, and overflow, including optional fields', () => {
		for (const key of [...Object.keys(memory), 'Private_Hugetlb']) {
			for (const value of ['-1', '+1', '1.5', 'NaN', 'Infinity', '1e3', '', '9007199254740992'])
				assert.throws(() => parseSmapsRollup(smaps({...memory, [key]: value})), {code: 'INVALID_SMAPS'});
			for (const line of [`${key}: 1 MB`, `${key}: 1`, `${key} 1 kB`, `${key}: 1 kB trailing`])
				assert.throws(() => parseSmapsRollup(smaps() + line), {code: 'INVALID_SMAPS'});
			assert.throws(() => parseSmapsRollup(smaps({...memory, [key]: 1}) + `${key}: 2 kB`), /duplicate/);
		}
		assert.throws(() => parseSmapsRollup(smaps({...memory, Private_Clean: 5e12, Private_Dirty: 5e12})), /private memory sum/);
	});

	it('classifies root, exact renderer switches, Chromium helpers, and untyped processes', () => {
		assert.equal(classifyProcess('/chrome\0', true), 'browser');
		assert.equal(classifyProcess('/chrome\0--type=renderer\0', true), 'browser');
		for (const type of ['renderer', 'utility', 'zygote', 'gpu-process', 'broker']) {
			assert.equal(classifyProcess(`/chrome\0--type=${type}\0`), type);
			assert.equal(classifyProcess(`/chrome\0--type\0${type}\0`), type);
		}
		assert.equal(classifyProcess('/opt/chrome_crashpad_handler\0--monitor-self\0'), 'crashpad-handler');
		for (const args of ['/chrome\0', '/chrome\0--type=renderer-helper\0',
			'/chrome\0--title=--type=renderer\0', '/chrome\0prefix--type=renderer\0',
			'/chrome\0--type=utility\0--url=https://example/--type=renderer\0', '--type=renderer\0',
						'/opt/chrome --type=renderer --lang=en-US\0\0', '/opt/chrome --type=renderer'])
			assert.notEqual(classifyProcess(args), 'renderer');
	});

	it('rejects unreadable-equivalent or ambiguous command lines', () => {
		for (const args of ['', '\0', '/chrome\0--type=\0', '/chrome\0--type\0',
			'/chrome\0--type=renderer\0--type=utility\0'])
			assert.throws(() => classifyProcess(args), {code: 'INVALID_CMDLINE'});
	});
});

describe('process tree discovery and aggregation', () => {
	it('includes root and every descendant independent of enumeration order or children files', () => {
		const stats = [stat(50, 40), stat(40, 20), stat(90, 1), stat(20, 10), stat(30, 10), stat(10, 1)].map(parseProcStat);
		assert.deepEqual(discoverProcessTree(stats, 10).map(p => p.pid), [10, 20, 30, 40, 50]);
		assert.deepEqual(discoverProcessTree(stats, 999), []);
		assert.deepEqual(discoverProcessTree([parseProcStat(stat(10, 10))], 10).map(p => p.pid), [10]);
		assert.throws(() => discoverProcessTree([stats[0], stats[0]], 10), /Duplicate/);
	});

	it('sums shared RSS separately from proportional PSS and selects only renderers', () => {
		const processes = [
			{pid: 10, type: 'browser', ...metrics},
			{pid: 20, type: 'renderer', ...metrics, rssMB: 8, pssMB: 4},
			{pid: 30, type: 'renderer', ...metrics, rssMB: 8, pssMB: 4},
			{pid: 40, type: 'gpu-process', ...metrics, rssMB: 2, pssMB: 1},
		];
		const original = structuredClone(processes);
		const result = aggregateProcessMemory(processes);
		assert.equal(result.complete, true);
		assert.equal(result.renderer.rssMB, 16);
		assert.equal(result.renderer.pssMB, 8);
		assert.equal(result.tree.rssMB, 19.024);
		assert.equal(result.tree.pssMB, 9.6144);
		assert.equal(result.renderer.privateMB, metrics.privateMB * 2);
		assert.equal(result.tree.swapMB, metrics.swapMB * 4);
		assert.equal(result.renderer.swapPssMB, metrics.swapPssMB * 2);
		assert.deepEqual(Object.keys(result.tree), METRICS, 'no GPU-specific metrics');
		assert.deepEqual(processes, original);
	});

	it('returns zero renderer totals only for a complete tree with no renderers', () => {
		const result = aggregateProcessMemory([{type: 'browser', ...metrics}]);
		assert.equal(result.complete, true);
		assert.deepEqual(result.renderer, Object.fromEntries(METRICS.map(key => [key, 0])));
		assert.deepEqual(result.tree, metrics);
	});

	it('invalidates both whole tuples on incomplete, absent, invalid, or overflowing data', () => {
		const cases = [aggregateProcessMemory([], true), aggregateProcessMemory([{type: 'renderer', ...metrics}], false),
			aggregateProcessMemory([{type: null, ...metrics}]),
			aggregateProcessMemory([{type: 'browser', ...metrics, rssMB: Number.MAX_VALUE}, {type: 'renderer', ...metrics, rssMB: Number.MAX_VALUE}])];
		for (const key of METRICS) {
			for (const value of [undefined, null, NaN, Infinity, -1, '0', false])
				cases.push(aggregateProcessMemory([{type: 'renderer', ...metrics}, {type: 'browser', ...metrics, [key]: value}]));
		}
		for (const result of cases) {
			assert.equal(result.complete, false);
			assert.deepEqual(result.renderer, emptyMetrics);
			assert.deepEqual(result.tree, emptyMetrics);
		}
	});
});

describe('readProcessMemory', () => {
	it('accepts dotted service roles returned by Chrome SystemInfo.getProcessInfo', async () => {
		const fake = fixture();
		fake.add(30, 10, 'utility');
		const result = await readProcessMemory(10, {...fake.options,
			processTypes: new Map([[10, 'browser'], [20, 'renderer'], [30, 'network.mojom.NetworkService']]),
			requireRenderer: true,
		});
		assert.equal(result.complete, true);
		assert.equal(result.processes.find(process => process.pid === 30).type, 'network.mojom.NetworkService');
		assert.equal(result.renderer.pssMB, metrics.pssMB);
		assert.equal(result.tree.pssMB, metrics.pssMB * 3);
	});
	it('reads a stable tree, excludes unrelated processes, and uses no main-thread children list', async () => {
		const fake = fixture();
		fake.add(30, 10, 'zygote');
		fake.add(40, 30, 'renderer');
		fake.add(50, 40, 'utility');
		fake.add(60, 10, 'gpu-process');
		fake.add(90, 1, 'renderer');
		fake.files.set('10/task/10/children', '');
		const result = await fake.read();
		assert.equal(result.complete, true);
		assert.deepEqual(result.issues, []);
		assert.deepEqual(result.processes.map(p => p.pid), [10, 20, 30, 60, 40, 50]);
		assert.deepEqual(result.processes[0], {pid: 10, ppid: 1, startTime: '1000', type: 'browser', typeSource: 'cmdline', ...metrics});
		assert.equal(result.renderer.rssMB, metrics.rssMB * 2);
		assert.equal(result.tree.rssMB, metrics.rssMB * 6);
		assert.equal(fake.scans, 2);
		for (const process of result.processes) {
			assert.equal(fake.reads.get(`${process.pid}/stat`), 4, 'two scans plus before/after identity checks');
			assert.equal(fake.reads.get(`${process.pid}/smaps_rollup`), 1);
			assert.equal(fake.reads.get(`${process.pid}/cmdline`), 1);
		}
		assert.equal(fake.reads.get('90/stat'), 2);
		assert.equal(fake.reads.has('90/smaps_rollup'), false);
		assert.equal(fake.reads.has('90/cmdline'), false);
		assert.ok([...fake.reads.keys()].every(key => !key.includes('children')));
	});

	it('uses CDP types for rewritten cmdlines and overrides conflicting argv roles', async () => {
		const fake = fixture();
		fake.files.set('20/cmdline', '/opt/chrome --type=renderer --lang=en-US\0\0');
		fake.add(30, 10, 'renderer');
		fake.add(40, 30, 'utility');
		fake.add(50, 10);
		fake.add(90, 1, 'renderer');
		fake.options.processTypes = new Map([[10, 'browser'], [20, 'renderer'], [30, 'GPU'], [90, 'renderer']]);
		fake.options.requireRenderer = true;
		const result = await fake.read();
		assert.equal(result.complete, true);
		assert.deepEqual(result.issues, []);
		assert.deepEqual(result.processes.map(({pid, type, typeSource}) => ({pid, type, typeSource})), [
			{pid: 10, type: 'browser', typeSource: 'cdp'},
			{pid: 20, type: 'renderer', typeSource: 'cdp'},
			{pid: 30, type: 'GPU', typeSource: 'cdp'},
			{pid: 50, type: 'other', typeSource: 'cmdline'},
			{pid: 40, type: 'utility', typeSource: 'cmdline'},
		]);
		assert.deepEqual(result.renderer, metrics);
		assert.equal(result.tree.rssMB, metrics.rssMB * 5);
		for (const pid of [10, 20, 30]) {
			assert.equal(fake.reads.has(`${pid}/cmdline`), false);
			assert.equal(fake.reads.get(`${pid}/stat`), 4);
		}
		assert.equal(fake.reads.get('40/cmdline'), 1);
		assert.equal(fake.reads.has('90/smaps_rollup'), false, 'a map entry cannot add an unrelated process');
	});

	it('does not require readable cmdlines for mapped processes', async () => {
		const fake = fixture();
		fake.options.processTypes = new Map([[10, 'browser'], [20, 'renderer']]);
		fake.options.requireRenderer = true;
		fake.files.delete('10/cmdline');
		fake.files.set('20/cmdline', Object.assign(new Error('Permission denied'), {code: 'EACCES'}));
		const result = await fake.read();
		assert.equal(result.complete, true);
		assert.deepEqual(result.renderer, metrics);
		assert.ok([...fake.reads.keys()].every(key => !key.endsWith('/cmdline')));
	});

	it('requires a renderer only when requested and never infers one by splitting spaces', async () => {
		const fake = fixture();
		fake.files.set('20/cmdline', '/opt/chrome --type=renderer --lang=en-US\0\0');
		let result = await fake.read();
		assert.equal(result.complete, true);
		assert.deepEqual(result.renderer, Object.fromEntries(METRICS.map(key => [key, 0])));
		assert.equal(result.processes.find(p => p.pid === 20).type, 'other');
		fake.options.requireRenderer = true;
		fake.options.processTypes = new Map([[90, 'renderer']]);
		result = await fake.read();
		assertIncomplete(result, 'NO_RENDERER', 10);
		assert.equal(result.processes.find(p => p.pid === 20).rssMB, metrics.rssMB);
		fake.options.processTypes.set(20, 'renderer');
		result = await fake.read();
		assert.equal(result.complete, true);
		assert.deepEqual(result.renderer, metrics);
	});

	it('accepts a fallback renderer but fails closed when CDP overrides it with another role', async () => {
		const fake = fixture();
		fake.options.requireRenderer = true;
		fake.options.processTypes = new Map();
		let result = await fake.read();
		assert.equal(result.complete, true);
		assert.equal(result.processes.find(p => p.pid === 20).typeSource, 'cmdline');
		fake.options.processTypes.set(20, 'utility');
		result = await fake.read();
		assertIncomplete(result, 'NO_RENDERER', 10);
		assert.equal(result.processes.find(p => p.pid === 20).typeSource, 'cdp');
	});

	it('snapshots the supplied map per call and does not cache CDP roles between samples', async () => {
		const fake = fixture();
		const processTypes = new Map([[20, 'renderer']]);
		fake.options.processTypes = processTypes;
		fake.onScan = count => { if (count === 1) processTypes.set(20, 'utility'); };
		const first = await fake.read();
		assert.equal(first.processes.find(p => p.pid === 20).type, 'renderer');
		assert.equal(processTypes.get(20), 'utility', 'the caller map is not modified by the reader');
		const second = await fake.read();
		assert.equal(second.processes.find(p => p.pid === 20).type, 'utility');
		assert.equal(second.renderer.rssMB, 0);
	});

	it('rejects invalid maps and renderer requirements before filesystem access', async () => {
		const fake = fixture();
		const invalidMaps = [null, {}, [], [[20, 'renderer']], 'renderer'];
		for (const pid of [0, -1, 1.5, NaN, Infinity, '20', null, undefined, Number.MAX_SAFE_INTEGER + 1])
			invalidMaps.push(new Map([[pid, 'renderer']]));
		for (const type of ['', ' ', 'renderer ', 'render er', '--type=renderer', null, undefined, 1, true, {}, []])
			invalidMaps.push(new Map([[20, type]]));
		for (const processTypes of invalidMaps)
			await assert.rejects(readProcessMemory(10, {...fake.options, processTypes}), /processTypes/);
		for (const requireRenderer of [null, 0, 1, 'true', 'false'])
			await assert.rejects(readProcessMemory(10, {...fake.options, requireRenderer}), /requireRenderer/);
		assert.equal(fake.scans, 0);
		assert.equal(fake.reads.size, 0);
	});

	it('retains PID reuse guards and clears CDP attribution at every identity check', async () => {
		for (const pid of [10, 20]) {
			for (const readNumber of [2, 3, 4]) {
				const fake = fixture();
				fake.options.processTypes = new Map([[10, 'browser'], [20, 'renderer']]);
				fake.options.requireRenderer = true;
				fake.onRead = (key, count) => {
					if (key === `${pid}/stat` && count === readNumber)
						fake.files.set(key, stat(pid, pid === 10 ? 1 : 10, '99999'));
				};
				const result = await fake.read();
				assertIncomplete(result, 'PROCESS_CHANGED', pid);
				for (const process of result.processes.filter(p => p.pid === pid)) {
					assert.equal(process.type, null);
					assert.equal(process.typeSource, null);
					assertUnavailable(process);
				}
				if (pid === 20)
					assertIncomplete(result, 'NO_RENDERER', 10);
				if (readNumber === 2)
					assert.equal(fake.reads.has(`${pid}/smaps_rollup`), false);
			}
		}
	});

	it('keeps CDP attribution from masking memory read failures', async () => {
		const fake = fixture();
		fake.options.processTypes = new Map([[20, 'renderer']]);
		fake.options.requireRenderer = true;
		fake.files.set('20/smaps_rollup', Object.assign(new Error('Permission denied'), {code: 'EACCES'}));
		const result = await fake.read();
		assertIncomplete(result, 'EACCES', 20);
		const renderer = result.processes.find(p => p.pid === 20);
		assert.equal(renderer.type, 'renderer');
		assert.equal(renderer.typeSource, 'cdp');
		assertUnavailable(renderer);
	});

	it('supports an actual alternate proc directory using the default filesystem readers', async () => {
		const procRoot = await mkdtemp(join(tmpdir(), 'uplot-process-memory-'));
		try {
			await mkdir(join(procRoot, '10'));
			await Promise.all([
				writeFile(join(procRoot, '10/stat'), stat(10)),
				writeFile(join(procRoot, '10/cmdline'), '/chrome\0'),
				writeFile(join(procRoot, '10/smaps_rollup'), smaps()),
			]);
			const result = await readProcessMemory(10, {procRoot});
			assert.equal(result.complete, true);
			assert.deepEqual(result.tree, metrics);
			assert.equal(result.renderer.rssMB, 0);
		}
		finally {
			await rm(procRoot, {recursive: true, force: true});
		}
	});

	it('fails closed on a missing root or unavailable proc mount', async () => {
		const fake = fixture();
		fake.remove(10);
		const missing = await fake.read();
		assertIncomplete(missing, 'ROOT_MISSING', 10);
		assert.deepEqual(missing.processes, []);
		fake.options.readdir = async () => { throw Object.assign(new Error('Permission denied'), {code: 'EACCES'}); };
		assertIncomplete(await fake.read(), 'EACCES');
	});

	for (const file of ['stat', 'cmdline', 'smaps_rollup']) {
		for (const code of ['ENOENT', 'EACCES', 'EPERM']) {
			it(`fails closed on ${code} reading ${file}`, async () => {
				const fake = fixture();
				fake.files.set(`20/${file}`, Object.assign(new Error(`${file} unavailable`), {code}));
				const result = await fake.read();
				assertIncomplete(result, code, 20);
				assert.deepEqual(result.processes.find(p => p.pid === 10), {pid: 10, ppid: 1, startTime: '1000', type: 'browser', typeSource: 'cmdline', ...metrics});
				if (file === 'smaps_rollup')
					assertUnavailable(result.processes.find(p => p.pid === 20));
			}
		);
		}
	}

	it('keeps parse diagnostics and does not fall back to stat RSS or status', async () => {
		const fake = fixture();
		fake.files.set('20/smaps_rollup', smaps({...memory, SwapPss: 'invalid'}));
		fake.files.set('20/status', 'VmRSS: 1000 kB\n');
		const result = await fake.read();
		assertIncomplete(result, 'INVALID_SMAPS', 20);
		assert.match(result.issues.find(issue => issue.code === 'INVALID_SMAPS').message, /SwapPss/);
		assertUnavailable(result.processes.find(p => p.pid === 20));
		assert.equal(fake.reads.has('20/status'), false);
	});

	it('fails closed on an empty cmdline rather than assuming a non-renderer', async () => {
		const fake = fixture();
		fake.files.set('20/cmdline', '');
		const result = await fake.read();
		assertIncomplete(result, 'INVALID_CMDLINE', 20);
		assert.equal(result.processes.find(p => p.pid === 20).type, null);
	});

	it('recovers on a fresh read after a process exits between directory listing and stat', async () => {
		for (const ppid of [1, 10]) {
			const fake = fixture();
			fake.add(30, ppid);
			fake.onRead = key => {
				if (key === '30/stat') fake.remove(30);
			};
			const first = await fake.read();
			assertIncomplete(first, 'ENOENT', 30);
			assert.equal(first.issues[0].stage, 'discover');
			const second = await fake.read();
			assert.equal(second.complete, true);
			assert.deepEqual(second.issues, []);
			assert.deepEqual(second.processes.map(process => process.pid), [10, 20]);
		}
	});

	it('fails closed if an unreadable stat could conceal an undiscovered descendant', async () => {
		const fake = fixture();
		fake.add(90, 1);
		fake.files.set('90/stat', Object.assign(new Error('Hidden identity'), {code: 'EACCES'}));
		assertIncomplete(await fake.read(), 'EACCES', 90);
	});

	it('rejects a stat whose PID does not match its directory', async () => {
		const fake = fixture();
		fake.files.set('20/stat', stat(21, 10));
		assertIncomplete(await fake.read(), 'PID_MISMATCH', 20);
	});

	for (const pid of [10, 20]) {
		for (const readNumber of [2, 3, 4]) {
			it(`detects PID ${pid} reuse on stat read ${readNumber}, without mixing identities`, async () => {
				const fake = fixture();
				fake.onRead = (key, count) => {
					if (key === `${pid}/stat` && count === readNumber)
						fake.files.set(key, stat(pid, pid === 10 ? 1 : 10, '99999'));
				};
				const result = await fake.read();
				assertIncomplete(result, 'PROCESS_CHANGED', pid);
				const original = result.processes.find(p => p.pid === pid && p.startTime === String(pid * 100));
				assertUnavailable(original);
				assert.equal(original.type, null);
				assertUnavailable(result.processes.find(p => p.pid === pid && p.startTime === '99999'));
				if (readNumber === 2)
					assert.equal(fake.reads.has(`${pid}/smaps_rollup`), false);
			});
		}
	}

	for (const readNumber of [2, 3, 4]) {
		it(`detects exit on stat read ${readNumber}`, async () => {
			const fake = fixture();
			fake.onRead = (key, count) => {
				if (key === '20/stat' && count === readNumber)
					fake.remove(20);
			};
			const result = await fake.read();
			assertIncomplete(result, 'ENOENT', 20);
			assertUnavailable(result.processes.find(p => p.pid === 20));
		});
	}

	it('detects a new descendant in the final scan and retains its unread identity', async () => {
		const fake = fixture();
		fake.onScan = count => { if (count === 2) fake.add(30, 20, 'renderer'); };
		const result = await fake.read();
		assertIncomplete(result, 'PROCESS_ADDED', 30);
		assert.deepEqual(result.processes.find(p => p.pid === 30), {pid: 30, ppid: 20, startTime: '3000', type: null, typeSource: null, ...emptyMetrics});
		assert.equal(fake.reads.has('30/smaps_rollup'), false, 'do not retry or chase a moving tree');
	});

	it('detects reparenting both out of and within the tree', async () => {
		for (const newParent of [1, 30]) {
			const fake = fixture();
			fake.add(30, 10, 'zygote');
			fake.onScan = count => { if (count === 2) fake.files.set('20/stat', stat(20, newParent)); };
			const result = await fake.read();
			assertIncomplete(result, 'PROCESS_CHANGED', 20);
			assertUnavailable(result.processes.find(p => p.pid === 20));
		}
	});

	it('invalidates the sample if the final directory scan fails', async () => {
		const fake = fixture();
		fake.onScan = count => { if (count === 2) throw Object.assign(new Error('Proc disappeared'), {code: 'EIO'}); };
		assertIncomplete(await fake.read(), 'EIO');
	});

	it('does not cache identities or memory between serial samples', async () => {
		const fake = fixture();
		assert.equal((await fake.read()).renderer.rssMB, 1.024);
		fake.files.set('20/stat', stat(20, 10, '99999'));
		fake.files.set('20/smaps_rollup', smaps({...memory, Rss: 2000}));
		const result = await fake.read();
		assert.equal(result.complete, true);
		assert.equal(result.renderer.rssMB, 2.048);
		assert.equal(result.processes.find(p => p.pid === 20).startTime, '99999');
	});

	it('rejects invalid caller PIDs before filesystem access', async () => {
		const fake = fixture();
		for (const pid of [0, -1, 1.5, NaN, Infinity, '10', null, undefined, Number.MAX_SAFE_INTEGER + 1])
			await assert.rejects(readProcessMemory(pid, fake.options), /rootPid/);
		assert.equal(fake.scans, 0);
	});
});
