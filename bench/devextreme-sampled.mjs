import {makeChartWithOptions} from './devextreme.mjs';

export {prepData, destroyChart, updateChart, resizeChart} from './devextreme.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {sampled: true});
}
