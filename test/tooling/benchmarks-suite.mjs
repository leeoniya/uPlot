import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseArgs } from 'node:util';
import { summarizeBenchmarkRaf } from '../../scripts/analyze-benchmarks-raf.mjs';
import { summarizeBenchmarkTraceSamples } from '../../scripts/analyze-benchmarks-trace.mjs';
import { TRACE_ACCOUNTING } from '../../scripts/bench-trace-policy.mjs';
import { benchmarkMode, resolveBenchmarkVulkan, variantReportName, suiteReportName, benchmarkVariantMetadata, runBenchmarkSuite, summarizeSavedBenchmarks } from '../../scripts/benchmarks-suite.mjs';
import { lifecycleOperations } from '../../scripts/benchmarks-phases.mjs';
import { demoDependencies, benchmarkMetadata, benchmarkVariants, benchmarkLibraryName, demoRestrictions, benchmarkRestrictions } from '../../bench/demo-dependencies.mjs';

const variants = ['idle', ...benchmarkVariants];
const skipped = Object.entries({...demoRestrictions, ...benchmarkRestrictions}).map(([variant, reason]) => ({variant, reason}));

const combined = {trace: true, memory: true, raf: false};
const tuple = pssMB => ({rssMB: pssMB * 4 + 50, pssMB, privateMB: pssMB / 2, swapMB: 1, swapPssMB: 0.5});
const observation = (phase, value) => ({
	phase, kind: phase === 'construct' ? 'poll' : 'gc',
	processMemory: {complete: true, processes: [], issues: [], renderer: tuple(value), tree: tuple(value * 3 + 100)},
});

function browser(variant, measurements = combined, dpr = 1, requestedBackend = 'default') {
	const idle = variant === 'idle';
	const values = idle ? [[15, 1000], [19, 3000], [17, 2000]] : [[50, 70], [100, 120], [25, 40]];
	const sample = ([live, peak], round, warmup = false) => ({
		id: `${variant}-${round}`, variant, dpr, round, warmup,
		dataPrepMs: warmup ? 9000 : 2, jsMs: warmup ? 9000 : 3, raf1Ms: warmup ? 9000 : 16,
		processObservations: [observation('baseline', 2), observation('prepared', 4), observation('construct', peak), {...observation('live', live), operation: 'data-update'}],
	});
	const report = {
		phase: 'chart-population', initProtocol: 'settled-work-v1', resizeProtocol: 'retained-resize-v1',
		hoverProtocol: 'hover-ten-v3', hover: {variants: ['idle', 'uplot', 'chartjs', 'bokeh', 'bokeh-canvas'], count: 10, intervalMs: 50},
		operations: [...lifecycleOperations], lifecycle: {operations: [...lifecycleOperations], resizeSize: {width: 1200, height: 400}},
		...(measurements.memory ? {memoryProtocol: 'through-update-v1'} : {}),
		measurements: {...measurements}, runner: {variant, dpr, requestedBackend, benchmark: {...(benchmarkMetadata[variant] ?? {sampling: 'none', context: '2d', lossy: false})}},
		blank: observation('blank', idle ? 10 : 20), loaded: observation('loaded', 9999),
		samples: [sample([9000, 10000], -1, true), ...values.map((value, round) => sample(value, round))],
	};
	for (const sample of report.samples) {
		sample.operation = 'data-update';
		sample.phases = report.operations.filter(operation => operation !== 'hover-10' || report.hover.variants.includes(variant))
			.map(operation => ({...sample, id: operation === 'data-update' ? sample.id : `${sample.id}-${operation}`, operation}));
	}
	if (measurements.trace) {
		report.trace = {accountingProtocol: TRACE_ACCOUNTING};
		const metrics = Object.fromEntries([
			['dataPrepMs', 1.123456], ['jsIntervalMs', 2], ['rendererMainTaskMs', 3],
			['gpuMainTaskMs', 4], ['totalTrackedThreadWorkMs', 5], ['jsMs', 999], ['prepAndInitMs', 999],
		].map(([key, mean]) => [key, {min: mean / 2, max: mean + 10, mean, count: 3, missing: 0}]));
		const group = {variant, dpr, operation: 'data-update', sampleCount: 3, warmupCount: 1, metrics};
		report.analysis = {accountingProtocol: TRACE_ACCOUNTING, groups: [group],
			phaseGroups: report.samples[0].phases.map(({operation}) => ({...structuredClone(group), operation}))};
	}
	if (measurements.raf)
		report.rafAnalysis = summarizeBenchmarkRaf(report);
	return report;
}

function capture(fn) {
	const noColor = process.env.NO_COLOR;
	process.env.NO_COLOR = '';
	const {log} = console;
	const logs = [], tables = [], events = [];
	try {
		console.log = (...args) => {
			if (typeof args[0] === 'string' && args[0].startsWith('┌')) {
				const [headers, ...cells] = args[0].split('\n').filter(line => line.startsWith('│'))
					.map(line => line.split(/│ │|│/).slice(1, -1).map(value => value.trim()));
				const rows = cells.map(row => Object.fromEntries(headers.map((key, i) =>
					[key, ['variant', 'context', 'sampling', 'lossy'].includes(key) || row[i] === 'unavailable' || row[i] === '-' || row[i] === '' ? row[i] : Number(row[i])])));
				tables.push(rows);
				events.push({type: 'table', rows});
			}
			else {
				logs.push(args);
				events.push({type: 'log', args});
			}
		};
		return {result: fn(), logs, tables, events};
	}
	finally {
		console.log = log;
		if (noColor === undefined)
			delete process.env.NO_COLOR;
		else
			process.env.NO_COLOR = noColor;
	}
}

async function captureWorkerOutput(fn) {
	const stdout = process.stdout.write, stderr = process.stderr.write;
	const writes = [];
	try {
		process.stdout.write = process.stderr.write = chunk => { writes.push(String(chunk)); return true; };
		await fn();
	}
	finally {
		process.stdout.write = stdout;
		process.stderr.write = stderr;
	}
	assert.deepEqual(writes, [], 'Worker output must not write into the live display');
}

let directory;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'uplot-suite-')); });
afterEach(() => { rmSync(directory, {recursive: true, force: true}); });
const saved = (mode = 'combined') => JSON.parse(readFileSync(join(directory, suiteReportName(mode)), 'utf8'));

function harness(options = {}) {
	const events = [], requests = [], tables = [], frames = [];
	return {
		events, requests, tables, frames,
		dependencies: {
			outputDirectory: directory,
			display: {update: frame => {
				frames.push(structuredClone(frame));
				events.push(frame.status);
				if (frame.rows.length && !tables.some(rows => JSON.stringify(rows) === JSON.stringify(frame.rows))) {
					tables.push(structuredClone(frame.rows));
					events.push('table');
				}
			}},
			runWorker: async request => {
				requests.push(request);
				events.push(`worker ${request.variant}`);
				return browser(request.variant, request.measurements, request.dpr, request.requestedBackend);
			},
			...options,
		},
	};
}

const groupedVariants = ids => [...new Set(ids.map(benchmarkLibraryName))]
	.flatMap(library => ids.filter(id => benchmarkLibraryName(id) === library));

const renderedRow = row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
	[key, key === 'variant' ? benchmarkLibraryName(value) : Number.isFinite(value) ? Number(value.toFixed(1)) : value]));

function savedReport(reports, measurements = combined) {
	return {mode: benchmarkMode(measurements), measurements, reports, requestedBackend: 'default',
		variantMetadata: structuredClone(benchmarkMetadata), complete: false, progress: {completed: []}, protocol: {custom: true}};
}

// Metric regressions inspect every column; presentation regressions override this option.
function offline(report, options = {verbose: true}) {
	const output = join(directory, 'offline.json');
	writeFileSync(output, JSON.stringify(report));
	return capture(() => summarizeSavedBenchmarks({...report.measurements, vulkan: false, ...options}, output));
}

function resizedBrowser(variant, measurements, dpr = 1, requestedBackend = 'default') {
	const raw = browser(variant, measurements, dpr, requestedBackend);
	for (const sample of raw.samples) for (const phase of sample.phases) {
		phase.jsMs = phase.operation === 'resize' ? 0.2 : sample.jsMs;
		phase.raf1Ms = phase.operation === 'data-update' ? sample.raf1Ms : sample.warmup ? 1
			: phase.operation === 'resize' ? [50, 40, 60][sample.round] : [19, 18, 20][sample.round];
	}
	if (measurements.trace) {
		const samples = raw.samples.flatMap(sample => sample.phases.map(phase => ({...phase,
			jsIntervalMs: phase.jsMs, rendererMainTaskMs: 3, gpuMainTaskMs: 4,
			totalTrackedThreadWorkMs: phase.warmup ? 9999 : phase.operation === 'resize' ? phase.round * 60
				: (phase.round + 1) * (phase.operation === 'data-update' ? 10 : 3),
		})));
		const phaseGroups = summarizeBenchmarkTraceSamples(samples);
		raw.analysis = {accountingProtocol: TRACE_ACCOUNTING, samples, groups: phaseGroups.filter(group => group.operation === 'data-update'), phaseGroups};
	}
	if (measurements.raf)
		raw.rafAnalysis = summarizeBenchmarkRaf(raw);
	return raw;
}

function hoverBrowser(variant, measurements = combined, dpr = 1, requestedBackend = 'default') {
	const raw = resizedBrowser(variant, measurements, dpr, requestedBackend);
	for (const sample of raw.samples) {
		const phase = sample.phases.find(phase => phase.operation === 'hover-10');
		if (phase) Object.assign(phase, {jsMs: 0.1, raf1Ms: sample.warmup ? 0.01 : [70, 40, 100][sample.round]});
	}
	if (measurements.trace) {
		for (const phase of raw.analysis.samples.filter(phase => phase.operation === 'hover-10'))
			phase.totalTrackedThreadWorkMs = phase.warmup ? 9999 : [0, 60, 120][phase.round];
		raw.analysis.phaseGroups = summarizeBenchmarkTraceSamples(raw.analysis.samples);
		raw.analysis.groups = raw.analysis.phaseGroups.filter(group => group.operation === 'data-update');
	}
	if (measurements.raf) raw.rafAnalysis = summarizeBenchmarkRaf(raw);
	return raw;
}

describe('current saved report contract', () => {
	it('rejects unsupported protocols and incomplete metadata before rewriting reports', () => {
		for (const change of [
			r => delete r.requestedBackend,
			r => delete r.reports[0].runner.requestedBackend,
			r => { for (const key of ['phase', 'initProtocol', 'resizeProtocol', 'hoverProtocol', 'hover', 'lifecycle', 'operations']) delete r.reports[0][key]; },
			...['unknown', null].map(phase => r => r.reports[0].phase = phase),
			r => delete r.reports[0].initProtocol,
			r => delete r.reports[0].lifecycle,
			r => r.reports[0].lifecycle.operations = ['small-init', 'data-update'],
			r => delete r.reports[0].lifecycle.resizeSize,
			r => r.reports[0].lifecycle.resizeSize = {width: 0, height: '400'},
			r => delete r.reports[0].resizeProtocol,
			...['unknown', null].map(protocol => r => r.reports[0].hoverProtocol = protocol),
			r => delete r.reports[0].runner.benchmark,
			...['sampling', 'context', 'lossy'].map(key => r => delete r.reports[0].runner.benchmark[key]),
			r => r.reports[0].runner.benchmark.context = 42,
			r => r.reports[0].runner.benchmark.lossy = 'false',
			r => r.reports[0].trace.accountingProtocol = 'unknown',
			r => { r.reports[0].trace.accountingProtocol = r.reports[0].analysis.accountingProtocol = 'unknown'; },
		]) {
			const report = savedReport([browser('idle'), browser('uplot')]);
			change(report);
			const output = join(directory, 'invalid-report.json');
			const bytes = JSON.stringify(report);
			writeFileSync(output, bytes);
			assert.throws(() => summarizeSavedBenchmarks({vulkan: false}, output), /backend|[Ll]ifecycle|metadata|accounting/);
			assert.equal(readFileSync(output, 'utf8'), bytes);
		}
	});
});

describe('through-update memory reports', () => {
	const updatedBrowser = hoverBrowser;

	for (const measurements of [combined, {trace: false, memory: true, raf: false}]) {
		it(`rejects mixed and unknown memory protocols before rewriting saved ${benchmarkMode(measurements)} reports`, () => {
			for (const reverse of [false, true]) for (const protocol of [undefined, 'future-v2', null]) {
				const idle = updatedBrowser('idle', measurements), raw = updatedBrowser('uplot', measurements);
				if (protocol === undefined) delete idle.memoryProtocol;
				else idle.memoryProtocol = protocol;
				const output = join(directory, 'mixed-memory.json');
				const bytes = JSON.stringify(savedReport(reverse ? [raw, idle] : [idle, raw], measurements));
				writeFileSync(output, bytes);
				assert.throws(() => capture(() => summarizeSavedBenchmarks({...measurements, vulkan: false}, output)), /memory[Pp]rotocol|memory protocols/);
				assert.equal(readFileSync(output, 'utf8'), bytes);
			}
		});
	}

	it('keeps memory before resize and hover for successful, unsupported, failed, and timed-out rows', async () => {
		const h = harness();
		h.dependencies.runWorker = async request => updatedBrowser(request.variant, request.measurements, request.dpr, request.requestedBackend);
		const report = await runBenchmarkSuite({variant: 'uplot', vulkan: false}, h.dependencies);
		const columns = ['variant', 'context', 'sampling', 'lossy', 'prep ms', 'init ms', 'main ms', 'gpu ms',
			'update ms', 'peak MB', 'retained MB', 'resize ms', 'hover10 ms'];
		assert.deepEqual(Object.keys(h.frames.at(-1).rows[0]), columns);
		report.reports.push(updatedBrowser('d3'));
		Object.assign(report.variantMetadata, structuredClone(benchmarkMetadata));
		report.failures = [{variant: 'chartjs', error: 'failed'}, {variant: 'd3-svg', error: 'failed'}];
		report.timeouts = [{variant: 'bokeh', error: 'timed out'}];
		const original = structuredClone(report.reports);
		const summary = offline(report);
		for (const row of summary.tables[0]) assert.deepEqual(Object.keys(row), columns);
		assert.deepEqual(summary.tables[0].filter(row => row.variant === 'd3').map(row => row['hover10 ms']), ['', '']);
		assert.equal(summary.tables[0].find(row => row.variant === 'chartjs')['hover10 ms'], '-');
		assert.equal(summary.tables[0].find(row => row.variant === 'bokeh')['hover10 ms'], '-');
		assert.deepEqual(summary.result.reports.map(raw => raw.samples), original.map(raw => raw.samples));
	});

	it('rejects a missing or duplicate live boundary before rewriting a saved report', () => {
		for (const duplicate of [false, true]) {
			const reports = [updatedBrowser('idle'), updatedBrowser('uplot')];
			const sample = reports[1].samples.find(sample => !sample.warmup);
			if (duplicate) sample.processObservations.push(observation('live', 1e9));
			else sample.processObservations = sample.processObservations.filter(read => read.phase !== 'live');
			const output = join(directory, 'invalid-memory-boundary.json');
			const bytes = JSON.stringify(savedReport(reports));
			writeFileSync(output, bytes);
			assert.throws(() => capture(() => summarizeSavedBenchmarks({vulkan: false}, output)), /exactly one live checkpoint/);
			assert.equal(readFileSync(output, 'utf8'), bytes);
		}
	});

	it('ignores late huge resize, hover, and cleanup observations in saved adjusted memory', () => {
		const reports = [updatedBrowser('idle'), updatedBrowser('uplot')];
		const expected = offline(savedReport(reports)).result.adjustedAnalysis;
		for (const raw of reports) for (const sample of raw.samples)
			sample.processObservations.push(
				{...observation('construct', 1e9), operation: 'resize'},
				{...observation('construct', 2e9), operation: 'hover-10'},
				observation('cleanup', 3e9),
			);
		assert.deepEqual(offline(savedReport(reports)).result.adjustedAnalysis, expected);
	});
});

