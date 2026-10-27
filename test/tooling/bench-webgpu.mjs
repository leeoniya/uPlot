import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {createWebGPUCapture} from '../../scripts/bench-webgpu.mjs';

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
}

function device(work = Promise.resolve()) {
	const loss = deferred();
	const listeners = new Set();
	let calls = 0;
	const gpu = {
		lost: loss.promise,
		queue: {onSubmittedWorkDone() {
			assert.equal(this, gpu.queue);
			calls++;
			return typeof work === 'function' ? work() : work;
		}},
		addEventListener(type, listener) { assert.equal(type, 'uncapturederror'); listeners.add(listener); },
		removeEventListener(type, listener) { assert.equal(type, 'uncapturederror'); listeners.delete(listener); },
	};
	return {gpu, loss, listeners, get calls() { return calls; },
		error(message) { for (const listener of listeners) listener({error: new Error(message)}); }};
}

function clock() {
	let now = 0;
	let timer;
	return {
		realm: {
			performance: {now: () => now},
			setTimeout(callback, ms) { timer = {callback, ms}; return 1; },
			clearTimeout() { timer = null; },
		},
		expire() { now += timer.ms; timer.callback(); },
		get active() { return timer != null; },
	};
}

describe('actual-device WebGPU completion', () => {
	it('reports missing devices without probing or requesting GPU resources', async () => {
		const realm = {performance, setTimeout, clearTimeout,
			get navigator() { assert.fail('must not probe GPU availability'); }};
		const report = await createWebGPUCapture(realm).complete();
		assert.equal(report.status, 'not-observed');
		assert.deepEqual(report.devices, []);
	});

	it('fences all unique devices and waits for the last queue, with serializable metadata', async () => {
		const work = deferred();
		const first = device(), second = device(work.promise);
		const time = clock();
		let finished = false;
		const completion = createWebGPUCapture(time.realm).complete([first.gpu, second.gpu, first.gpu])
			.then(report => { finished = true; return report; });
		await Promise.resolve();
		assert.equal(finished, false);
		assert.equal(first.calls, 1);
		assert.equal(second.calls, 1);
		work.resolve();
		const report = await completion;
		assert.equal(report.status, 'complete');
		assert.equal(report.timeoutMs, 1000);
		assert.deepEqual(report.devices.map(({index, method, status}) => ({index, method, status})), [0, 1].map(index =>
			({index, method: 'queue.onSubmittedWorkDone', status: 'complete'})));
		assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
		assert.equal(first.listeners.size + second.listeners.size, 0);
		assert.equal(time.active, false);
		first.loss.resolve({message: 'late loss'});
		second.loss.reject(new Error('late rejected loss'));
		await Promise.resolve();
		assert.equal(report.status, 'complete');
	});

	for (const kind of ['already-lost', 'lost', 'rejected-loss', 'rejected-queue', 'thrown-queue', 'uncaptured-error']) {
		it(`rejects completion evidence on ${kind} and removes all listeners`, async () => {
			const work = deferred();
			const first = device(kind === 'thrown-queue' ? () => { throw new Error(kind); } : work.promise);
			const second = device(new Promise(() => {}));
			if (kind === 'already-lost') first.loss.resolve({reason: 'unknown', message: kind});
			const time = clock();
			const completion = createWebGPUCapture(time.realm).complete([first.gpu, second.gpu]);
			if (kind === 'lost') first.loss.resolve({reason: 'destroyed', message: kind});
			if (kind === 'rejected-loss') first.loss.reject(new Error(kind));
			if (kind === 'rejected-queue') work.reject(new Error(kind));
			if (kind === 'uncaptured-error') first.error(kind);
			const report = await completion;
			assert.equal(report.status, 'incomplete');
			assert.equal(report.devices[0].status, kind.includes('queue') ? 'queue-error' : kind === 'uncaptured-error' ? kind : 'device-lost');
			assert.match(report.devices[0].error, new RegExp(kind));
			assert.equal(report.devices[1].status, 'not-completed');
			assert.equal(second.calls, 1, 'fence every device even when another fails');
			assert.equal(first.listeners.size + second.listeners.size, 0);
			assert.equal(time.active, false);
			const saved = JSON.stringify(report);
			if (kind !== 'thrown-queue')
				work.reject(new Error('late queue failure'));
			second.loss.resolve({message: 'late loss'});
			await Promise.resolve();
			assert.equal(JSON.stringify(report), saved);
		});
	}

	it('does not let successful queues overwrite already-observed loss or errors', async () => {
		for (const failure of ['loss', 'error']) {
			const actual = device();
			if (failure === 'loss') actual.loss.resolve({message: 'lost'});
			const completion = createWebGPUCapture().complete([actual.gpu]);
			if (failure === 'error') actual.error('failed');
			assert.equal((await completion).status, 'incomplete');
			assert.equal(actual.listeners.size, 0);
		}
	});

	it('bounds a stalled queue and isolates late callbacks from subsequent samples', async () => {
		const time = clock(), work = deferred(), actual = device(work.promise);
		const capture = createWebGPUCapture(time.realm);
		const completion = capture.complete([actual.gpu], {timeoutMs: 17});
		time.expire();
		const report = await completion;
		assert.equal(report.status, 'incomplete');
		assert.equal(report.devices[0].status, 'timeout');
		assert.equal(report.waitMs, 17);
		assert.equal(actual.listeners.size, 0);
		assert.equal(time.active, false);
		const next = device();
		const success = capture.complete([next.gpu]);
		work.reject(new Error('late failure'));
		actual.loss.resolve({message: 'late loss'});
		assert.equal((await success).status, 'complete');
		assert.equal(next.listeners.size, 0);
		assert.equal(report.devices[0].status, 'timeout');
	});

	it('rejects invalid device/queue contracts rather than inventing completion evidence', async () => {
		for (const actual of [null, {}, {queue: {}}, device(() => undefined).gpu]) {
			const report = await createWebGPUCapture().complete([actual]);
			assert.equal(report.status, 'incomplete');
			assert.match(report.devices[0].status, /invalid-device|queue-error/);
		}
		for (const timeoutMs of [0, -1, NaN, Infinity])
			await assert.rejects(createWebGPUCapture().complete([], {timeoutMs}), /positive and finite/);
	});

	it('installs the helper before navigation only for trace/memory capture, not rAF', async () => {
		const source = readFileSync(new URL('../../scripts/benchmarks-trace.mjs', import.meta.url), 'utf8');
		const start = source.indexOf('if (!raf)');
		const end = source.indexOf('if (sciChartOptions)', start);
		assert.ok(start >= 0 && end > start);
		for (const raf of [false, true]) {
			const calls = [];
			await runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
				raf, page: {async send(method, params) { calls.push({method, params}); }},
				createWebGPUCapture, createWebGLCapture: () => ({}),
			});
			assert.equal(calls.length, raf ? 0 : 1);
			if (!raf) {
				assert.equal(calls[0].method, 'Page.addScriptToEvaluateOnNewDocument');
				const realm = {performance, setTimeout, clearTimeout};
				runInNewContext(calls[0].params.source, realm);
				const actual = device();
				assert.equal((await realm.benchmarkWebGPU.complete([actual.gpu])).status, 'complete');
				assert.equal(actual.calls, 1);
				assert.equal(actual.listeners.size, 0);
			}
		}
	});

	it('can be injected with toString without imports or GPU access', async () => {
		const capture = runInNewContext(`(${createWebGPUCapture.toString()})()`, {performance, setTimeout, clearTimeout});
		const actual = device();
		assert.equal((await capture.complete([actual.gpu])).status, 'complete');
		assert.equal(actual.listeners.size, 0);
	});
});
