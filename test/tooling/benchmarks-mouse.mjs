import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {setImmediate, setTimeout as nativeSetTimeout} from 'node:timers';
import {describe, it} from 'node:test';
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

const targets = () => Array.from({length: 10}, (_, i) => ({x: i + 0.25, y: i + 20.5}));
const batch = () => ({id: 1, targets: targets(), intervalMs: 50});
const inputs = fake => fake.calls.filter(call => call.method === 'Input.dispatchMouseEvent');
const acks = fake => fake.calls.filter(call => call.method === 'Runtime.evaluate');

function timers() {
	let now = 0;
	let serial = 0;
	const pending = new Map();
	const waits = [];
	return {
		pending, waits,
		now: () => now,
		fireNext() {
			const [id, timer] = pending.entries().next().value;
			pending.delete(id);
			timer.callback();
		},
		setTimeout(callback, ms) {
			waits.push({at: now, ms});
			const id = ++serial;
			pending.set(id, {at: now + ms, callback});
			return id;
		},
		clearTimeout(id) { pending.delete(id); },
		advance(ms) {
			now += ms;
			for (const [id, timer] of pending) {
				if (timer.at <= now) {
					pending.delete(id);
					timer.callback();
				}
			}
		},
	};
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

describe('benchmark browser mouse batch binding', () => {
	it('copies only x/y once, sends one request, and shares IDs and pending acknowledgements with single moves', async () => {
		const requests = [];
		const context = browser(payload => requests.push(JSON.parse(payload)));
		let hovering = false;
		const reads = [];
		const points = targets().map((target, i) => new Proxy(target, {
			get(object, key) {
				assert.equal(hovering, false, 'no target reads during hover');
				assert.ok(key === 'x' || key === 'y', `unexpected target property: ${String(key)}`);
				reads.push([i, key]);
				return object[key];
			},
			ownKeys() { assert.fail('must not enumerate target metadata'); },
		}));
		const parked = context.benchmarkMoveMouse(1, 2);
		let settled = false;
		const moved = context.benchmarkMoveMouseBatch(points).then(() => { settled = true; });
		hovering = true;
		assert.deepEqual(requests, [{id: 1, x: 1, y: 2}, {...batch(), id: 2}]);
		assert.deepEqual(reads, targets().flatMap((_, i) => [[i, 'x'], [i, 'y']]));
		context.benchmarkMouseAck(1, null);
		await parked;
		assert.equal(settled, false);
		context.benchmarkMouseAck(999, null);
		context.benchmarkMouseAck(2, null);
		await moved;
		context.benchmarkMouseAck(2, 'late error');
	});

	it('validates the complete batch before sending and does not consume IDs on validation errors', async () => {
		const requests = [];
		const context = browser(payload => requests.push(JSON.parse(payload)));
		for (const invalid of [null, {}, [], targets().slice(1), [...targets(), {x: 1, y: 2}], Array(10),
			...[[NaN, 1], [1, Infinity], ['1', 2], [1, undefined]].map(([x, y]) => [...targets().slice(0, 9), {x, y}]),
			[...targets().slice(0, 9), null]])
			await assert.rejects(context.benchmarkMoveMouseBatch(invalid), /exactly 10|coordinates must be finite/);
		assert.deepEqual(requests, []);
		const moved = context.benchmarkMoveMouseBatch(targets());
		assert.deepEqual(requests, [batch()]);
		context.benchmarkMouseAck(1, null);
		await moved;
	});

	it('rejects binding and batch errors, then accepts subsequent requests', async () => {
		const context = browser(() => { throw new Error('binding failed'); });
		await assert.rejects(context.benchmarkMoveMouseBatch(targets()), /binding failed/);
		context.benchmarkMouseAck(1, null);
		context.benchmarkMouseInput = () => {};
		const moved = context.benchmarkMoveMouseBatch(targets());
		const rejected = assert.rejects(moved, /partial dispatch failure/);
		context.benchmarkMouseAck(2, 'partial dispatch failure');
		await rejected;
		const single = context.benchmarkMoveMouse(1, 2);
		context.benchmarkMouseAck(3, null);
		await single;
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

	it('runs exactly ten trusted moves with nine full Node waits after slow CDP acknowledgements and one final ack', async () => {
		const clock = timers();
		const dispatches = [];
		let context;
		const fake = pageFixture((method, params) => {
			if (method === 'Input.dispatchMouseEvent') {
				const pending = deferred();
				dispatches.push(pending);
				return pending.promise;
			}
			if (method === 'Runtime.evaluate') runInNewContext(params.expression, context);
		});
		const stop = await installBenchmarkMouseInput(fake.page, clock);
		let requests = 0;
		context = browser(payload => { requests++; fake.request(JSON.parse(payload), 42); });
		let hovering = false;
		const points = targets().map(target => new Proxy(target, {
			get(object, key) {
				assert.equal(hovering, false, 'no validation reads during dispatch');
				assert.ok(key === 'x' || key === 'y');
				return object[key];
			},
		}));
		const moved = context.benchmarkMoveMouseBatch(points);
		hovering = true;
		for (let i = 0; i < 10; i++) {
			await flush();
			assert.equal(inputs(fake).length, i + 1);
			assert.equal(acks(fake).length, 0);
			assert.equal(clock.pending.size, 0, 'wait cannot start before CDP acknowledges');
			clock.advance(125);
			await flush();
			assert.equal(inputs(fake).length, i + 1, 'slow dispatch must not overlap the next move');
			dispatches[i].resolve();
			await flush();
			if (i < 9) {
				assert.deepEqual(clock.waits[i], {at: i * 175 + 125, ms: 50});
				assert.equal(clock.pending.size, 1);
				clock.advance(49);
				await flush();
				assert.equal(inputs(fake).length, i + 1, 'no catchup after slow dispatch');
				clock.advance(1);
			}
		}
		await moved;
		assert.equal(requests, 1);
		assert.deepEqual(inputs(fake).map(call => call.params), targets().map(({x, y}) => ({
			type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse',
		})));
		assert.deepEqual(acks(fake).map(call => call.params), [{contextId: 42, expression: 'globalThis.benchmarkMouseAck(1, null)'}]);
		assert.equal(clock.waits.length, 9);
		assert.equal(clock.pending.size, 0, 'no final wait');
		stop();
	});

	it('re-arms early timers until the full deadline, without catchup after late timers or slow acknowledgements', async () => {
		const clock = timers();
		const dispatches = [];
		const fake = pageFixture(method => {
			if (method === 'Input.dispatchMouseEvent') {
				const pending = deferred();
				dispatches.push(pending);
				return pending.promise;
			}
		});
		const stop = await installBenchmarkMouseInput(fake.page, clock);
		try {
			fake.request(batch());
			dispatches[0].resolve();
			await flush();
			clock.advance(49.25);
			clock.fireNext();
			await flush();
			assert.equal(inputs(fake).length, 1);
			assert.deepEqual(clock.waits.at(-1), {at: 49.25, ms: 1}, 'ceil the remaining 0.75 ms');
			clock.advance(0.5);
			clock.fireNext();
			await flush();
			assert.equal(inputs(fake).length, 1, 'recheck even a re-armed timer');
			assert.deepEqual(clock.waits.at(-1), {at: 49.75, ms: 1});
			clock.advance(0.25);
			clock.fireNext();
			await flush();
			assert.equal(inputs(fake).length, 2, 'dispatch at the full 50 ms deadline');
			assert.equal(clock.pending.size, 0);

			clock.advance(125);
			dispatches[1].resolve();
			await flush();
			assert.deepEqual(clock.waits.at(-1), {at: 175, ms: 50}, 'new deadline starts after the slow ack');
			clock.advance(80);
			await flush();
			assert.equal(inputs(fake).length, 3, 'late timer dispatches only the next move');
			dispatches[2].resolve();
			await flush();
			assert.deepEqual(clock.waits.at(-1), {at: 255, ms: 50}, 'late timer does not shorten the next wait');
			clock.advance(49);
			await flush();
			assert.equal(inputs(fake).length, 3);
			clock.advance(1);
			await flush();
			assert.equal(inputs(fake).length, 4);
			assert.equal(acks(fake).length, 0);
		}
		finally {
			stop();
			for (const pending of dispatches) pending.resolve();
			await flush();
		}
	});

	it('cancels the currently re-armed timer on cleanup or context loss', async () => {
		for (const navigation of [false, true]) {
			const clock = timers();
			const fake = pageFixture();
			const stop = await installBenchmarkMouseInput(fake.page, clock);
			try {
				fake.request(batch());
				await flush();
				clock.advance(49.25);
				clock.fireNext();
				assert.equal(clock.pending.size, 1);
				assert.equal(clock.waits.length, 2);
				if (navigation) fake.emit({method: 'Runtime.executionContextsCleared'});
				else stop();
				assert.equal(clock.pending.size, 0);
				clock.advance(1000);
				await flush();
				assert.equal(inputs(fake).length, 1);
				assert.equal(acks(fake).length, 0);
			}
			finally { stop(); }
		}
	});

	it('rejects bad batch payloads once and validates the last target before any input', async () => {
		const clock = timers();
		const fake = pageFixture();
		const stop = await installBenchmarkMouseInput(fake.page, clock);
		const invalid = [
			{targets: null}, {targets: {}}, {targets: []}, {targets: targets().slice(1)},
			{targets: [...targets(), {x: 1, y: 2}]},
			...[[null, 1], [1, null], ['1', 2], [1, undefined]].map(([x, y]) => ({targets: [...targets().slice(0, 9), {x, y}]})),
			{targets: [...targets().slice(0, 9), null]}, {targets: [...targets().slice(0, 9), {}]},
			...[undefined, null, 0, 49, 51, '50'].map(intervalMs => ({intervalMs})),
		];
		for (let i = 0; i < invalid.length; i++) fake.request({...batch(), ...invalid[i], id: i + 1});
		await flush();
		assert.equal(inputs(fake).length, 0);
		assert.equal(clock.waits.length, 0);
		assert.equal(acks(fake).length, invalid.length);
		for (let i = 0; i < invalid.length; i++)
			assert.equal(acks(fake)[i].params.expression, `globalThis.benchmarkMouseAck(${i + 1}, "Invalid benchmark mouse input.")`);
		stop();
	});

	it('stops at a partial dispatch failure and returns only one rejection ack', async () => {
		for (const failure of [new Error('third move failed'), null]) {
			const clock = timers();
			let count = 0;
			let context;
			const fake = pageFixture((method, params) => {
				if (method === 'Input.dispatchMouseEvent' && ++count === 3) throw failure;
				if (method === 'Runtime.evaluate') runInNewContext(params.expression, context);
			});
			const stop = await installBenchmarkMouseInput(fake.page, clock);
			context = browser(payload => fake.request(JSON.parse(payload)));
			const rejected = assert.rejects(context.benchmarkMoveMouseBatch(targets()), error => error.message === (failure?.message ?? 'null'));
			await flush();
			clock.advance(50);
			await flush();
			clock.advance(50);
			await rejected;
			clock.advance(1000);
			await flush();
			assert.equal(inputs(fake).length, 3);
			assert.equal(acks(fake).length, 1);
			assert.equal(clock.waits.length, 2);
			assert.equal(clock.pending.size, 0);
			stop();
		}
	});

	it('cancels sleeping and pending batches on cleanup or context loss, including late CDP failures', async () => {
		const unhandled = [];
		const onUnhandled = error => unhandled.push(error);
		process.on('unhandledRejection', onUnhandled);
		try {
			for (const event of [null, {method: 'Runtime.executionContextDestroyed', params: {executionContextId: 7}},
				{method: 'Runtime.executionContextsCleared'}, {method: 'Page.frameNavigated', params: {frame: {id: 'main'}}}]) {
				for (const phase of ['sleeping', 'pending success', 'pending failure']) {
					const clock = timers();
					const pending = deferred();
					const fake = pageFixture(method => method === 'Input.dispatchMouseEvent' ? pending.promise : {});
					const stop = await installBenchmarkMouseInput(fake.page, clock);
					fake.request(batch());
					if (phase === 'sleeping') pending.resolve();
					await flush();
					assert.equal(clock.pending.size, phase === 'sleeping' ? 1 : 0);
					if (event) fake.emit(event);
					else { stop(); stop(); fake.request(batch()); }
					assert.equal(clock.pending.size, 0, 'cancellation clears the Node timer');
					if (phase === 'pending failure') pending.reject(new Error('late CDP failure'));
					else pending.resolve();
					clock.advance(1000);
					await flush();
					assert.equal(inputs(fake).length, 1);
					assert.equal(acks(fake).length, 0, 'no post-cancellation ack');
					stop();
					assert.equal(fake.listeners.size, 0);
				}
			}
			assert.deepEqual(unhandled, []);
		}
		finally { process.removeListener('unhandledRejection', onUnhandled); }
	});

	it('handles a failed final batch acknowledgement without retries or unhandled rejections', async () => {
		for (const synchronous of [false, true]) {
			const clock = timers();
			const fake = pageFixture();
			const send = fake.page.send;
			fake.page.send = (method, params) => {
				const result = send(method, params);
				if (method !== 'Runtime.evaluate') return result;
				if (synchronous) throw new Error('context destroyed');
				return Promise.reject(new Error('context destroyed'));
			};
			const stop = await installBenchmarkMouseInput(fake.page, clock);
			fake.request(batch());
			await flush();
			for (let i = 0; i < 9; i++) {
				clock.advance(50);
				await flush();
			}
			assert.equal(inputs(fake).length, 10);
			assert.equal(acks(fake).length, 1);
			assert.equal(clock.pending.size, 0);
			stop();
		}
	});

	it('isolates destroyed contexts and permits requests from a new document', async () => {
		const clock = timers();
		const fake = pageFixture();
		const stop = await installBenchmarkMouseInput(fake.page, clock);
		fake.request(batch(), 7);
		fake.request({...batch(), id: 2}, 8);
		await flush();
		assert.equal(clock.pending.size, 2);
		fake.emit({method: 'Runtime.executionContextDestroyed', params: {executionContextId: 7}});
		assert.equal(clock.pending.size, 1);
		clock.advance(50);
		await flush();
		assert.equal(inputs(fake).length, 3);
		fake.emit({method: 'Runtime.executionContextsCleared'});
		assert.equal(clock.pending.size, 0);
		fake.request({id: 1, x: 99, y: 100}, 9);
		await flush();
		assert.deepEqual(acks(fake).map(call => call.params), [{contextId: 9, expression: 'globalThis.benchmarkMouseAck(1, null)'}]);
		stop();
	});

	it('uses native Node timers without renderer timers or global AbortSignal', async () => {
		const fake = pageFixture();
		const stop = await installBenchmarkMouseInput(fake.page);
		const originalTimeout = globalThis.setTimeout;
		const originalSignal = globalThis.AbortSignal;
		try {
			globalThis.setTimeout = () => { throw new Error('renderer timer used'); };
			globalThis.AbortSignal = class { static timeout() { throw new Error('global AbortSignal used'); } };
			fake.request(batch());
			await new Promise(resolve => nativeSetTimeout(resolve, 75));
			assert.ok(inputs(fake).length >= 2);
			assert.equal(acks(fake).length, 0);
		}
		finally {
			stop();
			globalThis.setTimeout = originalTimeout;
			globalThis.AbortSignal = originalSignal;
		}
		await flush();
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
