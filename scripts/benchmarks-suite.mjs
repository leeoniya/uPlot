import { spawn } from 'node:child_process';
import { SAMPLE_TIMEOUT_MS, SAMPLE_TIMEOUT_EXIT_CODE } from './bench-sample-timeout.mjs';
import { traceAccountingProtocol } from './bench-trace-policy.mjs';
import { benchmarkOperations, benchmarkTimingSamples, dashboardWorkload, assertCompatibleWorkloads } from './benchmarks-phases.mjs';
import { summarizeBenchmarkTraceSamples, TRACE_AGGREGATION } from './analyze-benchmarks-trace.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeAdjustedProcessMemory, assertCompatibleMemoryReports } from './analyze-benchmarks-process-memory.mjs';
import { createBenchmarkDisplay, formatBenchmarkDisplay, benchmarkDisplayColorDepth } from './benchmarks-display.mjs';
import { demoDependencies, benchmarkVariants, benchmarkMetadata, benchmarkLibraryName, demoRestrictions, benchmarkRestrictions, assertBenchmarkAvailable } from '../bench/demo-dependencies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = fileURLToPath(new URL('../.cache/benchmarks/', import.meta.url));
const VARIANTS = benchmarkVariants;
const display = value => Number.isFinite(value) ? value : 'unavailable';

function measurementsFor({trace = false, memory = false, raf = false}) {
	if (raf && (trace || memory))
		throw new Error('raf cannot be combined with trace or memory.');
	return trace || memory || raf ? {trace: !!trace, memory: !!memory, raf: !!raf} : {trace: true, memory: true, raf: false};
}

export function benchmarkMode(options) {
	const enabled = Object.entries(measurementsFor(options)).filter(([, enabled]) => enabled);
	return enabled.length > 1 ? 'combined' : enabled[0][0];
}

export function resolveBenchmarkVulkan({vulkan, 'no-vulkan': noVulkan = false, variant = null} = {}, platform = process.platform) {
	if (vulkan && noVulkan)
		throw new Error('--vulkan and --no-vulkan cannot be combined.');
	return noVulkan ? false : vulkan ?? (platform === 'linux' &&
		(variant === 'chartgpu' || (variant === null && benchmarkVariants.includes('chartgpu'))));
}

export function variantReportName(mode, variant, {vulkan = false, dashboard = false} = {}) {
	return `results-chrome-${dashboard ? 'dashboard-' : ''}${mode}${vulkan ? '-vulkan' : ''}-${variant}.json`;
}

export function suiteReportName(mode, {vulkan = false, dashboard = false} = {}) {
	return `results-chrome-${dashboard ? 'dashboard-' : ''}${mode}${vulkan ? '-vulkan' : ''}.json`;
}

export function traceReportName(mode, variant, {vulkan = false, dashboard = false} = {}) {
	return `trace-chrome-${dashboard ? 'dashboard-' : ''}${mode}${vulkan ? '-vulkan' : ''}-${variant}.json`;
}

const dashboardPlotlyVirtualWebGL = Object.freeze({version: '1.0.7', path: 'src/virtual-webgl.js', context: 'webgl'});

export function benchmarkVariantMetadata(variant, {dashboard = false} = {}) {
	// Pinned Boost defaults: 5,000 points per series or 50 series per chart.
	// The dashboard leaves those thresholds unchanged (300 points, five series).
	return {...benchmarkMetadata[variant], ...(dashboard && variant === 'highcharts'
		? {context: 'svg', sampling: 'none', lossy: false} : {}),
		...(dashboard && variant === 'plotly' ? {virtualWebGL: {...dashboardPlotlyVirtualWebGL}} : {})};
}

// Only these known GPU series can use captured GL contexts as renderer evidence.
// Canvas/SVG libraries may acquire GL contexts solely for support probes.
const webglSeries = new Set(['d3fc', 'bokeh', 'plotly', 'highcharts', 'scichart', 'lightningchart', 'g2-webgl']);

