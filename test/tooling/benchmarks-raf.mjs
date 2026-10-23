import assert from 'node:assert/strict';
import { summarizeBenchmarkRaf } from '../../scripts/analyze-benchmarks-raf.mjs';

const METRICS = ['dataPrepMs', 'prepAndInitMs', 'jsMs', 'raf1Ms', 'postJsRaf1Ms'];
const REFERENCES = ['d3', 'chartjs', 'echarts', 'flot', 'dygraphs'];
const REMOVED_METRICS = ['raf2Ms', 'postJsRaf2Ms', 'rafGapMs'];

function sample(round = 0, extra = {}) {
	return {id: `sample-${round}`, dpr: 1, variant: 'uplot', round, warmup: false, ...extra};
}

function summarize(samples) {
	return summarizeBenchmarkRaf({samples});
}

function close(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

describe('uPlot rAF analysis', () => {
	it('handles empty reports and rejects a missing samples array', () => {
		const result = summarize([]);
		assert.deepEqual(result.groups, []);
		assert.deepEqual(result.comparisons, []);
		for (const report of [undefined, null, {}, {samples: {}}])
			assert.throws(() => summarizeBenchmarkRaf(report), /samples must be an array/);
	});

	it('excludes warmups, retains warmup-only groups, and reports minima despite outliers', () => {
		const result = summarize([
			sample(0, {warmup: true, jsMs: 0}),
			sample(0, {jsMs: 9000}),
			sample(1, {jsMs: 1}),
			sample(2, {jsMs: 3}),
			sample(0, {variant: 'd3', jsMs: 8}),
			sample(1, {variant: 'd3', jsMs: 2}),
			sample(0, {dpr: 2, warmup: true, jsMs: 50}),
		]);
		const [uplot, d3, warmupOnly] = result.groups;
		assert.equal(uplot.sampleCount, 3);
		assert.equal(uplot.warmupCount, 1);
		assert.deepEqual(uplot.metrics.jsMs, {min: 1, max: 9000, count: 3, missing: 0});
		assert.deepEqual(d3.metrics.jsMs, {min: 2, max: 8, count: 2, missing: 0});
		assert.equal(warmupOnly.sampleCount, 0);
		assert.equal(warmupOnly.warmupCount, 1);
		assert.deepEqual(warmupOnly.metrics.jsMs, {min: null, max: null, count: 0, missing: 0});
		assert.equal(result.comparisons[0].metrics.jsMs.pairedCount, 2);
	});

	for (const metric of METRICS) {
		it(`excludes warmups from ${metric} statistics and retains warmup-only groups`, () => {
			const result = summarize([
				sample(0, {warmup: true, [metric]: 0}),
				sample(0, {[metric]: 2}),
				sample(1, {[metric]: 4}),
				sample(0, {dpr: 2, warmup: true, [metric]: 1000}),
			]);
			assert.deepEqual(result.groups[0].metrics[metric], {min: 2, max: 4, count: 2, missing: 0});
			assert.deepEqual(result.groups[1].metrics[metric], {min: null, max: null, count: 0, missing: 0});
		});

		it(`counts only finite numbers for ${metric}, without coercing missing values to zero`, () => {
			const values = [null, undefined, NaN, Infinity, -Infinity, '12', false, {}, 0, 8];
			const result = summarize(values.map((value, round) => sample(round, {[metric]: value})));
			assert.deepEqual(result.groups[0].metrics[metric], {min: 0, max: 8, count: 2, missing: 8});
			const absent = summarize([sample()]).groups[0].metrics;
			assert.deepEqual(Object.keys(absent), METRICS);
			assert.deepEqual(absent[metric], {min: null, max: null, count: 0, missing: 1});
		});

		it(`requires finite ${metric} values on both sides of a pair at the same DPR`, () => {
			const result = summarize([
				sample(0, {[metric]: 2}),
				sample(0, {variant: 'd3', [metric]: 6}),
				sample(1, {[metric]: null}),
				sample(1, {variant: 'd3', [metric]: 8}),
				sample(2, {[metric]: 4}),
				sample(2, {variant: 'd3', [metric]: Infinity}),
				sample(3, {[metric]: 10}),
				sample(3, {dpr: 2, variant: 'd3', [metric]: 20}),
			]);
			assert.deepEqual(result.comparisons[0].metrics[metric], {
				pairedCount: 1, wins: 1, ties: 0, losses: 0, deltaOfMinimaMs: 4,
				ratioOfMinima: 3, reductionPct: (1 - 2 / 6) * 100,
			});
		});

		it(`reports null comparisons when ${metric} is missing on either side`, () => {
			for (const variant of ['uplot', 'd3']) {
				const result = summarize([
					sample(0, {variant, [metric]: 2}),
					sample(0, {variant: variant === 'uplot' ? 'd3' : 'uplot'}),
				]);
				assert.deepEqual(result.comparisons[0].metrics[metric], {
					pairedCount: 0, wins: 0, ties: 0, losses: 0, deltaOfMinimaMs: null,
					ratioOfMinima: null, reductionPct: null,
				});
			}
		});

		it(`pairs exact rounds for ${metric} and uses all group values for ratios and reductions`, () => {
			const result = summarize([
				sample(0, {warmup: true, [metric]: 0}),
				sample(4, {warmup: true, [metric]: 1000}),
				sample(3, {variant: 'd3', warmup: true, [metric]: 1}),
				sample(3, {[metric]: 100}),
				sample(1, {variant: 'd3', [metric]: 2}),
				sample(0, {[metric]: 2}),
				sample(4, {variant: 'd3', [metric]: 200}),
				sample(2, {[metric]: 7}),
				sample(0, {variant: 'd3', [metric]: 6}),
				sample(1, {[metric]: 4}),
				sample(2, {variant: 'd3', [metric]: 7}),
				sample(2, {variant: 'echarts', [metric]: 3}),
				sample(0, {variant: 'chartjs', [metric]: 10}),
			]);
			const [d3, chartjs, echarts] = result.comparisons;
			assert.deepEqual(result.comparisons.map(c => c.reference), ['d3', 'chartjs', 'echarts']);
			for (const comparison of result.comparisons) {
				assert.equal(comparison.dpr, 1);
				assert.equal(comparison.variant, 'uplot');
			}
			assert.deepEqual(d3.metrics[metric], {
				pairedCount: 3, wins: 1, ties: 1, losses: 1, deltaOfMinimaMs: 0,
				ratioOfMinima: 1, reductionPct: 0,
			});
			assert.deepEqual(chartjs.metrics[metric], {
				pairedCount: 1, wins: 1, ties: 0, losses: 0, deltaOfMinimaMs: 8,
				ratioOfMinima: 5, reductionPct: 80,
			});
			assert.deepEqual(echarts.metrics[metric], {
				pairedCount: 1, wins: 0, ties: 0, losses: 1, deltaOfMinimaMs: 1,
				ratioOfMinima: 1.5, reductionPct: (1 - 2 / 3) * 100,
			});
		});
	}

	it('counts valid pairs per metric but compares independent minima, not paired differences', () => {
		const result = summarize([
			sample(0, {jsMs: 1, raf1Ms: 10, postJsRaf1Ms: NaN}),
			sample(1, {jsMs: 10, raf1Ms: null, postJsRaf1Ms: 20}),
			sample(2, {jsMs: 11, raf1Ms: 30, postJsRaf1Ms: 40}),
			sample(0, {variant: 'd3', jsMs: 10, raf1Ms: 12, postJsRaf1Ms: 30}),
			sample(1, {variant: 'd3', jsMs: 11, raf1Ms: 22, postJsRaf1Ms: Infinity}),
			sample(2, {variant: 'd3', jsMs: 1, raf1Ms: 36, postJsRaf1Ms: 50}),
		]);
		const metrics = result.comparisons[0].metrics;
		assert.deepEqual(metrics.jsMs, {
			pairedCount: 3, wins: 2, ties: 0, losses: 1, deltaOfMinimaMs: 0,
			ratioOfMinima: 1, reductionPct: 0,
		}); // Paired deltas are 9, 1, -10; both group minima are 1, from different rounds.
		assert.equal(metrics.raf1Ms.pairedCount, 2);
		assert.equal(metrics.raf1Ms.deltaOfMinimaMs, 2);
		assert.equal(metrics.postJsRaf1Ms.pairedCount, 1);
		assert.equal(metrics.postJsRaf1Ms.deltaOfMinimaMs, 10);
		assert.equal(metrics.postJsRaf1Ms.ratioOfMinima, 1.5);
	});

	it('reports missing prep metrics as null, including comparisons', () => {
		const result = summarize([
			sample(0, {jsMs: 2, raf1Ms: 16, postJsRaf1Ms: 14}),
			sample(0, {variant: 'd3', jsMs: 4, raf1Ms: 20, postJsRaf1Ms: 16}),
		]);
		for (const metric of ['dataPrepMs', 'prepAndInitMs']) {
			for (const group of result.groups)
				assert.deepEqual(group.metrics[metric], {min: null, max: null, count: 0, missing: 1});
			assert.deepEqual(result.comparisons[0].metrics[metric], {
				pairedCount: 0, wins: 0, ties: 0, losses: 0, deltaOfMinimaMs: null,
				ratioOfMinima: null, reductionPct: null,
			});
		}
	});

	it('reports null statistics when a metric is missing on both sides', () => {
		const result = summarize([sample(), sample(0, {variant: 'd3'})]);
		assert.deepEqual(result.comparisons[0].metrics.postJsRaf1Ms, {
			pairedCount: 0, wins: 0, ties: 0, losses: 0, deltaOfMinimaMs: null,
			ratioOfMinima: null, reductionPct: null,
		});
	});

	it('handles zero divisors without discarding valid zero measurements or ties', () => {
		const result = summarize([
			sample(0, {jsMs: 0, raf1Ms: 5, postJsRaf1Ms: 0}),
			sample(0, {variant: 'd3', jsMs: 10, raf1Ms: 0, postJsRaf1Ms: 0}),
		]);
		const metrics = result.comparisons[0].metrics;
		assert.equal(metrics.jsMs.ratioOfMinima, null);
		assert.equal(metrics.jsMs.deltaOfMinimaMs, 10);
		assert.equal(metrics.jsMs.reductionPct, 100);
		assert.equal(metrics.jsMs.wins, 1);
		assert.equal(metrics.raf1Ms.ratioOfMinima, 0);
		assert.equal(metrics.raf1Ms.reductionPct, null);
		assert.equal(metrics.raf1Ms.losses, 1);
		assert.equal(metrics.raf1Ms.deltaOfMinimaMs, -5);
		assert.deepEqual(metrics.postJsRaf1Ms, {
			pairedCount: 1, wins: 0, ties: 1, losses: 0, deltaOfMinimaMs: 0,
			ratioOfMinima: null, reductionPct: null,
		});
	});

	it('never pairs different rounds or coerces round identifiers', () => {
		const result = summarize([
			sample(0, {jsMs: 2}),
			sample('0', {variant: 'd3', jsMs: 4}),
			sample(1, {variant: 'chartjs', jsMs: 8}),
		]);
		for (const comparison of result.comparisons) {
			assert.equal(comparison.metrics.jsMs.pairedCount, 0);
			assert.equal(comparison.metrics.jsMs.deltaOfMinimaMs, comparison.reference === 'd3' ? 2 : 6);
		}
		assert.equal(result.comparisons[0].metrics.jsMs.ratioOfMinima, 2);
		assert.equal(result.comparisons[1].metrics.jsMs.ratioOfMinima, 4);
	});

	it('isolates DPRs and leaves idle values separate and unsubtracted', () => {
		const result = summarize([
			sample(0, {jsMs: 4}),
			sample(0, {variant: 'idle', jsMs: 100}),
			sample(0, {variant: 'd3', jsMs: 8}),
			sample(0, {dpr: 2, jsMs: 20}),
			sample(0, {dpr: 2, variant: 'd3', jsMs: 10}),
			sample(0, {dpr: 3, variant: 'chartjs', jsMs: 1}),
		]);
		assert.equal(result.groups.length, 6);
		assert.equal(result.groups[0].metrics.jsMs.min, 4);
		assert.equal(result.groups[1].metrics.jsMs.min, 100);
		assert.equal(result.comparisons.length, 2);
		assert.deepEqual(result.comparisons.map(c => c.dpr), [1, 2]);
		assert.equal(result.comparisons[0].metrics.jsMs.deltaOfMinimaMs, 4);
		assert.equal(result.comparisons[1].metrics.jsMs.deltaOfMinimaMs, -10);
		close(result.comparisons[0].metrics.jsMs.reductionPct, 50);
		close(result.comparisons[1].metrics.jsMs.reductionPct, -100);
	});

	it('does not substitute warmup values for missing measured values', () => {
		const result = summarize([
			sample(0, {warmup: true, jsMs: 1}),
			sample(0, {variant: 'd3', jsMs: 2}),
		]);
		assert.deepEqual(result.comparisons[0].metrics.jsMs, {
			pairedCount: 0, wins: 0, ties: 0, losses: 0, deltaOfMinimaMs: null,
			ratioOfMinima: null, reductionPct: null,
		});
	});

	it('rejects duplicate measured rounds for any variant even with missing metrics or different IDs', () => {
		for (const variant of ['uplot', ...REFERENCES, 'idle']) {
			assert.throws(() => summarize([
				sample(2, {variant}),
				sample(2, {variant, id: 'other'}),
			]), /Duplicate measured round 2.*DPR 1/);
		}
		assert.doesNotThrow(() => summarize([
			sample(0, {warmup: true}), sample(0, {warmup: true}), sample(0),
			sample(0, {dpr: 2}), sample(0, {variant: 'd3'}),
		]));
	});

	it('uses supplied metrics without deriving missing post-JS values and does not mutate the report', () => {
		const samples = Object.freeze([
			Object.freeze(sample(0, {dataPrepMs: 3, jsMs: 2, raf1Ms: 16})),
			Object.freeze(sample(1, {dataPrepMs: 4, prepAndInitMs: 6, jsMs: 2, raf1Ms: 16, postJsRaf1Ms: 11})),
		]);
		const result = summarizeBenchmarkRaf(Object.freeze({samples}));
		const metrics = result.groups[0].metrics;
		assert.deepEqual(metrics.postJsRaf1Ms, {min: 11, max: 11, count: 1, missing: 1});
		assert.deepEqual(metrics.dataPrepMs, {min: 3, max: 4, count: 2, missing: 0});
		assert.deepEqual(metrics.prepAndInitMs, {min: 6, max: 6, count: 1, missing: 1});
	});

	it('takes the minimum of own-round prep-plus-init sums, not the sum of minima', () => {
		const result = summarize([
			sample(0, {dataPrepMs: 1, jsMs: 8, prepAndInitMs: 9}),
			sample(1, {dataPrepMs: 8, jsMs: 1, prepAndInitMs: 9}),
			sample(2, {dataPrepMs: 4, jsMs: 4, prepAndInitMs: 8}),
			sample(3, {warmup: true, dataPrepMs: 0, jsMs: 0, prepAndInitMs: 0}),
		]);
		const metrics = result.groups[0].metrics;
		assert.equal(metrics.dataPrepMs.min, 1);
		assert.equal(metrics.jsMs.min, 1);
		assert.deepEqual(metrics.prepAndInitMs, {min: 8, max: 9, count: 3, missing: 0});
	});

	it('supports arbitrary DPRs and pairs each reference independently at each DPR', () => {
		const dprs = [1.25, 0.75, 3.5];
		const result = summarize(dprs.flatMap(dpr => [
			sample(0, {dpr, jsMs: dpr}),
			...REFERENCES.map((variant, i) => sample(0, {dpr, variant, jsMs: dpr + i + 1})),
		]));
		assert.equal(result.groups.length, dprs.length * (REFERENCES.length + 1));
		assert.deepEqual(result.comparisons.map(c => [c.dpr, c.reference]),
			dprs.flatMap(dpr => REFERENCES.map(reference => [dpr, reference])));
		for (const comparison of result.comparisons) {
			assert.equal(comparison.variant, 'uplot');
			assert.equal(comparison.metrics.jsMs.pairedCount, 1);
			assert.equal(comparison.metrics.jsMs.deltaOfMinimaMs, REFERENCES.indexOf(comparison.reference) + 1);
		}
	});

	it('omits removed metrics from groups, comparisons, and definitions even when supplied', () => {
		const removed = Object.fromEntries(REMOVED_METRICS.map(metric => [metric, 42]));
		const result = summarize(['uplot', ...REFERENCES].map(variant => sample(0, {variant, ...removed})));
		assert.equal(result.comparisons.length, REFERENCES.length);
		for (const {metrics} of [...result.groups, ...result.comparisons]) {
			assert.deepEqual(Object.keys(metrics), METRICS);
			for (const metric of REMOVED_METRICS)
				assert.equal(Object.hasOwn(metrics, metric), false);
		}
		for (const metric of REMOVED_METRICS)
			assert.equal(Object.hasOwn(result.definitions, metric), false);
	});

	it('defines the callback-entry clock and limitations of rAF timing', () => {
		const {definitions} = summarize([]);
		for (const metric of METRICS)
			assert.equal(typeof definitions[metric], 'string');
		assert.match(definitions.dataPrepMs, /actual demo prepData conversion from already-parsed packed JSON/);
		assert.match(definitions.dataPrepMs, /Excludes network transfer, JSON parsing, and synthetic-data cloning/);
		assert.match(definitions.dataPrepMs, /outside the start\/js-end\/end markers/);
		assert.match(definitions.prepAndInitMs, /dataPrepMs \+ jsMs/);
		assert.match(definitions.prepAndInitMs, /not end-to-end wall latency/);
		assert.match(definitions.prepAndInitMs, /Excludes the gap.*rAF waits, and settling/);
		assert.match(definitions.clock, /performance\.now\(\).*callback entry.*not the shared rAF timestamp/);
		assert.match(definitions.clock, /starts inside an aligned/);
		assert.match(definitions.interpretation, /proxy, not a GPU fence/);
		assert.match(definitions.interpretation, /Subtracting JavaScript time does not measure GPU cost/);
		assert.match(definitions.idle, /No idle baseline is subtracted/);
		assert.match(definitions.aggregation, /Warmups are excluded/);
		assert.match(definitions.aggregation, /minima may come from different rounds/);
		assert.match(definitions.deltaOfMinimaMs, /not the minimum of paired differences/);
		assert.match(definitions.ratioOfMinima, /using all valid measured values, not only pairs/);
		assert.doesNotMatch(JSON.stringify(definitions), /median/i);
		for (const key of ['wins', 'deltaOfMinimaMs', 'ratioOfMinima', 'reductionPct']) {
			assert.match(definitions[key], /uPlot/);
			assert.doesNotMatch(definitions[key], /decimat|controlled comparison/i);
		}
	});
});
