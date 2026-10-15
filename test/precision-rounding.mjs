import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { incrRound, incrRoundUp, incrRoundDn, roundDec, rangeNum, fixedDec, numIntDigits } from '../src/utils.js';
import { numIncrs } from '../src/opts.js';


const rounders = [incrRound, incrRoundUp, incrRoundDn];

// Historical fixtures now exercise grid-aware rounding without a private cleanup helper.
describe('precision: increment and decimal rounding', () => {
	// Maintainer-provided expected results, not snapshots of the current implementation:
	// https://github.com/leeoniya/uPlot/issues/771#issuecomment-1340294297
	for (const [value, increment, expected] of [
		[-0.6, 0.1, [-0.6, -0.6, -0.6]],
		[-0.6, 0.2, [-0.6, -0.6, -0.6]],
		[-0.7, 0.1, [-0.7, -0.7, -0.7]],
		[-0.7, 0.2, [-0.8, -0.6, -0.8]],
	]) {
		it(`#771 rounds ${value} by ${increment} before and after integer snapping`, () => {
			assert.deepEqual(rounders.map(round => round(value, increment)), expected);
		});
	}

	// Derived cases: positive counterparts and a quotient with multiplication residue.
	for (const [value, increment, expected] of [
		[0.6, 0.1, [0.6, 0.6, 0.6]],
		[0.6, 0.2, [0.6, 0.6, 0.6]],
		[0.7, 0.1, [0.7, 0.7, 0.7]],
		[0.7, 0.2, [0.8, 0.8, 0.6]],
		[0.3, 0.1, [0.3, 0.3, 0.3]],
	]) {
		it(`preserves the derived signed-grid contract for ${value} / ${increment}`, () => {
			assert.deepEqual(rounders.map(round => round(value, increment)), expected);
		});
	}

	// The input is the fixFloat comment's example in b2433b4. The increment is derived.
	// https://github.com/leeoniya/uPlot/commit/b2433b4c2de735e88917f7cfefcfe24b0aa0f3e9
	it('b2433b4 cleans 17999.204999999998 on a 0.001 grid', () => {
		assert.deepEqual(rounders.map(round => round(17999.204999999998, 0.001)), [17999.205, 17999.205, 17999.205]);
	});

	it('b2433b4 preserves tiny decimal increments instead of rounding to 14 places', () => {
		for (const value of [1e-15, 1e-20, 1e-24, 1e-32, 2.5e-32]) {
			assert.ok(numIncrs.includes(value));
			assert.ok(fixedDec.has(value));
			for (const sign of [-1, 1])
				for (const round of rounders)
					assert.equal(round(sign * value, value), sign * value);
		}
	});

	it('b2433b4 cleans the exponent-form residue from its source comment', () => {
		// Use the literal: Math.pow(10, -24) varies between JavaScript engines.
		for (const round of rounders)
			assert.equal(round(1.0000000000000001e-24, 1e-25), 1e-24);
	});

	it('b2433b4 generates canonical decimal increments and precision metadata', () => {
		// Independent decimal literals/metadata, including the 2.5 multiplier's extra digit.
		for (const [value, places] of [[1e-24, 24], [2.5e-24, 25], [2.5e-3, 4], [0.25, 2], [2.5, 1], [25, 0]]) {
			assert.ok(numIncrs.includes(value));
			assert.equal(fixedDec.get(value), places);
		}
	});

	// Derived decimal tie cases for the half-away-from-zero contract added in c801838d.
	// https://github.com/leeoniya/uPlot/commit/c801838d4611eec62a532b5b728c72ee8a5cf4d0
	it('c801838d rounds decimal ties away from zero on both signs', () => {
		for (const [value, expected] of [[1.005, 1.01], [1.255, 1.26], [2.675, 2.68]]) {
			assert.equal(roundDec(value, 2), expected);
			assert.equal(roundDec(-value, 2), -expected);
		}
		assert.equal(roundDec(3.5), 4);
		assert.equal(roundDec(-3.5), -4);
	});

	it('c801838d leaves integers unchanged at excessive decimal precision', () => {
		for (const value of [0, -0, 1, -1, 1e14, Number.MAX_SAFE_INTEGER])
			assert.equal(roundDec(value, 24), value);
	});

	// The 2025 partial-log-range fix intentionally allows callers to bypass cleanup.
	// https://github.com/leeoniya/uPlot/commit/0575cab101aa600dc0cd1e9b0085811bcdd62ce4
	it('0575cab1 preserves the explicit fixFloat bypass', () => {
		const value = -0.6, increment = 0.2;
		assert.equal(incrRound(value, increment, false), roundDec(value / increment) * increment);
		assert.equal(incrRoundUp(value, increment, false), Math.ceil(value / increment) * increment);
		assert.equal(incrRoundDn(value, increment, false), Math.floor(value / increment) * increment);
		assert.notEqual(incrRoundUp(value, increment, false), incrRoundUp(value, increment));
	});
});

