import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function makePlot(cache) {
	const draws = [];
	const data = [[0, 1, 2], [10, 20, 30], [30, 20, 10]];
	const u = new uPlot({
		width: 400,
		height: 200,
		cache,
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		scales: { x: { time: false } },
		series: [{}, { stroke: 'blue' }, { stroke: 'red' }],
		hooks: { draw: [u => draws.push(u.series.slice(1).map(s => s._paths))] },
	}, data, document.body);
	return { u, draws, data };
}

const paths = u => u.series.slice(1).map(s => s._paths);
const extrema = u => u.series.map(s => [s.min, s.max]);

describe('cache categories', () => {
	for (const [name, clear, discarded, discardData = false] of [
		['no argument', u => u.clearCache(), true, true],
		['undefined', u => u.clearCache(undefined), true, true],
		['empty selector', u => u.clearCache({}), false],
		['paths selected', u => u.clearCache({ paths: true }), true],
		['paths excluded', u => u.clearCache({ paths: false }), false],
		['data selected', u => u.clearCache({ data: true }), false, true],
		['data excluded', u => u.clearCache({ data: false }), false],
		['both selected', u => u.clearCache({ paths: true, data: true }), true, true],
		['only data selected', u => u.clearCache({ paths: false, data: true }), false, true],
	]) {
		it(`clearCache: ${name}`, async () => {
			const { u, draws } = makePlot();
			try {
				await Promise.resolve();
				const previous = paths(u);
				const data = u.data;
				const internalData = u._data;
				const cachedExtrema = extrema(u);
				assert.ok(previous.every(path => path != null));
				clear(u);
				paths(u).forEach((path, i) => assert.equal(path, discarded ? null : previous[i]));
				if (discardData) {
					assert.deepEqual(u.data, [[], [], []]);
					assert.equal(u._data, u.data);
					assert.notEqual(u.data, data);
				}
				else {
					assert.equal(u.data, data);
					assert.equal(u._data, internalData);
				}
				assert.deepEqual(data, [[0, 1, 2], [10, 20, 30], [30, 20, 10]], 'caller data is unchanged');
				assert.deepEqual(extrema(u), cachedExtrema, 'path disposal does not invalidate extrema');
				await Promise.resolve();
				assert.equal(draws.length, 1, 'clearing does not schedule a redraw');
				if (discardData)
					u.setData(data, false);
				u.redraw(false);
				await Promise.resolve();
				paths(u).forEach((path, i) => {
					assert.ok(path != null);
					if (discarded || discardData)
						assert.notEqual(path, previous[i], 'discarded or invalidated paths rebuild on the next draw');
					else
						assert.equal(path, previous[i], 'unselected paths remain cached');
				});
			}
			finally {
				u.destroy();
			}
		});
	}

	for (const [name, cache, retainPaths, retainData = true] of [
		['omitted', undefined, true],
		['empty object', {}, true],
		['paths retained', { paths: true }, true],
		['paths discarded', { paths: false }, false],
		['data retained', { data: true }, true],
		['data discarded', { data: false }, true, false],
		['both disabled', { paths: false, data: false }, false, false],
	]) {
		it(`retention: ${name}`, async () => {
			const { u, draws, data } = makePlot(cache);
			try {
				await Promise.resolve();
				const internalData = u._data;
				const cachedExtrema = extrema(u);
				for (let i = 0; i < 2; i++) {
					assert.equal(draws.length, i + 1);
					assert.ok(draws[i].every(path => path != null), 'paths exist during drawing');
					paths(u).forEach((path, si) => assert.equal(path, retainPaths ? draws[i][si] : null));
					if (retainData) {
						assert.equal(u.data, data);
						assert.equal(u._data, internalData);
					}
					else {
						assert.deepEqual(u.data, [[], [], []]);
						assert.equal(u._data, u.data);
						assert.notEqual(u.data, data);
					}
					assert.deepEqual(extrema(u), cachedExtrema);
					if (i == 0) {
						if (retainData)
							u.redraw(false);
						else
							u.setData(data);
						await Promise.resolve();
					}
				}
				draws[1].forEach((path, i) => {
					if (retainPaths && retainData)
						assert.equal(path, draws[0][i]);
					else
						assert.notEqual(path, draws[0][i]);
				});
			}
			finally {
				u.destroy();
			}
		});
	}
});
