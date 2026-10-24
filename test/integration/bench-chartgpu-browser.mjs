import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {bundleModuleDependencies} from '../../scripts/bench-module-bundle.mjs';
import {demoDependencies} from '../../bench/demo-dependencies.mjs';

// TEST_CHARTGPU_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/bench-chartgpu-browser.mjs
// Optional TEST_CHARTGPU_VULKAN=1 enables Chromium Vulkan for the Linux headless probe.
// Probe hardware first. Vendor modules must already be in the shared bundle cache.
const root = new URL('../../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const version = '156.0.8078.47';
const sampleMs = 5000;
const enableVulkan = process.env.TEST_CHARTGPU_VULKAN === '1';
const reportName = enableVulkan ? 'chartgpu-browser-vulkan-report.json' : 'chartgpu-browser-report.json';

async function probeHardware() {
	const result = {secureContext: isSecureContext, navigatorGPU: !!navigator.gpu};
	if (!navigator.gpu) return {...result, available: false, reason: 'navigator.gpu is unavailable'};
	try {
		const adapter = await navigator.gpu.requestAdapter();
		result.adapter = !!adapter;
		if (!adapter) return {...result, available: false, reason: 'requestAdapter() returned null'};
		const info = adapter.info;
		result.info = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter']
			.map(key => [key, info?.[key] ?? null]));
		result.features = [...adapter.features];
		const fallback = info?.isFallbackAdapter ?? adapter.isFallbackAdapter;
		const software = /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(Object.values(result.info).join(' '));
		result.available = fallback === false && !software;
		if (!result.available) result.reason = software || fallback === true
			? 'Only a software/fallback adapter is available' : 'Cannot establish non-fallback hardware identity';
	}
	catch (error) { Object.assign(result, {available: false, reason: error.message, error: error.stack}); }
	return result;
}

