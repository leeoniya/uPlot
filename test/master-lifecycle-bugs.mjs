import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

// Baseline: master 4aa4c1d801fe6f61c07881f037411807bdd3a26b.
// These regressions stay skipped until the lifecycle bugs are fixed.
function plot(cursor = {}, hooks = {}) {
	return new uPlot({
		width: 240,
		height: 160,
		pxRatio: 1,
		padding: [0, 0, 0, 0],
		legend: { show: false, live: false },
		axes: [{ show: false }, { show: false }],
		scales: {
			x: { time: false, range: [0, 2] },
			y: { range: [0, 3] },
		},
		series: [{}, { stroke: 'blue', points: { show: false } }],
		cursor,
		hooks,
	}, [[0, 1, 2], [1, 2, 1]], document.body);
}

function deletionError(u) {
	try {
		u.delSeries(1);
		return '';
	}
	catch (error) {
		return `${error.name}: ${error.message}`;
	}
}

async function drainCommits() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	// The current legend renders on a frame; master renders it synchronously.
	await new Promise(requestAnimationFrame);
}

function strokeCount(ctx) {
	return ctx.log.reduce((count, entry) => count + (entry[0] == 'stroke' ? entry.length - 1 : 0), 0);
}

describe('master lifecycle bugs (4aa4c1d801fe6f61c07881f037411807bdd3a26b)', () => {
	// delSeries calls remove() on the null slot reserved for a shared cursor point.
	it.skip('delSeries preserves the shared cursor point when deleting a null point slot', async () => {
		let deleted = 0;
		const u = plot({ points: { one: true }, focus: { prox: Infinity } }, {
			delSeries: [() => deleted++],
		});
		try {
			await Promise.resolve();
			const point = u.over.querySelector('.u-cursor-pt');
			assert.equal(point instanceof HTMLElement, true);
			assert.equal(deletionError(u), '', 'deleting a shared-point null slot must not throw');
			assert.equal(u.series.length, 1);
			assert.equal(deleted, 1);
			assert.equal(u.over.querySelector('.u-cursor-pt') === point, true);
		}
		finally { u.destroy(); }
	});

	// initCursorPt returns undefined when the custom callback supplies no HTMLElement.
	it.skip('delSeries accepts a custom cursor points.show returning no HTMLElement', async () => {
		let shown = 0;
		let deleted = 0;
		const u = plot({ points: { show: () => { shown++; return null; } } }, {
			delSeries: [() => deleted++],
		});
		try {
			await Promise.resolve();
			assert.equal(shown, 1);
			assert.equal(u.over.querySelector('.u-cursor-pt') === null, true);
			assert.equal(deletionError(u), '', 'deleting a series without a cursor HTMLElement must not throw');
			assert.equal(u.series.length, 1);
			assert.equal(deleted, 1);
		}
		finally { u.destroy(); }
	});

	// Deleting the focused series leaves the remaining series and legend dimmed.
	it.skip('delSeries clears focus opacity after deleting the focused Y series and committing matching data', async () => {
		const data = [[0, 1, 2], [1, 2, 1], [2, 1, 2]];
		const u = new uPlot({
			width: 240, height: 160, pxRatio: 1,
			padding: [0, 0, 0, 0],
			axes: [{ show: false }, { show: false }],
			legend: { show: true, live: false },
			// Explicit focus must not be repaired by a new cursor hover during commit.
			cursor: { focus: { prox: -1 }, points: { one: false } },
			focus: { alpha: 0.25 },
			scales: {
				x: { time: false, range: [0, 2] },
				y: { range: [0, 3] },
			},
			series: [
				{},
				{ class: 'remaining', stroke: 'blue', points: { show: false } },
				{ stroke: 'red', points: { show: false } },
			],
		}, data, document.body);
		const legendOpacity = () => Number(u.root.querySelector('.u-legend .remaining').style.opacity || 1);
		try {
			await drainCommits();
			const remaining = u.series[1];
			assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 2);
			assert.equal(u.series[1].alpha, 1);
			assert.equal(legendOpacity(), 1);

			u.setSeries(2, { focus: true });
			await drainCommits();
			assert.equal(u.series[2].alpha, 1);
			assert.equal(u.series[1].alpha, 0.25);
			assert.equal(legendOpacity(), 0.25);

			u.delSeries(2);
			u.setData([data[0], data[1]]);
			await drainCommits();
			assert.equal(u.series.length, 2);
			assert.equal(u.data.length, 2);
			assert.equal(u.series[1] === remaining, true);
			assert.equal(
				`alpha=${u.series[1].alpha}, legendOpacity=${legendOpacity()}`,
				'alpha=1, legendOpacity=1',
				'deleting the focused series must restore unfocused opacity after matching data commits',
			);
		}
		finally { u.destroy(); }
	});

	// destroy clears listener bookkeeping without removing the document mouseup listener.
	it.skip('destroy during a drag detaches the document mouseup listener', async () => {
		let destroyed = false;
		let mouseups = 0;
		let listener;
		let targetIsDocument = false;
		const u = plot({
			drag: { x: true, y: false },
			bind: {
				mouseup: (self, target, callback) => {
					targetIsDocument = target === document;
					return listener = event => {
						mouseups++;
						// Count leaked dispatches without forwarding to a destroyed chart.
						if (!destroyed)
							callback(event);
					};
				},
			},
		}, { destroy: [() => { destroyed = true; }] });
		try {
			await Promise.resolve();
			u.over.getBoundingClientRect = () => new DOMRect(0, 0, 240, 160);
			u.syncRect();
			u.over.dispatchEvent(new MouseEvent('mousedown', {
				bubbles: true, button: 0, buttons: 1, clientX: 40, clientY: 40,
			}));
			assert.equal(typeof listener, 'function', 'mousedown must install a mouseup listener');
			assert.equal(targetIsDocument, true);
			u.destroy();
			assert.equal(destroyed, true);
			document.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 80, clientY: 40 }));
			assert.equal(mouseups, 0, 'document mouseup must not reach the bound callback after destroy');
		}
		finally {
			const needsDestroy = !destroyed;
			destroyed = true;
			if (listener)
				document.removeEventListener('mouseup', listener);
			if (needsDestroy)
				u.destroy();
		}
	});

	// The active commit continues through drawOrder and draw after drawClear destroys it.
	it.skip('destroy in drawClear stops the active commit before subsequent paint or draw hooks', async () => {
		let armed = false;
		let destroyed = false;
		let strokesAtDestroy = 0;
		let seriesAfterDestroy = 0;
		let drawsAfterDestroy = 0;
		const u = plot({}, {
			drawClear: [self => {
				if (armed) {
					strokesAtDestroy = strokeCount(self.ctx);
					self.destroy();
				}
			}],
			destroy: [() => { destroyed = true; }],
			drawSeries: [() => { if (destroyed) seriesAfterDestroy++; }],
			draw: [() => { if (destroyed) drawsAfterDestroy++; }],
		});
		try {
			await Promise.resolve();
			assert.equal(strokeCount(u.ctx) > 0, true, 'the fixture must paint a series before destruction');
			armed = true;
			u.redraw();
			await Promise.resolve();
			assert.equal(destroyed, true, 'the active commit must reach drawClear');
			const strokesAfterDestroy = strokeCount(u.ctx) - strokesAtDestroy;
			assert.equal(
				`strokes=${strokesAfterDestroy}, drawSeries=${seriesAfterDestroy}, draw=${drawsAfterDestroy}`,
				'strokes=0, drawSeries=0, draw=0',
				'destroy in drawClear must stop subsequent paint and draw hooks',
			);
		}
		finally {
			if (!destroyed)
				u.destroy();
		}
	});
});
