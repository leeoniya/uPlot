import {prepRows, requireFramework, mountReact, destroyReact, waitForLines, calendarLabel, title} from './framework-runtime.mjs';

function makeChart(data, host, wait) {
	const C = requireFramework('benchmarkRecharts');
	const {scaleTime} = requireFramework('benchmarkD3Scale');
	return mountReact(host, React => {
		const h = React.createElement;
		// Recharts 3.10.1 selects data timestamps before scale.ticks() for this
		// time axis. Supply calendar ticks through the public numeric-axis API.
		const ticks = scaleTime().domain([data[0].time, data[data.length - 1].time]).ticks(12).map(Number);
		return h(React.Fragment, null, title(React),
			h(C.LineChart, {width: 1920, height: 560, data, margin: {top: 10, right: 25, bottom: 20, left: 20}},
				h(C.CartesianGrid, {stroke: 'rgba(0,0,0,0.1)', vertical: false}),
				h(C.XAxis, {dataKey: 'time', type: 'number', scale: 'time', domain: ['dataMin', 'dataMax'], tickFormatter: calendarLabel, tickCount: 12, ticks}),
				h(C.YAxis, {yAxisId: 'percent', orientation: 'left', domain: ['auto', 'auto'], tickFormatter: value => `${value}%`, width: 65}),
				h(C.YAxis, {yAxisId: 'mb', orientation: 'right', domain: ['auto', 'auto'], tickFormatter: value => `${value} MB`, width: 75}),
				h(C.Legend, {verticalAlign: 'top', height: 30}),
				h(C.Tooltip, {labelFormatter: calendarLabel, isAnimationActive: false}),
				...['cpu', 'ram', 'tcp'].map((key, i) => h(C.Line, {
					key, dataKey: key, name: ['CPU', 'RAM', 'TCP Out'][i], yAxisId: i === 2 ? 'mb' : 'percent',
					type: 'linear', stroke: ['red', 'blue', 'green'][i], strokeWidth: 1,
					dot: false, activeDot: false, isAnimationActive: false,
				})),
			));
	}, chart => waitForLines(chart, '.recharts-line-curve'), wait);
}

export {prepRows as prepData, makeChart, destroyReact as destroyChart};
