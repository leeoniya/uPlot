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
const {demoDependencies, benchmarkVariants, assertBenchmarkAvailable} = await import('/bench/demo-dependencies.mjs');
const ALL_VARIANTS = [...benchmarkVariants, ...Object.keys(demoDependencies).filter(id => !benchmarkVariants.includes(id))];
if (selectedVariant && !ALL_VARIANTS.includes(selectedVariant))
	throw new Error(`Unknown variant: ${selectedVariant}`);
const VARIANTS = selectedVariant ? [selectedVariant] : [...benchmarkVariants, 'idle'];
for (const variant of VARIANTS)
	assertBenchmarkAvailable(variant, globalThis.benchmarkLightningChartOptions);
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
	VARIANTS.some(id => id === 'd3' || id === 'd3-svg') && !globalThis.d3?.line ||
	VARIANTS.includes('chartjs') && !globalThis.Chart?.version ||
	VARIANTS.includes('echarts') && !globalThis.echarts?.init ||
	VARIANTS.includes('flot') && !globalThis.jQuery?.plot ||
	VARIANTS.includes('dygraphs') && (!globalThis.Dygraph || typeof globalThis.fmtDate !== 'function') ||
	VARIANTS.includes('apexcharts') && !globalThis.ApexCharts ||
	VARIANTS.some(id => id === 'highcharts' || id === 'highcharts-svg') && !globalThis.Highcharts?.chart ||
	VARIANTS.includes('lightweight') && !globalThis.LightweightCharts?.createChart ||
	VARIANTS.some(id => id === 'plotly' || id === 'plotly-svg') && !globalThis.Plotly?.newPlot ||
	VARIANTS.includes('canvasjs') && !globalThis.CanvasJS?.Chart ||
	VARIANTS.includes('zingchart') && !globalThis.zingchart?.render ||
	VARIANTS.includes('amcharts') && (!globalThis.am5?.Root || !globalThis.am5xy?.XYChart) ||
	VARIANTS.includes('lightningchart') && !globalThis.lcjs?.lightningChart ||
	VARIANTS.some(id => id === 'bokeh' || id === 'bokeh-canvas') && !globalThis.Bokeh?.Plotting ||
	VARIANTS.includes('d3fc') && !globalThis.fc?.seriesWebglLine ||
		VARIANTS.includes('d3fc-canvas') && !globalThis.fc?.seriesCanvasLine ||
		VARIANTS.some(id => id === 'g2' || id === 'g2-webgl') && !globalThis.G2?.Chart ||
		VARIANTS.includes('g2-webgl') && !globalThis.G?.WebGL?.Renderer ||
	VARIANTS.includes('agcharts') && !globalThis.agCharts?.AgCharts ||
	VARIANTS.includes('vega') && !globalThis.vega?.View ||
	VARIANTS.includes('scichart') && !globalThis.SciChart?.SciChartSurface)
	throw new Error('Load the selected demo libraries and dependencies before this module.');
