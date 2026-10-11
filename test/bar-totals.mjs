import assert from 'node:assert/strict';
import { withBarTotals } from '../demos/lib/barTotals.js';

describe('external bar totals', () => {
	it('prepends separate sign totals and shares frozen raw columns without mutation', () => {
		const raw = Object.freeze([
			Object.freeze(['Positive', 'Negative', 'Mixed', 'Empty']),
			Object.freeze([2, -4, 3, 0]),
			Object.freeze([6, -2, -1, null]),
		]);
		const result = withBarTotals(raw);
		assert.notEqual(result, raw);
		assert.deepEqual(result.slice(1, 3), [[8, null, 3, null], [null, -6, -1, null]]);
		assert.equal(result[0], raw[0]);
		assert.equal(result[3], raw[1]);
		assert.equal(result[4], raw[2]);
		assert.notEqual(withBarTotals(raw)[1], result[1], 'each call owns its totals');
	});

	it('uses raw series indices for visibility and ignores index zero', () => {
		const raw = [['A', 'B'], [2, -3], [5, -7], [-1, 4]];
		const visible = Object.freeze([false, false, true, false]);
		assert.deepEqual(withBarTotals(raw, visible).slice(1, 3), [[5, null], [null, -7]]);
		assert.deepEqual(withBarTotals(raw, [true, false, false, false]).slice(1, 3), [[null, null], [null, null]]);
		assert.deepEqual(withBarTotals(raw, [false]).slice(1, 3), [[7, 4], [-1, -10]]);
	});

	it('ignores nonfinite, nonnumeric, missing, and zero values without coercion', () => {
		const raw = [Array.from({ length: 10 }, (_, i) => i),
			[NaN, Infinity, -Infinity, undefined, null, '2', true, 0, -0],
			[1, -2, 3, -4, 5, -6, 7, -8, 9, -10]];
		assert.deepEqual(withBarTotals(raw).slice(1, 3), [
			[1, null, 3, null, 5, null, 7, null, 9, null],
			[null, -2, null, -4, null, -6, null, -8, null, -10],
		]);
	});

	it('supports empty data, no components, and typed component columns', () => {
		assert.deepEqual(withBarTotals([[], []]), [[], [], [], []]);
		assert.deepEqual(withBarTotals([['A']]), [['A'], [null], [null]]);
		const values = new Float64Array([2, -3]);
		const result = withBarTotals([['A', 'B'], values]);
		assert.equal(result[3], values);
		assert.deepEqual(result.slice(1, 3), [[2, null], [null, -3]]);
	});

	it('recalculates from changed raw values and visibility without retaining state', () => {
		const raw = [['A'], [2], [-3]];
		const first = withBarTotals(raw);
		raw[1][0] = -5;
		assert.deepEqual(withBarTotals(raw).slice(1, 3), [[null], [-8]]);
		assert.deepEqual(withBarTotals(raw, [true, true, false]).slice(1, 3), [[null], [-5]]);
		assert.deepEqual(first.slice(1, 3), [[2], [-3]]);
	});
});
