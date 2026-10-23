import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeBenchmarkRaf } from '../../scripts/analyze-benchmarks-raf.mjs';
import { benchmarkMode, variantReportName, suiteReportName, runBenchmarkSuite, summarizeSavedBenchmarks } from '../../scripts/benchmarks-suite.mjs';

const combined = {trace: true, memory: true, raf: false};
const tuple = pssMB => ({rssMB: pssMB * 4 + 50, pssMB, privateMB: pssMB / 2, swapMB: 1, swapPssMB: 0.5});
const observation = (phase, value) => ({
	phase, kind: phase === 'construct' ? 'poll' : 'gc',
	processMemory: {complete: true, processes: [], issues: [], renderer: tuple(value), tree: tuple(value * 3 + 100)},
});

function browser(variant, measurements = combined, dpr = 1) {
	const idle = variant === 'idle';
	const values = idle ? [[15, 1000], [19, 3000], [17, 2000]] : [[50, 70], [100, 120], [25, 40]];
	const sample = ([live, peak], round, warmup = false) => ({
		id: `${variant}-${round}`, variant, dpr, round, warmup,
		dataPrepMs: warmup ? 9000 : 2, jsMs: warmup ? 9000 : 3, raf1Ms: warmup ? 9000 : 16,
		processObservations: [observation('baseline', 2), observation('prepared', 4), observation('construct', peak), observation('live', live), observation('cleanup', 1)],
	});
	const report = {
		measurements: {...measurements}, runner: {variant, dpr},
		blank: observation('blank', idle ? 10 : 20), loaded: observation('loaded', 9999),
		samples: [sample([9000, 10000], -1, true), ...values.map((value, round) => sample(value, round))],
	};
	if (measurements.trace) {
		const metrics = Object.fromEntries([
			['dataPrepMs', 1.123456], ['jsIntervalMs', 2], ['rendererMainTaskMs', 3],
			['gpuMainTaskMs', 4], ['totalTrackedThreadWorkMs', 5], ['jsMs', 999], ['prepAndInitMs', 999],
		].map(([key, min]) => [key, {min, max: min + 10, count: 3, missing: 0}]));
		report.analysis = {groups: [{variant, dpr, sampleCount: 3, warmupCount: 1, metrics}]};
	}
	if (measurements.raf)
		report.rafAnalysis = summarizeBenchmarkRaf(report);
	return report;
}

function capture(fn) {
	const {log} = console;
	const logs = [], tables = [], events = [];
	try {
		console.log = (...args) => {
			if (typeof args[0] === 'string' && args[0].startsWith('┌')) {
				const [headers, ...cells] = args[0].split('\n').filter(line => line.startsWith('│'))
					.map(line => line.split('│').slice(1, -1).map(value => value.trim()));
				const rows = cells.map(row => Object.fromEntries(headers.map((key, i) =>
					[key, key === 'variant' || row[i] === 'unavailable' ? row[i] : Number(row[i])])));
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
				return browser(request.variant, request.measurements, request.dpr);
			},
			...options,
		},
	};
}

function savedReport(reports, measurements = combined) {
	return {mode: benchmarkMode(measurements), measurements, reports, complete: false, progress: {completed: []}, protocol: {custom: true}};
}

function offline(report) {
	const output = join(directory, 'offline.json');
	writeFileSync(output, JSON.stringify(report));
	return capture(() => summarizeSavedBenchmarks(report.measurements, output));
}

