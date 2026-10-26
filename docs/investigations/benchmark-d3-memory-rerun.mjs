// Cache-only, serial memory comparison using the production capture and analysis code.
// node docs/investigations/benchmark-d3-memory-rerun.mjs [--reverse]
// The before control serves only the historical uPlot bundle; all adapters remain current.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {cpus, platform, release} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {captureBenchmarkTrace} from '../../scripts/benchmarks-trace.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';
import {summarizeAdjustedProcessMemory} from '../../scripts/analyze-benchmarks-process-memory.mjs';

const root = new URL('../../', import.meta.url);
const binary = fileURLToPath(new URL('node_modules/.cache/uplot-bench/chrome-headless-shell-156.0.8078.47-linux64/chrome-headless-shell', root));
const beforeCommit = '28b7be5dd5301daf6d61e76ffaa14a17063be88b';
assert.ok(process.argv.slice(2).every(arg => arg === '--reverse'));
const variants = ['uplot-before', 'uplot', 'd3-minmax', 'd3-svg-minmax'];
if (process.argv.includes('--reverse')) variants.reverse();
const order = ['idle', ...variants];
const directory = await mkdtemp('/tmp/uplot-memory-rerun-');
const browserVersion = execFileSync(binary, ['--version'], {encoding: 'utf8', timeout: 10000}).trim();
const reports = [];
const hash = source => createHash('sha256').update(source).digest('hex');
console.log('Output:', directory);

for (const variant of order) {
	const id = variant === 'uplot-before' ? 'uplot' : variant;
	const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, id);
	if (variant === 'uplot-before') {
		const route = localScripts.find(route => route.includes('uPlot'));
		assert.ok(route);
		const historical = execFileSync('git', ['--no-pager', 'show', beforeCommit + ':' + route.slice(1)],
			{cwd: fileURLToPath(root), encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024});
		assert.match(historical, /new Intl\.NumberFormat\b/);
		assert.ok(historical.includes('new Intl.DateTimeFormat().resolvedOptions().timeZone'));
		files.set(route, historical);
	}
	for (const dependency of dependencies) {
		assert.ok(!dependency.type || dependency.type === 'script' || dependency.type === 'style');
		const source = await readFile(new URL('.cache/benchmarks/' + dependency.cacheName, root));
		files.set(dependency.route, source);
		dependency.sha256 = hash(source);
	}
	files.set('/bench.mjs', await readFile(new URL('scripts/benchmarks-trace-browser.mjs', root)));
	files.set('/bench/data.json', await readFile(new URL('bench/data.json', root)));
	files.set('/bench/runtime-assets.json', '[]');
	files.set('/bench/module-assets.json', '[]');
	const html = '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>' +
		dependencies.map(dep => dep.type === 'style' ? `<link rel="stylesheet" href="${dep.route}">` : `<script src="${dep.route}"></script>`).join('') +
		localScripts.map(route => `<script src="${route}"></script>`).join('') +
		localStyles.map(route => `<link rel="stylesheet" href="${route}">`).join('') +
		'<script type="module" src="/bench.mjs"></script>';
	const server = createServer((request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		const route = new URL(request.url, 'http://localhost').pathname;
		if (route === '/blank' || route === '/') {
			response.setHeader('Content-Type', 'text/html');
			return response.end(route === '/' ? html : '<!doctype html><meta charset="utf-8"><title>Blank baseline</title>');
		}
		if (!files.has(route)) return response.writeHead(404).end();
		response.setHeader('Content-Type', route.endsWith('.css') ? 'text/css' : route.endsWith('.json') ? 'application/json' : 'text/javascript');
		response.end(files.get(route));
	});
	const profile = join(directory, variant + '-profile');
	let browser, timer;
	let browserLog = '';
	try {
		await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
		const browserArgs = ['--no-first-run', '--no-default-browser-check', '--disable-background-networking',
			'--disable-component-update', '--disable-sync', '--disable-extensions', '--user-data-dir=' + profile,
			'--enable-gpu', '--enable-features=Vulkan', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
			'--window-size=1920,900', 'about:blank'];
		browser = spawn(binary, browserArgs, {stdio: ['ignore', 'pipe', 'pipe']});
		for (const stream of [browser.stdout, browser.stderr])
			stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
		const failure = new Promise((resolve, reject) => {
			browser.once('error', reject);
			browser.once('exit', code => reject(new Error('Browser exited: ' + code + '\n' + browserLog)));
			timer = setTimeout(() => reject(new Error('Variant exceeded 120 seconds')), 120000);
		});
		failure.catch(() => {});
		// The production reader expects a complete DevToolsActivePort file.
		for (let attempt = 0; attempt < 200; attempt++) {
			let text = '';
			try { text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); } catch {}
			if (/^\d+\n\/devtools\/browser\//.test(text)) break;
			assert.ok(attempt < 199, browserLog);
			await delay(50);
		}
		console.log('Running:', variant);
		const report = await Promise.race([captureBenchmarkTrace({
			profile, url: `http://127.0.0.1:${server.address().port}/?variant=${id}`, cache: directory,
			trace: false, memory: true, raf: false, dpr: 1, processPid: browser.pid,
			onSampleTimeout: () => killBenchmarkBrowser(browser),
		}), failure]);
		assert.equal(report.samples.filter(sample => !sample.warmup).length, 7);
		if (variant !== id) for (const sample of report.samples) sample.variant = variant;
		report.runner = {variant, servedVariant: id, beforeCommit: variant === 'uplot-before' ? beforeCommit : null,
			browserVersion, browserArgs, dpr: 1, requestedBackend: 'vulkan', node: process.version,
			cpu: cpus()[0]?.model, os: platform() + ' ' + release(), dependencies,
			sourceSha256: Object.fromEntries([...files].map(([route, source]) => [route, hash(source)])), browserLog};
		reports.push(report);
		await writeFile(join(directory, variant + '.json'), JSON.stringify(report, null, 2));
		const adjusted = summarizeAdjustedProcessMemory(reports);
		const summary = adjusted.groups.map(group => ({variant: group.variant, peakMB: group.scopes.tree.pssMB.peak, retainedMB: group.scopes.tree.pssMB.live}));
		await writeFile(join(directory, 'results.json'), JSON.stringify({date: new Date().toISOString(), order,
			measurements: {trace: false, memory: true, raf: false}, summary, adjusted}, null, 2));
		console.log(summary.length ? JSON.stringify(summary.at(-1)) : 'Idle control complete.');
	}
	finally {
		clearTimeout(timer);
		if (browser) await killBenchmarkBrowser(browser);
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		await rm(profile, {recursive: true, force: true});
	}
}
console.log('Evidence:', join(directory, 'results.json'));
