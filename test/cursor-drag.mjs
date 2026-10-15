import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const values = [0, 25, 50, 75, 100];
const range = (self, min, max) => [min, max];
const emptySelection = { left: 0, top: 0, width: 0, height: 0 };

function selection(u) {
	const { left, top, width, height } = u.select;
	return { left, top, width, height };
}

function assertSelection(u, expected, message) {
	assert.deepEqual(selection(u), expected, message);
	const style = u.root.querySelector('.u-select').style;
	for (const key in expected)
		assert.equal(parseFloat(style[key]), expected[key], `selection CSS ${key}`);
}

function ranges(u) {
	return { x: [u.scales.x.min, u.scales.x.max], y: [u.scales.y.min, u.scales.y.max] };
}

async function plot(drag = {}, pxRatio = 1, autoY = false, axes, syncKey, scaleOpts = {}, cursorOpts = {}) {
	const selections = [];
	const scales = [];
	const draws = [];
	let rectReads = 0;
	const u = new uPlot({
		width: 600,
		height: 400,
		pxRatio,
		padding: [10, 20, 10, 20],
		legend: { show: false },
		cursor: { drag, sync: { key: syncKey }, ...cursorOpts },
		series: [{}, { stroke: 'blue', points: { show: false } }],
		scales: {
			x: { time: false, range, ...scaleOpts.x },
			y: { auto: autoY, range, ...(!autoY && { min: 0, max: 100 }), ...scaleOpts.y },
		},
		axes: axes ?? [{ size: 30 }, { size: 60 }, { scale: 'y', side: 1, size: 40 }],
		hooks: {
			setSelect: [self => selections.push(selection(self))],
			setScale: [(self, key) => scales.push(key)],
			draw: [() => draws.push(true)],
		},
	}, [values, values], (self, init) => {
		self.ctx.measureText = text => ({ width: String(text).length * 8 * self.pxRatio });
		document.body.appendChild(self.root);
		init();
	});

	// Happy DOM has no layout engine. Use the applied overlay CSS and a nonzero
	// page offset, not u.rect, so event coordinates cannot reuse a stale cache.
	function box() {
		const style = u.over.style;
		return new DOMRect(101 + parseFloat(style.left), 203 + parseFloat(style.top),
			parseFloat(style.width), parseFloat(style.height));
	}

	u.over.getBoundingClientRect = () => { rectReads++; return box(); };

	let previous = null;
	function mouse(type, left, top, target = u.over, opts = {}) {
		const rect = box();
		const clientX = rect.left + left;
		const clientY = rect.top + top;
		const event = new MouseEvent(type, {
			bubbles: !['mouseenter', 'mouseleave'].includes(type),
			cancelable: true,
			button: 0,
			buttons: type == 'mouseup' || type == 'dblclick' ? 0 : 1,
			detail: type == 'dblclick' ? 2 : 0,
			clientX, clientY,
			...opts,
		});
		// Define explicitly: zero-movement events during a drag are ignored by uPlot.
		Object.defineProperties(event, {
			movementX: { value: previous == null ? 0 : clientX - previous[0] },
			movementY: { value: previous == null ? 0 : clientY - previous[1] },
		});
		previous = [clientX, clientY];
		target.dispatchEvent(event);
		return event;
	}

	await Promise.resolve();
	selections.length = scales.length = draws.length = 0;
	return {
		u, box, mouse, selections, scales, draws,
		get rectReads() { return rectReads; },
		destroy() { u.destroy(); },
	};
}

async function dragMiddle(f, reverse = false) {
	const { width: w, height: h } = f.box();
	let start = [w / 4, h / 4];
	let end = [3 * w / 4, 3 * h / 4];
	if (reverse)
		[start, end] = [end, start];
	f.mouse('mousedown', ...start);
	f.mouse('mousemove', ...end);
	f.mouse('mouseup', ...end, document);
	await Promise.resolve();
}

const modes = [
	{ name: 'x-only', x: true, y: false },
	{ name: 'y-only', x: false, y: true },
	{ name: 'xy', x: true, y: true },
];

