import {hoverTargets, visibleText, nearHoverIndex} from './hover.mjs';

function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const x = new Float64Array(count);
	const cpu = new Float64Array(count);
	const ram = new Float64Array(count);
	const tcp = new Float64Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		x[j] = packed[i] * 60 * 1000;
		cpu[j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		ram[j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		tcp[j] = packed[i + 3];
	}

	// Highcharts 13.1.1 Boost line tooltips read series.options.data, not table y values.
	// For working shared tooltips with Boost active, return pairs instead:
	// return [cpu, ram, tcp].map(y => Array.from(x, (x, i) => [x, y[i]]));
	// Then pass each series {data: data[i]}, not {dataTable: data[i]}.
	// Keep tables here to avoid the extra per-point array allocations.
	return [cpu, ram, tcp].map(y => ({columns: {x, y}}));
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

function makeChartWithOptions(data, host, wait, runtimeOptions, {boost = {}} = {}) {
	return new Promise((resolve, reject) => {
		const rendered = new Set();
		let loaded = false;
		let chart;

		function complete() {
			if (loaded && chart.series.every(series => !series.boosted || rendered.has(series))) {
				if (wait) wait.textContent = 'Done!';
				resolve(chart);
			}
		}

		try {
			chart = Highcharts.chart(host, {
				chart: {
					type: 'line',
					width: 1920,
					height: 600,
					animation: false,
					zooming: {type: 'x'},
					events: {
						load() {
							// Boost's load handler (order -1) paints the shared canvas first.
							chart = this;
							loaded = true;
							complete();
						},
					},
				},
				boost: {
					// Float32 GPU translations lose small increments in epoch milliseconds.
					useGPUTranslations: false,
					...boost,
				},
				title: {text: 'Server Events'},
				xAxis: {type: 'datetime'},
				yAxis: [
					{title: {text: '%'}, labels: {format: '{value} %'}},
					{title: {text: 'MB'}, labels: {format: '{value} MB'}, opposite: true},
				],
				tooltip: {shared: true, valueDecimals: 2, animation: false},
				plotOptions: {
					series: {
						animation: false,
						// SVG's first mousemove must build the native search tree synchronously.
						...(boost.enabled === false ? {kdNow: true} : {}),
						events: {
							// Boost processes hover points in chunks after drawing. Do not
							// report completion at the earlier chart render event.
							renderedCanvas() {
								rendered.add(this);
								complete();
							},
						},
					},
					// In SVG, a hover marker under the stationary pointer can trigger
					// tracker mouseout while the tooltip remains visible.
					line: {lineWidth: 1, marker: {
						enabled: false,
						...(boost.enabled === false ? {states: {hover: {enabled: false}}} : {}),
					}},
				},
				series: [
					{name: 'CPU', color: 'red', dataTable: data[0], yAxis: 0, tooltip: {valueSuffix: ' %'}},
					{name: 'RAM', color: 'blue', dataTable: data[1], yAxis: 0, tooltip: {valueSuffix: ' %'}},
					{name: 'TCP Out', color: 'green', dataTable: data[2], yAxis: 1, tooltip: {valueSuffix: ' MB'}},
				],
			});
		}
		catch (error) {
			if (chart) chart.destroy();
			reject(error);
		}
	});
}

function renderChart(chart, action, wait) {
	return new Promise((resolve, reject) => {
		const rendered = new Set();
		const unbind = [];
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
			for (const series of chart.series)
				unbind.push(Highcharts.addEvent(series, 'renderedCanvas', () => {
					rendered.add(series);
					complete();
				}));
			action();
			redrawn = true;
			complete();
		}
		catch (error) { cleanup(); reject(error); }
	});
}

function updateChart(chart, input, host, wait) {
	return renderChart(chart, () => {
		// 13.1.1 accepts DataTable options directly; retain each native series.
		for (let i = 0; i < 3; i++)
			chart.series[i].setData(input[i], false, false, false);
		chart.redraw(false);
	}, wait);
}

export function resizeChart(chart, {width, height}, host, wait) {
	// setSize skips redraw for a clean, unchanged size, so Boost emits no completion.
	if (chart.chartWidth === width && chart.chartHeight === height && !chart.isDirtyBox) {
		if (wait) wait.textContent = 'Done!';
		return Promise.resolve();
	}
	return renderChart(chart, () => chart.setSize(width, height, false), wait);
}

export function getHoverPlan(chart, input, host) {
	// Only the SVG adapter has browser-verified table-backed tooltip values.
	if (chart.options.boost?.enabled !== false || chart.series.some(series => series.boosted))
		throw new Error('Highcharts hover requires SVG rendering with Boost disabled.');
	const rect = chart.container.getBoundingClientRect();
	const sx = rect.width / chart.chartWidth, sy = rect.height / chart.chartHeight;
	const length = input[0].columns.x.length;
	const xAxis = chart.xAxis[0];
	const tolerance = (length - 1) / (Math.abs(xAxis.toPixels(input[0].columns.x[length - 1]) - xAxis.toPixels(input[0].columns.x[0])) * sx);
	return {
		targets: hoverTargets(length, (index, seriesIndex) => ({
			x: rect.left + xAxis.toPixels(input[seriesIndex].columns.x[index]) * sx,
			y: rect.top + chart.series[seriesIndex].yAxis.toPixels(input[seriesIndex].columns.y[index]) * sy,
		})),
		verify(target) {
			const seriesIndex = target.seriesIndex;
			const point = chart.hoverPoints?.find(point => point.series === chart.series[seriesIndex]);
			const index = point?.index;
			if (chart.tooltip?.isHidden !== false || !nearHoverIndex(index, target, tolerance) || index < 0 || index >= length) return null;
			const {x, y} = input[seriesIndex].columns;
			const value = y[index];
			if (point.x !== x[index] || point.y !== value || Math.abs(xAxis.toPixels(x[index]) - xAxis.toPixels(x[target.index])) * sx > 1) return null;
			const text = visibleText(chart.tooltip.label?.element);
			const formatted = chart.numberFormatter(value, 2);
			const suffix = seriesIndex === 2 ? 'MB' : '%';
			if (!text.replace(/\s+/g, ' ').includes(`${point.series.name}: ${formatted} ${suffix}`.replace(/\s+/g, ' '))) return null;
			return {index, seriesIndex, value, text};
		},
	};
}

function destroyChart(chart) {
	chart.destroy();
}

export {updateChart};
export {prepData, makeChart, destroyChart, makeChartWithOptions};
