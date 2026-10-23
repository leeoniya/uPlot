// jscharting@3.4.0/dist/jscharting.js is already minified; it exposes JSC.
// https://cdn.jsdelivr.net/npm/jscharting@3.4.0/dist/jscharting.d.ts
// Native [x, y] points, time scale, and chart-ready callback. No documented decimator.
function prepData(packed) {
	const fields = packed[0];
	const length = (packed.length - fields - 1) / fields;
	const data = [new Array(length), new Array(length), new Array(length)];

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		const time = packed[i] * 60000;
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
		chart = JSC.chart(host, {
			width: 1920, height: 600,
			title: {label: {text: 'Server Events'}},
			type: 'line',
			animation: false,
			defaultSeries: {
				animation: false,
				line: {width: 1 / devicePixelRatio},
				defaultPoint: {marker: {visible: false}, label: {visible: false}},
			},
			xAxis: {scale: {type: 'time'}},
			yAxis: [
				{id: 'percent', orientation: 'left', defaultTick: {label: {text: '%value%'}}},
				{id: 'tcp', orientation: 'right', defaultTick: {label: {text: '%value MB'}}},
			],
			series: data.map((points, i) => ({
				name: ['CPU', 'RAM', 'TCP Out'][i],
				color: ['red', 'blue', 'green'][i],
				yAxis: i === 2 ? 'tcp' : 'percent',
				points,
			})),
			legend: {position: 'bottom'},
		}, function() {
			chart = this;
			resolve();
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
	chart.destroy();
}

export {prepData, makeChart, destroyChart};