describe('optional hover reports', () => {
	const hoveredBrowser = hoverBrowser;
	const modes = [combined, {trace: true, memory: false, raf: false}, {trace: false, memory: false, raf: true}, {trace: false, memory: true, raf: false}];
	for (const measurements of modes) {
		const mode = benchmarkMode(measurements);
		it(`shows cumulative hover means or rAF minima without update regression in live and saved ${mode}`, async () => {
			const h = harness();
			h.dependencies.runWorker = async request => hoveredBrowser(request.variant, request.measurements, request.dpr, request.requestedBackend);
			const report = await runBenchmarkSuite({...measurements, variant: 'uplot', vulkan: false}, h.dependencies);
			const row = h.frames.at(-1).rows[0];
			const baseline = offline(savedReport([resizedBrowser('idle', measurements), resizedBrowser('uplot', measurements)], measurements)).tables[0][0];
			assert.deepEqual(renderedRow(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'hover10 ms'))),
				Object.fromEntries(Object.entries(baseline).filter(([key]) => key !== 'hover10 ms')));
			if (measurements.trace || measurements.raf) {
				assert.equal(row['hover10 ms'], measurements.raf ? 40 : 60);
				assert.equal(Object.keys(row).indexOf('hover10 ms'), Object.keys(row).indexOf(measurements.raf ? 'resize rAF ms' : 'resize ms') + 1);
			}
			else assert.equal(Object.hasOwn(row, 'hover10 ms'), false);
			assert.deepEqual(h.frames.at(-1).warnings, []);
			const original = structuredClone(report.reports);
			const summary = offline(report);
			assert.deepEqual(summary.tables[0], [renderedRow(row)]);
			for (const [i, raw] of summary.result.reports.entries()) {
				assert.deepEqual(raw.samples, original[i].samples);
				const analysis = measurements.trace ? raw.analysis : raw.rafAnalysis;
				if (analysis) {
					assert.deepEqual(analysis.phaseGroups.map(group => group.operation), raw.operations);
					assert.equal(analysis.groups.length, 1);
				}
			}
			assert.match(report.protocol.hover, /10 mousemoves.*final settle\/fence/);
			assert.match(report.protocol.hover, /cumulative, not a per-point average/);
			assert.match(report.protocol.hover, /hover.intervalMs is 50/);
			assert.match(report.protocol.hover, /all ten coordinate targets through one browser binding/);
			assert.match(report.protocol.hover, /one browser Runtime.evaluate completion acknowledgment/);
			assert.match(report.protocol.hover, /No value verification or harness DOM\/canvas reads/);
			assert.match(report.protocol.hover, /reduces input-bridge overhead but does not eliminate it/);
			assert.match(report.protocol.hover, /Node scheduling is outside measured browser threads/);

			assert.match(report.protocol.hover, /at least 450 ms/);
			assert.match(report.protocol.timingColumns, /not the full-work equivalent/);
			assert.match(report.protocol.memoryColumns, /through-update-v1/);
						assert.match(report.protocol.memoryColumns, /before resize preparation/);
						assert.match(report.protocol.memoryColumns, /No process reads or forced GC occur after this checkpoint/);
						assert.match(report.protocol.memoryColumns, /No cleanup snapshot occurs, but chart destruction still runs/);
		});

		it(`rejects mixed hover protocols and capabilities before rewriting saved ${mode} reports`, () => {
			for (const reverse of [false, true]) for (const change of [
				raw => { delete raw.hoverProtocol; delete raw.hover; },
				raw => raw.hoverProtocol = 'unknown',
				raw => delete raw.hover.intervalMs,
				raw => raw.hover.intervalMs = 25,
				raw => raw.hover.intervalMs = null,
				raw => raw.hover.intervalMs = '50',
				raw => raw.hover.count = 9,
				raw => raw.hover.count = 11,
				raw => raw.hover.variants.push('d3'),
			]) {
				const old = hoveredBrowser('idle', measurements), next = hoveredBrowser('uplot', measurements);
				change(old);
				const output = join(directory, 'mixed-hover.json');
				const bytes = JSON.stringify(savedReport(reverse ? [next, old] : [old, next], measurements));
				writeFileSync(output, bytes);
				assert.throws(() => capture(() => summarizeSavedBenchmarks({...measurements, vulkan: false}, output)), /hover/);
				assert.equal(readFileSync(output, 'utf8'), bytes);
			}
		});

		it(`accepts reordered capability snapshots and rejects incomplete hover sessions in ${mode}`, () => {
			const idle = hoveredBrowser('idle', measurements), raw = hoveredBrowser('uplot', measurements);
			raw.hover.variants.reverse();
			const original = structuredClone(raw.hover);
			assert.equal(offline(savedReport([idle, raw], measurements)).tables[0].length, 1);
			assert.deepEqual(raw.hover, original);
			raw.samples[0].phases.pop();
			assert.throws(() => offline(savedReport([idle, raw], measurements)), /4 lifecycle operation windows/);
		});

		it(`rejects a mismatched live ${mode} worker`, async () => {
			const h = harness();
			h.dependencies.runWorker = async request => {
				const raw = hoveredBrowser(request.variant, request.measurements);
				if (request.variant !== 'idle') delete raw.hoverProtocol;
				return raw;
			};
			const report = await runBenchmarkSuite({...measurements, variant: 'uplot', vulkan: false}, h.dependencies);
			assert.deepEqual(report.reports.map(raw => raw.runner.variant), ['idle']);
			assert.equal(report.failures.length, 1);
			assert.match(report.failures[0].error, /hover protocol/);
			if (measurements.trace || measurements.raf) assert.equal(h.frames.at(-1).rows[0]['hover10 ms'], '-');
		});
	}

	for (const measurements of modes.filter(mode => mode.trace || mode.raf)) {
		it(`keeps unsupported hover blank, measured zero numeric, and supported failures marked in ${benchmarkMode(measurements)}`, async () => {
			const h = harness();
			h.dependencies.runWorker = async request => hoveredBrowser(request.variant, request.measurements, request.dpr, request.requestedBackend);
			await runBenchmarkSuite({...measurements, variant: 'd3', vulkan: false}, h.dependencies);
			assert.equal(h.frames.at(-1).rows[0]['hover10 ms'], '');
			assert.deepEqual(h.frames.at(-1).warnings, []);
			const raw = hoveredBrowser('uplot', measurements), unsupported = hoveredBrowser('d3', measurements);
			if (measurements.trace)
				for (const phase of raw.analysis.samples.filter(phase => phase.operation === 'hover-10')) phase.totalTrackedThreadWorkMs = 0;
			else {
				for (const sample of raw.samples) sample.phases[3].raf1Ms = 0;
				raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			}
			const input = savedReport([hoveredBrowser('idle', measurements), raw, unsupported], measurements);
			input.failures = [{variant: 'chartjs', error: 'synthetic supported failure'}, {variant: 'd3fc', error: 'synthetic unsupported failure'}];
			const {tables, logs} = offline(input);
			assert.equal(tables[0].find(row => row.variant === 'uplot')['hover10 ms'], 0);
			assert.equal(tables[0].find(row => row.variant === 'd3')['hover10 ms'], '');
			assert.equal(tables[0].find(row => row.variant === 'chartjs')['hover10 ms'], '-');
			assert.equal(tables[0].find(row => row.variant === 'd3fc')['hover10 ms'], '');
			assert.equal(logs.some(([text]) => text.startsWith('Warning:') && !text.includes('synthetic')), false);
		});

		it(`does not substitute readiness or window duration for missing hover metrics in ${benchmarkMode(measurements)}`, () => {
			const raw = hoveredBrowser('uplot', measurements);
			if (measurements.trace) {
				for (const sample of raw.analysis.samples.filter(sample => sample.operation === 'hover-10')) {
					delete sample.totalTrackedThreadWorkMs;
					sample.windowMs = 999;
				}
			}
			else {
				for (const sample of raw.samples) delete sample.phases[3].raf1Ms;
				raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			}
			const summary = offline(savedReport([raw], measurements));
			assert.equal(summary.tables[0][0]['hover10 ms'], 'unavailable');
			assert.ok(summary.logs.some(([text]) => text.includes('hover10 ms (0/3 valid, 3 missing, unavailable)')));
		});
	}

	for (const raf of [false, true]) it(`keeps sorting update-based rather than hover-based (${raf ? 'rAF' : 'trace'})`, () => {
		const measurements = {trace: !raf, memory: false, raf};
		const reports = ['bokeh', 'uplot', 'bokeh-canvas'].map((variant, i) => {
			const raw = hoveredBrowser(variant, measurements);
			if (raf) {
				for (const sample of raw.samples) {
					sample.raf1Ms = sample.phases[1].raf1Ms = [30, 20, 10][i];
					sample.phases[3].raf1Ms = [1, 2, 300][i];
				}
				raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			}
			else for (const sample of raw.analysis.samples) {
				if (sample.operation === 'data-update') sample.totalTrackedThreadWorkMs = [30, 20, 10][i];
				if (sample.operation === 'hover-10') sample.totalTrackedThreadWorkMs = [1, 2, 300][i];
			}
			return raw;
		});
		const rows = offline(savedReport(reports, measurements)).tables[0];
		assert.deepEqual(rows.map(row => row.variant), ['bokeh', 'bokeh', 'uplot']);
		assert.deepEqual(rows.map(row => row[raf ? 'next rAF ms' : 'update ms']), [10, 30, 20]);
		assert.deepEqual(rows.map(row => row['hover10 ms']), [300, 1, 2]);
	});

});

describe('retained resize reports', () => {
	for (const measurements of [combined, {trace: true, memory: false, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`shows independent resize timing in live and saved ${benchmarkMode(measurements)} tables`, async () => {
			const h = harness();
			h.dependencies.runWorker = async request => {
				h.requests.push(request);
				return resizedBrowser(request.variant, request.measurements, request.dpr, request.requestedBackend);
			};
			const report = await runBenchmarkSuite({...measurements, variant: 'uplot', vulkan: false}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'uplot']);
			const row = h.frames.at(-1).rows[0];
			const label = measurements.raf ? 'resize rAF ms' : 'resize ms';
			assert.deepEqual(Object.keys(row), ['variant', 'context', 'sampling', 'lossy', 'prep ms',
				...(measurements.raf ? ['init rAF ms', 'update ms', 'next rAF ms'] : ['init ms', 'main ms', 'gpu ms', 'update ms']),
				...(measurements.memory ? ['peak MB', 'retained MB'] : []), label, 'hover10 ms']);
			assert.equal(row[label], measurements.raf ? 40 : 60);
			assert.equal(row['update ms'], measurements.raf ? 3 : 20);
			assert.equal(row['prep ms'], 2);
			assert.equal(row[measurements.raf ? 'init rAF ms' : 'init ms'], measurements.raf ? 18 : 6);
			assert.equal(row[measurements.raf ? 'next rAF ms' : 'main ms'], measurements.raf ? 16 : 3);
			if (measurements.trace) assert.equal(row['gpu ms'], 4);
			assert.deepEqual(h.frames.at(-1).warnings, []);
			const original = structuredClone(report.reports);
			const summary = offline(report);
			assert.deepEqual(summary.tables[0], [renderedRow(row)]);
			for (const [i, raw] of summary.result.reports.entries()) {
				assert.deepEqual(raw.samples, original[i].samples);
				assert.deepEqual(raw.lifecycle.resizeSize, {width: 1200, height: 400});
				const analysis = measurements.trace ? raw.analysis : raw.rafAnalysis;
				assert.deepEqual(analysis.phaseGroups.map(group => group.operation), raw.operations);
				assert.equal(analysis.groups.length, 1);
				if (measurements.trace) {
					assert.equal(analysis.groups[0].operation, 'data-update');
					assert.equal(analysis.phaseGroups[2].metrics.totalTrackedThreadWorkMs.min, 0);
					assert.equal(analysis.phaseGroups[2].metrics.totalTrackedThreadWorkMs.mean, 60);
				}
			}
			report.variantMetadata.chartjs = {...benchmarkMetadata.chartjs};
			report.failures = [{variant: 'chartjs', error: 'synthetic failure'}];
			const failed = offline(report).tables[0].find(row => row.variant === 'chartjs');
			assert.deepEqual(Object.keys(failed), Object.keys(row));
			assert.equal(failed[label], '-');
		});

		it(`does not substitute resize readiness or window latency for missing ${benchmarkMode(measurements)} timing`, () => {
			const raw = resizedBrowser('uplot', measurements);
			if (measurements.trace) {
				for (const sample of raw.analysis.samples.filter(sample => sample.operation === 'resize')) {
					delete sample.totalTrackedThreadWorkMs;
					sample.windowMs = 999;
				}
			}
			else {
				for (const sample of raw.samples) delete sample.phases[2].raf1Ms;
				raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			}
			const summary = offline(savedReport([raw], measurements));
			const label = measurements.raf ? 'resize rAF ms' : 'resize ms';
			assert.equal(summary.tables[0][0][label], 'unavailable');
			assert.ok(summary.logs.some(([text]) => text.includes(`${label} (0/3 valid, 3 missing, unavailable)`)));
		});
	}

	for (const raf of [false, true]) it(`keeps library groups ordered by update rather than resize (${raf ? 'rAF' : 'trace'})`, () => {
		const measurements = {trace: !raf, memory: false, raf};
		const reports = ['bokeh', 'uplot', 'bokeh-canvas'].map((variant, i) => {
			const raw = resizedBrowser(variant, measurements);
			if (raf) {
				for (const sample of raw.samples) {
					sample.raf1Ms = sample.phases[1].raf1Ms = [30, 20, 10][i];
					sample.phases[2].raf1Ms = [1, 2, 300][i];
				}
				raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			}
			else for (const sample of raw.analysis.samples) {
				if (sample.operation === 'data-update') sample.totalTrackedThreadWorkMs = [30, 20, 10][i];
				if (sample.operation === 'resize') sample.totalTrackedThreadWorkMs = [1, 2, 300][i];
			}
			return raw;
		});
		const rows = offline(savedReport(reports, measurements)).tables[0];
		assert.deepEqual(rows.map(row => row.variant), ['bokeh', 'bokeh', 'uplot']);
		assert.deepEqual(rows.map(row => row[raf ? 'next rAF ms' : 'update ms']), [10, 30, 20]);
		assert.deepEqual(rows.map(row => row[raf ? 'resize rAF ms' : 'resize ms']), [300, 1, 2]);
	});
});

