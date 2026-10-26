import assert from 'node:assert/strict';
import {WIDTH, HEIGHT, CHARTS, ROWS, SERIES, dashboardData} from '../../bench/dashboard/common.mjs';
import * as uplot from '../../bench/dashboard/uplot.mjs';
import * as release from '../../bench/dashboard/uplot-release.mjs';
import * as echarts from '../../bench/dashboard/echarts.mjs';
import * as flot from '../../bench/dashboard/flot.mjs';
import * as dygraphs from '../../bench/dashboard/dygraphs.mjs';
import * as agcharts from '../../bench/dashboard/agcharts.mjs';
import * as canvasjs from '../../bench/dashboard/canvasjs.mjs';
import * as kendo from '../../bench/dashboard/kendo.mjs';
import * as syncfusion from '../../bench/dashboard/syncfusion.mjs';
import * as devextreme from '../../bench/dashboard/devextreme.mjs';
import * as sampled from '../../bench/dashboard/devextreme-sampled.mjs';

const adapters = {uplot, 'uplot-release': release, echarts, flot, dygraphs, agcharts, canvasjs, kendo, syncfusion,
	devextreme, 'devextreme-sampled': sampled};
const globals = ['uPlot', 'uPlotRelease', 'echarts', '$', 'Dygraph', 'agCharts', 'CanvasJS', 'kendo', 'ej', 'DevExpress', 'devicePixelRatio'];
const asynchronous = new Set(['flot', 'agcharts', 'kendo', 'syncfusion', 'devextreme', 'devextreme-sampled']);
const family = id => id === 'uplot-release' ? 'uplot' : id === 'devextreme-sampled' ? 'devextreme' : id;
const kendoNamespace = () => globalThis.kendo.dataviz.ui;

function host(index = 0) {
	return {id: `dashboard-tile-${index}`, style: {}, emptied: false,
		replaceChildren() { this.emptied = true; }};
}

function emitter() {
	const handlers = new Map();
	return {
		on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
		off(type, fn) { handlers.get(type)?.delete(fn); },
		emit(type) { for (const fn of handlers.get(type) ?? []) fn(); },
		listeners() { return [...handlers.values()].reduce((sum, set) => sum + set.size, 0); },
	};
}

