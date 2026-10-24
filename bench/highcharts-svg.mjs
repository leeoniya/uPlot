import {makeChartWithOptions} from './highcharts.mjs';

export {prepData, destroyChart, updateChart} from './highcharts.mjs';

export function makeEmptyChart(host, wait) {
	return makeChartWithOptions(Array.from({length: 3}, () => ({columns: {x: [], y: []}})),
		host, wait, undefined, {boost: {enabled: false}});
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {boost: {enabled: false}});
}