describe('lifecycle timing columns', () => {
	for (const measurements of [combined, {trace: true, memory: false, raf: false}]) {
		it(`omits update readiness and its warnings from live and saved ${benchmarkMode(measurements)} tables`, async () => {
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = async request => {
				const raw = await worker(request);
				raw.phase = 'chart-population';
				raw.initProtocol = 'settled-work-v1';
				delete raw.analysis.groups[0].metrics.jsIntervalMs;
				return raw;
			};
			const report = await runBenchmarkSuite({...measurements, variant: 'uplot', vulkan: false}, h.dependencies);
			const columns = ['variant', 'context', 'sampling', 'lossy', 'prep ms', 'init ms', 'main ms', 'gpu ms', 'update ms',
				...(measurements.memory ? ['peak MB', 'retained MB'] : []), 'resize ms', 'hover10 ms'];
			assert.deepEqual(Object.keys(h.frames.at(-1).rows[0]), columns);
			assert.deepEqual(h.frames.at(-1).warnings, []);
			const summary = offline(report);
			assert.deepEqual(Object.keys(summary.tables[0][0]), columns);
			assert.ok(!summary.logs.some(([text]) => text.startsWith('Warning:')));
			report.variantMetadata.chartjs = {...benchmarkMetadata.chartjs};
			report.failures = [{variant: 'chartjs', error: 'synthetic failure'}];
			const failed = offline(report).tables[0].find(row => row.variant === 'chartjs');
			assert.deepEqual(Object.keys(failed), columns);
			assert.equal(failed['update ms'], '-');
		});
	}
	for (const raf of [false, true]) it(`reports settled init work or explicitly labeled rAF latency (${raf ? 'rAF' : 'trace'})`, () => {
		const raw = browser('uplot', {trace: !raf, memory: false, raf});
		raw.phase = 'chart-population';
		raw.initProtocol = 'settled-work-v1';
		const analysis = raf ? raw.rafAnalysis : raw.analysis;
		const stat = value => ({min: raf ? value : value / 2, max: value + 1, mean: value, count: 3, missing: 0});
		analysis.phaseGroups = [{...analysis.groups[0], operation: 'small-init', metrics: {
			jsIntervalMs: stat(1.7), jsMs: stat(1.7), totalTrackedThreadWorkMs: stat(12), raf1Ms: stat(16), windowMs: stat(220),
		}}];
		const row = offline(savedReport([raw], raw.measurements)).tables[0][0];
		assert.equal(row[raf ? 'init rAF ms' : 'init ms'], raf ? 16 : 12);
		assert.equal(row['update ms'], raf ? 3 : 5);
		assert.equal(row[raf ? 'next rAF ms' : 'main ms'], raf ? 16 : 3);
		assert.ok(!Object.hasOwn(row, raf ? 'init ms' : 'init rAF ms'));
		assert.equal(Object.keys(row)[5], raf ? 'init rAF ms' : 'init ms');
		delete analysis.phaseGroups[0].metrics[raf ? 'raf1Ms' : 'totalTrackedThreadWorkMs'];
		assert.equal(offline(savedReport([raw], raw.measurements)).tables[0][0][raf ? 'init rAF ms' : 'init ms'], 'unavailable');
	});

	it('ranks lifecycle reports by mean update work, not readiness or initialization work', () => {
		const measurements = {trace: true, memory: false, raf: false};
		const reports = ['uplot', 'chartjs'].map((variant, i) => {
			const raw = browser(variant, measurements);
			raw.phase = 'chart-population';
			raw.initProtocol = 'settled-work-v1';
			const group = raw.analysis.groups[0];
			group.metrics.totalTrackedThreadWorkMs.mean = i === 0 ? 20 : 10;
			group.metrics.jsIntervalMs.mean = i === 0 ? 1 : 9;
			raw.analysis.phaseGroups = [{...group, operation: 'small-init', metrics: {
				totalTrackedThreadWorkMs: {min: 1, mean: i === 0 ? 5 : 50, count: 3, missing: 0},
			}}];
			return raw;
		});
		const rows = offline(savedReport(reports, measurements)).tables[0];
		assert.deepEqual(rows.map(row => row.variant), ['chartjs', 'uplot']);
		assert.deepEqual(rows.map(row => row['update ms']), [10, 20]);
		assert.deepEqual(rows.map(row => row['init ms']), [50, 5]);
	});

});

describe('benchmark execution order', () => {
	it('runs idle, master and release first, then variants by ascending reference update time without library grouping', async () => {
		const updateMs = {
			uplot: 9.4, 'd3-minmax': 15.4, 'd3-svg-minmax': 26.6, d3: 26.6, 'd3-svg': 170.3,
			scichart: 17.4, chartjs: 19.9, echarts: 23.6, 'apexcharts-sampled': 32.6, apexcharts: 61.2,
			d3fc: 38.4, 'd3fc-canvas': 80.2, chartgpu: 41.6, flot: 42.3, financialcharts: 65.4,
			deckgl: 73.1, agcharts: 74.5, bokeh: 100.3, 'bokeh-canvas': 106.7, visx: 126.3,
			dygraphs: 160.4, 'anychart-sampled': 172.6, anychart: 1122.7, plotly: 198.8, 'plotly-svg': 306.1,
			canvasjs: 261.0, 'fusiontime-sampled': 300.2, fusiontime: 4760.2,
			'devextreme-sampled': 309.6, devextreme: 6429.1, highcharts: 344.7, 'highcharts-svg': 1124.3,
			muicharts: 398.3, vega: 602.7, lightweight: 605.7, billboard: 845.6, g2: 914.3,
			recharts: 1057.3, zingchart: 1114.2, syncfusion: 1317.7, 'amcharts-sampled': 1670.0,
			amcharts: 1952.5, kendo: 4122.9,
		};
		const expected = Object.keys(updateMs).sort((a, b) => updateMs[a] - updateMs[b]);
		// Release has no reference timing yet; its second chart slot is fixed.
		expected.splice(1, 0, 'uplot-release');
		assert.deepEqual(benchmarkVariants, expected);
		const h = harness();
		const report = await runBenchmarkSuite({trace: true, vulkan: false}, h.dependencies);
		assert.deepEqual(h.requests.map(request => request.variant), ['idle', ...expected]);
		assert.deepEqual(report.protocol.variants, ['idle', ...expected]);
	});
});

