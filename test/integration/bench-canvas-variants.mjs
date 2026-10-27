import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {Window} from 'happy-dom';
import * as bokeh from '../../bench/bokeh.mjs';
import * as bokehCanvas from '../../bench/bokeh-canvas.mjs';
import * as d3fc from '../../bench/d3fc.mjs';
import * as d3fcCanvas from '../../bench/d3fc-canvas.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const colors = ['red', 'blue', 'green'];
const columns = data => [data.cpu, data.ram, data.tcp];

function bokehMock(backend) {
	class Model {
		constructor(options = {}) { Object.assign(this, options); }
	}
	const renderers = [], layouts = [], tools = [], contextRequests = [];
	let finish, fail;
	const plot = Object.assign(new Model(), {
		yaxis: {},
		line(options) { const renderer = new Model(options); renderers.push(renderer); return renderer; },
		add_layout(axis, side) { layouts.push({axis, side}); },
		add_tools(tool) { tools.push(tool); },
	});
	const gl = {};
	const view = {
		model: plot, renderer_views: new Map(),
		canvas_view: backend === 'canvas' ? new Proxy({}, {
			get() { assert.fail('Canvas must not inspect or acquire Bokeh WebGL state'); },
		}) : {webgl: {canvas: {getContext(type) { contextRequests.push(type); return gl; }}}},
		remove() { this.is_destroyed = true; this.removes = (this.removes || 0) + 1; },
	};
	const doc = {
		clear() { this.cleared = true; plot.document = null; view.remove(); },
		views_manager: {clear() { this.cleared = true; }},
	};
	const api = {
		documents: [],
		...Object.fromEntries(['ColumnDataSource', 'DataRange1d', 'LinearAxis', 'PrintfTickFormatter', 'HoverTool'].map(name => [name, Model])),
		Plotting: {
			figure(options) { Object.assign(plot, options); return plot; },
			show(model, host) {
				assert.equal(model, plot);
				plot.host = host;
				plot.document = doc;
				api.documents.push(doc);
				for (const renderer of renderers) view.renderer_views.set(renderer, {has_webgl: backend === 'webgl'});
				return new Promise((resolve, reject) => { finish = () => resolve(view); fail = reject; });
			},
		},
	};
	return {api, plot, view, doc, gl, renderers, layouts, tools, contextRequests, finish: () => finish(), fail: error => fail(error)};
}

function fcMock() {
	const draws = [], series = [];
	function line(renderer) {
		const config = {renderer};
		const fn = data => {
			if (config.renderer === 'canvas') config.decorate(config.context);
			draws.push({data, config});
		};
		for (const key of ['context', 'pixelRatio', 'lineWidth', 'xScale', 'yScale', 'scaleMapper', 'crossValue', 'mainValue', 'equals', 'decorate']) {
			fn[key] = function(value) {
				if (!arguments.length) return config[key];
				config[key] = value;
				return fn;
			};
		}
		series.push(fn);
		return fn;
	}
	return {
		draws, series,
		seriesCanvasLine: () => line('canvas'),
		seriesWebglLine: () => line('webgl'),
		webglScaleLinear: () => ({domain(value) { return value; }}),
		webglStrokeColor() { const stroke = () => {}; stroke.value = () => stroke; return stroke; },
	};
}

function context2d() {
	const paths = [], strokes = [], transforms = [];
	let points;
	return {
		paths, strokes, transforms,
		scale(...args) { transforms.push(args); },
		beginPath() { paths.push(points = []); },
		moveTo(x, y) { points.push(['M', x, y]); },
		lineTo(x, y) { points.push(['L', x, y]); },
		closePath() {}, fill() {},
		stroke() { strokes.push([this.strokeStyle, this.lineWidth]); },
		getExtension() { assert.fail('Canvas teardown must not call WebGL APIs'); },
	};
}

