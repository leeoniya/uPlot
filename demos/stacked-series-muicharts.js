import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';
import {mountReact, hasPaths} from './lib/stackedReact.js';

const keys = ['A', 'B', 'C', 'D', 'negA', 'negB', 'negC', 'negD'];

export function chartOptions(raw) {
	return {
		width: stackDimensions.width,
		height: stackDimensions.height,
		margin: {top: 20, right: 25, bottom: 20, left: 20},
		xAxis: [{
			id: 'x',
			scaleType: 'linear',
			data: [...raw[0]],
			min: stackDomain.x[0],
			max: stackDomain.x[1],
			domainLimit: 'strict',
			tickInterval: Array.from({length: 11}, (_, i) => i * 2),
		}],
		yAxis: [{
			id: 'y',
			scaleType: 'linear',
			min: -stackDomain.y[1],
			max: stackDomain.y[1],
			domainLimit: 'strict',
			tickInterval: Array.from({length: 9}, (_, i) => (i - 4) * 4),
		}],
		series: stackLayers(raw).map((series, i) => ({
			id: keys[i],
			label: series.label,
			color: series.stroke,
			data: [...series.values],
			xAxisId: 'x',
			yAxisId: 'y',
			area: true,
			stack: series.group,
			stackOrder: 'none',
			stackOffset: 'none',
			curve: 'linear',
			showMark: false,
			disableHighlight: true,
			highlightScope: {highlight: 'none', fade: 'none'},
		})),
		grid: {horizontal: true, vertical: true},
		hideLegend: false,
		skipAnimation: true,
		disableAxisListener: true,
		disableKeyboardNavigation: true,
		disableLineItemHighlight: true,
		axisHighlight: {x: 'none', y: 'none'},
		sx: {pointerEvents: 'none'},
		slotProps: {
			tooltip: {trigger: 'none'},
			// MUI 9.16.0 paints fills D–A, then upper-edge strokes A–D.
			// Keep its round joins and SVG-default butt caps, including at zeros.
			line: {style: {strokeWidth, strokeOpacity: 1, strokeDasharray: 'none', opacity: 1, transition: 'none'}},
			// Remove MUI's default brightness(120%) filter to keep the shared colors.
			area: {style: {fillOpacity, opacity: 1, filter: 'none', transition: 'none'}},
		},
	};
}

export function buildChart(raw, React, MuiCharts) {
	return React.createElement(MuiCharts.LineChart, chartOptions(raw));
}

export async function createDemo(host, data, Library) {
	const {MuiCharts} = Library ?? {};
	if (!MuiCharts?.LineChart)
		throw new Error('MUI X Charts did not load');

	return mountReact(host, React => buildChart(data, React, MuiCharts), Library, 'MUI X Charts',
		element => hasPaths(element, 'path.MuiLineChart-area', keys.length) && hasPaths(element, 'path.MuiLineChart-line', keys.length));
}
