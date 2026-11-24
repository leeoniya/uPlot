import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import '../../scripts/instrument.mjs';
import NativeUPlot from '../../src/uPlot.js';
import {createStackedSeriesData, negativeStackData, stackLayers, stackedSeries, stackDomain, stackDimensions, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import {comparisons, mountDemo} from '../../demos/stacked-series-compare.js';
import * as uplot from '../../demos/stacked-series-uplot.js';
import * as chartjs from '../../demos/stacked-series-chartjs.js';
import * as echarts from '../../demos/stacked-series-echarts.js';
import * as apexcharts from '../../demos/stacked-series-apexcharts.js';
import * as highcharts from '../../demos/stacked-series-highcharts.js';
import * as plotly from '../../demos/stacked-series-plotly.js';
import * as d3 from '../../demos/stacked-series-d3.js';
import * as recharts from '../../demos/stacked-series-recharts.js';
import * as agcharts from '../../demos/stacked-series-agcharts.js';
import * as amcharts from '../../demos/stacked-series-amcharts.js';
import * as googlecharts from '../../demos/stacked-series-googlecharts.js';
import * as vega from '../../demos/stacked-series-vega.js';
import * as g2 from '../../demos/stacked-series-g2.js';
import * as billboard from '../../demos/stacked-series-billboard.js';
import * as dygraphs from '../../demos/stacked-series-dygraphs.js';
import * as muicharts from '../../demos/stacked-series-muicharts.js';
import * as nivo from '../../demos/stacked-series-nivo.js';
import * as victory from '../../demos/stacked-series-victory.js';
import * as canvasjs from '../../demos/stacked-series-canvasjs.js';
import * as bokeh from '../../demos/stacked-series-bokeh.js';
import {demoDependencies} from '../../bench/demo-dependencies.mjs';
import {frameworkDependencies} from '../../bench/framework-runtime.mjs';
import stackedGroups from '../../demos/stacked-series.js';

const adapters = {uplot, chartjs, echarts, apexcharts, highcharts, plotly};
const allAdapters = {...adapters, d3, recharts, agcharts, amcharts, googlecharts, vega, g2, billboard, dygraphs, muicharts, nivo, victory, canvasjs, bokeh};
const ids = ['uplot', 'chartjs', 'echarts', 'd3', 'apexcharts', 'highcharts', 'plotly', 'recharts', 'agcharts', 'amcharts', 'googlecharts', 'vega', 'g2', 'billboard', 'dygraphs', 'muicharts', 'nivo', 'victory', 'canvasjs', 'bokeh'];
const labels = stackedSeries.map(series => series.label);
const colors = stackedSeries.map(series => series.stroke);
const fills = stackedSeries.map(series => series.fill);
const demoURL = path => new URL(`../../demos/${path}`, import.meta.url);
const read = path => readFileSync(demoURL(path), 'utf8');
const page = path => new DOMParser().parseFromString(read(path), 'text/html');
const hrefs = root => [...root.querySelectorAll('a')].map(link => link.getAttribute('href'));
const bounds = axis => [axis.min, axis.max];
const signed = (y, dir) => y === 0 ? 0 : dir * y;
const pairs = data => data.slice(1).map(values => data[0].map((x, i) => [x, values[i]]));
const freezeData = data => Object.freeze(data.map(values => Object.freeze(values)));

function rootFor(t, path, selector = '#demo') {
	const source = page(path).querySelector(selector);
	assert.ok(source, `${path}: ${selector}`);
	const root = document.importNode(source, true);
	document.body.appendChild(root);
	t.after(() => root.remove());
	return root;
}

function assertFresh(first, second) {
	assert.deepEqual(first, second);
	function visit(a, b) {
		if (a !== null && typeof a === 'object') {
			assert.notEqual(a, b, 'each call owns its nested objects and arrays');
			for (const key of Object.keys(a)) visit(a[key], b[key]);
		}
	}
	visit(first, second);
}

// Compare only the rendering contract, not complete vendor option snapshots.
const checkOptions = {
	uplot(o) {
		assert.deepEqual(o.stack.groups, [{series: [1, 2, 3, 4], dir: 1}, {series: [5, 6, 7, 8], dir: -1}]);
		assert.notEqual(o.stack.percent, true);
		assert.deepEqual(o.scales, {x: {time: false}, y: {axis: 1, range: {min: {pad: 0}, max: {pad: 0}}}});
		for (const key of ['cursor', 'legend', 'axes', 'select'])
			assert.equal(key in o, false, `${key} uses native defaults`);
		assert.deepEqual(o.series.slice(1).map(s => [s.label, s.stroke, s.fill, s.width, s.points.show]),
			[1, -1].flatMap(dir => stackedSeries.map(s => [dir === 1 ? s.label : `−${s.label}`, s.stroke, s.fill, 3, false])));
		assert.deepEqual([o.width, o.height], [1000, 440]);
	},
	chartjs(o, raw) {
		const series = o.data.datasets;
		assert.equal(series.length, 8);
		series.forEach((s, i) => {
			const j = i % 4, dir = i < 4 ? 1 : -1;
			assert.equal(s.label, dir === 1 ? labels[j] : `−${labels[j]}`);
			assert.deepEqual(s.data, raw[0].map((x, k) => ({x, y: signed(raw[j + 1][k], dir)})));
			assert.deepEqual([s.borderColor, s.backgroundColor, s.borderWidth], [colors[j], fills[j], 3]);
			assert.deepEqual([s.stack, s.fill, s.tension, s.stepped, s.pointRadius], [dir === 1 ? 'positive' : 'negative', j === 0 ? 'origin' : '-1', 0, false, 0]);
		});
		assert.equal(o.type, 'line');
		assert.equal(o.options.scales.y.stacked, true);
		assert.deepEqual([bounds(o.options.scales.x), bounds(o.options.scales.y)], [[0, 20], [-16, 16]]);
		assert.deepEqual([o.options.animation, o.options.plugins.legend.display], [false, true]);
	},
	echarts(o, raw) {
		assert.equal(o.series.length, 8);
		o.series.forEach((s, i) => {
			const j = i % 4, dir = i < 4 ? 1 : -1;
			assert.equal(s.name, dir === 1 ? labels[j] : `−${labels[j]}`);
			assert.deepEqual(s.data, raw[0].map((x, k) => [x, signed(raw[j + 1][k], dir)]));
			assert.deepEqual([s.itemStyle.color, s.lineStyle.color, s.lineStyle.width, s.areaStyle.color, s.areaStyle.opacity], [colors[j], colors[j], 3, colors[j], 0.18]);
			assert.deepEqual([s.type, s.stack, s.stackStrategy, s.smooth, s.step, s.showSymbol], ['line', dir === 1 ? 'positive' : 'negative', 'samesign', false, false, false]);
		});
		assert.deepEqual([bounds(o.xAxis), bounds(o.yAxis)], [[0, 20], [-16, 16]]);
		assert.deepEqual([o.animation, o.legend.show], [false, true]);
	},
	apexcharts(o, raw) {
		assert.deepEqual(o.series.map(s => s.name), labels);
		assert.deepEqual(o.series.map(s => s.data), pairs(raw));
		assert.deepEqual([o.chart.type, o.chart.stacked, o.chart.stackType, o.chart.stackOnlyBar], ['area', true, 'normal', false]);
		assert.deepEqual(o.colors, colors);
		assert.deepEqual([o.stroke.curve, o.stroke.width, o.fill.type, o.fill.opacity], ['straight', 3, 'solid', 0.18]);
		assert.deepEqual([bounds(o.xaxis), bounds(o.yaxis)], [[0, 20], [0, 16]]);
		assert.deepEqual([o.markers.size, o.chart.animations.enabled, o.legend.show], [0, false, true]);
				const negative = freezeData(negativeStackData(raw));
				const lower = apexcharts.chartOptions(negative);
				assert.deepEqual(lower.series.map(s => s.data), pairs(negative));
				assert.deepEqual(lower.series.map(s => s.name), labels.map(label => `−${label}`));
				assert.deepEqual(bounds(lower.yaxis), [-16, 0]);
				assert.equal(lower.legend.show, true);
		assert.equal(o.chart.accessibility.keyboard.enabled, false);
		assert.deepEqual([o.chart.width, o.chart.height], [1000, 440]);
	},
	highcharts(o, raw) {
		assert.equal(o.series.length, 8);
		o.series.forEach((s, i) => {
			const j = i % 4, dir = i < 4 ? 1 : -1;
			assert.deepEqual([s.name, s.stack, s.color], [dir === 1 ? labels[j] : `−${labels[j]}`, dir === 1 ? 'positive' : 'negative', colors[j]]);
			assert.deepEqual(s.data, raw[0].map((x, k) => [x, signed(raw[j + 1][k], dir)]));
		});
		assert.equal(o.chart.type, 'area');
		const area = o.plotOptions.area;
		assert.deepEqual([area.stacking, area.lineWidth, area.fillOpacity, area.step, o.yAxis.reversedStacks], ['normal', 3, 0.18, false, false]);
		assert.deepEqual([bounds(o.xAxis), bounds(o.yAxis)], [[0, 20], [-16, 16]]);
		assert.deepEqual([o.plotOptions.series.marker.enabled, o.chart.animation, o.legend.enabled], [false, false, true]);
		assert.deepEqual([o.chart.width, o.chart.height], [1000, 440]);
	},
	plotly(o, raw) {
		assert.equal(o.data.length, 8);
		o.data.forEach((s, i) => {
			const j = i % 4, dir = i < 4 ? 1 : -1;
			assert.equal(s.name, dir === 1 ? labels[j] : `−${labels[j]}`);
			assert.deepEqual(s.x, raw[0]);
			assert.deepEqual(s.y, raw[j + 1].map(y => signed(y, dir)));
			assert.deepEqual([s.line.color, s.fillcolor, s.line.width], [colors[j], fills[j], 3]);
			assert.deepEqual([s.type, s.mode, s.stackgroup, s.groupnorm, s.fill, s.line.shape, s.line.simplify], ['scatter', 'lines', dir === 1 ? 'positive' : 'negative', '', j === 0 ? 'tozeroy' : 'tonexty', 'linear', false]);
		});
		assert.deepEqual([o.layout.xaxis.range, o.layout.yaxis.range], [[0, 20], [-16, 16]]);
		assert.deepEqual([o.layout.xaxis.fixedrange, o.layout.yaxis.fixedrange, o.config.staticPlot], [true, true, true]);
		assert.deepEqual([o.layout.width, o.layout.height, o.layout.showlegend, o.layout.transition.duration], [1000, 440, true, 0]);
			},
		};

describe('stacked-series comparison data and adapters', () => {
	it('provides deterministic raw values, exact zero runs, and fresh arrays', () => {
		const first = createStackedSeriesData(), second = createStackedSeriesData();
		assertFresh(first, second);
		assert.equal(first.length, 5);
		assert.deepEqual(first[0], Array.from({length: 21}, (_, i) => i));
		assert.deepEqual(first[1], [4, 4, 5, 6, 5, 4, 4, 5, 6, 5, 4, 4, 5, 6, 5, 4, 5, 4, 4, 5, 4]);
		assert.deepEqual(first.slice(1).map(row => row.flatMap((v, i) => v === 0 ? [i] : [])),
			[[], [2, 3, 4, 14, 15, 16], [6, 7, 8, 14, 15, 16], [10, 11, 12, 14, 15, 16, 18]]);
		for (const row of first.slice(2)) {
			assert.equal(row.length, 21);
			assert.ok(row.every(value => value === 0 || value === 3));
		}
		assert.deepEqual(labels, ['A (base)', 'B (middle)', 'C (middle)', 'D (top)']);
		assert.deepEqual(colors, ['#2563b8', '#15803d', '#d65c12', '#a21caf']);
		assert.deepEqual(fills, ['rgba(37, 99, 184, 0.18)', 'rgba(21, 128, 61, 0.18)', 'rgba(214, 92, 18, 0.18)', 'rgba(162, 28, 175, 0.18)']);
		assert.deepEqual([stackDomain, stackDimensions, strokeWidth, fillOpacity], [{x: [0, 20], y: [0, 16]}, {width: 1000, height: 440}, 3, 0.18]);
		first.forEach(row => row.fill(-1));
		assert.deepEqual(createStackedSeriesData(), second);
	});

	it('uses positive zero in both combined stacks and the separate negative panel', () => {
		const raw = createStackedSeriesData();
		const layers = stackLayers(raw).map(layer => layer.values);
		for (const rows of [layers.slice(0, 4), layers.slice(4), negativeStackData(raw).slice(1)]) {
			const zeros = rows.flat().filter(value => value === 0);
			assert.equal(zeros.length, 19);
			assert.ok(zeros.every(value => Object.is(value, 0)));
		}
	});

	it('matches the existing zero-run demo data and its comparison backlink', async t => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'uPlot');
		const children = new Set(document.body.children);
		t.after(() => {
			if (previous) Object.defineProperty(globalThis, 'uPlot', previous);
			else delete globalThis.uPlot;
			for (const child of [...document.body.children])
				if (!children.has(child)) child.remove();
		});
		globalThis.uPlot = class {
			static assign = Object.assign;
			constructor(options, data) { this.options = options; this.data = data; }
		};
		const step = stackedGroups.find(group => group.id === 'zero-strokes').steps.find(step => step.id === 'runs');
		const [first] = await step.render(), [second] = await step.render();
		assert.deepEqual(first.data, createStackedSeriesData());
		assertFresh(first.data, second.data);
		assert.deepEqual(first.options.series.slice(1).map(s => [s.label, s.stroke, s.fill]), stackedSeries.map(s => [s.label, s.stroke, s.fill]));
		assert.ok(document.body.querySelector('a[href="stacked-series-index.html"]'));
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: builds independent options from frozen raw input without pre-stacking`, () => {
			const input = createStackedSeriesData();
			// Distinguish supplied data from a silently substituted default fixture.
			input.slice(1).forEach((row, i) => { row[0] += (i + 1) / 10; });
			const snapshot = structuredClone(input), raw = freezeData(input);
			const first = adapter.chartOptions(raw), second = adapter.chartOptions(raw);
			checkOptions[id](first, raw);
			assertFresh(first, second);
			assert.deepEqual(raw, snapshot);
		});

		it(`${id}: creates and disposes an injected library instance`, async t => {
			const host = rootFor(t, `stacked-series-${id}.html`);
			const raw = freezeData(createStackedSeriesData());
			const calls = [];
			const plot = {
				destroy() { calls.push(['destroy']); },
				dispose() { calls.push(['dispose']); },
				async render() { calls.push(['render']); },
				setOption(options) { calls.push(['setOption', options]); },
			};
			function Library(...args) { calls.push(['create', ...args]); return plot; }
			const libraries = {
				uplot: Library, chartjs: Library, apexcharts: Library,
				highcharts: {chart: Library}, echarts: {init: Library},
				plotly: {
					async newPlot(...args) { calls.push(['create', ...args]); },
					purge(target) { calls.push(['purge', target]); },
				},
			};
			const demo = await adapter.createDemo(host, raw, libraries[id]);
			let disposed = false;
			t.after(() => { if (!disposed) demo.destroy(); });
			assert.equal(demo.plot, id === 'plotly' ? host : plot);
			const args = calls[0].slice(1), expected = adapter.chartOptions(raw);
			let canvas;
			if (id === 'uplot') {
				assert.deepEqual(args[0], expected);
				assertFresh(args[1].slice(0, raw.length), raw);
				assert.deepEqual(args[1].slice(raw.length), raw.slice(1).map(row => row.map(y => signed(y, -1))));
				assert.equal(new Set(args[1]).size, 9, 'positive and mirrored rows are independent');
				assert.equal(args[2], host);
			}
			else if (id === 'chartjs') {
				canvas = host.querySelector('canvas');
				assert.ok(canvas);
				assert.deepEqual([canvas.width, canvas.height], [1000, 440]);
				assert.deepEqual(args, [canvas, expected]);
			}
			else if (id === 'echarts') {
				assert.deepEqual(args, [host, null, {renderer: 'canvas', width: 1000, height: 440}]);
				assert.deepEqual(calls[1], ['setOption', expected]);
			}
			else if (id === 'plotly')
				assert.deepEqual(args, [host, expected.data, expected.layout, expected.config]);
			else
				assert.deepEqual(args, [host, expected]);
			assert.deepEqual(calls.map(call => call[0]), id === 'apexcharts' ? ['create', 'render'] : id === 'echarts' ? ['create', 'setOption'] : ['create']);
			demo.destroy();
			disposed = true;
			assert.deepEqual(calls.at(-1), id === 'plotly' ? ['purge', host] : [id === 'echarts' ? 'dispose' : 'destroy']);
			if (canvas) {
				assert.equal(canvas.isConnected, false);
				assert.equal(host.querySelector('canvas'), null);
			}
			assert.deepEqual(raw, createStackedSeriesData());
		});
	}

	it('uplot: mirrors native stacks and paints strokes toward zero in both directions', async t => {
		const host = rootFor(t, 'stacked-series-uplot.html');
		const raw = freezeData(createStackedSeriesData());
		const demo = uplot.createDemo(host, raw, NativeUPlot);
		t.after(() => demo.destroy());
		await Promise.resolve();
		const {plot} = demo;
		const positive = raw.slice(1).map((row, si) => row.map((_, i) => raw.slice(1, si + 2).reduce((sum, values) => sum + values[i], 0)));
		assert.deepEqual(plot._data.slice(1, 5), positive);
		assert.deepEqual(plot._data.slice(5), positive.map(row => row.map(value => -value)));
		assert.deepEqual(plot.bands.map(({series, dir}) => [series, dir]), [
			[[2, 1], -1], [[3, 2], -1], [[4, 3], -1],
			[[6, 5], 1], [[7, 6], 1], [[8, 7], 1],
		]);

		const strokeOrder = () => plot.ctx.log.flatMap(([op, ...calls]) => op === 'stroke'
			? calls.map(([path]) => plot.series.findIndex(series => series._paths?.stroke === path)).filter(si => si > 0)
			: []);
		plot.ctx.log.length = 0;
		plot.redraw(false);
		await Promise.resolve();
		assert.deepEqual(strokeOrder(), [4, 3, 2, 1, 8, 7, 6, 5]);

		plot.ctx.log.length = 0;
		plot.setSeries(6, {show: false});
		await Promise.resolve();
		assert.deepEqual(strokeOrder(), [4, 3, 2, 1, 8, 7, 5]);
		assert.deepEqual(plot._data.slice(1, 5), positive, 'hiding a negative series does not change the positive stack');
		assert.deepEqual(plot._data[8], positive[3].map((value, i) => -(value - raw[2][i])), 'the negative stack excludes hidden B');
		assert.deepEqual(raw, createStackedSeriesData(), 'native stacking leaves the shared fixture unchanged');
	});

	it('uplot: keeps its native legend, cursor, zoom, reset, and automatic axis ticks', async t => {
		const root = rootFor(t, 'stacked-series-uplot.html');
		const demo = await mountDemo(root, 'uplot', (host, data) => uplot.createDemo(host, data, NativeUPlot));
		assert.ok(demo);
		t.after(() => demo.destroy());
		const {plot} = demo;
		assert.equal(root.querySelector('.legend'), null, 'no custom legend');
		const legend = root.querySelector('.u-legend');
		assert.ok(legend);
		assert.deepEqual([...legend.querySelectorAll('.u-label')].slice(1).map(label => label.textContent),
			[...labels, ...labels.map(label => `−${label}`)]);
		assert.deepEqual([plot.legend.show, plot.legend.live, plot.cursor.show, plot.cursor.x, plot.cursor.y], Array(5).fill(true));
		assert.deepEqual([plot.cursor.drag.x, plot.cursor.drag.y, plot.cursor.drag.setRange], [true, false, true]);
		assert.ok(root.querySelector('.u-cursor-x'));
		assert.ok(root.querySelector('.u-cursor-y'));
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max, plot.scales.y.min, plot.scales.y.max], [0, 20, -15, 15]);
				assert.deepEqual(plot.axes[1]._splits, [-15, -10, -5, 0, 5, 10, 15]);
		const checkAxes = () => {
			for (const axis of plot.axes) {
				assert.ok(axis._splits.length > 2, `${axis.scale} has ticks`);
				assert.ok(axis._values.some(value => value != null && value !== ''), `${axis.scale} has labels`);
			}
			assert.ok(plot.axes[1]._splits.some(value => value < 0));
			assert.ok(plot.axes[1]._splits.includes(0));
			assert.ok(plot.axes[1]._splits.some(value => value > 0));
		};
		checkAxes();
		plot.setCursor({left: plot.valToPos(3, 'x'), top: plot.valToPos(5, 'y')});
		assert.equal(plot.cursor.idx, 3);
		assert.deepEqual(plot.legend.values.slice(1).map(value => Number(value._)), plot.data.slice(1).map(row => row[3]));

		plot.setScale('x', {min: 14, max: 16});
		await Promise.resolve();
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max], [14, 16]);
		assert.deepEqual([plot.scales.y.min, plot.scales.y.max], [-6, 6], 'Y autoscales to the zoomed data');
		checkAxes();
		plot.over.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, button: 0}));
		await Promise.resolve();
		assert.deepEqual([plot.scales.x.min, plot.scales.x.max], [0, 20]);
		assert.deepEqual([plot.scales.y.min, plot.scales.y.max], [-15, 15]);
		checkAxes();

		const label = legend.querySelectorAll('tbody th')[6];
		label.dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}));
		await Promise.resolve();
		assert.equal(plot.series[6].show, false, 'native legend toggles the negative B series');
		label.dispatchEvent(new MouseEvent('click', {bubbles: true, button: 0}));
		await Promise.resolve();
		assert.equal(plot.series[6].show, true);
		plot.setSize({width: 1000, height: 240});
		await Promise.resolve();
		checkAxes();
	});

	// D3 geometry belongs in browser coverage, not a reimplementation of d3.stack in a mock.
	for (const id of ids) {
		it(`${id}: reports the registry's missing-library name without adding chart nodes`, async t => {
			const host = rootFor(t, `stacked-series-${id}.html`);
			const before = host.innerHTML;
			const {name} = comparisons.find(item => item.id === id);
			await assert.rejects(async () => allAdapters[id].createDemo(host, createStackedSeriesData(), null), {message: `${name} did not load`});
			assert.equal(host.innerHTML, before);
		});
	}
});

