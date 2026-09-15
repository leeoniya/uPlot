import assert from 'node:assert/strict';
import { join } from '../src/utils.js';

const NULL_REMOVE = 0;
const NULL_RETAIN = 1;
const NULL_EXPAND = 2;

function previousJoin(tables, nullModes) {
	const firstXs = tables[0][0];
	const sameHeaders = tables.every(([xs]) => xs.length == firstXs.length && (xs === firstXs || xs.every((x, i) => x == firstXs[i])));
	if (sameHeaders) {
		const table = tables[0].slice();
		for (let i = 1; i < tables.length; i++)
			table.push(...tables[i].slice(1));
		return table;
	}

	const xVals = new Set();
	for (const [xs] of tables) {
		for (const x of xs)
			xVals.add(x);
	}

	const aligned = Array.from(xVals).sort((a, b) => a - b);
	const xIdxs = new Map(aligned.map((x, i) => [x, i]));
	const data = [aligned];

	for (let ti = 0; ti < tables.length; ti++) {
		const [xs, ...series] = tables[ti];
		for (let si = 0; si < series.length; si++) {
			const yVals = Array(aligned.length).fill(undefined);
			const nullMode = nullModes ? nullModes[ti][si + 1] : NULL_RETAIN;
			const nullIdxs = [];

			for (let i = 0; i < series[si].length; i++) {
				const yVal = series[si][i];
				const alignedIdx = xIdxs.get(xs[i]);
				if (yVal === null) {
					if (nullMode != NULL_REMOVE) {
						yVals[alignedIdx] = null;
						if (nullMode == NULL_EXPAND)
							nullIdxs.push(alignedIdx);
					}
				}
				else
					yVals[alignedIdx] = yVal;
			}

			for (let i = 0, lastNullIdx = -1; i < nullIdxs.length; i++) {
				const nullIdx = nullIdxs[i];
				if (nullIdx > lastNullIdx) {
					let xi = nullIdx - 1;
					while (xi >= 0 && yVals[xi] == null)
						yVals[xi--] = null;
					xi = nullIdx + 1;
					while (xi < aligned.length && yVals[xi] == null)
						yVals[lastNullIdx = xi++] = null;
				}
			}

			data.push(yVals);
		}
	}

	return data;
}

