import * as uplot from '../bench/uplot.mjs';
import * as plotly from '../bench/plotly.mjs';
import * as scichart from '../bench/scichart.mjs';
import * as chartgpu from '../bench/chartgpu.mjs';

// Diagnostic only. Load vendors (and uPlot CSS) before create; use an attached,
// visible host. The runner owns the 5s operation watchdog, settling and GL fences.
// No vendor downloads, dummy data, nonempty prewarm, or browser scheduling here.
// prepare accepts bench/data.json's packed [fieldCount, ...headers, ...rows].
// It returns the corresponding bench adapter's shape and fresh columns each time.
// Supply 55,550 rows for every populated create/update, with fresh x/y columns and
// changed y samples in all three series for each replacement. Do not mutate inputs
// after handing them to a chart. null means empty creation/validation, not update.
// Calls must be serial in this realm, including other graphics work while creating.
// contexts reports observed acquisitions, never probes getContext (which can create
// a context). Install the runner's capture before vendors to cover module preloads.
// ChartGPU readiness includes queue completion in ALL phases, as its bench factory
// does. Other GPU fences/presentation checks remain the runner's responsibility.

export const lifecycleRows = 55550;
const modules = {uplot, plotly, scichart, chartgpu};
const names = ['CPU', 'RAM', 'TCP Out'];
const keys = ['x', 'cpu', 'ram', 'tcp'];
const sampleIndexes = [0, Math.floor(lifecycleRows / 2), lifecycleRows - 1];
let observing = false;

function check(condition, message) {
	if (!condition) throw new Error(`Lifecycle diagnostic: ${message}`);
}

function columns(id, input) {
	return id === 'uplot' || id === 'plotly' ? input : keys.map(key => input?.[key]);
}

function emptyInput(id) {
	const data = Array.from({length: 4}, () => []);
	return id === 'uplot' || id === 'plotly' ? data : Object.fromEntries(keys.map((key, i) => [key, data[i]]));
}

function checkedColumns(id, input) {
	const data = columns(id, input);
	check(data?.length === 4 && data.every(column => column?.length === lifecycleRows),
		`${id} requires four full ${lifecycleRows}-row columns; use null for empty creation`);
	for (const column of data)
		check(sampleIndexes.every(i => Number.isFinite(column[i])), `${id} requires finite diagnostic samples`);
	return data;
}

export function prepareLifecycleInput(id, packed) {
	check(Object.hasOwn(modules, id), `unsupported adapter: ${id}`);
	const fields = packed?.[0];
	check(Number.isInteger(fields) && fields >= 7 && (packed.length - fields - 1) / fields === lifecycleRows,
		`packed input must contain ${lifecycleRows} complete rows`);
	const input = modules[id].prepData(packed);
	checkedColumns(id, input);
	return input;
}

// Observe only real library acquisitions, including detached/offscreen canvases.
// Wrappers compose with the parent runner's capture and are always restored.
async function observeContexts(handle, action) {
	check(!observing, 'concurrent operations are not supported');
	observing = true;
	const patches = [];
	try {
		for (const name of ['HTMLCanvasElement', 'OffscreenCanvas']) {
			const prototype = globalThis[name]?.prototype;
			const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'getContext');
			if (typeof descriptor?.value !== 'function') continue;
			const original = descriptor.value;
			function wrapper(type, ...args) {
				const context = original.call(this, type, ...args);
				if (context && ['webgl', 'webgl2', 'experimental-webgl'].includes(type)) handle.gl.add(context);
				return context;
			}
			Object.defineProperty(prototype, 'getContext', {...descriptor, value: wrapper});
			patches.push({prototype, descriptor, wrapper});
		}
		return await action();
	}
	finally {
		for (const {prototype, descriptor, wrapper} of patches)
			if (prototype.getContext === wrapper) Object.defineProperty(prototype, 'getContext', descriptor);
		observing = false;
	}
}

function plotlyTraces(input) {
	return names.map((name, i) => ({
		name, uid: `lifecycle-${i}`, type: 'scattergl', mode: 'lines',
		x: input[0], y: input[i + 1], yaxis: i === 2 ? 'y2' : 'y',
		line: {width: 1 / (globalThis.devicePixelRatio || 1), color: ['red', 'blue', 'green'][i]},
	}));
}

function plotlyLayout() {
	// A fresh auto-range layout drops any previous timestamp range on every react.
	return {
		title: {text: 'Server Events'}, width: 1920, height: 600,
		margin: {l: 70, r: 80, b: 60, t: 60}, transition: {duration: 0},
		xaxis: {type: 'date', autorange: true},
		yaxis: {side: 'left', ticksuffix: '%', autorange: true},
		yaxis2: {side: 'right', overlaying: 'y', ticksuffix: ' MB', autorange: true, showgrid: false},
		legend: {orientation: 'h', y: 1.1},
	};
}

