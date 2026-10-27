import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {smallLifecycleData} from '../../bench/lifecycle-data.mjs';

const ids = ['uplot', 'plotly', 'plotly-svg', 'scichart', 'chartgpu', 'deckgl', 'chartjs', 'echarts', 'highcharts', 'highcharts-svg'];
const adapters = Object.fromEntries(await Promise.all(ids.map(async id => [id, await import(`../../bench/${id}.mjs`)])));
const packed = JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url)));
const turn = () => new Promise(resolve => setImmediate(resolve));
const keys = ['cpu', 'ram', 'tcp'];
const globals = ['devicePixelRatio', 'uPlot', 'Plotly', 'SciChart', 'benchmarkSciChartOptions', 'navigator', 'benchmarkChartGPU', 'd3', 'deck', 'Chart', 'echarts', 'Highcharts'];

function event() {
	const listeners = new Set();
	return {listeners, subscribe: fn => listeners.add(fn), unsubscribe: fn => listeners.delete(fn), emit(value) { for (const fn of [...listeners]) fn(value); }};
}

function vendors() {
	const state = {created: 0, destroyed: 0, held: false, gate: null, submitError: null};
	const document = {createElement() { return {style: {}, ownerDocument: document, append() {}, remove() {}}; }};
	state.host = document.createElement();
	state.host.querySelector = () => ({getContext: () => state.context});
	state.context = {isContextLost: () => false, flush() {}, getError: () => 0, getExtension: () => null, NO_ERROR: 0};
	Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 1});
	globalThis.uPlot = class {
		constructor(options, data) { state.created++; this.series = options.series; this.axes = options.axes; this.data = data; }
		setData(data, reset) { assert.equal(reset, true); queueMicrotask(() => { this.data = data; }); }
		destroy() { state.destroyed++; }
	};
	globalThis.Chart = class {
		constructor(context, options) { state.created++; Object.assign(this, options); this.context = context; }
		update(mode) { assert.equal(mode, 'none'); }
		destroy() { state.destroyed++; }
	};
	globalThis.echarts = {init() {
		state.created++;
		return {setOption(options) { this.options = {...this.options, ...options}; }, dispose() { state.destroyed++; }};
	}};
	globalThis.Plotly = {
		async newPlot(host, data, layout) { state.created++; Object.assign(host, {data, layout}); await state.gate; return host; },
		async react(chart, data, layout) { Object.assign(chart, {data, layout}); await state.gate; return chart; },
		purge() { state.destroyed++; },
	};
	const collection = () => ({items: [], add(item) { this.items.push(item); }, asArray() { return this.items; }});
	const axis = class { constructor(context, options) { Object.assign(this, options); } };
	globalThis.benchmarkSciChartOptions = {wasmUrl: '/wasm', wasmNoSimdUrl: '/nosimd', timeoutMs: 1000};
	globalThis.SciChart = {
		SciChartDefaults: {}, EUseWasm64: {Never: 0}, EUseWasmSimd: {Auto: 1}, SciChartJSLightTheme: class {},
		DateTimeNumericAxis: axis, NumericAxis: axis, EAutoRange: {Always: 1}, EAxisAlignment: {Left: 0, Right: 1}, EResamplingMode: {Auto: 1},
		SciChartSurface: {configure() {}, UseCommunityLicense() {}, async createSingle() {
			state.created++;
			const chart = state.sci = {
				xAxes: collection(), yAxes: collection(), renderableSeries: collection(),
				renderInstructionsCompleted: event(), renderError: event(), suspended: true,
				getLicenseContext: () => ({SCRTCredentials: {GetLicenseType: () => 3}, SCRTLicenseType: {LICENSE_TYPE_COMMUNITY: 3}}),
				suspendUpdates() { this.suspended = true; },
				resumeUpdates() { this.suspended = false; if (!state.held) queueMicrotask(() => this.renderInstructionsCompleted.emit(false)); },
				delete() { this.isDeleted = true; state.destroyed++; },
			};
			return {sciChartSurface: chart, wasmContext: {}};
		}},
		XyDataSeries: class {
			clear() { assert.ok(state.sci.suspended); this.x = []; this.y = []; }
			appendRange(x, y) { assert.ok(state.sci.suspended); this.x = Array.from(x); this.y = Array.from(y); }
		},
		FastLineRenderableSeries: class { constructor(context, options) { Object.assign(this, options); } },
	};
	const device = state.device = {
		lost: new Promise(() => {}), addEventListener() {}, removeEventListener() {}, destroy() { state.destroyed++; },
		queue: {submit() { if (state.submitError) throw state.submitError; }, onSubmittedWorkDone: () => state.gate ?? Promise.resolve()},
	};
	const adapter = {requestDevice: async () => device};
	Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {gpu: {requestAdapter: async () => adapter}}});
	globalThis.benchmarkChartGPU = {ChartGPU: {async create(host, options) {
		state.created++;
		return {
			options, mode: 'external', setRenderMode(mode) { this.mode = mode; }, getRenderMode() { return this.mode; },
			setOption(options) { assert.equal(this.mode, 'external'); this.options = options; },
			renderFrame() { queueMicrotask(() => device.queue.submit(['frame'])); return true; }, needsRender: () => false,
			dispose() { state.destroyed++; },
		};
	}}};
	globalThis.Highcharts = {
		addEvent(target, name, fn) { (target.events ??= {})[name] ??= event(); target.events[name].subscribe(fn); return () => target.events[name].unsubscribe(fn); },
		chart(host, options) {
			state.created++;
			const chart = {options, series: options.series.map(series => ({
				...series, boosted: false,
				setData(data, redraw, animation, updatePoints) { assert.deepEqual([redraw, animation, updatePoints], [false, false, false]); this.dataTable = data; },
			})), redraw(animation) {
				assert.equal(animation, false);
				for (const series of this.series) {
					series.boosted = options.boost.enabled !== false && series.dataTable.columns.x.length > 5000;
					if (series.boosted && !state.held) queueMicrotask(() => series.events.renderedCanvas.emit());
				}
			}, destroy() { this.events?.destroy?.emit(); state.destroyed++; }};
			options.chart.events.load.call(chart);
			return chart;
		},
	};
	const selection = () => {
		const s = {node: () => ({getContext: () => state.context})};
		for (const key of ['append', 'attr', 'style', 'text', 'select', 'selectAll', 'data', 'join', 'on', 'remove']) s[key] = () => s;
		s.call = fn => { fn(s); return s; };
		return s;
	};
	const scale = () => { let domain, range; const fn = v => range[0] + (v - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]); fn.domain = d => { domain = d; return fn; }; fn.range = r => { range = r; return fn; }; fn.nice = () => fn; return fn; };
	const axisFn = () => { const fn = () => {}; for (const key of ['ticks', 'tickSize', 'tickFormat']) fn[key] = () => fn; return fn; };
	const min = a => a.reduce((a, b) => Math.min(a, b), Infinity), max = a => a.reduce((a, b) => Math.max(a, b), -Infinity);
	globalThis.d3 = {select: selection, scaleTime: scale, scaleLinear: scale, extent: a => [min(a), max(a)], min, max,
		axisLeft: axisFn, axisRight: axisFn, axisBottom: axisFn, color: () => ({r: 1, g: 2, b: 3})};
	globalThis.deck = {COORDINATE_SYSTEM: {CARTESIAN: 0}, OrthographicView: class {}, PathLayer: class { constructor(props) { this.props = props; } },
		Deck: class {
			constructor(props) { state.created++; this.props = props; queueMicrotask(() => this.redraw()); }
			setProps(props) { Object.assign(this.props, props); }
			redraw() { if (!state.held) this.props.onAfterRender({gl: state.context}); }
			finalize() { state.destroyed++; }
		},
	};
	return state;
}

