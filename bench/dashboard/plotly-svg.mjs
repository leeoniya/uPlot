import {makeChartWithOptions} from './plotly.mjs';

export {prepData, updateChart, destroyChart, validateChart} from './plotly.mjs';

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait, {type: 'scatter'});
}
