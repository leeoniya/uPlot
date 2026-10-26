// Cache-only, serial Linux/Chrome diagnostic; no production sources or reports are modified.
// node docs/investigations/benchmark-d3-shared-probe.mjs [--reverse | --isolated=uplot | --isolated=d3-minmax]
// Isolated controls: --control=block|nogrid|nocursor|nolegend|bare (uplot), or --control=grid (d3-minmax).
// Controls change chart presentation; they are diagnostic ablations, not equivalent optimizations.
// Requires the pinned Chrome binary, built dist assets, and cached D3 dependency.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CDP} from '../../scripts/profile-manual.mjs';
import {killBenchmarkBrowser} from '../../scripts/bench-browser-process.mjs';
import {loadBenchDemoSources} from '../../scripts/bench-demo-sources.mjs';
import {parseProcStat, readProcessMemory} from '../../scripts/bench-process-memory.mjs';

const control = process.argv.find(arg => arg.startsWith('--control='))?.slice('--control='.length) ?? null;
assert.ok(control === null || ['block', 'nogrid', 'nocursor', 'nolegend', 'bare', 'grid'].includes(control));
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--control='));
assert.ok(args.length === 0 || args.length === 1 && ['--reverse', '--isolated=uplot', '--isolated=d3-minmax'].includes(args[0]),
	'Usage: node docs/investigations/benchmark-d3-shared-probe.mjs [--reverse | --isolated=uplot | --isolated=d3-minmax]');
assert.equal(process.platform, 'linux', 'This probe requires Linux /proc.');
const reverse = args.includes('--reverse');
const isolated = args[0]?.startsWith('--isolated=') ? args[0].slice('--isolated='.length) : null;
assert.ok(!control || isolated === (control === 'grid' ? 'd3-minmax' : 'uplot'));
const variants = isolated ? [isolated] : ['uplot', 'd3-minmax'];
const startOrder = reverse ? [...variants].reverse() : [...variants];
const warmupRounds = 3;
const measuredRounds = 7;
const root = new URL('../../', import.meta.url);
const chromeVersion = '156.0.8078.47';
const binary = fileURLToPath(new URL(`node_modules/.cache/uplot-bench/chrome-headless-shell-${chromeVersion}-linux64/chrome-headless-shell`, root));
const directory = await mkdtemp('/tmp/uplot-shared-probe-');
const profile = join(directory, 'profile');
const output = join(directory, 'results.json');
const results = {
	config: {mode: isolated ? 'isolated' : 'shared', isolated, control, reverse, startOrder, warmupRounds, measuredRounds, binary, width: 1920, height: 900, dpr: 1,
		order: isolated ? 'Single variant across warmup and measured rounds.' : 'Continuous AB/BA alternation across warmup and measured rounds.',
		gc: 'Once after setup, once after data-update construct, once after destroy; no GC between operations.',
		settling: 'Blank: full document load, two RAFs, 200ms, GC. Fixture: only awaited benchmarkLifecycle methods; no additional checkpoint delay.',
		mappingUnits: 'Raw PSS bytes, summed by mapping path and process role at every stage; isolated summary uses decimal MB.',
		metricUnits: 'Decimal MB for process PSS; bytes for used JS heap.',
		pairedSign: isolated ? null : 'uplot minus d3-minmax',
	},
	samples: [],
};
console.log('Output:', directory);
let server, browser, page, browserClient;
let sampleIndex = 0;

const sha256 = source => createHash('sha256').update(source).digest('hex');

async function connect(url) {
	const socket = new WebSocket(url);
	const client = new CDP(socket, 30000);
	try {
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, {once: true});
			socket.addEventListener('error', reject, {once: true});
		});
		return client;
	}
	catch (error) {
		client.close();
		throw error;
	}
}

async function evaluate(expression) {
	const response = await page.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
	assert.ok(!response.exceptionDetails, response.exceptionDetails?.exception?.description ?? response.exceptionDetails?.text);
	return response.result.value;
}