describe('benchmark library grouping', () => {
	for (const measurements of [combined, {trace: false, memory: true, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`keeps master and release labels distinct with identical ${benchmarkMode(measurements)} metadata and timings`, () => {
			const reports = ['uplot', 'uplot-release'].map(id => browser(id, measurements));
			assert.deepEqual(reports[0].runner.benchmark, reports[1].runner.benchmark);
			const input = savedReport(reports, measurements);
			const original = structuredClone(input);
			const summary = offline(input);
			assert.deepEqual(summary.tables[0].map(row => row.variant), ['uplot', 'uplot-release']);
			assert.deepEqual(summary.tables[0].map(row => [row.sampling, row.context, row.lossy]),
				[['minmax', '2d', ''], ['minmax', '2d', '']]);
			assert.deepEqual(summary.result.reports, original.reports);
			assert.deepEqual(input, original);
		});
	}

	for (const measurements of [combined, {trace: true, memory: false, raf: false},
		{trace: false, memory: false, raf: true}, {trace: false, memory: true, raf: false}]) {
		for (const protocol of [false, true]) {
			it(`orders saved ${benchmarkMode(measurements)} groups and ties by ${protocol ? 'protocol' : 'first-seen'} order, keeping unavailable members and unknown IDs`, () => {
				const speeds = {
					bokeh: null, 'custom-svg': 4, 'd3-svg': 2, apexcharts: 9, uplot: 2,
					'bokeh-canvas': null, d3: 2, 'apexcharts-sampled': 0, 'amcharts-sampled': 1,
					'plotly-svg': null, custom: 5, 'custom-sampled': 6,
				};
				const reports = Object.entries(speeds).map(([id, speed]) => {
					const raw = browser(id, measurements);
					// A unique snapshot identifies tied siblings even after their labels are compacted.
					raw.runner.benchmark.sampling = id;
					if (measurements.trace)
						raw.analysis.groups[0].metrics.totalTrackedThreadWorkMs.mean = speed;
					if (measurements.raf)
						raw.rafAnalysis.groups[0].metrics.raf1Ms.min = speed;
					return raw;
				});
				const input = savedReport(reports, measurements);
				input.failures = ['amcharts', 'plotly'].map(variant => ({variant, error: `${variant} failed`}));
				input.timeouts = [{variant: 'highcharts-svg', error: 'highcharts-svg timed out'}];
				input.variantMetadata = Object.fromEntries(['amcharts', 'plotly', 'highcharts-svg'].map(id => [id, {...benchmarkMetadata[id], sampling: id}]));
				if (protocol)
					input.protocol.variants = ['plotly', 'highcharts-svg', 'amcharts', 'apexcharts', 'uplot', 'd3',
						'bokeh-canvas', 'custom-sampled', 'custom', 'custom-svg', 'bokeh', 'd3-svg', 'apexcharts-sampled', 'amcharts-sampled', 'plotly-svg'];
				const timed = measurements.trace || measurements.raf;
				const expected = timed ? [
					'apexcharts-sampled', 'apexcharts', 'amcharts-sampled', 'amcharts',
					...(protocol ? ['uplot', 'd3', 'd3-svg'] : ['d3-svg', 'd3', 'uplot']),
					'custom-svg', 'custom', 'custom-sampled',
					...(protocol ? ['plotly', 'plotly-svg', 'highcharts-svg', 'bokeh-canvas', 'bokeh']
						: ['bokeh', 'bokeh-canvas', 'plotly-svg', 'plotly', 'highcharts-svg']),
				] : protocol ? [
					'plotly', 'plotly-svg', 'highcharts-svg', 'amcharts', 'amcharts-sampled', 'apexcharts', 'apexcharts-sampled',
					'uplot', 'd3', 'd3-svg', 'bokeh-canvas', 'bokeh', 'custom-sampled', 'custom', 'custom-svg',
				] : [
					'bokeh', 'bokeh-canvas', 'custom-svg', 'd3-svg', 'd3', 'apexcharts', 'apexcharts-sampled',
					'uplot', 'amcharts-sampled', 'amcharts', 'plotly-svg', 'plotly', 'custom', 'custom-sampled', 'highcharts-svg',
				];
				const original = structuredClone(input);
				const summary = offline(input);
				assert.deepEqual(summary.tables[0].map(row => row.sampling), expected);
				assert.deepEqual(summary.tables[0].map(row => row.variant), expected.map(benchmarkLibraryName));
				assert.deepEqual(summary.result.reports, original.reports);
				assert.deepEqual(summary.result.protocol, original.protocol);
				assert.deepEqual(summary.result.failures, original.failures);
				assert.deepEqual(summary.result.timeouts, original.timeouts);
				assert.deepEqual(JSON.parse(readFileSync(join(directory, 'offline.json'), 'utf8')).reports, original.reports);
				assert.deepEqual(input, original);
				assert.ok(summary.logs.some(args => args[0] === 'Warning: highcharts-svg timed out'));
			});
		}
	}

	for (const measurements of [{trace: true, memory: false, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`uses unrounded sibling times and the first group member for ${benchmarkMode(measurements)} group ties`, () => {
			const speeds = {
				bokeh: 100, uplot: 1.01, 'bokeh-canvas': 1.01,
				d3: 2.04, 'd3-svg': 2.01,
				amcharts: null, apexcharts: 5, 'amcharts-sampled': 5, 'apexcharts-sampled': null,
				'custom-webgl': null,
			};
			const reports = Object.entries(speeds).map(([id, speed]) => {
				const raw = browser(id, measurements);
				raw.runner.benchmark.sampling = id;
				const metrics = (raw.analysis ?? raw.rafAnalysis).groups[0].metrics;
				metrics[measurements.trace ? 'totalTrackedThreadWorkMs' : 'raf1Ms'][measurements.trace ? 'mean' : 'min'] = speed;
				return raw;
			});
			const rows = offline(savedReport(reports, measurements)).tables[0];
			assert.deepEqual(rows.map(row => row.sampling), [
				'bokeh-canvas', 'bokeh', 'uplot', 'd3-svg', 'd3',
				'amcharts-sampled', 'amcharts', 'apexcharts', 'apexcharts-sampled', 'custom-webgl',
			]);
			const metric = measurements.trace ? 'update ms' : 'next rAF ms';
			assert.equal(rows[3][metric], 2);
			assert.equal(rows[4][metric], 2);
		});
	}

	it('keeps live memory library groups contiguous despite interleaved execution and a failed sibling', async () => {
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = request => {
			if (request.variant === 'amcharts') {
				h.requests.push(request);
				throw new Error('amcharts failed');
			}
			return worker(request);
		};
		const report = await runBenchmarkSuite({memory: true, vulkan: false}, h.dependencies);
		const rows = h.frames.at(-1).rows;
		assert.deepEqual(rows.map(row => row.variant), groupedVariants(benchmarkVariants));
		assert.deepEqual(rows.filter(row => benchmarkLibraryName(row.variant) === 'd3').map(row => row.variant),
			['d3-minmax', 'd3-svg-minmax', 'd3', 'd3-svg']);
		assert.deepEqual(rows.filter(row => benchmarkLibraryName(row.variant) === 'amcharts').map(row => row.variant),
			['amcharts-sampled', 'amcharts']);
		assert.deepEqual(h.requests.map(request => request.variant), variants);
		assert.deepEqual(offline(report).tables[0], rows.map(renderedRow));
	});
});

describe('benchmark metadata snapshots', () => {
	it('covers all 49 demo IDs and 44 default variants plus idle', () => {
		assert.equal(Object.keys(benchmarkMetadata).length, 49);
		assert.deepEqual(Object.keys(benchmarkMetadata).sort(), Object.keys(demoDependencies).sort());
		assert.equal(variants.length, 45);
		assert.equal(new Set(variants).size, 45);
		assert.equal(new Set(benchmarkVariants.map(benchmarkLibraryName)).size, 32);
		assert.deepEqual(Object.keys(demoDependencies).slice(0, 2), ['uplot', 'uplot-release']);
		assert.equal(benchmarkLibraryName('uplot'), 'uplot');
		assert.equal(benchmarkLibraryName('uplot-release'), 'uplot-release');
		assert.deepEqual(benchmarkMetadata['uplot-release'], {sampling: 'minmax', context: '2d', lossy: false});
		assert.equal(benchmarkLibraryName('deckgl'), 'deckgl');
		assert.equal(benchmarkLibraryName('d3-minmax'), 'd3');
		assert.deepEqual(benchmarkMetadata['d3-minmax'], {sampling: 'minmax', context: '2d', lossy: false});
		assert.equal(benchmarkLibraryName('d3-svg-minmax'), 'd3');
		assert.deepEqual(benchmarkMetadata['d3-svg-minmax'], {sampling: 'minmax', context: 'svg', lossy: false});
		for (const [id, metadata] of Object.entries(benchmarkMetadata)) {
			assert.deepEqual(Object.keys(metadata).sort(), ['context', 'lossy', 'sampling'], id);
						assert.ok([true, false, null].includes(metadata.lossy), id);
			assert.equal(typeof metadata.sampling, 'string', id);
			assert.ok(metadata.sampling.length, id);
			assert.ok(['svg', '2d', 'webgl', 'webgl2', 'webgpu', null].includes(metadata.context), id);
		}
		for (const id of ['lightningchart', 'g2-webgl'])
			assert.equal(benchmarkMetadata[id].context, null);
		assert.equal(benchmarkMetadata.scichart.context, 'webgl2');
		assert.equal(benchmarkMetadata.chartgpu.context, 'webgpu');
		assert.deepEqual(benchmarkMetadata.deckgl, {sampling: 'none', context: 'webgl2', lossy: false});
	});

	it('classifies configured lossy reducers, exempting verified minmax and tested SciChart Auto but not unverified grouping', () => {
		const lossy = new Set(['apexcharts-sampled', 'amcharts-sampled', 'devextreme-sampled', 'anychart-sampled',
			'fusiontime-sampled', 'fusiontime', 'plotly-svg', 'lightweight', 'highcharts', 'syncfusion']);
		const unknown = new Set(['lightningchart']);
		for (const [id, metadata] of Object.entries(benchmarkMetadata))
			assert.equal(metadata.lossy, unknown.has(id) ? null : lossy.has(id), id);
		for (const id of ['uplot', 'uplot-release', 'chartjs', 'echarts'])
			assert.deepEqual(benchmarkMetadata[id], {sampling: 'minmax', context: '2d', lossy: false});
		assert.deepEqual(benchmarkMetadata.agcharts, {sampling: 'aggregation', context: '2d', lossy: false});
		assert.deepEqual(benchmarkMetadata.scichart, {sampling: 'minmax', context: 'webgl2', lossy: false});
		assert.equal(benchmarkMetadata.lightningchart.sampling, 'grouping');
		assert.equal(benchmarkMetadata.fusiontime.sampling, 'avg (1min)');
	});

	for (const measurements of [combined, {trace: true, memory: false, raf: false},
		{trace: false, memory: true, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`preserves lossy markers and metadata order in live and saved ${benchmarkMode(measurements)} successes, failures, and timeouts`, async () => {
			const h = harness();
			const worker = h.dependencies.runWorker;
			const failed = ['apexcharts-sampled', 'apexcharts', 'scichart'];
			const timedOut = ['fusiontime', 'chartjs'];
			h.dependencies.runWorker = async request => {
				if (failed.includes(request.variant))
					throw new Error('synthetic failure');
				if (timedOut.includes(request.variant))
					throw Object.assign(new Error('synthetic timeout'), {code: 'BENCHMARK_SAMPLE_TIMEOUT'});
				const raw = await worker(request);
				if (request.variant === 'uplot')
					raw.runner.benchmark.lossy = true;
				if (request.variant === 'chartgpu')
					raw.runner.benchmark.lossy = null;
				return raw;
			};
			const report = await runBenchmarkSuite({...measurements, vulkan: false}, h.dependencies);
			const original = structuredClone(report);
			const rows = h.frames.at(-1).rows;
			for (const row of rows) {
				const expected = row.variant === 'uplot' ? '*' : row.variant === 'chartgpu' ? '?'
					: benchmarkMetadata[row.variant].lossy === true ? '*' : benchmarkMetadata[row.variant].lossy === false ? '' : '?';
				assert.equal(row.lossy, expected, row.variant);
				assert.deepEqual(Object.keys(row).slice(0, 4), ['variant', 'context', 'sampling', 'lossy']);
				if ([...failed, ...timedOut].includes(row.variant))
					assert.ok(Object.entries(row).slice(4).every(([key, value]) => value === (key === 'hover10 ms' && !report.reports[0].hover.variants.includes(row.variant) ? '' : '-')));
			}
			const summary = offline(report);
			assert.deepEqual(summary.tables[0], rows.map(renderedRow));
			assert.deepEqual(summary.result, original);
			assert.deepEqual(report, original);
			assert.deepEqual(saved(benchmarkMode(measurements)), original);
		});
	}

	it('copies and persists metadata through the actual CLI runner and raw JSON write blocks', async () => {
		const source = readFileSync(new URL('../../scripts/benchmarks.mjs', import.meta.url), 'utf8');
		const start = source.indexOf('report.runner = {');
		const end = source.indexOf('\n\tconsole.log(`${values.variant}:', start);
		assert.ok(start > 0 && end > start);
		assert.ok(source.slice(start, end).includes('writeFileSync(output, JSON.stringify(report'));
		for (const variant of Object.keys(benchmarkMetadata)) {
			const report = {};
			await runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
				report, benchmarkVariantMetadata, values: {variant}, cpus: () => [], platform: () => 'linux', release: () => 'test',
				process: {version: 'test'}, binary: 'test', browserVersion: 'test', browserArgs: [], dpr: 1,
				dependencies: [], vulkan: false, files: new Map(), browserLog: '',
				measurements: {}, mode: 'raf', cache: directory, join, variantReportName, writeFileSync,
			});
			assert.notEqual(report.runner.benchmark, benchmarkMetadata[variant]);
			const output = join(directory, variantReportName('raf', variant));
			assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')).runner.benchmark, benchmarkMetadata[variant]);
		}
	});

	it('persists an independent suite snapshot before the first worker, including configured failures', async () => {
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = request => {
			const partial = saved('raf');
			assert.deepEqual(Object.keys(partial.variantMetadata), ['idle', 'scichart']);
			assert.deepEqual(partial.variantMetadata.scichart, benchmarkMetadata.scichart);
			if (request.variant === 'scichart')
				throw new Error('synthetic failure');
			return worker(request);
		};
		const report = await runBenchmarkSuite({raf: true, variant: 'scichart', vulkan: false}, h.dependencies);
		assert.notEqual(report.variantMetadata.scichart, benchmarkMetadata.scichart);
		assert.deepEqual(saved('raf').variantMetadata, report.variantMetadata);
		assert.deepEqual(h.frames.at(-1).rows[0], {
			variant: 'scichart', context: 'webgl2', sampling: benchmarkMetadata.scichart.sampling, lossy: '',
			'prep ms': '-', 'init rAF ms': '-', 'update ms': '-', 'next rAF ms': '-', 'resize rAF ms': '-', 'hover10 ms': '',
		});
		assert.deepEqual(offline(report).tables[0], h.frames.at(-1).rows);
	});

	it('uses raw snapshots for successful rows and suite snapshots only for failed or timed-out rows', () => {
		const raw = browser('uplot');
		raw.runner.benchmark = {sampling: 'raw reducer', context: 'svg', lossy: true};
		const input = {...savedReport([raw]),
			variantMetadata: {
				uplot: {sampling: 'not the raw snapshot', context: '2d', lossy: false},
				chartjs: {sampling: 'failed reducer', context: 'svg', lossy: true},
				chartgpu: {sampling: 'timeout reducer', context: 'webgpu', lossy: null},
			},
			failures: [{variant: 'chartjs', error: 'failed'}],
			timeouts: [{variant: 'chartgpu', error: 'timed out'}],
		};
		const result = offline(input);
		const metadata = Object.fromEntries(result.tables[0].map(({variant, sampling, context}) => [variant, {sampling, context}]));
		assert.deepEqual(metadata, {
			uplot: {sampling: 'raw reducer', context: 'svg'},
			chartjs: {sampling: 'failed reducer', context: 'svg'},
			chartgpu: {sampling: 'timeout reducer', context: 'webgpu'},
		});
		assert.deepEqual(result.tables[0].map(row => row.lossy), ['*', '?', '*']);
		assert.deepEqual(result.result.reports[0].runner.benchmark, raw.runner.benchmark);
		assert.deepEqual(result.result.variantMetadata, input.variantMetadata);
	});

	it('leaves no-sampling cells blank without losing stored metadata', () => {
		const raw = browser('apexcharts');
		const input = {...savedReport([raw]),
			variantMetadata: {chartgpu: benchmarkMetadata.chartgpu},
			failures: [{variant: 'chartgpu', error: 'failed'}],
		};
		const result = offline(input);
		const rows = Object.fromEntries(result.tables[0].map(row => [row.variant, row]));
		assert.equal(rows.apexcharts.sampling, '');
		assert.equal(rows.chartgpu.sampling, '');
		assert.equal(rows.apexcharts.lossy, '');
		assert.equal(rows.chartgpu.lossy, '');
		assert.equal(result.result.reports[0].runner.benchmark.sampling, 'none');
		assert.equal(result.result.variantMetadata.chartgpu.sampling, 'none');
		for (const id of ['uplot', 'chartjs', 'echarts', 'scichart'])
			assert.equal(benchmarkMetadata[id].sampling, 'minmax');
	});

	for (const variant of ['scichart', 'lightningchart', 'g2-webgl']) {
		for (const types of [[], ['webgl'], ['experimental-webgl'], ['webgl2'], ['webgl', 'webgl2']]) {
			it(`resolves null ${variant} snapshot with measured contexts ${JSON.stringify(types)}`, () => {
				const raw = browser(variant);
				raw.runner.benchmark.context = null;
				raw.samples[0].webgl = {contexts: [{type: 'webgl'}, {type: 'webgl2'}]};
				raw.samples[1].webgl = {contexts: types.map(type => ({type, status: 'complete'}))};
				const result = offline(savedReport([raw]));
				assert.equal(result.tables[0][0].context, types.length === 1 ? types[0].replace('experimental-', '') : 'unavailable');
				assert.equal(result.tables[0][0].sampling, benchmarkMetadata[variant].sampling === 'none' ? '' : benchmarkMetadata[variant].sampling);
				assert.equal(result.tables[0][0].lossy, variant === 'lightningchart' ? '?' : '');
				assert.equal(result.result.reports[0].runner.benchmark.context, null, 'inference does not overwrite the snapshot');
			});
		}
	}

	it('honors configured primary renderers without requiring rAF context acquisition', () => {
		const measurements = {trace: false, memory: false, raf: true};
		const reports = ['uplot', 'd3-svg', 'chartgpu', 'highcharts', 'scichart', 'lightningchart', 'g2-webgl'].map(id => browser(id, measurements));
		for (const raw of reports.slice(0, 4))
			raw.samples[1].webgl = {contexts: [{type: 'webgl'}, {type: 'webgl2'}]};
		const rows = offline(savedReport(reports, measurements)).tables[0];
		assert.deepEqual(rows.map(row => row.context), ['2d', 'svg', 'webgpu', 'webgl', 'webgl2', 'unavailable', 'unavailable']);
	});

	it('sorts by numeric totals rather than metadata labels', () => {
		const reports = ['uplot', 'chartjs', 'd3'].map(id => browser(id));
		for (const [i, raw] of reports.entries()) {
			raw.runner.benchmark = {sampling: ['a', 'z', 'm'][i], context: ['2d', 'webgpu', 'svg'][i], lossy: false};
			raw.analysis.groups[0].metrics.totalTrackedThreadWorkMs.mean = [10, 2, null][i];
		}
		assert.deepEqual(offline(savedReport(reports)).tables[0].map(row => row.variant), ['chartjs', 'uplot', 'd3']);
	});
});

describe('benchmark backend selection', () => {
	for (const platform of ['linux', 'darwin', 'win32']) {
		it(`resolves automatic selection and explicit overrides on ${platform}`, () => {
			assert.equal(resolveBenchmarkVulkan({}, platform), platform === 'linux');
			for (const variant of [undefined, null, ...variants]) {
				const automatic = platform === 'linux' && (variant == null || variant === 'chartgpu');
				assert.equal(resolveBenchmarkVulkan({variant}, platform), automatic);
				assert.equal(resolveBenchmarkVulkan({variant, vulkan: undefined}, platform), automatic);
				assert.equal(resolveBenchmarkVulkan({variant, vulkan: false}, platform), false);
				assert.equal(resolveBenchmarkVulkan({variant, vulkan: true}, platform), true);
				assert.equal(resolveBenchmarkVulkan({variant, 'no-vulkan': true}, platform), false);
				assert.equal(resolveBenchmarkVulkan({variant, 'no-vulkan': false}, platform), automatic);
				assert.throws(() => resolveBenchmarkVulkan({variant, vulkan: true, 'no-vulkan': true}, platform), /cannot be combined/);
			}
		});

		for (const flags of [{}, {trace: true}, {memory: true}, {raf: true}]) {
			for (const [selection, vulkan] of [
				[{}, platform === 'linux'],
				[{variant: 'chartgpu'}, platform === 'linux'],
				[{variant: 'd3'}, false],
				[{variant: 'idle'}, false],
				[{variant: 'chartgpu', vulkan: false}, false],
				[{variant: 'd3', vulkan: true}, true],
				[{'no-vulkan': true}, false],
			]) {
				it(`propagates ${platform} ${benchmarkMode(flags)} ${JSON.stringify(selection)} to every worker`, async () => {
					const options = {...flags, ...selection};
					const original = {...options};
					const h = harness({platform});
					const report = await runBenchmarkSuite(options, h.dependencies);
					const expected = selection.variant === undefined ? variants
						: selection.variant === 'idle' ? ['idle'] : ['idle', selection.variant];
					assert.deepEqual(h.requests.map(request => request.variant), expected);
					assert.deepEqual(options, original);
					assert.equal(report.complete, true);
					assert.equal(report.gpu, vulkan);
					assert.equal(report.requestedBackend, vulkan ? 'vulkan' : 'default');
					for (const request of h.requests) {
						assert.equal(request.vulkan, vulkan);
						assert.equal(request.gpu, vulkan);
						assert.equal(request.requestedBackend, report.requestedBackend);
						assert.equal(request.args.includes('--vulkan'), vulkan);
						assert.equal(request.args.includes('--no-vulkan'), !vulkan);
						assert.equal(request.args.includes('--gpu'), vulkan);
						assert.deepEqual(request.measurements, report.measurements);
						assert.equal(request.output, join(directory, variantReportName(report.mode, request.variant, {vulkan})));
						// Replaying the flags in a worker must preserve the suite decision, even for idle or ChartGPU.
						assert.equal(resolveBenchmarkVulkan({variant: request.variant,
							vulkan: request.args.includes('--vulkan') ? true : undefined,
							'no-vulkan': request.args.includes('--no-vulkan')}, platform), vulkan);
					}
					assert.ok(report.reports.every(raw => raw.runner.requestedBackend === report.requestedBackend));
					assert.deepEqual(JSON.parse(readFileSync(join(directory, suiteReportName(report.mode, {vulkan})), 'utf8')), report);
				});
			}
		}
	}

	it('keeps an explicit GPU request when automatic Vulkan is disabled', async () => {
		const h = harness({platform: 'linux'});
		const report = await runBenchmarkSuite({variant: 'chartgpu', gpu: true, 'no-vulkan': true}, h.dependencies);
		assert.equal(report.complete, true);
		assert.equal(report.gpu, true);
		assert.equal(report.requestedBackend, 'default');
		assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'chartgpu']);
		for (const request of h.requests) {
			assert.equal(request.vulkan, false);
			assert.equal(request.gpu, true);
			assert.equal(request.args.includes('--gpu'), true);
			assert.equal(request.args.includes('--no-vulkan'), true);
			assert.equal(request.args.includes('--vulkan'), false);
		}
	});

	it('rejects conflicting suite flags before worker or filesystem side effects', async () => {
		const outputDirectory = join(directory, 'not-created');
		const h = harness({outputDirectory});
		await assert.rejects(runBenchmarkSuite({vulkan: true, 'no-vulkan': true}, h.dependencies), /cannot be combined/);
		assert.equal(existsSync(outputDirectory), false);
		assert.deepEqual(h.requests, []);
		assert.deepEqual(h.events, []);
	});

	it('accepts both CLI overrides separately and rejects them together in either order', () => {
		const script = fileURLToPath(new URL('../../scripts/benchmarks.mjs', import.meta.url));
		for (const flag of [[], ['--vulkan'], ['--no-vulkan']]) {
			const child = spawnSync(process.execPath, [script, '--help', ...flag], {encoding: 'utf8', timeout: 10000});
			assert.equal(child.status, 0, child.stderr);
			assert.match(child.stdout, /automatically request Vulkan for every worker, including idle/);
			assert.match(child.stdout, /--no-vulkan to select the saved default report/);
		}
		for (const flags of [['--vulkan', '--no-vulkan'], ['--no-vulkan', '--vulkan']]) {
			const child = spawnSync(process.execPath, [script, '--summarize-only', ...flags], {encoding: 'utf8', timeout: 10000});
			assert.equal(child.status, 1, child.stderr);
			assert.match(child.stderr, /--vulkan and --no-vulkan cannot be combined/);
		}
	});
});

