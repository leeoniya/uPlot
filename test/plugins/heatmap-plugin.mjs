import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { rangeY } from '../../src/rangeY.js';
import { heatmapPlugin } from '../../demos/lib/heatmapPlugin.js';
import { createDemo } from '../../demos/heatmap-cells.js';
import Flatbush from '../../demos/lib/flatbush.js';

function linearDemoBounds(u, min, max) {
	const result = rangeY(min, max, u.bbox.height / u.pxRatio);
	return [result?.min ?? null, result?.max ?? null];
}

const empty = () => [null, [[], [], [], []]];
const enter = u => u.over.dispatchEvent(new MouseEvent('mouseenter'));
const leave = u => u.over.dispatchEvent(new MouseEvent('mouseleave'));
const lastDraw = u => u.ctx.log.slice(u.ctx.log.findLastIndex(e => e[0] === 'clearRect'));
const fills = u => lastDraw(u).filter(e => e[0] === 'fill').flatMap(e => e.slice(1))
	.map(args => args[0]).filter(path => path?.log != null);
const pathRects = path => path.log.flatMap(e => e[0] === 'rect' ? e.slice(1) : []);
const rects = u => fills(u).flatMap(pathRects);

// Normalize vertical coverage only; keep column widths, gaps, and overlaps observable.
function coverage(rectangles) {
	const result = [];
	for (const [x, y, w, h] of rectangles.slice().sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1])) {
		assert.ok(w > 0 && h > 0, 'drawn rectangles have positive area');
		const previous = result.at(-1);
		if (previous && previous[0] == x && previous[2] == w && previous[1] + previous[3] == y)
			previous[3] += h;
		else
			result.push([x, y, w, h]);
	}
	return result;
}

const backward = ({ distr, asinh = 1 }, v) => distr == 3 ? Math.exp(v) : distr == 4 ? Math.sinh(v) * asinh : v;


// Every fixture is sorted by column, then row. Missing buckets do not change the progression.
function fixture({ x = { distr: 1 }, y = { distr: 3 }, nx = 7, ny = 6,
	xOrigin = 0, yOrigin = 0, xSize = 1, ySize = Math.log(2),
	include = (col, row) => col != 2 && row != 2 && (col + row) % 4 != 1,
	count = (col, row, id) => id + 1 } = {}) {
	const xEdges = Array.from({ length: nx + 1 }, (_, i) => backward(x, xOrigin + i * xSize));
	const yEdges = Array.from({ length: ny + 1 }, (_, i) => backward(y, yOrigin + i * ySize));
	const data = empty(), cells = [];
	for (let col = 0; col < nx; col++) {
		for (let row = 0; row < ny; row++) {
			if (!include(col, row))
				continue;
			const id = cells.length;
			cells.push({ col, row });
			const value = count(col, row, id);
			assert.ok(value > 0 && Number.isFinite(value), 'fixtures must omit empty buckets and supply finite positive counts');
			[xEdges[col + 1], yEdges[row], yEdges[row + 1], value]
				.forEach((v, facet) => data[1][facet].push(v));
		}
	}
	return { data, cells, xEdges, yEdges, xSize, grid: { x, y } };
}

// Explicit boundaries keep signed-grid expectations independent of the plugin's logarithmic row IDs.
function edgeFixture(yEdges, gridY, include = (col, row) => col != 2 && (col + row) % 4 != 1, nx = 5) {
	const xEdges = Array.from({ length: nx + 1 }, (_, i) => i);
	const data = empty(), cells = [];
	for (let col = 0; col < nx; col++) {
		for (let row = 0; row < yEdges.length - 1; row++) {
			if (gridY.factor != null && yEdges[row] < 0 && yEdges[row + 1] > 0) continue;
			if (!include(col, row)) continue;
			cells.push({ col, row });
			[xEdges[col + 1], yEdges[row], yEdges[row + 1], cells.length]
				.forEach((v, facet) => data[1][facet].push(v));
		}
	}
	return { data, cells, xEdges, yEdges, xSize: 1, grid: { x: { distr: 1 }, y: gridY } };
}

function sourceFixture(data, xSize) {
	const [xs, lo, hi] = data[1];
	const xEdges = [...new Set(xs.flatMap(v => [v - xSize, v]))].sort((a, b) => a - b);
	const yEdges = [...new Set([...lo, ...hi])].sort((a, b) => a - b);
	const cells = xs.map((v, i) => ({ col: xEdges.indexOf(v - xSize), row: yEdges.indexOf(lo[i]) }));
	return { data, xEdges, yEdges, cells };
}

function signedEdges(factor = 2, first = -4, last = 4) {
	const positive = [];
	for (let exponent = first; exponent <= last; exponent++)
		positive.push(factor ** exponent);
	return [...positive.map(v => -v).reverse(), ...positive];
}

