import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {cachedChromeBinary} from '../../scripts/chrome-headless-shell.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';
import * as lightningchart from '../../bench/lightningchart.mjs';
import {smallLifecycleData} from '../../bench/lifecycle-data.mjs';

// TEST_BENCH_LIFECYCLE_NATIVE=1 node --test --test-isolation=none test/integration/bench-lifecycle-native.mjs
// Cache-only browser checks: no downloads, screenshots, traces, or saved reports.
const root = new URL('../../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
const variants = ['flot', 'dygraphs', 'canvasjs', 'lightweight', 'zingchart', 'kendo'];

async function exercise(id) {
	const check = (ok, message) => { if (!ok) throw new Error(id + ': ' + message); };
	const adapter = await import('/bench/' + id + '.mjs');
	const {smallLifecycleData} = await import('/bench/lifecycle-data.mjs');
	const {setupDemo} = await import('/bench/demo-fixture.mjs');
	const packed = await (await fetch('/bench/data.json')).json();
	const count = (packed.length - packed[0] - 1) / packed[0];
	check(count === 55550, 'not the full benchmark fixture');
	console.time = console.timeEnd = () => {};
	let constructed = 0;
	const lines = [];
	if (id === 'lightweight') {
		const create = LightweightCharts.createChart;
		globalThis.LightweightCharts = {...LightweightCharts, createChart: (...args) => {
			constructed++;
			const chart = create(...args), add = chart.addSeries;
			chart.addSeries = function(...args) { const line = add.apply(this, args); lines.push(line); return line; };
			return chart;
		}};
	}
	let draws = 0;
	const stroke = CanvasRenderingContext2D.prototype.stroke;
	CanvasRenderingContext2D.prototype.stroke = function(...args) { draws++; return stroke.apply(this, args); };
	const parent = document.createElement('div');
	document.body.append(parent);
	let host, chart;
	const destroy = () => {
		if (adapter.destroyChart) adapter.destroyChart(chart);
		else chart.destroy();
		if (id === 'flot') {
			check(!jQuery(host.firstElementChild).data('plot'), 'registered plot survived destruction');
			check(host.firstElementChild.childNodes.length === 0, 'plot DOM survived destruction');
		}
		else if (id === 'dygraphs' || id === 'kendo' || id === 'lightweight')
			check(host.childNodes.length === 0, 'chart DOM survived destruction');
		chart = null;
		host.remove();
	};
	const read = () => {
		if (id === 'flot') return chart.getData().map(s => s.data);
		if (id === 'dygraphs') return [1, 2, 3].map(s => Array.from({length: chart.numRows()}, (_, j) => [chart.getValue(j, 0), chart.getValue(j, s)]));
		if (id === 'canvasjs') return chart.options.data.map(s => s.dataPoints.map(p => [p.x, p.y]));
		if (id === 'lightweight') return lines.slice(-3).map(s => s.data().map(p => [p.time, p.value]));
		if (id === 'zingchart') return zingchart.exec(chart.id, 'getseriesvalues');
		return chart.options.series.map(s => s.data.map(p => [+p[0], p[1]]));
	};
	const verify = input => {
		const rows = id === 'dygraphs' ? input.length : input[0].length;
		const actual = read();
		check(actual.length === 3, 'missing configured series');
		for (let s = 0; s < 3; s++) {
			check(actual[s].length === rows, 'wrong native point count');
			for (let j = 0; j < rows; j++) {
				const point = id === 'dygraphs' ? [input[j][0], input[j][s + 1]]
					: id === 'canvasjs' ? [input[s][j].x, input[s][j].y]
					: id === 'lightweight' ? [input[s][j].time, input[s][j].value]
					: [+input[s][j][0], input[s][j][1]];
				check(actual[s][j][0] === point[0] && actual[s][j][1] === point[1], `incorrect native series ${s} row ${j}`);
			}
		}
		if (id === 'flot') check(jQuery(host.firstElementChild).data('plot') === chart, 'wrong native handle');
		if (id === 'dygraphs') check(chart instanceof Dygraph, 'wrong native handle');
		if (id === 'zingchart') check(chart === host, 'wrong host handle');
	};
	try {
		host = setupDemo(id, parent);
		const wait = {textContent: 'waiting'};
		const small = adapter.prepData(smallLifecycleData(packed));
		chart = await (adapter.makeLifecycleChart ?? adapter.makeChart)(small, host, wait);
		check(wait.textContent === 'Done!', 'initial readiness missing');
		verify(small);
		let canvases = [...host.querySelectorAll('canvas')];
		check(canvases.length > 0, 'initial chart has no canvas');
		let contexts = canvases.map(canvas => canvas.getContext('2d'));
		const replacedLayers = new Set();
		if (id === 'flot' || id === 'dygraphs') check(canvases.length === 2, 'expected base and overlay canvases');
		for (let pass = 0; pass < 2; pass++) {
			const full = packed.slice();
			// Change actual fixture values on the second replacement, retaining all timestamps/rows.
			if (pass) for (let i = full[0] + 1; i < full.length; i += full[0]) full[i + 1] = packed[i + 5] % 100;
			const input = adapter.prepData(full);
			wait.textContent = 'waiting';
			const before = draws;
			check(await adapter.updateChart(chart, input, host, wait) === chart, 'replacement chart returned');
			check(wait.textContent === 'Done!', 'update readiness missing');
			verify(input);
			check(draws > before, 'update resolved before native canvas drawing');
			for (let i = 0; i < canvases.length; i++) {
				if (!host.contains(canvases[i])) {
					// ZingChart rebuilds interaction/legend layers during native replacement,
					// but must retain the chart's main, persistent, and series canvases.
					check(id === 'zingchart' && /-(hover|legend|legend-scroll|guide|trigger|print|textprint)-c$/.test(canvases[i].id), 'original canvas replaced: ' + canvases[i].id);
					replacedLayers.add(canvases[i].id);
				}
				else check(canvases[i].getContext('2d') === contexts[i], 'original context replaced');
			}
			canvases = [...host.querySelectorAll('canvas')];
			contexts = canvases.map(canvas => canvas.getContext('2d'));
		}
		if (id === 'lightweight') {
			check(constructed === 1 && lines.length === 3, 'chart or series recreated');
			const last = lines[0].data().at(-1).value;
			check(host.querySelector('button').textContent.includes(String(Number(last.toFixed(2)))), 'legend retained stale data');
		}
		destroy();
		// Keep the HTML direct initialization path covered separately.
		host = setupDemo(id, parent);
		const input = adapter.prepData(packed);
		chart = await adapter.makeChart(input, host, {textContent: ''});
		verify(input);
		destroy();
		return {rows: count, updates: 2, contexts: canvases.length, replacedLayers: [...replacedLayers]};
	}
	finally {
		if (chart) destroy();
		parent.remove();
		CanvasRenderingContext2D.prototype.stroke = stroke;
	}
}

describe('bench-lifecycle-native license boundary', () => {
	it('LightningChart two-row startup rejects missing licenses before touching the vendor engine', async () => {
		const saved = Object.getOwnPropertyDescriptor(globalThis, 'benchmarkLightningChartOptions');
		try {
			delete globalThis.benchmarkLightningChartOptions;
			const packed = JSON.parse(await readFile(new URL('bench/data.json', root), 'utf8'));
			const small = lightningchart.prepData(smallLifecycleData(packed));
			await assert.rejects(lightningchart.makeChart(small, {}, {textContent: ''}), /requires a user-supplied license/);
			assert.equal(typeof lightningchart.updateChart, 'function');
		}
		finally {
			if (saved) Object.defineProperty(globalThis, 'benchmarkLightningChartOptions', saved);
		}
	});
});

(process.env.TEST_BENCH_LIFECYCLE_NATIVE === '1' ? describe : describe.skip)('bench-lifecycle-native cached browser', function() {
	let browser, client, server, profile;
	const sources = new Map();
	const assets = new Map([['/', '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>']]);
	before(async () => {
		const binary = await cachedChromeBinary();
		assert.ok(binary, 'No cached Chrome executable. Run npm run bench -- --install-only or set CHROME_BIN; this test never installs a browser.');
		await access(binary, constants.X_OK);
		for (const id of variants) {
			const source = loadBenchDemoSources(root, id);
			sources.set(id, source);
			for (const [route, content] of source.files) assets.set(route, content);
			for (const dependency of source.dependencies) assets.set(dependency.route, await readFile(join(cache, dependency.cacheName)));
		}
		assets.set('/bench/data.json', await readFile(new URL('bench/data.json', root)));
		assets.set('/bench/lifecycle-data.mjs', await readFile(new URL('bench/lifecycle-data.mjs', root)));
		server = createServer((request, response) => {
			const route = new URL(request.url, 'http://localhost').pathname;
			if (!assets.has(route)) { response.writeHead(404).end(); return; }
			response.setHeader('Content-Type', route === '/' ? 'text/html' : route.endsWith('.css') ? 'text/css' : 'text/javascript');
			response.setHeader('Content-Security-Policy', "default-src 'self' data:; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
			response.end(assets.get(route));
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		profile = await mkdtemp(join(cache, 'bench-lifecycle-native-'));
		browser = spawn(binary, ['--no-first-run', '--no-default-browser-check', '--disable-background-networking',
			'--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-gpu-shader-disk-cache',
			'--disk-cache-size=1', '--media-cache-size=1', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
			'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
			'--window-size=1920,900', 'about:blank'], {stdio: 'ignore'});
		let port;
		for (let i = 0; i < 100; i++) {
			try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
			catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
		}
		assert.ok(port, 'Cached Chrome did not start');
		const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(5000)})).json();
		const socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
		client = new CDP(socket, 20000);
		await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
		await client.send('Page.enable');
		await client.send('Runtime.enable');
	}, {timeout: 45000});
	after(async () => {
		client?.close();
		if (browser) { killBenchmarkBrowser(browser); await new Promise(resolve => browser.exitCode !== null || browser.signalCode !== null ? resolve() : browser.once('exit', resolve)); }
		if (server) await new Promise(resolve => server.close(resolve));
		if (profile) await rm(profile, {recursive: true, force: true});
	}, {timeout: 45000});
	for (const id of variants) {
		it(`${id}: two-row init, two full replacements, retained contexts, teardown, and direct init`, {timeout: 45000}, async () => {
			const loaded = client.wait('Page.loadEventFired');
			await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/?variant=${id}`});
			await loaded;
			const source = sources.get(id);
			const scripts = [...source.dependencies.filter(d => d.type !== 'style').map(d => d.route), ...source.localScripts];
			const styles = [...source.dependencies.filter(d => d.type === 'style').map(d => d.route), ...source.localStyles];
			const result = await client.send('Runtime.evaluate', {awaitPromise: true, returnByValue: true, expression: `(async () => {
				for (const route of ${JSON.stringify(styles)}) await new Promise((resolve, reject) => {
					const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = route;
					link.onload = resolve; link.onerror = reject; document.head.append(link);
				});
				for (const route of ${JSON.stringify(scripts)}) await new Promise((resolve, reject) => {
					const script = document.createElement('script'); script.src = route;
					script.onload = resolve; script.onerror = reject; document.head.append(script);
				});
				return (${exercise.toString()})(${JSON.stringify(id)});
			})()`});
			assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
			assert.equal(result.result.value.rows, 55550);
		});
	}
});
