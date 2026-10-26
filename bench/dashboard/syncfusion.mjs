import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
import {destroyChart} from '../syncfusion.mjs';
export {updateChart, destroyChart} from '../syncfusion.mjs';

export function prepData(frame) {
	return prepRows(frame).map(row => ({...row, time: new Date(row.time)}));
}

export async function makeChart(input, host, wait) {
	let chart;
	try {
		let complete;
		const ready = new Promise(resolve => { complete = resolve; });
		chart = new ej.charts.Chart({
			width: String(WIDTH), height: String(HEIGHT), enableCanvas: true,
			primaryXAxis: {valueType: 'DateTime', rangePadding: 'None'}, primaryYAxis: {},
			tooltip: {enable: false}, crosshair: {enable: false},
			series: SERIES.map(({id, label, color}) => ({
				dataSource: input, xName: 'time', yName: id, name: label,
				type: 'Line', fill: color, width: 1 / devicePixelRatio,
				animation: {enable: false}, marker: {visible: false, dataLabel: {visible: false}},
			})),
			legendSettings: {visible: true, position: 'Bottom', textStyle: {size: '10px'}},
			loaded: () => complete(),
		});
		chart.appendTo(host);
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { if (chart) destroyChart(chart); throw error; }
}

export function validateChart(chart, input, {rows}) {
	const series = chart.visibleSeries;
	assertSeries(series.map(s => s.dataSource), rows);
	if (series.some((s, n) => s.dataSource.some((row, i) => +row.time !== +input[i].time || row[SERIES[n].id] !== input[i][SERIES[n].id])))
		throw new Error('Syncfusion dashboard source data mismatch.');
	return true;
}
