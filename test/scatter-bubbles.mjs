import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import Flatbush from '../demos/lib/flatbush.js';
import { scatterPlugin } from '../demos/lib/scatterPlugin.js';

const tick = () => Promise.resolve();
const ops = log => log.flatMap(([name, ...entries]) => entries.map(args => ({name, args})));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const columns = rows => [0, 1, 2, 3].map(i => rows.map(row => row[i]));
const dataFor = (...regions) => [null, ...Array.from({length: 4}, (_, i) => columns(regions[i] ?? []))];
const fixture = () => dataFor(
	[[20, -80, 100, 'A']],
	[[40, 60, 25, 'B']],
	[[60, 40, 100, 'C']],
	[[80, 20, 100, 'E']],
);

function createDemo(data = fixture(), {pxRatio = 1, nodeSize, scatterData, levels = false, configure = () => {}} = {}) {
	const indexes = [], titles = [], listeners = [], removed = [], cursorCalls = [];
	let scatter = null;
	let levelPlot = null;

	class TrackedFlatbush extends Flatbush {
		constructor(numItems, ...args) {
			assert.ok(Number.isInteger(numItems) && numItems > 0, 'do not allocate an empty index');
			super(numItems, nodeSize ?? args[0], args[1]);
			this.bounds = [];
			this.finishes = 0;
			this.searches = [];
			indexes.push(this);
		}
		add(...bounds) {
			assert.equal(this.finishes, 0);
			assert.equal(bounds.length, 4);
			assert.ok(bounds.every(Number.isFinite));
			assert.ok(bounds[2] > bounds[0] && bounds[3] > bounds[1] || bounds.every(v => v === 0), 'real bounds or an empty placeholder');
			assert.ok(this.bounds.length < this.numItems, 'allocation reserves one slot per visible-series data point');
			const id = super.add(...bounds);
			assert.equal(id, this.bounds.length);
			this.bounds.push(bounds);
			return id;
		}
		finish() {
			assert.equal(this.bounds.length, this.numItems);
			assert.equal(++this.finishes, 1, 'finish each index only once');
			return super.finish();
		}
		search(minX, minY, maxX, maxY, filter) {
			assert.equal(this.finishes, 1, 'finish before searching');
			assert.equal(typeof filter, 'function');
			const search = {box: [minX, minY, maxX, maxY], visits: []};
			this.searches.push(search);
			const result = super.search(minX, minY, maxX, maxY, (...args) => {
				assert.equal(args.length, 5, 'Flatbush passes id and four bounds');
				assert.deepEqual(args.slice(1), this.bounds[args[0]]);
				search.visits.push(args);
				const accepted = filter(...args);
				assert.equal(accepted, false, 'select hover without accumulating results');
				return accepted;
			});
			assert.deepEqual(result, []);
			return result;
		}
	}

	function DemoPlot(opts, demoData, target) {
		titles.push(opts.title);
		if (opts.title == 'Scatter Plot') {
			if (scatterData == null)
				return {};
			Object.assign(opts, {width: 400, height: 300, pxRatio, axes: []});
			opts.scales.x.range = opts.scales.y.range = [0, 100];
			return scatter = new uPlot(opts, scatterData, target);
		}
		if (opts.title == 'Scatter Plot by Level') {
			if (!levels)
				return {};
			Object.assign(opts, {width: 400, height: 300, pxRatio, axes: []});
			opts.scales.x.range = opts.scales.y.range = [0, 500];
			return levelPlot = new uPlot(opts, demoData, target);
		}
		assert.equal(opts.title, 'Bubble Plot');
		Object.assign(opts, {width: 400, height: 300, pxRatio, pxAlign: 0, padding: [12, 18, 24, 30]});
		opts.axes.forEach(axis => { axis.show = false; });
		for (const [key, range] of Object.entries({x: [0, 100], y: [0, 100], y2: [-100, 0]}))
			opts.scales[key].range = range;
		configure(opts);
		opts.hooks ??= {};
		opts.hooks.init = [u => {
			const add = u.over.addEventListener.bind(u.over);
			const remove = u.over.removeEventListener.bind(u.over);
			u.over.addEventListener = (type, listener, options) => {
				if (type == 'mouseenter') listeners.push(listener);
				return add(type, listener, options);
			};
			u.over.removeEventListener = (type, listener, options) => {
				if (type == 'mouseenter') removed.push(listener);
				return remove(type, listener, options);
			};
			const setCursor = u.setCursor;
			u.setCursor = (cursor, fire, pub) => {
				cursorCalls.push({same: cursor === u.cursor, fire, pub});
				return setCursor(cursor, fire, pub);
			};
		}, ...(opts.hooks.init ?? [])];
		return new uPlot(opts, data, target);
	}
	// Exercise the plugin source with a tracked index, without adding a test-only plugin option.
	const pluginSource = readFileSync(new URL('../demos/lib/scatterPlugin.js', import.meta.url), 'utf8')
		.replace(/^import[^\n]+;\s*$/gm, '').replace('export function scatterPlugin', 'function scatterPlugin');
	const trackedPlugin = new Function('uPlot', 'Flatbush', pluginSource + '\nreturn scatterPlugin;')(uPlot, TrackedFlatbush);

	const html = readFileSync(new URL('../demos/scatter.html', import.meta.url), 'utf8');
	const script = html.match(/<script\b[^>]*type="module"[^>]*>([^]*?)<\/script>/)?.[1];
	assert.ok(script, 'scatter demo has an inline module');
	const source = script.replace(/^\s*import\s+[^\n]+;\s*$/gm, '').replace(/let points\s*=\s*10000\s*;/, 'let points = 4;');
	const {u, shapeToggle} = new Function('uPlot', 'scatterPlugin', source + '\nreturn {u: u2, shapeToggle};')(DemoPlot, trackedPlugin);
	assert.deepEqual(titles, ['Scatter Plot', 'Bubble Plot', 'Scatter Plot by Level']);
	return {
		u, scatter, levelPlot, shapeToggle, indexes, listeners, removed, cursorCalls,
		enter: () => u.over.dispatchEvent(new MouseEvent('mouseenter')),
		latest(count) {
			const index = indexes.at(-1);
			assert.ok(index, 'draw creates an index');
			assert.equal(index.numItems, count);
			assert.equal(index.bounds.length, count);
			return index;
		},
		destroy() { try { u.destroy(); } finally { scatter?.destroy(); levelPlot?.destroy(); shapeToggle.parentElement.remove(); } },
	};
}

