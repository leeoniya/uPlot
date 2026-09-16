import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [2, 3, 5]];
const tick = () => Promise.resolve();
const bounds = (u, key) => [u.scales[key].min, u.scales[key].max];
const extrema = s => [s.min, s.max];
const reset = u => u.over.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
const modeData = (mode, values = data) => mode == 1 ? values : [null, values];

function plot(mode, scales = {}) {
	return new uPlot({
		width: 400,
		height: 300,
		mode,
		scales: {
			x: { time: false, ...scales.x },
			y: { range: [1, 10], ...scales.y },
		},
		series: [{}, { stroke: 'blue' }],
	}, modeData(mode), document.body);
}

function zoom(u) {
	u.batch(() => {
		u.setScale('x', { min: 0.5, max: 1.5 });
		u.setScale('y', { min: 2, max: 4 });
	});
	assert.deepEqual(bounds(u, 'x'), [0.5, 1.5]);
	assert.deepEqual(bounds(u, 'y'), [2, 4]);
}

describe('static range defaults', () => {
	for (const mode of [1, 2]) {
		for (const action of ['X zoom', 'setData', 'redraw', 'double-click']) {
			it(`mode ${mode}: ${action} restores static Y without scanning`, async () => {
				const u = plot(mode);
				try {
					await tick();
					assert.equal(u.scales.y.auto(u, false), true);
					assert.deepEqual(bounds(u, 'y'), [1, 10]);
					assert.deepEqual(extrema(u.series[1]), [null, null]);
					zoom(u);

					if (action == 'X zoom')
						u.setScale('x', { min: 0.25, max: 1.75 });
					else if (action == 'setData')
						u.setData(modeData(mode, [[0, 1, 2], [3, 4, 6]]));
					else if (action == 'redraw')
						u.redraw();
					else
						reset(u);

					await tick();
					assert.deepEqual(bounds(u, 'y'), [1, 10]);
					assert.deepEqual(extrema(u.series[1]), [null, null]);
					if (mode == 2)
						assert.deepEqual(extrema(u.series[1].facets[1]), [null, null]);
				}
				finally { u.destroy(); }
			});
		}

		it(`mode ${mode}: auto callback preserves Y zoom during explicit X changes`, async () => {
			const calls = [];
			const u = plot(mode, { y: {
				auto: (u, viaAutoScaleX) => {
					calls.push(viaAutoScaleX);
					return viaAutoScaleX;
				},
			} });
			try {
				await tick();
				zoom(u);
				calls.length = 0;
				for (const range of [[0.25, 1.75], [0, 1]]) {
					u.setScale('x', { min: range[0], max: range[1] });
					await tick();
					assert.deepEqual(bounds(u, 'x'), range);
					assert.deepEqual(bounds(u, 'y'), [2, 4]);
				}
				assert.deepEqual(calls, [false, false]);

				u.redraw();
				await tick();
				assert.deepEqual(bounds(u, 'y'), [2, 4]);

				// A public null-X request is not an automatic X reset.
				u.setScale('x', { min: null, max: null });
				await tick();
				assert.deepEqual(bounds(u, 'x'), [0, 2]);
				assert.deepEqual(bounds(u, 'y'), [2, 4]);

				calls.length = 0;
				reset(u);
				await tick();
				assert.ok(calls.includes(true));
				assert.deepEqual(bounds(u, 'y'), [1, 10]);

				zoom(u);
				u.setData(modeData(mode, [[0, 1, 2, 3], [2, 4, 6, 8]]));
				await tick();
				assert.deepEqual(bounds(u, 'x'), [0, 3]);
				assert.deepEqual(bounds(u, 'y'), [1, 10]);
				assert.deepEqual(extrema(u.series[1]), [null, null]);
			}
			finally { u.destroy(); }
		});

		it(`mode ${mode}: explicit auto:false still preserves Y until an explicit reset`, async () => {
			const u = plot(mode, { y: { auto: false } });
			try {
				await tick();
				zoom(u);
				reset(u);
				await tick();
				assert.deepEqual(bounds(u, 'y'), [2, 4]);
				u.setData(modeData(mode));
				await tick();
				assert.deepEqual(bounds(u, 'y'), [2, 4]);
				u.setScale('y', { min: null, max: null });
				await tick();
				assert.deepEqual(bounds(u, 'y'), [1, 10]);
			}
			finally { u.destroy(); }
		});

		for (const key of ['x', 'y']) {
			for (const scan of [undefined, false, true, 'custom']) {
				it(`mode ${mode}: static ${key} respects scan ${scan}`, async () => {
					let calls = 0;
					const scanner = scan == 'custom' ? (u, key, i0, i1) => {
						calls++;
						return uPlot.scan(u, key, i0, i1, true);
					} : scan;
					const range = key == 'x' ? [-1, 3] : [1, 10];
					const u = plot(mode, { [key]: { range, scan: scanner, auto: true } });
					try {
						await tick();
						assert.equal(u.scales[key].auto(u, false), true);
						assert.deepEqual(bounds(u, key), range);
						if (scan == 'custom')
							assert.equal(calls, 1);
						u.setData(modeData(mode, [[0, 1, 2], [3, 4, 6]]));
						await tick();
						assert.deepEqual(bounds(u, key), range);
						if (scan == 'custom')
							assert.equal(calls, 2);

						if (key == 'y' || mode == 2) {
							const owner = mode == 1 ? u.series[1] : u.series[1].facets[key == 'x' ? 0 : 1];
							const expected = scan === true || scan == 'custom' ? key == 'x' ? [0, 2] : [3, 6] : [null, null];
							assert.deepEqual(extrema(owner), expected);
						}
					}
					finally { u.destroy(); }
				});
			}
		}

		it(`mode ${mode}: static X still accepts zoom and restores its configured bounds`, async () => {
			const u = plot(mode, { x: { range: [-1, 3] } });
			try {
				await tick();
				zoom(u);
				reset(u);
				await tick();
				assert.deepEqual(bounds(u, 'x'), [-1, 3]);
				assert.deepEqual(bounds(u, 'y'), [1, 10]);
				zoom(u);
				u.setData(modeData(mode, [[10, 20], [3, 4]]));
				await tick();
				assert.deepEqual(bounds(u, 'x'), [-1, 3]);
			}
			finally { u.destroy(); }
		});

		for (const range of [[0, null], [null, 10]]) {
			it(`mode ${mode}: partial Y range ${JSON.stringify(range)} retains data scanning`, async () => {
				const u = plot(mode, { y: { range } });
				try {
					await tick();
					assert.deepEqual(extrema(u.series[1]), [2, 5]);
					assert.ok(u.scales.y.min <= 2 && u.scales.y.max >= 5);
					assert.equal(range[0] == null ? u.scales.y.max : u.scales.y.min, range[0] == null ? 10 : 0);
				}
				finally { u.destroy(); }
			});
		}
	}
});
