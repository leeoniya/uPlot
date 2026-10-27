import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWebGLCapture } from '../../scripts/bench-webgl.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP, stopTrace } from '../../scripts/profile-manual.mjs';
import { benchmarkTraceConfig } from '../../scripts/benchmarks-trace.mjs';
import { analyzeBenchmarkTrace } from '../../scripts/analyze-benchmarks-trace.mjs';

function fixture() {
	let now = 0;
	const calls = [];
	const timers = [];
	class Canvas {
		getContext(type, options) {
			calls.push(['getContext', this, type, options]);
			if (this.error)
				throw this.error;
			return this.gl ?? null;
		}
	}
	class Offscreen extends Canvas {}
	Object.defineProperty(Offscreen.prototype, 'getContext', Object.getOwnPropertyDescriptor(Canvas.prototype, 'getContext'));
	const realm = {HTMLCanvasElement: Canvas, OffscreenCanvas: Offscreen,
		performance: {now: () => now}, setTimeout: (fn, ms) => timers.push(() => { now += ms; fn(); })};
	function context(statuses = [3], webgl2 = true) {
		const gl = {
			SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5,
			lost: false, isContextLost() { return this.lost; },
			fenceSync(condition, flags) { calls.push(['fence', gl, condition, flags]); return {}; },
			flush() { calls.push(['flush', gl]); },
			clientWaitSync(sync, flags, timeout) {
				calls.push(['poll', gl, flags, timeout]);
				return statuses.length > 1 ? statuses.shift() : statuses[0];
			},
			deleteSync(sync) { calls.push(['delete', gl, sync]); },
			finish() { assert.fail('Blocking finish must not be used'); },
			getError() { assert.fail('Do not consume application GL errors'); },
		};
		if (!webgl2)
			delete gl.fenceSync;
		return gl;
	}
	async function drain(promise, onTimer = () => {}) {
		while (timers.length) {
			onTimer();
			timers.shift()();
			await Promise.resolve();
		}
		return promise;
	}
	return {realm, context, calls, timers, drain, advance: ms => { now += ms; }};
}

describe('WebGL observer reinstallation', () => {
	it('wraps a vendor context layer without weakening integrity checks', async () => {
		const f = fixture(), original = f.realm.HTMLCanvasElement.prototype.getContext;
		const first = createWebGLCapture(f.realm);
		const before = f.realm.HTMLCanvasElement.prototype.getContext;
		const virtual = f.context([], false);
		virtual.finish = () => f.calls.push(['virtual-finish']);
		function vendor(type) { return type === 'webgl' ? virtual : before.call(this, type); }
		f.realm.HTMLCanvasElement.prototype.getContext = vendor;
		const capture = first.reinstall();
		assert.throws(() => first.begin(), /inactive, installed/);
		capture.begin();
		new f.realm.HTMLCanvasElement().getContext('webgl');
		const result = await capture.complete({webgl1Finish: true});
		assert.equal(result.status, 'complete');
		assert.equal(result.contexts.length, 1);
		assert.equal(result.coverage.observerIntact, true);
		assert.equal(f.calls.filter(call => call[0] === 'virtual-finish').length, 1);
		capture.begin();
		f.realm.HTMLCanvasElement.prototype.getContext = vendor;
		assert.equal((await capture.complete()).coverage.observerIntact, false);
		capture.dispose();
		assert.equal(f.realm.HTMLCanvasElement.prototype.getContext, vendor);
		assert.equal(f.realm.OffscreenCanvas.prototype.getContext, original);
	});

	it('rejects active, retained, pending, and disposed captures', async () => {
		const f = fixture(), capture = createWebGLCapture(f.realm);
		capture.begin();
		assert.throws(() => capture.reinstall(), /inactive, empty/);
		capture.track(f.context());
		const pending = capture.complete({retainContexts: true});
		assert.throws(() => capture.reinstall(), /inactive, empty/);
		await f.drain(pending);
		assert.throws(() => capture.reinstall(), /inactive, empty/);
		capture.reset();
		const replacement = capture.reinstall();
		assert.throws(() => capture.reinstall(), /inactive, empty/);
		replacement.dispose();
	});
});

