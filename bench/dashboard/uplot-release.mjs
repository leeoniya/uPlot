import {makeChart as makeUPlotChart} from './uplot.mjs';
export {prepData, updateChart, destroyChart, validateChart} from './uplot.mjs';

export function makeChart(input, host, wait) {
	if (typeof globalThis.uPlotRelease !== 'function')
		throw new Error('Expected the pinned uPlot release IIFE to load before chart creation.');
	return makeUPlotChart(input, host, wait, globalThis.uPlotRelease);
}
