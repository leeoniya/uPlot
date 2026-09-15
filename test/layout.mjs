import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 50, 100], [0, 50, 100]];

function axis(events, side, reserve, measured = reserve, extra = {}) {
	return {
		scale: side % 2 ? 'y' : 'x',
		side,
		size(self, values, i) {
			events.push({ type: values === null ? 'reserve' : 'measure', i, values, argc: arguments.length, bbox: cssBox(self) });
			return values === null ? reserve : typeof measured == 'function' ? measured(self, values) : measured;
		},
		space(self, i, min, max, dim) {
			events.push({ type: 'space', i, dim, bbox: cssBox(self) });
			return 50;
		},
		incrs: [1, 2, 5, 10, 20, 50, 100],
		splits(self, i, min, max, incr) {
			const splits = [];
			if (incr > 0) {
				for (let value = Math.ceil(min / incr) * incr; value <= max; value += incr)
					splits.push(value);
			}
			events.push({ type: 'splits', i, splits: splits.slice(), bbox: cssBox(self) });
			return splits;
		},
		values(self, splits, i) {
			const values = splits.map(value => value == null ? null : `a${i}:${value}`);
			events.push({ type: 'values', i, values, bbox: cssBox(self) });
			return values;
		},
		...extra,
	};
}

function padding(events, baseline, overflow = baseline) {
	return baseline.map((value, side) => function(self, i, sides, phase) {
		events.push({
			type: 'padding', i, phase, sides: sides.slice(), argc: arguments.length,
			labels: self.axes.map(axis => axis._values?.slice()),
			splits: self.axes.map(axis => axis._splits?.slice()),
			bbox: cssBox(self), padding: self._padding.slice(),
		});
		return phase == 'overflow' ? typeof overflow == 'function' ? overflow(self, side) : overflow[side] : value;
	});
}

// The shared mock has non-configurable methods/properties. Interpret its per-instance
// log instead of replacing them; consecutive operations are appended to the same entry.
function statefulCanvas(ctx) {
	const defaults = () => ({
		font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000',
		lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
		textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		dash: [], transform: [1, 0, 0, 1, 0, 0], clips: 0,
	});
	let state = defaults();
	const stack = [];
	const draws = [];
	const resets = [];
	const counts = {};
	const snapshot = () => structuredClone(state);

	function operation(name, value) {
		counts[name] = (counts[name] ?? 0) + 1;
		if (name in state)
			state[name] = value;
		else if (name == 'save')
			stack.push(snapshot());
		else if (name == 'restore') {
			if (stack.length)
				state = stack.pop();
		}
		else if (name == 'setLineDash')
			state.dash = value[0].slice();
		else if (name == 'translate') {
			const [a, b, c, d, e, f] = state.transform;
			const [x, y] = value;
			state.transform = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
		}
		else if (name == 'rotate') {
			const [a, b, c, d, e, f] = state.transform;
			const cos = Math.cos(value[0]), sin = Math.sin(value[0]);
			state.transform = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
		}
		else if (name == 'clip')
			state.clips++;
		else if (['clearRect', 'fillText', 'stroke', 'fill'].includes(name))
			draws.push({ name, args: value, state: snapshot() });
	}

	ctx.log.push = function(entry) {
		operation(entry[0], entry[1]);
		Object.defineProperty(entry, 'push', { value(...values) {
			values.forEach(value => operation(entry[0], value));
			return Array.prototype.push.apply(this, values);
		} });
		return Array.prototype.push.call(this, entry);
	};

	// These properties are not instrumented by the shared mock.
	for (const key of ['globalAlpha', 'globalCompositeOperation']) {
		Object.defineProperty(ctx, key, {
			get: () => state[key],
			set: value => { state[key] = value; },
		});
	}
	ctx.measureText = text => ({ width: String(text).length * parseFloat(state.font.match(/[\d.]+px/)[0]) / 2 });

	return {
		draws, resets, counts, snapshot,
		get depth() { return stack.length; },
		reset(key, value) {
			state = defaults();
			stack.length = 0;
			resets.push({ key, value, state: snapshot() });
		},
	};
}

function plot(options = {}, values = data, trackCanvasState = false) {
	const bitmap = { width: [], height: [] };
	const sizes = [];
	let canvasState;
	const u = new uPlot({
		width: 600,
		height: 400,
		pxRatio: 1,
		padding: [0, 0, 0, 0],
		cursor: { show: false },
		legend: { show: false },
		series: [{}, { stroke: 'blue', points: { show: false } }],
		scales: { x: { time: false, range: (self, min, max) => [min, max] }, y: { range: () => [0, 100] } },
		...options,
		hooks: {
			...options.hooks,
			setSize: [...(options.hooks?.setSize ?? []), self => sizes.push({ ...self.bbox })],
		},
	}, values, (self, init) => {
		if (trackCanvasState)
			canvasState = statefulCanvas(self.ctx);
		else
			self.ctx.measureText = text => ({ width: String(text).length * 8 * self.pxRatio });
		// instrument.mjs forwards every canvas dimension assignment to these mock properties.
		// Its canvas accessors are non-configurable; observing the mock avoids global patches.
		for (const key of ['width', 'height']) {
			let value = self.ctx[key];
			Object.defineProperty(self.ctx, key, {
				get: () => value,
				set(next) {
					bitmap[key].push(next);
					value = next;
					canvasState?.reset(key, next);
				},
			});
		}
		document.body.appendChild(self.root);
		init();
	});
	return { u, bitmap, sizes, canvasState };
}

function phaseCheck(u, events) {
	const reserves = events.filter(event => event.type == 'reserve');
	const active = u.axes.map((axis, i) => axis.show && axis._show ? i : null).filter(i => i != null);
	assert.deepEqual(reserves.map(event => event.i).sort((a, b) => a - b),
		active.filter(i => u.axes[i].side % 2 == 0), 'only horizontal axes reserve with null');
	for (const event of reserves)
		assert.equal(event.argc, 3, 'size has no cycleNum argument');

	const baseline = events.filter(event => event.type == 'padding' && event.phase == 'layout');
	const overflow = events.filter(event => event.type == 'padding' && event.phase == 'overflow');
	assert.deepEqual(baseline.map(event => event.i).sort(), [0, 1, 2, 3], 'one baseline call on every side');
	assert.deepEqual(overflow.map(event => event.i).sort(), [1, 3], 'one overflow call on each horizontal edge');
	assert.equal(events.filter(event => event.type == 'padding').length, 6, 'no convergence padding calls');
	for (const event of [...baseline, ...overflow])
		assert.equal(event.argc, 4);

	for (const event of reserves) {
		assert.equal(event.values, null);
		assert.ok(events.indexOf(event) < events.indexOf(baseline[0]), 'horizontal size precedes baseline padding');
	}

	const firstTick = events.findIndex(event => event.type == 'space');
	for (const event of [...reserves, ...baseline])
		assert.ok(events.indexOf(event) < firstTick, 'all reservations and baseline padding precede ticks');

	const verticalDone = [];
	const horizontalStart = [];
	const horizontalDone = [];
	for (const i of active) {
		const calls = events.filter(event => event.i == i && event.type != 'padding');
		const vertical = u.axes[i].side % 2 == 1;
		assert.deepEqual(calls.map(event => event.type), vertical
			? ['space', 'splits', 'values', 'measure']
			: ['reserve', 'space', 'splits', 'values'], `bounded axis ${i} calls in phase order`);
		if (vertical) {
			const measure = calls.at(-1);
			assert.equal(measure.argc, 3, 'measurement has no cycleNum argument');
			assert.ok(Array.isArray(measure.values), 'vertical size never receives null');
			assert.equal(measure.values, calls.find(event => event.type == 'values').values, 'measure the formatter result itself');
			assert.equal(measure.values, u.axes[i]._values, 'measure current vertical labels');
			verticalDone.push(events.indexOf(measure));
		}
		else {
			horizontalStart.push(events.indexOf(calls[1]));
			horizontalDone.push(events.indexOf(calls.at(-1)));
		}
	}
	if (verticalDone.length && horizontalStart.length)
		assert.ok(Math.max(...verticalDone) < Math.min(...horizontalStart), 'all vertical widths precede any horizontal ticks');
	for (const event of overflow)
		assert.ok(events.indexOf(event) > Math.max(...horizontalDone), 'overflow follows all horizontal labels');
}

