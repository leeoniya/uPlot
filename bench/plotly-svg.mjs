import {makeChartWithOptions} from './plotly.mjs';

export {prepData, destroyChart, updateChart, resizeChart, getHoverPlan} from './plotly.mjs';

export function makeEmptyChart(host, wait) {
	return makeChartWithOptions([[], [], [], []], host, wait, undefined, {type: 'scatter'});
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {type: 'scatter'});
}
