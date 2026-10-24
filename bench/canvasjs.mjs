// @canvasjs/charts@3.17.8/canvasjs.min.js exposes CanvasJS; retain its credits.
function prepData(packed) {
	const fields = packed[0];
	const count = (packed.length - fields - 1) / fields;
	const data = Array.from({length: 3}, () => Array(count));

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		const x = packed[i] * 60000;
		data[0][j] = {x, y: Math.round((100 - packed[i + 1]) * 1000) / 1000};
		data[1][j] = {x, y: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100};
		data[2][j] = {x, y: packed[i + 3]};
	}

	return data;
}

function makeChart(data, host, wait) {
	const chart = new CanvasJS.Chart(host, {
		width: 1920,
		height: 600,
		title: {text: 'Server Events'},
		animationEnabled: false,
		zoomEnabled: true,

		axisY: {includeZero: false, suffix: '%'},
		axisY2: {includeZero: false, suffix: ' MB', gridThickness: 0},
		data: ['CPU', 'RAM', 'TCP Out'].map((name, i) => ({
			name,
			showInLegend: true,
			type: 'line',
			xValueType: 'dateTime',
			axisYType: i === 2 ? 'secondary' : 'primary',
			yValueFormatString: i === 2 ? "0.00' MB'" : "0.00'%'",
			color: ['red', 'blue', 'green'][i],
			lineThickness: 1 / devicePixelRatio,
			markerSize: 0,
			dataPoints: data[i],
		})),
	});

	try {
		// With animation disabled, render draws the chart synchronously.
		chart.render();
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyChart(chart); }
		finally { throw error; }
	}
}

function destroyChart(chart) {
	chart.destroy();
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], []], host, wait);
}

function updateChart(chart, input, host, wait) {
	chart.options.data.forEach((series, i) => { series.dataPoints = input[i]; });
	chart.render();
	if (wait) wait.textContent = 'Done!';
	return chart;
}

export {prepData, makeChart, destroyChart, makeEmptyChart, updateChart};
