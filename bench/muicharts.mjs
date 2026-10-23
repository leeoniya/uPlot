import {prepRows, requireFramework, mountReact, destroyReact, waitForLines, calendarLabel, title} from './framework-runtime.mjs';

function makeChart(data, host, wait) {
	const {LineChart} = requireFramework('benchmarkMuiCharts');
	return mountReact(host, React => React.createElement(React.Fragment, null, title(React),
		React.createElement(LineChart, {
			width: 1920, height: 560, dataset: data, skipAnimation: true,
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
		})), chart => waitForLines(chart, '.benchmark-line'), wait);
}

export {prepRows as prepData, makeChart, destroyReact as destroyChart};
