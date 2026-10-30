// Cache-only diagnostic: node scripts/investigate-g2-webgl-fill.mjs
// Four fresh charts, no full-data run. Timings are instrumented observations, not benchmarks.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {gzipSync} from 'node:zlib';
import {CDP} from './profile-manual.mjs';
import {cachedChromeBinary} from './chrome-headless-shell.mjs';
import {killBenchmarkBrowser} from './bench-browser-process.mjs';

const root = new URL('../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const sampleMs = 5000;
const results = [];
const profileMode = process.argv.includes('--profile');
const rowsIndex = process.argv.indexOf('--rows');
const rowCounts = rowsIndex < 0 ? (profileMode ? [2000, 10000] : [200, 2000]) : [Number(process.argv[rowsIndex + 1])];
assert.ok(rowCounts.every(rows => Number.isInteger(rows) && rows > 0 && rows <= 55550), 'Invalid diagnostic row count');
assert.ok(profileMode || rowsIndex < 0, '--rows requires --profile');

function summarizeProfile(profile) {
	const nodes = new Map(profile.nodes.map(node => [node.id, node]));
	const parents = new Map(profile.nodes.flatMap(node => (node.children ?? []).map(id => [id, node.id])));
	const self = new Map(), inclusive = new Map();
	for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
		const id = profile.samples[i], ms = profile.timeDeltas[i] / 1000;
		self.set(id, (self.get(id) ?? 0) + ms);
		for (let ancestor = id; ancestor !== undefined; ancestor = parents.get(ancestor))
			inclusive.set(ancestor, (inclusive.get(ancestor) ?? 0) + ms);
	}
	const frame = id => {
		const call = nodes.get(id).callFrame;
		return {name: call.functionName, url: call.url, line: call.lineNumber + 1, column: call.columnNumber + 1};
	};
	const top = counts => [...counts].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id, ms]) => ({
		...frame(id), ms, callers: [parents.get(id), parents.get(parents.get(id))].filter(id => id !== undefined).map(frame),
	}));
	return {durationMs: (profile.endTime - profile.startTime) / 1000, self: top(self), inclusive: top(inclusive)};
}

