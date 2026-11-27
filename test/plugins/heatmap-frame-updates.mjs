import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { heatmapPlugin } from '../../demos/lib/heatmapPlugin.js';
import { paintedEdge } from '../helpers/heatmap-edges.mjs';

const colors = ['navy', 'gold'];
const nextPaint = () => new Promise(requestAnimationFrame);
const exactRange = (u, min, max) => [min, max];

// Freeze every level so an in-place conversion to canonical edges cannot pass an identity check.
function data(xs = [], ys = [], counts = []) {
	return Object.freeze([null, Object.freeze([xs, ys, counts].map(col => Object.freeze(col)))]);
}

function plugin(options = {}) {
	return heatmapPlugin({ fields: ['xMin', 'yMax', 'count'], colors, ...options });
}

async function mount(t, instance, showAxes = false, opts = {}, initialData = null) {
	const host = document.createElement('div');
	document.body.append(host);
	t.after(() => host.remove());
	const u = new uPlot({
		mode: 2, width: 400, height: 252, pxRatio: 1,
		axes: [{ show: showAxes }, { show: showAxes }], legend: { show: false },
		scales: { x: { time: false, range: exactRange }, y: { range: exactRange } },
		series: [{}, {}], plugins: [instance], ...opts,
	}, initialData, host);
	t.after(() => u.destroy());
	await nextPaint();

	const root = u.root, canvas = root.querySelector('canvas');
	const calls = [], setData = u.setData;
	u.setData = (...args) => { calls.push(args[0]); return setData(...args); };
	let updates = 0, draws = 0;
	u.hooks.setData.push(() => updates++);
	u.hooks.draw.push(() => draws++);

	async function apply(frame) {
		const raw = frame.data, before = calls.length, beforeDraw = draws;
		instance.setFrame(frame);
		assert.equal(calls.length, before + 1, 'setData is called once before setFrame returns');
		assert.equal(calls[before], raw);
		assert.equal(u.data, raw);
		await nextPaint();
		assert.equal(calls.length, before + 1, 'no deferred setData');
		assert.equal(updates, before + 1, 'no second update coalesced into the same draw');
		assert.equal(draws, beforeDraw + 1, 'one committed draw');
		assert.equal(u.data, raw);
		assert.equal(root.parentNode, host);
		assert.equal(host.querySelectorAll('canvas').length, 1);
		assert.equal(root.querySelector('canvas'), canvas);
	}

	return { u, apply };
}

function checkScales(u, x, y) {
	for (const [key, expected] of [['x', x], ['y', y]]) {
		const scale = u.scales[key];
		assert.deepEqual(scale.scan(u, key).slice(0, 2), expected, `${key} scanner supplies outer cell edges`);
		assert.deepEqual([scale.min, scale.max], expected, `${key} display range`);
	}
}

function painted(u) {
	const log = u.ctx.log, rectangles = [];
	let color;
	for (const [op, ...entries] of log.slice(log.findLastIndex(e => e[0] === 'clearRect'))) {
		if (op === 'fillStyle') color = entries.at(-1);
		if (op === 'fill') {
			for (const [path] of entries) {
				for (const [cmd, ...rects] of path?.log ?? []) {
					if (cmd === 'rect') rectangles.push(...rects.map(rect => [color, ...rect]));
				}
			}
		}
	}
	return rectangles;
}

function hover(u, x, y) {
	u.setCursor({ left: u.valToPos(x, 'x'), top: u.valToPos(y, 'y') });
	return u.cursor.dataIdx(u, 1);
}

// The oracle uses explicit cell edges in source order, not grid IDs or palette fill order.
function checkCells(u, cells, hovered) {
	const expected = cells.map(([x0, x1, y0, y1, color], id) => {
		assert.equal(hover(u, (x0 + x1) / 2, (y0 + y1) / 2), id);
		assert.equal(hovered.at(-1), id, 'onHover reports the raw source index');
		const left = paintedEdge(u, 'x', x0), top = paintedEdge(u, 'y', y1);
		return [color, left, top, paintedEdge(u, 'x', x1) - left, paintedEdge(u, 'y', y0) - top];
	});
	const order = (a, b) => a[1] - b[1] || a[2] - b[2];
	assert.deepEqual(painted(u).sort(order), expected.sort(order));
}

