import {makeChartWithOptions} from './d3fc.mjs';

export {prepData, destroyChart, updateChart, resizeChart} from './d3fc.mjs';

export function makeEmptyChart(host, wait) {
	return makeChart(Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(0)])), host, wait);
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {renderer: 'canvas'});
}
