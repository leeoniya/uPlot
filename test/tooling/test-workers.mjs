import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { splitTestFiles } from '../../scripts/test.mjs';

const bun = !!process.versions.bun;

describe('test worker partitioning', () => {
	const files = Object.freeze(['a', 'b', 'c', 'd']);
	const weights = { a: 4, b: 8, c: 7, d: 3 };
	const weight = file => weights[file];

	it('assigns largest files to the lightest batch and restores selection order within each batch', () => {
		assert.deepEqual(splitTestFiles(files, 2, weight), [['b', 'd'], ['a', 'c']]);
		assert.deepEqual(files, ['a', 'b', 'c', 'd']);
	});

	it('breaks equal-weight ties deterministically in selection and batch order', () => {
		for (let i = 0; i < 3; i++)
			assert.deepEqual(splitTestFiles(files, 2, () => 1), [['a', 'c'], ['b', 'd']]);
	});

	it('preserves all selected files in their original order with one worker', () => {
		assert.deepEqual(splitTestFiles(files, 1, weight), [['a', 'b', 'c', 'd']]);
	});

	it('caps the number of nonempty batches at the file count', () => {
		const groups = splitTestFiles(files, Number.MAX_SAFE_INTEGER, weight);
		assert.equal(groups.length, files.length);
		assert.ok(groups.every(group => group.length === 1));
		assert.deepEqual(groups.flat().sort(), [...files]);
	});

	it('returns no batches for an empty selection', () => {
		for (const workers of [1, 4])
			assert.deepEqual(splitTestFiles([], workers, () => assert.fail('An empty selection has no weights')), []);
	});

	for (const weight of [() => 0, file => file === 'a' ? 1 : 0]) {
		it(`keeps zero-byte files in nonempty, deterministic batches (${weight('a')} initial weight)`, () => {
			for (const workers of [2, 4, 8]) {
				const groups = splitTestFiles(files, workers, weight);
				assert.equal(groups.length, Math.min(workers, files.length));
				assert.ok(groups.every(group => group.length > 0));
				assert.deepEqual(groups.flat().sort(), [...files]);
				for (const group of groups)
					assert.deepEqual(group, files.filter(file => group.includes(file)));
				assert.deepEqual(splitTestFiles(files, workers, weight), groups);
			}
		});
	}

	it('uses on-disk byte sizes when no weight callback is provided', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'uplot test weights-'));
		try {
			for (const file of files)
				writeFileSync(join(cwd, file), 'x'.repeat(weights[file]));
			const paths = files.map(file => join(cwd, file));
			assert.deepEqual(splitTestFiles(paths, 2), [[paths[1], paths[3]], [paths[0], paths[2]]]);
		}
		finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

// All fixture files have the same size, so Node's batch assignments are predictable.
const fixture = `
	import { it } from 'node:test';
	import assert from 'node:assert/strict';
	import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
	import { basename, isAbsolute, join } from 'node:path';
	import { setTimeout as delay } from 'node:timers/promises';
	import { fileURLToPath } from 'node:url';
	const name = basename(fileURLToPath(import.meta.url), '.test.mjs');
	const config = JSON.parse(readFileSync('config.json', 'utf8'));
	if (!globalThis.fixtureExitHook) {
		globalThis.fixtureExitHook = true;
		process.once('exit', () => writeFileSync(join('exited', process.pid + '.txt'), 'exited'));
	}

	it('selected ' + name, async () => {
		const reportDir = process.env.UPLOT_TEST_REPORT_DIR ?? null;
		if (config.parallel) {
			assert.ok(reportDir != null && isAbsolute(reportDir) && existsSync(reportDir), 'Missing report spool');
			assert.equal(existsSync('test/output/stale.txt'), false, 'Parent must clear cwd/test/output before tests');
		}
		else
			assert.equal(reportDir, null);

		mkdirSync(join('started', String(process.pid)), { recursive: true });
		// Wait for a second process rather than asserting wall-clock speed. This also gives
		// Bun's dynamically started pool time to add a worker for these tiny test files.
		const deadline = performance.now() + 1000;
		while (config.barrier > 0) {
			if (readdirSync('started').length >= config.barrier)
				break;
			assert.ok(performance.now() < deadline, 'Selected files did not start concurrently');
			await delay(10);
		}

		if (config.fail != null && name !== config.fail)
			await delay(30);

		if (config.coverage) {
			assert.ok(globalThis.__coverage__, 'Coverage preload did not run');
			globalThis.__coverage__[name] = (globalThis.__coverage__[name] ?? 0) + 1;
		}
		else
			assert.equal(globalThis.__coverage__, undefined);

		globalThis.fixtureRuns = (globalThis.fixtureRuns ?? 0) + 1;
		const record = {
			name, pid: process.pid, ordinal: globalThis.fixtureRuns,
			reportDir, cacheDir: process.env.UPLOT_INSTRUMENT_CACHE_DIR ?? null,
			execArgv: process.execArgv,
		};
		appendFileSync(join('observed', name + '.jsonl'), JSON.stringify(record) + '\\n');
		mkdirSync('test/output', { recursive: true });
		writeFileSync(join('test/output', name + '.txt'), name, { flag: 'wx' });
		if (config.fail === name)
			throw new Error('worker failure sentinel ' + name);
	});

	it('excluded ' + name, () => {
		appendFileSync('excluded.jsonl', JSON.stringify(name) + '\\n');
	});
`;

describe('test worker subprocesses', () => {
	let root, cwd, env, names, config;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'uplot test workers-'));
		cwd = join(root, 'caller directory');
		mkdirSync(join(root, 'scripts'));
		for (const directory of ['started', 'observed', 'exited', 'test/output'])
			mkdirSync(join(cwd, directory), { recursive: true });
		mkdirSync(join(root, 'test/output'), { recursive: true });
		writeFileSync(join(cwd, 'test/output/stale.txt'), 'caller output');
		writeFileSync(join(root, 'test/output/stale.txt'), 'root output');
		copyFileSync(new URL('../../scripts/test.mjs', import.meta.url), join(root, 'scripts/test.mjs'));
		writeFileSync(join(root, 'scripts/instrument-source.mjs'), `
			export function getInstrumentCacheNamespace() { throw new Error('Unexpected source instrumentation'); }
		`);
		env = { ...process.env, NODE_OPTIONS: '' };
		for (const key of ['NODE_V8_COVERAGE', 'NYC_CONFIG', 'NYC_CWD', 'UPLOT_COVERAGE_DIR', 'UPLOT_INSTRUMENT_CACHE_DIR', 'UPLOT_TEST_REPORT_DIR', 'UPDATE', 'FIXTURE_REPORT_STATUS'])
			delete env[key];
		config = { parallel: true, barrier: 2, coverage: false };
	});

	afterEach(() => {
		if (root != null)
			rmSync(root, { recursive: true, force: true });
	});

	function select(selected = ['a', 'b', 'c', 'd']) {
		names = selected;
		for (const name of names)
			writeFileSync(join(cwd, name + '.test.mjs'), fixture);
	}

	function run({ workers = 2, selection = ['*.test.mjs'], flags = [], reports = null } = {}) {
		writeFileSync(join(cwd, 'config.json'), JSON.stringify(config));
		// Serial fixtures deliberately have neither helper: the runner must import reports lazily.
		if (workers > 1 && env.UPDATE !== '1') {
			if (reports != null)
				writeFileSync(join(root, 'scripts/test-reports.mjs'), reports);
			else {
				for (const file of ['test-reports.mjs', 'replay.mjs'])
					copyFileSync(new URL('../../scripts/' + file, import.meta.url), join(root, 'scripts', file));
			}
		}
		const args = [join(root, 'scripts/test.mjs'), '--workers', String(workers), ...flags, ...selection];
		if (!config.coverage)
			args.splice(1, 0, '--no-coverage');
		const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 10000 });
		assert.ifError(result.error);
		assert.equal(result.signal, null, result.stdout + result.stderr);
		return result;
	}

	function passed(result) {
		assert.equal(result.status, 0, result.stdout + result.stderr);
	}

	function jsonLines(filename) {
		return readFileSync(filename, 'utf8').trim().split('\n').map(line => JSON.parse(line));
	}

	function observed() {
		assert.deepEqual(readdirSync(join(cwd, 'observed')).sort(), names.map(name => name + '.jsonl').sort());
		return names.map(name => {
			const records = jsonLines(join(cwd, 'observed', name + '.jsonl'));
			assert.equal(records.length, 1, name + ' must run exactly once');
			assert.equal(records[0].name, name);
			return records[0];
		});
	}

	function parallelOutput(records) {
		const spools = [...new Set(records.map(record => record.reportDir))];
		assert.equal(spools.length, 1);
		assert.equal(typeof spools[0], 'string');
		assert.ok(isAbsolute(spools[0]));
		assert.deepEqual(readdirSync(join(cwd, 'test/output')).sort(), names.map(name => name + '.txt').sort());
		assert.equal(readFileSync(join(root, 'test/output/stale.txt'), 'utf8'), 'root output');
	}

	function timingCache(mode) {
		const filename = join(root, '.cache/test-timings', 'bun-' + mode + '.json');
		if (bun)
			assert.equal(typeof JSON.parse(readFileSync(filename, 'utf8')), 'object');
		else
			assert.equal(existsSync(filename), false);
	}

	it('runs each selected file once in concurrent persistent workers and cleans only caller output', { timeout: 15000 }, () => {
		select();
		passed(run({ selection: ['c.test.mjs', 'a.test.mjs', 'd.test.mjs', 'b.test.mjs', '*.test.mjs'] }));
		const records = observed();
		const pids = [...new Set(records.map(record => record.pid))];
		assert.equal(pids.length, 2);
		for (const pid of pids) {
			const group = records.filter(record => record.pid === pid);
			assert.deepEqual(group.map(record => record.ordinal).sort((a, b) => a - b), group.map((_, i) => i + 1));
		}
		if (!bun) {
			assert.deepEqual(pids.map(pid => records.filter(record => record.pid === pid).map(record => record.name).sort()).sort(), [['a', 'b'], ['c', 'd']]);
			assert.ok(records.every(record => record.execArgv.includes('--test-isolation=none')));
		}
		parallelOutput(records);
		timingCache('plain');
		assert.equal(existsSync(join(root, '.nyc_output')), false);
	});

	it('caps a larger worker request at the number of selected files', { timeout: 15000 }, () => {
		select(['a', 'b']);
		passed(run({ workers: 8 }));
		assert.equal(new Set(observed().map(record => record.pid)).size, 2);
	});

	it('finishes remaining files, merges reports once after worker exits, and returns nonzero on failure', { timeout: 15000 }, () => {
		select();
		config.fail = 'a';
		const result = run({ reports: `
			import { appendFileSync, readdirSync } from 'node:fs';
			function record(event) {
				appendFileSync('merges.jsonl', JSON.stringify({
					event, pid: process.pid,
					completed: readdirSync('observed').sort(), exited: readdirSync('exited').sort(),
				}) + '\\n');
			}
			record('import');
			export function mergeSnapshotReports() { record('merge'); }
		` });
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /worker failure sentinel a/);
		const records = observed();
		const pids = [...new Set(records.map(record => record.pid))];
		assert.equal(pids.length, 2);
		parallelOutput(records);
		const merges = jsonLines(join(cwd, 'merges.jsonl'));
		assert.deepEqual(merges.map(entry => entry.event), ['import', 'merge']);
		assert.equal(merges[0].pid, merges[1].pid);
		for (const entry of merges) {
			assert.ok(!pids.includes(entry.pid), 'Only the parent may merge reports');
			assert.deepEqual(entry.completed, names.map(name => name + '.jsonl').sort());
			assert.deepEqual(entry.exited, pids.map(pid => pid + '.txt').sort());
		}
	});

	it('escalates SIGTERM to a surviving grandchild after the direct worker exits', { skip: process.platform === 'win32', timeout: 20000 }, async () => {
		writeFileSync(join(cwd, 'grandchild.mjs'), `
			import { writeFileSync, renameSync } from 'node:fs';
			process.on('SIGTERM', () => {});
			// A setup failure must not leave an indefinitely running orphan.
			setTimeout(() => process.exit(99), 30000);
			writeFileSync('grandchild.ready.tmp', JSON.stringify({ pid: process.pid, worker: process.ppid }));
			renameSync('grandchild.ready.tmp', 'grandchild.ready.json');
		`);
		writeFileSync(join(cwd, 'shutdown.test.mjs'), `
			import { it } from 'node:test';
			import { spawn } from 'node:child_process';
			import { writeFileSync } from 'node:fs';
			process.once('SIGTERM', () => process.exit(0));
			writeFileSync('worker.pid', String(process.pid));
			it('waits for shutdown', { timeout: 15000 }, () => new Promise((resolve, reject) => {
				// Inherited pipes would keep the harness's close event pending and mask the regression.
				const child = spawn(process.execPath, ['grandchild.mjs'], { stdio: 'ignore' });
				writeFileSync('grandchild.pid', String(child.pid));
				child.once('error', reject);
				child.once('exit', () => reject(new Error('Grandchild exited before shutdown')));
			}));
		`);

		// One native worker exercises the shared shutdown path without a Bun pool intermediary.
		const harness = spawn(process.execPath, [join(root, 'scripts/test.mjs'), '--no-coverage', '--workers=1', 'shutdown.test.mjs'], {
			cwd, env, stdio: ['ignore', 'pipe', 'pipe'],
		});
		let status, spawnError, output = '';
		harness.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
		harness.stderr.setEncoding('utf8').on('data', chunk => { output += chunk; });
		harness.once('error', error => { spawnError = error; });
		harness.once('close', (code, signal) => { status = { code, signal }; });

		async function waitUntil(condition, timeout, message) {
			const deadline = performance.now() + timeout;
			while (!condition()) {
				assert.ok(performance.now() < deadline, message + '\n' + output);
				await delay(20);
			}
		}

		function executing(pid) {
			try {
				process.kill(pid, 0);
				if (process.platform !== 'linux')
					return true;
				// Container init processes may leave a killed orphan as an unreaped zombie.
				const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
				return !/^[ZX]/.test(stat.slice(stat.lastIndexOf(')') + 2));
			}
			catch (error) {
				if (error.code === 'ESRCH' || error.code === 'ENOENT')
					return false;
				throw error;
			}
		}

		try {
			await waitUntil(() => {
				assert.ifError(spawnError);
				assert.equal(status, undefined, 'Harness exited before readiness\n' + output);
				return existsSync(join(cwd, 'grandchild.ready.json'));
			}, 5000, 'Grandchild did not become ready');
			const ready = JSON.parse(readFileSync(join(cwd, 'grandchild.ready.json'), 'utf8'));
			assert.equal(ready.worker, Number(readFileSync(join(cwd, 'worker.pid'), 'utf8')));
			assert.ok(Number.isSafeInteger(ready.pid) && ready.pid > 0);
			assert.ok(executing(ready.pid));
			assert.ok(harness.kill('SIGTERM'));

			await waitUntil(() => status != null, 5000, 'Harness did not finish its 2s shutdown escalation');
			assert.ifError(spawnError);
			assert.deepEqual(status, { code: 143, signal: null }, output);
			await waitUntil(() => !executing(ready.pid), 1000, 'Grandchild survived harness shutdown');
		}
		finally {
			// PID files are written by the worker before readiness, so setup failures are covered too.
			harness.kill('SIGKILL');
			const pid = name => existsSync(join(cwd, name)) ? Number(readFileSync(join(cwd, name), 'utf8')) : 0;
			const worker = pid('worker.pid'), grandchild = pid('grandchild.pid');
			const errors = [];
			for (const target of [-worker, grandchild]) {
				if (!Number.isSafeInteger(target) || target === 0)
					continue;
				try { process.kill(target, 'SIGKILL'); }
				catch (error) { if (error.code !== 'ESRCH') errors.push(error); }
			}
			await waitUntil(() => status != null && !(grandchild > 0 && executing(grandchild)), 2000, 'Shutdown fixture cleanup did not finish');
			assert.deepEqual(errors, []);
		}
	});

	it('preserves name filters and overlapping selections without updating either timing cache', { timeout: 15000 }, () => {
		select(['a', 'b']);
		const directory = join(root, '.cache/test-timings');
		mkdirSync(directory, { recursive: true });
		const caches = ['plain', 'coverage'].map(mode => [join(directory, 'bun-' + mode + '.json'), JSON.stringify({ sentinel: mode })]);
		for (const [filename, contents] of caches)
			writeFileSync(filename, contents);
		passed(run({
			selection: ['b.test.mjs', '*.test.mjs', './a.test.mjs', join(cwd, 'b.test.mjs')],
			flags: ['--grep', '^selected (a|b)$', '--reporter', 'dots'],
		}));
		assert.equal(new Set(observed().map(record => record.pid)).size, 2);
		assert.equal(existsSync(join(cwd, 'excluded.jsonl')), false);
		for (const [filename, contents] of caches)
			assert.equal(readFileSync(filename, 'utf8'), contents);
	});

	for (const update of [false, true]) {
		it(update ? 'forces UPDATE=1 to run serially with a notice' : 'keeps explicit --workers=1 serial without loading report helpers', { timeout: 15000 }, () => {
			select(['a', 'b']);
			config.parallel = false;
			config.barrier = 0;
			if (update)
				env.UPDATE = '1';
			const result = run({ workers: update ? 2 : 1 });
			passed(result);
			const records = observed();
			assert.equal(new Set(records.map(record => record.pid)).size, 1);
			assert.deepEqual(records.map(record => record.ordinal).sort(), [1, 2]);
			assert.ok(records.every(record => record.reportDir === null));
			assert.equal(readFileSync(join(cwd, 'test/output/stale.txt'), 'utf8'), 'caller output');
			assert.equal(existsSync(join(root, '.cache/test-timings')), false);
			if (update) {
				assert.match(result.stdout + result.stderr, /UPDATE=1/);
				assert.match(result.stdout + result.stderr, /serial|workers\D+1/i);
			}
		});
	}

	function fakeCoverage() {
		config.coverage = true;
		writeFileSync(join(root, 'scripts/instrument-source.mjs'), `
			import { appendFileSync } from 'node:fs';
			import { join } from 'node:path';
			export function getInstrumentCacheNamespace(root) {
				appendFileSync(join(root, 'namespaces.jsonl'), JSON.stringify({ root, pid: process.pid }) + '\\n');
				return 'fixture-cache';
			}
		`);
		writeFileSync(join(root, 'scripts/register-hooks.mjs'), `
			import assert from 'node:assert/strict';
			import { existsSync, writeFileSync } from 'node:fs';
			import { join } from 'node:path';
			assert.ok(existsSync(process.env.UPLOT_INSTRUMENT_CACHE_DIR));
			globalThis.__coverage__ = {};
			process.once('exit', () => {
				if (Object.keys(globalThis.__coverage__).length > 0)
					writeFileSync(join(process.env.UPLOT_COVERAGE_DIR, process.pid + '.json'), JSON.stringify({
						pid: process.pid, hits: globalThis.__coverage__, cacheDir: process.env.UPLOT_INSTRUMENT_CACHE_DIR,
					}));
			});
		`);
		writeFileSync(join(root, 'scripts/report-coverage.mjs'), `
			import assert from 'node:assert/strict';
			import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
			import { join } from 'node:path';
			assert.equal(globalThis.__coverage__, undefined, 'Reporter must not be instrumented');
			const directory = process.argv[2];
			const entries = readdirSync(directory).sort().map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
			const completed = readdirSync('caller directory/observed').sort();
			appendFileSync('reports.jsonl', JSON.stringify({ directory, entries, completed, cwd: process.cwd() }) + '\\n');
			process.exitCode = Number(process.env.FIXTURE_REPORT_STATUS ?? 0);
		`);
	}

	for (const fail of [false, true]) {
		it(`shares instrumentation and reports combined coverage once after ${fail ? 'failing' : 'passing'} workers`, { timeout: 15000 }, () => {
			select();
			fakeCoverage();
			if (fail)
				config.fail = 'a';
			const cacheDir = fail ? join(root, 'custom instrument cache') : join(root, '.cache/test-instrument/fixture-cache');
			if (fail)
				env.UPLOT_INSTRUMENT_CACHE_DIR = cacheDir;
			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(join(cacheDir, 'retained.txt'), 'cached transform');
			const coverageDir = join(root, bun ? '.nyc_output/bun' : '.nyc_output');
			mkdirSync(coverageDir, { recursive: true });
			writeFileSync(join(coverageDir, 'stale.json'), JSON.stringify({ stale: true }));
			const result = run();
			if (fail) {
				assert.notEqual(result.status, 0, result.stdout + result.stderr);
				assert.match(result.stdout + result.stderr, /worker failure sentinel a/);
			}
			else
				passed(result);

			const records = observed();
			assert.equal(new Set(records.map(record => record.pid)).size, 2);
			assert.ok(records.every(record => record.cacheDir === cacheDir));
			assert.equal(readFileSync(join(cacheDir, 'retained.txt'), 'utf8'), 'cached transform');
			const namespaces = join(root, 'namespaces.jsonl');
			if (!fail || existsSync(namespaces))
				assert.equal(jsonLines(namespaces).length, 1);
			const reports = jsonLines(join(root, 'reports.jsonl'));
			assert.equal(reports.length, 1);
			const [report] = reports;
			assert.equal(report.directory, coverageDir);
			assert.equal(report.cwd, root);
			assert.deepEqual(report.completed, names.map(name => name + '.jsonl').sort());
			assert.equal(report.entries.length, 2);
			assert.deepEqual(report.entries.map(entry => entry.pid).sort(), [...new Set(records.map(record => record.pid))].sort());
			assert.ok(report.entries.every(entry => entry.cacheDir === cacheDir));
			const hits = report.entries.flatMap(entry => Object.entries(entry.hits)).sort();
			assert.deepEqual(hits, names.map(name => [name, 1]).sort());
			assert.equal(existsSync(join(coverageDir, 'stale.json')), false);
			parallelOutput(records);
			if (!fail)
				timingCache('coverage');
		});
	}

	it('returns the coverage reporter failure after otherwise successful workers', { timeout: 15000 }, () => {
		select(['a', 'b']);
		fakeCoverage();
		env.FIXTURE_REPORT_STATUS = '7';
		const result = run();
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		observed();
		assert.equal(jsonLines(join(root, 'reports.jsonl')).length, 1);
	});
});
