// Node/Bun only. --baseline records frozen-source A/A; the default compares it with src/.
// Data preparation and drawing are excluded; scale/layout/legend updates and microtasks remain.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const baselineSHA = '3ab577c266d9890401be1f875fcc190e1afd5bbd';
const archiveSHA256 = 'b321e924c74e60bee03a2bc0f533f01d781608b8a0043759ac15ac1fd5736eba';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
assert(!args.has('--inline') && !args.has('--reverse'), '--inline and --reverse are retired: core no longer has a scanAsinh helper. Use the default baseline/current comparison.');
for (const arg of args)
	assert(['--baseline', '--expect-fused', '--min', '--worker', '--help'].includes(arg), `Unknown argument: ${arg}`);
if (args.has('--help')) {
	console.log('node|bun scripts/bench-asinh-scan.mjs [--baseline | --expect-fused] [--min]\n' +
		'--baseline: frozen-source A/A calibration, never imports working-tree src.\n' +
		'Default: paired pinned baseline / working-tree comparison.\n' +
		'--expect-fused: also require a 3-element asinh scan, fewer setData reads, and zero cached callback reads.\n' +
		'--inline and --reverse are retired because core no longer has a scanAsinh helper.\n' +
		'--min: report minimum batch us/update and the ratio of baseline/candidate minima; retain all samples.\n' +
		'Each run retains source snapshots, hashes, checksums, read probes, and raw samples in test/output/asinh-scan/.\n' +
		'Hard timeout: 115 seconds per engine. No browsers or test runner.');
	process.exit(0);
}
assert(!(args.has('--baseline') && args.has('--expect-fused')), '--expect-fused requires a current-source comparison');

if (!args.has('--worker')) {
	const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args, '--worker'], {
		cwd: root, stdio: 'inherit', timeout: 115000, killSignal: 'SIGKILL',
	});
	if (child.error)
		console.error(child.error.code === 'ETIMEDOUT' ? 'Benchmark exceeded 115 seconds; worker killed.' : child.error);
	process.exit(child.status ?? 1);
}

const started = performance.now();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const output = join(root, 'test/output/asinh-scan');
execFileSync('git', ['--no-pager', 'check-ignore', 'test/output/asinh-scan/'], { cwd: root, timeout: 5000 });
mkdirSync(output, { recursive: true });
const archive = join(output, `baseline-${baselineSHA}.tar`);
if (!existsSync(archive)) {
	execFileSync('git', ['--no-pager', 'archive', '--format=tar', `--output=${archive}`, baselineSHA,
		'src', 'demos/arcsinh-scales.js', 'scripts/instrument.mjs', 'package.json'], { cwd: root, timeout: 10000 });
}
assert.equal(sha256(readFileSync(archive)), archiveSHA256, 'Baseline archive checksum mismatch');
const engine = process.versions.bun ? `bun-${process.versions.bun}` : `node-${process.versions.node}`;
const calibration = args.has('--baseline');
const useMin = args.has('--min');
const runDir = mkdtempSync(join(output, `${engine}-${calibration ? 'baseline' : 'compare'}-`));
const baseDir = join(runDir, 'baseline');
const nextDir = join(runDir, 'candidate');
mkdirSync(baseDir);
mkdirSync(nextDir);
execFileSync('tar', ['-xf', archive, '-C', baseDir], { timeout: 10000 });
cpSync(join(calibration ? baseDir : root, 'src'), join(nextDir, 'src'), { recursive: true });
writeFileSync(join(nextDir, 'package.json'), '{"type":"module"}\n');

const dirs = [baseDir, nextDir];
const names = ['baseline', calibration ? 'baseline-copy' : 'current'];

function manifest(dir, prefix = '') {
	const files = {};
	for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const path = join(prefix, entry.name);
		if (entry.isDirectory()) Object.assign(files, manifest(dir, path));
		else files[path] = sha256(readFileSync(join(dir, path)));
	}
	return files;
}
const sourceHashes = dirs.map(dir => manifest(join(dir, 'src')));
if (calibration) assert.deepEqual(sourceHashes[0], sourceHashes[1]);
else assert.deepEqual(sourceHashes[1], manifest(join(root, 'src')), 'Source changed while taking snapshot; rerun after edits finish');

// Reuse the pinned Happy DOM setup, but replace recorders before constructing any chart.
await import(pathToFileURL(join(baseDir, 'scripts/instrument.mjs')).href);
const noop = () => {};
const canvasMethods = ['clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'beginPath',
	'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill', 'save', 'restore',
	'clip', 'fillRect', 'arc', 'arcTo'];
