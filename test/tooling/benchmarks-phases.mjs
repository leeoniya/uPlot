import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {smallLifecycleData} from '../../bench/lifecycle-data.mjs';
import {benchmarkTimingSamples, benchmarkOperations, lifecycleOperations, dashboardWorkload} from '../../scripts/benchmarks-phases.mjs';
import {analyzeBenchmarkTrace} from '../../scripts/analyze-benchmarks-trace.mjs';
import {summarizeBenchmarkRaf} from '../../scripts/analyze-benchmarks-raf.mjs';
import {benchmarkVariants} from '../../bench/demo-dependencies.mjs';
import {TRACE_ACCOUNTING} from '../../scripts/bench-trace-policy.mjs';

const resizeOperations = ['small-init', 'data-update', 'resize'];

function fixture(warmup = false, dashboard = true, variant = 'uplot') {
	const metadata = {phase: 'chart-population', initProtocol: 'settled-work-v1', trace: {accountingProtocol: TRACE_ACCOUNTING},
		...(dashboard ? {workload: {...dashboardWorkload}, lifecycle: {operations: ['small-init', 'data-update']}} : {
			resizeProtocol: 'retained-resize-v1',
			lifecycle: {operations: lifecycleOperations, resizeSize: {width: 1200, height: 400}},
			hoverProtocol: 'hover-ten-v3', hover: {variants: ['idle', 'uplot'], count: 10, intervalMs: 50},
		})};
	const phases = benchmarkOperations(metadata).filter(operation => operation !== 'hover-10' || metadata.hover.variants.includes(variant)).map((operation, index) => ({
		id: `sample-${index}`, variant, dpr: 1, round: warmup ? -1 : 0,
		operation, warmup,
		jsMs: index + 1, dataPrepMs: 0.5, windowMs: 10, raf1Ms: index + 2,
	}));
	const report = {...metadata, samples: [{...phases.findLast(phase => phase.operation === 'data-update'), phases}]};
	const events = [{ph: 'M', name: 'thread_name', pid: 1, tid: 1, args: {name: 'CrRendererMain'}}];
	phases.forEach((sample, index) => {
		const start = index * 20000;
		for (const [name, ts] of [['start', start], ['js-end', start + sample.jsMs * 1000], ['end', start + 10000]])
			events.push({name: `benchmark:${sample.id}:${name}`, ph: 'I', cat: 'blink.user_timing', ts, pid: 1, tid: 1});
		events.push({name: 'RunTask', ph: 'X', ts: start, dur: (index + 1) * 1000, pid: 1, tid: 1});
	});
	return {report, events};
}

