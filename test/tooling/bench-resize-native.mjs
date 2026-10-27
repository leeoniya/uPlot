import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as scichart from '../../bench/scichart.mjs';
import * as chartjs from '../../bench/chartjs.mjs';
import * as echarts from '../../bench/echarts.mjs';
import * as apexcharts from '../../bench/apexcharts.mjs';
import * as apexchartsSampled from '../../bench/apexcharts-sampled.mjs';
import * as flot from '../../bench/flot.mjs';
import * as dygraphs from '../../bench/dygraphs.mjs';
import * as highcharts from '../../bench/highcharts.mjs';
import * as highchartsSvg from '../../bench/highcharts-svg.mjs';
import * as plotly from '../../bench/plotly.mjs';
import * as plotlySvg from '../../bench/plotly-svg.mjs';
import * as lightweight from '../../bench/lightweight.mjs';
import * as canvasjs from '../../bench/canvasjs.mjs';
import * as lightningchart from '../../bench/lightningchart.mjs';

const adapters = {
	scichart, chartjs, echarts, apexcharts, 'apexcharts-sampled': apexchartsSampled,
	flot, dygraphs, highcharts, 'highcharts-svg': highchartsSvg,
	plotly, 'plotly-svg': plotlySvg, lightweight, canvasjs, lightningchart,
};
const globals = [
	'SciChart', 'Chart', 'echarts', 'ApexCharts', '$', 'Dygraph', 'Highcharts',
	'Plotly', 'LightweightCharts', 'CanvasJS', 'lcjs', 'devicePixelRatio',
	'benchmarkSciChartOptions', 'benchmarkLightningChartOptions',
	'requestAnimationFrame', 'setTimeout', 'clearTimeout',
];
const size = Object.freeze({width: 1200, height: 400});
const source = Object.freeze([Object.freeze([1, 2, 3]), Object.freeze([4, 5, 6])]);
const forbidden = () => { throw new Error('Resize must not construct, dispose, or reingest data'); };

function retained(object, key, value = source) {
	Object.defineProperty(object, key, {get: () => value, set: forbidden});
	return value;
}

function fixture() {
	const host = {style: {width: '1920px', height: '600px'}};
	const wait = {textContent: 'waiting'};
	return {
		host, wait,
		resize(adapter, chart) {
			// Mirror the harness: both CSS writes happen before the adapter hook.
			host.style.width = size.width + 'px';
			host.style.height = size.height + 'px';
			return adapter.resizeChart(chart, size, host, wait);
		},
		assertHost() {
			assert.deepEqual(host.style, {width: '1200px', height: '400px'});
		},
	};
}

function event() {
	const listeners = new Set();
	return {
		listeners,
		subscribe: fn => listeners.add(fn),
		unsubscribe: fn => listeners.delete(fn),
		emit(value) { for (const fn of [...listeners]) fn(value); },
	};
}

function events() {
	const handlers = new Map();
	const get = type => {
		if (!handlers.has(type)) handlers.set(type, event());
		return handlers.get(type);
	};
	return {
		on: (type, fn) => get(type).subscribe(fn),
		off: (type, fn) => get(type).unsubscribe(fn),
		emit: (type, value) => get(type).emit(value),
		count: type => get(type).listeners.size,
	};
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
}

async function pending(promise, wait) {
	let settled = false;
	promise.then(() => { settled = true; }, () => { settled = true; });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(settled, false);
	assert.equal(wait.textContent, 'waiting');
}

async function completed(promise, chart, wait) {
	const result = await promise;
	assert.ok(result === undefined || result === chart, 'return void or the original chart');
	assert.equal(wait.textContent, 'Done!');
}

function timers() {
	const active = new Map();
	globalThis.setTimeout = (fn, ms) => { const id = {}; active.set(id, {fn, ms}); return id; };
	globalThis.clearTimeout = id => active.delete(id);
	return active;
}

function sciFixture() {
	const f = fixture();
	const chart = {
		rendered: event(), renderInstructionsCompleted: event(), renderError: event(),
		isInvalidated: false, isRunningAnimation: false, isDeleted: false,
		getLicenseContext: () => ({SCRTCredentials: {GetLicenseType: () => 1}, SCRTLicenseType: {LICENSE_TYPE_FULL: 1}}),
		changeViewportSize(width, height) {
			f.assertHost();
			assert.deepEqual([width, height], [1200, 400], 'CSS pixels even at DPR 2');
			assert.equal(chart.rendered.listeners.size, 1, 'subscribe before resize');
			chart.isInvalidated = true;
		},
		delete() { chart.isDeleted = true; },
	};
	retained(chart, 'data');
	chart.renderableSeries = {asArray: forbidden};
	globalThis.benchmarkSciChartOptions = {timeoutMs: 1000};
	return {...f, chart};
}