describe('mouse-driven drag selection', () => {
	for (const pxRatio of [1, 2]) {
		for (const { name, x, y } of modes) {
			for (const reverse of [false, true]) {
				it(`zooms ${name} ${reverse ? 'backward' : 'forward'} at DPR ${pxRatio}`, async () => {
					const f = await plot({ x, y }, pxRatio);
					const { u, mouse, selections, scales } = f;
					try {
						const { width: w, height: h } = f.box();
						assert.equal(w, 460);
						assert.equal(h, 350);
						const start = [w / 4, h / 4];
						const end = [3 * w / 4, 3 * h / 4];
						if (reverse)
							[start[0], start[1], end[0], end[1]] = [...end, ...start];
						mouse('mousedown', ...start);
						mouse('mousemove', ...end);
						const expected = { left: x ? w / 4 : 0, top: y ? h / 4 : 0, width: x ? w / 2 : w, height: y ? h / 2 : h };
						assertSelection(u, expected);
						assert.equal(u.cursor.drag._x, x);
						assert.equal(u.cursor.drag._y, y);
						assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] }, 'drag preview does not zoom');
						assert.deepEqual(selections, [], 'selection hook waits for release');
						mouse('mouseup', ...end, document);
						assert.deepEqual(selections, [expected]);
						assertSelection(u, emptySelection);
						assert.equal(u.cursor.drag._x, false);
						assert.equal(u.cursor.drag._y, false);
						await Promise.resolve();
						assert.deepEqual(ranges(u), { x: x ? [25, 75] : [0, 100], y: y ? [25, 75] : [0, 100] });
						assert.deepEqual(scales.slice().sort(), [x && 'x', y && 'y'].filter(Boolean));
					}
					finally { f.destroy(); }
				});
			}
		}
	}

	it('orders bounds produced by inverted scales before applying drag zoom', async () => {
		const f = await plot({ x: true, y: true }, 1, false, undefined, undefined, {
			x: { dir: -1 },
			y: { dir: -1 },
		});
		try {
			await dragMiddle(f);
			assert.deepEqual(ranges(f.u), { x: [25, 75], y: [25, 75] });
		}
		finally { f.destroy(); }
	});

	it('refines only drag-generated ranges and commits an XY drag in one draw', async () => {
		const requests = [];
		let callbackSelf;
		const f = await plot({
			x: true,
			y: true,
			setRange: (self, scaleKey, min, max) => {
				callbackSelf = self;
				requests.push({ scaleKey, min, max });
				return [
					Math.floor(min / 20) * 20,
					Math.ceil(max / 20) * 20,
				];
			},
		});
		try {
			f.u.setScale('x', { min: 24, max: 76 });
			await Promise.resolve();
			assert.deepEqual(requests, []);
			assert.deepEqual(ranges(f.u), { x: [24, 76], y: [0, 100] });

			f.u.setScale('x', { min: 0, max: 100 });
			await Promise.resolve();
			f.draws.length = 0;
			await dragMiddle(f);
			assert.equal(callbackSelf, f.u);
			assert.deepEqual(requests, [
				{ scaleKey: 'x', min: 25, max: 75 },
				{ scaleKey: 'y', min: 25, max: 75 },
			]);
			assert.equal(f.draws.length, 1, 'XY range requests commit in one draw');
			assert.deepEqual(ranges(f.u), { x: [20, 80], y: [20, 80] });

			f.u.batch(() => {
				f.u.setScale('x', { min: 0, max: 100 });
				f.u.setScale('y', { min: 0, max: 100 });
			});
			await Promise.resolve();
			requests.length = 0;
			await dragMiddle(f, true);
			assert.deepEqual(requests, [
				{ scaleKey: 'x', min: 25, max: 75 },
				{ scaleKey: 'y', min: 25, max: 75 },
			], 'backward drag range bounds are ordered');
		}
		finally { f.destroy(); }
	});

	it('uses each synchronized chart drag range callback', async () => {
		const calls = [[], []];
		const source = await plot({
			x: true,
			y: false,
			setRange: (self, scaleKey, min, max) => {
				calls[0].push({ scaleKey, min, max });
				return [20, 80];
			},
		}, 1, false, undefined, 'drag-range-callbacks');
		const target = await plot({
			x: true,
			y: false,
			setRange: (self, scaleKey, min, max) => {
				calls[1].push({ scaleKey, min, max });
				return [30, 70];
			},
		}, 1, false, undefined, 'drag-range-callbacks');
		try {
			await dragMiddle(source);
			assert.deepEqual(calls, [
				[{ scaleKey: 'x', min: 25, max: 75 }],
				[{ scaleKey: 'x', min: 25, max: 75 }],
			]);
			assert.deepEqual(ranges(source.u), { x: [20, 80], y: [0, 100] });
			assert.deepEqual(ranges(target.u), { x: [30, 70], y: [0, 100] });
		}
		finally {
			source.destroy();
			target.destroy();
		}
	});

	it('cancels a drag range when its callback returns null', async () => {
		const requests = [];
		const f = await plot({
			x: true,
			y: false,
			setRange: (self, scaleKey, min, max) => {
				requests.push({ scaleKey, min, max });
				return null;
			},
		});
		try {
			await dragMiddle(f);
			assert.deepEqual(requests, [{ scaleKey: 'x', min: 25, max: 75 }]);
			assert.deepEqual(ranges(f.u), { x: [0, 100], y: [0, 100] });
		}
		finally { f.destroy(); }
	});

	it('does not call the drag range callback for programmatic, automatic, or reset range changes', async () => {
		let requests = 0;
		const f = await plot({
			x: true,
			y: false,
			setRange: (self, scaleKey, min, max) => {
				requests++;
				return [min, max];
			},
		});
		try {
			f.u.setScale('x', { min: 25, max: 75 });
			await Promise.resolve();
			f.u.redraw();
			await Promise.resolve();
			f.u.setData([values, values]);
			await Promise.resolve();
			f.mouse('dblclick', 100, 100);
			await Promise.resolve();
			assert.equal(requests, 0);
		}
		finally { f.destroy(); }
	});

	it('retains the selection without zoom when drag.setRange is false', async () => {
		const f = await plot({ x: true, y: true, setRange: false });
		const { u, mouse, selections, scales } = f;
		try {
			mouse('mousedown', 100, 50);
			mouse('mousemove', 300, 200);
			const expected = { left: 100, top: 50, width: 200, height: 150 };
			assertSelection(u, expected);
			mouse('mouseup', 300, 200, document);
			await Promise.resolve();
			assertSelection(u, expected);
			assert.deepEqual(selections, [expected]);
			assert.deepEqual(scales, []);
			assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
			mouse('mousemove', 400, 250);
			assertSelection(u, expected, 'movement after release does not extend selection');
			mouse('mouseup', 400, 250, document);
			assert.deepEqual(selections, [expected], 'document release listener is removed');
		}
		finally { f.destroy(); }
	});

	it('supports deprecated drag.setScale as a boolean alias', async () => {
		for (const enabled of [true, false]) {
			const f = await plot({ x: true, y: false, setScale: enabled });
			try {
				await dragMiddle(f);
				assert.deepEqual(ranges(f.u), { x: enabled ? [25, 75] : [0, 100], y: [0, 100] });
				assertSelection(f.u, enabled ? emptySelection : { left: 115, top: 0, width: 230, height: 350 });
			}
			finally { f.destroy(); }
		}
	});

	for (const movement of [null, 0, 9]) {
		it(`does not select or zoom on ${movement == null ? 'a click' : movement == 0 ? 'a zero-movement event' : 'movement below drag.dist'}`, async () => {
			const f = await plot({ x: true, y: true, dist: movement === 0 ? 0 : 10 });
			const { u, mouse, selections, scales } = f;
			try {
				const initialStyle = u.root.querySelector('.u-select').style.cssText;
				mouse('mousedown', 100, 100);
				if (movement != null)
					mouse('mousemove', 100 + movement, 100 + movement);
				mouse('mouseup', 100 + (movement ?? 0), 100 + (movement ?? 0), document);
				await Promise.resolve();
				assert.deepEqual(selection(u), emptySelection);
				if (movement == null || movement == 0)
					assert.equal(u.root.querySelector('.u-select').style.cssText, initialStyle, 'ignored input leaves selection CSS untouched');
				else
					assertSelection(u, emptySelection);
				assert.deepEqual(selections, []);
				assert.deepEqual(scales, []);
				assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
			}
			finally { f.destroy(); }
		});
	}

	it('starts selection at drag.dist and ignores a subsequent zero-movement event', async () => {
		const f = await plot({ x: true, y: false, dist: 10, setRange: false });
		const { u, mouse, selections } = f;
		try {
			mouse('mousedown', 100, 100);
			mouse('mousemove', 110, 100);
			const expected = { left: 100, top: 0, width: 10, height: 350 };
			assertSelection(u, expected);
			mouse('mousemove', 110, 100);
			assertSelection(u, expected);
			mouse('mouseup', 110, 100, document);
			assert.deepEqual(selections, [expected]);
		}
		finally { f.destroy(); }
	});

	for (const reverse of [false, true]) {
		it(`snaps to the ${reverse ? 'left' : 'right'} edge and completes a drag released outside the plot`, async () => {
			const f = await plot();
			const { u, mouse, selections } = f;
			try {
				const { width: w, height: h } = f.box();
				const outside = reverse ? -20 : w + 20;
				mouse('mousedown', w / 2, h / 2);
				mouse('mousemove', reverse ? 5 : w - 5, h / 2);
				mouse('mouseleave', outside, h / 2);
				const expected = { left: reverse ? 0 : w / 2, top: 0, width: w / 2, height: h };
				assertSelection(u, expected);
				mouse('mouseup', outside, h / 2, document.body);
				await Promise.resolve();
				assert.deepEqual(selections, [expected]);
				assertSelection(u, emptySelection);
				assert.deepEqual(ranges(u), { x: reverse ? [0, 50] : [50, 100], y: [0, 100] });
				mouse('mouseenter', w / 2, h / 2);
				mouse('mousemove', w / 4, h / 2);
				assertSelection(u, emptySelection, 're-entry after release does not resume dragging');
			}
			finally { f.destroy(); }
		});
	}

	for (const pxRatio of [1, 2]) {
		it(`uses the refreshed rectangle for a drag after external resize at DPR ${pxRatio}`, async () => {
			const f = await plot({ x: true, y: true }, pxRatio);
			const { u, mouse, selections } = f;
			try {
				mouse('mousemove', 100, 100);
				const cached = u.rect;
				const reads = f.rectReads;
				u.setSize({ width: 800, height: 500 });
				await Promise.resolve();
				const { width: w, height: h } = f.box();
				assert.equal(w, 660);
				assert.equal(h, 450);
				// No mouseenter or explicit syncRect: layout must invalidate the cached rectangle.
				mouse('mousedown', w / 4, h / 4);
				assert.ok(f.rectReads > reads);
				assert.notEqual(u.rect, cached);
				assert.equal(u.rect.width, w);
				assert.equal(u.rect.height, h);
				mouse('mousemove', 3 * w / 4, 3 * h / 4);
				const expected = { left: w / 4, top: h / 4, width: w / 2, height: h / 2 };
				assertSelection(u, expected);
				mouse('mouseup', 3 * w / 4, 3 * h / 4, document);
				await Promise.resolve();
				assert.deepEqual(selections, [expected]);
				assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
				assertSelection(u, emptySelection);
			}
			finally { f.destroy(); }
		});
	}

	it('refreshes the drag origin and width after axes collapse and return', async () => {
		const f = await plot({ setRange: false }, 1, true);
		const { u, mouse, selections, scales } = f;
		try {
			mouse('mousemove', 100, 100);
			for (const show of [false, true]) {
				const cached = u.rect;
				const reads = f.rectReads;
				u.setSeries(1, { show });
				await Promise.resolve();
				assert.equal(u.scales.y.min == null, !show);
				assert.equal(u.axes[1]._show, show);
				assert.equal(u.axes[2]._show, show);
				const { width: w, height: h, left } = f.box();
				assert.equal(w, show ? 460 : 560);
				assert.equal(left, 101 + (show ? 80 : 20));
				selections.length = scales.length = 0;
				// Use a different interval after restoration, so this is a changed selection.
				const start = show ? w / 8 : w / 4;
				mouse('mousedown', start, h / 2);
				assert.ok(f.rectReads > reads);
				assert.notEqual(u.rect, cached);
				assert.equal(u.rect.left, left);
				assert.equal(u.rect.width, w);
				mouse('mousemove', 3 * w / 4, h / 2);
				const expected = { left: start, top: 0, width: 3 * w / 4 - start, height: h };
				assertSelection(u, expected);
				mouse('mouseup', 3 * w / 4, h / 2, document);
				await Promise.resolve();
				assertSelection(u, expected);
				assert.deepEqual(selections, [expected]);
				assert.deepEqual(scales, []);
				assert.equal(u.posToVal(expected.left, 'x'), show ? 12.5 : 25);
				assert.equal(u.posToVal(expected.left + expected.width, 'x'), 75);
			}
		}
		finally { f.destroy(); }
	});
});