describe('benchmark population phases', () => {
	it('includes post-readiness layout, paint, raster and compositor work without counting idle gaps', () => {
		const {report, events} = fixture();
		events.push({ph: 'M', name: 'process_name', pid: 2, args: {name: 'GPU Process'}});
		for (const [pid, tid, name] of [[1, 2, 'CompositorTileWorker1'], [1, 3, 'Compositor'], [2, 1, 'CrGpuMain'], [2, 2, 'VizCompositorThread']])
			events.push({ph: 'M', name: 'thread_name', pid, tid, args: {name}});
		for (const [pid, tid, name, ts, dur] of [
			[1, 1, 'RunTask', 2000, 3000], [1, 1, 'Layout', 2200, 1000], [1, 1, 'Paint', 3500, 1000],
			[1, 2, 'RasterTask', 5000, 1000], [1, 3, 'RunTask', 6500, 500],
			[2, 1, 'RunTask', 6000, 2000], [2, 2, 'RunTask', 8500, 500],
			// Outside initialization and before the update: no attribution to either phase.
			[1, 1, 'RunTask', 11000, 5000],
		]) events.push({ph: 'X', pid, tid, name, ts, dur});
		const analysis = analyzeBenchmarkTrace(events, report);
		const init = analysis.phaseGroups.find(group => group.operation === 'small-init').metrics;
		assert.equal(init.jsIntervalMs.min, 1);
		assert.equal(init.rendererMainTaskMs.min, 4);
		assert.equal(init.styleLayoutPaintMs.min, 2);
		assert.equal(init.rasterWorkerMs.min, 1);
		assert.equal(init.gpuMainTaskMs.min, 2);
		assert.equal(init.totalTrackedThreadWorkMs.min, 8);
		assert.equal(init.traceWindowMs.min, 10);
		assert.equal(analysis.groups[0].metrics.totalTrackedThreadWorkMs.min, 2);
	});

	it('attributes two windows independently and keeps totals on the full-data update', () => {
		const {report, events} = fixture();
		const trace = analyzeBenchmarkTrace(events, report);
		assert.equal(trace.samples.length, 2);
		assert.equal(trace.groups.length, 1);
		assert.equal(trace.groups[0].operation, 'data-update');
		assert.equal(trace.groups[0].metrics.totalTrackedThreadWorkMs.min, 2);
		assert.deepEqual(trace.phaseGroups.map(group => group.operation), ['small-init', 'data-update']);
		assert.deepEqual(trace.phaseGroups.map(group => group.metrics.totalTrackedThreadWorkMs.min), [1, 2]);
		assert.deepEqual(trace.phaseGroups.map(group => group.sampleCount), [1, 1]);
		const raf = summarizeBenchmarkRaf(report);
		assert.equal(raf.groups[0].metrics.jsMs.min, 2);
		assert.deepEqual(raf.phaseGroups.map(group => group.metrics.jsMs.min), [1, 2]);
	});

	it('accounts for the complete resize window without moving update metrics or counting idle gaps', () => {
		const {report, events} = fixture(false, false, 'd3');
		report.trace = {accountingProtocol: TRACE_ACCOUNTING};
		events.push({ph: 'M', name: 'process_name', pid: 2, args: {name: 'GPU Process'}});
		for (const [pid, tid, name] of [[1, 2, 'CompositorTileWorker1'], [1, 3, 'Compositor'], [2, 1, 'CrGpuMain'], [2, 2, 'VizCompositorThread']])
			events.push({ph: 'M', name: 'thread_name', pid, tid, args: {name}});
		for (const [pid, tid, name, ts, dur] of [
			// Readiness ends at 43 ms. Deferred work must still enter resize totals.
			[1, 1, 'RunTask', 44000, 2000], [1, 1, 'Layout', 44000, 500], [1, 1, 'Paint', 44500, 500],
			[1, 2, 'RasterTask', 46000, 2000], [1, 2, 'CppGC.ConcurrentMark', 47000, 2000],
			[1, 3, 'RunTask', 49000, 500], [2, 1, 'RunTask', 46000, 2000],
			[2, 1, 'GPUTask', 46500, 1000], [2, 2, 'RunTask', 49500, 1000],
			// Before resize and after its end are not part of its total.
			[1, 1, 'RunTask', 35000, 4000], [1, 1, 'RunTask', 51000, 5000],
		]) events.push({ph: 'X', pid, tid, name, ts, dur});
		const original = structuredClone(report);
		const trace = analyzeBenchmarkTrace(events, report);
		assert.deepEqual(trace.phaseGroups.map(group => group.operation), resizeOperations);
		assert.deepEqual(trace.samples.map(sample => sample.id), ['sample-0', 'sample-1', 'sample-2']);
		assert.equal(trace.groups.length, 1);
		assert.equal(trace.groups[0].operation, 'data-update');
		assert.equal(trace.groups[0].metrics.totalTrackedThreadWorkMs.mean, 2);
		const resize = trace.phaseGroups[2].metrics;
		for (const [key, value] of Object.entries({jsIntervalMs: 3, traceWindowMs: 10,
			rendererMainTaskMs: 5, styleLayoutPaintMs: 1, rasterWorkerMs: 2, rendererCompositorMs: 0.5,
			gpuMainTaskMs: 2, vizCompositorMs: 0.5, GPUTaskMs: 1, backgroundGcMs: 2, gcAddedThreadWorkMs: 1,
			totalTrackedThreadWorkMs: 11, trackedBusyElapsedMs: 9,
		})) assert.equal(resize[key].mean, value, key);
		assert.equal(resize.hardwareGpuMs.mean, null);
		assert.equal(trace.diagnostics.boundaries[2].crossingEndEvents, 1);
		assert.equal(trace.diagnostics.boundaries[2].tailTrackedThreadWorkMs, 5.5);
		const raf = summarizeBenchmarkRaf(report);
		assert.deepEqual(raf.phaseGroups.map(group => group.operation), resizeOperations);
		assert.equal(raf.groups[0].metrics.raf1Ms.min, 3);
		assert.equal(raf.phaseGroups[2].metrics.raf1Ms.min, 4);
		assert.equal(raf.phaseGroups[2].metrics.jsMs.min, 3);
		assert.equal(Object.hasOwn(raf.phaseGroups[2].metrics, 'totalTrackedThreadWorkMs'), false);
		assert.deepEqual(report, original);
	});

	it('excludes all three phases of resize warmup sessions', () => {
		const {report, events} = fixture(true, false, 'd3');
		for (const analysis of [analyzeBenchmarkTrace(events, report), summarizeBenchmarkRaf(report)]) {
			assert.deepEqual(analysis.phaseGroups.map(group => group.sampleCount), [0, 0, 0]);
			assert.deepEqual(analysis.phaseGroups.map(group => group.warmupCount), [1, 1, 1]);
			assert.equal(analysis.groups.length, 1);
		}
	});

	it('requires the resize protocol, distinct phase IDs, and update-scoped session fields', () => {
		for (const change of [
			r => delete r.resizeProtocol,
			r => r.resizeProtocol = 'unknown',
			r => r.resizeProtocol = null,
			r => delete r.initProtocol,
			r => r.samples[0].phases.pop(),
			r => r.samples[0].phases.reverse(),
			r => r.samples[0].phases[2].id = r.samples[0].phases[1].id,
			r => r.samples[0].phases[2].round++,
			r => Object.assign(r.samples[0], r.samples[0].phases[2]),
		]) {
			const {report, events} = fixture(false, false, 'd3');
			change(report);
			assert.throws(() => benchmarkTimingSamples(report), /Lifecycle|lifecycle|session/);
			assert.throws(() => summarizeBenchmarkRaf(report), /Lifecycle|lifecycle|session/);
			assert.throws(() => analyzeBenchmarkTrace(events, report), /Lifecycle|lifecycle|session/);
		}
	});

	it('excludes both phases of warmup sessions', () => {
		const {report, events} = fixture(true);
		assert.deepEqual(analyzeBenchmarkTrace(events, report).phaseGroups.map(group => group.sampleCount), [0, 0]);
		assert.deepEqual(summarizeBenchmarkRaf(report).phaseGroups.map(group => group.sampleCount), [0, 0]);
	});

	it('rejects incomplete, reordered, mislabeled or mismatched phase records', () => {
		for (const change of [
			r => r.samples[0].phases.pop(),
			r => r.samples[0].phases.reverse(),
			r => r.samples[0].phases[0].warmup = true,
			r => r.samples[0].phases[1].variant = 'plotly',
			r => r.samples[0].phases[1].round = 2,
			r => r.samples[0].id = 'sample-0',
			...['unknown', null].map(value => r => r.phase = value),
		]) {
			const {report} = fixture();
			change(report);
			assert.throws(() => benchmarkTimingSamples(report), /Lifecycle|lifecycle|session/);
		}
	});

	it('preserves flat samples for internal analyzer calls', () => {
		const report = {samples: [{id: 'sample-0'}]};
		assert.equal(benchmarkOperations(report), null);
		assert.equal(benchmarkTimingSamples(report), report.samples);
		assert.throws(() => benchmarkOperations({samples: [{phases: []}]}), /Lifecycle/);
		for (const key of ['phase', 'initProtocol', 'resizeProtocol', 'hoverProtocol', 'hover', 'lifecycle', 'operations', 'workload'])
			assert.throws(() => benchmarkOperations({...report, [key]: undefined}), /Lifecycle/);
	});
});

