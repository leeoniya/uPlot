import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';

const data = [
	[0, 1, 2, 3, 4, 5, 6, 7],
	[13, 24, 51, 38, 87, 65, 42, 72],
	[6500, 8700, 4300, 1300, 3100, 7200, 5600, 2200],
	[-8, -6, -9, -4, -2, -7, -5, -3],
];
const full = [[13, 87], [1300, 8700], [-9, -2]];
const flat = [[38, 38], [1300, 1300], [-4, -4]];
const heights = [[40, 1], [50, 2], [125, 3], [333, 7], [413, 8], [525, 10], [1000, 20]];
const bounds = (u, key) => [u.scales[key].min, u.scales[key].max];
const allBounds = (u, keys) => keys.map(key => bounds(u, key));
const cssHeight = u => u.bbox.height / u.pxRatio;

function makePlot({ count = 2, pxRatio = 1, opposite = false, plotData, shared = false, aggregates = {} } = {}) {
	const keys = ['y', 'right', 'third'].slice(0, count);
	const scans = [];
	const values = [];
	const sizes = [];
	const events = [];
	const scales = { x: { time: false } };
	const axes = [{ show: false }];
	const series = [{}];

	keys.forEach((key, i) => {
		scales[key] = {
			axis: i + 1, time: false, ori: 1, distr: 1,
			dir: opposite && i % 2 == 1 ? -1 : 1,
			scan(u, key, i0, i1) {
				const raw = uPlot.scan(u, key, i0, i1, true);
				const extrema = aggregates[key] ?? raw;
				scans.push({ key, i0, i1, extrema: extrema.slice() });
				return extrema;
			},
		};
		axes.push({
			scale: key, side: i % 2 == 0 ? 3 : 1,
			values(u, ticks) {
				values.push({ key, ticks: ticks.slice(), bounds: allBounds(u, keys), height: cssHeight(u) });
				return ticks.map(value => value == null ? '' : String(value));
			},
			size(u, labels) {
				sizes.push({ key, labels: labels?.slice(), bounds: allBounds(u, keys), height: cssHeight(u) });
				return 60;
			},
		});
		series.push({ scale: key, stroke: ['blue', 'red', 'green'][i], points: { show: false } });
	});

	plotData ??= data.slice(0, count + 1).map(values => values.slice());
	if (shared) {
		series.push({ scale: 'y', stroke: 'purple', points: { show: false } });
		plotData = [...plotData, [113, 124, 151, 138, 187, 165, 142, 172]];
	}

	const u = new uPlot({
		width: 700, height: 413, pxRatio, mode: 1, padding: [0, 0, 0, 0],
		cursor: { show: false }, legend: { show: false },
		scales, axes, series,
		hooks: { setScale: [(u, key) => {
			if (keys.includes(key))
				events.push({ key, bounds: allBounds(u, keys), splits: keys.map((_, i) => u.axes[i + 1]._splits?.slice() ?? []), height: cssHeight(u) });
		}] },
	}, plotData, document.body);

	return {
		u, keys, scans, values, sizes, events,
		clear() { scans.length = values.length = sizes.length = events.length = 0; },
	};
}

function assertScans(f, keys, extrema, window) {
	assert.deepEqual(f.scans.map(scan => scan.key).sort(), keys.slice().sort(), 'exactly one scan per required scale');
	for (const scan of f.scans) {
		assert.deepEqual(scan.extrema, extrema[f.keys.indexOf(scan.key)], `${scan.key}: scanned aggregate`);
		if (window != null)
			assert.deepEqual([scan.i0, scan.i1], window, `${scan.key}: scan window`);
	}
}

