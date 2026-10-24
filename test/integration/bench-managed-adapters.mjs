import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as anychart from '../../bench/anychart.mjs';
import * as fusiontime from '../../bench/fusiontime.mjs';
import * as anychartSampled from '../../bench/anychart-sampled.mjs';
import * as fusiontimeSampled from '../../bench/fusiontime-sampled.mjs';
import * as googlecharts from '../../bench/googlecharts.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const adapters = {anychart, fusiontime, googlecharts};
const variants = {...adapters, 'anychart-sampled': anychartSampled, 'fusiontime-sampled': fusiontimeSampled};
const host = Object.freeze({id: 'benchmark-managed', style: Object.freeze({width: '1920px', height: '600px'})});
const turn = () => new Promise(resolve => setImmediate(resolve));

function vendor(id) {
	id = id.replace('-sampled', '');
	const state = {calls: [], listeners: new Map(), disposed: [], error: new Error('vendor failure')};
	const record = name => (...args) => { state.calls.push([name, ...args]); return chart; };
	const chart = state.chart = {
		listenOnce(name, callback) { state.listeners.set(name, callback); },
		unlisten(name) { state.listeners.delete(name); },
		addEventListener(name, callback) { state.listeners.set(name, callback); },
		removeEventListener(name) { state.listeners.delete(name); },
		draw(...args) { state.draw = args; if (state.fail) throw state.error; },
		render() { if (state.fail) throw state.error; },
		dispose() { state.disposed.push('chart'); state.listeners.clear(); if (state.cleanupError) throw state.cleanupError; },
		clearChart() { state.disposed.push('chart'); if (state.cleanupError) throw state.cleanupError; },
	};
	state.emit = (name, ...args) => state.listeners.get(name)?.(...args);
	if (id === 'anychart') {
		state.scales = [];
		state.mappings = [];
		state.lines = [];
		const setting = () => ({
			values: {},
			enabled(value) { this.values.enabled = value; return this; },
			position(value) { this.values.position = value; return this; },
			orientation(value) { this.values.orientation = value; return this; },
			scale(value) { this.values.scale = value; return this; },
			labels() { return this; },
			format(value) { this.values.format = value; return this; },
		});
		state.axes = [setting(), setting()];
		state.legend = setting();
		state.scroller = setting();
		state.grouping = setting();
		state.scrollerGrouping = setting();
		state.groupingCalls = state.scrollerGroupingCalls = 0;
		Object.assign(chart, {
			animation: record('animation'), bounds: record('bounds'), title: record('title'),
			xScale: record('xScale'), container: record('container'),
			scroller: () => state.scroller,
			grouping() { state.groupingCalls++; return state.grouping; },
			scrollerGrouping() { state.scrollerGroupingCalls++; return state.scrollerGrouping; },
			plot(index) {
				assert.equal(index, 0);
				return {
					yScale(scale) { state.plotScale = scale; },
					yAxis: index => state.axes[index],
					legend: () => state.legend,
					line(mapping) {
						const line = {mapping, states: {normal: setting(), hovered: setting(), selected: setting()}};
						for (const key of ['name', 'stroke', 'yScale']) line[key] = value => { line[key + 'Value'] = value; };
						for (const key of Object.keys(line.states)) line[key] = () => ({markers: () => line.states[key]});
						state.lines.push(line);
						return line;
					},
				};
			},
		});
		globalThis.anychart = {
			stock: () => chart,
			scales: {linear() {
				const scale = {dispose() { state.disposed.push('scale'); }};
				state.scales.push(scale);
				return scale;
			}},
			data: {table(index) {
				assert.equal(index, 0);
				return {
					addData(data) { state.rows = data; },
					mapAs(config) {
						const mapping = {config, dispose() { state.disposed.push('mapping'); }};
						state.mappings.push(mapping);
						return mapping;
					},
					dispose() { state.disposed.push('table'); },
				};
			}},
		};
	}
	else if (id === 'fusiontime') {
		globalThis.FusionCharts = function(options) { state.options = options; return chart; };
		globalThis.FusionCharts.DataStore = class {
			createDataTable(rows, schema) { state.rows = rows; state.schema = schema; return state.table = {}; }
			dispose() { state.disposed.push('store'); }
		};
	}
	else {
		globalThis.google = {
			charts: {load(version, options) {
				state.calls.push(['load', version, options]);
				return state.loadPending ?? Promise.resolve();
			}},
			visualization: {
				DataTable: class {
					constructor() { state.table = this; state.columns = []; }
					addColumn(...column) { state.columns.push(column); }
					addRows(rows) { state.rows = rows; }
				},
				LineChart: function(container) { assert.equal(container, host); return chart; },
				events: {
					addListener(target, name, listener) { assert.equal(target, chart); state.listeners.set(name, listener); return name; },
					removeListener(name) { state.listeners.delete(name); },
					removeAllListeners(target) { assert.equal(target, chart); state.listeners.clear(); },
				},
			},
		};
	}
	return state;
}

