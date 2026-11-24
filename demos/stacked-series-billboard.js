import {stackedSeries, stackDimensions, stackDomain} from './lib/stackedSeriesData.js';

const keys = ['A', 'B', 'C', 'D'];

export function chartOptions(raw) {
	// groupsZeroAs is chart-wide in billboard.js. The shell supplies one sign per host.
	const negative = raw.slice(1).some(values => values.some(value => value < 0));
	const min = negative ? -stackDomain.y[1] : 0;
	return {
		size: {...stackDimensions},
		padding: {right: 20},
		render: {mode: 'svg', lazy: false, observe: false},
		resize: {auto: false},
		transition: {duration: 0},
		data: {
			x: 'x',
			columns: ['x', ...keys].map((key, i) => [key, ...raw[i]]),
			type: 'area',
			groups: [keys.slice()],
			groupsZeroAs: negative ? 'negative' : 'positive',
			order: null,
			names: Object.fromEntries(keys.map((key, i) => [key, (negative ? '−' : '') + stackedSeries[i].label])),
			colors: Object.fromEntries(keys.map((key, i) => [key, stackedSeries[i].stroke])),
		},
		axis: {
			x: {
				type: 'indexed',
				min: stackDomain.x[0],
				max: stackDomain.x[1],
				padding: {left: 0, right: 0},
				tick: {values: Array.from({length: 11}, (_, i) => i * 2), outer: false},
			},
			y: {
				min,
				max: negative ? 0 : stackDomain.y[1],
				padding: {top: 0, bottom: 0},
				tick: {values: Array.from({length: 9}, (_, i) => min + i * 2), outer: false},
			},
		},
		grid: {x: {show: true}, y: {show: true}},
		point: {show: false},
		legend: {show: true},
		tooltip: {show: false},
		interaction: {enabled: false},
	};
}

export async function createDemo(host, data, Library = globalThis.bb) {
	if (typeof Library?.generate !== 'function')
		throw new Error('billboard.js did not load');

	let plot;
	try {
		let rendered;
		const ready = new Promise(resolve => { rendered = resolve; });
		plot = Library.generate({
			bindto: host,
			...chartOptions(data),
			// Capture the instance even if synchronous initialization fails.
			onbeforeinit() { plot = this; },
			onrendered() { rendered(); },
		});
		await ready;
	}
	catch (error) {
		try { if (plot) plot.destroy(); }
		finally { throw error; }
	}

	return {
		plot,
		destroy() {
			plot.destroy();
		},
	};
}
