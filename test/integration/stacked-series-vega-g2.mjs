import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../scripts/instrument.mjs';
import {demoDependencies, dependencyUrl} from '../../bench/demo-dependencies.mjs';
import {createStackedSeriesData, negativeStackData, stackedSeries, stackDomain, stackDimensions, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import * as vega from '../../demos/stacked-series-vega.js';
import * as g2 from '../../demos/stacked-series-g2.js';

const adapters = {vega, g2};
const colors = [...stackedSeries, ...stackedSeries].map(series => series.stroke);
const labels = [...stackedSeries.map(s => s.label), ...stackedSeries.map(s => '−' + s.label)];
const args = mock => mock.mock.calls[0].arguments;

function rawData() {
	const raw = createStackedSeriesData();
	// Preserve the zero runs while detecting replacement with the default fixture.
	raw.slice(1).forEach((values, i) => { values[0] += (i + 1) / 10; });
	return Object.freeze(raw.map(Object.freeze));
}

function rowsOf(id, options) {
	return id === 'vega' ? options.data[0].values : options.children.flatMap(child => child.data);
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

function vendor(t, id, ready = Promise.resolve(), failure) {
	const state = {error: new Error('render failed'), cleanupError: null};
	const fail = stage => { if (failure === stage) throw state.error; };
	state.dispose = t.mock.fn(() => { if (state.cleanupError) throw state.cleanupError; });
	const initialize = root => {
		state.root = root;
		root.appendChild(root.ownerDocument.createElement('canvas'));
	};
	state.render = t.mock.fn(() => {
		fail('render');
		if (failure === 'logged') state.viewOptions.logger.error(state.error);
		return ready;
	});

	if (id === 'vega') {
		state.plot = {
			initialize: t.mock.fn(root => { initialize(root); fail('setup'); }),
			runAsync: state.render,
			finalize: state.dispose,
		};
		state.Library = {
			Warn: 2,
			logger: t.mock.fn(() => ({})),
			parse: t.mock.fn(options => { state.options = options; fail('parse'); return {spec: options}; }),
			View: t.mock.fn(function(runtime, options) {
				state.runtime = runtime;
				state.viewOptions = options;
				fail('constructor');
				return state.plot;
			}),
		};
	}
	else {
		state.plot = {
			options: t.mock.fn(options => { state.options = options; fail('setup'); }),
			render: state.render,
			destroy: state.dispose,
		};
		state.Library = {Chart: t.mock.fn(function(options) {
			state.constructorOptions = options;
			initialize(options.container);
			fail('constructor');
			return state.plot;
		})};
	}
	return state;
}

describe('Vega and G2 stacked-series raw data and native options', () => {
	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: preserves frozen raw values and every zero without sharing mutable options`, () => {
			const raw = rawData();
			const snapshot = structuredClone(raw);
			const first = adapter.chartOptions(raw);
			const second = adapter.chartOptions(raw);
			const negative = negativeStackData(raw);
			const expected = labels.flatMap((series, order) => raw[0].map((x, i) => {
				const dir = order < 4 ? 1 : -1;
				const value = (dir > 0 ? raw : negative)[1 + order % 4][i];
				return id === 'vega'
					? {x, series, value, order, group: dir > 0 ? 'positive' : 'negative'}
					: {x, series, value};
			}));
			assert.deepEqual(rowsOf(id, first), expected);
			assert.equal(rowsOf(id, first).length, 168);
			assert.equal(rowsOf(id, first).filter(row => row.value === 0).length, 38);
			assert.deepEqual(first, second);
			const shared = references([raw, stackDomain, stackDimensions, stackedSeries, second]);
			for (const value of references(first)) assert.equal(shared.has(value), false);
			rowsOf(id, first)[0].value = -999;

			assert.deepEqual(rowsOf(id, second), expected);
			assert.deepEqual(raw, snapshot);
		});

		it(`${id}: uses the pinned CDN bundle and standard mountDemo entry point`, () => {
			const html = readFileSync(new URL(`../../demos/stacked-series-${id}.html`, import.meta.url), 'utf8');
			assert.ok(html.includes(`src="${dependencyUrl(demoDependencies[id][0])}"`));
			assert.ok(html.includes(`import {createDemo} from './stacked-series-${id}.js';`));
			assert.ok(html.includes(`window.stackedDemo = await mountDemo(document.querySelector('#demo'), '${id}', createDemo);`));
			assert.ok(html.includes("import {mountDemo} from './stacked-series-compare.js';"));
			assert.ok(html.includes('href="./stacked-series-compare.css"'));
			assert.equal([...html.matchAll(/<script\b/g)].length, 2);
		});
	}

	it('Vega stacks signed values by x and group and draws the native stack boundaries', () => {
		const options = vega.chartOptions(rawData());
		assert.equal(options.width, stackDimensions.width);
		assert.equal(options.height, stackDimensions.height);
		assert.deepEqual(options.autosize, {type: 'fit', contains: 'padding'});
		assert.deepEqual(options.data[0].transform, [{
			type: 'stack', groupby: ['x', 'group'], sort: {field: 'order', order: 'ascending'}, field: 'value', offset: 'zero', as: ['y0', 'y1'],
		}]);
		assert.equal(options.data.length, 1);
		for (const [i, name] of ['x', 'y'].entries()) {
			assert.deepEqual(options.scales[i], {name, type: 'linear', domain: name === 'x' ? stackDomain.x : [-16, 16], range: i === 0 ? 'width' : 'height', nice: false, zero: false});
			assert.equal(options.axes[i].grid, true);
		}
		assert.deepEqual(options.scales[2], {name: 'color', type: 'ordinal', domain: labels, range: colors});
		assert.equal(options.marks.length, 1);
		const group = options.marks[0];
		assert.equal(group.type, 'group');
		assert.equal(group.interactive, false);
		assert.deepEqual(group.from, {facet: {name: 'series', data: 'table', groupby: 'series'}});
		assert.equal(group.sort, undefined);
		assert.deepEqual(group.marks.map(mark => mark.type), ['area', 'line']);
		for (const mark of group.marks) {
			assert.equal(mark.interactive, false);
			assert.equal(mark.clip, undefined);
			assert.equal(mark.zindex, undefined);
			assert.deepEqual(mark.from, {data: 'series'});
			assert.deepEqual(Object.keys(mark.encode), ['update']);
			assert.deepEqual(mark.encode.update.x, {scale: 'x', field: 'x'});
			assert.deepEqual(mark.encode.update.y, {scale: 'y', field: 'y1'});
			assert.deepEqual(mark.encode.update.interpolate, {value: 'linear'});
		}
		const [area, line] = group.marks.map(mark => mark.encode.update);
		assert.deepEqual(area.y2, {scale: 'y', field: 'y0'});
		assert.deepEqual(area.fill, {scale: 'color', field: 'series'});
		assert.deepEqual(area.fillOpacity, {value: fillOpacity});
		assert.deepEqual(area.stroke, {value: null});
		assert.deepEqual(line.stroke, {scale: 'color', field: 'series'});
		assert.deepEqual(line.strokeWidth, {value: strokeWidth});
		assert.deepEqual(line.strokeOpacity, {value: 1});
		assert.equal(options.signals, undefined);
		assert.deepEqual(options.legends, [{fill: 'color', orient: 'bottom', direction: 'horizontal'}]);
	});

	it('G2 stacks signed values by x, reversing only the negative mark on a shared Y scale', () => {
		const options = g2.chartOptions(rawData());
		assert.equal(options.width, stackDimensions.width);
		assert.equal(options.height, stackDimensions.height);
		assert.equal(options.autoFit, false);
		assert.equal(options.type, 'view');
		assert.equal(options.children.length, 2);
		for (const [i, mark] of options.children.entries()) {
			assert.equal(mark.type, 'area');
			assert.deepEqual([...new Set(mark.data.map(row => row.series))], labels.slice(i * 4, i * 4 + 4));
			assert.deepEqual(mark.encode, {x: 'x', y: 'value', color: 'series', series: 'series'});
			assert.deepEqual(mark.transform, [{type: 'stackY', reverse: i === 1}]);
			assert.equal(mark.scale?.y, undefined);
			assert.equal(mark.axis?.y, undefined);
			assert.deepEqual(mark.style, {lineWidth: strokeWidth, strokeOpacity: 1, fillOpacity});
			assert.equal(mark.animate, false);
		}
		assert.deepEqual(options.scale.y, {type: 'linear', domain: [-16, 16], nice: false, tickCount: 9});
		assert.deepEqual(options.scale.x, {type: 'linear', domain: stackDomain.x, nice: false, tickCount: 11});

		assert.deepEqual(options.scale.color, {type: 'ordinal', domain: labels, range: colors});
		assert.deepEqual(options.axis, {x: {title: false, grid: true}, y: {title: false, grid: true}});
		assert.deepEqual(options.interaction, {event: false, tooltip: false, sliderFilter: false, legendFilter: false, scrollbarFilter: false});
		assert.equal(options.animate, false);
		assert.deepEqual(options.legend, {color: {position: 'bottom', title: false}});
	});
});

for (const [id, adapter] of Object.entries(adapters)) {
	describe(`${id} stacked-series injected lifecycle`, {timeout: 2000}, () => {
		it('awaits native render completion and removes only its own DOM on destroy', async t => {
			const host = hostFor(t), before = [...host.childNodes], raw = rawData();
			const ready = deferred();
			const state = vendor(t, id, ready.promise);
			const pending = adapter.createDemo(host, raw, state.Library);
			await assertPending(pending);
			assert.equal(state.render.mock.callCount(), 1);
			assert.equal(state.dispose.mock.callCount(), 0);
			assert.equal(state.root.parentNode, host);
			assert.notEqual(state.root, host);
			assert.equal(state.root.querySelectorAll('canvas').length, 1);
			assert.deepEqual(state.options, adapter.chartOptions(raw));
			if (id === 'vega') {
				assert.deepEqual(args(state.Library.logger), [state.Library.Warn]);
				assert.deepEqual(state.runtime, {spec: state.options});
				assert.equal(state.viewOptions.renderer, 'canvas');
				assert.equal(state.viewOptions.hover, false);
				assert.equal(typeof state.viewOptions.logger.error, 'function');
				assert.deepEqual(args(state.plot.initialize), [state.root]);
			}
			else assert.deepEqual(state.constructorOptions, {container: state.root});
			ready.resolve();
			const demo = await pending;
			assert.equal(demo.plot, state.plot);
			assert.deepEqual(Object.keys(demo).sort(), ['destroy', 'plot']);
			const sibling = host.appendChild(document.createElement('span'));
			demo.destroy();
			assert.equal(state.dispose.mock.callCount(), 1);
			assert.equal(state.root.parentNode, null);
			assert.deepEqual([...host.childNodes], [...before, sibling]);
		});

		for (const Library of [null, {}, id === 'vega' ? {View() {}} : {Chart: {}}]) {
			it('rejects a missing or incomplete library without changing the host', async t => {
				const host = hostFor(t), before = [...host.childNodes];
				await assert.rejects(adapter.createDemo(host, rawData(), Library), {
					message: id === 'vega' ? 'Vega did not load' : 'AntV G2 did not load',
				});
				assert.deepEqual([...host.childNodes], before);
			});
		}

		for (const failure of [...(id === 'vega' ? ['parse', 'logged'] : []), 'constructor', 'setup', 'render', 'async']) {
			it(`preserves ${failure} errors and cleans DOM even when disposal throws`, async t => {
				const host = hostFor(t), before = [...host.childNodes];
				const ready = deferred();
				const state = vendor(t, id, ready.promise, failure);
				state.cleanupError = new Error('cleanup failed');
				const pending = adapter.createDemo(host, rawData(), state.Library);
				const rejected = assert.rejects(pending, error => error === state.error);
				if (failure === 'async') ready.reject(state.error);
				await rejected;
				assert.equal(state.dispose.mock.callCount(), ['parse', 'constructor'].includes(failure) ? 0 : 1);
				assert.deepEqual([...host.childNodes], before);
			});
		}

		it('removes its DOM even when normal destruction throws', async t => {
			const host = hostFor(t), before = [...host.childNodes];
			const state = vendor(t, id);
			const demo = await adapter.createDemo(host, rawData(), state.Library);
			state.cleanupError = new Error('cleanup failed');
			assert.throws(() => demo.destroy(), error => error === state.cleanupError);
			assert.equal(state.dispose.mock.callCount(), 1);
			assert.deepEqual([...host.childNodes], before);
		});
	});
}
