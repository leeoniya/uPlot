import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as bokeh from '../../bench/bokeh.mjs';
import * as d3fc from '../../bench/d3fc.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const adapters = {bokeh, d3fc};

function bokehMock() {
	class Model {
		constructor(options = {}) { Object.assign(this, options); }
	}
	const renderers = [], layouts = [], tools = [];
	let finish, fail, target;
	const plot = new Model();
	Object.assign(plot, {
		yaxis: {},
		line(options) { const renderer = new Model(options); renderers.push(renderer); return renderer; },
		add_layout(axis, side) { layouts.push({axis, side}); },
		add_tools(tool) { tools.push(tool); },
	});
	const gl = {};
	const view = {
		model: plot, canvas_view: {webgl: {canvas: {getContext: () => gl}}}, renderer_views: new Map(),
		remove() { this.is_destroyed = true; this.removes = (this.removes || 0) + 1; },
	};
	const doc = {
		clear() { this.cleared = true; plot.document = null; view.remove(); },
		views_manager: {clear() { this.cleared = true; }},
	};
	const Bokeh = {
		documents: [],
		...Object.fromEntries(['ColumnDataSource', 'DataRange1d', 'LinearAxis', 'PrintfTickFormatter', 'HoverTool'].map(name => [name, Model])),
		Plotting: {
			figure(options) { Object.assign(plot, options); return plot; },
			show(model, host) {
				assert.equal(model, plot);
				target = host;
				plot.document = doc;
				Bokeh.documents.push(doc);
				for (const renderer of renderers) view.renderer_views.set(renderer, {has_webgl: true});
				return new Promise((resolve, reject) => { finish = () => resolve(view); fail = reject; });
			},
		},
	};
	return {Bokeh, plot, view, doc, renderers, layouts, tools, finish: () => finish(), fail: error => fail(error), target: () => target};
}

