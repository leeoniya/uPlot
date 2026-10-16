// Run separately: node scripts/bench-heatmap-lookup.mjs; bun scripts/bench-heatmap-lookup.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import './instrument.mjs';
import uPlot from '../src/uPlot.js';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';

const root = new URL('../', import.meta.url);
const baselineRef = '88ebc9f5fd763e9483b0fc826d4b1238ee82ca11';
const source = execFileSync('git', ['--no-pager', 'show', `${baselineRef}:demos/lib/heatmapPlugin.js`], { cwd: root, encoding: 'utf8' });
const binarySource = readFileSync(new URL('demos/lib/heatmapPlugin.js', root), 'utf8');
const generatorPath = 'demos/lib/heatmapCellsData.js';
const generatorSource = readFileSync(new URL(generatorPath, root), 'utf8');
const generatorOptions = { seed: 1, columns: 160, interval: 60000 };
const frames = generateHeatmapCells(generatorOptions);
const fixtureSource = JSON.stringify(frames);
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Compare the committed guess-based implementation with the actual working-tree binary-search implementation.
assert.ok(source.includes('function bucketAt(axis, pixel, guess, inclusive)'));
assert.ok(binarySource.includes('function bisect('));
const factories = await Promise.all([source, binarySource].map(async text =>
	(await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).heatmapPlugin));

// Rendering is neither measured nor recorded. Real uPlot scale/coordinate methods remain in use.
globalThis.Path2D = class { rect() {} };

