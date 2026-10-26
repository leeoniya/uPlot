import {makeChartWithOptions} from './fusiontime.mjs';
export {prepData, updateChart, destroyChart, validateChart} from './fusiontime.mjs';
export const makeChart = (input, host, wait) => makeChartWithOptions(input, host, wait, {sampled: true});
