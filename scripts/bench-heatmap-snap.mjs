// Run from repo root: node scripts/bench-heatmap-snap.mjs baseline | working
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedChromeBinary } from './chrome-headless-shell.mjs';
import { killBenchmarkBrowser } from './bench-browser-process.mjs';

const variant = process.argv[2];
assert.ok(['baseline', 'working'].includes(variant), 'Specify baseline or working');
const root = fileURLToPath(new URL('../', import.meta.url));
const area = join(root, 'node_modules/.cache/uplot-bench/device-snap');
const commit = '0cc44654f229b0e4f36079646402fbd0aa59fdc7';
const plugin = 'demos/lib/heatmapPlugin.js';
const demo = 'demos/heatmap-cells.html';
const gitShow = path => execFileSync('git', ['--no-pager', 'show', `${commit}:${path}`], { cwd: root });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
mkdirSync(area, { recursive: true });
const baseline = gitShow(plugin);
writeFileSync(join(area, 'baseline.js'), baseline);
const source = variant === 'baseline' ? readFileSync(join(area, 'baseline.js')) : readFileSync(join(root, plugin));
const binary = await cachedChromeBinary();
assert.ok(binary, 'Cache Chrome Headless Shell first, or set CHROME_BIN');
const baselineReport = variant === 'working' && JSON.parse(readFileSync(join(area, 'baseline.json'), 'utf8'));
if (baselineReport) {
	assert.equal(baselineReport.pluginSha256, hash(baseline));
	assert.notEqual(hash(source), hash(baseline), 'Working plugin is still the baseline');
}
const runs = 3, warmups = 5, repeats = 15;
const flags = ['--headless', '--disable-background-networking', '--no-first-run', '--disable-accelerated-2d-canvas',
	'--window-size=1280,960', '--force-device-scale-factor=1', '--hide-scrollbars'];
const settings = { binary, chrome: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(), flags,
	cpu: cpus()[0].model, os: release(), runs, warmups, repeats, commit, harnessSha256: hash(readFileSync(new URL(import.meta.url))) };
if (baselineReport) assert.deepEqual(settings, baselineReport.settings);
const assets = new Map([['/' + plugin, source]]);
const page = gitShow(demo).toString();
const anchor = "createDemo(document.querySelector('#demo'), [...frames, classic], { otelClassic, otelNhcb, parity, parityZero });";
assert.equal(page.split(anchor).length, 2);

// Runs in Chrome. The demo itself creates the frame, adapts it, mounts the plot and selects all defaults.
async function measure(u, reverse, warmups, repeats) {
	const tick = () => new Promise(requestAnimationFrame);
	await tick();
	const { ctx } = u, { canvas } = ctx;
	const full = ['x', 'y'].map(k => [u.scales[k].min, u.scales[k].max]);
	const [[x0, x1], [y0, y1]] = full, dx = (x1 - x0) / 16, dy = (y1 / y0) ** .25;
	const zoom = [[x0 + 7 * dx, x1 - 7 * dx], [y0 * dy, y1 / dy]];
	const get = id => document.getElementById(id);
	const fixture = { cells: u.data[1][0].length, occupiedColumns: new Set(u.data[1][0]).size,
		seed: 1, xGapProbability: .02, dataset: get('dataset').value, gap: +get('cell-gap').value, palette: +get('color-count').value,
		y: get('y-scale').value, color: get('color-scale').value, mirrored: get('signed-data').checked,
		viewport: [innerWidth, innerHeight], canvas: [canvas.width, canvas.height], dpr: u.pxRatio,
		bbox: { ...u.bbox }, full, zoom, status: get('status').textContent };
	if (fixture.cells < 240000 || fixture.cells > 260000 || fixture.dataset !== 'synthetic' || !(y0 > 0)) throw Error(JSON.stringify(fixture));
	const samples = {};
	let draws = 0;
	u.hooks.draw.push(() => draws++);
	for (const view of reverse ? ['zoom', 'full'] : ['full', 'zoom']) {
		const bounds = view === 'full' ? full : zoom;
		u.batch(() => ['x', 'y'].forEach((k, i) => u.setRange(k, ...bounds[i])));
		if (!['x', 'y'].every((k, i) => u.scales[k].min === bounds[i][0] && u.scales[k].max === bounds[i][1])) throw Error('Wrong scale bounds');
		const times = samples[view] = [];
		const redraw = () => u.redraw(false, false);
		for (let i = -warmups; i < repeats; i++) {
			await tick(); // Frame pacing is outside the timer.
			const before = draws;
			const start = performance.now();
			u.batch(redraw); // uPlot commits synchronously, including the plugin's draw hook.
			const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const end = performance.now();
			if (draws !== before + 1 || rgba.data.length !== canvas.width * canvas.height * 4) throw Error('Incomplete draw/readback');
			if (i === -1) {
				// Sample the plot interior, not the axes, so a blank heatmap cannot yield a fast result.
				let colored = 0;
				const {left, top, width, height} = u.bbox;
				for (let y = Math.ceil(top); y < top + height; y += 7) for (let x = Math.ceil(left); x < left + width; x += 7) {
					const p = 4 * (y * canvas.width + x);
					if (rgba.data[p + 3] && Math.abs(rgba.data[p] - rgba.data[p + 2]) > 24) colored++;
				}
				if (colored < 100) throw Error(`No heatmap visible (${colored})`);
			}
			if (i >= 0) times.push(end - start);
		}
	}
	return { fixture, samples };
}

