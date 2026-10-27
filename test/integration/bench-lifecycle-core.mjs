import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';

// Cache-only, no downloads, screenshots, traces or reports. Use TMPDIR=/dev/shm
// when disk space is limited. ChartGPU's separate module bundle is not required.
// TEST_BENCH_LIFECYCLE_CORE=1 node --test --test-isolation=none test/integration/bench-lifecycle-core.mjs
const root = new URL('../../', import.meta.url);
const ids = ['uplot', 'plotly', 'plotly-svg', 'scichart', 'deckgl', 'chartjs', 'echarts', 'highcharts', 'highcharts-svg'];

async function sample(id) {
	const check = (ok, message) => { if (!ok) throw new Error(`${id}: ${message}`); };
	const adapter = await import(`/bench/${id}.mjs`);
	const {smallLifecycleData} = await import('/bench/lifecycle-data.mjs');
	const packed = await (await fetch('/bench/data.json')).json();
	const fields = packed[0];
	const contexts = new Set();
	const getContext = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function(...args) {
		const context = getContext.apply(this, args);
		// Boost rebuilds marker textures on temporary 2D canvases; its WebGL
				// renderer must still retain the original context.
				if (context && (id !== 'highcharts' || args[0] !== '2d')) contexts.add(context);
		return context;
	};
	const columns = input => {
		if (id === 'uplot' || id.startsWith('plotly')) return input;
		if (id === 'chartjs') return [input[0].map(p => p.x), ...input.map(a => a.map(p => p.y))];
		if (id === 'echarts') return [0, 1, 2, 3].map(k => Array.from(input).filter((_, i) => i % 4 === k));
		if (id.startsWith('highcharts')) return [input[0].columns.x, ...input.map(s => s.columns.y)];
		return [input.x, input.cpu, input.ram, input.tcp];
	};
	const native = chart => {
		if (id === 'uplot') return chart.data.slice(1).map(y => [chart.data[0], y]);
		if (id.startsWith('plotly')) return chart.data.map(s => [s.x, s.y]);
		if (id === 'chartjs') return chart.data.datasets.map(s => { const data = s._data ?? s.data; return [data.map(p => p.x), data.map(p => p.y)]; });
		if (id.startsWith('highcharts')) return chart.series.map(s => [s.getColumn('x'), s.getColumn('y')]);
		if (id === 'scichart') return chart.renderableSeries.asArray().map(s => {
			const data = s.dataSeries, x = data.getNativeXValues(), y = data.getNativeYValues();
			return [Array.from({length: data.count()}, (_, i) => x.get(i)), Array.from({length: data.count()}, (_, i) => y.get(i))];
		});
		if (id === 'echarts') return chart.getModel().getSeries().map(s => {
			const data = s.getRawData();
			return ['x', 'y'].map(axis => Array.from({length: data.count()}, (_, i) => data.get(data.mapDimension(axis), i)));
		});
		return chart.deck.props.layers.map(s => {
			const path = s.props.data[0] ?? [];
			return [Array.from(path).filter((_, i) => i % 2 === 0), Array.from(path).filter((_, i) => i % 2 === 1)];
		});
	};
	try {
		for (const small of [true, false]) {
			const host = document.createElement('div');
			host.style.cssText = 'width:1920px;height:600px;position:relative';
			if (id === 'chartjs') host.innerHTML = '<canvas id="chart1"></canvas>';
			document.body.append(host);
			let chart;
			try {
				const input = adapter.prepData(small ? smallLifecycleData(packed) : packed);
				chart = await (small ? adapter.makeLifecycleChart ?? adapter.makeChart : adapter.makeChart)(input, host, {textContent: ''});
				check(native(chart).every(([x, y]) => x.length === (small ? 2 : 55550) && y.length === x.length), 'initial native counts');
				const instance = chart.deck ?? chart;
				const series = id === 'scichart' ? chart.renderableSeries.asArray().slice() : id.startsWith('highcharts') || id === 'uplot' ? chart.series.slice() : null;
				const dataSeries = id === 'scichart' ? series.map(s => s.dataSeries) : null;
				let previousContexts;
				for (const offset of [10, 30]) {
					const next = packed.slice();
					for (let i = fields + 1; i < next.length; i += fields) {
						next[i] += offset * 100000;
						next[i + 1] = 20 + (i % (offset + 5));
						next[i + 3] = offset + (i % (offset + 9));
						next[i + 5] = offset + 10 + (i % (offset + 7));
					}
					const input = adapter.prepData(next), expected = columns(input);
					check(await adapter.updateChart(chart, input, host, {textContent: ''}) === undefined, 'update returned a chart');
					check((chart.deck ?? chart) === instance, 'native instance changed');
					if (series) {
						const current = id === 'scichart' ? chart.renderableSeries.asArray() : chart.series;
						check(series.every((s, i) => s === current[i]), 'native series changed');
						if (dataSeries) check(dataSeries.every((s, i) => s === current[i].dataSeries), 'native data series changed');
					}
					if (previousContexts) check([...contexts].every(c => previousContexts.has(c)), 'replacement acquired a new context');
					previousContexts = new Set(contexts);
					const actual = native(chart);
					check(actual.length === 3 && actual.every(([x, y]) => x.length === 55550 && y.length === 55550), 'replacement native counts');
					if (id !== 'deckgl') {
						for (let s = 0; s < 3; s++) for (const j of [0, 1234, 27775, 55549]) {
							check(actual[s][0][j] === expected[0][j], `native x ${s}/${j}`);
							check(actual[s][1][j] === expected[s + 1][j], `native y ${s}/${j}`);
						}
					}
					else {
						check(chart.context && !chart.context.isContextLost(), 'retained WebGL context');
						const pct = d3.scaleLinear().domain([Math.min(d3.min(input.cpu), d3.min(input.ram)), Math.max(d3.max(input.cpu), d3.max(input.ram))]).nice().range([500, 0]);
						const mb = d3.scaleLinear().domain(d3.extent(input.tcp)).nice().range([500, 0]);
						const x = d3.scaleTime().domain(d3.extent(input.x)).range([0, 1770]);
						for (let s = 0; s < 3; s++) for (const j of [0, 1234, 27775, 55549]) {
							check(actual[s][0][j] === x(expected[0][j]), 'projected x');
							check(actual[s][1][j] === (s === 2 ? mb : pct)(expected[s + 1][j]), 'projected y');
						}
					}
					if (id.startsWith('plotly')) check(+new Date(chart._fullLayout.xaxis.range[0]) === expected[0][0], 'x range did not move');
				}
			}
			finally {
				if (chart) {
					if (adapter.destroyChart) adapter.destroyChart(chart);
					else if (id === 'echarts') chart.dispose();
					else chart.destroy();
				}
				host.remove();
			}
		}
	}
	finally { HTMLCanvasElement.prototype.getContext = getContext; }
	return {id, rows: 55550, starts: 2, replacements: 4};
}

