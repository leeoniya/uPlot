// Downloads pinned demo dependencies and Chrome Headless Shell once, then reuses the cache.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { captureBenchmarkTrace } from './benchmarks-trace.mjs';
import { killBenchmarkBrowser } from './bench-browser-process.mjs';
import { SAMPLE_TIMEOUT_EXIT_CODE } from './bench-sample-timeout.mjs';
import { analyzeBenchmarkTraceFile } from './analyze-benchmarks-trace.mjs';
import { chromeBinary } from './chrome-headless-shell.mjs';
import { summarizeBenchmarkRaf } from './analyze-benchmarks-raf.mjs';
import { loadBenchDemoSources } from './bench-demo-sources.mjs';
import { bundleModuleDependencies } from './bench-module-bundle.mjs';
import { benchmarkMode, resolveBenchmarkVulkan, variantReportName, traceReportName, benchmarkVariantMetadata, runBenchmarkSuite, summarizeSavedBenchmarks } from './benchmarks-suite.mjs';
import { demoDependencies, benchmarkVariants, assertBenchmarkAvailable } from '../bench/demo-dependencies.mjs';

const root = new URL('../', import.meta.url);
const cache = fileURLToPath(new URL('.cache/benchmarks/', root));
// Pin the version so later runs use the same browser.
const chromeVersion = '156.0.8078.47';
const {values, tokens} = parseArgs({tokens: true, options: {
	browser: {type: 'string', default: 'chrome'},
	trace: {type: 'boolean', default: false},
	raf: {type: 'boolean', default: false},
	memory: {type: 'boolean', default: false},
	dashboard: {type: 'boolean', default: false},
	variant: {type: 'string'},
	worker: {type: 'boolean', default: false},
	'summarize-only': {type: 'boolean', default: false},
	verbose: {type: 'boolean', default: false},
	gpu: {type: 'boolean', default: false},
	vulkan: {type: 'boolean'},
	'no-vulkan': {type: 'boolean'},
	dpr: {type: 'string', default: '1'},
	'install-only': {type: 'boolean', default: false},
	help: {type: 'boolean', short: 'h', default: false},
}});
const vulkan = resolveBenchmarkVulkan(values);
if (values.help && values.dashboard) {
	console.log(`Usage: bun run bench:dash [--trace | --memory | --raf] [--variant NAME] [--dpr NUMBER]
       node scripts/benchmarks.mjs --dashboard [--trace] [--memory] [--raf] [--gpu]

--dashboard selects 20 charts in a 4x5 grid at 1920x1080 CSS pixels.
Each 480x216 chart has five series. Each session initializes two rows, then updates to 300 rows per series.
The same 20 chart instances survive the update. No resize or hover phase occurs.
Reports use workload.protocol dashboard-v1, phase chart-population, and initProtocol settled-work-v1.
The only operations are small-init and data-update. Each browser runs three warmups and seven measured sessions.
Whole-dashboard timings are not divided by the number of charts.
Trace init ms and update ms measure full-window thread work, including deferred work and completion checks.
rAF-only init rAF ms and next rAF ms measure callback latency, not presentation or thread work.
rAF-only update ms measures update readiness. prep ms measures full-data preparation.
Memory uses through-update-v1: polling covers initialization, preparation, and update through the live checkpoint.
Forced GC precedes baseline and post-update live. All charts and full prepared inputs remain alive at live.
Memory collection ends at live. Chart teardown runs after the timing phases.
Memory columns show minimum blank-adjusted browser-tree PSS.
Incomplete blank reads retry before library load, with at most five settled post-GC attempts. The first complete read supplies the baseline.
JSON retains blank.attempts. If every attempt fails, adjusted memory stays unavailable and the warning includes the final failure reason.
Loaded and measured observations do not retry.
Capture already records a settled, post-GC /blank checkpoint in each fresh browser before library or fixture load.
The blank checkpoint uses the same viewport, DPR, and trace mode as the chart samples.
Adjusted retained = raw live - own browser blank. Adjusted peak = raw sampled peak - own browser blank.
There is no extra idle offset. The calculation does not subtract loaded-library checkpoints or warm session baselines.
Library and fixture overhead therefore remain included.
Process churn and shared mappings can still produce negative deltas. Negative values remain negative.
There is no JS-heap sampling or GPU device-memory measurement.

No measurement flags means trace + memory. --trace and --memory can be combined. --raf requires a separate pass.
--variant NAME selects only that variant. No mode runs idle automatically.
Use --variant idle for an explicit diagnostic, not a memory subtraction offset.
Default chart variants (44): ${benchmarkVariants.join(', ')}.
LIGHTNINGCHART_LICENSE adds licensed LightningChart. LIGHTNINGCHART_LICENSE_INFORMATION accepts vendor metadata as JSON.
SCICHART_LICENSE optionally supplies a SciChart runtime key. Existing benchmark restrictions still apply.
Each variant uses a fresh browser and shared cached vendor assets. CHROME_BIN overrides the pinned browser.
--gpu enables GPU. --vulkan requests Vulkan. --no-vulkan disables automatic Vulkan selection.
On Linux, the default suite and explicit ChartGPU select Vulkan automatically. Overrides cannot be combined.
Twenty independent WebGL contexts can exceed browser limits. No fallback renderer or context-limit override is implied.
Dashboard plotly explicitly uses pinned virtual-webgl 1.0.7 WebGL1; single-chart Plotly and dashboard plotly-svg do not.
--dpr defaults to 1. --verbose adds main ms and gpu ms to tables without changing measurements.
--summarize-only refreshes the saved dashboard suite without a browser, using its saved DPR.
It rejects --dpr, --variant, --worker, and --install-only. Workload dimensions must match across all reports.
Older saved memory reports already contain blank checkpoints. --summarize-only recalculates memory with the new formula, without an idle offset.
The raw through-update-v1 capture lifecycle remains unchanged.
Saved reports require the current lifecycle protocols. Trace reports require accountingProtocol: thread-work-gc-v2. Memory reports require memoryProtocol: through-update-v1.
Saved summaries require explicit matching requestedBackend metadata and sampling, context, and lossy snapshots.

--install-only prepares the browser without a benchmark. --browser supports chrome only.
Each operation has a five-second budget. Library errors or timeouts leave unavailable metrics and continue the suite.
Ordinary errors or timeouts in explicit idle diagnostics also continue the suite. Cancellation and infrastructure failures stop the suite.
Reports use results-chrome-dashboard-<mode>[-vulkan][-variant].json in .cache/benchmarks.
Traces use trace-chrome-dashboard-<mode>[-vulkan]-<variant>.json with the capture compression suffix.
Single-chart reports use separate paths. Temporary Chrome profiles use the system temporary directory.`);
	process.exit(0);
}
if (values.help) {
	console.log(`Usage: npm run bench [-- --dpr NUMBER]
       npm run bench:trace [-- --dpr NUMBER]
       npm run bench:memory [-- --dpr NUMBER]
       npm run bench:raf [-- --dpr NUMBER]

bench records trace timings and process memory together on the same chart samples.
bench:trace records only trace timings, without memory polling or forced GC. bench:memory measures only process memory.
bench:raf measures untraced next-rAF latency, without memory polling or forced GC.
There is no JS-heap benchmark or heap-usage sampling.
Use bun run bench:dash or --dashboard for 20 five-series charts at 1920x1080, with no resize or hover.
Use --dashboard --help for that workload. The lifecycle details below describe the single-chart benchmark.

Default chart variants (44): ${benchmarkVariants.join(', ')}.
No mode runs idle automatically. Explicit --variant idle runs a diagnostic, not a memory subtraction offset.
uplot uses the local IIFE build. uplot-release uses pinned uPlot ${demoDependencies['uplot-release'][0].version} IIFE/CSS from jsDelivr and runs immediately after it.
The release keeps its native behavior, including path caching when cache.paths:false is unsupported.
LightningChart runs when LIGHTNINGCHART_LICENSE supplies a runtime key.
JSCharting is demo-only: version 3.4.0 retains destroyed charts across repeated samples.
ChartGPU runs in the default suite and requires hardware WebGPU.
On Linux, runs that include ChartGPU automatically request Vulkan for every selected worker.
Other explicit variants and other platforms keep Chrome's default backend unless overridden.
Each variant gets a fresh browser with only its own library and demo dependencies.
Each library has 3 warmup sessions and 7 measured sessions. There is no inter-library cooling pause.
A session creates a two-point chart, updates it with the full dataset, then resizes the retained chart to 1200x400.
Supported variants then hover ten distinct datapoints, cycling through the three series.
Single-chart reports require phase: chart-population, initProtocol: settled-work-v1, resizeProtocol: retained-resize-v1, and hoverProtocol: hover-ten-v3.
The hover snapshot requires hover.count: 10 and hover.intervalMs: 50.
The hover.variants snapshot records supported variants. Unimplemented variants omit the hover phase and leave hover10 ms blank.
The lifecycle.resizeSize metadata records width: 1200 and height: 400. Top-level session timings still describe data-update.
Each operation has a hard 5s budget, including preparation and completion checks. Final cleanup has its own 5s budget.
A library timeout kills Chrome, discards the incomplete trace, shows '-' for all metrics, and continues the suite.
Library errors also show '-' and continue; details remain in the suite JSON.
Ordinary errors or timeouts in explicit idle diagnostics also continue the suite.
Cancellation and suite infrastructure failures still stop the suite.
Trace/combined timing columns show arithmetic means across the seven measured runs, excluding warmups.
Total work averages per-run deduplicated totals, including observed main-thread and background GC. GC is not added again.
JSON retains minima, maxima, means, and raw samples. rAF-only timings and memory columns still use minima.
Progress, partial results, and a cumulative table update after each library finishes.
Table names omit renderer/sampling suffixes. Library groups stay together, fastest implementation first.
Trace/combined groups rank by their lowest implementation mean update ms; rAF groups rank by best next rAF ms. Memory groups keep execution order.
CLI selection, filenames, progress, warnings, and JSON retain full variant IDs.
Columns start with variant, context, sampling, lossy. '*' flags potentially lossy reduction; '?' means unverified or missing classification.
A blank lossy cell means no configured reduction or verified bucket-extrema preservation, not pixel-identical output.
Default combined measurement columns: prep ms, init ms, update ms, peak MB, retained MB, resize ms, hover10 ms.
Use --verbose to show main ms and gpu ms before update ms in live tables and saved summaries.
--verbose defaults to false and changes only the table. Full rows, metrics, and JSON remain unchanged.
A one-space gap between separate borders follows retained MB only before resize ms, resize rAF ms, or hover10 ms.
Trace/combined init ms, update ms, resize ms, and hover10 ms use the same smooth color-scale algorithm as memory/combined peak MB and retained MB.
Each column uses an independent scale from the current displayed rows, with raw values before rounding.
The main ms field in full rows identifies trace timings, even when the table hides that column.
The display leaves prep ms, main ms, gpu ms, and all rAF-only timing columns uncolored.
Each scale sorts finite, nonnegative raw values in ascending order. Negative, missing, and nonfinite values remain uncolored and do not affect the scale.
If no eligible values exist or the minimum is zero, the entire column remains uncolored. This rule applies to timings and memory.
Otherwise, the first stop is green #22c55e at the positive column minimum.
Group caps use multipliers [1.5, 2, 4, 8, 16], each relative to its own group minimum.
The first group minimum is the column minimum. Each later group minimum is the lowest observed value greater than the previous cap.
Values equal to a cap belong to that group, not the next group.
When no observed values remain beyond the previous cap, that cap becomes the next group minimum.
The five caps mark lime #84cc16, gold #facc15, orange #f97316, red #ef2929, and deep red #b91c1c, respectively.
RGB channels interpolate continuously between adjacent stops, using the log-space value fraction. There are no shade resets at group boundaries.
Values greater than the last cap stay deep red, without an error.
The scale does not normalize to the maximum or stretch unused hues. It does not use absolute frame/ms thresholds.
Colors recompute as rows arrive. New smaller or intermediate values can change later stops and existing colors.
New values greater than the existing maximum leave existing colors unchanged. Independent columns or tables can give the same raw value different colors.
Colors do not change measurements or aggregation: trace timings use arithmetic means, while memory columns use minima.
Context colors: 2d blue, svg orange, webgl yellow, webgl2 pink, webgpu purple. Unknown contexts remain plain.
Trace update ms measures selected host-thread work, not elapsed frame latency.
Truecolor terminals show the continuous RGB scale in live tables and saved summaries.
For 256-color terminals, each interpolated RGB color maps to the nearest color in the fixed xterm color cube or grayscale palette.
This approximation does not use separate, manually selected bands.
Redirected output, basic-color terminals, TERM=dumb, and any NO_COLOR value disable colors. JSON stays plain.
Use --variant NAME to run only that variant. Registered: ${Object.keys(demoDependencies).join(', ')}.
LightningChart requires LIGHTNINGCHART_LICENSE. SCICHART_LICENSE optionally supplies a SciChart runtime key.
LIGHTNINGCHART_LICENSE_INFORMATION can supply vendor-required metadata as JSON.
DPR defaults to 1. --dpr selects one browser and canvas DPR.

Library loading, raw JSON parsing, and the shared page shell occur outside chart timing. Chart-specific DOM setup is inside init.
Data preparation is timed separately for initialization and data-update. Resize and hover reuse the retained full-data chart. Small and full inputs have distinct references, lengths, and contents.
prep ms measures full-data preparation. Trace init ms measures full-window initialization thread work, including deferred layout and paint.
Idle gaps in the settling wait do not count as work. Constructor readiness remains in JSON.
rAF-only reports init rAF ms instead: first callback latency, not settled work or proof of presentation.
Trace/combined update ms and resize ms measure full-window thread work, using the same metric as init ms.
Resize includes deferred layout, paint, raster, GPU-process work, and observed GC within its complete window.
rAF-only resize rAF ms uses resize raf1Ms. This callback latency is not thread work.
hover10 ms is cumulative complete-window thread work for ten mousemoves in trace/combined modes, not an average per point.
Trusted CDP mouse moves drive normal chart hit testing. One browser binding sends all ten coordinate targets to Node.
Node sends ten CDP dispatches with nine 50 ms waits, each after the preceding CDP acknowledgment.
Node sends one browser Runtime.evaluate completion acknowledgment after the tenth dispatch acknowledgment.
There is no catch-up, per-point renderer timer, renderer acknowledgment, or rAF.
The measured window contains no value verification or harness DOM/canvas reads.
The window ends after two rAF callbacks, a 200 ms settling wait, and graphics-completion checks.
Batching reduces input-bridge overhead but does not eliminate it. Node scheduling is outside measured browser threads.
Target preparation and bounds validation occur outside the window. Diagnostic value verification never runs during capture or preflight.
Hover phases retain count: 10 and intervalMs: 50 without verification evidence.
rAF-only hover10 ms uses sequence-to-post-readiness callback latency, including at least 450 ms of spacing but excluding final settling/fences.
Idle spacing is not thread work. Only hover-ten-v3 reports are accepted, including in memory-only mode.
Update readiness remains in JSON. rAF-only update ms still measures small-to-full update readiness, not thread work.
main, gpu, and prep remain data-update columns. next rAF describes update callback latency.
Primary groups contain data-update only. phaseGroups contains all captured operations, with distinct IDs and full trace metric details.
The update includes full-size allocation costs; it is not a steady-state full-to-full replacement measurement.
HTML demos still construct directly with the full dataset.
Trace chart windows include settling and deferred rendering, but exclude prep, forced GC, and teardown.
After settling, trace/memory runs check WebGL2 fences or call WebGL1 finish. This tracked work counts toward trace init ms.
ChartGPU also checks its actual WebGPU device queues after settling. Its initial queue wait remains inside init in every mode.
GPU thread work is host-thread wall time, not hardware GPU execution time. Completion checks add overhead.
Trace totals include allowlisted background V8/CppGC work, with per-thread overlap removal. Unpark/wait scopes are not added.
JSON records backgroundGcMs and gcAddedThreadWorkMs. Trace reports require accountingProtocol: thread-work-gc-v2.
Missing relevant GC scopes produce null metrics. Available scopes with no window overlap produce zero backgroundGcMs.
Zero gcAddedThreadWorkMs means no added duration after overlap removal, not proof of no collection.
No timing or memory result subtracts idle measurements.

Memory requires Linux /proc access. Memory-enabled lifecycle reports use memoryProtocol: 'through-update-v1'.
Process polling covers only preparation, small-init, and data-update, with a requested 50 ms delay after each read.
After data-update settles and graphics completion checks finish, forced JS GC precedes the live snapshot.
Retained memory includes the live chart and full prepared input at the original 1920x600 size, before resize or tooltip interaction.
Peaks include baseline, initialization, preparation, update, and the post-update live checkpoint, not resize, hover, or teardown.
Within each session, forced GC occurs only at baseline and after the settled data update. No forced GC separates initialization and update.
Memory collection ends at live. Chart teardown runs after the timing phases.
Post-update GC precedes resize outside timing windows, but can affect later combined timings. All timing phases retain their full settling intervals and fences.
The headline shows blank-adjusted browser-tree PSS in decimal MB. Renderer measurements stay in JSON.
Incomplete blank reads retry before library load, with at most five settled post-GC attempts. The first complete read supplies the baseline.
JSON retains blank.attempts. If every attempt fails, adjusted memory stays unavailable and the warning includes the final failure reason.
Loaded and measured observations do not retry.
Capture already records a settled, post-GC /blank checkpoint in each fresh browser before library or fixture load.
The blank checkpoint uses the same viewport, DPR, and trace mode as the chart samples.
Adjusted retained = raw live - own browser blank. Adjusted peak = raw sampled peak - own browser blank.
There is no extra idle offset. The calculation does not subtract loaded-library checkpoints or warm session baselines.
Library and fixture overhead therefore remain included.
Memory columns show minimum adjusted retained memory and the minimum of the per-round sampled peaks.
Peaks are sampled. Process churn and shared mappings can still produce negative deltas. Negative estimates remain negative.
Combined trace and process polling affect both timing and memory, including trace-buffer allocations.
Use bench:memory for an untraced footprint. Native allocators need not release pages after GC.
GPU-specific memory is not measured. No heap snapshots, canvas readbacks, or screenshots are used.

Chrome Headless Shell ${chromeVersion} and pinned demo dependencies are downloaded once and cached.
CHROME_BIN overrides the browser. --install-only prepares the browser without a benchmark.
Automatic browser installation requires Linux x64 and unzip.
Results and compressed traces go to .cache/benchmarks. Each mode has its own default report files.
Use --vulkan to enable GPU and request Vulkan on any platform. Use --no-vulkan to disable automatic Vulkan selection.
These flags cannot be combined. Vulkan reports and traces use separate filenames and backend metadata.
Use --summarize-only with any command to summarize its saved suite report without starting Chrome.
Summary-only uses the default-suite backend: Vulkan on Linux, Chrome's default elsewhere.
Use --no-vulkan to select the saved default report, or --vulkan to select the saved Vulkan report.
Summary-only mode uses the saved DPR and rejects --dpr, --variant, --worker, and --install-only.
Saved summaries require the current lifecycle protocols and matching hover capability lists in every mode, including memory-only.
Memory reports require memoryProtocol: through-update-v1. The raw capture lifecycle remains unchanged.
Older saved memory reports already contain blank checkpoints. --summarize-only recalculates memory with the new formula, without an idle offset.
Saved summaries require explicit matching requestedBackend metadata and sampling, context, and lossy snapshots.


Direct runner: node scripts/benchmarks.mjs [--trace] [--memory] [--raf] [--gpu] [--vulkan | --no-vulkan] [--dpr NUMBER] [--verbose]
No measurement flags means trace + memory. rAF cannot be combined with tracing or memory.`);
	process.exit(0);
}
if (values.browser !== 'chrome')
	throw new Error('The benchmark requires --browser chrome.');
