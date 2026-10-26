import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {runInNewContext} from 'node:vm';
import {benchmarkMode, benchmarkVariantMetadata, resolveBenchmarkVulkan, variantReportName, suiteReportName,
	traceReportName, runBenchmarkSuite, summarizeSavedBenchmarks} from '../../scripts/benchmarks-suite.mjs';
import {dashboardWorkload, benchmarkOperations, benchmarkTimingSamples, assertCompatibleWorkloads} from '../../scripts/benchmarks-phases.mjs';
import {summarizeAdjustedProcessMemory, summarizeProcessMemory} from '../../scripts/analyze-benchmarks-process-memory.mjs';
import {summarizeBenchmarkTraceSamples} from '../../scripts/analyze-benchmarks-trace.mjs';
import {summarizeBenchmarkRaf} from '../../scripts/analyze-benchmarks-raf.mjs';
import {benchmarkVariants, benchmarkMetadata, demoDependencies, assertBenchmarkAvailable} from '../../bench/demo-dependencies.mjs';

const root = new URL('../../', import.meta.url);
const operations = ['small-init', 'data-update'];
const modes = [
	{trace: true, memory: true, raf: false},
	{trace: true, memory: false, raf: false},
	{trace: false, memory: true, raf: false},
	{trace: false, memory: false, raf: true},
];
const memory = value => ({rssMB: value, pssMB: value, privateMB: value, swapMB: 0, swapPssMB: 0});
const observation = (phase, value) => ({phase, kind: phase === 'construct' ? 'poll' : 'gc',
	processMemory: {complete: true, renderer: memory(value), tree: memory(value)}});

function browser({variant, dpr = 1, requestedBackend = 'default', measurements = modes[0], dashboard = true}) {
	const raw = {
		measurements: {...measurements}, phase: 'chart-population', initProtocol: 'settled-work-v1',
		...(dashboard ? {workload: {...dashboardWorkload}} : {}),
		lifecycle: {operations: [...operations], initialRows: 2, updateRows: dashboard ? 300 : 55550},
		memoryProtocol: 'through-update-v1',
		runner: {variant, dpr, requestedBackend, benchmark: benchmarkVariantMetadata(variant, {dashboard})},
		blank: observation('blank', 10), loaded: observation('loaded', 20),
		samples: [-1, 0, 1].map(round => {
			const phases = operations.map((operation, index) => ({
				id: `${variant}-${round}-${index}`, variant, dpr, round, warmup: round < 0, operation,
				dataPrepMs: 2, jsMs: index + 3, raf1Ms: index + 10, windowMs: 220,
			}));
			return {...phases[1], phases, processObservations: [observation('baseline', 11), observation('prepared', 15),
				observation('construct', variant === 'idle' ? 30 : 50), observation('live', variant === 'idle' ? 20 : 40)]};
		}),
	};
	if (measurements.trace) {
		const samples = raw.samples.flatMap(sample => sample.phases.map(phase => ({...phase,
			dataPrepMs: phase.dataPrepMs, jsIntervalMs: phase.jsMs,
			rendererMainTaskMs: 3, gpuMainTaskMs: 1, totalTrackedThreadWorkMs: phase.operation === 'small-init' ? 12 : 25,
		})));
		const phaseGroups = summarizeBenchmarkTraceSamples(samples);
		raw.analysis = {samples, groups: phaseGroups.filter(group => group.operation === 'data-update'), phaseGroups};
	}
	if (measurements.raf) raw.rafAnalysis = summarizeBenchmarkRaf(raw);
	return raw;
}

function quiet(fn) {
	const log = console.log;
	const logs = [];
	try {
		console.log = (...args) => logs.push(args.join(' '));
		return {result: fn(), logs};
	}
	finally { console.log = log; }
}

let directory;
function harness(worker = browser) {
	const requests = [], frames = [];
	return {requests, frames, dependencies: {
		outputDirectory: directory, platform: 'linux',
		display: {update: frame => frames.push(structuredClone(frame))},
		runWorker: async request => {
			requests.push(request);
			return worker(request);
		},
	}};
}

