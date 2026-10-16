// Run: node scripts/bench-heatmap-grid-browser.mjs (FIREFOX_BIN overrides firefox).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInputs, printReport } from './bench-heatmap-grid.mjs';

const inputs = await loadInputs();
const output = fileURLToPath(new URL('../test/output/', import.meta.url));
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'heatmap-grid-firefox-'));
writeFileSync(join(profile, 'user.js'), 'user_pref("dom.max_script_run_time", 240);\nuser_pref("dom.max_chrome_script_run_time", 240);\nuser_pref("privacy.reduceTimerPrecision", false);\n');
// The baseline snapshot exists only in memory. Its unchanged relative import resolves to the real Flatbush module.
const files = new Map([
	['/scripts/bench-heatmap-grid.mjs', readFileSync(new URL('./bench-heatmap-grid.mjs', import.meta.url))],
	['/demos/lib/heatmapPlugin.js', inputs.currentSource],
	['/demos/lib/heatmapPlugin-baseline.js', inputs.baselineSource],
	['/demos/lib/flatbush.js', inputs.flatbushSource],
	['/fixture.json', inputs.fixtureSource],
]);
const page = `<!doctype html><meta charset="utf-8"><script type="module">
try {
	const [{ runBenchmark }, { heatmapPlugin }, fixture] = await Promise.all([
		import('/scripts/bench-heatmap-grid.mjs'), import('/demos/lib/heatmapPlugin-baseline.js'), fetch('/fixture.json').then(r => r.json())
	]);
	const report = runBenchmark(heatmapPlugin, fixture, ${JSON.stringify(inputs.metadata)});
	await fetch('/result', { method: 'POST', body: JSON.stringify(report) });
}
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack ?? String(error) }) }); }
</script>`;
let resolveResult, rejectResult, browser, browserLog = '';
const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
result.catch(() => {});
const server = createServer(async (req, res) => {
	try {
		if (req.method == 'POST' && req.url == '/result') {
			let body = '';
			for await (const chunk of req) body += chunk;
			const report = JSON.parse(body);
			res.end('ok');
			if (report.error) rejectResult(new Error(report.error));
			else resolveResult(report);
		}
		else if (req.url == '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); }
		else if (files.has(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.json') ? 'application/json' : 'text/javascript'); res.end(files.get(req.url)); }
		else { res.writeHead(404); res.end(); }
	}
	catch (error) { res.writeHead(500); res.end(); rejectResult(error); }
});
const timer = setTimeout(() => rejectResult(new Error(`Benchmark exceeded 240s.\n${browserLog}`)), 240000);
try {
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	browser = spawn(process.env.FIREFOX_BIN || 'firefox', ['--headless', '--no-remote', '--profile', profile, `http://127.0.0.1:${server.address().port}/`],
		{ detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [browser.stdout, browser.stderr]) stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
	browser.once('error', rejectResult);
	browser.once('exit', code => rejectResult(new Error(`Firefox exited with code ${code}.\n${browserLog}`)));
	const report = await result;
	writeFileSync(join(output, 'heatmap-grid-firefox.json'), JSON.stringify(report, null, 2) + '\n');
	printReport(report);
	console.log('Report: test/output/heatmap-grid-firefox.json');
	if (!report.validationPassed) process.exitCode = 1;
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
