import assert from 'node:assert/strict';
import { analyzeBenchmarkTrace } from '../scripts/analyze-benchmarks-trace.mjs';

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
			assert.deepEqual(result.groups[0].metrics[metric], {median: value, min: value, max: value, count: 1, missing: 0});
		assert.throws(() => analyze(events, [sample(0, {...prep, jsMs: prep.prepAndInitMs})]), /duration mismatch/);
		assert.throws(() => analyze(events, [sample(0, prep)], markers().slice(1)), /Missing marker/);
	});

	it('reports missing prep metrics as null for legacy reports without deriving them', () => {
		const result = analyze();
		for (const metric of ['dataPrepMs', 'prepAndInitMs'])
			assert.deepEqual(result.groups[0].metrics[metric], {median: null, min: null, max: null, count: 0, missing: 1});
		const partial = analyze([], [sample(0, {dataPrepMs: 3})]);
		assert.deepEqual(partial.groups[0].metrics.prepAndInitMs, {median: null, min: null, max: null, count: 0, missing: 1});
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
			assert.deepEqual(main.metrics[metric], {median: 4, min: 0, max: 8, count: 3, missing: 8});
			assert.deepEqual(idle.metrics[metric], {median: 100, min: 100, max: 100, count: 1, missing: 0});
			assert.deepEqual(dpr2.metrics[metric], {median: 20, min: 20, max: 20, count: 1, missing: 0});
			assert.equal(warmupOnly.warmupCount, 1);
			assert.deepEqual(warmupOnly.metrics[metric], {median: null, min: null, max: null, count: 0, missing: 0});
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
			assert.deepEqual(result.groups[0].metrics[metric], {median: null, min: null, max: null, count: 0, missing: 1});
		}
		assert.equal(result.diagnostics.eventTypes.GPUTask.available, false);
		assert.ok(result.diagnostics.missingEventTypes.includes('GPUTask'));
		assert.equal(result.diagnostics.availabilityBySample[0].GPUTaskMs, false);
		const available = analyze([interval('GPUTask', 20, 21, 2, 1)]);
		assert.equal(available.samples[0].GPUTaskMs, 0);
		assert.equal(available.samples[0].hardwareGpuMs, null);
	});

	it('does not treat event availability in another renderer as sample availability', () => {
		const result = analyze([interval('RunTask', 0, 10, 3, 1), interval('RasterTask', 0, 10, 3, 3)]);
		assert.equal(result.diagnostics.eventTypes.RunTask.available, true);
		assert.equal(result.diagnostics.eventTypes.RasterTask.available, true);
		assert.equal(result.samples[0].rendererMainTaskMs, null);
		assert.equal(result.samples[0].rasterWorkerMs, null);
	});

	it('excludes warmups from medians and extrema, groups DPR separately, and never subtracts idle', () => {
		const samples = [sample(0, {warmup: true}), sample(1), sample(2), sample(3, {variant: 'idle'}), sample(4, {dpr: 2}), sample(5, {dpr: 3, warmup: true})];
		const result = analyze([8, 2, 4, 1, 5, 9].map((duration, i) => interval('RunTask', i * 20, i * 20 + duration)), samples, samples.flatMap((_, i) => markers(i, i * 20)));
		assert.equal(result.samples.length, 6);
		const [main, idle, dpr2, warmupOnly] = result.groups;
		assert.equal(main.warmupCount, 1);
		assert.equal(main.sampleCount, 2);
		assert.deepEqual(main.sampleIds, ['sample-1', 'sample-2']);
		assert.deepEqual(main.metrics.rendererMainTaskMs, {median: 3, min: 2, max: 4, count: 2, missing: 0});
		assert.equal(idle.variant, 'idle');
		assert.equal(idle.metrics.rendererMainTaskMs.median, 1);
		assert.equal(dpr2.metrics.rendererMainTaskMs.median, 5);
		assert.equal(warmupOnly.sampleCount, 0);
		assert.equal(warmupOnly.metrics.rendererMainTaskMs.median, null);
	});

	it('uses the middle value for odd groups and reports null counts', () => {
		const samples = [sample(0), sample(1), sample(2)];
		const result = analyze([1, 9, 3].map((duration, i) => interval('RunTask', i * 20, i * 20 + duration)), samples, samples.flatMap((_, i) => markers(i, i * 20)));
		assert.equal(result.groups[0].metrics.rendererMainTaskMs.median, 3);
		assert.equal(result.groups[0].metrics.GPUTaskMs.missing, 3);
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
