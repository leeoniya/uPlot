import {makeChartWithOptions} from './apexcharts.mjs';

export {prepData, destroyChart, updateChart} from './apexcharts.mjs';

export function makeEmptyChart(host, wait) {
	return makeChart([[], [], []], host, wait);
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {sampling: true});
}
