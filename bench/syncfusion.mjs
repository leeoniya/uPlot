// @syncfusion/ej2-charts@35.1.41/dist/global/ej2-charts.min.js and its global dependencies.
// https://ej2.syncfusion.com/javascript/documentation/api/chart/ (enableCanvas, loaded)
// LineSeries uses native pixel-tolerance reduction; do not pre-decimate the input.
function prepData(packed) {
	const fields = packed[0];
	const data = new Array((packed.length - fields - 1) / fields);

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data[j] = {
			time: new Date(packed[i] * 60000),
			cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
			ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			tcp: packed[i + 3],
		};
	}

	return data;
}

async function makeChart(data, host, wait) {
	let chart;
	try {
		let resolve;
		const ready = new Promise(done => { resolve = done; });
		chart = new ej.charts.Chart({
			width: '1920', height: '600',
			title: 'Server Events',
			enableCanvas: true,
			primaryXAxis: {valueType: 'DateTime', rangePadding: 'None'},
			primaryYAxis: {labelFormat: '{value}%'},
			axes: [{name: 'tcp', opposedPosition: true, labelFormat: '{value} MB'}],
			series: ['cpu', 'ram', 'tcp'].map((yName, i) => ({
				dataSource: data,
				xName: 'time', yName,
				yAxisName: i === 2 ? 'tcp' : null,
				name: ['CPU', 'RAM', 'TCP Out'][i],
				type: 'Line',
				fill: ['red', 'blue', 'green'][i],
				width: 1 / devicePixelRatio,
				animation: {enable: false},
				marker: {visible: false, dataLabel: {visible: false}},
			})),
			legendSettings: {visible: true, position: 'Bottom'},
			loaded: () => resolve(),
		});
		// Keep the instance available if appendTo fails partway through rendering.
		chart.appendTo(host);
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
	return makeChart([], host, wait);
}

async function updateChart(chart, input, host, wait) {
	// Native Canvas data binding retains the Chart but recreates its drawing surface.
	const loaded = chart.loaded;
	try {
		await new Promise(resolve => {
			chart.loaded = resolve;
			for (const series of chart.series)
				series.dataSource = input;
			chart.dataBind();
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally {
		chart.loaded = loaded;
	}
}

function destroyChart(chart) {
	// EJ2 leaves auxiliary elements in the host after destroying a Canvas chart.
	const element = chart.element;
	try { chart.destroy(); }
	finally { element.replaceChildren(); }
}

export {prepData, makeChart, makeEmptyChart, updateChart, destroyChart};
