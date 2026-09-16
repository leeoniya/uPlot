import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';

const nextCommit = () => Promise.resolve();

function makePlot(opts, data) {
	return new uPlot({
		width: 400,
		height: 300,
		series: [{}, { stroke: 'blue' }],
		...opts,
	}, data, document.body);
}

describe('scale range issue reproductions', () => {
	it('#823 retains and restores the full-domain Y range through a custom scale scan', async () => {
		const scans = [];
		const data = [
			[0, 1, 2, 3, 4],
			[10, 20, 30, 40, 50],
			[100, 200, 300, 400, 500],
		];
		const u = makePlot({
			scales: {
				x: { time: false },
				y: {
					auto: (u, viaAutoScaleX) => viaAutoScaleX,
					scan: (u, scaleKey, i0, i1) => {
						scans.push([scaleKey, i0, i1]);
						return uPlot.scan(u, scaleKey, null, null, true);
					},
					range: (u, min, max) => [min, max],
				},
			},
			series: [
				{},
				{ stroke: 'blue' },
				{ stroke: 'red', show: false },
			],
		}, data);
		try {
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 50]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [10, 50]);
			assert.deepStrictEqual([u.series[2].min, u.series[2].max], [null, null]);
			assert.deepStrictEqual(scans, [['y', 0, 4]]);

			u.setScale('x', { min: 0, max: 1 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 50]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [10, 50]);

			u.setSeries(2, { show: true });
			await nextCommit();
			assert.deepStrictEqual(scans, [['y', 0, 4], ['y', 0, 1]]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 500]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [10, 50]);
			assert.deepStrictEqual([u.series[2].min, u.series[2].max], [100, 500]);
			assert.deepStrictEqual(uPlot.scan(u, 'y', 0, 1), [10, 200]);
			assert.deepStrictEqual(uPlot.scan(u, 'y'), [10, 500]);
		}
		finally {
			u.destroy();
		}
	});

	it('#808 scans static-range data only when scan is enabled', async () => {
		const data = [[0, 1, 2], [-12, 0, 12]];
		const withoutScan = makePlot({
			scales: {
				x: { time: false },
				y: { range: [-12, 12] },
			},
		}, data);
		try {
			await nextCommit();
			assert.deepStrictEqual([withoutScan.scales.y.min, withoutScan.scales.y.max], [-12, 12]);
			assert.deepStrictEqual([withoutScan.series[1].min, withoutScan.series[1].max], [null, null]);

			const clip = withoutScan.ctx.log.find(entry => entry[0] == 'clip')[1][0];
			const rect = clip.log.find(entry => entry[0] == 'rect')[1];
			assert.deepStrictEqual(rect, [
				withoutScan.bbox.left - 0.5,
				withoutScan.bbox.top - 0.5,
				withoutScan.bbox.width + 1,
				withoutScan.bbox.height + 1,
			]);
		}
		finally {
			withoutScan.destroy();
		}

		const withScan = makePlot({
			scales: {
				x: { time: false },
				y: { range: [-12, 12], scan: true },
			},
		}, data);
		try {
			await nextCommit();
			assert.deepStrictEqual([withScan.scales.y.min, withScan.scales.y.max], [-12, 12]);
			assert.deepStrictEqual([withScan.series[1].min, withScan.series[1].max], [-12, 12]);
		}
		finally {
			withScan.destroy();
		}
	});

	it('#915 keeps a static Y zoom on double-click but supports an explicit static-range reset', async () => {
		const u = makePlot({
			mode: 2,
			scales: {
				x: { time: false },
				y: { range: [1, 10] },
			},
		}, [null, [[0, 1, 2], [2, 3, 5]]]);
		try {
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [1, 10]);

			u.setScale('y', { min: 2, max: 4 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [2, 4]);

			u.over.dispatchEvent(new MouseEvent('dblclick', {
				bubbles: true,
				cancelable: true,
				button: 0,
			}));
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [2, 4]);

			u.setScale('y', { min: null, max: null });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [1, 10]);
		}
		finally {
			u.destroy();
		}
	});

	it('#1133 updates a dynamic range through explicit recalculation without scanning', async () => {
		let range = [0, 10];
		let calls = 0;
		const u = makePlot({
			scales: {
				x: { time: false },
				y: {
					auto: false,
					scan: false,
					range: () => {
						calls++;
						return range;
					},
				},
			},
		}, [[0, 1, 2], [2, 3, 5]]);
		try {
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 10]);
			assert.equal(calls, 1);

			range = [0, 20];
			u.redraw();
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 10]);
			assert.equal(calls, 1);

			u.setScale('y', { min: null, max: null });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 20]);
			assert.equal(calls, 2);

			u.setScale('y', { min: -5, max: 5 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [-5, 5]);
			assert.equal(calls, 2);
		}
		finally {
			u.destroy();
		}
	});

	it('#648 recalculates Y for automatic X resets but retains it during explicit X zoom', async () => {
		const u = makePlot({
			scales: {
				x: { time: false },
				y: {
					auto: (u, viaAutoScaleX) => viaAutoScaleX,
					range: (u, min, max) => [min, max],
				},
			},
		}, [[0, 1, 2], [10, 20, 30]]);
		try {
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 30]);

			u.setScale('x', { min: 0, max: 1 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 30]);

			u.setData([[0, 1, 2], [100, 200, 300]]);
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [100, 300]);
		}
		finally {
			u.destroy();
		}
	});

	it('#650 calculates full candidate Y bounds without changing the current view', async () => {
		const u = makePlot({
			scales: {
				x: { time: false },
				y: {
					range: (u, min, max) => [min - 1, max + 1],
				},
			},
		}, [[0, 1, 2], [10, 20, 30]]);
		try {
			await nextCommit();
			u.setScale('y', { min: 15, max: 25 });
			await nextCommit();

			const extrema = [u.series[1].min, u.series[1].max];
			const dataRange = uPlot.scan(u, 'y');
			const scaleRange = u.scales.y.range(u, dataRange[0], dataRange[1], 'y');

			assert.deepStrictEqual(dataRange, [10, 30]);
			assert.deepStrictEqual(scaleRange, [9, 31]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [15, 25]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], extrema);
		}
		finally {
			u.destroy();
		}
	});

	it('#655 preserves initial concrete Y bounds when auto is false', async () => {
		const u = makePlot({
			scales: {
				x: { time: false },
				y: {
					auto: false,
					min: -15,
					max: 15,
				},
			},
		}, [[0, 1, 2], [-10, 0, 10]]);
		try {
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [-15, 15]);

			u.setScale('x', { min: 0, max: 1 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [-15, 15]);

			u.setData([[0, 1, 2], [-100, 0, 100]]);
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [-15, 15]);
		}
		finally {
			u.destroy();
		}
	});
});