function center(u, seriesIdx, dataIdx = 0) {
	return {
		left: u.valToPos(u.data[seriesIdx][0][dataIdx], 'x'),
		top: u.valToPos(u.data[seriesIdx][1][dataIdx], u.series[seriesIdx].facets[1].scale),
	};
}

function selected(u, seriesIdx = null, dataIdx = 0) {
	assert.deepEqual(u.cursor.idxs.slice(1), [1, 2, 3, 4].map(si => si == seriesIdx ? dataIdx : null));
	if (seriesIdx != null)
		assert.equal(u.legend.values[seriesIdx].Country, u.data[seriesIdx][3][dataIdx]);
}

describe('scatter plugin', () => {
	it('preserves caller scales, facets, legend, hooks, and per-series point options', () => {
		const scales = {x: {time: false}, y: {range: [0, 100]}};
		const hooks = {draw: [() => {}]};
		const legend = {live: false};
		const cursor = {show: false};
		const facets = [{scale: 'x'}, {scale: 'y'}];
		const value = () => 'custom';
		const opts = {
			scales, hooks, legend, cursor,
			series: [null, {facets, fill: 'red', value, pxAlign: 1, points: {size: 12, fill: 'blue'}}],
		};
		const plugin = scatterPlugin({points: {size: 5, width: 0}});
		plugin.opts({mode: 2}, opts);
		assert.equal(opts.scales, scales);
		assert.equal(opts.hooks, hooks);
		assert.equal(opts.legend, legend);
		assert.equal(opts.cursor, cursor);
		assert.deepEqual(plugin.hooks, {}, 'hover is opt-in');
		const series = opts.series[1];
		assert.equal(series.facets, facets);
		assert.equal(series.value, value);
		assert.equal(series.pxAlign, 1);
		assert.equal(series.paths(), null);
		assert.equal(series.points.show, true);
		assert.equal(series.points.size, 12);
		assert.equal(series.points.width, 0);
		assert.equal(series.points.fill, 'blue');
		assert.equal(typeof series.points.paths, 'function');
	});

	for (const batch of [undefined, false, true]) {
		it(`uses ordered uniform scatter painting unless batching is enabled (${batch})`, async () => {
			const u = new uPlot({
				mode: 2, width: 400, height: 300, pxRatio: 1, axes: [],
				scales: {x: {time: false, range: [0, 100]}, y: {range: [0, 100]}},
				series: [null, {fill: 'rgba(255,0,0,0.3)'}],
				plugins: [scatterPlugin({batch, points: {size: 10, width: 0}})],
			}, [null, [[50, 50, 50], [50, 50, 50]]], document.body);
			try {
				await tick();
				const start = u.ctx.log.length;
				u.redraw(true);
				await tick();
				const fills = ops(u.ctx.log.slice(start)).filter(e => e.name == 'fill');
				assert.equal(fills.length, batch === true ? 1 : 3);
				assert.ok(fills.every(e => batch === true ? e.args[0]?.log : e.args.length == 0));
			}
			finally { u.destroy(); }
		});
	}

	for (const batch of [false, true]) {
		it(`selects square corners but rejects circle corners (batch ${batch})`, async () => {
			const u = new uPlot({
				mode: 2, width: 400, height: 300, pxRatio: 2, axes: [],
				scales: {x: {time: false, range: [0, 100]}, y: {range: [0, 100]}},
				series: [null, {fill: 'red', points: {shape: 1}}, {fill: 'blue', points: {shape: 2}}],
				cursor: {focus: {alpha: 1, prox: -1}},
				plugins: [scatterPlugin({batch, hover: true, points: {size: 10, width: 0}})],
			}, [null, [[25], [50]], [[75], [50]]], document.body);
			try {
				await tick();
				for (const si of [1, 2]) {
					const pos = center(u, si);
					u.setCursor({left: pos.left + 4, top: pos.top + 4});
					await tick();
					assert.deepEqual(u.cursor.idxs.slice(1), si == 1 ? [null, null] : [null, 0]);
					u.setCursor(pos);
					await tick();
					assert.equal(u.cursor.idxs[si], 0, 'both shapes include their centers');
				}
			}
			finally { u.destroy(); }
		});
	}

	it('composes with caller hooks and keeps hover state independent between plugin instances', async () => {
		const plots = [];
		const calls = [];
		try {
			for (const value of [25, 75]) {
				plots.push(new uPlot({
					mode: 2, width: 400, height: 300, pxRatio: 1, axes: [],
					scales: {x: {time: false, range: [0, 100]}, y: {range: [0, 100]}},
					series: [null, {stroke: 'red', fill: 'red'}],
					cursor: {x: false, points: {fill: 'blue'}, focus: {alpha: 1, prox: -1}},
					hooks: {
						init: [() => calls.push(['init', value])],
						destroy: [() => calls.push(['destroy', value])],
					},
					plugins: [scatterPlugin({hover: true, points: {size: 10, width: 0}})],
				}, [null, [[value], [value]]], document.body));
			}
			await tick();
			assert.deepEqual(calls, [['init', 25], ['init', 75]]);
			for (const u of plots) {
				u.setCursor(center(u, 1));
				await tick();
				assert.equal(u.cursor.idxs[1], 0);
				assert.equal(u.cursor.points.size(u, 1), 10);
				assert.equal(u.cursor.x, false);
				assert.equal(u.cursor.points.fill(u, 1), 'blue');
				assert.equal(u.focus.alpha, 1);
				assert.equal(u.focus.prox, -1);
				assert.equal(u.series[1]._focus, null);
			}
			plots[0].setCursor({left: -10, top: -10});
			assert.equal(plots[0].cursor.idxs[1], null);
			assert.equal(plots[1].cursor.idxs[1], 0);
			plots[0].destroy();
			plots[1].redraw(true);
			await tick();
			assert.equal(plots[1].cursor.idxs[1], 0, 'destroying one chart does not clear the other index');
		}
		finally { plots.forEach(u => u.destroy()); }
		assert.deepEqual(calls, [['init', 25], ['init', 75], ['destroy', 25], ['destroy', 75]]);
	});

});

