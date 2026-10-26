import {WIDTH, HEIGHT, SERIES, assertSeries} from './common.mjs';
export {updateChart} from '../uplot.mjs';

export function prepData(frame) {
	return [frame.x.map(x => x / 1000), ...frame.ys.map(values => [...values])];
}

export async function makeChart(input, host, wait, UPlot = globalThis.uPlot) {
	let complete;
	const ready = new Promise(resolve => { complete = resolve; });
	const chart = new UPlot({
		hooks: {ready: [() => complete()]},
		width: WIDTH, height: HEIGHT,
		cache: {paths: false},
		cursor: {show: false}, select: {show: false},
		legend: {show: true, live: false},
		padding: [28, 8, 0, 0],
		series: [{}, ...SERIES.map(({label, color}) => ({
			label, stroke: color, width: 1 / devicePixelRatio, points: {show: false},
		}))],
		axes: [{size: 32, font: '10px sans-serif'}, {size: 40, font: '10px sans-serif'}],
	}, input, host);
	try {
		// Local uPlot creates its legend during the queued initial commit.
		await ready;
		// Keep the native legend inside the fixed-size tile without scaling the canvas.
		const legend = chart.root.querySelector('.u-legend');
		if (!legend) throw new Error('uPlot dashboard legend is missing after native readiness.');
		Object.assign(legend.style, {position: 'absolute', top: '0', left: '0', width: `${WIDTH}px`, fontSize: '10px'});
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
