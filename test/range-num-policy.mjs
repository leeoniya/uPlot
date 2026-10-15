import assert from 'node:assert/strict';
import { autoRangePart, rangeAnchors, rangeNum, rangePad, rangeZeroIf } from '../src/utils.js';

function mirrored(bounds) {
	return bounds.slice().reverse().map(value => value == null ? null : value == 0 ? 0 : -value);
}

function mirrorConfig(config) {
	const limit = part => part == null ? part : {
		...part,
		soft: part.soft == null ? part.soft : -part.soft,
		hard: part.hard == null ? part.hard : -part.hard,
	};
	return { ...config, min: limit(config.max), max: limit(config.min) };
}

function checkRange(min, max, config, expected) {
	assert.deepEqual(rangeNum(min, max, config), expected);
	assert.deepEqual(rangeNum(-max, -min, mirrorConfig(config)), mirrored(expected));
}

describe('ordinary numeric range policy', () => {
	it('exports independent padding and zero defaults without a limit mode', () => {
		assert.equal(rangePad, 0.1);
		assert.equal(rangeZeroIf, 0.1);
		assert.deepEqual(autoRangePart, { pad: 0.1 });
	});

	it('does not infer soft anchors from omitted or null limits', () => {
		assert.deepEqual(rangeAnchors(2, 12), [null, null]);
		assert.deepEqual(rangeAnchors(2, 12, null, null), [null, null]);
		checkRange(2, 12, {}, [1, 13]);
		checkRange(2, 12, { min: { soft: null }, max: { soft: null } }, [1, 13]);
		assert.deepEqual(rangeAnchors(0, 10, null, null, 0), [null, null]);
	});

	it('coalesces null and undefined range options to their defaults', () => {
		for (const absent of [null, undefined]) {
			const limit = { pad: absent, soft: absent, hard: absent };
			for (const config of [
				{ min: absent, max: absent, zeroIf: absent, flat: absent },
				{ min: limit, max: limit, zeroIf: absent, flat: absent },
			]) {
				for (const [min, max] of [[2, 12], [-12, -2], [1, 11], [-11, -1], [0, 0], [10, 10], [9.9999999, 10.0000001]])
					assert.deepEqual(rangeNum(min, max, config), rangeNum(min, max, {}));
			}
		}
	});

	it('selects explicit soft endpoints exactly, even beyond padding', () => {
		checkRange(2, 12, { min: { soft: -3.25 }, max: { soft: 17.25 } }, [-3.25, 17.25]);
		checkRange(2, 12, { min: { soft: 2, pad: 10 }, max: { soft: 12, pad: 10 } }, [2, 12]);
		checkRange(2, 12, { min: { soft: 1.5 }, max: { soft: 12.5 } }, [1.5, 12.5]);
	});

	it('restores padding when raw extrema cross soft endpoints', () => {
		checkRange(2, 12, { min: { soft: 3, pad: 0.2 }, max: { soft: 11, pad: 0.3 } }, [0, 15]);
		assert.deepEqual(rangeAnchors(2, 12, 3, 11), [null, null]);
		assert.deepEqual(rangeAnchors(-12, -2, -11, -3), [null, null]);
	});

	it('uses zeroIf at its raw-span boundary on either side', () => {
		for (const [min, max, expected] of [
			[1, 11, [0, null]],
			[1 + Number.EPSILON, 11, [0, null]],
			[1 + Number.EPSILON * 8, 11, [null, null]],
			[0.5, 11, [0, null]],
			[-1, 11, [null, null]],
		]) {
			assert.deepEqual(rangeAnchors(min, max), expected);
			assert.deepEqual(rangeAnchors(-max, -min), mirrored(expected));
		}
		checkRange(1, 11, { min: { pad: 0 }, max: { pad: 0 } }, [0, 11]);
	});

	it('allows zeroIf to be overridden or disabled', () => {
		checkRange(2, 12, { zeroIf: 0.2 }, [0, 13]);
		checkRange(1, 11, { zeroIf: 0, min: { pad: 0 }, max: { pad: 0 } }, [1, 11]);
		checkRange(1, 11, { zeroIf: null, min: { pad: 0 }, max: { pad: 0 } }, [0, 11]);
		assert.deepEqual(rangeAnchors(2, 12, null, null, 0.2), [0, null]);
		assert.deepEqual(rangeAnchors(-12, -2, null, null, 0.2), [null, 0]);
		assert.deepEqual(rangeAnchors(1, 11, null, null, 0), [null, null]);
	});

	it('prefers explicit soft anchors to zeroIf, but lets crossed soft fall through', () => {
		checkRange(1, 11, { min: { soft: 0.5 } }, [0.5, 12]);
		checkRange(1, 11, { min: { soft: 2 } }, [0, 12]);
		checkRange(1, 11, { zeroIf: 0, min: { soft: 0.5 } }, [0.5, 12]);
	});

	it('does not use padding or hard clipping to compute the zero threshold', () => {
		checkRange(2, 12, { min: { pad: 1 }, max: { pad: 1 } }, [-8, 22]);
		checkRange(1, 11, { min: { pad: 0 }, max: { pad: 0, hard: 2 } }, [0, 2]);
	});

	it('resolves soft and zero anchors before relative flat normalization', () => {
		assert.deepEqual(rangeAnchors(10, 10), [null, null]);
		assert.deepEqual(rangeAnchors(-10, -10), [null, null]);
		checkRange(9.9999999, 10.0000001, { min: { soft: 10 }, max: { soft: 10 } }, [0, 20]);
		checkRange(10, 10, { min: { soft: 5 }, max: { soft: 15 } }, [5, 15]);
	});

	it('keeps useful ordinary flat fallbacks', () => {
		assert.deepEqual(rangeNum(0, 0, {}), [0, 100]);
		assert.deepEqual(rangeNum(0, 0, { zeroIf: 0 }), [-100, 100]);
		assert.deepEqual(rangeNum(0, 0, { min: { soft: -1 }, max: { soft: 1 } }), [-1, 1]);
		assert.deepEqual(rangeNum(0, 0, { min: { soft: 0 }, max: { soft: 0 } }), [0, 100]);
		checkRange(10, 10, {}, [0, 20]);
	});

	it('prefers explicit zero anchors at raw flat zero, with positive fallback for ties', () => {
		assert.deepEqual(rangeAnchors(0, 0), [0, null]);
		for (const zeroIf of [undefined, 0]) {
			assert.deepEqual(rangeAnchors(0, 0, 0, 0, zeroIf), [0, null]);
			for (const absent of [undefined, null]) {
				assert.deepEqual(rangeAnchors(0, 0, absent, 0, zeroIf), [null, 0]);
				assert.deepEqual(rangeAnchors(0, 0, 0, absent, zeroIf), [0, null]);
			}
		}
		assert.deepEqual(rangeAnchors(0, 0, 1, 0), [null, 0]);
		assert.deepEqual(rangeAnchors(0, 0, 0, -1), [0, null]);
		assert.deepEqual(rangeAnchors(0, 0, -1, 1), [-1, 1]);
		assert.deepEqual(rangeAnchors(0, 0, null, null, 0), [null, null]);
		assert.deepEqual(rangeAnchors(0, 1), [0, null]);
		assert.deepEqual(rangeAnchors(-1, 0), [null, 0]);
	});

	it('expands away from a sole explicit soft zero endpoint', () => {
		for (const zeroIf of [undefined, 0]) {
			for (const absent of [undefined, { soft: null }]) {
				assert.deepEqual(rangeNum(0, 0, { zeroIf, min: absent, max: { soft: 0 } }), [-100, 0]);
				assert.deepEqual(rangeNum(0, 0, { zeroIf, min: { soft: 0 }, max: absent }), [0, 100]);
			}
			assert.deepEqual(rangeNum(0, 0, { zeroIf, min: { soft: 0 }, max: { soft: 0 } }), [0, 100]);
		}
	});

	it('expands flat zero within hard zero bounds, with or without explicit soft zero', () => {
		for (const zeroIf of [undefined, 0]) {
			for (const limit of [{ hard: 0 }, { hard: 0, soft: 0 }]) {
				assert.deepEqual(rangeNum(0, 0, { zeroIf, max: limit }), [-100, 0]);
				assert.deepEqual(rangeNum(0, 0, { zeroIf, min: limit }), [0, 100]);
				assert.deepEqual(rangeNum(0, 0, { zeroIf, min: { hard: -1 }, max: limit }), [-1, 0]);
				assert.deepEqual(rangeNum(0, 0, { zeroIf, min: limit, max: { hard: 1 } }), [0, 1]);
			}
			assert.deepEqual(rangeNum(0, 0, { zeroIf, min: { soft: 0 }, max: { soft: 0, hard: 0 } }), [-100, 0]);
		}
	});

	it('returns absent bounds when both hard limits forbid expansion from zero', () => {
		for (const zeroIf of [undefined, 0])
			assert.deepEqual(rangeNum(0, 0, { zeroIf, min: { hard: 0 }, max: { hard: 0 } }), [null, null]);
	});

	it('maps positional zeroAffinity to zeroIf without changing explicit soft policies', () => {
		const config = Object.freeze({
			zeroIf: 0,
			min: Object.freeze({ soft: 0.5, pad: 0 }),
			max: Object.freeze({ pad: 0 }),
		});
		for (const zeroAffinity of [true, false, true, false]) {
			assert.deepEqual(rangeNum(1, 11, 0, zeroAffinity), [zeroAffinity ? 0 : 1, 11]);
			assert.deepEqual(rangeNum(-11, -1, 0, zeroAffinity), [-11, zeroAffinity ? 0 : -1]);
			assert.deepEqual(rangeNum(1, 11, config), [0.5, 11]);
		}
		assert.deepEqual(rangeNum(1, 11, 0), [1, 11]);
		assert.deepEqual(rangeNum(0, 0, 0.1, true), [0, 100]);
	});

	it('applies hard limits above soft anchors, zeroIf, and padding', () => {
		checkRange(2, 12, { min: { hard: 1, soft: -10 }, max: { hard: 13, soft: 20 } }, [1, 13]);
		checkRange(1, 11, { min: { hard: 0.5 }, max: { hard: 11.5 } }, [0.5, 11.5]);
		checkRange(2, 12, { min: { hard: 3 }, max: { hard: 11 } }, [3, 11]);
		checkRange(10, 20, { min: { hard: 1 }, max: { hard: 5 } }, [1, 5]);
		assert.deepEqual(rangeAnchors(2, 12, -10, 20), [-10, 20]);
	});

	it('retains hard constraints when a collapsed or flat range expands', () => {
		assert.deepEqual(rangeNum(0, 0, { min: { hard: 0 }, max: { hard: 1 } }), [0, 1]);
		checkRange(5, 5, { min: { hard: 4, soft: 5 }, max: { hard: 6, soft: 5 } }, [4, 6]);
		checkRange(9.9999999, 10.0000001, { min: { hard: 9 }, max: { hard: 11 } }, [9, 11]);
	});

	it('returns absent bounds for invalid zeroIf even with explicit soft anchors', () => {
		for (const zeroIf of [-0.1, NaN, Infinity, -Infinity]) {
			assert.deepEqual(rangeAnchors(2, 12, 0, 20, zeroIf), [null, null]);
			assert.deepEqual(rangeNum(2, 12, { zeroIf, min: { soft: 0 }, max: { soft: 20 } }), [null, null]);
		}
	});
});
