import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 16.05, 50, 73.2, 100], [0, 66.63, 50, 90, 100]];

async function plot({ one = false, pxRatio = 1, pxAlign = 1, pointWidth = 1, ori = 0, dir = 1, mode = 1, axisSize = 37, bbox, legendLive = true } = {}) {
	let xSide, ySide, xPos;
	if (ori == 0) {
		xSide = 2;
		ySide = 3;
		xPos = 'left';
	}
	else {
		xSide = 3;
		ySide = 2;
		xPos = 'top';
	}

	let values, dataIdx, filter;
	if (mode == 1) {
		values = data;
		dataIdx = null;
		filter = null;
	}
	else {
		values = [null, data];
		dataIdx = self => {
			const x = self.posToVal(self.cursor[xPos], 'x');
			return data[0].reduce((best, value, i) => Math.abs(value - x) < Math.abs(data[0][best] - x) ? i : best, 0);
		};
		filter = () => data[0].map((value, i) => i);
	}

	const u = new uPlot({
		mode, width: 203, height: 197, pxRatio,
		// A per-series override must take precedence over this chart-wide value.
		pxAlign: pxAlign == 1 ? 0 : 1,
		padding: [5.3, 7.2, 4.1, 11.4],
		legend: { show: false, live: legendLive },
		cursor: {
			focus: { prox: one ? Infinity : -1 },
			points: { one, bbox },
			dataIdx,
		},
		scales: {
			x: { time: false, ori, dir, range: [0, 100] },
			y: { ori: 1 - ori, dir, range: [0, 100] },
		},
		axes: [{ side: xSide, size: 23 }, { side: ySide, size: axisSize }],
		series: [{}, { stroke: 'green', width: 3, pxAlign, points: {
			show: true, size: 7, width: pointWidth,
			filter,
		} }],
	}, values, (self, init) => {
		self.ctx.measureText = text => ({ width: String(text).length * 8 });
		document.body.appendChild(self.root);
		init();
	});
	await Promise.resolve();
	return u;
}

function hover(u, idx, si = 1) {
	let dx, dy;
	if (u.mode == 1) {
		dx = u.data[0];
		dy = u.data[si];
	}
	else {
		dx = u.data[si][0];
		dy = u.data[si][1];
	}

	const x = u.valToPos(dx[idx], 'x');
	const y = u.valToPos(dy[idx], 'y');
	if (u.scales.x.ori == 0)
		u.setCursor({ left: x, top: y });
	else
		u.setCursor({ left: y, top: x });
}

// Read the actual arc and drawing transform, independently of the positioning
// helpers under test. The shared mock groups consecutive calls in one log entry.
function drawnCenter(u, idx, si) {
	const path = u.series[si].points._paths.fill;
	const arc = path.log.filter(entry => entry[0] == 'arc').flatMap(entry => entry.slice(1))[idx];
	let shift = [0, 0];
	let center;
	const stack = [];
	for (const [name, ...calls] of u.ctx.log) {
		for (const args of calls) {
			if (name == 'save')
				stack.push(shift.slice());
			else if (name == 'restore')
				shift = stack.pop();
			else if (name == 'translate')
				shift = [shift[0] + args[0], shift[1] + args[1]];
			else if ((name == 'fill' || name == 'stroke') && args[0] === path)
				center = [arc[0] + shift[0], arc[1] + shift[1]];
		}
	}
	assert.ok(center, 'point path was drawn');
	return center;
}

function assertAligned(u, idx, si = 1) {
	const pt = u.over.querySelectorAll('.u-cursor-pt')[u.cursor.points.one ? 0 : si - 1];
	assert.ok(!pt.classList.contains('u-off'), 'selected point stays visible, including at plot edges');
	const translate = pt.style.transform.match(/-?[\d.]+(?:e[+-]?\d+)?/gi).map(Number);
	const canvas = u.root.querySelector('canvas');
	const wrap = canvas.parentNode;
	const actual = [
		(translate[0] + parseFloat(pt.style.marginLeft) + parseFloat(pt.style.width) / 2 + parseFloat(u.over.style.left)) * canvas.width / parseFloat(wrap.style.width),
		(translate[1] + parseFloat(pt.style.marginTop) + parseFloat(pt.style.height) / 2 + parseFloat(u.over.style.top)) * canvas.height / parseFloat(wrap.style.height),
	];
	const expected = drawnCenter(u, idx, si);
	for (let i = 0; i < 2; i++)
		assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9, `${i == 0 ? 'x' : 'y'} center: DOM ${actual[i]}, canvas ${expected[i]}`);
}

