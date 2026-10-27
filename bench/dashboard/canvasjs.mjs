import {WIDTH, HEIGHT, SERIES, prepPoints, assertSeries} from './common.mjs';
import {destroyChart} from '../canvasjs.mjs';
export {updateChart, destroyChart} from '../canvasjs.mjs';
export const prepData = prepPoints;

export function makeChart(input, host, wait) {
	const chart = new CanvasJS.Chart(host, {
		width: WIDTH, height: HEIGHT,
		animationEnabled: false,
		legend: {verticalAlign: 'top'},
		data: SERIES.map(({label, color}, i) => ({
			name: label, color, showInLegend: true, type: 'line', xValueType: 'dateTime',
			markerSize: 0, dataPoints: input[i],
		})),
	});
	try {
		chart.render();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { destroyChart(chart); throw error; }
}

export function validateChart(chart, input, {rows}) {
	assertSeries(chart.data.map(s => s.dataPoints), rows);
	if (chart.data.some((s, n) => s.dataPoints.some((point, i) => point.x !== input[n][i].x || point.y !== input[n][i].y)))
		throw new Error('CanvasJS dashboard source data mismatch.');
	return true;
}
