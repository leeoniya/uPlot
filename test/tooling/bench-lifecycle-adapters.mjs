import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLifecycleAdapter, prepareLifecycleInput, lifecycleRows} from '../../scripts/bench-lifecycle-adapters.mjs';

const packed = JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url)));
const ids = ['uplot', 'plotly', 'scichart', 'chartgpu'];
const keys = ['x', 'cpu', 'ram', 'tcp'];
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
};
const columns = (id, input) => Array.isArray(input) ? input : keys.map(key => input[key]);
function inputFor(id, shift = 0) {
	const input = prepareLifecycleInput(id, packed);
	columns(id, input).forEach((column, c) => {
		for (let i = 0; i < column.length; i++) column[i] += shift * (c === 0 ? 86400000 : c);
	});
	return input;
}

function event() {
	const listeners = new Set();
	return {
		listeners,
		subscribe: callback => listeners.add(callback),
		unsubscribe: callback => listeners.delete(callback),
		emit(value) { for (const callback of [...listeners]) callback(value); },
	};
}

function vendors() {
	const state = {events: [], charts: [], devices: [], dropUpdate: false, workGate: null, plotGate: null, sciHold: false};
	class Canvas {
		getContext(type) {
			state.events.push(`getContext:${type}`);
			return this.context ??= {canvas: this};
		}
	}
	globalThis.HTMLCanvasElement = Canvas;
	globalThis.OffscreenCanvas = class extends Canvas {};
	const document = {createElement(tag) {
		return {
			tag, style: {}, ownerDocument: document, children: [],
			clientWidth: 1920, clientHeight: 576,
			getBoundingClientRect: () => ({left: 0, top: 24, width: 1920, height: 576}),
			querySelector(tag) { return this.children.find(child => child.tag === tag) ?? this.children.map(child => child.querySelector(tag)).find(Boolean); },
			append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
			remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); },
		};
	}};
	state.host = document.createElement('div');
	Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 1});
	globalThis.uPlot = class {
		constructor(options, data) {
			this.options = options;
			this.series = options.series;
			this.data = data;
			new Canvas().getContext('2d');
			state.charts.push(this);
		}
		setData(data, reset) {
			assert.equal(reset, true);
			state.events.push('setData');
			if (!state.dropUpdate) this.data = data;
		}
		destroy() { state.events.push('destroy'); }
	};
	globalThis.Plotly = {
		version: '4.1.2',
		async newPlot(host, traces, layout, config) {
			state.events.push('newPlot');
			state.charts.push(host);
			host.data = traces;
			host._fullData = traces.map(trace => trace.x.length ? trace : {...trace, _length: 0, visible: false, mode: undefined});
			host.layout = layout;
			host.config = config;
			host.gl = new Canvas().getContext('webgl');
			if (state.plotGate) await state.plotGate.promise;
			return host;
		},
		async react(host, traces, layout) {
			assert.equal(host, state.host);
			state.events.push('react');
			if (!state.dropUpdate) { host.data = host._fullData = traces; host.layout = layout; }
			if (state.plotGate) await state.plotGate.promise;
			return host;
		},
		purge() { state.events.push('destroy'); },
	};
	const collection = () => ({values: [], add(value) { this.values.push(value); }, asArray() { return this.values; }});
	const licenseTypes = {LICENSE_TYPE_FULL: 1, LICENSE_TYPE_TRIAL: 2, LICENSE_TYPE_COMMUNITY: 3};
	globalThis.benchmarkSciChartOptions = {wasmUrl: '/wasm', wasmNoSimdUrl: '/no-simd', timeoutMs: 1000};
	class Axis { constructor(context, options) { Object.assign(this, options); } }
	globalThis.SciChart = {
		SciChartDefaults: {}, EUseWasm64: {Never: 0}, EUseWasmSimd: {Auto: 1},
		SciChartJSLightTheme: class {}, DateTimeNumericAxis: Axis, NumericAxis: Axis,
		EAutoRange: {Always: 'Always'}, EAxisAlignment: {Left: 'Left', Right: 'Right'}, EResamplingMode: {Auto: 'Auto'},
		SciChartSurface: {
			configure(options) { assert.deepEqual(options, {wasmUrl: '/wasm', wasmNoSimdUrl: '/no-simd'}); },
			UseCommunityLicense() { state.events.push('community'); },
			async createSingle(host, options) {
				assert.equal(options.createSuspended, true);
				const surface = {
					xAxes: collection(), yAxes: collection(), renderableSeries: collection(),
					renderInstructionsCompleted: event(), renderError: event(), isSuspended: true,
					isInvalidated: false, isRunningAnimation: false, isDeleted: false,
					getLicenseContext: () => ({SCRTCredentials: {GetLicenseType: () => state.license ?? 3}, SCRTLicenseType: licenseTypes}),
					suspendUpdates() { assert.equal(this.isSuspended, false); this.isSuspended = true; state.events.push('suspend'); },
					resumeUpdates(options) {
						assert.equal(options.invalidateOnResume, true);
						assert.equal(this.isSuspended, true);
						this.isSuspended = false;
						state.events.push('resume');
						if (!state.sciHold) queueMicrotask(() => this.renderInstructionsCompleted.emit(false));
					},
					delete() { this.isDeleted = true; state.events.push('destroy'); },
				};
				state.charts.push(surface);
				surface.gl = new Canvas().getContext('webgl2');
				return {sciChartSurface: surface, wasmContext: {}};
			},
		},
		XyDataSeries: class {
			constructor(context, options) { this.options = options; this.x = []; this.y = []; }
			clear() {
				assert.equal(state.charts.at(-1).isSuspended, true);
				state.events.push('clear');
				if (!state.dropUpdate) this.x = this.y = [];
			}
			appendRange(x, y) {
				assert.equal(state.charts.at(-1).isSuspended, true);
				state.events.push(`append:${x.length}`);
				if (!state.dropUpdate) { this.x = Array.from(x); this.y = Array.from(y); }
			}
			count() { return this.x.length; }
			getNativeXValues() { return {size: () => this.x.length, get: i => this.x[i]}; }
			getNativeYValues() { return {size: () => this.y.length, get: i => this.y[i]}; }
		},
		FastLineRenderableSeries: class { constructor(context, options) { Object.assign(this, options); } },
	};
	const lost = deferred();
	const device = {
		lost: lost.promise,
		queue: Object.create({
			submit(buffers) {
				assert.deepEqual(buffers, ['frame']);
				state.events.push('submit');
				if (state.submitError) throw state.submitError;
			},
			onSubmittedWorkDone() { state.events.push('workDone'); return state.workGate?.promise ?? Promise.resolve(); },
		}),
		addEventListener() {}, removeEventListener() {}, destroy() { state.events.push('deviceDestroy'); },
	};
	state.device = device;
	const gpuAdapter = {async requestDevice() { state.devices.push(device); return device; }};
	Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {gpu: {async requestAdapter() { return gpuAdapter; }}}});
	globalThis.benchmarkChartGPU = {ChartGPU: {async create(host, options, context) {
		assert.equal(context.device, device);
		host.append(document.createElement('canvas'));
		const copyStore = options => options.series.map(series => ({x: Array.from(series.data.x), y: Array.from(series.data.y)}));
		const chart = {
			options, store: copyStore(options), counts: options.series.map(series => series.data.x.length),
			mode: options.renderMode, dirty: true, disposed: false,
			setOption(next) {
				state.events.push('setOption');
				assert.equal(this.mode, 'external');
				if (!state.dropUpdate) {
					this.options = next;
					if (!state.staleStore) this.store = copyStore(next);
					this.counts = next.series.map(series => series.data.x.length);
					this.dirty = true;
				}
			},
			getHitTestSeriesPointCount(i) { return this.counts[i]; },
			hitTest({clientX, clientY}) {
				const allY = this.store.flatMap(series => series.y);
				let minY = Infinity, maxY = -Infinity;
				for (const y of allY) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
				const x = this.store[0].x;
				const index = Math.round((clientX - 70) / (1920 - 70 - 80) * (x.length - 1));
				const targetY = minY + (1 - (clientY - 24 - 40) / (576 - 80)) * (maxY - minY);
				let best = 0;
				for (let s = 1; s < 3; s++)
					if (Math.abs(this.store[s].y[index] - targetY) < Math.abs(this.store[best].y[index] - targetY)) best = s;
				return {match: {kind: 'cartesian', seriesIndex: best, dataIndex: index, value: [x[index], this.store[best].y[index]]}};
			},
			setRenderMode(mode) { this.mode = mode; }, getRenderMode() { return this.mode; },
			needsRender() { return this.dirty; },
			renderFrame() {
				if (!this.dirty) return false;
				assert.equal(this.mode, 'external');
				this.dirty = false;
				if (!state.noSubmit) queueMicrotask(() => device.queue.submit(['frame']));
				return true;
			},
			dispose() { this.disposed = true; state.events.push('destroy'); },
		};
		state.charts.push(chart);
		return chart;
	}}};
	return state;
}

