import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { syncZeroRanges } from '../demos/lib/syncZeroRanges.js';

const html = await readFile(new URL('../demos/sync-y-zero.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([^]*?)<\/script>/)[1]
	.replace(/import .*?;\s*/, '');
const createDemo = new Function('uPlot', 'syncZeroRanges', 'setTimeout', script + '\nreturn { u, direct, automatic };');

function aligned(ranges, extrema) {
	let zero;
	for (const key in extrema) {
		const bounds = extrema[key];
		if (bounds == null || bounds[0] == null || bounds[1] == null) {
			assert.deepEqual(ranges[key], [null, null]);
			continue;
		}
		const [min, max] = ranges[key];
		assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max);
		const tolerance = Math.max(1, Math.abs(min), Math.abs(max)) * 1e-12;
		assert.ok(min <= bounds[0] + tolerance && max >= bounds[1] - tolerance);
		const position = -min / (max - min);
		if (zero != null)
			assert.ok(Math.abs(position - zero) < 1e-12);
		zero = position;
	}
}

describe('zero-aligned ranges', () => {
	it('calculates the demo ranges directly from raw extrema', () => {
		const extrema = { y: [-10, 100], y2: [-150, 1732], y3: [3751, 10000] };
		const original = structuredClone(extrema);
		const ranges = syncZeroRanges(extrema);
		assert.deepEqual(ranges.y, [-10, 100]);
		assert.ok(Math.abs(ranges.y2[0] + 173.2) < 1e-12);
		assert.equal(ranges.y2[1], 1732);
		assert.deepEqual(ranges.y3, [-1000, 10000]);
		assert.deepEqual(extrema, original);
		aligned(ranges, extrema);
	});

	for (const extrema of [
		{ y: [-10, 35], y2: [-1732, -150], y3: [3751, 10000] },
		{ y: [10, 20], y2: [100, 300] },
		{ y: [-20, -10], y2: [-300, -100] },
		{ y: [0, 0], y2: [0, 0] },
		{ y: [5, 5], y2: [100, 100] },
		{ y: [-5, -5], y2: [-100, -100] },
		{ y: [0, 0], y2: [10, 20], y3: [null, null] },
		{ y: null, y2: [null, null] },
		{},
	]) {
		it(`encloses and aligns ${JSON.stringify(extrema)}`, () => {
			aligned(syncZeroRanges(extrema), extrema);
		});
	}

	it('draws the second chart with final ranges immediately and never redraws it for the timed stages', async () => {
		const draws = [];
		class ObservedPlot extends uPlot {
			constructor(opts, data, target) {
				const snapshots = [];
				draws.push(snapshots);
				super({ ...opts, hooks: { draw: [u => snapshots.push(
					['y', 'y2', 'y3'].map(key => [u.scales[key].min, u.scales[key].max])
				)] } }, data, target);
			}
		}
		const timers = new Map();
		const { u, direct, automatic } = createDemo(ObservedPlot, syncZeroRanges, (callback, delay) => timers.set(delay, callback));
		try {
			await Promise.resolve();
			const expected = Object.values(syncZeroRanges({ y: [-10, 100], y2: [-150, 1732], y3: [3751, 10000] }));
			assert.deepEqual(draws[1], [expected]);
			assert.deepEqual(draws[2], [expected]);
			assert.equal(automatic.data, u.data);
			assert.equal(direct.data, u.data);
			const zero = direct.valToPos(0, 'y');
			for (const key of ['y2', 'y3'])
				assert.ok(Math.abs(direct.valToPos(0, key) - zero) < 1e-9);
			for (const callback of timers.values()) {
				callback();
				await Promise.resolve();
			}
			assert.deepEqual(draws[1], [expected]);
			assert.deepEqual(draws[2], [expected]);
			assert.deepEqual(draws[0].at(-1), expected);
		}
		finally {
			u.destroy();
			direct.destroy();
			automatic.destroy();
		}
	});

	it('recalculates the callback ranges in one draw after data changes and X zoom', async () => {
		const draws = [];
		class ObservedPlot extends uPlot {
			constructor(opts, data, target) {
				const snapshots = [];
				draws.push(snapshots);
				super({ ...opts, hooks: { draw: [u => snapshots.push(
					['y', 'y2', 'y3'].map(key => [u.scales[key].min, u.scales[key].max])
				)] } }, data, target);
			}
		}
		const { u, direct, automatic } = createDemo(ObservedPlot, syncZeroRanges, () => {});
		const keys = ['y', 'y2', 'y3'];
		try {
			await Promise.resolve();
			async function update(action) {
				const count = draws[2].length;
				action();
				await Promise.resolve();
				const [i0, i1] = automatic.series[0].idxs;
				const extrema = Object.fromEntries(keys.map(key => [key, uPlot.scan(automatic, key, i0, i1)]));
				const expected = syncZeroRanges(extrema);
				assert.equal(draws[2].length, count + 1);
				assert.deepEqual(draws[2].at(-1), keys.map(key => expected[key]));
				const visible = keys.filter(key => expected[key][0] != null);
				if (visible.length > 0) {
					const zero = automatic.valToPos(0, visible[0]);
					for (const key of visible)
						assert.ok(Math.abs(automatic.valToPos(0, key) - zero) < 1e-9);
				}
			}
			const data = [[0, 1, 2, 3], [-40, 10, 20, 80], [-500, -100, 50, 300], [1, 4, 8, 12]];
			await update(() => automatic.setData(data));
			await update(() => automatic.setScale('x', { min: 0, max: 1 }));
			await update(() => automatic.setScale('x', { min: 2, max: 3 }));
			await update(() => automatic.setScale('x', { min: null, max: null }));
			await update(() => automatic.setData([[0, 1], [0, 0], [null, null], [0, 0]]));
			await update(() => automatic.setData([[], [], [], []]));
			await update(() => automatic.setData(data));
		}
		finally {
			u.destroy();
			direct.destroy();
			automatic.destroy();
		}
	});

	for (const skipSymmetric of [false, true]) {
		it(`renders aligned final ranges without pixel conversions (skip symmetric: ${skipSymmetric})`, async () => {
			const timers = new Map();
			const { u, direct, automatic } = createDemo(uPlot, syncZeroRanges, (callback, delay) => timers.set(delay, callback));
			try {
				await Promise.resolve();
				const keys = ['y', 'y2', 'y3'];
				const bounds = () => keys.map(key => [u.scales[key].min, u.scales[key].max]);
				assert.deepEqual(bounds(), [[-10, 100], [-150, 1732], [3751, 10000]]);
				if (!skipSymmetric) {
					timers.get(3000)();
					await Promise.resolve();
					assert.deepEqual(bounds(), [[-100, 100], [-1732, 1732], [-10000, 10000]]);
				}
				const valToPos = u.valToPos;
				const posToVal = u.posToVal;
				u.valToPos = u.posToVal = () => { throw new Error('unexpected pixel conversion'); };
				timers.get(6000)();
				u.valToPos = valToPos;
				u.posToVal = posToVal;
				await Promise.resolve();
				const expected = syncZeroRanges({ y: [-10, 100], y2: [-150, 1732], y3: [3751, 10000] });
				assert.deepEqual(bounds(), keys.map(key => expected[key]));
				const zero = u.valToPos(0, 'y');
				for (const key of keys)
					assert.ok(Math.abs(u.valToPos(0, key) - zero) < 1e-9);
			}
			finally {
				u.destroy();
				direct.destroy();
				automatic.destroy();
			}
		});
	}
});
