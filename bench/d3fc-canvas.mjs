import {makeChartWithOptions} from './d3fc.mjs';

export {prepData, destroyChart, updateChart, resizeChart, getHoverPlan} from './d3fc.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {renderer: 'canvas'});
}
