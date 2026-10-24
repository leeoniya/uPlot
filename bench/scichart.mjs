// SciChart.js 6.0.14; browser global: SciChart (index.min.js).
// The shared loader supplies prefetched, stable wasmUrl / wasmNoSimdUrl in
// benchmarkSciChartOptions, or wasmBinary / wasmNoSimdBinary ArrayBuffers.
// Normal WASM compilation-cache reuse is intentional; native init and ingestion
// still happen in makeChart(). Treat fallback buffers as immutable assets.
// Optional runtimeLicenseKey uses the vendor API; otherwise use its community startup.
// Keep vendor branding and license validation intact. No publication-policy gate.

const pendingRenders = new WeakMap();
const binaryUrls = new WeakMap();
// Chart teardown must not revoke URLs used by later samples. Reclaim fallback
// blobs when their input buffers are collected (or when the document unloads).
const binaryUrlCleanup = new FinalizationRegistry(url => URL.revokeObjectURL(url));

function wasmAssetUrl(options, urlKey, binaryKey) {
	if (options[urlKey] != null) {
		if (typeof options[urlKey] !== 'string' || !options[urlKey].trim())
			throw new Error(`benchmarkSciChartOptions.${urlKey} must be a nonempty asset URL.`);
		return options[urlKey];
	}

	const binary = options[binaryKey];
	if (!(binary instanceof ArrayBuffer) || binary.byteLength === 0)
		throw new Error(`Supply a prefetched benchmarkSciChartOptions.${urlKey} or ${binaryKey} (ArrayBuffer) before timing makeChart().`);
	let url = binaryUrls.get(binary);
	if (!url) {
		url = URL.createObjectURL(new Blob([binary], {type: 'application/wasm'}));
		binaryUrls.set(binary, url);
		binaryUrlCleanup.register(binary, url);
	}
	return url;
}

// Public in 6.0.14: SciChartSurfaceBase.getLicenseContext() returns TLicenseContext.
// Match the vendor's accepted native states, not hasInvalidState or a rendered overlay.
function licenseReady(chart) {
	const {SCRTCredentials, SCRTLicenseType} = chart.getLicenseContext();
	const type = SCRTCredentials.GetLicenseType();
	if (type != null && [
		SCRTLicenseType.LICENSE_TYPE_FULL,
		SCRTLicenseType.LICENSE_TYPE_TRIAL,
		SCRTLicenseType.LICENSE_TYPE_COMMUNITY,
	].includes(type))
		return true;
	if (type != null && type === SCRTLicenseType.LICENSE_TYPE_REQUIRES_VALIDATION)
		return false;
	const name = Object.keys(SCRTLicenseType).find(key => SCRTLicenseType[key] === type) ?? 'UNKNOWN';
	throw new Error(`SciChart license blocked chart initialization (${name}). Check the runtime key and vendor license diagnostics.`);
}

export function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const x = new Float64Array(count);
	const cpu = new Float64Array(count);
	const ram = new Float64Array(count);
	const tcp = new Float64Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		// DateTimeNumericAxis uses Unix seconds, not milliseconds or sample indices.
		x[j] = packed[i] * 60;
		cpu[j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		ram[j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		tcp[j] = packed[i + 3];
	}

	return {x, cpu, ram, tcp};
}

