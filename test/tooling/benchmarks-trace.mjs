import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { dashboardWorkload } from '../../scripts/benchmarks-phases.mjs';
import { summarizeProcessMemory } from '../../scripts/analyze-benchmarks-process-memory.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { SAMPLE_TIMEOUT_MS } from '../../scripts/bench-sample-timeout.mjs';
import { analyzeBenchmarkTrace, analyzeBenchmarkTraceFile } from '../../scripts/analyze-benchmarks-trace.mjs';
import { benchmarkTraceConfig, captureBenchmarkTrace } from '../../scripts/benchmarks-trace.mjs';
import { TRACE_ACCOUNTING, LEGACY_TRACE_ACCOUNTING } from '../../scripts/bench-trace-policy.mjs';

const metadata = [
	{ph: 'M', name: 'process_name', pid: 1, args: {name: 'Renderer'}},
	{ph: 'M', name: 'process_name', pid: 2, args: {name: 'GPU Process'}},
	{ph: 'M', name: 'process_name', pid: 3, args: {name: 'Renderer'}},
	...[['CrRendererMain', 1, 1], ['Compositor', 1, 2], ['ThreadPoolForegroundWorker', 1, 3],
		['ThreadPoolForegroundWorker', 1, 4], ['CrGpuMain', 2, 1], ['VizCompositorThread', 2, 2],
		['CrRendererMain', 3, 1]].map(([name, pid, tid]) => ({ph: 'M', name: 'thread_name', pid, tid, args: {name}})),
];

function sample(index = 0, extra = {}) {
	return {id: `sample-${index}`, dpr: 1, variant: 'uplot', round: index, warmup: false, jsMs: 2.01, windowMs: 10.01, ...extra};
}

function markers(index = 0, start = 0, jsEnd = start + 2, end = start + 10) {
	return [['start', start], ['js-end', jsEnd], ['end', end]].map(([phase, ts]) => ({
		name: `benchmark:sample-${index}:${phase}`, ph: 'I', cat: 'blink.user_timing', pid: 1, tid: 1, ts: ts * 1000,
	}));
}

function interval(name, start, end, pid = 1, tid = 1) {
	return {name, ph: 'X', ts: start * 1000, dur: (end - start) * 1000, pid, tid, tdur: 1};
}

function analyze(extra = [], samples = [sample()], marks = markers(), report = {}) {
	return analyzeBenchmarkTrace({traceEvents: [...metadata, ...marks, ...extra]}, {...report, samples});
}

