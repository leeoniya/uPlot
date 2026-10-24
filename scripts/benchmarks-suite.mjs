import { spawn } from 'node:child_process';
import { SAMPLE_TIMEOUT_MS, SAMPLE_TIMEOUT_EXIT_CODE } from './bench-sample-timeout.mjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeAdjustedProcessMemory } from './analyze-benchmarks-process-memory.mjs';
import { createBenchmarkDisplay, formatBenchmarkDisplay } from './benchmarks-display.mjs';
import { demoDependencies, benchmarkVariants, demoRestrictions, benchmarkRestrictions, assertBenchmarkAvailable } from '../bench/demo-dependencies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = fileURLToPath(new URL('../.cache/benchmarks/', import.meta.url));
const VARIANTS = ['idle', ...benchmarkVariants];
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

export function variantReportName(mode, variant, {vulkan = false} = {}) {
	return `results-chrome-${mode}${vulkan ? '-vulkan' : ''}-${variant}.json`;
}

export function suiteReportName(mode, {vulkan = false} = {}) {
	return `results-chrome-${mode}${vulkan ? '-vulkan' : ''}.json`;
}

function benchmarkView(report) {
	const {trace, memory, raf} = report.measurements;
	const warnings = [
		...(report.timeouts ?? []).map(({error}) => error),
		...(report.failures ?? []).map(({variant, error}) => `${variant}: ${error}`),
		...(report.skipped ?? []).map(({variant, reason}) => `${variant}: skipped (${reason})`),
	];
	const rows = report.reports.filter(raw => raw.runner.variant !== 'idle').map(raw => {
		const {variant, dpr} = raw.runner;
		const group = analysis => analysis?.groups?.find(group => group.variant === variant && group.dpr === dpr);
		const measured = raw.samples.filter(sample => !sample.warmup).length;
		const row = {variant};
		const issues = [];
		const metric = (label, stats) => {
			row[label] = display(stats?.min);
			const count = stats?.count ?? 0;
			const missing = stats?.missing ?? measured;
			const unavailable = !Number.isFinite(stats?.min);
			if (unavailable || count !== measured || missing !== 0)
				issues.push(`${label} (${count}/${measured} valid, ${missing} missing${unavailable ? ', unavailable' : ''})`);
		};
		if (trace) {
			const metrics = group(raw.analysis)?.metrics;
			for (const [label, key] of [
				['prep ms', 'dataPrepMs'], ['init ms', 'jsIntervalMs'], ['main ms', 'rendererMainTaskMs'],
				['gpu ms', 'gpuMainTaskMs'], ['total ms', 'totalTrackedThreadWorkMs'],
			])
				metric(label, metrics?.[key]);
		}
		if (raf) {
			const metrics = group(raw.rafAnalysis)?.metrics;
			metric('prep ms', metrics?.dataPrepMs);
			metric('init ms', metrics?.jsMs);
			metric('next rAF ms', metrics?.raf1Ms);
		}
		if (memory) {
			const stats = group(report.adjustedAnalysis)?.scopes.tree.pssMB;
			metric('peak MB', stats?.peak);
			metric('retained MB', stats?.live);
		}
		if (issues.length)
			warnings.push(`${variant} (DPR ${dpr}): ${issues.join('; ')}.`);
		return row;
	});

	const columns = [
		...(trace ? ['prep ms', 'init ms', 'main ms', 'gpu ms', 'total ms'] : []),
		...(raf ? ['prep ms', 'init ms', 'next rAF ms'] : []),
		...(memory ? ['peak MB', 'retained MB'] : []),
	];
	for (const {variant} of [...(report.timeouts ?? []), ...(report.failures ?? [])])
		rows.push({variant, ...Object.fromEntries(columns.map(column => [column, '-']))});

	// Preserve execution order in memory/rAF reports, including failed entries.
	if (report.protocol?.variants)
		rows.sort((a, b) => report.protocol.variants.indexOf(a.variant) - report.protocol.variants.indexOf(b.variant));
	if (trace) {
		rows.sort((a, b) => {
			const left = Number.isFinite(a['total ms']) ? a['total ms'] : Infinity;
			const right = Number.isFinite(b['total ms']) ? b['total ms'] : Infinity;
			return left === right ? 0 : left - right;
		});
	}

	if (memory) {
		for (const raw of report.reports) {
			const reads = [raw.blank, raw.loaded, ...raw.samples.flatMap(sample => sample.processObservations ?? [])];
			const incomplete = reads.filter(read => read?.processMemory?.complete === false).length;
			if (incomplete)
				warnings.push(`${raw.runner.variant}: ${incomplete} incomplete process reads. Details remain in JSON.`);
		}
	}
	return {rows, warnings};
}

