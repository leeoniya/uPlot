import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(data) {
	return {
		animation: false,
		legend: {show: true, top: 0},
		tooltip: {show: false},
		axisPointer: {show: false},
		grid: {left: 50, right: 20, top: 45, bottom: 40},
		xAxis: {
			type: 'value',
			min: stackDomain.x[0],
			max: stackDomain.x[1],
			interval: 2,
		},
		yAxis: {
			type: 'value',
			min: -stackDomain.y[1],
			max: stackDomain.y[1],
			interval: 4,
		},
		series: stackLayers(data).map(series => ({
			name: series.label,
			type: 'line',
			stack: series.group,
			stackStrategy: 'samesign',
			// Numeric axes stack by index; preserve every aligned sample, including zeros.
			data: Array.from(data[0], (x, j) => [x, series.values[j]]),
			encode: {x: 0, y: 1},
			smooth: false,
			step: false,
			symbol: 'none',
			showSymbol: false,
			itemStyle: {color: series.stroke},
			lineStyle: {color: series.stroke, width: strokeWidth},
			areaStyle: {color: series.stroke, opacity: fillOpacity},
			silent: true,
			cursor: 'default',
			selectedMode: false,
			emphasis: {disabled: true},
		})),
	};
}

export function createDemo(host, data, echarts = globalThis.echarts) {
	if (echarts == null)
		throw new Error('ECharts did not load');

	const plot = echarts.init(host, null, {
		renderer: 'canvas',
		width: stackDimensions.width,
		height: stackDimensions.height,
	});
	plot.setOption(chartOptions(data));

	return {
		plot,
		destroy() {
			plot.dispose();
		},
	};
}