async function memory() {
	for (let attempt = 0; attempt < 3; attempt++) {
		const {processInfo} = await browserClient.send('SystemInfo.getProcessInfo');
		const result = await readProcessMemory(browser.pid, {
			processTypes: new Map(processInfo.map(process => [process.id, process.type])), requireRenderer: true,
		});
		if (result.complete) return result;
		assert.ok(attempt < 2, JSON.stringify(result.issues));
		// Retry process churn, not chart settling; never repeat GC here.
		await delay(50);
	}
}

// Observational only: the caller owns all GC and lifecycle settling.
async function snapshot(includeMappings = true) {
	const startedAt = new Date().toISOString();
	const heap = await page.send('Runtime.getHeapUsage');
	const dom = await page.send('Memory.getDOMCounters');
	const processes = await memory();
	const mappings = includeMappings ? Object.create(null) : null;
	const byRole = includeMappings ? Object.create(null) : null;
	const binaryByProtection = {};
	if (includeMappings) {
		for (const process of processes.processes) {
			const checkIdentity = async () => {
				const stat = parseProcStat(await readFile(`/proc/${process.pid}/stat`, 'utf8'));
				assert.ok(stat.pid === process.pid && stat.startTime === process.startTime && stat.ppid === process.ppid,
					`Process ${process.pid} changed during smaps capture.`);
			};
			await checkIdentity();
			const text = await readFile(`/proc/${process.pid}/smaps`, 'utf8');
			await checkIdentity();
			const role = byRole[process.type] ??= Object.create(null);
			let path, protection;
			let count = 0;
			for (const line of text.split('\n')) {
				const header = /^[0-9a-f]+-[0-9a-f]+\s+(\S+)\s+\S+\s+\S+\s+\S+\s*(.*)$/.exec(line);
				if (header) {protection = header[1]; path = header[2] || '[anonymous]';}
				else if (line.startsWith('Pss:')) {
					const match = /^Pss:\s+(\d+)\s+kB$/.exec(line);
					assert.ok(path && match, `Invalid smaps PSS for process ${process.pid}.`);
					const bytes = Number(match[1]) * 1024;
					mappings[path] = (mappings[path] ?? 0) + bytes;
					role[path] = (role[path] ?? 0) + bytes;
					if (path === binary) {
						const scope = binaryByProtection[process.type] ??= {};
						scope[protection] = (scope[protection] ?? 0) + bytes;
					}
					count++;
				}
			}
			assert.ok(count > 0, `No smaps PSS for process ${process.pid}.`);
		}
	}
	return {startedAt, finishedAt: new Date().toISOString(), heap, dom, processes, mappings, byRole, binaryByProtection};
}

async function sample(variant, turn, position) {
	const warmup = turn < warmupRounds;
	const id = `sample-${sampleIndex++}`;
	const row = {variant, turn, round: warmup ? turn + 1 : turn - warmupRounds + 1, warmup, position, id, phases: []};
	results.samples.push(row);
	await evaluate(`benchmarkLifecycle.setup(${JSON.stringify(variant)}, ${JSON.stringify(id)})`);
	await page.send('HeapProfiler.collectGarbage');
	row.before = await snapshot(true);
	await evaluate(`benchmarkLifecycle.prepare('small-init', ${JSON.stringify(id)})`);
	row.phases.push(await evaluate('benchmarkLifecycle.construct()'));
	const updateId = `sample-${sampleIndex++}`;
	await evaluate(`benchmarkLifecycle.prepare('data-update', ${JSON.stringify(updateId)})`);
	row.phases.push(await evaluate('benchmarkLifecycle.construct()'));
	await page.send('HeapProfiler.collectGarbage');
	row.live = await snapshot(true);
	await evaluate('benchmarkLifecycle.destroy()');
	await page.send('HeapProfiler.collectGarbage');
	row.cleanup = await snapshot(true);
}

function metrics(snapshot) {
	return {treePssMB: snapshot.processes.tree.pssMB, rendererPssMB: snapshot.processes.renderer.pssMB,
		jsHeapBytes: snapshot.heap.usedSize};
}

