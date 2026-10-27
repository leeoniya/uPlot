import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProcessMemory, summarizeAdjustedProcessMemory } from '../../scripts/analyze-benchmarks-process-memory.mjs';

const SCOPES = ['renderer', 'tree'];
const METRICS = ['rssMB', 'pssMB', 'privateMB', 'swapMB', 'swapPssMB'];
const VALUES = ['baseline', 'prepared', 'live', 'cleanup', 'peak', 'peakDelta', 'dataDelta', 'chartDelta', 'retainedDelta', 'cleanupDelta'];
const tuple = value => Object.fromEntries(METRICS.map(metric => [metric, value]));
const stats = (min, max = min, count = 1, missing = 0) => ({min, max, count, missing});
const absent = missing => stats(null, null, 0, missing);
const sample = (round = 0, extra = {}) => ({variant: 'uplot', dpr: 1, round, warmup: false, observations: lifecycle(), ...extra});
const summarize = samples => summarizeProcessMemory({samples});
const groupOf = observations => summarize([sample(0, {observations})]).groups[0];
const pssOf = observations => groupOf(observations).scopes.renderer.pssMB;

function observation(phase, value = 10, extra = {}) {
	return {
		phase, kind: ['prepare', 'construct'].includes(phase) ? 'poll' : 'gc',
		processMemory: {complete: true, processes: [], renderer: tuple(value), tree: tuple(value * 2), issues: []},
		...extra,
	};
}

function lifecycle() {
	return [
		observation('baseline', 10), observation('prepare', 20), observation('prepared', 6),
		observation('construct', 30), observation('live', 8), observation('cleanup', 5),
	].map((read, i) => ({...read, processRequestedAtMs: i * 10, processTimestampMs: i * 10 + 2}));
}

function freezeDeep(value) {
	if (value && typeof value === 'object') {
		Object.freeze(value);
		for (const child of Object.values(value))
			freezeDeep(child);
	}
	return value;
}

describe('through-update process memory', () => {
	const report = (variant = 'uplot') => ({
		memoryProtocol: 'through-update-v1', blank: observation('blank', 1),
		samples: [sample(0, {variant, observations: lifecycle().filter(read => read.phase !== 'cleanup')})],
	});

	it('stops peaks and request diagnostics at live and expects no cleanup checkpoint', () => {
		const raw = report();
		const expected = summarizeProcessMemory(raw);
		const group = expected.groups[0];
		assert.equal(group.missingCheckpointCount, 0);
		assert.equal(group.ambiguousCheckpointCount, 0);
		assert.deepEqual(group.scopes.renderer.pssMB.peak, stats(30));
		assert.deepEqual(group.scopes.renderer.pssMB.live, stats(8));
		assert.deepEqual(group.scopes.renderer.pssMB.cleanup, absent(1));
		assert.deepEqual(group.scopes.renderer.pssMB.cleanupDelta, absent(1));
		raw.samples[0].observations.push(
			observation('prepare', 1e9, {operation: 'resize'}),
			observation('construct', 2e9, {operation: 'hover-10'}),
			observation('cleanup', 3e9, {processRequestedAtMs: 1e9}),
		);
		assert.deepEqual(summarizeProcessMemory(freezeDeep(raw)), expected);
	});

	it('uses the same boundary for direct adjusted peaks and idle retention', () => {
		const reports = [report(), report('idle')];
		const expected = summarizeAdjustedProcessMemory(reports);
		for (const raw of reports) {
			raw.samples[0].processObservations = [...raw.samples[0].observations,
				observation('construct', 1e9), observation('cleanup', 2e9)];
			raw.samples[0].observations = [observation('live', 9e9)];
		}
		assert.deepEqual(summarizeAdjustedProcessMemory(freezeDeep(reports)), expected);
		assert.deepEqual(expected.groups[0].scopes.renderer.pssMB.peak, stats(22));
		assert.deepEqual(expected.groups[0].scopes.renderer.pssMB.live, stats(0));
	});

	it('rejects missing, duplicate, and misplaced live boundaries without requiring valid memory reads', () => {
		for (const change of [
			reads => reads.filter(read => read.phase !== 'live'),
			reads => [...reads, observation('live', 999)],
			reads => [...reads, observation('prepared', 999)],
			reads => [observation('cleanup', 999), ...reads],
			reads => [observation('construct', 999, {operation: 'resize'}), ...reads],
		]) {
			const raw = report();
			raw.samples[0].observations = change(raw.samples[0].observations);
			assert.throws(() => summarizeProcessMemory(raw), /through-update-v1/);
			assert.throws(() => summarizeAdjustedProcessMemory([raw]), /through-update-v1/);
		}
		const raw = report();
		raw.samples[0].observations.at(-1).processMemory.complete = false;
		const metric = summarizeProcessMemory(raw).groups[0].scopes.renderer.pssMB;
		assert.deepEqual(metric.live, absent(1));
		assert.deepEqual(metric.peak, stats(30));
	});

	it('rejects mixed memory protocols in either order, including idle and warmup-only controls', () => {
		for (const reverse of [false, true]) for (const warmup of [false, true]) {
			const raw = report(), idle = report('idle');
			delete idle.memoryProtocol;
			idle.samples[0].warmup = warmup;
			assert.throws(() => summarizeAdjustedProcessMemory(reverse ? [idle, raw] : [raw, idle]), /different memory protocols/);
		}
	});

	it('rejects unknown protocols rather than treating them as legacy, even on empty reports', () => {
		for (const protocol of ['future-v2', 'legacy', null, false, 1]) {
			const raw = {...report(), memoryProtocol: protocol};
			assert.throws(() => summarizeProcessMemory(raw), /Unknown memoryProtocol/);
			assert.throws(() => summarizeAdjustedProcessMemory([raw]), /Unknown memoryProtocol/);
			assert.throws(() => summarizeAdjustedProcessMemory([{...raw, samples: []}]), /Unknown memoryProtocol/);
		}
	});

	it('preserves legacy peaks after live and legacy missing-cleanup diagnostics', () => {
		const raw = report();
		delete raw.memoryProtocol;
		assert.equal(summarizeProcessMemory(raw).groups[0].missingCheckpointCount, 1);
		raw.samples[0].observations.push(observation('construct', 999), observation('cleanup', 1000));
		const group = summarizeProcessMemory(raw).groups[0];
		assert.equal(group.missingCheckpointCount, 0);
		assert.deepEqual(group.scopes.renderer.pssMB.peak, stats(1000));
	});
});

