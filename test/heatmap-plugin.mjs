import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from '../demos/lib/heatmapPlugin.js';
import { createDemo } from '../demos/heatmap-sparse.js';
import Flatbush from '../demos/lib/flatbush.js';

const empty = () => [null, [[], [], [], []]];
const enter = u => u.over.dispatchEvent(new MouseEvent('mouseenter'));
const leave = u => u.over.dispatchEvent(new MouseEvent('mouseleave'));
const lastDraw = u => u.ctx.log.slice(u.ctx.log.findLastIndex(e => e[0] === 'clearRect'));
const fills = u => lastDraw(u).filter(e => e[0] === 'fill').flatMap(e => e.slice(1))
	.map(args => args[0]).filter(path => path?.log != null);
const pathRects = path => path.log.flatMap(e => e[0] === 'rect' ? e.slice(1) : []);
const rects = u => fills(u).flatMap(pathRects);

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
function oracleRects(u, f) {
	return f.cells.map(({ col, row }, id) => ({ id,
		rect: projectedRect(u, f.xEdges[col], f.xEdges[col + 1], f.yEdges[row], f.yEdges[row + 1]),
	})).filter(({ rect: [, , w, h] }) => w > 0 && h > 0);
}

function oracleHit(boxes, px, py) {
	let hit = null;
	for (const { id, rect: [x, y, w, h] } of boxes) {
		if (px >= x && px <= x + w && py >= y && py <= y + h)
			hit = id;
	}
	return hit;
}

function pixelQuery(u, px, py, expected) {
	u.cursor.left = (px - u.bbox.left) / u.pxRatio;
	u.cursor.top = (py - u.bbox.top) / u.pxRatio;
	assert.equal(u.cursor.dataIdx(u, 1), expected, `canvas (${px}, ${py})`);
}

function checkOracle(u, f) {
	const boxes = oracleRects(u, f);
	assert.deepEqual(rects(u), boxes.map(b => b.rect), 'one rounded, clipped rectangle per visible valid source cell');
	const probes = [];
	for (const { rect: [x, y, w, h] } of boxes) {
		probes.push([x + w / 2, y + h / 2]);
		for (const delta of [-1e-7, 0, 1e-7]) {
			probes.push([x + delta, y + h / 2], [x + w + delta, y + h / 2],
				[x + w / 2, y + delta], [x + w / 2, y + h + delta]);
		}
		probes.push([x, y], [x + w, y], [x, y + h], [x + w, y + h]);
	}
	// Sample gaps and offscreen regions as well as occupied edges.
	for (let ix = -1; ix <= 18; ix++) {
		for (let iy = -1; iy <= 14; iy++)
			probes.push([u.bbox.left + ix * u.bbox.width / 17, u.bbox.top + iy * u.bbox.height / 13]);
	}
	for (const [px, py] of probes) {
		// Match the CSS-to-canvas round trip, including fractional DPR.
		const x = u.bbox.left + (px - u.bbox.left) / u.pxRatio * u.pxRatio;
		const y = u.bbox.top + (py - u.bbox.top) / u.pxRatio * u.pxRatio;
		const expected = oracleHit(boxes, x, y);
		pixelQuery(u, px, py, expected);
		const box = u.cursor.points.bbox(u, 1);
		if (expected == null)
			assert.deepEqual(box, { left: -10, top: -10, width: 0, height: 0 });
		else {
			const [l, t, w, h] = boxes.find(b => b.id == expected).rect;
			assert.deepEqual(box, { left: (l - u.bbox.left) / u.pxRatio, top: (t - u.bbox.top) / u.pxRatio,
				width: w / u.pxRatio, height: h / u.pxRatio });
		}
	}
}

function hover(u, x, y, id) {
	u.setCursor({ left: u.valToPos(x, 'x'), top: u.valToPos(y, 'y') });
	assert.equal(u.cursor.dataIdx(u, 1), id);
}

function bounds(u, idx, canvas = false, xSize = 1) {
	const [x, lo, hi] = u.data[1];
	const rect = projectedRect(u, x[idx] - xSize, x[idx], lo[idx], hi[idx]);
	return canvas ? rect : [(rect[0] - u.bbox.left) / u.pxRatio, (rect[1] - u.bbox.top) / u.pxRatio,
		rect[2] / u.pxRatio, rect[3] / u.pxRatio];
}

