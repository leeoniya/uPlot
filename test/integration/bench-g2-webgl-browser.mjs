import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {cachedChromeBinary} from '../../scripts/chrome-headless-shell.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';

// TEST_G2_WEBGL_BROWSER=1 node --test --test-isolation=none test/integration/bench-g2-webgl-browser.mjs
// Cache-only, one 200-row sample, no full-data retry and no browser/vendor downloads.
const root = new URL('../../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const sampleMs = 5000;

async function smokeSample() {
	const {adapter, capture, packed} = globalThis.g2Smoke;
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const report = {rows: 200, draws: {}, resources: {}, paths: []};
	const patches = [];
	const resourceStats = new Map();
	const statsFor = gl => {
		if (!resourceStats.has(gl)) resourceStats.set(gl, {draws: {}, resources: {}});
		return resourceStats.get(gl);
	};
	const patch = (prototype, name, wrap) => {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
		if (!descriptor || typeof descriptor.value !== 'function') return;
		Object.defineProperty(prototype, name, {...descriptor, value: wrap(descriptor.value)});
		patches.push(() => Object.defineProperty(prototype, name, descriptor));
	};
	for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
		for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
			patch(prototype, name, original => function(...args) {
				const draws = statsFor(this).draws;
				draws[name] = (draws[name] ?? 0) + 1;
				return original.apply(this, args);
			});
		}
		for (const type of ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer', 'VertexArray']) {
			for (const operation of ['create', 'delete']) {
				patch(prototype, operation + type, original => function(...args) {
					const result = original.apply(this, args);
					const resources = statsFor(this).resources;
					const stats = resources[type] ??= {created: 0, deleted: 0, live: new Set()};
					if (operation === 'create' && result) { stats.created++; stats.live.add(result); }
					if (operation === 'delete' && stats.live.delete(args[0])) stats.deleted++;
					return result;
				});
			}
		}
	}
	const host = document.createElement('div');
	host.style.cssText = 'width:1920px;height:600px';
	document.body.append(host);
	const wait = {textContent: 'Rendering...'};
	let chart, gl;
	const start = performance.now();
	// render() is inherited; observe its owner without changing the renderer.
	let prototype = G2.Chart.prototype;
	while (prototype && !Object.hasOwn(prototype, 'render')) prototype = Object.getPrototypeOf(prototype);
	check(prototype, 'G2 render method not found');
	// Keep evidence even if the adapter rejects its native-path guard.
	patch(prototype, 'render', original => async function(...args) {
		const result = await original.apply(this, args);
		report.renderMs = performance.now() - start;
		const surface = this.getContext().canvas;
		gl = surface.getContextService().getContext();
		const {InstancedPathDrawcall, InstancedLineDrawcall, InstancedFillDrawcall} = G.WebGL.DeviceRenderer;
		report.paths = surface.document.getElementsByClassName('element').map(element => ({
			nodeName: element.nodeName,
			fillIsNone: element.parsedStyle.fill?.isNone === true,
			fillDrawcalls: (element.renderable3D?.drawcalls ?? []).filter(call => call instanceof InstancedFillDrawcall).length,
			commands: element.parsedStyle.path?.absolutePath?.length,
			drawcalls: (element.renderable3D?.drawcalls ?? []).map(drawcall => ({
				kind: drawcall instanceof InstancedPathDrawcall ? 'InstancedPathDrawcall'
					: drawcall instanceof InstancedLineDrawcall ? 'InstancedLineDrawcall' : drawcall.constructor.name,
				instancedCount: drawcall.geometry?.instancedCount,
			})),
		}));
		console.log('G2 smoke vendor render:', JSON.stringify({renderMs: report.renderMs, paths: report.paths}));
		return result;
	});

	try {
		capture.begin();
		const data = adapter.prepData(packed);
		check(data.length === 200, 'Expected only 200 rows');
		chart = await adapter.makeChart(data, host, wait);
		report.adapterMs = performance.now() - start;
		check(wait.textContent === 'Done!', 'Adapter did not report readiness');

		check(chart.getWebGLContexts().length === 1 && chart.getWebGLContexts()[0] === gl, 'Context identity mismatch');
		for (const context of chart.getWebGLContexts()) capture.track(context);
		report.initial = await capture.complete({timeoutMs: 1000, webgl1Finish: true});
		check(report.initial.status === 'complete', 'Initial GPU completion failed');
		// No reconstruction or getContext acquisition: only explicit adapter registration.
		capture.begin();
		for (const context of chart.getWebGLContexts()) capture.track(context);
		report.reused = await capture.complete({timeoutMs: 1000, webgl1Finish: true});
		check(report.reused.status === 'complete' && report.reused.contexts.length === 1, 'Reused context completion failed');
		report.draws = {...statsFor(gl).draws};
		check(Object.values(report.draws).some(count => count > 0), 'No real GL draw calls');
	}
	catch (error) { report.error = error.stack; }
	finally {
		try {
			if (chart) adapter.destroyChart(chart);
			// On adapter rejection, it already owns chart cleanup; do not double-destroy.
			report.cleanup = {
				returnedContexts: chart?.getWebGLContexts().length ?? null,
				canvases: host.querySelectorAll('canvas').length,
				contextLost: gl?.isContextLost() ?? null,
			};
			if (gl) {
				report.draws = {...statsFor(gl).draws};
				report.resources = Object.fromEntries(Object.entries(statsFor(gl).resources)
					.map(([type, {created, deleted, live}]) => [type, {created, deleted, remaining: live.size}]));
			}
			if (chart) {
				check(report.cleanup.returnedContexts === 0, 'Destroyed chart still exposes context');
				check(report.cleanup.canvases === 0, 'Destroyed chart left a canvas');
			}
		}
		catch (error) { report.cleanupError = error.stack; }
		capture.dispose();
		for (const restore of patches.reverse()) restore();
		host.remove();
		report.totalMs = performance.now() - start;
	}
	return report;
}

