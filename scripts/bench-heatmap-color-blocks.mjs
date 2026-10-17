// node scripts/bench-heatmap-color-blocks.mjs [--reverse] [--json]
// bun scripts/bench-heatmap-color-blocks.mjs [--reverse] [--json]
// Run sequentially. Times color selection only, not LUT construction or rendering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';

assert.ok(process.argv.slice(2).every(arg => ['--reverse', '--json'].includes(arg)), 'Unknown argument');
assert.equal(globalThis.__coverage__, undefined, 'Run without coverage instrumentation');
const source = readFileSync(new URL('../demos/heatmap-cells.js', import.meta.url), 'utf8');
const start = '\t\tconst colorLookup = new Uint8Array(';
const end = '\t\t// Legend position is linear in count;';
assert.equal(source.split(start).length, 2, 'Review LUT setup extraction');
assert.equal(source.split(end).length, 2, 'Review LUT setup extraction');
const setup = source.slice(source.indexOf(start), source.indexOf(end));
const buildCurrent = new Function('colorCount', 'minCount', 'maxCount', `
	const countRange = maxCount - minCount || 1;

	let colorIndices;
	${setup}
	return { colorIndices, colorLookup, cubeDirectory, cubeLookup, cubeIntervals };
`);
// Exhaustively check the production builder, including every shared-block boundary.
for (let colors = 11; colors <= 32; colors++) {
	const current = buildCurrent(colors, 1, 64);
	for (const name of ['colorLookup', 'cubeDirectory', 'cubeLookup'])
		assert.ok(current[name] instanceof Uint8Array, name);
	for (let i = 0, color = 0; i <= current.cubeIntervals; i++) {
		if (i == (2 * color + 1) ** 3) color++;
		assert.equal(current.cubeLookup[(current.cubeDirectory[i >>> 6] << 6) | (i & 63)], color);
	}
	assert.equal(current.colorIndices.cbrt(1), 0);
	assert.equal(current.colorIndices.cbrt(64), colors - 1);
}
const frame = generateHeatmapCells({ xGapProbability: .02 })[0];
const counts = frame.data.values[frame.schema.fields.findIndex(field => field.name == 'count')];
let min = Infinity, max = -Infinity;
for (const count of counts) {
	min = Math.min(min, count);
	max = Math.max(max, count);
}

function compress(flat) {
	const directory = new Uint8Array(Math.ceil(flat.length / 64));
	const ids = new Map();
	const pages = [];
	for (let b = 0; b < directory.length; b++) {
		const page = new Uint8Array(64).fill(flat.at(-1));
		page.set(flat.subarray(b * 64, Math.min((b + 1) * 64, flat.length)));
		const key = Buffer.from(page).toString('hex');
		if (!ids.has(key)) {
			ids.set(key, pages.length);
			pages.push(page);
		}
		directory[b] = ids.get(key);
	}
	assert.ok(pages.length <= 256);
	const blocks = new Uint8Array(pages.length * 64);
	pages.forEach((page, i) => blocks.set(page, i * 64));
	for (let i = 0; i < flat.length; i++)
		assert.equal(blocks[(directory[i >>> 6] << 6) | (i & 63)], flat[i]);
	return { directory, blocks };
}

const variants = [];
const storage = [];
function add(name, lookup, reference) {
	let expected = 0;
	for (const count of counts) {
		const value = lookup(count);
		assert.equal(value, reference(count), `${name}: ${count}`);
		expected += value;
	}
	// Separate call sites allow each lookup to inline independently.
	const run = new Function('lookup', `return function run(counts, passes) {
		// ${name}
		let sum = 0;
		for (let pass = 0; pass < passes; pass++)
			for (let i = 0; i < counts.length; i++)
				sum += lookup(counts[i]);
		return sum;
	}`)(lookup);
	variants.push({ name, run, expected, samples: [] });
}

for (const colors of [24, 32]) {
	const current = buildCurrent(colors, min, max);
	for (const power of [2, 3]) {
		const root = power == 2 ? 'sqrt' : 'cbrt';
		const flat = new Uint8Array((2 * (colors - 1)) ** power + 1);
		for (let color = 0; color < colors; color++)
			flat.fill(color, color == 0 ? 0 : (2 * color - 1) ** power, (2 * color + 1) ** power);
		// Verify integer transitions, plus the interiors of every LUT interval.
		for (let i = 0; i < flat.length - 1; i++) {
			for (const offset of [.25, .75])
				assert.equal(flat[i], Math.round(Math[root]((i + offset) / (flat.length - 1)) * (colors - 1)));
		}
		for (let color = 1; color < colors; color++) {
			const edge = (2 * color - 1) ** power;
			assert.equal(flat[edge - 1], color - 1);
			assert.equal(flat[edge], color);
		}
		assert.equal(flat.at(-1), colors - 1);
		const { directory, blocks } = compress(flat);
		storage.push({ colors, root, flatBytes: flat.byteLength, directoryBytes: directory.byteLength,
			uniqueBlocks: blocks.length / 64, blockBytes: blocks.byteLength, sharedBytes: directory.byteLength + blocks.byteLength });
		const reference = count => Math.round(Math[root]((count - min) / (max - min)) * (colors - 1));
		if (root == 'cbrt') {
			assert.deepEqual(current.cubeDirectory, directory);
			assert.deepEqual(current.cubeLookup, blocks);
		}
		else assert.deepEqual(current.colorLookup, flat);
		add(`${colors} ${root} demo`, current.colorIndices[root], reference);
		// Per-instance immutable closures match the demo; no module-level data access in the hot path.
		for (const shared of [false, true]) {
			const name = `${colors} ${root} ${shared ? 'shared64' : 'flat Uint8'}`;
			const lookup = new Function('flat', 'directory', 'blocks', 'minCount', 'countRange', `
				// ${name}
				const countScale = (flat.length - 1) / countRange;
				return count => {
					const i = Math.floor((count - minCount) * countScale);
					return ${shared ? 'blocks[(directory[i >>> 6] << 6) | (i & 63)]' : 'flat[i]'};
				};
			`)(flat, directory, blocks, min, max - min);
			add(name, lookup, reference);
		}
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
for (const variant of variants) {
	const until = performance.now() + 200;
	do { measure(variant, 4); } while (performance.now() < until);
	variant.passes = Math.max(1, Math.min(256, Math.ceil(15 / measure(variant, 8))));
}
for (let round = 0; round < 31; round++) {
	for (let offset = 0; offset < variants.length; offset++) {
		const variant = variants[(round + offset) % variants.length];
		variant.samples.push(measure(variant, variant.passes));
	}
}
const quantile = (samples, q) => samples.slice().sort((a, b) => a - b)[Math.floor((samples.length - 1) * q)];
const result = {
	runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
	cpu: cpus()[0]?.model, cells: counts.length, distinctCounts: new Set(counts).size, min, max, samples: 31,
	sourceSHA256: createHash('sha256').update(source).digest('hex'), storage,
	timings: variants.map(variant => ({
		lookup: variant.name,
		medianMs: quantile(variant.samples, .5),
		nsPerCell: quantile(variant.samples, .5) * 1e6 / counts.length,
		p25Ms: quantile(variant.samples, .25), p75Ms: quantile(variant.samples, .75),
	})), checksum,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else {
	const { storage, timings, ...metadata } = result;
	console.log(JSON.stringify(metadata));
	console.table(storage);
	console.table(timings.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value == 'number' ? +value.toFixed(4) : value]))));
}
