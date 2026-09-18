import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { rangeY, rangeYAuto, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits, numIncrs } from '../src/opts.js';

function checked(data, height, config) {
	const result = config === undefined ? rangeY(...data, height) : rangeY(...data, height, config);
	assert.ok(result, `supported fixture: ${data}, height ${height}`);
	assert.equal(result.count, rangeYCount(height));
	if (result.count > 1)
		assert.ok(numIncrs.includes(result.incr), `built-in increment: ${result.incr}`);

	const ticks = result.count == 1 ? [result.min, result.max] : numAxisSplits(null, 0, result.min, result.max, result.incr, 0, true);
	assert.equal(ticks.length, result.count + 1);
	assert.deepEqual([ticks[0], ticks.at(-1)], [result.min, result.max]);

	const span = result.max - result.min;
	for (let i = 0; i < ticks.length; i++) {
		const position = (ticks[i] - result.min) / span;
		assert.ok(Math.abs(position - i / result.count) < 1e-12, `tick ${i} is an equal interval`);
	}

	return result;
}

function bounds(result) {
	return [result.min, result.max];
}

function assertAnchor(result, side, value) {
	assert.equal(result[side], value, `${side} anchor is the exact outer tick`);
	assert.equal(value / result.incr, Math.round(value / result.incr), `${side} anchor aligns with ${result.incr}`);
}

function assertPadding(result, data, minPad, maxPad) {
	const rawSpan = data[1] - data[0];
	assert.ok(data[0] - result.min >= rawSpan * minPad, 'minimum-side padding uses the raw span');
	assert.ok(result.max - data[1] >= rawSpan * maxPad, 'maximum-side padding uses the raw span');
}

const noAffinity = {
	min: { soft: 0, mode: 3 },
	max: { soft: 0, mode: 3 },
};

