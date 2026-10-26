import {prepRows, requireFramework, destroyReact, waitForLines, calendarLabel, title} from './framework-runtime.mjs';

import {mountEmptyReact, mountLifecycleReact, updateReact as updateChart, resizeReact as resizeChart} from './lifecycle-frameworks.mjs';

function buildChart(data, React, chart, {width, height}) {
	const {LineChart} = requireFramework('benchmarkMuiCharts');
	return React.createElement(React.Fragment, null, title(React),
		React.createElement(LineChart, {
			width, height: height - 40, dataset: data, skipAnimation: true,
			margin: {top: 30, right: 20, bottom: 20, left: 20},
			xAxis: [{id: 'time', dataKey: 'time', scaleType: 'time', valueFormatter: calendarLabel, tickNumber: 12}],
			yAxis: [
				{id: 'percent', position: 'left', scaleType: 'linear', width: 65, valueFormatter: value => `${value}%`},
				{id: 'mb', position: 'right', scaleType: 'linear', width: 75, valueFormatter: value => `${value} MB`},
			],
			series: ['cpu', 'ram', 'tcp'].map((key, i) => ({
				id: key, dataKey: key, label: ['CPU', 'RAM', 'TCP Out'][i], color: ['red', 'blue', 'green'][i],
				yAxisId: i === 2 ? 'mb' : 'percent', curve: 'linear', showMark: false, disableHighlight: true,
			})),
			grid: {horizontal: true},
			slotProps: {
				legend: {direction: 'horizontal', position: {vertical: 'top', horizontal: 'center'}},
				line: {className: 'benchmark-line', style: {strokeWidth: 1}},
			},
		}));
}

const ready = (chart, data, dimensions, previousPaths) => data.length ? waitForLines(chart, '.benchmark-line', previousPaths) : undefined;

function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait);
}

export function makeLifecycleChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait);
}

function makeEmptyChart(host, wait) {
	return mountEmptyReact(host, buildChart, ready, wait);
}

export {prepRows as prepData, makeChart, destroyReact as destroyChart, makeEmptyChart, updateChart, resizeChart};
