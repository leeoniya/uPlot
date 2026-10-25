import {makeChartWithOptions} from './d3.mjs';

export {prepData, updateChart} from './d3.mjs';

export function makeEmptyChart(host, wait) {
	return makeChart([[], [], [], []], host, wait);
}

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {renderer: 'canvas', minmax: true});
}

export function destroyChart(chart) {
	chart.destroy();
}
