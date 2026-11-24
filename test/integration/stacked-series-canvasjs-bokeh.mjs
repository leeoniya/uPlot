import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../scripts/instrument.mjs';
import {demoDependencies, dependencyUrl} from '../../bench/demo-dependencies.mjs';
import {createStackedSeriesData, negativeStackData, stackedSeries, stackDomain, stackDimensions, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import * as canvasjs from '../../demos/stacked-series-canvasjs.js';
import * as bokeh from '../../demos/stacked-series-bokeh.js';

const positive = stackedSeries.map(series => series.label);
const negative = positive.map(label => `−${label}`);
const labels = [...positive, ...negative];
const adapters = {canvasjs, bokeh};
const args = mock => mock.mock.calls[0].arguments;

function rawData() {
	const raw = createStackedSeriesData();
	// Keep every zero, but detect substitution of the default fixture.
	raw.slice(1).forEach((values, i) => { values[0] += (i + 1) / 10; });
	return Object.freeze(raw.map(Object.freeze));
}

function references(value, result = new Set()) {
	if (value !== null && typeof value === 'object' && !result.has(value)) {
		result.add(value);
		Object.values(value).forEach(child => references(child, result));
	}
	return result;
}

function hostFor(t) {
	const host = document.createElement('div');
	host.innerHTML = '<span>Existing host content</span>';
	document.body.append(host);
	t.after(() => host.remove());
	return host;
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
}

async function assertPending(promise) {
	const marker = {};
	assert.equal(await Promise.race([
		promise.then(() => 'resolved early', () => 'rejected early'),
		new Promise(resolve => setImmediate(resolve, marker)),
	]), marker);
}

function bokehVendor(t, {ready = Promise.resolve(), failure, cleanupFailure} = {}) {
	const state = {error: new Error('Bokeh initialization failed'), cleanupError: new Error('Bokeh cleanup failed')};
	const fail = stage => { if (failure === stage) throw state.error; };
	const dispose = stage => { if (cleanupFailure === stage) throw state.cleanupError; };
	const others = [{name: 'unrelated document before'}, {name: 'unrelated document after'}];
	state.others = others;
	state.order = [];
	state.view = {
		is_destroyed: false,
		remove: t.mock.fn(() => { dispose('view'); state.view.is_destroyed = true; }),
	};
	state.doc = {
		clear: t.mock.fn(() => { dispose('document'); state.model.document = null; }),
		views_manager: {clear: t.mock.fn(() => {
			dispose('manager');
			state.view.remove();
		})},
	};
	const glyph = type => t.mock.fn(options => {
		state.order.push([type, options]);
		fail(type);
		return {glyph: options};
	});
	state.model = {
		document: null,
		varea: glyph('area'),
		line: glyph('line'),
		add_layout: t.mock.fn(),
	};
	state.view.model = state.model;
	state.Library = {
		documents: [...others],
		ColumnDataSource: t.mock.fn(function(options) { fail('source'); Object.assign(this, options); }),
		Stack: t.mock.fn(function(options) { fail('stack'); Object.assign(this, options); }),
		LegendItem: t.mock.fn(function(options) { Object.assign(this, options); }),
		Legend: t.mock.fn(function(options) { fail('legend'); Object.assign(this, options); }),
		Plotting: {
			figure: t.mock.fn(options => { state.options = options; fail('figure'); return state.model; }),
			show: t.mock.fn((model, root) => {
				state.root = root;
				model.document = state.doc;
				state.Library.documents.splice(1, 0, state.doc);
				root.appendChild(root.ownerDocument.createElement('canvas'));
				fail('show');
				return ready.then(() => state.view);
			}),
		},
	};
	return state;
}

describe('CanvasJS and Bokeh stacked-series data and native configuration', () => {
	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: preserves frozen raw values and all zeros with fresh mutable configuration`, () => {
			const raw = rawData(), snapshot = structuredClone(raw);
			const first = adapter.chartOptions(raw), second = adapter.chartOptions(raw);
			assert.deepEqual(first, second);
			const shared = references([raw, stackDomain, stackDimensions, stackedSeries, second]);
			for (const object of references(first)) assert.equal(shared.has(object), false);
			const columns = id === 'canvasjs'
				? [first.data[0].dataPoints.map(point => point.x), ...first.data.map(series => series.dataPoints.map(point => point.y))]
				: Object.values(first.data);
			assert.deepEqual(columns, id === 'canvasjs' ? raw : [...raw, ...negativeStackData(raw).slice(1)]);
			assert.equal(columns.slice(1).flat().filter(value => value === 0).length, id === 'canvasjs' ? 19 : 38);
			if (id === 'canvasjs') {
				first.data[0].dataPoints[0].y = -999;
				first.data[1].dataPoints.push({x: 21, y: 1});
			}
			else {
				first.data[positive[0]][0] = -999;
				first.data[negative[1]].push(1);
				first.layers[0].fields.push('extra');
				first.layers[0].line.line_dash.push(4);
				first.figure.x_range[0] = -100;
			}
			assert.deepEqual(second, adapter.chartOptions(raw));
			assert.deepEqual(raw, snapshot);
		});
	}

	for (const mirrored of [false, true]) {
		it(`CanvasJS uses native stackedArea and a signed legend (negative panel: ${mirrored})`, () => {
			const raw = mirrored ? negativeStackData(rawData()) : rawData();
			const options = canvasjs.chartOptions(raw);
			assert.deepEqual([options.width, options.height], [stackDimensions.width, stackDimensions.height]);
			for (const key of ['animationEnabled', 'interactivityEnabled', 'zoomEnabled', 'exportEnabled'])
				assert.equal(options[key], false);
			assert.deepEqual(options.toolTip, {enabled: false});
			assert.deepEqual([options.axisX.minimum, options.axisX.maximum], stackDomain.x);
			assert.deepEqual([options.axisY.minimum, options.axisY.maximum], mirrored ? [-16, 0] : [0, 16]);
			assert.equal(options.axisX.gridThickness, 1);
			assert.equal(options.axisY.gridThickness, 1);
			assert.equal(options.data.length, 4);
			options.data.forEach((series, i) => {
				const {dataPoints, ...style} = series;
				assert.deepEqual(style, {
					name: (mirrored ? negative : positive)[i], type: 'stackedArea', xValueType: 'number',
					color: stackedSeries[i].stroke, lineColor: stackedSeries[i].stroke,
					lineThickness: strokeWidth, lineDashType: 'solid', fillOpacity,
					markerSize: 0, highlightEnabled: false, showInLegend: true,
				});
				assert.deepEqual(dataPoints, raw[0].map((x, j) => ({x, y: raw[i + 1][j]})));
			});
			for (const key of ['creditText', 'creditHref', 'reversed', 'dataPointMaxWidth'])
				assert.equal(Object.hasOwn(options, key), false);
		});
	}

	it('Bokeh keeps only raw columns and native Stack field lists, with fixed Canvas ranges', () => {
		const options = bokeh.chartOptions(rawData());
		assert.deepEqual(Object.keys(options.data), ['x', ...labels]);
		assert.deepEqual(options.figure, {
			width: stackDimensions.width, height: stackDimensions.height,
			sizing_mode: 'fixed', output_backend: 'canvas',
			x_axis_type: 'linear', y_axis_type: 'linear',
			x_range: stackDomain.x, y_range: [-16, 16],
			tools: '', toolbar_location: null, lod_threshold: null,
		});
		assert.equal(options.layers.length, 8);
		options.layers.forEach((layer, i) => {
			const stroke = stackedSeries[i % 4].stroke;
			assert.deepEqual(layer, {
				fields: (i < 4 ? positive : negative).slice(0, i % 4 + 1),
				area: {name: labels[i], fill_color: stroke, fill_alpha: fillOpacity},
				line: {name: labels[i], line_color: stroke, line_width: strokeWidth, line_alpha: 1, line_dash: []},
			});
		});
	});
});

describe('CanvasJS injected lifecycle', () => {
	it('returns only after the synchronous native render and removes only its own DOM', async t => {
		const host = hostFor(t), before = [...host.childNodes], raw = rawData();
		let root, rendered = false;
		const plot = {render: t.mock.fn(() => { rendered = true; }), destroy: t.mock.fn()};
		const Library = {Chart: t.mock.fn(function(element) {
			root = element;
			root.appendChild(root.ownerDocument.createElement('canvas'));
			return plot;
		})};
		const pending = canvasjs.createDemo(host, raw, Library);
		assert.equal(rendered, true);
		const demo = await pending;
		assert.deepEqual(Object.keys(demo).sort(), ['destroy', 'plot']);
		assert.equal(demo.plot, plot);
		assert.deepEqual(args(Library.Chart), [root, canvasjs.chartOptions(raw)]);
		assert.ok(Library.Chart.mock.calls[0].target);
		assert.equal(plot.render.mock.callCount(), 1);
		assert.equal(plot.render.mock.calls[0].this, plot);
		assert.notEqual(root, host);
		assert.equal(root.parentNode, host);
		const sibling = host.appendChild(document.createElement('span'));
		demo.destroy();
		assert.equal(plot.destroy.mock.callCount(), 1);
		assert.equal(plot.destroy.mock.calls[0].this, plot);
		assert.deepEqual([...host.childNodes], [...before, sibling]);
	});

	for (const failure of ['constructor', 'render']) {
		for (const cleanupFails of [false, true]) {
			it(`preserves ${failure} errors and removes partial DOM (cleanup fails: ${cleanupFails})`, async t => {
				const host = hostFor(t), before = [...host.childNodes], error = new Error('CanvasJS failed');
				const plot = {
					render() { throw error; },
					destroy: t.mock.fn(() => { if (cleanupFails) throw new Error('cleanup failed'); }),
				};
				const Library = {Chart: function(root) {
					root.appendChild(root.ownerDocument.createElement('canvas'));
					if (failure === 'constructor') throw error;
					return plot;
				}};
				await assert.rejects(canvasjs.createDemo(host, rawData(), Library), actual => actual === error);
				assert.equal(plot.destroy.mock.callCount(), failure === 'constructor' ? 0 : 1);
				assert.deepEqual([...host.childNodes], before);
			});
		}
	}

	it('removes its root even when explicit destruction throws', async t => {
		const host = hostFor(t), before = [...host.childNodes], error = new Error('destroy failed');
		const demo = await canvasjs.createDemo(host, rawData(), {Chart: function() {
			return {render() {}, destroy() { throw error; }};
		}});
		assert.throws(demo.destroy, actual => actual === error);
		assert.deepEqual([...host.childNodes], before);
	});
});

describe('Bokeh injected lifecycle', {timeout: 2000}, () => {
	it('uses native expressions for areas and lines and waits for show() document idle', async t => {
		const host = hostFor(t), before = [...host.childNodes], raw = rawData(), ready = deferred();
		const state = bokehVendor(t, {ready: ready.promise});
		const pending = bokeh.createDemo(host, raw, state.Library);
		await assertPending(pending);
		assert.equal(state.view.remove.mock.callCount(), 0);
		const config = bokeh.chartOptions(raw);
		assert.deepEqual(state.options, config.figure);
		assert.deepEqual(args(state.Library.ColumnDataSource), [{data: config.data}]);
		assert.equal(state.Library.ColumnDataSource.mock.callCount(), 1);
		assert.equal(state.Library.Stack.mock.callCount(), 16);
		assert.deepEqual(state.order.map(([type]) => type), labels.flatMap(() => ['area', 'line']));
		assert.equal(state.model.add_layout.mock.callCount(), 1);
		const [legend, position] = args(state.model.add_layout);
		assert.ok(legend instanceof state.Library.Legend);
		assert.equal(position, 'below');
		assert.equal(legend.items.length, 8);
		const source = state.order[0][1].source;
		assert.ok(source instanceof state.Library.ColumnDataSource);
		for (const [i, item] of legend.items.entries()) {
			assert.ok(item instanceof state.Library.LegendItem);
			assert.deepEqual(item.label, {value: labels[i]});
			assert.equal(item.renderers.length, 2);
			assert.equal(item.renderers[0], state.model.varea.mock.calls[i].result);
			assert.equal(item.renderers[1], state.model.line.mock.calls[i].result);
			const area = state.order[i * 2][1], line = state.order[i * 2 + 1][1];
			assert.equal(area.source, source);
			assert.equal(line.source, source);
			assert.deepEqual(area.x, {field: 'x'});
			assert.deepEqual(line.x, {field: 'x'});
			assert.deepEqual(area.y1.expr.fields, config.layers[i].fields.slice(0, -1));
			assert.deepEqual(area.y2.expr.fields, config.layers[i].fields);
			assert.ok(area.y1.expr instanceof state.Library.Stack);
			assert.ok(area.y2.expr instanceof state.Library.Stack);
			assert.equal(line.y, area.y2);
			assert.deepEqual(area, {source, x: {field: 'x'}, y1: area.y1, y2: area.y2, ...config.layers[i].area});
			assert.deepEqual(line, {source, x: {field: 'x'}, y: area.y2, ...config.layers[i].line});
		}
		assert.deepEqual(args(state.Library.Plotting.show), [state.model, state.root]);
		assert.equal(state.root.parentNode, host);
		ready.resolve();
		const demo = await pending;
		assert.equal(demo.plot, state.view);
		assert.deepEqual(Object.keys(demo).sort(), ['destroy', 'plot']);
		const sibling = host.appendChild(document.createElement('span'));
		demo.destroy();
		assert.equal(state.doc.clear.mock.callCount(), 1);
		assert.equal(state.doc.views_manager.clear.mock.callCount(), 1);
		assert.equal(state.view.remove.mock.callCount(), 1);
		assert.deepEqual(state.Library.documents, state.others);
		assert.deepEqual([...host.childNodes], [...before, sibling]);
	});

	for (const failure of ['source', 'figure', 'stack', 'area', 'line', 'legend', 'show', 'async']) {
		for (const cleanupFailure of [undefined, 'document', 'manager']) {
			it(`preserves ${failure} errors (cleanup failure: ${cleanupFailure ?? 'none'})`, async t => {
				const host = hostFor(t), before = [...host.childNodes], ready = deferred();
				const state = bokehVendor(t, {ready: ready.promise, failure, cleanupFailure});
				const pending = bokeh.createDemo(host, rawData(), state.Library);
				const rejected = assert.rejects(pending, actual => actual === state.error);
				if (failure === 'async') ready.reject(state.error);
				await rejected;
				const hasDoc = failure === 'show' || failure === 'async';
				assert.equal(state.doc.clear.mock.callCount(), hasDoc ? 1 : 0);
				assert.equal(state.doc.views_manager.clear.mock.callCount(), hasDoc ? 1 : 0);
				assert.deepEqual(state.Library.documents, state.others);
				assert.deepEqual([...host.childNodes], before);
			});
		}
	}

	for (const cleanupFailure of ['document', 'manager', 'view']) {
		it(`continues cleanup after a ${cleanupFailure} disposal error`, async t => {
			const host = hostFor(t), before = [...host.childNodes];
			const state = bokehVendor(t, {cleanupFailure});
			const demo = await bokeh.createDemo(host, rawData(), state.Library);
			assert.throws(demo.destroy, actual => actual === state.cleanupError);
			assert.equal(state.doc.clear.mock.callCount(), 1);
			assert.equal(state.doc.views_manager.clear.mock.callCount(), 1);
			assert.ok(state.view.remove.mock.callCount() >= 1);
			assert.deepEqual(state.Library.documents, state.others);
			assert.deepEqual([...host.childNodes], before);
		});
	}
});

describe('CanvasJS and Bokeh stacked-series pages', () => {
	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: rejects missing or incomplete libraries without changing the host`, async t => {
			const host = hostFor(t), before = [...host.childNodes];
			const complete = id === 'canvasjs' ? {Chart() {}} : {Plotting: {figure() {}, show() {}}, ColumnDataSource() {}, Stack() {}, Legend() {}, LegendItem() {}};
			const invalid = [null, {}, ...Object.keys(complete).map(key => ({...complete, [key]: null}))];
			if (id === 'bokeh') invalid.push({...complete, Plotting: {figure() {}}}, {...complete, Plotting: {show() {}}});
			for (const Library of invalid) {
				await assert.rejects(adapter.createDemo(host, rawData(), Library), {message: id === 'canvasjs' ? 'CanvasJS did not load' : 'Bokeh did not load'});
				assert.deepEqual([...host.childNodes], before);
			}
		});

		it(`${id}: uses the pinned scripts and standard mountDemo ID without WebGL`, () => {
			const html = readFileSync(new URL(`../../demos/stacked-series-${id}.html`, import.meta.url), 'utf8');
			const page = new DOMParser().parseFromString(html, 'text/html');
			const dependencies = demoDependencies[id].filter(dependency => !dependency.path.includes('bokeh-gl'));
			assert.deepEqual([...page.querySelectorAll('script[src]')].map(script => script.getAttribute('src')), dependencies.map(dependency => dependencyUrl(dependency)));
			assert.ok(page.querySelector('main#demo'));
			assert.ok(page.querySelector('link[href="./stacked-series-compare.css"]'));
			const module = page.querySelector('script[type="module"]').textContent;
			assert.ok(module.includes("import {mountDemo} from './stacked-series-compare.js';"));
			assert.ok(module.includes(`import {createDemo} from './stacked-series-${id}.js';`));
			assert.ok(module.includes(`window.stackedDemo = await mountDemo(document.querySelector('#demo'), '${id}', createDemo);`));
			assert.equal(page.querySelector('style'), null);
			if (id === 'canvasjs') {
				const notice = page.querySelector('p.license');
				assert.ok(notice.textContent.includes('CC BY-NC 3.0'));
				assert.equal(notice.querySelector('a').getAttribute('href'), 'https://cdn.jsdelivr.net/npm/@canvasjs/charts@3.17.8/LICENSE');
			}
		});
	}
});
