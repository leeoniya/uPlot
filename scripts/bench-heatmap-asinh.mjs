// node scripts/bench-heatmap-asinh.mjs [--quick]; bun scripts/bench-heatmap-asinh.mjs [--quick]
// CPU-only: real uPlot and heatmap preparation/geometry, checksum canvas, no GPU or coverage.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import './instrument.mjs';
import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from '../demos/lib/heatmapPlugin.js';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';

assert.equal(globalThis.__coverage__, undefined, 'Run without coverage instrumentation');
const args = process.argv.slice(2);
assert.ok(args.every(arg => arg == '--quick'), 'Only --quick is supported');
const quick = args.includes('--quick');
const warmups = quick ? 2 : 5, samples = quick ? 5 : 15, repeats = quick ? 2 : 6;
const minAbs = 2 ** -128;
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('demos/lib/heatmapPlugin.js', root), 'utf8');
let candidate = source;
// Remove only threshold accumulation, not hidden-row handling or signed-grid searches.
for (const text of [
	'\t\tlet asinhThreshold = Infinity;\n',
	'\t\t\t\tif (absBottom > minAbs)\n\t\t\t\t\tasinhThreshold = Math.min(asinhThreshold, absBottom);\n',
	'\t\t\t\tif (absTop > minAbs)\n\t\t\t\t\tasinhThreshold = Math.min(asinhThreshold, absTop);\n',
]) {
	assert.equal(candidate.split(text).length, 2, 'Plugin changed; review the benchmark-only transformation');
	candidate = candidate.replace(text, '');
}
const notification = 'onPrepare?.(u, minY, maxY, asinhThreshold == Infinity ? 1 : asinhThreshold);';
assert.equal(candidate.split(notification).length, 2);
candidate = candidate.replace(notification, 'onPrepare?.(u, minY, maxY);');
const { heatmapPlugin: withoutThreshold } = await import(`data:text/javascript;base64,${Buffer.from(candidate).toString('base64')}`);
const variants = [
	{ name: 'plugin-threshold', factory: heatmapPlugin, adaptive: false },
	{ name: 'core-threshold', factory: withoutThreshold, adaptive: true },
];