describe('benchmark suite modes and workers', () => {
	for (const measurements of [combined, {trace: true}, {memory: true}, {raf: true}]) {
		it(`continues after a library timeout and preserves dash rows in ${benchmarkMode(measurements)} summaries`, async () => {
			const mode = benchmarkMode(measurements);
			const [timedOut, nextVariant] = variants.slice(-4);
			const timedOutVariants = [timedOut, variants.at(-1)];
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = async request => {
				if (request.variant === nextVariant) {
					const partial = saved(mode);
					assert.deepEqual(partial.timeouts, [{variant: timedOut, dpr: 1, timeoutMs: 5000, error: `${timedOut}: timed out after 5s`}]);
					assert.equal(partial.complete, false);
					assert.equal(partial.progress.current, nextVariant);
					assert.equal(h.frames.at(-1).status, `Starting ${nextVariant} (${variants.indexOf(nextVariant) + 1}/${variants.length})...`);
					const row = h.frames.at(-1).rows.find(row => row.variant === timedOut);
					assert.ok(row);
					assert.ok(Object.entries(row).every(([key, value]) => ['variant', 'context', 'sampling', 'lossy'].includes(key) || value === (key === 'hover10 ms' && !partial.reports[0].hover.variants.includes(row.variant) ? '' : '-')));
				}
				if (timedOutVariants.includes(request.variant)) {
					h.requests.push(request);
					throw Object.assign(new Error(`${request.variant}: timed out after 5s`), {code: 'BENCHMARK_SAMPLE_TIMEOUT'});
				}
				return worker(request);
			};
			const report = await runBenchmarkSuite({...measurements, vulkan: false}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.equal(report.complete, true);
			assert.equal(report.progress.failed, null);
			assert.equal(report.progress.current, null);
			assert.equal('error' in report, false);
			assert.deepEqual(report.timeouts.map(entry => entry.variant), timedOutVariants);
			assert.deepEqual(report.progress.completed, variants.filter(id => !timedOutVariants.includes(id)));
			assert.deepEqual(report.reports.map(raw => raw.runner.variant), report.progress.completed);
			assert.equal(h.frames.at(-1).final, true, 'last-library timeout completes the suite');
			assert.match(h.frames.at(-1).status, new RegExp(`${variants.length}/${variants.length}`));
			const rows = h.frames.at(-1).rows;
			const labels = mode === 'combined' ? ['prep ms', 'init ms', 'main ms', 'gpu ms', 'update ms', 'peak MB', 'retained MB', 'resize ms', 'hover10 ms']
				: mode === 'trace' ? ['prep ms', 'init ms', 'main ms', 'gpu ms', 'update ms', 'resize ms', 'hover10 ms']
				: mode === 'memory' ? ['peak MB', 'retained MB'] : ['prep ms', 'init rAF ms', 'update ms', 'next rAF ms', 'resize rAF ms', 'hover10 ms'];
			for (const id of timedOutVariants) {
				assert.deepEqual(rows.find(row => row.variant === id), {variant: id, ...benchmarkMetadata[id],
									sampling: benchmarkMetadata[id].sampling === 'none' ? '' : benchmarkMetadata[id].sampling,
									lossy: benchmarkMetadata[id].lossy ? '*' : '',
									...Object.fromEntries(labels.map(label => [label, label === 'hover10 ms' && !report.reports[0].hover.variants.includes(id) ? '' : '-']))});
				assert.equal(existsSync(join(directory, variantReportName(mode, id))), false);
			}
			assert.deepEqual(rows.map(row => row.variant), groupedVariants(variants.slice(1)));
			for (const id of timedOutVariants)
				assert.equal(rows[rows.findIndex(row => row.variant === id) - 1].variant, id + '-sampled');
			assert.deepEqual(offline(report).tables[0], rows.map(renderedRow));
			assert.deepEqual(saved(mode), report);
		});
	}

	it('finishes an explicitly selected timed-out library without loading a stale report', async () => {
		const stale = join(directory, variantReportName('combined', 'g2'));
		writeFileSync(stale, JSON.stringify(browser('g2')));
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			if (request.variant === 'g2')
				throw Object.assign(new Error('g2: timed out after 5s'), {code: 'BENCHMARK_SAMPLE_TIMEOUT'});
			return worker(request);
		};
		const report = await runBenchmarkSuite({variant: 'g2'}, h.dependencies);
		assert.equal(report.complete, true);
		assert.equal(existsSync(stale), false);
		assert.deepEqual(report.reports.map(raw => raw.runner.variant), ['idle']);
		assert.equal(report.timeouts.length, 1);
		assert.equal(h.frames.at(-1).rows[0].lossy, '');
				assert.ok(Object.entries(h.frames.at(-1).rows[0]).slice(4).every(([key, value]) => value === (key === 'hover10 ms' ? '' : '-')));
	});

	for (let mask = 0; mask < 8; mask++) {
		const flags = {trace: !!(mask & 1), memory: !!(mask & 2), raf: !!(mask & 4)};
		if (flags.raf && (flags.trace || flags.memory)) {
			it(`rejects incompatible measurements before side effects: ${JSON.stringify(flags)}`, async () => {
				const error = /raf cannot be combined with trace or memory/;
				assert.throws(() => benchmarkMode(flags), error);
				const outputDirectory = join(directory, 'not-created');
				const h = harness({outputDirectory});
				await assert.rejects(runBenchmarkSuite(flags, h.dependencies), error);
				assert.equal(existsSync(outputDirectory), false);
				assert.deepEqual(h.requests, []);
				assert.deepEqual(h.events, []);
				assert.throws(() => summarizeSavedBenchmarks(flags), error);
				const output = join(directory, 'saved.json');
				const contents = JSON.stringify({mode: 'combined', measurements: flags, reports: []});
				writeFileSync(output, contents);
				assert.throws(() => summarizeSavedBenchmarks(flags, output), error);
				assert.equal(readFileSync(output, 'utf8'), contents);
			});
			continue;
		}
		const mode = mask === 1 ? 'trace' : mask === 2 ? 'memory' : mask === 4 ? 'raf' : 'combined';
		it(`selects ${mode} and explicit worker flags for ${JSON.stringify(flags)}`, async () => {
			assert.equal(benchmarkMode(flags), mode);
			assert.equal(variantReportName(mode, 'uplot'), `results-chrome-${mode}-uplot.json`);
			assert.equal(suiteReportName(mode), `results-chrome-${mode}.json`);
			const h = harness();
			const report = await runBenchmarkSuite({...flags, variant: 'd3', dpr: 2, gpu: true}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'd3']);
			for (const request of h.requests) {
				assert.equal(request.command, process.execPath);
				assert.match(request.args[1], /scripts\/benchmarks\.mjs$/);
				assert.deepEqual(request.args.slice(2), ['--worker', '--variant', request.variant, '--dpr', '2',
					...Object.keys(mask === 0 ? combined : flags).filter(key => (mask === 0 ? combined : flags)[key]).map(key => `--${key}`), '--gpu', '--no-vulkan']);
				assert.equal(request.timeoutMs, 270000);
			}
			assert.equal(report.complete, true);
			assert.deepEqual(report.skipped, []);
			assert.ok(h.frames.every(frame => frame.warnings.length === 0));
			assert.equal('heapMemory' in report, false);
			const persisted = saved(mode);
			assert.equal(persisted.dpr, 2);
			assert.deepEqual(persisted.reports, report.reports);
			for (const raw of persisted.reports) {
				assert.equal(raw.runner.dpr, 2);
				assert.ok(raw.samples.every(sample => sample.dpr === 2));
				assert.equal(raw.samples.filter(sample => !sample.warmup).length, 3);
				for (const analysis of [raw.analysis, raw.rafAnalysis].filter(Boolean)) {
					assert.equal(analysis.groups[0].dpr, 2);
					assert.equal(analysis.groups[0].sampleCount, 3);
					assert.equal(analysis.groups[0].warmupCount, 1);
					assert.equal(analysis.groups[0].metrics.dataPrepMs.count, 3);
				}
			}
			assert.equal('n' in h.tables[0][0], false);
			assert.equal('dpr' in h.tables[0][0], false);
		});
	}

	for (const flags of [{}, {trace: true}, {memory: true}, {raf: true}]) {
		for (const vulkan of [false, true]) {
			it(`runs explicit ChartGPU in ${benchmarkMode(flags)} with vulkan=${vulkan} and isolates its files`, async () => {
				const mode = benchmarkMode(flags);
				const suffix = vulkan ? '-vulkan' : '';
				assert.equal(variantReportName(mode, 'chartgpu', {vulkan}), `results-chrome-${mode}${suffix}-chartgpu.json`);
				assert.equal(suiteReportName(mode, {vulkan}), `results-chrome-${mode}${suffix}.json`);
				const otherSuite = join(directory, suiteReportName(mode, {vulkan: !vulkan}));
				const otherIdle = join(directory, variantReportName(mode, 'idle', {vulkan: !vulkan}));
				const otherChart = join(directory, variantReportName(mode, 'chartgpu', {vulkan: !vulkan}));
				for (const path of [otherSuite, otherIdle, otherChart])
					writeFileSync(path, 'unrelated saved report');
				const h = harness();
				const report = await runBenchmarkSuite({...flags, variant: 'chartgpu', vulkan}, h.dependencies);
				assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'chartgpu']);
				assert.equal(report.gpu, vulkan);
				assert.equal(report.requestedBackend, vulkan ? 'vulkan' : 'default');
				assert.equal(report.complete, true);
				assert.deepEqual(report.skipped, []);
				for (const request of h.requests) {
					assert.equal(request.args.includes('--vulkan'), vulkan);
					assert.equal(request.args.includes('--no-vulkan'), !vulkan);
					assert.equal(request.args.includes('--gpu'), vulkan);
					assert.equal(request.gpu, vulkan);
					assert.equal(request.requestedBackend, report.requestedBackend);
					assert.equal(request.output, join(directory, variantReportName(mode, request.variant, {vulkan})));
				}
				assert.ok(report.reports.every(raw => raw.runner.requestedBackend === report.requestedBackend));
				assert.deepEqual(JSON.parse(readFileSync(join(directory, suiteReportName(mode, {vulkan})), 'utf8')), report);
				for (const path of [otherSuite, otherIdle, otherChart])
					assert.equal(readFileSync(path, 'utf8'), 'unrelated saved report');
			});
		}
	}

	for (const variant of ['idle', 'chartgpu']) {
		for (const backend of [undefined, 'default']) {
			it(`rejects ${variant} backend=${backend} in a Vulkan suite without mixing samples`, async () => {
				const h = harness();
				const worker = h.dependencies.runWorker;
				h.dependencies.runWorker = async request => {
					const raw = await worker(request);
					if (request.variant === variant)
						raw.runner.requestedBackend = backend;
					return raw;
				};
				const run = runBenchmarkSuite({variant: 'chartgpu', vulkan: true}, h.dependencies);
				if (variant === 'idle')
					await assert.rejects(run, /Unexpected benchmark report for idle/);
				else {
					const report = await run;
					assert.deepEqual(report.reports.map(raw => raw.runner.variant), ['idle']);
					assert.match(report.failures[0].error, /Unexpected benchmark report for chartgpu/);
				}
			});
		}
	}

	it('includes ChartGPU in a full Vulkan suite with the same backend for every worker', async () => {
		const h = harness();
		const result = await runBenchmarkSuite({vulkan: true}, h.dependencies);
		assert.deepEqual(h.requests.map(request => request.variant), variants);
		assert.equal(h.requests.filter(request => request.variant === 'chartgpu').length, 1);
		assert.equal(result.skipped.some(entry => entry.variant === 'chartgpu'), false);
		assert.equal(result.complete, true);
		assert.ok(h.requests.every(request => request.requestedBackend === 'vulkan' &&
			request.args.includes('--vulkan') && request.args.includes('--gpu')));
		assert.ok(result.reports.every(raw => raw.runner.requestedBackend === 'vulkan'));
	});

	it('runs idle and all default runnable libraries and saves/displays each before the next starts', async () => {
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			const partial = saved();
			assert.equal(partial.complete, false);
			assert.equal(partial.progress.current, request.variant);
			assert.deepEqual(partial.progress.completed, h.requests.map(request => request.variant));
			assert.deepEqual(partial.reports.map(report => report.runner.variant), partial.progress.completed);
			const frame = h.frames.at(-1);
			assert.equal(frame.status, `Starting ${request.variant} (${partial.progress.completed.length + 1}/${variants.length})...`);
			assert.notEqual(frame.final, true);
			assert.deepEqual(frame.rows.map(row => row.variant), groupedVariants(partial.progress.completed.filter(variant => variant !== 'idle')));
			assert.deepEqual(frame.warnings, []);
			assert.deepEqual(partial.skipped, skipped);
			if (request.variant === 'idle')
				assert.deepEqual(partial.adjustedAnalysis.groups, []);
			if (request.variant === 'chartjs') {
				assert.deepEqual(h.tables[0].map(row => row.variant), ['uplot']);
				assert.deepEqual(frame.rows, h.frames.at(-2).rows);
			}
			return worker(request);
		};
		assert.equal(benchmarkMode({}), 'combined');
		const result = await runBenchmarkSuite({vulkan: false}, h.dependencies);
		assert.deepEqual(result.progress.completed, variants);
		assert.deepEqual(result.protocol.variants.slice(-12), variants.slice(-12));
		assert.deepEqual(result.skipped.map(entry => entry.variant), ['lightningchart', 'g2-webgl', 'googlecharts', 'jscharting']);
		assert.equal(result.protocol.variants.length, 45, 'idle plus 44 runnable variants');
		assert.deepEqual(result.variantMetadata, Object.fromEntries(variants.map(id => [id, benchmarkMetadata[id]])));
		assert.deepEqual(saved().variantMetadata, result.variantMetadata);
				assert.equal(h.requests.filter(request => request.variant === 'chartgpu').length, 1);
		assert.ok(h.requests.every(request => !Object.hasOwn(benchmarkRestrictions, request.variant)));
		assert.equal(result.progress.total, variants.length);
		assert.deepEqual(result.protocol.variants, variants);
		assert.deepEqual(result.skipped, skipped);
		assert.deepEqual(h.tables.map(rows => rows.map(row => row.variant)), variants.slice(1).map((_, i) => groupedVariants(variants.slice(1, i + 2))));
		assert.equal(h.events.filter(event => event.startsWith('Starting')).length, variants.length);
		assert.equal(h.events.filter(event => event.startsWith('Completed')).length, variants.length);
		assert.equal(h.frames.length, variants.length * 2);
		assert.ok(h.frames.slice(0, -1).every(frame => !frame.final));
		assert.deepEqual(h.frames.at(-1), {
			rows: h.tables.at(-1), warnings: [],
			status: `Completed ${variants.at(-1)} (${variants.length}/${variants.length}).`, final: true,
		});
		assert.deepEqual(saved(), result);
		assert.equal(result.protocol.coolingBetweenVariantsMs, 0);
		assert.equal(result.protocol.freshBrowserPerVariant, true);
		assert.equal(h.requests[0].args.includes('--gpu'), false);
	});

	for (const measurements of [combined, {trace: true}, {raf: true}]) {
		it(`groups each live and saved ${benchmarkMode(measurements)} table by its fastest sibling without changing execution or raw IDs`, async () => {
			const speeds = {
				uplot: 10.04, chartjs: 2, echarts: 10.01, flot: 2, dygraphs: null,
				d3: 50, 'd3-svg': 1, bokeh: 60, 'bokeh-canvas': 0,
				apexcharts: 70, 'apexcharts-sampled': 1.5,
				amcharts: null, 'amcharts-sampled': 3,
			};
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = async request => {
				if (request.variant === 'plotly-svg') {
					h.requests.push(request);
					throw new Error('plotly-svg synthetic failure');
				}
				const raw = await worker(request);
				const value = Object.hasOwn(speeds, request.variant) ? speeds[request.variant] : 20;
				const metrics = (raw.analysis ?? raw.rafAnalysis).groups[0].metrics;
				metrics[measurements.raf ? 'raf1Ms' : 'totalTrackedThreadWorkMs'][measurements.raf ? 'min' : 'mean'] = value;
				return raw;
			};
			const report = await runBenchmarkSuite({...measurements, vulkan: false}, h.dependencies);
			const ids = frame => frame.rows.map(row => row.variant);
			const completed = id => h.frames.find(frame => frame.status.startsWith(`Completed ${id} (`));
			assert.deepEqual(ids(completed('d3')).slice(0, 5), ['chartjs', 'echarts', 'uplot', 'uplot-release', 'd3-minmax']);
			assert.deepEqual(ids(completed('d3-svg')).slice(0, 6), ['bokeh-canvas', 'bokeh', 'd3-svg', 'd3-minmax', 'd3-svg-minmax', 'd3']);
			assert.deepEqual(ids(completed('bokeh-canvas')).slice(0, 6), ['bokeh-canvas', 'bokeh', 'apexcharts-sampled', 'apexcharts', 'chartjs', 'flot']);
			const rows = h.frames.at(-1).rows;
			assert.deepEqual(rows.slice(0, 15).map(row => row.variant), [
				'bokeh-canvas', 'bokeh', 'd3-svg', 'd3-minmax', 'd3-svg-minmax', 'd3', 'apexcharts-sampled', 'apexcharts',
				'chartjs', 'flot', 'amcharts-sampled', 'amcharts', 'echarts', 'uplot', 'uplot-release',
			]);
			assert.equal(rows.at(-1).variant, 'dygraphs');
			assert.equal(rows[rows.findIndex(row => row.variant === 'plotly') + 1].variant, 'plotly-svg');
			for (const frame of h.frames) {
				const libraries = frame.rows.map(row => benchmarkLibraryName(row.variant));
				for (const library of new Set(libraries))
					assert.equal(libraries.lastIndexOf(library) - libraries.indexOf(library) + 1, libraries.filter(name => name === library).length);
			}
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.deepEqual(report.reports.map(raw => raw.runner.variant), variants.filter(id => id !== 'plotly-svg'));
			assert.deepEqual(report.progress.completed, report.reports.map(raw => raw.runner.variant));
			assert.deepEqual(report.protocol.variants, variants);
			for (const request of h.requests) {
				assert.equal(request.args[request.args.indexOf('--variant') + 1], request.variant);
				assert.ok(request.output.endsWith(`-${request.variant}.json`));
			}
			assert.ok(h.frames.at(-1).warnings.includes('plotly-svg: plotly-svg synthetic failure'));
			const original = structuredClone(report);
			const summary = offline(report);
			assert.deepEqual(summary.tables[0], rows.map(renderedRow));
			assert.deepEqual(summary.result.reports, original.reports);
			assert.deepEqual(summary.result.failures, original.failures);
			assert.deepEqual(report, original);
			assert.deepEqual(saved(benchmarkMode(measurements)), original);
		});
	}

	for (const variant of benchmarkVariants.filter(variant => !['uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs'].includes(variant))) {
		it(`runs explicitly selected ${variant} with idle and no skipped warnings`, async () => {
			const h = harness();
			const report = await runBenchmarkSuite({variant, vulkan: false}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), ['idle', variant]);
			assert.deepEqual(report.skipped, []);
			assert.deepEqual(saved().skipped, []);
			assert.ok(h.frames.every(frame => frame.warnings.length === 0));
			assert.equal(report.complete, true);
		});
	}

	for (const [variant, reason] of Object.entries({...demoRestrictions, ...benchmarkRestrictions})) {
		it(`rejects explicit ${variant} before creating reports or starting even a fake worker`, async () => {
			const outputDirectory = join(directory, 'not-created');
			const h = harness({outputDirectory});
			await assert.rejects(runBenchmarkSuite({variant}, h.dependencies), error => error.message.includes(reason));
			assert.equal(existsSync(outputDirectory), false);
			assert.deepEqual(h.requests, []);
			assert.deepEqual(h.events, []);
		});
	}

	for (const variant of [null, 'lightningchart']) {
		it(`includes licensed LightningChart with variant=${variant}`, async () => {
			const h = harness();
			const lightningOptions = Object.freeze({license: 'test-license-not-a-vendor-key'});
			const report = await runBenchmarkSuite({variant, lightningOptions, vulkan: false}, h.dependencies);
			const expected = variant === null ? [...variants, 'lightningchart'] : ['idle', 'lightningchart'];
			assert.deepEqual(h.requests.map(request => request.variant), expected);
			assert.deepEqual(report.protocol.variants, expected);
			assert.deepEqual(report.progress.completed, expected);
			assert.equal(report.progress.total, expected.length);
			assert.equal(report.complete, true);
			const expectedSkipped = variant === null ? skipped.filter(entry => !Object.hasOwn(demoRestrictions, entry.variant)) : [];
			assert.deepEqual(report.skipped, expectedSkipped);
			assert.ok(h.frames.every(frame => frame.warnings.length === 0));
			assert.ok(h.requests.every(request => request.variant !== 'jscharting'));
			assert.deepEqual(saved(), report);
			assert.equal(h.tables.at(-1).at(-1).variant, 'lightningchart');
			assert.ok(h.requests.every(request => !request.args.some(arg => /license|permission/i.test(arg))));
			assert.doesNotMatch(JSON.stringify(report), /test-license-not-a-vendor-key/);
		});
	}

	it('rejects explicit JSCharting even with a LightningChart license without overwriting saved reports', async () => {
		const output = join(directory, suiteReportName('combined'));
		const original = '{"preserve":"prior report"}\n';
		writeFileSync(output, original);
		const h = harness();
		await assert.rejects(runBenchmarkSuite({variant: 'jscharting',
			lightningOptions: {license: 'test'}}, h.dependencies), error =>
			error.message === `jscharting: ${benchmarkRestrictions.jscharting}`);
		assert.deepEqual(h.requests, []);
		assert.deepEqual(h.frames, []);
		assert.equal(readFileSync(output, 'utf8'), original);
	});

	for (const [name, lightningOptions] of [['missing', {}], ['empty', {license: ''}], ['whitespace', {license: ' \t '}]]) {
		it(`keeps LightningChart skipped by default for a ${name} license`, async () => {
			const h = harness();
			const report = await runBenchmarkSuite({lightningOptions}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.deepEqual(report.skipped, skipped);
			assert.deepEqual(h.frames.at(-1).warnings, []);
		});
	}

	it('does not add licensed LightningChart to an explicitly selected unrelated variant', async () => {
		const h = harness();
		const report = await runBenchmarkSuite({variant: 'scichart', lightningOptions: {license: 'test'}}, h.dependencies);
		assert.deepEqual(report.protocol.variants, ['idle', 'scichart']);
		assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'scichart']);
		assert.deepEqual(report.skipped, []);
	});

	it('rejects unknown and inherited variant names before worker side effects', async () => {
		for (const variant of ['unknown', 'toString', '__proto__']) {
			const h = harness();
			await assert.rejects(runBenchmarkSuite({variant}, h.dependencies), /Unsupported benchmark variant/);
			assert.deepEqual(h.requests, []);
			assert.deepEqual(h.events, []);
		}
	});

	it('runs an explicitly selected idle only once', async () => {
		const h = harness();
		const report = await runBenchmarkSuite({memory: true, variant: 'idle'}, h.dependencies);
		assert.deepEqual(report.skipped, []);
		assert.deepEqual(h.requests.map(request => request.variant), ['idle']);
		assert.deepEqual(h.tables, []);
		assert.deepEqual(h.frames.at(-1), {rows: [], warnings: [], status: 'Completed idle (1/1).', final: true});
	});

	for (const measurements of [combined, {trace: true}, {memory: true}, {raf: true}]) {
		it(`continues after library errors and preserves failure rows in ${benchmarkMode(measurements)}`, async () => {
			const failedVariants = [variants[2], variants.at(-1)];
			const nextVariant = variants[3];
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = request => {
				if (request.variant === nextVariant) {
					const partial = saved(benchmarkMode(measurements));
					assert.equal(partial.failures[0].variant, failedVariants[0]);
					assert.equal(partial.progress.current, nextVariant);
					assert.deepEqual(partial.progress.completed, variants.slice(0, 2));
				}
				if (failedVariants.includes(request.variant)) {
					h.requests.push(request);
					throw new Error('synthetic worker failure');
				}
				return worker(request);
			};
			const result = await runBenchmarkSuite({...measurements, vulkan: false}, h.dependencies);
			assert.equal(result.complete, true);
			assert.equal(result.progress.failed, null);
			assert.equal(result.progress.current, null);
			assert.equal('error' in result, false);
			assert.deepEqual(result.failures, failedVariants.map(variant => ({variant, dpr: 1, error: 'synthetic worker failure'})));
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.deepEqual(result.reports.map(raw => raw.runner.variant), variants.filter(id => !failedVariants.includes(id)));
			const frame = h.frames.at(-1);
			assert.equal(frame.final, true);
			assert.equal(frame.status, `Failed ${variants.at(-1)} (${variants.length}/${variants.length}).`);
			for (const id of failedVariants) {
				assert.ok(frame.warnings.includes(`${id}: synthetic worker failure`));
				assert.ok(Object.entries(frame.rows.find(row => row.variant === id)).every(([key, value]) => ['variant', 'context', 'sampling', 'lossy'].includes(key) || value === (key === 'hover10 ms' && !result.reports[0].hover.variants.includes(id) ? '' : '-')));
			}
			assert.deepEqual(offline(result).tables[0], frame.rows.map(renderedRow));
		});
	}

	for (const failure of ['missing', 'invalid JSON', 'mismatch']) {
		it(`rejects a library's ${failure} report without stopping later workers`, async () => {
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = request => {
				if (request.variant !== 'chartjs') return worker(request);
				if (failure === 'invalid JSON') writeFileSync(request.output, '{');
				if (failure === 'mismatch') return browser('uplot');
			};
			const result = await runBenchmarkSuite({}, h.dependencies);
			assert.equal(result.complete, true);
			assert.deepEqual(result.failures.map(entry => entry.variant), ['chartjs']);
			assert.equal(result.reports.some(raw => raw.runner.variant === 'chartjs'), false);
			assert.equal(result.progress.completed.at(-1), variants.at(-1));
		});
	}

	it('keeps completed rows and warnings in the next worker start and final display', async () => {
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = async request => {
				if (request.variant === 'chartjs') {
					const completed = h.frames.at(-2), starting = h.frames.at(-1);
					assert.deepEqual(starting.rows, completed.rows);
					assert.deepEqual(starting.warnings, completed.warnings);
					assert.deepEqual(starting.warnings, ['uplot (DPR 1): gpu ms (2/3 valid, 1 missing).']);
				}
				const raw = await worker(request);
				if (request.variant === 'uplot')
					raw.analysis.groups[0].metrics.gpuMainTaskMs = {min: 2, mean: 4, count: 2, missing: 1};
				return raw;
			};
			await runBenchmarkSuite({}, h.dependencies);
			assert.deepEqual(h.frames.at(-1).warnings, h.frames.at(-2).warnings);
			assert.equal(h.frames.at(-1).final, true);
		});

		it('removes stale variant files and never blends a prior suite or idle', async () => {
		writeFileSync(join(directory, suiteReportName('combined')), JSON.stringify(savedReport([browser('idle'), browser('d3')])));
		const stale = join(directory, variantReportName('combined', 'idle'));
		writeFileSync(stale, JSON.stringify(browser('idle')));
		const h = harness({runWorker: async request => { assert.equal(existsSync(request.output), false); }});
		await assert.rejects(runBenchmarkSuite({vulkan: false}, h.dependencies), /ENOENT/);
		assert.deepEqual(saved().reports, []);
		assert.deepEqual(saved().adjustedAnalysis.controls, []);
	});

	it('accepts fresh worker files and rejects mismatched report metadata', async () => {
		const h = harness({runWorker: async request => {
			writeFileSync(request.output, JSON.stringify(browser(request.variant, request.measurements, request.dpr)));
		}});
		await runBenchmarkSuite({variant: 'idle'}, h.dependencies);
		for (const corrupt of [raw => raw.runner.requestedBackend = 'vulkan', raw => delete raw.runner.requestedBackend, raw => raw.runner.variant = 'd3', raw => raw.runner.dpr = 2, raw => raw.measurements.memory = false, raw => raw.samples[0].variant = 'd3']) {
			h.dependencies.runWorker = async () => {
				const raw = browser('idle');
				corrupt(raw);
				return raw;
			};
			await assert.rejects(runBenchmarkSuite({vulkan: false}, h.dependencies), /Unexpected benchmark report/);
			assert.deepEqual(saved().reports, []);
		}
	});
});

