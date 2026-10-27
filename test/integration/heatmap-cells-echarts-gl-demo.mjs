import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import { generateHeatmapCells } from '../../demos/lib/heatmapCellsData.js';
import { prepareData, colorPieces } from '../../demos/heatmap-cells-echarts.js';
import { createCellLookup, cellSize, createDemo } from '../../demos/heatmap-cells-echarts-gl.js';

const html = readFileSync(new URL('../../demos/heatmap-cells-echarts-gl.html', import.meta.url), 'utf8');

function sparseFrames() {
	return [
		{ schema: { meta: { type: 'other' } } },
		{ schema: { meta: { type: 'heatmap-cells' }, fields: [
			{ name: 'count' }, { name: 'yMax' }, { name: 'xMax', config: { interval: 60000 } },
			{ name: 'yLayout' }, { name: 'yMin' },
		] }, data: { values: [[17, 3, 29], [8, 2, 8], [180000, 60000, 60000], [0, 0, 0], [4, 1, 4]] } },
	];
}

function source(frames, name) {
	const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
	return frame.data.values[frame.schema.fields.findIndex(f => f.name == name)];
}

function close(actual, expected) {
	assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10,
		`${actual} should be close to ${expected}`);
}

function rootFor(width = 0) {
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	Object.defineProperty(root.querySelector('#plot'), 'clientWidth', { configurable: true, value: width });
	return root;
}

function emitter() {
	const handlers = new Map(), offCalls = [];
	return {
		handlers, offCalls,
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name).add(handler);
		},
		off(name, handler) {
			offCalls.push([name, handler]);
			handlers.get(name)?.delete(handler);
		},
		emit(name, event) { handlers.get(name)?.forEach(handler => handler(event)); },
	};
}

function echartsMock(initialError) {
	const zr = emitter();
	const calls = { init: [], setOption: [], resize: [], dispatchAction: [], convertToPixel: [], convertFromPixel: [], containPixel: [], dispose: 0 };
	const state = { width: 1000, height: 560, xCount: 3, yCount: 3, xExtent: null, yExtent: null };
	const geometry = axis => {
		const [lo, hi] = state[`${axis}Extent`] ?? [0, state[`${axis}Count`] - 1];
		const span = axis == 'x' ? state.width - 105 : state.height - 70;
		return { lo, hi, step: span / (hi - lo + 1), origin: axis == 'x' ? 85 : state.height - 40, sign: axis == 'x' ? 1 : -1 };
	};
	const toPixel = (axis, value) => {
		const { lo, hi, step, origin, sign } = geometry(axis);
		// ECharts collapses all category conversions when the scale has one visible category.
		return origin + sign * step * (lo == hi ? .5 : value - lo + .5);
	};
	const plot = {
		...emitter(),
		setOption(...args) {
			calls.setOption.push(args);
			if (initialError && calls.setOption.length == 1) throw initialError;
			if (args[0].xAxis) state.xCount = args[0].xAxis.data.length;
			if (args[0].yAxis) state.yCount = args[0].yAxis.data.length;
		},
		getWidth() { return state.width; },
		getHeight() { return state.height; },
		convertToPixel(finder, value) {
			calls.convertToPixel.push([finder, value]);
			assert.deepEqual(finder, 'xAxisIndex' in finder ? { xAxisIndex: 0 } : { yAxisIndex: 0 });
			return toPixel('xAxisIndex' in finder ? 'x' : 'y', value);
		},
		convertFromPixel(finder, point) {
			calls.convertFromPixel.push([finder, point]);
			assert.deepEqual(finder, { gridIndex: 0 });
			return ['x', 'y'].map((axis, i) => {
				const { lo, step, origin, sign } = geometry(axis);
				return Math.round((point[i] - origin) / (sign * step) + lo - .5);
			});
		},
		containPixel(finder, point) {
			calls.containPixel.push([finder, point]);
			assert.deepEqual(finder, { gridIndex: 0 });
			return point[0] >= 85 && point[0] <= state.width - 20 && point[1] >= 30 && point[1] <= state.height - 40;
		},
		getZr() { return zr; },
		resize(...args) { calls.resize.push(args); Object.assign(state, args[0]); },
		dispatchAction(...args) { calls.dispatchAction.push(args); },
		dispose() { calls.dispose++; },
	};
	return {
		calls, state, plot, zr,
		init(...args) { calls.init.push(args); Object.assign(state, args[2]); return plot; },
		hover(x, y) { zr.emit('mousemove', { offsetX: toPixel('x', x), offsetY: toPixel('y', y) }); },
	};
}