function d3fcMock() {
	const state = {axes: [], scales: [], series: [], draws: [], nodes: [], events: [], extensions: true};
	const gl = {
		NO_ERROR: 0, COLOR_BUFFER_BIT: 16384, drawingBufferWidth: 3540, drawingBufferHeight: 1000,
		getExtension(name) {
			if (name === 'ANGLE_instanced_arrays') return state.extensions ? {} : null;
			if (name === 'WEBGL_lose_context') return {loseContext() { state.lost = true; }};
		},
		viewport(...args) { state.viewport = args; }, clearColor() {}, clear() {},
		flush() { assert.equal(state.draws.length, 3); state.flushed = true; },
		isContextLost: () => false,
		getError: () => state.error || 0,
	};
	function node(tag) {
		const value = {tag, style: {}, attrs: {}, children: [], handlers: {},
			append(child) { this.children.push(child); },
			remove() { this.removed = true; },
			getContext(type) { assert.equal(type, 'webgl'); return gl; },
		};
		state.nodes.push(value);
		return value;
	}
	function selection(element) {
		const result = {
			append(tag) { const child = node(tag); element.append(child); return selection(child); },
			attr(key, value) { element.attrs[key] = value; return result; },
			style(key, value) { element.style[key] = value; return result; },
			text(value) { element.text = value; return result; },
			call(fn) { fn(result); return result; },
			select(tag) { return selection(element.children.find(child => child.tag === tag) || node(tag)); },
			selectAll() { return result; }, data() { return result; }, join(tag) { return result.append(tag); },
			remove() { element.remove(); return result; }, node: () => element,
			on(name, handler) { element.handlers[name] = handler; state.events.push({name, handler}); return result; },
		};
		return result;
	}
	function scale(type) {
		let domain = [0, 1], range = [0, 1];
		const fn = value => range[0] + (value - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
		fn.domain = function(value) { if (!arguments.length) return domain; domain = value; return fn; };
		fn.range = function(value) { if (!arguments.length) return range; range = value; return fn; };
		fn.nice = () => { fn.niced = true; return fn; };
		fn.copy = () => scale(type).domain(domain).range(range);
		fn.type = type;
		state.scales.push(fn);
		return fn;
	}
	function axis(side, scale) {
		const fn = () => { state.axes.push(fn); };
		Object.assign(fn, {side, scale});
		for (const key of ['ticks', 'tickSize', 'tickFormat']) fn[key] = value => { fn[key + 'Value'] = value; return fn; };
		return fn;
	}
	const d3 = {
		select: selection, scaleTime: () => scale('time'), scaleLinear: () => scale('linear'),
		min: values => values.reduce((a, b) => Math.min(a, b), Infinity),
		max: values => values.reduce((a, b) => Math.max(a, b), -Infinity),
		extent: values => [d3.min(values), d3.max(values)],
		axisLeft: scale => axis('left', scale), axisRight: scale => axis('right', scale), axisBottom: scale => axis('bottom', scale),
		color: name => ({red: {r: 255, g: 0, b: 0}, blue: {r: 0, g: 0, b: 255}, green: {r: 0, g: 128, b: 0}}[name]),
	};
	const fc = {
		webglScaleLinear: () => scale('webgl'),
		webglStrokeColor() { const stroke = () => {}; stroke.value = value => { stroke.color = value; return stroke; }; return stroke; },
		seriesWebglLine() {
			const config = {};
			const series = data => {
				assert.notEqual(state.wait.textContent, 'Done!');
				if (state.drawFailure) throw state.drawFailure;
				state.draws.push({data, config});
			};
			for (const key of ['context', 'pixelRatio', 'lineWidth', 'xScale', 'yScale', 'scaleMapper', 'crossValue', 'mainValue', 'equals', 'decorate'])
				series[key] = value => { config[key] = value; return series; };
			state.series.push(config);
			return series;
		},
	};
	const host = node('host');
	host.ownerDocument = {createElement: node};
	Object.freeze(host.style);
	return {d3, fc, host, state, gl};
}

describe('benchmark WebGL adapters', () => {
	const saved = new Map();
	beforeEach(() => {
		for (const key of ['Bokeh', 'd3', 'fc', 'devicePixelRatio']) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const [name, adapter] of Object.entries(adapters)) {
		it(`${name}: retains every exact benchmark value in independent Float64 columns`, () => {
			assert.deepEqual(Object.keys(adapter), ['destroyChart', 'makeChart', 'makeChartWithOptions', 'prepData']);
			assert.equal(packed[0], 7);
			const before = packed.slice();
			const data = adapter.prepData(packed);
			const second = adapter.prepData(packed);
			for (const key of ['x', 'cpu', 'ram', 'tcp']) {
				assert.ok(data[key] instanceof Float64Array);
				assert.equal(data[key].length, 55550);
				assert.notEqual(data[key].buffer, second[key].buffer);
			}
			for (let j = 0, i = 8; i < packed.length; j++, i += 7) {
				assert.equal(data.x[j], packed[i] * 60000);
				assert.equal(data.cpu[j], Math.round((100 - packed[i + 1]) * 1000) / 1000);
				assert.equal(data.ram[j], Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100);
				assert.equal(data.tcp[j], packed[i + 3]);
			}
			assert.deepEqual(packed, before);
		});

		it(`${name}: preserves irregular timestamps rather than reconstructing an interval`, () => {
			const irregular = packed.slice(0, 8 + 3 * 7);
			irregular[8 + 2 * 7] += 9;
			const {x} = adapter.prepData(Object.freeze(irregular));
			assert.equal(x[1] - x[0], 60000);
			assert.equal(x[2] - x[1], 600000);
		});
	}

	it('Bokeh: waits for show, uses automatic calendar/dual axes, and removes its document and views', async () => {
		const mock = bokehMock();
		globalThis.Bokeh = mock.Bokeh;
		const host = Object.freeze({style: Object.freeze({width: '1920px', height: '600px'})});
		const data = bokeh.prepData(packed), before = structuredClone(data), wait = {textContent: 'Rendering...'};
		const pending = bokeh.makeChart(data, host, wait);
		let done = false;
		pending.then(() => { done = true; });
		await Promise.resolve();
		assert.equal(done, false);
		assert.equal(wait.textContent, 'Rendering...');
		assert.equal(mock.target(), host);
		const {plot, renderers} = mock;
		assert.equal(plot.width, 1920);
		assert.equal(plot.height, 600);
		assert.equal(plot.output_backend, 'webgl');
		assert.equal(plot.x_axis_type, 'datetime');
		assert.equal(plot.x_range, undefined);
		assert.equal(plot.lod_threshold, null);
		assert.equal(plot.y_range.start, undefined);
		assert.equal(plot.extra_y_ranges.mb.end, undefined);
		assert.deepEqual(plot.y_range.renderers, renderers.slice(0, 2));
		assert.deepEqual(plot.extra_y_ranges.mb.renderers, renderers.slice(2));
		assert.deepEqual(renderers.map(r => r.y_range_name), ['default', 'default', 'mb']);
		assert.equal(mock.layouts[0].side, 'right');
		assert.equal(mock.layouts[0].axis.y_range_name, 'mb');
		for (const renderer of renderers) {
			assert.equal(renderer.source.data, data);
			assert.equal(renderer.line_width, 0.5);
			assert.deepEqual(renderer.x, {field: 'x'});
		}
		assert.equal(mock.tools[0].mode, 'vline');
		mock.finish();
		assert.equal(await pending, mock.view);
		assert.equal(wait.textContent, 'Done!');
		assert.deepEqual(mock.view.getWebGLContexts(), [mock.view.canvas_view.webgl.canvas.getContext('webgl')]);
		assert.deepEqual(data, before);
		bokeh.destroyChart(mock.view);
		bokeh.destroyChart(mock.view);
		assert.equal(mock.view.removes, 1);
		assert.deepEqual(mock.view.getWebGLContexts(), []);
		assert.equal(mock.doc.cleared, true);
		assert.equal(mock.doc.views_manager.cleared, true);
		assert.deepEqual(mock.Bokeh.documents, []);
	});

	for (const failure of ['canvas', 'glyph', 'show']) {
		it(`Bokeh: rejects ${failure} failure and cleans up without reporting Done`, async () => {
			const mock = bokehMock();
			globalThis.Bokeh = mock.Bokeh;
			const wait = {textContent: 'Rendering...'};
			const pending = bokeh.makeChart(bokeh.prepData(packed), {}, wait);
			if (failure === 'canvas') mock.view.canvas_view.webgl = null;
			if (failure === 'glyph') mock.view.renderer_views.get(mock.renderers[0]).has_webgl = false;
			if (failure === 'show') mock.fail(new Error('show failed'));
			else mock.finish();
			await assert.rejects(pending, /fallback|show failed/);
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(mock.doc.cleared, true);
			assert.deepEqual(mock.Bokeh.documents, []);
		});
	}

	it('d3fc: submits all columns, projects precise coordinates, generates axes, and cleans up', async () => {
		const mock = d3fcMock();
		Object.assign(globalThis, {d3: mock.d3, fc: mock.fc});
		const {state, host} = mock;
		state.wait = {textContent: 'Rendering...'};
		const data = d3fc.prepData(packed), before = structuredClone(data);
		const chart = await d3fc.makeChart(data, host, state.wait);
		assert.equal(state.flushed, true);
		assert.deepEqual(chart.getWebGLContexts(), [mock.gl]);
		assert.equal(state.wait.textContent, 'Done!');
		assert.deepEqual(state.viewport, [0, 0, 3540, 1000]);
		assert.equal(chart.element.style.width, '1920px');
		assert.equal(chart.element.style.height, '600px');
		const xAxis = state.axes.find(axis => axis.side === 'bottom');
		assert.equal(xAxis.scale.type, 'time');
		assert.equal(xAxis.ticksValue, 12);
		assert.equal(xAxis.tickFormatValue, undefined, 'D3 chooses calendar labels');
		assert.equal(state.axes.find(axis => axis.side === 'right').tickFormatValue(3), '3 MB');
		for (let i = 0; i < 3; i++) {
			const {config, data: column} = state.draws[i];
			assert.equal(column, [data.cpu, data.ram, data.tcp][i]);
			assert.equal(column.length, 55550);
			assert.equal(config.xScale, xAxis.scale);
			assert.equal(config.pixelRatio, 2);
			assert.equal(config.lineWidth, 0.5);
			assert.equal(config.equals(column, column), true);
			assert.equal(config.equals(column, column.slice()), false);
			for (const j of [0, 12345, 55549]) {
				assert.equal(config.crossValue(column[j], j), data.x[j]);
				assert.equal(config.mainValue(column[j]), column[j]);
			}
			const mapped = config.scaleMapper(config.xScale);
			assert.deepEqual(mapped.webglScale.domain(), [0, 1770]);
			assert.equal(mapped.scale(data.x[0]), 0);
			assert.equal(mapped.scale(data.x.at(-1)), 1770);
			assert.ok(Math.fround(mapped.scale(data.x[1])) > Math.fround(mapped.scale(data.x[0])));
		}
		assert.equal(state.series[0].yScale, state.series[1].yScale);
		assert.notEqual(state.series[0].yScale, state.series[2].yScale);
		assert.deepEqual(data, before);
		d3fc.destroyChart(chart);
		d3fc.destroyChart(chart);
		assert.equal(state.lost, true);
		assert.deepEqual(chart.getWebGLContexts(), []);
		assert.ok(state.series.every(config => config.context === null));
		assert.equal(chart.element.removed, true);
		assert.ok(state.events.some(event => event.name === '.benchmark' && event.handler === null));
		assert.deepEqual(host.style, {});
	});

	for (const failure of ['extensions', 'draw', 'error']) {
		it(`d3fc: rejects ${failure} failure and releases its context`, async () => {
			const mock = d3fcMock();
			Object.assign(globalThis, {d3: mock.d3, fc: mock.fc});
			mock.state.wait = {textContent: 'Rendering...'};
			if (failure === 'extensions') mock.state.extensions = false;
			if (failure === 'draw') mock.state.drawFailure = new Error('draw failed');
			if (failure === 'error') mock.state.error = 1282;
			await assert.rejects(d3fc.makeChart(d3fc.prepData(packed), mock.host, mock.state.wait), /requires WebGL|draw failed/);
			assert.equal(mock.state.wait.textContent, 'Rendering...');
			assert.equal(mock.state.lost, true);
			assert.equal(mock.host.children[0].removed, true);
		});
	}

	it('standalone pages delegate loading, fixture setup, and rendering to runDemo', () => {
		for (const [name, page] of [['bokeh', 'Bokeh.html'], ['d3fc', 'd3fc.html']]) {
			const html = readFileSync(new URL(`../../bench/${page}`, import.meta.url), 'utf8');
			assert.ok(html.includes("import {runDemo} from './demo.mjs'"));
			assert.ok(html.includes(`runDemo('${name}').catch(console.error)`));
			assert.doesNotMatch(html, /<script src=|https?:|fetch\(|prepData|makeChart|style=|id="wait"/);
			const source = readFileSync(new URL(`../../bench/${name}.mjs`, import.meta.url), 'utf8');
			assert.doesNotMatch(source, /setTimeout|requestAnimationFrame|innerHTML|host\.style/);
		}
	});
});

// Opt-in: BENCH_WEBGL_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/bench-webgl-adapters.mjs
// Uses the existing Chrome 156 binary, temporary profiles, and in-memory assets/manifest entries.
// Readbacks and draw instrumentation are smoke assertions, not benchmark measurements.
(process.env.BENCH_WEBGL_BROWSER === '1' ? describe : describe.skip)('Chrome 156 WebGL adapter smoke', function() {
	this.timeout(90000);
	let browser, page, child, server, profile, base, fs, delay;
	let browserLog = '';

	async function evaluate(expression) {
		const result = await page.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		return result.result.value;
	}

	before(async () => {
		fs = await import('node:fs/promises');
		const {createServer} = await import('node:http');
		const {spawn} = await import('node:child_process');
		const {resolve} = await import('node:path');
		const {tmpdir} = await import('node:os');
		({setTimeout: delay} = await import('node:timers/promises'));
		const {CDP} = await import('../../scripts/profile-manual.mjs');
		const root = new URL('../../', import.meta.url);
		const pins = {
			bokeh: ['@bokeh/bokehjs@3.10.1/build/js/bokeh.min.js', '@bokeh/bokehjs@3.10.1/build/js/bokeh-gl.min.js', '@bokeh/bokehjs@3.10.1/build/js/bokeh-api.min.js'],
			d3fc: ['d3@7.9.0/dist/d3.min.js', 'd3fc@15.2.13/build/d3fc.min.js'],
		};
		const assets = new Map();
		await Promise.all(Object.values(pins).flat().map(async path => {
			const response = await fetch('https://cdn.jsdelivr.net/npm/' + path, {signal: AbortSignal.timeout(30000)});
			assert.equal(response.status, 200, path);
			assets.set('/assets/' + path, Buffer.from(await response.arrayBuffer()));
		}));
		const registrations = Object.fromEntries(Object.entries(pins).map(([variant, paths]) => [variant, paths.map(path => ({url: '/assets/' + path}))]));
		server = createServer(async (request, response) => {
			try {
				const path = new URL(request.url, 'http://localhost').pathname;
				let body;
				if (assets.has(path)) body = assets.get(path);
				else if (path === '/') body = '<!doctype html><html><body></body></html>';
				else {
					const url = new URL('.' + path, root);
					if (!url.href.startsWith(root.href)) throw new Error('Invalid path');
					body = await fs.readFile(url);
					if (path === '/bench/demo-dependencies.mjs')
						body = body.toString() + '\nObject.assign(demoDependencies, ' + JSON.stringify(registrations) + ');\n';
				}
				response.setHeader('Content-Type', path === '/' || path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.end(body);
			}
			catch (error) { response.writeHead(404); response.end(String(error)); }
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		base = 'http://127.0.0.1:' + server.address().port;
		profile = await fs.mkdtemp(resolve(tmpdir(), 'uplot-webgl-smoke-'));
		const binary = process.env.CHROME_BIN || new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root).pathname;
		child = spawn(binary, ['--enable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--user-data-dir=' + profile, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
		child.stderr.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
		let spawnError;
		child.on('error', error => { spawnError = error; });
		let portData;
		for (let i = 0; i < 200; i++) {
			if (spawnError) throw spawnError;
			try { portData = await fs.readFile(profile + '/DevToolsActivePort', 'utf8'); break; }
			catch { await delay(50); }
		}
		assert.ok(portData, browserLog);
		async function connect(url) {
			const socket = new WebSocket(url);
			const client = new CDP(socket, 60000);
			await new Promise((resolve, reject) => {
				socket.addEventListener('open', resolve, {once: true});
				socket.addEventListener('error', reject, {once: true});
			});
			return client;
		}
		const [port, path] = portData.trim().split('\n');
		browser = await connect('ws://127.0.0.1:' + port + path);
		const version = await browser.send('Browser.getVersion');
		assert.match(version.product, /Chrome\/156\./);
		const {gpu} = await browser.send('SystemInfo.getInfo');
		console.log('Browser/GPU:', JSON.stringify({browser: version.product, devices: gpu.devices, webgl: gpu.featureStatus.webgl}));
		const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
		page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
		await page.send('Page.enable');
		await page.send('Runtime.enable');
		function instrument() {
			window.smoke = {contexts: [], errors: []};
			addEventListener('error', event => smoke.errors.push(event.message));
			addEventListener('unhandledrejection', event => smoke.errors.push(String(event.reason)));
			const original = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function(type, ...args) {
				const gl = original.call(this, type, ...args);
				if (gl && ['webgl', 'webgl2', 'experimental-webgl'].includes(type) && !smoke.contexts.some(record => record.gl === gl)) {
					const record = {gl, type, draws: 0, instances: []};
					smoke.contexts.push(record);
					for (const name of ['drawArrays', 'drawElements']) {
						const draw = gl[name];
						gl[name] = function(...args) { record.draws++; return draw.apply(this, args); };
					}
					const getExtension = gl.getExtension, seen = new WeakSet();
					gl.getExtension = function(name) {
						const extension = getExtension.call(this, name);
						// regl requests lowercase extension names; d3fc uses uppercase.
						if (extension && name.toLowerCase() === 'angle_instanced_arrays' && !seen.has(extension)) {
							seen.add(extension);
							for (const method of ['drawArraysInstancedANGLE', 'drawElementsInstancedANGLE']) {
								const draw = extension[method];
								extension[method] = function(...args) { record.draws++; record.instances.push(args.at(-1)); return draw.apply(this, args); };
							}
						}
						return extension;
					};
				}
				return gl;
			};
		}
		await page.send('Page.addScriptToEvaluateOnNewDocument', {source: '(' + instrument.toString() + ')()'});
	});

	after(async () => {
		page?.close();
		if (browser) {
			try { await browser.send('Browser.close'); } catch {}
			browser.close();
		}
		if (child && child.exitCode === null) {
			child.kill('SIGTERM');
			for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(50);
			if (child.exitCode === null) child.kill('SIGKILL');
		}
		if (server) await new Promise(resolve => server.close(resolve));
		if (profile) await fs.rm(profile, {recursive: true, force: true});
	});

	async function navigate(path, dpr) {
		await page.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: dpr, mobile: false});
		const url = base + path;
		await page.send('Page.navigate', {url});
		for (let i = 0; i < 500; i++) {
			if (await evaluate('location.href === ' + JSON.stringify(url) + ' && document.readyState === "complete"')) return;
			await delay(20);
		}
		throw new Error('Navigation did not complete');
	}

	for (const dpr of [1, 2]) for (const variant of ['bokeh', 'd3fc']) {
		it(`${variant} DPR ${dpr}: three real GL samples with full data, axes, readiness, and cleanup`, async () => {
			await navigate('/?variant=' + variant + '&dpr=' + dpr, dpr);
			async function run(variant) {
				const {runDemo} = await import('/bench/demo.mjs');
				const adapter = await import('/bench/' + variant + '.mjs');
				const {createWebGLCapture} = await import('/scripts/bench-webgl.mjs');
				const capture = createWebGLCapture();
				const packed = Object.freeze(await (await fetch('/bench/data.json')).json());
				const results = [];
				let previousGL;
				function check(value, message) { if (!value) throw new Error(message); }
				for (let sample = 0; sample < 3; sample++) {
					const previousDraws = smoke.contexts.reduce((sum, record) => sum + record.draws, 0);
					capture.begin();
					let chart, host, data;
					if (sample === 0) {
						chart = await runDemo(variant);
						host = document.querySelector('#benchmark-' + variant);
					}
					else {
						host = document.createElement('div');
						host.style.width = '1920px'; host.style.height = '600px'; document.body.append(host);
						data = adapter.prepData(packed);
						chart = await adapter.makeChart(data, host);
					}
					smoke.chart = chart;
					const [gl] = chart.getWebGLContexts();
					const record = smoke.contexts.find(record => record.gl === gl);
					const drawCount = smoke.contexts.reduce((sum, record) => sum + record.draws, 0) - previousDraws;
					check(drawCount > 0, 'No real GL draws before adapter readiness');
					check(!gl.isContextLost(), 'Context lost before cleanup');
					const debug = gl.getExtension('WEBGL_debug_renderer_info');
					const result = {variant, dpr: devicePixelRatio, sample, drawCount, contextId: smoke.contexts.indexOf(record), reused: gl === previousGL,
						version: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
						renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
						buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], host: [host.clientWidth, host.clientHeight]};
					check(result.host[0] === 1920 && result.host[1] === 600, 'Wrong host size');
					if (variant === 'bokeh') {
						const renderers = chart.model.renderers.filter(renderer => renderer.glyph);
						data = renderers[0].data_source.data;
						result.ready = {idle: chart.model.document.is_idle, finished: chart.has_finished(), webgl: renderers.map(renderer => chart.renderer_views.get(renderer).has_webgl)};
						check(result.ready.idle && result.ready.finished && result.ready.webgl.every(Boolean), 'Bokeh readiness or fallback');
						result.ranges = {x: [chart.model.x_range.start, chart.model.x_range.end], pct: [chart.model.y_range.start, chart.model.y_range.end], mb: [chart.model.extra_y_ranges.mb.start, chart.model.extra_y_ranges.mb.end]};
						result.timeAxis = chart.model.xaxes.map(axis => [axis.type, axis.ticker.type, axis.formatter.type]);
						check(result.timeAxis[0].join(',') === 'DatetimeAxis,DatetimeTicker,DatetimeTickFormatter', 'Wrong Bokeh calendar axis');
						check(chart.model.y_range.renderers.length === 2 && chart.model.extra_y_ranges.mb.renderers[0] === renderers[2], 'Incorrect Bokeh dual ranges');
						const canvas = chart.canvas_view.primary.canvas;
						const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
						const colors = [0, 0, 0];
						for (let i = 0; i < pixels.length; i += 4) {
							const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
							if (r > 100 && r > g * 1.5 && r > b * 1.5) colors[0]++;
							if (b > 100 && b > r * 1.5 && b > g * 1.5) colors[1]++;
							if (g > 40 && g > r * 1.5 && g > b * 1.5) colors[2]++;
						}
						result.seriesPixels = colors;
						check(colors.every(count => count > 100), 'Missing rendered Bokeh series');
						if (sample > 0) check(result.reused, 'Bokeh did not reuse shared context');
					}
					else {
						const series = chart.series;
						if (!data) {
							data = adapter.prepData(packed);
							const dots = host.querySelectorAll('circle');
							for (let i = 0; i < 3; i++) data[['cpu', 'ram', 'tcp'][i]] = dots[i].__data__;
						}
						result.ranges = {x: series[0].xScale().domain().map(Number), pct: series[0].yScale().domain(), mb: series[2].yScale().domain()};
						check(series[0].yScale() === series[1].yScale() && series[0].yScale() !== series[2].yScale(), 'Incorrect dual axes');
						const groups = host.querySelector('svg').children[2].children;
						const ticks = Array.from(groups[1].querySelectorAll('.tick'), tick => tick.__data__);
						check(ticks.length > 2 && ticks.every(tick => tick instanceof Date && tick.getHours() === 0), 'Non-calendar time ticks');
						result.timeLabels = Array.from(groups[1].querySelectorAll('.tick text'), text => text.textContent);
						check(groups[2].textContent.includes('%') && groups[3].textContent.includes('MB'), 'Missing axis units');
						result.instances = record.instances.slice(-3);
						check(result.instances.every(count => count === 55549), 'Dropped d3fc samples');
						check(result.ranges.x[0] === data.x[0] && result.ranges.x[1] === data.x.at(-1), 'Wrong time range');
					}
					for (const key of ['x', 'cpu', 'ram', 'tcp']) check(data[key] instanceof Float64Array && data[key].length === 55550, 'Wrong column ' + key);
					for (let j = 0, i = 8; i < packed.length; j++, i += 7) {
						check(data.x[j] === packed[i] * 60000, 'Changed timestamp');
						check(data.cpu[j] === Math.round((100 - packed[i + 1]) * 1000) / 1000, 'Changed CPU');
						check(data.ram[j] === Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100, 'Changed RAM');
						check(data.tcp[j] === packed[i + 3], 'Changed TCP');
					}
					result.allValuesExact = true;
					for (const [key, range] of [['cpu', result.ranges.pct], ['ram', result.ranges.pct], ['tcp', result.ranges.mb]]) {
						check(data[key].every(value => value >= range[0] && value <= range[1]), 'Automatic range clips ' + key);
					}
					check(gl.getError() === 0, 'GL error');
					for (const context of chart.getWebGLContexts()) capture.track(context);
					const completion = await capture.complete();
					result.capture = completion.contexts.map(context => [context.type, context.status]);
					check(completion.contexts.length === 1 && completion.contexts[0].status === 'unsupported-webgl1', 'Incorrect WebGL 1 fence reporting');
					// Readiness/draw assertions above precede settling. Match the harness's
					// frame boundary before teardown, not removal inside ResizeObserver.
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
					adapter.destroyChart(chart); adapter.destroyChart(chart);
					check(chart.getWebGLContexts().length === 0, 'Destroyed chart exposed contexts');
					result.cleanup = {hostChildren: host.childElementCount, contextLost: gl.isContextLost()};
					check(host.childElementCount === 0, 'Host not empty after cleanup');
					if (variant === 'bokeh') {
						Object.assign(result.cleanup, {destroyed: chart.is_destroyed, documents: Bokeh.documents.length, indexRoots: Bokeh.index.roots.length});
						check(chart.is_destroyed && !gl.isContextLost() && Bokeh.documents.length === 0 && Bokeh.index.roots.length === 0, 'Bokeh cleanup failed');
					}
					else check(gl.isContextLost() && chart.context === null && chart.series.length === 0, 'd3fc cleanup failed');
					previousGL = gl; host.remove(); results.push(result);
				}
				capture.dispose();
				check(smoke.errors.length === 0, smoke.errors.join('\n'));
				return results;
			}
			const results = await evaluate('(' + run.toString() + ')(' + JSON.stringify(variant) + ')');
			for (const result of results) console.log('WebGL smoke:', JSON.stringify(result));
		});

		it(`${variant} DPR ${dpr}: minimal HTML wrapper reaches Done with real draws`, async () => {
			await navigate('/bench/' + (variant === 'bokeh' ? 'Bokeh.html' : 'd3fc.html') + '?dpr=' + dpr, dpr);
			let status;
			for (let i = 0; i < 1000; i++) {
				status = await evaluate('document.querySelector("#wait")?.textContent');
				if (status === 'Done!' || status?.startsWith('Error:')) break;
				await delay(20);
			}
			assert.equal(status, 'Done!');
			assert.ok(await evaluate('smoke.contexts.some(record => record.draws > 0)'));
			assert.deepEqual(await evaluate('smoke.errors'), []);
		});

		it(`${variant} DPR ${dpr}: unavailable WebGL rejects rather than reporting a fallback as Done`, async () => {
			await navigate('/?no-webgl=' + variant + '&dpr=' + dpr, dpr);
			async function run(variant) {
				const original = HTMLCanvasElement.prototype.getContext;
				HTMLCanvasElement.prototype.getContext = function(type, ...args) {
					return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : original.call(this, type, ...args);
				};
				let error;
				try {
					const {runDemo} = await import('/bench/demo.mjs');
					await runDemo(variant);
				}
				catch (failure) { error = failure.message; }
				finally { HTMLCanvasElement.prototype.getContext = original; }
				return {error, wait: document.querySelector('#wait').textContent,
					hostChildren: document.querySelector('#benchmark-' + variant).childElementCount,
					documents: globalThis.Bokeh?.documents.length, indexRoots: globalThis.Bokeh?.index.roots.length};
			}
			const result = await evaluate('(' + run.toString() + ')(' + JSON.stringify(variant) + ')');
			assert.match(result.error, /requires WebGL/);
			assert.match(result.wait, /^Error:/);
			assert.equal(result.hostChildren, 0);
			if (variant === 'bokeh') {
				assert.equal(result.documents, 0);
				assert.equal(result.indexRoots, 0);
			}
		});
	}
});
