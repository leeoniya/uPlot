import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
import {staticBranding, updateChart, destroyChart} from '../amcharts.mjs';
export {updateChart, destroyChart} from '../amcharts.mjs';
export const prepData = prepRows;

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {sampling = false} = {}) {
	const {am5, am5xy} = globalThis;
	host.style.width = `${WIDTH}px`;
	host.style.height = `${HEIGHT}px`;
	const root = am5.Root.new(host);
	try {
		root.autoResize = false;
		staticBranding(root, am5.registry.version);
		// No Animated theme, appear(), or bullets: the default series is static.
		const chart = root.container.children.push(am5xy.XYChart.new(root, {layout: root.verticalLayout}));
		const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
			baseInterval: {timeUnit: 'minute', count: 1}, groupData: sampling,
			...(sampling ? {groupCount: WIDTH, groupIntervals: [
				{timeUnit: 'minute', count: 1}, {timeUnit: 'minute', count: 10}, {timeUnit: 'hour', count: 1},
			]} : {}),
			interpolationDuration: 0, renderer: am5xy.AxisRendererX.new(root, {}),
		}));
		const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
			interpolationDuration: 0, renderer: am5xy.AxisRendererY.new(root, {}),
		}));
		for (const {id, label, color} of SERIES) {
			const series = chart.series.push(am5xy.LineSeries.new(root, {
				name: label, xAxis, yAxis, valueXField: 'time', valueYField: id,
				stroke: am5.color(color), fill: am5.color(color),
				interpolationDuration: 0, stateAnimationDuration: 0,
				...(sampling ? {valueYGrouped: 'average', minDistance: 1} : {minDistance: 0, exactLocationX: true}),
			}));
			series.strokes.template.setAll({strokeWidth: 1});
		}
		const legend = chart.children.push(am5.Legend.new(root, {}));
		legend.data.setAll(chart.series.values);
		// The existing updater subscribes before ingestion and waits for an idle native frame.
		await updateChart(root, input, host, wait);
		return root;
	}
	catch (error) {
		try { destroyChart(root); }
		finally { throw error; }
	}
}

export function validateChart(root, input, {rows}) {
	const chart = root.container.children.getIndex(0);
	if (chart.yAxes.length !== 1) throw new Error('amCharts dashboard requires one Y axis.');
	assertSeries(chart.series.values.map((series, s) => {
		if (series.get('valueYField') !== SERIES[s]?.id || series.get('yAxis') !== chart.yAxes.getIndex(0))
			throw new Error('amCharts dashboard series has the wrong field or axis.');
		// data.values retains the source rows even when dataItems have been grouped.
		return series.data.values.map((row, i) => {
			if (row.time !== input[i]?.time || row[SERIES[s].id] !== input[i]?.[SERIES[s].id])
				throw new Error('amCharts dashboard data differs from its input.');
			return row[SERIES[s].id];
		});
	}), rows);
}
