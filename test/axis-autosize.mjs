import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';
import { numAxisSplits } from '../src/opts.js';
import { autoAxisSize } from '../src/axis.js';

// Keep measurement separate from the drawing canvas, whose mock has no measureText.
// Cached contexts can outlive a test, so track them for the whole module.
const fontContexts = [];
class AutosizeCanvas {
	constructor() {
		let font = '10px sans-serif';
		const context = {
			assignments: [],
			measurements: [],
			get font() { return font; },
			set font(value) { font = value; this.assignments.push(value); },
			measureText(text) {
				this.measurements.push(String(text));
				return { width: String(text).length * parseFloat(font) / 2 };
			},
		};
		this.context = context;
		fontContexts.push(context);
	}
	getContext(kind) {
		assert.equal(kind, '2d');
		return this.context;
	}
}

let fontSerial = 0;
let testFont;
let plots;

function tickAxis(side, values, extra = {}) {
	return {
		scale: side % 2 ? 'y' : 'x', side, size: 'auto',
		font: testFont, gap: 3, ticks: { show: true, size: 7 },
		splits: [0, 50, 100], values,
		...extra,
	};
}

async function chart(axes, extra = {}, data = [[0, 50, 100], [0, 50, 100]]) {
	const u = new uPlot({
		width: 400, height: 300, pxRatio: 1,
		padding: [0, 0, 0, 0],
		legend: { show: false }, cursor: { show: false },
		series: [{}, { points: { show: false } }],
		scales: { x: { time: false, range: [0, 100] }, y: { range: [0, 100] } },
		axes,
		...extra,
	}, data, document.body);
	plots.push(u);
	await Promise.resolve();
	return u;
}

function geometry(u) {
	return {
		bbox: Object.fromEntries(Object.entries(u.bbox).map(([key, val]) => [key, val / u.pxRatio])),
		padding: u._padding.slice(),
		axes: u.axes.map(a => ({ size: a._size, splits: a._splits?.slice(), values: a._values?.slice(), rotate: a._rotate })),
	};
}

function measured(font) {
	return fontContexts.filter(ctx => ctx.font === font).flatMap(ctx => ctx.measurements);
}

function close(actual, expected, message) {
	assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
}

function marginPadding(min) {
	return [min, Infinity];
}


function trackedAxis(events, side, size, extra = {}) {
	return tickAxis(side, (self, splits, index) => {
		events.push({ kind: 'values', index });
		return splits.map(value => value == null ? null : `tick:${value}`);
	}, {
		size,
		space(self, index, min, max, dim) {
			events.push({ kind: 'space', index, dim });
			return 40;
		},
		incrs(self, index) {
			events.push({ kind: 'incrs', index });
			return [1, 2, 5, 10, 20, 50, 100];
		},
		splits(self, index, min, max) {
			events.push({ kind: 'splits', index });
			return [min, (min + max) / 2, max];
		},
		filter(self, splits, index) {
			events.push({ kind: 'filter', index });
			return splits;
		},
		rotate(self, values, index) {
			events.push({ kind: 'rotate', index });
			return 0;
		},
		...extra,
	});
}

function textCorners(text, height, align, baseline) {
	const width = text.length * height / 2;
	const left = align === 'right' ? -width : align === 'center' ? -width / 2 : 0;
	const top = baseline === 'middle' ? -height / 2 : baseline === 'bottom' ? -height : 0;
	return [[left, top], [left + width, top], [left, top + height], [left + width, top + height]];
}

// Interpret the drawing log without changing the shared canvas mock or its methods.
function textDraws(u) {
	let state = { font: '', textAlign: 'left', textBaseline: 'top', matrix: [1, 0, 0, 1, 0, 0] };
	const stack = [];
	const draws = [];
	for (const [name, ...entries] of u.ctx.log) {
		for (const args of entries) {
			if (name === 'save')
				stack.push(structuredClone(state));
			else if (name === 'restore')
				state = stack.pop();
			else if (name in state)
				state[name] = args;
			else if (name === 'translate') {
				const [a, b, c, d, e, f] = state.matrix;
				state.matrix = [a, b, c, d, e + a * args[0] + c * args[1], f + b * args[0] + d * args[1]];
			}
			else if (name === 'rotate') {
				const [a, b, c, d, e, f] = state.matrix;
				const cos = Math.cos(args[0]), sin = Math.sin(args[0]);
				state.matrix = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
			}
			else if (name === 'fillText' && state.font === testFont) {
				const [text, x, y] = args;
				const [a, b, c, d, e, f] = state.matrix;
				const point = (dx, dy) => [a * (x + dx) + c * (y + dy) + e, b * (x + dx) + d * (y + dy) + f];
				draws.push({
					text, align: state.textAlign, baseline: state.textBaseline,
					anchor: point(0, 0),
					corners: textCorners(text, parseFloat(state.font), state.textAlign, state.textBaseline).map(([dx, dy]) => point(dx, dy)),
				});
			}
		}
	}
	return draws;
}

function horizontalSelection(u) {
	return {
		range: u.scales.y._rangeY == null ? null : { ...u.scales.y._rangeY },
		axes: u.axes.slice(1).map(axis => ({ splits: axis._splits, values: axis._values, rotate: axis._rotate })),
	};
}

