import {WIDTH, HEIGHT, SERIES, prepRows, assertSeries} from './common.mjs';
import {destroyChart} from '../g2.mjs';
export {updateChart, destroyChart} from '../g2.mjs';
export const prepData = prepRows;

export async function makeChart(input, host, wait) {
	let chart;
	try {
		// The omitted renderer selects G2's built-in Canvas backend.
		chart = new G2.Chart({container: host, width: WIDTH, height: HEIGHT, autoFit: false});
		chart.options({
			type: 'view', data: input, animate: false,
			scale: {
				x: {type: 'time', nice: false},
				color: {type: 'ordinal', domain: SERIES.map(s => s.label), range: SERIES.map(s => s.color)},
			},
			legend: {color: {position: 'top'}},
			children: SERIES.map(({id, label}) => ({
				type: 'line',
				encode: {x: 'time', y: id, color: {type: 'constant', value: label}},
				scale: {y: {type: 'linear', key: 'y', nice: true, zero: false}},
				axis: {x: {title: false}, y: {title: false, position: 'left'}},
				style: {lineWidth: 1 / (globalThis.devicePixelRatio || 1), fill: 'none'}, animate: false,
			})),
		});
		await chart.render();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
}

export function validateChart(chart, input, {rows}) {
	const marks = chart.getContext().views.flatMap(view => [...view.markState.entries()]);
	if (marks.some(([mark]) => mark.type !== 'line')) throw new Error('G2 dashboard requires native line marks.');
	assertSeries(marks.map(([mark]) => mark.data), rows);
		// G2 stores one visual datum per line, with the source indices in seriesIndex.
		assertSeries(marks.map(([, state]) => state.data.flatMap(datum => datum.seriesIndex)), rows);
	for (const {id} of SERIES) {
		const entry = marks.find(([mark]) => mark.encode.y.field === id);
		if (!entry || entry[0].data.some((row, i) => row.time !== input[i]?.time || row[id] !== input[i]?.[id]))
			throw new Error('G2 dashboard data differs from its input.');
	}
}