function sciLicense(chart) {
	const {SCRTCredentials, SCRTLicenseType: types} = chart.getLicenseContext();
	const type = SCRTCredentials.GetLicenseType();
	check(type != null && [types.LICENSE_TYPE_FULL, types.LICENSE_TYPE_TRIAL, types.LICENSE_TYPE_COMMUNITY].includes(type),
		'SciChart license is not ready; use the original Community API or a vendor-issued key');
}

function sciRender(handle, action) {
	const chart = handle.chart;
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			chart.renderInstructionsCompleted.unsubscribe(done);
			chart.renderError.unsubscribe(fail);
			handle.cancelRender = null;
		};
		const fail = error => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); };
		const done = invalidated => {
			try {
				sciLicense(chart);
				if (!invalidated && !chart.isInvalidated && !chart.isRunningAnimation) { cleanup(); resolve(); }
			}
			catch (error) { fail(error); }
		};
		handle.cancelRender = fail;
		chart.renderInstructionsCompleted.subscribe(done);
		chart.renderError.subscribe(fail);
		try { action(); } catch (error) { fail(error); }
	});
}

// Pinned API research: chartgpu@0.4.0/dist/ChartGPU.d.ts and
// dist/index-CRWVNupN.js (jsDelivr). setOption replaces options, updates the existing
// coordinator, rebuilds the hit-test store, and marks the chart dirty. No public
// setData/updateSeries exists. Preserve all options and the three series slots;
// internal series/buffer reconstruction is the library's policy, not avoidable here.
async function gpuRender(handle, input) {
	const chart = handle.chart;
	check(!chart.error && !chart.destroyed, chart.error?.message ?? 'ChartGPU is disposed');
	const instance = chart.instance;
	check(typeof instance.setOption === 'function' && instance.getRenderMode() === 'external',
		'ChartGPU 0.4.0 external setOption API is unavailable');
	const queue = chart.device.queue;
	const descriptor = Object.getOwnPropertyDescriptor(queue, 'submit');
	const submit = queue.submit;
	let submitted = false, submitError;
	Object.defineProperty(queue, 'submit', {configurable: true, writable: true, value(buffers) {
		try {
			submit.call(this, buffers);
			if (buffers.length) submitted = true;
		}
		catch (error) { submitError = error; }
	}});
	try {
		const options = instance.options;
		check(options?.series?.length === 3, 'ChartGPU lost its three series');
		instance.setOption({...options, series: options.series.map((series, i) => ({
			...series, data: {x: input.x, y: input[keys[i + 1]]},
		}))});
		const rendered = instance.renderFrame();
		await Promise.resolve(); // 0.4.0 defers submit by one microtask.
		if (submitError) throw submitError;
		check(rendered && submitted && !instance.needsRender(), 'ChartGPU replacement did not submit a complete frame');
	}
	finally {
		if (descriptor) Object.defineProperty(queue, 'submit', descriptor);
		else delete queue.submit;
	}
	await chart.device.queue.onSubmittedWorkDone();
	if (chart.error) throw chart.error;
	check(!chart.destroyed, 'ChartGPU was disposed during replacement');
}

function remember(handle, data) {
	handle.previousSamples = handle.samples;
	handle.lastColumns = data;
	handle.samples = data?.slice(1).map(column => sampleIndexes.map(i => column[i])) ?? null;
}

function gpuNativeSamples(chart, series) {
	const instance = chart.instance;
	check(typeof instance.hitTest === 'function', 'ChartGPU native hitTest API is unavailable');
	const canvas = chart.element.querySelector('canvas');
	const rect = canvas?.getBoundingClientRect();
	check(rect?.width > 0 && rect.height > 0, 'ChartGPU validation needs a visible canvas');
	const width = canvas.clientWidth || rect.width, height = canvas.clientHeight || rect.height;
	const grid = instance.options.grid;
	const plotWidth = width - grid.left - grid.right, plotHeight = height - grid.top - grid.bottom;
	check(plotWidth > 0 && plotHeight > 0, 'ChartGPU validation needs a nonempty plot area');
	let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
	for (const {data: {x, y}} of series) {
		for (let i = 0; i < x.length; i++) {
			xMin = Math.min(xMin, x[i]); xMax = Math.max(xMax, x[i]);
			yMin = Math.min(yMin, y[i]); yMax = Math.max(yMax, y[i]);
		}
	}
	if (xMin === xMax) xMax++;
	if (yMin === yMax) yMax++;
	// Pinned 0.4.0 hitTest uses raw, combined extents for its default scales, even
	// with dual y axes. These coordinates are for hitTest, not rendered pixel proof.
	// hitTest reads the library's copied columnar store (R in the pinned source).
	return series.map((series, s) => sampleIndexes.map(i => {
		const x = grid.left + (series.data.x[i] - xMin) / (xMax - xMin) * plotWidth;
		const y = grid.top + (1 - (series.data.y[i] - yMin) / (yMax - yMin)) * plotHeight;
		// No DOM event dispatch or interaction update: hitTest consumes clientX/Y.
		const {match} = instance.hitTest({clientX: rect.left + x * rect.width / width,
			clientY: rect.top + y * rect.height / height});
		check(match?.kind === 'cartesian' && match.seriesIndex === s && match.dataIndex === i,
			`ChartGPU cannot verify native series ${s} sample ${i} (missing, stale, or coincident hit)`);
		return match.value;
	}));
}

