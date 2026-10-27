import {assertCompatibleWorkloads, benchmarkWorkload, benchmarkOperations} from './benchmarks-phases.mjs';

const SCOPES = ['renderer', 'tree'];
const METRICS = ['rssMB', 'pssMB', 'privateMB', 'swapMB', 'swapPssMB'];
const CHECKPOINTS = ['baseline', 'prepared', 'live'];
const PHASES = new Set([...CHECKPOINTS, 'prepare', 'construct']);
const VALUES = [...CHECKPOINTS, 'peak', 'peakDelta', 'dataDelta', 'chartDelta', 'retainedDelta'];

function statistics(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	const n = sorted.length;
	return {min: sorted[0] ?? null, max: sorted[n - 1] ?? null, count: n, missing: values.length - n};
}

function validMemory(observation) {
	const memory = observation?.processMemory;
	return memory?.complete === true && SCOPES.every(scope => METRICS.every(metric => {
		const value = memory[scope]?.[metric];
		return Number.isFinite(value) && value >= 0;
	}));
}

const difference = (after, before) => after === null || before === null ? null : after - before;
const byScope = fn => Object.fromEntries(SCOPES.map(scope => [scope,
	Object.fromEntries(METRICS.map(metric => [metric, fn(scope, metric)])),
]));

export function memoryProtocol(report) {
	if (report?.workload !== undefined) benchmarkOperations(report);
	const protocol = report?.memoryProtocol;
	if (protocol !== 'through-update-v1')
		throw new Error(`Unknown memoryProtocol: ${JSON.stringify(protocol)}`);
	return protocol;
}

export function assertCompatibleMemoryReports(reports) {
	assertCompatibleWorkloads(reports);
	for (const report of reports)
		memoryProtocol(report);
}

function deriveSample(sample) {
	let observations = sample.observations ?? [];
	const live = observations.flatMap((observation, i) => observation?.phase === 'live' ? [i] : []);
	if (live.length !== 1)
		throw new Error('through-update-v1 requires exactly one live checkpoint.');
	if (observations.some((observation, i) =>
		(['baseline', 'prepared'].includes(observation?.phase) && i >= live[0]) ||
		(i <= live[0] && (observation?.phase === 'cleanup' || ['resize', 'hover-10'].includes(observation?.operation)))))
		throw new Error('Invalid through-update-v1 checkpoint order: live must follow data-update and precede resize and hover.');
	observations = observations.slice(0, live[0] + 1);
	const valid = observations.map(observation => PHASES.has(observation?.phase) && validMemory(observation));
	const checkpointIndices = Object.fromEntries(CHECKPOINTS.map(phase => [phase,
		observations.flatMap((observation, i) => observation?.phase === phase ? [i] : []),
	]));
	const requestedGaps = [];
	for (let i = 1; i < observations.length; i++) {
		const before = observations[i - 1]?.processRequestedAtMs;
		const after = observations[i]?.processRequestedAtMs;
		requestedGaps.push(Number.isFinite(before) && before >= 0 && Number.isFinite(after) && after >= before ? after - before : null);
	}
	const validObservationCount = valid.filter(Boolean).length;
	return {
		observationCount: observations.length,
		validObservationCount,
		invalidObservationCount: observations.length - validObservationCount,
		pollCount: observations.filter(observation => observation?.kind === 'poll').length,
		missingCheckpointCount: CHECKPOINTS.filter(phase => checkpointIndices[phase].length === 0).length,
		ambiguousCheckpointCount: CHECKPOINTS.filter(phase => checkpointIndices[phase].length > 1).length,
		requestedGaps,
		scopes: byScope((scope, metric) => {
			const valueAt = i => observations[i].processMemory[scope][metric];
			const checkpoints = Object.fromEntries(CHECKPOINTS.map(phase => {
				const indices = checkpointIndices[phase];
				return [phase, indices.length === 1 && valid[indices[0]] ? valueAt(indices[0]) : null];
			}));
			let peak = null;
			for (let i = 0; i < observations.length; i++) {
				if (valid[i])
					peak = peak === null ? valueAt(i) : Math.max(peak, valueAt(i));
			}
			const {baseline, prepared, live} = checkpoints;
			return {
				...checkpoints, peak,
				peakDelta: difference(peak, baseline),
				dataDelta: difference(prepared, baseline),
				chartDelta: difference(live, prepared),
				retainedDelta: difference(live, baseline),
			};
		}),
	};
}

