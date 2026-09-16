import assert from 'node:assert/strict';
import '../scripts2/instrument.mjs';
import uPlot from '../src/uPlot.js';

const initialData = [[0, 1, 2], [10, 20, 30]];

function createPlot(scale, calls) {
	return new uPlot({
		width: 400,
		height: 300,
		scales: {
			x: { time: false },
			y: {
				...scale,
				range: (u, min, max) => {
					calls.push([min, max]);
					return min == null ? [0, 100] : [min, max];
				},
			},
		},
		series: [{}, { stroke: 'blue' }],
	}, initialData, document.body);
}

describe('scale scan', () => {
	for (const { name, scale, expected } of [
		{ name: 'auto defaults scan on', scale: { auto: true }, expected: [10, 30] },
		{ name: 'auto false defaults scan off', scale: { auto: false }, expected: [null, null] },
		{ name: 'scan can be enabled with auto off', scale: { auto: false, scan: true }, expected: [10, 30] },
		{ name: 'scan can be disabled with auto on', scale: { auto: true, scan: false }, expected: [null, null] },
	]) {
		it(name, async () => {
			const calls = [];
			const u = createPlot(scale, calls);
			try {
				await Promise.resolve();
				assert.deepStrictEqual(calls, [expected]);
				assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], expected[0] == null ? [0, 100] : expected);
			}
			finally {
				u.destroy();
			}
		});
	}

	it('scans only after an explicit rerange when auto is off', async () => {
		const calls = [];
		const u = createPlot({ auto: false, scan: true }, calls);
		try {
			await Promise.resolve();
			assert.deepStrictEqual(calls, [[10, 30]]);
			calls.length = 0;

			u.setData([[0, 1, 2], [40, 50, 60]]);
			await Promise.resolve();
			assert.deepStrictEqual(calls, []);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 30]);

			u.setScale('y', { min: null, max: null });
			await Promise.resolve();
			assert.deepStrictEqual(calls, [[40, 60]]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [40, 60]);
		}
		finally {
			u.destroy();
		}
	});

	it('scans faceted data independently of auto', async () => {
		const calls = [];
		const u = new uPlot({
			width: 400,
			height: 300,
			mode: 2,
			scales: {
				x: { time: false },
				y: {
					auto: false,
					scan: true,
					range: (u, min, max) => {
						calls.push([min, max]);
						return [min, max];
					},
				},
			},
			series: [{}, { stroke: 'blue' }],
		}, [null, initialData], document.body);
		try {
			await Promise.resolve();
			assert.deepStrictEqual(calls, [[10, 30]]);
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 30]);
		}
		finally {
			u.destroy();
		}
	});

	it('uses the explicitly caching public scanner as the current-window callback', async () => {
		const u = new uPlot({
			width: 400,
			height: 300,
			scales: {
				x: { time: false },
				y: {
					scan: (u, scaleKey, i0, i1) => uPlot.scan(u, scaleKey, i0, i1, true),
					range: (u, min, max) => [min, max],
				},
			},
			series: [{}, { stroke: 'blue' }],
		}, initialData, document.body);
		try {
			await Promise.resolve();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 30]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [10, 30]);

			u.setScale('x', { min: 0, max: 1 });
			await Promise.resolve();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [10, 20]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [10, 20]);
		}
		finally {
			u.destroy();
		}
	});

	it('scans aligned scale data without mutating series extrema', async () => {
		const u = new uPlot({
			width: 400,
			height: 300,
			scales: {
				x: { time: false },
			},
			series: [
				{},
				{ stroke: 'blue' },
				{ stroke: 'red' },
				{ stroke: 'green', show: false },
				{ stroke: 'purple', auto: false },
			],
		}, [
			[0, 1, 2, 3],
			[10, 20, 30, 40],
			[100, 200, 300, 400],
			[1000, 2000, 3000, 4000],
			[10000, 20000, 30000, 40000],
		], document.body);
		try {
			await Promise.resolve();
			const extrema = u.series.map(s => [s.min, s.max]);

			assert.deepStrictEqual(uPlot.scan(u, 'x'), [0, 3]);
			assert.deepStrictEqual(uPlot.scan(u, 'y'), [10, 400]);
			assert.deepStrictEqual(uPlot.scan(u, 'y', 1, 2), [20, 300]);
			assert.deepStrictEqual(uPlot.scan(u, 'y', undefined, 1), [10, 200]);
			assert.deepStrictEqual(uPlot.scan(u, 'y', 2), [30, 400]);
			assert.deepStrictEqual(uPlot.scan(u, 'y', 10, 20), [null, null]);
			assert.deepStrictEqual(uPlot.scan(u, 'missing'), [null, null]);
			assert.deepStrictEqual(u.series.map(s => [s.min, s.max]), extrema);

			u.series[1].min = u.series[1].max = null;
			u.series[2].min = u.series[2].max = null;

			assert.deepStrictEqual(uPlot.scan(u, 'y', 1, 2, true), [20, 300]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [20, 30]);
			assert.deepStrictEqual([u.series[2].min, u.series[2].max], [200, 300]);

			assert.deepStrictEqual(uPlot.scan(u, 'y', 0, 3, true), [20, 300]);
		}
		finally {
			u.destroy();
		}
	});

	it('scans matching facets with per-array index defaults and clamping', async () => {
		const u = new uPlot({
			width: 400,
			height: 300,
			mode: 2,
			scales: {
				x: { time: false },
				y: {},
			},
			series: [{}, { stroke: 'blue' }, { stroke: 'red' }],
		}, [
			null,
			[[0, 1, 2], [10, 20, 30]],
			[[5, 6], [100, 200]],
		], document.body);
		try {
			await Promise.resolve();
			assert.deepStrictEqual(uPlot.scan(u, 'x'), [0, 6]);
			assert.deepStrictEqual(uPlot.scan(u, 'y'), [10, 200]);
			assert.deepStrictEqual(uPlot.scan(u, 'x', 1, 1), [1, 6]);
			assert.deepStrictEqual(uPlot.scan(u, 'y', 1, 1), [20, 200]);

			for (let i = 1; i < u.series.length; i++) {
				u.series[i].min = u.series[i].max = null;
				u.series[i].facets[1].min = u.series[i].facets[1].max = null;
			}

			assert.deepStrictEqual(uPlot.scan(u, 'y', null, null, true), [10, 200]);
			assert.deepStrictEqual([u.series[1].facets[1].min, u.series[1].facets[1].max], [10, 30]);
			assert.deepStrictEqual([u.series[2].facets[1].min, u.series[2].facets[1].max], [100, 200]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [10, 30]);
			assert.deepStrictEqual([u.series[2].min, u.series[2].max], [100, 200]);
		}
		finally {
			u.destroy();
		}
	});

	it('does not infer per-series caches from a custom aggregate', async () => {
		const u = new uPlot({
			width: 400,
			height: 300,
			scales: {
				x: { time: false },
				y: {
					scan: () => [-1, 1],
					range: (u, min, max) => [min, max],
				},
			},
			series: [{}, { stroke: 'blue' }],
		}, initialData, document.body);
		try {
			await Promise.resolve();
			assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], [-1, 1]);
			assert.deepStrictEqual([u.series[1].min, u.series[1].max], [null, null]);
		}
		finally {
			u.destroy();
		}
	});

	it('passes empty scan context once and supports positive-only log scanning', async () => {
		const emptyCalls = [];
		const empty = new uPlot({
			width: 400,
			height: 300,
			scales: {
				x: { time: false },
				y: {
					scan: (u, scaleKey, i0, i1) => {
						emptyCalls.push([scaleKey, i0, i1]);
						u.series[1].min = -1;
						u.series[1].max = 1;
						return [-1, 1];
					},
					range: (u, min, max) => [min, max],
				},
			},
			series: [{}, { stroke: 'blue' }],
		}, [[], []], document.body);
		try {
			await Promise.resolve();
			assert.deepStrictEqual(emptyCalls, [['y', undefined, undefined]]);
			assert.deepStrictEqual([empty.scales.y.min, empty.scales.y.max], [-1, 1]);
			assert.deepStrictEqual([empty.series[1].min, empty.series[1].max], [-1, 1]);
		}
		finally {
			empty.destroy();
		}

		const log = new uPlot({
			width: 400,
			height: 300,
			scales: {
				x: { time: false },
				y: { distr: 3 },
			},
			series: [{}, { stroke: 'blue' }, { stroke: 'red' }],
		}, [[0, 1, 2, 3], [-10, 0, 1, 100], [-10, 0, null, undefined]], document.body);
		try {
			await Promise.resolve();
			assert.deepStrictEqual(uPlot.scan(log, 'y'), [1, 100]);
		}
		finally {
			log.destroy();
		}
	});

});
