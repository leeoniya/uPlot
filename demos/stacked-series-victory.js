import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';
import {mountReact, hasPaths} from './lib/stackedReact.js';

export function buildChart(raw, React, Victory) {
	const h = React.createElement;
	const layers = stackLayers(raw);
	return h(Victory.VictoryChart, {
		...stackDimensions,
		padding: {top: 50, right: 25, bottom: 40, left: 50},
		domain: {x: [...stackDomain.x], y: [-stackDomain.y[1], stackDomain.y[1]]},
		domainPadding: 0,
		scale: {x: 'linear', y: 'linear'},
		animate: false,
		events: [],
		containerComponent: h(Victory.VictoryContainer, {responsive: false, tabIndex: -1}),
	},
		h(Victory.VictoryAxis, {
			crossAxis: false,
			tickValues: Array.from({length: 11}, (_, i) => i * 2),
			style: {grid: {stroke: 'rgba(0,0,0,0.1)'}},
		}),
		h(Victory.VictoryAxis, {
			dependentAxis: true,
			tickValues: Array.from({length: 9}, (_, i) => (i - 4) * 4),
			style: {grid: {stroke: 'rgba(0,0,0,0.1)'}},
		}),
		// VictoryStack stacks raw children A–D, then paints them in D–A order.
		// Victory 38.1.1 treats zero as nonnegative, even inside the negative stack.
		// Keep its native baseline at those samples rather than synthesizing a y0.
		...['positive', 'negative'].map(group => h(Victory.VictoryStack, {key: group, animate: false, events: []},
			...layers.filter(series => series.group === group).map(series => h(Victory.VictoryArea, {
				key: series.label,
				name: series.label,
				'data-stacked-series': series.label,
				data: Array.from(raw[0], (x, j) => ({x, y: series.values[j]})),
				x: 'x',
				y: 'y',
				interpolation: 'linear',
				animate: false,
				events: [],
				style: {data: {
					stroke: series.stroke,
					strokeWidth,
					strokeOpacity: 1,
					strokeDasharray: 'none',
					opacity: 1,
					fill: series.stroke,
					fillOpacity,
				}},
			})),
		)),
		h(Victory.VictoryLegend, {
			x: 50, y: 8, orientation: 'horizontal', gutter: 16,
			data: layers.map(series => ({name: series.label, symbol: {fill: series.stroke}})),
		}),
	);
}

export async function createDemo(host, data, Library) {
	const {Victory} = Library ?? {};
	if (!['VictoryChart', 'VictoryContainer', 'VictoryAxis', 'VictoryStack', 'VictoryArea', 'VictoryLegend'].every(key => Victory?.[key]))
		throw new Error('Victory did not load');

	return mountReact(host, React => buildChart(data, React, Victory), Library, 'Victory', element =>
		hasPaths(element, 'svg [data-stacked-series] path[style*="stroke: none"]', 8) &&
		hasPaths(element, 'svg [data-stacked-series] path[style*="fill: none"]', 8)
	);
}