function close(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

describe('benchmark trace analysis', () => {
	it('keeps the measured trace categories narrow and reports actual event categories and phases', () => {
		assert.deepEqual(benchmarkTraceConfig().includedCategories, ['blink.user_timing', 'disabled-by-default-devtools.timeline', 'disabled-by-default-v8.gc', 'cppgc']);
		const result = analyze([
			{...interval('RasterTask', 0, 1, 1, 3), cat: 'cc,disabled-by-default-devtools.timeline'},
			{...interval('GPUTask', 0, 2, 2, 1), cat: 'disabled-by-default-devtools.timeline'},
			{name: 'GPUTask', ph: 'b', ts: 3000, pid: 2, tid: 1, cat: 'other'},
		]);
		assert.deepEqual(result.diagnostics.eventTypes.RasterTask.categories, {'cc,disabled-by-default-devtools.timeline': 1});
		assert.deepEqual(result.diagnostics.eventTypes.GPUTask.phases, {X: 1, b: 1});
		assert.equal(result.samples[0].GPUTaskMs, 2);
		assert.equal(result.samples[0].hardwareGpuMs, null);
	});

	it('clips and deduplicates background collectors against nested GC, raster, and GPU scopes', () => {
		const result = analyze([
			interval('RunTask', 0, 3),
			interval('V8.GC_MC_BACKGROUND_MARKING', -2, 6, 1, 3),
			interval('ConcurrentMarking::RunMajor Finished', 1, 5, 1, 3),
			interval('CppGC.ConcurrentMark', 4, 8, 1, 3),
			interval('RasterTask', 6, 9, 1, 3),
			interval('GPUTask', 7, 10, 1, 3),
			interval('V8.GC_MC_BACKGROUND_SWEEPING', 8, 12, 2, 3),
			interval('CppGC.ConcurrentSweep', 20, 25, 1, 4),
		], undefined, undefined, {trace: {accountingProtocol: TRACE_ACCOUNTING}});
		const s = result.samples[0];
		assert.equal(result.accountingProtocol, TRACE_ACCOUNTING);
		assert.equal(s.backgroundGcMs, 10);
		assert.equal(s.gcAddedThreadWorkMs, 8);
		assert.equal(s.totalTrackedThreadWorkMs, 15);
		assert.equal(s.trackedBusyElapsedMs, 10);
		assert.equal(result.groups[0].metrics.backgroundGcMs.min, 10);
		assert.equal(result.groups[0].metrics.gcAddedThreadWorkMs.min, 8);
	});

	it('excludes unpark, waits, unknown scopes, other processes, and main-thread GC additions', () => {
		const events = [interval('RunTask', 0, 3),
			interval('V8.GC_BACKGROUND_UNPARK', 0, 10, 1, 3),
			interval('V8.GC_BACKGROUND_SAFEPOINT', 0, 10, 1, 3),
			interval('V8.GC_MC_CLEAR_JOIN_JOB', 0, 10, 1, 3),
			interval('V8.GC_NEW_UNKNOWN_SCOPE', 0, 10, 1, 3),
			interval('RunTask', 0, 10, 1, 3),
			interval('CppGC.ConcurrentMark', 0, 10, 3, 3),
			interval('CppGC.ConcurrentMark', 0, 10, 4, 3),
			interval('V8.GC_MC_BACKGROUND_MARKING', 0, 10),
			interval('CppGC.ConcurrentSweep', 20, 25, 1, 4),
		];
		const s = analyze(events, undefined, undefined, {trace: {accountingProtocol: TRACE_ACCOUNTING}}).samples[0];
		assert.equal(s.backgroundGcMs, 0);
		assert.equal(s.gcAddedThreadWorkMs, 0);
		assert.equal(s.totalTrackedThreadWorkMs, 3);
	});

	it('includes worker-side weak-reference clearing and pointer-table sweeping', () => {
		const result = analyze([
			interval('V8.GC_MC_CLEAR_WEAK_LISTS', 0, 1, 1, 3),
			interval('V8.GC_MC_CLEAR_SWEEP_EXTERNAL_POINTER_TABLE', 1, 3, 1, 3),
			interval('V8.GC_SCAVENGER_BACKGROUND_TRACED_HANDLES_RESET_PARALLEL', 0, 1, 1, 4),
		], undefined, undefined, {trace: {accountingProtocol: TRACE_ACCOUNTING}});
		assert.equal(result.samples[0].backgroundGcMs, 4);
		assert.equal(result.samples[0].gcAddedThreadWorkMs, 4);
	});

	it('pairs GC B/E scopes around unselected nested scopes', () => {
		const events = [
			{ph: 'B', name: 'CppGC.ConcurrentMark', ts: -1000, pid: 1, tid: 3, cat: 'cppgc'},
			{ph: 'B', name: 'unselected', ts: 1000, pid: 1, tid: 3},
			{ph: 'E', ts: 2000, pid: 1, tid: 3},
			{ph: 'E', ts: 4000, pid: 1, tid: 3},
		];
		const result = analyze(events, undefined, undefined, {trace: {accountingProtocol: TRACE_ACCOUNTING}});
		assert.equal(result.samples[0].backgroundGcMs, 4);
		assert.equal(result.samples[0].totalTrackedThreadWorkMs, 4);
		assert.equal(result.diagnostics.eventTypes['CppGC.ConcurrentMark'].intervalCount, 1);
	});

	it('preserves legacy totals, distinguishes absent GC from zero, and rejects unknown policies', () => {
		const events = [interval('CppGC.ConcurrentMark', 0, 5, 1, 3)];
		for (const report of [{}, {trace: {accountingProtocol: LEGACY_TRACE_ACCOUNTING}}]) {
			const result = analyze(events, undefined, undefined, report);
			assert.equal(result.accountingProtocol, LEGACY_TRACE_ACCOUNTING);
			assert.equal(result.samples[0].totalTrackedThreadWorkMs, 0);
			assert.equal(result.samples[0].backgroundGcMs, null);
			assert.equal(result.samples[0].gcAddedThreadWorkMs, null);
		}
		assert.equal(analyze([], undefined, undefined, {trace: {accountingProtocol: TRACE_ACCOUNTING}}).samples[0].backgroundGcMs, null);
		assert.throws(() => analyze(events, undefined, undefined, {trace: {accountingProtocol: 'unknown'}}), /Unsupported trace accounting/);
		assert.throws(() => analyze(events, undefined, undefined, {trace: {accountingProtocol: TRACE_ACCOUNTING}, analysis: {accountingProtocol: LEGACY_TRACE_ACCOUNTING}}), /capture and analysis accounting protocols differ/);
	});

	it('includes GPU-process raster workers and overlapping GPU tasks once per thread', () => {
		const result = analyze([
			{ph: 'M', name: 'thread_name', pid: 2, tid: 3, args: {name: 'ThreadPoolForegroundWorker'}},
			interval('RasterTask', -1, 4, 2, 3),
			interval('GPUTask', 2, 6, 2, 3),
			interval('RunTask', 0, 10, 2, 3), // Generic worker wrappers remain unselected.
			interval('RasterTask', 3, 5, 1, 3),
			interval('RasterTask', 0, 10, 2, 2), // Viz compositor is not a worker.
			interval('RasterTask', 0, 10, 3, 3), // Another renderer is not this sample.
		]);
		const s = result.samples[0];
		assert.equal(s.rasterWorkerMs, 6);
		assert.equal(s.GPUTaskMs, 4);
		assert.equal(s.totalTrackedThreadWorkMs, 8);
		assert.equal(s.trackedBusyElapsedMs, 6);
		assert.equal(s.hardwareGpuMs, null);
	});

	it('distinguishes unrecorded, unobserved, incomplete, and prior-command fence completion', () => {
		assert.equal(analyze().diagnostics.webglCompletion[0].status, 'not-recorded');
		for (const status of ['not-observed', 'incomplete', 'complete']) {
			const contexts = status === 'not-observed' ? [] : [{type: 'webgl2', status: status === 'complete' ? 'complete' : 'timeout'}];
			const webgl = {status, contexts, waitMs: 1};
			const result = analyze([], [sample(0, {webgl})]);
			assert.deepEqual(result.samples[0].webgl, webgl);
			assert.equal(result.diagnostics.webglCompletion[0].status, status);
			assert.equal(result.diagnostics.webglCompletion[0].contextCount, contexts.length);
			assert.equal(result.samples[0].hardwareGpuMs, null);
			assert.equal(result.samples[0].totalTrackedThreadWorkMs, 0); // Never add fence waits.
			if (status === 'incomplete')
				assert.ok(result.diagnostics.warnings.some(w => w.includes('checks are incomplete')));
			if (status === 'complete')
				assert.ok(result.diagnostics.warnings.some(w => w.includes('not GPU execution time')));
			if (contexts.length)
				assert.ok(result.diagnostics.warnings.some(w => w.includes('without matching GPU-process task intervals')));
		}
	});
	it('unions nested intervals per thread, clips boundaries, and separates occupancy from elapsed time', () => {
		const result = analyze([
			interval('RunTask', -2, 6),
			interval('RunTask', 2, 8),
			interval('RunTask', 3, 4),
			interval('ThreadControllerImpl::RunTask', -4, 12),
			interval('UpdateLayoutTree', 1, 4),
			interval('Layout', 2, 5),
			interval('PrePaint', 2.5, 3.5),
			interval('Paint', 7, 8),
			interval('Layerize', 7.5, 8),
			interval('RasterTask', 1, 6, 1, 3),
			interval('RasterTask', 4, 9, 1, 3),
			interval('RasterTask', 2, 5, 1, 4),
			interval('RunTask', 0, 10, 1, 3), // Worker task wrappers are not selected.
			interval('RunTask', 5, 12, 1, 2),
			interval('RunTask', 4, 7, 2, 1),
			interval('GPUTask', 6, 9, 2, 1),
			interval('GPUTask', 6.5, 8, 2, 1),
			interval('GPUTask', 8, 10, 1, 3), // Overlaps RasterTask on this thread.
			interval('RunTask', 8, 12, 2, 2),
			interval('RasterTask', 0, 10), // Not a renderer worker.
			interval('RasterTask', 0, 10, 2, 1),
			interval('RunTask', 0, 100, 3, 1), // Unrelated renderer.
			interval('RasterTask', 0, 100, 3, 3),
		]);
		const s = result.samples[0];
		assert.equal(s.rendererMainTaskMs, 8);
		assert.equal(s.styleLayoutPaintMs, 5);
		assert.equal(s.rasterWorkerMs, 11);
		assert.equal(s.rendererCompositorMs, 5);
		assert.equal(s.gpuMainTaskMs, 3);
		assert.equal(s.vizCompositorMs, 2);
		assert.equal(s.GPUTaskMs, 5);
		assert.equal(s.totalTrackedThreadWorkMs, 32);
		assert.equal(s.trackedBusyElapsedMs, 10);
		assert.equal(s.hardwareGpuMs, null);
		assert.equal(s.threads.reduce((sum, thread) => sum + thread.trackedWorkMs, 0), 32);
		assert.equal(s.threads.find(thread => thread.pid === 2 && thread.tid === 1).trackedWorkMs, 5);
		assert.equal(result.diagnostics.boundaries[0].crossingStartEvents, 1);
		assert.equal(result.diagnostics.boundaries[0].crossingEndEvents, 2);
		assert.equal(result.diagnostics.boundaries[0].tailTrackedThreadWorkMs, 4);
		assert.equal(result.diagnostics.boundaries[0].tailTrackedBusyElapsedMs, 2);
		assert.ok(result.diagnostics.warnings.some(warning => warning.includes('cross sample end')));
		assert.ok(result.diagnostics.warnings.some(warning => warning.includes('not a completion fence')));
	});

	it('preserves tracked totals without detailed timeline events or fallback wrappers', () => {
		const tasks = [
			interval('RunTask', 0, 8),
			interval('RunTask', 1, 4, 1, 2),
			interval('RasterTask', 2, 6, 1, 3),
			interval('RunTask', 3, 7, 2, 1),
			interval('GPUTask', 4, 8, 2, 1),
			interval('RunTask', 5, 9, 2, 2),
		];
		const detailed = analyze([
			...tasks,
			...tasks.filter(event => event.name === 'RunTask').map(event => ({...event, name: 'ThreadControllerImpl::RunTask'})),
			interval('Layout', 1, 3), interval('Paint', 3, 5),
		]);
		const minimal = analyze(tasks);
		for (const metric of ['rendererMainTaskMs', 'rendererCompositorMs', 'rasterWorkerMs',
			'gpuMainTaskMs', 'vizCompositorMs', 'GPUTaskMs', 'totalTrackedThreadWorkMs', 'trackedBusyElapsedMs']) {
			assert.notEqual(minimal.samples[0][metric], null, metric);
			assert.equal(minimal.samples[0][metric], detailed.samples[0][metric], metric);
		}
		assert.deepEqual(minimal.samples[0].threads, detailed.samples[0].threads);
		assert.equal(minimal.samples[0].styleLayoutPaintMs, null);
		assert.equal(detailed.samples[0].styleLayoutPaintMs, 4);
	});

	it('preserves report metadata and reports marker spans rather than exclusive JS or CPU time', () => {
		const s = analyze([interval('RunTask', -10, 20)]).samples[0];
		for (const [key, value] of Object.entries(sample()))
			assert.equal(s[key], value);
		assert.equal(s.jsIntervalMs, 2);
		assert.equal(s.traceWindowMs, 10);
		assert.equal(s.rendererMainTaskMs, 10); // tdur=1 is deliberately not used.
		assert.equal(s.startUs, 0);
		assert.equal(s.jsEndUs, 2000);
		assert.equal(s.endUs, 10000);
	});

	it('keeps prep metrics outside all trace intervals and diagnostics', () => {
		const events = [interval('RunTask', -50, -20), interval('RunTask', -1, 12), interval('Paint', 1, 4)];
		const baseline = analyze(events);
		const prep = {dataPrepMs: 30, prepAndInitMs: 32.01};
		const result = analyze(events, [Object.freeze(sample(0, prep))]);
		assert.deepEqual(result.samples[0], {...baseline.samples[0], ...prep});
		assert.deepEqual(result.diagnostics, baseline.diagnostics);
		for (const [metric, stats] of Object.entries(baseline.groups[0].metrics)) {
			if (!Object.hasOwn(prep, metric))
				assert.deepEqual(result.groups[0].metrics[metric], stats);
		}
		for (const [metric, value] of Object.entries(prep))
			assert.deepEqual(result.groups[0].metrics[metric], {min: value, max: value, mean: value, count: 1, missing: 0});
		assert.throws(() => analyze(events, [sample(0, {...prep, jsMs: prep.prepAndInitMs})]), /duration mismatch/);
		assert.throws(() => analyze(events, [sample(0, prep)], markers().slice(1)), /Missing marker/);
	});

	it('reports missing prep metrics as null without deriving them', () => {
		const result = analyze();
		for (const metric of ['dataPrepMs', 'prepAndInitMs'])
			assert.deepEqual(result.groups[0].metrics[metric], {min: null, max: null, mean: null, count: 0, missing: 1});
		const partial = analyze([], [sample(0, {dataPrepMs: 3})]);
		assert.deepEqual(partial.groups[0].metrics.prepAndInitMs, {min: null, max: null, mean: null, count: 0, missing: 1});
	});

	for (const metric of ['dataPrepMs', 'prepAndInitMs']) {
		it(`aggregates finite ${metric} values, excludes warmups, and separates DPR and variant`, () => {
			const samples = [null, undefined, NaN, Infinity, -Infinity, '12', false, {}, 0, 8, 4]
				.map((value, i) => sample(i, {[metric]: value}));
			samples.push(
				sample(11, {warmup: true, [metric]: 1000}),
				sample(12, {variant: 'idle', [metric]: 100}),
				sample(13, {dpr: 2, [metric]: 20}),
				sample(14, {dpr: 3, warmup: true, [metric]: 1000}),
			);
			const result = analyze([], samples, samples.flatMap((_, i) => markers(i, i * 20)));
			const [main, idle, dpr2, warmupOnly] = result.groups;
			assert.equal(main.sampleCount, 11);
			assert.equal(main.warmupCount, 1);
			assert.deepEqual(main.metrics[metric], {min: 0, max: 8, mean: 4, count: 3, missing: 8});
			assert.deepEqual(idle.metrics[metric], {min: 100, max: 100, mean: 100, count: 1, missing: 0});
			assert.deepEqual(dpr2.metrics[metric], {min: 20, max: 20, mean: 20, count: 1, missing: 0});
			assert.equal(warmupOnly.warmupCount, 1);
			assert.deepEqual(warmupOnly.metrics[metric], {min: null, max: null, mean: null, count: 0, missing: 0});
		});
	}

	it('defines prep conversion and the prep-plus-initialization sum without wall-latency claims', () => {
		const {definitions} = analyze();
		assert.match(definitions.dataPrepMs, /actual demo prepData conversion from already-parsed packed JSON/);
		assert.match(definitions.dataPrepMs, /Excludes network transfer, JSON parsing, and synthetic-data cloning/);
		assert.match(definitions.dataPrepMs, /outside the start\/js-end\/end markers/);
		assert.match(definitions.prepAndInitMs, /dataPrepMs \+ jsMs/);
		assert.match(definitions.prepAndInitMs, /not end-to-end wall latency/);
		assert.match(definitions.prepAndInitMs, /Excludes the gap.*rAF waits, and settling/);
	});

	it('selects task wrappers per thread, never fills RunTask gaps with fallback intervals', () => {
		const result = analyze([
			interval('RunTask', 20, 21),
			interval('ThreadControllerImpl::RunTask', 0, 10),
			interval('ThreadControllerImpl::RunTask', 1, 4, 1, 2),
			interval('ThreadControllerImpl::RunTask', 2, 3, 1, 2),
			interval('ThreadControllerImpl::RunTask', 3, 5, 2, 1),
		]);
		const s = result.samples[0];
		assert.equal(s.rendererMainTaskMs, 0);
		assert.equal(s.rendererCompositorMs, 3);
		assert.equal(s.gpuMainTaskMs, 2);
		assert.equal(s.totalTrackedThreadWorkMs, 5);
		assert.equal(s.trackedBusyElapsedMs, 4);
		assert.equal(s.threads.find(thread => thread.pid === 1 && thread.tid === 1).taskEventName, 'RunTask');
		assert.equal(s.threads.find(thread => thread.pid === 2).taskEventName, 'ThreadControllerImpl::RunTask');
	});

	it('pairs synchronous B/E events with nested unselected events and unnamed ends', () => {
		const pair = (ph, ts, name) => ({ph, ts: ts * 1000, name, pid: 1, tid: 1});
		const result = analyze([
			pair('E', 8), pair('B', -1, 'RunTask'),
			pair('B', 1, 'unselected'), pair('E', 2),
			pair('B', 3, 'Layout'), pair('E', 5, 'Layout'),
			interval('Paint', 4, 6),
		]);
		assert.equal(result.samples[0].rendererMainTaskMs, 8);
		assert.equal(result.samples[0].styleLayoutPaintMs, 3);
		assert.equal(result.samples[0].totalTrackedThreadWorkMs, 8);
		assert.equal(result.diagnostics.eventTypes.RunTask.intervalCount, 1);
		assert.ok(Object.values(result.diagnostics.parsing).every(count => count === 0));
	});

	it('diagnoses incomplete/invalid synchronous intervals without inventing durations', () => {
		const result = analyze([
			{ph: 'E', pid: 1, tid: 1, ts: 0},
			{ph: 'B', name: 'RunTask', pid: 1, tid: 1, ts: 1},
			{ph: 'E', name: 'Other', pid: 1, tid: 1, ts: 2},
			{ph: 'B', name: 'RunTask', pid: 1, tid: 1, ts: 3},
			interval('RasterTask', 2, 1, 1, 3),
			{ph: 'b', name: 'GPUTask', pid: 2, tid: 1, ts: 5},
		]);
		assert.deepEqual(result.diagnostics.parsing, {invalidIntervals: 1, unmatchedBegins: 1, unmatchedEnds: 1, mismatchedEnds: 1, ignoredAsyncEvents: 1});
		assert.equal(result.samples[0].rendererMainTaskMs, null);
		assert.equal(result.samples[0].GPUTaskMs, null);
		assert.equal(result.samples[0].totalTrackedThreadWorkMs, 0);
	});

	it('keeps missing GPU and raster measurements null, not hardware zeros', () => {
		const result = analyze([interval('RunTask', 0, 1)]);
		const s = result.samples[0];
		for (const metric of ['GPUTaskMs', 'gpuMainTaskMs', 'vizCompositorMs', 'hardwareGpuMs', 'rasterWorkerMs']) {
			assert.equal(s[metric], null);
			assert.deepEqual(result.groups[0].metrics[metric], {min: null, max: null, mean: null, count: 0, missing: 1});
		}
		assert.equal(result.diagnostics.eventTypes.GPUTask.available, false);
		assert.ok(result.diagnostics.missingEventTypes.includes('GPUTask'));
		assert.equal(result.diagnostics.availabilityBySample[0].GPUTaskMs, false);
		const available = analyze([interval('GPUTask', 20, 21, 2, 1)]);
		assert.equal(available.samples[0].GPUTaskMs, 0);
		assert.deepEqual(available.groups[0].metrics.GPUTaskMs, {min: 0, max: 0, mean: 0, count: 1, missing: 0});
		assert.equal(available.samples[0].hardwareGpuMs, null);
	});

	it('does not treat event availability in another renderer as sample availability', () => {
		const result = analyze([interval('RunTask', 0, 10, 3, 1), interval('RasterTask', 0, 10, 3, 3)]);
		assert.equal(result.diagnostics.eventTypes.RunTask.available, true);
		assert.equal(result.diagnostics.eventTypes.RasterTask.available, true);
		assert.equal(result.samples[0].rendererMainTaskMs, null);
		assert.equal(result.samples[0].rasterWorkerMs, null);
	});

	it('excludes warmups from extrema, groups DPR separately, and never subtracts idle', () => {
		const samples = [sample(0, {warmup: true}), sample(1), sample(2), sample(3, {variant: 'idle'}), sample(4, {dpr: 2}), sample(5, {dpr: 3, warmup: true})];
		const result = analyze([0.5, 2, 4, 1, 5, 9].map((duration, i) => interval('RunTask', i * 20, i * 20 + duration)), samples, samples.flatMap((_, i) => markers(i, i * 20)));
		assert.equal(result.samples.length, 6);
		const [main, idle, dpr2, warmupOnly] = result.groups;
		assert.equal(main.warmupCount, 1);
		assert.equal(main.sampleCount, 2);
		assert.deepEqual(main.sampleIds, ['sample-1', 'sample-2']);
		assert.deepEqual(main.metrics.rendererMainTaskMs, {min: 2, max: 4, mean: 3, count: 2, missing: 0});
		assert.equal(idle.variant, 'idle');
		assert.equal(idle.metrics.rendererMainTaskMs.min, 1);
		assert.equal(dpr2.metrics.rendererMainTaskMs.min, 5);
		assert.equal(warmupOnly.sampleCount, 0);
		assert.deepEqual(warmupOnly.metrics.rendererMainTaskMs, {min: null, max: null, mean: null, count: 0, missing: 0});
	});

	it('averages asymmetric values, retains extrema, and reports missing counts', () => {
		const samples = [sample(0), sample(1), sample(2)];
		const result = analyze([1, 9, 3].map((duration, i) => interval('RunTask', i * 20, i * 20 + duration)), samples, samples.flatMap((_, i) => markers(i, i * 20)));
		assert.deepEqual(result.groups[0].metrics.rendererMainTaskMs, {min: 1, max: 9, mean: 13 / 3, count: 3, missing: 0});
		assert.equal(result.groups[0].metrics.GPUTaskMs.missing, 3);
	});

	it('takes independent metric minima and the minimum of own-round tracked totals', () => {
		const durations = [[1, 9], [8, 1], [3, 3], [9, 9], [0.25, 0.25]];
		const samples = durations.map((_, i) => sample(i, {warmup: i === 4}));
		const events = durations.flatMap(([main, raster], i) => [
			interval('RunTask', i * 20, i * 20 + main),
			interval('RasterTask', i * 20, i * 20 + raster, 1, 3),
		]);
		const result = analyze(events, samples, samples.flatMap((_, i) => markers(i, i * 20)));
		const metrics = result.groups[0].metrics;
		assert.equal(metrics.rendererMainTaskMs.min, 1);
		assert.equal(metrics.rasterWorkerMs.min, 1);
		assert.deepEqual(result.samples.map(s => s.totalTrackedThreadWorkMs), [10, 9, 6, 18, 0.5]);
		assert.deepEqual(metrics.totalTrackedThreadWorkMs, {min: 6, max: 18, mean: 10.75, count: 4, missing: 0});
		assert.deepEqual(metrics.trackedBusyElapsedMs, {min: 3, max: 9, mean: 7.25, count: 4, missing: 0});
		for (const stats of Object.values(metrics))
			assert.deepEqual(Object.keys(stats), ['min', 'max', 'mean', 'count', 'missing']);
	});

	it('takes the minimum of own-round prep-plus-init sums, not the sum of minima', () => {
		const durations = [[1, 8], [8, 1], [4, 4], [0.25, 0.25]];
		const samples = durations.map(([dataPrepMs, jsMs], i) => sample(i, {
			dataPrepMs, jsMs, prepAndInitMs: dataPrepMs + jsMs, warmup: i === 3,
		}));
		const result = analyze([], samples, samples.flatMap((s, i) => markers(i, i * 20, i * 20 + s.jsMs)));
		const metrics = result.groups[0].metrics;
		assert.equal(metrics.dataPrepMs.min, 1);
		assert.equal(metrics.jsMs.min, 1);
		assert.deepEqual(metrics.prepAndInitMs, {min: 8, max: 9, mean: 26 / 3, count: 3, missing: 0});
	});

	it('defines arithmetic means and own-round totals without idle subtraction', () => {
		const {definitions} = analyze();
		assert.match(definitions.aggregation, /exclude warmups/);
		assert.match(definitions.aggregation, /Headline trace timings use arithmetic means across measured runs, including zero values/);
		assert.match(definitions.aggregation, /GC breakdowns are not added again/);
		assert.match(definitions.aggregation, /only finite numbers/);
		assert.match(definitions.aggregation, /Idle remains a separate variant; no baseline subtraction/);
		assert.match(definitions.totalTrackedThreadWorkMs, /headline mean averages these own-round totals/);
		assert.doesNotMatch(JSON.stringify(definitions), /median/i);
	});

	it('averages all seven runs with intermittent background GC and main-thread pauses', () => {
		const samples = Array.from({length: 8}, (_, i) => sample(i, {warmup: i === 7}));
		const events = samples.flatMap((_, i) => [
			interval('RunTask', i * 20, i * 20 + (i === 0 ? 1 : 9)),
			...(i === 1 || i === 7 ? [
				interval('V8.GC_MC_BACKGROUND_MARKING', i * 20, i * 20 + 8, 1, 3),
				interval('CppGC.ConcurrentMark', i * 20 + 1, i * 20 + 7, 1, 3),
				interval('RasterTask', i * 20 + 6, i * 20 + 10, 1, 3),
			] : []),
		]);
		const result = analyze(events, samples, samples.flatMap((_, i) => markers(i, i * 20)), {trace: {accountingProtocol: TRACE_ACCOUNTING}});
		const metrics = result.groups[0].metrics;
		assert.equal(result.statistic, 'mean');
		assert.equal(metrics.rendererMainTaskMs.mean, 55 / 7);
		assert.equal(metrics.backgroundGcMs.mean, 8 / 7);
		assert.equal(metrics.gcAddedThreadWorkMs.mean, 6 / 7);
		assert.equal(metrics.totalTrackedThreadWorkMs.mean, 65 / 7);
		assert.equal(metrics.totalTrackedThreadWorkMs.min, 1);
		assert.equal(metrics.totalTrackedThreadWorkMs.count, 7);
	});

	it('measures unassigned tails only until the next start, including the last trace tail', () => {
		const result = analyze([interval('RunTask', 9, 23), interval('RunTask', 29, 34)], [sample(0), sample(1)], [...markers(), ...markers(1, 20)]);
		assert.equal(result.samples[0].rendererMainTaskMs, 1);
		assert.equal(result.samples[1].rendererMainTaskMs, 4);
		assert.equal(result.diagnostics.boundaries[0].tailTrackedThreadWorkMs, 10);
		assert.equal(result.diagnostics.boundaries[1].tailTrackedThreadWorkMs, 4);
		assert.equal(result.diagnostics.boundaries[1].crossingStartEvents, 1);
	});

	it('accepts array traces, missing thread metadata, touching windows, and unordered report samples', () => {
		const result = analyzeBenchmarkTrace([...markers(0), ...markers(1, 10), interval('RunTask', -1, 21)], {samples: [sample(1), sample(0)]});
		assert.deepEqual(result.samples.map(s => s.id), ['sample-1', 'sample-0']);
		assert.equal(result.samples[0].rendererMainTaskMs, 10);
		assert.ok(result.diagnostics.warnings.some(warning => warning.includes('names are missing')));
	});

	it('handles fractional microsecond durations without rounding raw metrics', () => {
		const result = analyze([interval('RunTask', 0.00025, 1.23475)]);
		close(result.samples[0].rendererMainTaskMs, 1.2345);
	});

	for (const phase of ['start', 'js-end', 'end']) {
		it(`rejects missing ${phase} markers, including warmups`, () => {
			assert.throws(() => analyze([], [sample(0, {warmup: true})], markers().filter(mark => !mark.name.endsWith(`:${phase}`))), /Missing marker/);
		});
		it(`rejects duplicate ${phase} markers`, () => {
			const marks = markers();
			assert.throws(() => analyze([], [sample()], [...marks, marks.find(mark => mark.name.endsWith(`:${phase}`))]), /Duplicate marker/);
		});
	}

	it('rejects wrong marker order and overlaps even when a sample is a warmup', () => {
		assert.throws(() => analyze([], [sample()], markers(0, 0, 11, 10)), /Invalid marker order/);
		assert.throws(() => analyze([], [sample()], markers(0, 2, 1, 10)), /Invalid marker order/);
		assert.throws(() => analyze([], [sample()], markers(0, 0, 0, 0)), /Invalid marker order/);
		assert.throws(() => analyze([], [sample(), sample(1, {warmup: true})], [...markers(), ...markers(1, 5)]), /Overlapping sample/);
	});

	it('rejects marker thread changes, wrong process/thread roles, and malformed markers', () => {
		const marks = markers();
		marks[1] = {...marks[1], tid: 3};
		assert.throws(() => analyze([], [sample()], marks), /same thread/);
		assert.throws(() => analyze([], [sample()], markers().map(mark => ({...mark, pid: 2}))), /renderer main thread/);
		assert.throws(() => analyze([], [sample()], markers().map(mark => ({...mark, tid: 2}))), /renderer main thread/);
		for (const patch of [{ph: 'X'}, {cat: 'other'}, {ts: NaN}, {name: 'benchmark:sample-0:bad'}])
			assert.throws(() => analyze([], [sample()], [{...markers()[0], ...patch}, ...markers().slice(1)]), /Invalid sample marker/);
	});

	it('rejects unmatched report IDs, duplicate report IDs, and ambiguous warmup flags', () => {
		assert.throws(() => analyze([], [sample()], [...markers(), ...markers(1, 20)]), /no report sample/);
		assert.throws(() => analyze([], [sample(), sample()]), /duplicate report sample id/);
		assert.throws(() => analyze([], [sample(0, {warmup: undefined})]), /boolean warmup/);
		assert.throws(() => analyzeBenchmarkTrace({}, {samples: []}), /arrays/);
	});

	it('rejects mixed captures and inconsistent report spans', () => {
		const capture = {ph: 'I', cat: 'blink.user_timing', name: 'benchmark:capture:run-a', pid: 1, tid: 1, ts: 0};
		assert.doesNotThrow(() => analyze([capture], [sample()], markers(), {captureId: 'run-a'}));
		assert.throws(() => analyze([capture], [sample()], markers(), {captureId: 'run-b'}), /capture ID mismatch/);
		assert.throws(() => analyze([], [sample()], markers(), {captureId: 'run-a'}), /capture ID mismatch/);
		assert.throws(() => analyze([capture, capture], [sample()], markers(), {captureId: 'run-a'}), /capture ID mismatch/);
		for (const patch of [{jsMs: 8}, {windowMs: 20}, {jsMs: NaN}])
			assert.throws(() => analyze([], [sample(0, patch)]), /duration mismatch/);
	});

	it('matches file analysis for all tracked names, phases, categories, pairs, metadata, and untracked tails', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bench-trace-analysis-'));
		try {
			const names = ['RunTask', 'ThreadControllerImpl::RunTask', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'RasterTask', 'GPUTask'];
			const phases = ['X', 'B', 'E', 'b', 'e', 's', 't', 'f', 'I', 'C', 'M', 'R', undefined];
			const pair = (ph, ts, name) => ({ph, ts, name, pid: 1, tid: 1});
			const events = [...metadata, ...markers(), ...markers(1, 20), ...markers(2, 40),
				{ph: 'I', cat: 'blink.user_timing', name: 'benchmark:capture:stream'},
				...names.flatMap((name, index) => phases.map((ph, i) => ({
					...interval(name, i, i + 1, index % 2 + 1, index % 3 + 1), ph,
					cat: ['cc,disabled-by-default-devtools.timeline', 'blink.user_timing', undefined, '__proto__'][i % 4],
					args: {text: 'é😀 \\ " } [ nested payload', nested: [{a: true}]},
				}))),
				pair('E', 19000), pair('B', 12000, 'RunTask'),
				pair('B', 13000, 'untracked'), pair('E', 14000),
				pair('E', 21000, 'mismatch'), pair('B', 20000, 'RunTask'),
				pair('B', 22000, 'unfinished'),
				interval('RunTask', 3, 1), {name: 'Layout', ph: 'X', ts: 1},
				interval('RunTask', 48, 55),
				{name: 'InvalidateLayout', ph: 'I', ts: 60000},
				{name: 'ScheduleStyleRecalculation', ph: 'X', ts: 59000, dur: 20000},
			];
			const report = {captureId: 'stream', samples: [sample(2, {dpr: 2}), sample(0, {warmup: true}), sample(1, {variant: 'idle', dataPrepMs: 1, prepAndInitMs: 3.01})]};
			for (const trace of [events, {metadata: {dataLoss: true}, traceEvents: events}, {traceEvents: events, metadata: {dataLoss: false}}]) {
				const raw = JSON.stringify(trace);
				const expected = analyzeBenchmarkTrace(JSON.parse(raw), report);
				assert.equal(expected.diagnostics.boundaries[0].tailEndUs, 79000);
				for (const compressed of [false, true]) {
					const path = join(dir, 'trace.json' + (compressed ? '.gz' : ''));
					await writeFile(path, compressed ? gzipSync(raw) : raw);
					assert.deepEqual(await analyzeBenchmarkTraceFile(path, report), expected);
				}
			}
		}
		finally {
			await rm(dir, {recursive: true, force: true});
		}
	});

	it('preserves marker and capture validation in file analysis', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bench-trace-errors-'));
		try {
			const capture = {ph: 'I', cat: 'blink.user_timing', name: 'benchmark:capture:good'};
			for (const [events, report] of [
				[markers(), {samples: [sample()], captureId: 'missing'}],
				[[...markers(), capture, capture], {samples: [sample()], captureId: 'good'}],
				[markers().slice(1), {samples: [sample()]}],
				[[...markers(), markers()[0]], {samples: [sample()]}],
				[[{...markers()[0], ph: 'X'}, ...markers().slice(1)], {samples: [sample()]}],
				[markers(), {samples: [sample(0, {jsMs: 20})]}],
			]) {
				const path = join(dir, 'trace.json.gz');
				await writeFile(path, gzipSync(JSON.stringify(events)));
				let expected;
				try { analyzeBenchmarkTrace(events, report); }
				catch (error) { expected = error; }
				assert.ok(expected);
				await assert.rejects(analyzeBenchmarkTraceFile(path, report), {message: expected.message});
			}
		}
		finally {
			await rm(dir, {recursive: true, force: true});
		}
	});

	it('reports software backend evidence and does not infer hardware execution from device presence', () => {
		const systemInfo = {gpu: {auxAttributes: {glRenderer: 'ANGLE (SwiftShader Device)', glImplementationParts: 'angle=swiftshader'}, featureStatus: {rasterization: 'disabled_software'}, devices: [{deviceString: 'SwiftShader'}]}};
		const software = analyze([], [sample()], markers(), {systemInfo, trace: {dataLoss: true}});
		assert.equal(software.diagnostics.backend.kind, 'software');
		assert.deepEqual(software.diagnostics.backend.featureStatus, systemInfo.gpu.featureStatus);
		assert.ok(software.diagnostics.warnings.some(warning => warning.includes('data loss')));
		const hardware = analyze([], [sample()], markers(), {systemInfo: {gpu: {devices: [{deviceString: 'Physical GPU'}]}}});
		assert.equal(hardware.diagnostics.backend.kind, 'unverified');
		assert.equal(hardware.samples[0].hardwareGpuMs, null);
		assert.equal(analyze().diagnostics.backend.kind, 'unknown');
	});
});

