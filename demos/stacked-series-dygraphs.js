import {stackedSeries, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(raw) {
	// dygraphs stacks the last input column first. Reverse the raw columns,
	// labels, and colors so A stays nearest zero on either side.
	const order = [4, 3, 2, 1];
	// stackedGraph uses one running total per axis, so each host gets one sign.
	const negative = raw.slice(1).some(values => values.some(value => value < 0));
	return {
		data: Array.from(raw[0], (x, i) => [x, ...order.map(column => raw[column][i])]),
		options: {
			...stackDimensions,
			labels: ['X', ...order.map(column => (negative ? '−' : '') + stackedSeries[column - 1].label)],
			colors: order.map(column => stackedSeries[column - 1].stroke),
			stackedGraph: true,
			fillGraph: true,
			fillAlpha: fillOpacity,
			strokeWidth,
			strokePattern: null,
			stepPlot: false,
			dateWindow: stackDomain.x.slice(),
			valueRange: negative ? [-stackDomain.y[1], 0] : [0, stackDomain.y[1]],
			xRangePad: 0,
			yRangePad: 0,
			drawPoints: false,
			pointSize: 0,
			highlightCircleSize: 0,
			legend: 'always',
			showRoller: false,
			showRangeSelector: false,
			animatedZooms: false,
			interactionModel: {},
		},
	};
}

export async function createDemo(host, data, Library = globalThis.Dygraph) {
	if (typeof Library !== 'function')
		throw new Error('dygraphs did not load');

	const config = chartOptions(data);
	const plot = new Library(host, config.data, config.options);
	try {
		await new Promise(resolve => plot.ready(resolve));
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
