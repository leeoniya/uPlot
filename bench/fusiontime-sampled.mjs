import {makeChartWithOptions} from './fusiontime.mjs';

export {prepData, destroyChart, updateChart, resizeChart} from './fusiontime.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {sampled: true});
}