async function lightningFixture() {
	const f = fixture(), engineEvents = events(), chartEvents = events();
	const data = Object.freeze({x: source[0], cpu: source[1], ram: source[1], tcp: source[1]});
	const lines = [];
	let creates = 0, ingestions = 0;
	const axis = {setTickStrategy() { return this; }, setScrollStrategy() { return this; }, setTitle() { return this; }, setAnimationsEnabled() {}};
	const chart = {
		engine: {
			addEventListener: engineEvents.on, removeEventListener: engineEvents.off,
			layout() {
				f.assertHost();
				assert.equal(engineEvents.count('renderframe'), 1, 'subscribe before layout');
			},
		},
		addEventListener: chartEvents.on, removeEventListener: chartEvents.off,
		setAnimationsEnabled() {}, getDefaultAxisX: () => axis, getDefaultAxisY: () => axis, addAxisY: () => axis,
		addLineSeries() {
			const line = {
				setName() { return this; }, setStrokeStyle() { return this; },
				setMaxSampleCount() { return this; },
				appendSamples(input) { ingestions++; this.input = input; return this; },
				clear: forbidden,
			};
			lines.push(line);
			return line;
		},
	};
	globalThis.benchmarkLightningChartOptions = {license: 'test-only', timeoutMs: 1000};
	globalThis.lcjs = {
		lightningChart: () => ({ChartXY() { creates++; return chart; }, dispose() {}}),
		AxisTickStrategies: {DateTime: {}}, AxisScrollStrategies: {fitting: {}}, Themes: {light: {}},
		disableThemeEffects: theme => theme, SolidLine: class {}, SolidFill: class {}, ColorRGBA: () => ({}),
	};
	const initial = lightningchart.makeChart(data, f.host);
	engineEvents.emit('renderframe', {asyncRenderingPending: false});
	assert.equal(await initial, chart);
	assert.equal(ingestions, 3);
	lines.forEach(line => { line.appendSamples = forbidden; line.setMaxSampleCount = forbidden; });
	chart.addLineSeries = forbidden;
	return {...f, chart, engineEvents, chartEvents, assertRetained() {
		assert.equal(creates, 1);
		assert.equal(ingestions, 3);
		lines.forEach((line, i) => {
			assert.equal(line.input.x, data.x);
			assert.equal(line.input.y, data[['cpu', 'ram', 'tcp'][i]]);
		});
	}};
}

