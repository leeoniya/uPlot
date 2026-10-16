// node scripts/bench-heatmap-minmax.mjs [--quick] [--reverse]
// bun scripts/bench-heatmap-minmax.mjs [--quick] [--reverse]
// Run engines sequentially on an idle machine; repeat each engine at least three times.
// Only compare the plugin's two asinh-threshold Math.min updates with conditions.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
assert.ok(args.every(arg => ['--quick', '--reverse', '--worker'].includes(arg)), 'Unknown argument');
// A worker gives synchronous loops a wall-clock timeout in both engines.
if (!args.includes('--worker')) {
	const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args, '--worker'], {
		cwd: root, stdio: 'inherit', timeout: 115000, killSignal: 'SIGKILL',
	});
	if (child.error) console.error(child.error.code == 'ETIMEDOUT' ? 'Benchmark timed out after 115 seconds.' : child.error);
	process.exit(child.status ?? 1);
}
assert.equal(globalThis.__coverage__, undefined, 'Run without coverage instrumentation');
const quick = args.includes('--quick'), reverse = args.includes('--reverse');
const warmups = quick ? 3 : 6, samples = quick ? 7 : 17, targetMs = quick ? 5 : 12;
const sha256 = text => createHash('sha256').update(text).digest('hex');
const files = ['demos/lib/heatmapPlugin.js', 'src/utils.js', 'src/uPlot.js', 'src/opts.js',
	'demos/lib/heatmapCellsData.js', 'scripts/instrument.mjs'];
const sources = Object.fromEntries(files.map(file => [file, readFileSync(new URL(file, root), 'utf8')]));
const sourceHashes = Object.fromEntries(files.map(file => [file, sha256(sources[file])]));
const source = sources['demos/lib/heatmapPlugin.js'];
const transforms = [];
function replaceOnce(text, before, after, label) {
	assert.equal(text.split(before).length, 2, `Plugin changed; review ${label}`);
	transforms.push({ label, before, after });
	return text.replace(before, after);
}
let candidate = source;
for (const edge of ['Bottom', 'Top']) {
	candidate = replaceOnce(candidate,
		`if (abs${edge} > minAbs)\n\t\t\t\t\tasinhThreshold = Math.min(asinhThreshold, abs${edge});`,
		`if (abs${edge} > minAbs && abs${edge} < asinhThreshold)\n\t\t\t\t\tasinhThreshold = abs${edge};`,
		`threshold abs${edge}`);
}
// Expose preparation state for untimed equivalence checks. The hot path is unchanged.
function observable(text) {
	return replaceOnce(text, '\t\t\tsetData: prepare,', `\t\t\tsetData: prepare,
			benchSnapshot: () => ({
				x: [x.origin, x.step, x.invStep, x.count, x.values.slice()],
				y: [y.origin, y.step, y.invStep, y.count, y.values.slice()],
				starts: starts.slice(), cellRows: cellRows.slice(0, length), hiddenMin, hiddenMax,
			}),`, 'untimed preparation snapshot');
}
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const factories = [];
for (const text of [source, candidate]) factories.push((await import(moduleUrl(observable(text)))).heatmapPlugin);

// Extract the exact threshold block for an isolated loop over first-seen distinct rows.
// Map lookup, grid transforms, and hidden-row handling are deliberately excluded here.
function thresholdLoop(text) {
	const start = '\t\t\t\tconst absBottom = Math.abs(bottom), absTop = Math.abs(top);';
	const end = '\t\t\t\tif (Math.max(absBottom, absTop) <= minAbs) {';
	assert.equal(text.split(start).length, 2, 'Threshold block start changed');
	assert.equal(text.split(end).length, 2, 'Threshold block end changed');
	const a = text.indexOf(start), b = text.indexOf(end);
	assert.ok(b > a);
	const block = text.slice(a, b);
	assert.ok(!block.includes('for (') && !block.includes('while ('), 'Review threshold extraction');
	return new Function('bottoms', 'tops', 'minAbs', `
		let asinhThreshold = Infinity;
		for (let i = 0; i < bottoms.length; i++) {
			const bottom = bottoms[i], top = tops[i];
${block}
		}
		return asinhThreshold == Infinity ? 1 : asinhThreshold;
	`);
}
const isolated = [source, candidate].map(thresholdLoop);

