import { performance } from 'node:perf_hooks';
import { SAMPLE_TIMEOUT_MS, createSampleWatchdog, abortable } from './bench-sample-timeout.mjs';

const COMMAND_TIMEOUT_MS = 30000;

function bounded(operation, timeoutMs, label) {
	let timer;
	return Promise.race([
		Promise.resolve().then(operation),
		new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

// The caller starts tracing first and supplies a returnByValue evaluator.
export async function captureBenchmarkSamples(page, evaluate, {processRead = null, processPollIntervalMs = 50, sampleTimeoutMs = SAMPLE_TIMEOUT_MS, onSampleTimeout = () => {}} = {}) {
	if (processRead !== null && typeof processRead !== 'function')
		throw new TypeError('processRead must be a function or null');
	if (!Number.isFinite(processPollIntervalMs) || processPollIntervalMs <= 0)
		throw new TypeError('processPollIntervalMs must be positive and finite');
	const watchdog = createSampleWatchdog(onSampleTimeout, {timeoutMs: sampleTimeoutMs});
	const epoch = performance.now();
	const {config, ...metadata} = await bounded(() => evaluate(page, 'benchmarkLifecycle.begin()'), COMMAND_TIMEOUT_MS, 'benchmarkLifecycle.begin()');
	if (!Array.isArray(config?.variants) || config.variants.length === 0 ||
		config.variants.some(variant => typeof variant !== 'string' || !variant) ||
		new Set(config.variants).size !== config.variants.length ||
		!Number.isFinite(config.dpr) || config.dpr <= 0 ||
		!Number.isSafeInteger(config.warmups) || config.warmups < 0 ||
		!Number.isSafeInteger(config.rounds) || config.rounds < 0)
		throw new TypeError('Invalid benchmarkLifecycle config');

	const samples = [];
	for (let round = 0 - config.warmups; round < config.rounds; round++) {
		const turn = round + config.warmups;
		const offset = turn % config.variants.length;
		const ordered = [...config.variants.slice(offset), ...config.variants.slice(0, offset)];
		if (turn % 2)
			ordered.reverse();
		for (const variant of ordered) {
			const signal = watchdog.start(variant);
			const invoke = expression => abortable(() => evaluate(page, expression), signal);
			const collectGarbage = () => abortable(() => page.send('HeapProfiler.collectGarbage'), signal);
			const id = `sample-${samples.length}`;
			const processObservations = [];
			const readProcess = async (phase, kind) => {
				const processRequestedAtMs = performance.now() - epoch;
				const processMemory = await abortable(processRead, signal);
				signal.throwIfAborted();
				processObservations.push({phase, kind, processMemory, processRequestedAtMs, processTimestampMs: performance.now() - epoch});
			};
			const checkpoint = async phase => {
				if (processRead) {
					await collectGarbage();
					await readProcess(phase, 'gc');
				}
			};
			const pollPhase = async phase => {
				if (!processRead)
					return invoke(`benchmarkLifecycle.${phase}()`);
				await readProcess(phase, 'start');
				let stopped = false;
				let timer;
				let wake;
				let pollError;
				let pollFailed = false;
				// Node-side reads do not wait for the renderer's evaluation response.
				const loop = (async () => {
					while (!stopped && !signal.aborted) {
						await abortable(() => new Promise(resolve => {
							wake = resolve;
							timer = setTimeout(resolve, processPollIntervalMs);
						}), signal);
						if (!stopped && !signal.aborted)
							await readProcess(phase, 'poll');
					}
				})().catch(error => { pollFailed = true; pollError = error; });
				let result;
				try {
					result = await invoke(`benchmarkLifecycle.${phase}()`);
				}
				finally {
					stopped = true;
					clearTimeout(timer);
					wake?.();
					// Drain before endpoints, checkpoint GC, or destruction, even on failure.
					await abortable(() => loop, signal);
				}
				if (pollFailed)
					throw pollError;
				await readProcess(phase, 'end');
				return result;
			};

			try {
				let timing;
				let failed = false;
				try {
					await invoke(`benchmarkLifecycle.setup(${JSON.stringify(variant)}, ${JSON.stringify(id)})`);
					await checkpoint('baseline');
					await pollPhase('prepare');
					if (processRead)
						await readProcess('prepared', 'snapshot');
					timing = await pollPhase('construct');
					await checkpoint('live');
				}
				catch (error) {
					failed = true;
					throw error;
				}
				finally {
					try {
						if (!signal.aborted)
							await invoke('benchmarkLifecycle.destroy()');
					}
					catch (error) {
						if (!failed)
							throw error;
					}
				}
				await checkpoint('cleanup');
				signal.throwIfAborted();
				samples.push({...timing, round, warmup: round < 0, ...(processRead ? {processObservations} : {})});
			}
			catch (error) {
				signal.throwIfAborted();
				throw error;
			}
			finally {
				watchdog.stop();
			}
		}
	}

	return {
		...metadata,
		...config,
		phase: 'initial-chart-creation',
		sampleTimeoutMs,
		samples,
		...(processRead ? {processProtocol: {
			requestedProcessPollIntervalMs: processPollIntervalMs,
			commandTimeoutMs: COMMAND_TIMEOUT_MS, sampleTimeoutMs,
			order: 'Rotate by round + warmups; reverse on odd turns. Warmup rounds are -warmups through -1; measured rounds start at 0.',
			sequence: ['setup', 'GC', 'baseline', 'poll prepare', 'drain', 'prepared', 'poll construct', 'drain', 'GC', 'live', 'destroy', 'GC', 'cleanup'],
			prepared: 'Process snapshot after preparation, without GC. No forced GC occurs between preparation and construction.',
			sampling: 'Serial process reads wait the requested interval after each response, plus phase endpoints. Reads run independently of renderer evaluation.',
			clock: 'Process timestamps use Node performance.now() relative to capture start. processTimestampMs records response receipt, not allocation time.',
			separatePass: false,
		}} : {}),
		limitations: [
			...(metadata.limitations ?? []),
			'Each sample has one deadline from setup through cleanup, including checkpoint GC, process reads, settling, and fences. Warmups use the same per-sample budget.',
			'The sample timeout aborts local waits, not browser execution or external reads. The caller must terminate the browser on timeout and discard the page after capture failure.',
			...(processRead ? [
				'Process polling and checkpoint GC share the timing capture. They can affect timings; this is not an uninstrumented pass.',
				'Process peaks are sampled lower bounds. GC does not force native memory release, and process deltas do not establish ownership.',
			] : ['Trace-only samples use no process polling or forced GC.']),
		],
	};
}
