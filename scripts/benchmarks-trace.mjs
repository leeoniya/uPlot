import { open } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CDP, stopTrace } from './profile-manual.mjs';
import { captureBenchmarkSamples } from './benchmarks-samples.mjs';
import { readProcessMemory } from './bench-process-memory.mjs';
import { summarizeProcessMemory } from './analyze-benchmarks-process-memory.mjs';

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

export async function captureBenchmarkTrace({profile, url, cache, trace = true, raf = false, memory = false, dpr = 1, processPid = null, traceName = 'trace-chrome.json', lightningOptions}) {
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
	try {
		const systemInfo = await browser.send('SystemInfo.getInfo');
		const response = await fetch(endpoint + '/json/list', {signal: AbortSignal.timeout(5000)});
		const target = (await response.json()).find(target => target.type === 'page');
		if (!target)
			throw new Error('No Chrome page target');
		page = await connect(target.webSocketDebuggerUrl);
		await page.send('Page.enable');
		await page.send('Runtime.enable');
		// Supply credentials before tracing, without putting them in files or reports.
		if (lightningOptions)
			await page.send('Page.addScriptToEvaluateOnNewDocument', {source: `globalThis.benchmarkLightningChartOptions = ${JSON.stringify(lightningOptions)};`});
		await page.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: dpr, mobile: false});

		const config = {
			recordMode: 'recordUntilFull', traceBufferSizeInKb: 128 * 1024,
			// RunTask, RasterTask, and GPUTask share the disabled timeline category.
			// Broader categories add detail that the headline work totals do not use.
			includedCategories: [
				'blink.user_timing', 'disabled-by-default-devtools.timeline',
			],
		};
		// Combined runs include the tracer in both cold memory checkpoints.
		// Recording buffers can still grow later; this is an instrumented footprint.
		if (trace) {
			await browser.send('Tracing.start', {transferMode: 'ReturnAsStream', streamFormat: 'json', traceConfig: config});
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
			: await captureBenchmarkSamples(page, evaluate, {processRead});
		if (memory) {
			report.blank = blank;
			report.loaded = loaded;
			Object.assign(report.processProtocol, {
				rootPid: processPid, tracing: trace, heapSampling: false, gpuSpecificMemory: false,
				roles: 'Browser CDP SystemInfo.getProcessInfo; /proc cmdline fallback for unmapped descendants.',
				source: '/proc/<pid>/smaps_rollup for the browser root and discovered descendants.',
				blankAndLoaded: 'Single post-GC checkpoints before warmups, not round aggregates.',
			});
			report.processAnalysis = summarizeProcessMemory({blank, loaded,
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
		const tracePath = join(cache, traceName);
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
		return {...report, trace: {path: tracePath, ...saved, config}, systemInfo};
	}
	finally {
		if (recording)
			await browser.send('Tracing.end').catch(() => {});
		page?.close();
		browser.close();
	}
}
