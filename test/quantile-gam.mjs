import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

// The iterative solver suite is opt-in to keep normal runs fast.
const describeQuantile = process.env.TEST_QUANTILE_GAM === '1' ? describe : describe.skip;

const source = readFileSync(new URL('../demos/lib/quantile-gam.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const {quantileGAM, createQuantileGAM} = context;
const plain = result => ({
	curves: Array.from(result.curves, curve => Array.from(curve)),
	iterations: Array.from(result.iterations),
	converged: Array.from(result.converged),
});

function close(actual, expected, tolerance = 1e-4) {
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

function checkConvergence(result) {
	assert.ok(result.converged.every(Boolean), `did not converge: ${result.iterations}`);
	for (const count of result.iterations) assert.ok(Number.isInteger(count) && count >= 0 && count <= 10000);
}

// Independent basis: recursive Cox-de Boor on an extended uniform knot vector,
// rather than the helper's four explicit cardinal-cubic polynomials.
function basisRow(x, count) {
	const knots = Array.from({length: count + 4}, (_, i) => (i - 3) / (count - 3));
	function basis(i, degree) {
		if (degree === 0) return knots[i] <= x && x < knots[i + 1] ? 1 : 0;
		return (x - knots[i]) / (knots[i + degree] - knots[i]) * basis(i, degree - 1)
			+ (knots[i + degree + 1] - x) / (knots[i + degree + 1] - knots[i + 1]) * basis(i + 1, degree - 1);
	}
	return Array.from({length: count}, (_, i) => basis(i, 3));
}

function denseSolve(matrix, rhs) {
	const a = matrix.map((row, i) => [...row, rhs[i]]);
	const n = rhs.length;
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++) {
			if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
		}
		if (Math.abs(a[pivot][col]) < 1e-10) return null;
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

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

function objective(y, fitted, beta, lambda, tau, size = y.length, knots = beta.length) {
	let value = 0;
	for (let i = 0; i < size; i++) {
		const residual = y[i] - fitted[i];
		value += residual * (residual < 0 ? tau - 1 : tau);
	}
	for (let i = 2; i < knots; i++)
		value += lambda / 2 * (beta[i] - 2 * beta[i - 1] + beta[i - 2]) ** 2;
	return value;
}

function fitWithObjectives(data, options) {
	const objectives = [];
	const probe = vm.createContext({capture: (...args) => objectives.push(objective(...args))});
	const output = 'for (let i = 0; i < size; i++) curves[q][xs[i]] = max';
	assert.equal(source.split(output).length, 2);
	vm.runInContext(source.replace(output, `capture(ys, fitted, beta, lambda, tau, size, knots); ${output}`), probe);
	const result = probe.quantileGAM(data, options);
	assert.deepEqual(plain(result), plain(quantileGAM(data, options)));
	return {result, objectives};
}

// Exhaust all residual sign/zero patterns on tiny datasets. Each pattern gives
// a dense KKT system, with no ADMM, banded algebra, or soft-threshold operator.
// Feasibility plus bounded pinball subgradients certifies a global minimum.
function reference(data, count, lambda, tau, x) {
	const xs = Array.from({length: data.length}, (_, i) => i).filter(i => Number.isFinite(data[i]));
	const values = xs.map(i => data[i]);
	const low = Math.min(...values);
	const high = Math.max(...values);
	const center = (low + high) / 2;
	const scale = (high - low) / 2;
	const y = values.map(v => (v - center) / scale);
	const coordinates = xs.map(i => x === undefined ? i : x[i]);
	const first = coordinates[0];
	const last = coordinates[coordinates.length - 1];
	const b = coordinates.map(v => basisRow((v - first) / (last - first), count));
	const penalty = Array.from({length: count}, () => Array(count).fill(0));
	for (let i = 0; i < count - 2; i++) {
		const d = Array.from({length: count}, (_, j) => j === i || j === i + 2 ? 1 : j === i + 1 ? -2 : 0);
		for (let j = 0; j < count; j++) {
			for (let k = 0; k < count; k++) penalty[j][k] += lambda * d[j] * d[k];
		}
	}
	for (let code = 0; code < 3 ** y.length; code++) {
		let remaining = code;
		const signs = y.map(() => {
			const sign = remaining % 3 - 1;
			remaining = Math.floor(remaining / 3);
			return sign;
		});
		const active = signs.flatMap((sign, i) => sign === 0 ? [i] : []);
		if (active.length < 2 || active.length > count) continue;
		const n = count + active.length;
		const matrix = Array.from({length: n}, () => Array(n).fill(0));
		const rhs = Array(n).fill(0);
		for (let j = 0; j < count; j++) {
			for (let k = 0; k < count; k++) matrix[j][k] = penalty[j][k];
			for (let i = 0; i < y.length; i++) {
				if (signs[i] !== 0) rhs[j] += b[i][j] * (signs[i] > 0 ? tau : tau - 1);
			}
			active.forEach((i, a) => {
				matrix[j][count + a] = -b[i][j];
				matrix[count + a][j] = b[i][j];
				rhs[count + a] = y[i];
			});
		}
		const solution = denseSolve(matrix, rhs);
		if (solution === null) continue;
		const beta = solution.slice(0, count);
		if (solution.slice(count).some(w => w < tau - 1 - 1e-8 || w > tau + 1e-8)) continue;
		if (y.some((value, i) => signs[i] !== 0 && signs[i] * (value - dot(b[i], beta)) < -1e-8)) continue;
		const curve = Array(data.length).fill(null);
		const fitted = b.map(row => dot(row, beta));
		xs.forEach((x, i) => { curve[x] = center + scale * fitted[i]; });
		return {curve, objective: objective(y, fitted, beta, lambda, tau)};
	}
	assert.fail('reference could not certify an optimum');
}

function roughness(curve) {
	let sum = 0;
	for (let i = 1; i < curve.length - 1; i++) sum += (curve[i - 1] - 2 * curve[i] + curve[i + 1]) ** 2;
	return sum;
}

function irregularSeries(length) {
	const x = new Float64Array(length);
	const data = new Float64Array(length);
	let time = 1.7e12;
	for (let i = 0; i < length; i++) {
		time += 1 + (i % 13) / 4;
		x[i] = time;
		data[i] = Math.sin(i / 31) + 0.3 * Math.cos(i * 1.7) + (i % 29 === 0 ? 2 : 0);
	}
	return {x, data};
}

// Count loop-condition evaluations and bulk array visits, not elapsed time.
// Instrument only this helper's loop syntax; fail if new loops escape counting.
function countedContext(limit) {
	const work = {phase: 'prep', prep: 0, warm: 0, fit: 0, allocated: 0, allocations: 0, objects: 0, largest: 0, factors: 0, limit};
	let instrumented = source;
	const replaceOnce = (from, to) => {
		assert.equal(instrumented.split(from).length, 2);
		instrumented = instrumented.replace(from, to);
	};
	replaceOnce("'use strict';", "'use strict'; const work = globalThis.work;");
	replaceOnce('function factor(gram, penalty, weight, lower, size) {', 'function factor(gram, penalty, weight, lower, size) { work.factors++;');
	replaceOnce('if (!Array.isArray(data)', "work.phase = 'prep'; if (!Array.isArray(data)");
	replaceOnce('for (let q = 0; q < quantiles.length; q++) {', "work.phase = 'fit'; for (let q = 0; q < quantiles.length; q++) {");
	replaceOnce('const result = {curves, iterations, converged};', 'const result = (work.objects++, {curves, iterations, converged});');
	// Make the four factory-owned array literals visible to constructor counters.
	assert.equal((source.match(/= \[\];/g) || []).length, 4);
	instrumented = instrumented.replace(/= \[\];/g, '= new Array(0);');
	// Histogram scans vary with the selected bin, but their bound is independent of n and k.
	replaceOnce('const tau = quantiles[q];', "work.phase = 'warm'; const tau = quantiles[q];");
	replaceOnce('for (let i = 0; i < size; i++) residual[i] = ys[i] - initial;', "work.phase = 'fit'; for (let i = 0; i < size; i++) residual[i] = ys[i] - initial;");
	let loops = 0;
	instrumented = instrumented.replace(/for \(let ([^;\n]+); ([^;\n]+);/g, (_, init, condition) => {
		loops++;
		return `for (let ${init}; (work[work.phase]++, ${condition});`;
	});
	assert.equal(loops, (source.match(/\bfor\s*\(/g) || []).length);
	assert.doesNotMatch(source, /\bwhile\s*\(|\bdo\s*\{/);
	assert.doesNotMatch(source, /\.(?:sort|toSorted)\s*\(/);
	const sandbox = vm.createContext({work});
	vm.runInContext(`
		{
			const work = globalThis.work;
			const track = array => {
				if (array.length > work.limit) throw new Error('nonlocal/dense allocation');
				work.allocated += array.length;
				work.allocations++;
				work.largest = Math.max(work.largest, array.length);
				return array;
			};
			const typed = Object.getPrototypeOf(Float64Array.prototype);
			for (const prototype of [Array.prototype, typed]) {
				prototype.sort = prototype.toSorted = () => { throw new Error('sorting is forbidden'); };
				const fill = prototype.fill;
				prototype.fill = function(value, start = 0, end = this.length) {
					work[work.phase] += end - start;
					return fill.call(this, value, start, end);
				};
				for (const method of ['map', 'slice', 'filter']) {
					const original = prototype[method];
					prototype[method] = function(...args) {
						work[work.phase] += this.length;
						return track(original.apply(this, args));
					};
				}
			}
			typed.subarray = () => { throw new Error('per-fit views are forbidden'); };
			const push = Array.prototype.push;
			Array.prototype.push = function(...args) {
				work[work.phase] += args.length;
				work.allocated += args.length;
				return push.apply(this, args);
			};
			const from = Array.from;
			Array.from = function(...args) {
				const array = from.apply(this, args);
				work[work.phase] += array.length;
				return track(array);
			};
			globalThis.WeakSet = new Proxy(WeakSet, {
				construct(Type, args) {
					work.objects++;
					return new Type(...args);
				},
			});
			for (const name of Object.getOwnPropertyNames(globalThis)) {
				if (name !== 'Array' && !/^(?:Float|Int|Uint|BigInt|BigUint)[0-9]+(?:Clamped)?Array$/.test(name)) continue;
				globalThis[name] = new Proxy(globalThis[name], {
					construct(Type, args) {
						if (typeof args[0] === 'number' && args[0] > work.limit) throw new Error('nonlocal/dense allocation');
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
	for (const key of ['prep', 'warm', 'fit', 'allocated', 'allocations', 'objects', 'largest', 'factors']) work[key] = 0;
}

function countedFit(length, knots, maxIterations, quantiles = [0.2, 0.8]) {
	const {sandbox, work} = countedContext(Math.max(256, 4 * Math.max(length, knots)));
	const {x, data} = irregularSeries(length);
	const options = {x, knots, lambda: 2, quantiles, maxIterations};
	const result = sandbox.quantileGAM(data, options);
	assert.deepEqual(plain(result), plain(quantileGAM(data, options)), 'instrumentation must not change the fit');
	assert.deepEqual(Array.from(result.iterations), quantiles.map(() => maxIterations));
	assert.ok(result.converged.every(value => !value));
	assert.ok(work.warm > 0 && work.warm <= 256 * quantiles.length, 'warm starts must scan at most 256 bins per quantile');
	return work;
}

describeQuantile('standalone single-smooth quantile GAM', () => {
	it('exposes only the two classic-script globals and uses the proposed defaults', () => {
		assert.deepEqual(new Set(Object.keys(context)), new Set(['quantileGAM', 'createQuantileGAM']));
		const data = Array.from({length: 81}, (_, i) => Math.sin(i / 10) + 0.2 * Math.cos(i * 3));
		const expected = plain(quantileGAM(data, {quantiles: [0.1, 0.5, 0.9], knots: 30, lambda: 1, maxIterations: 10000}));
		assert.deepEqual(plain(quantileGAM(data)), expected);
		assert.deepEqual(plain(quantileGAM(data, {})), expected);
		assert.deepEqual(plain(quantileGAM(data, {x: undefined, quantiles: undefined, knots: undefined, lambda: undefined, maxIterations: undefined})), expected);
		assert.deepEqual(plain(quantileGAM(data, {x: data.map((_, i) => i)})), expected);
		assert.deepEqual(Object.keys(expected), ['curves', 'iterations', 'converged']);
		checkConvergence(expected);
	});

	it('handles empty, missing-only, singleton, and exact constant responses analytically', () => {
		for (const data of [[], Array(4), [null, undefined, NaN, Infinity, -Infinity], [7], [null, 7, null]]) {
			for (const x of [undefined, Array.from({length: data.length}, (_, i) => i * i + i), Float64Array.from(data, (_, i) => 1e12 + i * i + i)]) {
				const result = plain(quantileGAM(data, {x, maxIterations: 1}));
				assert.deepEqual(result.curves, Array.from({length: 3}, () => Array.from(data, v => Number.isFinite(v) ? v : null)));
				assert.deepEqual(result.iterations, [0, 0, 0]);
				checkConvergence(result);
			}
		}
		for (const value of [0, -3.5, Number.MIN_VALUE, 1e-200, -1e200, Number.MAX_VALUE]) {
			const data = Array.from({length: 37}, (_, i) => i % 5 === 0 ? null : value);
			const result = quantileGAM(data, {quantiles: [0.01, 0.5, 0.99]});
			for (const curve of result.curves) assert.deepEqual(Array.from(curve), data);
			assert.deepEqual(Array.from(result.iterations), [0, 0, 0]);
			checkConvergence(result);
		}
	});

	it('does not coerce missing or nonnumeric samples', () => {
		const noCoercion = {valueOf() { throw new Error('must not coerce samples'); }};
		const data = [null, 4, undefined, NaN, Infinity, -Infinity, '9', false, 9n, Symbol('x'), noCoercion, 4, , 4];
		for (const curve of quantileGAM(data).curves)
			assert.deepEqual(Array.from(curve), Array.from(data, v => Number.isFinite(v) ? v : null));
	});

	it('reproduces affine data, including endpoints, two-point data, and uneven gaps', () => {
		for (const length of [2, 17, 101]) {
			for (const knots of [4, 8, 30, 60]) {
				const data = Array.from({length}, (_, i) => length > 2 && (i % 9 < 3 || i > 40 && i < 68) ? null : 2 - i / length);
				const result = quantileGAM(data, {knots, lambda: 10});
				checkConvergence(result);
				for (const curve of result.curves) closeArray(curve, data, 1e-4);
			}
		}
	});

	it('matches independent cubic-basis KKT optima for different penalties and quantiles', () => {
		const values = [-3, 2, 0, 5, -1, 4, 1];
		const gapped = Array(31).fill(null);
		[0, 1, 5, 8, 19, 27, 30].forEach((x, i) => { gapped[x] = values[i]; });
		for (const [data, x] of [
			[values], [gapped], [[null, ...values, null]], [[null, ...gapped, null]],
			[values, [-10, -9.875, -8.5, -7, -1, 0, 8]],
			[gapped, Array.from({length: gapped.length}, (_, i) => i * i / 16 - 50)],
			[[null, ...values, null], [-20, -10, -9.875, -8.5, -7, -1, 0, 8, 20]],
			[values.slice(0, 6), [0, 1, 2, 1e8, 1e8 + 1, 1e8 + 2]],
			[values.slice(0, 6), [0, 1, 2, 3, 4, 1e8]],
			[[null, ...values, null], [-Number.MAX_VALUE, ...[0, 0.25, 0.5, 1, 8, 8.25, 16].map(v => 1e12 + v), Number.MAX_VALUE]],
		]) {
			for (const knots of [4, 8]) {
				for (const lambda of [0.02, 0.8, 20]) {
					const quantiles = [0.15, 0.5, 0.85];
					const result = quantileGAM(data, {x, knots, lambda, quantiles});
					checkConvergence(result);
					quantiles.forEach((q, i) => closeArray(result.curves[i], reference(data, knots, lambda, q, x).curve, 0.001));
				}
			}
		}
	});

	it('matches KKT objectives for nearly non-unique fits on uneven observed clusters', () => {
		const data = [-3, 2, 0, 5, -1, 4, 1];
		for (const x of [[0, 1, 2, 1e8, 1e8 + 1, 1e8 + 2, 1e8 + 3], [0, 1, 2, 3, 4, 5, 1e8]]) {
			for (const knots of [4, 8]) {
				for (const lambda of [0.02, 0.8, 20]) {
					const quantiles = [0.15, 0.5, 0.85];
					const {result, objectives} = fitWithObjectives(data, {x, knots, lambda, quantiles});
					checkConvergence(result);
					// An almost flat pinball objective need not select the same curve
					// as the KKT enumeration, even with the same optimal objective value.
					quantiles.forEach((q, i) => close(objectives[i], reference(data, knots, lambda, q, x).objective, 1e-4));
					for (const curve of result.curves) assert.ok(curve.every(Number.isFinite));
				}
			}
		}
	});

	it('uses original indices, with gaps preserved instead of compressed', () => {
		const data = Array(101).fill(null);
		const xs = [0, 1, 4, 31, 32, 60, 61, 62, 98, 100];
		xs.forEach((x, i) => { data[x] = Math.sin(i) + i / 5; });
		const options = {knots: 8, lambda: 2};
		const result = quantileGAM(data, options);
		checkConvergence(result);
		const stretched = Array(201).fill(null);
		xs.forEach(x => { stretched[x * 2] = data[x]; });
		const equivalent = quantileGAM(stretched, options);
		const compressed = quantileGAM(xs.map(x => data[x]), options);
		for (let q = 0; q < 3; q++) {
			data.forEach((value, x) => {
				if (value === null) assert.equal(result.curves[q][x], null);
				else close(result.curves[q][x], equivalent.curves[q][x * 2], 1e-10);
			});
			assert.ok(xs.some((x, i) => Math.abs(result.curves[q][x] - compressed.curves[q][i]) > 0.1));
		}
	});

	it('reproduces affine responses in irregular x, including missing endpoints', () => {
		for (const length of [2, 17, 101]) {
			const x = Array.from({length}, (_, i) => i * i + i);
			for (const knots of [4, 8, 30, 60]) {
				for (const missing of [false, true]) {
					const data = x.map((v, i) => missing && length > 2 && (i % 7 === 0 || i === length - 1) ? null : 3 - 2 * v / x[length - 1]);
					const result = quantileGAM(data, {x, knots, lambda: 10});
					checkConvergence(result);
					for (const curve of result.curves) closeArray(curve, data, 1e-4);
				}
			}
		}
	});

	it('ignores missing endpoint padding and trimming while preserving internal gaps', () => {
		const x = [0, 1, 5, 9, 21, 22, 30, 34, 63, 64];
		const data = [null, 3, -2, null, 1, 5, 8, 0, -1, null];
		const options = {knots: 8, lambda: 2};
		const result = quantileGAM(data, {...options, x});
		checkConvergence(result);
		const expanded = Array(65).fill(null);
		x.forEach((v, i) => { expanded[v] = data[i]; });
		const equivalent = quantileGAM(expanded, options);
		const compressed = quantileGAM(data, options);
		const trimmed = quantileGAM(data.slice(1, -1), {...options, x: x.slice(1, -1)});
		const padded = quantileGAM([undefined, ...data, NaN], {...options, x: [-Number.MAX_VALUE, ...x, Number.MAX_VALUE]});
		assert.deepEqual(Array.from(result.iterations), Array.from(equivalent.iterations));
		assert.deepEqual(Array.from(result.iterations), Array.from(trimmed.iterations));
		assert.deepEqual(Array.from(result.iterations), Array.from(padded.iterations));
		checkConvergence(trimmed);
		checkConvergence(padded);
		for (let q = 0; q < 3; q++) {
			closeArray(result.curves[q], x.map(v => equivalent.curves[q][v]), 1e-10);
			assert.ok(data.some((y, i) => y !== null && Math.abs(result.curves[q][i] - compressed.curves[q][i]) > 0.1));
			closeArray(result.curves[q], [null, ...trimmed.curves[q], null], 0);
			closeArray(padded.curves[q], [null, ...result.curves[q], null], 0);
		}
		assert.deepEqual(plain(quantileGAM(data, {...options, x: data.map((_, i) => i)})), plain(compressed));
		const implicitTrimmed = quantileGAM(data.slice(1, -1), options);
		const implicitPadded = quantileGAM([undefined, null, ...data, NaN, Infinity], options);
		assert.deepEqual(Array.from(implicitTrimmed.iterations), Array.from(compressed.iterations));
		assert.deepEqual(Array.from(implicitPadded.iterations), Array.from(compressed.iterations));
		for (let q = 0; q < 3; q++) {
			closeArray(compressed.curves[q], [null, ...implicitTrimmed.curves[q], null], 0);
			closeArray(implicitPadded.curves[q], [null, null, ...compressed.curves[q], null, null], 0);
		}
	});

	it('reproduces clustered affine observations without a domain set by missing endpoints', () => {
		const data = [null, 0, 1, 2, null];
		const x = [0, 1e8, 1e8 + 1, 1e8 + 2, 2e8];
		const result = quantileGAM(data, {x, knots: 4, quantiles: [0.5]});
		checkConvergence(result);
		closeArray(result.curves[0], data, 1e-4);
		closeArray(result.curves[0], reference(data, 4, 1, 0.5, x).curve, 1e-4);
		for (const coordinates of [
			[1e8, 1e8 + 1, 1e8 + 2],
			[0, 0.25, 0.5, 8, 8.25, 16].map(v => 1e12 + v),
			[-1e12, -1e12 + 0.5, -1e12 + 64],
			[0, 1, 2, 1e8, 1e8 + 1],
			[0, 1, 2, 3, 1e8],
		]) {
			const first = coordinates[0];
			const span = coordinates[coordinates.length - 1] - first;
			const values = coordinates.map(v => 2 * (v - first) / span);
			for (const knots of [4, 8, 30]) {
				const options = {knots, x: [-Number.MAX_VALUE, ...coordinates, Number.MAX_VALUE]};
				const padded = quantileGAM([null, ...values, null], options);
				const trimmed = quantileGAM(values, {...options, x: coordinates});
				checkConvergence(padded);
				assert.deepEqual(Array.from(padded.iterations), Array.from(trimmed.iterations));
				for (let q = 0; q < 3; q++) {
					closeArray(padded.curves[q], [null, ...values, null], 1e-4);
					closeArray(padded.curves[q], [null, ...trimmed.curves[q], null], 0);
				}
			}
		}
	});

	it('is invariant to x translation and positive rescaling, including large epochs', () => {
		const x = Array.from({length: 81}, (_, i) => i * i + i);
		const data = x.map((_, i) => i % 11 === 0 || i === 80 ? null : Math.sin(i / 10) + Math.cos(i * 2) / 10);
		const options = {knots: 8, lambda: 10};
		const base = quantileGAM(data, {...options, x});
		checkConvergence(base);
		for (const [offset, scale] of [[1e15, 1], [2 ** 40, 2 ** -3], [-(2 ** 40), 8], [0, 2 ** -700], [0, 2 ** 700]]) {
			const transformed = quantileGAM(data, {...options, x: x.map(v => offset + scale * v)});
			checkConvergence(transformed);
			for (let q = 0; q < 3; q++) closeArray(transformed.curves[q], base.curves[q], 1e-10);
		}
	});

	it('normalizes finite opposite x extremes and subnormal spans without overflow or collapse', () => {
		const options = {knots: 8, lambda: 2};
		const data = [null, -3, 2, 0, 5, -1, 4, 1, null];
		const fractions = [-1, -0.875, -0.5, -0.25, 0, 0.125, 0.5, 0.875, 1];
		const base = quantileGAM(data, {...options, x: fractions});
		const extreme = quantileGAM(data, {...options, x: fractions.map(v => v * Number.MAX_VALUE)});
		checkConvergence(base);
		checkConvergence(extreme);
		for (let q = 0; q < 3; q++) closeArray(extreme.curves[q], base.curves[q], 1e-8);
		const x = [0, 1, 3, 4, 8, 13, 16];
		const values = data.slice(1, -1);
		const normal = quantileGAM(values, {...options, x});
		const tiny = quantileGAM(values, {...options, x: x.map(v => v * Number.MIN_VALUE)});
		checkConvergence(tiny);
		assert.deepEqual(plain(tiny), plain(normal));
	});

	it('recovers empirical quantiles and their ordering on a repeated response dataset', () => {
		const levels = [-4, -1, 2, 8, 20];
		const data = Array.from({length: 1001}, (_, i) => levels[Math.min(i, 1000 - i) % levels.length]);
		const quantiles = [0.1, 0.3, 0.5, 0.7, 0.9];
		const result = quantileGAM(data, {quantiles, knots: 4, lambda: 10000});
		checkConvergence(result);
		result.curves.forEach((curve, q) => {
			for (let i = 0; i < data.length; i++) {
				close(curve[i], levels[q], 0.005);
				if (q > 0) assert.ok(curve[i] >= result.curves[q - 1][i]);
			}
		});
	});

	it('reduces curvature as the second-difference penalty increases', () => {
		const data = Array.from({length: 301}, (_, i) => Math.sin(i / 15) + 0.15 * Math.cos(i * 2));
		const weak = quantileGAM(data, {quantiles: [0.5], knots: 30, lambda: 0.01});
		const strong = quantileGAM(data, {quantiles: [0.5], knots: 30, lambda: 10000});
		checkConvergence(weak);
		checkConvergence(strong);
		assert.ok(roughness(strong.curves[0]) < roughness(weak.curves[0]) / 100);
	});

	it('resists outliers compared with a least-squares affine fit and the mean', () => {
		const data = Array.from({length: 301}, (_, i) => 2 + i / 300 + 0.02 * Math.cos(i * 2));
		for (let i = 0; i < data.length; i += 17) data[i] += 15;
		const result = quantileGAM(data, {knots: 8, lambda: 10, quantiles: [0.5]});
		checkConvergence(result);
		const mean = data.reduce((a, b) => a + b, 0) / data.length;
		const meanX = (data.length - 1) / 2;
		const slope = data.reduce((sum, y, i) => sum + (i - meanX) * (y - mean), 0)
			/ data.reduce((sum, _, i) => sum + (i - meanX) ** 2, 0);
		const error = curve => curve.reduce((sum, y, i) => sum + Math.abs(y - (2 + i / 300)), 0) / data.length;
		const leastSquares = data.map((_, i) => mean + slope * (i - meanX));
		assert.ok(error(result.curves[0]) < 0.02);
		assert.ok(error(result.curves[0]) < error(leastSquares) / 20);
		assert.ok(error(result.curves[0]) < error(data.map(() => mean)) / 20);
	});

	it('fits each requested quantile independently, preserving order and duplicates', () => {
		const data = [0, 0, 1, 5, 1, 0, 0];
		const options = {knots: 8, lambda: 0.1};
		const qs = [0.9, 0.1, 0.5, 0.1];
		const together = quantileGAM(data, {...options, quantiles: qs});
		qs.forEach((q, i) => {
			const single = quantileGAM(data, {...options, quantiles: [q]});
			assert.deepEqual(Array.from(together.curves[i]), Array.from(single.curves[0]));
			assert.equal(together.iterations[i], single.iterations[0]);
			assert.equal(together.converged[i], single.converged[0]);
		});
		assert.notEqual(together.curves[1], together.curves[3]);
	});

	it('normalizes the response without losing small variations on large offsets', () => {
		const data = Array.from({length: 81}, (_, i) => Math.sin(i / 10) + Math.cos(i * 2) / 10);
		const options = {knots: 8, lambda: 10};
		const base = quantileGAM(data, options);
		checkConvergence(base);
		for (const [offset, scale] of [[0, 1e-200], [0, 1e200], [1e12, 1]]) {
			const transformed = quantileGAM(data.map(y => offset + scale * y), options);
			checkConvergence(transformed);
			for (let q = 0; q < 3; q++)
				closeArray(transformed.curves[q].map(y => (y - offset) / scale), base.curves[q], 0.001);
		}
		const reflected = quantileGAM(data.map(y => -y), options);
		for (let q = 0; q < 3; q++) closeArray(reflected.curves[q], base.curves[2 - q].map(y => -y), 0.001);
	});

	it('saturates nonconstant extreme responses at the finite output limits', () => {
		const limit = Number.MAX_VALUE;
		const options = {knots: 4, quantiles: [0.5]};
		for (const values of [
			[-1, 1, -1], [1, -1, 1], [-1, 0, 1],
			[-1, 0.5, -1], [1, -0.5, 1],
			[0.5, 1, 0.5], [-0.5, -1, -0.5],
			[null, -1, 0.5, 1, -0.25, null],
		]) {
			const unit = quantileGAM(values, options);
			const scaled = values.map(y => y === null ? null : y * limit);
			const {result: extreme, objectives} = fitWithObjectives(scaled, options);
			checkConvergence(unit);
			checkConvergence(extreme);
			// Check optimality before clipping, including non-unique median fits.
			close(objectives[0], reference(values, 4, 1, 0.5).objective, 1e-4);
			const clipped = unit.curves[0].map(y => y === null ? null : Math.max(-1, Math.min(1, y)));
			closeArray(extreme.curves[0].map(y => y === null ? null : y / limit), clipped, 1e-4);
			for (const y of extreme.curves[0]) assert.ok(y === null || Number.isFinite(y));
			assert.deepEqual(plain(quantileGAM(Float64Array.from(scaled, y => y === null ? NaN : y), options)), plain(extreme));
		}
		const regression = quantileGAM([-limit, limit, -limit], options);
		assert.equal(regression.curves[0][0], -limit);
		assert.equal(regression.curves[0][2], -limit);
		const reflected = quantileGAM([limit, -limit, limit], options);
		assert.equal(reflected.curves[0][0], limit);
		assert.equal(reflected.curves[0][2], limit);
	});

	it('preserves genuine quantile crossings instead of sorting fitted values', () => {
		const data = [0, 0, 5, 6, 9, 1, 5, 5, 6];
		const quantiles = [0.15, 0.5, 0.85];
		const result = quantileGAM(data, {knots: 8, lambda: 0.1, quantiles});
		checkConvergence(result);
		assert.ok(result.curves[1][1] > result.curves[2][1] + 0.09);
		quantiles.forEach((q, i) => closeArray(result.curves[i], reference(data, 8, 0.1, q).curve, 0.001));
	});

	it('keeps arrays, options, and typed-array backing buffers immutable', () => {
		const data = Object.freeze([4, , 1, null, NaN, 8, 2, Infinity, 5]);
		const before = data.slice();
		const quantiles = Object.freeze([0.2, 0.5, 0.8]);
		const options = Object.freeze({knots: 8, lambda: 2, quantiles});
		const first = quantileGAM(data, options);
		const second = quantileGAM(data, options);
		assert.deepEqual(data, before);
		assert.deepEqual(quantiles, [0.2, 0.5, 0.8]);
		assert.notEqual(first.curves[0], data);
		first.curves[0][0] = 999;
		assert.deepEqual(plain(second), plain(quantileGAM(data, options)));
		for (const Type of [Float64Array, Float32Array, Int32Array, Uint8Array]) {
			const buffer = new Type([99, 3, 5, 9, 2, 1, 77]);
			const snapshot = buffer.slice();
			const view = buffer.subarray(1, 6);
			assert.deepEqual(plain(quantileGAM(view, options)), plain(quantileGAM(Array.from(view), options)));
			assert.deepEqual(buffer, snapshot);
		}
		const floating = new Float64Array([1, NaN, Infinity, 4, -Infinity, 6]);
		for (const curve of quantileGAM(floating).curves) closeArray(curve, [1, null, null, 4, null, 6], 0.001);
	});

	it('keeps explicit x arrays, typed subviews, and their backing buffers immutable', () => {
		const data = Object.freeze([4, null, 1, NaN, 8, 2, 5]);
		const x = Object.freeze([1, 2, 5, 9, 13, 25, 40]);
		const options = Object.freeze({x, knots: 8, lambda: 2, quantiles: Object.freeze([0.2, 0.5, 0.8])});
		const expected = plain(quantileGAM(data, options));
		checkConvergence(expected);
		for (const Type of [Float64Array, Float32Array, Int32Array, Uint8Array]) {
			const buffer = new Type([99, ...x, 77]);
			const snapshot = buffer.slice();
			const view = buffer.subarray(1, -1);
			assert.deepEqual(plain(quantileGAM(data, {...options, x: view})), expected);
			assert.deepEqual(plain(quantileGAM(Float64Array.from(data, y => y === null ? NaN : y), {...options, x: view})), expected);
			assert.deepEqual(buffer, snapshot);
			assert.deepEqual(plain(quantileGAM([], {x: new Type(0)})).iterations, [0, 0, 0]);
		}
		assert.deepEqual(x, [1, 2, 5, 9, 13, 25, 40]);
		assert.deepEqual(plain(quantileGAM(data, options)), expected);
	});

	it('rejects invalid x even at missing responses and before analytic returns', () => {
		for (const x of [null, false, 3, '123', {}, {length: 0}, new DataView(new ArrayBuffer(0)), new BigInt64Array(0), new BigUint64Array(0), new BigInt64Array([1n])])
			assert.throws(() => quantileGAM([], {x}), {name: 'TypeError', message: /x/});
		for (const [data, x] of [[[], [0]], [[7], []], [[null, null], [0]], [[1, 2], new Float64Array(3)]])
			assert.throws(() => quantileGAM(data, {x}), {name: 'RangeError', message: /x length/});
		const noCoercion = {valueOf() { throw new Error('must not coerce x'); }};
		for (const value of [null, undefined, NaN, Infinity, -Infinity, '1', false, 1n, Symbol('x'), noCoercion]) {
			assert.throws(() => quantileGAM([7], {x: [value]}), {name: 'RangeError', message: /x.*finite/});
			assert.throws(() => quantileGAM([1, null, 2], {x: [0, value, 2]}), {name: 'RangeError', message: /x.*finite/});
		}
		for (const x of [[NaN, 0, 1, 2], [-1, 0, 1, Infinity], [0, 0, 1, 2], [-1, 0, 1, 1]])
			assert.throws(() => quantileGAM([null, 1, 2, null], {x}), {name: 'RangeError', message: /x.*finite.*increasing/});
		for (const x of [[0, 0, 1], [0, 2, 1], [2, 1, 0], [-0, 0, 1], [0, , 2], new Float64Array([0, NaN, 2]), new Float64Array([0, Infinity, 2])]) {
			for (const data of [[1, null, 2], [7, 7, 7], [null, null, null]])
				assert.throws(() => quantileGAM(data, {x}), {name: 'RangeError', message: /x.*finite.*increasing/});
		}
	});

	it('rejects invalid arguments even when data are empty or constant', () => {
		for (const data of [null, undefined, 3, '123', {}, {length: 3}, new DataView(new ArrayBuffer(8)), new BigInt64Array([1n])])
			assert.throws(() => quantileGAM(data), {name: 'TypeError', message: /data/});
		for (const data of [[], [7]]) {
			for (const quantiles of [[], Array(2), null, 0.5, '0.5', new Float64Array([0.5]), [0], [1], [-0.1], [1.1], [NaN], [Infinity], ['0.5'], [null], [false], [1n]])
				assert.throws(() => quantileGAM(data, {quantiles}), {name: 'RangeError', message: /quantiles/});
			for (const knots of [0, -1, 3, 4.5, NaN, Infinity, '8', null, false, 8n, Number.MAX_SAFE_INTEGER + 1])
				assert.throws(() => quantileGAM(data, {knots}), {name: 'RangeError', message: /knots/});
			for (const lambda of [0, -1, NaN, Infinity, -Infinity, '1', null, false, 1n])
				assert.throws(() => quantileGAM(data, {lambda}), {name: 'RangeError', message: /lambda/});
			for (const maxIterations of [0, -1, 1.5, NaN, Infinity, '1', null, false, 1n, Number.MAX_SAFE_INTEGER + 1])
				assert.throws(() => quantileGAM(data, {maxIterations}), {name: 'RangeError', message: /maxIterations/});
			assert.deepEqual(Array.from(quantileGAM(data, {maxIterations: Number.MAX_SAFE_INTEGER}).iterations), [0, 0, 0]);
		}
		assert.throws(() => quantileGAM([1], null), {name: 'TypeError'});
	});

	it('warm-starts from fixed histogram midpoints, including empty bins and endpoint ranks', () => {
		const initials = [];
		const probe = vm.createContext({initials});
		const assignment = 'for (let i = 0; i < size; i++) residual[i] = ys[i] - initial;';
		assert.equal(source.split(assignment).length, 2);
		vm.runInContext(source.replace(assignment, `initials.push(initial); ${assignment}`), probe);
		const data = Object.freeze([-1, null, 0, -0.5, 0.5, 1, NaN, 0, -1, 0.99]);
		const quantiles = Object.freeze([1 - Number.EPSILON, Number.MIN_VALUE, 0.5, 0.25, 0.75, 0.5]);
		const result = probe.quantileGAM(data, {quantiles, knots: 4, maxIterations: 1});
		closeArray(initials, [255, 0, 128, 64, 254, 128].map(bin => (bin + 0.5) / 128 - 1), 0);
		closeArray(initials, [1, -1, 0, -0.5, 0.99, 0], 1 / 256);
		for (const curve of result.curves) {
			assert.equal(curve[1], null);
			assert.equal(curve[6], null);
			assert.ok(curve.every(value => value === null || Number.isFinite(value)));
		}
	});

	it('reports iteration exhaustion, not convergence, when stopped before feasibility', () => {
		const result = quantileGAM([0, 3, -2, 1, 8, -1, 0], {knots: 4, maxIterations: 1});
		assert.deepEqual(Array.from(result.iterations), [1, 1, 1]);
		assert.deepEqual(Array.from(result.converged), [false, false, false]);
		for (const curve of result.curves) assert.ok(curve.every(Number.isFinite));
	});

	it('has linear preparation, per-iteration work, and allocation in n and k, without sorting', () => {
		const assertLinear = (small, medium, large) => {
			for (const key of ['prep', 'fit', 'allocated']) {
				assert.ok(medium[key] > small[key], `${key} must include the growing dimension`);
				assert.equal(large[key] - medium[key], 2 * (medium[key] - small[key]), `${key} must grow linearly`);
			}
		};
		for (const budget of [1, 24]) {
			const byN = [128, 256, 512].map(n => countedFit(n, 16, budget));
			const byK = [16, 32, 64].map(k => countedFit(256, k, budget));
			assertLinear(...byN);
			assertLinear(...byK);
			for (const work of [...byN, ...byK]) assert.equal(work.factors, 1);
		}
		const one = countedFit(256, 32, 1);
		const twelve = countedFit(256, 32, 12);
		const twentyFour = countedFit(256, 32, 24);
		assert.equal((twelve.fit - one.fit) / 11, (twentyFour.fit - twelve.fit) / 12);
		assert.equal(one.prep, twentyFour.prep);
		assert.equal(one.warm, twentyFour.warm);
		assert.equal(one.allocated, twentyFour.allocated);
		// Include residual balancing/refactorization, bounding its data-dependent work.
		for (const [n, k] of [[128, 16], [512, 16], [256, 64]]) {
			const q = 3;
			const budget = 100;
			const work = countedFit(n, k, budget, [0.1, 0.5, 0.9]);
			const maxFactors = 1 + q * Math.floor((budget - 1) / 25);
			assert.ok(work.factors > 1 && work.factors <= maxFactors);
			assert.ok(work.prep < 100 * (n + k));
			assert.ok(work.fit < 100 * q * budget * (n + k));
			// Fresh one-shot instances have no spare capacity yet.
			assert.ok(work.allocated <= (q + 10) * n + 19 * k + 4 * q + 256);
			assert.ok(work.largest <= 4 * Math.max(n, k));
			const single = countedFit(n, k, 1, [0.1, 0.5, 0.9]);
			assert.equal(single.factors, 1);
			assert.equal(work.allocated, single.allocated);
			assert.equal(work.allocations, single.allocations);
			assert.equal(work.objects, single.objects);
		}
	});

	it('reports a real iteration-limit case with finite last-iterate predictions', () => {
		const data = JSON.parse(readFileSync(new URL('../demos/data/taxi-trips.json', import.meta.url), 'utf8'));
		const result = quantileGAM(data, {quantiles: [0.5], knots: 8, lambda: 0.01});
		assert.deepEqual(Array.from(result.iterations), [10000]);
		assert.deepEqual(Array.from(result.converged), [false]);
		assert.ok(result.curves[0].every(Number.isFinite));
	});

	it('fits three quantiles of the 3600-point taxi dataset with recommended UI settings', () => {
		const data = JSON.parse(readFileSync(new URL('../demos/data/taxi-trips.json', import.meta.url), 'utf8'));
		assert.equal(data.length, 3600);
		const before = data.slice();
		const result = quantileGAM(data, {knots: 30, lambda: 10});
		checkConvergence(result);
		for (const curve of result.curves) {
			assert.equal(curve.length, data.length);
			assert.ok(curve.every(Number.isFinite));
		}
		assert.deepEqual(data, before);
	});
});

describeQuantile('reusable quantile GAM workspace', () => {
	it('preserves pre-workspace predictions, iteration counts, and convergence flags exactly', () => {
		const hash = createHash('sha256');
		const fit = createQuantileGAM();
		for (const length of [7, 33, 97]) {
			const data = Array.from({length}, (_, i) => i % 7 === 2 ? null : ((i * 17) % 23 - 11) / 4);
			const x = Array.from({length}, (_, i) => 1e12 + i * i + i);
			for (const knots of [4, 8, 30]) {
				for (const maxIterations of [1, 100, 10000]) {
					const options = {x, knots, lambda: 2, quantiles: [0.9, 0.1, 0.5, 0.1], maxIterations};
					const expected = quantileGAM(data, options);
					hash.update(JSON.stringify(expected));
					assert.deepEqual(plain(fit(data, options)), plain(expected));
				}
			}
		}
		// Captured from the allocating implementation before the workspace refactor.
		assert.equal(hash.digest('hex'), '85d654e2780263e3b31da0fae8b07c0653e88397bfc99d83ba8181722448ed97');
	});

	it('retains result, metadata, and curve identities across growing and shrinking shapes', () => {
		const fit = createQuantileGAM();
		const pool = [];
		let owner;
		for (const [length, knots, q, maxIterations, kind] of [
			[0, 4, 2, 1, 'empty'],
			[9, 8, 4, 100, 'missing'],
			[9, 8, 2, 10000, 'constant'],
			[1, 4, 3, 1, 'constant'],
			[41, 30, 5, 1, 'varied'],
			[11, 8, 2, 10000, 'varied'],
			[83, 60, 6, 100, 'varied'],
			[0, 4, 1, 1, 'empty'],
			[41, 4, 3, 10000, 'varied'],
			[83, 60, 6, 10000, 'varied'],
		]) {
			const data = Object.freeze(Array.from({length}, (_, i) => kind === 'missing' ? NaN : length > 1 && i % 7 === 2 ? null : kind === 'constant' ? 7 : ((i * 17) % 23 - 11) / 4));
			const x = Object.freeze(Array.from({length}, (_, i) => 1e12 + i * i + i));
			const quantiles = Object.freeze([0.9, 0.1, 0.5, 0.1, 0.75, 0.25].slice(0, q));
			const options = Object.freeze({x, knots, quantiles, maxIterations, lambda: 2});
			const expected = plain(quantileGAM(data, options));
			const result = fit(data, options);
			if (owner === undefined) owner = {result, curves: result.curves, iterations: result.iterations, converged: result.converged};
			assert.equal(result, owner.result);
			assert.equal(result.curves, owner.curves);
			assert.equal(result.iterations, owner.iterations);
			assert.equal(result.converged, owner.converged);
			assert.deepEqual(plain(result), expected);
			assert.equal(result.curves.length, q);
			assert.equal(result.iterations.length, q);
			assert.equal(result.converged.length, q);
			for (let i = 0; i < q; i++) {
				if (pool[i] === undefined) pool[i] = result.curves[i];
				assert.equal(result.curves[i], pool[i]);
				assert.equal(result.curves[i].length, length);
				assert.notEqual(result.curves[i], data);
				assert.notEqual(result.curves[i], x);
				for (let j = 0; j < i; j++) assert.notEqual(result.curves[i], result.curves[j]);
			}
		}
	});

	it('keeps one-shot results and separate fitter workspaces independent', () => {
		const data = Object.freeze([0, 3, null, -2, 1, 8, -1, 0]);
		const options = Object.freeze({knots: 8, lambda: 2, quantiles: Object.freeze([0.9, 0.1, 0.5, 0.1])});
		const first = quantileGAM(data, options);
		const second = quantileGAM(data, options);
		const fitA = createQuantileGAM();
		const fitB = createQuantileGAM();
		const a = fitA(data, options);
		const b = fitB(data, options);
		const snapshot = plain(second);
		for (const result of [first, a, b]) {
			assert.notEqual(result, second);
			assert.notEqual(result.curves, second.curves);
			assert.notEqual(result.iterations, second.iterations);
			assert.notEqual(result.converged, second.converged);
			assert.deepEqual(plain(result), snapshot);
			for (let q = 0; q < result.curves.length; q++) assert.notEqual(result.curves[q], second.curves[q]);
		}
		assert.notEqual(a.curves[0], b.curves[0]);
		first.curves[0][0] = 999;
		first.iterations[0] = -1;
		fitA([1, 2, 3], {knots: 4, quantiles: [0.5], maxIterations: 1});
		assert.deepEqual(plain(second), snapshot);
		assert.deepEqual(plain(b), snapshot);
		assert.deepEqual(plain(fitA(data, options)), snapshot);
		fitB([], {quantiles: [0.5]});
		assert.deepEqual(plain(a), snapshot);
	});

	it('rereads mutable inputs and options, clears stale missing values, and revalidates each call', () => {
		const fit = createQuantileGAM();
		const yBuffer = new Float64Array([99, 0, 3, NaN, -2, 1, 8, -1, 0, 77]);
		const xBuffer = new Float64Array([99, 0, 1, 4, 9, 13, 21, 35, 50, 77]);
		const data = yBuffer.subarray(1, -1);
		const x = xBuffer.subarray(1, -1);
		const quantiles = [0.9, 0.1, 0.5, 0.1];
		const options = {x, knots: 30, lambda: 2, quantiles};
		const result = fit(data, options);
		const curves = Array.from(result.curves);
		for (let step = 0; step < 4; step++) {
			data[step] = NaN;
			data[step + 1] = step * 2;
			x[2] = step % 2 === 0 ? 2 : 4;
			options.knots = step % 2 === 0 ? 4 : 30;
			options.lambda = step % 2 === 0 ? 0.1 : 20;
			options.maxIterations = step % 2 === 0 ? 1 : 10000;
			quantiles.reverse();
			const beforeY = yBuffer.slice();
			const beforeX = xBuffer.slice();
			assert.equal(fit(data, options), result);
			assert.deepEqual(plain(result), plain(quantileGAM(data, options)));
			assert.deepEqual(yBuffer, beforeY);
			assert.deepEqual(xBuffer, beforeX);
			for (let q = 0; q < quantiles.length; q++) {
				assert.equal(result.curves[q], curves[q]);
				assert.equal(result.curves[q][step], null);
				assert.ok(Number.isFinite(result.curves[q][step + 1]));
			}
		}
		const snapshot = plain(result);
		for (const [target, key, invalid, message] of [
			[x, 3, x[2], /x.*increasing/],
			[x, 3, Infinity, /x.*finite/],
			[options, 'x', new Float64Array(1), /x length/],
			[quantiles, 0, NaN, /quantiles/],
			[options, 'knots', 3, /knots/],
			[options, 'lambda', 0, /lambda/],
			[options, 'maxIterations', 0, /maxIterations/],
		]) {
			const previous = target[key];
			target[key] = invalid;
			assert.throws(() => fit(data, options), {name: 'RangeError', message});
			target[key] = previous;
			assert.deepEqual(plain(result), snapshot);
		}
		assert.throws(() => fit(null, options), {name: 'TypeError', message: /data/});
		assert.throws(() => fit(data, null), {name: 'TypeError'});
		assert.equal(fit(data), result);
		assert.deepEqual(plain(result), plain(quantileGAM(data)));
		assert.equal(fit(data, {}), result);
		assert.deepEqual(plain(result), plain(quantileGAM(data)));
	});

	it('allocates no helper buffers, views, result arrays, or result objects within warmed capacities', () => {
		// Geometric capacities stay below twice their high-water requirements.
		const {sandbox, work} = countedContext(8 * 384);
		const fit = sandbox.createQuantileGAM();
		const warm = irregularSeries(256);
		const options = {x: warm.x, knots: 64, lambda: 2, quantiles: [0.9, 0.1, 0.5, 0.1], maxIterations: 100};
		const result = fit(warm.data, options);
		const curves = Array.from(result.curves);
		assert.ok(work.factors > 1);
		const run = (data, expectedAllocations = 0) => {
			resetWork(work);
			assert.equal(fit(data, options), result);
			assert.equal(work.allocations, expectedAllocations);
			assert.equal(work.objects, 0);
			if (expectedAllocations === 0) assert.equal(work.allocated, 0);
			assert.deepEqual(plain(result), plain(quantileGAM(data, options)));
			for (let q = 0; q < Math.min(curves.length, options.quantiles.length); q++) assert.equal(result.curves[q], curves[q]);
		};
		for (const [length, knots, q, budget, lambda, kind] of [
			[256, 64, 4, 1, 2, 'varied'],
			[256, 64, 4, 100, 2, 'varied'],
			[97, 8, 2, 24, 0.1, 'varied'],
			[33, 4, 1, 100, 20, 'missing'],
			[64, 30, 3, 1, 1, 'constant'],
			[0, 4, 1, 1, 1, 'missing'],
			[256, 64, 4, 100, 2, 'varied'],
		]) {
			const {x, data} = irregularSeries(length);
			if (kind === 'missing') data.fill(NaN);
			else if (kind === 'constant') data.fill(7);
			else data[5] = NaN;
			Object.assign(options, {x, knots, maxIterations: budget, lambda});
			options.quantiles.length = q;
			for (let i = 0; i < q; i++) options.quantiles[i] = [0.9, 0.1, 0.5, 0.1][i];
			run(data);
		}
		assert.ok(work.factors > 1, 'adaptive refactors must reuse lower');
		resetWork(work);
		assert.equal(fit(warm.data), result);
		assert.deepEqual(plain(result), plain(quantileGAM(warm.data)));
		assert.equal(work.allocations, 0);
		assert.equal(work.allocated, 0);
		assert.equal(work.objects, 0);

		const small = irregularSeries(97);
		Object.assign(options, {x: small.x, knots: 8, quantiles: [0.2, 0.8], lambda: 2, maxIterations: 24});
		run(small.data);
		const fresh = countedFit(97, 8, 24);
		assert.equal(work.prep, fresh.prep, 'prep must use active lengths, not retained capacities');
		assert.equal(work.fit, fresh.fit, 'iterations must use active lengths, not retained capacities');

		const grown = irregularSeries(384);
		Object.assign(options, {x: grown.x, knots: 64, quantiles: [0.9, 0.1, 0.5, 0.1], maxIterations: 100});
		run(grown.data, 7); // Only the sample workspace grows: 256 -> 512.
		assert.equal(work.allocated, 10 * 512);
		assert.equal(work.largest, 4 * 512);
		run(grown.data);
		options.knots = 96;
		run(grown.data, 7); // Only the coefficient workspace grows: 64 -> 128.
		assert.equal(work.allocated, 19 * 128);
		assert.equal(work.largest, 4 * 128);
		run(grown.data);
		options.quantiles.push(0.25, 0.75);
		run(grown.data, 2); // Only two additional output curves are created.
		const pool = Array.from(result.curves);
		run(grown.data);
		Object.assign(options, {x: small.x, knots: 4, quantiles: [0.5]});
		run(small.data);
		Object.assign(options, {x: grown.x, knots: 96, quantiles: [0.9, 0.1, 0.5, 0.1, 0.25, 0.75]});
		run(grown.data);
		for (let q = 0; q < pool.length; q++) assert.equal(result.curves[q], pool[q]);
	});
});

describeQuantile('quantile GAM capacity growth and input ownership', () => {
	it('amortizes incremental sample and knot growth without changing numerical results', () => {
		const maxLength = 257;
		const maxKnots = 65;
		const {sandbox, work} = countedContext(8 * Math.max(maxLength, maxKnots));
		const fit = sandbox.createQuantileGAM();
		const data = [-11 / 4];
		const x = [1e12];
		const options = {x, knots: 4, lambda: 2, quantiles: [0.5], maxIterations: 1};
		let capacity = 0;
		let knotCapacity = 0;
		let sampleGrowths = 0;
		let knotGrowths = 0;
		let totalAllocations = 0;
		let totalAllocated = 0;
		let result;
		let curve;
		const check = () => {
			let expectedAllocations = result === undefined ? 1 : 0;
			let expectedAllocated = result === undefined ? data.length : 0;
			if (data.length > capacity) {
				capacity = Math.max(data.length, capacity * 2);
				sampleGrowths++;
				expectedAllocations += 7;
				expectedAllocated += 10 * capacity;
			}
			if (options.knots > knotCapacity) {
				knotCapacity = Math.max(options.knots, knotCapacity * 2);
				knotGrowths++;
				expectedAllocations += 7;
				expectedAllocated += 19 * knotCapacity;
			}
			resetWork(work);
			const actual = fit(data, options);
			if (result === undefined) {
				result = actual;
				curve = result.curves[0];
			}
			assert.equal(actual, result);
			assert.equal(actual.curves[0], curve);
			assert.equal(curve.length, data.length);
			assert.deepEqual(plain(actual), plain(quantileGAM(data, options)));
			assert.equal(work.allocations, expectedAllocations);
			assert.equal(work.allocated, expectedAllocated);
			assert.equal(work.objects, 0);
			assert.ok(work.largest <= 4 * Math.max(capacity, knotCapacity));
			totalAllocations += work.allocations;
			totalAllocated += work.allocated;
		};
		for (let i = 1; i < maxLength; i++) {
			data.push(((i * 17) % 23 - 11) / 4);
			x.push(1e12 + i * i + i);
			check();
		}
		for (let knots = 5; knots <= maxKnots; knots++) {
			options.knots = knots;
			check();
		}
		assert.equal(sampleGrowths, 1 + Math.ceil(Math.log2(maxLength / 2)));
		assert.equal(knotGrowths, 1 + Math.ceil(Math.log2(maxKnots / 4)));
		assert.equal(totalAllocations, 1 + 7 * (sampleGrowths + knotGrowths));
		// Geometric allocation sizes sum to less than twice the final capacities.
		assert.ok(totalAllocated < 2 + 20 * capacity + 38 * knotCapacity);
		assert.ok(capacity >= maxLength && capacity < 2 * maxLength);
		assert.ok(knotCapacity >= maxKnots && knotCapacity < 2 * maxKnots);
		const allocationsBeforeResize = totalAllocations;
		data.length = x.length = 2;
		options.knots = 4;
		check();
		for (let i = 2; i < maxLength; i++) {
			data.push(((i * 17) % 23 - 11) / 4);
			x.push(1e12 + i * i + i);
		}
		options.knots = maxKnots;
		check();
		assert.equal(totalAllocations, allocationsBeforeResize);
	});

	it('rejects its own active, pooled, and metadata arrays as inputs before any mutation', () => {
		const {sandbox, work} = countedContext(256);
		const fit = sandbox.createQuantileGAM();
		const data = Object.freeze([0.2, 0.4, 0.6]);
		const options = Object.freeze({knots: 4, quantiles: Object.freeze([0.25, 0.5, 0.75])});
		const result = fit(data, options);
		const pool = Array.from(result.curves);
		fit(data, {knots: 4, quantiles: [0.5]});
		assert.equal(result.curves.length, 1);
		const arrays = [result.curves, result.iterations, result.converged, ...pool];
		const contents = arrays.map(array => Array.from(array));
		const snapshot = plain(result);
		const error = {name: 'TypeError', message: /data, x, and quantiles must not alias.*output arrays; copy them first/};
		for (const array of arrays) {
			for (const role of ['data', 'x', 'quantiles']) {
				const args = {knots: 64, quantiles: [0.25, 0.5, 0.75]};
				if (role !== 'data') args[role] = array;
				resetWork(work);
				assert.throws(() => fit(role === 'data' ? array : data, args), error, role);
				assert.deepEqual(plain(result), snapshot);
				assert.equal(result.curves, arrays[0]);
				assert.equal(result.iterations, arrays[1]);
				assert.equal(result.converged, arrays[2]);
				arrays.forEach((value, i) => assert.deepEqual(Array.from(value), contents[i]));
				assert.equal(work.allocations, 0);
				assert.equal(work.allocated, 0);
				assert.equal(work.objects, 0);
				assert.equal(work.factors, 0);
			}
		}
		// Ownership is per fitter, not a prohibition on arrays produced elsewhere.
		const other = createQuantileGAM();
		for (const role of ['data', 'x', 'quantiles']) {
			const args = {knots: 4, quantiles: [0.5]};
			if (role !== 'data') args[role] = pool[0];
			const input = role === 'data' ? pool[0] : data;
			assert.deepEqual(plain(other(input, args)), plain(quantileGAM(input, args)));
			assert.deepEqual(plain(result), snapshot);
		}
		const copy = Array.from(pool[0]);
		const beforeCopy = copy.slice();
		assert.deepEqual(plain(fit(copy, options)), plain(quantileGAM(copy, options)));
		assert.deepEqual(copy, beforeCopy);
		pool.forEach((value, i) => assert.equal(result.curves[i], value));
		fit([], {quantiles: [0.5]});
		const empty = plain(result);
		assert.throws(() => fit(result.curves[0]), error);
		assert.throws(() => fit([], {x: result.curves[0]}), error);
		assert.deepEqual(plain(result), empty);
	});
});
