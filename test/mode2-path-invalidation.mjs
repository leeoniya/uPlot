import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function makePlot() {
	const state = { threshold: 1, builds: [0, 0, 0] };
	const linear = uPlot.paths.linear();
	const paths = (u, si, ...args) => {
		state.builds[si]++;
		return linear(u, si, ...args);
	};
	const u = new uPlot({
		width: 600,
		height: 400,
		mode: 2,
		cursor: { show: false },
		legend: { show: false },
		axes: [{ scale: 'time', size: 50 }, { scale: 'value', size: 50 }],
		scales: {
			time: { time: false, ori: 0, auto: false, min: 0, max: 4 },
			value: { distr: 4, asinh: () => state.threshold, auto: false, min: -100, max: 100 },
			weight: { auto: false, min: 0, max: 100 },
			otherX: { time: false, ori: 0, auto: false, min: 0, max: 4 },
			otherY: { auto: false, min: -100, max: 100 },
		},
		series: [
			{},
			{ stroke: 'blue', paths, points: { show: false }, facets: [{ scale: 'time' }, { scale: 'value' }, { scale: 'weight' }] },
			{ stroke: 'red', paths, points: { show: false }, facets: [{ scale: 'otherX' }, { scale: 'otherY' }] },
		],
	}, [null, [[1, 2, 3], [-100, 1, 100], [10, 20, 30]], [[1, 2, 3], [-50, 2, 50]]], document.body);
	return { u, state };
}

async function checkUpdate(u, state, key, bounds, rebuilt) {
	const previous = u.series.map(s => s._paths);
	const builds = state.builds.slice();
	const bbox = { ...u.bbox };
	assert.ok(previous[1] != null && previous[2] != null, 'real paths are cached before the update');

	u.setScale(key, bounds);
	await Promise.resolve();

	assert.deepEqual([u.scales[key].min, u.scales[key].max], [bounds.min, bounds.max]);
	assert.deepEqual(u.bbox, bbox, 'fixed axis sizes keep the plot rectangle unchanged');
	assert.equal(u.series[0]._paths, previous[0], 'index zero is not invalidated');
	for (let si = 1; si < u.series.length; si++) {
		assert.equal(state.builds[si] - builds[si], si == rebuilt ? 1 : 0, `series ${si} rebuild count`);
		assert.ok(u.series[si]._paths != null);
		if (si == rebuilt)
			assert.notEqual(u.series[si]._paths, previous[si], 'the dependent series replaces its cache');
		else
			assert.equal(u.series[si]._paths, previous[si], 'the unrelated series retains its cache');
	}
}

describe('mode 2 path invalidation', () => {
	it('rebuilds a custom Y facet when only its asinh threshold changes', async () => {
		const { u, state } = makePlot();
		try {
			await Promise.resolve();
			assert.equal(u.scales.value._asinh, 1);
			const bounds = { min: u.scales.value.min, max: u.scales.value.max };
			state.threshold = 10;
			await checkUpdate(u, state, 'value', bounds, 1);
			assert.equal(u.scales.value._asinh, 10);
			await checkUpdate(u, state, 'value', bounds, null);
		}
		finally { u.destroy(); }
	});

	for (const [name, key, bounds, rebuilt] of [
		['a custom Y facet', 'value', { min: -200, max: 200 }, 1],
		['an additional third facet', 'weight', { min: 0, max: 200 }, 1],
		['a secondary custom X facet', 'otherX', { min: 0, max: 8 }, 2],
	]) {
		it(`rebuilds only the dependent series when bounds change on ${name}`, async () => {
			const { u, state } = makePlot();
			try {
				await Promise.resolve();
				await checkUpdate(u, state, key, bounds, rebuilt);
			}
			finally { u.destroy(); }
		});
	}
});
