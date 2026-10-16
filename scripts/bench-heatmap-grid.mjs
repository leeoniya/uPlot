// Node: node scripts/bench-heatmap-grid.mjs; Firefox: node scripts/bench-heatmap-grid-browser.mjs
import { heatmapPlugin } from '../demos/lib/heatmapPlugin.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const median = a => [...a].sort((a, b) => a - b)[a.length >> 1];
const colors = (() => {
	const rgb = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'].map(h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)));
	return Array.from({ length: 32 }, (_, i) => {
		const t = i / 31 * (rgb.length - 1), lo = Math.min(Math.floor(t), rgb.length - 2);
		return `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
	});
})();
const lut = new Array(3845);
for (let i = 0; i < 32; i++) lut.fill(i, i == 0 ? 0 : (2 * i - 1) ** 2, (2 * i + 1) ** 2);

function fixtures(dashboard) {
	const f = JSON.parse(dashboard.panels[0].targets[0].rawFrameContent).find(f => f.schema.meta?.type == 'heatmap-cells');
	const field = name => f.data.values[f.schema.fields.findIndex(f => f.name == name)];
	const real = [field('xMax').map(v => v / 1000), field('yMin'), field('yMax'), field('count')];
	assert(real[0].length == 15358 && f.schema.fields[0].config.interval == 60000, 'Unexpected fixture');
	let seed = 0x51f15e;
	const synthetic = [[], [], [], []], edges = Array.from({ length: 1001 }, (_, i) => 2 ** (i / 32));
	for (let col = 0; col < 1000; col++) for (let j = 0; j < 250; j++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const row = j * 4 + Math.floor(seed / 2 ** 32 * 4);
		synthetic[0].push((col + 1) * 60); synthetic[1].push(edges[row]); synthetic[2].push(edges[row + 1]); synthetic[3].push(1 + seed % 1000);
	}
	return [['fixture-15358', real], ['synthetic-250k', synthetic]].map(([name, cells]) => {
		const [xs, lo, hi, counts] = cells;
		let minY = Infinity, maxY = -Infinity, minCount = Infinity, maxCount = -Infinity;
		for (let i = 0; i < xs.length; i++) {
			minY = Math.min(minY, lo[i]); maxY = Math.max(maxY, hi[i]);
			minCount = Math.min(minCount, counts[i]); maxCount = Math.max(maxCount, counts[i]);
		}
		const step = Math.log(hi[0]) - Math.log(lo[0]), origin = Math.log(minY);
		for (let i = 0; i < xs.length; i++) {
			const row = (Math.log(lo[i]) - origin) / step;
			assert(Math.abs(row - Math.round(row)) < 1e-6 && Math.abs((Math.log(hi[i]) - Math.log(lo[i])) / step - 1) < 1e-6, `${name}: unaligned Y ${i}`);
			assert((xs[i] - xs[0]) % 60 == 0 && (i == 0 || xs[i] > xs[i - 1] || xs[i] == xs[i - 1] && lo[i] > lo[i - 1]), `${name}: unsorted/unaligned X/Y ${i}`);
			assert(Number.isFinite(counts[i]) && counts[i] > 0, `${name}: invalid count ${i}`);
		}
		const scale = 3844 / (maxCount - minCount || 1);
		return { name, data: [null, cells], minY, maxY, step, colorIdx: count => lut[Math.floor((count - minCount) * scale)] };
	});
}

// Timed Node paths retain only scalar checksums, never per-cell records.
class ChecksumPath {
	constructor() { this.count = this.sum = 0; }
	rect(x, y, w, h) { this.count++; this.sum += x + y * 3 + w * 5 + h * 7; }
}
class RawPath {
	constructor() { this.raw = []; }
	rect(...rect) { this.raw.push(...rect); }
}
function stubContext(raw = null) {
	return { checksum: 0, save() {}, restore() {}, fill(path) {
		if (raw) raw[colors.indexOf(this.fillStyle)] = path.raw;
		else this.checksum += path.sum * (colors.indexOf(this.fillStyle) + 1) + path.count;
	} };
}
function setup(factory, fixture, display, dpr, ctx, clipped = false) {
	const xs = fixture.data[1][0], fullX = [xs[0] - 60, xs.at(-1)];
	const fullY = display == 'log' ? [2 ** Math.floor(Math.log2(fixture.minY)), 2 ** Math.ceil(Math.log2(fixture.maxY))] : [0, fixture.maxY];
	const fwd = display == 'log' ? Math.log : display == 'asinh' ? v => Math.asinh(v / fixture.minY) : v => v;
	const bwd = display == 'log' ? Math.exp : display == 'asinh' ? v => Math.sinh(v) * fixture.minY : v => v;
	const crop = ([a, b]) => clipped ? [a + (b - a) * .173, a + (b - a) * .827] : [a, b];
	const ranges = { x: crop(fullX), y: crop(fullY.map(fwd)) };
	const listeners = {}, opts = { series: [{}, { show: true }], cursor: {} };
	let hover = null;
	const plugin = factory({ xSize: 60, grid: { x: { distr: 1 }, y: { distr: 3 } }, colors, colorIdx: fixture.colorIdx, onHover: (u, id) => { hover = id; } });
	const u = { data: fixture.data, series: opts.series, ctx, pxRatio: dpr, cursor: { left: -10, top: -10 },
		over: { addEventListener: (n, fn) => { listeners[n] = fn; }, removeEventListener: n => { delete listeners[n]; } },
		valToPos(value, key, canvas = false) {
			const [a, b] = ranges[key], t = ((key == 'y' ? fwd(value) : value) - a) / (b - a);
			const size = key == 'x' ? u.bbox.width : u.bbox.height, offset = key == 'x' ? u.bbox.left : u.bbox.top;
			const pos = (key == 'x' ? t : 1 - t) * size;
			return canvas ? offset + pos : pos / dpr;
		},
		posToVal(pos, key, canvas = false) {
			const [a, b] = ranges[key], size = key == 'x' ? u.bbox.width : u.bbox.height, offset = key == 'x' ? u.bbox.left : u.bbox.top;
			const t = (canvas ? pos - offset : pos * dpr) / size, value = a + (key == 'x' ? t : 1 - t) * (b - a);
			return key == 'y' ? bwd(value) : value;
		},
		setCursor(cursor) { Object.assign(u.cursor, cursor); opts.cursor.dataIdx(u); plugin.hooks.setCursor(u); },
	};
	const resize = height => {
		const half = v => Math.round(v * dpr * 2) / 2;
		u.bbox = { left: half(53.25), top: half(17.25), width: half(959.25), height: half(height) };
	};
	resize(479.25); plugin.opts(u, opts); plugin.hooks.init(u);
	return { u, opts, resize, prepare: () => plugin.hooks.setData(u), draw: () => plugin.hooks.draw(u),
		enter: () => listeners.mouseenter({ target: u.over }), leave: () => listeners.mouseleave(),
		hover: (x, y) => { u.setCursor({ left: (x - u.bbox.left) / dpr, top: (y - u.bbox.top) / dpr }); return { id: hover, box: { ...opts.cursor.points.bbox() } }; },
		destroy: () => plugin.hooks.destroy(u) };
}

function oracle(fixture, u) {
	const raw = Array.from({ length: 32 }, () => []), ids = Array.from({ length: 32 }, () => []), bounds = [];
	const [xs, lo, hi, counts] = fixture.data[1], b = u.bbox;
	const project = (v, key, offset, size) => Math.max(offset, Math.min(offset + size, Math.round(u.valToPos(v, key, true))));
	for (let id = 0; id < xs.length; id++) {
		const x0 = project(xs[id] - 60, 'x', b.left, b.width), x1 = project(xs[id], 'x', b.left, b.width);
		const y0 = project(hi[id], 'y', b.top, b.height), y1 = project(lo[id], 'y', b.top, b.height);
		if (x1 > x0 && y1 > y0) {
			const color = fixture.colorIdx(counts[id]);
			raw[color].push(x0, y0, x1 - x0, y1 - y0); ids[color].push(id); bounds.push([id, x0, y0, x1, y1]);
		}
	}
	return { raw, ids, bounds };
}
function fingerprint(raw) {
	let hash = 2166136261;
	return raw.map((values, color) => {
		for (const v of [color, values.length]) hash = Math.imul(hash ^ v, 16777619) >>> 0;
		for (const v of values) hash = Math.imul(hash ^ (v * 2), 16777619) >>> 0;
		return { count: values.length / 4, checksum: hash.toString(16) };
	});
}
function validate(factories, fixture, display, dpr, clipped) {
	const saved = globalThis.Path2D, failures = [], raw = factories.map(() => []);
	const fail = details => { if (failures.length < 8) failures.push(details); };
	globalThis.Path2D = RawPath;
	const states = factories.map((factory, i) => setup(factory, fixture, display, dpr, stubContext(raw[i]), clipped));
	let geometryMismatches = 0, hoverMismatches = 0, probes = [];
	try {
		for (const s of states) { s.prepare(); s.draw(); s.enter(); }
		const expected = oracle(fixture, states[0].u), b = states[0].u.bbox;
		for (let impl = 0; impl < states.length; impl++) for (let c = 0; c < 32; c++) {
			const actual = raw[impl][c], wanted = expected.raw[c];
			for (let p = 0; p < Math.max(actual.length, wanted.length); p += 4) {
				if ([0, 1, 2, 3].some(k => actual[p + k] !== wanted[p + k])) {
					geometryMismatches++; fail({ kind: 'rect', impl, color: c, sourceID: expected.ids[c][p / 4], actual: actual.slice(p, p + 4), expected: wanted.slice(p, p + 4) });
				}
			}
		}
		for (let i = 0; i < 8 && expected.bounds.length > 0; i++) {
			const [, x0, y0, x1, y1] = expected.bounds[Math.floor(i * (expected.bounds.length - 1) / 7)];
			const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
			probes.push([cx, cy], [x0, cy], [x1, cy], [cx, y0], [cx, y1], [x0, y0], [x1, y1], [x0 - 1e-6, cy], [cx, y1 + 1e-6]);
		}
		probes.push([b.left - 1, b.top], [b.left, b.top], [b.left + b.width, b.top + b.height]);
		for (let i = 0; i < 16; i++) probes.push([b.left + b.width * (i + .37) / 16, b.top + b.height * ((i * 7) % 16 + .61) / 16]);
		for (const [x, y] of probes) {
			let winner = null;
			for (const cell of expected.bounds) if (x >= cell[1] && y >= cell[2] && x <= cell[3] && y <= cell[4]) winner = cell;
			const id = winner?.[0] ?? null;
			const box = winner ? { left: (winner[1] - b.left) / dpr, top: (winner[2] - b.top) / dpr, width: (winner[3] - winner[1]) / dpr, height: (winner[4] - winner[2]) / dpr } : { left: -10, top: -10, width: 0, height: 0 };
			for (let impl = 0; impl < states.length; impl++) {
				const actual = states[impl].hover(x, y);
				if (actual.id !== id || Object.keys(box).some(k => actual.box[k] !== box[k])) {
					hoverMismatches++; fail({ kind: 'hover', impl, x, y, actual, expected: { id, box }, source: id == null ? null : fixture.data[1].map(a => a[id]) });
				}
			}
		}
		return { dpr, clipped, bbox: b, probes: probes.length, visible: expected.bounds.length, geometryMismatches, hoverMismatches, failures,
			passed: geometryMismatches + hoverMismatches == 0, colors: raw.map(fingerprint) };
	}
	finally { states.forEach(s => s.destroy()); globalThis.Path2D = saved; }
}

export function runBenchmark(baselineFactory, dashboard, metadata = {}) {
	const browser = typeof document != 'undefined', saved = globalThis.Path2D, start = performance.now();
	const report = { metadata, environment: { runtime: browser ? navigator.userAgent : process.version, renderer: browser ? 'real Canvas/Path2D submissions, not presentation' : 'checksum Path2D stub; no rendering' },
		protocol: { warmup: 3, samples: 9, alternatingOrder: true, timedDpr: 1, validationDpr: [1, 2], xSize: 60, grid: { x: { distr: 1 }, y: { distr: 3 } }, syntheticSeed: '0x51f15e', synthetic: '1000 columns; one row per group of four of 1000 Y buckets; 2**(1/32) edges',
			notes: 'Steady-state setData alone; redraw outside excludes old finish; redraw inside includes old finish. Resize changes mock bbox height and draws inside, not uPlot layout. No validation or readback timed. Canvas is not cleared between draws. Single hook call per sample; GC included. Palette/LUT shared.' }, cases: [] };
	const factories = [baselineFactory, heatmapPlugin];
	try {
		for (const fixture of fixtures(dashboard)) for (const display of ['log', 'linear', 'asinh']) {
			const validation = [1, 2].flatMap(dpr => [false, true].map(clipped => validate(factories, fixture, display, dpr, clipped)));
			globalThis.Path2D = browser ? saved : ChecksumPath;
			const states = factories.map(factory => {
				let ctx;
				if (browser) { const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 800; document.body.append(canvas); ctx = canvas.getContext('2d'); }
				else ctx = stubContext();
				return setup(factory, fixture, display, 1, ctx);
			});
			const measurements = {};
			for (const s of states) s.prepare();
			for (const phase of ['prepare', 'redrawOutside', 'redrawInside', 'resizeInside']) {
				for (const s of states) {
					s.resize(479.25); s.leave(); s.u.cursor.left = s.u.cursor.top = -10;
					if (phase.endsWith('Inside')) { s.u.cursor.left = 480.125; s.u.cursor.top = 200.125; s.enter(); }
				}
				const samples = [[], []];
				for (let round = 0; round < 12; round++) for (const impl of round % 2 ? [1, 0] : [0, 1]) {
					assert(performance.now() - start < 230000, 'Benchmark exceeded 230s work budget');
					const s = states[impl], t = performance.now();
					if (phase == 'prepare') s.prepare();
					else { if (phase == 'resizeInside') s.resize([359.25, 479.25, 639.25][round % 3]); s.draw(); }
					const elapsed = performance.now() - t;
					if (round >= 3) samples[impl].push(elapsed);
				}
				measurements[phase] = Object.fromEntries(['baseline', 'grid'].map((name, i) => [name, { medianMs: median(samples[i]), minMs: Math.min(...samples[i]), maxMs: Math.max(...samples[i]), samplesMs: samples[i] }]));
			}
			report.cases.push({ name: fixture.name, cells: fixture.data[1][0].length, display, asinhThreshold: fixture.minY, yLogStep: fixture.step, validation, measurements,
				nodeChecksums: browser ? null : states.map(s => s.u.ctx.checksum) });
			for (const s of states) { s.destroy(); if (browser) s.u.ctx.canvas.remove(); }
		}
		report.elapsedMs = performance.now() - start;
		report.validationPassed = report.cases.every(c => c.validation.every(v => v.passed));
		return report;
	}
	finally { globalThis.Path2D = saved; }
}

export async function loadInputs() {
	const { execFileSync } = await import('node:child_process'), { readFileSync } = await import('node:fs'), { createHash } = await import('node:crypto');
	const cwd = new URL('../', import.meta.url), git = args => execFileSync('git', ['--no-pager', ...args], { cwd, encoding: 'utf8' });
	const baselineRef = git(['rev-parse', '6c1c7e8c']).trim();
	const baselineSource = git(['show', `${baselineRef}:demos/lib/heatmapPlugin.js`]);
	assert(baselineSource.includes("import Flatbush from './flatbush.js'"), 'Baseline must contain the original Flatbush plugin');
	const currentSource = readFileSync(new URL('../demos/lib/heatmapPlugin.js', import.meta.url), 'utf8');
	const flatbushSource = readFileSync(new URL('../demos/lib/flatbush.js', import.meta.url), 'utf8');
	const fixtureSource = readFileSync(new URL('../demos/data/heatmap-cells-exemplars.json', import.meta.url), 'utf8');
	const sha256 = text => createHash('sha256').update(text).digest('hex');
	return { baselineSource, currentSource, flatbushSource, fixtureSource, metadata: { head: git(['rev-parse', 'HEAD']).trim(), baselineRef, baselineSha256: sha256(baselineSource), currentSha256: sha256(currentSource), flatbushSha256: sha256(flatbushSource), fixtureSha256: sha256(fixtureSource) } };
}
export function printReport(report) {
	console.log(report.environment, 'Validation:', report.validationPassed);
	console.table(report.cases.flatMap(c => Object.entries(c.measurements).map(([phase, m]) => ({ case: c.name, display: c.display, phase, baselineMs: +m.baseline.medianMs.toFixed(3), gridMs: +m.grid.medianMs.toFixed(3), speedup: +(m.baseline.medianMs / m.grid.medianMs).toFixed(2) }))));
	for (const c of report.cases) for (const v of c.validation) if (!v.passed) console.log(JSON.stringify({ case: c.name, display: c.display, ...v, colors: undefined }));
}
if (typeof process != 'undefined' && process.argv[1] && import.meta.url == (await import('node:url')).pathToFileURL(process.argv[1]).href) {
	const inputs = await loadInputs();
	const source = inputs.baselineSource.replace("'./flatbush.js'", JSON.stringify(new URL('../demos/lib/flatbush.js', import.meta.url).href));
	const baseline = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
	const report = runBenchmark(baseline.heatmapPlugin, JSON.parse(inputs.fixtureSource), inputs.metadata);
	const { mkdirSync, writeFileSync } = await import('node:fs');
	mkdirSync(new URL('../test/output/', import.meta.url), { recursive: true });
	writeFileSync(new URL('../test/output/heatmap-grid-node.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
	printReport(report);
	console.log('Report: test/output/heatmap-grid-node.json');
	if (!report.validationPassed) process.exitCode = 1;
}
