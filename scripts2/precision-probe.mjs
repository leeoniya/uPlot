// Run by test/precision-scales.mjs in a disposable, timeout-limited process.
import assert from 'node:assert/strict';
import { rangeNum, rangeLog } from '../src/utils.js';

// Chart imports must follow DOM registration: dom.js captures the environment
// when first loaded. Numeric-only probes need neither Happy DOM nor uPlot.
let uPlot;
if (!process.argv.includes('--numeric')) {
	await import('./instrument.mjs');
	({ default: uPlot } = await import('../src/uPlot.js'));
}
const { numAxisSplits, logAxisSplits, log10AxisValsFilt } = await import('../src/opts.js');

function ordered(values, min, max) {
	assert.ok(values.length > 0 && values.length < 1000, `tick count: ${values.length}`);
	for (let i = 0; i < values.length; i++) {
		assert.ok(Number.isFinite(values[i]), `nonfinite tick at ${i}`);
		assert.ok(values[i] >= min && values[i] <= max, `out-of-range tick: ${values[i]}`);
		if (i > 0)
			assert.ok(values[i] > values[i - 1], `nonadvancing tick at ${i}`);
	}
}

function contains(bounds, min, max) {
	assert.ok(bounds.every(Number.isFinite));
	assert.ok(bounds[0] < bounds[1], 'range must have positive width');
	assert.ok(bounds[0] <= min && bounds[1] >= max, 'range must contain data extrema');
}

function logSplits(min, max, base = 10) {
	const self = { axes: [{ scale: 'y' }], scales: { y: { log: base } } };
	const splits = logAxisSplits(self, 0, min, max);
	ordered(splits, min, max);
	return splits;
}

// Decimal strings give an independent expected grid, without using uPlot rounding helpers.
function decades(minExp, maxExp) {
	const result = [];
	for (let exp = minExp; exp < maxExp; exp++)
		for (let digit = 1; digit <= 9; digit++)
			result.push(Number(`${digit}e${exp}`));
	result.push(Number(`1e${maxExp}`));
	return result;
}

async function chart(opts, data, check) {
	const u = new uPlot({
		width: 800,
		height: 400,
		series: [{}, { stroke: 'blue' }],
		...opts,
	}, data, document.body);
	try {
		await Promise.resolve();
		await check(u);
	}
	finally { u.destroy(); }
}

function numericChart(data, check, y = {}) {
	return chart({ scales: { x: { time: false }, y } }, data, check);
}

function checkNumericChart(u, min, max) {
	contains([u.scales.y.min, u.scales.y.max], min, max);
	ordered(u.axes[1]._splits, u.scales.y.min, u.scales.y.max);
}

