import {stackLayers, stackDimensions, stackDomain, strokeWidth} from './lib/stackedSeriesData.js';

export function chartOptions(data) {
	const layers = stackLayers(data);
	return {
		type: 'line',
		data: {
			// Keep A–D stack order; Chart.js natively paints datasets in reverse.
			datasets: layers.map((series, i) => ({
				label: series.label,
				data: Array.from(data[0], (x, j) => ({x, y: series.values[j]})),
				stack: series.group,
				borderColor: series.stroke,
				backgroundColor: series.fill,
				borderWidth: strokeWidth,
				fill: layers[i - 1]?.group === series.group ? '-1' : 'origin',
				tension: 0,
				stepped: false,
				pointRadius: 0,
				pointHoverRadius: 0,
			})),
		},
		options: {
			responsive: false,
			maintainAspectRatio: false,
			animation: false,
			events: [],
			scales: {
				x: {
					type: 'linear',
					min: stackDomain.x[0],
					max: stackDomain.x[1],
					ticks: {stepSize: 2, autoSkip: false, maxRotation: 0},
				},
				y: {
					type: 'linear',
					stacked: true,
					min: -stackDomain.y[1],
					max: stackDomain.y[1],
					ticks: {stepSize: 4, autoSkip: false},
				},
			},
			plugins: {
				legend: {display: true},
				tooltip: {enabled: false},
			},
		},
	};
}

export function createDemo(host, data, Chart = globalThis.Chart) {
	if (Chart == null)
		throw new Error('Chart.js did not load');

	const canvas = host.ownerDocument.createElement('canvas');
	canvas.width = stackDimensions.width;
	canvas.height = stackDimensions.height;
	host.appendChild(canvas);
	const plot = new Chart(canvas, chartOptions(data));

	return {
		plot,
		destroy() {
			plot.destroy();
			canvas.remove();
		},
	};
}