function summarizeFixture(report) {
	const observations = [report.blank, report.loaded].filter(observation => observation !== undefined);
	const blankValid = validMemory(report.blank);
	const loadedValid = validMemory(report.loaded);
	const validObservationCount = observations.filter(validMemory).length;
	return {
		observationCount: observations.length,
		validObservationCount,
		invalidObservationCount: observations.length - validObservationCount,
		scopes: byScope((scope, metric) => {
			const blank = blankValid ? report.blank.processMemory[scope][metric] : null;
			const loaded = loadedValid ? report.loaded.processMemory[scope][metric] : null;
			return {blank, loaded, loadedDelta: difference(loaded, blank)};
		}),
	};
}

export function summarizeAdjustedProcessMemory(reports) {
	if (!Array.isArray(reports))
		throw new TypeError('reports must be an array');
	for (const report of reports) {
		if (!Array.isArray(report?.samples))
			throw new TypeError('report.samples must be an array');
	}
	assertCompatibleMemoryReports(reports);
	const workload = reports.length ? benchmarkWorkload(reports[0]) : null;
	const browsers = new Map();
	for (const report of reports) {
		let browser;
		const rounds = new Set();
		for (const sample of report.samples) {
			if (!sample || typeof sample.variant !== 'string' || !sample.variant ||
				!Number.isFinite(sample.dpr) || sample.dpr <= 0 || !Number.isSafeInteger(sample.round) ||
				sample.warmup !== undefined && typeof sample.warmup !== 'boolean')
				throw new TypeError('Each sample requires a variant, positive dpr, integer round, and optional boolean warmup');
			const {variant, dpr} = sample;
			if (!browser) {
				const key = JSON.stringify([dpr, variant]);
				if (browsers.has(key))
					throw new Error(`Duplicate report for variant ${variant} at DPR ${dpr}`);
				browser = {variant, dpr, warmupCount: 0, samples: [], fixture: summarizeFixture(report)};
				browsers.set(key, browser);
			}
			else if (browser.variant !== variant || browser.dpr !== dpr)
				throw new Error('Each nonempty browser report must contain exactly one variant and DPR');
			if (sample.warmup) {
				browser.warmupCount++;
				continue;
			}
			if (rounds.has(sample.round))
				throw new Error(`Duplicate measured round ${sample.round} for variant ${variant} at DPR ${dpr}`);
			rounds.add(sample.round);
			const observations = sample.processObservations;
			if (observations !== undefined && !Array.isArray(observations))
				throw new TypeError('sample.processObservations must be an array when present');
			browser.samples.push(deriveSample({observations}));
		}
	}

	const controls = [...browsers.values()].filter(browser => browser.variant === 'idle').map(browser => {
		const {variant, dpr, samples, warmupCount, fixture} = browser;
		return {
			variant, dpr, sampleCount: samples.length, warmupCount,
			validBlankCount: fixture.scopes.renderer.pssMB.blank === null ? 0 : 1,
			validLiveCount: samples.filter(sample => sample.scopes.renderer.pssMB.live !== null).length,
			scopes: byScope((scope, metric) => {
				const blank = fixture.scopes[scope][metric].blank;
				return {
					blank: statistics([blank]),
					liveAboveBlank: statistics(samples.map(sample => difference(sample.scopes[scope][metric].live, blank))),
				};
			}),
		};
	});
	const controlsByDpr = new Map(controls.map(control => [control.dpr, control]));
	return {
		...(workload ? {workload: {...workload}} : {}),
		groups: [...browsers.values()].filter(browser => browser.variant !== 'idle').map(browser => {
			const {variant, dpr, samples, warmupCount, fixture} = browser;
			return {
				variant, dpr, sampleCount: samples.length, warmupCount,
				scopes: byScope((scope, metric) => {
					const blank = fixture.scopes[scope][metric].blank;
					const idleLiveAboveBlank = controlsByDpr.get(dpr)?.scopes[scope][metric].liveAboveBlank.min ?? null;
					return {
						live: statistics(samples.map(sample => difference(difference(sample.scopes[scope][metric].live, blank), idleLiveAboveBlank))),
						peak: statistics(samples.map(sample => difference(difference(sample.scopes[scope][metric].peak, blank), idleLiveAboveBlank))),
						baselines: {blank, idleLiveAboveBlank},
					};
				}),
			};
		}),
		controls,
		definitions: {
			units: 'All memory values use decimal MB (1,000,000 bytes). No unit conversion occurs.',
			formula: 'Each adjusted sample equals (raw live or peak minus its browser blank) minus min(idle measured live minus idle browser blank). Controls match DPR, scope, and metric. Idle peak, warm baseline, and loaded baseline never enter the subtraction.',
			aggregation: 'Statistics derive from raw observations, not cached summaries. Each measured sample contributes one adjusted value before aggregation. Warmups contribute no values. Statistics contain min, max, count, and missing. The minimum represents the best measured case. Negative values remain negative.',
			validity: 'A missing or duplicate live boundary, or a misplaced checkpoint, causes an error. Valid observations require complete === true and finite nonnegative values for every metric in both scopes. Sample observations also require a recognized lifecycle phase. Invalid memory reads yield null. Missing metric values yield null, not zero. Absent controls or controls without valid liveAboveBlank values make all adjusted values null. No cached control fallback exists.',
			inputs: 'Every report requires memoryProtocol through-update-v1. Each nonempty browser report contains one variant and DPR, including warmups. Duplicate variant/DPR reports and duplicate measured rounds cause errors. Empty reports contribute nothing. Samples use processObservations only. The input remains unchanged.',
			baselines: 'Each group metric exposes scalar blank and idleLiveAboveBlank offsets, or null. Blank comes from that library browser. idleLiveAboveBlank is the minimum measured live-minus-blank value from the matched control.',
			controls: 'Controls contain idle reports only. Each metric exposes blank statistics for one checkpoint and liveAboveBlank statistics for measured samples. validBlankCount is zero or one. validLiveCount counts valid, unambiguous measured live checkpoints, regardless of blank validity. liveAboveBlank.count counts valid paired differences. sampleCount and warmupCount count measured samples and warmups separately.',
			variability: 'Adjusted statistics describe conditional variability with the observed blank and idle minimum held fixed. They do not include idle or blank uncertainty.',
			peak: 'Each metric peak is its maximum across valid observations through the unique live checkpoint after settled data-update. Later observations never contribute. ' + (workload ? 'The dashboard has no resize or hover operation. ' : 'Resize and hover are timing-only. ') + 'These sampled peaks are lower bounds for a GC-intervened pass, not exact peaks for normal runs. Invalid reads can hide peaks. Metrics can peak at different observations. The best-case peak is the minimum of these per-sample maxima, not the minimum observation.',
			ownership: 'Adjusted process memory is not isolated library ownership. Allocator reuse, process churn, and shared mappings affect differences. Forced GC does not guarantee native memory release.',
			scopes: 'Renderer sums renderer processes. Tree includes the browser root and discovered descendants. These scopes overlap and are not additive. Metrics are not added together.',
			jsMemory: 'JavaScript heap and backing-store memory overlap process memory. No scope or JS sums occur in this summary.',
			rssMB: 'RSS sums can double-count shared resident mappings across processes.',
			pssMB: 'PSS apportions shared resident mappings. Non-atomic process reads do not provide a simultaneous snapshot. Other processes can change PSS without local allocation.',
			privateMB: 'Private memory includes Private_Clean, Private_Dirty, and Private_Hugetlb when present. It is not exclusive library ownership.',
			swapMB: 'Swap sums kernel Swap values. Shared swapped mappings can contribute to multiple processes.',
			swapPssMB: 'SwapPss apportions swapped mappings. It is not resident PSS.',
			exclusions: 'These metrics do not measure GPU device memory or total system memory.',
		},
	};
}

