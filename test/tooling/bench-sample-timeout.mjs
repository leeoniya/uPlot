import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { SAMPLE_TIMEOUT_MS, createSampleWatchdog, abortable } from '../../scripts/bench-sample-timeout.mjs';

function timers() {
	const pending = new Map();
	const cleared = [];
	return {
		pending, cleared,
		setTimer(callback, ms) {
			const token = {};
			pending.set(token, {callback, ms});
			return token;
		},
		clearTimer(token) {
			cleared.push(token);
			pending.delete(token);
		},
		fire() {
			const [token, {callback}] = pending.entries().next().value;
			pending.delete(token);
			callback();
		},
	};
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
}

describe('sample timeout helper', () => {
	it('defaults to 5 seconds, aborts before the callback, and reports the exact timeout error once', () => {
		assert.equal(SAMPLE_TIMEOUT_MS, 5000);
		const clock = timers();
		const calls = [];
		const watchdog = createSampleWatchdog(error => {
			assert.equal(signal.aborted, true);
			assert.equal(signal.reason, error);
			calls.push(error);
		}, clock);
		const signal = watchdog.start('uplot');
		const [{callback, ms}] = clock.pending.values();
		assert.equal(ms, 5000);
		assert.equal(signal.aborted, false);
		clock.fire();
		callback();
		assert.equal(calls.length, 1);
		assert.ok(calls[0] instanceof Error);
		assert.equal(calls[0].message, 'uplot: timed out after 5s');
		assert.equal(calls[0].code, 'BENCHMARK_SAMPLE_TIMEOUT');
		assert.equal(calls[0].variant, 'uplot');
		assert.equal(calls[0].timeoutMs, 5000);
		assert.throws(() => watchdog.start('other'), /already active/);
		watchdog.stop();
	});

	it('rejects overlapping starts, clears on stop, and gives each sample a fresh signal and full budget', () => {
		const clock = timers();
		const calls = [];
		const watchdog = createSampleWatchdog(error => calls.push(error), {...clock, timeoutMs: 25});
		const first = watchdog.start('warmup');
		const [token, {callback}] = clock.pending.entries().next().value;
		assert.throws(() => watchdog.start('overlap'), /already active/);
		watchdog.stop();
		assert.ok(clock.cleared.includes(token));
		assert.equal(clock.pending.size, 0);
		const second = watchdog.start('measured');
		callback();
		assert.equal(first.aborted, false);
		assert.equal(second.aborted, false);
		assert.notEqual(first, second);
		assert.equal([...clock.pending.values()][0].ms, 25);
		clock.fire();
		assert.equal(calls.length, 1);
		assert.equal(second.reason.message, 'measured: timed out after 0.025s');
		watchdog.stop();
		watchdog.stop();
	});

	for (const behavior of ['throw', 'reject', 'stall']) {
		it(`keeps the timeout error when its callback can ${behavior}`, async () => {
			const clock = timers();
			const unhandled = [];
			const listener = error => unhandled.push(error);
			process.on('unhandledRejection', listener);
			try {
				let called = false;
				const watchdog = createSampleWatchdog(() => {
					called = true;
					if (behavior === 'throw') throw new Error('callback');
					if (behavior === 'reject') return Promise.reject(new Error('callback'));
					return new Promise(() => {});
				}, clock);
				const signal = watchdog.start('chartjs');
				const result = abortable(() => new Promise(() => {}), signal);
				clock.fire();
				assert.equal(called, true, 'callback runs in the timer, before promise continuations');
				await assert.rejects(result, error => error === signal.reason && error.code === 'BENCHMARK_SAMPLE_TIMEOUT');
				watchdog.stop();
				await nextTurn();
				assert.deepEqual(unhandled, []);
			}
			finally {
				process.removeListener('unhandledRejection', listener);
			}
		});
	}

	it('validates timeout and callback options', () => {
		for (const timeoutMs of [0, -1, NaN, Infinity, '5000'])
			assert.throws(() => createSampleWatchdog(() => {}, {timeoutMs}), /positive and finite/);
		assert.throws(() => createSampleWatchdog(null), /must be a function/);
	});
});

// Observe explicit cleanup without relying on Node's EventTarget internals: the
// shared tooling process can install HappyDOM's AbortController.
function observableController() {
	const controller = new AbortController();
	const {signal} = controller;
	const listeners = new Set();
	const add = signal.addEventListener.bind(signal);
	const remove = signal.removeEventListener.bind(signal);
	signal.addEventListener = (type, listener, options) => {
		assert.equal(type, 'abort');
		add(type, listener, options);
		listeners.add(listener);
	};
	signal.removeEventListener = (type, listener, options) => {
		assert.equal(type, 'abort');
		remove(type, listener, options);
		listeners.delete(listener);
	};
	return {signal, listeners, abort: reason => controller.abort(reason)};
}

describe('abortable', () => {
	it('does not call the operation when the signal is already aborted', async () => {
		const controller = observableController();
		const reason = new Error('aborted');
		controller.abort(reason);
		await assert.rejects(abortable(() => assert.fail('must not run'), controller.signal), error => error === reason);
		assert.equal(controller.listeners.size, 0);
	});

	for (const outcome of ['value', 'resolve', 'reject', 'throw']) {
		it(`preserves operation ${outcome} and removes its listener`, async () => {
			const controller = observableController();
			const error = new Error('operation');
			const result = abortable(() => {
				if (outcome === 'throw') throw error;
				if (outcome === 'reject') return Promise.reject(error);
				return outcome === 'resolve' ? Promise.resolve(42) : 42;
			}, controller.signal);
			if (outcome === 'throw' || outcome === 'reject')
				await assert.rejects(result, value => value === error);
			else
				assert.equal(await result, 42);
			assert.equal(controller.listeners.size, 0);
		});
	}

	for (const late of ['resolve', 'reject']) {
		it(`rejects a stalled operation on abort and handles its late ${late}`, async () => {
			const controller = observableController();
			const pending = deferred();
			const error = new Error('timeout');
			const unhandled = [];
			const listener = value => unhandled.push(value);
			process.on('unhandledRejection', listener);
			try {
				const result = abortable(() => pending.promise, controller.signal);
				assert.equal(controller.listeners.size, 1);
				controller.abort(error);
				await assert.rejects(result, value => value === error);
				assert.equal(controller.listeners.size, 0);
				pending[late](new Error('late'));
				await nextTurn();
				assert.deepEqual(unhandled, []);
			}
			finally {
				process.removeListener('unhandledRejection', listener);
			}
		});
	}

	it('preserves an abort triggered inside an operation that then throws', async () => {
		const controller = observableController();
		const error = new Error('timeout');
		await assert.rejects(abortable(() => {
			controller.abort(error);
			throw new Error('secondary');
		}, controller.signal), value => value === error);
		assert.equal(controller.listeners.size, 0);
	});
});
