function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const x = new Float64Array(count);
	const cpu = new Float64Array(count);
	const ram = new Float64Array(count);
	const tcp = new Float64Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		x[j] = packed[i] * 60 * 1000;
		cpu[j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		ram[j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		tcp[j] = packed[i + 3];
	}

	return [cpu, ram, tcp].map(y => ({columns: {x, y}}));
}

function makeChart(data, host, wait) {
	return new Promise((resolve, reject) => {
		const rendered = new Set();
		let loaded = false;
		let chart;

		function complete() {
			if (loaded && chart.series.every(series => !series.boosted || rendered.has(series))) {
				if (wait) wait.textContent = 'Done!';
				resolve(chart);
			}
		}

		try {
			chart = Highcharts.chart(host, {
				chart: {
					type: 'line',
					width: 1920,
					height: 600,
					animation: false,
					zooming: {type: 'x'},
					events: {
						load() {
							// Boost's load handler (order -1) paints the shared canvas first.
							chart = this;
							loaded = true;
							complete();
						},
					},
				},
				boost: {
					// Float32 GPU translations lose small increments in epoch milliseconds.
					useGPUTranslations: false,
				},
				title: {text: 'Server Events'},
				xAxis: {type: 'datetime'},
				yAxis: [
					{title: {text: '%'}, labels: {format: '{value} %'}},
					{title: {text: 'MB'}, labels: {format: '{value} MB'}, opposite: true},
				],
				tooltip: {shared: true, valueDecimals: 2, animation: false},
				plotOptions: {
					series: {
						animation: false,
						events: {
							// Boost processes hover points in chunks after drawing. Do not
							// report completion at the earlier chart render event.
							renderedCanvas() {
								rendered.add(this);
								complete();
							},
						},
					},
					line: {lineWidth: 1, marker: {enabled: false}},
				},
				series: [
					{name: 'CPU', color: 'red', dataTable: data[0], yAxis: 0, tooltip: {valueSuffix: ' %'}},
					{name: 'RAM', color: 'blue', dataTable: data[1], yAxis: 0, tooltip: {valueSuffix: ' %'}},
					{name: 'TCP Out', color: 'green', dataTable: data[2], yAxis: 1, tooltip: {valueSuffix: ' MB'}},
				],
			});
		}
		catch (error) {
			if (chart) chart.destroy();
			reject(error);
		}
	});
}

function destroyChart(chart) {
	chart.destroy();
}

export {prepData, makeChart, destroyChart};
