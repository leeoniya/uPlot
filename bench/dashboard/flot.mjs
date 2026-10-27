import {WIDTH, HEIGHT, SERIES, prepPairs, assertSeries} from './common.mjs';
export {updateChart} from '../flot.mjs';
export const prepData = prepPairs;

export async function makeChart(input, host, wait) {
	Object.assign(host.style, {width: `${WIDTH}px`, height: `${HEIGHT}px`});
	let complete;
	const ready = new Promise(resolve => { complete = resolve; });
	const chart = $.plot($(host), SERIES.map(({label, color}, i) => ({label, color, data: input[i]})), {
		xaxis: {mode: 'time', timeBase: 'milliseconds'},
		yaxes: [{position: 'left'}],
		series: {lines: {show: true}, points: {show: false}},
		grid: {hoverable: true},
		legend: {noColumns: 5, position: 'nw'},
		hooks: {drawOverlay: [complete]},
	});
	try {
		chart.triggerRedrawOverlay();
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { destroyChart(chart); throw error; }
	finally {
		const hooks = chart.hooks.drawOverlay;
		const index = hooks.indexOf(complete);
		if (index !== -1) hooks.splice(index, 1);
	}
}

export function destroyChart(chart) { chart.destroy(); }

export function validateChart(chart, input, {rows}) {
	const series = chart.getData();
	assertSeries(series.map(s => s.data), rows);
	if (series.some((s, n) => s.data.some((point, i) => point[0] !== input[n][i][0] || point[1] !== input[n][i][1])))
		throw new Error('Flot dashboard source data mismatch.');
	return true;
}
