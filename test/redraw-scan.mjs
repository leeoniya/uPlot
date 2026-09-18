import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function makePlot(mode, ordinal = false, extraY = null) {
	const state = {
		active: null,
		reads: { x: 0, y: 0 },
		scans: { x: 0, y: 0 },
		ranges: { x: [], y: [] },
		paths: 0,
		padding: 0,
	};
	function tracked(values) {
		return new Proxy(values, {
			get(target, key, receiver) {
				// Exclude window searches and drawing: count only reads inside scale.scan.
				if (state.active != null && typeof key == 'string' && /^(0|[1-9]\d*)$/.test(key))
					state.reads[state.active]++;
				return Reflect.get(target, key, receiver);
			},
		});
	}
	function data(x, y) {
		const pair = [tracked(x), tracked(y)];
		return mode == 1 ? pair : [null, pair];
	}
	const initial = data(ordinal ? [10, 20, 40, 80, 160, 320] : [0, 1, 2, 3, 4, 5], [100, 10, 30, 20, 40, 200]);
	const series = [{}, { stroke: 'blue', points: { show: false } }];
	if (extraY != null) {
		initial.push(mode == 1 ? tracked(extraY) : [tracked([0, 1, 2, 3, 4, 5]), tracked(extraY)]);
		series.push({ stroke: 'red', points: { show: false } });
	}
	const u = new uPlot({
		width: 400,
		height: 200,
		mode,
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		scales: {
			x: {
				time: false,
				distr: ordinal ? 2 : 1,
				range: (u, min, max) => {
					state.ranges.x.push([min, max]);
					return ordinal ? [0.25, 3.75] : [min, max];
				},
			},
			y: {
				range: (u, min, max) => {
					state.ranges.y.push([min, max]);
					return [min - state.padding, max + state.padding];
				},
			},
		},
		series,
	}, initial, document.body);

	for (const key of ['x', 'y']) {
		const scan = u.scales[key].scan;
		u.scales[key].scan = (...args) => {
			state.scans[key]++;
			state.active = key;
			try {
				return scan(...args);
			}
			finally {
				state.active = null;
			}
		};
	}
	const paths = u.series[1].paths;
	u.series[1].paths = (...args) => {
		state.paths++;
		return paths(...args);
	};

	return {
		u, state, data, initial,
		reset() {
			for (const key of ['x', 'y']) {
				state.reads[key] = state.scans[key] = 0;
				state.ranges[key].length = 0;
			}
			state.paths = 0;
			return u.series[1]._paths;
		},
	};
}

const bounds = scale => [scale.min, scale.max];
const redraws = [
	{ name: 'redraw()', run: u => u.redraw() },
	{ name: 'redraw(true, true)', run: u => u.redraw(true, true) },
];

function assertRefresh(f, oldPaths, extrema, rescanned = false) {
	assert.equal(f.state.scans.y, 1, 'automatic Y scanner runs');
	assert.deepEqual(f.state.ranges.y, [extrema], 'ranger receives raw extrema');
	if (rescanned)
		assert.ok(f.state.reads.y > 0, 'invalidated extrema require data reads inside scan');
	else
		assert.equal(f.state.reads.y, 0, 'valid extrema require no data reads inside scan');
	assert.equal(f.state.paths, 1, 'paths rebuild once');
	assert.ok(f.u.series[1]._paths, 'real paths are built');
	assert.notEqual(f.u.series[1]._paths, oldPaths, 'path cache is replaced');
	const owner = f.u.mode == 1 ? f.u.series[1] : f.u.series[1].facets[1];
	assert.deepEqual(bounds(owner), extrema, 'raw extrema stay cached');
}

function coalesce(u, redrawFirst, request) {
	if (redrawFirst)
		u.redraw();
	request();
	if (!redrawFirst)
		u.redraw();
}