function assertVariantMetadata(snapshot) {
	if (!snapshot || typeof snapshot.sampling !== 'string' || !snapshot.sampling.trim() ||
		!(snapshot.context === null || (typeof snapshot.context === 'string' && snapshot.context.trim())) ||
		![true, false, null].includes(snapshot.lossy))
		throw new Error('Benchmark metadata requires sampling, context, and lossy snapshots.');
}

function metadataFor(variant, snapshot, samples = []) {
	assertVariantMetadata(snapshot);
	let context = snapshot.context;
	if (context === null && webglSeries.has(variant)) {
		const types = new Set(samples.filter(sample => !sample.warmup)
			.flatMap(sample => sample.webgl?.contexts ?? [])
			.map(({type}) => type === 'experimental-webgl' ? 'webgl' : type));
		if (types.size === 1 && ['webgl', 'webgl2'].includes([...types][0]))
			context = [...types][0];
	}
	return {
		context: context ?? 'unavailable',
		sampling: snapshot.sampling === 'none' ? '' : snapshot.sampling,
		lossy: snapshot.lossy === true ? '*' : snapshot.lossy === false ? '' : '?',
	};
}

function assertCompatibleDashboardPlotlyMetadata(metadata) {
	// Native dashboard captures must not inherit the current virtual-context config.
	if (Object.entries(dashboardPlotlyVirtualWebGL).some(([key, value]) => metadata?.virtualWebGL?.[key] !== value))
		throw new Error('Incompatible dashboard plotly virtualWebGL configuration. Rerun dashboard plotly with virtual-webgl 1.0.7 WebGL1 src/virtual-webgl.js.');
}

function assertCompatibleReports(reports, {trace, memory}, suite) {
	if (suite?.workload && suite.variantMetadata && Object.hasOwn(suite.variantMetadata, 'plotly'))
		assertCompatibleDashboardPlotlyMetadata(suite.variantMetadata.plotly);
	for (const raw of reports) {
		if (raw.workload && raw.runner?.variant === 'plotly')
			assertCompatibleDashboardPlotlyMetadata(raw.runner.benchmark);
	}
	for (const raw of reports) {
		if (raw.phase !== 'chart-population' || !benchmarkOperations(raw))
			throw new Error('Suite reports require current chart-population lifecycle protocols.');
		benchmarkTimingSamples(raw);
		assertVariantMetadata(raw.runner?.benchmark);
	}
	for (const {variant} of [...(suite?.failures ?? []), ...(suite?.timeouts ?? [])])
		assertVariantMetadata(suite.variantMetadata?.[variant]);
	if (memory)
		assertCompatibleMemoryReports(reports);
	if (new Set(reports.map(raw => JSON.stringify(raw.hover ? [...raw.hover.variants].sort() : null))).size > 1)
		throw new Error('Cannot combine different hover capabilities. Rerun all selected variants.');
	if (trace)
		for (const raw of reports)
			traceAccountingProtocol(raw);
}

