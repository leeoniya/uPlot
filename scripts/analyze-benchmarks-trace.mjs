import { readTraceFile } from './bench-trace-stream.mjs';
import { benchmarkTimingSamples, benchmarkOperations } from './benchmarks-phases.mjs';
import { BACKGROUND_GC_EVENTS, TRACE_ACCOUNTING, traceAccountingProtocol } from './bench-trace-policy.mjs';

const TASK = 'RunTask';
const FALLBACK_TASK = 'ThreadControllerImpl::RunTask';
const STYLE = new Set(['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize']);
const EVENT_NAMES = [TASK, FALLBACK_TASK, ...STYLE, 'RasterTask', 'GPUTask', ...BACKGROUND_GC_EVENTS];
const TRACKED = new Set(EVENT_NAMES);
const WORK_METRICS = ['rendererMainTaskMs', 'styleLayoutPaintMs', 'rasterWorkerMs', 'rendererCompositorMs', 'gpuMainTaskMs', 'vizCompositorMs', 'GPUTaskMs', 'backgroundGcMs'];
const METRICS = ['dataPrepMs', 'prepAndInitMs', 'jsMs', 'windowMs', 'jsIntervalMs', 'traceWindowMs', ...WORK_METRICS, 'gcAddedThreadWorkMs', 'totalTrackedThreadWorkMs', 'trackedBusyElapsedMs', 'hardwareGpuMs'];

export const TRACE_AGGREGATION = 'Group by DPR, variant and operation; exclude warmups. Lifecycle groups contains final updates only; phaseGroups contains all operations. Headline trace timings use arithmetic means across measured runs, including zero values. Minima and maxima remain available for diagnostics. Mean, min, max, and count use only finite numbers; absent, null, and invalid values count as missing. Empty mean, min, and max are null. Totals use each round\'s deduplicated work before averaging; GC breakdowns are not added again. Idle remains a separate variant; no baseline subtraction.';

const threadKey = ({pid, tid}) => JSON.stringify([pid, tid]);
const validTime = value => typeof value === 'number' && Number.isFinite(value);

function unionMs(intervals, start, end) {
	const clipped = intervals.map(event => [Math.max(start, event.start), Math.min(end, event.end)])
		.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
	let total = 0;
	let right = -Infinity;
	for (const [a, b] of clipped) {
		total += Math.max(0, b - Math.max(a, right));
		right = Math.max(right, b);
	}
	return total / 1000;
}

function threadSumMs(intervals, start, end) {
	const threads = new Map();
	for (const event of intervals) {
		if (!threads.has(event.key))
			threads.set(event.key, []);
		threads.get(event.key).push(event);
	}
	return [...threads.values()].reduce((sum, events) => sum + unionMs(events, start, end), 0);
}

function statistics(values) {
	const sorted = values.filter(validTime).sort((a, b) => a - b);
	const n = sorted.length;
	return {
		min: n === 0 ? null : sorted[0],
		max: n === 0 ? null : sorted[n - 1],
		mean: n === 0 ? null : sorted.reduce((sum, value) => sum + value, 0) / n,
		count: n,
		missing: values.length - n,
	};
}

/** Aggregate recorded phase metrics without reading a trace or changing work accounting. */
export function summarizeBenchmarkTraceSamples(samples) {
	const grouped = new Map();
	for (const sample of samples) {
		const key = JSON.stringify([sample.dpr, sample.variant, sample.operation]);
		if (!grouped.has(key))
			grouped.set(key, {dpr: sample.dpr, variant: sample.variant, ...(sample.operation ? {operation: sample.operation} : {}), warmupCount: 0, samples: []});
		const group = grouped.get(key);
		if (sample.warmup)
			group.warmupCount++;
		else
			group.samples.push(sample);
	}
	return [...grouped.values()].map(group => ({
		dpr: group.dpr,
		variant: group.variant,
		...(group.operation ? {operation: group.operation} : {}),
		sampleCount: group.samples.length,
		warmupCount: group.warmupCount,
		sampleIds: group.samples.map(sample => sample.id),
		metrics: Object.fromEntries(METRICS.map(metric => [metric, statistics(group.samples.map(sample => sample[metric]))])),
	}));
}