function withDemo(run, frames = sparseFrames(), width = 0) {
	const root = rootFor(width), mock = echartsMock();
	let demo;
	const destroy = () => { demo?.destroy(); demo = null; };
	try {
		demo = createDemo(root, frames, mock);
		run({ root, mock, demo, destroy });
	}
	finally { destroy(); root.remove(); }
}

function assertOption(option, prepared) {
	assert.equal(option.animation, false);
	assert.deepEqual(option.grid, { left: 85, right: 20, top: 30, bottom: 40, outerBoundsMode: 'none' });
	assert.equal(option.series.length, 1);
	const series = option.series[0];
	assert.equal(series.id, 'cells');
	assert.equal(series.type, 'scatterGL');
	assert.equal(series.renderItem, undefined);
	assert.ok(series.data instanceof Float64Array);
	assert.deepEqual(series.data, prepared.data);
	assert.deepEqual(series.dimensions, ['x', 'y', 'value']);
	assert.deepEqual(series.encode, { x: 0, y: 1, value: 2 });
	assert.equal(series.symbol, 'rect');
	assert.equal(series.progressive, 0);
	assert.equal(series.large, false);
	assert.equal(series.silent, true);
	assert.equal(series.blendMode, 'source-over');
	assert.equal(series.itemStyle.opacity, 1);
	assert.equal(series.itemStyle.borderWidth, 0);
	assert.equal(series.postEffect.enable, false);
	for (const axis of ['x', 'y']) {
		assert.equal(option[`${axis}Axis`].type, 'category');
		assert.equal(option[`${axis}Axis`].boundaryGap, true);
		assert.deepEqual(option[`${axis}Axis`].data, prepared[`${axis}Categories`]);
	}
	assert.deepEqual(option.visualMap, {
		type: 'piecewise', show: false, dimension: 2, seriesIndex: 0, selectedMode: false,
		pieces: colorPieces(prepared.minCount, prepared.maxCount, 'linear'),
	});
}

function onlyUpdate(mock, start, expected) {
	assert.equal(mock.calls.setOption.length, start + 1);
	const [option, merge] = mock.calls.setOption[start];
	assert.deepEqual(option, expected);
	assert.notEqual(merge, true);
	assert.notEqual(merge?.notMerge, true);
}

function sizeUpdate(mock, start, expected) {
	const update = mock.calls.setOption[start]?.[0];
	assert.ok(update, 'expected a symbolSize update');
	onlyUpdate(mock, start, { series: [{ id: 'cells', symbolSize: update.series[0].symbolSize }] });
	assert.equal(update.series[0].symbolSize.length, 2);
	update.series[0].symbolSize.forEach((size, i) => close(size, expected[i]));
}

