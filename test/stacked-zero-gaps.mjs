import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { createComparison, zeroIntervals, zeroGaps, zeroStrokePaths } from '../demos/stacked-zero-gaps.js';

describe('stacked zero-value stroke gaps', () => {
	it('gaps zero runs, including edges, but not isolated zeros or nulls', () => {
		assert.deepEqual(zeroIntervals([0, 1, 2, 3, 4, 5, 6, 7], [0, 0, 2, 0, 3, 0, 0, 0]), [[0, 1], [5, 7]]);
		assert.deepEqual(zeroIntervals([0, 1, 2], [0, null, 0]), []);
		assert.deepEqual(zeroIntervals([0, 1, 2], [0, 0, 0]), [[0, 2]]);
	});

	it('converts to canvas coordinates and merges existing gaps without mutating them', () => {
		const gaps = [[15, 25]];
		const chart = { series: [{ scale: 'x' }], valToPos: (x, scale, canvas) => {
			assert.equal(scale, 'x');
			assert.equal(canvas, true);
			return 30 - x * 10;
		} };
		assert.deepEqual(zeroGaps([[0, 1], [1, 2]])(chart, 1, 0, 2, gaps), [[10, 30]]);
		assert.deepEqual(gaps, [[15, 25]]);
	});

	it('preserves the native paths and clip returned by linear', () => {
		const previous = globalThis.uPlot;
		const native = { clip: new Path2D(), fill: new Path2D(), gaps: [[1, 2]] };
		globalThis.uPlot = { paths: { linear: () => () => native }, clipGaps: uPlot.clipGaps };
		try {
			const clip = native.clip;
			const chart = {
				series: [{ scale: 'x' }], scales: { x: { ori: 0 } },
				bbox: { left: 10, top: 20, width: 100, height: 50 },
				valToPos: x => 10 + x * 10,
			};
			assert.equal(zeroStrokePaths([[2, 5]])(chart, 1, 0, 6), native);
			assert.equal(native.clip, clip);
			assert.deepEqual(native.gaps, [[1, 2]]);
			assert.ok(native.clipStroke != null);
		}
		finally { globalThis.uPlot = previous; }
	});

	for (const pxRatio of [1, 2]) {
	for (const ori of [0, 1]) {
	for (const dir of [1, -1]) {
		it(`compares fill and stroke clips at DPR ${pxRatio}, orientation ${ori}, direction ${dir}`, async () => {
			const previous = globalThis.uPlot;
			globalThis.uPlot = class extends uPlot {
				constructor(opts, data, target) {
									opts.scales.x = { ...opts.scales.x, ori, dir };
									opts.scales.y = { ...opts.scales.y, ori: 1 - ori };
									super({ ...opts, pxRatio }, data, target);
								}
			};
			let plots = [];
			try {
				plots = createComparison();
				await Promise.resolve();
				const [ordinary, naive, gapped, custom] = plots;
				assert.equal(plots.length, 4);
				assert.deepEqual(plots.map(p => p.series.length), [4, 4, 7, 4]);
				assert.deepEqual(ordinary.data, gapped.data.slice(0, 4));
				assert.deepEqual(ordinary.data, naive.data);
				assert.deepEqual(ordinary.data, custom.data);
				function check() {
					for (let i = 1; i <= 3; i++) {
						const fill = gapped.series[i]._paths;
												const paths = custom.series[i]._paths;
												assert.equal(paths.clip, null, 'custom fills retain native clipping');
												assert.deepEqual(paths.gaps, []);
												assert.deepEqual(paths.fill.log, ordinary.series[i]._paths.fill.log);
												assert.deepEqual(paths.stroke.log, ordinary.series[i]._paths.stroke.log);
												assert.ok(Object.hasOwn(paths, 'clipStroke'));
												for (const plot of [ordinary, naive, gapped])
													assert.equal(plot.series[i]._paths.clipStroke, undefined);
												assert.equal(gapped.series[i + 3]._paths.clipStroke, undefined);
												assert.deepEqual(paths.clipStroke?.log, gapped.series[i + 3]._paths.clip?.log);
												if (i > 1)
													assert.ok(naive.series[i]._paths.clip != null, 'naive clips affect filled series');
						assert.equal(fill.clip, null, 'fill layers never acquire artificial gaps');
						assert.deepEqual(fill.fill.log, ordinary.series[i]._paths.fill.log);
						assert.equal(gapped.series[i].width, 0);
						const overlay = gapped.series[i + 3]._paths;
						assert.equal(gapped.series[i + 3]._fill, null);
						assert.equal(overlay.band, null);
					}
					const middle = gapped.series[5]._paths;
					const expected = [[2, 5], [11, 12]]
											.map(pair => pair.map(x => gapped.valToPos(x, 'x', true)).sort((a, b) => a - b))
											.sort((a, b) => a[0] - b[0]);
					assert.deepEqual(middle.gaps, expected);
					assert.ok(middle.clip != null);
					assert.deepEqual(gapped.series[4]._paths.gaps, []);
				}
				check();
				for (const plot of plots) {
					plot.setSize({ width: 650, height: 280 });
					plot.setScale('x', { min: 3, max: 10 });
				}
				await Promise.resolve();
				check();
			}
			finally {
				plots.forEach(plot => plot.destroy());
				globalThis.uPlot = previous;
			}
		});
	}
	}
	}
});