describe('shared native mouse ownership', () => {
	for (const synchronized of [false, true]) {
		it(`ignores competing overlay events but preserves sync (${synchronized})`, async () => {
			const key = synchronized ? 'mouse-owner' : undefined;
			const source = await plot({ x: true, y: true }, 1, false, undefined, key);
			const target = await plot({ x: true, y: true }, 1, false, undefined, key);
			let sourceUpdates = 0;
			let targetUpdates = 0;
			source.u.hooks.setCursor = [() => sourceUpdates++];
			target.u.hooks.setCursor = [() => targetUpdates++];
			try {
				target.mouse('mousemove', 30, 40);
				source.mouse('mousedown', 100, 100);
				const previousEvent = target.u.cursor.event;
				const reads = target.rectReads;
				sourceUpdates = targetUpdates = 0;
				for (const type of ['mouseenter', 'mousedown', 'dblclick', 'mouseleave'])
					target.mouse(type, 200, 200);
				assert.equal(target.u.cursor.event, previousEvent);
				assert.equal(target.rectReads, reads);
				assert.equal(targetUpdates, 0);
				assert.equal(sourceUpdates, 0);

				// Dispatch on the peer overlay: the owner must still receive the bubbling move.
				source.mouse('mousemove', 200, 200, target.u.over);
				assert.equal(sourceUpdates, 1);
				assert.equal(targetUpdates, synchronized ? 1 : 0);
				assert.equal(target.u.cursor.event, previousEvent);
				assertSelection(source.u, { left: 100, top: 100, width: 100, height: 100 });
				assert.deepEqual(selection(target.u), synchronized ? selection(source.u) : emptySelection);

				const probeRelease = () => {
					const before = targetUpdates;
					target.mouse('mousemove', 300, 300);
					assert.equal(targetUpdates, before, 'ownership remains through release callbacks');
				};
				target.u.hooks.setSelect.push(probeRelease);
				source.u.hooks.setCursor.push(() => {
					if (source.u.cursor.left == -10)
						probeRelease();
				});
				source.mouse('mouseup', -100, -100, target.u.over);
				target.u.hooks.setSelect.pop();
				source.u.hooks.setCursor.pop();
				await Promise.resolve();
				assert.equal(source.u.cursor.left, -10, 'owner receives release over the peer');
				assert.equal(source.selections.length, 1);
				if (synchronized) {
					assert.deepEqual(ranges(target.u), ranges(source.u));
					assert.equal(target.u.cursor.left, -10, 'release hiding reaches the peer');
					assert.equal(target.selections.length, 1);
				}
				else {
					assert.deepEqual(ranges(target.u), { x: [0, 100], y: [0, 100] });
					assert.equal(target.u.cursor.left, 30);
				}
				const before = targetUpdates;
				target.mouse('mousemove', 150, 160);
				assert.equal(targetUpdates, before + 1, 'peer resumes on the next move');
				assert.equal(target.u.cursor.left, 150);
				target.mouse('mousedown', 150, 160);
				target.mouse('mousemove', 250, 260);
				target.mouse('mouseup', 250, 260);
				assert.equal(target.selections.length, synchronized ? 2 : 1, 'peer can claim the next drag');
			}
			finally { source.destroy(); target.destroy(); }
		});
	}

	for (const disabled of [false, true]) {
		it(`does not claim rejected mousedown (disabled binding ${disabled})`, async () => {
			const source = await plot({}, 1, false, undefined, undefined, {}, disabled ? {
				bind: { mousedown: () => null },
			} : {});
			const target = await plot();
			try {
				source.mouse('mousedown', 100, 100, source.u.over, { button: disabled ? 0 : 2 });
				target.mouse('mousemove', 200, 200);
				assert.equal(target.u.cursor.left, 200);
				target.mouse('mousedown', 100, 100);
				target.mouse('mousemove', 200, 200);
				target.mouse('mouseup', 200, 200);
				assert.equal(target.selections.length, 1);
			}
			finally { source.destroy(); target.destroy(); }
		});
	}

	it('only the owner releases ownership on destroy', async () => {
		const source = await plot();
		const target = await plot();
		const other = await plot();
		try {
			target.mouse('mousemove', 30, 40);
			source.mouse('mousedown', 100, 100);
			other.destroy();
			target.mouse('mousemove', 200, 200);
			assert.equal(target.u.cursor.left, 30, 'destroying a non-owner keeps ownership');
			source.destroy();
			target.mouse('mousemove', 250, 250);
			assert.equal(target.u.cursor.left, 250, 'destroying the owner lets the peer resume');
			target.mouse('mousedown', 100, 100);
			target.mouse('mousemove', 200, 200);
			target.mouse('mouseup', 200, 200);
			assert.equal(target.selections.length, 1);
		}
		finally { source.destroy(); target.destroy(); other.destroy(); }
	});
});