describe('join', () => {
	it('uses the cheap path for identical X values and retains column references', () => {
		const xs = [1, 2, 3];
		const ys1 = [10, null, 30];
		const ys2 = [40, undefined, 60];
		const result = join([[xs, ys1], [xs.slice(), ys2]]);
		assert.deepStrictEqual(result, [xs, ys1, ys2]);
		assert.equal(result[0], xs);
		assert.equal(result[1], ys1);
		assert.equal(result[2], ys2);
	});

	it('sorts identical unsorted X columns with their Y values', () => {
		assert.deepStrictEqual(join([
			[[3, 1, 2], [30, 10, 20]],
			[[3, 1, 2], [33, 11, 22]],
		]), [
			[1, 2, 3],
			[10, 20, 30],
			[11, 22, 33],
		]);
	});

	it('sorts differing unsorted X columns before merging', () => {
		assert.deepStrictEqual(join([
			[[5, 1, 3], [50, 10, 30]],
			[[4, 3, 2], [40, 33, 20]],
		]), [
			[1, 2, 3, 4, 5],
			[10, undefined, 30, undefined, 50],
			[undefined, 20, 33, 40, undefined],
		]);
	});

	it('supports typed X and Y columns', () => {
		const xs1 = new Float64Array([1, 3]);
		const ys1 = new Float32Array([10, 30]);
		const xs2 = new Float64Array([2, 3]);
		const ys2 = new Float32Array([20, 33]);
		assert.deepStrictEqual(join([[xs1, ys1], [xs2, ys2]]), [
			[1, 2, 3],
			[10, undefined, 30],
			[undefined, 20, 33],
		]);
	});

	it('aligns multiple series from partially overlapping tables', () => {
		assert.deepStrictEqual(join([
			[[1, 3, 5], [10, 30, 50], [11, 31, 51]],
			[[2, 3, 6], [20, 33, 60]],
			[[1, 4, 6], [101, 40, 66]],
		]), [
			[1, 2, 3, 4, 5, 6],
			[10, undefined, 30, undefined, 50, undefined],
			[11, undefined, 31, undefined, 51, undefined],
			[undefined, 20, 33, undefined, undefined, 60],
			[101, undefined, undefined, 40, undefined, 66],
		]);
	});


	it('retains explicit nulls and leaves alignment gaps undefined by default', () => {
		assert.deepStrictEqual(join([
			[[1, 3, 5], [null, undefined, 50]],
			[[2, 4], [20, null]],
		]), [
			[1, 2, 3, 4, 5],
			[null, undefined, undefined, undefined, 50],
			[undefined, 20, undefined, null, undefined],
		]);
	});

	it('applies null modes independently to each series', () => {
		const tables = [
			[[1, 3, 5, 7], [10, null, 50, 70], [null, 30, null, 70], [10, null, 50, 70]],
			[[2, 4, 6], [20, 40, 60]],
		];
		assert.deepStrictEqual(join(tables, [
			[NULL_RETAIN, NULL_RETAIN, NULL_REMOVE, NULL_EXPAND],
			[NULL_RETAIN, NULL_RETAIN],
		]), [
			[1, 2, 3, 4, 5, 6, 7],
			[10, undefined, null, undefined, 50, undefined, 70],
			[undefined, undefined, 30, undefined, undefined, undefined, 70],
			[10, null, null, null, 50, undefined, 70],
			[undefined, 20, undefined, 40, undefined, 60, undefined],
		]);
	});

	it('expands nulls through adjacent alignment gaps in both directions', () => {
		assert.deepStrictEqual(join([
			[[1, 4, 7], [10, null, 70]],
			[[2, 3, 5, 6], [20, 30, 50, 60]],
		], [
			[NULL_RETAIN, NULL_EXPAND],
			[NULL_RETAIN, NULL_RETAIN],
		]), [
			[1, 2, 3, 4, 5, 6, 7],
			[10, null, null, null, null, null, 70],
			[undefined, 20, 30, undefined, 50, 60, undefined],
		]);
	});

	it('handles empty tables, empty series, and disjoint ranges', () => {
		assert.deepStrictEqual(join([
			[[], []],
			[[1, 2], [10, 20]],
			[[5, 6], [50, 60]],
		]), [
			[1, 2, 5, 6],
			[undefined, undefined, undefined, undefined],
			[10, 20, undefined, undefined],
			[undefined, undefined, 50, 60],
		]);
	});

	it('merges many tables through the same sorted path', () => {
		const tables = Array.from({ length: 100 }, (_, ti) => [
			[ti, ti + 100],
			[ti * 10, ti * 10 + 1],
		]);
		assert.deepStrictEqual(join(tables), previousJoin(tables));
	});

	it('matches the previous algorithm across randomized sorted tables and null modes', () => {
		let seed = 0x12345678;
		const random = () => {
			seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
			seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
			return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
		};

		for (let caseIdx = 0; caseIdx < 100; caseIdx++) {
			const tables = [];
			const nullModes = [];
			const tableCount = 1 + Math.floor(random() * 6);

			for (let ti = 0; ti < tableCount; ti++) {
				const xs = [];
				const series = [[], []];
				let x = Math.floor(random() * 3);
				const len = Math.floor(random() * 20);

				for (let i = 0; i < len; i++) {
					x += 1 + Math.floor(random() * 3);
					xs.push(x);
					for (const ys of series) {
						const pick = Math.floor(random() * 6);
						ys.push(pick == 0 ? null : pick == 1 ? undefined : Math.floor(random() * 100));
					}
				}

				tables.push([xs, ...series]);
				nullModes.push([NULL_RETAIN, Math.floor(random() * 3), Math.floor(random() * 3)]);
			}

			assert.deepStrictEqual(join(tables, nullModes), previousJoin(tables, nullModes), `case ${caseIdx}`);
		}
	});

	it('does not mutate input tables or columns', () => {
		const tables = [
			[[1, 3], [10, null]],
			[[2, 3], [20, 30]],
		];
		const before = structuredClone(tables);
		join(tables, [[NULL_RETAIN, NULL_EXPAND], [NULL_RETAIN, NULL_RETAIN]]);
		assert.deepStrictEqual(tables, before);
	});
});