export function summarizeProcessMemory(report) {
	if (!Array.isArray(report?.samples))
		throw new TypeError('report.samples must be an array');
	memoryProtocol(report);
	const workload = benchmarkWorkload(report);
	const groups = new Map();
	for (const sample of report.samples) {
		if (!sample || typeof sample.variant !== 'string' || !sample.variant ||
			!Number.isFinite(sample.dpr) || sample.dpr <= 0 || !Number.isSafeInteger(sample.round) ||
			sample.warmup !== undefined && typeof sample.warmup !== 'boolean')
			throw new TypeError('Each sample requires a variant, positive dpr, integer round, and optional boolean warmup');
		const key = JSON.stringify([sample.dpr, sample.variant]);
		if (!groups.has(key))
			groups.set(key, {variant: sample.variant, dpr: sample.dpr, warmupCount: 0, rounds: new Map()});
		const group = groups.get(key);
		if (sample.warmup)
			group.warmupCount++;
		else {
			if (group.rounds.has(sample.round))
				throw new Error(`Duplicate measured round ${sample.round} for variant ${sample.variant} at DPR ${sample.dpr}`);
			if (sample.observations !== undefined && !Array.isArray(sample.observations))
				throw new TypeError('sample.observations must be an array when present');
			group.rounds.set(sample.round, deriveSample(sample));
		}
	}
	return {
		...(workload ? {workload: {...workload}} : {}),
		groups: [...groups.values()].map(({variant, dpr, warmupCount, rounds}) => {
			const samples = [...rounds.values()];
			const counts = Object.fromEntries([
				'observationCount', 'validObservationCount', 'invalidObservationCount', 'pollCount',
				'missingCheckpointCount', 'ambiguousCheckpointCount',
			].map(key => [key, samples.reduce((sum, sample) => sum + sample[key], 0)]));
			return {
				variant, dpr, sampleCount: samples.length, warmupCount, ...counts,
				requestedGapMs: statistics(samples.flatMap(sample => sample.requestedGaps)),
				maxRequestedGapMs: statistics(samples.map(sample => statistics(sample.requestedGaps).max)),
				scopes: byScope((scope, metric) => Object.fromEntries(VALUES.map(value => [value,
					statistics(samples.map(sample => sample.scopes[scope][metric][value])),
				]))),
			};
		}),
		fixture: summarizeFixture(report),
		definitions: {
			units: 'All memory values use decimal MB (1,000,000 bytes), as returned by readProcessMemory. This summary does not convert units.',
			validity: 'A valid observation requires complete === true and finite nonnegative values for all five metrics in both scopes. Any invalid metric invalidates the entire observation. Sample observations also require a recognized lifecycle phase. Timing fields do not determine memory validity.',
			aggregation: 'Groups separate variant and DPR. Statistics exclude warmups and report min, max, count, and missing. The minimum represents the best measured case. Each sample contributes one value per statistic. Deltas use paired checkpoints within each sample, before aggregation. Duplicate measured rounds cause an error within a group.',
			checkpoints: 'Every report requires memoryProtocol through-update-v1. A missing or duplicate live boundary, or a misplaced checkpoint, causes an error. Baseline and prepared each require exactly one observation for a value. A missing, invalid, or duplicate baseline or prepared checkpoint yields null, not zero. An invalid live read yields null. A delta is null if either input is null.',
			baseline: 'Absolute process memory after the baseline GC checkpoint, before preparation. Reused processes can retain warm allocator baselines from earlier samples. A baseline is not a fresh-browser measurement.',
			prepared: 'Absolute process memory after full-data preparation and settling, without forced GC. Multi-operation sessions record this after initialization, before the first full-data update. The snapshot includes the initial chart and can include temporary allocations.',
			live: workload ? 'Absolute process memory after forced GC immediately after settled data-update, with all dashboard charts and their full prepared inputs alive. No resize or hover occurs.' : 'Absolute process memory after forced GC immediately after settled data-update, before resize preparation, with the chart and full prepared input alive.',
			peak: 'Each metric uses its maximum across valid observations through the unique live checkpoint after settled data-update. Later observations never contribute. ' + (workload ? 'The dashboard has no resize or hover operation. ' : 'Resize and hover are timing-only. ') + 'This sampled peak is a lower bound for the GC-intervened pass, not an exact peak for a normal run. Invalid reads can hide peaks. Separate metrics can reach their peaks at different observations. Duplicate baseline or prepared observations remain eligible for the peak. The best-case peak is the minimum of these per-sample maxima, not the minimum observation.',
			peakDelta: 'Per-sample peak minus baseline.',
			dataDelta: 'Per-sample prepared snapshot minus post-GC baseline. In multi-operation sessions this also includes chart initialization. Temporary allocations can contribute. Not retained data ownership.',
			chartDelta: 'Per-sample post-GC live memory minus the prepared snapshot without forced GC. This is not an isolated chart allocation or retention cost.',
			retainedDelta: 'Per-sample live minus baseline.',
			deltas: 'All deltas preserve negative values. Allocator reuse, shared mappings, and process churn prevent attribution of these deltas to exclusive library ownership.',
			scopes: 'Renderer values sum renderer processes. Tree values include the browser root and all discovered descendants. The scopes overlap and are not additive.',
			rssMB: 'RSS sums double-count shared resident mappings across processes. RSS is not unique physical memory.',
			pssMB: 'PSS apportions shared resident mappings among their users. Process reads are non-atomic, so a PSS sum is not a simultaneous tree snapshot. Changes in other processes can change PSS without a local allocation.',
			privateMB: 'Private memory sums Private_Clean, Private_Dirty, and Private_Hugetlb when present. This value is not exclusive library ownership.',
			swapMB: 'Swap sums the kernel Swap values. Shared swapped mappings can contribute to more than one process.',
			swapPssMB: 'SwapPss sums the proportional shares of swapped mappings. It is not resident PSS.',
			gc: 'Forced JavaScript GC does not guarantee native memory release or return of allocator pages to the operating system. Retained process memory is not proof of a leak.',
			exclusions: 'These process metrics do not measure GPU device memory or total GPU allocations. Host mappings in GPU helper processes can contribute to tree values. The report has no GPU-specific metrics and does not claim total system memory.',
			jsMemory: 'JavaScript memory overlaps process memory. Adding JS heap or backing-store numbers to process numbers causes double counting.',
			fixture: 'fixture.scopes contains scalar blank, loaded, and loadedDelta values from optional checkpoints in one fresh browser. loadedDelta is loaded minus blank. It measures blank-to-loaded fixture overhead, including libraries and raw data, not pure library ownership. Missing or invalid inputs yield null. Fixture values never enter variant statistics, peaks, or baseline subtraction.',
			observationCount: 'Only observations through the unique live checkpoint contribute. Group observation counts include measured samples only. invalidObservationCount counts incomplete results, malformed metrics, missing processMemory, and unknown phases. pollCount counts observations with kind poll, including invalid reads. Fixture counts are separate. Omitted blank or loaded observations do not count as invalid.',
			checkpointCounts: 'missingCheckpointCount counts absent baseline and prepared checkpoints. ambiguousCheckpointCount counts baseline and prepared phases with multiple observations. Both counts sum across measured samples. An ambiguous checkpoint can contain valid individual observations.',
			requestedGapMs: 'Only observations through the unique live checkpoint contribute. Statistics cover request-time gaps between all consecutive observations within each measured sample, in input order. They include GC checkpoints, phase transitions, and invalid memory reads, not only periodic polls. They use processRequestedAtMs, not processTimestampMs or JS timestamps. Missing, negative, non-finite, or decreasing request times yield missing gaps. No gap crosses a sample boundary or skips an observation.',
			maxRequestedGapMs: 'Statistics cover the largest valid request-time gap per measured sample. A sample without a valid adjacent pair contributes a missing value. These gaps describe observed request cadence, not an exact configured polling interval.',
		},
	};
}