async function sample(rows, fillNone, profiling = false) {
	const {adapter, createWebGLCapture, packed} = globalThis.fillDiagnostic;
	const D = G.WebGL.DeviceRenderer;
	const report = {rows, fill: fillNone ? 'none' : 'default', methods: {}, paths: [], uniqueDrawcalls: [], mergeCallers: {}};
	const restores = [], measured = new Map(), colors = new Map(), draws = {};
	let activeGeometry, chart, gl;
	const host = document.createElement('div');
	host.style.cssText = 'width:1920px;height:600px';
	document.body.append(host);
	const capture = createWebGLCapture();
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const patch = (prototype, name, wrapper) => {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
		check(typeof descriptor?.value === 'function', `Missing instrumented method: ${name}`);
		Object.defineProperty(prototype, name, {...descriptor, value: wrapper(descriptor.value)});
		restores.push(() => Object.defineProperty(prototype, name, descriptor));
	};
	const owner = name => {
		let prototype = G2.Chart.prototype;
		while (prototype && !Object.hasOwn(prototype, name)) prototype = Object.getPrototypeOf(prototype);
		return prototype;
	};
	const stats = call => {
		if (!measured.has(call)) measured.set(call, {id: measured.size, methods: {}});
		return measured.get(call);
	};
	const record = (target, key, elapsed, threw) => {
		const value = target[key] ??= {calls: 0, inclusiveMs: 0, errors: 0};
		value.calls++;
		value.inclusiveMs += elapsed;
		if (threw) value.errors++;
	};
	const hash = value => {
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		let result = 2166136261;
		for (let i = 0; i < (text?.length ?? 0); i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
		return {length: text?.length ?? 0, fnv1a: (result >>> 0).toString(16)};
	};
	try {
		for (const name of ['InstancedFillDrawcall', 'InstancedPathDrawcall']) {
			for (const method of ['calcSegmentNum', 'shouldMerge', 'createGeometry']) {
				report.methods[`${name}.${method}`] = {calls: 0, inclusiveMs: 0, errors: 0};
				patch(D[name].prototype, method, original => function(...args) {
					const start = performance.now(), previous = activeGeometry;
					if (profiling && name === 'InstancedPathDrawcall' && method === 'shouldMerge') {
						const stack = new Error().stack.split('\n').slice(2, 7).join('\n');
						report.mergeCallers[stack] = (report.mergeCallers[stack] ?? 0) + 1;
					}
					let threw = true;
					if (method === 'createGeometry') activeGeometry = this;
					try { const value = original.apply(this, args); threw = false; return value; }
					finally {
						const elapsed = performance.now() - start;
						record(report.methods, `${name}.${method}`, elapsed, threw);
						record(stats(this).methods, method, elapsed, threw);
						activeGeometry = previous;
					}
				});
			}
		}
		// Observe the actual packed RGBA values uploaded for fill, not an inferred CSS color.
		patch(D.BufferGeometry.prototype, 'setVertexBuffer', original => function(options) {
			if (activeGeometry instanceof D.InstancedFillDrawcall && options.bufferIndex === D.VertexAttributeBufferIndex.PACKED_COLOR)
				colors.set(activeGeometry, Array.from(options.data));
			return original.call(this, options);
		});
		// Reproduce the original theme value even after the benchmark disables fill.
		patch(owner('options'), 'options', original => function(...args) {
			const options = args[0];
			if (options?.children) {
				args[0] = {...options, children: options.children.map(mark => mark.type === 'line'
					? {...mark, style: {...mark.style, fill: fillNone ? 'none' : ''}} : mark)};
			}
			return original.apply(this, args);
		});

		for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
			for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
				if (!Object.hasOwn(prototype, name)) continue;
				patch(prototype, name, original => function(...args) {
					draws[name] = (draws[name] ?? 0) + 1;
					return original.apply(this, args);
				});
			}
		}
		if (profiling) {
			patch(owner('render'), 'render', original => async function(...args) {
				const start = performance.now();
				const pending = original.apply(this, args);
				report.renderSyncMs = performance.now() - start;
				console.debug('g2-profile', 'render-returned', report.renderSyncMs);
				const value = await pending;
				report.renderReadyMs = performance.now() - start;
				console.debug('g2-profile', 'render-ready', report.renderReadyMs);
				return value;
			});
		}
		capture.begin();
		const start = performance.now();
		const data = adapter.prepData(packed.slice(0, packed[0] + 1 + rows * packed[0]));
		report.prepMs = performance.now() - start;
		chart = await adapter.makeChart(data, host);
		report.adapterMs = performance.now() - start;
		const surface = chart.getContext().canvas;
		gl = surface.getContextService().getContext();
		const elements = surface.document.getElementsByClassName('element');
		const unique = [...new Set(elements.flatMap(element => element.renderable3D.drawcalls))];
		const summarizeFill = fill => typeof fill === 'object' && fill !== null
			? {type: 'object', isNone: fill.isNone, r: fill.r, g: fill.g, b: fill.b, alpha: fill.alpha}
			: {type: typeof fill, value: fill};
		report.paths = elements.map(element => ({
			nodeName: element.nodeName,
			fill: summarizeFill(element.parsedStyle.fill),
			fillOpacity: element.parsedStyle.fillOpacity,
			opacity: element.parsedStyle.opacity,
			stroke: summarizeFill(element.parsedStyle.stroke),
			lineWidth: element.parsedStyle.lineWidth,
			path: hash(element.getAttribute('d')),
			drawcallIds: element.renderable3D.drawcalls.map(call => stats(call).id),
		}));
		report.uniqueDrawcalls = unique.map(call => ({
			...stats(call),
			kind: call instanceof D.InstancedFillDrawcall ? 'InstancedFillDrawcall'
				: call instanceof D.InstancedPathDrawcall ? 'InstancedPathDrawcall' : call.constructor.name,
			objects: call.objects?.length,
			seriesObjects: call.objects?.filter(object => elements.includes(object)).length,
			instancedCount: call.geometry?.instancedCount,
			vertexCount: call.geometry?.vertexCount,
			packedColors: colors.get(call),
		}));
		check(chart.getWebGLContexts().length === 1 && chart.getWebGLContexts()[0] === gl, 'Wrong adapter context');
		for (const context of chart.getWebGLContexts()) capture.track(context);
		const completion = await capture.complete({timeoutMs: 1000, webgl1Finish: true});
		report.gpu = {status: completion.status, waitMs: completion.waitMs, contexts: completion.contexts};
		check(completion.status === 'complete', 'GPU completion failed');
		report.draws = draws;
		check(Object.values(draws).some(count => count > 0), 'No native GL draws');
		check(elements.length === 3 && report.uniqueDrawcalls.some(call => call.kind === 'InstancedPathDrawcall'), 'Missing native line paths');
		report.throughFenceMs = performance.now() - start;
	}
	catch (error) { report.error = error.stack; }
	finally {
		try {
			const cleanupStart = performance.now();
			if (chart) adapter.destroyChart(chart);
			report.cleanupMs = performance.now() - cleanupStart;
			report.cleanup = {contexts: chart?.getWebGLContexts().length ?? null,
				canvases: host.querySelectorAll('canvas').length, contextLost: gl?.isContextLost() ?? null};
			if (chart) check(report.cleanup.contexts === 0 && report.cleanup.canvases === 0, 'Chart cleanup failed');
		}
		catch (error) { report.cleanupError = error.stack; }
		capture.dispose();
		for (const restore of restores.reverse()) restore();
		host.remove();
	}
	return report;
}

