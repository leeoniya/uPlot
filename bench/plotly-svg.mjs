import {makeChartWithOptions} from './plotly.mjs';

export {prepData, destroyChart} from './plotly.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {type: 'scatter'});
}
