// Run from the repository root: node --max-old-space-size=128 artifacts/point-alignment/capture.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
const output = new URL('./', import.meta.url);
const baseline = execFileSync('git', ['--no-pager', 'show', '8c0bce3:dist/uPlot.esm.js'], { cwd: root });
const profile = mkdtempSync(join(tmpdir(), 'uplot-alignment-'));
writeFileSync(join(profile, 'user.js'), [
	'user_pref("browser.shell.checkDefaultBrowser", false);',
	'user_pref("browser.sessionstore.resume_from_crash", false);',
	'user_pref("dom.ipc.processCount", 1);',
	'user_pref("fission.autostart", false);',
	'user_pref("layout.css.devPixelsPerPx", "2.0");',
].join('\n'));
const page = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/uPlot.css"><style>body{margin:20px;background:white}</style><script type="module" src="/artifacts/point-alignment/page.mjs"></script>';
const server = createServer((req, res) => {
	try {
		const path = new URL(req.url, 'http://localhost').pathname;
		if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); }
		else {
			res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
			res.end(path === '/baseline.mjs' ? baseline : readFileSync(new URL(path === '/current.mjs' ? 'dist/uPlot.esm.js' : '.' + path, root)));
		}
	}
	catch { res.writeHead(404); res.end(); }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, socket, context;
let log = '';
let nextId = 0;
const pending = new Map();
function command(method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = ++nextId;
		const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 15000);
		pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
		socket.send(JSON.stringify({ id, method, params }));
	});
}
async function evaluate(expression) {
	const response = await command('script.evaluate', { expression, target: { context }, awaitPromise: true });
	if (response.type === 'exception') throw new Error(JSON.stringify(response.exceptionDetails));
	return response.result.value;
}
async function screenshot(name) {
	await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
	const { data } = await command('browsingContext.captureScreenshot', { context, origin: 'viewport' });
	writeFileSync(new URL(name + '.png', output), Buffer.from(data, 'base64'));
}
const deadline = setTimeout(() => {
	console.error('Screenshot capture exceeded 90 seconds.');
	if (browser?.pid) { try { process.kill(-browser.pid, 'SIGKILL'); } catch {} }
}, 90000);
try {
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const portServer = createSocketServer();
	await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
	const port = portServer.address().port;
	await new Promise(resolve => portServer.close(resolve));
	browser = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [browser.stdout, browser.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-8000); });
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			socket = new WebSocket('ws://127.0.0.1:' + port + '/session');
			await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
			break;
		}
		catch { if (attempt === 39) throw new Error('Firefox connection failed: ' + log); await sleep(250); }
	}
	socket.addEventListener('message', event => {
		const message = JSON.parse(event.data);
		const request = pending.get(message.id);
		if (request) {
			pending.delete(message.id);
			if (message.type === 'error') request.reject(new Error(JSON.stringify(message)));
			else request.resolve(message.result);
		}
	});
	await command('session.new', { capabilities: { alwaysMatch: {} } });
	const { contexts } = await command('browsingContext.getTree');
	context = contexts[0].context;
	await command('browsingContext.setViewport', { context, viewport: { width: 1980, height: 440 } });
	const report = {};
	let idx;
	for (const version of ['baseline', 'current']) {
		await command('browsingContext.navigate', { context, url: 'http://127.0.0.1:' + server.address().port + '/?version=' + version, wait: 'complete' });
		for (let attempt = 0; attempt < 40; attempt++) {
			if (await evaluate('!!globalThis.repro')) break;
			if (attempt === 39) throw new Error('Demo did not initialize: ' + log);
			await sleep(100);
		}
		if (idx == null) idx = await evaluate('repro.candidate.idx');
		const measurement = JSON.parse(await evaluate('JSON.stringify(repro.measure(' + idx + '))'));
		await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: measurement.mouse.x, y: measurement.mouse.y, duration: 0, origin: 'viewport' }] }] });
		await screenshot(version === 'baseline' ? 'before-full' : 'after-full');
		const actual = JSON.parse(await evaluate(`JSON.stringify((() => {
			const rect = repro.u.over.querySelector('.u-cursor-pt').getBoundingClientRect();
			return { idx: repro.u.cursor.idx, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})())`));
		assert.equal(actual.idx, idx);
		assert.equal(actual.x, measurement.hover.x);
		assert.equal(actual.y, measurement.hover.y);
		report[version] = { ...JSON.parse(await evaluate('JSON.stringify(repro.info)')), measurement };
		console.log(version, JSON.stringify(measurement));
		if (version === 'current') {
			await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: 5, y: 5, duration: 0, origin: 'viewport' }] }] });
			await screenshot('canvas-only-full');
		}
	}
	assert.deepStrictEqual(report.baseline.data, report.current.data);
	assert.deepStrictEqual(report.baseline.measurement.canvas, report.current.measurement.canvas);
	assert.ok(Math.hypot(report.baseline.measurement.delta.x, report.baseline.measurement.delta.y) > 0.5);
	assert.ok(Math.hypot(report.current.measurement.delta.x, report.current.measurement.delta.y) < 0.02);
	writeFileSync(new URL('measurements.json', output), JSON.stringify(report, null, 2) + '\n');
	console.log('Captured native Firefox screenshots at DPR 2; identical data and canvas centers; fixed DOM center matches.');
}
finally {
	clearTimeout(deadline);
	socket?.close();
	for (const request of pending.values()) request.reject(new Error('Browser closed'));
	if (browser?.pid) {
		const exited = new Promise(resolve => browser.once('exit', resolve));
		try { process.kill(-browser.pid, 'SIGTERM'); } catch {}
		await Promise.race([exited, sleep(2000)]);
		try { process.kill(-browser.pid, 'SIGKILL'); } catch {}
	}
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	rmSync(profile, { recursive: true, force: true });
}