function nativeSeries(handle) {
	const {id, chart} = handle;
	if (id === 'uplot') {
		check(chart.series.length === 4 && chart.series.every((series, i) => series === handle.series[i]), 'uPlot replaced its series');
		return chart.data.slice(1).map(y => ({x: chart.data[0], y}));
	}
	if (id === 'plotly') {
		check(chart === handle.host && chart._fullData?.length === 3, 'Plotly native fullData is unavailable');
		return chart._fullData.map((trace, i) => {
			// 4.1.2 scattergl defaults return before coercing mode for zero points.
			const empty = trace._length === 0 && trace.visible === false;
			check(trace.type === 'scattergl' && trace.uid === `lifecycle-${i}` &&
				(empty ? chart.data?.[i]?.mode === 'lines' : trace.mode === 'lines'), 'Plotly lost a line trace');
			return {x: trace.x, y: trace.y};
		});
	}
	if (id === 'scichart') {
		sciLicense(chart);
		const series = chart.renderableSeries.asArray();
		check(series.length === 3, 'SciChart lost a line series');
		return series.map((line, i) => {
			check(line === handle.series[i] && line.dataSeries === handle.dataSeries[i], 'SciChart replaced a line/data series');
			const data = line.dataSeries, x = data.getNativeXValues(), y = data.getNativeYValues();
			check(data.count() === x.size() && x.size() === y.size(), 'SciChart native vector counts disagree');
			return {x: {length: x.size(), get: i => x.get(i)}, y: {length: y.size(), get: i => y.get(i)}};
		});
	}
	check(!chart.error && !chart.destroyed && !chart.instance.disposed, chart.error?.message ?? 'ChartGPU is disposed');
	check(chart.device === handle.device && chart.instance === handle.instance, 'ChartGPU replaced its device/chart');
	check(typeof chart.instance.getHitTestSeriesPointCount === 'function', 'ChartGPU native diagnostic count API is unavailable');
	const series = chart.instance.options.series;
	check(series?.length === 3, 'ChartGPU lost a line series');
	const counts = series.map((series, i) => {
		check(series.type === 'line', 'ChartGPU lost a line series');
		const count = chart.instance.getHitTestSeriesPointCount(i);
		check(count === series.data.x.length && count === series.data.y.length, 'ChartGPU retained store count differs from options');
		return count;
	});
	const samples = counts.every(count => count === 0) ? null : gpuNativeSamples(chart, series);
	return counts.map((count, s) => ({
		x: {length: count, get: i => samples[s][sampleIndexes.indexOf(i)][0]},
		y: {length: count, get: i => samples[s][sampleIndexes.indexOf(i)][1]},
	}));
}