describe('cursor point alignment', () => {
	for (const one of [false, true]) {
		for (const pxRatio of [1, 1.25, 1.5, 2, 3]) {
			it(`matches canvas centers with one=${one} at DPR ${pxRatio}`, async () => {
				for (const pxAlign of [0, 0.5, 1]) {
					for (const pointWidth of [0, 1, 1.5, 2]) {
						const u = await plot({ one, pxRatio, pxAlign, pointWidth });
						try {
							for (const idx of [1, 2, 3, 0, 4]) {
								hover(u, idx);
								assert.equal(u.cursor.idxs[1], idx);
								assertAligned(u, idx);
							}
						}
						finally { u.destroy(); }
					}
				}
			});
		}

		it(`reprojects stationary points after resize, axis sizing, and DPR changes with one=${one}`, async () => {
			let axisSize = 37;
			const u = await plot({ one, axisSize: () => axisSize });
			try {
				hover(u, 1);
				assertAligned(u, 1);
				for (const change of [
					() => u.setSize({ width: 311, height: 253 }),
					() => { axisSize = 63; u.redraw(false, true); },
					() => u.setPxRatio(1.25),
					() => u.setPxRatio(2),
				]) {
					change();
					// Requested dimensions/ratio must not affect a marker before commit.
					assertAligned(u, 1);
					await Promise.resolve();
					assert.equal(u.cursor.idxs[1], 1);
					assertAligned(u, 1);
					hover(u, 1);
					assertAligned(u, 1);
				}
			}
			finally { u.destroy(); }
		});

		it(`keeps missing values hidden and restores their markers with one=${one}`, async () => {
			const u = await plot({ one, pxRatio: 2 });
			try {
				hover(u, 1);
				const pt = u.over.querySelector('.u-cursor-pt');
				const missing = [data[0], data[1].slice()];
				missing[1][1] = null;
				u.setData(missing);
				await Promise.resolve();
				assert.ok(pt.classList.contains('u-off'));
				u.setSize({ width: 307, height: 251 });
				u.setPxRatio(1.25);
				await Promise.resolve();
				assert.ok(pt.classList.contains('u-off'));
				u.setData(data);
				await Promise.resolve();
				assertAligned(u, 1);
				u.setCursor({ left: -10, top: -10 });
				u.setPxRatio(2);
				await Promise.resolve();
				assert.ok(pt.classList.contains('u-off'));
				hover(u, 1);
				assertAligned(u, 1);
			}
			finally { u.destroy(); }
		});

		for (const custom of [false, true]) {
			it(`keeps a hidden cursor hidden on layout updates with one=${one}, custom bbox=${custom}, and no live legend`, async () => {
				const u = await plot({ one, legendLive: false, bbox: custom ? () => ({ left: 12, top: 23, width: 8, height: 12 }) : undefined });
				try {
					hover(u, 1);
					const pt = u.over.querySelector('.u-cursor-pt');
					assert.ok(!pt.classList.contains('u-off'));
					u.setCursor({ left: -10, top: -10 });
					assert.ok(pt.classList.contains('u-off'));
					u.setPxRatio(1.5);
					await Promise.resolve();
					assert.ok(pt.classList.contains('u-off'));
					u.setSize({ width: 311, height: 251 });
					await Promise.resolve();
					assert.ok(pt.classList.contains('u-off'));
					hover(u, 2);
					assert.ok(!pt.classList.contains('u-off'));
				}
				finally { u.destroy(); }
			});
		}

		it(`handles stale data indices during layout-only updates with one=${one}`, async () => {
			const u = await plot({ one });
			try {
				const pt = u.over.querySelector('.u-cursor-pt');
				for (const replacement of [[], [[0], [0]], [data[0], [0, null, 50, 90, 100]]]) {
					hover(u, 1);
					assertAligned(u, 1);
					u.setData(replacement, false);
					u.setPxRatio(u.pxRatio == 1 ? 1.5 : 1);
					await Promise.resolve();
					assert.ok(pt.classList.contains('u-off'));
					u.setData(data);
					await Promise.resolve();
				}
			}
			finally { u.destroy(); }
		});

		it(`preserves custom bbox positioning with one=${one}`, async () => {
			const u = await plot({ one, pxRatio: 1.25, bbox: () => ({ left: 12.3, top: 23.4, width: 8, height: 12 }) });
			try {
				hover(u, 1);
				const pt = u.over.querySelector('.u-cursor-pt');
				assert.equal(pt.style.transform, 'translate(13px,24px)');
				assert.equal(pt.style.marginLeft, '0px');
				assert.equal(pt.style.marginTop, '0px');
				assert.equal(pt.style.width, '8px');
				assert.equal(pt.style.height, '12px');
			}
			finally { u.destroy(); }
		});
	}

	for (const mode of [1, 2]) {
		for (const dir of [1, -1]) {
			it(`aligns rotated axes with mode=${mode} and dir=${dir}`, async () => {
				const u = await plot({ mode, dir, ori: 1, pxRatio: 1.25 });
				try {
					for (const idx of [0, 1, 3, 4]) {
						hover(u, idx);
						assertAligned(u, idx);
					}
				}
				finally { u.destroy(); }
			});
		}
	}

	it('uses the selected series snapping and stroke offset for a shared hover marker', async () => {
		const u = await plot({ one: true, pxRatio: 1.25 });
		try {
			u.addSeries({ stroke: 'blue', pxAlign: 0.5, points: { show: true, size: 9, width: 2.5 } });
			u.setData([...data, [20, 35, 65, 15, 80]]);
			await Promise.resolve();
			for (const si of [1, 2, 1]) {
				hover(u, 1, si);
				assert.equal(u.series[si]._focus, true);
				assertAligned(u, 1, si);
				await Promise.resolve();
				u.setPxRatio(u.pxRatio == 1.25 ? 2 : 1.25);
				await Promise.resolve();
				assertAligned(u, 1, si);
			}
		}
		finally { u.destroy(); }
	});

	it('does not reveal hidden points during layout or DPR changes', async () => {
		const u = await plot();
		try {
			hover(u, 1);
			u.setSeries(1, { show: false });
			await Promise.resolve();
			u.setSize({ width: 301, height: 211 });
			u.setPxRatio(1.5);
			await Promise.resolve();
			assert.ok(u.over.querySelector('.u-cursor-pt').classList.contains('u-off'));
		}
		finally { u.destroy(); }
	});
});
