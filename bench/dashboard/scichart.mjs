import {configureRuntime as prepareRuntime, licenseReady} from '../scichart.mjs';
import {SERIES} from './common.mjs';
import {handle, live, trackGL, ready, destroy, failedCreation, done, countSeries, valuesEqual} from './custom-common.mjs';

export {prepareRuntime};
export const prepData = frame => ({x: Float64Array.from(frame.x, x => x / 1000), ys: frame.ys.map(ys => Float64Array.from(ys))});

function render(chart, action) {
	const surface = chart.instance;
	return ready(chart, (resolve, reject) => {
		const completed = invalidated => {
			try {
				if (!licenseReady(surface)) throw new Error('SciChart license still requires validation.');
				if (!invalidated && !surface.isInvalidated && !surface.isRunningAnimation) resolve();
			}
			catch (error) { reject(error); }
		};
		surface.renderInstructionsCompleted.subscribe(completed);
		surface.renderError.subscribe(reject);
		return () => {
			surface.renderInstructionsCompleted.unsubscribe(completed);
			surface.renderError.unsubscribe(reject);
		};
	}, action, chart.timeoutMs);
}

export async function makeChart(input, host, wait) {
	const {timeoutMs} = prepareRuntime();
	const chart = handle(host, 'SciChart');
	chart.timeoutMs = timeoutMs;
	const {SciChartSurface, SciChartJSLightTheme, DateTimeNumericAxis, NumericAxis, EAutoRange,
		EAxisAlignment, XyDataSeries, FastLineRenderableSeries, EResamplingMode} = globalThis.SciChart;
	try {
		let timer, expired = false;
		const creation = Promise.resolve().then(() => SciChartSurface.createSingle(chart.plot, {
			theme: new SciChartJSLightTheme(), createSuspended: true,
		})).then(result => {
			if (expired) { result.sciChartSurface.delete(); return null; }
			return result;
		});
		let result;
		try {
			result = await Promise.race([creation, new Promise((_, reject) => {
				timer = setTimeout(() => { expired = true; reject(new Error('SciChart initialization timed out; check WASM, licensing, and browser context limits.')); }, timeoutMs);
			})]);
		}
		finally { clearTimeout(timer); }
		chart.instance = result.sciChartSurface;
		const {wasmContext} = result;
		const surface = chart.instance;
		// createSingle owns this initialized native canvas (not a shared 2D copy target).
		// Reacquire its existing context only; never scan unrelated canvases.
		const gl = surface.domCanvasWebGL.getContext('webgl2');
		if (!gl) throw new Error('SciChart dashboard requires the native WebGL2 backend; no backend fallback is accepted.');
		trackGL(chart, gl, surface.domCanvasWebGL, true);
		if (!licenseReady(surface)) {
			await ready(chart, (resolve, reject) => {
				const poll = setInterval(() => {
					try { if (licenseReady(surface)) resolve(); }
					catch (error) { reject(error); }
				}, 50);
				return () => clearInterval(poll);
			}, () => {}, timeoutMs);
		}
		surface.xAxes.add(new DateTimeNumericAxis(wasmContext, {id: 'time', autoRange: EAutoRange.Always}));
		surface.yAxes.add(new NumericAxis(wasmContext, {id: 'value', axisAlignment: EAxisAlignment.Left, autoRange: EAutoRange.Always}));
		SERIES.forEach(({label, color}, i) => {
			const dataSeries = new XyDataSeries(wasmContext, {dataSeriesName: label, capacity: input.x.length,
				isSorted: true, dataEvenlySpacedInX: true, containsNaN: false});
			let line;
			try {
				line = new FastLineRenderableSeries(wasmContext, {dataSeries, xAxisId: 'time', yAxisId: 'value',
					stroke: color, strokeThickness: 1, resamplingMode: EResamplingMode.Auto});
				surface.renderableSeries.add(line);
			}
			catch (error) { if (line) line.delete(); else dataSeries.delete(); throw error; }
			dataSeries.appendRange(input.x, input.ys[i]);
		});
		await render(chart, () => surface.resumeUpdates({invalidateOnResume: true}));
		done(wait);
		return chart;
	}
	catch (error) { failedCreation(chart, error, destroyChart); }
}

export async function updateChart(chart, input, host, wait) {
	const surface = chart.instance;
	await render(chart, () => {
		surface.suspendUpdates();
		try {
			surface.renderableSeries.asArray().forEach((line, i) => {
				line.dataSeries.clear();
				line.dataSeries.appendRange(input.x, input.ys[i]);
			});
		}
		finally { surface.resumeUpdates({invalidateOnResume: true}); }
	});
	done(wait);
}

export function validateChart(chart, input, {rows}) {
	live(chart);
	if (!licenseReady(chart.instance)) throw new Error('SciChart license has not completed validation.');
	const native = chart.instance.renderableSeries.asArray();
	countSeries(native, rows, line => line.dataSeries.count());
	native.forEach((line, i) => {
		const x = line.dataSeries.getNativeXValues(), y = line.dataSeries.getNativeYValues();
		if (x.size() !== rows || y.size() !== rows) throw new Error('SciChart native vector length differs from row count.');
		valuesEqual(rows, j => x.get(j), j => y.get(j), input.x, input.ys[i]);
	});
	return true;
}

export function destroyChart(chart) { destroy(chart, [() => { if (chart.instance && !chart.instance.isDeleted) chart.instance.delete(); }]); }
