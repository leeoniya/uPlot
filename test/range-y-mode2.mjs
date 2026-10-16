import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';
import { numAxisSplits } from '../src/opts.js';

const tick = () => Promise.resolve();
const bounds = sc => [sc.min, sc.max];
const pair = () => [[13, 38, 87], [13, 87, 38]];

function assertRange(u, key, extrema, dim) {
	const sc = u.scales[key];
	const ai = sc.axis;
	const axis = u.axes[ai];
	dim ??= u.bbox[sc.ori == 0 ? 'width' : 'height'] / u.pxRatio;
	const space = sc.ori == 0 && extrema[0] != null ? axis.space(u, ai, ...extrema, dim) : 50;
	const expected = rangeY(...extrema, dim, sc._policyY, axis.ramp, axis.exact, space);
	assert.equal(sc._axisY, true);
	assert.deepEqual(sc._rawY, extrema, `${key}: raw facet aggregate`);
	assert.deepEqual(sc._rangeY, expected);
	assert.deepEqual(bounds(sc), [expected.min, expected.max]);
	const splits = expected.count == 0 ? [] : expected.count == 1 ? [expected.min, expected.max]
		: numAxisSplits(u, ai, expected.min, expected.max, expected.incr, 0, true);
	assert.deepEqual(axis._splits ?? [], splits, `${key}: ticks follow rangeY`);
	return expected;
}

function assertDrawn(u, si) {
	const paths = u.series[si]._paths;
	assert.ok(paths?.stroke, `series ${si}: real stroke path`);
	const clear = u.ctx.log.findLastIndex(([name]) => name == 'clearRect');
	assert.ok(clear >= 0);
	assert.ok(u.ctx.log.slice(clear + 1).some(([name, ...calls]) =>
		name == 'stroke' && calls.some(args => args[0] === paths.stroke)), 'current render draws the cached path');
	return paths;
}

