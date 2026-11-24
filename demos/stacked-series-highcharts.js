import {
	createStackedSeriesData,
	stackLayers,
	stackDimensions,
	stackDomain,
	strokeWidth,
	fillOpacity,
} from './lib/stackedSeriesData.js';

export function chartOptions(data = createStackedSeriesData()) {
	return {
		chart: {
			type: 'area',
			width: stackDimensions.width,
			height: stackDimensions.height,
			animation: false,
			reflow: false,
			panning: {enabled: false},
			zooming: {type: undefined, pinchType: undefined, mouseWheel: {enabled: false}},
			backgroundColor: 'transparent',
			style: {fontFamily: 'system-ui, sans-serif'},
		},
		title: {text: null},
		legend: {enabled: true},
		tooltip: {enabled: false},
		xAxis: {
			type: 'linear',
			min: stackDomain.x[0],
			max: stackDomain.x[1],
			tickInterval: 2,
			startOnTick: false,
			endOnTick: false,
			minPadding: 0,
			maxPadding: 0,
			gridLineWidth: 1,
			crosshair: false,
			title: {text: null},
		},
		yAxis: {
			type: 'linear',
			min: -stackDomain.y[1],
			max: stackDomain.y[1],
			tickInterval: 4,
			startOnTick: false,
			endOnTick: false,
			minPadding: 0,
			maxPadding: 0,
			reversedStacks: false,
			gridLineWidth: 1,
			crosshair: false,
			title: {text: null},
		},
		plotOptions: {
			series: {
				animation: false,
				enableMouseTracking: false,
				allowPointSelect: false,
				marker: {enabled: false, states: {hover: {enabled: false}}},
				dataLabels: {enabled: false},
				states: {
					hover: {enabled: false},
					inactive: {enabled: false, opacity: 1},
				},
			},
			area: {
				stacking: 'normal',
				lineWidth: strokeWidth,
				fillOpacity,
				step: false,
			},
		},
		series: stackLayers(data).map(series => ({
			stack: series.group,
			name: series.label,
			color: series.stroke,
			data: Array.from(data[0], (x, i) => [x, series.values[i]]),
		})),
	};
}

export function createDemo(host, data = createStackedSeriesData(), Library = globalThis.Highcharts) {
	if (Library == null)
		throw new Error('Highcharts did not load');

	const plot = Library.chart(host, chartOptions(data));

	return {
		plot,
		destroy() {
			plot.destroy();
		},
	};
}
