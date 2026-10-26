import {WIDTH, HEIGHT, SERIES, prepPoints, assertSeries} from './common.mjs';

export const prepData = prepPoints;

export function makeChart(input, host, wait) {
	const canvas = host.ownerDocument.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	canvas.style.width = `${WIDTH}px`;
	canvas.style.height = `${HEIGHT}px`;
	host.appendChild(canvas);
	let chart;
	try {
		chart = new Chart(canvas.getContext('2d'), {
			type: 'line',
			data: {datasets: SERIES.map(({label, color}, i) => ({
				label, data: input[i], yAxisID: 'y', borderColor: color,
				borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, fill: false,
			}))},
			options: {
				responsive: false, maintainAspectRatio: false, animation: false,
				parsing: false, normalized: true, spanGaps: true,
				scales: {
					x: {type: 'time', ticks: {maxRotation: 0, autoSkip: true}},
					y: {type: 'linear', position: 'left'},
				},
				plugins: {
					legend: {display: true, labels: {boxWidth: 12, font: {size: 10}}},
					decimation: {enabled: true, algorithm: 'min-max'},
				},
			},
		});
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		(chart ?? Chart.getChart?.(canvas))?.destroy();
		canvas.remove();
		throw error;
	}
}

export function updateChart(chart, input, host, wait) {
	for (let i = 0; i < SERIES.length; i++) chart.data.datasets[i].data = input[i];
	chart.update('none');
	if (wait) wait.textContent = 'Done!';
}

export function destroyChart(chart) {
	const canvas = chart.canvas;
	chart.destroy();
	canvas.remove();
}

export function validateChart(chart, input, {rows}) {
	const datasets = chart.data.datasets;
	assertSeries(datasets.map(series => series.data), rows);
	for (let s = 0; s < SERIES.length; s++) {
		if (datasets[s].label !== SERIES[s].label || datasets[s].data.some((point, i) =>
			point.x !== input[s][i].x || point.y !== input[s][i].y))
			throw new Error('Chart.js dashboard data mismatch.');
	}
	return true;
}