const dpr = Number(values.dpr);
if (!Number.isFinite(dpr) || dpr <= 0)
	throw new Error('--dpr must be a positive finite number.');
if (values.variant && !Object.hasOwn(demoDependencies, values.variant))
	throw new Error('Unsupported benchmark variant.');
if (values.worker && !values.variant)
	throw new Error('--worker requires --variant.');
const selectedMode = values.trace || values.memory || values.raf;
const measurements = {trace: values.trace || !selectedMode, memory: values.memory || !selectedMode, raf: values.raf};
const mode = benchmarkMode(measurements);
if (values['summarize-only']) {
	if (values.variant || values.worker || values['install-only'] || tokens.some(token => token.kind === 'option' && token.name === 'dpr'))
		throw new Error('--summarize-only cannot be combined with --dpr, --variant, --worker, or --install-only.');
	summarizeSavedBenchmarks({...measurements, vulkan, verbose: values.verbose, dashboard: values.dashboard});
	process.exit(0);
}
const lightningOptions = (!values.variant || values.variant === 'lightningchart') &&
	(process.env.LIGHTNINGCHART_LICENSE || values.variant === 'lightningchart') ? {
	license: process.env.LIGHTNINGCHART_LICENSE,

	licenseInformation: process.env.LIGHTNINGCHART_LICENSE_INFORMATION ? JSON.parse(process.env.LIGHTNINGCHART_LICENSE_INFORMATION) : undefined,
} : undefined;
const sciChartOptions = process.env.SCICHART_LICENSE ? {runtimeLicenseKey: process.env.SCICHART_LICENSE} : undefined;
if (values.variant)
	assertBenchmarkAvailable(values.variant, lightningOptions);
