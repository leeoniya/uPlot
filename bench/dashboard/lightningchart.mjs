import {WIDTH, HEIGHT, SERIES} from './common.mjs';
import {handle, live, trackGL, ready, destroy, failedCreation, done, countSeries, valuesEqual} from './custom-common.mjs';

export const prepData = frame => ({x: Float64Array.from(frame.x), ys: frame.ys.map(ys => Float64Array.from(ys))});

function render(chart, action) {
	return ready(chart, (resolve, reject) => {
		const rendered = event => { if (!event.asyncRenderingPending) resolve(); };
		const disposed = () => reject(new Error('LightningChart was disposed before rendering completed.'));
		chart.instance.engine.addEventListener('renderframe', rendered);
		chart.instance.addEventListener('dispose', disposed);
		return () => {
			chart.instance.engine.removeEventListener('renderframe', rendered);
			chart.instance.removeEventListener('dispose', disposed);
		};
	}, action, chart.timeoutMs);
}

export async function makeChart(input, host, wait) {
	const options = globalThis.benchmarkLightningChartOptions;
	if (typeof options?.license !== 'string' || !options.license.trim())
		throw new Error('LightningChart 9.0.0 requires benchmarkLightningChartOptions.license (a vendor-issued key).');
	if (!globalThis.lcjs) throw new Error('Load @lightningchart/lcjs@9.0.0 before dashboard initialization.');
	const timeoutMs = options.timeoutMs ?? 30000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('LightningChart timeoutMs must be positive and finite.');
	const chart = handle(host, 'LightningChart', false);
	chart.timeoutMs = timeoutMs;
	const {lightningChart, Themes, LegendPosition, AxisTickStrategies, AxisScrollStrategies, SolidLine, SolidFill, ColorHEX} = lcjs;
	try {
		const canvas = chart.canvas = host.ownerDocument.createElement('canvas');
		Object.assign(canvas.style, {position: 'absolute', left: '0px', top: '0px', width: `${WIDTH}px`, height: `${HEIGHT}px`});
		chart.plot.append(canvas);
		// Observe only the supplied native canvas. Do not probe canvases by creating
		// unused contexts, patch global prototypes, or raise the browser context limit.
		const getContext = canvas.getContext;
		canvas.getContext = function(type, ...args) {
			const context = getContext.call(this, type, ...args);
			if (type === 'webgl2' && context && !chart.context) trackGL(chart, context, canvas, true);
			return context;
		};
		chart.cleanups.push(() => { delete canvas.getContext; });
		chart.owner = lightningChart({license: options.license, licenseInformation: options.licenseInformation,
			webgl: {version: 'webgl2'},
			sharedContextOptions: {canvas, noCanvasStyles: true, noCanvasTransform: true, useIndividualCanvas: false},
		});
		chart.instance = chart.owner.ChartXY({container: chart.plot, theme: Themes.light,
			defaultAxisX: {type: 'linear-highPrecision'}, legend: {position: LegendPosition.TopCenter}});
		chart.instance.setAnimationsEnabled(false).setTitle('').setCursorMode('show-all');
		const xAxis = chart.instance.getDefaultAxisX().setTickStrategy(AxisTickStrategies.DateTime).setScrollStrategy(AxisScrollStrategies.fitting);
		const yAxis = chart.instance.getDefaultAxisY().setScrollStrategy(AxisScrollStrategies.fitting);
		for (const axis of [xAxis, yAxis]) axis.setAnimationsEnabled(false);
		await render(chart, () => {
			SERIES.forEach(({label, color}, i) => {
				chart.instance.addLineSeries({xAxis, yAxis,
					schema: {x: {pattern: 'progressive', storage: Float64Array}, y: {pattern: null, storage: Float64Array}},
					autoSortingEnabled: false, allowDataGrouping: true,
				}).setName(label).setStrokeStyle(new SolidLine({thickness: 1, fillStyle: new SolidFill({color: ColorHEX(color)})}))
					.setMaxSampleCount(input.x.length).appendSamples({x: input.x, y: input.ys[i]});
			});
		});
		if (!chart.context) throw new Error('LightningChart did not render with the supplied WebGL2 canvas; no backend fallback is accepted.');
		live(chart);
		done(wait);
		return chart;
	}
	catch (error) { failedCreation(chart, error, destroyChart); }
}

export async function updateChart(chart, input, host, wait) {
	await render(chart, () => chart.instance.getSeries().forEach((line, i) => {
		line.clear();
		line.setMaxSampleCount(input.x.length).appendSamples({x: input.x, y: input.ys[i]});
	}));
	done(wait);
}

export function validateChart(chart, input, {rows}) {
	live(chart);
	const native = chart.instance.getSeries();
	countSeries(native, rows, line => line.getSampleCount());
	native.forEach((line, i) => {
		const {xValues, yValues} = line.readBack();
		if (xValues.length !== rows || yValues.length !== rows) throw new Error('LightningChart native readback length differs from input.');
		valuesEqual(rows, j => xValues[j], j => yValues[j], input.x, input.ys[i]);
	});
	return true;
}

export function destroyChart(chart) { destroy(chart, [() => chart.owner?.dispose()]); }
