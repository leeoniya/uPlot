import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as apexcharts from '../../bench/apexcharts.mjs';
import * as billboard from '../../bench/billboard.mjs';
import * as anychart from '../../bench/anychart.mjs';
import * as apexSampled from '../../bench/apexcharts-sampled.mjs';
import * as anySampled from '../../bench/anychart-sampled.mjs';
import {runHover, validateHoverPlan} from '../../bench/hover.mjs';

const names = ['CPU', 'RAM', 'TCP Out'], ids = ['cpu', 'ram', 'tcp'];
const rows = Array.from({length: 111}, (_, i) => [1700000000000 + i * 60000, 10 + i / 1000, 20 + i / 1000, 1000 + i]);
const rect = {left: 31, top: 47, width: 600, height: 350};
const xPixel = x => (x - rows[0][0]) / 30000;
const yPixel = (y, s) => 420 - y * (s === 2 ? .1 : 2);
const format = value => value.toLocaleString('en-US', {minimumFractionDigits: 3, maximumFractionDigits: 3});

function element(textContent = '', parentElement = null) {
	return {
		nodeType: 1, connected: true, textContent, parentElement, style: {},
				get isConnected() { return this.connected && (this.parentElement?.isConnected ?? true); },
		getBoundingClientRect: () => ({...rect}),
		ownerDocument: {defaultView: {getComputedStyle: node => ({display: 'block', visibility: 'visible', opacity: '1', ...node.style})}},
	};
}

function apexFixture() {
	const input = [0, 1, 2].map(s => rows.map(row => [row[0], row[s + 1]]));
	const host = element(), tooltip = element(), item = element('', tooltip);
	const label = element('', item), valueNode = element('', item);
	item.querySelector = selector => selector.endsWith('label') ? label : valueNode;
	const g = {
		svgWidth: 1200, svgHeight: 500, translateX: 37, translateY: 19,
		seriesXvalues: input.map(data => data.map(([x]) => xPixel(x))),
		seriesYvalues: input.map((data, s) => data.map(([, y]) => yPixel(y, s))),
		series: input.map(data => data.map(([, y]) => y)), seriesX: input.map(data => data.map(([x]) => x)),
		tooltip: {ttItems: [item], getElTooltip: () => tooltip},
	};
	const chart = {w: {globals: g, dom: {elWrap: host}, interact: {capturedSeriesIndex: -1, capturedDataPointIndex: -1},
		config: {chart: {dataReducer: {enabled: false}}, series: names.map(name => ({name})),
			tooltip: {y: {formatter: (value, {seriesIndex}) => `${value} ${seriesIndex === 2 ? 'MB' : '%'}`}}}}};
	let selected;
	const select = (index, seriesIndex) => {
		selected = {index, seriesIndex};
		Object.assign(chart.w.interact, {capturedSeriesIndex: seriesIndex, capturedDataPointIndex: index});
		label.textContent = `${names[seriesIndex]}:`;
		valueNode.textContent = chart.w.config.tooltip.y.formatter(g.series[seriesIndex][index], {seriesIndex});
		item.textContent = label.textContent + valueNode.textContent;
		tooltip.textContent = item.textContent;
	};
	return {chart, input, host, tooltip, select,
		shared(index, capturedSeriesIndex) {
			select(index, capturedSeriesIndex);
			chart.w.config.tooltip.shared = true;
			g.tooltip.ttItems = names.map((name, s) => {
				const item = element(`${name}: ${g.series[s][index]}`, tooltip);
				const label = element(`${name}:`, item);
				const value = element(chart.w.config.tooltip.y.formatter(g.series[s][index], {seriesIndex: s}), item);
				item.querySelector = selector => selector.endsWith('label') ? label : value;
				return item;
			});
		},
		staleText() { valueNode.textContent += '0'; },
		wrongValue() { g.series[selected.seriesIndex][selected.index]++; },
		wrongX() { g.seriesX[selected.seriesIndex][selected.index]++; },
		clear() { chart.w.interact.capturedDataPointIndex = -1; },
	};
}