describe('native benchmark resize hooks', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 2});
		for (const key of ['Chart', 'ApexCharts', 'Dygraph']) globalThis[key] = forbidden;
		globalThis.SciChart = {SciChartSurface: {createSingle: forbidden}};
		globalThis.echarts = {init: forbidden};
		globalThis.$ = {plot: forbidden};
		globalThis.LightweightCharts = {createChart: forbidden};
		globalThis.CanvasJS = {Chart: forbidden};
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
		else delete globalThis[key];
	}));

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: exports resize without removing existing entry points`, () => {
			for (const name of ['makeChart', 'makeEmptyChart', 'updateChart', 'prepData', 'resizeChart'])
				assert.equal(typeof adapter[name], 'function', name);
		});
	}

	it('renderer/sampling wrappers reuse the native resize hooks', () => {
		assert.equal(apexchartsSampled.resizeChart, apexcharts.resizeChart);
		assert.equal(highchartsSvg.resizeChart, highcharts.resizeChart);
		assert.equal(plotlySvg.resizeChart, plotly.resizeChart);
	});

	for (const [id, adapter] of [['chartjs', chartjs], ['dygraphs', dygraphs], ['canvasjs', canvasjs]]) {
		it(`${id}: updates dimensions and renders synchronously without replacing data`, async () => {
			const f = fixture(), calls = [];
			const chart = {width: 1920, height: 600, options: {width: 1920, height: 600, animation: false, animationEnabled: false, maintainAspectRatio: false}};
			retained(chart, 'data');
			retained(chart.options, 'data');
			chart.resize = (width, height) => {
				f.assertHost();
				assert.deepEqual([width, height], [1200, 400]);
				assert.equal(f.wait.textContent, 'waiting');
				chart.width = width; chart.height = height;
				calls.push('resize');
			};
			chart.render = () => {
				f.assertHost();
				assert.equal(chart.options.width, 1200); assert.equal(chart.options.height, 400);
				assert.equal(chart.options.animationEnabled, false);
				assert.equal(f.wait.textContent, 'waiting');
				calls.push('render');
			};
			await completed(f.resize(adapter, chart), chart, f.wait);
			assert.deepEqual(calls, [id === 'canvasjs' ? 'render' : 'resize']);
			assert.equal(chart.data, source); assert.equal(chart.options.data, source);
			assert.equal(chart.options.animation, false);
		});
	}

	it('ECharts: waits for finished, not a resized canvas or partial rendered event', async () => {
		const active = timers(), f = fixture(), emitter = events();
		const chart = {...emitter, resize(options) {
			f.assertHost();
			assert.equal(emitter.count('finished'), 1);
			assert.deepEqual(options, {width: 1200, height: 400, animation: {duration: 0}});
			emitter.emit('rendered');
		}};
		retained(chart, 'data');
		emitter.emit('finished'); // An earlier render cannot satisfy this resize.
		const promise = f.resize(echarts, chart);
		await pending(promise, f.wait);
		emitter.emit('finished');
		await completed(promise, chart, f.wait);
		assert.equal(emitter.count('finished'), 0); assert.equal(active.size, 0);
		assert.equal(chart.data, source);
	});

	it('ECharts: cleans up on synchronous completion, resize failure, and timeout', async () => {
		const active = timers(), f = fixture(), emitter = events();
		const chart = {...emitter, resize() { emitter.emit('finished'); }};
		await completed(f.resize(echarts, chart), chart, f.wait);
		assert.equal(active.size, 0);
		f.wait.textContent = 'waiting';
		chart.resize = () => { throw new Error('resize failed'); };
		await assert.rejects(f.resize(echarts, chart), /resize failed/);
		assert.equal(emitter.count('finished'), 0); assert.equal(active.size, 0);
		chart.resize = () => {};
		const promise = f.resize(echarts, chart);
		const rejected = assert.rejects(promise, /timed out/);
		active.values().next().value.fn();
		await rejected;
		assert.equal(emitter.count('finished'), 0); assert.equal(active.size, 0);
		assert.equal(f.wait.textContent, 'waiting');
	});

	for (const [id, adapter] of [['apexcharts', apexcharts], ['apexcharts-sampled', apexchartsSampled], ['plotly', plotly], ['plotly-svg', plotlySvg]]) {
		it(`${id}: awaits the native resize promise and passes only dimensions, not data`, async () => {
			const f = fixture(), gate = deferred(), apex = id.startsWith('apexcharts');
			const chart = apex ? {} : f.host;
			retained(chart, 'data');
			const reducer = Object.freeze({enabled: id.endsWith('sampled'), targetPoints: 1920, threshold: 3840});
			const config = {width: 1920, height: 600, dataReducer: reducer};
			let calls = 0;
			const apply = (width, height) => {
				f.assertHost(); calls++;
				return gate.promise.then(() => { config.width = width; config.height = height; return chart; });
			};
			if (apex) chart.updateOptions = (options, ...flags) => {
				assert.deepEqual(options, {chart: {width: 1200, height: 400}});
				assert.deepEqual(flags, [false, false, false]);
				return apply(options.chart.width, options.chart.height);
			};
			else globalThis.Plotly = {newPlot: forbidden, react: forbidden, purge: forbidden, relayout(target, options) {
				assert.equal(target, chart);
				assert.deepEqual(options, {width: 1200, height: 400});
				return apply(options.width, options.height);
			}};
			const promise = f.resize(adapter, chart);
			await pending(promise, f.wait);
			assert.equal(config.width, 1920, 'old output is not ready');
			gate.resolve();
			await completed(promise, chart, f.wait);
			assert.equal(config.width, 1200); assert.equal(config.height, 400);
			assert.equal(config.dataReducer, reducer); assert.equal(reducer.targetPoints, 1920);
			assert.equal(chart.data, source); assert.equal(calls, 1);
		});
	}

	it('promise-based hooks propagate vendor failure without marking readiness', async () => {
		for (const adapter of [apexcharts, plotly]) {
			const f = fixture(), gate = deferred(), chart = {updateOptions: () => gate.promise};
			globalThis.Plotly = {relayout: () => gate.promise};
			const promise = f.resize(adapter, chart);
			const rejected = assert.rejects(promise, /resize failed/);
			gate.reject(new Error('resize failed'));
			await rejected;
			assert.equal(f.wait.textContent, 'waiting');
		}
	});

	it('Flot: resizes, lays out, draws, and waits for the new overlay without setData', async () => {
		const f = fixture(), calls = [];
		const chart = {hooks: {drawOverlay: []}, setData: forbidden,
			resize(...args) { f.assertHost(); assert.equal(args.length, 0); assert.equal(chart.hooks.drawOverlay.length, 1); calls.push('resize'); },
			setupGrid() { calls.push('grid'); }, draw() { calls.push('draw'); },
			triggerRedrawOverlay() { calls.push('overlay'); },
		};
		retained(chart, 'data');
		const promise = f.resize(flot, chart);
		assert.deepEqual(calls, ['resize', 'grid', 'draw', 'overlay']);
		await pending(promise, f.wait);
		for (const fn of [...chart.hooks.drawOverlay]) fn(chart);
		await completed(promise, chart, f.wait);
		assert.equal(chart.hooks.drawOverlay.length, 0); assert.equal(chart.data, source);
		f.wait.textContent = 'waiting';
		chart.draw = () => { throw new Error('draw failed'); };
		await assert.rejects(f.resize(flot, chart), /draw failed/);
		assert.equal(chart.hooks.drawOverlay.length, 0); assert.equal(f.wait.textContent, 'waiting');
	});

	for (const [id, adapter, boosted] of [['highcharts', highcharts, true], ['highcharts-svg', highchartsSvg, false]]) {
		it(`${id}: setSize disables animation and waits for every boosted series`, async () => {
			const f = fixture(), chartEvents = events();
			const series = Array.from({length: 3}, () => {
				const line = {...events(), boosted, setData: forbidden};
				retained(line, 'data');
				return line;
			});
			globalThis.Highcharts = {chart: forbidden, addEvent(target, type, fn) { target.on(type, fn); return () => target.off(type, fn); }};
			const chart = {...chartEvents, series, setSize(width, height, animation) {
				f.assertHost();
				assert.deepEqual([width, height, animation], [1200, 400, false]);
				series.forEach(s => assert.equal(s.count('renderedCanvas'), 1));
				if (boosted) series[0].emit('renderedCanvas');
			}};
			series.forEach(s => s.emit('renderedCanvas'));
			const promise = f.resize(adapter, chart);
			if (boosted) {
				await pending(promise, f.wait);
				series[1].emit('renderedCanvas');
				await pending(promise, f.wait);
				series[2].emit('renderedCanvas');
			}
			await completed(promise, chart, f.wait);
			assert.equal(chart.series, series); assert.equal(chartEvents.count('destroy'), 0);
			series.forEach(s => { assert.equal(s.count('renderedCanvas'), 0); assert.equal(s.data, source); });
		});
	}

	it('Highcharts: a clean, repeated size does not wait for nonexistent Boost renders', async () => {
		const f = fixture(), series = Array.from({length: 3}, () => ({...events(), boosted: true}));
		globalThis.Highcharts = {addEvent(target, type, fn) { target.on(type, fn); return () => target.off(type, fn); }};
		const chart = {...events(), series, chartWidth: 1200, chartHeight: 400, isDirtyBox: false,
			// Highcharts 13.1.1 skips redraw and renderedCanvas for a clean, unchanged size.
			setSize() {},
		};
		let done = false;
		const promise = Promise.resolve(f.resize(highcharts, chart)).then(() => { done = true; });
		for (let i = 0; i < 5; i++) await Promise.resolve();
		assert.equal(done, true);
		await completed(promise, chart, f.wait);
		assert.equal(chart.count('destroy'), 0);
		series.forEach(line => assert.equal(line.count('renderedCanvas'), 0));

		// The same dimensions can still require rendering when the box is dirty.
		chart.isDirtyBox = true;
		f.wait.textContent = 'waiting';
		const dirty = f.resize(highcharts, chart);
		await pending(dirty, f.wait);
		series.forEach(line => line.emit('renderedCanvas'));
		await completed(dirty, chart, f.wait);
	});

	for (const boosted of [false, true]) it(`Highcharts: update after resize retains series and waits for replacement, boosted=${boosted}`, async () => {
		const f = fixture(), input = [{columns: {x: [1, 2], y: [3, 4]}}, {columns: {x: [1, 2], y: [5, 6]}}, {columns: {x: [1, 2], y: [7, 8]}}];
		const calls = [], series = input.map((data, i) => ({...events(), boosted,
			setData(...args) { calls.push([i, ...args]); this.data = args[0]; },
		}));
		globalThis.Highcharts = {addEvent(target, type, fn) { target.on(type, fn); return () => target.off(type, fn); }};
		const chart = {...events(), series,
			setSize(width, height, animation) {
				assert.equal(animation, false);
				this.chartWidth = width; this.chartHeight = height;
				series.forEach(line => line.emit('renderedCanvas'));
			},
			redraw(animation) {
				assert.equal(animation, false);
				assert.equal(this.chartWidth, 1200); assert.equal(this.chartHeight, 400);
				assert.equal(calls.length, 3);
			},
		};
		await f.resize(highcharts, chart);
		f.wait.textContent = 'waiting';
		const update = highcharts.updateChart(chart, input, f.host, f.wait);
		assert.deepEqual(calls, input.map((data, i) => [i, data, false, false, false]));
		if (boosted) {
			await pending(update, f.wait);
			series[0].emit('renderedCanvas'); series[1].emit('renderedCanvas');
			await pending(update, f.wait);
			series[2].emit('renderedCanvas');
		}
		await completed(update, chart, f.wait);
		assert.equal(chart.series, series);
		series.forEach((line, i) => { assert.equal(line.data, input[i]); assert.equal(line.count('renderedCanvas'), 0); });
		assert.equal(chart.count('destroy'), 0);
	});

	it('Highcharts: removes completion listeners on dispatch failure or destruction', async () => {
		const f = fixture(), line = {...events(), boosted: true}, chart = {...events(), series: [line]};
		globalThis.Highcharts = {addEvent(target, type, fn) { target.on(type, fn); return () => target.off(type, fn); }};
		chart.setSize = () => { throw new Error('resize failed'); };
		await assert.rejects(f.resize(highcharts, chart), /resize failed/);
		assert.equal(line.count('renderedCanvas'), 0); assert.equal(chart.count('destroy'), 0);
		chart.setSize = () => {};
		const promise = f.resize(highcharts, chart);
		const rejected = assert.rejects(promise, /destroyed/);
		chart.emit('destroy');
		await rejected;
		assert.equal(line.count('renderedCanvas'), 0); assert.equal(chart.count('destroy'), 0);
		assert.equal(f.wait.textContent, 'waiting');
	});

	it('Lightweight: forces resize repaint, fits existing data, then waits for the queued frame', async () => {
		const f = fixture(), calls = [], frames = [];
		globalThis.requestAnimationFrame = fn => { calls.push('raf'); frames.push(fn); };
		const chart = {
			resize(width, height, force) { f.assertHost(); assert.deepEqual([width, height, force], [1200, 400, true]); calls.push('resize'); },
			timeScale() { return {fitContent() { calls.push('fit'); }}; },
			addSeries: forbidden,
		};
		retained(chart, 'data');
		const promise = f.resize(lightweight, chart);
		assert.deepEqual(calls, ['resize', 'fit', 'raf']);
		await pending(promise, f.wait);
		frames.shift()();
		await completed(promise, chart, f.wait);
		assert.equal(chart.data, source);
	});

	it('SciChart: ignores old GPU completion and waits for a fresh, settled 2D render', async () => {
		const active = timers(), f = sciFixture(), {chart} = f;
		chart.rendered.emit(false);
		const promise = f.resize(scichart, chart);
		assert.equal(chart.renderInstructionsCompleted.listeners.size, 0);
		chart.renderInstructionsCompleted.emit(false);
		await pending(promise, f.wait);
		chart.rendered.emit(true);
		await pending(promise, f.wait);
		chart.isInvalidated = false; chart.isRunningAnimation = true;
		chart.rendered.emit(false);
		await pending(promise, f.wait);
		chart.isRunningAnimation = false;
		chart.rendered.emit(false);
		await completed(promise, chart, f.wait);
		assert.equal(chart.data, source);
		assert.equal(chart.rendered.listeners.size, 0); assert.equal(chart.renderError.listeners.size, 0);
		assert.equal(active.size, 0);
	});

	it('SciChart: update after resize still awaits GPU completion on the retained data series', async () => {
		const active = timers(), f = sciFixture(), {chart} = f;
		const resize = f.resize(scichart, chart);
		chart.isInvalidated = false;
		chart.rendered.emit(false);
		await completed(resize, chart, f.wait);
		const input = {x: [1, 2], cpu: [3, 4], ram: [5, 6], tcp: [7, 8]}, calls = [];
		const lines = ['cpu', 'ram', 'tcp'].map(key => ({dataSeries: {
			clear() { calls.push(['clear', key]); },
			appendRange(x, y) { assert.equal(x, input.x); assert.equal(y, input[key]); calls.push(['append', key]); },
		}}));
		chart.renderableSeries = {asArray: () => lines};
		chart.suspendUpdates = () => { calls.push(['suspend']); };
		chart.resumeUpdates = options => {
			assert.deepEqual(options, {invalidateOnResume: true});
			chart.isInvalidated = true;
			calls.push(['resume']);
		};
		f.wait.textContent = 'waiting';
		const update = scichart.updateChart(chart, input, f.host, f.wait);
		assert.deepEqual(calls, [['suspend'], ['clear', 'cpu'], ['append', 'cpu'], ['clear', 'ram'], ['append', 'ram'], ['clear', 'tcp'], ['append', 'tcp'], ['resume']]);
		assert.equal(chart.rendered.listeners.size, 0);
		assert.equal(chart.renderInstructionsCompleted.listeners.size, 1);
		chart.renderInstructionsCompleted.emit(false);
		await pending(update, f.wait);
		chart.isInvalidated = false;
		chart.rendered.emit(false);
		await pending(update, f.wait);
		chart.renderInstructionsCompleted.emit(false);
		await completed(update, chart, f.wait);
		assert.equal(chart.renderableSeries.asArray(), lines);
		assert.equal(chart.renderInstructionsCompleted.listeners.size, 0);
		assert.equal(chart.renderError.listeners.size, 0);
		assert.equal(active.size, 0);
	});

	for (const failure of ['dispatch', 'render', 'timeout', 'dispose']) {
		it(`SciChart: rejects ${failure} and removes resize listeners`, async () => {
			const active = timers(), f = sciFixture(), {chart} = f;
			if (failure === 'dispatch') chart.changeViewportSize = () => { throw new Error('resize failed'); };
			const promise = f.resize(scichart, chart);
			const rejected = assert.rejects(promise, /failed|timed out|disposed/);
			if (failure === 'render') chart.renderError.emit(new Error('render failed'));
			if (failure === 'timeout') active.values().next().value.fn();
			if (failure === 'dispose') scichart.destroyChart(chart);
			await rejected;
			assert.equal(chart.rendered.listeners.size, 0); assert.equal(chart.renderError.listeners.size, 0);
			assert.equal(active.size, 0); assert.equal(f.wait.textContent, 'waiting');
		});
	}

	it('LightningChart: layouts the current engine and waits through pending async frames', async () => {
		const active = timers(), f = await lightningFixture();
		f.engineEvents.emit('renderframe', {asyncRenderingPending: false});
		const promise = f.resize(lightningchart, f.chart);
		await pending(promise, f.wait);
		f.engineEvents.emit('renderframe', {asyncRenderingPending: true});
		await pending(promise, f.wait);
		f.engineEvents.emit('renderframe', {asyncRenderingPending: false});
		await completed(promise, f.chart, f.wait);
		f.assertRetained();
		assert.equal(f.engineEvents.count('renderframe'), 0); assert.equal(f.chartEvents.count('dispose'), 0);
		assert.equal(active.size, 0);
		lightningchart.destroyChart(f.chart);
	});

	for (const failure of ['dispatch', 'timeout', 'dispose']) {
		it(`LightningChart: rejects ${failure} and removes resize listeners`, async () => {
			const active = timers(), f = await lightningFixture();
			if (failure === 'dispatch') f.chart.engine.layout = () => { throw new Error('layout failed'); };
			const promise = f.resize(lightningchart, f.chart);
			const rejected = assert.rejects(promise, /failed|timed out|disposed/);
			if (failure === 'timeout') active.values().next().value.fn();
			if (failure === 'dispose') f.chartEvents.emit('dispose');
			await rejected;
			assert.equal(f.engineEvents.count('renderframe'), 0); assert.equal(f.chartEvents.count('dispose'), 0);
			assert.equal(active.size, 0); assert.equal(f.wait.textContent, 'waiting');
			f.assertRetained();
			lightningchart.destroyChart(f.chart);
		});
	}
});
