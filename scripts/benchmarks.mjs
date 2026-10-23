// Downloads pinned demo dependencies and Chrome Headless Shell once, then reuses the cache.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { captureBenchmarkTrace } from './benchmarks-trace.mjs';
import { analyzeBenchmarkTrace } from './analyze-benchmarks-trace.mjs';
import { chromeBinary } from './chrome-headless-shell.mjs';
import { summarizeBenchmarkRaf } from './analyze-benchmarks-raf.mjs';
import { loadBenchDemoSources } from './bench-demo-sources.mjs';
import { benchmarkMode, variantReportName, runBenchmarkSuite, summarizeSavedBenchmarks } from './benchmarks-suite.mjs';

const root = new URL('../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
// Pin the version so later runs use the same browser.
const chromeVersion = '156.0.8078.47';
const {values, tokens} = parseArgs({tokens: true, options: {
	browser: {type: 'string', default: 'chrome'},
	trace: {type: 'boolean', default: false},
	raf: {type: 'boolean', default: false},
	memory: {type: 'boolean', default: false},
	variant: {type: 'string'},
	worker: {type: 'boolean', default: false},
	'summarize-only': {type: 'boolean', default: false},
	gpu: {type: 'boolean', default: false},
	dpr: {type: 'string', default: '1'},
	'install-only': {type: 'boolean', default: false},
	help: {type: 'boolean', short: 'h', default: false},
}});
if (values.help) {
	console.log(`Usage: npm run bench [-- --dpr NUMBER]
       npm run bench:trace [-- --dpr NUMBER]
       npm run bench:memory [-- --dpr NUMBER]
       npm run bench:raf [-- --dpr NUMBER]

bench records trace timings and process memory together on the same chart samples.
bench:trace records only trace timings. bench:memory measures only process memory.
bench:raf measures untraced next-rAF latency, without memory polling or forced GC.
There is no JS-heap benchmark or heap-usage sampling.

Defaults: uPlot, Chart.js, D3, ECharts, Flot, and Dygraphs, plus an idle control measured first.
Each variant gets a fresh browser with only its own library and demo dependencies.
Each library has 3 warmups and 7 measured rounds. There is no inter-library cooling pause.
The table shows per-metric minima after warmups: best observed performance, not typical latency.
Columns can come from different rounds. Total work is the minimum per-round total, not a sum of column minima.
Progress, partial results, and a cumulative table update after each library finishes.
Use --variant NAME to run one library plus idle. Supported: uplot, chartjs, d3, echarts, flot, dygraphs, idle.
DPR defaults to 1. --dpr selects one browser and canvas DPR.

Library loading, raw JSON parsing, and fixture setup occur outside chart timing.
Data preparation is timed separately. Init covers options, chart construction, and its initial microtask commit.
Trace chart windows include settling and deferred rendering, but exclude prep, forced GC, and teardown.
Settling is a heuristic, not a GPU completion fence. GPU thread work is not hardware GPU execution time.
Trace and rAF timings are not idle-subtracted; idle subtraction applies only to memory.

Memory requires Linux /proc access. It polls process memory with a requested 50 ms delay after each read.
Retained memory is measured after initialization, settling, and forced JS GC, with chart and prepared input alive.
GC occurs before preparation, after the chart window ends, and after teardown, never between prep and construction.
The headline shows baseline-adjusted browser-tree PSS in decimal MB. Renderer measurements stay in JSON.
Each sample subtracts its blank-page checkpoint and the minimum measured idle retained-minus-blank footprint.
Memory columns show minimum adjusted retained memory and the minimum of the per-round sampled peaks.
Peaks subtract settled idle memory, not the idle peak. Peaks are sampled, and negative estimates remain negative.
Combined trace and process polling affect both timing and memory, including trace-buffer allocations.
Use bench:memory for an untraced footprint. Native allocators need not release pages after GC.
GPU-specific memory is not measured. No heap snapshots, canvas readbacks, or screenshots are used.

Chrome Headless Shell ${chromeVersion} and pinned demo dependencies are downloaded once and cached.
CHROME_BIN overrides the browser. --install-only prepares the browser without a benchmark.
Automatic browser installation requires Linux x64 and unzip.
Results and compressed traces go to .cache/benchmarks. Each mode has its own default report files.
Use --summarize-only with any command to summarize its saved suite report without starting Chrome.
Summary-only mode uses the saved DPR and rejects --dpr, --variant, --worker, and --install-only.

Direct runner: node scripts/benchmarks.mjs [--trace] [--memory] [--raf] [--gpu] [--dpr NUMBER]
No measurement flags means trace + memory. rAF cannot be combined with tracing or memory.`);
	process.exit(0);
}
if (values.browser !== 'chrome')
	throw new Error('The benchmark requires --browser chrome.');
const dpr = Number(values.dpr);
if (!Number.isFinite(dpr) || dpr <= 0)
	throw new Error('--dpr must be a positive finite number.');
if (values.variant && !['uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs', 'idle'].includes(values.variant))
	throw new Error('Unsupported benchmark variant.');
if (values.worker && !values.variant)
	throw new Error('--worker requires --variant.');
const selectedMode = values.trace || values.memory || values.raf;
const measurements = {trace: values.trace || !selectedMode, memory: values.memory || !selectedMode, raf: values.raf};
const mode = benchmarkMode(measurements);
if (values['summarize-only']) {
	if (values.variant || values.worker || values['install-only'] || tokens.some(token => token.kind === 'option' && token.name === 'dpr'))
		throw new Error('--summarize-only cannot be combined with --dpr, --variant, --worker, or --install-only.');
	summarizeSavedBenchmarks(measurements);
	process.exit(0);
}
if (measurements.memory && platform() !== 'linux')
	throw new Error('Process memory measurement requires Linux /proc.');
if (!values.worker && !values['install-only']) {
	await runBenchmarkSuite({...measurements, dpr, gpu: values.gpu, variant: values.variant ?? null});
	process.exit(0);
}
const binary = await chromeBinary({version: chromeVersion});
if (values['install-only'])
	process.exit(0);
mkdirSync(cache, {recursive: true});
const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, values.variant);
for (const dependency of dependencies) {
	const path = join(cache, dependency.cacheName);
	if (!existsSync(path)) {
		console.log('Downloading ' + dependency.url);
		const response = await fetch(dependency.url, {signal: AbortSignal.timeout(30000)});
		if (!response.ok)
			throw new Error(`${dependency.name} download: HTTP ${response.status}`);
		writeFileSync(path, await response.text());
	}
	const source = readFileSync(path, 'utf8');
	files.set(dependency.route, source);
	dependency.sha256 = createHash('sha256').update(source).digest('hex');
}
files.set('/bench.mjs', readFileSync(new URL('scripts/benchmarks-trace-browser.mjs', root), 'utf8'));
files.set('/bench/data.json', readFileSync(new URL('bench/data.json', root), 'utf8'));
const page = '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>' +
	dependencies.map(dependency => dependency.type === 'style'
		? `<link rel="stylesheet" href="${dependency.route}">`
		: `<script src="${dependency.route}"></script>`).join('') +
	localScripts.map(route => `<script src="${route}"></script>`).join('') +
	localStyles.map(route => `<link rel="stylesheet" href="${route}">`).join('') +
	'<script type="module" src="/bench.mjs"></script>';