describe('benchmark suite modes and workers', () => {
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
					...Object.keys(mask === 0 ? combined : flags).filter(key => (mask === 0 ? combined : flags)[key]).map(key => `--${key}`), '--gpu']);
				assert.equal(request.timeoutMs, 270000);
			}
			assert.equal(report.complete, true);
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

	it('runs idle and all six libraries and saves/displays each library before the next starts', async () => {
		const variants = ['idle', 'uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs'];
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
			assert.deepEqual(frame.rows.map(row => row.variant), partial.progress.completed.filter(variant => variant !== 'idle'));
			assert.deepEqual(frame.warnings, []);
			if (request.variant === 'idle')
				assert.deepEqual(partial.adjustedAnalysis.groups, []);
			if (request.variant === 'chartjs') {
				assert.deepEqual(h.tables[0].map(row => row.variant), ['uplot']);
				assert.deepEqual(frame.rows, h.frames.at(-2).rows);
			}
			return worker(request);
		};
		assert.equal(benchmarkMode({}), 'combined');
		const result = await runBenchmarkSuite({}, h.dependencies);
		assert.deepEqual(result.progress.completed, variants);
		assert.deepEqual(h.tables.map(rows => rows.map(row => row.variant)), variants.slice(1).map((_, i) => variants.slice(1, i + 2)));
		assert.equal(h.events.filter(event => event.startsWith('Starting')).length, variants.length);
		assert.equal(h.events.filter(event => event.startsWith('Completed')).length, variants.length);
				assert.equal(h.frames.length, variants.length * 2);
				assert.ok(h.frames.slice(0, -1).every(frame => !frame.final));
				assert.deepEqual(h.frames.at(-1), {
					rows: h.tables.at(-1), warnings: [], status: 'Completed dygraphs (7/7).', final: true,
				});
		assert.deepEqual(saved(), result);
		assert.equal(result.protocol.coolingBetweenVariantsMs, 0);
		assert.equal(result.protocol.freshBrowserPerVariant, true);
		assert.equal(h.requests[0].args.includes('--gpu'), false);
	});

	it('reorders each completed table by unrounded total time without changing execution or report order', async () => {
		const totals = {uplot: 10.04, chartjs: 2, d3: null, echarts: 10.01, flot: 2, dygraphs: null};
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			const raw = await worker(request);
			if (request.variant !== 'idle')
				raw.analysis.groups[0].metrics.totalTrackedThreadWorkMs.min = totals[request.variant];
			return raw;
		};
		const result = await runBenchmarkSuite({}, h.dependencies);
		assert.deepEqual(h.tables.map(rows => rows.map(row => row.variant)), [
			['uplot'],
			['chartjs', 'uplot'],
			['chartjs', 'uplot', 'd3'],
			['chartjs', 'echarts', 'uplot', 'd3'],
			['chartjs', 'flot', 'echarts', 'uplot', 'd3'],
			['chartjs', 'flot', 'echarts', 'uplot', 'd3', 'dygraphs'],
		]);
		const executionOrder = ['idle', ...Object.keys(totals)];
		assert.deepEqual(h.requests.map(request => request.variant), executionOrder);
		assert.deepEqual(result.reports.map(report => report.runner.variant), executionOrder);
		assert.deepEqual(result.progress.completed, executionOrder);
		assert.deepEqual(h.frames.at(-1).rows, h.tables.at(-1));
	});

	it('runs an explicitly selected idle only once', async () => {
		const h = harness();
		await runBenchmarkSuite({memory: true, variant: 'idle'}, h.dependencies);
		assert.deepEqual(h.requests.map(request => request.variant), ['idle']);
		assert.deepEqual(h.tables, []);
		assert.deepEqual(h.frames.at(-1), {rows: [], warnings: [], status: 'Completed idle (1/1).', final: true});
	});

	it('preserves the completed partial aggregate on failure and does not start later workers', async () => {
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = request => {
			if (request.variant === 'chartjs')
				throw new Error('synthetic worker failure');
			return worker(request);
		};
		await assert.rejects(runBenchmarkSuite({}, h.dependencies), /synthetic worker failure/);
		const partial = saved();
		assert.equal(partial.complete, false);
		assert.equal(partial.progress.failed, 'chartjs');
		assert.deepEqual(partial.progress.completed, ['idle', 'uplot']);
		assert.equal(partial.adjustedAnalysis.groups[0].scopes.tree.pssMB.live.min, 0);
		assert.equal(h.tables.length, 1);
		assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'uplot']);
		assert.ok(h.frames.slice(0, -1).every(frame => !frame.final));
		assert.deepEqual(h.frames.at(-1), {
			rows: h.tables[0], warnings: [],
			status: `Benchmark suite incomplete. Partial report saved: ${join(directory, suiteReportName('combined'))}`,
			final: true,
		});
	});

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
					raw.analysis.groups[0].metrics.gpuMainTaskMs = {min: 4, count: 2, missing: 1};
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
		await assert.rejects(runBenchmarkSuite({}, h.dependencies), /ENOENT/);
		assert.deepEqual(saved().reports, []);
		assert.deepEqual(saved().adjustedAnalysis.controls, []);
	});

	it('accepts fresh worker files and rejects mismatched report metadata', async () => {
		const h = harness({runWorker: async request => {
			writeFileSync(request.output, JSON.stringify(browser(request.variant, request.measurements, request.dpr)));
		}});
		await runBenchmarkSuite({variant: 'idle'}, h.dependencies);
		for (const corrupt of [raw => raw.runner.variant = 'd3', raw => raw.runner.dpr = 2, raw => raw.measurements.memory = false, raw => raw.samples[0].variant = 'd3']) {
			h.dependencies.runWorker = async () => {
				const raw = browser('idle');
				corrupt(raw);
				return raw;
			};
			await assert.rejects(runBenchmarkSuite({}, h.dependencies), /Unexpected benchmark report/);
			assert.deepEqual(saved().reports, []);
		}
	});
});

