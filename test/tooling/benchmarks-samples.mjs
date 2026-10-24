import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { Window } from 'happy-dom';
import { captureBenchmarkSamples } from '../../scripts/benchmarks-samples.mjs';
import { createWebGPUCapture } from '../../scripts/bench-webgpu.mjs';
import { destroyChart as destroyChartGPU } from '../../bench/chartgpu.mjs';
import { destroyChart as destroyDeckGL } from '../../bench/deckgl.mjs';
import { SAMPLE_TIMEOUT_MS, createSampleWatchdog, abortable } from '../../scripts/bench-sample-timeout.mjs';
import { summarizeProcessMemory } from '../../scripts/analyze-benchmarks-process-memory.mjs';
import { demoDependencies, benchmarkVariants, demoRestrictions, benchmarkRestrictions, assertBenchmarkAvailable } from '../../bench/demo-dependencies.mjs';

import {smallLifecycleData} from '../../bench/lifecycle-data.mjs';

const allVariants = Object.keys(demoDependencies);
const demoVariants = allVariants.filter(id => id !== 'idle');

const browserSource = readFileSync(new URL('../../scripts/benchmarks-trace-browser.mjs', import.meta.url), 'utf8');
const collectorSource = readFileSync(new URL('../../scripts/benchmarks-samples.mjs', import.meta.url), 'utf8');
const gc = 'HeapProfiler.collectGarbage';
const memory = () => {
	const metrics = {rssMB: 20, pssMB: 15, privateMB: 10, swapMB: 0, swapPssMB: 0};
	return {complete: true, renderer: {...metrics}, tree: {...metrics}, issues: []};
};
const timing = (variant, id, dpr) => ({id, dpr, effectiveDpr: dpr, variant, dataPrepMs: 3, jsMs: 7, prepAndInitMs: 10, windowMs: 107});

function signal() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return {promise, resolve};
}

async function waitFor(promise) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Test signal timed out')), 1000); }),
		]);
	}
	finally {
		clearTimeout(timer);
	}
}

function fixture(options = {}) {
	const events = [];
	const config = {variants: ['uplot'], dpr: 1, warmups: 0, rounds: 1, ...options.config};
	let activeReads = 0;
	let activeOperation = null;
	let reads = 0;
	let current;
	const api = {
		begin() {
			events.push({method: 'begin'});
			return {captureId: 'capture-id', env: {actualDPR: config.dpr}, config, markerPattern: 'benchmark:<id>:start|js-end|end', limitations: ['fixture limitation']};
		},
	};
	for (const method of ['setup', 'prepare', 'construct', 'destroy']) {
		api[method] = async (variant, id) => {
			if (method === 'destroy')
				assert.equal(activeReads, 0, 'process reads must drain before destroy');
			if (method === 'setup')
				current = timing(variant, id, config.dpr);
			if (method === 'prepare' && config.lifecycle)
				current = {...current, id, operation: variant};
			events.push({method, variant, id});
			activeOperation = method;
			try {
				await options.operation?.(method);
				return method === 'construct' ? current : undefined;
			}
			finally {
				activeOperation = null;
				events.push({method: `${method}:end`});
			}
		};
	}
	const page = {
		async send(method) {
			assert.equal(method, gc, 'only checkpoint GC commands are allowed');
			assert.equal(activeReads, 0, 'reads must drain before GC');
			assert.equal(activeOperation, null, 'no GC during lifecycle operations');
			events.push({method});
			await options.gc?.();
			return {};
		},
	};
	const evaluate = async (target, expression) => {
		assert.equal(target, page);
		const value = await runInNewContext(expression, {benchmarkLifecycle: api});
		if (!expression.includes('.begin(') && !expression.includes('.construct('))
			assert.equal(value, undefined, 'no fixture objects returned from setup, prepare, or destroy');
		return structuredClone(value);
	};
	const processRead = async () => {
		assert.equal(activeReads, 0, 'process reads must be serial');
		activeReads++;
		events.push({method: 'read', activeOperation, at: performance.now()});
		try {
			return await options.read?.(++reads, activeOperation) ?? memory();
		}
		finally {
			activeReads--;
			events.push({method: 'read:end', activeOperation, at: performance.now()});
		}
	};
	return {
		events, page, evaluate,
		capture: (captureOptions = {}) => (options.collector ?? captureBenchmarkSamples)(page, evaluate, {
			...(options.memory ? {processRead} : {}), ...captureOptions,
		}),
	};
}

async function assertSettled(fake, assertion) {
	const unhandled = [];
	const listener = error => unhandled.push(error);
	process.on('unhandledRejection', listener);
	try {
		await assertion();
		const count = fake.events.length;
		await delay(30);
		assert.equal(fake.events.length, count, 'no background operations remain');
		assert.deepEqual(unhandled, []);
	}
	finally {
		process.removeListener('unhandledRejection', listener);
	}
}

// Run the collector with a manual clock, without adding timer injection to its public API.
function collectorClock() {
	let now = 0;
	let nextId = 0;
	const timers = new Map();
	const setTimer = (callback, ms) => {
		const id = ++nextId;
		timers.set(id, {callback, at: now + ms});
		return id;
	};
	const clearTimer = id => timers.delete(id);
	const context = {
		performance, SAMPLE_TIMEOUT_MS, abortable,
		setTimeout: setTimer, clearTimeout: clearTimer,
		createSampleWatchdog: (callback, options) => createSampleWatchdog(callback, {...options, setTimer, clearTimer}),
	};
	runInNewContext(collectorSource.replace(/^import .*\n/gm, '').replace('export async function', 'async function') + '\nglobalThis.capture = captureBenchmarkSamples;', context);
	return {
		capture: context.capture, timers,
		advance(ms) {
			const end = now + ms;
			while (true) {
				const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!next || next[1].at > end)
					break;
				const [id, {callback, at}] = next;
				timers.delete(id);
				now = at;
				callback();
			}
			now = end;
		},
	};
}

// Execute the actual lifecycle and report code with deterministic browser primitives.
function browserFixture(options = {}) {
	let clock = 0;
	const events = [];
	const marks = [];
	const context = {
		VARIANTS: options.variants ?? ['uplot', 'chartjs', 'idle'], ALL_VARIANTS: allVariants,
				benchmarkWebGL: options.webgl,
						benchmarkWebGPU: options.webgpu,
		WARMUPS: 3, ROUNDS: 7, dpr: 2, WIDTH: 1920, HEIGHT: 600, VIEWPORT_HEIGHT: 900, IDLE_MS: 200, ROWS: 55550,
		packed: [7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free', 10, 50, 2, 3, 4, 25, 75,
			11, 40, 2, 4, 4, 30, 70, 12, 30, 2, 5, 4, 35, 65],
		crypto: {randomUUID: () => 'browser-capture'},
		performance: {
			now: () => clock,
			mark(name) {
				const mark = {name, startTime: clock};
				marks.push(mark);
				events.push(name);
				return mark;
			},
		},
		console: {time() {}, timeEnd() {}},
		environment: () => ({actualDPR: 2}),
		checkPage: () => events.push('checkPage'),
		setup: () => { events.push('setup'); return {host: true}; },
		prepFor: () => {
			clock += 50; // Selecting prepData must not be timed.
			return packed => {
				assert.ok(packed === null || packed === context.smallPacked || packed === context.packed);
				options.prepData?.(packed);
				events.push('prepData');
				clock += 3;
				return {input: true};
			};
		},
		validateInput: sample => {
			assert.ok(sample.input);
			events.push('validateInput');
			clock += 1000;
			options.validateInput?.();
		},
		construct: async sample => {
			events.push('construct');
			sample.chart ??= {chart: true};
			clock += 5;
			options.construct?.(sample);
			await context.finishMicrotask();
		},
		finishMicrotask: async () => { events.push('microtask'); clock += 2; },
		settle: async () => { events.push('settle'); clock += 100; await options.settle?.(); },
		nextFrame: async () => { clock += 16; return clock; },
		setTimeout: resolve => { clock += 200; resolve(); },
		validateChart: sample => {
			assert.ok(sample.chart);
			events.push('validateChart');
			clock += 1000;
			return 2;
		},
		teardown: sample => {
			events.push('teardown');
			assert.ok(sample.host);
			options.teardown?.();
		},
	};
	context.smallPacked = smallLifecycleData(context.packed);
	runInNewContext(browserSource.slice(browserSource.indexOf('let invoked = null;')), context);
	return {api: context.benchmarkLifecycle, runTrace: context.runBenchmarkTrace, context, events, marks,
			advance: ms => { clock += ms; }};
}

function deckGLFixture(dpr = 2) {
	const events = [];
	const element = {isConnected: true, remove() { this.isConnected = false; events.push('element-remove'); }};
	const canvas = {
		width: Math.round(1770 * dpr), height: Math.round(500 * dpr), style: {width: '1770px', height: '500px'},
		getContext() { assert.fail('no context creation or pixels'); },
		getBoundingClientRect() { assert.fail('no layout'); },
		get clientWidth() { assert.fail('no layout'); }, get clientHeight() { assert.fail('no layout'); },
	};
	const context = {
		lost: false, isContextLost() { return this.lost; },
		getError() { assert.fail('no GL readback'); }, readPixels() { assert.fail('no pixels'); },
		getExtension(name) {
			assert.equal(name, 'WEBGL_lose_context');
			return {loseContext() { context.lost = true; events.push('lose-context'); }};
		},
	};
	const layers = Array.from({length: 3}, () => ({props: {positionFormat: 'XY', data: [new Float64Array(55550 * 2)]}}));
	const deck = {isInitialized: true, props: {layers}, finalize() { this.isInitialized = false; events.push('finalize'); }};
	const chart = {
		deck, context, element, destroyed: false, error: null,
		canvas: {node: () => canvas, on() { events.push('canvas-listeners'); }},
		svg: {node: () => ({}), on() { events.push('svg-listeners'); }},
		getWebGLContexts() { return this.context && !this.context.isContextLost() ? [this.context] : []; },
	};
	const host = {
		querySelector: () => canvas, querySelectorAll: () => [canvas],
		replaceChildren() { events.push('clear'); }, remove() { events.push('remove'); },
	};
	return {sample: {variant: 'deckgl', chart, host}, chart, canvas, context, deck, layers, element, events};
}

