// node scripts/bench-range-layout.mjs [baseline-ref]
// Browser layout timings include canvas command submission, not presentation latency.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv[2] ?? '6bb4315e';
const firefox = process.env.FIREFOX_BIN || 'firefox';
const current = readFileSync(join(root, 'src/uPlot.js'), 'utf8');
const secondPass = '\t\trangeYScales(0, plotWidCss, changedY);';
if (current.split(secondPass).length !== 2)
	throw Error('Expected exactly one horizontal ranging call. Update the benchmark for this source version.');
const variants = new Map([
	['baseline', execFileSync('git', ['--no-pager', 'show', `${baseline}:src/uPlot.js`], { cwd: root, encoding: 'utf8' })],
	['single', current.replace(secondPass, '')],
	['current', current],
]);

async function browserBenchmark() {
	const names = ['baseline', 'single', 'current'];
	const constructors = await Promise.all(names.map(name => import(`/${name}/src/uPlot.js`).then(m => m.default)));
	const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
	const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
	const stats = values => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) });
	const results = [];
	let checksum = 0;

	function makePlot(UPlot, count, draw) {
		const xs = Array.from({ length: 64 }, (_, i) => i);
		const data = [xs];
		const scales = { x: { time: false } };
		const axes = [{ size: 40 }];
		const series = [{}];
		for (let i = 0; i < count; i++) {
			const scale = i === 0 ? 'y' : `y${i}`;
			scales[scale] = { axis: i + 1 };
			axes.push({ scale, side: 3, size: 45 });
			series.push({ scale, stroke: 'royalblue', points: { show: false } });
			data.push(xs.map(x => 40 + i * 7 + 23 * Math.sin(x / 5 + i)));
		}
		return new UPlot({
			width: 1400, height: 500, pxRatio: 1,
			legend: { show: false }, cursor: { show: false }, select: { show: false },
			drawOrder: draw ? ['axes', 'series'] : [],
			scales, axes, series,
		}, data, document.body);
	}

	function state(u) {
		return JSON.stringify({
			bbox: u.bbox,
			ranges: Object.values(u.scales).map(s => [s.min, s.max]),
			ticks: u.axes.map(a => [a._splits, a._values, a._size]),
		});
	}

	async function batch(u, iterations, resize) {
		const start = performance.now();
		for (let i = 0; i < iterations; i++) {
			if (resize)
				u.setSize({ width: 1400, height: i % 2 === 0 ? 520 : 500 });
			else
				u.redraw(false, true);
			await Promise.resolve();
			checksum += u.scales.y.max + u.axes[1]._splits.length;
		}
		return (performance.now() - start) * 1000 / iterations;
	}

	for (const draw of [false, true]) {
		for (const count of [1, 4, 16]) {
			for (const resize of [false, true]) {
				const plots = constructors.map(UPlot => makePlot(UPlot, count, draw));
				try {
					await Promise.resolve();
					for (const height of [500, 520, 500]) {
						plots.forEach(u => u.setSize({ width: 1400, height }));
						await Promise.resolve();
						if (!plots.every(u => state(u) === state(plots[0])))
							throw Error('Variants produced different ranges, ticks, or geometry.');
					}
					const iterations = Math.max(16, 128 / count);
					const samples = names.map(() => []);
					for (let round = 0; round < 24; round++) {
						for (const idx of orders[round % orders.length]) {
							const value = await batch(plots[idx], iterations, resize);
							if (round >= 6)
								samples[idx].push(value);
						}
						// Let the browser drain work outside the timed batches.
						await new Promise(resolve => setTimeout(resolve, 0));
					}
					const row = {
						case: `${count} Y; ${resize ? 'resize' : 'relayout'}; ${draw ? 'canvas draw' : 'drawing disabled'}`,
						iterations,
						us: Object.fromEntries(names.map((name, idx) => [name, stats(samples[idx])])),
						extraPassUs: stats(samples[2].map((n, i) => n - samples[1][i])),
						vsBaselineUs: stats(samples[2].map((n, i) => n - samples[0][i])),
						samples,
					};
					results.push(row);
					await fetch('/progress', { method: 'POST', body: JSON.stringify(row) });
				}
				finally {
					plots.forEach(u => u.destroy());
				}
			}
		}
	}
	return { userAgent: navigator.userAgent, checksum, results };
}

