import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../demos/lib/mean-gam.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const {meanGAM, createMeanGAM} = context;

function close(actual, expected, tolerance = 1e-9) {
	assert.ok(Number.isFinite(actual), `nonfinite result: ${actual}`);
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
}

function closeArray(actual, expected, tolerance) {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		if (expected[i] === null) assert.equal(actual[i], null, `missing position ${i}`);
		else close(actual[i], expected[i], tolerance);
	}
}

// Independent recursive Cox-de Boor basis on an extended uniform knot vector.
function basisRow(x, count) {
	const knots = Array.from({length: count + 4}, (_, i) => (i - 3) / (count - 3));
	function basis(i, degree) {
		if (degree === 0) return knots[i] <= x && x < knots[i + 1] ? 1 : 0;
		return (x - knots[i]) / (knots[i + degree] - knots[i]) * basis(i, degree - 1)
			+ (knots[i + degree + 1] - x) / (knots[i + degree + 1] - knots[i + 1]) * basis(i + 1, degree - 1);
	}
	return Array.from({length: count}, (_, i) => basis(i, 3));
}

// Dense Gaussian elimination with pivoting, not the production banded Cholesky.
function denseSolve(matrix, rhs) {
	const a = matrix.map((row, i) => [...row, rhs[i]]);
	const n = rhs.length;
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++) {
			if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
		}
		assert.ok(Math.abs(a[pivot][col]) > 1e-14);
		[a[col], a[pivot]] = [a[pivot], a[col]];
		for (let row = col + 1; row < n; row++) {
			const ratio = a[row][col] / a[col][col];
			for (let j = col; j <= n; j++) a[row][j] -= ratio * a[col][j];
		}
	}
	const result = Array(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		let value = a[i][n];
		for (let j = i + 1; j < n; j++) value -= a[i][j] * result[j];
		result[i] = value / a[i][i];
	}
	return result;
}

function reference(data, {x, knots, lambda}) {
	const indices = Array.from({length: data.length}, (_, i) => i).filter(i => Number.isFinite(data[i]));
	const values = indices.map(i => data[i]);
	const low = Math.min(...values);
	const high = Math.max(...values);
	const center = low / 2 + high / 2;
	const scale = Math.max(high - center, center - low);
	const coordinates = indices.map(i => x === undefined ? i : x[i]);
	const first = coordinates[0];
	const range = coordinates.at(-1) - first;
	const rows = coordinates.map(value => basisRow((value - first) / range, knots));
	const y = values.map(value => (value - center) / scale);
	const matrix = Array.from({length: knots}, () => Array(knots).fill(0));
	const rhs = Array(knots).fill(0);
	for (let i = 0; i < rows.length; i++) {
		for (let a = 0; a < knots; a++) {
			rhs[a] += rows[i][a] * y[i];
			for (let b = 0; b < knots; b++) matrix[a][b] += rows[i][a] * rows[i][b];
		}
	}
	for (let i = 0; i < knots - 2; i++) {
		const d = Array(knots).fill(0);
		d[i] = d[i + 2] = 1;
		d[i + 1] = -2;
		for (let a = 0; a < knots; a++) {
			for (let b = 0; b < knots; b++) matrix[a][b] += lambda * d[a] * d[b];
		}
	}
	const beta = denseSolve(matrix, rhs);
	const result = Array(data.length).fill(null);
	for (let i = 0; i < rows.length; i++)
		result[indices[i]] = center + scale * rows[i].reduce((sum, value, j) => sum + value * beta[j], 0);
	return result;
}

function series(length) {
	const x = new Float64Array(length);
	const data = new Float64Array(length);
	let time = 0;
	for (let i = 0; i < length; i++) {
		time += 1 + i % 5;
		x[i] = time;
		data[i] = Math.sin(i / 7) + Math.cos(i * 2) / 5;
	}
	return {x, data};
}