describe('baseline-adjusted process memory', () => {
	const browser = (variant = 'uplot', dpr = 1, blank = 20, values = [[50, 70]]) => ({
		blank: observation('blank', blank),
		loaded: observation('loaded', 9999),
		samples: values.map(([live, peak, baseline = 0], round) => sample(round, {
			variant, dpr, observations: [observation('baseline', baseline), observation('construct', peak), observation('live', live)],
		})),
	});
	const idle = () => browser('idle', 1, 10, [[15, 1000], [19, 3000], [17, 2000]]);
	const metricOf = result => result.groups[0].scopes.renderer.pssMB;

	it('adjusts raw per-sample live and peak with the browser blank and idle live minimum only', () => {
		const library = browser('uplot', 1, 20, [[50, 70, 40], [100, 120, 90], [25, 40, 30]]);
		const control = idle();
		// Cached summaries deliberately disagree with the raw observations.
		library.processAnalysis = summarizeProcessMemory(browser('uplot', 1, 900, [[9000, 9999]]));
		control.processAnalysis = summarizeProcessMemory(browser('idle', 1, 800, [[8000, 9999]]));
		const result = summarizeAdjustedProcessMemory([library, control]);
		assert.deepEqual(Object.keys(result), ['groups', 'controls', 'definitions']);
		assert.equal(result.groups.length, 1);
		const group = result.groups[0];
		assert.deepEqual(Object.keys(group), ['variant', 'dpr', 'sampleCount', 'warmupCount', 'scopes']);
		assert.equal(group.variant, 'uplot');
		assert.equal(group.dpr, 1);
		assert.equal(group.sampleCount, 3);
		assert.equal(group.warmupCount, 0);
		assert.deepEqual(Object.keys(group.scopes), SCOPES);
		assert.deepEqual(Object.keys(result.controls[0]), ['variant', 'dpr', 'sampleCount', 'warmupCount', 'validBlankCount', 'validLiveCount', 'scopes']);
		assert.equal(result.controls[0].variant, 'idle');
		assert.equal(result.controls[0].dpr, 1);
		assert.equal(result.controls[0].sampleCount, 3);
		assert.equal(result.controls[0].validBlankCount, 1);
		assert.equal(result.controls[0].validLiveCount, 3);
		for (const scope of SCOPES) {
			const factor = scope === 'tree' ? 2 : 1;
			assert.deepEqual(Object.keys(group.scopes[scope]), METRICS);
			for (const metric of METRICS) {
				assert.deepEqual(group.scopes[scope][metric], {
					live: stats(0, 75 * factor, 3),
					peak: stats(15 * factor, 95 * factor, 3),
					baselines: {blank: 20 * factor, idleLiveAboveBlank: 5 * factor},
				});
				assert.deepEqual(result.controls[0].scopes[scope][metric], {
					blank: stats(10 * factor), liveAboveBlank: stats(5 * factor, 9 * factor, 3),
				});
			}
		}
	});

	it('uses asymmetric minima for idle retention, adjusted live, and per-sample peak maxima', () => {
		const library = browser('uplot', 1, 20, [[70, 90, 5], [40, 130, 7], [100, 120, 9]]);
		const control = browser('idle', 1, 10, [[19, 80], [13, 900], [42, 60]]);
		for (const report of [library, control]) {
			report.samples.unshift(sample(-1, {variant: report.samples[0].variant, warmup: true, observations: [observation('live', 0)]}));
			report.samples.push(sample(3, {variant: report.samples[0].variant, observations: [observation('live', 0, {processMemory: {complete: false}})]}));
		}
		const raw = summarizeProcessMemory(library).groups[0];
		const result = summarizeAdjustedProcessMemory([library, control]);
		for (const scope of SCOPES) {
			const factor = scope === 'tree' ? 2 : 1;
			for (const metric of METRICS) {
				assert.deepEqual(result.controls[0].scopes[scope][metric].liveAboveBlank, stats(3 * factor, 32 * factor, 3, 1));
				assert.deepEqual(raw.scopes[scope][metric].live, stats(40 * factor, 100 * factor, 3, 1));
				assert.deepEqual(raw.scopes[scope][metric].peak, stats(90 * factor, 130 * factor, 3, 1));
				assert.deepEqual(result.groups[0].scopes[scope][metric], {
					live: stats(17 * factor, 77 * factor, 3, 1),
					peak: stats(67 * factor, 107 * factor, 3, 1),
					baselines: {blank: 20 * factor, idleLiveAboveBlank: 3 * factor},
				});
			}
		}
	});

	it('uses actual processObservations ahead of synthetic observations without changing the raw API', () => {
		const library = browser();
		library.samples[0].processObservations = library.samples[0].observations;
		library.samples[0].observations = [observation('live', 9999)];
		const control = idle();
		for (const sample of control.samples) {
			sample.processObservations = sample.observations;
			delete sample.observations;
		}
		assert.deepEqual(metricOf(summarizeAdjustedProcessMemory([library, control])).live, stats(25));
		assert.deepEqual(summarizeProcessMemory(library).groups[0].scopes.renderer.pssMB.live, stats(9999));
		library.samples[0].processObservations = [];
		assert.deepEqual(metricOf(summarizeAdjustedProcessMemory([library, control])).live, absent(1));
	});

	it('matches controls by DPR independently of report order and never reuses a previous control', () => {
		const result = summarizeAdjustedProcessMemory([
			browser('uplot', 2), idle(), browser('d3', 1, 30), browser('idle', 2, 100, [[120, 9000]]), browser(),
		]);
		assert.deepEqual(result.groups.map(group => [group.variant, group.dpr]), [['uplot', 2], ['d3', 1], ['uplot', 1]]);
		assert.deepEqual(result.controls.map(control => control.dpr), [1, 2]);
		assert.deepEqual(result.groups.map(group => group.scopes.renderer.pssMB.live.min), [10, 15, 25]);
		const missing = summarizeAdjustedProcessMemory([browser('uplot', 3), idle()]);
		assert.deepEqual(metricOf(missing).live, absent(1));
		assert.deepEqual(metricOf(missing).peak, absent(1));
		assert.equal(metricOf(missing).baselines.idleLiveAboveBlank, null);
		const noControl = summarizeAdjustedProcessMemory([browser()]);
		assert.deepEqual(noControl.controls, []);
		assert.deepEqual(metricOf(noControl).live, absent(1));
	});

	it('excludes all warmup observations, permits round overlap, and reports warmup-only populations', () => {
		const library = browser();
		const control = idle();
		for (const report of [library, control])
			report.samples.unshift({...report.samples[0], warmup: true, observations: [observation('live', 0)]});
		const result = summarizeAdjustedProcessMemory([library, control]);
		assert.deepEqual(metricOf(result).live, stats(25));
		assert.equal(result.groups[0].sampleCount, 1);
		assert.equal(result.groups[0].warmupCount, 1);
		assert.equal(result.controls[0].sampleCount, 3);
		assert.equal(result.controls[0].warmupCount, 1);
		assert.equal(result.controls[0].validLiveCount, 3);
		control.samples = control.samples.slice(0, 1);
		const noMeasuredIdle = summarizeAdjustedProcessMemory([library, control]);
		assert.deepEqual(metricOf(noMeasuredIdle).live, absent(1));
		assert.deepEqual(noMeasuredIdle.controls[0].scopes.renderer.pssMB.liveAboveBlank, absent(0));
		assert.equal(noMeasuredIdle.controls[0].validLiveCount, 0);
		library.samples = library.samples.slice(0, 1);
		const noMeasuredLibrary = summarizeAdjustedProcessMemory([library, idle()]);
		assert.equal(noMeasuredLibrary.groups[0].sampleCount, 0);
		assert.deepEqual(metricOf(noMeasuredLibrary).live, absent(0));
		assert.deepEqual(metricOf(noMeasuredLibrary).peak, absent(0));
	});

	it('requires valid blanks in both browsers, without a loaded, warm, or cached fallback', () => {
		const invalidBlanks = [undefined, null, {}, observation('blank', 20, {processMemory: {complete: false}})];
		for (const bad of [null, undefined, NaN, Infinity, -1, '20']) {
			const read = observation('blank', 20);
			read.processMemory.tree.swapPssMB = bad;
			invalidBlanks.push(read);
		}
		for (const blank of invalidBlanks) {
			for (const target of ['library', 'idle']) {
				const library = browser();
				const control = idle();
				(target === 'library' ? library : control).blank = blank;
				const result = summarizeAdjustedProcessMemory([library, control]);
				for (const scope of SCOPES) {
					for (const metric of METRICS) {
						assert.deepEqual(result.groups[0].scopes[scope][metric].live, absent(1));
						assert.deepEqual(result.groups[0].scopes[scope][metric].peak, absent(1));
					}
				}
				if (target === 'idle') {
					assert.equal(result.controls[0].validBlankCount, 0);
					assert.equal(result.controls[0].validLiveCount, 3);
					assert.deepEqual(result.controls[0].scopes.renderer.pssMB.blank, absent(1));
					assert.deepEqual(result.controls[0].scopes.renderer.pssMB.liveAboveBlank, absent(3));
				}
			}
		}
	});

	it('uses only valid unambiguous idle live checkpoints, never valid idle peaks', () => {
		const malformed = observation('live', 12);
		malformed.processMemory.renderer.rssMB = -1;
		for (const reads of [[], [null], [observation('unknown', 100)], [malformed],
			[observation('live', 12), observation('live', 14)],
			[observation('live', 12, {processMemory: {complete: false}})]]) {
			const control = browser('idle', 1, 10);
			control.processAnalysis = summarizeProcessMemory(control);
			control.samples[0].observations = [observation('construct', 1000), ...reads];
			const result = summarizeAdjustedProcessMemory([browser(), control]);
			assert.deepEqual(metricOf(result).live, absent(1));
			assert.deepEqual(metricOf(result).peak, absent(1));
			assert.equal(result.controls[0].validLiveCount, 0);
			assert.deepEqual(result.controls[0].scopes.renderer.pssMB.liveAboveBlank, absent(1));
		}
		const control = idle();
		control.samples[1].observations = [observation('construct', 10000)];
		const result = summarizeAdjustedProcessMemory([browser(), control]);
		assert.equal(result.controls[0].validLiveCount, 2);
		assert.deepEqual(result.controls[0].scopes.renderer.pssMB.liveAboveBlank, stats(5, 7, 2, 1));
		assert.deepEqual(metricOf(result).live, stats(25));
	});

	it('derives independent per-sample live and peak populations before aggregation', () => {
		const library = browser('uplot', 1, 20, [[50, 70], [100, 120], [25, 40], [0, 0]]);
		library.samples[1].observations.push(observation('live', 999));
		library.samples[3].observations = [null, observation('unknown', 9999)];
		const result = summarizeAdjustedProcessMemory([library, idle()]);
		assert.equal(result.groups[0].sampleCount, 4);
		assert.deepEqual(metricOf(result).live, stats(0, 25, 2, 2));
		assert.deepEqual(metricOf(result).peak, stats(15, 974, 3, 1));
	});

	it('keeps invalid library live values missing while retaining independently valid peaks', () => {
		const library = browser('uplot', 1, 20, [[50, 70], [100, 120], [25, 40]]);
		library.samples[0].observations[2].processMemory.tree.swapMB = NaN;
		library.samples[1].observations = undefined;
		library.samples[2].observations = [observation('baseline', 60)];
		const result = summarizeAdjustedProcessMemory([library, idle()]);
		assert.deepEqual(metricOf(result).live, absent(3));
		assert.deepEqual(metricOf(result).peak, stats(35, 45, 2, 1));
		assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
	});

	it('preserves negative adjusted values, negative controls, and real zero values', () => {
		const result = summarizeAdjustedProcessMemory([browser('uplot', 1, 20, [[5, 10]]), idle()]);
		assert.deepEqual(metricOf(result).live, stats(-20));
		assert.deepEqual(metricOf(result).peak, stats(-15));
		const negativeControl = summarizeAdjustedProcessMemory([browser(), browser('idle', 1, 10, [[5, 9000]])]);
		assert.deepEqual(metricOf(negativeControl).live, stats(35));
		assert.deepEqual(negativeControl.controls[0].scopes.renderer.pssMB.liveAboveBlank, stats(-5));
		const zero = summarizeAdjustedProcessMemory([browser('uplot', 1, 0, [[0, 0]]), browser('idle', 1, 0, [[0, 0]])]);
		assert.deepEqual(metricOf(zero).live, stats(0));
		assert.deepEqual(metricOf(zero).peak, stats(0));
	});

	it('keeps scope and metric offsets independent and does not add JS memory', () => {
		const reports = [browser(), idle()];
		for (const report of reports) {
			for (const read of [report.blank, ...report.samples.flatMap(sample => sample.observations)]) {
				read.usedSize = 1e12;
				read.backingStorageSize = 1e12;
				for (const scope of SCOPES)
					METRICS.forEach((metric, i) => read.processMemory[scope][metric] *= i + 1);
			}
		}
		const result = summarizeAdjustedProcessMemory(reports);
		for (const scope of SCOPES) {
			METRICS.forEach((metric, i) => {
				const factor = (i + 1) * (scope === 'tree' ? 2 : 1);
				assert.deepEqual(result.groups[0].scopes[scope][metric].live, stats(25 * factor));
				assert.deepEqual(result.groups[0].scopes[scope][metric].peak, stats(45 * factor));
			});
		}
	});

	it('rejects duplicate browser reports and mixed variant/DPR reports including warmups', () => {
		for (const variant of ['uplot', 'idle']) {
			const first = browser(variant);
			const second = browser(variant);
			second.samples[0].round = 1;
			assert.throws(() => summarizeAdjustedProcessMemory([first, second]), /Duplicate report.*DPR 1/);
			second.samples[0].warmup = true;
			assert.throws(() => summarizeAdjustedProcessMemory([first, second]), /Duplicate report/);
		}
		for (const extra of [{variant: 'idle'}, {dpr: 2}]) {
			for (const warmup of [false, true]) {
				const report = browser();
				report.samples.push(sample(1, {...extra, warmup}));
				assert.throws(() => summarizeAdjustedProcessMemory([report]), /exactly one variant and DPR/);
			}
		}
		const duplicateRound = browser();
		duplicateRound.samples.push(duplicateRound.samples[0]);
		assert.throws(() => summarizeAdjustedProcessMemory([duplicateRound]), /Duplicate measured round/);
	});

	it('rejects malformed input and ignores empty reports without inventing control identities', () => {
		for (const reports of [undefined, null, {}])
			assert.throws(() => summarizeAdjustedProcessMemory(reports), /reports must be an array/);
		for (const report of [null, {}, {samples: null}])
			assert.throws(() => summarizeAdjustedProcessMemory([report]), /report.samples must be an array/);
		for (const invalid of [null, {}, sample(0, {variant: ''}), sample(0, {dpr: 0}), sample(0, {warmup: 1}), sample(0.5)])
			assert.throws(() => summarizeAdjustedProcessMemory([{samples: [invalid]}]), /Each sample requires/);
		for (const field of ['observations', 'processObservations']) {
			for (const invalid of [null, {}, 'invalid'])
				assert.throws(() => summarizeAdjustedProcessMemory([{samples: [sample(0, {[field]: invalid})]}]), /must be an array/);
		}
		for (const reports of [[], [browser('idle', 1, 10, [])]]) {
			const result = summarizeAdjustedProcessMemory(reports);
			assert.deepEqual(result.groups, []);
			assert.deepEqual(result.controls, []);
		}
	});

	it('leaves frozen raw reports and raw summaries unchanged and returns JSON-safe independent results', () => {
		const reports = freezeDeep([browser(), idle()]);
		const original = structuredClone(reports);
		const raw = reports.map(summarizeProcessMemory);
		const result = summarizeAdjustedProcessMemory(reports);
		assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
		result.groups[0].scopes.renderer.pssMB.live.min = 999;
		result.groups[0].scopes.renderer.pssMB.baselines.blank = 999;
		result.controls[0].scopes.renderer.pssMB.liveAboveBlank.min = 999;
		assert.deepEqual(reports, original);
		assert.deepEqual(reports.map(summarizeProcessMemory), raw);
		assert.deepEqual(metricOf(summarizeAdjustedProcessMemory(reports)).live, stats(25));
	});

	it('documents conditional uncertainty, sampled GC-intervened peaks, and attribution limits', () => {
		const {definitions} = summarizeAdjustedProcessMemory([]);
		assert.match(definitions.variability, /conditional variability.*held fixed/);
		assert.match(definitions.variability, /do not include idle or blank uncertainty/);
		assert.match(definitions.peak, /sampled peaks.*lower bounds.*GC-intervened/);
		assert.match(definitions.ownership, /not isolated library ownership/);
		assert.match(definitions.scopes, /overlap.*not additive/);
		assert.match(definitions.jsMemory, /No scope or JS sums/);
		assert.match(definitions.formula, /Idle peak, warm baseline, and loaded baseline never/);
				assert.match(definitions.formula, /min\(idle measured live minus idle browser blank\)/);
				assert.match(definitions.baselines, /minimum measured live-minus-blank/);
				assert.match(definitions.aggregation, /min, max, count, and missing.*minimum represents the best measured case/);
				assert.match(definitions.peak, /minimum of these per-sample maxima, not the minimum observation/);
				assert.doesNotMatch(JSON.stringify(definitions), /median/);
	});
});

