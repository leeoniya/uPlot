import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../demos/lib/loess.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const {loess, createLoess} = context;
const smooth = (...args) => Array.from(loess(...args));

function close(actual, expected, tolerance = 2e-11) {
	assert.ok(Number.isFinite(actual), `nonfinite result: ${actual}`);
	assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function closeArray(actual, expected, tolerance) {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		if (expected[i] === null) assert.equal(actual[i], null, `missing position ${i}`);
		else close(actual[i], expected[i], tolerance);
	}
}

// Independent, deliberately slow anchor reference: search from the start for each x-grid point.
function referenceAnchors(x, limit) {
	const size = x.length;
	const regular = x.every((value, i) => i < 2 || value - x[i - 1] === x[1] - x[0]);
	const rankCount = limit === size || limit < 4 || regular ? limit : Math.ceil(limit / 2);
	const selected = new Set(Array.from({length: rankCount}, (_, i) => Math.round(i * (size - 1) / (rankCount - 1))));
	const gridCount = Math.floor((limit - rankCount) / 2);
	for (let g = 1; g <= gridCount; g++) {
		const fraction = g / (gridCount + 1);
		const width = x[size - 1] - x[0];
		const target = Number.isFinite(width) ? x[0] + fraction * width : (1 - fraction) * x[0] + fraction * x[size - 1];
		const right = Math.max(1, x.findIndex(value => value >= target));
		selected.add(right - 1);
		selected.add(right);
	}
	return Array.from(selected).sort((a, b) => a - b);
}

// Independent reference: sort neighbors by distance, then use two-pass covariance
// with unscaled y and target-relative x. Fits are exact unless maxFits limits them.
function reference(data, span, robustnessIters = 0, x = Array.from(data, (_, i) => i), maxFits = data.length) {
	const positions = Array.from({length: data.length}, (_, i) => i).filter(i => Number.isFinite(data[i]));
	const count = Math.min(positions.length, Math.max(4, Math.ceil(span * positions.length)));
	let fitted = Array.from(data, y => Number.isFinite(y) ? y : null);
	let robust = Array.from(data, () => 1);
	if (positions.length < 3) return fitted;
	const fitCount = count <= 16 ? positions.length : Math.min(positions.length, maxFits);
	const anchors = referenceAnchors(positions.map(i => x[i]), fitCount).map(i => positions[i]);

	for (let iteration = 0; iteration <= robustnessIters; iteration++) {
		for (const target of anchors) {
			const neighbors = positions.slice().sort((a, b) => Math.abs(x[a] - x[target]) - Math.abs(x[b] - x[target]) || a - b).slice(0, count);
			const offsets = neighbors.map(j => x[j] - x[target]);
			const radius = Math.max(...offsets.map(Math.abs));
			const weights = neighbors.map((j, k) => (1 - (Math.abs(offsets[k]) / radius) ** 3) ** 3 * robust[j]);
			const sum = weights.reduce((a, b) => a + b, 0);
			if (sum === 0) continue;
			const meanX = offsets.reduce((total, dx, k) => total + weights[k] * dx, 0) / sum;
			const meanY = neighbors.reduce((total, j, k) => total + weights[k] * data[j], 0) / sum;
			const variance = offsets.reduce((total, dx, k) => total + weights[k] * (dx - meanX) ** 2, 0);
			const covariance = neighbors.reduce((total, j, k) => total + weights[k] * (offsets[k] - meanX) * (data[j] - meanY), 0);
			fitted[target] = meanY - (variance > 0 ? covariance / variance * meanX : 0);
		}
		for (let a = 1; a < anchors.length; a++) {
			const start = anchors[a - 1];
			const end = anchors[a];
			for (let i = start + 1; i < end; i++) {
				if (fitted[i] !== null) {
					const fraction = (x[i] - x[start]) / (x[end] - x[start]);
					fitted[i] = (1 - fraction) * fitted[start] + fraction * fitted[end];
				}
			}
		}
		if (iteration === robustnessIters) break;
		const residuals = positions.map(i => Math.abs(data[i] - fitted[i])).sort((a, b) => a - b);
		const middle = Math.floor(residuals.length / 2);
		const median = residuals.length % 2 ? residuals[middle] : (residuals[middle - 1] + residuals[middle]) / 2;
		assert.ok(median > 1e-10, 'reference robust cases must have a nonzero median residual');
		robust = Array.from(data, (y, i) => Math.max(0, 1 - (Math.abs(y - fitted[i]) / (6 * median)) ** 2) ** 2);
	}
	return fitted;
}

function irregular(length) {
	let coordinate = 0;
	return Float64Array.from({length}, (_, i) => coordinate += 0.125 + (i % 19) / 16 + (i % 137 === 0 ? 8 : 0));
}

function anchorList(selectAnchors, x, limit) {
	const anchors = new Uint32Array(x.length);
	const selected = new Uint8Array(x.length);
	const count = selectAnchors(x, x.length, limit, anchors, selected);
	return Array.from(anchors.subarray(0, count));
}

// Count source-level operations without adding a public instrumentation API.
function instrument() {
	const work = {passes: 0, fits: 0, local: 0, support: 0, anchorSteps: 0, windowMoves: 0, interpolated: 0, residuals: 0, partitions: 0, fallbacks: 0, selections: 0, selectionLength: 0};
	let instrumented = source;
	function insert(needle, replacement) {
		assert.ok(instrumented.includes(needle), `missing instrumentation target: ${needle}`);
		assert.equal(instrumented.indexOf(needle), instrumented.lastIndexOf(needle), `ambiguous instrumentation target: ${needle}`);
		instrumented = instrumented.replace(needle, replacement);
	}
	insert('function selectMedian(values, length) {', 'function selectMedian(values, length) { work.selections++; work.selectionLength += length;');
	insert('for (let i = left; i <= high;) {', 'for (let i = left; i <= high;) { work.partitions++;');
	insert('sortRange(values, left, right);', 'work.fallbacks++; sortRange(values, left, right);');
	insert('\tloess = function', '\tglobalThis.selectMedian = selectMedian; globalThis.selectAnchors = selectAnchors; globalThis.sortRange = sortRange;\n\tloess = function');
	insert('for (let i = 2; i < size; i++) {', 'for (let i = 2; i < size; i++) { work.anchorSteps++;');
	insert('right++;', 'right++, work.anchorSteps++;');
	insert('if (selected[i]) anchors[fitCount++] = i;', 'work.anchorSteps++; if (selected[i]) anchors[fitCount++] = i;');
	insert('for (let iteration = 0; ; iteration++) {', 'for (let iteration = 0; ; iteration++) { work.passes++;');
	insert('const start = starts[a];', 'work.fits++; const start = starts[a];');
	insert('for (let j = start; j < end; j++) {', 'for (let j = start; j < end; j++) { work.local++;');
	insert('for (let j = 0; j < count; j++) {', 'for (let j = 0; j < count; j++) { work.support++;');
	insert('left++;', 'left++, work.windowMoves++;');
	insert('for (let i = start + 1; i < end; i++) {', 'for (let i = start + 1; i < end; i++) { work.interpolated++;');
	insert('residuals[i] = abs(ys[i] - fitted[i]);', 'work.residuals++; residuals[i] = abs(ys[i] - fitted[i]);');
	const scope = vm.createContext({work});
	vm.runInContext(instrumented, scope);
	return {work, loess: scope.loess, createLoess: scope.createLoess, selectMedian: scope.selectMedian, selectAnchors: scope.selectAnchors, sortRange: scope.sortRange};
}