async function earlyRangedChart(events, categories) {
	const pad = [8, Infinity];
	return chart([
		tickAxis(3, () => categories.labels, { scale: 'x', splits: [0, 1, 2], label: 'categories', labelSize: 11 }),
		tickAxis(2, (self, splits) => splits.map(v => `selected:${v}:` + 'x'.repeat(50)), {
			scale: 'y', splits: undefined, exact: true, space: 100, label: 'values', labelSize: 13,
		}),
		tickAxis(0, (self, splits) => splits.map(v => `other:${v}`), { scale: 'y', splits: undefined, size: 24, space: 100 }),
	], {
		width: 900, height: 300, padding: [5, pad, 7, pad],
		scales: { x: { time: false, ori: 1, range: [0, 2] }, y: { time: false, ori: 0, axis: 1 } },
		hooks: { init: [u => {
			let width = u.bbox.width;
			Object.defineProperty(u.bbox, 'width', {
				get: () => width,
				set(value) {
					width = value;
					events.push({ kind: 'width', value });
				},
			});
			for (const [index, axis] of u.axes.entries()) {
				let size = axis._size;
				Object.defineProperty(axis, '_size', {
					get: () => size,
					set(value) {
						size = value;
						events.push({ kind: 'sized', index, value,
							selection: index === 0 ? horizontalSelection(u) : null });
					},
				});
				for (const kind of ['space', 'incrs', 'splits', 'filter', 'values', 'rotate', 'size']) {
					// Horizontal auto sizing is detected by function identity.
					if (kind === 'size' && axis.side % 2 === 0 && axis.size === autoAxisSize)
						continue;
					const original = axis[kind];
					axis[kind] = function(...args) {
						const result = original(...args);
						events.push({ kind, index, args: args.slice(1), result,
							selection: kind === 'size' && index === 0 ? horizontalSelection(u) : null });
						return result;
					};
				}
			}
		}] },
	}, [[0, 1, 2], [13, 87, 38]]);
}

function assertFrozenSelection(u, events) {
	const final = horizontalSelection(u);
	const snapshots = events.filter(e => e.selection != null);
	assert.ok(snapshots.length > 0, 'vertical sizing captures the horizontal selection');
	for (const event of snapshots) {
		assert.deepEqual(event.selection, final, `${event.kind} sees the final horizontal selection`);
		for (let i = 0; i < final.axes.length; i++) {
			assert.equal(event.selection.axes[i].splits, final.axes[i].splits);
			assert.equal(event.selection.axes[i].values, final.axes[i].values);
		}
	}
}

function singlePass(events, count) {
	for (let index = 0; index < count; index++) {
		for (const kind of ['space', 'incrs', 'splits', 'filter', 'values'])
			assert.equal(events.filter(e => e.index === index && e.kind === kind).length, 1, `${kind} axis ${index}`);
	}
}

