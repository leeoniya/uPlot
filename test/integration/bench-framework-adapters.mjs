import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import * as recharts from '../../bench/recharts.mjs';
import * as muicharts from '../../bench/muicharts.mjs';
import * as financialcharts from '../../bench/financialcharts.mjs';
import * as visx from '../../bench/visx.mjs';
import {frameworkDependencies, mountReact, waitForLines} from '../../bench/framework-runtime.mjs';


const adapters = {recharts, muicharts, financialcharts, visx};
const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const small = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
	10, 75, 2, 3, 4, 25, 75,
	17, 50, 2, 6, 4, 50, 50,
	31, 87.6543, 2, 9, 4, 1, 2]);
function walk(node, type) {
	if (!node || typeof node !== 'object') return [];
	return [...(node.type === type ? [node] : []), ...(node.props?.children || []).flatMap(child => walk(child, type))];
}
function mockRuntime() {
	const state = {unmounted: 0, removed: 0, roots: 0, scales: [], tickDomains: [], tickCounts: [],
			calendarTicks: [new Date(900000), new Date(1800000)]};
	let useState;
	const paths = Array.from({length: 3}, () => ({getAttribute: () => 'M0,0L1,1'}));
	state.element = {style: {}, querySelectorAll: () => paths, remove() { state.removed++; }};
	state.host = {ownerDocument: {createElement: () => state.element}, append(element) { assert.equal(element, state.element); }};
	const scale = config => {
		state.scales.push(config);
		return value => value;
	};
	return Object.assign(state, {globals: {
		benchmarkReact: {Component: class {}, Fragment: 'Fragment', useState: initial => useState(initial),
			createElement(type, props, ...children) { return {type, props: {...props, children}}; }},
		benchmarkReactDOM: {flushSync(fn) { return fn(); }},
		benchmarkReactDOMClient: {createRoot() {
			state.roots++;
			let currentTree, hookState;
			const commit = node => {
				if (!node || typeof node !== 'object') return node;
				if (typeof node.type === 'function' && !node.type.prototype?.render)
					return commit(node.type(node.props));
				return {...node, props: {...node.props, children: (node.props.children ?? []).map(commit)}};
			};
			const root = {
				render(tree) {
					if (state.error) throw state.error;
					currentTree = tree;
					useState = initial => {
						hookState ??= initial;
						return [hookState, next => { hookState = next; root.render(currentTree); }];
					};
					state.tree = commit(tree);
					const canvas = walk(state.tree, 'ChartCanvas')[0];
					if (canvas) canvas.props.ref({props: canvas.props, state: {plotData: canvas.props.data, chartConfigs: [{}, {}]}, getCanvasContexts: () => ({axes: {}})});
				},
				unmount() { state.unmounted++; if (state.cleanupError) throw state.cleanupError; },
			};
			return root;
		}},
		benchmarkRecharts: Object.fromEntries(['LineChart', 'Line', 'XAxis', 'YAxis', 'CartesianGrid', 'Legend', 'Tooltip'].map(name => [name, name])),
		benchmarkMuiCharts: {LineChart: 'MuiLineChart'},
		benchmarkFinancialCharts: Object.fromEntries(['ChartCanvas', 'Chart', 'XAxis', 'YAxis', 'LineSeries'].map(name => [name, name])),
		benchmarkD3Scale: {scaleTime() {
					const time = scale();
					time.domain = domain => { state.tickDomains.push(domain); return time; };
					time.ticks = count => { state.tickCounts.push(count); return state.calendarTicks; };
					return time;
				}},
		benchmarkVisxShape: {LinePath: 'LinePath'},
		benchmarkVisxAxis: {AxisBottom: 'AxisBottom', AxisLeft: 'AxisLeft', AxisRight: 'AxisRight'},
		benchmarkVisxScale: {scaleTime: scale, scaleLinear: scale},
		benchmarkVisxGrid: {GridRows: 'GridRows'},
	}});
}