describe('process memory summary calculations', () => {
	it('reports all absolute checkpoints, peaks, and signed deltas for every scope and metric', () => {
		const group = groupOf(lifecycle());
		assert.equal(group.sampleCount, 1);
		assert.equal(group.warmupCount, 0);
		assert.deepEqual(Object.keys(group.scopes), SCOPES);
		const expected = {baseline: 10, prepared: 6, live: 8, cleanup: 5, peak: 30,
			peakDelta: 20, dataDelta: -4, chartDelta: 2, retainedDelta: -2, cleanupDelta: -5};
		for (const scope of SCOPES) {
			assert.deepEqual(Object.keys(group.scopes[scope]), METRICS);
			for (const metric of METRICS) {
				assert.deepEqual(Object.keys(group.scopes[scope][metric]), VALUES);
				for (const [key, value] of Object.entries(expected))
					assert.deepEqual(group.scopes[scope][metric][key], stats(value * (scope === 'tree' ? 2 : 1)), `${scope}.${metric}.${key}`);
			}
		}
	});

	it('aggregates paired per-sample deltas rather than subtracting checkpoint minima', () => {
		const samples = [[0, 100, 200, 0], [100, 101, 50, 90], [101, 0, 0, 1]].map((values, round) => sample(round, {
			observations: ['baseline', 'prepared', 'live', 'cleanup'].map((phase, i) => observation(phase, values[i])),
		}));
		const result = summarize(samples).groups[0].scopes.renderer.pssMB;
		assert.deepEqual(result.baseline, stats(0, 101, 3));
		assert.deepEqual(result.prepared, stats(0, 101, 3));
		assert.deepEqual(result.dataDelta, stats(-101, 100, 3));
		assert.deepEqual(result.chartDelta, stats(-51, 100, 3));
		assert.deepEqual(result.retainedDelta, stats(-101, 200, 3));
		assert.deepEqual(result.cleanupDelta, stats(-100, 0, 3));
		assert.deepEqual(result.peak, stats(101, 200, 3));
		assert.deepEqual(result.peakDelta, stats(0, 200, 3));
	});

	it('reports minima for even populations and per-sample missing counts', () => {
		const result = summarize([
			sample(0, {observations: [observation('baseline', 2)]}),
			sample(1, {observations: [observation('baseline', 10)]}),
			sample(2, {observations: []}),
		]).groups[0].scopes.renderer.pssMB;
		assert.deepEqual(result.baseline, stats(2, 10, 2, 1));
		assert.deepEqual(result.peak, stats(2, 10, 2, 1));
		assert.deepEqual(result.peakDelta, stats(0, 0, 2, 1));
		assert.deepEqual(result.retainedDelta, absent(3));
	});

	it('does not combine observations from different samples into a delta', () => {
		const result = summarize([
			sample(0, {observations: [observation('baseline', 10)]}),
			sample(1, {observations: [observation('prepared', 20)]}),
		]).groups[0].scopes.renderer.pssMB;
		assert.deepEqual(result.baseline, stats(10, 10, 1, 1));
		assert.deepEqual(result.prepared, stats(20, 20, 1, 1));
		assert.deepEqual(result.dataDelta, absent(2));
	});

	it('preserves decimal MB, real zero values, and negative deltas without adding JS memory', () => {
		const reads = ['baseline', 'prepared', 'live', 'cleanup'].map((phase, i) => observation(phase, [1.024, 0, 0, 0][i], {
			usedSize: 1e12, backingStorageSize: 1e12,
		}));
		const result = pssOf(reads);
		assert.deepEqual(result.baseline, stats(1.024));
		assert.deepEqual(result.prepared, stats(0));
		assert.deepEqual(result.peakDelta, stats(0));
		assert.deepEqual(result.chartDelta, stats(0));
		for (const key of ['dataDelta', 'retainedDelta', 'cleanupDelta'])
			assert.deepEqual(result[key], stats(-1.024));
		const zeros = pssOf([observation('baseline', 0)]);
		assert.deepEqual(zeros.peak, stats(0));
		assert.deepEqual(zeros.retainedDelta, absent(1));
	});

	it('finds each metric peak independently and never sums component maxima or overlapping scopes', () => {
		const reads = [observation('prepare', 1), observation('construct', 1)];
		for (const [i, metric] of METRICS.entries()) {
			reads[i % 2].processMemory.renderer[metric] = i + 10;
			reads[(i + 1) % 2].processMemory.tree[metric] = i + 100;
		}
		const result = groupOf(reads);
		for (const [i, metric] of METRICS.entries()) {
			assert.deepEqual(result.scopes.renderer[metric].peak, stats(i + 10));
			assert.deepEqual(result.scopes.tree[metric].peak, stats(i + 100));
		}
	});

	it('includes every lifecycle phase and all endpoint kinds in the sampled peak', () => {
		for (const phase of ['baseline', 'prepare', 'prepared', 'construct', 'live', 'cleanup']) {
			for (const kind of ['start', 'end', 'poll', 'gc'])
				assert.deepEqual(pssOf([observation(phase, 99, {kind})]).peak, stats(99), `${phase}/${kind}`);
		}
	});

	it('preserves extreme finite minima and subnormal values', () => {
		const huge = Number.MAX_VALUE;
		const reads = value => ['baseline', 'prepared', 'live', 'cleanup'].map(phase => {
			const read = observation(phase, value);
			read.processMemory.tree = tuple(value);
			return read;
		});
		let result = summarize([sample(0, {observations: reads(huge)}), sample(1, {observations: reads(huge)})]);
		assert.deepEqual(result.groups[0].scopes.renderer.pssMB.baseline, stats(huge, huge, 2));
		result = summarize([sample(0, {observations: reads(Number.MIN_VALUE)}), sample(1, {observations: reads(Number.MIN_VALUE)})]);
		assert.deepEqual(result.groups[0].scopes.renderer.pssMB.baseline, stats(Number.MIN_VALUE, Number.MIN_VALUE, 2));
		const positive = [reads(0)[0], reads(huge)[1]];
		const negative = [reads(huge)[0], reads(0)[1]];
		result = summarize([sample(0, {observations: positive}), sample(1, {observations: negative})]);
		assert.deepEqual(result.groups[0].scopes.renderer.pssMB.dataDelta, stats(-huge, huge, 2));
	});
});