const profile = mkdtempSync(join(cache, 'chrome-'));
let rejectResult;
const failure = new Promise((resolve, reject) => { rejectResult = reject; });
failure.catch(() => {});
const interrupted = () => rejectResult(new Error('Benchmark interrupted by a termination signal.'));
process.once('SIGTERM', interrupted);
process.once('SIGINT', interrupted);
let browser;
let browserLog = '';
const server = createServer((req, res) => {
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	try {
		if (req.url === '/blank') {
			res.setHeader('Content-Type', 'text/html');
			res.end('<!doctype html><meta charset="utf-8"><title>Blank baseline</title>');
		}
		else if (req.url === '/' || req.url === '/?variant=' + values.variant) {
			res.setHeader('Content-Type', 'text/html');
			res.end(page);
		}
		else {
			if (files.has(req.url)) {
				res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.json') ? 'application/json' : 'text/javascript');
				res.end(files.get(req.url));
			}
			else
				res.writeHead(404).end();
		}
	}
	catch (error) {
		res.writeHead(500).end();
		rejectResult(error);
	}
});
const timeoutMs = 240000;
const timer = setTimeout(() => rejectResult(new Error(`Benchmark exceeded ${timeoutMs}ms.\n${browserLog}`)), timeoutMs);

try {
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const url = `http://127.0.0.1:${server.address().port}/?variant=${values.variant}`;
	const browserVersion = execFileSync(binary, ['--version'], {encoding: 'utf8', timeout: 10000}).trim();
	const browserArgs = [
		'--no-first-run', '--no-default-browser-check', '--disable-background-networking',
		'--disable-component-update', '--disable-sync', '--disable-extensions',
		'--user-data-dir=' + profile,
		...(values.gpu ? ['--enable-gpu'] : []),
		'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--window-size=1920,900', 'about:blank',
	];
	// Keep Chrome in the worker's process group so the suite can clean up all descendants.
	browser = spawn(binary, browserArgs, {detached: false, stdio: ['ignore', 'pipe', 'pipe']});
	for (const stream of [browser.stdout, browser.stderr])
		stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
	browser.once('error', rejectResult);
	browser.once('exit', code => rejectResult(new Error(`Chrome exited with code ${code}.\n${browserLog}`)));
	const report = await Promise.race([captureBenchmarkTrace({
		profile, url, cache, ...measurements, dpr, processPid: measurements.memory ? browser.pid : null,
		traceName: `trace-chrome-${mode}-${values.variant}.json`,
	}), failure]);
	report.measurements = measurements;
	report.runner = {
		date: new Date().toISOString(), cpu: cpus()[0]?.model, os: `${platform()} ${release()}`,
		headless: true, engine: 'chrome', binary, browserVersion, browserArgs, node: process.version,
		dpr, dependencies, variant: values.variant,
		sourceSha256: Object.fromEntries([...files].filter(([path]) => !path.startsWith('/bench/vendor/'))
			.map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])),
		browserLog,
	};
	if (measurements.trace) {
		const raw = readFileSync(report.trace.path);
		report.analysis = analyzeBenchmarkTrace(JSON.parse(raw), report);
		const compressed = gzipSync(raw);
		const compressedPath = report.trace.path + '.gz';
		writeFileSync(compressedPath, compressed);
		rmSync(report.trace.path);
		Object.assign(report.trace, {path: compressedPath, compression: 'gzip', compressedBytes: compressed.length});
	}
	if (measurements.raf)
		report.rafAnalysis = summarizeBenchmarkRaf(report);
	const output = join(cache, variantReportName(mode, values.variant));
	writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	console.log(`${values.variant}: ${report.samples.filter(sample => !sample.warmup).length} measured samples. ${browserVersion}`);
}
finally {
	clearTimeout(timer);
	if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
		const exited = new Promise(resolve => browser.once('exit', resolve));
		browser.kill('SIGTERM');
		await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]);
		browser.kill('SIGKILL');
	}
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	rmSync(profile, {recursive: true, force: true});
	process.removeListener('SIGTERM', interrupted);
	process.removeListener('SIGINT', interrupted);
}
