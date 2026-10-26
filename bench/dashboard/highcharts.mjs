import {WIDTH, HEIGHT, SERIES, prepColumns, assertSeries} from './common.mjs';

export function prepData(frame) {
	const columns = prepColumns(frame);
	return SERIES.map(({id}) => ({columns: {x: columns.x, y: columns[id]}}));
}

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export function makeChartWithOptions(input, host, wait, {boost = {}} = {}) {
	return new Promise((resolve, reject) => {
		const rendered = new Set();
		let chart, loaded = false;
		const complete = () => {
			if (loaded && chart.series.every(series => !series.boosted || rendered.has(series))) {
				loaded = false;
				if (wait) wait.textContent = 'Done!';
				resolve(chart);
			}
		};
		try {
			chart = Highcharts.chart(host, {
				chart: {
					type: 'line', width: WIDTH, height: HEIGHT, animation: false,
					events: {load() { chart = this; loaded = true; complete(); }},
				},
				// Native Boost thresholds are intentional: 300 rows may use SVG.
				// Do not label this workload WebGL without runtime backend evidence.
				boost: {useGPUTranslations: false, ...boost},
				title: {text: null}, credits: {enabled: false},
				xAxis: {type: 'datetime'}, yAxis: {title: {text: null}},
				legend: {enabled: true, itemStyle: {fontSize: '10px'}},
				tooltip: {shared: true, animation: false},
				plotOptions: {series: {
					animation: false, lineWidth: 1,
					marker: {enabled: false, states: {hover: {enabled: false}}},
					events: {renderedCanvas() { rendered.add(this); complete(); }},
				}},
				series: SERIES.map(({id, label, color}, i) => ({id, name: label, color, dataTable: input[i], yAxis: 0})),
			});
		}
		catch (error) {
			if (chart) chart.destroy();
			reject(error);
		}
	});
}

export function updateChart(chart, input, host, wait) {
	return new Promise((resolve, reject) => {
		const rendered = new Set(), unbind = [];
		let redrawn = false;
		const cleanup = () => unbind.forEach(remove => remove());
		const complete = () => {
			if (redrawn && chart.series.every(series => !series.boosted || rendered.has(series))) {
				cleanup();
				if (wait) wait.textContent = 'Done!';
				resolve();
			}
		};
		try {
			unbind.push(Highcharts.addEvent(chart, 'destroy', () => {
				cleanup();
				reject(new Error('Highcharts was destroyed before rendering completed.'));
			}));
			for (const series of chart.series) unbind.push(Highcharts.addEvent(series, 'renderedCanvas', () => {
				rendered.add(series);
				complete();
			}));
			for (let i = 0; i < SERIES.length; i++) chart.series[i].setData(input[i], false, false, false);
			chart.redraw(false);
			redrawn = true;
			complete();
		}
		catch (error) { cleanup(); reject(error); }
	});
}

export function destroyChart(chart) {
	chart.destroy();
}

export function validateChart(chart, input, {rows}) {
	const xs = chart.series.map(series => series.getColumn('x'));
	const ys = chart.series.map(series => series.getColumn('y'));
	assertSeries(xs, rows);
	assertSeries(ys, rows);
	for (let s = 0; s < SERIES.length; s++) {
		if (chart.series[s].name !== SERIES[s].label || ys[s].some((y, i) =>
			y !== input[s].columns.y[i] || xs[s][i] !== input[s].columns.x[i]))
			throw new Error('Highcharts dashboard data mismatch.');
	}
	return true;
}
