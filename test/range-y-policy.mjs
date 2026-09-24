import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { rangeY, rangeYAuto, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits, numIncrs } from '../src/opts.js';

function checked(data, height, config, exact = true) {
	const result = rangeY(...data, height, config, 1, exact);
	assert.ok(result, `supported fixture: ${data}, height ${height}`);
	if (exact)
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

const noPadding = {
	min: { pad: 0 },
	max: { pad: 0 },
};

const noAffinity = {
	zeroIf: 0,
	min: { pad: 0 },
	max: { pad: 0 },
};

describe('rangeY fourth-argument policy', () => {
	it('coalesces null and undefined range options to their defaults', () => {
		for (const absent of [null, undefined]) {
			const limit = { pad: absent, soft: absent, hard: absent };
			for (const config of [
				{ min: absent, max: absent, zeroIf: absent },
				{ min: limit, max: limit, zeroIf: absent },
			]) {
				for (const exact of [false, true]) {
					for (const data of [[20, 100], [-100, -20], [10, 110], [-110, -10], [0, 0], [38, 38]])
						assert.deepEqual(checked(data, 400, config, exact), checked(data, 400, {}, exact));
				}
			}
		}
	});
	describe('default zero affinity', () => {
		it('inherits zero affinity independently of soft limits', () => {
			assert.ok(Object.isFrozen(rangeYAuto));
			assert.ok(Object.isFrozen(rangeYAuto.min));
			assert.ok(Object.isFrozen(rangeYAuto.max));
			assert.equal(rangeYAuto.zeroIf, 0.1);
			assert.deepEqual(rangeYAuto.min, { pad: 0.1 });
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

		it('applies independent zero affinity with omitted or null soft limits', () => {
			for (const limit of [{ pad: 0 }, { soft: null, pad: 0 }]) {
				const policy = { min: limit, max: limit };
				assert.deepEqual(bounds(checked([.1, 1.1], 490, policy)), [0, 2]);
				assert.deepEqual(bounds(checked([-1.1, -.1], 490, policy)), [-2, 0]);
				assert.deepEqual(bounds(checked([.1, 1.1], 490, { ...policy, zeroIf: 0 })), [.1, 1.1]);
				assert.deepEqual(bounds(checked([-1.1, -.1], 490, { ...policy, zeroIf: 0 })), [-1.1, -.1]);
			}
		});

		it('keeps active soft anchors ahead of zero affinity', () => {
			assert.equal(checked([.1, 1.1], 490, { min: { soft: -.2 } }).min, -.2);
			assert.equal(checked([-1.1, -.1], 490, { max: { soft: .2 } }).max, .2);
		});

		it('makes zero the outer endpoint at the exact 10% threshold without padding', () => {
			assert.equal(checked([10, 110], 543, noPadding).min, 0);
			assert.equal(checked([-110, -10], 543, noPadding).max, 0);
			assert.equal(checked([0.001, 0.011], 543, noPadding).min, 0, 'decimal cancellation does not miss the threshold');
			assert.equal(checked([-0.011, -0.001], 543, noPadding).max, 0, 'negative decimal threshold is symmetric');
		});

		it('does not force zero just over the 10% threshold without padding', () => {
			assert.deepEqual(bounds(checked([10.0001, 110.0001], 543, noPadding)), [10, 120]);
			assert.deepEqual(bounds(checked([-110.0001, -10.0001], 543, noPadding)), [-120, -10]);
			assert.deepEqual(bounds(checked([0.00100001, 0.01100001], 543, noPadding)), [.001, .012]);
			assert.deepEqual(bounds(checked([-0.01100001, -0.00100001], 543, noPadding)), [-.012, -.001]);
		});

		it('does not replace padding with an implicit soft zero outside raw zeroIf eligibility', () => {
			for (const exact of [false, true]) {
				const positive = { min: { pad: .5 } };
				const negative = { max: { pad: .5 } };
				const lo = checked([20, 100], 400, positive, exact);
				const hi = checked([-100, -20], 400, negative, exact);
				assert.ok(lo.min <= -20, 'raw distance 20 exceeds .1 * raw span 80');
				assert.ok(hi.max >= 20);
				assert.deepEqual(lo, checked([20, 100], 400, { min: { pad: .5, soft: null } }, exact));
				assert.deepEqual(hi, checked([-100, -20], 400, { max: { pad: .5, soft: null } }, exact));
			}
		});

		it('adjusts the proximity threshold with top-level zeroIf', () => {
			const disabled = { ...noPadding, zeroIf: 0 };
			assert.deepEqual(bounds(checked([0.1, 1.1], 490, disabled)), [0.1, 1.1]);
			assert.deepEqual(bounds(checked([-1.1, -0.1], 490, disabled)), [-1.1, -0.1]);

			const reduced = { ...noPadding, zeroIf: .05 };
			assert.equal(checked([10, 110], 490, reduced).min, 10);
			assert.equal(checked([-110, -10], 490, reduced).max, -10);

			const widened = { ...noPadding, zeroIf: 0.200001 };
			assert.equal(checked([20.0001, 120.0001], 543, widened).min, 0);
			assert.equal(checked([-120.0001, -20.0001], 543, widened).max, 0);
		});

		it('matches omitted zeroIf to explicit 10% with padding disabled', () => {
			for (const exact of [false, true]) {
				for (const data of [[10, 110], [-110, -10], [10.0001, 110.0001], [-110.0001, -10.0001]])
					assert.deepEqual(checked(data, 543, noPadding, exact), checked(data, 543, { ...noPadding, zeroIf: .1 }, exact));
			}
		});

		it('still permits natural zero with zeroIf: 0 or outside the affinity threshold', () => {
			for (const data of [[0.200001, 1.200001], [-1.200001, -0.200001]]) {
				const automatic = checked(data, 100, noPadding);
				const ordinaryGrid = checked(data, 100, noAffinity);
				assert.deepEqual(bounds(automatic), bounds(ordinaryGrid));
				assert.ok(automatic.min == 0 || automatic.max == 0);
			}
		});
	});

	describe('minimum padding', () => {
		for (const exact of [false, true]) {
			it(`encloses asymmetric padding from raw extrema (exact ${exact})`, () => {
				for (const data of [[20, 100], [-100, -20], [-20, 100]]) {
					for (const height of [20, 100, 400]) {
						for (const [padMin, padMax] of [[0, .1], [.25, 0], [.25, .1], [2, 3]]) {
							const policy = { zeroIf: 0, min: { pad: padMin }, max: { pad: padMax } };
							const result = checked(data, height, policy, exact);
							const span = data[1] - data[0];
							assert.ok(result.min <= data[0] - span * padMin);
							assert.ok(result.max >= data[1] + span * padMax);
						}
					}
				}
			});

			it(`does not base opposite-side padding on an anchored span (exact ${exact})`, () => {
				const lo = checked([20, 100], 450, { zeroIf: 0, min: { soft: 0 }, max: { soft: null, pad: 1 } }, exact);
				const hi = checked([-100, -20], 450, { zeroIf: 0, min: { soft: null, pad: 1 }, max: { soft: 0 } }, exact);
				assert.deepEqual(bounds(lo), [0, 180], '100 + (100 - 20), not 100 + (100 - 0)');
				assert.deepEqual(bounds(hi), [-180, 0]);
			});

			it(`does not add padding when the selected ticks already provide it (exact ${exact})`, () => {
				const policy = { zeroIf: 0, min: { pad: .01 }, max: { pad: .01 } };
				assert.deepEqual(checked([13, 87], 400, policy, exact), checked([13, 87], 400, noAffinity, exact));
			});

			it(`defaults omitted padding to 10% on each side (exact ${exact})`, () => {
				for (const data of [[10, 110], [-110, -10], [13, 87], [-87, -13], [-20, 100]]) {
					const explicit = checked(data, 400, { min: { pad: .1 }, max: { pad: .1 } }, exact);
					for (const policy of [undefined, null, {}, { min: {}, max: {} }, { min: { pad: .1 } }, { max: { pad: .1 } }])
						assert.deepEqual(checked(data, 400, policy, exact), explicit);

					for (const limit of [{}, { soft: null }]) {
						const omitted = { zeroIf: 0, min: limit, max: limit };
						const padded = { zeroIf: 0, min: { ...limit, pad: .1 }, max: { ...limit, pad: .1 } };
						const result = checked(data, 400, omitted, exact);
						assert.deepEqual(result, checked(data, 400, padded, exact));
						const span = data[1] - data[0];
						assert.ok(result.min <= data[0] - span * .1);
						assert.ok(result.max >= data[1] + span * .1);
					}
				}
			});

			it(`lets explicit zero disable padding on either side (exact ${exact})`, () => {
				for (const data of [[10, 110], [-110, -10]]) {
					const unpadded = checked(data, 490, noAffinity, exact);
					assert.deepEqual(bounds(unpadded), data);
					for (const [padMin, padMax] of [[0, .1], [.1, 0], [.1, .1]]) {
						const result = checked(data, 490, { zeroIf: 0, min: { pad: padMin }, max: { pad: padMax } }, exact);
						assert.notDeepEqual(bounds(result), bounds(unpadded));
						assert.ok(result.min <= data[0] - 100 * padMin);
						assert.ok(result.max >= data[1] + 100 * padMax);
					}
				}
			});

			it(`leaves flat-data fallback unchanged by padding (exact ${exact})`, () => {
				for (const data of [[38, 38], [-38, -38], [0, 0]]) {
					for (const pad of [0, .1, 1e100])
						assert.deepEqual(checked(data, 400, { min: { pad }, max: { pad } }, exact), checked(data, 400, undefined, exact));
				}
			});

			it(`lets zeroIf override padding without changing its raw-span threshold (exact ${exact})`, () => {
				for (const pad of [.5, 1e100, Number.MAX_VALUE]) {
					const positive = { min: { soft: null, pad }, max: { soft: null, pad: .1 } };
					const negative = { min: { soft: null, pad: .1 }, max: { soft: null, pad } };
					const lo = checked([10, 110], 400, positive, exact);
					const hi = checked([-110, -10], 400, negative, exact);
					assertAnchor(lo, 'min', 0);
					assertAnchor(hi, 'max', 0);
					assert.ok(lo.max >= 120);
					assert.ok(hi.min <= -120);
				}

				const outside = checked([10.0001, 110.0001], 400, { min: { soft: null, pad: .5 }, max: { soft: null } }, exact);
				const outsideNegative = checked([-110.0001, -10.0001], 400, { min: { soft: null }, max: { soft: null, pad: .5 } }, exact);
				assert.ok(outside.min <= -39.9999, 'padding does not widen zeroIf eligibility');
				assert.ok(outsideNegative.max >= 39.9999, 'negative raw-span threshold is symmetric');
				const disabled = checked([10, 110], 400, { zeroIf: 0, min: { soft: null, pad: .5 }, max: { soft: null } }, exact);
				assert.ok(disabled.min <= -40, 'disabled affinity does not suppress padding');
			});

			it(`keeps soft anchors ahead of padding and zeroIf (exact ${exact})`, () => {
				for (const pad of [1, 1e100, Number.MAX_VALUE]) {
					const lo = checked([10, 110], 400, { min: { soft: -20, pad }, max: { pad: .1 } }, exact);
					const hi = checked([-110, -10], 400, { min: { pad: .1 }, max: { soft: 20, pad } }, exact);
					assertAnchor(lo, 'min', -20);
					assertAnchor(hi, 'max', 20);
					assert.ok(lo.max >= 120);
					assert.ok(hi.min <= -120);
				}
			});

			it(`caps padding at hard limits without using the clipped span (exact ${exact})`, () => {
				const lo = checked([-20, 80], 400, { min: { hard: 0, pad: Number.MAX_VALUE }, max: { pad: .5 } }, exact);
				const hi = checked([-80, 20], 400, { min: { pad: .5 }, max: { hard: 0, pad: Number.MAX_VALUE } }, exact);
				assertAnchor(lo, 'min', 0);
				assertAnchor(hi, 'max', 0);
				assert.ok(lo.max >= 130);
				assert.ok(hi.min <= -130);

				const both = checked([20, 80], 400, { min: { hard: 10, pad: 10 }, max: { hard: 90, pad: 10 } }, exact);
				assert.deepEqual(bounds(both), [10, 90]);
			});

			it(`does not discard excessive padding on unanchored sides (exact ${exact})`, () => {
				assert.equal(rangeY(20, 120, 400, { min: { pad: 1e100 }, max: { pad: 1e100 } }, 1, exact), null);
				assert.equal(rangeY(20, 120, 400, { ...noAffinity, min: { pad: Number.MAX_VALUE } }, 1, exact), null);
			});
		}

		it('keeps soft anchors independent of padded ticks', () => {
			for (const exact of [false, true]) {
				const policy = { zeroIf: 0, min: { soft: 25, pad: 1 }, max: { pad: 0 } };
				assertAnchor(checked([30, 50], 100, policy, exact), 'min', 25);
				const mirrored = { zeroIf: 0, min: { pad: 0 }, max: { soft: -25, pad: 1 } };
				assertAnchor(checked([-50, -30], 100, mirrored, exact), 'max', -25);
			}
		});

		it('rejects invalid padding on either side', () => {
			for (const pad of [-1, Infinity, NaN, '0.1']) {
				for (const side of ['min', 'max'])
					assert.equal(rangeY(20, 80, 400, { [side]: { pad } }), null, `${side}: ${pad}`);
			}
		});
	});

	describe('raw-data soft anchors', () => {
		for (const exact of [false, true]) {
			for (const mirrored of [false, true]) {
				const side = mirrored ? 'max' : 'min';
				const mirror = data => mirrored ? [-data[1], -data[0]] : data;

				it(`anchors inside and at soft zero, then restores padding after crossing (${side}, exact ${exact})`, () => {
					const policy = { zeroIf: 0, [side]: { soft: 0, pad: .1 } };
					for (const height of [20, 100, 400, 1000]) {
						for (const data of [[20, 100], [0, 100]])
							assertAnchor(checked(mirror(data), height, policy, exact), side, 0);

						const crossed = checked(mirror([-20, 100]), height, policy, exact);
						assert.ok(mirrored ? crossed.max >= 32 : crossed.min <= -32,
							'inactive soft zero restores .1 * raw span 120 padding');
						assert.deepEqual(crossed, checked(mirror([-20, 100]), height, { zeroIf: 0 }, exact));
					}
				});

				it(`anchors nonzero soft limits from raw data, not rounded ticks (${side}, exact ${exact})`, () => {
					const soft = mirrored ? -25 : 25;
					const policy = { zeroIf: 0, min: { pad: 0 }, max: { pad: 0 }, [side]: { soft, pad: 0 } };
					// These unanchored grids stay inside, cross, or touch the soft limit.
					for (const data of [[30, 50], [26, 50], [25, 50]])
						assertAnchor(checked(mirror(data), 100, policy, exact), side, soft);
					assert.deepEqual(checked(mirror([24, 50]), 100, policy, exact), checked(mirror([24, 50]), 100, noAffinity, exact));
				});

				it(`does not inherit a soft zero from omitted or null limits (${side}, exact ${exact})`, () => {
					for (const policy of [undefined, {}, { min: {}, max: {} }, { min: { soft: null }, max: { soft: null } }]) {
						const result = checked(mirror([30, 50]), 400, policy, exact);
						assert.ok(mirrored ? result.max < 0 : result.min > 0);
					}
					assertAnchor(checked(mirror([30, 50]), 400, { [side]: { soft: 0 } }, exact), side, 0);
				});
			}

			it(`uses raw flat extrema for soft anchors and preserves the flat zero fallback (exact ${exact})`, () => {
				assertAnchor(checked([38, 38], 400, { min: { soft: 20 } }, exact), 'min', 20);
				assertAnchor(checked([-38, -38], 400, { max: { soft: -20 } }, exact), 'max', -20);
				for (const policy of [
					{ min: { soft: 0 }, max: { soft: 0 } },
					{ zeroIf: 0, min: { soft: 0 }, max: { soft: 0 } },
				]) {
					const result = checked([0, 0], 400, policy, exact);
					assertAnchor(result, 'min', 0);
					assert.ok(result.max >= 100, 'the coincident max zero anchor does not collapse the positive fallback');
				}

				for (const zeroIf of [undefined, 0]) {
					for (const max of [{ soft: 0 }, { hard: 0 }, { hard: 0, soft: 0 }]) {
						const result = checked([0, 0], 400, { zeroIf, max }, exact);
						assertAnchor(result, 'max', 0);
						assert.ok(result.min <= -100, 'an upper zero endpoint expands the fallback below zero');
					}
				}
			});
		}
	});

	describe('hard limits, partial normalization, and alignment', () => {
		it('supports exact hard 0 and soft 0 outer ticks', () => {
			const hard = checked([-20, 80], 400, { min: { hard: 0, pad: 0 }, max: { pad: 0 } });
			assert.deepEqual(bounds(hard), [0, 80]);
			assertAnchor(hard, 'min', 0);

			const soft = checked([20, 80], 400, { min: { soft: 0, pad: 0 }, max: { pad: 0 } });
			assert.deepEqual(bounds(soft), [0, 80]);
			assertAnchor(soft, 'min', 0);
		});

		it('matches partial [0, null] normalization with a hard minimum and automatic maximum', () => {
			const config = {
				min: { hard: 0, soft: 0 },
				max: rangeYAuto.max,
			};
			const result = checked([20, 80], 400, config);
			assert.deepEqual(result, checked([20, 80], 400, { min: config.min, max: { pad: .1 } }));
			assert.ok(result.max >= 86, 'automatic maximum includes 10% of the raw span');
			assertAnchor(result, 'min', 0);
		});

		it('supports aligned nonzero hard and soft limits as exact outer ticks', () => {
			const hard = checked([-20, 80], 400, { min: { hard: 10, pad: 0 }, max: { pad: 0 } });
			assert.deepEqual(bounds(hard), [10, 90]);
			assertAnchor(hard, 'min', 10);

			const soft = checked([20, 80], 400, { min: { soft: 10, pad: 0 }, max: { pad: 0 } });
			assert.deepEqual(bounds(soft), [10, 90]);
			assertAnchor(soft, 'min', 10);
		});

		it('returns null when an active limit cannot align to a built-in increment', () => {
			assert.equal(rangeY(-20, 80, 400, { min: { hard: 1 / 3 }, max: {} }), null);
			assert.equal(rangeY(20, 80, 400, { min: { soft: 1 / 3 }, max: {} }), null);
		});

		it('keeps hard limits ahead of soft anchors and zero affinity', () => {
			for (const exact of [false, true]) {
				const lo = checked([10, 110], 400, { min: { hard: 20, soft: -20, pad: 1e100 } }, exact);
				const hi = checked([-110, -10], 400, { max: { hard: -20, soft: 20, pad: 1e100 } }, exact);
				assertAnchor(lo, 'min', 20);
				assertAnchor(hi, 'max', -20);
				assert.ok(lo.max >= 120);
				assert.ok(hi.min <= -120);
			}
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

		it('rejects invalid zeroIf thresholds', () => {
			for (const zeroIf of [-1, Infinity, NaN, '0.1'])
				assert.equal(rangeY(20, 80, 400, { zeroIf, min: {}, max: {} }), null, String(zeroIf));
		});
	});
});
