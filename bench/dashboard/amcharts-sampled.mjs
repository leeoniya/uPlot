import {makeChartWithOptions} from './amcharts.mjs';
export {prepData, updateChart, destroyChart, validateChart} from './amcharts.mjs';
export const makeChart = (input, host, wait) => makeChartWithOptions(input, host, wait, {sampling: true});
