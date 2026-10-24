import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeBenchmarkRaf } from '../../scripts/analyze-benchmarks-raf.mjs';
import { benchmarkMode, variantReportName, suiteReportName, runBenchmarkSuite, summarizeSavedBenchmarks } from '../../scripts/benchmarks-suite.mjs';
import { benchmarkVariants, demoRestrictions, benchmarkRestrictions } from '../../bench/demo-dependencies.mjs';

const variants = ['idle', ...benchmarkVariants];
const skipped = Object.entries({...demoRestrictions, ...benchmarkRestrictions}).map(([variant, reason]) => ({variant, reason}));
const skippedWarnings = skipped.map(entry => `${entry.variant}: skipped (${entry.reason})`);
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
					[key, key === 'variant' || row[i] === 'unavailable' || row[i] === '-' ? row[i] : Number(row[i])])));
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
	for (const measurements of [combined, {trace: true}, {memory: true}, {raf: true}]) {
		it(`continues after a library timeout and preserves dash rows in ${benchmarkMode(measurements)} summaries`, async () => {
			const mode = benchmarkMode(measurements);
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = async request => {
				if (request.variant === 'recharts') {
					const partial = saved(mode);
					assert.deepEqual(partial.timeouts, [{variant: 'googlecharts', dpr: 1, timeoutMs: 5000, error: 'googlecharts: timed out after 5s'}]);
					assert.equal(partial.complete, false);
					assert.equal(partial.progress.current, 'recharts');
					assert.equal(h.frames.at(-1).status, `Starting recharts (${variants.indexOf('recharts') + 1}/${variants.length})...`);
					const row = h.frames.at(-1).rows.find(row => row.variant === 'googlecharts');
					assert.ok(row);
					assert.ok(Object.entries(row).every(([key, value]) => key === 'variant' || value === '-'));
				}
				if (['googlecharts', 'visx'].includes(request.variant)) {
					h.requests.push(request);
					throw Object.assign(new Error(`${request.variant}: timed out after 5s`), {code: 'BENCHMARK_SAMPLE_TIMEOUT'});
				}
				return worker(request);
			};
			const report = await runBenchmarkSuite(measurements, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.equal(report.complete, true);
			assert.equal(report.progress.failed, null);
			assert.equal(report.progress.current, null);
			assert.equal('error' in report, false);
			assert.deepEqual(report.timeouts.map(entry => entry.variant), ['googlecharts', 'visx']);
			assert.deepEqual(report.progress.completed, variants.filter(id => !['googlecharts', 'visx'].includes(id)));
			assert.deepEqual(report.reports.map(raw => raw.runner.variant), report.progress.completed);
			assert.equal(h.frames.at(-1).final, true, 'last-library timeout completes the suite');
			assert.match(h.frames.at(-1).status, new RegExp(`${variants.length}/${variants.length}`));
			const rows = h.frames.at(-1).rows;
			const labels = mode === 'combined' ? ['prep ms', 'init ms', 'main ms', 'gpu ms', 'total ms', 'peak MB', 'retained MB']
				: mode === 'trace' ? ['prep ms', 'init ms', 'main ms', 'gpu ms', 'total ms']
				: mode === 'memory' ? ['peak MB', 'retained MB'] : ['prep ms', 'init ms', 'next rAF ms'];
			for (const id of ['googlecharts', 'visx']) {
				assert.deepEqual(rows.find(row => row.variant === id), {variant: id, ...Object.fromEntries(labels.map(label => [label, '-']))});
				assert.equal(existsSync(join(directory, variantReportName(mode, id))), false);
			}
			if (measurements.trace)
				assert.deepEqual(rows.slice(-2).map(row => row.variant), ['googlecharts', 'visx']);
			else
				assert.deepEqual(rows.map(row => row.variant), variants.slice(1));
			assert.deepEqual(offline(report).tables[0], rows.map(row => Object.fromEntries(Object.entries(row)
							.map(([key, value]) => [key, Number.isFinite(value) ? Number(value.toFixed(1)) : value]))));
			assert.deepEqual(saved(mode), report);
		});
	}

	it('finishes an explicitly selected timed-out library without loading a stale report', async () => {
		const stale = join(directory, variantReportName('combined', 'googlecharts'));
		writeFileSync(stale, JSON.stringify(browser('googlecharts')));
		const h = harness();
		const worker = h.dependencies.runWorker;
		h.dependencies.runWorker = async request => {
			if (request.variant === 'googlecharts')
				throw Object.assign(new Error('googlecharts: timed out after 5s'), {code: 'BENCHMARK_SAMPLE_TIMEOUT'});
			return worker(request);
		};
		const report = await runBenchmarkSuite({variant: 'googlecharts'}, h.dependencies);
		assert.equal(report.complete, true);
		assert.equal(existsSync(stale), false);
		assert.deepEqual(report.reports.map(raw => raw.runner.variant), ['idle']);
		assert.equal(report.timeouts.length, 1);
		assert.ok(Object.values(h.frames.at(-1).rows[0]).slice(1).every(value => value === '-'));
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
					...Object.keys(mask === 0 ? combined : flags).filter(key => (mask === 0 ? combined : flags)[key]).map(key => `--${key}`), '--gpu']);
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
			assert.deepEqual(frame.rows.map(row => row.variant), partial.progress.completed.filter(variant => variant !== 'idle'));
			assert.deepEqual(frame.warnings, skippedWarnings);
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
		const result = await runBenchmarkSuite({}, h.dependencies);
		assert.deepEqual(result.progress.completed, variants);
		assert.deepEqual(result.protocol.variants.slice(-12), ['billboard', 'g2', 'syncfusion', 'devextreme', 'kendo',
					'anychart', 'fusiontime', 'googlecharts', 'recharts', 'muicharts', 'financialcharts', 'visx']);
		assert.deepEqual(result.skipped.map(entry => entry.variant), ['lightningchart', 'jscharting']);
				assert.equal(result.protocol.variants.length, 31, 'idle plus 30 runnable benchmarks');
				assert.ok(h.requests.every(request => request.variant !== 'jscharting'));
		assert.equal(result.progress.total, variants.length);
		assert.deepEqual(result.protocol.variants, variants);
		assert.deepEqual(result.skipped, skipped);
		assert.deepEqual(h.tables.map(rows => rows.map(row => row.variant)), variants.slice(1).map((_, i) => variants.slice(1, i + 2)));
		assert.equal(h.events.filter(event => event.startsWith('Starting')).length, variants.length);
		assert.equal(h.events.filter(event => event.startsWith('Completed')).length, variants.length);
		assert.equal(h.frames.length, variants.length * 2);
		assert.ok(h.frames.slice(0, -1).every(frame => !frame.final));
		assert.deepEqual(h.frames.at(-1), {
			rows: h.tables.at(-1), warnings: skippedWarnings,
			status: `Completed ${variants.at(-1)} (${variants.length}/${variants.length}).`, final: true,
		});
		assert.deepEqual(saved(), result);
		assert.equal(result.protocol.coolingBetweenVariantsMs, 0);
		assert.equal(result.protocol.freshBrowserPerVariant, true);
		assert.equal(h.requests[0].args.includes('--gpu'), false);
	});

	it('reorders each completed table by unrounded total time without changing execution or report order', async () => {
		const totals = {uplot: 10.04, chartjs: 2, d3: null, echarts: 10.01, flot: 2, dygraphs: null};
		const additions = benchmarkVariants.filter(variant => !Object.hasOwn(totals, variant));
		for (const variant of additions) totals[variant] = 20;
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
			...additions.map((_, i) => ['chartjs', 'flot', 'echarts', 'uplot', ...additions.slice(0, i + 1), 'd3', 'dygraphs']),
		]);
		const executionOrder = variants;
		assert.deepEqual(h.requests.map(request => request.variant), executionOrder);
		assert.deepEqual(result.reports.map(report => report.runner.variant), executionOrder);
		assert.deepEqual(result.progress.completed, executionOrder);
		assert.deepEqual(h.frames.at(-1).rows, h.tables.at(-1));
	});

	for (const variant of benchmarkVariants.slice(6)) {
		it(`runs explicitly selected ${variant} with idle and no skipped warnings`, async () => {
			const h = harness();
			const report = await runBenchmarkSuite({variant}, h.dependencies);
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
		it(`includes licensed LightningChart with variant=${variant} without a permission flag`, async () => {
			const h = harness();
			const lightningOptions = Object.freeze({license: 'test-license-not-a-vendor-key'});
			const report = await runBenchmarkSuite({variant, lightningOptions}, h.dependencies);
			const expected = variant === null ? [...variants, 'lightningchart'] : ['idle', 'lightningchart'];
			assert.deepEqual(h.requests.map(request => request.variant), expected);
			assert.deepEqual(report.protocol.variants, expected);
			assert.deepEqual(report.progress.completed, expected);
			assert.equal(report.progress.total, expected.length);
			assert.equal(report.complete, true);
			const expectedSkipped = variant === null ? skipped.filter(entry => entry.variant === 'jscharting') : [];
			assert.deepEqual(report.skipped, expectedSkipped);
			const warnings = expectedSkipped.map(entry => `${entry.variant}: skipped (${entry.reason})`);
			assert.ok(h.frames.every(frame => JSON.stringify(frame.warnings) === JSON.stringify(warnings)));
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
			lightningOptions: {license: 'test', benchmarkPermission: true}}, h.dependencies), error =>
			error.message === `jscharting: ${benchmarkRestrictions.jscharting}`);
		assert.deepEqual(h.requests, []);
		assert.deepEqual(h.frames, []);
		assert.equal(readFileSync(output, 'utf8'), original);
	});

	it('keeps LightningChart skipped by default for missing or blank licenses', async () => {
		for (const lightningOptions of [{}, {license: ''}, {license: ' \t ', benchmarkPermission: true}]) {
			const h = harness();
			const report = await runBenchmarkSuite({lightningOptions}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.deepEqual(report.skipped, skipped);
			assert.deepEqual(h.frames.at(-1).warnings, skippedWarnings);
		}
	});

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
			const h = harness();
			const worker = h.dependencies.runWorker;
			h.dependencies.runWorker = request => {
				if (request.variant === 'd3') {
					const partial = saved(benchmarkMode(measurements));
					assert.equal(partial.failures[0].variant, 'chartjs');
					assert.equal(partial.progress.current, 'd3');
					assert.deepEqual(partial.progress.completed, ['idle', 'uplot']);
				}
				if (['chartjs', 'visx'].includes(request.variant)) {
					h.requests.push(request);
					throw new Error('synthetic worker failure');
				}
				return worker(request);
			};
			const result = await runBenchmarkSuite(measurements, h.dependencies);
			assert.equal(result.complete, true);
			assert.equal(result.progress.failed, null);
			assert.equal(result.progress.current, null);
			assert.equal('error' in result, false);
			assert.deepEqual(result.failures, ['chartjs', 'visx'].map(variant => ({variant, dpr: 1, error: 'synthetic worker failure'})));
			assert.deepEqual(h.requests.map(request => request.variant), variants);
			assert.deepEqual(result.reports.map(raw => raw.runner.variant), variants.filter(id => !['chartjs', 'visx'].includes(id)));
			const frame = h.frames.at(-1);
			assert.equal(frame.final, true);
			assert.equal(frame.status, `Failed visx (${variants.length}/${variants.length}).`);
			for (const id of ['chartjs', 'visx']) {
				assert.ok(frame.warnings.includes(`${id}: synthetic worker failure`));
				assert.ok(Object.entries(frame.rows.find(row => row.variant === id)).every(([key, value]) => key === 'variant' || value === '-'));
			}
			assert.deepEqual(offline(result).tables[0], frame.rows.map(row => Object.fromEntries(Object.entries(row)
				.map(([key, value]) => [key, Number.isFinite(value) ? Number(value.toFixed(1)) : value]))));
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
			assert.equal(result.progress.completed.at(-1), 'visx');
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
					assert.deepEqual(starting.warnings, [...skippedWarnings, 'uplot (DPR 1): gpu ms (2/3 valid, 1 missing).']);
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
		const result = offline({...savedReport([browser('idle'), raw]), skipped});
		const row = result.tables[0][0];
		assert.equal('n' in row, false);
		assert.equal('dpr' in row, false);
		assert.equal(row['main ms'], 2);
		assert.equal(row['gpu ms'], 1);
		assert.equal(row['total ms'], 'unavailable');
		assert.equal(Object.keys(row).some(key => key.endsWith(' n') || key.endsWith(' missing')), false);
		assert.deepEqual(result.logs.filter(([text]) => text.startsWith('Warning:')), [
			...skippedWarnings.map(warning => ['Warning: ' + warning]),
			['Warning: uplot (DPR 1): main ms (2/3 valid, 1 missing); gpu ms (4/3 valid, 0 missing); total ms (3/3 valid, 0 missing, unavailable).'],
		]);
		assert.deepEqual(result.events.map(event => event.type), ['table', ...skipped.map(() => 'log'), 'log', 'log']);
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
				const result = await runBenchmarkSuite({}, h.dependencies);
				assert.equal(result.complete, true);
				assert.deepEqual(started, variants);
				assert.deepEqual(result.failures.map(entry => entry.variant), ['chartjs']);
				assert.match(result.failures[0].error, /vendor error detail/);
				assert.deepEqual(result.progress.completed, variants.filter(id => id !== 'chartjs'));
			}
			else {
				await assert.rejects(runBenchmarkSuite({}, h.dependencies), {
					code: event === 'spawn error' ? 'BENCHMARK_WORKER_START_FAILED' : 'BENCHMARK_INTERRUPTED',
				});
				assert.deepEqual(started, ['idle', 'uplot', 'chartjs']);
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
