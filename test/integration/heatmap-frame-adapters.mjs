import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshot1, snapshot2} from '../../demos/data/heatmap-snapshots.js';
import {heatmapCells, heatmapRows} from '../../demos/lib/heatmapFrameAdapters.js';
import {compileHeatmapFields} from '../../demos/lib/heatmapFrame.js';

function resolve(result) {
	const geometry = compileHeatmapFields(result.fields)(result);
	assert.strictEqual(geometry.cells[3], result.data[1].at(-1));
	assert.equal(geometry.xSize, result.xSize);
	return geometry;
}

function frame(fields, values) {
	return {schema: {fields}, data: {values}};
}

function trackReads(column, index) {
	const value = column[index];
	let reads = 0;
	Object.defineProperty(column, index, {get() { reads++; return value; }});
	return () => reads;
}

const categories = frame([
	{name: 'Region', type: 'string'}, {name: 'Warn'}, {name: 'OK'}, {name: 'Unknown'},
], [['north', 'east', 'south', 'west'], [null, 0.125, 0, null], [0, 4.5, 0, 0], [0, 0, null, 0]]);

function cells(values, interval = 125) {
	return frame([{name: 'xMax', config: {interval}}, {name: 'yMin'}, {name: 'yMax'}, {name: 'count'}], values);
}

function timed(times, counts, interval = 250) {
	return frame([{type: 'time', config: {interval}}, {name: 'OK'}], [times, counts]);
}

