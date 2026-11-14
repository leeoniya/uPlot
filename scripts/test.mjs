import { spawn, spawnSync } from 'node:child_process';
import { globSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getInstrumentCacheNamespace } from './instrument-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hooks = fileURLToPath(new URL('./register-hooks.mjs', import.meta.url));
const coverageReporter = fileURLToPath(new URL('./report-coverage.mjs', import.meta.url));

export function testCommand(args, { bun = !!process.versions.bun, cwd = process.cwd() } = {}) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			'no-coverage': { type: 'boolean' },
			workers: { type: 'string', default: '1' },
			'test-name-pattern': { type: 'string' },
			grep: { type: 'string', short: 'g' },
			reporter: { type: 'string', short: 'R' },
			'test-reporter': { type: 'string' },
		},
	});

	const workers = Number(values.workers);
	if (!/^[1-9]\d*$/.test(values.workers) || !Number.isSafeInteger(workers))
		throw new Error('--workers must be a positive safe integer.');

	if (positionals.length === 0)
		throw new Error('Specify at least one test file or glob.');

	const files = new Set();
	for (const pattern of positionals) {
		const matches = globSync(pattern, { cwd }).sort();
		if (matches.length === 0)
			throw new Error('No test files match: ' + pattern);
		for (const file of matches)
			files.add(resolve(cwd, file));
	}

	const reporter = values.reporter ?? values['test-reporter'] ?? 'spec';
	if (!['spec', 'dot', 'dots'].includes(reporter))
		throw new Error('Unsupported reporter: ' + reporter + '. Use spec or dot.');

	// Each process retains its DOM, module cache, and recorder across test files.
	const command = bun ? ['test', '--timeout=2000'] : ['--test', '--test-isolation=none', '--test-timeout=2000'];
	if (bun) {
		if (reporter !== 'spec')
			command.push('--reporter=dots');
	}
	else
		command.push('--test-reporter=' + (reporter === 'dots' ? 'dot' : reporter));

	const pattern = values['test-name-pattern'] ?? values.grep;
	if (pattern != null)
		command.push('--test-name-pattern', pattern);

	return { args: [...command, ...files], coverage: !values['no-coverage'], workers, files: [...files] };
}

export function splitTestFiles(files, workers, weight = file => statSync(file).size) {
	if (files.length === 0)
		return [];
	if (workers === 1)
		return [[...files]];

	const groups = Array.from({ length: Math.min(workers, files.length) }, () => ({ weight: 0, files: [] }));
	const entries = files.map((file, index) => ({ file, index, weight: weight(file) }));
	entries.sort((a, b) => b.weight - a.weight || a.index - b.index);
	for (const entry of entries) {
		const group = groups.reduce((best, next) => next.weight < best.weight ||
			next.weight === best.weight && next.files.length < best.files.length ? next : best);
		group.files.push(entry);
		group.weight += entry.weight;
	}
	return groups.map(group => group.files.sort((a, b) => a.index - b.index).map(entry => entry.file));
}

async function runTests(commands, env) {
	const children = new Set();
	const groups = new Set();
	const grouped = process.platform !== 'win32';
	let interrupted = 0;
	let shutdown;
	const kill = signal => {
		for (const target of grouped ? groups : children) {
			try {
				if (grouped)
					process.kill(-target, signal);
				else
					target.kill(signal);
			}
			catch (error) {
				if (error.code !== 'ESRCH')
					console.error(error);
			}
		}
	};
	const stop = signal => {
		interrupted ||= signal === 'SIGINT' ? 130 : 143;
		kill(signal);
		// A worker can exit before its descendants. Retain its group until escalation.
		shutdown ??= new Promise(resolveShutdown => setTimeout(() => {
			kill('SIGKILL');
			resolveShutdown();
		}, 2000));
	};
	const onInterrupt = () => stop('SIGINT');
	const onTerminate = () => stop('SIGTERM');
	process.on('SIGINT', onInterrupt);
	process.on('SIGTERM', onTerminate);
	try {
		const statuses = await Promise.all(commands.map(args => new Promise(resolveStatus => {
			let child;
			try {
				child = spawn(process.execPath, args, { env, stdio: 'inherit', detached: grouped });
			}
			catch (error) {
				console.error(error);
				resolveStatus(1);
				return;
			}
			children.add(child);
			if (child.pid != null)
				groups.add(child.pid);
			child.once('error', error => console.error(error));
			child.once('close', (status, signal) => {
				children.delete(child);
				if (!interrupted)
					groups.delete(child.pid);
				if (signal)
					console.error('Test process terminated by ' + signal);
				resolveStatus(status ?? 1);
			});
		})));
		if (shutdown != null)
			await shutdown;
		return interrupted || statuses.find(status => status !== 0) || 0;
	}
	finally {
		process.off('SIGINT', onInterrupt);
		process.off('SIGTERM', onTerminate);
	}
}