async function withCaptureSocket(onEvaluate, test) {
	const dir = await mkdtemp(join(tmpdir(), 'bench-trace-timeout-'));
	const originalSocket = globalThis.WebSocket;
	const originalFetch = globalThis.fetch;
	const calls = [];
	const sockets = [];
	class Socket extends EventTarget {
		closed = false;
		messageListeners = new Set();
		constructor() {
			super();
			sockets.push(this);
			queueMicrotask(() => this.dispatchEvent(new Event('open')));
		}
		addEventListener(type, listener, options) {
			if (type === 'message')
				this.messageListeners.add(listener);
			super.addEventListener(type, listener, options);
		}
		removeEventListener(type, listener, options) {
			if (type === 'message')
				this.messageListeners.delete(listener);
			super.removeEventListener(type, listener, options);
		}
		message(message) {
			this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(message)}));
		}
		boundary(phase, variant = 'uplot') {
			this.message({method: 'Runtime.bindingCalled', params: {name: 'benchmarkSampleBoundary', payload: JSON.stringify({phase, variant})}});
		}
		send(text) {
			const {id, method, params} = JSON.parse(text);
			calls.push({method, params});
			let result = {};
			if (method === 'Runtime.evaluate') {
				if (onEvaluate(this, id, params.expression))
					return;
				let value = true;
				if (params.expression === 'benchmarkLifecycle.begin()')
					value = {config: {variants: ['uplot'], dpr: 1, warmups: 0, rounds: 1}};
				if (params.expression === 'benchmarkLifecycle.construct()')
					value = sample();
				result = {result: {value}};
			}
			this.message({id, result});
		}
		close() {
			this.closed = true;
			this.dispatchEvent(new Event('close'));
		}
	}
	try {
		await writeFile(join(dir, 'DevToolsActivePort'), '1234\n/devtools/browser/test');
		globalThis.WebSocket = Socket;
		globalThis.fetch = async () => ({json: async () => [{type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/page'}]});
		await test({dir, calls, sockets, capture: options => captureBenchmarkTrace({profile: dir, cache: dir, url: 'http://127.0.0.1:1234/bench', ...options})});
	}
	finally {
		globalThis.WebSocket = originalSocket;
		globalThis.fetch = originalFetch;
		await rm(dir, {recursive: true, force: true});
	}
}

describe('benchmark trace sample timeout integration', () => {
	for (const dashboard of [false, true]) {
		it(`uses the matching viewport for dashboard=${dashboard}`, async () => {
			await withCaptureSocket((socket, id, expression) => {
				if (expression !== 'globalThis.runBenchmarkTrace({raf: true})') return false;
				socket.message({id, result: {result: {value: {samples: []}}}});
				return true;
			}, async ({capture, calls}) => {
				await capture({dashboard, trace: false, raf: true, dpr: 2});
				assert.deepEqual(calls.find(call => call.method === 'Emulation.setDeviceMetricsOverride').params,
					{width: 1920, height: dashboard ? 1080 : 900, deviceScaleFactor: 2, mobile: false});
			});
		});
	}

	it('preserves dashboard identity and lifecycle in the captured process-memory analysis', async () => {
		const source = await readFile(new URL('../../scripts/benchmarks-trace.mjs', import.meta.url), 'utf8');
		const start = source.indexOf('report.processAnalysis = summarizeProcessMemory(');
		const end = source.indexOf('\n\t\t\tfor (const key', start);
		assert.ok(start >= 0 && end > start);
		const report = {workload: {...dashboardWorkload}, phase: 'chart-population', initProtocol: 'settled-work-v1',
			lifecycle: {operations: ['small-init', 'data-update']}, memoryProtocol: 'through-update-v1', samples: []};
		runInNewContext(source.slice(start, end), {report, blank: undefined, loaded: undefined, summarizeProcessMemory});
		assert.deepEqual(report.processAnalysis.workload, dashboardWorkload);
		assert.match(report.processAnalysis.definitions.live, /all dashboard charts/);
	});

	for (const phase of ['prepare', 'construct']) {
		it(`closes both clients without cleanup or output when ${phase} stays silent`, async () => {
			await withCaptureSocket((socket, id, expression) => expression === `benchmarkLifecycle.${phase}()`, async ({dir, calls, sockets, capture}) => {
				const timeouts = [];
				const callbackClosedStates = [];
				const output = [];
				const originalConsole = Object.fromEntries(['log', 'warn', 'error'].map(name => [name, console[name]]));
				for (const name of Object.keys(originalConsole))
					console[name] = (...args) => output.push(args);
				try {
					await assert.rejects(capture({sampleTimeoutMs: 20, onSampleTimeout(error) {
						timeouts.push(error);
						callbackClosedStates.push(sockets.map(socket => socket.closed));
						if (phase === 'prepare')
							throw new Error('parent callback failed');
						return Promise.reject(new Error('parent callback rejected'));
					}}), error => {
						assert.equal(error, timeouts[0]);
						assert.equal(error.message, 'uplot: timed out after 0.02s');
						assert.equal(error.code, 'BENCHMARK_SAMPLE_TIMEOUT');
						assert.equal(error.variant, 'uplot');
						assert.equal(error.timeoutMs, 20);
						return true;
					});
				}
				finally {
					Object.assign(console, originalConsole);
				}
				assert.equal(timeouts.length, 1);
				assert.deepEqual(callbackClosedStates, [[false, false]], 'notify parent before closing CDP');
				assert.equal(sockets.length, 2);
				assert.ok(sockets.every(socket => socket.closed));
				assert.ok(calls.some(call => call.method === 'Tracing.start'));
				assert.ok(!calls.some(call => call.method === 'Tracing.end' || call.method.startsWith('IO.') || call.params.expression === 'benchmarkLifecycle.destroy()'));
				assert.deepEqual(await readdir(dir), ['DevToolsActivePort']);
				assert.deepEqual(output, []);
			});
		});
	}

	for (const stuck of [false, true]) {
		it(`resets queued rAF boundaries and ${stuck ? 'times out a stuck evaluation' : 'disposes the watchdog after success'}`, async () => {
			let entered;
			const evaluating = new Promise(resolve => { entered = resolve; });
			await withCaptureSocket((socket, id, expression) => {
				if (expression !== 'globalThis.runBenchmarkTrace({raf: true})')
					return false;
				entered({socket, id});
				return true;
			}, async ({dir, calls, sockets, capture}) => {
				const timeouts = [];
				const capturePromise = capture({trace: false, raf: true, sampleTimeoutMs: 100, onSampleTimeout: error => timeouts.push(error)});
				const completion = stuck ? assert.rejects(capturePromise, error => {
					assert.equal(error, timeouts[0]);
					assert.equal(error.message, 'chartjs: timed out after 0.1s');
					return true;
				}) : capturePromise;
				const {socket, id} = await evaluating;
				assert.equal(socket.messageListeners.size, 3);
				assert.ok(calls.findIndex(call => call.method === 'Runtime.addBinding') < calls.findIndex(call => call.method === 'Page.navigate'));
				assert.deepEqual(calls.filter(call => call.method === 'Runtime.addBinding').map(call => call.params.name), ['benchmarkMouseInput', 'benchmarkSampleBoundary']);
				assert.ok(calls.findIndex(call => call.method === 'Page.addScriptToEvaluateOnNewDocument') < calls.findIndex(call => call.method === 'Page.navigate'));
				// Adjacent end/start notifications arrive in one turn. Total run time exceeds a sample budget.
				for (let i = 0; i < 4; i++) {
					socket.boundary('start');
					await delay(40);
					socket.boundary('end');
				}
				if (stuck) {
					socket.boundary('start', 'chartjs');
					for (const payload of ['{', 'null', '{}', '{"phase":"end"}', '{"phase":"end","variant":3}'])
						socket.message({method: 'Runtime.bindingCalled', params: {name: 'benchmarkSampleBoundary', payload}});
					socket.message({method: 'Runtime.bindingCalled', params: {name: 'otherBinding', payload: '{"phase":"end","variant":"chartjs"}'}});
					socket.message({method: 'unrelated', params: {name: 'benchmarkSampleBoundary', payload: '{"phase":"end","variant":"chartjs"}'}});
					socket.boundary('end', 'uplot');
					socket.boundary('start', 'idle');
				}
				else
					socket.message({id, result: {result: {value: {samples: [], raf: {enabled: true}}}}});
				const report = await completion;
				assert.ok(sockets.every(socket => socket.closed));
				assert.equal(socket.messageListeners.size, 1, 'remove the boundary listener');
				if (!stuck) {
					assert.equal(report.sampleTimeoutMs, 100);
					assert.equal(report.trace, null);
					// Neither a stale timer nor events after disposal can time out the finished capture.
					socket.boundary('start');
					await delay(120);
				}
				assert.equal(timeouts.length, stuck ? 1 : 0);
				assert.equal(calls.filter(call => call.params.expression === 'globalThis.runBenchmarkTrace({raf: true})').length, 1);
				assert.ok(!calls.some(call => /^(Tracing\.|IO\.|HeapProfiler\.)/.test(call.method) || call.params.expression?.startsWith('benchmarkLifecycle.')));
				assert.deepEqual(await readdir(dir), ['DevToolsActivePort']);
			});
		});
	}

	it('stops an active rAF watchdog on ordinary evaluation failure', async () => {
		await withCaptureSocket((socket, id, expression) => {
			if (expression !== 'globalThis.runBenchmarkTrace({raf: true})')
				return false;
			socket.boundary('start');
			socket.message({id, result: {exceptionDetails: {text: 'construction failed'}}});
			return true;
		}, async ({capture, sockets}) => {
			const timeouts = [];
			await assert.rejects(capture({trace: false, raf: true, sampleTimeoutMs: 20, onSampleTimeout: error => timeouts.push(error)}), /construction failed/);
			assert.ok(sockets.every(socket => socket.closed));
			assert.equal(sockets[1].messageListeners.size, 1);
			await delay(40);
			assert.deepEqual(timeouts, []);
		});
	});

	it('still ends tracing on an ordinary sample failure', async () => {
		await withCaptureSocket((socket, id, expression) => {
			if (expression !== 'benchmarkLifecycle.prepare()')
				return false;
			socket.message({id, result: {exceptionDetails: {text: 'preparation failed'}}});
			return true;
		}, async ({capture, calls, sockets}) => {
			await assert.rejects(capture({}), /preparation failed/);
			assert.ok(calls.some(call => call.params.expression === 'benchmarkLifecycle.destroy()'));
			assert.equal(calls.filter(call => call.method === 'Tracing.end').length, 1);
			assert.ok(sockets.every(socket => socket.closed));
		});
	});

	it('reports the default timeout and installs trusted mouse input before normal capture navigation', async () => {
		await withCaptureSocket(() => false, async ({capture, calls, sockets}) => {
			const report = await capture({trace: false});
			assert.equal(report.sampleTimeoutMs, SAMPLE_TIMEOUT_MS);
			const binding = calls.findIndex(call => call.method === 'Runtime.addBinding' && call.params.name === 'benchmarkMouseInput');
			const script = calls.findIndex(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' && call.params.source.includes('benchmarkMoveMouse'));
			const navigation = calls.findIndex(call => call.method === 'Page.navigate');
			assert.ok(binding >= 0 && binding < script && script < navigation);
			assert.equal(sockets[1].messageListeners.size, 1, 'remove the mouse listener after capture');
		});
	});
});

describe('compressed benchmark trace capture', () => {
	it('saves only exact gzip bytes, reports disk size, and still rejects Chrome data loss', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'bench-trace-capture-'));
		const originalSocket = globalThis.WebSocket;
		const originalFetch = globalThis.fetch;
		const raw = JSON.stringify({traceEvents: [...metadata, ...markers(), {name: 'InvalidateLayout', ph: 'I', ts: 12345}]});
		const compressed = gzipSync(raw);
		const calls = [];
		let dataLoss = false;
		let offset = 0;
		class Socket extends EventTarget {
			constructor() {
				super();
				queueMicrotask(() => this.dispatchEvent(new Event('open')));
			}
			message(message) {
				this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(message)}));
			}
			send(text) {
				const {id, method, params} = JSON.parse(text);
				calls.push({method, params});
				let result = {};
				if (method === 'Tracing.end')
					this.message({method: 'Tracing.tracingComplete', params: {stream: 'gzip-stream', dataLossOccurred: dataLoss}});
				if (method === 'IO.read') {
					const end = Math.min(offset + 17, compressed.length);
					result = {data: compressed.subarray(offset, end).toString('base64'), base64Encoded: true, eof: end === compressed.length};
					offset = end;
				}
				if (method === 'Runtime.evaluate') {
					let value = true;
					if (params.expression === 'benchmarkLifecycle.begin()')
						value = {config: {variants: ['uplot'], dpr: 1, warmups: 0, rounds: 1}};
					if (params.expression === 'benchmarkLifecycle.construct()')
						value = sample();
					result = {result: {value}};
				}
				this.message({id, result});
			}
			close() { this.dispatchEvent(new Event('close')); }
		}
		try {
			await writeFile(join(dir, 'DevToolsActivePort'), '1234\n/devtools/browser/test');
			globalThis.WebSocket = Socket;
			globalThis.fetch = async () => ({json: async () => [{type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1234/page'}]});
			for (const traceName of [undefined, 'custom.json', 'already.json.gz']) {
				offset = 0;
				const report = await captureBenchmarkTrace({profile: dir, cache: dir, url: 'http://127.0.0.1:1234/bench', traceName});
				const name = traceName === undefined ? 'trace-chrome.json.gz' : traceName.endsWith('.gz') ? traceName : traceName + '.gz';
				assert.equal(report.sampleTimeoutMs, SAMPLE_TIMEOUT_MS);
				assert.equal(report.trace.path, join(dir, name));
				assert.equal(report.trace.compression, 'gzip');
				assert.equal(report.trace.bytes, compressed.length);
				assert.equal(report.trace.compressedBytes, (await stat(report.trace.path)).size);
				assert.equal(report.trace.dataLoss, false);
				assert.deepEqual(await readFile(report.trace.path), compressed);
				assert.deepEqual(await readdir(dir), ['DevToolsActivePort', name].sort());
				assert.deepEqual(await analyzeBenchmarkTraceFile(report.trace.path, report), analyzeBenchmarkTrace(JSON.parse(raw), report));
				await rm(report.trace.path);
			}
			for (const call of calls.filter(call => call.method === 'Tracing.start')) {
				assert.equal(call.params.streamCompression, 'gzip');
				assert.equal(call.params.transferMode, 'ReturnAsStream');
				assert.equal(call.params.streamFormat, 'json');
				assert.equal(call.params.traceConfig.recordMode, 'recordUntilFull');
				assert.equal(call.params.traceConfig.traceBufferSizeInKb, 128 * 1024);
			}
			assert.equal(calls.filter(call => call.method === 'IO.close').length, 3);
			dataLoss = true;
			offset = 0;
			await assert.rejects(captureBenchmarkTrace({profile: dir, cache: dir, url: 'http://127.0.0.1:1234/bench'}), /Chrome lost trace data/);
		}
		finally {
			globalThis.WebSocket = originalSocket;
			globalThis.fetch = originalFetch;
			await rm(dir, {recursive: true, force: true});
		}
	});
});