function benchmarkView(report) {
	assertCompatibleWorkloads([report, ...report.reports]);
	assertCompatibleReports(report.reports, report.measurements, report);
	const {trace, memory, raf} = report.measurements;
	const resize = report.reports.some(raw => raw.resizeProtocol === 'retained-resize-v1');
	const hover = report.reports.find(raw => raw.hoverProtocol)?.hover;
	const resizeLabel = raf ? 'resize rAF ms' : 'resize ms';
	const initLabel = raf ? 'init rAF ms' : 'init ms';
	const workLabel = 'update ms';

	const warnings = [
		...(report.timeouts ?? []).map(({error}) => error),
		...(report.failures ?? []).map(({variant, error}) => `${variant}: ${error}`),

	];
	const rows = report.reports.filter(raw => raw.runner.variant !== 'idle').map(raw => {
		const {variant, dpr} = raw.runner;
		const group = analysis => analysis?.groups?.find(group => group.variant === variant && group.dpr === dpr);
		const measured = raw.samples.filter(sample => !sample.warmup).length;
		const row = {variant, ...metadataFor(variant, raw.runner.benchmark, raw.samples)};
		const issues = [];
		const metric = (label, stats, statistic = 'min') => {
			row[label] = display(stats?.[statistic]);
			const count = stats?.count ?? 0;
			const missing = stats?.missing ?? measured;
			const unavailable = !Number.isFinite(stats?.[statistic]);
			if (unavailable || count !== measured || missing !== 0)
				issues.push(`${label} (${count}/${measured} valid, ${missing} missing${unavailable ? ', unavailable' : ''})`);
		};
		if (trace) {
			const metrics = group(raw.analysis)?.metrics;
			for (const [label, key] of [
				['prep ms', 'dataPrepMs'], ['main ms', 'rendererMainTaskMs'],
				['gpu ms', 'gpuMainTaskMs'], [workLabel, 'totalTrackedThreadWorkMs'],
			])
				metric(label, metrics?.[key], 'mean');
		}
		if (raf) {
			const metrics = group(raw.rafAnalysis)?.metrics;
			metric('prep ms', metrics?.dataPrepMs);
			metric('update ms', metrics?.jsMs);
			metric('next rAF ms', metrics?.raf1Ms);
		}
		if (trace || raf) {
			const analysis = trace ? raw.analysis : raw.rafAnalysis;
			const phases = [[initLabel, 'small-init'], ...(resize ? [[resizeLabel, 'resize']] : [])];
			if (hover) {
				if (raw.hover.variants.includes(variant))
					phases.push(['hover10 ms', 'hover-10']);
				else
					row['hover10 ms'] = '';
			}
			for (const [label, operation] of phases) {
				const metrics = analysis?.phaseGroups?.find(group => group.variant === variant && group.dpr === dpr && group.operation === operation)?.metrics;
				const key = trace ? 'totalTrackedThreadWorkMs' : 'raf1Ms';
				metric(label, metrics?.[key], trace ? 'mean' : 'min');
			}
		}
		if (memory) {
			const stats = group(report.adjustedAnalysis)?.scopes.tree.pssMB;
			metric('peak MB', stats?.peak);
			metric('retained MB', stats?.live);
			if (stats?.baselines.blank === null) {
				const attempts = raw.blank?.attempts;
				const diagnostics = (raw.blank?.processMemory?.issues ?? []).map(({code, stage, pid, message}) =>
					[code, stage && `stage=${stage}`, pid != null && `pid=${pid}`, message].filter(Boolean).join(' ')).filter(Boolean);
				issues.push(`blank-page baseline unavailable${attempts?.length ? ` after ${attempts.length} attempts` : ''}` +
					(diagnostics.length ? `: ${diagnostics.join(', ')}` : ': no valid blank-page process-memory checkpoint'));
			}
		}
		if (issues.length)
			warnings.push(`${variant} (DPR ${dpr}): ${issues.join('; ')}.`);
		return row;
	});

	const columns = [
		...(trace || raf ? ['prep ms', initLabel, ...(raf ? ['update ms'] : [])] : []),
		...(trace ? ['main ms', 'gpu ms', workLabel] : []),
		...(raf ? ['next rAF ms'] : []),
		...(memory ? ['peak MB', 'retained MB'] : []),
		...(resize && (trace || raf) ? [resizeLabel] : []),
		...(hover && (trace || raf) ? ['hover10 ms'] : []),
	];
	for (const {variant} of [...(report.timeouts ?? []), ...(report.failures ?? [])]) {
		if (variant !== 'idle')
			rows.push({variant, ...metadataFor(variant, report.variantMetadata?.[variant]),
				...Object.fromEntries(columns.map(column => [column,
					column === 'hover10 ms' && !hover.variants.includes(variant) ? '' : '-']))});
	}

	// Establish stable tie order before grouping.
	const order = new Map(report.protocol?.variants?.map((variant, index) => [variant, index]));
	const compare = (left, right) => left === right ? 0 : left - right;
	rows.sort((a, b) => compare(order.get(a.variant) ?? Infinity, order.get(b.variant) ?? Infinity));
	const metric = trace ? workLabel : raf ? 'next rAF ms' : null;
	const speed = row => Number.isFinite(row[metric]) ? row[metric] : Infinity;
	const groups = new Map();
	for (const row of rows) {
		const library = benchmarkLibraryName(row.variant);
		if (!groups.has(library))
			groups.set(library, {rows: [], fastest: Infinity});
		const group = groups.get(library);
		group.rows.push(row);
		group.fastest = Math.min(group.fastest, speed(row));
	}
	const ordered = [...groups.values()];
	if (metric) {
		ordered.sort((a, b) => compare(a.fastest, b.fastest));
		for (const group of ordered)
			group.rows.sort((a, b) => compare(speed(a), speed(b)));
	}

	return {rows: ordered.flatMap(group => group.rows).map(row => ({
		variant: row.variant, context: row.context, sampling: row.sampling, lossy: row.lossy,
		...Object.fromEntries(columns.map(column => [column, row[column]])),
	})), warnings};
}

