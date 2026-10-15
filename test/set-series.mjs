import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [10, 20, 30], [40, 50, 60], [70, 80, 90]];
const frame = () => new Promise(requestAnimationFrame);

async function plot(mode) {
	const hooks = [];
	const publications = [];
	const ranges = [];
	let draws = 0;
	let legendRenders = 0;
	const u = new uPlot({
		mode, width: 200, height: 200, pxRatio: 1,
		padding: [0, 0, 0, 0],
		axes: [{ show: false }, { show: false }],
		focus: { alpha: 0.25 },
		cursor: { sync: { filters: { pub(type, self, i, opts) {
			if (type == 'setSeries')
				publications.push([i, opts.show]);
			return false;
		} } } },
		scales: {
			x: { time: false, range: () => { ranges.push('x'); return [0, 2]; } },
			...Object.fromEntries([1, 2, 3].map(i => [`y${i}`, {
				range: () => { ranges.push(`y${i}`); return [0, 100]; },
			}])),
		},
		series: [{}, ...[1, 2, 3].map(i => ({
			label: `Series ${i}`, stroke: 'red', points: { show: false },
			...(mode == 1 ? { scale: `y${i}` } : { facets: [{ scale: 'x' }, { scale: `y${i}` }] }),
		}))],
		hooks: {
			setSeries: [(self, i, opts) => hooks.push([i, opts.show])],
			draw: [() => draws++],
		},
	}, mode == 1 ? data : [null, ...data.slice(1).map(y => [data[0], y])], document.body);
	await frame();
	hooks.length = publications.length = ranges.length = 0;
	draws = 0;
	Object.defineProperty(u.series[1], 'class', { get() { legendRenders++; return ''; } });
	return { u, hooks, publications, ranges, get draws() { return draws; }, get legendRenders() { return legendRenders; } };
}

