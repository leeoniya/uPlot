import assert from 'node:assert/strict';
import {constants, writeFileSync} from 'node:fs';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from './profile-manual.mjs';
import {loadBenchDemoSources} from './bench-demo-sources.mjs';
import {bundleModuleDependencies} from './bench-module-bundle.mjs';
import {createWebGLCapture} from './bench-webgl.mjs';
import {demoDependencies} from '../bench/demo-dependencies.mjs';

const root = new URL('../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const output = join(cache, 'chart-lifecycle-smoke.json');
const libraries = ['uplot', 'plotly', 'scichart', 'chartgpu'];
const version = '156.0.8078.47';
const phaseLimitMs = 5000;
const started = performance.now();
const report = {
	schema: 1, started: new Date().toISOString(), status: 'running',
	metadata: {
		rows: 55550, series: 3, width: 1920, height: 600, dpr: 1, autoAxes: true, animation: false,
		sessions: 3, chartsPerSession: 'One fresh direct-populated chart and one fresh empty-to-populated chart; destroyed between paths.',
		order: 'direct/lifecycle, lifecycle/direct, direct/lifecycle', replacements: 4,
		warmup: 'Session 1 excluded; replacement 1 excluded in every session. All raw rows retained.',
		cold: 'Only the first chart in session 1 is browser-first/cold. Later fresh charts share the browser/vendor caches. Updates retain a chart.',
		input: 'Fresh packed copy and native columns per populated operation. Step shifts timestamps by step minutes, CPU +0.01*step, RAM +0.02*step percentage points, TCP +0.001*step. All rows, including three validation anchors, change.',
		timing: 'readyMs: elapsed wall time to adapter method resolution. completeMs: same start through two rAFs, actual GL fences/finish, and actual WebGPU queue completion. Not existing benchmark totalMs (host-thread sum), CPU-active time, GPU execution time, or presentation latency.',
		preparation: 'Packed derivation and adapter.prepare measured separately, outside operation timing. Native validation also outside timing.',
		acquisition: 'Actual getContext/requestAdapter/requestDevice calls only; durations can overlap and do not explain total initialization. No capability probes or precreated devices.',
		validation: 'Native counts and samples, not raster proof. GL contextInfo is reported hardware evidence, not proof of acceleration.',
		coverage: 'Main realm HTMLCanvasElement/OffscreenCanvas and GPU prototypes; worker/other-realm acquisitions are not observed.',
		limits: {phaseMs: phaseLimitMs, runMs: 180000}, cacheOnly: true,
	}, libraries: [], errors: [],
};

// Installed before any vendor code; only observes calls the vendor actually makes.
function installInstrumentation(makeCapture) {
	const ids = new WeakMap(), contextIds = new WeakMap();
	let serial = 0, contextSerial = 0, active;
	const identity = (object, prefix) => {
		if (!object) return null;
		if (!ids.has(object)) ids.set(object, `${prefix}-${++serial}`);
		return ids.get(object);
	};
	const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256) : null;
	const adapterInfo = adapter => {
		const info = adapter?.info;
		return info ? Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key => [key, clean(info[key])]).concat([
			['isFallbackAdapter', typeof info.isFallbackAdapter === 'boolean' ? info.isFallbackAdapter : null],
		])) : null;
	};
	const coverage = [];
	for (const name of ['HTMLCanvasElement', 'OffscreenCanvas']) {
		const prototype = globalThis[name]?.prototype;
		const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'getContext');
		if (typeof descriptor?.value !== 'function') continue;
		Object.defineProperty(prototype, 'getContext', {...descriptor, value: function(type, ...args) {
			const bucket = active, start = performance.now();
			let context;
			try { return context = descriptor.value.call(this, type, ...args); }
			finally {
				const durationMs = performance.now() - start;
				const gl = ['webgl', 'experimental-webgl', 'webgl2'].includes(type);
				const fresh = !!context && !contextIds.has(context);
				if (fresh) contextIds.set(context, `${gl ? 'gl' : 'ctx'}-${++contextSerial}`);
				if (bucket) {
					bucket.contextCalls.push({canvas: name, type, success: !!context, newContext: fresh,
						id: context ? contextIds.get(context) : null, durationMs});
					if (gl && context) bucket.gl.add(context);
				}
			}
		}});
		coverage.push(`${name}.getContext`);
	}
	for (const [name, method] of [['GPU', 'requestAdapter'], ['GPUAdapter', 'requestDevice']]) {
		const prototype = globalThis[name]?.prototype;
		const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, method);
		if (typeof descriptor?.value !== 'function') continue;
		Object.defineProperty(prototype, method, {...descriptor, value: async function(...args) {
			const bucket = active, start = performance.now();
			const call = {method, status: 'pending'};
			bucket?.gpuCalls.push(call);
			try {
				const result = await descriptor.value.apply(this, args);
				call.durationMs = performance.now() - start;
				call.status = result ? 'success' : 'unavailable';
				call.id = identity(result, method === 'requestDevice' ? 'device' : 'adapter');
				if (method === 'requestAdapter') call.adapterInfo = adapterInfo(result);
				else call.adapterId = identity(this, 'adapter');
				return result;
			}
			catch (error) { call.durationMs = performance.now() - start; call.status = 'error'; throw error; }
		}});
		coverage.push(`${name}.${method}`);
	}
	const snapshot = () => {
		if (!active) return null;
		const {contextCalls, gpuCalls} = active;
		const glCalls = contextCalls.filter(call => ['webgl', 'experimental-webgl', 'webgl2'].includes(call.type));
		const sum = calls => calls.reduce((sum, call) => sum + (call.durationMs ?? 0), 0);
		return {contextCalls, gpuCalls, contextAcquireMs: sum(contextCalls), glAcquireMs: sum(glCalls),
			newContexts: contextCalls.filter(call => call.newContext).length,
			newGLContexts: glCalls.filter(call => call.newContext).length,
			requestAdapterMs: sum(gpuCalls.filter(call => call.method === 'requestAdapter')),
			requestDeviceMs: sum(gpuCalls.filter(call => call.method === 'requestDevice'))};
	};
	globalThis.lifecycleSmoke = {
		identity, contextId: context => contextIds.get(context) ?? null, coverage,
		begin() { active = {contextCalls: [], gpuCalls: [], gl: new Set()}; },
		snapshot, end() { const result = snapshot(); active = null; return result; },
		get observedGL() { return [...(active?.gl ?? [])]; },
		capture: makeCapture(),
	};
}