// Native state is separate from construction options, so validators cannot pass
// merely by counting the adapter's configured series or its original input.
function install(id) {
	const records = [];
	const record = (chart, container, options) => {
		const r = {chart, host: container, options, flush() {}, fail: false};
		chart.destroy = chart.dispose = () => { chart.destroyed = true; };
		records.push(r);
		return r;
	};
	const type = family(id);
	if (type === 'uplot') {
		class UPlot {
			constructor(options, input, container) {
				const r = record(this, container, options);
				this.series = [...options.series]; this.data = input;
				r.legend = null;
				this.root = {querySelector(selector) { assert.equal(selector, '.u-legend'); return r.legend; }};
				const ready = () => {
					r.legend = {style: {}};
					for (const fn of options.hooks.ready) fn(this);
				};
				if (id === 'uplot') queueMicrotask(ready); else ready();
			}
			setData(input, reset) { assert.equal(reset, true); this.data = input; }
		}
		globalThis[id === 'uplot-release' ? 'uPlotRelease' : 'uPlot'] = UPlot;
		globalThis[id === 'uplot-release' ? 'uPlot' : 'uPlotRelease'] = class { constructor() { throw new Error('wrong uPlot build'); } };
	}
	if (type === 'echarts') globalThis.echarts = {init(container, theme, dimensions) {
		const chart = {
			setOption(options) {
				if (options.series) {
					r.options = {...options, ...dimensions};
					this.nativeSeries = options.series.map(() => ({getRawData: () => ({
						count: () => this.data.length, get: (key, i) => this.data[i][key],
					})}));
				}
				this.data = options.dataset.source;
			},
			getModel() { return {getSeries: () => this.nativeSeries}; },
		};
		const r = record(chart, container, {});
		return chart;
	}};
	if (type === 'flot') globalThis.$ = Object.assign(value => value, {plot(container, data, options) {
		const chart = {data, hooks: options.hooks,
			getData() { return this.data; }, setData(input) { this.data = input; },
			setupGrid() {}, draw() {}, triggerRedrawOverlay() {},
		};
		const r = record(chart, container, options);
		r.flush = () => [...chart.hooks.drawOverlay].forEach(fn => fn(chart));
		return chart;
	}});
	if (type === 'dygraphs') globalThis.Dygraph = class {
		static dateTicker() {}
		constructor(container, input, options) {
			record(this, container, options); this.data = input; this.labels = [...options.labels];
			this.layout_ = {setNames: options.labels.slice(1)};
		}
		updateOptions({file}) { this.data = file; }
		getLabels() { return this.labels; }
		numRows() { return this.data.length; }
		numColumns() { return this.data[0]?.length ?? this.labels.length; }
		getValue(i, s) { return this.data[i][s]; }
	};
	if (type === 'agcharts') globalThis.agCharts = {AgCharts: {create(options) {
		const chart = {chart: {series: options.series.map(s => ({properties: s}))}, data: options.data,
			getOptions() { return {...options, data: this.data}; },
			waitForUpdate() { return new Promise((resolve, reject) => { r.flush = () => r.fail ? reject(new Error('render failed')) : resolve(); }); },
			updateDelta({data}) { this.data = data; return this.waitForUpdate(); },
		};
		const r = record(chart, options.container, options);
		return chart;
	}}};
	if (type === 'canvasjs') globalThis.CanvasJS = {Chart: class {
		constructor(container, options) { this.r = record(this, container, options); this.options = options; }
		render() {
			if (this.r.fail) throw new Error('render failed');
			this.data = this.options.data.map(s => ({...s}));
		}
	}};
	if (type === 'kendo') globalThis.kendo = {dataviz: {ui: {Chart: class {
		constructor(container, options) {
			const r = this.r = record(this, container, options);
			Object.assign(this, emitter()); this.bind = this.on; this.unbind = this.off;
			this.options = options; this._plotArea = {series: options.series.map(s => ({...s}))};
			this.element = {empty() { container.emptied = true; }};
			r.flush = () => options.render({sender: this});
		}
		redraw() {
			this._plotArea.series = this.options.series.map(s => ({...s}));
			this.r.flush = () => this.emit('render');
		}
	}}}};
	if (type === 'syncfusion') globalThis.ej = {charts: {Chart: class {
		constructor(options) {
			this.options = options; this.series = options.series.map(s => ({...s})); this.loaded = options.loaded;
		}
		appendTo(container) {
			this.element = container; this.r = record(this, container, this.options);
			this.dataBind();
		}
		dataBind() {
			this.visibleSeries = this.series.map(s => ({...s})); this.r.flush = () => this.loaded();
		}
	}}};
	if (type === 'devextreme') globalThis.DevExpress = {viz: {dxChart: class {
		constructor(container, options) {
			const r = this.r = record(this, container, options);
			Object.assign(this, emitter()); this.options = options; this.data = options.dataSource;
			this.nativeSeries = options.series.map(() => ({getAllPoints: () => [1, 2]}));
			options.onInitialized({component: this}); r.flush = () => options.onDone();
		}
		option(key, value) {
			assert.equal(key, 'dataSource'); this.data = value;
			this.r.flush = () => this.emit(value.length ? 'done' : 'drawn');
		}
		getAllSeries() { return this.nativeSeries; }
		getDataSource() { return {items: () => this.data}; }
	}}};
	return records;
}

function nativeSeries(id, chart) {
	switch (family(id)) {
		case 'uplot': return chart.series;
		case 'echarts': case 'devextreme': return chart.nativeSeries;
		case 'flot': case 'canvasjs': return chart.data;
		case 'dygraphs': return chart.layout_.setNames;
		case 'agcharts': return chart.chart.series;
		case 'kendo': return chart._plotArea.series;
		case 'syncfusion': return chart.visibleSeries;
	}
}

function replaceSource(id, chart, input) {
	switch (family(id)) {
		case 'uplot': case 'echarts': case 'dygraphs': case 'agcharts': case 'devextreme': chart.data = input; break;
		case 'flot': chart.data.forEach((s, i) => { s.data = input[i]; }); break;
		case 'canvasjs': chart.data.forEach((s, i) => { s.dataPoints = input[i]; }); break;
		case 'kendo': chart._plotArea.series.forEach((s, i) => { s.data = input[i]; }); break;
		case 'syncfusion': chart.visibleSeries.forEach(s => { s.dataSource = input; }); break;
	}
}

