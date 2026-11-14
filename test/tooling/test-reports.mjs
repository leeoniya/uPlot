import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeSnapshotReports } from '../../scripts/test-reports.mjs';

const recorder = new URL('../../scripts/recorder.mjs', import.meta.url).href;
const original = JSON.parse(fs.readFileSync(new URL('../demos/area-fill/0-0.json', import.meta.url), 'utf8'));
const expected = { ...original, width: original.width + 1 };
const failure = { title: 'area-fill 0-0', expected, actual: original };

function reportEntries(filename) {
	return JSON.parse(fs.readFileSync(filename, 'utf8').match(/const failures = (.+);/)[1]);
}

function checkMerge(directory, filename, count) {
	const log = console.log;
	const messages = [];
	try {
		console.log = message => messages.push(message);
		assert.equal(mergeSnapshotReports(directory, filename), count);
	}
	finally {
		console.log = log;
	}
	assert.deepEqual(messages, count === 0 ? [] : [
		`Visual comparisons: ${path.relative('.', filename)} (${count} failed snapshots)`,
	]);
}

describe('worker snapshot reports', () => {
	let cwd, directory, report, snapshot, env;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(tmpdir(), 'uplot snapshot reports-'));
		directory = path.join(cwd, 'spool');
		report = path.join(cwd, 'test/output/index.html');
		snapshot = path.join(cwd, 'test/demos/area-fill/0-0.json');
		fs.mkdirSync(directory);
		fs.mkdirSync(path.dirname(snapshot), { recursive: true });
		fs.writeFileSync(snapshot, JSON.stringify(expected));
		fs.writeFileSync(path.join(cwd, 'fixture.test.mjs'), `
			import { registerDemos } from ${JSON.stringify(recorder)};
			await registerDemos(['area-fill']);
		`);
		env = { ...process.env, NODE_OPTIONS: '' };
		for (const key of ['NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', 'UPLOT_COVERAGE_DIR', 'UPLOT_INSTRUMENT_CACHE_DIR', 'UPLOT_TEST_REPORT_DIR', 'UPDATE'])
			delete env[key];
	});

	afterEach(() => {
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	function run(extraEnv = {}) {
		const args = process.versions.bun
			? ['test', '--timeout=5000', './fixture.test.mjs']
			: ['--test', '--test-isolation=none', '--test-timeout=5000', '--test-reporter=tap', 'fixture.test.mjs'];
		return new Promise((resolve, reject) => {
			const child = spawn(process.execPath, args, {
				cwd, env: { ...env, ...extraEnv }, timeout: 10000,
			});
			let output = '';
			child.stdout.on('data', chunk => output += chunk);
			child.stderr.on('data', chunk => output += chunk);
			child.on('error', reject);
			child.on('close', (status, signal) => {
				if (signal)
					reject(new Error(`Snapshot fixture terminated by ${signal}: ${output}`));
				else
					resolve({ pid: child.pid, status, output });
			});
		});
	}

	function previousReport() {
		fs.mkdirSync(path.dirname(report), { recursive: true });
		fs.writeFileSync(report, 'previous report');
	}

	it('merges JSON files in filename order and preserves escaped failure records', () => {
		const text = '</script><script>globalThis.injected = true</script>';
		const spec = { html: text, width: 40, height: 20, ctxlog: [['fillText', [text, 1, 2]]] };
		const first = { title: 'First < & "title"', expected: spec, actual: { ...spec, width: 80 } };
		const second = { ...first, title: 'Second' };
		const third = { ...first, title: 'Third' };
		fs.writeFileSync(path.join(directory, '3.json'), JSON.stringify([third]));
		fs.writeFileSync(path.join(directory, '20.json'), JSON.stringify([first, second]));
		fs.writeFileSync(path.join(directory, '10.json'), '[]');
		fs.writeFileSync(path.join(directory, 'ignored.txt'), 'not JSON');
		fs.mkdirSync(path.join(directory, 'ignored.json'));

		checkMerge(directory, report, 3);
		assert.deepEqual(reportEntries(report), [first, second, third]);
		const html = fs.readFileSync(report, 'utf8');
		assert.ok(html.includes('<h2>First &lt; &amp; &quot;title&quot;</h2>'));
		assert.ok(!html.includes(text));
		assert.ok(html.includes('\\u003c/script>'));
	});

	it('returns zero without a report or message for empty and successful spools', () => {
		checkMerge(directory, report, 0);
		fs.writeFileSync(path.join(directory, '1.json'), '[]');
		checkMerge(directory, report, 0);
		assert.equal(fs.existsSync(report), false);
	});

	it('collects two workers without deleting shared output or writing worker HTML', { timeout: 30000 }, async () => {
		previousReport();
		const workerEnv = { UPLOT_TEST_REPORT_DIR: directory };
		const workers = await Promise.all([run(workerEnv), run(workerEnv)]);
		assert.notEqual(workers[0].pid, workers[1].pid);
		assert.deepEqual(fs.readdirSync(directory).sort(), workers.map(worker => worker.pid + '.json').sort());
		for (const worker of workers) {
			assert.equal(worker.status, 1, worker.output);
			assert.match(worker.output, /Visual comparisons: test\/output\/index\.html/);
			assert.doesNotMatch(worker.output, /\(\d+ failed snapshots\)/);
			assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, worker.pid + '.json'), 'utf8')), [failure]);
		}
		assert.equal(fs.readFileSync(report, 'utf8'), 'previous report');
		assert.deepEqual(fs.readdirSync(path.dirname(report)), ['index.html']);
		checkMerge(directory, report, 2);
		assert.deepEqual(reportEntries(report), [failure, failure]);

		const merged = fs.readFileSync(report, 'utf8');
		fs.writeFileSync(snapshot, JSON.stringify(original));
		const passed = await run(workerEnv);
		assert.equal(passed.status, 0, passed.output);
		assert.doesNotMatch(passed.output, /Visual comparisons:/);
		const successfulReport = path.join(directory, passed.pid + '.json');
		if (fs.existsSync(successfulReport))
			assert.deepEqual(JSON.parse(fs.readFileSync(successfulReport, 'utf8')), []);
		assert.equal(fs.readFileSync(report, 'utf8'), merged);
	});

	it('keeps standalone reporting and cleanup unchanged', { timeout: 30000 }, async () => {
		previousReport();
		fs.writeFileSync(path.join(path.dirname(report), 'stale.txt'), 'old output');
		const failed = await run();
		assert.equal(failed.status, 1, failed.output);
		assert.equal((failed.output.match(/Visual comparisons: test\/output\/index\.html \(1 failed snapshots\)/g) ?? []).length, 1, failed.output);
		assert.deepEqual(reportEntries(report), [failure]);
		assert.deepEqual(fs.readdirSync(path.dirname(report)), ['index.html']);
		assert.deepEqual(fs.readdirSync(directory), []);

		fs.writeFileSync(snapshot, JSON.stringify(original));
		const passed = await run();
		assert.equal(passed.status, 0, passed.output);
		assert.doesNotMatch(passed.output, /Visual comparisons:/);
		assert.equal(fs.existsSync(path.dirname(report)), false);
	});

	it('keeps UPDATE snapshot writes and existing output in serial and worker modes', { timeout: 30000 }, async () => {
		previousReport();
		for (const mode of [{}, { UPLOT_TEST_REPORT_DIR: directory }]) {
			fs.writeFileSync(snapshot, JSON.stringify(expected));
			const updated = await run({ ...mode, UPDATE: '1' });
			assert.equal(updated.status, 0, updated.output);
			assert.doesNotMatch(updated.output, /Visual comparisons:/);
			assert.deepEqual(JSON.parse(fs.readFileSync(snapshot, 'utf8')), original);
			assert.equal(fs.readFileSync(report, 'utf8'), 'previous report');
		}
		assert.deepEqual(fs.readdirSync(directory), []);
	});
});
