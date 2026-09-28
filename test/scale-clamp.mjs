import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function toData(mode, values) {
	const aligned = [values.map((v, i) => i + 1), values];
	return mode == 1 ? aligned : [null, aligned];
}

function plot(mode, y, values, scales = {}) {
	return new uPlot({
		width: 600,
		height: 400,
		mode,
		scales: {
			x: { time: false },
			y: { distr: 4, range: () => [-10, 10], ...y },
			...scales,
		},
		series: [{}, { paths: () => null, points: { show: false } }],
	}, toData(mode, values), document.body);
}

function checkTransform(u, threshold, values = [-0.25, 0, 0.25, 2]) {
	const sc = u.scales.y;
	assert.equal(sc._asinh, threshold);
	assert.equal(sc._min, Math.asinh(sc.min / threshold));
	assert.equal(sc._max, Math.asinh(sc.max / threshold));
	for (const value of values) {
		const pct = (Math.asinh(value / threshold) - sc._min) / (sc._max - sc._min);
		assert.equal(sc.valToPct(value), pct);
		const roundTrip = u.posToVal(u.valToPos(value, 'y'), 'y');
		assert.ok(Math.abs(roundTrip - value) <= 1e-10 * (Math.abs(value) || threshold));
	}
}

describe('scale clamp', () => {
	for (const mode of [1, 2]) {
		it(`admits tiny nonzero values with default and zero cutoffs (mode ${mode})`, async () => {
			for (const options of [{}, { clamp: null }, { clamp: 0 }]) {
				const u = plot(mode, options, [0, -0, null, -1e-128, 1e-128, 2]);
				try {
					await Promise.resolve();
					assert.equal(typeof u.scales.y.clamp, 'function');
					assert.equal(u.scales.y.clamp(u, 0, -10, 10, 'y'), 0);
					checkTransform(u, 1e-128, [-1e-128, 0, 1e-128]);
					u.setData(toData(mode, [0, -0, null, -1e-129, 1e-129, 2]));
					await Promise.resolve();
					checkTransform(u, 1e-129, [-1e-129, 0, 1e-129]);
					u.setData(toData(mode, [0, -0, null]));
					await Promise.resolve();
					checkTransform(u, 1);
				}
				finally { u.destroy(); }
			}
		});

		it(`excludes absolute values at or below a numeric cutoff without clamping coordinates (mode ${mode})`, async () => {
			const above = 2 * (1 + Number.EPSILON);
			const u = plot(mode, { clamp: 2 }, [-2, 2, -0.25, 0, 0.25, 4]);
			try {
				await Promise.resolve();
				assert.equal(u.scales.y.clamp(u, 0, -10, 10, 'y'), 2);
				checkTransform(u, 4);
				for (const values of [[-2, 2, above], [-2, 2, -above]]) {
					u.setData(toData(mode, values));
					await Promise.resolve();
					checkTransform(u, above);
				}
				u.setData(toData(mode, [-2, 2, -0.25, 0, 0.25, null]));
				await Promise.resolve();
				checkTransform(u, 1);
			}
			finally { u.destroy(); }
		});

		it(`calls the cutoff once per adaptive calculation across same-range updates (mode ${mode})`, async () => {
			const calls = [];
			let cutoff = 0.5;
			const clamp = (...args) => {
				calls.push(args);
				return cutoff;
			};
			const u = plot(mode, { clamp }, [-8, -2, -0.5, 0, 0.5, 2, 8]);
			const check = (count, threshold) => {
				assert.equal(u.scales.y.clamp, clamp);
				assert.equal(calls.length, count);
				assert.deepEqual(calls[count - 1], [u, 0, -10, 10, 'y']);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [-10, 10]);
				checkTransform(u, threshold);
				assert.equal(calls.length, count, 'coordinate conversion must not call the cutoff');
			};
			try {
				await Promise.resolve();
				check(1, 2);
				for (const [resetScales, threshold, count] of [[true, 3, 2], [false, 4, 3]]) {
					cutoff = 1;
					u.setData(toData(mode, [-8, -threshold, -0.25, 0, 0.25, threshold, 8]), resetScales);
					if (!resetScales)
						u.redraw();
					await Promise.resolve();
					check(count, threshold);
				}
				cutoff = 4;
				u.setScale('x', { min: 1, max: 6 });
				await Promise.resolve();
				check(4, 8);
			}
			finally { u.destroy(); }
		});

		it(`bypasses the cutoff for numeric and callback asinh settings (mode ${mode})`, async () => {
			for (const custom of [false, true]) {
				const calls = [];
				const asinh = custom ? (...args) => { calls.push(args); return 2; } : 2;
				const u = plot(mode, {
					asinh,
					clamp: () => assert.fail('explicit asinh must bypass the cutoff'),
				}, [-0.01, 0, 0.01]);
				try {
					await Promise.resolve();
					checkTransform(u, 2);
					if (custom) {
						assert.equal(u.scales.y.asinh, asinh);
						assert.deepEqual(calls, [[u, 'y']]);
					}
					u.setData(toData(mode, [-8, 0, 8]));
					await Promise.resolve();
					checkTransform(u, 2);
					if (custom)
						assert.deepEqual(calls, [[u, 'y'], [u, 'y']]);
				}
				finally { u.destroy(); }
			}
		});

		it(`normalizes inherited and overridden dependent numeric clamps (mode ${mode})`, async () => {
			const u = plot(mode, { clamp: 2 }, [-8, 0, 8], {
				inherited: { from: 'y' },
				zero: { from: 'y', clamp: 0 },
				override: { from: 'y', clamp: 4 },
			});
			try {
				await Promise.resolve();
				for (const [key, expected] of [['y', 2], ['inherited', 2], ['zero', 0], ['override', 4]]) {
					const sc = u.scales[key];
					assert.equal(typeof sc.clamp, 'function');
					assert.equal(sc.clamp(u, 0, sc.min, sc.max, key), expected);
				}
				assert.equal(u.scales.inherited.clamp, u.scales.y.clamp);
			}
			finally { u.destroy(); }
		});

		it(`retains default and numeric log clamps only for nonpositive values (mode ${mode})`, async () => {
			for (const [options, replacement] of [[{}, 0.1], [{ clamp: null }, 0.1], [{ clamp: 0.25 }, 0.25], [{ clamp: 0 }, 0]]) {
				const u = plot(mode, { distr: 3, range: () => [1, 100], ...options }, [1, 10, 100]);
				try {
					await Promise.resolve();
					const sc = u.scales.y;
					for (const value of [-10, -0, 0])
						assert.equal(sc.valToPct(value), Math.log10(replacement) / 2);
					for (const value of [0.01, 1, 10, 100])
						assert.equal(sc.valToPct(value), Math.log10(value) / 2);
				}
				finally { u.destroy(); }
			}
		});

		it(`passes actual nonpositive log values to custom clamps (mode ${mode})`, async () => {
			const calls = [];
			const clamp = (...args) => {
				calls.push(args);
				return args[1] < 0 ? 0.01 : 0.1;
			};
			const u = plot(mode, { distr: 3, range: () => [1, 100], clamp }, [1, 10, 100]);
			try {
				await Promise.resolve();
				const sc = u.scales.y;
				assert.equal(sc.clamp, clamp);
				assert.equal(calls.length, 0);
				for (const value of [0.01, 1, 10, 100])
					assert.equal(sc.valToPct(value), Math.log10(value) / 2);
				assert.equal(calls.length, 0);
				for (const value of [-7, -0, 0]) {
					assert.equal(sc.valToPct(value), value < 0 ? -1 : -0.5);
					assert.deepEqual(calls.at(-1), [u, value, 1, 100, 'y']);
				}
				assert.equal(calls.length, 3);
			}
			finally { u.destroy(); }
		});
	}
});
