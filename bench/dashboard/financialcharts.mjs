import {WIDTH, HEIGHT, SERIES, prepRows} from './common.mjs';
import {requireFramework, destroyReact, calendarLabel, committedReactProps} from '../framework-runtime.mjs';
import {mountLifecycleReact, updateReact as updateChart} from '../lifecycle-frameworks.mjs';

const legendHeight = 28;
function buildChart(data, React, chart, {width, height}) {
	chart.ratio ??= globalThis.devicePixelRatio || 1;
	const C = requireFramework('benchmarkFinancialCharts');
	const {scaleTime} = requireFramework('benchmarkD3Scale');
	const h = React.createElement;
	const xAccessor = row => new Date(row.time);
	return h(React.Fragment, null,
		h('div', {style: {height: legendHeight, display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', fontSize: 11}},
			...SERIES.map(({id, label, color}) => h('span', {key: id, style: {color}}, label))),
		h(C.ChartCanvas, {
			ref: instance => { chart.instance = instance; }, width, height: height - legendHeight,
			ratio: chart.ratio, margin: {left: 40, right: 12, top: 4, bottom: 30},
			data, seriesName: 'dashboard', xScale: scaleTime(), xAccessor,
			xExtents: [xAccessor(data[0]), xAccessor(data[data.length - 1])], plotFull: true,
		},
			h(C.Chart, {id: 1, yExtents: row => SERIES.map(({id}) => row[id])},
				h(C.XAxis, {axisAt: 'bottom', orient: 'bottom', ticks: 4, tickFormat: calendarLabel}),
				h(C.YAxis, {axisAt: 'left', orient: 'left', ticks: 4, showGridLines: true}),
				...SERIES.map(({id, color}) => h(C.LineSeries, {
					key: id, yAccessor: row => row[id], strokeStyle: color, strokeWidth: 1, highlightOnHover: false,
				})),
			),
		),
	);
}

function ready(chart, data, {width, height}) {
	const instance = chart.instance;
	// Canvas drawing runs in the native mount/update lifecycles inside flushSync.
	if (instance?.state.plotData.length !== data.length || instance.state.chartConfigs.length !== 1 ||
		!instance.getCanvasContexts()?.axes || instance.props.width !== width ||
		instance.props.height !== height - legendHeight || instance.props.ratio !== chart.ratio)
		throw new Error('Financial Charts dashboard did not commit its single-axis canvas chart.');
}

export function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait, {width: WIDTH, height: HEIGHT});
}

export function validateChart(chart, input, {rows}) {
	const C = requireFramework('benchmarkFinancialCharts');
	const lines = committedReactProps(chart, C.LineSeries);
	const panels = committedReactProps(chart, C.Chart);
	const legends = committedReactProps(chart, 'span');
	const instance = chart.instance, data = instance?.state.plotData;
	ready(chart, input, {width: WIDTH, height: HEIGHT});
	if (input.length !== rows || data?.length !== rows || lines.length !== SERIES.length || panels.length !== 1 ||
		committedReactProps(chart, C.YAxis).length !== 1 || legends.length !== SERIES.length ||
		SERIES.some(({id, label, color}, s) => lines[s].strokeStyle !== color || legends[s].children !== label ||
			data.some((row, i) => +instance.props.xAccessor(row) !== input[i].time || row[id] !== input[i][id] ||
				lines[s].yAccessor(row) !== input[i][id] || panels[0].yExtents(row)[s] !== input[i][id])))
		throw new Error('Financial Charts dashboard did not commit five complete, current series.');
	return true;
}

export {prepRows as prepData, updateChart, destroyReact as destroyChart};