function createDemoRoot() {
	const html = readFileSync(new URL('../demos/heatmap-sparse.html', import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

function dashboardFor(values) {
	const frame = { schema: { meta: { type: 'heatmap-cells' },
		fields: ['xMax', 'yMin', 'yMax', 'count'].map(name => ({ name, config: { interval: 60000 } })) },
		data: { values } };
	return { panels: [{ targets: [{ rawFrameContent: JSON.stringify([frame]) }] }] };
}
const realDashboard = () => JSON.parse(readFileSync(new URL('../demos/data/heatmap-cells-exemplars.json', import.meta.url), 'utf8'));

// Isolate plugin work from uPlot's own scans, projections, cursor updates, and allocations.
function isolated(options, data = empty(), over = document.createElement('div')) {
	const plugin = heatmapPlugin(options);
	const drawn = [], projected = { x: [], y: [] }, inverted = { x: [], y: [] };
	const u = { data, pxRatio: 1, bbox: { left: 0, top: 0, width: 100, height: 100 },
		series: [{}, { show: true }], over, cursor: { left: -10, top: -10 },
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
		assert.deepEqual(fills(u).map(path => pathRects(path).length), [0, 2, 0, 0]);
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
					assert.equal(drawn.flatMap(pathRects).length, 63 * 63);
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
			const lengths = Array.from({ length: 257 }, (_, i) => i + 1);
			lengths.push(...lengths.slice().reverse());
			const f = fixture({ x: { distr }, y: { distr: 1 }, xOrigin: -2, xSize: .01, ySize: 1,
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
				assert.deepEqual(drawn.flatMap(pathRects), f.cells.map(({ col, row }) => [col, 299 - row, 1, 1]));
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

	it('uses inverse projections once per distinct query and reuses hover boxes before mouse entry', () => {
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
			assert.deepEqual(inverted, { x: [.5], y: [99.5] });
			assert.deepEqual(calls.at(-1), [u, 0]);
			pixelQuery(u, 1.5, 98.5, 5);
			assert.equal(u.cursor.points.bbox(u, 1), box);
			assert.equal(inverted.x.length, 2);
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

describe('heatmapPlugin demo', () => {
	it('recreates Y display scales through the public API, preserves data and size, resets zoom, and cleans up listeners', async () => {
		const dashboard = realDashboard(), snapshot = JSON.stringify(dashboard);
		const root = createDemoRoot();
		const height = root.querySelector('#height'), button = root.querySelector('#set-data'), select = root.querySelector('#y-scale');
		assert.deepEqual(Array.from(select.options, o => o.value), ['log', 'linear', 'asinh']);
		assert.equal(select.value, 'log');
		assert.ok(height.disabled && button.disabled && select.disabled);
		const registrations = [], removals = [], restore = [];
		for (const [target, type] of [[height, 'input'], [button, 'click'], [select, 'change'], [window, 'resize']]) {
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
			demo = createDemo(root, dashboard);
			await Promise.resolve();
			const originalData = demo.plot.data, dataSnapshot = structuredClone(originalData);
			const minY = originalData[1][1].reduce((a, b) => Math.min(a, b), Infinity);
			const maxY = originalData[1][2].reduce((a, b) => Math.max(a, b), -Infinity);
			assert.ok(!height.disabled && !button.disabled && !select.disabled);
			assert.equal(demo.plot.height, 560);
			height.value = '720'; height.dispatchEvent(new Event('input'));
			await Promise.resolve();
			assert.equal(demo.plot.height, 720);
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			let destroyed = 0, dataCalls = 0, sizeCalls = 0;
			for (const [mode, distr] of [['linear', 1], ['asinh', 4], ['log', 3], ['asinh', 4]]) {
				const old = demo.plot;
				old.setSize({ width: 777, height: 720 });
				old.setScale('x', { min: 1698438000, max: 1698440000 });
				old.setScale('y', { min: .01, max: 1 });
				await Promise.resolve();
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
				assert.equal(u.scales.y.distr, distr);
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [1698437700, 1698459360]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], mode == 'log' ? [2 ** -16, 16] : [0, maxY]);
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
			assert.equal(JSON.stringify(dashboard), snapshot);
			const latest = demo.plot, beforeSize = sizeCalls;
			const destroy = latest.destroy;
			latest.destroy = () => { destroyed++; destroy(); };
			demo.destroy();
			assert.equal(destroyed, 5);
			assert.deepEqual(removals, registrations, 'each control/window listener is removed with the same function and capture flag');
			assert.ok(height.disabled && button.disabled && select.disabled);
			height.dispatchEvent(new Event('input')); button.dispatchEvent(new MouseEvent('click'));
			select.dispatchEvent(new Event('change')); window.dispatchEvent(new Event('resize'));
			assert.equal(demo.plot, latest);
			assert.equal(sizeCalls, beforeSize); assert.equal(dataCalls, 4); assert.equal(destroyed, 5);
			demo = null;
		}
		finally { demo?.destroy(); restore.forEach(fn => fn()); root.remove(); }
	});

	it('refreshes the cached asinh threshold on replacement, in-place, and empty setData', async () => {
		const root = createDemoRoot();
		root.querySelector('#y-scale').value = 'asinh';
		const dashboard = dashboardFor([[60000, 60000, 120000, 120000], [1, 2, 1, 4], [2, 4, 2, 8], [1, 2, 3, 4]]);
		let demo;
		try {
			demo = createDemo(root, dashboard);
			await Promise.resolve();
			const u = demo.plot;
			const range = [u.scales.y.min, u.scales.y.max];
			const before = u.valToPos(1, 'y');
			const noReads = new Proxy(u, { get() { throw new Error('Threshold callback must use prepared metadata'); } });
			const checkThreshold = expected => {
				assert.equal(u.scales.y.asinh(noReads, 'y'), expected);
				assert.equal(u.scales.y._asinh, expected);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], range);
				assert.deepEqual(u.scales.y.scan(u, 'y'), [null, null]);
			};
			checkThreshold(1);
			// The lowest row is in a later column; visible scale bounds remain unchanged.
			const next = [null, [[60, 60, 120, 120], [2, 4, .25, 1], [4, 8, .5, 2], [1, 2, 3, 4]]];
			u.setData(next); await Promise.resolve();
			checkThreshold(.25);
			assert.notEqual(u.valToPos(1, 'y'), before, 'the new threshold changes projection despite unchanged scale bounds');
			for (const facet of [1, 2]) for (let i = 0; i < next[1][facet].length; i++) next[1][facet][i] /= 2;
			u.setData(next); await Promise.resolve();
			checkThreshold(.125);
			for (const change of [() => u.redraw(), () => u.setSize({ width: 777, height: 640 })]) {
				change(); await Promise.resolve();
				checkThreshold(.125);
			}
			for (const facet of [1, 2]) for (let i = 0; i < next[1][facet].length; i++) next[1][facet][i] *= 2;
			u.setData(next, false);
			assert.equal(u.scales.y.asinh(noReads, 'y'), .25, 'setData prepares the new threshold even when drawing is deferred');
			u.redraw(); await Promise.resolve();
			checkThreshold(.25);
			u.setData(empty()); await Promise.resolve();
			checkThreshold(1);
			assert.equal(rects(u).length, 0);
			u.setData(next); await Promise.resolve();
			checkThreshold(.25);
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const mode of ['log', 'linear', 'asinh']) {
		it(`skips core data scans with precomputed ${mode} ranges`, async () => {
			const root = createDemoRoot();
			root.querySelector('#y-scale').value = mode;
			const dashboard = dashboardFor([[60000, 60000, 120000, 120000], [1, 2, 1, 2], [2, 4, 2, 4], [1, 2, 3, 4]]);
			let demo;
			try {
				demo = createDemo(root, dashboard);
				await Promise.resolve();
				const u = demo.plot;
				let scanning = false, calls = 0;
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
							assert.deepEqual(result, [null, null]);
							return result;
						}
						finally { scanning = false; }
					};
				}
				const checkRange = () => {
					assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 120]);
					assert.deepEqual([u.scales.y.min, u.scales.y.max], [mode == 'log' ? 1 : 0, 4]);
					if (mode == 'asinh') assert.equal(u.scales.y._asinh, 1);
					assert.equal(rects(u).length, 4);
				};
				checkRange();
				for (const change of [() => u.setData(u.data), () => u.setSize({ width: 800, height: 600 }), () => u.redraw()]) {
					change(); await Promise.resolve();
					checkRange();
				}
				assert.ok(calls >= 2, 'range calculation called the no-op scanners');
				u.setScale('x', { min: 20, max: 100 });
				u.setScale('y', { min: 1.25, max: 3 });
				await Promise.resolve();
				assert.deepEqual([u.scales.x.min, u.scales.x.max], [20, 100]);
				assert.deepEqual([u.scales.y.min, u.scales.y.max], [1.25, 3]);
				u.setData(u.data); await Promise.resolve();
				checkRange();
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('uses a square-root-aligned color lookup across transitions and constant count ranges', async () => {
		const varying = Array.from({ length: 257 }, (_, i) => 1 + i / 256);
		for (let i = 0; i < 31; i++) {
			const edge = 1 + ((i + .5) / 31) ** 2;
			varying.push(edge - 1e-12, edge + 1e-12);
		}
		for (const counts of [varying, Array(16).fill(1.234)]) {
			const xs = counts.map((_, i) => 1698437760000 + i * 60000);
			const dashboard = dashboardFor([xs, counts.map(() => .01), counts.map(() => .02), counts]);
			const root = createDemoRoot();
			let demo;
			try {
				demo = createDemo(root, dashboard);
				await Promise.resolve();
				const u = demo.plot;
				const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
				const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
				const expected = Array.from({ length: 32 }, () => []);
				counts.forEach((count, i) => expected[Math.round(Math.sqrt((count - min) / (max - min || 1)) * 31)].push(i));
				const sqrt = Math.sqrt;
				try {
					Math.sqrt = () => { throw new Error('Draw-time color lookup must not compute square roots'); };
					u.hooks.draw[0](u);
				}
				finally { Math.sqrt = sqrt; }
				const paths = fills(u).slice(-32);
				assert.equal(paths.length, 32);
				paths.forEach((path, color) => {
					const drawn = pathRects(path);
					assert.equal(drawn.length, expected[color].length);
					drawn.forEach((rect, i) => close(rect, bounds(u, expected[color][i], true, 60), 0));
				});
			}
			finally { demo?.destroy(); root.remove(); }
		}
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
			demo = createDemo(root, dashboardFor([xs, lo, hi, counts]));
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

	it('renders the real sparse fixture with its full cell count, ranges, and per-color counts', async () => {
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, realDashboard());
			await Promise.resolve();
			const u = demo.plot;
			assert.equal(u.mode, 2);
			assert.deepEqual(u.data[1].map(facet => facet.length), [15358, 15358, 15358, 15358]);
			assert.equal(rects(u).length, 15358);
			assert.equal(fills(u).length, 32);
			const colorChanges = lastDraw(u).filter(e => e[0] === 'fillStyle').flatMap(e => e.slice(1)).filter(fill => fill.startsWith('rgb('));
			assert.equal(colorChanges.length, 32);
			assert.equal(new Set(colorChanges).size, 32);
			assert.equal(colorChanges[0], 'rgb(94,79,162)');
			assert.equal(colorChanges[31], 'rgb(158,1,66)');
			const counts = u.data[1][3];
			const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
			const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
			const expected = Array(32).fill(0);
			for (const count of counts) expected[Math.round(Math.sqrt((count - min) / (max - min || 1)) * 31)]++;
			assert.deepEqual(fills(u).map(path => pathRects(path).length), expected);
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [1698437700, 1698459360]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [2 ** -16, 16]);
			assert.equal(u.scales.y.distr, 3);
			assert.equal(u.scales.y.log, 2);
			assert.ok(root.querySelector('#status').textContent.startsWith(`${(15358).toLocaleString()} cells`));
		}
		finally { demo?.destroy(); root.remove(); }
	});
});