describe('optional hover phases', () => {
	it('preserves current reports and describes batched hover dispatch', () => {
		const {report, events} = fixture(false, false);
		report.samples[0].phases[3].hover = {count: 10, intervalMs: 50};
		const original = structuredClone(report);
		for (const analysis of [analyzeBenchmarkTrace(events, report), summarizeBenchmarkRaf(report)]) {
			assert.deepEqual(analysis.phaseGroups.map(group => group.operation), lifecycleOperations);
			assert.match(analysis.definitions.hover, /hover-ten-v3.*all ten coordinate targets through one browser binding/);
			assert.match(analysis.definitions.hover, /one browser Runtime.evaluate completion acknowledgment/);
		}
		assert.deepEqual(report, original);
	});

	it('requires a numeric 50 ms interval in both analyzers', () => {
		for (const intervalMs of [undefined, null, '50', 0, 49, 51, NaN, Infinity]) {
			const {report, events} = fixture(false, false);
			if (intervalMs === undefined) delete report.hover.intervalMs;
			else report.hover.intervalMs = intervalMs;
			for (const analyze of [benchmarkTimingSamples, summarizeBenchmarkRaf, r => analyzeBenchmarkTrace(events, r)])
				assert.throws(() => analyze(report), /hover-ten-v3.*intervalMs 50/);
		}
	});
	it('keeps canonical operations but requires no hover markers or samples for unsupported variants', () => {
		assert.deepEqual(lifecycleOperations, ['small-init', 'data-update', 'resize', 'hover-10']);
		for (const variant of ['idle', 'uplot', 'd3']) {
			const {report, events} = fixture(false, false, variant);
			const operations = variant === 'd3' ? resizeOperations : lifecycleOperations;
			assert.deepEqual(benchmarkOperations(report), lifecycleOperations);
			assert.deepEqual(benchmarkTimingSamples(report).map(sample => sample.operation), operations);
			for (const analysis of [analyzeBenchmarkTrace(events, report), summarizeBenchmarkRaf(report)]) {
				assert.deepEqual(analysis.phaseGroups.map(group => group.operation), operations);
				assert.equal(analysis.groups.length, 1);
				assert.equal(analysis.groups[0].metrics[analysis.samples ? 'jsIntervalMs' : 'jsMs'].min, 2);
			}
		}
	});

	it('requires hover markers for supported variants and distinct IDs across sessions', () => {
		const {report, events} = fixture(false, false);
		assert.throws(() => analyzeBenchmarkTrace(events.filter(event => !event.name.startsWith('benchmark:sample-3:')), report), /marker/i);
		const duplicate = structuredClone(report.samples[0]);
		duplicate.round++;
		for (const phase of duplicate.phases) phase.round++;
		report.samples.push(duplicate);
		assert.throws(() => benchmarkTimingSamples(report), /distinct ids/);
	});

	it('filters hover support per session in a report with multiple variants', () => {
		const {report} = fixture(false, false);
		const unsupported = fixture(false, false, 'd3').report.samples[0];
		unsupported.id = `d3-${unsupported.id}`;
		for (const phase of unsupported.phases) phase.id = `d3-${phase.id}`;
		report.samples.push(unsupported);
		assert.equal(benchmarkTimingSamples(report).length, 7);
		const analysis = summarizeBenchmarkRaf(report);
		assert.equal(analysis.groups.length, 2);
		assert.deepEqual(analysis.phaseGroups.filter(group => group.operation === 'hover-10').map(group => group.variant), ['uplot']);
	});

	it('includes deferred hover work and clips a single cumulative window without changing update totals', () => {
		const {report, events} = fixture(false, false);
		report.trace = {accountingProtocol: TRACE_ACCOUNTING};
		events.push({ph: 'M', name: 'process_name', pid: 2, args: {name: 'GPU Process'}});
		for (const [pid, tid, name] of [[1, 2, 'CompositorTileWorker1'], [1, 3, 'Compositor'], [2, 1, 'CrGpuMain'], [2, 2, 'VizCompositorThread']])
			events.push({ph: 'M', name: 'thread_name', pid, tid, args: {name}});
		for (const [pid, tid, name, ts, dur] of [
			// Hover readiness ends at 64 ms. The window ends at 70 ms.
			[1, 1, 'RunTask', 59000, 2000], [1, 1, 'RunTask', 65000, 2000],
			[1, 1, 'Layout', 65000, 500], [1, 1, 'Paint', 65500, 500],
			[1, 2, 'RasterTask', 65000, 2000], [1, 2, 'CppGC.ConcurrentMark', 66000, 2000],
			[1, 3, 'RunTask', 68000, 500], [2, 1, 'RunTask', 66000, 2000],
			[2, 1, 'GPUTask', 66500, 1000], [2, 2, 'RunTask', 69500, 1000],
			[1, 1, 'RunTask', 71000, 5000],
		]) events.push({ph: 'X', pid, tid, name, ts, dur});
		const original = structuredClone(report);
		const trace = analyzeBenchmarkTrace(events, report);
		const hover = trace.phaseGroups.find(group => group.operation === 'hover-10').metrics;
		for (const [key, value] of Object.entries({jsIntervalMs: 4, traceWindowMs: 10,
			rendererMainTaskMs: 6, styleLayoutPaintMs: 1, rasterWorkerMs: 2, rendererCompositorMs: 0.5,
			gpuMainTaskMs: 2, vizCompositorMs: 0.5, GPUTaskMs: 1, backgroundGcMs: 2, gcAddedThreadWorkMs: 1,
			totalTrackedThreadWorkMs: 12, trackedBusyElapsedMs: 8,
		})) assert.equal(hover[key].mean, value, key);
		assert.equal(trace.diagnostics.boundaries[3].crossingStartEvents, 1);
		assert.equal(trace.diagnostics.boundaries[3].crossingEndEvents, 1);
		assert.equal(trace.diagnostics.boundaries[3].tailTrackedThreadWorkMs, 5.5);
		assert.equal(trace.groups[0].metrics.totalTrackedThreadWorkMs.mean, 2);
		const raf = summarizeBenchmarkRaf(report);
		assert.equal(raf.phaseGroups[3].metrics.raf1Ms.min, 5);
		assert.equal(raf.groups[0].metrics.raf1Ms.min, 3);
		assert.deepEqual(report, original);
	});

	it('keeps 450 ms of hover spacing in wall latency but out of tracked thread work', () => {
		const {report, events} = fixture(false, false);
		const phase = report.samples[0].phases[3];
		Object.assign(phase, {jsMs: 460, raf1Ms: 470, windowMs: 675});
		for (const event of events) {
			if (event.name === `benchmark:${phase.id}:js-end`) event.ts = 520000;
			if (event.name === `benchmark:${phase.id}:end`) event.ts = 735000;
		}
		const spaced = events.filter(event => !(event.name === 'RunTask' && event.ts === 60000));
		for (let i = 0; i < 10; i++)
			spaced.push({name: 'RunTask', ph: 'X', ts: 60000 + i * 51000, dur: 1000, pid: 1, tid: 1});
		const trace = analyzeBenchmarkTrace(spaced, report);
		const hover = trace.phaseGroups[3].metrics;
		assert.equal(hover.jsIntervalMs.mean, 460);
		assert.equal(hover.traceWindowMs.mean, 675);
		assert.equal(hover.totalTrackedThreadWorkMs.mean, 10);
		assert.equal(trace.groups[0].metrics.totalTrackedThreadWorkMs.mean, 2);
		const raf = summarizeBenchmarkRaf(report);
		assert.equal(raf.phaseGroups[3].metrics.raf1Ms.min, 470);
		assert.equal(raf.groups[0].metrics.raf1Ms.min, 3);
		for (const analysis of [trace, raf]) {
			assert.match(analysis.definitions.hover, /No value verification or harness DOM\/canvas reads/);
			assert.match(analysis.definitions.hover, /reduces input-bridge overhead but does not eliminate it/);
			assert.match(analysis.definitions.hover, /Node scheduling is outside measured browser threads/);

			assert.match(analysis.definitions.hover, /never runs during capture or preflight/);
		}
	});

	it('excludes hover warmups and preserves measured zero', () => {
		for (const warmup of [false, true]) {
			const {report, events} = fixture(warmup, false);
			report.samples[0].phases[3].raf1Ms = 0;
			const trace = analyzeBenchmarkTrace(events.filter(event => !(event.name === 'RunTask' && event.ts === 60000)), report);
			const raf = summarizeBenchmarkRaf(report);
			assert.equal(trace.phaseGroups[3].metrics.totalTrackedThreadWorkMs.mean, warmup ? null : 0);
			assert.equal(raf.phaseGroups[3].metrics.raf1Ms.min, warmup ? null : 0);
			for (const analysis of [trace, raf]) {
				assert.deepEqual(analysis.phaseGroups.map(group => group.sampleCount), Array(4).fill(warmup ? 0 : 1));
				assert.deepEqual(analysis.phaseGroups.map(group => group.warmupCount), Array(4).fill(warmup ? 1 : 0));
			}
		}
	});

	it('validates capability metadata, ten-count protocol, distinct IDs and update-scoped sessions', () => {
		for (const change of [
			r => delete r.hoverProtocol, ...['unknown', null].map(value => r => r.hoverProtocol = value),
			r => delete r.hover, r => r.hover = null, r => r.hover.count = 9, r => r.hover.count = 11, r => r.hover.count = '10',
			r => r.hover.variants = null, r => r.hover.variants = [], r => r.hover.variants = ['uplot'],
			r => r.hover.variants.push('idle'), r => r.hover.variants.push(''), r => r.hover.variants.push(1),
			r => r.hover.variants.push(' uplot'), r => delete r.resizeProtocol, r => delete r.initProtocol,
			r => r.phase = 'unknown', r => r.samples[0].phases.pop(),
			r => r.hover.variants = ['idle'], r => r.samples[0].phases.reverse(),
			r => r.samples[0].phases[3].id = r.samples[0].phases[2].id,
			r => r.samples[0].phases[3].warmup = true,
			r => Object.assign(r.samples[0], r.samples[0].phases[3]),
		]) {
			const {report, events} = fixture(false, false);
			change(report);
			for (const analyze of [benchmarkTimingSamples, summarizeBenchmarkRaf, r => analyzeBenchmarkTrace(events, r)])
				assert.throws(() => analyze(report), /[Ll]ifecycle|session/);
		}

	});
});