async function setupBrowser(id) {
	const state = globalThis.lifecycleSmoke;
	const {createLifecycleAdapter} = await import('/scripts/bench-lifecycle-adapters.mjs');
	const packed = await (await fetch('/packed.json')).json();
	const adapter = createLifecycleAdapter(id);
	let input = null, handle = null, host = null, previous = null, firstData = null;
	state.prepare = step => {
		const start = performance.now();
		const derived = packed.slice(), fields = packed[0];
		for (let i = fields + 1; i < derived.length; i += fields) {
			derived[i] += step;
			derived[i + 1] -= 0.01 * step;
			derived[i + 3] += 0.001 * step;
			const change = (packed[i + 5] + packed[i + 6]) * 0.0002 * step;
			derived[i + 5] += change;
			derived[i + 6] -= change;
		}
		const deriveMs = performance.now() - start;
		const prepStart = performance.now();
		input = adapter.prepare(derived);
		return {step, deriveMs, prepareMs: performance.now() - prepStart, elapsedMs: performance.now() - start};
	};
	const identities = () => ({handle: state.identity(handle, 'handle'), chart: state.identity(handle.chart, 'chart'),
		instance: state.identity(handle.chart?.instance, 'instance'),
		contexts: adapter.contexts(handle).map(state.contextId), devices: adapter.devices(handle).map(device => state.identity(device, 'device'))});
	state.operation = async (kind, rowId) => {
		const row = {status: 'running'};
		if (kind === 'direct-create' || kind === 'empty-create') {
			host = document.createElement('div');
			host.style.cssText = 'width:1920px;height:600px';
			document.body.append(host);
			previous = firstData = null;
		}
		state.begin();
		state.capture.begin();
		const start = performance.now();
		try {
			if (kind === 'direct-create' || kind === 'empty-create') handle = await adapter.create(host, kind === 'empty-create' ? null : input);
			else await adapter.update(handle, input);
			row.readyMs = performance.now() - start;
			// Preserve readiness if the external watchdog later kills a hung settle/fence.
			console.log('lifecycle-ready', JSON.stringify({rowId, readyMs: row.readyMs}));
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const contexts = [...new Set([...state.observedGL, ...adapter.contexts(handle)])];
			for (const context of adapter.contexts(handle)) state.capture.track(context);
			const devices = adapter.devices(handle);
			const [gl, gpu] = await Promise.all([
				state.capture.complete({timeoutMs: 4000, webgl1Finish: true}),
				Promise.all(devices.map(async device => {
					const waitStart = performance.now();
					await device.queue.onSubmittedWorkDone();
					return {id: state.identity(device, 'device'), status: 'complete', waitMs: performance.now() - waitStart};
				})),
			]);
			row.completeMs = performance.now() - start;
			row.gl = {status: gl.status, waitMs: gl.waitMs, coverage: gl.coverage,
				contexts: gl.contexts.map(context => ({...context, id: state.contextId(contexts[context.index])}))};
			row.gpu = gpu;
			row.identity = identities();
			row.identityChanges = [];
			row.identityIssues = [];
			if (previous) {
				for (const key of ['handle', 'chart', 'instance', 'contexts', 'devices']) {
					if (JSON.stringify(previous[key]) === JSON.stringify(row.identity[key])) continue;
					row.identityChanges.push({kind: key, before: previous[key], after: row.identity[key]});
					// Empty Plotly charts defer GL acquisition until first data. Preserve that
					// evidence, but only allow additions (not swaps) before first data.
					const deferredAddition = !firstData && ['contexts', 'devices'].includes(key) &&
						previous[key].every(value => row.identity[key].includes(value));
					if (!deferredAddition) row.identityIssues.push(`${key} changed across update`);
				}
			}
			if (firstData && (state.snapshot().newGLContexts || state.snapshot().gpuCalls.some(call => call.method === 'requestDevice' && call.status === 'success')))
				row.identityIssues.push('New GL context/device acquired after first data');
			previous = row.identity;
			if (kind === 'first-data' || kind === 'direct-create') firstData = row.identity;
			if (!['complete', 'not-observed'].includes(gl.status)) throw new Error(`GL completion ${gl.status}`);
			row.status = 'complete';
		}
		catch (error) { row.status = 'error'; row.error = error.stack ?? String(error); }
		finally { row.acquisition = state.end(); state.capture.reset(); }
		return row;
	};
	state.validate = kind => {
		const start = performance.now();
		const validation = adapter.validate(handle, kind === 'empty-create' ? null : input);
		if (kind === 'replacement' && !validation.series.every(series => series.samples.every(sample => sample.changedY)))
			throw new Error('Not all three native anchors changed in every series');
		return {validation, validationMs: performance.now() - start};
	};
	state.destroy = async () => {
		state.begin();
		const start = performance.now();
		try { if (handle) await adapter.destroy(handle); }
		finally { handle = input = previous = firstData = null; host?.remove(); host = null; }
		return {elapsedMs: performance.now() - start, acquisition: state.end()};
	};
	return {dpr: devicePixelRatio, coverage: state.coverage};
}

