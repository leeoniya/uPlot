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

const noAffinity = {
	zeroIf: 0,
	min: { mode: 0 },
	max: { mode: 0 },
};

describe('rangeY fourth-argument policy', () => {
	describe('default zero affinity', () => {
		it('inherits zero affinity independently of soft limits', () => {
			assert.ok(Object.isFrozen(rangeYAuto));
			assert.ok(Object.isFrozen(rangeYAuto.min));
			assert.ok(Object.isFrozen(rangeYAuto.max));
			assert.equal(rangeYAuto.zeroIf, 0.2);
			assert.deepEqual(rangeYAuto.min, { soft: 0, mode: 3 });
			assert.equal(rangeYAuto.min, rangeYAuto.max);

			const positive = checked([0.1, 1.1], 490);
			const positiveWithoutAffinity = checked([0.1, 1.1], 490, noAffinity);
			assert.deepEqual(bounds(positive), [0, 2]);
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, null)), bounds(positive));
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, {})), bounds(positive));
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, { min: {}, max: {} })), bounds(positive));
			assert.deepEqual(bounds(positiveWithoutAffinity), [0.1, 1.1]);
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, { min: { soft: null }, max: { soft: null } })), bounds(positive));

			const negative = checked([-1.1, -0.1], 490);
			const negativeWithoutAffinity = checked([-1.1, -0.1], 490, noAffinity);
			assert.deepEqual(bounds(negative), [-2, 0]);
			assert.deepEqual(bounds(negativeWithoutAffinity), [-1.1, -0.1]);
		});

		it('applies independent zero affinity in every mode with soft limits removed', () => {
			for (const mode of [0, 1, 2, 3]) {
				const policy = { min: { soft: null, mode }, max: { soft: null, mode } };
				assert.deepEqual(bounds(checked([.1, 1.1], 490, policy)), [0, 2]);
				assert.deepEqual(bounds(checked([-1.1, -.1], 490, policy)), [-2, 0]);
				assert.deepEqual(bounds(checked([.1, 1.1], 490, { ...policy, zeroIf: 0 })), [.1, 1.1]);
				assert.deepEqual(bounds(checked([-1.1, -.1], 490, { ...policy, zeroIf: 0 })), [-1.1, -.1]);
			}
			assert.deepEqual(bounds(checked([.1, 1.1], 490, { min: { mode: 0 }, max: { mode: 0 } })), [0, 2]);
		});

		it('keeps active soft anchors ahead of zero affinity', () => {
			assert.equal(checked([.1, 1.1], 490, { min: { soft: -.2, mode: 1 } }).min, -.2);
			assert.equal(checked([-1.1, -.1], 490, { max: { soft: .2, mode: 1 } }).max, .2);
		});

		it('makes zero the outer endpoint at the exact 20% threshold', () => {
			assert.equal(checked([20, 120], 543).min, 0);
			assert.equal(checked([-120, -20], 490).max, 0);
			assert.equal(checked([0.002, 0.012], 543).min, 0, 'decimal cancellation does not miss the threshold');
			assert.equal(checked([-0.012, -0.002], 543).max, 0, 'negative decimal threshold is symmetric');
		});

		it('does not force zero just over the 20% threshold', () => {
			assert.deepEqual(bounds(checked([20.0001, 120.0001], 543)), [20, 130]);
			assert.deepEqual(bounds(checked([-120.0001, -20.0001], 543)), [-130, -20]);
		});

		it('adjusts the proximity threshold with top-level zeroIf', () => {
			const disabled = { zeroIf: 0, min: {}, max: {} };
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, disabled)), [0.1, 1.1]);
			assert.deepEqual(bounds(checked([-1.1, -0.1], 490, disabled)), [-1.1, -0.1]);

			const reduced = { zeroIf: .1, min: {}, max: {} };
			assert.equal(checked([20, 120], 252, reduced).min, 20);
			assert.equal(checked([-120, -20], 252, reduced).max, -20);

			const widened = { zeroIf: 0.200001, min: {}, max: {} };
			assert.equal(checked([20.0001, 120.0001], 543, widened).min, 0);
			assert.equal(checked([-120.0001, -20.0001], 543, widened).max, 0);
		});

		it('still permits zero to occur naturally outside the affinity threshold', () => {
			for (const data of [[0.200001, 1.200001], [-1.200001, -0.200001]]) {
				const automatic = checked(data, 100);
				const ordinaryGrid = checked(data, 100, noAffinity);
				assert.deepEqual(bounds(automatic), bounds(ordinaryGrid));
				assert.ok(automatic.min == 0 || automatic.max == 0);
			}
		});
	});

	describe('ignored padding', () => {
		it('ignores pad values while retaining the inherited zero policy', () => {
			const data = [0.000171664, 0.00703821];
			const expected = bounds(checked(data, 300));
			assert.deepEqual(expected, [0, 0.012]);

			for (const pad of [-1, 0, 0.1, 1e15, NaN])
				assert.deepEqual(bounds(checked(data, 300, { min: { pad }, max: { pad } })), expected, String(pad));
		});

		it('ignores pad alongside explicit hard and soft limits', () => {
			const hard = checked([-20, 80], 400, { min: { pad: 1e15, hard: 0 }, max: {} });
			assert.deepEqual(bounds(hard), [0, 80]);
			assertAnchor(hard, 'min', 0);

			const soft = checked([-80, -20], 400, { min: {}, max: { pad: -1, soft: 0, mode: 1 } });
			assert.deepEqual(bounds(soft), [-80, 0]);
			assertAnchor(soft, 'max', 0);
		});
	});

	describe('soft modes', () => {
		it('uses the natural outer ticks while they remain inside the soft limits', () => {
			for (const [mode, expected, active] of [
				[0, [30, 60], false],
				[1, [0, 60], true],
				[2, [0, 60], true],
				[3, [30, 60], false],
			]) {
				const result = checked([30, 50], 97, { min: { soft: 0, mode }, max: {} });
				assert.deepEqual(bounds(result), expected, `minimum mode ${mode}`);
				if (active)
					assertAnchor(result, 'min', 0);
			}

			for (const [mode, expected, active] of [
				[0, [-50, -20], false],
				[1, [-60, 0], true],
				[2, [-60, 0], true],
				[3, [-50, -20], false],
			]) {
				const result = checked([-50, -30], 97, { min: {}, max: { soft: 0, mode } });
				assert.deepEqual(bounds(result), expected, `maximum mode ${mode}`);
				if (active)
					assertAnchor(result, 'max', 0);
			}
		});

		it('switches modes 2 and 3 when a natural outer tick crosses the soft limit', () => {
			for (const [mode, expected, active] of [
				[0, [20, 50], false],
				[1, [25, 100], true],
				[2, [20, 50], false],
				[3, [25, 100], true],
			]) {
				const result = checked([26, 50], 97, { min: { soft: 25, mode }, max: {} });
				assert.deepEqual(bounds(result), expected, `minimum mode ${mode}`);
				if (active)
					assertAnchor(result, 'min', 25);
			}

			for (const [mode, expected, active] of [
				[0, [-50, -20], false],
				[1, [-100, -25], true],
				[2, [-50, -20], false],
				[3, [-100, -25], true],
			]) {
				const result = checked([-50, -26], 97, { min: {}, max: { soft: -25, mode } });
				assert.deepEqual(bounds(result), expected, `maximum mode ${mode}`);
				if (active)
					assertAnchor(result, 'max', -25);
			}
		});
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

		it('rejects invalid soft modes and zeroIf thresholds', () => {
			for (const mode of [-1, 0.5, 1.5, 4, NaN, 'bad'])
				assert.equal(rangeY(20, 80, 400, { min: { soft: 0, mode }, max: {} }), null, String(mode));

			for (const zeroIf of [-1, Infinity, NaN, '0.1'])
				assert.equal(rangeY(20, 80, 400, { zeroIf, min: {}, max: {} }), null, String(zeroIf));
		});
	});
});