describe('rangeY fourth-argument policy', () => {
	describe('default padding and zero affinity', () => {
		it('defaults each side to zero padding and applies zero affinity as a separate rule', () => {
			assert.ok(Object.isFrozen(rangeYAuto));
			assert.ok(Object.isFrozen(rangeYAuto.min));
			assert.ok(Object.isFrozen(rangeYAuto.max));
			assert.equal(rangeYAuto.min.pad, 0);
			assert.equal(rangeYAuto.max.pad, 0);

			const positive = checked([0.1, 1.1], 490);
			const positiveWithoutAffinity = checked([0.1, 1.1], 490, noAffinity);
			assert.deepEqual(bounds(positive), [0, 2]);
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, null)), bounds(positive));
			assert.deepEqual(bounds(positiveWithoutAffinity), [0.1, 1.1]);
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, {})), bounds(positiveWithoutAffinity));
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, { min: {}, max: {} })), bounds(positiveWithoutAffinity));

			const negative = checked([-1.1, -0.1], 490);
			const negativeWithoutAffinity = checked([-1.1, -0.1], 490, noAffinity);
			assert.deepEqual(bounds(negative), [-2, 0]);
			assert.deepEqual(bounds(negativeWithoutAffinity), [-1.1, -0.1]);
		});

		it('makes zero the outer endpoint at the exact 10% threshold', () => {
			assert.deepEqual(bounds(checked([10, 110], 543)), [0, 110]);
			assert.deepEqual(bounds(checked([-110, -10], 490)), [-200, 0]);
			assert.equal(checked([0.001, 0.011], 543).min, 0, 'decimal cancellation does not miss the threshold');
			assert.equal(checked([-0.011, -0.001], 543).max, 0, 'negative decimal threshold is symmetric');
		});

		it('does not force zero just over the 10% threshold', () => {
			assert.deepEqual(bounds(checked([10.0001, 110.0001], 543)), [10, 120]);
			assert.deepEqual(bounds(checked([-110.0001, -10.0001], 543)), [-120, -10]);
		});

		it('still permits zero to occur naturally outside the affinity threshold', () => {
			for (const data of [[0.100001, 1.100001], [-1.100001, -0.100001]]) {
				const automatic = checked(data, 490);
				const ordinaryGrid = checked(data, 490, noAffinity);
				assert.deepEqual(bounds(automatic), bounds(ordinaryGrid));
				assert.ok(automatic.min == 0 || automatic.max == 0);
			}
		});
	});

	describe('raw-span padding', () => {
		it('uses asymmetric minimum percentages on both signs and both sides', () => {
			const positiveData = [20, 80];
			const positive = checked(positiveData, 543, { min: { pad: 0.25 }, max: { pad: 0.5 } });
			assert.deepEqual(bounds(positive), [0, 110]);
			assertPadding(positive, positiveData, 0.25, 0.5);

			const negativeData = [-80, -20];
			const negative = checked(negativeData, 543, { min: { pad: 0.5 }, max: { pad: 0.25 } });
			assert.deepEqual(bounds(negative), [-110, 0]);
			assertPadding(negative, negativeData, 0.5, 0.25);
		});

		it('retains padding on one-interval axes', () => {
			const data = [-50, -1];
			const result = checked(data, 40, { min: { pad: 0.5 }, max: { pad: 0.5 } });
			assert.equal(result.count, 1);
			assertPadding(result, data, 0.5, 0.5);
		});

		it('lets an active hard or soft anchor override padding on that side', () => {
			const hard = checked([20, 80], 400, { min: { pad: 1e15, hard: 0 }, max: {} });
			assert.deepEqual(bounds(hard), [0, 80]);
			assertAnchor(hard, 'min', 0);
			assert.ok(20 - hard.min < (80 - 20) * 1e15);

			const soft = checked([-80, -20], 400, { min: {}, max: { pad: 1e15, soft: 0, mode: 1 } });
			assert.deepEqual(bounds(soft), [-80, 0]);
			assertAnchor(soft, 'max', 0);
			assert.ok(soft.max - -20 < (-20 - -80) * 1e15);
		});
	});

	describe('soft modes', () => {
		const cases = [
			['mode 0 never activates', 0, 0.1, false],
			['mode 1 activates while padding stays inside', 1, 0.1, true],
			['mode 1 activates after padding crosses the limit', 1, 0.3, true],
			['mode 2 activates while padding stays inside', 2, 0.1, true],
			['mode 2 does not activate after padding crosses the limit', 2, 0.3, false],
			['mode 3 does not activate while padding stays inside', 3, 0.1, false],
			['mode 3 activates after padding crosses the limit', 3, 0.3, true],
		];

		for (const [name, mode, pad, active] of cases) {
			it(`${name} on the minimum side`, () => {
				const result = checked([30, 50], 97, { min: { pad, soft: 25, mode }, max: {} });
				assert.deepEqual(bounds(result), active ? [25, 100] : [20, 50]);
				if (active)
					assertAnchor(result, 'min', 25);
				else
					assert.notEqual(result.min, 25);
			});

			it(`${name} on the maximum side`, () => {
				const result = checked([-50, -30], 97, { min: {}, max: { pad, soft: -25, mode } });
				assert.deepEqual(bounds(result), active ? [-100, -25] : [-50, -20]);
				if (active)
					assertAnchor(result, 'max', -25);
				else
					assert.notEqual(result.max, -25);
			});
		}
	});

	describe('hard limits, partial normalization, and alignment', () => {
		it('supports exact hard 0 and soft 0 outer ticks', () => {
			const hard = checked([-20, 80], 400, { min: { hard: 0 }, max: {} });
			assert.deepEqual(bounds(hard), [0, 80]);
			assertAnchor(hard, 'min', 0);

			const soft = checked([20, 80], 400, { min: { soft: 0, mode: 1 }, max: {} });
			assert.deepEqual(bounds(soft), [0, 80]);
			assertAnchor(soft, 'min', 0);
		});

		it('matches partial [0, null] normalization with a hard minimum and automatic maximum', () => {
			const config = {
				min: { mode: 1, hard: 0, soft: 0 },
				max: rangeYAuto.max,
			};
			const result = checked([20, 80], 400, config);
			assert.deepEqual(bounds(result), [0, 80]);
			assertAnchor(result, 'min', 0);
		});

		it('supports aligned nonzero hard and soft limits as exact outer ticks', () => {
			const hard = checked([-20, 80], 400, { min: { hard: 10 }, max: {} });
			assert.deepEqual(bounds(hard), [10, 90]);
			assertAnchor(hard, 'min', 10);

			const soft = checked([20, 80], 400, { min: { soft: 10, mode: 1 }, max: {} });
			assert.deepEqual(bounds(soft), [10, 90]);
			assertAnchor(soft, 'min', 10);
		});

		it('returns null when an active limit cannot align to a built-in increment', () => {
			assert.equal(rangeY(-20, 80, 400, { min: { hard: 1 / 3 }, max: {} }), null);
			assert.equal(rangeY(20, 80, 400, { min: { soft: 1 / 3, mode: 1 }, max: {} }), null);
		});

		it('clips data at active hard limits', () => {
			const result = checked([-20, 80], 250, { min: { hard: 0 }, max: { hard: 50 } });
			assert.deepEqual(bounds(result), [0, 50]);
			assertAnchor(result, 'min', 0);
			assertAnchor(result, 'max', 50);
		});

		it('returns null when hard limits cannot produce a range', () => {
			assert.equal(rangeY(-20, -10, 400, { min: { hard: 0 }, max: {} }), null);
			assert.equal(rangeY(10, 20, 400, { min: {}, max: { hard: 0 } }), null);
			assert.equal(rangeY(-20, 20, 400, { min: { hard: 0 }, max: { hard: 0 } }), null);
		});

		it('rejects invalid soft modes', () => {
			for (const mode of [-1, 4, NaN, 'bad'])
				assert.equal(rangeY(20, 80, 400, { min: { soft: 0, mode }, max: {} }), null, String(mode));
		});
	});
});