describe('stacked-series comparison pages', () => {
	const splitIds = ['apexcharts', 'billboard', 'canvasjs', 'dygraphs', 'googlecharts', 'nivo'];

	it('marks exactly the six split comparisons', () => {
		assert.deepEqual(comparisons.filter(item => item.split === true).map(item => item.id).sort(), splitIds);
	});

	for (const id of ids) {
		it(`${id}: mounts the expected stacks, preserves raw zeros and navigation, and has no custom legend`, async t => {
			const root = rootFor(t, `stacked-series-${id}.html`);
			const split = splitIds.includes(id);
			const raw = createStackedSeriesData();
			let previous;
			for (let run = 0; run < 2; run++) {
				const calls = [];
				const first = {plot: {}, destroy: t.mock.fn()};
				const second = {plot: {}, destroy: t.mock.fn()};
				let finish;
				const pending = mountDemo(root, id, (host, data) => {
					calls.push({host, data});
					return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : second;
				});
				await new Promise(resolve => setImmediate(resolve));
				assert.equal(root.dataset.state, 'loading');
				assert.match(root.querySelector('[role="status"]').textContent, /Loading/);
				assert.equal(calls.length, 1, 'only the first mount starts while it is pending');
				const plot = root.querySelector('#plot');
				const positive = calls[0];
				assert.equal(positive.host, split ? plot.querySelector('#plot-positive') : plot);
				assert.equal(positive.host.ownerDocument, root.ownerDocument);
				assert.deepEqual(positive.data, raw);
				if (previous) assertFresh(positive.data, previous);
				previous = positive.data;
				finish(first);
				const demo = await pending;
				assert.equal(calls.length, split ? 2 : 1);
				if (split) {
					const negative = calls[1];
					assert.equal(negative.host, plot.querySelector('#plot-negative'));
					assert.notEqual(negative.host, positive.host);
					const posLabel = positive.host.getAttribute('aria-label'), negLabel = negative.host.getAttribute('aria-label');
					assert.match(posLabel, /positive/i);
					assert.match(negLabel, /negative/i);
					assert.notEqual(posLabel, negLabel);
					assert.deepEqual(negative.data, [raw[0], ...raw.slice(1).map(row => row.map(y => signed(y, -1)))]);
					assert.deepEqual(positive.data, raw);
					positive.data.forEach((row, i) => assert.notEqual(row, negative.data[i]));
					assert.equal(demo.plot, first.plot);
					assert.equal(demo.plots.length, 2);
					assert.equal(demo.plots[0], first.plot);
					assert.equal(demo.plots[1], second.plot);
				}
				else
					assert.equal(demo, first);
				assert.equal(root.dataset.state, 'ready');
				assert.match(root.querySelector('[role="status"]').textContent, /^Ready\./);
				assert.equal(first.destroy.mock.callCount(), 0);
				assert.equal(second.destroy.mock.callCount(), 0);
				demo.destroy();
				assert.equal(first.destroy.mock.callCount(), 1);
				assert.equal(second.destroy.mock.callCount(), split ? 1 : 0);
			}
			const comparison = comparisons.find(item => item.id === id);
			assert.ok(root.querySelector('h1').textContent.includes(`${comparison.name} ${comparison.version}`));
			assert.ok(root.textContent.includes(id === 'uplot' ? 'Y: automatic (no padding)' : split ? 'Y: 0–16 and −16–0' : 'Y: −16–16'));
			if (id === 'uplot') {
				assert.match(root.querySelector('.note').textContent, /negative stack mirrors/);
				assert.match(root.querySelector('#plot').getAttribute('aria-label'), /positive and negative/);
			}
			assert.equal(root.querySelector('.legend, .swatch'), null);
			assert.equal(root.dataset.library, id);
			const rows = [...root.querySelectorAll('details table tr')];
			assert.deepEqual(rows.map(row => row.querySelector('th').textContent), ['X', ...labels]);
			assert.deepEqual(rows.map(row => [...row.querySelectorAll('td')].map(cell => Number(cell.textContent))), raw);
			rows.forEach((row, i) => [...row.querySelectorAll('td')].forEach((cell, j) => {
				assert.equal(cell.textContent, String(raw[i][j]));
				assert.equal(cell.classList.contains('zero'), i > 0 && raw[i][j] === 0);
			}));
			assert.deepEqual(hrefs(root.querySelector('nav')), ['stacked-series-index.html', 'stacked-series.html']);
			assert.deepEqual(hrefs(root.querySelector('.libraries')), ids.map(id => `stacked-series-${id}.html`));
			assert.deepEqual([...root.querySelectorAll('a[aria-current="page"]')].map(link => link.getAttribute('href')), [`stacked-series-${id}.html`]);
		});
	}

	for (const asyncFailure of [false, true]) {
		it(`shows an error for ${asyncFailure ? 'rejected' : 'thrown'} chart creation`, async t => {
			const root = rootFor(t, 'stacked-series-chartjs.html');
			const error = new Error('test library unavailable');
			const log = t.mock.method(console, 'error', () => {});
			const result = await mountDemo(root, 'chartjs', () => {
				if (asyncFailure) return Promise.reject(error);
				throw error;
			});
			assert.equal(result, null);
			assert.equal(root.dataset.state, 'error');
			assert.match(root.querySelector('[role="status"]').textContent, /Cannot render chart: test library unavailable/);
			assert.equal(root.querySelector('.legend, .swatch'), null);
			assert.equal(log.mock.callCount(), 1);
			assert.deepEqual(log.mock.calls[0].arguments, [error]);
		});
	}

	it('destroys the mounted positive chart when the negative mount rejects', async t => {
		const root = rootFor(t, 'stacked-series-apexcharts.html');
		const first = {plot: {}, destroy: t.mock.fn()};
		const error = new Error('negative stack unavailable');
		const log = t.mock.method(console, 'error', () => {});
		const hosts = [];
		const result = await mountDemo(root, 'apexcharts', async host => {
			hosts.push(host.id);
			if (hosts.length === 1) return first;
			throw error;
		});
		assert.deepEqual(hosts, ['plot-positive', 'plot-negative']);
		assert.equal(result, null);
		assert.equal(first.destroy.mock.callCount(), 1);
		assert.equal(root.dataset.state, 'error');
		assert.match(root.querySelector('[role="status"]').textContent, /Cannot render chart: negative stack unavailable/);
		assert.equal(log.mock.callCount(), 1);
		assert.deepEqual(log.mock.calls[0].arguments, [error]);
	});

	it('rejects unknown comparison IDs before changing the page or creating a chart', async t => {
		const root = rootFor(t, 'stacked-series-uplot.html'), before = root.innerHTML;
		await assert.rejects(mountDemo(root, 'unknown', () => assert.fail('must not create a chart')), {message: 'Unknown stacking comparison: unknown'});
		assert.equal(root.innerHTML, before);
		assert.equal(root.dataset.state, undefined);
	});

	it('links the real demo index and comparison index to all comparison pages and back', () => {
		assert.deepEqual(comparisons.map(item => item.id), ids);
		const root = page('index.html');
		for (const href of ['stacked-series-index.html', 'stacked-series.html'])
			assert.ok(hrefs(root).includes(href), `demo index: ${href}`);
		const index = page('stacked-series-index.html');
		assert.deepEqual(hrefs(index.querySelector('ol')), ids.map(id => `stacked-series-${id}.html`));
		assert.deepEqual(hrefs(index.querySelector('nav')), ['index.html', 'stacked-series.html']);
		for (const href of hrefs(index).filter(href => !href.startsWith('https:')))
			assert.ok(existsSync(demoURL(href)), href);
	});

	it('uses benchmark-pinned script URLs and wires each HTML page to its own adapter', () => {
		// These local declarations do not load vendor scripts or framework modules.
		for (const id of ids) {
			const html = page(`stacked-series-${id}.html`);
			const scripts = [...html.querySelectorAll('script[src]')].map(script => script.getAttribute('src'));
			const module = html.querySelector('script[type="module"]').textContent;
			assert.ok(module.includes("from './stacked-series-compare.js'"), id);
			assert.ok(module.includes(`from './stacked-series-${id}.js'`), id);
			assert.match(module, new RegExp(`mountDemo\\(document\\.querySelector\\('#demo'\\), '${id}',`));
			if (id === 'uplot') {
				assert.deepEqual(scripts, []);
				assert.ok(module.includes("from '../dist/uPlot.esm.js'"));
			}
			else if (id === 'recharts') {
				assert.deepEqual(scripts, []);
				const imports = JSON.parse(html.querySelector('script[type="importmap"]').textContent).imports;
				const bindings = ['react', 'react-dom', 'react-dom/client', 'recharts'];
				assert.deepEqual(Object.keys(imports), bindings);
				const pins = frameworkDependencies.recharts;
				const library = pins.find(pin => pin.name === 'recharts');
				const deps = new URL(library.url).searchParams.get('deps');
				const reactVersion = pins.find(pin => pin.name === 'react').version;
				assert.equal(deps, ['react', 'react-dom', 'react-is'].map(name => `${name}@${reactVersion}`).join(','));
				for (const [i, binding] of bindings.entries()) {
					const pin = pins.find(pin => pin.global === ['benchmarkReact', 'benchmarkReactDOM', 'benchmarkReactDOMClient', 'benchmarkRecharts'][i]);
					const actual = new URL(imports[binding]), expected = new URL(pin.url);
					assert.equal(actual.origin, 'https://esm.sh', binding);
					assert.equal(actual.pathname, expected.pathname, binding);
					assert.equal(actual.hash, '', binding);
					assert.deepEqual([...actual.searchParams].sort(), Object.entries({
						...(binding === 'recharts' ? {bundle: ''} : {}),
						target: 'es2022', deps,
						...(binding === 'react' ? {} : {external: 'react,react-dom'}),
					}).sort(), `${binding}: pinned dependencies and shared React bindings`);
				}
				assert.deepEqual([...module.matchAll(/import\('([^']+)'\)/g)].map(match => match[1]), bindings);
				assert.match(module, /createDemo\(host, data, \{React, ReactDOM, ReactDOMClient, Recharts\}\)/);
				assert.equal(comparisons.find(item => item.id === id).version, library.version);
			}
			else if (['muicharts', 'nivo', 'victory'].includes(id)) {
				assert.deepEqual(scripts, []);
				const imports = JSON.parse(html.querySelector('script[type="importmap"]').textContent).imports;
				const reference = JSON.parse(page('stacked-series-recharts.html').querySelector('script[type="importmap"]').textContent).imports;
				for (const binding of ['react', 'react-dom', 'react-dom/client'])
					assert.equal(imports[binding], reference[binding], `${id}: shared pinned React`);
				const [binding, pathname, version] = {
					muicharts: ['@mui/x-charts/LineChart', '/@mui/x-charts@9.16.0/LineChart', '9.16.0'],
					nivo: ['@nivo/line', '/@nivo/line@0.99.0', '0.99.0'],
					victory: ['victory', '/victory@38.1.1', '38.1.1'],
				}[id];
				const url = new URL(imports[binding]);
				assert.equal(url.origin, 'https://esm.sh');
				assert.equal(url.pathname, pathname);
				assert.equal(url.searchParams.get('external'), 'react,react-dom');
				assert.equal(url.searchParams.get('target'), 'es2022');
				assert.ok(url.searchParams.has('bundle'));
				assert.ok(module.includes(`import('${binding}')`));
				assert.equal(comparisons.find(item => item.id === id).version, version);
				if (id === 'muicharts')
					assert.equal(imports[binding], frameworkDependencies.muicharts.find(pin => pin.name === '@mui/x-charts').url + '&external=react,react-dom');
				if (id !== 'victory')
					assert.equal(imports['react/jsx-runtime'], 'https://esm.sh/react@19.3.1/jsx-runtime?target=es2022&deps=react@19.3.1,react-dom@19.3.1,react-is@19.3.1&external=react,react-dom');
			}
			else {
				const dependencies = demoDependencies[id];
				assert.ok(dependencies?.length, `${id}: benchmark dependencies`);
				const pins = id === 'amcharts' ? dependencies : id === 'bokeh' ? dependencies.filter(pin => !pin.path.includes('bokeh-gl')) : dependencies.slice(0, 1);
				assert.deepEqual(scripts, pins.map(pin => pin.url ?? `https://cdn.jsdelivr.net/npm/${pin.name}@${pin.version}/${pin.path}`), id);
				assert.equal(comparisons.find(item => item.id === id).version, pins[0].version);
				if (id === 'amcharts') {
					assert.deepEqual(pins.map(pin => pin.path), ['index.js', 'xy.js']);
					for (const pin of pins) {
						assert.equal(pin.version, pins[0].version);
						assert.equal(pin.url, `https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@${pin.version}/${pin.path}`);
					}
				}
				if (id === 'googlecharts') {
					assert.equal(pins[0].version, '52');
					assert.deepEqual(scripts, ['https://www.gstatic.com/charts/loader.js']);
					assert.match(read('stacked-series-googlecharts.js'), /Library\.charts\.load\('52', \{packages: \['corechart'\]\}\)/);
				}
			}
			const styles = [...html.querySelectorAll('link[href]')].map(link => link.getAttribute('href'));
			const externalStyles = styles.filter(href => href.startsWith('https:'));
			const stylePins = (demoDependencies[id] ?? []).filter(pin => pin.type === 'style' && (pin.name || pin.url));
			assert.deepEqual(externalStyles, stylePins.map(pin => pin.url ?? `https://cdn.jsdelivr.net/npm/${pin.name}@${pin.version}/${pin.path}`), `${id}: pinned styles`);
			for (const href of styles.filter(href => !href.startsWith('https:')))
				assert.ok(existsSync(new URL(href, demoURL(`stacked-series-${id}.html`))));
		}
	});

	it('resolves local imports in the comparison modules and HTML without loading scripts', () => {
		const files = ['lib/stackedSeriesData.js', 'lib/stackedReact.js', 'stacked-series-compare.js', 'stacked-series.js', 'stacked-series.html',
			...ids.flatMap(id => [`stacked-series-${id}.js`, `stacked-series-${id}.html`])];
		for (const file of files) {
			for (const [, specifier] of read(file).matchAll(/\b(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g))
				assert.ok(existsSync(new URL(specifier, demoURL(file))), `${file}: ${specifier}`);
		}
	});
});
