import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepData, makeChart, destroyChart} from '../../bench/chartgpu.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const data = Object.freeze(prepData(packed));
const turn = () => new Promise(resolve => setImmediate(resolve));

function vendor({failure, cleanupError, createGate, workGate, noFrame = false, noSubmit = false, dirty = false} = {}) {
	const state = {events: [], devices: [], instances: [], error: new Error('vendor failure'), listeners: new Map()};
	const step = name => {
		state.events.push(name);
		if (failure === name) throw state.error;
	};
	const document = {createElement(tag) {
		return {
			tag, style: {}, children: [], ownerDocument: document,
			append(...children) {
				for (const child of children) { child.parent = this; this.children.push(child); }
			},
			remove() {
				if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
				this.parent = null;
			},
		};
	}};
	state.host = document.createElement('div');
	state.adapter = {
		info: {isFallbackAdapter: false},
		async requestDevice(...args) {
			assert.deepEqual(args, []);
			step('requestDevice');
			const lost = Promise.withResolvers();
			const listeners = new Map();
			const device = {
				lost: lost.promise,
				queue: Object.create({
					submit(buffers) {
						assert.equal(this, device.queue);
						assert.deepEqual(buffers, ['frame']);
						step('submit');
					},
					onSubmittedWorkDone() {
						step('workDone');
						if (failure === 'workRejected') return Promise.reject(state.error);
						return workGate ?? Promise.resolve();
					},
				}),
				addEventListener(name, callback) { step('listen'); listeners.set(name, callback); },
				removeEventListener(name, callback) {
					assert.equal(listeners.get(name), callback);
					listeners.delete(name);
					step('unlisten');
				},
				destroy() {
					step('destroy');
					lost.resolve({reason: 'destroyed', message: 'intentional'});
					if (cleanupError) throw cleanupError;
				},
			};
			state.devices.push(device);
			Object.assign(state, {device, lost, listeners});
			return device;
		},
	};
	Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {gpu: {
		async requestAdapter(...args) {
			assert.deepEqual(args, []);
			step('requestAdapter');
			return state.adapter;
		},
	}}});
	globalThis.benchmarkChartGPU = {ChartGPU: {async create(container, options, context) {
		Object.assign(state, {container, options, context});
		step('create');
		if (createGate) await createGate;
		if (failure === 'createRejected') throw state.error;
		const instance = {
			renderFrame() {
				step('render');
				if (noFrame) return false;
				if (!noSubmit) queueMicrotask(() => context.device.queue.submit(['frame']));
				return true;
			},
			needsRender: () => dirty,
			setRenderMode(mode) { assert.equal(mode, 'auto'); step('auto'); },
			dispose() { step('dispose'); if (cleanupError) throw cleanupError; },
		};
		state.instances.push(instance);
		return instance;
	}}};
	return state;
}

function checkCleanup(state, count = 1) {
	assert.equal(state.events.filter(event => event === 'destroy').length, count);
	assert.equal(state.listeners.size, 0);
	assert.equal(state.host.children.length, 0);
	for (const device of state.devices)
		assert.equal(Object.hasOwn(device.queue, 'submit'), false);
}

function autoDomain(axis) {
	for (const key of ['min', 'max', 'domain', 'tickCount', 'tickValues'])
		assert.equal(axis[key], undefined);
}

