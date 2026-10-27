import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ids = ['apexcharts', 'apexcharts-sampled', 'amcharts', 'amcharts-sampled', 'anychart', 'anychart-sampled',
	'devextreme', 'devextreme-sampled', 'fusiontime', 'fusiontime-sampled', 'agcharts', 'syncfusion'];
const adapters = Object.fromEntries(await Promise.all(ids.map(async id => [id, await import(`../../bench/${id}.mjs`)])));
const packed = JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url)));
const globals = ['ApexCharts', 'am5', 'am5xy', 'anychart', 'DevExpress', 'FusionCharts', 'agCharts', 'ej', 'devicePixelRatio'];
const turn = () => new Promise(resolve => setImmediate(resolve));
const freeze = value => {
	if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
	return value;
};

function vendor(id) {
	id = id.replace('-sampled', '');
	const state = {constructed: 0, destroyed: 0, disposedStore: 0, series: [], pending: [], listeners: new Map(), sync: false};
	const on = (name, callback) => {
		if (!state.listeners.has(name)) state.listeners.set(name, new Set());
		state.listeners.get(name).add(callback);
	};
	const off = (name, callback) => state.listeners.get(name)?.delete(callback);
	const emit = name => { for (const callback of [...state.listeners.get(name) ?? []]) callback(); };
	const fail = () => { if (state.error) throw state.error; };
	const promise = () => { fail(); return state.sync ? Promise.resolve() : new Promise(resolve => state.pending.push(resolve)); };
	state.listenerCount = () => [...state.listeners.values()].reduce((sum, set) => sum + set.size, 0);
	state.complete = () => {
		state.chart.animationTime = null;
		for (const done of state.pending.splice(0)) done();
		for (const name of ['frameended', 'chartDraw', 'renderComplete', 'done', 'drawn']) emit(name);
		state.options?.onDone?.();
		(state.chart.loaded ?? state.options?.loaded)?.();
	};
	const native = () => { fail(); if (state.sync) state.complete(); };
	const chart = state.chart = {
		destroy() { state.destroyed++; }, dispose() { state.destroyed++; },
		element: {replaceChildren() {}},
		on, off, listenOnce: on, unlisten: off, addEventListener: on, removeEventListener: off,
	};
	const constructed = options => { state.constructed++; state.options = options; };
	if (id === 'apexcharts') {
		globalThis.ApexCharts = class {
			constructor(host, options) {
				constructed(options);
				state.series = options.series;
				return Object.assign(chart, {
					render: promise,
					updateSeries(series, animate) { fail(); assert.equal(animate, false); state.series = series; return promise(); },
				});
			}
		};
		state.data = () => state.series.map(s => s.data);
	}
	else if (id === 'agcharts') {
		globalThis.agCharts = {AgCharts: {create(options) {
			constructed(options);
			return Object.assign(chart, {
				waitForUpdate: promise,
				updateDelta(delta) { fail(); assert.deepEqual(Object.keys(delta), ['data']); options.data = delta.data; return promise(); },
			});
		}}};
		state.data = () => state.options.data;
	}
	else if (id === 'devextreme') {
		globalThis.DevExpress = {viz: {dxChart: class {
			constructor(host, options) {
				constructed(options);
				options.onInitialized({component: chart});
				return Object.assign(chart, {option(key, value) {
					fail(); assert.equal(key, 'dataSource'); options[key] = value; native();
				}});
			}
		}}};
		state.data = () => state.options.dataSource;
	}
	else if (id === 'syncfusion') {
		globalThis.ej = {charts: {Chart: class {
			constructor(options) {
				constructed(options);
				return Object.assign(chart, {series: options.series, loaded: options.loaded, appendTo() {}, dataBind: native});
			}
		}}};
		state.data = () => chart.series[0].dataSource;
	}
	else if (id === 'amcharts') {
		const list = () => ({values: [], push(value) { this.values.push(value); return value; },
			getIndex(i) { return this.values[i]; }, each(fn) { this.values.forEach(fn); }});
		chart.container = {children: list()};
		chart.events = {on(name, callback) { on(name, callback); return {dispose() { off(name, callback); }}; }};
		chart.addDisposer = () => {};
		const entity = {new(root, options) { return {options}; }};
		const xy = {xAxes: list(), yAxes: list(), series: list(), children: list()};
		globalThis.am5 = {
			Root: {new() { constructed({}); return chart; }}, registry: {version: '5.21.4'}, color: value => value,
			Legend: {new() { return {data: {setAll() {}}}; }},
		};
		globalThis.am5xy = {
			XYChart: {new() { return xy; }}, DateAxis: entity, ValueAxis: entity, AxisRendererX: entity, AxisRendererY: entity,
			LineSeries: {new(root, options) {
				const series = {options, strokes: {template: {setAll() {}}}, data: {setAll(value) { fail(); this.values = value; }}};
				state.series.push(series); return series;
			}},
		};
		state.data = () => state.series[0].data.values;
	}
	else if (id === 'anychart') {
		const setting = () => {
			const value = {};
			for (const key of ['enabled', 'position', 'orientation', 'scale', 'format']) value[key] = v => { value[key + 'Value'] = v; return value; };
			value.labels = () => value;
			return value;
		};
		const grouping = setting(), scrollerGrouping = setting();
		const plot = {yScale() {}, yAxis: setting, legend: setting, line(mapping) {
			const series = {mapping, normal: () => ({markers: setting}), hovered: () => ({markers: setting}), selected: () => ({markers: setting})};
			for (const key of ['name', 'stroke', 'yScale']) series[key] = value => { series[key + 'Value'] = value; };
			state.series.push(series); return series;
		}};
		const table = state.table = {
			rows: [], startTransaction() {}, commit: native, rollback() { state.rolledBack = true; },
			remove() { fail(); this.rows = []; }, addData(rows) { fail(); this.rows = this.rows.concat(rows); },
			mapAs(options) { return {options, dispose() {}}; }, dispose() {},
		};
		Object.assign(chart, {animation() {}, bounds() {}, title() {}, xScale() {}, container() {},
			scroller: setting, grouping: () => grouping, scrollerGrouping: () => scrollerGrouping,
			plot: () => plot, draw: native, selectRange(value) { assert.equal(value, 'max'); }});
		globalThis.anychart = {stock() { constructed({grouping, scrollerGrouping}); return chart; },
			scales: {linear: () => ({dispose() {}})}, data: {table: () => table}};
		state.data = () => table.rows;
	}
	else {
		globalThis.FusionCharts = class {
			constructor(options) {
				constructed(options);
				return Object.assign(chart, {render: native, getJSONData: () => options.dataSource,
					setJSONData(source) { fail(); options.dataSource = source; native(); }});
			}
		};
		globalThis.FusionCharts.DataStore = class {
			createDataTable(rows, schema) {
				state.schema = schema;
				state.table = {rows, count: () => state.table.rows.length};
				rows.forEach((row, i) => row.push(i));
				return state.table;
			}
			getDataTable() { return state.table; }
			deleteRows(query) { fail(); assert.deepEqual(query, []); state.table.rows = []; }
			appendRows(rows) { fail(); rows.forEach((row, i) => row.push(i)); state.table.rows.push(...rows); }
			dispose() { state.disposedStore++; }
		};
		state.data = () => state.table.rows.map(row => row.slice(0, 4));
	}
	return state;
}

