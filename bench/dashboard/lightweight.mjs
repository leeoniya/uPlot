import {WIDTH, HEIGHT, SERIES, nextFrame} from './common.mjs';
import {handle, live, destroy, failedCreation, done, countSeries, valuesEqual} from './custom-common.mjs';

export const prepData = frame => frame.ys.map(values => frame.x.map((x, i) => ({time: x / 1000, value: values[i]})));

export async function makeChart(input, host, wait) {
	if (!globalThis.LightweightCharts) throw new Error('Load LightweightCharts before dashboard initialization.');
	const chart = handle(host, 'Lightweight Charts');
	try {
		chart.instance = LightweightCharts.createChart(chart.plot, {
			width: WIDTH, height: HEIGHT - 24,
			layout: {attributionLogo: true, fontSize: 10},
			leftPriceScale: {visible: true, autoScale: true}, rightPriceScale: {visible: false},
			timeScale: {timeVisible: true, secondsVisible: false, minBarSpacing: 0.0001, enableConflation: true},
		});
		chart.series = SERIES.map(({label, color}) => chart.instance.addSeries(LightweightCharts.LineSeries, {
			title: label, color, lineWidth: 1, priceScaleId: 'left', pointMarkersVisible: false,
			lastPriceAnimation: LightweightCharts.LastPriceAnimationMode.Disabled, priceLineVisible: false,
		}));
		await updateChart(chart, input, host, wait);
		return chart;
	}
	catch (error) { failedCreation(chart, error, destroyChart); }
}

export async function updateChart(chart, input, host, wait) {
	live(chart);
	try {
		chart.series.forEach((series, i) => series.setData(input[i]));
		chart.instance.timeScale().fitContent();
		// No public render-completion event. This follows the queued native draw;
		// it is not a GPU fence or a presentation acknowledgment.
		await Promise.race([nextFrame(), chart.failure]);
		live(chart);
		done(wait);
	}
	catch (error) { chart.fail(error); throw error; }
}

export function validateChart(chart, input, {rows}) {
	live(chart);
	const native = chart.series.map(series => series.data());
	countSeries(native, rows, data => data.length);
	native.forEach((data, i) => valuesEqual(data.length, j => data[j].time, j => data[j].value,
		input[i].map(p => p.time), input[i].map(p => p.value)));
	return true;
}

export function destroyChart(chart) { destroy(chart, [() => chart.instance?.remove()]); }