describe('benchmark table and offline summary', () => {
	for (const measurements of [combined, {trace: true, memory: false, raf: false},
		{trace: false, memory: true, raf: false}, {trace: false, memory: false, raf: true}]) {
		it(`${benchmarkMode(measurements)} summary sorts by total time only when available in this mode`, () => {
			const reports = ['idle', 'uplot', 'chartjs', 'echarts'].map(variant => browser(variant, measurements));
			if (measurements.trace) {
				reports[1].analysis.groups[0].metrics.totalTrackedThreadWorkMs.min = null;
				reports[2].analysis.groups[0].metrics.totalTrackedThreadWorkMs.min = 10;
				reports[3].analysis.groups[0].metrics.totalTrackedThreadWorkMs.min = 0;
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

	it('projects requested trace minima and minimum adjusted tree PSS, preserving raw reports', () => {
		const input = savedReport([browser('idle'), browser('uplot')]);
		const original = structuredClone(input);
		const result = offline(input);
		const row = result.tables[0][0];
		assert.deepEqual(Object.keys(row),
			['variant', 'prep ms', 'init ms', 'main ms', 'gpu ms', 'total ms', 'peak MB', 'retained MB']);
		for (const [key, value] of Object.entries({'prep ms': 1.1, 'init ms': 2, 'main ms': 3, 'gpu ms': 4, 'total ms': 5, 'retained MB': 0, 'peak MB': 45}))
			assert.equal(row[key], value);
		assert.deepEqual(input, original);
		assert.deepEqual(result.events, [
			{type: 'table', rows: result.tables[0]},
			{type: 'log', args: ['Updated summary from saved samples. No browser was started.']},
		]);
		const persisted = JSON.parse(readFileSync(join(directory, 'offline.json'), 'utf8'));
		assert.deepEqual(persisted.reports, original.reports);
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
			});
			raw.rafAnalysis = summarizeBenchmarkRaf(raw);
			return raw;
		};
		const report = await runBenchmarkSuite({...measurements, variant: 'uplot'}, h.dependencies);
		assert.deepEqual(h.tables[0], [{variant: 'uplot', 'prep ms': 2, 'init ms': 3, 'next rAF ms': 16}]);
		const result = offline(report);
		assert.deepEqual(result.tables[0], h.tables[0]);
		const row = result.tables[0][0];
		assert.equal(row['prep ms'], 2);
		assert.equal(row['init ms'], 3);
		assert.equal(row['next rAF ms'], 16);
		assert.deepEqual(Object.keys(row), ['variant', 'prep ms', 'init ms', 'next rAF ms']);
		assert.equal(result.events[0].type, 'table');
		assert.deepEqual(result.logs, [['Updated summary from saved samples. No browser was started.']]);
	});

	it('warns separately about partial metrics and count mismatches without losing JSON statistics', () => {
		const raw = browser('uplot');
		const metrics = raw.analysis.groups[0].metrics;
		metrics.rendererMainTaskMs = {min: 2, max: 4, count: 2, missing: 1};
		metrics.gpuMainTaskMs = {min: 1, max: 7, count: 4, missing: 0};
		metrics.totalTrackedThreadWorkMs = {min: null, max: null, count: 3, missing: 0};
		const result = offline(savedReport([browser('idle'), raw]));
		const row = result.tables[0][0];
		assert.equal('n' in row, false);
		assert.equal('dpr' in row, false);
		assert.equal(row['main ms'], 2);
		assert.equal(row['gpu ms'], 1);
		assert.equal(row['total ms'], 'unavailable');
		assert.equal(Object.keys(row).some(key => key.endsWith(' n') || key.endsWith(' missing')), false);
		assert.deepEqual(result.logs.filter(([text]) => text.startsWith('Warning:')), [[
			'Warning: uplot (DPR 1): main ms (2/3 valid, 1 missing); gpu ms (4/3 valid, 0 missing); total ms (3/3 valid, 0 missing, unavailable).',
		]]);
		assert.deepEqual(result.events.map(event => event.type), ['table', 'log', 'log']);
		assert.match(result.events[1].args[0], /^Warning:/);
		assert.equal(result.events[2].args[0], 'Updated summary from saved samples. No browser was started.');
		const persisted = JSON.parse(readFileSync(join(directory, 'offline.json'), 'utf8'));
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
		assert.deepEqual(Object.keys(row), ['variant', 'peak MB', 'retained MB']);
		assert.equal(result.events[0].type, 'table');
		assert.deepEqual(result.logs, [['Updated summary from saved samples. No browser was started.']]);
	});

	for (const missing of ['idle', 'blank', 'live', 'trace']) {
		it(`reports unavailable and missing counts for missing ${missing}`, () => {
			const reports = [browser('idle'), browser('uplot')];
			if (missing === 'idle') reports.shift();
			if (missing === 'blank') reports[0].blank.processMemory.complete = false;
			if (missing === 'live') reports[1].samples.forEach(sample => sample.processObservations = []);
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
			assert.equal(warnings.length, missing === 'blank' ? 2 : 1);
			assert.ok(warnings[0][0].includes(`${label} (0/3 valid, 3 missing, unavailable)`));
			if (missing === 'blank')
				assert.deepEqual(warnings[1], ['Warning: idle: 1 incomplete process reads. Details remain in JSON.']);
		});
	}

	it('preserves saved metadata and raw summaries while deterministically refreshing adjusted analysis', () => {
		const input = savedReport([browser('idle'), browser('uplot')]);
		input.reports[1].processAnalysis = {stale: 999999};
		input.adjustedAnalysis = {stale: true};
		const output = join(directory, 'offline.json');
		writeFileSync(output, JSON.stringify(input));
		const first = capture(() => summarizeSavedBenchmarks(combined, output));
		const {adjustedAnalysis, ...preserved} = first.result;
		const {adjustedAnalysis: stale, ...expected} = input;
		assert.deepEqual(preserved, expected);
		assert.equal(adjustedAnalysis.groups[0].scopes.tree.pssMB.live.min, 0);
		const bytes = readFileSync(output, 'utf8');
		assert.deepEqual(capture(() => summarizeSavedBenchmarks(combined, output)), first);
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