describe('process memory summary validity and grouping', () => {
	it('excludes incomplete observations even if their aggregates contain plausible numbers', () => {
		const reads = lifecycle();
		reads[0].processMemory.complete = false;
		reads[3].processMemory.complete = false;
		const group = groupOf(reads);
		assert.equal(group.observationCount, 6);
		assert.equal(group.validObservationCount, 4);
		assert.equal(group.invalidObservationCount, 2);
		assert.equal(group.pollCount, 2);
		assert.deepEqual(group.scopes.renderer.pssMB.peak, stats(20));
		assert.deepEqual(group.scopes.renderer.pssMB.baseline, absent(1));
		for (const key of ['peakDelta', 'dataDelta', 'retainedDelta', 'cleanupDelta'])
			assert.deepEqual(group.scopes.renderer.pssMB[key], absent(1));
		assert.deepEqual(group.scopes.renderer.pssMB.chartDelta, stats(2));
	});

	it('requires boolean true completeness and both complete metric tuples', () => {
		const invalid = [undefined, null, {}, {complete: true}, {complete: true, renderer: tuple(1)}, {complete: true, tree: tuple(1)}];
		for (const complete of [undefined, null, false, 0, 1, 'true'])
			invalid.push({...observation('baseline').processMemory, complete});
		for (const processMemory of invalid) {
			const group = groupOf([observation('baseline', 1, {processMemory})]);
			assert.equal(group.invalidObservationCount, 1);
			for (const scope of SCOPES) {
				for (const metric of METRICS) {
					for (const key of VALUES)
						assert.deepEqual(group.scopes[scope][metric][key], absent(1));
				}
			}
		}
	});

	it('invalidates the entire observation on any malformed metric without numeric coercion', () => {
		for (const scope of SCOPES) {
			for (const metric of METRICS) {
				for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, '0', false]) {
					const read = observation('baseline');
					read.processMemory[scope][metric] = value;
					const group = groupOf([read]);
					assert.equal(group.invalidObservationCount, 1);
					assert.deepEqual(group.scopes.renderer.rssMB.baseline, absent(1));
					assert.deepEqual(group.scopes.tree.pssMB.peak, absent(1));
				}
			}
		}
	});

	it('keeps missing and invalid checkpoints null without discarding independent deltas', () => {
		for (const [phase, dependent] of [
			['baseline', ['peakDelta', 'dataDelta', 'retainedDelta', 'cleanupDelta']],
			['prepared', ['dataDelta', 'chartDelta']],
			['live', ['chartDelta', 'retainedDelta']],
			['cleanup', ['cleanupDelta']],
		]) {
			for (const missing of [true, false]) {
				const reads = lifecycle().filter(read => !missing || read.phase !== phase);
				if (!missing)
					reads.find(read => read.phase === phase).processMemory.complete = false;
				const group = groupOf(reads);
				const result = group.scopes.renderer.pssMB;
				assert.deepEqual(result[phase], absent(1));
				for (const key of dependent)
					assert.deepEqual(result[key], absent(1), `${phase}/${key}`);
				for (const key of ['peakDelta', 'dataDelta', 'chartDelta', 'retainedDelta', 'cleanupDelta'].filter(key => !dependent.includes(key)))
					assert.equal(result[key].count, 1, `${phase}/${key}`);
				assert.equal(group.missingCheckpointCount, missing ? 1 : 0);
			}
		}
	});

	it('marks duplicate checkpoints ambiguous even if only one duplicate is complete', () => {
		for (const complete of [true, false]) {
			const reads = lifecycle();
			const duplicate = observation('prepared', 99);
			duplicate.processMemory.complete = complete;
			reads.push(duplicate);
			const group = groupOf(reads);
			assert.equal(group.ambiguousCheckpointCount, 1);
			assert.deepEqual(group.scopes.renderer.pssMB.prepared, absent(1));
			assert.deepEqual(group.scopes.renderer.pssMB.dataDelta, absent(1));
			assert.deepEqual(group.scopes.renderer.pssMB.chartDelta, absent(1));
			assert.deepEqual(group.scopes.renderer.pssMB.peak, stats(complete ? 99 : 30));
			assert.equal(group.invalidObservationCount, complete ? 0 : 1);
		}
	});

	it('counts absent processMemory, null observations, and unknown phases as invalid', () => {
		const group = groupOf([null, {}, observation('blank', 1000), observation('unknown', 2000), observation('prepare', 7)]);
		assert.equal(group.observationCount, 5);
		assert.equal(group.invalidObservationCount, 4);
		assert.equal(group.validObservationCount, 1);
		assert.equal(group.missingCheckpointCount, 4);
		assert.deepEqual(group.scopes.renderer.pssMB.peak, stats(7));
	});

	it('keeps groups separate by variant and DPR and excludes warmups from all statistics and counts', () => {
		const result = summarize([
			sample(-1, {warmup: true, observations: [observation('baseline', 0)]}),
			sample(0), sample(1), sample(0, {variant: 'idle'}), sample(0, {dpr: 2}),
			sample(-1, {variant: 'warmup-only', warmup: true, observations: [null]}),
		]);
		assert.deepEqual(result.groups.map(group => [group.variant, group.dpr]), [['uplot', 1], ['idle', 1], ['uplot', 2], ['warmup-only', 1]]);
		const [group, idle, dpr2, warmup] = result.groups;
		assert.equal(group.warmupCount, 1);
		assert.equal(group.sampleCount, 2);
		assert.equal(group.observationCount, 12);
		assert.equal(group.invalidObservationCount, 0);
		assert.equal(group.requestedGapMs.count, 10);
		assert.deepEqual(group.scopes.renderer.pssMB.baseline, stats(10, 10, 2));
		assert.equal(idle.sampleCount, 1);
		assert.equal(dpr2.sampleCount, 1);
		assert.equal(warmup.warmupCount, 1);
		assert.equal(warmup.sampleCount, 0);
		assert.equal(warmup.observationCount, 0);
		assert.equal(warmup.invalidObservationCount, 0);
		assert.deepEqual(warmup.scopes.tree.swapMB.baseline, absent(0));
		assert.deepEqual(warmup.requestedGapMs, absent(0));
		assert.deepEqual(warmup.maxRequestedGapMs, absent(0));
	});

	it('rejects duplicate measured rounds within a group but permits warmup overlap', () => {
		assert.throws(() => summarize([sample(), sample()]), /Duplicate measured round 0.*uplot.*DPR 1/);
		assert.doesNotThrow(() => summarize([sample(), sample(0, {dpr: 2}), sample(0, {variant: 'idle'})]));
		const group = summarize([sample(0, {warmup: true}), sample(0, {warmup: true}), sample()]).groups[0];
		assert.equal(group.warmupCount, 2);
		assert.equal(group.sampleCount, 1);
	});

	it('handles empty reports, empty observations, and samples without observations', () => {
		assert.deepEqual(summarize([]).groups, []);
		const group = summarize([sample(0, {observations: []}), sample(1, {observations: undefined})]).groups[0];
		assert.equal(group.sampleCount, 2);
		assert.equal(group.observationCount, 0);
		assert.equal(group.invalidObservationCount, 0);
		assert.equal(group.missingCheckpointCount, 8);
		for (const value of VALUES)
			assert.deepEqual(group.scopes.renderer.pssMB[value], absent(2));
	});

	it('rejects malformed reports, grouping fields, and observation collections', () => {
		for (const report of [undefined, null, {}, {samples: null}, {samples: {}}])
			assert.throws(() => summarizeProcessMemory(report), /samples must be an array/);
		for (const invalid of [null, {}, sample(0, {variant: ''}), sample(0, {variant: 1}),
			sample(0, {dpr: 0}), sample(0, {dpr: NaN}), sample(0, {dpr: '1'}), sample(0, {dpr: Infinity}),
			sample(1.5), sample('0'), sample(Infinity), sample(0, {warmup: 'false'})])
			assert.throws(() => summarize([invalid]), /Each sample requires/);
		for (const observations of [null, {}, 'invalid'])
			assert.throws(() => summarize([sample(0, {observations})]), /observations must be an array/);
	});
});