async function run(index) {
	const { promise, resolve, reject } = Promise.withResolvers();
	const html = page.replace(anchor, `const demo = ${anchor}\nconst result = await (${measure})(demo.plot, ${index % 2 !== 0}, ${warmups}, ${repeats});\nawait fetch('/report', { method: 'POST', body: JSON.stringify(result) });`)
		.replace('console.error(error);', "await fetch('/report', { method: 'POST', body: JSON.stringify({error: error.stack}) });");
	const server = createServer(async (req, res) => {
		try {
			if (req.method === 'POST' && req.url === '/report') {
				let body = '';
				for await (const chunk of req) body += chunk;
				const result = JSON.parse(body);
				res.end('ok');
				if (result.error) reject(new Error(result.error)); else resolve(result);
			}
			else if (req.url === '/' + demo) res.setHeader('Content-Type', 'text/html').end(html);
			else if (/^\/(?:src|demos)\/(?:[\w-]+\/)*[\w-]+\.(?:js|css|json)$/.test(req.url)) {
				if (!assets.has(req.url)) assets.set(req.url, gitShow(req.url.slice(1)));
				res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'application/json').end(assets.get(req.url));
			}
			else res.writeHead(404).end();
		} catch (e) { res.writeHead(500).end(); reject(e); }
	});
	const profile = mkdtempSync(join(area, 'profile-'));
	const timer = setTimeout(() => reject(Error('Chrome benchmark exceeded 120s')), 120000);
	let browser, closed;
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		browser = spawn(binary, [...flags, `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}/${demo}`], { stdio: ['ignore', 'ignore', 'inherit'] });
		closed = new Promise(r => browser.once('close', r));
		browser.once('error', reject);
		browser.once('exit', (code, signal) => reject(Error(`Chrome exited: ${code ?? signal}`)));
		return await promise;
	} finally {
		clearTimeout(timer);
		if (browser?.pid) killBenchmarkBrowser(browser);
		await closed;
		server.closeAllConnections();
		server.close();
		rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
	}
}

const q = (sorted, p) => sorted[Math.floor((sorted.length - 1) * p)];
const rounds = [];
for (let i = 0; i < runs; i++) {
	const result = await run(i);
	if (rounds.length || baselineReport) assert.deepEqual(result.fixture, (rounds[0] ?? baselineReport.rounds[0]).fixture);
	rounds.push(result);
}
const summary = {};
for (const view of ['full', 'zoom']) {
	const series = rounds.map(r => r.samples[view]);
	const sorted = series.flat().sort((a,b) => a-b);
	summary[view] = { median: q(sorted, .5), p25: q(sorted, .25), p75: q(sorted, .75),
		processMedians: series.map(s => q(s.slice().sort((a,b) => a-b), .5)) };
	if (baselineReport) summary[view].speedup = baselineReport.summary[view].median / summary[view].median;
}
const reportPath = join(area, `${variant}.json`);
if (variant === 'working') writeFileSync(join(area, 'working.js'), source);
writeFileSync(reportPath, JSON.stringify({ variant, pluginSha256: hash(source), settings, rounds, summary }, null, 2) + '\n');
console.log(rounds[0].fixture, summary, reportPath);
