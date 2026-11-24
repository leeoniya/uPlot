import {stackLayers, stackedSeries, stackDimensions, strokeWidth} from './lib/stackedSeriesData.js';

export function chartOptions(data) {
	return {
		...stackDimensions,
		stack: {groups: [1, -1].map((dir, group) => ({
			series: stackedSeries.map((_, i) => group * stackedSeries.length + i + 1),
			dir,
		}))},
		scales: {
			x: {time: false},
			y: {axis: 1, range: {min: {pad: 0}, max: {pad: 0}}},
		},
		series: [{}, ...[1, -1].flatMap(dir => stackedSeries.map(series => ({
			...series,
			label: dir === 1 ? series.label : `−${series.label}`,
			width: strokeWidth,
			points: {show: false},
		})))],
	};
}

export function createDemo(host, data, Library = globalThis.uPlot) {
	if (Library == null)
		throw new Error('uPlot did not load');
	const mirrored = [data[0].slice(), ...stackLayers(data).map(layer => layer.values)];
	const plot = new Library(chartOptions(data), mirrored, host);
	return {plot, destroy: () => plot.destroy()};
}
