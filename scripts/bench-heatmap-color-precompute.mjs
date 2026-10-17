// node scripts/bench-heatmap-color-precompute.mjs [--reverse]
// bun scripts/bench-heatmap-color-precompute.mjs [--reverse]
// Run engines sequentially. Times exclude data generation, drawing, and validation.
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';

assert.ok(process.argv.slice(2).every(arg => arg == '--reverse'), 'Unknown argument');
assert.equal(globalThis.__coverage__, undefined, 'Run without coverage instrumentation');
const frame = generateHeatmapCells({ xGapProbability: .02 })[0];
const counts = frame.data.values[frame.schema.fields.findIndex(field => field.name == 'count')];
function findRange(counts) {
	let min = Infinity, max = -Infinity;
	for (let i = 0; i < counts.length; i++) {
		min = Math.min(min, counts[i]);
		max = Math.max(max, counts[i]);
	}
	return [min, max];
}
const [min, max] = findRange(counts);
const cases = [{ name: 'min/max scan', colors: '-', expected: [min, max], run: findRange, samples: [] }];
for (const colors of [11, 24, 32]) {
	for (const mode of ['sqrt', 'log']) {
		const expected = Uint8Array.from(counts, count => Math.round((colors - 1) * (mode == 'sqrt' ?
			Math.sqrt((count - min) / (max - min)) : (Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min)))));
		for (const allocate of [false, true]) {
			// Separate call sites per case avoid shared polymorphic feedback. Math is direct,
			// not a LUT, and setup constants are included in each preprocessing call.
			const run = new Function('min', 'max', 'colors', 'buffer', `return function prepare(counts) {
				// ${mode}, ${colors} colors, ${allocate ? 'allocate' : 'reuse'}
				const out = ${allocate ? 'new Uint8Array(counts.length)' : 'buffer'};
				const last = colors - 1;
				if (min == max) {
					out.fill(0);
					return out;
				}
				${mode == 'sqrt' ? 'const inverseRange = 1 / (max - min);' : 'const logMin = Math.log(min), scale = last / (Math.log(max) - logMin);'}
				for (let i = 0; i < counts.length; i++)
					out[i] = ${mode == 'sqrt' ? 'Math.round(Math.sqrt((counts[i] - min) * inverseRange) * last)' : 'Math.round((Math.log(counts[i]) - logMin) * scale)'};
				return out;
			}`)(min, max, colors, allocate ? null : new Uint8Array(counts.length));
			assert.deepEqual(run(counts), expected);
			cases.push({ name: `${mode} ${allocate ? 'allocate + fill' : 'reuse + fill'}`, colors, run, expected, samples: [] });
		}
	}
}
if (process.argv.includes('--reverse')) cases.reverse();
let checksum = 0;
function measure(item, passes) {
	let out;
	const start = performance.now();
	for (let i = 0; i < passes; i++) {
		out = item.run(counts);
		checksum += out[i % out.length];
	}
	const elapsed = performance.now() - start;
	assert.deepEqual(out, item.expected);
	return elapsed / passes;
}
for (const item of cases) {
	const until = performance.now() + 150;
	do { measure(item, 4); } while (performance.now() < until);
	item.passes = Math.max(1, Math.min(128, Math.ceil(10 / measure(item, 4))));
}
for (let round = 0; round < 31; round++) {
	for (let offset = 0; offset < cases.length; offset++) {
		const item = cases[(round + offset) % cases.length];
		item.samples.push(measure(item, item.passes));
	}
}
const quantile = (samples, q) => samples.slice().sort((a, b) => a - b)[Math.floor((samples.length - 1) * q)];
console.log(JSON.stringify({
	runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
	cpu: cpus()[0]?.model, cells: counts.length, bytesPerBuffer: counts.length,
	kiBPerBuffer: counts.length / 1024, min, max, samples: 31,
}));
console.table(cases.map(item => ({
	colors: item.colors, operation: item.name,
	medianMs: +quantile(item.samples, .5).toFixed(4),
	p25Ms: +quantile(item.samples, .25).toFixed(4),
	p75Ms: +quantile(item.samples, .75).toFixed(4),
})).sort((a, b) => (Number(a.colors) || 0) - (Number(b.colors) || 0) || a.operation.localeCompare(b.operation)));
console.log('Checksum:', checksum);
