import assert from 'node:assert/strict';
import {WIDTH, HEIGHT, CHARTS, ROWS, SERIES, dashboardData} from '../../bench/dashboard/common.mjs';

const ids = ['chartjs', 'apexcharts', 'apexcharts-sampled', 'highcharts', 'highcharts-svg', 'plotly', 'plotly-svg', 'billboard'];
const adapters = Object.fromEntries(await Promise.all(ids.map(async id => [id, await import(`../../bench/dashboard/${id}.mjs`)])));
const globals = ['Chart', 'ApexCharts', 'Highcharts', 'Plotly', 'bb', 'devicePixelRatio',
	'HTMLCanvasElement', 'virtualWebGL', 'benchmarkWebGL'];
const turn = () => new Promise(resolve => setImmediate(resolve));
const clone = value => structuredClone(value);
const freeze = value => {
	if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
	return value;
};

function host() {
	return {
		children: [],
		appendChild(canvas) { this.children.push(canvas); canvas.parent = this; },
		ownerDocument: {createElement(tag) {
			assert.equal(tag, 'canvas');
			return {style: {}, getContext(type) { assert.equal(type, '2d'); return {canvas: this}; },
				remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }};
		}},
	};
}

function vendor(id, {boosted = false, sync = false} = {}) {
	const state = {records: [], error: null, sync, boosted};
	const fail = () => { if (state.error) throw state.error; };
	const record = (host, options) => {
		const r = {host, options, pending: [], destroyed: 0, listeners: new Map()};
		r.ready = () => { fail(); return state.sync ? Promise.resolve() : new Promise(resolve => r.pending.push(resolve)); };
		r.complete = () => { for (const fn of r.pending.splice(0)) fn(); };
		r.emit = (target, name) => { for (const fn of [...r.listeners.get(target)?.get(name) ?? []]) fn(); };
		r.chart = {destroy() { r.destroyed++; r.emit(r.chart, 'destroy'); }};
		r.listenerCount = () => [...r.listeners.values()].flatMap(events => [...events.values()]).reduce((n, set) => n + set.size, 0);
		state.records.push(r);
		return r;
	};
	state.complete = () => state.records.forEach(r => r.complete());
	if (id === 'chartjs') globalThis.Chart = class {
		constructor(ctx, options) {
			const r = record(ctx.canvas.parent, options), chart = r.chart;
			chart.canvas = ctx.canvas;
			chart.data = clone(options.data);
			chart.update = mode => { fail(); assert.equal(mode, 'none'); chart.data = clone(chart.data); };
			r.values = () => chart.data.datasets.map(s => s.data.map(p => [p.x, p.y]));
			r.corrupt = key => { chart.data.datasets[4].data[0][key]++; };
			r.drop = () => chart.data.datasets.pop();
			return chart;
		}
	};
	else if (id.startsWith('apexcharts')) globalThis.ApexCharts = class {
		constructor(host, options) {
			const r = record(host, options), chart = r.chart;
			const set = series => {
				chart.w = {config: {series: clone(series)}, globals: {
					series: series.map(s => s.data.map(p => p[1])), seriesX: series.map(s => s.data.map(p => p[0])),
				}};
			};
			set(options.series);
			chart.render = r.ready;
			chart.updateSeries = (series, animate) => { fail(); assert.equal(animate, false); set(series); return r.ready(); };
			r.values = () => chart.w.globals.series.map((ys, s) => ys.map((y, i) => [chart.w.globals.seriesX[s][i], y]));
			r.corrupt = key => { chart.w.globals[key === 'x' ? 'seriesX' : 'series'][4][0]++; };
			r.drop = () => chart.w.globals.series.pop();
			return chart;
		}
	};
	else if (id.startsWith('highcharts')) globalThis.Highcharts = {
		chart(host, options) {
			const r = record(host, options), chart = r.chart;
			chart.series = options.series.map(s => {
				const series = {name: s.name, boosted: state.boosted && options.boost.enabled !== false,
					columns: clone(s.dataTable.columns), getColumn(key) { return this.columns[key]; },
					setData(data, redraw, animation, updatePoints) {
						fail(); assert.deepEqual([redraw, animation, updatePoints], [false, false, false]);
						this.columns = clone(data.columns);
					},
				};
				return series;
			});
			let loaded = false;
			r.complete = () => {
				if (!loaded) { loaded = true; options.chart.events.load.call(chart); }
				for (const series of chart.series) r.renderSeries(series);
			};
			r.renderSeries = series => {
				options.plotOptions.series.events.renderedCanvas.call(series);
				r.emit(series, 'renderedCanvas');
			};
			chart.redraw = animation => { fail(); assert.equal(animation, false); if (state.sync) r.complete(); };
			r.values = () => chart.series.map(s => s.columns.y.map((y, i) => [s.columns.x[i], y]));
			r.corrupt = key => { chart.series[4].columns[key][0]++; };
			r.drop = () => chart.series.pop();
			if (state.sync) r.complete();
			return chart;
		},
		addEvent(target, name, fn) {
			const r = state.records.find(r => r.chart === target || r.chart.series.includes(target));
			if (!r.listeners.has(target)) r.listeners.set(target, new Map());
			const events = r.listeners.get(target);
			if (!events.has(name)) events.set(name, new Set());
			events.get(name).add(fn);
			return () => events.get(name).delete(fn);
		},
	};
	else if (id.startsWith('plotly')) globalThis.Plotly = {
		async newPlot(host, data, layout, config) {
			const r = record(host, {data, layout, config}), chart = r.chart = host;
			chart.data = clone(data);
			if (data[0].type === 'scattergl') {
				r.regls = Array.from({length: 2}, () => {
					const canvas = new HTMLCanvasElement();
					host.appendChild(canvas);
					canvas.parentNode = host;
					return {_gl: canvas.getContext('webgl'), destroyed: 0, destroy() { this.destroyed++; }};
				});
				chart._fullLayout = {_glcanvas: {data: () => [...r.regls.map(regl => ({regl})), {pick: true}]}};
			}
			r.values = () => chart.data.map(s => s.y.map((y, i) => [s.x[i], y]));
			r.corrupt = key => { chart.data[4][key][0]++; };
			r.drop = () => chart.data.pop();
			await r.ready();
			return chart;
		},
		react(chart, data, layout) {
			fail(); const r = state.records.find(r => r.chart === chart);
			chart.data = clone(data); r.options.layout = layout;
			return r.ready();
		},
		purge(chart) {
			state.records.find(r => r.chart === chart).destroyed++;
			for (const canvas of chart.children) canvas.parentNode = canvas.parent = null;
			chart.children.length = 0;
			delete chart._fullLayout;
			delete chart.data;
		},
	};
	else globalThis.bb = {generate(options) {
		const r = record(options.bindto, options), chart = r.chart;
		const set = columns => {
			r.series = columns.slice(1).map(column => ({id: column[0], values: column.slice(1).map((value, i) => ({x: new Date(columns[0][i + 1]), value}))}));
		};
		set(options.data.columns);
		chart.data = () => r.series;
		chart.load = ({columns}) => { fail(); set(columns); if (state.sync) r.complete(); };
		r.complete = () => options.onrendered.call(chart);
		r.values = () => r.series.map(s => s.values.map(p => [+p.x, p.value]));
		r.corrupt = key => { const p = r.series[4].values[0]; if (key === 'x') p.x = new Date(+p.x + 1); else p.value++; };
		r.drop = () => r.series.pop();
		options.onbeforeinit.call(chart);
		if (state.sync) r.complete();
		return chart;
	}};
	return state;
}