const median = values => {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
};
function summarize(lib) {
	const metrics = rows => Object.fromEntries(['readyMs', 'completeMs', 'contextAcquireMs', 'glAcquireMs', 'requestAdapterMs', 'requestDeviceMs'].map(key =>
		[key, median(rows.map(row => row[key] ?? row.acquisition?.[key]))]));
	lib.sessionMedians = [];
	for (let session = 1; session <= 3; session++) for (const kind of ['direct-create', 'empty-create', 'first-data', 'replacement']) {
		const rows = lib.phases.filter(row => row.session === session && row.kind === kind && row.status === 'complete' && row.validation && (kind !== 'replacement' || row.replacement > 1));
		if (rows.length) lib.sessionMedians.push({session, warmup: session === 1, kind, samples: rows.length, ...metrics(rows)});
	}
	lib.summary = ['direct-create', 'empty-create', 'first-data', 'replacement'].map(kind => {
		const sessions = lib.sessionMedians.filter(row => !row.warmup && row.kind === kind);
		return {kind, sessions: sessions.length, ...metrics(sessions)};
	});
}

let browser, client, server, profile, currentRow, currentLibrary, phase = 'setup', fatal;
const abort = new AbortController();
function save() {
	report.elapsedMs = performance.now() - started;
	writeFileSync(output, JSON.stringify(report) + '\n');
}
function killBrowser() {
	if (browser?.pid) {
		try { process.kill(-browser.pid, 'SIGKILL'); }
		catch (error) { if (error.code !== 'ESRCH') report.errors.push({phase: 'kill process group', error: error.message}); }
	}
}
function stop(error) { fatal = error; abort.abort(error); killBrowser(); }
const interrupted = signal => stop(new Error(`Interrupted by ${signal}`));
const onInt = () => interrupted('SIGINT'), onTerm = () => interrupted('SIGTERM');
process.once('SIGINT', onInt);
process.once('SIGTERM', onTerm);
const totalTimer = setTimeout(() => stop(new Error(`Run deadline during ${phase}`)), 170000);
const hardTimer = setTimeout(() => {
	killBrowser(); report.status = 'error'; report.errors.push({phase, error: 'Hard run deadline; cleanup incomplete'});
	try { save(); } finally { process.exit(1); }
}, 179000);

