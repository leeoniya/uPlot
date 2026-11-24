// node --expose-gc scripts/bench-heatmap-frame-adapters.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { heatmapCells, heatmapRows } from '../demos/lib/heatmapFrameAdapters.js';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';

const [classic] = JSON.parse(readFileSync(new URL('../demos/data/heatmap-classic.json', import.meta.url)));
const start = performance.now();
const first = heatmapRows(classic);
const firstMs = performance.now() - start;
assert.equal(first.data[1][3].length, 3494);
console.log(`${process.release.name} ${process.version}, ${cpus()[0].model}; first classic call: ${firstMs.toFixed(3)} ms`);

// Same shape and counts, but lower-bound labels. This is a benchmark fixture, not a second export.
const [time, ...fields] = classic.schema.fields;
const ge = { ...classic, schema: { ...classic.schema, fields: [time, ...fields.map((f, i) => ({ ...f,
	labels: { ge: i === 0 ? '-Inf' : fields[i - 1].labels.le },
}))] } };
const [synthetic] = generateHeatmapCells({ xGapProbability: .02 });
const [xs, lo, hi, counts] = synthetic.data.values;
const interval = synthetic.schema.fields.find(f => f.name === 'xMax').config.interval;
const times = Array.from({ length: (xs.at(-1) - xs[0]) / interval + 1 }, (_, i) => xs[0] + interval * i);
const bounds = [...new Set(hi)].sort((a, b) => a - b);
const ids = new Map(bounds.map((v, i) => [v, i]));
const rows = bounds.map(() => Array(times.length).fill(0));
for (let i = 0; i < xs.length; i++) rows[ids.get(hi[i])][(xs[i] - xs[0]) / interval] = counts[i];
const wide = {
	schema: { fields: [{ type: 'time', config: { interval } }, ...bounds.map(v => ({ labels: { le: String(v) } }))] },
	data: { values: [times, ...rows] },
};

function bench(name, adapt, frame, inputCells, populated) {
	const run = () => adapt(frame);
	const expected = run().data[1][3];
	assert.equal(expected.length, populated);
	let sink = 0;
	function sample() {
		const before = performance.now();
		const result = run();
		const ms = performance.now() - before;
		sink += result.data[1][3].at(-1);
		return ms;
	}
	const warmEnd = performance.now() + 300;
	do { sample(); } while (performance.now() < warmEnd);
	const samples = [];
	const end = performance.now() + 700;
	do { samples.push(sample()); } while (performance.now() < end || samples.length < 100);
	assert.ok(sink > 0);
	samples.sort((a, b) => a - b);
	const quantile = q => samples[Math.ceil(q * samples.length) - 1].toFixed(3);
	let retained = 'n/a';
	if (globalThis.gc) {
		// Measure live output only. The input frame is already live on both sides of GC.
		globalThis.gc();
		const before = process.memoryUsage().heapUsed;
		const live = Array.from({ length: 8 }, run);
		globalThis.gc();
		retained = ((process.memoryUsage().heapUsed - before) / live.length / 1024).toFixed(0);
		assert.equal(live.at(-1).data[1][3].at(-1), expected.at(-1));
	}
	console.log(`${name}: ${inputCells} in / ${populated} out; n=${samples.length}; p50 ${quantile(.5)} ms; p95 ${quantile(.95)} ms; retained ~${retained} KiB/result`);
}
const slots = fields.length * classic.data.values[0].length;
bench('classic rows (le)', heatmapRows, classic, slots, 3494);
bench('classic shape (ge)', heatmapRows, ge, slots, 3494);
bench(`synthetic as rows (${times.length} × ${bounds.length})`, heatmapRows, wide, times.length * bounds.length, counts.length);
bench('synthetic sparse cells', heatmapCells, synthetic, lo.length, counts.length);
