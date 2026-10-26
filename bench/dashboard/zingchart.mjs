import {WIDTH, HEIGHT, SERIES, prepPairs, assertSeries} from './common.mjs';
import {destroyChart} from '../zingchart.mjs';
export {updateChart, destroyChart} from '../zingchart.mjs';
export const prepData = prepPairs;

export async function makeChart(input, host, wait) {
	const id = host.id;
	let complete, failed;
	try {
		await new Promise((resolve, reject) => {
			complete = resolve;
			failed = event => reject(new Error(event.error?.message || String(event.error), {cause: event.error}));
			zingchart.bind(id, 'complete', complete);
			zingchart.bind(id, 'error', failed);
			zingchart.render({
				id, width: WIDTH, height: HEIGHT, output: 'canvas',
				data: {
					type: 'line', plotarea: {margin: '15 15 65 40'},
					legend: {layout: '1x5', align: 'center', 'vertical-align': 'bottom', item: {'font-size': 9}},
					plot: {
						mode: 'fast', 'sampling-step': 1, 'max-trackers': 0,
						'line-width': 1 / (globalThis.devicePixelRatio || 1), shadow: false,
						marker: {visible: false}, animation: {effect: 0, speed: 0},
					},
					tooltip: {visible: false},
					'scale-x': {transform: {type: 'date', all: '%H:%i'}},
					'scale-y': {placement: 'default'},
					series: SERIES.map(({label, color}, i) => ({
						text: label, scales: 'scale-x,scale-y', 'line-color': color, values: input[i],
					})),
				},
			});
		});
		if (wait) wait.textContent = 'Done!';
		return host;
	}
	catch (error) {
		try { destroyChart(host); }
		finally { throw error; }
	}
	finally {
		// Unbind only after the vendor finishes iterating its live listener array.
		zingchart.unbind(id, 'complete', complete);
		zingchart.unbind(id, 'error', failed);
	}
}

export function validateChart(handle, input, {rows}) {
	if (zingchart.exec(handle.id, 'getplotlength') !== SERIES.length)
		throw new Error('ZingChart dashboard requires five native lines.');
	assertSeries(zingchart.exec(handle.id, 'getseriesvalues'), rows);
}