describe('shared browser sample lifecycle', () => {
	it('prepares the original full fixture once per session after a separate small input', async () => {
		const inputs = [], charts = [];
		const fake = browserFixture({variants: ['uplot'],
			prepData: input => inputs.push(input), construct: sample => charts.push(sample.chart)});
		const report = await fake.runTrace({raf: true});
		assert.equal(inputs.length, 20);
		for (let i = 0; i < 10; i++) {
			assert.equal(inputs[i * 2], fake.context.smallPacked);
			assert.equal(inputs[i * 2 + 1], fake.context.packed);
			assert.equal(charts[i * 2], charts[i * 2 + 1]);
			if (i) assert.notEqual(charts[i * 2], charts[i * 2 - 1]);
		}
		assert.equal(report.phase, 'chart-population');
		assert.equal(report.samples.length, 10);
		assert.ok(report.samples.every(sample => sample.phases.length === 2));
	});

	it('uses optional populated lifecycle constructors and accepts only the retained update handle', async () => {
		const source = browserSource.slice(browserSource.indexOf('function construct('), browserSource.indexOf('function hasChartSurface('));
		const chart = {}, input = {}, host = {}, wait = {};
		let result = chart;
		const sources = {fixture: {
			makeChart() { assert.fail('lifecycle constructor must take precedence'); },
			async makeLifecycleChart(...args) { assert.deepEqual(args, [input, host, wait]); return chart; },
			async updateChart(...args) { assert.deepEqual(args, [chart, input, host, wait]); return result; },
		}};
		const construct = runInNewContext(source + '\nconstruct;', {sources, wait});
		const sample = {variant: 'fixture', input, host, operation: 'small-init'};
		await construct(sample);
		assert.equal(sample.chart, chart);
		sample.operation = 'data-update';
		await construct(sample);
		result = undefined;
		await construct(sample);
		result = {};
		await assert.rejects(construct(sample), /not return a new chart/);
	});

	it('mounts React with populated state and updates beneath the same component', async () => {
		const source = readFileSync(new URL('../../bench/lifecycle-frameworks.mjs', import.meta.url), 'utf8')
			.replace(/^import .*\n/gm, '').replaceAll('export ', '');
		const initial = [{x: 1}, {x: 2}], full = [{x: 1}, {x: 2}, {x: 3}];
		let data, component, builds = [], readiness = [];
		const chart = {root: {}, readySignal: {throwIfAborted() {}}, flushSync: fn => fn()};
		const React = {
			useState(value) { data ??= value; return [data, next => { data = next; component(); }]; },
			createElement(fn) { component = fn; return fn(); },
		};
		const api = runInNewContext(source + '\n({mountLifecycleReact, updateReact});', {
			mountReact: async (host, build, ready) => { build(React, chart); await ready(chart); return chart; },
		});
		const build = input => { builds.push(input); }, ready = (instance, input) => {
			assert.equal(instance, chart); readiness.push(input);
		};
		assert.equal(await api.mountLifecycleReact(initial, {}, build, ready), chart);
		const original = component;
		await api.updateReact(chart, full);
		assert.equal(component, original);
		assert.deepEqual(builds, [initial, full]);
		assert.deepEqual(readiness, [initial, full]);
	});

	it('delegates populated construction and retained updates without benchmark options', async () => {
		const source = browserSource.slice(browserSource.indexOf('function prepFor('), browserSource.indexOf('function validateChart('));
		const input = {}, host = {}, wait = {}, chart = {};
		const calls = [];
		const sources = Object.fromEntries(demoVariants.map(variant => [variant, {
			prepData: packed => ({variant, packed}),
			makeChart: (...args) => { calls.push([variant, ...args]); return chart; },
			updateChart: (...args) => { calls.push([variant, ...args]); },
		}]));
		const api = runInNewContext(source + '\n({prepFor, construct});', {sources, wait});
		for (const variant of Object.keys(sources)) {
			assert.equal(api.prepFor(variant), sources[variant].prepData);
			assert.deepEqual(api.prepFor(variant)(input), {variant, packed: input});
			const sample = {variant, input, host, operation: 'small-init'};
			await api.construct(sample);
			assert.equal(sample.chart, chart);
			assert.deepEqual(calls.at(-1), [variant, input, host, wait]);
			sample.operation = 'data-update';
			await api.construct(sample);
			assert.equal(sample.chart, chart);
			assert.deepEqual(calls.at(-1), [variant, chart, input, host, wait]);
		}
		assert.equal(api.prepFor('idle')(), null);
		api.construct({variant: 'idle'});
		assert.equal(calls.length, demoVariants.length * 2);
		assert.doesNotMatch(browserSource, /function options\(/);
	});

	it('waits for async chart construction, stores the resolved instance, then flushes a microtask', async () => {
		const source = browserSource.slice(browserSource.indexOf('function prepFor('), browserSource.indexOf('function validateChart('));
		for (const variant of ['apexcharts', 'plotly', 'zingchart', 'amcharts']) {
			let pending;
			const chart = {}, input = {}, host = {}, wait = {};
			const sources = {[variant]: {makeChart(...args) {
				assert.deepEqual(args, [input, host, wait]);
				return pending.promise;
			}}};
			const api = runInNewContext(source + `
				const pending = {};
				pending.promise = new Promise(resolve => { pending.resolve = resolve; });
				({construct, finishMicrotask, pending});
			`, {sources, wait});
			pending = api.pending;
			const sample = {variant, input, host, operation: 'small-init'};
			const construction = api.construct(sample);
			assert.equal(sample.chart, pending.promise);
			let finished = false, flushed = false;
			const completion = construction.then(() => {
				assert.equal(flushed, true, 'flush one microtask after replacing the Promise with its chart');
				finished = true;
			});
			await Promise.resolve();
			assert.equal(finished, false);
			assert.equal(sample.chart, pending.promise);
			const update = pending.promise.then(() => {
				assert.equal(sample.chart, chart);
				queueMicrotask(() => { flushed = true; });
			});
			pending.resolve(chart);
			await Promise.all([completion, update]);
			assert.equal(sample.chart, chart);
			assert.equal(flushed, true);
		}
	});

	it('flushes synchronous chart updates and accepts thenables as well as Promises', async () => {
		const source = browserSource.slice(browserSource.indexOf('async function finishMicrotask('), browserSource.indexOf('function validateChart('));
		const finish = runInNewContext(source + '\nfinishMicrotask;');
		const chart = {};
		for (const value of [chart, null, undefined, {then(resolve) { resolve(chart); }}]) {
			const sample = {chart: value};
			let updated = false;
			queueMicrotask(() => { updated = true; });
			await finish(sample);
			assert.equal(updated, true);
			assert.equal(sample.chart, value?.then ? chart : value);
		}
	});

	it('clears rejected async construction and does not destroy an adapter that already cleaned up', async () => {
		const source = browserSource.slice(browserSource.indexOf('async function finishMicrotask('), browserSource.indexOf('function environment('));
		const events = [];
		const sources = {amcharts: {destroyChart() { assert.fail('adapter already cleaned up'); }}};
		const api = runInNewContext(source + '\n({finishMicrotask, teardown});', {sources});
		const error = new Error('async render failed');
		const sample = {variant: 'amcharts', chart: Promise.reject(error), host: {
			replaceChildren() { events.push('clear'); }, remove() { events.push('remove'); },
		}};
		await assert.rejects(api.finishMicrotask(sample), actual => actual === error);
		assert.equal(sample.chart, null);
		api.teardown(sample);
		assert.deepEqual(events, ['clear', 'remove']);
	});

	it('validates rendered adapter charts and delegates teardown while always removing their hosts', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function environment('));
		const oldVariants = ['uplot', 'd3', 'chartjs', 'echarts', 'flot', 'dygraphs', 'chartgpu', 'deckgl'];
		for (const variant of demoVariants.filter(id => !oldVariants.includes(id))) {
			for (const fail of [false, true]) {
				const chart = variant === 'plotly-svg' ? {data: Array.from({length: 3}, () => ({type: 'scatter'}))}
									: variant === 'highcharts-svg' ? {options: {boost: {enabled: false}}, series: [{}, {}, {}]}
														: variant === 'apexcharts' ? {getState: () => ({series: Array.from({length: 3}, () => ({length: 55550}))})}
																			: variant === 'apexcharts-sampled' ? {getState: () => ({
																				config: {chart: {dataReducer: {enabled: true}}}, series: [[1, 2], [3, 4], [5, 6]],
																			})} : {};
								const events = [], error = new Error('destroy failed');
				const host = {
					querySelector(selector) {
											if (variant === 'd3-svg' && selector === 'canvas') return null;
											assert.equal(selector, 'canvas, svg'); return {};
										},
										querySelectorAll(selector) { assert.equal(selector, 'svg .series path'); return [{}, {}, {}]; },
					replaceChildren() { events.push('clear'); }, remove() { events.push('remove'); },
				};
				const sources = {[variant]: {destroyChart(instance) {
					assert.equal(instance, chart);
					events.push('destroy');
					if (fail) throw error;
				}}};
				const api = runInNewContext(source + '\n({validateChart, teardown});', {sources, dpr: 1.5, ROWS: 55550});
				const sample = {variant, chart, host};
				assert.equal(api.validateChart(sample), 1.5);
				assert.throws(() => api.validateChart({...sample, chart: null}), /did not return a rendered chart/);
				assert.throws(() => api.validateChart({...sample, host: {querySelector: () => null, querySelectorAll: () => []}}), /did not return a rendered chart/);
				if (fail) assert.throws(() => api.teardown(sample), actual => actual === error);
				else api.teardown(sample);
				assert.deepEqual(events, ['destroy', 'clear', 'remove']);
			}
		}
	});

	it('validates every ChartGPU value and requires four full Float64 columns', () => {
		const source = browserSource.slice(browserSource.indexOf('function validateInput('), browserSource.indexOf('function construct('));
		const validate = runInNewContext(source + '\nvalidateInput;', {ROWS: 55550, Float64Array});
		const input = Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(55550)]));
		validate({variant: 'chartgpu', input});
		for (const key of Object.keys(input)) {
			for (const index of [0, 27123, 55549]) {
				input[key][index] = NaN;
				assert.throws(() => validate({variant: 'chartgpu', input}), /ChartGPU Float64Array columns/);
				input[key][index] = 0;
			}
			for (const column of [undefined, Array(55550).fill(0), new Float32Array(55550), new Float64Array(55549)])
				assert.throws(() => validate({variant: 'chartgpu', input: {...input, [key]: column}}), /ChartGPU Float64Array columns/);
		}
	});

	it('validates ChartGPU native state, retained columns and backing DPR without pixel or layout reads', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {
			sources: {chartgpu: {destroyChart() {}}}, ROWS: 55550, WIDTH: 1920, HEIGHT: 600, dpr: 2,
		});
		const input = Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(55550)]));
		const series = ['cpu', 'ram', 'tcp'].map(key => ({data: {x: input.x, y: input[key]}}));
		const canvas = {width: 3840, height: 1152,
			getContext() { assert.fail('no pixels'); }, getBoundingClientRect() { assert.fail('no layout'); },
			get clientWidth() { assert.fail('no layout'); }};
		const host = {querySelector: () => canvas, querySelectorAll: () => [canvas]};
		const instance = {disposed: false, renderFrame() {}, dispose() {}, options: {series}, getHitTestSeriesPointCount: () => 55550};
		const chart = {instance, device: {}, element: {}, destroyed: false, error: null};
		const sample = {variant: 'chartgpu', chart, host, input};
		assert.equal(validate(sample), 2);
		for (const patch of [{error: new Error('late GPU failure')}, {destroyed: true}, {device: null}, {instance: null},
			{instance: {...instance, disposed: true}}, {instance: {...instance, renderFrame: null}}])
			assert.throws(() => validate({...sample, chart: {...chart, ...patch}}), /not healthy/);
		for (const patch of [{options: {series: series.slice(0, 2)}}, {getHitTestSeriesPointCount: () => 55549},
			{options: {series: series.map(item => ({data: {...item.data, y: input.x}}))}}])
			assert.throws(() => validate({...sample, chart: {...chart, instance: {...instance, ...patch}}}), /three full series/);
		canvas.width = 1920;
		assert.throws(() => validate(sample), /backing size.*DPR 2/);
		canvas.width = 3840;
		canvas.height = 1200;
		assert.throws(() => validate(sample), /backing size.*DPR 2/);
	});

	it('always cleans ChartGPU resources and rejects failures between validation and teardown', () => {
		const source = browserSource.slice(browserSource.indexOf('function teardown('), browserSource.indexOf('function environment('));
		for (const failure of ['none', 'late-error', 'auto-destroyed', 'disposed', 'dispose-error', 'leaked-devices']) {
			const events = [];
			const chart = {
				instance: {disposed: failure === 'disposed', dispose() {
					events.push('dispose');
					if (failure === 'dispose-error') throw new Error('dispose failed');
				}},
				device: {removeEventListener() { events.push('remove-listener'); }, destroy() { events.push('device-destroy'); }},
				element: {remove() { events.push('element-remove'); }}, destroyed: false, error: null, onError() {},
				getWebGPUDevices() { return this.destroyed ? [] : [this.device]; },
			};
			if (failure === 'late-error' || failure === 'auto-destroyed') chart.error = new Error('late GPU failure');
			if (failure === 'auto-destroyed') destroyChartGPU(chart);
			const teardown = runInNewContext(source + '\nteardown;', {sources: {chartgpu: {
				destroyChart: failure === 'leaked-devices' ? () => {} : destroyChartGPU,
			}}});
			const sample = {variant: 'chartgpu', chart, host: {
				replaceChildren() { events.push('clear'); }, remove() { events.push('remove'); },
			}};
			if (failure === 'none') teardown(sample);
			else assert.throws(() => teardown(sample), /late GPU failure|destroyed or disposed|dispose failed|survived destruction/);
			assert.deepEqual(events.slice(-2), ['clear', 'remove']);
			if (failure !== 'leaked-devices') {
				assert.deepEqual(chart.getWebGPUDevices(), []);
				for (const key of ['instance', 'device', 'element', 'onError']) assert.equal(chart[key], null);
				assert.deepEqual(events.slice(0, 4), ['remove-listener', 'dispose', 'device-destroy', 'element-remove']);
			}
		}
	});

	it('validates every deck.gl input column and rejects corrupt or shortened columns', () => {
		const source = browserSource.slice(browserSource.indexOf('function validateInput('), browserSource.indexOf('function construct('));
		const validate = runInNewContext(source + '\nvalidateInput;', {ROWS: 55550});
		const input = Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(55550)]));
		validate({variant: 'deckgl', input});
		for (const key of Object.keys(input)) {
			for (const index of [0, 27123, 55549]) {
				for (const value of [NaN, Infinity, -Infinity]) {
					input[key][index] = value;
					assert.throws(() => validate({variant: 'deckgl', input}), /four deckgl columns/);
				}
				input[key][index] = 0;
			}
			for (const length of [0, 55549, 55551])
				assert.throws(() => validate({variant: 'deckgl', input: {...input, [key]: new Float64Array(length)}}), /four deckgl columns/);
		}
	});

	it('validates deck.gl native readiness, context exposure and three full XY paths', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {
			sources: {deckgl: {destroyChart: destroyDeckGL}}, ROWS: 55550, WIDTH: 1920, HEIGHT: 600, dpr: 2,
		});
		const {sample, chart, deck, layers} = deckGLFixture();
		assert.equal(validate(sample), 2);
		assert.throws(() => validate({...sample, chart: null}), /did not return a rendered chart/);
		assert.throws(() => validate({...sample, host: {querySelector: () => null, querySelectorAll: () => []}}), /did not return a rendered chart/);
		for (const patch of [{error: new Error('late deck failure')}, {destroyed: true}, {element: null}, {svg: null},
			{context: null}, {context: {isContextLost: () => true}}, {deck: null}, {deck: {}},
			{deck: {...deck, isInitialized: false}}, {deck: {...deck, finalize: null}}])
			assert.throws(() => validate({...sample, chart: {...chart, ...patch}}), /not healthy/);
		for (const getWebGLContexts of [undefined, () => [], () => [{}], () => [chart.context, chart.context]])
			assert.throws(() => validate({...sample, chart: {...chart, getWebGLContexts}}), /expose its live WebGL context/);
		for (const invalid of [undefined, layers.slice(0, 2), [...layers, layers[0]]])
			assert.throws(() => validate({...sample, chart: {...chart, deck: {...deck, props: {layers: invalid}}}}), /three full XY paths/);
		for (let i = 0; i < 3; i++) {
			for (const props of [{positionFormat: 'XYZ', data: layers[i].props.data}, {positionFormat: 'XY', data: []},
				{positionFormat: 'XY', data: [new Float64Array(55549 * 2)]},
				{positionFormat: 'XY', data: [new Float64Array(55550 * 3)]},
				{positionFormat: 'XY', data: [...layers[i].props.data, ...layers[i].props.data]}]) {
				const invalid = layers.map((layer, index) => index === i ? {props} : layer);
				assert.throws(() => validate({...sample, chart: {...chart, deck: {...deck, props: {layers: invalid}}}}), /three full XY paths/);
			}
		}
	});

	for (const dpr of [1, 1.5, 2]) {
		it(`checks deck.gl 1770x500 inline and backing dimensions at DPR ${dpr} without layout or readback`, () => {
			const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
			const validate = runInNewContext(source + '\nvalidateChart;', {
				sources: {deckgl: {destroyChart: destroyDeckGL}}, ROWS: 55550, WIDTH: 1920, HEIGHT: 600, dpr,
			});
			const {sample, chart, canvas} = deckGLFixture(dpr);
			assert.equal(validate(sample), dpr);
			for (const patch of [{width: 1920 * dpr}, {height: 600 * dpr}, {width: NaN}, {height: 0},
				{style: {width: '1920px', height: '500px'}}, {style: {width: '1770px', height: '600px'}},
				{style: {width: '', height: '500px'}}]) {
				const invalid = Object.assign(Object.create(canvas), patch);
				assert.throws(() => validate({...sample, chart: {...chart, canvas: {node: () => invalid}},
					host: {querySelector: () => invalid, querySelectorAll: () => [invalid]}}), /inline or backing size.*DPR/);
			}
			assert.throws(() => validate({...sample, chart: {...chart, canvas: null}}), /inline or backing size/);
			for (const canvases of [[], [{}], [canvas, canvas]])
				assert.throws(() => validate({...sample, host: {...sample.host, querySelectorAll: () => canvases}}), /inline or backing size/);
		});
	}

	it('cleans deck.gl resources and rejects late errors, context loss and native finalization', () => {
		const source = browserSource.slice(browserSource.indexOf('function teardown('), browserSource.indexOf('function environment('));
		for (const failure of ['none', 'late-error', 'auto-destroyed', 'context-lost', 'finalized', 'finalize-error', 'error-during-destroy']) {
			const {sample, chart, context, deck, element, events} = deckGLFixture();
			if (failure === 'late-error' || failure === 'auto-destroyed') chart.error = new Error('late deck failure');
			if (failure === 'auto-destroyed') destroyDeckGL(chart);
			if (failure === 'context-lost') context.lost = true;
			if (failure === 'finalized') deck.isInitialized = false;
			if (failure === 'finalize-error') deck.finalize = () => { events.push('finalize'); throw new Error('finalize failed'); };
			const teardown = runInNewContext(source + '\nteardown;', {sources: {deckgl: {destroyChart(chart) {
				destroyDeckGL(chart);
				if (failure === 'error-during-destroy') chart.error = new Error('late deck failure');
			}}}});
			if (failure === 'none') teardown(sample);
			else assert.throws(() => teardown(sample), /late deck failure|lost-context chart|finalize failed/);
			assert.deepEqual(events, ['svg-listeners', 'canvas-listeners', 'finalize', 'lose-context', 'element-remove', 'clear', 'remove']);
			assert.equal(chart.destroyed, true);
			assert.equal(chart.element, element);
			assert.equal(element.isConnected, false);
			assert.deepEqual(chart.getWebGLContexts(), []);
			for (const key of ['deck', 'context', 'canvas', 'svg']) assert.equal(chart[key], null);
		}
	});

	it('rejects deck.gl resource leaks or remaining context exposure but still removes the host', () => {
		const source = browserSource.slice(browserSource.indexOf('function teardown('), browserSource.indexOf('function environment('));
		for (const leak of ['deck', 'context', 'canvas', 'svg', 'element', 'destroyed', 'exposed-context', 'missing-accessor']) {
			const {sample, chart, context, events} = deckGLFixture();
			const teardown = runInNewContext(source + '\nteardown;', {sources: {deckgl: {destroyChart(chart) {
				const retained = chart[leak];
				destroyDeckGL(chart);
				if (leak === 'element') chart.element.isConnected = true;
				else if (leak === 'exposed-context') chart.getWebGLContexts = () => [context];
				else if (leak === 'missing-accessor') chart.getWebGLContexts = undefined;
				else chart[leak] = retained;
			}}}});
			assert.throws(() => teardown(sample), /resources or exposed contexts survived destruction/);
			assert.deepEqual(events.slice(-2), ['clear', 'remove']);
		}
	});

	it('exports deck.gl runtime version, representation, stroke and sample-count metadata', () => {
		const source = browserSource.slice(browserSource.indexOf('function environment('), browserSource.indexOf('let invoked = null;'));
		const runtime = {navigator: {userAgent: 'test'}, uPlot: null, dpr: 2, d3: {version: '7.9.0'}, deck: {Deck: {VERSION: '9.4.0'}}};
		const environment = runInNewContext(source + '\nenvironment;', runtime);
		assert.equal(environment().deckglVersion, '9.4.0');
		assert.equal(environment().d3Version, '7.9.0');
		delete runtime.deck;
		assert.equal(environment().deckglVersion, null);
		const report = browserFixture({variants: ['deckgl']}).api.begin();
		assert.equal(report.source.demos.deckgl, '/bench/deckgl.mjs');
		assert.match(report.source.dataRepresentations.deckgl, /Float64Array columns.*full PathLayer.*no sampling/);
		assert.equal(report.source.strokeWidthDevicePixels.deckgl, 1);
		assert.equal(report.expectedInstances.deckgl, 10);
		assert.equal(report.expectedInstances.measuredDeckgl, 7);
	});

	it('rejects reduced ApexCharts series even when a chart surface exists', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 1, ROWS: 55550, sources: {}});
		for (const lengths of [[55550, 55550, 55550], [1920, 1920, 1920], [55550, 1920, 55550], [55550, 55550]]) {
			const sample = {variant: 'apexcharts', chart: {getState: () => ({series: lengths.map(length => ({length}))})}};
			if (lengths.length === 3 && lengths.every(length => length === 55550))
				assert.equal(validate(sample), 1);
			else
				assert.throws(() => validate(sample), /all 55,550 rendered values/);
		}
	});

	it('accepts reduced ApexCharts output only with a native reducer and three finite nonempty series', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 1, ROWS: 55550, sources: {}});
		const config = {chart: {dataReducer: {enabled: true}}};
		const check = (series, options = config) => validate({
			variant: 'apexcharts-sampled', chart: {getState: () => ({series, config: options})},
		});
		for (const length of [1, 1920, 55550])
			assert.equal(check(Array.from({length: 3}, () => Array(length).fill(1))), 1);
		for (const series of [undefined, [], [[1], [2]], [[1], [2], []], [[1], [NaN], [3]],
			[[1], [2], [Infinity]], [[1], [2], [null]], [[1], [2], [[3, 4]]],
			[[1], [2], Array(55551).fill(3)]])
			assert.throws(() => check(series), /three nonempty finite series/);
		for (const options of [{}, {chart: {dataReducer: {enabled: false}}}])
			assert.throws(() => check([[1], [2], [3]], options), /enable its native data reducer/);
	});

	for (const id of ['apexcharts', 'amcharts', 'devextreme', 'anychart', 'fusiontime']) {
		it(`${id}: sampled validates full prepared input, not reduced input`, async () => {
			const source = browserSource.slice(browserSource.indexOf('function validateInput('), browserSource.indexOf('function construct('));
			const validate = runInNewContext(source + '\nvalidateInput;', {ROWS: 55550, Date});
			const base = await import(`../../bench/${id}.mjs`);
			const sampled = await import(`../../bench/${id}-sampled.mjs`);
			assert.equal(sampled.prepData, base.prepData);
			const packed = [7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free'];
			for (let i = 0; i < 55550; i++)
				packed.push(i, 75, 2, 3, 4, 25, 75);
			const input = sampled.prepData(Object.freeze(packed));
			for (const variant of [id, id + '-sampled']) {
				assert.doesNotThrow(() => validate({variant, input}));
				const reduced = id === 'apexcharts' ? input.map(series => series.slice(0, 1920)) : input.slice(0, 1920);
				assert.throws(() => validate({variant, input: reduced}), /55,550/);
			}
			const last = id === 'apexcharts' ? input[2].at(-1) : input.at(-1);
			const key = id === 'apexcharts' ? 1 : id === 'amcharts' || id === 'devextreme' ? 'tcp' : 3;
			last[key] = NaN;
			for (const variant of [id, id + '-sampled'])
				assert.throws(() => validate({variant, input}), /55,550/);
		});
	}

	it('requires three SVG paths and no Canvas in the D3 SVG variant', async () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 1.5, sources: {'d3-svg': {destroyChart() {}}}});
		const window = new Window();
		try {
			const host = window.document.createElement('div');
			host.innerHTML = '<svg><g class="series"><path/><path/><path/></g></svg>';
			const sample = {variant: 'd3-svg', chart: {}, host};
			assert.equal(validate(sample), 1.5);
			host.append(window.document.createElement('canvas'));
			assert.throws(() => validate(sample), /three SVG line paths without Canvas/);
			host.querySelector('canvas').remove();
			host.querySelector('path').remove();
			assert.throws(() => validate(sample), /three SVG line paths without Canvas/);
		}
		finally {
			await window.happyDOM.close();
		}
	});

	it('rejects GL rendering in the explicitly SVG variants', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 1, sources: {}});
		const plotly = {data: Array.from({length: 3}, () => ({type: 'scatter'}))};
		const highcharts = {options: {boost: {enabled: false}}, series: [{}, {}, {}]};
		assert.equal(validate({variant: 'plotly-svg', chart: plotly}), 1);
		assert.equal(validate({variant: 'highcharts-svg', chart: highcharts}), 1);
		plotly.data[2].type = 'scattergl';
		highcharts.series[2].boosted = true;
		assert.throws(() => validate({variant: 'plotly-svg', chart: plotly}), /SVG scatter traces/);
		assert.throws(() => validate({variant: 'highcharts-svg', chart: highcharts}), /non-boosted series/);
	});

	it('accepts chart surfaces in nested shadow roots but rejects empty shadow renderers', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 2, sources: {bokeh: {destroyChart() {}}}});
		const window = new Window();
		try {
			const host = window.document.createElement('div');
			const outer = window.document.createElement('div');
			const inner = window.document.createElement('div');
			host.append(outer);
			outer.attachShadow({mode: 'open'}).append(inner);
			const root = inner.attachShadow({mode: 'open'});
			const sample = {variant: 'bokeh', chart: {}, host};
			assert.throws(() => validate(sample), /did not return a rendered chart/);
			for (const tag of ['canvas', 'svg']) {
				root.append(tag === 'svg' ? window.document.createElementNS('http://www.w3.org/2000/svg', tag) : window.document.createElement(tag));
				assert.equal(host.querySelector('canvas, svg'), null, 'surface is invisible to a light-DOM query');
				assert.equal(validate(sample), 2);
				assert.throws(() => validate({...sample, chart: null}), /did not return a rendered chart/);
				root.replaceChildren();
				assert.throws(() => validate(sample), /did not return a rendered chart/);
			}
		}
		finally {
			window.close();
		}
	});

	it('rejects uPlot bundles that retain series or point paths after drawing', () => {
		const source = browserSource.slice(browserSource.indexOf('function hasChartSurface('), browserSource.indexOf('function teardown('));
		const validate = runInNewContext(source + '\nvalidateChart;', {dpr: 1, sources: {}});
		const chart = {pxRatio: 1, series: [{}, {_paths: null, points: {_paths: null}}]};
		assert.equal(validate({variant: 'uplot', chart}), 1);
		chart.series[1]._paths = {};
		assert.throws(() => validate({variant: 'uplot', chart}), /retained paths despite cache.paths:false/);
		chart.series[1]._paths = null;
		chart.series[1].points._paths = {};
		assert.throws(() => validate({variant: 'uplot', chart}), /retained paths despite cache.paths:false/);
	});

	it('uses the preloaded uPlot IIFE and fails rather than importing source modules', () => {
		const startup = browserSource.slice(0, browserSource.indexOf('const WIDTH')) + '\nuPlot;';
		const uPlot = function() {};
		const context = {URL, location: {href: 'http://localhost/?variant=uplot'}, uPlot};
		assert.equal(runInNewContext(startup, context), uPlot);
		assert.throws(() => runInNewContext(startup, {...context, uPlot: undefined}), /Expected \/dist\/uPlot\.iife\.min\.js/);
		assert.equal(runInNewContext(startup, {URL, location: {href: 'http://localhost/?variant=idle'}}), null);
		assert.doesNotMatch(browserSource, /\/src\//);
		assert.match(browserSource, /import\('\/bench\/demo-fixture.mjs'\)/);
	});

	it('returns only metadata and numeric timing fields, with validation outside timers', async () => {
		const fake = browserFixture();
		const begin = fake.api.begin();
		assert.equal(begin.captureId, 'browser-capture');
		assert.equal(begin.source.uplot, '/dist/uPlot.iife.min.js');
		assert.equal(begin.source.uplotCss, '/dist/uPlot.min.css');
		assert.deepEqual(structuredClone(begin.config), {variants: ['uplot', 'chartjs', 'idle'], dpr: 2, warmups: 3, rounds: 7, lifecycle: true, operations: ['small-init', 'data-update']});
		assert.equal(begin.expectedInstances.samples, 30);
		assert.equal(begin.expectedInstances.chartCreations, 20);
		assert.equal(begin.expectedInstances.d3, 0);
		assert.equal(await fake.api.setup('uplot', 'sample-0'), undefined);
		assert.equal(await fake.api.prepare(), undefined);
		const sample = await fake.api.construct();
		assert.deepEqual(structuredClone(sample), {...timing('uplot', 'sample-0', 2), operation: 'small-init'});
		assert.deepEqual(fake.marks.map(mark => mark.name), [
			'benchmark:capture:browser-capture', 'benchmark:sample-0:start', 'benchmark:sample-0:js-end', 'benchmark:sample-0:end',
		]);
		const start = fake.events.indexOf('benchmark:sample-0:start');
		assert.deepEqual(fake.events.slice(start, start + 7), [
			'benchmark:sample-0:start', 'construct', 'microtask', 'benchmark:sample-0:js-end',
			'settle', 'benchmark:sample-0:end', 'checkPage',
		]);
		assert.equal(await fake.api.destroy(), undefined);
		await fake.api.setup('chartjs', 'sample-1');
		await fake.api.prepare();
		assert.equal((await fake.api.construct()).id, 'sample-1');
		await fake.api.destroy();
	});

	it('captures reused GL contexts after js-end and awaits completion inside the chart window', async () => {
		const entered = signal(), pending = signal();
		const contexts = [{}, {}];
		const webgl = {
			status: 'complete', waitMs: 11, webgl1Finish: true,
			contexts: [
				{index: 0, type: 'webgl', method: 'finish', status: 'complete', blockingMs: 4},
				{index: 1, type: 'webgl2', method: 'fence', status: 'complete', waitMs: 11},
			],
		};
		const tracked = [];
		const fake = browserFixture({
			variants: ['scichart'],
			construct: sample => {
				sample.chart.getWebGLContexts = function() {
					assert.equal(this, sample.chart);
					fake.events.push('getWebGLContexts');
					return contexts;
				};
			},
			webgl: {
				begin() { fake.events.push('webgl:begin'); },
				track(gl) { tracked.push(gl); fake.events.push('webgl:track'); fake.advance(3); },
				async complete(options) {
					assert.deepEqual(structuredClone(options), {webgl1Finish: true, retainContexts: true});
					fake.events.push('webgl:complete');
					entered.resolve();
					await pending.promise;
					fake.advance(11);
					fake.events.push('webgl:completed');
					return webgl;
				},
				reset() { fake.events.push('webgl:reset'); },
			},
		});
		fake.api.begin();
		await fake.api.setup('scichart', 'sample-0');
		await fake.api.prepare();
		const completion = fake.api.construct();
		await waitFor(entered.promise);
		assert.equal(fake.marks.some(mark => mark.name === 'benchmark:sample-0:end'), false);
		await assert.rejects(fake.api.destroy(), /inactive/);
		pending.resolve();
		const sample = await completion;
		assert.deepEqual(tracked, contexts);
		assert.deepEqual(structuredClone(sample), {...timing('scichart', 'sample-0', 2), operation: 'small-init', windowMs: 124, webgl});
		assert.deepEqual(fake.events.slice(fake.events.indexOf('webgl:begin')), [
			'webgl:begin', 'prepData', 'validateInput', 'settle', 'checkPage', 'checkPage',
			'benchmark:sample-0:start', 'construct', 'microtask', 'benchmark:sample-0:js-end',
			'getWebGLContexts', 'webgl:track', 'webgl:track', 'settle',
			'webgl:complete', 'webgl:completed', 'benchmark:sample-0:end', 'checkPage', 'validateChart',
		]);
		await fake.api.destroy();
		assert.deepEqual(fake.events.slice(-3), ['teardown', 'webgl:reset', 'settle']);
		await fake.api.setup('scichart', 'sample-1');
		await fake.api.prepare();
		assert.equal(fake.events.filter(event => event === 'webgl:begin').length, 2);
		await fake.api.destroy();
	});

	it('routes only actual ChartGPU devices after settling and saves completion before the end marker', async () => {
		const entered = signal(), pending = signal();
		const devices = [{}, {}];
		const webgpu = {status: 'complete', waitMs: 13, devices: devices.map((_, index) => ({index, status: 'complete'}))};
		const fake = browserFixture({variants: ['chartgpu'],
			construct(sample) { sample.chart.getWebGPUDevices = function() {
				assert.equal(this, sample.chart);
				fake.events.push('getWebGPUDevices');
				return devices;
			}; },
			webgpu: {async complete(actual) {
				assert.equal(actual, devices);
				assert.deepEqual(fake.events.slice(-2), ['settle', 'getWebGPUDevices']);
				entered.resolve();
				await pending.promise;
				fake.advance(13);
				return webgpu;
			}},
		});
		fake.api.begin();
		await fake.api.setup('chartgpu', 'sample-0');
		await fake.api.prepare();
		const completion = fake.api.construct();
		await waitFor(entered.promise);
		assert.equal(fake.marks.some(mark => mark.name.endsWith(':end')), false);
		pending.resolve();
		const sample = await completion;
		assert.deepEqual(structuredClone(sample), {...timing('chartgpu', 'sample-0', 2), operation: 'small-init', windowMs: 120, webgpu});
		await fake.api.destroy();
	});

	for (const status of ['incomplete', 'not-observed', 'missing-result', 'missing-helper', 'empty-devices', 'failed-device']) {
		it(`rejects ChartGPU completion without complete evidence (${status})`, async () => {
			const fake = browserFixture({variants: ['chartgpu'], webgpu: status === 'missing-helper' ? undefined : {
				complete: async () => status === 'missing-result' ? undefined : {
					status: ['empty-devices', 'failed-device'].includes(status) ? 'complete' : status,
					devices: status === 'empty-devices' ? [] : [{status: 'queue-error'}],
				},
			}});
			fake.api.begin();
			await fake.api.setup('chartgpu', 'sample-0');
			await fake.api.prepare();
			await assert.rejects(fake.api.construct(), /chartgpu: WebGPU completion not verified/);
			await fake.api.destroy();
		});
	}

	it('fails ChartGPU with missing exposed devices using the real completion helper', async () => {
		const fake = browserFixture({variants: ['chartgpu'], webgpu: createWebGPUCapture()});
		fake.api.begin();
		await fake.api.setup('chartgpu', 'sample-0');
		await fake.api.prepare();
		await assert.rejects(fake.api.construct(), /WebGPU completion not verified.*not-observed/);
		await fake.api.destroy();
	});

	it('does not query or fence WebGPU for unrelated adapters or the ChartGPU rAF pass', async () => {
		const options = {
			webgpu: {complete() { assert.fail('unexpected post-render fence'); }},
			construct(sample) { sample.chart.getWebGPUDevices = () => assert.fail('unexpected device enumeration'); },
		};
		const fake = browserFixture(options);
		fake.api.begin();
		await fake.api.setup('uplot', 'sample-0');
		await fake.api.prepare();
		assert.equal((await fake.api.construct()).webgpu, undefined);
		await fake.api.destroy();
		const raf = await browserFixture({...options, variants: ['chartgpu']}).runTrace({raf: true});
		assert.equal(raf.samples.length, 10);
		assert.ok(raf.samples.every(sample => !Object.hasOwn(sample, 'webgpu')));
		assert.ok(raf.limitations.some(text => /command submission.*including rAF/.test(text)));
		assert.ok(raf.limitations.some(text => /rAF adds no post-render WebGPU fence/.test(text)));
	});

	for (const variant of ['highcharts', 'plotly', 'bokeh', 'd3fc', 'deckgl', 'g2-webgl', 'scichart', 'lightningchart']) {
		for (const status of ['complete', 'incomplete', 'not-observed', 'missing-result', 'missing-observer']) {
			it(`${variant} requires complete GL evidence (${status})`, async () => {
				const webgl = status === 'missing-result' ? undefined : {status, contexts: []};
				let resets = 0;
				let populated = false;
				const fake = browserFixture({variants: [variant], webgl: status === 'missing-observer' ? undefined : {
					begin() {}, track() {}, complete: async () => populated ? webgl : {status: 'not-observed'}, reset() { resets++; },
				}});
				fake.api.begin();
				await fake.api.setup(variant, 'sample-0');
				await fake.api.prepare('small-init');
				await fake.api.construct();
				populated = true;
				await fake.api.prepare('data-update', 'sample-1');
				if (status === 'complete')
					assert.deepEqual(structuredClone((await fake.api.construct()).webgl), webgl);
				else {
					await assert.rejects(fake.api.construct(), error => error.message.startsWith(`${variant}: WebGL completion not verified:`));
					await assert.rejects(fake.api.construct(), /prepared/);
				}
				await fake.api.destroy();
				assert.equal(resets, status === 'missing-observer' ? 0 : 1);
				await fake.api.setup(variant, 'sample-2');
				await fake.api.destroy();
			});
		}
	}

	for (const status of ['not-observed', 'incomplete']) {
		it(`handles ${status} GL evidence for a non-GL variant`, async () => {
			const webgl = {status, contexts: []};
			const fake = browserFixture({webgl: {begin() {}, complete: async () => webgl, reset() {}}});
			fake.api.begin();
			await fake.api.setup('uplot', 'sample-0');
			await fake.api.prepare();
			if (status === 'not-observed')
				assert.deepEqual(structuredClone((await fake.api.construct()).webgl), webgl);
			else
				await assert.rejects(fake.api.construct(), /uplot: WebGL completion not verified/);
			await fake.api.destroy();
		});
	}

	for (const phase of ['prepare', 'construct', 'complete', 'teardown']) {
		it(`resets GL capture and clears sample state after ${phase} fails`, async () => {
			const primary = new Error(`${phase} failed`);
			const fail = () => { throw primary; };
			const fake = browserFixture({
				validateInput: phase === 'prepare' ? fail : undefined,
				construct: phase === 'construct' ? fail : undefined,
				teardown: phase === 'teardown' ? fail : undefined,
				webgl: {
					begin() { fake.events.push('webgl:begin'); },
					async complete() { if (phase === 'complete') throw primary; return {status: 'not-observed'}; },
					reset() { fake.events.push('webgl:reset'); },
				},
			});
			fake.api.begin();
			await fake.api.setup('uplot', 'sample-0');
			if (phase === 'prepare') {
				await assert.rejects(fake.api.prepare('small-init'), error => error === primary);
			}
			else {
				await fake.api.prepare();
				if (phase === 'teardown') await fake.api.construct();
				else await assert.rejects(fake.api.construct(), error => error === primary);
			}
			if (phase === 'teardown') await assert.rejects(fake.api.destroy(), error => error === primary);
			else await fake.api.destroy();
			assert.deepEqual(fake.events.slice(-3), ['teardown', 'webgl:reset', 'settle']);
			await fake.api.destroy();
			assert.equal(fake.events.filter(event => event === 'teardown').length, 1);
			assert.equal(fake.events.filter(event => event === 'webgl:reset').length, 2);
			await fake.api.setup('uplot', 'sample-1');
			assert.equal(fake.events.filter(event => event === 'webgl:begin').length, 1);
			if (phase === 'teardown') await assert.rejects(fake.api.destroy(), error => error === primary);
			else await fake.api.destroy();
		});
	}

	it('requires begin, valid variants and chronological IDs, and enforces phase order', async () => {
		const {api} = browserFixture();
		await assert.rejects(api.setup('uplot', 'sample-0'), /begin/);
		api.begin();
		assert.throws(() => api.begin(), /exclusive/);
		await assert.rejects(api.setup('missing', 'sample-0'), /Unknown variant/);
		await assert.rejects(api.setup('uplot', 'sample-2'), /Expected sample-0/);
		await api.setup('uplot', 'sample-0');
		await assert.rejects(api.construct(), /prepared/);
		await assert.rejects(api.setup('uplot', 'sample-1'), /active sample/);
		await api.prepare();
		await assert.rejects(api.prepare(), /constructed sample/);
		await api.construct();
		await assert.rejects(api.construct(), /prepared/);
		await api.destroy();
	});

	it('rejects concurrent lifecycle calls while settling', async () => {
		const pending = signal();
		const {api} = browserFixture({settle: () => pending.promise});
		api.begin();
		const setup = api.setup('uplot', 'sample-0');
		await assert.rejects(api.prepare(), /inactive/);
		await assert.rejects(api.destroy(), /inactive/);
		pending.resolve();
		await setup;
		await api.destroy();
	});

	it('drops state even when teardown fails', async () => {
		const primary = new Error('teardown');
		const fake = browserFixture({teardown: () => { throw primary; }});
		fake.api.begin();
		await fake.api.setup('uplot', 'sample-0');
		await assert.rejects(fake.api.destroy(), error => error === primary);
		await fake.api.destroy();
		assert.equal(fake.events.filter(event => event === 'teardown').length, 1);
		await fake.api.setup('uplot', 'sample-1');
	});

	it('keeps the rAF path functional and mutually exclusive in both directions', async () => {
		const shared = browserFixture();
		shared.api.begin();
		await assert.rejects(shared.runTrace({raf: true}), /exclusive/);
		const raf = browserFixture({
			webgl: Object.fromEntries(['begin', 'track', 'complete', 'reset'].map(method => [method, () => assert.fail(`rAF must not call WebGL ${method}`)])),
			construct: sample => { sample.chart.getWebGLContexts = () => assert.fail('rAF must not enumerate GL contexts'); },
		});
		const report = await raf.runTrace({raf: true});
		assert.equal(report.samples.length, 30);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 9);
				assert.ok(report.samples.every(sample => !Object.hasOwn(sample, 'webgl')));
		assert.equal(report.raf.enabled, true);
		assert.equal(report.raf.frameIntervalsMs.length, 16);
		assert.equal(report.samples[0].raf1Ms, 23);
		assert.equal(report.samples[0].postJsRaf1Ms, 16);
		assert.throws(() => raf.api.begin(), /exclusive/);
		await assert.rejects(raf.api.setup('uplot', 'sample-0'), /Expected sample-/);
	});

	it('notifies optional rAF sample boundaries before setup and after teardown for every round', async () => {
		const fake = browserFixture({
			webgl: Object.fromEntries(['begin', 'track', 'complete', 'reset'].map(method => [method, () => assert.fail(`rAF must not call WebGL ${method}`)])),
		});
		const boundaries = [];
		fake.context.benchmarkSampleBoundary = payload => {
			const boundary = JSON.parse(payload);
			boundaries.push(boundary);
			fake.events.push(`boundary:${boundary.phase}`);
		};
		const report = await fake.runTrace({raf: true});
		assert.deepEqual(boundaries, Array.from(report.samples).flatMap(({variant}) =>
			Array.from({length: 3}, () => [{phase: 'start', variant}, {phase: 'end', variant}]).flat()));
		assert.equal(boundaries.length, 180);
		assert.equal(fake.events.filter(event => event === 'setup').length, 30);
		assert.equal(fake.events.filter(event => event === 'teardown').length, 30);
		assert.equal(report.raf.frameIntervalsMs.length, 16);
		assert.ok(report.samples.every(sample => sample.raf1Ms === 23 && sample.postJsRaf1Ms === 16));
		assert.equal(fake.marks.filter(mark => /:sample-/.test(mark.name)).length, 180);
	});

	it('defaults to runnable manifest variants, preserves query variants, and blocks unavailable libraries', () => {
		assert.match(browserSource, /await import\('\/bench\/demo-dependencies.mjs'\)/);
		const source = browserSource.slice(browserSource.indexOf('const ALL_VARIANTS'), browserSource.indexOf('const WARMUPS'));
		const select = selectedVariant => runInNewContext(source + '\n({ALL_VARIANTS, VARIANTS});', {
			selectedVariant, demoDependencies, benchmarkVariants, assertBenchmarkAvailable,
		});
		assert.deepEqual(structuredClone(select(null).VARIANTS), [...benchmarkVariants, 'idle']);
		assert.equal(select(null).VARIANTS.includes('chartgpu'), true);
		assert.deepEqual(structuredClone(select('chartgpu').VARIANTS), ['chartgpu']);
		assert.deepEqual(new Set(select(null).ALL_VARIANTS), new Set(allVariants));
		for (const variant of [...benchmarkVariants, 'idle'])
			assert.deepEqual(structuredClone(select(variant).VARIANTS), [variant]);
		for (const [variant, reason] of Object.entries({...demoRestrictions, ...benchmarkRestrictions}))
			assert.throws(() => select(variant), error => error.message.includes(reason));
		for (const variant of ['unknown', 'toString', '__proto__'])
			assert.throws(() => select(variant), /Unknown variant/);
		assert.match(browserSource, /source\.makeLifecycleChart \?\? source\.makeChart/);
				assert.match(browserSource, /source\.updateChart\(sample.chart, sample.input, sample.host, wait\)/);
		for (const source of [browserSource, collectorSource]) {
			assert.doesNotMatch(source, /Runtime\.getHeapUsage|HeapProfiler\.enable|usedSize|backingStorageSize|heapMetrics|benchmarkMemory/);
		}
	});
});

