// Cache-only, serial Linux/Chrome diagnostic. No benchmark reports or source files are modified.
// node docs/investigations/benchmark-d3-retention-probe.mjs [d3-minmax|d3-svg-minmax|uplot]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';
import {readProcessMemory} from '../../scripts/bench-process-memory.mjs';

const variant = process.argv[2] ?? 'd3-minmax';
assert.ok(['d3-minmax', 'd3-svg-minmax', 'uplot'].includes(variant));
const root = new URL('../../', import.meta.url);
const binary = fileURLToPath(new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root));
const directory = await mkdtemp('/tmp/uplot-intl-memory-');
const profile = join(directory, 'profile');
let server, browser, page, browserClient;

async function connect(url) {
	const socket = new WebSocket(url);
	const client = new CDP(socket, 30000);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, {once: true});
		socket.addEventListener('error', reject, {once: true});
	});
	return client;
}

async function evaluate(expression) {
	const response = await page.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
	assert.ok(!response.exceptionDetails, response.exceptionDetails?.exception?.description ?? response.exceptionDetails?.text);
	return response.result.value;
}

async function memory() {
	for (let attempt = 0; attempt < 3; attempt++) {
		const {processInfo} = await browserClient.send('SystemInfo.getProcessInfo');
		const result = await readProcessMemory(browser.pid, {
			processTypes: new Map(processInfo.map(process => [process.id, process.type])), requireRenderer: true,
		});
		if (result.complete) return result;
		assert.ok(attempt < 2, JSON.stringify(result.issues));
		await delay(50);
	}
}

async function snapshot() {
	await page.send('HeapProfiler.collectGarbage');
	const processes = await memory();
	const heap = await page.send('Runtime.getHeapUsage');
	const mappings = {};
	for (const process of processes.processes) {
		const text = await readFile(`/proc/${process.pid}/smaps`, 'utf8');
		let path;
		for (const line of text.split('\n')) {
			const header = /^[0-9a-f]+-[0-9a-f]+\s+\S+\s+\S+\s+\S+\s+\S+\s*(.*)$/.exec(line);
			if (header) path = header[1] || '[anonymous]';
			else if (line.startsWith('Pss:')) mappings[path] = (mappings[path] ?? 0) + Number(line.split(/\s+/)[1]) * 1024;
		}
	}
	return {processes, heap, mappings};
}

try {
	const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, variant);
	files.set('/bench/data.json', await readFile(new URL('bench/data.json', root)));
	files.set('/bench.mjs', await readFile(new URL('scripts/benchmarks-trace-browser.mjs', root)));
	for (const dependency of dependencies)
		files.set(dependency.route, await readFile(new URL('.cache/benchmarks/' + dependency.cacheName, root)));
	const scripts = [...localScripts, ...dependencies.filter(d => !d.type || d.type === 'script').map(d => d.route)];
	files.set('/', '<!doctype html><meta charset="utf-8">' +
		localStyles.map(path => `<link rel="stylesheet" href="${path}">`).join('') +
		scripts.map(path => `<script src="${path}"></script>`).join('') + '<script type="module" src="/bench.mjs"></script>');
	server = createServer((request, response) => {
		const path = new URL(request.url, 'http://localhost').pathname;
		if (!files.has(path)) return response.writeHead(404).end();
		response.setHeader('Content-Type', path === '/' ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript');
		response.end(files.get(path));
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	browser = spawn(binary, ['--no-first-run', '--no-default-browser-check', '--disable-background-networking',
		'--disable-component-update', '--disable-sync', '--disable-extensions', '--enable-gpu', '--enable-features=Vulkan',
		'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
		'--window-size=1920,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
	let log = '', port;
	browser.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
			if (/^\d+$/.test(port)) break;
		}
		catch {}
		await delay(50);
	}
	assert.match(port ?? '', /^\d+$/, log);
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
	const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
	browserClient = await connect(version.webSocketDebuggerUrl);
	await page.send('Page.enable');
	await page.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: 1, mobile: false});
	const loaded = page.wait('Page.loadEventFired');
	await page.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/?variant=${variant}`});
	await loaded;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await evaluate('globalThis.benchmarkTraceReady === true')) break;
		await delay(50);
	}
	assert.equal(await evaluate('globalThis.benchmarkTraceReady === true'), true);
	await evaluate('benchmarkLifecycle.begin()');
	// Three warmups, then one live chart. The intervention changes neither data nor drawing.
	for (let round = 0; round < 4; round++) {
		await evaluate(`benchmarkLifecycle.setup(${JSON.stringify(variant)}, 'sample-${round * 2}')`);
		await page.send('HeapProfiler.collectGarbage');
		for (const [index, operation] of ['small-init', 'data-update'].entries()) {
			await evaluate(`benchmarkLifecycle.prepare('${operation}', 'sample-${round * 2 + index}')`);
			await evaluate('benchmarkLifecycle.construct()');
		}
		if (round < 3) {
			await evaluate('benchmarkLifecycle.destroy()');
			await page.send('HeapProfiler.collectGarbage');
		}
	}
	const before = await snapshot();
	await evaluate('new Intl.NumberFormat(); new Intl.DateTimeFormat().resolvedOptions().timeZone; void 0');
	await delay(200);
	const after = await snapshot();
	const mappingDeltas = Object.fromEntries([...new Set([...Object.keys(before.mappings), ...Object.keys(after.mappings)])]
		.map(path => [path, ((after.mappings[path] ?? 0) - (before.mappings[path] ?? 0)) / 1e6])
		.filter(([, delta]) => Math.abs(delta) >= 0.001).sort((a, b) => b[1] - a[1]));
	const summary = {variant, browser: version.Browser,
		treePssDeltaMB: after.processes.tree.pssMB - before.processes.tree.pssMB,
		rendererPssDeltaMB: after.processes.renderer.pssMB - before.processes.renderer.pssMB,
		jsHeapDeltaBytes: after.heap.usedSize - before.heap.usedSize, mappingDeltas};
	await writeFile(join(directory, 'results.json'), JSON.stringify({summary, before, after}, null, 2));
	console.log(JSON.stringify(summary, null, 2));
	console.log('Evidence:', join(directory, 'results.json'));
	await evaluate('benchmarkLifecycle.destroy()');
}
finally {
	page?.close();
	browserClient?.close();
	if (browser) await killBenchmarkBrowser(browser);
	if (server) await new Promise(resolve => server.close(resolve));
	await rm(profile, {recursive: true, force: true});
}