describe('dragging outside the overlay', () => {
	for (const pxRatio of [1, 2]) {
		for (const reverse of [false, true]) {
			it(`clamps distant outside moves and hides on release (DPR ${pxRatio}, reverse ${reverse})`, async () => {
				const f = await plot({ x: true, y: true }, pxRatio);
				const { u, mouse } = f;
				try {
					const { width: w, height: h } = f.box();
					mouse('mousedown', w / 2, h / 2);
					mouse('mousemove', reverse ? 5 : w - 5, h / 4);
					mouse('mouseleave', reverse ? -5 : w + 5, h / 4);
					const outsideX = reverse ? -3 * w : 4 * w;
					mouse('mousemove', outsideX, 3 * h / 4, document.body);
					assertSelection(u, { left: reverse ? 0 : w / 2, top: h / 2, width: w / 2, height: h / 4 });
					assert.equal(u.cursor.left, reverse ? 0 : w);
					mouse('mousemove', outsideX, reverse ? -3 * h : 4 * h, document.body);
					const expected = { left: reverse ? 0 : w / 2, top: reverse ? 0 : h / 2, width: w / 2, height: h / 2 };
					assertSelection(u, expected);
					mouse('mouseup', outsideX, reverse ? -3 * h : 4 * h, document.body);
					await Promise.resolve();
					assert.deepEqual(f.selections, [expected]);
					assert.deepEqual(ranges(u), { x: reverse ? [0, 50] : [50, 100], y: reverse ? [50, 100] : [0, 50] });
					assert.equal(u.cursor.left, -10);
					assert.equal(u.cursor.top, -10);
					assert.equal(u.cursor.idx, null);
					mouse('mousemove', w / 4, h / 4, document.body);
					assert.equal(u.cursor.left, -10, 'document movement stops after release');
				}
				finally { f.destroy(); }
			});
		}
	}

	it('retains custom-bound document listeners through re-entry, removes on release and destroy', async () => {
		const bound = [];
		const removed = [];
		const attached = [];
		let calls = 0;
		const originalAdd = document.addEventListener;
		document.addEventListener = function(type, listener, options) {
			attached.push(listener);
			return originalAdd.call(this, type, listener, options);
		};
		const originalRemove = document.removeEventListener;
		document.removeEventListener = function(type, listener, options) {
			removed.push(listener);
			return originalRemove.call(this, type, listener, options);
		};
		const bind = (self, target, handle, onlyTarget) => {
			const listener = e => {
				if (!onlyTarget || e.target == target) {
					calls++;
					handle(e);
				}
			};
			if (target == document) {
				assert.equal(onlyTarget, false);
				bound.push(listener);
			}
			return listener;
		};
		const f = await plot({ x: true, y: true, setRange: false }, 1, false, undefined, undefined, {}, {
			bind: { mousemove: bind, mouseup: bind },
		});
		try {
			const { width: w, height: h } = f.box();
			const leave = () => {
				f.mouse('mousemove', w - 5, h / 4);
				f.mouse('mouseleave', w + 5, h / 4);
			};
			f.mouse('mousedown', w / 2, h / 2);
			assert.equal(bound.length, 2, 'both listeners attach on mousedown');
			leave();
			assert.equal(bound.length, 2);
			f.mouse('mouseleave', w + 6, h / 4);
			assert.equal(bound.length, 2, 'repeated leave does not replace a live wrapper');
			f.mouse('mouseenter', w - 5, h / 4);
			assert.equal(removed.length, 0, 'boundary crossings retain both listeners');
			let before = calls;
			f.mouse('mousemove', w + 20, h / 3, document.body);
			assert.equal(calls, before + 1);
			let updates = 0;
			f.u.hooks.setCursor = [() => updates++];
			f.mouse('mousemove', 3 * w / 4, 3 * h / 4);
			assert.equal(updates, 1, 'bubbling overlay movement updates the cursor once');
			assert.equal(bound.length, 2);
			leave();
			f.mouse('mousemove', 2 * w, 3 * h / 4, document.body);
			const retained = selection(f.u);
			f.mouse('mouseup', 2 * w, 3 * h / 4, document.body);
			assertSelection(f.u, retained);
			assert.equal(f.u.cursor.left, -10);
			assert.equal(attached.length, bound.length);
			assert.ok(attached.every(listener => removed.includes(listener)));
			f.mouse('mouseenter', w / 2, h / 2);
			f.mouse('mousedown', w / 2, h / 2);
			leave();
			f.destroy();
			assert.equal(attached.length, bound.length);
			assert.ok(attached.every(listener => removed.includes(listener)));
			before = calls;
			f.mouse('mousemove', 3 * w, h, document.body);
			f.mouse('mouseup', 3 * w, h, document.body);
			assert.equal(calls, before, 'destroy removes both document drag wrappers');
		}
		finally {
			f.destroy();
			document.addEventListener = originalAdd;
						document.removeEventListener = originalRemove;
		}
	});

	it('synchronizes outside selection, zoom, and cursor hiding', async () => {
		const source = await plot({ x: true, y: true }, 1, false, undefined, 'outside-xy');
		let targetBindings = 0;
		const target = await plot({ x: true, y: true }, 1, false, undefined, 'outside-xy', {}, {
			bind: { mousemove: (self, target, handle) => {
				if (target == document)
					targetBindings++;
				return handle;
			} },
		});
		try {
			const { width: w, height: h } = source.box();
			source.mouse('mousedown', w / 2, h / 2);
			source.mouse('mousemove', w - 5, h / 4);
			source.mouse('mouseleave', w + 5, h / 4);
			source.mouse('mousemove', 3 * w, 3 * h / 4, document.body);
			assert.deepEqual(selection(target.u), selection(source.u));
			source.mouse('mouseup', 3 * w, 3 * h / 4, document.body);
			await Promise.resolve();
			assert.deepEqual(ranges(source.u), { x: [50, 100], y: [25, 50] });
			assert.deepEqual(ranges(target.u), ranges(source.u));
			assert.equal(target.u.cursor.left, -10);
			assert.equal(target.u.cursor.idx, null);
			assert.equal(targetBindings, 0, 'synchronized peers do not track the document');
		}
		finally { source.destroy(); target.destroy(); }
	});

	for (const { name, x, y } of modes) {
		it(`uses bounded leave coordinates and supports re-entry for ${name}`, async () => {
			const f = await plot({ x, y, dist: 10, setRange: false });
			try {
				const { width: w, height: h } = f.box();
				f.mouse('mousedown', w / 2, h / 2);
				f.mouse('mousemove', w / 2 + 9, h / 2 + 9);
				assertSelection(f.u, emptySelection);
				// Leave without an intervening edge mousemove; do not infer direction from the last move.
				f.mouse('mouseleave', -3 * w, -3 * h);
				assertSelection(f.u, { left: 0, top: 0, width: x ? w / 2 : w, height: y ? h / 2 : h });
				f.mouse('mousemove', 4 * w, 4 * h, document.body);
				assertSelection(f.u, { left: x ? w / 2 : 0, top: y ? h / 2 : 0, width: x ? w / 2 : w, height: y ? h / 2 : h });
				f.mouse('mouseenter', w / 2 + 10, h / 2 + 10);
				f.mouse('mousemove', w / 2 + 10, h / 2 + 11);
				assertSelection(f.u, { left: x ? w / 2 : 0, top: y ? h / 2 : 0, width: x ? 10 : w, height: y ? 11 : h });
				f.mouse('mousemove', w - 1, h - 1);
				assert.equal(f.u.cursor.left, w, 'retains 1px snapping');
				assert.equal(f.u.cursor.top, h);
				f.mouse('mouseup', w - 1, h - 1, document);
				assert.equal(f.u.cursor.left, w, 'inside release is not hidden despite active tracking');
			}
			finally { f.destroy(); }
		});
	}

	it('hides an outside release without a preceding leave event', async () => {
		const f = await plot({ x: true, y: true, setRange: false });
		try {
			f.mouse('mousedown', 100, 100);
			f.mouse('mousemove', 150, 150);
			f.mouse('mouseup', -100, -100, document.body);
			assert.equal(f.u.cursor.left, -10);
		}
		finally { f.destroy(); }
	});

	it('preserves a locked cursor on outside release and unlocks on the next click', async () => {
		const f = await plot({ x: true, y: true, dist: 1000 }, 1, false, undefined, undefined, {}, { lock: true });
		try {
			f.mouse('mousedown', 100, 100);
			f.mouse('mousemove', -100, -100, document.body);
			f.mouse('mouseup', -100, -100, document.body);
			assert.equal(f.u.cursor._lock, true);
			const locked = [f.u.cursor.left, f.u.cursor.top];
			f.mouse('mouseenter', 150, 150);
			f.mouse('mousemove', 150, 150);
			assert.deepEqual([f.u.cursor.left, f.u.cursor.top], locked);
			f.mouse('mousedown', 150, 150);
			f.mouse('mousemove', 200, 200);
			assert.deepEqual([f.u.cursor.left, f.u.cursor.top], locked);
			f.mouse('mouseup', 200, 200, document);
			assert.equal(f.u.cursor._lock, false);
			assert.equal(f.u.cursor.left, 200);
		}
		finally { f.destroy(); }
	});

	for (const disabled of ['mousedown', 'mousemove', 'mouseup']) {
		it(`respects disabled ${disabled} bindings and cleans up on destroy`, async () => {
			let documentMoves = 0;
			const f = await plot({ x: true, y: true, setRange: false }, 1, false, undefined, undefined, {}, {
				bind: {
					mousemove: (self, target, handle) => e => {
						if (target == document)
							documentMoves++;
						handle(e);
					},
					[disabled]: () => null,
				},
			});
			try {
				f.mouse('mousedown', 100, 100);
				f.mouse('mousemove', 200, 200);
				if (disabled == 'mouseup')
					assertSelection(f.u, { left: 100, top: 100, width: 100, height: 100 });
				else
					assert.deepEqual(selection(f.u), emptySelection);
				f.mouse('mouseup', 200, 200, document);
				assert.equal(f.selections.length, 0);
				f.destroy();
				const before = documentMoves;
				f.mouse('mousemove', 300, 300, document.body);
				assert.equal(documentMoves, before);
			}
			finally { f.destroy(); }
		});
	}

	it('respects a bind callback that disables document mousemove', async () => {
		let attempts = 0;
		const f = await plot({ x: true, y: true, setRange: false }, 1, false, undefined, undefined, {}, {
			bind: { mousemove: (self, target, handle) => {
				if (target == document) {
					attempts++;
					return null;
				}
				return handle;
			} },
		});
		try {
			const { width: w, height: h } = f.box();
			f.mouse('mousedown', w / 2, h / 2);
			assert.equal(attempts, 1, 'binding is attempted on mousedown');
			f.mouse('mousemove', w - 5, h / 4);
			assert.equal(f.u.cursor.left, w - 5, 'disabled document binding preserves overlay movement');
			f.mouse('mouseleave', w + 5, h / 4);
			assert.equal(attempts, 1);
			const selected = selection(f.u);
			f.mouse('mousemove', 3 * w, 3 * h, document.body);
			assert.deepEqual(selection(f.u), selected);
			f.mouse('mouseup', 3 * w, 3 * h, document.body);
			assert.equal(f.u.cursor.left, -10);
		}
		finally { f.destroy(); }
	});

	for (const drag of [{ x: true, y: false }, { x: false, y: true }, { x: true, y: true, dist: 1000 }, { x: false, y: false }]) {
		it(`tracks enabled axes before their threshold ${JSON.stringify(drag)}`, async () => {
			const f = await plot({ ...drag, setRange: false });
			try {
				const { width: w, height: h } = f.box();
				f.mouse('mousedown', w / 2, h / 2);
				f.mouse('mousemove', w - 5, h / 4);
				f.mouse('mouseleave', w + 5, h / 4);
				f.mouse('mousemove', 2 * w, 3 * h / 4, document.body);
				if (drag.x || drag.y) {
					assert.equal(f.u.cursor.left, w);
					assertSelection(f.u, drag.dist ? emptySelection : {
						left: drag.x ? w / 2 : 0, top: drag.y ? h / 2 : 0,
						width: drag.x ? w / 2 : w, height: drag.y ? h / 4 : h,
					});
				}
				else
					assert.equal(f.u.cursor.left, -10);
				f.mouse('mouseup', 2 * w, 3 * h / 4, document.body);
			}
			finally { f.destroy(); }
		});
	}
});

