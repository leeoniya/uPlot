import {WIDTH, HEIGHT, SERIES, prepPairs, assertSeries} from './common.mjs';

export const prepData = prepPairs;
const seriesData = input => SERIES.map(({label}, i) => ({name: label, data: input[i]}));

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {sampling = false} = {}) {
	const chart = new ApexCharts(host, {
		chart: {
			type: 'line', width: WIDTH, height: HEIGHT,
			animations: {enabled: false}, renderer: 'canvas',
			// Retain the original adapter's LTTB budget and activation threshold.
			dataReducer: sampling ? {enabled: true, targetPoints: 1920, threshold: 3840} : {enabled: false},
		},
		series: seriesData(input), colors: SERIES.map(series => series.color),
		dataLabels: {enabled: false}, stroke: {curve: 'straight'},
		markers: {size: 0, hover: {size: 0}},
		xaxis: {type: 'datetime'},
		legend: {position: 'top'},
		tooltip: {shared: !sampling, intersect: false},
	});
	try {
		await chart.render();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		chart.destroy();
		throw error;
	}
}

export async function updateChart(chart, input, host, wait) {
	await chart.updateSeries(seriesData(input), false);
	if (wait) wait.textContent = 'Done!';
}

export function destroyChart(chart) {
	chart.destroy();
}

export function validateChart(chart, input, {rows}) {
	const {series, seriesX} = chart.w.globals;
	assertSeries(series, rows);
	assertSeries(seriesX, rows);
	if (chart.w.config.series.length !== SERIES.length) throw new Error('ApexCharts dashboard series mismatch.');
	for (let s = 0; s < SERIES.length; s++) {
		if (chart.w.config.series[s].name !== SERIES[s].label || series[s].some((y, i) =>
			y !== input[s][i][1] || seriesX[s][i] !== input[s][i][0]))
			throw new Error('ApexCharts dashboard data mismatch.');
	}
	return true;
}
