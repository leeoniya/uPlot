import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { getDemoSteps } from '../scripts/demoSteps.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';
import trendlines from '../demos/trendlines.js';
import softMinmax, { setDataValue } from '../demos/soft-minmax.js';
import nearestNonNull from '../demos/nearest-non-null.js';
import { createGroups } from '../demos/log-scales2.js';
import stackedSeries from '../demos/stacked-series.js';

function click(label) {
	label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

describe('demo migrations', () => {
	let previousUPlot;
	let bodyChildren;
	let livePlots;

	beforeEach(() => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		bodyChildren = new Set(document.body.children);
		livePlots = [];
	});

	afterEach(() => {
		for (const plot of livePlots)
			plot.destroy();
		// Some demos also insert page prose and separators outside plot roots.
		for (const child of [...document.body.children]) {
			if (!bodyChildren.has(child))
				child.remove();
		}
		globalThis.uPlot = previousUPlot;
	});

	async function render(groups, index = 0) {
		let plots;
		await withSeededRandom(async () => {
			plots = await getDemoSteps(groups)[index].step.render();
		});
		livePlots.push(...plots);
		await new Promise(requestAnimationFrame);
		return plots;
	}

	it('snaps trendline drag zoom to data values', async () => {
		const [plot] = await render(trendlines);
		const candidate = [10.4, 20.6];
		const expected = candidate.map(value => plot.data[0][plot.valToIdx(value)]);
		const refined = plot.cursor.drag.setRange(plot, 'x', ...candidate);
		assert.deepStrictEqual(refined, plot.scales.x.range(plot, ...candidate, 'x'));
		assert.deepStrictEqual(refined, expected);
		assert.notDeepStrictEqual(refined, candidate);
	});

	it('updates the five soft-minmax plots together without changing the independent zero plot', async () => {
		const plots = [...await render(softMinmax), ...await render(softMinmax, 1)];
		const zeroRange = [plots[5].scales.y.min, plots[5].scales.y.max];
		setDataValue(plots, 12.1);
		await Promise.resolve();
		for (const plot of plots.slice(0, 5)) {
			assert.equal(plot.data, plots[0].data);
			assert.equal(plot.data[1][1], 12.1);
			assert.equal(plot.series[1].max, 12.1);
		}
		assert.deepStrictEqual(plots[5].data, [[1, 2], [0, 0]]);
		assert.deepStrictEqual([plots[5].scales.y.min, plots[5].scales.y.max], zeroRange);
		const fresh = await render(softMinmax);
		assert.notEqual(fresh[0].data, plots[0].data);
		assert.equal(fresh[0].data[1][1], 12);
	});

	it('restacks on legend clicks and restores the original stack without affecting its companion', async () => {
		const [plot, companion] = await render(stackedSeries);
		const original = structuredClone(plot.data);
		const originalStack = structuredClone(plot._data);
		const companionStack = structuredClone(companion._data);
		const companionBands = companion.bands.map(band => band.series.slice());
		const bands = plot.bands.map(band => band.series.slice());
		const label = plot.root.querySelectorAll('.u-label')[1];
		click(label);
		await Promise.resolve();
		assert.equal(plot.series[1].show, false);
		assert.deepStrictEqual(plot.data, original);
		let accum = Array(original[0].length).fill(0);
		for (let si = 2; si < plot.data.length; si++) {
			let expected = original[si].map((v, i) => (accum[i] += v));
			assert.deepStrictEqual(plot._data[si], expected);
		}
		assert.ok(plot.bands.every(band => !band.series.includes(1)));
		assert.deepStrictEqual(companion._data, companionStack);
		assert.deepStrictEqual(companion.bands.map(band => band.series), companionBands);
		click(label);
		await Promise.resolve();
		assert.equal(plot.series[1].show, true);
		assert.deepStrictEqual(plot.data, original);
		assert.deepStrictEqual(plot._data, originalStack);
		assert.deepStrictEqual(plot.bands.map(band => band.series), bands);
	});

	for (const [index, series] of [[1, [1, 2, 3, 4]], [11, [2, 3]]]) {
		it(`uses explicit baselines without bands for positive stacked bars (step ${index})`, async () => {
			const [plot] = await render(stackedSeries, index);
			assert.deepStrictEqual(plot.bands, []);
			const accum = Array(plot.data[0].length).fill(0);
			for (const si of series) {
				assert.ok(plot.data[si].every(value => value == null || value >= 0));
				assert.deepStrictEqual(plot._base[si], plot.data[si].map((value, i) => value == null ? value : accum[i]));
				assert.deepStrictEqual(plot._data[si], plot.data[si].map((value, i) => value == null ? value : (accum[i] += value)));
			}
			if (index === 11) {
				assert.equal(plot._base[1], null);
				assert.deepStrictEqual(plot._data[1], plot.data[1]);
			}
		});
	}

	it('treats the interpolated sample as normal data for points, cursor, and legend', async () => {
		const [plot] = await render(stackedSeries, 2);
		assert.deepStrictEqual(plot.data, [
			[0, 1, 2, 3, 4, 5],
			[0, 1, 2, 3, 4, 5],
			[5, 4, 3, 2, 1, 0],
		]);
		assert.deepStrictEqual(plot._data[2], [5, 5, 5, 5, 5, 5]);
		assert.equal(plot.series[2].points.filter(plot, 2, true), null);
		const arcs = plot.series[2].points._paths.fill.log
			.filter(entry => entry[0] === 'arc').flatMap(entry => entry.slice(1));
		assert.equal(arcs.length, 6);

		plot.setCursor({ left: plot.valToPos(3, 'x'), top: plot.valToPos(5, 'y') });
		assert.equal(plot.cursor.idx, 3);
		assert.equal(plot.legend.idxs[2], 3);
		assert.equal(plot.over.querySelectorAll('.u-cursor-pt')[1].classList.contains('u-off'), false);
		await new Promise(requestAnimationFrame);
		assert.equal(plot.root.querySelectorAll('.u-value')[2].textContent, '2');
	});

	it('preserves signed sample data and keeps each render independent', async () => {
		for (const [index, green, red] of [
			[3, -10, -5],
			[4, undefined, undefined],
			[5, -10, null],
			[6, null, -5],
			[7, null, null],
			[8, 0, 0],
		]) {
			const plots = await render(stackedSeries, index);
			const fresh = await render(stackedSeries, index);
			for (let i = 0; i < plots.length; i++) {
				assert.deepStrictEqual(plots[i].data, [
					[0, 1, 2, 3, 4],
					[5, 5, 5, 5, 5],
					[-10, -10, green, -10, -10],
					[10, 10, 10, 10, 10],
					[-5, -5, red, -5, -5],
				]);
				assert.deepStrictEqual(fresh[i].data, plots[i].data);
				for (let si = 0; si < plots[i].data.length; si++)
					assert.notEqual(fresh[i].data[si], plots[i].data[si]);
			}
		}
	});

	it('keeps percent stack source data raw', async () => {
		const [plot] = await render(stackedSeries, 9);
		assert.equal(plot.data[1][0], 5);
		assert.equal(plot.data[2][0], -25);
		assert.ok(Math.abs(plot._data[1][0] - 1 / 3) < 1e-12);
		assert.equal(plot._data[3][0], 1);
		assert.ok(Math.abs(plot._data[2][0] + 5 / 6) < 1e-12);
		assert.equal(plot._data[4][0], -1);
	});

	for (const [index, percent] of [[12, false], [13, true]]) {
		it(`renders mixed-sign bars${percent ? ' as percent' : ''} with raw legends and restacking`, async () => {
			assert.equal(getDemoSteps(stackedSeries)[index].id, percent ? '1-10' : '1-9');
			const [plot] = await render(stackedSeries, index);
			const raw = structuredClone(plot.data);
			for (const values of raw.slice(1))
				assert.ok(values.some(v => v > 0) && values.some(v => v < 0));
			assert.deepStrictEqual(plot.bands, []);
			assert.deepStrictEqual([plot._base[2][0], plot._data[2][0]], percent ? [0.6, 1] : [3, 5]);
			assert.deepStrictEqual([plot._base[4][0], plot._data[4][0]], percent ? [-0.8, -1] : [-4, -5]);
			for (const [si, i, value] of [[2, 5, null], [4, 4, null]]) {
				assert.equal(raw[si][i], value);
				assert.equal(plot._data[si][i], value);
				assert.equal(plot._base[si][i], value);
			}
			assert.equal(raw[2][4], 0);
			assert.equal(plot._data[2][4], plot._base[2][4]);

			plot.setCursor({left: plot.valToPos(0, 'x'), top: plot.valToPos(0, 'y')});
			await new Promise(requestAnimationFrame);
			assert.deepStrictEqual([...plot.root.querySelectorAll('.u-value')].slice(1).map(el => el.textContent),
				['3', '2', '-4', '-1']);

			const points = [...plot.over.querySelectorAll('.u-cursor-pt')];
			plot.setCursor({left: plot.valToPos(3, 'x'), top: plot.valToPos(0.35, 'y')});
			assert.equal(plot.cursor.idxs[4], 3);
			assert.equal(points[3].classList.contains('u-off'), false);
			plot.setCursor({left: plot.valToPos(4, 'x'), top: plot.valToPos(0.35, 'y')});
			assert.equal(plot.cursor.idxs[4], 4);
			assert.equal(plot.legend.values[4]._, '');
			assert.equal(points[3].classList.contains('u-off'), true);

			const stacked = structuredClone(plot._data);
			const baselines = structuredClone(plot._base);
			const label = plot.root.querySelectorAll('.u-label')[1];
			click(label);
			await new Promise(requestAnimationFrame);
			assert.equal(plot.series[1].show, false);
			assert.equal(plot._base[2][0], 0);
			assert.equal(plot._data[2][0], percent ? 1 : 2);
			assert.equal(plot._data[4][0], percent ? -1 : -5);
			assert.deepStrictEqual(plot.data, raw);
			click(label);
			await new Promise(requestAnimationFrame);
			assert.equal(plot.series[1].show, true);
			assert.deepStrictEqual(plot.data, raw);
			assert.deepStrictEqual(plot._data, stacked);
			assert.deepStrictEqual(plot._base, baselines);
		});
	}

	it('keeps the inverted log pair linked with independent legends in one shared host', async () => {
		const now = 1700000000;
		const [top, bottom] = await render(createGroups(now), 3);
		assert.deepStrictEqual(top.data[0], [now - 10800, now - 7200, now - 3600, now]);
		assert.equal(bottom.data === top.data, true);
		assert.equal(top.root.querySelector('.u-legend') === null, true);
		const legends = [...bottom.root.querySelectorAll('.u-legend')];
		assert.equal(legends.length, 2);
		assert.equal(legends[0].parentElement === legends[1].parentElement, true);
		const labels = legends.map(el => [...el.querySelectorAll('.u-label')]);
		assert.deepStrictEqual(labels.map(group => group.map(el => el.textContent)), [['Time', 'In'], ['Time', 'Out']]);
		const inLabel = labels[0][1];
		const outLabel = labels[1][1];
		top.setCursor({ left: top.valToPos(now - 3600, 'x'), top: 20 }, true, true);
		assert.equal(top.cursor.idx, 2);
		assert.equal(bottom.cursor.idx, 2);
		assert.equal(top.legend.idxs[1], 2);
		assert.equal(bottom.legend.idxs[1], 2);
		await new Promise(requestAnimationFrame);
		assert.deepStrictEqual(legends.map(el => el.querySelectorAll('.u-value')[1].textContent),
			[top.legend.values[1]._, bottom.legend.values[1]._].map(String));
		click(inLabel);
		await new Promise(requestAnimationFrame);
		assert.equal(top.series[1].show, false);
		assert.equal(bottom.series[1].show, true);
		click(inLabel);
		await new Promise(requestAnimationFrame);
		assert.equal(top.series[1].show, true);
		click(outLabel);
		await new Promise(requestAnimationFrame);
		assert.equal(top.series[1].show, true);
		assert.equal(bottom.series[1].show, false);
	});

	it('distinguishes snapping only the nearest non-null point from snapping the cursor too', async () => {
		const [pointOnly] = await render(nearestNonNull, 3);
		const [cursorAndPoint] = await render(nearestNonNull, 4);
		for (const plot of [pointOnly, cursorAndPoint]) {
			plot.setCursor({ left: plot.valToPos(5, 'x'), top: plot.valToPos(5, 'y') });
			assert.equal(plot.legend.idxs[1], 4);
		}
		assert.equal(pointOnly.cursor.idx, 5);
		assert.equal(cursorAndPoint.cursor.idx, 4);
		assert.ok(Math.abs(cursorAndPoint.cursor.left - cursorAndPoint.valToPos(4, 'x')) <= 1);
	});
});