function random(seed) {
	return () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

function describeFixture(name, cells, gridY = { distr: 3 }, minAbs = 0, xSize = 60) {
	let minY = Infinity, maxY = -Infinity, threshold = Infinity;
	const rows = new Set();
	for (let i = 0; i < cells[0].length; i++) {
		minY = Math.min(minY, cells[1][i]);
		maxY = Math.max(maxY, cells[2][i]);
		rows.add(cells[1][i]);
		for (const v of [cells[1][i], cells[2][i]]) {
			if (Math.abs(v) > minAbs) threshold = Math.min(threshold, Math.abs(v));
		}
	}
	return { name, data: [null, cells], grid: { x: { distr: 1 }, y: gridY }, minAbs, xSize,
		minY, maxY, threshold: threshold == Infinity ? 1 : threshold,
		columns: (cells[0].at(-1) - cells[0][0]) / xSize + 1, occupiedRows: rows.size };
}

function synthetic(name, columns, edges, signed = false) {
	const cells = [[], [], [], []], rng = random(0x51f15e);
	for (let col = 0; col < columns; col++) {
		for (let start = 0; start < edges.length - 1; start += 4) {
			const row = Math.min(edges.length - 2, start + Math.floor(rng() * 4));
			if (edges[row] < 0 && edges[row + 1] > 0) continue;
			cells[0].push((col + 1) * 60);
			cells[1].push(edges[row]);
			cells[2].push(edges[row + 1]);
			cells[3].push(1);
		}
	}
	return describeFixture(name, cells, signed ? { distr: 3, factor: 2 ** .25 } : { distr: 3 }, signed ? 2 ** -5 : 0);
}

const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
const field = name => frame.data.values[frame.schema.fields.findIndex(f => f.name == name)];
const generated = describeFixture('generated-160-columns', [field('xMax').map(v => v / 1000), field('yMin'), field('yMax'), field('count')],
	{ distr: 3 }, 0, frame.schema.fields.find(f => f.name == 'xMax').config.interval / 1000);
const small = synthetic('64x64', 64, Array.from({ length: 65 }, (_, i) => 2 ** (-8 + i / 32)));
const large = synthetic('1000x1000', 1000, Array.from({ length: 1001 }, (_, i) => 2 ** (-8 + i / 32)));
const positive = Array.from({ length: 65 }, (_, i) => 2 ** (-8 + i / 4));
const signed = synthetic('512x129-signed', 512, [...positive.map(v => -v).reverse(), ...positive], true);
const cases = [];
for (const fixture of [generated, small, large, signed]) {
	for (const display of fixture == signed ? ['linear', 'asinh'] : ['log', 'linear', 'asinh'])
		cases.push({ fixture, display, clipped: false });
}
for (const display of ['log', 'linear', 'asinh']) cases.push({ fixture: large, display, clipped: true });

async function mount(factory, fixture, display, clipped) {
	const [xs] = fixture.data[1];
	const fwd = display == 'log' ? Math.log : display == 'asinh' ? v => Math.asinh(v / fixture.threshold) : v => v;
	const bwd = display == 'log' ? Math.exp : display == 'asinh' ? v => Math.sinh(v) * fixture.threshold : v => v;
	const crop = (min, max) => clipped ? [min + (max - min) * .173, min + (max - min) * .827] : [min, max];
	const xRange = crop(xs[0] - fixture.xSize, xs.at(-1));
	const fullY = display == 'log' ? uPlot.rangeLog(fixture.minY, fixture.maxY, 2, true) :
		[Math.min(0, fixture.minY), fixture.maxY];
	const yRange = clipped ? crop(...fullY.map(fwd)).map(bwd) : fullY;
	const u = new uPlot({
		mode: 2, width: 1001, height: 601, pxRatio: 1.25,
		padding: [20, 20, 20, 20], axes: [{ show: false }, { show: false }], legend: { show: false },
		series: [{}, {}],
		scales: {
			x: { time: false, range: xRange },
			y: { distr: display == 'log' ? 3 : display == 'asinh' ? 4 : 1, range: yRange, asinh: fixture.threshold },
		},
		plugins: [factory({ xSize: fixture.xSize, grid: fixture.grid, minAbs: fixture.minAbs })],
	}, fixture.data, document.body);
	await Promise.resolve();
	return u;
}

function mapping(u) {
	const canvas = u.root.querySelector('canvas');
	return { x: canvas.width / u.width, y: canvas.height / u.height,
		left: parseFloat(u.over.style.left), top: parseFloat(u.over.style.top) };
}

function queries(u, profile, count) {
	const points = new Float64Array(count * 2), rng = random(0x1973b);
	const m = mapping(u), b = u.bbox;
	for (let i = 0; i < count; i++) {
		// Smooth traces move a fraction of a pixel per event; random traces stress unpredictable searches.
		const x = profile == 'smooth' ? .5 + .49 * Math.sin(i * .00071) : rng();
		const y = profile == 'smooth' ? .5 + .49 * Math.cos(i * .00093) : rng();
		points[2 * i] = (b.left + x * b.width) / m.x - m.left;
		points[2 * i + 1] = (b.top + y * b.height) / m.y - m.top;
	}
	return points;
}

function query(u, left, top) {
	u.cursor.left = left;
	u.cursor.top = top;
	return u.cursor.dataIdx(u, 1);
}

function validate(states, fixture, traces) {
	let probes = 0, hits = 0;
	const check = (left, top) => {
		const a = query(states[0], left, top), b = query(states[1], left, top);
		assert.equal(b, a, `hit mismatch at ${left}, ${top}`);
		assert.deepEqual(states[1].cursor.points.bbox(states[1], 1), states[0].cursor.points.bbox(states[0], 1));
		probes++;
		if (a != null) hits++;
	};
	const traceStats = {};
	for (const [name, points] of Object.entries(traces)) {
		const before = hits;
		for (let i = 0; i < points.length; i += 2) check(points[i], points[i + 1]);
		traceStats[name] = { queries: points.length / 2, hits: hits - before };
	}
	// Explicit painted edges, corners, near-edge points, collapsed rows, and off-plot positions.
	const u = states[0], m = mapping(u), b = u.bbox;
	const px = value => Math.max(b.left, Math.min(b.left + b.width, Math.round(u.valToPos(value, 'x', true))));
	const py = value => Math.max(b.top, Math.min(b.top + b.height, Math.round(u.valToPos(value, 'y', true))));
	const checkPixel = (x, y) => check(x / m.x - m.left, y / m.y - m.top);
	const [xs, lo, hi] = fixture.data[1];
	for (let j = 0; j < 128; j++) {
		const i = Math.floor(j * (xs.length - 1) / 127);
		const x0 = px(xs[i] - fixture.xSize), x1 = px(xs[i]);
		const y0 = py(hi[i]), y1 = py(lo[i]);
		const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
		for (const delta of [-1e-7, 0, 1e-7]) {
			checkPixel(x0 + delta, cy); checkPixel(x1 + delta, cy);
			checkPixel(cx, y0 + delta); checkPixel(cx, y1 + delta);
		}
		checkPixel(x0, y0); checkPixel(x1, y1); checkPixel(cx, cy);
	}
	checkPixel(b.left - 1, b.top); checkPixel(b.left + b.width + 1, b.top + b.height);
	checkPixel(b.left, b.top); checkPixel(b.left + b.width, b.top + b.height);
	return { probes, hits, traceStats };
}

function runner(u, points) {
	const cursor = u.cursor, lookup = cursor.dataIdx;
	return repeats => {
		let checksum = 0;
		for (let repeat = 0; repeat < repeats; repeat++) {
			for (let i = 0; i < points.length; i += 2) {
				cursor.left = points[i];
				cursor.top = points[i + 1];
				checksum += (lookup(u, 1) ?? -1) + 1;
			}
		}
		return checksum;
	};
}

const quick = process.argv.includes('--quick');
const warmup = quick ? 3 : 5, samples = quick ? 5 : 11, repeats = quick ? 1 : 4, queryCount = 8192;
const tag = process.argv.find(arg => arg.startsWith('--tag='))?.slice(6) ?? (quick ? '-quick' : '');
assert.match(tag, /^[a-zA-Z0-9_-]*$/);
const engine = process.versions.bun ? 'bun' : 'node';
const report = {
	metadata: { engine, version: process.versions.bun ?? process.version, nodeCompat: process.version,
		cpu: cpus()[0]?.model, logicalCpus: cpus().length, baselineRef,
		head: execFileSync('git', ['--no-pager', 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		sourceSha256: sha256(source), binarySha256: sha256(binarySource),
		fixtureGenerator: { path: generatorPath, options: generatorOptions, sourceSha256: sha256(generatorSource) }, fixtureSha256: sha256(fixtureSource) },
	protocol: { warmup, samples, repeats, queryCount, alternatingOrder: true, units: 'microseconds/query',
		chart: { width: 1001, height: 601, dpr: 1.25 },
		implementations: { current: 'guess-based baseline', binary: 'working-tree binary search with shared bisect helper' },
		timed: 'cursor coordinate assignments + plugin dataIdx lookup, including sparse source lookup and hit-box writes',
		excluded: 'setup, preparation, drawing, DOM reads/writes, core setCursor, events, validation, and query generation',
		notes: 'Actual core valToPos/posToVal; Happy DOM/canvas stubs used only for setup. Distinct moving queries bypass same-coordinate cache. The benchmark does not modify production source.' },
	cases: [],
};
const summarize = values => {
	const sorted = [...values].sort((a, b) => a - b);
	return { medianUs: sorted[sorted.length >> 1], p25Us: sorted[Math.floor(sorted.length * .25)],
		p75Us: sorted[Math.floor(sorted.length * .75)], samplesUs: values };
};
let sink = 0;
const started = performance.now();
for (const { fixture, display, clipped } of cases) {
	const states = [];
	try {
		for (const factory of factories) states.push(await mount(factory, fixture, display, clipped));
		const traces = Object.fromEntries(['smooth', 'random'].map(name => [name, queries(states[0], name, queryCount)]));
		const validation = validate(states, fixture, traces);
		for (const [profile, points] of Object.entries(traces)) {
			const runs = states.map(u => runner(u, points));
			const checksums = runs.map(run => run(1));
			assert.equal(checksums[0], checksums[1]);
			const times = [[], []];
			for (let round = 0; round < warmup + samples; round++) {
				for (const impl of round % 2 ? [1, 0] : [0, 1]) {
					const before = performance.now();
					const checksum = runs[impl](repeats);
					const elapsed = performance.now() - before;
					assert.equal(checksum, checksums[0] * repeats);
					sink += checksum;
					if (round >= warmup) times[impl].push(elapsed * 1000 / (queryCount * repeats));
				}
			}
			const [current, binary] = times.map(summarize);
			const row = { fixture: fixture.name, cells: fixture.data[1][0].length, columns: fixture.columns,
				occupiedRows: fixture.occupiedRows, display, clipped, profile, validation,
				checksum: checksums[0], current, binary, changePercent: (binary.medianUs / current.medianUs - 1) * 100 };
			report.cases.push(row);
			console.log(`${fixture.name} ${display}${clipped ? ' clipped' : ''} ${profile}: ${current.medianUs.toFixed(3)} -> ${binary.medianUs.toFixed(3)} us/query (${row.changePercent.toFixed(1)}%)`);
		}
	}
	finally { states.forEach(u => u.destroy()); }
}
report.elapsedMs = performance.now() - started;
report.checksum = sink;
report.validationPassed = true;
const output = new URL(`test/output/heatmap-lookup-${engine}${tag}.json`, root);
mkdirSync(new URL('test/output/', root), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Validation passed. Report: ${output.pathname}. Elapsed ${(report.elapsedMs / 1000).toFixed(1)}s.`);
