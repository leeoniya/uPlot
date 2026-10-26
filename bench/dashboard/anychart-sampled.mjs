import {makeChartWithOptions} from './anychart.mjs';
export {prepData, updateChart, destroyChart, validateChart} from './anychart.mjs';
export const makeChart = (input, host, wait) => makeChartWithOptions(input, host, wait, {sampled: true});