export async function makeChart(data, host, wait) {
	if (!globalThis.SciChart)
		throw new Error('Load scichart 6.0.14 index.min.js before makeChart().');

	const options = globalThis.benchmarkSciChartOptions ?? {};

	const timeoutMs = options.timeoutMs ?? 30000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
		throw new Error('benchmarkSciChartOptions.timeoutMs must be a positive finite number.');
	if (options.runtimeLicenseKey != null && (typeof options.runtimeLicenseKey !== 'string' || !options.runtimeLicenseKey.trim()))
		throw new Error('benchmarkSciChartOptions.runtimeLicenseKey must be a nonempty vendor-issued runtime key.');

	const {SciChartSurface, SciChartDefaults, EUseWasm64, EUseWasmSimd,
		SciChartJSLightTheme, DateTimeNumericAxis, NumericAxis, EAutoRange,
		EAxisAlignment, XyDataSeries, FastLineRenderableSeries, EResamplingMode} = globalThis.SciChart;

	const wasmUrl = wasmAssetUrl(options, 'wasmUrl', 'wasmBinary');
	const wasmNoSimdUrl = wasmAssetUrl(options, 'wasmNoSimdUrl', 'wasmNoSimdBinary');
	let chart;
	try {
		SciChartDefaults.useWasm64 = EUseWasm64.Never;
		SciChartDefaults.useWasmSimd = EUseWasmSimd.Auto;
		SciChartDefaults.useNativeText = true;
		SciChartSurface.configure({wasmUrl, wasmNoSimdUrl});
		if (options.runtimeLicenseKey != null)
			SciChartSurface.setRuntimeLicenseKey(options.runtimeLicenseKey);
		else
			SciChartSurface.UseCommunityLicense();

		const result = await new Promise((resolve, reject) => {
			let expired = false;
			const timer = setTimeout(() => {
				expired = true;
				reject(new Error('SciChart initialization timed out. Check WASM, browser graphics support, and vendor license diagnostics.'));
			}, timeoutMs);
			Promise.resolve().then(() => SciChartSurface.createSingle(host, {
				theme: new SciChartJSLightTheme(),
				createSuspended: true,
			})).then(result => {
				clearTimeout(timer);
				// Creation has no cancellation API. Release a surface that arrives late.
				if (expired)
					result.sciChartSurface.delete();
				else
					resolve(result);
			}, error => {
				clearTimeout(timer);
				reject(error);
			});
		});
		chart = result.sciChartSurface;
		if (!licenseReady(chart)) {
			// Server-validated keys can be pending after createSingle resolves. Let the
			// vendor complete validation; never accept a frame of its licensing message.
			await new Promise((resolve, reject) => {
				const cleanup = () => {
					clearInterval(poll);
					clearTimeout(timer);
					pendingRenders.delete(chart);
				};
				const failed = error => { cleanup(); reject(error); };
				const poll = setInterval(() => {
					try {
						if (licenseReady(chart)) { cleanup(); resolve(); }
					}
					catch (error) { failed(error); }
				}, 50);
				const timer = setTimeout(() => failed(new Error('SciChart license validation timed out (LICENSE_TYPE_REQUIRES_VALIDATION). Check the vendor licensing endpoint.')), timeoutMs);
				pendingRenders.set(chart, failed);
			});
		}
		const {wasmContext} = result;
		chart.xAxes.add(new DateTimeNumericAxis(wasmContext, {id: 'time', autoRange: EAutoRange.Always}));
		chart.yAxes.add(new NumericAxis(wasmContext, {
			id: 'percent', axisTitle: 'CPU / RAM (%)',
			axisAlignment: EAxisAlignment.Left, autoRange: EAutoRange.Always,
		}));
		chart.yAxes.add(new NumericAxis(wasmContext, {
			id: 'tcp', axisTitle: 'TCP Out (MB)',
			axisAlignment: EAxisAlignment.Right, autoRange: EAutoRange.Always,
		}));

		for (const [name, values, yAxisId, stroke] of [
			['CPU', data.cpu, 'percent', '#ff0000'],
			['RAM', data.ram, 'percent', '#0000ff'],
			['TCP Out', data.tcp, 'tcp', '#008000'],
		]) {
			const series = new XyDataSeries(wasmContext, {
				dataSeriesName: name, capacity: data.x.length,
				// This fixture has sorted, evenly spaced one-minute samples, no NaNs.
				isSorted: true, dataEvenlySpacedInX: true, containsNaN: false,
			});
			let line;
			try {
				line = new FastLineRenderableSeries(wasmContext, {
					dataSeries: series, xAxisId: 'time', yAxisId, stroke, strokeThickness: 1,
					// Auto matches MinMax in the pinned accuracy tests; selection remains native.
					resamplingMode: EResamplingMode.Auto,
				});
				chart.renderableSeries.add(line);
			}
			catch (error) {
				if (line) line.delete();
				else series.delete();
				throw error;
			}
			// Full Float64 columns go into native storage inside init, not prepData.
			series.appendRange(data.x, values);
		}

		// Subscribe before releasing the initially suspended, fully populated chart.
		await renderChart(chart, timeoutMs, () => chart.resumeUpdates({invalidateOnResume: true}));
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		if (chart)
			destroyChart(chart);
		throw error;
	}

}

function renderChart(chart, timeoutMs, action) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			chart.renderInstructionsCompleted.unsubscribe(rendered);
			chart.renderError.unsubscribe(failed);
			pendingRenders.delete(chart);
		};
		const failed = error => {
			cleanup();
			reject(error instanceof Error ? error : new Error(String(error)));
		};
		const rendered = isInvalidated => {
			try {
				if (!licenseReady(chart))
					throw new Error('SciChart license requires validation before rendering can complete (LICENSE_TYPE_REQUIRES_VALIDATION).');
				if (!isInvalidated && !chart.isInvalidated && !chart.isRunningAnimation) {
					cleanup();
					resolve();
				}
			}
			catch (error) { failed(error); }
		};
		const timer = setTimeout(() => failed(new Error('SciChart render completion timed out. Check browser graphics support and vendor license diagnostics.')), timeoutMs);
		pendingRenders.set(chart, failed);
		chart.renderInstructionsCompleted.subscribe(rendered);
		chart.renderError.subscribe(failed);
		try { action(); }
		catch (error) { failed(error); }
	});
}

export function makeEmptyChart(host, wait) {
	return makeChart(Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(0)])), host, wait);
}

export async function updateChart(chart, input, host, wait) {
	await renderChart(chart, globalThis.benchmarkSciChartOptions?.timeoutMs ?? 30000, () => {
		chart.suspendUpdates();
		try {
			const lines = chart.renderableSeries.asArray();
			for (const [i, key] of ['cpu', 'ram', 'tcp'].entries()) {
				lines[i].dataSeries.clear();
				lines[i].dataSeries.appendRange(input.x, input[key]);
			}
		}
		finally { chart.resumeUpdates({invalidateOnResume: true}); }
	});
	if (wait) wait.textContent = 'Done!';
}

export function destroyChart(chart) {
	pendingRenders.get(chart)?.(new Error('SciChart was disposed before rendering completed.'));
	if (!chart.isDeleted)
		// createSingle owns its WASM context; delete also frees series and native data.
		chart.delete();
}
