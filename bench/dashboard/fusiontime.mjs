import {WIDTH, HEIGHT, SERIES, assertSeries} from './common.mjs';
import {destroyChart} from '../fusiontime.mjs';
export {updateChart, destroyChart} from '../fusiontime.mjs';

export const prepData = frame => frame.x.map((x, i) => [x, ...frame.ys.map(values => values[i])]);

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {sampled = false} = {}) {
	const handle = {chart: null, store: null};
	let timer;
	const listeners = [];
	try {
		const store = handle.store = new FusionCharts.DataStore();
		// DataStore appends row IDs. Each chart owns its copy, including during updates.
		const table = store.createDataTable(input.map(row => row.slice()), [
			{name: 'Time', type: 'date', format: '%Q'},
			...SERIES.map(({label}) => ({name: label, type: 'number'})),
		], {enableUTC: true});
		const chart = handle.chart = new FusionCharts({
			type: 'timeseries', renderAt: host, width: WIDTH, height: HEIGHT, dataFormat: 'json',
			dataSource: {
				chart: {animation: 0, multiCanvas: false, enableUTC: true, paletteColors: SERIES.map(s => s.color).join(',')},
				data: table,
				xAxis: {plot: 'Time', ...(sampled ? {} : {
					binning: {year: [], month: [], day: [], hour: [], minute: [1], second: [], millisecond: []},
				})},
				yAxis: [{plot: SERIES.map(({label}) => ({value: label, type: 'line', aggregation: 'average'})), orientation: 'left'}],
				plotConfig: {line: {style: {
					line: {'stroke-width': 1 / (globalThis.devicePixelRatio || 1)},
					anchor: {opacity: 0}, 'anchor:hover': {opacity: 0}, 'anchor:highlight': {opacity: 0},
				}}},
				navigator: {enabled: false},
				extensions: {standardRangeSelector: {enabled: false}, customRangeSelector: {enabled: false}},
				legend: {enabled: true, position: 'bottom'},
			},
		});
		await new Promise((resolve, reject) => {
			const on = (name, fn) => { listeners.push([name, fn]); chart.addEventListener(name, fn); };
			on('renderComplete', resolve);
			for (const name of ['dataInvalid', 'dataLoadError'])
				on(name, (event, detail) => reject(new Error(`FusionTime ${name}: ${detail?.error?.message ?? detail?.message ?? 'dashboard initialization failed'}`)));
			timer = setTimeout(() => reject(new Error('FusionTime dashboard did not finish rendering within 30 seconds.')), 30000);
			chart.render();
		});
		if (wait) wait.textContent = 'Done!';
		return handle;
	}
	catch (error) {
		try { destroyChart(handle); }
		finally { throw error; }
	}
	finally {
		clearTimeout(timer);
		if (handle.chart) for (const [name, fn] of listeners) handle.chart.removeEventListener(name, fn);
	}
}

export function validateChart(handle, input, {rows}) {
	// FusionCharts normalizes configuration keys to lowercase in getJSONData().
	const source = handle.chart.getJSONData(), axes = source.yaxis;
	if (!Array.isArray(axes) || axes.length !== 1 || !Array.isArray(axes[0].plot) || axes[0].plot.length !== SERIES.length ||
		axes[0].plot.some((plot, i) => plot.type !== 'line' || plot.value !== SERIES[i].label))
		throw new Error('FusionTime dashboard requires five native lines on one Y axis.');
	const data = handle.store.getDataTable().getData().data;
	assertSeries(SERIES.map((_, s) => data.map((row, i) => {
		if (row[0] !== input[i]?.[0] || row[s + 1] !== input[i]?.[s + 1])
			throw new Error('FusionTime dashboard data differs from its input.');
		return row[s + 1];
	})), rows);
}