describe('framework benchmark adapters', () => {
	let saved, state;
	beforeEach(() => {
		state = mockRuntime();
		saved = Object.fromEntries(Object.keys(state.globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		Object.assign(globalThis, state.globals);
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: preserves all 55,550 rows and all three series`, () => {
			assert.deepEqual(Object.keys(adapter), [
				'destroyChart', ...(id === 'recharts' ? ['getHoverPlan'] : []), 'makeChart',
				'makeEmptyChart', 'makeLifecycleChart', 'prepData', 'resizeChart', 'updateChart',
			]);
			const data = adapter.prepData(packed);
			assert.equal(data.length, 55550);
			assert.notEqual(data, adapter.prepData(packed));
			for (let j = 0, i = packed[0] + 1; j < data.length; j++, i += packed[0]) assert.deepEqual(data[j], {
				time: packed[i] * 60000,
				cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
				ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
				tcp: packed[i + 3],
			});
			assert.deepEqual(adapter.prepData(small), [
				{time: 600000, cpu: 25, ram: 25, tcp: 3},
				{time: 1020000, cpu: 50, ram: 50, tcp: 6},
				{time: 1860000, cpu: 12.346, ram: 33.33, tcp: 9},
			]);
		});

		it(`${id}: mounts only during init, retains the root, and unmounts without input mutation`, async () => {
			const data = Object.freeze(adapter.prepData(small).map(Object.freeze));
			assert.equal(state.roots, 0);
			const wait = {textContent: 'Rendering...'};
			const chart = await adapter.makeChart(data, state.host, wait);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(state.roots, 1);
			assert.ok(chart.root);
			assert.equal(state.unmounted, 0);
			adapter.destroyChart(chart);
			assert.equal(state.unmounted, 1);
			assert.equal(state.removed, 1);
			assert.equal(chart.root, null);
			adapter.destroyChart(chart);
			assert.equal(state.unmounted, 1);
		});

		it(`${id}: cleans up failed commits and preserves the rendering error`, async () => {
			state.error = new Error('commit failed');
			state.cleanupError = new Error('unmount failed');
			const wait = {textContent: 'Rendering...'};
			await assert.rejects(adapter.makeChart(adapter.prepData(small), state.host, wait), error => error === state.error);
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(state.unmounted, 1);
			assert.equal(state.removed, 1);
		});
	}

	it('Recharts uses continuous time, native independent auto axes, and unanimated unmarked lines', async () => {
		await recharts.makeChart(recharts.prepData(small), state.host);
		assert.equal(walk(state.tree, 'LineChart')[0].props.width, 1920);
		const x = walk(state.tree, 'XAxis')[0].props;
		assert.equal(x.type, 'number'); assert.equal(x.scale, 'time');
		assert.deepEqual(x.domain, ['dataMin', 'dataMax']);
		assert.deepEqual(x.ticks, state.calendarTicks.map(Number));
		assert.deepEqual(state.tickDomains, [[600000, 1860000]]);
		assert.deepEqual(state.tickCounts, [12]);
		assert.equal(walk(state.tree, 'CartesianGrid')[0].props.verticalCoordinatesGenerator, undefined);
		assert.deepEqual(walk(state.tree, 'YAxis').map(n => [n.props.yAxisId, n.props.orientation, n.props.domain]),
			[['percent', 'left', ['auto', 'auto']], ['mb', 'right', ['auto', 'auto']]]);
		const lines = walk(state.tree, 'Line').map(n => n.props);
		assert.deepEqual(lines.map(n => n.yAxisId), ['percent', 'percent', 'mb']);
		for (const line of lines) { assert.equal(line.dot, false); assert.equal(line.activeDot, false); assert.equal(line.isAnimationActive, false); assert.equal(line.type, 'linear'); }
	});

	it('Recharts creates calendar ticks during init from actual full-data endpoints without filtering rows', async () => {
		const data = Object.freeze(recharts.prepData(packed).map(Object.freeze));
		assert.deepEqual(state.tickDomains, []);
		assert.deepEqual(state.tickCounts, []);
		const chart = await recharts.makeChart(data, state.host);
		assert.deepEqual(state.tickDomains, [[data[0].time, data[data.length - 1].time]]);
		assert.deepEqual(state.tickCounts, [12]);
		assert.equal(walk(state.tree, 'LineChart')[0].props.data, data);
		assert.equal(data.length, 55550);
		const x = walk(state.tree, 'XAxis')[0].props;
		assert.deepEqual(x.ticks, state.calendarTicks.map(Number));
		assert.notEqual(x.ticks, state.calendarTicks);
		assert.ok(state.calendarTicks.every(tick => tick instanceof Date));
		recharts.destroyChart(chart);
	});

	it('MUI uses native dual axes and disables marks, highlights, and animation', async () => {
		await muicharts.makeChart(muicharts.prepData(small), state.host);
		const props = walk(state.tree, 'MuiLineChart')[0].props;
		assert.equal(props.width, 1920); assert.equal(props.height + 40, 600);
		assert.equal(props.xAxis[0].scaleType, 'time');
		assert.deepEqual(props.yAxis.map(axis => [axis.id, axis.position, axis.min, axis.max]),
			[['percent', 'left', undefined, undefined], ['mb', 'right', undefined, undefined]]);
		assert.deepEqual(props.series.map(series => series.yAxisId), ['percent', 'percent', 'mb']);
		assert.equal(props.skipAnimation, true);
		for (const series of props.series) { assert.equal(series.showMark, false); assert.equal(series.disableHighlight, true); assert.equal(series.curve, 'linear'); }
	});

	it('Financial Charts retains the full calendar domain, bypasses density trimming, and overlays native Chart contexts', async () => {
		const data = financialcharts.prepData(small);
		await financialcharts.makeChart(data, state.host);
		const props = walk(state.tree, 'ChartCanvas')[0].props;
		assert.equal(props.plotFull, true);
		assert.equal(props.data, data);
		assert.equal(props.width, 1920); assert.equal(props.height + 50, 600);
		assert.deepEqual(props.xExtents.map(Number), [data[0].time, data[2].time]);
		assert.equal(+props.xAccessor(data[1]), data[1].time);
		assert.equal(state.scales.length, 1);
		const charts = walk(state.tree, 'Chart').map(n => n.props);
		assert.deepEqual(charts.map(p => p.id), [1, 2]);
		assert.deepEqual(charts[0].yExtents(data[1]), [50, 50]);
		assert.equal(charts[1].yExtents(data[1]), 6);
		assert.deepEqual(walk(state.tree, 'YAxis').map(n => n.props.orient), ['left', 'right']);
		assert.equal(walk(state.tree, 'LineSeries').length, 3);
	});

	it('visx derives full-data natural domains and passes every row to each path', async () => {
		const data = visx.prepData(small);
		await visx.makeChart(data, state.host);
		assert.deepEqual(state.scales.map(s => s.domain), [[600000, 1860000], [12.346, 50], [3, 9]]);
		assert.equal(walk(state.tree, 'AxisLeft').length, 1); assert.equal(walk(state.tree, 'AxisRight').length, 1);
		assert.equal(walk(state.tree, 'svg')[0].props.height, 600);
		for (const path of walk(state.tree, 'LinePath')) assert.equal(path.props.data, data);
	});

	it('waits for observed line output rather than a fixed animation-frame count', async () => {
		const previous = globalThis.MutationObserver;
		let notify, disconnected = 0, ready = false;
		globalThis.MutationObserver = class {
			constructor(callback) { notify = callback; }
			observe() {}
			disconnect() { disconnected++; }
		};
		try {
			state.element.querySelectorAll = () => ready ? Array.from({length: 3}, () => ({getAttribute: () => 'M0,0L1,1'})) : [];
			let complete = false;
			const pending = waitForLines({element: state.element}, '.line').then(() => { complete = true; });
			await Promise.resolve(); assert.equal(complete, false);
			ready = true; notify(); await pending;
			assert.equal(disconnected, 1);
		}
		finally { globalThis.MutationObserver = previous; }
	});

	it('rejects a deferred React error and disconnects its readiness observer', async () => {
		const previous = globalThis.MutationObserver;
		let disconnected = 0;
		globalThis.MutationObserver = class {
			observe() {}
			disconnect() { disconnected++; }
		};
		try {
			state.element.querySelectorAll = () => [];
			const pending = mountReact(state.host, () => null, chart => waitForLines(chart, '.line'));
			const error = new Error('deferred React error');
			state.tree.type.prototype.componentDidCatch(error);
			await assert.rejects(pending, actual => actual === error);
			assert.equal(disconnected, 1);
			assert.equal(state.unmounted, 1); assert.equal(state.removed, 1);
		}
		finally { globalThis.MutationObserver = previous; }
	});

	it('cleans up rejected asynchronous readiness', async () => {
		const error = new Error('incomplete draw');
		await assert.rejects(mountReact(state.host, () => null, () => Promise.reject(error)), actual => actual === error);
		assert.equal(state.unmounted, 1); assert.equal(state.removed, 1);
	});

	it('pins compatible production dependencies and uses one shared module entry path in demos', () => {
		for (const [id, deps] of Object.entries(frameworkDependencies)) {
			const version = id === 'financialcharts' ? '18.3.1' : '19.3.1';
			assert.equal(deps.find(d => d.name === 'react').version, version);
			assert.equal(deps.find(d => d.name === 'react-dom').version, version);
			if (id === 'recharts') {
				const scale = deps.find(d => d.name === 'd3-scale');
				assert.equal(scale.version, '4.0.2');
				assert.equal(scale.global, 'benchmarkD3Scale');
			}
			for (const dep of deps) { assert.equal(dep.type, 'module'); assert.ok(dep.global); assert.ok(!new URL(dep.url).searchParams.has('dev')); }
			const html = readFileSync(new URL(`../../bench/${id}.html`, import.meta.url), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.equal(scripts[0][2].trim(), `import {runDemo} from './demo.mjs';\n\trunDemo('${id}').catch(console.error);`);
			assert.doesNotMatch(html, /https?:|fetch\(|StrictMode|createRoot|framework-runtime/);
		}

	});
});

// Opt-in real browser validation: no npm installs, no browser download. The cache
// bundler downloads only JS sources and serves a single local module per variant.
(process.env.BENCH_FRAMEWORK_BROWSER === '1' ? describe : describe.skip)('framework adapters in Chrome', function() {
	for (const id of Object.keys(adapters)) it(`${id}: draws every sample and unmounts twice`, {timeout: 240000}, async () => {
		const {bundleModuleDependencies} = await import('../../scripts/bench-module-bundle.mjs');
		const {createServer} = await import('node:http');
		const {spawn} = await import('node:child_process');
		const {mkdtemp, readFile, rm} = await import('node:fs/promises');
		const {tmpdir} = await import('node:os');
		const {join} = await import('node:path');
		const {fileURLToPath} = await import('node:url');
		const binary = process.env.CHROME_BIN || fileURLToPath(new URL('../../node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', import.meta.url));
		assert.ok(existsSync(binary), 'Use CHROME_BIN or the existing cached Chrome; this test does not install a browser.');
		const bundle = await bundleModuleDependencies(frameworkDependencies[id], {
			cacheDir: fileURLToPath(new URL('../../.cache/benchmarks/modules', import.meta.url)),
		});
		// Exactly one production React implementation must be present in each graph.
		const reactSources = bundle.sources.filter(source => /^https:\/\/esm.sh\/react@[^/]+\/es2022\/react(?:\.production)?\.mjs$/.test(source.url));
		assert.equal(reactSources.length, 1);
		const files = new Map([
			['/', '<!doctype html><body></body>'], ['/vendor.mjs', bundle.code],
			['/bench/data.json', JSON.stringify(packed)],
			...['framework-runtime', id].map(name => [`/bench/${name}.mjs`, readFileSync(new URL(`../../bench/${name}.mjs`, import.meta.url), 'utf8')]),
		]);
		files.set('/test.mjs', `
			import * as namespaces from '/vendor.mjs';
			Object.assign(globalThis, namespaces);
			import * as adapter from '/bench/${id}.mjs';
			import {calendarLabel} from '/bench/framework-runtime.mjs';
			export const result = (async () => {
				const packed = await (await fetch('/bench/data.json')).json();
				const data = Object.freeze(adapter.prepData(Object.freeze(packed)).map(Object.freeze));
				const before = JSON.stringify(data);
				const host = document.createElement('div'); document.body.append(host);
				const rounds = [];
				function calendarInfo(rows) {
					const ticks = benchmarkD3Scale.scaleTime().domain([rows[0].time, rows[rows.length - 1].time]).ticks(12);
					return {
						ticks: ticks.map(Number), expectedLabels: ticks.map(calendarLabel),
						actualLabels: [...host.querySelectorAll('svg text')].map(text => text.textContent).filter(text => text.includes('/')),
						boundaries: ticks.map(tick => [tick.getHours(), tick.getMinutes(), tick.getSeconds(), tick.getMilliseconds()]),
					};
				}
				const original = CanvasRenderingContext2D.prototype.lineTo;
				let counts;
				CanvasRenderingContext2D.prototype.lineTo = function(...args) {
					counts[this.strokeStyle] = (counts[this.strokeStyle] || 0) + 1;
					return original.apply(this, args);
				};
				try {
					for (let round = 0; round < 2; round++) {
						counts = {};
						const requests = performance.getEntriesByType('resource').length;
						const chart = await adapter.makeChart(data, host, {textContent: ''});
						await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
						const selector = ${JSON.stringify(id === 'recharts' ? '.recharts-line-curve' : '.benchmark-line')};
						const paths = [...host.querySelectorAll(selector)].map(path => path.getAttribute('d'));
						const dimensions = [chart.element.offsetWidth, chart.element.offsetHeight];
						const info = {dimensions, points: paths.map(d => (d.match(/[ML]/g) || []).length),
							invalid: paths.some(d => /NaN|Infinity/.test(d)), canvas: {...counts},
							networkDuringInit: performance.getEntriesByType('resource').length - requests};
						if (${JSON.stringify(id)} === 'recharts') info.calendar = calendarInfo(data);
						if (chart.instance) {
							info.rows = chart.instance.state.plotData.length;
							info.domain = chart.instance.state.xScale.domain().map(Number);
							info.yDomains = chart.instance.state.chartConfigs.map(c => c.yScale.domain());
						}
						adapter.destroyChart(chart);
						info.remaining = host.childElementCount; info.rootReleased = chart.root === null;
						rounds.push(info);
					}
				} finally { CanvasRenderingContext2D.prototype.lineTo = original; }
				let irregular;
				if (${JSON.stringify(id)} === 'recharts') {
					// Off-boundary endpoints and irregular gaps expose data-index ticks
					// and distinguish a calendar scale from evenly spaced categories.
					const rows = Object.freeze([[3, 7], [3, 18], [4, 41], [7, 59]].map(([hour, minute], i) => Object.freeze({
						time: +new Date(2024, 0, 2, hour, minute), cpu: 20 + i, ram: 40 - i, tcp: 100 + i * 7,
					})));
					const unchanged = JSON.stringify(rows);
					const chart = await adapter.makeChart(rows, host);
					try {
						await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
						const paths = [...host.querySelectorAll('.recharts-line-curve')];
						const x = [...paths[0].getAttribute('d').matchAll(/[ML](-?[0-9.]+),/g)].map(match => Number(match[1]));
						irregular = {...calendarInfo(rows), times: rows.map(row => row.time),
							points: paths.map(path => (path.getAttribute('d').match(/[ML]/g) || []).length),
							xFractions: x.map(value => (value - x[0]) / (x[x.length - 1] - x[0])),
							unchanged: JSON.stringify(rows) === unchanged};
					} finally { adapter.destroyChart(chart); }
					irregular.remaining = host.childElementCount;
					irregular.rootReleased = chart.root === null;
				}
				return {rounds, irregular, unchanged: JSON.stringify(data) === before, rows: data.length,
					domain: [data[0].time, data[data.length - 1].time]};
			})();
		`);
		const missing = [];
		const server = createServer((req, res) => {
			if (!files.has(req.url)) { missing.push(req.url); res.writeHead(404).end(); return; }
			res.setHeader('Content-Type', req.url === '/' ? 'text/html' : req.url.endsWith('.json') ? 'application/json' : 'text/javascript');
			res.end(files.get(req.url));
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const profile = await mkdtemp(join(tmpdir(), 'uplot-framework-chrome-'));
		let browser, socket, log = '', serial = 0;
		const pending = new Map(), events = new Map(), errors = [];
		try {
			browser = spawn(binary, ['--no-sandbox', '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking',
				'--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'pipe', 'pipe']});
			browser.stderr.on('data', data => { log = (log + data).slice(-6000); });
			const deadline = Date.now() + 15000;
			let port;
			while (!port && Date.now() < deadline) {
				try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
				catch { await new Promise(resolve => setTimeout(resolve, 50)); }
			}
			assert.ok(port, log);
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
			await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
			socket.addEventListener('message', event => {
				const message = JSON.parse(event.data);
				if (message.id) {
					const task = pending.get(message.id); pending.delete(message.id);
					if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
				}
				else {
					if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
					if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args);
					events.get(message.method)?.(message.params);
				}
			});
			const send = (method, params = {}) => new Promise((resolve, reject) => {
				const id = ++serial; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params}));
			});
			await send('Page.enable'); await send('Runtime.enable');
			const loaded = new Promise(resolve => events.set('Page.loadEventFired', resolve));
			await send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`}); await loaded;
			const evaluation = await send('Runtime.evaluate', {expression: "import('/test.mjs').then(m => m.result)", awaitPromise: true, returnByValue: true});
			assert.equal(evaluation.exceptionDetails, undefined, JSON.stringify(evaluation.exceptionDetails));
			const result = evaluation.result.value;
			assert.equal(result.unchanged, true); assert.equal(result.rows, 55550);
			for (const round of result.rounds) {
				assert.deepEqual(round.dimensions, [1920, 600]);
				assert.equal(round.invalid, false);
				assert.equal(round.networkDuringInit, 0);
				assert.equal(round.remaining, 0); assert.equal(round.rootReleased, true);
				if (id === 'financialcharts') {
					assert.equal(round.rows, 55550); assert.deepEqual(round.domain, result.domain);
					assert.equal(round.yDomains.length, 2); assert.notDeepEqual(round.yDomains[0], round.yDomains[1]);
					for (const color of ['#ff0000', '#0000ff', '#008000']) assert.ok(round.canvas[color] >= 55549, JSON.stringify(round.canvas));
				}
				else assert.deepEqual(round.points, [55550, 55550, 55550]);
				if (id === 'recharts') {
					// Recharts may hide colliding labels (e.g. Aug 31 / Sep 1 for
					// D3's day.every(2)); every displayed label must still be a calendar tick.
					assert.deepEqual(round.calendar.actualLabels,
						round.calendar.expectedLabels.filter(label => round.calendar.actualLabels.includes(label)));
					assert.ok(round.calendar.actualLabels.length >= 6);
					assert.ok(round.calendar.ticks.length > 5 && round.calendar.ticks.length < 30);
					assert.ok(round.calendar.boundaries.every(([, minute, second, ms]) => minute === 0 && second === 0 && ms === 0));
				}
			}
			if (id === 'recharts') {
				const info = result.irregular;
				assert.deepEqual(info.actualLabels, info.expectedLabels);
				assert.equal(info.ticks.length, 9);
				assert.ok(info.boundaries.every(([, minute, second, ms]) => minute % 30 === 0 && second === 0 && ms === 0));
				assert.ok(info.ticks.every(tick => !info.times.includes(tick)));
				assert.deepEqual(info.points, [4, 4, 4]);
				assert.equal(info.xFractions.length, info.times.length);
				for (let i = 0; i < info.times.length; i++) {
					const expected = (info.times[i] - info.times[0]) / (info.times.at(-1) - info.times[0]);
					assert.ok(Math.abs(info.xFractions[i] - expected) < 0.00001);
				}
				assert.equal(info.unchanged, true); assert.equal(info.remaining, 0); assert.equal(info.rootReleased, true);
				console.log(`    recharts irregular calendar: ${JSON.stringify(info)}`);
			}
			assert.deepEqual(errors, []); assert.deepEqual(missing, []);
			console.log(`    ${id}: ${JSON.stringify(result.rounds[0])}`);
		}
		finally {
			socket?.close();
			if (browser && browser.exitCode === null) {
				const exited = new Promise(resolve => browser.once('exit', resolve));
				browser.kill('SIGKILL'); await exited;
			}
			server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
			await rm(profile, {recursive: true, force: true, maxRetries: 3});
		}
	});
});