describe('retained lifecycle GL contexts', () => {
	it('fences reused contexts without reacquisition until session reset', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		const canvas = new f.realm.HTMLCanvasElement();
		canvas.gl = f.context();
		capture.begin();
		canvas.getContext('webgl2');
		const first = await f.drain(capture.complete({retainContexts: true}));
		assert.equal(first.contexts.length, 1);
		capture.begin();
		const update = await f.drain(capture.complete({retainContexts: true}));
		assert.equal(update.status, 'complete');
		assert.equal(update.contexts.length, 1);
		assert.equal(f.calls.filter(call => call[0] === 'getContext').length, 1);
		assert.equal(f.calls.filter(call => call[0] === 'fence').length, 2);
		capture.reset();
		capture.begin();
		assert.equal((await capture.complete()).status, 'not-observed');
		capture.dispose();
	});
});

// Opt-in only: use an existing Chrome Headless Shell, never download a browser.
(process.env.BENCH_WEBGL_CHROME ? describe : describe.skip)('WebGL real-browser validation', function() {
	it('validates WebGL2 fences and opt-in WebGL1 finish under the existing trace categories', { timeout: 30000 }, async () => {
		const profile = await mkdtemp(join(tmpdir(), 'uplot-webgl-test-'));
		const child = spawn(process.env.BENCH_WEBGL_CHROME, [
			'--user-data-dir=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
			'--no-first-run', '--disable-background-networking', '--enable-gpu', 'about:blank',
		], {stdio: ['ignore', 'ignore', 'pipe']});
		let log = '';
		let spawnError;
		child.on('error', error => { spawnError = error; });
		child.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
		const exited = new Promise(resolve => child.once('exit', resolve));
		let browser;
		let page;
		async function connect(url) {
			const socket = new WebSocket(url);
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket connection timed out')); }, 5000);
				socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
				socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')); }, {once: true});
			});
			return new CDP(socket, 10000);
		}
		try {
			let portInfo;
			const deadline = Date.now() + 10000;
			while (!portInfo) {
				if (spawnError) throw spawnError;
				if (child.exitCode !== null || Date.now() >= deadline)
					throw new Error('Chrome failed to start: ' + log);
				try { portInfo = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); }
				catch (error) { if (error.code !== 'ENOENT') throw error; }
				if (!portInfo) await delay(50);
			}
			const [port, path] = portInfo.trim().split('\n');
			browser = await connect('ws://127.0.0.1:' + port + path);
			const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list', {signal: AbortSignal.timeout(5000)})).json();
			page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
			const systemInfo = await browser.send('SystemInfo.getInfo');
			await browser.send('Tracing.start', {transferMode: 'ReturnAsStream', streamFormat: 'json', traceConfig: benchmarkTraceConfig()});
			const run = async createCapture => {
				const capture = createCapture();
				capture.begin();
				const start = performance.mark('benchmark:sample-0:start');
				const canvas = document.createElement('canvas');
				canvas.width = canvas.height = 32;
				document.body.append(canvas);
				const gl = canvas.getContext('webgl2');
				const offscreen = new OffscreenCanvas(32, 32).getContext('webgl2');
				if (!gl || !offscreen) throw new Error('WebGL2 unavailable in this browser');
				// Model asynchronous library readiness, then a deferred draw during settling.
				await new Promise(resolve => setTimeout(() => {
					gl.clearColor(1, 0, 0, 1);
					gl.clear(gl.COLOR_BUFFER_BIT);
					resolve();
				}, 10));
				const jsEnd = performance.mark('benchmark:sample-0:js-end');
				await new Promise(resolve => setTimeout(() => {
					offscreen.clearColor(0, 1, 0, 1);
					offscreen.clear(offscreen.COLOR_BUFFER_BIT);
					resolve();
				}, 10));
				const webgl = await capture.complete();
				const end = performance.mark('benchmark:sample-0:end');
				capture.begin();
				const legacy = document.createElement('canvas').getContext('webgl');
				if (!legacy) throw new Error('WebGL1 unavailable in this browser');
				const webgl1 = await capture.complete();
				capture.begin();
				capture.track(legacy);
				const legacyStart = performance.mark('benchmark:sample-1:start');
				legacy.clearColor(0, 0, 1, 1);
				legacy.clear(legacy.COLOR_BUFFER_BIT);
				const legacyJsEnd = performance.mark('benchmark:sample-1:js-end');
				await new Promise(resolve => setTimeout(() => {
					legacy.clear(legacy.COLOR_BUFFER_BIT);
					resolve();
				}, 10));
				const finished = await capture.complete({webgl1Finish: true});
				const legacyEnd = performance.mark('benchmark:sample-1:end');
				capture.dispose();
				return {webgl1, samples: [
					{id: 'sample-0', dpr: 1, variant: 'webgl-probe', warmup: false,
						jsMs: jsEnd.startTime - start.startTime, windowMs: end.startTime - start.startTime, webgl},
					{id: 'sample-1', dpr: 1, variant: 'webgl1-probe', warmup: false,
						jsMs: legacyJsEnd.startTime - legacyStart.startTime, windowMs: legacyEnd.startTime - legacyStart.startTime, webgl: finished},
				]};
			};
			const evaluated = await page.send('Runtime.evaluate', {expression: `(${run.toString()})(${createWebGLCapture.toString()})`, awaitPromise: true, returnByValue: true});
			assert.equal(evaluated.exceptionDetails, undefined, JSON.stringify(evaluated.exceptionDetails));
			const report = {...evaluated.result.value, systemInfo};
			assert.equal(report.samples[0].webgl.status, 'complete');
			assert.equal(report.samples[0].webgl.contexts.length, 2);
			assert.equal(report.webgl1.contexts[0].status, 'unsupported-webgl1');
			assert.equal(report.samples[1].webgl.status, 'complete');
			assert.equal(report.samples[1].webgl.contexts[0].method, 'finish');
			assert.ok(report.samples[1].webgl.contexts[0].blockingMs >= 0);
			for (const context of report.samples[0].webgl.contexts) {
				assert.equal(context.method, 'fence');
				assert.match(context.contextInfo.version, /WebGL 2/);
				assert.equal(typeof context.contextInfo.renderer, 'string');
			}
			assert.match(report.samples[1].webgl.contexts[0].contextInfo.version, /WebGL 1/);
			await delay(100);
			const tracePath = join(profile, 'trace.json');
			const file = await open(tracePath, 'w');
			try { assert.equal((await stopTrace(browser, file)).dataLoss, false); }
			finally { await file.close(); }
			const analysis = analyzeBenchmarkTrace(JSON.parse(await readFile(tracePath, 'utf8')), report);
			assert.equal(analysis.samples[0].hardwareGpuMs, null);
			assert.equal(analysis.samples[1].hardwareGpuMs, null);
			assert.ok(analysis.samples[1].rendererMainTaskMs > 0);
			assert.equal(analysis.diagnostics.eventTypes.RunTask.available, true);
			assert.equal(analysis.diagnostics.eventTypes.GPUTask.available, true);
			console.log('    WebGL probe:', JSON.stringify({webgl2: report.samples[0].webgl.contexts, webgl1: report.samples[1].webgl.contexts,
				backend: analysis.diagnostics.backend.renderer, GPUTaskMs: analysis.samples[0].GPUTaskMs,
				gpuMainTaskMs: analysis.samples[0].gpuMainTaskMs, hardwareGpuMs: analysis.samples[0].hardwareGpuMs}));
		}
		finally {
			page?.close();
			browser?.close();
			if (child.pid && child.exitCode === null) {
				child.kill('SIGKILL');
				await exited;
			}
			await rm(profile, {recursive: true, force: true});
		}
	});
});

