// Run: node scripts/bench-canvas-sprites.mjs [--browser firefox|chrome] [--headed] [--gpu].
// FIREFOX_BIN and CHROME_BIN override the browser binaries. --headed is Firefox-only; --gpu is Chrome-only.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromeBinary } from './chrome-headless-shell.mjs';

const { values } = parseArgs({ options: {
	browser: { type: 'string', default: 'firefox' },
	headed: { type: 'boolean', default: false },
	gpu: { type: 'boolean', default: false },
} });
const { browser: browserName, headed, gpu } = values;
if (!['firefox', 'chrome'].includes(browserName))
	throw new Error('--browser must be firefox or chrome.');
if (headed && browserName !== 'firefox')
	throw new Error('--headed is only available for Firefox. Chrome uses Headless Shell.');
if (gpu && browserName !== 'chrome')
	throw new Error('--gpu is only available for Chrome Headless Shell.');
const binary = browserName === 'chrome'
	? await chromeBinary({ version: '156.0.8078.47', signal: AbortSignal.timeout(240000) })
	: process.env.FIREFOX_BIN || '/usr/bin/firefox';
const browserVersion = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
const filename = `canvas-sprites-${browserName}${headed ? '-headed' : ''}${gpu ? '-gpu' : ''}.json`;
const output = fileURLToPath(new URL('../test/output/', import.meta.url));
const injection = `<script type="module">
try {
	if (typeof window.spriteBenchmarkReady?.then != 'function')
		throw new Error('window.spriteBenchmarkReady must be a Promise.');
	await window.spriteBenchmarkReady;
	const report = await window.runSpriteBenchmark();
	await fetch('/result', { method: 'POST', body: JSON.stringify(report) });
}
catch (error) {
	await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error?.stack ?? String(error) }) });
}
</script>`;
const html = readFileSync(new URL('../bench/canvas-sprites.html', import.meta.url), 'utf8');
const page = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, match => injection + '\n' + match) : html + '\n' + injection;
const files = new Map([
	['/bench/canvas-sprites.html', page],
	['/bench/canvas-sprites.mjs', readFileSync(new URL('../bench/canvas-sprites.mjs', import.meta.url))],
]);

let resolveResult, rejectResult, browser, profile, browserLog = '';
const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
result.catch(() => {});
const server = createServer(async (req, res) => {
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	res.setHeader('Cache-Control', 'no-store');
	try {
		if (req.method == 'POST' && req.url == '/result') {
			let body = '';
			for await (const chunk of req) {
				body += chunk;
				if (body.length > 1024 * 1024) throw new Error('Benchmark report exceeds 1 MiB.');
			}
			const report = JSON.parse(body);
			if (report.error) throw new Error(report.error);
			if (!Array.isArray(report.results) || report.results.length == 0)
				throw new Error('Benchmark report has no results.');
			res.end('ok');
			resolveResult(report);
		}
		else if (req.method == 'GET' && files.has(req.url)) {
			res.setHeader('Content-Type', req.url.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
			res.end(files.get(req.url));
		}
		else { res.writeHead(404); res.end(); }
	}
	catch (error) { res.writeHead(500); res.end(); rejectResult(error); }
});
server.on('error', rejectResult);
const timer = setTimeout(() => rejectResult(new Error(`Benchmark exceeded 120s.\n${browserLog}`)), 120000);
const interrupt = signal => rejectResult(new Error(`Benchmark interrupted by ${signal}.`));
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

try {
	mkdirSync(output, { recursive: true });
	profile = mkdtempSync(join(output, `canvas-sprites-${browserName}-`));
	if (browserName === 'firefox')
		writeFileSync(join(profile, 'user.js'), 'user_pref("dom.max_script_run_time", 120);\nuser_pref("dom.max_chrome_script_run_time", 120);\nuser_pref("privacy.reduceTimerPrecision", false);\n');
	await Promise.race([
		new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }),
		result,
	]);
	const url = `http://127.0.0.1:${server.address().port}/bench/canvas-sprites.html`;
	const browserArgs = browserName === 'chrome' ? [
		'--no-first-run', '--no-default-browser-check', '--disable-background-networking',
		'--disable-component-update', '--disable-sync', '--disable-extensions',
		'--user-data-dir=' + profile, '--window-size=1280,900',
		...(gpu ? ['--enable-gpu'] : []), url,
	] : [
		...(headed ? [] : ['--headless']), '--no-remote', '--profile', profile, url,
	];
	browser = spawn(binary, browserArgs, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [browser.stdout, browser.stderr])
		stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
	browser.once('error', rejectResult);
	browser.once('exit', (code, signal) => rejectResult(new Error(`${browserVersion} exited with ${signal || `code ${code}`}.\n${browserLog}`)));

	const report = await result;
	report.runner = { browser: browserName, version: browserVersion, headed, gpuRequested: gpu, browserArgs, browserLog };
	writeFileSync(join(output, filename), JSON.stringify(report, null, 2) + '\n');
	console.log(`Browser: ${browserVersion} (${report.userAgent})`);
	console.log(`Native DPR: ${report.nativeDpr}; canvas: ${report.cssWidth} × ${report.cssHeight} CSS pixels; mode: ${headed ? 'headed' : 'headless'}; --enable-gpu: ${gpu}`);
	console.table(report.results.map(row => ({
		dpr: row.dpr,
		count: row.count,
		'atlas median ms': row.atlas.medianMs,
		'atlas p95 ms': row.atlas.p95Ms,
		'sprites median ms': row.sprites.medianMs,
		'sprites p95 ms': row.sprites.p95Ms,
		'atlas frame median ms': row.atlas.frameMedianMs,
		'atlas frame p95 ms': row.atlas.frameP95Ms,
		'sprites frame median ms': row.sprites.frameMedianMs,
		'sprites frame p95 ms': row.sprites.frameP95Ms,
		'change %': row.changePercent,
		differentChannels: row.pixels.differentChannels,
		maxDelta: row.pixels.maxDelta,
	})));
	console.log(`Report: test/output/${filename}`);
	if (report.results.some(row => row.pixels.differentChannels > 0)) {
		console.error('Pixel comparison failed: atlas and sprites differ.');
		process.exitCode = 1;
	}
}
catch (error) {
	console.error(error.stack ?? String(error));
	process.exitCode = 1;
}
finally {
	clearTimeout(timer);
	if (browser?.pid) {
		const exited = browser.exitCode != null || browser.signalCode != null
			? Promise.resolve()
			: new Promise(resolve => browser.once('exit', resolve));
		try { process.kill(-browser.pid, 'SIGTERM'); } catch {}
		let graceTimer;
		await Promise.race([exited, new Promise(resolve => { graceTimer = setTimeout(resolve, 2000); })]);
		clearTimeout(graceTimer);
		try { process.kill(-browser.pid, 'SIGKILL'); } catch {}
	}
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	if (profile) rmSync(profile, { recursive: true, force: true });
	process.off('SIGINT', interrupt);
	process.off('SIGTERM', interrupt);
}
