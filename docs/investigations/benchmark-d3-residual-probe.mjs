// Cache-only, serial Linux/Chrome diagnostic. No benchmark reports or source files are modified.
// node docs/investigations/benchmark-d3-residual-probe.mjs [d3-minmax|uplot|uplot:arial] [fonts|canvas|grid]
// Same-live-chart interventions; canvas reset is a destructive diagnostic, not an optimization.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';
import {readProcessMemory} from '../../scripts/bench-process-memory.mjs';

const spec = process.argv[2] ?? 'd3-minmax';
const [variant, modifier] = spec.split(':');
const experiment = process.argv[3] ?? 'fonts';
assert.ok(['d3-minmax', 'uplot', 'uplot:arial'].includes(spec));
assert.ok(['fonts', 'canvas', 'grid'].includes(experiment));
const root = new URL('../../', import.meta.url);
const binary = fileURLToPath(new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root));
const probeSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const directory = await mkdtemp('/tmp/uplot-residual-probe-');
console.log('Output:', directory);
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
	await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200))))');
	await page.send('HeapProfiler.collectGarbage');
	const processes = await memory();
	const heap = await page.send('Runtime.getHeapUsage');
	const mappings = {};
	const byRole = {};
	const binaryByProtection = {};
	for (const process of processes.processes) {
		const text = await readFile(`/proc/${process.pid}/smaps`, 'utf8');
		let path, protection;
		for (const line of text.split('\n')) {
			const header = /^[0-9a-f]+-[0-9a-f]+\s+(\S+)\s+\S+\s+\S+\s+\S+\s*(.*)$/.exec(line);
			if (header) {protection = header[1]; path = header[2] || '[anonymous]';}
			else if (line.startsWith('Pss:')) {
								const bytes = Number(line.split(/\s+/)[1]) * 1024;
								mappings[path] = (mappings[path] ?? 0) + bytes;
								const role = byRole[process.type] ??= {};
								role[path] = (role[path] ?? 0) + bytes;
								if (path === binary) {
									const scope = binaryByProtection[process.type] ??= {};
									scope[protection] = (scope[protection] ?? 0) + bytes;
								}
							}
		}
	}
	return {processes, heap, mappings, byRole, binaryByProtection};
}

try {
	const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, variant);
	if (modifier === 'arial') {
		let count = 0;
		for (const route of [...localScripts, ...localStyles]) {
			const source = files.get(route).toString();
			count += source.split('system-ui').length - 1;
			files.set(route, source.replaceAll('system-ui', 'Arial'));
		}
		assert.equal(count, 2);
	}
	files.set('/bench/data.json', await readFile(new URL('bench/data.json', root)));
	files.set('/bench.mjs', await readFile(new URL('scripts/benchmarks-trace-browser.mjs', root)));
	for (const dependency of dependencies)
		files.set(dependency.route, await readFile(new URL('.cache/benchmarks/' + dependency.cacheName, root)));
	files.set('/bench/runtime-assets.json', '[]');
		files.set('/bench/module-assets.json', '[]');
		const sourceSha256 = Object.fromEntries([...files].map(([route, source]) => [route, createHash('sha256').update(source).digest('hex')]));
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
	// Three warmups, then one live chart.
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
	const geometry = await evaluate(`Array.from(document.querySelectorAll('canvas,.u-title,.u-legend,.u-cursor-x,.u-cursor-y,.u-cursor-pt')).map(el => {
		const s = getComputedStyle(el); return {tag:el.tagName,id:el.id,class:el.className,width:el.width,height:el.height,rect:el.getBoundingClientRect().toJSON(),font:s.font,display:s.display,willChange:s.willChange};
	})`);
	const steps = experiment === 'fonts' ? [
		['noop', 'void 0'],
		...['10px Arial', '12px system-ui', 'bold 18px system-ui', '600 14px system-ui', '14px system-ui'].map(font => [font, `(() => {
			const c = document.createElement('canvas'); c.width = 300; c.height = 30;
			const ctx = c.getContext('2d'); ctx.font = ${JSON.stringify(font)};
			ctx.fillText('Server Events CPU: RAM: TCP Out: 0123456789% MB', 0, 20);
			c.width = 0;
		})()`]),
		['noop-final', 'void 0'],
	] : experiment === 'grid' ? [
		['noop', 'void 0'],
		...['plain', 'block', 'grid', 'grid'].map((display, index) => [`layout-${display}-${index}`, `(() => {
			const el = document.createElement('div');
			el.style.cssText = 'position:absolute;top:-100px;width:1px;display:${display === 'plain' ? 'block' : display};${display === 'plain' ? '' : 'grid-template-columns:max-content auto max-content;grid-template-areas:"tit tit tit" ". top ." "lft plot rgt" ". btm ."'}';
			for (const area of ['tit','plot','btm']) {
				const child = document.createElement('div'); child.style.cssText = 'width:1px;height:1px;${display === 'plain' ? '' : "grid-area:' + area + '"}'; el.append(child);
			}
			document.body.append(el); el.getBoundingClientRect(); el.remove();
		})()`]),
		['noop-final', 'void 0'],
	] : [
		['noop', 'void 0'],
		['beginPath', "document.querySelectorAll('canvas').forEach(c => c.getContext('2d').beginPath())"],
		['no-promotion', "(() => {const s=document.createElement('style');s.textContent='.u-cursor-x,.u-cursor-y,.u-cursor-pt{will-change:auto!important}';document.head.append(s)})()"],
		['reset-canvas', "document.querySelectorAll('canvas').forEach(c => {c.width=c.width})"],
		['noop-final', 'void 0'],
	];
	const snapshots = [{label:'before', ...await snapshot()}];
	const summary = [];
	for (const [label, expression] of steps) {
		const before = snapshots.at(-1);
		await evaluate(expression + '; void 0');
		const after = {label, ...await snapshot()};
		snapshots.push(after);
		const mappingDeltas = Object.fromEntries([...new Set([...Object.keys(before.mappings), ...Object.keys(after.mappings)])]
			.map(path => [path, ((after.mappings[path] ?? 0) - (before.mappings[path] ?? 0)) / 1e6])
			.filter(([, delta]) => Math.abs(delta) >= 0.001).sort((a, b) => b[1] - a[1]));
		const row = {label, treePssDeltaMB: after.processes.tree.pssMB - before.processes.tree.pssMB,
			rendererPssDeltaMB: after.processes.renderer.pssMB - before.processes.renderer.pssMB,
			jsHeapDeltaBytes: after.heap.usedSize - before.heap.usedSize, mappingDeltas};
		summary.push(row);
		console.log(JSON.stringify(row));
	}
	await writeFile(join(directory, 'results.json'), JSON.stringify({spec, experiment, browser:version.Browser, probeSha256, sourceSha256, geometry, summary, snapshots}, null, 2));
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
