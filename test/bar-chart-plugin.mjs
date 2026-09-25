import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';
import { barChartPlugin } from '../demos/lib/barChartPlugin.js';

describe('barChartPlugin', () => {
	let plots, originalOffscreenCanvas, canvases, activeMeasurements;

	beforeEach(() => {
		plots = new Set();
		canvases = new Map();
		activeMeasurements = null;
		originalOffscreenCanvas = globalThis.OffscreenCanvas;
		globalThis.OffscreenCanvas = class {
			constructor(width, height) {
				this.width = width;
				this.height = height;
				this.ctx = {
					log: [],
					set font(value) { this.log.push(['font', value]); },
					measureText(text) {
						const font = this.log.at(-1)[1];
						activeMeasurements.push({ text: String(text), font, ctx: this });
						return { width: String(text).length * parseFloat(font) / 2 };
					},
				};
				canvases.set(this.ctx, this);
			}
			getContext(type) {
				assert.equal(type, '2d');
				return this.ctx;
			}
		};
	});
	afterEach(() => {
		try {
			for (const u of plots)
				u.destroy();
		}
		finally {
			if (originalOffscreenCanvas === undefined)
				delete globalThis.OffscreenCanvas;
			else
				globalThis.OffscreenCanvas = originalOffscreenCanvas;
		}
	});

	function mount(data, options = {}, chartOptions = {}, plugin = barChartPlugin(options)) {
		const measurements = [];
		const u = new uPlot({
			width: 700,
			height: 450,
			pxRatio: 1,
			series: [{}, { fill: 'royalblue' }],
			...chartOptions,
			plugins: [{
				...plugin,
				opts(u, opts) {
					const configured = plugin.opts(u, opts) ?? opts;
					// Attribute lazy context measurements to the chart doing layout,
					// even when multiple charts have pending layout microtasks.
					const attribute = fn => (...args) => {
						const previous = activeMeasurements;
						activeMeasurements = measurements;
						try {
							return fn(...args);
						}
						finally {
							activeMeasurements = previous;
						}
					};
					for (const axis of configured.axes.slice(0, 2))
						axis.size = attribute(axis.size);
					configured.padding = configured.padding.map(value => typeof value === 'function' ? attribute(value) : value);
					return configured;
				},
			}],
		}, data, document.body);
		plots.add(u);
		return { u, plugin, measurements };
	}

	function destroy(u) {
		u.destroy();
		plots.delete(u);
	}

	const width = (u, label, axisIdx = 0) => String(label).length * parseFloat(u.axes[axisIdx].font[0]) / 2 / u.pxRatio;
	const fullLabels = u => u.data[0];
	const rects = (u, seriesIdx) => u.series[seriesIdx]._paths.fill.log
		.filter(entry => entry[0] === 'rect').flatMap(entry => entry.slice(1));

	function assertCategories(u, labels, horizontal = false) {
		assert.equal(u.mode, 1);
		assert.equal(u.scales.x.time, false);
		assert.equal(u.scales.x.distr, 2);
		assert.equal(u.scales.x.ori, horizontal ? 1 : 0);
		assert.equal(u.scales.x.dir, horizontal ? -1 : 1);
		assert.equal(u.axes[0].side, horizontal ? 3 : 2);
		assert.equal(u.axes[1].scale, 'y');
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [-.5, Math.max(1, labels.length) - .5]);
		assert.deepEqual(u.axes[0]._splits ?? [], labels.map((_, i) => i));
		assert.deepEqual(u.axes[0]._values ?? [], labels);
	}

	function assertMetrics(u, plugin) {
		const labels = u.axes[0]._values ?? [];
		const label = labels.reduce((longest, next) => width(u, next) > width(u, longest) ? next : longest, '');
		assert.deepEqual(plugin._getLabelMetrics(), { label, width: width(u, label) });
	}

	function assertLayout(u, inset = 8) {
		const axis = u.axes[0];
		const rotation = axis._rotate;
		const radians = Math.abs(rotation) * Math.PI / 180;
		const sin = Math.sin(radians);
		const cos = Math.cos(radians);
		const height = axis.font[1] / u.pxRatio;
		const labels = axis._values ?? [];
		const longest = Math.max(0, ...labels.map(label => width(u, label)));
		const labelHeight = rotation === 0 ? height : longest * sin + height / 2 * cos;
		assert.equal(axis._size, Math.ceil(axis.ticks.size + axis.gap + labelHeight + inset));
		for (const [i, label] of labels.entries()) {
			const near = height / 2 * sin;
			const far = width(u, label) * cos + near;
			const left = rotation === 0 ? width(u, label) / 2 : rotation > 0 ? far : near;
			const right = rotation === 0 ? width(u, label) / 2 : rotation < 0 ? far : near;
			const center = u.valToPos(i, 'x', true) / u.pxRatio;
			assert.ok(center >= left + inset - .5 / u.pxRatio, `left clearance for category ${i}`);
			assert.ok(u.width - center >= right + inset - .5 / u.pxRatio, `right clearance for category ${i}`);
		}
		assert.ok(u._padding[1] >= inset && u._padding[3] >= inset);
		assert.ok(u.bbox.width > 0 && u.bbox.height > 0);
	}

	it('installs bar paths through opts and forwards bars options', () => {
		const original = uPlot.paths.bars;
		const calls = [];
		const path = () => {};
		const bars = { size: [.65, 35], align: 0, radius: .2 };
		uPlot.paths.bars = options => {
			calls.push(options);
			return path;
		};
		try {
			const plugin = barChartPlugin({ bars });
			const opts = { axes: [{}, {}], series: [{}, {}, {}] };
			const configured = plugin.opts({ data: [['A', 'B'], [1, 2], [3, 4]] }, opts) ?? opts;
			assert.ok(calls.length > 0);
			for (const options of calls) {
				for (const key of Object.keys(bars))
					assert.deepEqual(options[key], bars[key]);
			}
			for (const series of configured.series.slice(1))
				assert.equal(series.paths, path);
			assert.equal(configured.scales.x.distr, 2);
			assert.equal(configured.scales.x.time, false);
			assert.equal(configured.scales.y.axis, 1);
			assert.equal(configured.scales.y.range.min.soft, 0);
			assert.equal(configured.scales.y.range.max.soft, 0);
		}
		finally {
			uPlot.paths.bars = original;
		}
	});

	it('uses original string and numeric X labels, every category tick, and bars on every Y series', async () => {
		const data = [['Long category A', 'B', 'Final category'], [2, 4, 3], [1, 3, 2]];
		const { u } = mount(data, {}, { series: [{}, { fill: 'red' }, { fill: 'blue' }] });
		await Promise.resolve();
		assertCategories(u, data[0]);
		assert.deepEqual(fullLabels(u), data[0]);
		assert.equal(u.data, data);
		assert.equal(u.axes[0]._rotate, 0);
		for (const seriesIdx of [1, 2]) {
			const bars = rects(u, seriesIdx);
			assert.equal(bars.length, 3);
			for (const [x, , w] of bars) {
				assert.ok(w > 0);
				assert.ok(x >= u.bbox.left && x + w <= u.bbox.left + u.bbox.width);
			}
		}
		for (const xs of [['Replacement', 'New'], [10, 75, 1000, 2000]]) {
			u.setData([xs, xs.map(() => 2), xs.map(() => 1)]);
			await Promise.resolve();
			assertCategories(u, xs.map(String));

			assert.deepEqual(u.data[0], xs, 'ordinal positions do not replace caller data');
		}
	});

	it('refreshes native X labels on ordinary setData, including changed counts', async () => {
		const labels = ['First category label', 'Second category label'];
		const { u, plugin } = mount([labels, [1, 2]]);
		await Promise.resolve();
		assertCategories(u, labels);
		plugin._setLabelTruncation(3);
		await Promise.resolve();
		assert.deepEqual(u.axes[0]._values, ['Fi…', 'Se…']);

		assert.deepEqual(u.data[0], labels);
		plugin._setLabelTruncation(null);
		await Promise.resolve();
		for (const labels of [['Same count', 'Different names'], ['One', 'Two', 'Three', 'Four'], ['Only one']]) {
			const data = [labels, labels.map((_, i) => i + 1)];
			u.setData(data);
			await Promise.resolve();
			assertCategories(u, labels);
			assert.deepEqual(fullLabels(u), labels);
			assert.equal(u.data, data);
			assertMetrics(u, plugin);
		}

	});

	it('preserves caller fonts, formatted Y values, fills, and explicit Y range configurations', async () => {
		const values = (u, splits) => splits.map(value => `${value.toFixed(2)} widgets`);
		const fill = () => 'orange';
		const labels = ['Alpha', 'Beta'];
		const { u, measurements } = mount([labels, [2, 7]], {}, {
			axes: [{ font: '18px serif' }, { font: '14px monospace', values }],
			series: [{}, { fill }],
			scales: { y: { range: [-5, 15] } },
		});
		await Promise.resolve();
		assertCategories(u, labels);
		assert.equal(u.axes[0].font[0], '18px serif');
		assert.equal(u.axes[1].font[0], '14px monospace');
		assert.equal(u.axes[1].values, values);
		assert.equal(u.series[1].fill, fill);
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [-5, 15]);
		assert.ok(measurements.some(({ text, font }) => text.endsWith(' widgets') && font === '14px monospace'));

		for (const range of [[-5, 15], [0, null], () => [-7, 21], { min: { soft: -20, pad: .2 }, max: { hard: 50 } }]) {
			const opts = { axes: [{}, {}], series: [{}, {}], scales: { y: { range } } };
			const expected = typeof range === 'function' ? range : structuredClone(range);
			const configured = barChartPlugin().opts({ data: [[0, 1], [2, 7]] }, opts) ?? opts;
			assert.deepEqual(configured.scales.y.range, expected);
		}
	});

	it('measures on offscreen contexts shared by font without repeated font assignments or save/restore', async () => {
		const plugin = barChartPlugin();
		let revision = 0;
		const chartOptions = {
			axes: [
				{ font: '14px serif' },
				{ font: '14px serif', values: (u, splits) => splits.map(value => `Y${revision}: ${value}`) },
			],
		};
		const { u, measurements } = mount([['Alpha', 'Beta'], [1, 2]], {}, chartOptions, plugin);
		assert.equal(canvases.size, 0, 'measurement contexts are created lazily');
		await Promise.resolve();

		function assertContexts(expected) {
			assert.ok(measurements.length > 0);
			assert.ok(measurements.every(({ ctx }) => ctx !== u.ctx), 'measurement never uses the drawing context');
			assert.deepEqual(new Set(measurements.map(({ ctx }) => ctx)), new Set(expected));
			assert.equal(canvases.size, expected.length, 'one offscreen canvas per unique font');
			for (const ctx of expected) {
				const canvas = canvases.get(ctx);
				assert.ok(canvas instanceof OffscreenCanvas);
				assert.ok(!(canvas instanceof HTMLCanvasElement));
				assert.deepEqual([canvas.width, canvas.height], [1, 1]);
				assert.equal(ctx.log.filter(entry => entry[0] === 'font').length, 1);
				assert.ok(ctx.log.every(entry => entry[0] !== 'save' && entry[0] !== 'restore'));
			}
		}

		const shared = measurements.find(({ text }) => text === 'Alpha').ctx;
		assert.ok(measurements.some(({ text, ctx }) => text.startsWith('Y0:') && ctx === shared), 'same-font axes share a context');
		assertContexts([shared]);

		u.axes[1].font[0] = '18px monospace';
		u.axes[1].font[1] = 18;
		const beforeFont = measurements.length;
		u.redraw(false, true);
		await Promise.resolve();
		const separate = measurements[beforeFont].ctx;
		assert.notEqual(separate, shared, 'a different font needs a separate context');
		assert.ok(measurements.slice(beforeFont).every(({ font, ctx }) => font === '18px monospace' && ctx === separate));
		assertContexts([shared, separate]);

		for (revision = 1; revision <= 3; revision++) {
			const before = measurements.length;
			const labels = [`Alpha ${revision}`, `Beta ${revision}`];
			u.setData([labels, [revision, revision * 2]]);
			await Promise.resolve();
			const recent = measurements.slice(before);
			assert.deepEqual(recent.filter(({ ctx }) => ctx === shared).map(({ text }) => text), labels);
			assert.ok(recent.some(({ text, ctx }) => text.startsWith(`Y${revision}:`) && ctx === separate));
			assertContexts([shared, separate]);
		}

		const beforeReuse = measurements.length;
		u.axes[1].font[0] = '14px serif';
		u.axes[1].font[1] = 14;
		u.redraw(false, true);
		await Promise.resolve();
		assert.ok(measurements.length > beforeReuse);
		assert.ok(measurements.slice(beforeReuse).every(({ ctx }) => ctx === shared), 'returning to a font reuses its context');
		assertContexts([shared, separate]);

		destroy(u);
		const next = mount([['Gamma', 'Delta'], [3, 4]], {}, chartOptions, plugin);
		await Promise.resolve();
		const nextContexts = new Set(next.measurements.map(({ ctx }) => ctx));
		assert.equal(nextContexts.size, 1);
		assert.ok(!nextContexts.has(shared) && !nextContexts.has(separate), 'destroy clears the font context map');
		assert.ok(!nextContexts.has(next.u.ctx));
	});

	it('sizes Y from formatted ticks and retains tick-aware zero soft defaults across data changes', async () => {
		const values = (u, splits) => splits.map(value => `${value.toFixed(3)} units`);
		const { u, measurements } = mount([['A', 'B', 'C'], [20, 40, 60]], {}, { axes: [{}, { values }] });
		await Promise.resolve();
		const sizes = [];
		for (const ys of [[20, 40, 60], [-60, -40, -20], [-1e7, 0, 2e7], [-.002, 0, .004]]) {
			u.setData([u.data[0], ys]);
			await Promise.resolve();
			const axis = u.axes[1];
			assert.equal(u.scales.y.axis, 1);
			assert.deepEqual([axis._splits[0], axis._splits.at(-1)], [u.scales.y.min, u.scales.y.max]);
			assert.ok(u.scales.y.min <= Math.min(0, ...ys));
			assert.ok(u.scales.y.max >= Math.max(0, ...ys));
			if (ys.every(y => y > 0)) assert.equal(u.scales.y.min, 0);
			if (ys.every(y => y < 0)) assert.equal(u.scales.y.max, 0);
			const labels = axis._values.filter(label => label != null);
			assert.ok(labels.length > 0);
			assert.deepEqual(axis._values, values(u, axis._splits));
			for (const label of labels)
				assert.ok(measurements.some(({ text, font }) => text === label && font === axis.font[0]));
			assert.equal(axis._size, Math.ceil(Math.max(...labels.map(label => width(u, label, 1))) + axis.ticks.size + axis.gap + 8));
			sizes.push(axis._size);
		}
		assert.ok(new Set(sizes).size > 1);
		assert.equal(measurements.filter(({ text }) => ['A', 'B', 'C'].includes(text)).length, 3, 'Y changes retain cached X metrics');
	});

	it('exposes prefixed methods at factory time without mutating options, applies pre-mount settings, and stops redrawing after destroy', async () => {
		const options = Object.freeze({ labelRotation: 15, maxLabelLength: 4, ellipsis: 'end' });
		const plugin = barChartPlugin(options);
		for (const method of ['_setLabelRotation', '_setLabelTruncation', '_getLabelMetrics'])
			assert.equal(typeof plugin[method], 'function');
		assert.equal(typeof plugin.opts, 'function');
		assert.equal(typeof plugin.hooks, 'object');
		for (const [name, value] of Object.entries(plugin)) {
			if (typeof value === 'function' && name !== 'opts')
				assert.ok(name.startsWith('_'), `custom method ${name} must have an underscore prefix`);
		}
		assert.deepEqual(plugin._getLabelMetrics(), { label: '', width: 0 });
		plugin._setLabelRotation(-45);
		plugin._setLabelTruncation(5, 'middle');
		const { u } = mount([['abcdefghij', 'xy'], [1, 2]], {}, {}, plugin);
		await Promise.resolve();
		assert.equal(u.axes[0]._rotate, -45);
		assert.deepEqual(u.axes[0]._values, ['ab…ij', 'xy']);
		assertMetrics(u, plugin);
		const redraw = u.redraw;
		let redraws = 0;
		u.redraw = (...args) => { redraws++; return redraw(...args); };
		plugin._setLabelRotation(45);
		await Promise.resolve();
		assert.ok(redraws > 0);
		assert.equal(u.axes[0]._rotate, 45);
		destroy(u);
		const before = redraws;
		plugin._setLabelRotation(0);
		plugin._setLabelTruncation(null);
		await Promise.resolve();
		assert.equal(redraws, before, 'plugin methods must not redraw a destroyed chart');
		assert.deepEqual(options, { labelRotation: 15, maxLabelLength: 4, ellipsis: 'end' }, 'factory and methods leave caller options unchanged');
	});

	it('truncates at either end or middle, handles maxLength 1, and skips ineffective redraws without changing data', async () => {
		const data = [['abcdefghij', 'xy'], [1, 2]];
		const original = structuredClone(data);
		const { u, plugin } = mount(data);
		await Promise.resolve();
		const redraw = u.redraw;
		let redraws = 0;
		u.redraw = (...args) => { redraws++; return redraw(...args); };
		plugin._setLabelRotation(0);
		plugin._setLabelTruncation(null);
		plugin._setLabelTruncation(100, 'end');
		plugin._setLabelTruncation(100, 'middle');
		await Promise.resolve();
		assert.equal(redraws, 0, 'unchanged effective labels and rotation need no redraw');
		for (const [limit, ellipsis, expected] of [
			[5, 'end', ['abcd…', 'xy']],
			[5, 'middle', ['ab…ij', 'xy']],
			[1, 'middle', ['…', '…']],
			[null, undefined, data[0]],
		]) {
			const before = redraws;
			plugin._setLabelTruncation(limit, ellipsis);
			await Promise.resolve();
			assert.ok(redraws > before);
			assert.deepEqual(u.axes[0]._values, expected);
			assert.deepEqual(fullLabels(u), data[0]);
			assertMetrics(u, plugin);
			const after = redraws;
			plugin._setLabelTruncation(limit, ellipsis);
			await Promise.resolve();
			assert.equal(redraws, after);
		}
		assert.equal(u.data, data);
		assert.deepEqual(data, original);
	});

	it('rejects invalid method inputs without changing the current settings or redrawing', async () => {
		const { u, plugin } = mount([['Alphabet', 'Beta'], [1, 2]], { labelRotation: 15, maxLabelLength: 4 });
		await Promise.resolve();
		let redraws = 0;
		u.redraw = () => { redraws++; };
		for (const degrees of [NaN, Infinity, -Infinity, -91, 91, '45', null])
			assert.throws(() => plugin._setLabelRotation(degrees));
		for (const limit of [0, -1, 1.5, NaN, Infinity, '4'])
			assert.throws(() => plugin._setLabelTruncation(limit));
		assert.throws(() => plugin._setLabelTruncation(4, 'start'));
		await Promise.resolve();
		assert.equal(redraws, 0, 'invalid method input must not redraw');
		assert.equal(u.axes[0]._rotate, 15);
		assert.deepEqual(u.axes[0]._values, ['Alp…', 'Beta']);
	});

	it('keeps chart instances, plugin methods, and measurement caches independent', async () => {
		const a = mount([['Shared label', 'A'], [1, 2]]);
		const b = mount([['Shared label', 'B'], [3, 4]], {}, { axes: [{ font: '20px serif' }, {}] });
		assert.notEqual(a.plugin, b.plugin);
		assert.notEqual(a.plugin._setLabelRotation, b.plugin._setLabelRotation);
		assert.notEqual(a.plugin._setLabelTruncation, b.plugin._setLabelTruncation);
		assert.notEqual(a.plugin._getLabelMetrics, b.plugin._getLabelMetrics);
		await Promise.resolve();
		assertMetrics(a.u, a.plugin);
		assertMetrics(b.u, b.plugin);
		assert.notEqual(a.plugin._getLabelMetrics().width, b.plugin._getLabelMetrics().width);
		const before = b.measurements.length;
		const metrics = { ...b.plugin._getLabelMetrics() };
		a.plugin._setLabelTruncation(4);
		a.plugin._setLabelRotation(90);
		a.u.setData([['Changed', 'Labels', 'Here'], [1, 2, 3]]);
		await Promise.resolve();
		b.u.redraw(false, true);
		await Promise.resolve();
		assert.deepEqual(b.u.axes[0]._values, ['Shared label', 'B']);
		assert.equal(b.u.axes[0]._rotate, 0);
		assert.deepEqual(b.plugin._getLabelMetrics(), metrics);
		assert.equal(b.measurements.length, before);
		destroy(a.u);
		b.plugin._setLabelRotation(-90);
		b.plugin._setLabelTruncation(6, 'middle');
		await Promise.resolve();
		assert.equal(b.u.axes[0]._rotate, -90);
		assert.deepEqual(b.u.axes[0]._values, ['Sha…el', 'B']);
		assertMetrics(b.u, b.plugin);
	});

	it('handles empty and single-category datasets through ordinary setData', async () => {
		const { u, plugin } = mount([[], []]);
		await Promise.resolve();
		assertCategories(u, []);
		assert.deepEqual(plugin._getLabelMetrics(), { label: '', width: 0 });
		for (const data of [[['Only category'], [5]], [[], []], [['Replacement'], [-3]]]) {
			u.setData(data);
			await Promise.resolve();
			assertCategories(u, data[0]);
			assertMetrics(u, plugin);
			assert.deepEqual(fullLabels(u), data[0]);
			if (data[0].length === 1) {
				const [[x, , w]] = rects(u, 1);
				assert.ok(w > 0 && x >= u.bbox.left && x + w <= u.bbox.left + u.bbox.width);
			}
		}
	});

	function assertHorizontalLayout(u, inset = 8) {
		assertCategories(u, u.axes[0]._values, true);
		assert.equal(u.scales.y.ori, 0);
		assert.equal(u.axes[1].side, 2);
		for (const [i, axis] of u.axes.slice(0, 2).entries()) {
			assert.equal(axis._rotate, 0);
			const extent = i === 0 ? Math.max(0, ...axis._values.map(label => width(u, label))) : axis.font[1] / u.pxRatio;
			assert.equal(axis._size, Math.ceil(extent + (axis.ticks.show ? axis.ticks.size : 0) + axis.gap + inset));
		}
		assert.ok(Object.values(u.bbox).every(Number.isFinite));
		assert.ok(u.bbox.width > 0 && u.bbox.height > 0);
		assert.ok(u._padding.every(value => Number.isFinite(value) && value >= inset));
		for (const [i, label] of u.axes[1]._values.entries()) {
			if (label == null) continue;
			const center = u.valToPos(u.axes[1]._splits[i], 'y', true) / u.pxRatio;
			const half = width(u, label, 1) / 2;
			assert.ok(center - half >= inset - 1 / u.pxRatio, 'numeric label clears the left edge');
			assert.ok(center + half <= u.width - inset + 1 / u.pxRatio, 'numeric label clears the right edge');
		}
	}

	function assertHorizontalRects(u, seriesIdx = 1) {
		const bars = rects(u, seriesIdx);
		assert.equal(bars.length, u.data[0].length);
		const zero = u.valToPos(0, 'y', true);
		for (const [i, [x, y, w, h]] of bars.entries()) {
			assert.ok([x, y, w, h].every(Number.isFinite));
			assert.ok(w > 0 && h > 0);
			assert.ok(x >= u.bbox.left - 1 && x + w <= u.bbox.left + u.bbox.width + 1);
			assert.ok(y >= u.bbox.top - 1 && y + h <= u.bbox.top + u.bbox.height + 1);
			const center = u.bbox.top + (i + .5) * u.bbox.height / bars.length;
			assert.ok(Math.abs(y + h / 2 - center) <= 1, `category ${i} is centered in its top-down slot`);
			assert.ok(Math.abs(y + h / 2 - u.valToPos(i, 'x', true)) <= 1);
			const value = u.data[seriesIdx][i];
			const endpoint = u.valToPos(value, 'y', true);
			assert.ok(Math.abs((value > 0 ? x : x + w) - zero) <= 1, `bar ${i} starts at zero`);
			assert.ok(Math.abs((value > 0 ? x + w : x) - endpoint) <= 1, `bar ${i} ends at its value`);
			if (i > 0) assert.ok(y > bars[i - 1][1], 'categories run top-down');
		}
	}

	it('validates orientation and rejects horizontal rotation before and after mounting', async () => {
		for (const orientation of ['diagonal', '', null, 0, true])
			assert.throws(() => barChartPlugin({ orientation }));
		for (const labelRotation of [-90, -1, 1, 45, 90])
			assert.throws(() => barChartPlugin({ orientation: 'horizontal', labelRotation }), RangeError);
		const plugin = barChartPlugin({ orientation: 'horizontal' });
		assert.throws(() => plugin._setLabelRotation(15), RangeError);
		plugin._setLabelRotation(0);
		const { u } = mount([['Alpha', 'Beta'], [1, 2]], {}, {}, plugin);
		await Promise.resolve();
		let redraws = 0;
		u.redraw = () => { redraws++; };
		for (const degrees of [-45, 45])
			assert.throws(() => plugin._setLabelRotation(degrees), RangeError);
		plugin._setLabelRotation(0);
		await Promise.resolve();
		assert.equal(redraws, 0);
		assertHorizontalLayout(u);
		assertMetrics(u, plugin);
		const vertical = mount([['A', 'B'], [1, 2]], { orientation: 'vertical' }).u;
		await Promise.resolve();
		assertCategories(vertical, ['A', 'B']);
		assertLayout(vertical);
	});

	it('draws horizontal bars from zero for mixed, positive, and negative values while preserving numeric formatting and range', async () => {
		const labels = ['First', 'Second', 'Third'];
		const values = (u, splits) => splits.map(value => `${value.toFixed(1)} units`);
		const range = () => [-10, 10];
		const { u } = mount([labels, [-6, 3, 8]], { orientation: 'horizontal' }, {
			axes: [{ font: '16px serif' }, { font: '14px monospace', values }],
			scales: { y: { range } },
		});
		await Promise.resolve();
		for (const ys of [[-6, 3, 8], [2, 4, 8], [-8, -4, -2]]) {
			u.setData([labels, ys]);
			await Promise.resolve();
			assertCategories(u, labels, true);
			assertHorizontalLayout(u);
			assertHorizontalRects(u);
			assert.equal(u.axes[0].font[0], '16px serif');
			assert.equal(u.axes[1].font[0], '14px monospace');
			assert.equal(u.axes[1].values, values);
			assert.deepEqual(u.axes[1]._values, values(u, u.axes[1]._splits));
			assert.deepEqual([u.scales.y.min, u.scales.y.max], [-10, 10]);
		}
		for (const range of [[-5, 15], [0, null], () => [-7, 21], { min: { soft: -20, pad: .2 }, max: { hard: 50 } }]) {
			const opts = { axes: [{}, {}], series: [{}, {}], scales: { y: { range } } };
			const expected = typeof range === 'function' ? range : structuredClone(range);
			const configured = barChartPlugin({ orientation: 'horizontal' }).opts({ data: [labels, [1, 2, 3]] }, opts) ?? opts;
			assert.deepEqual(configured.scales.y.range, expected);
		}
	});

	it('reserves horizontal category width and recalculates numeric ticks after same-count label changes', async () => {
		const { u, plugin } = mount([['A', 'B', 'C'], [20, 40, 80]], { orientation: 'horizontal', inset: 12 }, {
			axes: [{ font: '14px serif', gap: 7, ticks: { show: false, size: 11 } }, { space: 70, gap: 9, ticks: { size: 13 } }],
			scales: { y: { range: [0, 100] } },
		});
		await Promise.resolve();
		assertHorizontalLayout(u, 12);
		const before = { width: u.bbox.width, height: u.bbox.height, size: u.axes[0]._size, splits: u.axes[1]._splits.slice() };
		const data = [['A much longer category label that needs more room', 'B', 'C'], [20, 40, 80]];
		u.setData(data);
		await Promise.resolve();
		assert.equal(u.data, data);
		assertCategories(u, data[0], true);
		assertMetrics(u, plugin);
		assertHorizontalLayout(u, 12);
		assertHorizontalRects(u);
		assert.ok(u.bbox.width < before.width);
		assert.equal(u.bbox.height, before.height);
		assert.equal(before.width - u.bbox.width, u.axes[0]._size - before.size);
		assert.ok(u.axes[1]._splits.length < before.splits.length, 'narrower numeric axis has fewer ticks');
		assert.ok(u.axes[1]._splits[1] - u.axes[1]._splits[0] > before.splits[1] - before.splits[0], 'numeric tick increment responds to plot width');
		u.axes[0].ticks.show = true;
		u.axes[1].ticks.show = false;
		u.redraw(false, true);
		await Promise.resolve();
		assertHorizontalLayout(u, 12);
	});

	function mountHorizontalRange(data, chartOptions) {
		const selections = [];
		const plugin = barChartPlugin({ orientation: 'horizontal' });
		return {
			...mount(data, {}, chartOptions, {
				...plugin,
				opts(u, opts) {
					plugin.opts(u, opts);
					const space = opts.axes[1].space;
					opts.axes[1].space = (u, axisIdx, min, max, dim) => {
						selections.push({ axisIdx, min, max, dim, space, width: u.bbox.width / u.pxRatio, padding: u._padding.slice() });
						return space;
					};
				},
			}),
			selections,
		};
	}

	function assertHorizontalRange(u, selections, space = 100) {
		const axis = u.axes[1];
		const scale = u.scales.y;
		const dim = u.width - u.axes[0]._size - 16;
		assert.equal(scale.axis, 1);
		assert.equal(scale._axisY, true, 'horizontal numeric scale uses tick-aware ranging');
		assert.deepEqual(scale._rawY, [20, 80]);
		assert.deepEqual(selections, [{ axisIdx: 1, min: 20, max: 80, dim, space, width: dim, padding: [8, 8, 8, 8] }],
			'one range selection uses category-sized CSS width and baseline padding');
		const expected = rangeY(20, 80, dim, { min: { soft: 0 }, max: { soft: 0 } }, axis.ramp, axis.exact, space);
		assert.ok(expected && expected.count > 1);
		assert.deepEqual(scale._rangeY, expected);
		assert.deepEqual([scale.min, scale.max], [expected.min, expected.max]);
		assert.deepEqual(axis._splits, Array.from({ length: expected.count + 1 }, (_, i) => expected.min + i * expected.incr));
		assert.deepEqual(axis._found, [expected.incr, dim / expected.count], 'tick spacing uses provisional, not overflow-reduced width');
		assert.equal(u.bbox.width / u.pxRatio, u.width - u.axes[0]._size - u._padding[1] - u._padding[3]);
		assertHorizontalLayout(u);
		return { dim, range: { ...scale._rangeY }, splits: axis._splits.slice() };
	}

	for (const pxRatio of [1, 2]) {
		for (const space of [100, 70]) {
			it(`ranges horizontal ticks after category auto-sizing, independently of height (DPR ${pxRatio}, space ${space})`, async () => {
				const labels = ['A', 'B', 'C'];
				const ys = [20, 40, 80];
				const { u, selections } = mountHorizontalRange([labels, ys], {
					width: 900, pxRatio,
					axes: [{ font: '14px serif' }, space === 100 ? {} : { space }],
				});
				await Promise.resolve();
				const before = assertHorizontalRange(u, selections, space);
				const beforeHeight = u.bbox.height;
				selections.length = 0;
				u.setData([['A'.repeat(51), 'B', 'C'], ys]);
				await Promise.resolve();
				const wider = assertHorizontalRange(u, selections, space);
				assert.equal(before.dim - wider.dim, 350, '50 extra category characters reserve 350 CSS pixels');
				assert.equal(u.bbox.height, beforeHeight);
				assert.notDeepEqual(wider.range, before.range);
				assert.notEqual(wider.range.max, before.range.max, 'category width changes the numeric bounds, not just tick spacing');
				assert.ok(wider.splits.length < before.splits.length);

				for (const height of [300, 600]) {
					selections.length = 0;
					u.setSize({ width: 900, height });
					await Promise.resolve();
					assert.deepEqual(assertHorizontalRange(u, selections, space), wider, 'height-only resize retains width, range, and ticks');
					assert.notEqual(u.bbox.height, beforeHeight);
				}

				selections.length = 0;
				u.setData([labels, ys]);
				await Promise.resolve();
				assert.deepEqual(assertHorizontalRange(u, selections, space), before, 'short labels restore the original selection');
				const counts = [];
				for (const width of [480, 700, 900]) {
					selections.length = 0;
					u.setSize({ width, height: 600 });
					await Promise.resolve();
					const current = assertHorizontalRange(u, selections, space);
					counts.push(current.range.count);
					if (width === 700 && space === 70)
						assert.notDeepEqual(current.range, rangeY(20, 80, current.dim, { min: { soft: 0 }, max: { soft: 0 } }, u.axes[1].ramp, u.axes[1].exact, 100),
							'explicit space overrides the plugin default without disabling tick-aware ranging');
				}
				assert.ok(new Set(counts).size > 1, 'numeric tick count responds to CSS chart width');
			});
		}

		it(`applies horizontal numeric formatter overflow without range feedback across redraws (DPR ${pxRatio})`, async () => {
			let suffix = '';
			const formatted = [];
			const values = (u, splits) => {
				formatted.push(u.scales.y._rangeY);
				return splits.map(value => `${value}${suffix}`);
			};
			const { u, selections } = mountHorizontalRange([['A', 'B', 'C'], [20, 40, 80]], {
				width: 900, pxRatio,
				axes: [{ font: '14px serif' }, { font: '14px serif', values }],
			});
			await Promise.resolve();
			const baseline = assertHorizontalRange(u, selections);
			const sizes = u.axes.map(axis => axis._size);
			const padding = u._padding.slice();
			const plotWidth = u.bbox.width;
			for (const next of [' units'.repeat(10), '']) {
				suffix = next;
				let previous;
				for (let pass = 0; pass < 3; pass++) {
					selections.length = formatted.length = 0;
					u.redraw(false, true);
					await Promise.resolve();
					assert.deepEqual(assertHorizontalRange(u, selections), baseline, 'formatter width does not change the selected range or ticks');
					assert.equal(formatted.length, 1, 'one numeric formatting pass per layout');
					assert.equal(formatted[0], u.scales.y._rangeY, 'overflow does not replace the range after formatting');
					assert.deepEqual(u.axes[1]._values, baseline.splits.map(value => `${value}${suffix}`));
					assert.deepEqual(u.axes.map(axis => axis._size), sizes, 'numeric text width changes padding, not axis reservation');
					if (suffix) {
						assert.ok(u._padding[1] > padding[1] && u._padding[3] > padding[3]);
						assert.ok(u.bbox.width < plotWidth);
						assert.notDeepEqual(u.scales.y._rangeY, rangeY(20, 80, u.bbox.width / pxRatio, { min: { soft: 0 }, max: { soft: 0 } }, u.axes[1].ramp, u.axes[1].exact, 100),
							'fixture would select a different range if final overflow width fed back into ranging');
					}
					else {
						assert.deepEqual(u._padding, padding, 'short formatting restores automatic padding');
						assert.equal(u.bbox.width, plotWidth);
					}
					const current = { padding: u._padding.slice(), bbox: { ...u.bbox } };
					if (previous)
						assert.deepEqual(current, previous, 'unchanged redraw does not accumulate overflow padding');
					previous = current;
				}
			}
		});
	}

	it('keeps horizontal truncation and metrics category-oriented and reuses offscreen contexts through resize and DPR changes', async () => {
		const data = [['abcdefghij', 'klmnopqrst'], [-3, 7]];
		const original = structuredClone(data);
		const values = (u, splits) => splits.map(value => `Numeric value ${value}`);
		const { u, plugin, measurements } = mount(data, { orientation: 'horizontal' }, {
			axes: [{ font: '14px serif' }, { font: '14px serif', values }],
		});
		await Promise.resolve();
		const shared = measurements.find(({ text }) => text === data[0][0]).ctx;
		assert.ok(measurements.some(({ text, ctx }) => text.startsWith('Numeric value ') && ctx === shared));
		for (const [limit, position, expected] of [
			[5, 'end', ['abcd…', 'klmn…']],
			[5, 'middle', ['ab…ij', 'kl…st']],
			[1, 'middle', ['…', '…']],
			[null, 'end', data[0]],
		]) {
			plugin._setLabelTruncation(limit, position);
			await Promise.resolve();
			assertCategories(u, expected, true);
			assertMetrics(u, plugin);
			assertHorizontalLayout(u);
			assertHorizontalRects(u);
			assert.deepEqual(u.axes[1]._values, values(u, u.axes[1]._splits));
		}
		assert.equal(u.data, data);
		assert.deepEqual(data, original);
		plugin._setLabelTruncation(5, 'middle');
		const replacement = [['uvwxyzabcd', 1234567890], [-2, 5]];
		u.setData(replacement);
		await Promise.resolve();
		const expected = ['uv…cd', '12…90'];
		assertCategories(u, expected, true);
		assertMetrics(u, plugin);
		const before = measurements.filter(({ text }) => expected.includes(text)).length;
		for (const ratio of [1, 2, 1]) {
			u.setPxRatio(ratio);
			await Promise.resolve();
			for (const size of [{ width: 480, height: 300 }, { width: 900, height: 500 }]) {
				u.setSize(size);
				await Promise.resolve();
				assertCategories(u, expected, true);
				assertMetrics(u, plugin);
				assertHorizontalLayout(u);
				assertHorizontalRects(u);
			}
		}
		assert.equal(measurements.filter(({ text }) => expected.includes(text)).length, before + expected.length * 2, 'only DPR changes invalidate category measurements');
		const cached = measurements.length;
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(measurements.length, cached, 'unchanged redraw reuses measurements');
		assert.equal(canvases.size, 2, 'one context per DPR-scaled font, reused on returning to DPR 1');
		assert.ok(measurements.every(({ ctx }) => ctx !== u.ctx));
		assert.ok(measurements.filter(({ font }) => font === '14px serif').every(({ ctx }) => ctx === shared));
		for (const [ctx, canvas] of canvases) {
			assert.deepEqual([canvas.width, canvas.height], [1, 1]);
			assert.equal(ctx.log.filter(entry => entry[0] === 'font').length, 1);
			assert.ok(ctx.log.every(entry => entry[0] !== 'save' && entry[0] !== 'restore'));
		}
		assert.equal(u.data, replacement);
		assert.deepEqual(replacement, [['uvwxyzabcd', 1234567890], [-2, 5]]);
	});

	it('reserves label bounds across rotation, resize, and DPR changes with a custom inset', async () => {
		const labels = ['A long first category', 'Middle', 'A long final category'];
		const data = [labels, [1, 2, 3]];
		const original = structuredClone(data);
		const { u, plugin, measurements } = mount(data, { inset: 12 });
		await Promise.resolve();
		for (const ratio of [1, 2]) {
			u.setPxRatio(ratio);
			await Promise.resolve();
			for (const size of [{ width: 480, height: 400 }, { width: 900, height: 500 }]) {
				u.setSize(size);
				await Promise.resolve();
				for (const rotation of [-90, -45, 0, 45, 90]) {
					plugin._setLabelRotation(rotation);
					await Promise.resolve();
					assert.equal(u.axes[0]._rotate, rotation);
					assertCategories(u, labels);
					assertLayout(u, 12);
					assertMetrics(u, plugin);
				}
			}
		}
		assert.equal(u.data, data);
		assert.deepEqual(data, original, 'rotation and layout methods do not alter data');
		const xMeasurements = measurements.filter(({ text }) => labels.includes(text));
		assert.equal(xMeasurements.length, labels.length * 2, 'resize and rotation reuse measurements; DPR invalidates them');
		assert.ok(xMeasurements.some(({ font }) => font === u.axes[0].font[0]));
	});
});
