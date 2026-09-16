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

const participationCases = [
	{ name: 'uses default participation', opts: {}, scan: true, xScan: false },
	{ name: 'scan true', opts: { scan: true }, scan: true },
	{ name: 'scan false', opts: { scan: false }, scan: false },
	{ name: 'legacy auto true', opts: { auto: true }, scan: true },
	{ name: 'legacy auto false', opts: { auto: false }, scan: false },
	{ name: 'scan true overrides auto false', opts: { scan: true, auto: false }, scan: true },
	{ name: 'scan false overrides auto true', opts: { scan: false, auto: true }, scan: false },
	...[null, undefined].flatMap(value => [
		{ name: `scan ${value} falls back to auto true`, opts: { scan: value, auto: true }, scan: true },
		{ name: `scan ${value} falls back to auto false`, opts: { scan: value, auto: false }, scan: false },
		{ name: `auto ${value} uses default participation`, opts: { auto: value }, scan: true, xScan: false },
		{ name: `scan and auto ${value} use default participation`, opts: { scan: value, auto: value }, scan: true, xScan: false },
		{ name: `scan true overrides auto ${value}`, opts: { scan: true, auto: value }, scan: true },
		{ name: `scan false overrides auto ${value}`, opts: { scan: false, auto: value }, scan: false },
	]),
];

function extrema(u) {
	return u.series.map(s => [s.min, s.max, s.facets?.map(f => [f.min, f.max])]);
}

function assertScans(u, key, expected, excluded = []) {
	// Exclusions must ignore both empty caches and previously populated caches.
	for (const bounds of [[null, null], [-9999, 9999]]) {
		for (const owner of excluded)
			[owner.min, owner.max] = bounds;

		const before = extrema(u);
		assert.deepStrictEqual(uPlot.scan(u, key), expected, `pure ${key}`);
		assert.deepStrictEqual(extrema(u), before, 'pure scans must not change caches');
		assert.deepStrictEqual(uPlot.scan(u, key, null, null, true), expected, `cached ${key}`);

		for (const owner of excluded)
			assert.deepStrictEqual([owner.min, owner.max], bounds, 'excluded caches must not change');
	}
}

function participationPlot(mode, candidate, added, extraData = []) {
	const data = mode == 1 ? [[0, 1], [10, 20]] : [null, [[0, 1], [10, 20]]];
	const candidateData = mode == 1 ? [100, 200] : [[2, 3], [100, 200], ...extraData];
	const series = [{}, { stroke: 'blue' }];

	if (!added) {
		series.push(candidate);
		data.push(candidateData);
	}

	const u = new uPlot({
		width: 400,
		height: 300,
		mode,
		scales: {
			x: { time: false, range: (u, min, max) => [min, max] },
			y: { range: (u, min, max) => [min, max] },
			other: { range: (u, min, max) => min == null ? [0, 1] : [min, max] },
		},
		series,
	}, data, document.body);

	return { u, data, candidateData };
}

async function addCandidate(u, candidate, data, candidateData) {
	await Promise.resolve();
	u.addSeries(candidate);
	u.setData([...data, candidateData]);
}

describe('series and facet scan participation', () => {
	for (const mode of [1, 2]) {
		for (const added of [false, true]) {
			const init = added ? 'addSeries' : 'constructor';

			for (const { name, opts, scan, hidden = false } of [
				...participationCases,
				{ name: 'hidden series', opts: { scan: true, show: false }, scan: true, hidden: true },
			]) {
				it(`mode ${mode} ${init}: series ${name}`, async () => {
					const candidate = { stroke: 'red', ...opts };
					if (mode == 2)
						candidate.facets = [{ scale: 'x' }, { scale: 'y' }, { scale: 'y' }];
					const { u, data, candidateData } = participationPlot(mode, candidate, added, [[1000, 2000]]);
					try {
						if (added)
							await addCandidate(u, candidate, data, candidateData);
						await Promise.resolve();

						const s = u.series[2];
						const participates = scan && !hidden;
						assert.equal(u.series[1].scan, true);
						assert.equal(s.scan, scan);
						const yBounds = [10, participates ? mode == 1 ? 200 : 2000 : 20];
						assert.deepStrictEqual([u.scales.y.min, u.scales.y.max], yBounds);
						assertScans(u, 'y', yBounds, participates ? [] : mode == 1 ? [s] : [s, ...s.facets]);

						if (mode == 2) {
							assert.deepStrictEqual(u.series[1].facets.map(f => f.scan), [true, true]);
							assert.deepStrictEqual(s.facets.map(f => f.scan), [true, true, true]);
							const xBounds = [0, participates ? 3 : 1];
							assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], xBounds);
							assertScans(u, 'x', xBounds, participates ? [] : [s, ...s.facets]);
						}
					}
					finally {
						u.destroy();
					}
				});
			}
		}
	}

	for (const { name, opts, scan, xScan = scan } of participationCases) {
		it(`aligned shared X is always scanned: series[0] ${name} (scan: ${xScan})`, async () => {
			const u = new uPlot({
				width: 400,
				height: 300,
				scales: { x: { time: false } },
				series: [opts, { stroke: 'blue' }],
			}, initialData, document.body);
			try {
				await Promise.resolve();
				assert.equal(u.series[0].scan, xScan);
				assert.deepStrictEqual([u.scales.x.min, u.scales.x.max], [0, 2]);
				assertScans(u, 'x', [0, 2]);
			}
			finally {
				u.destroy();
			}
		});
	}

	for (const added of [false, true]) {
		for (const fi of [0, 1, 2]) {
			for (const { name, opts, scan } of participationCases) {
				it(`mode 2 ${added ? 'addSeries' : 'constructor'}: facet ${fi} ${name}`, async () => {
					const facets = [{ scale: 'x', scan: false }, { scale: 'y', scan: false }, { scale: 'y', scan: false }];
					const key = facets[fi].scale;
					facets[fi] = { scale: key, ...opts };
					const candidate = { stroke: 'red', facets };
					const { u, data, candidateData } = participationPlot(2, candidate, added, [[1000, 2000]]);
					try {
						if (added)
							await addCandidate(u, candidate, data, candidateData);
						await Promise.resolve();

						const s = u.series[2];
						assert.equal(s.scan, true);
						assert.equal(s.facets[fi].scan, scan);
						const expected = key == 'x' ? [0, scan ? 3 : 1] : [10, scan ? fi == 1 ? 200 : 2000 : 20];
						assert.deepStrictEqual([u.scales[key].min, u.scales[key].max], expected);
						const excluded = s.facets.filter(f => !f.scan || f.scale != key);
						if (fi != 1 || !scan)
							excluded.push(s);
						assertScans(u, key, expected, excluded);
						if (fi == 1 && scan)
							assert.deepStrictEqual([s.min, s.max], [100, 200]);
					}
					finally {
						u.destroy();
					}
				});
			}
		}
	}

	for (const mode of [1, 2]) {
		it(`mode ${mode} scans only matching scales`, async () => {
			const candidate = mode == 1 ? { scale: 'other', scan: true } : {
				facets: [{ scale: 'x' }, { scale: 'other' }, { scale: 'other', scan: true }],
			};
			const { u } = participationPlot(mode, candidate, false, [[1000, 2000]]);
			try {
				await Promise.resolve();
				const s = u.series[2];
				assertScans(u, 'other', [100, mode == 1 ? 200 : 2000]);
				assertScans(u, 'y', [10, 20], mode == 1 ? [s] : [s, ...s.facets]);
			}
			finally {
				u.destroy();
			}
		});
	}
});

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
				{ stroke: 'purple', scan: false },
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
