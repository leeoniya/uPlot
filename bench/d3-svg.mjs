import {makeChartWithOptions} from './d3.mjs';

export {prepData} from './d3.mjs';

export function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions, {renderer: 'svg'});
}

export function destroyChart(chart) {
	chart.destroy();
}
