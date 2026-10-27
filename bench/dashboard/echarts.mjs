import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
export {updateChart} from '../echarts.mjs';
export const prepData = prepRows;

export function makeChart(input, host, wait) {
	const chart = echarts.init(host, null, {width: WIDTH, height: HEIGHT, devicePixelRatio, renderer: 'canvas'});
	try {
		chart.setOption({
			animation: false,
			dataset: {source: input, dimensions: ['time', ...SERIES.map(s => s.id)]},
			tooltip: {trigger: 'axis', confine: true},
			legend: {},
			xAxis: {type: 'time'}, yAxis: {type: 'value'},
			series: SERIES.map(({id, label, color}) => ({
				id, name: label, type: 'line', showSymbol: false,
				sampling: 'minmax', lineStyle: {color}, itemStyle: {color},
				encode: {x: 'time', y: id},
			})),
		}, {notMerge: true});
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { chart.dispose(); throw error; }
}

export function destroyChart(chart) { chart.dispose(); }

export function validateChart(chart, input, {rows}) {
	const series = chart.getModel().getSeries();
	assertSeries(series.map(s => ({length: s.getRawData().count()})), rows);
	for (let s = 0; s < series.length; s++) {
		const data = series[s].getRawData();
		for (let i = 0; i < rows; i++)
			if (data.get('time', i) !== input[i].time || data.get(SERIES[s].id, i) !== input[i][SERIES[s].id])
				throw new Error('ECharts dashboard source data mismatch.');
	}
	return true;
}
