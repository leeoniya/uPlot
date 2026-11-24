import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(raw) {
	const layers = stackLayers(raw);
	return {
		width: stackDimensions.width,
		height: stackDimensions.height,
		data: Array.from(raw[0], (x, i) => ({x, ...Object.fromEntries(layers.map(layer => [layer.label, layer.values[i]]))})),
		series: layers.map(series => ({
			type: 'area',
			xKey: 'x',
			xKeyAxis: 'x',
			yKey: series.label,
			yKeyAxis: 'y',
			yName: series.label,
			stacked: true,
			stackGroup: series.group,
			stroke: series.stroke,
			strokeWidth,
			fill: series.stroke,
			fillOpacity,
			interpolation: {type: 'linear'},
			marker: {enabled: false},
			label: {enabled: false},
		})),
		axes: {
			x: {
				type: 'number',
				position: 'bottom',
				min: stackDomain.x[0],
				max: stackDomain.x[1],
				nice: false,
				interval: {step: 2},
				gridLine: {enabled: true},
			},
			y: {
				type: 'number',
				position: 'left',
				min: -stackDomain.y[1],
				max: stackDomain.y[1],
				nice: false,
				interval: {step: 2},
				gridLine: {enabled: true},
			},
		},
		animation: {enabled: false},
		legend: {enabled: true, toggleSeries: false},
		tooltip: {enabled: false},
		highlight: {enabled: false},
		keyboard: {enabled: false},
		zoom: {enabled: false},
	};
}

export async function createDemo(host, data, Library = globalThis.agCharts) {
	if (typeof Library?.AgCharts?.create !== 'function')
		throw new Error('AG Charts Community did not load');

	const plot = Library.AgCharts.create({container: host, ...chartOptions(data)});
	try {
		await plot.waitForUpdate();
	}
	catch (error) {
		try { plot.destroy(); }
		finally { throw error; }
	}

	return {
		plot,
		destroy() {
			plot.destroy();
		},
	};
}