describe('mode 2 tick-aware ranging', () => {
	let plots;
	beforeEach(() => { plots = []; });
	afterEach(() => { plots.forEach(u => u.destroy()); });

	function mount({ data = [null, pair()], series = [{}], scales = {}, axes = [{}, {}], hooks = {}, pxRatio = 1 } = {}) {
		const state = { active: false, reads: 0, scans: [], builds: [] };
		function trackedData(data) {
			return data.map(facets => facets == null ? null : facets.map(values => new Proxy(values, {
				get(target, key, receiver) {
					// Drawing also reads data; count only indexed reads inside the scanner.
					if (state.active && typeof key == 'string' && /^(0|[1-9]\d*)$/.test(key))
						state.reads++;
					return Reflect.get(target, key, receiver);
				},
			})));
		}
		const u = new uPlot({
			mode: 2, width: 400, height: 400, pxRatio, padding: [0, 0, 0, 0],
			cursor: { show: false }, legend: { show: false },
			scales: {
				x: { time: false, axis: 0, ...scales.x },
				y: { axis: 1, ...scales.y },
				...Object.fromEntries(Object.entries(scales).filter(([key]) => key != 'x' && key != 'y')),
			},
			axes: axes.map((axis, i) => ({ scale: i == 0 ? 'x' : 'y', side: i == 0 ? 2 : 3, size: 0, exact: true, ...(i == 0 ? { space: 50 } : {}), ...axis })),
			series: [{}, ...series.map(s => ({ stroke: 'blue', points: { show: false }, ...s }))],
			hooks,
		}, trackedData(data), document.body);
		plots.push(u);
		for (const key of ['x', 'y']) {
			const scan = u.scales[key].scan;
			u.scales[key].scan = (...args) => {
				state.scans.push(key);
				state.active = true;
				try { return scan(...args); }
				finally { state.active = false; }
			};
		}
		for (let si = 1; si < u.series.length; si++) {
			const paths = u.series[si].paths;
			u.series[si].paths = (...args) => {
				state.builds[si] = (state.builds[si] ?? 0) + 1;
				return paths(...args);
			};
		}
		return { u, state, trackedData, reset() { state.reads = 0; state.scans.length = 0; } };
	}

	it('ranges numeric X and Y and publishes both final ranges and ticks before hooks', async () => {
		const events = [];
		const { u } = mount({ hooks: { setScale: [(u, key) => {
			assertRange(u, 'x', [13, 87]);
			assertRange(u, 'y', [13, 87]);
			events.push(key);
		}] } });
		await tick();
		assert.deepEqual(events.sort(), ['x', 'y']);
		assertDrawn(u, 1);
	});

	it('aggregates matching participating facets of different lengths and keeps full Y extrema after X zoom', async () => {
		const { u, state, reset } = mount({
			data: [null, [[0, 1, 2], [13, 87, 38], [-20, 5, 10]], [[10, 20], [120, 30]],
				[[0], [-900]], [[0, 1], [-800, 800]], [[0, 1], [-700, 700]]],
			series: [
				{ facets: [{ scale: 'x' }, { scale: 'y' }, { scale: 'y' }] },
				{}, { show: false }, { scan: false },
				{ facets: [{ scale: 'x' }, { scale: 'y', scan: false }] },
			],
		});
		await tick();
		assertRange(u, 'x', [0, 20]);
		assertRange(u, 'y', [-20, 120]);
		assert.deepEqual(bounds(u.series[1]), [13, 87], 'series statistics mirror facet 1, not the aggregate');
		reset();
		u.setScale('x', { min: .9, max: 1.1 });
		await tick();
		assert.deepEqual(bounds(u.scales.x), [.9, 1.1]);
		assert.equal(u.scales.x._rawY, null);
		assertRange(u, 'y', [-20, 120]);
		assert.deepEqual(state.scans, ['y']);
		assert.equal(state.reads, 0, 'X zoom retains full-facet extrema caches');
		u.setSeries(2, { show: false });
		await tick();
		assertRange(u, 'y', [-20, 87]);
		u.setSeries(2, { show: true });
		await tick();
		assertRange(u, 'y', [-20, 120]);
		assert.equal(state.reads, 0, 'visibility changes reuse already scanned facets');
	});

	it('invalidates only paths using changed facets on fixed-geometry layout-only redraw, including scan:false', async () => {
		const { u, state, reset } = mount({
			data: [null, pair(), pair(), pair(), pair()],
			scales: { otherX: { time: false, ori: 0, range: [0, 100] }, otherY: { range: [0, 100] } },
			series: [{},
				{ facets: [{ scale: 'x', scan: false }, { scale: 'otherY' }] },
				{ facets: [{ scale: 'otherX' }, { scale: 'y', scan: false }] },
				{ facets: [{ scale: 'otherX' }, { scale: 'otherY' }] },
			],
		});
		await tick();
		reset();
		for (const [ai, key, affected] of [[0, 'x', [1, 2]], [1, 'y', [1, 3]]]) {
			const bbox = { ...u.bbox };
			const before = bounds(u.scales[key]);
			const paths = u.series.map((s, si) => si > 0 ? assertDrawn(u, si) : s._paths);
			const builds = state.builds.slice();
			u.axes[ai].exact = false;
			u.redraw(false, true);
			await tick();
			assertRange(u, key, [13, 87]);
			assert.notDeepEqual(bounds(u.scales[key]), before, 'fixture changes bounds without changing geometry');
			assert.deepEqual(u.bbox, bbox);
			assert.equal(u.series[0]._paths, paths[0]);
			for (let si = 1; si < u.series.length; si++) {
				const current = assertDrawn(u, si);
				assert.equal(state.builds[si] - builds[si], affected.includes(si) ? 1 : 0);
				if (affected.includes(si)) assert.notEqual(current, paths[si]);
				else assert.equal(current, paths[si]);
			}
		}
		assert.deepEqual(state.scans, []);
		assert.equal(state.reads, 0);
	});

	for (const key of ['x', 'y']) {
		for (const request of [{ min: 20, max: 70 }, { min: -10, max: null }, { min: null, max: 100 }]) {
			it(`keeps ${key} setter ${JSON.stringify(request)} ordinary through resize until reset`, async () => {
				const { u } = mount();
				const { u: control } = mount({ scales: { x: { axis: undefined }, y: { axis: undefined } } });
				await tick();
				const ai = u.scales[key].axis;
				u.setScale(key, request);
				control.setScale(key, request);
				await tick();
				const explicit = bounds(u.scales[key]);
				assert.equal(u.scales[key]._rawY, null);
				if (request.min != null) assert.equal(explicit[0], request.min);
				if (request.max != null) assert.equal(explicit[1], request.max);
				for (const size of [250, 400]) {
					for (const plot of [u, control]) {
						plot.setSize({ width: size, height: size });
						plot.redraw(false, true);
					}
					await tick();
					assert.deepEqual(bounds(u.scales[key]), explicit);
					assert.deepEqual(bounds(u.scales[key]), bounds(control.scales[key]));
					assert.deepEqual(u.axes[ai]._splits, control.axes[ai]._splits);
				}
				u.setScale(key, { min: null, max: null });
				await tick();
				assertRange(u, key, [13, 87]);
			});
		}
	}

	for (const recalcAxes of [false, true]) {
		it(`preserves automatic X through redraw(${recalcAxes ? 'true, true' : ''}) and later resize`, async () => {
			const { u, state, reset } = mount();
			await tick();
			const initial = assertRange(u, 'x', [13, 87]);
			const paths = assertDrawn(u, 1);
			reset();
			if (recalcAxes) u.redraw(true, true);
			else u.redraw();
			await tick();
			assert.deepEqual(assertRange(u, 'x', [13, 87]), initial);
			assertRange(u, 'y', [13, 87]);
			assert.notEqual(assertDrawn(u, 1), paths);
			assert.deepEqual(state.scans, ['x', 'y']);
			assert.equal(state.reads, 0, 'redraw reuses full-facet caches');
			reset();
			for (const width of [250, 700, 400]) {
				u.setSize({ width, height: 400 });
				await tick();
				const result = assertRange(u, 'x', [13, 87]);
				if (width == 400) assert.deepEqual(result, initial);
				else assert.notEqual(result.count, initial.count, 'X still selects ticks for the new width');
				assertRange(u, 'y', [13, 87]);
			}
			assert.deepEqual(state.scans, [], 'resize uses retained raw extrema');
			assert.equal(state.reads, 0);
		});
	}

	for (const key of ['x', 'y']) {
		for (const redrawFirst of [false, true]) {
			it(`preserves pending explicit ${key} with redraw ${redrawFirst ? 'before' : 'after'} the setter`, async () => {
				const { u, state, reset } = mount();
				await tick();
				reset();
				if (redrawFirst) u.redraw();
				u.setScale(key, { min: 20, max: 70 });
				if (!redrawFirst) u.redraw();
				await tick();
				assert.deepEqual(bounds(u.scales[key]), [20, 70]);
				assert.equal(u.scales[key]._rawY, null);
				const other = key == 'x' ? 'y' : 'x';
				assertRange(u, other, [13, 87]);
				assert.deepEqual(state.scans, [other], 'the explicit scale does not scan');
				assert.equal(state.reads, 0);
				u.setSize({ width: 650, height: 250 });
				await tick();
				assert.deepEqual(bounds(u.scales[key]), [20, 70]);
				u.setScale(key, { min: null, max: null });
				await tick();
				assertRange(u, key, [13, 87]);
			});
		}
	}

	it('reuses scans on resize/redraw and invalidates facet caches for replacement and notified mutation', async () => {
		const { u, state, reset, trackedData } = mount();
		await tick();
		assert.ok(state.reads > 0);
		reset();
		for (const size of [250, 600, 400]) {
			u.setSize({ width: size, height: size });
			await tick();
			assertRange(u, 'x', [13, 87]);
			assertRange(u, 'y', [13, 87]);
		}
		assert.deepEqual(state.scans, []);
		u.redraw();
		await tick();
		assert.deepEqual(state.scans, ['x', 'y'], 'redraw revisits both tick-aware scales');
		assert.equal(state.reads, 0);
		assertRange(u, 'x', [13, 87]);
		assertRange(u, 'y', [13, 87]);
		const replacement = trackedData([null, [[-10, 20, 100], [-30, 10, 150]]]);
		reset();
		u.setData(replacement);
		assert.deepEqual(bounds(u.series[1].facets[1]), [null, null]);
		await tick();
		assert.ok(state.reads > 0);
		assertRange(u, 'x', [-10, 100]);
		assertRange(u, 'y', [-30, 150]);
		reset();
		replacement[1][1][0] = -60;
		u.setData(replacement, false);
		assert.deepEqual(bounds(u.series[1].facets[1]), [null, null]);
		u.redraw();
		await tick();
		assert.ok(state.reads > 0);
		assertRange(u, 'y', [-60, 150]);
		reset();
		u.redraw();
		await tick();
		assert.equal(state.reads, 0);
	});

	it('uses CSS width and configured spacing for horizontal Y, independent of height and DPR', async () => {
		const { u, state, reset } = mount({
			pxRatio: 2,
			scales: { x: { ori: 1 }, y: { ori: 0, dir: -1 } },
			axes: [{ side: 3, space: undefined }, { side: 2, space: 100 }],
		});
		await tick();
		const initial = assertRange(u, 'y', [13, 87]);
		assertRange(u, 'x', [13, 87]);
		reset();
		u.setSize({ width: 400, height: 650 });
		await tick();
		assert.deepEqual(assertRange(u, 'y', [13, 87]), initial);
		u.setSize({ width: 800, height: 650 });
		await tick();
		assert.notEqual(assertRange(u, 'y', [13, 87]).count, initial.count);
		assert.ok(u.valToPos(u.scales.y.min, 'y') > u.valToPos(u.scales.y.max, 'y'));
		u.setPxRatio(1);
		await tick();
		assertRange(u, 'y', [13, 87]);
		assert.deepEqual(state.scans, []);
		assert.equal(state.reads, 0);
	});

	for (const horizontal of ['x', 'y']) {
		it(`auto-sizes horizontal ${horizontal} before ranging the vertical scale, without resize feedback`, async () => {
			const vertical = horizontal == 'x' ? 'y' : 'x';
			const events = [];
			const { u, state, reset } = mount({
				pxRatio: 2,
				scales: { [horizontal]: { ori: 0 }, [vertical]: { ori: 1 } },
				axes: ['x', 'y'].map(key => key == horizontal ? {
					side: 2, size: 'auto', space: 100,
					values(u, splits) {
						events.push(['horizontal-values', u.bbox.width / u.pxRatio]);
						return splits.map(v => `${v}\nunits`);
					},
				} : {
					side: 3, space: undefined,
					values(u, splits) { events.push(['vertical-values']); return splits; },
					size() { events.push(['vertical-size']); return 80; },
				}),
			});
			await tick();
			const ai = u.scales[horizontal].axis;
			const vi = u.scales[vertical].axis;
			const check = () => {
				const provisionalWidth = u.width - u.axes[vi]._sizeHint;
				assert.deepEqual(events, [['horizontal-values', provisionalWidth], ['vertical-values'], ['vertical-size']],
					'one horizontal tick selection precedes vertical ranging and measurement');
				assert.ok(u.axes[ai]._size > 0, 'multiline labels reserve horizontal axis height');
				assert.equal(u.bbox.height / u.pxRatio, u.height - u.axes[ai]._size);
				assert.equal(u.bbox.width / u.pxRatio, u.width - 80);
				assert.notEqual(provisionalWidth, u.bbox.width / u.pxRatio, 'actual vertical width does not feed back into horizontal ticks');
				assertRange(u, horizontal, [13, 87], provisionalWidth);
				assertRange(u, vertical, [13, 87]);
			};
			check();
			const initial = { bbox: { ...u.bbox }, horizontal: { ...u.scales[horizontal]._rangeY }, vertical: { ...u.scales[vertical]._rangeY } };
			reset();
			for (const width of [700, 400]) {
				events.length = 0;
				u.setSize({ width, height: 400 });
				await tick();
				check();
			}
			assert.deepEqual({ bbox: u.bbox, horizontal: u.scales[horizontal]._rangeY, vertical: u.scales[vertical]._rangeY }, initial);
			assert.deepEqual(state.scans, []);
			assert.equal(state.reads, 0);
		});
	}

	it('clears empty, all-null and hidden aggregates, then recovers both axes', async () => {
		const { u } = mount();
		await tick();
		for (const clear of [
			() => u.setData([null, [[], []]]),
			() => u.setData([null, [[null, null], [null, null]]]),
			() => u.setSeries(1, { show: false }),
		]) {
			clear();
			await tick();
			for (const key of ['x', 'y']) {
				assertRange(u, key, [null, null]);
				assert.equal(u.axes[u.scales[key].axis]._show, false);
			}
			u.setData([null, pair()]);
			u.setSeries(1, { show: true });
			await tick();
			for (const key of ['x', 'y']) {
				assertRange(u, key, [13, 87]);
				assert.equal(u.axes[u.scales[key].axis]._show, true);
			}
		}
	});
});
