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

function timed(times, counts, interval = 250) {
	return frame([{type: 'time', config: {interval}}, {name: 'OK'}], [times, counts]);
}

describe('heatmapCells', () => {
	it('reads both repository snapshots without changing their signed edges, rates or factor', () => {
		for (const s of [snapshot1, snapshot2]) {
			const before = structuredClone(s);
			const [t, lo, hi, counts] = before.values;
			const result = heatmapCells(s);
			for (const i of [1, 2, 3]) assert.strictEqual(result.data[1][i], s.values[i]);
			assert.deepEqual(result, {
				data: [null, [t.map(ms => ms / 1000), lo, hi, counts]], xSize: 60, factor: before.factor,
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
