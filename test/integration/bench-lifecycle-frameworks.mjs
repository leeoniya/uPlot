import {describe, it, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {frameworkDependencies} from '../../bench/framework-runtime.mjs';

const root = new URL('../../', import.meta.url);
const cache = new URL('.cache/benchmarks/', root);
const ids = ['d3', 'd3-svg', 'd3fc', 'd3fc-canvas', 'bokeh', 'bokeh-canvas', 'visx', 'financialcharts', 'muicharts', 'recharts', 'vega', 'g2', 'billboard'];
const scripts = {
	d3: ['d3-7.9.0-dist-d3.min.js'],
	d3fc: ['d3-7.9.0-dist-d3.min.js', 'd3fc-15.2.13-build-d3fc.min.js'],
	bokeh: ['bokeh-bokehjs-3.10.1-build-js-bokeh.min.js', 'bokeh-bokehjs-3.10.1-build-js-bokeh-gl.min.js', 'bokeh-bokehjs-3.10.1-build-js-bokeh-api.min.js'],
	vega: ['vega-6.4.0-build-vega.min.js'],
	g2: ['antv-g2-5.4.8-dist-g2.min.js'],
	billboard: ['billboard.js-4.1.3-dist-billboard.pkgd.min.js'],
};
scripts['d3-svg'] = scripts.d3;
scripts['d3fc-canvas'] = scripts.d3fc;
scripts['bokeh-canvas'] = scripts.bokeh;

// Run explicitly: BENCH_LIFECYCLE_FRAMEWORKS=1 node --test --test-isolation=none test/integration/bench-lifecycle-frameworks.mjs
// Reads existing pinned bundles only. No downloads, bundles, screenshots or reports.
// Chrome's temporary profile goes to tmpfs on the benchmark machine, not the vendor cache.
async function exercise(id) {
	const adapter = await import(`/bench/${id}.mjs`);
	if (['visx', 'financialcharts', 'muicharts', 'recharts'].includes(id))
		Object.assign(globalThis, await import(`/vendor/${id}.mjs`));
	const packed = await (await fetch('/packed.json')).json();
	const check = (value, message) => { if (!value) throw new Error(`${id}: ${message}`); };
	const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message);
	const host = document.createElement('div');
	host.style.cssText = 'width:1920px;height:600px';
	document.body.append(host);
	function fixture() {
		if (id === 'd3' || id === 'd3-svg') host.innerHTML = '<span id="cpu-value"></span><span id="ram-value"></span><span id="tcp-value"></span>' +
			(id === 'd3' ? '<canvas id="plot"></canvas><canvas id="overlay"></canvas>' : '<svg id="plot" width="1920" height="600"></svg>');
	}
	function elements(root = host) {
		return [...root.querySelectorAll('*')].flatMap(node => [node, ...(node.shadowRoot ? elements(node.shadowRoot) : [])]);
	}
	function signature(chart) {
		const all = elements();
		const result = {
			paths: all.filter(node => node.localName === 'path').map(node => node.getAttribute('d')),
			text: all.filter(node => node.localName === 'text').map(node => node.textContent),
		};
		if (id.startsWith('bokeh')) {
			result.ranges = [chart.model.x_range, chart.model.y_range, chart.model.extra_y_ranges.mb].map(range => [range.start, range.end]);
			result.rows = chart.model.renderers.filter(r => r.data_source).map(r => r.data_source.data.x.length);
		}
		if (id === 'financialcharts') {
			result.ranges = [chart.instance.state.xScale, ...chart.instance.state.chartConfigs.map(c => c.yScale)].map(scale => scale.domain().map(Number));
			result.rows = chart.instance.state.plotData.length;
		}
		if (id === 'vega') {
			result.ranges = ['x', 'percent', 'tcp'].map(key => chart.scale(key).domain().map(Number));
			result.rows = chart.data('table').length;
		}
		if (id === 'g2') {
			result.rows = chart.options().data.length;
			result.ranges = chart.getView().children.map(view => Object.fromEntries(Object.entries(view.scale).map(([key, scale]) => [key, scale.getOptions().domain])));
		}
		if (id === 'billboard') {
			result.rows = chart.data().map(series => series.values.length);
			result.ranges = ['x', 'y', 'y2'].map(key => chart.internal.scale[key].domain().map(Number));
		}
		if (id.startsWith('d3fc'))
			result.ranges = [chart.series[0].xScale(), chart.series[0].yScale(), chart.series[2].yScale()].map(scale => scale.domain().map(Number));
		// Compare real raster output too, except WebGL surfaces (the browser may
		// discard their drawing buffers). Bokeh's ranges and native sources are
		// checked above; its shared GL backing canvas is not chart-owned.
		if (!['bokeh', 'd3fc'].includes(id)) result.pixels = all.filter(node => node.localName === 'canvas').map(canvas => {
			const ctx = canvas.getContext('2d');
			if (!ctx) return null;
			const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
			const sums = [0, 0, 0, 0];
			for (let i = 0; i < bytes.length; i++) sums[i % 4] += bytes[i];
			return sums;
		});
		return result;
	}
	const destroy = chart => {
		if (adapter.destroyChart) adapter.destroyChart(chart);
		else chart.destroy();
		host.replaceChildren();
	};
	const data1 = adapter.prepData(packed);
	const changed = packed.slice();
	for (let i = packed[0] + 1; i < changed.length; i += packed[0]) {
		changed[i] += 1000000;
		changed[i + 1] = 50 + (changed[i + 1] - 50) / 2;
		changed[i + 3] = changed[i + 3] * 2 + 150;
		changed[i + 5] *= 0.5;
	}
	const data2 = adapter.prepData(changed);
	const original1 = JSON.stringify(data1), original2 = JSON.stringify(data2);
	const expected = [];
	for (const data of [data1, data2]) {
		fixture();
		const direct = await adapter.makeChart(data, host, {textContent: ''});
		try { expected.push(signature(direct)); }
		finally { destroy(direct); }
	}
	fixture();
	const wait = {textContent: ''};
	const chart = await adapter.makeEmptyChart(host, wait);
	try {
		check(wait.textContent === 'Done!', 'empty readiness');
		const root = chart.root, instance = chart.instance, model = chart.model;
		const series = chart.series?.slice();
		const gl = chart.getWebGLContexts?.();
		const surfaces = elements().filter(node => ['canvas', 'svg'].includes(node.localName) && Number(node.getAttribute('width')) > 100);
		const paths = id === 'd3-svg' ? [...host.querySelectorAll('.series path')] : [];
		check(surfaces.length > 0, 'empty chart has no surface');
		if (id.startsWith('bokeh')) check(chart.model.renderers.filter(r => r.data_source).every(r => r.data_source.data.x.length === 0), 'empty Bokeh source');
		if (id === 'financialcharts') check(chart.instance.state.plotData.length === 0, 'empty financial data');
		if (id === 'vega') check(chart.data('table').length === 0, 'empty Vega data');
		if (id === 'g2') check(chart.options().data.length === 0, 'empty G2 data');
		if (id === 'billboard') check(chart.data().length === 3 && chart.data().every(s => s.values.length === 0), 'empty Billboard series');
		for (const [index, data] of [data1, data2].entries()) {
			wait.textContent = 'Updating';
			check(await adapter.updateChart(chart, data, host, wait) === undefined, 'update returned a replacement handle');
			check(wait.textContent === 'Done!', 'update readiness');
			check(chart.root === root && chart.instance === instance && chart.model === model, 'native instance changed');
			if (series) check(series.every((value, i) => chart.series[i] === value), 'native series changed');
			if (gl) check(gl.every((value, i) => chart.getWebGLContexts()[i] === value), 'GL context changed');
			check(surfaces.every(node => elements().includes(node)), 'native chart surface replaced');
			check(paths.every((path, i) => host.querySelectorAll('.series path')[i] === path), 'D3 path replaced');
			const actual = signature(chart);
			for (const key of Object.keys(expected[index])) equal(actual[key], expected[index][key], `update ${index + 1} differs from direct chart: ${key}` + (key === 'pixels' ? JSON.stringify([actual[key], expected[index][key]]) : ''));
		}
		equal(JSON.stringify(data1), original1, 'first input mutated');
		equal(JSON.stringify(data2), original2, 'second input mutated');
	}
	finally { destroy(chart); host.remove(); }
	return {rows: (packed.length - packed[0] - 1) / packed[0], updates: 2};
}

