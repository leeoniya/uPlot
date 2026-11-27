// node scripts/bench-heatmap-chrome.mjs [variant ...] [--timeout-ms 240000]
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { killBenchmarkBrowser } from './bench-browser-process.mjs';
import { variants, setup } from './bench-heatmap-loops.mjs';
import { cachedChromeBinary, chromeBinary } from './chrome-headless-shell.mjs';
import { CDP } from './profile-manual.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
	'timeout-ms': { type: 'string', default: '240000' },
} });
const timeout = Number(values['timeout-ms']);
if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647)
	throw new Error('--timeout-ms must be a positive 32-bit integer');
const names = [...new Set(positionals.length ? positionals : Object.keys(variants))];
if (!names.includes('baseline')) names.unshift('baseline');

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map([
	['/', '<!doctype html><meta charset="utf-8"><script src="/dist/uPlot.iife.js"></script><body></body>'],
	['/setup.js', `export default (${setup.toString()});`],
]);
for (const name of names) {
	if (!/^[\w][\w-]*$/.test(name) || !Object.hasOwn(variants, name) || typeof variants[name] !== 'string')
		throw new Error(`Invalid variant: ${name}. Available: ${Object.keys(variants).join(', ')}`);
	assets.set(`/demos/lib/heatmap-variant-${name}.js`, variants[name]);
}
for (const path of ['dist/uPlot.iife.js', ...['heatmapCellsData', 'heatmapFrameAdapters', 'heatmapFrame', 'heatmapColorLut'].map(name => `demos/lib/${name}.js`)])
	assets.set('/' + path, readFileSync(join(root, path)));

async function pageEndpoint(profile, signal) {
	const file = join(profile, 'DevToolsActivePort');
	for (;;) {
		signal.throwIfAborted();
		const port = existsSync(file) && readFileSync(file, 'utf8').split('\n')[0];
		if (port) {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal });
			if (!response.ok) throw new Error(`Chrome target discovery: HTTP ${response.status}`);
			const page = (await response.json()).find(target => target.type === 'page');
			if (page) return page.webSocketDebuggerUrl;
		}
		await delay(50, undefined, { signal });
	}
}

const server = createServer((req, res) => {
	if (req.method !== 'GET' || !assets.has(req.url)) return res.writeHead(404).end();
	res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript' }).end(assets.get(req.url));
});
const controller = new AbortController();
const interrupt = () => controller.abort(new Error('Benchmark interrupted'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let profile, browser, closed, client;
const disconnect = () => client?.fail(controller.signal.reason);
controller.signal.addEventListener('abort', disconnect);
let timer;
try {
	const { signal } = controller;
	const binary = await cachedChromeBinary({ signal }) ?? await chromeBinary({ signal });
	timer = setTimeout(() => controller.abort(new Error(`Benchmark exceeded ${timeout} ms`)), timeout);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening', { signal });
	const url = `http://127.0.0.1:${server.address().port}/`;
	profile = mkdtempSync(join(tmpdir(), 'uplot-heatmap-'));
	browser = spawn(binary, ['--headless', '--disable-background-networking', '--no-first-run', '--js-flags=--detailed-line-info',
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
		{ stdio: ['ignore', 'ignore', 'inherit'] });
	closed = new Promise(resolve => browser.once('close', resolve));
	browser.once('error', error => controller.abort(error));
	browser.once('exit', (code, sig) => controller.abort(new Error(`Chrome exited (${code ?? sig})`)));

	const startup = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
	const socket = new WebSocket(await pageEndpoint(profile, startup));
	client = new CDP(socket, timeout);
	await once(socket, 'open', { signal: startup });
	const chromeVersion = await client.send('Browser.getVersion');
	await client.send('Page.enable');
	await Promise.all([client.wait('Page.loadEventFired'), client.send('Page.navigate', { url })]);
	async function evaluate(expression) {
		const { result, exceptionDetails } = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
		return result.value;
	}
	await evaluate(`import('${url}setup.js').then(async ({default: setup}) => {
		if (typeof uPlot !== 'function') throw new Error('uPlot did not load');
		globalThis.heatmapBench = await setup(${JSON.stringify(names)});
	})`);
	const report = await evaluate('heatmapBench.measure()');
	const output = join(root, '.cache/heatmap-loops');
	mkdirSync(output, { recursive: true });
	const run = mkdtempSync(join(output, new Date().toISOString().replaceAll(':', '-') + '-'));
	writeFileSync(join(run, 'report.json'), JSON.stringify({ chromeVersion, names, report }, null, 2) + '\n');
	console.log('Run:', run, '\nFixture:', report.fixture);
	console.table(report.summary);

	await client.send('Profiler.enable');
	for (const name of ['baseline', 'working'].filter(name => names.includes(name))) {
		await client.send('Profiler.start');
		await evaluate(`void heatmapBench.profile(${JSON.stringify(name)})`);
		const { profile } = await client.send('Profiler.stop');
		writeFileSync(join(run, `${name}.cpuprofile`), JSON.stringify(profile));
	}
}
catch (error) {
	throw controller.signal.reason ?? error;
}
finally {
	clearTimeout(timer);
	controller.signal.removeEventListener('abort', disconnect);
	client?.close();
	server.close();
	server.closeAllConnections();
	try {
		if (browser?.pid) killBenchmarkBrowser(browser);
		await closed;
	}
	finally {
		if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
		process.removeListener('SIGINT', interrupt);
		process.removeListener('SIGTERM', interrupt);
	}
}