// Spies stay inside this VM, so test fixtures and assertion allocations do not count.
function allocationProbe() {
	const allocations = {arrays: 0, typed: 0, buffers: 0, objects: 0, views: 0, derived: 0, sorts: 0};
	const scope = vm.createContext({allocations, fallbackCount: 0});
	vm.runInContext(`
		const typedPrototype = Object.getPrototypeOf(Float64Array.prototype);
		for (const [prototype, names, key] of [
			[typedPrototype, ['subarray'], 'views'],
			[typedPrototype, ['slice', 'map', 'filter'], 'derived'],
			[typedPrototype, ['sort'], 'sorts'],
			[Array.prototype, ['slice', 'map', 'filter', 'concat', 'flat', 'flatMap', 'splice'], 'derived'],
			[Array.prototype, ['sort'], 'sorts'],
		]) {
			for (const name of names) {
				const method = prototype[name];
				prototype[name] = function(...args) {
					allocations[key]++;
					return Reflect.apply(method, this, args);
				};
			}
		}
		for (const [name, key] of [
			['Array', 'arrays'], ['Float64Array', 'typed'], ['Uint32Array', 'typed'],
			['Uint8Array', 'typed'], ['ArrayBuffer', 'buffers'], ['Object', 'objects'],
			['Map', 'objects'], ['Set', 'objects'],
		]) {
			globalThis[name] = new Proxy(globalThis[name], {
				construct(target, args, newTarget) {
					allocations[key]++;
					return Reflect.construct(target, args, newTarget);
				},
				apply(target, receiver, args) {
					allocations[key]++;
					return Reflect.apply(target, receiver, args);
				},
			});
		}
	`, scope);
	const instrumented = source
		.replace('sortRange(values, left, right);', 'fallbackCount++; sortRange(values, left, right);')
		.replace('\tloess = function', '\tglobalThis.testSelectMedian = selectMedian;\n\tloess = function');
	vm.runInContext(instrumented, scope);
	return {scope, allocations};
}

