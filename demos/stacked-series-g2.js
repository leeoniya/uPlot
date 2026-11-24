import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(raw) {
	const layers = stackLayers(raw);
	const limit = stackDomain.y[1];
	return {
		type: 'view',
		width: stackDimensions.width,
		height: stackDimensions.height,
		autoFit: false,
		// G2 assigns zero to the nonnegative accumulator, even in the negative stack.
		children: ['positive', 'negative'].map(group => ({
			type: 'area',
			data: layers.filter(layer => layer.group === group).flatMap(({label, values}) =>
				Array.from(raw[0], (x, i) => ({x, series: label, value: values[i]}))),
			encode: {x: 'x', y: 'value', color: 'series', series: 'series'},
			// stackY accumulates strictly negative rows in reverse order. Reverse
			// that group first so A stays nearest zero without reordering the marks.
			transform: [{type: 'stackY', reverse: group === 'negative'}],
			style: {lineWidth: strokeWidth, strokeOpacity: 1, fillOpacity},
			animate: false,
		})),
		scale: {
			x: {type: 'linear', domain: [...stackDomain.x], nice: false, tickCount: 11},
			y: {type: 'linear', domain: [-limit, limit], nice: false, tickCount: 9},
			color: {type: 'ordinal', domain: layers.map(series => series.label), range: layers.map(series => series.stroke)},
		},
		axis: {x: {title: false, grid: true}, y: {title: false, grid: true}},
		legend: {color: {position: 'bottom', title: false}},
		animate: false,
		// Disable all default interactions in G2 5.4.8, including event forwarding.
		interaction: {event: false, tooltip: false, sliderFilter: false, legendFilter: false, scrollbarFilter: false},
	};
}

export async function createDemo(host, data, Library = globalThis.G2) {
	if (typeof Library?.Chart !== 'function')
		throw new Error('AntV G2 did not load');

	const root = host.ownerDocument.createElement('div');
	host.appendChild(root);
	let plot;
	function destroy() {
		try { plot?.destroy(); }
		finally { root.remove(); }
	}

	try {
		plot = new Library.Chart({container: root});
		plot.options(chartOptions(data));
		await plot.render();
	}
	catch (error) {
		try { destroy(); }
		finally { throw error; }
	}

	return {plot, destroy};
}