describe('process memory request timing', () => {
	it('uses all consecutive request times, including checkpoints, phase transitions, and incomplete reads', () => {
		const reads = lifecycle();
		const times = [0, 10, 30, 100, 105, 150];
		for (const [i, read] of reads.entries()) {
			read.processRequestedAtMs = times[i];
			read.processTimestampMs = 10000 - i;
			read.requestedAtMs = i * 1000;
			read.timestampMs = i * 1000 + 999;
		}
		reads[2].processMemory.complete = false;
		const group = groupOf(reads);
		assert.deepEqual(group.requestedGapMs, stats(5, 70, 5));
		assert.deepEqual(group.maxRequestedGapMs, stats(70));
		assert.equal(group.pollCount, 2);
	});

	it('does not bridge missing timestamps, sort reversed times, or coerce invalid times', () => {
		for (const invalid of [undefined, null, NaN, Infinity, -1, '10', false]) {
			const reads = [0, invalid, 30, 50].map(processRequestedAtMs => observation('prepare', 7, {processRequestedAtMs}));
			const group = groupOf(reads);
			assert.deepEqual(group.requestedGapMs, stats(20, 20, 1, 2));
			assert.deepEqual(group.maxRequestedGapMs, stats(20));
			assert.equal(group.invalidObservationCount, 0, 'missing timing does not invalidate memory');
		}
		const group = groupOf([20, 10, 10].map(processRequestedAtMs => observation('prepare', 7, {processRequestedAtMs})));
		assert.deepEqual(group.requestedGapMs, stats(0, 0, 1, 1));
	});

	it('does not cross sample boundaries and distinguishes pooled gaps from sample maxima', () => {
		const result = summarize([
			sample(0, {observations: [0, 10, 30].map(processRequestedAtMs => observation('prepare', 1, {processRequestedAtMs}))}),
			sample(1, {observations: [1000, 1040].map(processRequestedAtMs => observation('construct', 1, {processRequestedAtMs}))}),
			sample(2, {observations: [observation('baseline', 1, {processRequestedAtMs: 2000})]}),
			sample(3, {observations: []}),
		]).groups[0];
		assert.deepEqual(result.requestedGapMs, stats(10, 40, 3));
		assert.deepEqual(result.maxRequestedGapMs, stats(20, 40, 2, 2));
	});

	it('reports missing gaps rather than zero when request timestamps are unavailable', () => {
		const group = groupOf([observation('baseline'), observation('prepared'), observation('live')]);
		assert.deepEqual(group.requestedGapMs, absent(2));
		assert.deepEqual(group.maxRequestedGapMs, absent(1));
	});
});

