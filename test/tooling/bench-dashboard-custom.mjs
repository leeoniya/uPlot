import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {dashboardData, SERIES} from '../../bench/dashboard/common.mjs';
import {minmax} from '../../bench/dashboard/custom-d3.mjs';
import {configureRuntime as prepareRuntime} from '../../bench/scichart.mjs';

const names = ['d3', 'd3-minmax', 'd3-svg', 'd3-svg-minmax', 'd3fc', 'd3fc-canvas', 'deckgl', 'lightweight', 'scichart', 'chartgpu', 'lightningchart'];
const adapters = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(`../../bench/dashboard/${name}.mjs`)])));
const globals = ['d3', 'fc', 'deck', 'LightweightCharts', 'SciChart', 'benchmarkSciChartOptions', 'navigator', 'benchmarkChartGPU', 'lcjs', 'benchmarkLightningChartOptions', 'devicePixelRatio', 'requestAnimationFrame'];
const small = dashboardData(2)[0], large = dashboardData(300)[0];
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const turns = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function events() {
	const handlers = new Map();
	return {
		addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
		removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
		emit(type, value) { for (const fn of [...handlers.get(type) ?? []]) fn(value); },
		count() { return [...handlers.values()].reduce((n, set) => n + set.size, 0); },
	};
}
function signal() {
	const e = events();
	return {subscribe: fn => e.addEventListener('event', fn), unsubscribe: fn => e.removeEventListener('event', fn), emit: value => e.emit('event', value), count: e.count};
}
function gl(canvas) {
	return {canvas, NO_ERROR: 0, COLOR_BUFFER_BIT: 1, lost: false, error: 0, released: 0,
		viewport() {}, clearColor() {}, clear() {}, flush() {}, isContextLost() { return this.lost; }, getError() { return this.error; },
		getExtension(name) { return name === 'WEBGL_lose_context' ? {loseContext: () => { this.released++; this.lost = true; }} : {}; },
	};
}
function context2d() {
	const calls = [];
	return Object.fromEntries(['scale', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke']
		.map(name => [name, (...args) => calls.push([name, ...args])]).concat([['calls', calls]]));
}
class Selection {
	constructor(nodes, parent) { this.nodes = nodes; this.parent = parent; }
	node() { return this.nodes[0]; }
	append(tag) {
		return new Selection(this.nodes.map(parent => { const child = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag); parent.append(child); return child; }));
	}
	attr(key, value) { this.nodes.forEach((n, i) => n.setAttribute(key, typeof value === 'function' ? value(n.__data__, i) : value)); return this; }
	style(key, value) { this.nodes.forEach(n => { n.style[key] = value; }); return this; }
	selectAll(selector) { return new Selection(this.nodes.flatMap(n => [...n.querySelectorAll(selector)]), this.node()); }
	data(values) { if (!arguments.length) return this.nodes.map(n => n.__data__); this.values = values; this.nodes.forEach((n, i) => { n.__data__ = values[i]; }); return this; }
	datum(value) { if (!arguments.length) return this.node().__data__; this.nodes.forEach(n => { n.__data__ = value; }); return this; }
	join(tag) { while (this.nodes.length < this.values.length) { const n = this.parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag); this.parent.append(n); this.nodes.push(n); } return this.data(this.values); }
	call(fn) { fn(this); return this; }
}
function scale() {
	let domain = [0, 1], range = [0, 1];
	const s = v => range[0] + (+v - +domain[0]) / (+domain[1] - +domain[0] || 1) * (range[1] - range[0]);
	s.domain = v => v ? (domain = v, s) : domain;
	s.range = v => v ? (range = v, s) : range;
	s.nice = () => s;
	s.copy = () => scale().domain(domain.slice()).range(range.slice());
	return s;
}
function path() { const points = []; return {points, moveTo: (...p) => points.push(['M', ...p]), lineTo: (...p) => points.push(['L', ...p]), closePath: () => points.push(['Z']), toString: () => JSON.stringify(points)}; }
function line() {
	let x, y, defined, ctx;
	const draw = values => { let active = false; values.forEach((v, i) => { if (!defined(v)) active = false; else { ctx[active ? 'lineTo' : 'moveTo'](x(v, i), y(v)); active = true; } }); };
	for (const [key, setter] of Object.entries({x: v => { x = v; }, y: v => { y = v; }, defined: v => { defined = v; }, context: v => { ctx = v; }})) draw[key] = v => { setter(v); return draw; };
	return draw;
}
function axis(s) { const a = selection => { selection.node().scale = s; }; a.ticks = () => a; return a; }
const d3 = {select: n => new Selection([n]), scaleTime: scale, scaleLinear: scale, path, line, axisLeft: axis, axisBottom: axis,
	extent: xs => [Math.min(...xs), Math.max(...xs)], min: xs => Math.min(...xs), max: xs => Math.max(...xs), color: () => ({r: 50, g: 100, b: 150})};
