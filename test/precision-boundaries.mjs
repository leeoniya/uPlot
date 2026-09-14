import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import { incrRound, incrRoundUp, incrRoundDn, numIntDigits, rangeNum, roundDec } from '../src/utils.js';
import { numIncrs } from '../src/opts.js';
import uPlot from '../src/uPlot.js';

// Positive finite inputs only; shared views avoid arithmetic estimates of an ULP.
function adjacent(value, direction) {
	const float = new Float64Array([value]);
	const bits = new BigUint64Array(float.buffer);
	bits[0] += BigInt(direction);
	return float[0];
}

describe('precision: canonical decimal boundaries', () => {
	it('counts both signs at decimal boundaries in the built-in increment range', () => {
		const failures = [];
		for (let exp = 1; exp <= 32; exp++) {
			// Canonical thresholds, not exact binary-integer digit counts: e.g. 1e23
			// represents an integer below mathematical 10^23 but starts magnitude 24.

			const threshold = Number('1e' + exp);
			for (const [value, expected] of [
				[adjacent(threshold, -1), exp],
				[threshold, exp + 1],
				[adjacent(threshold, 1), exp + 1],
			]) {
				for (const sign of [-1, 1]) {
					const actual = numIntDigits(sign * value);
					if (actual !== expected)
						failures.push({ exp, value: sign * value, expected, actual });
				}
			}
		}
		assert.deepEqual(failures.slice(0, 12), [], `${failures.length} boundary mismatches; showing at most 12`);
	});

	it('preserves the remaining Grafana frequency samples at excess decimal precision', () => {
		// Other two measurements from Grafana #116559; precision-rounding covers the first.
		for (const value of [9999999.999959, 9999999.999753])
			for (const sign of [-1, 1])
				for (const places of [16, 24])
					assert.equal(roundDec(sign * value, places), sign * value, `${sign * value}, ${places} places`);
	});

	it('rounds signed decimal ties to nearest with halves away from zero', () => {
		for (const [value, places, expected] of [[1.015, 2, 1.02], [10.075, 2, 10.08], [0.000125, 5, 0.00013]])
			for (const sign of [-1, 1])
				assert.equal(roundDec(sign * value, places), sign * expected, `${sign * value}, ${places} places`);
	});

	it('preserves tiny half-step decisions and their adjacent representable values', () => {
		for (const [midpoint, places, down, up] of [
			[1.25e-24, 25, 1.2e-24, 1.3e-24],
			[1.005e-22, 24, 1e-22, 1.01e-22],
			[2.625e-23, 25, 2.62e-23, 2.63e-23],
		]) {
			for (const sign of [-1, 1]) {
				assert.equal(roundDec(sign * adjacent(midpoint, -1), places), sign * down);
				assert.equal(roundDec(sign * midpoint, places), sign * up);
				assert.equal(roundDec(sign * adjacent(midpoint, 1), places), sign * up);
			}
		}
	});

	it('does not bias a genuine below-half fraction across an integer rounding boundary', () => {
		for (const sign of [-1, 1])
			assert.equal(roundDec(sign * 100000000000000.48, 0), sign * 100000000000000);
	});

	it('still rounds nonintegers at magnitudes with no spare decimal precision', () => {
		for (const [value, expected] of [[1000000000000000.4, 1000000000000000], [1000000000000000.6, 1000000000000001]])
			for (const sign of [-1, 1])
				assert.equal(roundDec(sign * value, 0), sign * expected);
	});

	it('does not erase real fractional quotients before increment ceil and floor', () => {
		assert.equal(incrRoundUp(300000000000000.1, 1), 300000000000001);
		assert.equal(incrRoundDn(300000000000000.1, 1), 300000000000000);
		assert.equal(incrRoundUp(-300000000000000.1, 1), -300000000000000);
		assert.equal(incrRoundDn(-300000000000000.1, 1), -300000000000001);
	});

	it('preserves exact decimal grids when quotient error exceeds a fixed absolute tolerance', () => {
		assert.equal(incrRoundDn(100000000.1, 0.1), 100000000.1);
		assert.equal(incrRoundUp(-100000000.1, 0.1), -100000000.1);
		assert.equal(roundDec(10000000.075, 2), 10000000.08);
		assert.equal(roundDec(-10000000.075, 2), -10000000.08);
		for (const round of [incrRound, incrRoundUp, incrRoundDn])
			for (const sign of [-1, 1])
				assert.equal(round(sign * 300000000000000.1, 0.1), sign * 300000000000000.1);

	});

	it('leaves decimal requests unchanged beyond the 15-digit budget', () => {
		for (const [value, places] of [[100000000000000.25, 1], [1.2345678901234567, 15], [0.45035996273704965, 16]])
			for (const sign of [-1, 1])
				assert.equal(roundDec(sign * value, places), sign * value);
	});

	it('leaves sub-resolution grids unchanged instead of adding divide/multiply drift', () => {
		for (const round of [incrRound, incrRoundUp, incrRoundDn])
			for (const value of [100, -100, 1.2345678901234567])
				assert.equal(round(value, 1e-17), value);
		assert.equal(incrRoundUp(45035996.273704916, 1e-8), 45035996.273704916);
	});

	it('returns canonical tiny decimal grid multiples rather than multiplication residue', () => {
		// Literal expectations are independent of quotient/product arithmetic.
		for (const [value, increment, expected] of [
			[7.5e-25, 2.5e-25, 7.5e-25],
			[6e-21, 2e-21, 6e-21],
			[1.4e-23, 2e-24, 1.4e-23],
		]) {
			assert.ok(numIncrs.includes(increment));
			for (const sign of [-1, 1])
				for (const round of [incrRound, incrRoundUp, incrRoundDn])
					assert.equal(round(sign * value, increment), sign * expected, `${round.name}(${sign * value}, ${increment})`);
		}
	});

	it('retains an intentional flat-range cutoff for negligible variations', () => {
		for (const [low, high] of [[1, 1 + 1e-13], [1e7, 1e7 + 1e-6], [1e-30, 2e-30]]) {
			const bounds = rangeNum(low, high, 0.1, true);
			assert.ok(bounds[0] <= low && bounds[1] >= high);
			assert.ok(bounds[1] - bounds[0] >= 4 * (high - low), `expected flat fallback for ${low}..${high}`);
		}
	});

	it('preserves legacy flat bounds by default and with an explicit threshold', () => {
		for (const [low, high, extent] of [[9.9999999, 10.0000001, 20], [9999999.999753, 10000000.000027, 20000000], [0.9999999, 1, 2]]) {
			for (const sign of [-1, 1]) {
				const min = sign < 0 ? -high : low;
				const max = sign < 0 ? -low : high;
				const expected = sign < 0 ? [-extent, 0] : [0, extent];
				assert.deepEqual(rangeNum(min, max, 0.1, true), expected);
				for (const flat of [undefined, 1e-7])
					assert.deepEqual(rangeNum(min, max, {
						flat,
						min: { pad: 0.1, soft: 0, mode: 3 },
						max: { pad: 0.1, soft: 0, mode: 3 },
					}), expected);
			}
		}
	});

	it('disables only relative flattening with flat: 0', () => {
		const config = { flat: 0, min: { pad: 0.1 }, max: { pad: 0.1 } };
		for (const [low, high] of [[9.9999999, 10.0000001], [-10.0000001, -9.9999999]]) {
			const bounds = rangeNum(low, high, config);
			assert.ok(bounds[0] <= low && bounds[1] >= high);
			assert.ok(bounds[1] - bounds[0] < 2 * (high - low));
		}
		assert.deepEqual(rangeNum(10, 10, config), [0, 20]);
		const bounds = rangeNum(1e-30, 2e-30, config);
		assert.ok(bounds[0] <= 1e-30 && bounds[1] >= 2e-30);
		assert.ok(bounds[1] - bounds[0] >= 4e-30);
	});

	it('retains hard limits when normalizing relatively flat values', () => {
		assert.deepEqual(rangeNum(9.9999999, 10.0000001, {
			min: { hard: 9 },
			max: { hard: 11 },
		}), [9, 11]);
	});

	it('applies the threshold independently through scale range options', async () => {
		const values = [9999999.999753, 10000000.000027];
		const u = new uPlot({
			width: 400, height: 300,
			scales: {
				x: { time: false },
				fine: { range: { flat: 1e-12, min: { pad: 0.1 }, max: { pad: 0.1 } } },
			},
			series: [{}, {}, { scale: 'fine' }],
		}, [[0, 1], values, values], document.body);
		try {
			await Promise.resolve();
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [0, 20000000]);
			assert.ok(u.scales.fine.min <= values[0] && u.scales.fine.max >= values[1]);
			assert.ok(u.scales.fine.max - u.scales.fine.min < 2 * (values[1] - values[0]));
		}
		finally {
			u.destroy();
		}
	});

	it('keeps derived near-flat ranges bounded by their actual variation on both signs', () => {
		const config = {
			flat: 1e-12,
			min: { pad: 0.1, hard: -Infinity, soft: 0, mode: 3 },
			max: { pad: 0.1, hard: Infinity, soft: 0, mode: 3 },
		};
		for (const [low, high] of [[19.9999999, 20.0000001], [9999999.999959, 10000000.000027]]) {
			for (const sign of [-1, 1]) {
				const min = sign < 0 ? -high : low;
				const max = sign < 0 ? -low : high;
				const bounds = rangeNum(min, max, config);
				const detail = `${min}..${max} -> ${bounds}`;
				assert.ok(bounds.every(Number.isFinite), detail);
				assert.ok(bounds[0] <= min && bounds[1] >= max, detail);
				// Fixture-specific limit, not a promise for constant data or all ranges.
				assert.ok(bounds[1] > bounds[0] && bounds[1] - bounds[0] < 2 * (max - min), detail);
			}
		}
	});
});
