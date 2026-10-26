import {makeChartWithOptions} from './highcharts.mjs';

export {prepData, updateChart, destroyChart, validateChart} from './highcharts.mjs';

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait, {boost: {enabled: false}});
}
