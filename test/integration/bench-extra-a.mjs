import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as apex from '../../bench/apexcharts.mjs';
import * as highcharts from '../../bench/highcharts.mjs';
import * as highchartsSvg from '../../bench/highcharts-svg.mjs';
import * as lightweight from '../../bench/lightweight.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const host = {};

function autoAxes(axes) {
	for (const axis of axes) {
		assert.equal(Object.hasOwn(axis, 'min'), false);
		assert.equal(Object.hasOwn(axis, 'max'), false);
	}
}

describe('extra benchmark adapters A', () => {
	const originals = new Map();
	beforeEach(() => {
		for (const name of ['ApexCharts', 'Highcharts', 'LightweightCharts'])
			originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	});
	afterEach(() => {
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete globalThis[name];
		}
	});

	it('prepares all 55,550 rows without changing the packed input', () => {
		const a = apex.prepData(packed);
		const h = highcharts.prepData(packed);
		const l = lightweight.prepData(packed);
		assert.equal(a.length, 3);
		assert.equal(h.length, 3);
		assert.equal(l.length, 3);
		for (let s = 0; s < 3; s++) {
			assert.equal(a[s].length, 55550);
			assert.equal(h[s].columns.x.length, 55550);
			assert.equal(h[s].columns.y.length, 55550);
			assert.equal(l[s].length, 55550);
			assert.ok(h[s].columns.x instanceof Float64Array);
			assert.ok(h[s].columns.y instanceof Float64Array);
			for (let j = 0; j < 55550; j++) {
				const i = packed[0] + 1 + j * packed[0];
				const y = s === 0 ? Math.round((100 - packed[i + 1]) * 1000) / 1000 :
					s === 1 ? Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100 : packed[i + 3];
				assert.deepEqual(a[s][j], [packed[i] * 60000, y]);
				assert.equal(h[s].columns.x[j], a[s][j][0]);
				assert.equal(h[s].columns.y[j], y);
				assert.deepEqual(l[s][j], {time: packed[i] * 60, value: y});
			}
		}
		assert.equal(h[0].columns.x, h[1].columns.x);
		assert.notEqual(apex.prepData(packed)[0], a[0]);
		assert.notEqual(highcharts.prepData(packed)[0].columns.x, h[0].columns.x);
		assert.notEqual(lightweight.prepData(packed)[0][0], l[0][0]);
	});

	it('ApexCharts awaits render, uses one percentage axis, and destroys the instance', async () => {
		let finish, instance, options, destroyed = 0;
		globalThis.ApexCharts = class {
			constructor(element, config) {
				assert.equal(element, host);
				options = config;
				instance = this;
			}
			render() { return new Promise(resolve => { finish = resolve; }); }
			destroy() { destroyed++; }
		};
		const wait = {textContent: 'Rendering...'};
		const data = apex.prepData(packed);
				const result = apex.makeChart(data, host, wait);
		assert.equal(wait.textContent, 'Rendering...');
		assert.deepEqual(options.yaxis[0].seriesName, ['CPU', 'RAM']);
		assert.equal(options.yaxis[1].seriesName, 'TCP Out');
		assert.equal(options.yaxis[1].opposite, true);
		autoAxes(options.yaxis);
		assert.equal(options.chart.renderer, 'canvas');
		assert.deepEqual(options.chart.dataReducer, {enabled: false});
				assert.ok(options.series.every((series, i) => series.data === data[i] && series.data.length === 55550));
		assert.equal(options.chart.animations.enabled, false);
				assert.equal(options.chart.parentHeightOffset, 0);
		finish({notTheChart: true});
		assert.equal(await result, instance);
		assert.equal(wait.textContent, 'Done!');
		apex.destroyChart(instance);
		assert.equal(destroyed, 1);
	});

	it('ApexCharts cleans up a rejected render and preserves the rejection', async () => {
		const failure = new Error('render failed');
		let destroyed = false;
		globalThis.ApexCharts = class {
			render() { return Promise.reject(failure); }
			destroy() { destroyed = true; }
		};
		const wait = {textContent: 'Rendering...'};
		await assert.rejects(apex.makeChart([[], [], []], host, wait), error => error === failure);
		assert.equal(destroyed, true);
		assert.equal(wait.textContent, 'Rendering...');
	});

	for (const loadFirst of [false, true]) {
		it(`Highcharts awaits load and every boosted series (loadFirst=${loadFirst})`, async () => {
			let options, destroyed = false;
			const chart = {series: [{boosted: true}, {boosted: true}, {boosted: true}], destroy() { destroyed = true; }};
			globalThis.Highcharts = {chart(element, config) {
				assert.equal(element, host);
				options = config;
				return chart;
			}};
			const wait = {textContent: 'Rendering...'};
			const result = highcharts.makeChart([{}, {}, {}], host, wait);
			const load = () => options.chart.events.load.call(chart);
			const rendered = series => options.plotOptions.series.events.renderedCanvas.call(series);
			assert.equal(options.boost.useGPUTranslations, false);
			assert.deepEqual(options.series.map(s => s.yAxis), [0, 0, 1]);
			autoAxes(options.yAxis);
			if (loadFirst) load();
			rendered(chart.series[0]);
			rendered(chart.series[0]);
			rendered(chart.series[1]);
			await Promise.resolve();
			assert.equal(wait.textContent, 'Rendering...');
			rendered(chart.series[2]);
			if (!loadFirst) {
				assert.equal(wait.textContent, 'Rendering...');
				load();
			}
			assert.equal(await result, chart);
			assert.equal(wait.textContent, 'Done!');
			highcharts.destroyChart(chart);
			assert.equal(destroyed, true);
		});
	}

	for (const [name, source] of [['GL', highcharts], ['SVG', highchartsSvg]]) {
		it(`Highcharts ${name} handles a synchronous non-boosted load and cleans up`, async () => {
			let destroyed = false;
			const chart = {series: [{boosted: false}, {boosted: false}, {}], destroy() { destroyed = true; }};
			globalThis.Highcharts = {chart(element, options) {
				assert.equal(element, host);
				assert.equal(options.boost.enabled, name === 'SVG' ? false : undefined);
				options.chart.events.load.call(chart);
				return chart;
			}};
			const wait = {textContent: 'Rendering...'};
			assert.equal(await source.makeChart([{}, {}, {}], host, wait, {boost: {enabled: true}}), chart);
			assert.equal(wait.textContent, 'Done!');
			source.destroyChart(chart);
			assert.equal(destroyed, true);
		});

		it(`Highcharts ${name} preserves construction failures without reporting readiness`, async () => {
			const failure = new Error('chart failed');
			globalThis.Highcharts = {chart() { throw failure; }};
			const wait = {textContent: 'Rendering...'};
			await assert.rejects(source.makeChart([{}, {}, {}], host, wait), error => error === failure);
			assert.equal(wait.textContent, 'Rendering...');
		});
	}

	it('Highcharts SVG shares prep and cleanup, disables only boost, and awaits load', async () => {
		assert.equal(highchartsSvg.prepData, highcharts.prepData);
		assert.equal(highchartsSvg.destroyChart, highcharts.destroyChart);
		const data = highcharts.prepData(packed);
		const calls = [];
		let destroyed = 0;
		const chart = {series: [{}, {}, {}], destroy() { destroyed++; }};
		globalThis.Highcharts = {chart(element, options) {
			assert.equal(element, host);
			calls.push(options);
			for (const [i, series] of options.series.entries()) {
				assert.equal(series.dataTable, data[i]);
				assert.equal(series.dataTable.columns.x, data[0].columns.x);
				assert.ok(series.dataTable.columns.x instanceof Float64Array);
				assert.ok(series.dataTable.columns.y instanceof Float64Array);
			}
			assert.deepEqual(options.series.map(series => series.yAxis), [0, 0, 1]);
			autoAxes(options.yAxis);
			return chart;
		}};
		for (const source of [highcharts, highchartsSvg]) {
			const wait = {textContent: 'Rendering...'};
			let ready = false;
			const pending = source.makeChart(data, host, wait).then(result => { ready = true; return result; });
			await Promise.resolve();
			assert.equal(ready, false);
			assert.equal(wait.textContent, 'Rendering...');
			calls.at(-1).chart.events.load.call(chart);
			assert.equal(await pending, chart);
			assert.equal(wait.textContent, 'Done!');
			source.destroyChart(chart);
		}
		assert.equal(destroyed, 2);
		assert.equal(calls[0].boost.enabled, undefined);
		assert.equal(calls[1].boost.enabled, false);
		// Event callbacks have separate closures; compare the remaining configuration.
		const config = options => ({
			...options,
			chart: {...options.chart, events: null},
			plotOptions: {...options.plotOptions, series: {...options.plotOptions.series, events: null}},
		});
		assert.deepEqual(config(calls[1]), {
			...config(calls[0]), boost: {...calls[0].boost, enabled: false},
		});
	});

	it('Lightweight stays synchronous, preserves attribution, and cleans up its legend', () => {
		const nodes = [];
		const element = () => ({style: {}, children: [], attrs: {}, append(child) { this.children.push(child); },
			setAttribute(key, value) { this.attrs[key] = value; }, remove() { this.removed = true; }});
		const localHost = {style: {position: 'static'}, ownerDocument: {createElement: element}, append: node => nodes.push(node)};
		const lines = [];
		let config, crosshair, removed = false, fitted = false;
		const chart = {
			addSeries(type, options) {
				assert.equal(type, 'LineSeries');
				const line = {config: options, options: () => ({visible: true}), applyOptions(o) { this.applied = o; }, setData(data) { this.data = data; }};
				lines.push(line);
				return line;
			},
			subscribeCrosshairMove(handler) { crosshair = handler; },
			unsubscribeCrosshairMove(handler) { assert.equal(handler, crosshair); crosshair = null; },
			timeScale: () => ({fitContent() { fitted = true; }}),
			remove() { removed = true; },
		};
		globalThis.LightweightCharts = {LineSeries: 'LineSeries', LastPriceAnimationMode: {Disabled: 0}, createChart(element, options) {
			assert.equal(element, localHost);
			config = options;
			return chart;
		}};
		const data = [[{time: 60, value: 25}], [{time: 60, value: 50}], [{time: 60, value: 3}]];
		assert.equal(lightweight.makeChart(data, localHost), chart);
		assert.equal(config.layout.attributionLogo, true);
		assert.equal(config.leftPriceScale.autoScale, true);
		assert.equal(config.rightPriceScale.autoScale, true);
		assert.deepEqual(lines.map(s => s.config.priceScaleId), ['left', 'left', 'right']);
		assert.equal(lines[0].data, data[0]);
		assert.equal(fitted, true);
		const legend = nodes[0];
		assert.equal(legend.children[0].textContent, 'CPU: 25 %');
		legend.children[0].onclick();
		assert.deepEqual(lines[0].applied, {visible: false});
		assert.equal(legend.children[0].attrs['aria-pressed'], 'false');
		crosshair({time: 60, seriesData: new Map([[lines[2], {value: 6}]])});
		assert.equal(legend.children[2].textContent, 'TCP Out: 6 MB');
		lightweight.destroyChart(chart);
		assert.equal(removed, true);
		assert.equal(crosshair, null);
		assert.equal(legend.removed, true);
		assert.equal(localHost.style.position, 'static');
	});
});