function billboardFixture() {
	const input = ['time', ...ids].map((id, s) => [id, ...rows.map(row => row[s])]);
	const host = element(), tooltip = element(), row = element('', tooltip);
	const label = element('', row), valueNode = element('', row);
	let selected = null;
	row.querySelector = selector => selector === '.name' ? label : valueNode;
	tooltip.querySelector = selector => selector === `.bb-tooltip-name-${selected?.data[0]?.id}` ? row : null;
	const chart = {internal: {
		scale: {x: xPixel}, state: {margin: {left: 37, top: 19}, current: {width: 1200, height: 500}},
		$el: {canvas: {node: () => host}, tooltip: {node: () => tooltip, datum: () => selected}},
		getYScaleById: id => value => yPixel(value, ids.indexOf(id)),
		getDefaultValueFormat: () => format, config: {data_names: Object.fromEntries(ids.map((id, s) => [id, names[s]]))},
	}};
	const select = (index, seriesIndex) => {
		const point = {index, id: ids[seriesIndex], x: new Date(rows[index][0]), value: rows[index][seriesIndex + 1]};
		selected = {index, x: point.x, data: [point]};
		label.textContent = names[seriesIndex];
		valueNode.textContent = format(point.value);
		row.textContent = label.textContent + valueNode.textContent;
		tooltip.textContent = row.textContent;
	};
	return {chart, input, host, tooltip, select,
		staleText() { valueNode.textContent += '0'; },
		wrongValue() { selected.data[0].value++; },
		wrongX() { selected.data[0].x = new Date(0); },
		clear() { selected = null; },
		group(index, seriesIndex) {
			select(index, seriesIndex);
			selected.data = ids.map((id, s) => ({index, id, x: new Date(rows[index][0]), value: rows[index][s + 1]}));
			tooltip.querySelector = selector => selector === `.bb-tooltip-name-${ids[seriesIndex]}` ? row : null;
		},
	};
}

function anyFixture() {
	const input = rows, host = element(), tooltip = element(), textNode = element('', tooltip);
	let model = '', selected = null, grouped = false;
	const series = names.map((name, s) => ({
		Uea: false, name: () => name, defaultDecimalDigitsCount: 3,
		yScale: () => ({transform: value => 1 - yPixel(value, s) / 450}),
		getPoint() { throw new Error('Stock getPoint is not hover evidence'); },
		getIterator() { throw new Error('Do not select the requested row on an iterator'); },
		getCurrentPoint: () => selected && selected.seriesIndex === s ? {
			getIndex: () => selected.index, get: () => selected.value, getKey: () => selected.x,
		} : null,
	}));
	tooltip.querySelectorAll = selector => selector === 'text' ? [textNode] : [];
	const stage = {getDomWrapper: () => host, width: () => 1200, height: () => 500};
	const plot = {getPlotBounds: () => ({left: 37, top: 19, width: 1000, height: 450}), getSeriesAt: s => series[s]};
	const chart = {chart: {
		grouping: () => ({enabled: () => grouped}), plot: () => plot, container: () => ({getStage: () => stage}),
		xScale: () => ({transform: x => xPixel(x) / 1000}),
		tooltip: () => ({contentInternal: () => ({text: () => model, container: () => ({domElement: () => tooltip})})}),
	}};
	const select = (index, seriesIndex) => {
		series.forEach(s => { s.Uea = true; });
		selected = {index, seriesIndex, x: rows[index][0], value: rows[index][seriesIndex + 1]};
		model = names.map((name, s) => `${name}: ${format(rows[index][s + 1])}`).join('\n');
		// SVG textContent can concatenate tspan lines without newline characters.
		textNode.textContent = model.replaceAll('\n', '');
	};
	return {chart, input, host, tooltip, select,
		staleText() { textNode.textContent += '0'; },
		wrongValue() { selected.value++; },
		wrongX() { selected.x++; },
		clear() { series.forEach(s => { s.Uea = false; }); },
		sample() { grouped = true; },
		wrongModel() { model += '0'; },
	};
}

const adapters = {apexcharts, billboard, anychart};
const fixtures = {apexcharts: apexFixture, billboard: billboardFixture, anychart: anyFixture};

