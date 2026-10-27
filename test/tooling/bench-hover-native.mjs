import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as chartjs from '../../bench/chartjs.mjs';
import * as echarts from '../../bench/echarts.mjs';
import * as dygraphs from '../../bench/dygraphs.mjs';
import * as highcharts from '../../bench/highcharts.mjs';
import * as highchartsSvg from '../../bench/highcharts-svg.mjs';
import * as plotly from '../../bench/plotly.mjs';
import * as plotlySvg from '../../bench/plotly-svg.mjs';
import * as lightweight from '../../bench/lightweight.mjs';

const length = 11001;
const names = ['CPU', 'RAM', 'TCP Out'];
const epoch = 1700000000000;
const xs = Array.from({length}, (_, i) => epoch + i * 60000);
const ys = [0, 1, 2].map(s => xs.map((_, i) => s === 2 ? 1000 + i : (s + 1) * 10 + i / 1000));
const xPixel = x => 50 + (x - epoch) / 600000;
const yPixel = (y, s) => 320 - y / (s === 2 ? 100 : 1);
const rect = {left: 37, top: 59, width: 1200, height: 400};
const number = value => value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const style = element => ({display: 'block', visibility: 'visible', opacity: '1', ...element.style});

// A layout-aware DOM double: hidden/detached/zero-size nodes are not evidence.
function element(text = '') {
	const node = {
		nodeType: 1, textContent: text, style: {}, isConnected: true, children: [], parentElement: null,
		clientWidth: 1200, clientHeight: 400,
		getBoundingClientRect: () => ({...rect}),
		getClientRects() { return [this.getBoundingClientRect()]; },
		ownerDocument: {defaultView: {getComputedStyle: style}, createElement: () => element()},
		append(child) { this.children.push(child); child.parentElement = this; },
		setAttribute() {}, remove() { this.isConnected = false; },
	};
	return node;
}

function chartjsFixture() {
	const input = ys.map(values => values.map((y, i) => ({x: xs[i], y})));
	const host = element();
	const chart = {
		canvas: host, width: 1200, height: 400,
		scales: {
			x: {getPixelForValue: xPixel},
			y: {getPixelForValue: y => yPixel(y, 0), getLabelForValue: String},
			y2: {getPixelForValue: y => yPixel(y, 2), getLabelForValue: String},
		},
		data: {datasets: input.map((data, i) => ({data, label: names[i]}))},
		tooltip: {options: {enabled: true}, opacity: 0, width: 150, height: 80, getActiveElements() { return this.active ?? []; }},
	};
	const select = (target, index = target.index, seriesIndex = target.seriesIndex) => {
		const raw = chart.data.datasets[seriesIndex].data[index];
		Object.assign(chart.tooltip, {
			opacity: 1,
			active: [{datasetIndex: seriesIndex, index}],
			dataPoints: [{datasetIndex: seriesIndex, dataIndex: index, raw, parsed: {...raw}, formattedValue: String(raw.y)}],
			body: [{lines: [`${names[seriesIndex]}: ${raw.y}`]}],
		});
	};
	return {input, host, chart, select, value: (i, s) => input[s][i].y,
		staleText() { chart.tooltip.body[0].lines = ['CPU: 999999']; },
		hide() { chart.tooltip.opacity = 0; },
		clear() { chart.tooltip.active = []; },
	};
}


function dygraphsFixture() {
	const input = xs.map((x, i) => [x, ...ys.map(y => y[i])]);
	const host = element(), tooltip = element();
	host.querySelector = selector => selector === '.dygraph-legend' ? tooltip : null;
	const chart = {toDomXCoord: xPixel, toDomYCoord: (y, axis) => yPixel(y, axis === 1 ? 2 : 0), getSelection() { return this.selected ?? -1; }};
	const select = (target, index = target.index, seriesIndex = target.seriesIndex) => {
		chart.selected = index;
		chart.selPoints_ = [{name: names[seriesIndex], idx: index, xval: xs[index], yval: ys[seriesIndex][index]}];
		tooltip.textContent = 'date: ' + names.map((name, s) => `${name}:\u00a0${s === 2 ? ys[s][index] + ' MB' : Math.round(ys[s][index] * 100) / 100 + '%'}`).join(' ');
	};
	return {input, host, chart, select, tooltip, value: (i, s) => input[i][s + 1],
		staleText() { tooltip.textContent = 'CPU: 999999% RAM: 999999% TCP Out: 999999 MB'; },
		hide() { tooltip.style.display = 'none'; },
		clear() { chart.selected = -1; },
	};
}

