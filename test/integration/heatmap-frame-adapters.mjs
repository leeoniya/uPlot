import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshot1, snapshot2} from '../../demos/data/heatmap-snapshots.js';
import {heatmapCells, heatmapRows} from '../../demos/lib/heatmapFrameAdapters.js';

function frame(fields, values) {
	return {schema: {fields}, data: {values}};
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
	it('uses the same ordinal grid for the OTel classic and NHCB fixtures without rounding either rate series', () => {
		const [classic, nhcb] = ['classic', 'nhcb'].map(kind =>
			JSON.parse(readFileSync(new URL(`../../demos/data/heatmap-otel-${kind}.json`, import.meta.url), 'utf8'))[0]);
		const before = structuredClone([classic, nhcb]);
		const rows = heatmapRows(classic);
		const cells = heatmapCells(nhcb, {ordinal: true});
		const labels = ['-Inf', '1', '10', '100', '1000', '10000', '100000', '+Inf'];
		assert.deepEqual(cells.axes, [null, {splits: [0, 1, 2, 3, 4, 5, 6, 7], values: labels, align: -1}]);
		assert.deepEqual(cells.scales, {x: {time: true, range: [1779282780, 1779283740]}, y: {range: [0, 7], distr: 1}});
		assert.deepEqual(cells.grid, {y: {distr: 1}});
		assert.equal(cells.xSize, 60);
		for (const key of ['axes', 'scales', 'grid', 'xSize']) assert.deepEqual(rows[key], cells[key]);

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
			[150, 650, 650, 650, 1150], [-10, -1.25, 0, 2, 5], [-1.25, 0, 2, 5, 10], [0, 1/285, null, 0.125, -1],
		]);
		const before = structuredClone(s);
		const r = heatmapCells(s, {ordinal: true});
		assert.deepEqual(r.data, [null, [[0.65, 0.65], [1, 3], [2, 4], [1/285, 0.125]]]);
		assert.deepEqual(r.axes[1].values, ['-10', '-1.25', '0', '2', '5', '10']);
		assert.deepEqual(r.scales.x.range, [0.025, 1.15]);

		assert.deepEqual(s, before);
	});

	it('rejects a bucket split by a physical edge from another column', () => {
		const s = cells([[125, 250], [0, 0], [10, 5], [1, 2]]);
		assert.throws(() => heatmapCells(s, {ordinal: true}), /adjacent/);
	});

	it('rejects descending or off-grid column times, even for empty cells', () => {
		for (const [times, error] of [[[375, 375, 125], /ascending/], [[125, 125, 300], /interval grid/]]) {
			const s = cells([times, [0, 1, 0], [1, 2, 1], [1, 1, 0]]);
			assert.throws(() => heatmapCells(s, {ordinal: true}), error);
		}
	});

	it('rejects duplicate or descending row IDs within a timestamp', () => {
		for (const lo of [[0, 0], [1, 0]]) {
			const s = cells([[125, 125], lo, lo.map(v => v + 1), [1, 1]]);
			assert.throws(() => heatmapCells(s, {ordinal: true}), /ascending row/);
		}
	});

	it('rejects layouts that cannot use (lo, hi] hover text', () => {
		for (const [layout, lower] of [[3, 0], [1, null], [2, 0]]) {
			const f = frame([{name: 'count'}, {name: 'yLayout'}, {name: 'xMax', config: {interval: 125}}, {name: 'yMax'}, {name: 'yMin'}],
				[[1], [layout], [125], [1], [lower]]);
			assert.throws(() => heatmapCells(f, {ordinal: true}), /yLayout/);
		}
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
				Array(8).fill(125),
				[null, -4, -1e-128, -1, 0, 2, lo, 8],
				[-4, 0, 1e-128, 1, 2, null, hi, 16],
				Array(8).fill(1),
			]);
			assert.equal(heatmapCells(f, {geometric: true}).factor, 3);
		}
	});

	it('omits the factor without a regular finite interval or with ordinal edges', () => {
		const f = cells([[125, 125, 125, 125], [-Infinity, -1, 0, 1], [-1, 0, 1, Infinity], [1, 1, 1, 1]]);
		assert.equal(heatmapCells(f, {geometric: true}).factor, undefined);
		const ordinal = cells([[125, 125], [1, 2], [2, 4], [1, 1]]);
		assert.equal(heatmapCells(ordinal, {ordinal: true, geometric: true}).factor, undefined);
	});

	it('does not scan Y or count columns on the default 250k-cell path', () => {
		const times = Array(250000).fill(500);
		const columns = [0, 1, 2].map(v => Array(times.length).fill(v));
		for (const col of columns) Object.defineProperty(col, 0, {get() { assert.fail('unexpected column read'); }});
		const r = heatmapCells(cells([times, ...columns]));
		assert.equal(r.data[1][0].length, times.length);
		assert.equal(r.data[1][0].at(-1), 0.5);
		columns.forEach((col, i) => assert.strictEqual(r.data[1][i+1], col));
	});
});

