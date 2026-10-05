import assert from 'node:assert/strict';
import { getMinMaxAsinh } from '../src/utils.js';

function reference(data, i0, i1, cutoff = 0) {
	let min = Infinity;
	let max = -Infinity;
	let minAbs = Infinity;

	for (let i = i0; i <= i1; i++) {
		const v = data[i];
		if (v == null)
			continue;
		min = Math.min(min, v);
		max = Math.max(max, v);
		if (Math.abs(v) > cutoff)
			minAbs = Math.min(minAbs, Math.abs(v));
	}

	return [min, max, minAbs];
}

function counted(data, i0 = 0, i1 = data.length - 1) {
	const reads = new Map();
	const proxy = new Proxy(data, {
		get(target, key) {
			if (typeof key == 'string' && /^-?\d+$/.test(key)) {
				const i = Number(key);
				assert.ok(i >= i0 && i <= i1, `out-of-bounds read: ${i}`);
				reads.set(i, (reads.get(i) ?? 0) + 1);
			}
			return Reflect.get(target, key);
		},
	});
	return { proxy, reads };
}

function totalReads(reads) {
	return [...reads.values()].reduce((sum, n) => sum + n, 0);
}

const cases = [
	['signed, nearest negative', [-20, -2, 0, 3, 40], 0, [-20, 40, 2]],
	['signed, nearest positive', [-20, -3, 0, 2, 40], 0, [-20, 40, 2]],
	['positive only', [1, 2, 20], 0, [1, 20, 1]],
	['negative only', [-20, -2, -1], 0, [-20, -1, 1]],
	['zeros', [0, 0, 0], 0, [0, 0, Infinity]],
	['negative zero', [-0], 0, [-0, -0, Infinity]],
	['zero with positive', [0, 0, 4], 0, [0, 4, 4]],
	['zero with negative', [-4, 0, 0], 0, [-4, 0, 4]],
	['cutoff equality', [-5, -2, -2, 0, 2, 2, 6], 2, [-5, 6, 5]],
	['positive cutoff', [1, 2, 3, 20], 2, [1, 20, 3]],
	['negative cutoff boundary', [-20, -3, -2, -1], 2, [-20, -1, 3]],
	['all at or below cutoff', [-2, -1, 0, 1, 2], 2, [-2, 2, Infinity]],
	['cutoff above all values', [-2, 0, 2], 3, [-2, 2, Infinity]],
	['fractional cutoff', [-0.5, -0.25, 0, 0.25, 0.75], 0.25, [-0.5, 0.75, 0.5]],
	['negative cutoff includes zero', [-2, 0, 2], -1, [-2, 2, 0]],
	['negative cutoff includes negative zero', [-0], -1, [-0, -0, 0]],
	['singleton', [4], 0, [4, 4, 4]],
	['singleton at cutoff', [4], 4, [4, 4, Infinity]],
	['null edges and gaps', [null, -9, undefined, -2, null, 0, undefined, 3, null, 9, null], 0, [-9, 9, 2]],
	['gap across cutoff', [-9, null, -2, null, undefined, 2, null, 8], 2, [-9, 8, 8]],
	['all nullish', [null, undefined, null], 0, [Infinity, -Infinity, Infinity]],
	['empty', [], 0, [Infinity, -Infinity, Infinity]],
];

describe('getMinMaxAsinh', () => {
	it('defaults to unsorted data and zero cutoff', () => {
		assert.deepEqual(getMinMaxAsinh([4, null, -2, 0, 1], 0, 4), [-2, 4, 1]);
	});

	for (const sorted of [0, 1, -1]) {
		for (const [name, values, cutoff, expected] of cases) {
			it(`${name} in either input order (sorted hint ${sorted})`, () => {
				for (const data of [values, values.slice().reverse()]) {
					const { proxy, reads } = counted(data);
					assert.deepEqual(getMinMaxAsinh(proxy, 0, data.length - 1, sorted, cutoff), expected);
					assert.equal(totalReads(reads), data.length);
					assert.equal(reads.size, data.length);
				}
			});
		}

		it(`uses inclusive cropped bounds (sorted ${sorted})`, () => {
			const values = [-100, -9, null, -3, 0, undefined, 2, 8, 200];
			const data = sorted == -1 ? values.slice().reverse() : values;
			for (const [i0, i1] of [[1, 7], [2, 6], [3, 3], [2, 2]]) {
				const { proxy } = counted(data, i0, i1);
				assert.deepEqual(getMinMaxAsinh(proxy, i0, i1, sorted, 2), reference(data, i0, i1, 2));
			}
		});

		it(`returns empty sentinels without reads for reversed bounds (sorted ${sorted})`, () => {
			for (const [i0, i1] of [[2, 1], [0, -1], [-1, -2], [10, 3]]) {
				const { proxy, reads } = counted([1, 2, 3], i0, i1);
				assert.deepEqual(getMinMaxAsinh(proxy, i0, i1, sorted), [Infinity, -Infinity, Infinity]);
				assert.equal(totalReads(reads), 0);
			}
		});
	}

	it('ignores sorted hints and reads each index exactly once, including nulls and holes', () => {
		const data = [null, 8, undefined, -2, 0, , 2, -10, null, 5, undefined];
		for (const sorted of [0, 1, -1]) {
			for (const [i0, i1] of [[0, data.length - 1], [2, 8], [3, 3]]) {
				const { proxy, reads } = counted(data, i0, i1);
				assert.deepEqual(getMinMaxAsinh(proxy, i0, i1, sorted, 2), reference(data, i0, i1, 2));
				assert.equal(totalReads(reads), i1 - i0 + 1);
				assert.equal(reads.size, i1 - i0 + 1);
				assert.ok([...reads.values()].every(n => n == 1));
			}
		}
	});

	it('handles sparse null gaps in every cropped interval and both directions', () => {
		const values = [-9, -3, -1, 0, 1, 3, 9];
		for (let mask = 0; mask < 1 << values.length; mask++) {
			const sparse = new Array(values.length);
			for (let i = 0; i < values.length; i++) {
				if (mask & (1 << i))
					sparse[i] = values[i];
				else if (i % 3 != 0)
					sparse[i] = i % 3 == 1 ? null : undefined;
			}

			for (const sorted of [1, -1]) {
				const data = sorted == 1 ? sparse : sparse.slice().reverse();
				for (let i0 = 0; i0 < data.length; i0++) {
					for (let i1 = i0; i1 < data.length; i1++) {
						for (const cutoff of [-1, 0, 1, 3, 10]) {
							assert.deepEqual(
								getMinMaxAsinh(data, i0, i1, sorted, cutoff),
								reference(data, i0, i1, cutoff),
								`mask=${mask}, sorted=${sorted}, bounds=${i0}:${i1}, cutoff=${cutoff}`,
							);
						}
					}
				}
			}
		}
	});

});
