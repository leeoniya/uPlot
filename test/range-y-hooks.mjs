import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';

const data = [
	[0, 1, 2, 3, 4, 5, 6, 7],
	[13, 24, 51, 38, 87, 65, 42, 72],
	[6500, 8700, 4300, 1300, 3100, 7200, 5600, 2200],
];
const keys = ['y', 'right'];
const bounds = (u, key) => [u.scales[key].min, u.scales[key].max];

async function plot() {
	const draws = [], flags = [], sizes = [];
	const u = new uPlot({
		width: 600, height: 413, pxRatio: 1, padding: [0, 0, 0, 0],
		legend: { show: false }, cursor: { show: false },
		scales: {
			x: { time: false },
			...Object.fromEntries(keys.map((key, i) => [key, {
				axis: i + 1,
				auto(u, viaAutoScaleX) { flags.push(viaAutoScaleX); return true; },
			}])),
		},
		axes: [{ show: false }, ...keys.map((key, i) => ({
			scale: key, side: i == 0 ? 3 : 1,
			size() { sizes.push(key); return 0; },
		}))],
		series: [{}, ...keys.map(key => ({ scale: key, stroke: 'blue', points: { show: false } }))],
		hooks: { draw: [u => draws.push({ height: u.bbox.height / u.pxRatio, x: bounds(u, 'x') })] },
	}, data, document.body);
	await Promise.resolve();
	draws.length = flags.length = sizes.length = 0;
	return { u, draws, flags, sizes };
}

function assertRanges(u, extrema, height) {
	assert.equal(u.bbox.height / u.pxRatio, height);
	const positions = keys.map((key, i) => {
		const r = rangeY(...extrema[i], height);
		assert.deepEqual(bounds(u, key), [r.min, r.max]);
		const ticks = u.axes[i + 1]._splits;
		assert.equal(ticks.length, r.count + 1);
		assert.deepEqual([ticks[0], ticks.at(-1)], [r.min, r.max]);
		return ticks.map(v => u.valToPos(v, key));
	});
	positions[0].forEach((p, i) => assert.ok(Math.abs(p - positions[1][i]) < 1e-8));
}

describe('axis-ranging Y hooks: follow-up microtasks', () => {
	for (const action of ['resize', 'pixel ratio', 'X zoom', 'data', 'explicit Y']) {
		it(`preserves a ${action} request from a Y hook for the next render`, async () => {
			const { u, draws, flags, sizes } = await plot();
			let armed = true;
			u.hooks.setScale = [(u, key) => {
				if (!armed || key != 'y') return;
				armed = false;
				assertRanges(u, [[38, 38], [1300, 1300]], 413);
				flags.length = 0;
				const bbox = { ...u.bbox };
				if (action == 'resize') u.setSize({ width: 600, height: 525 });
				if (action == 'pixel ratio') u.setPxRatio(2);
				if (action == 'X zoom') u.setScale('x', { min: 5.9, max: 6.1 });
				if (action == 'data') u.setData([data[0], data[1].map(v => v * 2), data[2].map(v => v / 10)]);
				if (action == 'explicit Y') u.setScale('y', { min: 10, max: 90 });
				assert.deepEqual(u.bbox, bbox, 'the hook does not re-enter layout');
			}];
			try {
				u.setScale('x', { min: 2.9, max: 3.4 });
				await Promise.resolve();
				assert.equal(armed, false);
				assert.equal(draws.length, 1, 'the initiating render finishes once');
				await Promise.resolve();
				assert.equal(draws.length, 2, 'the hook request gets one follow-up render');
				assert.deepEqual(sizes, ['y', 'right', 'y', 'right'], 'one measurement per axis per render');
				if (action == 'explicit Y') {
					assert.deepEqual(bounds(u, 'y'), [10, 90]);
					assert.deepEqual(bounds(u, 'right'), [0, 4000]);
				}
				else {
					const extrema = action == 'X zoom' ? [[42, 42], [5600, 5600]] :
						action == 'data' ? [[26, 174], [130, 870]] : [[38, 38], [1300, 1300]];
					assertRanges(u, extrema, action == 'resize' ? 525 : 413);
				}
				if (action == 'data') {
					assert.deepEqual(bounds(u, 'x'), [0, 7]);
					assert.ok(flags.length > 0 && flags.every(flag => flag === true), 'the new automatic reset retains its scan policy');
				}
				else if (action == 'X zoom') {
					assert.deepEqual(bounds(u, 'x'), [5.9, 6.1]);
					assert.ok(flags.length > 0 && flags.every(flag => flag === false));
				}
				else if (action != 'explicit Y')
					assert.deepEqual(flags, [], 'layout-only requests do not revisit scanner policy');
				if (action == 'pixel ratio')
					assert.equal(u.root.querySelector('canvas').height, 826);
				await Promise.resolve();
				assert.equal(draws.length, 2, 'no convergence or redundant render');
			}
			finally { u.destroy(); }
		});
	}

	it('coalesces requests from both Y hooks into one follow-up layout', async () => {
		const { u, draws, sizes } = await plot();
		const pending = new Set(keys);
		u.hooks.setScale = [(u, key) => {
			if (pending.delete(key))
				u.setSize({ width: 600, height: key == 'y' ? 525 : 750 });
		}];
		try {
			u.setScale('x', { min: 2.9, max: 3.4 });
			await Promise.resolve();
			await Promise.resolve();
			assertRanges(u, [[38, 38], [1300, 1300]], 750);
			assert.equal(draws.length, 2);
			assert.deepEqual(sizes, ['y', 'right', 'y', 'right']);
			await Promise.resolve();
			assert.equal(draws.length, 2);
		}
		finally { u.destroy(); }
	});

	it('does not schedule a follow-up for a no-op setter', async () => {
		const { u, draws, sizes } = await plot();
		u.hooks.setScale = [(u, key) => {
			if (keys.includes(key)) u.setSize({ width: 600, height: 413 });
		}];
		try {
			u.setScale('x', { min: 2.9, max: 3.4 });
			await Promise.resolve();
			await Promise.resolve();
			assertRanges(u, [[38, 38], [1300, 1300]], 413);
			assert.equal(draws.length, 1);
			assert.deepEqual(sizes, ['y', 'right']);
		}
		finally { u.destroy(); }
	});
});
