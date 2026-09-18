import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits } from '../src/opts.js';

const data = [[0, 1, 2, 3, 4, 5, 6, 7], [13, 24, 51, 38, 87, 65, 42, 72]];
const tick = () => Promise.resolve();
const bounds = u => [u.scales.y.min, u.scales.y.max];
const raw = u => [u.series[1].min, u.series[1].max];
const splits = u => u.axes[1]._splits ?? [];
const cssHeight = u => u.bbox.height / u.pxRatio;

function makePlot({
	optIn = true, plotData = data, height = 413, width = 700, pxRatio = 1,
	side = 3, dir = 1, mode = 1, y = {}, x = {}, extraScales = {},
	axes = [{ show: false }, { side }], padding = [0, 0, 0, 0], hooks = {}, paths = () => null,
} = {}) {
	const scans = [];
	const u = new uPlot({
		width, height, pxRatio, mode, padding,
		cursor: { show: false },
		legend: { show: false },
		scales: {
			x: { time: false, ...x },
			y: {
				...(optIn ? { axis: 1 } : {}),
				time: false, dir,
				scan(u, key, i0, i1) {
					const extrema = uPlot.scan(u, key, i0, i1, true);
					scans.push({ key, i0, i1, extrema: extrema.slice() });
					return extrema;
				},
				...y,
			},
			...extraScales,
		},
		axes,
		series: [{}, { paths, stroke: 'blue', points: { show: false } }],
		hooks,
	}, mode == 1 ? plotData : [null, plotData], document.body);
	return { u, scans };
}

function assertRange(u, min, max, height = cssHeight(u)) {
	assert.equal(cssHeight(u), height, 'range uses final CSS plot height');
	const expected = rangeY(min, max, height);
	assert.ok(expected, 'fixture must have a supported numeric range');
	assert.deepEqual(bounds(u), [expected.min, expected.max]);
	const ticks = expected.count == 0 ? [] : expected.count == 1
		? [expected.min, expected.max]
		: numAxisSplits(u, 1, expected.min, expected.max, expected.incr, 0, true);
	assert.deepEqual(splits(u), ticks, 'ticks use the range increment, not ordinary space selection');
	if (expected.count > 0) {
		assert.equal(ticks.length, rangeYCount(height) + 1);
		assert.deepEqual([ticks[0], ticks.at(-1)], bounds(u));
	}
	return expected;
}

function assertOrdinary(actual, control) {
	assert.deepEqual(bounds(actual), bounds(control), 'ordinary bounds');
	assert.deepEqual(splits(actual), splits(control), 'ordinary ticks');
}

function assertLinePaths(u) {
	const paths = u.series[1]._paths;
	assert.ok(paths?.stroke, 'the default line builder creates a stroke path');
	assert.ok(paths.stroke.log.some(([name]) => name == 'lineTo'), 'the path contains line segments');
	const clearIndex = u.ctx.log.findLastIndex(([name]) => name == 'clearRect');
	assert.ok(clearIndex >= 0, 'the render clears the canvas');
	assert.ok(u.ctx.log.slice(clearIndex + 1).some(([name, ...calls]) => name == 'stroke' && calls.some(args => args[0] === paths.stroke)),
		'the current render draws the series stroke path');
	return paths;
}

