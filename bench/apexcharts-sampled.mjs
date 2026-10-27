import {makeChartWithOptions} from './apexcharts.mjs';

export {prepData, destroyChart, updateChart, resizeChart} from './apexcharts.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {sampling: true});
}