(process.env.BENCH_LIFECYCLE_FRAMEWORKS === '1' ? describe : describe.skip)('cached native framework lifecycle', function() {
	let server, browser, client, profile;
	const assets = new Map();
	const errors = [];
	before(async () => {
		const binary = process.env.CHROME_BIN || fileURLToPath(new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root));
		assert.ok(existsSync(binary), 'Cached Chrome required; this test never downloads it.');
		for (const name of [...ids, 'framework-runtime', 'lifecycle-frameworks'])
			assets.set(`/bench/${name}.mjs`, readFileSync(new URL(`bench/${name}.mjs`, root)));
		for (const name of new Set(Object.values(scripts).flat())) assets.set('/vendor/' + name, readFileSync(new URL(name, cache)));
		const moduleCache = new URL('modules/', cache);
		const metadata = readdirSync(moduleCache).filter(name => name.startsWith('modules-') && name.endsWith('.json'));
		for (const [id, dependencies] of Object.entries(frameworkDependencies)) {
			const file = metadata.find(name => JSON.stringify(JSON.parse(readFileSync(new URL(name, moduleCache))).dependencies) === JSON.stringify(dependencies));
			assert.ok(file, `Cached pinned ${id} bundle required; no downloads or rebuilds.`);
			const meta = JSON.parse(readFileSync(new URL(file, moduleCache)));
			const code = readFileSync(new URL(file.slice(0, -5), moduleCache));
			assert.equal(createHash('sha256').update(code).digest('hex'), meta.sha256);
			assets.set(`/vendor/${id}.mjs`, code);
		}
		assets.set('/packed.json', readFileSync(new URL('bench/data.json', root)));
		for (const id of ids) assets.set('/' + id, '<!doctype html><body>' + (scripts[id] || []).map(name => `<script src="/vendor/${name}"></script>`).join(''));
		server = createServer((req, res) => {
			if (!assets.has(req.url)) { res.writeHead(404).end(); return; }
			res.setHeader('Content-Type', req.url.endsWith('.json') ? 'application/json' : /\.m?js$/.test(req.url) ? 'text/javascript' : 'text/html');
			res.end(assets.get(req.url));
		});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		profile = await mkdtemp(join(tmpdir(), 'bench-lifecycle-frameworks-'));
		browser = spawn(binary, ['--no-sandbox', '--headless', '--no-first-run', '--disable-background-networking',
			'--disable-component-update', '--disable-sync', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
			'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile,
			'--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
		let log = '', port;
		browser.stderr.on('data', chunk => { log = (log + chunk).slice(-3000); });
		for (let i = 0; i < 150; i++) {
			try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
			catch { await delay(50); }
		}
		assert.ok(port, log);
		const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
		client = new CDP(socket, 80000);
		await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);
			if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description);
		});
		await client.send('Page.enable'); await client.send('Runtime.enable');
	}, {timeout: 90000});
	after(async () => {
		client?.close();
		if (browser && browser.exitCode === null) {
			browser.kill('SIGKILL');
			await new Promise(resolve => browser.once('exit', resolve));
		}
		server?.closeAllConnections();
		if (server?.listening) await new Promise(resolve => server.close(resolve));
		if (profile) await rm(profile, {recursive: true, force: true});
	}, {timeout: 90000});
	for (const id of ids) it(`${id}: empty -> full -> fresh full, native identity, direct-render parity`, {timeout: 90000}, async () => {
		errors.length = 0;
		const loaded = client.wait('Page.loadEventFired');
		await client.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/${id}`});
		await loaded;
		const result = await client.send('Runtime.evaluate', {expression: `(${exercise.toString()})(${JSON.stringify(id)})`, awaitPromise: true, returnByValue: true});
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		assert.deepEqual(result.result.value, {rows: 55550, updates: 2});
		assert.deepEqual(errors, []);
	});
});