describe('heatmapPlugin.setFrame on a mounted mode-2 plot', () => {
	it('infers constructor geometry, applies explicit geometry to the same data, then infers fresh bounds', async t => {
		const raw = data([0, 0, 4], [6, 8, 4], [8, 2, 8]);
		const domains = [], hovered = [];
		const { u, apply } = await mount(t, plugin({
			onColorScale: ({ min, max }) => domains.push([min, max]),
			onHover: (u, id) => hovered.push(id),
		}), false, {}, raw);
		assert.equal(u.data, raw);
		checkScales(u, [0, 8], [2, 8]);
		assert.equal(hover(u, 3, 5), 0);
		await apply({ data: raw, grid: { x: { step: 2, extent: [-2, 6] }, y: { step: 1, extent: [3, 9] } } });
		checkScales(u, [-2, 8], [2, 9]);
		assert.deepEqual(domains.at(-1), [2, 8]);
		checkCells(u, [[0, 2, 5, 6, 'gold'], [0, 2, 7, 8, 'navy'], [4, 6, 3, 4, 'gold']], hovered);
		assert.equal(hover(u, 3, 5), null, 'missing column');

		// The raw columns did not change, but neither step nor either full extent carries forward.
		await apply({ data: raw, grid: { x: {}, y: {} } });
		checkScales(u, [0, 8], [2, 8]);
		checkCells(u, [[0, 4, 4, 6, 'gold'], [0, 4, 6, 8, 'navy'], [4, 8, 2, 4, 'gold']], hovered);
		assert.equal(hover(u, 3, 5), 0, 'the former hole is now in source cell 0');

		await apply({ data: data([20, 20, 21], [18, 21, 15], [10, 40, 10]), grid: { x: {}, y: {} } });
		checkScales(u, [20, 22], [12, 21]);
		assert.deepEqual(domains.at(-1), [10, 40]);
		checkCells(u, [[20, 21, 15, 18, 'navy'], [20, 21, 18, 21, 'gold'], [21, 22, 12, 15, 'navy']], hovered);
	});

	it('paints two occupied cells on opposite corners of a 4096 × 4096 grid', async t => {
		const instance = plugin({ fields: ['xMax', 'yMin', 'yMax', 'count'] });
		const { u, apply } = await mount(t, instance);

		await apply({ data: [null, [[1, 4096], [0, 4095], [1, 4096], [1, 2]]], grid: { x: { step: 1 } } });
		assert.equal(painted(u).length, 2);
	});

	it('clears painted cells, hover and color domain on empty, and accepts another frame', async t => {
		const hovered = [], domains = [];
		const { u, apply } = await mount(t, plugin({
			onColorScale: ({ min, max }) => domains.push([min, max]),
			onHover: (u, id) => hovered.push(id),
		}));
		const frame = { data: data([2], [6], [5]), grid: { x: { step: 2 }, y: { step: 1 } } };
		await apply(frame);
		checkCells(u, [[2, 4, 5, 6, 'navy']], hovered);
		await apply({ data: data(), grid: { x: {}, y: {} } });
		assert.deepEqual(painted(u), []);
		assert.equal(u.cursor.dataIdx(u, 1), null);
		assert.equal(hovered.at(-1), null);
		assert.deepEqual(domains.at(-1), [0, 0]);
		await apply(frame);
		checkCells(u, [[2, 4, 5, 6, 'navy']], hovered);
		assert.deepEqual(domains.at(-1), [5, 5]);
	});

	it('labels numeric ordinal centers, including categories with no cells', async t => {
		const { u, apply } = await mount(t, plugin({ fields: ['x', 'y', 'count'] }), true);
		const raw = data([0, 2], [1, 0], [4, 9]);
		for (const [xs, ys] of [
			[['East', 'West', 'North'], ['Open', 'Closed']],
			[['East', 'South', 'North'], ['Up', 'Down']], // Same bounds, different labels.
			[['Mon', 'Tue', 'Wed', 'Thu'], ['Low', 'Mid', 'High']],
		]) {
			await apply({ data: raw, grid: { x: { categories: xs }, y: { categories: ys } } });
			checkScales(u, [-.5, xs.length - .5], [-.5, ys.length - .5]);
			for (const [i, labels] of [xs, ys].entries()) {
				assert.deepEqual(u.axes[i]._splits, labels.map((_, j) => j));
				assert.deepEqual(u.axes[i]._values, labels);
			}
			assert.equal(hover(u, 0, 1), 0);
			assert.equal(hover(u, 1, 0), null);
			assert.equal(hover(u, 2, 0), 1);
		}
		await apply({data: raw, grid: {x: {step: 1}, y: {step: 1}}});
		checkScales(u, [-.5, 2.5], [-.5, 1.5]);
		assert.ok(u.axes.every(axis => axis._values.every(label => label !== '' && Number.isFinite(+label))));
	});

	for (const [x, y, xs, ys] of [
		['xMin', 'y', [10, 10, 14], [0, 4, 2]],
		['x', 'yMin', [11, 11, 15], [-1, 3, 1]],
		['x', 'yMax', [11, 11, 15], [1, 5, 3]],
	]) {
		it(`paints and hits sparse typed ${x}/${y} cells in source order`, async t => {
			const hovered = [];
			const {u, apply} = await mount(t, plugin({fields: ['count', y, x], onHover: (u, i) => hovered.push(i)}));
			const raw = [null, [Float32Array.of(.5, 2, .5), Int8Array.from(ys), Uint8Array.from(xs)]];
			await apply({data: raw, grid: {x: {step: 2}}});
			checkScales(u, [10, 16], [-1, 5]);
			checkCells(u, [[10, 12, -1, 1, 'navy'], [10, 12, 3, 5, 'gold'], [14, 16, 1, 3, 'navy']], hovered);
			assert.equal(hover(u, 11, 2), null, 'missing row');
			assert.equal(hover(u, 13, 2), null, 'missing column');
		});
	}

	it('draws and hovers reordered source columns without treating counts as coordinates', async t => {
		const hovered = [], domains = [];
		const fields = ['count', 'yMax', 'xMin', 'yMin'];
		const instance = plugin({fields,
			onHover: (u, i) => hovered.push(i), onColorScale: ({min, max}) => domains.push([min, max]),
		});
		fields.splice(0, fields.length, 'x', 'y', 'count'); // Reuse the caller's list after compilation.
		const {u, apply} = await mount(t, instance);
		assert.deepEqual(u.data[1], [[], [], [], []], 'null initial data uses the compiled schema');
		await apply({data: [null, [[9, 2], [6, 4], [20, 24], [4, 2]]]});
		checkScales(u, [20, 28], [2, 6]);
		assert.deepEqual(domains.at(-1), [2, 9]);
		checkCells(u, [[20, 24, 4, 6, 'gold'], [24, 28, 2, 4, 'navy']], hovered);
	});

	it('respects custom scans, ranges and axis labels', async t => {
		const {u, apply} = await mount(t, plugin({fields: ['x', 'y', 'count']}), true, {
			scales: {x: {scan: () => [-1, 3], range: exactRange}, y: {range: [0, 4]}},
			axes: [{splits: [0, 2], values: (u, ticks) => ticks.map(v => `x${v}`)}, {}],
		});
		await apply({data: data([0], [0], [4]), grid: {x: {categories: ['A', 'B', 'C']}, y: {step: 1}}});
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [-1, 3]);
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [0, 4]);
		assert.deepEqual(u.axes[0]._splits, [0, 2]);
		assert.deepEqual(u.axes[0]._values, ['x0', 'x2']);
	});
});

it('uses the legacy linear X and log Y defaults with a null plugin grid', async t => {
	const hovered = [];
	const legacy = heatmapPlugin({xSize: 2, grid: null, colors, onHover: (u, i) => hovered.push(i)});
	assert.equal(legacy.setFrame, undefined);
	const {u} = await mount(t, legacy, false, {
		data: [null, [[], [], [], []]], scales: {x: {time: false, range: [0, 4]}, y: {range: [1, 8]}},
	});
	u.setData([null, [[2, 4, 4], [4, 1, 2], [8, 2, 4], [1, 1, 4]]]);
	await nextPaint();
	checkCells(u, [[0, 2, 4, 8, 'navy'], [2, 4, 1, 2, 'navy'], [2, 4, 2, 4, 'gold']], hovered);
});
