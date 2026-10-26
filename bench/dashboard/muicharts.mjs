import {WIDTH, HEIGHT, SERIES, prepRows} from './common.mjs';
import {requireFramework, destroyReact, waitForLines, calendarLabel, committedReactProps} from '../framework-runtime.mjs';
import {mountLifecycleReact, updateReact as updateChart} from '../lifecycle-frameworks.mjs';

function buildChart(data, React, chart, {width, height}) {
	const {LineChart} = requireFramework('benchmarkMuiCharts');
	return React.createElement(LineChart, {
		width, height, dataset: data, skipAnimation: true,
		margin: {top: 32, right: 12, bottom: 4, left: 4},
		xAxis: [{id: 'time', dataKey: 'time', scaleType: 'time', valueFormatter: calendarLabel, tickNumber: 4}],
		yAxis: [{id: 'value', position: 'left', scaleType: 'linear', width: 36}],
		series: SERIES.map(({id, label, color}) => ({
			id, dataKey: id, label, color, yAxisId: 'value', curve: 'linear', showMark: false, disableHighlight: true,
		})),
		grid: {horizontal: true},
		slotProps: {
			legend: {direction: 'horizontal', position: {vertical: 'top', horizontal: 'center'}, sx: {fontSize: 11, gap: 1}},
			line: {className: 'dashboard-line', style: {strokeWidth: 1}},
		},
	});
}

const ready = chart => waitForLines(chart, '.dashboard-line', undefined, SERIES.length);
export function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait, {width: WIDTH, height: HEIGHT});
}

export function validateChart(chart, input, {rows}) {
	const surfaces = committedReactProps(chart, requireFramework('benchmarkMuiCharts').LineChart);
	const props = surfaces[0];
	const paths = [...chart.element.querySelectorAll('.dashboard-line')];
	if (surfaces.length !== 1 || props.width !== WIDTH || props.height !== HEIGHT ||
		props.yAxis.length !== 1 || props.yAxis[0].id !== 'value' || props.hideLegend === true ||
		props.xAxis[0].dataKey !== 'time' || input.length !== rows || props.dataset?.length !== rows ||
		props.series.length !== SERIES.length || paths.length !== SERIES.length ||
		paths.some(path => !/L/.test(path.getAttribute('d')) || /NaN|Infinity/.test(path.getAttribute('d'))) ||
		SERIES.some(({id, label, color}, s) => props.series[s].id !== id || props.series[s].dataKey !== id ||
			props.series[s].label !== label || props.series[s].color !== color || props.series[s].yAxisId !== 'value' ||
			props.dataset.some((row, i) => row.time !== input[i].time || row[id] !== input[i][id])))
		throw new Error('MUI Charts dashboard did not commit five complete, current series.');
	return true;
}

export {prepRows as prepData, updateChart, destroyReact as destroyChart};
