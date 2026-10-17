// node scripts/bench-heatmap-log-blocks.mjs [--reverse] [--json] [--verify-only]
// bun scripts/bench-heatmap-log-blocks.mjs [--reverse] [--json] [--verify-only]
// Run sequentially. Compares resolutions and validates the demo's fourfold LUT.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';
import { logApproxLut } from '../demos/lib/heatmapColorLut.js';

assert.ok(process.argv.slice(2).every(arg => ['--reverse', '--json', '--verify-only'].includes(arg)), 'Unknown argument');
assert.equal(globalThis.__coverage__, undefined, 'Run without coverage instrumentation');
const source = readFileSync(new URL('../demos/heatmap-cells.js', import.meta.url), 'utf8');

function buildLog(colors, minCount, maxCount, density) {
	assert.ok(colors >= 11 && colors <= 32 && Number.isInteger(colors));
	assert.ok(minCount > 0 && maxCount >= minCount && Number.isFinite(maxCount));
	const countRange = maxCount - minCount || 1;
	const logRange = Math.log(maxCount) - Math.log(minCount);
	const step = logRange / (colors - 1);
	const base = 4 * (colors - 1) ** 2;
	// Adjacent log thresholds spread farther apart as counts increase. A grid
	// interval no wider than the FIRST gap cannot skip two colors in one bin.
	const minGap = logRange == 0 ? 1 : Math.exp(step / 2) * Math.expm1(step) / Math.expm1(logRange);
	const intervals = base * Math.max(1, Math.ceil(1 / minGap / base)) * density;
	assert.ok(intervals < 0x7fffffff, 'Experimental grid exceeds bitwise index range');
	const thresholds = logRange == 0 ? [] : Array.from({ length: colors - 1 }, (_, i) =>
		Math.expm1(step * (i + .5)) / Math.expm1(logRange));
	const transitions = thresholds.map(t => Math.ceil(t * intervals));
	assert.ok(intervals * minGap >= 1 - 1e-14);
	for (let i = 1; i < transitions.length; i++)
		assert.ok(transitions[i] > transitions[i - 1], 'A bin must not skip multiple colors');

	const directory = new Uint8Array(Math.ceil((intervals + 1) / 64));
	const scratch = new Uint8Array((2 * colors - 1) * 64);
	const solidBlocks = new Array(colors);
	let blockCount = 0;
	for (let block = 0, color = 0; block < directory.length; block++) {
		const start = block * 64;
		while (color < transitions.length && start >= transitions[color]) color++;
		const solid = start + 64 <= (transitions[color] ?? Infinity);
		let id = solid ? solidBlocks[color] : undefined;
		if (id == null) {
			id = blockCount++;
			if (solid) solidBlocks[color] = id;
			for (let i = 0; i < 64; i++) {
				while (color < transitions.length && start + i >= transitions[color]) color++;
				scratch[id * 64 + i] = color;
			}
		}
		directory[block] = id;
	}
	assert.ok(blockCount <= 2 * colors - 1);
	const blocks = scratch.slice(0, blockCount * 64);
	if (density == 4 && minCount != maxCount) {
		const actual = logApproxLut(colors, minCount, maxCount);
		assert.ok(actual);
		assert.equal(actual.intervals, intervals);
		assert.deepEqual(actual.directory, directory);
		assert.deepEqual(actual.blocks, blocks);
	}
	// A fresh function per variant avoids sharing JIT feedback between palettes/densities.
	const lookup = new Function('directory', 'blocks', 'minCount', 'countScale', `
		// ${colors} colors, density ${density}
		return count => {
			const i = Math.floor((count - minCount) * countScale);
			return blocks[(directory[i >>> 6] << 6) | (i & 63)];
		};
	`)(directory, blocks, minCount, intervals / countRange);
	return { lookup, intervals, thresholds, transitions, directory, blocks };
}

