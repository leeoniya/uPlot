import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits } from '../src/opts.js';

const data = [[0, 1, 2], [13, 87, 38]];
const tick = () => Promise.resolve();
const bounds = u => [u.scales.y.min, u.scales.y.max];
const splits = u => u.axes[1]._splits ?? [];

function assertRange(u, dim, space, extrema = [13, 87]) {
	const sc = u.scales.y;
	const axis = u.axes[1];
	const expected = rangeY(...extrema, dim, sc._policyY, axis.ramp, axis.exact, space);
	assert.equal(sc.axis, 1);
	assert.equal(sc._axisY, true, 'horizontal scale participates in tick-aware ranging');
	assert.deepEqual(sc._rawY, extrema);
	assert.ok(expected);
	assert.deepEqual(sc._rangeY, expected, 'range uses provisional CSS width and configured spacing');
	assert.deepEqual(bounds(u), [expected.min, expected.max]);
	const ticks = expected.count === 1 ? [expected.min, expected.max]
		: numAxisSplits(u, 1, expected.min, expected.max, expected.incr, 0, true);
	assert.deepEqual(splits(u), ticks);
	assert.deepEqual([ticks[0], ticks.at(-1)], bounds(u));
	if (axis.exact)
		assert.equal(expected.count, rangeYCount(dim, axis.ramp, space));
	return expected;
}

