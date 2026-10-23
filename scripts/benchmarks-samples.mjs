import { performance } from 'node:perf_hooks';

const COMMAND_TIMEOUT_MS = 30000;
const PHASE_TIMEOUT_MS = 120000;

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
export async function captureBenchmarkSamples(page, evaluate, {processRead = null, processPollIntervalMs = 50} = {}) {
	if (processRead !== null && typeof processRead !== 'function')
		throw new TypeError('processRead must be a function or null');
	if (!Number.isFinite(processPollIntervalMs) || processPollIntervalMs <= 0)
		throw new TypeError('processPollIntervalMs must be positive and finite');
	const epoch = performance.now();
	const invoke = expression => bounded(() => evaluate(page, expression), PHASE_TIMEOUT_MS, expression);
	const collectGarbage = () => bounded(() => page.send('HeapProfiler.collectGarbage'), COMMAND_TIMEOUT_MS, 'Checkpoint GC');
	const {config, ...metadata} = await invoke('benchmarkLifecycle.begin()');
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
			const id = `sample-${samples.length}`;
			const processObservations = [];
			const readProcess = async (phase, kind) => {
				const processRequestedAtMs = performance.now() - epoch;
				const processMemory = await bounded(processRead, COMMAND_TIMEOUT_MS, 'Process memory read');
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
					while (!stopped) {
						await new Promise(resolve => {
							wake = resolve;
							timer = setTimeout(resolve, processPollIntervalMs);
						});
						if (!stopped)
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
					await loop;
				}
				if (pollFailed)
					throw pollError;
				await readProcess(phase, 'end');
				return result;
			};

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
					await invoke('benchmarkLifecycle.destroy()');
				}
				catch (error) {
					if (!failed)
						throw error;
				}
			}
			await checkpoint('cleanup');
			samples.push({...timing, round, warmup: round < 0, ...(processRead ? {processObservations} : {})});
		}
	}

	return {
		...metadata,
		...config,
		phase: 'initial-chart-creation',
		samples,
		...(processRead ? {processProtocol: {
			requestedProcessPollIntervalMs: processPollIntervalMs,
			commandTimeoutMs: COMMAND_TIMEOUT_MS, phaseTimeoutMs: PHASE_TIMEOUT_MS,
			order: 'Rotate by round + warmups; reverse on odd turns. Warmup rounds are -warmups through -1; measured rounds start at 0.',
			sequence: ['setup', 'GC', 'baseline', 'poll prepare', 'drain', 'prepared', 'poll construct', 'drain', 'GC', 'live', 'destroy', 'GC', 'cleanup'],
			prepared: 'Process snapshot after preparation, without GC. No forced GC occurs between preparation and construction.',
			sampling: 'Serial process reads wait the requested interval after each response, plus phase endpoints. Reads run independently of renderer evaluation.',
			clock: 'Process timestamps use Node performance.now() relative to capture start. processTimestampMs records response receipt, not allocation time.',
			separatePass: false,
		}} : {}),
		limitations: [
			...(metadata.limitations ?? []),
			'Timeouts bound local waits, not browser execution or external reads. Pending operations cannot be cancelled here; discard the page after capture failure.',
			...(processRead ? [
				'Process polling and checkpoint GC share the timing capture. They can affect timings; this is not an uninstrumented pass.',
				'Process peaks are sampled lower bounds. GC does not force native memory release, and process deltas do not establish ownership.',
			] : ['Trace-only samples use no process polling or forced GC.']),
		],
	};
}
