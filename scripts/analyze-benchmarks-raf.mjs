const METRICS = ['dataPrepMs', 'prepAndInitMs', 'jsMs', 'raf1Ms', 'postJsRaf1Ms'];
const REFERENCES = ['d3', 'chartjs', 'echarts', 'flot', 'dygraphs'];

function statistics(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	return {
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
				let pairedCount = 0;
				let wins = 0;
				let ties = 0;
				let losses = 0;
				for (const [round, sample] of uplot.rounds) {
					const uplotMs = sample[metric];
					const ref = baseline.rounds.get(round)?.[metric];
					if (Number.isFinite(uplotMs) && Number.isFinite(ref)) {
						pairedCount++;
						if (uplotMs < ref)
							wins++;
						else if (uplotMs === ref)
							ties++;
						else
							losses++;
					}
				}

				const uplotMin = uplot.metrics[metric].min;
				const refMin = baseline.metrics[metric].min;
				const available = uplotMin !== null && refMin !== null;
				return [metric, {
					pairedCount,
					wins,
					ties,
					losses,
					deltaOfMinimaMs: available ? refMin - uplotMin : null,
					ratioOfMinima: available && uplotMin !== 0 ? refMin / uplotMin : null,
					reductionPct: available && refMin !== 0 ? (1 - uplotMin / refMin) * 100 : null,
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
			aggregation: 'Groups separate DPR and variant. Warmups are excluded. Each metric uses its minimum measured value for best-case performance; minima may come from different rounds. Only finite numeric metrics enter min, max, and count; absent, null, and invalid values count as missing. Empty min and max are null. prepAndInitMs uses each round\'s reported sum, not the sum of component minima.',
			pairing: 'Pairs require the exact same round and DPR, with finite values on both sides for each metric. Duplicate measured rounds within a variant and DPR are rejected.',
			wins: 'A win means uPlot is lower than the reference; equal values are ties; higher values are losses.',
			deltaOfMinimaMs: 'Reference group minimum minus uPlot group minimum, not the minimum of paired differences. Minima may come from different rounds. Positive values favor uPlot. Null if either minimum is missing.',
			ratioOfMinima: 'Reference group minimum divided by uPlot group minimum, using all valid measured values, not only pairs. Minima may come from different rounds. Null if either minimum is missing or the uPlot minimum is zero.',
			reductionPct: '100 times (1 minus uPlot group minimum divided by reference group minimum). Null if either minimum is missing or the reference minimum is zero.',
			idle: 'Idle is a separate group, not a comparison reference. No idle baseline is subtracted from any metric.',
		},
	};
}