function validate(table, colors, min, max) {
	const { lookup, intervals, transitions, thresholds, directory, blocks } = table;
	const at = i => blocks[(directory[i >>> 6] << 6) | (i & 63)];
	const gridColor = i => transitions.reduce((n, edge) => n + (i >= edge), 0);
	// Check every stored block's monotonicity, and both ends of every directory
	// entry. Then check every transition explicitly, so an interior shift cannot hide.
	for (let i = 0; i < blocks.length; i++) {
		assert.ok(blocks[i] < colors);
		if (i % 64) assert.ok(blocks[i] >= blocks[i - 1]);
	}
	for (let b = 0; b < directory.length; b++) {
		assert.equal(at(b * 64), gridColor(b * 64));
		assert.equal(at(b * 64 + 63), gridColor(b * 64 + 63));
	}
	transitions.forEach((edge, color) => {
		assert.equal(at(edge - 1), color);
		assert.equal(at(edge), color + 1);
	});
	const logRange = Math.log(max) - Math.log(min);
	const exact = count => min == max ? 0 : Math.round((Math.log(count) - Math.log(min)) / logRange * (colors - 1));
	const check = count => {
		const value = lookup(count);
		assert.ok(Number.isInteger(value) && value >= 0 && value < colors);
		assert.ok(Math.abs(value - exact(count)) <= 1, `${colors} colors, ratio ${max / min}, count ${count}`);
	};
	check(min); check(max);
	assert.equal(lookup(min), 0);
	assert.equal(lookup(max), min == max ? 0 : colors - 1);
	for (let i = 0; i < thresholds.length; i++) {
		const count = min * Math.exp(logRange * (i + .5) / (colors - 1));
		for (const delta of [-1e-12, 0, 1e-12]) check(count * (1 + delta));
		for (const delta of [-1e-6, 0, 1e-6]) check(min + (max - min) * (transitions[i] + delta) / intervals);
	}
	// Include values distributed through both count space and log space.
	for (let i = 1; i < 257; i++) {
		check(min + (max - min) * i / 257);
		check(min * Math.exp(logRange * i / 257));
	}
	// Since error intervals do not overlap, their summed width gives the exact
	// error frequency for an ideal continuous uniform distribution in each space.
	const uniformCountError = thresholds.reduce((sum, t, i) => sum + transitions[i] / intervals - t, 0);
	const uniformLogError = min == max ? 0 : thresholds.reduce((sum, t, i) =>
		sum + Math.log1p((transitions[i] / intervals - t) * Math.expm1(logRange) / (1 + t * Math.expm1(logRange))) / logRange, 0);
	return { uniformCountErrorPct: uniformCountError * 100, uniformLogErrorPct: uniformLogError * 100 };
}

