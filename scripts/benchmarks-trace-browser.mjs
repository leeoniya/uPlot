// The parent sets browser deviceScaleFactor (default 1) before navigation.
// HTML loads the demo libraries, their dependencies, and styles before this module.
// CDP waits for benchmarkTraceReady and starts tracing before benchmarkLifecycle.begin().
// Shared samples: setup -> prepare -> construct -> destroy. Only the parent polls
// process memory and optionally forces GC at baseline, live, and cleanup checkpoints.
// runBenchmarkTrace({raf:true}) is a mutually exclusive, browser-driven path.
const selectedVariant = new URL(location.href).searchParams.get('variant');
const uPlot = !selectedVariant || selectedVariant === 'uplot' ? globalThis.uPlot : null;
if ((!selectedVariant || selectedVariant === 'uplot') && typeof uPlot !== 'function')
	throw new Error('Expected /dist/uPlot.iife.min.js to load before the benchmark fixture.');

const WIDTH = 1920;
const HEIGHT = 600;
const VIEWPORT_HEIGHT = 900;
const dpr = devicePixelRatio;
const ALL_VARIANTS = ['uplot', 'd3', 'chartjs', 'echarts', 'flot', 'dygraphs', 'idle'];
if (selectedVariant && !ALL_VARIANTS.includes(selectedVariant))
	throw new Error(`Unknown variant: ${selectedVariant}`);
const VARIANTS = selectedVariant ? [selectedVariant] : ALL_VARIANTS;
const WARMUPS = 3;
const ROUNDS = 7;
const IDLE_MS = 200;
// The rAF timestamp describes the frame, not when this callback actually ran.
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(performance.now())));
const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function settle() {
	await waitFrame();
	await waitFrame();
	await new Promise(resolve => setTimeout(resolve, IDLE_MS));
}

if (typeof Path2D !== 'function' ||
	VARIANTS.includes('d3') && !globalThis.d3?.line ||
	VARIANTS.includes('chartjs') && !globalThis.Chart?.version ||
	VARIANTS.includes('echarts') && !globalThis.echarts?.init ||
	VARIANTS.includes('flot') && !globalThis.jQuery?.plot ||
	VARIANTS.includes('dygraphs') && (!globalThis.Dygraph || typeof globalThis.fmtDate !== 'function'))
	throw new Error('Load the selected demo libraries and dependencies before this module.');
if (VARIANTS.includes('chartjs') && globalThis.Chart._adapters?._date?.prototype._id !== 'date-fns')
	throw new Error('Load the Chart.js date-fns adapter before this module.');

// The source-derived demo modules capture this node at import time. Do not replace it.
const fixture = document.createElement('div');
fixture.id = 'benchmark-fixture';
const wait = document.createElement('h2');
wait.id = 'wait';
wait.textContent = 'Rendering...';
fixture.append(wait);
document.body.replaceChildren(fixture);

const style = document.createElement('style');
style.textContent = `
	body { margin: 0; }
	#benchmark-fixture {
		position: absolute;
		left: 0;
		top: 0;
		width: ${WIDTH}px;
		pointer-events: none;
	}
	#benchmark-fixture.d3 { font: 12px Arial, sans-serif; }
	#benchmark-fixture .chart {
		position: relative;
		width: ${WIDTH}px;
		height: ${HEIGHT}px;
	}
	#benchmark-fixture .chart canvas {
		position: absolute;
		left: 0;
		top: 0;
		width: ${WIDTH}px;
		height: ${HEIGHT}px;
	}
	#benchmark-fixture .chart-container {
		position: relative;
		margin: auto;
		width: ${WIDTH}px;
		height: ${HEIGHT}px;
	}
	#benchmark-fixture #chart,
	#benchmark-fixture .demo-container,
	#benchmark-fixture #graphdiv { width: ${WIDTH}px; height: ${HEIGHT}px; }
	#benchmark-fixture .demo-placeholder { width: 100%; height: 100%; }
	#benchmark-fixture #graphdiv { margin-bottom: 20px; }
	#benchmark-fixture .legend { display: flex; gap: 24px; margin: 8px 55px; }
	#benchmark-fixture .legend span { display: inline-block; min-width: 150px; }
	.u-legend.u-inline .u-value { width: 150px; text-align: left; }
`;
document.head.append(style);

