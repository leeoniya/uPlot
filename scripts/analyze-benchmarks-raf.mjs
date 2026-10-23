const METRICS = ['dataPrepMs', 'prepAndInitMs', 'jsMs', 'raf1Ms', 'postJsRaf1Ms'];
const REFERENCES = ['d3', 'chartjs', 'echarts', 'flot', 'dygraphs'];

function median(sorted) {
	const n = sorted.length;
	return n === 0 ? null : n % 2 ? sorted[n >> 1] : sorted[n / 2 - 1] / 2 + sorted[n / 2] / 2;
}

function statistics(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	return {
		median: median(sorted),
		min: sorted[0] ?? null,
		max: sorted[sorted.length - 1] ?? null,
		count: sorted.length,
		missing: values.length - sorted.length,
	};
}

export function summarizeBenchmarkRaf(report) {
	if (!Array.isArray(report?.samples))
		throw new TypeError('report.samples must be an array');

	const byDpr = new Map();
	const grouped = [];

	for (const sample of report.samples) {
		const {dpr, variant, round, warmup} = sample;
		if (!byDpr.has(dpr))
			byDpr.set(dpr, new Map());
		const variants = byDpr.get(dpr);
		if (!variants.has(variant)) {
			const group = {dpr, variant, warmupCount: 0, rounds: new Map()};
			variants.set(variant, group);
			grouped.push(group);
		}

		const group = variants.get(variant);
		if (warmup)
			group.warmupCount++;
		else {
			if (group.rounds.has(round))
				throw new Error(`Duplicate measured round ${round} for variant ${variant} at DPR ${dpr}`);
			group.rounds.set(round, sample);
		}
	}

	const groups = grouped.map(group => {
		const samples = [...group.rounds.values()];
		group.metrics = Object.fromEntries(METRICS.map(metric => [metric, statistics(samples.map(sample => sample[metric]))]));
		return {
			dpr: group.dpr,
			variant: group.variant,
			sampleCount: samples.length,
			warmupCount: group.warmupCount,
			metrics: group.metrics,
		};
	});

	const comparisons = [];
	for (const [dpr, variants] of byDpr) {
		const uplot = variants.get('uplot');
		if (!uplot)
			continue;

		for (const reference of REFERENCES) {
			const baseline = variants.get(reference);
			if (!baseline)
				continue;

			const metrics = Object.fromEntries(METRICS.map(metric => {
				const deltas = [];
				let wins = 0;
				let ties = 0;
				let losses = 0;
				for (const [round, sample] of uplot.rounds) {
					const uplotMs = sample[metric];
					const ref = baseline.rounds.get(round)?.[metric];
					if (Number.isFinite(uplotMs) && Number.isFinite(ref)) {
						deltas.push(ref - uplotMs);
						if (uplotMs < ref)
							wins++;
						else if (uplotMs === ref)
							ties++;
						else
							losses++;
					}
				}

				const uplotMedian = uplot.metrics[metric].median;
				const refMedian = baseline.metrics[metric].median;
				const available = uplotMedian !== null && refMedian !== null;
				return [metric, {
					pairedCount: deltas.length,
					wins,
					ties,
					losses,
					medianDeltaMs: median(deltas.sort((a, b) => a - b)),
					ratioOfMedians: available && uplotMedian !== 0 ? refMedian / uplotMedian : null,
					reductionPct: available && refMedian !== 0 ? (1 - uplotMedian / refMedian) * 100 : null,
				}];
			}));
			comparisons.push({dpr, variant: 'uplot', reference, metrics});
		}
	}

	return {
		groups,
		comparisons,
		definitions: {
			units: 'All durations and deltas are milliseconds; reductionPct is a percentage.',
			clock: 'Chart work starts inside an aligned requestAnimationFrame (rAF) callback. Times use performance.now() at callback entry, not the shared rAF timestamp.',
			dataPrepMs: 'Reported duration of actual demo prepData conversion from already-parsed packed JSON. Excludes network transfer, JSON parsing, and synthetic-data cloning. Data preparation occurs before chart start, outside the start/js-end/end markers.',
			prepAndInitMs: 'Reported sum dataPrepMs + jsMs: data preparation plus JS/DOM initialization, not end-to-end wall latency. Excludes the gap between preparation and chart start, rAF waits, and settling.',
			jsMs: 'Elapsed time from chart start through synchronous JS/DOM work, the initial microtask commit, and the status update.',
			raf1Ms: 'Elapsed time from chart start to entry of the next subsequent rAF callback.',
			postJsRaf1Ms: 'Elapsed time from JavaScript end to entry of the next subsequent rAF callback.',
			interpretation: 'rAF latency is a scheduling/frame-progress proxy, not a GPU fence or proof of completed rendering or presentation. Subtracting JavaScript time does not measure GPU cost.',
			aggregation: 'Groups separate DPR and variant. Warmups are excluded. Only finite numeric metrics enter statistics; absent, null, and invalid values count as missing. Empty statistics are null.',
			pairing: 'Pairs require the exact same round and DPR, with finite values on both sides for each metric. Duplicate measured rounds within a variant and DPR are rejected.',
			wins: 'A win means uPlot is lower than the reference; equal values are ties; higher values are losses.',
			medianDeltaMs: 'Median of paired reference minus uPlot durations. Positive values favor uPlot. No valid pairs yields null.',
			ratioOfMedians: 'Reference group median divided by uPlot group median, using all valid measured values, not only pairs. Null if either median is missing or the uPlot median is zero.',
			reductionPct: '100 times (1 minus uPlot group median divided by reference group median). Null if either median is missing or the reference median is zero.',
			idle: 'Idle is a separate group, not a comparison reference. No idle baseline is subtracted from any metric.',
		},
	};
}
