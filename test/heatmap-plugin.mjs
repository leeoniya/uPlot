import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from '../demos/lib/heatmapPlugin.js';
import { createDemo } from '../demos/heatmap-sparse.js';
import Flatbush from '../demos/lib/flatbush.js';

const data = [null, [
	[2, 2, 2, 5, 7, 8, 9, 10],
	[1, 10, 100, 100, 10, 10, 10, 10],
	[5, 20, 200, 200, 20, 20, 20, 20],
	[0, 3, NaN, 5, -1, Infinity, null, undefined],
]];
const empty = () => [null, [[], [], [], []]];
const enter = u => u.over.dispatchEvent(new MouseEvent('mouseenter'));
const leave = u => u.over.dispatchEvent(new MouseEvent('mouseleave'));
const lastDraw = u => u.ctx.log.slice(u.ctx.log.findLastIndex(e => e[0] === 'clearRect'));
const fills = u => lastDraw(u).filter(e => e[0] === 'fill').flatMap(e => e.slice(1))
	.map(args => args[0]).filter(path => path?.log != null);
const rects = u => fills(u).flatMap(path => path.log.filter(e => e[0] === 'rect').flatMap(e => e.slice(1)));

function bounds(u, idx, canvas = false, xSize = 1) {
	const [x, lo, hi] = u.data[1];
	const left = u.valToPos(x[idx] - xSize, 'x', canvas);
	const top = u.valToPos(hi[idx], 'y', canvas);
	return [left, top, u.valToPos(x[idx], 'x', canvas) - left, u.valToPos(lo[idx], 'y', canvas) - top];
}