const probes = {
	// Active datasets from demos/log-scales2.html:13-31, rendered at 1600x600
	// with linear, default-log10, and log2 Y scales (33-127). Not snapshot tested.
	// The commented log:10 at line 68 merely spells out the active default.
	async 'demo-magnitude-sweep'() {
		const ys = [];
		for (let exp = -6; exp <= 7; exp++)
			for (let digit = 1; digit < 10; digit++)
				ys.push(Math.round(digit * Math.pow(10, exp) * 1e6) / 1e6);
		ys.push(1e8);
		const data = [ys.map((v, i) => i + 1), ys];
		assert.deepEqual(ys, decades(-6, 8));
		for (const [title, y, expected] of [
			['Linear Scale (0.000001 -> 100,000,000)', {}, null],
			['Log10 Y Scale (0.000001 -> 100,000,000)', { distr: 3 }, decades(-6, 8)],
			['Log2 Y Scale (0.000001 -> 100,000,000)', { distr: 3, log: 2 }, Array.from({ length: 48 }, (_, i) => 2 ** (i - 20))],
		]) {
			await chart({
				title, width: 1600, height: 600,
				scales: { x: { time: false }, y },
				axes: [{}, { size: 80 }],
			}, data, u => {
				checkNumericChart(u, 1e-6, 1e8);
				if (expected)
					assert.deepEqual(u.axes[1]._splits, expected);
			});
		}
	},

	// Active skip-tick ranges/data: demos/log-scales2.html:285-345.
	// Active tiny data: 380-421. The title says 3e-24, but neither datum does.
	// These are not snapshots; exercise chart ranging, splitting and label filtering.
	async 'demo-wide-and-tiny-log'() {
		for (const [title, height, ys, y, expected] of [
			['Skip ticks log10', 300, [1e-14, 1e14], { distr: 3, log: 10, range: [1e-14, 1e14] }, decades(-14, 14)],
			['Skip ticks log2', 300, [2 ** -10, 2 ** 20], { distr: 3, log: 2, range: [2 ** -10, 2 ** 20] }, Array.from({ length: 31 }, (_, i) => 2 ** (i - 10))],
			['Handle 3e-24 y values', 600, [3.1992e-16, 4.9047e-13], { distr: 3, log: 10 }, decades(-16, -12)],
		]) {
			await chart({
				title, width: 800, height,
				scales: { x: { time: false }, y },
				axes: [{}, { values: (_u, splits) => splits.map(v => v == null ? '' : v.toExponential()) }],
			}, [[0, 1], ys], u => {
				checkNumericChart(u, ys[0], ys[1]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [expected[0], expected.at(-1)]);
				assert.deepEqual(u.axes[1]._splits, expected);
				const labels = u.axes[1]._values.filter(v => v != null && v !== '');
				assert.ok(labels.length > 1 && labels.length < expected.length, 'log labels must be thinned, not lost');
				assert.equal(new Set(labels).size, labels.length, 'distinct ticks need distinct labels');
			});
		}
	},

	// Both active full datasets from demos/log-scales2.html:429-488, not snapshots.
	// #1052 above/below only covers unscaled extrema at the utility level.
	async 'demo-partial-log-charts'() {
		for (const [divA, divB, bounds] of [
			[1, 1, [[900000, 2000000], [90000, 200000]]],
			[10_000_000, 1_000_000, [[0.09, 0.2], [0.09, 0.2]]],
		]) {
			const data = [
				[1704326400, 1704412800, 1704499200],
				[1000001, 1000000, 990000].map(v => v / divA),
				[99000, 100000, 100000.001].map(v => v / divB),
			];
			const y = { distr: 3, range: (_u, min, max) => rangeLog(min, max, 10, false) };
			await chart({
				title: 'Partial mags (base 10)', width: 600, height: 300,
				scales: { y0: { ...y }, y1: { ...y } },
				series: [{}, { scale: 'y0', stroke: 'red' }, { scale: 'y1', stroke: 'blue' }],
				axes: [{}, { scale: 'y0', side: 3 }, { scale: 'y1', side: 1 }],
			}, data, u => {
				for (let i = 0; i < 2; i++) {
					const sc = u.scales[`y${i}`];
					assert.deepEqual([sc.min, sc.max], bounds[i]);
					contains(bounds[i], Math.min(...data[i + 1]), Math.max(...data[i + 1]));
					ordered(u.axes[i + 1]._splits, ...bounds[i]);
					assert.equal(u.axes[i + 1]._splits[0], bounds[i][0]);
					assert.equal(u.axes[i + 1]._splits.at(-1), bounds[i][1]);
				}
			});
		}
	},

	// The issue specifies 100ms becoming 099, but not this full timestamp:
	// https://github.com/leeoniya/uPlot/issues/472
	// Both timestamps and the 100ms tick grid below are derived regression inputs.
	async '472-millisecond-format'() {
		const seconds = 1615849200.1;
		assert.equal(new Date(seconds / 0.001).getMilliseconds(), 99);
		for (const [ms, ts, ticks] of [
			[0.001, seconds, [1615849200.1, 1615849200.2, 1615849200.3]],
			[1, 1615849200100, [1615849200100, 1615849200200, 1615849200300]],
		]) {
			await chart({
				ms,
				series: [{ value: '{fff}' }, { stroke: 'blue' }],
				scales: { x: { range: [ticks[0], ticks[2]] } },
				axes: [{ space: 0, incrs: [ms == 1 ? 100 : 0.1], values: '{fff}' }, {}],
			}, [[ticks[0], ticks[2]], [0, 1]], u => {
				// A dataIdx is required: without it the formatter returns LEGEND_DISP.
				assert.equal(u.series[0].value(u, ts, 0, 0), '100');
				const splits = u.axes[0]._splits;
				ordered(splits, ticks[0], ticks[2]);
				// Seconds-based split addition can drift below the exact decimal;
				// date conversion must preserve the intended millisecond grid.
				assert.deepEqual(splits.map(v => Math.round(v / ms)), [1615849200100, 1615849200200, 1615849200300]);
				assert.deepEqual(u.axes[0].values(u, splits, 0), ['100', '200', '300']);
			});
		}
	},

	// Derived bounds protecting decimal-exponent arithmetic below 1e-14:
	// https://github.com/leeoniya/uPlot/commit/b2433b4c2de735e88917f7cfefcfe24b0aa0f3e9
	'b2433b4-tiny-log10'() {
		const splits = logSplits(1e-24, 1e-22);
		const expected = decades(-24, -22);
		assert.equal(splits.length, expected.length);
		// Decimal exponent arithmetic is not bit-exact at these magnitudes.
		// Compare every tick against the exact decimal grid, allowing only float noise.
		for (let i = 0; i < expected.length; i++)
			assert.ok(Math.abs(splits[i] - expected[i]) <= 2 * Number.EPSILON * expected[i], `tick ${i}: ${splits[i]} != ${expected[i]}`);
	},

	// Exact issue pair, with a derived 1e-7 increment; current code drops the lower tick.
	// https://github.com/grafana/grafana/issues/116559#issuecomment-4111259061
	'116559-lower-tick'() {
		assert.deepEqual(numAxisSplits(null, 0, 9.9999999, 10.0000001, 1e-7), [9.9999999, 10, 10.0000001]);
	},

	// Exact bounds from https://github.com/leeoniya/uPlot/issues/771 .
	// The 0.2 grid is a derived, explicit choice; test splits, not incrRound itself.
	'771-boundary'() {
		const expected = Array.from({ length: 12 }, (_, i) => (i - 3) / 5);
		for (const min of [-0.6, -0.600000001]) {
			const splits = numAxisSplits(null, 0, min, 1.6, 0.2);
			assert.deepEqual(splits, expected);
			assert.ok(!splits.some(v => Object.is(v, -0)));
		}
	},

	// Exact increments/space from https://github.com/leeoniya/uPlot/issues/805 .
	// A derived [0, 0.2] linear X range makes every expected split explicit.
	'805-custom-increment'() {
		return chart({
			scales: { x: { time: false, range: [0, 0.2] } },
			axes: [0.05, 0.04].map(incr => ({ scale: 'x', side: 2, space: 0, incrs: [incr] })),
		}, [[0, 0.2], [0, 1]], u => {
			assert.deepEqual(u.axes[0]._splits, [0, 0.05, 0.1, 0.15, 0.2]);
			assert.deepEqual(u.axes[1]._splits, [0, 0.04, 0.08, 0.12, 0.16, 0.2]);
		});
	},

	// Exact sequential batches from the maintainer's benchmark reproduction:
	// https://github.com/leeoniya/uPlot/issues/324#issuecomment-707233829
	// Synthetic endpoint data replaces the large benchmark payload, not the zoom bounds.
	async '324-zoom-batches'() {
		await chart({
			width: 1920, height: 600,
			cursor: { drag: { x: true, y: true } },
			series: [{}, { scale: '%', stroke: 'red' }],
			axes: [{}, { scale: '%' }],
		}, [[1567000000, 1569000000], [14, 15]], async u => {
			for (const [x, y] of [
				[[1567600710.4851427, 1567600710.4993143], [14.573779120014906, 14.573779120043511]],
				[[1568046215.2288318, 1568046215.2345016], [14.573779120022353, 14.573779120022357]],
			]) {
				u.batch(() => {
					u.setScale('x', { min: x[0], max: x[1] });
					u.setScale('%', { min: y[0], max: y[1] });
				});
				await Promise.resolve();
				for (const key of ['x', '%']) {
					const sc = u.scales[key];
					assert.ok(Number.isFinite(sc.min) && Number.isFinite(sc.max) && sc.min < sc.max);
				}
				// Suppressing ticks at unrepresentable precision is valid; duplicate ticks are not.
				for (const axis of u.axes)
					if (axis._splits?.length)
						ordered(axis._splits, u.scales[axis.scale].min, u.scales[axis.scale].max);
			}
			// Derived sub-1e-16 request: separately exercise the explicit zoom bailout.
			const before = [u.scales['%'].min, u.scales['%'].max];
			u.setScale('%', { min: 0, max: 1e-17 });
			await Promise.resolve();
			assert.deepEqual([u.scales['%'].min, u.scales['%'].max], before);
		});
	},

	// Exact problematic bounds, used as data extrema to exercise the BUILT-IN ranger:
	// https://github.com/leeoniya/uPlot/issues/760#issuecomment-1292397405
	'760-built-in-range'() {
		const min = 99999999.99999996, max = 100000000.00000004;
		contains(rangeNum(min, max, 0.1, true), min, max);
		return numericChart([[0, 1], [min, max]], u => checkNumericChart(u, min, max));
	},

	// Exact extrema extracted from the 61-point dataset, not a claimed full reproduction:
	// https://github.com/leeoniya/uPlot/issues/657
	'657-tiny-extrema'() {
		const min = -3.25076e-10, max = 1.01506e-10;
		const bounds = rangeNum(min, max, 0.1, true);
		contains(bounds, min, max);
		assert.ok(bounds[1] - bounds[0] < 10 * (max - min), 'tiny nonflat data must not get a unit-scale fallback');
		return numericChart([[0, 1], [min, max]], u => checkNumericChart(u, min, max));
	},

	// Exact explicit log range: https://github.com/leeoniya/uPlot/issues/1098
	'1098-unsnapped-log'() {
		assert.deepEqual(logSplits(0.99e-3, 10), decades(-3, 1));
	},

	// Exact extrema from the posted data; the title's "base 2" was corrected to 10:
	// https://github.com/leeoniya/uPlot/issues/1027#issuecomment-2566530209
	'1027-low-log10'() {
		const min = 7.256878746641693e-16, max = 7.144987372566716e-12;
		const bounds = rangeLog(min, max, 10, true);
		assert.deepEqual(bounds, [1e-16, 1e-11]);
		assert.deepEqual(logSplits(...bounds), decades(-16, -11));
	},

	// Exact range from https://github.com/leeoniya/uPlot/issues/826 .
	// Derived geometry: 50px/decade, 30px minimum labels. Only powers of ten fit.
	// The oracle follows log geometry, not the implementation's regex/rounding.
	'826-low-log-filter'() {
		const splits = logSplits(1e-14, 100);
		const self = {
			axes: [{ scale: 'y', _space: 30 }],
			scales: { y: { log: 10, distr: 3 } },
			valToPos: v => -50 * Math.log10(v),
		};
		const filtered = log10AxisValsFilt(self, splits, 0);
		assert.equal(filtered.length, splits.length);
		assert.deepEqual(filtered.filter(v => v != null), Array.from({ length: 17 }, (_, i) => Number(`1e${i - 14}`)));
	},

	// Exact bounds from https://github.com/leeoniya/uPlot/commit/f97988429568c04f1d96fef2e4865a111c390895
	'f979884-log2-wide'() {
		for (const fullMags of [false, true]) {
			const bounds = rangeLog(1e-6, 1e8, 2, fullMags);
			assert.deepEqual(bounds, [2 ** -20, 2 ** 27]);
			assert.deepEqual(logSplits(...bounds, 2), Array.from({ length: 48 }, (_, i) => 2 ** (i - 20)));
		}
	},

	// Extrema from both exact issue series; expected upper bounds supplied by maintainer:
	// https://github.com/leeoniya/uPlot/issues/1052#issuecomment-2802048496
	'1052-partial-log'() {
		for (const [min, max, expected] of [
			[990000, 1000001, [900000, 2000000]],
			[99000, 100000.001, [90000, 200000]],
		]) {
			assert.deepEqual(rangeLog(min, max, 10, false), expected);
			const splits = logSplits(...expected);
			assert.equal(splits[0], expected[0]);
			assert.equal(splits.at(-1), expected[1]);
		}
	},

	// Exact flat data from https://github.com/leeoniya/uPlot/issues/827 .
	// The report lacked a minimal chart; this deliberately checks built-in autoranging.
	'827-auto-flat'() {
		return numericChart([[0, 1], [1e14, 1e14]], u => checkNumericChart(u, 1e14, 1e14));
	},
	'827-auto-updates'() {
		const x = Array.from({ length: 10 }, (_, i) => i);
		return numericChart([x, x.map(i => 1e14 + i * 1e12)], async u => {
			for (const sign of [1, -1]) {
				for (const incr of [0, 0.015625, 1, 1e12]) {
					const y = x.map(i => sign * (1e14 + i * incr));
					u.setData([x, y]);
					await Promise.resolve();
					checkNumericChart(u, Math.min(...y), Math.max(...y));
					for (const value of y)
						assert.ok(Number.isFinite(u.valToPos(value, 'y')));
				}
			}
		});
	},
	// Low-level termination checks, not reproductions of the automatic data flow.
	'827-stalled-splits'() {
		const splits = numAxisSplits(null, 0, 1e14, 1e14, 1e-8);
		assert.ok(splits.length <= 1, 'a degenerate range cannot have multiple ticks');
		assert.deepEqual(numAxisSplits(null, 0, 2, 1, 1), []);
		assert.deepEqual(numAxisSplits(null, 0, 1e14, 1e14 + 1, 1e-8), []);
		// Discard earlier ticks if addition stalls after crossing a binary boundary.
		assert.deepEqual(numAxisSplits(null, 0, 2 ** 53 - 1, 2 ** 53 + 2, 1), []);
		// Reaching the endpoint completes the range, even if another step would stall.
		assert.deepEqual(numAxisSplits(null, 0, 2 ** 53 - 1, 2 ** 53, 1), [2 ** 53 - 1, 2 ** 53]);
		assert.deepEqual(numAxisSplits(null, 0, 0.1, 1, 1), [1]);
		assert.deepEqual(numAxisSplits(null, 0, 0.1, 1.5, 1), [1]);
		assert.deepEqual(numAxisSplits(null, 0, -0, 1, 1), [0, 1]);
	},

	// Exact invalid custom range from https://github.com/leeoniya/uPlot/issues/620 .
	// Safety check only; this does not promise support for invalid custom ranges.
	'620-equal-range'() {
		return numericChart([[0, 1], [1, 1]], u => {
			assert.ok((u.axes[1]._splits?.length ?? 0) <= 1);
		}, { range: [1, 1] });
	},

	// Exact minimal data/ranger from the reporter's follow-up (not opening-post typos):
	// https://github.com/leeoniya/uPlot/issues/1084#issuecomment-3229683387
	'1084-custom-flat'() {
		return chart({
			width: 100, height: 100,
			scales: { x: {}, y: { range: (_u, min, max) => {
				if (!Number.isFinite(min) || !Number.isFinite(max))
					return [0, 1];
				const pad = (max - min) * 0.1;
				return [min - pad, max + pad];
			} } },
		}, [[0], [5]], u => {
			assert.ok((u.axes[1]._splits?.length ?? 0) <= 1);
		});
	},

	// Exact extrema parsed from the 658-value attachment, reduced to two points:
	// https://github.com/leeoniya/uPlot/issues/1135#issuecomment-4802330086
	// https://github.com/user-attachments/files/29349829/uplot-tick-totality-repro.html
	'1135-auto-y'() {
		const min = 2.7000000476837114, max = 2.7000000476837194;
		return numericChart([[0, 1], [min, max]], u => checkNumericChart(u, min, max));
	},
	'1135-explicit-y'() {
		const min = 2.7000000476837114, max = 2.7000000476837194;
		return numericChart([[0, 1], [min, max]], u => {
			if (u.axes[1]._splits?.length)
				ordered(u.axes[1]._splits, min, max);
		}, { range: (_u, min, max) => [min, max] });
	},

	// Exact synthetic X attachment (not the reporter's real-world Y dataset):
	// https://github.com/leeoniya/uPlot/issues/1135
	// https://github.com/user-attachments/files/29327341/x-zoom.html
	'1135-explicit-x'() {
		const xs = Array.from({ length: 200 }, (_, i) => 1e18 + i * 5e3);
		const ys = xs.map((_, i) => 50 + 40 * Math.sin(i / 10));
		return numericChart([xs, ys], async u => {
			u.setScale('x', { min: 1e18, max: 1e18 + 200 });
			await Promise.resolve();
			if (u.axes[0]._splits?.length)
				ordered(u.axes[0]._splits, u.scales.x.min, u.scales.x.max);
		}, { range: () => [0, 100] });
	},
};

const name = process.argv[2];
try {
	assert.ok(Object.hasOwn(probes, name), `unknown precision probe: ${name}`);
	// Let the parent arm its execution timer after imports, before the probe runs.
	if (process.send) {
		await new Promise(resolve => {
			process.once('message', resolve);
			process.send('ready');
		});
	}
	await probes[name]();
	console.log(JSON.stringify({ probe: name, ok: true }));
	process.exit(0);
}
catch (error) {
	console.error(String(error.stack ?? error).slice(0, 2000));
	process.exit(1);
}