function subtract(a, b) {
	return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
		.map(key => [key, (a[key] ?? 0) - (b[key] ?? 0)]));
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return {mean: values.reduce((sum, value) => sum + value, 0) / values.length,
		median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2};
}

function aggregate(rows) {
	const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
	return Object.fromEntries(keys.map(key => [key, stats(rows.map(row => row[key] ?? 0))])
		.sort((a, b) => Math.abs(b[1].mean) - Math.abs(a[1].mean)));
}

function contrasts(sample, select) {
	const before = select(sample.before);
	const live = select(sample.live);
	const cleanup = select(sample.cleanup);
	return {before, live, cleanup, liveMinusBaseline: subtract(live, before),
		cleanupMinusBaseline: subtract(cleanup, before), liveMinusCleanup: subtract(live, cleanup)};
}

function pairedContrasts(uplot, d3, select) {
	const a = contrasts(uplot, select);
	const b = contrasts(d3, select);
	return Object.fromEntries(Object.keys(a).map(key => [key, subtract(a[key], b[key])]));
}

function summarize() {
	const measured = results.samples.filter(row => !row.warmup);
	const roles = [...new Set(measured.flatMap(row => ['before', 'live', 'cleanup']
		.flatMap(checkpoint => Object.keys(row[checkpoint].byRole))))];
	const pairs = [];
	for (let round = 1; round <= measuredRounds; round++) {
		const rows = measured.filter(row => row.round === round);
		assert.equal(rows.length, 2);
		const uplot = rows.find(row => row.variant === 'uplot');
		const d3 = rows.find(row => row.variant === 'd3-minmax');
		const mappingDeltas = {tree: pairedContrasts(uplot, d3, snapshot => snapshot.mappings)};
		for (const role of roles)
			mappingDeltas[role] = pairedContrasts(uplot, d3, snapshot => snapshot.byRole[role] ?? {});
		const pair = {round, order: rows.map(row => row.variant),
			perVariant: Object.fromEntries(rows.map(row => [row.variant, contrasts(row, metrics)])),
			uplotMinusD3: pairedContrasts(uplot, d3, metrics), mappingDeltas};
		pairs.push(pair);
		console.log(JSON.stringify({round, order: pair.order, uplotMinusD3: pair.uplotMinusD3}));
	}
	const kinds = Object.keys(pairs[0].uplotMinusD3);
	const pairedMetrics = Object.fromEntries(kinds.map(kind => [kind, aggregate(pairs.map(pair => pair.uplotMinusD3[kind]))]));
	const pairedMappings = Object.fromEntries(['tree', ...roles].map(role => [role,
		Object.fromEntries(kinds.map(kind => [kind, aggregate(pairs.map(pair => pair.mappingDeltas[role][kind]))])),
	]));
	return {pairs, pairedMetrics, pairedMappings};
}

// Path-based categories are descriptive, not proof of which library owns a mapping.
function mappingCategory(path) {
	if (path === '[anonymous]' || path === '[heap]' || path.startsWith('[anon:')) return 'anonymous';
	if (/fontconfig/i.test(path)) return 'fontconfig';
	if (/\/fonts\/|\.(?:ttf|otf|ttc|woff2?)(?: \(deleted\))?$/i.test(path)) return 'fonts';
	if (/\bicu(?:dtl|data|uc|i18n)/i.test(path)) return 'icu';
	if (path === binary || path === binary + ' (deleted)') return 'chromeBinary';
	if (/\/dev\/shm\/|\/memfd:|^memfd:|\/\.org\.chromium\./.test(path)) return 'sharedMemory';
	if (/\.so(?:\.|$| \(deleted\))/.test(path)) return 'sharedLibraries';
	if (path.startsWith('[')) return 'special';
	return 'otherFiles';
}

