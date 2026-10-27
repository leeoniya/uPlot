import {WIDTH, HEIGHT, SERIES, prepPairs, assertSeries} from './common.mjs';
import {destroyChart} from '../kendo.mjs';
export {updateChart, destroyChart} from '../kendo.mjs';

export function prepData(frame) {
	return prepPairs(frame).map(points => points.map(([x, y]) => [new Date(x), y]));
}

export async function makeChart(input, host, wait) {
	let chart;
	try {
		let complete;
		const ready = new Promise(resolve => { complete = resolve; });
		chart = new kendo.dataviz.ui.Chart(host, {
			chartArea: {width: WIDTH, height: HEIGHT}, renderAs: 'canvas', transitions: false,
			tooltip: {visible: true},
			seriesDefaults: {type: 'scatterLine', markers: {visible: false}},
			series: SERIES.map(({label, color}, i) => ({name: label, color, data: input[i]})),
			xAxis: {type: 'date'},
			legend: {position: 'top'},
			render: e => { chart = e.sender; complete(); },
		});
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { if (chart) destroyChart(chart); throw error; }
}

export function validateChart(chart, input, {rows}) {
	const series = chart._plotArea.series;
	assertSeries(series.map(s => s.data), rows);
	if (series.some((s, n) => s.data.some((point, i) => +point[0] !== +input[n][i][0] || point[1] !== input[n][i][1])))
		throw new Error('Kendo dashboard source data mismatch.');
	return true;
}
