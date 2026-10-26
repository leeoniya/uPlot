import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
import {destroyChart} from '../vega.mjs';
export {updateChart, destroyChart} from '../vega.mjs';
export const prepData = prepRows;

export async function makeChart(input, host, wait) {
	let view;
	try {
		const spec = {
			width: WIDTH, height: HEIGHT, autosize: {type: 'fit', contains: 'padding'}, padding: 5,
			// Vega owns tuple IDs; do not mutate reusable prepared rows.
			data: [{name: 'table', values: input.map(row => ({...row}))}],
			scales: [
				{name: 'x', type: 'time', domain: {data: 'table', field: 'time'}, range: 'width'},
				{name: 'y', type: 'linear', domain: {data: 'table', fields: SERIES.map(s => s.id)}, range: 'height', zero: false, nice: true},
				{name: 'color', type: 'ordinal', domain: SERIES.map(s => s.label), range: SERIES.map(s => s.color)},
			],
			axes: [{scale: 'x', orient: 'bottom', tickCount: 4}, {scale: 'y', orient: 'left', grid: true, tickCount: 4}],
			legends: [{stroke: 'color', orient: 'bottom', direction: 'horizontal', symbolType: 'stroke'}],
			marks: SERIES.map(({id, label}) => ({
				name: id, type: 'line', from: {data: 'table'},
				encode: {update: {
					x: {scale: 'x', field: 'time'}, y: {scale: 'y', field: id},
					stroke: {scale: 'color', value: label}, strokeWidth: {value: 1 / (globalThis.devicePixelRatio || 1)},
				}},
			})),
		};
		const logger = vega.logger(vega.Warn);
		logger.error = error => { throw error instanceof Error ? error : new Error(String(error)); };
		view = new vega.View(vega.parse(spec), {renderer: 'canvas', logger});
		view.initialize(host);
		await view.runAsync();
		if (wait) wait.textContent = 'Done!';
		return view;
	}
	catch (error) {
		try { if (view) destroyChart(view); }
		finally { throw error; }
	}
}

export function validateChart(view, input, {rows}) {
	const lines = [];
	function visit(node) {
		if (node.marktype === 'line') lines.push(node);
		else for (const child of node.items ?? []) visit(child);
	}
	visit(view.scenegraph().root);
	assertSeries(lines.map(line => line.items), rows);
	for (const {id} of SERIES) {
		const line = lines.find(line => line.name === id);
		if (!line || line.items.some((item, i) => item.datum.time !== input[i]?.time || item.datum[id] !== input[i]?.[id]))
			throw new Error('Vega dashboard data differs from its input.');
	}
}
