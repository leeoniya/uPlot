import assert from 'node:assert/strict';
import {smallLifecycleData} from '../../bench/lifecycle-data.mjs';
import {benchmarkTimingSamples, benchmarkOperations, lifecycleOperations} from '../../scripts/benchmarks-phases.mjs';
import {analyzeBenchmarkTrace} from '../../scripts/analyze-benchmarks-trace.mjs';
import {summarizeBenchmarkRaf} from '../../scripts/analyze-benchmarks-raf.mjs';
import {benchmarkVariants} from '../../bench/demo-dependencies.mjs';

function fixture(phase = 'chart-population', warmup = false) {
	const phases = benchmarkOperations({phase}).map((operation, index) => ({
		id: `sample-${index}`, variant: 'uplot', dpr: 1, round: warmup ? -1 : 0,
		operation, warmup: warmup || operation === 'warmup-update',
		jsMs: index + 1, dataPrepMs: 0.5, windowMs: 10, raf1Ms: index + 2,
	}));
	const report = {phase, samples: [{...phases.at(-1), phases}]};
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
	it('attributes two windows independently and keeps totals on the full-data update', () => {
		const {report, events} = fixture();
		const trace = analyzeBenchmarkTrace(events, report);
		assert.equal(trace.samples.length, 2);
		assert.equal(trace.groups.length, 1);
		assert.equal(trace.groups[0].operation, 'data-update');
		assert.equal(trace.groups[0].metrics.totalTrackedThreadWorkMs.min, 2);
		assert.deepEqual(trace.phaseGroups.map(group => group.operation), lifecycleOperations);
		assert.deepEqual(trace.phaseGroups.map(group => group.metrics.totalTrackedThreadWorkMs.min), [1, 2]);
		assert.deepEqual(trace.phaseGroups.map(group => group.sampleCount), [1, 1]);
		const raf = summarizeBenchmarkRaf(report);
		assert.equal(raf.groups[0].metrics.jsMs.min, 2);
		assert.deepEqual(raf.phaseGroups.map(group => group.metrics.jsMs.min), [1, 2]);
	});

	it('excludes both phases of warmup sessions', () => {
		const {report, events} = fixture('chart-population', true);
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
			r => r.phase = 'initial-chart-creation',
			r => r.phase = 'chart-lifecycle',
		]) {
			const {report} = fixture();
			change(report);
			assert.throws(() => benchmarkTimingSamples(report), /Lifecycle|lifecycle|session/);
		}
	});

	it('preserves analysis of legacy four-window reports without relabeling them', () => {
		const {report, events} = fixture('chart-lifecycle');
		const trace = analyzeBenchmarkTrace(events, report);
		assert.deepEqual(trace.phaseGroups.map(group => group.metrics.totalTrackedThreadWorkMs.min), [1, 2, null, 4]);
		assert.deepEqual(summarizeBenchmarkRaf(report).phaseGroups.map(group => group.metrics.jsMs.min), [1, 2, null, 4]);
	});

	it('does not modify or relabel legacy startup records', () => {
		const report = {samples: [{id: 'sample-0'}]};
		assert.equal(benchmarkTimingSamples(report), report.samples);
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
		const oldDpr = globalThis.devicePixelRatio;
		const {time, timeEnd} = console;
		try {
			globalThis.devicePixelRatio = 1;
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
			else globalThis.devicePixelRatio = oldDpr;
		}
	});
});
