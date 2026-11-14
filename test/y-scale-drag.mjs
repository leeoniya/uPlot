import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../demos/y-scale-drag.html', import.meta.url), 'utf8');
const source = html.match(/<script type="module">([^]*?)<\/script>/)[1]
	.replace(/import uPlot from "[^"]+";/, '');
const width = 800, height = 400, left = 120, top = 75;

function target() {
	const listeners = new Map();
	return {
		addEventListener(type, fn) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(fn);
		},
		removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
		dispatch(type, event) { for (const fn of listeners.get(type) ?? []) fn(event); },
	};
}

function drag(axisIdx, fraction, pxRatio) {
	const axisEls = [target(), target(), target()];
	const document = { ...target(), body: {} };
	let plot;
	// Exercise the HTML's event handlers with linear scales and explicit CSS geometry.
	class Plot {
		static pxRatio = pxRatio;
		constructor(opts) {
			plot = this;
			this.axes = opts.axes.map((axis, i) => ({ scale: i == 0 ? 'x' : axis.scale }));
			this.scales = { x: { min: 0, max: 4 }, meter: { min: 1, max: 5 }, 'km/h': { min: 3, max: 9 } };
			this.bbox = { width: width * pxRatio, height: height * pxRatio };
			this.over = { getBoundingClientRect: () => ({ left, top, width, height }) };
			this.root = { querySelectorAll: () => axisEls };
			for (const init of opts.hooks.init) init(this);
		}
		posToVal(pos, key) {
			const { min, max } = this.scales[key];
			return key == 'x' ? min + pos / width * (max - min) : max - pos / height * (max - min);
		}
		setScale(key, bounds) { Object.assign(this.scales[key], bounds); }
	}
	runInNewContext(source, { uPlot: Plot, document });
	const key = plot.axes[axisIdx].scale;
	const bounds = plot.scales[key];
	const initial = { ...bounds };
	const x0 = left + fraction * width, y0 = top + fraction * height;
	axisEls[axisIdx].dispatch('mousedown', { clientX: x0, clientY: y0 });
	return {
		bounds, initial,
		move(delta, shiftKey = true) { document.dispatch('mousemove', { clientX: x0 - delta, clientY: y0 + delta, shiftKey }); },
		end() { document.dispatch('mouseup', {}); },
	};
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

describe('Y scale drag demo', () => {
	for (const pxRatio of [1, 2]) {
		for (const axis of [1, 2]) {
			for (const fraction of [0, .25, .5, .75, 1]) {
				for (const delta of [-40, 40]) {
					it(`anchors Y axis ${axis} at ${fraction} during ${delta}px Shift+drag at DPR ${pxRatio}`, () => {
						const { initial, bounds, move } = drag(axis, fraction, pxRatio);
						const span = initial.max - initial.min;
						const anchor = initial.max - fraction * span;
						// Multiple moves must use the original range and anchor, not the updated bounds.
						for (const offset of [delta / 2, delta]) {
							move(offset);
							near(bounds.max - bounds.min, span * (1 + 2 * offset / height));
							near(bounds.max - fraction * (bounds.max - bounds.min), anchor);
						}
					});
				}
			}
		}

		for (const axis of [0, 1, 2]) {
			it(`preserves panning and stops on mouseup for axis ${axis} at DPR ${pxRatio}`, () => {
				const { initial, bounds, move, end } = drag(axis, .25, pxRatio);
				const shift = 40 * (initial.max - initial.min) / (axis == 0 ? width : height);
				move(40, false);
				near(bounds.min, initial.min + shift);
				near(bounds.max, initial.max + shift);
				end();
				move(80, false);
				near(bounds.min, initial.min + shift);
				near(bounds.max, initial.max + shift);
			});
		}

		it(`keeps X-axis Shift+drag centered at DPR ${pxRatio}`, () => {
			const { initial, bounds, move } = drag(0, .25, pxRatio);
			const shift = 40 * (initial.max - initial.min) / width;
			move(40);
			near(bounds.min, initial.min - shift);
			near(bounds.max, initial.max + shift);
		});
	}
});
