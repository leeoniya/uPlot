import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProbeWorker } from '../scripts/probe-worker.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const helper = fileURLToPath(new URL('./fixtures/probe-worker.mjs', import.meta.url));

describe('sequential probe worker', function() {
	this.timeout(15000);
	let worker;
	let directory;
	let env;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), 'uplot-worker-test-'));
		env = { ...process.env, NODE_OPTIONS: '', UPLOT_WORKER_EXIT_FILE: join(directory, 'exit.txt') };
		// Lifecycle fixtures do not import covered chart code. Coverage is tested separately.
		delete env.UPLOT_COVERAGE_DIR;
	});
	afterEach(async () => {
		try { await worker?.close(); }
		finally { rmSync(directory, { recursive: true, force: true }); }
	});

	function start(options = {}) {
		return worker = createProbeWorker({ cwd, helper, env, ...options });
	}

	it('reuses one process and exits normally so exit-time coverage can flush', async () => {
		start();
		const pid = await worker.run('pid');
		assert.deepEqual(await worker.run('environment'), { nodeOptions: '', coverageDir: null });
		assert.equal(await worker.run('count'), 1);
		assert.equal(await worker.run('count'), 2);
		assert.equal(await worker.run('pid'), pid);
		await worker.run('flushOnExit');
		await worker.close();
		assert.equal(readFileSync(env.UPLOT_WORKER_EXIT_FILE, 'utf8'), 'flushed');
		await assert.rejects(worker.run('count'), /worker is closed/);
	});

	it('instruments worker source and writes coverage on exit', async () => {
		env.UPLOT_COVERAGE_DIR = join(directory, 'coverage');
		if (!process.versions.bun)
			env.NODE_OPTIONS = '--import ./scripts/register-hooks.mjs';
		start();
		const pid = await worker.run('pid');
		assert.equal(await worker.run('coverage'), true);
		await worker.close();

		const coverage = JSON.parse(readFileSync(join(env.UPLOT_COVERAGE_DIR, pid + '.json'), 'utf8'));
		const filename = fileURLToPath(new URL('../src/utils.js', import.meta.url));
		assert.ok(Object.values(coverage[filename].f).some(count => count > 0));
	});

	it('reports a named failure and restarts with fresh state', async () => {
		start();
		await worker.run('count');
		await worker.run('flushOnExit');
		await assert.rejects(worker.run('fail'), /probe fail:.*intentional assertion failure/);
		assert.equal(readFileSync(env.UPLOT_WORKER_EXIT_FILE, 'utf8'), 'flushed');
		assert.equal(await worker.run('count'), 1);
	});

	it('reports crash status and stderr, then restarts', async () => {
		start();
		await assert.rejects(worker.run('crash'), error => {
			assert.match(error.message, /crash.*status=23/);
			assert.match(error.message, /intentional crash diagnostic/);
			return true;
		});
		assert.equal(await worker.run('count'), 1);
	});

	it('kills synchronous infinite loops, rejects overlapping requests, and restarts', async () => {
		start();
		const timedOut = assert.rejects(worker.run('hang', 100), error => {
			assert.equal(error.code, 'ETIMEDOUT');
			assert.match(error.message, /probe hang: execution timeout/);
			return true;
		});
		await assert.rejects(worker.run('count'), /only supports sequential requests/);
		await timedOut;
		assert.equal(await worker.run('count'), 1);
	});

	it('enforces a separate startup deadline', async () => {
		env.UPLOT_WORKER_TEST_MODE = 'startup-hang';
		start({ startupTimeout: 100 });
		await assert.rejects(worker.run('count'), /startup timeout/);
	});

	it('reports a crash before readiness and can restart', async () => {
		env.UPLOT_WORKER_TEST_MODE = 'startup-crash';
		start();
		await assert.rejects(worker.run('count'), /startup.*status=17/);
		delete env.UPLOT_WORKER_TEST_MODE;
		assert.equal(await worker.run('count'), 1);
	});

	it('rejects results for the wrong case instead of treating them as a pass', async () => {
		env.UPLOT_WORKER_TEST_MODE = 'wrong-result';
		start();
		await assert.rejects(worker.run('count'), /unexpected worker message/);
		delete env.UPLOT_WORKER_TEST_MODE;
		assert.equal(await worker.run('count'), 1);
	});

	it('rejects unknown probes rather than executing inherited properties', async () => {
		start();
		await assert.rejects(worker.run('toString'), /Unknown probe: toString/);
		assert.equal(await worker.run('count'), 1);
	});

	it('does not ignore a bad exit after a successful result', async () => {
		env.UPLOT_WORKER_TEST_MODE = 'bad-exit';
		start();
		await worker.run('count');
		await assert.rejects(worker.close(), /shutdown failed/);
	});

	it('kills a worker that hangs during shutdown', async () => {
		env.UPLOT_WORKER_TEST_MODE = 'shutdown-hang';
		start({ shutdownTimeout: 100 });
		await worker.run('count');
		await assert.rejects(worker.close(), /shutdown timeout/);
	});

	it('can close an active worker without leaving its request pending', async () => {
		start();
		await worker.run('pid');
		const interrupted = assert.rejects(worker.run('hang'), /worker exited/);
		await worker.close();
		await interrupted;
	});
});
