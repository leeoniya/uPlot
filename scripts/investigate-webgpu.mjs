// Cache-only hardware probe. Does not change benchmark flags or run chart workloads.
// node scripts/investigate-webgpu.mjs [baseline|vulkan|vulkan-no-surface]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from './profile-manual.mjs';
import {killBenchmarkBrowser} from './bench-browser-process.mjs';

const root = new URL('../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const binary = fileURLToPath(new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root));
const configurations = {
	baseline: [],
	vulkan: ['--enable-features=Vulkan'],
	'vulkan-no-surface': ['--enable-features=Vulkan', '--disable-vulkan-surface'],
};
const mode = process.argv[2] ?? 'baseline';
assert.ok(Object.hasOwn(configurations, mode), 'Unknown probe configuration');

async function probe() {
	const report = {secureContext: isSecureContext, navigatorGPU: !!navigator.gpu};
	const canvas = document.createElement('canvas');
	const gl = canvas.getContext('webgl2');
	if (gl) {
		const extension = gl.getExtension('WEBGL_debug_renderer_info');
		report.webgl = {renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
	if (!navigator.gpu) return report;
	const adapter = await navigator.gpu.requestAdapter();
	report.adapter = !!adapter;
	if (!adapter) return report;
	const info = adapter.info;
	report.info = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(key => [key, info?.[key] ?? null]));
	report.features = [...adapter.features];
	const fallback = info?.isFallbackAdapter ?? adapter.isFallbackAdapter;
	if (fallback !== false || /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(Object.values(report.info).join(' '))) {
		report.rejected = 'Hardware identity is not established';
		return report;
	}
	let device;
	const buffers = [];
	try {
		device = await adapter.requestDevice();
		report.errors = [];
		device.addEventListener('uncapturederror', event => report.errors.push(event.error.message));
		device.pushErrorScope('validation');
		const storage = device.createBuffer({size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
		const output = device.createBuffer({size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
		buffers.push(storage, output);
		const module = device.createShaderModule({code: '@group(0) @binding(0) var<storage, read_write> out: array<u32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id: vec3u) { out[id.x] = id.x * 3u + 7u; }'});
		const pipeline = device.createComputePipeline({layout: 'auto', compute: {module, entryPoint: 'main'}});
		const bindGroup = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: storage}}]});
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginComputePass();
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(1);
		pass.end();
		encoder.copyBufferToBuffer(storage, 0, output, 0, 16);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		await output.mapAsync(GPUMapMode.READ);
		report.output = [...new Uint32Array(output.getMappedRange())];
		output.unmap();
		report.validationError = (await device.popErrorScope())?.message ?? null;
		report.complete = JSON.stringify(report.output) === '[7,10,13,16]' && !report.validationError && !report.errors.length;
	}
	finally {
		for (const buffer of buffers) buffer.destroy();
		if (device) {
			device.destroy();
			const info = await device.lost;
						report.deviceLost = {reason: info.reason, message: info.message};
		}
	}
	return report;
}

let browser, server, profile, timer, sampleTimer;
const clients = [];
const report = {mode, flags: configurations[mode], note: 'Hardware capability diagnostic, not a chart benchmark.'};
let log = '';
let rejectFailure;
const failure = new Promise((_, reject) => { rejectFailure = reject; });
failure.catch(() => {});
const stop = error => { rejectFailure(error); killBenchmarkBrowser(browser); };
const interrupted = () => stop(new Error('WebGPU probe interrupted'));
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
async function connect(url) {
	const socket = new WebSocket(url);
	const client = new CDP(socket, 5000);
	clients.push(client);
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('CDP connection timeout')), 5000);
		socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, {once: true});
		socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, {once: true});
	});
	return client;
}
async function run() {
	await access(binary, constants.X_OK);
	server = createServer((request, response) => response.end('<!doctype html><title>WebGPU hardware probe</title>'));
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	profile = await mkdtemp(join(cache, 'webgpu-probe-'));
	browser = spawn(binary, ['--enable-gpu', ...configurations[mode], '--no-first-run', '--no-default-browser-check',
		'--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
		'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
		'--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
	browser.once('error', rejectFailure);
	browser.once('exit', (code, signal) => rejectFailure(new Error(`Chrome exited (${code ?? signal})`)));
	browser.stderr.on('data', chunk => { log = (log + chunk).slice(-16000); });
	let port;
	for (let i = 0; i < 100; i++) {
		try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
		catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
	}
	assert.ok(port, `Chrome did not start: ${log}`);
	const json = async path => (await fetch(`http://127.0.0.1:${port}${path}`, {signal: AbortSignal.timeout(5000)})).json();
	const version = await json('/json/version');
	const browserClient = await connect(version.webSocketDebuggerUrl);
	report.version = await browserClient.send('Browser.getVersion');
	const targets = await json('/json/list');
	const page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
	await page.send('Page.enable');
	const loaded = page.wait('Page.loadEventFired');
	loaded.catch(() => {});
	await page.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
	await loaded;
	const start = performance.now();
	sampleTimer = setTimeout(() => stop(new Error('Hardware probe exceeded 5000ms')), 5000);
	const result = await page.send('Runtime.evaluate', {expression: `(${probe.toString()})()`, awaitPromise: true, returnByValue: true});
	clearTimeout(sampleTimer);
	report.probeMs = performance.now() - start;
	assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
	report.probe = result.result.value;
	report.systemInfo = await browserClient.send('SystemInfo.getInfo');
	console.log(JSON.stringify({mode, probeMs: report.probeMs, probe: report.probe,
		featureStatus: report.systemInfo.gpu.featureStatus,
				graphics: Object.fromEntries(['glImplementationParts', 'glRenderer', 'skiaBackendType', 'hardwareSupportsVulkan', 'sandboxed']
					.map(key => [key, report.systemInfo.gpu.auxAttributes[key]]))}, null, 2));
}
try {
	timer = setTimeout(() => stop(new Error('WebGPU diagnostic exceeded 20000ms')), 20000);
	await Promise.race([run(), failure]);
}
catch (error) { report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
	clearTimeout(timer);
	clearTimeout(sampleTimer);
	process.removeListener('SIGINT', interrupted);
	process.removeListener('SIGTERM', interrupted);
	for (const client of clients) client.close();
	killBenchmarkBrowser(browser);
	if (browser && browser.exitCode === null && browser.signalCode === null)
		await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1000)]);
	server?.closeAllConnections();
	if (server?.listening) await new Promise(resolve => server.close(resolve));
	if (profile) await rm(profile, {recursive: true, force: true});
	report.browserLog = log;
	await writeFile(join(cache, `webgpu-probe-${mode}.json`), JSON.stringify(report, null, 2) + '\n');
	console.log('Browser log:', log);
}
