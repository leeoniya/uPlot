import {makeChartWithOptions} from './d3.mjs';

export {prepData, updateChart, resizeChart, getHoverPlan} from './d3.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {renderer: 'svg', minmax: true});
}

export function destroyChart(chart) {
	chart.destroy();
}
