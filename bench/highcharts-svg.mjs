import {makeChartWithOptions} from './highcharts.mjs';

export {prepData, destroyChart, updateChart, resizeChart, getHoverPlan} from './highcharts.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {boost: {enabled: false}});
}