describe('automatic axis size and overflow padding', () => {
	let originalOffscreen;
	before(() => {
		originalOffscreen = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
		Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, writable: true, value: AutosizeCanvas });
	});
	after(() => {
		if (originalOffscreen)
			Object.defineProperty(globalThis, 'OffscreenCanvas', originalOffscreen);
		else
			delete globalThis.OffscreenCanvas;
	});
	beforeEach(() => {
		testFont = `10px autosize-test-${++fontSerial}`;
		plots = [];
	});
	afterEach(() => {
		for (const u of plots)
			u.destroy();
	});

	it('normalizes auto sizing by function identity and retains numeric size hints', async () => {
		const u = await chart([
			tickAxis(2, ['one', 'two', 'three']),
			tickAxis(3, ['one', 'two', 'three'], { size: 37 }),
			tickAxis(0, ['one', 'two', 'three'], { size: 24 }),
			tickAxis(1, ['one', 'two', 'three'], { size: () => 63 }),
		]);
		assert.equal(u.axes[0].size, autoAxisSize);
		assert.deepEqual(u.axes.map(axis => axis._sizeHint), [50, 37, 24, 50]);
		assert.deepEqual(u.axes.slice(1).map(axis => axis._size), [37, 24, 63]);
	});

	for (const side of [0, 1, 2, 3]) {
		it(`uses size hints for participation and axis DOM on side ${side}, even when measured size is zero`, async () => {
			for (const [name, size, hint, measuredSize] of [
				['positive numeric', 12, 12, 12],
				['numeric zero', 0, 0, 0],
				['callback returning zero', () => 0, 50, 0],
				['automatic zero', 'auto', 50, 0],
			]) {
				const u = await chart([
					tickAxis(side, [null, null, null], { size, dom: true, gap: 0, ticks: { show: false } }),
					{ show: false },
				], { padding: [null, null, null, null] });
				const axis = u.axes[0];
				const el = axis._el;
				for (let pass = 0; pass < 2; pass++) {
					assert.equal(axis._sizeHint, hint, name);
					assert.equal(axis._size, measuredSize, name);
					assert.deepEqual(axis._splits, [0, 50, 100], `${name} still selects ticks`);
					assert.deepEqual(u._padding, hint === 0 ? [0, 0, 0, 0] : side % 2 ? [17, 0, 17, 0] : [0, 25, 0, 25], name);
					assert.equal(u.root.querySelectorAll('.u-axis').length, hint > 0 ? 1 : 0, name);
					assert.equal(axis._el, el, 'layout retains the original axis element');
					if (hint > 0)
						assert.ok(u.root.contains(el), `${name} keeps its axis element attached`);
					else
						assert.equal(el, undefined, 'numeric zero does not create an axis element');
					if (pass === 0) {
						u.redraw(false, true);
						await Promise.resolve();
					}
				}
			}
		});
	}

	it('uses tuple minima when labels are absent', async () => {
		const u = await chart([{ show: false }, { show: false }], {
			padding: [[0, Infinity], [13, Infinity], [7, 20], [9, 15]],
		});
		assert.deepEqual(u._padding, [0, 13, 7, 9]);
		assert.deepEqual(measured(testFont), []);
	});

	it('reserves tuple minima before selecting labels and keeps top and bottom at their minima', async () => {
		const provisional = [];
		const u = await chart([
			tickAxis(2, self => {
				provisional.push(self._padding.slice());
				return ['abcdefgh', null, 'abcdefgh'];
			}, { size: 20 }),
			{ show: false },
		], { padding: [[1.5, 30], [2, 10], [3.5, Infinity], [4, 15]] });
		assert.deepEqual(provisional, [[1.5, 2, 3.5, 4]]);
		assert.deepEqual(u._padding, [1.5, 10, 3.5, 15]);
	});

	for (const cap of [8, 9.8, 10, 20, Infinity]) {
		it(`caps overflow after rounding up with maximum ${cap}`, async () => {
			const u = await chart([
				tickAxis(2, ['abc', null, 'abc'], { size: 20 }),
				{ show: false },
			], { padding: [0, [2.1, cap], 0, [2.1, cap]] });
			// Half the label width is 7.5; ceil(2.1 + 7.5) is 10.
			assert.deepEqual(u._padding, [0, Math.min(10, cap), 0, Math.min(10, cap)]);
		});
	}

	it('keeps asymmetric tuple limits independent and unchanged across resize', async () => {
		const padding = [[1, 10], [3, 12.5], [5, 20], [7, 80]];
		const original = structuredClone(padding);
		const u = await chart([
			tickAxis(2, ['x'.repeat(40), null, 'abcdef']),
			{ show: false },
		], { padding });
		assert.notEqual(u.padding, padding, 'the chart copies the configuration array');
		function check() {
			assert.deepEqual(u._padding, [1, 12.5, 5, 80]);
			assert.deepEqual(padding, original);
			assert.deepEqual(u.padding, original, 'resolved padding does not replace literal tuple limits');
		}
		check();
		const initial = geometry(u);
		for (const width of [700, 250, 400]) {
			u.setSize({ width, height: 300 });
			await Promise.resolve();
			check();
		}
		assert.deepEqual(geometry(u), initial);
		u.redraw(false, true);
		await Promise.resolve();
		check();
		assert.deepEqual(geometry(u), initial);
	});

	it('uses equal tuple bounds as fixed padding without measuring labels', async () => {
		const u = await chart([
			tickAxis(2, ['long label', null, 'long label'], { size: 20 }),
			{ show: false },
		], { padding: [[1.5, 1.5], [2.5, 2.5], [3.5, 3.5], [4.5, 4.5]] });
		assert.deepEqual(u._padding, [1.5, 2.5, 3.5, 4.5]);
		assert.deepEqual(measured(testFont), []);
	});

	it('fits selected labels, ticks, and gap without an extra axis padding allowance', async () => {
		const vertical = ['ab', 'abcdefgh\nxy', null];
		const horizontal = ['one', 'two\nthree', null];
		const u = await chart([
			tickAxis(2, horizontal, { lineGap: 1.5, label: 'X title', labelSize: 17 }),
			tickAxis(3, vertical, { label: 'Y title', labelSize: 19 }),
		]);
		assert.equal(u.axes[0]._size, 35, '7 tick + 3 gap + 10 font + 15 line advance');
		assert.equal(u.axes[1]._size, 50, '7 tick + 3 gap + 40 maximum line width');
		assert.deepEqual(measured(testFont), ['ab', 'abcdefgh', 'xy']);
		assert.deepEqual(u.axes[1]._labelWidths, [10, 40, 0]);
		assert.equal(u.axes[1]._labelValues, u.axes[1]._values);
		assert.equal(u.bbox.left, 69);
		assert.equal(u.bbox.height, 248);
		assert.notEqual(fontContexts.find(ctx => ctx.font === testFont), u.ctx);
		const widths = u.axes[1]._labelWidths;
		const count = measured(testFont).length;
		u.axes[0].lineGap = 2;
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(u.axes[0]._size, 40, 'line advance updates without measuring horizontal widths');
		assert.equal(u.axes[1]._labelWidths, widths);
		assert.equal(measured(testFont).length, count);
	});

	it('omits hidden ticks and measures numeric labels as text', async () => {
		const u = await chart([
			tickAxis(2, [0, 123, null], { ticks: { show: false, size: 70 } }),
			tickAxis(3, [0, 123, null], { ticks: { show: false, size: 70 } }),
		]);
		assert.equal(u.axes[0]._size, 13);
		assert.equal(u.axes[1]._size, 18);
		assert.deepEqual(u.axes[1]._labelWidths, [5, 15, 0]);
	});

	for (const rotate of [-90, -33, 33, 90]) {
		it(`fits single-line ${rotate}-degree labels with tuple overflow`, async () => {
			const pad = marginPadding(0);
			const u = await chart([
				tickAxis(2, ['abcdefghijklmnop', null, 'abcdefghijklmnop'], { rotate, alignTo: 1 }),
				{ show: false },
			], { padding: [0, pad, 0, pad] });
			const radians = Math.abs(rotate) * Math.PI / 180;
			const cos = Math.abs(rotate) === 90 ? 0 : Math.cos(radians);
			const sin = Math.sin(radians);
			const near = Math.ceil(5 * sin), far = Math.ceil(80 * cos + 5 * sin);
			assert.deepEqual(u._padding, [0, rotate < 0 ? far : near, 0, rotate > 0 ? far : near]);
			assert.equal(u.axes[0]._rotate, rotate);
			assert.equal(u.axes[0]._size, Math.ceil(10 + 80 * sin + 5 * cos));
			assert.deepEqual(u.axes[0]._labelWidths, [80, 0, 80]);
			for (const draw of textDraws(u)) {
				assert.equal(draw.align, rotate > 0 ? 'right' : 'left');
				assert.equal(draw.baseline, 'middle');
				close(draw.anchor[1], u.axes[0]._pos + 10, 'original rotated label anchor');
				assert.ok(draw.corners.every(([x]) => x >= -.5 && x <= u.width + .5), 'rotated labels fit within the chart edges');
			}
		});
	}

	for (const rotate of [-90, -33, 33, 90]) {
		it(`distinguishes blank, null, and filtered labels in ${rotate}-degree sizing and overflow`, async () => {
			let labels = ['abcdefgh', null, 'abcdefgh'];
			let hidden = false;
			const u = await chart([
				tickAxis(2, (self, splits) => splits.map((split, i) => split == null ? null : labels[i]), {
					rotate,
					filter: (self, splits) => hidden ? splits.map(() => null) : splits,
				}),
				{ show: false },
			], { padding: [0, [4, Infinity], 0, [4, Infinity]] });
			const radians = Math.abs(rotate) * Math.PI / 180;
			const cos = Math.abs(rotate) === 90 ? 0 : Math.cos(radians);
			const sin = Math.sin(radians);
			for (const [value, filtered] of [['', false], [null, false], ['abcdefgh', true], ['abcdefgh', false]]) {
				labels = [value, null, value];
				hidden = filtered;
				u.redraw(false, true);
				await Promise.resolve();
				const visible = value != null && !hidden;
				const width = visible ? value.length * 5 : 0;
				const near = visible ? Math.ceil(4 + 5 * sin) : 4;
				const far = visible ? Math.ceil(4 + width * cos + 5 * sin) : 4;
				assert.deepEqual(u.axes[0]._values, hidden ? [null, null, null] : labels);
				assert.deepEqual(u.axes[0]._labelWidths, [width, 0, width]);
				assert.equal(u.axes[0]._size, Math.ceil(10 + (visible ? width * sin + 5 * cos : 0)));
				assert.deepEqual(u._padding, [0, rotate < 0 ? far : near, 0, rotate > 0 ? far : near]);
			}
		});
	}

	for (const side of [3, 1]) {
		for (const align of [undefined, 1, 2]) {
			for (const alignTo of [1, 2]) {
				it(`preserves explicitly sized vertical labels at side ${side}, align ${align ?? 'default'}, alignTo ${alignTo}`, async () => {
					const u = await chart([{ show: false }, tickAxis(side, ['abcdefgh\nxy'], { size: 50, splits: [50], align, alignTo })]);
					const axis = u.axes[1];
					const dir = side === 3 ? -1 : 1;
					const textAlign = align === 1 ? 'left' : align === 2 ? 'right' : side === 3 ? 'right' : 'left';
					assert.equal(axis._size, 50);
					const draws = textDraws(u);
					assert.deepEqual(draws.map(d => d.text), ['abcdefgh', 'xy']);
					const anchor = axis._pos + dir * (alignTo === 2 ? axis._size - 3 : 10);
					for (const draw of draws) {
						assert.equal(draw.align, textAlign);
						assert.equal(draw.baseline, 'middle');
						close(draw.anchor[0], anchor, 'drawn horizontal anchor');
					}
					close(draws[1].anchor[1] - draws[0].anchor[1], 15, 'multiline vertical advance');
				});
			}
		}
	}

	for (const side of [0, 2]) {
		it(`distinguishes blank labels from all-null labels without measuring on side ${side}`, async () => {
			let labels = [null, null, null];
			const u = await chart([tickAxis(side, () => labels), { show: false }]);
			assert.equal(u.axes[0]._size, 10, 'all-null labels reserve only ticks and gap');
			for (const [value, extent] of [['', 10], ['\n', side === 2 ? 25 : 10], [0, 10], [null, 0]]) {
				labels = [value, null, null];
				u.redraw(false, true);
				await Promise.resolve();
				assert.equal(u.axes[0]._size, 10 + extent);
				assert.deepEqual(measured(testFont), []);
				assert.equal(fontContexts.filter(ctx => ctx.font === testFont).length, 0);
			}
		});

		it(`sizes unrotated multiline labels from current strings on side ${side}`, async () => {
			let labels = ['abcdefgh\nxy'];
			const u = await chart([tickAxis(side, () => labels, { splits: [50], alignTo: 1 }), { show: false }]);
			const axis = u.axes[0];
			for (const text of ['abcdefgh\nxy', 'abcdefgh\nxy\nz', 'abcdefgh']) {
				labels = [text];
				u.redraw(false, true);
				await Promise.resolve();
				const parts = text.split('\n');
				assert.deepEqual(measured(testFont), []);
				assert.equal(fontContexts.filter(ctx => ctx.font === testFont).length, 0);
				assert.equal(axis._size, side === 2 ? 20 + (parts.length - 1) * 15 : 20);
				const draws = textDraws(u).slice(-parts.length);
				assert.deepEqual(draws.map(d => d.text), parts);
				for (const [i, draw] of draws.entries()) {
					assert.equal(draw.align, 'center');
					assert.equal(draw.baseline, side === 2 ? 'top' : 'bottom');
					close(draw.anchor[0], 200, 'drawn tick position');
					close(draw.anchor[1], axis._pos + (side === 2 ? 10 : -10) + i * 15, 'original multiline anchor');
				}
			}
		});
	}

	for (const mode of ['rotation', 'tuple overflow']) {
		it(`measures lazily for ${mode} and never validates stale widths while measurement is skipped`, async () => {
			let enabled = false;
			let labels = ['old', null, 'old'];

			const u = await chart([
				tickAxis(2, () => labels, { rotate: () => enabled && mode === 'rotation' ? 90 : 0 }),
				{ show: false },
			]);
			const axis = u.axes[0];
			assert.equal(axis._size, 20);
			assert.deepEqual(measured(testFont), []);
			assert.equal(fontContexts.filter(ctx => ctx.font === testFont).length, 0);

			for (const text of ['abcdefgh', 'abcdefghijklmnopqrst']) {
				enabled = false;
				u.padding[1] = u.padding[3] = 0;
				const count = measured(testFont).length;
				labels = [text, null, text];
				u.redraw(false, true);
				await Promise.resolve();
				assert.equal(axis._values, labels);
				assert.equal(axis._size, 20);
				assert.deepEqual(u._padding, [0, 0, 0, 0]);
				assert.equal(measured(testFont).length, count, 'changed formatted strings do not trigger unused width measurements');

				enabled = true;
				if (mode === 'tuple overflow')
					u.padding[1] = u.padding[3] = [10, Infinity];
				u.redraw(false, true);
				await Promise.resolve();
				const width = text.length * 5;
				assert.deepEqual(axis._labelWidths, [width, 0, width]);
				assert.equal(axis._labelValues, labels);
				assert.deepEqual(measured(testFont).slice(count), [text, text], 'measure current strings, not the skipped or previously measured values');
				assert.equal(axis._size, mode === 'rotation' ? 10 + width : 20);
				assert.deepEqual(u._padding, mode === 'rotation' ? [0, 0, 0, 0] : [0, 10 + width / 2, 0, 10 + width / 2]);

				const widths = axis._labelWidths;
				const measuredCount = measured(testFont).length;
				labels = labels.slice();
				u.redraw(false, true);
				await Promise.resolve();
				assert.equal(axis._labelValues, labels);
				assert.equal(axis._labelWidths, widths, 'fresh equal arrays reuse measured widths');
				assert.equal(measured(testFont).length, measuredCount);
			}
		});
	}

	it('measures formatted and filtered labels rather than source values', async () => {
		const u = await chart([
			{ show: false },
			tickAxis(3, (self, splits) => splits.map(value => value == null ? null : `${value}`.slice(0, 2)), {
				filter: (self, splits) => splits.map(value => value === 50 ? null : value),
			}),
		]);
		assert.deepEqual(u.axes[1]._values, ['0', null, '10']);
		assert.deepEqual(u.axes[1]._labelWidths, [5, 0, 10]);
		assert.equal(u.axes[1]._size, 20);
		assert.deepEqual(measured(testFont), ['0', '10']);
	});

	it('reuses unchanged label measurements and truncates the cache for replacement arrays', async () => {
		let labels = ['abcd', 'ef\nghijk', null];
		const u = await chart([{ show: false }, tickAxis(3, () => labels)]);
		const count = measured(testFont).length;
		const first = geometry(u);
		for (const width of [600, 400]) {
			u.setSize({ width, height: 300 });
			await Promise.resolve();
			assert.equal(measured(testFont).length, count);
		}
		assert.deepEqual(geometry(u), first);
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(measured(testFont).length, count);

		labels = ['z'];
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(u.axes[1]._labelValues, labels);
		assert.deepEqual(u.axes[1]._labelWidths, [5]);
		assert.equal(u.axes[1]._size, 15);
		assert.ok(measured(testFont).length > count);
		labels = [];
		u.redraw(false, true);
		await Promise.resolve();
		assert.equal(u.axes[1]._labelValues, labels);
		assert.deepEqual(u.axes[1]._labelWidths, []);
	});

	it('reuses widths for fresh elementwise-equal arrays and tracks the latest values reference', async () => {
		const labels = ['abcd', 'ef\nghijk', null, 123];
		const u = await chart([{ show: false }, tickAxis(3, () => labels.slice(), { splits: [0, 25, 50, 100] })]);
		const axis = u.axes[1];
		const widths = axis._labelWidths;
		assert.deepEqual(widths, [20, 25, 0, 15]);
		assert.ok(widths.every(width => typeof width === 'number'));
		const count = measured(testFont).length;
		for (const width of [600, 400, 400]) {
			const previous = axis._values;
			if (width === u.width)
				u.redraw(false, true);
			else
				u.setSize({ width, height: 300 });
			await Promise.resolve();
			assert.notEqual(axis._values, previous);
			assert.deepEqual(axis._values, previous);
			assert.equal(axis._labelValues, axis._values);
			assert.equal(axis._labelWidths, widths);
			assert.equal(measured(testFont).length, count);
		}
	});

	it('retains the dedicated font context after destroy and recreate', async () => {
		const first = await chart([{ show: false }, tickAxis(3, ['one', 'two', 'three'])]);
		const context = fontContexts.find(ctx => ctx.font === testFont);
		const count = context.measurements.length;
		first.destroy();
		plots.splice(plots.indexOf(first), 1);
		const next = await chart([{ show: false }, tickAxis(3, ['four', 'five', 'six'])]);
		assert.deepEqual(fontContexts.filter(ctx => ctx.font === testFont), [context]);
		assert.equal(context.assignments.length, 1);
		assert.equal(context.measurements.length, count + 3);
		assert.deepEqual(next.axes[1]._labelWidths, [20, 20, 15]);
		assert.notEqual(next.ctx, first.ctx);
	});

	it('shares one dedicated context per font across axes and plots', async () => {
		const first = await chart([tickAxis(2, ['a', 'bb', 'ccc'], { rotate: 33 }), tickAxis(3, ['d', 'ee', 'fff'])]);
		await chart([tickAxis(2, ['g', 'hh', 'iii'], { rotate: 33 }), { show: false }]);
		const contexts = fontContexts.filter(ctx => ctx.font === testFont);
		assert.equal(contexts.length, 1);
		assert.equal(contexts[0].assignments.length, 1);
		assert.notEqual(contexts[0], first.ctx);
		assert.deepEqual(contexts[0].measurements, ['a', 'bb', 'ccc', 'd', 'ee', 'fff', 'g', 'hh', 'iii']);

		const otherFont = `20px autosize-test-${fontSerial}-other`;
		const other = await chart([{ show: false }, tickAxis(3, ['a', 'bb', 'ccc'], { font: otherFont })]);
		assert.equal(fontContexts.filter(ctx => ctx.font === otherFont).length, 1);
		assert.equal(other.axes[1]._size, 40);
	});

	it('invalidates measurements on DPR changes even when the values array is unchanged', async () => {
		const labels = ['abcd', 'ef\nghijk', null];
		const u = await chart([tickAxis(2, labels), tickAxis(3, labels)]);
		const first = geometry(u);
		const before = fontContexts.reduce((sum, ctx) => sum + ctx.measurements.length, 0);
		u.setPxRatio(2);
		await Promise.resolve();
		assert.deepEqual(geometry(u), first);
		assert.equal(u.axes[1]._labelValues, u.axes[1]._values);
		assert.ok(fontContexts.reduce((sum, ctx) => sum + ctx.measurements.length, 0) > before);
		u.setPxRatio(1);
		await Promise.resolve();
		assert.deepEqual(geometry(u), first);
	});

	it('credits visible vertical allocations and titles for all visible horizontal axes', async () => {
		const pad = marginPadding(4);
		const u = await chart([
			tickAxis(2, ['abcdefghijklmnopqrst', null, 'abcdefghijklmnopqrst'], { size: 20 }),
			tickAxis(3, ['x', 'y', 'z'], { size: 20, label: 'left', labelSize: 10 }),
			tickAxis(0, ['abcdefghijklmnopqrstuvwx', null, 'abcdefghijklmnopqrstuvwx'], { size: 20 }),
			tickAxis(1, ['x', 'y', 'z'], { size: 15, label: 'right', labelSize: 5 }),
			tickAxis(3, ['x', 'y', 'z'], { size: 5 }),
			tickAxis(0, ['x'.repeat(200), null, 'x'.repeat(200)], { show: false }),
			tickAxis(1, ['x', 'y', 'z'], { size: 200, label: 'hidden', labelSize: 100, show: false }),
		], { padding: [4, pad, 4, pad] });
		assert.deepEqual(u._padding, [4, 44, 4, 29]);
		assert.equal(u.bbox.left, 64);
		assert.equal(u.bbox.width, 272);
		assert.equal(u.bbox.left - 60, 4, 'left labels retain the outer margin');
		assert.equal(u.width - (u.bbox.left + u.bbox.width + 60), 4, 'right labels retain the outer margin');
	});

	it('uses only selected formatted labels for padding', async () => {
		const pad = [2, Infinity];
		const u = await chart([
			tickAxis(2, (self, splits) => splits.map(value => value == null ? null : 'ok'), {
				filter: (self, splits) => splits.map(value => value === 50 ? null : value),
			}),
			{ show: false },
		], { padding: [pad, pad, pad, pad] });
		assert.deepEqual(u._padding, [2, 7, 2, 7]);
		assert.equal(u.bbox.left - 5, 2);
		assert.equal(u.width - (u.bbox.left + u.bbox.width + 5), 2);
		assert.deepEqual(u.axes[0]._labelWidths, [10, 0, 10]);

	});

	for (const tupleSide of [3, 1]) {
		for (const oppositeTuple of [false, true]) {
			it(`fits side ${tupleSide} labels with opposite ${oppositeTuple ? 'tuple minimum' : 'numeric padding'}`, async () => {
				const oppositeSide = tupleSide === 3 ? 1 : 3;
				const split = tupleSide === 3 ? 25 : 75;
				const padding = [0, 0, 0, 0];
				padding[tupleSide] = [10, Infinity];
				padding[oppositeSide] = oppositeTuple ? [200, Infinity] : 200;
				const u = await chart([
					tickAxis(2, ['x'.repeat(40)], { size: 20, splits: [split] }),
					{ show: false },
				], { width: oppositeTuple ? 500 : 400, padding });
				assert.deepEqual(u.axes[0]._labelWidths, [200]);
				assert.ok(u._padding[tupleSide] >= 10);
				assert.ok(u._padding[oppositeSide] >= 200);
				if (!oppositeTuple)
					assert.equal(u._padding[oppositeSide], 200);
				assert.ok(u.bbox.width > 0);
				const center = u.bbox.left + u.valToPos(split, 'x');
				const margin = tupleSide === 3 ? center - 100 : u.width - center - 100;
				assert.ok(margin >= 10, `the 200px label retains its 10px outer margin: ${margin}`);
			});
		}
	}

	it('uses normalized positions for interior labels on reversed nonlinear scales', async () => {
		for (const dir of [1, -1]) {
			const pad = marginPadding(10);
			const u = await chart([
				tickAxis(2, ['x'.repeat(140)], { size: 20, splits: [10], filter: (self, splits) => splits }),
				{ show: false },
			], {
				width: 1002, padding: [0, pad, 0, pad],
				scales: { x: { time: false, distr: 3, dir, range: [1, 10000] }, y: { range: [0, 100] } },
			}, [[1, 10, 10000], [0, 50, 100]]);
			const overflowSide = dir === 1 ? 3 : 1;
			const oppositeSide = dir === 1 ? 1 : 3;
			function check() {
				// The conservative width bound does not solve for optimal simultaneous padding.
				const minWidth = u.width - Math.ceil(10 + 350) * 2;
				assert.equal(u._padding[overflowSide], Math.ceil(10 + 350 - .25 * minWidth));
				assert.equal(u._padding[oppositeSide], Math.ceil(Math.max(10, 10 + 350 - .75 * minWidth)));
				close(u.valToPos(10, 'x') / u.bbox.width, dir === 1 ? .25 : .75, 'normalized logarithmic position');
				const center = u.bbox.left + u.valToPos(10, 'x');
				assert.ok(center - 350 >= 10, 'left label edge retains the outer margin');
				assert.ok(center + 350 <= u.width - 10, 'right label edge retains the outer margin');
			}
			check();
			assert.equal(u._padding[overflowSide], 290);
			const initial = geometry(u);
			for (const width of [1402, 1002]) {
				u.setSize({ width, height: 300 });
				await Promise.resolve();
				check();
			}
			assert.deepEqual(geometry(u), initial);
			u.redraw(false, true);
			await Promise.resolve();
			assert.deepEqual(geometry(u), initial);
		}
	});

	it('keeps original default and null padding heuristics even with automatic horizontal axes', async () => {
		const labels = ['x'.repeat(40), null, 'x'.repeat(40)];
		const fixed = await chart([tickAxis(2, labels, { size: 20 }), { show: false }], { padding: undefined });
		assert.deepEqual(fixed._padding, [0, 25, 0, 25]);
		const auto = await chart([tickAxis(2, labels), { show: false }], { padding: undefined });
		assert.deepEqual(auto._padding, fixed._padding);
		assert.equal(auto.bbox.left, 25);
		assert.equal(auto.bbox.width, 350);
		const override = await chart([tickAxis(2, labels), { show: false }], { padding: [1, 2, 3, 4] });
		assert.deepEqual(override._padding, [1, 2, 3, 4]);

		const nullable = await chart([tickAxis(2, labels), { show: false }], { padding: [null, null, null, null] });
		assert.deepEqual(nullable._padding, auto._padding);
		assert.deepEqual(nullable.padding, [null, null, null, null]);
		nullable.padding[1] = 6;
		nullable.padding[3] = 8;
		nullable.redraw(false, true);
		await Promise.resolve();
		assert.deepEqual(nullable._padding, [0, 6, 0, 8]);
		nullable.padding[1] = nullable.padding[3] = null;
		nullable.redraw(false, true);
		await Promise.resolve();
		assert.deepEqual(nullable._padding, auto._padding);
		assert.deepEqual(measured(testFont), [], 'numeric and null padding do not measure horizontal widths');
	});

	it('selects every horizontal axis once from provisional width, then uses final height for vertical ticks', async () => {
		const events = [];
		const customSize = function(self, values, index) {
			events.push({ kind: 'size', index, values });
			return 80;
		};
		const u = await chart([
			trackedAxis(events, 2, 'auto', { label: 'bottom', labelSize: 11 }),
			trackedAxis(events, 3, 30, { label: 'left', labelSize: 9 }),
			trackedAxis(events, 0, 24),
			trackedAxis(events, 1, customSize, { label: 'right', labelSize: 13 }),
			trackedAxis(events, 3, 'auto'),
		], { width: 600, padding: [5, 7, 9, 11] });
		function check() {
			const expectedWidth = u.width - 30 - 9 - 50 - 13 - 50 - 7 - 11;
			singlePass(events, 5);
			for (const index of [0, 2]) {
				assert.equal(events.find(e => e.kind === 'space' && e.index === index).dim, expectedWidth);
				assert.ok(events.findIndex(e => e.kind === 'values' && e.index === index) < events.findIndex(e => e.kind === 'space' && e.index === 1));
			}
			for (const index of [1, 3, 4])
				assert.equal(events.find(e => e.kind === 'space' && e.index === index).dim, u.bbox.height);
			assert.equal(events.filter(e => e.kind === 'rotate').length, 1);
			const sizes = events.filter(e => e.kind === 'size');
			assert.equal(sizes.length, 1);
			assert.equal(sizes[0].values, u.axes[3]._values);
		}
		check();
		const initial = geometry(u);
		events.length = 0;
		u.setSize({ width: 850, height: 450 });
		await Promise.resolve();
		check();
		events.length = 0;
		u.setSize({ width: 600, height: 300 });
		await Promise.resolve();
		check();
		assert.deepEqual(geometry(u), initial);
	});

	it('ranges horizontal tick-aware Y once from the width hint and freezes both same-scale axes', async () => {
		const events = [];
		const categories = { labels: ['category:'.repeat(3), 'short', 'last'] };
		const u = await earlyRangedChart(events, categories);
		function check() {
			const dim = u.width - 50 - 11 - 8 - 8;
			const expected = rangeY(13, 87, dim, u.scales.y._policyY, u.axes[1].ramp, true, 100);
			assert.equal(u.scales.y._axisY, true);
			assert.deepEqual(u.scales.y._rangeY, expected);
			assert.deepEqual(u.axes[1]._splits, numAxisSplits(u, 1, expected.min, expected.max, expected.incr, 0, true));
			const rangeCalls = events.filter(e => e.index === 1 && e.kind === 'space');
			assert.equal(rangeCalls.length, 1, 'one horizontal range decision');
			assert.deepEqual(rangeCalls[0].args, [1, 13, 87, dim]);
			for (const index of [1, 2]) {
				for (const kind of ['splits', 'filter', 'values'])
					assert.equal(events.filter(e => e.index === index && e.kind === kind).length, 1, `${kind} axis ${index}`);
				assert.ok(events.findIndex(e => e.index === index && e.kind === 'values') < events.findIndex(e => e.index === 0 && e.kind === 'size'));
			}
			assert.equal(u.axes[1].size, autoAxisSize, 'instrumentation retains horizontal auto function identity');
			const sizes = events.filter(e => e.kind === 'size');
			assert.deepEqual(sizes.map(e => e.index), [2, 0]);
			assert.deepEqual(sizes[0].args, [null, 2]);
			assert.deepEqual(events.filter(e => e.kind === 'sized').map(e => e.index), [1, 2, 0], 'each horizontal axis is sized once before vertical sizing');
			const firstSize = events.findIndex(e => e.kind === 'sized' || e.kind === 'size');
			for (const index of [1, 2]) {
				for (const kind of ['space', 'splits', 'filter', 'values'])
					assert.ok(events.findIndex(e => e.index === index && e.kind === kind) < firstSize, `${kind} axis ${index} precedes all horizontal sizing`);
			}
			assert.ok(events.findIndex(e => e.kind === 'rotate' && e.index === 1) < firstSize);
			assert.equal(events.filter(e => e.kind === 'rotate' && e.index === 1).length, 1);
			assert.equal(events.find(e => e.kind === 'space' && e.index === 2).args[3], dim);
			assert.equal(events.find(e => e.kind === 'space' && e.index === 0).args[3], u.bbox.height);
			assert.notEqual(u.axes[0]._size, 50, 'measured width differs from its provisional hint');
			assert.ok(u._padding[1] > 8, 'selected horizontal labels require overflow padding');
			assert.notEqual(u.bbox.width, dim, 'measurement and overflow change the final width');
			assert.deepEqual(events.filter(e => e.kind === 'width').map(e => e.value), [dim, u.bbox.width],
				'publish only provisional and final widths, not measured width before overflow');
			assert.ok(events.findIndex(e => e.kind === 'width') < events.findIndex(e => e.kind === 'space'),
				'publish provisional width before horizontal selection');
			assert.ok(events.findLastIndex(e => e.kind === 'width') > events.findIndex(e => e.kind === 'sized' && e.index === 0),
				'publish final width after vertical sizing');

			assertFrozenSelection(u, events);
		}
		check();
		const initial = geometry(u);
		const initialRange = { ...u.scales.y._rangeY };
		for (const labels of [['tiny', 'short', 'last'], ['category:'.repeat(3), 'short', 'last']]) {
			categories.labels = labels;
			events.length = 0;
			u.redraw(false, true);
			await Promise.resolve();
			check();
			assert.deepEqual(u.scales.y._rangeY, initialRange, 'actual vertical width never feeds back into the horizontal range');
		}
		assert.deepEqual(geometry(u), initial);
	});

	it('restores finite early-layout geometry after nonpositive provisional widths and final heights', async () => {
		const events = [];
		const u = await earlyRangedChart(events, { labels: ['category:'.repeat(3), 'short', 'last'] });
		const initial = geometry(u);
		const initialRange = { ...u.scales.y._rangeY };
		for (const [width, height] of [[77, 300], [40, 300], [900, 69], [900, 50]]) {
			events.length = 0;
			u.setSize({ width, height });
			await Promise.resolve();
			assert.ok(Object.values(u.bbox).every(Number.isFinite));
			assert.ok(u._padding.every(Number.isFinite));
			for (const axis of u.axes) {
				assert.ok(Number.isFinite(axis._size));
				assert.ok(axis._found.every(Number.isFinite));
				assert.ok(axis._splits.every(Number.isFinite));
			}
			const calls = events.filter(e => e.kind === 'space' && e.index === 1);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].args[3], width - 77);
			if (width <= 77) {
				assert.equal(u.scales.y._rangeY, null);
				assert.deepEqual(u.axes[1]._splits, []);
				assert.deepEqual(u.axes[2]._splits, []);
				assert.equal(events.filter(e => e.kind === 'values' && e.index !== 0).length, 0);
			}
			else {
				assert.ok(u.bbox.height <= 0);
				assert.deepEqual(u.axes[0]._splits, []);
				assert.deepEqual(u.scales.y._rangeY, initialRange);
			}
			assertFrozenSelection(u, events);
			events.length = 0;
			u.setSize({ width: 900, height: 300 });
			await Promise.resolve();
			assert.deepEqual(geometry(u), initial);
			assert.deepEqual(u.scales.y._rangeY, initialRange);
			assertFrozenSelection(u, events);
		}
	});

	it('retains horizontal size callbacks alongside automatic horizontal axes', async () => {
		const events = [];
		const size = function(self, values, index) {
			events.push({ kind: 'size', index, values });
			return 31;
		};
		const u = await chart([
			trackedAxis(events, 2, 'auto'),
			trackedAxis(events, 3, 20),
			trackedAxis(events, 2, size),
		]);
		singlePass(events, 3);
		assert.equal(u.axes[2]._size, 31);
		assert.deepEqual(events.filter(e => e.kind === 'size'), [{ kind: 'size', index: 2, values: null }]);
		assert.equal(events.filter(e => e.kind === 'rotate').length, 2);
		const firstSize = events.findIndex(e => e.kind === 'size');
		for (const index of [0, 2]) {
			for (const kind of ['space', 'incrs', 'splits', 'filter', 'values', 'rotate'])
				assert.ok(events.findIndex(e => e.index === index && e.kind === kind) < firstSize, `${kind} axis ${index} precedes horizontal sizing`);
		}
		assert.ok(firstSize < events.findIndex(e => e.kind === 'space' && e.index === 1));
		assert.equal(u.bbox.height, 300 - u.axes[0]._size - 31);
	});

	it('preserves numeric sizes and callback arguments without horizontal autosizing', async () => {
		const events = [];
		const reserve = function(self, values, index) {
			events.push({ kind: 'size', index, values });
			return 27;
		};
		const u = await chart([
			trackedAxis(events, 2, reserve),
			trackedAxis(events, 3, 37),
			trackedAxis(events, 0, 'auto', { show: false }),
		], { padding: [1, 2, 3, 4] });
		singlePass(events, 2);
		assert.deepEqual(events.find(e => e.kind === 'size'), { kind: 'size', index: 0, values: null });
		assert.equal(events.filter(e => e.kind === 'size').length, 1);
		assert.equal(u.axes[0]._size, 27);
		assert.equal(u.axes[1]._size, 37);
		assert.equal(u.axes[1]._sizeHint, 37);
		assert.ok(events.findIndex(e => e.kind === 'size') < events.findIndex(e => e.kind === 'space'));
		assert.deepEqual(u.bbox, { left: 41, top: 1, width: 357, height: 269 });
		assert.ok(events.findIndex(e => e.kind === 'values' && e.index === 1) < events.findIndex(e => e.kind === 'space' && e.index === 0));
		assert.equal(events.find(e => e.kind === 'space' && e.index === 0).dim, 357);
	});
});