const cssReady = !VARIANTS.includes('uplot') ? Promise.resolve() : new Promise((resolve, reject) => {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = '/dist/uPlot.min.css';
	link.onload = resolve;
	link.onerror = () => reject(new Error('Failed to load /dist/uPlot.min.css'));
	document.head.append(link);
});

// These endpoints export actual demo functions, without their fetch/auto-start code.
const sourceFor = id => VARIANTS.includes(id) || id === 'd3' && VARIANTS.includes('uplot')
	? import(`/bench/${id}-source.mjs`) : null;
const [d3Source, chartjsSource, echartsSource, flotSource, dygraphsSource, response] = await Promise.all([
	sourceFor('d3'),
	sourceFor('chartjs'),
	sourceFor('echarts'),
	sourceFor('flot'),
	sourceFor('dygraphs'),
	fetch('/bench/data.json'),
	cssReady,
]);
if (!response.ok)
	throw new Error(`Data fetch: HTTP ${response.status}`);
const packed = await response.json();
const ROWS = 55550;
const FIELDS = 7;
if (!Array.isArray(packed) || packed[0] !== FIELDS || packed.length !== 1 + FIELDS + ROWS * FIELDS)
	throw new Error('Expected 55,550 packed rows with seven fields and a header.');
for (let i = 1; i <= FIELDS; i++) {
	if (typeof packed[i] !== 'string')
		throw new Error('Expected packed field names in the header.');
}
for (let i = FIELDS + 1; i < packed.length; i++) {
	if (!Number.isFinite(packed[i]))
		throw new Error(`Expected a finite packed value at index ${i}.`);
}
const sources = {d3: d3Source, chartjs: chartjsSource, echarts: echartsSource, flot: flotSource, dygraphs: dygraphsSource};
await document.fonts.ready;

function options() {
	// bench/uPlot.html, with milliseconds and explicit DPR for fresh D3-prepared data.
	const opts = {
		title: 'Server Events',
		width: WIDTH,
		height: HEIGHT,
		ms: 1,
		pxRatio: dpr,
		cache: {paths: false},
		series: [
			{},
			{
				label: 'CPU', scale: '%',
				value: (u, v) => v == null ? null : v.toFixed(1) + '%',
				stroke: 'red', width: 1 / dpr,
			},
			{
				label: 'RAM', scale: '%',
				value: (u, v) => v == null ? null : v.toFixed(1) + '%',
				stroke: 'blue', width: 1 / dpr,
			},
			{
				label: 'TCP Out', scale: 'mb',
				value: (u, v) => v == null ? null : v.toFixed(2) + ' MB',
				stroke: 'green', width: 1 / dpr,
			},
		],
		axes: [
			{},
			{
				scale: '%',
				values: (u, vals, space) => vals.map(v => +v.toFixed(1) + '%'),
			},
			{
				side: 1, scale: 'mb', size: 60,
				values: (u, vals, space) => vals.map(v => +v.toFixed(2) + ' MB'),
				grid: {show: false},
			},
		],
	};
	return opts;
}

function setup(variant) {
	fixture.className = variant;
	wait.textContent = 'Rendering...';
	const host = document.createElement('div');
	if (variant === 'd3') {
		host.innerHTML = `
			<h3>Server Events</h3>
			<div class="legend">
				<span id="cpu-value" style="color: red">CPU: --</span>
				<span id="ram-value" style="color: blue">RAM: --</span>
				<span id="tcp-value" style="color: green">TCP Out: --</span>
			</div>
			<div class="chart">
				<canvas id="plot"></canvas>
				<canvas id="overlay"></canvas>
			</div>
		`;
	}
	else if (variant === 'chartjs') {
		host.className = 'chart-container';
		host.innerHTML = '<canvas id="chart1"></canvas>';
	}
	else if (variant === 'echarts')
		host.id = 'chart';
	else if (variant === 'flot') {
		host.className = 'demo-container';
		host.innerHTML = '<div id="placeholder" class="demo-placeholder"></div>';
	}
	else if (variant === 'dygraphs')
		host.id = 'graphdiv';
	fixture.append(host);
	return host;
}

