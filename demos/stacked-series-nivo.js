import {stackedSeries, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';
import {mountReact, hasPaths} from './lib/stackedReact.js';

export function chartOptions(raw) {
	// Line stacks every series on one yScale. Each host gets one already-signed stack.
	const negative = raw[1].some(value => value < 0);
	const min = negative ? -stackDomain.y[1] : 0;
	const max = negative ? 0 : stackDomain.y[1];
	const yTicks = Array.from({length: 9}, (_, i) => min + 2 * i);
	return {
		...stackDimensions,
		margin: {top: 40, right: 25, bottom: 40, left: 50},
		data: stackedSeries.map((series, i) => ({
			id: negative ? `−${series.label}` : series.label,
			data: Array.from(raw[0], (x, j) => ({x, y: raw[i + 1][j]})),
		})),
		xScale: {type: 'linear', min: stackDomain.x[0], max: stackDomain.x[1], nice: false, stacked: false},
		yScale: {type: 'linear', min, max, nice: false, stacked: true},
		axisBottom: {tickValues: Array.from({length: 11}, (_, i) => i * 2)},
		axisLeft: {tickValues: yTicks},
		gridXValues: Array.from({length: 11}, (_, i) => i * 2),
		gridYValues: yTicks,
		colors: stackedSeries.map(series => series.stroke),
		curve: 'linear',
		lineWidth: strokeWidth,
		// Native Nivo areas close to zero, not to the preceding stacked series.
		// Default layers paint all fills, then upper-edge strokes, each in D–A order.
		enableArea: true,
		areaBaselineValue: 0,
		areaOpacity: fillOpacity,
		areaBlendMode: 'normal',
		enablePoints: false,
		enablePointLabel: false,
		animate: false,
		isInteractive: false,
		isFocusable: false,
		useMesh: false,
		enableSlices: false,
		enableCrosshair: false,
		enableTouchCrosshair: false,
		legends: [{
			anchor: 'top-left', direction: 'row', translateY: -30,
			itemWidth: 110, itemHeight: 20, symbolSize: 12,
		}],
	};
}

export function buildChart(raw, React, Nivo) {
	return React.createElement(Nivo.Line, chartOptions(raw));
}

export async function createDemo(host, data, Library) {
	const {Nivo} = Library ?? {};
	if (!Nivo?.Line)
		throw new Error('Nivo did not load');

	return mountReact(host, React => buildChart(data, React, Nivo), Library, 'Nivo', element =>
		hasPaths(element, 'svg path[fill-opacity="0.18"]') &&
		hasPaths(element, 'svg path[fill="none"][stroke-width="3"]')
	);
}