describe('double-click scale reset', () => {
	for (const pxRatio of [1, 2]) {
		for (const { name, x, y } of modes) {
			it(`restores full data ranges after ${name} zoom at DPR ${pxRatio}`, async () => {
				const f = await plot({ x, y }, pxRatio, true);
				const { u, mouse, scales } = f;
				try {
					await dragMiddle(f);
					// X-only zoom also auto-ranges Y to the visible data window.
					assert.deepEqual(ranges(u), { x: x ? [25, 75] : [0, 100], y: [25, 75] });
					scales.length = 0;
					const { width: w, height: h } = f.box();
					const event = mouse('dblclick', w / 2, h / 2);
					assert.equal(u.cursor.event, event);
					assertSelection(u, emptySelection);
					await Promise.resolve();
					assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
					assert.deepEqual(scales.slice().sort(), x ? ['x', 'y'] : ['y']);
					assertSelection(u, emptySelection);
					mouse('mousemove', w / 4, h / 4);
					assertSelection(u, emptySelection, 'movement after reset does not resume dragging');
				}
				finally { f.destroy(); }
			});
		}
	}

	it('respects non-auto Y ranges when resetting X', async () => {
		const f = await plot({ x: true, y: true });
		const { u, mouse, scales } = f;
		try {
			await dragMiddle(f);
			assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
			scales.length = 0;
			mouse('dblclick', 100, 100);
			await Promise.resolve();
			assert.deepEqual(ranges(u), { x: [0, 100], y: [25, 75] });
			assert.deepEqual(scales, ['x']);
			assertSelection(u, emptySelection);
		}
		finally { f.destroy(); }
	});

	it('clears a retained selection when drag.setRange is false', async () => {
		const f = await plot({ x: true, y: true, setRange: false }, 1, true);
		const { u, mouse } = f;
		try {
			await dragMiddle(f);
			assertSelection(u, { left: 115, top: 87.5, width: 230, height: 175 });
			assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
			mouse('dblclick', 230, 175);
			assertSelection(u, emptySelection);
			await Promise.resolve();
			assertSelection(u, emptySelection);
			assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
		}
		finally { f.destroy(); }
	});

	for (const pxRatio of [1, 2]) {
		it(`resets after external resize and allows another drag at DPR ${pxRatio}`, async () => {
			const f = await plot({ x: true, y: true }, pxRatio, true);
			const { u, mouse } = f;
			try {
				await dragMiddle(f);
				assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
				u.setSize({ width: 800, height: 500 });
				await Promise.resolve();
				const resized = { ...u.bbox };
				assert.equal(f.box().width, 660);
				assert.equal(f.box().height, 450);
				mouse('dblclick', 330, 225);
				await Promise.resolve();
				assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
				assert.deepEqual(u.bbox, resized, 'reset does not restore the previous outer size');
				assertSelection(u, emptySelection);
				await dragMiddle(f);
				assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
				assert.deepEqual(f.selections[1], { left: 165, top: 112.5, width: 330, height: 225 });
			}
			finally { f.destroy(); }
		});
	}

	it('restores autosized axis widths after zoom and refreshes the next drag geometry', async () => {
		const f = await plot({ x: true }, 1, true, [
			{ size: 30 },
			{
				values: (self, splits) => splits.map(String),
				size: (self, labels) => 20 + Math.max(0, ...labels.map(label => self.ctx.measureText(label).width)),
			},
			{ scale: 'y', side: 1, size: 40 },
		]);
		const { u, mouse } = f;
		try {
			const initial = { ...u.bbox };
			const axisWidth = u.axes[1]._size;
			await dragMiddle(f);
			assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
			assert.ok(u.axes[1]._size < axisWidth, 'shorter labels shrink the vertical axis');
			assert.ok(u.bbox.width > initial.width);
			const zoomedRect = u.rect;
			mouse('dblclick', 100, 100);
			await Promise.resolve();
			assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
			assert.equal(u.axes[1]._size, axisWidth);
			assert.deepEqual(u.bbox, initial);
			assertSelection(u, emptySelection);
			await dragMiddle(f);
			assert.notEqual(u.rect, zoomedRect);
			assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] }, 'next drag uses the restored plot origin and width');
			assert.deepEqual(f.selections[1], f.selections[0]);
		}
		finally { f.destroy(); }
	});

	for (const button of [1, 2]) {
		it(`ignores button ${button} double-clicks without clearing the selection or resetting ranges`, async () => {
			const f = await plot({ x: true, y: true, setRange: false }, 1, true);
			const { u, mouse, scales, selections } = f;
			try {
				u.setScale('x', { min: 25, max: 75 });
				await Promise.resolve();
				await dragMiddle(f);
				const selected = selection(u);
				assert.ok(selected.width > 0 && selected.height > 0);
				assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
				scales.length = selections.length = 0;
				const previousEvent = u.cursor.event;
				mouse('dblclick', 100, 100, u.over, { button });
				await Promise.resolve();
				assert.equal(u.cursor.event, previousEvent);
				assertSelection(u, selected);
				assert.deepEqual(ranges(u), { x: [25, 75], y: [25, 75] });
				assert.deepEqual(scales, []);
				assert.deepEqual(selections, []);
				mouse('dblclick', 100, 100);
				await Promise.resolve();
				assert.deepEqual(ranges(u), { x: [0, 100], y: [0, 100] });
				assertSelection(u, emptySelection);
			}
			finally { f.destroy(); }
		});
	}
});