function checkPage() {
	if (innerWidth !== WIDTH || innerHeight !== VIEWPORT_HEIGHT)
		throw new Error(`Expected a 1920x900 CSS viewport, got ${innerWidth}x${innerHeight}`);
	if (!Number.isFinite(dpr) || dpr <= 0 || devicePixelRatio !== dpr)
		throw new Error(`Browser DPR must stay fixed after navigation; initial ${dpr}, current ${devicePixelRatio}`);
	if (document.visibilityState !== 'visible')
		throw new Error('The trace fixture must be in a visible page.');
}

function prepFor(variant) {
	// Demo prepData functions slice packed without mutating it. No clones are needed.
	return variant === 'idle' ? () => null : sources[variant === 'uplot' ? 'd3' : variant].prepData;
}

function validateInput({variant, input}) {
	if (variant === 'uplot' || variant === 'd3') {
		if (input.length !== 4 || !input.every(values => values.length === ROWS && values.every(Number.isFinite)))
			throw new Error('Expected 55,550 finite rows with millisecond x values and three y series.');
	}
	else if (variant === 'chartjs') {
		if (input.length !== 3 || !input.every(values => values.length === ROWS && values.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))))
			throw new Error('Expected three Chart.js series of 55,550 finite {x, y} points.');
	}
	else if (variant === 'echarts') {
		if (!(input instanceof Float64Array) || input.length !== ROWS * 4 || !input.every(Number.isFinite))
			throw new Error('Expected 55,550 finite ECharts rows in an interleaved Float64Array.');
	}
	else if (variant === 'flot') {
		if (input.length !== 3 || !input.every(values => values.length === ROWS && values.every(point => point.length === 2 && point.every(Number.isFinite))))
			throw new Error('Expected three Flot series of 55,550 finite [x, y] pairs.');
	}
	else if (variant === 'dygraphs') {
		if (input.length !== ROWS || !input.every(row => row.length === 4 && row[0] instanceof Date && Number.isFinite(+row[0]) && Number.isFinite(row[1]) && Number.isFinite(row[2]) && Number.isFinite(row[3])))
			throw new Error('Expected 55,550 Dygraphs rows with a Date and three finite values.');
	}
}

function construct(sample) {
	if (sample.variant === 'uplot') {
		console.time('chart');
		sample.chart = new uPlot(options(), sample.input, sample.host);
	}
	else if (sample.variant !== 'idle')
		sample.chart = sources[sample.variant].makeChart(sample.input);
}

async function finishMicrotask({variant}) {
	// uPlot queues its initial commit; D3 queues its original status update.
	await Promise.resolve();
	if (variant === 'uplot') {
		wait.textContent = 'Done!';
		console.timeEnd('chart');
	}
}

function validateChart({variant, chart, host}) {
	if (variant === 'uplot' && chart.series.some(series => series._paths != null || series.points?._paths != null))
		throw new Error('uPlot retained paths despite cache.paths:false. Rebuild dist before benchmarking.');
	if (variant === 'chartjs' && (!chart || globalThis.Chart.getChart(host.firstElementChild) !== chart))
		throw new Error('Chart.js makeChart must return its registered chart instance.');
	if (variant === 'echarts' && (!chart || globalThis.echarts.getInstanceByDom(host) !== chart))
		throw new Error('ECharts makeChart must return its registered chart instance.');
	if (variant === 'flot' && (!chart || globalThis.jQuery(host.firstElementChild).data('plot') !== chart))
		throw new Error('Flot makeChart must return its registered plot instance.');
	if (variant === 'dygraphs' && !(chart instanceof globalThis.Dygraph))
		throw new Error('Dygraphs makeChart must return its chart instance.');
	if (variant === 'flot' || variant === 'dygraphs') {
		const canvases = host.querySelectorAll('canvas');
		if (canvases.length !== 2)
			throw new Error(`${variant} must create its base and overlay canvases.`);
		for (const canvas of canvases) {
			// Inline CSS and backing dimensions do not force layout or read pixels.
			const width = parseFloat(canvas.style.width);
			const height = parseFloat(canvas.style.height);
			if (!(width > 0 && height > 0) || Math.abs(canvas.width - width * dpr) > 1 || Math.abs(canvas.height - height * dpr) > 1)
				throw new Error(`${variant} canvas backing size does not match DPR ${dpr}`);
		}
	}
	const effectiveDpr = variant === 'uplot' ? chart.pxRatio
		: variant === 'chartjs' ? chart.currentDevicePixelRatio
		: variant === 'echarts' ? chart.getDevicePixelRatio()
		: variant === 'flot' ? chart.getSurface().pixelRatio : dpr;
	if (effectiveDpr !== dpr)
		throw new Error(`${variant} rendered at DPR ${effectiveDpr}, expected ${dpr}`);
	if (variant === 'd3' && host.querySelector('#plot').width !== Math.round(WIDTH * dpr))
		throw new Error('D3 canvas backing width does not match the requested DPR.');
	return effectiveDpr;
}

