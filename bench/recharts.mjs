import {hoverTargets, nearHoverIndex, visibleText} from './hover.mjs';
import {prepRows, requireFramework, destroyReact, waitForLines, calendarLabel, title} from './framework-runtime.mjs';

import {mountEmptyReact, mountLifecycleReact, updateReact as updateChart, resizeReact as resizeChart} from './lifecycle-frameworks.mjs';

const hoverScales = new WeakMap();

function HoverScales({React, C, chart, data, width, height}) {
	const x = C.useXAxisScale();
	const percent = C.useYAxisScale('percent');
	const mb = C.useYAxisScale('mb');
	const plot = C.usePlotArea();
	React.useLayoutEffect(() => {
		hoverScales.set(chart, {x, percent, mb, plot, data, width, height});
		return () => { hoverScales.delete(chart); };
	}, [chart, x, percent, mb, plot, data, width, height]);
	return null;
}

function buildChart(data, React, chart, {width, height}) {
	const C = requireFramework('benchmarkRecharts');
	const {scaleTime} = requireFramework('benchmarkD3Scale');
		const h = React.createElement;
		// Recharts 3.10.1 selects data timestamps before scale.ticks() for this
		// time axis. Supply calendar ticks through the public numeric-axis API.
		const ticks = scaleTime().domain(data.length ? [data[0].time, data[data.length - 1].time] : [0, 1]).ticks(12).map(Number);
		return h(React.Fragment, null, title(React),
			h(C.LineChart, {width, height: height - 40, data, margin: {top: 10, right: 25, bottom: 20, left: 20}},
				h(C.CartesianGrid, {stroke: 'rgba(0,0,0,0.1)', vertical: false}),
				h(C.XAxis, {dataKey: 'time', type: 'number', scale: 'time', domain: ['dataMin', 'dataMax'], tickFormatter: calendarLabel, tickCount: 12, ticks}),
				h(C.YAxis, {yAxisId: 'percent', orientation: 'left', domain: ['auto', 'auto'], tickFormatter: value => `${value}%`, width: 65}),
				h(C.YAxis, {yAxisId: 'mb', orientation: 'right', domain: ['auto', 'auto'], tickFormatter: value => `${value} MB`, width: 75}),
				h(C.Legend, {verticalAlign: 'top', height: 30}),
				h(C.Tooltip, {labelFormatter: calendarLabel, isAnimationActive: false}),
				C.useXAxisScale && C.useYAxisScale && C.usePlotArea && h(HoverScales, {React, C, chart, data, width, height: height - 40}),
				...['cpu', 'ram', 'tcp'].map((key, i) => h(C.Line, {
					key, dataKey: key, name: ['CPU', 'RAM', 'TCP Out'][i], yAxisId: i === 2 ? 'mb' : 'percent',
					type: 'linear', stroke: ['red', 'blue', 'green'][i], strokeWidth: 1,
					dot: false, activeDot: false, isAnimationActive: false,
				})),
			));
}

const ready = (chart, data, dimensions, previousPaths) => data.length ? waitForLines(chart, '.recharts-line-curve', previousPaths) : undefined;

function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait);
}

export function makeLifecycleChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait);
}

function makeEmptyChart(host, wait) {
	return mountEmptyReact(host, buildChart, ready, wait);
}

function getHoverPlan(chart, input, host) {
	const scales = hoverScales.get(chart);
	const wrapper = host.querySelector('.recharts-wrapper');
	if (!wrapper || scales?.data !== input || !scales.x || !scales.percent || !scales.mb || !scales.plot)
		throw new Error('Recharts native hover scales are not ready.');
	const rect = wrapper.getBoundingClientRect();
	const sx = rect.width / scales.width, sy = rect.height / scales.height;
	const tolerance = Math.ceil(input.length / (scales.plot.width * sx)) + 1;
	const keys = ['cpu', 'ram', 'tcp'], names = ['CPU', 'RAM', 'TCP Out'];
	return {
		targets: hoverTargets(input.length, (index, s) => ({
			x: rect.left + scales.x(input[index].time) * sx,
			y: rect.top + (s === 2 ? scales.mb : scales.percent)(input[index][keys[s]]) * sy,
		})),
		verify(target) {
			if (hoverScales.get(chart) !== scales) return null;
			const tooltip = wrapper.querySelector('.recharts-tooltip-wrapper');
			if (!visibleText(tooltip)) return null;
			// React 19's current DOM props contain Recharts 3.10.1's native
			// DefaultTooltipContent element. Inspect only during diagnostics;
			// subscribing to tooltip hooks would add per-hover React renders.
			const propsKey = Object.keys(tooltip).find(key => key.startsWith('__reactProps$'));
			const model = tooltip[propsKey]?.children?.props;
			const index = typeof model?.activeIndex === 'string' && /^\d+$/.test(model.activeIndex) ? Number(model.activeIndex) : model?.activeIndex;
			const seriesIndex = target.seriesIndex, key = keys[seriesIndex], name = names[seriesIndex];
			if (model?.active !== true || !nearHoverIndex(index, target, tolerance) || index >= input.length) return null;
			const row = input[index], value = row[key];
			const point = model.payload?.find(point => point.dataKey === key && point.name === name);
			if (point?.payload !== row || point.value !== value || model.label !== row.time ||
				Math.abs(scales.x(row.time) - scales.x(input[target.index].time)) * sx > 1) return null;
			for (const item of tooltip.querySelectorAll('.recharts-tooltip-item')) {
				if (visibleText(item.querySelector('.recharts-tooltip-item-name')) !== name ||
					visibleText(item.querySelector('.recharts-tooltip-item-value')) !== String(value)) continue;
				const text = visibleText(item);
				if (text) return {index, seriesIndex, value, text};
			}
			return null;
		},
	};
}

export {prepRows as prepData, makeChart, destroyReact as destroyChart, makeEmptyChart, updateChart, resizeChart, getHoverPlan};