const contexts = new WeakMap();
HTMLCanvasElement.prototype.getContext = function() {
	if (!contexts.has(this))
		contexts.set(this, Object.assign({ globalAlpha: 1 }, Object.fromEntries(canvasMethods.map(key => [key, noop]))));
	return contexts.get(this);
};
globalThis.Path2D = class {};
for (const method of ['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'arc', 'arcTo',
	'ellipse', 'roundRect', 'closePath', 'addPath'])
	Path2D.prototype[method] = noop;
const constructors = await Promise.all(dirs.map(async dir =>
	(await import(pathToFileURL(join(dir, 'src/uPlot.js')).href)).default));

const warmups = 4;
const repeats = 12;
const median = values => {
	const sorted = values.toSorted((a, b) => a - b);
	return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const stats = values => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) });

// Exact values and slice expression from renderAdaptive in the pinned demo.
const positives = [];
for (let exp = -3; exp < 3; exp++)
	for (let i = 1; i < 10; i++) positives.push(Number((i * 10 ** exp).toPrecision(6)));
positives.push(1000);
const demoValues = positives.slice().reverse().map(v => -v).concat(positives);
assert.equal(demoValues.length, 110);
function workload(count, distr) {
	// Expanded workloads repeat each demo value in contiguous blocks, with exact total lengths.
	const signed = Array.from({ length: count }, (_, i) => demoValues[Math.floor(i * demoValues.length / count)]);
	const data = [signed.map((_, i) => i + 1), distr === 3 ? signed.map(Math.abs) : signed];
	const slices = [-3, -1, 1, -2].map(exp => {
		const start = signed.findIndex(v => v >= 10 ** exp);
		return data.map(values => values.slice(0, values.length - start).concat(values.slice(start)));
	});
	const windows = [[0, .35], [.1, .9], [.65, 1], [0, 1]].map(([lo, hi]) => ({
		min: 1 + Math.floor(lo * (count - 1)), max: 1 + Math.floor(hi * (count - 1)),
	}));
	return { data, slices, windows };
}
function makePlot(UPlot, data, distr) {
	return new UPlot({
		width: 1600, height: 600, pxRatio: 1,
		title: 'Adaptive ArcSinh Y Scale',
		scales: { x: { time: false }, y: { distr } },
		// Keep default axes, legend, and cursor. Exclude paths, canvas calls, and recorder allocations.
		drawOrder: [],
		series: [{}, { stroke: 'blue', fill: 'rgba(0,0,255,0.1)', paths: () => null, points: { show: false } }],
	}, data, document.body);
}
function operation(u, w, kind, i) {
	if (kind === 'setData') u.setData(w.slices[i % 4]);
	else if (kind === 'panZoom') u.setScale('x', w.windows[i % 4]);
	else u.redraw(true, true);
}
function state(u) {
	const y = u.scales.y;
	return {
		ranges: [u.scales.x.min, u.scales.x.max, y.min, y.max],
		threshold: y._asinh ?? null,
		extrema: [u.series[1].min, u.series[1].max],
		idxs: [...u.series[0].idxs], bbox: { ...u.bbox },
		axes: u.axes.map(a => ({ splits: a._splits, values: a._values, size: a._size })),
		positions: [y.min, y.max, ...u.series[0].idxs.map(i => u.data[1][i])].map(v => u.valToPos(v, 'y')),
	};
}
function reference(u) {
	const [i0, i1] = u.series[0].idxs;
	let min = Infinity, max = -Infinity, minAbs = Infinity;
	for (let i = i0; i <= i1; i++) {
		const value = u.data[1][i];
		if (value == null || u.scales.y.distr === 3 && value <= 0) continue;
		min = Math.min(min, value);
		max = Math.max(max, value);
		if (Math.abs(value) > 0) minAbs = Math.min(minAbs, Math.abs(value));
	}
	return [min, max, minAbs === Infinity ? 1 : minAbs];
}
function verify(UPlot, u) {
	const expected = reference(u);
	assert.deepEqual([u.series[1].min, u.series[1].max], expected.slice(0, 2), 'Visible extrema differ from reference');
	const scan = UPlot.scan(u, 'y', ...u.series[0].idxs, false);
	assert.deepEqual(scan.slice(0, 2), expected.slice(0, 2), 'Public scan extrema differ');
	if (u.scales.y.distr === 4) {
		assert.equal(u.scales.y._asinh, expected[2], 'Adaptive threshold differs from reference');
		if (scan.length > 2) assert.equal(scan[2], expected[2], 'Fused minAbs differs');
	}
	for (const value of state(u).positions) assert(Number.isFinite(value), 'Nonfinite coordinate');
}
function checksum(u) {
	const x = u.scales.x, y = u.scales.y;
	return x.min + x.max + y.min + y.max + (y._asinh ?? 0) + u.bbox.width + u.bbox.height +
		u.series[0].idxs[0] + u.series[0].idxs[1];
}
function close(actual, expected) {
	assert(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `Checksum mismatch: ${actual} vs ${expected}`);
}
async function batch(u, w, kind, iterations) {
	let sum = 0;
	const start = performance.now();
	for (let i = 0; i < iterations; i++) {
		operation(u, w, kind, i);
		await Promise.resolve(); // Include the scheduled chart commit, not just setter/queue cost.
		sum += checksum(u);
	}
	return { us: (performance.now() - start) * 1000 / iterations, checksum: sum };
}
const results = [];
const correctness = createHash('sha256');
console.log(`${engine}; ${calibration ? 'frozen baseline A/A calibration' : 'baseline/current paired comparison'}`);
console.log(`Baseline ${baselineSHA}; ${warmups} warmup + ${repeats} measured pairs; alternating order; us/update.`);
console.log('NO DRAW: real chart update/scan/range/layout/legend + microtask, precomputed data; not browser or isolated-scan timing.');
console.log(useMin ? 'Reporting minimum batch timings and ratio of minima.' : 'Reporting medians and median paired ratios.');
for (const count of [110, 100000, 250000]) {
	for (const [scale, distr] of [['adaptive', 4], ['linear', 1], ['log', 3]]) {
		const w = workload(count, distr);
		for (const kind of ['setData', 'panZoom', 'redraw']) {
			const plots = constructors.map(UPlot => makePlot(UPlot, w.data, distr));
			try {
				await Promise.resolve();
				let cycleChecksum = 0;
				for (let step = -1; step < 4; step++) {
					if (step >= 0) {
						plots.forEach(u => operation(u, w, kind, step));
						await Promise.resolve();
					}
					plots.forEach((u, i) => verify(constructors[i], u));
					assert.deepEqual(state(plots[1]), state(plots[0]), `${count}/${scale}/${kind}/${step}: visible state changed`);
					correctness.update(JSON.stringify(state(plots[0])));
					if (step >= 0) cycleChecksum += checksum(plots[0]);
				}
				// Same iteration count for both variants; target ~15 ms using the slower pilot.
				const pilots = [];
				for (const u of plots) {
					const pilot = await batch(u, w, kind, 8);
					close(pilot.checksum, cycleChecksum * 2);
					pilots.push(pilot.us);
				}
				const iterations = Math.max(8, Math.min(512, Math.ceil(15000 / Math.max(...pilots) / 4) * 4));
				const samples = [[], []];
				for (let round = 0; round < warmups + repeats; round++) {
					for (const idx of round % 2 ? [1, 0] : [0, 1]) {
						const sample = await batch(plots[idx], w, kind, iterations);
						close(sample.checksum, cycleChecksum * iterations / 4);
						if (round >= warmups) samples[idx].push(sample.us);
					}
					await new Promise(resolve => setImmediate(resolve));
				}
				const row = {
					count, scale, operation: kind, iterations,
					setDataLengths: w.slices.map(d => d[0].length), cycleChecksum,
					us: Object.fromEntries(names.map((name, i) => [name, stats(samples[i])])),
					pairedDeltaUs: stats(samples[1].map((v, i) => v - samples[0][i])),
					pairedSpeedup: stats(samples[1].map((v, i) => samples[0][i] / v)),
					samples: Object.fromEntries(names.map((name, i) => [name, samples[i]])),
				};
				row.minSpeedup = row.us[names[0]].min / row.us[names[1]].min;
				results.push(row);
				const statistic = useMin ? 'min' : 'median';
				console.log(`${String(count).padStart(6)} ${scale.padEnd(8)} ${kind.padEnd(7)}: ` +
					`${row.us[names[0]][statistic].toFixed(2)} / ${row.us[names[1]][statistic].toFixed(2)} us; ` +
					(useMin ? `min ratio ${row.minSpeedup.toFixed(3)}x` :
						`paired ${row.pairedSpeedup.median.toFixed(3)}x; delta ${row.pairedDeltaUs.median.toFixed(2)} us`));
			}
			finally { plots.forEach(u => u.destroy()); }
		}
	}
}

