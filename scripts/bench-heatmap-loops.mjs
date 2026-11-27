// Workloads for bench-heatmap-chrome.mjs. Each candidate changes just one loop or lookup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const file = 'demos/lib/heatmapPlugin.js';
const baseline = execFileSync('git', ['--no-pager', 'show', `b708302d:${file}`], { cwd: root, encoding: 'utf8' });
const working = readFileSync(new URL(file, root), 'utf8');
function replace(text, before, after) {
	assert.equal(text.split(before).length, 2, `Review benchmark anchor: ${before}`);
	return text.replace(before, after);
}
const counts = replace(baseline, 'min = Math.min(min, count);\n\t\t\t\tmax = Math.max(max, count);',
	'if (count < min) min = count;\n\t\t\t\tif (count > max) max = count;');
const extents = replace(baseline, 'minY = Math.min(minY, yMin[start]);\n\t\t\tmaxY = Math.max(maxY, yMax[end - 1]);',
	'const lo = yMin[start], hi = yMax[end - 1];\n\t\t\tif (lo < minY) minY = lo;\n\t\t\tif (hi > maxY) maxY = hi;');
let threshold = replace(baseline, 'minAbsEdge = Math.min(minAbsEdge, -edge);', 'if (-edge < minAbsEdge) minAbsEdge = -edge;');
threshold = replace(threshold, 'if (split < end)\n\t\t\t\t\tminAbsEdge = Math.min(minAbsEdge, yMin[split]);',
	'if (split < end) {\n\t\t\t\t\tconst edge = yMin[split];\n\t\t\t\t\tif (edge < minAbsEdge) minAbsEdge = edge;\n\t\t\t\t}');
for (const edge of ['absBottom', 'absTop'])
	threshold = replace(threshold, `if (${edge} > 0)\n\t\t\t\t\t\tminAbsEdge = Math.min(minAbsEdge, ${edge});`,
		`if (${edge} > 0 && ${edge} < minAbsEdge) minAbsEdge = ${edge};`);
const projection = replace(baseline, 'i > zeroRow + 2))\n\t\t\t\tminSize = Math.min(minSize, Math.abs(pixel - previous));',
	'i > zeroRow + 2)) {\n\t\t\t\tconst size = Math.abs(pixel - previous);\n\t\t\t\tif (size < minSize) minSize = size;\n\t\t\t}');

// Numeric keys only. The hit path retrieves row ID 0 correctly in both variants.
const object = replace(replace(replace(baseline, 'const rowIds = new Map();', 'let rowIds;'),
	'rowIds.set(zeroMin, zeroRow);', 'rowIds[zeroMin] = zeroRow;'), 'rowIds.set(bottom, row);', 'rowIds[bottom] = row;')
	.replaceAll('rowIds.clear();', 'rowIds = {};');
const lookup = 'let row = rowIds.get(bottom);\n\t\t\tif (row == null) {';
const objectValue = replace(object, lookup, 'let row = rowIds[bottom];\n\t\t\tif (row == null) {');
const objectIn = replace(object, lookup, 'let row;\n\t\t\tif (bottom in rowIds) row = rowIds[bottom];\n\t\t\telse {');

let nextRow = replace(baseline, 'for (let i = 0; i < n; i++) {\n\t\t\tconst bottom = yMin[i];',
	'const seenBottoms = [];\n\t\tlet nextRow = 0;\n\t\tfor (let i = 0; i < n; i++) {\n\t\t\tconst bottom = yMin[i];');
nextRow = replace(nextRow, 'let row = rowIds.get(bottom);', 'let row = bottom === seenBottoms[nextRow] ? nextRow : rowIds.get(bottom);');
nextRow = replace(nextRow, 'rowIds.set(bottom, row);', 'rowIds.set(bottom, row);\n\t\t\t\tseenBottoms[row] = bottom;');
nextRow = replace(nextRow, 'cellRows[i] = row;', 'cellRows[i] = row;\n\t\t\tnextRow = row + 1;');