function highchartsFixture() {
	const input = ys.map(y => ({columns: {x: xs, y}}));
	const host = element(), tooltip = element();
	const chart = {
		container: host, chartWidth: 1200, chartHeight: 400,
		options: {boost: {enabled: false}},
		xAxis: [{toPixels: xPixel}],
		series: names.map((name, s) => ({name, yAxis: {toPixels: y => yPixel(y, s)}})),
		numberFormatter: number,
		tooltip: {isHidden: true, label: {element: tooltip}},
	};
	const select = (target, index = target.index, seriesIndex = target.seriesIndex) => {
		chart.tooltip.isHidden = false;
		chart.hoverPoints = [{series: chart.series[seriesIndex], index, x: xs[index], y: ys[seriesIndex][index]}];
		tooltip.textContent = 'date' + names.map((name, s) => `● ${name}: ${number(ys[s][index])} ${s === 2 ? 'MB' : '%'}`).join('');
	};
	return {input, host, chart, select, tooltip, value: (i, s) => input[s].columns.y[i],
		staleText() { tooltip.textContent = 'CPU: 999999.00 % RAM: 999999.00 % TCP Out: 999999.00 MB'; },
		hide() { chart.tooltip.isHidden = true; },
		clear() { chart.hoverPoints = []; },
	};
}

function plotlyFixture() {
	const input = [xs, ...ys];
	const host = element(), tooltip = element(), nums = element(), name = element();
	tooltip.querySelector = selector => selector === '.nums' ? nums : name;
	const chart = Object.assign(host, {
		_fullLayout: {
			width: 1200, height: 400,
			xaxis: {_offset: 50, d2p: x => xPixel(x) - 50, d2c: x => x - 5 * 3600000},
			yaxis: {_offset: 0, d2p: y => yPixel(y, 0)},
			yaxis2: {_offset: 0, d2p: y => yPixel(y, 2)},
		},
		querySelectorAll: () => [tooltip],
	});
	const select = (target, index = target.index, seriesIndex = target.seriesIndex) => {
		const point = {curveNumber: seriesIndex, pointNumber: index, x: xs[index], y: ys[seriesIndex][index]};
		chart._hoverdata = [point];
		const yLabel = seriesIndex === 2 ? `${ys[seriesIndex][index] / 1000}k MB` : `${ys[seriesIndex][index]}%`;
		tooltip.__data__ = {eventData: [point], xLabelVal: chart._fullLayout.xaxis.d2c(xs[index]), yLabelVal: point.y, xLabel: 'date', yLabel};
		nums.textContent = yLabel;
		name.textContent = names[seriesIndex];
		tooltip.textContent = `${name.textContent}${nums.textContent}`;
	};
	return {input, host, chart, select, tooltip, nums, value: (i, s) => input[s + 1][i],
		staleText() { nums.textContent = '(date, 999999)'; },
		hide() { tooltip.style.visibility = 'hidden'; },
		clear() { chart._hoverdata = []; },
	};
}

function lightweightFixture() {
	const input = ys.map(values => values.map((value, i) => ({time: xs[i] / 1000, value})));
	const host = element(), lines = [];
	let crosshair;
	const timeScale = {fitContent() {}, timeToCoordinate: time => xPixel(time * 1000) - 50};
	const chart = {
		addSeries(type, options) {
			const s = lines.length;
			const line = {setData(data) { this.data = data; }, priceToCoordinate: value => yPixel(value, s), options: () => options};
			lines.push(line);
			return line;
		},
		timeScale: () => timeScale, priceScale: () => ({width: () => 50}),
		subscribeCrosshairMove(fn) { crosshair = fn; }, unsubscribeCrosshairMove(fn) { assert.equal(fn, crosshair); crosshair = null; },
		remove() {},
	};
	globalThis.LightweightCharts = {createChart: () => chart, LineSeries: {}, LastPriceAnimationMode: {Disabled: 0}};
	assert.equal(lightweight.makeChart(input, host), chart);
	const buttons = host.children[0].children.slice(0, 3);
	const select = (target, index = target.index, seriesIndex = target.seriesIndex) => {
		crosshair({time: input[0][index].time, point: {x: xPixel(xs[index]), y: yPixel(ys[seriesIndex][index], seriesIndex)}, seriesData: new Map([[lines[seriesIndex], input[seriesIndex][index]]])});
	};
	return {input, host, chart, select, buttons, crosshair: param => crosshair(param), value: (i, s) => input[s][i].value,
		staleText() { buttons.forEach(button => { button.textContent = 'CPU: 999999 %'; }); },
		hide() { buttons.forEach(button => { button.style.opacity = '0'; }); },
		clear() { crosshair({time: null}); },
	};
}