function countedContext(limit = 8192) {
	const work = {allocations: 0, allocated: 0, largest: 0, factors: 0, solves: 0, steps: 0, limit};
	let instrumented = source;
	const replaceOnce = (from, to) => {
		assert.equal(instrumented.split(from).length, 2);
		instrumented = instrumented.replace(from, to);
	};
	replaceOnce("'use strict';", "'use strict'; const work = globalThis.work;");
	replaceOnce('function bandedCholesky(gram, penalty, weight, lower, size) {', 'function bandedCholesky(gram, penalty, weight, lower, size) { work.factors++;');
	replaceOnce('function bandedSolve(lower, rhs, beta, size) {', 'function bandedSolve(lower, rhs, beta, size) { work.solves++;');
	replaceOnce('const result = [];', 'const result = new Array(0);');
	// Audit literals as well as constructors: no hidden per-call arrays or objects.
	const callable = source.slice(source.indexOf('return function(data,'));
	assert.doesNotMatch(callable, /=\s*\[|=\s*\{|return\s*[\[{]|=>\s*\(?\s*\{|\.\.\./);
	assert.doesNotMatch(source, /\bwhile\s*\(|\bdo\s*\{|\.(?:sort|toSorted)\s*\(/);
	let loops = 0;
	instrumented = instrumented.replace(/for \(let ([^;\n]+); ([^;\n]+);/g, (_, init, condition) => {
		loops++;
		return `for (let ${init}; (work.steps++, ${condition});`;
	});
	assert.equal(loops, (source.match(/\bfor\s*\(/g) || []).length);
	const sandbox = vm.createContext({work});
	vm.runInContext(`
		{
			const work = globalThis.work;
			const track = array => {
				if (array.length > work.limit) throw new Error('dense/nonlocal allocation');
				work.allocations++;
				work.allocated += array.length;
				work.largest = Math.max(work.largest, array.length);
				return array;
			};
			const forbidden = () => { throw new Error('helper allocation or sorting is forbidden'); };
			const typed = Object.getPrototypeOf(Float64Array.prototype);
			for (const prototype of [Array.prototype, typed]) {
				for (const method of ['sort', 'toSorted', 'map', 'slice', 'filter', 'concat', 'subarray'])
					prototype[method] = forbidden;
				const fill = prototype.fill;
				prototype.fill = function(value, start = 0, end = this.length) {
					work.steps += end - start;
					return fill.call(this, value, start, end);
				};
			}
			Array.from = Array.of = typed.constructor.from = typed.constructor.of = forbidden;
			for (const name of ['Array', 'Float64Array', 'Float32Array', 'Uint32Array', 'Int32Array', 'Uint8Array']) {
				globalThis[name] = new Proxy(globalThis[name], {
					construct(Type, args) {
						if (typeof args[0] === 'number' && args[0] > work.limit) throw new Error('dense/nonlocal allocation');
						return track(new Type(...args));
					},
					apply(Type, receiver, args) { return track(Reflect.apply(Type, receiver, args)); },
				});
			}
		}
	`, sandbox);
	vm.runInContext(instrumented, sandbox);
	return {sandbox, work};
}

function resetWork(work) {
	for (const key of ['allocations', 'allocated', 'largest', 'factors', 'solves', 'steps']) work[key] = 0;
}

describe('standalone mean GAM', () => {
	it('exposes only two globals and defaults to 30 coefficients, lambda 1, and index x', () => {
		assert.deepEqual(Object.keys(context).sort(), ['createMeanGAM', 'meanGAM']);
		const {data} = series(41);
		const actual = meanGAM(data);
		assert.ok(Array.isArray(actual));
		assert.deepEqual(Array.from(actual), Array.from(meanGAM(data, {knots: 30, lambda: 1})));
		closeArray(actual, meanGAM(data, {x: Array.from(data, (_, i) => i)}));
		closeArray(actual, reference(data, {knots: 30, lambda: 1}));
	});

	it('handles empty, missing, singleton, constant, and two-observation fits analytically', () => {
		const {sandbox, work} = countedContext();
		const noCoercion = {valueOf() { throw new Error('must not coerce'); }};
		for (const data of [[], Array(8), [null, NaN, Infinity, -Infinity, undefined, '2', false, 1n, Symbol(), noCoercion],
			[null, 7, null], [7, NaN, 7, 7], [null, -4, null, 9, null], [Number.MAX_VALUE], [Number.MIN_VALUE]]) {
			closeArray(sandbox.meanGAM(data), Array.from(data, value => Number.isFinite(value) ? value : null), 0);
		}
		assert.equal(work.factors, 0);
		assert.equal(work.solves, 0);
	});

	it('matches independent dense least-squares optima for irregular x, gaps, and different penalties', () => {
		const data = [null, 2, -1, 4, NaN, 0.5, -3, 7, 1, 0, null];
		const irregular = [-1000, 0, 0.1, 2, 2.1, 9, 15, 15.01, 30, 31, 1e6];
		for (const x of [undefined, irregular]) {
			for (const [knots, lambda] of [[4, 0.001], [7, 1], [12, 30]]) {
				const options = {x, knots, lambda};
				closeArray(meanGAM(data, options), reference(data, options), 2e-9);
			}
		}
	});

	it('preserves affine responses at endpoints and across irregular internal and endpoint gaps', () => {
		for (const x of [[0, 1, 2, 3, 4, 5, 6], [-1e12, 10, 10.125, 14, 19, 25, 1e12]]) {
			const data = x.map((value, i) => i === 0 || i === 3 || i === 6 ? null : 3 * value - 2);
			for (const lambda of [0.01, 1, 100]) closeArray(meanGAM(data, {x, lambda}), data, 2e-8);
		}
		const data = [null, -5, -3, null, 1, 3, null];
		closeArray(meanGAM(data), data);
	});

	it('anchors the domain to observed pairs without compressing internal gaps', () => {
		const data = [3, -2, null, 5, 1, -4];
		const x = [10, 10.1, 11, 12, 20, 40];
		const options = {x, knots: 8, lambda: 0.3};
		const actual = meanGAM(data, options);
		closeArray(meanGAM([null, ...data, NaN], {...options, x: [-1e200, ...x, 1e200]}).slice(1, -1), actual);
		closeArray(meanGAM([null, ...data, NaN], {knots: 8, lambda: 0.3}).slice(1, -1), meanGAM(data, {knots: 8, lambda: 0.3}));
		const indices = data.map((_, i) => i).filter(i => Number.isFinite(data[i]));
		closeArray(meanGAM(indices.map(i => data[i]), {...options, x: indices.map(i => x[i])}), indices.map(i => actual[i]));
		const compressed = meanGAM(indices.map(i => data[i]), {knots: 8, lambda: 0.3});
		assert.ok(compressed.some((value, j) => Math.abs(value - actual[indices[j]]) > 0.1));
	});

	it('retains x distances through epoch offsets, scaling, opposite extremes, and subnormal spans', () => {
		const x = [0, 0.125, 0.25, 1, 4, 16];
		const data = [2, -1, 4, 0, -2, 3];
		const options = {knots: 7, lambda: 0.5};
		const expected = meanGAM(data, {...options, x});
		for (const transformed of [x.map(v => 1e12 + v), x.map(v => v * 8 - 100)])
			closeArray(meanGAM(data, {...options, x: transformed}), expected);
		const fractions = [-1, -0.5, 0, 0.5, 1];
		const values = [1, -2, 4, null, 0];
		closeArray(meanGAM(values, {...options, x: fractions.map(v => v * Number.MAX_VALUE)}), meanGAM(values, {...options, x: fractions}));
		closeArray(meanGAM(data, {...options, x: [0, 1, 3, 4, 10, 20].map(v => v * Number.MIN_VALUE)}), meanGAM(data, {...options, x: [0, 1, 3, 4, 10, 20]}));
	});

	it('centers large response offsets and respects positive and negative response scaling', () => {
		const {data} = series(41);
		const options = {knots: 8, lambda: 2};
		const expected = meanGAM(data, options);
		for (const [offset, scale, tolerance] of [[0, 1e-200, 1e-9], [0, 1e200, 1e-9], [0, -3, 1e-9], [1e12, 1, 0.0003]])
			closeArray(meanGAM(data.map(v => offset + scale * v), options).map(v => (v - offset) / scale), expected, tolerance);
	});

	it('uses every observation and increases smoothing with lambda, rather than fitting a median', () => {
		const data = Array.from({length: 61}, (_, i) => Math.sin(i / 5) + 0.2 * Math.cos(i * 2));
		data[29] = 40;
		const weak = meanGAM(data, {knots: 14, lambda: 0.001});
		const strong = meanGAM(data, {knots: 14, lambda: 100});
		const roughness = values => values.slice(2).reduce((sum, v, i) => sum + (v - 2 * values[i + 1] + values[i]) ** 2, 0);
		const error = values => values.reduce((sum, v, i) => sum + (v - data[i]) ** 2, 0);
		assert.ok(roughness(strong) < roughness(weak) / 10);
		assert.ok(error(strong) > error(weak));
		// The unpenalized constant and linear directions require zero residual moments.
		for (const curve of [weak, strong]) {
			close(curve.reduce((sum, value, i) => sum + value - data[i], 0), 0, 2e-9);
			close(curve.reduce((sum, value, i) => sum + i * (value - data[i]), 0), 0, 2e-7);
		}
	});

	it('restores extreme responses without premature overflow and clamps only the final output', () => {
		const limit = Number.MAX_VALUE;
		const step = Array.from({length: 20}, (_, i) => i < 8 ? -1 : 0.8);
		for (const lambda of [0.001, 10]) {
			for (const sign of [1, -1]) {
				const data = step.map(v => sign * v);
				const expected = meanGAM(data, {knots: 8, lambda});
				const extreme = meanGAM(data.map(v => v * limit), {knots: 8, lambda});
				closeArray(extreme.map(v => v / limit), expected.map(v => Math.max(-1, Math.min(1, v))), 1e-12);
				if (lambda === 0.001) {
					assert.ok(Math.abs(expected[12]) > 0.9 && Math.abs(expected[12]) < 1);
					assert.ok(Math.abs(extreme[12]) < limit, 'overflowing product must cancel with the center');
				}
				else assert.equal(extreme.at(-1), sign * limit);
			}
		}
		for (const data of [[-1, 0, 1], [-1, 1, -1], [null, -1, 0.5, 1, -0.25, null]]) {
			const expected = meanGAM(data, {knots: 4});
			closeArray(meanGAM(data.map(v => v === null ? null : v * limit), {knots: 4}).map(v => v === null ? null : v / limit), expected, 1e-12);
		}
	});

	it('does not modify arrays, options, or typed subviews and their backing buffers', () => {
		const data = Object.freeze([2, -1, null, 4, 1]);
		const x = Object.freeze([0, 1, 2, 5, 8]);
		const options = Object.freeze({x, knots: 6, lambda: 0.2});
		closeArray(meanGAM(data, options), reference(data, options));
		const yBuffer = new Float64Array([999, 2, -1, NaN, 4, 1, 999]);
		const xBuffer = new Float64Array([999, 0, 1, 2, 5, 8, 999]);
		const yBefore = yBuffer.slice();
		const xBefore = xBuffer.slice();
		closeArray(meanGAM(yBuffer.subarray(1, 6), {...options, x: xBuffer.subarray(1, 6)}), meanGAM(data, options));
		assert.deepEqual(yBuffer, yBefore);
		assert.deepEqual(xBuffer, xBefore);
		closeArray(meanGAM(new Int16Array([1, 2, 3])), [1, 2, 3]);
	});

	it('validates data and options even for empty and constant fits', () => {
		for (const data of [null, undefined, 3, '123', {}, {length: 3}, new DataView(new ArrayBuffer(0)), new BigInt64Array(0), new BigUint64Array([1n])])
			assert.throws(() => meanGAM(data), {name: 'TypeError', message: /data/});
		for (const data of [[], [7]]) {
			for (const knots of [0, -1, 3, 4.5, NaN, Infinity, '8', null, false, 8n, Number.MAX_SAFE_INTEGER + 1])
				assert.throws(() => meanGAM(data, {knots}), {name: 'RangeError', message: /knots/});
			for (const lambda of [0, -1, NaN, Infinity, -Infinity, '1', null, false, 1n])
				assert.throws(() => meanGAM(data, {lambda}), {name: 'RangeError', message: /lambda/});
		}
		assert.throws(() => meanGAM([], null), {name: 'TypeError'});
	});

	it('requires finite strictly increasing x at every position, including missing responses', () => {
		for (const x of [null, false, 3, '123', {}, new DataView(new ArrayBuffer(0)), new BigInt64Array(0), new BigUint64Array([1n])])
			assert.throws(() => meanGAM([], {x}), {name: 'TypeError', message: /x/});
		assert.throws(() => meanGAM([], {x: [1]}), {name: 'RangeError', message: /x length/});
		const noCoercion = {valueOf() { throw new Error('must not coerce'); }};
		for (const value of [null, undefined, NaN, Infinity, -Infinity, '1', false, 1n, Symbol(), noCoercion])
			assert.throws(() => meanGAM([1, null, 2], {x: [0, value, 2]}), {name: 'RangeError', message: /x.*finite/});
		for (const x of [[0, 0, 1], [0, 2, 1], [2, 1, 0], [-0, 0, 1], [0, , 2], [NaN, 1, 2], [0, 1, Infinity]]) {
			for (const data of [[1, null, 2], [7, 7, 7], [null, null, null]])
				assert.throws(() => meanGAM(data, {x}), {name: 'RangeError', message: /x.*finite.*increasing/});
		}
	});

	it('reports numerical singularity instead of silently changing the requested penalty', () => {
		assert.throws(() => meanGAM([1, -2, 3, 0], {lambda: Number.MAX_VALUE}), {name: 'RangeError', message: /numerically singular/});
	});
});

describe('reusable mean GAM workspace', () => {
	it('rereads changed samples, x, and options, preserves output identity, and clears stale values', () => {
		const fit = createMeanGAM();
		const {data, x} = series(48);
		const options = {x, knots: 9, lambda: 0.2};
		const result = fit(data, options);
		const initial = Array.from(result);
		data[7] = 30;
		data[12] = NaN;
		x[15] += 0.25;
		options.knots = 6;
		options.lambda = 3;
		assert.equal(fit(data, options), result);
		closeArray(result, reference(data, options));
		assert.notDeepEqual(Array.from(result), initial);
		assert.equal(result[12], null);
		const snapshot = Array.from(result);
		x[15] = x[14];
		assert.throws(() => fit(data, options), {name: 'RangeError', message: /x/});
		assert.deepEqual(Array.from(result), snapshot);
		x[15] = x[14] + 0.5;
		options.lambda = 0;
		assert.throws(() => fit(data, options), {name: 'RangeError', message: /lambda/});
		assert.deepEqual(Array.from(result), snapshot);
		for (const next of [[], [3], [NaN, 2, 2], series(80).data, [1, -1, 2]]) {
			assert.equal(fit(next), result);
			closeArray(result, meanGAM(next));
		}
		assert.equal(fit(data, {x}), result);
		closeArray(result, meanGAM(data, {x}));
	});

	it('keeps one-shot results and separate fitter workspaces independent', () => {
		const {data} = series(21);
		const first = meanGAM(data);
		const second = meanGAM(data);
		assert.notEqual(first, second);
		const fitA = createMeanGAM();
		const fitB = createMeanGAM();
		const a = fitA(data);
		const b = fitB(data);
		const snapshot = Array.from(b);
		assert.notEqual(a, b);
		a[0] = 999;
		first[1] = 999;
		fitA([1, 2, 3]);
		closeArray(b, snapshot, 0);
		closeArray(second, snapshot, 0);
		closeArray(meanGAM(b), meanGAM(snapshot), 0);
	});

	it('rejects its own output as data or x before any output or workspace mutation', () => {
		const {sandbox, work} = countedContext();
		const fit = sandbox.createMeanGAM();
		const {data} = series(24);
		const result = fit(data);
		const snapshot = Array.from(result);
		resetWork(work);
		for (const run of [() => fit(result), () => fit(data, {x: result}), () => fit(result, {x: result, knots: 1000})]) {
			assert.throws(run, {name: 'TypeError', message: /alias.*output/});
			assert.deepEqual(Array.from(result), snapshot);
			assert.equal(work.allocations, 0);
			assert.equal(work.steps, 0);
		}
		closeArray(fit(snapshot), meanGAM(snapshot), 0);
		const other = sandbox.createMeanGAM()(data);
		closeArray(fit(other), meanGAM(other), 0);
		fit([]);
		assert.throws(() => fit([], {x: result}), {name: 'TypeError', message: /alias/});
		assert.equal(result.length, 0);
	});

	it('allocates no helper buffers, views, arrays, or result objects on warmed calls', () => {
		const {sandbox, work} = countedContext();
		const fit = sandbox.createMeanGAM();
		const warm = series(128);
		const result = fit(warm.data, {x: warm.x, knots: 40});
		for (const [length, knots, lambda, kind] of [[128, 40, 1, 'varied'], [33, 4, 0.01, 'varied'], [60, 17, 10, 'gaps'], [12, 30, 1, 'constant'], [0, 4, 1, 'missing'], [128, 40, 1, 'varied']]) {
			const {x, data} = series(length);
			if (kind === 'constant') data.fill(7);
			if (kind === 'gaps') data[3] = data[9] = NaN;
			const options = {x, knots, lambda};
			resetWork(work);
			assert.equal(fit(data, options), result);
			assert.equal(work.allocations, 0);
			assert.equal(work.allocated, 0);
			const factors = kind === 'constant' || length === 0 ? 0 : 1;
			assert.equal(work.factors, factors);
			assert.equal(work.solves, factors);
			closeArray(result, meanGAM(data, options), 0);
		}
		resetWork(work);
		fit(warm.data);
		assert.equal(work.allocations, 0, 'omitted options must not allocate');
		const small = series(17);
		resetWork(work);
		fit(small.data, {knots: 4});
		const steps = work.steps;
		resetWork(work);
		sandbox.meanGAM(small.data, {knots: 4});
		assert.equal(work.steps, steps, 'work must use active sizes, not retained capacities');
	});

	it('grows sample and coefficient buffers geometrically for streaming calls', () => {
		const {sandbox, work} = countedContext();
		const fit = sandbox.createMeanGAM();
		let capacity = 0;
		let knotCapacity = 0;
		let result;
		let allocated = 0;
		for (const [length, knots] of [[3, 4], [4, 5], [5, 6], [7, 9], [8, 10], [13, 17], [24, 24], [25, 33], [48, 40], [49, 41], [96, 64], [3, 4], [96, 64]]) {
			let expectedAllocations = 0;
			let expectedSlots = 0;
			if (length > capacity) {
				capacity = Math.max(length, 2 * capacity);
				expectedAllocations += 4;
				expectedSlots += 7 * capacity;
			}
			if (knots > knotCapacity) {
				knotCapacity = Math.max(knots, 2 * knotCapacity);
				expectedAllocations += 5;
				expectedSlots += 14 * knotCapacity;
			}
			const {data, x} = series(length);
			resetWork(work);
			const actual = fit(data, {x, knots});
			if (result !== undefined) assert.equal(actual, result);
			result = actual;
			assert.equal(work.allocations, expectedAllocations);
			assert.equal(work.allocated, expectedSlots);
			assert.equal(work.factors, 1);
			assert.equal(work.solves, 1);
			allocated += work.allocated;
			closeArray(actual, meanGAM(data, {x, knots}), 0);
		}
		assert.ok(allocated < 2 * (7 * capacity + 14 * knotCapacity));
	});

	it('has linear work and storage in both n and k, with exactly one factor and solve', () => {
		const measurements = [];
		for (const [length, knots] of [[128, 8], [256, 8], [128, 64], [128, 128]]) {
			const {sandbox, work} = countedContext(4 * Math.max(length, knots));
			const {data, x} = series(length);
			closeArray(sandbox.meanGAM(data, {x, knots}), meanGAM(data, {x, knots}), 0);
			assert.equal(work.factors, 1);
			assert.equal(work.solves, 1);
			assert.equal(work.allocated, 7 * length + 14 * knots);
			assert.ok(work.steps < 100 * (length + knots));
			measurements.push(work.steps);
		}
		assert.ok(measurements[1] > measurements[0] && measurements[1] < 2 * measurements[0]);
		assert.ok(measurements[3] > measurements[2] && measurements[3] < 2 * measurements[2]);
	});

	it('fits a large irregular series with gaps in linear space', () => {
		const {data, x} = series(16000);
		for (let i = 0; i < data.length; i += 31) data[i] = NaN;
		const result = meanGAM(data, {x, knots: 512, lambda: 2});
		assert.equal(result.length, data.length);
		let residual = 0;
		for (let i = 0; i < data.length; i++) {
			if (Number.isFinite(data[i])) {
				assert.ok(Number.isFinite(result[i]));
				residual += result[i] - data[i];
			}
			else assert.equal(result[i], null);
		}
		close(residual, 0, 1e-8);
	});
});
