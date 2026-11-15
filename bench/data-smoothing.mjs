// Usage: node bench/data-smoothing.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';

const loessSource = readFileSync(new URL('../demos/lib/loess.js', import.meta.url), 'utf8');
const meanSource = readFileSync(new URL('../demos/lib/mean-gam.js', import.meta.url), 'utf8');
const gamSource = readFileSync(new URL('../demos/lib/quantile-gam.js', import.meta.url), 'utf8');
const {meanGAM, createMeanGAM} = Function(meanSource + '\nreturn {meanGAM, createMeanGAM};')();
const {loess, createLoess} = Function(loessSource + '\nreturn {loess, createLoess};')();
const {quantileGAM, createQuantileGAM} = Function(gamSource + '\nreturn {quantileGAM, createQuantileGAM};')();
const taxi = JSON.parse(readFileSync(new URL('../demos/data/taxi-trips.json', import.meta.url), 'utf8'));

function measure(run) {
	for (let warmup = 0; warmup < 3; warmup++) run();
	const times = [];
	let result;
	for (let repeat = 0; repeat < 3; repeat++) {
		const start = performance.now();
		result = run();
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return {result, ms: times[1]};
}

function irregular(n) {
	const x = new Float64Array(n);
	const y = new Float64Array(n);
	let time = 1.7e12;
	for (let i = 0; i < n; i++) {
		time += i % 997 === 0 ? 100 : 1 + i % 17 / 4;
		x[i] = time;
	}
	const width = x[n - 1] - x[0];
	for (let i = 0; i < n; i++)
		y[i] = Math.sin(12 * (x[i] - x[0]) / width) + 0.05 * Math.cos(i * 2) + (i % 701 === 0 ? 3 : 0);
	return {x, y};
}

console.log(`Node ${process.version}; ${process.platform} ${process.arch}; ${cpus()[0]?.model ?? 'unknown CPU'}`);
console.log('Three warmups and three measured calls per case; median milliseconds, including preparation and allocation.');

const bounded = measure(() => loess(taxi));
const exactOptions = {maxFits: taxi.length};
const exact = measure(() => loess(taxi, exactOptions));
let squaredError = 0;
let largestError = 0;
for (let i = 0; i < taxi.length; i++) {
	const error = Math.abs(bounded.result[i] - exact.result[i]);
	squaredError += error * error;
	largestError = Math.max(largestError, error);
}
console.table([
	{method: 'LOESS taxi, 512-fit budget', n: taxi.length, ms: bounded.ms.toFixed(2)},
	{method: 'LOESS taxi, exact', n: taxi.length, ms: exact.ms.toFixed(2)},
]);
console.log(`LOESS taxi approximation: RMS ${Math.sqrt(squaredError / taxi.length).toFixed(3)} trips; max ${largestError.toFixed(3)} trips.`);

const loessRows = [];
const loessFitter = createLoess();
for (const n of [10000, 40000, 160000]) {
	const {x, y} = irregular(n);
	const options = {x};
	const {result, ms} = measure(() => loess(y, options));
	const reused = measure(() => loessFitter(y, options));
	assert.equal(result.length, n);
	assert.ok(result.every(Number.isFinite));
	assert.deepEqual(reused.result, result);
	loessRows.push({n, maxFits: 512, span: 0.05, robustnessIters: 2,
		'one-shot ms': ms.toFixed(2), 'reused ms': reused.ms.toFixed(2)});
}
console.log('\nLOESS, irregular x, fixed fit budget:');
console.table(loessRows);

const gamOptions = {knots: 30, lambda: 10};
const meanFitter = createMeanGAM();
const taxiMean = measure(() => meanGAM(taxi, gamOptions));
const reusedTaxiMean = measure(() => meanFitter(taxi, gamOptions));
assert.ok(taxiMean.result.every(Number.isFinite));
assert.deepEqual(reusedTaxiMean.result, taxiMean.result);
console.log(`Mean GAM taxi, one banded solve: one-shot ${taxiMean.ms.toFixed(2)} ms, reused ${reusedTaxiMean.ms.toFixed(2)} ms.`);

const meanRows = [];
for (const n of [10000, 40000, 160000]) {
	const {x, y} = irregular(n);
	const options = {x, knots: 30, lambda: 10};
	const {result, ms} = measure(() => meanGAM(y, options));
	const reused = measure(() => meanFitter(y, options));
	assert.equal(result.length, n);
	assert.ok(result.every(Number.isFinite));
	assert.deepEqual(reused.result, result);
	meanRows.push({n, knots: 30, lambda: 10,
		'one-shot ms': ms.toFixed(2), 'reused ms': reused.ms.toFixed(2)});
}
console.log('\nMean GAM, irregular x, one banded solve:');
console.table(meanRows);
console.log('Both GAMs use the same spline basis; equal lambda does not imply equal smoothing across losses.');

const gamFitter = createQuantileGAM();
const taxiGam = measure(() => quantileGAM(taxi, gamOptions));
const reusedTaxiGam = measure(() => gamFitter(taxi, gamOptions));
assert.ok(taxiGam.result.converged.every(Boolean), 'taxi defaults must converge');
assert.deepEqual(reusedTaxiGam.result, taxiGam.result);
console.log(`Quantile GAM taxi, time to convergence: one-shot ${taxiGam.ms.toFixed(2)} ms, reused ${reusedTaxiGam.ms.toFixed(2)} ms; iterations [${taxiGam.result.iterations}].`);

const gamRows = [];
for (const n of [1800, 3600, 7200, 14400]) {
	const {x, y} = irregular(n);
	const options = {x, knots: 30, lambda: 10, maxIterations: 100};
	const {result, ms} = measure(() => quantileGAM(y, options));
	const reused = measure(() => gamFitter(y, options));
	for (const curve of result.curves) assert.ok(curve.every(Number.isFinite));
	assert.deepEqual(reused.result, result);
	gamRows.push({n, knots: 30, maxIterations: 100, iterations: result.iterations.join('/'),
		converged: result.converged.join('/'), 'one-shot ms': ms.toFixed(2), 'reused ms': reused.ms.toFixed(2)});
}
console.log('\nQuantile GAM, irregular x, three quantiles, fixed iteration budget (not time to convergence):');
console.table(gamRows);

// Count only helper-owned typed buffers, outside timed runs. Tests also track output arrays/objects and views.
const allocationRows = [];
for (const [name, source, createName, options] of [
	['loess', loessSource, 'createLoess', {}],
	['meanGAM', meanSource, 'createMeanGAM', gamOptions],
	['quantileGAM', gamSource, 'createQuantileGAM', gamOptions],
]) {
	let buffers = 0;
	let bytes = 0;
	const tracked = Type => new Proxy(Type, {
		construct(Type, args) {
			const array = new Type(...args);
			buffers++;
			bytes += array.byteLength;
			return array;
		},
	});
	const [oneShot, create] = Function('Float64Array', 'Uint32Array', 'Uint8Array',
		source + `\nreturn [${name}, ${createName}];`)(tracked(Float64Array), tracked(Uint32Array), tracked(Uint8Array));
	const expected = oneShot(taxi, options);
	allocationRows.push({method: name, mode: 'one-shot', calls: 1, buffers, bytes});
	const fitter = create();
	fitter(taxi, options);
	buffers = bytes = 0;
	for (let repeat = 0; repeat < 5; repeat++) assert.deepEqual(fitter(taxi, options), expected);
	assert.equal(buffers, 0, `${name}: warmed refits must reuse numeric buffers`);
	allocationRows.push({method: name, mode: 'reused, warmed', calls: 5, buffers, bytes});
}
console.log('\nTyped-buffer allocations on taxi data (excludes JavaScript-engine internals):');
console.table(allocationRows);
