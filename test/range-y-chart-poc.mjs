import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY, rangeYAuto, rangeYCount } from '../src/rangeY.js';
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

function assertRange(u, min, max, height = cssHeight(u), range) {
	assert.equal(cssHeight(u), height, 'range uses final CSS plot height');
	const axis = u.axes[1];
	const expected = rangeY(min, max, height, range, axis.ramp, axis.exact);
	assert.ok(expected, 'fixture must have a supported numeric range');
	assert.deepEqual(bounds(u), [expected.min, expected.max]);
	const ticks = expected.count == 0 ? [] : expected.count == 1
		? [expected.min, expected.max]
		: numAxisSplits(u, 1, expected.min, expected.max, expected.incr, 0, true);
	assert.deepEqual(splits(u), ticks, 'ticks use the range increment, not ordinary space selection');
	if (expected.count > 0) {
		assert.equal(ticks.length, expected.count + 1);
		if (axis.exact)
			assert.equal(expected.count, rangeYCount(height, axis.ramp));
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
	it('defaults omitted axis.exact to the tighter approximate range', async () => {
		const { u: omitted } = makePlot({ height: 400 });
		const { u: approximate } = makePlot({ height: 400, axes: [{ show: false }, { exact: false }] });
		const { u: exact } = makePlot({ height: 400, axes: [{ show: false }, { exact: true }] });
		try {
			await tick();
			assert.equal(omitted.axes[1].exact, false);
			for (const u of [omitted, approximate, exact])
				assertRange(u, 13, 87, 400);
			assert.deepEqual(bounds(omitted), [0, 100]);
			assert.deepEqual(bounds(omitted), bounds(approximate));
			assert.deepEqual(splits(omitted), splits(approximate));
			assert.deepEqual(splits(omitted), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
			assert.deepEqual(bounds(exact), [0, 160]);
			assert.equal(splits(exact).length, 9);
			assert.notDeepEqual(splits(omitted), splits(exact));
			assert.ok(omitted.scales.y.max - omitted.scales.y.min < exact.scales.y.max - exact.scales.y.min);
		}
		finally { omitted.destroy(); approximate.destroy(); exact.destroy(); }
	});

	for (const [extrema, expectedTicks] of [
		[[-880, -240], [-1000, -500, 0]],
		[[-6e6, 2e6], [-1e7, 0, 1e7]],
	]) {
		for (const pxRatio of [1, 2]) {
			it(`keeps short approximate plots sparse through resize (${extrema}, DPR ${pxRatio})`, async () => {
				const { u, scans } = makePlot({ height: 400, pxRatio, plotData: [[0, 1], extrema] });
				try {
					await tick();
					assert.equal(u.axes[1].exact, false);
					for (const height of [51, 20, 51]) {
						u.setSize({ width: 700, height });
						await tick();
						assertRange(u, ...extrema, height);
						if (height == 51)
							assert.deepEqual(splits(u), expectedTicks);
						else
							assert.equal(splits(u).length, 2);
						assert.equal(scans.length, 1, 'density selection reuses cached extrema');
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const exact of [true, false]) {
		for (const pxRatio of [1, 2]) {
			it(`applies axis ramp at construction and redraw (exact ${exact}, DPR ${pxRatio})`, async () => {
				let formats = 0;
				const { u, scans } = makePlot({ height: 400, pxRatio, paths: undefined,
					axes: [{ show: false }, { exact, ramp: .25, values: (u, splits) => {
						formats++;
						return splits.map(String);
					} }],
				});
				try {
					await tick();
					assert.equal(u.axes[1].exact, exact);
					assert.equal(u.axes[1].ramp, .25);
					assertRange(u, 13, 87);
					const initialScans = scans.length;
					const data = u.data;
					for (const ramp of [0, .25, 1, 2]) {
						formats = 0;
						u.axes[1].ramp = ramp;
						u.redraw(false, true);
						await tick();
						assertRange(u, 13, 87);
						if (ramp == 0)
							assert.equal(splits(u).length, 2);
						assert.equal(scans.length, initialScans);
						assert.equal(formats, 1, 'one tick-formatting pass per redraw');
						assert.equal(u.data, data);
					}
					for (const height of [125, 525]) {
						u.setSize({ width: u.width, height });
						await tick();
						assertRange(u, 13, 87, height);
						assert.equal(scans.length, initialScans);
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	it('switches exact mode without rescanning and rebuilds paths for the new bounds', async () => {
		const events = [];
		const { u, scans } = makePlot({ height: 400, paths: null,
			axes: [{ show: false }, { exact: true }],
			hooks: { setScale: [(u, key) => { if (key == 'y') events.push(bounds(u)); }] },
		});
		try {
			await tick();
			assert.equal(u.axes[1].exact, true);
			assert.equal(u.axes[1].ramp, 1);
			const initialScans = scans.length;
			for (const [exact, expected, count] of [[false, [0, 100], 11], [true, [0, 160], 9]]) {
				const paths = assertLinePaths(u);
				events.length = 0;
				u.axes[1].exact = exact;
				u.redraw(false, true);
				await tick();
				assert.deepEqual(bounds(u), expected);
				assert.equal(splits(u).length, count);
				assert.deepEqual(events, [expected]);
				assert.equal(scans.length, initialScans);
				assert.notEqual(assertLinePaths(u), paths);
			}
		}
		finally { u.destroy(); }
	});

	for (const side of [3, 1]) {
		for (const dir of [1, -1]) {
			for (const pxRatio of [1, 2]) {
				it(`uses CSS height thresholds (side ${side}, dir ${dir}, DPR ${pxRatio})`, async () => {
					const { u, scans } = makePlot({ side, dir, pxRatio, height: 40, axes: [{ show: false }, { side, exact: true }] });
					try {
						await tick();
						assert.equal(scans.length, 1);
						const heights = [[20, 1], [40, 2], [49, 2], [50, 2], [100, 3], [125, 3], [333, 7], [400, 8], [413, 8], [525, 11], [999, 20], [1000, 20]];
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
			const { u } = makePlot({ height: 20, plotData: [[0, 1], values] });
			try {
				await tick();
				assertRange(u, ...values, 20);
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
		const { u, scans } = makePlot({ height: 20, plotData });
		const { u: control } = makePlot({ height: 20, plotData, optIn: false });
		try {
			await tick();
			assertRange(u, -13, 87, 20);
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

	it('uses the default tick-aware policy for [null, null]', async () => {
		const plotData = [[0, 1], [10, 110]];
		const { u: omitted } = makePlot({ height: 543, plotData });
		const { u: partial } = makePlot({ height: 543, plotData, y: { range: [null, null] } });
		try {
			await tick();
			const expected = rangeY(10, 110, 543);
			assert.deepEqual([expected.min, expected.max], [0, 120]);
			assert.deepEqual(bounds(omitted), [expected.min, expected.max]);
			assert.deepEqual(bounds(partial), bounds(omitted));
			assert.deepEqual(splits(partial), splits(omitted));
		}
		finally { omitted.destroy(); partial.destroy(); }
	});

	for (const [name, range, policy] of [
		['partial configured range', [0, null], {
			zeroIf: rangeYAuto.zeroIf,
			min: { hard: 0, soft: 0 },
			max: rangeYAuto.max,
		}],
		['object configured range', { min: { pad: .25 }, max: { pad: .25 } }, { min: { pad: .25 }, max: { pad: .25 } }],
		['object configured zeroIf', { zeroIf: .2, min: {}, max: {} }, { zeroIf: .2, min: {}, max: {} }],
	]) {
		it(`applies ${name} on the tick-aware path`, async () => {
			const { u, scans } = makePlot({ y: { range } });
			try {
				await tick();
				assertRange(u, 13, 87, 413, policy);
				assert.deepEqual(raw(u), [13, 87]);
				assert.equal(scans.length, 1);

				u.setSize({ width: 700, height: 525 });
				await tick();
				assertRange(u, 13, 87, 525, policy);
				assert.equal(scans.length, 1, 'resize reuses raw extrema for configured policies');
			}
			finally { u.destroy(); }
		});
	}

	for (const exact of [true, false]) {
		for (const [minPad, maxPad] of [[.25, .5], [.5, 0], [0, .5]]) {
			it(`keeps asymmetric padding on raw extrema across resize and setData (exact ${exact}, pad ${minPad}/${maxPad})`, async () => {
				const range = { zeroIf: 0, min: { soft: null, pad: minPad }, max: { soft: null, pad: maxPad } };
				const { u, scans } = makePlot({ plotData: [[0, 1], [20, 100]], y: { range }, axes: [{ show: false }, { exact }] });
				try {
					await tick();
					let scanCount = 1;
					for (const values of [[20, 100], [-140, -20], [20, 100]]) {
						if (scanCount > 1) {
							u.setData([[0, 1], values]);
							await tick();
						}
						const [min, max] = values;
						const span = max - min;
						let initialBounds, initialSplits;
						for (const height of [413, 125, 525, 413]) {
							u.setSize({ width: 700, height });
							await tick();
							assert.deepEqual(raw(u), values, 'series cache retains raw, not padded, extrema');
							assert.equal(scans.length, scanCount, 'only setData invalidates the raw scan');
							assert.deepEqual(scans.at(-1), { key: 'y', i0: 0, i1: 1, extrema: values });
							assert.deepEqual(u.data, [[0, 1], values], 'padding does not mutate source data');
							assert.ok(min - splits(u)[0] >= span * minPad, 'minimum outer tick clears raw data by min.pad * raw span');
							assert.ok(splits(u).at(-1) - max >= span * maxPad, 'maximum outer tick clears raw data by max.pad * raw span');
							assertRange(u, min, max, height, range);
							if (initialBounds == null) {
								initialBounds = bounds(u);
								initialSplits = splits(u).slice();
							}
							else if (height == 413) {
								assert.deepEqual(bounds(u), initialBounds, 'returning to the same height does not accumulate padding');
								assert.deepEqual(splits(u), initialSplits);
							}
						}
						scanCount++;
					}
				}
				finally { u.destroy(); }
			});
		}

		it(`defaults omitted padding to .1 and allows explicit zero (exact ${exact})`, async () => {
			const range = { zeroIf: 0, min: { soft: null }, max: { soft: null } };
			const paddedRange = { zeroIf: 0, min: { soft: null, pad: .1 }, max: { soft: null, pad: .1 } };
			const zeroRange = { zeroIf: 0, min: { soft: null, pad: 0 }, max: { soft: null, pad: 0 } };
			const options = { plotData: [[0, 1], [20, 100]], axes: [{ show: false }, { exact }] };
			const { u } = makePlot({ ...options, y: { range } });
			const { u: padded } = makePlot({ ...options, y: { range: paddedRange } });
			const { u: zero } = makePlot({ ...options, y: { range: zeroRange } });
			try {
				await tick();
				for (const height of [413, 125, 525]) {
					u.setSize({ width: 700, height });
					padded.setSize({ width: 700, height });
					zero.setSize({ width: 700, height });
					await tick();
					assert.deepEqual(bounds(u), bounds(padded));
					assert.deepEqual(splits(u), splits(padded));
					assert.ok(u.scales.y.min <= 12 && u.scales.y.max >= 108, 'default padding clears both raw extrema by .1 * 80');
					assertRange(u, 20, 100, height, range);
					assertRange(padded, 20, 100, height, paddedRange);
					assertRange(zero, 20, 100, height, zeroRange);
					if (height == 413) {
						assert.deepEqual(bounds(zero), [20, 100], 'explicit pad: 0 retains an unpadded range');
						assert.notDeepEqual(bounds(u), bounds(zero));
						assert.notDeepEqual(splits(u), splits(zero));
					}
				}
			}
			finally { u.destroy(); padded.destroy(); zero.destroy(); }
		});

		for (const value of [38, -38, 0]) {
			it(`leaves the flat fallback unchanged by padding for ${value} (exact ${exact})`, async () => {
				const range = { min: { pad: 1e100 }, max: { pad: .75 } };
				const options = { plotData: [[0, 1], [value, value]], axes: [{ show: false }, { exact }] };
				const { u, scans } = makePlot({ ...options, y: { range } });
				const { u: control } = makePlot({ ...options, y: { range: { min: {}, max: {} } } });
				try {
					await tick();
					for (const height of [413, 125, 525, 413]) {
						u.setSize({ width: 700, height });
						control.setSize({ width: 700, height });
						await tick();
						assert.deepEqual(bounds(u), bounds(control), 'zero raw span adds no padding to the flat fallback');
						assert.deepEqual(splits(u), splits(control));
						assert.ok(u.scales.y.min < u.scales.y.max);
						assert.ok(u.scales.y.min <= value && u.scales.y.max >= value);
						assert.deepEqual(raw(u), [value, value]);
						assert.deepEqual(scans, [{ key: 'y', i0: 0, i1: 1, extrema: [value, value] }]);
						assertRange(u, value, value, height, range);
					}
				}
				finally { u.destroy(); control.destroy(); }
			});
		}

		for (const [values, range, side, anchor] of [
			[[38, 38], { min: { soft: 20 } }, 'min', 20],
			[[-38, -38], { max: { soft: -20 } }, 'max', -20],
			[[0, 0], { zeroIf: 0, min: { soft: 0 }, max: { soft: 0 } }, 'min', 0],
			[[0, 0], { min: { soft: 0 }, max: { soft: 0 } }, 'min', 0],
		]) {
			it(`shares raw flat anchors with ordinary ranging for ${values}, ${JSON.stringify(range)} (exact ${exact})`, async () => {
				const options = { plotData: [[0, 1], values], y: { range } };
				const { u } = makePlot({ ...options, axes: [{ show: false }, { exact }] });
				const { u: ordinary } = makePlot({ ...options, optIn: false });
				try {
					await tick();
					assertRange(u, ...values, 413, range);
					for (const chart of [u, ordinary]) {
						assert.equal(chart.scales.y[side], anchor, 'flat expansion does not deactivate a raw soft anchor');
						assert.ok(chart.scales.y.min < chart.scales.y.max, 'the max zero anchor cannot collapse flat zero');
						assert.ok(chart.scales.y.min <= values[0] && chart.scales.y.max >= values[1]);
						assert.deepEqual(raw(chart), values);
					}
				}
				finally { u.destroy(); ordinary.destroy(); }
			});
		}

		for (const mirrored of [false, true]) {
			it(`keeps an active soft zero anchor and pads the opposite side by the original span (exact ${exact}, mirrored ${mirrored})`, async () => {
				const values = mirrored ? [-100, -20] : [20, 100];
				const anchor = { soft: 0, pad: 1e100 };
				const free = { soft: null, pad: .1 };
				const range = { zeroIf: 0, min: mirrored ? free : anchor, max: mirrored ? anchor : free };
				const { u } = makePlot({ plotData: [[0, 1], values], y: { range }, axes: [{ show: false }, { exact }] });
				try {
					await tick();
					for (const height of [413, 125, 525]) {
						u.setSize({ width: 700, height });
						await tick();
						assert.equal(mirrored ? splits(u).at(-1) : splits(u)[0], 0, 'active soft anchor overrides its padding');
						assert.ok(mirrored ? splits(u)[0] <= -108 : splits(u).at(-1) >= 108,
							'opposite clearance is at least .1 * (100 - 20), not .1 * an anchored or padded span');
						assert.deepEqual(raw(u), values);
						assertRange(u, ...values, height, range);
					}
				}
				finally { u.destroy(); }
			});

			it(`toggles soft zero from raw data across setData and resize (exact ${exact}, mirrored ${mirrored})`, async () => {
				const side = mirrored ? 'max' : 'min';
				const range = { zeroIf: 0, [side]: { soft: 0, pad: .1 } };
				const mirror = values => mirrored ? [-values[1], -values[0]] : values;
				const options = { plotData: [[0, 1], mirror([20, 100])], y: { range } };
				const { u, scans } = makePlot({ ...options, axes: [{ show: false }, { exact }] });
				const { u: ordinary } = makePlot({ ...options, optIn: false });
				try {
					await tick();
					for (const [pass, values] of [[20, 100], [-20, 100], [0, 100], [20, 100]].entries()) {
						const extrema = mirror(values);
						if (pass > 0) {
							u.setData([[0, 1], extrema]);
							ordinary.setData([[0, 1], extrema]);
							await tick();
						}
						for (const height of [413, 125, 525, 413]) {
							u.setSize({ width: 700, height });
							await tick();
							assertRange(u, ...extrema, height, range);
							assert.deepEqual(raw(u), extrema);
							assert.equal(scans.length, pass + 1, 'resize reuses the raw scan, not the previous soft anchor');
							for (const chart of [u, ordinary]) {
								const endpoint = chart.scales.y[side];
								if (values[0] >= 0)
									assert.equal(endpoint, 0, 'raw data inside or at soft zero anchors both range paths');
								else
									assert.ok(mirrored ? endpoint >= 32 : endpoint <= -32, 'crossing restores raw-span padding on both range paths');
							}
						}
					}
				}
				finally { u.destroy(); ordinary.destroy(); }
			});

			for (const pad of [.5, 1e100]) {
				it(`lets raw zeroIf eligibility override ${pad} padding (exact ${exact}, mirrored ${mirrored})`, async () => {
					const values = mirrored ? [-110, -10] : [10, 110];
					const anchor = { soft: null, pad };
					const free = { soft: null, pad: .1 };
					const range = { zeroIf: .2, min: mirrored ? free : anchor, max: mirrored ? anchor : free };
					const { u, scans } = makePlot({ plotData: [[0, 1], values], y: { range }, axes: [{ show: false }, { exact }] });
					try {
						await tick();
						for (const height of [413, 125, 525, 413]) {
							u.setSize({ width: 700, height });
							await tick();
							assert.equal(mirrored ? splits(u).at(-1) : splits(u)[0], 0,
								'raw distance 10 is within .2 * raw span 100; padding cannot displace the zero anchor');
							assert.ok(mirrored ? splits(u)[0] <= -120 : splits(u).at(-1) >= 120, 'unanchored side still receives padding');
							assert.deepEqual(raw(u), values);
							assert.deepEqual(scans, [{ key: 'y', i0: 0, i1: 1, extrema: values }]);
							assertRange(u, ...values, height, range);
						}
					}
					finally { u.destroy(); }
				});
			}

			it(`keeps hard limits ahead of padding (exact ${exact}, mirrored ${mirrored})`, async () => {
				const values = mirrored ? [-100, 20] : [-20, 100];
				const limits = mirrored ? [-80, 0] : [0, 80];
				const range = { zeroIf: 0, min: { soft: null, hard: limits[0], pad: 1e100 }, max: { soft: null, hard: limits[1], pad: 1e100 } };
				const { u } = makePlot({ plotData: [[0, 1], values], y: { range }, axes: [{ show: false }, { exact }] });
				try {
					await tick();
					for (const height of [400, 200, 800]) {
						u.setSize({ width: 700, height });
						await tick();
						assert.deepEqual(bounds(u), limits, 'hard limits clip data and override both padding requests');
						assert.deepEqual([splits(u)[0], splits(u).at(-1)], limits);
						assert.deepEqual(raw(u), values, 'hard clipping does not alter raw extrema');
						assertRange(u, ...values, height, range);
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const [name, options] of [
		['fixed configured range', { y: { range: [0, 200] } }],
		['functional configured range', { y: { range: (u, min, max) => [min - 3, max + 7] } }],
		['configured flat policy', { y: { range: { min: {}, max: {}, flat: 1e-7 } } }],
		['configured flat zero policy', { y: { range: { min: {}, max: {}, flat: 0 } } }],
		['configured flat null policy', { y: { range: { min: {}, max: {}, flat: null } } }],
		['configured flat undefined policy', { y: { range: { min: {}, max: {}, flat: undefined } } }],
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
		const { u } = makePlot({ axes: [{ show: false }, { exact: true }], hooks: { setScale: [(self, key) => {
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