function autoDomain(axis) {
	for (const key of ['min', 'max', 'minimum', 'maximum', 'minValue', 'maxValue', 'viewWindow'])
		assert.equal(axis[key], undefined);
}

// These tests deliberately need no vendor downloads. The opt-in suite below uses real assets.
describe('managed benchmark adapters', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['anychart', 'FusionCharts', 'google', 'devicePixelRatio', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const [name, adapter] of Object.entries(variants)) {
		const id = name.replace('-sampled', '');
		const sampled = name.endsWith('-sampled');
		it(`${name}: preserves all 55,550 rows, three series, and original timestamps`, () => {
			const rows = adapter.prepData(packed);
			const again = adapter.prepData(packed);
			assert.equal(rows.length, 55550);
			assert.notEqual(rows, again);
			for (let j = 0, i = packed[0] + 1; j < rows.length; j++, i += packed[0]) {
				assert.equal(+rows[j][0], packed[i] * 60000);
				assert.equal(rows[j][0] instanceof Date, id === 'googlecharts');
				assert.deepEqual(rows[j].slice(1), [
					Math.round((100 - packed[i + 1]) * 1000) / 1000,
					Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
					packed[i + 3],
				]);
				assert.notEqual(rows[j], again[j]);
			}
		});

		it(`${name}: waits for native readiness, shares full rows, and cleans up`, async () => {
			const mock = vendor(id);
			await adapter.prepareRuntime?.();
			const data = Object.freeze(adapter.prepData(packed).map(Object.freeze));
			const wait = {textContent: 'Rendering...'};
			let ready = false;
			const pending = adapter.makeChart(data, host, wait, {sampled: !sampled}).then(chart => { ready = true; return chart; });
			await turn();
			assert.equal(ready, false);
			assert.equal(wait.textContent, 'Rendering...');
			if (id === 'fusiontime') {
				assert.deepEqual(mock.rows, data);
				assert.notEqual(mock.rows, data);
				for (let i = 0; i < data.length; i++) assert.notEqual(mock.rows[i], data[i]);
			}
			else
				assert.equal(mock.rows, data);
			if (id === 'anychart') {
				assert.deepEqual(mock.calls, [
					['animation', false], ['bounds', 0, 0, 1920, 600], ['title', 'Server Events'],
					['xScale', 'scatter'], ['container', host],
				]);
				assert.equal(mock.scroller.values.enabled, false);
				assert.equal(mock.groupingCalls, sampled ? 0 : 1);
				assert.equal(mock.scrollerGroupingCalls, sampled ? 0 : 1);
				assert.deepEqual(mock.grouping.values, sampled ? {} : {enabled: false});
				assert.deepEqual(mock.scrollerGrouping.values, sampled ? {} : {enabled: false});
				assert.equal(mock.legend.values.enabled, true);
				assert.equal(mock.lines.length, 3);
				for (let i = 0; i < 3; i++) {
					const line = mock.lines[i];
					assert.deepEqual(line.mapping.config, {value: {column: i + 1, type: 'average'}});
					assert.equal(line.yScaleValue, mock.scales[i === 2 ? 1 : 0]);
					assert.deepEqual(line.strokeValue, {color: ['red', 'blue', 'green'][i], thickness: 0.5});
					for (const state of Object.values(line.states)) assert.equal(state.values.enabled, false);
				}
				assert.deepEqual(mock.axes.map(axis => axis.values.orientation), ['left', 'right']);
				assert.deepEqual(mock.axes.map(axis => axis.values.format), ['{%Value}%', '{%Value} MB']);
				mock.scales.forEach(autoDomain);
			}
			else if (id === 'fusiontime') {
				const {options} = mock;
				assert.equal(options.type, 'timeseries');
				assert.equal(options.renderAt, host);
				assert.equal(options.width, 1920);
				assert.equal(options.height, 600);
				const source = options.dataSource;
				assert.equal(source.data, mock.table);
				assert.equal(source.chart.multiCanvas, false);
				assert.equal(source.chart.animation, 0);
				assert.equal(source.chart.enableUTC, true);
				assert.deepEqual(mock.schema[0], {name: 'Time', type: 'date', format: '%Q'});
				assert.deepEqual(source.xAxis, sampled ? {plot: 'Time'} : {
					plot: 'Time',
					binning: {year: [], month: [], day: [], hour: [], minute: [1], second: [], millisecond: []},
				});
				assert.equal(data[0][0] % 60000, 0);
				for (let i = 1; i < data.length; i++)
					assert.equal(data[i][0] - data[i - 1][0], 60000, 'one sample per one-minute bin');
				assert.deepEqual(source.yAxis.map(axis => axis.orientation), ['left', 'right']);
				assert.deepEqual(source.yAxis.map(axis => axis.format.suffix), ['%', ' MB']);
				assert.deepEqual(source.yAxis.flatMap(axis => axis.plot), [
					{value: 'CPU', type: 'line', aggregation: 'average'},
					{value: 'RAM', type: 'line', aggregation: 'average'},
					{value: 'TCP Out', type: 'line', aggregation: 'average'},
				]);
				source.yAxis.forEach(autoDomain);
				assert.equal(source.navigator.enabled, false);
				assert.equal(source.plotConfig.line.style.line['stroke-width'], 0.5);
				for (const name of ['anchor', 'anchor:hover', 'anchor:highlight'])
					assert.equal(source.plotConfig.line.style[name].opacity, 0);
			}
			else {
				assert.deepEqual(mock.columns, [['datetime', 'Time'], ['number', 'CPU'], ['number', 'RAM'], ['number', 'TCP Out']]);
				const [table, options] = mock.draw;
				assert.equal(table, mock.table);
				assert.equal(options.width, 1920);
				assert.equal(options.height, 600);
				assert.equal(options.pointSize, 0);
				assert.equal(options.pointsVisible, false);
				assert.equal(options.lineWidth, 0.5);
				assert.deepEqual(options.animation, {duration: 0, startup: false});
				assert.deepEqual(options.series, {0: {targetAxisIndex: 0}, 1: {targetAxisIndex: 0}, 2: {targetAxisIndex: 1}});
				assert.deepEqual(options.vAxes, {0: {format: "0.##'%'"}, 1: {format: "0.##' MB'"}});
				Object.values(options.vAxes).forEach(autoDomain);
				assert.equal(mock.calls.length, 1);
			}
			mock.emit({anychart: 'chartDraw', fusiontime: 'renderComplete', googlecharts: 'ready'}[id]);
			const chart = await pending;
			assert.equal(wait.textContent, 'Done!');
			assert.equal(mock.listeners.size, 0);
			adapter.destroyChart(chart);
			assert.deepEqual(mock.disposed, id === 'anychart'
				? ['chart', 'mapping', 'mapping', 'mapping', 'table', 'scale', 'scale']
				: id === 'fusiontime' ? ['chart', 'store'] : ['chart']);
		});

		if (id !== 'googlecharts') {
			it(`${name}: supports synchronous readiness and repeated initialization without mutating prepared rows`, async () => {
				const data = Object.freeze(adapter.prepData(packed).map(Object.freeze));
				const timers = new Set();
				globalThis.setTimeout = (callback, delay) => {
					assert.equal(delay, 30000);
					timers.add(callback);
					return callback;
				};
				globalThis.clearTimeout = timer => { assert.ok(timers.delete(timer)); };
				for (let i = 0; i < 2; i++) {
					const mock = vendor(id);
					mock.chart[id === 'anychart' ? 'draw' : 'render'] = () => {
						assert.equal(mock.rows.length, 55550);
						assert.deepEqual(mock.rows, data);
						if (id === 'fusiontime')
							mock.rows.forEach((row, index) => row.push(index));
						mock.emit(id === 'anychart' ? 'chartDraw' : 'renderComplete');
					};
					const handle = await adapter.makeChart(data, host);
					assert.equal(mock.listeners.size, 0);
					assert.equal(timers.size, 0);
					assert.equal(mock.disposed.length, 0);
					adapter.destroyChart(handle);
					assert.deepEqual(mock.disposed, id === 'anychart'
						? ['chart', 'mapping', 'mapping', 'mapping', 'table', 'scale', 'scale']
						: ['chart', 'store']);
				}
				assert.deepEqual(data, adapter.prepData(packed));
			});
		}

		it(`${name}: disposes partial initialization and preserves the original exception`, async () => {
			const mock = vendor(id);
			await adapter.prepareRuntime?.();
			mock.fail = true;
			mock.cleanupError = new Error('cleanup failure');
			const wait = {textContent: 'Rendering...'};
			await assert.rejects(adapter.makeChart(adapter.prepData(packed), host, wait), error => error === mock.error);
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(mock.listeners.size, 0);
			assert.equal(mock.disposed[0], 'chart');
			if (id === 'anychart') assert.ok(mock.disposed.includes('table'));
			if (id === 'fusiontime') assert.ok(mock.disposed.includes('store'));
		});

		it(`${name}: readiness timeout rejects and releases resources`, async () => {
			const mock = vendor(id);
			await adapter.prepareRuntime?.();
			let timeout;
			let cleared = false;
			globalThis.setTimeout = callback => { timeout = callback; return 1; };
			globalThis.clearTimeout = timer => { assert.equal(timer, 1); cleared = true; };
			const pending = adapter.makeChart(adapter.prepData(packed), host);
			const rejected = assert.rejects(pending, /30 seconds/);
			timeout();
			await rejected;
			assert.equal(cleared, true);
			assert.equal(mock.listeners.size, 0);
			assert.equal(mock.disposed[0], 'chart');
		});
	}

	for (const [id, names] of [['fusiontime', ['dataInvalid', 'dataLoadError']], ['fusiontime-sampled', ['dataInvalid', 'dataLoadError']], ['googlecharts', ['error']]]) {
		for (const name of names) {
			it(`${id}: rejects native ${name} instead of marking the chart ready`, async () => {
				const mock = vendor(id);
				await variants[id].prepareRuntime?.();
				const pending = variants[id].makeChart(variants[id].prepData(packed), host);
				const rejected = assert.rejects(pending, /broken data/);
				mock.emit(name, {message: 'broken data'}, {error: new Error('broken data')});
				await rejected;
				assert.equal(mock.listeners.size, 0);
				assert.equal(mock.disposed[0], 'chart');
			});
		}
	}

	for (const [id, sampled] of [['anychart', anychartSampled], ['fusiontime', fusiontimeSampled]]) {
		it(`${id}: sampled wrapper shares preparation and cleanup with the base`, () => {
			assert.deepEqual(Object.keys(sampled).filter(key => key !== 'makeEmptyChart' && key !== 'updateChart'), ['destroyChart', 'makeChart', 'prepData']);
			assert.equal(sampled.prepData, adapters[id].prepData);
			assert.equal(sampled.destroyChart, adapters[id].destroyChart);
		});
	}

	it('Google: package preparation is frozen, shared, and contains no chart/data work', async () => {
		const mock = vendor('googlecharts');
		let finish;
		mock.loadPending = new Promise(resolve => { finish = resolve; });
		const first = googlecharts.prepareRuntime();
		const second = googlecharts.prepareRuntime();
		await turn();
		assert.deepEqual(mock.calls, [['load', '52', {packages: ['corechart'], language: 'en'}]]);
		assert.equal(mock.table, undefined);
		assert.equal(mock.draw, undefined);
		await assert.rejects(googlecharts.makeChart([], host), /outside timed initialization/);
		finish();
		await Promise.all([first, second]);
		await googlecharts.prepareRuntime();
		assert.equal(mock.calls.length, 1);
	});

	it('Google: failed preparation is retryable, and missing loader gives an actionable error', async () => {
		delete globalThis.google;
		await assert.rejects(googlecharts.prepareRuntime(), /loader.js/);
		const mock = vendor('googlecharts');
		mock.loadPending = Promise.reject(new Error('network failure'));
		await assert.rejects(googlecharts.prepareRuntime(), /network failure/);
		mock.loadPending = Promise.resolve();
		await googlecharts.prepareRuntime();
		assert.equal(mock.calls.length, 2);
	});

	it('HTML pages delegate to the shared runner without separate fixtures or loaders', () => {
		for (const [page, id] of [['AnyChart', 'anychart'], ['AnyChart-Sampled', 'anychart-sampled'], ['FusionTime', 'fusiontime'], ['FusionTime-Sampled', 'fusiontime-sampled'], ['GoogleCharts', 'googlecharts']]) {
			const html = readFileSync(new URL(`../../bench/${page}.html`, import.meta.url), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.equal(scripts[0][2].trim(), `import {runDemo} from './demo.mjs';\n\t\t\trunDemo('${id}').catch(console.error);`);
			assert.doesNotMatch(html, /<style|<canvas|<div|https:|innerHTML/);
		}
	});
});

