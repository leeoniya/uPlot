import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as bokeh from '../../bench/bokeh.mjs';
import * as bokehCanvas from '../../bench/bokeh-canvas.mjs';
import * as canvasjs from '../../bench/canvasjs.mjs';
import {verifyHover} from '../../bench/hover.mjs';

const names = ['CPU', 'RAM', 'TCP Out'], fields = ['cpu', 'ram', 'tcp'];
const epoch = 1700000000000;
const rect = {left: 37, top: 59, width: 1200, height: 400};
const yPixel = (y, s) => 320 - y / (s === 2 ? 100 : 1);
const style = node => ({display: 'block', visibility: 'visible', opacity: '1', ...node.style});

// Layout-aware doubles retain shadow boundaries instead of flattening the DOM.
function element(text = '') {
	return {
		nodeType: 1, _text: text, _connected: true, style: {}, children: [], parentElement: null,
		ownerDocument: {defaultView: {getComputedStyle: style}},
		get textContent() { return this._text + this.children.map(child => child.textContent).join(''); },
		set textContent(value) { this._text = value; this.children = []; },
		get isConnected() { return this._connected && (this.parentElement?.isConnected ?? this.root?.host.isConnected ?? true); },
		get lastElementChild() { return this.children.at(-1); },
		getBoundingClientRect: () => ({...rect}),
		getRootNode() { return this.parentElement?.getRootNode() ?? this.root ?? {}; },
		append(child) { this.children.push(child); child.parentElement = this; },
		querySelector(selector) { return this.children.find(child => child.selector === selector) ?? null; },
	};
}

function data(length) {
	const xs = Float64Array.from({length}, (_, i) => epoch + i * 60000);
	const ys = [0, 1, 2].map(s => Float64Array.from(xs, (_, i) => s === 2 ? 1000 + i : Math.round(((s + 1) * 10 + i / 1000) * 100) / 100));
	return {xs, ys, xPixel: x => 50 + (x - epoch) / 60000 * 1100 / (length - 1)};
}

function bokehFixture(length = 11001) {
	const {xs, ys, xPixel} = data(length), host = element(), canvas = element();
	const input = {x: xs, ...Object.fromEntries(fields.map((field, s) => [field, ys[s]]))};
	const source = {data: {...input}}, manager = {inspectors: new Map()};
	const renderers = fields.map(field => ({glyph: {y: {field}}, data_source: source, get_selection_manager: () => manager}));
	const views = renderers.map((model, s) => ({
		model,
		coordinates: {x_scale: {compute: xPixel}, y_scale: {compute: y => yPixel(y, s)}},
		glyph: {x: xs.slice(), y: ys[s].slice(), sx: Float64Array.from(xs, xPixel), sy: Float64Array.from(ys[s], y => yPixel(y, s))},
	}));
	const tooltipHosts = renderers.map(() => element());
	const contents = tooltipHosts.map(tooltipHost => {
		const content = element(), inner = element();
		inner.root = {host: tooltipHost};
		inner.append(content);
		return content;
	});
	const tooltips = contents.map(content => ({content, visible: true, position: null}));
	const hover = {model: {type: 'HoverTool', active: true}, ttmodels: new Map(renderers.map((r, s) => [r, tooltips[s]])), _current_sxy: null};
	const chart = {
		model: {renderers, lod_threshold: null},
		canvas_view: {el: canvas, bbox: {width: 1200, height: 400}},
		renderer_views: new Map(renderers.map((r, s) => [r, views[s]])),
		tool_views: new Map([[hover.model, hover]]),
	};
	const select = (target, index = target.index, s = target.seriesIndex) => {
		manager.inspectors.clear();
		manager.inspectors.set(renderers[s], {line_indices: [index - 1]});
		hover._current_sxy = [xPixel(xs[index]), yPixel(ys[s][index], s), 'xy'];
		tooltips[s].position = [views[s].glyph.sx[index], views[s].glyph.sy[index]];
		const table = element();
		table.append(element('Time: date'));
		for (let field = 0; field < 3; field++) {
			const row = element(), label = element(names[field] + ': ');
			label.selector = '.bk-tooltip-row-label';
			const value = element(ys[field][index].toFixed(field === 0 ? 3 : 2) + (field === 2 ? ' MB' : '%'));
			value.selector = '[data-value]';
			row.append(label); row.append(value); table.append(row);
		}
		contents[s].textContent = '';
		contents[s].append(table);
	};
	return {input, host, chart, canvas, select, hover, manager, renderers, views, tooltips, tooltipHosts, xPixel,
		value: (i, s) => input[fields[s]][i], x: i => input.x[i],
		staleText(s = 0) { contents[s].lastElementChild.children[s + 1].children[1].textContent = '999999%'; },
		hide(s = 0) { tooltipHosts[s].style.display = 'none'; },
		clear() { manager.inspectors.clear(); },
		wrongValue(s = 0, i = 1000) { views[s].glyph.y[i] += 1; },
	};
}