function teardown({variant, chart, host}) {
	try {
		if (variant === 'echarts') {
			const instance = chart ?? globalThis.echarts.getInstanceByDom(host);
			instance?.dispose();
			if (globalThis.echarts.getInstanceByDom(host) || (instance && !instance.isDisposed()))
				throw new Error('ECharts instance survived disposal.');
		}
		else if (variant === 'chartjs') {
			const canvas = host.firstElementChild;
			(chart ?? globalThis.Chart.getChart(canvas))?.destroy();
			if (globalThis.Chart.getChart(canvas) || Object.keys(globalThis.Chart.instances).length !== 0)
				throw new Error('Chart.js instance survived destruction.');
		}
		else if (variant === 'flot') {
			const placeholder = host.firstElementChild;
			(chart ?? globalThis.jQuery(placeholder).data('plot'))?.destroy();
			if (globalThis.jQuery(placeholder).data('plot') || placeholder.childNodes.length !== 0)
				throw new Error('Flot instance survived destruction.');
		}
		else if (variant === 'dygraphs') {
			chart?.destroy();
			if (host.childNodes.length !== 0)
				throw new Error('Dygraphs DOM survived destruction.');
		}
		else if (variant === 'uplot') {
			chart?.destroy();
			if (chart?.root.isConnected)
				throw new Error('uPlot root survived destruction.');
		}
	}
	finally {
		// D3 listeners belong to its overlay, not window/document.
		host.replaceChildren();
		host.remove();
	}
}

function environment() {
	return {
		userAgent: navigator.userAgent,
		actualDPR: dpr,
		uplotVersion: uPlot?.version ?? null,
		d3Version: globalThis.d3?.version ?? null,
		chartjsVersion: globalThis.Chart?.version ?? null,
		echartsVersion: globalThis.echarts?.version ?? null,
		flotRuntimeVersion: globalThis.jQuery?.plot?.version ?? null,
		jqueryVersion: globalThis.jQuery?.fn?.jquery ?? null,
		dygraphsVersion: globalThis.Dygraph?.VERSION ?? null,
		dateAdapter: globalThis.Chart?._adapters?._date?.prototype._id ?? null,
		dateAdapterVersion: globalThis.Chart?._adapters?._date?.version ?? null,
	};
}

let invoked = null;
let sampleIndex = 0;
// Fixture-owned state survives separate CDP calls without returning remote handles.
let state = null;
let lifecycleBusy = false;

function requireSample(phase) {
	if (invoked !== 'samples' || lifecycleBusy || !state || state.phase !== phase)
		throw new Error(`Sample lifecycle requires an inactive ${phase} sample.`);
}

