import assert from 'node:assert/strict';
import { createBarValues } from '../demos/lib/barValues.js';

// Run independently: node --expose-gc node_modules/mocha/bin/mocha.js test/bar-values.mjs
const stateKeys = ['font', 'fillStyle', 'textAlign', 'textBaseline', 'globalAlpha'];
const snapshot = ctx => Object.fromEntries(stateKeys.map(key => [key, ctx[key]]));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

function linearMetrics(text, size) {
	return { width: String(text).length * size / 2, actualBoundingBoxAscent: size * .7, actualBoundingBoxDescent: size * .2 };
}

function context(textMetrics = linearMetrics) {
	const stack = [];
	const state = { font: '17px serif', fillStyle: 'purple', textAlign: 'right', textBaseline: 'bottom', globalAlpha: .35 };
	const ctx = {
		labels: [], writes: [], saves: 0, restores: 0,
		save() {
			this.saves++;
			stack.push(snapshot(this));
		},
		restore() {
			assert.ok(stack.length > 0, 'restore must have a matching save');
			this.restores++;
			// Native restore does not invoke property setters.
			Object.assign(state, stack.pop());
		},
		measureText() {
			assert.fail('measure on the offscreen context, not the chart context');
		},
		fillText(text, x, y) {
			const size = parseFloat(this.font);
			const { width, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = textMetrics(text, size);
			this.labels.push({
				text: String(text), x, y, size, ...snapshot(this),
				left: x - width / 2, right: x + width / 2,
				top: y - ascent, bottom: y + descent,
			});
		},
	};
	for (const key of stateKeys) {
		Object.defineProperty(ctx, key, {
			get() { return state[key]; },
			set(value) {
				ctx.writes.push({ key, previous: state[key], value, labels: ctx.labels.length });
				state[key] = value;
			},
		});
	}
	return ctx;
}

function plot(data = [[0], [12]], options = {}) {
	return {
		ctx: context(), data, _data: data.map(row => row.slice()), _base: [],
		bbox: { left: 20, top: 30, width: 1000, height: 800 }, pxRatio: 1,
		series: data.map(() => ({ scale: 'y', show: true, alpha: 1 })),
		scales: { y: { dir: 1 } },
		...options,
	};
}

function render(values, u, bars, enabled = true) {
	u.ctx.labels.length = 0;
	u.ctx.writes.length = 0;
	values.reset(u, enabled);
	for (const bar of bars)
		values.each(u, ...bar);
	values.draw(u);
	return u.ctx.labels;
}

function centered(label, bar) {
	const [, , left, top, width, height] = bar;
	close(label.x, left + width / 2, 'horizontal segment center');
	close((label.top + label.bottom) / 2, top + height / 2, 'ink centered vertically, not its baseline');
}

function outside(label, bar, horizontal, direction) {
	const [, , left, top, width, height] = bar;
	if (horizontal) {
		close((label.top + label.bottom) / 2, top + height / 2, 'outside label vertical center');
		assert.ok(direction < 0 ? label.right < left : label.left > left + width, 'outside the value endpoint');
	}
	else {
		close(label.x, left + width / 2, 'outside label horizontal center');
		assert.ok(direction < 0 ? label.bottom < top : label.top > top + height, 'outside the value endpoint');
	}
}

function contained(label, u) {
	assert.ok(label.left >= u.bbox.left && label.right <= u.bbox.left + u.bbox.width, 'ink stays within bbox horizontally');
	assert.ok(label.top >= u.bbox.top && label.bottom <= u.bbox.top + u.bbox.height, 'ink stays within bbox vertically');
	assert.ok(label.size / u.pxRatio >= 10 && label.size / u.pxRatio <= 25, 'font stays within 10–25 CSS px');
}

// Rectangles represent final native bar geometry, not raw values added by the helper.
function stackBar(u, si, di, horizontal, category, factor = 8, baseline = u._base[si][di]) {
	const direction = u.scales[u.series[si].scale].dir * (horizontal ? 1 : -1);
	const start = 450 + direction * baseline * factor;
	const end = 450 + direction * u._data[si][di] * factor;
	return horizontal
		? [si, di, Math.min(start, end), category, Math.abs(end - start), 80]
		: [si, di, category, Math.min(start, end), 80, Math.abs(end - start)];
}

describe('barValues standalone', () => {
	let originalOffscreen, measurements, allocations, helpers, textMetrics, colorContexts, samples;

	// Fixed browser pixel samples, not a second implementation of the contrast calculation.
	const colorPixels = new Map([
		['royalblue', [65, 105, 225, 255]], ['#4169e1', [65, 105, 225, 255]], ['rgb(65, 105, 225)', [65, 105, 225, 255]],
		['darkorange', [255, 140, 0, 255]], ['#ff8c00', [255, 140, 0, 255]], ['rgb(255, 140, 0)', [255, 140, 0, 255]],
		['black', [0, 0, 0, 255]], ['white', [255, 255, 255, 255]],
		['#757575', [117, 117, 117, 255]], ['#767676', [118, 118, 118, 255]],
		['transparent', [0, 0, 0, 0]], ['rgba(0, 0, 0, 0.5)', [0, 0, 0, 128]],
		['rgba(0, 0, 0, 0.8)', [0, 0, 0, 204]], ['#00000000', [0, 0, 0, 0]],
		['#00000080', [0, 0, 0, 128]], ['#000000cc', [0, 0, 0, 204]],
	]);

	function colorContext() {
		let fillStyle = 'black';
		let phase = 'new';
		const calls = [];
		const ctx = {
			calls,
			get fillStyle() { return fillStyle; },
			set fillStyle(value) {
				assert.ok(colorPixels.has(value), `missing color fixture or non-string fill: ${String(value)}`);
				calls.push(['fillStyle', value]);
				fillStyle = value;
			},
			clearRect(...rect) {
				assert.deepEqual(rect, [0, 0, 1, 1]);
				calls.push(['clearRect']);
				phase = 'cleared';
			},
			fillRect(...rect) {
				assert.deepEqual(rect, [0, 0, 1, 1]);
				assert.equal(phase, 'cleared', 'clear the previous pixel before sampling a translucent fill');
				calls.push(['fillRect']);
				phase = 'filled';
			},
			getImageData(...rect) {
				assert.deepEqual(rect, [0, 0, 1, 1]);
				assert.equal(phase, 'filled', 'paint the resolved fill before reading its pixel');
				const data = new Uint8ClampedArray(colorPixels.get(fillStyle));
				calls.push(['getImageData']);
				samples.push({ fillStyle, data: Array.from(data) });
				phase = 'sampled';
				return { data };
			},
		};
		colorContexts.push(ctx);
		return ctx;
	}

	beforeEach(() => {
		originalOffscreen = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
		measurements = [];
		allocations = 0;
		helpers = [];
		textMetrics = linearMetrics;
		colorContexts = [];
		samples = [];
		Object.defineProperty(globalThis, 'OffscreenCanvas', {
			configurable: true, writable: true,
			value: class {
				constructor(width, height) {
					assert.deepEqual([width, height], [1, 1]);
					allocations++;
				}
				getContext(type, options) {
					assert.equal(type, '2d');
					if (options?.willReadFrequently) {
						assert.deepEqual(options, { willReadFrequently: true });
						return colorContext();
					}
					return {
						font: '10px sans-serif', textBaseline: 'alphabetic',
						measureText(text) {
							const size = parseFloat(this.font);
							measurements.push({ text: String(text), size });
							return textMetrics(text, size);
						},
					};
				}
			},
		});
	});

	afterEach(() => {
		try {
			for (const values of helpers)
				values.destroy();
		}
		finally {
			if (originalOffscreen)
				Object.defineProperty(globalThis, 'OffscreenCanvas', originalOffscreen);
			else
				delete globalThis.OffscreenCanvas;
		}
	});

	function helper(horizontal = false, groups = [], percent = false) {
		const values = createBarValues(horizontal);
		values.configure(groups, percent);
		helpers.push(values);
		return values;
	}

	describe('contrast-aware drawing', () => {
		function batches(ctx) {
			const colors = [...new Set(ctx.labels.map(label => label.fillStyle))];
			assert.deepEqual(colors, ['black', 'white'].filter(color => colors.includes(color)));
			assert.deepEqual(ctx.labels.map(label => label.fillStyle), colors.flatMap(color => ctx.labels.filter(label => label.fillStyle == color).map(() => color)), 'finish the black batch before drawing white');
			const fills = ctx.writes.filter(write => write.key == 'fillStyle');
			assert.ok(fills.length <= colors.length, 'at most one fillStyle write per nonempty batch, excluding restore');
			assert.deepEqual(fills.map(write => write.value), colors, 'no writes for empty color batches');
			for (const write of ctx.writes.filter(write => write.key == 'font' || write.key == 'globalAlpha'))
				assert.notEqual(write.value, write.previous, `${write.key} changes only when needed`);
		}

		for (const horizontal of [false, true]) {
			for (const percent of [false, true]) {
				for (const [dark, light] of [['royalblue', 'darkorange'], ['#4169e1', '#ff8c00'], ['rgb(65, 105, 225)', 'rgb(255, 140, 0)']]) {
					it(`contrasts stacks without changing geometry (horizontal: ${horizontal}, percent: ${percent}, fill: ${dark})`, () => {
						const values = helper(horizontal, [{ series: [1, 2, 4] }], percent);
						const u = plot([[0], [12], [8], [7], [99]], {
							_data: [[0], [percent ? .6 : 12], [percent ? 1 : 20], [7], [99]],
							_base: [null, [0], [percent ? .6 : 12]],
						});
						u.series[4].show = false;
						const bars = [stackBar(u, 1, 0, horizontal, 250, percent ? 300 : 12), stackBar(u, 2, 0, horizontal, 250, percent ? 300 : 12), [3, 0, 650, 600, 100, 100]];
						const geometry = labels => Object.fromEntries(labels.map(({ text, x, y, size, left, right, top, bottom }) => [text, { x, y, size, left, right, top, bottom }]));
						const before = snapshot(u.ctx);
						const original = geometry(render(values, u, bars));
						assert.equal(colorContexts.length, 0, 'undefined default fills do not allocate a sampling canvas');
						u.series[1]._fill = dark;
						u.series[2]._fill = light;
						for (const series of u.series)
							series.fill = () => assert.fail('do not re-evaluate fill callbacks');
						for (const si of [3, 4])
							Object.defineProperty(u.series[si], '_fill', { get() { assert.fail('do not inspect grouped or hidden fills'); } });
						const labels = render(values, u, bars);
						assert.deepEqual(geometry(labels), original, 'fitting and positions are unchanged by batching');
						const segment = labels.find(label => label.text == (percent ? '60%' : '12'));
						assert.equal(segment.fillStyle, 'white');
						centered(segment, bars[0]);
						assert.equal(labels.find(label => label.text == (percent ? '40%' : '8')).fillStyle, 'black');
						assert.equal(labels.find(label => label.text == '7').fillStyle, 'black', 'grouped labels remain black');
						if (!percent) {
							const total = labels.find(label => label.text == '20');
							assert.equal(total.fillStyle, 'black');
							outside(total, bars[1], horizontal, horizontal ? 1 : -1);
						}
						labels.forEach(label => contained(label, u));
						assert.deepEqual(samples.map(sample => sample.fillStyle).sort(), [dark, light].sort());
						assert.equal(colorContexts.length, 1);
						assert.equal(allocations, 2, 'one measurement canvas and one lazy color canvas');
						batches(u.ctx);
						assert.deepEqual(snapshot(u.ctx), before);
						assert.equal(u.ctx.saves, u.ctx.restores);
					});
				}
			}
		}

		for (const horizontal of [false, true]) {
			it(`keeps totals over dark segments black and reuses matching chart state (horizontal: ${horizontal})`, () => {
				const values = helper(horizontal, [{ series: [1] }]);
				const u = plot();
				u.series[1]._fill = 'royalblue';
				u.ctx.font = '25px Arial';
				u.ctx.globalAlpha = 1;
				const before = snapshot(u.ctx);
				const bar = [1, 0, 200, 250, 100, 100];
				const labels = render(values, u, [bar]);
				assert.deepEqual(labels.map(label => [label.text, label.fillStyle]), [['12', 'black'], ['12', 'white']]);
				outside(labels[0], bar, horizontal, horizontal ? 1 : -1);
				centered(labels[1], bar);
				batches(u.ctx);
				assert.deepEqual(u.ctx.writes.filter(write => write.key == 'font' || write.key == 'globalAlpha'), [], 'matching state needs no setter calls, even across color batches');
				assert.equal(samples.length, 1, 'the total does not resample its series');
				assert.deepEqual(snapshot(u.ctx), before);
				assert.equal(u.ctx.saves, u.ctx.restores);
			});
		}

		it('uses resolved path fills ahead of series fills, including nullish fallback', () => {
			const values = helper(false, [{ series: [1, 2, 3, 4] }], true);
			const u = plot([[0], [1], [2], [3], [4]], { _data: [[0], [.1], [.3], [.6], [1]], _base: [null, [0], [.1], [.3], [.6]] });
			const fills = [null, 'darkorange', 'royalblue', 'royalblue', 'darkorange'];
			const overrides = [null, 'royalblue', 'darkorange', null, undefined];
			for (let si = 1; si <= 4; si++) {
				u.series[si]._fill = fills[si];
				u.series[si]._paths = { _fill: overrides[si] };
				u.series[si].fill = () => assert.fail('the callback has already been resolved');
			}
			const bars = [1, 2, 3, 4].map(si => [si, 0, 150 * si, 250, 100, 100]);
			const labels = render(values, u, bars);
			assert.deepEqual(Object.fromEntries(labels.map(label => [label.text, label.fillStyle])), { '10%': 'white', '20%': 'black', '30%': 'white', '40%': 'black' });
			assert.deepEqual(samples.map(sample => sample.fillStyle).sort(), ['darkorange', 'darkorange', 'royalblue', 'royalblue'], 'sample once per series, even with shared fill strings');
			batches(u.ctx);
		});

		it('reclassifies only changed resolved fills or alpha, without resetting or remeasuring', () => {
			const values = helper(false, [{ series: [1] }], true);
			const u = plot([[0], [25]], { _data: [[0], [.25]], _base: [null, [0]] });
			u.series[1].fill = () => assert.fail('do not resolve fill callbacks again');
			values.reset(u, true);
			values.each(u, 1, 0, 200, 250, 100, 100);
			assert.equal(colorContexts.length, 0, 'classification belongs to draw, not reset or each');
			const measured = measurements.slice();
			const before = snapshot(u.ctx);
			const frames = [
				['royalblue', undefined, 1, 'white', 'royalblue', 1],
				['royalblue', undefined, 1, 'white', 'royalblue', 0],
				['darkorange', undefined, 1, 'black', 'darkorange', 1],
				['darkorange', 'royalblue', 1, 'white', 'royalblue', 1],
				['royalblue', 'royalblue', 1, 'white', 'royalblue', 0],
				['royalblue', undefined, 1, 'white', 'royalblue', 0],
				['darkorange', 'royalblue', .2, 'black', 'royalblue', 1],
				['darkorange', 'royalblue', .2, 'black', 'royalblue', 0],
				['darkorange', 'royalblue', 1, 'white', 'royalblue', 1],
				['darkorange', null, 1, 'black', 'darkorange', 1],
			];
			for (const [fill, pathFill, alpha, expected, sampled, sampleCount] of frames) {
				Object.assign(u.series[1], { _fill: fill, _paths: { _fill: pathFill }, alpha });
				u.ctx.labels.length = u.ctx.writes.length = 0;
				const count = samples.length;
				values.draw(u);
				assert.equal(u.ctx.labels.length, 1);
				assert.equal(u.ctx.labels[0].fillStyle, expected);
				assert.equal(u.ctx.labels[0].globalAlpha, alpha);
				assert.equal(samples.length, count + sampleCount);
				assert.equal(samples.at(-1).fillStyle, sampled);
				assert.deepEqual(snapshot(u.ctx), before);
				batches(u.ctx);
			}
			assert.deepEqual(measurements, measured);
			assert.equal(colorContexts.length, 1, 'reuse the sampling context across draws');
			assert.equal(u.ctx.saves, u.ctx.restores);
		});

		it('retains contrast choices across data, size, DPR, visibility, and enabled-state changes', () => {
			const values = helper(false, [{ series: [1, 2] }], true);
			const u = plot([[0], [12], [8]], { _data: [[0], [.6], [1]], _base: [null, [0], [.6]] });
			u.series[1]._fill = 'royalblue';
			u.series[2]._fill = 'darkorange';
			const bars = [[1, 0, 200, 350, 100, 100], [2, 0, 200, 250, 100, 100]];
			const draw = () => render(values, u, bars.filter(([si]) => u.series[si].show));
			assert.deepEqual(draw().map(label => label.fillStyle), ['black', 'white']);
			assert.equal(samples.length, 2);
			const calls = colorContexts[0].calls.slice();
			for (const change of [
				() => {},
				() => { u.bbox.width = 1200; u.bbox.height = 900; },
				() => {
					values.invalidate();
					u.data = [[0], [20], [30]];
					u._data = [[0], [.4], [1]];
					u._base = [null, [0], [.4]];
				},
				() => { u.pxRatio = 2; },
				() => { u.series[1].show = false; },
				() => { u.series[1].show = true; },
				() => { assert.deepEqual(render(values, u, bars, false), []); },
			]) {
				change();
				assert.deepEqual(draw().map(label => label.fillStyle), u.series[1].show ? ['black', 'white'] : ['black']);
				assert.deepEqual(colorContexts[0].calls, calls, 'reuse performs no sampling-context mutations or reads');
				batches(u.ctx);
			}
			u.series[1]._fill = null;
			assert.deepEqual(draw().map(label => label.fillStyle), ['black', 'black'], 'an absent fill replaces the cached white choice');
			assert.equal(samples.length, 2);
			u.series[1].show = false;
			u.series[1]._fill = 'royalblue';
			draw();
			assert.equal(samples.length, 2, 'hidden style changes wait until the series is shown');
			u.series[1].show = true;
			assert.deepEqual(draw().map(label => label.fillStyle), ['black', 'white']);
			assert.equal(samples.length, 3, 'only the changed series needs another sample');
		});

		it('composites CSS pixel alpha times series alpha over white and uses the sRGB contrast crossover', () => {
			const values = helper(false, [{ series: [1] }], true);
			const u = plot([[0], [25]], { _data: [[0], [.25]], _base: [null, [0]] });
			const bars = [[1, 0, 200, 250, 100, 100]];
			const cases = [
				['black', 1, 'white'], ['white', 1, 'black'],
				// Adjacent grays straddle sqrt(.0525) - .05 in linear sRGB luminance.
				['#757575', 1, 'white'], ['#767676', 1, 'black'],
				['rgba(0, 0, 0, 0.8)', 1, 'white'], ['rgba(0, 0, 0, 0.8)', .5, 'black'],
				['rgba(0, 0, 0, 0.5)', 1, 'black'], ['transparent', 1, 'black'],
				['#000000cc', 1, 'white'], ['#000000cc', .5, 'black'],
				['#00000080', 1, 'black'], ['#00000000', 1, 'black'],
				['royalblue', 0, 'black'], ['black', .5, 'black'],
			];
			for (const [fill, alpha, expected] of cases) {
				Object.assign(u.series[1], { _fill: fill, alpha });
				const labels = render(values, u, bars);
				assert.equal(labels.length, 1);
				assert.equal(labels[0].fillStyle, expected, `${fill} at series alpha ${alpha}`);
				assert.equal(labels[0].globalAlpha, alpha);
			}
			assert.equal(samples.length, cases.length);
			assert.deepEqual(samples.map(sample => sample.data), cases.map(([fill]) => colorPixels.get(fill)));
			assert.equal(colorContexts.length, 1);
			for (const name of ['clearRect', 'fillRect', 'getImageData'])
				assert.equal(colorContexts[0].calls.filter(call => call[0] == name).length, cases.length);
		});

		it('does no contrast work for grouped, disabled, or empty drawing', () => {
			const groups = [{ series: [1] }];
			const values = helper(false, groups);
			const u = plot();
			const bars = [[1, 0, 200, 250, 100, 100]];
			Object.defineProperty(u.series[1], '_fill', { get() { assert.fail('no fill reads without enabled stacked rectangles'); } });
			Object.defineProperty(u.series[1], '_paths', { get() { assert.fail('no path reads without enabled stacked rectangles'); } });
			assert.deepEqual(render(values, u, bars, false), []);
			values.invalidate();
			assert.deepEqual(render(values, u, bars, false), []);
			assert.deepEqual(render(values, u, []), []);
			assert.equal(allocations, 0);
			assert.equal(u.ctx.writes.length, 0);
			values.configure([], false);
			const labels = render(values, u, bars);
			assert.deepEqual(labels.map(label => label.fillStyle), ['black']);
			outside(labels[0], bars[0], false, -1);
			assert.equal(allocations, 1, 'only text measurement needs a canvas');
			assert.deepEqual(samples, []);
			assert.deepEqual(colorContexts, []);
		});

		it('falls back to black for absent and non-string resolved fills without sampling or coercion', () => {
			const values = helper(false, [{ series: [1] }], true);
			const u = plot([[0], [25]], { _data: [[0], [.25]], _base: [null, [0]] });
			const unknown = { [Symbol.toPrimitive]() { assert.fail('do not coerce unknown fills'); } };
			const gradient = { addColorStop() {}, [Symbol.toPrimitive]() { assert.fail('do not stringify gradients'); } };
			const callback = () => assert.fail('do not invoke unresolved fills');
			const fills = [undefined, null, unknown, gradient, callback];
			for (const fill of fills) {
				for (const pathOverride of [false, true]) {
					Object.assign(u.series[1], pathOverride && fill != null
						? { _fill: 'royalblue', _paths: { _fill: fill } }
						: { _fill: fill, _paths: { _fill: null } });
					assert.deepEqual(render(values, u, [[1, 0, 200, 250, 100, 100]]).map(label => label.fillStyle), ['black']);
				}
			}
			assert.equal(allocations, 1);
			assert.deepEqual(samples, []);
			assert.deepEqual(colorContexts, []);
		});

		it('samples each shown stacked series once across redraws with hundreds of labels', () => {
			const length = 300;
			const values = helper(false, [{ series: [1, 2, 3, 4] }], true);
			const u = plot([Array.from({ length }, (_, i) => i), Array(length).fill(12), Array(length).fill(8), Array(length).fill(null), Array(length).fill(99)]);
			u._data = [u.data[0], Array(length).fill(.6), Array(length).fill(1), Array(length).fill(null), Array(length).fill(99)];
			u._base = [null, Array(length).fill(0), Array(length).fill(.6)];
			u.series[1]._fill = 'royalblue';
			u.series[2]._fill = 'darkorange';
			u.series[3]._fill = '#4169e1';
			u.series[4].show = false;
			Object.defineProperty(u.series[4], '_fill', { get() { assert.fail('skip hidden series'); } });
			// Alternating callback order must not turn into per-label color changes or samples.
			const bars = u.data[0].flatMap(di => [[1, di, 200, 250, 100, 100], [2, di, 200, 150, 100, 100]]);
			const before = snapshot(u.ctx);
			for (let pass = 0; pass < 2; pass++) {
				const labels = render(values, u, bars);
				assert.equal(labels.length, length * 2);
				assert.equal(labels.filter(label => label.fillStyle == 'white').length, length);
				assert.equal(labels.filter(label => label.fillStyle == 'black').length, length);
				assert.equal(samples.length, 3, 'unchanged series reuse their cached contrast choice');
				assert.deepEqual(samples.map(sample => sample.fillStyle).sort(), ['#4169e1', 'darkorange', 'royalblue']);
				batches(u.ctx);
				assert.equal(u.ctx.writes.filter(write => write.key == 'font').length, 1);
				assert.equal(u.ctx.writes.filter(write => write.key == 'globalAlpha').length, 1);
				assert.deepEqual(snapshot(u.ctx), before);
			}
			assert.equal(colorContexts.length, 1);
			assert.equal(measurements.length, 2);
			assert.equal(u.ctx.saves, u.ctx.restores);
		});

		it('does not write a color batch when all its labels fail fitting or clipping', () => {
			const values = helper(false, [{ series: [1, 2] }], true);
			const u = plot([[0], [25], [75]], { _data: [[0], [.25], [1]], _base: [null, [0], [.25]] });
			u.series[1]._fill = 'darkorange';
			u.series[2]._fill = 'royalblue';
			const bars = [[1, 0, 200, 250, 100, 100], [2, 0, 450, 250, 1, 100]];
			for (const rect of [[450, 250, 1, 100], [450, 250, 100, 1], [-100, 250, 100, 100]]) {
				bars[1] = [2, 0, ...rect];
				assert.deepEqual(render(values, u, bars).map(label => label.fillStyle), ['black']);
				batches(u.ctx);
			}
			bars[0] = [1, 0, 200, 250, 1, 100];
			assert.deepEqual(render(values, u, bars), []);
			batches(u.ctx);
		});
	});

	it('reuses module-level number formatters across helpers and cache invalidation', () => {
		const NumberFormat = Intl.NumberFormat;
		let constructions = 0;
		Intl.NumberFormat = new Proxy(NumberFormat, {
			construct(target, args) {
				constructions++;
				return Reflect.construct(target, args);
			},
		});
		try {
			for (const horizontal of [false, true]) {
				for (const percent of [false, true]) {
					const values = helper(horizontal, percent ? [{ series: [1], dir: 0 }] : [], percent);
					const u = plot([[0], [1200]], { _data: [[0], [.25]], _base: [null, [0]] });
					const bars = [[1, 0, 200, 250, 100, 100]];
					for (let pass = 0; pass < 2; pass++) {
						assert.deepEqual(render(values, u, bars).map(label => label.text), [percent ? '25%' : '1.2K']);
						values.invalidate();
					}
				}
			}
			assert.equal(constructions, 0);
		}
		finally { Intl.NumberFormat = NumberFormat; }
	});

	for (const horizontal of [false, true]) {
		for (const dir of [1, -1]) {
			it(`places grouped positive/negative labels outside (horizontal: ${horizontal}, dir: ${dir})`, () => {
				const values = helper(horizontal);
				const u = plot([[0], [12], [-8]], { scales: { y: { dir } } });
				u.series[1].alpha = .4;
				u.series[2].alpha = .8;
				const bars = [[1, 0, 200, 250, 100, 100], [2, 0, 450, 450, 100, 100]];
				const labels = render(values, u, bars);
				assert.deepEqual(labels.map(label => label.text), ['12', '-8']);
				labels.forEach((label, i) => {
					outside(label, bars[i], horizontal, (i == 0 ? 1 : -1) * dir * (horizontal ? 1 : -1));
					assert.equal(label.globalAlpha, u.series[i + 1].alpha);
					contained(label, u);
				});
			});
		}

		for (const pxRatio of [1, 2]) {
			it(`autosizes from 10 to 25 CSS px (horizontal: ${horizontal}, DPR: ${pxRatio})`, () => {
				const values = helper(horizontal);
				const u = plot([[0], [1234]], { pxRatio });
				u.bbox = { left: 20 * pxRatio, top: 30 * pxRatio, width: 1000 * pxRatio, height: 800 * pxRatio };
				const sizes = [];
				for (const expected of [10, 16, 25]) {
					// The linear mock gives "1.23K" 2.5px width and .9px height per font pixel.
					const thickness = expected == 25 ? 200 : expected * (horizontal ? 9 : 25) / 8;
					const bar = [1, 0, 250 * pxRatio, 250 * pxRatio, (horizontal ? 100 : thickness) * pxRatio, (horizontal ? thickness : 100) * pxRatio];
					const labels = render(values, u, [bar]);
					assert.equal(labels.length, 1);
					assert.equal(labels[0].text, '1.23K');
					close(labels[0].size / pxRatio, expected, 'CSS font size');
					contained(labels[0], u);
					sizes.push(labels[0].size / pxRatio);
				}
				assert.deepEqual(sizes, [10, 16, 25]);
				assert.deepEqual(measurements, [{ text: '1.23K', size: 25 * pxRatio }], 'measure once at maximum size, not at each draw size');
			});
		}

		for (const pxRatio of [1, 1.5, 2]) {
			it(`keeps fitted stack labels at thickness boundaries (horizontal: ${horizontal}, DPR: ${pxRatio})`, () => {
				const values = helper(horizontal, [{ series: [1, 2] }]);
				const u = plot([[0], [11e6], [18.5e6]], { pxRatio, _data: [[0], [11e6], [29.5e6]] });
				u.bbox = Object.fromEntries(Object.entries(u.bbox).map(([key, value]) => [key, value * pxRatio]));
				for (let thickness = 10; thickness <= 80; thickness++) {
					const bars = [1, 2].map(si => [si, 0, ...(horizontal
						? [250 + (si - 1) * 200, 200, 200, thickness]
						: [200, 250 + (si - 1) * 200, thickness, 200]).map(value => value * pxRatio)]);
					const labels = render(values, u, bars);
					for (const [i, text] of ['11M', '18.5M'].entries()) {
						const bar = bars[i];
						const inside = labels.filter(label => horizontal
							? Math.abs(label.x - bar[2] - bar[4] / 2) < 1e-9
							: Math.abs((label.top + label.bottom) / 2 - bar[3] - bar[5] / 2) < 1e-9);
						const fits = thickness * .8 >= 10 * (horizontal ? .9 : text.length / 2);
						assert.deepEqual(inside.map(label => label.text), fits ? [text] : [], `thickness ${thickness}, text ${text}`);
						if (fits) {
							centered(inside[0], bar);
							contained(inside[0], u);
						}
					}
				}
			});
		}

		it(`centers raw stack segments and emits one native total per group/category/sign (horizontal: ${horizontal})`, () => {
			const groups = [{ series: [1, 2, 3, 4, 5, 6, 7] }, { series: [8, 9, 10] }, { series: [11] }];
			const values = helper(horizontal, groups);
			const u = plot([
				[0, 1], [12, -14], [900, 900], [null, 8], [7, -6], [-9, null], [-5, 0], [null, undefined],
				[5, 11], [6, -4], [null, null], [500, 500],
			]);
			u.series[2].show = u.series[11].show = false;
			u._data = [u.data[0], [12, -14], [900, 900], [null, 8], [19, -20], [-9, null], [-14, 8], [19, 8], [5, 11], [11, -4], [11, -4], [500, 500]];
			u._base = [null, [0, 0], null, [null, 0], [12, -14], [0, null], [-9, 8], [19, 8], [0, 0], [5, 0], [11, -4], null];
			const bars = [];
			for (const [gi, group] of groups.entries()) {
				for (const si of group.series) {
					for (let di = 0; di < 2; di++) {
						// Native each runs only for shown, real, nonzero bars. Trailing holes can still have cumulative endpoints.
						if (u.series[si].show && Number.isFinite(u.data[si][di]) && u.data[si][di] != 0)
							bars.push(stackBar(u, si, di, horizontal, 100 + di * 300 + gi * 110));
					}
				}
			}
			bars.reverse(); // Totals must not depend on callback order or the last member being drawable.
			const labels = render(values, u, bars);
			assert.equal(labels.length, bars.length + 7, 'exactly seven nonempty group/category/sign totals');
			bars.forEach((bar, i) => {
				assert.equal(labels[i].text, String(u.data[bar[0]][bar[1]]));
				centered(labels[i], bar);
			});
			const expected = [[4, 0, '19'], [6, 0, '-14'], [3, 1, '8'], [4, 1, '-20'], [9, 0, '11'], [8, 1, '11'], [9, 1, '-4']];
			const totals = labels.slice(bars.length);
			for (const [si, di, text] of expected) {
				const bar = bars.find(bar => bar[0] == si && bar[1] == di);
				const category = horizontal ? bar[3] + bar[5] / 2 : bar[2] + bar[4] / 2;
				const matches = totals.filter(label => label.text == text && (horizontal ? (label.top + label.bottom) / 2 : label.x) == category);
				assert.equal(matches.length, 1, `one total ${text} for series ${si}, category ${di}`);
				outside(matches[0], bar, horizontal, Math.sign(u.data[si][di]) * (horizontal ? 1 : -1));
			}
			labels.forEach(label => contained(label, u));
		});

		it(`uses native percent differences, with no totals (horizontal: ${horizontal})`, () => {
			const values = helper(horizontal, [{ series: [1, 2, 3, 4, 5, 6] }], true);
			const u = plot([[0], [20], [999], [60], [-30], [-10], [null]]);
			u.series[2].show = false;
			u._data = [[0], [.25], [999], [1], [-.75], [-1], [1]];
			u._base = [null, [0], null, [.25], [0], [-.75], [1]];
			const bars = [1, 3, 4, 5].map(si => stackBar(u, si, 0, horizontal, 250, 320));
			const labels = render(values, u, bars);
			assert.deepEqual(labels.map(label => label.text), ['25%', '75%', '-75%', '-25%'], 'only segment shares, never cumulative endpoints or totals');
			labels.forEach((label, i) => {
				centered(label, bars[i]);
				contained(label, u);
			});
			assert.ok(measurements.every(metric => metric.text.endsWith('%')), 'percent stacks never measure raw totals');
		});

		for (const sign of [1, -1]) {
			it(`falls back to shown band endpoints without _base (horizontal: ${horizontal}, sign: ${sign})`, () => {
				const values = helper(horizontal, [{ series: [1, 2, 3] }], true);
				const u = plot([[0], [sign * 20], [sign * 999], [sign * 60]]);
				delete u._base;
				u.series[2].show = false;
				u._data = [[0], [sign * .25], [sign * 999], [sign]];
				const bars = [stackBar(u, 1, 0, horizontal, 250, 320, 0), stackBar(u, 3, 0, horizontal, 250, 320, sign * .25)];
				const labels = render(values, u, bars);
				assert.deepEqual(labels.map(label => label.text), sign > 0 ? ['25%', '75%'] : ['-25%', '-75%']);
				labels.forEach((label, i) => centered(label, bars[i]));
				// Hiding the first member makes the remaining member start at zero on the next reset.
				u.series[1].show = false;
				u._data[3] = [sign];
				const nextBar = stackBar(u, 3, 0, horizontal, 250, 320, 0);
				const next = render(values, u, [nextBar]);
				assert.deepEqual(next.map(label => label.text), [sign > 0 ? '100%' : '-100%'], 'a full-height segment is not accompanied by a percent total');
				centered(next[0], nextBar);
			});
		}
	}

	for (const pxRatio of [1, 1.5, 2]) {
		for (const dir of [1, -1]) {
			it(`uses maximum-size ink bounds for symmetric totals and centered segments (DPR: ${pxRatio}, dir: ${dir})`, () => {
				// Small-font hinting differs from the final-size metrics, as in real canvas fonts.
				textMetrics = (text, size) => ({
					width: String(text).length * size / 2,
					actualBoundingBoxAscent: size == 10 ? 8 : Math.round(size * .72),
					actualBoundingBoxDescent: Math.floor(size * .03),
				});
				const values = helper(false, [{ series: [1] }]);
				const u = plot([[0, 1], [100, -100]], { pxRatio, ctx: context(textMetrics), scales: { y: { dir } } });
				u.bbox = Object.fromEntries(Object.entries(u.bbox).map(([key, value]) => [key, value * pxRatio]));
				const bars = [[1, 0, 200, 250, 100, 100], [1, 1, 450, 450, 100, 100]]
					.map(([si, di, ...rect]) => [si, di, ...rect.map(value => value * pxRatio)]);
				const labels = render(values, u, bars);
				assert.deepEqual(labels.map(label => label.text), ['100', '-100', '100', '-100']);
				labels.slice(0, 2).forEach((label, i) => centered(label, bars[i]));
				labels.slice(2).forEach((label, i) => {
					const [, , , top, , height] = bars[i];
					const above = (i == 0 ? 1 : -1) * dir > 0;
					close(above ? top - label.bottom : label.top - top - height, 10 * pxRatio, 'equal ink gap at both stack ends');
				});
				labels.forEach(label => {
					assert.equal(label.size, 25 * pxRatio);
					contained(label, u);
				});
				render(values, u, bars);
				assert.deepEqual(measurements, [
					{ text: '100', size: 25 * pxRatio }, { text: '-100', size: 25 * pxRatio },
				], 'segments, totals, and redraws share one measurement per string');
			});
		}
	}

	it('preserves canvas state and balances save/restore while drawing', () => {
		const values = helper();
		const u = plot([[0], [12], [-8]]);
		u.series[1].alpha = .2;
		u.series[2].alpha = .9;
		const before = snapshot(u.ctx);
		const labels = render(values, u, [[1, 0, 200, 250, 100, 100], [2, 0, 450, 450, 100, 100]]);
		assert.equal(labels.length, 2);
		assert.deepEqual(labels.map(label => label.globalAlpha), [.2, .9]);
		for (const label of labels) {
			assert.equal(label.fillStyle, 'black');
			assert.equal(label.textAlign, 'center');
			assert.equal(label.textBaseline, 'alphabetic');
		}
		assert.ok(u.ctx.saves > 0);
		assert.equal(u.ctx.saves, u.ctx.restores);
		assert.deepEqual(snapshot(u.ctx), before);
	});

	it('reuses measurements across redraw, resize, and visibility changes; refreshes on DPR changes', () => {
		const values = helper();
		const u = plot([[0, 1], [12, 12], [8, 8]]);
		let bars = [[1, 0, 200, 250, 100, 100], [1, 1, 450, 250, 100, 100], [2, 0, 650, 250, 100, 100]];
		assert.equal(render(values, u, bars).length, 3);
		assert.equal(measurements.length, 2, 'repeated values share source measurements');
		const measured = measurements.slice();
		assert.equal(render(values, u, bars).length, 3);
		u.bbox.width += 200;
		bars = bars.map(([si, di, left, top, width, height]) => [si, di, left + 30, top, width * 1.2, height]);
		assert.equal(render(values, u, bars).length, 3);
		assert.deepEqual(measurements, measured, 'geometry changes reuse metrics');
		u.pxRatio = 2;
		assert.deepEqual(render(values, u, bars, false), []);
		assert.deepEqual(measurements, measured, 'DPR changes do not measure while disabled');
		u.bbox = Object.fromEntries(Object.entries(u.bbox).map(([key, value]) => [key, value * 2]));
		bars = bars.map(([si, di, ...rect]) => [si, di, ...rect.map(value => value * 2)]);
		const highDpr = render(values, u, bars);
		assert.equal(highDpr.length, 3);
		highDpr.forEach(label => contained(label, u));
		assert.deepEqual(render(values, u, bars, false), []);
		u.series[2].show = false;
		assert.equal(render(values, u, bars.filter(bar => bar[0] == 1)).length, 2);
		u.series[2].show = true;
		assert.equal(render(values, u, bars).length, 3);
		assert.deepEqual(measurements, [
			{ text: '12', size: 25 }, { text: '8', size: 25 },
			{ text: '12', size: 50 }, { text: '8', size: 50 },
		], 'DPR changes remeasure each string once; visibility changes reuse metrics');
		assert.equal(allocations, 1, 'DPR changes reuse the offscreen context');
	});

	it('measures one formatted string for distinct raw values, including after data updates', () => {
		const values = helper();
		const data = Array.from({ length: 200 }, (_, i) => 1000 + i * .001);
		const u = plot([data.map((_, i) => i), data]);
		const bars = data.map((_, i) => [1, i, 200, 250, 100, 100]);
		for (let pass = 0; pass < 3; pass++) {
			const labels = render(values, u, bars);
			assert.equal(labels.length, 200);
			assert.ok(labels.every(label => label.text === '1K'));
			values.invalidate();
		}
		assert.deepEqual(measurements.map(metric => metric.text), ['1K']);
		assert.equal(allocations, 1);
	});

	it('shares metrics for rounded percent shares and bounds numeric lookup churn without remeasurement', () => {
		const values = helper(false, [{ series: [1] }], true);
		const u = plot([[0], [1]], { _base: [null, [0]] });
		const bars = [[1, 0, 200, 250, 100, 100]];
		const descriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, 'format');
		let formats = 0;
		Object.defineProperty(Intl.NumberFormat.prototype, 'format', {
			...descriptor,
			get() { formats++; return descriptor.get.call(this); },
		});
		try {
			for (let i = 0; i < 1500; i++) {
				u._data[1][0] = .25001 + i * .000000001;
				assert.equal(render(values, u, bars)[0].text, '25%');
			}
			assert.equal(formats, 1500);
			u._data[1][0] = .25001;
			assert.equal(render(values, u, bars)[0].text, '25%');
			assert.equal(formats, 1501, 'the oldest numeric lookup was evicted');
			render(values, u, bars);
			assert.equal(formats, 1501, 'unchanged redraws do not format again');
			values.invalidate();
			render(values, u, bars);
			assert.equal(formats, 1502, 'data invalidation clears numeric lookups');
			assert.deepEqual(measurements.map(metric => metric.text), ['25%']);
		}
		finally { Object.defineProperty(Intl.NumberFormat.prototype, 'format', descriptor); }
	});

	it('bounds retained text metrics across data updates and reuses recent entries', () => {
		const values = helper();
		const u = plot();
		const bars = [[1, 0, 200, 250, 100, 100]];
		for (let value = -600; value <= 600; value++) {
			values.invalidate();
			u.data[1][0] = value;
			assert.equal(render(values, u, bars)[0].text, String(value));
		}
		const measured = measurements.length;
		values.invalidate();
		render(values, u, bars);
		assert.equal(measurements.length, measured, 'recent text survives numeric invalidation');
		u.data[1][0] = -600;
		assert.equal(render(values, u, bars)[0].text, '-600');
		assert.equal(measurements.length, measured + 1, 'old text was evicted after exceeding the cap');
		assert.equal(allocations, 1);
	});

	for (const horizontal of [false, true]) {
		it(`does not measure zero-length segment labels while retaining their totals (horizontal: ${horizontal})`, () => {
			const values = helper(horizontal, [{ series: [1, 2], dir: 0 }]);
			const u = plot([[0], [.1], [.2]], { _data: [[0], [.1], [.3]], _base: [null, [0], [.1]] });
			const bars = [1, 2].map(si => horizontal ? [si, 0, 200, 250, 0, 100] : [si, 0, 200, 250, 100, 0]);
			assert.deepEqual(render(values, u, bars).map(label => label.text), ['0.3']);
			assert.deepEqual(measurements.map(metric => metric.text), ['0.3'], 'only the total needs text metrics');
		});
	}

	it('reads stack baselines only for enabled percent labels', () => {
		const groups = [{ series: [1, 2], dir: 0 }];
		const values = helper(false, groups);
		const u = plot([[0], [1], [3]], { _data: [[0], [.25], [1]] });
		let baselineReads = 0;
		Object.defineProperty(u, '_base', { get() { baselineReads++; return [null, [0], [.25]]; } });
		values.reset(u, true);
		assert.equal(baselineReads, 0);
		values.configure(groups, true);
		values.reset(u, true);
		assert.equal(baselineReads, 2);
		values.reset(u, false);
		values.invalidate();
		assert.equal(baselineReads, 2);
		u.series[1].show = false;
		values.reset(u, true);
		assert.equal(baselineReads, 3, 'hidden series do not retain new baseline references');
	});

	it('does no offscreen allocation or measurement while disabled, even after invalidation', () => {
		const values = helper(false, [{ series: [1] }]);
		const u = plot();
		const bars = [[1, 0, 200, 250, 100, 100]];
		const before = snapshot(u.ctx);
		assert.deepEqual(render(values, u, bars, false), []);
		values.invalidate();
		assert.deepEqual(render(values, u, bars, false), []);
		assert.equal(allocations, 0);
		assert.deepEqual(measurements, []);
		assert.equal(u.ctx.saves, 0);
		assert.deepEqual(snapshot(u.ctx), before);
		assert.equal(render(values, u, bars).length, 2);
		const count = measurements.length;
		assert.deepEqual(render(values, u, bars, false), []);
		assert.equal(measurements.length, count);
	});

	it('keeps raw and percent labels distinct across data invalidation and drops stale rectangles', () => {
		const groups = [{ series: [1] }];
		const values = helper(false, groups);
		const u = plot([[0], [.5]]);
		u._base = [null, [0]];
		const bars = [[1, 0, 200, 250, 150, 100]];
		assert.deepEqual(render(values, u, bars).map(label => label.text), ['0.5', '0.5']);
		values.configure(groups, true);
		assert.deepEqual(render(values, u, bars).map(label => label.text), ['50%'], 'configure removes raw totals on next reset');
		values.configure(groups, false);
		render(values, u, bars);
		assert.deepEqual(measurements.map(metric => metric.text), ['0.5', '50%']);
		values.invalidate();
		u.ctx.labels.length = 0;
		values.draw(u);
		assert.deepEqual(u.ctx.labels, [], 'invalidation discards pending rectangles');
		render(values, u, bars);
		values.configure(groups, true);
		render(values, u, bars);
		assert.deepEqual(measurements.map(metric => metric.text), ['0.5', '50%'], 'data updates retain text metrics');
		values.configure([], false);
		const unstacked = render(values, u, bars);
		assert.equal(unstacked.length, 1, 'reconfiguration clears old group membership');
		outside(unstacked[0], bars[0], false, -1);
	});

	it('reset replaces prior rectangles/totals; destroy discards pending drawing', () => {
		const values = helper(false, [{ series: [1] }]);
		const u = plot();
		const bars = [[1, 0, 200, 250, 100, 100]];
		assert.equal(render(values, u, bars).length, 2);
		assert.deepEqual(render(values, u, []), []);
		assert.equal(render(values, u, bars).length, 2);
		values.destroy();
		u.ctx.labels.length = 0;
		values.draw(u);
		assert.deepEqual(u.ctx.labels, []);
		assert.equal(u.ctx.saves, u.ctx.restores);
	});

	it('releases native percent baselines and groups when the destroyed helper is retained', async function() {
		if (!globalThis.gc)
			this.skip();
		const { values, refs } = (() => {
			const groups = Object.freeze([Object.freeze({ series: Object.freeze([1, 2]), dir: 0 })]);
			const values = helper(false, groups, true);
			const data = [[0], [2], [3]];
			const stacked = [[0], [.4], [1]];
			const base = [null, [0], [.4]];
			const u = plot(data, { _data: stacked, _base: base });
			render(values, u, [[1, 0, 200, 250, 100, 100], [2, 0, 200, 150, 100, 100]]);
			const refs = [groups, groups[0], ...data, ...stacked, ...base.slice(1)].map(value => new WeakRef(value));
			values.destroy();
			assert.deepEqual(data, [[0], [2], [3]]);
			assert.deepEqual(stacked, [[0], [.4], [1]]);
			assert.deepEqual(base, [null, [0], [.4]]);
			assert.deepEqual(groups, [{ series: [1, 2], dir: 0 }]);
			return { values, refs };
		})();
		for (let i = 0; i < 3; i++) {
			await new Promise(setImmediate);
			globalThis.gc();
		}
		assert.ok(refs.every(ref => ref.deref() === undefined));
		assert.ok(values);
	});

	it('ignores non-finite values and non-positive rectangles without measuring', () => {
		const values = helper();
		const u = plot([[0, 1, 2, 3, 4, 5], [null, undefined, NaN, Infinity, -Infinity, 12]]);
		const bars = [0, 1, 2, 3, 4].map(di => [1, di, 200, 250, 100, 100]);
		bars.push([1, 5, 200, 250, 0, 100], [1, 5, 200, 250, 100, 0], [1, 5, 200, 250, -1, 100], [1, 5, 200, 250, 100, -1]);
		assert.deepEqual(render(values, u, bars), []);
		assert.equal(allocations, 0);
		assert.deepEqual(measurements, []);
		assert.equal(u.ctx.saves, 0);
	});

	for (const horizontal of [false, true]) {
		it(`skips labels below minimum size without shrinking readable neighbors (horizontal: ${horizontal})`, () => {
			const values = helper(horizontal);
			const u = plot([[0], [12], [8]]);
			const bars = [[1, 0, 200, 250, 100, 100], [2, 0, 450, 450, horizontal ? 100 : 1, horizontal ? 1 : 100]];
			const labels = render(values, u, bars);
			assert.deepEqual(labels.map(label => label.text), ['12']);
			assert.equal(labels[0].size, 25);
		});

		it(`skips inside labels that cannot fit both segment dimensions (horizontal: ${horizontal})`, () => {
			const values = helper(horizontal, [{ series: [1, 2, 3] }], true);
			const u = plot([[0], [25], [25], [50]]);
			u._data = [[0], [.25], [.5], [1]];
			u._base = [null, [0], [.25], [.5]];
			const bars = [[1, 0, 200, 250, 200, 200], [2, 0, 450, 450, 1, 100], [3, 0, 650, 450, 100, 1]];
			const before = snapshot(u.ctx);
			const labels = render(values, u, bars);
			assert.deepEqual(labels.map(label => label.text), ['25%']);
			centered(labels[0], bars[0]);
			assert.deepEqual(snapshot(u.ctx), before);
			assert.equal(u.ctx.saves, u.ctx.restores);
		});

		it(`fits outside labels to available edge space or skips them (horizontal: ${horizontal})`, () => {
			const values = helper(horizontal);
			const u = plot([[0], [12]]);
			const bars = [horizontal ? [1, 0, 870, 250, 120, 100] : [1, 0, 200, 50, 100, 100]];
			let labels = render(values, u, bars);
			assert.equal(labels.length, 1);
			assert.ok(labels[0].size < 25 && labels[0].size >= 10, 'outside space constrains the font');
			contained(labels[0], u);
			if (horizontal)
				bars[0][2] = 899;
			else
				bars[0][3] = 31;
			labels = render(values, u, bars);
			assert.deepEqual(labels, [], 'do not paint outside the plot when even 10px cannot fit');
		});

		for (const edge of ['near', 'far']) {
			it(`clips at the ${edge} category edge (horizontal: ${horizontal})`, () => {
				const values = helper(horizontal);
				const u = plot();
				const bar = horizontal
					? [1, 0, 250, edge == 'near' ? -60 : 800, 100, 100]
					: [1, 0, edge == 'near' ? -70 : 980, 250, 100, 100];
				const before = snapshot(u.ctx);
				assert.deepEqual(render(values, u, [bar]), []);
				assert.equal(u.ctx.saves, u.ctx.restores);
				assert.deepEqual(snapshot(u.ctx), before);
			});
		}
	}
});
