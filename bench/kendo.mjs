// @progress/kendo-ui@2026.3.1015/umd/kendo.dataviz.min.js, with jQuery.
// https://www.telerik.com/kendo-jquery-ui/documentation/api/javascript/dataviz/ui/chart
// Use scatterLine: date-category aggregation would change irregular calendar spacing.
function prepData(packed) {
	const fields = packed[0];
	const length = (packed.length - fields - 1) / fields;
	const data = [new Array(length), new Array(length), new Array(length)];

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		const time = new Date(packed[i] * 60000);
		data[0][j] = [time, Math.round((100 - packed[i + 1]) * 1000) / 1000];
		data[1][j] = [time, Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100];
		data[2][j] = [time, packed[i + 3]];
	}

	return data;
}

async function makeChart(data, host, wait) {
	let chart;
	try {
		let resolve;
		const ready = new Promise(done => { resolve = done; });
		chart = new kendo.dataviz.ui.Chart(host, {
			chartArea: {width: 1920, height: 600},
			title: {text: 'Server Events'},
			renderAs: 'canvas',
			transitions: false,
			seriesDefaults: {
				type: 'scatterLine',
				width: 1 / devicePixelRatio,
				markers: {visible: false},
				labels: {visible: false},
			},
			series: data.map((points, i) => ({
				data: points,
				name: ['CPU', 'RAM', 'TCP Out'][i],
				color: ['red', 'blue', 'green'][i],
				yAxis: i === 2 ? 'tcp' : 'percent',
			})),
			xAxis: {
				type: 'date',
				// Crossing positions do not constrain the automatically computed domains.
				axisCrossingValue: [new Date(-8640000000000000), new Date(8640000000000000)],
			},
			yAxis: [
				{name: 'percent', labels: {template: e => `${e.value}%`}},
				{name: 'tcp', labels: {template: e => `${e.value} MB`}},
			],
			legend: {visible: true, position: 'bottom'},
			render: e => { chart = e.sender; resolve(); },
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

function destroyChart(chart) {
	// Widget.destroy releases handlers, but does not remove the widget's DOM.
	const element = chart.element;
	try { chart.destroy(); }
	finally { element.empty(); }
}

export {prepData, makeChart, destroyChart};
