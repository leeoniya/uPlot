import {WIDTH, HEIGHT, SERIES, assertSeries} from './common.mjs';
import {destroyChart} from '../anychart.mjs';
export {updateChart, destroyChart} from '../anychart.mjs';

export const prepData = frame => frame.x.map((x, i) => [x, ...frame.ys.map(values => values[i])]);

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {sampled = false} = {}) {
	const handle = {chart: null, table: null, mappings: [], scales: []};
	let timer, drawn;
	try {
		const chart = handle.chart = anychart.stock();
		chart.animation(false);
		chart.bounds(0, 0, WIDTH, HEIGHT);
		chart.xScale('scatter');
		if (!sampled) {
			chart.grouping().enabled(false);
			chart.scrollerGrouping().enabled(false);
		}
		chart.scroller().enabled(false);
		const plot = chart.plot(0), scale = anychart.scales.linear();
		handle.scales.push(scale);
		plot.yScale(scale);
		plot.yAxis(0).orientation('left').scale(scale);
		const table = handle.table = anychart.data.table(0);
		table.addData(input);
		SERIES.forEach(({label, color}, i) => {
			const mapping = table.mapAs({value: {column: i + 1, type: 'average'}});
			handle.mappings.push(mapping);
			const series = plot.line(mapping);
			series.name(label);
			series.stroke(color);
			series.yScale(scale);
			for (const state of ['normal', 'hovered', 'selected']) series[state]().markers().enabled(false);
		});
		chart.container(host);
		await new Promise((resolve, reject) => {
			drawn = resolve;
			chart.listenOnce('chartDraw', drawn);
			timer = setTimeout(() => reject(new Error('AnyStock dashboard did not finish drawing within 30 seconds.')), 30000);
			chart.draw();
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
		if (handle.chart && drawn) handle.chart.unlisten('chartDraw', drawn);
	}
}

export function validateChart(handle, input, {rows}) {
	const plot = handle.chart.plot(0);
	if (plot.getSeriesCount() !== SERIES.length) throw new Error('AnyStock dashboard requires five native lines.');
	// A separate ungrouped selection checks source rows even for the sampled variant.
	const values = handle.mappings.map((mapping, s) => {
		if (plot.getSeriesAt(s).name() !== SERIES[s]?.label)
			throw new Error('AnyStock dashboard has the wrong native series.');
		// TableSelectable is a mapping proxy, not a disposable resource in 9.0.0.
		const iterator = mapping.createSelectable().selectAll().getIterator(), values = [];
		while (iterator.advance()) {
			const i = values.length, value = iterator.get('value');
			if (iterator.getKey() !== input[i]?.[0] || value !== input[i]?.[s + 1])
				throw new Error('AnyStock dashboard data differs from its input.');
			values.push(value);
		}
		return values;
	});
	assertSeries(values, rows);
}
