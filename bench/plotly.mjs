import {hoverTargets, visibleText, nearHoverIndex} from './hover.mjs';

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
		// Show all series at x; near-zero CPU/TCP lines can share a mouse pixel.
		hovermode: 'x',
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

async function updateChart(chart, input, host, wait) {
	// Keep the original renderer (scattergl or scatter) and replace every column.
	await Plotly.react(chart, chartTraces(input, chart.data[0].type), chartLayout(input));
	if (wait) wait.textContent = 'Done!';
}

export async function resizeChart(chart, {width, height}, host, wait) {
	// Plots.resize skips graphs with both layout dimensions explicitly set.
	await Plotly.relayout(chart, {width, height});
	if (wait) wait.textContent = 'Done!';
}

export function getHoverPlan(chart, input, host) {
	const rect = chart.getBoundingClientRect();
	const layout = chart._fullLayout;
	const sx = rect.width / layout.width, sy = rect.height / layout.height;
	const xAxis = layout.xaxis;
	const length = input[0].length;
	const tolerance = (length - 1) / (Math.abs(xAxis.d2p(input[0][length - 1]) - xAxis.d2p(input[0][0])) * sx);
	return {
		targets: hoverTargets(length, (index, seriesIndex) => {
			const yAxis = seriesIndex === 2 ? layout.yaxis2 : layout.yaxis;
			return {
				x: rect.left + (xAxis._offset + xAxis.d2p(input[0][index])) * sx,
				y: rect.top + (yAxis._offset + yAxis.d2p(input[seriesIndex + 1][index])) * sy,
			};
		}),
		verify(target) {
			const seriesIndex = target.seriesIndex;
			const point = chart._hoverdata?.find(point => point.curveNumber === seriesIndex);
			const index = point?.pointNumber;
			if (!nearHoverIndex(index, target, tolerance) || index < 0 || index >= length) return null;
			const value = input[seriesIndex + 1][index];
			if (point.y !== value || Math.abs(xAxis.d2p(input[0][index]) - xAxis.d2p(input[0][target.index])) * sx > 1) return null;
			for (const label of chart.querySelectorAll('.hoverlayer .hovertext')) {
				// D3 binds the native formatted tooltip model to this SVG group.
				// Check it against _hoverdata AND the rendered text, retaining the
				// library's date, SI-prefix, and precision formatting defaults.
				const model = label.__data__;
				// Date-axis label values use Plotly's converted calendar coordinates.
				const event = model?.eventData?.[0];
				if (event?.curveNumber !== seriesIndex || event.pointNumber !== index || model.yLabelVal !== value || model.xLabelVal !== xAxis.d2c(input[0][index]) || !model.yLabel) continue;
				const text = visibleText(label);
				const nums = visibleText(label.querySelector('.nums'));
				const name = visibleText(label.querySelector('.name'));
				const expected = model.yLabel.replace(/<[^>]*>/g, '');
				if (text && name === ['CPU', 'RAM', 'TCP Out'][seriesIndex] && nums.replace(/\s+/g, '') === expected.replace(/\s+/g, '')) return {index, seriesIndex, value, text};
			}
			return null;
		},
	};
}

function destroyChart(chart) {
	Plotly.purge(chart);
}

export {updateChart};
export {prepData, makeChart, destroyChart, makeChartWithOptions};