describe('redraw scan cache', () => {
	for (const mode of [1, 2]) {
		for (const redraw of redraws) {
			it(`mode ${mode}: ${redraw.name} refreshes paths and callbacks without rescanning`, async () => {
				const f = makePlot(mode);
				try {
					await Promise.resolve();
					for (const padding of [0, 5, 0]) {
						const oldPaths = f.reset();
						f.state.padding = padding;
						redraw.run(f.u);
						await Promise.resolve();
						assertRefresh(f, oldPaths, [10, 200]);
						assert.deepEqual(bounds(f.u.scales.y), [10 - padding, 200 + padding], 'ranger policy refreshes with unchanged data');
						assert.deepEqual(bounds(f.u.scales.x), [0, 5]);
						assert.equal(f.state.scans.x, 0, 'preserved explicit X bounds need no scanner');
					}
				}
				finally {
					f.u.destroy();
				}
			});
		}

		it(`mode ${mode}: custom scanner results refresh with unchanged data`, async () => {
			const f = makePlot(mode);
			try {
				await Promise.resolve();
				let extrema;
				let calls = 0;
				const series = f.u.series[1];
				const owner = mode == 1 ? series : series.facets[1];
				f.u.scales.y.scan = () => {
					calls++;
					[owner.min, owner.max] = extrema;
					if (mode == 2)
						[series.min, series.max] = extrema;
					return extrema;
				};
				for (const [i, redraw] of redraws.entries()) {
					f.reset();
					extrema = [-10 - i, 300 + i];
					redraw.run(f.u);
					await Promise.resolve();
					assert.equal(calls, i + 1);
					assert.deepEqual(f.state.ranges.y, [extrema]);
					assert.deepEqual(bounds(f.u.scales.y), extrema);
					assert.deepEqual(bounds(owner), extrema, 'custom scanner owns the extrema cache');
					assert.deepEqual(bounds(series), extrema, 'series extrema mirror the Y facet');
					assert.equal(f.u.data, f.initial);
				}
			}
			finally {
				f.u.destroy();
			}
		});

		for (const resetScales of [true, false]) {
			for (const mutate of [false, true]) {
				const action = resetScales ? 'setData(data)' : 'setData(data, false) then redraw';
				it(`mode ${mode}: ${action} invalidates and rescans ${mutate ? 'notified same-array mutations' : 'replacement data'}`, async () => {
					const f = makePlot(mode);
					try {
						await Promise.resolve();
						const oldPaths = f.reset();
						const owner = mode == 1 ? f.u.series[1] : f.u.series[1].facets[1];
						assert.deepEqual(bounds(owner), [10, 200], 'initial extrema are cached');
						const next = mutate ? f.initial : f.data([0, 1, 2, 3, 4, 5], [100, 10, 30, 20, 40, 200]);
						const y = mode == 1 ? next[1] : next[1][1];
						y[1] = -50;
						y[5] = 500;
						if (resetScales)
							f.u.setData(next);
						else
							f.u.setData(next, false);
						assert.deepEqual(bounds(owner), [null, null], 'setData invalidates extrema before scale processing');
						assert.equal(f.state.scans.y, 0, 'scanning waits for the commit');
						if (!resetScales)
							f.u.redraw();
						await Promise.resolve();
						assertRefresh(f, oldPaths, [-50, 500], true);
						assert.deepEqual(bounds(f.u.scales.y), [-50, 500]);
						assert.deepEqual(bounds(f.u.scales.x), [0, 5]);
						const refreshedPaths = f.reset();
						f.u.redraw(true, true);
						await Promise.resolve();
						assertRefresh(f, refreshedPaths, [-50, 500]);
					}
					finally {
						f.u.destroy();
					}
				});
			}
		}

		it(`mode ${mode}: X zoom with explicit Y defers invalidation until redraw, then reuses caches`, async () => {
			const f = makePlot(mode);
			try {
				await Promise.resolve();
				const owner = mode == 1 ? f.u.series[1] : f.u.series[1].facets[1];
				f.reset();
				f.u.setScale('x', { min: 1, max: 3 });
				f.u.setScale('y', { min: -100, max: 400 });
				await Promise.resolve();
				assert.equal(f.state.scans.y, 0);
				assert.deepEqual(f.state.ranges.y, []);
				assert.deepEqual(bounds(f.u.scales.y), [-100, 400]);
				assert.deepEqual(bounds(owner), [10, 200], 'explicit Y retains public caches during zoom');

				const extrema = mode == 1 ? [10, 30] : [10, 200];
				for (const rescanned of [true, false]) {
					const oldPaths = f.reset();
					f.u.redraw();
					await Promise.resolve();
					assertRefresh(f, oldPaths, extrema, rescanned);
					assert.deepEqual(bounds(f.u.scales.y), extrema);
					assert.deepEqual(bounds(f.u.scales.x), [1, 3]);
				}
			}
			finally {
				f.u.destroy();
			}
		});

		for (const redrawWhileSuppressed of [false, true]) {
			it(`mode ${mode}: suppressed Y refreshes after reenabling auto${redrawWhileSuppressed ? ', even after suppressed redraws' : ''}`, async () => {
				const f = makePlot(mode);
				try {
					await Promise.resolve();
					const owner = mode == 1 ? f.u.series[1] : f.u.series[1].facets[1];
					let auto = false;
					f.u.scales.y.auto = () => auto;
					f.reset();
					f.u.setScale('x', { min: 1, max: 3 });
					await Promise.resolve();
					assert.equal(f.state.scans.y, 0);
					assert.deepEqual(f.state.ranges.y, []);
					assert.deepEqual(bounds(owner), [10, 200], 'suppressed zoom preserves public caches');
					assert.deepEqual(bounds(f.u.scales.y), [10, 200]);

					if (redrawWhileSuppressed) {
						for (const redraw of redraws) {
							const oldPaths = f.reset();
							redraw.run(f.u);
							await Promise.resolve();
							assert.equal(f.state.scans.y, 0);
							assert.equal(f.state.reads.y, 0);
							assert.deepEqual(f.state.ranges.y, []);
							assert.deepEqual(bounds(owner), [10, 200], 'suppressed redraw must defer invalidation');
							assert.deepEqual(bounds(f.u.scales.y), [10, 200]);
							assert.equal(f.state.paths, 1);
							assert.notEqual(f.u.series[1]._paths, oldPaths);
						}
					}

					auto = true;
					const extrema = mode == 1 ? [10, 30] : [10, 200];
					for (const rescanned of [true, false]) {
						const oldPaths = f.reset();
						f.u.redraw(true, true);
						await Promise.resolve();
						assertRefresh(f, oldPaths, extrema, rescanned);
						assert.deepEqual(bounds(f.u.scales.y), extrema);
						assert.deepEqual(bounds(f.u.scales.x), [1, 3]);
					}
				}
				finally {
					f.u.destroy();
				}
			});
		}

		for (const redrawFirst of [false, true]) {
			const order = redrawFirst ? 'redraw first' : 'request first';
			for (const api of ['setRange', 'setScale']) {
				for (const reset of [false, true]) {
					it(`mode ${mode}: ${api} X ${reset ? 'auto reset' : 'zoom'} wins (${order})`, async () => {
						const f = makePlot(mode);
						try {
							await Promise.resolve();
							if (reset) {
								f.u.setScale('x', { min: 1, max: 3 });
								await Promise.resolve();
							}
							const oldPaths = f.reset();
							const [min, max] = reset ? [null, null] : [1, 3];
							coalesce(f.u, redrawFirst, () => api == 'setRange' ? f.u.setRange('x', min, max) : f.u.setScale('x', { min, max }));
							await Promise.resolve();
							assert.deepEqual(bounds(f.u.scales.x), reset ? [0, 5] : [1, 3]);
							const extrema = mode == 1 && !reset ? [10, 30] : [10, 200];
							assertRefresh(f, oldPaths, extrema, true);
							assert.deepEqual(bounds(f.u.scales.y), extrema);
						}
						finally {
							f.u.destroy();
						}
					});
				}
			}

			it(`mode ${mode}: setData auto reset wins (${order})`, async () => {
				const f = makePlot(mode);
				try {
					await Promise.resolve();
					f.u.setScale('x', { min: 1, max: 3 });
					await Promise.resolve();
					const oldPaths = f.reset();
					coalesce(f.u, redrawFirst, () => f.u.setData(f.data([10, 20, 30], [-20, 60, 15])));
					await Promise.resolve();
					assert.deepEqual(bounds(f.u.scales.x), [10, 30]);
					assertRefresh(f, oldPaths, [-20, 60], true);
					assert.ok(f.state.reads.x > 0, 'new X data is scanned');
					assert.deepEqual(bounds(f.u.scales.y), [-20, 60]);
				}
				finally {
					f.u.destroy();
				}
			});

			it(`mode ${mode}: explicit Y request is preserved (${order})`, async () => {
				const f = makePlot(mode);
				try {
					await Promise.resolve();
					const oldPaths = f.reset();
					coalesce(f.u, redrawFirst, () => f.u.setScale('y', { min: -100, max: 400 }));
					await Promise.resolve();
					assert.deepEqual(bounds(f.u.scales.y), [-100, 400]);
					assert.deepEqual(bounds(f.u.scales.x), [0, 5]);
					assert.equal(f.state.scans.y, 0, 'explicit Y skips scanning');
					assert.deepEqual(f.state.ranges.y, [], 'explicit Y skips ranging');
					assert.equal(f.state.paths, 1);
					assert.notEqual(f.u.series[1]._paths, oldPaths);
				}
				finally {
					f.u.destroy();
				}
			});
		}
	}

	it('mode 1: deferred redraw invalidates hidden caches before the series is shown again', async () => {
		const f = makePlot(1, false, [1000, 50, 70, 60, 80, 2000]);
		try {
			await Promise.resolve();
			const hidden = f.u.series[2];
			assert.deepEqual(bounds(hidden), [50, 2000]);
			f.u.setSeries(2, { show: false });
			await Promise.resolve();
			assert.deepEqual(bounds(hidden), [50, 2000], 'hiding retains the warmed cache');

			let auto = false;
			f.u.scales.y.auto = () => auto;
			f.u.setScale('x', { min: 1, max: 3 });
			await Promise.resolve();
			assert.deepEqual(bounds(hidden), [50, 2000], 'suppressed zoom leaves hidden caches untouched');

			auto = true;
			for (const rescanned of [true, false]) {
				const oldPaths = f.reset();
				f.u.redraw();
				await Promise.resolve();
				assertRefresh(f, oldPaths, [10, 30], rescanned);
				assert.deepEqual(bounds(hidden), [null, null], 'deferred reset includes hidden series');
			}

			f.reset();
			f.u.setSeries(2, { show: true });
			await Promise.resolve();
			assert.equal(f.state.scans.y, 1);
			assert.ok(f.state.reads.y > 0, 'newly visible series scans the current window');
			assert.deepEqual(bounds(hidden), [50, 70]);
			assert.deepEqual(f.state.ranges.y, [[10, 70]]);
			assert.deepEqual(bounds(f.u.scales.y), [10, 70]);
			assert.deepEqual(bounds(f.u.scales.x), [1, 3]);
		}
		finally {
			f.u.destroy();
		}
	});

	it('ordinal redraw retains fractional index bounds and the cached visible window', async () => {
		const f = makePlot(1, true);
		try {
			await Promise.resolve();
			for (const redraw of redraws) {
				const oldPaths = f.reset();
				redraw.run(f.u);
				await Promise.resolve();
				assert.deepEqual(bounds(f.u.scales.x), [0.25, 3.75], 'redraw must not snap index bounds through setRange');
				assert.deepEqual(f.u.series[0].idxs, [1, 3]);
				assert.deepEqual(f.u.series[1].idxs, [1, 3]);
				assertRefresh(f, oldPaths, [10, 30]);
			}
		}
		finally {
			f.u.destroy();
		}
	});
});
