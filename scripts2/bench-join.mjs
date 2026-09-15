import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { join } from '../src/utils.js';

const NULL_RETAIN = 1;

function nullExpand(yVals, nullIdxs, alignedLen) {
	for (let i = 0, xi, lastNullIdx = -1; i < nullIdxs.length; i++) {
		const nullIdx = nullIdxs[i];
		if (nullIdx > lastNullIdx) {
			xi = nullIdx - 1;
			while (xi >= 0 && yVals[xi] == null)
				yVals[xi--] = null;
			xi = nullIdx + 1;
			while (xi < alignedLen && yVals[xi] == null)
				yVals[lastNullIdx = xi++] = null;
		}
	}
}

function allHeadersSame(tables) {
	const vals0 = tables[0][0];
	for (let i = 1; i < tables.length; i++) {
		const vals1 = tables[i][0];
		if (vals1.length != vals0.length)
			return false;
		if (vals1 != vals0) {
			for (let j = 0; j < vals0.length; j++) {
				if (vals1[j] != vals0[j])
					return false;
			}
		}
	}
	return true;
}

function previousJoin(tables, nullModes) {
	if (allHeadersSame(tables)) {
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

	const data = [Array.from(xVals).sort((a, b) => a - b)];
	const alignedLen = data[0].length;
	const xIdxs = new Map();
	for (let i = 0; i < alignedLen; i++)
		xIdxs.set(data[0][i], i);

	for (let ti = 0; ti < tables.length; ti++) {
		const [xs, ...series] = tables[ti];
		for (let si = 0; si < series.length; si++) {
			const yVals = Array(alignedLen).fill(undefined);
			const nullMode = nullModes ? nullModes[ti][si + 1] : NULL_RETAIN;
			const nullIdxs = [];
			for (let i = 0; i < series[si].length; i++) {
				const yVal = series[si][i];
				const alignedIdx = xIdxs.get(xs[i]);
				if (yVal === null) {
					if (nullMode != 0) {
						yVals[alignedIdx] = null;
						if (nullMode == 2)
							nullIdxs.push(alignedIdx);
					}
				}
				else
					yVals[alignedIdx] = yVal;
			}
			nullExpand(yVals, nullIdxs, alignedLen);
			data.push(yVals);
		}
	}
	return data;
}

function makeTables(tableCount, overlap, seriesCount = 1) {
	return Array.from({ length: tableCount }, (_, ti) => {
		let xs;
		if (overlap == 'fully matching')
			xs = Array.from({ length: 1000 }, (_, i) => i);
		else {
			const common = overlap == 'mostly overlap' ? 900 : overlap == 'some overlap' ? 100 : 0;
			xs = Array.from({ length: common }, (_, i) => i);
			const unique = Array.from({ length: 1000 - common }, (_, i) => common + ti * (1000 - common) + i);
			xs.push(...unique);
		}
		const series = Array.from({ length: seriesCount }, (_, si) =>
			xs.map((x, i) => i % 97 == 0 ? null : i % 89 == 0 ? undefined : x + ti + si));
		return [xs, ...series];
	});
}

function median(values) {
	values.sort((a, b) => a - b);
	return values[values.length >> 1];
}

function measure(fn, tables, iterations) {
	const samples = [];
	for (let sample = 0; sample < 5; sample++) {
		globalThis.gc?.();
		const start = performance.now();
		for (let i = 0; i < iterations; i++)
			fn(tables);
		samples.push((performance.now() - start) / iterations);
	}
	return median(samples);
}

console.log('Each table has 1,000 sorted X values and one Y series. Times are median milliseconds per join.');
console.log('| Tables | Overlap | Union | Previous | Sorted join | Speedup |');
console.log('| ---: | --- | ---: | ---: | ---: | ---: |');

for (const tableCount of [2, 5, 20, 100]) {
	for (const overlap of ['fully matching', 'mostly overlap', 'some overlap', 'no overlap']) {
		const tables = makeTables(tableCount, overlap);
		const expected = previousJoin(tables);
		assert.deepStrictEqual(join(tables), expected);
		const unionLen = expected[0].length;
		const iterations = Math.max(1, Math.min(200, Math.floor(5e6 / (unionLen * tableCount))));
		previousJoin(tables);
		join(tables);
		const previous = measure(previousJoin, tables, iterations);
		const merged = measure(join, tables, iterations);
		console.log(`| ${tableCount} | ${overlap} | ${unionLen} | ${previous.toFixed(3)} | ${merged.toFixed(3)} | ${(previous / merged).toFixed(2)}x |`);
	}
}

console.log('\nSome-overlap joins with multiple Y series per table.');
console.log('| Tables | Y series | Previous | Sorted join | Speedup |');
console.log('| ---: | ---: | ---: | ---: | ---: |');

for (const tableCount of [5, 20]) {
	for (const seriesCount of [1, 5, 20]) {
		const tables = makeTables(tableCount, 'some overlap', seriesCount);
		assert.deepStrictEqual(join(tables), previousJoin(tables));
		const iterations = Math.max(1, Math.floor(1e6 / (tables.length * seriesCount * previousJoin(tables)[0].length)));
		const previous = measure(previousJoin, tables, iterations);
		const merged = measure(join, tables, iterations);
		console.log(`| ${tableCount} | ${seriesCount} | ${previous.toFixed(3)} | ${merged.toFixed(3)} | ${(previous / merged).toFixed(2)}x |`);
	}
}
