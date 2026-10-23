// ag-charts-community@14.2.0/dist/umd/ag-charts-community.min.js exposes agCharts (MIT).
// The UMD bundle registers all Community modules, including native line aggregation.
function prepData(packed) {
	const fields = packed[0];
	const data = new Array((packed.length - fields - 1) / fields);

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data[j] = {
			time: packed[i] * 60000,
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
		chart = agCharts.AgCharts.create({
			container: host,
			width: 1920,
			height: 600,
			title: {text: 'Server Events'},
			data,
			// Community has no animation module. Keep native aggregation enabled.
			series: ['cpu', 'ram', 'tcp'].map((yKey, i) => ({
				type: 'line',
				xKey: 'time',
				xKeyAxis: 'x',
				yKey,
				yKeyAxis: i === 2 ? 'tcp' : 'percent',
				yName: ['CPU', 'RAM', 'TCP Out'][i],
				stroke: ['red', 'blue', 'green'][i],
				strokeWidth: 1 / devicePixelRatio,
				marker: {enabled: false},
				label: {enabled: false},
			})),
			axes: {
				x: {type: 'time', position: 'bottom', nice: false},
				percent: {type: 'number', position: 'left', label: {formatter: ({value}) => `${value}%`}},
				tcp: {type: 'number', position: 'right', label: {formatter: ({value}) => `${value} MB`}},
			},
			legend: {enabled: true, position: 'bottom'},
		});
		await chart.waitForUpdate();
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