const frame = generateHeatmapCells({ xGapProbability: .02 })[0];
const counts = frame.data.values[frame.schema.fields.findIndex(field => field.name == 'count')];
const frequencies = new Map();
let min = Infinity, max = -Infinity;
for (const count of counts) {
	min = Math.min(min, count); max = Math.max(max, count);
	frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
}
const sizes = Array.from({ length: 22 }, (_, i) => i + 11);
const densities = [1, 4, 16];
const ratios = [100, 1000, 10000, 100000, 1000000];
const rangeResults = [];
for (const ratio of ratios) {
	for (const colors of sizes) {
		for (const density of densities) {
			const table = buildLog(colors, 1, ratio, density);
			const errors = validate(table, colors, 1, ratio);
			rangeResults.push({ ratio, colors, density, flatBytes: table.intervals + 1,
				sharedBytes: table.directory.byteLength + table.blocks.byteLength, ...errors });
		}
	}
}
// Scale invariance, small/constant domains, and numeric threshold neighborhoods.
for (const min of [1e-9, 1e9]) {
	for (const ratio of [1, 1.01, 2, 392, 1e6]) {
		for (const colors of sizes) validate(buildLog(colors, min, min * ratio, 1), colors, min, min * ratio);
	}
}
const actualResults = [];
const variants = [];
function add(name, lookup, exact, permittedError) {
	let expected = 0;
	for (const count of counts) {
		const value = lookup(count);
		assert.ok(Number.isInteger(value) && Math.abs(value - exact(count)) <= permittedError, `${name}: ${count}`);
		expected += value;
	}
	const run = new Function('lookup', `return function run(counts, passes) {
		// ${name}
		let sum = 0;
		for (let pass = 0; pass < passes; pass++)
			for (let i = 0; i < counts.length; i++) sum += lookup(counts[i]);
		return sum;
	}`)(lookup);
	variants.push({ name, expected, run, samples: [] });
}
for (const colors of sizes) {
	const current = logApproxLut(colors, min, max);
	assert.ok(current, 'Demo Log must support the generated count domain');
	const timed = [11, 18, 19, 24, 25, 32].includes(colors);
	const exact = count => Math.round((Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min)) * (colors - 1));
	if (timed) add(`${colors} demo Log`, current.lookup, exact, 1);
	for (const density of densities) {
		const table = buildLog(colors, min, max, density);
		validate(table, colors, min, max);
		let wrongCells = 0, minError = 0, maxError = 0;
		for (const [count, frequency] of frequencies) {
			const error = table.lookup(count) - exact(count);
			assert.ok(Math.abs(error) <= 1);
			if (error) wrongCells += frequency;
			minError = Math.min(minError, error); maxError = Math.max(maxError, error);
		}
		actualResults.push({ colors, density, flatBytes: table.intervals + 1,
			sharedBytes: table.directory.byteLength + table.blocks.byteLength,
			wrongCells, errorPct: wrongCells / counts.length * 100, minError, maxError });
		if (timed) add(`${colors} shared ${density}x`, table.lookup, exact, 1);
	}
}
if (process.argv.includes('--reverse')) variants.reverse();
let checksum = 0;
function measure(variant, passes) {
	const start = performance.now();
	const sum = variant.run(counts, passes);
	const elapsed = performance.now() - start;
	assert.equal(sum, variant.expected * passes);
	checksum += sum;
	return elapsed / passes;
}
if (!process.argv.includes('--verify-only')) {
	for (const variant of variants) {
		const until = performance.now() + 100;
		do { measure(variant, 4); } while (performance.now() < until);
		variant.passes = Math.max(1, Math.min(256, Math.ceil(10 / measure(variant, 8))));
	}
	for (let round = 0; round < 31; round++) {
		for (let offset = 0; offset < variants.length; offset++) {
			const variant = variants[(round + offset) % variants.length];
			variant.samples.push(measure(variant, variant.passes));
		}
	}
}
const quantile = (samples, q) => samples.slice().sort((a, b) => a - b)[Math.floor((samples.length - 1) * q)];
const result = {
	runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
	cpu: cpus()[0]?.model, cells: counts.length, distinctCounts: frequencies.size, min, max,
	sourceSHA256: createHash('sha256').update(source).digest('hex'),
		lutSourceSHA256: createHash('sha256').update(readFileSync(new URL('../demos/lib/heatmapColorLut.js', import.meta.url))).digest('hex'),
		actualResults, rangeResults,
	timings: variants.filter(v => v.samples.length).map(v => ({ lookup: v.name,
		medianMs: quantile(v.samples, .5), p25Ms: quantile(v.samples, .25), p75Ms: quantile(v.samples, .75) })), checksum,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else {
	console.log(JSON.stringify({ runtime: result.runtime, cpu: result.cpu, cells: counts.length, distinctCounts: frequencies.size, min, max }));
	console.table(actualResults);
	console.table(ratios.flatMap(ratio => densities.map(density => {
		const rows = rangeResults.filter(row => row.ratio == ratio && row.density == density);
		return { ratio, density, maxSharedBytes: Math.max(...rows.map(r => r.sharedBytes)),
			maxUniformCountErrorPct: Math.max(...rows.map(r => r.uniformCountErrorPct)),
			maxUniformLogErrorPct: Math.max(...rows.map(r => r.uniformLogErrorPct)) };
	})));
	console.table(result.timings);
	console.log('Validation passed; checksum:', checksum);
}
