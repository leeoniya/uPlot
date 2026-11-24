import {stackedSeries, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(raw) {
	// CanvasJS 3.17.8 renderStackedArea accumulates one offset per x, not one per sign.
	// The comparison mounts this adapter once for each already-signed set of rows.
	const negative = raw.slice(1).some(row => row.some(y => y < 0));
	const limit = stackDomain.y[1];
	return {
		width: stackDimensions.width,
		height: stackDimensions.height,
		animationEnabled: false,
		interactivityEnabled: false,
		zoomEnabled: false,
		exportEnabled: false,
		toolTip: {enabled: false},
		axisX: {minimum: stackDomain.x[0], maximum: stackDomain.x[1], interval: 2, gridThickness: 1},
		axisY: {minimum: negative ? -limit : 0, maximum: negative ? 0 : limit, interval: 2, gridThickness: 1},
		data: stackedSeries.map((series, i) => ({
			name: negative ? `−${series.label}` : series.label,
			type: 'stackedArea',
			xValueType: 'number',
			color: series.stroke,
			lineColor: series.stroke,
			lineThickness: strokeWidth,
			lineDashType: 'solid',
			fillOpacity,
			markerSize: 0,
			highlightEnabled: false,
			showInLegend: true,
			dataPoints: Array.from(raw[0], (x, j) => ({x, y: raw[i + 1][j]})),
		})),
	};
}

export async function createDemo(host, data, Library = globalThis.CanvasJS) {
	if (typeof Library?.Chart !== 'function')
		throw new Error('CanvasJS did not load');

	const root = host.ownerDocument.createElement('div');
	host.appendChild(root);
	let plot;
	function destroy() {
		try { plot?.destroy(); }
		finally { root.remove(); }
	}

	try {
		// Keep the default credit link required by @canvasjs/charts@3.17.8/LICENSE.
		plot = new Library.Chart(root, chartOptions(data));
		// In 3.17.8 render() completes the Canvas draw synchronously when animation is disabled.
		plot.render();
	}
	catch (error) {
		try { destroy(); }
		finally { throw error; }
	}

	return {plot, destroy};
}