it('adapter DPR mocks preserve the instrumented window accessor', {timeout: 15000}, () => {
	const directory = mkdtempSync(join(tmpdir(), 'uplot-adapter-dpr-'));
	try {
		const fixture = join(directory, 'dpr.test.mjs');
		// Load instrumentation before the adapter suite in the current runtime's shared process.
		writeFileSync(fixture, `
			import ${JSON.stringify(new URL('../../scripts/instrument.mjs', import.meta.url).href)};
			import assert from 'node:assert/strict';
			import {it} from 'node:test';
			import * as dom from ${JSON.stringify(new URL('../../src/dom.js', import.meta.url).href)};
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
			const initial = globalThis.devicePixelRatio;
			assert.equal(typeof descriptor.get, 'function');
			assert.equal(window.devicePixelRatio, initial);
			assert.equal(dom.pxRatio, initial);
			await import(${JSON.stringify(import.meta.url)});
			it('DPR restoration probe', () => {
				assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio'), descriptor);
				assert.equal(globalThis.devicePixelRatio, initial);
				assert.equal(window.devicePixelRatio, initial);
				assert.equal(dom.pxRatio, initial);
			});
		`);
		const result = spawnSync(process.execPath, [
			...(process.versions.bun ? ['test'] : ['--test', '--test-isolation=none']),
			'--test-name-pattern=Bokeh: shares prep and destroy|DPR restoration probe', fixture,
		], {cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 10000,
			env: {...process.env, NODE_OPTIONS: ''}});
		assert.ifError(result.error);
		const output = result.stdout + result.stderr;
		assert.equal(result.status, 0, output);
		assert.match(output, /Bokeh: shares prep and destroy/);
		assert.match(output, /DPR restoration probe/);
	}
	finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

describe('Canvas benchmark variants', function() {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['Bokeh', 'd3', 'fc', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 2});
	}, {timeout: 10000});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}, {timeout: 10000});

	for (const [name, original, canvas] of [['Bokeh', bokeh, bokehCanvas], ['d3fc', d3fc, d3fcCanvas]]) {
		it(`${name}: shares prep and destroy, and retains every input value`, {timeout: 10000}, () => {
			assert.deepEqual(Object.keys(original), ['destroyChart', 'getHoverPlan', 'makeChart', 'makeChartWithOptions', 'makeEmptyChart', 'prepData', 'resizeChart', 'updateChart']);
			assert.deepEqual(Object.keys(canvas), ['destroyChart', 'getHoverPlan', 'makeChart', 'makeEmptyChart', 'prepData', 'resizeChart', 'updateChart']);
			assert.equal(canvas.prepData, original.prepData);
			assert.equal(canvas.destroyChart, original.destroyChart);
			const data = canvas.prepData(packed), second = canvas.prepData(packed);
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
			const irregular = packed.slice(0, 8 + 3 * 7);
			irregular[22] += 9;
			const {x} = canvas.prepData(Object.freeze(irregular));
			assert.equal(x[2] - x[1], 600000);
		});
	}

	for (const [backend, adapter] of [['canvas', bokehCanvas], ['webgl', bokeh]]) {
		it(`Bokeh: ${backend} retains shared configuration, awaits readiness, and destroys without losing shared GL`, {timeout: 10000}, async () => {
			const mock = bokehMock(backend);
			globalThis.Bokeh = mock.api;
			const data = adapter.prepData(packed), before = structuredClone(data);
			const host = Object.freeze({}), wait = {textContent: 'Rendering...'};
			const runtime = Object.freeze({outputBackend: backend === 'canvas' ? 'webgl' : 'canvas', renderer: 'canvas'});
			const pending = adapter.makeChart(data, host, wait, runtime);
			await Promise.resolve();
			assert.equal(wait.textContent, 'Rendering...');
			const {plot, renderers} = mock;
			assert.equal(plot.host, host);
			assert.equal(plot.output_backend, backend);
			assert.equal(plot.width, 1920);
			assert.equal(plot.height, 600);
			assert.equal(plot.x_axis_type, 'datetime');
			assert.equal(plot.x_range, undefined);
			assert.equal(plot.y_range.start, undefined);
			assert.equal(plot.extra_y_ranges.mb.end, undefined);
			assert.equal(plot.lod_threshold, null);
			assert.deepEqual(plot.y_range.renderers, renderers.slice(0, 2));
			assert.deepEqual(plot.extra_y_ranges.mb.renderers, renderers.slice(2));
			assert.equal(plot.yaxis.formatter.format, '%g%%');
			assert.equal(mock.layouts[0].axis.formatter.format, '%g MB');
			assert.equal(mock.layouts[0].side, 'right');
			assert.equal(mock.tools[0].mode, 'vline');
			assert.deepEqual(renderers.map(r => r.line_color), colors);
			assert.deepEqual(renderers.map(r => r.y_range_name), ['default', 'default', 'mb']);
			for (const renderer of renderers) {
				assert.equal(renderer.source.data, data);
				assert.equal(renderer.line_width, 0.5);
			}
			mock.finish();
			const view = await pending;
			assert.equal(wait.textContent, 'Done!');
			assert.deepEqual(view.getWebGLContexts(), backend === 'canvas' ? [] : [mock.gl]);
			assert.deepEqual(mock.contextRequests, backend === 'canvas' ? [] : ['webgl']);
			assert.deepEqual(data, before);
			adapter.destroyChart(view);
			adapter.destroyChart(view);
			assert.equal(view.removes, 1);
			assert.equal(mock.doc.cleared, true);
			assert.equal(mock.doc.views_manager.cleared, true);
			assert.deepEqual(mock.api.documents, []);
			assert.deepEqual(view.getWebGLContexts(), []);
		});
	}

	it('Bokeh Canvas: cleans the document after show rejects without reporting readiness', {timeout: 10000}, async () => {
		const mock = bokehMock('canvas');
		globalThis.Bokeh = mock.api;
		const wait = {textContent: 'Rendering...'};
		const pending = bokehCanvas.makeChart(bokehCanvas.prepData(packed), {}, wait);
		mock.fail(new Error('show failed'));
		await assert.rejects(pending, /show failed/);
		assert.equal(wait.textContent, 'Rendering...');
		assert.equal(mock.doc.cleared, true);
		assert.equal(mock.doc.views_manager.cleared, true);
		assert.deepEqual(mock.api.documents, []);
	});

	it('Bokeh default: still rejects Canvas fallback', {timeout: 10000}, async () => {
		const mock = bokehMock('webgl');
		globalThis.Bokeh = mock.api;
		const pending = bokeh.makeChart(bokeh.prepData(packed), {});
		mock.view.canvas_view.webgl = null;
		mock.finish();
		await assert.rejects(pending, /Canvas fallback is not allowed/);
		assert.deepEqual(mock.api.documents, []);
	});

	it('standalone Canvas pages delegate to the shared runner', {timeout: 10000}, () => {
		for (const [page, id] of [['Bokeh-Canvas', 'bokeh-canvas'], ['d3fc-Canvas', 'd3fc-canvas']]) {
			const html = readFileSync(new URL(`../../bench/${page}.html`, import.meta.url), 'utf8');
			assert.ok(html.includes("import {runDemo} from './demo.mjs'"));
			assert.ok(html.includes(`runDemo('${id}').catch(console.error)`));
			assert.doesNotMatch(html, /<script src=|https?:|fetch\(|prepData|makeChart|style=|id="wait"/);
		}
	});

	const paths = ['d3-7.9.0-dist-d3.min.js', 'd3fc-15.2.13-build-d3fc.min.js']
		.map(name => new URL(`../../.cache/benchmarks/${name}`, import.meta.url));
	describe('d3fc with cached vendors (offline, no browser)', {
		skip: !paths.every(existsSync) && 'd3fc Canvas vendor tests need cached D3 7.9.0 and d3fc 15.2.13; no downloads are attempted.',
	}, function() {
		let window, host, wait, vendor, chart, ctx, requests, originalGetContext;
		beforeEach(() => {
			window = new Window();
			originalGetContext = window.HTMLCanvasElement.prototype.getContext;
			vendor = {
				document: window.document, HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
				customElements: window.customElements,
				requestAnimationFrame() { assert.fail('native line drawing must not queue redraws'); },
			};
			for (const path of paths) runInNewContext(readFileSync(path, 'utf8'), vendor, {displayErrors: false});
			Object.assign(globalThis, {d3: vendor.d3, fc: vendor.fc});
			host = window.document.createElement('div');
			window.document.body.append(host);
			wait = {textContent: 'Rendering...'};
			ctx = context2d();
			requests = [];
			window.HTMLCanvasElement.prototype.getContext = type => {
				requests.push(type);
				assert.equal(type, '2d');
				return ctx;
			};
		}, {timeout: 10000});
		afterEach(async () => {
			try {
				if (chart) d3fc.destroyChart(chart);
			}
			finally {
				chart = null;
				// Happy DOM windows share this prototype with the instrumented demos.
				window.HTMLCanvasElement.prototype.getContext = originalGetContext;
				await window.happyDOM.close();
			}
		}, {timeout: 10000});

		for (const ratio of [1, 1.5, 2]) {
			it(`draws all 55,550 points through native Canvas lines at DPR ${ratio}, with shared axes and cursor`, {timeout: 10000}, async () => {
				globalThis.devicePixelRatio = ratio;
				const data = d3fcCanvas.prepData(packed), before = structuredClone(data);
				// Any accidental use of a WebGL factory must fail, including context capture.
				globalThis.fc = new Proxy(vendor.fc, {get(target, key) {
					assert.doesNotMatch(String(key), /webgl/i);
					return target[key];
				}});
				chart = await d3fcCanvas.makeChart(data, host, wait, Object.freeze({renderer: 'webgl'}));
				assert.equal(wait.textContent, 'Done!');
				assert.deepEqual(requests, ['2d']);
				assert.deepEqual(chart.getWebGLContexts(), []);
				assert.deepEqual(ctx.transforms, [[ratio, ratio]]);
				assert.deepEqual(ctx.strokes, colors.map(color => [color, 1 / ratio]));
				const canvas = host.querySelector('canvas');
				assert.equal(canvas.width, Math.round(1770 * ratio));
				assert.equal(canvas.height, Math.round(500 * ratio));
				assert.equal(canvas.style.width, '1770px');
				assert.equal(canvas.style.height, '500px');
				assert.equal(ctx.paths.length, 3);
				const [x, pct, mb] = [chart.series[0].xScale(), chart.series[0].yScale(), chart.series[2].yScale()];
				assert.equal(chart.series[1].yScale(), pct);
				assert.notEqual(mb, pct);
				assert.deepEqual(Array.from(x.domain(), Number), [data.x[0], data.x.at(-1)]);
				assert.deepEqual(Array.from(pct.domain()), Array.from(vendor.d3.scaleLinear().domain([
					Math.min(vendor.d3.min(data.cpu), vendor.d3.min(data.ram)),
					Math.max(vendor.d3.max(data.cpu), vendor.d3.max(data.ram)),
				]).nice().domain()));
				assert.deepEqual(Array.from(mb.domain()), Array.from(vendor.d3.scaleLinear().domain(vendor.d3.extent(data.tcp)).nice().domain()));
				for (const [i, values] of columns(data).entries()) {
					const scale = [pct, pct, mb][i], path = ctx.paths[i];
					assert.equal(path.length, 55550);
					for (let j = 0; j < values.length; j++)
						assert.deepEqual(path[j], [j === 0 ? 'M' : 'L', x(data.x[j]), scale(values[j])]);
				}
				const svg = host.querySelector('svg');
				const axes = svg.children[2];
				const labels = group => [...group.querySelectorAll('.tick text')].map(node => node.textContent);
				assert.deepEqual(labels(axes.children[1]), Array.from(x.ticks(12), x.tickFormat(12)));
				assert.deepEqual(labels(axes.children[2]), Array.from(pct.ticks(10), value => `${value}%`));
				assert.deepEqual(labels(axes.children[3]), Array.from(mb.ticks(10), value => `${value} MB`));
				const cursor = axes.lastElementChild, j = 12345;
				// happy-dom does not implement SVG coordinate transforms. D3 still
				// performs the conversion for this translated, 2x-scaled SVG.
				svg.createSVGPoint = () => ({x: 0, y: 0, matrixTransform(matrix) {
					return {x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f};
				}});
				svg.getScreenCTM = () => ({inverse: () => ({a: 0.5, d: 0.5, e: -160, f: -50})});
				svg.dispatchEvent(new window.PointerEvent('pointermove', {clientX: (70 + x(data.x[j])) * 2 + 320, clientY: 500}));
				assert.equal(cursor.getAttribute('display'), null);
				assert.equal(+cursor.querySelector('line').getAttribute('x1'), x(data.x[j]));
				assert.deepEqual([...cursor.querySelectorAll('circle')].map(dot => +dot.getAttribute('cy')),
					columns(data).map((values, i) => [pct, pct, mb][i](values[j])));
				assert.deepEqual([...svg.children[1].children].map(node => node.textContent),
					['CPU', 'RAM', 'TCP Out'].map((name, i) => `${name}: ${columns(data)[i][j].toFixed(i === 0 ? 3 : 2)}${i === 2 ? ' MB' : '%'}`));
				svg.dispatchEvent(new window.PointerEvent('pointerleave'));
				assert.equal(cursor.getAttribute('display'), 'none');
				assert.deepEqual(data, before);
				const series = chart.series.slice();
				d3fcCanvas.destroyChart(chart);
				d3fcCanvas.destroyChart(chart);
				assert.equal(host.children.length, 0);
				assert.equal(chart.context, null);
				assert.equal(chart.series.length, 0);
				assert.ok(series.every(line => line.context() === null));
				assert.deepEqual(chart.getWebGLContexts(), []);
				svg.dispatchEvent(new window.PointerEvent('pointermove', {clientX: 100, clientY: 200}));
				assert.equal(cursor.getAttribute('display'), 'none');
				assert.deepEqual(requests, ['2d']);
			});
		}

		it('passes the original columns to the native Canvas series without copies', {timeout: 10000}, async () => {
			const mock = fcMock(), data = d3fcCanvas.prepData(packed);
			globalThis.fc = mock;
			chart = await d3fcCanvas.makeChart(data, host, wait);
			assert.equal(mock.draws.length, 3);
			for (const [i, draw] of mock.draws.entries()) {
				assert.equal(draw.data, columns(data)[i]);
				assert.equal(draw.config.renderer, 'canvas');
				assert.equal(draw.config.context, ctx);
				assert.equal(draw.config.crossValue(draw.data[12345], 12345), data.x[12345]);
				assert.equal(draw.config.mainValue(draw.data[12345]), draw.data[12345]);
			}
		});

		it('keeps original d3fc WebGL, full columns, precision mapping, DPR, and context loss on teardown', {timeout: 10000}, async () => {
			const mock = fcMock(), data = d3fc.prepData(packed), calls = [];
			const gl = {
				NO_ERROR: 0, COLOR_BUFFER_BIT: 16384, drawingBufferWidth: 3540, drawingBufferHeight: 1000,
				getExtension(name) { calls.push(name); return name === 'ANGLE_instanced_arrays' ? {} : {loseContext() { calls.push('lose'); }}; },
				viewport(...args) { calls.push(args); }, clearColor() {}, clear() {},
				flush() { assert.equal(mock.draws.length, 3); calls.push('flush'); },
				isContextLost: () => false, getError: () => 0,
			};
			globalThis.fc = mock;
			window.HTMLCanvasElement.prototype.getContext = type => { assert.equal(type, 'webgl'); return gl; };
			chart = await d3fc.makeChart(data, host, wait, Object.freeze({renderer: 'canvas'}));
			assert.deepEqual(chart.getWebGLContexts(), [gl]);
			assert.equal(wait.textContent, 'Done!');
			for (const [i, draw] of mock.draws.entries()) {
				assert.equal(draw.data, columns(data)[i]);
				assert.equal(draw.config.renderer, 'webgl');
				assert.equal(draw.config.pixelRatio, 2);
				assert.equal(draw.config.lineWidth, 0.5);
				const mapped = draw.config.scaleMapper(draw.config.xScale);
				assert.equal(mapped.scale(data.x[0]), 0);
				assert.equal(mapped.scale(data.x.at(-1)), 1770);
			}
			d3fc.destroyChart(chart);
			d3fc.destroyChart(chart);
			assert.deepEqual(calls, ['ANGLE_instanced_arrays', [0, 0, 3540, 1000], 'flush', 'WEBGL_lose_context', 'lose']);
			assert.ok(mock.series.every(line => line.context() === null));
			assert.deepEqual(chart.getWebGLContexts(), []);
			assert.equal(host.children.length, 0);
		});

		for (const failure of ['context', 'draw']) {
			it(`Canvas ${failure} failure cleans up without readiness or GL calls`, {timeout: 10000}, async () => {
				const series = [];
				if (failure === 'context') window.HTMLCanvasElement.prototype.getContext = type => { assert.equal(type, '2d'); return null; };
				else {
					globalThis.fc = {...vendor.fc, seriesCanvasLine() { const line = vendor.fc.seriesCanvasLine(); series.push(line); return line; }};
					ctx.stroke = () => { throw new Error('draw failed'); };
				}
				await assert.rejects(d3fcCanvas.makeChart(d3fcCanvas.prepData(packed), host, wait), /requires a 2D canvas context|draw failed/);
				assert.equal(host.children.length, 0);
				assert.equal(wait.textContent, 'Rendering...');
				assert.ok(series.every(line => line.context() === null));
			});
		}
	});
});
