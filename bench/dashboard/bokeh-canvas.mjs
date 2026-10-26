import {makeChartWithOptions} from './bokeh.mjs';
export {prepData, updateChart, destroyChart, validateChart} from './bokeh.mjs';
export const makeChart = (input, host, wait) => makeChartWithOptions(input, host, wait, {outputBackend: 'canvas'});
