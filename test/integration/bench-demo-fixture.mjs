import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { demos } from '../helpers/bench-demo-evaluator.mjs';
import { demoDependencies, benchmarkVariants, demoRestrictions, benchmarkRestrictions, dependencyUrl, assertDemoAvailable, assertBenchmarkAvailable } from '../../bench/demo-dependencies.mjs';

const root = new URL('../../', import.meta.url);
const extraHtml = {
	'uplot-release': 'uplot-release.html',
	chartgpu: 'ChartGPU.html', deckgl: 'deckgl.html',
	'apexcharts-sampled': 'ApexCharts-Sampled.html', 'amcharts-sampled': 'amCharts-Sampled.html',
	'devextreme-sampled': 'DevExtreme-Sampled.html', 'anychart-sampled': 'AnyChart-Sampled.html',
	'fusiontime-sampled': 'FusionTime-Sampled.html',
	'd3-minmax': 'd3-minmax.html', 'd3-svg-minmax': 'd3-svg-minmax.html',
	'd3-svg': 'D3-SVG.html', 'plotly-svg': 'Plotly-SVG.html', 'highcharts-svg': 'Highcharts-SVG.html',
	'bokeh-canvas': 'Bokeh-Canvas.html', 'd3fc-canvas': 'd3fc-Canvas.html', 'g2-webgl': 'G2-WebGL.html',
	apexcharts: 'ApexCharts.html', highcharts: 'Highcharts.html', lightweight: 'lightweight-charts.html',
	plotly: 'Plotly.js.html', canvasjs: 'CanvasJS.html', zingchart: 'ZingChart.html',
	amcharts: 'amCharts5.html', lightningchart: 'LightningChart.html',
	bokeh: 'Bokeh.html', d3fc: 'd3fc.html', agcharts: 'AGCharts.html', vega: 'Vega.html', scichart: 'SciChart.html',
		billboard: 'Billboard.html', g2: 'G2.html', syncfusion: 'Syncfusion.html', devextreme: 'DevExtreme.html',
		jscharting: 'JSCharting.html', kendo: 'Kendo.html', anychart: 'AnyChart.html', fusiontime: 'FusionTime.html',
		googlecharts: 'GoogleCharts.html', recharts: 'recharts.html', muicharts: 'muicharts.html',
		financialcharts: 'financialcharts.html', visx: 'visx.html',
};
const allDemos = [...demos, ...Object.keys(demoDependencies)
	.filter(id => id !== 'idle' && !demos.some(([old]) => old === id)).map(id => [id, extraHtml[id]])];

function inBrowserStub(source) {
	execFileSync(process.execPath, ['--input-type=module', '-e', `
		import assert from 'node:assert/strict';
		import {setTimeout as delay} from 'node:timers/promises';
		import {Window} from 'happy-dom';
		const window = new Window();
		globalThis.document = window.document;
		globalThis.devicePixelRatio = 1.5;
		const root = new URL(${JSON.stringify(root.href)});
		const loaded = [];
		async function waitFor(ready, label) {
			const deadline = Date.now() + 2000;
			while (!ready()) {
				assert.ok(Date.now() < deadline, 'Timed out waiting for ' + label);
				await delay(1);
			}
		}
		document.head.append = element => { loaded.push(element); };
		globalThis.fetch = () => assert.fail('unexpected fetch');
		globalThis.requestAnimationFrame = () => assert.fail('unexpected animation');
		globalThis.setTimeout = () => assert.fail('unexpected timer');
		console.time = console.timeEnd = () => {};
		try {
			${source}
		}
		finally {
			await window.happyDOM.abort();
		}
	`], {cwd: root, timeout: 10000, stdio: 'pipe'});
}

