import {makeChartWithOptions} from './anychart.mjs';

export {prepData, destroyChart, updateChart, resizeChart} from './anychart.mjs';

export function makeEmptyChart(host, wait) {
	return makeChart([], host, wait);
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {sampled: true});
}
