import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../demos/lib/double-mad.js', import.meta.url), 'utf8');
const context = vm.createContext({});
const {harrellDavisMedian: hd, prepareDoubleMad: prepare, doubleMad} = vm.runInContext(`${source}\n({harrellDavisMedian, prepareDoubleMad, doubleMad});`, context);
const labels = (...args) => Array.from(doubleMad(...args));
const scale = 0.6744897501960817;

function close(actual, expected, tolerance = 2e-11) {
	assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(Math.abs(expected), 1e-300), `${actual} != ${expected}`);
}

// Independent reference: gamma recurrence (integer/half-integer arguments),
// then composite Simpson integration of the beta density, not a beta CDF or CF.
function reference(sorted) {
	const n = sorted.length;
	if (!n) return null;
	if (sorted[0] === sorted[n - 1]) return sorted[0];
	function logGamma(z) {
		let sum = z % 1 === 0 ? 0 : Math.log(Math.PI) / 2;
		for (let x = z - 1; x > 0; x--) sum += Math.log(x);
		return sum;
	}
	const a = (n + 1) / 2;
	const logBeta = 2 * logGamma(a) - logGamma(2 * a);
	const density = x => x === 0 || x === 1 ? 0 : Math.exp((a - 1) * (Math.log(x) + Math.log1p(-x)) - logBeta);
	let result = 0;
	for (let i = 0; i < n; i++) {
		const steps = 1024;
		const h = 1 / (n * steps);
		let mass = density(i / n) + density((i + 1) / n);
		for (let j = 1; j < steps; j++) mass += (j % 2 ? 4 : 2) * density(i / n + j * h);
		result += sorted[i] * mass * h / 3;
	}
	return result;
}

function referenceStats(data) {
	const sorted = data.filter(Number.isFinite).sort((a, b) => a - b);
	const median = reference(sorted);
	return {
		median,
		leftMad: reference(sorted.filter(x => x <= median).map(x => median - x).reverse()),
		rightMad: reference(sorted.filter(x => x >= median).map(x => x - median)),
	};
}

// Explicit side arrays provide a reference for the optimized implicit ranges.
function explicitStats(data, median = hd) {
	const sorted = Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
	const divisor = sorted.length && !Number.isFinite(sorted[sorted.length - 1] - sorted[0]) ? 2 : 1;
	for (let i = 0; i < sorted.length; i++) sorted[i] /= divisor;
	const center = median(sorted);
	const left = sorted.filter(x => x <= center).map(x => center - x).reverse();
	const right = sorted.filter(x => x >= center).map(x => x - center);
	const leftMad = median(left);
	const rightMad = median(right);
	return {
		sorted, left, right,
		median: center === null ? null : center * divisor,
		leftMad: leftMad === null ? null : leftMad * divisor,
		rightMad: rightMad === null ? null : rightMad * divisor,
		labels(threshold) {
			return Array.from(data, value => {
				if (!Number.isFinite(value)) return null;
				const scaled = value / divisor;
				const deviation = Math.abs(scaled - center);
				const mad = scaled <= center ? leftMad : rightMad;
				const score = deviation === 0 ? 0 : mad === 0 ? Infinity : scale * deviation / mad;
				return score > threshold ? -1 : 0;
			});
		},
	};
}

function instrumented() {
	const isolated = vm.createContext({});
	vm.runInContext(`
		var calls = {arraySort: 0, typedSort: 0, abs: 0, log: 0, log1p: 0};
		for (const [prototype, key] of [[Array.prototype, 'arraySort'], [Float64Array.prototype, 'typedSort']]) {
			const original = prototype.sort;
			prototype.sort = function(...args) {
				calls[key]++;
				return original.apply(this, args);
			};
		}
		for (const key of ['abs', 'log', 'log1p']) {
			const original = Math[key];
			Math[key] = function(...args) {
				calls[key]++;
				return original(...args);
			};
		}
	`, isolated);
	const api = vm.runInContext(`${source}\n({harrellDavisMedian, prepareDoubleMad});`, isolated);
	return {
		...api,
		calls: isolated.calls,
		reset() {
			for (const key of Object.keys(isolated.calls)) isolated.calls[key] = 0;
		},
	};
}

