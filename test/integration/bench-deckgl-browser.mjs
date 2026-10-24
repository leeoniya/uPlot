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
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';

// TEST_DECKGL_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/bench-deckgl-browser.mjs
// Cache only: no downloads or traces. Timings include test instrumentation.
// TEST_DECKGL_SCREENSHOT=1 adds a separate, untimed full-data render and a PNG below 1 MB.
const root = new URL('../../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const version = '156.0.8078.47';
const sampleMs = 5000;

function probeHardware() {
	const gl = document.createElement('canvas').getContext('webgl2', {failIfMajorPerformanceCaveat: true});
	if (!gl) return {available: false, reason: 'Hardware WebGL2 unavailable (major performance caveats rejected).'};
	try {
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		const renderer = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
		const software = /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic|mesa offscreen/i.test(renderer ?? '');
		return {available: Boolean(renderer) && !software, renderer, version: gl.getParameter(gl.VERSION),
			reason: software ? 'Software WebGL2 rejected.' : !renderer ? 'Cannot identify hardware renderer; refusing an unverified backend.' : null};
	}
	finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

// Install before any vendor script: luma may bind or replace individual context methods.
function installNativeObserver() {
	const state = globalThis.deckglNative = {contexts: new WeakMap(), layer: null, frames: 0, pending: new Set()};
	state.stats = gl => {
		if (!state.contexts.has(gl)) state.contexts.set(gl, {draws: {}, fences: 0, waits: 0, deletedFences: 0});
		return state.contexts.get(gl);
	};
	for (const name of ['drawArraysInstanced', 'drawElementsInstanced', 'fenceSync', 'clientWaitSync', 'deleteSync']) {
		const prototype = WebGL2RenderingContext.prototype;
		const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
		if (typeof descriptor?.value !== 'function') throw new Error(`Missing native WebGL2 ${name}`);
		Object.defineProperty(prototype, name, {...descriptor, value: function(...args) {
			const result = descriptor.value.apply(this, args);
			const stats = state.stats(this);
			if (name.startsWith('draw')) {
				const count = args[name === 'drawArraysInstanced' ? 2 : 1];
				const instances = args[name === 'drawArraysInstanced' ? 3 : 4];
				if (count > 0 && instances > 0) {
					const key = `${state.layer?.id ?? 'unattributed'}:${name}`;
					const draw = stats.draws[key] ??= {layer: state.layer?.id ?? null, method: name, calls: 0, maxInstances: 0};
					draw.calls++;
					draw.maxInstances = Math.max(draw.maxInstances, instances);
				}
			}
			else if (name === 'fenceSync' && result) stats.fences++;
			else if (name === 'clientWaitSync') stats.waits++;
			else if (name === 'deleteSync' && args[0]) stats.deletedFences++;
			return result;
		}});
	}
	const request = globalThis.requestAnimationFrame;
	const cancel = globalThis.cancelAnimationFrame;
	globalThis.requestAnimationFrame = function(callback) {
		const id = request.call(this, time => {
			state.pending.delete(id);
			state.frames++;
			callback(time);
		});
		state.pending.add(id);
		return id;
	};
	globalThis.cancelAnimationFrame = function(id) {
		state.pending.delete(id);
		return cancel.call(this, id);
	};
}

async function chartSample(rows, ratio) {
	const {adapter, capture, packed, contextsSeen} = globalThis.deckglSmoke;
	const native = globalThis.deckglNative;
	const report = {rows, dpr: ratio};
	const check = (condition, message) => { if (!condition) throw new Error(message); };
	const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-5;
	const start = performance.now();
	const host = document.createElement('div');
	host.style.cssText = 'width:1920px;height:600px';
	document.body.append(host);
	let chart, gl, element, canvas, svg;
	try {
		check(devicePixelRatio === ratio, 'DPR emulation did not take effect');
		check(native.pending.size === 0, 'Previous sample left an animation frame pending');
		capture.begin();
		const input = rows === 55550 ? packed : packed.slice(0, packed[0] + 1 + rows * packed[0]);
		const data = adapter.prepData(input);
		check(Object.keys(data).join(',') === 'x,cpu,ram,tcp', 'Unexpected prepared columns');
		for (const column of Object.values(data)) check(column instanceof Float64Array && column.length === rows, 'Truncated input');
		for (let j = 0, i = packed[0] + 1; j < rows; j++, i += packed[0]) {
			check(data.x[j] === input[i] * 60000 && data.cpu[j] === Math.round((100 - input[i + 1]) * 1000) / 1000 &&
				data.ram[j] === Math.round(100 * input[i + 5] / (input[i + 5] + input[i + 6]) * 100) / 100 && data.tcp[j] === input[i + 3],
				`Incorrect prepared row ${j}`);
		}
		const wait = {textContent: 'Rendering...'};
		chart = await adapter.makeChart(data, host, wait);
		// No yield, redraw, or pipeline wait here: late frames cannot repair readiness evidence.
		gl = chart.context;
		report.readyMs = performance.now() - start;
		report.drawsAtReady = structuredClone(Object.values(native.stats(gl).draws));
		check(wait.textContent === 'Done!', 'Adapter did not report readiness');
		check(gl instanceof WebGL2RenderingContext && !gl.isContextLost(), 'Not a live WebGL2 backend');
		check(chart.getWebGLContexts().length === 1 && chart.getWebGLContexts()[0] === gl, 'Context identity mismatch');
		check(!contextsSeen.has(gl), 'Fresh chart reused a destroyed context');
		contextsSeen.add(gl);
		report.backend = 'WebGL2';
		element = chart.element;
		canvas = chart.canvas.node();
		svg = chart.svg.node();
		check(canvas.getContext('webgl2') === gl, 'Canvas differs from observed backend');
		check(canvas.width === 1770 * ratio && canvas.height === 500 * ratio &&
			gl.drawingBufferWidth === canvas.width && gl.drawingBufferHeight === canvas.height, 'Incorrect DPR backing size');
		const box = canvas.getBoundingClientRect(), outer = element.getBoundingClientRect();
		check(near(box.x - outer.x, 70) && near(box.y - outer.y, 60) && near(box.width, 1770) && near(box.height, 500), 'Canvas plot alignment');
		const svgBox = svg.getBoundingClientRect();
		check(near(svgBox.x, outer.x) && near(svgBox.y, outer.y) && near(svgBox.width, 1920) && near(svgBox.height, 600), 'SVG alignment');
		const viewport = chart.deck.getViewports()[0];
		check(viewport && viewport.width === 1770 && viewport.height === 500, 'Incorrect orthographic viewport');
		for (const point of [[0, 0, 0], [1770, 500, 0], [885, 250, 0]]) {
			const projected = viewport.project(point);
			check(near(projected[0], point[0]) && near(projected[1], point[1]), 'Viewport flips or offsets the plot');
		}
		const x = d3.scaleTime().domain(d3.extent(data.x)).range([0, 1770]);
		const pct = d3.scaleLinear().domain([Math.min(d3.min(data.cpu), d3.min(data.ram)), Math.max(d3.max(data.cpu), d3.max(data.ram))]).nice().range([500, 0]);
		const mb = d3.scaleLinear().domain(d3.extent(data.tcp)).nice().range([500, 0]);
		const layers = chart.deck.props.layers;
		check(layers.length === 3 && layers.every(layer => layer instanceof deck.PathLayer), 'Expected three native PathLayers');
		report.paths = layers.map((layer, i) => {
			const p = layer.props, scale = i === 2 ? mb : pct, column = [data.cpu, data.ram, data.tcp][i];
			check(layer.id === `series-${i}` && p.data.length === 1 && !p.data.attributes, 'Not a single complete native path');
			const path = p.getPath(p.data[0]);
			check(path instanceof Float64Array && path.length === rows * 2 && !p._pathType, 'Path shortened or native normalization bypassed');
			check(p.positionFormat === 'XY' && p.coordinateSystem === deck.COORDINATE_SYSTEM.CARTESIAN, 'Non-Cartesian path');
			check(p.widthUnits === 'pixels' && p.getWidth * ratio === 1 && p.widthScale === 1 && p.widthMinPixels === 0, 'Line must be one physical pixel');
			for (let j = 0; j < rows; j++) {
				check(near(path[j * 2], x(data.x[j])) && near(path[j * 2 + 1], scale(column[j])), `Incorrect path ${i} point ${j}`);
			}
			const color = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 128, 0, 255]][i];
			check(p.getColor.join(',') === color.join(','), 'Incorrect series color');
			return {id: layer.id, points: path.length / 2, physicalWidth: p.getWidth * ratio};
		});
		const axes = svg.querySelector('g[transform="translate(70,60)"]');
		check(axes && axes.children.length >= 4, 'Missing SVG axes');
		report.tickProjectionMaxError = 0;
		const specifications = [
			[pct, 10, () => '', false], [x, 12, x.tickFormat(12), true],
			[pct, 10, value => `${value}%`, false], [mb, 10, value => `${value} MB`, false],
		];
		report.ticks = specifications.map(([scale, count, format, horizontal], i) => {
			const ticks = [...axes.children[i].querySelectorAll('.tick')], expected = scale.ticks(count);
			check(ticks.length === expected.length && ticks.length > 1, 'SVG automatic tick count mismatch');
			ticks.forEach((tick, j) => {
				check(+tick.__data__ === +expected[j] && tick.querySelector('text').textContent === String(format(expected[j])), 'SVG automatic tick value/label mismatch');
				const matrix = tick.getCTM(), position = scale(expected[j]) + (ratio > 1 ? 0 : 0.5);
				const actualPosition = horizontal ? matrix.e : matrix.f, expectedPosition = position + (horizontal ? 70 : 60);
				const error = Math.abs(actualPosition - expectedPosition);
				report.tickProjectionMaxError = Math.max(report.tickProjectionMaxError, error);
				// Chrome rounds SVG transforms to float32; at this viewport size 1e-5 CSS px is too strict.
				check(Number.isFinite(actualPosition) && error < 1e-4, `SVG tick/path projection mismatch: axis=${i} tick=${j} DPR=${ratio} expected=${expectedPosition} actual=${actualPosition} delta=${actualPosition - expectedPosition} tolerance=0.0001 transform=${tick.getAttribute('transform')}`);
			});
			return ticks.length;
		});
		check(axes.children[1].getAttribute('transform') === 'translate(0,500)' &&
			axes.children[3].getAttribute('transform') === 'translate(1770,0)', 'Axis edge alignment');
		check([...svg.querySelectorAll('text')].some(node => node.textContent === 'Server Events'), 'Missing SVG title');
		check(gl.getError() === gl.NO_ERROR, 'Native draw produced a GL error');
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		report.renderer = debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
		check(report.renderer === globalThis.deckglSmoke.renderer, 'Chart switched away from the probed hardware renderer');
		const complete = async () => {
			capture.track(gl);
			const result = await capture.complete({timeoutMs: 1000});
			check(result.status === 'complete' && result.coverage.observerIntact && result.contexts.length === 1 &&
				result.contexts[0].type === 'webgl2' && result.contexts[0].method === 'fence' && result.contexts[0].status === 'complete', 'Real GL fence completion failed');
			return {status: result.status, method: result.contexts[0].method, waitMs: result.waitMs};
		};
		report.initial = await complete();
		const before = {...native.stats(gl)};
		capture.begin();
		report.reused = await complete();
		const after = native.stats(gl);
		check(after.fences === before.fences + 1 && after.waits > before.waits && after.deletedFences === before.deletedFences + 1, 'Reused context did not execute native fence lifecycle');
		report.fences = {created: after.fences, polls: after.waits, deleted: after.deletedFences};
		// PathLayer tessellation may add endpoint instances, but must cover every original segment.
		check(report.paths.every(path => report.drawsAtReady.some(draw => draw.layer === path.id && draw.maxInstances >= rows - 1)),
			'makeChart resolved before all three full native PathLayers drew (an empty onAfterRender is not readiness)');
	}
	catch (error) { report.error = error.stack; }
	finally {
		try {
			if (chart) {
				adapter.destroyChart(chart);
				adapter.destroyChart(chart);
			}
			const frames = native.frames;
			const draws = gl ? JSON.stringify(native.stats(gl).draws) : null;
			await new Promise(resolve => setTimeout(resolve, 150));
			report.cleanup = {contextLost: gl?.isContextLost() ?? null, children: host.childElementCount,
				framesAfterDestroy: native.frames - frames, pendingFrames: native.pending.size,
				drawsCeased: !gl || draws === JSON.stringify(native.stats(gl).draws)};
			check(host.childElementCount === 0, 'Adapter left DOM behind');
			check(report.cleanup.framesAfterDestroy === 0 && report.cleanup.pendingFrames === 0 && report.cleanup.drawsCeased, 'Frames/draws continued after destruction');
			if (chart) {
				check(report.cleanup.contextLost && chart.destroyed && chart.getWebGLContexts().length === 0, 'Context not lost/released');
				check(!element?.isConnected && !canvas?.isConnected && !svg?.isConnected &&
					chart.deck === null && chart.context === null && chart.svg === null && chart.canvas === null, 'Chart references/DOM retained');
			}
		}
		catch (error) { report.cleanupError = error.stack; }
		capture.reset();
		host.remove();
		report.totalMs = performance.now() - start;
	}
	return report;
}