async function chartSample(rows) {
	const {adapter, packed, devicesSeen, chartsSeen} = globalThis.chartgpuSmoke;
	const report = {rows, draws: [], submissions: [], fences: [], devices: [], gpuErrors: []};
	const start = performance.now();
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const patches = [], devices = [], lost = [];
	const pipelines = new WeakMap(), shaders = new WeakMap(), passes = new WeakMap();
	const encoders = new WeakMap(), commands = new WeakMap();
	const patch = (object, name, wrap) => {
		const descriptor = Object.getOwnPropertyDescriptor(object, name);
		check(typeof descriptor?.value === 'function', `Cannot observe ${name}`);
		Object.defineProperty(object, name, {...descriptor, value: wrap(descriptor.value)});
		patches.push(() => Object.defineProperty(object, name, descriptor));
	};
	const host = document.createElement('div');
	host.style.cssText = 'width:1920px;height:600px';
	document.body.append(host);
	let chart, options, nativeInstance;
	try {
		patch(GPUAdapter.prototype, 'requestDevice', original => async function(...args) {
			const device = await original.apply(this, args);
			check(!devicesSeen.has(device), 'Device reused across samples');
			devicesSeen.add(device);
			devices.push(device);
			const record = {destroyCalls: 0, lost: null};
			report.devices.push(record);
			lost.push(device.lost.then(info => { record.lost = {reason: info.reason, message: info.message}; }));
			device.addEventListener('uncapturederror', event => report.gpuErrors.push(event.error.message));
			return device;
		});
		patch(GPUDevice.prototype, 'destroy', original => function(...args) {
			const index = devices.indexOf(this);
			if (index !== -1) report.devices[index].destroyCalls++;
			return original.apply(this, args);
		});
		patch(GPUDevice.prototype, 'createShaderModule', original => function(descriptor) {
			const module = original.call(this, descriptor);
			shaders.set(module, {label: descriptor.label ?? '', code: descriptor.code});
			return module;
		});
		const pipelineInfo = descriptor => ({
			label: descriptor.label ?? '', topology: descriptor.primitive?.topology ?? 'triangle-list',
			vertexEntry: descriptor.vertex.entryPoint ?? '',
			shaderLabel: shaders.get(descriptor.vertex.module)?.label ?? '',
			// Preserve only identifiers, not large vendor shader sources.
			vertexFunctions: [...(shaders.get(descriptor.vertex.module)?.code ?? '').matchAll(/@vertex\s+fn\s+(\w+)/g)].map(match => match[1]),
		});
		patch(GPUDevice.prototype, 'createRenderPipeline', original => function(descriptor) {
			const pipeline = original.call(this, descriptor);
			pipelines.set(pipeline, pipelineInfo(descriptor));
			return pipeline;
		});
		patch(GPUDevice.prototype, 'createRenderPipelineAsync', original => async function(descriptor) {
			const pipeline = await original.call(this, descriptor);
			pipelines.set(pipeline, pipelineInfo(descriptor));
			return pipeline;
		});
		patch(GPUCommandEncoder.prototype, 'beginRenderPass', original => function(...args) {
			const pass = original.apply(this, args);
			if (!encoders.has(this)) encoders.set(this, []);
			passes.set(pass, {encoder: this, pipeline: null});
			return pass;
		});
		patch(GPURenderPassEncoder.prototype, 'setPipeline', original => function(pipeline) {
			const result = original.call(this, pipeline);
			passes.get(this).pipeline = pipelines.get(pipeline);
			return result;
		});
		for (const method of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
			patch(GPURenderPassEncoder.prototype, method, original => function(...args) {
				const result = original.apply(this, args);
				const pass = passes.get(this);
				const id = report.draws.length;
				report.draws.push({method, args: args.map(value => typeof value === 'number' ? value : '[GPUBuffer]'), pipeline: pass.pipeline});
				encoders.get(pass.encoder).push(id);
				return result;
			});
		}
		patch(GPUCommandEncoder.prototype, 'finish', original => function(...args) {
			const buffer = original.apply(this, args);
			commands.set(buffer, encoders.get(this) ?? []);
			return buffer;
		});
		patch(GPUQueue.prototype, 'submit', original => function(buffers) {
			// ChartGPU supplies arrays. Do not consume or replace an arbitrary iterable.
			check(Array.isArray(buffers), 'Cannot observe non-array command buffer submission');
			const result = original.call(this, buffers);
			report.submissions.push({atMs: performance.now() - start, buffers: buffers.length,
				draws: buffers.flatMap(buffer => commands.get(buffer) ?? [])});
			return result;
		});
		patch(GPUQueue.prototype, 'onSubmittedWorkDone', original => function(...args) {
			const record = {startMs: performance.now() - start, submissions: report.submissions.length};
			report.fences.push(record);
			return original.apply(this, args).then(value => {
				record.doneMs = performance.now() - start;
				return value;
			});
		});
		// Observe the public creation options without substituting data or rendering behavior.
		patch(benchmarkChartGPU.ChartGPU, 'create', original => async function(...args) {
			options = args[1];
			const instance = await original.apply(this, args);
			check(!chartsSeen.has(instance), 'Chart reused across samples');
			chartsSeen.add(instance);
			nativeInstance = instance;
			return instance;
		});

		const input = rows === 55550 ? packed : packed.slice(0, packed[0] + 1 + rows * packed[0]);
		const data = adapter.prepData(input);
		report.prepMs = performance.now() - start;
		check(Object.values(data).every(column => column.length === rows), 'Prepared data count mismatch');
		const wait = {textContent: 'Rendering...'};
		chart = await adapter.makeChart(data, host, wait);
		report.readyMs = performance.now() - start;
		check(chart.instance === nativeInstance && wait.textContent === 'Done!', 'Adapter did not return a ready native chart');
		check(devices.length === 1 && chart.getWebGPUDevices()[0] === devices[0], 'Expected one fresh registered device');
		check(report.fences.some(fence => fence.submissions > 0 && fence.doneMs <= report.readyMs), 'Adapter returned before submitted GPU work completed');
		check(options.series.length === 3, 'Expected three native series');
		report.options = {
			animation: options.animation, renderMode: options.renderMode, lod: options.performance?.lod,
			xAxis: options.xAxis, yAxes: options.axes?.y.map(({tickFormatter, ...axis}) => axis),
			series: options.series.map(series => ({type: series.type, name: series.name, yAxis: series.yAxis,
				xCount: series.data.x.length, yCount: series.data.y.length, sampling: series.sampling,
				physicalWidth: series.lineStyle.width * devicePixelRatio})),
		};
		check(options.animation === false && options.renderMode === 'external', 'Initial frame must be explicit and unanimated');
		check(options.performance?.lod === 'strict', 'LOD must be strict');
		check(options.xAxis.type === 'time' && options.axes.y.length === 2, 'Expected native time and dual y axes');
		check(options.axes.y[0].position === 'left' && options.axes.y[1].position === 'right', 'Native y axis positions changed');
		for (const axis of [options.xAxis, ...options.axes.y])
			check(['min', 'max', 'domain', 'tickCount', 'tickValues'].every(key => axis[key] === undefined), 'Axes must use native automatic domains/ticks');
		for (const [i, key] of ['cpu', 'ram', 'tcp'].entries()) {
			const series = options.series[i];
			check(series.type === 'line' && series.data.x === data.x && series.data.y === data[key], 'Native line must receive full prepared columns');
			check(series.sampling === 'none' && series.lineStyle.width * devicePixelRatio === 1, 'Expected unsampled one-physical-pixel lines');
			check(series.yAxis === (i === 2 ? 'tcp' : 'percent') && !series.areaStyle, 'Unexpected axis mapping or area fill');
		}
		// Only count line commands covered by a fence that completed before readiness.
		const completedSubmissions = Math.max(0, ...report.fences
			.filter(fence => fence.doneMs <= report.readyMs).map(fence => fence.submissions));
		const submitted = new Set(report.submissions.slice(0, completedSubmissions).flatMap(submission => submission.draws));
		// Pinned 0.4.0 strict-LOD line geometry: six vertices per segment, stride one.
		report.nativeLines = report.draws.filter((draw, id) => submitted.has(id) &&
			draw.pipeline?.label === 'lineRenderer/pipeline' && draw.pipeline.shaderLabel === 'line.wgsl' &&
			draw.pipeline.vertexEntry === 'vsMain' && draw.pipeline.topology === 'triangle-list' &&
			draw.method === 'draw' && draw.args[0] === 6 && draw.args[1] === rows - 1);
		check(report.nativeLines.length === 3, `Expected three submitted native line draws with ${rows - 1} segment instances; inspect draws/pipeline identifiers`);
		check(report.gpuErrors.length === 0 && !chart.error, 'WebGPU reported a rendering error');
		check(host.querySelectorAll('canvas').length > 0, 'Native chart has no canvas');
	}
	catch (error) { report.error = error.stack; }
	finally {
		try {
			if (chart) adapter.destroyChart(chart);
			// A rejected makeChart owns its cleanup; observe rather than hide leaks with a second destroy.
			await Promise.all(lost);
			report.cleanup = {canvases: document.querySelectorAll('canvas').length,
				returnedDevices: chart?.getWebGPUDevices().length ?? null,
				cleared: chart ? chart.instance === null && chart.device === null && chart.element === null : null};
			check(report.cleanup.canvases === 0, 'Cleanup left canvases');
			if (chart) check(report.cleanup.returnedDevices === 0 && report.cleanup.cleared, 'Cleanup retained chart/device references');
			check(report.devices.every(device => device.destroyCalls === 1 && device.lost?.reason === 'destroyed'), 'Expected device.lost reason destroyed after explicit cleanup');
			check(report.gpuErrors.length === 0, 'Uncaptured WebGPU errors');
		}
		catch (error) { report.cleanupError = error.stack; }
		for (const restore of patches.reverse()) restore();
		host.remove();
		report.totalMs = performance.now() - start;
	}
	return report;
}