export function summarizeSavedBenchmarks(options, output, {platform = process.platform, outputDirectory = cache} = {}) {
	const vulkan = resolveBenchmarkVulkan(options, platform);
	const {dashboard = false} = options;
	const measurements = measurementsFor(options);
	output ??= resolve(outputDirectory, suiteReportName(benchmarkMode(options), {vulkan, dashboard}));
	const report = JSON.parse(readFileSync(output, 'utf8'));
	if (report.mode !== benchmarkMode(options) || !Array.isArray(report.reports) ||
		Object.keys(measurements).some(key => report.measurements?.[key] !== measurements[key]))
		throw new Error('Expected a benchmark suite report with matching measurements.');
	if (report.reports.some(raw => !raw?.runner || !Array.isArray(raw.samples)))
		throw new TypeError('Each report requires runner metadata and a samples array.');
	const requestedBackend = vulkan ? 'vulkan' : 'default';
	if (report.requestedBackend !== requestedBackend ||
		report.reports.some(raw => raw.runner.requestedBackend !== requestedBackend))
		throw new Error('Expected a benchmark suite report with matching requested backend.');
	if ((report.workload !== undefined) !== dashboard)
		throw new Error('Expected a benchmark suite report with matching dashboard workload selection.');
	assertCompatibleWorkloads([report, ...report.reports]);
	assertCompatibleReports(report.reports, measurements, report);
	if (measurements.trace) {
		for (const raw of report.reports) {
			const analysis = raw.analysis;
			if (!Array.isArray(analysis?.samples))
				continue;
			const groups = summarizeBenchmarkTraceSamples(analysis.samples);
			analysis.groups = groups.filter(group => group.operation === 'data-update');
			analysis.phaseGroups = groups;
			analysis.statistic = 'mean';
			analysis.definitions = {...analysis.definitions, aggregation: TRACE_AGGREGATION};
		}
	}
	if (measurements.memory)
		report.adjustedAnalysis = summarizeAdjustedProcessMemory(report.reports);
	const {rows, warnings} = benchmarkView(report);
	writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	const {verbose = false} = options;
	if (rows.length)
		console.log(formatBenchmarkDisplay({rows}, {colorDepth: benchmarkDisplayColorDepth(), verbose}).trimEnd());
	for (const warning of warnings)
		console.log('Warning: ' + warning);
	console.log('Updated summary from saved samples. No browser was started.');
	return report;
}

