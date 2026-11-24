import {
	createStackedSeriesData,
	stackedSeries,
	stackDimensions,
	stackDomain,
	strokeWidth,
	fillOpacity,
} from './lib/stackedSeriesData.js';

export function chartOptions(data = createStackedSeriesData()) {
	// Apex stacks all area series together, so the host supplies one sign per chart.
	const negative = data.slice(1).some(row => row.some(value => value < 0));
	return {
		chart: {
			type: 'area',
			renderer: 'svg',
			width: stackDimensions.width,
			height: stackDimensions.height,
			parentHeightOffset: 0,
			redrawOnParentResize: false,
			redrawOnWindowResize: false,
			stacked: true,
			stackType: 'normal',
			stackOnlyBar: false,
			animations: {enabled: false, dynamicAnimation: {enabled: false}},
			toolbar: {show: false},
			zoom: {enabled: false},
			selection: {enabled: false},
			accessibility: {keyboard: {enabled: false}},
			background: 'transparent',
			fontFamily: 'system-ui, sans-serif',
		},
		series: stackedSeries.map((series, seriesIdx) => ({
			name: negative ? `−${series.label}` : series.label,
			data: Array.from(data[0], (x, i) => [x, data[seriesIdx + 1][i]]),
		})),
		colors: stackedSeries.map(series => series.stroke),
		stroke: {show: true, curve: 'straight', width: strokeWidth},
		fill: {type: 'solid', opacity: fillOpacity},
		markers: {size: 0, hover: {size: 0, sizeOffset: 0}},
		dataLabels: {enabled: false},
		legend: {show: true},
		tooltip: {enabled: false},
		states: {
			hover: {filter: {type: 'none'}},
			active: {filter: {type: 'none'}},
		},
		xaxis: {
			type: 'numeric',
			min: stackDomain.x[0],
			max: stackDomain.x[1],
			stepSize: 2,
			tickAmount: (stackDomain.x[1] - stackDomain.x[0]) / 2,
			decimalsInFloat: 0,
			labels: {rotate: 0},
			crosshairs: {show: false},
			tooltip: {enabled: false},
		},
		yaxis: {
			min: negative ? -stackDomain.y[1] : 0,
			max: negative ? 0 : stackDomain.y[1],
			stepSize: 2,
			tickAmount: stackDomain.y[1] / 2,
			forceNiceScale: false,
			decimalsInFloat: 0,
			crosshairs: {show: false},
			tooltip: {enabled: false},
		},
		grid: {
			xaxis: {lines: {show: true}},
			yaxis: {lines: {show: true}},
		},
	};
}

export async function createDemo(host, data = createStackedSeriesData(), Library = globalThis.ApexCharts) {
	if (Library == null)
		throw new Error('ApexCharts did not load');

	const plot = new Library(host, chartOptions(data));
	await plot.render();

	return {
		plot,
		destroy() {
			plot.destroy();
		},
	};
}