describe('benchmark verbosity', () => {
	// Two CLI processes each have a 10-second startup and execution budget.
		it('accepts the boolean CLI flag and documents live and saved summaries', {timeout: 25000}, () => {
		const script = fileURLToPath(new URL('../../scripts/benchmarks.mjs', import.meta.url));
		const child = spawnSync(process.execPath, [script, '--help', '--verbose'], {encoding: 'utf8', timeout: 10000});
		assert.ifError(child.error);
		assert.equal(child.status, 0, child.stderr);
		assert.match(child.stdout, /--verbose to show main ms and gpu ms.*live tables and saved summaries/);
		assert.match(child.stdout, /hover10 ms/);
		const invalid = spawnSync(process.execPath, [script, '--help', '--verbose=false'], {encoding: 'utf8', timeout: 10000});
		assert.ifError(invalid.error);
		assert.equal(invalid.status, 1, invalid.stderr);
		assert.match(invalid.stderr, /does not take an argument/);
	});

	it('forwards false by default and true with --verbose through both actual CLI dispatch paths', async () => {
		const source = readFileSync(new URL('../../scripts/benchmarks.mjs', import.meta.url), 'utf8');
		const start = source.indexOf('const chromeVersion =');
		const end = source.indexOf('const binary = await chromeBinary(');
		assert.ok(start >= 0 && end > start);
		for (const summarize of [false, true]) {
			for (const verbose of [false, true]) {
				const calls = [];
				const exited = new Error('CLI exited');
				const args = ['--no-vulkan', ...(summarize ? ['--summarize-only'] : []), ...(verbose ? ['--verbose'] : [])];
				await assert.rejects(runInNewContext(`(async () => {${source.slice(start, end)}})()`, {
					parseArgs: options => parseArgs({...options, args}),
					resolveBenchmarkVulkan, benchmarkMode,
					platform: () => 'linux',
					process: {env: {}, exit: code => { assert.equal(code, 0); throw exited; }},
					runBenchmarkSuite: async options => calls.push(['live', options]),
					summarizeSavedBenchmarks: options => calls.push(['saved', options]),
				}), error => error === exited);
				assert.equal(calls.length, 1);
				assert.equal(calls[0][0], summarize ? 'saved' : 'live');
				assert.equal(calls[0][1].verbose, verbose);
				assert.equal(calls[0][1].trace, true);
				assert.equal(calls[0][1].memory, true);
			}
		}
	});

	for (const measurements of [combined, {trace: true, memory: false, raf: false},
		{trace: false, memory: true, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`${benchmarkMode(measurements)} saved verbosity changes only table columns`, () => {
			const input = savedReport(['idle', 'uplot'].map(variant => hoverBrowser(variant, measurements)), measurements);
			const original = structuredClone(input);
			const normal = offline(input, {});
			const bytes = readFileSync(join(directory, 'offline.json'), 'utf8');
			const verbose = offline(input, {verbose: true});
			assert.deepEqual(input, original);
			assert.deepEqual(normal.result, verbose.result);
			assert.equal(readFileSync(join(directory, 'offline.json'), 'utf8'), bytes);
			assert.deepEqual(normal.logs, verbose.logs);
			assert.deepEqual(normal.tables[0], verbose.tables[0].map(row => Object.fromEntries(
				Object.entries(row).filter(([key]) => key !== 'main ms' && key !== 'gpu ms'))));
			for (const key of ['main ms', 'gpu ms']) {
				assert.equal(Object.hasOwn(normal.tables[0][0], key), false);
				assert.equal(Object.hasOwn(verbose.tables[0][0], key), measurements.trace);
			}
			assert.equal(Object.hasOwn(normal.tables[0][0], 'hover10 ms'), measurements.trace || measurements.raf);
		});
	}

	it('passes verbosity to the live formatter without changing worker requests, full rows, or reports', async () => {
		const outputs = [], reports = [], requests = [], rows = [];
		for (const options of [{}, {verbose: true}]) {
			const h = harness();
			await runBenchmarkSuite({variant: 'uplot', vulkan: false, ...options}, h.dependencies);
			rows.push(h.frames.at(-1).rows);
			const writes = [];
			const write = process.stdout.write;
			const noColor = process.env.NO_COLOR;
			try {
				process.env.NO_COLOR = '1';
				process.stdout.write = chunk => { writes.push(String(chunk)); return true; };
				const report = await runBenchmarkSuite({variant: 'uplot', vulkan: false, ...options}, {...h.dependencies, display: undefined});
				const {date, ...stable} = report;
				reports.push(stable);
			}
			finally {
				process.stdout.write = write;
				if (noColor === undefined) delete process.env.NO_COLOR;
				else process.env.NO_COLOR = noColor;
			}
			outputs.push(writes.join(''));
			requests.push(h.requests);
		}
		assert.deepEqual(requests[0], requests[1]);
		assert.deepEqual(reports[0], reports[1]);
		assert.deepEqual(rows[0], rows[1]);
		assert.equal(rows[0][0]['main ms'], 3);
		assert.equal(rows[0][0]['gpu ms'], 4);
		assert.equal(Object.hasOwn(reports[0], 'verbose'), false);
		for (const request of requests.flat()) assert.ok(!request.args.includes('--verbose'));
		assert.doesNotMatch(outputs[0], /main ms|gpu ms/);
		assert.match(outputs[1], /main ms/);
		assert.match(outputs[1], /gpu ms/);
	});
});

describe('benchmark table and offline summary', () => {
	it('uses the live TTY color policy offline without coloring saved reports or metrics', () => {
		const output = join(directory, 'offline-colors.json');
		const input = savedReport([browser('idle'), browser('uplot')]);
		writeFileSync(output, JSON.stringify(input));
		const {log} = console;
		const env = process.env;
		const descriptors = Object.fromEntries(['isTTY', 'getColorDepth'].map(key => [key, Object.getOwnPropertyDescriptor(process.stdout, key)]));
		const logs = [];
		try {
			console.log = (...args) => logs.push(args.join(' '));
			let plain, savedBytes;
			for (const [isTTY, depth, environment, prefix] of [
				[true, 24, {NO_COLOR: ''}, ''],
				[true, 24, {}, '\x1b[38;2;34;197;94m'],
				[true, 8, {}, '\x1b[38;5;41m'],
				[true, 4, {}, ''],
				[true, undefined, {}, ''],
				[true, 24, {NO_COLOR: '', FORCE_COLOR: '3'}, ''],
				[true, 24, {TERM: 'dumb', FORCE_COLOR: '3'}, ''],
				[false, 24, {FORCE_COLOR: '3'}, ''],
			]) {
				process.env = environment;
				Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: isTTY});
				Object.defineProperty(process.stdout, 'getColorDepth', {configurable: true, value: depth === undefined ? undefined : received => {
					assert.equal(received, environment);
					return depth;
				}});
				logs.length = 0;
				const result = summarizeSavedBenchmarks({...combined, vulkan: false}, output);
				plain ??= logs[0];
				const contextPrefix = depth === 24 ? '\x1b[38;2;96;165;250m' : '\x1b[38;5;75m';
				const peakPrefix = depth === 24 ? '\x1b[38;2;251;146;60m' : '\x1b[38;5;209m';
				assert.equal(logs[0], prefix ? plain
					.replace(/(?<= )(?:0|2|5)\.0(?= │)/g, value => `${prefix}${value}\x1b[39m`)
					.replace('45.0', `${peakPrefix}45.0\x1b[39m`)
					.replace('2d', `${contextPrefix}2d\x1b[39m`) : plain);
				assert.deepEqual(logs.slice(1), ['Updated summary from saved samples. No browser was started.']);
				assert.deepEqual(result.reports, input.reports);
				const bytes = readFileSync(output, 'utf8');
				savedBytes ??= bytes;
				assert.equal(bytes, savedBytes);
				assert.doesNotMatch(bytes, /\x1b|\\u001b/i);
			}
		}
		finally {
			console.log = log;
			process.env = env;
			for (const [key, descriptor] of Object.entries(descriptors)) {
				if (descriptor)
					Object.defineProperty(process.stdout, key, descriptor);
				else
					delete process.stdout[key];
			}
		}
	});
	for (const platform of ['linux', 'darwin', 'win32']) {
		for (const flags of [{}, {trace: true}, {memory: true}, {raf: true}]) {
			for (const [selection, vulkan] of [[{}, platform === 'linux'], [{vulkan: true}, true], [{vulkan: false}, false], [{'no-vulkan': true}, false]]) {
				it(`selects only the saved ${vulkan ? 'Vulkan' : 'default'} ${benchmarkMode(flags)} report on ${platform} with ${JSON.stringify(selection)}`, () => {
					const mode = benchmarkMode(flags);
					const measurements = {trace: mode === 'combined' || mode === 'trace', memory: mode === 'combined' || mode === 'memory', raf: mode === 'raf'};
					const options = {...flags, ...selection};
					const dependencies = {platform, outputDirectory: directory};
					const inputs = [false, true].map(vulkan => {
						const report = savedReport(['idle', 'chartgpu'].map(variant => browser(variant, measurements, 1, vulkan ? 'vulkan' : 'default')), measurements);
						if (vulkan)
							report.requestedBackend = 'vulkan';
						const bytes = JSON.stringify(report);
						writeFileSync(join(directory, suiteReportName(mode, {vulkan})), bytes);
						return bytes;
					});
					const selected = join(directory, suiteReportName(mode, {vulkan}));
					const other = join(directory, suiteReportName(mode, {vulkan: !vulkan}));
					const result = capture(() => summarizeSavedBenchmarks(options, undefined, dependencies)).result;
					assert.equal(result.requestedBackend, vulkan ? 'vulkan' : 'default');
					assert.deepEqual(result.reports, JSON.parse(inputs[Number(vulkan)]).reports);
					assert.equal(readFileSync(other, 'utf8'), inputs[Number(!vulkan)]);
					rmSync(selected);
					assert.throws(() => summarizeSavedBenchmarks(options, undefined, dependencies), {code: 'ENOENT'});
					assert.equal(existsSync(selected), false, 'must not fall back to the other backend');
					writeFileSync(selected, inputs[Number(!vulkan)]);
					assert.throws(() => summarizeSavedBenchmarks(options, undefined, dependencies), /matching requested backend/);
					assert.equal(readFileSync(selected, 'utf8'), inputs[Number(!vulkan)]);
					assert.equal(readFileSync(other, 'utf8'), inputs[Number(!vulkan)]);
				});
			}
		}
	}

	it('summarizes Vulkan reports and rejects mixed or mismatched saved backends without writing', () => {
		const output = join(directory, suiteReportName('combined', {vulkan: true}));
		const input = {...savedReport(['idle', 'chartgpu'].map(variant => browser(variant, combined, 1, 'vulkan'))), requestedBackend: 'vulkan'};
		writeFileSync(output, JSON.stringify(input));
		const options = {...combined, vulkan: true};
		assert.equal(capture(() => summarizeSavedBenchmarks(options, output)).result.requestedBackend, 'vulkan');
		for (const corrupt of [
			report => report.requestedBackend = 'default',
			report => delete report.requestedBackend,
			report => report.reports[0].runner.requestedBackend = 'default',
			report => delete report.reports[1].runner.requestedBackend,
		]) {
			const report = structuredClone(input);
			corrupt(report);
			const bytes = JSON.stringify(report);
			writeFileSync(output, bytes);
			assert.throws(() => summarizeSavedBenchmarks(options, output), /matching requested backend/);
			assert.equal(readFileSync(output, 'utf8'), bytes);
		}
		writeFileSync(output, JSON.stringify(input));
		assert.throws(() => summarizeSavedBenchmarks({...combined, vulkan: false}, output), /matching requested backend/);
	});

	for (const measurements of [combined, {trace: true, memory: false, raf: false},
		{trace: false, memory: true, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`${benchmarkMode(measurements)} summary uses the mode's speed metric or stable execution order`, () => {
			const reports = ['idle', 'uplot', 'chartjs', 'echarts'].map(variant => browser(variant, measurements));
			if (measurements.trace) {
				reports[1].analysis.groups[0].metrics.totalTrackedThreadWorkMs.mean = null;
				reports[2].analysis.groups[0].metrics.totalTrackedThreadWorkMs.mean = 10;
				reports[3].analysis.groups[0].metrics.totalTrackedThreadWorkMs.mean = 0;
			}
			const input = savedReport(reports, measurements);
			const original = structuredClone(input);
			const result = offline(input);
			assert.deepEqual(result.tables[0].map(row => row.variant), measurements.trace
				? ['echarts', 'chartjs', 'uplot'] : ['uplot', 'chartjs', 'echarts']);
			assert.deepEqual(input, original);
			assert.deepEqual(result.result.reports, original.reports);
		});
	}

	it('projects requested trace means and minimum adjusted tree PSS, preserving raw reports', () => {
		const input = savedReport([browser('idle'), browser('uplot')]);
		const original = structuredClone(input);
		const result = offline(input);
		const row = result.tables[0][0];
		assert.deepEqual(Object.keys(row),
			['variant', 'context', 'sampling', 'lossy', 'prep ms', 'init ms', 'main ms', 'gpu ms', 'update ms', 'peak MB', 'retained MB', 'resize ms', 'hover10 ms']);
		for (const [key, value] of Object.entries({'prep ms': 1.1, 'init ms': 5, 'main ms': 3, 'gpu ms': 4, 'update ms': 5, 'retained MB': 0, 'peak MB': 45}))
			assert.equal(row[key], value);
		assert.deepEqual(input, original);
		assert.deepEqual(result.events, [
			{type: 'table', rows: result.tables[0]},
			{type: 'log', args: ['Updated summary from saved samples. No browser was started.']},
		]);
		const persisted = JSON.parse(readFileSync(join(directory, 'offline.json'), 'utf8'));
		assert.deepEqual(persisted.reports, original.reports);
	});

	it('recomputes saved trace means from phase samples without changing accounting or raw samples', () => {
		const raw = browser('uplot', {trace: true, memory: false, raf: false});
		raw.phase = 'chart-population';
		raw.initProtocol = 'settled-work-v1';
		raw.trace = {accountingProtocol: TRACE_ACCOUNTING};
		raw.analysis.accountingProtocol = TRACE_ACCOUNTING;
		raw.analysis.samples = raw.samples.flatMap((s, i) => raw.operations.map(operation => ({
			...s, id: `${s.id}-${operation}`, operation,
			jsIntervalMs: i === 0 ? 1000 : i * 2,
			totalTrackedThreadWorkMs: i === 0 ? 1000 : (operation === 'small-init' ? i * 10 : i * 20),
			gcAddedThreadWorkMs: i === 1 ? 6 : 0,
		})));
		raw.analysis.phaseGroups = [{operation: 'small-init', metrics: {totalTrackedThreadWorkMs: {min: 1}}}];
		const original = structuredClone(raw);
		const result = offline(savedReport([raw], raw.measurements));
		const updated = result.result.reports[0];
		assert.equal(result.tables[0][0]['init ms'], 20);
		assert.equal(updated.analysis.groups[0].metrics.jsIntervalMs.mean, 4);
		assert.equal(result.tables[0][0]['update ms'], 40);
		assert.equal(updated.analysis.phaseGroups[0].metrics.gcAddedThreadWorkMs.mean, 2);
		assert.equal(updated.analysis.groups[0].metrics.totalTrackedThreadWorkMs.min, 20);
		assert.equal(updated.analysis.statistic, 'mean');
		assert.equal(updated.analysis.accountingProtocol, TRACE_ACCOUNTING);
		assert.deepEqual(updated.analysis.samples, original.analysis.samples);
		assert.deepEqual(updated.samples, original.samples);
		assert.deepEqual(offline(result.result), result);
	});

	it('does not substitute minima for unavailable means without recorded phase samples', () => {
		const raw = browser('uplot', {trace: true, memory: false, raf: false});
		delete raw.analysis.groups[0].metrics.totalTrackedThreadWorkMs.mean;
		const result = offline(savedReport([raw], raw.measurements));
		assert.equal(result.tables[0][0]['update ms'], 'unavailable');
		assert.ok(result.logs.some(([text]) => text.includes('update ms (3/3 valid, 0 missing, unavailable)')));
	});

	it('uses trace means in the live table and sorts by mean rather than minimum', async () => {
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			const raw = await worker(request);
			const values = request.variant === 'uplot' ? [1, 10, 10] : [5, 5, 5];
			raw.analysis.samples = raw.samples.flatMap((s, i) => s.phases.map(phase => ({...phase, totalTrackedThreadWorkMs: s.warmup ? 999 : values[i - 1]})));
			raw.analysis.phaseGroups = summarizeBenchmarkTraceSamples(raw.analysis.samples);
			raw.analysis.groups = raw.analysis.phaseGroups.filter(group => group.operation === 'data-update');
			return raw;
		};
		const report = await runBenchmarkSuite({trace: true, vulkan: false}, h.dependencies);
		const rows = h.frames.at(-1).rows;
		assert.equal(rows.find(row => row.variant === 'uplot')['update ms'], 7);
		assert.ok(rows.findIndex(row => row.variant === 'chartjs') < rows.findIndex(row => row.variant === 'uplot'));
		assert.deepEqual(offline(report).tables[0], rows.map(renderedRow));
	});

	it('shows independent RAF minima in live and saved tables, excluding faster warmups', async () => {
		const measurements = {trace: false, memory: false, raf: true};
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			const raw = await worker(request);
			const timings = [[0, 0, 0], [2, 90, 80], [50, 3, 90], [90, 70, 16]];
			raw.samples.forEach((sample, i) => {
				[sample.dataPrepMs, sample.jsMs, sample.raf1Ms] = timings[i];
				Object.assign(sample.phases[1], {dataPrepMs: sample.dataPrepMs, jsMs: sample.jsMs, raf1Ms: sample.raf1Ms});
			});
			raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			return raw;
		};
		const report = await runBenchmarkSuite({...measurements, variant: 'uplot'}, h.dependencies);
		assert.deepEqual(h.tables[0], [{variant: 'uplot', ...benchmarkMetadata.uplot, lossy: '', 'prep ms': 2, 'init rAF ms': 16, 'update ms': 3, 'next rAF ms': 16, 'resize rAF ms': 16, 'hover10 ms': 16}]);
		const result = offline(report);
		assert.deepEqual(result.tables[0], h.tables[0]);
		const row = result.tables[0][0];
		assert.equal(row['prep ms'], 2);
		assert.equal(row['update ms'], 3);
		assert.equal(row['next rAF ms'], 16);
		assert.deepEqual(Object.keys(row), ['variant', 'context', 'sampling', 'lossy', 'prep ms', 'init rAF ms', 'update ms', 'next rAF ms', 'resize rAF ms', 'hover10 ms']);
		assert.equal(result.events[0].type, 'table');
		assert.deepEqual(result.logs, [['Updated summary from saved samples. No browser was started.']]);
	});

	for (const verbose of [false, true]) {
		it(`suppresses preemptive skip warnings in saved summaries with verbose=${verbose} but preserves their reasons`, () => {
			const input = {...savedReport([browser('idle'), browser('uplot')]), skipped};
			const result = offline(input, {verbose});
			assert.deepEqual(result.logs, [['Updated summary from saved samples. No browser was started.']]);
			assert.deepEqual(result.result.skipped, skipped);
			assert.deepEqual(JSON.parse(readFileSync(join(directory, 'offline.json'), 'utf8')).skipped, skipped);
		});
	}

	it('warns separately about partial metrics and count mismatches without losing JSON statistics', () => {
		const raw = browser('uplot');
		const metrics = raw.analysis.groups[0].metrics;
		metrics.rendererMainTaskMs = {min: 2, max: 4, mean: 3, count: 2, missing: 1};
		metrics.gpuMainTaskMs = {min: 1, max: 7, mean: 4, count: 4, missing: 0};
		metrics.totalTrackedThreadWorkMs = {min: null, max: null, mean: null, count: 3, missing: 0};
		const result = offline({...savedReport([browser('idle'), raw]), skipped});
		const row = result.tables[0][0];
		assert.equal('n' in row, false);
		assert.equal('dpr' in row, false);
		assert.equal(row['main ms'], 3);
		assert.equal(row['gpu ms'], 4);
		assert.equal(row['update ms'], 'unavailable');
		assert.equal(Object.keys(row).some(key => key.endsWith(' n') || key.endsWith(' missing')), false);
		assert.deepEqual(result.logs.filter(([text]) => text.startsWith('Warning:')), [

			['Warning: uplot (DPR 1): main ms (2/3 valid, 1 missing); gpu ms (4/3 valid, 0 missing); update ms (3/3 valid, 0 missing, unavailable).'],
		]);
		assert.deepEqual(result.events.map(event => event.type), ['table', 'log', 'log']);
		assert.match(result.events[1].args[0], /^Warning:/);
		assert.equal(result.events.at(-1).args[0], 'Updated summary from saved samples. No browser was started.');
		const persisted = JSON.parse(readFileSync(join(directory, 'offline.json'), 'utf8'));
		assert.deepEqual(persisted.skipped, skipped);
		assert.deepEqual(persisted.reports[1].analysis.groups[0].metrics, metrics);
		assert.deepEqual(persisted.adjustedAnalysis.groups[0].scopes.tree.pssMB.live,
			{min: 0, max: 225, count: 3, missing: 0});
	});

	it('shows memory only, excludes warmups, and preserves negative adjustments', () => {
		const measurements = {trace: false, memory: true, raf: false};
		const raw = browser('uplot', measurements);
		raw.samples = [raw.samples[0], raw.samples[3]];
		raw.samples[1].processObservations[3] = observation('live', 24);
		const result = offline(savedReport([browser('idle', measurements), raw], measurements));
		const row = result.tables[0][0];
		assert.equal(row['retained MB'], -3);
		assert.equal(row['peak MB'], 45);
		assert.deepEqual(Object.keys(row), ['variant', 'context', 'sampling', 'lossy', 'peak MB', 'retained MB']);
		assert.equal(result.events[0].type, 'table');
		assert.deepEqual(result.logs, [['Updated summary from saved samples. No browser was started.']]);
	});

	it('keeps incomplete process reads in JSON without live or offline console warnings', async () => {
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			const raw = await worker(request);
			raw.samples[1].processObservations.push({phase: 'construct', kind: 'poll',
				processMemory: {complete: false, processes: [], renderer: null, tree: null,
					issues: [{stage: 'read', code: 'ENOENT'}]},
			});
			return raw;
		};
		const report = await runBenchmarkSuite({variant: 'uplot', vulkan: false}, h.dependencies);
		assert.ok(h.frames.every(frame => frame.warnings.length === 0));
		const persisted = saved();
		assert.deepEqual(persisted.reports, report.reports);
		for (const raw of persisted.reports) {
			const read = raw.samples[1].processObservations.at(-1).processMemory;
			assert.equal(read.complete, false);
			assert.deepEqual(read.issues, [{stage: 'read', code: 'ENOENT'}]);
		}
		const summary = offline(persisted);
		assert.ok(summary.logs.every(([text]) => !text.startsWith('Warning:')));
		assert.deepEqual(summary.result.reports, persisted.reports);
	});

	for (const missing of ['idle', 'blank', 'invalid live', 'trace']) {
		it(`reports unavailable and missing counts for missing ${missing}`, () => {
			const reports = [browser('idle'), browser('uplot')];
			if (missing === 'idle') reports.shift();
			if (missing === 'blank') reports[0].blank.processMemory.complete = false;
			if (missing === 'invalid live') reports[1].samples.forEach(sample => sample.processObservations.find(read => read.phase === 'live').processMemory.complete = false);
			if (missing === 'trace') delete reports[1].analysis;
			const result = offline(savedReport(reports));
			const row = result.tables[0][0];
			const label = missing === 'trace' ? 'main ms' : 'retained MB';
			assert.equal(row[label], 'unavailable');
			assert.equal('n' in row, false);
			assert.equal('dpr' in row, false);
			assert.equal(result.events[0].type, 'table');
			assert.equal(`${label} n` in row, false);
			assert.equal(`${label} missing` in row, false);
			const warnings = result.logs.filter(([text]) => text.startsWith('Warning:'));
			assert.equal(warnings.length, 1);
			assert.ok(warnings[0][0].includes(`${label} (0/3 valid, 3 missing, unavailable)`));

		});
	}

	it('preserves saved metadata and raw summaries while deterministically refreshing adjusted analysis', () => {
		const input = savedReport([browser('idle'), browser('uplot')]);
		input.reports[1].processAnalysis = {stale: 999999};
		input.adjustedAnalysis = {stale: true};
		const output = join(directory, 'offline.json');
		writeFileSync(output, JSON.stringify(input));
		const first = capture(() => summarizeSavedBenchmarks({...combined, vulkan: false}, output));
		const {adjustedAnalysis, ...preserved} = first.result;
		const {adjustedAnalysis: stale, ...expected} = input;
		assert.deepEqual(preserved, expected);
		assert.equal(adjustedAnalysis.groups[0].scopes.tree.pssMB.live.min, 0);
		const bytes = readFileSync(output, 'utf8');
		assert.deepEqual(capture(() => summarizeSavedBenchmarks({...combined, vulkan: false}, output)), first);
		assert.equal(readFileSync(output, 'utf8'), bytes);
	});

	for (const invalid of ['{', JSON.stringify({mode: 'memory', reports: []}), JSON.stringify({...savedReport([]), measurements: {trace: true}}), JSON.stringify(savedReport([{samples: null}]))]) {
		it(`does not overwrite invalid saved input ${invalid}`, () => {
			const output = join(directory, 'invalid.json');
			writeFileSync(output, invalid);
			assert.throws(() => summarizeSavedBenchmarks(combined, output));
			assert.equal(readFileSync(output, 'utf8'), invalid);
		});
	}
});