// https://github.com/leeoniya/uPlot/pull/1142
// Derived boundary cases for the proposed int32 digit-count correction.
describe('precision: PR #1142 integer digit counts', () => {
	it('preserves the small-value and int32-boundary contract', () => {
		for (const [value, digits] of [[0, 1], [0.1, 1], [9, 1], [10, 2], [99, 2], [100, 3], [2147483647, 10], [2147483648, 10]]) {
			assert.equal(numIntDigits(value), digits);
			assert.equal(numIntDigits(-value), digits);
		}
	});

	it('counts values near 2^32 without int32 wraparound', () => {
		for (const value of [4294967295, 4294967296, 4294967297]) {
			assert.equal(numIntDigits(value), 10);
			assert.equal(numIntDigits(-value), 10);
		}
	});

	it('counts 1e14, 1e18, and 1e21 on both signs', () => {
		for (const [value, digits] of [[1e14, 15], [1e18, 19], [1e21, 22]]) {
			assert.equal(numIntDigits(value), digits);
			assert.equal(numIntDigits(-value), digits);
		}
	});

	// Existing #1135 endpoint, with the increment observed during its chart probe.
	// This must remain a cheap test: running all the misplaced ticks exhausts memory.
	it('#1135 does not move the first tick far below the requested minimum', () => {
		const min = 2.7000000476837114;
		const start = roundDec(incrRoundUp(min, 1e-15), 15);
		assert.ok(start >= min && start <= min + 2e-15, `misplaced first tick: ${start}`);
	});

	// The PR's abs/log10 implementation also fails this exact representable integer.
	it('does not overcount 999999999999999 when log10 rounds up', () => {
		assert.equal(numIntDigits(999999999999999), 15);
		assert.equal(numIntDigits(-999999999999999), 15);
	});
});

const grafanaRange = {
	flat: 1e-12,
	zeroIf: 0.1,
	min: { pad: 0.1, hard: -Infinity },
	max: { pad: 0.1, hard: Infinity },
};

function contains(bounds, values) {
	assert.ok(bounds.every(Number.isFinite), `nonfinite range: ${bounds}`);
	assert.ok(bounds[1] > bounds[0], `collapsed range: ${bounds}`);
	assert.ok(bounds[0] <= Math.min(...values) && bounds[1] >= Math.max(...values), `range excludes data: ${bounds}`);
}

function preservesVariation(values) {
	const min = Math.min(...values), max = Math.max(...values);
	const bounds = rangeNum(min, max, grafanaRange);
	contains(bounds, values);
	// Derived acceptance limit for these fixtures, NOT a general rangeNum promise.
	assert.ok(bounds[1] - bounds[0] < 2 * (max - min), `range ${bounds} hides variation ${max - min}`);
}

describe('precision: linear range history and Grafana #116559', () => {
	// a4edb297 lowered the flat-data floor from 1e-9 to 1e-24 and raised precision to 24.
	// These decimal ranges are derived from that change, not issue-provided datasets.
	// https://github.com/leeoniya/uPlot/commit/a4edb297a9b80baf781f4d05a40fb52fae737bff
	for (const values of [[1e-12, 2e-12], [-2e-12, -1e-12], [1e-20, 2e-20]])
		it(`a4edb297 preserves a nonflat range ${values}`, () => preservesVariation(values));

	// Exact inputs from the five-panel dashboard:
	// https://github.com/grafana/grafana/issues/116559#issuecomment-4111259061
	it('Grafana #116559 ordinary-range control remains [34, 53]', () => {
		assert.deepEqual(rangeNum(36, 51, grafanaRange), [34, 53]);
	});

	it('Grafana #116559 genuinely constant control still has a usable range', () => {
		assert.deepEqual(rangeNum(10, 10, grafanaRange), [0, 20]);
	});

	it('Grafana #116559 preserves the reported 9.999999 to 10.000001 control', () => {
		preservesVariation([9.999999, 10.000001]);
	});

	// Do not freeze the wide fallback as the desired precision-preserving answer.
	// Require only its original safety contract: finite, nonzero, containing bounds.
	// https://github.com/leeoniya/uPlot/commit/6a3de08db3976fb0348f9ee57839f85599748b35
	// https://github.com/grafana/grafana/issues/122055
	it('6a3de08 / Grafana #122055 never returns collapsed bounds around +/-1 or +/-10', () => {
		for (const values of [[0.9999999, 1], [0.9999999, 1.0000001], [9.9999999, 10.0000001], [-1, -0.9999999]])
			contains(rangeNum(Math.min(...values), Math.max(...values), grafanaRange), values);
	});

	// True data variations must not be mistaken for runs of arithmetic noise.
	it('Grafana #116559 preserves 9.9999999 to 10.0000001 rather than expanding to [0, 20]', () => {
		preservesVariation([9.9999999, 10.0000001]);
	});

	// Exact frequency triplet from the snapshot dashboard. The 60-row snapshot repeats it.
	// https://github.com/grafana/grafana/issues/116559#issuecomment-4013257350
	it('Grafana #116559 preserves the original 10 MHz measurements', () => {
		preservesVariation([10000000.000027, 9999999.999959, 9999999.999753]);
	});

	// Derived fidelity checks from the same sourced measurements. Requested precision
	// exceeds meaningful decimal digits; the EPSILON multiplication currently moves them.
	for (const value of [9.9999999, 10.0000001, 10000000.000027]) {
		it(`Grafana #116559 roundDec(${value}, 24) does not add float drift`, () => {
			assert.equal(roundDec(value, 24), value);
		});
	}
});