(process.env.TEST_BENCH_LIFECYCLE_CORE === '1' ? describe : describe.skip)('cached native lifecycle core', function() {
	let browser, client, server, profile;
	const assets = new Map([['/', '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>']]);
	const evaluate = async expression => {
		const result = await client.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
		return result.result.value;
	};
	before(async () => {
		assets.set('/bench/data.json', await readFile(new URL('bench/data.json', root)));
		assets.set('/bench/lifecycle-data.mjs', await readFile(new URL('bench/lifecycle-data.mjs', root)));
		server = createServer((request, response) => {
			if (!assets.has(request.url)) { response.writeHead(404).end(); return; }
			response.setHeader('Content-Type', request.url === '/' ? 'text/html' : request.url.endsWith('.wasm') ? 'application/wasm' : request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
			response.end(assets.get(request.url));
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		profile = await mkdtemp(join(tmpdir(), 'bench-lifecycle-core-'));
		const binary = fileURLToPath(new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root));
		browser = spawn(binary, ['--enable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check',
			'--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
			'--disk-cache-size=1048576', '--media-cache-size=1048576', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
			'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
		let log = '', port;
		browser.stderr.on('data', chunk => { log = (log + chunk).slice(-2000); });
		for (let i = 0; i < 100; i++) {
			try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
			catch { await delay(50); }
		}
		assert.ok(port, log);
		const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
		client = new CDP(socket, 60000);
		await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
		await client.send('Page.enable');
	}, {timeout: 120000});
	after(async () => {
		client?.close();
		if (browser) await killBenchmarkBrowser(browser);
		if (server) await new Promise(resolve => server.close(resolve));
		if (profile) await rm(profile, {recursive: true, force: true});
	}, {timeout: 120000});
	for (const id of ids) it(`${id}: two-row/full-data starts and repeated full replacements`, {timeout: 120000}, async () => {
		const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, id);
		for (const [route, data] of files) assets.set(route, data);
		for (const dependency of dependencies) {
			assert.notEqual(dependency.type, 'module');
			assets.set(dependency.route, await readFile(new URL('.cache/benchmarks/' + dependency.cacheName, root)));
		}
		await client.send('Page.stopLoading');
		const loaded = client.wait('Page.loadEventFired');
		await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/`});
		await loaded;
		await evaluate(`(async () => {
			for (const route of ${JSON.stringify(localStyles)}) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = route; document.head.append(link); }
			for (const route of ${JSON.stringify([...localScripts, ...dependencies.filter(d => !d.type || d.type === 'script').map(d => d.route)])}) {
				await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = route; script.onload = resolve; script.onerror = reject; document.head.append(script); });
			}
			globalThis.benchmarkSciChartOptions = ${JSON.stringify(Object.fromEntries(dependencies.filter(d => d.type === 'wasm').map(d => [d.option.replace('Binary', 'Url'), d.route])))};
		})()`);
		const result = await evaluate(`(${sample.toString()})(${JSON.stringify(id)})`);
		assert.equal(result.replacements, 4);
	});
});