describe('standalone LOESS smoothing', () => {
	it('exposes the classic-script globals and uses the documented defaults', () => {
		assert.deepEqual(Object.keys(context).sort(), ['createLoess', 'loess']);
		assert.equal(typeof loess, 'function');
		assert.equal(typeof createLoess, 'function');
		const data = Array.from({length: 1001}, (_, i) => Math.sin(i / 90) + 0.1 * Math.cos(i * 3));
		const expected = smooth(data, {span: 0.05, robustnessIters: 2, maxFits: 512});
		assert.deepEqual(smooth(data), expected);
		assert.deepEqual(smooth(data, {}), expected);
		assert.deepEqual(smooth(data, {span: undefined, robustnessIters: undefined, x: undefined, maxFits: undefined}), expected);
		assert.ok(Array.isArray(loess(data)));
	});

	it('handles empty, missing-only, and one-, two-, and three-sample series', () => {
		for (const data of [[], Array(4), [null, undefined, NaN, Infinity, -Infinity]])
			assert.deepEqual(smooth(data), Array(data.length).fill(null));
		for (const data of [[7], [3, -8], [2, 9, -1], [null, 2, null, null, -4, null]]) {
			for (const span of [Number.MIN_VALUE, 0.05, 1])
				closeArray(smooth(data, {span}), data);
		}
	});

	it('keeps gaps and excludes nonnumeric values without coercion', () => {
		const noCoercion = {valueOf() { throw new Error('must not coerce samples'); }};
		const data = [null, 4, undefined, NaN, Infinity, -Infinity, '9', false, 9n, Symbol('x'), noCoercion, 4, , 4];
		const expected = Array.from(data, y => Number.isFinite(y) ? 4 : null);
		assert.deepEqual(smooth(data), expected);
	});

	it('preserves exact constants, including very small and very large values', () => {
		for (const value of [0, -3.5, 1e-200, -1e200, Number.MIN_VALUE, Number.MAX_VALUE]) {
			for (const length of [1, 2, 3, 4, 31, 100]) {
				const data = Array.from({length}, (_, i) => i % 7 === 3 ? null : value);
				for (const span of [0.001, 0.3, 1])
					assert.deepEqual(smooth(data, {span}), data);
			}
		}
	});

	it('reproduces linear data at every point, including edges and uneven gaps', () => {
		for (const length of [4, 5, 17, 101]) {
			for (const gapped of [false, true]) {
				const data = Array.from({length}, (_, i) => gapped && (i % 9 < 3 || i > 40 && i < 68) ? null : 12.25 - 0.375 * i);
				for (const span of [Number.MIN_VALUE, 0.05, 0.4, 1]) {
					for (const robustnessIters of [0, 1, 2])
						closeArray(smooth(data, {span, robustnessIters}), data);
				}
			}
		}
	});

	it('uses explicit coordinates without changing output positions or implicit-index behavior', () => {
		for (const data of [[], [null, 7, null], [2, null, -3], [1, 2, 3, null, 5]]) {
			const x = Array.from(data, (_, i) => 100 + i * 3);
			closeArray(smooth(data, {x}), smooth(data));
		}
		const data = Array.from({length: 1101}, (_, i) => i % 11 === 0 ? null : Math.sin(i / 50));
		const x = Float64Array.from(data, (_, i) => i);
		assert.deepEqual(smooth(data, {x}), smooth(data));
	});

	it('reproduces lines on irregular x with gaps, timestamp offsets, and interpolation', () => {
		for (const length of [7, 101, 1801]) {
			const relative = irregular(length);
			const data = Array.from(relative, (t, i) => i % 13 < 2 || i > 600 && i < 800 ? null : 12.25 - t / 32);
			for (const offset of [0, 1.7e12]) {
				const x = relative.map(t => offset + t);
				for (const span of [0.001, 0.2, 1]) {
					for (const maxFits of [2, 23, 512, Number.MAX_SAFE_INTEGER])
						closeArray(smooth(data, {x, span, maxFits}), data);
				}
			}
		}
	});

	it('keeps sub-millisecond x differences at large timestamps and large y offsets', () => {
		const x = irregular(151).map(t => 1.7e12 + t / 256);
		const data = Array.from(x, (t, i) => i % 11 < 2 ? null : 1e12 + (t - x[0]) * 256);
		for (const maxFits of [2, 512]) {
			const actual = smooth(data, {x, span: 0.3, maxFits});
			data.forEach((y, i) => y === null ? assert.equal(actual[i], null) : assert.ok(Math.abs(actual[i] - y) <= 0.0005));
		}
	});

	it('handles coordinate differences that exceed the finite number range', () => {
		const x = Float64Array.from({length: 41}, (_, i) => (i / 20 - 1) * Number.MAX_VALUE);
		const data = Array.from(x, t => t / Number.MAX_VALUE);
		for (const maxFits of [2, 512])
			closeArray(smooth(data, {x, span: 1, maxFits}), data);
		const tiny = [0, Number.MIN_VALUE, 2 * Number.MIN_VALUE, 3 * Number.MIN_VALUE, 4 * Number.MIN_VALUE];
		closeArray(smooth([0, 1, 2, 3, 4], {x: tiny, span: 1}), [0, 1, 2, 3, 4]);
	});

	it('rescales the contributing x spread when a zero-weight neighbor is arbitrarily distant', () => {
		for (const unit of [1e-162, 1e-200, Number.MIN_VALUE]) {
			for (const far of [1, 1e150, Number.MAX_VALUE]) {
				const x = [0, unit, 2 * unit, far];
				for (const offset of [0, 1e12]) {
					const data = [0, 1, 2, 0].map(y => offset + y);
					const actual = smooth(data, {x, span: 1, robustnessIters: 0, maxFits: 4});
					closeArray(actual.map(y => y - offset), [0, 1, 2, 0]);
				}
				const reversed = [-far, -2 * unit, -unit, 0];
				closeArray(smooth([0, 0, 1, 2], {x: reversed, span: 1, robustnessIters: 0}), [0, 0, 1, 2]);
			}
		}
	});

	it('rescales x again when robust rejection leaves only a tiny contributing cluster', () => {
		const x = Array.from({length: 12}, (_, i) => i * 1e-200).concat([0.3, 0.5, 0.7, 1]);
		const line = Array.from({length: 12}, (_, i) => i / 12);
		const data = line.concat([100, -100, 100, 0]);
		const ordinary = smooth(data, {x, span: 1, robustnessIters: 0});
		assert.ok(Math.abs(ordinary[0]) > 0.1);
		for (const robustnessIters of [1, 2]) {
			const actual = smooth(data, {x, span: 1, robustnessIters});
			closeArray(actual.slice(0, line.length), line);
			assert.ok(actual.every(Number.isFinite));
		}
	});

	it('fits narrow windows at large indices without normal-equation cancellation', () => {
		const data = Array(30000).fill(null);
		for (let i = 29850; i < data.length; i++) {
			if (i % 11 > 2) data[i] = 1e12 + (i - 29850) * 0.25;
		}
		const actual = smooth(data, {span: 0.1});
		for (let i = 0; i < data.length; i++) {
			if (data[i] === null) assert.equal(actual[i], null);
			else assert.ok(Math.abs(actual[i] - data[i]) <= 0.0005, `precision lost at ${i}`);
		}
	});

	it('uses tricube weights and local linear fits rather than a moving average', () => {
		const data = [0, 0, 1, 0, 0];
		const actual = smooth(data, {span: 1, robustnessIters: 0});
		close(actual[2], 256 / 599);
		closeArray(actual, reference(data, 1));
		assert.ok(actual[0] < 0, 'edge fits may extrapolate outside the observed y range');
		assert.ok(actual[4] < 0);
		const tinySpan = smooth(data, {span: Number.MIN_VALUE, robustnessIters: 0});
		assert.ok(tinySpan[2] > 0 && tinySpan[2] < 1, 'minimum neighborhood must still smooth');
	});

	it('uses finite sample count for span, and original index distances for neighborhoods', () => {
		const data = Array(100).fill(null);
		const positions = [0, 1, 4, 31, 32, 60, 61, 62, 98, 99];
		positions.forEach((x, i) => { data[x] = i % 3 === 0 ? 12 : i * i / 3; });
		const actual = smooth(data, {span: 0.6, robustnessIters: 0});
		closeArray(actual, reference(data, 0.6));
		assert.ok(positions.some(x => Math.abs(actual[x] - reference(data, 1)[x]) > 0.1));
		const compressed = smooth(positions.map(x => data[x]), {span: 0.6, robustnessIters: 0});
		assert.ok(positions.some((x, i) => Math.abs(actual[x] - compressed[i]) > 0.1));
	});

	it('matches independent weighted least squares on deterministic irregular series', () => {
		let seed = 12345;
		const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
		for (let run = 0; run < 60; run++) {
			const data = Array.from({length: 15 + run}, (_, i) => random() < 0.3 ? null : 10 * Math.sin(i / 4) + random() * 3);
			const span = [0.01, 0.25, 0.6, 1][run % 4];
			for (const x of [undefined, irregular(data.length)])
				closeArray(smooth(data, {span, robustnessIters: 0, x}), reference(data, span, 0, x));
		}
	});

	it('matches bisquare residual reweighting for zero, one, and two robust passes', () => {
		for (const length of [40, 41]) {
			const data = Array.from({length}, (_, i) => i % 7 === 0 ? null : Math.sin(i / 8) + 0.2 * Math.cos(i * 2));
			data[13] += 4;
			for (const robustnessIters of [0, 1, 2]) {
				for (const x of [undefined, irregular(length)])
					closeArray(smooth(data, {span: 0.65, robustnessIters, x}), reference(data, 0.65, robustnessIters, x));
			}
		}
	});

	it('interpolates in actual x and reweights residuals at all finite positions on every pass', () => {
		const x = irregular(121).map(t => 1.7e12 + t);
		const data = Array.from(x, (t, i) => i % 9 < 2 ? null : Math.sin((t - x[0]) / 13) + 0.1 * Math.cos(i * 2));
		data[61] += 8;
		for (const maxFits of [2, 7, 19]) {
			for (const robustnessIters of [0, 1, 2]) {
				const actual = smooth(data, {x, span: 0.6, robustnessIters, maxFits});
				closeArray(actual, reference(data, 0.6, robustnessIters, x, maxFits));
			}
		}
		const endpoints = smooth(data, {x, span: 0.6, robustnessIters: 0, maxFits: 2});
		const exact = smooth(data, {x, span: 0.6, robustnessIters: 0});
		const start = data.findIndex(Number.isFinite);
		const end = data.findLastIndex(Number.isFinite);
		close(endpoints[start], exact[start]);
		close(endpoints[end], exact[end]);
		assert.ok(Math.abs(endpoints[61] - (endpoints[start] + (61 - start) / (end - start) * (endpoints[end] - endpoints[start]))) > 0.001);
	});

	it('automatically fits small finite series exactly, even in long sparse inputs', () => {
		const data = Array(4001).fill(null);
		for (let i = 0; i < data.length; i += 17) data[i] = Math.sin(i / 100) + 0.1 * Math.cos(i);
		const x = irregular(data.length);
		const actual = smooth(data, {x, span: 0.4});
		closeArray(actual, reference(data, 0.4, 2, x));
		assert.deepEqual(actual, smooth(data, {x, span: 0.4, maxFits: Number.MAX_SAFE_INTEGER}));
	});

	it('keeps accelerated fits close to exact fits on irregular smooth data and outliers', () => {
		const x = irregular(2401);
		for (const outliers of [false, true]) {
			const data = Array.from(x, (t, i) => i % 29 === 0 ? null : Math.sin(t / 250) + 0.2 * Math.cos(t / 80) + 0.02 * Math.cos(i * 2) + (outliers && i % 239 === 0 ? 4 : 0));
			for (const span of [0.05, 0.3, 1]) {
				for (const robustnessIters of [0, 2]) {
					const actual = smooth(data, {x, span, robustnessIters});
					const exact = smooth(data, {x, span, robustnessIters, maxFits: data.length});
					let squaredError = 0;
					let largestError = 0;
					let count = 0;
					for (let i = 0; i < data.length; i++) {
						if (data[i] === null) assert.equal(actual[i], null);
						else {
							const error = Math.abs(actual[i] - exact[i]);
							squaredError += error * error;
							largestError = Math.max(largestError, error);
							count++;
						}
					}
					const label = JSON.stringify({span, robustnessIters, outliers});
					assert.ok(Math.sqrt(squaredError / count) < 0.002, `RMS approximation error: ${label}`);
					assert.ok(largestError < 0.02, `maximum approximation error ${largestError}: ${label}`);
				}
			}
		}
	});

	it('preserves isolated timestamps and both sides of large gaps within the default budget', () => {
		const x = Array.from({length: 1025}, (_, i) => i < 512 ? i : i === 512 ? 1e6 : 2e6 + i - 513);
		const data = x.map((_, i) => i === 512 ? 1 : 0);
		const {loess, selectAnchors, work} = instrument();
		const anchors = anchorList(selectAnchors, x, 512);
		for (const index of [0, 511, 512, 513, 1024]) assert.ok(anchors.includes(index));
		const actual = Array.from(loess(data, {x}));
		close(actual[512], 1);
		closeArray(actual, smooth(data, {x, maxFits: data.length}));
		assert.ok(work.fits <= 512 * work.passes);
		assert.ok(work.local + work.support <= 2 * 512 * Math.ceil(0.05 * data.length) * work.passes);

		const multiple = Float64Array.from({length: 2049}, (_, i) => i < 800 ? i : i === 800 ? 1e6 : i < 1601 ? 2e6 + i - 801 : i === 1601 ? 3e6 : 4e6 + i - 1602);
		const samples = Array.from(multiple, (_, i) => i === 800 ? 1 : i === 1601 ? -1 : 0);
		const chosen = anchorList(selectAnchors, multiple, 512);
		for (const index of [799, 800, 801, 1600, 1601, 1602]) assert.ok(chosen.includes(index));
		closeArray(smooth(samples, {x: multiple}), smooth(samples, {x: multiple, maxFits: samples.length}));
	});

	it('keeps robust spike rejection invariant under large representable y offsets', () => {
		for (const length of [201, 2001]) {
			const data = Array(length).fill(0);
			const middle = (length - 1) / 2;
			data[middle] = 1 / 128;
			for (const x of [undefined, irregular(length)]) {
				for (const robustnessIters of [0, 1, 2]) {
					const expected = smooth(data, {x, robustnessIters});
					for (const offset of [-1e12, 1e12]) {
						const actual = smooth(data.map(y => offset + y), {x, robustnessIters});
						for (let i = 0; i < length; i++)
							assert.ok(Math.abs(actual[i] - (offset + expected[i])) <= 2 ** -13, `offset invariance at ${i}`);
						if (robustnessIters === 2) {
							close(expected[middle], 0);
							assert.equal(actual[middle] - offset, 0);
						}
					}
				}
			}
		}
	});

	it('rejects isolated spikes on exact constants and trends despite zero median residuals', () => {
		for (const slope of [0, 0.07]) {
			const baseline = Array.from({length: 201}, (_, i) => 2 + slope * i);
			for (const index of [0, 100, 200]) {
				const data = baseline.slice();
				data[index] += 100;
				const ordinary = smooth(data, {span: 0.25, robustnessIters: 0});
				const robust = smooth(data, {span: 0.25, robustnessIters: 2});
				assert.ok(Math.abs(ordinary[index] - baseline[index]) > 1);
				closeArray(robust, baseline, 1e-9);
			}
		}
	});

	it('retains zero-median spike rejection on the accelerated irregular-x path', () => {
		const x = irregular(2001);
		for (const slope of [0, 0.07]) {
			const baseline = Array.from(x, t => 2 + slope * t);
			for (const index of [0, 1000, 2000]) {
				const data = baseline.slice();
				data[index] += 100;
				const ordinary = smooth(data, {x, span: 0.25, robustnessIters: 0});
				const robust = smooth(data, {x, span: 0.25});
				assert.ok(Math.abs(ordinary[index] - baseline[index]) > 0.1);
				closeArray(robust, baseline, 1e-9);
			}
		}
	});

	it('substantially reduces outlier bias on a noisy trend', () => {
		const baseline = Array.from({length: 301}, (_, i) => 5 + i * 0.02);
		const data = baseline.map((y, i) => y + 0.08 * Math.sin(i * 1.7));
		for (const index of [0, 80, 150, 225, 300]) data[index] += index % 2 ? -30 : 30;
		const ordinary = smooth(data, {span: 0.2, robustnessIters: 0});
		const robust = smooth(data, {span: 0.2, robustnessIters: 2});
		const error = result => result.reduce((sum, y, i) => sum + Math.abs(y - baseline[i]), 0) / result.length;
		assert.ok(error(robust) < error(ordinary) * 0.1);
		assert.ok(error(robust) < 0.02);
	});

	it('keeps outputs finite for extreme values and poorly supported robust windows', () => {
		const cases = [
			[Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE, null, -Number.MAX_VALUE, 0],
			Array.from({length: 61}, (_, i) => (i % 2 ? -1 : 1) * 1e300),
			Array.from({length: 61}, (_, i) => i < 25 || i > 35 ? 0 : 10 + Math.sin(i)),
			[1e-300, null, -1e-300, 2e-300, 0, -2e-300],
			[Number.MIN_VALUE, 2 * Number.MIN_VALUE, 3 * Number.MIN_VALUE, 4 * Number.MIN_VALUE],
			[Number.MAX_VALUE, Number.MAX_VALUE / 2, Number.MAX_VALUE / 4, 0],
			[-Number.MAX_VALUE, -Number.MAX_VALUE / 2, 0, Number.MAX_VALUE],
		];
		for (const data of cases) {
			for (const span of [Number.MIN_VALUE, 0.2, 1]) {
				for (const robustnessIters of [0, 2, 5]) {
					const actual = smooth(data, {span, robustnessIters});
					data.forEach((y, i) => Number.isFinite(y) ? assert.ok(Number.isFinite(actual[i])) : assert.equal(actual[i], null));
				}
			}
		}
	});

	it('restores finite centered fits even when the scale product overflows, and clamps true overflow', () => {
		for (const data of [[0.8, 0, -1, -1, 0.5, 0.5, 0.8], [1, 1, 1, -1, -1, -1, -1]]) {
			for (const sign of [-1, 1]) {
				const small = data.map(y => sign * y);
				const expected = smooth(small, {span: 1, robustnessIters: 0});
				const actual = smooth(small.map(y => y * Number.MAX_VALUE), {span: 1, robustnessIters: 0});
				actual.forEach((y, i) => close(y / Number.MAX_VALUE, Math.max(-1, Math.min(1, expected[i]))));
			}
		}
	});

	it('does not mutate arrays, sparse arrays, options, or typed-array backing buffers', () => {
		const data = Object.freeze([4, , 1, null, NaN, 8, 2, Infinity, 5]);
		const before = data.slice();
		const options = Object.freeze({span: 0.8, robustnessIters: 2});
		const first = loess(data, options);
		assert.deepEqual(data, before);
		assert.notEqual(first, data);
		const second = loess(data, options);
		assert.notEqual(second, first);
		first[0] = 999;
		assert.deepEqual(Array.from(second), smooth(data, options));
		assert.deepEqual(options, {span: 0.8, robustnessIters: 2});

		for (const Type of [Float64Array, Float32Array, Int32Array, Uint8Array]) {
			const buffer = new Type([99, 3, 5, 9, 2, 1, 77]);
			const snapshot = buffer.slice();
			const view = buffer.subarray(1, 6);
			assert.deepEqual(smooth(view, options), smooth(Array.from(view), options));
			assert.deepEqual(buffer, snapshot);
		}
		const floating = new Float64Array([1, NaN, Infinity, 4, -Infinity, 6]);
		closeArray(smooth(floating), [1, null, null, 4, null, 6]);
	});

	it('does not mutate frozen x arrays, options, or coordinate backing buffers', () => {
		const data = Object.freeze([null, 4, 1, null, 8, 2, 5]);
		const x = Object.freeze([-2, 0, 0.25, 1, 3, 11, 50]);
		const before = x.slice();
		const options = Object.freeze({x, span: 0.8, robustnessIters: 2, maxFits: 2});
		closeArray(smooth(data, options), reference(data, 0.8, 2, x));
		assert.deepEqual(x, before);
		assert.deepEqual(options, {x, span: 0.8, robustnessIters: 2, maxFits: 2});
		for (const Type of [Float64Array, Float32Array, Int32Array, Uint8Array]) {
			const buffer = new Type([0, 1, 2, 4, 8, 16, 32, 64, 99]);
			const snapshot = buffer.slice();
			const coordinates = buffer.subarray(1, 8);
			closeArray(smooth(data, {x: coordinates, span: 0.8, robustnessIters: 0}), reference(data, 0.8, 0, coordinates));
			assert.deepEqual(buffer, snapshot);
		}
		const coordinates = irregular(1201);
		const dataWithGaps = Float64Array.from(coordinates, (t, i) => i % 19 === 0 ? NaN : Math.sin(t / 50));
		const snapshot = coordinates.slice();
		smooth(dataWithGaps, {x: coordinates});
		assert.deepEqual(coordinates, snapshot);
	});

	it('rejects invalid x at every position, including gaps and early-return inputs', () => {
		for (const x of [null, 3, '123', {}, {length: 0}, new DataView(new ArrayBuffer(8))])
			assert.throws(() => loess([], {x}), {name: 'TypeError', message: /x/});
		for (const [data, x] of [[[], [1]], [[1], []], [[null, 2], [1]], [[null], new Float64Array(2)]])
			assert.throws(() => loess(data, {x}), {name: 'RangeError', message: /same length/});
		const noCoercion = {valueOf() { throw new Error('must not coerce x'); }};
		for (const bad of [null, undefined, NaN, Infinity, -Infinity, '2', false, 2n, Symbol('x'), noCoercion]) {
			for (const data of [[null], [0], [5]])
				assert.throws(() => loess(data, {x: [bad]}), {name: 'RangeError', message: /x/});
			assert.throws(() => loess([1, null, 3], {x: [0, bad, 4]}), {name: 'RangeError', message: /x/});
		}
		for (const x of [[0, 0, 1], [2, 1, 3], [1, 3, 2], [0, , 2], [-0, 0, 1], new BigInt64Array([1n, 2n, 3n])]) {
			for (const data of [[null, null, null], [0, 0, 0], [1, null, 3]])
				assert.throws(() => loess(data, {x}), {name: 'RangeError', message: /x/});
		}
	});

	it('rejects invalid data, spans, iteration counts, and fit budgets, even with empty input', () => {
		for (const data of [null, undefined, 3, '123', {}, {length: 3}, new DataView(new ArrayBuffer(8))])
			assert.throws(() => loess(data), {name: 'TypeError', message: /data/});
		for (const span of [0, -0.1, 1.01, NaN, Infinity, -Infinity, '0.5', null, false, 1n]) {
			for (const data of [[], [1, 2, 3]])
				assert.throws(() => loess(data, {span}), {name: 'RangeError', message: /span/});
		}
		for (const robustnessIters of [-1, 0.5, NaN, Infinity, -Infinity, '2', null, false, 2n, Number.MAX_SAFE_INTEGER + 1]) {
			for (const data of [[], [1, 2, 3]])
				assert.throws(() => loess(data, {robustnessIters}), {name: 'RangeError', message: /robustnessIters/});
		}
		for (const maxFits of [-1, 0, 1, 2.5, NaN, Infinity, -Infinity, '512', null, false, 512n, Number.MAX_SAFE_INTEGER + 1]) {
			for (const data of [[], [1, 2, 3]])
				assert.throws(() => loess(data, {maxFits}), {name: 'RangeError', message: /maxFits/});
		}
		for (const maxFits of [2, Number.MAX_SAFE_INTEGER])
			assert.deepEqual(smooth([], {x: [], maxFits}), []);
		assert.throws(() => loess([1], null), {name: 'TypeError'});
	});

	it('selects exact odd and even medians with bounded partition work and a sort fallback', () => {
		const {selectMedian, work} = instrument();
		for (const length of [...Array.from({length: 65}, (_, i) => i + 1), 256, 257, 4096, 4097]) {
			const patterns = [
				i => i,
				i => length - i,
				() => 3,
				i => i % 2,
				i => Math.min(i, length - i - 1),
				i => (i + Math.floor(length / 3)) % length,
				i => Math.sin(i * 31) ** 2,
			];
			for (const pattern of patterns) {
				const values = Float64Array.from({length: length + 2}, (_, i) => i < length ? pattern(i) : -100);
				const sorted = Array.from(values.subarray(0, length)).sort((a, b) => a - b);
				const expected = (sorted[Math.floor((length - 1) / 2)] + sorted[Math.floor(length / 2)]) / 2;
				const before = work.partitions;
				assert.equal(selectMedian(values, length), expected);
				assert.ok(work.partitions - before <= 2 * length, `partition budget exceeded for length ${length}`);
				assert.equal(values[length], -100);
				assert.equal(values[length + 1], -100);
			}
		}
		assert.ok(work.fallbacks > 0, 'adversarial patterns must exercise the fallback sort');
		assert.ok(work.partitions <= 2 * work.selectionLength);
	});

	it('heapsorts only the requested range without touching its prefix or suffix', () => {
		const {sortRange} = instrument();
		for (const [left, right] of [[0, 0], [5, 4], [3, 59], [4, 9], [2, 62]]) {
			const values = Float64Array.from({length: 64}, (_, i) => i % 9 === 0 ? Infinity : Math.sin(i) * 100);
			const expected = Array.from(values);
			const sorted = expected.slice(left, right + 1).sort((a, b) => a - b);
			expected.splice(left, sorted.length, ...sorted);
			sortRange(values, left, right);
			assert.deepEqual(Array.from(values), expected);
		}
	});

	it('fills caller anchor buffers using active sizes and skips markers for uniform x', () => {
		const {selectAnchors} = instrument();
		const x = new Float64Array(128).fill(NaN);
		const anchors = new Uint32Array(128);
		const selected = new Uint8Array(128);
		for (const size of [93, 21, 61]) {
			for (const regular of [false, true]) {
				for (let i = 0; i < size; i++) x[i] = regular ? i : i * i + i;
				anchors.fill(999);
				selected.fill(7);
				const count = selectAnchors(x, size, 17, anchors, selected);
				assert.deepEqual(Array.from(anchors.subarray(0, count)), referenceAnchors(Array.from(x.subarray(0, size)), 17));
				assert.ok(anchors.subarray(count).every(value => value === 999));
				assert.ok(selected.subarray(size).every(value => value === 7));
				if (regular) assert.ok(selected.every(value => value === 7));
			}
		}
	});

	it('merges bounded index and x grids deterministically without sorting samples', () => {
		const length = 4097;
		const regular = Array.from({length}, (_, i) => 1e12 + i / 4);
		const extreme = Array.from({length}, (_, i) => (i / (length - 1)) ** 2 * Number.MAX_VALUE - Number.MAX_VALUE / 2);
		extreme[length - 1] = Number.MAX_VALUE;
		for (const x of [regular, irregular(length), Array.from({length}, (_, i) => i + Math.floor(i / 3) * 1e6), extreme]) {
			for (const limit of [2, 3, 4, 7, 16, 31, 512, length]) {
				const {selectAnchors, work} = instrument();
				const actual = anchorList(selectAnchors, x, limit);
				assert.ok(actual.length >= 2 && actual.length <= limit);
				assert.equal(actual[0], 0);
				assert.equal(actual.at(-1), length - 1);
				assert.ok(actual.every((index, i) => i === 0 || index > actual[i - 1]));
				assert.deepEqual(actual, referenceAnchors(x, limit));
				assert.ok(work.anchorSteps <= 3 * length);
				assert.deepEqual(actual, anchorList(selectAnchors, x, limit));
				if (x === regular || limit === length) assert.equal(actual.length, limit);
			}
		}
	});

	it('does not turn thousands of gaps into unbounded exact fitting', () => {
		const x = Float64Array.from({length: 8193}, (_, i) => i + Math.floor(i / 3) * 1e6);
		const data = Array.from(x, (_, i) => Math.sin(i / 100));
		const {loess, work} = instrument();
		loess(data, {x, span: 1, maxFits: 16, robustnessIters: 0});
		assert.ok(work.fits <= 16);
		assert.equal(work.local, work.fits * data.length);
		assert.equal(work.support, work.local);
		assert.ok(work.anchorSteps <= 3 * data.length);
	});

	it('fits every sample for k <= 16, regardless of the anchor budget', () => {
		const x = irregular(1024);
		const data = Array.from(x, (t, i) => Math.sin(t) + Math.cos(i * 2));
		for (const count of [4, 16, 17]) {
			const {loess, work} = instrument();
			const span = count / data.length;
			const actual = Array.from(loess(data, {x, span, maxFits: 2, robustnessIters: 0}));
			const fits = count <= 16 ? data.length : 2;
			assert.equal(work.fits, fits);
			assert.equal(work.local, fits * count);
			assert.equal(work.support, fits * count);
			assert.equal(work.interpolated, data.length - fits);
			if (count <= 16)
				assert.deepEqual(actual, smooth(data, {x, span, maxFits: data.length, robustnessIters: 0}));
		}
	});

	it('bounds default local-fit work linearly when n doubles, including span = 1', () => {
		for (const span of [0.05, 1]) {
			for (const robustnessIters of [0, 2]) {
				let previous = 0;
				for (const length of [2048, 4096]) {
					const x = irregular(length);
					const data = Array.from(x, (t, i) => Math.sin(t / 100) + 0.1 * Math.cos(i * 2));
					const {loess, work} = instrument();
					loess(data, {x, span, robustnessIters});
					const count = Math.ceil(span * length);
					assert.equal(work.passes, robustnessIters + 1);
					assert.ok(work.fits <= 512 * work.passes);
					assert.equal(work.local, work.fits * count);
					assert.equal(work.support, work.fits * count);
					assert.equal(work.interpolated, length * work.passes - work.fits);
					assert.equal(work.residuals, length * robustnessIters);
					assert.ok(work.windowMoves <= length - count);
					assert.ok(work.partitions <= 2 * work.selectionLength);
					assert.ok(work.anchorSteps <= 3 * length);
					const bound = 2 * 512 * count * work.passes;
					assert.ok(work.local + work.support <= bound);
					if (previous > 0) assert.ok(bound <= previous * 2);
					previous = bound;
				}
			}
		}
	});

	it('uses finite-sample budgets and exposes the quadratic cost of requested exact fits', () => {
		const data = Array.from({length: 1201}, (_, i) => i % 5 === 0 ? null : Math.sin(i / 90));
		const finiteCount = data.filter(Number.isFinite).length;
		for (const maxFits of [2, 31, 512, finiteCount, Number.MAX_SAFE_INTEGER]) {
			const {loess, work} = instrument();
			loess(data, {span: 1, maxFits, robustnessIters: 0});
			assert.ok(work.fits <= Math.min(finiteCount, maxFits));
			if (maxFits >= finiteCount) assert.equal(work.fits, finiteCount);
			assert.equal(work.local, work.fits * finiteCount);
			assert.equal(work.support, work.local);
			assert.equal(work.interpolated, finiteCount - work.fits);
		}
		let previous = 0;
		for (const length of [512, 1024]) {
			const {loess, work} = instrument();
			loess(Array.from({length}, (_, i) => Math.sin(i)), {span: 1, maxFits: length, robustnessIters: 0});
			assert.equal(work.local, length * length);
			assert.equal(work.support, work.local);
			if (previous > 0) assert.equal(work.local, previous * 4);
			previous = work.local;
		}
	});

	it('bounds large-span local-fit work by 512 neighborhoods, not n neighborhoods', () => {
		const length = 16384;
		const {loess, work} = instrument();
		loess(Array.from({length}, (_, i) => Math.sin(i / 1000)), {span: 1, robustnessIters: 0});
		assert.equal(work.fits, 512);
		assert.equal(work.local, 512 * length);
		assert.equal(work.support, work.local);
		assert.equal(work.windowMoves, 0);
	});

	it('smooths 10k samples with gaps and outliers using the default settings', () => {
		const data = Float64Array.from({length: 10000}, (_, i) => i % 97 === 0 ? NaN : Math.sin(i / 500) + 0.05 * Math.cos(i * 2) + (i % 701 === 0 ? 5 : 0));
		const before = data.slice();
		const actual = loess(data);
		assert.ok(Array.isArray(actual));
		assert.equal(actual.length, data.length);
		let error = 0;
		let count = 0;
		for (let i = 0; i < data.length; i++) {
			if (!Number.isFinite(data[i])) assert.equal(actual[i], null);
			else {
				assert.ok(Number.isFinite(actual[i]));
				error += Math.abs(actual[i] - Math.sin(i / 500));
				count++;
			}
		}
		assert.ok(error / count < 0.03);
		assert.deepEqual(data, before);
	});

	it('smooths 160k irregular samples with gaps and outliers using the default budget', () => {
		const x = irregular(160000).map(t => 1.7e12 + t);
		const baseline = t => Math.sin((t - x[0]) / 10000);
		const data = Float64Array.from(x, (t, i) => i % 97 === 0 ? NaN : baseline(t) + 0.05 * Math.cos(i * 2) + (i % 701 === 0 ? 5 : 0));
		const beforeX = x.slice();
		const beforeY = data.slice();
		const actual = loess(data, {x});
		assert.equal(actual.length, data.length);
		let error = 0;
		let count = 0;
		for (let i = 0; i < data.length; i++) {
			if (!Number.isFinite(data[i])) assert.equal(actual[i], null);
			else {
				assert.ok(Number.isFinite(actual[i]));
				error += Math.abs(actual[i] - baseline(x[i]));
				count++;
			}
		}
		assert.ok(error / count < 0.03);
		assert.deepEqual(x, beforeX);
		assert.deepEqual(data, beforeY);
	});
});