(process.env.TEST_CHARTGPU_BROWSER === '1' ? describe : describe.skip)('ChartGPU cached hardware-browser smoke', function() {
	this.timeout(55000);
	it('probes hardware, then renders fresh 200-row and 55,550-row charts within 5s each', async function() {
		let browser, client, server, profile, totalTimer, sampleTimer;
		let log = '', phase = 'checking cached Chrome';
		const report = {package: 'chartgpu', version: '0.4.0', started: new Date().toISOString(),
			status: 'running', samples: [], exceptions: [], limits: {browserMs: 45000, sampleMs},
			screenshot: 'Not captured: prioritize native draw proof and immediate teardown within 5s.'};
		const start = performance.now();
		let rejectFailure;
		const failure = new Promise((_, reject) => { rejectFailure = reject; });
		failure.catch(() => {});
		const stop = error => {
			rejectFailure(error);
			try { killBenchmarkBrowser(browser); }
			catch (cleanupError) { report.killError = cleanupError.stack; }
		};
		const interrupted = () => stop(new Error('ChartGPU smoke interrupted'));
		process.once('SIGINT', interrupted);
		process.once('SIGTERM', interrupted);
		const run = async () => {
			const binary = fileURLToPath(new URL(`node_modules/.cache/uplot-bench/chrome-headless-shell-${version}-linux64/chrome-headless-shell`, root));
			await access(binary, constants.X_OK);
			await access(cache, constants.W_OK);
			const assets = new Map([['/', '<!doctype html><meta charset="utf-8"><title>ChartGPU hardware smoke</title>']]);
			server = createServer((request, response) => {
				if (!assets.has(request.url)) { response.writeHead(404).end(); return; }
				response.setHeader('Content-Type', request.url === '/' ? 'text/html' : request.url.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.end(assets.get(request.url));
			});
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			profile = await mkdtemp(join(cache, 'chartgpu-smoke-'));
			phase = 'launching cached Chrome';
			const flags = ['--enable-gpu', ...(enableVulkan ? ['--enable-features=Vulkan'] : []), '--no-first-run', '--no-default-browser-check',
				'--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
				'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
				'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
				'--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'];
			report.flags = flags.filter(flag => !flag.startsWith('--user-data-dir='));
			totalTimer = setTimeout(() => stop(new Error(`ChartGPU browser exceeded 45000ms during ${phase}`)), 45000);
			browser = spawn(binary, flags, {stdio: ['ignore', 'ignore', 'pipe']});
			browser.once('error', rejectFailure);
			browser.once('exit', (code, signal) => rejectFailure(new Error(`Chrome exited (${code ?? signal})`)));
			browser.stderr.on('data', chunk => { log = (log + chunk).slice(-6000); });
			let port;
			for (let i = 0; i < 100; i++) {
				try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
				catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
			}
			assert.ok(port, `Chrome did not start: ${log}`);
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(5000)})).json();
			const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
			client = new CDP(socket, 5000);
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 5000);
				socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
				socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, {once: true});
			});
			socket.addEventListener('message', event => {
				const {method, params} = JSON.parse(event.data);
				if (method === 'Runtime.exceptionThrown') report.exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
			});
			await client.send('Page.enable');
			await client.send('Runtime.enable');
			report.browser = await client.send('Browser.getVersion');
			assert.match(report.browser.product, /\/156\.0\.8078\.47$/);
			const loaded = client.wait('Page.loadEventFired');
			loaded.catch(() => {});
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
			await loaded;
			const evaluate = async expression => {
				const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
				assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
				return result.result.value;
			};
			phase = 'hardware capability probe';
			const probeStart = performance.now();
			report.hardware = await evaluate(`(${probeHardware.toString()})()`);
			report.probeMs = performance.now() - probeStart;
			console.log('ChartGPU hardware:', JSON.stringify(report.hardware));
			if (!report.hardware.available) { report.status = 'hardware-unavailable'; return; }

			phase = 'loading cache-only modules';
			assert.equal(demoDependencies.chartgpu.length, 1);
			assert.equal(demoDependencies.chartgpu[0].version, '0.4.0');
			assert.equal(demoDependencies.chartgpu[0].global, 'benchmarkChartGPU');
			const bundle = await bundleModuleDependencies(demoDependencies.chartgpu, {
				cacheDir: join(cache, 'framework-modules'),
				fetchImpl: async url => { throw new Error(`Cache-only test: pre-download module before opt-in run: ${url}`); },
			});
			report.bundle = {sha256: bundle.sha256, bytes: bundle.bytes, sources: bundle.sources};
			assets.set('/vendor.mjs', bundle.code);
			assets.set('/bench/chartgpu.mjs', await readFile(new URL('bench/chartgpu.mjs', root)));
			const packed = JSON.parse(await readFile(new URL('bench/data.json', root), 'utf8'));
			assert.equal((packed.length - packed[0] - 1) / packed[0], 55550);
			assets.set('/packed.json', JSON.stringify(packed));
			await evaluate(`(async () => {
				Object.assign(globalThis, await import('/vendor.mjs'));
				const adapter = await import('/bench/chartgpu.mjs');
				const packed = await (await fetch('/packed.json')).json();
				globalThis.chartgpuSmoke = {adapter, packed, devicesSeen: new WeakSet(), chartsSeen: new WeakSet()};
			})()`);
			for (const [index, rows] of [200, 55550].entries()) {
				phase = `sample ${index + 1}: ${rows} rows`;
				const sample = {index: index + 1, rows, status: 'running'};
				report.samples.push(sample);
				const sampleStart = performance.now();
				sampleTimer = setTimeout(() => {
					sample.status = 'timeout';
					sample.externalMs = performance.now() - sampleStart;
					stop(new Error(`${phase} exceeded 5000ms including preparation and cleanup`));
				}, sampleMs);
				Object.assign(sample, await evaluate(`(${chartSample.toString()})(${rows})`));
				sample.externalMs = performance.now() - sampleStart;
				clearTimeout(sampleTimer);
				sample.status = sample.error || sample.cleanupError ? 'failed' : 'complete';
				console.log('ChartGPU sample:', JSON.stringify(sample));
				assert.equal(sample.error, undefined);
				assert.equal(sample.cleanupError, undefined);
				assert.ok(sample.externalMs < sampleMs && sample.totalMs < sampleMs, 'Sample exceeded hard time limit');
				assert.deepEqual(report.exceptions, [], 'Uncaught browser exceptions');
			}
			report.status = 'complete';
		};
		try { await Promise.race([run(), failure]); }
		catch (error) {
			report.status = 'failed';
			report.error = `${phase}: ${error.stack}`;
			throw error;
		}
		finally {
			clearTimeout(totalTimer);
			clearTimeout(sampleTimer);
			process.removeListener('SIGINT', interrupted);
			process.removeListener('SIGTERM', interrupted);
			client?.close();
			try { killBenchmarkBrowser(browser); }
			catch (error) { report.killError = error.stack; }
			if (browser && browser.exitCode === null && browser.signalCode === null)
				await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1000)]);
			server?.closeAllConnections();
			if (server?.listening) await new Promise(resolve => server.close(resolve));
			if (profile) await rm(profile, {recursive: true, force: true});
			report.totalMs = performance.now() - start;
			report.browserLog = log;
			await writeFile(join(cache, reportName), JSON.stringify(report, null, 2) + '\n');
			console.log(`ChartGPU result: ${report.status}; report: .cache/benchmarks/${reportName}`);
		}
		if (report.status === 'hardware-unavailable') this.skip();
	});
});
