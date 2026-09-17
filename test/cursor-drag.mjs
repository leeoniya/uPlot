import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
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

async function plot(drag = {}, pxRatio = 1, autoY = false, axes, syncKey) {
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
		cursor: { drag, sync: { key: syncKey } },
		series: [{}, { stroke: 'blue', points: { show: false } }],
		scales: {
			x: { time: false, range },
			y: { auto: autoY, range, ...(!autoY && { min: 0, max: 100 }) },
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

	it('refines only drag-generated bounds and commits an XY drag in one draw', async () => {
		const requests = [];
		let callbackSelf;
		const f = await plot({
			x: true,
			y: true,
			setScale: (self, key, limits) => {
				callbackSelf = self;
				requests.push([key, limits.min, limits.max]);
				return {
					min: Math.floor(limits.min / 20) * 20,
					max: Math.ceil(limits.max / 20) * 20,
				};
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
			assert.deepEqual(requests, [['x', 25, 75], ['y', 25, 75]]);
			assert.equal(f.draws.length, 1, 'XY requests commit in one draw');
			assert.deepEqual(ranges(f.u), { x: [20, 80], y: [20, 80] });

			f.u.batch(() => {
				f.u.setScale('x', { min: 0, max: 100 });
				f.u.setScale('y', { min: 0, max: 100 });
			});
			await Promise.resolve();
			requests.length = 0;
			await dragMiddle(f, true);
			assert.deepEqual(requests, [['x', 25, 75], ['y', 25, 75]], 'backward drag bounds are ordered');
		}
		finally { f.destroy(); }
	});

	it('uses each synchronized chart drag callback', async () => {
		const calls = [[], []];
		const source = await plot({
			x: true,
			y: false,
			setScale: (self, key, limits) => {
				calls[0].push([key, limits.min, limits.max]);
				return { min: 20, max: 80 };
			},
		}, 1, false, undefined, 'drag-scale-callbacks');
		const target = await plot({
			x: true,
			y: false,
			setScale: (self, key, limits) => {
				calls[1].push([key, limits.min, limits.max]);
				return { min: 30, max: 70 };
			},
		}, 1, false, undefined, 'drag-scale-callbacks');
		try {
			await dragMiddle(source);
			assert.deepEqual(calls, [[['x', 25, 75]], [['x', 25, 75]]]);
			assert.deepEqual(ranges(source.u), { x: [20, 80], y: [0, 100] });
			assert.deepEqual(ranges(target.u), { x: [30, 70], y: [0, 100] });
		}
		finally {
			source.destroy();
			target.destroy();
		}
	});

	it('cancels a drag scale when its callback returns null', async () => {
		const requests = [];
		const f = await plot({
			x: true,
			y: false,
			setScale: (self, key, limits) => {
				requests.push([key, limits.min, limits.max]);
				return null;
			},
		});
		try {
			await dragMiddle(f);
			assert.deepEqual(requests, [['x', 25, 75]]);
			assert.deepEqual(ranges(f.u), { x: [0, 100], y: [0, 100] });
		}
		finally { f.destroy(); }
	});

	it('does not call the drag callback for programmatic, automatic, or reset scale changes', async () => {
		let requests = 0;
		const f = await plot({
			x: true,
			y: false,
			setScale: (self, key, limits) => {
				requests++;
				return limits;
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

	it('retains the selection without zoom when setScale is false', async () => {
		const f = await plot({ x: true, y: true, setScale: false });
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
		const f = await plot({ x: true, y: false, dist: 10, setScale: false });
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
		const f = await plot({ setScale: false }, 1, true);
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

	it('clears a retained selection when drag.setScale is false', async () => {
		const f = await plot({ x: true, y: true, setScale: false }, 1, true);
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
			const f = await plot({ x: true, y: true, setScale: false }, 1, true);
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