describe('reusable LOESS fitter', () => {
	it('uses the same defaults and keeps one-shot outputs independent', () => {
		const fit = createLoess();
		assert.equal(typeof fit, 'function');
		const data = Array.from({length: 701}, (_, i) => Math.sin(i / 40) + 0.1 * Math.cos(i));
		const expected = smooth(data);
		const output = fit(data);
		assert.ok(Array.isArray(output));
		assert.deepEqual(Array.from(output), expected);
		for (const options of [undefined, {}, {span: undefined, robustnessIters: undefined, maxFits: undefined, x: undefined}]) {
			assert.equal(fit(data, options), output);
			assert.deepEqual(Array.from(output), expected);
		}
		const first = loess(data);
		const second = loess(data);
		assert.notEqual(first, second);
		assert.notEqual(first, output);
		first.fill(123);
		output.fill(456);
		assert.deepEqual(Array.from(second), expected);
		assert.equal(fit(data), output);
		assert.deepEqual(Array.from(output), expected);
	});

	it('resets active scratch and output across shrinking, growing, empty, and constant inputs', () => {
		const fit = createLoess();
		const output = fit([]);
		for (const length of [1, 2, 3, 17, 700, 12, 0, 513, 1401, 4, 0, 1401]) {
			const x = irregular(length);
			for (const kind of ['constant', 'missing', 'curve']) {
				const data = Float64Array.from(x, (t, i) => kind === 'constant' ? 7 : kind === 'missing' || i % 13 < 2 ? NaN : Math.sin(t / 25) + (i % 97 === 0 ? 5 : 0));
				const options = {x, span: length % 2 ? 0.4 : 0.01, robustnessIters: 2, maxFits: length % 3 ? 17 : 512};
				const before = data.slice();
				const expected = smooth(data, options);
				output.length = length + 5;
				output.fill(Infinity);
				delete output[0];
				assert.equal(fit(data, options), output);
				assert.equal(output.length, length);
				assert.deepEqual(Array.from(output), expected);
				assert.deepEqual(data, before);
			}
		}
	});

	it('rereads mutated data, x, and the same options object on every fit', () => {
		const fit = createLoess();
		const x = irregular(701);
		const data = Float64Array.from(x, (t, i) => Math.sin(t / 30) + 0.1 * Math.cos(i));
		const options = {x, span: 0.05, robustnessIters: 2, maxFits: 512};
		const output = fit(data, options);
		for (let iteration = 0; iteration < 8; iteration++) {
			data[300] += 2;
			data[5] = iteration % 2 ? NaN : -3;
			for (let i = 0; i < x.length; i++) x[i] = iteration % 2 ? i : i + i * i / 500;
			options.x = iteration % 3 ? x : undefined;
			options.span = [0.001, 0.05, 0.3, 1][iteration % 4];
			options.robustnessIters = iteration % 3;
			options.maxFits = [2, 31, 512, data.length][iteration % 4];
			const beforeX = x.slice();
			const beforeY = data.slice();
			const expected = smooth(data, options);
			assert.equal(fit(data, options), output);
			assert.deepEqual(Array.from(output), expected);
			assert.deepEqual(x, beforeX);
			assert.deepEqual(data, beforeY);
		}
	});

	it('revalidates mutable inputs and options, and recovers after invalid calls', () => {
		const fit = createLoess();
		const data = [1, null, 3, 2, 5];
		const x = [0, 1, 2, 3, 4];
		const options = {x, span: 0.5, robustnessIters: 2, maxFits: 512};
		const output = fit(data, options);
		const expected = Array.from(output);
		x[1] = 0;
		assert.throws(() => fit(data, options), {name: 'RangeError', message: /x/});
		x[1] = 1;
		for (const [key, value] of [['span', 0], ['robustnessIters', -1], ['maxFits', 1], ['x', [0]]]) {
			const previous = options[key];
			options[key] = value;
			assert.throws(() => fit(data, options), {name: 'RangeError'});
			options[key] = previous;
		}
		assert.throws(() => fit(null, options), {name: 'TypeError'});
		assert.throws(() => fit(data, null), {name: 'TypeError'});
		assert.throws(() => fit([], {x: [0]}), {name: 'RangeError'});
		assert.deepEqual(Array.from(output), expected);
		assert.equal(fit(data, options), output);
		assert.deepEqual(Array.from(output), expected);
	});

	it('keeps fitter instances and one-shot calls independent', () => {
		const first = createLoess();
		const second = createLoess();
		const a = Array.from({length: 701}, (_, i) => Math.sin(i / 100));
		const b = Array.from({length: 103}, (_, i) => i % 7 ? Math.cos(i) : null);
		const outputA = first(a);
		const snapshotA = Array.from(outputA);
		const outputB = second(b, {span: 1});
		const snapshotB = Array.from(outputB);
		const oneShot = loess(a);
		assert.notEqual(outputA, outputB);
		assert.notEqual(outputA, oneShot);
		assert.deepEqual(Array.from(outputA), snapshotA);
		assert.equal(first([]), outputA);
		assert.deepEqual(Array.from(outputB), snapshotB);
		assert.deepEqual(Array.from(oneShot), snapshotA);
		outputB[0] = 99;
		assert.equal(second(b, {span: 1}), outputB);
		assert.deepEqual(Array.from(outputB), snapshotB);
		assert.deepEqual(Array.from(outputA), []);
	});

	it('reads the previous output before resetting it when it aliases data or x', () => {
		const fit = createLoess();
		const output = fit(Array.from({length: 41}, (_, i) => i));
		const data = Array.from(output, (_, i) => Math.sin(i / 4));
		const expectedX = smooth(data, {x: Array.from(output), span: 0.6});
		assert.equal(fit(data, {x: output, span: 0.6}), output);
		assert.deepEqual(Array.from(output), expectedX);
		const expectedY = smooth(Array.from(output), {span: 0.8});
		assert.equal(fit(output, {span: 0.8}), output);
		assert.deepEqual(Array.from(output), expectedY);
	});

	it('allocates no arrays, numeric buffers, views, or result objects on warmed refits', () => {
		const {scope, allocations} = allocationProbe();
		const fit = scope.createLoess();
		const x = irregular(4097);
		const data = Float64Array.from(x, (t, i) => Math.sin(t / 50) + (i % 53 === 0 ? 5 : 0));
		const options = {x, span: 0.05, robustnessIters: 2, maxFits: 512};
		const output = fit(data, options);
		const selection = vm.runInContext('new Float64Array(4097)', scope);
		const before = {...allocations};
		for (let iteration = 0; iteration < 12; iteration++) {
			const length = [4097, 0, 31, 1025][iteration % 4];
			const coordinates = Float64Array.from({length}, (_, i) => iteration % 2 ? i : i * i + i);
			const values = Float64Array.from(coordinates, (t, i) => iteration % 3 === 0 ? 4 : i % 7 === 0 ? NaN : Math.sin(t / 100));
			options.x = coordinates;
			options.span = [1, 0.001, 0.05][iteration % 3];
			options.robustnessIters = iteration % 3;
			options.maxFits = [2, 512, Number.MAX_SAFE_INTEGER][iteration % 3];
			const expected = smooth(values, options);
			assert.equal(fit(values, options), output);
			assert.deepEqual(Array.from(output), expected);
		}
		assert.equal(fit(data), output);
		assert.deepEqual(Array.from(output), smooth(data));
		for (let i = 0; i < selection.length; i++) selection[i] = Math.min(i, selection.length - i - 1);
		const fallbacks = scope.fallbackCount;
		assert.equal(scope.testSelectMedian(selection, selection.length), 1024);
		assert.ok(scope.fallbackCount > fallbacks, 'allocation check must exercise the heapsort fallback');
		assert.deepEqual(allocations, before);

		// Constructor spies cannot see literals. Guard the fitting body and allocating methods as well.
		const fittingCode = source.slice(source.indexOf('\tfunction fit('), source.indexOf('\tcreateLoess = function'));
		assert.doesNotMatch(fittingCode, /\bnew\s+(?:Array|\w*Array|Object)\b|(?:=|return)\s*(?:\[|\{)/);
		assert.doesNotMatch(source, /\.(?:subarray|slice|sort|push|map|filter)\s*\(/);
	});

	it('grows scratch only beyond capacity and retains it through smaller refits', () => {
		const {scope, allocations} = allocationProbe();
		const fit = scope.createLoess();
		const output = fit(Array(64).fill(3));
		let typed = allocations.typed;
		const arrays = allocations.arrays;
		assert.ok(typed > 0);
		for (const [length, grows] of [[32, false], [64, false], [65, true], [128, false], [0, false], [129, true], [7, false], [256, false]]) {
			const x = irregular(length);
			const data = Array.from(x, (t, i) => i % 5 ? Math.sin(t) : null);
			const options = {x, span: 1, maxFits: Number.MAX_SAFE_INTEGER};
			assert.equal(fit(data, options), output);
			assert.deepEqual(Array.from(output), smooth(data, options));
			if (grows) assert.ok(allocations.typed > typed);
			else assert.equal(allocations.typed, typed);
			assert.equal(allocations.arrays, arrays);
			typed = allocations.typed;
		}
	});
});
