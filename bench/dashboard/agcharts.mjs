import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
import {destroyChart} from '../agcharts.mjs';
export {updateChart, destroyChart} from '../agcharts.mjs';
export const prepData = prepRows;

export async function makeChart(input, host, wait) {
	let chart;
	try {
		chart = agCharts.AgCharts.create({
			container: host, width: WIDTH, height: HEIGHT,
			data: input, tooltip: {enabled: false},
			// Community has no animation module; retain native line aggregation.
			series: SERIES.map(({id, label, color}) => ({
				type: 'line', xKey: 'time', xKeyAxis: 'x', yKey: id, yKeyAxis: 'y',
				yName: label, stroke: color, strokeWidth: 1 / devicePixelRatio,
				marker: {enabled: false}, label: {enabled: false},
			})),
			axes: {x: {type: 'time', position: 'bottom', nice: false}, y: {type: 'number', position: 'left'}},
			legend: {enabled: true, position: 'bottom', item: {label: {fontSize: 10}, paddingX: 8}},
		});
		await chart.waitForUpdate();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { if (chart) destroyChart(chart); throw error; }
}

export function validateChart(chart, input, {rows}) {
	const data = chart.getOptions().data;
	// The 14.2.0 public proxy exposes the native chart here. Do not count options.series.
	assertSeries(chart.chart.series.map(() => data), rows);
	if (data.some((row, i) => +row.time !== +input[i].time || SERIES.some(({id}) => row[id] !== input[i][id])))
		throw new Error('AG Charts dashboard source data mismatch.');
	return true;
}