(process.env.TEST_DECKGL_BROWSER === '1' ? describe : describe.skip)('deck.gl cached hardware-browser smoke', function() {
	this.timeout(55000);
	it('checks native readiness, full paths, axes, fences and teardown at DPR 1 and 2 within 5s per sample', async function() {
		let browser, client, server, profile, totalTimer, sampleTimer;
		let phase = 'loading cache', log = '';
		const report = {package: 'deck.gl', version: '9.4.0', status: 'running', sampleMs, samples: [], exceptions: []};
		let rejectFailure;
		const failure = new Promise((_, reject) => { rejectFailure = reject; });
		failure.catch(() => {});
		const stop = error => {
			rejectFailure(error);
			try { if (browser?.pid) killBenchmarkBrowser(browser); }
			catch (error) { report.killError = error.stack; }
		};
		const interrupted = () => stop(new Error('deck.gl browser test interrupted'));
		process.once('SIGINT', interrupted);
		process.once('SIGTERM', interrupted);
		const run = async () => {
			const binary = fileURLToPath(new URL(`node_modules/.cache/uplot-bench/chrome-headless-shell-${version}-linux64/chrome-headless-shell`, root));
			await access(binary, constants.X_OK);
			const {files, dependencies} = loadBenchDemoSources(root, 'deckgl');
			assert.deepEqual(dependencies.map(({name, version, cacheName}) => [name, version, cacheName]), [
				['d3', '7.9.0', 'd3-7.9.0-dist-d3.min.js'], ['deck.gl', '9.4.0', 'deck.gl-9.4.0-dist.min.js'],
			]);
			const assets = new Map([['/', '<!doctype html><meta charset="utf-8"><title>deck.gl hardware smoke</title><style>body{margin:0;background:white}</style>'],
				['/bench/deckgl.mjs', files.get('/bench/deckgl.mjs')]]);
			for (const dependency of dependencies) assets.set(dependency.route, await readFile(join(cache, dependency.cacheName)));
			for (const path of ['bench/data.json', 'scripts/bench-webgl.mjs']) assets.set('/' + path, await readFile(new URL(path, root)));
			const packed = JSON.parse(assets.get('/bench/data.json'));
			assert.equal((packed.length - packed[0] - 1) / packed[0], 55550);
			server = createServer((request, response) => {
				if (!assets.has(request.url)) { response.writeHead(404).end(); return; }
				response.setHeader('Content-Type', request.url === '/' ? 'text/html' : request.url.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
				response.end(assets.get(request.url));
			});
			await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
			profile = await mkdtemp(join(cache, 'deckgl-smoke-'));
			phase = 'launching cached Chrome';
			browser = spawn(binary, ['--enable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check',
				'--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
				'--disk-cache-size=1048576', '--media-cache-size=1048576',
				'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
				'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
				'--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
			browser.once('error', rejectFailure);
			browser.once('exit', (code, signal) => rejectFailure(new Error(`Chrome exited (${code ?? signal})`)));
			browser.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
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
				if (method === 'Runtime.exceptionThrown' && report.exceptions.length < 10)
					report.exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
			});
			await client.send('Page.enable');
			await client.send('Runtime.enable');
			report.browser = (await client.send('Browser.getVersion')).product;
			assert.ok(report.browser.endsWith('/' + version), 'Wrong cached Chrome version');
			const loaded = client.wait('Page.loadEventFired');
			loaded.catch(() => {});
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
			await loaded;
			const evaluate = async expression => {
				const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
				assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
				return result.result.value;
			};
			phase = 'hardware probe';
			report.hardware = await evaluate(`(${probeHardware.toString()})()`);
			if (!report.hardware.available) { report.status = 'hardware-unavailable'; return; }
			phase = 'installing observers before vendor load';
			await evaluate(`(${installNativeObserver.toString()})()`);
			await evaluate(`(async () => {
				const {createWebGLCapture} = await import('/scripts/bench-webgl.mjs');
				globalThis.deckglSmoke = {capture: createWebGLCapture(), contextsSeen: new WeakSet(), renderer: ${JSON.stringify(report.hardware.renderer)}};
				for (const route of ${JSON.stringify(dependencies.map(dependency => dependency.route))}) {
					await new Promise((resolve, reject) => {
						const script = document.createElement('script');
						script.src = route; script.onload = resolve; script.onerror = () => reject(new Error('Cached vendor failed: ' + route));
						document.head.append(script);
					});
				}
				const original = deck.PathLayer.prototype.draw;
				if (typeof original !== 'function') throw new Error('Native PathLayer.draw missing');
				deck.PathLayer.prototype.draw = function(...args) {
					const previous = deckglNative.layer;
					deckglNative.layer = this;
					try { return original.apply(this, args); }
					finally { deckglNative.layer = previous; }
				};
				deckglSmoke.adapter = await import('/bench/deckgl.mjs');
				deckglSmoke.packed = await (await fetch('/bench/data.json')).json();
			})()`);
			for (const [rows, ratio] of [[200, 1], [55550, 1], [55550, 1], [200, 2]]) {
				await client.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: ratio, mobile: false});
				phase = `sample ${report.samples.length + 1}: ${rows} rows DPR ${ratio}`;
				const sample = {rows, dpr: ratio, status: 'running'};
				report.samples.push(sample);
				const start = performance.now();
				sampleTimer = setTimeout(() => {
					sample.status = 'timeout';
					stop(new Error(`${phase} exceeded 5000ms including preparation and cleanup`));
				}, sampleMs);
				try { Object.assign(sample, await evaluate(`(${chartSample.toString()})(${rows}, ${ratio})`)); }
				finally { clearTimeout(sampleTimer); }
				sample.externalMs = performance.now() - start;
				sample.status = sample.error || sample.cleanupError ? 'failed' : 'complete';
				assert.ok(sample.externalMs < sampleMs && sample.totalMs < sampleMs, 'Sample exceeded hard time limit');
				// Continue bounded samples after an assertion failure, not after leaked resources or a hang.
				assert.equal(sample.cleanupError, undefined);
			}
			assert.deepEqual(report.exceptions, [], 'Uncaught browser exceptions');
			assert.ok(report.samples.every(sample => sample.status === 'complete'), report.samples.filter(sample => sample.error).map(sample => sample.error).join('\n'));
			if (process.env.TEST_DECKGL_SCREENSHOT === '1') {
				phase = 'optional full-data screenshot (outside timed samples)';
				await client.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: 1, mobile: false});
				sampleTimer = setTimeout(() => stop(new Error('Optional screenshot render/capture/cleanup exceeded 5000ms')), sampleMs);
				try {
					await evaluate(`(async () => {
						const {adapter, capture, packed} = deckglSmoke;
						const host = document.createElement('div');
						document.body.append(host);
						deckglSmoke.visual = {host};
						capture.begin();
						const chart = deckglSmoke.visual.chart = await adapter.makeChart(adapter.prepData(packed), host);
						const draws = Object.values(deckglNative.stats(chart.context).draws);
						if (![0, 1, 2].every(i => draws.some(draw => draw.layer === 'series-' + i && draw.maxInstances >= 55549)))
							throw new Error('Screenshot chart resolved before full native draws');
						capture.track(chart.context);
						const result = await capture.complete({timeoutMs: 1000});
						if (result.status !== 'complete') throw new Error('Screenshot GPU completion failed');
						// Allow compositor presentation, without adding settling time to measured samples.
						await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					})()`);
					const {data} = await client.send('Page.captureScreenshot', {format: 'png', fromSurface: true,
						clip: {x: 0, y: 0, width: 1920, height: 600, scale: 1}});
					const png = Buffer.from(data, 'base64');
					assert.ok(png.length > 0 && png.length < 1000000, 'Screenshot must be below 1 MB');
					await writeFile(join(cache, 'deckgl-browser.png'), png);
					report.screenshot = {path: '.cache/benchmarks/deckgl-browser.png', rows: 55550, dpr: 1, bytes: png.length};
				}
				finally {
					try {
						const cleanup = await evaluate(`(async () => {
							const {adapter, capture, visual} = deckglSmoke;
							if (!visual) return null;
							const gl = visual.chart?.context;
							try { if (visual.chart) adapter.destroyChart(visual.chart); }
							finally { visual.host.remove(); capture.reset(); delete deckglSmoke.visual; }
							const frames = deckglNative.frames;
							await new Promise(resolve => setTimeout(resolve, 150));
							return {contextLost: gl?.isContextLost() ?? null, children: visual.host.childElementCount,
								framesAfterDestroy: deckglNative.frames - frames, pendingFrames: deckglNative.pending.size};
						})()`);
						if (report.screenshot) {
							report.screenshot.cleanup = cleanup;
							assert.deepEqual(cleanup, {contextLost: true, children: 0, framesAfterDestroy: 0, pendingFrames: 0});
						}
					}
					finally { clearTimeout(sampleTimer); }
				}
			}
			await evaluate('deckglSmoke.capture.dispose()');
			assert.deepEqual(report.exceptions, [], 'Uncaught browser exceptions');
			report.status = 'complete';
		};
		try {
			totalTimer = setTimeout(() => stop(new Error(`deck.gl browser exceeded 45000ms during ${phase}`)), 45000);
			await Promise.race([run(), failure]);
		}
		catch (error) { report.status = 'failed'; report.error = `${phase}: ${error.message}`; throw error; }
		finally {
			clearTimeout(totalTimer);
			clearTimeout(sampleTimer);
			process.removeListener('SIGINT', interrupted);
			process.removeListener('SIGTERM', interrupted);
			client?.close();
			try { if (browser?.pid) killBenchmarkBrowser(browser); }
			catch (error) { report.killError = error.stack; }
			if (browser && browser.exitCode === null && browser.signalCode === null)
				await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(1000)]);
			server?.closeAllConnections();
			if (server?.listening) await new Promise(resolve => server.close(resolve));
			if (profile) await rm(profile, {recursive: true, force: true});
			if (report.status === 'failed') report.browserLog = log;
			await writeFile(join(cache, 'deckgl-browser-report.json'), JSON.stringify(report) + '\n');
			console.log('deck.gl browser:', JSON.stringify(report));
		}
		assert.equal(report.killError, undefined, 'Browser process cleanup failed');
		if (report.status === 'hardware-unavailable') this.skip();
	});
});