// A separate process group lets timeout and signal cleanup include the worker's browser.
function runWorker(request, {
	spawnWorker = spawn, signalSource = process, kill = process.kill.bind(process),
	setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawnWorker(request.command, request.args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
		}
		catch (error) {
			throw Object.assign(new Error(error.message, {cause: error}), {code: 'BENCHMARK_WORKER_START_FAILED'});
		}
				// Child logs must not move the cursor inside the live table region.
				let workerOutput = '';
				for (const stream of [child.stdout, child.stderr])
					stream?.on('data', chunk => { workerOutput = (workerOutput + chunk).slice(-16000); });
		let failure;
		let escalation;
		const send = signal => {
			if (!child.pid)
				return;
			try { kill(-child.pid, signal); }
			catch (error) {
				if (error.code !== 'ESRCH')
					failure = Object.assign(new Error(error.message, {cause: error}), {code: 'BENCHMARK_CLEANUP_FAILED'});
			}
		};
		const stop = (error, signal = 'SIGTERM') => {
			if (failure)
				return;
			failure = error;
			send(signal);
			escalation = setTimer(() => send('SIGKILL'), 2000);
		};
		const onInt = () => stop(Object.assign(new Error('Benchmark interrupted by SIGINT'), {code: 'BENCHMARK_INTERRUPTED'}), 'SIGINT');
		const onTerm = () => stop(Object.assign(new Error('Benchmark interrupted by SIGTERM'), {code: 'BENCHMARK_INTERRUPTED'}));
		signalSource.on('SIGINT', onInt);
		signalSource.on('SIGTERM', onTerm);
		const timer = setTimer(() => stop(new Error(`Benchmark ${request.variant} timed out after ${request.timeoutMs}ms`)), request.timeoutMs);
		let cleaned = false;
		const cleanup = () => {
			if (cleaned)
				return;
			cleaned = true;
			clearTimer(timer);
			clearTimer(escalation);
			signalSource.removeListener('SIGINT', onInt);
			signalSource.removeListener('SIGTERM', onTerm);
			send('SIGKILL');
		};
		child.once('error', error => {
			cleanup();
			error = Object.assign(new Error(error.message, {cause: error}), {code: 'BENCHMARK_WORKER_START_FAILED'});
			if (workerOutput.trim())
				error.message += '\n' + workerOutput.trim();
			reject(error);
		});
		child.once('close', (code, signal) => {
			cleanup();
			if (failure || code !== 0) {
				const sampleTimeout = !failure && code === SAMPLE_TIMEOUT_EXIT_CODE;
				const error = failure ?? (sampleTimeout
					? Object.assign(new Error(`${request.variant}: timed out after ${SAMPLE_TIMEOUT_MS / 1000}s`), {code: 'BENCHMARK_SAMPLE_TIMEOUT'})
					: new Error(`Benchmark ${request.variant} exited with ${signal ?? code}`));
				if (!sampleTimeout && workerOutput.trim())
					error.message += '\n' + workerOutput.trim();
				reject(error);
			}
			else
				resolve();
		});
	});
}