describe('scatter demo bubbles', () => {
	let demo;
	afterEach(() => { demo?.destroy(); demo = null; });
	async function plot(...args) {
		demo = createDemo(...args);
		await tick();
		return demo.u;
	}

	it('colors 300 points from the third level facet in a single series', async () => {
		await plot(undefined, {levels: true});
		const u = demo.levelPlot;
		const level = u.data[1][2];
		assert.equal(u.series.length, 2);
		assert.deepEqual(u.data[1].map(values => values.length), [300, 300, 300]);
		assert.deepEqual([0, 1, 2].map(value => level.filter(v => v == value).length), [265, 25, 10]);
		assert.equal(u.series[1]._paths, null, 'no connecting line');

		const start = u.ctx.log.length;
		u.redraw(true);
		await tick();
		const events = ops(u.ctx.log.slice(start));
		const fills = events.filter(e => e.name == 'fill');
		assert.equal(fills.length, 3, 'one fill per level color');
		assert.deepEqual(events.filter(e => e.name == 'fillStyle').map(e => e.args), ['green', 'orange', 'red']);
		const arcs = fills.map(e => ops(e.args[0].log).filter(e => e.name == 'arc'));
		assert.deepEqual(arcs.map(group => group.length), [265, 25, 10]);
		assert.ok(arcs.flat().every(e => e.args[2] === 5));
		for (const i of [0, 265, 290]) {
			assert.deepEqual(u.series[1].values(u, 1, i), {
				x: u.data[1][0][i], y: u.data[1][1][i], level: level[i],
			});
		}
	});

	it('toggles level point shapes and refreshes stationary corner hover', async () => {
		await plot(undefined, {levels: true});
		const u = demo.levelPlot;
		const toggle = demo.shapeToggle;
		assert.equal(toggle.type, 'checkbox');
		assert.equal(toggle.checked, false);
		assert.equal(u.root.nextElementSibling, toggle.parentElement, 'control follows the level chart');
		u.setData([null, [[250], [250], [0]]]);
		await tick();
		const data = u.data;
		const cache = u.series[1]._disp;
		const pos = center(u, 1);
		u.setCursor({left: pos.left + 4, top: pos.top + 4});
		await tick();
		assert.equal(u.cursor.idxs[1], null, 'circle excludes bounding-box corner');

		for (const square of [true, false, true]) {
			const start = u.ctx.log.length;
			toggle.checked = square;
			toggle.dispatchEvent(new Event('change', {bubbles: true}));
			await tick();
			assert.equal(u.series[1].points.shape, square ? 2 : 1);
			assert.equal(u.data, data);
			assert.equal(u.series[1]._disp, cache, 'shape change retains cached palette');
			assert.equal(u.cursor.idxs[1], square ? 0 : null, 'redraw refreshes hover without moving the cursor');
			const fills = ops(u.ctx.log.slice(start)).filter(e => e.name == 'fill');
			assert.ok(fills.length > 0);
			for (const fill of fills) {
				const geometry = ops(fill.args[0].log);
				assert.equal(geometry.filter(e => e.name == (square ? 'rect' : 'arc')).length, 1);
				assert.equal(geometry.filter(e => e.name == (square ? 'arc' : 'rect')).length, 0);
			}
		}
	});

	for (const pxRatio of [1, 2]) {
		it(`uses native opaque 5px scatter points through redraw, resize, zoom, and data changes at DPR ${pxRatio}`, async () => {
			const scatterData = [null, ...Array.from({length: 4}, () => [[25, 75], [25, 75]])];
			await plot(undefined, {pxRatio, scatterData});
			const u = demo.scatter;
			const colors = ['red', 'green', 'blue', 'magenta'];
			function checkPoints(count) {
				for (let si = 1; si <= 4; si++) {
					const s = u.series[si];
					assert.equal(s._paths, null, 'no connecting line');
					assert.equal(s.points.width, 0);
					assert.equal(s.points._fill, colors[si - 1]);
					assert.equal(s.points._paths.stroke, null);
					const arcs = ops(s.points._paths.fill.log).filter(e => e.name == 'arc');
					assert.equal(arcs.length, count);
					assert.ok(arcs.every(e => e.args[2] === 2.5 * pxRatio));
				}
			}
			checkPoints(2);
			for (const change of [
				() => u.redraw(true),
				() => u.setSize({width: 500, height: 340}),
				() => u.setScale('x', {min: 10, max: 90}),
				() => u.setScale('y', {min: 10, max: 90}),
			]) {
				const start = u.ctx.log.length;
				change();
				await tick();
				checkPoints(2);
				const fills = ops(u.ctx.log.slice(start)).filter(e => e.name == 'fill');
				assert.equal(fills.length, 4, 'one batched fill per scatter series');
				assert.ok(fills.every(e => e.args[0]?.log), 'native point paths reach the canvas');
			}
			u.setData([null, ...Array.from({length: 4}, () => [[20, 50, 80], [20, 50, 80]])]);
			await tick();
			checkPoints(3);
		});
	}

	for (const pxRatio of [1, 2]) {
		it(`keeps scatter non-live and unindexed while bubble hover works at DPR ${pxRatio}`, async () => {
			const scatterData = [null, ...[20, 40, 60, 80].map(v => [[v], [v]])];
			const bubble = await plot(undefined, {pxRatio, scatterData});
			const scatter = demo.scatter;
			function mouse(u, type, pos = {left: 0, top: 0}) {
				u.over.getBoundingClientRect = () => new DOMRect(101, 203, u.bbox.width / pxRatio, u.bbox.height / pxRatio);
				u.over.dispatchEvent(new MouseEvent(type, {
					bubbles: type == 'mousemove',
					clientX: 101 + pos.left,
					clientY: 203 + pos.top,
				}));
			}
			assert.equal(scatter.legend.live, false);
			assert.equal(demo.indexes.length, 1, 'only the bubble chart allocates a spatial index');
			const index = demo.latest(4);
			mouse(scatter, 'mouseenter');
			for (const si of [1, 2, 3, 4]) {
				mouse(scatter, 'mousemove', center(scatter, si));
				await tick();
				assert.ok(scatter.cursor.idxs.slice(1).every(i => i == null));
				assert.ok(scatter.series.slice(1).every(s => s._focus == null && s.alpha === 1));
			}
			scatter.redraw(true);
			await tick();
			assert.equal(demo.indexes.length, 1, 'scatter redraw does not build an index');
			assert.equal(index.finishes, 0, 'scatter entry does not finish the bubble index');
			assert.equal(index.searches.length, 0);
			mouse(scatter, 'mouseleave');
			mouse(bubble, 'mouseenter');
			mouse(bubble, 'mousemove', center(bubble, 2));
			await tick();
			selected(bubble, 2);
			assert.equal(bubble.cursor.points.size(bubble, 2), 31);
			mouse(bubble, 'mouseleave');
			mouse(scatter, 'mouseenter');
			mouse(scatter, 'mousemove', center(scatter, 1));
			await tick();
			assert.ok(scatter.cursor.idxs.slice(1).every(i => i == null));
			mouse(scatter, 'mouseleave');
			await tick();
			selected(bubble);
		});
	}

	it('formats bubble legend values from the supplied index without a hovered bubble', async () => {
		const u = await plot();
		assert.deepEqual(u.series[2].values(u, 2, 0), {
			Country: 'B', Population: 25, GDP: '$40', Income: '$60',
		});
		u.setCursor(center(u, 1));
		selected(u, 1);
		assert.equal(u.series[2].values(u, 2, 0).Country, 'B');
		assert.equal(u.series[2].values(u, 2, null).Country, '<NUM COUNTRIES>');
	});

	it('allocates data slots but defers finish until entry, once per index', async () => {
		const u = await plot();
		const first = demo.latest(4);
		assert.equal(first.finishes, 0);
		assert.equal(first.searches.length, 0);
		for (const cursor of [{left: 20, top: -1}, {left: -1, top: 20}]) {
			u.setCursor(cursor);
			assert.equal(first.finishes, 0, 'both cursor coordinates must be inside');
			assert.equal(first.searches.length, 0);
		}
		demo.enter();
		demo.enter();
		assert.equal(first.finishes, 1);
		u.setCursor(center(u, 1));
		selected(u, 1);
		u.setCursor({left: -10, top: -10});
		u.redraw(true);
		await tick();
		const second = demo.latest(4);
		assert.notEqual(second, first);
		assert.equal(second.finishes, 0, 'rebuilding outside does not sort the new index');
		assert.equal(second.searches.length, 0);
		demo.enter();
		demo.enter();
		assert.equal(second.finishes, 1);
		assert.equal(first.finishes, 1);
	});

	it('finishes on programmatic hover and refreshes a stationary cursor after inside redraws', async () => {
		const u = await plot(dataFor([[50, -50, 100, 'before']]));
		const cursor = center(u, 1);
		u.setCursor(cursor);
		selected(u, 1);
		assert.equal(demo.latest(1).finishes, 1, 'setCursor does not need a mouseenter event');
		await tick();
		for (const [data, expected] of [
			[dataFor([[85, -50, 100, 'moved']]), null],
			[dataFor([], [[50, 50, 100, 'replacement']]), 2],
		]) {
			const previous = demo.latest(1);
			demo.cursorCalls.length = 0;
			u.setData(data, false);
			u.redraw(true);
			await tick();
			const index = demo.latest(1);
			assert.notEqual(index, previous);
			assert.equal(index.finishes, 1);
			assert.ok(index.searches.length > 0);
			assert.ok(demo.cursorCalls.some(call => call.same && call.fire === false && call.pub === false),
				'draw refreshes hover without publishing cursor events');
			assert.equal(u.cursor.left, cursor.left);
			assert.equal(u.cursor.top, cursor.top);
			selected(u, expected);
		}
	});

	it('rejects rectangle corners outside the true circle and resets the old hover', async () => {
		const u = await plot(dataFor([[50, -50, 100, 'circle']]));
		const index = demo.latest(1);
		const [x0, y0, x1, y1] = index.bounds[0];
		u.setCursor(center(u, 1));
		selected(u, 1);
		u.setCursor({left: (x1 - u.bbox.left) / u.pxRatio - 1, top: (y1 - u.bbox.top) / u.pxRatio - 1});
		selected(u);
		assert.equal(u.cursor.points.size(u, 1), 0);
		assert.equal(index.searches.at(-1).visits.length, 1, 'rectangle hit reaches the circle filter');
		u.setCursor({
			left: ((x0 + x1) / 2 + (x1 - x0) * .49 - u.bbox.left) / u.pxRatio,
			top: ((y0 + y1) / 2 - u.bbox.top) / u.pxRatio,
		});
		selected(u, 1);
	});

	it('prefers smaller circles even when a larger circle has a closer center', async () => {
		const u = await plot(dataFor([[50, -50, 100, 'large']], [[53, 50, 25, 'small']]));
		u.setCursor(center(u, 1));
		selected(u, 2);
		assert.equal(demo.latest(2).searches.at(-1).visits.length, 2);
		close(u.cursor.points.size(u, 2), 31);
	});

	it('prefers the nearest center for equal diameters', async () => {
		const u = await plot(dataFor([[50, -50, 100, 'near A']], [[54, 50, 100, 'near B']]));
		for (const si of [1, 2, 1]) {
			u.setCursor(center(u, si));
			selected(u, si);
			assert.equal(demo.latest(2).searches.at(-1).visits.length, 2);
		}
	});

	it('breaks exact ties by last-added id, not Flatbush traversal order', async () => {
		const u = await plot(dataFor(
			[[50, -50, 100, 'A0'], [50, -50, 100, 'A1']],
			[[50, 50, 100, 'B0'], [50, 50, 100, 'B1']],
		), {nodeSize: 2});
		for (let i = 0; i < 2; i++) {
			u.setCursor(center(u, 1));
			selected(u, 2, 1);
			const visits = demo.latest(4).searches.at(-1).visits;
			assert.equal(visits.length, 4);
			assert.notEqual(visits.at(-1)[0], 3, 'fixture exercises non-insertion traversal order');
			u.redraw(true);
			await tick();
		}
	});

	for (const alpha of [0.3, 1]) {
		it(`maps hover and exact ties after focusing the first series at alpha ${alpha}`, async () => {
			const u = await plot(dataFor(
				[[50, -50, 100, 'A']],
				[[50, 50, 100, 'B']],
				[[20, 20, 100, 'C']],
			), {configure: opts => { opts.cursor = {focus: {alpha, prox: -1}}; }});
			const first = demo.latest(3);
			u.setCursor(center(u, 1));
			selected(u, 2);
			u.setSeries(1, {focus: true});
			await tick();
			const focused = demo.latest(3);
			assert.notEqual(focused, first, 'focus alone rebuilds the index, including at alpha 1');
			assert.deepEqual(focused.bounds, [first.bounds[1], first.bounds[2], first.bounds[0]]);
			selected(u, 1, 0);
			u.setCursor(center(u, 3));
			selected(u, 3);
			u.setCursor(center(u, 1));
			selected(u, 1);
			u.setSeries(null, {focus: true});
			await tick();
			assert.deepEqual(demo.latest(3).bounds, first.bounds);
			selected(u, 2);
		});
	}

	it('maps filtered and missing points with multiple manual focuses and unvisited series', async () => {
		const indices = [3, 1, 0];
		const u = await plot(dataFor(
			[[10, -10, 100, 'disabled'], [30, -30, 100, 'disabled'], [40, -40, 100, 'disabled']],
			[[50, 50, 100, 'last-painted'], [null, 50, 100, 'missing'], [80, 20, 100, 'filtered out'], [50, 50, 100, 'first-painted']],
			[[null, 20, 100, 'missing'], [20, 20, 100, 'C'], [20, null, 100, 'missing tail']],
			[[80, 80, 100, 'D']],
		), {nodeSize: 2, configure: opts => {
			opts.cursor = {focus: {alpha: 1, prox: -1}};
			opts.series[1].points = {show: false};
			opts.series[2].points = {filter: () => indices};
		}});
		u.series[2]._focus = u.series[3]._focus = true;
		u.redraw(true);
		await tick();
		for (let redraw = 0; redraw < 2; redraw++) {
			const index = demo.latest(11);
			assert.deepEqual(index.bounds.map(b => b[2] - b[0]), [61, 61, 0, 61, 0, 0, 61, 0, 0, 0, 0]);
			for (const si of [4, 2, 3]) {
				const di = si == 3 ? 1 : 0;
				u.setCursor(center(u, si, di));
				selected(u, si, di);
			}
			u.setCursor(center(u, 2, 2));
			selected(u);
			u.setCursor(center(u, 1));
			selected(u);
			u.setCursor(center(u, 2));
			selected(u, 2);
			u.redraw(true);
			await tick();
			selected(u, 2);
		}
	});

	it('uses native cached sizes, immediate translucent painting, and a strict plot clip', async () => {
		const u = await plot(dataFor(
			[[50, -50, 100, 'A0'], [50, -50, 25, 'A1']],
			[[50, 50, 100, 'B']],
		));
		const cache = u.series[1]._disp;
		assert.ok(cache instanceof WeakMap, 'native disp.size cache exists');
		for (const si of [1, 2]) {
			assert.equal(u.series[si].points.width, 1);
			assert.equal(u.series[si].points._paths, null, 'native display points paint immediately');
		}
		const first = demo.latest(3);
		assert.deepEqual(first.bounds.map(b => b[2] - b[0]), [61, 31, 61]);
		const start = u.ctx.log.length;
		u.redraw(true);
		await tick();
		const events = ops(u.ctx.log.slice(start));
		const paint = events.filter(e => e.name == 'fill' || e.name == 'stroke');
		assert.deepEqual(paint.map(e => e.name), ['fill', 'stroke', 'fill', 'stroke', 'fill', 'stroke']);
		assert.ok(paint.every(e => e.args.length == 0), 'do not batch overlapping alpha circles into Path2D');
		assert.deepEqual(events.filter(e => e.name == 'fillStyle').map(e => e.args),
			['rgba(255,0,0,0.3)', 'rgba(255,0,0,0.3)', 'rgba(0,255,0,0.3)']);
		assert.deepEqual(events.filter(e => e.name == 'arc').map(e => e.args[2]), [30, 15, 30]);
		const box = [u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height];
		const beforePaint = events.slice(0, events.findIndex(e => e.name == 'arc'));
		assert.ok(beforePaint.some((event, i) => event.name == 'clip' &&
			(event.args[0]?.log ? ops(event.args[0].log) : beforePaint.slice(0, i))
				.some(e => e.name == 'rect' && e.args.every((v, j) => v === box[j]))), 'clip to the plot, not the expanded native point clip');
		u.setSize({width: 500, height: 340});
		await tick();
		assert.equal(u.series[1]._disp, cache);
		assert.notDeepEqual(demo.latest(3).bounds, first.bounds);
		assert.deepEqual(demo.latest(3).bounds.map(b => b[2] - b[0]), [61, 31, 61]);
		u.setData(u.data, false);
		u.redraw(true);
		await tick();
		assert.equal(u.series[1]._disp, cache, 'same data identity retains size values');
		const replacement = u.data.map(region => region?.map(values => values.slice()) ?? null);
		replacement[1][2][1] = 100;
		u.setData(replacement, false);
		u.redraw(true);
		await tick();
		assert.notEqual(u.series[1]._disp, cache);
		assert.deepEqual(demo.latest(3).bounds.map(b => b[2] - b[0]), [61, 61, 61]);
	});

	it('uses a shared native sqrt scale and updates sizes when its domain changes', async () => {
		const u = await plot(dataFor(
			[[50, -50, 100, 'large']],
			[[50, 50, 25, 'small']],
		));
		const scale = u.scales.size;
		assert.equal(scale.distr, 100);
		assert.deepEqual([scale.min, scale.max], [0, 100]);
		assert.equal(scale.bwd(scale.fwd(25)), 25);
		for (const si of [1, 2]) {
			assert.equal(u.series[si].facets[2].scale, 'size');
			close(u.posToVal(u.valToPos(25, 'size'), 'size'), 25);
		}
		const widths = count => demo.latest(count).bounds.map(b => b[2] - b[0]);
		assert.deepEqual(widths(2), [61, 31]);
		const cache = u.series[2]._disp;

		u.setSeries(1, {show: false});
		await tick();
		assert.deepEqual([scale.min, scale.max], [0, 25]);
		assert.deepEqual(widths(1), [61]);
		assert.equal(u.series[2]._disp, cache, 'domain changes reuse raw display values');

		u.setSeries(1, {show: true});
		await tick();
		assert.deepEqual([scale.min, scale.max], [0, 100]);
		assert.deepEqual(widths(2), [61, 31]);

		u.setScale('size', {min: 0, max: 400});
		await tick();
		assert.deepEqual(widths(2), [31, 16]);
		assert.equal(u.series[2]._disp, cache);
		u.setCursor(center(u, 2));
		selected(u, 2);
		close(u.cursor.points.size(u, 2), 16);

		u.setData(dataFor([[50, -50, 400, 'new maximum']], [[50, 50, 100, 'new small']]));
		await tick();
		assert.deepEqual([scale.min, scale.max], [0, 400]);
		assert.deepEqual(widths(2), [61, 31]);
	});

	it('keeps an empty or zero-population size domain finite without drawing zero-size bubbles', async () => {
		const u = await plot(dataFor([[50, -50, 0, 'zero']]));
		assert.deepEqual([u.scales.size.min, u.scales.size.max], [0, 1]);
		assert.deepEqual(demo.latest(1).bounds, [[0, 0, 0, 0]]);
		u.setData(dataFor());
		await tick();
		assert.deepEqual([u.scales.size.min, u.scales.size.max], [0, 1]);
		assert.equal(demo.indexes.length, 1, 'empty data allocates no new index');
	});

	for (const pxRatio of [1, 2]) {
		it(`indexes and hovers visible portions of outside-center bubbles at all edges (DPR ${pxRatio})`, async () => {
			const u = await plot(dataFor([
				[-1, -50, 100, 'left'], [101, -50, 100, 'right'],
				[50, 1, 100, 'top'], [50, -101, 100, 'bottom'],
				[-100, -50, 100, 'far outside'],
			]), {pxRatio});
			const index = demo.latest(5);
			assert.equal(index.finishes, 0);
			assert.deepEqual(index.bounds[4], [0, 0, 0, 0]);
			assert.ok(index.bounds.slice(0, 4).every(b => b[2] - b[0] === 61 * pxRatio));
			for (let di = 0; di < 4; di++) {
				const pos = center(u, 1, di);
				u.setCursor({
					left: Math.max(1, Math.min(u.bbox.width / pxRatio - 1, pos.left)),
					top: Math.max(1, Math.min(u.bbox.height / pxRatio - 1, pos.top)),
				});
				selected(u, 1, di);
			}
			assert.equal(index.finishes, 1);
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 100]);
			assert.deepEqual([u.scales.y2.min, u.scales.y2.max], [-100, 0]);
		});
	}

	it('preserves data indices across placeholder gaps and never selects an empty box at the origin', async () => {
		const u = await plot(dataFor(
			[[null, -50, 100, 'null'], [-100, -50, 100, 'outside window'], [0, 0, 100, 'origin'], [50, -50, 0, 'zero'], [50, -50, 100, 'A4']],
			[[1000, 50, 100, 'outside'], [75, 75, 25, 'B1']],
		), {nodeSize: 2, configure: opts => { opts.padding = [0, 0, 0, 0]; }});
		const index = demo.latest(7);
		for (const id of [0, 1, 3, 5])
			assert.deepEqual(index.bounds[id], [0, 0, 0, 0]);
		u.setCursor({left: 0, top: 0});
		selected(u, 1, 2);
		assert.ok(index.searches.at(-1).visits.some(v => v.slice(1).every(n => n === 0)), 'origin search visits placeholders');
		u.setCursor(center(u, 1, 4));
		selected(u, 1, 4);
		u.setCursor(center(u, 2, 1));
		selected(u, 2, 1);
		u.setSeries(1, {show: false});
		await tick();
		demo.latest(2);
		selected(u, 2, 1);
		u.setCursor({left: 0, top: 0});
		selected(u);
	});

	it('keeps filtered paint order using per-series filter references, with placeholders for skipped entries', async () => {
		const indices = [4, 2, 1, 0];
		const u = await plot(dataFor(
			[[50, -50, 100, 'last-painted'], [null, -50, 100, 'null'], [-100, -50, 100, 'offscreen'], [80, -80, 100, 'filtered out'], [50, -50, 100, 'first-painted']],
			[[75, 75, 100, 'B']],
		), {nodeSize: 2, configure: opts => {
			opts.series[1].points = {filter: () => indices};
		}});
		const index = demo.latest(6);
		for (const id of [1, 2, 4])
			assert.deepEqual(index.bounds[id], [0, 0, 0, 0]);
		u.setCursor(center(u, 1, 0));
		selected(u, 1, 0);
		u.setCursor(center(u, 1, 3));
		selected(u);
		u.setCursor(center(u, 2));
		selected(u, 2);
	});

	it('fills slots for suppressed colors and disabled point rendering without making them hoverable', async () => {
		const plugin = scatterPlugin({hover: true, points: {width: 0}, disp: {
			fill: {values: () => [null, 'red', null]},
		}});
		const u = new uPlot({
			mode: 2, width: 400, height: 300, pxRatio: 1, axes: [],
			scales: {x: {time: false, range: [0, 100]}, y: {range: [0, 100]}},
			series: [null, {}, {points: {show: false}}], plugins: [plugin],
		}, [null, [[25, 50, 75], [25, 50, 75]], [[20], [20]]], document.body);
		try {
			await tick();
			u.setCursor({left: 0, top: 0});
			assert.deepEqual(u.cursor.idxs.slice(1), [null, null]);
			u.setCursor(center(u, 1, 1));
			assert.deepEqual(u.cursor.idxs.slice(1), [1, null]);
			for (const [si, di] of [[1, 0], [1, 2], [2, 0]]) {
				u.setCursor(center(u, si, di));
				assert.deepEqual(u.cursor.idxs.slice(1), [null, null]);
			}
		}
		finally { u.destroy(); }
	});

	it('excludes hidden series and rebuilds when visibility or data changes', async () => {
		const u = await plot();
		u.setCursor(center(u, 1));
		selected(u, 1);
		u.setSeries(1, {show: false});
		await tick();
		demo.latest(3);
		selected(u);
		u.setSeries(1, {show: true});
		await tick();
		demo.latest(4);
		selected(u, 1);
		for (let si = 1; si <= 4; si++) u.setSeries(si, {show: false});
		const count = demo.indexes.length;
		await tick();
		assert.equal(demo.indexes.length, count, 'all-hidden draw creates no index');
		selected(u);
		demo.enter();
		u.setCursor(center(u, 1));
		selected(u);
		u.setData(dataFor([[50, -50, 100, 'new A']]), false);
		u.setSeries(1, {show: true});
		await tick();
		demo.latest(1);
		u.setCursor(center(u, 1));
		selected(u, 1);
	});

	for (const [name, empty, slots] of [
		['empty', () => dataFor(), 0],
		['null coordinates', () => dataFor([[null, -50, 100, 'null x'], [50, null, 100, 'null y']]), 2],
		['offscreen', () => dataFor([[1000, -1000, 100, 'far away']]), 1],
	]) {
		it(`uses empty slots without hover hits for ${name} data`, async () => {
			const u = await plot(empty());
			assert.equal(demo.indexes.length, slots > 0 ? 1 : 0);
			if (slots > 0) {
				assert.deepEqual(demo.latest(slots).bounds, Array.from({length: slots}, () => [0, 0, 0, 0]));
				assert.equal(demo.latest(slots).finishes, 0);
			}
			demo.enter();
			u.setCursor({left: 0, top: 0});
			selected(u);
			u.setCursor({left: 100, top: 100});
			selected(u);
			u.setData(fixture(), false);
			u.redraw(true);
			await tick();
			u.setCursor(center(u, 1));
			selected(u, 1);
			const old = demo.latest(4);
			const count = demo.indexes.length;
			const searches = old.searches.length;
			u.setData(empty(), false);
			u.redraw(true);
			await tick();
			selected(u);
			demo.enter();
			u.setCursor({left: 100, top: 100});
			assert.equal(demo.indexes.length, count + (slots > 0 ? 1 : 0));
			if (slots > 0)
				assert.deepEqual(demo.latest(slots).bounds, Array.from({length: slots}, () => [0, 0, 0, 0]));
			assert.equal(old.searches.length, searches, 'do not search stale bounds after an empty draw');
		});
	}

	for (const pxRatio of [1, 1.5, 2]) {
		it(`uses absolute canvas index bounds and CSS cursor coordinates at DPR ${pxRatio}`, async () => {
			const u = await plot(fixture(), {pxRatio});
			const index = demo.latest(4);
			assert.ok(u.bbox.left > 0 && u.bbox.top > 0, 'exercise nonzero plot offsets');
			assert.equal(u.series[1].facets[1].scale, 'y2');
			for (let si = 1; si <= 4; si++) {
				if (si > 1) assert.equal(u.series[si].facets[1].scale, 'y');
				const cursor = center(u, si);
				const [x0, y0, x1, y1] = index.bounds[si - 1];
				close((x0 + x1) / 2, u.bbox.left + cursor.left * pxRatio);
				close((y0 + y1) / 2, u.bbox.top + cursor.top * pxRatio);
				const diameter = si == 2 ? 31 : 61;
				close(x1 - x0, diameter * pxRatio);
				close(y1 - y0, diameter * pxRatio);
				u.setCursor(cursor);
				selected(u, si);
				close(u.cursor.points.size(u, si), diameter);
				const query = index.searches.at(-1).box;
				close(query[0], u.bbox.left + cursor.left * pxRatio);
				close(query[1], u.bbox.top + cursor.top * pxRatio);
				assert.deepEqual(query.slice(2), query.slice(0, 2));
			}
			u.setCursor({left: 0, top: 0});
			selected(u);
			assert.equal(u.cursor.points.size(u, 4), 0);
			assert.equal(u.cursor.focus.dist(u, 4), Infinity);
			const searches = index.searches.length;
			for (const cursor of [
				{left: -1, top: 0}, {left: 0, top: -1},
				{left: u.bbox.width / pxRatio + 1, top: 0},
				{left: 0, top: u.bbox.height / pxRatio + 1},
			]) {
				u.setCursor(cursor);
				selected(u);
			}
			assert.equal(index.searches.length, searches, 'outside cursors do not query the index');
			assert.equal(index.finishes, 1);
		});
	}

	it('removes the entry listener and cannot finish a pending index after destroy', async () => {
		const u = await plot();
		const index = demo.latest(4);
		assert.equal(index.finishes, 0);
		assert.equal(demo.listeners.length, 1);
		const over = u.over;
		demo.destroy();
		assert.deepEqual(demo.removed, demo.listeners);
		over.dispatchEvent(new MouseEvent('mouseenter'));
		// A retained callback must not resurrect an index whose chart was destroyed.
		for (const listener of demo.listeners) listener.call(over, new MouseEvent('mouseenter'));
		await tick();
		assert.equal(index.finishes, 0);
		assert.equal(index.searches.length, 0);
	});
});
