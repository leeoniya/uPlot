function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const cpu = Array(count);
	const ram = Array(count);
	const tcp = Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		const time = packed[i] * 60 * 1000;
		cpu[j] = [time, Math.round((100 - packed[i + 1]) * 1000) / 1000];
		ram[j] = [time, Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100];
		tcp[j] = [time, packed[i + 3]];
	}

	return [cpu, ram, tcp];
}

async function makeChart(data, host, wait) {
	const chart = new ApexCharts(host, {
		chart: {
			type: 'line',
			width: 1920,
			height: 600,
			parentHeightOffset: 0,
			animations: {enabled: false},
			renderer: 'canvas',
			// 8.4.1 only offers LTTB for scalar lines, which can omit bucket extrema.
			dataReducer: {enabled: false},
			zoom: {type: 'x', enabled: true},
		},
		colors: ['red', 'blue', 'green'],
		series: [
			{name: 'CPU', data: data[0]},
			{name: 'RAM', data: data[1]},
			{name: 'TCP Out', data: data[2]},
		],
		dataLabels: {enabled: false},
		stroke: {curve: 'straight', width: 1},
		markers: {size: 0},
		xaxis: {type: 'datetime'},
		yaxis: [
			{
				seriesName: ['CPU', 'RAM'],
				title: {text: '%'},
				labels: {formatter: value => `${Number(value.toFixed(2))} %`},
			},
			{
				seriesName: 'TCP Out',
				opposite: true,
				title: {text: 'MB'},
				labels: {formatter: value => `${Number(value.toFixed(2))} MB`},
			},
		],

		tooltip: {
			shared: false,
			y: {formatter: (value, {seriesIndex}) => `${value} ${seriesIndex === 2 ? 'MB' : '%'}`},
		},
	});

	try {
		await chart.render();
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		chart.destroy();
		throw error;
	}
}

function destroyChart(chart) {
	chart.destroy();
}

export {prepData, makeChart, destroyChart};