const noop = () => {};
HTMLCanvasElement.prototype.getContext = function() {
	return this.benchContext ??= {
		clearRect() { this.count = this.sum = 0; },
		fill(path) { if (path) { this.count += path.count; this.sum += path.sum; } },
		...Object.fromEntries(['save', 'restore', 'stroke', 'clip', 'beginPath', 'moveTo', 'lineTo',
			'fillRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'arc'].map(name => [name, noop])),
	};
};
globalThis.Path2D = class {
	count = 0;
	sum = 0;
	rect(x, y, w, h) { this.count++; this.sum += x + 3 * y + 5 * w + 7 * h; }
};

function fixture(columns, signed = false) {
	const frame = generateHeatmapCells({ seed: 1, columns, xGapProbability: .02 })[0];
	const [times, lo, hi, counts] = frame.data.values;
	const factor = hi[0] / lo[0];
	let cells = [times.map(v => v / 1000), lo, hi, counts];
	if (signed) {
		const mirrored = [[], [], [], []];
		const add = (i, negative) => {
			mirrored[0].push(cells[0][i]);
			mirrored[1].push(negative ? -hi[i] : lo[i]);
			mirrored[2].push(negative ? -lo[i] : hi[i]);
			mirrored[3].push(counts[i]);
		};
		for (let start = 0; start < times.length;) {
			let end = start + 1;
			while (end < times.length && times[end] == times[start]) end++;
			for (let i = end - 1; i >= start; i--) add(i, true);
			for (let i = start; i < end; i++) add(i, false);
			start = end;
		}
		cells = mirrored;
	}
	let minY = Infinity, maxY = -Infinity, threshold = Infinity;
	for (let i = 0; i < cells[0].length; i++) {
		minY = Math.min(minY, cells[1][i]);
		maxY = Math.max(maxY, cells[2][i]);
		threshold = Math.min(threshold, Math.abs(cells[1][i]), Math.abs(cells[2][i]));
	}
	assert.ok(threshold / 2 > minAbs, 'Core cutoff 0 and plugin cutoff must be equivalent for these fixtures');
	return {
		name: `${columns}-columns-${signed ? 'mirrored' : 'positive'}`,
		cells, shifted: [cells[0], cells[1].map(v => v / 2), cells[2].map(v => v / 2), cells[3]],
		xSize: frame.schema.fields[0].config.interval / 1000,
		gridY: signed ? { distr: 3, factor } : { distr: 3 },
		minY, maxY, threshold, rows: new Set(cells[1]).size,
	};
}

async function mount(f, variant) {
	let threshold = 1, prepared = 0, draws = 0;
	const xRange = [f.cells[0][0] - f.xSize, f.cells[0].at(-1)];
	const yRange = [0, 1];
	const plugin = variant.factory({
		xSize: f.xSize, minAbs, grid: { x: { distr: 1 }, y: f.gridY },
		onPrepare(u, minY, maxY, value) {
			prepared++;
			threshold = value;
			yRange[0] = Math.min(0, minY);
			yRange[1] = Math.max(0, maxY);
		},
	});
	const y = { distr: 4, log: 2, scan: false, range: () => yRange };
	// Explicitly request core scanning: scan:false now defaults omitted asinh to 1.
		y.asinh = variant.adaptive ? (u, key) => uPlot.scan(u, key, null, null, true)[2] ?? 1 : () => threshold;
	const u = new uPlot({
		mode: 2, width: 1000, height: 560, pxRatio: 1,
		axes: [], padding: [0, 0, 0, 0], legend: { show: false },
		scales: { x: { time: false, scan: false, range: () => xRange }, y },
		series: [{}, {}], plugins: [plugin], hooks: { draw: [() => { draws++; }] },
	}, [null, [...f.cells]], document.body);
	await Promise.resolve();
	assert.ok(draws > 0, 'Initial draw completed');
	return {
		u, plugin, data: [null, [...f.cells]], shifted: [null, [...f.shifted]],
		get prepared() { return prepared; }, get draws() { return draws; },
	};
}

function validate(state, f, shifted = false) {
	const { u } = state, factor = shifted ? .5 : 1;
	assert.equal(u.scales.y._asinh, f.threshold * factor);
	assert.deepEqual([u.scales.y.min, u.scales.y.max], [Math.min(0, f.minY) * factor, f.maxY * factor]);
	assert.deepEqual([u.scales.x.min, u.scales.x.max], [f.cells[0][0] - f.xSize, f.cells[0].at(-1)]);
	assert.ok(u.ctx.count > 0 && Number.isFinite(u.ctx.sum));
	return [u.ctx.count, u.ctx.sum];
}

function invalidateThreshold(u) {
	for (const facet of u.series[1].facets.slice(1)) {
		facet.min = facet.max = null;
		facet.minAbs = undefined;
	}
}

let sink = 0;
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
function summarize(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return { medianMs: median(values), p10Ms: sorted[Math.floor(sorted.length * .1)], p90Ms: sorted[Math.floor(sorted.length * .9)], samplesMs: values };
}

async function benchmark(f) {
	const states = await Promise.all(variants.map(v => mount(f, v)));
	const timings = {};
	try {
		for (const shifted of [false, true, false]) {
			const geometry = [];
			for (const state of states) {
				state.u.setData(shifted ? state.shifted : state.data);
				await Promise.resolve();
				geometry.push(validate(state, f, shifted));
			}
			assert.deepEqual(geometry[0], geometry[1], 'Same threshold, ranges, and painted geometry');
		}
		for (const stage of ['prepare', 'cold-threshold', 'warm-threshold', 'setData', 'redraw', 'initialization']) {
			const values = [[], []];
			const iterations = stage == 'warm-threshold' ? 20000 : stage == 'initialization' ? 1 : repeats;
			for (let sample = -warmups; sample < samples; sample++) {
				for (const vi of sample % 2 == 0 ? [0, 1] : [1, 0]) {
					const state = states[vi], u = state.u;
					let elapsed = 0;
					const beforeDraws = state.draws, beforePrepare = state.prepared;
					if (stage == 'warm-threshold') {
						const start = performance.now();
						for (let i = 0; i < iterations; i++) sink += u.scales.y.asinh(u, 'y');
						elapsed = performance.now() - start;
					}
					else for (let i = 0; i < iterations; i++) {
						if (stage == 'cold-threshold') invalidateThreshold(u);
						const start = performance.now();
						let fresh;
						if (stage == 'prepare') state.plugin.hooks.setData(u);
						else if (stage == 'cold-threshold') sink += u.scales.y.asinh(u, 'y');
						else if (stage == 'initialization') fresh = await mount(f, variants[vi]);
						else {
							if (stage == 'setData') u.setData(i % 2 == 0 ? state.shifted : state.data);
							else u.redraw();
							await Promise.resolve();
						}
						elapsed += performance.now() - start;
						if (fresh) { validate(fresh, f); fresh.u.destroy(); }
					}
					if (stage == 'setData' || stage == 'redraw') {
						assert.equal(state.draws - beforeDraws, iterations, 'Every update completed a draw');
						assert.equal(state.prepared - beforePrepare, stage == 'setData' ? iterations : 0);
						validate(state, f);
					}
					if (sample >= 0) values[vi].push(elapsed / iterations);
				}
			}
			timings[stage] = Object.fromEntries(variants.map((v, i) => [v.name, summarize(values[i])]));
		}
	}
	finally { states.forEach(s => s.u.destroy()); }
	return { name: f.name, cells: f.cells[0].length, distinctYRows: f.rows, threshold: f.threshold, timings };
}

async function probeReads(f) {
	// Run after ALL cases: proxy feedback must not deoptimize subsequent timed scans.
	const reads = [];
	for (const variant of variants) {
		const state = await mount(f, variant), u = state.u;
		try {
			const counts = [0, 0];
			for (let fi = 1; fi <= 2; fi++) u.data[1][fi] = new Proxy(u.data[1][fi], {
				get(target, key, receiver) {
					if (typeof key == 'string' && /^(0|[1-9]\d*)$/.test(key)) counts[fi - 1]++;
					return Reflect.get(target, key, receiver);
				},
			});
			invalidateThreshold(u);
			assert.equal(u.scales.y.asinh(u, 'y'), f.threshold);
			const cold = counts.slice();
			counts.fill(0);
			assert.equal(u.scales.y.asinh(u, 'y'), f.threshold);
			assert.deepEqual(counts, [0, 0], 'Warm threshold must not reread cells');
			assert.deepEqual(cold, variant.adaptive ? [f.cells[0].length, f.cells[0].length] : [0, 0]);
			reads.push({ variant: variant.name, cold, warm: counts.slice() });
		}
		finally { u.destroy(); }
	}
	return reads;
}

const started = performance.now();
const sha256 = text => createHash('sha256').update(text).digest('hex');
const report = {
	metadata: {
		runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
		cpu: cpus()[0]?.model,
		head: execFileSync('git', ['--no-pager', 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		sourceHashes: Object.fromEntries(['src/uPlot.js', 'src/utils.js', 'src/opts.js', 'demos/lib/heatmapPlugin.js', 'demos/lib/heatmapCellsData.js']
			.map(file => [file, sha256(readFileSync(new URL(file, root)))])),
		candidatePluginHash: sha256(candidate),
	},
	protocol: { warmups, samples, repeats, alternatingOrder: true, width: 1000, height: 560, pxRatio: 1,
		minAbs, generationTimed: false, coverage: false, drawing: 'checksum paths/context; CPU geometry only',
		notes: 'Both arms disable range scans and use range functions. Core arm removes plugin threshold accumulation only and explicitly calls the cached core scanner for asinh, since scan:false disables default adaptive selection. Cold threshold invalidation and chart destruction are outside timing. Warm callback measurements batch 20000 calls. setData alternates prebuilt original/halved Y bounds and awaits each commit. Redraw uses redraw(). Initialization includes mount, first draw, and a completion assertion. Proxies run after all timed cases on separate instances to avoid contaminating JIT feedback. All fixture edges exceed both cutoffs.' },
	cases: [],
};
const fixtures = [fixture(64), fixture(2569), fixture(2569, true)];
for (const f of fixtures) {
	const result = await benchmark(f);
	report.cases.push(result);
	console.log(`\n${result.name}: ${result.cells} cells, ${result.distinctYRows} Y rows`);
	console.table(Object.entries(result.timings).map(([stage, values]) => ({ stage,
		pluginMs: +values['plugin-threshold'].medianMs.toFixed(4), coreMs: +values['core-threshold'].medianMs.toFixed(4),
		deltaMs: +(values['core-threshold'].medianMs - values['plugin-threshold'].medianMs).toFixed(4),
	})));
}
for (let i = 0; i < fixtures.length; i++) report.cases[i].reads = await probeReads(fixtures[i]);
report.elapsedMs = performance.now() - started;
assert.ok(Number.isFinite(sink) && sink > 0);
const output = new URL('test/output/', root);
mkdirSync(output, { recursive: true });
const filename = new URL(`heatmap-asinh-${process.versions.bun ? 'bun' : 'node'}${quick ? '-quick' : ''}.json`, output);
writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
console.log(`Validation passed. Report: ${filename.pathname}`);