function canvasjsFixture(length = 11001) {
	const {xs, ys, xPixel} = data(length), host = element(), canvas = element();
	const input = ys.map(y => Array.from(xs, (x, i) => ({x, y: y[i]})));
	const container = element(), contentDiv = element();
	host.append(container); container.append(contentDiv);
	const chart = {
		canvas, width: 1200, height: 400, plotArea: {y1: 0, y2: 400},
		data: input.map((dataPoints, s) => ({_index: s, dataPoints, axisX: {convertValueToPixel: xPixel}, axisY: {convertValueToPixel: y => yPixel(y, s)}})),
		toolTip: {enabled: true, container, contentDiv, _entries: null},
		replaceKeywordsWithValue(template, point, series) {
			assert.equal(template, '{x}: {y}');
			return `${new Date(point.x).toISOString()}: ${point.y.toFixed(2)}${series._index === 2 ? ' MB' : '%'}`;
		},
	};
	const select = (target, index = target.index, s = target.seriesIndex) => {
		const point = input[s][index], series = chart.data[s];
		chart.toolTip._entries = [{index, dataPoint: {...point}, dataSeries: series}];
		contentDiv.textContent = chart.replaceKeywordsWithValue('{x}: {y}', point, series).replace(': ', ':\u00a0\u00a0');
	};
	return {input, host, chart, canvas, select, xPixel,
		value: (i, s) => input[s][i].y, x: i => input[0][i].x,
		staleText() { contentDiv.textContent = 'date: 999999%'; },
		hide() { container.style.display = 'none'; },
		clear() { chart.toolTip._entries = null; },
		wrongValue() { chart.toolTip._entries[0].dataPoint.y += 1; },
	};
}

const adapters = {bokeh, 'bokeh-canvas': bokehCanvas, canvasjs};
const fixtures = {bokeh: bokehFixture, 'bokeh-canvas': bokehFixture, canvasjs: canvasjsFixture};