function categoryTotals(mappings) {
	const totals = {};
	for (const [path, value] of Object.entries(mappings)) {
		const category = mappingCategory(path);
		totals[category] = (totals[category] ?? 0) + value;
	}
	return totals;
}

function summarizeIsolated() {
	const measured = results.samples.filter(row => !row.warmup);
	assert.equal(measured.length, measuredRounds);
	const roles = ['tree', ...new Set([...Object.keys(results.blank.byRole),
		...measured.flatMap(row => Object.keys(row.live.byRole))])];
	const roleMappings = (snapshot, role) => role === 'tree' ? snapshot.mappings : snapshot.byRole[role] ?? {};
	const rounds = measured.map((row, measuredSampleIndex) => {
		const mappingDeltasMB = {};
		const categoryDeltasMB = {};
		for (const role of roles) {
			const delta = subtract(roleMappings(row.live, role), roleMappings(results.blank, role));
			mappingDeltasMB[role] = Object.fromEntries(Object.entries(delta).map(([path, bytes]) => [path, bytes / 1e6]));
			categoryDeltasMB[role] = categoryTotals(mappingDeltasMB[role]);
		}
		const result = {round: row.round, sampleIndex: results.samples.indexOf(row), measuredSampleIndex,
			id: row.id, liveId: row.phases.at(-1).id, live: metrics(row.live),
			liveMinusBlank: subtract(metrics(row.live), metrics(results.blank)),
			mappingDeltasMB, categoryDeltasMB};
		console.log(JSON.stringify({round: result.round, sampleIndex: result.sampleIndex, liveMinusBlank: result.liveMinusBlank}));
		return result;
	});
	const liveMinusBlankMetrics = aggregate(rounds.map(row => row.liveMinusBlank));
	const liveMinusBlankMappingsMB = Object.fromEntries(roles.map(role => [role,
		aggregate(rounds.map(row => row.mappingDeltasMB[role])),
	]));
	// Sum each sample's categories before taking medians; medians of mappings are not additive.
	const liveMinusBlankCategoriesMB = Object.fromEntries(roles.map(role => [role,
		aggregate(rounds.map(row => row.categoryDeltasMB[role])),
	]));
	const minimum = rounds.reduce((best, row) => row.live.treePssMB < best.live.treePssMB ? row : best);
	const minTreeLive = {sampleIndex: minimum.sampleIndex, measuredSampleIndex: minimum.measuredSampleIndex,
		round: minimum.round, id: minimum.id, liveId: minimum.liveId, live: minimum.live,
		liveMinusBlank: minimum.liveMinusBlank, categoryDeltasMB: minimum.categoryDeltasMB};
	console.log('Live-minus-blank metric mean/median:', JSON.stringify(liveMinusBlankMetrics));
	console.log('Live-minus-blank category PSS mean/median (MB):', JSON.stringify(liveMinusBlankCategoriesMB, null, 2));
	console.log('Minimum tree live PSS sample:', JSON.stringify(minTreeLive));
	return {variant: isolated, sampleIndexMeaning: 'Zero-based index into results.samples; measuredSampleIndex excludes warmups.',
		categoryMethod: 'Mapping-path heuristics; see mappingCategory in the hashed probe source. Categories do not imply library ownership.',
		rounds, liveMinusBlankMetrics, liveMinusBlankMappingsMB, liveMinusBlankCategoriesMB, minTreeLive};
}

