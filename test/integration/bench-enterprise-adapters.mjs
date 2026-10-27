import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as syncfusion from '../../bench/syncfusion.mjs';
import * as devextreme from '../../bench/devextreme.mjs';
import * as devextremeSampled from '../../bench/devextreme-sampled.mjs';
import * as jscharting from '../../bench/jscharting.mjs';
import * as kendo from '../../bench/kendo.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const adapters = {syncfusion, devextreme, 'devextreme-sampled': devextremeSampled, jscharting, kendo};
const names = ['CPU', 'RAM', 'TCP Out'];
const colors = ['red', 'blue', 'green'];
const compact = id => id === 'jscharting' || id === 'kendo';

function freeze(data) {
	if (data && typeof data === 'object') {
		Object.values(data).forEach(freeze);
		Object.freeze(data);
	}
	return data;
}

function values(id, data, j) {
	return compact(id)
		? [+data[0][j][0], ...data.map(points => points[j][1])]
		: [+data[j].time, data[j].cpu, data[j].ram, data[j].tcp];
}

function vendor(id, {sync = false, fail = false, cleanupError = false} = {}) {
	id = id.replace('-sampled', '');
	const state = {destroyed: 0, emptied: 0, error: new Error('render failed')};
	const chart = state.chart = {
		element: {
			empty() { state.emptied++; },
			replaceChildren() { state.emptied++; },
		},
		destroy() { state.destroyed++; if (cleanupError) throw new Error('cleanup failed'); },
		dispose() { this.destroy(); },
	};
	const constructed = options => {
		state.options = options;
		if (sync) state.complete();
		if (fail) throw state.error;
	};
	if (id === 'syncfusion') {
		globalThis.ej = {charts: {Chart: class {
			constructor(options) {
				state.complete = () => options.loaded({chart});
				state.options = options;
				return Object.assign(chart, {appendTo(host) { state.host = host; constructed(options); }});
			}
		}}};
	}
	else if (id === 'devextreme') {
		globalThis.DevExpress = {viz: {dxChart: class {
			constructor(host, options) {
				state.host = host;
				options.onInitialized({component: chart});
				state.complete = () => options.onDone({component: chart});
				constructed(options);
				return chart;
			}
		}}};
	}
	else if (id === 'jscharting') {
		globalThis.JSC = {chart(host, options, ready) {
			state.host = host;
			state.complete = () => ready.call(chart);
			constructed(options);
			return chart;
		}};
	}
	else {
		globalThis.kendo = {dataviz: {ui: {Chart: class {
			constructor(host, options) {
				state.host = host;
				state.complete = () => options.render({sender: chart});
				constructed(options);
				return chart;
			}
		}}}};
	}
	return state;
}

function autoDomain(axis) {
	for (const key of ['min', 'max', 'minimum', 'maximum', 'visualRange', 'wholeRange', 'range'])
		assert.equal(axis[key], undefined, key);
}

