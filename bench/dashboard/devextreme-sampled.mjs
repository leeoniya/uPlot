import {makeChartWithOptions} from './devextreme.mjs';
export {prepData, updateChart, destroyChart, validateChart} from './devextreme.mjs';

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait, {sampled: true});
}