describe('heatmap X interval', () => {
	for (const kind of ['cells', 'ordinal cells', 'rows']) {
		const rows = kind === 'rows';
		function adapt(times, config) {
			const counts = times.map(() => 1);
			// Distinct adjacent buckets keep repeated cell timestamps valid for ordinal Y.
			const f = rows ? timed(times, counts) : cells([times, times.map((_, i) => i), times.map((_, i) => i + 1), counts]);
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
				if (kind !== 'cells') assert.deepEqual(r.scales.x.range, [-0.875, 6.125]);
			}
		});

		it(`${kind}: rejects insufficient, descending, nonfinite or inconsistent times during inference`, () => {
			for (const times of [[], [125], [125, 125], [125, 2125, 1125], [NaN, 125, 1125], [125, 1125, Infinity], [125, 1125, 2625]])
				assert.throws(() => adapt(times, {interval: undefined}), RangeError, `timestamps: [${times}]`);
			if (rows) assert.throws(() => adapt([125, 1125, 1125, 2125], {interval: undefined}), RangeError);
		});

		it(`${kind}: honors an explicit step even when all observed gaps are larger`, () => {
			assert.equal(adapt([125, 1125, 3125], {interval: 250}).xSize, 0.25);
		});

		it(`${kind}: rejects invalid explicit intervals even when a step could be inferred`, () => {
			for (const interval of [0, NaN, Infinity])
				assert.throws(() => adapt([125, 1125, 2125], {interval}), RangeError, `interval: ${interval}`);
		});
	}

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
		assert.deepEqual(result.grid, {y: {distr: 1}});
		assert.deepEqual(result.scales, {x: {time: true, range: [1789840200, 1790727900]}, y: {range: [0, 5], distr: 1}});
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
		it(`sorts ${kind} bounds numerically and keeps counts attached to their fields`, () => {
			const f = frame([
				{type: 'string'}, ...['10', '-Inf', '2', '+Inf'].map(label => ({name: 'unused', labels: {[kind]: label}})),
			], [['a'], [1.25], [2.25], [3.25], [0]]);
			const before = structuredClone(f);
			const r = heatmapRows(f);
			assert.deepEqual(r.data, [null, [[1, 1, 1], [0, 1, 2], [1, 2, 3], [2.25, 3.25, 1.25]]]);
			assert.deepEqual(r.axes[1], {splits: [0, 1, 2, 3, 4], align: kind === 'le' ? -1 : 1,
				values: kind === 'le' ? ['-Inf', '-Inf', '2', '10', '+Inf'] : ['-Inf', '2', '10', '+Inf', '+Inf']});
			assert.deepEqual(f, before);
		});
	}

	it('centers categories in declared order and includes empty columns and rows in the domain', () => {
		assert.deepEqual(heatmapRows(categories), {
			data: [null, [[2, 2], [0, 1], [1, 2], [0.125, 4.5]]], xSize: 1, grid: {y: {distr: 1}},
			scales: {x: {time: false, range: [0, 4]}, y: {range: [0, 3], distr: 1}},
			axes: [
				{splits: [0.5, 1.5, 2.5, 3.5], values: ['north', 'east', 'south', 'west'], align: 0},
				{splits: [0.5, 1.5, 2.5], values: ['Warn', 'OK', 'Unknown'], align: 0},
			],
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
		assert.deepEqual(r.data, heatmapRows(categories).data);
		assert.throws(() => heatmapRows(categories, {x: {align: -1}}), /outerValue/);
		assert.throws(() => heatmapRows(categories, {y: {values: ['short']}}), /labels/);
		assert.throws(() => heatmapRows(categories, {x: {align: 2}}), /align/);
	});

	it('shifts time anchors to right edges and retains empty endpoints and skipped intervals', () => {
		const f = timed([125, 375, 1125], [null, 0.125, 0]);
		for (const [align, range, right] of [[-1, [-0.125, 1.125], 0.375], [0, [0, 1.25], 0.5], [1, [0.125, 1.375], 0.625]]) {
			const r = heatmapRows(f, {x: {align}});
			assert.equal(r.xSize, 0.25);
			assert.equal(r.axes[0], null);
			assert.deepEqual(r.scales.x, {time: true, range});
			assert.deepEqual(r.data, [null, [[right], [0], [1], [0.125]]]);
		}
		assert.deepEqual(heatmapRows(f), heatmapRows(f, {x: {align: -1}}));
		const empty = heatmapRows(timed([125, 375], [0, null]));
		assert.deepEqual(empty.data, [null, [[], [], [], []]]);
		assert.deepEqual(empty.scales.x.range, [-0.125, 0.375]);
	});

	it('places explicit time labels at source timestamps and both interval edges', () => {
		const f = timed([125, 375], [0, 1]);
		for (const [x, splits, values] of [
			[{align: -1, values: ['A', 'B'], outerValue: 'start'}, [-0.125, 0.125, 0.375], ['start', 'A', 'B']],
			[{align: 0, values: ['A', 'B']}, [0.125, 0.375], ['A', 'B']],
			[{align: 1, values: ['A', 'B'], outerValue: 'end'}, [0.125, 0.375, 0.625], ['A', 'B', 'end']],
			[{align: 1, values: ['A', 'B', 'end']}, [0.125, 0.375, 0.625], ['A', 'B', 'end']],
		]) {
			const {axes, scales} = heatmapRows(f, {x});
			assert.deepEqual(axes[0], {align: x.align, splits, values});
			assert.equal(scales.x.time, true);
		}
		assert.throws(() => heatmapRows(f, {x: {values: ['A', 'B']}}), /outerValue/);
		assert.throws(() => heatmapRows(f, {x: {outerValue: 'start'}}), /edge-aligned x.values/);
	});

	it('accepts center labels across time gaps but rejects ambiguous edge labels', () => {
		const f = timed([125, 625], [1, 1]);
		const values = ['A', 'B'];
		assert.deepEqual(heatmapRows(f, {x: {align: 0, values}}).axes[0], {align: 0, splits: [0.125, 0.625], values});
		assert.throws(() => heatmapRows(f, {x: {values, outerValue: 'start'}}), /contiguous/);
	});

	it('validates the entire declared time grid, even if all counts are zero', () => {
		for (const ts of [[NaN, 250], [0, Infinity], [0, 0], [250, 0], [125, 475]])
			assert.throws(() => heatmapRows(timed(ts, [0, 0])), RangeError);
		for (const interval of [null, 0, -1, Infinity])
			assert.throws(() => heatmapRows(timed([125], [1], interval)), /interval/);
		assert.throws(() => heatmapRows(timed([125, 375], [1])), /equal-length/);
	});
});