async function bounded(label, action) {
	phase = label;
	abort.signal.throwIfAborted();
	let timer, onAbort;
	const limit = new Promise((_, reject) => {
		timer = setTimeout(() => { killBrowser(); reject(new Error(`${label}: external 5000ms watchdog`)); }, phaseLimitMs);
		onAbort = () => reject(abort.signal.reason);
		abort.signal.addEventListener('abort', onAbort, {once: true});
	});
	try { return await Promise.race([Promise.resolve().then(action), limit]); }
	finally { clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort); }
}
async function evaluate(expression) {
	const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
	return result.result.value;
}
async function cleanup() {
	client?.close(); client = null;
	killBrowser();
	if (browser && browser.exitCode === null && browser.signalCode === null)
		await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(500)]);
	browser = null;
	server?.closeAllConnections();
	if (server?.listening) await new Promise(resolve => server.close(resolve));
	server = null;
	if (profile) { await rm(profile, {recursive: true, force: true, maxRetries: 2, retryDelay: 100}); profile = null; }
}

async function runLibrary(id) {
	const lib = currentLibrary = {id, status: 'running', phases: [], errors: [], exceptions: []};
	report.libraries.push(lib);
	let browserLog = '';
	try {
		const {files, dependencies, localScripts, localStyles} = await bounded(`${id}/cache`, async () => {
			const sources = loadBenchDemoSources(root, id);
			for (const dependency of sources.dependencies) {
				if (dependency.type === 'module') continue;
				sources.files.set(dependency.route, await readFile(join(cache, dependency.cacheName)));
			}
			if (sources.dependencies.some(dependency => dependency.type === 'module')) {
				let bundle, lastError;
				for (const directory of ['framework-modules', 'modules']) {
					try {
						bundle = await bundleModuleDependencies(demoDependencies[id], {cacheDir: join(cache, directory),
							fetchImpl: async url => { throw new Error(`Cache-only: missing module ${url}`); }});
						break;
					}
					catch (error) { lastError = error; }
				}
				if (!bundle) throw lastError;
				lib.bundle = {sha256: bundle.sha256, bytes: bundle.bytes};
				sources.files.set('/vendor.mjs', bundle.code);
			}
			for (const path of [...libraries.map(name => `bench/${name}.mjs`), 'scripts/bench-lifecycle-adapters.mjs'])
				sources.files.set('/' + path, await readFile(new URL(path, root)));
			const packed = JSON.parse(await readFile(new URL('bench/data.json', root), 'utf8'));
			assert.equal((packed.length - packed[0] - 1) / packed[0], 55550);
			sources.files.set('/packed.json', JSON.stringify(packed));
			return sources;
		});
		files.set('/', '<!doctype html><meta charset="utf-8"><title>Lifecycle smoke</title><style>html,body{margin:0;padding:0}</style>');
		await bounded(`${id}/browser-start`, async () => {
			server = createServer((request, response) => {
				const path = new URL(request.url, 'http://localhost').pathname;
				if (!files.has(path)) { response.writeHead(404).end(); return; }
				response.setHeader('Content-Type', path === '/' ? 'text/html' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.end(files.get(path));
			});
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			profile = await mkdtemp(join(cache, 'lifecycle-smoke-'));
			const binary = fileURLToPath(new URL(`node_modules/.cache/uplot-bench/chrome-headless-shell-${version}-linux64/chrome-headless-shell`, root));
			await access(binary, constants.X_OK);
			const flags = ['--enable-gpu', '--enable-features=Vulkan', '--no-first-run', '--no-default-browser-check',
				'--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
				'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
				'--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'];
			lib.flags = flags.filter(flag => !flag.startsWith('--user-data-dir='));
			browser = spawn(binary, flags, {detached: true, stdio: ['ignore', 'ignore', 'pipe']});
			let spawnError;
			browser.once('error', error => { spawnError = error; });
			browser.stderr.on('data', chunk => { browserLog = (browserLog + chunk).slice(-3000); });
			let port;
			for (let attempt = 0; attempt < 80; attempt++) {
				abort.signal.throwIfAborted();
				if (spawnError) throw spawnError;
				try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
				catch (error) { if (error.code !== 'ENOENT') throw error; await delay(25); }
			}
			assert.ok(port, `Chrome startup failed: ${browserLog}`);
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(2000)})).json();
			const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
			client = new CDP(socket, 5000);
			await new Promise((resolve, reject) => {
				socket.addEventListener('open', resolve, {once: true});
				socket.addEventListener('error', () => reject(new Error('CDP connection failed')), {once: true});
			});
			socket.addEventListener('message', event => {
				const {method, params} = JSON.parse(event.data);
				if (method === 'Runtime.exceptionThrown') lib.exceptions.push({phase, error: params.exceptionDetails.exception?.description ?? params.exceptionDetails.text});
				if (method === 'Runtime.consoleAPICalled' && params.args[0]?.value === 'lifecycle-ready') {
					const checkpoint = JSON.parse(params.args[1].value);
					if (currentRow?.rowId === checkpoint.rowId) { currentRow.readyMs = checkpoint.readyMs; save(); }
				}
			});
			await client.send('Page.enable');
			await client.send('Runtime.enable');
			lib.browser = await client.send('Browser.getVersion');
			assert.match(lib.browser.product, /\/156\.0\.8078\.47$/);
			await client.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: 1, mobile: false});
			await client.send('Page.addScriptToEvaluateOnNewDocument', {source: `(${installInstrumentation.toString()})(${createWebGLCapture.toString()})`});
			// Enforce local delivery, including vendor requests, without graphics bypass flags.
			await client.send('Fetch.enable', {patterns: [{urlPattern: '*'}]});
			socket.addEventListener('message', event => {
				const {method, params} = JSON.parse(event.data);
				if (method !== 'Fetch.requestPaused') return;
				const local = params.request.url.startsWith(`http://127.0.0.1:${server.address().port}/`) || /^(data:|blob:|about:)/.test(params.request.url);
				client?.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', {requestId: params.requestId, ...(!local ? {errorReason: 'BlockedByClient'} : {})}).catch(() => {});
			});
			const loaded = client.wait('Page.loadEventFired'); loaded.catch(() => {});
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
			await loaded;
		});
		lib.vendorLoad = await bounded(`${id}/vendor-load`, () => evaluate(`(async () => {
			const state = lifecycleSmoke; state.begin(); const start = performance.now();
			try {
				for (const href of ${JSON.stringify(localStyles)}) await new Promise((resolve, reject) => {
					const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.onload = resolve; link.onerror = () => reject(new Error('Style load failed: ' + href)); document.head.append(link);
				});
				globalThis.benchmarkSciChartOptions = ${JSON.stringify(Object.fromEntries(dependencies.filter(dep => dep.type === 'wasm').map(dep => [dep.option.replace('Binary', 'Url'), dep.route])))};
				for (const src of ${JSON.stringify([...localScripts, ...dependencies.filter(dep => !dep.type).map(dep => dep.route)])}) await new Promise((resolve, reject) => {
					const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => reject(new Error('Vendor load failed: ' + src)); document.head.append(script);
				});
				${id === 'chartgpu' ? "Object.assign(globalThis, await import('/vendor.mjs'));" : ''}
				return {elapsedMs: performance.now() - start, acquisition: state.end()};
			} catch (error) { return {error: error.stack, elapsedMs: performance.now() - start, acquisition: state.end()}; }
		})()`));
		if (lib.vendorLoad.error) throw new Error(lib.vendorLoad.error);
		lib.environment = await bounded(`${id}/adapter-setup`, () => evaluate(`(${setupBrowser.toString()})(${JSON.stringify(id)})`));
		assert.equal(lib.environment.dpr, 1);
		let chartOrdinal = 0;
		for (let session = 1; session <= 3; session++) {
			const order = session % 2 ? ['direct', 'lifecycle'] : ['lifecycle', 'direct'];
			for (const path of order) {
				chartOrdinal++;
				const kinds = path === 'direct' ? ['direct-create'] : ['empty-create', 'first-data', ...Array(4).fill('replacement')];
				let replacement = 0;
				try {
					for (const kind of kinds) {
						if (kind === 'replacement') replacement++;
						const row = currentRow = {rowId: `${id}/${session}/${path}/${kind}/${replacement}`, session, path, kind,
							warmup: session === 1 || (kind === 'replacement' && replacement === 1),
							browserFirstChart: chartOrdinal === 1, retainedChart: kind === 'first-data' || kind === 'replacement',
							...(kind === 'replacement' ? {replacement} : {}), status: 'running'};
						lib.phases.push(row);
						if (kind !== 'empty-create') row.preparation = await bounded(`${row.rowId}/prepare`, () => evaluate(`lifecycleSmoke.prepare(${session * 10 + 1 + replacement})`));
						Object.assign(row, await bounded(row.rowId, () => evaluate(`lifecycleSmoke.operation(${JSON.stringify(kind)}, ${JSON.stringify(row.rowId)})`)));
						if (row.error) throw new Error(row.error);
						Object.assign(row, await bounded(`${row.rowId}/validate`, () => evaluate(`lifecycleSmoke.validate(${JSON.stringify(kind)})`)));
						if (row.identityIssues.length) lib.errors.push({phase: row.rowId, error: row.identityIssues.join('; ')});
						save();
					}
				}
				catch (error) {
					if (currentRow) { currentRow.status = 'error'; currentRow.error ??= error.message; }
					lib.errors.push({phase, error: error.message});
					console.error(`${id}: ${phase}: ${error.message.split('\n')[0]}`);
					if (fatal || client?.closed || browser?.signalCode || /watchdog|timed out/i.test(error.message)) throw error;
				}
				finally {
					if (!fatal && client && !client.closed && browser?.signalCode == null) {
						const row = {session, path, kind: 'destroy', status: 'running'}; lib.phases.push(row); currentRow = row;
						try { Object.assign(row, await bounded(`${id}/${session}/${path}/destroy`, () => evaluate('lifecycleSmoke.destroy()')), {status: 'complete'}); }
						catch (error) { row.status = 'error'; row.error = error.message; throw error; }
					}
				}
			}
		}
	}
	catch (error) { lib.errors.push({phase, error: error.message}); lib.browserLog = browserLog; }
	finally {
		await cleanup(); currentRow = null;
		summarize(lib);
		lib.status = lib.errors.length || lib.exceptions.length ? 'error' : 'complete';
		console.log(`\n${id}: ${lib.status}; medians of measured session medians (ms)`);
		console.table(lib.summary.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? +value.toFixed(2) : value]))));
		save();
	}
}

try {
	assert.equal(process.platform, 'linux', 'This cache-only runner uses Linux Chrome and process-group cleanup.');
	await access(cache, constants.W_OK);
	for (const id of libraries) { abort.signal.throwIfAborted(); await runLibrary(id); }
}
catch (error) { report.errors.push({phase, library: currentLibrary?.id, error: error.message}); }
finally {
	try { await cleanup(); }
	catch (error) { report.errors.push({phase: 'cleanup', error: error.message}); }
	clearTimeout(totalTimer); clearTimeout(hardTimer);
	process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
	report.status = report.errors.length || report.libraries.length !== libraries.length || report.libraries.some(lib => lib.status !== 'complete') ? 'error' : 'complete';
	save();
	console.log(`Saved ${output}; ${report.status}; ${(report.elapsedMs / 1000).toFixed(2)}s`);
	if (report.status !== 'complete') process.exitCode = 1;
}