// Run proxies only AFTER all timings: they can deoptimize indexed reads in the loaded modules.
async function readProbe(UPlot, distr) {
	const w = workload(4096, distr);
	let reads = 0;
	const wrap = data => [data[0], new Proxy(data[1], {
		get(target, key, receiver) {
			if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) reads++;
			return Reflect.get(target, key, receiver);
		},
	})];
	const data = wrap(w.data);
	const u = makePlot(UPlot, data, distr);
	await Promise.resolve();
	const probe = {};
	async function measure(name, fn) {
		reads = 0;
		const value = fn();
		await Promise.resolve();
		probe[name] = { reads, visibleCount: u.series[0].idxs[1] - u.series[0].idxs[0] + 1 };
		return value;
	}
	try {
		await measure('setData', () => u.setData(data));
		probe.setData.state = state(u);
		probe.scanTuple = await measure('uncachedScan', () => UPlot.scan(u, 'y', ...u.series[0].idxs, false));
		await measure('cachedScan', () => UPlot.scan(u, 'y', ...u.series[0].idxs, true));
		if (distr === 4) {
			const threshold = await measure('cachedAsinh', () => u.scales.y.asinh(u, 'y'));
			assert.equal(threshold, reference(u)[2]);
		}
		await measure('panZoom', () => u.setScale('x', w.windows[0]));
		probe.panZoom.state = state(u);
		await measure('redraw', () => u.redraw(true, true));
		await measure('redrawAgain', () => u.redraw(true, true));
		probe.redrawAgain.state = state(u);
		verify(UPlot, u);
		return probe;
	}
	finally { u.destroy(); }
}
const probes = {};
for (const [scale, distr] of [['adaptive', 4], ['linear', 1], ['log', 3]]) {
	const pair = [];
	for (const UPlot of constructors) pair.push(await readProbe(UPlot, distr));
	for (const step of ['setData', 'panZoom', 'redrawAgain'])
		assert.deepEqual(pair[1][step].state, pair[0][step].state, `Read probe state differs: ${scale}/${step}`);
	assert.deepEqual(pair[1].scanTuple.slice(0, 2), pair[0].scanTuple.slice(0, 2));
	probes[scale] = Object.fromEntries(names.map((name, i) => [name, pair[i]]));
	console.log(`${scale} Y-array reads (4096 points): ` + Object.keys(pair[0]).filter(k => k !== 'scanTuple')
		.map(k => `${k}=${pair[0][k].reads}/${pair[1][k].reads}`).join(', '));
	if (scale === 'adaptive' && args.has('--expect-fused')) {
		assert.equal(pair[1].scanTuple.length, 3, 'Expected [min, max, minAbs]');
		assert.equal(pair[1].scanTuple[2], .001);
		assert(pair[1].setData.reads < pair[0].setData.reads, 'Fused setData did not reduce Y reads');
		assert.equal(pair[1].cachedAsinh.reads, 0, 'Adaptive callback did not reuse the cached scan');
	}
}
const report = {
	schema: 1, timestamp: new Date().toISOString(), engine, versions: process.versions,
	platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCPUs: cpus().length,
	mode: calibration ? 'baseline-AA' : 'baseline-current', baselineSHA, archiveSHA256,
	harnessSHA256: sha256(readFileSync(fileURLToPath(import.meta.url))),
	lockfileSHA256: existsSync(join(root, 'package-lock.json')) ? sha256(readFileSync(join(root, 'package-lock.json'))) : null,
	sourceHashes: Object.fromEntries(names.map((name, i) => [name, sourceHashes[i]])),
	demoSHA256: sha256(readFileSync(join(baseDir, 'demos/arcsinh-scales.js'))),
	instrumentSHA256: sha256(readFileSync(join(baseDir, 'scripts/instrument.mjs'))),
	scope: 'Mode 1, one Y series, demo values/slicing; expanded values repeat in contiguous blocks. Log uses abs(Y). ' +
		'Real chart commits, default axes/legend/cursor, no drawing or recorder. Precomputed data excludes slice/control DOM costs. ' +
		'No browser rendering, path generation, isolated-scan timings, mode 2, multi-series, or custom callbacks.',
	method: { warmups, repeats, targetBatchMs: 15, maxIterations: 512, order: 'AB/BA alternating',
		statistic: useMin ? 'minimum batch us/update and ratio of first/second variant minima; no forced GC' :
		'median us/update and median paired baseline/candidate ratio; no forced GC',
		setDataThresholds: [.001, .1, 10, .01], redraw: 'redraw(true, true); unchanged data/window; cached extrema' },
	correctnessSHA256: correctness.digest('hex'), results, probes,
	elapsedSeconds: (performance.now() - started) / 1000,
};
const reportPath = join(runDir, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(`Correctness SHA256: ${report.correctnessSHA256}`);
console.log(`Report: ${reportPath}\nElapsed: ${report.elapsedSeconds.toFixed(1)} seconds`);