describe('process memory fixture checkpoints and definitions', () => {
	it('reports separate blank, loaded, and signed fixture overhead scalars for all metrics and scopes', () => {
		const result = summarizeProcessMemory({samples: [sample()], blank: observation('blank', 1000), loaded: observation('loaded', 900)});
		assert.equal(result.fixture.observationCount, 2);
		assert.equal(result.fixture.validObservationCount, 2);
		assert.equal(result.fixture.invalidObservationCount, 0);
		for (const scope of SCOPES) {
			const factor = scope === 'tree' ? 2 : 1;
			for (const metric of METRICS)
				assert.deepEqual(result.fixture.scopes[scope][metric], {blank: 1000 * factor, loaded: 900 * factor, loadedDelta: -100 * factor});
		}
		assert.deepEqual(result.groups[0].scopes.renderer.pssMB.peak, stats(30));
		assert.deepEqual(result.groups[0].scopes.renderer.pssMB.baseline, stats(10));
		assert.equal(result.groups[0].observationCount, 6);
	});

	it('keeps absent fixture checkpoints and unpaired deltas null', () => {
		const none = summarize([]).fixture;
		assert.deepEqual(none.scopes.renderer.pssMB, {blank: null, loaded: null, loadedDelta: null});
		assert.equal(none.observationCount, 0);
		assert.equal(none.invalidObservationCount, 0);
		for (const phase of ['blank', 'loaded']) {
			const fixture = summarizeProcessMemory({samples: [], [phase]: observation(phase, 10)}).fixture;
			assert.deepEqual(fixture.scopes.renderer.pssMB, {blank: null, loaded: null, loadedDelta: null, [phase]: 10});
			assert.equal(fixture.observationCount, 1);
			assert.equal(fixture.validObservationCount, 1);
			assert.equal(fixture.invalidObservationCount, 0);
		}
	});

	it('rejects incomplete and malformed fixture metrics but accepts genuine zero overhead', () => {
		for (const invalid of [null, {}, observation('blank', 1, {processMemory: {complete: false, renderer: tuple(1), tree: tuple(2)}})]) {
			const fixture = summarizeProcessMemory({samples: [], blank: invalid, loaded: observation('loaded', 2)}).fixture;
			assert.equal(fixture.invalidObservationCount, 1);
			assert.equal(fixture.observationCount, 2);
			assert.deepEqual(fixture.scopes.renderer.pssMB, {blank: null, loaded: 2, loadedDelta: null});
		}
		const invalid = observation('loaded', 2);
		invalid.processMemory.tree.swapPssMB = null;
		const fixture = summarizeProcessMemory({samples: [], blank: observation('blank', 1), loaded: invalid}).fixture;
		assert.deepEqual(fixture.scopes.renderer.pssMB, {blank: 1, loaded: null, loadedDelta: null});
		const zero = summarizeProcessMemory({samples: [], blank: observation('blank', 0), loaded: observation('loaded', 0)}).fixture;
		assert.deepEqual(zero.scopes.renderer.pssMB, {blank: 0, loaded: 0, loadedDelta: 0});
	});

	it('documents interpretation limits, missing data, and the exact timing population', () => {
		const {definitions} = summarize([]);
		assert.match(definitions.peak, /lower bound.*GC-intervened.*not an exact/);
		assert.match(definitions.pssMB, /non-atomic/);
		assert.match(definitions.rssMB, /double-count.*shared/);
		assert.match(definitions.gc, /does not guarantee native memory release/);
		assert.match(definitions.exclusions, /do not measure GPU device memory/);
		assert.match(definitions.baseline, /warm allocator baselines/);
		assert.match(definitions.fixture, /fixture overhead.*not pure library ownership/);
		assert.match(definitions.jsMemory, /Adding JS.*double counting/);
		assert.match(definitions.requestedGapMs, /all consecutive.*within each measured sample/);
		assert.match(definitions.requestedGapMs, /processRequestedAtMs, not processTimestampMs/);
		assert.match(definitions.checkpoints, /null, not zero/);
				assert.match(definitions.aggregation, /min, max, count, and missing.*minimum represents the best measured case/);
				assert.match(definitions.peak, /minimum of these per-sample maxima, not the minimum observation/);
				assert.doesNotMatch(JSON.stringify(definitions), /median/);
	});

	it('does not mutate frozen input and returns JSON-safe nulls rather than non-finite values', () => {
		const input = freezeDeep({samples: [sample(), sample(1, {observations: [null]})], blank: observation('blank', 1)});
		const original = structuredClone(input);
		const result = summarizeProcessMemory(input);
		assert.deepEqual(input, original);
		assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
		result.groups[0].scopes.renderer.pssMB.baseline.min = 99;
		result.fixture.scopes.renderer.pssMB.blank = 99;
		assert.deepEqual(input, original);
		assert.equal(summarizeProcessMemory(input).fixture.scopes.renderer.pssMB.blank, 1);
	});
});
