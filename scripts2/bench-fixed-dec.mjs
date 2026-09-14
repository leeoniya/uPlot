// Compare the pre-fix implementation with source, without coverage or DOM startup.
import { performance } from 'node:perf_hooks';
import { fixedDec, genIncrs, guessDec, roundDec } from '../src/utils.js';

const legacyFixedDec = new Map();
const legacyGuessDec = num => (("" + num).split('.')[1] || '').length;

function legacyGenIncrs(base, minExp, maxExp, mults) {
	const incrs = [];
	const multDec = mults.map(legacyGuessDec);
	for (let exp = minExp; exp < maxExp; exp++) {
		const expa = Math.abs(exp);
		const mag = roundDec(Math.pow(base, exp), expa);
		for (let i = 0; i < mults.length; i++) {
			const raw = base == 10 ? +`${mults[i]}e${exp}` : mults[i] * mag;
			const dec = (exp >= 0 ? 0 : expa) + (exp >= multDec[i] ? 0 : multDec[i]);
			const incr = base == 10 ? raw : roundDec(raw, dec);
			incrs.push(incr);
			legacyFixedDec.set(incr, dec);
		}
	}
	return incrs;
}

function generation(gen, registry, calls) {
	return () => {
		registry.clear();
		let count = 0;
		for (const args of calls)
			count += gen(...args).length;
		return count + registry.size;
	};
}

function metadata(guess, values) {
	return () => {
		let count = 0;
		for (const value of values)
			count += guess(value);
		return count;
	};
}

let sink = 0;
function measure(fn, iterations) {
	const start = performance.now();
	for (let i = 0; i < iterations; i++)
		sink += fn();
	return (performance.now() - start) * 1000 / iterations;
}

function compare(name, before, after, iterations) {
	measure(before, Math.ceil(iterations / 2));
	measure(after, Math.ceil(iterations / 2));
	const samples = [[], []];
	for (let run = 0; run < 9; run++) {
		// Alternate order to reduce warmup and scheduling bias.
		for (const index of run % 2 ? [1, 0] : [0, 1])
			samples[index].push(measure(index == 0 ? before : after, iterations));
	}
	const [oldTime, newTime] = samples.map(values => values.sort((a, b) => a - b)[4]);
	return { case: name, 'before µs/op': oldTime.toFixed(3), 'after µs/op': newTime.toFixed(3),
		'change %': ((newTime / oldTime - 1) * 100).toFixed(1) };
}

const results = [];
for (const [name, calls] of [
	['decimal grid (256 increments)', [[10, -32, 32, [1, 2, 2.5, 5]]]],
	['binary grid (106 increments)', [[2, -53, 53, [1]]]],
	['built-in grids (one initialization)', [
		[10, -32, 0, [1, 2, 2.5, 5]], [10, 0, 32, [1, 2, 2.5, 5]],
		[10, -3, 0, [1, 2, 2.5, 5]], [10, 0, 3, [1, 2, 2.5, 5]], [2, -53, 53, [1]],
	]],
])
	results.push(compare(name, generation(legacyGenIncrs, legacyFixedDec, calls), generation(genIncrs, fixedDec, calls), 2000));

for (const [name, values] of [
	['plain metadata (8 values)', [1, 2, 2.5, 5, 0.04, 0.125, 1.25, 0.00125]],
	['exponent metadata (8 values)', [4e-7, 1.25e-7, 7e-20, 1.234e-20, 1e-24, 2.5e-24, 1e21, 1.25e21]],
])
	results.push(compare(name, metadata(legacyGuessDec, values), metadata(guessDec, values), 100000));

console.log(`Runtime: ${process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.version}`);
console.log('Median of 9 samples; generation includes clearing and repopulating the registry.');
console.table(results);
console.log('Checksum:', sink);
