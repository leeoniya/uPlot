import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[1, 2, 3], [-100, 1, 100]];

function plot(scales, mode = 1) {
	return new uPlot({
		width: 600,
		height: 400,
		mode,
		scales: { x: { time: false }, ...scales },
		series: [{}, { stroke: 'blue' }],
	}, mode == 1 ? data : [null, data], document.body);
}

function checkTransform(u, key, threshold) {
	const sc = u.scales[key];
	assert.equal(sc._asinh, threshold);
	assert.equal(sc._min, Math.asinh(sc.min / threshold));
	assert.equal(sc._max, Math.asinh(sc.max / threshold));
	const value = 2;
	const pct = (Math.asinh(value / threshold) - sc._min) / (sc._max - sc._min);
	assert.equal(sc.valToPct(value), pct);
	assert.ok(Math.abs(u.posToVal(u.valToPos(value, key), key) - value) < 1e-10);
}

describe('adaptive asinh', () => {
	it('normalizes numeric settings, including dependent overrides', async () => {
		const u = plot({
			x: { time: false, distr: 4 },
			y: { distr: 4, asinh: 10 },
			other: { from: 'y', asinh: 2, range: (u, min, max) => [min, max] },
		});
		try {
			await Promise.resolve();
			assert.equal(typeof u.scales.x.asinh, 'function');
			assert.equal(typeof u.scales.y.asinh, 'function');
			assert.equal(u.scales.y.asinh(u, 'y'), 10);
			assert.equal(typeof u.scales.other.asinh, 'function');
			assert.equal(u.scales.other.asinh(u, 'other'), 2);
			checkTransform(u, 'other', 2);
			checkTransform(u, 'x', 1);
			checkTransform(u, 'y', 10);
		}
		finally { u.destroy(); }
	});

	for (const mode of [1, 2]) {
		it(`scans ${mode == 1 ? 'in-view' : 'full-array'} matching Y data by default (mode ${mode})`, async () => {
			const x = [0.001, 1, 2];
			const aligned = [x, [0, null, 5], [0.001, -0.25, 4], [0, 0.01, 0.02]];
			const toData = values => mode == 1 ? values : [null, ...values.slice(1).map(y => [values[0], y])];
			const series = [{}, { stroke: 'blue' }, { show: false, scan: false }, mode == 1
				? { scale: 'other' }
				: { facets: [{ scale: 'x' }, { scale: 'other' }] }];
			const u = new uPlot({
				width: 600,
				height: 400,
				mode,
				series,
				scales: {
					x: { time: false, min: 1, max: 2, auto: false, range: (u, min, max) => [min, max] },
					y: { distr: 4, range: () => [-10, 10] },
					other: {},
				},
			}, toData(aligned), document.body);
			try {
				await Promise.resolve();
				checkTransform(u, 'y', mode == 1 ? 0.25 : 1);
				const asinh = u.scales.y.asinh;
				u.setScale('x', { min: 0.001, max: 2 });
				await Promise.resolve();
				checkTransform(u, 'y', 1);
				u.setScale('x', { min: 1, max: 2 });
				await Promise.resolve();
				checkTransform(u, 'y', mode == 1 ? 0.25 : 1);
				u.setData(toData([x, [-0.125, 2, 3], [4, 5, 6], aligned[3]]), false);
				u.redraw();
				await Promise.resolve();
				checkTransform(u, 'y', mode == 1 ? 2 : 0.125);
				assert.equal(u.scales.y.asinh, asinh);
				for (const values of [[-0.01, 0, 2], [null, undefined, null], []]) {
					u.setData(toData([x, values, [], aligned[3]]), false);
					u.redraw();
					await Promise.resolve();
					checkTransform(u, 'y', 1);
				}
			}
			finally { u.destroy(); }
		});

		for (const fixed of [{ range: [-100, 100] }, { auto: false, min: -100, max: 100 }]) {
			for (const asinh of [undefined, 10]) {
				it(`keeps a static threshold with ${fixed.range ? 'fixed range' : 'auto: false'} and asinh ${asinh} (mode ${mode})`, async () => {
					const y = { distr: 4, ...fixed };
					if (asinh != null)
						y.asinh = asinh;
					const u = plot({ y }, mode);
					try {
						await Promise.resolve();
						checkTransform(u, 'y', asinh ?? 1);
						const next = [[1, 2, 3], [-100, 0.01, 100]];
						u.setData(mode == 1 ? next : [null, next]);
						await Promise.resolve();
						checkTransform(u, 'y', asinh ?? 1);
						u.setScale('x', { min: 2, max: 3 });
						await Promise.resolve();
						checkTransform(u, 'y', asinh ?? 1);
					}
					finally { u.destroy(); }
				});
			}
		}

		for (const resetScales of [true, false]) {
			it(`updates transforms, ticks, and paths with unchanged auto-range bounds (mode ${mode}, reset ${resetScales})`, async () => {
				const calls = [];
				const asinh = (u, key) => {
					calls.push([u.data, key]);
					return mode == 1 ? u.data[1][1] : u.data[1][1][1];
				};
				const u = plot({ y: { distr: 4, range: () => [-100, 100], asinh } }, mode);
				try {
					await Promise.resolve();
					assert.equal(u.scales.y.asinh, asinh);
					assert.equal(calls.length, 1);
					checkTransform(u, 'y', 1);
					const paths = u.series[1]._paths;
					const splits = u.axes[1]._splits.slice();
					const next = mode == 1 ? [[1, 2, 3], [-100, 10, 100]] : [null, [[1, 2, 3], [-100, 10, 100]]];
					u.setData(next, resetScales);
					if (!resetScales)
						u.redraw();
					await Promise.resolve();
					assert.equal(calls.length, 2);
					assert.deepEqual(calls[1], [next, 'y']);
					checkTransform(u, 'y', 10);
					assert.equal(u.scales.y.min, -100);
					assert.equal(u.scales.y.max, 100);
					assert.notEqual(u.series[1]._paths, paths);
					assert.notDeepEqual(u.axes[1]._splits, splits);
					u.redraw(true, true);
					await Promise.resolve();
					assert.equal(calls.length, 3);
				}
				finally { u.destroy(); }
			});
		}
	}

	it('updates x and dependent scales, including empty data', async () => {
		const calls = [];
		const asinh = (u, key) => {
			calls.push(key);
			return u.data[0].length || 1;
		};
		const u = plot({
			x: { time: false, distr: 4, asinh },
			y: { distr: 4, asinh },
			other: { from: 'y', range: (u, min, max) => [min, max] },
		});
		try {
			await Promise.resolve();
			assert.deepEqual(calls, ['x', 'y', 'other']);
			for (const key of calls)
				checkTransform(u, key, 3);
			u.setData([]);
			await Promise.resolve();
			assert.deepEqual(calls, ['x', 'y', 'other', 'x', 'y', 'other']);
			for (const key of ['x', 'y', 'other'])
				assert.equal(u.scales[key]._asinh, 1);
		}
		finally { u.destroy(); }
	});
});
