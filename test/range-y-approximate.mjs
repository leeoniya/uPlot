import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { rangeY } from '../src/rangeY.js';
import { numAxisSplits, numIncrs } from '../src/opts.js';

const noAffinity = { zeroIf: 0, min: { soft: null }, max: { soft: null } };

function checked(data, height = 400, policy, ramp = 1) {
	const result = rangeY(...data, height, policy, ramp, false);
	assert.ok(result, `supported range: ${data}, height ${height}, ramp ${ramp}`);
	const { min, max, incr, count } = result;
	assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max);
	assert.ok(Number.isSafeInteger(count) && count > 0);
	if (count > 1)
		assert.ok(numIncrs.includes(incr), `original nice increment: ${incr}`);
	const ticks = count == 1 ? [min, max] : numAxisSplits(null, 0, min, max, incr, 0, true);
	assert.equal(ticks.length, count + 1);
	assert.deepEqual([ticks[0], ticks.at(-1)], [min, max]);
	for (let i = 0; i < ticks.length; i++) {
		assert.ok(Math.abs((ticks[i] - min) / (max - min) - i / count) < 1e-10);
		if (i > 0)
			assert.ok(ticks[i] > ticks[i - 1]);
	}
	return result;
}

const bounds = result => [result.min, result.max];

describe('approximate Y interval counts', () => {
	it('preserves exact mode by default and tightens bounds without new increments', () => {
		assert.deepEqual(rangeY(13, 87, 400), { min: 0, max: 160, incr: 20, count: 8 });
		assert.deepEqual(rangeY(13, 87, 400, undefined, 1, true), rangeY(13, 87, 400));
		assert.deepEqual(checked([13, 87]), { min: 0, max: 90, incr: 10, count: 9 });
		assert.deepEqual(checked([13, 87], 400, noAffinity), { min: 10, max: 90, incr: 10, count: 8 });
		assert.deepEqual(checked([-87, -13]), { min: -90, max: 0, incr: 10, count: 9 });
	});

	it('allows counts above and below the target for independent ranges', () => {
		assert.equal(checked([13, 87]).count, 9);
		assert.equal(checked([112, 126]).count, 7);
	});

	for (const height of [1, 40, 125, 333, 400, 525, 1000]) {
		for (const ramp of [0, .25, 1, 2]) {
			it(`encloses data with endpoint ticks at ${height}px and ramp ${ramp}`, () => {
				for (const mag of [1e-12, .001, 1, 1000]) {
					for (const data of [[13, 87], [-87, -13], [-9, 71], [113, 127], [0, 0], [50, 50]]) {
						const scaled = data.map(value => value * mag);
						for (const policy of [undefined, noAffinity]) {
							const r = checked(scaled, height, policy, ramp);
							assert.ok(r.min <= scaled[0] && r.max >= scaled[1]);
							if (ramp == 0 || height == 1)
								assert.equal(r.count, 1);
						}
					}
				}
			});
		}
	}

	it('tries the smaller neighbor when the preferred increment crosses hard limits', () => {
		const policy = { zeroIf: 0, min: { hard: 15, soft: null }, max: { hard: 85, soft: null } };
		assert.deepEqual(checked([15, 85], 400, policy), { min: 15, max: 85, incr: 5, count: 14 });
		const negative = { zeroIf: 0, min: { hard: -85, soft: null }, max: { hard: -15, soft: null } };
		assert.deepEqual(checked([-85, -15], 400, negative), { min: -85, max: -15, incr: 5, count: 14 });
	});

	it('tries the smaller neighbor when a newly required anchor rejects the preferred increment', () => {
		const policy = { zeroIf: 0, min: { soft: 5, mode: 1 }, max: { soft: null } };
		assert.deepEqual(checked([16, 69], 400, policy), { min: 5, max: 70, incr: 5, count: 13 });
		const negative = { zeroIf: 0, min: { soft: null }, max: { soft: -5, mode: 1 } };
		assert.deepEqual(checked([-69, -16], 400, negative), { min: -70, max: -5, incr: 5, count: 13 });
	});

	it('retains the natural grid when zero affinity is already satisfied', () => {
		assert.deepEqual(checked([1, 54]), { min: 0, max: 55, incr: 5, count: 11 });
		assert.deepEqual(checked([1, 54]), checked([1, 54], 400, noAffinity));
		assert.deepEqual(checked([-54, -1]), { min: -55, max: 0, incr: 5, count: 11 });
	});

	it('retains the natural grid when one or both soft anchors are already satisfied', () => {
		for (const max of [{ soft: null }, { soft: 60, mode: 1 }]) {
			const policy = { zeroIf: 0, min: { soft: 5, mode: 3 }, max };
			assert.deepEqual(checked([6, 59], 400, policy), { min: 5, max: 60, incr: 5, count: 11 });
		}
		const negative = { zeroIf: 0, min: { soft: null }, max: { soft: -5, mode: 3 } };
		assert.deepEqual(checked([-59, -6], 400, negative), { min: -60, max: -5, incr: 5, count: 11 });
	});

	it('retains hard limits without forcing data to reach them', () => {
		assert.deepEqual(bounds(checked([13, 87], 400, { min: { hard: 0 }, max: { hard: 100 } })), [0, 90]);
		assert.deepEqual(bounds(checked([-20, 80], 400, { min: { hard: 0 }, max: { hard: 50 } })), [0, 50]);
	});

	it('keeps active soft anchors ahead of zero affinity', () => {
		assert.equal(checked([13, 87], 400, { min: { soft: -10, mode: 1 } }).min, -10);
		assert.equal(checked([-87, -13], 400, { max: { soft: 10, mode: 1 } }).max, 10);
		assert.deepEqual(bounds(checked([13, 87], 400, { min: { soft: 0, mode: 1 }, max: { soft: 100, mode: 1 } })), [0, 100]);
	});

	it('respects soft-mode activation on the natural approximate bounds', () => {
		for (const [mode, minimum] of [[0, 30], [1, 0], [2, 0], [3, 30]])
			assert.equal(checked([30, 50], 400, { zeroIf: 0, min: { soft: 0, mode } }).min, minimum);
	});

	it('retains unsupported-input and empty-range behavior', () => {
		for (const ramp of [-1, NaN, Infinity])
			assert.equal(rangeY(13, 87, 400, undefined, ramp, false), null);
		for (const data of [[null, 1], [1, null], [NaN, 1], [1, Infinity], [2, 1]])
			assert.equal(rangeY(...data, 400, undefined, 1, false), null);
		assert.deepEqual(rangeY(null, null, 400, undefined, 1, false), { min: null, max: null, incr: 0, count: 0 });
		assert.equal(rangeY(-20, -10, 400, { min: { hard: 0 } }, 1, false), null);
		assert.equal(rangeY(20, 80, 400, { min: { soft: 1 / 3, mode: 1 } }, 1, false), null);
	});
});