describe('shared benchmark demo fixture and standalone boot', () => {
	it('all HTML entry points import the same standalone runner with their own variant', () => {
		for (const [id, file] of allDemos) {
			assert.equal(typeof file, 'string', id);
			const html = readFileSync(new URL('bench/' + file, root), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1, file);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.match(scripts[0][2], /import \{runDemo\} from '\.\/demo\.mjs';/);
			assert.ok(scripts[0][2].includes(`runDemo('${id}').catch(console.error);`), file);
			assert.doesNotMatch(html, /<link\b|<canvas\b|function (?:makeChart|prepData)|fetch\(/);
		}
	});

	it('creates variant-scoped hosts and shares one awaited stylesheet load', () => {
		inBrowserStub(`
			const {applyDemoStyles, setupDemo} = await import(new URL('bench/demo-fixture.mjs', root));
			const {demoDependencies} = await import(new URL('bench/demo-dependencies.mjs', root));
			assert.equal(loaded.length, 0, 'import must not start styles or create DOM');
			assert.equal(document.body.children.length, 0);
			const parent = document.createElement('section');
			parent.classList.add('keep-me', 'flot');
			document.body.append(parent);
			for (const id of Object.keys(demoDependencies)) {
				const selector = {d3: '#plot', 'd3-minmax': '#plot', 'd3-svg': 'svg#plot', 'd3-svg-minmax': 'svg#plot', chartjs: '#chart1', flot: '#placeholder'}[id];
				parent.replaceChildren();
				const host = setupDemo(id, parent);
				assert.equal(host.parentNode, parent);
				assert.equal(parent.children.length, 1);
				assert.deepEqual([...parent.classList].sort(), ['keep-me', 'bench-demo', id].sort());
				if (selector) assert.ok(host.querySelector(selector), id);
				if (id === 'd3' || id === 'd3-minmax' || id === 'd3-svg' || id === 'd3-svg-minmax') {
					if (id === 'd3' || id === 'd3-minmax') assert.ok(host.querySelector('#overlay'));
					else {
						assert.equal(host.querySelector('canvas'), null);
						assert.equal(host.querySelector('svg').getAttribute('width'), '1920');
						assert.equal(host.querySelector('svg').getAttribute('height'), '600');
					}
					for (const selector of ['#cpu-value', '#ram-value', '#tcp-value'])
						assert.ok(host.querySelector(selector), selector);
					assert.equal(host.querySelector('h3').textContent, 'Server Events');
				}
				if (id === 'chartjs') assert.equal(host.className, 'chart-container');
				if (id === 'echarts') assert.equal(host.id, 'chart');
				if (id === 'flot') {
					assert.equal(host.className, 'demo-container');
					assert.equal(host.firstElementChild.className, 'demo-placeholder');
				}
				if (id === 'dygraphs') assert.equal(host.id, 'graphdiv');
				if (id === 'uplot' || id === 'uplot-release' || id === 'idle') assert.equal(host.children.length, 0);
				if (id !== 'uplot-release' && id !== 'd3-svg' && id !== 'd3-minmax' && id !== 'd3-svg-minmax' && ${JSON.stringify(Object.keys(extraHtml))}.includes(id)) {
					assert.equal(host.id, 'benchmark-' + id);
					assert.equal(host.style.width, '1920px');
					assert.equal(host.style.height, '600px');
					assert.equal(host.children.length, 0);
				}
			}
			const before = parent.outerHTML;
			assert.throws(() => setupDemo('unknown', parent), /Unknown demo variant/);
			assert.equal(parent.outerHTML, before);
			let ready = false;
			const first = applyDemoStyles().then(() => { ready = true; });
			const second = applyDemoStyles();
			assert.equal(loaded.length, 1);
			assert.equal(loaded[0].tagName, 'LINK');
			assert.equal(loaded[0].rel, 'stylesheet');
			assert.equal(loaded[0].href, new URL('bench/demo.css', root).href);
			await Promise.resolve();
			assert.equal(ready, false);
			loaded[0].onload();
			await Promise.all([first, second]);
			assert.equal(ready, true);
			await applyDemoStyles();
			assert.equal(loaded.length, 1);
		`);
	});

	it('keeps default runnable variants ordered, including ChartGPU, and excludes restricted adapters and idle', () => {
		assert.deepEqual(benchmarkVariants, [
			'uplot', 'uplot-release', 'd3-minmax', 'scichart', 'chartjs', 'echarts', 'd3-svg-minmax', 'd3',
			'apexcharts-sampled', 'd3fc', 'chartgpu', 'flot', 'apexcharts', 'financialcharts', 'deckgl', 'agcharts',
			'd3fc-canvas', 'bokeh', 'bokeh-canvas', 'visx', 'dygraphs', 'd3-svg', 'anychart-sampled', 'plotly',
			'canvasjs', 'fusiontime-sampled', 'plotly-svg', 'devextreme-sampled', 'highcharts', 'muicharts', 'vega',
			'lightweight', 'billboard', 'g2', 'recharts', 'zingchart', 'anychart', 'highcharts-svg', 'syncfusion',
			'amcharts-sampled', 'amcharts', 'kendo', 'fusiontime', 'devextreme',
		]);
		assert.equal(benchmarkVariants.length, 44);
		assert.equal(new Set(benchmarkVariants.map(id => id.replace(/(?:-(?:sampled|svg|canvas|minmax|release))+$/, ''))).size, 31);
		assert.equal(Object.keys(demoDependencies).length, 49);
		assert.deepEqual(Object.keys(demoRestrictions), ['lightningchart']);
		assert.deepEqual(Object.keys(benchmarkRestrictions), ['g2-webgl', 'googlecharts', 'jscharting']);

		assert.equal(new Set(benchmarkVariants).size, benchmarkVariants.length);
		assert.deepEqual(new Set(benchmarkVariants), new Set(Object.keys(demoDependencies)
			.filter(id => id !== 'idle' && !Object.hasOwn(demoRestrictions, id) && !Object.hasOwn(benchmarkRestrictions, id))));
		for (const check of [assertDemoAvailable, assertBenchmarkAvailable]) {
			for (const id of [...benchmarkVariants, 'idle'])
				assert.doesNotThrow(() => check(id));
			for (const id of ['unknown', 'toString', '__proto__'])
				assert.throws(() => check(id), /Unknown demo variant/);
		}
	});

	it('keeps timeout-prone standalone demos available but rejects benchmark runs', () => {
		for (const id of ['g2-webgl', 'googlecharts']) {
			assert.doesNotThrow(() => assertDemoAvailable(id));
			assert.throws(() => assertBenchmarkAvailable(id), error =>
				error.message === `${id}: ${benchmarkRestrictions[id]}` && /timeouts/.test(error.message));
		}
	});

	it('pins deck.gl after D3 and permits standalone and benchmark selection', () => {
		assert.deepEqual(demoDependencies.deckgl, [
			{name: 'd3', version: '7.9.0', path: 'dist/d3.min.js'},
			{name: 'deck.gl', version: '9.4.0', path: 'dist.min.js'},
		]);
		assert.deepEqual(demoDependencies.deckgl[0], demoDependencies.d3[0]);
		assert.equal(benchmarkVariants[benchmarkVariants.indexOf('financialcharts') + 1], 'deckgl');
		assert.doesNotThrow(() => assertDemoAvailable('deckgl'));
		assert.doesNotThrow(() => assertBenchmarkAvailable('deckgl'));
	});

	it('permits explicit ChartGPU benchmarks without requiring backend flags', () => {
		assert.doesNotThrow(() => assertDemoAvailable('chartgpu'));
		assert.doesNotThrow(() => assertBenchmarkAvailable('chartgpu'));
		assert.equal(benchmarkVariants.includes('chartgpu'), true);
		assert.deepEqual(demoDependencies.chartgpu, [{
			name: 'chartgpu', version: '0.4.0', path: 'index.mjs', type: 'module', global: 'benchmarkChartGPU',
			url: 'https://esm.sh/chartgpu@0.4.0?bundle&target=es2022',
		}]);
	});

	it('requires a nonblank LightningChart license for standalone demos and benchmarks', () => {
		for (const check of [assertDemoAvailable, assertBenchmarkAvailable]) {
			for (const license of [undefined, null, '', '  ', 123, true, {}])
				assert.throws(() => check('lightningchart', {license}), error =>
					error.message.includes(demoRestrictions.lightningchart) && /LIGHTNINGCHART_LICENSE/.test(error.message));
			assert.throws(() => check('lightningchart'), /runtime license key/);
			for (const license of ['test', ' test '])
				assert.doesNotThrow(() => check('lightningchart', Object.freeze({license})));
		}
	});

	it('permits JSCharting standalone but rejects benchmarks regardless of license', () => {
		assert.ok(demoDependencies.jscharting.length > 0);
		assert.equal(Object.hasOwn(demoRestrictions, 'jscharting'), false);
		assert.match(benchmarkRestrictions.jscharting, /3\.4\.0.*retains destroyed charts and window listeners/);
		for (const options of [undefined, {license: 'test'}]) {
			assert.doesNotThrow(() => assertDemoAvailable('jscharting', options));
			assert.throws(() => assertBenchmarkAvailable('jscharting', options), error =>
				error.message === `jscharting: ${benchmarkRestrictions.jscharting}`);
		}
	});

	it('boots JSCharting through the standalone runner despite its benchmark-only restriction', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			const {demoDependencies, dependencyUrl} = await import(new URL('bench/demo-dependencies.mjs', root));
			document.head.append = element => { loaded.push(element); queueMicrotask(() => element.onload()); };
			globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 0); queueMicrotask(callback); };
			let fetches = 0, creates = 0;
			globalThis.fetch = async url => {
				assert.equal(url.href, new URL('bench/data.json', root).href);
				fetches++;
				return {ok: true, json: async () => [7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free', 10, 75, 2, 3, 4, 25, 75]};
			};
			const chart = {};
			globalThis.JSC = {chart(host, options, ready) {
				creates++;
				assert.equal(host, document.getElementById('benchmark-jscharting'));
				assert.deepEqual(options.series.map(series => series.points), [[[600000, 25]], [[600000, 25]], [[600000, 3]]]);
				queueMicrotask(() => ready.call(chart));
				return chart;
			}};
			assert.equal(await runDemo('jscharting'), chart);
			assert.equal(fetches, 1);
			assert.equal(creates, 1);
			assert.equal(document.getElementById('wait').textContent, 'Done!');
			assert.deepEqual(loaded.map(element => element.tagName), ['SCRIPT', 'LINK']);
			assert.equal(loaded[0].src, dependencyUrl(demoDependencies.jscharting[0]));
		`);
	});

	it('resolves local and npm dependencies and gives explicit remote URLs precedence', () => {
		assert.equal(dependencyUrl({path: '../dist/uPlot.min.css'}, new URL('bench/demo.mjs', root)), new URL('dist/uPlot.min.css', root).href);
		assert.equal(dependencyUrl(demoDependencies.d3[0]), 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js');
		for (const dependency of demoDependencies.amcharts) {
			assert.match(dependency.url, /^https:\/\/cdn\.jsdelivr\.net\/gh\/amcharts\/amcharts5-dist@/);
			assert.equal(dependencyUrl(dependency, root), dependency.url);
		}
	});

	it('rejects restricted standalone demos before loading dependencies or fetching data', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			const {demoRestrictions} = await import(new URL('bench/demo-dependencies.mjs', root));
			for (const [id, reason] of Object.entries(demoRestrictions)) {
				document.body.replaceChildren();
				await assert.rejects(runDemo(id), error => error.message.includes(reason));
				assert.equal(loaded.length, 0);
				assert.ok(document.getElementById('wait').textContent.startsWith('Error: ' + id + ': '));
				assert.equal(document.body.children.length, 1);
			}
		`);
	});

	it('prefetches SciChart binaries before data preparation, preserves options, and never loads WASM as scripts', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			const {demoDependencies, dependencyUrl} = await import(new URL('bench/demo-dependencies.mjs', root));
			const binaries = demoDependencies.scichart.filter(dep => dep.type === 'wasm');
			const buffers = binaries.map(() => new ArrayBuffer(8));
			const options = {runtimeLicenseKey: 'test', timeoutMs: 1234};
			globalThis.benchmarkSciChartOptions = options;
			document.head.append = element => { loaded.push(element); queueMicrotask(() => element.onload()); };
			const downloads = [];
			let dataFetches = 0;
			globalThis.fetch = async url => {
				if (url instanceof URL) {
					assert.equal(url.href, new URL('bench/data.json', root).href);
					assert.equal(globalThis.benchmarkSciChartOptions, options);
					binaries.forEach((dep, i) => assert.equal(options[dep.option], buffers[i]));
					dataFetches++;
					return {ok: false, status: 503, statusText: 'test stop before rendering'};
				}
				const index = downloads.length;
				assert.equal(url, dependencyUrl(binaries[index]));
				assert.equal(document.getElementById('wait').textContent, 'Loading lib....');
				downloads.push(url);
				return {ok: true, arrayBuffer: async () => buffers[index]};
			};
			for (let i = 0; i < 2; i++) {
				document.body.replaceChildren();
				await assert.rejects(runDemo('scichart'), /Failed to load data.json: 503 test stop before rendering/);
				assert.equal(document.getElementById('wait').textContent, 'Error: Failed to load data.json: 503 test stop before rendering');
			}
			assert.equal(dataFetches, 2);
			assert.deepEqual(downloads, binaries.map(dep => dependencyUrl(dep)));
			assert.deepEqual(loaded.map(element => element.tagName), ['SCRIPT', 'LINK']);
			assert.equal(loaded[0].src, dependencyUrl(demoDependencies.scichart[0]));
			assert.equal(loaded[1].href, new URL('bench/demo.css', root).href);
			assert.equal(options.runtimeLicenseKey, 'test');
			assert.equal(options.timeoutMs, 1234);
		`);
	});

	it('reports a standalone binary download failure before creating a chart host or fetching data', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			document.head.append = element => { loaded.push(element); queueMicrotask(() => element.onload()); };
			let fetches = 0;
			globalThis.fetch = async url => {
				assert.match(url, /scichart[.]wasm$/);
				fetches++;
				return {ok: false, status: 503, arrayBuffer() { assert.fail('must not read failed body'); }};
			};
			await assert.rejects(runDemo('scichart'), /Failed to load .*scichart[.]wasm: HTTP 503/);
			assert.equal(fetches, 1);
			assert.equal(loaded.length, 1);
			assert.equal(document.body.children.length, 1);
			assert.match(document.getElementById('wait').textContent, /^Error: Failed to load .*HTTP 503$/);
		`);
	});

	it('loads module namespaces before host/data setup without inserting module script tags', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			const {demoDependencies} = await import(new URL('bench/demo-dependencies.mjs', root));
			const {promise, resolve} = Promise.withResolvers();
			globalThis.moduleGate = promise;
			globalThis.moduleStarted = false;
			const url = 'data:text/javascript;base64,' + Buffer.from('globalThis.moduleStarted = true; await globalThis.moduleGate; export const ready = true;').toString('base64');
			demoDependencies.recharts = [{type: 'module', global: 'benchmarkReact', url}];
			document.head.append = element => { loaded.push(element); queueMicrotask(() => element.onload()); };
			let fetches = 0;
			globalThis.fetch = async url => {
				assert.equal(globalThis.benchmarkReact.ready, true);
				assert.ok(document.getElementById('benchmark-recharts'));
				assert.equal(url.href, new URL('bench/data.json', root).href);
				fetches++;
				return {ok: false, status: 503, statusText: 'test stop'};
			};
			const pending = runDemo('recharts');
			const rejected = assert.rejects(pending, /Failed to load data.json: 503 test stop/);
			await waitFor(() => globalThis.moduleStarted, 'module evaluation');
			assert.equal(globalThis.moduleStarted, true);
			assert.equal(document.body.children.length, 1);
			assert.equal(document.getElementById('wait').textContent, 'Loading lib....');
			assert.equal(fetches, 0);
			assert.equal(loaded.length, 0);
			resolve();
			await rejected;
			assert.equal(fetches, 1);
			assert.deepEqual(loaded.map(element => element.tagName), ['LINK']);
			assert.equal(loaded[0].href, new URL('bench/demo.css', root).href);
		`);
	});

	it('reports a module import failure before styles, host creation, or data fetch', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			const {demoDependencies} = await import(new URL('bench/demo-dependencies.mjs', root));
			globalThis.moduleError = new Error('module failed');
			demoDependencies.recharts = [{type: 'module', global: 'benchmarkReact',
				url: 'data:text/javascript;base64,' + Buffer.from('throw globalThis.moduleError; export {};').toString('base64')}];
			await assert.rejects(runDemo('recharts'), error => error === globalThis.moduleError);
			assert.equal(loaded.length, 0);
			assert.equal(document.body.children.length, 1);
			assert.equal(document.getElementById('wait').textContent, 'Error: module failed');
		`);
	});

	it('awaits Google runtime preparation before host/data setup and leaves table construction and draw in the render callback', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			const {promise, resolve} = Promise.withResolvers();
			const order = [], renders = [], deadlines = [], cleared = [];
			globalThis.setTimeout = (callback, ms) => {
				if (ms === 0) { order.push('render-scheduled'); renders.push(callback); }
				else { assert.equal(ms, 30000); deadlines.push(callback); }
				return callback;
			};
			globalThis.clearTimeout = timer => cleared.push(timer);
			document.head.append = element => {
				loaded.push(element);
				queueMicrotask(() => element.onload());
			};
			let finishDraw;
			const rows = [];
			const chart = {draw(table) { order.push('draw'); assert.equal(table.rows, rows); }};
			globalThis.google = {charts: {load(version, options) {
				assert.equal(version, '52');
				assert.deepEqual(options, {packages: ['corechart'], language: 'en'});
				assert.equal(document.getElementById('benchmark-googlecharts'), null);
				assert.equal(document.getElementById('wait').textContent, 'Loading lib....');
				order.push('runtime-load');
				return promise;
			}}};
			globalThis.fetch = async url => {
				order.push('data-fetch');
				assert.equal(url.href, new URL('bench/data.json', root).href);
				assert.ok(document.getElementById('benchmark-googlecharts'));
				return {ok: true, json: async () => {
					order.push('data-json');
					return [7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free', 10, 75, 2, 3, 4, 25, 75];
				}};
			};
			const pending = runDemo('googlecharts');
			await waitFor(() => order.length > 0, 'Google runtime preparation');
			assert.deepEqual(order, ['runtime-load']);
			assert.equal(document.body.children.length, 1);
			assert.equal(renders.length, 0);
			assert.deepEqual(loaded.map(element => element.tagName), ['SCRIPT', 'LINK']);
			assert.equal(loaded[0].src, 'https://www.gstatic.com/charts/loader.js');
			globalThis.google.visualization = {
				DataTable: class {
					constructor() { order.push('table'); this.rows = rows; }
					addColumn() {}
					addRows(data) { rows.push(...data); }
				},
				LineChart: function(host) {
					order.push('chart');
					assert.equal(host, document.getElementById('benchmark-googlecharts'));
					return chart;
				},
				events: {
					addListener(target, name, callback) { assert.equal(target, chart); if (name === 'ready') finishDraw = callback; return name; },
					removeListener() {},
				},
			};
			order.push('runtime-resolved');
			resolve();
			await waitFor(() => renders.length > 0, 'Google render scheduling');
			assert.deepEqual(order, ['runtime-load', 'runtime-resolved', 'data-fetch', 'data-json', 'render-scheduled']);
			assert.deepEqual(cleared, [deadlines[0]]);
			renders.shift()();
			assert.deepEqual(order.slice(-3), ['table', 'chart', 'draw']);
			assert.deepEqual(rows, [[new Date(600000), 25, 25, 3]]);
			assert.equal(document.getElementById('wait').textContent, 'Rendering...');
			finishDraw();
			assert.equal(await pending, chart);
			assert.equal(document.getElementById('wait').textContent, 'Done!');
			assert.deepEqual(cleared, deadlines);
		`);
	});

	it('propagates Google preparation errors before creating a host or fetching data', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			document.head.append = element => { loaded.push(element); queueMicrotask(() => element.onload()); };
			globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 30000); return callback; };
			globalThis.clearTimeout = () => {};
			const error = new Error('corechart unavailable');
			globalThis.google = {charts: {load: () => Promise.reject(error)}};
			await assert.rejects(runDemo('googlecharts'), actual => actual === error);
			assert.equal(document.body.children.length, 1);
			assert.equal(document.getElementById('wait').textContent, 'Error: corechart unavailable');
		`);
	});

	it('rejects a failed shared stylesheet load', () => {
		inBrowserStub(`
			const {applyDemoStyles} = await import(new URL('bench/demo-fixture.mjs', root));
			const pending = applyDemoStyles();
			loaded[0].onerror();
			await assert.rejects(pending, /Failed to load .*demo\\.css/);
		`);
	});

	it('boots the actual uPlot module with ordered local dependencies, prepared data, host, wait, and instance return', () => {
		inBrowserStub(`
			const {runDemo} = await import(new URL('bench/demo.mjs', root));
			assert.equal(document.body.children.length, 0);
			assert.equal(loaded.length, 0);
			const timers = [];
			globalThis.setTimeout = (callback, delay) => {
				assert.equal(delay, 0);
				timers.push(callback);
			};
			const packed = [8, 'epoch', 'idl', 'recv', 'send', 'read', 'writ', 'used', 'free', 10, 75, 2, 3, 4, 25, 75, 0];
			let fetches = 0, creates = 0;
			globalThis.fetch = async url => {
				assert.equal(url.href, new URL('bench/data.json', root).href);
				assert.equal(document.getElementById('wait').textContent, 'Fetching data.json (2.07MB)....');
				fetches++;
				return {ok: true, json: async () => packed};
			};
			const instance = {};
			globalThis.uPlot = function(options, data, host) {
				creates++;
				assert.equal(host.parentNode, document.body);
				assert.notEqual(host, document.body);
				assert.ok(document.body.classList.contains('uplot'));
				assert.deepEqual(data, [[600], [25], [25], [3]]);
				assert.deepEqual(options.cache, {paths: false});
				assert.equal(document.getElementById('wait').textContent, 'Rendering...');
				return instance;
			};
			const pending = runDemo('uplot');
			assert.equal(document.getElementById('wait').textContent, 'Loading lib....');
			for (const [index, tag, route] of [
				[0, 'SCRIPT', 'dist/uPlot.iife.min.js'],
				[1, 'LINK', 'dist/uPlot.min.css'],
				[2, 'LINK', 'bench/demo.css'],
			]) {
				for (let i = 0; loaded.length <= index && i < 100; i++) await Promise.resolve();
				assert.equal(loaded.length, index + 1, 'dependencies must load sequentially');
				assert.equal(loaded[index].tagName, tag);
				assert.equal(loaded[index][tag === 'SCRIPT' ? 'src' : 'href'], new URL(route, root).href);
				assert.equal(fetches, 0);
				loaded[index].onload();
			}
			await waitFor(() => timers.length > 0, 'uPlot render scheduling');
			assert.equal(timers.length, 1);
			assert.equal(creates, 0);
			timers.shift()();
			assert.equal(await pending, instance);
			assert.equal(creates, 1);
			assert.equal(fetches, 1);
			assert.equal(document.getElementById('wait').textContent, 'Done!');

			document.body.replaceChildren();
			assert.equal(await runDemo('idle'), undefined);
			assert.equal(document.getElementById('wait').textContent, 'Done!');
			assert.ok(document.body.classList.contains('idle'));
			assert.equal(document.body.classList.contains('uplot'), false);
			assert.equal(loaded.length, 3, 'shared styles are cached');
			assert.equal(fetches, 1, 'idle must not fetch data');
			assert.equal(timers.length, 0);
			const before = document.body.innerHTML;
			await assert.rejects(runDemo('unknown'), /Unknown demo variant/);
			assert.equal(document.body.innerHTML, before);

			document.body.replaceChildren();
			globalThis.fetch = async () => ({ok: false, status: 503, statusText: 'Unavailable'});
			await assert.rejects(runDemo('uplot'), /Failed to load data.json: 503 Unavailable/);
			assert.equal(document.getElementById('wait').textContent, 'Error: Failed to load data.json: 503 Unavailable');
			assert.equal(loaded.length, 3, 'local dependencies are cached too');
			assert.equal(creates, 1);
		`);
	});
});