describe('diagnostic lifecycle adapters (no browser)', () => {
	let saved;
	beforeEach(() => {
		saved = new Map(['navigator', 'benchmarkChartGPU', 'benchmarkSciChartOptions', 'SciChart', 'Plotly',
			'uPlot', 'devicePixelRatio', 'HTMLCanvasElement', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	});
	afterEach(() => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	it('rejects unsupported adapters and incomplete packed data', () => {
		assert.throws(() => createLifecycleAdapter('unknown'), /unsupported/);
		assert.throws(() => createLifecycleAdapter('__proto__'), /unsupported/);
		assert.throws(() => prepareLifecycleInput('plotly', packed.slice(0, -7)), /complete rows/);
	});

	for (const id of ids) {
		it(`${id}: prepares fresh full columns, without a chart or device`, () => {
			const state = vendors();
			const a = inputFor(id), b = inputFor(id);
			const ac = columns(id, a), bc = columns(id, b);
			for (let i = 0; i < 4; i++) {
				assert.equal(ac[i].length, 55550);
				assert.notEqual(ac[i], bc[i]);
				assert.deepEqual(ac[i], bc[i]);
			}
			assert.equal(ac[0][0], packed[8] * (['plotly', 'chartgpu'].includes(id) ? 60000 : 60));
			assert.deepEqual(state.events, []);
			assert.deepEqual(state.devices, []);
		});

		for (const populated of [false, true]) {
			it(`${id}: ${populated ? 'direct populated' : 'genuinely empty'} creation then repeated full replacements`, async () => {
				const state = vendors(), adapter = createLifecycleAdapter(id);
				const getContext = HTMLCanvasElement.prototype.getContext;
				const initial = populated ? inputFor(id) : null;
				const handle = await adapter.create(state.host, initial);
				const chart = handle.chart;
				assert.equal(HTMLCanvasElement.prototype.getContext, getContext);
				assert.equal(state.charts.length, 1);
				assert.equal(adapter.validate(handle, initial).totalPoints, populated ? 166650 : 0);
				if (!populated && id === 'scichart') assert.equal(state.events.filter(e => e === 'append:0').length, 3);
				if (id === 'scichart') {
					assert.ok(state.events.includes('community'));
					assert.equal(chart.xAxes.asArray()[0].autoRange, 'Always');
				}
				const gl = adapter.contexts(handle), devices = adapter.devices(handle);
				assert.equal(gl.length, ['scichart', 'plotly'].includes(id) ? 1 : 0);
				assert.equal(devices.length, id === 'chartgpu' ? 1 : 0);
				for (const shift of [1, 2, 3]) {
					const next = inputFor(id, shift);
					const start = state.events.length;
					await adapter.update(handle, next);
					const summary = adapter.validate(handle, next);
					assert.deepEqual(summary.series.map(series => series.count), [55550, 55550, 55550]);
					if (populated || shift > 1)
						assert.ok(summary.series.every(series => series.samples.every(sample => sample.changedY === true)));
					assert.equal(handle.chart, chart);
					assert.deepEqual(adapter.contexts(handle), gl);
					assert.deepEqual(adapter.devices(handle), devices);
					assert.equal(state.charts.length, 1);
					if (id === 'scichart') assert.deepEqual(state.events.slice(start), [
						'suspend', 'clear', 'append:55550', 'clear', 'append:55550', 'clear', 'append:55550', 'resume',
					]);
					if (id === 'plotly') {
						assert.deepEqual(chart.layout.xaxis, {type: 'date', autorange: true});
						assert.equal(chart._fullData[0].x, next[0]);
						assert.equal(chart.layout.yaxis.autorange, true);
						assert.equal(chart.layout.yaxis2.autorange, true);
					}
					if (id === 'chartgpu') assert.deepEqual(state.events.slice(start), ['setOption', 'submit', 'workDone']);
				}
				await adapter.destroy(handle);
				await adapter.destroy(handle);
				assert.deepEqual(adapter.contexts(handle), []);
				assert.deepEqual(adapter.devices(handle), []);
				assert.equal(state.events.filter(e => e === 'destroy').length, 1);
				assert.throws(() => adapter.validate(handle, null), /destroyed/);
			});
		}

		it(`${id}: rejects reused references, unchanged samples, short updates, and false empty validation`, async () => {
			const state = vendors(), adapter = createLifecycleAdapter(id), initial = inputFor(id);
			const handle = await adapter.create(state.host, initial);
			try {
				await assert.rejects(adapter.update(handle, initial), /fresh/);
				await assert.rejects(adapter.update(handle, inputFor(id)), /changed y/);
				await assert.rejects(adapter.update(handle, null), /full/);
				assert.throws(() => adapter.validate(handle, null), /count/);
				const next = inputFor(id, 1);
				columns(id, next)[2] = []; // Object-shaped inputs need their field changed separately.
				if (!Array.isArray(next)) next.ram = [];
				await assert.rejects(adapter.update(handle, next), /full/);
			}
			finally { await adapter.destroy(handle); }
		});

		it(`${id}: fails stale native samples rather than trusting input markers`, async () => {
			const state = vendors(), adapter = createLifecycleAdapter(id), initial = inputFor(id);
			const handle = await adapter.create(state.host, initial);
			try {
				state.dropUpdate = true;
				const next = inputFor(id, 1);
				if (id === 'chartgpu') await assert.rejects(adapter.update(handle, next), /did not submit/);
				else {
					await adapter.update(handle, next);
					assert.throws(() => adapter.validate(handle, next), /stale/);
				}
			}
			finally { await adapter.destroy(handle); }
		});
	}

	it('Plotly awaits newPlot/react and restores the acquisition observer on rejection', async () => {
		const state = vendors(), adapter = createLifecycleAdapter('plotly');
		const getContext = HTMLCanvasElement.prototype.getContext;
		state.plotGate = deferred();
		let done = false;
		const creating = adapter.create(state.host, null).then(handle => { done = true; return handle; });
		await turn();
		assert.equal(done, false);
		state.plotGate.resolve();
		const handle = await creating;
		state.plotGate = deferred(); done = false;
		const updating = adapter.update(handle, inputFor('plotly', 1)).then(() => { done = true; });
		await turn();
		assert.equal(done, false);
		const rejected = assert.rejects(updating, /draw failure/);
		state.plotGate.reject(new Error('draw failure'));
		await rejected;
		assert.equal(HTMLCanvasElement.prototype.getContext, getContext);
		await adapter.destroy(handle);
	});

	it('SciChart waits for stable renderInstructionsCompleted, checks licensing, and cancels listeners on destroy', async () => {
		const state = vendors(), adapter = createLifecycleAdapter('scichart');
		const handle = await adapter.create(state.host, null), chart = handle.chart;
		state.sciHold = true;
		let done = false;
		const updating = adapter.update(handle, inputFor('scichart')).then(() => { done = true; });
		await turn();
		chart.renderInstructionsCompleted.emit(true);
		chart.isRunningAnimation = true;
		chart.renderInstructionsCompleted.emit(false);
		await turn();
		assert.equal(done, false);
		chart.isRunningAnimation = false;
		chart.renderInstructionsCompleted.emit(false);
		await updating;
		assert.equal(chart.renderInstructionsCompleted.listeners.size, 0);
		state.license = 99;
		assert.throws(() => adapter.validate(handle, inputFor('scichart')), /license/);
		state.license = 3;
		const pending = adapter.update(handle, inputFor('scichart', 1));
		const rejected = assert.rejects(pending, /disposed before render/);
		await adapter.destroy(handle);
		await rejected;
		assert.equal(chart.renderInstructionsCompleted.listeners.size, 0);
		assert.equal(chart.renderError.listeners.size, 0);
	});

	it('ChartGPU waits for initial and replacement queue completion; validates retained counts', async () => {
		const state = vendors(), adapter = createLifecycleAdapter('chartgpu');
		state.workGate = deferred();
		let done = false;
		const creating = adapter.create(state.host, null).then(handle => { done = true; return handle; });
		await turn();
		assert.equal(done, false);
		assert.ok(state.events.includes('submit'));
		state.workGate.resolve();
		const handle = await creating;
		state.workGate = deferred(); done = false;
		const input = inputFor('chartgpu', 1);
		const updating = adapter.update(handle, input).then(() => { done = true; });
		await turn();
		assert.equal(done, false);
		assert.equal(Object.hasOwn(state.device.queue, 'submit'), false);
		state.workGate.resolve();
		await updating;
		handle.chart.instance.counts[1]--;
		assert.throws(() => adapter.validate(handle, input), /retained store count/);
		await adapter.destroy(handle);
		assert.equal(state.host.children.length, 0);
	});

	for (const kind of ['noSubmit', 'submitError']) {
		it(`ChartGPU rejects ${kind} during replacement and restores queue.submit`, async () => {
			const state = vendors(), adapter = createLifecycleAdapter('chartgpu');
			const handle = await adapter.create(state.host, null);
			state[kind] = kind === 'submitError' ? new Error('submit failed') : true;
			await assert.rejects(adapter.update(handle, inputFor('chartgpu')), /submit/);
			assert.equal(Object.hasOwn(state.device.queue, 'submit'), false);
			await adapter.destroy(handle);
		});
	}

	it('ChartGPU detects stale native y values even when options and full counts were updated', async () => {
		const state = vendors(), adapter = createLifecycleAdapter('chartgpu');
		const handle = await adapter.create(state.host, inputFor('chartgpu'));
		try {
			state.staleStore = true;
			const next = inputFor('chartgpu', 1);
			await adapter.update(handle, next);
			assert.throws(() => adapter.validate(handle, next), /stale|cannot verify/);
		}
		finally { await adapter.destroy(handle); }
	});

	it('does not acquire GL contexts merely to enumerate them', async () => {
		const state = vendors(), adapter = createLifecycleAdapter('plotly');
		const handle = await adapter.create(state.host, null);
		const before = state.events.slice();
		adapter.contexts(handle); adapter.contexts(handle);
		assert.deepEqual(state.events, before);
		await adapter.destroy(handle);
	});

	it('cleans up a failed Plotly creation and rejects missing vendor APIs', async () => {
		const state = vendors(), adapter = createLifecycleAdapter('plotly');
		state.plotGate = deferred();
		const creating = adapter.create(state.host, null);
		const rejected = assert.rejects(creating, /creation failed/);
		state.plotGate.reject(new Error('creation failed'));
		await rejected;
		assert.ok(state.events.includes('destroy'));
		delete globalThis.Plotly;
		await assert.rejects(adapter.create(state.host, null), /load Plotly/);
	});
});