describe('WebGL completion validation', () => {
	it('preserves getContext receiver, arguments, identity, exceptions, and descriptors', () => {
		const f = fixture();
		const prototype = f.realm.HTMLCanvasElement.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getContext');
		const capture = createWebGLCapture(f.realm);
		const canvas = new f.realm.HTMLCanvasElement();
		canvas.gl = f.context();
		const options = {alpha: false};
		assert.equal(canvas.getContext('webgl2', options), canvas.gl);
		assert.deepEqual(f.calls[0], ['getContext', canvas, 'webgl2', options]);
		canvas.error = new Error('native error');
		assert.throws(() => canvas.getContext('webgl2'), error => error === canvas.error);
		capture.dispose();
		assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'getContext'), descriptor);
		assert.throws(() => capture.begin(), /inactive/);
	});

	it('submits all unique fences before yielding, then polls without blocking and cleans up', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		const canvas = new f.realm.HTMLCanvasElement();
		canvas.gl = f.context([4, 3]);
		canvas.getContext('webgl2');
		canvas.getContext('webgl2');
		const offscreen = new f.realm.OffscreenCanvas();
		offscreen.gl = f.context([2]);
		offscreen.getContext('webgl2');
		const promise = capture.complete();
		assert.deepEqual(f.calls.filter(call => call[0] !== 'getContext').map(call => call[0]), ['fence', 'flush', 'fence', 'flush']);
		assert.throws(() => capture.reset(), /pending/);
		assert.throws(() => capture.begin(), /inactive/);
		await assert.rejects(capture.complete(), /pending/);
		const result = await f.drain(promise);
		assert.equal(result.status, 'complete');
		assert.equal(result.contexts.length, 2);
		assert.deepEqual(result.contexts.map(c => c.method), ['fence', 'fence']);
		assert.equal(result.webgl1Finish, false);
		assert.equal(result.waitMs, 8);
		assert.deepEqual(f.calls.filter(call => call[0] === 'poll').map(call => call.slice(2)), [[0, 0], [0, 0], [0, 0]]);
		assert.equal(f.calls.filter(call => call[0] === 'delete').length, 2);
		assert.match(result.completion, /Not later draws/);
		capture.begin();
		assert.equal((await capture.complete()).status, 'not-observed');
		capture.dispose();
	});

	it('does not infer no WebGL from zero acquisitions; supports explicit reused contexts', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		const canvas = new f.realm.HTMLCanvasElement();
		canvas.gl = f.context();
		canvas.getContext('webgl2'); // Before sample: not retained by the observer.
		capture.begin();
		canvas.getContext('2d'); // Only GL context identifiers are tracked.
		assert.equal((await capture.complete()).status, 'not-observed');
		capture.begin();
		capture.track(canvas.gl);
		assert.equal((await f.drain(capture.complete())).status, 'complete');
		capture.dispose();
	});

	it('reports WebGL1 and lost contexts without finish or fake completion', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		capture.track(f.context([], false), 'experimental-webgl');
		const lost = f.context();
		lost.lost = true;
		capture.track(lost);
		const result = await capture.complete();
		assert.equal(result.status, 'incomplete');
		assert.deepEqual(result.contexts.map(c => c.status), ['unsupported-webgl1', 'context-lost']);
		assert.equal(f.calls.length, 0);
		capture.dispose();
	});

	it('finishes WebGL1 only with explicit opt-in and reports blocking wall time', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		const gl = f.context([], false);
		gl.finish = () => { f.calls.push(['finish']); f.advance(12); };
		capture.track(gl);
		const result = await capture.complete({webgl1Finish: true, timeoutMs: 5});
		assert.equal(result.status, 'complete');
		assert.equal(result.webgl1Finish, true);
		assert.equal(result.contexts[0].method, 'finish');
		assert.equal(result.contexts[0].blockingMs, 12);
		assert.equal(result.contexts[0].waitMs, 12);
		assert.equal(result.waitMs, 12); // A polling deadline cannot interrupt finish().
		assert.deepEqual(f.calls, [['finish']]);
		assert.equal(f.timers.length, 0);
		assert.match(result.methods.finish, /blocks the calling thread/);
		assert.match(result.methods.finish, /timeoutMs cannot interrupt/);
		assert.match(result.methods.fence, /polling add overhead/);
		assert.match(result.overhead, /Trace thread-wall totals include blocking finish waits/);
		assert.match(result.timing, /not GPU execution time/);
		capture.dispose();
	});

	it('submits WebGL2 fences before WebGL1 finish, regardless of acquisition order', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		const legacy = f.context([], false);
		legacy.finish = () => { f.calls.push(['finish']); f.advance(3); };
		capture.track(legacy, 'experimental-webgl');
		capture.track(legacy); // No duplicate finish for the same context.
		capture.track(f.context());
		const promise = capture.complete({webgl1Finish: true});
		assert.deepEqual(f.calls.map(call => call[0]), ['fence', 'flush', 'finish']);
		const result = await f.drain(promise);
		assert.equal(result.status, 'complete');
		assert.deepEqual(result.contexts.map(c => c.method), ['finish', 'fence']);
		assert.equal(result.waitMs, 7);
		assert.equal(result.contexts[0].blockingMs, 3);
		assert.equal(result.contexts[1].blockingMs, undefined);
		capture.dispose();
	});

	for (const when of ['before', 'after', 'throw']) {
		it(`reports WebGL1 loss/failure ${when} finish without fake completion`, async () => {
			const f = fixture();
			const capture = createWebGLCapture(f.realm);
			capture.begin();
			const gl = f.context([], false);
			gl.lost = when === 'before';
			gl.finish = () => {
				f.calls.push(['finish']);
				f.advance(2);
				if (when === 'throw') throw new Error('driver failure');
				gl.lost = true;
			};
			capture.track(gl);
			const result = await capture.complete({webgl1Finish: true});
			assert.equal(result.status, 'incomplete');
			assert.equal(result.contexts[0].method, 'finish');
			assert.equal(result.contexts[0].status, when === 'throw' ? 'finish-error' : 'context-lost');
			assert.equal(f.calls.length, when === 'before' ? 0 : 1);
			assert.equal(result.contexts[0].blockingMs, when === 'before' ? undefined : 2);
			capture.begin();
			assert.equal((await capture.complete()).status, 'not-observed');
			capture.dispose();
		});
	}

	it('never falls back to finish for a failing WebGL2 fence', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		const gl = f.context();
		gl.fenceSync = () => null;
		capture.track(gl, 'webgl2');
		const result = await capture.complete({webgl1Finish: true});
		assert.equal(result.status, 'incomplete');
		assert.equal(result.contexts[0].method, 'fence');
		assert.equal(result.contexts[0].status, 'fence-failed');
		assert.equal(f.calls.length, 0);
		capture.dispose();
	});

	it('queries raw renderer/version once at completion, without hardware classification', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		const gl = f.context([], false);
		Object.assign(gl, {RENDERER: 10, VERSION: 11});
		gl.finish = () => { f.calls.push(['finish']); f.advance(2); };
		gl.getParameter = parameter => {
			f.calls.push(['parameter', parameter]);
			f.advance(1);
			return {10: 'WebKit WebGL', 11: 'WebGL 1.0', 12: 'Raw driver renderer'}[parameter];
		};
		gl.getExtension = name => {
			assert.equal(name, 'WEBGL_debug_renderer_info');
			return {UNMASKED_RENDERER_WEBGL: 12};
		};
		capture.track(gl);
		assert.equal(f.calls.length, 0);
		const result = await capture.complete({webgl1Finish: true});
		assert.equal(result.status, 'complete');
		assert.deepEqual(f.calls, [['finish'], ['parameter', 10], ['parameter', 11], ['parameter', 12]]);
		assert.deepEqual(result.contexts[0].contextInfo, {renderer: 'WebKit WebGL', version: 'WebGL 1.0', unmaskedRenderer: 'Raw driver renderer'});
		assert.equal(result.contexts[0].waitMs, 2);
		assert.equal(result.waitMs, 5); // Batch includes metadata-query overhead.
		assert.match(result.contextInfo, /do not establish hardware acceleration/);
		capture.dispose();
	});

	for (const unavailable of ['extension', 'parameter', 'exception']) {
		it(`keeps completion evidence when metadata is unavailable: ${unavailable}`, async () => {
			const f = fixture();
			const capture = createWebGLCapture(f.realm);
			capture.begin();
			const gl = f.context();
			gl.getParameter = () => {
				if (unavailable === 'parameter') return null;
				if (unavailable === 'exception') throw new Error('query denied');
				return 'raw string';
			};
			gl.getExtension = () => {
				if (unavailable === 'exception') throw new Error('extension denied');
				return null;
			};
			capture.track(gl);
			const result = await f.drain(capture.complete());
			assert.equal(result.status, 'complete');
			assert.equal(result.contexts[0].contextInfo.renderer, unavailable === 'extension' ? 'raw string' : null);
			assert.equal(result.contexts[0].contextInfo.unmaskedRenderer, null);
			capture.dispose();
		});
	}

	for (const status of ['timeout', 'wait-failed', 'wait-error', 'fence-failed', 'fence-error', 'context-lost']) {
		it(`reports ${status} and deletes each created fence`, async () => {
			const f = fixture();
			const capture = createWebGLCapture(f.realm);
			capture.begin();
			const gl = f.context([status === 'wait-failed' ? 5 : 4]);
			if (status === 'wait-error')
				gl.clientWaitSync = () => { throw new Error('wait failed'); };
			if (status === 'fence-failed')
				gl.fenceSync = () => null;
			if (status === 'fence-error')
				gl.flush = () => { throw new Error('flush failed'); };
			capture.track(gl);
			const result = await f.drain(capture.complete({timeoutMs: 10, pollIntervalMs: 4}), () => {
				if (status === 'context-lost') gl.lost = true;
			});
			assert.equal(result.status, 'incomplete');
			assert.equal(result.contexts[0].status, status);
			assert.ok(result.waitMs <= 10);
			assert.equal(f.calls.filter(call => call[0] === 'delete').length, status === 'fence-failed' ? 0 : 1);
			capture.dispose();
		});
	}

	it('uses one deadline for multiple contexts, not a timeout per context', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		capture.track(f.context([4]));
		capture.track(f.context([4]));
		const result = await f.drain(capture.complete({timeoutMs: 9, pollIntervalMs: 4}));
		assert.equal(result.waitMs, 9);
		assert.deepEqual(result.contexts.map(c => c.status), ['timeout', 'timeout']);
		capture.dispose();
	});

	it('marks contexts acquired during polling as not fenced', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		capture.track(f.context());
		const result = await f.drain(capture.complete(), () => capture.track(f.context()));
		assert.equal(result.status, 'incomplete');
		assert.deepEqual(result.contexts.map(c => c.status), ['complete', 'not-fenced']);
		capture.dispose();
	});

	it('detects replaced observers and does not overwrite application wrappers on dispose', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		capture.begin();
		const replacement = () => null;
		f.realm.HTMLCanvasElement.prototype.getContext = replacement;
		const result = await capture.complete();
		assert.equal(result.status, 'incomplete');
		assert.equal(result.coverage.observerIntact, false);
		capture.dispose();
		assert.equal(f.realm.HTMLCanvasElement.prototype.getContext, replacement);
	});

	it('rolls back partial installation when another prototype cannot be wrapped', () => {
		const f = fixture();
		const original = f.realm.HTMLCanvasElement.prototype.getContext;
		Object.defineProperty(f.realm.OffscreenCanvas.prototype, 'getContext', {writable: false, configurable: false});
		assert.throws(() => createWebGLCapture(f.realm), TypeError);
		assert.equal(f.realm.HTMLCanvasElement.prototype.getContext, original);
	});

	it('rejects invalid deadlines without consuming the sample and releases reset samples', async () => {
		const f = fixture();
		const capture = createWebGLCapture(f.realm);
		await assert.rejects(capture.complete(), /active sample/);
		capture.begin();
		capture.track(f.context());
		for (const timeoutMs of [0, -1, NaN, Infinity])
			await assert.rejects(capture.complete({timeoutMs}), /positive and finite/);
		await assert.rejects(capture.complete({pollIntervalMs: 0}), /positive and finite/);
				for (const webgl1Finish of [null, 1, 'true'])
					await assert.rejects(capture.complete({webgl1Finish}), /must be a boolean/);
		capture.reset();
		capture.begin();
		assert.equal((await capture.complete()).status, 'not-observed');
		capture.dispose();
	});
});
