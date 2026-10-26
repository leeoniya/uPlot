import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {describe, it} from 'mocha';
import {browserMouseInput, installBenchmarkMouseInput} from '../../scripts/benchmarks-mouse.mjs';

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function browser(binding) {
	const context = {benchmarkMouseInput: binding};
	runInNewContext(`(${browserMouseInput.toString()})()`, context);
	return context;
}

function pageFixture(send = async () => ({})) {
	const listeners = new Set();
	const calls = [];
	const page = {
		socket: {
			addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
			removeEventListener(type, listener) { assert.equal(type, 'message'); listeners.delete(listener); },
		},
		async send(method, params) { calls.push({method, params}); return send(method, params); },
	};
	const emit = data => { for (const listener of listeners) listener({data: typeof data === 'string' ? data : JSON.stringify(data)}); };
	const request = (payload, executionContextId = 7) => emit({method: 'Runtime.bindingCalled', params: {
		name: 'benchmarkMouseInput', executionContextId, payload: JSON.stringify(payload),
	}});
	return {page, calls, listeners, emit, request};
}

describe('benchmark browser mouse binding', () => {
	it('validates finite coordinates before sending any request', async () => {
		const requests = [];
		const context = browser(payload => requests.push(JSON.parse(payload)));
		for (const [x, y] of [[NaN, 0], [0, Infinity], [-Infinity, 0], ['1', 2], [0, undefined]])
			await assert.rejects(context.benchmarkMoveMouse(x, y), /coordinates must be finite/);
		assert.deepEqual(requests, []);
		const move = context.benchmarkMoveMouse(1.25, 2.5);
		assert.deepEqual(requests, [{id: 1, x: 1.25, y: 2.5}]);
		context.benchmarkMouseAck(1, null);
		await move;
	});

	it('settles only the acknowledged request, tolerates unknown and repeated acknowledgements', async () => {
		const requests = [];
		const context = browser(payload => requests.push(JSON.parse(payload)));
		const settled = [];
		const first = context.benchmarkMoveMouse(10, 20).then(() => settled.push(1));
		const second = context.benchmarkMoveMouse(30, 40).then(() => settled.push(2));
		await flush();
		assert.deepEqual(settled, []);
		context.benchmarkMouseAck(999, null);
		context.benchmarkMouseAck(2, null);
		await second;
		assert.deepEqual(settled, [2]);
		context.benchmarkMouseAck(2, 'late error');
		context.benchmarkMouseAck(1, null);
		await first;
		assert.deepEqual(settled, [2, 1]);
		assert.deepEqual(requests.map(request => request.id), [1, 2]);
	});

	it('propagates dispatch errors and synchronous binding failures without retaining failed requests', async () => {
		const context = browser(() => {});
		const move = context.benchmarkMoveMouse(1, 2);
		const rejection = assert.rejects(move, /CDP rejected input/);
		context.benchmarkMouseAck(1, 'CDP rejected input');
		await rejection;
		context.benchmarkMouseAck(1, null);
		const error = new Error('binding failed');
		context.benchmarkMouseInput = () => { throw error; };
		await assert.rejects(context.benchmarkMoveMouse(3, 4), actual => actual === error);
		context.benchmarkMouseAck(2, null);
		context.benchmarkMouseInput = () => {};
		const next = context.benchmarkMoveMouse(5, 6);
		context.benchmarkMouseAck(3, null);
		await next;
	});
});