globalThis.benchmarkLifecycle = {
	begin() {
		if (invoked)
			throw new Error('Benchmark protocols are exclusive. Reload the page for another capture.');
		checkPage();
		invoked = 'samples';
		const captureId = crypto.randomUUID();
		performance.mark('benchmark:capture:' + captureId);
		// Suppress original demo timers, including delayed Flot hooks, for this page.
		console.time = console.timeEnd = () => {};
		return {
			...reportMetadata(), captureId, env: environment(),
			config: {variants: [...VARIANTS], dpr, warmups: WARMUPS, rounds: ROUNDS},
		};
	},
	async setup(variant, id) {
		if (invoked !== 'samples' || state || lifecycleBusy)
			throw new Error('Sample setup requires begin() and no active sample.');
		if (!VARIANTS.includes(variant))
			throw new Error(`Unknown variant: ${variant}`);
		if (id !== `sample-${sampleIndex}`)
			throw new Error(`Expected sample-${sampleIndex}, got ${id}`);
		checkPage();
		sampleIndex++;
		state = {id, variant, host: setup(variant), input: null, chart: null, phase: 'setup'};
		lifecycleBusy = true;
		try {
			await settle();
			checkPage();
		}
		finally {
			lifecycleBusy = false;
		}
	},
	async prepare() {
		requireSample('setup');
		lifecycleBusy = true;
		state.phase = 'preparing';
		try {
			const prepData = prepFor(state.variant);
			const start = performance.now();
			state.input = prepData(packed);
			state.dataPrepMs = performance.now() - start;
			validateInput(state);
			await settle();
			checkPage();
			state.phase = 'prepared';
		}
		finally {
			lifecycleBusy = false;
		}
	},
	async construct() {
		requireSample('prepared');
		lifecycleBusy = true;
		state.phase = 'constructing';
		try {
			checkPage();
			const prefix = `benchmark:${state.id}:`;
			const start = performance.mark(prefix + 'start');
			construct(state);
			await finishMicrotask(state);
			const jsEnd = performance.mark(prefix + 'js-end');
			await settle();
			const end = performance.mark(prefix + 'end');
			checkPage();
			const effectiveDpr = validateChart(state);
			state.phase = 'constructed';
			const jsMs = jsEnd.startTime - start.startTime;
			return {
				id: state.id, dpr, effectiveDpr, variant: state.variant,
				dataPrepMs: state.dataPrepMs, jsMs,
				prepAndInitMs: state.dataPrepMs + jsMs,
				windowMs: end.startTime - start.startTime,
			};
		}
		finally {
			lifecycleBusy = false;
		}
	},
	async destroy() {
		if (invoked !== 'samples' || lifecycleBusy)
			throw new Error('Sample destroy requires an inactive sample lifecycle.');
		lifecycleBusy = true;
		try {
			if (state)
				teardown(state);
		}
		finally {
			// No local alias can keep the input, chart or host alive during cleanup GC.
			state = null;
			try {
				await settle();
			}
			finally {
				lifecycleBusy = false;
			}
		}
	},
};

globalThis.runBenchmarkTrace = async function runBenchmarkTrace({raf = false} = {}) {
	if (invoked)
		throw new Error('Benchmark protocols are exclusive. Reload the page for another capture.');
	invoked = 'timing';
	checkPage();
	const captureId = crypto.randomUUID();
	performance.mark('benchmark:capture:' + captureId);
	const samples = [];
	const frameIntervalsMs = [];
	if (raf) {
		let previous = await nextFrame();
		for (let i = 0; i < 16; i++) {
			const now = await nextFrame();
			frameIntervalsMs.push(now - previous);
			previous = now;
		}
	}
	const env = environment();

	for (let round = -WARMUPS; round < ROUNDS; round++) {
		const turn = round + WARMUPS;
		const offset = turn % VARIANTS.length;
		const ordered = [...VARIANTS.slice(offset), ...VARIANTS.slice(0, offset)];
		if (turn % 2)
			ordered.reverse();
		for (const variant of ordered) {
			checkPage();
			let sample = {variant, host: setup(variant), input: null, chart: null};
			try {
				const prepData = prepFor(variant);
				const prepStart = performance.now();
				sample.input = prepData(packed);
				const dataPrepMs = performance.now() - prepStart;
				validateInput(sample);
				// Setup, prep and previous teardown settle before the chart markers.
				await settle();
				checkPage();
				const id = `sample-${sampleIndex++}`;
				const prefix = `benchmark:${id}:`;
				if (raf)
					await nextFrame();
				const start = performance.mark(prefix + 'start');
				construct(sample);
				await finishMicrotask(sample);
				const jsEnd = performance.mark(prefix + 'js-end');
				const rafTimes = {};
				if (raf) {
					const first = await nextFrame();
					Object.assign(rafTimes, {
						raf1Ms: first - start.startTime,
						postJsRaf1Ms: first - jsEnd.startTime,
					});
					// Drain only: this extra frame is not a latency measurement.
					await nextFrame();
					await new Promise(resolve => setTimeout(resolve, IDLE_MS));
				}
				else
					await settle();
				const end = performance.mark(prefix + 'end');
				const effectiveDpr = validateChart(sample);
				const jsMs = jsEnd.startTime - start.startTime;
				samples.push({
					id, dpr, effectiveDpr, variant, round, warmup: round < 0,
					dataPrepMs,
					prepAndInitMs: dataPrepMs + jsMs,
					jsMs,
					windowMs: end.startTime - start.startTime,
					...rafTimes,
				});
			}
			finally {
				try {
					teardown(sample);
				}
				finally {
					sample = null;
				}
			}
		}
	}

	return {
		...reportMetadata(raf), captureId, env, samples,
		raf: {enabled: raf, startAligned: raf, frameIntervalsMs, clock: 'performance.now() at callback entry'},
	};
};

