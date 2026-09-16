import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

	it('#1133 supports data-only, combined, and backend-only updates without scanning', async () => {
		let range = [0, 10];
		let calls = 0;
		const u = makePlot({
			scales: {
				x: { time: false },
				y: {
					scan: false,
					range: (u, min, max) => {
						assert.deepStrictEqual([min, max], [null, null]);
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

			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [null, null]);

			const dataOnly = [[0, 1, 2], [4, 6, 8]];
			u.setData(dataOnly);
			await nextCommit();
			assert.strictEqual(u.data, dataOnly);
			assert.deepStrictEqual(range, [0, 10]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 10]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [null, null]);
			assert.equal(calls, 2);

			range = [0, 20];
			const combinedData = [[0, 1, 2], [2, 3, 5]];
			u.setData(combinedData);
			await nextCommit();
			assert.strictEqual(u.data, combinedData);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 20]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [null, null]);
			assert.equal(calls, 3);

			range = [0, 10];
			u.redraw();
			await nextCommit();
			assert.strictEqual(u.data, combinedData);
			assert.deepStrictEqual(u.data, [[0, 1, 2], [2, 3, 5]]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 10]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [null, null]);
			assert.equal(calls, 4);

			u.setScale('x', { min: 0, max: 1 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 10]);
			assert.equal(calls, 5);

			u.setScale('y', { min: -5, max: 5 });
			await nextCommit();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [-5, 5]);
			assert.equal(calls, 5);
		}
		finally {
			u.destroy();
		}
	});

	it('#1133 demo buttons change only their intended state on repeated and mixed clicks', async () => {
		const html = readFileSync(new URL('../demos/issues/issue-1133-dynamic-backend-range.html', import.meta.url), 'utf8');
		const fixture = document.createElement('div');
		fixture.innerHTML = html.match(/<body>([\s\S]*?)<script>/)[1];
		document.body.append(fixture);

		const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
		const { u, getRange, getCalls } = new Function('uPlot', 'document', script + `
			return { u, getRange: () => backendRange, getCalls: () => rangeCalls };
		`)(uPlot, fixture);

		try {
			await nextCommit();
			assert.equal(fixture.querySelectorAll('button').length, 3);

			const buttons = ['data-only', 'range-only', 'range-and-data'];
			const clicks = [
				...buttons.flatMap(id => Array(4).fill(id)),
				...buttons,
				...buttons.slice().reverse(),
			];

			for (const id of clicks) {
				const dataBefore = u.data;
				const valuesBefore = u.data.map(column => column.slice());
				const rangeBefore = getRange();
				const xBefore = [u.scales.x.min, u.scales.x.max];
				const yBefore = [u.scales.y.min, u.scales.y.max];
				const positionsBefore = u.data[1].map(value => u.valToPos(value, 'y'));
				const callsBefore = getCalls();

				fixture.querySelector('#' + id).click();
				await nextCommit();

				if (id == 'range-only') {
					assert.strictEqual(u.data, dataBefore, id);
					assert.deepStrictEqual(u.data, valuesBefore, id);
				}
				else {
					assert.notStrictEqual(u.data, dataBefore, id);
					assert.notDeepStrictEqual(u.data[1], valuesBefore[1], id);
				}

				if (id == 'data-only') {
					assert.strictEqual(getRange(), rangeBefore, id);
					assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], yBefore, id);
				}
				else
					assert.deepStrictEqual(getRange(), [0, rangeBefore[1] == 10 ? 20 : 10], id);

				assert.deepStrictEqual(u.data[0], valuesBefore[0], id);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], xBefore, id);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], getRange(), id);
				assert.equal(getCalls(), callsBefore + 1, id);
				assert.deepStrictEqual([u.series[1].min, u.series[1].max], [null, null], id);
				assert.ok(u.data[1].every(value => value > u.scales.y.min && value < u.scales.y.max), id);

				const positionsAfter = u.data[1].map(value => u.valToPos(value, 'y'));
				assert.ok(positionsAfter.some((value, i) => Math.abs(value - positionsBefore[i]) > 10), id);

				const status = JSON.parse(fixture.querySelector('#status').textContent.split('\n\n')[1]);
				assert.deepStrictEqual(status.data, u.data[1], id);
				assert.deepStrictEqual(status.backendRange, getRange(), id);
				assert.deepStrictEqual(status.x, xBefore, id);
				assert.deepStrictEqual(status.y, getRange(), id);
				assert.equal(status.rangeCalls, getCalls(), id);
			}
		}
		finally {
			u.destroy();
			fixture.remove();
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