const files = new Map();
for (const [name, source] of variants)
	files.set(`/${name}/src/uPlot.js`, source);
// Use the actual pre-change ranger in the historical variant.
files.set('/baseline/src/rangeY.js', execFileSync('git', ['--no-pager', 'show', `${baseline}:src/rangeY.js`], { cwd: root, encoding: 'utf8' }));
const cache = join(root, 'node_modules/.cache/uplot-range-layout');
mkdirSync(cache, { recursive: true });
const profile = mkdtempSync(join(cache, 'profile-'));
writeFileSync(join(profile, 'user.js'), [
	'user_pref("browser.shell.checkDefaultBrowser", false);',
	'user_pref("browser.sessionstore.resume_from_crash", false);',
	'user_pref("browser.startup.page", 0);',
	'user_pref("dom.ipc.processCount", 1);',
	'user_pref("fission.autostart", false);',
	'user_pref("privacy.reduceTimerPrecision", false);',
].join('\n'));
let finish, fail, browser, logs = '';
const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
result.catch(() => {});
const server = createServer(async (req, res) => {
	try {
		res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		if (req.method === 'POST' && ['/result', '/progress'].includes(req.url)) {
			let body = '';
			for await (const chunk of req) body += chunk;
			const payload = JSON.parse(body);
			res.end('ok');
			if (req.url === '/progress') {
				console.log(`${payload.case}: baseline ${payload.us.baseline.median.toFixed(2)}, single ${payload.us.single.median.toFixed(2)}, current ${payload.us.current.median.toFixed(2)} us/layout; paired extra-pass delta ${payload.extraPassUs.median.toFixed(2)} us`);
			}
			else if (payload.error) fail(Error(payload.error));
			else finish(payload);
		}
		else if (req.url === '/') {
			res.setHeader('Content-Type', 'text/html');
			res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/current/src/uPlot.css"><script type="module">(${browserBenchmark.toString()})().then(value => value, error => ({error: error.stack})).then(result => fetch('/result', {method:'POST', body: JSON.stringify(result)}));</script>`);
		}
		else if (/^\/(baseline|single|current)\/src\/[\w/.-]+$/.test(req.url) && !req.url.includes('..')) {
			if (!files.has(req.url)) files.set(req.url, readFileSync(join(root, req.url.replace(/^\/\w+\//, ''))));
			res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
			res.end(files.get(req.url));
		}
		else res.writeHead(404).end();
	}
	catch (error) { res.destroy(); fail(error); }
});
const timer = setTimeout(() => fail(Error(`Benchmark exceeded 120 seconds.\n${logs}`)), 120000);
try {
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	console.log(execFileSync(firefox, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim());
	console.log(`Baseline: ${baseline}; single: current source without horizontal pass; current: working tree.`);
	console.log('6 warmup + 18 measured batches; all six variant orders; timings in microseconds/layout.');
	browser = spawn(firefox, ['--headless', '--no-remote', '--profile', profile, `http://127.0.0.1:${server.address().port}/`], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
	for (const stream of [browser.stdout, browser.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-4000); });
	browser.once('error', fail);
	browser.once('exit', code => fail(Error(`Firefox exited with code ${code}.\n${logs}`)));
	const report = await result;
	writeFileSync(join(cache, 'result.json'), JSON.stringify({ baseline, ...report }, null, 2));
	console.log(report.userAgent);
	console.log('Checksum:', report.checksum);
	console.log('Raw samples and ranges: node_modules/.cache/uplot-range-layout/result.json');
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
