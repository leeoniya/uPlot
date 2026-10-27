import {WIDTH, HEIGHT, SERIES, assertSeries} from './common.mjs';
export {updateChart} from '../uplot.mjs';

const legendHeight = 48;

export function prepData(frame) {
	return [frame.x.map(x => x / 1000), ...frame.ys.map(values => [...values])];
}

export async function makeChart(input, host, wait, UPlot = globalThis.uPlot) {
	let complete;
	const ready = new Promise(resolve => { complete = resolve; });
	const chart = new UPlot({
		hooks: {ready: [() => complete()]},
		width: WIDTH, height: HEIGHT - legendHeight,
		legend: {side: 0},
		series: [{}, ...SERIES.map(({label, color}) => ({label, stroke: color}))],

	}, input, host);
	try {
		// Local uPlot creates its legend during the queued initial commit.
		await ready;

		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyChart(chart); }
		finally { throw error; }
	}
}

export function destroyChart(chart) { chart.destroy(); }

export function validateChart(chart, input, {rows}) {
	assertSeries(chart.series.slice(1).map((_, i) => chart.data[i + 1]), rows);
	if (chart.data.length !== 6 || chart.data[0].length !== rows ||
		chart.data.some((values, s) => values.some((value, i) => value !== input[s][i])))
		throw new Error('uPlot dashboard source data mismatch.');
	return true;
}