export const variants = { baseline, counts, extents, threshold, projection, objectValue, objectIn, nextRow, working };
for (const [name, src] of Object.entries(variants)) {
	// Run the same column scan in isolation, without the more expensive per-cell row lookup.
	const runs = src.match(/\t\tlet minY = Infinity,[\s\S]*?\n\t\twhile \(nextCol <= x.count\)\s+starts\[nextCol\+\+\] = n;/);
	assert.ok(runs, 'Review column scan boundaries');
	// Untimed equivalence checks and isolated timings call the actual closure functions.
	variants[name] = replace(src, '...(resolve && {setFrame}),', `...(resolve && {setFrame}),
		bench: {
			state: () => [domainMin, domainMax, x.values, y.values, starts, cellRows.subarray(0, length)],
			colors: prepareColors,
			runs() {
				const [xs, yMin, yMax] = cells, n = xs.length;
				${runs[0]}
				return minY + maxY + (signed ? minAbsEdge : 0);
			},
			project(u) {
				cellGap = .25;
				return project(u, x, 'x', u.bbox.left, u.bbox.width) + project(u, y, 'y', u.bbox.top, u.bbox.height);
			},
		},`);
}

// Runs inside Chrome. Data generation, adaptation, mounting, and checks are outside timed batches.
export async function setup(names) {
	const { generateHeatmapCells } = await import('/demos/lib/heatmapCellsData.js');
	const { heatmapCells } = await import('/demos/lib/heatmapFrameAdapters.js');
	const frame = generateHeatmapCells({ seed: 1, xGapProbability: .02 })[0];
	const { data, xSize, factor } = heatmapCells(frame, { geometric: true });
	const ordinalPlot = { data: heatmapCells(frame, { ordinal: true }).data };
	// Keep every other occupied cell so the next-row prediction almost always misses.
	const sparsePlot = { data: [null, data[1].map(col => col.filter((_, i) => i % 2 === 0))] };
	const [xs, lo, hi, counts] = data[1];
	const mirrored = [[], [], [], []];
	for (let start = 0; start < xs.length;) {
		let end = start + 1;
		while (end < xs.length && xs[end] === xs[start]) end++;
		for (let i = end - 1; i >= start; i--) add(i, -hi[i], -lo[i]);
		for (let i = start; i < end; i++) add(i, lo[i], hi[i]);
		start = end;
	}
	function add(i, bottom, top) {
		mirrored[0].push(xs[i]); mirrored[1].push(bottom); mirrored[2].push(top); mirrored[3].push(counts[i]);
	}
	const fixture = { seed: 1, xGapProbability: .02, cells: xs.length, columns: (xs.at(-1) - xs[0]) / xSize + 1,
		occupiedColumns: new Set(xs).size, distinctRows: new Set(lo).size, signedCells: mirrored[0].length };
	const colors = Array.from({ length: 24 }, (_, i) => `hsl(${i * 15} 100% 50%)`);
	const signedPlot = { data: [null, mirrored] };
	const states = {};
	for (const name of names) {
		const { heatmapPlugin } = await import(`/demos/lib/heatmap-variant-${name}.js`);
		const bounds = [], signedBounds = [];
		const record = target => (u, ...v) => { if (!target.length) target.push(...v); };
		const plugin = heatmapPlugin({ xSize, colors, onPrepare: record(bounds) });
		const ordinal = heatmapPlugin({ xSize, colors, grid: { y: { distr: 1 } } });
		const sparse = heatmapPlugin({ xSize, colors });
		const signed = heatmapPlugin({ xSize, colors, grid: { y: { distr: 3, factor } }, onPrepare: record(signedBounds) });
		let draws = 0;
		const u = new uPlot({ width: 1000, height: 560, pxRatio: 1, mode: 2, axes: [], padding: [0, 0, 0, 0],
			legend: { show: false }, scales: { x: { time: false, scan: false, range: () => [xs[0] - xSize, xs.at(-1)] },
				y: { distr: 3, log: 2, scan: false, range: () => bounds.slice(0, 2) } }, series: [{}, {}], plugins: [plugin],
			hooks: { draw: [() => draws++] },
		}, data, document.body);
		await Promise.resolve();
		signed.hooks.setData(signedPlot);
		ordinal.hooks.setData(ordinalPlot);
		sparse.hooks.setData(sparsePlot);
		states[name] = { u, plugin, signed, ordinal, sparse, bounds, signedBounds, get draws() { return draws; } };
	}
	const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
	for (const [name, s] of Object.entries(states)) {
		const base = states.baseline;
		for (const key of ['plugin', 'signed', 'ordinal', 'sparse']) {
			const a = base[key].bench.state(), b = s[key].bench.state();
			if (!a.every((v, i) => typeof v === 'number' ? Object.is(v, b[i]) : same(v, b[i]))) throw Error(`${name}: ${key} state mismatch`);
		}
		if (!same(base.bounds, s.bounds) || !same(base.signedBounds, s.signedBounds) ||
			s.plugin.bench.project(s.u) !== base.plugin.bench.project(base.u)) throw Error(`${name}: extrema mismatch`);
	}

	const quantile = (a, p) => a.slice().sort((a, b) => a - b)[Math.floor((a.length - 1) * p)];
	const rounds = 21;
	const summary = [], samples = {};
	async function stage(label, include, repeats, batch) {
		const group = names.filter(n => include.includes(n));
		if (group.length < 2) return;
		const ms = samples[label] = Object.fromEntries(group.map(n => [n, []]));
		for (let round = -5; round < rounds; round++) {
			for (let pos = 0; pos < group.length; pos++) {
				const name = group[(Math.abs(round) + pos) % group.length];
				const start = performance.now();
				await batch(states[name], repeats);
				if (round >= 0) ms[name].push((performance.now() - start) / repeats);
			}
		}
		for (const name of group) {
			const rel = ms[name].map((t, i) => 100 * (t / ms.baseline[i] - 1));
			summary.push({ stage: label, name, ms: +quantile(ms[name], .5).toFixed(4),
				'paired %': +quantile(rel, .5).toFixed(1), 'p25 %': +quantile(rel, .25).toFixed(1), 'p75 %': +quantile(rel, .75).toFixed(1) });
		}
	}
	return {
		async measure() {
			await stage('color scan', ['baseline', 'counts', 'working'], 64, ({ plugin, u }, n) => { while (n--) plugin.bench.colors(u); });
			for (const key of ['plugin', 'signed']) {
				const include = key === 'signed' ? ['baseline', 'extents', 'threshold'] : ['baseline', 'extents'];
				const expected = states.baseline[key].bench.runs();
				await stage(`${key} column scan`, include, 48, (s, n) => {
					while (n--) if (!Object.is(s[key].bench.runs(), expected)) throw Error('Column scan mismatch');
				});
			}
			await stage('prepare', names.filter(n => n !== 'projection'), 8, ({ plugin, u }, n) => { while (n--) plugin.hooks.setData(u); });
			await stage('ordinal prepare', ['baseline', 'objectValue', 'objectIn', 'nextRow', 'working'], 8, ({ ordinal }, n) => { while (n--) ordinal.hooks.setData(ordinalPlot); });
			await stage('sparse prepare', ['baseline', 'nextRow', 'working'], 12, ({ sparse }, n) => { while (n--) sparse.hooks.setData(sparsePlot); });
			await stage('signed prepare', ['baseline', 'extents', 'threshold', 'nextRow', 'working'], 4, ({ signed }, n) => { while (n--) signed.hooks.setData(signedPlot); });
			await stage('project, gap=.25', ['baseline', 'projection', 'working'], 96, ({ plugin, u }, n) => {
				let sum = 0;
				while (n--) sum += plugin.bench.project(u);
				if (!(sum > 0 && Number.isFinite(sum))) throw Error('Invalid projection');
			});
			await stage('setData + draw', ['baseline', 'working'], 2, async (s, n) => {
				const expected = s.draws + n;
				while (n--) { s.u.setData(data); await Promise.resolve(); }
				if (s.draws !== expected) throw Error('Expected one draw per update');
			});
			return { fixture, rounds, summary, samples };
		},
		profile(name) {
			const { plugin, u } = states[name];
			for (let i = 0; i < 240; i++) plugin.hooks.setData(u);
		},
	};
}