try {
	const files = new Map();
	const dependencies = new Map();
	const localScripts = new Set();
	const localStyles = new Set();
	for (const variant of variants) {
		const sources = loadBenchDemoSources(root, variant);
		for (const [route, source] of sources.files) {
			if (files.has(route)) assert.equal(sha256(files.get(route)), sha256(source), `Conflicting asset: ${route}`);
			files.set(route, source);
		}
		for (const dependency of sources.dependencies) {
			if (dependencies.has(dependency.route)) assert.deepEqual(dependencies.get(dependency.route), dependency);
			dependencies.set(dependency.route, dependency);
		}
		for (const route of sources.localScripts) localScripts.add(route);
		for (const route of sources.localStyles) localStyles.add(route);
	}
	if (control === 'nogrid') {
			const route = '/dist/uPlot.min.css';
			const source = files.get(route);
			const pattern = /(?:display: grid;|grid-[^:;{}]+:[^;{}]+;)/g;
			assert.equal([...source.matchAll(pattern)].length, 9);
			files.set(route, source.replace(pattern, ''));
		}
		else if (control === 'block' || control === 'grid') {
			const css = control === 'block' ? '.uplot{display:block!important}' : 'body .legend{display:grid!important;grid-auto-flow:column;grid-auto-columns:max-content}';
			assert.ok(files.has('/bench/demo.css'));
			files.set('/bench/demo.css', files.get('/bench/demo.css') + '\n' + css);
		}
		else if (control) {
			const options = {nocursor:'cursor:{show:false},', nolegend:'legend:{show:false},',
				bare:'cursor:{show:false},legend:{show:false},select:{show:false},'};
			const source = files.get('/bench/uplot.mjs');
			const from = 'cache: {paths: false},';
			assert.equal(source.split(from).length - 1, 1);
			files.set('/bench/uplot.mjs', source.replace(from, from + options[control]));
		}
		files.set('/bench/data.json', await readFile(new URL('bench/data.json', root)));
	const original = await readFile(new URL('scripts/benchmarks-trace-browser.mjs', root), 'utf8');
	files.set('/bench.mjs', original);
	results.patch = null;
	if (!isolated) {
		const from = "const VARIANTS = selectedVariant ? [selectedVariant] : [...benchmarkVariants, 'idle'];";
		const to = "const VARIANTS = ['uplot', 'd3-minmax'];";
		assert.equal(original.split(from).length - 1, 1, 'Expected exactly one benchmark VARIANTS line.');
		assert.ok(original.split('\n').includes(from), 'Expected an exact benchmark VARIANTS line.');
		files.set('/bench.mjs', original.replace(from, to));
		results.patch = {route: '/bench.mjs', from, to, originalSha256: sha256(original)};
	}
	for (const dependency of dependencies.values()) {
		assert.ok(!dependency.type || ['script', 'style'].includes(dependency.type), 'Unexpected dependency type.');
		// Deliberately no downloader or network fallback.
		files.set(dependency.route, await readFile(new URL('.cache/benchmarks/' + dependency.cacheName, root)));
		(dependency.type === 'style' ? localStyles : localScripts).add(dependency.route);
	}
	files.set('/bench/runtime-assets.json', '[]');
	files.set('/bench/module-assets.json', '[]');
	files.set('/blank', '<!doctype html><meta charset="utf-8"><title></title><body></body>');
	files.set('/', '<!doctype html><meta charset="utf-8">' +
		[...localStyles].map(path => `<link rel="stylesheet" href="${path}">`).join('') +
		[...localScripts].map(path => `<script src="${path}"></script>`).join('') + '<script type="module" src="/bench.mjs"></script>');
	results.sourceSha256 = Object.fromEntries([...files].map(([route, source]) => [route, sha256(source)]));
	results.probeSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
	results.dependencies = [...dependencies.values()];
	results.scripts = [...localScripts];
	results.styles = [...localStyles];
	server = createServer((request, response) => {
		const path = new URL(request.url, 'http://localhost').pathname;
		if (!files.has(path)) return response.writeHead(404).end();
		response.setHeader('Content-Type', path === '/' || path === '/blank' ? 'text/html' : path.endsWith('.css') ? 'text/css' :
			path.endsWith('.json') ? 'application/json' : 'text/javascript');
		response.end(files.get(path));
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const flags = ['--no-first-run', '--no-default-browser-check', '--disable-background-networking',
		'--disable-component-update', '--disable-sync', '--disable-extensions', '--enable-gpu', '--enable-features=Vulkan',
		'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile,
		'--force-device-scale-factor=1', '--window-size=1920,900', 'about:blank'];
	results.chromeFlags = flags;
	browser = spawn(binary, flags, {stdio: ['ignore', 'ignore', 'pipe']});
	let log = '', port, launchError;
	browser.once('error', error => { launchError = error; });
	browser.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
	for (let attempt = 0; attempt < 100; attempt++) {
		if (launchError) throw launchError;
		assert.ok(browser.exitCode === null && browser.signalCode === null, log);
		try {
			port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
			if (/^\d+$/.test(port)) break;
		}
		catch {}
		await delay(50);
	}
	assert.match(port ?? '', /^\d+$/, log);
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	page = await connect(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
	const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
	results.browser = version.Browser;
	assert.ok(version.Browser.endsWith('/' + chromeVersion), `Expected Chrome ${chromeVersion}, got ${version.Browser}`);
	browserClient = await connect(version.webSocketDebuggerUrl);
	await page.send('Page.enable');
	await page.send('Emulation.setDeviceMetricsOverride', {width: 1920, height: 900, deviceScaleFactor: 1, mobile: false});
	const origin = `http://127.0.0.1:${server.address().port}`;
	const blankLoaded = page.wait('Page.loadEventFired');
	await page.send('Page.navigate', {url: origin + '/blank'});
	await blankLoaded;
	assert.equal(await evaluate('document.readyState'), 'complete');
	await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200))))');
	await page.send('HeapProfiler.collectGarbage');
	results.blank = await snapshot(true);
	const loaded = page.wait('Page.loadEventFired');
	await page.send('Page.navigate', {url: `${origin}/?variant=${isolated ?? 'uplot'}`});
	await loaded;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await evaluate('globalThis.benchmarkTraceReady === true')) break;
		await delay(50);
	}
	assert.equal(await evaluate('globalThis.benchmarkTraceReady === true'), true);
	results.lifecycle = await evaluate('benchmarkLifecycle.begin()');
	assert.deepEqual(results.lifecycle.config.variants, variants);
	assert.equal(results.lifecycle.config.dpr, 1);
	await page.send('HeapProfiler.collectGarbage');
	results.loaded = await snapshot();
	for (let turn = 0; turn < warmupRounds + measuredRounds; turn++) {
		const order = turn % 2 ? [...startOrder].reverse() : startOrder;
		for (const [position, variant] of order.entries())
			await sample(variant, turn, position);
		if (turn === warmupRounds - 1)
			// The preceding destroy already settled and collected; do not repeat either.
			results.postWarmup = await snapshot();
	}
	results.summary = isolated ? summarizeIsolated() : summarize();
	if (!isolated) {
		console.log('Paired metric mean/median:', JSON.stringify(results.summary.pairedMetrics, null, 2));
		for (const role of ['tree', 'renderer']) {
			for (const kind of ['live', 'liveMinusBaseline', 'cleanupMinusBaseline']) {
				const mappings = results.summary.pairedMappings[role]?.[kind] ?? {};
				console.log(`${role} ${kind} mapping PSS deltas (bytes; top 12 by absolute mean):`,
					JSON.stringify(Object.fromEntries(Object.entries(mappings).slice(0, 12)), null, 2));
			}
		}
	}
}
catch (error) {
	results.error = {message: error.message, stack: error.stack};
	throw error;
}
finally {
	// Attempt every cleanup even if saving evidence or killing the browser fails.
	const errors = [];
	for (const cleanup of [
		async () => { await writeFile(output, JSON.stringify(results, null, 2)); console.log('Evidence:', output); },
		() => page?.close(),
		() => browserClient?.close(),
		() => { if (browser?.pid) killBenchmarkBrowser(browser); },
		async () => { if (server?.listening) await new Promise(resolve => server.close(resolve)); },
		() => rm(profile, {recursive: true, force: true}),
	]) {
		try { await cleanup(); }
		catch (error) { errors.push(error); }
	}
	if (errors.length) {
		if (results.error) console.error('Cleanup errors:', errors);
		else throw new AggregateError(errors, 'Shared probe cleanup failed.');
	}
}