describe('axis-ranging chart POC: one Y scale', () => {
	for (const side of [3, 1]) {
		for (const dir of [1, -1]) {
			for (const pxRatio of [1, 2]) {
				it(`uses CSS height thresholds (side ${side}, dir ${dir}, DPR ${pxRatio})`, async () => {
					const { u, scans } = makePlot({ side, dir, pxRatio, height: 40 });
					try {
						await tick();
						assert.equal(scans.length, 1);
						const heights = [[40, 1], [49, 1], [50, 2], [125, 3], [333, 7], [400, 8], [413, 8], [525, 10], [999, 19], [1000, 20]];
						for (const [height, count] of heights) {
							u.setSize({ width: 700, height });
							await tick();
							assert.equal(assertRange(u, 13, 87, height).count, count);
							assert.deepEqual(raw(u), [13, 87]);
							assert.equal(scans.length, 1, 'resize reuses scanned extrema');
							const positions = splits(u).map(value => u.valToPos(value, 'y'));
							positions.forEach((pos, i) => {
								const expected = height * (dir == 1 ? 1 - i / count : i / count);
								assert.ok(Math.abs(pos - expected) < 1e-8, `tick ${i} position ${pos}, expected ${expected}`);
							});
						}
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	for (const [values, expected] of [
		[[13, 87], [0, 100]], [[-87, -13], [-100, 0]],
		[[-13, 87], [-100, 100]], [[-.13, .87], [-1, 1]],
	]) {
		it(`uses direct endpoints for a one-interval range ${values}`, async () => {
			const { u } = makePlot({ height: 40, plotData: [[0, 1], values] });
			try {
				await tick();
				assertRange(u, ...values, 40);
				assert.deepEqual(splits(u), expected);
			}
			finally { u.destroy(); }
		});
	}

	for (const pxRatio of [1, 2]) {
		it(`resolves after horizontal reservation and padding, before one Y measurement (DPR ${pxRatio})`, async () => {
			const reservations = [];
			const measurements = [];
			let yWidth = 70;
			const { u, scans } = makePlot({
				height: 500, pxRatio, padding: [10, 11, 17, 7],
				axes: [
					{ size(self, values) { reservations.push(values); return 60; } },
					{ size(self, values) {
						measurements.push({ height: cssHeight(self), bounds: bounds(self), splits: splits(self).slice(), values });
						return yWidth;
					} },
				],
			});
			try {
				await tick();
				for (const [pass, [outerHeight, plotHeight, measuredWidth]] of [[500, 413, 70], [612, 525, 120], [500, 413, 70]].entries()) {
					if (pass > 0) {
						yWidth = measuredWidth;
						u.setSize({ width: 700, height: outerHeight });
						await tick();
					}
					assertRange(u, 13, 87, plotHeight);
					assert.deepEqual(reservations, [null], 'one horizontal reservation');
					assert.equal(measurements.length, 1, 'one vertical measurement');
					assert.deepEqual(measurements[0].bounds, bounds(u));
					assert.deepEqual(measurements[0].splits, splits(u));
					assert.equal(measurements[0].height, plotHeight);
					assert.ok(Array.isArray(measurements[0].values));
					assert.equal(u.bbox.width / pxRatio, 700 - 7 - 11 - measuredWidth);
					assert.equal(scans.length, 1, 'layout does not rescan');
					reservations.length = measurements.length = 0;
				}
			}
			finally { u.destroy(); }
		});
	}

	it('zooms X to raw flat 38, then resizes without scans or cumulative padding', async () => {
		const { u, scans } = makePlot();
		try {
			await tick();
			assertRange(u, 13, 87, 413);
			scans.length = 0;
			u.setScale('x', { min: 2.9, max: 3.4 });
			await tick();
			assert.deepEqual(scans, [{ key: 'y', i0: 3, i1: 3, extrema: [38, 38] }]);
			assert.deepEqual(raw(u), [38, 38]);
			assertRange(u, 38, 38, 413);
			assert.deepEqual(bounds(u), [0, 80]);
			assert.deepEqual(splits(u), [0, 10, 20, 30, 40, 50, 60, 70, 80]);

			for (const height of [525, 40, 50, 125, 333, 1000, 413, 525, 413]) {
				u.setSize({ width: 700, height });
				await tick();
				assertRange(u, 38, 38, height);
				assert.deepEqual(raw(u), [38, 38]);
				assert.equal(scans.length, 1);
			}
			assert.deepEqual(bounds(u), [0, 80]);
			assert.deepEqual(u.data, data, 'ranging does not alter source data');

			scans.length = 0;
			u.setScale('x', { min: null, max: null });
			await tick();
			assert.equal(scans.length, 1);
			assert.deepEqual(raw(u), [13, 87]);
			assertRange(u, 13, 87, 413);
		}
		finally { u.destroy(); }
	});

	for (const value of [38, -38, 0]) {
		it(`expands initially flat ${value} without changing series extrema`, async () => {
			const { u } = makePlot({ plotData: [[0, 1], [value, value]] });
			try {
				await tick();
				assertRange(u, value, value, 413);
				assert.deepEqual(raw(u), [value, value]);
			}
			finally { u.destroy(); }
		});
	}

	it('handles empty, all-null, and replaced data, then recovers from cached empty extrema', async () => {
		const { u, scans } = makePlot({ plotData: [[], []] });
		try {
			await tick();
			assertRange(u, null, null, 413);
			for (const [plotData, extrema] of [
				[data, [13, 87]],
				[[[0, 1], [null, null]], [null, null]],
				[[[0, 1], [38, 38]], [38, 38]],
				[[[], []], [null, null]],
				[[[0, 1], [-81, -9]], [-81, -9]],
			]) {
				scans.length = 0;
				u.setData(plotData);
				await tick();
				assert.equal(scans.length, 1);
				assert.deepEqual(scans[0].extrema, extrema);
				assertRange(u, ...extrema);
				u.setSize({ width: u.width == 700 ? 710 : 700, height: 525 });
				await tick();
				assertRange(u, ...extrema, 525);
				assert.equal(scans.length, 1, 'empty and nonempty caches survive resize');
			}
		}
		finally { u.destroy(); }
	});

	it('invalidates the aggregate when its only Y series is hidden and shown', async () => {
		const { u, scans } = makePlot();
		try {
			await tick();
			for (const show of [false, true]) {
				scans.length = 0;
				u.setSeries(1, { show });
				await tick();
				const extrema = show ? [13, 87] : [null, null];
				assert.equal(scans.length, 1);
				assert.deepEqual(scans[0].extrema, extrema);
				assertRange(u, ...extrema);
				u.setSize({ width: show ? 700 : 710, height: show ? 413 : 525 });
				await tick();
				assertRange(u, ...extrema);
				assert.equal(scans.length, 1);
			}
			assert.deepEqual(raw(u), [13, 87]);
		}
		finally { u.destroy(); }
	});

	for (const request of [{ min: 20, max: 70 }, { min: -10, max: null }, { min: undefined, max: 100 }]) {
		it(`keeps setter ${JSON.stringify(request)} ordinary through resize until null reset`, async () => {
			const { u, scans } = makePlot();
			const { u: control } = makePlot({ optIn: false });
			try {
				await tick();
				u.setScale('y', { ...request });
				control.setScale('y', { ...request });
				await tick();
				assertOrdinary(u, control);
				if (request.min != null) assert.equal(u.scales.y.min, request.min);
				if (request.max != null) assert.equal(u.scales.y.max, request.max);
				const explicit = bounds(u);
				scans.length = 0;
				for (const height of [40, 525, 413]) {
					u.setSize({ width: 700, height });
					control.setSize({ width: 700, height });
					await tick();
					assertOrdinary(u, control);
					assert.deepEqual(bounds(u), explicit);
					assert.equal(scans.length, 0);
				}
				u.setScale('y', { min: null, max: null });
				await tick();
				assertRange(u, 13, 87, 413);
				assert.deepEqual(raw(u), [13, 87]);
			}
			finally { u.destroy(); control.destroy(); }
		});
	}

	it('switches automatic endpoint ticks to ordinary ticks for identical explicit bounds without resizing', async () => {
		const plotData = [[0, 1], [-13, 87]];
		const { u, scans } = makePlot({ height: 40, plotData });
		const { u: control } = makePlot({ height: 40, plotData, optIn: false });
		try {
			await tick();
			assertRange(u, -13, 87, 40);
			const automaticTicks = splits(u).slice();
			assert.deepEqual(automaticTicks, [-100, 100]);
			const request = { min: u.scales.y.min, max: u.scales.y.max };
			const bbox = { ...u.bbox };
			scans.length = 0;
			u.setScale('y', { ...request });
			control.setScale('y', { ...request });
			await tick();
			assert.deepEqual(bounds(u), [-100, 100], 'numeric bounds do not change');
			assert.notDeepEqual(splits(control), automaticTicks, 'ordinary tick selection differs from POC endpoints');
			assertOrdinary(u, control);
			assert.deepEqual(u.bbox, bbox, 'no resize or geometry change is needed');
			assert.equal(scans.length, 0, 'fully explicit setters do not scan');
		}
		finally { u.destroy(); control.destroy(); }
	});

	it('rejects a historical stroke after the canvas is cleared without redrawing the retained path', async () => {
		const { u } = makePlot({ paths: null });
		try {
			await tick();
			const paths = assertLinePaths(u);
			// Consecutive clears share one log entry in the DOM instrument.
			u.ctx.clearRect(0, 0, u.ctx.width, u.ctx.height);
			u.ctx.clearRect(0, 0, u.ctx.width, u.ctx.height);
			assert.equal(u.series[1]._paths, paths);
			assert.throws(() => assertLinePaths(u), /the current render draws the series stroke path/);
			u.redraw(false, true);
			await tick();
			assert.equal(assertLinePaths(u), paths);
		}
		finally { u.destroy(); }
	});

	it('draws default line paths and reuses them for same-bounds layouts with unchanged plot geometry', async () => {
		const { u, scans } = makePlot({
			paths: null,
			axes: [{ show: false }, { size: 50 }],
			// Offset outer-width changes so the path's coordinate system stays fixed.
			padding: [0, self => self.width - 700, 0, 0],
		});
		try {
			await tick();
			assertRange(u, 13, 87, 413);
			const paths = assertLinePaths(u);
			const bbox = { ...u.bbox };
			const initialBounds = bounds(u);
			scans.length = 0;
			for (const width of [700, 760, 700]) {
				if (width != u.width)
					u.setSize({ width, height: 413 });
				else
					u.redraw(false, true);
				await tick();
				assert.deepEqual(u.bbox, bbox);
				assert.deepEqual(bounds(u), initialBounds);
				assertRange(u, 13, 87, 413);
				assert.equal(assertLinePaths(u), paths, 'layout alone preserves cached line paths');
				assert.equal(scans.length, 0);
			}
		}
		finally { u.destroy(); }
	});

	for (const change of ['data', 'custom scan']) {
		it(`rebuilds default line paths when ${change} changes bounds at fixed geometry`, async () => {
			let scanExtrema = [13, 87];
			let scanCalls = 0;
			const { u } = makePlot({
				paths: null,
				axes: [{ show: false }, { size: 50 }],
				y: change == 'custom scan' ? {
					scan(self, key, i0, i1) {
						scanCalls++;
						uPlot.scan(self, key, i0, i1, true);
						return scanExtrema;
					},
				} : {},
			});
			try {
				await tick();
				assertRange(u, 13, 87, 413);
				const paths = assertLinePaths(u);
				const bbox = { ...u.bbox };
				const initialBounds = bounds(u);
				if (change == 'data') {
					scanExtrema = [13, 187];
					const values = data[1].slice();
					values[4] = 187;
					u.setData([data[0], values]);
				}
				else {
					scanCalls = 0;
					scanExtrema = [-87, 87];
					u.setScale('y', { min: null, max: null });
					assert.equal(u.series[1]._paths, paths, 'queued scan retains the completed paths until commit');
				}
				await tick();
				assertRange(u, ...scanExtrema, 413);
				assert.notDeepEqual(bounds(u), initialBounds);
				assert.deepEqual(u.bbox, bbox, 'changed bounds do not depend on a geometry change');
				const rebuilt = assertLinePaths(u);
				assert.notEqual(rebuilt, paths, 'changed bounds invalidate the cached paths');
				assert.notEqual(rebuilt.stroke, paths.stroke);
				assert.notDeepEqual(rebuilt.stroke.log, paths.stroke.log, 'line coordinates use the new bounds');
				if (change == 'custom scan') {
					assert.equal(scanCalls, 1);
					assert.deepEqual(raw(u), [13, 87], 'custom aggregate changes do not rewrite series extrema');
					assert.deepEqual(u.data, data);
				}
				else
					assert.deepEqual(raw(u), scanExtrema);
				u.redraw(false, true);
				await tick();
				assert.equal(assertLinePaths(u), rebuilt, 'subsequent unchanged layout reuses rebuilt paths');
			}
			finally { u.destroy(); }
		});
	}

	it('leaves chart defaults and the configured scale.range function ordinary', async () => {
		const { u } = makePlot();
		const { u: control } = makePlot({ optIn: false });
		try {
			await tick();
			const ordinary = control.scales.y.range(control, 13, 87, 'y');
			assert.deepEqual(bounds(control), ordinary);
			assert.deepEqual(u.scales.y.range(u, 13, 87, 'y'), ordinary);
			assert.notDeepEqual(bounds(u), ordinary, 'the opt-in has an observable effect');
			assertRange(u, 13, 87, 413);
		}
		finally { u.destroy(); control.destroy(); }
	});

	for (const [name, options] of [
		['fixed configured range', { y: { range: [0, 200] } }],
		['partial configured range', { y: { range: [0, null] } }],
		['functional configured range', { y: { range: (u, min, max) => [min - 3, max + 7] } }],
		['object configured range', { y: { range: { min: { pad: .25 }, max: { pad: .25 } } } }],
		['mode 2', { mode: 2 }],
		['physical horizontal Y', { x: { ori: 1 }, y: { ori: 0 }, axes: [{ show: false, side: 3 }, { side: 2 }] }],
		['time Y', { y: { time: true } }],
		['logarithmic Y', { y: { distr: 3 } }],
		['asinh Y', { y: { distr: 4 } }],
		['custom distribution', { y: { distr: 100, fwd: v => v, bwd: v => v } }],
		['auto false', { y: { auto: false } }],
		['derived Y', { y: { from: 'x', ori: 1 } }],
		// The child has no series or axis; this checks only the parent eligibility gate.
		['Y is a parent', { extraScales: { child: { from: 'y' } } }],
		['custom axis space', { axes: [{ show: false }, { space: 30 }] }],
		['custom axis incrs', { axes: [{ show: false }, { incrs: [1, 5, 10, 25, 50, 100] }] }],
		['custom axis splits', { axes: [{ show: false }, { splits: (u, i, min, max) => [min, max] }] }],
		['hidden designated axis', { axes: [{ show: false }, { show: false }] }],
		['missing designated axis', { y: { axis: 2 } }],
	]) {
		it(`does not activate for ${name}`, async () => {
			const { u } = makePlot(options);
			const { u: control } = makePlot({ ...options, optIn: false, y: { ...options.y, axis: undefined } });
			try {
				await tick();
				assertOrdinary(u, control);
				for (const height of [40, 525, 413]) {
					u.setSize({ width: 700, height });
					control.setSize({ width: 700, height });
					await tick();
					assertOrdinary(u, control);
				}
			}
			finally { u.destroy(); control.destroy(); }
		});
	}

	it('clears unsupported numeric bounds and ticks without ordinary fallback, then recovers', async () => {
		const unsupported = [1e20, 1e20 + 16384];
		assert.equal(rangeY(...unsupported, 413), null);
		const { u, scans } = makePlot({ plotData: [[0, 1], unsupported] });
		try {
			await tick();
			assert.deepEqual(bounds(u), [null, null]);
			assert.deepEqual(splits(u), []);
			assert.deepEqual(raw(u), unsupported);
			const count = scans.length;
			u.setSize({ width: 700, height: 525 });
			await tick();
			assert.equal(scans.length, count);
			assert.deepEqual(bounds(u), [null, null]);
			assert.deepEqual(splits(u), []);
			for (const [plotData, extrema] of [[data, [13, 87]], [[[0, 1], unsupported], unsupported], [[[0, 1], [38, 38]], [38, 38]]]) {
				scans.length = 0;
				u.setData(plotData);
				await tick();
				assert.equal(scans.length, 1);
				assert.deepEqual(raw(u), extrema);
				if (extrema === unsupported) {
					assert.deepEqual(bounds(u), [null, null]);
					assert.deepEqual(splits(u), [], 'old valid ticks are cleared');
				}
				else
					assertRange(u, ...extrema, 525);
			}
		}
		finally { u.destroy(); }
	});

	it('publishes only final Y bounds to setScale hooks and skips unchanged resize bounds', async () => {
		const events = [];
		const { u } = makePlot({ hooks: { setScale: [(self, key) => {
			if (key == 'y') events.push({ bounds: bounds(self), height: cssHeight(self) });
		}] } });
		try {
			await tick();
			assertRange(u, 13, 87, 413);
			assert.deepEqual(events, [{ bounds: bounds(u), height: 413 }]);
			events.length = 0;
			u.setSize({ width: 700, height: 525 });
			await tick();
			assertRange(u, 13, 87, 525);
			assert.deepEqual(events, [{ bounds: bounds(u), height: 525 }]);
			events.length = 0;
			for (const size of [{ width: 710, height: 525 }, { width: 710, height: 526 }, { width: 710, height: 526 }]) {
				u.setSize(size);
				await tick();
				assertRange(u, 13, 87, size.height);
				assert.deepEqual(events, [], 'no Y hook when resolved bounds are unchanged');
			}
			u.setSize({ width: 710, height: 413 });
			await tick();
			assertRange(u, 13, 87, 413);
			assert.deepEqual(events, [{ bounds: bounds(u), height: 413 }]);
			events.length = 0;
			u.setScale('x', { min: 2.9, max: 3.4 });
			await tick();
			assertRange(u, 38, 38, 413);
			assert.deepEqual(events, [{ bounds: bounds(u), height: 413 }]);
		}
		finally { u.destroy(); }
	});
});