/** IDs: uplot, plotly (4.1.2 scattergl), scichart (6.0.14), chartgpu (0.4.0). */
export function createLifecycleAdapter(id) {
	check(Object.hasOwn(modules, id), `unsupported adapter: ${id}`);
	const owned = new WeakSet();
	const live = handle => {
		check(owned.has(handle) && !handle.destroyed, `${id} handle is foreign or destroyed`);
		if (handle.error) throw handle.error;
	};
	const adapter = {
		prepare: packed => prepareLifecycleInput(id, packed),
		async create(host, inputOrNull) {
			const data = inputOrNull === null ? null : checkedColumns(id, inputOrNull);
			const input = inputOrNull ?? emptyInput(id);
			check(host?.style, 'create requires a DOM host');
			Object.assign(host.style, {width: '1920px', height: '600px'});
			const handle = {id, host, chart: null, gl: new Set(), destroyed: false};
			owned.add(handle);
			try {
				await observeContexts(handle, async () => {
					if (id === 'plotly') {
						check(globalThis.Plotly?.version === '4.1.2', 'load Plotly 4.1.2 before create');
						// Keep the host for purge even when newPlot rejects midway through setup.
						handle.chart = host;
						await Plotly.newPlot(host, plotlyTraces(input), plotlyLayout(), {
							responsive: false, plotGlPixelRatio: globalThis.devicePixelRatio || 1,
						});
					}
					else {
						if (id === 'uplot') check(typeof globalThis.uPlot === 'function', 'load uPlot before create');
						if (id === 'chartgpu') check(globalThis.benchmarkChartGPU?.ChartGPU, 'load ChartGPU 0.4.0 as benchmarkChartGPU before create');
						handle.chart = await modules[id].makeChart(input, host, {textContent: ''});
						if (id === 'uplot') handle.series = handle.chart.series.slice();
						if (id === 'scichart') {
							handle.series = handle.chart.renderableSeries.asArray().slice();
							handle.dataSeries = handle.series.map(line => line.dataSeries);
						}
						if (id === 'chartgpu') {
							// Factory has already checked initial submit and queue completion.
							handle.instance = handle.chart.instance;
							handle.device = handle.chart.device;
							handle.instance.setRenderMode('external');
						}
					}
				});
				remember(handle, data);
				return handle;
			}
			catch (error) {
				try { await adapter.destroy(handle); } catch { /* Preserve the initialization error. */ }
				throw error;
			}
		},
		async update(handle, input) {
			live(handle);
			const data = checkedColumns(id, input);
			if (handle.lastColumns) {
				check(data.every((column, i) => column !== handle.lastColumns[i] &&
					(!ArrayBuffer.isView(column) || column.buffer !== handle.lastColumns[i].buffer)), 'replacement requires fresh x/y columns');
				check(data.slice(1).every((column, s) => sampleIndexes.some((i, j) => column[i] !== handle.samples[s][j])),
					'replacement requires changed y samples in all three series');
			}
			try {
				await observeContexts(handle, async () => {
					if (id === 'uplot') {
						handle.chart.setData(input, true);
						await Promise.resolve();
					}
					else if (id === 'plotly') await Plotly.react(handle.host, plotlyTraces(input), plotlyLayout());
					else if (id === 'scichart') {
						await sciRender(handle, () => {
							handle.chart.suspendUpdates();
							try {
								for (let i = 0; i < 3; i++) {
									handle.dataSeries[i].clear();
									handle.dataSeries[i].appendRange(data[0], data[i + 1]);
								}
							}
							finally { handle.chart.resumeUpdates({invalidateOnResume: true}); }
						});
					}
					else await gpuRender(handle, input);
				});
				remember(handle, data);
			}
			catch (error) { handle.error = error; throw error; }
		},
		validate(handle, inputOrNull) {
			live(handle);
			const expected = inputOrNull === null ? null : checkedColumns(id, inputOrNull);
			const count = expected ? lifecycleRows : 0;
			const actual = nativeSeries(handle);
			check(actual.length === 3, `${id} must retain three series even when empty`);
			const read = (column, i) => typeof column.get === 'function' ? column.get(i) : column[i];
			const series = actual.map(({x, y}, s) => {
				check(x?.length === count && y?.length === count, `${id} series ${s} count is not ${count}`);
				const samples = count ? sampleIndexes.map((i, j) => {
					const actualX = read(x, i), actualY = read(y, i);
					check(actualX === expected[0][i] && actualY === expected[s + 1][i], `${id} series ${s} sample ${i} is stale or incorrect`);
					return {index: i, x: actualX, y: actualY,
						changedY: handle.previousSamples ? actualY !== handle.previousSamples[s][j] : null};
				}) : [];
				return {name: names[s], count: y.length, samples};
			});
			return {id, empty: count === 0, series, totalPoints: count * 3,
				contexts: handle.gl.size, devices: adapter.devices(handle).length,
				evidence: id === 'chartgpu' ? 'Retained hit-test store counts and public hitTest samples; not GPU-buffer readback.'
					: id === 'scichart' ? 'Native WASM vectors.' : id === 'plotly' ? 'Native _fullData traces.' : 'Chart data and retained series.'};
		},
		async destroy(handle) {
			check(owned.has(handle), `${id} handle is foreign`);
			if (handle.destroyed) return;
			handle.destroyed = true;
			handle.cancelRender?.(new Error('Lifecycle diagnostic disposed before render completion'));
			try {
				if (handle.chart) {
					if (id === 'uplot') handle.chart.destroy();
					else modules[id].destroyChart(handle.chart);
				}
			}
			finally {
				handle.gl.clear();
				handle.chart = handle.instance = handle.device = handle.series = handle.dataSeries = null;
				handle.lastColumns = handle.samples = handle.previousSamples = null;
			}
		},
		contexts(handle) {
			check(owned.has(handle), `${id} handle is foreign`);
			return handle.destroyed ? [] : [...handle.gl];
		},
		devices(handle) {
			check(owned.has(handle), `${id} handle is foreign`);
			return handle.destroyed || id !== 'chartgpu' ? [] : handle.chart.getWebGPUDevices();
		},
	};
	return adapter;
}
