import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import '../../scripts/instrument.mjs';
import {createStackedSeriesData, stackedSeries, stackDomain, stackDimensions, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import * as billboard from '../../demos/stacked-series-billboard.js';
import * as dygraphs from '../../demos/stacked-series-dygraphs.js';
import {demoDependencies, dependencyUrl} from '../../bench/demo-dependencies.mjs';

const keys = ['x', 'A', 'B', 'C', 'D'];
const labels = stackedSeries.map(series => series.label);
const colors = stackedSeries.map(series => series.stroke);
const args = mock => mock.mock.calls[0].arguments;

function rawData(negative = false) {
	const raw = createStackedSeriesData();
	// Preserve the zero runs, but detect substitution of the default fixture.
	raw.slice(1).forEach((values, i) => { values[0] += (i + 1) / 10; });
	return Object.freeze(raw.map((values, column) => Object.freeze(
		negative && column > 0 ? values.map(value => 0 - value) : values
	)));
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

function hostFor(t) {
	const host = document.createElement('div');
	host.innerHTML = '<span>Existing host content</span>';
	document.body.append(host);
	t.after(() => host.remove());
	return host;
}

async function assertPending(promise) {
	const marker = {};
	assert.equal(await Promise.race([
		promise.then(() => 'resolved early', () => 'rejected early'),
		new Promise(resolve => setImmediate(resolve, marker)),
	]), marker);
}

for (const negative of [false, true]) describe(`billboard.js and dygraphs ${negative ? 'negative' : 'positive'} split host`, () => {
	const names = labels.map(label => (negative ? '−' : '') + label);
	const domain = negative ? [-16, 0] : [0, 16];

	it('billboard preserves frozen raw columns and zeros with fresh native area groups', () => {
		const raw = rawData(negative), snapshot = structuredClone(raw);
		const first = billboard.chartOptions(raw), second = billboard.chartOptions(raw);
		assertFresh(first, second);
		assert.deepEqual(first.data.columns.map(column => column[0]), keys);
		assert.deepEqual(first.data.columns.map(column => column.slice(1)), raw);
		assert.equal(first.data.x, 'x');
		assert.equal(first.data.type, 'area');
		assert.deepEqual(first.data.groups, [['A', 'B', 'C', 'D']]);
		assert.equal(first.data.order, null);
		assert.deepEqual(Object.values(first.data.names), names);
		assert.deepEqual(Object.values(first.data.colors), colors);
		assert.deepEqual(first.size, stackDimensions);
		assert.equal(first.padding.right, 20);
		assert.deepEqual(first.render, {mode: 'svg', lazy: false, observe: false});
		assert.deepEqual(first.resize, {auto: false});
		assert.equal(first.axis.x.type, 'indexed');
		assert.deepEqual([first.axis.x.min, first.axis.x.max], stackDomain.x);
		assert.deepEqual([first.axis.y.min, first.axis.y.max], domain);
		assert.deepEqual(first.axis.x.padding, {left: 0, right: 0});
		assert.deepEqual(first.axis.y.padding, {top: 0, bottom: 0});
		assert.deepEqual(first.axis.x.tick.values, Array.from({length: 11}, (_, i) => i * 2));
		assert.deepEqual(first.axis.y.tick.values, Array.from({length: 9}, (_, i) => domain[0] + i * 2));
		assert.equal(first.transition.duration, 0);
		assert.equal(first.point.show, false);
		assert.equal(first.legend.show, true);
		assert.equal(first.tooltip.show, false);
		assert.equal(first.interaction.enabled, false);
		// Keep native zero placement, fill geometry, and paint order.
		assert.equal(first.data.groupsZeroAs, negative ? 'negative' : 'positive');
		assert.equal(Object.hasOwn(first, 'area'), false);
		assert.equal(Object.hasOwn(first, 'onrendered'), false);
		first.data.columns.forEach(column => column.fill(-100));
		first.data.groups[0].reverse();
		first.data.colors.A = 'black';
		assert.deepEqual(second, billboard.chartOptions(raw));
		assert.deepEqual(raw, snapshot);
	});

	it('dygraphs reverses raw columns, labels, and colors to stack A nearest zero', () => {
		const raw = rawData(negative), snapshot = structuredClone(raw);
		const first = dygraphs.chartOptions(raw), second = dygraphs.chartOptions(raw);
		assertFresh(first, second);
		assert.equal(first.data.length, raw[0].length);
		for (const row of first.data) assert.equal(row.length, 5);
		assert.deepEqual([0, 4, 3, 2, 1].map(column => first.data.map(row => row[column])), raw);
		const options = first.options;
		assert.deepEqual(options.labels, ['X', ...names.slice().reverse()]);
		assert.deepEqual(options.colors, colors.slice().reverse());
		assert.deepEqual([options.width, options.height], [stackDimensions.width, stackDimensions.height]);
		assert.deepEqual([options.stackedGraph, options.fillGraph], [true, true]);
		assert.equal(options.fillAlpha, fillOpacity);
		assert.equal(options.strokeWidth, strokeWidth);
		assert.equal(options.strokePattern, null);
		assert.equal(options.stepPlot, false);
		assert.deepEqual(options.dateWindow, stackDomain.x);
		assert.deepEqual(options.valueRange, domain);
		assert.deepEqual([options.xRangePad, options.yRangePad], [0, 0]);
		assert.deepEqual([options.drawPoints, options.pointSize, options.highlightCircleSize], [false, 0, 0]);
		assert.equal(options.legend, 'always');
		assert.deepEqual([options.showRoller, options.showRangeSelector, options.animatedZooms], [false, false, false]);
		assert.deepEqual(options.interactionModel, {});
		for (const key of ['plotter', 'stackedGraphNaNFill', 'connectSeparatedPoints', 'drawCallback', 'underlayCallback'])
			assert.equal(Object.hasOwn(options, key), false, `keep native ${key}`);
		first.data.forEach(row => row.fill(-100));
		options.labels.reverse();
		options.colors.fill('black');
		options.dateWindow[0] = -100;
		options.valueRange[0] = -100;
		assert.deepEqual(second, dygraphs.chartOptions(raw));
		assert.deepEqual(raw, snapshot);
	});
});

describe('billboard.js injected lifecycle', {timeout: 5000}, () => {
	for (const synchronous of [true, false]) {
		it(`waits for onrendered and destroys the same plot (synchronous: ${synchronous})`, async t => {
			const host = hostFor(t), raw = rawData();
			const plot = {destroy: t.mock.fn()};
			let rendered;
			const Library = {generate: t.mock.fn(options => {
				options.onbeforeinit.call(plot);
				rendered = () => options.onrendered.call(plot);
				if (synchronous) rendered();
				return plot;
			})};
			const pending = billboard.createDemo(host, raw, Library);
			assert.equal(Library.generate.mock.callCount(), 1);
			assert.equal(Library.generate.mock.calls[0].this, Library);
			const {bindto, onbeforeinit, onrendered, ...options} = args(Library.generate)[0];
			assert.equal(bindto, host);
			assert.equal(typeof onbeforeinit, 'function');
			assert.equal(typeof onrendered, 'function');
			assert.deepEqual(options, billboard.chartOptions(raw));
			if (!synchronous) {
				await assertPending(pending);
				assert.equal(plot.destroy.mock.callCount(), 0);
				rendered();
			}
			const demo = await pending;
			assert.equal(demo.plot, plot);
			rendered(); // Later native redraws do not dispose the chart.
			assert.equal(plot.destroy.mock.callCount(), 0);
			demo.destroy();
			assert.equal(plot.destroy.mock.callCount(), 1);
			assert.equal(plot.destroy.mock.calls[0].this, plot);
			assert.deepEqual(raw, rawData());
		});
	}

	for (const cleanupFails of [false, true]) {
		it(`cleans up partial initialization and preserves the error (cleanup fails: ${cleanupFails})`, async t => {
			const error = new Error('initialization failed');
			const plot = {destroy: t.mock.fn(() => { if (cleanupFails) throw new Error('cleanup failed'); })};
			const Library = {generate(options) {
				options.onbeforeinit.call(plot);
				options.onrendered.call(plot);
				throw error;
			}};
			await assert.rejects(billboard.createDemo(hostFor(t), rawData(), Library), actual => actual === error);
			assert.equal(plot.destroy.mock.callCount(), 1);
		});
	}

	it('preserves a generation error before an instance exists', async t => {
		const error = new Error('generation failed');
		await assert.rejects(billboard.createDemo(hostFor(t), rawData(), {generate() { throw error; }}), actual => actual === error);
	});
});

describe('dygraphs injected lifecycle', {timeout: 5000}, () => {
	for (const synchronous of [true, false]) {
		it(`waits for ready and destroys the same plot (synchronous: ${synchronous})`, async t => {
			const host = hostFor(t), raw = rawData();
			let ready;
			const plot = {
				ready: t.mock.fn(callback => { ready = callback; if (synchronous) callback(plot); }),
				destroy: t.mock.fn(),
			};
			const Library = t.mock.fn(function() { return plot; });
			const pending = dygraphs.createDemo(host, raw, Library);
			const config = dygraphs.chartOptions(raw);
			assert.equal(Library.mock.callCount(), 1);
			assert.deepEqual(args(Library), [host, config.data, config.options]);
			assert.ok(Library.mock.calls[0].target, 'constructs a native Dygraph');
			assert.equal(plot.ready.mock.callCount(), 1);
			assert.equal(plot.ready.mock.calls[0].this, plot);
			if (!synchronous) {
				await assertPending(pending);
				assert.equal(plot.destroy.mock.callCount(), 0);
				ready(plot);
			}
			const demo = await pending;
			assert.equal(demo.plot, plot);
			assert.equal(plot.destroy.mock.callCount(), 0);
			demo.destroy();
			assert.equal(plot.destroy.mock.callCount(), 1);
			assert.equal(plot.destroy.mock.calls[0].this, plot);
			assert.deepEqual(raw, rawData());
		});
	}

	for (const cleanupFails of [false, true]) {
		it(`disposes on readiness failure and preserves the error (cleanup fails: ${cleanupFails})`, async t => {
			const error = new Error('ready failed');
			const plot = {
				ready: t.mock.fn(() => { throw error; }),
				destroy: t.mock.fn(() => { if (cleanupFails) throw new Error('cleanup failed'); }),
			};
			await assert.rejects(dygraphs.createDemo(hostFor(t), rawData(), function() { return plot; }), actual => actual === error);
			assert.equal(plot.destroy.mock.callCount(), 1);
		});
	}

	it('preserves a constructor error', async t => {
		const error = new Error('construction failed');
		await assert.rejects(dygraphs.createDemo(hostFor(t), rawData(), function() { throw error; }), actual => actual === error);
	});
});

describe('stacked billboard.js and dygraphs pages', () => {
	for (const [id, adapter, invalid, message] of [
		['billboard', billboard, [null, {}, {generate: true}], 'billboard.js did not load'],
		['dygraphs', dygraphs, [null, {}, {Dygraph() {}}], 'dygraphs did not load'],
	]) {
		it(`${id}: rejects missing libraries without changing the host`, async t => {
			const host = hostFor(t), before = host.innerHTML;
			for (const Library of invalid) {
				await assert.rejects(adapter.createDemo(host, rawData(), Library), {message});
				assert.equal(host.innerHTML, before);
			}
		});

		it(`${id}: loads the exact pinned script and stylesheet and uses the standard mount`, () => {
			const html = readFileSync(new URL(`../../demos/stacked-series-${id}.html`, import.meta.url), 'utf8');
			const page = new DOMParser().parseFromString(html, 'text/html');
			const dependencies = demoDependencies[id].filter(dependency => dependency.name);
			for (const dependency of dependencies) {
				const url = dependencyUrl(dependency);
				assert.ok(url.startsWith('https://cdn.jsdelivr.net/npm/'));
				const selector = dependency.type === 'style' ? `link[rel="stylesheet"][href="${url}"]` : `script[src="${url}"]`;
				assert.ok(page.querySelector(selector), url);
			}
			assert.equal(page.querySelectorAll('script[src]').length, 1);
			assert.ok(page.querySelector('link[href="./stacked-series-compare.css"]'));
			assert.ok(page.querySelector('main#demo'));
			const module = page.querySelector('script[type="module"]').textContent;
			assert.ok(module.includes("import {mountDemo} from './stacked-series-compare.js'"));
			assert.ok(module.includes(`import {createDemo} from './stacked-series-${id}.js'`));
			assert.ok(module.includes(`window.stackedDemo = await mountDemo(document.querySelector('#demo'), '${id}', createDemo)`));
			const css = page.querySelector('style').textContent;
			if (id === 'billboard') {
				assert.match(css, /#plot \.bb-line\s*\{[^}]*stroke-width: 3px;[^}]*stroke-opacity: 1;[^}]*stroke-dasharray: none;[^}]*opacity: 1;/);
				assert.match(css, /#plot \.bb-area\s*\{\s*opacity: 0\.18;/);
			}
			else
				assert.match(css, /#plot\s*\{\s*pointer-events: none;/);
		});
	}
});