function checkConfig(id, r) {
	const o = r.options;
	if (id === 'chartjs') {
		assert.equal(r.chart.canvas.width, WIDTH); assert.equal(r.chart.canvas.height, HEIGHT);
		assert.equal(r.chart.canvas.id, undefined);
		assert.equal(o.options.responsive, false); assert.equal(o.options.animation, false);
		assert.deepEqual(Object.keys(o.options.scales), ['x', 'y']);
		assert.equal(o.options.plugins.legend.display, true);
		assert.deepEqual(o.options.plugins.decimation, {enabled: true, algorithm: 'min-max'});
		assert.deepEqual(o.data.datasets.map(s => [s.label, s.borderColor, s.pointRadius]), SERIES.map(s => [s.label, s.color, 0]));
	}
	else if (id.startsWith('apexcharts')) {
		assert.equal(o.chart.width, WIDTH); assert.equal(o.chart.height, HEIGHT);
		assert.equal(o.chart.renderer, 'canvas'); assert.equal(o.chart.animations.enabled, false);
		assert.deepEqual(o.chart.dataReducer, id.endsWith('-sampled') ? {enabled: true, targetPoints: 1920, threshold: 3840} : {enabled: false});
		assert.deepEqual(o.yaxis, {}); assert.equal(o.legend.show, true); assert.equal(o.markers.size, 0);
		assert.deepEqual(o.colors, SERIES.map(s => s.color));
	}
	else if (id.startsWith('highcharts')) {
		assert.equal(o.chart.width, WIDTH); assert.equal(o.chart.height, HEIGHT);
		assert.equal(o.chart.animation, false); assert.equal(o.legend.enabled, true);
		assert.equal(Array.isArray(o.yAxis), false); assert.equal(o.plotOptions.series.marker.enabled, false);
		assert.deepEqual(o.boost, id.endsWith('-svg') ? {useGPUTranslations: false, enabled: false} : {useGPUTranslations: false});
		assert.equal(o.plotOptions.series.boostThreshold, undefined);
		assert.deepEqual(o.series.map(s => [s.name, s.color, s.yAxis]), SERIES.map(s => [s.label, s.color, 0]));
	}
	else if (id.startsWith('plotly')) {
		assert.equal(r.chart, r.host, 'the native Plotly handle is its host');
		if (id === 'plotly') assert.deepEqual(r.chart.getWebGLContexts(), r.regls.map(regl => regl._gl));
		assert.equal(o.layout.width, WIDTH); assert.equal(o.layout.height, HEIGHT);
		assert.equal(o.layout.yaxis2, undefined); assert.equal(o.layout.showlegend, true);
		assert.equal(o.layout.transition.duration, 0); assert.equal(o.config.responsive, false);
		assert.deepEqual(r.chart.data.map(s => [s.name, s.line.color, s.mode, s.type, s.yaxis]),
			SERIES.map(s => [s.label, s.color, 'lines', id.endsWith('-svg') ? 'scatter' : 'scattergl', 'y']));
		assert.equal(r.chart.data[0].line.simplify, undefined, 'keep native SVG simplification');
	}
	else {
		assert.deepEqual(o.size, {width: WIDTH, height: HEIGHT});
		assert.deepEqual(o.render, {mode: 'canvas', lazy: false, observe: false});
		assert.equal(o.boost.useWorker, false); assert.equal(o.transition.duration, 0);
		assert.equal(o.axis.y2, undefined); assert.equal(o.legend.show, true); assert.equal(o.point.show, false);
		assert.deepEqual(o.data.names, Object.fromEntries(SERIES.map(s => [s.id, s.label])));
		assert.deepEqual(o.data.colors, Object.fromEntries(SERIES.map(s => [s.id, s.color])));
	}
}

