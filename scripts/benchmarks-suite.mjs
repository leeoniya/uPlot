import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeAdjustedProcessMemory } from './analyze-benchmarks-process-memory.mjs';
import { createBenchmarkDisplay } from './benchmarks-display.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = fileURLToPath(new URL('../.cache/benchmarks/', import.meta.url));
const VARIANTS = ['idle', 'uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs'];
const display = value => Number.isFinite(value) ? +value.toFixed(3) : 'unavailable';

function measurementsFor({trace = false, memory = false, raf = false}) {
	if (raf && (trace || memory))
		throw new Error('raf cannot be combined with trace or memory.');
	return trace || memory || raf ? {trace: !!trace, memory: !!memory, raf: !!raf} : {trace: true, memory: true, raf: false};
}

export function benchmarkMode(options) {
	const enabled = Object.entries(measurementsFor(options)).filter(([, enabled]) => enabled);
	return enabled.length > 1 ? 'combined' : enabled[0][0];
}

export function variantReportName(mode, variant) {
	return `results-chrome-${mode}-${variant}.json`;
}

export function suiteReportName(mode) {
	return `results-chrome-${mode}.json`;
}

function benchmarkView(report) {
	const {trace, memory, raf} = report.measurements;
	const warnings = [];
	const rows = report.reports.filter(raw => raw.runner.variant !== 'idle').map(raw => {
		const {variant, dpr} = raw.runner;
		const group = analysis => analysis?.groups?.find(group => group.variant === variant && group.dpr === dpr);
		const measured = raw.samples.filter(sample => !sample.warmup).length;
		const row = {variant};
		const issues = [];
		const metric = (label, stats) => {
			row[label] = display(stats?.median);
			const count = stats?.count ?? 0;
			const missing = stats?.missing ?? measured;
			const unavailable = !Number.isFinite(stats?.median);
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
			metric('retained MB', stats?.live);
			metric('peak MB', stats?.peak);
		}
		if (issues.length)
			warnings.push(`${variant} (DPR ${dpr}): ${issues.join('; ')}.`);
		return row;
	});

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

export function summarizeSavedBenchmarks(options, output = resolve(cache, suiteReportName(benchmarkMode(options)))) {
	const measurements = measurementsFor(options);
	const report = JSON.parse(readFileSync(output, 'utf8'));
	if (report.mode !== benchmarkMode(options) || !Array.isArray(report.reports) ||
		Object.keys(measurements).some(key => report.measurements?.[key] !== measurements[key]))
		throw new Error('Expected a benchmark suite report with matching measurements.');
	if (report.reports.some(raw => !raw?.runner || !Array.isArray(raw.samples)))
		throw new TypeError('Each report requires runner metadata and a samples array.');
	if (measurements.memory)
		report.adjustedAnalysis = summarizeAdjustedProcessMemory(report.reports);
	writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	const {rows, warnings} = benchmarkView(report);
	if (rows.length)
		console.table(rows);
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
		const child = spawnWorker(request.command, request.args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
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
					failure ??= error;
			}
		};
		const stop = (error, signal = 'SIGTERM') => {
			if (failure)
				return;
			failure = error;
			send(signal);
			escalation = setTimer(() => send('SIGKILL'), 2000);
		};
		const onInt = () => stop(new Error('Benchmark interrupted by SIGINT'), 'SIGINT');
		const onTerm = () => stop(new Error('Benchmark interrupted by SIGTERM'));
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
			if (workerOutput.trim())
				error.message += '\n' + workerOutput.trim();
			reject(error);
		});
		child.once('close', (code, signal) => {
			cleanup();
			if (failure || code !== 0) {
				const error = failure ?? new Error(`Benchmark ${request.variant} exited with ${signal ?? code}`);
				if (workerOutput.trim())
					error.message += '\n' + workerOutput.trim();
				reject(error);
			}
			else
				resolve();
		});
	});
}

// Tests may supply runWorker(request), returning a raw report or writing request.output.
export async function runBenchmarkSuite({trace, memory, raf, dpr = 1, gpu = false, variant = null}, dependencies = {}) {
	if (!Number.isFinite(dpr) || dpr <= 0)
		throw new TypeError('dpr must be positive and finite');
	if (variant !== null && !VARIANTS.includes(variant))
		throw new Error(`Unsupported benchmark variant: ${variant}`);
	const measurements = measurementsFor({trace, memory, raf});
	const mode = benchmarkMode(measurements);
	const variants = variant === null ? [...VARIANTS] : variant === 'idle' ? ['idle'] : ['idle', variant];
	const {outputDirectory = cache} = dependencies;
		const display = dependencies.display ?? createBenchmarkDisplay();
	const worker = dependencies.runWorker ?? (request => runWorker(request, dependencies));
	mkdirSync(outputDirectory, {recursive: true});
	const output = resolve(outputDirectory, suiteReportName(mode));
	const report = {
		date: new Date().toISOString(), mode, measurements, dpr, gpu, complete: false,
		progress: {total: variants.length, completed: [], current: null, failed: null},
		protocol: {
			freshBrowserPerVariant: true, selectedDependenciesOnly: true, variants,
			idleFirst: true, sameRunControlsOnly: true, coolingBetweenVariantsMs: 0,
			tracing: measurements.trace, gpuSpecificMemory: false,
			blankAndLoaded: 'One cold checkpoint each per browser, not round medians.',
			warmSamples: 'Warmups are excluded. Each browser reuses its selected library between samples; allocator reuse affects process deltas.',
		},
		reports: [], adjustedAnalysis: measurements.memory ? summarizeAdjustedProcessMemory([]) : null,
	};
	const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	save();
	try {
		for (const name of variants) {
			report.progress.current = name;
			save();
			display.update({...benchmarkView(report), status: `Starting ${name} (${report.progress.completed.length + 1}/${variants.length})...`});
			const variantOutput = resolve(outputDirectory, variantReportName(mode, name));
			// A successful worker must produce this run's report, never a cached predecessor.
			rmSync(variantOutput, {force: true});
			const args = [
				'--max-old-space-size=512', resolve(root, 'scripts/benchmarks.mjs'),
				'--worker', '--variant', name, '--dpr', String(dpr),
				...Object.keys(measurements).filter(key => measurements[key]).map(key => `--${key}`),
				...(gpu ? ['--gpu'] : []),
			];
			const returned = await worker({command: process.execPath, args, variant: name, dpr, gpu, measurements: {...measurements}, output: variantOutput, timeoutMs: 270000});
			const raw = returned ?? JSON.parse(readFileSync(variantOutput, 'utf8'));
			if (raw.runner?.variant !== name || raw.runner?.dpr !== dpr || !Array.isArray(raw.samples) ||
				Object.keys(measurements).some(key => raw.measurements?.[key] !== measurements[key]) ||
				raw.samples.some(sample => sample.variant !== name || sample.dpr !== dpr))
				throw new Error(`Unexpected benchmark report for ${name}`);
			const reports = [...report.reports, raw];
			const adjustedAnalysis = measurements.memory ? summarizeAdjustedProcessMemory(reports) : null;
			report.reports = reports;
			report.adjustedAnalysis = adjustedAnalysis;
			report.progress.completed.push(name);
			report.progress.current = null;
			report.complete = report.progress.completed.length === variants.length;
			save();
			display.update({...benchmarkView(report), status: `Completed ${name} (${report.progress.completed.length}/${variants.length}).`, final: report.complete});
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