describe('unsampled ApexCharts, Billboard and AnyStock hover plans', () => {
	let saved;
	before(() => { saved = globalThis.anychart; globalThis.anychart = {format: {number: format}}; });
	after(() => { if (saved === undefined) delete globalThis.anychart; else globalThis.anychart = saved; });

	it('does not export hover plans from sampled wrappers', () => {
		assert.equal(apexSampled.getHoverPlan, undefined);
		assert.equal(anySampled.getHoverPlan, undefined);
	});

	for (const [name, adapter] of Object.entries(adapters)) {
		const fixture = () => {
			const f = fixtures[name]();
			f.plan = adapter.getHoverPlan(f.chart, f.input, f.host);
			return f;
		};
		it(`${name}: projects ten alternating-series targets through native geometry and CSS bounds`, () => {
			const f = fixture();
			validateHoverPlan(f.plan, 1000, 800);
			for (const [i, target] of f.plan.targets.entries()) {
				assert.equal(target.seriesIndex, i % 3);
				assert.ok(Math.abs(target.x - (rect.left + (37 + xPixel(rows[target.index][0])) * .5)) < 1e-9);
				assert.ok(Math.abs(target.y - (rect.top + (19 + yPixel(rows[target.index][target.seriesIndex + 1], target.seriesIndex)) * .7)) < 1e-9);
				assert.ok(!f.plan.verify(target), 'projection alone is not a selection');
				f.select(target.index, target.seriesIndex);
				assert.deepEqual({...f.plan.verify(target), text: undefined}, {
					index: target.index, seriesIndex: target.seriesIndex, value: rows[target.index][target.seriesIndex + 1], text: undefined,
				});
				f.clear();
			}
		});

		it(`${name}: accepts a native neighbor within one CSS pixel, reporting its actual value`, () => {
			const f = fixture(), target = f.plan.targets[1];
			f.select(target.index + 1, target.seriesIndex);
			const evidence = f.plan.verify(target);
			assert.equal(evidence.index, target.index + 1);
			assert.equal(evidence.value, rows[target.index + 1][target.seriesIndex + 1]);
			f.select(target.index + 2, target.seriesIndex);
			assert.ok(!f.plan.verify(target));
		});

		for (const mutation of ['staleText', 'wrongValue', 'wrongX', 'clear']) {
			it(`${name}: rejects ${mutation} despite a populated tooltip`, () => {
				const f = fixture(), target = f.plan.targets[2];
				f.select(target.index, target.seriesIndex);
				f[mutation]();
				assert.ok(!f.plan.verify(target));
			});
		}

		it(`${name}: rejects the wrong native series and hidden or detached tooltip ancestors`, () => {
			const f = fixture(), target = f.plan.targets[0];
			f.select(target.index, 1);
			assert.ok(!f.plan.verify(target));
			f.select(target.index, target.seriesIndex);
			f.tooltip.style.display = 'none';
			assert.ok(!f.plan.verify(target));
			f.tooltip.style.display = 'block';
			f.tooltip.style.opacity = '0';
			assert.ok(!f.plan.verify(target));
			f.tooltip.style.opacity = '1';
			f.tooltip.connected = false;
			assert.ok(!f.plan.verify(target));
		});

		it(`${name}: preparation and measurements do not read diagnostic state`, async () => {
			const f = fixtures[name]();
			const fail = () => { throw new Error('Diagnostic state read outside verify'); };
			if (name === 'apexcharts') Object.defineProperty(f.chart.w, 'interact', {get: fail});
			if (name === 'billboard') f.chart.internal.$el.tooltip.datum = fail;
			if (name === 'anychart') f.chart.chart.tooltip = fail;
			const plan = adapter.getHoverPlan(f.chart, f.input, f.host);
			plan.verify = fail;
			const result = await runHover(plan.targets, {moveBatch: async targets => assert.equal(targets, plan.targets)});
			assert.equal(result.count, 10);
		});
	}

	it('ApexCharts verifies all three native shared-x values even when another line is nearest', () => {
		const f = apexFixture(), plan = apexcharts.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
		f.shared(target.index, 2);
		assert.equal(plan.verify(target).value, rows[target.index][1]);
		assert.equal(plan.verify(target).seriesIndex, 0);
		for (const s of [1, 2]) {
			f.shared(target.index, 2);
			f.chart.w.globals.tooltip.ttItems[s].querySelector('value').textContent = 'stale';
			assert.ok(!plan.verify(target));
		}
	});

	it('Billboard verifies a requested member of the native grouped tooltip', () => {
		const f = billboardFixture(), plan = billboard.getHoverPlan(f.chart, f.input, f.host);
		for (const target of plan.targets) {
			f.group(target.index, target.seriesIndex);
			assert.equal(plan.verify(target).seriesIndex, target.seriesIndex);
		}
	});

	it('AnyStock rejects a stale union text model even when the SVG is still visible', () => {
		const f = anyFixture(), plan = anychart.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
		f.select(target.index, target.seriesIndex);
		f.wrongModel();
		assert.ok(!plan.verify(target));
	});

	it('rejects sampling even if the unsampled export is called directly', () => {
		const apex = apexFixture();
		apex.chart.w.config.chart.dataReducer.enabled = true;
		assert.throws(() => apexcharts.getHoverPlan(apex.chart, apex.input, apex.host), /unsampled/);
		const stock = anyFixture();
		stock.sample();
		assert.throws(() => anychart.getHoverPlan(stock.chart, stock.input, stock.host), /unsampled/);
	});
});