let browser, client, server, profile, sampleTimer, totalTimer, profileTimer;
let profileCapture;
const progress = [];
let phase = 'cache setup', log = '', rejectFailure;
const exceptions = [];
const failure = new Promise((_, reject) => { rejectFailure = reject; });
failure.catch(() => {});
const stop = error => {
	rejectFailure(error);
	try { killBenchmarkBrowser(browser); }
	catch (cleanupError) { console.error(cleanupError); }
};
const interrupted = () => stop(new Error('G2 fill diagnostic interrupted'));
process.once('SIGINT', interrupted);
process.once('SIGTERM', interrupted);
const run = async () => {
	const binary = await cachedChromeBinary();
	assert.ok(binary, 'No cached Chrome executable. Run npm run bench -- --install-only or set CHROME_BIN; this diagnostic never installs a browser.');
	await access(binary, constants.X_OK);
	const assets = new Map();
	for (const name of ['antv-g2-5.4.8-dist-g2.min.js', 'antv-g-lite-2.7.2-dist-index.umd.min.js', 'antv-g-webgl-2.1.3-dist-index.umd.min.js'])
		assets.set('/' + name, await readFile(join(cache, name)));
	for (const path of ['bench/g2.mjs', 'bench/g2-webgl.mjs', 'scripts/bench-webgl.mjs'])
		assets.set('/' + path, await readFile(new URL(path, root)));
	const packed = JSON.parse(await readFile(new URL('bench/data.json', root), 'utf8'));
	assets.set('/packed.json', JSON.stringify(packed.slice(0, packed[0] + 1 + Math.max(...rowCounts) * packed[0])));
	assets.set('/', '<!doctype html><meta charset="utf-8"><title>G2 fill investigation</title>' +
		[...assets.keys()].filter(path => path.endsWith('.min.js')).map(path => `<script src="${path}"></script>`).join(''));
	server = createServer((request, response) => {
		if (!assets.has(request.url)) { response.writeHead(404).end(); return; }
		response.setHeader('Content-Type', request.url === '/' ? 'text/html' : request.url.endsWith('.json') ? 'application/json' : 'text/javascript');
		response.end(assets.get(request.url));
	});
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	profile = await mkdtemp(join(cache, 'g2-fill-diagnostic-'));
	phase = 'browser startup';
	browser = spawn(binary, ['--enable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
		'--disable-component-update', '--disable-sync', '--disable-extensions',
		'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
		'--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'],
		{stdio: ['ignore', 'ignore', 'pipe']});
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
		const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 5000);
		socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
		socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, {once: true});
	});
	socket.addEventListener('message', event => {
		const {method, params} = JSON.parse(event.data);
		if (method === 'Runtime.consoleAPICalled' && params.args[0]?.value === 'g2-profile') {
					const values = params.args.map(arg => arg.value);
					progress.push({phase, values});
					console.log('Progress:', ...values.slice(1));
				}
				if (method === 'Runtime.exceptionThrown') {
			const error = params.exceptionDetails.exception?.description ?? params.exceptionDetails.text;
			exceptions.push({phase, error});
			console.error('Browser exception:', error);
		}
	});
	await client.send('Page.enable');
	await client.send('Runtime.enable');
	const browserVersion = await client.send('Browser.getVersion');
	console.log('Browser:', browserVersion.product);
	const evaluate = async expression => {
		const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
		return result.result.value;
	};
	for (const rows of rowCounts) for (const fillNone of (profileMode ? [true] : [false, true])) {
		phase = `load ${rows}/${fillNone ? 'none' : 'default'}`;
		const loaded = client.wait('Page.loadEventFired');
		loaded.catch(() => {});
		await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
		await loaded;
		await evaluate(`(async () => {
			const adapter = await import('/bench/g2-webgl.mjs');
			const {createWebGLCapture} = await import('/scripts/bench-webgl.mjs');
			const packed = await (await fetch('/packed.json')).json();
			globalThis.fillDiagnostic = {adapter, createWebGLCapture, packed};
		})()`);
		phase = `${rows}/${fillNone ? 'none' : 'default'}`;
		console.log('Sample:', phase);
		let saveProfile;
		if (profileMode) {
			profileCapture = undefined;
			saveProfile = () => profileCapture ??= (async () => {
				const {profile: cpuProfile} = await client.send('Profiler.stop');
				const profilePath = join(cache, `g2-webgl-no-fill-${rows}.cpuprofile.gz`);
				await writeFile(profilePath, gzipSync(JSON.stringify(cpuProfile)));
				return {cpuProfile: summarizeProfile(cpuProfile), profilePath};
			})();
			await client.send('Profiler.enable');
			await client.send('Profiler.setSamplingInterval', {interval: 1000});
			await client.send('Profiler.start');
			// Save a partial profile before the unchanged external kill deadline.
			profileTimer = setTimeout(() => { saveProfile().catch(() => {}); }, 4000);
		}
		const start = performance.now();
		sampleTimer = setTimeout(() => stop(new Error(`${phase} exceeded hard 5000ms sample limit`)), sampleMs);
		const report = await evaluate(`(${sample.toString()})(${rows}, ${fillNone}, ${profileMode})`);
		clearTimeout(sampleTimer);
		report.externalMs = performance.now() - start;
		if (profileMode) {
			clearTimeout(profileTimer);
			Object.assign(report, await saveProfile());
			await client.send('Profiler.disable');
		}
		results.push(report);
		console.log(JSON.stringify(report, null, 2));
		if (report.error || report.cleanupError) process.exitCode = 1;
	}
	assert.deepEqual(exceptions, [], 'Uncaught browser errors');
};
try {
	totalTimer = setTimeout(() => stop(new Error(`Diagnostic exceeded 45000ms during ${phase}`)), 45000);
	await Promise.race([run(), failure]);
}
catch (error) {
	const partial = profileCapture ? await profileCapture.catch(() => null) : null;
		results.push({phase, error: error.stack, exceptions, progress, browserLog: log, partial});
	console.error(error);
	process.exitCode = 1;
}
finally {
	clearTimeout(totalTimer);
	clearTimeout(sampleTimer);
	clearTimeout(profileTimer);
	process.removeListener('SIGINT', interrupted);
	process.removeListener('SIGTERM', interrupted);
	client?.close();
	killBenchmarkBrowser(browser);
	if (browser && browser.exitCode === null && browser.signalCode === null)
		await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1000)]);
	server?.closeAllConnections();
	if (server?.listening) await new Promise(resolve => server.close(resolve));
	if (profile) await rm(profile, {recursive: true, force: true});
	const path = join(cache, profileMode ? `g2-webgl-no-fill-profile-${rowCounts.join('-')}.json` : 'g2-webgl-fill-diagnostic.json');
	await writeFile(path, JSON.stringify({note: 'Single instrumented observations; inclusive method times overlap. Not representative performance measurements.', results}, null, 2) + '\n');
	console.log('Saved:', path);
}
