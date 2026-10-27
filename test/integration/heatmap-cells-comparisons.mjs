import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import { generateHeatmapCells } from '../../demos/lib/heatmapCellsData.js';
import { readCells, gridShape, gridCells, cellLookup, colorPosition, colorBoundary, palette, cellText, setupControls } from '../../demos/heatmap-cells-compare.js';
import { prepareData as bokehData, createDemo as createBokeh } from '../../demos/heatmap-cells-bokeh.js';
import { prepareData as plotlyData, colorScale, createDemo as createPlotly } from '../../demos/heatmap-cells-plotly.js';
import { prepareData as d3fcData, createDemo as createD3FC } from '../../demos/heatmap-cells-d3fc.js';
import { prepareData as observableData, rasterOptions, createDemo as createObservable } from '../../demos/heatmap-cells-observable.js';

function frames() {
	return [{ schema: { meta: { type: 'other' } } }, {
		schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'count' }, { name: 'yMax' }, { name: 'xMax', config: { interval: 60000 } }, { name: 'yMin' },
		] }, data: { values: [[17.25, 3.5, 29.75], [8, 2, 8], [180000, 60000, 60000], [4, 1, 4]] },
	}];
}

function rootFor(name) {
	const html = readFileSync(new URL(`../../demos/heatmap-cells-${name}.html`, import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	return root;
}

function change(root, selector, value, type = 'change') {
	const node = root.querySelector(selector);
	node.value = value;
	node.dispatchEvent(new Event(type));
}

function close(a, b) { assert.ok(Math.abs(a - b) < Math.max(1, Math.abs(b)) * 1e-10, `${a} ≈ ${b}`); }

function trackReadout(root) {
	const readout = root.querySelector('#hover');
	const text = readout.firstChild;
	assert.equal(text?.nodeType, Node.TEXT_NODE);
	return expected => {
		assert.equal(readout.childNodes.length, 1);
		assert.equal(readout.firstChild, text, 'hover updates retain the same text node');
		if (expected !== undefined) assert.equal(text.data, expected);
	};
}

describe('native-library heatmap comparisons', () => {
	it('reads named, reordered columns without changing or copying the source', () => {
		const input = frames(), snapshot = structuredClone(input);
		const cells = readCells(input);
		assert.equal(cells.counts, input[1].data.values[0]);
		assert.equal(cells.times, input[1].data.values[2]);
		assert.deepEqual([cells.minX, cells.maxX, cells.minY, cells.maxY, cells.minCount, cells.maxCount], [0, 180000, 1, 8, 3.5, 29.75]);
		assert.deepEqual(input, snapshot);
	});

	for (const [name, mutate] of [
		['missing frame', f => f.pop()],
		['empty arrays', f => f[1].data.values.forEach(a => a.length = 0)],
		['missing column', f => f[1].schema.fields[0].name = 'unknown'],
		['invalid interval', f => f[1].schema.fields[2].config.interval = 0],
		['nonfinite time', f => f[1].data.values[2][0] = NaN],
		['nonpositive count', f => f[1].data.values[0][0] = 0],
		['inverted bucket', f => f[1].data.values[1][0] = 2],
	]) {
		it(`rejects ${name}`, () => {
			const f = frames(); mutate(f);
			assert.throws(() => readCells(f));
		});
	}

	it('fills only the matrix with NaN gaps, including whole missing columns and rows', () => {
		const grid = gridCells(readCells(frames()));
		assert.equal(grid.nx, 3);
		assert.equal(grid.ny, 3);
		assert.deepEqual(Array.from(grid.xEdges), [0, 60000, 120000, 180000]);
		assert.deepEqual(Array.from(grid.yEdges), [1, 2, 4, 8]);
		assert.deepEqual(Array.from(grid.values), [3.5, NaN, NaN, NaN, NaN, NaN, 29.75, NaN, 17.25]);
	});

	for (const xGapProbability of [.5, 1]) {
		it(`preserves generated column gaps in the matrix and half-open lookup (p=${xGapProbability})`, () => {
			const options = { seed: 1, columns: 16, start: 0, interval: 60000 };
			const input = generateHeatmapCells({ ...options, xGapProbability });
			const snapshot = structuredClone(input);
			const full = generateHeatmapCells(options)[0].data.values;
			const cells = readCells(input), grid = gridCells(cells), find = cellLookup(cells);
			const { times, yMin, yMax, counts, xSize } = cells;
			const present = new Set(times);
			const missing = Array.from({ length: options.columns }, (_, col) => col)
				.filter(col => !present.has((col + 1) * xSize));
			assert.deepEqual(missing, xGapProbability == .5 ? [1, 2, 9, 10, 14] : Array.from({ length: 14 }, (_, i) => i + 1));
			assert.deepEqual(input[0].data.values, full.map(values => values.filter((_, i) => present.has(full[0][i]))));
			assert.equal(grid.nx, options.columns);
			assert.deepEqual([cells.minX, cells.maxX], [0, options.columns * xSize]);
			assert.deepEqual(Array.from(grid.xEdges), Array.from({ length: options.columns + 1 }, (_, i) => i * xSize));
			assert.equal(grid.values.filter(Number.isFinite).length, times.length);
			for (const col of missing) {
				for (let row = 0; row < grid.ny; row++)
					assert.ok(Number.isNaN(grid.values[row * grid.nx + col]), `absent column ${col}, row ${row}`);
			}

			const indices = new Map(times.map((time, i) => [`${time},${yMin[i]}`, i]));
			const index = (time, lo) => indices.get(`${time},${lo}`) ?? -1;
			for (let i = 0; i < times.length; i++) {
				const col = times[i] / xSize - 1;
				const row = grid.yEdges.indexOf(yMin[i]);
				assert.ok(row >= 0);
				assert.equal(grid.yEdges[row + 1], yMax[i]);
				assert.equal(grid.values[row * grid.nx + col], counts[i]);
				const x = times[i] - xSize / 2, y = Math.sqrt(yMin[i] * yMax[i]);
				assert.equal(find(x, y), i);
				assert.equal(find(times[i] - xSize, y), i, 'left edge is included');
				assert.equal(find(x, yMin[i]), i, 'lower edge is included');
				assert.equal(find(times[i], y), index(times[i] + xSize, yMin[i]), 'right edge never falls back to the earlier cell');
				assert.equal(find(x, yMax[i]), index(times[i], yMax[i]), 'upper edge is excluded');
			}
			// Unlike the plugin's inclusive rounded pixels, a gap starts exactly at the preceding xMax.
			for (let i = 0; i < full[0].length; i++) {
				const time = full[0][i];
				if (present.has(time)) continue;
				const y = Math.sqrt(full[1][i] * full[2][i]);
				assert.equal(find(time - xSize / 2, y), -1, 'missing column center');
				assert.equal(find(time - xSize, y), -1, 'missing column left boundary');
				assert.equal(find(time, y), index(time + xSize, full[1][i]), 'missing column right boundary');
			}
			assert.deepEqual(input, snapshot, 'grid and lookup leave all source cells unchanged');
		});
	}

	it('rejects irregular raster grids and duplicate matrix entries', () => {
		let f = frames(); f[1].data.values[2][0] += 1000;
		assert.throws(() => gridShape(readCells(f)), /uniform/);
		f = frames(); f[1].data.values[1][0] = 9;
		assert.throws(() => gridShape(readCells(f)), /uniform/);
		f = frames(); f[1].data.values[2][0] = 60000;
		assert.throws(() => gridCells(readCells(f)), /Duplicate/);
	});

	it('finds sparse cells without collapsing gaps, including exact half-open boundaries', () => {
		const cells = readCells(frames()), find = cellLookup(cells);
		assert.equal(find(0, 1), 1);
		assert.equal(find(30000, 1.5), 1);
		assert.equal(find(30000, 6), 2);
		assert.equal(find(150000, 6), 0);
		assert.equal(find(120000, 4), 0);
		for (const [x, y] of [[-1, 1], [60000, 1], [90000, 6], [30000, 2], [30000, 3], [150000, 1], [150000, 8], [180000, 6], [30000, 0]])
			assert.equal(find(x, y), -1, `${x}, ${y}`);
	});

	for (const mode of ['linear', 'sqrt', 'log']) {
		it(`keeps original counts and matches the 24-color ${mode} mapping`, () => {
			const min = .01, max = 1.4;
			assert.equal(palette.length, 24);
			assert.equal(colorPosition(min, min, max, mode), 0);
			close(colorPosition(max, min, max, mode), 1);
			assert.equal(colorPosition(min, min, min, mode), 0);
			const stops = colorScale(min, max, mode);
			assert.deepEqual(stops[0], [0, palette[0]]);
			assert.deepEqual(stops.at(-1), [1, palette.at(-1)]);
			for (let i = 0; i < palette.length - 1; i++) {
				const t = (i + .5) / (palette.length - 1);
				const v = colorBoundary(t, min, max, mode);
				close(colorPosition(v, min, max, mode), t);
				close(stops[1 + 2 * i][0], (v - min) / (max - min));
				assert.equal(stops[1 + 2 * i][1], palette[i]);
				assert.equal(stops[2 + 2 * i][1], palette[i + 1]);
			}
			assert.deepEqual(colorScale(7, 7, mode), [[0, palette[0]], [1, palette[0]]]);
		});
	}

	it('uses explicit Bokeh edges, shared Plotly row buffers, and sparse D3FC/Plot inputs', () => {
		const f = frames();
		const b = bokehData(f), p = plotlyData(f), d = d3fcData(f), o = observableData(f);
		assert.deepEqual(Array.from(b.left), [120000, 0, 0]);
		assert.ok(b.left instanceof Float64Array);
		assert.ok(p.z.every(row => row instanceof Float64Array && row.buffer === p.values.buffer));
		assert.equal(p.xDates[0], '1970-01-01T00:00:00.000Z');
		assert.equal(p.xDates.at(-1), '1970-01-01T00:03:00.000Z');
		assert.deepEqual(d.indices, [0, 1, 2]);
		assert.deepEqual(d.indices.map(i => d.counts[i]), [17.25, 3.5, 29.75]);
		const r = rasterOptions(o);
		assert.equal(r.x, o.xCenters);
		assert.equal(r.y, o.yCenters);
		assert.equal(r.fill, o.countValues);
		assert.ok(Array.isArray(r.x));
		assert.ok(r.y instanceof Float64Array);
		assert.ok(r.fill instanceof Float64Array);
		assert.deepEqual(Array.from(r.fill), o.counts);
		assert.equal(r.interpolate, 'none');
		assert.equal(r.imageRendering, 'pixelated');
		assert.equal(r.clip, true);
		assert.deepEqual([r.width, r.height, r.x1, r.x2, r.y1, r.y2], [3, 3, 0, 180000, 1, 8]);
		for (const c of [b, p, d, o]) assert.equal(c.counts, f[1].data.values[0]);
		for (let i = 0; i < 3; i++) {
			assert.ok(r.x[i] instanceof Date);
			assert.equal(+r.x[i], o.times[i] - o.xSize / 2);
			close(r.y[i], Math.sqrt(o.yMin[i] * o.yMax[i]));
		}
	});

	it('maps every generated cell to the correct matrix pixel and sparse hover entry', {timeout: 15000}, function() {
		const f = generateHeatmapCells({ seed: 1, columns: 64, interval: 12 * 60 * 60 * 1000, xGapProbability: .1 });
		const frame = f.find(f => f.schema.meta?.type == 'heatmap-cells');
		const values = name => frame.data.values[frame.schema.fields.findIndex(f => f.name == name)];
		const xs = values('xMax'), lo = values('yMin'), hi = values('yMax');
		const interval = frame.schema.fields.find(f => f.name == 'xMax').config.interval;
		const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
		const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
		const minY = lo.reduce((a, b) => Math.min(a, b), Infinity);
		const maxY = hi.reduce((a, b) => Math.max(a, b), -Infinity);
		const p = plotlyData(f), find = cellLookup(p);
		assert.ok(xs.length >= 5000 && xs.length <= 7000);
		assert.ok(new Set(xs).size < 64, 'fixture includes missing columns');
		assert.equal(maxX - minX + interval, 32 * 24 * 60 * 60 * 1000);
		assert.equal(p.nx, 64);
		assert.equal(p.times, xs);
		assert.equal(p.yMin, lo);
		assert.equal(p.yMax, hi);
		assert.equal(p.counts, values('count'));
		assert.equal(p.xSize, interval);
		assert.equal(p.nx, Math.round((maxX - minX) / interval) + 1);
		assert.equal(p.ny, Math.round(Math.log(maxY / minY) / Math.log(hi[0] / lo[0])));
		assert.equal(p.values.filter(Number.isFinite).length, p.times.length);
		const step = Math.log(p.yMax[0] / p.yMin[0]);
		for (let i = 0; i < p.times.length; i++) {
			const x = Math.round((p.times[i] - p.xSize - p.minX) / p.xSize);
			const y = Math.round(Math.log(p.yMin[i] / p.minY) / step);
			assert.equal(p.z[y][x], p.counts[i]);
			close(p.yEdges[y], p.yMin[i]);
			close(p.yEdges[y + 1], p.yMax[i]);
			assert.equal(find(p.times[i] - p.xSize / 2, Math.sqrt(p.yMin[i] * p.yMax[i])), i);
		}
	});

	it('binds shared controls and removes every listener on disposal', () => {
		const root = rootFor('bokeh'), calls = [];
		root.querySelector('#hover').appendChild(document.createTextNode('initial'));
		const checkReadout = trackReadout(root);
		try {
			const cleanup = setupControls(root, readCells(frames()), {
				resize: () => calls.push('resize'), setData: () => calls.push('data'), setColor: mode => calls.push(mode),
			}, 'hint');
			checkReadout('hint');
			change(root, '#height', '720', 'input');
			checkReadout('hint');
			change(root, '#color-scale', 'sqrt');
			root.querySelector('#set-data').click();
			assert.deepEqual(calls, ['resize', 'sqrt', 'data']);
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			assert.equal(root.querySelector('#color-scale-label').textContent, 'Count · √ scale');
			checkReadout('hint');
			cleanup();
			change(root, '#height', '560', 'input');
			window.dispatchEvent(new Event('resize'));
			assert.deepEqual(calls, ['resize', 'sqrt', 'data']);
			assert.equal(root.querySelector('#set-data').disabled, true);
		}
		finally { root.remove(); }
	});

	it('uses native Plotly heatmap options and partial updates with UTC edges', async () => {
		const root = rootFor('plotly'), calls = [], listeners = new Map();
		const host = root.querySelector('#plot');
		host.on = (event, handler) => listeners.set(event, handler);
		host.removeListener = event => listeners.delete(event);
		const Plotly = {
			async newPlot(host, data, layout, config) { calls.push({ data, layout, config }); },
			restyle(host, update) { calls.push(update); },
			relayout(host, update) { calls.push(update); },
			purge() { calls.push('purge'); },
		};
		let demo;
		try {
			demo = await createPlotly(root, frames(), Plotly);
			const checkReadout = trackReadout(root), hint = root.querySelector('#hover').textContent;
			for (let i = 0; i < 20; i++) {
				listeners.get('plotly_hover')({ points: [{ pointNumber: [0, 0] }] });
				checkReadout(cellText(0, 60000, 1, 2, 3.5));
				listeners.get('plotly_hover')({ points: [{ pointNumber: [2, 2] }] });
				checkReadout(cellText(120000, 180000, 4, 8, 17.25));
				listeners.get('plotly_unhover')();
				checkReadout(hint);
			}
			const { data: [trace], layout } = calls[0];
			assert.equal(trace.type, 'heatmap');
			assert.equal(trace.zsmooth, false);
			assert.equal(trace.connectgaps, false);
			assert.equal(trace.hoverongaps, false);
			assert.equal(layout.xaxis.type, 'date');
			assert.equal(layout.yaxis.type, 'log');
			assert.deepEqual(layout.xaxis.range, [trace.x[0], trace.x.at(-1)]);
			listeners.get('plotly_hover')({ points: [{ pointNumber: [2, 2] }] });
			assert.equal(root.querySelector('#hover').textContent, cellText(120000, 180000, 4, 8, 17.25));
			change(root, '#color-scale', 'log');
			assert.deepEqual(Object.keys(calls.at(-1)), ['colorscale']);
			root.querySelector('#set-data').click();
			assert.equal(calls.at(-1).z[0], trace.z);
			change(root, '#height', '720', 'input');
			assert.equal(calls.at(-1).height, 720);
			checkReadout(hint);
			listeners.get('plotly_relayout')();
			listeners.get('plotly_hover')({ points: [{ pointNumber: [2, 2] }] });
			checkReadout(cellText(120000, 180000, 4, 8, 17.25));
			demo.destroy(); demo = null;
			assert.equal(listeners.size, 0);
			assert.equal(calls.at(-1), 'purge');
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('reuses Observable channels across updates and rebuilds on resize only for changed dimensions', () => {
		const input = frames(), snapshot = structuredClone(input);
		const root = rootFor('observable'), calls = [], listeners = new Map();
		const host = root.querySelector('#plot');
		let width = 800, brushEnd;
		Object.defineProperty(host, 'clientWidth', { get: () => width });
		const Plot = {
			raster: (data, options) => ({ data, options }),
			plot(options) {
				calls.push(options);
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				svg.scale = axis => ({ invert: value => axis == 'x' ? value : 1000 / value });
				return svg;
			},
		};
		const selection = {
			append() { return this; },
			call(fn, ...args) { fn(this, ...args); return this; },
			style() { return this; },
			on(event, handler) { listeners.set(event, handler); return this; },
		};
		const d3 = {
			select: () => selection,
			brush() {
				const brush = () => {};
				brush.extent = () => brush;
				brush.on = (event, handler) => { brushEnd = handler; return brush; };
				brush.move = () => {};
				return brush;
			},
		};
		let demo;
		try {
			demo = createObservable(root, input, Plot, d3);
			const checkReadout = trackReadout(root), hint = root.querySelector('#hover').textContent;
			const hover = () => {
				listeners.get('pointermove.hover')({ offsetX: 100, offsetY: 200 });
				checkReadout(cellText(0, 60000, 4, 8, 29.75));
			};
			for (let i = 0; i < 20; i++) {
				hover();
				listeners.get('pointermove.hover')({ offsetX: 0, offsetY: 0 });
				checkReadout(hint);
				hover();
				listeners.get('pointerleave.hover')();
				checkReadout(hint);
			}
			const resize = () => window.dispatchEvent(new Event('resize'));
			const unchanged = () => {
				const plot = demo.plot, count = calls.length;
				resize(); resize();
				assert.equal(calls.length, count);
				assert.equal(demo.plot, plot);
				assert.equal(host.firstChild, plot);
				checkReadout(hint);
			};
			assert.equal(calls.length, 1);
			assert.deepEqual([calls[0].width, calls[0].height], [800, 560]);
			unchanged();

			width = 900; resize();
			assert.equal(calls.length, 2);
			assert.equal(calls.at(-1).width, 900);
			unchanged();
			change(root, '#height', '720', 'input');
			assert.equal(calls.length, 3);
			assert.equal(calls.at(-1).height, 720);
			assert.equal(host.style.height, '720px');
			change(root, '#height', '720', 'input');
			unchanged();
			assert.equal(calls.length, 3);

			change(root, '#color-scale', 'sqrt');
			assert.equal(calls.length, 4);
			root.querySelector('#set-data').click();
			assert.equal(calls.length, 5);
			brushEnd({ sourceEvent: {}, selection: [[100, 100], [300, 200]] });
			assert.equal(calls.length, 6);
			assert.deepEqual(calls.at(-1).x.domain, [100, 300]);
			assert.deepEqual(calls.at(-1).y.domain, [5, 10]);
			unchanged();
			listeners.get('dblclick.reset')();
			assert.equal(calls.length, 7);
			assert.deepEqual(calls.at(-1).x.domain, [0, 180000]);
			assert.deepEqual(calls.at(-1).y.domain, [1, 8]);
			unchanged();

			width = 100; resize();
			assert.equal(calls.length, 8);
			assert.equal(calls.at(-1).width, 140);
			width = 120; unchanged();
			width = 0; resize();
			assert.equal(calls.length, 9);
			assert.equal(calls.at(-1).width, 1000);
			unchanged();
			const original = calls[0].marks[0];
			for (const { marks: [mark] } of calls) {
				assert.equal(mark.data, input[1].data.values[0], 'mark data retains the original counts');
				for (const channel of ['x', 'y', 'fill'])
					assert.equal(mark.options[channel], original.options[channel], `${channel} channel is reused on every rebuild`);
			}
			assert.deepEqual(input, snapshot, 'preparation and redraws leave source data unchanged');
			hover();
			demo.destroy(); demo = null;
			width = 800; resize();
			assert.equal(calls.length, 9);
			assert.equal(host.childElementCount, 0);
		}
		finally { demo?.destroy(); root.remove(); }
	});

	it('retains the D3FC hover text node through hover, redraw, resize, and reset', () => {
		const root = rootFor('d3fc'), listeners = new Map();
		const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		const selection = {
			append() { return this; },
			style() { return this; },
			attr() { return this; },
			call(fn, ...args) { fn(this, ...args); return this; },
			on(event, handler) { listeners.set(event, handler); return this; },
			node: () => node,
		};
		const scale = log => {
			const fn = value => value;
			fn.domain = fn.range = () => fn;
			fn.invert = value => log ? (value < 200 ? 1.5 : 6) : value * 1000;
			return fn;
		};
		const axis = () => {
			const fn = () => {};
			fn.ticks = fn.tickSizeOuter = () => fn;
			return fn;
		};
		const d3 = {
			select: () => selection,
			scaleUtc: () => scale(false), scaleLog: () => scale(true),
			axisBottom: axis, axisLeft: axis,
			brush() {
				const fn = () => {};
				fn.on = fn.extent = () => fn;
				fn.move = () => {};
				return fn;
			},
		};
		const fc = { seriesCanvasHeatmap() {
			const series = () => {};
			for (const name of ['context', 'xScale', 'yScale', 'xValue', 'yValue', 'colorValue', 'xBandwidth', 'yBandwidth', 'colorInterpolate'])
				series[name] = () => series;
			return series;
		} };
		const getContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = () => ({
			setTransform() {}, clearRect() {}, save() {}, translate() {}, beginPath() {}, rect() {}, clip() {}, restore() {},
		});
		let demo;
		try {
			demo = createD3FC(root, frames(), d3, fc);
			const checkReadout = trackReadout(root), hint = root.querySelector('#hover').textContent;
			const hover = () => {
				listeners.get('pointermove.hover')({ offsetX: 115, offsetY: 130 });
				checkReadout(cellText(0, 60000, 1, 2, 3.5));
			};
			for (let i = 0; i < 20; i++) {
				hover();
				listeners.get('pointermove.hover')({ offsetX: 115, offsetY: 330 });
				checkReadout(cellText(0, 60000, 4, 8, 29.75));
				listeners.get('pointermove.hover')({ offsetX: 185, offsetY: 130 });
				checkReadout(hint);
				hover();
				listeners.get('pointerleave.hover')();
				checkReadout(hint);
			}
			for (const update of [
				() => change(root, '#height', '720', 'input'),
				() => change(root, '#color-scale', 'sqrt'),
				() => root.querySelector('#set-data').click(),
				() => window.dispatchEvent(new Event('resize')),
				() => listeners.get('dblclick.reset')(),
			]) {
				hover();
				update();
				checkReadout(hint);
			}
			hover();
		}
		finally { HTMLCanvasElement.prototype.getContext = getContext; demo?.destroy(); root.remove(); }
	});

	it('uses native Bokeh quads, original count hover, and source updates', async () => {
		class Model {
			constructor(options = {}) { Object.assign(this, options); this.emits = 0; this.change = { emit: () => this.emits++ }; }
			setv(options) { Object.assign(this, options); }
		}
		let glyph, hover, removed = false;
		const renderer = { hover_glyph: {} };
		const Bokeh = {
			ColumnDataSource: Model, LinearColorMapper: Model, BoxZoomTool: Model, PanTool: Model,
			WheelZoomTool: Model, ResetTool: Model, Range1d: Model, HoverTool: Model,
			Plotting: {
				figure(options) {
					return Object.assign(new Model(options), { xaxis: [], yaxis: [], xgrid: [], ygrid: [],
						quad(options) { glyph = options; return renderer; }, add_tools(tool) { hover = tool; },
					});
				},
				async show() {
					assert.equal(renderer.hover_glyph, null, 'disable hover painting before Bokeh creates its views and signal connections');
					assert.deepEqual(hover.renderers, [renderer], 'keep native hit testing on the quad renderer');
					assert.equal(hover.tooltips, null);
					return { remove() { removed = true; } };
				},
			},
		};
		const root = rootFor('bokeh');
		let demo;
		try {
			demo = await createBokeh(root, frames(), Bokeh);
			const checkReadout = trackReadout(root), hint = root.querySelector('#hover').textContent;
			for (let i = 0; i < 20; i++) {
				hover.callback(null, { index: { indices: [0] } });
				checkReadout(cellText(120000, 180000, 4, 8, 17.25));
				hover.callback(null, { index: { indices: [1] } });
				checkReadout(cellText(0, 60000, 1, 2, 3.5));
				hover.callback(null, { index: { indices: [] } });
				checkReadout(hint);
			}
			assert.equal(demo.plot.output_backend, 'webgl');
			assert.equal(demo.plot.y_axis_type, 'log');
			assert.equal(glyph.line_color, null);
			assert.deepEqual(glyph.fill_color.transform.palette, palette);
						assert.equal(glyph.fill_color.transform.low, -.5);
						assert.equal(glyph.fill_color.transform.high, 23.5);
			assert.deepEqual(Array.from(demo.source.data.left), [120000, 0, 0]);
			hover.callback(null, { index: { indices: [0] } });
			assert.equal(root.querySelector('#hover').textContent, cellText(120000, 180000, 4, 8, 17.25));
			const counts = demo.source.data.count;
			change(root, '#color-scale', 'sqrt');
			assert.equal(demo.source.data.count, counts);
			close(demo.source.data.color[0], 23 * colorPosition(17.25, 3.5, 29.75, 'sqrt'));
			root.querySelector('#set-data').click();
			assert.equal(demo.source.emits, 1);
			change(root, '#height', '720', 'input');
			assert.equal(demo.plot.height, 720);
			checkReadout(hint);
			hover.callback(null, { index: { indices: [0] } });
			checkReadout(cellText(120000, 180000, 4, 8, 17.25));
			root.querySelector('#plot').dispatchEvent(new Event('dblclick'));
			checkReadout(hint);
			demo.destroy(); demo = null;
			assert.equal(removed, true);
		}
		finally { demo?.destroy(); root.remove(); }
	});
});