describe('worker subprocess cleanup', () => {
	for (const event of ['exit', 'crash', 'SIGINT', 'SIGTERM', 'spawn error']) {
		it(`isolates a library ${event} while honoring cancellation and launch errors`, async () => {
			const signalSource = new EventEmitter();
			const started = [];
			const h = harness({
				runWorker: undefined, signalSource, kill: () => {},
				spawnWorker: (command, args) => {
					const id = args[args.indexOf('--variant') + 1];
					started.push(id);
					const child = new EventEmitter();
					child.stdout = new EventEmitter();
					child.stderr = new EventEmitter();
					queueMicrotask(() => {
						if (id === 'chartjs') {
							child.stderr.emit('data', Buffer.from('vendor error detail'));
							if (event.startsWith('SIG')) signalSource.emit(event);
							if (event === 'spawn error') child.emit('error', new Error('launch failed'));
							else child.emit('close', event === 'crash' ? null : 1, event === 'crash' ? 'SIGSEGV' : null);
						}
						else {
							writeFileSync(join(directory, variantReportName('combined', id)), JSON.stringify(browser(id)));
							child.emit('close', 0, null);
						}
					});
					return child;
				},
			});
			if (event === 'exit' || event === 'crash') {
				const result = await runBenchmarkSuite({vulkan: false}, h.dependencies);
				assert.equal(result.complete, true);
				assert.deepEqual(started, variants);
				assert.deepEqual(result.failures.map(entry => entry.variant), ['chartjs']);
				assert.match(result.failures[0].error, /vendor error detail/);
				assert.deepEqual(result.progress.completed, variants.filter(id => id !== 'chartjs'));
			}
			else {
				await assert.rejects(runBenchmarkSuite({vulkan: false}, h.dependencies), {
					code: event === 'spawn error' ? 'BENCHMARK_WORKER_START_FAILED' : 'BENCHMARK_INTERRUPTED',
				});
				assert.deepEqual(started, variants.slice(0, variants.indexOf('chartjs') + 1));
				assert.equal(saved().complete, false);
				assert.deepEqual(saved().failures, []);
			}
		});
	}

	for (const event of ['success', 'failure', 'error', 'SIGINT', 'SIGTERM']) {
		it(`captures both worker streams without printing them on ${event}`, async () => {
			const signalSource = new EventEmitter();
			const stdout = 'worker stdout detail\n', stderr = 'worker stderr detail\n';
			const h = harness({
				runWorker: undefined, signalSource, kill: () => {},
				spawnWorker: (command, args, options) => {
					assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
					const child = new EventEmitter();
					child.stdout = new EventEmitter();
					child.stderr = new EventEmitter();
					queueMicrotask(() => {
						child.stdout.emit('data', Buffer.from(stdout));
						child.stderr.emit('data', Buffer.from(stderr));
						if (event === 'success')
							writeFileSync(join(directory, variantReportName('combined', 'idle')), JSON.stringify(browser('idle')));
						if (event.startsWith('SIG')) signalSource.emit(event);
						if (event === 'error') child.emit('error', new Error('worker stream failed'));
						else child.emit('close', event === 'success' ? 0 : 1, null);
					});
					return child;
				},
			});
			await captureWorkerOutput(async () => {
				const run = runBenchmarkSuite({variant: 'idle'}, h.dependencies);
				if (event === 'success') {
					await run;
					assert.equal('error' in saved(), false);
				}
				else {
					await assert.rejects(run, error => {
						assert.match(error.message, /worker stream failed|interrupted|exited/);
						assert.ok(error.message.endsWith((stdout + stderr).trim()), `Failure lost captured worker output: ${error.message}`);
						assert.equal(saved().error, error.message);
						return true;
					});
				}
			});
			assert.doesNotMatch(JSON.stringify(h.frames), /worker stdout detail|worker stderr detail/);
			assert.equal(h.frames.at(-1).final, true);
			assert.equal(signalSource.listenerCount('SIGINT'), 0);
			assert.equal(signalSource.listenerCount('SIGTERM'), 0);
		});
	}

	it('keeps an idle-control timeout fatal without a stack or worker log dump', async () => {
		const h = harness({
			runWorker: undefined, signalSource: new EventEmitter(), kill: () => {},
			spawnWorker: () => {
				const child = new EventEmitter();
				child.stdout = new EventEmitter();
				child.stderr = new EventEmitter();
				queueMicrotask(() => {
					child.stdout.emit('data', Buffer.from('Using cached Chrome\n'));
					child.stderr.emit('data', Buffer.from('idle: timed out after 5s\n'));
					child.emit('close', 124, null);
				});
				return child;
			},
		});
		await assert.rejects(runBenchmarkSuite({variant: 'idle'}, h.dependencies), {
			code: 'BENCHMARK_SAMPLE_TIMEOUT', message: 'idle: timed out after 5s',
		});
		assert.equal(saved().error, 'idle: timed out after 5s');
		assert.equal(saved().protocol.sampleTimeoutMs, 5000);
		assert.equal(saved().complete, false);
		assert.equal(saved().progress.failed, 'idle');
		assert.deepEqual(saved().reports, []);
		assert.equal(h.frames.at(-1).final, true);
	});

	it('bounds combined worker output and preserves the latest stdout/stderr in the failure and partial report', async () => {
		const chunks = ['discarded stdout prefix\n' + 'a'.repeat(20000), 'discarded stderr prefix\n' + 'b'.repeat(20000), '\nlatest stdout\n', 'latest stderr\n'];
		const h = harness({
			runWorker: undefined, signalSource: new EventEmitter(), kill: () => {},
			spawnWorker: () => {
				const child = new EventEmitter();
				child.stdout = new EventEmitter();
				child.stderr = new EventEmitter();
				queueMicrotask(() => {
					chunks.forEach((chunk, index) => (index % 2 ? child.stderr : child.stdout).emit('data', Buffer.from(chunk)));
					child.emit('close', 1, null);
				});
				return child;
			},
		});
		await captureWorkerOutput(async () => {
			await assert.rejects(runBenchmarkSuite({variant: 'idle'}, h.dependencies), error => {
				assert.equal(error.message, 'Benchmark idle exited with 1\n' + chunks.join('').slice(-16000).trim());
				assert.doesNotMatch(error.message, /discarded/);
				assert.equal(saved().error, error.message);
				return true;
			});
		});
		assert.deepEqual(saved().reports, []);
		assert.equal(saved().progress.failed, 'idle');
		assert.equal(h.frames.at(-1).final, true);
	});

	it('bounds worker runtime, escalates a stuck worker, and persists the timeout failure', async () => {
		const child = new EventEmitter();
		child.pid = 12345;
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		const signalSource = new EventEmitter();
		const timers = new Map();
		const kills = [];
		const h = harness({
			runWorker: undefined, signalSource,
			spawnWorker: () => child,
			setTimer: (callback, ms) => { timers.set(ms, callback); return ms; },
			clearTimer: timer => timers.delete(timer),
			kill: (pid, signal) => {
				kills.push([pid, signal]);
				if (signal === 'SIGKILL')
					queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
			},
		});
		const run = runBenchmarkSuite({variant: 'idle'}, h.dependencies);
		assert.deepEqual([...timers.keys()], [270000]);
		child.stdout.emit('data', Buffer.from('stdout before timeout\n'));
		child.stderr.emit('data', Buffer.from('stderr before timeout\n'));
		timers.get(270000)();
		assert.deepEqual(kills, [[-12345, 'SIGTERM']]);
		assert.equal(saved().complete, false);
		timers.get(2000)();
		await assert.rejects(run, error => {
					assert.equal(error.message, 'Benchmark idle timed out after 270000ms\nstdout before timeout\nstderr before timeout');
					assert.equal(saved().error, error.message);
					return true;
				});
		assert.deepEqual(kills[1], [-12345, 'SIGKILL']);
		assert.equal(timers.size, 0);
		assert.equal(signalSource.listenerCount('SIGINT'), 0);
		assert.equal(signalSource.listenerCount('SIGTERM'), 0);
		assert.equal(saved().progress.failed, 'idle');
		assert.equal(saved().complete, false);
		assert.deepEqual(saved().reports, []);
		assert.equal(h.frames.at(-1).final, true);
	});

	for (const event of ['success', 'failure', 'error', 'SIGINT', 'SIGTERM']) {
		it(`pipes output, cleans signal handlers, and saves progress on ${event}`, async () => {
			const signalSource = new EventEmitter();
			const kills = [];
			const h = harness({
				runWorker: undefined, signalSource,
				kill: (pid, signal) => kills.push([pid, signal]),
				spawnWorker: (command, args, options) => {
					assert.equal(command, process.execPath);
					assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
					assert.equal(options.detached, true);
					const child = new EventEmitter();
					child.pid = 12345;
					queueMicrotask(() => {
						if (event === 'success')
							writeFileSync(join(directory, variantReportName('combined', 'idle')), JSON.stringify(browser('idle')));
						if (event.startsWith('SIG')) signalSource.emit(event);
						if (event === 'error') child.emit('error', new Error('spawn failed'));
						else child.emit('close', event === 'success' ? 0 : 1, null);
					});
					return child;
				},
			});
			const run = runBenchmarkSuite({variant: 'idle'}, h.dependencies);
			if (event === 'success') await run;
			else await assert.rejects(run, /spawn failed|interrupted|exited/);
			assert.equal(signalSource.listenerCount('SIGINT'), 0);
			assert.equal(signalSource.listenerCount('SIGTERM'), 0);
			assert.deepEqual(kills.at(-1), [-12345, 'SIGKILL']);
			if (event.startsWith('SIG')) assert.deepEqual(kills[0], [-12345, event]);
			assert.equal(saved().complete, event === 'success');
							assert.equal(h.frames.at(-1).final, true);
							assert.ok(h.frames.slice(0, -1).every(frame => !frame.final));
		});
	}
});