function reportMetadata(raf = false) {
	return {
		phase: 'initial-chart-creation',
		dpr,
		dprs: [dpr],
		variants: VARIANTS,
		warmups: WARMUPS,
		rounds: ROUNDS,
		viewport: [WIDTH, VIEWPORT_HEIGHT],
		chartCssSize: [WIDTH, HEIGHT],
		markerPattern: 'benchmark:<id>:start|js-end|end',
		roundConvention: 'Warmups -3..-1; measured rounds 0..6. IDs include warmups in chronological order.',
		order: 'Rotate variants by round and reverse on alternate rounds; one actual browser DPR per capture.',
		source: {
			uplot: '/dist/uPlot.iife.min.js',
						uplotCss: '/dist/uPlot.min.css',
			uplotOptions: 'bench/uPlot.html; ms:1, explicit pxRatio, series width:1/dpr, cache.paths:false; data caching, points, legend, cursor and scale defaults retained.',
			d3: '/bench/d3-source.mjs',
			chartjs: '/bench/chartjs-source.mjs',
			echarts: '/bench/echarts-source.mjs',
			flot: '/bench/flot-source.mjs',
			dygraphs: '/bench/dygraphs-source.mjs',
			demoContract: 'Actual selected bench/*.html functions before auto-start, exporting prepData/makeChart. Chart libraries return their real instances for teardown; D3 returns none.',
			data: '/bench/data.json',
			prepData: 'Each sample calls its nonmutating demo prepData(packed) afresh. Only raw packed JSON persists. uPlot uses D3 prep with ms:1. No clones.',
			dataRepresentations: {uplot: 'aligned arrays', d3: 'aligned arrays', chartjs: 'three arrays of {x, y} points', echarts: 'interleaved Float64Array', flot: 'three arrays of [x, y] pairs', dygraphs: 'rows of [Date, y, y, y]'},
			echartsTimestamps: 'Preserve demo behavior: start at the first packed timestamp, increment by one minute before each emitted row, rather than use each packed row timestamp.',
			rows: ROWS,
			ySeries: 3,
			yValues: ROWS * 3,
			xUnit: 'milliseconds since Unix epoch',
			strokeWidthDevicePixels: {uplot: 1, d3: 1},
			strokeWidthCssPixels: {chartjs: 1, echarts: 1},
		},
		expectedInstances: {
			samples: VARIANTS.length * (WARMUPS + ROUNDS), warmupSamples: VARIANTS.length * WARMUPS, measuredSamples: VARIANTS.length * ROUNDS,
			chartCreations: VARIANTS.filter(variant => variant !== 'idle').length * (WARMUPS + ROUNDS),
			measuredChartCreations: VARIANTS.filter(variant => variant !== 'idle').length * ROUNDS,
			...Object.fromEntries(ALL_VARIANTS.filter(variant => variant !== 'idle').flatMap(variant => [
				[variant, VARIANTS.includes(variant) ? WARMUPS + ROUNDS : 0],
				['measured' + variant[0].toUpperCase() + variant.slice(1), VARIANTS.includes(variant) ? ROUNDS : 0],
			])),
			perDprVariant: {warmup: 3, measured: 7},
			perChartCanvases: {uplot: 1, d3: 2, chartjs: 1, echarts: 'renderer-managed layers', flot: 2, dygraphs: 2, idle: 0},
		},
		timing: {
			unit: 'milliseconds',
			dataPrepMs: 'performance.now() immediately around actual prepData(packed), after host setup and before validation and pre-sample settling. Idle measures a no-op.',
			prepAndInitMs: 'dataPrepMs + jsMs per sample. This sum excludes validation, the settling gap and rAF waits. It is not end-to-end latency.',
			jsMs: 'Start through options construction, constructor/makeChart and initial microtask commit/status update. Elapsed time, not exclusive JS CPU time.',
			aggregation: 'Use medians of seven measured rounds per variant and DPR. Exclude three warmups. Take prepAndInitMs medians from per-sample sums.',
			windowMs: 'Start through js-end, two requestAnimationFrame callbacks, and a 200ms timeout.',
			raf1Ms: 'Start to performance.now() at the first post-JS rAF callback entry; rAF mode only.',
			postJsRaf1Ms: 'js-end to that same first callback entry; rAF mode only.',
			settling: {animationFrames: 2, idleMs: IDLE_MS, beforeStart: true, afterJsEnd: true},
			drain: 'In rAF mode the extra post-JS frame is unmeasured draining before the 200ms wait. It is included only in the trace window, not the rAF latency fields.',
		},

		limitations: [
			'Initial creation only: each non-idle sample prepares fresh input and creates a fresh chart. No redraw or cached-path reuse is measured.',
			'Data preparation is timed separately, outside chart markers. CDP chart-window totals exclude prep. Output validation is outside both prep and chart timers.',
			'Library loading, fixture setup and teardown are outside sample markers. All chart options construction, including uPlot options, is inside chart markers.',
			'D3 static title, legend and canvases, the Chart.js canvas/container, and ECharts, Flot and Dygraphs hosts exist at start; library-created DOM is inside the window.',
			'Runtime versions come from loaded library exports, not demo titles. A null version means the runtime does not expose it (such as the date-fns adapter).',
			'Flot 4.2.6 exposes a stale runtime version of 3.0.0. Use runner.dependencies for the pinned package version.',
			'Flot retains its timer-delayed overlay hook. JS/DOM and next-rAF spans do not necessarily include that hook; the longer trace window can include it.',
			'Warmups can appear in the trace. Exclude samples with warmup:true from measured aggregates.',
			'Native canvas is unwrapped. No readback, screenshots, pixel export, command instrumentation, or harness-forced layout reads are used. Original chart layout work remains included.',
			'Two animation frames plus 200ms idle are a settling heuristic, not a GPU fence. Work can cross marker boundaries; windowMs minus jsMs is not GPU execution time.',
			'Use Chrome trace process/thread events to distinguish renderer JS/DOM, raster, compositor and GPU-process thread work. GPU-process thread duration is not CPU time or hardware GPU execution time, and asynchronous attribution is approximate.',
			'Idle has the same marker/wait schedule but no chart mutation between markers. Report it separately; do not assume subtraction isolates chart GPU cost.',
			'One actual browser DPR is captured from devicePixelRatio and reported on every sample. The parent configures deviceScaleFactor before navigation (default 1); this fixture does not emulate DPR changes. The CSS viewport is 1920x900.',
			'Demo renderings and configurations differ: axes, domains, colors, line widths, sampling, layout and defaults are preserved. This is not pixel-identical rendering or an isolated decimation algorithm comparison.',
			'ECharts prepData synthesizes incrementing minute timestamps rather than reading each row timestamp. Its original behavior is preserved, so x values can differ from the other demos.',
			'Pointer events are disabled on the visible fixture to prevent hover drawing; the chart interaction options and D3 listener installation remain unchanged.',
			'The parent can collect process memory in the shared sample lifecycle, with GC only at baseline, live, and cleanup checkpoints. The separate rAF path uses no forced GC.',
			'JIT, automatic GC, scheduling, tracing overhead and machine load can affect prep, creation and downstream work.',
			...(raf ? [
				'rAF mode starts construction inside an animation frame. This differs from the default timer-aligned trace protocol.',
				'Only first-callback latency is measured. The additional drain frame and final 200ms settling wait are excluded from rAF spans. Refresh cadence, main-thread work and scheduling affect these spans.',
				'An rAF callback does not prove GPU completion or presentation. Frame latency and post-JS rAF delay are not GPU time. Idle remains separate.',
			] : []),
		],
	};
}

globalThis.benchmarkTraceReady = true;
