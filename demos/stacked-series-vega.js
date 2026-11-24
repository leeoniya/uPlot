import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(raw) {
	const layers = stackLayers(raw);
	return {
		width: stackDimensions.width,
		height: stackDimensions.height,
		autosize: {type: 'fit', contains: 'padding'},
		padding: 10,
		data: [{
			name: 'table',
			values: layers.flatMap(({label, group, values}, order) => Array.from(raw[0], (x, i) => ({x, series: label, order, group, value: values[i]}))),
			// Vega treats zero as nonnegative, so zeros in the negative group land at y=0.
			transform: [{
				type: 'stack',
				groupby: ['x', 'group'],
				sort: {field: 'order', order: 'ascending'},
				field: 'value',
				offset: 'zero',
				as: ['y0', 'y1'],
			}],
		}],
		scales: [
			{name: 'x', type: 'linear', domain: [...stackDomain.x], range: 'width', nice: false, zero: false},
			{name: 'y', type: 'linear', domain: [-stackDomain.y[1], stackDomain.y[1]], range: 'height', nice: false, zero: false},
			{name: 'color', type: 'ordinal', domain: layers.map(series => series.label), range: layers.map(series => series.stroke)},
		],
		legends: [{fill: 'color', orient: 'bottom', direction: 'horizontal'}],
		axes: [
			{scale: 'x', orient: 'bottom', grid: true, tickCount: 11, format: 'd'},
			{scale: 'y', orient: 'left', grid: true, tickCount: 9, format: 'd'},
		],
		// Each facet paints its fill, then its outer edge. Facets follow the A–D input order.
		marks: [{
			type: 'group',
			interactive: false,
			from: {facet: {name: 'series', data: 'table', groupby: 'series'}},
			marks: [
				{
					type: 'area',
					interactive: false,
					from: {data: 'series'},
					encode: {update: {
						x: {scale: 'x', field: 'x'},
						y: {scale: 'y', field: 'y1'},
						y2: {scale: 'y', field: 'y0'},
						interpolate: {value: 'linear'},
						fill: {scale: 'color', field: 'series'},
						fillOpacity: {value: fillOpacity},
						stroke: {value: null},
					}},
				},
				{
					type: 'line',
					interactive: false,
					from: {data: 'series'},
					encode: {update: {
						x: {scale: 'x', field: 'x'},
						y: {scale: 'y', field: 'y1'},
						interpolate: {value: 'linear'},
						stroke: {scale: 'color', field: 'series'},
						strokeWidth: {value: strokeWidth},
						strokeOpacity: {value: 1},
					}},
				},
			],
		}],
	};
}

export async function createDemo(host, data, Library = globalThis.vega) {
	if (typeof Library?.View !== 'function' || typeof Library?.parse !== 'function' || typeof Library?.logger !== 'function')
		throw new Error('Vega did not load');

	const root = host.ownerDocument.createElement('div');
	host.appendChild(root);
	let plot;
	function destroy() {
		try { plot?.finalize(); }
		finally { root.remove(); }
	}

	try {
		// Vega otherwise logs dataflow errors and can resolve runAsync after a failed render.
		const logger = Library.logger(Library.Warn);
		logger.error = error => { throw error instanceof Error ? error : new Error(String(error)); };
		plot = new Library.View(Library.parse(chartOptions(data)), {renderer: 'canvas', hover: false, logger});
		plot.initialize(root);
		await plot.runAsync();
	}
	catch (error) {
		try { destroy(); }
		finally { throw error; }
	}

	return {plot, destroy};
}