function expected(frame) {
	return frame.ys.map(ys => ys.map((y, i) => [frame.x[i], y]));
}

async function unsettled(promise, wait) {
	let done = false;
	promise.then(() => { done = true; });
	await turn();
	assert.equal(done, false, 'wait for native readiness');
	assert.equal(wait.textContent, 'waiting');
}

describe('dashboard: native configuration and lifecycle contracts', () => {
	let saved, canvasPrototype, contextDescriptor;
	beforeEach(() => {
		saved = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
		globalThis.devicePixelRatio = 2;
		// Use a fresh prototype so ownership wrappers never modify an existing runtime.
		globalThis.HTMLCanvasElement = class {
			getContext(type) {
				assert.equal(type, 'webgl');
				return this.context ??= {disposed: 0, isContextLost: () => false, dispose() { this.disposed++; }};
			}
		};
		canvasPrototype = HTMLCanvasElement.prototype;
		contextDescriptor = Object.getOwnPropertyDescriptor(canvasPrototype, 'getContext');
		globalThis.virtualWebGL = {};
		delete globalThis.benchmarkWebGL;
	});
	afterEach(() => {
		Object.defineProperty(canvasPrototype, 'getContext', contextDescriptor);
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: batches 20 independent charts at final size, replaces all five series, and destroys`, async () => {
			const state = vendor(id), hosts = Array.from({length: CHARTS}, host);
			await adapter.prepareRuntime?.();
			const frames = freeze(dashboardData(2)), inputs = frames.map(frame => freeze(adapter.prepData(frame)));
			const waits = hosts.map(() => ({textContent: 'waiting'}));
			const pending = Promise.all(hosts.map((host, i) => adapter.makeChart(inputs[i], host, waits[i])));
			assert.equal(state.records.length, 20, 'start all charts before awaiting the batch');
			if (id !== 'chartjs') await unsettled(pending, waits[0]);
			state.complete();
			const handles = await pending;
			assert.equal(new Set(handles).size, CHARTS);
			for (let i = 0; i < CHARTS; i++) {
				assert.equal(state.records[i].host, hosts[i]);
				assert.equal(handles[i], state.records[i].chart);
				checkConfig(id, state.records[i]);
				assert.deepEqual(state.records[i].values(), expected(frames[i]));
				assert.equal(adapter.validateChart(handles[i], inputs[i], {rows: 2}), true);
			}
			for (const [revision, rows] of [ROWS, ROWS, 2].entries()) {
				const replacement = dashboardData(rows).map(frame => ({x: frame.x.map(x => x + 600000 * (revision + 1)), ys: frame.ys.map(ys => ys.map(y => y + 7 * (revision + 1)))}));
				const data = replacement.map(frame => freeze(adapter.prepData(freeze(frame))));
				waits.forEach(wait => { wait.textContent = 'waiting'; });
				const update = Promise.all(handles.map((handle, i) => adapter.updateChart(handle, data[i], hosts[i], waits[i])));
				if (id !== 'chartjs' && !id.startsWith('highcharts')) await unsettled(update, waits[0]);
				state.complete(); await update;
				assert.equal(state.records.length, CHARTS, 'updates must retain native handles');
				for (let i = 0; i < CHARTS; i++) {
					assert.deepEqual(state.records[i].values(), expected(replacement[i]));
					assert.equal(adapter.validateChart(handles[i], data[i], {rows}), true);
					assert.throws(() => adapter.validateChart(handles[i], data[i], {rows: rows + 1}));
					assert.equal(waits[i].textContent, 'Done!');
					assert.equal(state.records[i].listenerCount(), 0);
				}
			}
			handles.forEach(handle => adapter.destroyChart(handle));
			assert.ok(state.records.every(r => r.destroyed === 1));
			assert.ok(hosts.every(host => host.children.length === 0));
			if (id === 'plotly') {
				assert.ok(state.records.every(r => r.regls.every(regl => regl.destroyed === 1 && regl._gl.disposed === 1)));
				assert.ok(handles.every(handle => handle.getWebGLContexts().length === 0));
			}
		});

		it(`${id}: validates native x/y data and rejects a missing fifth series`, async () => {
			const state = vendor(id, {sync: true});
			await adapter.prepareRuntime?.();
			const input = freeze(adapter.prepData(freeze(dashboardData()[0])));
			const handle = await adapter.makeChart(input, host());
			const r = state.records[0];
			for (const key of ['x', 'y']) {
				r.corrupt(key);
				assert.throws(() => adapter.validateChart(handle, input, {rows: ROWS}), /mismatch/);
				await adapter.updateChart(handle, input);
			}
			r.drop();
			assert.throws(() => adapter.validateChart(handle, input, {rows: ROWS}));
			adapter.destroyChart(handle);
		});

		it(`${id}: rejects native update failures without signaling readiness`, async () => {
			const state = vendor(id, {sync: true}), input = adapter.prepData(dashboardData(2)[0]);
			await adapter.prepareRuntime?.();
			const handle = await adapter.makeChart(input, host());
			state.error = new Error('native update failed');
			const wait = {textContent: 'waiting'};
			await assert.rejects(async () => adapter.updateChart(handle, input, null, wait), /native update failed/);
			assert.equal(wait.textContent, 'waiting');
			assert.equal(state.records[0].listenerCount(), 0);
			state.error = null;
			await adapter.updateChart(handle, input);
			adapter.destroyChart(handle);
		});
	}

	it('Highcharts waits for all boosted series on initial draw and update, without forcing Boost', async () => {
		const state = vendor('highcharts', {boosted: true});
		const adapter = adapters.highcharts, input = adapter.prepData(dashboardData()[0]);
		const wait = {textContent: 'waiting'}, pending = adapter.makeChart(input, host(), wait), r = state.records[0];
		r.options.chart.events.load.call(r.chart);
		r.chart.series.slice(0, 4).forEach(r.renderSeries);
		await unsettled(pending, wait);
		r.renderSeries(r.chart.series[4]);
		const handle = await pending;
		wait.textContent = 'waiting';
		const update = adapter.updateChart(handle, input, null, wait);
		r.chart.series.slice(0, 4).forEach(r.renderSeries);
		await unsettled(update, wait);
		r.renderSeries(r.chart.series[4]);
		await update;
		assert.equal(r.listenerCount(), 0);
		adapter.destroyChart(handle);
	});

	for (const id of ['billboard', 'highcharts']) it(`${id}: destroying a pending update rejects it and cleans listeners`, async () => {
		const state = vendor(id, {sync: true, boosted: true}), adapter = adapters[id];
		const input = adapter.prepData(dashboardData()[0]);
		const handle = await adapter.makeChart(input, host());
		state.sync = false;
		const pending = adapter.updateChart(handle, input);
		if (id === 'billboard') await assert.rejects(adapter.updateChart(handle, input), /already pending/);
		adapter.destroyChart(handle);
		await assert.rejects(pending, /destroyed before rendering/);
		assert.equal(state.records[0].listenerCount(), 0);
	});
});