const adapters = {chartjs, dygraphs, 'highcharts-svg': highchartsSvg, plotly, lightweight};
const fixtures = {chartjs: chartjsFixture, dygraphs: dygraphsFixture, 'highcharts-svg': highchartsFixture, plotly: plotlyFixture, lightweight: lightweightFixture};

describe('native benchmark hover plans', () => {
	const globals = ['getComputedStyle', 'Highcharts', 'LightweightCharts', 'requestAnimationFrame', 'devicePixelRatio'];
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		globalThis.getComputedStyle = style;
		globalThis.requestAnimationFrame = fn => fn();
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 3});
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
		else delete globalThis[key];
	}));

	it('SVG wrappers share their native plans', () => {
		assert.equal(highchartsSvg.getHoverPlan, highcharts.getHoverPlan);
		assert.equal(plotlySvg.getHoverPlan, plotly.getHoverPlan);
	});

	it('ECharts does not export a hover plan or import hover helpers', () => {
		assert.equal(echarts.getHoverPlan, undefined);
		const source = readFileSync(new URL('../../bench/echarts.mjs', import.meta.url), 'utf8');
		assert.doesNotMatch(source, /hover\.mjs|getHoverPlan/);
	});

	it('Highcharts: rejects Boost-capable charts even before the series reach the boost threshold', () => {
		const f = highchartsFixture();
		for (const options of [{}, {boost: {}}, {boost: {enabled: true}}]) {
			f.chart.options = options;
			assert.throws(() => highcharts.getHoverPlan(f.chart, f.input, f.host), /SVG rendering with Boost disabled/);
		}
		f.chart.options = {boost: {enabled: false}};
		f.chart.series[0].boosted = true;
		assert.throws(() => highchartsSvg.getHoverPlan(f.chart, f.input, f.host), /SVG rendering with Boost disabled/);
	});

	it('Highcharts: scopes native hover options to explicitly disabled Boost', async () => {
		globalThis.Highcharts = {chart(host, options) {
			const chart = {options, series: []};
			options.chart.events.load.call(chart);
			return chart;
		}};
		const input = Array.from({length: 3}, () => ({columns: {x: [], y: []}}));
		for (const chart of [
			await highcharts.makeChart(input, element()),
			await highcharts.makeChartWithOptions(input, element(), null, null, {boost: {enabled: true}}),
			await highchartsSvg.makeChart(input, element()),
			await highchartsSvg.makeEmptyChart(element()),
		]) {
			const svg = chart.options.boost.enabled === false;
			const {series, line} = chart.options.plotOptions;
			assert.equal(Object.hasOwn(series, 'kdNow'), svg);
			assert.equal(series.kdNow, svg ? true : undefined);
			assert.equal(line.marker.enabled, false);
			assert.deepEqual(line.marker.states, svg ? {hover: {enabled: false}} : undefined);
		}
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		const fixture = () => {
			const f = fixtures[id]();
			f.plan = adapter.getHoverPlan(f.chart, f.input, f.host);
			return f;
		};

		it(`${id}: synchronously projects ten original rows in CSS viewport coordinates`, () => {
			const f = fixture();
			assert.equal(f.plan.then, undefined);
			assert.equal(f.plan.targets.length, 10);
			f.plan.targets.forEach((target, i) => {
				const index = Math.round((i + 1) * (length - 1) / 11), s = i % 3;
				assert.equal(target.index, index);
				assert.equal(target.seriesIndex, s);
				assert.equal(target.x, rect.left + xPixel(xs[index]));
				assert.equal(target.y, rect.top + yPixel(ys[s][index], s));
				assert.equal(f.plan.verify(target), null);
			});
		});

		it(`${id}: requires live selection and rendered DATA values for all ten targets`, () => {
			const f = fixture();
			for (const target of f.plan.targets) {
				assert.equal(f.plan.verify(target), null, 'previous selection is not readiness');
				f.select(target);
				const evidence = f.plan.verify(target);
				assert.ok(evidence);
				assert.deepEqual(Object.keys(evidence).sort(), ['index', 'seriesIndex', 'text', 'value']);
				assert.equal(evidence.index, target.index);
				assert.equal(evidence.seriesIndex, target.seriesIndex);
				assert.equal(evidence.value, f.value(target.index, target.seriesIndex));
				assert.ok(evidence.text.length > 0);
			}
		});

		it(`${id}: returns the actual row within one CSS pixel, not the desired row`, () => {
			const f = fixture(), target = f.plan.targets[0];
			f.select(target, target.index + 10);
			assert.equal(f.plan.verify(target)?.index, target.index + 10);
			f.select(target, target.index + 11);
			assert.equal(f.plan.verify(target), null);
			f.select(target, target.index - 10);
			assert.equal(f.plan.verify(target)?.index, target.index - 10);
		});

		it(`${id}: does not accept stale text, hidden content, wrong series, or empty native state`, () => {
			const f = fixture(), target = f.plan.targets[0];
			f.select(target);
			f.staleText();
			assert.equal(f.plan.verify(target), null);
			f.select(target, target.index, 1);
			assert.equal(f.plan.verify(target), null);
			f.select(target);
			f.clear();
			assert.equal(f.plan.verify(target), null);
			f.select(target);
			f.hide();
			assert.equal(f.plan.verify(target), null);
		});

		it(`${id}: accounts for CSS scaling independently of devicePixelRatio`, () => {
			const f = fixtures[id]();
			f.host.getBoundingClientRect = () => ({...rect, width: 600, height: 200});
			const plan = adapter.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
			assert.equal(target.x, rect.left + xPixel(xs[target.index]) / 2);
			assert.equal(target.y, rect.top + yPixel(ys[0][target.index], 0) / 2);
			f.select(target, target.index + 20);
			assert.equal(plan.verify(target)?.index, target.index + 20);
			f.select(target, target.index + 21);
			assert.equal(plan.verify(target), null);
		});

		it(`${id}: does not synthesize input or invoke native hover setters`, () => {
			const source = readFileSync(new URL(`../../bench/${id === 'highcharts-svg' ? 'highcharts' : id}.mjs`, import.meta.url), 'utf8');
			assert.doesNotMatch(source, /\b(?:dispatchEvent|dispatchAction|setActiveElements|setSelection|setCrosshairPosition|showTooltip|manuallyShowTip)\s*\(/);
		});
	}

	it('Chart.js: maps cloned min/max extrema to original rows, not decimated indices', () => {
		const f = chartjsFixture();
		const originalIndex = 1002;
		// Both rows have the same minimum. The decimator keeps the first one,
		// even when its synthetic average x is closer to the later occurrence.
		for (let i = 1000; i <= 1008; i++) f.input[0][i].y = 20;
		f.input[0][originalIndex].y = f.input[0][1004].y = 5;
		const clone = {x: xs[1005], y: f.input[0][originalIndex].y};
		f.chart.data.datasets[0].data = [f.input[0][0], clone, f.input[0].at(-1)];
		const plan = chartjs.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
		assert.equal(target.index, 1000);
		assert.equal(target.x, rect.left + xPixel(clone.x));
		f.select(target, 1);
		assert.equal(plan.verify(target)?.index, originalIndex);
		f.chart.tooltip.body = [];
		assert.equal(plan.verify(target), null);
	});

	it('Chart.js: rejects a hidden canvas and mismatched active value even with a populated tooltip', () => {
		const f = chartjsFixture(), plan = chartjs.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
		f.select(target);
		f.chart.tooltip.dataPoints[0].parsed.y++;
		assert.equal(plan.verify(target), null);
		f.select(target);
		f.host.isConnected = false;
		assert.equal(plan.verify(target), null);
		f.host.isConnected = true;
		f.host.style.display = 'none';
		assert.equal(plan.verify(target), null);
	});


	it('Plotly: requires the rendered label model to match the active index and value', () => {
		const f = plotlyFixture(), plan = plotly.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[2];
		f.select(target);
		assert.ok(plan.verify(target), 'native date-axis values are not raw epoch timestamps');
		f.tooltip.__data__.xLabelVal = f.input[0][target.index];
		assert.equal(plan.verify(target), null);
		f.select(target);
		f.tooltip.__data__.yLabelVal++;
		assert.equal(plan.verify(target), null);
		f.select(target);
		f.tooltip.__data__.eventData = [{curveNumber: 2, pointNumber: target.index - 1}];
		assert.equal(plan.verify(target), null);
	});

	it('Lightweight: invalidates the live legend on update/leave and retains cleanup', async () => {
		const f = lightweightFixture(), plan = lightweight.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
		f.select(target);
		assert.ok(plan.verify(target));
		await lightweight.updateChart(f.chart, f.input);
		assert.equal(plan.verify(target), null);
		f.select(target);
		f.clear();
		assert.equal(plan.verify(target), null);
		lightweight.destroyChart(f.chart);
		assert.equal(f.host.children[0].isConnected, false);
	});
});
