import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';
import { barChartPlugin } from '../demos/lib/barChartPlugin.js';
import Flatbush from '../demos/lib/flatbush.js';
import { SPACE_BETWEEN, SPACE_AROUND, SPACE_EVENLY } from '../demos/lib/distr.js';

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
		const { min, max } = u.scales.x;
		assert.ok(Number.isFinite(min) && Number.isFinite(max) && max > min);
		if (labels.length == 0)
			assert.deepEqual([min, max], [-.5, .5]);
		else {
			const firstCenter = labels.length === 1 ? .5
							: Math.round(.2 / labels.length * 1e6) / 1e6 + Math.round(.6 / labels.length * 1e6) / 2e6;
			assert.ok(Math.abs(-min / (max - min) - firstCenter) < 1e-12);
			if (labels.length > 1)
				assert.ok(Math.abs((labels.length - 1 - min) / (max - min) - (1 - firstCenter)) < 1e-12);
		}
		assert.deepEqual(u.axes[0]._splits ?? [], labels.map((_, i) => i));
		assert.deepEqual(u.axes[0]._values ?? [], labels);
	}

	function assertMetrics(u, plugin) {
		const labels = u.axes[0]._values ?? [];
		const label = labels.reduce((longest, next) => width(u, next) > width(u, longest) ? next : longest, '');
		assert.deepEqual(plugin._controls.getLabelMetrics(), { label, width: width(u, label) });
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
		assert.ok(u._padding.every(pad => pad >= inset));
		for (const [i, label] of labels.entries()) {
			const near = height / 2 * sin;
			const far = width(u, label) * cos + near;
			const left = rotation === 0 ? width(u, label) / 2 : rotation > 0 ? far : near;
			const right = rotation === 0 ? width(u, label) / 2 : rotation < 0 ? far : near;
			const center = u.valToPos(i, 'x', true) / u.pxRatio;
			assert.ok(center >= left + inset - .5 / u.pxRatio, `label ${i} clears the left edge`);
			assert.ok(u.width - center >= right + inset - .5 / u.pxRatio, `label ${i} clears the right edge`);
		}
		assert.ok(u.bbox.width > 0 && u.bbox.height > 0);
	}

	describe('bar hover', () => {
		let originalFinish, originalSearch, finished, searches, searchFilters;

		beforeEach(() => {
			finished = [];
			searches = [];
			searchFilters = [];
			originalFinish = Flatbush.prototype.finish;
			originalSearch = Flatbush.prototype.search;
			Flatbush.prototype.finish = function() {
				assert.ok(!finished.includes(this), 'finish runs only once per index');
				finished.push(this);
				return originalFinish.call(this);
			};
			Flatbush.prototype.search = function(...args) {
				assert.ok(finished.includes(this), 'search never reads an unfinished index');
				assert.equal(typeof args[4], 'function', 'hover uses the search filter');
				searchFilters.push(args[4]);
				const result = originalSearch.apply(this, args);
				assert.deepEqual(result, [], 'the filter selects the bar without collecting result IDs');
				searches.push(this);
				return result;
			};
		});

		afterEach(() => {
			Flatbush.prototype.finish = originalFinish;
			Flatbush.prototype.search = originalSearch;
		});

		const overlapping = { bars: { disp: {
			x0: { unit: 1, values: u => u.data[0].map((_, i) => i - .3) },
			size: { unit: 1, values: u => u.data[0].map(() => .6) },
		} } };
		const enter = u => u.over.dispatchEvent(new MouseEvent('mouseenter'));
		const leave = u => u.over.dispatchEvent(new MouseEvent('mouseleave'));
		function hoverRect(u, seriesIdx, rectIdx) {
			const [x, y, width, height] = rects(u, seriesIdx)[rectIdx];
			const left = (x - u.bbox.left) / u.pxRatio;
			const top = (y - u.bbox.top) / u.pxRatio;
			u.setCursor({ left: left + width / u.pxRatio / 2, top: top + height / u.pxRatio / 2 });
			return { left, top, width: width / u.pxRatio, height: height / u.pxRatio };
		}

		it('finishes on capture entry before an earlier non-capturing edge-hover handler', async () => {
			let entries = 0;
			const { u } = mount([['A', 'B'], [4, 2]], { bars: { size: [1, Infinity] } }, {
				hooks: { init: [u => {
					u.over.addEventListener('mouseenter', () => {
						assert.equal(finished.length, 1);
						u.setCursor({ left: 0, top: u.valToPos(2, 'y') });
						assert.deepEqual(u.cursor.idxs, [0, 0]);
						entries++;
					});
				}] },
			});
			await Promise.resolve();
			assert.equal(finished.length, 0);
			hoverRect(u, 1, 0);
			assert.equal(searches.length, 0);
			enter(u);
			leave(u);
			enter(u);
			assert.equal(entries, 2);
			assert.equal(finished.length, 1);
		});

		for (const orientation of ['vertical', 'horizontal']) {
			for (const pxRatio of [1, 2]) {
				it(`matches ${orientation} bar bounds at DPR ${pxRatio}, preserving sparse data IDs`, async () => {
					const { u } = mount([['A', 'B', 'C', 'D'], [4, null, -6, 0]], { orientation }, { pxRatio });
					await Promise.resolve();
					enter(u);
					const emptyBox = u.cursor.points.bbox(u, 1);
					let hoverBox;
					for (const [rectIdx, dataIdx] of [[0, 0], [1, 2]]) {
						const bbox = hoverRect(u, 1, rectIdx);
						assert.deepEqual(u.cursor.idxs, [dataIdx, dataIdx]);
						const actual = u.cursor.points.bbox(u, 1);
						hoverBox ??= actual;
						assert.equal(actual, hoverBox, 'hover updates reuse the same object');
						for (const key of Object.keys(bbox))
							assert.equal(actual[key], bbox[key]);
					}
					u.setCursor({ left: 0, top: 0 });
					assert.deepEqual(u.cursor.idxs, [null, null], 'zero-sized placeholders cannot hover');
					assert.equal(u.cursor.points.bbox(u, 1), emptyBox, 'misses reuse the empty bounding box');
					assert.equal(emptyBox.width, 0);
					assert.equal(u.over.querySelector('.u-cursor-pt').style.borderRadius, 'unset');
				});
			}
		}

		it('reuses one search filter per chart across cursor updates and index rebuilds', async () => {
			const { u: a } = mount([['A', 'B'], [4, 2]]);
			const { u: b } = mount([['C', 'D'], [3, 5]]);
			await Promise.resolve();
			enter(a);
			enter(b);
			hoverRect(a, 1, 0);
			const filter = searchFilters.at(-1);
			hoverRect(a, 1, 1);
			assert.equal(searchFilters.at(-1), filter);
			a.redraw(false);
			await Promise.resolve();
			hoverRect(a, 1, 0);
			assert.equal(searchFilters.at(-1), filter);
			hoverRect(b, 1, 1);
			assert.notEqual(searchFilters.at(-1), filter, 'charts keep independent search state');
			assert.deepEqual(b.cursor.idxs, [1, 1]);
			hoverRect(a, 1, 0);
			assert.equal(searchFilters.at(-1), filter);
			assert.deepEqual(a.cursor.idxs, [0, 0]);
		});

		it('resolves series and CSS bounds only once after the search completes', async () => {
			const { u } = mount([['A', 'B'], [4, 4], [4, 4]], overlapping, { pxRatio: 2, series: [{}, {}, {}] });
			await Promise.resolve();
			enter(u);
			hoverRect(u, 2, 0);
			const box = u.cursor.points.bbox(u, 2);
			const writes = {};
			let searching = false;
			for (const key of ['seriesIdx', 'left', 'top', 'width', 'height']) {
				let value = box[key];
				writes[key] = 0;
				Object.defineProperty(box, key, {
					configurable: true,
					get: () => value,
					set(next) {
						assert.equal(searching, false, `${key} resolves after traversal`);
						writes[key]++;
						value = next;
					},
				});
			}
			const search = Flatbush.prototype.search;
			Flatbush.prototype.search = function(...args) {
				searching = true;
				try {
					return search.apply(this, args);
				}
				finally {
					searching = false;
				}
			};
			const bbox = hoverRect(u, 2, 1);
			assert.deepEqual(u.cursor.idxs, [1, null, 1]);
			for (const key of Object.keys(writes))
				assert.equal(writes[key], 1, `${key} resolves once`);
			for (const key of Object.keys(bbox))
				assert.equal(box[key], bbox[key]);
		});

		for (const orientation of ['vertical', 'horizontal']) {
			for (const pxRatio of [1, 2]) {
				for (const mode of ['grouped', 'value', 'percent']) {
					it(`distributes and hovers ${mode} bars in ${orientation} orientation at DPR ${pxRatio}`, async () => {
						const data = [['A', 'B', 'C', 'D'], [2, -4, 3, null], [6, -2, -1, 5]];
						const original = structuredClone(data);
						const { u } = mount(data, { orientation }, {
							pxRatio, series: [{}, {}, {}],
							stack: mode == 'grouped' ? undefined : { groups: [{ series: [1, 2], dir: 0 }], percent: mode == 'percent' },
						});
						await Promise.resolve();
						enter(u);
						const pos = orientation == 'horizontal' ? 1 : 0;
						const size = pos + 2;
						const first = rects(u, 1)[0];
						const second = rects(u, 2)[0];
						if (mode == 'grouped')
							assert.ok(first[pos] + first[size] <= second[pos] + 1, 'series occupy separate category slots');
						else {
							assert.equal(first[pos], second[pos]);
							assert.equal(first[size], second[size]);
							assert.deepEqual(u._base[2], mode == 'percent' ? [.25, -2 / 3, 0, 0] : [2, -4, 0, 0]);
							assert.deepEqual(u._data[2], mode == 'percent' ? [1, -1, -1, 1] : [8, -6, -1, 5]);
						}
						for (const si of [1, 2]) {
							const ids = data[si].map((_, i) => i).filter(i => data[si][i] != null);
							for (const [ri, di] of ids.entries()) {
								const rect = rects(u, si)[ri];
								const base = mode == 'grouped' ? 0 : u._base[si][di];
								const end = u._data[si][di];
								const p0 = u.valToPos(base, 'y', true), p1 = u.valToPos(end, 'y', true);
								const valuePos = 1 - pos;
								assert.ok(Math.abs(rect[valuePos] - Math.min(p0, p1)) <= 1);
								assert.ok(Math.abs(rect[valuePos] + rect[valuePos + 2] - Math.max(p0, p1)) <= 1);
								hoverRect(u, si, ri);
								assert.deepEqual(u.cursor.idxs, [di, si == 1 ? di : null, si == 2 ? di : null]);
							}
						}
						u.setLegend({ idx: 1 });
						assert.deepEqual(u.legend.values.map(value => value._), ['B', '-4', '-2']);
						u.setSeries(1, { show: false });
						await Promise.resolve();
						if (mode == 'grouped')
							assert.ok(rects(u, 2)[0][size] > second[size], 'visible groups reclaim hidden slots');
						else
							assert.deepEqual(u._base[2], [0, 0, 0, 0]);
						hoverRect(u, 2, 0);
						assert.deepEqual(u.cursor.idxs, [0, null, 0]);
						assert.equal(u.data, data);
						assert.deepEqual(data, original);
						u.setData([[], [], []]);
						await Promise.resolve();
					});
				}
			}
		}

		it('positions independent stack groups side by side, including a single category', async () => {
			const { u } = mount([['A'], [2], [3], [4]], {}, {
				series: [{}, {}, {}, {}], stack: { groups: [{ series: [1, 2], dir: 0 }] },
			});
			await Promise.resolve();
			const [a, b, c] = [1, 2, 3].map(si => rects(u, si)[0]);
			assert.equal(a[0], b[0]);
			assert.equal(a[2], b[2]);
			assert.ok(b[0] + b[2] <= c[0] + 1);
			assert.ok(a[0] >= u.bbox.left && c[0] + c[2] <= u.bbox.left + u.bbox.width + 1);
			enter(u);
			for (const si of [1, 2, 3]) {
				hoverRect(u, si, 0);
				assert.equal(u.cursor.idxs[si], 0);
			}
		});

		it('selects the last overlapping bar after tree sorting and ignores hidden series', async () => {
			const xs = Array.from({ length: 20 }, (_, i) => `Item ${i}`);
			const { u } = mount([xs, xs.map(() => 4), xs.map(() => 2)], overlapping, { series: [{}, {}, {}] });
			await Promise.resolve();
			enter(u);
			for (const idx of [0, 10, 19]) {
				hoverRect(u, 2, idx);
				assert.deepEqual(u.cursor.idxs, [idx, null, idx]);
			}
			u.setSeries(2, { show: false });
			await Promise.resolve();
			hoverRect(u, 1, 10);
			assert.deepEqual(u.cursor.idxs, [10, 10, null]);
			assert.equal(finished.length, 2);
		});

		it('resolves series offsets across hidden leading and middle series', async () => {
			const xs = Array.from({ length: 20 }, (_, i) => `Item ${i}`);
			const { u } = mount([xs, xs.map(() => 8), xs.map(() => 6), xs.map((_, i) => i == 0 ? null : 2)], {}, {
				series: [{}, {}, { show: false }, {}],
			});
			await Promise.resolve();
			enter(u);
			assert.equal(finished.at(-1).numItems, 40, 'hidden middle series has no index slots');
			for (const idx of [1, 10, 19]) {
				hoverRect(u, 3, idx - 1);
				assert.deepEqual(u.cursor.idxs, [idx, null, null, idx]);
			}
			u.setSeries(1, { show: false });
			await Promise.resolve();
			assert.equal(finished.at(-1).numItems, 20, 'series 3 now starts at offset zero');
			hoverRect(u, 3, 9);
			assert.deepEqual(u.cursor.idxs, [10, null, null, 10]);
			u.setSeries(2, { show: true });
			await Promise.resolve();
			assert.equal(finished.at(-1).numItems, 40, 'offsets update when a preceding series returns');
			hoverRect(u, 3, 9);
			assert.deepEqual(u.cursor.idxs, [10, null, null, 10]);
			hoverRect(u, 2, 0);
			assert.deepEqual(u.cursor.idxs, [0, null, 0, null]);
		});

		it('rebuilds on redraw, data, size, and DPR changes but defers finish outside the plot', async () => {
			const { u } = mount([['A', 'B'], [4, 2]]);
			await Promise.resolve();
			enter(u);
			for (const change of [
				() => u.redraw(false),
				() => u.setData([['C', 'D', 'E'], [null, -3, 5]]),
				() => u.setSize({ width: 900, height: 500 }),
				() => u.setPxRatio(2),
			]) {
				const count = finished.length;
				change();
				await Promise.resolve();
				assert.equal(finished.length, count + 1);
				hoverRect(u, 1, 0);
				assert.equal(u.cursor.idxs[1], u.data[1][0] == null ? 1 : 0);
			}
			leave(u);
			const count = finished.length;
			u.redraw(false);
			await Promise.resolve();
			assert.equal(finished.length, count);
			enter(u);
			assert.equal(finished.length, count + 1);
			hoverRect(u, 1, 1);
			assert.deepEqual(u.cursor.idxs, [2, 2]);
		});

		it('handles empty and all-skipped data and removes the entry listener on destroy', async () => {
			const { u } = mount([[], []]);
			await Promise.resolve();
			enter(u);
			assert.equal(finished.length, 0);
			u.setData([['A', 'B', 'C'], [null, 0, undefined]]);
			await Promise.resolve();
			assert.equal(finished.length, 1);
			u.setCursor({ left: 0, top: 0 });
			assert.deepEqual(u.cursor.idxs, [null, null]);
			leave(u);
			u.setData([['A'], [3]]);
			await Promise.resolve();
			const over = u.over;
			destroy(u);
			over.dispatchEvent(new MouseEvent('mouseenter'));
			assert.equal(finished.length, 1);
		});
	});

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

	for (const orientation of ['vertical', 'horizontal']) {
		for (const seriesCount of [1, 2]) {
			it(`updates distribution, width, ticks, and hover for ${seriesCount}-bar groups (${orientation})`, async () => {
				const horizontal = orientation === 'horizontal';
				const { u, plugin, measurements } = mount(Array.from({ length: seriesCount + 1 }, () => []), {
					orientation, labelRotation: horizontal ? 0 : -30,
				}, { series: Array.from({ length: seriesCount + 1 }, () => ({})), pxRatio: 2 });
				await Promise.resolve();
				u.over.dispatchEvent(new MouseEvent('mouseenter'));
				for (const count of [1, 4]) {
					const data = [Array.from({ length: count }, (_, i) => `Long category ${i}`),
						...Array.from({ length: seriesCount }, () => Array(count).fill(5))];
					u.setData(data);
					await Promise.resolve();
					const labelMeasures = () => measurements.filter(({ text }) => data[0].includes(text)).length;
					const before = labelMeasures();
					for (const mode of [SPACE_AROUND, SPACE_EVENLY, SPACE_BETWEEN]) {
						plugin._controls.setDistribution(mode);
						for (const width of [.1, .35, 1]) {
							plugin._controls.setGroupWidth(width);
							await Promise.resolve();
							assert.equal(u.data, data);
							assert.equal(labelMeasures(), before, 'spacing changes reuse label measurements');
							if (!horizontal)
								assertLayout(u);
							const gap = mode === SPACE_BETWEEN ? (count === 1 ? 0 : (1 - width) / (count - 1))
								: (1 - width) / (mode === SPACE_AROUND ? count : count + 1);
							const offset = mode === SPACE_BETWEEN ? 0 : mode === SPACE_AROUND ? gap / 2 : gap;
							const origin = horizontal ? u.bbox.top : u.bbox.left;
							const extent = horizontal ? u.bbox.height : u.bbox.width;
							for (let i = 0; i < count; i++) {
								const start = offset + i * (width / count + gap);
								assert.ok(Math.abs(u.valToPos(i, 'x', true) - origin - (start + width / count / 2) * extent) < 1);
								for (let si = 1; si <= seriesCount; si++) {
									const [x, y, w, h] = rects(u, si)[i];
									const expected = origin + (start + (si - 1) * width / count / seriesCount) * extent;
									assert.ok(Math.abs((horizontal ? y : x) - expected) <= 1);
									assert.ok(Math.abs((horizontal ? h : w) - width / count / seriesCount * extent) <= 1);
									u.setCursor({ left: (x + w / 2 - u.bbox.left) / u.pxRatio, top: (y + h / 2 - u.bbox.top) / u.pxRatio });
									assert.equal(u.cursor.idxs[si], i);
									if (seriesCount === 2)
										assert.equal(u.cursor.idxs[3 - si], null);
								}
							}
						}
					}
				}
			});
		}
	}

	it('validates distribution and width and skips unchanged or destroyed layout requests', async () => {
		for (const value of [0, 4, '2', null, NaN])
			assert.throws(() => barChartPlugin({ distribution: value }), RangeError);
		for (const value of [0, -1, 1.1, '0.5', NaN, Infinity])
			assert.throws(() => barChartPlugin({ bars: { size: [value] } }), RangeError);
		const plugin = barChartPlugin();
		plugin._controls.setDistribution(SPACE_AROUND);
		plugin._controls.setGroupWidth(.4);
		const { u } = mount([['Only'], [5]], {}, {}, plugin);
		await Promise.resolve();
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [-1, 1]);
		assert.ok(Math.abs(rects(u, 1)[0][2] - u.bbox.width * .4) <= 1);
		let requests = 0;
		u.setScale = u.redraw = () => requests++;
		plugin._controls.setDistribution(SPACE_AROUND);
		plugin._controls.setGroupWidth(.4);
		assert.throws(() => plugin._controls.setDistribution('2'), RangeError);
		assert.throws(() => plugin._controls.setGroupWidth(0), RangeError);
		assert.equal(requests, 0);
		destroy(u);
		plugin._controls.setDistribution(SPACE_EVENLY);
		plugin._controls.setGroupWidth(.8);
		assert.equal(requests, 0);
	});

	it('shares one uniform width and per-stack offsets across layout rebuilds', async () => {
		const original = uPlot.paths.bars;
		let disp, u;
		uPlot.paths.bars = options => {
			disp = options.disp;
			return original(options);
		};
		try {
			({ u } = mount([['A', 'B', 'C'], [2, 3, 4], [5, 6, 7], [1, 2, 3]], {}, {
				series: [{}, {}, {}, {}], stack: { groups: [{ series: [1, 3], dir: 0 }] },
			}));
		}
		finally {
			uPlot.paths.bars = original;
		}
		await Promise.resolve();
		const width = disp.size.values(u, 1);
		assert.equal(width.length, 1, 'uniform sizing needs only size[0]');
		assert.equal(width[0], .1);
		assert.equal(disp.size.values(u, 2), width);
		assert.equal(disp.size.values(u, 3), width);
		assert.equal(disp.x0.values(u, 1), disp.x0.values(u, 3), 'non-adjacent stack members share offsets');
		assert.notEqual(disp.x0.values(u, 1), disp.x0.values(u, 2));
		u.setSeries(2, { show: false });
		await Promise.resolve();
		assert.equal(disp.size.values(u, 1), width, 'redraws reuse the width array');
		assert.equal(width[0], .2);
		assert.equal(disp.x0.values(u, 1), disp.x0.values(u, 3));
		u.setData([[], [], [], []]);
		await Promise.resolve();
		assert.equal(width[0], 0);
	});

	for (const orientation of ['vertical', 'horizontal']) {
		for (const groupWidth of [.6, 1]) {
			for (const seriesCount of [1, 2]) {
				it(`aligns distributed groups and ticks inside the plot (${orientation}, width ${groupWidth}, ${seriesCount} series)`, async () => {
					const horizontal = orientation === 'horizontal';
					const { u, plugin } = mount(Array.from({ length: seriesCount + 1 }, () => []), {
						orientation, distribution: SPACE_BETWEEN, bars: { size: [groupWidth] },
					}, { series: Array.from({ length: seriesCount + 1 }, () => ({})) });
					await Promise.resolve();
					assert.deepEqual([u.scales.x.min, u.scales.x.max], [-.5, .5]);
					for (const count of [1, 2, 7]) {
						u.setData([
							Array.from({ length: count }, (_, i) => `Long category label ${i}`),
							...Array.from({ length: seriesCount }, () => Array(count).fill(5)),
						]);
						await Promise.resolve();
						if (count === 1 && groupWidth === 1)
							assert.deepEqual([u.scales.x.min, u.scales.x.max], [-1, 1]);
						for (const pxRatio of [1, 2]) {
							u.setPxRatio(pxRatio);
							u.setSize({ width: pxRatio === 1 ? 480 : 900, height: 500 });
							if (!horizontal)
								plugin._controls.setLabelRotation(pxRatio === 1 ? -30 : 30);
							await Promise.resolve();
							if (!horizontal)
								assertLayout(u);
							const origin = horizontal ? u.bbox.top : u.bbox.left;
							const extent = horizontal ? u.bbox.height : u.bbox.width;
							const pos = horizontal ? 1 : 0;
							const size = horizontal ? 3 : 2;
							const groups = Array.from({ length: seriesCount }, (_, i) => rects(u, i + 1));
							for (let i = 0; i < count; i++) {
								const start = groups[0][i][pos];
								const last = groups.at(-1)[i];
								const end = last[pos] + last[size];
								const off = count === 1 ? 0 : i * (groupWidth / count + (1 - groupWidth) / (count - 1));
								assert.ok(Math.abs(start - (origin + off * extent)) <= 1);
								assert.ok(Math.abs(end - start - groupWidth / count * extent) <= 2);
								assert.ok(Math.abs((start + end) / 2 - u.valToPos(i, 'x', true)) <= 1);
								if (i === 0)
									assert.ok(Math.abs(start - origin) <= 1, 'first group reaches the plot edge');
								if (i === count - 1 && (count > 1 || groupWidth === 1))
									assert.ok(Math.abs(end - origin - extent) <= 1, 'last group reaches the plot edge');
							}
						}
					}
				});
			}
		}
	}

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
		plugin._controls.setLabelTruncation(3);
		await Promise.resolve();
		assert.deepEqual(u.axes[0]._values, ['Fi…', 'Se…']);

		assert.deepEqual(u.data[0], labels);
		plugin._controls.setLabelTruncation(null);
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

	it('exposes only _controls at factory time, applies pre-mount settings, and stops redrawing after destroy', async () => {
		const options = Object.freeze({ labelRotation: 15, maxLabelLength: 4, ellipsis: 'end' });
		const plugin = barChartPlugin(options);
		const controls = plugin._controls;
		const methods = ['setDistribution', 'setGroupWidth', 'setLabelRotation', 'setLabelTruncation', 'getLabelMetrics'];
		assert.deepEqual(Object.keys(plugin).sort(), ['_controls', 'hooks', 'opts']);
		assert.deepEqual(Object.keys(controls).sort(), methods.slice().sort());
		for (const method of methods)
			assert.equal(typeof controls[method], 'function');
		assert.equal(typeof plugin.opts, 'function');
		assert.equal(typeof plugin.hooks, 'object');
		assert.deepEqual(plugin._controls.getLabelMetrics(), { label: '', width: 0 });
		plugin._controls.setLabelRotation(-45);
		plugin._controls.setLabelTruncation(5, 'middle');
		const { u } = mount([['abcdefghij', 'xy'], [1, 2]], {}, {}, plugin);
		await Promise.resolve();
		assert.equal(u.axes[0]._rotate, -45);
		assert.deepEqual(u.axes[0]._values, ['ab…ij', 'xy']);
		assertMetrics(u, plugin);
		const redraw = u.redraw;
		let redraws = 0;
		u.redraw = (...args) => { redraws++; return redraw(...args); };
		plugin._controls.setLabelRotation(45);
		await Promise.resolve();
		assert.ok(redraws > 0);
		assert.equal(u.axes[0]._rotate, 45);
		destroy(u);
		const before = redraws;
		plugin._controls.setLabelRotation(0);
		plugin._controls.setLabelTruncation(null);
		await Promise.resolve();
		assert.equal(plugin._controls, controls, 'the controls object survives init and destroy');
		assert.deepEqual(controls.getLabelMetrics(), { label: '', width: 0 });
		assert.equal(redraws, before, 'controls must not redraw a destroyed chart');
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
		plugin._controls.setLabelRotation(0);
		plugin._controls.setLabelTruncation(null);
		plugin._controls.setLabelTruncation(100, 'end');
		plugin._controls.setLabelTruncation(100, 'middle');
		await Promise.resolve();
		assert.equal(redraws, 0, 'unchanged effective labels and rotation need no redraw');
		for (const [limit, ellipsis, expected] of [
			[5, 'end', ['abcd…', 'xy']],
			[5, 'middle', ['ab…ij', 'xy']],
			[1, 'middle', ['…', '…']],
			[null, undefined, data[0]],
		]) {
			const before = redraws;
			plugin._controls.setLabelTruncation(limit, ellipsis);
			await Promise.resolve();
			assert.ok(redraws > before);
			assert.deepEqual(u.axes[0]._values, expected);
			assert.deepEqual(fullLabels(u), data[0]);
			assertMetrics(u, plugin);
			const after = redraws;
			plugin._controls.setLabelTruncation(limit, ellipsis);
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
			assert.throws(() => plugin._controls.setLabelRotation(degrees));
		for (const limit of [0, -1, 1.5, NaN, Infinity, '4'])
			assert.throws(() => plugin._controls.setLabelTruncation(limit));
		assert.throws(() => plugin._controls.setLabelTruncation(4, 'start'));
		await Promise.resolve();
		assert.equal(redraws, 0, 'invalid method input must not redraw');
		assert.equal(u.axes[0]._rotate, 15);
		assert.deepEqual(u.axes[0]._values, ['Alp…', 'Beta']);
	});

	it('keeps chart instances, plugin methods, and measurement caches independent', async () => {
		const a = mount([['Shared label', 'A'], [1, 2]]);
		const b = mount([['Shared label', 'B'], [3, 4]], {}, { axes: [{ font: '20px serif' }, {}] });
		assert.notEqual(a.plugin, b.plugin);
		assert.notEqual(a.plugin._controls, b.plugin._controls);
		assert.notEqual(a.plugin._controls.setLabelRotation, b.plugin._controls.setLabelRotation);
		assert.notEqual(a.plugin._controls.setLabelTruncation, b.plugin._controls.setLabelTruncation);
		assert.notEqual(a.plugin._controls.getLabelMetrics, b.plugin._controls.getLabelMetrics);
		await Promise.resolve();
		assertMetrics(a.u, a.plugin);
		assertMetrics(b.u, b.plugin);
		assert.notEqual(a.plugin._controls.getLabelMetrics().width, b.plugin._controls.getLabelMetrics().width);
		const before = b.measurements.length;
		const metrics = { ...b.plugin._controls.getLabelMetrics() };
		a.plugin._controls.setLabelTruncation(4);
		a.plugin._controls.setLabelRotation(90);
		a.u.setData([['Changed', 'Labels', 'Here'], [1, 2, 3]]);
		await Promise.resolve();
		b.u.redraw(false, true);
		await Promise.resolve();
		assert.deepEqual(b.u.axes[0]._values, ['Shared label', 'B']);
		assert.equal(b.u.axes[0]._rotate, 0);
		assert.deepEqual(b.plugin._controls.getLabelMetrics(), metrics);
		assert.equal(b.measurements.length, before);
		destroy(a.u);
		b.plugin._controls.setLabelRotation(-90);
		b.plugin._controls.setLabelTruncation(6, 'middle');
		await Promise.resolve();
		assert.equal(b.u.axes[0]._rotate, -90);
		assert.deepEqual(b.u.axes[0]._values, ['Sha…el', 'B']);
		assertMetrics(b.u, b.plugin);
	});

	it('handles empty and single-category datasets through ordinary setData', async () => {
		const { u, plugin } = mount([[], []]);
		await Promise.resolve();
		assertCategories(u, []);
		assert.deepEqual(plugin._controls.getLabelMetrics(), { label: '', width: 0 });
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
		assert.ok(u._padding.every(pad => pad >= inset));
		const axis = u.axes[1];
		for (const [i, label] of axis._values.entries()) {
			const center = u.valToPos(axis._splits[i], 'y', true) / u.pxRatio;
			const half = width(u, label, 1) / 2;
			assert.ok(center - half >= inset - 1 / u.pxRatio);
			assert.ok(center + half <= u.width - inset + 1 / u.pxRatio);
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
		assert.throws(() => plugin._controls.setLabelRotation(15), RangeError);
		plugin._controls.setLabelRotation(0);
		const { u } = mount([['Alpha', 'Beta'], [1, 2]], {}, {}, plugin);
		await Promise.resolve();
		let redraws = 0;
		u.redraw = () => { redraws++; };
		for (const degrees of [-45, 45])
			assert.throws(() => plugin._controls.setLabelRotation(degrees), RangeError);
		plugin._controls.setLabelRotation(0);
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
		assert.deepEqual(axis._found, [expected.incr, dim / expected.count], 'tick spacing uses the category-sized plot width');
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
					assert.equal(formatted[0], u.scales.y._rangeY, 'formatting does not replace the range');
					assert.deepEqual(u.axes[1]._values, baseline.splits.map(value => `${value}${suffix}`));
					assert.deepEqual(u.axes.map(axis => axis._size), sizes);
					if (suffix) {
						assert.ok(u._padding[1] > padding[1] && u._padding[3] > padding[3]);
						assert.ok(u.bbox.width < plotWidth);
					}
					else {
						assert.deepEqual(u._padding, padding);
						assert.equal(u.bbox.width, plotWidth);
					}
					assertHorizontalLayout(u);
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
			plugin._controls.setLabelTruncation(limit, position);
			await Promise.resolve();
			assertCategories(u, expected, true);
			assertMetrics(u, plugin);
			assertHorizontalLayout(u);
			assertHorizontalRects(u);
			assert.deepEqual(u.axes[1]._values, values(u, u.axes[1]._splits));
		}
		assert.equal(u.data, data);
		assert.deepEqual(data, original);
		plugin._controls.setLabelTruncation(5, 'middle');
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

	it('keeps rotated labels within chart edges across resize and DPR changes', async () => {
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
					plugin._controls.setLabelRotation(rotation);
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
