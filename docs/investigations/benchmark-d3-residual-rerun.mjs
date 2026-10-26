// Cache-only, serial residual-memory comparison using production capture and analysis.
// node docs/investigations/benchmark-d3-residual-rerun.mjs [variant ...]
// Results remain under /tmp; browser profiles are removed after each capture.
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
const defaults = ['idle', 'uplot', 'd3-minmax', 'uplot:arial', 'd3-minmax:systemfont'];
const supported = [...defaults, 'uplot:nocursor', 'uplot:nopromote', 'uplot:nogrid'];
const requested = process.argv.slice(2);
for (const spec of requested)
	assert.ok(supported.includes(spec), 'Unknown variant: ' + spec + '. Expected: ' + supported.join(', '));
const order = ['idle', ...new Set((requested.length ? requested : defaults).filter(spec => spec !== 'idle'))];
const browserVersion = execFileSync(binary, ['--version'], {encoding: 'utf8', timeout: 10000}).trim();
const directory = await mkdtemp('/tmp/uplot-residual-rerun-');
const reports = [];
const hash = source => createHash('sha256').update(source).digest('hex');
console.log('Output:', directory);

for (const variant of order) {
	const [id, modifier] = variant.split(':');
	const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, id);
	const replacements = [];
	const replace = (routes, from, to, expected) => {
		let count = 0;
		for (const route of new Set(routes)) {
			assert.ok(files.has(route), 'Missing served asset: ' + route);
			const source = files.get(route).toString();
			const matches = source.split(from).length - 1;
			if (!matches) continue;
			const patched = source.replaceAll(from, to);
			assert.notEqual(patched, source, 'Unchanged replacement in ' + route);
			files.set(route, patched);
			replacements.push({route, from, to, count: matches, originalSha256: hash(source)});
			count += matches;
		}
		assert.equal(count, expected, variant + ': unexpected replacement count for ' + from);
	};
	if (modifier === 'arial') {
		replace(localScripts, 'system-ui', 'Arial', 1);
		replace(localStyles, 'system-ui', 'Arial', 1);
	}
	else if (modifier === 'systemfont') {
		replace(['/bench/d3.mjs'], 'Arial', 'system-ui', 2);
		replace(['/bench/demo.css'], 'Arial', 'system-ui', 1);
	}
	else if (modifier === 'nogrid') {
		const route = '/dist/uPlot.min.css';
		const source = files.get(route);
		const pattern = /(?:display: grid;|grid-[^:;{}]+:[^;{}]+;)/g;
		assert.equal([...source.matchAll(pattern)].length, 9);
		files.set(route, source.replace(pattern, ''));
		replacements.push({route, pattern: pattern.source, count: 9, originalSha256: hash(source)});
	}
	else if (modifier === 'nocursor')
		replace(['/bench/uplot.mjs'], 'cache: {paths: false},', 'cache: {paths: false},\n\t\tcursor: {show: false},', 1);
	else if (modifier === 'nopromote')
		replace(localStyles, 'will-change: transform;', 'will-change: auto;', 2);
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
	const profile = await mkdtemp(join(directory, variant + '-profile-'));
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
			await Promise.race([delay(50), failure]);
		}
		console.log('Running:', variant);
		const report = await Promise.race([captureBenchmarkTrace({
			profile, url: `http://127.0.0.1:${server.address().port}/?variant=${id}`, cache: directory,
			trace: false, memory: true, raf: false, dpr: 1, processPid: browser.pid,
			onSampleTimeout: () => killBenchmarkBrowser(browser),
		}), failure]);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 3);
		assert.equal(report.samples.filter(sample => !sample.warmup).length, 7);
		for (const sample of report.samples) {
			assert.equal(sample.variant, id);
			assert.equal(sample.dpr, 1);
			sample.variant = variant;
		}
		report.runner = {variant, servedVariant: id, replacements,
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
		try {
			if (browser) await killBenchmarkBrowser(browser);
		}
		finally {
			server.closeAllConnections();
			await new Promise(resolve => server.close(resolve));
			await rm(profile, {recursive: true, force: true});
		}
	}
}
console.log('Evidence:', join(directory, 'results.json'));
