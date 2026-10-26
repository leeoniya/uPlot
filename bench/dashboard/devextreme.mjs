import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
import {destroyChart} from '../devextreme.mjs';
export {updateChart, destroyChart} from '../devextreme.mjs';

export function prepData(frame) {
	return prepRows(frame).map(row => ({...row, time: new Date(row.time)}));
}

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {sampled = false} = {}) {
	let chart;
	try {
		let complete, fail;
		const ready = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
		ready.catch(() => {});
		chart = new DevExpress.viz.dxChart(host, {
			size: {width: WIDTH, height: HEIGHT}, dataSource: input,
			animation: {enabled: false}, tooltip: {enabled: false},
			dataPrepareSettings: {sortingMethod: false},
			commonSeriesSettings: {
				type: 'line', argumentField: 'time', width: 1 / devicePixelRatio,
				point: {visible: false}, label: {visible: false}, hoverMode: 'none',
				aggregation: sampled ? {enabled: true, method: 'avg'} : {enabled: false},
			},
			series: SERIES.map(({id, label, color}) => ({valueField: id, name: label, color})),
			argumentAxis: {argumentType: 'datetime', type: 'continuous', ...(sampled ? {aggregationGroupWidth: 1} : {})},
			valueAxis: [{}],
			legend: {visible: true, verticalAlignment: 'bottom', horizontalAlignment: 'center', font: {size: 10}, hoverMode: 'none'},
			onInitialized: e => { chart = e.component; },
			onDone: () => complete(),
			onDrawn: () => { if (input.length === 0) complete(); },
			onIncidentOccurred: ({target}) => {
				if (target.id?.startsWith('E')) fail(new Error(`DevExtreme ${target.id}: ${target.text}`));
			},
		});
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) { if (chart) destroyChart(chart); throw error; }
}

export function validateChart(chart, input, {rows}) {
	const data = chart.getDataSource().items();
	// Aggregated points can be fewer than the source rows in the sampled variant.
	assertSeries(chart.getAllSeries().map(() => data), rows);
	if (data.some((row, i) => +row.time !== +input[i].time || SERIES.some(({id}) => row[id] !== input[i][id])))
		throw new Error('DevExtreme dashboard source data mismatch.');
	return true;
}