function run(args, env, cwd = process.cwd()) {
	const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });

	if (result.error)
		throw result.error;

	if (result.signal)
		console.error('Test process terminated by ' + result.signal);

	return result.status ?? 1;
}

async function main() {
	const bun = !!process.versions.bun;
	const command = testCommand(process.argv.slice(2));
	const env = { ...process.env };
	console.log('Test runtime: ' + (bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node));

	if (bun) {
		env.NODE_OPTIONS = '';
		// bun test defaults to UTC; retain the caller's timezone.
		env.TZ ??= new Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	let workers = Math.min(command.workers, command.files.length);
	if (env.UPDATE === '1' && workers > 1) {
		console.log('UPDATE=1: running snapshot updates serially (--workers=1).');
		workers = 1;
	}

	const testEnv = { ...env };
	const coverageDir = resolve(root, bun ? '.nyc_output/bun' : '.nyc_output');
	if (command.coverage) {
		testEnv.UPLOT_INSTRUMENT_CACHE_DIR ??= resolve(root, '.cache/test-instrument', getInstrumentCacheNamespace(root));
		mkdirSync(resolve(testEnv.UPLOT_INSTRUMENT_CACHE_DIR), { recursive: true });
		testEnv.UPLOT_COVERAGE_DIR = coverageDir;
		if (bun)
			command.args.splice(1, 0, '--preload', hooks);
		else
			testEnv.NODE_OPTIONS = [env.NODE_OPTIONS, '--import ' + JSON.stringify(hooks)].filter(Boolean).join(' ');

		rmSync(coverageDir, { recursive: true, force: true });
		// Empty or entirely skipped selections still produce a successful empty report.
		mkdirSync(coverageDir, { recursive: true });
	}

	let commands = [command.args];
	let reportDir;
	let testStatus = 0;
	let snapshotStatus = 0;
	try {
		if (workers > 1) {
			console.log('Test workers: ' + workers);
			if (bun) {
				command.args.splice(1, 0, '--parallel=' + workers, '--no-isolate');
				// A name filter measures only part of each file, not its normal duration.
				if (!command.args.includes('--test-name-pattern')) {
					const timingDir = resolve(root, '.cache/test-timings');
					mkdirSync(timingDir, { recursive: true });
					command.args.splice(1, 0, '--timings=' + resolve(timingDir, 'bun-' + (command.coverage ? 'coverage' : 'plain') + '.json'), '--update-timings');
				}
			}
			else {
				const prefix = command.args.slice(0, -command.files.length);
				commands = splitTestFiles(command.files, workers).map(files => [...prefix, ...files]);
			}
			reportDir = mkdtempSync(resolve(tmpdir(), 'uplot-test-reports-'));
			testEnv.UPLOT_TEST_REPORT_DIR = reportDir;
			rmSync(resolve('test/output'), { recursive: true, force: true });
		}

		testStatus = await runTests(commands, testEnv);
		if (reportDir != null) {
			try {
				const { mergeSnapshotReports } = await import('./test-reports.mjs');
				snapshotStatus = mergeSnapshotReports(reportDir, resolve('test/output/index.html')) > 0 ? 1 : 0;
			}
			catch (error) {
				console.error(error);
				snapshotStatus = 1;
			}
		}
	}
	finally {
		if (reportDir != null)
			rmSync(reportDir, { recursive: true, force: true });
	}

	const reportStatus = command.coverage ? run([coverageReporter, coverageDir], env, root) : 0;
	process.exitCode = testStatus || snapshotStatus || reportStatus;
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await main();