function checkOptions(id, r) {
	const o = r.options;
	let width = o.width, height = o.height;
	if (id === 'flot') { width = parseInt(r.host.style.width); height = parseInt(r.host.style.height); }
	if (id === 'kendo') ({width, height} = o.chartArea);
	if (family(id) === 'devextreme') ({width, height} = o.size);
	assert.equal(+width, WIDTH); assert.equal(+height, HEIGHT);
	switch (family(id)) {
		case 'uplot':
			assert.equal(o.cache.paths, false); assert.equal(o.cursor.show, false); assert.equal(o.legend.live, false);
			assert.ok(o.series.slice(1).every(s => s.points.show === false && !s.scale));
			assert.equal(o.axes.length, 2); assert.equal(r.legend.style.position, 'absolute'); break;
		case 'echarts':
			assert.equal(o.renderer, 'canvas'); assert.equal(o.animation, false); assert.equal(o.yAxis.type, 'value');
			assert.deepEqual(o.legend.data, SERIES.map(s => s.label));
			assert.ok(o.series.every(s => s.sampling === 'minmax' && !s.showSymbol && s.silent)); break;
		case 'flot':
			assert.equal(o.yaxes.length, 1); assert.equal(o.legend.noColumns, 5);
			assert.equal(o.grid.hoverable, false); assert.equal(o.series.points.show, false); break;
		case 'dygraphs':
			assert.equal(o.legend, 'always'); assert.equal(o.drawPoints, false);
			assert.deepEqual(o.interactionModel, {}); assert.equal(o.animatedZooms, false); break;
		case 'agcharts':
			assert.deepEqual(Object.keys(o.axes), ['x', 'y']); assert.equal(o.legend.enabled, true);
			assert.ok(o.series.every(s => s.yKeyAxis === 'y' && !s.marker.enabled)); break;
		case 'canvasjs':
			assert.equal(o.animationEnabled, false); assert.equal(o.zoomEnabled, false); assert.equal(o.axisY2, undefined);
			assert.ok(o.data.every(s => s.showInLegend && s.markerSize === 0 && s.type === 'line')); break;
		case 'kendo':
			assert.equal(o.renderAs, 'canvas'); assert.equal(o.transitions, false); assert.equal(o.legend.visible, true);
			assert.equal(o.seriesDefaults.type, 'scatterLine'); assert.equal(o.seriesDefaults.markers.visible, false);
			assert.deepEqual(o.yAxis, {}); break;
		case 'syncfusion':
			assert.equal(o.enableCanvas, true); assert.equal(o.axes, undefined); assert.equal(o.legendSettings.visible, true);
			assert.ok(o.series.every(s => !s.animation.enable && !s.marker.visible && s.type === 'Line')); break;
		case 'devextreme':
			assert.equal(o.animation.enabled, false); assert.equal(o.commonSeriesSettings.point.visible, false);
			assert.equal(o.valueAxis.length, 1); assert.equal(o.legend.visible, true);
			assert.equal(o.commonSeriesSettings.aggregation.enabled, id.endsWith('-sampled'));
			if (id.endsWith('-sampled')) {
				assert.equal(o.commonSeriesSettings.aggregation.method, 'avg'); assert.equal(o.argumentAxis.aggregationGroupWidth, 1);
			}
	}
}

function checkPrepared(id, input, frame) {
	for (let i = 0; i < frame.x.length; i++) {
		for (let s = 0; s < SERIES.length; s++) {
			let x, y;
			switch (family(id)) {
				case 'uplot': x = input[0][i] * 1000; y = input[s + 1][i]; break;
				case 'dygraphs': x = input[i][0]; y = input[i][s + 1]; break;
				case 'flot': case 'kendo': [x, y] = input[s][i]; break;
				case 'canvasjs': ({x, y} = input[s][i]); break;
				default: x = input[i].time; y = input[i][SERIES[s].id];
			}
			assert.equal(+x, frame.x[i]); assert.equal(y, frame.ys[s][i]);
		}
	}
}

async function pending(promise, wait) {
	let settled = false;
	promise.then(() => { settled = true; });
	await Promise.resolve(); await Promise.resolve();
	assert.equal(settled, false); assert.equal(wait.textContent, 'waiting');
}

function noListeners(id, chart) {
	if (id === 'flot') assert.equal(chart.hooks.drawOverlay.length, 0);
	if (chart.listeners) assert.equal(chart.listeners(), 0);
}