describe('bench-lifecycle-managed: native API contracts', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 1});
	});
	afterEach(() => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	async function finish(state, promise) { state.complete(); return promise; }

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: creates a genuinely empty chart, replaces all prepared rows twice, and keeps the handle`, async () => {
			const state = vendor(id);
			const wait = {textContent: 'Empty...'};
			const handle = await finish(state, adapter.makeEmptyChart({}, wait));
			assert.equal(wait.textContent, 'Done!');
			assert.deepEqual(state.data(), id.startsWith('apexcharts') ? [[], [], []] : []);
			assert.equal(state.constructed, 1);
			const store = handle.store, table = handle.table;
			for (let revision = 0; revision < 2; revision++) {
				const changed = packed.slice();
				if (revision) for (let i = changed[0] + 1; i < changed.length; i += changed[0]) {
					changed[i] += 100000; changed[i + 1] *= 0.5; changed[i + 3] += 25;
				}
				const input = freeze(adapter.prepData(changed));
				wait.textContent = 'Updating...';
				let settled = false;
				const updating = Promise.resolve(adapter.updateChart(handle, input, {}, wait)).then(result => { settled = true; return result; });
				await turn();
				assert.equal(settled, false, 'must wait for native readiness');
				assert.equal(wait.textContent, 'Updating...');
				assert.equal(await finish(state, updating), undefined, 'updates return no replacement handle');
				assert.deepEqual(state.data(), input);
				assert.equal(handle.store, store);
				assert.equal(handle.table, table);
				assert.equal(state.listenerCount(), 0);
				assert.equal(state.destroyed, 0);
				assert.equal(state.constructed, 1);
				assert.equal(wait.textContent, 'Done!');
			}
			adapter.destroyChart(handle);
			assert.equal(state.destroyed, 1);
			if (id.startsWith('fusiontime')) assert.equal(state.disposedStore, 1);
		});

		it(`${id}: keeps direct populated makeChart and the variant's sampling configuration`, async () => {
			const state = vendor(id);
			const input = freeze(adapter.prepData(packed));
			const handle = await finish(state, adapter.makeChart(input, {}));
			assert.deepEqual(state.data(), input);
			const sampled = id.endsWith('-sampled');
			if (id.startsWith('apexcharts')) assert.equal(state.options.chart.dataReducer.enabled, sampled);
			if (id.startsWith('amcharts')) {
				assert.equal(handle.container.children.getIndex(0).xAxes.getIndex(0).options.groupData, sampled);
				assert.equal(state.series[0].options.minDistance, sampled ? 1 : 0);
			}
			if (id.startsWith('anychart')) assert.equal(state.options.grouping.enabledValue, sampled ? undefined : false);
			if (id.startsWith('devextreme')) assert.equal(state.options.commonSeriesSettings.aggregation.enabled, sampled);
			if (id.startsWith('fusiontime')) assert.equal(state.options.dataSource.xAxis.binning === undefined, sampled);
			adapter.destroyChart(handle);
		});

		it(`${id}: rejects native update errors, removes listeners, and leaves teardown to the caller`, async () => {
			const state = vendor(id);
			const handle = await finish(state, adapter.makeEmptyChart({}));
			state.error = new Error('native replacement failed');
			const wait = {textContent: 'Updating...'};
			await assert.rejects(async () => adapter.updateChart(handle, adapter.prepData(packed), {}, wait), error => error === state.error);
			assert.equal(state.listenerCount(), 0);
			assert.equal(state.destroyed, 0);
			assert.equal(wait.textContent, 'Updating...');
			adapter.destroyChart(handle);
			assert.equal(state.destroyed, 1);
		});

		if (!id.startsWith('amcharts')) it(`${id}: observes synchronous native update completion`, async () => {
			const state = vendor(id);
			const handle = await finish(state, adapter.makeEmptyChart({}));
			state.sync = true;
			assert.equal(await adapter.updateChart(handle, adapter.prepData(packed), {}), undefined);
			assert.equal(state.listenerCount(), 0);
			adapter.destroyChart(handle);
		});
	}

	it('DevExtreme resolves native empty drawn, not a missing series done event', async () => {
		const state = vendor('devextreme');
		const pending = adapters.devextreme.makeEmptyChart({});
		state.options.onDrawn();
		adapters.devextreme.destroyChart(await pending);
	});

	it('DevExtreme update rejects E incidents but leaves W evaluation notices alone', async () => {
		const state = vendor('devextreme');
		const handle = await finish(state, adapters.devextreme.makeEmptyChart({}));
		const pending = adapters.devextreme.updateChart(handle, adapters.devextreme.prepData(packed), {});
		const incident = [...state.listeners.get('incidentOccurred')][0];
		incident({target: {id: 'W0019', text: 'Evaluation'}});
		incident({target: {id: 'E2001', text: 'Invalid data'}});
		await assert.rejects(pending, /DevExtreme E2001: Invalid data/);
		assert.equal(state.listenerCount(), 0);
		adapters.devextreme.destroyChart(handle);
	});
});