function fcMock() {
	function series(backend) {
		const state = {};
		const s = values => { s.last = values; s.points = values.map((v, i) => [state.xScale(state.crossValue(v, i)), state.yScale(state.mainValue(v))]); };
		s.state = state; s.backend = backend;
		for (const key of ['context', 'xScale', 'yScale', 'crossValue', 'mainValue', 'decorate', 'pixelRatio', 'lineWidth', 'scaleMapper', 'equals']) s[key] = v => { state[key] = v; return s; };
		return s;
	}
	return {seriesCanvasLine: () => series('canvas'), seriesWebglLine: () => series('webgl'), webglScaleLinear: scale, webglStrokeColor: () => ({value: () => () => {}})};
}
function deckMock() {
	const control = {auto: true};
	class Deck {
		constructor(props) { this.props = props; control.instance = this; if (control.auto) queueMicrotask(() => this.redraw()); }
		setProps(props) { Object.assign(this.props, props); }
		redraw() { if (control.auto) this.props.onAfterRender({gl: this.props.gl}); }
		finalize() { this.finalized = true; }
	}
	return Object.assign(control, {Deck, PathLayer: class { constructor(props) { this.props = props; } }, OrthographicView: class {}, COORDINATE_SYSTEM: {CARTESIAN: 1}});
}
function lightweightMock() {
	const control = {LineSeries: {}, LastPriceAnimationMode: {Disabled: 0}};
	control.createChart = (host, options) => control.instance = {options, series: [],
		addSeries(type, options) { const series = {options, setData(data) { this.values = structuredClone(data); }, data() { return this.values; }}; this.series.push(series); return series; },
		timeScale: () => ({fitContent() {}}), remove() { this.removed = true; },
	};
	return control;
}
function sciMock(document) {
	const list = () => ({items: [], add(...items) { this.items.push(...items); }, asArray() { return this.items; }});
	const control = {surfaces: [], auto: true, license: 1, configs: [], community: 0};
	class Data {
		constructor(wasm, options) { this.options = options; }
		appendRange(x, y) { this.x = Array.from(x); this.y = Array.from(y); }
		clear() { this.x = []; this.y = []; }
		count() { return this.x.length; }
		getNativeXValues() { return {size: () => this.x.length, get: i => this.x[i]}; }
		getNativeYValues() { return {size: () => this.y.length, get: i => this.y[i]}; }
		delete() { this.deleted = true; }
	}
	const api = {SciChartDefaults: {}, EUseWasm64: {Never: 0}, EUseWasmSimd: {Auto: 1}, EAutoRange: {Always: 1}, EAxisAlignment: {Left: 0}, EResamplingMode: {Auto: 1},
		ELegendOrientation: {Horizontal: 'Horizontal'}, ELegendPlacement: {TopLeft: 'TopLeft'},
		LegendModifier: class { constructor(options) { this.options = options; } delete() { this.deleted = true; } },
		CursorModifier: class { constructor(options) { this.options = options; } delete() { this.deleted = true; } },
		SciChartJSLightTheme: class {}, DateTimeNumericAxis: class { constructor(w, options) { this.options = options; } }, NumericAxis: class { constructor(w, options) { this.options = options; } },
		XyDataSeries: Data, FastLineRenderableSeries: class { constructor(w, options) { Object.assign(this, options); } delete() { this.dataSeries.delete(); } },
		SciChartSurface: {
			configure(config) { control.configs.push(config); }, UseCommunityLicense() { control.community++; }, setRuntimeLicenseKey(key) { control.key = key; },
			async createSingle(host, options) {
				const canvas = document.createElement('canvas'); host.append(canvas); canvas.getContext('webgl2');
				const surface = {options, domCanvasWebGL: canvas, xAxes: list(), yAxes: list(), renderableSeries: list(), chartModifiers: list(), renderInstructionsCompleted: signal(), renderError: signal(),
					getLicenseContext: () => ({SCRTCredentials: {GetLicenseType: () => control.license}, SCRTLicenseType: {LICENSE_TYPE_COMMUNITY: 1, LICENSE_TYPE_REQUIRES_VALIDATION: 2}}),
					suspendUpdates() {}, resumeUpdates() { if (control.auto) queueMicrotask(() => this.renderInstructionsCompleted.emit(false)); },
					delete() { this.isDeleted = true; this.renderableSeries.items.forEach(line => line.delete()); this.chartModifiers.items.forEach(modifier => modifier.delete()); },
				};
				control.surfaces.push(surface);
				return {sciChartSurface: surface, wasmContext: {}};
			},
		},
	};
	return Object.assign(control, {api});
}
function gpuMock() {
	const control = {autoFence: true, submit: true, lost: deferred(), submitError: null, submissions: 0, pendingFrame: null};
	const queue = {submit() { if (control.submitError) throw control.submitError; control.submitted = true; control.submissions++; }, onSubmittedWorkDone() { control.fence = deferred(); return control.autoFence ? Promise.resolve() : control.fence.promise; }};
	const device = Object.assign(events(), {queue, lost: control.lost.promise, destroy() { this.destroyed = true; }});
	const adapter = {info: {}, requestDevice: async () => device};
	return Object.assign(control, {device, adapter, navigator: {gpu: {requestAdapter: async () => adapter}}, api: {ChartGPU: {async create(host, options) {
		let mode = options.renderMode ?? 'auto';
		const requestRender = () => {
			instance.dirty = true;
			if (mode === 'auto') control.pendingFrame ??= render;
		};
		const render = () => {
			instance.dirty = !!control.stillDirty;
			if (control.submit) queueMicrotask(() => queue.submit([{}]));
		};
		const instance = {options, dirty: true, setOption(next) { this.options = next; requestRender(); }, needsRender() { return this.dirty; },
			getRenderMode() { return mode; },
			setRenderMode(next) { if (mode === next || this.disposed) return; mode = next; if (mode === 'external') control.pendingFrame = null; else if (this.dirty) requestRender(); },
			renderFrame() { if (mode === 'auto' || !this.dirty || control.noFrame) return false; render(); return true; },
			dispose() { this.disposed = true; control.pendingFrame = null; },
		};
		control.hover = requestRender;
		control.flushFrame = () => { const frame = control.pendingFrame; control.pendingFrame = null; frame?.(); };
		requestRender();
		control.instance = instance; return instance;
	}}}});
}
function lightningMock() {
	const control = {auto: true};
	const axis = () => { const a = {}; for (const key of ['setTickStrategy', 'setScrollStrategy', 'setAnimationsEnabled']) a[key] = () => a; return a; };
	const api = {Themes: {light: {}}, disableThemeEffects: t => t, LegendPosition: {TopCenter: 7}, AxisTickStrategies: {DateTime: 1}, AxisScrollStrategies: {fitting: 1},
		SolidLine: class { constructor(options) { this.options = options; } }, SolidFill: class {}, ColorHEX: c => c,
		lightningChart(options) {
			control.options = options; options.sharedContextOptions.canvas.getContext('webgl2');
			return control.owner = {dispose() { this.disposed = true; control.instance?.emit('dispose'); }, ChartXY(options) {
				const chart = control.instance = Object.assign(events(), {options, engine: events(), series: [], getDefaultAxisX: axis, getDefaultAxisY: axis,
					setAnimationsEnabled(value) { this.animationsEnabled = value; return this; }, setTitle() { return this; }, getSeries() { return this.series; },
					setCursorMode(mode) { this.cursorMode = mode; return this; },
					addLineSeries(options) {
						const line = {options, setName(name) { this.name = name; return this; }, setStrokeStyle() { return this; }, setMaxSampleCount(n) { this.max = n; return this; },
							appendSamples(data) { this.x = Array.from(data.x); this.y = Array.from(data.y); if (control.auto) queueMicrotask(() => chart.engine.emit('renderframe', {asyncRenderingPending: false})); return this; },
							clear() { this.x = []; this.y = []; }, getSampleCount() { return this.x.length; }, readBack() { return {xValues: this.x, yValues: this.y}; },
						}; chart.series.push(line); return line;
					},
				}); return chart;
			}};
		},
	};
	return Object.assign(control, {api});
}

