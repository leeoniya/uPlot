import { open } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP, stopTrace } from './profile-manual.mjs';
import { captureBenchmarkSamples } from './benchmarks-samples.mjs';
import { installBenchmarkMouseInput } from './benchmarks-mouse.mjs';
import { readProcessMemory } from './bench-process-memory.mjs';
import { summarizeProcessMemory } from './analyze-benchmarks-process-memory.mjs';
import { createWebGLCapture } from './bench-webgl.mjs';
import { createWebGPUCapture } from './bench-webgpu.mjs';
import { SAMPLE_TIMEOUT_MS, createSampleWatchdog } from './bench-sample-timeout.mjs';
import { GC_CATEGORIES, TRACE_ACCOUNTING } from './bench-trace-policy.mjs';

export function benchmarkTraceConfig() {
	return {
		recordMode: 'recordUntilFull', traceBufferSizeInKb: 128 * 1024,
		// Chrome emits RunTask and GPUTask here; RasterTask also lists cc.
		// These are host-thread wall intervals, not device execution or completion.
		// More GPU categories do not establish that an async chart finished rendering.
		includedCategories: ['blink.user_timing', 'disabled-by-default-devtools.timeline', ...GC_CATEGORIES],
	};
}

async function connect(url) {
	const socket = new WebSocket(url);
	const client = new CDP(socket, 120000);
	try {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => finish(new Error('Chrome connection timed out')), 10000);
			const opened = () => finish();
			const failed = () => finish(new Error('Chrome connection failed'));
			function finish(error) {
				clearTimeout(timer);
				socket.removeEventListener('open', opened);
				socket.removeEventListener('error', failed);
				socket.removeEventListener('close', failed);
				error ? reject(error) : resolve();
			}
			socket.addEventListener('open', opened);
			socket.addEventListener('error', failed);
			socket.addEventListener('close', failed);
		});
		return client;
	}
	catch (error) {
		client.close();
		throw error;
	}
}

async function evaluate(client, expression) {
	const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
	if (result.exceptionDetails)
		throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
	return result.result.value;
}