function close(actual, expected, tolerance = 1) {
	assert.equal(actual.length, expected.length);
	actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${actual} != ${expected}`));
}

function hover(u, x, y, idx) {
	u.setCursor({ left: u.valToPos(x, 'x'), top: u.valToPos(y, 'y') });
	assert.equal(u.cursor.dataIdx(u, 1), idx);
}

function createDemoRoot() {
	const html = readFileSync(new URL('../demos/heatmap-sparse.html', import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

describe('heatmapPlugin', () => {
	let plots, finished, searches, packed, originalFinish, originalSearch, originalReset;
	beforeEach(() => {
		plots = [];
		finished = [];
		searches = [];
		packed = new Set();
		originalReset = Flatbush.prototype.reset;
		Flatbush.prototype.reset = function() {
			packed.delete(this);
			return originalReset.call(this);
		};
		originalFinish = Flatbush.prototype.finish;
		originalSearch = Flatbush.prototype.search;
		Flatbush.prototype.finish = function() {
			assert.ok(!packed.has(this), 'finish runs only once per index rebuild');
			packed.add(this);
			finished.push(this);
			return originalFinish.call(this);
		};
		Flatbush.prototype.search = function(...args) {
			assert.ok(packed.has(this), 'search never reads an unfinished index');
			searches.push(this);
			return originalSearch.apply(this, args);
		};
	});
	afterEach(() => {
		plots.forEach(u => u.destroy());
		Flatbush.prototype.finish = originalFinish;
		Flatbush.prototype.search = originalSearch;
		Flatbush.prototype.reset = originalReset;
	});

	async function mount(values = data, pxRatio = 1, callbacks = {}) {
		const u = new uPlot({
			mode: 2, width: 600, height: 360, pxRatio,
			padding: [20, 30, 20, 30],
			axes: [{ show: false }, { show: false }],
			legend: { show: false },
			series: [{}, {}],
			scales: {
				x: { time: false, ori: 0, dir: 1, auto: false, min: 0, max: 12 },
				y: { distr: 3, ori: 1, dir: 1, auto: false, min: 1, max: 1000 },
			},
			plugins: [heatmapPlugin({ xSize: 1, ...callbacks })],
		}, values, document.body);
		plots.push(u);
		await Promise.resolve();
		return u;
	}

	it('configures facets and draws only positive finite counts at explicit log-scale bounds', async () => {
		const counts = [];
		const u = await mount(data, 1, {
			colors: ['rgb(3, 0, 0)', 'rgb(5, 0, 0)'],
			colorIdx: count => { counts.push(count); return count == 3 ? 0 : 1; },
		});
		assert.equal(u.mode, 2);
		assert.deepEqual(u.series[1].facets.map(f => f.scale), ['x', 'y', 'y']);
		assert.equal(u.series[1].paths(u, 1, 0, 7), null);
		assert.equal(u.series[1].points.show(u, 1), false);
		assert.deepEqual(counts, [3, 5]);
		const drawn = rects(u).sort((a, b) => a[0] - b[0]);
		assert.equal(drawn.length, 2);
		[1, 3].forEach((idx, i) => close(drawn[i], bounds(u, idx, true)));
		for (const count of [3, 5])
			assert.ok(u.ctx.log.some(e => e[0] === 'fillStyle' && e.slice(1).includes(`rgb(${count}, 0, 0)`)));
	});

	it('batches interleaved cells into one path and fill-style assignment per color', async () => {
		const cells = [null, [[2, 4, 6, 8], [10, 10, 10, 10], [20, 20, 20, 20], [1, 2, 1, 2]]];
		const u = await mount(cells, 1, { colors: ['red', 'blue'], colorIdx: count => count - 1 });
		const paths = fills(u);
		assert.equal(paths.length, 2);
		assert.deepEqual(paths.map(path => path.log[0].slice(1).length), [2, 2]);
		assert.deepEqual(lastDraw(u).filter(e => e[0] === 'fillStyle').flatMap(e => e.slice(1)), ['red', 'blue']);
		assert.ok(!lastDraw(u).some(e => e[0] === 'fillRect'));
		enter(u);
		for (let i = 0; i < 4; i++)
			hover(u, cells[1][0][i] - .5, 15, i);
	});

	it('uses one steelblue path by default', async () => {
		const u = await mount();
		assert.equal(fills(u).length, 1);
		assert.equal(rects(u).length, 2);
		assert.deepEqual(lastDraw(u).filter(e => e[0] === 'fillStyle').flatMap(e => e.slice(1)), ['steelblue']);
	});

	it('eagerly allocates and fills every palette path anew, without caching callback results or CSS colors', async () => {
		const values = [null, [[2, 4, 6, 8], [10, 10, 10, 10], [20, 20, 20, 20], [1, 1, 1, 1]]];
		const colors = ['red', 'red', 'blue'];
		let selected = 0, allocated = null;
		const counts = [];
		const u = await mount(values, 1, {
			colors,
			colorIdx: count => {
				if (allocated != null)
					assert.equal(allocated.length, colors.length, 'all paths exist before the first cell selects a color');
				counts.push(count);
				return selected;
			},
		});
		const Path = globalThis.Path2D;
		let previous = fills(u);
		try {
			globalThis.Path2D = function(...args) {
				const path = new Path(...args);
				allocated.push(path);
				return path;
			};
			for (selected of [1, 2, 0]) {
				allocated = [];
				counts.length = 0;
				u.redraw();
				await Promise.resolve();
				assert.deepEqual(counts, [1, 1, 1, 1], 'equal counts still call colorIdx once per cell on every redraw');
				const paths = fills(u);
				assert.equal(allocated.length, colors.length);
				assert.equal(paths.length, colors.length);
				paths.forEach((path, i) => {
					assert.equal(path, allocated[i]);
					assert.ok(!previous.includes(path), 'paths are not reused across draws');
					assert.equal(path.log.flatMap(e => e[0] === 'rect' ? e.slice(1) : []).length, i == selected ? 4 : 0);
				});
				assert.deepEqual(lastDraw(u).filter(e => e[0] === 'fillStyle').flatMap(e => e.slice(1)), colors);
				previous = paths;
			}
		}
		finally { globalThis.Path2D = Path; }
	});

	it('prepares geometry only on setData and computes each cell color on every draw without map lookups', async () => {
		const values = [null, [[2, 2, 3, 3], [10, 100, 10, 100], [20, 200, 20, 200], [1, 2, 1, 2]]];
		const counts = [];
		const u = await mount(values, 1, {
			colors: ['red', 'blue', 'green'],
			colorIdx: count => { counts.push(count); return count - 1; },
		});
		assert.deepEqual(counts, [1, 2, 1, 2]);
		for (const change of [() => u.redraw(), () => u.setSize({ width: 800, height: 400 }),
			() => u.setScale('x', { min: 0, max: 6 }), () => u.setScale('y', { min: 10, max: 1000 })]) {
			counts.length = 0;
			change();
			await Promise.resolve();
			assert.deepEqual(counts, [1, 2, 1, 2]);
		}

		const projected = { x: [], y: [] };
		const valToPos = u.valToPos;
		const mapGet = Map.prototype.get;
		u.valToPos = (value, scale, ...args) => {
			projected[scale].push(value);
			return valToPos(value, scale, ...args);
		};
		counts.length = 0;
		try {
			Map.prototype.get = () => { throw new Error('Map lookup during heatmap draw'); };
			u.hooks.draw[0](u);
		}
		finally { Map.prototype.get = mapGet; u.valToPos = valToPos; }
		assert.deepEqual(projected.x.sort((a, b) => a - b), [1, 2, 3]);
		assert.deepEqual(projected.y.sort((a, b) => a - b), [10, 20, 100, 200]);
		assert.deepEqual(counts, [1, 2, 1, 2]);

		enter(u);
		hover(u, 2.5, 150, 3);
		// Same arrays, changed in place: setData must rebuild geometry, but not select colors.
		values[1][0][3] = 4;
		values[1][1][3] = 20;
		values[1][2][3] = 40;
		values[1][3][3] = 3;
		counts.length = 0;
		u.setData(values, false);
		assert.deepEqual(counts, [], 'preparation never calls colorIdx');
		assert.equal(u.cursor.dataIdx(u, 1), null, 'discard stale hits before the next draw');
		u.redraw();
		await Promise.resolve();
		assert.deepEqual(counts, [1, 2, 1, 3]);
		hover(u, 2.5, 150, null);
		hover(u, 3.5, 30, 3);
		close(fills(u)[2].log[0][1], bounds(u, 3, true));
	});

	it('looks up rows per cell but interns Y boundaries only for distinct rows', async () => {
		const xs = [], lo = [], hi = [], counts = [];
		const runs = 24, buckets = 12;
		for (let x = 1; x <= runs; x++) {
			for (let y = 1; y <= buckets; y++) {
				xs.push(x); lo.push(y); hi.push(y + 1); counts.push(1);
			}
		}
		let colorCalls = 0;
		const u = await mount([null, [xs, lo, hi, counts]], 1, { colorIdx: () => { colorCalls++; return 0; } });
		const get = Map.prototype.get;
		for (const repeats of [1, 4]) {
			u.data = [null, [xs, lo, hi, counts].map(values => Array.from({ length: repeats }, () => values).flat())];
			// Keep X runs sorted while increasing cells without adding distinct rows.
			u.data[1][0] = Array.from({ length: xs.length * repeats }, (_, i) => Math.floor(i / buckets) + 1);
			const lookups = new Map();
			colorCalls = 0;
			try {
				Map.prototype.get = function(key) {
					lookups.set(this, (get.call(lookups, this) ?? 0) + 1);
					return get.call(this, key);
				};
				u.hooks.setData[0](u);
			}
			finally { Map.prototype.get = get; }
			assert.equal(colorCalls, 0, 'preparation does not select or cache colors');
			const perMap = [...lookups.values()].sort((a, b) => b - a);
			const cells = xs.length * repeats;
			assert.equal(perMap[0], cells, 'one row lookup per source cell');
			const boundaryGets = perMap.slice(1).reduce((sum, n) => sum + n, 0);
			assert.ok(boundaryGets > 0 && boundaryGets <= 2 * buckets,
				`${boundaryGets} boundary lookups for ${buckets} distinct rows and ${cells} cells`);
		}
		const projected = { x: [], y: [] };
		const valToPos = u.valToPos;
		u.valToPos = (value, scale, ...args) => {
			projected[scale].push(value);
			return valToPos(value, scale, ...args);
		};
		try { u.hooks.draw[0](u); }
		finally { u.valToPos = valToPos; }
		assert.deepEqual(projected.x.sort((a, b) => a - b), Array.from({ length: runs * 4 + 1 }, (_, i) => i));
		assert.deepEqual(projected.y.sort((a, b) => a - b), Array.from({ length: buckets + 1 }, (_, i) => i + 1));
	});

	it('keeps only per-cell row IDs in typed storage, without copying old entries', async () => {
		const u = await mount(empty());
		const runs = 64, rows = 64, length = runs * rows;
		const xs = Array.from({ length }, (_, i) => Math.floor(i / rows) + 1);
		const lo = xs.map((_, i) => i % rows + 1);
		u.data = [null, [xs, lo, lo.map(y => y + 1), xs.map((_, i) => i % 2 ? 1 : 0)]];
		const allocations = [];
		const names = ['Int32Array', 'Uint16Array', 'Uint32Array', 'Float32Array', 'Float64Array'];
		const constructors = names.map(name => globalThis[name]);
		try {
			names.forEach((name, i) => {
				globalThis[name] = class extends constructors[i] {
					constructor(...args) { super(...args); allocations.push([name, this]); }
					set() { throw new Error('Preparation must not copy old typed-buffer entries'); }
				};
			});
			u.hooks.setData[0](u);
		}
		finally { names.forEach((name, i) => { globalThis[name] = constructors[i]; }); }
		assert.equal(allocations.length, 1, 'only per-cell row IDs allocate typed storage during preparation');
		const [name, rowIds] = allocations[0];
		assert.equal(name, 'Uint32Array');
		assert.equal(rowIds.length, length, 'one ID per source cell, including zero-count cells');
		assert.equal(new Set(rowIds).size, rows);
		for (let i = rows; i < length; i++)
			assert.equal(rowIds[i], rowIds[i % rows], 'columns share row IDs');

	});

	it('prepares all source geometry and reads count validity again at draw time', async () => {
		const values = [null, data[1].map(facet => facet.slice())];
		const counts = [];
		const u = await mount(values, 1, { colorIdx: count => { counts.push(count); return 0; } });
		const projected = { x: [], y: [] };
		const valToPos = u.valToPos;
		u.valToPos = (value, scale, ...args) => {
			projected[scale].push(value);
			return valToPos(value, scale, ...args);
		};
		try { u.hooks.draw[0](u); }
		finally { u.valToPos = valToPos; }
		assert.deepEqual(projected.x.sort((a, b) => a - b), [1, 2, 4, 5, 6, 7, 8, 9, 10]);
		assert.deepEqual(projected.y.sort((a, b) => a - b), [1, 5, 10, 20, 100, 200]);

		values[1][3].fill(1);
		counts.length = 0;
		u.redraw();
		await Promise.resolve();
		assert.deepEqual(counts, Array(8).fill(1), 'previously invalid cells already have prepared geometry');
		assert.equal(rects(u).length, 8);
		enter(u);
		for (let i = 0; i < 8; i++) {
			close(rects(u)[i], bounds(u, i, true));
			hover(u, values[1][0][i] - .5, Math.sqrt(values[1][1][i] * values[1][2][i]), i);
		}

		values[1][3].splice(0, 8, NaN, 0, -1, Infinity, -Infinity, null, undefined, 2);
		counts.length = 0;
		u.redraw();
		await Promise.resolve();
		assert.deepEqual(counts, [2]);
		assert.equal(rects(u).length, 1);
		hover(u, 9.5, 15, 7);
		hover(u, 1.5, 15, null);
		values[1][3][7] = 0;
		counts.length = 0;
		u.redraw();
		await Promise.resolve();
		assert.deepEqual(counts, []);
		assert.equal(fills(u).length, 1, 'the default palette path is filled even when all counts are skipped');
		assert.deepEqual(rects(u), []);
		hover(u, 9.5, 15, null);
	});

	it('preserves X and Y gaps in a shared grid with reordered rows', async () => {
		const values = [null, [[2, 2, 5, 5, 6, 6], [1, 4, 1, 4, 4, 1], [2, 8, 2, 8, 8, 2], [1, 1, 1, 1, 1, 1]]];
		const u = await mount(values);
		enter(u);
		const drawn = rects(u);
		assert.equal(drawn.length, 6);
		for (let i = 0; i < 6; i++) {
			close(drawn[i], bounds(u, i, true));
			hover(u, values[1][0][i] - .5, Math.sqrt(values[1][1][i] * values[1][2][i]), i);
		}
		hover(u, 3, 1.5, null);
		hover(u, 4.5, 3.5, null);
	});

	it('rejects conflicting upper bounds for the same shared-grid row, even for skipped counts', async () => {
		const u = await mount(empty());
		for (const counts of [[1, 1], [0, NaN]]) {
			const values = [null, [[2, 5], [1, 1], [2, 3], counts]];
			assert.throws(() => u.setData(values, false), error => {
				assert.ok(error instanceof Error);
				assert.match(error.message, /row|grid|yMin|yMax/i, 'the error identifies the shared-row geometry constraint');
				return true;
			});
		}
	});

	it('reuses typed buffers and the packed index across same-size updates and redraws', async () => {
		const xs = Array.from({ length: 40 }, (_, i) => i + 1);
		const values = [null, [xs, xs.map(() => 10), xs.map(() => 20), xs.map(() => 1)]];
		const u = await mount(values);
		enter(u);
		const firstIndex = finished.at(-1);
		const allocations = [];
		const names = ['Int32Array', 'Uint16Array', 'Uint32Array', 'Float32Array', 'Float64Array'];
		const constructors = names.map(name => globalThis[name]);
		try {
			names.forEach((name, i) => {
				globalThis[name] = class extends constructors[i] {
					constructor(...args) { super(...args); allocations.push(name); }
				};
			});
			for (const change of [() => u.redraw(), () => u.setSize({ width: 800, height: 400 }),
				() => u.setData(values), () => u.setScale('x', { min: 0, max: 10 })]) {
				change();
				await Promise.resolve();
				assert.equal(finished.at(-1), firstIndex);
				hover(u, 4.5, 15, 4);
			}
		}
		finally { names.forEach((name, i) => { globalThis[name] = constructors[i]; }); }
		assert.deepEqual(allocations, []);
	});

	it('handles buffer growth, shrinkage, and empty updates without retaining stale cells', async () => {
		const u = await mount(empty());
		enter(u);
		for (const length of [1, 80, 3, 0, 24, 90]) {
			const xs = Array(length).fill(2);
			const lo = xs.map((_, i) => 2 ** (i / 16));
			const hi = xs.map((_, i) => 2 ** ((i + 1) / 16));
			u.setData([null, [xs, lo, hi, xs.map(() => 1)]]);
			await Promise.resolve();
			assert.equal(rects(u).length, length);
			if (length > 0)
				hover(u, 1.5, Math.sqrt(lo.at(-1) * hi.at(-1)), length - 1);
			else
				hover(u, 1.5, 1.02, null);
		}
	});

	it('reuses hover bounds, filter, and scratch arrays and avoids duplicate searches', async () => {
		const u = await mount();
		enter(u);
		const search = Flatbush.prototype.search;
		let previous, calls = 0;
		Flatbush.prototype.search = function(...args) {
			if (previous != null) {
				for (const i of [4, 5, 6])
					assert.equal(args[i], previous[i]);
			}
			previous = args;
			calls++;
			return search.apply(this, args);
		};
		try {
			hover(u, 1.5, 15, 1);
			const box = u.cursor.points.bbox(u, 1);
			hover(u, 1.5, 15, 1);
			assert.equal(calls, 1);
			hover(u, 4.5, 150, 3);
			assert.equal(calls, 2);
			assert.equal(u.cursor.points.bbox(u, 1), box);
		}
		finally { Flatbush.prototype.search = search; }
	});

	it('clips projected boundaries and fills offscreen palette entries with empty paths', async () => {
		const counts = [];
		const u = await mount(data, 1, {
			colors: ['red', 'blue', 'green'],
			colorIdx: count => { counts.push(count); return count == 3 ? 0 : 1; },
		});
		counts.length = 0;
		u.setScale('x', { min: 1.5, max: 2.5 });
		u.setScale('y', { min: 15, max: 150 });
		await Promise.resolve();
		assert.deepEqual(counts, [3], 'only visible valid cells select a color');
		assert.equal(fills(u).length, 3);
		assert.deepEqual(fills(u).slice(1).map(path => path.log), [[], []]);
		const top = Math.round(u.valToPos(20, 'y', true));
		close(rects(u)[0], [u.bbox.left, top, Math.round(u.valToPos(2, 'x', true)) - u.bbox.left,
			u.bbox.top + u.bbox.height - top], 0);
		enter(u);
		hover(u, 1.75, 17, 1);
	});

	it('reuses X geometry across valid and skipped cells, preserving IDs for collapsed runs', async () => {
		const values = [null, [
			[1, 1, 10, 10, 10, 20, 20],
			[10, 100, 1, 10, 100, 10, 100],
			[20, 200, 2, 20, 200, 20, 200],
			[1, 2, 0, 1, 2, 1, 2],
		]];
		const counts = [];
				const u = await mount(values, 1, {
					colors: ['red', 'blue'],
					colorIdx: count => { counts.push(count); return count - 1; },
				});
				counts.length = 0;
		u.setScale('x', { min: 0, max: 10000 });
		await Promise.resolve();
		assert.deepEqual(counts, [1, 2], 'collapsed runs and invalid counts do not select colors');
				const drawn = rects(u).sort((a, b) => b[1] - a[1]);
		assert.equal(drawn.length, 2, 'only the middle X run has a pixel of width');
		for (const [i, idx] of [3, 4].entries())
			close(drawn[i], bounds(u, idx, true));
		enter(u);
		for (const idx of [3, 4]) {
			const rect = drawn[idx - 3];
			u.setCursor({ left: rect[0] - u.bbox.left + rect[2] / 2, top: rect[1] - u.bbox.top + rect[3] / 2 });
			assert.equal(u.cursor.idxs[1], idx);
		}
		u.setScale('x', { min: 1.5, max: 10.5 });
		await Promise.resolve();
		assert.equal(rects(u).length, 2, 'fully offscreen runs stay empty after zoom');
		hover(u, 9.5, 15, 3);
		hover(u, 9.5, 150, 4);
	});

	it('returns original row IDs, leaves sparse gaps blank, and notifies after cursor updates and draw', async () => {
		const calls = [];
		const u = await mount(data, 1, { onHover: (self, idx) => calls.push([self, idx]) });
		enter(u);
		for (const [x, y, idx] of [[1.05, 15, 1], [1.95, 15, 1], [4.5, 150, 3],
			[0.9, 15, null], [2.1, 15, null], [3, 150, null], [1.5, 50, null],
			[1.5, 2, null], [1.5, 150, null], [6.5, 15, null], [7.5, 15, null], [8.5, 15, null], [9.5, 15, null]]) {
			calls.length = 0;
			hover(u, x, y, idx);
			assert.deepEqual(calls.at(-1), [u, idx]);
		}
		hover(u, 4.5, 150, 3);
		calls.length = 0;
		u.redraw();
		await Promise.resolve();
		assert.deepEqual(calls.at(-1), [u, 3]);
	});

	it('rebuilds hit coordinates and CSS hover rectangles after resize and zoom at DPR 2', async () => {
		const u = await mount(data, 2);
		enter(u);
		for (const change of [() => {}, () => u.setSize({ width: 1200, height: 720 }),
			() => { u.setScale('x', { min: 0, max: 6 }); u.setScale('y', { min: 10, max: 1000 }); }]) {
			const old = { left: u.cursor.left, top: u.cursor.top };
			change();
			await Promise.resolve();
			u.setCursor(old);
			assert.equal(u.cursor.dataIdx(u, 1), null, 'old pixel coordinates must not retain the previous hit');
			hover(u, 4.5, 150, 3);
			const box = u.cursor.points.bbox(u, 1);
			close([box.left, box.top, box.width, box.height], bounds(u, 3), 1 / u.pxRatio);
			const drawn = rects(u).find(r => Math.abs(r[0] - bounds(u, 3, true)[0]) <= 1);
			assert.ok(drawn, 'draw uses the rebuilt cell bounds');
			close(drawn, bounds(u, 3, true));
		}
	});

	for (const dpr of [1, 1.25, 2]) {
		it(`preserves exact Float32 index bounds and edge hits at DPR ${dpr}`, async () => {
			const xs = Array.from({ length: 24 }, (_, i) => Math.floor(i / 2) + 1);
			const u = await mount([null, [xs, xs.map((_, i) => i % 2 ? 100 : 10),
				xs.map((_, i) => i % 2 ? 200 : 20), xs.map(() => 1)]], dpr);
			const drawn = rects(u);
			const boxes = drawn.map(([left, top, width, height]) => [
				left - u.bbox.left, top - u.bbox.top, left + width - u.bbox.left, top + height - u.bbox.top,
			]);
			enter(u);
			const index = finished.at(-1);
			assert.equal(index.ArrayType, Float32Array);
			let checked = 0;
			index.search(-Infinity, -Infinity, Infinity, Infinity, (id, ...box) => {
				assert.deepEqual(box, boxes[id]);
				checked++;
				return false;
			});
			assert.equal(checked, xs.length);
			for (let i = 0; i < boxes.length; i++) {
				const [x0, y0, x1, y1] = boxes[i];
				const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
				for (const delta of [0, 1e-7, -1e-7]) {
					for (const [px, py] of [[x0 + delta, cy], [x1 + delta, cy], [cx, y0 + delta], [cx, y1 + delta]]) {
						const expected = [];
						for (let id = 0; id < boxes.length; id++) {
							const [l, t, r, b] = boxes[id];
							if (px >= l && px <= r && py >= t && py <= b)
								expected.push(id);
						}
						assert.deepEqual(index.search(px, py, px, py).sort((a, b) => a - b), expected);
					}
				}
				u.setCursor({ left: cx / dpr, top: cy / dpr });
				assert.equal(u.cursor.idxs[1], i);
				assert.deepEqual(u.cursor.points.bbox(u, 1), {
					left: x0 / dpr, top: y0 / dpr, width: (x1 - x0) / dpr, height: (y1 - y0) / dpr,
				});
			}
		});
	}

	it('handles initially empty data and clears stale hits when data becomes empty', async () => {
		const u = await mount(empty());
		enter(u);
		assert.equal(finished.length, 0);
		assert.deepEqual(rects(u), []);
		hover(u, 4.5, 150, null);
		u.setData(data);
		await Promise.resolve();
		hover(u, 4.5, 150, 3);
		u.setData(empty());
		await Promise.resolve();
		assert.deepEqual(rects(u), []);
		hover(u, 4.5, 150, null);
	});

	it('defers finish across resizes outside the plot and refreshes immediately inside', async () => {
		const u = await mount();
		for (const width of [700, 800, 900]) {
			u.setSize({ width, height: 360 });
			await Promise.resolve();
			hover(u, 4.5, 150, null);
			assert.equal(finished.length, 0);
			assert.equal(searches.length, 0);
		}

		enter(u);
		assert.equal(finished.length, 1);
		hover(u, 4.5, 150, 3);
		leave(u);
		enter(u);
		assert.equal(finished.length, 1, 're-entry reuses a finished index');

		for (const change of [() => u.redraw(), () => u.setSize({ width: 1000, height: 400 }),
			() => u.setScale('x', { min: 0, max: 6 }), () => u.setData(data)]) {
			const count = finished.length;
			change();
			await Promise.resolve();
			assert.equal(finished.length, count + 1);
			hover(u, 4.5, 150, 3);
		}

		leave(u);
		const count = finished.length;
		u.setSize({ width: 600, height: 360 });
		await Promise.resolve();
		assert.equal(finished.length, count);
		hover(u, 4.5, 150, null);
		enter(u);
		assert.equal(finished.length, count + 1);
		hover(u, 4.5, 150, 3);
	});

	it('finishes in capture phase and removes pointer listeners on destroy', async () => {
		const u = await mount();
		const over = u.over;
		let entries = 0;
		over.addEventListener('mouseenter', () => {
			assert.equal(finished.length, 1);
			hover(u, 4.5, 150, 3);
			entries++;
		}, { once: true });
		enter(u);
		assert.equal(entries, 1);

		const removed = [];
		const originalRemove = over.removeEventListener;
		over.removeEventListener = function(type, listener, capture) {
			removed.push([type, capture]);
			return originalRemove.call(this, type, listener, capture);
		};
		plots.splice(plots.indexOf(u), 1);
		u.destroy();
		assert.equal(removed.filter(([type, capture]) => type == 'mouseenter' && capture === true).length, 1);
		assert.equal(removed.filter(([type, capture]) => type == 'mouseleave' && capture === undefined).length, 1);
		over.dispatchEvent(new MouseEvent('mouseenter'));
		over.dispatchEvent(new MouseEvent('mouseleave'));
		assert.equal(finished.length, 1);
	});

	it('resizes from the height slider and passes the same data to setData from the button', async () => {
		const dashboard = JSON.parse(readFileSync(new URL('../demos/data/heatmap-cells-exemplars.json', import.meta.url), 'utf8'));
		const root = createDemoRoot();
		const height = root.querySelector('#height');
		const button = root.querySelector('#set-data');
		assert.ok(height.disabled && button.disabled);
		let demo;
		try {
			demo = createDemo(root, dashboard);
			await Promise.resolve();
			const u = demo.plot;
			const originalData = u.data;
			const setData = u.setData;
			const setSize = u.setSize;
			let dataCalls = 0, sizeCalls = 0, prepares = 0;
			u.hooks.setData.push(() => prepares++);
			u.setData = next => {
				assert.equal(next, originalData);
				dataCalls++;
				setData(next);
			};
			u.setSize = size => { sizeCalls++; setSize(size); };
			assert.ok(!height.disabled && !button.disabled);
			assert.equal(u.height, 560);

			height.value = '720';
			height.dispatchEvent(new Event('input'));
			await Promise.resolve();
			assert.equal(u.height, 720);
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			assert.equal(sizeCalls, 1);
			assert.equal(prepares, 0, 'resize does not rerun data preprocessing');

			button.click();
			await Promise.resolve();
			assert.equal(dataCalls, 1);
			assert.equal(prepares, 1);
			assert.equal(u.data, originalData);

			window.dispatchEvent(new Event('resize'));
			await Promise.resolve();
			assert.equal(u.height, 720, 'window resize preserves the slider height');
			assert.equal(sizeCalls, 2);
			demo.destroy();
			demo = null;
			assert.ok(height.disabled && button.disabled);
			height.dispatchEvent(new Event('input'));
			button.dispatchEvent(new MouseEvent('click'));
			window.dispatchEvent(new Event('resize'));
			assert.equal(sizeCalls, 2);
			assert.equal(dataCalls, 1);
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('uses a square-root-aligned color lookup across transitions and constant count ranges', async () => {
		const varying = Array.from({ length: 257 }, (_, i) => 1 + i / 256);
		for (let i = 0; i < 31; i++) {
			const edge = 1 + ((i + .5) / 31) ** 2;
			varying.push(edge - 1e-12, edge + 1e-12);
		}
		for (const counts of [varying, Array(16).fill(1.234)]) {
			const xs = counts.map((_, i) => 1698437760000 + i * 60000);
			const frame = {
				schema: {
					meta: { type: 'heatmap-cells' },
					fields: ['xMax', 'yMin', 'yMax', 'count'].map(name => ({ name, config: { interval: 60000 } })),
				},
				data: { values: [xs, counts.map(() => .01), counts.map(() => .02), counts] },
			};
			const dashboard = { panels: [{ targets: [{ rawFrameContent: JSON.stringify([frame]) }] }] };
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
					const drawn = path.log.flatMap(e => e[0] === 'rect' ? e.slice(1) : []);
					assert.equal(drawn.length, expected[color].length);
					drawn.forEach((rect, i) => close(rect, bounds(u, expected[color][i], true, 60)));
				});
			}
			finally { demo?.destroy(); root.remove(); }
		}
	});

	it('loads 250k cells without spreading data arrays into function arguments', async function() {
		this.timeout(10000);
		const length = 250000;
		const start = 1698437760000;
		const xs = Array.from({ length }, (_, i) => start + Math.floor(i / 250) * 60000);
		const lo = xs.map((_, i) => 2 ** (-16 + (i % 250) / 25));
		const hi = xs.map((_, i) => 2 ** (-16 + (i % 250 + 1) / 25));
		const counts = xs.map((_, i) => i % 32 + 1);
		const frame = {
			schema: {
				meta: { type: 'heatmap-cells' },
				fields: ['xMax', 'yMin', 'yMax', 'count'].map(name => ({ name, config: { interval: 60000 } })),
			},
			data: { values: [xs, lo, hi, counts] },
		};
		const dashboard = { panels: [{ targets: [{ rawFrameContent: JSON.stringify([frame]) }] }] };
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, dashboard);
			await Promise.resolve();
			const u = demo.plot;
			assert.equal(u.data[1][0].length, length);
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [start / 1000 - 60, start / 1000 + 999 * 60]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [2 ** -16, 2 ** -6]);
			assert.equal(root.querySelector('#color-min').textContent, '1');
			assert.equal(root.querySelector('#color-max').textContent, '32');
			assert.ok(root.querySelector('#status').textContent.startsWith(`${length.toLocaleString()} cells · 1000 one-minute intervals`));
			assert.ok(rects(u).length > 0);
			assert.equal(finished.length, 0, 'large charts still defer finish until pointer entry');
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('renders the real sparse heatmap fixture with its full cell count and ranges', async () => {
		const dashboard = JSON.parse(readFileSync(new URL('../demos/data/heatmap-cells-exemplars.json', import.meta.url), 'utf8'));
		const root = createDemoRoot();
		let demo;
		try {
			demo = createDemo(root, dashboard);
			await Promise.resolve();
			const u = demo.plot;
			assert.equal(u.mode, 2);
			assert.deepEqual(u.data[1].map(facet => facet.length), [15358, 15358, 15358, 15358]);
			assert.equal(rects(u).length, 15358);
			const batches = fills(u).length;
			assert.equal(batches, 32, 'all palette entries are filled, including empty paths');
			const colorChanges = lastDraw(u).filter(e => e[0] === 'fillStyle')
				.flatMap(e => e.slice(1)).filter(fill => fill.startsWith('rgb('));
			assert.equal(colorChanges.length, batches);
			assert.equal(new Set(colorChanges).size, 32);
			assert.equal(colorChanges[0], 'rgb(94,79,162)');
			assert.equal(colorChanges[31], 'rgb(158,1,66)');
			const counts = u.data[1][3];
			const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
			const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
			const expected = Array(32).fill(0);
			for (const count of counts)
				expected[Math.round(Math.sqrt((count - min) / (max - min || 1)) * 31)]++;
			assert.deepEqual(fills(u).map(path => path.log.flatMap(e => e[0] === 'rect' ? e.slice(1) : []).length), expected,
				'the demo maps counts to the 32-entry palette with square-root normalization');
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [1698437700, 1698459360]);
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [2 ** -16, 16]);
			assert.equal(u.scales.y.distr, 3);
			assert.equal(u.scales.y.log, 2);
			assert.ok(root.querySelector('#status').textContent.startsWith(`${(15358).toLocaleString()} cells`));
		}
		finally { demo?.destroy(); root.remove(); }
	});
});