function save(reports, measurements) {
	const report = {mode: benchmarkMode(measurements), measurements, workload: {...dashboardWorkload},
		requestedBackend: 'default', reports, protocol: {variants: reports.map(raw => raw.runner.variant)}};
	const output = join(directory, 'saved.json');
	writeFileSync(output, JSON.stringify(report));
	return output;
}

describe('dashboard benchmark suite', () => {
	beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'uplot-dashboard-suite-')); });
	afterEach(() => { rmSync(directory, {recursive: true, force: true}); });

	it('provides the dashboard package command and public boolean help without a browser', () => {
		const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
		assert.equal(pkg.scripts['bench:dash'], 'node --max-old-space-size=512 ./scripts/benchmarks.mjs --dashboard --gpu');
		const script = new URL('scripts/benchmarks.mjs', root);
		const help = spawnSync(process.execPath, [script.pathname, '--dashboard', '--help'], {encoding: 'utf8', timeout: 10000});
		assert.equal(help.status, 0, help.stderr);
		for (const text of ['bun run bench:dash', '1920x1080', '480x216', 'No resize or hover', '--summarize-only', 'dashboard-v1'])
			assert.ok(help.stdout.includes(text), text);
		const invalid = spawnSync(process.execPath, [script.pathname, '--dashboard=false', '--help'], {encoding: 'utf8', timeout: 10000});
		assert.notEqual(invalid.status, 0);
	});

	it('forwards dashboard selection through live and saved CLI dispatch, preserving combined defaults', async () => {
		const source = readFileSync(new URL('scripts/benchmarks.mjs', root), 'utf8');
		const block = source.slice(source.indexOf('const chromeVersion ='), source.indexOf('const binary = await chromeBinary('));
		for (const dashboard of [false, true]) for (const saved of [false, true]) {
			const calls = [], exited = new Error('exit');
			const args = ['--no-vulkan', ...(dashboard ? ['--dashboard'] : []), ...(saved ? ['--summarize-only'] : ['--variant', 'uplot'])];
			await assert.rejects(runInNewContext(`(async () => {${block}})()`, {
				parseArgs: options => parseArgs({...options, args}), resolveBenchmarkVulkan, benchmarkMode,
				demoDependencies, assertBenchmarkAvailable, platform: () => 'linux',
				process: {env: {}, exit: () => { throw exited; }},
				runBenchmarkSuite: async options => calls.push(options), summarizeSavedBenchmarks: options => calls.push(options),
			}), error => error === exited);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].dashboard, dashboard);
			assert.equal(calls[0].trace, true);
			assert.equal(calls[0].memory, true);
			assert.equal(calls[0].raf, false);
			if (!saved) assert.equal(calls[0].variant, 'uplot');
		}
	});

	for (const measurements of modes) for (const vulkan of [false, true]) {
		const mode = benchmarkMode(measurements);
		it(`${mode}, Vulkan ${vulkan}: separates paths, forwards flags, and preserves live/saved metrics`, async () => {
			const options = {...measurements, dashboard: true, variant: 'highcharts', vulkan, dpr: 2, gpu: true};
			const suffix = `${mode}${vulkan ? '-vulkan' : ''}`;
			assert.equal(suiteReportName(mode, options), `results-chrome-dashboard-${suffix}.json`);
			assert.equal(variantReportName(mode, 'highcharts', options), `results-chrome-dashboard-${suffix}-highcharts.json`);
			assert.equal(traceReportName(mode, 'highcharts', options), `trace-chrome-dashboard-${suffix}-highcharts.json`);
			const single = [suiteReportName(mode, {vulkan}), variantReportName(mode, 'idle', {vulkan}),
				variantReportName(mode, 'highcharts', {vulkan}), traceReportName(mode, 'highcharts', {vulkan})];
			for (const name of single) writeFileSync(join(directory, name), 'single-chart sentinel');
			const h = harness(request => {
				const partial = JSON.parse(readFileSync(join(directory, suiteReportName(mode, options)), 'utf8'));
				assert.deepEqual(partial.workload, dashboardWorkload);
				assert.deepEqual(partial.variantMetadata.highcharts, {context: 'svg', sampling: 'none', lossy: false});
				assert.equal(existsSync(request.output), false, 'stale dashboard raw reports must be removed');
				const raw = browser(request);
				writeFileSync(request.output, JSON.stringify(raw));
			});
			writeFileSync(join(directory, variantReportName(mode, 'highcharts', options)), 'stale dashboard');
			const report = await runBenchmarkSuite(options, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), ['idle', 'highcharts']);
			for (const request of h.requests) {
				assert.equal(request.dashboard, true);
				assert.equal(request.dpr, 2);
				assert.equal(request.args.filter(arg => arg === '--dashboard').length, 1);
				assert.ok(request.args.includes('--gpu'));
				assert.ok(request.args.includes(vulkan ? '--vulkan' : '--no-vulkan'));
				for (const key of ['trace', 'memory', 'raf']) assert.equal(request.args.includes(`--${key}`), measurements[key]);
			}
			assert.equal(report.complete, true);
			assert.notEqual(report.workload, dashboardWorkload);
			const row = h.frames.at(-1).rows[0];
			assert.equal(row.context, 'svg');
			assert.equal(row.sampling, '');
			assert.equal(row.lossy, '');
			assert.ok(!Object.keys(row).some(key => /resize|hover/.test(key)));
			if (measurements.trace) { assert.equal(row['init ms'], 12); assert.equal(row['update ms'], 25); }
			if (measurements.raf) { assert.equal(row['init rAF ms'], 10); assert.equal(row['update ms'], 4); }
			if (measurements.memory) { assert.equal(row['retained MB'], 20); assert.equal(row['peak MB'], 30); }
			const output = join(directory, suiteReportName(mode, options));
			const original = structuredClone(report.reports);
			const summary = quiet(() => summarizeSavedBenchmarks({...measurements, dashboard: true, vulkan}, undefined, {outputDirectory: directory}));
			assert.deepEqual(summary.result.reports.map(raw => raw.samples), original.map(raw => raw.samples));
			assert.deepEqual(summary.result.workload, dashboardWorkload);
			assert.deepEqual(summary.result.adjustedAnalysis, report.adjustedAnalysis);
			assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')).workload, dashboardWorkload);
			assert.ok(summary.logs.some(text => text.includes('No browser was started')));
			assert.ok(!summary.logs.some(text => /resize ms|hover10 ms/.test(text)));
			for (const name of single) assert.equal(readFileSync(join(directory, name), 'utf8'), 'single-chart sentinel');
		});
	}

	it('runs all 44 defaults plus idle, adding only licensed LightningChart', async () => {
		for (const licensed of [false, true]) {
			const h = harness();
			const report = await runBenchmarkSuite({raf: true, dashboard: true,
				...(licensed ? {lightningOptions: {license: 'test-key'}} : {})}, h.dependencies);
			assert.deepEqual(h.requests.map(request => request.variant), ['idle', ...benchmarkVariants, ...(licensed ? ['lightningchart'] : [])]);
			assert.ok(h.requests.every(request => request.args.includes('--dashboard') && request.args.includes('--vulkan')));
			assert.deepEqual(report.workload, dashboardWorkload);
			assert.equal(report.failures.length, 0);
		}
	});

	it('keeps an explicit idle selection singular and restrictions intact', async () => {
		const h = harness();
		await runBenchmarkSuite({memory: true, dashboard: true, variant: 'idle', vulkan: false}, h.dependencies);
		assert.deepEqual(h.requests.map(request => request.variant), ['idle']);
		for (const variant of ['googlecharts', 'g2-webgl', 'jscharting', 'lightningchart'])
			await assert.rejects(runBenchmarkSuite({raf: true, dashboard: true, variant}, h.dependencies));
		assert.equal(h.requests.length, 1);
	});

	for (const measurements of modes) {
		const mode = benchmarkMode(measurements);
		it(`${mode}: rejects mixed workloads, dimension changes, and wrong saved selection before writing`, () => {
			const changes = [
				raw => delete raw.workload,
				...['series', 'rows', 'width', 'height'].map(key => raw => raw.workload[key]++),
				raw => { raw.workload.columns = 5; raw.workload.gridRows = 4; },
				raw => { raw.workload.charts = 24; raw.workload.columns = 6; },
				raw => { raw.workload.protocol = 'dashboard-v2'; },
				raw => { raw.workload = null; },
			];
			for (const change of changes) {
				const reports = ['idle', 'uplot'].map(variant => browser({variant, measurements}));
				change(reports[1]);
				const output = save(reports, measurements), bytes = readFileSync(output, 'utf8');
				assert.throws(() => summarizeSavedBenchmarks({...measurements, dashboard: true, vulkan: false}, output), /workload|dimensions/);
				assert.equal(readFileSync(output, 'utf8'), bytes);
				assert.throws(() => summarizeAdjustedProcessMemory(reports), /workload|dimensions/);
			}
			const reports = ['idle', 'uplot'].map(variant => browser({variant, measurements}));
			let output = save(reports, measurements);
			assert.throws(() => summarizeSavedBenchmarks({...measurements, vulkan: false}, output), /workload selection/);
			for (const raw of reports) delete raw.workload;
			output = save(reports, measurements);
			const suite = JSON.parse(readFileSync(output, 'utf8'));
			delete suite.workload;
			writeFileSync(output, JSON.stringify(suite));
			assert.throws(() => summarizeSavedBenchmarks({...measurements, dashboard: true, vulkan: false}, output), /workload selection/);
		});

		it(`${mode}: rejects incompatible live workers, including the first idle report`, async () => {
			const h = harness(request => {
				const raw = browser(request);
				if (request.variant !== 'idle') raw.workload.width++;
				return raw;
			});
			const report = await runBenchmarkSuite({...measurements, dashboard: true, variant: 'uplot', vulkan: false}, h.dependencies);
			assert.equal(report.reports.length, 1);
			assert.match(report.failures[0].error, /workload|dimensions/);
			assert.equal(h.frames.at(-1).rows[0][measurements.memory ? 'peak MB' : 'update ms'], '-');
			const wrongIdle = harness(request => browser({...request, dashboard: false}));
			await assert.rejects(runBenchmarkSuite({...measurements, dashboard: true, variant: 'uplot', vulkan: false}, wrongIdle.dependencies), /workload|dimensions/);
			assert.equal(wrongIdle.requests.length, 1);
		});
	}

	it('validates dashboard operation boundaries even in memory-only mode', () => {
		for (const change of [
			raw => raw.resizeProtocol = 'retained-resize-v1',
			raw => raw.hover = {count: 10},
			raw => raw.initProtocol = 'readiness',
			raw => raw.phase = 'chart-lifecycle',
			raw => raw.lifecycle.operations.push('resize'),
			raw => raw.samples[0].phases.pop(),
		]) {
			const measurements = modes[2], raw = browser({variant: 'idle', measurements});
			change(raw);
			const output = save([raw], measurements);
			assert.throws(() => summarizeSavedBenchmarks({...measurements, dashboard: true, vulkan: false}, output), /lifecycle|Lifecycle/);
		}
		const raw = browser({variant: 'uplot'});
		assert.deepEqual(benchmarkOperations(raw), operations);
		assert.equal(benchmarkTimingSamples(raw).length, 6);
		const reordered = {...raw, workload: Object.fromEntries(Object.entries(raw.workload).reverse())};
		assert.doesNotThrow(() => assertCompatibleWorkloads([raw, reordered]));
		const summary = summarizeProcessMemory({...raw, samples: raw.samples.map(sample => ({...sample, observations: sample.processObservations}))});
		assert.deepEqual(summary.workload, dashboardWorkload);
		assert.match(summary.definitions.live, /all dashboard charts/);
		assert.match(summary.definitions.peak, /no resize or hover/);
	});

	it('preserves default single-chart paths, metadata, and worker flags', async () => {
		const h = harness();
		const report = await runBenchmarkSuite({raf: true, variant: 'highcharts', vulkan: false}, h.dependencies);
		assert.ok(h.requests.every(request => !request.args.includes('--dashboard')));
		assert.equal(report.workload, undefined);
		assert.deepEqual(report.variantMetadata.highcharts, benchmarkMetadata.highcharts);
		assert.equal(suiteReportName('raf'), 'results-chrome-raf.json');
		assert.equal(variantReportName('raf', 'highcharts'), 'results-chrome-raf-highcharts.json');
		assert.equal(traceReportName('raf', 'highcharts'), 'trace-chrome-raf-highcharts.json');
		assert.equal(report.failures.length, 0);
	});

	it('executes the real worker setup with mocked Chrome, selecting fixture, viewport, assets, capture and output', async () => {
		const source = readFileSync(new URL('scripts/benchmarks.mjs', root), 'utf8');
		const block = source.slice(source.indexOf('const binary = await chromeBinary('));
		for (const dashboard of [false, true]) {
			const values = {variant: 'highcharts', dashboard, gpu: true};
			const measurements = modes[3], mode = 'raf', vulkan = false;
			let capture, launch, loaded, profile;
			const reads = [];
			const child = new EventEmitter();
			Object.assign(child, {pid: 123, exitCode: 0, stdout: new EventEmitter(), stderr: new EventEmitter()});
			const server = new EventEmitter();
			Object.assign(server, {listen: (port, host, ready) => ready(), address: () => ({port: 12345}),
				closeAllConnections() {}, close: done => done()});
			await runInNewContext(`(async () => {${block}})()`, {
				values, root, cache: directory, chromeVersion: 'mock', mode, measurements, vulkan, dpr: 1, lightningOptions: undefined, sciChartOptions: undefined,
				chromeBinary: async () => '/mock/chrome',
				loadBenchDemoSources: (root, variant, options) => {
					loaded = {root, variant, options};
					return {files: new Map(), dependencies: [], localScripts: [], localStyles: []};
				},
				readFileSync: (path, encoding) => { reads.push(String(path)); return readFileSync(path, encoding); },
				mkdirSync, mkdtempSync: prefix => { profile = mkdtempSync(prefix); return profile; }, rmSync, writeFileSync,
				tmpdir, join, URL, createHash, setTimeout, clearTimeout, createServer: () => server,
				execFileSync: () => 'Mock Chrome', spawn: (binary, args) => { launch = {binary, args}; return child; },
				captureBenchmarkTrace: async options => { capture = options; return browser({variant: values.variant, dashboard, measurements}); },
				traceReportName, variantReportName, benchmarkVariantMetadata, summarizeBenchmarkRaf,
				process: {version: process.version, once() {}, removeListener() {}}, cpus: () => [], platform: () => 'linux', release: () => 'test',
				console: {log() {}},
			});
			assert.equal(loaded.variant, 'highcharts');
			assert.equal(loaded.options.dashboard, dashboard);
			assert.equal(capture.dashboard, dashboard);
			assert.ok(launch.args.includes(`--window-size=1920,${dashboard ? 1080 : 900}`));
			assert.equal(capture.traceName, traceReportName(mode, values.variant, {dashboard}));
			assert.equal(capture.url, 'http://127.0.0.1:12345/?variant=highcharts');
			assert.ok(profile.startsWith(join(tmpdir(), 'uplot-bench-chrome-')));
			assert.equal(existsSync(profile), false);
			assert.equal(reads.some(path => path.endsWith('/bench/data.json')), !dashboard);
			assert.ok(reads.some(path => path.endsWith(dashboard ? '/bench/dashboard/browser.mjs' : '/scripts/benchmarks-trace-browser.mjs')));
			const raw = JSON.parse(readFileSync(join(directory, variantReportName(mode, values.variant, {dashboard})), 'utf8'));
			assert.equal(raw.runner.benchmark.context, dashboard ? 'svg' : 'webgl');
			assert.equal(Object.hasOwn(raw.runner.sourceSha256, '/bench/data.json'), !dashboard);
		}
	});
});
