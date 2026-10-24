// zingchart@2.9.16-1/zingchart.min.js exposes zingchart and ZC (build 2.9.16-hf1).
// Use the branded distribution without supplying or changing license keys.
function prepData(packed) {
	const fields = packed[0];
	const count = (packed.length - fields - 1) / fields;
	// Scalar series + scale-x.values use index spacing, not elapsed-time spacing.
	// Keep explicit XY pairs so irregular timestamps retain their positions.
	const data = Array.from({length: 3}, () => Array(count));

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		const x = packed[i] * 60000;
		data[0][j] = [x, Math.round((100 - packed[i + 1]) * 1000) / 1000];
		data[1][j] = [x, Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100];
		data[2][j] = [x, packed[i + 3]];
	}

	return data;
}

function makeChart(data, host, wait) {
	const id = host.id;
	let complete, failed;
	const pending = new Promise((resolve, reject) => {
		complete = () => resolve(host);
		failed = event => reject(new Error(event.error?.message || String(event.error), {cause: event.error}));
		zingchart.bind(id, 'complete', complete);
		zingchart.bind(id, 'error', failed);
		zingchart.render({
			id,
			width: 1920,
			height: 600,
			output: 'canvas',
			data: {
				type: 'line',
				title: {text: 'Server Events'},
				plotarea: {margin: '60 80 60 70'},
				legend: {layout: '1x3'},
				plot: {
					mode: 'fast',
					// Do not let the renderer skip samples when points outnumber pixels.
					'sampling-step': 1,
					'max-trackers': 0,
					'line-width': 1 / devicePixelRatio,
					shadow: false,
					marker: {visible: false},
					animation: {effect: 0, speed: 0},
				},
				tooltip: {visible: false},
				'scale-x': {

					zooming: true,
					transform: {type: 'date', all: '%m/%d/%y %H:%i'},
				},
				'scale-y': {placement: 'default', format: '%v%'},
				'scale-y-2': {placement: 'opposite', format: '%v MB', guide: {visible: false}},
				series: ['CPU', 'RAM', 'TCP Out'].map((text, i) => ({
					text,
					scales: i === 2 ? 'scale-x,scale-y-2' : 'scale-x,scale-y',
					'line-color': ['red', 'blue', 'green'][i],
					values: data[i],
				})),
			},
		});
	});

	function unbind() {
		zingchart.unbind(id, 'complete', complete);
		zingchart.unbind(id, 'error', failed);
	}

	// Unbind after event dispatch: ZingChart iterates its live listener array.
	return pending.then(chart => {
		unbind();
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}).catch(error => {
		try {
			unbind();
			destroyChart(host);
		}
		finally { throw error; }
	});
}

function destroyChart(chart) {
	zingchart.exec(chart.id, 'destroy');
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], []], host, wait);
}

async function updateChart(chart, input, host, wait) {
	const id = chart.id;
	let complete, failed;
	const ready = new Promise((resolve, reject) => {
		complete = resolve;
		failed = event => reject(new Error(event.error?.message || String(event.error), {cause: event.error}));
	});
	zingchart.bind(id, 'complete', complete);
	zingchart.bind(id, 'error', failed);
	try {
		// Retains the graph and data canvases; the vendor rebuilds some hover/legend layers.
		zingchart.exec(id, 'setseriesvalues', {values: input});
		await ready;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	finally {
		// Unbind after dispatch, as in makeChart.
		zingchart.unbind(id, 'complete', complete);
		zingchart.unbind(id, 'error', failed);
	}
}

export {prepData, makeChart, destroyChart, makeEmptyChart, updateChart};