function close(actual, expected, tolerance = 1e-9) {
	assert.equal(actual.length, expected.length);
	actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${actual} != ${expected}`));
}

function projectedRect(u, x0, x1, y0, y1) {
	const { left, top, width, height } = u.bbox;
	const px = v => Math.max(left, Math.min(left + width, Math.round(u.valToPos(v, 'x', true))));
	const py = v => Math.max(top, Math.min(top + height, Math.round(u.valToPos(v, 'y', true))));
	return [px(x0), py(y1), px(x1) - px(x0), py(y0) - py(y1)];
}

// The oracle uses the fixture's explicit edges, not plugin row IDs, paths, or lookup results.
function oracleRects(u, f, minAbs = 0) {
	const { left, top, width, height } = u.bbox;
	const xs = f.xEdges.map(v => Math.max(left, Math.min(left + width, Math.round(u.valToPos(v, 'x', true)))));
	const ys = f.yEdges.map(v => Math.max(top, Math.min(top + height, Math.round(u.valToPos(v, 'y', true)))));
	return f.cells.map(({ col, row }, id) => ({ id,
		rect: Math.max(Math.abs(f.yEdges[row]), Math.abs(f.yEdges[row + 1])) <= minAbs ? null :
			[xs[col], ys[row + 1], xs[col + 1] - xs[col], ys[row] - ys[row + 1]],
	})).filter(({ rect }) => rect != null && rect[2] > 0 && rect[3] > 0);
}

function oracleHit(boxes, px, py) {
	// Reverse source order implements last-source precedence without scanning past a hit.
	for (let i = boxes.length - 1; i >= 0; i--) {
		const { id, rect } = boxes[i];
		if (px >= rect[0] && px <= rect[0] + rect[2] && py >= rect[1] && py <= rect[1] + rect[3])
			return id;
	}
	return null;
}

function canvasMapping(u) {
	if (u.root == null)
		return { x: 1, y: 1, left: 0, top: 0 };
	const canvas = u.root.querySelector('canvas');
	return {
		x: canvas.width / parseFloat(canvas.parentNode.style.width),
		y: canvas.height / parseFloat(canvas.parentNode.style.height),
		left: parseFloat(u.over.style.left),
		top: parseFloat(u.over.style.top),
	};
}

function pixelQuery(u, px, py, expected, mapping = canvasMapping(u)) {
	u.cursor.left = px / mapping.x - mapping.left;
	u.cursor.top = py / mapping.y - mapping.top;
	const actual = u.cursor.dataIdx(u, 1);
	assert.equal(actual, expected, actual === expected ? undefined : `canvas (${px}, ${py})`);
}

function checkOracle(u, f, minAbs = 0) {
	const boxes = oracleRects(u, f, minAbs);
	assert.deepEqual(coverage(rects(u)), coverage(boxes.map(b => b.rect)), 'exact rounded, clipped source-cell coverage');
	const probes = [];
	for (const { rect: [x, y, w, h] } of boxes) {
		probes.push([x + w / 2, y + h / 2]);
		for (const delta of [-1e-7, 0, 1e-7]) {
			probes.push([x + delta, y + h / 2], [x + w + delta, y + h / 2],
				[x + w / 2, y + delta], [x + w / 2, y + h + delta]);
		}
		probes.push([x, y], [x + w, y], [x, y + h], [x + w, y + h]);
	}
	// Probe excluded cells explicitly, including their shared edges with retained cells.
	for (const { col, row } of f.cells) {
		if (Math.max(Math.abs(f.yEdges[row]), Math.abs(f.yEdges[row + 1])) <= minAbs) {
			const [x, y, w, h] = projectedRect(u, f.xEdges[col], f.xEdges[col + 1], f.yEdges[row], f.yEdges[row + 1]);
			if (w > 0 && h > 0)
				probes.push([x + w / 2, y + h / 2], [x + w / 2, y], [x + w / 2, y + h]);
		}
	}
	// Sample gaps and offscreen regions as well as occupied edges.
	for (let ix = -1; ix <= 18; ix++) {
		for (let iy = -1; iy <= 14; iy++)
			probes.push([u.bbox.left + ix * u.bbox.width / 17, u.bbox.top + iy * u.bbox.height / 13]);
	}
	// Geometry is fixed during these probes; refresh the reference on every checkOracle call.
	const mapping = canvasMapping(u);
	const hidden = { left: -10, top: -10, width: 0, height: 0 };
	const hoverBoxes = [];
	for (const { id, rect: [l, t, w, h] } of boxes)
		hoverBoxes[id] = { left: l / mapping.x - mapping.left, top: t / mapping.y - mapping.top,
			width: w / mapping.x, height: h / mapping.y };
	for (const [px, py] of probes) {
		// Match the CSS-to-canvas round trip, including rounded canvas dimensions.
		const x = (mapping.left + (px / mapping.x - mapping.left)) * mapping.x;
		const y = (mapping.top + (py / mapping.y - mapping.top)) * mapping.y;
		const expected = oracleHit(boxes, x, y);
		pixelQuery(u, px, py, expected, mapping);
		const box = u.cursor.points.bbox(u, 1);
		assert.deepEqual(box, expected == null ? hidden : hoverBoxes[expected]);
	}
}

function hover(u, x, y, id) {
	u.setCursor({ left: u.valToPos(x, 'x'), top: u.valToPos(y, 'y') });
	assert.equal(u.cursor.dataIdx(u, 1), id);
}

function bounds(u, idx, canvas = false, xSize = 1) {
	const [x, lo, hi] = u.data[1];
	const rect = projectedRect(u, x[idx] - xSize, x[idx], lo[idx], hi[idx]);
	const mapping = canvasMapping(u);
	return canvas ? rect : [rect[0] / mapping.x - mapping.left, rect[1] / mapping.y - mapping.top,
		rect[2] / mapping.x, rect[3] / mapping.y];
}

function createDemoRoot() {
	const html = readFileSync(new URL('../../demos/heatmap-cells.html', import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

function framesFor(values) {
	return [{ schema: { meta: { type: 'heatmap-cells' },
		fields: ['xMax', 'yMin', 'yMax', 'count'].map(name => ({ name, config: name == 'xMax' ? { interval: 60000 } : {} })) },
		data: { values } }];
}

function sparseFrames() {
	const xs = [], lo = [], hi = [], counts = [];
	// Half-octave rows with holes, fractional counts, and an upper edge between log ticks.
	for (let col = 0; col < 8; col++) {
		for (let row = 0; row < 23; row++) {
			if ((col + row) % 5 == 2) continue;
			xs.push((col + 1) * 60000);
			lo.push(2 ** (-16 + row / 2));
			hi.push(2 ** (-16 + (row + 1) / 2));
			counts.push((1 + (col * 23 + row) % 32) / 285);
		}
	}
	return framesFor([xs, lo, hi, counts]);
}

const demoMinAbs = 2 ** -128;
const colorLabels = { linear: 'Count · linear scale', sqrt: 'Count · √ scale', cbrt: 'Count · ∛ scale', log: 'Count · log scale' };
const colorModes = Object.keys(colorLabels);

// Independent reference: retain only the snapped transitions, not a lookup table.
function approximateLogTransitions(min, max) {
	const n = 23, logRange = Math.log(max) - Math.log(min), step = logRange / n;
	const base = 4 * n * n, range = Math.expm1(logRange);
	const minGap = Math.exp(step / 2) * Math.expm1(step) / range;
	const intervals = base * Math.max(1, Math.ceil(1 / minGap / base)) * 4;
	assert.ok(intervals <= 2 ** 24);
	const transitions = Array.from({ length: n }, (_, i) => Math.ceil(Math.expm1(step * (i + .5)) / range * intervals));
	return { intervals, transitions };
}

function demoColorIndex(count, mode, min, max) {
	if (min == max) return 0;
	if (mode == 'log') {
		const { intervals, transitions } = approximateLogTransitions(min, max);
		const j = Math.floor((count - min) * (intervals / (max - min)));
		const color = transitions.filter(edge => edge <= j).length;
		const exact = Math.round(23 * (Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min)));
		assert.ok(Math.abs(color - exact) <= 1, `count ${count}: approximate ${color}, exact ${exact}`);
		return color;
	}
	const t = (count - min) / (max - min);
	return Math.round(23 * (mode == 'sqrt' ? Math.sqrt(t) : mode == 'cbrt' ? Math.cbrt(t) : t));
}

function colorBoundaryCounts(mode, min, max) {
	const counts = Array.from({ length: 23 }, (_, j) => {
		const t = (j + .5) / 23;
		const position = mode == 'sqrt' ? t * t : mode == 'cbrt' ? t ** 3 : t;
		const edge = mode == 'log' ? min * Math.exp((Math.log(max) - Math.log(min)) * (j + .5) / 23) : min + (max - min) * position;
		// Exact ties can differ by a few ulps between the direct and inverse formulas.
		const eps = (mode == 'log' ? edge : max - min) * 1e-12;
		return [edge - eps, edge + eps];
	}).flat();
	if (mode == 'log') {
		// Probe true-log boundaries above and snapped transitions below; both use the approximate drawing oracle.
		const { intervals, transitions } = approximateLogTransitions(min, max);
		counts.push(...transitions.flatMap(edge => [edge - 1e-7, edge, edge + 1e-7].map(j => min + (max - min) * j / intervals)));
	}
	return counts;
}

function checkDemoColors(u, mode, min, max) {
	const expected = Array.from({ length: 24 }, () => []);
	u.data[1][3].forEach((count, i) => {
		if (Math.max(Math.abs(u.data[1][1][i]), Math.abs(u.data[1][2][i])) <= demoMinAbs) return;
		const rect = bounds(u, i, true, 60);
		if (rect[2] > 0 && rect[3] > 0)
			expected[demoColorIndex(count, mode, min, max)].push(rect);
	});
	const paths = fills(u).slice(-24);
	assert.equal(paths.length, 24);
	paths.forEach((path, color) => assert.deepEqual(coverage(pathRects(path)), coverage(expected[color]), `${mode} palette index ${color}`));
}

function withoutColorMath(fn) {
	const names = ['log', 'log1p', 'sqrt', 'cbrt', 'exp', 'expm1'];
	const originals = names.map(name => Math[name]);
	try {
		for (const name of names)
			Math[name] = () => { throw new Error(`Color selection/drawing must reuse setup tables, not compute Math.${name}`); };
		return fn();
	}
	finally { names.forEach((name, i) => { Math[name] = originals[i]; }); }
}

// Isolate plugin work from uPlot's own scans, projections, cursor updates, and allocations.
function isolated(options, data = empty(), over = document.createElement('div')) {
	const plugin = heatmapPlugin(options);
	const drawn = [], projected = { x: [], y: [] }, inverted = { x: [], y: [] };
	// Keep DOM implementation caches outside the plugin-only Map assertions.
	Object.defineProperty(over, 'style', { value: { left: '0px', top: '0px' }, configurable: true });
	const u = { data, width: 100, height: 100, pxRatio: 1, bbox: { left: 0, top: 0, width: 100, height: 100 },
		series: [{}, { show: true }], over, cursor: { left: -10, top: -10 },
		scales: { y: { distr: 1, get clamp() { throw new Error('Plugin must not access scale.clamp'); } } },
		ctx: { save() {}, restore() {}, fill(path) { drawn.push(path); } },
		valToPos(value, key) { projected[key].push(value); return key == 'x' ? value : 100 - value; },
		posToVal(value, key) { inverted[key].push(value); return key == 'x' ? value : 100 - value; },
		setCursor() {},
	};
	const opts = { series: [{}, {}] };
	plugin.opts(u, opts);
	Object.assign(u.cursor, opts.cursor);
	plugin.hooks.init(u);
	return { u, plugin, drawn, projected, inverted };
}

function trackTyped(run) {
	const allocations = [];
	const names = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array'];
	const constructors = names.map(name => globalThis[name]);
	try {
		names.forEach((name, i) => {
			globalThis[name] = class extends constructors[i] {
				constructor(...args) { super(...args); allocations.push([name, this]); }
				set() { throw new Error('Preparation must not copy old typed-buffer entries'); }
			};
		});
		run(allocations);
	}
	finally { names.forEach((name, i) => { globalThis[name] = constructors[i]; }); }
	return allocations;
}

function withoutIndexes(run, allowMaps = false) {
	const MapClass = globalThis.Map;
	const methods = ['get', 'set', 'has'];
	const originals = methods.map(name => MapClass.prototype[name]);
	const descriptor = Object.getOwnPropertyDescriptor(Flatbush.prototype, 'numItems');
	const fail = () => { throw new Error('Heatmap must not create or use Map/Flatbush indexes'); };
	try {
		if (!allowMaps) {
			globalThis.Map = class { constructor() { fail(); } };
			methods.forEach(name => { MapClass.prototype[name] = fail; });
		}
		// Flatbush's constructor assigns numItems before allocating its packed buffers.
		Object.defineProperty(Flatbush.prototype, 'numItems', { configurable: true, set: fail });
		run();
	}
	finally {
		globalThis.Map = MapClass;
		methods.forEach((name, i) => { MapClass.prototype[name] = originals[i]; });
		if (descriptor) Object.defineProperty(Flatbush.prototype, 'numItems', descriptor);
		else delete Flatbush.prototype.numItems;
	}
}

describe('heatmapPlugin uniform grid', () => {
	let plots;
	beforeEach(() => { plots = []; });
	afterEach(() => { plots.forEach(u => u.destroy()); });

	async function mount(f = fixture(), pxRatio = 1, options = {}, display = {}) {
		const u = new uPlot({
			mode: 2, width: 600, height: 360, pxRatio,
			padding: [20, 30, 20, 30], axes: [{ show: false }, { show: false }], legend: { show: false },
			series: [{}, {}],
			scales: {
				x: { time: false, auto: false, min: f.xEdges[0], max: f.xEdges.at(-1), ...f.grid.x, ...display.x },
				y: { auto: false, min: f.yEdges[0], max: f.yEdges.at(-1), ...f.grid.y, ...display.y },
			},
			plugins: [heatmapPlugin({ xSize: f.xSize, grid: f.grid, ...options })],
		}, f.data, document.body);
		plots.push(u);
		await Promise.resolve();
		return u;
	}

	function checkGap(u, f, gap, minAbs = 0) {
		const mapping = canvasMapping(u);
		const boxes = oracleRects(u, f, minAbs);
		const gapX = gap * mapping.x, gapY = gap * mapping.y;
		const minSpan = (edges, key, start, end) => {
			const pixels = edges.map(value => Math.round(u.valToPos(value, key, true)));
			const spans = edges.slice(1).map((value, i) => {
				if (pixels[i] < start || pixels[i] > end || pixels[i + 1] < start || pixels[i + 1] > end ||
					key == 'y' && Math.max(Math.abs(edges[i]), Math.abs(value)) <= minAbs) return Infinity;
				return Math.abs(pixels[i + 1] - pixels[i]) || Infinity;
			});
			return Math.min(...spans);
		};
		const minWidth = minSpan(f.xEdges, 'x', u.bbox.left, u.bbox.left + u.bbox.width);
		const minHeight = minSpan(f.yEdges, 'y', u.bbox.top, u.bbox.top + u.bbox.height);
		if (!Number.isFinite(minWidth + minHeight) || minWidth <= gapX || minHeight <= gapY ||
			(minWidth - gapX) * (minHeight - gapY) < .9 * minWidth * minHeight) {
			checkOracle(u, f, minAbs);
			return;
		}
		const expected = boxes.filter(({ rect: [, , w, h] }) => w > gapX && h > gapY)
			.map(({ rect: [x, y, w, h] }) => [x + gapX / 2, y + gapY / 2, w - gapX, h - gapY]);
		const actual = rects(u);
		assert.equal(actual.length, expected.length, 'gapped cells remain separate even with the same color');
		actual.forEach((rect, i) => close(rect, expected[i]));
		let retainedBox;
		for (const { rect: [x, y, w, h] } of boxes) {
			for (const [px, py] of [[x + w / 2, y + h / 2], [x + Math.min(w / 4, gapX / 4), y + h / 2],
				[x + w / 2, y + Math.min(h / 4, gapY / 4)], [x, y], [x + w, y + h]]) {
				const canX = (mapping.left + (px / mapping.x - mapping.left)) * mapping.x;
				const canY = (mapping.top + (py / mapping.y - mapping.top)) * mapping.y;
				const id = oracleHit(boxes, canX, canY);
				pixelQuery(u, px, py, id, mapping);
				if (id == null) continue;
				const box = u.cursor.points.bbox(u, 1);
				retainedBox ??= box;
				assert.equal(box, retainedBox, 'hover reuses the existing bounds object');
				const { rect: [left, top, width, height] } = boxes.find(b => b.id == id);
				const inset = width > gapX && height > gapY ? gap : 0;
				close([box.left, box.top, box.width, box.height], [
					left / mapping.x - mapping.left + inset / 2, top / mapping.y - mapping.top + inset / 2,
					width / mapping.x - inset, height / mapping.y - inset,
				]);
			}
		}
	}

	it('rejects negative and nonfinite cell gaps', () => {
		for (const cellGap of [-1, NaN, Infinity, -Infinity, '1', null])
			assert.throws(() => heatmapPlugin({ xSize: 1, cellGap }), /cellGap must be a finite, nonnegative number/);
	});

	it('reads a dynamic cellGap once per draw, not during hover', () => {
		const f = fixture({ nx: 1, ny: 2, y: { distr: 1 }, ySize: 1, include: () => true });
		let gap = 0, calls = 0;
		const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, cellGap: plot => {
			assert.equal(plot, u);
			calls++;
			return gap;
		} }, f.data);
		try {
			plugin.hooks.setData(u);
			u.valToPos = (v, key) => key == 'x' ? v * 10 : 100 - v * 10;
			for (const value of [0, .25, .5, 0]) {
				gap = value;
				drawn.length = 0;
				const before = calls;
				plugin.hooks.draw(u);
				assert.equal(calls, before + 1);
				assert.equal(drawn.flatMap(pathRects).length, gap == 0 ? 1 : 2);
				pixelQuery(u, .1, 99.5, 0);
				pixelQuery(u, .9, 99.5, 0);
				assert.equal(calls, before + 1);
			}
			gap = NaN;
			assert.throws(() => plugin.hooks.draw(u), /cellGap must be a finite, nonnegative number/);
		}
		finally { plugin.hooks.destroy(); }
	});

	it('uses one area decision for the entire draw and restores numeric gap settings as cells grow', () => {
		const f = fixture({ nx: 2, ny: 2, y: { distr: 1 }, ySize: 1, include: () => true });
		for (const ratio of [1, 2]) {
			for (const gap of [.25, .5, 1]) {
				const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, cellGap: gap }, f.data);
				try {
					u.pxRatio = ratio;
					u.bbox.width = u.bbox.height = 100 * ratio;
					plugin.hooks.setData(u);
					for (const [w, h] of [[1, 20], [20, 1], [5, 5], [10, 10], [2, 2], [20, 20]]) {
						u.valToPos = (v, key) => (key == 'x' ? v * w : 100 - v * h) * ratio;
						drawn.length = 0;
						plugin.hooks.draw(u);
						const enabled = w > gap && h > gap && (w - gap) * (h - gap) >= .9 * w * h;
						const rects = drawn.flatMap(pathRects);
						assert.equal(rects.length, enabled ? 4 : 2, `${w}x${h} cells, ${gap}px gap, DPR ${ratio}`);
						close(rects[0], enabled ? [gap / 2 * ratio, (100 - h + gap / 2) * ratio, (w - gap) * ratio, (h - gap) * ratio] :
							[0, (100 - 2 * h) * ratio, w * ratio, 2 * h * ratio]);
						u.cursor.left = w / 2;
						u.cursor.top = 100 - h / 2;
						assert.equal(u.cursor.dataIdx(u, 1), 0);
						const inset = enabled ? gap : 0;
						assert.deepEqual(u.cursor.points.bbox(u, 1), { left: inset / 2, top: 100 - h + inset / 2, width: w - inset, height: h - inset });
					}
				}
				finally { plugin.hooks.destroy(); }
			}
		}
	});

	it('uses the smallest row even when the center row is large, without extra projections', () => {
		const f = fixture({ nx: 2, ny: 3, y: { distr: 1 }, ySize: 1, include: () => true });
		const { u, plugin, drawn, projected } = isolated({ xSize: 1, grid: f.grid, cellGap: 1 }, f.data);
		try {
			plugin.hooks.setData(u);
			for (const [edges, enabled] of [[[100, 99, 40, 0], false], [[100, 51, 49, 0], false], [[100, 80, 40, 0], true]]) {
				u.valToPos = (v, key) => { projected[key].push(v); return key == 'x' ? v * 50 : edges[v]; };
				drawn.length = projected.x.length = projected.y.length = 0;
				plugin.hooks.draw(u);
				assert.deepEqual(projected, { x: f.xEdges, y: f.yEdges }, 'reuse projected edges without extra projection or source scans');
				const rects = drawn.flatMap(pathRects);
				assert.equal(rects.length, enabled ? 6 : 2);
				assert.equal(rects[0][0], enabled ? .5 : 0);
				assert.equal(rects[0][2], enabled ? 49 : 50);
			}
		}
		finally { plugin.hooks.destroy(); }
	});

	it('ignores clipped and collapsed intervals and applies one conservative decision across both axes', () => {
		const f = fixture({ nx: 3, ny: 3, y: { distr: 1 }, ySize: 1, include: () => true });
		const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, cellGap: 1 }, f.data);
		try {
			plugin.hooks.setData(u);
			for (const [xs, ys, count, left] of [
				[[0, 1, 50, 100], [100, 80, 40, 0], 3, 0],
				[[-1, 1, 50, 100], [101, 99, 50, 0], 4, 1.5],
				[[0, 0, 50, 100], [100, 100, 50, 0], 4, .5],
				[[-100, -50, -10, 110], [100, 80, 40, 0], 1, 0],
				[[0, 30, 60, 100], [200, -10, -20, -30], 3, 0],
			]) {
				u.valToPos = (v, key) => (key == 'x' ? xs : ys)[v];
				drawn.length = 0;
				plugin.hooks.draw(u);
				const rects = drawn.flatMap(pathRects);
				assert.equal(rects.length, count);
				assert.equal(rects[0][0], left);
			}
		}
		finally { plugin.hooks.destroy(); }
	});

	it('excludes near-zero hidden rows from the minimum height', () => {
		const f = fixture({ nx: 2, ny: 3, y: { distr: 1 }, yOrigin: -1, ySize: 1, include: () => true });
		const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, cellGap: 1, minAbs: 1 }, f.data);
		try {
			plugin.hooks.setData(u);
			u.valToPos = (v, key) => key == 'x' ? v * 50 : [100, 99, 98, 0][v + 1];
			plugin.hooks.draw(u);
			assert.deepEqual(drawn.flatMap(pathRects), [[.5, .5, 49, 97], [50.5, .5, 49, 97]]);
			pixelQuery(u, 25, 99.5, null);
			pixelQuery(u, 25, 50, 2);
		}
		finally { plugin.hooks.destroy(); }
	});

	it('retains merged geometry with omitted or zero cellGap', async () => {
		const f = fixture({ nx: 2, ny: 4, include: () => true });
		const original = await mount(f);
		const zero = await mount(f, 1, { cellGap: 0 });
		assert.deepEqual(rects(zero), rects(original));
		assert.equal(rects(zero).length, 2);
		checkOracle(zero, f);
	});

	for (const dpr of [1, 1.25, 1.5, 2]) {
		for (const cellGap of [.25, .5, 1]) {
			it(`insets cells by ${cellGap} CSS pixels without changing hits at DPR ${dpr}`, async () => {
				const f = fixture();
				const snapshot = structuredClone(f.data);
				const u = await mount(f, dpr, { cellGap });
				checkGap(u, f, cellGap);
				u.setSize({ width: 317, height: 213 });
				u.setScale('x', { min: .3, max: 5.7 });
				u.setScale('y', { min: 1.3, max: 40 });
				await Promise.resolve();
				checkGap(u, f, cellGap);
				u.setPxRatio(dpr == 2 ? 1.25 : 2);
				await Promise.resolve();
				checkGap(u, f, cellGap);
				assert.deepEqual(f.data, snapshot);
				pixelQuery(u, u.bbox.left - 1, u.bbox.top - 1, null);
			});
		}
	}

	it('preserves cutoff and sparse hover behavior with gaps on signed asinh and linear displays', async () => {
		const f = edgeFixture(signedEdges(), { distr: 3, factor: 2 });
		for (const distr of [1, 4]) {
			const u = await mount(f, 1.25, { cellGap: .5, minAbs: 1 }, { y: { distr, asinh: 1 } });
			checkGap(u, f, .5, 1);
			hover(u, .5, .75, null);
			hover(u, 2.5, 4, null);
			u.setData(empty());
			await Promise.resolve();
			assert.deepEqual(rects(u), []);
			u.setData(f.data);
			await Promise.resolve();
			checkGap(u, f, .5, 1);
		}
	});

	it('suppresses gaps and restores merged cells when the gap consumes either dimension', () => {
		const f = fixture({ nx: 2, ny: 3, y: { distr: 1 }, ySize: 1, include: () => true });
		for (const cellGap of [1, 2]) {
			const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, cellGap }, f.data);
			try {
				plugin.hooks.setData(u);
				plugin.hooks.draw(u);
				assert.deepEqual(drawn.flatMap(pathRects), [[0, 97, 1, 3], [1, 97, 1, 3]]);
				pixelQuery(u, .5, 99.5, 0);
				assert.deepEqual(u.cursor.points.bbox(u, 1), { left: 0, top: 99, width: 1, height: 1 });
				pixelQuery(u, 1, 99.5, 3);
				u.valToPos = (v, key) => key == 'x' ? v * 10 : 100 - v;
				drawn.length = 0;
				plugin.hooks.draw(u);
				assert.deepEqual(drawn.flatMap(pathRects), [[0, 97, 10, 3], [10, 97, 10, 3]]);
				pixelQuery(u, 5, 99.5, 0);
				assert.deepEqual(u.cursor.points.bbox(u, 1), { left: 0, top: 99, width: 10, height: 1 });
			}
			finally { plugin.hooks.destroy(); }
		}
	});

	for (const dpr of [1, 1.25, 1.5, 2]) {
		it(`aligns the DOM hover rectangle with painted signed-asinh cells at DPR ${dpr}`, async () => {
			const f = edgeFixture(signedEdges(2, -12, -3), { distr: 3, factor: 2 }, () => true, 17);
			const u = await mount(f, dpr, {}, { y: { distr: 4, asinh: 2 ** -12 } });
			enter(u);

			function assertOverlay() {
				const id = u.cursor.idxs[1];
				assert.notEqual(id, null);
				const expected = bounds(u, id, true);
				assert.ok(rects(u).some(([x, y, w, h]) => x == expected[0] && w == expected[2] &&
					y <= expected[1] && y + h >= expected[1] + expected[3]), 'the merged drawing contains the hovered source cell');
				const point = u.over.querySelector('.u-cursor-pt');
				assert.ok(!point.classList.contains('u-off'));
				const [left, top] = point.style.transform.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
				const mapping = canvasMapping(u);
				// CSS width/height serialization can round fractional pixels to six decimal places.
				close([(left + mapping.left) * mapping.x, (top + mapping.top) * mapping.y,
					parseFloat(point.style.width) * mapping.x, parseFloat(point.style.height) * mapping.y], expected, 1e-5);
			}

			for (const size of [{ width: 600, height: 360 }, { width: 317, height: 213 }, { width: 601, height: 1020 }]) {
				u.setSize(size);
				await Promise.resolve();
				for (const [col, row] of [[0, 2], [8, 14], [16, 2]]) {
					const id = f.cells.findIndex(cell => cell.col == col && cell.row == row);
					const [x, y, w, h] = bounds(u, id, true);
					const mapping = canvasMapping(u);
					u.setCursor({ left: (x + w / 2) / mapping.x - mapping.left, top: (y + h / 2) / mapping.y - mapping.top });
					assert.equal(u.cursor.idxs[1], id);
					assertOverlay();
					u.redraw();
					await Promise.resolve();
					assertOverlay();
				}
			}
			u.setPxRatio(dpr == 1.25 ? 2 : 1.25);
			await Promise.resolve();
			assertOverlay();
		});
	}

	for (const xd of [1, 3, 4]) {
		for (const yd of [1, 3, 4]) {
			for (const dpr of [1, 1.25, 2]) {
				it(`matches the sparse pixel oracle: X ${xd}, Y ${yd}, DPR ${dpr}`, async () => {
					const f = fixture({ x: { distr: xd, asinh: 2.75 }, y: { distr: yd, asinh: .35 },
						xOrigin: xd == 3 ? -.7 : -1.5, xSize: .5, yOrigin: yd == 3 ? -1 : -1.5, ySize: .5,
						count: (col, row, id) => [Number.MIN_VALUE, .125, 1, 2, Number.MAX_VALUE][id % 5] });
					const u = await mount(f, dpr);
					assert.ok(oracleRects(u, f).length > 0);
					checkOracle(u, f); // No mouseenter is needed to make lookup ready.
					u.setSize({ width: 317, height: 213 });
					u.setScale('x', { min: backward(f.grid.x, (xd == 3 ? -.7 : -1.5) + .17), max: f.xEdges[5] });
					u.setScale('y', { min: f.yEdges[1], max: backward(f.grid.y, (yd == 3 ? -1 : -1.5) + 2.37) });
					await Promise.resolve();
					checkOracle(u, f);
				});
			}
		}
	}

	for (const distr of [1, 3, 4]) {
		it(`keeps a positive log Y grid independent of display distribution ${distr}`, async () => {
			const f = fixture({ yOrigin: -5, ySize: .7 });
			const u = await mount(f, 1.25, { grid: undefined }, { y: { distr, asinh: .013 } });
			checkOracle(u, f);
			if (distr == 4) assert.equal(u.scales.y._asinh, .013);
			u.setScale('y', { min: f.yEdges[1], max: f.yEdges[5] });
			await Promise.resolve();
			checkOracle(u, f);
			if (distr == 4) assert.equal(u.scales.y._asinh, .013);
		});
	}

	for (const distr of [3, 4]) {
		it(`uses transformed X widths with grid ${distr} on a linear display`, async () => {
			const f = fixture({ x: { distr, asinh: 3.7 }, xOrigin: -1.2, xSize: .4,
				y: { distr: 1 }, yOrigin: -3, ySize: 1 });
			const u = await mount(f, 2, {}, { x: { distr: 1 }, y: { distr: 4, asinh: 2.3 } });
			checkOracle(u, f);
		});
	}

	for (const [label, factor, first, last] of [
		['binary powers', 2, -4, 4],
		['decimal powers', 10, -2, 2],
		['fractional factor', 1.5, -4, 6],
		['tiny nearest edge', 2, -1000, -994],
		['large nearest edge', 2, 990, 996],
		['wide exponent range', 2, -430, 4],
	]) {
		for (const distr of [1, 4]) {
			for (const dpr of [1, 1.25, 2]) {
				it(`matches signed ${label} geometry and hover on display ${distr}, DPR ${dpr}`, async () => {
					const threshold = factor ** first;
					const edges = signedEdges(factor, first, last), center = edges.length / 2 - 1;
					const f = edgeFixture(edges, { distr: 3, factor },
						(col, row) => col != 2 && row != center - 3 && (col + row) % 4 != 1 &&
							(edges.length < 30 || row < 3 || row > edges.length - 5 || Math.abs(row - center) < 5 || row % 37 == 0));
					const prepared = [];
					const u = await mount(f, dpr, { onPrepare: (...args) => prepared.push(args) }, { y: { distr, asinh: threshold } });
					assert.equal(prepared.length, 1);
					assert.deepEqual(prepared[0], [u, edges[0], edges.at(-1), threshold]);
					assert.ok(oracleRects(u, f).length > 0);
					checkOracle(u, f);
					for (const [min, max] of [[-edges.at(-1) * .6, edges.at(-1) * .3], [-threshold * 3, threshold * 4]]) {
						u.setSize({ width: 317, height: 213 });
						u.setScale('x', { min: .2, max: 4.7 });
						u.setScale('y', { min, max });
						await Promise.resolve();
						checkOracle(u, f);
					}
					assert.equal(prepared.length, 1, 'zoom, resize, and hover never prepare again');
				});
			}
		}
	}

	for (const distr of [1, 4]) {
		for (const mode of ['missing rows', 'asymmetric gap', 'negative only', 'positive only']) {
			it(`matches signed ${mode} source bounds on display ${distr}`, async () => {
				let edges = signedEdges(2, -2, 3);
				if (mode == 'negative only') edges = edges.slice(0, edges.length / 2);
				if (mode == 'positive only') edges = edges.slice(edges.length / 2);
				const center = edges.length / 2 - 1;
				const f = edgeFixture(edges, { distr: 3, factor: 2 }, (col, row) =>
					col != 2 && (mode != 'missing rows' || row % 3 != 1) &&
					(mode != 'asymmetric gap' || row < center - 2 || row > center));
				const prepared = [], selected = [];
				const u = await mount(f, 1.25, { onPrepare: (...args) => prepared.push(args),
					colorIdx: count => { selected.push(count); return 0; } },
					{ y: { distr, asinh: .25, min: Math.min(-1, edges[0]), max: Math.max(1, edges.at(-1)) } });
				const lower = Math.min(...f.data[1][1]), upper = Math.max(...f.data[1][2]);
				const nearest = Math.min(...[...f.data[1][1], ...f.data[1][2]].map(Math.abs));
				assert.deepEqual(prepared[0], [u, lower, upper, nearest]);
				checkOracle(u, f);
				assert.deepEqual(selected, oracleRects(u, f).map(b => b.id + 1));
				hover(u, .5, 0, null);
			});
		}

		it(`preserves mirrored row geometry and source IDs on display ${distr}`, async () => {
			const f = edgeFixture(signedEdges(), { distr: 3, factor: 2 }, () => true, 2);
			const u = await mount(f, 2, {}, { y: { distr, asinh: .3 } });
			checkOracle(u, f);
			const boxes = oracleRects(u, f), rows = f.yEdges.length - 1;
			for (const { id, rect: [x, y, w, h] } of boxes) {
				const { col, row } = f.cells[id];
				const mirror = boxes.find(b => f.cells[b.id].col == col && f.cells[b.id].row == rows - row - 1).rect;
				assert.equal(x, mirror[0]); assert.equal(w, mirror[2]);
				assert.ok(Math.abs(h - mirror[3]) <= 1);
				assert.ok(Math.abs(y + h + mirror[1] - (2 * u.bbox.top + u.bbox.height)) <= 1);
			}
		});

		it(`refreshes signed row origins through redraw, replacement, in-place, and empty setData on display ${distr}`, async () => {
			const make = unit => edgeFixture([-8 * unit, -4 * unit, -2 * unit, -unit, unit, 2 * unit, 4 * unit, 8 * unit],
				{ distr: 3, factor: 2 }, col => col != 2);
			let f = make(.5);
			const prepared = [];
			const u = await mount(f, 1.25, { onPrepare: (...args) => prepared.push(args) }, { y: { distr, asinh: .01 } });
			for (const unit of [.5, 1 / 64, 4]) {
				f = make(unit);
				u.setData(f.data);
				u.setScale('y', { min: -8 * unit, max: 8 * unit });
				await Promise.resolve();
				assert.deepEqual(prepared.at(-1), [u, -8 * unit, 8 * unit, unit]);
				checkOracle(u, f);
				hover(u, .5, 0, null);
				u.redraw(); await Promise.resolve(); checkOracle(u, f);
			}
			for (const facet of [1, 2]) f.data[1][facet].forEach((v, i, a) => { a[i] = v / 2; });
			f.yEdges = f.yEdges.map(v => v / 2);
			u.setData(f.data, false);
			assert.equal(u.cursor.dataIdx(u, 1), null, 'deferred setData invalidates cached hover');
			assert.deepEqual(prepared.at(-1), [u, -16, 16, 2]);
			u.redraw(); await Promise.resolve(); checkOracle(u, f);
			u.setData(empty()); await Promise.resolve();
			assert.deepEqual(prepared.at(-1), [u, null, null, 1]);
			assert.deepEqual(rects(u), []); hover(u, .5, 0, null);
			u.setData(f.data); await Promise.resolve(); checkOracle(u, f);
		});

		it(`rebuilds signed extents across one-sided and two-sided data on display ${distr}`, async () => {
			const grid = { distr: 3, factor: 2 };
			const initial = edgeFixture([-8, -4, -2, -1], grid, () => true);
			const prepared = [];
			const u = await mount(initial, 1.25, { onPrepare: (...args) => prepared.push(args) },
				{ y: { distr, asinh: .25, min: -16, max: 16 } });
			for (const edges of [[-8, -4, -2, -1], [1, 2, 4, 8], [-16, -8, -4], [.25, .5, 1], [-8, -4, .5, 1, 2]]) {
				const f = edgeFixture(edges, grid, () => true);
				u.setData(f.data); await Promise.resolve();
				assert.deepEqual(prepared.at(-1), [u, edges[0], edges.at(-1), Math.min(...edges.map(Math.abs))]);
				checkOracle(u, f);
				hover(u, .5, 0, null);
			}
		});

		it(`reports the nearest nonzero bound for signed linear buckets with actual zero edges on display ${distr}`, async () => {
			const f = edgeFixture([-3, -2, -1, 0, 1, 2, 3], { distr: 1 }, () => true);
			const prepared = [];
			const u = await mount(f, 1.25, { onPrepare: (...args) => prepared.push(args) }, { y: { distr, asinh: 1 } });
			assert.deepEqual(prepared[0], [u, -3, 3, 1]);
			checkOracle(u, f);
			for (const [edges, expected] of [[[-3, -2, -1, 0], 1], [[0, 1, 2, 3], 1], [[-1e-128, 0, 1e-128], 1e-128]]) {
				const next = edgeFixture(edges, { distr: 1 }, () => true);
				u.setData(next.data); await Promise.resolve();
				assert.deepEqual(prepared.at(-1), [u, edges[0], edges.at(-1), expected]);
				checkOracle(u, next);
			}
		});
	}

	for (const [label, edges, cutoff, expected, gridY = { distr: 3, factor: 2 }] of [
		['equal edges on both signs', signedEdges(2, -2, 2), .25, .5],
		['equal negative edge', [-4, -2, -1, -.5, -.25], .25, .5],
		['equal positive edge', [.25, .5, 1, 2, 4], .25, .5],
		['positive edge just above cutoff', [.5, 1, 2], .5 * (1 - Number.EPSILON), .5],
		['negative edge just above cutoff', [-2, -1, -.5], .5 * (1 - Number.EPSILON), .5],
		['nearer negative edge', [-2, -1, -.5, 1, 2, 4], .25, .5],
		['nearer positive edge', [-4, -2, -1, .5, 1, 2], .25, .5],
		['all edges at or below cutoff', [-2, -1, .5, 1, 2], 2, 1],
		['all edges below cutoff', [-2, -1, .5, 1, 2], 4, 1],
		['zero linear edges', [-.5, 0, .5], 0, .5, { distr: 1 }],
		['equal linear edges', [-2, -1, 0, 1, 2], 1, 2, { distr: 1 }],
	]) {
		it(`uses immutable minAbs for ${label}`, async () => {
			const f = edgeFixture(edges, gridY, () => true);
			const prepared = [];
			const snapshot = structuredClone(f.data);
			const u = await mount(f, 1.25, { minAbs: cutoff, onPrepare: (...args) => prepared.push(args) },
				{ y: { distr: 4, asinh: () => prepared.at(-1)?.[3] ?? 1 } });
			assert.deepEqual(prepared, [[u, edges[0], edges.at(-1), expected]]);
			assert.equal(u.scales.y._asinh, expected);
			checkOracle(u, f, cutoff);
			u.redraw(); await Promise.resolve();
			assert.equal(prepared.length, 1);
			checkOracle(u, f, cutoff);
			assert.deepEqual(f.data, snapshot, 'filtering never removes or rewrites source cells');
		});
	}

	for (const [label, edges, gridY, minAbs, displays] of [
		['sparse signed log', signedEdges(2, -3, 3), { distr: 3, factor: 2 }, 1, [1, 4]],
		['sparse positive signed log', [.125, .25, .5, 1, 2, 4, 8], { distr: 3, factor: 2 }, 1, [1, 3, 4]],
		['sparse negative signed log', [-8, -4, -2, -1, -.5, -.25, -.125], { distr: 3, factor: 2 }, 1, [1, 4]],
		['ordinary positive log', [.125, .25, .5, 1, 2, 4, 8], { distr: 3 }, 1, [1, 3, 4]],
		['signed linear', [-4, -3, -2, -1, 0, 1, 2, 3, 4], { distr: 1 }, 1, [1, 4]],
		['positive linear', [0, 1, 2, 3, 4], { distr: 1 }, 1, [1, 4]],
		['negative linear', [-4, -3, -2, -1, 0], { distr: 1 }, 1, [1, 4]],
		['all-skipped signed log', signedEdges(2, -3, 3), { distr: 3, factor: 2 }, 8, [1, 4]],
		['all-skipped positive log', [.125, .25, .5, 1, 2, 4, 8], { distr: 3 }, 8, [1, 3, 4]],
	]) {
		for (const distr of displays) {
			for (const dpr of [1, 1.25, 2]) {
				it(`excludes ${label} buckets from drawing and hover on display ${distr}, DPR ${dpr}`, async () => {
					const f = edgeFixture(edges, gridY);
					const snapshot = structuredClone(f.data), prepared = [], selected = [];
					const sourceEdges = [...f.data[1][1], ...f.data[1][2]];
					const eligible = sourceEdges.map(Math.abs).filter(v => v > minAbs);
					const expected = [Math.min(...f.data[1][1]), Math.max(...f.data[1][2]), eligible.length ? Math.min(...eligible) : 1];
					const u = await mount(f, dpr, { minAbs, onPrepare: (...args) => prepared.push(args),
						colorIdx: count => { selected.push(count); return 0; } },
						{ y: { distr, asinh: () => prepared.at(-1)?.[3] ?? 1 } });
					assert.deepEqual(prepared, [[u, ...expected]], 'metadata uses unfiltered source extrema');
					assert.deepEqual(selected, oracleRects(u, f, minAbs).map(b => f.data[1][3][b.id]));
					checkOracle(u, f, minAbs);
					for (const [width, height] of [[317, 213], [91, 61], [601, 361]]) {
						selected.length = 0;
						u.setSize({ width, height });
						u.setScale('x', { min: .2, max: 4.7 });
						await Promise.resolve();
						checkOracle(u, f, minAbs);
						assert.deepEqual(selected, oracleRects(u, f, minAbs).map(b => f.data[1][3][b.id]), 'hidden cells never select colors');
					}
					assert.equal(prepared.length, 1, 'resize and hover reuse preparation');
					assert.deepEqual(f.data, snapshot, 'source cells and counts remain intact');
				});
			}
		}
	}

	it('retains shared cutoff edges and original hover IDs without exposing hidden rows or sparse holes', async () => {
		const f = edgeFixture([-3, -2, -1, 0, 1, 2, 3], { distr: 1 },
			(col, row) => col != 2 && !(col == 1 && (row == 1 || row == 4)));
		const hovered = [];
		const u = await mount(f, 1, { minAbs: 1, colors: ['red', 'blue'], colorIdx: count => count % 2,
			onHover: (u, id) => hovered.push(id) }, { y: { distr: 1 } });
		checkOracle(u, f, 1);
		enter(u);
		for (const [x, y, row] of [[.5, -1, 1], [.5, 1, 4], [1, -1, 1], [1, 1, 4],
			[.5, -.5, null], [.5, .5, null], [1.5, -1, null], [1.5, 1, null], [2.5, 2.5, null]]) {
			const id = row == null ? null : f.cells.findIndex(c => c.col == 0 && c.row == row);
			hover(u, x, y, id);
			assert.equal(hovered.at(-1), id, 'onHover receives the source index, not a filtered index');
		}
	});

	it('prepares initially empty data with minAbs and resets hidden intervals across one-sided replacements', async () => {
		const gridY = { distr: 3, factor: 2 }, prepared = [];
		const initial = edgeFixture(signedEdges(), gridY);
		initial.data = empty(); initial.cells = [];
		const u = await mount(initial, 1.25, { minAbs: 1, onPrepare: (...args) => prepared.push(args) },
			{ y: { distr: 4, asinh: 1 } });
		assert.deepEqual(prepared, [[u, null, null, 1]]);
		checkOracle(u, initial, 1);
		for (const edges of [[.125, .25, .5, 1], [-8, -4, -2], [-1, -.5, -.25], [2, 4, 8],
			[-4, -2, -1, -.5, .5, 1, 2, 4]]) {
			const f = edgeFixture(edges, gridY);
			u.setData(f.data); await Promise.resolve();
			assert.deepEqual(prepared.at(-1).slice(1, 3), [Math.min(...f.data[1][1]), Math.max(...f.data[1][2])]);
			checkOracle(u, f, 1);
		}
	});

	it('keeps an asinh grid independent of its adaptive display cutoff', async () => {
		const f = fixture({ y: { distr: 4, asinh: .25 }, yOrigin: -3, ySize: 1, include: () => true });
		const cutoff = Math.abs(f.yEdges[2]), expected = Math.abs(f.yEdges[1]);
		const prepared = [];
		const u = await mount(f, 1.25, { minAbs: cutoff, onPrepare: (...args) => prepared.push(args) },
			{ y: { distr: 4, asinh: () => prepared.at(-1)?.[3] ?? 1 } });
		assert.deepEqual(prepared, [[u, f.yEdges[0], f.yEdges.at(-1), expected]]);
		assert.equal(u.scales.y._asinh, expected);
		checkOracle(u, f, cutoff);
	});

	for (const distr of [1, 3, 4]) {
		for (const minAbs of [undefined, 0, 1]) {
			it(`uses minAbs ${minAbs ?? 'default zero'} without reading scale.clamp on display ${distr}`, () => {
				const f = edgeFixture(signedEdges(2, -3, 2), { distr: 3, factor: 2 }, () => true);
				const prepared = [];
				const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, minAbs,
					onPrepare: (...args) => prepared.push(args) }, f.data);
				u.scales.y = { distr, get clamp() { throw new Error('Plugin must not access scale.clamp'); } };
				try {
					plugin.hooks.setData(u);
					assert.deepEqual(prepared, [[u, -4, 4, minAbs == 1 ? 2 : .125]]);
					plugin.hooks.draw(u);
					assert.deepEqual(coverage(drawn.flatMap(pathRects)), coverage(oracleRects(u, f, minAbs).map(b => b.rect)));
					pixelQuery(u, .5, 97, f.cells.findIndex(c => c.col == 0 && f.yEdges[c.row] == 2));
				}
				finally { plugin.hooks.destroy(); }
			});
		}
	}

	it('keeps minAbs fixed while replacement, in-place, all-skipped, and empty setData refresh metadata', async () => {
		const minAbs = 2;
		let f = edgeFixture(signedEdges(2, -3, 3), { distr: 3, factor: 2 }, () => true);
		const prepared = [];
		const u = await mount(f, 1.25, { minAbs, onPrepare: (...args) => prepared.push(args) },
			{ y: { distr: 4, asinh: () => prepared.at(-1)?.[3] ?? 1, min: -32, max: 32 } });
		assert.deepEqual(prepared, [[u, -8, 8, 4]]);
		assert.equal(u.scales.y._asinh, 4);
		checkOracle(u, f, minAbs);
		f = edgeFixture([-32, -16, -8, .25, .5, 1], f.grid.y, () => true);
		u.setData(f.data); await Promise.resolve();
		assert.deepEqual(prepared.at(-1), [u, -32, 1, 8]);
		checkOracle(u, f, minAbs);
		for (const facet of [1, 2]) f.data[1][facet].forEach((v, i, a) => { a[i] = v / 4; });
		f.yEdges = f.yEdges.map(v => v / 4);
		u.setData(f.data, false);
		assert.equal(u.cursor.dataIdx(u, 1), null, 'deferred setData invalidates cached hover');
		assert.deepEqual(prepared.at(-1), [u, -8, .25, 4]);
		u.redraw(); await Promise.resolve();
		assert.equal(prepared.length, 3);
		checkOracle(u, f, minAbs);
		u.setSize({ width: 317, height: 213 });
		u.setScale('y', { min: -16, max: 16 });
		await Promise.resolve();
		u.redraw(); await Promise.resolve();
		checkOracle(u, f, minAbs);
		assert.equal(prepared.length, 3);
		const skipped = edgeFixture([-2, -1, -.5, .5, 1, 2], f.grid.y, () => true);
		u.setData(skipped.data); await Promise.resolve();
		assert.deepEqual(prepared.at(-1), [u, -2, 2, 1]);
		checkOracle(u, skipped, minAbs);
		u.setData(empty()); await Promise.resolve();
		assert.deepEqual(prepared.at(-1), [u, null, null, 1]);
		assert.deepEqual(rects(u), []);
		hover(u, .5, -3, null);
		u.setData(f.data); await Promise.resolve();
		assert.deepEqual(prepared.at(-1), [u, -8, .25, 4]);
		assert.equal(u.scales.y._asinh, 4);
		checkOracle(u, f, minAbs);
	});

	it('bounds signed IDs by actual nearest edges and reuses their buffer through initially empty, grow, shrink, and empty data', () => {
		const prepared = [];
		const { u, plugin, projected } = isolated({ xSize: 1, grid: { y: { distr: 3, factor: 2 } },
			onPrepare: (...args) => prepared.push(args) });
		try {
			trackTyped(allocations => {
				plugin.hooks.setData(u);
				assert.deepEqual(prepared.at(-1), [u, null, null, 1]);
				for (const [first, last, nx] of [[-1000, -997, 1], [990, 996, 5], [-1074, -1071, 1],
					[1020, 1023, 1], [-4, 0, 1], [-10, -7, 0], [1, 4, 2]]) {
					const f = edgeFixture(signedEdges(2, first, last), { distr: 3, factor: 2 }, () => true, nx);
					u.data = f.data;
					plugin.hooks.setData(u);
					const ids = allocations.at(-1)[1];
					assert.equal(ids.length, allocations.length == 1 ? 6 : 60);
					f.cells.forEach(({ row }, i) => assert.equal(ids[i], row, 'monotonic IDs retain only an empty central gap'));
					projected.y.length = 0;
					plugin.hooks.draw(u);
					assert.deepEqual(projected.y, nx ? f.yEdges : [], 'no synthetic zero edges or extra exponent rows');
				}
				assert.deepEqual(allocations.map(([name, ids]) => [name, ids.length]), [['Uint32Array', 6], ['Uint32Array', 60]]);
			});
		}
		finally { plugin.hooks.destroy(); }
	});

	it('deduplicates signed transforms and threshold work, retains only row IDs, and projects edges rather than cells', () => {
		const f = edgeFixture(signedEdges(), { distr: 3, factor: 2 },
			(col, row) => col != 2 && row != 2, 64);
		const rows = new Set(f.data[1][1]).size, columns = 63;
		const log = Math.log, abs = Math.abs;
		let logs = 0, absolutes = 0, lowerReads = 0, upperReads = 0, minAbsReads = 0, clampReads = 0;
		let optionMinAbs = 2;
		const data = [null, [...f.data[1]]];
		data[1][1] = new Proxy(data[1][1], { get(target, key) {
			if (/^\d+$/.test(String(key))) lowerReads++;
			return target[key];
		} });
		data[1][2] = new Proxy(data[1][2], { get(target, key) {
			if (/^\d+$/.test(String(key))) upperReads++;
			return target[key];
		} });
		const prepared = [];
		const { u, plugin, projected, drawn } = isolated({ xSize: 1, grid: f.grid,
			get minAbs() { minAbsReads++; return optionMinAbs; }, onPrepare: (...args) => prepared.push(args) }, data);
		assert.equal(minAbsReads, 1, 'minAbs is captured during plugin initialization');
		optionMinAbs = 0;
		u.scales.y = { distr: 4, get clamp() { clampReads++; throw new Error('Plugin must not access scale.clamp'); } };
		try {
			Math.log = value => { logs++; return log(value); };
			Math.abs = value => { absolutes++; return abs(value); };
			trackTyped(allocations => {
				withoutIndexes(() => plugin.hooks.setData(u), true);
				assert.ok(logs <= rows + 3, 'logarithms scale with unique rows, not cells');
				assert.ok(absolutes <= 3 * rows + 2, 'threshold absolute values are computed once per unique row');
				assert.ok(lowerReads <= f.cells.length + columns * 8, 'nearest-edge searches are per-run binary searches, not another cell scan');
				assert.equal(upperReads, 2 * columns + rows, 'upper bounds are read only for run endpoints, nearest negative edges, and unique rows');
				assert.deepEqual(prepared, [[u, -16, 16, 4]]);
				assert.equal(minAbsReads, 1);
				assert.equal(clampReads, 0);
				assert.deepEqual(allocations.map(([name, a]) => [name, a.byteLength]), [['Uint32Array', f.cells.length * 4]]);
				f.cells.forEach(({ row }, i) => assert.equal(allocations[0][1][i], row, 'hidden cells retain their original grid row IDs'));
				const preparedLogs = logs, preparedAbs = absolutes;
				const coordinates = u.data;
				u.data = [null, [...coordinates[1].slice(0, 3).map(a => new Proxy(a, { get() {
					throw new Error('Signed draw/hover must not read source coordinates');
				} })), coordinates[1][3]]];
				withoutIndexes(() => {
					for (let repeat = 0; repeat < 3; repeat++) {
						projected.x.length = projected.y.length = 0;
						plugin.hooks.draw(u);
						assert.deepEqual(projected.x, f.xEdges);
						assert.deepEqual(projected.y, f.yEdges);
						assert.equal(logs, preparedLogs);
						assert.equal(absolutes, preparedAbs);
						assert.equal(minAbsReads, 1);
						assert.equal(clampReads, 0);
						assert.equal(prepared.length, 1);
					}
					pixelQuery(u, .5, 99, null);
					assert.deepEqual(u.cursor.points.bbox(u, 1), { left: -10, top: -10, width: 0, height: 0 });
					pixelQuery(u, .5, 97, f.cells.findIndex(c => c.col == 0 && f.yEdges[c.row] == 2));
					assert.equal(u.cursor.dataIdx(u, 1), f.cells.findIndex(c => c.col == 0 && f.yEdges[c.row] == 2));
					assert.equal(logs, preparedLogs, 'hover does not transform grid coordinates');
					assert.equal(absolutes, preparedAbs, 'hover does not transform signed grid coordinates');
				});
				assert.equal(allocations.length, 1, 'draw and hover allocate no additional typed indexes');
				u.data = coordinates;
				assert.deepEqual(coverage(pathRects(drawn.at(-1))), coverage(oracleRects(u, f, 2).map(b => b.rect)));
				for (const next of [empty(), coordinates, coordinates]) {
					u.data = next;
					withoutIndexes(() => plugin.hooks.setData(u), true);
					withoutIndexes(() => plugin.hooks.draw(u));
					assert.deepEqual(prepared.at(-1), next == coordinates ? [u, -16, 16, 4] : [u, null, null, 1]);
					assert.equal(minAbsReads, 1, 'changing the original options cannot change the captured cutoff');
					assert.equal(clampReads, 0);
				}
				assert.equal(allocations.length, 1, 'hidden-row state adds no per-cell typed buffers');
			});
		}
		finally { Math.log = log; Math.abs = abs; plugin.hooks.destroy(); }
	});

	it('configures mode-2 facets, defaults to linear/log, and uses one steelblue path', async () => {
		const f = fixture();
		const u = await mount(f, 1, { grid: undefined });
		assert.deepEqual(u.series[1].facets.map(f => f.scale), ['x', 'y', 'y']);
		assert.equal(u.series[1].paths(u, 1, 0, 1), null);
		assert.equal(u.series[1].points.show(u, 1), false);
		assert.equal(fills(u).length, 1);
		assert.deepEqual(lastDraw(u).filter(e => e[0] == 'fillStyle').flatMap(e => e.slice(1)), ['steelblue']);
		checkOracle(u, f);
	});

	it('merges consecutive rows by palette index, not count or CSS color, without crossing gaps or columns', () => {
		const f = fixture({ nx: 4, ny: 7, y: { distr: 1 }, ySize: 1,
			include: (col, row) => col != 2 && row != 2,
			count: (col, row) => [1, 2, 0, 3, 11, 4, 5][row] });
		const snapshot = structuredClone(f.data), selected = [], hovered = [];
		const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, colors: ['red', 'red'],
			colorIdx: count => { selected.push(count); return Math.floor(count / 10); },
			onHover: (self, id) => hovered.push([self, id]) }, f.data);
		try {
			plugin.hooks.setData(u);
			plugin.hooks.draw(u);
			assert.deepEqual(selected, f.data[1][3], 'every visible source cell still selects its own color');
			assert.deepEqual(drawn.map(pathRects), [
				[0, 1, 3].flatMap(col => [[col, 98, 1, 2], [col, 96, 1, 1], [col, 93, 1, 2]]),
				[0, 1, 3].map(col => [col, 95, 1, 1]),
			]);
			const boxes = oracleRects(u, f);
			for (const { id, rect: [x, y, w, h] } of boxes) {
				pixelQuery(u, x + w / 2, y + h / 2, id);
				plugin.hooks.setCursor(u);
				assert.deepEqual(hovered.at(-1), [u, id]);
				assert.deepEqual(u.cursor.points.bbox(u, 1), { left: x, top: y, width: w, height: h });
				for (const py of [y, y + h])
					pixelQuery(u, x + w / 2, py, oracleHit(boxes, x + w / 2, py));
			}
			pixelQuery(u, .5, 97.5, null);
			pixelQuery(u, 2.5, 99.5, null);
			pixelQuery(u, 1, 99.5, 6);
			assert.deepEqual(f.data, snapshot);
		}
		finally { plugin.hooks.destroy(); }
	});

	it('breaks same-color runs at excluded and zero-height rows even when their pixel edges touch', () => {
		const f = fixture({ nx: 1, ny: 8, y: { distr: 1 }, yOrigin: -4, ySize: 1, include: () => true });
		const selected = [];
		const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, minAbs: 1,
			colorIdx: count => { selected.push(count); return 0; } }, f.data);
		try {
			plugin.hooks.setData(u);
			for (const [pixels, expected, counts] of [
				[[54, 53, 52, 51, 50, 49, 48, 47, 46], [[0, 51, 1, 3], [0, 46, 1, 3]], [1, 2, 3, 6, 7, 8]],
				[[100, 99, 98, 97, 97, 97, 96, 96, 95], [[0, 97, 1, 3], [0, 96, 1, 1], [0, 95, 1, 1]], [1, 2, 3, 6, 8]],
			]) {
				u.valToPos = (v, key) => key == 'x' ? v : pixels[v + 4];
				drawn.length = selected.length = 0;
				plugin.hooks.draw(u);
				assert.deepEqual(drawn.flatMap(pathRects), expected);
				assert.deepEqual(selected, counts, 'excluded and collapsed source cells do not select colors');
				const boxes = oracleRects(u, f, 1);
				for (const { id, rect: [x, y, w, h] } of boxes) {
					pixelQuery(u, x + w / 2, y + h / 2, id);
					assert.deepEqual(u.cursor.points.bbox(u, 1), { left: x, top: y, width: w, height: h });
					for (const py of [y, y + h])
						pixelQuery(u, .5, py, oracleHit(boxes, .5, py));
				}
				if (pixels[3] != pixels[5]) pixelQuery(u, .5, 50, null);
			}
		}
		finally { plugin.hooks.destroy(); }
	});

	it('rebuilds merged runs on color redraw, count edits, replacement, in-place, and empty setData', () => {
		const f = fixture({ nx: 2, ny: 3, y: { distr: 1 }, ySize: 1, include: () => true });
		const snapshot = structuredClone(f.data), prepared = [];
		let split = false;
		const { u, plugin, drawn } = isolated({ xSize: 1, grid: f.grid, colors: ['red', 'blue'],
			colorIdx: count => split ? count % 2 : 0, onPrepare: () => prepared.push(true) }, f.data);
		const draw = expected => {
			drawn.length = 0;
			plugin.hooks.draw(u);
			assert.deepEqual(drawn.map(pathRects), expected);
		};
		try {
			plugin.hooks.setData(u);
			draw([[[0, 97, 1, 3], [1, 97, 1, 3]], []]);
			split = true;
			draw([[[0, 98, 1, 1], [1, 99, 1, 1], [1, 97, 1, 1]], [[0, 99, 1, 1], [0, 97, 1, 1], [1, 98, 1, 1]]]);
			assert.deepEqual(f.data, snapshot, 'color redraw does not mutate source data');
			f.data[1][3].fill(2);
			draw([[[0, 97, 1, 3], [1, 97, 1, 3]], []]);
			pixelQuery(u, .5, 98.5, 1);
			assert.deepEqual(u.cursor.points.bbox(u, 1), { left: 0, top: 98, width: 1, height: 1 });
			assert.equal(prepared.length, 1, 'color and count redraws need no preparation');

			u.data = fixture({ nx: 1, ny: 4, y: { distr: 1 }, ySize: 1, include: (col, row) => row != 1 }).data;
			split = false;
			plugin.hooks.setData(u);
			pixelQuery(u, .5, 98.5, null);
			draw([[[0, 99, 1, 1], [0, 96, 1, 2]], []]);
			pixelQuery(u, .5, 98.5, null);
			for (const facet of [1, 2]) u.data[1][facet].forEach((v, i, a) => { a[i] = v + 10; });
			plugin.hooks.setData(u);
			draw([[[0, 89, 1, 1], [0, 86, 1, 2]], []]);
			pixelQuery(u, .5, 86.5, 2);
			u.data = empty();
			plugin.hooks.setData(u);
			draw([]);
			pixelQuery(u, .5, 86.5, null);
			u.data = f.data;
			plugin.hooks.setData(u);
			draw([[[0, 97, 1, 3], [1, 97, 1, 3]], []]);
			pixelQuery(u, 1.5, 97.5, 5);
			assert.equal(prepared.length, 5);
		}
		finally { plugin.hooks.destroy(); }
	});

	it('allocates all palette paths before color selection and replaces them on every draw', async () => {
		const f = fixture({ nx: 4, ny: 1, include: () => true, count: col => col % 2 + 1 });
		const colors = ['red', 'red', 'blue'];
		let selected = null, allocated = null;
		const counts = [];
		const u = await mount(f, 1, { colors, colorIdx: count => {
			if (allocated) assert.equal(allocated.length, colors.length);
			counts.push(count);
			return selected ?? count - 1;
		} });
		assert.deepEqual(fills(u).map(p => pathRects(p).length), [2, 2, 0]);
		assert.ok(!lastDraw(u).some(e => e[0] == 'fillRect'));
		const Path = globalThis.Path2D;
		let previous = fills(u);
		try {
			globalThis.Path2D = function(...args) { const p = new Path(...args); allocated.push(p); return p; };
			for (selected of [1, 2, 0]) {
				allocated = []; counts.length = 0;
				u.redraw();
				await Promise.resolve();
				assert.deepEqual(counts, [1, 2, 1, 2]);
				assert.deepEqual(fills(u), allocated);
				assert.equal(allocated.length, 3);
				allocated.forEach((p, i) => {
					assert.ok(!previous.includes(p));
					assert.equal(pathRects(p).length, i == selected ? 4 : 0);
				});
				assert.deepEqual(lastDraw(u).filter(e => e[0] == 'fillStyle').flatMap(e => e.slice(1)), colors);
				previous = allocated;
			}
		}
		finally { globalThis.Path2D = Path; }
	});

	it('keeps original IDs and chooses the last source at shared edges regardless of palette fill order', async () => {
		const f = fixture({ nx: 3, ny: 3, y: { distr: 1 }, yOrigin: -1, ySize: 1,
			include: (col, row) => !(col >= 1 && row == 1) });
		const calls = [];
		const u = await mount(f, 1, { colors: ['red', 'blue'], colorIdx: count => count % 2,
			onHover: (self, id) => calls.push([self, id]) });
		// IDs by column: [0,1,2], [3,4], [5,6]; omitted buckets have no source IDs.
		for (const [x, y, id] of [[1, 0, 3], [1, 1, 4], [2, 0, 5], [2, 1, 6],
			[1, .5, 1], [2, .5, null], [1.5, .5, null], [2.5, .5, null]]) {
			u.setCursor({ left: (Math.round(u.valToPos(x, 'x', true)) - u.bbox.left) / u.pxRatio,
				top: (Math.round(u.valToPos(y, 'y', true)) - u.bbox.top) / u.pxRatio });
			assert.equal(u.cursor.dataIdx(u, 1), id);
			assert.deepEqual(calls.at(-1), [u, id]);
		}
		assert.deepEqual(fills(u).map(path => pathRects(path).length), [3, 4]);
		enter(u);
		hover(u, .5, .5, 1);
		u.redraw(); await Promise.resolve();
		assert.deepEqual(calls.at(-1), [u, 1]);
	});

	it('selects colors only for visible noncollapsed cells and still fills all offscreen palette paths', async () => {
		const f = fixture({ nx: 4, ny: 4, include: () => true });
		const counts = [];
		const u = await mount(f, 1.25, { colors: ['red', 'blue', 'green', 'orange'],
			colorIdx: count => { counts.push(count); return Math.floor((count - 1) / 4); } });
		u.setScale('x', { min: 1.2, max: 1.8 });
		u.setScale('y', { min: 1.5, max: 3 });
		counts.length = 0;
		await Promise.resolve();
		const boxes = oracleRects(u, f);
		assert.deepEqual(counts, boxes.map(({ id }) => f.data[1][3][id]));
		assert.deepEqual(fills(u).map(path => pathRects(path).length), [0, 1, 0, 0]);
		checkOracle(u, f);
	});

	it('projects full axis edges once, skips collapsed X runs, and uses no Maps during draw or hover', () => {
		const f = fixture({ x: { distr: 1 }, y: { distr: 1 }, nx: 64, ny: 64, ySize: 1,
			include: (col, row) => col != 2 && row != 2 });
		// A minimal event target keeps Happy DOM's own Maps outside this plugin-only guard.
		const listeners = [];
		const over = {
			addEventListener(type, fn) { listeners.push([type, fn]); },
			removeEventListener(type, fn) { listeners.splice(listeners.findIndex(e => e[0] == type && e[1] == fn), 1); },
			dispatchEvent(event) { listeners.forEach(([type, fn]) => { if (type == event.type) fn({ target: over }); }); },
		};
		withoutIndexes(() => {
			const { u, plugin, projected, drawn } = isolated({ xSize: 1, grid: f.grid }, f.data, over);
			try {
				plugin.hooks.setData(u);
				withoutIndexes(() => {
					plugin.hooks.draw(u);
					assert.deepEqual(projected.x, f.xEdges);
					assert.deepEqual(projected.y, f.yEdges);
					assert.deepEqual(drawn.flatMap(pathRects), f.xEdges.slice(0, -1).filter(col => col != 2)
						.flatMap(col => [[col, 98, 1, 2], [col, 36, 1, 61]]));
					pixelQuery(u, .5, 99.5, 0);
					pixelQuery(u, 2.5, 99.5, null);
					pixelQuery(u, .5, 97.5, null);
					let reads = 0;
					u.data[1][3] = new Proxy(f.data[1][3], { get(target, key) { if (/^\d+$/.test(String(key))) reads++; return target[key]; } });
					u.valToPos = (v, key) => key == 'x' ? v / 1000 : 100 - v;
					plugin.hooks.draw(u);
					assert.equal(reads, 0, 'fully collapsed columns never enter their cell loop');
					enter(u); leave(u); enter(u);
					pixelQuery(u, 0, 50, null);
				});
				plugin.hooks.setData(u);
				withoutIndexes(() => plugin.hooks.draw(u));
			}
			finally { plugin.hooks.destroy(); }
		}, true);
	});

	for (const distr of [1, 3, 4]) {
		it(`finds X run ends around powers of two, across missing columns, with grid ${distr}`, () => {
			// Exercise every exponential-search boundary in both directions, without hundreds of interior lengths.
			const lengths = [1, 2];
			for (let power = 4; power <= 256; power *= 2)
				lengths.push(power - 1, power, power + 1);
			lengths.push(...lengths.slice().reverse());
			// Keep the transformed span crossing zero even with fewer columns (including signed asinh X).
			const f = fixture({ x: { distr }, y: { distr: 1 }, xOrigin: -2, xSize: .12, ySize: 1,
				nx: lengths.length * 2 - 1, ny: 257, include: (col, row) => col % 2 == 0 && row < lengths[col / 2] });
			let reads = 0;
			const data = [null, [...f.data[1]]];
			data[1][0] = new Proxy(data[1][0], { get(target, key) {
				if (/^\d+$/.test(String(key))) reads++;
				return target[key];
			} });
			const { u, plugin, drawn } = isolated({ xSize: f.xSize, grid: f.grid }, data);
			u.bbox.width = 2048;
			u.bbox.height = 300;
			const fwd = distr == 3 ? Math.log : distr == 4 ? Math.asinh : v => v;
			u.valToPos = (v, key) => key == 'x' ? (fwd(v) + 2) / f.xSize : 300 - v;
			u.posToVal = (v, key) => key == 'x' ? backward(f.grid.x, -2 + v * f.xSize) : 300 - v;
			try {
				plugin.hooks.setData(u);
				assert.ok(reads < f.cells.length / 2, 'run search avoids a full X scan');
				plugin.hooks.draw(u);
				assert.deepEqual(drawn.flatMap(pathRects), lengths.map((height, col) => [col * 2, 300 - height, 1, height]));
				let start = 0;
				for (let col = 0; col < lengths.length; col++) {
					pixelQuery(u, col * 2 + .5, 299.5, start);
					pixelQuery(u, col * 2 + .5, 300.5 - lengths[col], start + lengths[col] - 1);
					pixelQuery(u, col * 2 + 1.5, 299.5, null);
					start += lengths[col];
				}
			}
			finally { plugin.hooks.destroy(); }
		});
	}

	for (const [distr, transform] of [[3, 'log'], [4, 'asinh']]) {
		it(`deduplicates ${transform} transforms and reads Y extents only at run endpoints`, () => {
			const f = fixture({ y: { distr }, nx: 64, ny: 64, ySize: .05, include: (col, row) => col != 2 && row != 2 });
			const distinctRows = 63, columns = 63;
			let transforms = 0, upperReads = 0;
			const original = Math[transform];
			const data = [null, [...f.data[1]]];
			data[1][2] = new Proxy(data[1][2], { get(target, key) {
				if (/^\d+$/.test(String(key))) upperReads++;
				return target[key];
			} });
			let plugin;
			try {
				Math[transform] = value => { transforms++; return original(value); };
				const state = isolated({ xSize: 1, grid: f.grid }, data);
				plugin = state.plugin;
				for (let repeat = 0; repeat < 2; repeat++) {
					transforms = upperReads = 0;
					plugin.hooks.setData(state.u);
					assert.equal(transforms, distinctRows + 4, 'one transform per distinct row plus four schema transforms');
					assert.equal(upperReads, columns + distinctRows + 1, 'run endpoints, distinct row edges, and first-cell step only');
					plugin.hooks.draw(state.u);
					assert.equal(transforms, distinctRows + 4, 'drawing does not repeat grid transforms');
				}
			}
			finally {
				Math[transform] = original;
				plugin?.hooks.destroy();
			}
		});
	}

	it('prepares only on setData, retains one four-byte row ID per cell, and reuses capacity through growth/shrink/empty', () => {
		const f = fixture({ y: { distr: 1 }, nx: 64, ny: 64, ySize: 1, include: () => true });
		const colors = [];
		const { u, plugin } = isolated({ xSize: 1, grid: f.grid, colorIdx: count => { colors.push(count); return 0; } });
		try {
			trackTyped(allocations => {
				u.data = f.data;
				plugin.hooks.setData(u);
				assert.deepEqual(colors, [], 'no color preprocessing');
				assert.equal(allocations.length, 1);
				const [name, rows] = allocations[0];
				assert.equal(name, 'Uint32Array');
				assert.equal(rows.byteLength, f.cells.length * 4);
				for (let i = 0; i < rows.length; i++) assert.equal(rows[i], i % 64);
				// Drawing and hover must use prepared geometry, not source coordinate arrays.
				const original = u.data;
				u.data = [null, [...original[1].slice(0, 3).map(a => new Proxy(a, { get() { throw new Error('Geometry read outside setData'); } })), original[1][3]]];
				for (let i = 0; i < 3; i++) {
					u.bbox.width += 1;
					plugin.hooks.draw(u);
					pixelQuery(u, 10.5, 89.5, 10 * 64 + 10);
				}
				u.data = original;
				plugin.hooks.setData(u);
				assert.equal(allocations.length, 1);
				for (const n of [5000, 3, 0, 4000, 10001]) {
					const next = fixture({ y: { distr: 1 }, nx: n, ny: 1, ySize: 1, include: () => true });
					u.data = next.data;
					const before = colors.length;
					plugin.hooks.setData(u);
					assert.equal(colors.length, before);
					assert.equal(u.cursor.dataIdx(u, 1), null, 'setData invalidates the previous query');
					plugin.hooks.draw(u);
					pixelQuery(u, .5, 99.5, n ? 0 : null);
					if (n == 3 || n == 0) pixelQuery(u, 10.5, 99.5, null);
				}
				assert.deepEqual(allocations.map(([name, a]) => [name, a.length]),
					[['Uint32Array', 4096], ['Uint32Array', 8192], ['Uint32Array', 16384]]);
			});
		}
		finally { plugin.hooks.destroy(); }
	});

	it('rebuilds origins and extents after in-place setData, including initially empty data', async () => {
		const f = fixture({ nx: 3, ny: 3, include: () => true });
		const original = f.data;
		f.data = empty();
		const u = await mount(f);
		hover(u, .5, 1.5, null);
		f.data = original;
		u.setData(original);
		await Promise.resolve();
		checkOracle(u, f);
		for (let i = 0; i < original[1][0].length; i++) {
			original[1][0][i] += 1;
			original[1][1][i] *= 2;
			original[1][2][i] *= 2;
		}
		f.xEdges = f.xEdges.map(v => v + 1);
		f.yEdges = f.yEdges.map(v => v * 2);
		u.setData(original, false);
		assert.equal(u.cursor.dataIdx(u, 1), null);
		u.redraw();
		await Promise.resolve();
		checkOracle(u, f);
		u.setData(empty());
		await Promise.resolve();
		assert.deepEqual(rects(u), []);
		hover(u, 1.5, 3, null);
	});

	it('infers Y origin and extents across runs even when the first cell is not the lowest row', async () => {
		const f = fixture({ nx: 7, ny: 8, x: { distr: 4, asinh: 2.5 }, y: { distr: 4, asinh: .2 },
			xOrigin: -2, xSize: .5, yOrigin: -2, ySize: .5,
			include: (col, row) => col == 1 && row == 4 || col == 3 && (row == 0 || row == 6) || col == 5 && row == 7 });
		const u = await mount(f, 1.25, {}, { x: { distr: 1 }, y: { distr: 1 } });
		checkOracle(u, f);
		assert.equal(rects(u).length, 4, 'extents include extreme rows in later runs');
	});

	it('reads updated positive counts on draw without rebuilding geometry', async () => {
		const f = fixture({ nx: 2, ny: 4, include: () => true });
		const counts = [];
		const u = await mount(f, 1, { colorIdx: count => { counts.push(count); return 0; } });
		for (const values of [[.125, .25, .5, 1, 2, 3, 4, 5], Array(8).fill(1), Array(8).fill(2)]) {
			f.data[1][3].splice(0, 8, ...values);
			counts.length = 0;
			u.redraw();
			await Promise.resolve();
			assert.deepEqual(counts, values);
			assert.equal(fills(u).length, 1);
			checkOracle(u, f);
		}
	});

	for (const dpr of [1, 1.25, 2]) {
		it(`resolves collapsed runs, shared edges, sparse fallback, and last-source precedence at DPR ${dpr}`, async () => {
			const f = fixture({ nx: 40, ny: 40, y: { distr: 1 }, ySize: 1,
				include: (col, row) => col != 12 && row != 16 && (col * 3 + row) % 5 != 1 });
			const u = await mount(f, dpr);
			u.setSize({ width: 72, height: 52 });
			await Promise.resolve();
			const boxes = oracleRects(u, f);
			assert.ok(boxes.length > 0 && boxes.length < f.cells.length);
			checkOracle(u, f);
		});
	}

	it('reads counts only for visible rectangles, with no finite checks or hover count reads', () => {
		const f = fixture({ nx: 2, ny: 8, y: { distr: 1 }, ySize: 1, include: (col, row) => row != 4 && row != 5 });
		const reads = [];
		const data = [null, [...f.data[1]]];
		data[1][3] = new Proxy(data[1][3], { get(target, key) {
			if (/^\d+$/.test(String(key))) reads.push(Number(key));
			return target[key];
		} });
		const { u, plugin } = isolated({ xSize: 1, grid: f.grid }, data);
		u.valToPos = (v, key) => key == 'x' ? v : 100 - v / 2;
		u.posToVal = (v, key) => key == 'x' ? v : (100 - v) * 2;
		const isFinite = Number.isFinite;
		try {
			Number.isFinite = () => { throw new Error('Plugin must trust finite positive counts'); };
			plugin.hooks.setData(u);
			assert.deepEqual(reads, [], 'preparation does not read counts');
			plugin.hooks.draw(u);
			assert.deepEqual(reads, [1, 3, 5, 7, 9, 11], 'collapsed rows do not read counts');
			reads.length = 0;
			pixelQuery(u, .5, 99.5, 1);
			pixelQuery(u, .5, 97.5, null);
			pixelQuery(u, 1.5, 96.5, 11);
			assert.deepEqual(reads, [], 'hover uses sparse occupancy, not count values');
		}
		finally {
			Number.isFinite = isFinite;
			plugin.hooks.destroy();
		}
	});

	it('uses cached pixel bounds without inverse projections and reuses hover boxes before mouse entry', () => {
		const f = fixture({ nx: 4, ny: 4, y: { distr: 1 }, ySize: 1, include: () => true });
		const calls = [];
		const { u, plugin, inverted } = isolated({ xSize: 1, grid: f.grid, onHover: (self, id) => calls.push([self, id]) }, f.data);
		try {
			plugin.hooks.setData(u);
			plugin.hooks.draw(u);
			pixelQuery(u, .5, 99.5, 0);
			const box = u.cursor.points.bbox(u, 1);
			for (let i = 0; i < 4; i++) {
				pixelQuery(u, .5, 99.5, 0);
				plugin.hooks.setCursor(u);
			}
			assert.deepEqual(inverted, { x: [], y: [] });
			assert.deepEqual(calls.at(-1), [u, 0]);
			pixelQuery(u, 1.5, 98.5, 5);
			assert.equal(u.cursor.points.bbox(u, 1), box);
			assert.deepEqual(inverted, { x: [], y: [] });
			let refreshes = 0;
			u.setCursor = (cursor, fire, publish) => {
				assert.equal(cursor, u.cursor);
				assert.equal(fire, false); assert.equal(publish, false); refreshes++;
			};
			plugin.hooks.draw(u);
			assert.equal(refreshes, 0);
			enter(u);
			assert.equal(refreshes, 0, 'entry does not build or query anything');
			plugin.hooks.draw(u);
			assert.equal(refreshes, 1, 'entry enables stationary cursor refresh on draw');
			assert.deepEqual(calls.at(-1), [u, 5]);
			leave(u);
			plugin.hooks.draw(u);
			assert.equal(refreshes, 1);
			pixelQuery(u, .5, 99.5, 0);
			u.series[1].show = false;
			plugin.hooks.draw(u);
			pixelQuery(u, .5, 99.5, null);
			u.series[1].show = true;
			plugin.hooks.draw(u);
			pixelQuery(u, .5, 99.5, 0);
		}
		finally { plugin.hooks.destroy(); }
	});

	it('preserves exact source edge values rather than Float32 or inverse-transform approximations', () => {
		const x0 = 1698437700.1234567, x1 = x0 + .125;
		const lo = .10000000000000003, hi = .20000000000000007;
		assert.notEqual(Math.fround(x1), x1);
		assert.notEqual(Math.exp(Math.log(lo)), lo);
		const { u, plugin, projected } = isolated({ xSize: .125 }, [null, [[x1], [lo], [hi], [1]]]);
		try {
			plugin.hooks.setData(u);
			plugin.hooks.draw(u);
			assert.deepEqual(projected.x, [x0, x1]);
			assert.deepEqual(projected.y, [lo, hi]);
		}
		finally { plugin.hooks.destroy(); }
	});

	it('removes the exact pointer listeners on destroy', () => {
		const over = document.createElement('div');
		const added = [], removed = [], add = over.addEventListener, remove = over.removeEventListener;
		over.addEventListener = function(...args) { added.push(args); return add.apply(this, args); };
		over.removeEventListener = function(...args) { removed.push(args); return remove.apply(this, args); };
		const { u, plugin } = isolated({ xSize: 1 }, empty(), over);
		plugin.hooks.destroy();
		assert.deepEqual(removed, added);
		assert.deepEqual(removed.map(([type, , capture]) => [type, capture]), [['mouseenter', true], ['mouseleave', undefined]]);
		let refreshes = 0;
		u.setCursor = () => refreshes++;
		enter(u); leave(u);
		plugin.hooks.draw(u);
		assert.equal(refreshes, 0);
	});
});

describe('heatmap cells demo integration', () => {
	it('matches Y grid and tick masks to visible labels across signed asinh resizes and display switches', async () => {
		const root = createDemoRoot(), select = root.querySelector('#y-scale'), signed = root.querySelector('#signed-data');
		const lo = Array.from({ length: 33 }, (_, i) => 2 ** (i - 16));
		const frames = framesFor([lo.map(() => 60000), lo, lo.map(v => v * 2), lo.map(() => 1)]);
		let demo;
		try {
			demo = createDemo(root, frames); await Promise.resolve();

			async function checkMasks(height) {
				const u = demo.plot, axis = u.axes[1], seen = {};
				const values = axis.values, grid = axis.grid.filter, ticks = axis.ticks.filter;
				axis.values = (...args) => seen.labels = values(...args);
				axis.grid.filter = (...args) => {
					seen.raw = args[1];
					return seen.grid = grid(...args);
				};
				axis.ticks.filter = (...args) => seen.ticks = ticks(...args);
				try {
					if (height == null) u.redraw(true, true);
					else u.setSize({ width: u.width, height });
					await Promise.resolve();
					const mask = splits => splits.map(v => v != null);
					assert.ok(seen.labels && seen.grid && seen.ticks, 'all Y callbacks run');
					assert.deepEqual(mask(seen.grid), mask(seen.labels), 'grid follows visible labels');
					assert.deepEqual(mask(seen.ticks), mask(seen.labels), 'ticks follow visible labels');
					const visible = seen.grid.filter(v => v != null);
					assert.ok(visible.length > 1, 'multiple labels remain visible');
					if (select.value != 'linear')
						assert.ok(visible.length < seen.raw.length, 'log/asinh density is reduced');
					if (signed.checked && select.value == 'asinh') {
						assert.ok(visible.some(v => v < 0) && visible.some(v => v > 0), 'both signed halves have labels');
						assert.ok(visible.includes(0), 'zero stays visible');
						assert.deepEqual(visible, visible.slice().reverse().map(v => v == 0 ? 0 : -v), 'labels are mirrored');
					}
					return visible.length;
				}
				finally { axis.values = values; axis.grid.filter = grid; axis.ticks.filter = ticks; }
			}

			await checkMasks();
			signed.checked = true; signed.dispatchEvent(new Event('change')); await Promise.resolve();
			assert.equal(select.value, 'asinh');
			await checkMasks();
			const shortCount = await checkMasks(320);
			assert.ok(await checkMasks(960) > shortCount, 'taller plots show more labels, grid lines, and ticks');
			for (const mode of ['linear', 'asinh']) {
				select.value = mode; select.dispatchEvent(new Event('change')); await Promise.resolve();
				await checkMasks();
			}
			signed.checked = false; signed.dispatchEvent(new Event('change')); await Promise.resolve();
			await checkMasks(320);
			for (const mode of ['log', 'log10']) {
				select.value = mode; select.dispatchEvent(new Event('change')); await Promise.resolve();
				await checkMasks();
			}
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('redraws color scales in place, recreates Y scales with the selected color, and cleans up all control listeners', async () => {
		const frames = sparseFrames(), snapshot = JSON.stringify(frames);
		const root = createDemoRoot();
		const height = root.querySelector('#height'), button = root.querySelector('#set-data'), select = root.querySelector('#y-scale');
		const signed = root.querySelector('#signed-data'), color = root.querySelector('#color-scale');
		assert.ok(color, 'the color-scale selector exists');
		assert.equal(color.tagName, 'SELECT');
		assert.deepEqual(Array.from(color.options, o => o.value), ['linear', 'sqrt', 'cbrt', 'log']);
		assert.equal(color.querySelector('option[value="log"]').textContent, 'Log');
		assert.equal(color.value, 'linear');
		assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels.linear);
		assert.ok(signed, 'the signed-data checkbox exists');
		assert.equal(signed.type, 'checkbox');
		assert.equal(signed.checked, false);
		assert.deepEqual(Array.from(select.options, o => o.value), ['log', 'log10', 'linear', 'asinh']);
		assert.equal(select.value, 'log');
		assert.ok(height.disabled && button.disabled && select.disabled && signed.disabled && color.disabled);
		const registrations = [], removals = [], restore = [];
		for (const [target, type] of [[height, 'input'], [button, 'click'], [select, 'change'], [signed, 'change'], [color, 'change'], [window, 'resize']]) {
			for (const [method, records] of [['addEventListener', registrations], ['removeEventListener', removals]]) {
				const original = target[method];
				target[method] = function(name, listener, capture) {
					if (name == type) records.push([target, name, listener, capture]);
					return original.call(this, name, listener, capture);
				};
				restore.push(() => { target[method] = original; });
			}
		}
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			const originalData = demo.plot.data, dataSnapshot = structuredClone(originalData);
			const minY = originalData[1][1].reduce((a, b) => Math.min(a, b), Infinity);
			const maxY = originalData[1][2].reduce((a, b) => Math.max(a, b), -Infinity);
			const minCount = originalData[1][3].reduce((a, b) => Math.min(a, b), Infinity);
			const maxCount = originalData[1][3].reduce((a, b) => Math.max(a, b), -Infinity);
			assert.ok(!height.disabled && !button.disabled && !select.disabled && !signed.disabled && !color.disabled);
			assert.equal(registrations.filter(([target]) => target == color).length, 1);
			assert.equal(color.value, 'linear');
			assert.equal(color.querySelector('option[value="log"]').disabled, false);
			assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels.linear);

			async function changeColor(mode) {
				const u = demo.plot, data = u.data, facets = data[1].slice();
				const state = () => [u.width, u.height, u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max,
					u.scales.y.distr, u.scales.y._asinh, select.value, signed.checked, root.querySelector('#status').textContent];
				const before = state(), logLength = u.ctx.log.length;
				const setData = u.setData, destroy = u.destroy, redraw = u.redraw;
				let redraws = 0, prepares = 0;
				const onData = () => prepares++;
				u.hooks.setData.push(onData);
				u.setData = () => assert.fail('color selection must not call setData');
				u.destroy = () => assert.fail('color selection must not destroy the plot');
				u.redraw = (...args) => { redraws++; return redraw(...args); };
				try {
					color.value = mode;
					withoutColorMath(() => color.dispatchEvent(new Event('change')));
					await Promise.resolve();
					assert.ok(redraws > 0, 'selection requests a redraw');
					assert.ok(u.ctx.log.length > logLength, 'selection renders immediately');
					assert.equal(prepares, 0, 'selection does not prepare geometry');
					assert.equal(demo.plot, u);
					assert.equal(root.querySelectorAll('.uplot').length, 1);
					assert.equal(u.data, data);
					facets.forEach((facet, i) => assert.equal(u.data[1][i], facet));
					assert.deepEqual(u.data, dataSnapshot);
					assert.deepEqual(state(), before, 'color selection preserves dimensions, zoom, and Y settings');
					assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels[mode]);
				}
				finally {
					u.setData = setData; u.destroy = destroy; u.redraw = redraw;
					u.hooks.setData.splice(u.hooks.setData.indexOf(onData), 1);
				}
			}
			assert.equal(demo.plot.height, 560);
			height.value = '720'; height.dispatchEvent(new Event('input'));
			await Promise.resolve();
			assert.equal(demo.plot.height, 720);
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			let destroyed = 0, dataCalls = 0, sizeCalls = 0;
			for (const [mode, distr, retainedColor] of [['linear', 1, 'linear'], ['asinh', 4, 'log'], ['log', 3, 'log'], ['asinh', 4, 'log']]) {
				const old = demo.plot;
				old.setSize({ width: 777, height: 720 });
				old.setScale('x', { min: 60, max: 240 });
				old.setScale('y', { min: .01, max: 1 });
				await Promise.resolve();
				for (const colorMode of [...colorModes, retainedColor]) await changeColor(colorMode);
				const destroy = old.destroy;
				old.destroy = () => { destroyed++; destroy(); };
				const oldDistr = old.scales.y.distr;
				Object.defineProperty(old.scales.y, 'distr', { configurable: true, get: () => oldDistr,
					set() { throw new Error('Changing display scale must not mutate the existing scale'); } });
				select.value = mode; select.dispatchEvent(new Event('change'));
				await Promise.resolve();
				const u = demo.plot;
				assert.notEqual(u, old);
				assert.equal(old.root.isConnected, false);
				assert.equal(root.querySelectorAll('.uplot').length, 1);
				assert.equal(u.data, originalData);
				assert.deepEqual(u.data, dataSnapshot);
				assert.deepEqual([u.width, u.height], [777, 720]);
				assert.equal(select.value, mode);
				assert.equal(color.value, retainedColor, 'Y recreation retains the color scale');
				assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels[retainedColor]);
				checkDemoColors(u, retainedColor, minCount, maxCount);
				assert.equal(u.scales.y.distr, distr);
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 480]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], mode == 'log' ? [2 ** -16, 2 ** -4] : mode == 'asinh' ? [0, 2 ** -4] : linearDemoBounds(u, 0, maxY));
				assert.equal(u.scales.y.asinh(u, 'y'), minY);
				if (mode == 'asinh') {
					for (const change of [() => u.redraw(), () => u.setScale('y', { min: .02, max: 2 }), () => u.setSize({ width: 777, height: 720 })]) {
						change(); await Promise.resolve();
						assert.equal(u.scales.y._asinh, minY, 'threshold does not adapt to zoom or redraw');
					}
				}
				const setData = u.setData, setSize = u.setSize;
				let prepares = 0;
				u.hooks.setData.push(() => prepares++);
				u.setData = next => { assert.equal(next, originalData); dataCalls++; setData(next); };
				u.setSize = size => { sizeCalls++; setSize(size); };
				button.click(); await Promise.resolve();
				assert.equal(prepares, 1);
				window.dispatchEvent(new Event('resize')); await Promise.resolve();
				assert.equal(u.height, 720);
				assert.equal(prepares, 1, 'resize does not prepare geometry');
			}
			assert.equal(destroyed, 4);
			assert.equal(dataCalls, 4);
			assert.equal(JSON.stringify(frames), snapshot);
			assert.equal(registrations.filter(([target]) => target == color).length, 1, 'recreation does not duplicate color listeners');
			const latest = demo.plot, beforeSize = sizeCalls;
			let redrawsAfterDestroy = 0;
			latest.redraw = () => redrawsAfterDestroy++;
			const destroy = latest.destroy;
			latest.destroy = () => { destroyed++; destroy(); };
			demo.destroy();
			assert.equal(destroyed, 5);
			assert.deepEqual(removals, registrations, 'each control/window listener is removed with the same function and capture flag');
			assert.ok(height.disabled && button.disabled && select.disabled && signed.disabled && color.disabled);
			height.dispatchEvent(new Event('input')); button.dispatchEvent(new MouseEvent('click'));
			select.dispatchEvent(new Event('change')); signed.dispatchEvent(new Event('change')); window.dispatchEvent(new Event('resize'));
			color.value = 'linear'; color.dispatchEvent(new Event('change')); await Promise.resolve();
			assert.equal(redrawsAfterDestroy, 0);
			assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels.log);
			assert.equal(demo.plot, latest);
			assert.equal(sizeCalls, beforeSize); assert.equal(dataCalls, 4); assert.equal(destroyed, 5);
			demo = null;
		}
		finally { demo?.destroy(); restore.forEach(fn => fn()); root.remove(); }
	});

	for (const initialMode of ['log', 'log10', 'linear', 'asinh']) {
		it(`toggles signed demo data from ${initialMode}, preserves dimensions, and restores log availability`, async () => {
			const root = createDemoRoot(), select = root.querySelector('#y-scale'), signed = root.querySelector('#signed-data');
			select.value = initialMode;
			const color = root.querySelector('#color-scale');
			assert.ok(signed, 'the signed-data checkbox exists');
			const frames = framesFor([[60000, 60000, 120000, 240000, 240000], [1, 4, 2, 1, 2], [2, 8, 4, 2, 4], [1, 2, 3, 4, 2]]);
			const snapshot = JSON.stringify(frames), threshold = 1;
			let demo;
			try {
				demo = createDemo(root, frames); await Promise.resolve();
				const original = demo.plot.data, originalSnapshot = structuredClone(original), old = demo.plot;
				color.value = 'log'; color.dispatchEvent(new Event('change')); await Promise.resolve();
				checkDemoColors(old, 'log', 1, 4);
				old.setSize({ width: 777, height: 640 }); await Promise.resolve();
				let destroyed = 0;
				const destroy = old.destroy;
				old.destroy = () => { destroyed++; destroy(); };
				signed.checked = true; signed.dispatchEvent(new Event('change')); await Promise.resolve();
				const data = demo.plot.data, [xs, lo, hi, counts] = data[1];
				assert.equal(destroyed, 1); assert.equal(old.root.isConnected, false);
				assert.equal(root.querySelectorAll('.uplot').length, 1);
				assert.deepEqual([demo.plot.width, demo.plot.height], [777, 640]);
				assert.equal(select.value, initialMode.startsWith('log') ? 'asinh' : initialMode);
				assert.equal(color.value, 'log', 'signed recreation retains color selection');
				assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels.log);
				checkDemoColors(demo.plot, 'log', 1, 4);
				for (const option of select.querySelectorAll('option[value^="log"]')) assert.equal(option.disabled, true);
				assert.notEqual(data, original);
				assert.equal(xs.length, original[1][0].length * 2);
				let index = 0;
				for (const x of new Set(original[1][0])) {
					const ids = original[1][0].flatMap((v, i) => v == x ? [i] : []);
					for (const i of ids.slice().reverse()) {
						assert.deepEqual([xs[index], lo[index], hi[index], counts[index]],
							[x, -original[1][2][i], -original[1][1][i], original[1][3][i]]);
						index++;
					}

					for (const i of ids) {
						assert.deepEqual([xs[index], lo[index], hi[index], counts[index]], original[1].map(a => a[i]));
						index++;
					}
				}
				assert.equal(index, xs.length);
				const f = sourceFixture(data, 60);
				for (const mode of ['linear', 'asinh']) {
					select.value = mode; select.dispatchEvent(new Event('change')); await Promise.resolve();
					const u = demo.plot;
					assert.equal(u.data, data); assert.deepEqual([u.width, u.height], [777, 640]);
					assert.equal(u.scales.y.distr, mode == 'linear' ? 1 : 4);
					assert.equal(color.value, 'log');
					checkDemoColors(u, 'log', 1, 4);
					for (const colorMode of [...colorModes, 'log']) {
						u.setScale('x', { min: 20, max: 220 });
						u.setScale('y', { min: -6, max: 6 }); await Promise.resolve();
						color.value = colorMode; color.dispatchEvent(new Event('change')); await Promise.resolve();
						assert.equal(demo.plot, u); assert.equal(u.data, data);
						assert.equal(signed.checked, true); assert.equal(select.value, mode);
						assert.deepEqual([u.width, u.height], [777, 640]);
						assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], [20, 220, -6, 6]);
						assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels[colorMode]);
						checkDemoColors(u, colorMode, 1, 4);
						u.setSize({ width: 800, height: 480 }); await Promise.resolve();
						assert.equal(color.value, colorMode); checkDemoColors(u, colorMode, 1, 4);
						u.setSize({ width: 777, height: 640 });
					}
					u.setScale('x', { min: 0, max: 240 }); u.setScale('y', { min: -8, max: 8 }); await Promise.resolve();
					assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 240]);
					assert.deepEqual([u.scales.y.min, u.scales.y.max], [-8, 8]);
					assert.equal(u.scales.y.asinh(u, 'y'), threshold);
					if (mode == 'asinh') assert.equal(u.scales.y._asinh, threshold);
					checkOracle(u, f);
					const boxes = oracleRects(u, f);
					hover(u, 30, 0, null);
					for (const sign of [-1, 1]) {
						const box = boxes.find(b => Math.sign(lo[b.id] + hi[b.id]) == sign);
						assert.ok(box, `visible ${sign} row`);
						const [x, y, w, h] = box.rect;
						u.setCursor({ left: (x + w / 2 - u.bbox.left) / u.pxRatio, top: (y + h / 2 - u.bbox.top) / u.pxRatio });
						assert.equal(u.cursor.dataIdx(u, 1), box.id);
						const format = v => Number(v.toPrecision(5)).toString();
						assert.ok(root.querySelector('#hover').textContent.includes(`Y: ${lo[box.id]} s–${hi[box.id]} s`));
						assert.ok(root.querySelector('#hover').textContent.includes(`Count: ${format(counts[box.id])}`));
					}
					const setData = u.setData;
					let calls = 0;
					u.setData = next => { calls++; assert.equal(next, data); setData(next); };
					root.querySelector('#set-data').click(); await Promise.resolve();
					assert.equal(calls, 1); checkOracle(u, f);
				}
				const lastSigned = demo.plot;
				signed.checked = false; signed.dispatchEvent(new Event('change')); await Promise.resolve();
				assert.equal(lastSigned.root.isConnected, false);
				for (const option of select.querySelectorAll('option[value^="log"]')) assert.equal(option.disabled, false);
				assert.equal(demo.plot.data, original);
				assert.equal(color.value, 'log'); checkDemoColors(demo.plot, 'log', 1, 4);
				assert.deepEqual(original, originalSnapshot); assert.equal(JSON.stringify(frames), snapshot);
				select.value = 'log'; select.dispatchEvent(new Event('change')); await Promise.resolve();
				assert.equal(demo.plot.scales.y.distr, 3);
				assert.equal(color.value, 'log'); checkDemoColors(demo.plot, 'log', 1, 4);
				assert.deepEqual([demo.plot.scales.y.min, demo.plot.scales.y.max], [1, 8]);
				assert.deepEqual([demo.plot.width, demo.plot.height], [777, 640]);
				checkOracle(demo.plot, sourceFixture(original, 60));
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('uses prepared signed replacement ranges and nearest absolute bounds without core scans or stale data on recreation', async () => {
		const root = createDemoRoot(), signed = root.querySelector('#signed-data'), select = root.querySelector('#y-scale');
		assert.ok(signed, 'the signed-data checkbox exists');
		signed.checked = true;
		const frames = framesFor([[60000, 60000], [1, 2], [2, 4], [1, 4]]);
		let demo;
		try {
			demo = createDemo(root, frames); await Promise.resolve();
			assert.equal(select.value, 'asinh', 'an initially checked signed control also disallows log display');
			const replacement = [null, [[300, 300, 360, 360], [-8, -2, -4, -1], [-4, -1, -2, -.5], [1, 2, 3, 4]]];
			demo.plot.setData(replacement); await Promise.resolve();
			const noReads = new Proxy({}, { get() { throw new Error('Prepared metadata callbacks must not scan the chart'); } });
			for (const mode of ['asinh', 'linear', 'asinh']) {
				select.value = mode; select.dispatchEvent(new Event('change')); await Promise.resolve();
				const u = demo.plot;
				assert.equal(u.data, replacement, 'display changes retain externally replaced data');
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [240, 360]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], mode == 'linear' ? linearDemoBounds(u, -8, 0) : [-8, 0]);
				assert.equal(u.scales.y.asinh(noReads, 'y'), .5, 'nearest edge is not the signed minimum');
				assert.deepEqual(u.scales.x.range(noReads, null, null, 'x'), [240, 360]);
				if (mode != 'linear') assert.deepEqual(u.scales.y.range(noReads, null, null, 'y'), [-8, 0]);
				assert.deepEqual(u.scales.x.scan(noReads, 'x'), [null, null]);
				assert.deepEqual(u.scales.y.scan(noReads, 'y'), mode == 'linear' ? [-8, 0] : [null, null]);
				if (mode == 'asinh') assert.equal(u.scales.y._asinh, .5);
				checkOracle(u, sourceFixture(replacement, 60));
				root.querySelector('#set-data').click(); await Promise.resolve();
				assert.equal(u.data, replacement, 'the same-data button reads plot.data rather than the original fixture');
				checkOracle(u, sourceFixture(replacement, 60));
			}
			const u = demo.plot;
			for (const facet of [1, 2]) replacement[1][facet].forEach((v, i, a) => { a[i] = v * 2; });
			replacement[1][0].forEach((v, i, a) => { a[i] = v + 60; });
			u.setData(replacement); await Promise.resolve();
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [300, 420]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [-16, 0]);
			assert.equal(u.scales.y._asinh, 1);
			u.setData(empty()); await Promise.resolve();
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [300, 420]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [-16, 0]);
			assert.equal(u.scales.y.asinh(noReads, 'y'), 1);
			assert.deepEqual(rects(u), []);
			u.setData(replacement); await Promise.resolve();
			checkOracle(u, sourceFixture(replacement, 60));
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const signed of [false, true]) {
		for (const mode of signed ? ['linear', 'asinh'] : ['log', 'linear', 'asinh']) {
			it(`applies demo minAbs to ${signed ? 'signed' : 'positive'} data on ${mode} display`, async () => {
				const root = createDemoRoot();
				root.querySelector('#signed-data').checked = signed;
				root.querySelector('#y-scale').value = mode;
				const cutoff = demoMinAbs;
				const lo = [cutoff / 4, cutoff / 2, cutoff, cutoff * 2, cutoff * 4];
				const frames = framesFor([lo.map(() => 60000), lo, lo.map(v => v * 2), lo.map((_, i) => i + 1)]);
				let demo;
				try {
					demo = createDemo(root, frames); await Promise.resolve();
					const u = demo.plot, snapshot = structuredClone(u.data);
					assert.equal(u.data[1][0].length, lo.length * (signed ? 2 : 1));
					assert.equal(u.scales.y.asinh(u, 'y'), cutoff * 2, 'edges equal to minAbs do not qualify on any display');
					if (mode == 'asinh') assert.equal(u.scales.y._asinh, cutoff * 2);
					const prepared = [signed ? -8 * cutoff : mode == 'log' ? cutoff / 4 : 0, 8 * cutoff];
					assert.deepEqual(u.scales.y.scan(u, 'y'), mode == 'linear' ? prepared : [null, null]);
					if (mode == 'linear') assert.deepEqual([u.scales.y.min, u.scales.y.max], linearDemoBounds(u, ...prepared));
					else assert.deepEqual(u.scales.y.range(u, null, null, 'y'), prepared);
					checkOracle(u, sourceFixture(u.data, 60), cutoff);
					checkDemoColors(u, root.querySelector('#color-scale').value, 1, 5);
					for (const sign of signed ? [-1, 1] : [1]) hover(u, 30, sign * cutoff * .75, null);
					u.setSize({ width: 777, height: 413 }); await Promise.resolve();
					checkOracle(u, sourceFixture(u.data, 60), cutoff);
					assert.deepEqual(u.data, snapshot);
					const skipped = signed ? [null, [[60, 60], [-cutoff, cutoff / 2], [-cutoff / 2, cutoff], [1, 1]]] :
						[null, [[60], [cutoff / 2], [cutoff], [1]]];
					u.setData(skipped); await Promise.resolve();
					assert.equal(u.scales.y.asinh(u, 'y'), 1, 'all-skipped data uses fallback 1');
					checkOracle(u, sourceFixture(skipped, 60), cutoff);
					assert.deepEqual(rects(u), []);
					u.setData(empty()); await Promise.resolve();
					assert.equal(u.scales.y.asinh(u, 'y'), 1);
					assert.deepEqual(rects(u), []);
					u.setData(snapshot); await Promise.resolve();
					assert.equal(u.scales.y.asinh(u, 'y'), cutoff * 2);
					checkOracle(u, sourceFixture(snapshot, 60), cutoff);
				}
				finally { demo?.destroy(); root.remove(); }
			});
		}
	}

	it('refreshes the cached asinh threshold on replacement, in-place, and empty setData', async () => {
		const root = createDemoRoot();
		root.querySelector('#y-scale').value = 'asinh';
		const frames = framesFor([[60000, 60000, 120000, 120000], [1, 2, 1, 4], [2, 4, 2, 8], [1, 2, 3, 4]]);
		let demo;
		try {
			demo = createDemo(root, frames);
			await Promise.resolve();
			const u = demo.plot;
			const before = u.valToPos(1, 'y');
			const noReads = new Proxy(u, { get() { throw new Error('Threshold callback must use prepared metadata'); } });
			const checkThreshold = (expected, range = [0, 8]) => {
				assert.equal(u.scales.y.asinh(noReads, 'y'), expected);
				assert.equal(u.scales.y._asinh, expected);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], range);
				assert.deepEqual(u.scales.y.scan(u, 'y'), [null, null]);
			};
			checkThreshold(1);
			// The lowest row is in a later column; the display range includes zero.
			const next = [null, [[60, 60, 120, 120], [2, 4, .25, 1], [4, 8, .5, 2], [1, 2, 3, 4]]];
			u.setData(next); await Promise.resolve();
			checkThreshold(.25);
			assert.notEqual(u.valToPos(1, 'y'), before, 'the new threshold changes projection despite unchanged scale bounds');
			for (const facet of [1, 2]) for (let i = 0; i < next[1][facet].length; i++) next[1][facet][i] /= 2;
			u.setData(next); await Promise.resolve();
			checkThreshold(.125, [0, 4]);
			for (const change of [() => u.redraw(), () => u.setSize({ width: 777, height: 640 })]) {
				change(); await Promise.resolve();
				checkThreshold(.125, [0, 4]);
			}
			for (const facet of [1, 2]) for (let i = 0; i < next[1][facet].length; i++) next[1][facet][i] *= 2;
			u.setData(next, false);
			assert.equal(u.scales.y.asinh(noReads, 'y'), .25, 'setData prepares the new threshold even when drawing is deferred');
			u.redraw(); await Promise.resolve();
			checkThreshold(.25);
			assert.deepEqual(u.scales.y.range(u, null, null, 'y'), [0, 8], 'deferred setData still refreshes prepared range metadata');
			u.setData(next); await Promise.resolve(); checkThreshold(.25);
			u.setData(empty()); await Promise.resolve();
			checkThreshold(1);
			assert.equal(rects(u).length, 0);
			u.setData(next); await Promise.resolve();
			checkThreshold(.25);
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const mode of ['log', 'linear', 'asinh']) {
		it(`skips core data scans with prepared ${mode} bounds`, async () => {
			const root = createDemoRoot();
			root.querySelector('#y-scale').value = mode;
			const frames = framesFor([[60000, 60000, 120000, 120000], [1, 2, 1, 2], [2, 4, 2, 4], [1, 2, 3, 4]]);
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				let scanning = false, calls = 0;
				let prepared = [0, 4];
				for (let fi = 0; fi < 3; fi++) {
					u.data[1][fi] = new Proxy(u.data[1][fi], { get(target, key) {
						if (scanning) throw new Error('Core scanner must not read heatmap coordinates');
						return target[key];
					} });
				}
				for (const key of ['x', 'y']) {
					const scan = u.scales[key].scan;
					u.scales[key].scan = (...args) => {
						scanning = true;
						calls++;
						try {
							const result = scan(...args);
							assert.deepEqual(result, key == 'y' && mode == 'linear' ? prepared : [null, null]);
							return result;
						}
						finally { scanning = false; }
					};
				}
				const checkRange = () => {
					assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 120]);
					assert.deepEqual([u.scales.y.min, u.scales.y.max], mode == 'linear' ? linearDemoBounds(u, 0, 4) : [mode == 'log' ? 1 : 0, 4]);
					if (mode == 'asinh') assert.equal(u.scales.y._asinh, 1);
					assert.equal(rects(u).length, 4);
				};
				checkRange();
				for (const change of [() => u.setData(u.data), () => u.setSize({ width: 800, height: 600 }), () => u.redraw()]) {
					change(); await Promise.resolve();
					checkRange();
				}
				assert.ok(calls >= 2, 'range calculation called the metadata/no-op scanners');
				u.setScale('x', { min: 20, max: 100 });
				u.setScale('y', { min: 1.25, max: 3 });
				await Promise.resolve();
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [20, 100]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [1.25, 3]);
				u.setData(u.data); await Promise.resolve();
				checkRange();
				const next = [null, [[300, 300, 420, 420], [4, 8, .25, 2], [8, 16, .5, 4], [1, 2, 3, 4]]];
				for (let fi = 0; fi < 3; fi++) {
					next[1][fi] = new Proxy(next[1][fi], { get(target, key) {
						if (scanning) throw new Error('Core scanner must not read replacement coordinates');
						return target[key];
					} });
				}
				prepared = [0, 16];
				u.setData(next); await Promise.resolve();
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [240, 420]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], mode == 'linear' ? linearDemoBounds(u, 0, 16) : [mode == 'log' ? .25 : 0, 16]);
				assert.equal(u.scales.y.asinh(u, 'y'), .25);
				checkOracle(u, sourceFixture(next, 60));
				u.setData(empty()); await Promise.resolve();
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [240, 420]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], mode == 'linear' ? linearDemoBounds(u, 0, 16) : [mode == 'log' ? .25 : 0, 16]);
				assert.equal(u.scales.y.asinh(u, 'y'), 1);
				assert.deepEqual(rects(u), []);
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('disables log for a huge count ratio and falls back to linear without giant allocations', async () => {
		for (const initial of [null, 'log']) {
			const root = createDemoRoot(), color = root.querySelector('#color-scale');
			if (initial != null) color.value = initial;
			const counts = [1, 10, 1e3, 1e6, 1e9, 1e12];
			const frames = framesFor([counts.map((_, i) => (i + 1) * 60000), counts.map(() => 1), counts.map(() => 2), counts]);
			const names = ['Array', 'ArrayBuffer', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array'];
			const originals = names.map(name => globalThis[name]);
			const guard = args => {
				if (typeof args[0] == 'number') assert.ok(args[0] <= 2 ** 24, 'reject oversized grids before allocating');
			};
			let demo;
			try {
				names.forEach((name, i) => {
					globalThis[name] = new Proxy(originals[i], {
						construct(target, args) { guard(args); return Reflect.construct(target, args); },
						apply(target, receiver, args) { guard(args); return Reflect.apply(target, receiver, args); },
					});
				});
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				assert.equal(color.querySelector('option[value="log"]').disabled, true);
				assert.equal(color.disabled, false, 'linear and root modes remain available');
				assert.equal(color.value, 'linear');
				assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels.linear);
				checkDemoColors(u, 'linear', 1, 1e12);
				const legend = root.querySelector('#color-ramp').style.background;
				color.value = 'log';
				withoutColorMath(() => color.dispatchEvent(new Event('change')));
				await Promise.resolve();
				assert.equal(color.value, 'linear', 'an unavailable changed selection also falls back');
				assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels.linear);
				assert.equal(root.querySelector('#color-ramp').style.background, legend);
				assert.equal(demo.plot, u);
				checkDemoColors(u, 'linear', 1, 1e12);
				for (const size of [11, 32, 24]) {
					const slider = root.querySelector('#color-count');
					slider.value = `${size}`;
					slider.dispatchEvent(new Event('input'));
					await Promise.resolve();
					assert.equal(color.querySelector('option[value="log"]').disabled, true);
					assert.equal(color.value, 'linear');
				}
				checkDemoColors(u, 'linear', 1, 1e12);
			}
			finally {
				names.forEach((name, i) => { globalThis[name] = originals[i]; });
				demo?.destroy(); root.remove();
			}
		}
	});

	it('uses exact linear/root colors and independently bounded log colors across transitions and constant count ranges', async () => {
		const fixtures = [[1, 2], [.125, 2048], [1e-5, .01]].map(([min, max]) => [
			min, max,
			...Array.from({ length: 256 }, (_, i) => min + (max - min) * (i + 1) / 257),
			...colorModes.flatMap(mode => colorBoundaryCounts(mode, min, max)),
		]);
		for (const counts of [...fixtures, Array(16).fill(1.234)]) {
			const xs = counts.map((_, i) => 1698437760000 + i * 60000);
			const frames = framesFor([xs, counts.map(() => .01), counts.map(() => .02), counts]);
			const root = createDemoRoot();
			let demo;
			try {
				demo = createDemo(root, frames);
				await Promise.resolve();
				const u = demo.plot;
				const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
				const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
				const color = root.querySelector('#color-scale');
				assert.equal(color.value, 'linear');
				checkDemoColors(u, 'linear', min, max);
				for (const mode of [...colorModes, ...colorModes]) {
					color.value = mode;
					withoutColorMath(() => color.dispatchEvent(new Event('change')));
					await Promise.resolve();
					assert.equal(demo.plot, u);
					assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels[mode]);
					checkDemoColors(u, mode, min, max);
					// Isolate the plugin from core axis math when checking its hot path.
					withoutColorMath(() => u.hooks.draw[0](u));
					checkDemoColors(u, mode, min, max);
					const paths = fills(u).slice(-24);
					assert.ok(pathRects(paths[0]).length > 0, 'minimum uses palette index 0');
					if (min != max)
						assert.ok(pathRects(paths[23]).length > 0, 'maximum uses palette index 23');
					else
						assert.deepEqual(paths.map(path => pathRects(path).length), [counts.length, ...Array(23).fill(0)]);
				}
			}
			finally { demo?.destroy(); root.remove(); }
		}
	});

	it('reuses setup color tables and the original count domain after setData, without scans or preparation on redraw', async () => {
		const root = createDemoRoot(), color = root.querySelector('#color-scale');
		root.querySelector('#y-scale').value = 'linear';
		const min = 1, max = 64;
		const initial = [1, 2, 4, 8, 32, 64];
		const frames = framesFor([initial.map((_, i) => (i + 1) * 60000), initial.map(() => 1), initial.map(() => 2), initial]);
		let demo;
		try {
			demo = createDemo(root, frames); await Promise.resolve();
			const u = demo.plot;
			let drawing = false, prepares = 0, dataCalls = 0, redraws = 0;
			let reads = [];
			const setData = u.setData, redraw = u.redraw;
			u.setData = (...args) => { dataCalls++; return setData(...args); };
			u.redraw = (...args) => { redraws++; return redraw(...args); };
			u.hooks.setData.push(() => prepares++);

			function watchData(data) {
				// Accessors also observe the original arrays retained by createDemo closures.
				data[1].forEach((facet, fi) => facet.forEach((value, i) => {
					Object.defineProperty(facet, i, { configurable: true, enumerable: true,
						get() {
							if (drawing) {
								assert.equal(fi, 3, 'redraw must use prepared geometry, not read source coordinates');
								reads.push(i);
							}
							return value;
						},
						set(next) { value = next; },
					});
				}));
			}

			async function checkRedraw(mode, select) {
				const data = u.data, before = [dataCalls, prepares, redraws];
				const visible = data[1][3].flatMap((_, i) => {
					const rect = bounds(u, i, true, 60);
					return rect[2] > 0 && rect[3] > 0 ? [i] : [];
				});
				reads = []; drawing = true;
				try {
					if (select) {
						color.value = mode;
						withoutColorMath(() => color.dispatchEvent(new Event('change')));
					}
					else u.redraw();
					await Promise.resolve();
					assert.equal(redraws, before[2] + 1);
					assert.deepEqual(reads, visible, 'one count read per visible cell, no count-domain scan');
					reads = [];
					withoutColorMath(() => u.hooks.draw[0](u));
					assert.deepEqual(reads, visible, 'cached color tables also serve repeated plugin draws');
				}
				finally { drawing = false; }
				assert.equal(demo.plot, u); assert.equal(u.data, data);
				assert.deepEqual([dataCalls, prepares], before.slice(0, 2));
				assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels[mode]);
				assert.equal(root.querySelector('#color-min').textContent, '1');
				assert.equal(root.querySelector('#color-max').textContent, '64');
				checkDemoColors(u, mode, min, max);
			}

			watchData(u.data);
			for (let phase = 0; phase < 3; phase++) {
				if (phase == 1) {
					// All replacement counts are inside the original domain; none were in the fixture.
					const counts = colorModes.flatMap(mode => colorBoundaryCounts(mode, min, max));
					const next = [null, [counts.map((_, i) => (i + 1) * 60), counts.map(() => 1), counts.map(() => 2), counts]];
					watchData(next); u.setData(next); await Promise.resolve();
					assert.equal(u.data, next);
				}
				else if (phase == 2) {
					u.data[1][3].reverse(); u.setData(u.data); await Promise.resolve();
				}
				assert.deepEqual([dataCalls, prepares], [phase, phase]);
				// Keep offscreen counts so a full-domain scan cannot masquerade as drawing.
				u.setScale('x', { min: 90, max: u.data[1][0].at(-2) }); await Promise.resolve();
				for (const mode of ['log', ...colorModes]) {
					await checkRedraw(mode, true);
					await checkRedraw(mode, false);
				}
			}
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('loads 250k cells without spreading data arrays into function arguments', async function() {
		this.timeout(10000);
		const length = 250000, start = 1698437760000;
		const xs = Array.from({ length }, (_, i) => start + Math.floor(i / 250) * 60000);
		const lo = xs.map((_, i) => 2 ** (-16 + (i % 250) / 25));
		const hi = xs.map((_, i) => 2 ** (-16 + (i % 250 + 1) / 25));
		const counts = xs.map((_, i) => i % 32 + 1);
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, framesFor([xs, lo, hi, counts]));
			await Promise.resolve();
			const u = demo.plot;
			assert.equal(u.data[1][0].length, length);
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [start / 1000 - 60, start / 1000 + 999 * 60]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [2 ** -16, 2 ** -6]);
			assert.equal(root.querySelector('#color-min').textContent, '1');
			assert.equal(root.querySelector('#color-max').textContent, '32');
			assert.ok(root.querySelector('#status').textContent.startsWith(`${length.toLocaleString()} cells · 1000 one-minute intervals`));
			const drawn = rects(u);
			assert.ok(drawn.length > 0);
			const [x, y, w, h] = drawn[0];
			u.setCursor({ left: (x + w / 2 - u.bbox.left) / u.pxRatio, top: (y + h / 2 - u.bbox.top) / u.pxRatio });
			assert.notEqual(u.cursor.dataIdx(u, 1), null, 'large charts are ready without entry');
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('renders a deterministic sparse fixture with its full source count, ranges, and per-color coverage', async () => {
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, sparseFrames());
			await Promise.resolve();
			const u = demo.plot;
			assert.equal(u.mode, 2);
			assert.deepEqual(u.data[1].map(facet => facet.length), [146, 146, 146, 146]);
			assert.equal(rects(u).length, 120, '24 colors merge adjacent same-color cells');
			assert.equal(new Set(u.data[1][0]).size, 8);
			assert.equal(u.data[1][2].reduce((a, b) => Math.max(a, b), -Infinity), 2 ** -4.5);
			assert.equal(fills(u).length, 24);
			const colorChanges = lastDraw(u).filter(e => e[0] === 'fillStyle').flatMap(e => e.slice(1)).filter(fill => fill.startsWith('rgb('));
			assert.equal(colorChanges.length, 24);
			assert.equal(new Set(colorChanges).size, 24);
			assert.equal(colorChanges[0], 'rgb(94,79,162)');
			assert.equal(colorChanges[23], 'rgb(158,1,66)');
			const counts = u.data[1][3];
			const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
			const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
			const color = root.querySelector('#color-scale');
			const format = v => Number(v.toPrecision(5)).toString();
			for (const mode of colorModes) {
				color.value = mode; color.dispatchEvent(new Event('change')); await Promise.resolve();
				assert.equal(demo.plot, u);
				assert.equal(u.data[1][3], counts);
				checkDemoColors(u, mode, min, max);
				checkOracle(u, sourceFixture(u.data, 60));
				assert.deepEqual(lastDraw(u).filter(e => e[0] === 'fillStyle').flatMap(e => e.slice(1)).filter(fill => fill.startsWith('rgb(')), colorChanges,
					'all modes retain the same ordered Spectral palette');
				assert.equal(root.querySelector('#color-scale-label').textContent, colorLabels[mode]);
				assert.equal(root.querySelector('#color-min').textContent, format(min));
				assert.equal(root.querySelector('#color-max').textContent, format(max));
			}
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 480]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [2 ** -16, 2 ** -4]);
			assert.equal(u.scales.y.distr, 3);
			assert.equal(u.scales.y.log, 2);
			assert.ok(root.querySelector('#status').textContent.startsWith('146 cells · 8 one-minute intervals'));
		}
		finally { demo?.destroy(); root.remove(); }
	});
});