function seriesData(id, chart) {
	if (id === 'uplot') return chart.data.slice(1);
	if (id.startsWith('plotly')) return chart.data.map(s => s.y);
	if (id === 'chartjs') return chart.data.datasets.map(s => s.data.map(p => p.y));
	if (id === 'echarts') return [1, 2, 3].map(i => Array.from(chart.options.dataset.source).filter((_, j) => j % 4 === i));
	if (id.startsWith('highcharts')) return chart.series.map(s => s.dataTable.columns.y);
	if (id === 'scichart') return chart.renderableSeries.asArray().map(s => s.dataSeries.y);
	if (id === 'chartgpu') return chart.instance.options.series.map(s => s.data.y);
	return chart.deck.props.layers.map(layer => layer.props.data[0] ?? []);
}

function dispose(id, chart) {
	if (adapters[id].destroyChart) adapters[id].destroyChart(chart);
	else if (id === 'echarts') chart.dispose();
	else chart.destroy();
}

function nextInput(id, offset) {
	const fresh = packed.slice();
	for (let i = fresh[0] + 1; i < fresh.length; i += fresh[0]) {
		fresh[i] += offset * 100000;
		fresh[i + 1] = 20 + (i % (offset + 5));
		fresh[i + 3] = offset + (i % (offset + 9));
		fresh[i + 5] = offset + 10 + (i % (offset + 7));
	}
	return adapters[id].prepData(fresh);
}

