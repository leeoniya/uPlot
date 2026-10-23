import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { captureStep, getDemoSteps } from '../../scripts/demoSteps.mjs';
import { withSeededRandom } from '../../scripts/withSeededRandom.mjs';
import months from '../../demos/months.js';
import monthsRu from '../../demos/months-ru.js';
import gridOverSeries from '../../demos/grid-over-series.js';
import barsGroupedStacked from '../../demos/bars-grouped-stacked.js';
import candlestick from '../../demos/candlestick-ohlc.js';
import annotations from '../../demos/annotations.js';
import softMinmax from '../../demos/soft-minmax.js';
import nearestNonNull from '../../demos/nearest-non-null.js';
import logScales from '../../demos/log-scales2.js';
import stackedSeries from '../../demos/stacked-series.js';

const demos = [
	['months', months, 2],
	['months-ru', monthsRu, 1],
	['grid-over-series', gridOverSeries, 1],
	['bars-grouped-stacked', barsGroupedStacked, 10],
	['candlestick-ohlc', candlestick, 1],
	['annotations', annotations, 1],
	['soft-minmax', softMinmax, 8],
	['nearest-non-null', nearestNonNull, 5],
	['log-scales2', logScales, 12],
	['stacked-series', stackedSeries, 16],
];

describe('demo migrations', () => {
	let previousUPlot;
	let bodyChildren;

	beforeEach(() => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		bodyChildren = new Set(document.body.children);
	});

	afterEach(() => {
		// captureStep destroys plots; some demos also add prose outside plot roots.
		for (const child of [...document.body.children]) {
			if (!bodyChildren.has(child))
				child.remove();
		}
		globalThis.uPlot = previousUPlot;
	});

	for (const [name, groups, plotCount] of demos) {
		it(`${name} renders repeatably with fresh state`, async () => {
			let count = 0;
			for (const { id, step } of getDemoSteps(groups)) {
				async function capture() {
					const snapshots = [];
					await withSeededRandom(() => captureStep(step, id, (actual, snapshotId) => {
						snapshots.push({ id: snapshotId, actual: JSON.parse(JSON.stringify(actual)) });
					}));
					return snapshots;
				}
				const first = await capture();
				assert.deepStrictEqual(await capture(), first, id);
				count += first.length;
			}
			assert.equal(count, plotCount);
		});
	}
});
