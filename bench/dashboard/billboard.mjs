import {WIDTH, HEIGHT, SERIES, assertSeries} from './common.mjs';

export function prepData(frame) {
	return [['time', ...frame.x], ...SERIES.map(({id}, s) => [id, ...frame.ys[s]])];
}

const renders = new WeakMap();

export async function makeChart(input, host, wait) {
	let chart;
	try {
		let rendered;
		const ready = new Promise(resolve => { rendered = resolve; });
		chart = bb.generate({
			bindto: host, size: {width: WIDTH, height: HEIGHT},
			render: {mode: 'canvas', lazy: false, observe: false},
			boost: {useWorker: false}, resize: {auto: false}, transition: {duration: 0},
			data: {
				x: 'time', columns: input, type: 'line', xSort: false, order: null,
				names: Object.fromEntries(SERIES.map(({id, label}) => [id, label])),
				colors: Object.fromEntries(SERIES.map(({id, color}) => [id, color])),
				labels: false,
			},
			axis: {x: {type: 'timeseries', tick: {fit: false}}, y: {show: true}},
			point: {show: false, focus: {only: false, expand: {enabled: false}}},
			canvas: {theme: {selectors: {'.bb-line': {'stroke-width': 1 / devicePixelRatio}}}},
			legend: {show: true, position: 'bottom'},
			onbeforeinit() { chart = this; },
			onrendered() {
				rendered();
				const pending = renders.get(this);
				if (pending) { renders.delete(this); pending.resolve(); }
			},
		});
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
}

export async function updateChart(chart, input, host, wait) {
	if (renders.has(chart)) throw new Error('Billboard update is already pending.');
	try {
		await new Promise((resolve, reject) => {
			renders.set(chart, {resolve, reject});
			chart.load({columns: input});
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally { renders.delete(chart); }
}

export function destroyChart(chart) {
	const pending = renders.get(chart);
	renders.delete(chart);
	pending?.reject(new Error('Billboard was destroyed before rendering completed.'));
	chart.destroy();
}

export function validateChart(chart, input, {rows}) {
	const series = chart.data();
	assertSeries(series.map(series => series.values), rows);
	for (let s = 0; s < SERIES.length; s++) {
		const native = series.find(series => series.id === SERIES[s].id);
		if (!native || native.values.some((point, i) => +point.x !== input[0][i + 1] || point.value !== input[s + 1][i + 1]))
			throw new Error('Billboard dashboard data mismatch.');
	}
	return true;
}
