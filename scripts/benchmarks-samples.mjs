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
	let sampleIndex = 0;
	const operations = config.lifecycle ? config.operations : null;
	if (config.lifecycle && ![
		['small-init', 'data-update'],
		['small-init', 'data-update', 'resize'],
		['small-init', 'data-update', 'resize', 'hover-10'],
	].some(expected => JSON.stringify(operations) === JSON.stringify(expected)))
		throw new Error('Unexpected benchmark lifecycle operations.');
	if (operations?.includes('hover-10') && (!Array.isArray(config.hoverVariants) ||
		config.hoverVariants.some(variant => typeof variant !== 'string' || !variant) ||
		new Set(config.hoverVariants).size !== config.hoverVariants.length))
		throw new Error('Invalid benchmark hover capabilities.');
	for (let round = 0 - config.warmups; round < config.rounds; round++) {
		const turn = round + config.warmups;
		const offset = turn % config.variants.length;
		const ordered = [...config.variants.slice(offset), ...config.variants.slice(0, offset)];
		if (turn % 2)
			ordered.reverse();
		for (const variant of ordered) {
			let signal = watchdog.start(variant);
			const nextBudget = () => {
				signal.throwIfAborted();
				watchdog.stop();
				signal = watchdog.start(variant);
			};
			const invoke = expression => abortable(() => evaluate(page, expression), signal);
			const collectGarbage = () => abortable(() => page.send('HeapProfiler.collectGarbage'), signal);
			const id = `sample-${sampleIndex++}`;
			const processObservations = [];
			let memoryComplete = false;
			let memoryOperation;
			const readProcess = async (phase, kind) => {
				const processRequestedAtMs = performance.now() - epoch;
				const processMemory = await abortable(processRead, signal);
				signal.throwIfAborted();
				processObservations.push({phase, kind, ...(memoryOperation ? {operation: memoryOperation} : {}), processMemory, processRequestedAtMs, processTimestampMs: performance.now() - epoch});
			};
			const checkpoint = async phase => {
				if (processRead) {
					await collectGarbage();
					await readProcess(phase, 'gc');
				}
			};
			const pollPhase = async (phase, expression = `benchmarkLifecycle.${phase}()`) => {
				if (!processRead || memoryComplete)
					return invoke(expression);
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
					result = await invoke(expression);
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
					if (operations) {
						const phases = [];
						for (const operation of operations) {
							if (operation === 'hover-10' && !config.hoverVariants.includes(variant)) continue;
							if (phases.length) nextBudget();
							const phaseId = phases.length ? `sample-${sampleIndex++}` : id;
							memoryOperation = operation;
							await pollPhase('prepare', `benchmarkLifecycle.prepare(${JSON.stringify(operation)}, ${JSON.stringify(phaseId)})`);
							if (processRead && operation === 'data-update')
								await readProcess('prepared', 'snapshot');
							const phase = await pollPhase('construct');
							phases.push({...phase, round, warmup: round < 0});
							if (operation === 'data-update') {
								nextBudget();
								await checkpoint('live');
								memoryComplete = true;
							}
						}
						timing = {...phases.find(phase => phase.operation === 'data-update'), phases};
						nextBudget();
					}
					else {
						await pollPhase('prepare');
						if (processRead)
							await readProcess('prepared', 'snapshot');
						timing = await pollPhase('construct');
						await checkpoint('live');
					}
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
				if (!operations)
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
		...(metadata.lifecycle ? {lifecycle: metadata.lifecycle} : {}),
		phase: operations ? 'chart-population' : 'initial-chart-creation',
		...(operations && processRead ? {memoryProtocol: 'through-update-v1'} : {}),
		sampleTimeoutMs,
		samples,
		...(processRead ? {processProtocol: {
			requestedProcessPollIntervalMs: processPollIntervalMs,
			commandTimeoutMs: COMMAND_TIMEOUT_MS, sampleTimeoutMs,
			order: 'Rotate by round + warmups; reverse on odd turns. Warmup rounds are -warmups through -1; measured rounds start at 0.',
			sequence: operations
				? ['setup', 'GC', 'baseline', 'prepare small data', 'small init', 'prepare full data', 'prepared', 'data update', 'GC', 'live', ...(operations.includes('resize') ? ['resize'] : []), ...(operations.includes('hover-10') ? ['hover 10 when supported'] : []), 'destroy']
				: ['setup', 'GC', 'baseline', 'poll prepare', 'drain', 'prepared', 'poll construct', 'drain', 'GC', 'live', 'destroy', 'GC', 'cleanup'],
			lifecycle: operations ? 'Memory polling ends after data-update. Live follows the settled full-data update and forced GC, before resize or hover preparation. Peak covers baseline, initialization, preparation, update and live. Prepared includes the small chart, so dataDelta also includes initialization. No forced GC occurs between initialization and update. Resize and hover are timing-only. No cleanup memory snapshot or GC follows destruction.' : null,
			prepared: 'Process snapshot after preparation, without GC. No forced GC occurs between preparation and construction.',
			sampling: 'Serial process reads wait the requested interval after each response, plus phase endpoints. Reads run independently of renderer evaluation.',
			clock: 'Process timestamps use Node performance.now() relative to capture start. processTimestampMs records response receipt, not allocation time.',
			separatePass: false,
		}} : {}),
		limitations: [
			...(metadata.limitations ?? []),
			operations
				? 'Each operation has its own deadline including preparation, settling and fences. Memory reads occur only through data-update. The first budget includes setup/baseline. Post-update GC/live and final destruction each have a separate deadline. Warmups use the same budgets.'
				: 'Each sample has one deadline from setup through cleanup, including checkpoint GC, process reads, settling, and fences. Warmups use the same per-sample budget.',
			'The sample timeout aborts local waits, not browser execution or external reads. The caller must terminate the browser on timeout and discard the page after capture failure.',
			...(processRead ? [
				'Process polling and checkpoint GC share the timing capture. They can affect timings; this is not an uninstrumented pass.',
				'Process peaks are sampled lower bounds. GC does not force native memory release, and process deltas do not establish ownership.',
			] : ['Trace-only samples use no process polling or forced GC.']),
		],
	};
}
