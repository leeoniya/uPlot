// chartgpu@0.4.0/dist/index.js ESM namespace: benchmarkChartGPU.
const failures = new WeakMap();
function prepData(packed) {
	const fields = packed[0];
	const count = (packed.length - fields - 1) / fields;
	const data = Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(count)]));

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data.x[j] = packed[i] * 60000;
		data.cpu[j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		data.ram[j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		data.tcp[j] = packed[i + 3];
	}

	return data;
}

async function makeChart(data, host, wait, runtimeOptions) {
	if (!globalThis.navigator?.gpu)
		throw new Error('ChartGPU requires WebGPU.');

	const chart = {
		instance: null, device: null, element: null, destroyed: false, error: null,
		getWebGPUDevices() { return this.destroyed || !this.device ? [] : [this.device]; },
	};
	let ready = false;
	let rejectFailure;
	const failure = new Promise((_, reject) => { rejectFailure = reject; });
	// Errors can arrive during asynchronous creation, before the queue wait starts.
	failure.catch(() => {});
	failures.set(chart, failure);
	const fail = error => {
		if (chart.destroyed || chart.error) return;
		chart.error = error;
		rejectFailure(error);
		if (ready) {
			if (wait) wait.textContent = error.message;
			try { destroyChart(chart); } catch {}
		}
	};
	chart.onError = event => fail(new Error(`ChartGPU WebGPU error: ${event.error.message}`));

	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter)
			throw new Error('ChartGPU requires a WebGPU adapter.');
		if (adapter.info?.isFallbackAdapter)
			throw new Error('ChartGPU requires a non-fallback WebGPU adapter.');
		const device = chart.device = await adapter.requestDevice();
		device.addEventListener('uncapturederror', chart.onError);
		device.lost.then(info => {
			fail(new Error(`ChartGPU WebGPU device lost (${info.reason}): ${info.message}`));
		}, error => fail(error)).catch(() => {});

		const element = chart.element = host.ownerDocument.createElement('div');
		Object.assign(element.style, {position: 'relative', width: '1920px', height: '600px'});
		const title = host.ownerDocument.createElement('div');
		title.textContent = 'Server Events';
		Object.assign(title.style, {height: '24px', textAlign: 'center', font: 'bold 16px/24px Arial, sans-serif'});
		const plot = host.ownerDocument.createElement('div');
		Object.assign(plot.style, {width: '1920px', height: '576px'});
		element.append(title, plot);
		host.append(element);

		const ratio = globalThis.devicePixelRatio || 1;
		chart.instance = await benchmarkChartGPU.ChartGPU.create(plot, {
			theme: 'light',
			animation: false,
			renderMode: 'external',
			performance: {lod: 'strict'},
			grid: {left: 70, right: 80, top: 40, bottom: 40},
			xAxis: {type: 'time'},
			axes: {y: [
				{id: 'percent', type: 'value', position: 'left', tickFormatter: value => `${value}%`},
				{id: 'tcp', type: 'value', position: 'right', tickFormatter: value => `${value} MB`},
			]},
			legend: {show: true, position: 'top'},
			tooltip: {show: true, trigger: 'axis'},
			series: ['cpu', 'ram', 'tcp'].map((key, i) => ({
				type: 'line', name: ['CPU', 'RAM', 'TCP Out'][i],
				data: {x: data.x, y: data[key]},
				yAxis: i === 2 ? 'tcp' : 'percent',
				color: ['red', 'blue', 'green'][i],
				sampling: 'none', lineStyle: {width: 1 / ratio},
			})),
		}, {adapter, device});
		if (chart.error) throw chart.error;

		// 0.4.0 defers submit to a microtask and can swallow render errors.
		// Observe this first frame only, including deferred submit exceptions.
		const queue = device.queue;
		const descriptor = Object.getOwnPropertyDescriptor(queue, 'submit');
		const submit = queue.submit;
		let submitted = false;
		let submitError;
		Object.defineProperty(queue, 'submit', {configurable: true, writable: true, value(buffers) {
			try {
				submit.call(this, buffers);
				if (buffers.length) submitted = true;
			}
			catch (error) { submitError = error; }
		}});
		try {
			const rendered = chart.instance.renderFrame();
			await Promise.resolve();
			if (submitError) throw submitError;
			if (!rendered || !submitted || chart.instance.needsRender())
				throw new Error('ChartGPU did not submit its initial frame.');
		}
		finally {
			if (descriptor) Object.defineProperty(queue, 'submit', descriptor);
			else delete queue.submit;
		}
		await Promise.race([device.queue.onSubmittedWorkDone(), failure]);
		if (chart.error) throw chart.error;
		chart.instance.setRenderMode('auto');
		if (chart.error) throw chart.error;
		ready = true;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyChart(chart); } catch {}
		throw error;
	}
}

function makeEmptyChart(host, wait) {
	return makeChart(Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(0)])), host, wait);
}

async function updateChart(chart, input, host, wait) {
	if (chart.error) throw chart.error;
	if (chart.destroyed) throw new Error('ChartGPU is disposed.');
	const {instance, device} = chart;
	const mode = instance.getRenderMode();
	instance.setRenderMode('external');
	const queue = device.queue;
	const descriptor = Object.getOwnPropertyDescriptor(queue, 'submit');
	const submit = queue.submit;
	let submitted = false;
	let submitError;
	try {
		Object.defineProperty(queue, 'submit', {configurable: true, writable: true, value(buffers) {
			try {
				submit.call(this, buffers);
				if (buffers.length) submitted = true;
			}
			catch (error) { submitError = error; }
		}});
		try {
			// 0.4.0 replaces options; retain all axes, styles and series slots.
			const options = instance.options;
			instance.setOption({...options, series: options.series.map((series, i) => ({
				...series, data: {x: input.x, y: input[['cpu', 'ram', 'tcp'][i]]},
			}))});
			const rendered = instance.renderFrame();
			await Promise.resolve();
			if (submitError) throw submitError;
			if (!rendered || !submitted || instance.needsRender())
				throw new Error('ChartGPU replacement did not submit a complete frame.');
		}
		finally {
			if (descriptor) Object.defineProperty(queue, 'submit', descriptor);
			else delete queue.submit;
		}
		await Promise.race([queue.onSubmittedWorkDone(), failures.get(chart)]);
		if (chart.error) throw chart.error;
		if (chart.destroyed) throw new Error('ChartGPU was disposed during replacement.');
	}
	finally {
		if (!chart.destroyed) instance.setRenderMode(mode);
	}
	if (wait) wait.textContent = 'Done!';
}

function destroyChart(chart) {
	if (chart.destroyed) return;
	chart.destroyed = true;
	let failure;
	// Complete all cleanup even if the vendor disposer fails.
	for (const cleanup of [
		() => chart.device?.removeEventListener('uncapturederror', chart.onError),
		() => chart.instance?.dispose(),
		() => chart.device?.destroy(),
		() => chart.element?.remove(),
	]) {
		try { cleanup(); } catch (error) { failure ??= error; }
	}
	chart.instance = chart.device = chart.element = chart.onError = null;
	if (failure) throw failure;
}

export {makeEmptyChart, updateChart};
export {prepData, makeChart, destroyChart};
