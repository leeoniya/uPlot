import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { rangeY, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits, numIncrs } from '../src/opts.js';

const noAffinity = { zeroIf: 0, min: { soft: null }, max: { soft: null } };
// Isolate selection regressions whose anchors depend on the unpadded natural grid.
const unpadded = { min: { pad: 0 }, max: { pad: 0 } };
const unpaddedNoAffinity = { zeroIf: 0, min: { pad: 0, soft: null }, max: { pad: 0, soft: null } };

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
	// Default padding expands [13, 87] to [5.6, 94.4], so step 10 now needs ten intervals.
	for (const [data, approximate, exact] of [
		[[13, 87], { min: 0, max: 100, incr: 10, count: 10 }, { min: 0, max: 160, incr: 20, count: 8 }],
		[[-87, -13], { min: -100, max: 0, incr: 10, count: 10 }, { min: -160, max: 0, incr: 20, count: 8 }],
	]) {
		it(`defaults omitted exactCount to the tighter approximate range for ${data}`, () => {
			const omitted = rangeY(...data, 400);
			assert.deepEqual(omitted, approximate);
			assert.deepEqual(omitted, checked(data));
			const optedIn = rangeY(...data, 400, undefined, 1, true);
			assert.deepEqual(optedIn, exact);
			assert.notEqual(omitted.count, optedIn.count);
			assert.ok(omitted.max - omitted.min < optedIn.max - optedIn.min);
		});
	}

	it('tightens bounds without new increments', () => {
		assert.deepEqual(checked([13, 87]), { min: 0, max: 100, incr: 10, count: 10 });
		assert.deepEqual(checked([13, 87], 400, noAffinity), { min: 0, max: 100, incr: 10, count: 10 });
		assert.deepEqual(checked([13, 87], 400, unpaddedNoAffinity), { min: 10, max: 90, incr: 10, count: 8 });
		assert.deepEqual(checked([-87, -13]), { min: -100, max: 0, incr: 10, count: 10 });
	});

	// Omit zeroIf, but disable padding and soft anchors to expose its 10% threshold.
	for (const [data, expected] of [
		[[10, 110], { min: 0, max: 110, incr: 5, count: 22 }],
		[[11, 111], { min: 10, max: 115, incr: 5, count: 21 }],
		[[-110, -10], { min: -110, max: 0, incr: 5, count: 22 }],
		[[-111, -11], { min: -115, max: -10, incr: 5, count: 21 }],
	]) {
		it(`uses the default zero affinity threshold for ${data}`, () => {
			const policy = { min: { pad: 0, soft: null }, max: { pad: 0, soft: null } };
			assert.deepEqual(checked(data, 1000, policy), expected);
		});
	}

	it('allows counts above and below the target for independent ranges', () => {
		assert.equal(checked([13, 87]).count, 10);
		assert.equal(checked([112, 126]).count, 7);
	});

	for (const [data, expected] of [
		[[-880, -240], { min: -1000, max: 0, incr: 500, count: 2 }],
		[[240, 880], { min: 0, max: 1000, incr: 500, count: 2 }],
		[[-6e6, 2e6], { min: -1e7, max: 1e7, incr: 1e7, count: 2 }],
		[[-2e6, 6e6], { min: -1e7, max: 1e7, incr: 1e7, count: 2 }],
	]) {
		for (const mag of [1e-6, 1, 1e6]) {
			it(`uses rounded counts to avoid a dense grid for ${data} scaled by ${mag} at 51px`, () => {
				assert.equal(rangeYCount(51), 2);
				const scaled = data.map(value => value * mag);
				for (const policy of [undefined, noAffinity]) {
					assert.deepEqual(checked(scaled, 51, policy), {
						min: expected.min * mag,
						max: expected.max * mag,
						incr: expected.incr * mag,
						count: expected.count,
					});
				}
			});
		}
	}

	it('prefers one interval (two ticks) over three intervals on a count-error tie', () => {
		assert.equal(rangeYCount(51), 2);
		// Step 5 gives three intervals; the hard limit rejects two-interval grids before step 25.
		const positive = { zeroIf: 0, min: { soft: null }, max: { hard: 25, soft: null } };
		assert.deepEqual(checked([11, 24], 51, positive), { min: 0, max: 25, incr: 25, count: 1 });
		const negative = { zeroIf: 0, min: { hard: -25, soft: null }, max: { soft: null } };
		assert.deepEqual(checked([-24, -11], 51, negative), { min: -25, max: 0, incr: 25, count: 1 });
	});

	it('retains the closest dense fallback when hard limits reject all sparse grids', () => {
		assert.equal(rangeYCount(51), 2);
		const policy = { zeroIf: 0, min: { hard: -10, soft: null }, max: { hard: 5, soft: null } };
		assert.deepEqual(checked([-6, 2], 51, policy), { min: -10, max: 5, incr: 5, count: 3 });
		const mirrored = { zeroIf: 0, min: { hard: -5, soft: null }, max: { hard: 10, soft: null } };
		assert.deepEqual(checked([-2, 6], 51, mirrored), { min: -5, max: 10, incr: 5, count: 3 });
	});

	for (const height of [40, 51, 75, 99]) {
		it(`uses at most two intervals for unconstrained data at ${height}px`, () => {
			const target = rangeYCount(height);
			assert.equal(target, 2);
			const values = [-880, -600, -240, -200, -60, 0, 60, 200, 240, 600, 880];
			for (const mag of [1e-6, 1, 1e4]) {
				for (let i = 0; i < values.length; i++) {
					for (let j = i + 1; j < values.length; j++) {
						const data = [values[i] * mag, values[j] * mag];
						for (const policy of [undefined, noAffinity]) {
							const r = checked(data, height, policy);
							const context = `${data}, height ${height}, policy ${JSON.stringify(policy)}`;
							assert.ok(r.min <= data[0] && r.max >= data[1], `encloses ${context}`);
							assert.ok(r.count <= target, `${r.count} intervals exceed target ${target}: ${context}`);
						}
					}
				}
			}
		});
	}

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
		// The anchor still requires step 5; default padding extends the other bound past 70.
		const policy = { zeroIf: 0, min: { soft: 5, mode: 1 }, max: { soft: null } };
		assert.deepEqual(checked([16, 69], 400, policy), { min: 5, max: 75, incr: 5, count: 14 });
		const negative = { zeroIf: 0, min: { soft: null }, max: { soft: -5, mode: 1 } };
		assert.deepEqual(checked([-69, -16], 400, negative), { min: -75, max: -5, incr: 5, count: 14 });
	});

	it('retains the unpadded natural grid when zero affinity is already satisfied', () => {
		assert.deepEqual(checked([1, 54], 400, unpadded), { min: 0, max: 60, incr: 10, count: 6 });
		assert.deepEqual(checked([1, 54], 400, unpadded), checked([1, 54], 400, unpaddedNoAffinity));
		assert.deepEqual(checked([-54, -1], 400, unpadded), { min: -60, max: 0, incr: 10, count: 6 });
	});

	it('activates a reached soft anchor on the coarser natural grid and retains an already satisfied anchor', () => {
		assert.deepEqual(checked([6, 59], 400, unpaddedNoAffinity), { min: 0, max: 60, incr: 10, count: 6 });
		assert.deepEqual(checked([-59, -6], 400, unpaddedNoAffinity), { min: -60, max: 0, incr: 10, count: 6 });
		// The natural grid reaches 5 (or -5), activating mode 3 and requiring step 5.
		for (const max of [{ pad: 0, soft: null }, { pad: 0, soft: 60, mode: 1 }]) {
			const policy = { zeroIf: 0, min: { pad: 0, soft: 5, mode: 3 }, max };
			assert.deepEqual(checked([6, 59], 400, policy), { min: 5, max: 60, incr: 5, count: 11 });
		}
		const negative = { zeroIf: 0, min: { pad: 0, soft: null }, max: { pad: 0, soft: -5, mode: 3 } };
		assert.deepEqual(checked([-59, -6], 400, negative), { min: -60, max: -5, incr: 5, count: 11 });
	});

	it('retains hard limits without forcing data to reach them', () => {
		// The padded grid reaches 100; keep the hard maximum beyond it to test non-forcing.
		assert.deepEqual(bounds(checked([13, 87], 400, { min: { hard: 0 }, max: { hard: 200 } })), [0, 100]);
		assert.deepEqual(bounds(checked([-20, 80], 400, { min: { hard: 0 }, max: { hard: 50 } })), [0, 50]);
	});

	it('keeps active soft anchors ahead of zero affinity', () => {
		assert.equal(checked([13, 87], 400, { min: { soft: -10, mode: 1 } }).min, -10);
		assert.equal(checked([-87, -13], 400, { max: { soft: 10, mode: 1 } }).max, 10);
		assert.deepEqual(bounds(checked([13, 87], 400, { min: { soft: 0, mode: 1 }, max: { soft: 100, mode: 1 } })), [0, 100]);
	});

	it('respects soft-mode activation on the natural approximate bounds', () => {
		for (const [mode, minimum] of [[0, 30], [1, 0], [2, 0], [3, 30]])
			assert.equal(checked([30, 50], 400, { zeroIf: 0, min: { pad: 0, soft: 0, mode }, max: { pad: 0 } }).min, minimum);

		for (const mode of [0, 1, 2, 3]) {
			const active = mode == 1 || mode == 3;
			const policy = { zeroIf: 0, min: { pad: 0, soft: 5, mode }, max: { pad: 0, soft: null } };
			assert.deepEqual(checked([6, 59], 400, policy), active
				? { min: 5, max: 60, incr: 5, count: 11 }
				: { min: 0, max: 60, incr: 10, count: 6 });
			const negative = { zeroIf: 0, min: { pad: 0, soft: null }, max: { pad: 0, soft: -5, mode } };
			assert.deepEqual(checked([-59, -6], 400, negative), active
				? { min: -60, max: -5, incr: 5, count: 11 }
				: { min: -60, max: 0, incr: 10, count: 6 });
		}
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