export function summarizeSavedBenchmarks(options, output = resolve(cache, suiteReportName(benchmarkMode(options), options))) {
	const measurements = measurementsFor(options);
	const report = JSON.parse(readFileSync(output, 'utf8'));
	if (report.mode !== benchmarkMode(options) || !Array.isArray(report.reports) ||
		Object.keys(measurements).some(key => report.measurements?.[key] !== measurements[key]))
		throw new Error('Expected a benchmark suite report with matching measurements.');
	if (report.reports.some(raw => !raw?.runner || !Array.isArray(raw.samples)))
		throw new TypeError('Each report requires runner metadata and a samples array.');
	const requestedBackend = options.vulkan ? 'vulkan' : 'default';
	// Reports saved before backend selection used Chrome's default backend.
	if ((report.requestedBackend ?? 'default') !== requestedBackend ||
		report.reports.some(raw => (raw.runner.requestedBackend ?? 'default') !== requestedBackend))
		throw new Error('Expected a benchmark suite report with matching requested backend.');
	if (measurements.memory)
		report.adjustedAnalysis = summarizeAdjustedProcessMemory(report.reports);
	writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	const {rows, warnings} = benchmarkView(report);
	if (rows.length)
		console.log(formatBenchmarkDisplay({rows}).trimEnd());
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
export async function runBenchmarkSuite({trace, memory, raf, dpr = 1, gpu = false, vulkan = false, variant = null, lightningOptions}, dependencies = {}) {
	if (!Number.isFinite(dpr) || dpr <= 0)
		throw new TypeError('dpr must be positive and finite');
	if (variant !== null && !Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unsupported benchmark variant: ${variant}`);
	if (variant !== null)
		assertBenchmarkAvailable(variant, lightningOptions);
	const measurements = measurementsFor({trace, memory, raf});
	const mode = benchmarkMode(measurements);
	const requestedBackend = vulkan ? 'vulkan' : 'default';
	gpu = gpu || vulkan;
	const variants = variant === null ? [...VARIANTS, ...(lightningOptions?.license?.trim() ? ['lightningchart'] : [])]
			: variant === 'idle' ? ['idle'] : ['idle', variant];
	const {outputDirectory = cache} = dependencies;
		const display = dependencies.display ?? createBenchmarkDisplay();
	const worker = dependencies.runWorker ?? (request => runWorker(request, dependencies));
	mkdirSync(outputDirectory, {recursive: true});
	const output = resolve(outputDirectory, suiteReportName(mode, {vulkan}));
	const report = {
		date: new Date().toISOString(), mode, measurements, dpr, gpu, requestedBackend, complete: false,
		skipped: variant === null ? Object.entries({...demoRestrictions, ...benchmarkRestrictions}).filter(([id]) => !variants.includes(id))
					.map(([variant, reason]) => ({variant, reason})) : [],
		progress: {total: variants.length, completed: [], current: null, failed: null},
		protocol: {
			freshBrowserPerVariant: true, selectedDependenciesOnly: true, variants,
			idleFirst: true, sameRunControlsOnly: true, coolingBetweenVariantsMs: 0,
			tracing: measurements.trace, gpuSpecificMemory: false, sampleTimeoutMs: SAMPLE_TIMEOUT_MS,
			blankAndLoaded: 'One cold checkpoint each per browser, not a round aggregate.',
			aggregation: 'Each table metric uses its minimum finite measured value after warmups. Columns can come from different rounds; total work uses the minimum per-sample total, not a sum of column minima.',
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
			const variantOutput = resolve(outputDirectory, variantReportName(mode, name, {vulkan}));
			// A successful worker must produce this run's report, never a cached predecessor.
			rmSync(variantOutput, {force: true});
			const args = [
				'--max-old-space-size=512', resolve(root, 'scripts/benchmarks.mjs'),
				'--worker', '--variant', name, '--dpr', String(dpr),
				...Object.keys(measurements).filter(key => measurements[key]).map(key => `--${key}`),
				...(gpu ? ['--gpu'] : []),
				...(vulkan ? ['--vulkan'] : []),
			];
			let reports;
			let adjustedAnalysis;
			try {
				const returned = await worker({command: process.execPath, args, variant: name, dpr, gpu, vulkan, requestedBackend, measurements: {...measurements}, output: variantOutput, timeoutMs: 270000});
				const raw = returned ?? JSON.parse(readFileSync(variantOutput, 'utf8'));
				if (raw?.runner?.variant !== name || raw.runner?.dpr !== dpr || raw.runner.requestedBackend !== requestedBackend || !Array.isArray(raw.samples) ||
					Object.keys(measurements).some(key => raw.measurements?.[key] !== measurements[key]) ||
					raw.samples.some(sample => sample.variant !== name || sample.dpr !== dpr))
					throw new Error(`Unexpected benchmark report for ${name}`);
				reports = [...report.reports, raw];
				adjustedAnalysis = measurements.memory ? summarizeAdjustedProcessMemory(reports) : null;
			}
			catch (error) {
				// Cancellation and suite infrastructure failures are not library results.
				if (name === 'idle' || ['BENCHMARK_INTERRUPTED', 'BENCHMARK_WORKER_START_FAILED', 'BENCHMARK_CLEANUP_FAILED'].includes(error?.code))
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
