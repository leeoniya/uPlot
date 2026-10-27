import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/instrument.mjs';
import { generateHeatmapCells } from '../../demos/lib/heatmapCellsData.js';
import { prepareData, colorPieces, createDemo } from '../../demos/heatmap-cells-echarts.js';

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

function freeze(value) {
	if (value != null && typeof value == 'object') {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}

function close(actual, expected) {
	assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-10,
		`${actual} should be close to ${expected}`);
}

function rootFor(width = 0) {
	const html = readFileSync(new URL('../../demos/heatmap-cells-echarts.html', import.meta.url), 'utf8');
	const page = new DOMParser().parseFromString(html, 'text/html');
	const root = document.importNode(page.querySelector('#demo'), true);
	document.body.appendChild(root);
	Object.defineProperty(root.querySelector('#plot'), 'clientWidth', { configurable: true, value: width });
	return root;
}

function emitter() {
	const handlers = new Map();
	const offCalls = [];
	return {
		handlers, offCalls,
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name).add(handler);
		},
		off(name, handler) {
			offCalls.push([name, handler]);
			if (handler == null) handlers.delete(name);
			else handlers.get(name)?.delete(handler);
		},
		emit(name, event) { handlers.get(name)?.forEach(handler => handler(event)); },
	};
}

function echartsMock() {
	const zr = emitter();
	const calls = { init: [], setOption: [], resize: [], dispatchAction: [], dispose: 0 };
	const plot = {
		...emitter(),
		setOption(...args) { calls.setOption.push(args); },
		getZr() { return zr; },
		resize(...args) { calls.resize.push(args); },
		dispatchAction(...args) { calls.dispatchAction.push(args); },
		dispose() { calls.dispose++; },
	};
	return {
		calls, plot, zr,
		init(...args) { calls.init.push(args); return plot; },
	};
}

const first = component => Array.isArray(component) ? component[0] : component;
const matches = (piece, value) => 'value' in piece ? piece.value === value :
	(!('gt' in piece) || value > piece.gt) && (!('lte' in piece) || value <= piece.lte);

function assertNativeOption(option, prepared, mode = 'linear') {
	const series = first(option.series);
	assert.equal(series.type, 'heatmap');
	assert.equal(series.renderItem, undefined);
	assert.ok(series.data instanceof Float64Array);
	assert.deepEqual(series.data, prepared.data);
	assert.deepEqual(series.dimensions, ['x', 'y', 'value']);
	assert.deepEqual(series.encode, { x: 0, y: 1, value: 2 });
	assert.equal(first(option.xAxis).type, 'category');
	assert.equal(first(option.yAxis).type, 'category');
	assert.deepEqual(first(option.xAxis).data, prepared.xCategories);
	assert.deepEqual(first(option.yAxis).data, prepared.yCategories);
	const visualMap = first(option.visualMap);
	assert.equal(visualMap.type, 'piecewise');
	assert.equal(visualMap.show, false);
	assert.equal(visualMap.dimension, 2);
	assert.deepEqual(visualMap.pieces, colorPieces(prepared.minCount, prepared.maxCount, mode));
}

function assertOnlyUpdates(calls, start, key) {
	const updates = calls.setOption.slice(start);
	assert.ok(updates.length > 0, `expected a ${key} update`);
	for (const [option, merge] of updates) {
		assert.deepEqual(Object.keys(option), [key]);
		assert.notEqual(merge, true, 'partial updates must merge with existing options');
		assert.notEqual(merge?.notMerge, true);
	}
	return updates.at(-1)[0];
}