function backendInfo(systemInfo) {
	const gpu = systemInfo?.gpu;
	const aux = gpu?.auxAttributes;
	// Feature status can differ by operation. A physical device alone does not prove acceleration.
	const renderer = aux?.glRenderer ?? null;
	const implementation = aux?.glImplementationParts ?? aux?.displayType ?? null;
	const software = /swiftshader|swangle|llvmpipe|softpipe|software/i.test([renderer, implementation].join(' '));
	return {
		kind: software ? 'software' : gpu ? 'unverified' : 'unknown',
		renderer,
		implementation,
		devices: gpu?.devices ?? null,
		featureStatus: gpu?.featureStatus ?? null,
		warning: software
			? 'Software graphics backend detected. GPU-process thread work is not hardware GPU execution.'
			: 'Hardware acceleration is not established by thread names or device presence. Check featureStatus for each rendering operation.',
	};
}

/** Analyze Chrome trace wall-duration intervals without estimating CPU or hardware GPU time. */
export function analyzeBenchmarkTrace(traceObject, report) {
	const events = Array.isArray(traceObject) ? traceObject : traceObject?.traceEvents;
	if (!Array.isArray(events) || !Array.isArray(report?.samples))
		throw new Error('Expected traceEvents and report.samples arrays');

	const analyzer = createTraceAnalyzer(report);
	for (const event of events)
		analyzer.push(event);
	return analyzer.finish(traceObject?.metadata);
}

/** Read plain JSON or .gz; memory scales with tracked intervals and synchronous pairs, not trace size. */
export async function analyzeBenchmarkTraceFile(path, report) {
	const analyzer = createTraceAnalyzer(report);
	const {metadata} = await readTraceFile(path, analyzer.push);
	return analyzer.finish(metadata);
}

