import {hoverTargets, nearHoverIndex, visibleText} from './hover.mjs';

function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const cpu = Array(count);
	const ram = Array(count);
	const tcp = Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		const time = packed[i] * 60 * 1000;
		cpu[j] = [time, Math.round((100 - packed[i + 1]) * 1000) / 1000];
		ram[j] = [time, Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100];
		tcp[j] = [time, packed[i + 3]];
	}

	return [cpu, ram, tcp];
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {sampling = false} = {}) {
	const chart = new ApexCharts(host, {
		chart: {
			type: 'line',
			width: 1920,
			height: 600,
			parentHeightOffset: 0,
			animations: {enabled: false},
			renderer: 'canvas',
			// 8.4.1 only offers LTTB for scalar lines, which can omit bucket extrema.
			dataReducer: sampling ? {enabled: true, targetPoints: 1920, threshold: 3840} : {enabled: false},
			zoom: {type: 'x', enabled: true},
		},
		colors: ['red', 'blue', 'green'],
		series: [
			{name: 'CPU', data: data[0]},
			{name: 'RAM', data: data[1]},
			{name: 'TCP Out', data: data[2]},
		],
		dataLabels: {enabled: false},
		stroke: {curve: 'straight', width: 1},
		markers: {size: 0},
		xaxis: {type: 'datetime'},
		yaxis: [
			{
				seriesName: ['CPU', 'RAM'],
				title: {text: '%'},
				labels: {formatter: value => `${Number(value.toFixed(2))} %`},
			},
			{
				seriesName: 'TCP Out',
				opposite: true,
				title: {text: 'MB'},
				labels: {formatter: value => `${Number(value.toFixed(2))} MB`},
			},
		],

		tooltip: {
			// Dense lines overlap within a CSS pixel. Native shared-x hover keeps
			// all three source values available regardless of the closest series.
			shared: !sampling,
			intersect: false,
			y: {formatter: (value, {seriesIndex}) => `${value} ${seriesIndex === 2 ? 'MB' : '%'}`},
		},
	});

	try {
		await chart.render();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		chart.destroy();
		throw error;
	}
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], []], host, wait);
}

async function updateChart(chart, input, host, wait) {
	// Native 8.4.1 full updates retain the chart, but can replace its Canvas surface.
	await chart.updateSeries(input.map((data, i) => ({name: ['CPU', 'RAM', 'TCP Out'][i], data})), false);
	if (wait) wait.textContent = 'Done!';
}

export async function resizeChart(chart, {width, height}, host, wait) {
	// Keep the configured series and fixed sampling budget; disable animation
	// and propagation to other charts. Native updates can replace the canvas.
	await chart.updateOptions({chart: {width, height}}, false, false, false);
	if (wait) wait.textContent = 'Done!';
}

export function getHoverPlan(chart, input, host) {
	const {w} = chart;
	if (w.config.chart.dataReducer?.enabled)
		throw new Error('ApexCharts hover requires unsampled data.');
	const g = w.globals;
	const rect = w.dom.elWrap.getBoundingClientRect();
	const sx = rect.width / g.svgWidth, sy = rect.height / g.svgHeight;
	const length = input[0].length;
	const x = (index, seriesIndex) => rect.left + (g.translateX + g.seriesXvalues[seriesIndex][index]) * sx;
	return {
		targets: hoverTargets(length, (index, seriesIndex) => ({
			x: x(index, seriesIndex),
			y: rect.top + (g.translateY + g.seriesYvalues[seriesIndex][index]) * sy,
		})),
		verify(target) {
			// 8.4.1 writes these on w.interact; w.globals also exposes compatibility getters.
			const {capturedSeriesIndex, capturedDataPointIndex: index} = w.interact;
			const seriesIndex = target.seriesIndex, shared = w.config.tooltip.shared;
			if ((!shared && capturedSeriesIndex !== seriesIndex) || !nearHoverIndex(index, target, length - 1) || index >= length ||
				!(Math.abs(x(index, seriesIndex) - target.x) <= 1))
				return false;
			const value = g.series[seriesIndex]?.[index];
			const source = input[seriesIndex][index];
			if (!Number.isFinite(value) || value !== source[1] || g.seriesX[seriesIndex]?.[index] !== source[0])
				return false;
			const tooltip = g.tooltip;
			const items = tooltip?.ttItems;
			if (shared && (!items || items.length !== 3 || !items.every((item, s) => {
				const value = g.series[s]?.[index], source = input[s][index];
				return source && value === source[1] && g.seriesX[s]?.[index] === source[0] &&
					visibleText(item) && visibleText(item.querySelector('.apexcharts-tooltip-text-y-label')) === `${w.config.series[s].name}:` &&
					visibleText(item.querySelector('.apexcharts-tooltip-text-y-value')) === w.config.tooltip.y.formatter(value, {seriesIndex: s});
			}))) return false;
			const item = items?.[items.length === 1 ? 0 : seriesIndex];
			const text = visibleText(item);
			const label = visibleText(item?.querySelector('.apexcharts-tooltip-text-y-label'));
			const displayed = visibleText(item?.querySelector('.apexcharts-tooltip-text-y-value'));
			const formatted = w.config.tooltip.y.formatter(value, {seriesIndex});
			return visibleText(tooltip?.getElTooltip()) && text && label === `${w.config.series[seriesIndex].name}:` &&
				displayed === formatted && {index, seriesIndex, value, text};
		},
	};
}

function destroyChart(chart) {
	chart.destroy();
}

export {prepData, makeChart, makeEmptyChart, updateChart, makeChartWithOptions, destroyChart};