// Opt in with BENCH_MANAGED_BROWSER=/absolute/path/to/chrome-headless-shell.
// Fetch only the four pinned JS assets and Google's live loader/packages; no installs.
// This bypasses central registration so adapter ownership stays independent.
(process.env.BENCH_MANAGED_BROWSER ? describe : describe.skip)('managed adapters: real browser', function() {
	this.timeout(120000);
	let server, browser, client, profile;
	before(async () => {
		const {createServer} = await import('node:http');
		const {spawn} = await import('node:child_process');
		const {mkdtemp} = await import('node:fs/promises');
		const {tmpdir} = await import('node:os');
		const {join} = await import('node:path');
		const {CDP} = await import('../../scripts/profile-manual.mjs');
		const assets = new Map();
		for (const [name, url] of [
			['anychart-core.js', 'https://cdn.jsdelivr.net/npm/anychart@9.0.0/dist/js/anychart-core.min.js'],
			['anychart-stock.js', 'https://cdn.jsdelivr.net/npm/anychart@9.0.0/dist/js/anychart-stock.min.js'],
			['fusioncharts.js', 'https://cdn.jsdelivr.net/npm/fusioncharts@4.2.3/fusioncharts.js'],
			['fusioncharts.timeseries.js', 'https://cdn.jsdelivr.net/npm/fusioncharts@4.2.3/fusioncharts.timeseries.js'],
		]) {
			const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
			assert.equal(response.status, 200, url);
			assets.set('/' + name, await response.text());
		}
		server = createServer((request, response) => {
			const path = new URL(request.url, 'http://localhost').pathname;
			if (path === '/') {
				response.setHeader('Content-Type', 'text/html');
				response.end('<!doctype html><div id="chart" style="width:1920px;height:600px"></div>');
			}
			else if (assets.has(path)) {
				response.setHeader('Content-Type', 'text/javascript');
				response.end(assets.get(path));
			}
			else if (/^\/bench\/(anychart|fusiontime|googlecharts)\.mjs$/.test(path) || path === '/bench/data.json') {
				response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'text/javascript');
				response.end(readFileSync(new URL('../..' + path, import.meta.url)));
			}
			else { response.writeHead(404); response.end(); }
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		profile = await mkdtemp(join(tmpdir(), 'uplot-managed-'));
		browser = spawn(process.env.BENCH_MANAGED_BROWSER, [
			'--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0',
			'--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank',
		], {stdio: 'ignore'});
		const {setTimeout: delay} = await import('node:timers/promises');
		let port;
		for (let i = 0; i < 200; i++) {
			try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
			catch { await delay(50); }
		}
		assert.ok(port, 'Chrome did not start');
		const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
		client = new CDP(socket, 90000);
		await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
	});
	after(async () => {
		client?.close();
		if (browser && browser.exitCode === null) {
			const closed = new Promise(resolve => browser.once('exit', resolve));
			browser.kill('SIGKILL');
			await closed;
		}
		if (server) await new Promise(resolve => server.close(resolve));
		if (profile) await (await import('node:fs/promises')).rm(profile, {recursive: true, force: true});
	});

	for (const id of Object.keys(adapters)) {
		it(`${id}: full data, native rendering, and repeated teardown`, async () => {
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
			const {setTimeout: delay} = await import('node:timers/promises');
			for (let i = 0; i < 100; i++) {
				const check = await client.send('Runtime.evaluate', {expression: '!!document.getElementById("chart")', returnByValue: true});
				if (check.result.value) break;
				await delay(20);
			}
			const result = await client.send('Runtime.evaluate', {awaitPromise: true, returnByValue: true, expression: `
				(async () => {
					const id = ${JSON.stringify(id)};
					const files = {
						anychart: ['/anychart-core.js', '/anychart-stock.js'],
						fusiontime: ['/fusioncharts.js', '/fusioncharts.timeseries.js'],
						googlecharts: ['https://www.gstatic.com/charts/loader.js'],
					};
					for (const url of files[id]) await new Promise((resolve, reject) => {
						const script = document.createElement('script');
						script.src = url; script.onload = resolve; script.onerror = () => reject(new Error('Cannot load ' + url));
						document.head.append(script);
					});
					const adapter = await import('/bench/' + id + '.mjs');
					await adapter.prepareRuntime?.();
					const packed = await (await fetch('/bench/data.json')).json();
					const data = adapter.prepData(packed);
					const original = JSON.stringify(data);
					const host = document.getElementById('chart');
					const samples = [];
					for (let i = 0; i < 2; i++) {
						const wait = {textContent: 'Rendering...'};
						const handle = await adapter.makeChart(data, host, wait);
						const textNodes = Array.from(host.querySelectorAll('svg text'));
						const texts = textNodes.map(node => node.textContent);
						// Geometry reads belong only to this smoke test, never timed adapter code.
						const tickBounds = suffix => textNodes.filter(node => node.textContent.endsWith(suffix)).map(node => {
							const box = node.getBoundingClientRect();
							return {x: box.x, y: box.y};
						});
						const sample = {rows: data.length, first: +data[0][0], last: +data.at(-1)[0], wait: wait.textContent,
							texts, paths: host.querySelectorAll('svg path').length,
							percentTicks: tickBounds('%'), tcpTicks: tickBounds('MB')};
						if (id === 'anychart') {
							sample.range = handle.chart.getSelectedRange();
							sample.plots = handle.chart.getPlotsCount();
							sample.series = handle.chart.plot(0).getSeriesCount();
						}
						if (id === 'fusiontime') {
							const table = handle.store.getDataTable();
							sample.nativeRows = table.count();
							sample.nativeFirst = table.getData(0, 1).data[0].slice(0, 4);
							sample.nativeLast = table.getData(data.length - 1, 1).data[0].slice(0, 4);
						}
						adapter.destroyChart(handle);
						sample.unmutated = JSON.stringify(data) === original;
						sample.remainingPaths = host.querySelectorAll('svg path').length;
						samples.push(sample);
					}
					return samples;
				})()
			`});
			assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
			for (const sample of result.result.value) {
				assert.equal(sample.rows, 55550);
				assert.equal(sample.first, packed[packed[0] + 1] * 60000);
				assert.equal(sample.last, packed[packed.length - packed[0]] * 60000);
				assert.equal(sample.wait, 'Done!');
				assert.ok(sample.paths > 3);
				assert.equal(sample.remainingPaths, 0);
				assert.equal(sample.unmutated, true);
				assert.ok(sample.percentTicks.length >= 2);
				assert.ok(sample.tcpTicks.length >= 2);
				assert.ok(sample.percentTicks.every(tick => tick.x < 960));
				assert.ok(sample.tcpTicks.every(tick => tick.x > 960));
				const percentTop = Math.min(...sample.percentTicks.map(tick => tick.y));
				const tcpBottom = Math.max(...sample.tcpTicks.map(tick => tick.y));
				const tcpTop = Math.min(...sample.tcpTicks.map(tick => tick.y));
				const percentBottom = Math.max(...sample.percentTicks.map(tick => tick.y));
				assert.ok(percentTop < tcpBottom && tcpTop < percentBottom, 'Both axes must occupy the same plot');
				const labels = sample.texts.join(' ');
				for (const expected of ['CPU', 'RAM', 'TCP Out', '%', 'MB']) assert.ok(labels.includes(expected), labels);
				if (id === 'anychart') {
					assert.equal(sample.plots, 1);
					assert.equal(sample.series, 3);
					// Automatic domains may add padding, but must include the full input.
					assert.ok(sample.range.firstSelected <= sample.first);
					assert.ok(sample.range.lastSelected >= sample.last);
				}
				if (id === 'fusiontime') {
					assert.equal(sample.nativeRows, 55550);
					const rows = fusiontime.prepData(packed);
					assert.deepEqual(sample.nativeFirst, rows[0]);
					assert.deepEqual(sample.nativeLast, rows.at(-1));
				}
			}
		});
	}
});
