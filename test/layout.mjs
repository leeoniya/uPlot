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
			events.push({ type: values === null ? 'reserve' : 'measure', i, values, argc: arguments.length });
			return values === null ? reserve : typeof measured == 'function' ? measured(self, values) : measured;
		},
		space(self, i, min, max, dim) {
			events.push({ type: 'space', i, dim });
			return 50;
		},
		incrs: [1, 2, 5, 10, 20, 50, 100],
		splits(self, i, min, max, incr) {
			const splits = [];
			if (incr > 0) {
				for (let value = Math.ceil(min / incr) * incr; value <= max; value += incr)
					splits.push(value);
			}
			events.push({ type: 'splits', i, splits: splits.slice() });
			return splits;
		},
		values(self, splits, i) {
			const values = splits.map(value => value == null ? null : `a${i}:${value}`);
			events.push({ type: 'values', i, values });
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
	const snapshot = () => structuredClone(state);

	function operation(name, value) {
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
		draws, resets, snapshot,
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
	assert.deepEqual(reserves.map(event => event.i).sort((a, b) => a - b), active, 'one reservation per active axis');
	for (const event of reserves)
		assert.equal(event.argc, 3, 'size has no cycleNum argument');

	const baseline = events.filter(event => event.type == 'padding' && event.phase == 'layout');
	const overflow = events.filter(event => event.type == 'padding' && event.phase == 'overflow');
	assert.deepEqual(baseline.map(event => event.i).sort(), [0, 1, 2, 3], 'one baseline call on every side');
	assert.deepEqual(overflow.map(event => event.i).sort(), [1, 3], 'one overflow call on each horizontal edge');
	assert.equal(events.filter(event => event.type == 'padding').length, 6, 'no convergence padding calls');
	for (const event of [...baseline, ...overflow])
		assert.equal(event.argc, 4);

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
			? ['reserve', 'space', 'splits', 'values', 'measure']
			: ['reserve', 'space', 'splits', 'values'], `bounded axis ${i} calls in phase order`);
		if (vertical) {
			const measure = calls.at(-1);
			assert.equal(measure.argc, 3, 'measurement has no cycleNum argument');
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
			assert.equal(sizes.length, 2);
			assert.deepEqual(events.filter(event => event.type == 'hook').map(event => event.name),
				['setSize:first', 'setSize:second', 'drawClear', 'drawAxes', 'drawSeries', 'draw']);
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
			for (const step of ['unchanged layout', 'internal resize', 'same-size setSize', 'width resize', 'height resize']) {
				u.ctx.globalCompositeOperation = 'multiply';
				const before = tracker.snapshot();
				const box = { ...u.bbox };
				const resets = tracker.resets.length;
				const hookCount = sizes.length;
				bitmap.width.length = bitmap.height.length = tracker.draws.length = measured.length = 0;
				if (step == 'internal resize')
					extraWidth = 20;
				if (step == 'unchanged layout' || step == 'internal resize')
					u.redraw(false, true);
				else
					u.setSize({ width: step == 'width resize' ? 640 : u.width, height: step == 'height resize' ? 420 : u.height });
				await Promise.resolve();
				const resized = step == 'width resize' || step == 'height resize';
				assertBitmap(bitmap, step == 'width resize' ? [640] : [], step == 'height resize' ? [420] : []);
				assert.equal(tracker.resets.length, resets + Number(resized), step);
				assert.equal(sizes.length, hookCount + Number(step != 'unchanged layout'), step);
				if (step == 'internal resize')
					assert.notDeepEqual(u.bbox, box, 'internal geometry really changed');
				const clear = tracker.draws.find(draw => draw.name == 'clearRect');
				if (resized)
					assert.deepEqual(clear.state, tracker.resets.at(-1).state, 'resize clears real state before drawing');
				else
					assert.deepEqual(clear.state, before, 'relayout and same-size setSize retain context state');
				assert.deepEqual(clear.args, [0, 0, u.width, u.height]);
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

	it('uses baseline reservations for sidesWithAxes and keeps plot height fixed after measurement', async () => {
		for (const [reserve, measured, pad] of [[0, 70, 0], [20, 0, 17]]) {
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
					Array.from({ length: 4 }, () => [false, false, false, reserve > 0]));
				assert.equal(u.axes[0]._size, 0, 'numeric size: 0 reserves no height');
				assert.ok(u.axes[0]._splits.length > 0, 'numeric size: 0 still selects ticks');
				assert.equal(u.axes[1]._size, measured);
				assert.deepEqual(cssBox(u), { left: measured, top: pad, width: 600 - measured, height: 400 - 2 * pad });
				assert.ok(events.filter(event => event.type == 'space' && event.i == 1).every(event => event.dim == 400 - 2 * pad),
					'vertical measurement cannot change the height used to select its ticks');
			}
			finally { u.destroy(); }
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

	it('assigns only changed bitmap dimensions on external resize, preserving explicit setSize hooks', async () => {
		const { u, bitmap, sizes } = plot();
		try {
			await Promise.resolve();
			bitmap.width.length = bitmap.height.length = sizes.length = 0;
			for (const [width, height] of [[600, 400], [640, 400], [640, 420], [640, 420], [640.1, 420.1]]) {
				u.setSize({ width, height });
				await Promise.resolve();
			}
			assertBitmap(bitmap, [640], [420]);
			assert.equal(sizes.length, 5, 'explicit setSize fires even when bitmap size is unchanged');
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

	it('recovers ticks and paths after collapsed width, height, and both dimensions', async () => {
		const events = [];
		const { u } = plot({ axes: [axis(events, 2, 30), axis(events, 3, 40)] });
		try {
			await Promise.resolve();
			const initial = geometry(u);
			for (const [width, height] of [[40, 400], [600, 30], [0, 0]]) {
				events.length = 0;
				u.setSize({ width, height });
				await Promise.resolve();
				assert.ok(Object.values(u.bbox).every(Number.isFinite), 'collapsed geometry stays finite');
				assert.ok(events.filter(event => event.type == 'splits').length <= 2, 'collapsed layout does not iterate ticks');
				for (const axis of u.axes)
					assert.ok((axis._splits ?? []).every(Number.isFinite));
				u.setSize({ width: 600, height: 400 });
				await Promise.resolve();
				assert.deepEqual(geometry(u), initial, 'recovered geometry and ticks match initial layout');
				assert.ok(u.series[1]._paths, 'paths recover with positive dimensions');
			}
		}
		finally { u.destroy(); }
	});

	it('keeps active overlays finite through sizes smaller than axis reservations', async () => {
		const events = [];
		const { u } = plot({ cursor: { show: true }, axes: [axis(events, 2, 30), axis(events, 3, 40)] });
		function checkOverlays() {
			for (const value of [u.cursor.left, u.cursor.top, u.select.left, u.select.top, u.select.width, u.select.height])
				assert.ok(Number.isFinite(value), 'cursor and selection coordinates stay finite');
			for (const el of u.over.querySelectorAll('div'))
				assert.doesNotMatch(el.style.cssText, /NaN|Infinity/, 'overlay styles stay finite');
		}
		try {
			await Promise.resolve();
			const initial = geometry(u);
			// Avoid exact-zero plot dimensions: their overlay normalization predates this layout change.
			for (const [width, height] of [[600, 20], [20, 400], [20, 20]]) {
				u.setCursor({ left: 100, top: 100 });
				u.setSelect({ left: 100, top: 100, width: 100, height: 100 });
				u.setSize({ width, height });
				await Promise.resolve();
				assert.deepEqual(cssBox(u), { left: 40, top: 0, width: width - 40, height: height - 30 },
					'undersized plots retain negative dimensions rather than clamping to zero');
				checkOverlays();
				u.setSize({ width: 600, height: 400 });
				await Promise.resolve();
				assert.deepEqual(geometry(u), initial);
				checkOverlays();
				// Negative width already hides overlays under the existing left/width guards.
				// Height-only undersizing keeps them active and must recover their original positions.
				if (width == 600) {
					for (const value of [u.cursor.left, u.cursor.top, u.select.left, u.select.top, u.select.width, u.select.height])
						assert.ok(Math.abs(value - 100) < 1e-9, 'active overlays recover their original positions');
				}
			}
		}
		finally { u.destroy(); }
	});

	it('keeps CSS layout and ticks stable across pixel-ratio changes and avoids redundant bitmap writes', async () => {
		const events = [];
		const { u, bitmap } = plot({ axes: [axis(events, 2, 30), axis(events, 3, 40)] });
		try {
			await Promise.resolve();
			const initial = cssBox(u);
			const splits = u.axes.map(axis => axis._splits.slice());
			const fontSize = u.axes[0].font[1];
			for (const ratio of [2, 2, 1]) {
				const oldRatio = u.pxRatio;
				const paths = u.series[1]._paths;
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
				assert.equal(u.valToPos(100, 'x', true), (initial.left + initial.width) * ratio);
			}
		}
		finally { u.destroy(); }
	});
});