describe('benchmark trusted CDP mouse bridge', () => {
	it('installs the binding and executable new-document script, then dispatches before acknowledging', async () => {
		const dispatched = deferred();
		const fake = pageFixture(method => method === 'Input.dispatchMouseEvent' ? dispatched.promise : {});
		const stop = await installBenchmarkMouseInput(fake.page);
		assert.equal(fake.listeners.size, 1);
		assert.deepEqual(fake.calls.map(call => call.method), ['Runtime.addBinding', 'Page.addScriptToEvaluateOnNewDocument']);
		assert.deepEqual(fake.calls[0].params, {name: 'benchmarkMouseInput'});
		const context = {benchmarkMouseInput: payload => fake.request(JSON.parse(payload), 19)};
		runInNewContext(fake.calls[1].params.source, context);
		const move = context.benchmarkMoveMouse(123.5, 456.25);
		await flush();
		assert.deepEqual(fake.calls[2], {method: 'Input.dispatchMouseEvent', params: {
			type: 'mouseMoved', x: 123.5, y: 456.25, button: 'none', buttons: 0, pointerType: 'mouse',
		}});
		assert.equal(fake.calls.length, 3, 'no acknowledgement before CDP dispatch completes');
		dispatched.resolve({});
		await flush();
		assert.equal(fake.calls[3].method, 'Runtime.evaluate');
		assert.equal(fake.calls[3].params.contextId, 19);
		runInNewContext(fake.calls[3].params.expression, context);
		await move;
		stop();
		stop();
		assert.equal(fake.listeners.size, 0);
	});

	it('ignores unrelated events and rejects invalid requests without dispatching input', async () => {
		const fake = pageFixture();
		const stop = await installBenchmarkMouseInput(fake.page);
		fake.emit('{');
		fake.emit({method: 'unrelated'});
		fake.emit({method: 'Runtime.bindingCalled', params: {name: 'other', payload: '{}'}});
		for (const payload of [{id: 1, x: '1', y: 2}, {id: 2, x: 1, y: null}, {id: 3, x: 1},
			{id: 0, x: 1, y: 2}, {id: -1, x: 1, y: 2}, {id: 1.5, x: 1, y: 2}, {id: '4', x: 1, y: 2}, {}])
			fake.request(payload);
		fake.emit({method: 'Runtime.bindingCalled', params: {name: 'benchmarkMouseInput', payload: '{'}});
		await flush();
		assert.equal(fake.calls.filter(call => call.method === 'Input.dispatchMouseEvent').length, 0);
		for (const call of fake.calls.filter(call => call.method === 'Runtime.evaluate'))
			assert.match(call.params.expression, /Invalid benchmark mouse input/);
		stop();
	});

	it('returns safely encoded dispatch errors to the originating browser context', async () => {
		const error = new Error('dispatch failed: "quoted"\nline');
		let context;
		const fake = pageFixture(async (method, params) => {
			if (method === 'Input.dispatchMouseEvent') throw error;
			if (method === 'Runtime.evaluate') {
				assert.equal(params.contextId, 42);
				runInNewContext(params.expression, context);
			}
		});
		const stop = await installBenchmarkMouseInput(fake.page);
		context = browser(payload => fake.request(JSON.parse(payload), 42));
		await assert.rejects(context.benchmarkMoveMouse(1, 2), actual => actual.message === error.message);
		stop();
	});

	it('acknowledges concurrent dispatches by request ID and execution context, not arrival order', async () => {
		const first = deferred(), second = deferred();
		const fake = pageFixture((method, params) => method === 'Input.dispatchMouseEvent' ? (params.x === 1 ? first : second).promise : {});
		const stop = await installBenchmarkMouseInput(fake.page);
		fake.request({id: 11, x: 1, y: 2}, 21);
		fake.request({id: 12, x: 3, y: 4}, 22);
		second.resolve();
		await flush();
		first.resolve();
		await flush();
		assert.deepEqual(fake.calls.filter(call => call.method === 'Runtime.evaluate').map(call => call.params), [
			{contextId: 22, expression: 'globalThis.benchmarkMouseAck(12, null)'},
			{contextId: 21, expression: 'globalThis.benchmarkMouseAck(11, null)'},
		]);
		stop();
	});

	it('removes the listener on either installation failure', async () => {
		for (const method of ['Runtime.addBinding', 'Page.addScriptToEvaluateOnNewDocument']) {
			const error = new Error('install failed');
			const fake = pageFixture(async name => { if (name === method) throw error; });
			await assert.rejects(installBenchmarkMouseInput(fake.page), actual => actual === error);
			assert.equal(fake.listeners.size, 0);
		}
	});

	it('stops new dispatches and suppresses pending acknowledgements after cleanup', async () => {
		const pending = deferred();
		const fake = pageFixture(method => method === 'Input.dispatchMouseEvent' ? pending.promise : {});
		const stop = await installBenchmarkMouseInput(fake.page);
		fake.request({id: 1, x: 1, y: 2});
		stop();
		fake.request({id: 2, x: 3, y: 4});
		pending.resolve();
		await flush();
		assert.equal(fake.calls.filter(call => call.method === 'Input.dispatchMouseEvent').length, 1);
		assert.equal(fake.calls.filter(call => call.method === 'Runtime.evaluate').length, 0);
		assert.equal(fake.listeners.size, 0);
	});

	it('tolerates an acknowledgement failure after navigation', async () => {
		const fake = pageFixture(async method => { if (method === 'Runtime.evaluate') throw new Error('context destroyed'); });
		const stop = await installBenchmarkMouseInput(fake.page);
		fake.request({id: 1, x: 1, y: 2});
		await flush();
		assert.equal(fake.calls.at(-1).method, 'Runtime.evaluate');
		stop();
	});
});