describe('heatmapCells', () => {
	it('reads the frames from both repository snapshots without changing their signed edges or rates', () => {
		for (const s of [snapshot1, snapshot2]) {
			const before = structuredClone(s);
			const [t, lo, hi, counts] = before.data.values;
			const result = heatmapCells(s);
			for (const i of [1, 2, 3]) assert.strictEqual(result.data[1][i], s.data.values[i]);
			assert.deepEqual(result, {
				data: [null, [t.map(ms => ms / 1000), lo, hi, counts]], xSize: 60,
			});
			assert.deepEqual(s, before);
		}
	});

	it('matches frame fields by name and reuses sparse Y and count columns', () => {
		const f = frame([
			{name: 'count'}, {name: 'yMin'}, {name: 'yLayout'}, {name: 'xMax', config: {interval: 125}}, {name: 'yMax'},
		], [[1/285, 0.5], [-1, 0], [0, 0], [500, 875], [0, 1]]);
		const before = structuredClone(f);
		const result = heatmapCells(f);
		const [count, lo, , times, hi] = f.data.values;
		assert.deepEqual(result, {xSize: 0.125, data: [null, [[0.5, 0.875], lo, hi, count]]});
		assert.notStrictEqual(result.data[1][0], times);
		assert.strictEqual(result.data[1][1], lo);
		assert.strictEqual(result.data[1][2], hi);
		assert.strictEqual(result.data[1][3], count);
		assert.deepEqual(f, before);
	});

	it('exposes known linear bounds without guessing the geometry of unranked cells', () => {
		const input = cells([[500, 875], [-1, 0], [0, 1], [1/285, 0.5]]);
		const r = heatmapCells(input, {linear: true});
		const {cells: canonical, xRange, yRange} = resolve(r);
		assert.deepEqual(xRange, [0.375, 0.875]);
		assert.deepEqual(yRange, [-1, 1]);
		assert.strictEqual(canonical, r.data[1]);
		for (const i of [1, 2, 3]) assert.strictEqual(r.data[1][i], input.data.values[i]);
		input.data.values[2][1] = 2;
		assert.equal(heatmapCells(input).fields, undefined);
		assert.equal(heatmapCells(input, {geometric: true}).fields, undefined);
	});

	it('uses the same ordinal grid for the OTel classic and NHCB fixtures without rounding either rate series', () => {
		const [classic, nhcb] = ['classic', 'nhcb'].map(kind =>
			JSON.parse(readFileSync(new URL(`../../demos/data/heatmap-otel-${kind}.json`, import.meta.url), 'utf8'))[0]);
		const before = structuredClone([classic, nhcb]);
		const rows = heatmapRows(classic);
		const cells = heatmapCells(nhcb, {ordinal: true});
		const labels = ['-Inf', '1', '10', '100', '1000', '10000', '100000', '+Inf'];
		assert.deepEqual(cells.axes, [null, {splits: [0, 1, 2, 3, 4, 5, 6, 7], values: labels, align: -1}]);
		assert.equal(cells.time, true);
		const {xRange, yRange} = resolve(cells);
		assert.deepEqual(xRange, [1779282780, 1779283740]);
		assert.deepEqual(yRange, [0, 7]);
		assert.equal(cells.xSize, 60);
		for (const key of ['fields', 'axes', 'time', 'grid', 'xSize']) assert.deepEqual(rows[key], cells[key]);

		const [xs, lo, hi, counts] = cells.data[1];
		const [ts, lower, upper, rates] = nhcb.data.values;
		assert.strictEqual(counts, rates);
		assert.equal(xs.length, 109);
		assert.deepEqual(xs, ts.map(t => t / 1000));
		assert.deepEqual(lo.map(i => labels[i]), lower.map(v => v === null ? '-Inf' : String(v)));
		assert.deepEqual(hi.map(i => labels[i]), upper.map(v => v === null ? '+Inf' : String(v)));
		assert.deepEqual(rows.data[1].slice(0, 3), [xs, lo, hi]);
		const [times, ...series] = classic.data.values;
		assert.deepEqual(rows.data[1][3], ts.map((t, i) => series[lo[i]][times.indexOf(t)]));
		assert.deepEqual([classic, nhcb], before);
	});

	it('ranks distinct edges, including empty cells, without filling gaps or reordering cells', () => {
		const s = cells([
			[150, 650, 650, 650, 900, 1150], [5, -1.25, 0, 2, -10, 5], [10, 0, 2, 5, -1.25, 10], [0, 1/285, null, 0.125, 2.5, -1],
		]);
		const before = structuredClone(s);
		const r = heatmapCells(s, {ordinal: true});
		assert.deepEqual(r.data, [null, [[0.65, 0.65, 0.9], [1, 3, 0], [2, 4, 1], [1/285, 0.125, 2.5]]]);
		assert.deepEqual(r.axes[1].values, ['-10', '-1.25', '0', '2', '5', '10']);

		const {xRange, yRange} = resolve(r);
		assert.ok(Math.abs(xRange[0] - 0.025) < Number.EPSILON);
		assert.equal(xRange[1], 1.15);
		assert.deepEqual(yRange, [0, 5]);

		assert.deepEqual(s, before);
	});

	it('keeps the positive prefix when compacting ordinal counts and includes the empty final timestamp in the X extent', () => {
		const f = cells([[125, 250, 375, 500, 625], [0, 1, 2, 1, 3], [1, 2, 3, 2, 4], [2, 0.5, 0, 3, null]]);
		const before = structuredClone(f);
		const r = heatmapCells(f, {ordinal: true});
		assert.deepEqual(r.data[1], [[0.125, 0.25, 0.5], [0, 1, 1], [1, 2, 2], [2, 0.5, 3]]);
		assert.deepEqual(r.grid.x.extent, [0.125, 0.625]);
		assert.deepEqual(r.axes[1].values, ['0', '1', '2', '3', '4']);
		assert.deepEqual(f, before);
	});

	it('ranks open and finite bounds without reading the yLayout column', () => {
		const f = frame([{name: 'count'}, {name: 'yLayout'}, {name: 'xMax', config: {interval: 125}}, {name: 'yMax'}, {name: 'yMin'}],
			[[1, 2, 3], [3, 0, 0], [125, 125, 250], [1, null, null], [null, 1, 1]]);
		const reads = trackReads(f.data.values, 1);
		const r = heatmapCells(f, {ordinal: true});
		assert.equal(reads(), 0);
		assert.deepEqual(r.axes[1].values, ['-Inf', '1', '+Inf']);
		assert.deepEqual(r.data[1], [[0.125, 0.125, 0.25], [0, 1, 1], [1, 2, 2], [1, 2, 3]]);
	});

	it('reads the native histogram factor from either signed snapshot', () => {
		for (const s of [snapshot1, snapshot2]) {
			const {factor} = heatmapCells(s, {geometric: true});
			assert.ok(Math.abs(factor - 2 ** (1 / 16)) < 1e-12, `unexpected factor: ${factor}`);
		}
	});

	it('uses the first regular same-sign bucket, not zero or open buckets or a later ratio', () => {
		for (const [lo, hi] of [[2, 6], [-6, -2]]) {
			const f = cells([
				Array.from({length: 8}, (_, i) => (i + 1) * 125),
				[null, -4, -1e-128, -1, 0, 2, lo, 8],
				[-4, 0, 1e-128, 1, 2, null, hi, 16],
				Array(8).fill(1),
			]);
			assert.equal(heatmapCells(f, {geometric: true}).factor, 3);
		}
	});

	it('skips overflowing ratios from finite bounds on either side of zero', () => {
		for (const [lo, hi, nextLo, nextHi] of [[1e-200, 1e200, -6, -2], [-1e200, -1e-200, 2, 6]]) {
			const only = cells([[125], [lo], [hi], [1]]);
			const sparse = cells([[125, 375], [lo, nextLo], [hi, nextHi], [1, 0.5]]);
			assert.deepEqual([only, sparse].map(f => heatmapCells(f, {geometric: true}).factor), [undefined, 3]);
		}
	});

	it('omits the factor without a regular finite interval or with ordinal edges', () => {
		const f = cells([[125, 125, 125, 125], [-Infinity, -1, 0, 1], [-1, 0, 1, Infinity], [1, 1, 1, 1]]);
		assert.equal(heatmapCells(f, {geometric: true}).factor, undefined);
		const ordinal = cells([[125, 125], [1, 2], [2, 4], [1, 1]]);
		assert.equal(heatmapCells(ordinal, {ordinal: true, geometric: true}).factor, undefined);
	});

	it('does not scan Y or count columns on the default 250k-cell path', () => {
		const times = Array.from({length: 250000}, (_, i) => 500 + i * 125);
		const columns = [0, 1, 2].map(v => Array(times.length).fill(v));
		const reads = columns.map(col => trackReads(col, 1));
		const r = heatmapCells(cells([times, ...columns]));
		for (const readCount of reads) assert.equal(readCount(), 0);
		assert.equal(r.data[1][0].length, times.length);
		assert.equal(r.data[1][0].at(-1), times.at(-1) / 1000);
		columns.forEach((col, i) => assert.strictEqual(r.data[1][i+1], col));
	});
});