// Tests may supply runWorker(request), returning a raw report or writing request.output.
export async function runBenchmarkSuite({trace, memory, raf, dpr = 1, gpu = false, vulkan, 'no-vulkan': noVulkan, variant = null, lightningOptions, verbose = false, dashboard = false}, dependencies = {}) {
	if (!Number.isFinite(dpr) || dpr <= 0)
		throw new TypeError('dpr must be positive and finite');
	if (variant !== null && !Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unsupported benchmark variant: ${variant}`);
	if (variant !== null)
		assertBenchmarkAvailable(variant, lightningOptions);
	const measurements = measurementsFor({trace, memory, raf});
	const mode = benchmarkMode(measurements);
	vulkan = resolveBenchmarkVulkan({vulkan, 'no-vulkan': noVulkan, variant}, dependencies.platform);
	const requestedBackend = vulkan ? 'vulkan' : 'default';
	gpu = gpu || vulkan;
	const variants = variant === null ? [...VARIANTS, ...(lightningOptions?.license?.trim() ? ['lightningchart'] : [])]
			: [variant];
	const {outputDirectory = cache} = dependencies;
	const display = dependencies.display ?? createBenchmarkDisplay({verbose});
	const worker = dependencies.runWorker ?? (request => runWorker(request, dependencies));
	mkdirSync(outputDirectory, {recursive: true});
	const output = resolve(outputDirectory, suiteReportName(mode, {vulkan, dashboard}));
	const report = {
		date: new Date().toISOString(), mode, measurements, dpr, gpu, requestedBackend, complete: false,
		...(dashboard ? {workload: {...dashboardWorkload}} : {}),
		variantMetadata: Object.fromEntries(variants.map(id => [id, benchmarkVariantMetadata(id, {dashboard})])),
		skipped: variant === null ? Object.entries({...demoRestrictions, ...benchmarkRestrictions}).filter(([id]) => !variants.includes(id))
					.map(([variant, reason]) => ({variant, reason})) : [],
		progress: {total: variants.length, completed: [], current: null, failed: null},
		protocol: {
			freshBrowserPerVariant: true, selectedDependenciesOnly: true, variants,
			perBrowserBaseline: 'Retained and peak process memory subtract the same browser report\'s blank checkpoint. No idle or cross-browser controls are used.',
			coolingBetweenVariantsMs: 0,
			tracing: measurements.trace, gpuSpecificMemory: false, sampleTimeoutMs: SAMPLE_TIMEOUT_MS,
			blankAndLoaded: 'One cold checkpoint each per browser, not a round aggregate.',
			lifecycle: dashboard ? 'Three warmup sessions and seven measured sessions. Each session initializes 20 charts with five series and two rows each, then updates the retained charts to 300 rows per series. The 4x5 grid uses 480x216 tiles in a 1920x1080 viewport. Reports use dashboard-v1, chart-population, and settled-work-v1. The only operations are small-init and data-update. No resize or hover occurs.' : 'Three warmup sessions and seven measured sessions. Each session initializes a two-point chart, updates it with the full dataset, then resizes the retained chart to 1200x400. Reports use chart-population, settled-work-v1 initialization, retained-resize-v1 resize, and hover-ten-v3. lifecycle.resizeSize records width and height. Supported variants, including idle, then perform hover-10. Unsupported variants have only three phases.',
			hover: dashboard ? 'No hover operation occurs.' : 'hover.variants records supported variants, including idle. hover.count is 10 and hover.intervalMs is 50. One hover-10 window covers 10 mousemoves and the final settle/fence. Hover-ten-v3 sends all ten coordinate targets through one browser binding. Node sends ten CDP dispatches with nine 50 ms waits, each after the preceding CDP acknowledgment. Node sends one browser Runtime.evaluate completion acknowledgment after the tenth dispatch acknowledgment. No catch-up, per-point renderer timer, renderer acknowledgment, or rAF occurs. No value verification or harness DOM/canvas reads occur in this window. Batching reduces input-bridge overhead but does not eliminate it. Node scheduling is outside measured browser threads. Idle spacing is not thread work, but rAF wall latency includes at least 450 ms of spacing. Target preparation and bounds validation occur outside the window. Diagnostic verification never runs during capture or preflight. Reports retain count and interval without verification evidence. The result is cumulative, not a per-point average. Unsupported variants have no hover marker or sample and show a blank cell.',
			timingColumns: dashboard ? 'Trace init ms and update ms use total tracked thread work from each complete dashboard operation window, including settling and completion checks. Init includes all 20 hosts and charts. Main/gpu and prep describe data-update only. In rAF-only mode, init rAF ms uses initialization raf1Ms, update ms shows update readiness, and next rAF shows update callback latency. These are whole-dashboard measurements, not per-chart averages. Primary groups describe data-update. phaseGroups contains small-init and data-update only.' : 'Trace init ms, update ms, resize ms, and hover10 ms use total tracked thread work from each complete operation window. Each window includes settling and completion checks. Init includes chart-specific host setup. Main/gpu and prep describe data-update only. rAF-only init rAF ms and resize rAF ms use each operation\'s raf1Ms, not thread work. rAF-only update ms shows update readiness. Next rAF shows update callback latency. Primary groups and library ordering still describe data-update. phaseGroups contains all recorded operations. Untraced rAF hover10 ms uses the minimum hover raf1Ms, not the full-work equivalent.',
			memoryColumns: dashboard ? 'Dashboard process-memory reports use memoryProtocol through-update-v1. After baseline GC, peak covers initialization, preparation, and data-update through the live checkpoint. Forced GC and live follow settled data-update with all 20 charts and their full prepared inputs alive. No process reads or forced GC occur after live. No cleanup snapshot occurs, but all charts are destroyed. Each browser supplies its own blank memory baseline.' : 'Lifecycle process-memory reports use memoryProtocol through-update-v1. After baseline GC, peak covers small-init, full-data preparation, and data-update through the live checkpoint. Forced GC and the live checkpoint follow settled data-update immediately, before resize preparation, with the chart and full prepared input alive. No process reads or forced GC occur after this checkpoint. Resize and hover are timing-only. No cleanup snapshot occurs, but chart destruction still runs.',
			timeoutScope: 'Five seconds per operation, including preparation and settling. Setup/baseline belongs to the first operation. Post-update GC/live and final destruction each have a separate five-second budget.',
			aggregation: 'Trace timing columns use arithmetic means after warmups. Total work averages deduplicated per-sample totals, including observed GC. rAF timings and memory columns retain minima.',
			warmSamples: 'Warmups are excluded. Each browser reuses its selected library between samples; allocator reuse affects process deltas.',
		},
		reports: [], timeouts: [], failures: [], adjustedAnalysis: measurements.memory ? summarizeAdjustedProcessMemory([]) : null,
	};
	const processed = () => report.progress.completed.length + report.timeouts.length + report.failures.length;
	const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	save();
	try {
		for (const name of variants) {
			report.progress.current = name;
			save();
			display.update({...benchmarkView(report), status: `Starting ${name} (${processed() + 1}/${variants.length})...`});
			const variantOutput = resolve(outputDirectory, variantReportName(mode, name, {vulkan, dashboard}));
			// A successful worker must produce this run's report, never a cached predecessor.
			rmSync(variantOutput, {force: true});
			const args = [
				'--max-old-space-size=512', resolve(root, 'scripts/benchmarks.mjs'),
				'--worker', '--variant', name, '--dpr', String(dpr),
				...Object.keys(measurements).filter(key => measurements[key]).map(key => `--${key}`),
				...(gpu ? ['--gpu'] : []),
								...(dashboard ? ['--dashboard'] : []),
				// Workers must not reselect the backend based on their own variant.
				vulkan ? '--vulkan' : '--no-vulkan',
			];
			let reports;
			let adjustedAnalysis;
			try {
				const returned = await worker({command: process.execPath, args, variant: name, dpr, gpu, vulkan, dashboard, requestedBackend, measurements: {...measurements}, output: variantOutput, timeoutMs: 270000});
				const raw = returned ?? JSON.parse(readFileSync(variantOutput, 'utf8'));
				if (raw?.runner?.variant !== name || raw.runner?.dpr !== dpr || raw.runner.requestedBackend !== requestedBackend || !Array.isArray(raw.samples) ||
					Object.keys(measurements).some(key => raw.measurements?.[key] !== measurements[key]) ||
					raw.samples.some(sample => sample.variant !== name || sample.dpr !== dpr))
					throw new Error(`Unexpected benchmark report for ${name}`);
				assertCompatibleWorkloads([report, raw]);
				reports = [...report.reports, raw];
				assertCompatibleReports(reports, measurements, report);
				adjustedAnalysis = measurements.memory ? summarizeAdjustedProcessMemory(reports) : null;
			}
			catch (error) {
				// Cancellation and suite infrastructure failures are not library results.
				if (['BENCHMARK_INTERRUPTED', 'BENCHMARK_WORKER_START_FAILED', 'BENCHMARK_CLEANUP_FAILED'].includes(error?.code))
					throw error;
				const message = error instanceof Error ? error.message : String(error);
				const timedOut = error?.code === 'BENCHMARK_SAMPLE_TIMEOUT';
				if (timedOut)
					report.timeouts.push({variant: name, dpr, timeoutMs: SAMPLE_TIMEOUT_MS, error: message});
				else
					report.failures.push({variant: name, dpr, error: message});
				report.progress.current = null;
				report.complete = processed() === variants.length;
				save();
				display.update({...benchmarkView(report), status: `${timedOut ? message : `Failed ${name}`} (${processed()}/${variants.length}).`, final: report.complete});
				continue;
			}
			report.reports = reports;
			report.adjustedAnalysis = adjustedAnalysis;
			report.progress.completed.push(name);
			report.progress.current = null;
			report.complete = processed() === variants.length;
			save();
			display.update({...benchmarkView(report), status: `Completed ${name} (${processed()}/${variants.length}).`, final: report.complete});
		}
	}
	catch (error) {
		report.complete = false;
		report.progress.failed = report.progress.current;
		report.error = error instanceof Error ? error.message : String(error);
		save();
		display.update({...benchmarkView(report), status: `Benchmark suite incomplete. Partial report saved: ${output}`, final: true});
		throw error;
	}
	return report;
}
