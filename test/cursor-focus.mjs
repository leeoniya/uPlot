import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const initial = [[0, 1, 2], [2, 2, 2], [8, 8, 8]];
const swapped = [initial[0], initial[2], initial[1]];

function state(u) {
	return {
		idxs: u.cursor.idxs.slice(),
		values: u.legend.values.map(v => v?._),
		alpha: u.series.slice(1).map(s => s.alpha),
	};
}

describe('cursor focus commit', () => {
	// Pre-existing on master (4aa4c1d8); deferred to the scheduler follow-up.
	it.skip('paints changed cursor-derived focus in the same data commit', async () => {
		const paints = [];
		const hooks = [];
		let draws = 0;
		const record = u => hooks.push(state(u));
		const getContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function(...args) {
			const ctx = getContext.apply(this, args);
			// The shared mock's methods are nonconfigurable. Forward through a
			// separate target so this test can observe actual stroke calls.
			return new Proxy({}, {
				get(target, key) {
					if (key == 'stroke') {
						return (...args) => {
							const si = u.series.findIndex(s => s._paths?.stroke === args[0]);
							if (si > 0)
								paints.push([si, ctx.globalAlpha ?? 1]);
							return ctx.stroke(...args);
						};
					}
					return ctx[key];
				},
				set(target, key, value) { ctx[key] = value; return true; },
			});
		};
		let u;
		try {
			u = new uPlot({
				width: 200, height: 200, pxRatio: 1,
				padding: [0, 0, 0, 0],
				axes: [{ show: false }, { show: false }],
				legend: { show: false },
				cursor: { focus: { prox: Infinity } },
				focus: { alpha: 0.25 },
				scales: { x: { time: false, range: [0, 2] }, y: { range: [0, 10] } },
				series: [{}, ...['red', 'blue'].map(stroke => ({
					stroke, value: (u, value) => value, points: { show: false },
				}))],
				hooks: {
					setCursor: [record],
					setLegend: [record],
					setSeries: [record],
					draw: [u => { draws++; record(u); }],
				},
			}, initial, document.body);
		}
		finally { HTMLCanvasElement.prototype.getContext = getContext; }
		try {
			await Promise.resolve();
			u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(2, 'y') });
			await Promise.resolve();
			assert.deepEqual(u.series.slice(1).map(s => s.alpha), [1, 0.25]);
			paints.length = hooks.length = 0;
			draws = 0;

			u.setData(swapped);
			await Promise.resolve();

			const expected = { idxs: [1, 1, 1], values: ['1', 8, 2], alpha: [0.25, 1] };
			assert.deepEqual(state(u), expected, 'logical state reflects the replacement data');
			assert.equal(draws, 1);
			await Promise.resolve();
			await Promise.resolve();
			assert.equal(draws, 1, 'no focus-only follow-up draw');
			assert.deepEqual(paints, [[1, 0.25], [2, 1]], 'actual strokes use the newly resolved focus');
			assert.ok(hooks.length > 0);
			for (const observed of hooks)
				assert.deepEqual(observed, expected);
		}
		finally { u.destroy(); }
	});
});