describe('dashboard native adapters', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]); else delete globalThis[key];
	}));

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: prepares five unmodified signals and constructs 20 independent native charts before awaiting`, async () => {
			const records = install(id), frames = dashboardData(), before = structuredClone(frames);
			const inputs = frames.map(adapter.prepData), waits = frames.map(() => ({textContent: 'waiting'}));
			inputs.forEach((input, i) => { checkPrepared(id, input, frames[i]); assert.notEqual(adapter.prepData(frames[i]), input); });
			assert.deepEqual(frames, before);
			const creations = inputs.map((input, i) => adapter.makeChart(input, host(i), waits[i]));
			assert.equal(records.length, CHARTS);
			assert.equal(new Set(records.map(r => r.host.id)).size, CHARTS);
			if (asynchronous.has(id)) await pending(creations[0], waits[0]);
			for (const r of records) r.flush();
			const charts = await Promise.all(creations);
			records.forEach(r => checkOptions(id, r));
			assert.equal(new Set(charts).size, CHARTS);
			charts.forEach((chart, i) => {
				assert.equal(chart, records[i].chart); assert.equal(waits[i].textContent, 'Done!');
				assert.equal(adapter.validateChart(chart, inputs[i], {rows: ROWS}), true);
				noListeners(id, chart);
			});
			for (const rows of [2, ROWS]) {
				const replacement = dashboardData(rows).map(adapter.prepData);
				waits.forEach(wait => { wait.textContent = 'waiting'; });
				const updates = charts.map((chart, i) => adapter.updateChart(chart, replacement[i], records[i].host, waits[i]));
				if (asynchronous.has(id)) await pending(updates[0], waits[0]);
				records.forEach(r => r.flush());
				await Promise.all(updates);
				assert.equal(records.length, CHARTS, 'updates must not construct replacement charts');
				charts.forEach((chart, i) => {
					assert.equal(adapter.validateChart(chart, replacement[i], {rows}), true);
					assert.equal(waits[i].textContent, 'Done!'); noListeners(id, chart);
				});
			}
			charts.forEach(chart => { adapter.destroyChart(chart); assert.equal(chart.destroyed, true); });
			if (id === 'kendo' || id === 'syncfusion') assert.ok(records.every(r => r.host.emptied));
		});

		it(`${id}: rejects missing native series, wrong row counts, and stale same-length source data`, async () => {
			const records = install(id), frame = dashboardData()[0], input = adapter.prepData(frame);
			const creation = adapter.makeChart(input, host()); records[0].flush();
			const chart = await creation;
			const series = nativeSeries(id, chart), last = series.pop();
			assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS})); series.push(last);
			assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS - 1}));
			replaceSource(id, chart, adapter.prepData({...frame, ys: frame.ys.map(ys => ys.map(y => y + 1))}));
			assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /source data mismatch/);
			replaceSource(id, chart, adapter.prepData(dashboardData(2)[0]));
			assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}));
			adapter.destroyChart(chart);
		});
	}

	it('uplot: does not query the legend until the native ready hook fires', async () => {
		let chart, signalReady, legend = null, queries = 0;
		class DelayedUPlot {
			constructor(options) {
				chart = this;
				this.root = {querySelector() { queries++; return legend; }};
				signalReady = () => {
					legend = {style: {}};
					options.hooks.ready.forEach(fn => fn(this));
				};
			}
			destroy() { this.destroyed = true; }
		}
		const wait = {textContent: 'waiting'};
		const creation = uplot.makeChart(uplot.prepData(dashboardData(2)[0]), host(), wait, DelayedUPlot);
		await pending(creation, wait);
		assert.equal(queries, 0);
		signalReady();
		assert.equal(await creation, chart);
		assert.equal(queries, 1);
		assert.equal(legend.style.position, 'absolute');
		assert.equal(wait.textContent, 'Done!');
		uplot.destroyChart(chart);
		assert.equal(chart.destroyed, true);
	});

	for (const id of ['uplot', 'uplot-release']) {
		it(`${id}: waits for native readiness before placing legends in a 20-chart small init`, async () => {
			const records = install(id), adapter = adapters[id];
			const waits = Array.from({length: CHARTS}, () => ({textContent: 'waiting'}));
			const inputs = dashboardData(2).map(adapter.prepData);
			const creations = inputs.map((input, i) => adapter.makeChart(input, host(i), waits[i]));
			assert.equal(records.length, CHARTS);
			assert.ok(waits.every(wait => wait.textContent === 'waiting'));
			if (id === 'uplot') assert.ok(records.every(r => r.legend === null));
			const charts = await Promise.all(creations);
			charts.forEach((chart, i) => {
				assert.equal(chart, records[i].chart);
				assert.equal(records[i].legend.style.position, 'absolute');
				assert.equal(waits[i].textContent, 'Done!');
				assert.equal(adapter.validateChart(chart, inputs[i], {rows: 2}), true);
				adapter.destroyChart(chart);
			});
		});

		for (const failure of ['missing legend', 'style failure']) {
			it(`${id}: destroys its retained handle after ${failure}`, async () => {
				const records = install(id), adapter = adapters[id], wait = {textContent: 'waiting'};
				const creation = adapter.makeChart(adapter.prepData(dashboardData(2)[0]), host(), wait);
				const chart = records[0].chart, error = new Error('legend style failed');
				let destroyed = 0;
				chart.destroy = () => { destroyed++; };
				chart.root.querySelector = () => failure === 'missing legend' ? null : {get style() { throw error; }};
				await assert.rejects(creation, failure === 'missing legend' ? /legend is missing after native readiness/ : error);
				assert.equal(destroyed, 1);
				assert.equal(wait.textContent, 'waiting');
			});
		}
	}

	for (const id of ['flot', 'kendo', 'syncfusion', 'devextreme']) {
		it(`${id}: accepts a native ready event dispatched synchronously during construction`, async () => {
			const records = install(id);
			if (id === 'flot') {
				const plot = $.plot;
				$.plot = (...args) => { const chart = plot(...args); records[0].flush(); return chart; };
			}
			else if (id === 'syncfusion') {
				const append = ej.charts.Chart.prototype.appendTo;
				ej.charts.Chart.prototype.appendTo = function(container) { append.call(this, container); records[0].flush(); };
			}
			else {
				const namespace = id === 'kendo' ? kendoNamespace() : DevExpress.viz;
				const key = id === 'kendo' ? 'Chart' : 'dxChart', Chart = namespace[key];
				namespace[key] = class extends Chart {
					constructor(...args) { super(...args); records[0].flush(); }
				};
			}
			const adapter = adapters[id], input = adapter.prepData(dashboardData()[0]);
			const chart = await adapter.makeChart(input, host());
			assert.equal(adapter.validateChart(chart, input, {rows: ROWS}), true);
			noListeners(id, chart); adapter.destroyChart(chart);
		});
	}

	it('CanvasJS destroys a chart whose synchronous initial render fails', () => {
		const records = install('canvasjs'), Chart = CanvasJS.Chart;
		CanvasJS.Chart = class extends Chart {
			constructor(...args) { super(...args); records[0].fail = true; }
		};
		assert.throws(() => canvasjs.makeChart(canvasjs.prepData(dashboardData()[0]), host()), /render failed/);
		assert.equal(records[0].chart.destroyed, true);
	});

	it('AG Charts destroys a chart whose asynchronous initial render fails', async () => {
		const records = install('agcharts'), wait = {textContent: 'waiting'};
		const creation = agcharts.makeChart(agcharts.prepData(dashboardData()[0]), host(), wait);
		records[0].fail = true; records[0].flush();
		await assert.rejects(creation, /render failed/);
		assert.equal(records[0].chart.destroyed, true); assert.equal(wait.textContent, 'waiting');
	});

	it('DevExtreme rejects fatal native incidents and disposes its partially initialized chart', async () => {
		const records = install('devextreme'), wait = {textContent: 'waiting'};
		const creation = devextreme.makeChart(devextreme.prepData(dashboardData()[0]), host(), wait);
		records[0].options.onIncidentOccurred({target: {id: 'E100', text: 'render failed'}});
		await assert.rejects(creation, /E100: render failed/);
		assert.equal(records[0].chart.destroyed, true); assert.equal(wait.textContent, 'waiting');
	});

	it('the release variant requires its pinned constructor instead of falling back to master', () => {
		delete globalThis.uPlotRelease;
		assert.throws(() => release.makeChart(release.prepData(dashboardData()[0]), host()), /pinned uPlot release/);
	});
});
