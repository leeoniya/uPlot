import {makeChart as makeUPlotChart} from './uplot.mjs';
export {prepData, updateChart, resizeChart} from './uplot.mjs';

export function makeChart(data, host, wait) {
	if (typeof globalThis.uPlotRelease !== 'function')
		throw new Error('Expected the pinned uPlot release IIFE to load before chart creation.');
	// Preserve release behavior, including native path caching when cache.paths is unsupported.
	return makeUPlotChart(data, host, wait, globalThis.uPlotRelease);
}

export function makeEmptyChart(host, wait) {
	return makeChart([[], [], [], []], host, wait ?? {textContent: ''});
}
