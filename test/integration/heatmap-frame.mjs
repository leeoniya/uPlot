import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {aggregateHeatmap} from '../../demos/lib/heatmapAggregation.js';
import {compileHeatmapFields} from '../../demos/lib/heatmapFrame.js';

const frame = (columns, grid) => ({data: [null, columns], grid});
const canonical = compileHeatmapFields(['xMax', 'yMin', 'yMax', 'count']);
const centers = compileHeatmapFields(['x', 'y', 'count']);
const unit = {x: {step: 1}, y: {step: 1}};
const empty = [[], [], []];

describe('compileHeatmapFields', () => {
	it('compiles field order once without carrying geometry between frames', () => {
		const fields = ['count', 'yMax', 'xMin'];
		const resolve = compileHeatmapFields(fields);
		fields.reverse();
		fields.pop();
		const input = [[0.125, 2], [5, 5], [10, 12]].map(c => Object.freeze(c));
		const f = frame(Object.freeze(input), {y: {step: 3}});
		const a = resolve(f);
		assert.deepEqual(a.cells.map(c => [...c]), [[12, 14], [2, 2], [5, 5], [0.125, 2]]);
		assert.equal(a.cells[2], input[1]);
		assert.equal(a.cells[3], input[0]);
		assert.equal(a.xSize, 2);

		assert.equal(resolve(frame([[1], [5], [10]], unit)).xSize, 1);
		assert.deepEqual(resolve(f), a);
	});
});

