// Run directly: node scripts/bench-rounding.mjs (or bun), without coverage.
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import * as source from '../src/utils.js';
import '../src/opts.js';

const baselineText = execFileSync('git', ['--no-pager', 'show', '443333f:src/utils.js'], {
	cwd: new URL('..', import.meta.url),
	encoding: 'utf8',
});
const baseline = await import('data:text/javascript;base64,' + Buffer.from(baselineText).toString('base64'));
// Use identical built-in metadata, without timing grid generation or map copying.
for (const [incr, dec] of source.fixedDec)
	baseline.fixedDec.set(incr, dec);

const iterations = 1000;
const checksums = [];

function numericBatch(fn, calls) {
	return () => {
		let sum = 0;
		for (let i = 0; i < calls.length; i++)
			sum += fn(calls[i][0], calls[i][1]);
		return sum;
	};
}

function rangeBatch(fn, calls) {
	return () => {
		let sum = 0;
		for (let i = 0; i < calls.length; i++) {
			const args = calls[i];
			const bounds = fn(args[0], args[1], args[2], args[3]);
			sum += bounds[0] * 0.5 + bounds[1];
		}
		return sum;
	};
}

function measure(fn, count, size) {
	let checksum = 0;
	const start = performance.now();
	for (let i = 0; i < count; i++)
		checksum += fn();
	const ns = (performance.now() - start) * 1e6 / (count * size);
	return { ns, checksum };
}

function compare(name, symbol, calls, batch = numericBatch) {
	const runners = [batch(baseline[symbol], calls), batch(source[symbol], calls)];
	const sums = [0, 0];
	// Warm both call targets before collecting samples, alternating order here too.
	for (let run = 0; run < 4; run++)
		for (const index of run % 2 ? [1, 0] : [0, 1])
			sums[index] += measure(runners[index], iterations / 2, calls.length).checksum;

	const samples = [[], []];
	for (let run = 0; run < 9; run++) {
		for (const index of run % 2 ? [1, 0] : [0, 1]) {
			const result = measure(runners[index], iterations, calls.length);
			samples[index].push(result.ns);
			sums[index] += result.checksum;
		}
	}
	checksums.push({ case: name, baseline: sums[0], source: sums[1] });
	const [oldTime, newTime] = samples.map(values => values.sort((a, b) => a - b)[4]);
	return {
		case: name,
		'old ns/call': oldTime.toFixed(1),
		'new ns/call': newTime.toFixed(1),
		'change %': ((newTime / oldTime - 1) * 100).toFixed(1),
	};
}

// All deterministic input generation happens before measurement.
const typical = Array.from({ length: 128 }, (_, i) => [
	(i % 3 == 0 ? -1 : 1) * (i * 17.3197 + [0, 0.005, 0.125, 0.999999999999][i % 4]),
	[0, 1, 2, 3, 6][i % 5],
]);
const precision24 = [
	...typical.map(([value]) => [value, 24]),
	...[10000000.000027, 9999999.999959, 9999999.999753, 1.23456789e-20, -1.23456789e-20, 2.5e-24].map(value => [value, 24]),
];

function gridCalls(grids) {
	return grids.flatMap(incr => Array.from({ length: 32 }, (_, i) => [
		(i % 3 == 0 ? -1 : 1) * (i * 3 + [0, 0.25, 0.5, 0.75][i % 4]) * incr,
		incr,
	]));
}
const commonGrids = gridCalls([0.001, 0.01, 0.1, 0.2, 0.25, 0.5, 1, 2.5, 5, 10]);
const tinyGrids = gridCalls([1e-7, 2.5e-8, 1e-12, 2e-20, 1e-24, 2.5e-24]);
const digits = [0, 0.001, -0.5, 1, -9, 9.999999999999998, 10, 99, 100, 999.9,
	1000, -12345, 1e6, 2147483647, 2147483648, 4294967296, -4294967296,
	999999999999999, 1e15, Number.MAX_SAFE_INTEGER, 1e18, 1e21, 1e100];
const digitCalls = Array.from({ length: 128 }, (_, i) => [digits[i % digits.length]]);
const normalRanges = [[0, 100], [-100, -10], [-5, 15], [36, 51], [0.001, 0.009],
	[1e6, 2e6], [0, 0], [10, 10]].map(([min, max]) => [min, max, 0.1, true]);
const grafanaConfig = {
	flat: 1e-12,
	min: { pad: 0.1, hard: -Infinity, soft: 0, mode: 3 },
	max: { pad: 0.1, hard: Infinity, soft: 0, mode: 3 },
};
const grafanaRanges = [[9.999999, 10.000001], [9.9999999, 10.0000001],
	[9999999.999753, 10000000.000027], [9999999.999959, 10000000.000027]]
	.flatMap(([min, max]) => [[min, max, grafanaConfig], [-max, -min, grafanaConfig]]);
const repeatRanges = calls => Array.from({ length: 128 }, (_, i) => calls[i % calls.length]);
const normalCalls = repeatRanges(normalRanges);
const grafanaCalls = repeatRanges(grafanaRanges);

console.log(`Runtime: ${process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.version}`);
console.log(`Baseline: 443333f; source opts fixedDec entries copied: ${baseline.fixedDec.size}`);
console.log('Median of 9 samples; 1000 batches/sample; 4 alternating warmup rounds; alternating old/new samples.');
console.log('ns/call includes loop, dispatch, and checksum overhead; setup/imports/generation excluded.');
const results = [
	compare('roundDec typical', 'roundDec', typical),
	compare('roundDec precision 24', 'roundDec', precision24),
];
for (const symbol of ['incrRound', 'incrRoundUp', 'incrRoundDn']) {
	results.push(compare(symbol + ' common grids', symbol, commonGrids));
	results.push(compare(symbol + ' tiny grids', symbol, tinyGrids));
}
results.push(compare('numIntDigits representative', 'numIntDigits', digitCalls));
results.push(compare('rangeNum normal/flat', 'rangeNum', normalCalls, rangeBatch));
results.push(compare('rangeNum Grafana near-flat', 'rangeNum', grafanaCalls, rangeBatch));
console.table(results);
console.log('Checksums (consumption only, not correctness or equality checks):');
console.table(checksums);
console.log('Caveats: rounding/ties, large digit counts, and near-flat range behavior differ after fixes.');
console.log('This is a warm microbenchmark, not a correctness test or a chart-rendering benchmark.');