describe('Bokeh and CanvasJS native benchmark hover plans', () => {
	it('the canvas wrapper reexports the same Bokeh plan', () => {
		assert.equal(bokehCanvas.getHoverPlan, bokeh.getHoverPlan);
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		const fixture = (length) => {
			const f = fixtures[id](length);
			f.plan = adapter.getHoverPlan(f.chart, f.input, f.host);
			return f;
		};

		it(`${id}: projects ten alternating original rows through native scales into viewport CSS pixels`, () => {
			const f = fixture();
			assert.equal(f.plan.then, undefined);
			assert.equal(f.plan.targets.length, 10);
			f.plan.targets.forEach((target, i) => {
				const index = (i + 1) * 1000, s = i % 3;
				assert.deepEqual(target, {index, seriesIndex: s, x: rect.left + f.xPixel(f.x(index)), y: rect.top + yPixel(f.value(index, s), s)});
				assert.equal(f.plan.verify(target), null);
			});
		});

		it(`${id}: requires actual native selection and visible source values for ten distinct rows`, async () => {
			const f = fixture(55001);
			let next = 0;
			const result = await verifyHover(f.plan, {
				move(x, y) {
					const target = f.plan.targets[next++];
					assert.deepEqual([x, y], [target.x, target.y]);
					assert.equal(f.plan.verify(target), null, 'previous native state is not readiness');
					f.select(target, target.index + 25);
				},
				wait: async () => {},
			});
			assert.equal(result.count, 10);
			assert.equal(new Set(result.moves.map(move => move.index)).size, 10);
			result.moves.forEach((move, i) => {
				assert.equal(move.index, f.plan.targets[i].index + 25);
				assert.equal(move.seriesIndex, i % 3);
				assert.equal(move.value, f.value(move.index, move.seriesIndex));
				assert.ok(move.text.length > 0);
			});
		});

		it(`${id}: uses one CSS pixel of index tolerance, returning the actual row`, () => {
			const f = fixture(), target = f.plan.targets[0];
			for (const offset of [-10, 10]) {
				f.select(target, target.index + offset);
				assert.equal(f.plan.verify(target)?.index, target.index + offset);
			}
			for (const offset of [-11, 11]) {
				f.select(target, target.index + offset);
				assert.equal(f.plan.verify(target), null);
			}
		});

		it(`${id}: accounts for CSS scaling without using backing pixels or host dimensions`, () => {
			const f = fixtures[id]();
			f.canvas.getBoundingClientRect = () => ({...rect, width: 600, height: 200});
			f.host.getBoundingClientRect = () => ({left: 0, top: 0, width: 999, height: 999});
			f.canvas.width = 2400; f.canvas.height = 800;
			const plan = adapter.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
			assert.equal(target.x, rect.left + f.xPixel(f.x(target.index)) / 2);
			assert.equal(target.y, rect.top + yPixel(f.value(target.index, 0), 0) / 2);
			f.select(target, target.index + 20);
			assert.equal(plan.verify(target)?.index, target.index + 20);
			f.select(target, target.index + 21);
			assert.equal(plan.verify(target), null);
		});

		for (const failure of ['staleText', 'hide', 'clear', 'wrongValue']) {
			it(`${id}: rejects ${failure}`, () => {
				const f = fixture(), target = f.plan.targets[0];
				f.select(target);
				assert.ok(f.plan.verify(target));
				f[failure]();
				assert.equal(f.plan.verify(target), null);
			});
		}

		it(`${id}: rejects the wrong series even with matching row and tooltip values`, () => {
			const f = fixture(), target = f.plan.targets[0];
			f.select(target, target.index, 1);
			assert.equal(f.plan.verify(target), null);
		});

		it(`${id}: does not scan or copy input to construct the plan`, () => {
			const f = fixtures[id](55001);
			let reads = 0;
			const watch = array => new Proxy(array, {get(target, key) {
				assert.ok(key === 'length' || /^\d+$/.test(String(key)), `unexpected input access: ${String(key)}`);
				reads++;
				return target[key];
			}});
			const input = id === 'canvasjs' ? f.input.map(watch) : Object.fromEntries(Object.entries(f.input).map(([key, values]) => [key, watch(values)]));
			adapter.getHoverPlan(f.chart, input, f.host);
			assert.ok(reads < 40, `plan read ${reads} array properties`);
		});
	}

	it('Bokeh: rejects LOD sampling', () => {
		const f = bokehFixture();
		f.chart.model.lod_threshold = 2000;
		assert.throws(() => bokeh.getHoverPlan(f.chart, f.input, f.host), /unsampled/);
	});

	it('Bokeh: resolves either endpoint of inspector segments and nearest ties like the native tool', () => {
		const f = bokehFixture(), plan = bokeh.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
		f.select(target);
		const glyph = f.views[0].glyph;
		f.manager.inspectors.get(f.renderers[0]).line_indices = [target.index];
		assert.equal(plan.verify(target)?.index, target.index);
		f.select(target, target.index + 1);
		f.hover._current_sxy[0] = (glyph.sx[target.index] + glyph.sx[target.index + 1]) / 2;
		assert.equal(plan.verify(target)?.index, target.index + 1);
	});

	it('Bokeh: rejects stale tooltip position, stale glyph/source data and a cleared tooltip', () => {
		for (const corrupt of [
			f => { f.tooltips[0].position[0] += 1; },
			f => { f.tooltips[0].position = null; },
			f => { f.tooltips[0].visible = false; },
			f => { f.hover.model.active = false; },
			f => { f.hover._current_sxy = null; },
			f => { f.views[0].glyph.x[1000] += 60000; },
			f => { f.renderers[0].data_source.data = {...f.input, cpu: []}; },
		]) {
			const f = bokehFixture(), plan = bokeh.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
			f.select(target); corrupt(f);
			assert.equal(plan.verify(target), null);
		}
	});

	it('Bokeh: checks value, row, shadow host and outer shadow ancestors for visibility', () => {
		for (const level of ['value', 'row', 'host', 'outer']) {
			for (const style of [{display: 'none'}, {visibility: 'hidden'}, {visibility: 'collapse'}, {opacity: '0'}]) {
				const f = bokehFixture(), plan = bokeh.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
				f.select(target);
				const row = f.tooltips[0].content.lastElementChild.children[1], outer = element();
				f.tooltipHosts[0].root = {host: outer};
				assert.ok(plan.verify(target));
				Object.assign(({value: row.children[1], row, host: f.tooltipHosts[0], outer})[level].style, style);
				assert.equal(plan.verify(target), null, `${level}: ${JSON.stringify(style)}`);
			}
		}
	});

	it('Bokeh: rejects detached and zero-size tooltip value nodes', () => {
		for (const detach of [true, false]) {
			const f = bokehFixture(), plan = bokeh.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
			f.select(target);
			if (detach) f.tooltipHosts[0]._connected = false;
			else f.tooltips[0].content.lastElementChild.children[1].children[1].getBoundingClientRect = () => ({...rect, width: 0});
			assert.equal(plan.verify(target), null);
		}
	});

	it('CanvasJS: keeps boundary values one CSS pixel inside the native hit area', () => {
		const f = canvasjsFixture();
		f.chart.data[2].axisY.convertValueToPixel = () => 400;
		f.canvas.getBoundingClientRect = () => ({...rect, width: 600, height: 200});
		const plan = canvasjs.getHoverPlan(f.chart, f.input, f.host);
		assert.equal(plan.targets[2].y, rect.top + 199);
		assert.equal(plan.targets[2].index, 3000);
		assert.equal(plan.targets[2].seriesIndex, 2);
	});

	it('CanvasJS: rejects wrong series identity/index, source x, stale date, disabled and detached tooltips', () => {
		for (const corrupt of [
			f => { f.chart.toolTip._entries[0].dataSeries = {...f.chart.data[0]}; },
			f => { f.chart.data[0]._index = 1; },
			f => { f.chart.toolTip._entries[0].dataPoint.x += 60000; },
			f => { f.chart.toolTip.contentDiv.textContent = 'old date: ' + f.value(1000, 0).toFixed(2) + '%'; },
			f => { f.chart.toolTip.enabled = false; },
			f => { f.chart.toolTip.container._connected = false; },
			f => { f.chart.toolTip.contentDiv.getBoundingClientRect = () => ({...rect, height: 0}); },
		]) {
			const f = canvasjsFixture(), plan = canvasjs.getHoverPlan(f.chart, f.input, f.host), target = plan.targets[0];
			f.select(target); corrupt(f);
			assert.equal(plan.verify(target), null);
		}
	});

	it('adapters add no synthetic hover, per-point hooks or custom tooltip rendering', () => {
		for (const id of ['bokeh', 'canvasjs']) {
			const source = readFileSync(new URL(`../../bench/${id}.mjs`, import.meta.url), 'utf8');
			assert.doesNotMatch(source, /\b(?:dispatchEvent|addEventListener|contentFormatter|CustomJS|innerHTML|showTooltip|render_entries)\b/);
		}
	});
});