function cssBox(u) {
	return Object.fromEntries(Object.entries(u.bbox).map(([key, value]) => [key, value / u.pxRatio]));
}

function geometry(u) {
	return {
		bbox: { ...u.bbox },
		padding: u._padding.slice(),
		axes: u.axes.map(axis => ({ size: axis._size, pos: axis._pos, splits: axis._splits?.slice(), values: axis._values?.slice() })),
	};
}

function committedState(u) {
	const canvas = u.root.querySelector('canvas');
	return {
		geometry: geometry(u),
		dom: u.root.outerHTML,
		canvas: [canvas.width, canvas.height],
		transforms: ['x', 'y'].map(scale => [false, true].map(canvasPixels =>
			[0, 50, 100].map(value => u.valToPos(value, scale, canvasPixels)))),
		inverse: ['x', 'y'].map(scale => [false, true].map(canvasPixels =>
			[0, 50, 100].map(pos => u.posToVal(pos, scale, canvasPixels)))),
	};
}

function assertBitmap(bitmap, width, height) {
	assert.deepEqual(bitmap.width, width, 'canvas width assignments');
	assert.deepEqual(bitmap.height, height, 'canvas height assignments');
}

describe('single-pass layout', () => {
	it('runs the autosize demo through nine growth intervals and a deterministic shrink reset', async () => {
		const html = readFileSync(new URL('../demos/axis-autosize.html', import.meta.url), 'utf8');
		const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		assert.ok(script, 'demo has an inline script');
		for (const pxRatio of [1, 2]) {
			let u, canvasState, tick;
			const cleared = [];
			try {
				const demo = runInNewContext(script + '\n({ get mult() { return mult; }, reset() { mult = 1; u.setData(getData(points, mult)); } });', {
					document,
					Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
					setInterval(callback, delay) { assert.equal(delay, 500); assert.equal(tick, undefined); tick = callback; return 42; },
					clearInterval(id) { cleared.push(id); },
					uPlot: function(opts, values, target) {
						u = new uPlot({ ...opts, pxRatio }, values, target);
						canvasState = statefulCanvas(u.ctx);
						for (const key of ['width', 'height']) {
							let value = u.ctx[key];
							Object.defineProperty(u.ctx, key, {
								get: () => value,
								set(next) { value = next; canvasState.reset(key, next); },
							});
						}
						return u;
					},
				}, { filename: 'axis-autosize.html', timeout: 1000 });
				await Promise.resolve();
				const initial = geometry(u);
				const height = u.axes[0]._size;
				function checkLayout() {
					const [hz, vt] = u.axes;
					const labelWidth = (axis, value) => String(value).length * axis.font[1] / pxRatio / 2;
					const maxWidth = axis => Math.max(0, ...axis._values.filter(value => value != null).map(value => labelWidth(axis, value)));
					assert.equal(vt._size, Math.ceil(vt.ticks.size + vt.gap + maxWidth(vt)), 'vertical width measures current labels');
					assert.equal(u._padding[1], Math.max(8, Math.ceil(maxWidth(hz) / 2 + 4)), 'right padding is a total in CSS pixels');
					assert.equal(hz._size, height, 'horizontal reservation stays fixed');
					assert.equal(u.bbox.height, initial.bbox.height);
					assert.ok(Object.values(u.bbox).every(Number.isFinite));
					const text = canvasState.draws.filter(draw => draw.name == 'fillText');
					assert.ok(text.length > 0);
					for (const draw of text) {
						assert.ok(draw.args.slice(1, 3).every(Number.isFinite), 'label coordinates are finite');
						assert.ok(draw.state.transform.every(Number.isFinite));
					}
					for (let i = 0; i < hz._values.length; i++) {
						const value = hz._values[i];
						if (value == null) continue;
						const draw = text.find(draw => draw.args[0] == String(value) && draw.state.textAlign == 'center' && draw.state.textBaseline == 'top');
						assert.ok(draw, `horizontal label ${value} is drawn`);
						assert.equal(draw.args[1], Math.round(u.valToPos(hz._splits[i], hz.scale, true)), 'drawing uses final geometry');
						assert.ok(draw.args[1] / pxRatio + labelWidth(hz, value) / 2 <= u.width, 'horizontal label fits the right edge');
					}
					assert.equal(canvasState.depth, 0, 'demo measurement restores canvas state');
				}
				checkLayout();
				assert.equal(demo.mult, 1);
				for (let i = 1; i <= 9; i++) {
					canvasState.draws.length = 0;
					tick();
					await Promise.resolve();
					assert.equal(demo.mult, 10 ** i);
					assert.deepEqual(cleared, i == 9 ? [42] : []);
					checkLayout();
				}
				canvasState.draws.length = 0;
				demo.reset();
				await Promise.resolve();
				assert.equal(demo.mult, 1);
				checkLayout();
				assert.deepEqual(geometry(u), initial, 'shrinking restores the original deterministic layout');
			}
			finally { u?.destroy(); }
		}
	});

	it('orders initial hooks around layout and initializes even a default-size bitmap once', async () => {
		const events = [];
		const hook = name => self => events.push({ type: 'hook', name, status: self.status, bbox: { ...self.bbox } });
		const suppliedSizeHooks = [hook('setSize:first'), hook('setSize:second')];
		const { u, bitmap, sizes, canvasState } = plot({
			width: 300, height: 150,
			axes: [axis(events, 2, 30), axis(events, 3, 10, 60)],
			padding: padding(events, [5, 7, 11, 13]),
			hooks: {
				init: [self => {
					hook('init')(self);
					const can = self.root.querySelector('canvas');
					assert.equal(can.width, 300);
					assert.equal(can.height, 150);
					// Bitmap initialization must clear pre-init state and the save stack.
					self.ctx.save();
					self.ctx.font = '42px serif';
					self.ctx.globalAlpha = 0.25;
				}],
				setData: [hook('setData')],
				setScale: [(self, key) => hook(`setScale:${key}`)(self)],
				setSize: suppliedSizeHooks,
				drawClear: [hook('drawClear')],
				drawAxes: [hook('drawAxes')],
				drawSeries: [hook('drawSeries')],
				draw: [hook('draw')],
				ready: [hook('ready')],
			},
		}, data, true);
		try {
			assert.deepEqual(events.map(event => event.name), ['init', 'setData'], 'layout waits for the initial commit');
			assertBitmap(bitmap, [], []);
			assert.deepEqual(u.bbox, { left: 0, top: 0, width: 0, height: 0 }, 'bbox starts at zero until the first commit');
			assert.deepEqual([u.width, u.height], [300, 150], 'outer dimensions are available immediately');
			for (const event of events)
				assert.deepEqual(event.bbox, u.bbox, `${event.name} sees the initial zero bbox`);
			await Promise.resolve();
			phaseCheck(u, events);
			const hooks = events.filter(event => event.type == 'hook');
			assert.deepEqual(hooks.map(event => event.name), [
				'init', 'setData', 'setScale:x', 'setScale:y', 'setSize:first', 'setSize:second',
				'drawClear', 'drawAxes', 'drawSeries', 'draw', 'ready',
			]);
			const firstReserve = events.findIndex(event => event.type == 'reserve');
			assert.ok(events.findIndex(event => event.name == 'setScale:y') < firstReserve);
			const lastOverflow = events.findLastIndex(event => event.phase == 'overflow');
			assert.ok(lastOverflow < events.findIndex(event => event.name == 'setSize:first'));
			assert.ok(hooks.slice(0, -1).every(event => event.status == 0));
			assert.equal(hooks.at(-1).status, 1);
			for (const event of hooks.slice(4))
				assert.deepEqual(event.bbox, u.bbox, `${event.name} observes final geometry`);
			assert.deepEqual(sizes, [u.bbox], 'helper recorder coexists with supplied hooks');
			assert.equal(suppliedSizeHooks.length, 2, 'helper does not mutate the supplied hook array');
			assertBitmap(bitmap, [300], [150]);
			assert.equal(canvasState.resets.length, 2);
			assert.equal(canvasState.depth, 0);
			const cleared = canvasState.draws.find(draw => draw.name == 'clearRect').state;
			assert.equal(cleared.font, '10px sans-serif');
			assert.equal(cleared.globalAlpha, 1);
			events.length = bitmap.width.length = bitmap.height.length = 0;
			u.setSize({ width: 300, height: 150 });
			await Promise.resolve();
			assertBitmap(bitmap, [], []);
			assert.equal(canvasState.resets.length, 2, 'same-size setSize does not reset initialized context');
			assert.equal(sizes.length, 1);
			assert.deepEqual(events, [], 'identical setSize has no hooks, draw, or layout callbacks');
		}
		finally { u.destroy(); }
	});

	it('preserves measured canvas state and reapplies drawing styles after actual bitmap resets', async () => {
		const events = [];
		let extraWidth = 0;
		let tracker;
		const measured = [];
		function measure(self, axisIdx, values) {
			const ctx = self.ctx;
			const before = tracker.snapshot();
			ctx.save();
			try {
				ctx.font = self.axes[axisIdx].font[0];
				ctx.fillStyle = 'orange';
				ctx.globalAlpha = 0.25;
				ctx.globalCompositeOperation = 'xor';
				ctx.translate(7, 9);
				ctx.setLineDash([9, 3]);
				const widths = values.map(value => ctx.measureText(value).width);
				measured.push({ axisIdx, values: values.slice(), widths });
				return Math.max(0, ...widths) / self.pxRatio;
			}
			finally {
				ctx.restore();
				assert.deepEqual(tracker.snapshot(), before, 'measurement restores font, paint, dash, and transform');
			}
		}
		const { u, bitmap, sizes, canvasState } = plot({
			// The first and last drawn axes share a font. On unchanged relayout the
			// first axis relies on the cache surviving the smaller-font overflow measure.
			axes: [
				axis(events, 3, 10, (self, values) => 10 + extraWidth + measure(self, 0, values), { font: '20px serif' }),
				axis(events, 2, 30, 30, { font: '12px sans-serif' }),
				axis(events, 0, 30, 30, { font: '20px serif' }),
			],
			padding: padding(events, [0, 5, 0, 5], self => 5 + measure(self, 1, self.axes[1]._values) / 2),
			series: [{}, { stroke: 'blue', width: 2, dash: [4, 2], cap: 'round', alpha: 0.6, points: { show: false } }],
		}, data, true);
		tracker = canvasState;
		function checkFrame() {
			for (const [i, axis] of u.axes.entries()) {
				const labels = tracker.draws.filter(draw => draw.name == 'fillText' && String(draw.args[0]).startsWith(`a${i}:`));
				assert.equal(labels.length, axis._values.length);
				for (const draw of labels) {
					assert.equal(draw.state.font, axis.font[0], 'draw uses the axis font, not the last measured font');
					assert.equal(draw.state.globalAlpha, 1);
					assert.equal(draw.state.fillStyle, axis.stroke(u, i));
					assert.deepEqual(draw.state.transform, [1, 0, 0, 1, 0, 0]);
					assert.equal(draw.state.clips, 0);
				}
			}
			const strokes = tracker.draws.filter(draw => draw.name == 'stroke' && draw.state.strokeStyle == 'blue');
			assert.ok(strokes.length > 0);
			for (const draw of strokes) {
				assert.equal(draw.state.lineWidth, 2);
				assert.equal(draw.state.lineCap, 'round');
				assert.equal(draw.state.globalAlpha, 0.6);
				assert.deepEqual(draw.state.dash, [4, 2]);
			}
			for (const { axisIdx, values, widths } of measured)
				assert.deepEqual(widths, values.map(value => String(value).length * u.axes[axisIdx].font[1] / 2), 'measureText uses the selected font');
			assert.equal(tracker.depth, 0);
			assert.equal(tracker.snapshot().globalAlpha, 1);
			assert.equal(tracker.snapshot().clips, 0);
			assert.deepEqual(tracker.snapshot().transform, [1, 0, 0, 1, 0, 0]);
		}
		try {
			await Promise.resolve();
			assertBitmap(bitmap, [600], [400]);
			checkFrame();
			for (const step of ['unchanged layout', 'internal resize', 'same-size setSize', 'fractional resize', 'width resize', 'height resize']) {
				u.ctx.globalCompositeOperation = 'multiply';
				const before = tracker.snapshot();
				const box = { ...u.bbox };
				const resets = tracker.resets.length;
				const hookCount = sizes.length;
				const fonts = tracker.counts.font;
				events.length = 0;
				bitmap.width.length = bitmap.height.length = tracker.draws.length = measured.length = 0;
				if (step == 'internal resize')
					extraWidth = 20;
				if (step == 'unchanged layout' || step == 'internal resize')
					u.redraw(false, true);
				else
					u.setSize({ width: step == 'width resize' ? 640 : step == 'fractional resize' ? u.width + 0.1 : u.width, height: step == 'height resize' ? 420 : u.height });
				await Promise.resolve();
				const resized = step == 'width resize' || step == 'height resize';
				assertBitmap(bitmap, step == 'width resize' ? [640] : [], step == 'height resize' ? [420] : []);
				assert.equal(tracker.resets.length, resets + Number(resized), step);
				assert.equal(sizes.length, hookCount + Number(step != 'unchanged layout' && step != 'same-size setSize'), step);
				if (step == 'same-size setSize') {
					assert.deepEqual(events, []);
					assert.deepEqual(tracker.draws, []);
					assert.deepEqual(measured, []);
					assert.equal(tracker.counts.font, fonts);
					assert.deepEqual(tracker.snapshot(), before);
					continue;
				}
				assert.equal(measured.length, 3, 'one vertical and two overflow measurements per layout');
				assert.equal(tracker.counts.font - fonts, resized ? 6 : 5,
					'three measurement assignments plus two drawing changes; only a bitmap reset requires the first axis font again');
				if (step == 'internal resize')
					assert.notDeepEqual(u.bbox, box, 'internal geometry really changed');
				const clear = tracker.draws.find(draw => draw.name == 'clearRect');
				if (resized)
					assert.deepEqual(clear.state, tracker.resets.at(-1).state, 'resize clears real state before drawing');
				else
					assert.deepEqual(clear.state, before, 'relayout and same-size setSize retain context state');
				assert.deepEqual(clear.args, [0, 0, Math.round(u.width * u.pxRatio), Math.round(u.height * u.pxRatio)]);
				checkFrame();
				assert.equal(tracker.snapshot().globalCompositeOperation, resized ? 'source-over' : 'multiply');
			}
		}
		finally { u.destroy(); }
	});

	it('reserves top and bottom, measures all vertical axes, then selects horizontal ticks once', async () => {
		const events = [];
		const { u } = plot({
			axes: [
				axis(events, 2, 30, 999, { label: 'bottom', labelSize: 12 }),
				axis(events, 3, 10, 60, { label: 'left', labelSize: 8 }),
				axis(events, 1, 10, 40, { label: 'right', labelSize: 6 }),
				axis(events, 0, 20, 999, { label: 'top', labelSize: 10 }),
				axis(events, 3, 10, 25, { label: 'outer left', labelSize: 4 }),
				axis(events, 1, 500, 500, { show: false }),
			],
			padding: padding(events, [5, 7, 11, 13]),
		});
		try {
			await Promise.resolve();
			for (let pass = 0; pass < 2; pass++) {
				phaseCheck(u, events);
				assert.deepEqual(cssBox(u), { left: 110, top: 35, width: 437, height: 312 });
				for (const event of events.filter(event => event.type == 'space'))
					assert.equal(event.dim, u.axes[event.i].side % 2 ? 312 : 437, `axis ${event.i} tick-selection dimension`);
				assert.deepEqual(u.axes.slice(0, 5).map(axis => axis._pos), [347, 110, 547, 35, 42]);
				assert.ok(!events.some(event => event.i == 5), 'hidden axis has no callbacks');
				events.length = 0;
				if (pass == 0) {
					u.redraw(false, true);
					await Promise.resolve();
				}
			}
		}
		finally { u.destroy(); }
	});

	it('keeps callback axes participating and plot height fixed regardless of measured width', async () => {
		for (const [reserve, measured, pad] of [[0, 70, 17], [20, 0, 17]]) {
			const events = [];
			const { u } = plot({
				axes: [axis(events, 2, 0, 0, { size: 0 }), axis(events, 3, reserve, measured)],
				padding: [0, 1, 2, 3].map(side => (self, i, sides, phase) => {
					events.push({ i, sides: sides.slice(), phase });
					return side % 2 == 0 && sides[3] ? 17 : 0;
				}),
			});
			try {
				await Promise.resolve();
				assert.deepEqual(events.filter(event => event.phase == 'layout').map(event => event.sides),
					Array.from({ length: 4 }, () => [false, false, false, true]));
				assert.equal(u.axes[0]._size, 0, 'numeric size: 0 reserves no height');
				assert.ok(u.axes[0]._splits.length > 0, 'numeric size: 0 still selects ticks');
				assert.equal(u.axes[1]._size, measured);
				assert.deepEqual(cssBox(u), { left: measured, top: pad, width: 600 - measured, height: 400 - 2 * pad });
				const vertical = events.filter(event => event.i == 1 && ['space', 'splits', 'values', 'measure'].includes(event.type));
				assert.deepEqual(vertical.map(event => event.type), ['space', 'splits', 'values', 'measure']);
				assert.ok(vertical.every(event => event.bbox.height == 400 - 2 * pad),
					'height is published before vertical callbacks and cannot change after measurement');
				assert.ok(vertical.every(event => event.bbox.width == 0), 'vertical callbacks see the initial completed width, not a reservation guess');
				assert.equal(vertical[0].dim, 400 - 2 * pad);
			}
			finally { u.destroy(); }
		}
	});

	it('derives side participation from configured size and labels, not callback results', async () => {
		const cases = [
			{ name: 'numeric zero', extra: { size: 0 }, participates: false },
			{ name: 'positive numeric', extra: { size: 12 }, participates: true },
			{ name: 'callback returning zero', extra: {}, participates: true },
			{ name: 'label with numeric zero', extra: { size: 0, label: 'axis', labelSize: 12 }, participates: true },
			{ name: 'zero-size label', extra: { size: 0, label: 'axis', labelSize: 0 }, participates: false },
			{ name: 'labelSize without label', extra: { size: 0, labelSize: 12 }, participates: false },
			{ name: 'hidden positive numeric with label', extra: { size: 12, show: false, label: 'axis', labelSize: 12 }, participates: false },
			{ name: 'hidden callback with label', extra: { show: false, label: 'axis', labelSize: 12 }, participates: false },
			{ name: 'inactive callback with label', extra: { scale: 'inactive', label: 'axis', labelSize: 12 }, participates: false },
		];
		for (const side of [0, 1, 2, 3]) {
			for (const { name, extra, participates } of cases) {
				const events = [];
				const { u } = plot({
					scales: { x: { time: false, range: () => [0, 100] }, y: { range: () => [0, 100] }, inactive: {} },
					axes: [axis(events, side, 0, 0, extra), { show: false }],
					padding: padding(events, [0, 0, 0, 0]),
				});
				try {
					await Promise.resolve();
					for (let pass = 0; pass < 2; pass++) {
						const expected = [false, false, false, false];
						expected[side] = participates;
						const pads = events.filter(event => event.type == 'padding');
						assert.equal(pads.length, 6);
						for (const event of pads)
							assert.deepEqual(event.sides, expected, `${name}, side ${side}, ${event.phase}, pass ${pass}`);
						if (extra.show === false || extra.scale == 'inactive')
							assert.ok(!events.some(event => event.type != 'padding'), 'hidden/inactive axes have no callbacks');
						else if (extra.size == null) {
							assert.equal(u.axes[0]._size, 0);
							assert.equal(events.filter(event => event.type == (side % 2 ? 'measure' : 'reserve')).length, 1);
						}
						if (pass == 0) {
							events.length = 0;
							u.redraw(false, true);
							await Promise.resolve();
						}
					}
				}
				finally { u.destroy(); }
			}
		}
	});

	it('exposes current horizontal labels to overflow, freezes ticks, and draws at final positions', async () => {
		const events = [];
		const { u } = plot({
			axes: [axis(events, 2, 30), axis(events, 3, 10, 60), axis(events, 0, 20)],
			padding: padding(events, [5, 10, 5, 10], (self, side) => {
				const labels = self.axes[0]._values ?? [];
				return 10 + (side == 3 ? 1 : 2) * Math.max(0, ...labels.map(label => self.ctx.measureText(label).width));
			}),
		});
		try {
			await Promise.resolve();
			for (const max of [100, 50]) {
				if (max != 100) {
					events.length = 0;
					u.ctx.log.length = 0;
					u.setScale('x', { min: 0, max });
					await Promise.resolve();
				}
				phaseCheck(u, events);
				for (const event of events.filter(event => event.type == 'space' && u.axes[event.i].side % 2 == 0))
					assert.equal(event.dim, 520, 'horizontal selection uses baseline padding');
				const overflow = events.filter(event => event.phase == 'overflow');
				assert.deepEqual(overflow.map(event => event.padding), [[5, 10, 5, 10], [5, 10, 5, 10]],
					'both overflow callbacks see baseline totals, not the first callback result');
				assert.deepEqual(overflow.map(event => event.bbox), Array.from({ length: 2 }, () =>
					({ left: 70, top: 25, width: 520, height: 340 })), 'overflow shares provisional geometry');
				for (const event of overflow) {
					for (const i of [0, 2]) {
						assert.deepEqual(event.labels[i], u.axes[i]._values, 'overflow sees this update, not previous labels');
						assert.deepEqual(event.splits[i], u.axes[i]._splits, 'overflow does not trigger tick reselection');
					}
				}
				const labelWidth = Math.max(...u.axes[0]._values.map(label => label.length * 8));
				assert.deepEqual(cssBox(u), { left: 70 + labelWidth, top: 25, width: 520 - 3 * labelWidth, height: 340 });
				assert.equal(u.axes[0]._found[0], max == 100 ? 10 : 5, 'baseline-width increment stays frozen');
				const drawn = u.ctx.log.filter(entry => entry[0] == 'fillText').flatMap(entry => entry.slice(1));
				for (const i of [0, 2]) {
					const axis = u.axes[i];
					for (let j = 0; j < axis._splits.length; j++) {
						const text = drawn.find(args => args[0] == axis._values[j]);
						assert.ok(text, `drawn label ${axis._values[j]}`);
						const expected = Math.round(u.bbox.left + axis._splits[j] / max * u.bbox.width);
						assert.equal(text[1], expected, 'tick position uses final bbox, not selection width');
						assert.equal(u.valToPos(axis._splits[j], 'x', true), u.bbox.left + axis._splits[j] / max * u.bbox.width);
					}
				}
			}
		}
		finally { u.destroy(); }
	});

	it('publishes height before vertical callbacks, baseline width before horizontal callbacks, and final width after overflow', async () => {
		for (const pxRatio of [1, 2]) {
			const events = [];
			let measured = 60;
			const { u } = plot({
				pxRatio,
				axes: [axis(events, 2, 30), axis(events, 3, 999, () => measured), axis(events, 1, 777, 20)],
				padding: padding(events, [5, 7, 11, 13], [5, 27, 11, 33]),
			});
			try {
				let lastWidth = 0;
				for (const [width, height, nextMeasured] of [[600, 400, 60], [700, 450, 90], [620, 410, 0]]) {
					if (u.status == 1) {
						events.length = 0;
						measured = nextMeasured;
						u.setSize({ width, height });
						assert.equal(cssBox(u).width, lastWidth, 'setSize leaves completed geometry visible');
					}
					await Promise.resolve();
					phaseCheck(u, events);
					const plotHeight = height - 30 - 5 - 11;
					const baselineWidth = width - measured - 20 - 7 - 13;
					for (const event of events.filter(event => ['space', 'splits', 'values', 'measure'].includes(event.type))) {
						assert.equal(event.bbox.height, plotHeight, 'published height is final throughout tick selection');
						assert.equal(event.bbox.width, event.i == 0 ? baselineWidth : lastWidth,
							`axis ${event.i} ${event.type} observes its directional stage, not a provisional vertical width`);
					}
					for (const event of events.filter(event => event.phase == 'overflow'))
						assert.equal(event.bbox.width, baselineWidth);
					assert.equal(cssBox(u).width, baselineWidth - 40, 'overflow publishes final width without selecting ticks again');
					assert.equal(cssBox(u).height, plotHeight);
					lastWidth = cssBox(u).width;
				}
			}
			finally { u.destroy(); }
		}
	});

	it('measures formatted vertical labels including null entries, and measures [] when no ticks are selected', async () => {
		const events = [];
		let noTicks = false;
		const vertical = axis(events, 3, 999, 40, {
			filter: (self, splits) => splits.map((value, i) => i % 2 ? null : value),
		});
		const select = vertical.splits;
		vertical.splits = function(...args) {
			if (!noTicks)
				return select(...args);
			events.push({ type: 'splits', i: args[1], splits: [], bbox: cssBox(args[0]) });
			return [];
		};
		const { u } = plot({ axes: [axis(events, 2, 30), vertical], padding: padding(events, [0, 0, 0, 0]) });
		try {
			await Promise.resolve();
			for (const empty of [false, true, false]) {
				if (empty || noTicks) {
					events.length = 0;
					noTicks = empty;
					u.redraw(false, true);
					await Promise.resolve();
				}
				phaseCheck(u, events);
				const measurement = events.find(event => event.type == 'measure');
				if (empty)
					assert.deepEqual(measurement.values, []);
				else {
					assert.ok(measurement.values.includes(null));
					assert.ok(measurement.values.some(value => typeof value == 'string' && value.startsWith('a1:')));
				}
			}
		}
		finally { u.destroy(); }
	});

	it('defers geometry, transforms, DOM, canvas, and paths until a single final resize commit, including synchronous batch', async () => {
		for (const mode of ['queued', 'batch']) {
			for (const pxRatio of [1, 1.25, 2]) {
				for (const [width, height] of [[640, 420], [600, 400], [600.1, 400.1]]) {
					const events = [];
					const { u, bitmap, sizes, canvasState } = plot({
						pxRatio,
						axes: [axis(events, 2, 30), axis(events, 3, 40)],
						padding: padding(events, [0, 0, 0, 0]),
						hooks: { draw: [() => events.push({ type: 'draw' })] },
					}, data, true);
					try {
						await Promise.resolve();
						const before = committedState(u);
						const paths = u.series[1]._paths;
						assert.ok(paths);
						const counts = { ...canvasState.counts };
						events.length = sizes.length = bitmap.width.length = bitmap.height.length = 0;
						const resize = () => {
							for (const [nextWidth, nextHeight] of [[620, 410], [680, 460], [width, height], [width, height]]) {
								u.setSize({ width: nextWidth, height: nextHeight });
								assert.deepEqual([u.width, u.height], [nextWidth, nextHeight], 'outer CSS dimensions update immediately');
								assert.deepEqual(committedState(u), before, `${mode}: no intermediate layout or DOM publication`);
								assert.equal(u.series[1]._paths, paths, 'pending resize retains completed paths');
								assert.deepEqual(canvasState.counts, counts, 'pending resize performs no canvas operations');
								assert.deepEqual(events, []);
								assert.deepEqual(sizes, []);
								assertBitmap(bitmap, [], []);
							}
						};
						if (mode == 'batch')
							u.batch(resize);
						else {
							resize();
							await Promise.resolve();
						}
						// In batch mode every assertion here runs before yielding to a microtask.
						phaseCheck(u, events.filter(event => event.type != 'draw'));
						assert.equal(events.filter(event => event.type == 'draw').length, 1, 'only the final requested geometry is drawn');
						assert.deepEqual(sizes, [u.bbox], 'outer dirty state fires one hook even when resizing back to the completed size');
						const roundHalf = value => Math.round(value * pxRatio * 2) / 2;
						assert.deepEqual(u.bbox, { left: roundHalf(40), top: 0, width: roundHalf(width - 40), height: roundHalf(height - 30) });
						assert.equal(u.valToPos(100, 'x'), width - 40, 'CSS transform uses the final unrounded width');
						assert.equal(u.valToPos(0, 'y'), height - 30, 'CSS transform uses the final unrounded height');
						assert.equal(u.posToVal(width - 40, 'x'), 100);
						assert.equal(u.posToVal(height - 30, 'y'), 0);
						assert.equal(parseFloat(u.over.style.width), width - 40, 'DOM retains fractional CSS width');
						assert.equal(parseFloat(u.over.style.height), height - 30, 'DOM retains fractional CSS height');
						assert.equal(parseFloat(u.over.parentElement.style.width), width);
						assert.equal(parseFloat(u.over.parentElement.style.height), height);
						assertBitmap(bitmap,
							Math.round(width * pxRatio) == 600 * pxRatio ? [] : [Math.round(width * pxRatio)],
							Math.round(height * pxRatio) == 400 * pxRatio ? [] : [Math.round(height * pxRatio)]);
						assert.equal(canvasState.counts.font - counts.font, Number(bitmap.width.length + bitmap.height.length > 0),
							'the shared axis font stays cached unless the final backing dimensions actually reset');
						if (width == 600 && height == 400) {
							assert.deepEqual(committedState(u), before, 'resize-back preserves final geometry, DOM, and transforms');
							assert.equal(u.series[1]._paths, paths, 'resize-back never invalidates paths for intermediate geometry');
						}
						else
							assert.notEqual(u.series[1]._paths, paths, 'changed CSS geometry invalidates paths even when rounded bbox/backing dimensions are unchanged');
						const completed = committedState(u);
						const completedCounts = { ...canvasState.counts };
						const completedEvents = events.slice();
						await Promise.resolve();
						assert.deepEqual(committedState(u), completed);
						assert.deepEqual(canvasState.counts, completedCounts, 'batch leaves no second draw queued');
						assert.deepEqual(events, completedEvents, 'no second layout after commit');
					}
					finally { u.destroy(); }
				}
			}
		}
	});

	it('coalesces fractional CSS resizes and pixel-ratio changes into one final backing resize', async () => {
		for (const mode of ['queued', 'batch']) {
			const events = [];
			const { u, bitmap, sizes, canvasState } = plot({
				width: 600.1, height: 400.1, pxRatio: 1.25,
				axes: [axis(events, 2, 30), axis(events, 3, 40)],
				padding: padding(events, [0, 0, 0, 0]),
				hooks: { draw: [() => events.push({ type: 'draw' })] },
			}, data, true);
			try {
				await Promise.resolve();
				const bbox = { ...u.bbox };
				const dom = u.root.outerHTML;
				const paths = u.series[1]._paths;
				const counts = { ...canvasState.counts };
				events.length = sizes.length = bitmap.width.length = bitmap.height.length = 0;
				const resize = () => {
					for (const [width, height, ratio] of [[680.1, 440.1, 3], [620.1, 410.1, 1.25], [640.1, 420.1, 2]]) {
						u.setSize({ width, height });
						u.setPxRatio(ratio);
						assert.deepEqual([u.width, u.height, u.pxRatio], [width, height, ratio]);
						assert.deepEqual(u.bbox, bbox, 'pending DPR changes do not publish intermediate geometry');
						assert.equal(u.root.outerHTML, dom);
						assert.deepEqual(events, []);
						assert.deepEqual(sizes, []);
						assert.deepEqual(canvasState.counts, counts);
						assertBitmap(bitmap, [], []);
					}
				};
				if (mode == 'batch')
					u.batch(resize);
				else {
					resize();
					await Promise.resolve();
				}
				phaseCheck(u, events.filter(event => event.type != 'draw'));
				assert.deepEqual(u.bbox, { left: 80, top: 0, width: 1200, height: 780 });
				assertBitmap(bitmap, [1280], [840]);
				assert.equal(u.axes[0].font[1], 24, 'font uses only the final DPR');
				assert.equal(parseFloat(u.over.parentElement.style.width), 640.1);
				assert.equal(parseFloat(u.over.parentElement.style.height), 420.1);
				assert.notEqual(u.series[1]._paths, paths);
				assert.deepEqual(sizes, [u.bbox]);
				assert.equal(events.filter(event => event.type == 'draw').length, 1);
				const completedCounts = { ...canvasState.counts };
				await Promise.resolve();
				assert.deepEqual(canvasState.counts, completedCounts, 'synchronous batch does not leave a second frame queued');
			}
			finally { u.destroy(); }
		}
	});

	it('flushes an already queued resize once in batch, including deferred hooks and resize-back', async () => {
		for (const deferHooks of [false, true]) {
			const hooks = [];
			const { u, sizes, bitmap, canvasState } = plot({
				hooks: { setSize: [() => hooks.push('size')], draw: [() => hooks.push('draw')] },
			}, data, true);
			try {
				await Promise.resolve();
				const bbox = { ...u.bbox };
				const clears = canvasState.counts.clearRect;
				hooks.length = sizes.length = bitmap.width.length = bitmap.height.length = 0;
				u.setSize({ width: 640, height: 420 });
				u.batch(() => u.setSize({ width: 600, height: 400 }), deferHooks);
				assert.deepEqual(u.bbox, bbox);
				assert.equal(canvasState.counts.clearRect, clears + 1, 'batch draws synchronously');
				assert.deepEqual(hooks, deferHooks ? [] : ['size', 'draw']);
				await Promise.resolve();
				assert.equal(canvasState.counts.clearRect, clears + 1, 'the obsolete callback must not draw again');
				assert.deepEqual(hooks, ['size', 'draw'], 'deferred hooks flush exactly once');
				assert.deepEqual(sizes, [bbox], 'coalesced resize-back emits one size notification');
				assertBitmap(bitmap, [], []);
				u.redraw(false);
				await Promise.resolve();
				assert.equal(canvasState.counts.clearRect, clears + 2, 'subsequent queued work still runs');
				assert.deepEqual(hooks, ['size', 'draw', 'draw']);
			}
			finally { u.destroy(); }
		}
	});

	it('does not let an obsolete batch callback consume work queued after the batch', async () => {
		const events = [];
		const { u } = plot({ hooks: { draw: [() => events.push('draw')] } });
		try {
			await Promise.resolve();
			events.length = 0;
			u.redraw(false, true);
			u.batch(() => u.setSize({ width: 640, height: 420 }));
			assert.deepEqual(events, ['draw']);
			events.length = 0;
			queueMicrotask(() => events.push('marker'));
			u.redraw(false, true);
			await Promise.resolve();
			assert.deepEqual(events, ['marker', 'draw'], 'fresh work retains its microtask order and runs once');
			await Promise.resolve();
			assert.deepEqual(events, ['marker', 'draw']);
		}
		finally { u.destroy(); }
	});

	it('grows and shrinks deterministically, invalidates paths only when needed, and never resizes the bitmap internally', async () => {
		const events = [];
		let width = 40;
		const { u, bitmap, sizes } = plot({ axes: [axis(events, 2, 30), axis(events, 3, 10, () => width)] });
		try {
			await Promise.resolve();
			assertBitmap(bitmap, [600], [400]);
			bitmap.width.length = bitmap.height.length = sizes.length = 0;
			const states = new Map();
			let previous = width;
			let hookCount = 0;
			for (const next of [40, 90, 90, 20, 90, 40, 20, 20]) {
				const paths = u.series[1]._paths;
				assert.ok(paths, 'a drawable series has cached paths');
				width = next;
				u.redraw(false, true);
				await Promise.resolve();
				assert.deepEqual(cssBox(u), { left: width, top: 0, width: 600 - width, height: 370 });
				if (next == previous)
					assert.equal(u.series[1]._paths, paths, 'unchanged geometry retains paths');
				else {
					assert.notEqual(u.series[1]._paths, paths, 'changed geometry rebuilds paths even with redraw(false)');
					hookCount++;
				}
				assert.equal(sizes.length, hookCount, 'setSize hook fires only on geometry changes');
				assertBitmap(bitmap, [], []);
				if (states.has(next))
					assert.deepEqual(geometry(u), states.get(next), 'layout does not depend on previous widths');
				else
					states.set(next, geometry(u));
				previous = next;
			}
			const paths = u.series[1]._paths;
			const caches = u.axes.map(axis => [axis._splits, axis._values, axis._found]);
			events.length = 0;
			u.redraw(false, false);
			await Promise.resolve();
			assert.deepEqual(events, [], 'paint-only redraw keeps axis caches');
			u.axes.forEach((axis, i) => {
				assert.equal(axis._splits, caches[i][0]);
				assert.equal(axis._values, caches[i][1]);
				assert.equal(axis._found, caches[i][2]);
			});
			assert.equal(u.series[1]._paths, paths);
			assert.equal(sizes.length, hookCount);
			assertBitmap(bitmap, [], []);
		}
		finally { u.destroy(); }
	});

	it('retains the setSize hook for axis changes even when plot geometry is unchanged', async () => {
		const events = [];
		let inner = 30;
		const { u, sizes, bitmap } = plot({
			axes: [axis(events, 2, 30), axis(events, 3, 0, () => inner), axis(events, 3, 0, () => 50 - inner)],
			padding: padding(events, [0, 0, 0, 0]),
		});
		try {
			await Promise.resolve();
			const bbox = { ...u.bbox };
			for (const width of [40, 10, 30]) {
				const paths = u.series[1]._paths;
				events.length = sizes.length = bitmap.width.length = bitmap.height.length = 0;
				inner = width;
				u.redraw(false, true);
				await Promise.resolve();
				phaseCheck(u, events);
				assert.deepEqual(u.bbox, bbox);
				assert.deepEqual(u.axes.map(axis => axis._size), [30, width, 50 - width]);
				assert.deepEqual(u.axes.map(axis => axis._pos), [370, 50, 50 - width]);
				assert.deepEqual(sizes, [bbox], 'axis size changes retain the existing hook even with identical bbox');
				assert.equal(u.series[1]._paths, paths, 'axis-only changes preserve series paths');
				assertBitmap(bitmap, [], []);
			}
		}
		finally { u.destroy(); }
	});

	it('rebuilds invalidated paths with unchanged geometry without inventing a resize or bitmap reset', async () => {
		const events = [];
		const { u, sizes, bitmap } = plot({
			axes: [axis(events, 2, 30), axis(events, 3, 40)],
			padding: padding(events, [0, 0, 0, 0]),
		});
		try {
			await Promise.resolve();
			const initial = geometry(u);
			for (const change of ['data', 'explicit rebuild', 'clearCache']) {
				const paths = u.series[1]._paths;
				assert.ok(paths);
				events.length = sizes.length = bitmap.width.length = bitmap.height.length = 0;
				if (change == 'data') {
					u.setData([[0, 50, 100], [100, 0, 50]], false);
					u.redraw();
				}
				else if (change == 'explicit rebuild')
					u.redraw(true, true);
				else {
					u.clearCache();
					assert.equal(u.series[1]._paths, null);
					u.redraw(false, true);
				}
				await Promise.resolve();
				assert.deepEqual(geometry(u), initial, `${change}: layout is unchanged`);
				assert.ok(u.series[1]._paths);
				assert.notEqual(u.series[1]._paths, paths, `${change}: rebuild does not depend on geometry changing`);
				assert.deepEqual(sizes, []);
				assertBitmap(bitmap, [], []);
			}
		}
		finally { u.destroy(); }
	});

	it('assigns only changed bitmap dimensions and fires setSize only for changed outer dimensions', async () => {
		const { u, bitmap, sizes } = plot();
		try {
			await Promise.resolve();
			bitmap.width.length = bitmap.height.length = sizes.length = 0;
			for (const [width, height] of [[600, 400], [640, 400], [640, 420], [640, 420], [640.1, 420.1]]) {
				u.setSize({ width, height });
				await Promise.resolve();
			}
			assertBitmap(bitmap, [640], [420]);
			assert.equal(sizes.length, 3, 'changed fractional CSS dimensions still fire setSize, but identical requests do not');
			assert.equal(u.root.querySelector('canvas').width, 640);
			assert.equal(u.root.querySelector('canvas').height, 420);
		}
		finally { u.destroy(); }
	});

	it('refreshes ordinal labels and overflow when equal-length data leaves index bounds unchanged', async () => {
		const events = [];
		const { u, bitmap } = plot({
			scales: { x: { time: false, distr: 2 }, y: { range: () => [0, 100] } },
			axes: [axis(events, 2, 30), axis(events, 3, 40)],
			padding: padding(events, [0, 0, 0, 0], self => Math.max(0, ...(self.axes[0]._values ?? []).map(label => label.length * 8))),
		}, [[10, 20, 30], [0, 50, 100]]);
		try {
			await Promise.resolve();
			const initial = geometry(u);
			for (const resetScales of [true, false]) {
				for (const x of [[1000, 2000, 3000], [10, 20, 30]]) {
					const paths = u.series[1]._paths;
					events.length = 0;
					bitmap.width.length = bitmap.height.length = 0;
					u.setData([x, [0, 50, 100]], resetScales);
					if (!resetScales)
						u.redraw();
					await Promise.resolve();
					phaseCheck(u, events);
					assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 2]);
					assert.deepEqual(u.axes[0]._splits, [0, 1, 2]);
					assert.deepEqual(u.axes[0]._values, x.map(value => `a0:${value}`));
					for (const event of events.filter(event => event.phase == 'overflow'))
						assert.deepEqual(event.labels[0], u.axes[0]._values);
					const pad = `a0:${x[0]}`.length * 8;
					assert.deepEqual(cssBox(u), { left: 40 + pad, top: 0, width: 560 - 2 * pad, height: 370 });
					assert.notEqual(u.series[1]._paths, paths);
					assertBitmap(bitmap, [], []);
					if (x[0] == 10)
						assert.deepEqual(geometry(u), initial);
				}
			}
		}
		finally { u.destroy(); }
	});

	it('removes inactive reservations on empty data and restores the same layout on recovery', async () => {
		const events = [];
		const { u, bitmap } = plot({
			scales: { x: { time: false }, y: {} },
			axes: [axis(events, 2, 30), axis(events, 3, 10, 60)],
			padding: padding(events, [3, 5, 7, 11]),
		});
		try {
			await Promise.resolve();
			const initial = geometry(u);
			bitmap.width.length = bitmap.height.length = 0;
			for (let pass = 0; pass < 2; pass++) {
				events.length = 0;
				u.setData([]);
				await Promise.resolve();
				// Empty aligned data retains the previous x range but deactivates the auto y axis.
				assert.equal(u.axes[0]._show, true);
				assert.equal(u.axes[1]._show, false);
				assert.deepEqual(cssBox(u), { left: 11, top: 3, width: 584, height: 360 });
				assert.ok(!events.some(event => event.i == 1 && event.type != 'padding'), 'inactive y axis has no callbacks');
				assert.equal(u.series[1]._paths, null);
				events.length = 0;
				u.setData(data);
				await Promise.resolve();
				phaseCheck(u, events);
				assert.deepEqual(geometry(u), initial);
				assert.ok(u.series[1]._paths);
				assertBitmap(bitmap, [], []);
			}
		}
		finally { u.destroy(); }
	});

	it('orders rotated scales by physical orientation rather than the x/y key or axis index', async () => {
		const events = [];
		const { u } = plot({
			scales: { x: { time: false, ori: 1, dir: -1, range: () => [0, 100] }, y: { ori: 0, range: () => [0, 100] } },
			axes: [axis(events, 2, 30, 999, { scale: 'y' }), axis(events, 3, 10, 80, { scale: 'x' })],
			padding: padding(events, [5, 7, 11, 13]),
		});
		try {
			await Promise.resolve();
			phaseCheck(u, events);
			assert.deepEqual(events.filter(event => event.type == 'space').map(({ i, dim }) => [i, dim]), [[1, 354], [0, 500]]);
			assert.deepEqual(cssBox(u), { left: 93, top: 5, width: 500, height: 354 });
			assert.equal(u.valToPos(0, 'x', true), 5);
			assert.equal(u.valToPos(100, 'x', true), 359);
			assert.equal(u.valToPos(0, 'y', true), 93);
			assert.equal(u.valToPos(100, 'y', true), 593);
		}
		finally { u.destroy(); }
	});


	it('preserves active cursor and selection positions across valid external and internal resizes', async () => {
		const events = [];
		let axisWidth = 40;
		const { u } = plot({ cursor: { show: true }, axes: [axis(events, 2, 30), axis(events, 3, 0, () => axisWidth)] });
		try {
			await Promise.resolve();
			for (const [width, height, measured] of [[600, 300, 40], [500, 400, 40], [500, 300, 40], [600, 400, 80]]) {
				u.setCursor({ left: 100, top: 100 });
				u.setSelect({ left: 100, top: 100, width: 100, height: 100 });
				axisWidth = measured;
				if (width == u.width && height == u.height)
					u.redraw(false, true);
				else
					u.setSize({ width, height });
				await Promise.resolve();
				const x = 100 * (width - measured) / 560;
				const y = 100 * (height - 30) / 370;
				for (const [actual, expected] of [
					[u.cursor.left, x], [u.cursor.top, y], [u.select.left, x],
					[u.select.top, y], [u.select.width, x], [u.select.height, y],
				])
					assert.ok(Math.abs(actual - expected) < 1e-9, 'overlays retain their proportional positions');
				for (const el of u.over.querySelectorAll('div'))
					assert.doesNotMatch(el.style.cssText, /NaN|Infinity/);
				axisWidth = 40;
				if (width == 600 && height == 400)
					u.redraw(false, true);
				else
					u.setSize({ width: 600, height: 400 });
				await Promise.resolve();
				for (const value of [u.cursor.left, u.cursor.top, u.select.left, u.select.top, u.select.width, u.select.height])
					assert.ok(Math.abs(value - 100) < 1e-9, 'overlays recover their original positions');
			}
		}
		finally { u.destroy(); }
	});

	it('keeps pixel conversions inverse across pending pixel-ratio updates and rounded geometry', async () => {
		for (const ori of [0, 1]) {
			for (const dir of [-1, 1]) {
				const { u } = plot({
					width: 600.3, height: 400.7, pxRatio: 1.25,
					padding: [0.1, 0.2, 0.3, 0.4],
					scales: {
						x: { time: false, ori, dir, distr: 3, range: [1, 100] },
						y: { ori: 1 - ori, dir: -dir, range: [1, 100] },
					},
					axes: [{ scale: 'x', side: ori == 0 ? 2 : 3 }, { scale: 'y', side: ori == 0 ? 3 : 2 }],
				}, [[1, 10, 100], [1, 10, 100]]);
				function checkConversions() {
					for (const key of ['x', 'y']) {
						for (const can of [false, true]) {
							for (const value of [1, 10, 50, 100]) {
								const position = u.valToPos(value, key, can);
								assert.ok(Math.abs(u.posToVal(position, key, can) - value) < 1e-10,
									`round trip on ${key}, orientation ${ori}, direction ${dir}, canvas ${can}`);
							}
						}
					}
					assert.equal(u.posToIdx(u.valToPos(10, 'x', true), true), 1);
				}
				try {
					await Promise.resolve();
					checkConversions();
					for (const ratio of [2, 1.1]) {
						const bbox = { ...u.bbox };
						const position = u.valToPos(10, 'x', true);
						u.setPxRatio(ratio);
						u.setSize({ width: u.width + 0.2, height: u.height + 0.4 });
						assert.deepEqual(u.bbox, bbox, 'pending updates retain the completed pixel rectangle');
						assert.equal(u.valToPos(10, 'x', true), position);
						checkConversions();
						await Promise.resolve();
						checkConversions();
					}
				}
				finally { u.destroy(); }
			}
		}
	});

	it('keeps CSS layout and ticks stable across pixel-ratio changes and avoids redundant bitmap writes', async () => {
		const events = [];
		const { u, bitmap, sizes, canvasState } = plot({ axes: [axis(events, 2, 30), axis(events, 3, 40)] }, data, true);
		try {
			await Promise.resolve();
			const initial = cssBox(u);
			const splits = u.axes.map(axis => axis._splits.slice());
			const fontSize = u.axes[0].font[1];
			for (const ratio of [2, 2, 1]) {
				const oldRatio = u.pxRatio;
				const paths = u.series[1]._paths;
				const counts = { ...canvasState.counts };
				events.length = sizes.length = 0;
				bitmap.width.length = bitmap.height.length = 0;
				u.setPxRatio(ratio);
				await Promise.resolve();
				assert.equal(u.pxRatio, ratio);
				assert.deepEqual(cssBox(u), initial);
				assert.deepEqual(u.axes.map(axis => axis._splits), splits);
				assert.equal(u.axes[0].font[1], fontSize * ratio);
				assertBitmap(bitmap, ratio == oldRatio ? [] : [600 * ratio], ratio == oldRatio ? [] : [400 * ratio]);
				if (ratio != oldRatio)
					assert.notEqual(u.series[1]._paths, paths, 'pixel-ratio changes rebuild paths');
				else {
					assert.deepEqual(events, [], 'identical pixel ratio does not refresh layout callbacks');
					assert.deepEqual(sizes, [], 'identical pixel ratio does not fire setSize');
					assert.deepEqual(canvasState.counts, counts, 'identical pixel ratio performs no canvas operations');
					assert.equal(u.series[1]._paths, paths, 'identical pixel ratio retains paths');
				}
				assert.equal(u.valToPos(100, 'x', true), (initial.left + initial.width) * ratio);
			}
		}
		finally { u.destroy(); }
	});
});