describe('linear heatmap frame geometry', () => {
	it('returns the canonical tuple itself and preserves typed column views under permutation', () => {
		const xs = new Float64Array([100, 12, 12, 16, 999]).subarray(1, 4);
		const lo = new Int8Array([-2, 4, 0]), hi = new Int8Array([0, 6, 2]);
		const counts = new Uint32Array([1, 7, 3]);
		const columns = [xs, lo, hi, counts];
		const grid = {x: {step: 2, extent: [8, 18]}, y: {extent: [-4, 8]}};
		const a = canonical(frame(columns, grid));
		assert.equal(a.cells, columns);
		assert.deepEqual(a, {cells: columns, xSize: 2, ySize: 2, xRange: [6, 18], yRange: [-4, 8]});
		const permuted = compileHeatmapFields(['yMax', 'xMax', 'count', 'yMin']);
		const b = permuted(frame([hi, xs, counts, lo], grid));
		columns.forEach((c, i) => assert.equal(b.cells[i], c));
	});

	for (const withExtents of [true, false]) {
		const reads = withExtents ? 'only outer Y endpoints' : 'only Y endpoints of X runs';
		it(`reads no counts and ${reads} ${withExtents ? 'with' : 'without'} declared extents`, () => {
			const xs = [2, 2, 2, 6, 6, 6, 8, 8, 8];
			const lo = [2, 4, 8, 0, 6, 12, -4, 0, 2];
			const hi = lo.map(v => v + 2), counts = xs.map(() => 1);
			const columns = [xs, lo, hi, counts];
			const endpoints = withExtents ? [0, 8] : [0, 2, 3, 5, 6, 8];
			for (const [name, column, allowed] of [['yMin', lo, endpoints], ['yMax', hi, endpoints], ['count', counts, []]]) {
				for (let i = 0; i < column.length; i++) {
					if (!allowed.includes(i))
						Object.defineProperty(column, i, {get() { assert.fail(`unexpected read of ${name}[${i}]`); }});
				}
			}
			const grid = withExtents ? {x: {step: 2, extent: [0, 10]}, y: {extent: [-6, 18]}} : {x: {step: 2}};
			const a = canonical(frame(columns, grid));
			assert.equal(a.cells, columns);
			assert.equal(a.xSize, 2);
			assert.equal(a.ySize, 2);
			assert.deepEqual(a.xRange, withExtents ? [-2, 10] : [0, 8]);
			assert.deepEqual(a.yRange, withExtents ? [-6, 18] : [-4, 14]);
		});
	}

	it('converts all anchor orientations; a one-anchor extent includes both endpoint anchors', () => {
		for (const [suffix, low, high] of [['Min', 0, 4], ['Max', -4, 0], ['', -2, 2]]) {
			const resolve = compileHeatmapFields(['x' + suffix, 'y' + suffix, 'count']);
			const meta = {step: 4, extent: [-4, 8]};
			const src = [new Int8Array([0]), new Int8Array([0]), [0.5]];
			const a = resolve(frame(src, {x: meta, y: meta}));
			assert.deepEqual(a.cells.map(c => [...c]), [[high], [low], [high], [0.5]]);
			assert.deepEqual(a.xRange, [-4 + low, 8 + high]);
			assert.deepEqual(a.yRange, a.xRange);
			assert.equal(a.xSize, 4);
			if (suffix === 'Max') assert.equal(a.cells[0], src[0]);
			if (suffix === 'Min') assert.equal(a.cells[1], src[1]);
		}
	});

	it('resolves the same sparse typed cells from each independent X and Y anchor combination', () => {
		const src = {
			xMin: Uint8Array.of(246, 246, 252, 255), x: Float32Array.of(247.5, 247.5, 253.5, 256.5),
			xMax: Uint16Array.of(249, 249, 255, 258),
			yMin: Int8Array.of(-2, 2, 0, -2), y: Int8Array.of(-1, 3, 1, -1), yMax: Int8Array.of(0, 4, 2, 0),
			count: Float32Array.of(.5, 2, 3, .25),
		};
		const edges = ['xMax', 'yMin', 'yMax', 'count'];
		const variants = axis => [[axis], [axis + 'Min'], [axis + 'Max'], [axis + 'Min', axis + 'Max']];
		for (const x of variants('x')) {
			for (const y of variants('y')) {
				const fields = ['count', ...y, ...x];
				const a = compileHeatmapFields(fields)(frame(fields.map(f => src[f])));
				assert.deepEqual([a.xSize, a.ySize, a.xRange, a.yRange], [3, 2, [246, 258], [-2, 4]], fields.join(', '));
				edges.forEach((f, i) => {
					if (fields.includes(f)) assert.equal(a.cells[i], src[f]);
					else assert.deepEqual([...a.cells[i]], [...src[f]], `${fields.join(', ')} → ${f}`);
				});
			}
		}
	});

	it('infers a single cell from paired bounds, without adding an extra bin to the extent', () => {
		const resolve = compileHeatmapFields(['yMin', 'xMin', 'count', 'yMax', 'xMax']);
		const columns = [[1], [-5], [8], [4], [-3]];
		const a = resolve(frame(columns, {x: {extent: [-9, 1]}}));
		assert.deepEqual(a, {xSize: 2, ySize: 3, xRange: [-9, 1], yRange: [1, 4], cells: [[-3], [1], [4], [8]]});
		assert.equal(a.cells[0], columns[4]);
	});

	it('infers the smallest distinct gap even when the closest Y anchors are interior to different sparse runs', () => {
		const xs = [0, 0, 0, 9, 9, 9, 12, 12, 12];
		const ys = [0, 8, 24, 0, 10, 24, 4, 16, 24];
		const a = centers(frame([xs, ys, Array(xs.length).fill(1)]));
		assert.equal(a.xSize, 3);
		assert.equal(a.ySize, 2);
		assert.deepEqual(a.xRange, [-1.5, 13.5]);
		assert.deepEqual(a.yRange, [-1, 25]);
		assert.deepEqual([...a.cells[1]], ys.map(y => y - 1));
	});

	it('uses the entire category order, including absent edge labels; indices need not be contiguous', () => {
		const labels = Object.freeze(['z', 'c', 'a', 'b']);
		const a = centers(frame([[1, 1], [0, 2], [2, 3]], {x: {categories: labels}, y: {categories: labels}}));
		assert.deepEqual(a.xRange, [-0.5, 3.5]);
		assert.deepEqual(a.yRange, a.xRange);
		assert.equal(a.xSize, 1);
		assert.deepEqual(a.cells.map(c => [...c]), [[1.5, 1.5], [-0.5, 1.5], [0.5, 2.5], [2, 3]]);
	});

	it('resolves empty domains independently, honoring metadata without inventing observed anchors', () => {
		const columns = [[], [], [], []];
		assert.deepEqual(canonical(frame(columns)), {cells: columns, xSize: 1, ySize: 1, xRange: [null, null], yRange: [null, null]});
		const a = canonical(frame(columns, {x: {step: 5}, y: {extent: [-3, 0]}}));
		assert.equal(a.xSize, 5);
		assert.deepEqual(a.xRange, [null, null]);
		assert.deepEqual(a.yRange, [-3, 0]);
		const b = centers(frame(empty, {x: {extent: [3, 3], step: 2}, y: {categories: ['only']}}));
		assert.deepEqual(b.xRange, [2, 4]);
		assert.deepEqual(b.yRange, [-0.5, 0.5]);
		assert.deepEqual(centers(frame(empty, {x: {categories: []}})).xRange, [null, null]);
		const max = 2 ** 24;
		assert.deepEqual(centers(frame(empty, {x: {step: 1, extent: [0, max - 1]}})).xRange, [-0.5, max - 0.5]);
	});

	it('accepts fractional aggregateHeatmap bounds and does not copy them', () => {
		const xs = [], ys = [];
		for (let i = 0; i <= 500; i++) {
			xs.push(1234.5 + i / 47);
			ys.push(-123.45 + i / 31);
		}
		const agg = aggregateHeatmap(xs, ys, 173, 259);
		for (const grid of [undefined, {x: {step: agg.xSize, extent: [agg.data[1][0][0], agg.xRange[1]]}, y: {extent: agg.yRange}}]) {
			const a = canonical(frame(agg.data[1], grid));
			assert.equal(a.cells, agg.data[1]);
			assert.ok(Math.abs(a.xSize - agg.xSize) < 1e-12);
			assert.ok(Math.abs(a.xRange[0] - agg.xRange[0]) < 1e-12);
			assert.equal(a.xRange[1], agg.xRange[1]);
			assert.deepEqual(a.yRange, agg.yRange);
		}
	});

	it('does not accumulate a rounded local width across many bins at a large offset', () => {
		const v = Array.from({length: 2048}, (_, i) => 1.7e12 + 6.54321 * i / 2047);
		const agg = aggregateHeatmap(v, v, 1024, 1024);
		for (const f of [agg, {data: agg.data}]) {
			const a = canonical(f);
			assert.equal(a.cells, agg.data[1]);
			assert.ok(Math.abs(a.xSize - agg.xSize) < 1e-6);
			assert.ok(Math.abs(a.ySize - agg.xSize) < 1e-6);
			assert.deepEqual(a.yRange, agg.yRange);
		}
	});

	it('refines a rounded measured width using distant unoccupied extent edges', () => {
		const resolve = compileHeatmapFields(['xMin', 'xMax', 'yMin', 'yMax', 'count']);
		const grid = {x: {extent: [1e12, 1e12 + 100]}};
		const a = resolve(frame([[1e12], [1e12 + 0.1], [0], [1], [2]], grid));
		assert.equal(a.xSize, 0.1);
		assert.deepEqual(a.xRange, grid.x.extent);
	});

	it('accepts single-precision inputs and double-precision roundoff near epoch-sized coordinates', () => {
		const xs = Float32Array.of(0.1, 0.2, 0.3), ys = [1e12 + 0.1, 1e12 + 0.2, 1e12 + 0.3];
		const a = centers(frame([xs, ys, [1, 2, 3]], {x: {step: 0.1}, y: {step: 0.1}}));
		assert.equal(a.xSize, 0.1);
		assert.deepEqual(a.yRange, [ys[0] - 0.05, ys[2] + 0.05]);
	});
});
