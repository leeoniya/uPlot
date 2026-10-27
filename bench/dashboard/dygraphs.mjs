import {WIDTH, HEIGHT, SERIES, assertSeries} from './common.mjs';
export {updateChart} from '../dygraphs.mjs';

export function prepData(frame) {
	return frame.x.map((x, i) => [x, ...frame.ys.map(values => values[i])]);
}

export function makeChart(input, host, wait) {
	const chart = new Dygraph(host, input, {
		width: WIDTH, height: HEIGHT,
		labels: ['Time', ...SERIES.map(s => s.label)], colors: SERIES.map(s => s.color),
		drawPoints: false, highlightCircleSize: 0,
		animatedZooms: false,
		legend: 'always', labelsDivWidth: WIDTH,
		axes: {x: {ticker: Dygraph.dateTicker, axisLabelFormatter: value => new Date(value).toISOString().slice(11, 16)}},
	});
	if (wait) wait.textContent = 'Done!';
	return chart;
}

export function destroyChart(chart) { chart.destroy(); }

export function validateChart(chart, input, {rows}) {
	assertSeries(chart.layout_.setNames.map(() => ({length: chart.numRows()})), rows);
	if (chart.getLabels().length !== 6 || chart.numColumns() !== 6)
		throw new Error('Dygraphs dashboard requires six source columns.');
	for (let i = 0; i < rows; i++)
		for (let s = 0; s < 6; s++)
			if (chart.getValue(i, s) !== input[i][s])
				throw new Error('Dygraphs dashboard source data mismatch.');
	return true;
}
