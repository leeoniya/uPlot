// plotly.js-dist-min@4.1.2/plotly.min.js exposes Plotly (MIT).
function prepData(packed) {
	const fields = packed[0];
	const count = (packed.length - fields - 1) / fields;
	const data = Array.from({length: 4}, () => new Float64Array(count));

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data[0][j] = packed[i] * 60000;
		data[1][j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		data[2][j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		data[3][j] = packed[i + 3];
	}

	return data;
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

function chartTraces(data, type) {
	return ['CPU', 'RAM', 'TCP Out'].map((name, i) => ({
		name,
		type,
		mode: 'lines',
		x: data[0],
		y: data[i + 1],
		yaxis: i === 2 ? 'y2' : 'y',
		line: {width: 1 / devicePixelRatio, color: ['red', 'blue', 'green'][i]},
	}));
}

function chartLayout(data) {
	return {
		title: {text: 'Server Events'},
		width: 1920,
		height: 600,
		margin: {l: 70, r: 80, b: 60, t: 60},
		transition: {duration: 0},
		xaxis: data[0].length
			? {type: 'date', range: [data[0][0], data[0][data[0].length - 1]]}
			: {type: 'date', autorange: true},
		yaxis: {side: 'left', ticksuffix: '%', autorange: true},
		yaxis2: {side: 'right', overlaying: 'y', ticksuffix: ' MB', autorange: true, showgrid: false},
		legend: {orientation: 'h', y: 1.1},
	};
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {type = 'scattergl'} = {}) {
	const traces = chartTraces(data, type);
	try {
		// Await the library's initial draw, not a timer or a browser paint heuristic.
		const chart = await Plotly.newPlot(host, traces, chartLayout(data), {
			responsive: false,
			plotGlPixelRatio: devicePixelRatio,
		});
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyChart(host); }
		finally { throw error; }
	}
}

function makeEmptyChart(host, wait) {
	return makeChartWithOptions([[], [], [], []], host, wait);
}

async function updateChart(chart, input, host, wait) {
	// Keep the original renderer (scattergl or scatter) and replace every column.
	await Plotly.react(chart, chartTraces(input, chart.data[0].type), chartLayout(input));
	if (wait) wait.textContent = 'Done!';
}

function destroyChart(chart) {
	Plotly.purge(chart);
}

export {makeEmptyChart, updateChart};
export {prepData, makeChart, destroyChart, makeChartWithOptions};