describe('ChartGPU benchmark adapter (no browser)', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['navigator', 'benchmarkChartGPU', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	it('prepares every value in all 55,550 rows without mutating or allocating a device', () => {
		const state = vendor();
		const before = packed.slice();
		const again = prepData(packed);
		assert.deepEqual(Object.keys(again), ['x', 'cpu', 'ram', 'tcp']);
		for (const key of Object.keys(data)) {
			assert.ok(again[key] instanceof Float64Array);
			assert.equal(again[key].length, 55550);
			assert.notEqual(again[key].buffer, data[key].buffer);
			assert.deepEqual(again[key], data[key]);
		}
		for (let j = 0; j < 55550; j++) {
			const i = packed[0] + 1 + j * packed[0];
			assert.equal(again.x[j], packed[i] * 60000);
			assert.equal(again.cpu[j], Math.round((100 - packed[i + 1]) * 1000) / 1000);
			assert.equal(again.ram[j], Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100);
			assert.equal(again.tcp[j], packed[i + 3]);
		}
		assert.deepEqual(packed, before);
		assert.deepEqual(state.events, []);
		const irregular = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
			10, 100, 2, 0, 4, 0, 75, 17, 87.6543, 2, 9, 4, 1, 2]);
		assert.deepEqual(prepData(irregular), {
			x: new Float64Array([600000, 1020000]), cpu: new Float64Array([0, 12.346]),
			ram: new Float64Array([0, 33.33]), tcp: new Float64Array([0, 9]),
		});
		for (const column of Object.values(prepData(irregular.slice(0, 8)))) assert.equal(column.length, 0);
	});

	it('uses native time/dual axes, full typed columns, default AA, and one-device-pixel lines', async () => {
		const state = vendor();
		const before = structuredClone(data);
		const chart = await makeChart(data, state.host, undefined, Object.freeze({renderer: 'ignored'}));
		assert.equal(chart.instance, state.instances[0]);
		assert.equal(chart.device, state.device);
		assert.deepEqual(state.context, {adapter: state.adapter, device: state.device});
		assert.deepEqual(chart.getWebGPUDevices(), [state.device]);
		const o = state.options;
		assert.equal(o.animation, false);
		assert.equal(o.renderMode, 'external');
		assert.deepEqual(o.performance, {lod: 'strict'});
		assert.equal(o.antialias, undefined);
		assert.equal(o.devicePixelRatio, undefined);
		assert.equal(o.title, undefined);
		assert.equal(o.theme, 'light');
		assert.deepEqual(o.xAxis, {type: 'time'});
		assert.equal(o.yAxis, undefined);
		assert.deepEqual(o.axes.y.map(({tickFormatter, ...axis}) => axis), [
			{id: 'percent', type: 'value', position: 'left'},
			{id: 'tcp', type: 'value', position: 'right'},
		]);
		assert.equal(o.axes.y[0].tickFormatter(7.5), '7.5%');
		assert.equal(o.axes.y[1].tickFormatter(7.5), '7.5 MB');
		for (const axis of [o.xAxis, ...o.axes.y]) autoDomain(axis);
		assert.deepEqual(o.legend, {show: true, position: 'top'});
		assert.deepEqual(o.tooltip, {show: true, trigger: 'axis'});
		assert.equal(o.series.length, 3);
		for (const [i, key] of ['cpu', 'ram', 'tcp'].entries()) {
			const series = o.series[i];
			assert.equal(series.type, 'line');
			assert.equal(series.name, ['CPU', 'RAM', 'TCP Out'][i]);
			assert.equal(series.color, ['red', 'blue', 'green'][i]);
			assert.equal(series.yAxis, i === 2 ? 'tcp' : 'percent');
			assert.equal(series.data.x, data.x);
			assert.equal(series.data.y, data[key]);
			assert.equal(series.sampling, 'none');
			assert.deepEqual(series.lineStyle, {width: 0.5});
			assert.equal(series.areaStyle, undefined);
		}
		assert.equal(chart.element.style.width, '1920px');
		assert.equal(chart.element.style.height, '600px');
		assert.equal(chart.element.children[0].textContent, 'Server Events');
		assert.equal(state.container, chart.element.children[1]);
		assert.equal(state.container.style.height, '576px');
		destroyChart(chart);
		assert.deepEqual(data, before);
		checkCleanup(state);
	});

	it('waits for creation, actual microtask submission, and GPU completion before enabling auto mode', async () => {
		const creation = Promise.withResolvers();
		const work = Promise.withResolvers();
		const state = vendor({createGate: creation.promise, workGate: work.promise});
		const wait = {textContent: 'Rendering...'};
		let finished = false;
		const pending = makeChart(data, state.host, wait).then(chart => { finished = true; return chart; });
		await turn();
		assert.deepEqual(state.events, ['requestAdapter', 'requestDevice', 'listen', 'create']);
		assert.equal(finished, false);
		creation.resolve();
		await turn();
		assert.deepEqual(state.events, ['requestAdapter', 'requestDevice', 'listen', 'create', 'render', 'submit', 'workDone']);
		assert.equal(finished, false);
		assert.equal(wait.textContent, 'Rendering...');
		assert.equal(Object.hasOwn(state.device.queue, 'submit'), false);
		work.resolve();
		const chart = await pending;
		assert.equal(wait.textContent, 'Done!');
		assert.equal(state.events.at(-1), 'auto');
		destroyChart(chart);
		destroyChart(chart);
		assert.deepEqual(chart.getWebGPUDevices(), []);
		assert.deepEqual(state.events.slice(-3), ['unlisten', 'dispose', 'destroy']);
		await turn();
		assert.equal(chart.error, null);
		checkCleanup(state);
	});

	it('creates a fresh device and instance for every chart, without a warm cache', async () => {
		const state = vendor();
		delete globalThis.devicePixelRatio;
		delete state.adapter.info;
		const first = await makeChart(data, state.host);
		assert.equal(state.options.series[0].lineStyle.width, 1);
		const firstDevice = first.device;
		destroyChart(first);
		const second = await makeChart(data, state.host);
		assert.notEqual(second.device, firstDevice);
		assert.notEqual(state.instances[0], second.instance);
		assert.equal(state.events.filter(event => event === 'requestAdapter').length, 2);
		assert.equal(state.events.filter(event => event === 'requestDevice').length, 2);
		destroyChart(second);
		checkCleanup(state, 2);
	});

	for (const unsupported of ['navigator', 'gpu', 'adapter', 'fallback']) {
		it(`rejects unsupported ${unsupported} without requesting a device`, async () => {
			const state = vendor();
			if (unsupported === 'navigator') delete globalThis.navigator;
			if (unsupported === 'gpu') delete navigator.gpu;
			if (unsupported === 'adapter') state.adapter = null;
			if (unsupported === 'fallback') state.adapter.info.isFallbackAdapter = true;
			await assert.rejects(makeChart(data, state.host), /ChartGPU requires/);
			assert.equal(state.events.includes('requestDevice'), false);
			assert.equal(state.host.children.length, 0);
		});
	}

	for (const failure of ['requestAdapter', 'requestDevice', 'create', 'createRejected', 'render', 'submit', 'workDone', 'workRejected', 'auto']) {
		it(`preserves ${failure} errors and releases resources even if cleanup throws`, async () => {
			const state = vendor({failure, cleanupError: new Error('cleanup failed')});
			const wait = {textContent: 'Rendering...'};
			await assert.rejects(makeChart(data, state.host, wait), error => error === state.error);
			assert.equal(wait.textContent, 'Rendering...');
			checkCleanup(state, ['requestAdapter', 'requestDevice'].includes(failure) ? 0 : 1);
			assert.equal(state.events.filter(event => event === 'dispose').length,
				['requestAdapter', 'requestDevice', 'create', 'createRejected'].includes(failure) ? 0 : 1);
		});
	}

	for (const option of ['noFrame', 'noSubmit', 'dirty']) {
		it(`rejects ${option} instead of treating an empty queue as a rendered chart`, async () => {
			const state = vendor({[option]: true});
			await assert.rejects(makeChart(data, state.host), /did not submit its initial frame/);
			assert.equal(state.events.includes('workDone'), false);
			assert.equal(state.events.includes('auto'), false);
			checkCleanup(state);
		});
	}

	for (const phase of ['creation', 'work', 'ready']) {
		for (const kind of ['uncaptured', 'lost', 'lostRejected']) {
			it(`handles ${kind} during ${phase} without unhandled promises or leaked resources`, async () => {
				const gate = Promise.withResolvers();
				const state = vendor({
					createGate: phase === 'creation' ? gate.promise : undefined,
					workGate: phase === 'work' ? gate.promise : undefined,
				});
				const wait = {textContent: 'Rendering...'};
				const pending = makeChart(data, state.host, wait);
				let chart;
				if (phase === 'ready') chart = await pending;
				await turn();
				const rejection = phase === 'ready' ? null : assert.rejects(pending, /device lost|WebGPU error|vendor failure/);
				if (kind === 'uncaptured') state.listeners.get('uncapturederror')({error: {message: 'validation failed'}});
				if (kind === 'lost') state.lost.resolve({reason: 'unknown', message: 'GPU reset'});
				if (kind === 'lostRejected') state.lost.reject(state.error);
				await turn();
				if (phase === 'creation') gate.resolve();
				if (rejection) await rejection;
				else {
					assert.ok(chart.error);
					assert.notEqual(wait.textContent, 'Done!');
					assert.deepEqual(chart.getWebGPUDevices(), []);
					destroyChart(chart);
				}
				checkCleanup(state);
			});
		}
	}

	it('finishes explicit destruction after dispose fails, and remains idempotent', async () => {
		const error = new Error('dispose failed');
		const state = vendor({cleanupError: error});
		const chart = await makeChart(data, state.host);
		assert.throws(() => destroyChart(chart), actual => actual === error);
		assert.doesNotThrow(() => destroyChart(chart));
		assert.deepEqual(chart.getWebGPUDevices(), []);
		checkCleanup(state);
	});

	it('uses only the shared runner in the HTML entry point', () => {
		const html = readFileSync(new URL('../../bench/ChartGPU.html', import.meta.url), 'utf8');
		const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
		assert.equal(scripts.length, 1);
		assert.equal(scripts[0][1].trim(), 'type="module"');
		assert.equal(scripts[0][2].trim(), "import {runDemo} from './demo.mjs';\n\t\t\trunDemo('chartgpu').catch(console.error);");
		assert.doesNotMatch(html, /<style\b|<link\b|<canvas\b|fetch\(|https?:|style=/);
	});
});