// Use the existing DOM setup, but replace canvas recorders with checksum-only drawing.
await import('./instrument.mjs');
const { default: uPlot } = await import('../src/uPlot.js');
const { generateHeatmapCells } = await import('../demos/lib/heatmapCellsData.js');
const noop = () => {};
HTMLCanvasElement.prototype.getContext = function() {
	return this.benchContext ??= {
		count: 0, sum: 0,
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

function fixture(columns, signed = false, minAbs = 0) {
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
	const shifted = [cells[0], cells[1].map(v => v / 2), cells[2].map(v => v / 2), cells[3]];
	const frames = [cells, shifted].map(values => {
		const bottoms = [], tops = [], seen = new Set();
		let minY = Infinity, maxY = -Infinity, threshold = Infinity;
		for (let i = 0; i < values[0].length; i++) {
			const bottom = values[1][i], top = values[2][i];
			assert.ok(Number.isFinite(bottom) && Number.isFinite(top) && bottom < top);
			minY = Math.min(minY, bottom);
			maxY = Math.max(maxY, top);
			for (const edge of [bottom, top]) {
				const abs = Math.abs(edge);
				if (abs > minAbs) threshold = Math.min(threshold, abs);
			}
			if (!seen.has(bottom)) {
				seen.add(bottom);
				bottoms.push(bottom);
				tops.push(top);
			}
		}
		return { data: [null, values], bottoms, tops, minY, maxY, threshold: threshold == Infinity ? 1 : threshold };
	});
	return { name: `${columns}-${signed ? 'signed' : 'positive'}-cutoff-${minAbs}`, columns, minAbs, frames,
		xSize: frame.schema.fields[0].config.interval / 1000,
		gridY: signed ? { distr: 3, factor } : { distr: 3 } };
}

async function mount(f, factory) {
	const cells = f.frames[0].data[1];
	const xRange = [cells[0][0] - f.xSize, cells[0].at(-1)], yRange = [0, 1];
	const prepared = [null, null, 1];
	let prepares = 0, draws = 0;
	const plugin = factory({ xSize: f.xSize, grid: { y: f.gridY }, minAbs: f.minAbs,
		onPrepare(u, minY, maxY, threshold) {
			prepares++;
			prepared[0] = minY; prepared[1] = maxY; prepared[2] = threshold;
			yRange[0] = Math.min(0, minY); yRange[1] = Math.max(0, maxY);
		},
	});
	const u = new uPlot({
		mode: 2, width: 1000, height: 560, pxRatio: 1,
		axes: [], padding: [0, 0, 0, 0], legend: { show: false },
		scales: {
			x: { time: false, scan: false, range: () => xRange },
			// Explicit callback: never rely on scan:false selecting an adaptive core threshold.
			y: { distr: 4, log: 2, scan: false, range: () => yRange, asinh: () => prepared[2] },
		},
		series: [{}, {}], plugins: [plugin], hooks: { draw: [() => { draws++; }] },
	}, f.frames[0].data, document.body);
	await Promise.resolve();
	assert.ok(draws > 0, 'Initial draw completed');
	return { u, plugin, prepared, get prepares() { return prepares; }, get draws() { return draws; } };
}
function validate(state, f, frame) {
	assert.deepEqual(state.prepared, [frame.minY, frame.maxY, frame.threshold]);
	assert.equal(state.u.scales.y._asinh, frame.threshold);
	assert.deepEqual([state.u.scales.y.min, state.u.scales.y.max], [Math.min(0, frame.minY), Math.max(0, frame.maxY)]);
	assert.ok(state.u.ctx.count > 0 && Number.isFinite(state.u.ctx.sum));
	return { preparation: state.plugin.hooks.benchSnapshot(), count: state.u.ctx.count, sum: state.u.ctx.sum };
}

let sink = 0;
const median = values => {
	const sorted = [...values].sort((a, b) => a - b);
	return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return { medianMs: median(values), p10Ms: sorted[Math.floor(sorted.length * .1)],
		p90Ms: sorted[Math.floor(sorted.length * .9)], samplesMs: values };
}
async function benchmark(f) {
	const states = [];
	for (const factory of factories) states.push(await mount(f, factory));
	const timings = {};
	try {
		for (const frame of [...f.frames, f.frames[0]]) {
			const outputs = [];
			for (let vi = 0; vi < 2; vi++) {
				assert.equal(isolated[vi](frame.bottoms, frame.tops, f.minAbs), frame.threshold);
				states[vi].u.setData(frame.data);
				await Promise.resolve();
				outputs.push(validate(states[vi], f, frame));
			}
			assert.deepEqual(outputs[0], outputs[1], 'Same preparation arrays, threshold, ranges, and geometry');
		}
		for (const stage of ['isolated-distinct-row-threshold', 'plugin-prepare', 'setData-cpu']) {
			async function batch(vi, iterations) {
				const state = states[vi], fn = isolated[vi];
				const beforePrepares = state.prepares, beforeDraws = state.draws;
				let value = 0;
				const start = performance.now();
				if (stage == 'isolated-distinct-row-threshold') {
					for (let i = 0; i < iterations; i++) {
						const frame = f.frames[i & 1];
						value = fn(frame.bottoms, frame.tops, f.minAbs);
					}
				}
				else if (stage == 'plugin-prepare') {
					for (let i = 0; i < iterations; i++) {
						state.u.data = f.frames[i & 1].data;
						state.plugin.hooks.setData(state.u);
					}
					value = state.prepared[2];
				}
				else {
					for (let i = 0; i < iterations; i++) {
						state.u.setData(f.frames[i & 1].data);
						await Promise.resolve();
					}
					value = state.u.scales.y._asinh;
				}
				const elapsed = performance.now() - start;
				// Assertions, snapshots, and the observable sink are outside the timing window.
				const frame = f.frames[(iterations - 1) & 1];
				assert.equal(value, frame.threshold);
				if (stage != 'isolated-distinct-row-threshold') {
					assert.equal(state.prepares - beforePrepares, iterations);
					assert.deepEqual(state.prepared, [frame.minY, frame.maxY, frame.threshold]);
				}
				assert.equal(state.draws - beforeDraws, stage == 'setData-cpu' ? iterations : 0);
				if (stage == 'setData-cpu') validate(state, f, frame);
				sink += value;
				return elapsed;
			}
			// Calibrate both arms together, then use one fixed batch size for all samples.
			let iterations = 2;
			for (let attempt = 0; attempt < 7; attempt++) {
				const times = [];
				for (const vi of reverse ? [1, 0] : [0, 1]) times.push(await batch(vi, iterations));
				const fastest = Math.min(...times);
				if (fastest >= targetMs || iterations >= 100000) break;
				iterations = Math.min(100000, 2 * Math.ceil(iterations * Math.min(8, targetMs / Math.max(.01, fastest)) / 2));
			}
			const values = [[], []];
			for (let sample = -warmups; sample < samples; sample++) {
				const order = ((sample & 1) ^ Number(reverse)) == 0 ? [0, 1] : [1, 0];
				for (const vi of order) {
					const elapsed = await batch(vi, iterations);
					if (sample >= 0) values[vi].push(elapsed / iterations);
				}
			}
			timings[stage] = { iterations, math: stats(values[0]), conditions: stats(values[1]),
				pairedConditionOverMath: stats(values[0].map((v, i) => values[1][i] / v)).medianMs,
				percentChange: (median(values[1]) / median(values[0]) - 1) * 100 };
			// Check full state after timing, including the standalone preparation stage.
			assert.deepEqual(states[0].plugin.hooks.benchSnapshot(), states[1].plugin.hooks.benchSnapshot());
		}
	}
	finally { for (const state of states) state.u.destroy(); }
	return { name: f.name, cells: f.frames[0].data[1][0].length, distinctRows: f.frames[0].bottoms.length,
		minAbs: f.minAbs, thresholds: f.frames.map(frame => frame.threshold), timings };
}

// General min/max rewrites are NOT equivalent for NaN or signed zero.
assert.ok(Number.isNaN(Math.min(1, NaN)));
assert.equal(NaN < 1 ? NaN : 1, 1);
assert.ok(Object.is(Math.min(0, -0), -0));
assert.ok(Object.is(-0 < 0 ? -0 : 0, 0));
assert.ok(Object.is(Math.max(-0, 0), 0));
// These two threshold updates are narrower: abs() removes -0, and > minAbs rejects NaN.
// Also check empty/all-excluded fallback and the strict cutoff, outside timing.
for (const [bottoms, tops, cutoff, expected] of [
	[[], [], 0, 1], [[NaN, -0, -2], [NaN, 0, 4], 0, 2],
	[[-2, 2], [-1, 4], 2, 4], [[-2], [2], 2, 1], [[-Infinity], [Infinity], 0, 1],
]) {
	for (const fn of isolated) assert.equal(fn(bottoms, tops, cutoff), expected);
}

const started = performance.now();
const report = {
	metadata: {
		runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
		versions: process.versions, cpu: cpus()[0]?.model, platform: platform(), arch: arch(),
		head: execFileSync('git', ['--no-pager', 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim(),
		sourceHashes, benchmarkHash: sha256(readFileSync(fileURLToPath(import.meta.url))),
		candidatePluginHash: sha256(candidate), pluginSource: source, transforms,
	},
	protocol: {
		warmups, samples, targetMs, reverse, alternatingOrder: true, seed: 1, xGapProbability: .02,
		generationTimed: false, proxies: false, coverage: false, width: 1000, height: 560, pxRatio: 1,
		scope: 'Only the two asinhThreshold Math.min updates change. All other plugin/core min/max calls remain unchanged.',
		isolated: 'Exact extracted threshold block, first-seen distinct rows in plugin order. No Map, grid, hidden-row, or per-cell loop cost.',
		prepare: 'Actual plugin setData hook on mounted charts; prebuilt original/halved edges alternate. No scale commit or drawing.',
		setData: 'Actual u.setData plus awaited commit, CPU geometry and checksum canvas. No GPU; not browser frame time.',
		threshold: 'Both arms use scan:false with explicit asinh callback fed by onPrepare. No core adaptive case.',
		semantics: 'Math.min/max generally propagate NaN and select signed zero, unlike strict comparisons. Here Math.abs removes negative zero, > minAbs rejects NaN, and Infinity falls back to 1. Finite numeric plugin fixtures and nonnegative cutoff only; this is not evidence for a broad min/max rewrite.',
	},
	cases: [],
};
// The nonzero cutoff is an exact grid edge, including after halving the Y edges.
const fixtures = [fixture(64), fixture(2569), fixture(2569, true), fixture(2569, true, 2 ** -10)];
for (const f of fixtures) {
	const result = await benchmark(f);
	report.cases.push(result);
	console.log(`\n${result.name}: ${result.cells} cells, ${result.distinctRows} distinct rows`);
	console.table(Object.entries(result.timings).map(([stage, t]) => ({ stage,
		mathMs: +t.math.medianMs.toFixed(6), conditionsMs: +t.conditions.medianMs.toFixed(6),
		changePct: +t.percentChange.toFixed(2), pairedRatio: +t.pairedConditionOverMath.toFixed(4),
	})));
}
assert.ok(Number.isFinite(sink) && sink > 0);
for (const file of files) assert.equal(sha256(readFileSync(new URL(file, root))), sourceHashes[file], `Source changed during run: ${file}`);
report.elapsedMs = performance.now() - started;
report.sink = sink;
execFileSync('git', ['--no-pager', 'check-ignore', 'test/output/heatmap-minmax/'], { cwd: root, timeout: 5000 });
const output = new URL('test/output/heatmap-minmax/', root);
mkdirSync(output, { recursive: true });
const engine = process.versions.bun ? 'bun' : 'node';
const filename = new URL(`${engine}-${Date.now()}-${process.pid}${quick ? '-quick' : ''}${reverse ? '-reverse' : ''}.json`, output);
writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
console.log(`Validation passed. Report: ${filename.pathname}`);
