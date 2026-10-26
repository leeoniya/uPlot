import {makeChartWithOptions} from './d3.mjs';

export {prepData, updateChart, resizeChart, getHoverPlan} from './d3.mjs';

export function makeEmptyChart(host, wait) {
	return makeChart([[], [], [], []], host, wait);
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {renderer: 'svg'});
}

export function destroyChart(chart) {
	chart.destroy();
}