describe('shared sample capture', () => {
	const operations = ['small-init', 'data-update'];
	it('gives each lifecycle operation its own budget and keeps GC outside the update sequence', async () => {
		const clock = collectorClock();
		const fake = fixture({memory: true, collector: clock.capture,
			config: {lifecycle: true, operations},
			operation(method) { if (method === 'construct') clock.advance(4000); },
		});
		const report = await fake.capture();
		assert.equal(report.phase, 'chart-population');
		assert.equal(report.samples.length, 1);
		assert.deepEqual(structuredClone(report.samples[0].phases.map(phase => phase.operation)), operations);
		assert.deepEqual(structuredClone(report.samples[0].phases.map(phase => phase.warmup)), [false, false]);
		const methods = fake.events.map(event => event.method);
		assert.equal(methods.filter(method => method === gc).length, 3);
		const first = methods.indexOf('construct');
		const last = methods.lastIndexOf('construct:end');
		assert.ok(!methods.slice(first, last).includes(gc));
		assert.equal(clock.timers.size, 0);
	});

	it('still stops a single over-budget lifecycle operation', async () => {
		const clock = collectorClock();
		let constructions = 0;
		const fake = fixture({collector: clock.capture, config: {lifecycle: true, operations},
			operation(method) {
				if (method === 'construct') clock.advance(++constructions === 2 ? 5001 : 4000);
			},
		});
		await assert.rejects(fake.capture(), error => error.code === 'BENCHMARK_SAMPLE_TIMEOUT');
		assert.equal(constructions, 2);
		assert.equal(clock.timers.size, 0);
	});
	it('starts with begin and preserves browser timings and metadata in trace-only mode, without GC', async () => {
		const fake = fixture();
		const report = await fake.capture();
		assert.deepEqual(report.samples, [{...timing('uplot', 'sample-0', 1), round: 0, warmup: false}]);
		assert.equal(report.captureId, 'capture-id');
		assert.deepEqual(report.env, {actualDPR: 1});
		assert.equal(report.phase, 'initial-chart-creation');
		assert.equal(report.sampleTimeoutMs, 5000);
		assert.equal(report.markerPattern, 'benchmark:<id>:start|js-end|end');
		assert.ok(report.limitations.includes('fixture limitation'));
		assert.equal(report.processProtocol, undefined);
		assert.deepEqual(fake.events.map(event => event.method), [
			'begin', 'setup', 'setup:end', 'prepare', 'prepare:end', 'construct', 'construct:end', 'destroy', 'destroy:end',
		]);
	});

	it('records process-only checkpoints/endpoints with exactly three GCs and none between prep and init', async () => {
		const fake = fixture({memory: true});
		const report = await fake.capture();
		const sample = report.samples[0];
		assert.deepEqual({...sample, processObservations: undefined}, {...timing('uplot', 'sample-0', 1), round: 0, warmup: false, processObservations: undefined});
		assert.deepEqual(sample.processObservations.map(({phase, kind}) => [phase, kind]), [
			['baseline', 'gc'], ['prepare', 'start'], ['prepare', 'end'], ['prepared', 'snapshot'],
			['construct', 'start'], ['construct', 'end'], ['live', 'gc'], ['cleanup', 'gc'],
		]);
		let previous = 0;
		for (const read of sample.processObservations) {
			assert.deepEqual(Object.keys(read), ['phase', 'kind', 'processMemory', 'processRequestedAtMs', 'processTimestampMs']);
			assert.deepEqual(read.processMemory, memory());
			assert.ok(read.processRequestedAtMs >= previous);
			assert.ok(read.processTimestampMs >= read.processRequestedAtMs);
			previous = read.processTimestampMs;
		}
		assert.deepEqual(fake.events.map(event => event.method).filter(method => !method.endsWith(':end')), [
			'begin', 'setup', gc, 'read', 'read', 'prepare', 'read', 'read', 'read', 'construct', 'read', gc, 'read', 'destroy', gc, 'read',
		]);
		assert.equal(report.processProtocol.requestedProcessPollIntervalMs, 50);
		assert.equal(report.processProtocol.sampleTimeoutMs, 5000);
		assert.equal(report.processProtocol.phaseTimeoutMs, undefined);
		assert.equal(report.processProtocol.separatePass, false);
		assert.match(report.processProtocol.prepared, /without GC/);
		// The existing raw summary accepts process observations via its observations field.
		const summary = summarizeProcessMemory({samples: [{...sample, observations: sample.processObservations}]});
		assert.equal(summary.groups[0].validObservationCount, 8);
		assert.equal(summary.groups[0].missingCheckpointCount, 0);
	});

	it('collects the actual browser lifecycle through return-by-value evaluation', async () => {
		const fake = browserFixture();
		const page = {send: () => assert.fail('trace-only capture must not send GC commands')};
		const report = await captureBenchmarkSamples(page, async (target, expression) => {
			assert.equal(target, page);
			return structuredClone(await runInNewContext(expression, fake.context));
		});
		assert.equal(report.captureId, 'browser-capture');
		assert.equal(report.samples.length, 30);
		assert.equal(fake.marks.length, 181);
		assert.equal(report.phase, 'chart-population');
		report.samples.forEach((sample, index) => {
			const {phases, ...update} = sample;
			assert.deepEqual(update, {...timing(sample.variant, `sample-${index * 2 + 1}`, 2), operation: 'data-update', round: Math.floor(index / 3) - 3, warmup: index < 9});
			assert.deepEqual(phases.map(phase => phase.operation), ['small-init', 'data-update']);
			assert.deepEqual(phases.map(phase => phase.warmup), [index < 9, index < 9]);
			assert.equal(phases[0].dataPrepMs, 3);
		});
	});

	it('applies process checkpoints to all three warmups and seven measured rounds', async () => {
		const fake = fixture({memory: true, config: {warmups: 3, rounds: 7}});
		const report = await fake.capture();
		assert.equal(report.samples.length, 10);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 3);
		assert.equal(fake.events.filter(event => event.method === gc).length, 30);
		assert.equal(fake.events.filter(event => event.method === 'destroy').length, 10);
		for (const sample of report.samples)
			assert.equal(sample.processObservations.length, 8);
	});

	it('allows explicit null processRead, even with a custom process interval', async () => {
		const fake = fixture({memory: true});
		const report = await fake.capture({processRead: null, processPollIntervalMs: 1});
		assert.equal(report.samples[0].processObservations, undefined);
		assert.equal(report.processProtocol, undefined);
		assert.ok(!fake.events.some(event => event.method === gc || event.method === 'read'));
	});

	it('uses config warmups/rounds, rotation/reversal, and chronological IDs', async () => {
		const variants = ['uplot', 'chartjs', 'idle'];
		const fake = fixture({config: {variants, dpr: 2, warmups: 3, rounds: 7}});
		const report = await fake.capture();
		assert.equal(report.samples.length, 30);
		assert.deepEqual(report.samples.slice(0, 12).map(sample => sample.variant), [
			'uplot', 'chartjs', 'idle', 'uplot', 'idle', 'chartjs', 'idle', 'uplot', 'chartjs', 'idle', 'chartjs', 'uplot',
		]);
		for (const variant of variants) {
			const samples = report.samples.filter(sample => sample.variant === variant);
			assert.deepEqual(samples.map(sample => sample.round), [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
			assert.equal(samples.filter(sample => sample.warmup).length, 3);
			assert.equal(samples.filter(sample => !sample.warmup).length, 7);
		}
		report.samples.forEach((sample, index) => {
			assert.equal(sample.id, `sample-${index}`);
			assert.equal(sample.dpr, 2);
			assert.equal(sample.warmup, sample.round < 0);
		});
	});

	it('polls independently while each renderer evaluation is blocked, waiting the requested interval after responses', async () => {
		const signals = {prepare: signal(), construct: signal()};
		const polls = {prepare: 0, construct: 0};
		const fake = fixture({
			memory: true,
			operation: method => signals[method] && waitFor(signals[method].promise),
			read: async (count, phase) => {
				if (signals[phase]) {
					await delay(8);
					if (++polls[phase] === 3)
						signals[phase].resolve();
				}
			},
		});
		const report = await fake.capture({processPollIntervalMs: 10});
		assert.equal(report.processProtocol.requestedProcessPollIntervalMs, 10);
		for (const phase of ['prepare', 'construct']) {
			const observations = report.samples[0].processObservations.filter(read => read.phase === phase && read.kind === 'poll');
			assert.equal(observations.length, 3);
			for (let i = 1; i < observations.length; i++)
				assert.ok(observations[i].processRequestedAtMs - observations[i - 1].processTimestampMs >= 8);
		}
	});

	it('drains an in-flight read before phase endpoints, GC, and destruction', async () => {
		const started = {prepare: signal(), construct: signal()};
		const fake = fixture({
			memory: true,
			operation: method => started[method] && waitFor(started[method].promise),
			read: async (count, phase) => {
				if (started[phase]) {
					started[phase].resolve();
					await delay(15);
				}
			},
		});
		await assertSettled(fake, () => fake.capture({processPollIntervalMs: 1}));
		for (const phase of ['prepare', 'construct']) {
			const end = fake.events.findIndex(event => event.method === `${phase}:end`);
			assert.equal(fake.events[end + 1].method, 'read:end');
			assert.equal(fake.events[end + 2].method, 'read');
		}
	});

	for (const phase of ['setup', 'prepare', 'construct']) {
		it(`destroys after ${phase} failure and preserves the primary error over destruction errors`, async () => {
			const primary = new Error(phase);
			const fake = fixture({memory: true, operation: method => {
				if (method === phase) throw primary;
				if (method === 'destroy') throw new Error('destroy');
			}});
			await assertSettled(fake, () => assert.rejects(fake.capture(), error => error === primary));
			assert.equal(fake.events.filter(event => event.method === 'destroy').length, 1);
			assert.equal(fake.events.at(-1).method, 'destroy:end');
		});
	}

	for (const readNumber of [1, 2, 3, 4, 5, 6, 7, 8]) {
		it(`propagates process read ${readNumber} failure and still destroys exactly once`, async () => {
			const primary = new Error(`read ${readNumber}`);
			const fake = fixture({memory: true, read: count => { if (count === readNumber) throw primary; }});
			await assertSettled(fake, () => assert.rejects(fake.capture(), error => error === primary));
			assert.equal(fake.events.filter(event => event.method === 'destroy').length, 1);
		});
	}

	for (const phase of ['prepare', 'construct']) {
		for (const evaluationFails of [false, true]) {
			it(`drains a rejecting ${phase} poll and preserves ${evaluationFails ? 'evaluation' : 'poll'} failure over cleanup`, async () => {
				const started = signal();
				const primary = new Error('evaluate');
				const polling = new Error('poll');
				const fake = fixture({
					memory: true,
					operation: async method => {
						if (method === phase) {
							await waitFor(started.promise);
							if (evaluationFails) throw primary;
						}
						if (method === 'destroy') throw new Error('cleanup');
					},
					read: async (count, active) => {
						if (active === phase) {
							started.resolve();
							await delay(15);
							throw polling;
						}
					},
				});
				await assertSettled(fake, () => assert.rejects(fake.capture({processPollIntervalMs: 1}), error => error === (evaluationFails ? primary : polling)));
				const end = fake.events.findIndex(event => event.method === `${phase}:end`);
				assert.deepEqual(fake.events.slice(end + 1).map(event => event.method), ['read:end', 'destroy', 'destroy:end']);
			});
		}
	}

	it('surfaces destruction failure without cleanup GC on an otherwise successful sample', async () => {
		const primary = new Error('destroy');
		const fake = fixture({memory: true, operation: method => { if (method === 'destroy') throw primary; }});
		await assert.rejects(fake.capture(), error => error === primary);
		assert.equal(fake.events.filter(event => event.method === gc).length, 2);
		assert.equal(fake.events.at(-1).method, 'destroy:end');
	});

	it('cleans up on a checkpoint GC rejection', async () => {
		const primary = new Error('GC');
		const fake = fixture({memory: true, gc: () => { throw primary; }});
		await assert.rejects(fake.capture(), error => error === primary);
		assert.equal(fake.events.at(-1).method, 'destroy:end');
	});

	for (const blocked of ['setup', 'prepare', 'construct', 'destroy', 'baseline GC', 'live GC', 'cleanup GC', ...Array.from({length: 8}, (_, i) => `read ${i + 1}`)]) {
		it(`uses the sample deadline for stalled ${blocked} without starting more work`, async () => {
			const clock = collectorClock();
			const entered = signal();
			let rejectPending;
			const pending = new Promise((resolve, reject) => { rejectPending = reject; });
			const stall = name => {
				if (name === blocked) {
					entered.resolve();
					return pending;
				}
			};
			let gcCount = 0;
			const fake = fixture({
				collector: clock.capture, memory: true,
				operation: stall,
				gc: () => stall(['baseline GC', 'live GC', 'cleanup GC'][gcCount++]),
				read: count => stall(`read ${count}`),
			});
			const timeouts = [];
			const unhandled = [];
			const listener = error => unhandled.push(error);
			process.on('unhandledRejection', listener);
			try {
				const capture = fake.capture({onSampleTimeout: error => {
					timeouts.push(error);
					throw new Error('callback failure');
				}});
				const rejected = assert.rejects(capture, error => {
					assert.equal(error, timeouts[0]);
					assert.equal(error.message, 'uplot: timed out after 5s');
					assert.equal(error.code, 'BENCHMARK_SAMPLE_TIMEOUT');
					assert.equal(error.variant, 'uplot');
					assert.equal(error.timeoutMs, 5000);
					return true;
				});
				await waitFor(entered.promise);
				clock.advance(4999);
				assert.equal(timeouts.length, 0);
				clock.advance(1);
				assert.equal(timeouts.length, 1, 'timeout callback runs before pending operations settle');
				await rejected;
				rejectPending(new Error('late browser failure'));
				await delay(0);
				const count = fake.events.length;
				clock.advance(120000);
				await delay(0);
				assert.equal(fake.events.length, count);
				assert.equal(timeouts.length, 1);
				assert.equal(clock.timers.size, 0);
				assert.deepEqual(unhandled, []);
				const destroyed = ['destroy', 'cleanup GC', 'read 8'].includes(blocked);
				assert.equal(fake.events.filter(event => event.method === 'destroy').length, destroyed ? 1 : 0);
			}
			finally {
				process.removeListener('unhandledRejection', listener);
			}
		});
	}

	for (const phase of ['prepare', 'construct']) {
		it(`bounds a stalled ${phase} poll drain and skips destruction`, async () => {
			const clock = collectorClock();
			const evaluating = signal();
			const polled = signal();
			const returned = signal();
			const fake = fixture({
				collector: clock.capture, memory: true,
				operation: async method => {
					if (method === phase) {
						evaluating.resolve();
						await polled.promise;
						returned.resolve();
					}
				},
				read: (count, active) => {
					if (active === phase) {
						polled.resolve();
						return new Promise(() => {});
					}
				},
			});
			const timeouts = [];
			const capture = fake.capture({processPollIntervalMs: 1, onSampleTimeout: error => timeouts.push(error)});
			const rejected = assert.rejects(capture, error => error === timeouts[0]);
			await waitFor(evaluating.promise);
			clock.advance(1);
			await waitFor(returned.promise);
			// Let evaluation finish so the collector is draining the blocked poll.
			await delay(0);
			clock.advance(4999);
			await rejected;
			assert.equal(timeouts.length, 1);
			assert.equal(clock.timers.size, 0);
			assert.ok(!fake.events.some(event => event.method === 'destroy'));
			const count = fake.events.length;
			clock.advance(120000);
			await delay(0);
			assert.equal(fake.events.length, count);
		});
	}

	it('uses one cumulative deadline across phases rather than resetting each phase', async () => {
		const clock = collectorClock();
		const timeouts = [];
		const fake = fixture({
			collector: clock.capture, memory: true,
			operation: () => clock.advance(700),
			gc: () => clock.advance(700),
			read: () => clock.advance(100),
		});
		await assert.rejects(fake.capture({processPollIntervalMs: 10000, onSampleTimeout: error => timeouts.push(error)}), error => error === timeouts[0]);
		assert.equal(timeouts.length, 1);
		assert.equal(fake.events.filter(event => event.method === gc).length, 3, 'budget lasts through destruction, but expires in cleanup GC');
		assert.equal(fake.events.filter(event => event.method === 'read').length, 7, 'no cleanup read after timeout');
		assert.equal(clock.timers.size, 0);
	});

	it('resets the full budget for every variant and sample, including warmups', async () => {
		const clock = collectorClock();
		const fake = fixture({
			collector: clock.capture, memory: true,
			config: {variants: ['uplot', 'chartjs'], warmups: 3, rounds: 7},
			operation: () => clock.advance(500),
			gc: () => clock.advance(500),
			read: () => clock.advance(100),
		});
		const report = await fake.capture({sampleTimeoutMs: 4500, processPollIntervalMs: 10000, onSampleTimeout: () => assert.fail('sample must fit its own budget')});
		assert.equal(report.samples.length, 20);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 6);
		assert.equal(report.sampleTimeoutMs, 4500);
		assert.equal(report.processProtocol.sampleTimeoutMs, 4500);
		assert.equal(clock.timers.size, 0);
		clock.advance(120000);
	});

	it('preserves the watchdog error if normal failure cleanup stalls', async () => {
		const clock = collectorClock();
		const destroying = signal();
		const timeouts = [];
		const fake = fixture({collector: clock.capture, operation: method => {
			if (method === 'prepare') throw new Error('primary');
			if (method === 'destroy') {
				destroying.resolve();
				return new Promise(() => {});
			}
		}});
		const rejected = assert.rejects(fake.capture({onSampleTimeout: error => timeouts.push(error)}), error => error === timeouts[0]);
		await waitFor(destroying.promise);
		clock.advance(5000);
		await rejected;
		assert.equal(timeouts.length, 1);
		assert.equal(clock.timers.size, 0);
	});

	it('retains the command fallback for begin before any sample is active', async () => {
		const clock = collectorClock();
		const entered = signal();
		let timeouts = 0;
		const capture = clock.capture({}, () => {
			entered.resolve();
			return new Promise(() => {});
		}, {onSampleTimeout: () => timeouts++});
		const rejected = assert.rejects(capture, /benchmarkLifecycle.begin\(\) timed out after 30000ms/);
		await waitFor(entered.promise);
		clock.advance(5000);
		assert.equal(timeouts, 0);
		clock.advance(25000);
		await rejected;
		assert.equal(timeouts, 0);
		assert.equal(clock.timers.size, 0);
	});

	it('validates arguments before begin and config before setup', async () => {
		for (const sampleTimeoutMs of [0, -1, NaN, Infinity, '5000']) {
			const fake = fixture();
			await assert.rejects(fake.capture({sampleTimeoutMs}), /positive and finite/);
			assert.deepEqual(fake.events, []);
		}
		for (const onSampleTimeout of [null, false, {}]) {
			const fake = fixture();
			await assert.rejects(fake.capture({onSampleTimeout}), /must be a function/);
			assert.deepEqual(fake.events, []);
		}
		for (const processPollIntervalMs of [0, -1, NaN, Infinity, '50']) {
			const fake = fixture();
			await assert.rejects(fake.capture({processPollIntervalMs}), /positive and finite/);
			assert.deepEqual(fake.events, []);
		}
		for (const processRead of [false, {}, 1]) {
			const fake = fixture();
			await assert.rejects(fake.capture({processRead}), /function or null/);
			assert.deepEqual(fake.events, []);
		}
		for (const config of [{variants: []}, {variants: ['a', 'a']}, {variants: [1]}, {dpr: 0}, {warmups: -1}, {rounds: 1.5}]) {
			const fake = fixture({config});
			await assert.rejects(fake.capture(), /Invalid benchmarkLifecycle config/);
			assert.deepEqual(fake.events, [{method: 'begin'}]);
		}
	});
});