describe('heatmap X interval', () => {
	for (const kind of ['cells', 'ordinal cells', 'rows']) {
		const rows = kind === 'rows';
		function adapt(times, config) {
			const counts = Array(times.length).fill(1);
			// Distinct adjacent buckets keep repeated cell timestamps valid for ordinal Y.
			const f = rows ? timed(times, counts) : cells([times, counts.map((_, i) => i), counts.map((_, i) => i + 1), counts]);
			if (config === undefined) delete f.schema.fields[0].config;
			else f.schema.fields[0].config = config;
			return rows ? heatmapRows(f) : heatmapCells(f, {ordinal: kind === 'ordinal cells'});
		}

		it(`${kind}: infers the smallest observed step across a leading gap and later gaps`, () => {
			const times = rows ? [125, 3125, 4125, 6125] : [125, 125, 3125, 4125, 4125, 6125];
			for (const config of [undefined, {interval: undefined}]) {
				const r = adapt(times, config);
				assert.equal(r.xSize, 1);
				assert.deepEqual(r.data[1][0], times.map(t => t / 1000));
				if (kind !== 'cells')
					assert.deepEqual(resolve(r).xRange, [-0.875, 6.125]);
			}
		});

		it(`${kind}: needs an explicit interval for a single distinct timestamp`, () => {
			const times = rows ? [125] : [125, 125];
			assert.equal(adapt(times).xSize, Infinity);
			const r = adapt(times, {interval: 250});
			assert.equal(r.xSize, 0.25);
			assert.deepEqual(r.data[1][0], times.map(t => t / 1000));
		});

		it(`${kind}: with an explicit step, reads interior timestamps only for conversion`, () => {
			const times = [125, 1125, 3125, 4125];
			const reads = [1, 2].map(i => trackReads(times, i));
			const r = adapt(times, {interval: 250});
			assert.equal(r.xSize, 0.25);
			assert.deepEqual(r.data[1][0], [0.125, 1.125, 3.125, 4.125]);
			for (const readCount of reads) assert.equal(readCount(), 1);
		});
	}

	for (const name of ['parity', 'parity-zero']) {
		it(`infers the ${name} fixture's interval without a second full timestamp scan`, () => {
			const [f] = JSON.parse(readFileSync(new URL(`../../demos/data/heatmap-${name}.json`, import.meta.url), 'utf8'));
			const x = f.schema.fields.findIndex(field => field.name === 'xMax');
			assert.equal(f.schema.fields[x].config?.interval, undefined);
			const times = f.data.values[x];
			const reads = times.map((_, i) => trackReads(times, i));
			assert.equal(heatmapCells(f, {geometric: true}).xSize, 30);
			assert.ok(reads.reduce((sum, read) => sum + read(), 0) < 2 * times.length);
		});
	}

	it('permits empty default sparse cells with an explicit interval', () => {
		const f = cells([[], [], [], []]);
		assert.deepEqual(heatmapCells(f), {xSize: 0.125, data: [null, [[], [], [], []]]});
	});

	it('ignores time interval metadata on categorical X', () => {
		const f = structuredClone(categories);
		f.schema.fields[0].config = {interval: NaN};
		assert.deepEqual(heatmapRows(f), heatmapRows(categories));
	});
});