function assertLayout(f, extrema, height = cssHeight(f.u)) {
	const { u, keys, values, sizes } = f;
	assert.equal(cssHeight(u), height);
	const visible = keys.filter((_, i) => extrema[i][0] != null);
	assert.deepEqual(values.map(call => call.key).sort(), visible.slice().sort(), 'one values call per visible Y axis');
	assert.deepEqual(sizes.map(call => call.key).sort(), visible.slice().sort(), 'one size call per visible Y axis');

	let aligned;
	keys.forEach((key, i) => {
		const expected = rangeY(...extrema[i], height);
		assert.ok(expected, `${key}: supported fixture`);
		assert.deepEqual(bounds(u, key), [expected.min, expected.max], `${key}: final range`);
		const axis = u.axes[i + 1];
		const ticks = axis._splits ?? [];
		if (expected.count == 0) {
			assert.equal(axis._show, false);
			assert.deepEqual(ticks, []);
			return;
		}

		assert.equal(axis._show, true);
		assert.equal(ticks.length, expected.count + 1, `${key}: interval count`);
		assert.deepEqual([ticks[0], ticks.at(-1)], bounds(u, key), `${key}: endpoint ticks`);
		const positions = ticks.map((value, j) => {
			assert.ok(Math.abs(value - (expected.min + j * expected.incr)) < 1e-8, `${key}: tick increment`);
			const pos = u.valToPos(value, key);
			const expectedPos = height * (u.scales[key].dir == 1 ? 1 - j / expected.count : j / expected.count);
			assert.ok(Math.abs(pos - expectedPos) < 1e-8, `${key}: CSS tick position ${j}`);
			assert.ok(Math.abs(u.valToPos(value, key, true) - (u.bbox.top + pos * u.pxRatio)) < 1e-8,
				`${key}: canvas tick position ${j}`);
			return pos;
		}).sort((a, b) => a - b);
		if (aligned != null) {
			assert.equal(positions.length, aligned.length, 'independent axes have matching tick counts');
			positions.forEach((pos, j) => assert.ok(Math.abs(pos - aligned[j]) < 1e-8, 'independent axes align geometrically'));
		}
		aligned = positions;
		assert.deepEqual(values.find(call => call.key == key).ticks, ticks);
		assert.deepEqual(sizes.find(call => call.key == key).labels, axis._values);
	});

	for (const call of [...values, ...sizes]) {
		assert.equal(call.height, height, 'callbacks use final CSS height');
		assert.deepEqual(call.bounds, allBounds(u, keys), 'callbacks see every participating Y range finalized');
	}
}

function assertLinePath(u, index) {
	const paths = u.series[index]._paths;
	assert.ok(paths?.stroke, `series ${index}: real stroke path`);
	assert.ok(paths.stroke.log.some(([name]) => name == 'lineTo'), `series ${index}: line segments`);
	const clearIndex = u.ctx.log.findLastIndex(([name]) => name == 'clearRect');
	assert.ok(clearIndex >= 0, `series ${index}: render clears the canvas`);
	assert.ok(u.ctx.log.slice(clearIndex + 1).some(([name, ...calls]) => name == 'stroke' && calls.some(args => args[0] === paths.stroke)),
		`series ${index}: stroke drawn in current render`);
	return paths;
}

function assertHooks(f, previous) {
	const current = allBounds(f.u, f.keys);
	const changed = f.keys.filter((_, i) => current[i].some((value, j) => value !== previous[i][j]));
	assert.deepEqual(f.events.map(event => event.key).sort(), changed.slice().sort(), 'one hook only for each changed Y range');
	for (const event of f.events) {
		assert.deepEqual(event.bounds, current, 'each Y hook sees all Y ranges finalized');
		assert.deepEqual(event.splits, f.keys.map((_, i) => f.u.axes[i + 1]._splits ?? []), 'each Y hook sees final ticks');
		assert.equal(event.height, cssHeight(f.u));
	}
}

