// Run: node scripts/bench-heatmap-flatbush-browser.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../test/output/', import.meta.url));
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'heatmap-firefox-'));
const firefox = process.env.FIREFOX_BIN || 'firefox';
const timeoutMs = 120000;
const files = new Map([
	['/scripts/bench-heatmap-flatbush.mjs', readFileSync(new URL('./bench-heatmap-flatbush.mjs', import.meta.url))],
	['/demos/lib/flatbush.js', readFileSync(new URL('../demos/lib/flatbush.js', import.meta.url))],
]);
writeFileSync(join(profile, 'user.js'), 'user_pref("dom.max_script_run_time", 120);\n');
const page = `<!doctype html><meta charset="utf-8"><script type="module">
import { runBenchmark } from '/scripts/bench-heatmap-flatbush.mjs';
try {
	const report = runBenchmark();
	await fetch('/result', { method: 'POST', body: JSON.stringify(report) });
}
catch (error) {
	await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack ?? String(error) }) });
}
</script>`;

let resolveResult, rejectResult;
const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
result.catch(() => {});
let browser, browserLog = '';
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
		else if (req.url == '/') {
			res.setHeader('Content-Type', 'text/html');
			res.end(page);
		}
		else if (files.has(req.url)) {
			res.setHeader('Content-Type', 'text/javascript');
			res.end(files.get(req.url));
		}
		else { res.writeHead(404); res.end(); }
	}
	catch (error) { res.writeHead(500); res.end(); rejectResult(error); }
});
const timer = setTimeout(() => rejectResult(new Error(`Benchmark exceeded ${timeoutMs}ms.\n${browserLog}`)), timeoutMs);
try {
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	browser = spawn(firefox, ['--headless', '--no-remote', '--profile', profile, `http://127.0.0.1:${server.address().port}/`],
		{ detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [browser.stdout, browser.stderr])
		stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
	browser.once('error', rejectResult);
	browser.once('exit', code => rejectResult(new Error(`Firefox exited with code ${code}.\n${browserLog}`)));
	const report = await result;
	const path = join(output, 'heatmap-flatbush-firefox.json');
	writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
	console.log(report.environment.userAgent);
	console.table(report.cases.flatMap(row => Object.entries(row.measurements).map(([type, { median }]) => ({
		case: row.name, type,
		'reset+add ms': median.resetAddMs.toFixed(3),
		'finish ms': median.finishMs.toFixed(3),
		'hover us/query': (median.hoverNsPerQuery / 1000).toFixed(3),
		'validation passed': row.validation.passed,
	}))));
	console.log(`Float32 saves ${report.memory.savedBytes} typed-buffer bytes per 250k-cell index after finish.`);
	console.log('Index-only benchmark: excludes projection, Path2D, drawing, and initial allocation.');
	console.log(`Full report and raw samples: ${path}`);
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
