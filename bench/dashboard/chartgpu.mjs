import {SERIES} from './common.mjs';
import {handle, live, destroy, failedCreation, done, pixelRatio, countSeries, valuesEqual} from './custom-common.mjs';

export const prepData = frame => ({x: Float64Array.from(frame.x), ys: frame.ys.map(ys => Float64Array.from(ys))});

function series(input) {
	return SERIES.map(({label, color}, i) => ({type: 'line', name: label, color,
		data: {x: input.x, y: input.ys[i]}, yAxis: 'value', sampling: 'none', lineStyle: {width: 1 / pixelRatio()}}));
}

// ChartGPU 0.4.0 defers queue.submit to a microtask and can swallow its errors.
// Observe only this owned device; require real submission, then await its queue.
async function render(chart, change) {
	live(chart);
	const {instance, device} = chart;
	const queue = device.queue;
	const descriptor = Object.getOwnPropertyDescriptor(queue, 'submit');
	const submit = queue.submit;
	let submitted = false, submitError;
	try {
		Object.defineProperty(queue, 'submit', {configurable: true, writable: true, value(buffers) {
			try { submit.call(this, buffers); if (buffers.length) submitted = true; }
			catch (error) { submitError = error; }
		}});
		try {
			// renderFrame() is external-only in 0.4.0; pause native hover scheduling.
			instance.setRenderMode('external');
			change();
			const rendered = instance.renderFrame();
			await Promise.resolve();
			if (submitError) throw submitError;
			if (!rendered || !submitted || instance.needsRender()) throw new Error('ChartGPU did not submit a complete dashboard frame.');
		}
		finally {
			if (descriptor) Object.defineProperty(queue, 'submit', descriptor);
			else delete queue.submit;
		}
		await Promise.race([queue.onSubmittedWorkDone(), chart.failure]);
		live(chart);
		instance.setRenderMode('auto');
	}
	catch (error) { chart.fail(error); throw error; }
}

export async function makeChart(input, host, wait) {
	if (!globalThis.navigator?.gpu || !globalThis.benchmarkChartGPU?.ChartGPU)
		throw new Error('Dashboard requires WebGPU and chartgpu@0.4.0.');
	const chart = handle(host, 'ChartGPU', false);
	chart.getWebGPUDevices = () => chart.destroyed || !chart.device ? [] : [chart.device];
	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter || adapter.info?.isFallbackAdapter) throw new Error('ChartGPU requires a non-fallback WebGPU adapter.');
		const device = chart.device = await adapter.requestDevice();
		const onError = event => chart.fail(new Error(`ChartGPU WebGPU error: ${event.error.message}`));
		device.addEventListener('uncapturederror', onError);
		chart.cleanups.push(() => device.removeEventListener('uncapturederror', onError));
		device.lost.then(info => {
			if (!chart.destroyed) chart.fail(new Error(`ChartGPU device lost (${info.reason}): ${info.message}`));
		}, chart.fail);
		let timer;
		try {
			await Promise.race([
				Promise.resolve(benchmarkChartGPU.ChartGPU.create(chart.plot, {
					theme: 'light', animation: false, renderMode: 'external', performance: {lod: 'strict'},
					xAxis: {type: 'time'},
					axes: {y: [{id: 'value', type: 'value', position: 'left'}]},
					legend: {show: true, position: 'top'}, tooltip: {show: true}, series: series(input),
				}, {adapter, device})).then(instance => {
					if (chart.destroyed) instance.dispose();
					else chart.instance = instance;
				}),
				chart.failure,
				new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ChartGPU initialization timed out.')), 30000); }),
			]);
		}
		finally { clearTimeout(timer); }
		await render(chart, () => {});
		done(wait);
		return chart;
	}
	catch (error) { failedCreation(chart, error, destroyChart); }
}

export async function updateChart(chart, input, host, wait) {
	await render(chart, () => chart.instance.setOption({...chart.instance.options, series: series(input)}));
	done(wait);
}

export function validateChart(chart, input, {rows}) {
	live(chart);
	const native = chart.instance.options.series;
	countSeries(native, rows, s => s.data.x.length === rows ? s.data.y.length : -1);
	native.forEach((s, i) => valuesEqual(rows, j => s.data.x[j], j => s.data.y[j], input.x, input.ys[i]));
	if (chart.instance.needsRender()) throw new Error('ChartGPU still has an unrendered dashboard change.');
	return true;
}

export function destroyChart(chart) { destroy(chart, [() => chart.instance?.dispose(), () => chart.device?.destroy()]); }
