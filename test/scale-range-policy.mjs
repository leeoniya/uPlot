import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [10, 20, 30]];

const nextCommit = () => Promise.resolve();

function makePlot({ data: plotData = data, scales = {}, mode = 1 } = {}) {
	return new uPlot({
		width: 400,
		height: 300,
		mode,
		scales: {
			x: { time: false, ...scales.x },
			y: { ...scales.y },
		},
		series: [{}, { stroke: 'blue' }],
	}, plotData, document.body);
}

function paddedRange(calls) {
	return (u, min, max) => {
		calls.push([min, max]);
		return min == null ? [-100, 100] : [min - 1, max + 1];
	};
}

describe('scale range policy', () => {
	describe('setRange', () => {
		for (const key of ['x', 'y']) {
			for (const auto of [true, false]) {
				for (const [min, max] of [[-10, 40], [-10, null], [null, 40], [null, null]]) {
					it(`applies ${key} bounds [${min}, ${max}] with auto: ${auto}`, async () => {
						const calls = [];
						const u = makePlot({ scales: { [key]: { auto, scan: true, range: paddedRange(calls) } } });
						try {
							await nextCommit();
							calls.length = 0;

							u.setRange(key, min, max);
							await nextCommit();

							const extrema = key == 'x' ? [0, 2] : [10, 30];
							assert.deepStrictEqual(calls, min == null || max == null ? [extrema] : []);
							assert.deepStrictEqual([u.scales[key].min, u.scales[key].max], [
								min ?? extrema[0] - 1,
								max ?? extrema[1] + 1,
							]);
							assert.equal(u.scales[key].auto(u, false), auto);
						}
						finally {
							u.destroy();
						}
					});
				}
			}
		}
	});

	describe('X scale', () => {
		it('ranges automatic bounds but not fully concrete public bounds', async () => {
			const calls = [];
			const u = makePlot({ scales: { x: { range: paddedRange(calls) } } });
			try {
				await nextCommit();
				assert.deepStrictEqual(calls, [[0, 2]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [-1, 3]);

				calls.length = 0;
				u.setScale('x', { min: 0.25, max: 1.75 });
				await nextCommit();
				assert.deepStrictEqual(calls, []);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [0.25, 1.75]);

			}
			finally {
				u.destroy();
			}
		});

		it('sets concrete bounds through setRange without calling scale.range', async () => {
			const calls = [];
			const u = makePlot({ scales: { x: { range: paddedRange(calls) } } });
			try {
				await nextCommit();
				calls.length = 0;

				u.setRange('x', 0.25, 1.75);
				await nextCommit();
				assert.deepStrictEqual(calls, []);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [0.25, 1.75]);
			}
			finally {
				u.destroy();
			}
		});

		it('calculates only null or undefined bounds', async () => {
			const calls = [];
			const u = makePlot({ scales: { x: { range: paddedRange(calls) } } });
			try {
				await nextCommit();
				calls.length = 0;

				u.setScale('x', { min: -10, max: null });
				await nextCommit();
				assert.deepStrictEqual(calls, [[0, 2]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [-10, 3]);

				calls.length = 0;
				u.setScale('x', { min: undefined, max: 10 });
				await nextCommit();
				assert.deepStrictEqual(calls, [[0, 2]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [-1, 10]);

				calls.length = 0;
				u.setScale('x', { min: null, max: null });
				await nextCommit();
				assert.deepStrictEqual(calls, [[0, 2]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [-1, 3]);
			}
			finally {
				u.destroy();
			}
		});

		it('ranges setData autoscaling and double-click reset, but not an explicit zoom', async () => {
			const calls = [];
			const u = makePlot({ scales: { x: { range: paddedRange(calls) } } });
			try {
				await nextCommit();
				calls.length = 0;

				u.setData([[10, 20, 30], [1, 2, 3]]);
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [9, 31]);

				calls.length = 0;
				u.setScale('x', { min: 12, max: 18 });
				await nextCommit();
				assert.deepStrictEqual(calls, []);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [12, 18]);

				u.over.dispatchEvent(new MouseEvent('dblclick', {
					bubbles: true,
					cancelable: true,
					button: 0,
				}));
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [9, 31]);
			}
			finally {
				u.destroy();
			}
		});

		it('converts only concrete ordinal bounds', async () => {
			const calls = [];
			const u = makePlot({ scales: { x: { distr: 2, range: paddedRange(calls) } } });
			try {
				await nextCommit();
				calls.length = 0;

				u.setScale('x', { min: 1, max: null });
				await nextCommit();
				assert.deepStrictEqual(calls, [[0, 2]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [1, 3]);

				calls.length = 0;
				u.setScale('x', { min: null, max: 1 });
				await nextCommit();
				assert.deepStrictEqual(calls, [[0, 2]]);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [-1, 1]);
			}
			finally {
				u.destroy();
			}
		});
	});

	describe('Y scale', () => {
		it('bypasses range for concrete bounds and calculates each null side', async () => {
			const calls = [];
			const u = makePlot({ scales: { y: { range: paddedRange(calls) } } });
			try {
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [9, 31]);

				calls.length = 0;
				u.setScale('y', { min: 11, max: 22 });
				await nextCommit();
				assert.deepStrictEqual(calls, []);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [11, 22]);

				u.setScale('y', { min: 0, max: null });
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 31]);

				calls.length = 0;
				u.setScale('y', { min: undefined, max: 40 });
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [9, 40]);

				calls.length = 0;
				u.setScale('y', { min: null, max: null });
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [9, 31]);
			}
			finally {
				u.destroy();
			}
		});

		it('supports partial bounds in faceted mode', async () => {
			const calls = [];
			const u = makePlot({
				mode: 2,
				data: [null, data],
				scales: { y: { range: paddedRange(calls) } },
			});
			try {
				await nextCommit();
				calls.length = 0;

				u.setScale('y', { min: 0, max: null });
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [0, 31]);

				calls.length = 0;
				u.setScale('y', { min: null, max: 40 });
				await nextCommit();
				assert.deepStrictEqual(calls, [[10, 30]]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [9, 40]);
			}
			finally {
				u.destroy();
			}
		});
	});

	it('rejects crossed partial ranges without swapping the explicit side', async () => {
		const xCalls = [];
		const yCalls = [];
		const u = makePlot({
			scales: {
				x: { range: paddedRange(xCalls) },
				y: { range: paddedRange(yCalls) },
			},
		});
		try {
			await nextCommit();
			const initialX = [u.scales.x.min, u.scales.x.max];
			const initialY = [u.scales.y.min, u.scales.y.max];
			xCalls.length = yCalls.length = 0;

			u.setScale('x', { min: 10, max: null });
			await nextCommit();
			assert.deepStrictEqual(xCalls, [[0, 2]]);
			assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], initialX);

			yCalls.length = 0;
			u.setScale('y', { min: null, max: 0 });
			await nextCommit();
			assert.deepStrictEqual(yCalls, [[10, 30]]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], initialY);
		}
		finally {
			u.destroy();
		}
	});

	it('applies the same concrete and partial rules with empty data', async () => {
		const concreteCalls = [];
		const concrete = makePlot({
			data: [[], []],
			scales: {
				x: { min: 1, max: 2, range: paddedRange(concreteCalls) },
				y: { min: 3, max: 4, range: paddedRange(concreteCalls) },
			},
		});
		try {
			await nextCommit();
			assert.deepStrictEqual(concreteCalls, []);
			assert.deepStrictEqual([concrete.scales.x.min, concrete.scales.x.max], [1, 2]);
			assert.deepStrictEqual([concrete.scales.y.min, concrete.scales.y.max], [3, 4]);
		}
		finally {
			concrete.destroy();
		}

		const partialCalls = { x: [], y: [] };
		const partial = makePlot({
			data: [[], []],
			scales: {
				x: {
					min: -10,
					max: null,
					range: (u, min, max) => {
						partialCalls.x.push([min, max]);
						return [-100, 100];
					},
				},
				y: {
					min: null,
					max: 10,
					range: (u, min, max) => {
						partialCalls.y.push([min, max]);
						return [-100, 100];
					},
				},
			},
		});
		try {
			await nextCommit();
			assert.deepStrictEqual(partialCalls, { x: [[null, null]], y: [[null, null]] });
			assert.deepStrictEqual([partial.scales.x.min, partial.scales.x.max], [-10, 100]);
			assert.deepStrictEqual([partial.scales.y.min, partial.scales.y.max], [-100, 10]);
		}
		finally {
			partial.destroy();
		}
	});
});