describe('dashboard custom adapters (native API mocks; no browser)', () => {
	let saved, window, host, gpu, sci, lightning, canvasPrototype, getContextDescriptor;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		window = new Window(); host = window.document.createElement('div'); window.document.body.append(host);
		canvasPrototype = window.HTMLCanvasElement.prototype;
		getContextDescriptor = Object.getOwnPropertyDescriptor(canvasPrototype, 'getContext');
		canvasPrototype.getContext = function(type) {
			if (this.contextType && type !== this.contextType) return null;
			this.contextType = type; return this.context ??= type === '2d' ? context2d() : gl(this);
		};
		gpu = gpuMock(); sci = sciMock(window.document); lightning = lightningMock();
		const values = {d3, fc: fcMock(), deck: deckMock(), LightweightCharts: lightweightMock(), SciChart: sci.api,
			benchmarkSciChartOptions: {wasmUrl: '/scichart.wasm', wasmNoSimdUrl: '/scichart-nosimd.wasm', timeoutMs: 100},
			navigator: gpu.navigator, benchmarkChartGPU: gpu.api, lcjs: lightning.api, benchmarkLightningChartOptions: {license: 'mock-vendor-key', timeoutMs: 100},
			devicePixelRatio: 2, requestAnimationFrame: callback => queueMicrotask(callback)};
		for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
	});
	afterEach(async () => {
		// Happy DOM shares this prototype across windows; preserve other suites' mocks.
		if (getContextDescriptor) Object.defineProperty(canvasPrototype, 'getContext', getContextDescriptor);
		else delete canvasPrototype.getContext;
		globals.forEach((key, i) => { if (saved[i]) Object.defineProperty(globalThis, key, saved[i]); else delete globalThis[key]; });
		await window.happyDOM.close();
	});

	for (const name of names) it(`${name}: five native series, retained 2→300 update, native tamper validation, final size and cleanup`, async () => {
		const adapter = adapters[name], input = adapter.prepData(small), next = adapter.prepData(large), wait = {textContent: ''};
		const chart = await adapter.makeChart(input, host, wait);
		assert.equal(chart.element.style.width, '480px'); assert.equal(chart.element.style.height, '216px');
		assert.equal(wait.textContent, 'Done!'); assert.equal(adapter.validateChart(chart, input, {rows: 2}), true);
		const native = chart.instance, series = chart.series?.slice(), context = chart.context;
		const result = await adapter.updateChart(chart, next, host, wait);
		assert.ok(result === undefined || result === chart); assert.equal(chart.instance, native); assert.equal(chart.context, context);
		if (series) assert.deepEqual(chart.series, series);
		assert.equal(adapter.validateChart(chart, next, {rows: 300}), true);
		if (name.startsWith('d3')) {
			assert.equal(chart.useMinMax, name.endsWith('minmax'));
			assert.equal(chart.renderer, name.includes('svg') ? 'svg' : name === 'd3fc' ? 'webgl' : 'canvas');
			if (name.startsWith('d3fc')) { assert.equal(chart.series[0].last.length, 300); assert.equal(chart.series[0].backend, chart.renderer); assert.equal(chart.series[0].state.yScale, chart.series[4].state.yScale); }
			const data = chart.paths ? chart.paths.data() : d3.select(chart.canvas).datum(); data[0].values = [1];
		}
		else if (name === 'deckgl') native.props.layers[0].props.data = [new Float64Array(2)];
		else if (name === 'lightweight') { assert.equal(native.options.width, 480); assert.equal(chart.series[0].options.priceScaleId, 'left'); chart.series[0].values.pop(); }
		else if (name === 'scichart') { assert.equal(native.yAxes.items.length, 1); native.renderableSeries.items[0].dataSeries.x.pop(); }
		else if (name === 'chartgpu') { assert.equal(native.options.axes.y.length, 1); native.options.series[0].data = {x: [1], y: [2]}; }
		else { assert.equal(native.options.defaultAxisX.type, 'linear-highPrecision'); native.series[0].x.pop(); }
		assert.throws(() => adapter.validateChart(chart, next, {rows: 300}), /native|five series/);
		adapter.destroyChart(chart); adapter.destroyChart(chart);
		assert.equal(host.children.length, 0);
		assert.throws(() => adapter.validateChart(chart, next, {rows: 300}), /disposed/);
	});

	for (const name of ['lightweight', 'scichart', 'chartgpu', 'lightningchart']) it(`${name}: retains native hover configuration through data replacement`, async () => {
		const adapter = adapters[name], inputs = [small, large].map(adapter.prepData);
		const chart = await adapter.makeChart(inputs[0], host);
		const modifiers = chart.instance.chartModifiers?.asArray().slice();
		try {
			for (const [i, input] of inputs.entries()) {
				if (i) await adapter.updateChart(chart, input, host);
				const native = chart.instance;
				if (name === 'lightweight') {
					assert.equal(native.options.crosshair, undefined, 'retain the native crosshair defaults');
					for (const series of chart.series) {
						assert.notEqual(series.options.crosshairMarkerVisible, false);
						assert.equal(series.options.pointMarkersVisible, false);
						assert.equal(series.options.lastPriceAnimation, LightweightCharts.LastPriceAnimationMode.Disabled);
					}
				}
				else if (name === 'scichart') {
					assert.deepEqual(native.chartModifiers.asArray(), modifiers);
					assert.equal(modifiers.length, 2);
					const legend = modifiers.find(modifier => modifier instanceof SciChart.LegendModifier);
					const cursor = modifiers.find(modifier => modifier instanceof SciChart.CursorModifier);
					assert.equal(legend.options.orientation, SciChart.ELegendOrientation.Horizontal);
					assert.equal(legend.options.placement, SciChart.ELegendPlacement.TopLeft);
					assert.notEqual(legend.options.showLegend, false);
					assert.equal(cursor.options.showTooltip, true);
					assert.equal(chart.plot.style.height, '216px');
				}
				else if (name === 'chartgpu') {
					assert.equal(native.options.tooltip.show, true);
					assert.equal(native.options.legend.show, true);
					assert.equal(native.options.legend.position, 'top');
					assert.equal(native.options.animation, false);
					assert.equal(native.options.renderMode, 'external', 'initial frame uses checked manual submission');
					assert.equal(native.getRenderMode(), 'auto', 'native hover frames resume after checked submission');
				}
				else {
					assert.equal(native.options.legend.position, lcjs.LegendPosition.TopCenter);
					assert.notEqual(native.options.legend.visible, false);
					assert.equal(native.cursorMode, 'show-all');
					assert.equal(native.animationsEnabled, false);
					assert.equal(chart.plot.style.height, '216px');
					assert.equal(chart.canvas.style.height, '216px');
				}
			}
		}
		finally { adapter.destroyChart(chart); }
		if (modifiers) assert.ok(modifiers.every(modifier => modifier.deleted));
	});

	it('uses distinct plot/clip IDs for simultaneous tiles', async () => {
		const adapter = adapters['d3-svg-minmax'], input = adapter.prepData(small);
		const a = adapter.makeChart(input, host), b = adapter.makeChart(input, host);
		const ids = [...host.querySelectorAll('[id]')].map(n => n.id);
		assert.equal(new Set(ids).size, ids.length);
		assert.notEqual(a.plot.id, b.plot.id);
		assert.equal(a.element.querySelectorAll('span').length, SERIES.length);
		adapter.destroyChart(a); adapter.destroyChart(b);
	});

	it('minmax preserves device-column extrema and restarts gaps', () => {
		const p = path(); minmax(p, [0, 0.1, 0.2, 0.3, 1, 2], [4, -3, 9, 5, null, 7], x => x, y => y, 1);
		assert.deepEqual(p.points, [['M', 0.5, 4.5], ['L', 0.5, -2.5], ['L', 0.5, 9.5], ['L', 0.5, 5.5], ['M', 2.5, 7.5], ['Z']]);
	});

	for (const name of ['d3fc', 'deckgl', 'scichart', 'lightningchart']) it(`${name}: exposes native context and rejects browser context-limit loss`, async () => {
		const adapter = adapters[name], input = adapter.prepData(small), chart = await adapter.makeChart(input, host);
		assert.deepEqual(chart.getWebGLContexts(), [chart.context]);
		chart.context.lost = true;
		chart.context.canvas.dispatchEvent(new window.Event('webglcontextlost'));
		assert.equal(chart.getWebGLContexts().length, 1, 'must not hide lost contexts');
		assert.throws(() => adapter.validateChart(chart, input, {rows: 2}), /context.*lost.*context limit/);
		await assert.rejects(async () => adapter.updateChart(chart, input, host), /context.*lost/);
		adapter.destroyChart(chart);
	});

	it('deck.gl waits for actual render callbacks and cancels pending update on destruction', async () => {
		const adapter = adapters.deckgl, chart = await adapter.makeChart(adapter.prepData(small), host);
		deck.auto = false;
		const updating = adapter.updateChart(chart, adapter.prepData(large), host);
		let complete = false; updating.then(() => { complete = true; }, () => {});
		await turns(); assert.equal(complete, false);
		adapter.destroyChart(chart); await assert.rejects(updating, /disposed/);
		assert.equal(chart.instance.finalized, true); assert.equal(chart.context.released, 1);
	});

	it('ChartGPU uses native hover scheduling between checked manual frames', async () => {
		const adapter = adapters.chartgpu, chart = await adapter.makeChart(adapter.prepData(small), host);
		try {
			assert.equal(chart.instance.getRenderMode(), 'auto');
			assert.equal(gpu.pendingFrame, null, 'a clean chart does not start a render loop');
			assert.equal(chart.instance.renderFrame(), false, 'native renderFrame is a no-op in auto mode');
			assert.equal(gpu.submissions, 1);
			gpu.hover();
			assert.equal(typeof gpu.pendingFrame, 'function');
			gpu.flushFrame(); await turns();
			assert.equal(gpu.submissions, 2, 'native hover submits without an adapter update');
			assert.equal(gpu.pendingFrame, null);

			gpu.hover();
			gpu.autoFence = false;
			const updating = adapter.updateChart(chart, adapter.prepData(large), host);
			assert.equal(chart.instance.getRenderMode(), 'external');
			assert.equal(gpu.pendingFrame, null, 'manual update cancels a pending native hover frame');
			await turns();
			assert.equal(gpu.submissions, 3);
			assert.equal(chart.instance.getRenderMode(), 'external', 'keep checked frame ownership until the queue completes');
			gpu.fence.resolve(); await updating;
			assert.equal(chart.instance.getRenderMode(), 'auto');
			assert.equal(adapter.validateChart(chart, adapter.prepData(large), {rows: 300}), true);
			gpu.hover(); gpu.flushFrame(); await turns();
			assert.equal(gpu.submissions, 4, 'native hover remains live after data replacement');
			assert.equal(gpu.pendingFrame, null);
		}
		finally { adapter.destroyChart(chart); }
	});

	it('ChartGPU observes deferred submission, waits for GPU queue, and exposes its owned device', async () => {
		const adapter = adapters.chartgpu, chart = await adapter.makeChart(adapter.prepData(small), host);
		assert.deepEqual(chart.getWebGPUDevices(), [gpu.device]);
		gpu.autoFence = false;
		const submit = gpu.device.queue.submit, updating = adapter.updateChart(chart, adapter.prepData(large), host);
		let complete = false; updating.then(() => { complete = true; });
		await turns(); assert.equal(complete, false); assert.equal(gpu.device.queue.submit, submit);
		gpu.fence.resolve(); await updating;
		adapter.destroyChart(chart); assert.equal(gpu.device.destroyed, true); assert.equal(gpu.instance.disposed, true);
	});

	for (const fault of ['missing frame', 'dirty frame', 'missing submit', 'submit exception', 'device lost', 'uncaptured error']) it(`ChartGPU rejects ${fault} and releases partial initialization`, async () => {
		if (fault === 'missing frame') gpu.noFrame = true;
		if (fault === 'dirty frame') gpu.stillDirty = true;
		if (fault === 'missing submit') gpu.submit = false;
		if (fault === 'submit exception') gpu.submitError = new Error('mock submit exception');
		if (fault === 'device lost') gpu.lost.resolve({reason: 'unknown', message: 'mock lost'});
		const creating = adapters.chartgpu.makeChart(adapters.chartgpu.prepData(small), host);
		if (fault === 'uncaptured error') { await Promise.resolve(); await Promise.resolve(); gpu.device.emit('uncapturederror', {error: new Error('mock uncaptured error')}); }
		await assert.rejects(creating, /submit|device lost|uncaptured error/);
		assert.equal(gpu.device.destroyed, true); assert.equal(host.children.length, 0);
	});

	it('ChartGPU rejects software fallback instead of changing backends', async () => {
		gpu.adapter.info.isFallbackAdapter = true;
		await assert.rejects(adapters.chartgpu.makeChart(adapters.chartgpu.prepData(small), host), /non-fallback/);
		assert.equal(host.children.length, 0);
	});

	it('original SciChart does not expose a pre-timing prepareRuntime bootstrap hook', async () => {
		const original = await import('../../bench/scichart.mjs');
		assert.equal(Object.hasOwn(original, 'prepareRuntime'), false);
		assert.equal(original.configureRuntime, prepareRuntime);
	});

	it('dashboard SciChart exports and reuses configureRuntime as prepareRuntime without changing defaults', async () => {
		assert.equal(adapters.scichart.prepareRuntime, prepareRuntime);
		const chart = await adapters.scichart.makeChart(adapters.scichart.prepData(small), host);
		assert.equal(sci.community, 1); assert.deepEqual(sci.configs, [{wasmUrl: '/scichart.wasm', wasmNoSimdUrl: '/scichart-nosimd.wasm'}]);
		assert.deepEqual(sci.api.SciChartDefaults, {useWasm64: 0, useWasmSimd: 1, useNativeText: true});
		assert.equal(chart.instance.renderableSeries.items[0].dataSeries.x[0], small.x[0] / 1000);
		adapters.scichart.destroyChart(chart);
	});

	it('SciChart render errors unsubscribe and delete native series on cleanup', async () => {
		const adapter = adapters.scichart, chart = await adapter.makeChart(adapter.prepData(small), host);
		sci.auto = false;
		const updating = adapter.updateChart(chart, adapter.prepData(large), host);
		chart.instance.renderError.emit(new Error('native render error'));
		await assert.rejects(updating, /native render error/);
		assert.equal(chart.instance.renderInstructionsCompleted.count(), 0); assert.equal(chart.instance.renderError.count(), 0);
		adapter.destroyChart(chart); assert.equal(chart.instance.isDeleted, true);
		assert.ok(chart.instance.renderableSeries.items.every(s => s.dataSeries.deleted));
	});

	it('SciChart rejects vendor license failures, rather than accepting a licensing frame', async () => {
		sci.license = 99;
		await assert.rejects(adapters.scichart.makeChart(adapters.scichart.prepData(small), host), /license blocked/);
		assert.equal(sci.surfaces[0].isDeleted, true); assert.equal(host.children.length, 0);
	});

	it('LightningChart requires a key and waits until native async rendering is complete', async () => {
		const adapter = adapters.lightningchart, input = adapter.prepData(small);
		benchmarkLightningChartOptions.license = '';
		await assert.rejects(adapter.makeChart(input, host), /vendor-issued key/);
		benchmarkLightningChartOptions.license = 'mock-vendor-key';
		const chart = await adapter.makeChart(input, host);
		lightning.auto = false;
		const updating = adapter.updateChart(chart, adapter.prepData(large), host);
		let complete = false; updating.then(() => { complete = true; });
		lightning.instance.engine.emit('renderframe', {asyncRenderingPending: true});
		await turns(); assert.equal(complete, false);
		lightning.instance.engine.emit('renderframe', {asyncRenderingPending: false}); await updating;
		assert.equal(lightning.instance.engine.count(), 0);
		adapter.destroyChart(chart); assert.equal(lightning.owner.disposed, true);
		assert.equal(lightning.options.webgl.version, 'webgl2');
	});

	it('cleanup attempts all owned resources even when the native disposer throws', async () => {
		const adapter = adapters.deckgl, chart = await adapter.makeChart(adapter.prepData(small), host);
		chart.instance.finalize = () => { throw new Error('mock disposer failure'); };
		assert.throws(() => adapter.destroyChart(chart), /cleanup failed/);
		assert.equal(chart.context.released, 1); assert.equal(host.children.length, 0);
	});

	it('SciChart deletes a surface that arrives after initialization times out', async () => {
		benchmarkSciChartOptions.timeoutMs = 5;
		const gate = deferred(), create = SciChart.SciChartSurface.createSingle;
		SciChart.SciChartSurface.createSingle = async (...args) => { const result = await create(...args); await gate.promise; return result; };
		await assert.rejects(adapters.scichart.makeChart(adapters.scichart.prepData(small), host), /initialization timed out/);
		assert.equal(host.children.length, 0);
		gate.resolve(); await turns();
		assert.equal(sci.surfaces[0].isDeleted, true);
	});

	it('ChartGPU disposes a late instance after device failure during asynchronous creation', async () => {
		const gate = deferred(), create = benchmarkChartGPU.ChartGPU.create;
		benchmarkChartGPU.ChartGPU.create = async (...args) => { const instance = await create(...args); await gate.promise; return instance; };
		const creating = adapters.chartgpu.makeChart(adapters.chartgpu.prepData(small), host);
		await turns(); gpu.lost.resolve({reason: 'unknown', message: 'mock lost'});
		await assert.rejects(creating, /device lost/);
		gate.resolve(); await turns();
		assert.equal(gpu.instance.disposed, true); assert.equal(gpu.device.destroyed, true); assert.equal(host.children.length, 0);
	});

	for (const name of ['scichart', 'lightningchart']) it(`${name}: pending native render is rejected and unsubscribed on destruction`, async () => {
		const adapter = adapters[name], chart = await adapter.makeChart(adapter.prepData(small), host);
		sci.auto = lightning.auto = false;
		const updating = adapter.updateChart(chart, adapter.prepData(large), host);
		adapter.destroyChart(chart);
		await assert.rejects(updating, /disposed/);
		assert.equal(name === 'scichart' ? chart.instance.renderInstructionsCompleted.count() : chart.instance.engine.count(), 0);
		assert.equal(chart.context.released, 1); assert.equal(host.children.length, 0);
	});

	it('LightningChart times out without accepting an absent render event', async () => {
		lightning.auto = false; benchmarkLightningChartOptions.timeoutMs = 5;
		await assert.rejects(adapters.lightningchart.makeChart(adapters.lightningchart.prepData(small), host), /readiness timed out/);
		assert.equal(lightning.owner.disposed, true); assert.equal(lightning.instance.engine.count(), 0); assert.equal(host.children.length, 0);
	});

	it('ChartGPU cancels an outstanding native queue wait on destruction', async () => {
		const adapter = adapters.chartgpu, chart = await adapter.makeChart(adapter.prepData(small), host);
		gpu.autoFence = false;
		const updating = adapter.updateChart(chart, adapter.prepData(large), host);
		await turns(); adapter.destroyChart(chart);
		await assert.rejects(updating, /disposed/);
		assert.equal(gpu.device.count(), 0); assert.equal(gpu.device.destroyed, true);
	});

	it('failed native context creation removes partial DOM without a fallback', () => {
		window.HTMLCanvasElement.prototype.getContext = () => null;
		assert.throws(() => adapters.d3fc.makeChart(adapters.d3fc.prepData(small), host), /context unavailable/);
		assert.equal(host.children.length, 0);
	});
});
