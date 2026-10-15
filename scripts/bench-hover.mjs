// Run after npm run build: node --max-old-space-size=128 scripts/bench-hover.mjs
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const baseline = '8c0bce3';
const timeoutMs = 120000;
const firefox = process.env.FIREFOX_BIN || 'firefox';
const files = new Map([
	['/baseline.mjs', execFileSync('git', ['--no-pager', 'show', `${baseline}:dist/uPlot.esm.js`], { cwd: root, encoding: 'utf8' })],
	['/current.mjs', readFileSync(new URL('dist/uPlot.esm.js', root), 'utf8')],
	['/bench.mjs', readFileSync(new URL('./bench-hover-browser.mjs', import.meta.url), 'utf8')],
	['/uPlot.css', readFileSync(new URL('src/uPlot.css', root), 'utf8')],
]);
const page = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/uPlot.css"><style>body{margin:0}</style><script type="module" src="/bench.mjs"></script>';
const profile = mkdtempSync(join(tmpdir(), 'uplot-hover-'));
// Use an isolated profile and one content process. Do not change rendering preferences.
writeFileSync(join(profile, 'user.js'), [
	'user_pref("browser.shell.checkDefaultBrowser", false);',
	'user_pref("browser.sessionstore.resume_from_crash", false);',
	'user_pref("browser.startup.page", 0);',
	'user_pref("dom.ipc.processCount", 1);',
	'user_pref("fission.autostart", false);',
].join('\n'));

let resolveResult, rejectResult;
const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
// Install a handler before asynchronous browser startup can reject this promise.
result.catch(() => {});
let browser;
let browserLog = '';
const server = createServer(async (req, res) => {
	try {
		if (req.method == 'POST' && (req.url == '/progress' || req.url == '/result')) {
			let body = '';
			for await (const chunk of req)
				body += chunk;
			const payload = JSON.parse(body);
			res.end('ok');
			if (req.url == '/progress') {
				for (const row of payload)
					console.log(`${row.case}; ${row.measurement}: ${row.baselineMs.toFixed(4)} -> ${row.currentMs.toFixed(4)} ms/event (${row.changePercent.toFixed(1)}%)`);
			}
			else if (payload.error)
				rejectResult(new Error(payload.error));
			else
				resolveResult(payload);
		}
		else if (req.url == '/') {
			res.setHeader('Content-Type', 'text/html');
			res.end(page);
		}
		else if (files.has(req.url)) {
			res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
			res.end(files.get(req.url));
		}
		else {
			res.writeHead(404);
			res.end();
		}
	}
	catch (error) {
		res.writeHead(500);
		res.end();
		rejectResult(error);
	}
});
const timer = setTimeout(() => rejectResult(new Error(`Hover benchmark exceeded ${timeoutMs}ms.\n${browserLog}`)), timeoutMs);

try {
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const url = `http://127.0.0.1:${server.address().port}/`;
	console.log(`Baseline: ${baseline}; current: working-tree dist/uPlot.esm.js`);
	console.log(execFileSync(firefox, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim());
	console.log('One headless browser, sequential cases; median of 7 samples, 128 events/sample, 3 warmups; alternating baseline/current order.');
	browser = spawn(firefox, ['--headless', '--no-remote', '--profile', profile, url], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [browser.stdout, browser.stderr])
		stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
	browser.once('error', rejectResult);
	browser.once('exit', code => rejectResult(new Error(`Firefox exited with code ${code}.\n${browserLog}`)));
	const report = await result;
	console.log(report.userAgent);
	console.table(report.results.map(row => ({
		case: row.case,
		measurement: row.measurement,
		'old ms/event': row.baselineMs.toFixed(4),
		'new ms/event': row.currentMs.toFixed(4),
		'delta ms': row.deltaMs.toFixed(4),
		'change %': row.changePercent.toFixed(1),
	})));
	console.log(report.limitations);
	console.log('Raw samples (ms/event):');
	console.log(JSON.stringify(report.results.map(({ case: name, measurement, samples }) => ({ case: name, measurement, samples }))));
}
finally {
	clearTimeout(timer);
	if (browser?.pid) {
		const exited = new Promise(resolve => browser.once('exit', resolve));
		try { process.kill(-browser.pid, 'SIGTERM'); } catch {}
		await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
		try { process.kill(-browser.pid, 'SIGKILL'); } catch {}
	}
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	rmSync(profile, { recursive: true, force: true });
}