describe('horizontal tick-aware Y ranging', () => {
	let plots;
	beforeEach(() => { plots = []; });
	afterEach(() => {
		for (const u of plots)
			u.destroy();
	});

	function mount({ width = 900, height = 300, pxRatio = 1, y = {}, axis = {}, xAxis = {}, padding = [0, 10, 0, 20], hooks = {}, plotData = data } = {}) {
		const scans = [];
		const u = new uPlot({
			width, height, pxRatio, padding,
			cursor: { show: false }, legend: { show: false },
			scales: {
				x: { time: false, ori: 1, distr: 2, range: () => [-.5, 2.5] },
				y: {
					time: false, ori: 0, axis: 1,
					scan(u, key, i0, i1) {
						const extrema = uPlot.scan(u, key, i0, i1, true);
						scans.push(extrema.slice());
						return extrema;
					},
					...y,
				},
			},
			axes: [{ show: false, side: 3, ...xAxis }, { side: 2, size: 40, space: 100, ...axis }],
			series: [{}, { paths: () => null, points: { show: false } }],
			hooks,
		}, plotData, document.body);
		plots.push(u);
		return { u, scans };
	}

	for (const pxRatio of [1, 2]) {
		for (const exact of [false, true]) {
			it(`uses width, not height, without rescans (DPR ${pxRatio}, exact ${exact})`, async () => {
				const { u, scans } = mount({ pxRatio, axis: { exact } });
				await tick();
				const counts = new Set();
				for (const width of [900, 300, 600, 900]) {
					u.setSize({ width, height: 300 });
					await tick();
					const expected = assertRange(u, width - 30, 100);
					assert.equal(u.bbox.width / pxRatio, width - 30);
					counts.add(expected.count);
					for (const height of [650, 200, 300]) {
						u.setSize({ width, height });
						await tick();
						assert.deepEqual(assertRange(u, width - 30, 100), expected, 'height alone does not change the range');
					}
				}
				assert.ok(counts.size > 1, 'width changes the tick count');
				assert.equal(scans.length, 1, 'resizing reuses raw extrema');
			});
		}
	}

	for (const side of [0, 2]) {
		it(`honors numeric spacing and ramp on axis side ${side}`, async () => {
			const counts = [];
			for (const space of [50, 100, 200]) {
				const { u } = mount({ axis: { side, space, exact: true, ramp: .75 }, y: { dir: -1 } });
				await tick();
				counts.push(assertRange(u, 870, space).count);
				assert.ok(u.valToPos(u.scales.y.min, 'y') > u.valToPos(u.scales.y.max, 'y'), 'direction does not alter range selection');
			}
			assert.ok(counts[0] > counts[1] && counts[1] > counts[2]);
		});
	}

	for (const pxRatio of [1, 2]) {
		it(`ranges after axis auto-sizing and baseline padding, before overflow padding (DPR ${pxRatio})`, async () => {
			const events = [];
			let labels = ['A', 'B', 'C'];
			let overflow = 180;
			const baseline = [7, 11, 13, 17];
			const { u, scans } = mount({
				pxRatio,
				xAxis: {
					show: true,
					splits: () => [0, 1, 2],
					values: () => labels,
					size(u, values) {
						events.push(['category-size', values.slice()]);
						return Math.max(...values.map(label => label.length)) * 8 + 20;
					},
				},
				axis: {
					exact: true,
					size(u, values) {
						events.push(['numeric-size', values]);
						return u.axes[1].font[1] / u.pxRatio + 28;
					},
					space(u, i, min, max, dim) {
						events.push(['space', i, min, max, dim]);
						return 100;
					},
					values(u, values) {
						events.push(['numeric-values', values.slice()]);
						return values.map(String);
					},
				},
				padding: baseline.map((pad, side) => (u, i, sides, phase) => {
					events.push(['padding', side, phase]);
					assert.equal(i, side);
					if (phase === 1) {
						assert.ok(u.axes[1]._values.length > 0, 'overflow sees current numeric labels');
						assert.deepEqual([splits(u)[0], splits(u).at(-1)], bounds(u));
						assert.deepEqual(u._padding, baseline, 'both overflow callbacks see baseline padding');
					}
					return pad + (phase === 1 && side === 1 ? overflow : 0);
				}),
			});
			await tick();
			const counts = [];
			for (const nextLabels of [labels, ['A much longer category label', 'B', 'C'], ['A', 'B', 'C']]) {
				labels = nextLabels;
				for (const nextOverflow of [180, 0, 180]) {
					overflow = nextOverflow;
					events.length = 0;
					u.redraw(false, true);
					await tick();
					const categorySize = Math.max(...labels.map(label => label.length)) * 8 + 20;
					const dim = 900 - categorySize - 11 - 17;
					assert.equal(u.axes[0]._size, categorySize);
					const expected = assertRange(u, dim, 100);
					assert.equal(u.bbox.width / pxRatio, dim - overflow, 'overflow changes final geometry, not the ranger input');
					assert.deepEqual(u._padding, [7, 11 + overflow, 13, 17]);
					assert.equal(u.bbox.height / pxRatio, 300 - u.axes[1]._size - 7 - 13);
					assert.deepEqual(events.map(event => event[0]), [
						'numeric-size', 'padding', 'padding', 'padding', 'padding',
						'category-size', 'space', 'numeric-values', 'padding', 'padding',
					], 'one sizing/ranging pass in layout order');
					assert.deepEqual(events[0], ['numeric-size', null]);
					assert.deepEqual(events[5], ['category-size', labels]);
					assert.deepEqual(events[6], ['space', 1, 13, 87, dim], 'spacing receives raw bounds and provisional CSS width');
					assert.deepEqual(events[7], ['numeric-values', splits(u)]);
					counts.push(expected.count);
				}
			}
			assert.equal(counts[0], counts[1]);
			assert.equal(counts[1], counts[2]);
			assert.ok(counts[3] < counts[0], 'wider categories reduce the tick target');
			assert.deepEqual(counts.slice(0, 3), counts.slice(6), 'no layout feedback on restoration');
			assert.equal(scans.length, 1);
		});
	}

	it('uses callback spacing on each layout without scanning again', async () => {
		const calls = [];
		let space = 75;
		const { u, scans } = mount({ axis: {
			exact: true,
			space(u, i, min, max, dim) {
				calls.push([i, min, max, dim]);
				return space;
			},
		} });
		await tick();
		const first = assertRange(u, 870, 75);
		assert.deepEqual(calls, [[1, 13, 87, 870]]);
		space = 150;
		u.redraw(false, true);
		await tick();
		assert.ok(assertRange(u, 870, 150).count < first.count);
		assert.equal(calls.length, 2);
		assert.equal(scans.length, 1);
	});

	it('clears empty, all-null, and hidden data without calling space with null bounds, then recovers', async () => {
		let calls = 0;
		const notifications = [];
		const { u } = mount({ axis: {
			space(u, i, min, max) {
				assert.ok(Number.isFinite(min) && Number.isFinite(max));
				calls++;
				return 100;
			},
		}, hooks: { setScale: [(u, key) => {
			if (key === 'y') notifications.push({ bounds: bounds(u), ticks: splits(u).slice() });
		}] } });
		await tick();
		for (const clear of [
			() => u.setData([[], []]),
			() => u.setData([[0, 1, 2], [null, null, null]]),
			() => u.setSeries(1, { show: false }),
		]) {
			const before = calls;
			notifications.length = 0;
			clear();
			await tick();
			assert.equal(calls, before);
			assert.deepEqual(u.scales.y._rawY, [null, null]);
			assert.deepEqual(u.scales.y._rangeY, { min: null, max: null, incr: 0, count: 0 });
			assert.deepEqual(bounds(u), [null, null]);
			assert.deepEqual(splits(u), []);
			assert.equal(u.axes[1]._show, false);
			assert.deepEqual(notifications, [{ bounds: [null, null], ticks: [] }]);
			u.setData(data);
			u.setSeries(1, { show: true });
			await tick();
			assertRange(u, 870, 100);
			assert.equal(u.axes[1]._show, true);
			assert.ok(calls > before);
			assert.deepEqual(notifications.at(-1), { bounds: bounds(u), ticks: splits(u) });
		}
	});

	it('retains ordinary explicit bounds and restores horizontal ranging after reset', async () => {
		const { u } = mount();
		await tick();
		assertRange(u, 870, 100);
		u.setScale('y', { min: -20, max: 120 });
		await tick();
		assert.equal(u.scales.y._rawY, null);
		assert.deepEqual(bounds(u), [-20, 120]);
		u.setSize({ width: 300, height: 300 });
		await tick();
		assert.deepEqual(bounds(u), [-20, 120]);
		u.setScale('y', { min: null, max: null });
		await tick();
		assertRange(u, 270, 100);
	});
});