describe('heatmapRows', () => {
	it('adapts every populated cell from heatmap-classic.json without differencing cumulative bounds', () => {
		const [f] = JSON.parse(readFileSync(new URL('../../demos/data/heatmap-classic.json', import.meta.url), 'utf8'));
		const result = heatmapRows(f);
		assert.equal(result.xSize, 300);
		const {xRange, yRange} = resolve(result);
		assert.deepEqual(xRange, [1789840200, 1790727900]);
		assert.deepEqual(yRange, [0, 5]);
		assert.equal(result.time, true);
		assert.deepEqual(result.axes, [null, {splits: [0, 1, 2, 3, 4, 5], values: ['-Inf', '1.0', '2.0', '4.0', '8.0', '+Inf'], align: -1}]);
		const [ts, ...series] = f.data.values;
		const [xs, lo, hi, counts] = result.data[1];
		assert.equal(counts.length, 3494);
		for (let i = 0; i < counts.length; i++) {
			assert.ok(i === 0 || xs[i-1] < xs[i] || (xs[i-1] === xs[i] && lo[i-1] < lo[i]));
			assert.equal(hi[i], lo[i] + 1);
			assert.equal(counts[i], series[lo[i]][(xs[i] - ts[0] / 1000) / 300]);
			assert.ok(counts[i] > 0);
		}
	});

	for (const kind of ['ge', 'le']) {
		const edges = ['-Inf', '1.0', '2', '10', '+Inf'];
		const labels = kind === 'le' ? edges.slice(1) : edges.slice(0, -1);
		const f = frame([
			{type: 'string'}, ...labels.map(label => ({name: 'unused', labels: {[kind]: label}})),
		], [['a'], [1.25], [0], [3.25], [2.25]]);

		it(`keeps numerically ordered ${kind} labels and their counts in field order`, () => {
			const before = structuredClone(f);
			const r = heatmapRows(f);
			assert.deepEqual(r.fields, ['x', 'yMin', 'yMax', 'count']);
			assert.deepEqual(r.grid.x, {categories: ['a']});
			assert.deepEqual(r.data, [null, [[0, 0, 0], [0, 2, 3], [1, 3, 4], [1.25, 3.25, 2.25]]]);
			assert.deepEqual(r.axes[1], {splits: [0, 1, 2, 3, 4], align: kind === 'le' ? -1 : 1, values: edges});
			assert.deepEqual(f, before);
		});

		it(`lets display options center or reverse ${kind} tick alignment without reordering rows`, () => {
			const values = ['first', 'empty', 'third', 'last'];
			const centered = heatmapRows(f, {x: {values: ['column']}, y: {align: 0, values}});
			assert.deepEqual(centered.grid, {x: {categories: ['column']}, y: {categories: values}});
			assert.deepEqual(centered.data[1], [[0, 0, 0], [0, 2, 3], [1.25, 3.25, 2.25]]);

			const align = kind === 'le' ? 1 : -1;
			const reversed = heatmapRows(f, {y: {align, values, outerValue: 'outer'}});
			assert.deepEqual(reversed.axes[1], {splits: [0, 1, 2, 3, 4], align,
				values: align === 1 ? [...values, 'outer'] : ['outer', ...values]});
			assert.deepEqual(reversed.data, heatmapRows(f).data);
		});
	}

	it('centers categories in declared order and includes empty columns and rows in the domain', () => {
		const r = heatmapRows(categories);
		const {xRange, yRange} = resolve(r);
		assert.deepEqual(xRange, [-0.5, 3.5]);
		assert.deepEqual(yRange, [-0.5, 2.5]);
		assert.deepEqual(r, {
			fields: ['x', 'y', 'count'],
			data: [null, [[1, 1], [0, 1], [0.125, 4.5]]], xSize: 1,
			grid: {x: {categories: ['north', 'east', 'south', 'west']}, y: {categories: ['Warn', 'OK', 'Unknown']}},
			time: false,
			axes: [null, null],
		});
	});

	it('accepts all edge labels or n labels plus an outer value without moving ordinal cells', () => {
		const options = {x: {align: 1, values: ['N', 'E', 'S', 'W'], outerValue: 'end'}, y: {align: -1, values: [0, 10, 20, 30]}};
		const before = structuredClone(options);
		const r = heatmapRows(categories, options);
		assert.deepEqual(r.axes, [
			{splits: [0, 1, 2, 3, 4], values: ['N', 'E', 'S', 'W', 'end'], align: 1},
			{splits: [0, 1, 2, 3], values: ['0', '10', '20', '30'], align: -1},
		]);
		assert.deepEqual(heatmapRows(categories, {y: {align: -1, outerValue: 'start'}}).axes[1].values, ['start', 'Warn', 'OK', 'Unknown']);
		assert.deepEqual(options, before);
		assert.deepEqual(r.fields, ['xMax', 'yMin', 'yMax', 'count']);
		assert.equal(r.time, false);
		assert.deepEqual(resolve(r).xRange, [0, 4]);
		assert.deepEqual(r.data, [null, [[2, 2], [0, 1], [1, 2], [0.125, 4.5]]]);
	});

	it('shifts time anchors to right edges and retains empty endpoints and skipped intervals', () => {
		const f = timed([125, 375, 1125], [null, 0.125, 0]);
		for (const [align, range, right] of [[-1, [-0.125, 1.125], 0.375], [0, [0, 1.25], 0.5], [1, [0.125, 1.375], 0.625]]) {
			const r = heatmapRows(f, {x: {align}});
			assert.equal(r.xSize, 0.25);
			assert.equal(r.axes[0], null);
			assert.equal(r.time, true);
			assert.deepEqual(resolve(r).xRange, range);
			assert.deepEqual(r.fields, ['xMax', 'y', 'count']);
			assert.deepEqual(r.grid.y, {categories: ['OK']});
			assert.deepEqual(r.data, [null, [[right], [0], [0.125]]]);
		}
		assert.deepEqual(heatmapRows(f), heatmapRows(f, {x: {align: -1}}));
		const empty = heatmapRows(timed([125, 375], [0, null]));
		assert.deepEqual(empty.data, [null, [[], [], []]]);
		const {xRange, yRange} = resolve(empty);
		assert.deepEqual(xRange, [-0.125, 0.375]);
		assert.deepEqual(yRange, [-0.5, 0.5]);

	});

	it('places explicit time labels at source timestamps and both interval edges', () => {
		const f = timed([125, 375], [0, 1]);
		for (const [x, splits, values] of [
			[{align: -1, values: ['A', 'B'], outerValue: 'start'}, [-0.125, 0.125, 0.375], ['start', 'A', 'B']],
			[{align: 0, values: ['A', 'B']}, [0.125, 0.375], ['A', 'B']],
			[{align: 1, values: ['A', 'B'], outerValue: 'end'}, [0.125, 0.375, 0.625], ['A', 'B', 'end']],
			[{align: 1, values: ['A', 'B', 'end']}, [0.125, 0.375, 0.625], ['A', 'B', 'end']],
		]) {
			const {axes, time} = heatmapRows(f, {x});
			assert.deepEqual(axes[0], {align: x.align, splits, values});
			assert.equal(time, true);
		}
	});

	it('places center labels at their timestamps across time gaps', () => {
		const f = timed([125, 625], [1, 1]);
		const values = ['A', 'B'];
		assert.deepEqual(heatmapRows(f, {x: {align: 0, values}}).axes[0], {align: 0, splits: [0.125, 0.625], values});
	});
});
