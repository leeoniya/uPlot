import {makeChartWithOptions} from './bokeh.mjs';

export {prepData, destroyChart, updateChart, resizeChart, getHoverPlan} from './bokeh.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {outputBackend: 'canvas'});
}