describe('axis-ranging chart POC: multiple Y scales', () => {
	it('rejects historical strokes when only one retained series is drawn after clearing', async () => {
		const { u, keys } = makePlot();
		try {
			await Promise.resolve();
			const paths = keys.map((_, i) => assertLinePath(u, i + 1));
			// Consecutive clears share one log entry in the DOM instrument.
			u.ctx.clearRect(0, 0, u.ctx.width, u.ctx.height);
			u.ctx.clearRect(0, 0, u.ctx.width, u.ctx.height);
			u.ctx.stroke(paths[0].stroke);
			assert.equal(assertLinePath(u, 1), paths[0]);
			assert.equal(u.series[2]._paths, paths[1]);
			assert.throws(() => assertLinePath(u, 2), /series 2: stroke drawn in current render/);
			u.redraw(false, true);
			await Promise.resolve();
			keys.forEach((_, i) => assert.equal(assertLinePath(u, i + 1), paths[i]));
		}
		finally { u.destroy(); }
	});

	for (const count of [2, 3]) {
		for (const pxRatio of [1, 2]) {
			for (const opposite of [false, true]) {
				it(`aligns ${count} independent axes through X zoom and resize (DPR ${pxRatio}, opposite ${opposite})`, async () => {
					const f = makePlot({ count, pxRatio, opposite });
					const { u, keys } = f;
					try {
						await Promise.resolve();
						assertScans(f, keys, full, [0, 7]);
						assertLayout(f, full, 413);
						keys.forEach((_, i) => assertLinePath(u, i + 1));

						f.clear();
						u.setScale('x', { min: 2.9, max: 3.4 });
						await Promise.resolve();
						assertScans(f, keys, flat, [3, 3]);
						assertLayout(f, flat, 413);
						assert.deepEqual(bounds(u, 'y'), [0, 80]);
						assert.deepEqual(bounds(u, 'right'), [0, 4000]);
						assert.deepEqual(u.axes[1]._splits, [0, 10, 20, 30, 40, 50, 60, 70, 80]);
						assert.deepEqual(u.axes[2]._splits, [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]);

						for (const [height, intervals] of [...heights, [413, 8]]) {
							f.clear();
							u.setSize({ width: 700, height });
							await Promise.resolve();
							assertScans(f, [], flat);
							assertLayout(f, flat, height);
							keys.forEach((_, i) => {
								assert.equal(u.axes[i + 1]._splits.length, intervals + 1);
								assert.deepEqual([u.series[i + 1].min, u.series[i + 1].max], flat[i]);
								assertLinePath(u, i + 1);
							});
						}

						const paths = keys.map((_, i) => u.series[i + 1]._paths);
						f.clear();
						u.redraw(false, true);
						await Promise.resolve();
						assertScans(f, [], flat);
						assertLayout(f, flat);
						keys.forEach((_, i) => assert.equal(assertLinePath(u, i + 1), paths[i], 'axis-only redraw reuses paths'));

						f.clear();
						u.setScale('x', { min: null, max: null });
						await Promise.resolve();
						assertScans(f, keys, full, [0, 7]);
						assertLayout(f, full);
						assert.deepEqual(u.data, data.slice(0, count + 1), 'ranging leaves original data unchanged');
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	it('replaces data and recovers independent scales from empty and all-null aggregates', async () => {
		const empty = [[null, null], [null, null], [null, null]];
		const f = makePlot({ count: 3, plotData: [[], [], [], []] });
		const { u, keys } = f;
		try {
			await Promise.resolve();
			assertScans(f, keys, empty);
			assertLayout(f, empty);
			for (const [plotData, extrema] of [
				[data, full],
				[[data[0], data[1].map(value => value * 2), Array(8).fill(null), data[3]], [[26, 174], [null, null], [-9, -2]]],
				[[data[0], Array(8).fill(null), Array(8).fill(null), Array(8).fill(null)], empty],
				[[[], [], [], []], empty],
				[data, full],
			]) {
				f.clear();
				u.setData(plotData);
				await Promise.resolve();
				assertScans(f, keys, extrema);
				assertLayout(f, extrema);
				keys.forEach((_, i) => { if (extrema[i][0] != null) assertLinePath(u, i + 1); });

				f.clear();
				u.setSize({ width: 700, height: u.height == 413 ? 525 : 413 });
				await Promise.resolve();
				assertScans(f, [], extrema);
				assertLayout(f, extrema);
			}
		}
		finally { u.destroy(); }
	});

	it('rescans only the affected scale for single-series and shared-scale visibility changes', async () => {
		const f = makePlot({ shared: true });
		const { u, keys } = f;
		try {
			await Promise.resolve();
			assertScans(f, keys, [[13, 187], full[1]]);
			assertLayout(f, [[13, 187], full[1]]);
			for (const [index, show, extrema] of [
				[2, false, [[13, 187], [null, null]]],
				[2, true, [[13, 187], full[1]]],
				[1, false, [[113, 187], full[1]]],
				[3, false, [[null, null], full[1]]],
				[1, true, [full[0], full[1]]],
				[3, true, [[13, 187], full[1]]],
			]) {
				const previous = allBounds(u, keys);
				f.clear();
				u.setSeries(index, { show });
				await Promise.resolve();
				assertScans(f, [u.series[index].scale], extrema, [0, 7]);
				assertLayout(f, extrema);
				assertHooks(f, previous);
				u.series.forEach((series, i) => { if (i > 0 && series.show) assertLinePath(u, i); });

				f.clear();
				u.redraw(false, true);
				await Promise.resolve();
				assertScans(f, [], extrema);
				assertLayout(f, extrema);
				assert.deepEqual(f.events, [], 'axis-only redraw does not publish unchanged bounds');
			}
		}
		finally { u.destroy(); }
	});

	it('invalidates only paths on a changed custom aggregate at fixed plot geometry', async () => {
		const aggregates = { y: [13, 87] };
		const f = makePlot({ count: 3, aggregates });
		const { u, keys } = f;
		try {
			await Promise.resolve();
			assertScans(f, keys, full);
			assertLayout(f, full);
			const paths = keys.map((_, i) => assertLinePath(u, i + 1));
			const bbox = { ...u.bbox };
			const previous = allBounds(u, keys);
			aggregates.y = [-87, 87];
			const extrema = [aggregates.y, ...full.slice(1)];
			f.clear();
			u.setScale('y', { min: null, max: null });
			keys.forEach((_, i) => assert.equal(u.series[i + 1]._paths, paths[i], 'queued update retains completed paths'));
			await Promise.resolve();
			assertScans(f, ['y'], extrema, [0, 7]);
			assertLayout(f, extrema);
			assertHooks(f, previous);
			assert.deepEqual(f.events.map(event => event.key), ['y']);
			assert.deepEqual(u.bbox, bbox);
			assert.deepEqual(bounds(u, 'x'), [0, 7]);
			const rebuilt = assertLinePath(u, 1);
			assert.notEqual(rebuilt, paths[0]);
			assert.notEqual(rebuilt.stroke, paths[0].stroke);
			assert.notDeepEqual(rebuilt.stroke.log, paths[0].stroke.log, 'line coordinates use the changed range');
			for (const i of [2, 3])
				assert.equal(assertLinePath(u, i), paths[i - 1], 'unaffected scale retains its path');
			assert.deepEqual([u.series[1].min, u.series[1].max], full[0], 'aggregate does not overwrite raw series extrema');
			assert.deepEqual(u.data, data);

			for (const [action, scanKeys] of [
				[() => u.setScale('y', { min: null, max: null }), ['y']],
				[() => u.redraw(false, true), []],
			]) {
				f.clear();
				action();
				await Promise.resolve();
				assertScans(f, scanKeys, extrema);
				assertLayout(f, extrema);
				assert.deepEqual(f.events, [], 'unchanged bounds produce no Y hooks');
				assert.equal(assertLinePath(u, 1), rebuilt);
				for (const i of [2, 3])
					assert.equal(assertLinePath(u, i), paths[i - 1]);
			}
		}
		finally { u.destroy(); }
	});

	it('coalesces data, zoom, visibility, and size updates into one microtask render', async () => {
		const f = makePlot({ count: 3 });
		const { u, keys } = f;
		try {
			await Promise.resolve();
			const previous = allBounds(u, keys);
			let draws = 0;
			u.hooks.draw = [() => draws++];
			f.clear();
			u.setData(data.map(values => values.map(value => value * 2)));
			u.setSize({ width: 800, height: 525 });
			u.setScale('x', { min: 0, max: 2 });
			u.setSeries(2, { show: false });
			u.setData(data);
			u.setSeries(2, { show: true });
			u.setScale('x', { min: 2.9, max: 3.4 });
			u.setSize({ width: 710, height: 413 });
			assert.equal(draws, 0);
			assert.deepEqual(f.scans, []);
			assert.deepEqual(f.sizes, []);
			await Promise.resolve();
			assertScans(f, keys, flat, [3, 3]);
			assertLayout(f, flat, 413);
			assertHooks(f, previous);
			assert.equal(draws, 1);
			await Promise.resolve();
			assert.equal(draws, 1, 'no redundant follow-up render');
		}
		finally { u.destroy(); }
	});

	it('coalesces resize-only updates without scanning data', async () => {
		const f = makePlot({ count: 3 });
		const { u, keys } = f;
		try {
			await Promise.resolve();
			const previous = allBounds(u, keys);
			let draws = 0;
			u.hooks.draw = [() => draws++];
			f.clear();
			for (const height of [40, 50, 333, 1000, 525])
				u.setSize({ width: 700, height });
			assert.equal(draws, 0);
			assert.deepEqual(f.scans, []);
			assert.deepEqual(f.values, []);
			await Promise.resolve();
			assertScans(f, [], full);
			assertLayout(f, full, 525);
			assertHooks(f, previous);
			assert.equal(draws, 1);
		}
		finally { u.destroy(); }
	});

	it('publishes all final Y ranges and ticks before any Y hook, and skips unchanged bounds', async () => {
		const f = makePlot({ count: 3 });
		const { u, keys } = f;
		try {
			await Promise.resolve();
			assertLayout(f, full);
			assertHooks(f, keys.map(() => [null, null]));
			for (const [action, extrema, scanKeys] of [
				[() => u.setSize({ width: 700, height: 525 }), full, []],
				[() => u.setSize({ width: 710, height: 525 }), full, []],
				[() => u.setSize({ width: 710, height: 526 }), full, []],
				[() => u.redraw(false, true), full, []],
				[() => u.setSize({ width: 700, height: 413 }), full, []],
				[() => u.setScale('x', { min: 2.9, max: 3.4 }), flat, keys],
				[() => u.setScale('x', { min: 2.9, max: 3.4 }), flat, keys],
			]) {
				const previous = allBounds(u, keys);
				f.clear();
				action();
				await Promise.resolve();
				assertScans(f, scanKeys, extrema);
				assertLayout(f, extrema);
				assertHooks(f, previous);
			}
		}
		finally { u.destroy(); }
	});
});