if (measurements.memory && platform() !== 'linux')
	throw new Error('Process memory measurement requires Linux /proc.');
if (!values.worker && !values['install-only']) {
	try {
		await runBenchmarkSuite({...measurements, dpr, gpu: values.gpu, vulkan, variant: values.variant ?? null, lightningOptions, verbose: values.verbose, dashboard: values.dashboard});
	}
	catch (error) {
		if (error.code !== 'BENCHMARK_SAMPLE_TIMEOUT')
			throw error;
		console.error(error.message);
		process.exitCode = SAMPLE_TIMEOUT_EXIT_CODE;
	}
	process.exit(process.exitCode ?? 0);
}
const binary = await chromeBinary({version: chromeVersion});
if (values['install-only'])
	process.exit(0);
mkdirSync(cache, {recursive: true});
const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(root, values.variant, {dashboard: values.dashboard});
const moduleDependencies = dependencies.filter(dependency => dependency.type === 'module');
if (moduleDependencies.length) {
	const bundle = await bundleModuleDependencies(demoDependencies[values.variant].filter(dependency => dependency.type === 'module'), {
		cacheDir: join(cache, 'modules'),
	});
	const route = '/bench/vendor/' + bundle.cacheName;
	files.set(route, bundle.code);
	for (const dependency of moduleDependencies) {
		dependency.route = route;
		dependency.sha256 = bundle.sha256;
	}
	// Preserve source provenance once, rather than repeating the graph per namespace.
	moduleDependencies[0].bundle = {cacheName: bundle.cacheName, sha256: bundle.sha256, sources: bundle.sources};
}
for (const dependency of dependencies) {
	if (dependency.type === 'module')
		continue;
	const path = join(cache, dependency.cacheName);
	if (!existsSync(path)) {
		console.log('Downloading ' + dependency.url);
		const response = await fetch(dependency.url, {signal: AbortSignal.timeout(30000)});
		if (!response.ok)
			throw new Error(`${dependency.name} download: HTTP ${response.status}`);
		writeFileSync(path, Buffer.from(await response.arrayBuffer()));
	}
	const source = readFileSync(path);
	files.set(dependency.route, source);
	dependency.sha256 = createHash('sha256').update(source).digest('hex');
}
files.set('/bench.mjs', readFileSync(new URL(values.dashboard ? 'bench/dashboard/browser.mjs' : 'scripts/benchmarks-trace-browser.mjs', root), 'utf8'));
if (!values.dashboard)
	files.set('/bench/data.json', readFileSync(new URL('bench/data.json', root), 'utf8'));