function createTraceAnalyzer(report) {
	if (!Array.isArray(report?.samples))
		throw new Error('Expected traceEvents and report.samples arrays');
	const accountingProtocol = traceAccountingProtocol(report);
	const includeGc = accountingProtocol === TRACE_ACCOUNTING;
	let captureCount = 0;
	let captureName;
	const processes = new Map();
	const threads = new Map();
	const markers = new Map();
	const eventTypes = Object.fromEntries(EVENT_NAMES.map(name => [name, {observedCount: 0, intervalCount: 0, available: false, categories: {}, phases: {}}]));
	const parsing = {invalidIntervals: 0, unmatchedBegins: 0, unmatchedEnds: 0, mismatchedEnds: 0, ignoredAsyncEvents: 0};
	let traceEnd = -Infinity;

	function getThread(event) {
		const key = threadKey(event);
		if (!threads.has(key))
			threads.set(key, {key, pid: event.pid, tid: event.tid, name: null, intervals: [], pairs: []});
		return threads.get(key);
	}

	function addInterval(event, end) {
		if (!TRACKED.has(event.name))
			return;
		if (!validTime(event.ts) || !validTime(end) || end < event.ts || event.pid == null || event.tid == null) {
			parsing.invalidIntervals++;
			return;
		}
		const thread = getThread(event);
		thread.intervals.push({name: event.name, key: thread.key, start: event.ts, end});
		eventTypes[event.name].intervalCount++;
	}

	function push(event) {
		if (report.captureId != null && event.ph === 'I' && event.cat?.split(',').includes('blink.user_timing') && event.name?.startsWith('benchmark:capture:')) {
			captureCount++;
			captureName = event.name;
		}
		if (validTime(event.ts))
			traceEnd = Math.max(traceEnd, event.ts, event.ph === 'X' && validTime(event.dur) ? event.ts + event.dur : event.ts);
		if (event.ph === 'M') {
			if (event.name === 'process_name')
				processes.set(event.pid, event.args?.name);
			if (event.name === 'thread_name')
				getThread(event).name = event.args?.name ?? null;
		}
		if (typeof event.name === 'string' && event.name.startsWith('benchmark:sample-')) {
			const match = /^benchmark:(sample-\d+):(start|js-end|end)$/.exec(event.name);
			if (!match || event.ph !== 'I' || !event.cat?.split(',').includes('blink.user_timing') || !validTime(event.ts) || event.pid == null || event.tid == null)
				throw new Error(`Invalid sample marker: ${event.name}`);
			const [, id, phase] = match;
			if (!markers.has(id))
				markers.set(id, {});
			if (markers.get(id)[phase])
				throw new Error(`Duplicate marker: ${event.name}`);
			markers.get(id)[phase] = {pid: event.pid, tid: event.tid, ts: event.ts};
			getThread(event);
		}
		if (TRACKED.has(event.name)) {
			const type = eventTypes[event.name];
			type.observedCount++;
			// Keep the emitted category combination: one enabled member is sufficient.
			for (const [counts, key] of [[type.categories, event.cat ?? '(missing)'], [type.phases, event.ph]])
				Object.defineProperty(counts, key, {value: (Object.hasOwn(counts, key) ? counts[key] : 0) + 1, enumerable: true, configurable: true});
			if (!['X', 'B', 'E'].includes(event.ph))
				parsing.ignoredAsyncEvents++;
		}
		if (event.ph === 'X')
			addInterval(event, validTime(event.dur) ? event.ts + event.dur : NaN);
		else if (event.ph === 'B' || event.ph === 'E') {
			// Keep all synchronous pairs, but not their potentially large args payloads.
			getThread(event).pairs.push({ph: event.ph, name: event.name, pid: event.pid, tid: event.tid, ts: event.ts});
		}
	}

	return {push, finish};

	function finish(metadata) {
		if (report.captureId != null && (captureCount !== 1 || captureName !== 'benchmark:capture:' + report.captureId))
			throw new Error('Trace/report capture ID mismatch');

		// Include unselected B/E events in the stack: their unnamed ends must not close a selected task.
		for (const thread of threads.values()) {
			const stack = [];
			thread.pairs.sort((a, b) => a.ts - b.ts);
			for (const event of thread.pairs) {
				if (event.ph === 'B')
					stack.push(event);
				else {
					const begin = stack.pop();
					if (!begin)
						parsing.unmatchedEnds++;
					else if (event.name && event.name !== begin.name)
						parsing.mismatchedEnds++;
					else
						addInterval(begin, event.ts);
				}
			}
			parsing.unmatchedBegins += stack.length;
			delete thread.pairs;
			thread.taskEventName = thread.intervals.some(event => event.name === TASK) ? TASK
				: thread.intervals.some(event => event.name === FALLBACK_TASK) ? FALLBACK_TASK : null;
		}
		for (const availability of Object.values(eventTypes))
			availability.available = availability.intervalCount > 0;

		const ids = new Set();
		const windows = benchmarkTimingSamples(report).map(sample => {
			if (!/^sample-\d+$/.test(sample.id) || ids.has(sample.id))
				throw new Error(`Invalid or duplicate report sample id: ${sample.id}`);
			ids.add(sample.id);
			if (typeof sample.warmup !== 'boolean')
				throw new Error(`Expected boolean warmup for ${sample.id}`);
			const marks = markers.get(sample.id);
			for (const phase of ['start', 'js-end', 'end']) {
				if (!marks?.[phase])
					throw new Error(`Missing marker: benchmark:${sample.id}:${phase}`);
			}
			const start = marks.start;
			if (['js-end', 'end'].some(phase => threadKey(marks[phase]) !== threadKey(start)))
				throw new Error(`Markers must use the same thread: ${sample.id}`);
			if (!(start.ts <= marks['js-end'].ts && marks['js-end'].ts <= marks.end.ts && start.ts < marks.end.ts))
				throw new Error(`Invalid marker order: ${sample.id}`);
			// Legacy captures lack an ID. Check spans too, allowing timer quantization.
			for (const [metric, end] of [['jsMs', marks['js-end']], ['windowMs', marks.end]]) {
				if (!validTime(sample[metric]) || Math.abs(sample[metric] - (end.ts - start.ts) / 1000) > 1)
					throw new Error(`Trace/report duration mismatch: ${sample.id} ${metric}`);
			}
			const thread = threads.get(threadKey(start));
			if ((processes.has(start.pid) && processes.get(start.pid) !== 'Renderer') || (thread.name && thread.name !== 'CrRendererMain'))
				throw new Error(`Markers must use the renderer main thread: ${sample.id}`);
			return {sample, pid: start.pid, tid: start.tid, key: thread.key, start: start.ts, jsEnd: marks['js-end'].ts, end: marks.end.ts};
		});
		for (const id of markers.keys()) {
			if (!ids.has(id))
				throw new Error(`Marker has no report sample: ${id}`);
		}
		const ordered = [...windows].sort((a, b) => a.start - b.start);
		for (let i = 1; i < ordered.length; i++) {
			if (ordered[i].start < ordered[i - 1].end)
				throw new Error(`Overlapping sample windows: ${ordered[i - 1].sample.id}, ${ordered[i].sample.id}`);
		}
		const nextStarts = new Map(ordered.map((window, i) => [window.sample.id, ordered[i + 1]?.start ?? traceEnd]));
		const boundaries = [];
		const availabilityBySample = [];
		const selectedThreads = new Map();

		const samples = windows.map(window => {
			const {sample, start, end} = window;
			const buckets = Object.fromEntries(WORK_METRICS.map(metric => [metric, []]));
			const tracked = [];
			const perThread = [];
			for (const thread of threads.values()) {
				const gpu = processes.get(thread.pid) === 'GPU Process';
				const renderer = thread.pid === window.pid && !gpu;
				const main = thread.key === window.key;
				const taskMetric = main ? 'rendererMainTaskMs'
					: renderer && thread.name === 'Compositor' ? 'rendererCompositorMs'
					: gpu && thread.name === 'CrGpuMain' ? 'gpuMainTaskMs'
					: gpu && thread.name === 'VizCompositorThread' ? 'vizCompositorMs' : null;
				const selected = [];
				for (const event of thread.intervals) {
					let metric = null;
					if (taskMetric && event.name === thread.taskEventName)
						metric = taskMetric;
					else if (main && STYLE.has(event.name))
						metric = 'styleLayoutPaintMs';
					else if ((renderer || gpu) && !main && !['CrRendererMain', 'Compositor', 'CrGpuMain', 'VizCompositorThread'].includes(thread.name) && event.name === 'RasterTask')
						metric = 'rasterWorkerMs';
					else if ((gpu || renderer) && event.name === 'GPUTask')
						metric = 'GPUTaskMs';
					else if (includeGc && (renderer || gpu) && !main && !['CrRendererMain', 'Compositor', 'CrGpuMain', 'VizCompositorThread'].includes(thread.name) && BACKGROUND_GC_EVENTS.has(event.name))
						metric = 'backgroundGcMs';
					if (metric) {
						buckets[metric].push(event);
						// Style events are a breakdown of main-thread work, never an additional total.
						if (metric !== 'styleLayoutPaintMs')
							selected.push(event);
					}
				}
				if (selected.length) {
					for (const event of selected)
						tracked.push(event);
					const info = {pid: thread.pid, tid: thread.tid, processName: processes.get(thread.pid) ?? null, threadName: thread.name, taskEventName: thread.taskEventName};
					selectedThreads.set(thread.key, info);
					perThread.push({...info, trackedWorkMs: unionMs(selected, start, end)});
				}
			}
			const availability = Object.fromEntries(WORK_METRICS.map(metric => [metric, buckets[metric].length > 0]));
			availabilityBySample.push({id: sample.id, ...availability});
			const metrics = Object.fromEntries(WORK_METRICS.map(metric => [metric,
				availability[metric] ? threadSumMs(buckets[metric], start, end) : null,
			]));
			const totalTrackedThreadWorkMs = perThread.reduce((sum, thread) => sum + thread.trackedWorkMs, 0);
			const withoutGcMs = threadSumMs(tracked.filter(event => !BACKGROUND_GC_EVENTS.has(event.name)), start, end);
			const tailEnd = nextStarts.get(sample.id);
			boundaries.push({
				id: sample.id,
				crossingStartEvents: tracked.filter(event => event.start < start && event.end > start).length,
				crossingEndEvents: tracked.filter(event => event.start < end && event.end > end).length,
				tailEndUs: tailEnd,
				tailWindowMs: (tailEnd - end) / 1000,
				tailTrackedThreadWorkMs: threadSumMs(tracked, end, tailEnd),
				tailTrackedBusyElapsedMs: unionMs(tracked, end, tailEnd),
			});
			return {
				...sample,
				markerPid: window.pid,
				markerTid: window.tid,
				startUs: start,
				jsEndUs: window.jsEnd,
				endUs: end,
				jsIntervalMs: (window.jsEnd - start) / 1000,
				traceWindowMs: (end - start) / 1000,
				...metrics,
				gcAddedThreadWorkMs: availability.backgroundGcMs ? Math.max(0, totalTrackedThreadWorkMs - withoutGcMs) : null,
				totalTrackedThreadWorkMs,
				trackedBusyElapsedMs: unionMs(tracked, start, end),
				hardwareGpuMs: null,
				threads: perThread,
			};
		});

		const groups = summarizeBenchmarkTraceSamples(samples);
		// Completion is supplied by the browser helper; thread trace events cannot prove it.
		const webglCompletion = samples.map(sample => ({
			id: sample.id,
			status: sample.webgl?.status ?? 'not-recorded',
			contextCount: sample.webgl?.contexts?.length ?? null,
			incompleteContexts: sample.webgl?.contexts?.filter(context => context.status !== 'complete') ?? null,
		}));
		const backend = backendInfo(report.systemInfo);
		const warnings = [
			'Thread wall durations can include waits and preemption. They are not CPU time; tdur is not proportionally clipped.',
			'Settling is a heuristic, not a completion fence. Tail work can include teardown, unrelated work, or the next setup; it is not attributed to the sample.',
			'GPU-process and GPUTask intervals do not measure hardware GPU execution. hardwareGpuMs is null.',
			'Tracked totals cover only selected observed intervals. Missing event types can cause incomplete totals; zero is not proof of no work.',
			'Background GC uses an explicit collector-scope allowlist. Wait/unpark scopes and generic worker wrappers are not added. GC overlap is temporal, not proof that this chart caused collection.',
			backend.warning,
		];
		if (webglCompletion.some(sample => sample.status === 'not-recorded'))
			warnings.push('WebGL completion was not recorded for some samples. Trace event availability and an idle tail do not prove GL completion.');
		if (webglCompletion.some(sample => sample.status !== 'complete' && sample.status !== 'not-recorded' && sample.status !== 'not-observed'))
			warnings.push('Some WebGL completion checks are incomplete. Inspect diagnostics.webglCompletion before treating those windows as drained.');
		if (webglCompletion.some(sample => sample.status === 'complete'))
			warnings.push('Reported WebGL fences or finish calls cover prior commands in observed contexts only, not future submissions, other realms, or compositor presentation. Completion wait time is not GPU execution time.');
		if (samples.some(sample => sample.webgl?.contexts?.length > 0 && sample.GPUTaskMs === null && sample.gpuMainTaskMs === null))
			warnings.push('WebGL contexts were observed without matching GPU-process task intervals. Fence completion does not make the host-thread totals complete.');
		if (boundaries.some(boundary => boundary.crossingEndEvents > 0))
			warnings.push('Selected events cross sample end markers; those intervals were clipped at the marker.');
		if (boundaries.some(boundary => boundary.tailTrackedThreadWorkMs > 0))
			warnings.push('Selected work exists after sample end markers, outside the reported sample totals.');
		if (Object.values(parsing).some(count => count > 0))
			warnings.push('Some events could not form synchronous intervals. Inspect diagnostics.parsing.');
		if (report.trace?.dataLoss || metadata?.dataLoss)
			warnings.push('Trace data loss was reported; work totals are incomplete.');
		if (windows.some(window => !processes.has(window.pid) || !threads.get(window.key).name))
			warnings.push('Some marker process/thread names are missing; marker identity defines the renderer main thread.');

		return {
			accountingProtocol,
			statistic: 'mean',
			samples,
			groups: groups.filter(group => !group.operation || group.operation === 'data-update'),
			...(benchmarkOperations(report) ? {phaseGroups: groups} : {}),
			diagnostics: {
				eventTypes,
				missingEventTypes: EVENT_NAMES.filter(name => !eventTypes[name].available),
				backgroundGc: {enabled: includeGc, allowedEvents: [...BACKGROUND_GC_EVENTS]},
				availabilityBySample,
				webglCompletion,
				selectedThreads: [...selectedThreads.values()],
				parsing,
				boundaries,
				backend,
				warnings,
			},
			definitions: {
				units: 'All durations are milliseconds. Marker timestamps ending in Us are trace microseconds.',
				dataPrepMs: 'Reported duration of actual demo prepData conversion from already-parsed packed JSON. Excludes network transfer, JSON parsing, and synthetic-data cloning. Data preparation occurs before chart start, outside the start/js-end/end markers.',
				prepAndInitMs: 'Legacy field name for dataPrepMs + jsMs. In lifecycle reports it combines preparation and operation readiness, not necessarily initialization. Excludes the gap between preparation and operation start, rAF waits, and settling. Validation is also excluded. This is not end-to-end wall latency.',
				jsMs: 'Unmodified report JS interval span, not exclusive JavaScript CPU time.',
				windowMs: 'Unmodified report sample window duration.',
				jsIntervalMs: 'Trace start to js-end elapsed span, including synchronous JS/DOM and other work or waits in that interval.',
				traceWindowMs: 'Trace start to end elapsed span, including the settling interval.',
				rendererMainTaskMs: 'Union of selected task intervals on the marker thread, clipped to [start, end].',
				styleLayoutPaintMs: 'Union of UpdateLayoutTree, Layout, PrePaint, Paint, and Layerize on the marker thread. A main-work breakdown, not added to totals.',
				rasterWorkerMs: 'Sum of per-thread RasterTask unions in the marker renderer and GPU processes, excluding known main and compositor threads. RasterTask identifies worker work; generic worker task wrappers are not added.',
				rendererCompositorMs: 'Sum of selected task unions on Compositor threads in the marker renderer.',
				gpuMainTaskMs: 'Sum of selected task unions on CrGpuMain threads in GPU Process; not hardware GPU time.',
				vizCompositorMs: 'Sum of selected task unions on VizCompositorThread threads in GPU Process.',
				GPUTaskMs: 'Sum of per-thread GPUTask unions in the marker renderer and GPU processes. Separate diagnostic, not hardware execution time.',
				backgroundGcMs: 'Sum of per-thread unions of allowlisted background V8 and CppGC collector scopes in the marker renderer and GPU processes, excluding known main/compositor threads. Nested scopes count once. Wait/unpark scopes are not selected; enclosing collector wall durations can still include preemption or waits. Main-thread GC remains inside task totals. Null for legacy accounting or absent relevant events.',
				gcAddedThreadWorkMs: 'Increase in totalTrackedThreadWorkMs from background GC after removing overlap with selected task, raster, and GPU intervals. Null when background GC is unavailable; otherwise zero means no added duration in this window.',
				totalTrackedThreadWorkMs: 'Sum of per-thread unions of selected task, RasterTask, GPUTask, and (under thread-work-gc-v2) background GC intervals within each round. Cross-metric overlaps on one thread count once. The headline mean averages these own-round totals, with main-thread and selected background GC already included. Not latency or CPU time.',
				trackedBusyElapsedMs: 'Global union of the same selected intervals across threads. Concurrent thread intervals count once; not end-to-end rendering latency.',
				hardwareGpuMs: 'Null: no supported hardware GPU execution measurement is available from these event types.',
				webglCompletion: 'Browser-reported completion status, not inferred from trace tasks. Complete covers preceding commands on observed contexts: asynchronous fences for WebGL2, blocking finish for WebGL1. Not-observed is not proof of no WebGL. Polling, flush, finish waits, and metadata queries belong to the instrumented window, after js-end. Wait duration is elapsed validation latency, not device busy time.',
				taskSelection: 'Use RunTask if valid intervals exist anywhere on that thread; otherwise use ThreadControllerImpl::RunTask. Never combine both wrappers.',
				availability: 'A metric is null when no matching valid intervals exist anywhere in the trace for its relevant threads. Zero means available but no overlap in this sample, not proven absence of work.',
				aggregation: TRACE_AGGREGATION,
				boundaries: 'Crossing counts use selected raw intervals, not unions. Tail spans end to the next sample start, or trace end for the last sample. Tail work is unassigned.',
				attribution: 'Renderer work is scoped to the marker process. GPU processes are shared: temporal overlap does not establish causality or chart ownership.',
			},
		};
	}
}