for (const mode of [1, 2]) {
	describe(`setSeries target selection in mode ${mode}`, () => {
		it('selects a single Y series without reading unrelated series entries', async () => {
			const f = await plot(mode);
			const { u, hooks, publications, ranges } = f;
			const descriptors = [1, 3].map(i => Object.getOwnPropertyDescriptor(u.series, i));
			let reads = 0;
			try {
				[1, 3].forEach((i, j) => Object.defineProperty(u.series, i, {
					configurable: true, enumerable: true,
					get() { reads++; return descriptors[j].value; },
				}));
				u.setSeries(2, { show: false }, true, true);
				const selectionReads = reads;
				[1, 3].forEach((i, j) => Object.defineProperty(u.series, i, descriptors[j]));
				assert.equal(selectionReads, 0, 'synchronous target selection must not scan other series');
				assert.deepEqual(u.series.slice(1).map(s => s.show), [true, false, true]);
				assert.deepEqual(hooks, [[2, false]]);
				assert.deepEqual(publications, [[2, false]]);
				await frame();
				assert.equal(f.draws, 1);
				assert.equal(f.legendRenders, 1);
				assert.equal(ranges.includes('y2'), true, 'the selected Y scale is invalidated');
				assert.equal(ranges.includes('x'), mode == 2, 'mode 2 also invalidates the X facet');
				assert.deepEqual([...u.root.querySelectorAll('tbody tr')].slice(-3).map(tr => tr.classList.contains('u-off')), [false, true, false]);
			}
			finally {
				[1, 3].forEach((i, j) => Object.defineProperty(u.series, i, descriptors[j]));
				u.destroy();
			}
		});

		for (const index of [null, undefined]) {
			it(`changes every Y series, but not series zero, for index ${index}`, async () => {
				const f = await plot(mode);
				const { u, hooks, publications } = f;
				const zeroShow = u.series[0].show;
				try {
					u.setSeries(index, { show: false }, true, true);
					assert.equal(u.series[0].show, zeroShow);
					assert.deepEqual(u.series.slice(1).map(s => s.show), [false, false, false]);
					assert.deepEqual(hooks, [[index, false]]);
					assert.deepEqual(publications, [[index, false]]);
					await frame();
					assert.equal(f.draws, 1);
					assert.equal(f.legendRenders, 1);
					u.setSeries(index, { show: true });
					assert.deepEqual(u.series.slice(1).map(s => s.show), [true, true, true]);
					await frame();
					assert.equal(f.draws, 2);
					assert.equal(f.legendRenders, 2);
					u.setSeries(index, { show: true });
					await frame();
					assert.equal(f.draws, 3);
					assert.equal(f.legendRenders, 2, 'an unchanged all-series request needs no legend render');
				}
				finally { u.destroy(); }
			});
		}

		it('ignores zero, fractional, and out-of-range targets while retaining notifications', async () => {
			const f = await plot(mode);
			const { u, hooks, publications, ranges } = f;
			const indices = [0, -1, 1.5, u.series.length, NaN, Infinity];
			try {
				for (const index of indices)
					u.setSeries(index, { show: false }, true, true);
				assert.deepEqual(u.series.slice(1).map(s => s.show), [true, true, true]);
				assert.deepEqual(hooks, indices.map(i => [i, false]));
				assert.deepEqual(publications, hooks);
				await frame();
				assert.equal(f.draws, 0);
				assert.equal(f.legendRenders, 0);
				assert.deepEqual(ranges, []);
			}
			finally { u.destroy(); }
		});

		it('retains hook suppression and opt-in sync publication', async () => {
			const { u, hooks, publications } = await plot(mode);
			try {
				u.setSeries(2, { show: false }, false, true);
				assert.deepEqual(hooks, []);
				assert.deepEqual(publications, [[2, false]]);
				u.setSeries(2, { show: true });
				assert.deepEqual(hooks, [[2, true]]);
				assert.deepEqual(publications, [[2, false]]);
				await frame();
			}
			finally { u.destroy(); }
		});

		it('retains invalidation, drawing, and notifications for unchanged visibility', async () => {
			const f = await plot(mode);
			const { u, hooks, publications, ranges } = f;
			try {
				u.setSeries(2, { show: true }, true, true);
				assert.deepEqual(hooks, [[2, true]]);
				assert.deepEqual(publications, [[2, true]]);
				await frame();
				assert.equal(f.draws, 1);
				assert.equal(ranges.includes('y2'), true);
				assert.equal(ranges.includes('x'), mode == 2);
				assert.equal(f.legendRenders, 0);
			}
			finally { u.destroy(); }
		});

		it('skips legend rendering for a series that is already hidden', async () => {
			const f = await plot(mode);
			const { u, hooks, publications } = f;
			try {
				u.setSeries(2, { show: false }, true, true);
				await frame();
				assert.equal(f.legendRenders, 1);
				u.setSeries(2, { show: false }, true, true);
				await frame();
				assert.equal(f.legendRenders, 1);
				assert.equal(f.draws, 2);
				assert.deepEqual(hooks, [[2, false], [2, false]]);
				assert.deepEqual(publications, hooks);
			}
			finally { u.destroy(); }
		});

		it('still renders changed focus and explicit values with unchanged visibility', async () => {
			const f = await plot(mode);
			const { u, hooks, publications } = f;
			try {
				u.setSeries(2, { focus: true, show: true }, true, true);
				assert.deepEqual(u.series.slice(1).map(s => s._focus), [false, true, false]);
				assert.deepEqual(hooks, [[2, true]]);
				assert.deepEqual(publications, hooks);
				await frame();
				assert.equal(f.legendRenders, 1);
				assert.deepEqual([...u.root.querySelectorAll('tbody tr')].slice(-3).map(tr => tr.style.opacity), ['0.25', '', '0.25']);
				u.setSeries(2, { focus: true, show: true });
				await frame();
				assert.equal(f.legendRenders, 1);
				assert.equal(f.draws, 2);
				u.setLegend({ idx: 1 });
				await frame();
				assert.equal(f.legendRenders, 2);
			}
			finally { u.destroy(); }
		});

		it('coalesces actual visibility changes without canceling them on later no-op requests', async () => {
			const f = await plot(mode);
			const { u } = f;
			try {
				u.setSeries(2, { show: false });
				u.setSeries(2, { show: true });
				u.setSeries(2, { show: true });
				u.setSeries(0, { show: false });
				assert.equal(f.legendRenders, 0);
				await frame();
				assert.equal(f.legendRenders, 1);
				assert.equal(f.draws, 1);
				assert.deepEqual([...u.root.querySelectorAll('tbody tr')].slice(-3).map(tr => tr.classList.contains('u-off')), [false, false, false]);
			}
			finally { u.destroy(); }
		});
	});
}
