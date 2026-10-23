import {prepRows, requireFramework, mountReact, destroyReact, calendarLabel} from './framework-runtime.mjs';

function makeChart(data, host, wait) {
	const C = requireFramework('benchmarkFinancialCharts');
	const {scaleTime} = requireFramework('benchmarkD3Scale');
	return mountReact(host, (React, chart) => {
		const h = React.createElement;
		const xAccessor = row => new Date(row.time);
		return h(React.Fragment, null,
			h('div', {style: {height: 50, textAlign: 'center'}},
				h('div', {style: {height: 25, fontWeight: 'bold'}}, 'Server Events'),
				...['CPU', 'RAM', 'TCP Out'].map((label, i) => h('span', {key: label,
					style: {color: ['red', 'blue', 'green'][i], margin: '0 30px'}}, label))),
			h(C.ChartCanvas, {
				ref: instance => { chart.instance = instance; }, width: 1920, height: 550,
				ratio: globalThis.devicePixelRatio || 1, margin: {left: 75, right: 85, top: 10, bottom: 40},
				data, seriesName: 'Server Events', xScale: scaleTime(), xAccessor,
				xExtents: [xAccessor(data[0]), xAccessor(data[data.length - 1])],
				// Without plotFull the default 2 points/pixel threshold trims history.
				// No discontinuousTimeScaleProvider: calendar gaps keep their real width.
				plotFull: true,
			},
				h(C.Chart, {id: 1, yExtents: row => [row.cpu, row.ram]},
					h(C.XAxis, {axisAt: 'bottom', orient: 'bottom', ticks: 12, tickFormat: calendarLabel}),
					h(C.YAxis, {axisAt: 'left', orient: 'left', ticks: 10, tickFormat: value => `${value}%`, showGridLines: true}),
					h(C.LineSeries, {yAccessor: row => row.cpu, strokeStyle: 'red', strokeWidth: 1, highlightOnHover: false}),
					h(C.LineSeries, {yAccessor: row => row.ram, strokeStyle: 'blue', strokeWidth: 1, highlightOnHover: false})),
				// Two native Chart contexts share the same origin and continuous x scale.
				h(C.Chart, {id: 2, yExtents: row => row.tcp},
					h(C.YAxis, {axisAt: 'right', orient: 'right', ticks: 10, tickFormat: value => `${value} MB`}),
					h(C.LineSeries, {yAccessor: row => row.tcp, strokeStyle: 'green', strokeWidth: 1, highlightOnHover: false})),
			));
	}, chart => {
		// GenericComponent draws on canvas in componentDidMount/DidUpdate,
		// completed by mountReact's flushSync, not a guessed number of frames.
		const instance = chart.instance;
		if (instance?.state.plotData.length !== data.length || instance.state.chartConfigs.length !== 2 ||
			!instance.getCanvasContexts()?.axes)
			throw new Error('Financial Charts did not commit the complete dual-axis canvas chart.');
	}, wait);
}

export {prepRows as prepData, makeChart, destroyReact as destroyChart};
