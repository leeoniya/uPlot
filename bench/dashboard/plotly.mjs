import {WIDTH, HEIGHT, SERIES, prepColumns, assertSeries} from './common.mjs';
import {prepareOwnership, register, collect, render, requireWebGL, destroyWebGL} from './plotly-webgl.mjs';

export function prepareRuntime() {
	prepareOwnership();
}

export const prepData = prepColumns;

function traces(input, type) {
	return SERIES.map(({id, label, color}) => ({
		uid: id, name: label, type, mode: 'lines', x: input.x, y: input[id], yaxis: 'y',
		line: {width: 1 / devicePixelRatio, color},
	}));
}

function layout(input) {
	return {
		width: WIDTH, height: HEIGHT, autosize: false,
		// Default margins leave almost no plot area in a 216px-high tile.
		margin: {l: 40, r: 10, b: 40, t: 40}, transition: {duration: 0},
		xaxis: input.x.length ? {type: 'date', range: [input.x[0], input.x.at(-1)]} : {type: 'date', autorange: true},
		yaxis: {autorange: true},
		showlegend: true, legend: {orientation: 'h', y: 1.02, yanchor: 'bottom'},
	};
}

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {type = 'scattergl'} = {}) {
	const webgl = type === 'scattergl';
	if (webgl) register(host);
	try {
		const create = () => Plotly.newPlot(host, traces(input, type), layout(input), {
			responsive: false, plotGlPixelRatio: devicePixelRatio,
		});
		const chart = await (webgl ? render(host, create) : create());
		if (webgl) requireWebGL(chart);
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyChart(host); }
		finally { throw error; }
	}
}

export async function updateChart(chart, input, host, wait) {
	const type = chart.data[0].type;
	const update = () => Plotly.react(chart, traces(input, type), layout(input));
	if (type === 'scattergl') {
		collect(chart);
		await render(chart, update);
		requireWebGL(chart);
	}
	else await update();
	if (wait) wait.textContent = 'Done!';
}

export function destroyChart(chart) {
	if (!destroyWebGL(chart)) Plotly.purge(chart);
}

export function validateChart(chart, input, {rows}) {
	if (chart.data[0]?.type === 'scattergl') requireWebGL(chart);
	assertSeries(chart.data.map(trace => trace.y), rows);
	assertSeries(chart.data.map(trace => trace.x), rows);
	for (let s = 0; s < SERIES.length; s++) {
		const trace = chart.data[s], {id, label} = SERIES[s];
		if (trace.name !== label || trace.y.some((y, i) => y !== input[id][i] || trace.x[i] !== input.x[i]))
			throw new Error('Plotly dashboard data mismatch.');
	}
	return true;
}
