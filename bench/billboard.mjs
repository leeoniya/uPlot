// billboard.js@4.1.3/dist/billboard.pkgd.min.js exposes bb and includes D3 (MIT).
// Canvas styles also use dist/billboard.min.css.
function prepData(packed) {
	const fields = packed[0];
	const length = (packed.length - fields - 1) / fields + 1;
	const data = ['time', 'cpu', 'ram', 'tcp'].map(key => {
		const column = new Array(length);
		column[0] = key;
		return column;
	});

	for (let i = fields + 1, j = 1; i < packed.length; i += fields, j++) {
		data[0][j] = packed[i] * 60000;
		data[1][j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		data[2][j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		data[3][j] = packed[i + 3];
	}

	return data;
}

const renders = new WeakMap();

async function makeChart(data, host, wait) {
	let chart;
	try {
		let rendered;
		const ready = new Promise(resolve => { rendered = resolve; });
		chart = bb.generate({
			bindto: host,
			size: {width: 1920, height: 600},
			title: {text: 'Server Events'},
			render: {mode: 'canvas', lazy: false, observe: false},
			// Worker CPU is not attributed by the benchmark harness.
			boost: {useWorker: false},
			resize: {auto: false},
			transition: {duration: 0},
			data: {
				x: 'time',
				columns: data,
				type: 'line',
				xSort: false,
				order: null,
				axes: {cpu: 'y', ram: 'y', tcp: 'y2'},
				names: {cpu: 'CPU', ram: 'RAM', tcp: 'TCP Out'},
				colors: {cpu: 'red', ram: 'blue', tcp: 'green'},
				labels: false,
			},
			axis: {
				x: {type: 'timeseries', tick: {fit: false}},
				y: {tick: {format: value => `${value}%`}},
				y2: {show: true, tick: {format: value => `${value} MB`}},
			},
			point: {show: false},
			canvas: {theme: {selectors: {'.bb-line': {'stroke-width': 1 / devicePixelRatio}}}},
			legend: {show: true, position: 'bottom'},
			// Capture the instance even if synchronous initialization throws.
			onbeforeinit() { chart = this; },
			onrendered() {
				rendered();
				const complete = renders.get(this);
				if (complete) { renders.delete(this); complete(); }
			},
		});
		await ready;
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
}

function makeEmptyChart(host, wait) {
	return makeChart(['time', 'cpu', 'ram', 'tcp'].map(key => [key]), host, wait);
}

async function updateChart(chart, input, host, wait) {
	if (renders.has(chart)) throw new Error('Billboard update is already pending.');
	try {
		await new Promise((resolve, reject) => {
			renders.set(chart, resolve);
			try { chart.load({columns: input}); }
			catch (error) { reject(error); }
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally { renders.delete(chart); }
}

function destroyChart(chart) {
	renders.delete(chart);
	chart.destroy();
}

export {prepData, makeChart, destroyChart, makeEmptyChart, updateChart};