describe('Harrell-Davis double MAD', () => {
	// Published DoubleMadHd examples and reference R implementation:
	// https://aakinshin.net/posts/harrell-davis-double-mad-outlier-detector/
	describe('Akinshin article regressions (k = 3)', () => {
		const base = [
			9, 47, 50, 71, 78, 79, 97, 98, 117, 123,
			136, 138, 143, 145, 167, 185, 202, 216, 217, 229,
			235, 242, 257, 297, 300, 315, 344, 347, 347, 360,
			362, 368, 387, 400, 428, 455, 468, 484, 493, 523,
			557, 574, 586, 605, 617, 618, 634, 641, 646, 649,
			674, 678, 689, 699, 703, 709, 714, 740, 795, 798,
			839, 880, 938, 941, 983, 1014, 1021, 1022, 1165, 1183,
			1195, 1250, 1254, 1288, 1292, 1326, 1362, 1363, 1421, 1549,
			1585, 1605, 1629, 1694, 1695, 1719, 1799, 1827, 1828, 1862,
			1991, 2140, 2186, 2255, 2266, 2295, 2321, 2419, 2919, 3612,
		];
		const bimodal = [4, 10, 15, 18, 19, 20, 501, 502, 503, 504, 3000];
		const cases = [
			{
				name: 'right-skewed sample retains 220 and 240',
				data: [100, 101, 102, 103, 110, 111, 112, 120, 121, 122, 140, 160, 180, 200, 220, 240, 2000, 2001, 2002],
				outliers: [2000, 2001, 2002],
			},
			{
				name: 'bimodal sample retains 4 and the entire 501–504 mode',
				data: bimodal,
				outliers: [3000],
			},
			{name: 'uncontaminated BaseSample retains its heavy right tail', data: base, outliers: []},
		];
		for (let count = 1; count <= 3; count++) {
			const lower = Array.from({length: count}, (_, i) => -2000 - count + 1 + i);
			const upper = Array.from({length: count}, (_, i) => 6000 + i);
			cases.push(
				{name: `Lower${count}`, data: [...lower, ...base], outliers: lower},
				{name: `Upper${count}`, data: [...base, ...upper], outliers: upper},
				{name: `Both${count}`, data: [...lower, ...base, ...upper], outliers: [...lower, ...upper]},
			);
		}

		for (const {name, data, outliers} of cases) {
			it(name, () => {
				// Reversal also checks that value sorting does not reorder result labels.
				for (const input of [data, data.slice().reverse()]) {
					Object.freeze(input);
					const expected = input.map(value => outliers.includes(value) ? -1 : 0);
					const actual = Array.from(prepare(input).detect(3));
					assert.deepEqual(actual, expected);
					assert.deepEqual(labels(input, 3), expected);
					assert.deepEqual(input.filter((_, i) => actual[i] === -1).sort((a, b) => a - b), outliers);
				}
			});
		}

		it('matches the published bimodal center, scaled MADs, and fences', () => {
			const detector = prepare(bimodal);
			// The article rounds the consistency constant to 1.4826; the detector uses
			// its more precise reciprocal for scores and exposes unscaled side MADs.
			const left = 1.4826 * detector.leftMad;
			const right = 1.4826 * detector.rightMad;
			for (const [actual, expected] of [
				[detector.median, 202.0452],
				[left, 276.4030],
				[right, 660.4467],
				[detector.median - 3 * left, -627.1638],
				[detector.median + 3 * right, 2183.3854],
			])
				assert.ok(Math.abs(actual - expected) <= 0.00005, `${actual} != ${expected} (rounded to four decimals)`);
		});
	});

	it('exposes classic-script globals and analytic small-n medians', () => {
		assert.equal(typeof context.prepareDoubleMad, 'function');
		assert.equal(hd([]), null);
		assert.equal(hd([19]), 19);
		assert.equal(hd([2, 8]), 5);
		assert.equal(hd([-Number.MAX_VALUE, Number.MAX_VALUE]), 0);
		assert.equal(hd([-8, -2]), -5);
		close(hd([0, 0, 1]), 7 / 27);
		close(hd([0, 1, 1]), 20 / 27);
		close(hd([1, 2, 10]), (7 + 26 + 70) / 27);
		// n=5: beta(3,3) CDF is 10x^3 - 15x^4 + 6x^5.
		close(hd([0, 0, 0, 0, 1]), 181 / 3125);
	});

	it('preserves exact constants and symmetric centers', () => {
		for (const n of [1, 2, 3, 20, 3600]) {
			for (const value of [-Number.MAX_VALUE, -0.1, 0, 0.1, Number.MAX_VALUE]) {
				const data = Object.freeze(Array(n).fill(value));
				const detector = prepare(data);
				assert.equal(hd(data), value);
				assert.equal(detector.median, value);
				assert.equal(detector.leftMad, 0);
				assert.equal(detector.rightMad, 0);
				assert.ok(detector.detect(0).every(x => x === 0));
			}
		}
		const detector = prepare([-10, -2, 0, 2, 10]);
		assert.equal(detector.median, 0);
		assert.equal(detector.leftMad, detector.rightMad);
		close(detector.leftMad, hd([0, 2, 10]));
	});

	it('matches independent density integration for skew, duplicates, and n=3600', () => {
		for (const n of [5, 8, 17, 40, 101, 3600]) {
			const sorted = Array.from({length: n}, (_, i) => Math.floor(i / 3) ** 2 / n - 2);
			close(hd(sorted), reference(sorted), 2e-8);
		}
		for (const data of [[-30, -5, -2, -1, 0, 0, 0, 2, 10, 90], [-9, -8, -7, -7, -6, -2, 0, 3, 50]]) {
			const actual = prepare(data);
			const expected = referenceStats(data);
			for (const key of ['median', 'leftMad', 'rightMad']) close(actual[key], expected[key], 2e-6);
			assert.notEqual(actual.leftMad, actual.rightMad);
			for (const threshold of [0, 0.5, 1, 3.5, 10]) {
				const expectedLabels = data.map(value => {
					const mad = value <= expected.median ? expected.leftMad : expected.rightMad;
					return scale * Math.abs(value - expected.median) / mad > threshold ? -1 : 0;
				});
				assert.deepEqual(Array.from(actual.detect(threshold)), expectedLabels);
			}
		}
	});

	it('retains tiny upper-tail influence instead of subtracting its CDF from one', () => {
		const sorted = Array(101).fill(0);
		sorted[100] = 1e100;
		const expected = reference(sorted);
		assert.ok(expected > 0 && expected < 1e30);
		close(hd(sorted), expected, 2e-6);
	});

	it('uses strict threshold boundaries and includes center samples on both sides', () => {
		const data = [-2, 0, 2];
		const detector = prepare(data);
		assert.equal(detector.median, 0);
		assert.equal(detector.leftMad, 1);
		assert.equal(detector.rightMad, 1);
		const boundary = scale * 2;
		assert.deepEqual(Array.from(detector.detect(boundary)), [0, 0, 0]);
		assert.deepEqual(Array.from(detector.detect(boundary - Number.EPSILON)), [-1, 0, -1]);
		assert.deepEqual(Array.from(detector.detect(0)), [-1, 0, -1]);
	});

	it('handles zero side MAD and finite opposite extremes without NaN scores', () => {
		// At this n the isolated tail's beta mass underflows to zero.
		const data = Array(3600).fill(0);
		data[0] = 1;
		const detector = prepare(data);
		assert.equal(detector.median, 0);
		assert.equal(detector.rightMad, 0);
		assert.equal(detector.detect(Number.MAX_VALUE)[0], -1);
		assert.equal(detector.detect(0)[1], 0);
		assert.deepEqual(labels([-Number.MAX_VALUE, Number.MAX_VALUE], 0.6), [-1, -1]);
		assert.deepEqual(labels([-Number.MAX_VALUE, Number.MAX_VALUE], 0.7), [0, 0]);
	});

	it('keeps missing positions, original order, and immutable input', () => {
		const data = Object.freeze([100, null, -2, undefined, 0, NaN, 2, Infinity, -Infinity, '3']);
		const detector = prepare(data);
		const result = Array.from(detector.detect(0));
		assert.deepEqual(result, [-1, null, -1, null, -1, null, -1, null, null, null]);
		assert.deepEqual(result, labels(data, 0));
		assert.deepEqual(labels(new Float64Array([-2, 0, 2]), 0), [-1, 0, -1]);
		for (const missing of [[], [null, undefined, NaN, Infinity, -Infinity], Array(3)]) {
			const empty = prepare(missing);
			assert.equal(empty.median, null);
			assert.equal(empty.leftMad, null);
			assert.equal(empty.rightMad, null);
			assert.deepEqual(Array.from(empty.detect()), Array(missing.length).fill(null));
		}
	});

	it('reuses and resets buffers without recalculating statistics or sorting', () => {
		const data = Object.freeze([-2, null, 0, 2]);
		const detector = prepare(data);
		const internal = detector.detect();
		const supplied = Array(4).fill('stale');
		// Fail if detect re-enters the public helper or sorts anything.
		vm.runInContext('var originalSort = Array.prototype.sort; harrellDavisMedian = () => { throw Error("recomputed"); }; Array.prototype.sort = () => { throw Error("sorted"); };', context);
		try {
			for (const threshold of [0, 3.5, 0, 100]) {
				const expected = threshold === 0 ? [-1, null, 0, -1] : [0, null, 0, 0];
				internal.fill('stale');
				assert.strictEqual(detector.detect(threshold), internal);
				assert.deepEqual(Array.from(internal), expected);
				supplied.fill('stale');
				assert.strictEqual(detector.detect(threshold, supplied), supplied);
				assert.deepEqual(supplied, expected);
			}
		} finally {
			vm.runInContext('Array.prototype.sort = originalSort;', context);
			vm.runInContext(source, context);
		}
	});

	describe('optimization regressions', () => {
		const ranges = [
			{name: 'even equal sides', data: [-9, -3, -1, 1, 3, 9]},
			{name: 'odd center tie', data: [-9, -3, 0, 3, 9]},
			{name: 'multiple exact center ties', data: [-9, -3, 0, 0, 0, 3, 9]},
			{name: 'even unequal sides', data: [0, 1, 2, 3, 4, 100]},
			{name: 'odd unequal sides', data: [0, 1, 2, 3, 100]},
			{name: 'constant left, nonconstant right', data: [-4, -4, -4, 1, 2, 3]},
			{name: 'nonconstant left, constant right', data: [-3, -2, -1, 4, 4, 4]},
			{name: 'opposite finite extremes', data: [-Number.MAX_VALUE, -1, 0, 1, Number.MAX_VALUE]},
			{name: 'tiny tail', data: [...Array(100).fill(0), 1e100]},
		];

		for (const {name, data} of ranges) {
			it(`matches explicit side deviations: ${name}`, () => {
				for (const input of [data, data.slice().reverse(), [null, ...data.slice().reverse(), NaN, undefined, Infinity]]) {
					const expected = explicitStats(input);
					const detector = prepare(input);
					// The implicit ranges must retain the public helper's FP operation order.
					for (const key of ['median', 'leftMad', 'rightMad'])
						assert.equal(detector[key], expected[key], key);
					for (const threshold of [0, 0.5, scale, 1, 3.5, Number.MAX_VALUE])
						assert.deepEqual(Array.from(detector.detect(threshold)), expected.labels(threshold));
				}
			});
		}

		it('skips both sort methods for ascending finite samples and sorts unsorted samples once', () => {
			const api = instrumented();
			for (const data of [[], [3], [3, 3, 3], [-3, -1, 0, 0, 9], [null, -3, NaN, -1, undefined, 0, Infinity, 9]]) {
				for (const input of [data, new Float64Array(data.map(x => Number.isFinite(x) ? x : NaN))]) {
					api.reset();
					api.prepareDoubleMad(input);
					assert.equal(api.calls.arraySort, 0, 'ascending input must not use Array.sort');
					assert.equal(api.calls.typedSort, 0, 'ascending input must not use Float64Array.sort');
				}
			}
			for (const data of [[9, 0, -1, -3], [-3, 0, -1, 9], [null, 9, NaN, -3, 0, Infinity, -1]]) {
				for (const input of [data, new Float64Array(data.map(x => Number.isFinite(x) ? x : NaN))]) {
					api.reset();
					api.prepareDoubleMad(input);
					assert.equal(api.calls.arraySort, 0, 'finite samples must use typed storage');
					assert.equal(api.calls.typedSort, 1, 'sort finite samples once, not side deviations');
				}
			}
		});

		it('detect never reads samples after preparation', () => {
			for (const data of [[-2, null, 0, 2, NaN], [-Number.MAX_VALUE, 0, Number.MAX_VALUE], [1, ...Array(3599).fill(0)]]) {
				const expected = explicitStats(data);
				let prepared = false;
				const input = new Proxy(data, {
					get(target, key, receiver) {
						if (prepared && typeof key === 'string' && /^\d+$/.test(key))
							assert.fail(`detect read sample ${key}`);
						return Reflect.get(target, key, receiver);
					},
				});
				const detector = prepare(input);
				prepared = true;
				for (const threshold of [0, 0.7, 3.5, Number.MAX_VALUE, 0]) {
					assert.deepEqual(Array.from(detector.detect(threshold)), expected.labels(threshold));
					const output = Array(data.length).fill('stale');
					assert.strictEqual(detector.detect(threshold, output), output);
					assert.deepEqual(output, expected.labels(threshold));
				}
			}
		});

		it('detect uses cached scores without absolute values, HD weights, or sorting', () => {
			const api = instrumented();
			for (const data of [[-9, null, 0, 3, 100], [-Number.MAX_VALUE, 0, Number.MAX_VALUE], [1, ...Array(3599).fill(0)]]) {
				const expected = explicitStats(data);
				const detector = api.prepareDoubleMad(data);
				api.reset();
				for (const threshold of [0, 0.7, 3.5, Number.MAX_VALUE, 0]) {
					assert.deepEqual(Array.from(detector.detect(threshold)), expected.labels(threshold));
					assert.deepEqual(Array.from(detector.detect(threshold, Array(data.length))), expected.labels(threshold));
				}
				for (const key of Object.keys(api.calls)) assert.equal(api.calls[key], 0, key);
			}
		});

		it('keeps a snapshot until re-prepared, including missing positions and original length', () => {
			for (const input of [[-2, NaN, 0, 2], new Float64Array([-2, NaN, 0, 2])]) {
				const detector = prepare(input);
				const stats = [detector.median, detector.leftMad, detector.rightMad];
				input[0] = NaN;
				input[1] = 100;
				input[2] = 100;
				input[3] = 100;
				if (Array.isArray(input)) input.push(100);
				assert.deepEqual(Array.from(detector.detect(0)), [-1, null, 0, -1]);
				assert.deepEqual([detector.median, detector.leftMad, detector.rightMad], stats);
				assert.deepEqual(Array.from(prepare(input).detect(0)), [null, ...Array(input.length - 1).fill(0)]);
			}
		});

		for (const {name, data} of ranges.slice(0, 7)) {
			it(`computes weights only as needed, without cross-call caching: ${name}`, () => {
				const api = instrumented();
				const expected = explicitStats(data);
				api.reset();
				api.harrellDavisMedian(expected.sorted);
				api.harrellDavisMedian(expected.left);
				const leftNonconstant = expected.left[0] !== expected.left[expected.left.length - 1];
				const rightNonconstant = expected.right[0] !== expected.right[expected.right.length - 1];
				if (!(leftNonconstant && rightNonconstant && expected.left.length === expected.right.length))
					api.harrellDavisMedian(expected.right);
				const logs = {log: api.calls.log, log1p: api.calls.log1p};
				assert.ok(logs.log > 0);
				for (let repeat = 0; repeat < 2; repeat++) {
					api.reset();
					const detector = api.prepareDoubleMad(data);
					for (const key of ['median', 'leftMad', 'rightMad']) assert.equal(detector[key], expected[key], name);
					assert.deepEqual({log: api.calls.log, log1p: api.calls.log1p}, logs, name);
					api.reset();
					detector.detect(0);
					detector.detect(3.5);
					assert.equal(api.calls.log + api.calls.log1p, 0, 'detect must not compute weights');
				}
			});
		}
	});

	it('rejects invalid data, thresholds, and label buffers', () => {
		for (const data of [null, undefined, 3, '123', {}, {length: 3}, new DataView(new ArrayBuffer(8))])
			assert.throws(() => prepare(data), /data/);
		const data = [1, null];
		const detector = prepare(data);
		for (const threshold of [-1, NaN, Infinity, -Infinity, '3.5', null, false]) {
			assert.throws(() => detector.detect(threshold), /threshold/);
			assert.throws(() => doubleMad([], threshold), /threshold/);
		}
		for (const output of [null, [], [0], [0, 0, 0], new Int32Array(2), {length: 2}, data])
			assert.throws(() => detector.detect(1, output), /labels/);
		assert.deepEqual(data, [1, null]);
	});
});