describe('ECharts GL heatmap cells demo', () => {
	it('reuses native preparation for all generated cells without changing or densifying the source', {timeout: 15000}, function() {
		const frames = generateHeatmapCells({ seed: 1, columns: 64, interval: 12 * 60 * 60 * 1000, xGapProbability: .1 });
		const snapshot = structuredClone(frames), prepared = prepareData(frames);
		const xs = source(frames, 'xMax'), lo = source(frames, 'yMin');
		const hi = source(frames, 'yMax'), counts = source(frames, 'count');
		assert.equal(prepared.times, xs);
		assert.equal(prepared.yMin, lo);
		assert.equal(prepared.yMax, hi);
		assert.equal(prepared.counts, counts);
		assert.ok(xs.length >= 5000 && xs.length <= 7000);
		assert.ok(new Set(xs).size < 64, 'fixture includes missing columns');
		assert.equal(prepared.data.length, xs.length * 3);
		assert.equal(prepared.data.byteLength, xs.length * 3 * 8);
		const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
		const interval = frame.schema.fields.find(f => f.name == 'xMax').config.interval;
		const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
		const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
		const minY = lo.reduce((a, b) => Math.min(a, b), Infinity);
		const maxY = hi.reduce((a, b) => Math.max(a, b), -Infinity);
		assert.equal(prepared.xSize, interval);
		assert.equal(prepared.xCategories.length, Math.round((maxX - minX) / interval) + 1);
		assert.equal(maxX - minX + interval, 32 * 24 * 60 * 60 * 1000);
		assert.equal(prepared.yCategories.length, Math.round(Math.log(maxY / minY) / Math.log(hi[0] / lo[0])));
		const lookup = createCellLookup(prepared.data, prepared.yCategories.length);
		for (let i = 0; i < xs.length; i++) {
			const x = prepared.data[i * 3], y = prepared.data[i * 3 + 1];
			assert.ok(Number.isInteger(x) && Number.isInteger(y));
			assert.equal(prepared.xCategories[x], String(xs[i]));
			close(Number(prepared.yCategories[y]), Math.sqrt(lo[i] * hi[i]));
			assert.equal(prepared.data[i * 3 + 2], counts[i]);
			assert.equal(lookup(x, y), i);
		}
		withDemo(({ root, mock }) => {
			assertOption(mock.calls.setOption[0][0], prepared);
			const axis = mock.calls.setOption[0][0].xAxis;
			assert.equal(prepared.xCategories.length, 64);
			for (const value of [axis.data[0], axis.data.at(-1)])
				assert.equal(axis.axisLabel.formatter(value), new Date(Number(value) - interval / 2).toISOString().slice(5, 10));
			assert.ok(root.querySelector('#status').textContent.includes(xs.length.toLocaleString()));
			const height = root.querySelector('#height'), start = mock.calls.setOption.length;
			// A narrow host keeps cells below 2px wide so resizing still tests both GL notes.
			const cellWidth = 120 / prepared.xCategories.length;
			assert.match(root.querySelector('#render-note').textContent, /Thin symbols and GPU point-size limits/);
			height.value = '200';
			height.dispatchEvent(new Event('input'));
			sizeUpdate(mock, start, [cellWidth, 130 / prepared.yCategories.length]);
			assert.match(root.querySelector('#render-note').textContent, /GL uses square points/);
		}, frames, 225);
		assert.deepEqual(frames, snapshot);
	});

	it('looks up reordered sparse cells by raw source index without sorting or filling the data', () => {
		const prepared = prepareData(sparseFrames()), snapshot = prepared.data.slice();
		assert.deepEqual(prepared.data, new Float64Array([2, 2, 17, 0, 0, 3, 0, 2, 29]));
		const lookup = createCellLookup(prepared.data, 3);
		for (let x = 0; x < 3; x++) {
			for (let y = 0; y < 3; y++) {
				const expected = x == 2 && y == 2 ? 0 : x == 0 && y == 0 ? 1 : x == 0 && y == 2 ? 2 : undefined;
				assert.equal(lookup(x, y), expected, `cell ${x},${y}`);
			}
		}
		assert.deepEqual(prepared.data, snapshot);
	});

	it('handles empty lookups and rejects missing or invalid coordinates, including y wrapping', () => {
		const empty = createCellLookup(new Float64Array(), 3);
		assert.equal(empty(0, 0), undefined);
		assert.equal(createCellLookup(new Float64Array(), 0)(0, 0), undefined);
		const lookup = createCellLookup(new Float64Array([1, 0, 10, 0, 2, 20]), 3);
		assert.equal(lookup(1, 0), 0);
		assert.equal(lookup(0, 2), 1);
		for (const point of [[0, 3], [1, -1], [-1, 5], [0, 0], [999, 0], [undefined, 0], [0, undefined]])
			assert.equal(lookup(...point), undefined, `invalid or missing ${point}`);
		for (const value of [-1, .5, NaN, Infinity, -Infinity, '0', null]) {
			assert.equal(lookup(value, 0), undefined);
			assert.equal(lookup(0, value), undefined);
		}
	});

	it('uses logarithmic source reads for binary lookup after indexing', () => {
		const count = 4096, data = new Float64Array(count * 3);
		for (let i = 0; i < count; i++) data.set([(count - i - 1) * 2, 0, i + 1], i * 3);
		let reads = 0;
		const tracked = new Proxy(data, {
			get(target, key) {
				if (/^\d+$/.test(String(key))) reads++;
				return Reflect.get(target, key, target);
			},
		});
		const lookup = createCellLookup(tracked, 3);
		for (const x of [0, 1, 2048, 4095, 8190, 8191]) {
			reads = 0;
			assert.equal(lookup(x, 0), x % 2 == 0 ? count - 1 - x / 2 : undefined);
			assert.ok(reads <= 2 * (Math.ceil(Math.log2(count)) + 2), `${reads} reads for x=${x}`);
		}
	});

	it('sizes cells from public first/last category pixels, including reversed y spacing', () => {
		const calls = [];
		const plot = {
			getWidth: () => 1000, getHeight: () => 560,
			convertToPixel(finder, value) {
				calls.push([finder, value]);
				return 'xAxisIndex' in finder ? 120 + value * 17.25 : 400 - value * 31.5;
			},
		};
		assert.deepEqual(cellSize(plot, 5, 4), [17.25, 31.5]);
		assert.deepEqual(calls, [[{ xAxisIndex: 0 }, 4], [{ xAxisIndex: 0 }, 0], [{ yAxisIndex: 0 }, 3], [{ yAxisIndex: 0 }, 0]]);
	});

	it('uses the fixed grid span for one category and collapsed single-band zooms', () => {
		const mock = echartsMock();
		assert.deepEqual(cellSize(mock.plot, 1, 1), [895, 490]);
		assert.equal(mock.calls.convertToPixel.length, 0);
		mock.state.xExtent = [1, 1];
		mock.state.yExtent = [2, 2];
		assert.deepEqual(cellSize(mock.plot, 3, 3), [895, 490]);
		assert.equal(mock.calls.convertToPixel.length, 4);
		mock.state.width = 100;
		mock.state.height = 60;
		assert.deepEqual(cellSize(mock.plot, 1, 1), [1, 1]);
	});

	it('initializes scatterGL with native colors, fixed grid sizing, and rectangle zoom', () => {
		withDemo(({ root, mock, demo }) => {
			const option = mock.calls.setOption[0][0];
			assertOption(option, prepareData(sparseFrames()));
			assert.deepEqual(option.xAxis.data.map(option.xAxis.axisLabel.formatter), ['00:00', '00:01', '00:02']);
			assert.equal(demo.plot, mock.plot);
			assert.deepEqual(mock.calls.init, [[root.querySelector('#plot'), null, { renderer: 'canvas', width: 1000, height: 560 }]]);
			assert.deepEqual(option.series[0].symbolSize, [895 / 3, 490 / 3]);
			assert.equal(mock.calls.setOption.length, 1);
			assert.equal(root.querySelector('#plot').style.height, '560px');
			assert.equal(root.querySelector('#height-value').textContent, '560px');
			assert.equal(root.querySelector('#color-min').textContent, '3');
			assert.equal(root.querySelector('#color-max').textContent, '29');
			const ramp = document.createElement('div');
			ramp.style.background = `linear-gradient(to right, ${colorPieces(0, 1, 'linear').map(p => p.color).join(',')})`;
			assert.equal(root.querySelector('#color-ramp').style.background, ramp.style.background);
			assert.match(root.querySelector('#render-note').textContent, /298\.33 × 163\.33 CSS px/);
			assert.match(root.querySelector('#render-note').textContent, /GPU point-size limits/);
			assert.deepEqual(mock.calls.dispatchAction, [[{ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: true }]]);
			assert.deepEqual(option.dataZoom.map(z => [z.id, z.filterMode]), [['x', 'filter'], ['y', 'filter']]);
			for (const id of ['height', 'set-data', 'color-scale']) assert.equal(root.querySelector(`#${id}`).disabled, false);
		});
	});

	it('updates only symbol sizes on zoom and resize, including a single visible category', () => {
		withDemo(({ root, mock }) => {
			const height = root.querySelector('#height'), host = root.querySelector('#plot');
			const hint = root.querySelector('#hover').textContent;
			let start = mock.calls.setOption.length;
			mock.plot.emit('datazoom', {});
			assert.equal(mock.calls.setOption.length, start, 'unchanged zoom needs no option update');
			mock.hover(0, 0);
			mock.state.xExtent = [0, 1];
			mock.state.yExtent = [1, 2];
			mock.plot.emit('datazoom', {});
			sizeUpdate(mock, start, [895 / 2, 490 / 2]);
			assert.equal(root.querySelector('#hover').textContent, hint);
			start = mock.calls.setOption.length;
			mock.plot.emit('datazoom', {});
			assert.equal(mock.calls.setOption.length, start);
			mock.state.xExtent = [2, 2];
			mock.plot.emit('datazoom', {});
			sizeUpdate(mock, start, [895, 245]);
			start = mock.calls.setOption.length;
			mock.state.yExtent = [2, 2];
			mock.plot.emit('datazoom', {});
			sizeUpdate(mock, start, [895, 490]);
			start = mock.calls.setOption.length;
			height.value = '720';
			height.dispatchEvent(new Event('input'));
			assert.deepEqual(mock.calls.resize.at(-1), [{ width: 1000, height: 720 }]);
			assert.equal(host.style.height, '720px');
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			sizeUpdate(mock, start, [895, 650]);
			start = mock.calls.setOption.length;
			Object.defineProperty(host, 'clientWidth', { configurable: true, value: 840 });
			window.dispatchEvent(new Event('resize'));
			assert.deepEqual(mock.calls.resize.at(-1), [{ width: 840, height: 720 }]);
			sizeUpdate(mock, start, [735, 650]);
			assert.match(root.querySelector('#render-note').textContent, /735\.00 × 650\.00 CSS px/);
			start = mock.calls.setOption.length;
			window.dispatchEvent(new Event('resize'));
			height.dispatchEvent(new Event('input'));
			mock.plot.emit('datazoom', {});
			assert.equal(mock.calls.setOption.length, start, 'same-size events must not resubmit symbols');
			mock.state.xExtent = mock.state.yExtent = null;
			mock.plot.emit('datazoom', {});
			sizeUpdate(mock, start, [735 / 3, 650 / 3]);
			assert.equal(mock.calls.init.length, 1);
		});
	});

	it('sizes an actual one-cell dataframe without category pixel conversion', () => {
		const frames = sparseFrames();
		frames[1].data.values.forEach(values => values.splice(1));
		withDemo(({ mock }) => {
			assert.deepEqual(mock.calls.setOption[0][0].series[0].symbolSize, [770, 490]);
			mock.plot.emit('datazoom', {});
			assert.equal(mock.calls.convertToPixel.length, 0);
			assert.equal(mock.calls.setOption.length, 1);
		}, frames, 875);
	});

	it('uses raw bounds and counts for grid hover and clears gaps, outside points, and globalout', () => {
		withDemo(({ root, mock }) => {
			const readout = root.querySelector('#hover'), hint = readout.textContent;
			const textNode = readout.firstChild;
			const expected = [
				[2, 2, '00:02:00–00:03:00 UTC · Y: 4–8 s · Count: 17'],
				[0, 0, '00:00:00–00:01:00 UTC · Y: 1–2 s · Count: 3'],
				[0, 2, '00:00:00–00:01:00 UTC · Y: 4–8 s · Count: 29'],
			];
			for (const [x, y, text] of expected) {
				mock.hover(x, y);
				assert.equal(readout.textContent, text);
				mock.hover(x, y);
				assert.equal(readout.textContent, text);
				assert.equal(readout.firstChild, textNode);
			}
			for (const [x, y] of [[1, 2], [0, 1], [2, 0]]) {
				mock.hover(2, 2);
				mock.hover(x, y);
				assert.equal(readout.textContent, hint);
			}
			for (const point of [[84, 100], [981, 100], [100, 29], [100, 521]]) {
				mock.hover(2, 2);
				const start = mock.calls.convertFromPixel.length;
				mock.zr.emit('mousemove', { offsetX: point[0], offsetY: point[1] });
				assert.deepEqual(mock.calls.containPixel.at(-1), [{ gridIndex: 0 }, point]);
				assert.equal(mock.calls.convertFromPixel.length, start, 'outside points must not be converted');
				assert.equal(readout.textContent, hint);
			}
			mock.hover(2, 2);
			mock.zr.emit('globalout', {});
			assert.equal(readout.textContent, hint);
			mock.hover(2, 2);
			assert.equal(readout.textContent, expected[0][2], 'clearing must invalidate the cached source index');
			window.dispatchEvent(new Event('resize'));
			assert.equal(readout.textContent, hint);
			assert.deepEqual([...mock.plot.handlers.keys()], ['datazoom']);
			assert.deepEqual([...mock.zr.handlers.keys()], ['mousemove', 'globalout', 'dblclick']);
		});
	});

	it('keeps native color updates visualMap-only and reuses the exact data buffer on set-data', () => {
		withDemo(({ root, mock }) => {
			const color = root.querySelector('#color-scale'), button = root.querySelector('#set-data');
			const data = mock.calls.setOption[0][0].series[0].data, snapshot = data.slice();
			const hint = root.querySelector('#hover').textContent;
			for (const mode of ['sqrt', 'log', 'linear']) {
				const start = mock.calls.setOption.length;
				color.value = mode;
				color.dispatchEvent(new Event('change'));
				onlyUpdate(mock, start, { visualMap: { pieces: colorPieces(3, 29, mode) } });
				assert.equal(root.querySelector('#color-scale-label').textContent, `Count · ${mode == 'sqrt' ? '√' : mode} scale`);
			}
			for (let i = 0; i < 2; i++) {
				mock.hover(2, 2);
				const start = mock.calls.setOption.length;
				button.click();
				onlyUpdate(mock, start, { series: [{ id: 'cells', data }] });
				const next = mock.calls.setOption[start][0].series[0].data;
				assert.equal(next, data);
				assert.equal(next.buffer, data.buffer);
				assert.equal(root.querySelector('#hover').textContent, hint);
			}
			assert.deepEqual(data, snapshot);
			assert.equal(mock.calls.init.length, 1);
		});
	});

	it('resets both zoom axes and removes all plot, ZRender, control, and window listeners on destroy', () => {
		withDemo(({ root, mock, destroy }) => {
			const readout = root.querySelector('#hover'), hint = readout.textContent;
			const bindings = [[mock.plot, 'datazoom'], ...['mousemove', 'globalout', 'dblclick'].map(name => [mock.zr, name])]
				.map(([target, name]) => {
					assert.equal(target.handlers.get(name)?.size, 1);
					return [target, name, [...target.handlers.get(name)][0]];
				});
			mock.zr.emit('dblclick', {});
			assert.deepEqual(mock.calls.dispatchAction.at(-1), [{ type: 'dataZoom', batch: [
				{ dataZoomId: 'x', start: 0, end: 100 }, { dataZoomId: 'y', start: 0, end: 100 },
			] }]);
			mock.hover(2, 2);
			destroy();
			assert.equal(mock.calls.dispose, 1);
			assert.equal(readout.textContent, hint);
			for (const [target, name, handler] of bindings) {
				assert.ok(target.offCalls.some(call => call[0] == name && call[1] === handler));
				assert.equal(target.handlers.get(name)?.size, 0);
			}
			const lengths = () => Object.values(mock.calls).map(value => Array.isArray(value) ? value.length : value);
			const afterDestroy = lengths();
			for (const [id, event] of [['height', 'input'], ['color-scale', 'change'], ['set-data', 'click']]) {
				const control = root.querySelector(`#${id}`);
				assert.equal(control.disabled, true);
				control.dispatchEvent(new Event(event));
			}
			window.dispatchEvent(new Event('resize'));
			mock.plot.emit('datazoom', {});
			mock.hover(2, 2);
			mock.zr.emit('globalout', {});
			mock.zr.emit('dblclick', {});
			assert.deepEqual(lengths(), afterDestroy);
			assert.equal(readout.textContent, hint);
		});
	});

	it('accepts global ECharts and the selected height and actual host width', () => {
		const root = rootFor(875), mock = echartsMock();
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'echarts');
		let demo;
		try {
			Object.defineProperty(globalThis, 'echarts', { configurable: true, value: mock });
			root.querySelector('#height').value = '680';
			demo = createDemo(root, sparseFrames());
			assert.equal(demo.plot, mock.plot);
			assert.deepEqual(mock.calls.init[0][2], { renderer: 'canvas', width: 875, height: 680 });
			assert.deepEqual(mock.calls.setOption[0][0].series[0].symbolSize, [770 / 3, 610 / 3]);
		}
		finally {
			demo?.destroy(); root.remove();
			if (previous) Object.defineProperty(globalThis, 'echarts', previous);
			else delete globalThis.echarts;
		}
	});

	it('disposes and rethrows when the initial setOption fails without enabling controls or installing listeners', () => {
		const root = rootFor(), failure = new Error('scatterGL initialization failed'), mock = echartsMock(failure);
		try {
			assert.throws(() => createDemo(root, sparseFrames(), mock), error => error === failure);
			assert.equal(mock.calls.init.length, 1);
			assert.equal(mock.calls.setOption.length, 1);
			assert.equal(mock.calls.dispose, 1);
			assert.equal(mock.calls.dispatchAction.length, 0);
			assert.equal(mock.plot.handlers.size, 0);
			assert.equal(mock.zr.handlers.size, 0);
			for (const [id, event] of [['height', 'input'], ['color-scale', 'change'], ['set-data', 'click']]) {
				const control = root.querySelector(`#${id}`);
				assert.equal(control.disabled, true);
				control.dispatchEvent(new Event(event));
			}
			window.dispatchEvent(new Event('resize'));
			assert.equal(mock.calls.resize.length, 0);
			assert.equal(mock.calls.setOption.length, 1);
		}
		finally { root.remove(); }
	});

	it('reports a missing ECharts dependency before accessing the DOM', () => {
		assert.throws(() => createDemo(null, sparseFrames(), null), /ECharts did not load from the CDN/);
	});

	it('loads pinned ECharts and GL in order and checks CDN and WebGL before generating data in HTML', () => {
		const page = new DOMParser().parseFromString(html, 'text/html');
		const scripts = [...page.querySelectorAll('script[src]')];
		assert.deepEqual(scripts.map(script => script.getAttribute('src')), [
			'https://fastly.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js',
			'https://fastly.jsdelivr.net/npm/echarts-gl@2.1.0/dist/echarts-gl.min.js',
		]);
		assert.equal(scripts[1].id, 'echarts-gl');
		assert.match(scripts[1].getAttribute('onload'), /dataset\.loaded\s*=\s*'true'/);
		const boot = page.querySelector('script[type="module"]').textContent;
		assert.match(boot, /import\s*\{\s*createDemo\s*\}\s*from\s*'\.\/heatmap-cells-echarts-gl\.js'/);
		assert.match(boot, /!globalThis\.echarts\s*\|\|\s*document\.querySelector\('#echarts-gl'\)\.dataset\.loaded\s*!=\s*'true'/);
		assert.match(boot, /const gl = canvas\.getContext\('webgl'\);/);
		assert.doesNotMatch(boot, /experimental-webgl/);
		assert.match(boot, /if\s*\(!gl\)\s*throw new Error\('WebGL is unavailable in this browser'\)/);
		assert.match(boot, /getExtension\('WEBGL_lose_context'\)\?\.loseContext\(\)/);
		assert.match(boot, /import\s*\{\s*generateHeatmapCells\s*\}\s*from\s*'\.\/lib\/heatmapCellsData\.js'/);
		assert.match(boot, /createDemo\(document\.querySelector\('#demo'\), generateHeatmapCells\(\{ xGapProbability: 0\.02 \}\)\)/);
		assert.ok(boot.indexOf('if (!gl)') < boot.indexOf('generateHeatmapCells({'));
		assert.match(boot, /Cannot load heatmap:/);
		assert.match(boot, /enable WebGL/);
	});
});