(process.env.TEST_G2_WEBGL_BROWSER === '1' ? describe : describe.skip)('G2 WebGL cached-browser smoke', function() {
	it('renders 200 rows natively, fences reused contexts, and destroys the chart within 5s', {timeout: 55000}, async () => {
		let browser, client, server, profile, totalTimer, sampleTimer;
		let log = '', phase = 'loading cached files';
		const exceptions = [];
		let rejectFailure;
		const failure = new Promise((_, reject) => { rejectFailure = reject; });
		failure.catch(() => {});
		const stop = error => {
			rejectFailure(error);
			try { killBenchmarkBrowser(browser); }
			catch (cleanupError) { console.error(cleanupError); }
		};
		const interrupted = () => stop(new Error('G2 smoke interrupted'));
		process.once('SIGINT', interrupted);
		process.once('SIGTERM', interrupted);
		const run = async () => {
			const binary = await cachedChromeBinary();
			assert.ok(binary, 'No cached Chrome executable. Run npm run bench -- --install-only or set CHROME_BIN; this test never installs a browser.');
			await access(binary, constants.X_OK);
			const assets = new Map();
			for (const name of ['antv-g2-5.4.8-dist-g2.min.js', 'antv-g-lite-2.7.2-dist-index.umd.min.js', 'antv-g-webgl-2.1.3-dist-index.umd.min.js'])
				assets.set('/' + name, await readFile(join(cache, name)));
			for (const path of ['bench/g2.mjs', 'bench/g2-webgl.mjs', 'scripts/bench-webgl.mjs'])
				assets.set('/' + path, await readFile(new URL(path, root)));
			const packed = JSON.parse(await readFile(new URL('bench/data.json', root), 'utf8'));
			assets.set('/packed.json', JSON.stringify(packed.slice(0, packed[0] + 1 + 200 * packed[0])));
			assets.set('/', '<!doctype html><meta charset="utf-8"><title>G2 WebGL smoke</title>' +
				[...assets.keys()].filter(path => path.endsWith('.min.js')).map(path => `<script src="${path}"></script>`).join(''));
			server = createServer((request, response) => {
				if (!assets.has(request.url)) { response.writeHead(404).end(); return; }
				response.setHeader('Content-Type', request.url === '/' ? 'text/html' : request.url.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.end(assets.get(request.url));
			});
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			profile = await mkdtemp(join(cache, 'g2-webgl-smoke-'));
			phase = 'launching cached Chrome';
			browser = spawn(binary, ['--enable-gpu', '--no-first-run', '--no-default-browser-check',
				'--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
				'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
				'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
				'--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
			browser.once('error', rejectFailure);
			browser.once('exit', (code, signal) => rejectFailure(new Error(`Chrome exited (${code ?? signal}): ${log}`)));
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
				if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
				if (method === 'Runtime.consoleAPICalled') console.log('Browser:', ...params.args.map(arg => arg.value ?? arg.description));
			});
			await client.send('Page.enable');
			await client.send('Runtime.enable');
			const browserVersion = await client.send('Browser.getVersion');
			console.log('G2 smoke browser:', browserVersion.product);
			const loaded = client.wait('Page.loadEventFired');
			loaded.catch(() => {});
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
			await loaded;
			const evaluate = async expression => {
				const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
				assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
				return result.result.value;
			};
			phase = 'preparing modules';
			await evaluate(`(async () => {
				const adapter = await import('/bench/g2-webgl.mjs');
				const {createWebGLCapture} = await import('/scripts/bench-webgl.mjs');
				const packed = await (await fetch('/packed.json')).json();
				globalThis.g2Smoke = {adapter, capture: createWebGLCapture(), packed};
			})()`);
			phase = '200-row sample';
			sampleTimer = setTimeout(() => stop(new Error('G2 200-row sample exceeded 5000ms')), sampleMs);
			const report = await evaluate(`(${smokeSample.toString()})()`);
			clearTimeout(sampleTimer);
			console.log('G2 WebGL smoke:', JSON.stringify(report, null, 2));
			assert.equal(report.error, undefined);
			assert.equal(report.cleanupError, undefined);
			assert.equal(report.paths.length, 3);
			assert.ok(report.paths.every(path => path.nodeName === 'path' && path.drawcalls.some(call => call.kind === 'InstancedPathDrawcall')));
			assert.ok(report.paths.every(path => path.fillIsNone && path.fillDrawcalls === 0), 'Line series must not generate invisible fill geometry');
			assert.ok(report.totalMs < sampleMs);
			assert.deepEqual(exceptions, [], 'Uncaught browser exceptions');
		};
		try {
			totalTimer = setTimeout(() => stop(new Error(`G2 smoke exceeded 45000ms during ${phase}`)), 45000);
			await Promise.race([run(), failure]);
		}
		catch (error) {
			error.message = `${phase}: ${error.message}\n${exceptions.join('\n')}\n${log}`;
			throw error;
		}
		finally {
			clearTimeout(totalTimer);
			clearTimeout(sampleTimer);
			process.removeListener('SIGINT', interrupted);
			process.removeListener('SIGTERM', interrupted);
			client?.close();
			killBenchmarkBrowser(browser);
			if (browser && browser.exitCode === null && browser.signalCode === null) {
				await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1000)]);
			}
			server?.closeAllConnections();
			if (server?.listening) await new Promise(resolve => server.close(resolve));
			if (profile) await rm(profile, {recursive: true, force: true});
		}
	});
});