describe('small lifecycle input', () => {
	const packed = [7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free'];
	for (let i = 0; i < 8; i++) packed.push(28000000 + i, 50 + i, 1, 3 + i, 2, 25, 75);
	Object.freeze(packed);

	it('selects exactly the first and last rows without changing the fixture', () => {
		const small = smallLifecycleData(packed);
		assert.deepEqual(small, [...packed.slice(0, 15), ...packed.slice(-7)]);
		assert.equal(small.length, 22);
		assert.equal(small[8], packed[8]);
		assert.equal(small[15], packed.at(-7));
		small[8] = 0;
		assert.equal(packed[8], 28000000);
		assert.deepEqual(smallLifecycleData(packed), smallLifecycleData(packed));
	});

	it('rejects incomplete headers or fewer than two complete rows', () => {
		for (const input of [[], [0], [1.5], packed.slice(0, 8), packed.slice(0, 15), packed.slice(0, -1)])
			assert.throws(() => smallLifecycleData(input), /at least two complete rows/);
	});

	for (const id of benchmarkVariants) it(`${id}: prepares small and full inputs without changing the fixture`, async () => {
		const oldDpr = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
		const {time, timeEnd} = console;
		try {
			Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 1});
			console.time = console.timeEnd = () => {};
			const source = await import(`../../bench/${id}.mjs`);
			assert.equal(typeof (source.makeLifecycleChart ?? source.makeChart), 'function');
			assert.equal(typeof source.updateChart, 'function');
			const small = Object.freeze(smallLifecycleData(packed));
			const a = source.prepData(small);
			const b = source.prepData(packed);
			assert.notDeepEqual(a, b);
			assert.deepEqual(source.prepData(packed), b);
		}
		finally {
			console.time = time;
			console.timeEnd = timeEnd;
			if (oldDpr === undefined) delete globalThis.devicePixelRatio;
			else Object.defineProperty(globalThis, 'devicePixelRatio', oldDpr);
		}
	});
});