export async function captureBenchmarkTrace({profile, url, cache, trace = true, raf = false, memory = false, dashboard = false, dpr = 1, processPid = null, traceName = 'trace-chrome.json', lightningOptions, sciChartOptions, sampleTimeoutMs = SAMPLE_TIMEOUT_MS, onSampleTimeout = () => {}}) {
	if (raf && (trace || memory))
		throw new Error('rAF measurement requires a separate pass without tracing or memory polling.');
	if (memory && (!Number.isSafeInteger(processPid) || processPid <= 0))
		throw new Error('Process memory requires the browser PID.');
	const portFile = join(profile, 'DevToolsActivePort');
	const deadline = Date.now() + 10000;
	while (!existsSync(portFile)) {
		if (Date.now() > deadline)
			throw new Error('Chrome did not create DevToolsActivePort');
		await delay(50);
	}
	const [port, browserPath] = readFileSync(portFile, 'utf8').trim().split('\n');
	const endpoint = `http://127.0.0.1:${port}`;
	const browser = await connect(`ws://127.0.0.1:${port}${browserPath}`);
	let page;
	let recording = false;
	let timeoutError;
	let watchdog;
	let sampleBoundary;
	let removeMouseInput;
	const timedOut = error => {
		timeoutError = error;
		try {
			Promise.resolve(onSampleTimeout(error)).catch(() => {});
		}
		finally {
			try { page?.close(); }
			finally { browser.close(); }
		}
	};
	try {
		const systemInfo = await browser.send('SystemInfo.getInfo');
		const response = await fetch(endpoint + '/json/list', {signal: AbortSignal.timeout(5000)});
		const target = (await response.json()).find(target => target.type === 'page');
		if (!target)
			throw new Error('No Chrome page target');
		page = await connect(target.webSocketDebuggerUrl);
		await page.send('Page.enable');
		await page.send('Runtime.enable');
		removeMouseInput = await installBenchmarkMouseInput(page);
		if (raf) {
			watchdog = createSampleWatchdog(timedOut, {timeoutMs: sampleTimeoutMs});
			let activeVariant = null;
			sampleBoundary = event => {
				if (timeoutError)
					return;
				try {
					const message = JSON.parse(event.data);
					if (message?.method !== 'Runtime.bindingCalled' || message.params?.name !== 'benchmarkSampleBoundary')
						return;
					const boundary = JSON.parse(message.params.payload);
					if (typeof boundary?.variant !== 'string' || !boundary.variant)
						return;
					if (boundary.phase === 'start' && activeVariant === null) {
						watchdog.start(boundary.variant);
						activeVariant = boundary.variant;
					}
					else if (boundary.phase === 'end' && activeVariant === boundary.variant) {
						watchdog.stop();
						activeVariant = null;
					}
				}
				catch {}
			};
			page.socket.addEventListener('message', sampleBoundary);
			await page.send('Runtime.addBinding', {name: 'benchmarkSampleBoundary'});
		}
				if (!raf)
					await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `globalThis.benchmarkWebGL = (${createWebGLCapture.toString()})(); globalThis.benchmarkWebGPU = (${createWebGPUCapture.toString()})();`});
				if (sciChartOptions)
					await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `globalThis.benchmarkSciChartOptions = ${JSON.stringify(sciChartOptions)};`});
		// Supply credentials before tracing, without putting them in files or reports.
		if (lightningOptions)
			await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `globalThis.benchmarkLightningChartOptions = ${JSON.stringify(lightningOptions)};`});
		await page.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: dashboard ? 1080 : 900, deviceScaleFactor: dpr, mobile: false});

		const config = benchmarkTraceConfig();
		// Combined runs include the tracer in both cold memory checkpoints.
		// Recording buffers can still grow later; this is an instrumented footprint.
		if (trace) {
			await browser.send('Tracing.start', {transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'gzip', traceConfig: config});
			recording = true;
		}
		const processRead = memory ? async () => {
			const {processInfo} = await browser.send('SystemInfo.getProcessInfo');
			return readProcessMemory(processPid, {
				processTypes: new Map(processInfo.map(process => [process.id, process.type])),
				requireRenderer: true,
			});
		} : null;
		const checkpoint = async () => {
			await evaluate(page, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200))))');
			await page.send('HeapProfiler.collectGarbage');
			const processRequestedAtMs = performance.now();
			const processMemory = await processRead();
			return {processMemory, processRequestedAtMs, processTimestampMs: performance.now()};
		};
		let blank;
		if (memory) {
			const blankUrl = new URL('/blank', url).href;
			await page.send('Page.navigate', {url: blankUrl});
			const deadline = Date.now() + 15000;
			while (!await evaluate(page, `location.href === ${JSON.stringify(blankUrl)} && document.readyState === 'complete'`)) {
				if (Date.now() > deadline)
					throw new Error('Blank fixture failed to initialize');
				await delay(50);
			}
			blank = await checkpoint();
		}
		await page.send('Page.navigate', {url});
		const readyDeadline = Date.now() + 15000;
		while (!await evaluate(page, 'globalThis.benchmarkTraceReady === true')) {
			if (Date.now() > readyDeadline)
				throw new Error('Benchmark fixture failed to initialize');
			await delay(100);
		}
		const loaded = memory ? await checkpoint() : null;
		const report = raf
			? await evaluate(page, 'globalThis.runBenchmarkTrace({raf: true})')
			: await captureBenchmarkSamples(page, evaluate, {processRead, sampleTimeoutMs, onSampleTimeout: timedOut});
		report.sampleTimeoutMs = sampleTimeoutMs;
		if (memory) {
			report.blank = blank;
			report.loaded = loaded;
			Object.assign(report.processProtocol, {
				rootPid: processPid, tracing: trace, heapSampling: false, gpuSpecificMemory: false,
				roles: 'Browser CDP SystemInfo.getProcessInfo; /proc cmdline fallback for unmapped descendants.',
				source: '/proc/<pid>/smaps_rollup for the browser root and discovered descendants.',
				blankAndLoaded: 'Single post-GC checkpoints before warmups, not round aggregates.',
			});
			report.processAnalysis = summarizeProcessMemory({blank, loaded, memoryProtocol: report.memoryProtocol,
				workload: report.workload, phase: report.phase, initProtocol: report.initProtocol, lifecycle: report.lifecycle,
				samples: report.samples.map(sample => ({...sample, observations: sample.processObservations})),
			});
			for (const key of ['pssMB', 'peak', 'gc', 'exclusions'])
				report.limitations.push(report.processAnalysis.definitions[key]);
			if (trace)
				report.limitations.push('Trace recording is active during blank, loaded, and sample memory reads. Trace buffers and polling overhead affect the footprint and timings. Use the memory-only command for an untraced footprint.');
		}
		if (!trace)
			return {...report, trace: null, systemInfo};
		await delay(300);
		const tracePath = join(cache, traceName.endsWith('.gz') ? traceName : traceName + '.gz');
		const file = await open(tracePath, 'w');
		let saved;
		try {
			saved = await stopTrace(browser, file);
			recording = false;
		}
		finally {
			await file.close();
		}
		if (saved.dataLoss)
			throw new Error('Chrome lost trace data; shorten the recording before interpreting results.');
		// bytes counts the saved gzip bytes, not the decompressed JSON document.
		return {...report, trace: {path: tracePath, ...saved, compression: 'gzip', compressedBytes: saved.bytes, config, accountingProtocol: TRACE_ACCOUNTING}, systemInfo};
	}
	catch (error) {
		throw timeoutError ?? error;
	}
	finally {
		watchdog?.stop();
		removeMouseInput?.();
		if (sampleBoundary)
			page.socket.removeEventListener('message', sampleBoundary);
		if (recording && !timeoutError)
			await browser.send('Tracing.end').catch(() => {});
		if (!timeoutError) {
			page?.close();
			browser.close();
		}
	}
}
