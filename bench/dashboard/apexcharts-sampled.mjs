import {makeChartWithOptions} from './apexcharts.mjs';

export {prepData, updateChart, destroyChart, validateChart} from './apexcharts.mjs';

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait, {sampling: true});
}