files.set('/bench/runtime-assets.json', JSON.stringify(dependencies.filter(dep => dep.type === 'wasm')
	.map(dep => ({...dep, url: dep.route}))));
files.set('/bench/module-assets.json', JSON.stringify(moduleDependencies
	.map(dependency => ({...dependency, url: dependency.route, export: dependency.global}))));
const page = '<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>' +
	dependencies.filter(dependency => dependency.type !== 'wasm' && dependency.type !== 'module').map(dependency => dependency.type === 'style'
		? `<link rel="stylesheet" href="${dependency.route}">`
		: `<script src="${dependency.route}"></script>` + (dependency.alias
			? `<script>globalThis[${JSON.stringify(dependency.alias)}] = globalThis[${JSON.stringify(dependency.global)}];</script>` : '')).join('') +
	localScripts.map(route => `<script src="${route}"></script>`).join('') +
	localStyles.map(route => `<link rel="stylesheet" href="${route}">`).join('') +
	'<script type="module" src="/bench.mjs"></script>';
const profile = mkdtempSync(join(tmpdir(), 'uplot-bench-chrome-'));
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
				res.setHeader('Content-Type', req.url.endsWith('.wasm') ? 'application/wasm' : req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.json') ? 'application/json' : 'text/javascript');
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
		...(values.gpu || vulkan ? ['--enable-gpu'] : []),
		...(vulkan ? ['--enable-features=Vulkan'] : []),
		'--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--window-size=1920,${values.dashboard ? 1080 : 900}`, 'about:blank',
	];
	// Keep Chrome in the worker's process group so the suite can clean up all descendants.
	browser = spawn(binary, browserArgs, {detached: false, stdio: ['ignore', 'pipe', 'pipe']});
	for (const stream of [browser.stdout, browser.stderr])
		stream.on('data', chunk => { browserLog = (browserLog + chunk).slice(-4000); });
	browser.once('error', rejectResult);
	browser.once('exit', code => rejectResult(new Error(`Chrome exited with code ${code}.\n${browserLog}`)));
	const report = await Promise.race([captureBenchmarkTrace({
		profile, url, cache, ...measurements, dpr, dashboard: values.dashboard, lightningOptions, sciChartOptions, processPid: measurements.memory ? browser.pid : null,
		traceName: traceReportName(mode, values.variant, {vulkan, dashboard: values.dashboard}),
		onSampleTimeout(error) {
			// Preserve the timeout instead of a subsequent Chrome-disconnected error.
			rejectResult(error);
			try { killBenchmarkBrowser(browser); }
			catch (cleanupError) { console.error(cleanupError); }
		},
	}), failure]);
	report.measurements = measurements;
	report.runner = {
		date: new Date().toISOString(), cpu: cpus()[0]?.model, os: `${platform()} ${release()}`,
		headless: true, engine: 'chrome', binary, browserVersion, browserArgs, node: process.version,
		dpr, dependencies, variant: values.variant,
		benchmark: benchmarkVariantMetadata(values.variant, {dashboard: values.dashboard}),
		requestedBackend: vulkan ? 'vulkan' : 'default',
		sourceSha256: Object.fromEntries([...files].filter(([path]) => !path.startsWith('/bench/vendor/'))
			.map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])),
		browserLog,
	};
	if (measurements.trace)
		report.analysis = await analyzeBenchmarkTraceFile(report.trace.path, report);
	if (measurements.raf)
		report.rafAnalysis = summarizeBenchmarkRaf(report);
	const output = join(cache, variantReportName(mode, values.variant, {vulkan, dashboard: values.dashboard}));
	writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
	console.log(`${values.variant}: ${report.samples.filter(sample => !sample.warmup).length} measured samples. ${browserVersion}`);
}
catch (error) {
	if (error.code !== 'BENCHMARK_SAMPLE_TIMEOUT')
		throw error;
	console.error(error.message);
	process.exitCode = SAMPLE_TIMEOUT_EXIT_CODE;
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