describe('ECharts heatmap cells demo', () => {
	it('preserves reordered source arrays and fills missing time and geometric-bin categories, not cells', () => {
		const frames = freeze(sparseFrames());
		const prepared = prepareData(frames);
		assert.equal(prepared.times, source(frames, 'xMax'));
		assert.equal(prepared.yMin, source(frames, 'yMin'));
		assert.equal(prepared.yMax, source(frames, 'yMax'));
		assert.equal(prepared.counts, source(frames, 'count'));
		assert.equal(prepared.xSize, 60000);
		assert.deepEqual(prepared.xCategories, ['60000', '120000', '180000']);
		assert.equal(prepared.yCategories.length, 3);
		prepared.yCategories.forEach((value, i) => {
			assert.equal(typeof value, 'string');
			close(Number(value), Math.sqrt(2) * 2 ** i);
		});
		assert.deepEqual(prepared.data, new Float64Array([2, 2, 17, 0, 0, 3, 0, 2, 29]));
		assert.equal(prepared.minCount, 3);
		assert.equal(prepared.maxCount, 29);
	});

	it('prepares and passes every generated source cell to native ECharts without changing the source', {timeout: 15000}, function() {
		const frames = generateHeatmapCells({ seed: 1, columns: 64, interval: 12 * 60 * 60 * 1000, xGapProbability: .1 });
		const snapshot = structuredClone(frames);
		const prepared = prepareData(frames);
		const xs = source(frames, 'xMax'), lo = source(frames, 'yMin');
		const hi = source(frames, 'yMax'), counts = source(frames, 'count');
		assert.ok(prepared.data instanceof Float64Array);
		assert.ok(xs.length >= 5000 && xs.length <= 7000);
		assert.ok(new Set(xs).size < 64, 'fixture includes missing columns');
		assert.equal(prepared.data.length, xs.length * 3);
		assert.equal(prepared.data.byteLength, xs.length * 3 * 8);
		assert.equal(prepared.times, xs);
		assert.equal(prepared.yMin, lo);
		assert.equal(prepared.yMax, hi);
		assert.equal(prepared.counts, counts);
		const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
		const interval = frame.schema.fields.find(f => f.name == 'xMax').config.interval;
		assert.equal(prepared.xSize, interval);
		const minX = xs.reduce((a, b) => Math.min(a, b), Infinity);
		const maxX = xs.reduce((a, b) => Math.max(a, b), -Infinity);
		assert.equal(prepared.xCategories.length, Math.round((maxX - minX) / interval) + 1);
		assert.equal(maxX - minX + interval, 32 * 24 * 60 * 60 * 1000);
		const minY = lo.reduce((a, b) => Math.min(a, b), Infinity);
		const maxY = hi.reduce((a, b) => Math.max(a, b), -Infinity);
		const factor = hi[0] / lo[0];
		assert.equal(prepared.yCategories.length, Math.round(Math.log(maxY / minY) / Math.log(factor)));
		prepared.xCategories.forEach((value, i) => assert.equal(value, String(minX + i * interval)));
		prepared.yCategories.forEach((value, i) => {
			assert.equal(typeof value, 'string');
			close(Number(value), minY * factor ** (i + .5));
		});
		for (let i = 0; i < xs.length; i++) {
			const offset = i * 3;
			const x = prepared.data[offset], y = prepared.data[offset + 1], count = prepared.data[offset + 2];
			assert.ok(Number.isInteger(x) && Number.isInteger(y));
			assert.equal(prepared.xCategories[x], String(xs[i]));
			close(Number(prepared.yCategories[y]), Math.sqrt(lo[i] * hi[i]));
			assert.equal(count, counts[i]);
		}
		assert.equal(prepared.minCount, counts.reduce((a, b) => Math.min(a, b), Infinity));
		assert.equal(prepared.maxCount, counts.reduce((a, b) => Math.max(a, b), -Infinity));
		const root = rootFor(), mock = echartsMock();
		let demo;
		try {
			demo = createDemo(root, frames, mock);
			assertNativeOption(mock.calls.setOption[0][0], prepared);
			const axis = first(mock.calls.setOption[0][0].xAxis);
			assert.equal(prepared.xCategories.length, 64);
			for (const value of [axis.data[0], axis.data.at(-1)])
				assert.equal(axis.axisLabel.formatter(value), new Date(Number(value) - interval / 2).toISOString().slice(5, 10));
			assert.ok(root.querySelector('#status').textContent.includes(xs.length.toLocaleString()));
			assert.deepEqual(frames, snapshot);
		}
		finally { demo?.destroy(); root.remove(); }
	});

	for (const [name, mutate] of [
		['missing frame', frames => frames.splice(1)],
		['missing named field', frames => { frames[1].schema.fields[0].name = 'not-count'; }],
		['empty cells', frames => frames[1].data.values.forEach(values => values.splice(0))],
		['unequal field lengths', frames => source(frames, 'count').pop()],
		['zero interval', frames => { frames[1].schema.fields[2].config.interval = 0; }],
		['negative interval', frames => { frames[1].schema.fields[2].config.interval = -60000; }],
		['nonfinite time', frames => { source(frames, 'xMax')[0] = NaN; }],
		['off-grid time', frames => { source(frames, 'xMax')[0] += 1; }],
		['nonfinite count', frames => { source(frames, 'count')[0] = Infinity; }],
		['zero lower bucket bound', frames => { source(frames, 'yMin')[0] = 0; }],
		['negative bucket', frames => { source(frames, 'yMin')[0] = -8; source(frames, 'yMax')[0] = -4; }],
		['reversed bucket', frames => { source(frames, 'yMin')[0] = 16; }],
		['zero-width bucket', frames => { source(frames, 'yMin')[0] = 8; }],
		['nonfinite bucket', frames => { source(frames, 'yMax')[0] = Infinity; }],
		['nonuniform bucket ratio', frames => { source(frames, 'yMax')[0] = 16; }],
		['off-grid geometric bucket', frames => { source(frames, 'yMin')[0] = 3; source(frames, 'yMax')[0] = 6; }],
	]) {
		it(`rejects ${name} with an Error`, () => {
			const frames = sparseFrames();
			mutate(frames);
			assert.throws(() => prepareData(frames), Error);
		});
	}

	it('provides 24 contiguous, monotonic native color pieces for each scale', () => {
		const byMode = {};
		for (const mode of ['linear', 'sqrt', 'log']) {
			const pieces = byMode[mode] = colorPieces(1, 1024, mode);
			assert.equal(pieces.length, 24);
			pieces.forEach((piece, i) => {
				assert.equal(typeof piece.color, 'string');
				assert.ok(piece.color.length > 0);
				assert.deepEqual(Object.keys(piece).sort(), (i == 0 ? ['color', 'lte'] : i == pieces.length - 1 ? ['color', 'gt'] : ['color', 'gt', 'lte']).sort());
				if (i > 0) assert.equal(piece.gt, pieces[i - 1].lte);
				if (i < pieces.length - 1) {
					assert.ok(Number.isFinite(piece.lte));
					assert.ok(piece.lte > (i == 0 ? 1 : piece.gt) && piece.lte < 1024);
					assert.deepEqual(pieces.filter(p => matches(p, piece.lte)), [piece]);
				}
			});
			assert.deepEqual(pieces.filter(p => matches(p, 1)), [pieces[0]]);
			assert.deepEqual(pieces.filter(p => matches(p, 1024)), [pieces.at(-1)]);
			for (let value = 1; value <= 1024; value += .5)
				assert.equal(pieces.filter(p => matches(p, value)).length, 1);
		}
		assert.deepEqual(byMode.linear.map(p => p.color), byMode.sqrt.map(p => p.color));
		assert.deepEqual(byMode.linear.map(p => p.color), byMode.log.map(p => p.color));
		assert.ok(byMode.sqrt[15].lte < byMode.linear[15].lte);
		assert.ok(byMode.log[15].lte < byMode.linear[15].lte);
	});

	it('handles constant counts without invalid color bounds', () => {
		for (const mode of ['linear', 'sqrt', 'log']) {
			const pieces = colorPieces(7, 7, mode);
			assert.ok(pieces.length > 0);
			assert.equal(pieces.filter(piece => matches(piece, 7)).length, 1);
			for (const piece of pieces) {
				assert.equal(typeof piece.color, 'string');
				for (const key of ['value', 'gt', 'lte'])
					if (key in piece) assert.ok(Number.isFinite(piece[key]));
			}
		}
	});

	it('uses native options, isolated control updates, source-index hover, zoom reset, and complete cleanup', () => {
		const frames = freeze(sparseFrames()), prepared = prepareData(frames);
		const root = rootFor(), mock = echartsMock();
		let demo, destroyed = false;
		try {
			const height = root.querySelector('#height'), color = root.querySelector('#color-scale');
			const button = root.querySelector('#set-data'), host = root.querySelector('#plot');
			const readout = root.querySelector('#hover');
			assert.equal(root.querySelector('#y-scale'), null);
			assert.equal(root.querySelector('#signed-data'), null);
			assert.match(button.textContent, /setOption\(\).*same data/);
			demo = createDemo(root, frames, mock);
			assert.equal(demo.plot, mock.plot);
			assert.equal(mock.calls.init.length, 1);
			assert.equal(mock.calls.init[0][0], host);
			assert.equal(mock.calls.init[0][2].renderer, 'canvas');
			assert.equal(mock.calls.init[0][2].width, 1000);
			assert.equal(mock.calls.init[0][2].height, height.valueAsNumber);
			assert.equal(host.style.height, `${height.value}px`);
			assertNativeOption(mock.calls.setOption[0][0], prepared);
			const axis = first(mock.calls.setOption[0][0].xAxis);
			assert.deepEqual(axis.data.map(axis.axisLabel.formatter), ['00:00', '00:01', '00:02']);
			const originalData = first(mock.calls.setOption[0][0].series).data;
			for (const control of [height, color, button]) assert.equal(control.disabled, false);

			for (const mode of ['sqrt', 'log', 'linear']) {
				const start = mock.calls.setOption.length;
				color.value = mode;
				color.dispatchEvent(new Event('change'));
				const update = assertOnlyUpdates(mock.calls, start, 'visualMap');
				assert.deepEqual(first(update.visualMap).pieces, colorPieces(3, 29, mode));
				assert.ok(root.querySelector('#color-scale-label').textContent.includes(mode == 'sqrt' ? '√' : mode));
			}
			let start = mock.calls.setOption.length;
			height.value = '720';
			height.dispatchEvent(new Event('input'));
			assert.deepEqual(mock.calls.resize.at(-1)[0], { width: 1000, height: 720 });
			assert.equal(root.querySelector('#height-value').textContent, '720px');
			assert.equal(host.style.height, '720px');
			Object.defineProperty(host, 'clientWidth', { configurable: true, value: 840 });
			window.dispatchEvent(new Event('resize'));
			assert.deepEqual(mock.calls.resize.at(-1)[0], { width: 840, height: 720 });
			assert.equal(mock.calls.setOption.length, start, 'resizing must not replace axes or data');
			button.click();
			const update = assertOnlyUpdates(mock.calls, start, 'series');
			assert.equal(first(update.series).data, originalData);
			assert.equal(first(update.series).type, undefined);

			const hint = readout.textContent;
			assert.ok(mock.plot.handlers.get('mouseover')?.size);
			assert.ok(mock.plot.handlers.get('mouseout')?.size);
			mock.plot.emit('mouseover', { componentType: 'series', seriesType: 'heatmap', seriesIndex: 0, dataIndex: 0, data: [99, 99, 999] });
			assert.equal(readout.textContent, '00:02:00–00:03:00 UTC · Y: 4–8 s · Count: 17');
			mock.plot.emit('mouseover', { componentType: 'series', seriesType: 'heatmap', seriesIndex: 0, dataIndex: 1 });
			assert.equal(readout.textContent, '00:00:00–00:01:00 UTC · Y: 1–2 s · Count: 3');
			mock.plot.emit('mouseout', { componentType: 'series', seriesIndex: 0 });
			assert.equal(readout.textContent, hint);

			assert.ok(mock.zr.handlers.get('dblclick')?.size);
			mock.zr.emit('dblclick', {});
			assert.ok(mock.calls.dispatchAction.length > 0);
			const action = mock.calls.dispatchAction.at(-1)[0];
			assert.equal(action.type, 'dataZoom');
			for (const zoom of action.batch ?? [action]) {
				assert.equal(zoom.start, 0);
				assert.equal(zoom.end, 100);
			}
			assert.equal(mock.calls.init.length, 1);

			demo.destroy();
			destroyed = true;
			assert.equal(mock.calls.dispose, 1);
			for (const name of ['mouseover', 'mouseout']) {
				assert.ok(mock.plot.offCalls.some(call => call[0] == name));
				assert.equal(mock.plot.handlers.get(name)?.size ?? 0, 0);
			}
			assert.ok(mock.zr.offCalls.some(call => call[0] == 'dblclick'));
			assert.equal(mock.zr.handlers.get('dblclick')?.size ?? 0, 0);
			const lengths = () => ['setOption', 'resize', 'dispatchAction'].map(key => mock.calls[key].length);
			const afterDestroy = lengths();
			height.dispatchEvent(new Event('input'));
			color.dispatchEvent(new Event('change'));
			button.dispatchEvent(new Event('click'));
			window.dispatchEvent(new Event('resize'));
			mock.plot.emit('mouseover', { componentType: 'series', dataIndex: 0 });
			mock.zr.emit('dblclick', {});
			assert.deepEqual(lengths(), afterDestroy);
			assert.equal(readout.textContent, hint);
		}
		finally { if (!destroyed) demo?.destroy(); root.remove(); }
	});

	for (const initiallyChecked of [true, false]) {
		it(`initializes progressive rendering ${initiallyChecked ? 'enabled' : 'disabled'} and toggles only the series setting`, () => {
			const root = rootFor(), mock = echartsMock();
			const progressive = root.querySelector('#progressive');
			let demo;
			try {
				assert.equal(progressive.checked, true);
				assert.equal(progressive.disabled, true);
				progressive.checked = initiallyChecked;
				demo = createDemo(root, sparseFrames(), mock);
				assert.equal(progressive.disabled, false);
				const series = first(mock.calls.setOption[0][0].series);
				assert.equal(series.progressive, initiallyChecked ? 5000 : 0);
				assert.equal(series.progressiveThreshold, 10000);
				const hint = root.querySelector('#hover').textContent;
				const actions = mock.calls.dispatchAction.length;
				for (const checked of [!initiallyChecked, initiallyChecked]) {
					mock.plot.emit('mouseover', { componentType: 'series', seriesIndex: 0, dataIndex: 0 });
					const start = mock.calls.setOption.length;
					progressive.checked = checked;
					progressive.dispatchEvent(new Event('change'));
					assert.deepEqual(assertOnlyUpdates(mock.calls, start, 'series'), { series: [{ id: 'cells', progressive: checked ? 5000 : 0 }] });
					assert.equal(root.querySelector('#hover').textContent, hint);
				}
				assert.equal(mock.calls.dispatchAction.length, actions, 'toggling must not reset zoom');
				assert.equal(mock.calls.init.length, 1);
				demo.destroy();
				demo = null;
				assert.equal(progressive.disabled, true);
				const updates = mock.calls.setOption.length;
				progressive.dispatchEvent(new Event('change'));
				assert.equal(mock.calls.setOption.length, updates);
			}
			finally { demo?.destroy(); root.remove(); }
		});
	}

	it('accepts global ECharts and initializes with the actual host width and selected height', () => {
		const root = rootFor(875), mock = echartsMock();
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'echarts');
		let demo;
		try {
			Object.defineProperty(globalThis, 'echarts', { configurable: true, value: mock });
			root.querySelector('#height').value = '680';
			demo = createDemo(root, sparseFrames());
			assert.equal(demo.plot, mock.plot);
			assert.equal(mock.calls.init[0][2].width, 875);
			assert.equal(mock.calls.init[0][2].height, 680);
		}
		finally {
			demo?.destroy();
			root.remove();
			if (previous) Object.defineProperty(globalThis, 'echarts', previous);
			else delete globalThis.echarts;
		}
	});
});