function expected(id, input) {
	if (id === 'uplot' || id.startsWith('plotly')) return input.slice(1);
	if (id === 'chartjs') return input.map(a => a.map(p => p.y));
	if (id === 'echarts') return [1, 2, 3].map(i => Array.from(input).filter((_, j) => j % 4 === i));
	if (id.startsWith('highcharts')) return input.map(s => s.columns.y);
	return keys.map(key => input[key]);
}

describe('benchmark lifecycle core exports', () => {
	let saved;
	beforeEach(() => { saved = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])); });
	afterEach(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });

	for (const id of ids) it(`${id}: two-point initialization then full data retains the chart`, async () => {
		const state = vendors(), adapter = adapters[id], wait = {textContent: ''};
		const small = adapter.prepData(smallLifecycleData(packed));
		const chart = await (adapter.makeLifecycleChart ?? adapter.makeChart)(small, state.host, wait);
		try {
			assert.deepEqual(seriesData(id, chart).map(a => a.length), Array(3).fill(id === 'deckgl' ? 4 : 2));
			const identity = chart.instance ?? chart.deck ?? chart;
			const full = adapter.prepData(packed);
			const result = await adapter.updateChart(chart, full, state.host, wait);
			assert.ok(result === undefined || result === chart);
			assert.equal(chart.instance ?? chart.deck ?? chart, identity);
			assert.equal(state.created, 1);
			assert.equal(state.destroyed, 0);
			assert.deepEqual(seriesData(id, chart).map(a => a.length), Array(3).fill(id === 'deckgl' ? 111100 : 55550));
			if (id !== 'deckgl') assert.deepEqual(seriesData(id, chart).map(a => Array.from(a)), expected(id, full).map(a => Array.from(a)));
		}
		finally { dispose(id, chart); }
	});

	for (const id of ids) for (const small of [true, false]) {
		it(`${id}: ${small ? 'two-row' : 'direct full-data'} creation and two full replacements retain native ownership`, async () => {
			const state = vendors(), adapter = adapters[id], wait = {textContent: ''};
			const input = adapter.prepData(small ? smallLifecycleData(packed) : packed);
			const chart = await (small ? adapter.makeLifecycleChart ?? adapter.makeChart : adapter.makeChart)(input, state.host, wait);
			assert.equal(state.created, 1);
			assert.deepEqual(seriesData(id, chart).map(a => a.length), Array(3).fill((small ? 2 : 55550) * (id === 'deckgl' ? 2 : 1)));
			const identity = chart.instance ?? chart.deck ?? chart;
			const series = chart.series ?? chart.data?.datasets ?? chart.renderableSeries?.asArray();
			if (id.startsWith('plotly')) assert.equal(chart.data[0].type, id === 'plotly-svg' ? 'scatter' : 'scattergl');
			if (id.startsWith('highcharts')) assert.equal(chart.options.boost.enabled, id === 'highcharts-svg' ? false : undefined);
			if (id === 'scichart') assert.deepEqual([chart.xAxes.items.length, chart.yAxes.items.length], [1, 2]);
			for (const offset of [10, 30]) {
				const input = nextInput(id, offset);
				wait.textContent = '';
				assert.equal(await adapter.updateChart(chart, input, state.host, wait), undefined);
				assert.equal(wait.textContent, 'Done!');
				assert.equal(chart.instance ?? chart.deck ?? chart, identity);
				assert.equal(chart.series ?? chart.data?.datasets ?? chart.renderableSeries?.asArray(), series);
				assert.equal(state.created, 1);
				assert.equal(state.destroyed, 0);
				if (id !== 'deckgl') assert.deepEqual(seriesData(id, chart).map(a => Array.from(a)), expected(id, input).map(a => Array.from(a)));
				else {
					assert.deepEqual(seriesData(id, chart).map(a => a.length), [111100, 111100, 111100]);
					assert.ok(seriesData(id, chart).every(a => a.every(Number.isFinite)));
				}
				if (id.startsWith('plotly')) {
					assert.deepEqual(chart.layout.xaxis.range, [input[0][0], input[0].at(-1)]);
					assert.equal(chart.layout.yaxis.autorange, true);
					assert.equal(chart.layout.yaxis2.autorange, true);
				}
			}
			dispose(id, chart);
			assert.ok(state.destroyed > 0);
		});
	}

	for (const id of ['plotly', 'plotly-svg', 'scichart', 'chartgpu', 'deckgl', 'highcharts']) {
		it(`${id}: replacement waits for native completion`, async () => {
			const state = vendors(), adapter = adapters[id];
			const chart = await adapter.makeChart(adapter.prepData(smallLifecycleData(packed)), state.host, {textContent: ''});
			const gate = Promise.withResolvers();
			state.gate = gate.promise;
			state.held = true;
			let done = false;
			const pending = adapter.updateChart(chart, nextInput(id, 10), state.host).then(() => { done = true; });
			await turn();
			assert.equal(done, false);
			if (id === 'scichart') {
				chart.renderInstructionsCompleted.emit(true);
				await turn();
				assert.equal(done, false);
				chart.renderInstructionsCompleted.emit(false);
			}
			else if (id === 'deckgl') chart.deck.props.onAfterRender({gl: state.context});
			else if (id === 'highcharts') {
				chart.series[0].events.renderedCanvas.emit();
				await turn();
				assert.equal(done, false);
				for (const series of chart.series.slice(1)) series.events.renderedCanvas.emit();
			}
			else gate.resolve();
			await pending;
			dispose(id, chart);
		});
	}

	it('ChartGPU propagates deferred submit failures and restores queue/mode without recreating', async () => {
		const state = vendors(), adapter = adapters.chartgpu;
		const chart = await adapter.makeChart(adapter.prepData(smallLifecycleData(packed)), state.host, {textContent: ''});
		const submit = state.device.queue.submit;
		state.submitError = new Error('submit failed');
		await assert.rejects(adapter.updateChart(chart, nextInput('chartgpu', 10)), /submit failed/);
		assert.equal(state.device.queue.submit, submit);
		assert.equal(chart.instance.getRenderMode(), 'auto');
		assert.equal(state.created, 1);
		assert.equal(state.destroyed, 0);
		dispose('chartgpu', chart);
	});

	for (const id of ['scichart', 'deckgl', 'highcharts']) it(`${id}: teardown rejects a pending replacement`, async () => {
		const state = vendors(), adapter = adapters[id];
		const chart = await adapter.makeChart(adapter.prepData(smallLifecycleData(packed)), state.host, {textContent: ''});
		state.held = true;
		const pending = adapter.updateChart(chart, nextInput(id, 10));
		const rejected = assert.rejects(pending, /disposed|destroyed/);
		dispose(id, chart);
		await rejected;
	});
});
