import {WIDTH, HEIGHT, SERIES, prepRows} from './common.mjs';
import {requireFramework, destroyReact, waitForLines, calendarLabel, committedReactProps} from '../framework-runtime.mjs';
import {mountLifecycleReact, updateReact as updateChart} from '../lifecycle-frameworks.mjs';

function buildChart(data, React, chart, {width, height}) {
	const C = requireFramework('benchmarkRecharts');
	const {scaleTime} = requireFramework('benchmarkD3Scale');
	const h = React.createElement;
	const ticks = scaleTime().domain([data[0].time, data[data.length - 1].time]).ticks(4).map(Number);
	return h(C.LineChart, {width, height, data, margin: {top: 4, right: 12, bottom: 4, left: 0}},
		h(C.CartesianGrid, {stroke: 'rgba(0,0,0,0.1)', vertical: false}),
		h(C.XAxis, {dataKey: 'time', type: 'number', scale: 'time', domain: ['dataMin', 'dataMax'], ticks, tickFormatter: calendarLabel}),
		h(C.YAxis, {yAxisId: 'value', domain: ['auto', 'auto'], width: 40}),
		h(C.Legend, {verticalAlign: 'top', height: 28, iconSize: 10, wrapperStyle: {fontSize: 11}}),
		...SERIES.map(({id, label, color}) => h(C.Line, {
			key: id, dataKey: id, name: label, yAxisId: 'value', type: 'linear',
			stroke: color, strokeWidth: 1, dot: false, activeDot: false, isAnimationActive: false,
		})),
	);
}

const ready = chart => waitForLines(chart, '.recharts-line-curve', undefined, SERIES.length);
export function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait, {width: WIDTH, height: HEIGHT});
}

export function validateChart(chart, input, {rows}) {
	const C = requireFramework('benchmarkRecharts');
	const surfaces = committedReactProps(chart, C.LineChart);
	const lines = committedReactProps(chart, C.Line);
	const axes = committedReactProps(chart, C.YAxis);
	const paths = [...chart.element.querySelectorAll('.recharts-line-curve')];
	const data = surfaces[0]?.data;
	if (surfaces.length !== 1 || surfaces[0].width !== WIDTH || surfaces[0].height !== HEIGHT ||
		axes.length !== 1 || axes[0].yAxisId !== 'value' || committedReactProps(chart, C.Legend).length !== 1 ||
		input.length !== rows || data?.length !== rows || lines.length !== SERIES.length || paths.length !== SERIES.length ||
		paths.some(path => !/L/.test(path.getAttribute('d')) || /NaN|Infinity/.test(path.getAttribute('d'))) ||
		SERIES.some(({id, label, color}, s) => lines[s].dataKey !== id || lines[s].name !== label ||
			lines[s].stroke !== color || lines[s].yAxisId !== 'value' ||
			data.some((row, i) => row.time !== input[i].time || row[id] !== input[i][id])))
		throw new Error('Recharts dashboard did not commit five complete, current series.');
	return true;
}

export {prepRows as prepData, updateChart, destroyReact as destroyChart};