describe('enterprise benchmark adapters', () => {
	let saved;
	let frames;
	beforeEach(() => {
		saved = Object.fromEntries(['ej', 'DevExpress', 'JSC', 'kendo', 'devicePixelRatio', 'requestAnimationFrame']
			.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 2});
		frames = [];
		globalThis.requestAnimationFrame = callback => { frames.push(callback); };
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	async function finish(id, state, pending) {
		state.complete();
		await Promise.resolve();
		if (id === 'kendo')
			assert.equal(frames.length, 0);
		return pending;
	}

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: preserves every value of all 55,550 rows without source mutation`, () => {
			assert.deepEqual(Object.keys(adapter), id === 'devextreme'
				? ['destroyChart', 'getHoverPlan', 'makeChart', 'makeChartWithOptions', 'makeEmptyChart', 'prepData', 'resizeChart', 'updateChart']
				: id === 'jscharting' ? ['destroyChart', 'makeChart', 'prepData']
				: ['destroyChart', 'makeChart', 'makeEmptyChart', 'prepData', 'resizeChart', 'updateChart']);
			const data = freeze(adapter.prepData(packed));
			const again = adapter.prepData(packed);
			assert.notEqual(data, again);
			if (compact(id)) {
				assert.equal(data.length, 3);
				for (const points of data) assert.equal(points.length, 55550);
			}
			else assert.equal(data.length, 55550);
			for (let j = 0, i = packed[0] + 1; j < 55550; j++, i += packed[0]) {
				assert.deepEqual(values(id, data, j), [
					packed[i] * 60000,
					Math.round((100 - packed[i + 1]) * 1000) / 1000,
					Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
					packed[i + 3],
				]);
				if (compact(id)) {
					for (let k = 0; k < 3; k++) {
						assert.notEqual(data[k][j], again[k][j]);
						assert.equal(+data[k][j][0], packed[i] * 60000);
					}
				}
				else assert.notEqual(data[j], again[j]);
			}
		});

		it(`${id}: preserves irregular calendar gaps and rounding`, () => {
			const input = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
				10, 75, 2, 3, 4, 25, 75,
				17, 50, 2, 6, 4, 50, 50,
				31, 87.6543, 2, 9, 4, 1, 2]);
			const data = adapter.prepData(input);
			assert.deepEqual([0, 1, 2].map(j => values(id, data, j)), [
				[600000, 25, 25, 3], [1020000, 50, 50, 6], [1860000, 12.346, 33.33, 9],
			]);
		});

		for (const sync of [false, true]) {
			it(`${id}: waits for ${sync ? 'synchronous' : 'deferred'} vendor readiness and cleans up`, async () => {
				const state = vendor(id, {sync});
				const host = freeze({id: `benchmark-${id}`, style: {width: '1920px', height: '600px'}});
				const wait = {textContent: 'Rendering...'};
				const data = freeze(adapter.prepData(packed));
				let finished = false;
				const pending = adapter.makeChart(data, host, wait).then(chart => { finished = true; return chart; });
				assert.equal(finished, false);
				assert.equal(wait.textContent, 'Rendering...');
				assert.equal(state.host, host);
				if (!sync) {
					await Promise.resolve();
					assert.equal(finished, false);
				}
				await finish(id, state, pending);
				assert.equal(await pending, state.chart);
				assert.equal(wait.textContent, 'Done!');
				assert.equal(state.destroyed, 0);
				adapter.destroyChart(state.chart);
				assert.equal(state.destroyed, 1);
				assert.equal(state.emptied, id === 'kendo' || id === 'syncfusion' ? 1 : 0);
			});
		}

		for (const sync of [false, true]) {
			it(`${id}: preserves construction errors ${sync ? 'after' : 'before'} readiness, even if cleanup throws`, async () => {
				const state = vendor(id, {sync, fail: true, cleanupError: true});
				const wait = {textContent: 'Rendering...'};
				const pending = adapter.makeChart(adapter.prepData(packed), {}, wait);
				await assert.rejects(pending, error => error === state.error);
				// Kendo/JSC expose no instance if their constructors throw before the callback.
				const available = sync || id === 'syncfusion' || id.startsWith('devextreme');
				assert.equal(state.destroyed, available ? 1 : 0);
				assert.equal(state.emptied, available && (id === 'kendo' || id === 'syncfusion') ? 1 : 0);
				assert.equal(wait.textContent, 'Rendering...');
			});
		}

		it(`${id}: accepts an omitted wait element`, async () => {
			const state = vendor(id);
			await finish(id, state, adapter.makeChart(adapter.prepData(packed), {}));
		});
	}

	it('Syncfusion: Canvas, complete shared data, native reduction, date axis, and independent dual axes', async () => {
		const state = vendor('syncfusion');
		const data = freeze(syncfusion.prepData(packed));
		await finish('syncfusion', state, syncfusion.makeChart(data, {}));
		const o = state.options;
		assert.equal(o.enableCanvas, true);
		assert.equal(o.width, '1920');
		assert.equal(o.height, '600');
		assert.equal(o.primaryXAxis.valueType, 'DateTime');
		assert.equal(o.primaryXAxis.rangePadding, 'None');
		assert.equal(o.primaryYAxis.labelFormat, '{value}%');
		assert.equal(o.axes[0].labelFormat, '{value} MB');
		assert.equal(o.axes[0].opposedPosition, true);
		[o.primaryXAxis, o.primaryYAxis, ...o.axes].forEach(autoDomain);
		assert.equal(o.series.length, 3);
		o.series.forEach((s, i) => {
			assert.equal(s.dataSource, data);
			assert.equal(s.type, 'Line');
			assert.equal(s.xName, 'time');
			assert.equal(s.yName, ['cpu', 'ram', 'tcp'][i]);
			assert.equal(s.yAxisName, i === 2 ? 'tcp' : null);
			assert.equal(s.name, names[i]);
			assert.equal(s.fill, colors[i]);
			assert.equal(s.width, 0.5);
			assert.equal(s.animation.enable, false);
			assert.equal(s.marker.visible, false);
			assert.equal(s.marker.dataLabel.visible, false);
		});
	});

	for (const [id, adapter] of [['devextreme', devextreme], ['devextreme-sampled', devextremeSampled]]) {
		it(`${id}: full source, exact aggregation settings, continuous dates, and independent dual axes`, async () => {
			const sampled = id.endsWith('-sampled');
			const state = vendor(id);
			const data = freeze(adapter.prepData(packed));
			await finish(id, state, adapter.makeChart(data, {}, undefined, {sampled: !sampled}));
			const o = state.options;
			assert.equal(o.dataSource, data);
			assert.deepEqual(o.size, {width: 1920, height: 600});
			assert.equal(o.animation.enabled, false);
			assert.equal(o.commonSeriesSettings.type, 'line');
			assert.equal(o.commonSeriesSettings.argumentField, 'time');
			assert.equal(o.commonSeriesSettings.width, 0.5);
			assert.equal(o.commonSeriesSettings.point.visible, false);
			assert.equal(o.commonSeriesSettings.label.visible, false);
			assert.equal(o.dataSource.length, 55550);
			assert.deepEqual(o.dataPrepareSettings, {sortingMethod: false});
			assert.deepEqual(o.commonSeriesSettings.aggregation, sampled ? {enabled: true, method: 'avg'} : {enabled: false});
			assert.deepEqual(o.argumentAxis, {
				argumentType: 'datetime', type: 'continuous', ...(sampled ? {aggregationGroupWidth: 1} : {}),
			});
			assert.equal(o.synchronizeMultiAxes, false);
			assert.deepEqual(o.series.map(s => s.valueField), ['cpu', 'ram', 'tcp']);
			assert.deepEqual(o.series.map(s => s.axis), ['percent', 'percent', 'tcp']);
			assert.deepEqual(o.series.map(s => s.name), names);
			assert.deepEqual(o.series.map(s => s.color), colors);
			assert.deepEqual(o.valueAxis.map(a => a.position), ['left', 'right']);
			assert.equal(o.valueAxis[0].label.customizeText({valueText: '42'}), '42%');
			assert.equal(o.valueAxis[1].label.customizeText({valueText: '7'}), '7 MB');
			[o.argumentAxis, ...o.valueAxis].forEach(autoDomain);
		});

		it(`${id}: rejects error incidents, but keeps evaluation warnings and waits for onDone`, async () => {
			const state = vendor(id, {cleanupError: true});
			const wait = {textContent: 'Rendering...'};
			const pending = adapter.makeChart([], {}, wait);
			state.options.onIncidentOccurred({target: {id: 'W0019', text: 'Evaluation warning'}});
			await Promise.resolve();
			assert.equal(wait.textContent, 'Rendering...');
			state.options.onIncidentOccurred({target: {id: 'E2001', text: 'Invalid data'}});
			await assert.rejects(pending, /DevExtreme E2001: Invalid data/);
			assert.equal(state.destroyed, 1);
			assert.equal(wait.textContent, 'Rendering...');
		});
	}

	it('DevExtreme sampled wrapper shares preparation and cleanup with the base', () => {
		assert.equal(devextremeSampled.prepData, devextreme.prepData);
		assert.equal(devextremeSampled.destroyChart, devextreme.destroyChart);
	});

	for (const id of ['jscharting', 'kendo']) {
		it(`${id}: complete native point arrays, calendar time, markers off, dual auto domains`, async () => {
			const state = vendor(id);
			const data = freeze(adapters[id].prepData(packed));
			await finish(id, state, adapters[id].makeChart(data, {}));
			const o = state.options;
			assert.equal(o.series.length, 3);
			assert.deepEqual(o.series.map(s => s.yAxis), ['percent', 'percent', 'tcp']);
			assert.deepEqual(o.series.map(s => s.name), names);
			assert.deepEqual(o.series.map(s => s.color), colors);
			o.series.forEach((s, i) => assert.equal(s[id === 'kendo' ? 'data' : 'points'], data[i]));
			[o.xAxis, ...o.yAxis].forEach(autoDomain);
			if (id === 'jscharting') {
				assert.equal(o.width, 1920);
				assert.equal(o.height, 600);
				assert.equal(o.type, 'line');
				assert.equal(o.animation, false);
				assert.equal(o.defaultSeries.animation, false);
				assert.equal(o.defaultSeries.line.width, 0.5);
				assert.equal(o.defaultSeries.defaultPoint.marker.visible, false);
				assert.equal(o.defaultSeries.defaultPoint.label.visible, false);
				assert.equal(o.xAxis.scale.type, 'time');
				assert.deepEqual(o.yAxis.map(a => a.orientation), ['left', 'right']);
				assert.deepEqual(o.yAxis.map(a => a.defaultTick.label.text), ['%value%', '%value MB']);
			}
			else {
				assert.deepEqual(o.chartArea, {width: 1920, height: 600});
				assert.equal(o.renderAs, 'canvas');
				assert.equal(o.transitions, false);
				assert.equal(o.seriesDefaults.type, 'scatterLine');
				assert.equal(o.seriesDefaults.width, 0.5);
				assert.equal(o.seriesDefaults.markers.visible, false);
				assert.equal(o.seriesDefaults.labels.visible, false);
				assert.equal(o.xAxis.type, 'date');
				assert.ok(+o.xAxis.axisCrossingValue[0] < +data[0][0][0]);
				assert.ok(+o.xAxis.axisCrossingValue[1] > +data[0].at(-1)[0]);
				assert.equal(o.yAxis[0].labels.template({value: 42}), '42%');
				assert.equal(o.yAxis[1].labels.template({value: 7}), '7 MB');
			}
		});
	}

	it('Kendo: resolves on render without scheduling an animation frame', async () => {
		const state = vendor('kendo');
		globalThis.requestAnimationFrame = () => { throw new Error('Unexpected animation frame'); };
		const wait = {textContent: 'Rendering...'};
		const pending = kendo.makeChart(freeze(kendo.prepData(packed)), {}, wait);
		await Promise.resolve();
		assert.equal(wait.textContent, 'Rendering...');
		state.complete();
		assert.equal(await pending, state.chart);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(state.destroyed, 0);
		kendo.destroyChart(state.chart);
		assert.equal(state.destroyed, 1);
		assert.equal(state.emptied, 1);
	});

	it('HTML entry points contain only the shared runner', () => {
		for (const [id, file] of [['syncfusion', 'Syncfusion'], ['devextreme', 'DevExtreme'], ['devextreme-sampled', 'DevExtreme-Sampled'], ['jscharting', 'JSCharting'], ['kendo', 'Kendo']]) {
			const html = readFileSync(new URL(`../../bench/${file}.html`, import.meta.url), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.equal(scripts[0][2].trim(), `import {runDemo} from './demo.mjs';\n\t\t\trunDemo('${id}').catch(console.error);`);
			assert.doesNotMatch(html, /<style\b|<link\b|<canvas\b|fetch\(|https?:|style=/);
		}
	});
});