if (VARIANTS.includes('chartjs') && globalThis.Chart._adapters?._date?.prototype._id !== 'date-fns')
	throw new Error('Load the Chart.js date-fns adapter before this module.');

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
`;
document.head.append(style);

const {setupDemo} = await import('/bench/demo-fixture.mjs');
const {prepareDemoRuntime} = await import('/bench/demo-runtime.mjs');
if (VARIANTS.includes('scichart')) {
	const assets = await fetch('/bench/runtime-assets.json');
	if (!assets.ok)
		throw new Error(`Runtime assets: HTTP ${assets.status}`);
	await prepareDemoRuntime('scichart', await assets.json());
}
if (VARIANTS.some(id => demoDependencies[id].some(dependency => dependency.type === 'module'))) {
	const assets = await fetch('/bench/module-assets.json');
	if (!assets.ok)
		throw new Error(`Module assets: HTTP ${assets.status}`);
	await prepareDemoRuntime(selectedVariant, await assets.json());
}
if (VARIANTS.includes('chartgpu') && typeof globalThis.benchmarkChartGPU?.ChartGPU?.create !== 'function')
	throw new Error('ChartGPU runtime must expose benchmarkChartGPU.ChartGPU.create.');
const sources = Object.fromEntries(await Promise.all(VARIANTS.filter(id => id !== 'idle')
	.map(async id => {
		const source = await import(`/bench/${id}.mjs`);
		await source.prepareRuntime?.();
		return [id, source];
	})));
const response = await fetch('/bench/data.json');
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
await document.fonts.ready;

function setup(variant) {
	wait.textContent = 'Rendering...';
	return setupDemo(variant, fixture);
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
	// Demo prepData functions do not mutate packed. No clones are needed.
	return variant === 'idle' ? () => null : sources[variant].prepData;
}

function validateInput({variant, input}) {
	if (variant === 'uplot' || variant === 'd3' || variant === 'd3-svg' || variant === 'plotly' || variant === 'plotly-svg') {
		if (input.length !== 4 || !input.every(values => values.length === ROWS && values.every(Number.isFinite)))
			throw new Error('Expected 55,550 finite rows with x values and three y series.');
	}
	else if (variant === 'chartjs' || variant === 'canvasjs') {
		if (input.length !== 3 || !input.every(values => values.length === ROWS && values.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))))
			throw new Error('Expected three Chart.js series of 55,550 finite {x, y} points.');
	}
	else if (variant === 'chartgpu') {
		if (!['x', 'cpu', 'ram', 'tcp'].every(key => input?.[key] instanceof Float64Array &&
			input[key].length === ROWS && input[key].every(Number.isFinite)))
			throw new Error('Expected four ChartGPU Float64Array columns of 55,550 finite values.');
	}
	else if (variant === 'echarts') {
		if (!(input instanceof Float64Array) || input.length !== ROWS * 4 || !input.every(Number.isFinite))
			throw new Error('Expected 55,550 finite ECharts rows in an interleaved Float64Array.');
	}
	else if (['flot', 'apexcharts', 'zingchart', 'jscharting'].includes(variant)) {
		if (input.length !== 3 || !input.every(values => values.length === ROWS && values.every(point => point.length === 2 && point.every(Number.isFinite))))
			throw new Error('Expected three Flot series of 55,550 finite [x, y] pairs.');
	}
	else if (variant === 'lightweight') {
		if (input.length !== 3 || !input.every(series => series.length === ROWS && series.every(point => Number.isFinite(point.time) && Number.isFinite(point.value))))
			throw new Error('Expected three Lightweight Charts series of 55,550 finite {time, value} points.');
	}
	else if (variant === 'highcharts' || variant === 'highcharts-svg') {
		if (input.length !== 3 || !input.every(table => ['x', 'y'].every(key => table.columns[key].length === ROWS && table.columns[key].every(Number.isFinite))))
			throw new Error('Expected three Highcharts data tables of 55,550 finite x and y values.');
	}
	else if (variant === 'amcharts') {
		if (input.length !== ROWS || !input.every(row => ['date', 'cpu', 'ram', 'tcp'].every(key => Number.isFinite(row[key]))))
			throw new Error('Expected 55,550 finite amCharts records.');
	}
	else if (['lightningchart', 'scichart', 'bokeh', 'bokeh-canvas', 'd3fc', 'd3fc-canvas'].includes(variant)) {
		if (!['x', 'cpu', 'ram', 'tcp'].every(key => input[key].length === ROWS && input[key].every(Number.isFinite)))
			throw new Error(`Expected four ${variant} columns of 55,550 finite values.`);
	}
	else if (['agcharts', 'vega', 'g2', 'g2-webgl', 'recharts', 'muicharts', 'financialcharts', 'visx'].includes(variant)) {
		if (input.length !== ROWS || !input.every(row => ['time', 'cpu', 'ram', 'tcp'].every(key => Number.isFinite(row[key]))))
			throw new Error(`Expected 55,550 finite ${variant} records.`);
	}
	else if (variant === 'billboard') {
		if (input.length !== 4 || !input.every((column, index) => column.length === ROWS + 1 &&
			column[0] === ['time', 'cpu', 'ram', 'tcp'][index] && column.slice(1).every(Number.isFinite)))
			throw new Error('Expected four named Billboard columns with 55,550 finite values.');
	}
	else if (variant === 'syncfusion' || variant === 'devextreme') {
		if (input.length !== ROWS || !input.every(row => row.time instanceof Date && Number.isFinite(+row.time) &&
			['cpu', 'ram', 'tcp'].every(key => Number.isFinite(row[key]))))
			throw new Error(`Expected 55,550 ${variant} records with Date timestamps and three finite values.`);
	}
	else if (variant === 'kendo') {
		if (input.length !== 3 || !input.every(series => series.length === ROWS && series.every(point =>
			point.length === 2 && point[0] instanceof Date && Number.isFinite(+point[0]) && Number.isFinite(point[1]))))
			throw new Error('Expected three Kendo series of 55,550 [Date, value] pairs.');
	}
	else if (variant === 'googlecharts') {
		if (input.length !== ROWS || !input.every(row => row.length === 4 && row[0] instanceof Date &&
			Number.isFinite(+row[0]) && row.slice(1).every(Number.isFinite)))
			throw new Error('Expected 55,550 Google Charts rows with Date timestamps and three finite values.');
	}
	else if (['dygraphs', 'anychart', 'fusiontime'].includes(variant)) {
		if (input.length !== ROWS || !input.every(row => row.length === 4 && Number.isFinite(row[0]) && Number.isFinite(row[1]) && Number.isFinite(row[2]) && Number.isFinite(row[3])))
			throw new Error(`Expected 55,550 ${variant} rows with numeric milliseconds and three finite values.`);
	}
	else if (variant !== 'idle')
		throw new Error(`No prepared-input validation for ${variant}.`);
}

function construct(sample) {
	if (sample.variant !== 'idle')
		sample.chart = sources[sample.variant].makeChart(sample.input, sample.host, wait);
}

async function finishMicrotask(sample) {
	// Async adapters resolve at their library's initial-render completion event.
	// Their elapsed init time includes those yields, not just synchronous JS work.
	if (typeof sample.chart?.then === 'function') {
		try { sample.chart = await sample.chart; }
		catch (error) {
			sample.chart = null; // The adapter cleans up a failed async construction.
			throw error;
		}
	}
	// uPlot queues its initial commit; its demo and D3 also queue status updates.
	await Promise.resolve();
}

function hasChartSurface(root) {
	return !!root.querySelector('canvas, svg') || [...root.querySelectorAll('*')]
		.some(element => element.shadowRoot && hasChartSurface(element.shadowRoot));
}

function validateChart({variant, chart, host, input}) {
	if (sources[variant]?.destroyChart && (!chart || !hasChartSurface(host)))
		throw new Error(`${variant} did not return a rendered chart.`);
	if (variant === 'chartgpu') {
		if (chart.error || chart.destroyed !== false || !chart.device || !chart.element || !chart.instance ||
			chart.instance.disposed !== false || typeof chart.instance.renderFrame !== 'function' ||
			typeof chart.instance.dispose !== 'function' || typeof chart.instance.getHitTestSeriesPointCount !== 'function')
			throw new Error(`ChartGPU chart is not healthy: ${chart.error?.message ?? chart.error ?? 'missing or disposed instance'}`);
		const series = chart.instance.options?.series;
		if (series?.length !== 3 || !['cpu', 'ram', 'tcp'].every((key, index) =>
			series[index]?.data?.x === input?.x && series[index]?.data?.y === input?.[key] &&
			series[index]?.data?.x?.length === ROWS && series[index]?.data?.y?.length === ROWS &&
			chart.instance.getHitTestSeriesPointCount(index) === ROWS))
			throw new Error('ChartGPU must retain three full series of 55,550 values from the prepared columns.');
		const canvases = host.querySelectorAll('canvas');
		// The shared adapter reserves 24 CSS pixels for the title; no layout or pixel reads.
		if (!canvases.length || [...canvases].some(canvas =>
			!(Math.abs(canvas.width - WIDTH * dpr) <= 1 && Math.abs(canvas.height - (HEIGHT - 24) * dpr) <= 1)))
			throw new Error(`ChartGPU canvas backing size does not match DPR ${dpr}`);
	}
	if (variant === 'apexcharts') {
		const series = chart.getState().series;
		if (series.length !== 3 || series.some(values => values.length !== ROWS))
			throw new Error('ApexCharts must retain all 55,550 rendered values per series with its reducer disabled.');
	}
	if (variant === 'd3-svg' && (host.querySelector('canvas') || host.querySelectorAll('svg .series path').length !== 3))
		throw new Error('d3-svg must render three SVG line paths without Canvas.');
	if (variant === 'plotly-svg' && (chart.data?.length !== 3 || chart.data.some(trace => trace.type !== 'scatter')))
		throw new Error('plotly-svg must render three SVG scatter traces.');
	if (variant === 'highcharts-svg' && (chart.options?.boost?.enabled !== false || chart.series?.length !== 3 || chart.series.some(series => series.boosted)))
		throw new Error('highcharts-svg must render three non-boosted series.');
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
		if (sources[variant]?.destroyChart) {
			if (chart) {
				const failed = variant === 'chartgpu' && (chart.error || chart.destroyed !== false || !chart.device ||
									!chart.element || !chart.instance || chart.instance.disposed !== false);
				sources[variant].destroyChart(chart);
				if (variant === 'chartgpu') {
					if (!chart.destroyed || chart.instance || chart.device || chart.element || chart.onError ||
						typeof chart.getWebGPUDevices !== 'function' || chart.getWebGPUDevices().length !== 0)
						throw new Error('ChartGPU resources or exposed devices survived destruction.');
					if (failed || chart.error)
						throw new Error(`ChartGPU failed before teardown: ${chart.error?.message ?? chart.error ?? 'destroyed or disposed chart'}`);
				}
			}
		}
		else if (variant === 'echarts') {
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
		else if (variant === 'd3')
			chart?.destroy();
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
		chartgpuVersion: globalThis.benchmarkChartGPU?.version ?? null,
		echartsVersion: globalThis.echarts?.version ?? null,
		flotRuntimeVersion: globalThis.jQuery?.plot?.version ?? null,
		jqueryVersion: globalThis.jQuery?.fn?.jquery ?? null,
		dygraphsVersion: globalThis.Dygraph?.VERSION ?? null,
		dateAdapter: globalThis.Chart?._adapters?._date?.prototype._id ?? null,
		dateAdapterVersion: globalThis.Chart?._adapters?._date?.version ?? null,
		highchartsVersion: globalThis.Highcharts?.version ?? null,
		lightweightVersion: globalThis.LightweightCharts?.version?.() ?? null,
		plotlyVersion: globalThis.Plotly?.version ?? null,
		canvasjsVersion: globalThis.CanvasJS?.version ?? null,
		zingchartVersion: globalThis.zingchart?.version ?? null,
		amchartsVersion: globalThis.am5?.registry?.version ?? null,
		bokehVersion: globalThis.Bokeh?.version ?? null,
		vegaVersion: globalThis.vega?.version ?? null,
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
		globalThis.benchmarkWebGL?.begin();
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
			for (const gl of state.chart?.getWebGLContexts?.() ?? [])
				globalThis.benchmarkWebGL?.track(gl);
			await settle();
			const webgl = await globalThis.benchmarkWebGL?.complete({webgl1Finish: true});
			const webgpu = state.variant === 'chartgpu'
				? await globalThis.benchmarkWebGPU?.complete(state.chart?.getWebGPUDevices?.() ?? []) : undefined;
			const end = performance.mark(prefix + 'end');
			checkPage();
			const effectiveDpr = validateChart(state);
			if (webgl?.status === 'incomplete' ||
				['highcharts', 'plotly', 'bokeh', 'd3fc', 'g2-webgl', 'scichart', 'lightningchart'].includes(state.variant) && webgl?.status !== 'complete')
				throw new Error(`${state.variant}: WebGL completion not verified: ${JSON.stringify(webgl)}`);
			if (state.variant === 'chartgpu' && (webgpu?.status !== 'complete' || !webgpu.devices?.length ||
				webgpu.devices.some(device => device.status !== 'complete')))
				throw new Error(`chartgpu: WebGPU completion not verified: ${JSON.stringify(webgpu)}`);
			state.phase = 'constructed';
			const jsMs = jsEnd.startTime - start.startTime;
			return {
				id: state.id, dpr, effectiveDpr, variant: state.variant,
				dataPrepMs: state.dataPrepMs, jsMs, ...(webgl ? {webgl} : {}), ...(webgpu ? {webgpu} : {}),
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
			globalThis.benchmarkWebGL?.reset();
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
			globalThis.benchmarkSampleBoundary?.(JSON.stringify({phase: 'start', variant}));
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
					globalThis.benchmarkSampleBoundary?.(JSON.stringify({phase: 'end', variant}));
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
			uplotDemo: '/bench/uplot.mjs',
			demos: Object.fromEntries(ALL_VARIANTS.filter(id => id !== 'idle').map(id => [id, `/bench/${id}.mjs`])),
			d3: '/bench/d3.mjs',
			chartjs: '/bench/chartjs.mjs',
			echarts: '/bench/echarts.mjs',
			flot: '/bench/flot.mjs',
			dygraphs: '/bench/dygraphs.mjs',
			demoContract: 'Shared bench/*.mjs modules used by HTML and benchmark without source extraction. makeChart(data, host, wait) returns a chart or a promise of one; D3 returns none. Async adapters resolve on library completion. New adapters export destroyChart(chart).',
			data: '/bench/data.json',
			prepData: 'Each sample calls its own shared nonmutating demo prepData(packed) afresh. Only raw packed JSON persists. No clones.',
			dataRepresentations: {
				uplot: 'aligned arrays', d3: 'aligned arrays', 'd3-svg': 'aligned arrays', chartjs: 'three arrays of {x, y} points',
				echarts: 'interleaved Float64Array', flot: 'three arrays of [x, y] pairs', dygraphs: 'rows of [milliseconds, y, y, y]',
				apexcharts: 'three arrays of [x, y] pairs', highcharts: 'three data tables with Float64Array x/y columns',
				lightweight: 'three arrays of {time, value} points', plotly: 'four aligned Float64Array columns',
				'plotly-svg': 'four aligned Float64Array columns',
				'highcharts-svg': 'three data tables with Float64Array x/y columns',
				canvasjs: 'three arrays of {x, y} points', zingchart: 'three arrays of [x, y] pairs',
				amcharts: 'rows of {date, cpu, ram, tcp}', lightningchart: '{x, cpu, ram, tcp} Float64Array columns',
				bokeh: '{x, cpu, ram, tcp} Float64Array columns', d3fc: '{x, cpu, ram, tcp} Float64Array columns',
				'bokeh-canvas': '{x, cpu, ram, tcp} Float64Array columns', 'd3fc-canvas': '{x, cpu, ram, tcp} Float64Array columns',
				'g2-webgl': 'rows of {time, cpu, ram, tcp}',
				scichart: '{x, cpu, ram, tcp} Float64Array columns; native ingestion inside init',
				chartgpu: '{x, cpu, ram, tcp} Float64Array columns; three full series, sampling disabled',
				agcharts: 'rows of {time, cpu, ram, tcp}', vega: 'rows of {time, cpu, ram, tcp}; tuple copy inside init',
				billboard: 'four named columns, each with 55,550 numeric values', g2: 'rows of {time, cpu, ram, tcp}',
				syncfusion: 'rows of {time: Date, cpu, ram, tcp}', devextreme: 'rows of {time: Date, cpu, ram, tcp}',
				jscharting: 'three arrays of [milliseconds, value] pairs', kendo: 'three arrays of [Date, value] pairs',
				anychart: 'rows of [milliseconds, cpu, ram, tcp]', fusiontime: 'rows of [milliseconds, cpu, ram, tcp]; ingestion copy inside init',
				googlecharts: 'rows of [Date, cpu, ram, tcp]; DataTable construction inside init',
				recharts: 'rows of {time, cpu, ram, tcp}', muicharts: 'rows of {time, cpu, ram, tcp}',
				financialcharts: 'rows of {time, cpu, ram, tcp}', visx: 'rows of {time, cpu, ram, tcp}',
			},
			echartsTimestamps: 'Use each packed row timestamp, converted from minutes to milliseconds.',
			rows: ROWS,
			ySeries: 3,
			yValues: ROWS * 3,
			xUnit: 'uPlot, SciChart and Lightweight Charts: seconds since Unix epoch. Other available libraries: milliseconds since Unix epoch.',
			strokeWidthDevicePixels: {uplot: 1, d3: 1, chartgpu: 1},
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
			jsMs: 'Start through options, constructor/makeChart, async library completion when returned, and initial microtask commit/status update. Includes async waits, not exclusive JS CPU time.',
			aggregation: 'Use the minimum of seven measured rounds per metric, variant and DPR. Exclude three warmups. Columns can come from different rounds. Take prepAndInitMs minima from per-sample sums.',
			windowMs: 'Start through js-end, two requestAnimationFrame callbacks, a 200ms timeout, and WebGL/WebGPU completion validation in trace/memory mode.',
			raf1Ms: 'Start to performance.now() at the first post-init rAF callback entry; rAF mode only. Async adapters can span frames before initialization completes.',
			postJsRaf1Ms: 'js-end to that same first callback entry; rAF mode only.',
			settling: {animationFrames: 2, idleMs: IDLE_MS, beforeStart: true, afterJsEnd: true},
			drain: 'In rAF mode the extra post-JS frame is unmeasured draining before the 200ms wait. It is included only in the trace window, not the rAF latency fields.',
		},

		limitations: [
			'Initial creation only: each non-idle sample prepares fresh input and creates a fresh chart. No redraw or cached-path reuse is measured.',
						'Async initialization waits for the library completion promise/event inside init and trace spans. This can include timers, frames, and deferred interaction setup, not just drawing CPU work.',
			'Libraries share CPU/RAM on the left percentage scale and TCP Out on the right MB scale with automatic y ranges. Native sampling and grouping can change displayed detail and ranges.',
			'ApexCharts uses Canvas with its LTTB-only reducer disabled. Highcharts uses Boost without GPU epoch translations. Plotly uses scattergl. Their -svg variants disable Boost or use scatter. Branding remains enabled.',
			'amCharts disables date grouping with groupData: false and distance-based line simplification with minDistance: 0. exactLocationX: true uses original timestamps.',
			'DevExtreme disables series aggregation. AnyStock disables main and scroller grouping. Its average mapping remains configured but inactive.',
			'FusionTime permits only minute: [1] bins. All other binning units use empty arrays. Average aggregation remains enabled, with one observation per bin for this minute-aligned fixture. Multiple observations within a minute can merge and hide peaks.',
			'Billboard uses Canvas without workers. Syncfusion uses native line reduction. Input retention and disabled reducers do not guarantee identical output or preservation of every visible feature.',
			'React module loading is outside timing; root creation, chart rendering and commits are inside init. Framework memory remains included. visx measures this primitive composition, not a standard chart preset.',
			'Google Charts requests frozen release 52 outside sample timers. Its mutable loader and remote runtime packages require network access and are not fully pinned or locally cached.',
			'Lightweight Charts uses native line conflation with full input retention. Grouped closing values can hide peaks at wide zoom levels.',
			'ECharts 6.1.0 minmax sampling retains every raw row but ends the visible time range three minutes early for this fixture at DPR 1.',
			'The requested static amCharts logo uses a version-guarded private override. The logo and link remain; branding/license terms need review before publication.',
			'Data preparation is timed separately, outside chart markers. CDP chart-window totals exclude prep. Output validation is outside both prep and chart timers.',
			'Library loading, fixture setup and teardown are outside sample markers. All chart options construction, including uPlot options, is inside chart markers.',
			'D3 static title, legend and canvases, the Chart.js canvas/container, and ECharts, Flot and Dygraphs hosts exist at start; library-created DOM is inside the window.',
			'Runtime versions come from loaded library exports, not demo titles. A null version means the runtime does not expose it (such as the date-fns adapter).',
			'Flot 4.2.6 exposes a stale runtime version of 3.0.0. Use runner.dependencies for the pinned package version.',
			'Flot retains its timer-delayed overlay hook. JS/DOM and next-rAF spans do not necessarily include that hook; the longer trace window can include it.',
			'Warmups can appear in the trace. Exclude samples with warmup:true from measured aggregates.',
			'Trace/memory observes current-realm canvas getContext calls, not draw calls. Reused contexts can be registered by adapters. No readback, screenshots, pixel export, or harness-forced layout reads are used.',
			'After settling, trace/memory checks WebGL2 fences or calls WebGL1 finish before the end marker. These checks add thread-wall overhead outside init. Completion covers prior commands in observed contexts, not later draws, other realms, or presentation. rAF has no WebGL observer or completion check.',
			'ChartGPU makeChart waits for an initial nonempty submission and queue completion inside init in all modes, including rAF. Trace/memory then waits after settling for all actual adapter-exposed device queues, with a 1000ms bound and device-loss/error checks. Per-sample webgpu metadata records this wait. No probe devices are requested.',
			'WebGPU completion covers prior submissions, not later draws, presentation, hardware acceleration, or GPU execution time. rAF adds no post-render WebGPU fence. ChartGPU health and full series counts are checked without pixel or layout reads; teardown rejects late adapter errors and requires cleared devices.',
			'Use Chrome trace process/thread events to distinguish renderer JS/DOM, raster, compositor and GPU-process thread work. GPU-process thread duration is not CPU time or hardware GPU execution time, and asynchronous attribution is approximate.',
			'Idle has the same marker/wait schedule but no chart mutation between markers. Report it separately; do not assume subtraction isolates chart GPU cost.',
			'One actual browser DPR is captured from devicePixelRatio and reported on every sample. The parent configures deviceScaleFactor before navigation (default 1); this fixture does not emulate DPR changes. The CSS viewport is 1920x900.',
			'Demo renderings and configurations differ: axes, domains, colors, line widths, sampling, layout and defaults are preserved. This is not pixel-identical rendering or an isolated decimation algorithm comparison.',

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
