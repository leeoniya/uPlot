// fusioncharts@4.2.3: fusioncharts.js, then fusioncharts.timeseries.js.
// https://www.fusioncharts.com/dev/fusiontime/fusiontime-component/y-axis-in-fusiontime
// https://www.fusioncharts.com/dev/fusiontime/fusiontime-data-engine/fusiontime-methods
function prepData(packed) {
	const fields = packed[0];
	const rows = new Array((packed.length - fields - 1) / fields);
	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		rows[j] = [
			packed[i] * 60000,
			Math.round((100 - packed[i + 1]) * 1000) / 1000,
			Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			packed[i + 3],
		];
	}
	return rows;
}

async function makeChart(data, host, wait) {
	const handle = {chart: null, store: null};
	let timer;
	const listeners = [];
	try {
		const store = handle.store = new FusionCharts.DataStore();
		// DataStore appends _row_id to input rows. Copy inside timed init so
		// repeated samples can reuse prepData's output without vendor mutation.
		const table = store.createDataTable(data.map(row => row.slice()), [
			{name: 'Time', type: 'date', format: '%Q'},
			{name: 'CPU', type: 'number'},
			{name: 'RAM', type: 'number'},
			{name: 'TCP Out', type: 'number'},
		], {enableUTC: true});
		const line = value => ({value, type: 'line', aggregation: 'average'});
		const chart = handle.chart = new FusionCharts({
			type: 'timeseries',
			renderAt: host,
			width: 1920,
			height: 600,
			dataFormat: 'json',
			dataSource: {
				chart: {
					animation: 0,
					multiCanvas: false,
					enableUTC: true,
					paletteColors: '#ff0000,#0000ff,#008000',
				},
				caption: {text: 'Server Events'},
				data: table,
				xAxis: {plot: 'Time'},
				yAxis: [
					{plot: [line('CPU'), line('RAM')], orientation: 'left', format: {suffix: '%'}},
					{plot: [line('TCP Out')], orientation: 'right', format: {suffix: ' MB'}},
				],
				// No persistent anchors; native styles also suppress hover markers.
				// Leave calendar binning at its native defaults.
				plotConfig: {line: {style: {
					line: {'stroke-width': 1 / devicePixelRatio},
					anchor: {opacity: 0},
					'anchor:hover': {opacity: 0},
					'anchor:highlight': {opacity: 0},
				}}},
				navigator: {enabled: false},
				extensions: {
					standardRangeSelector: {enabled: false},
					customRangeSelector: {enabled: false},
				},
				legend: {enabled: true, position: 'bottom'},
			},
		});
		await new Promise((resolve, reject) => {
			const on = (name, listener) => {
				listeners.push([name, listener]);
				chart.addEventListener(name, listener);
			};
			on('renderComplete', resolve);
			for (const name of ['dataInvalid', 'dataLoadError'])
				on(name, (event, detail) => reject(new Error(`FusionTime ${name}: ${detail?.error?.message ?? detail?.error ?? detail?.message ?? event?.eventType ?? 'chart initialization failed'}`)));
			timer = setTimeout(() => reject(new Error('FusionTime did not finish rendering within 30 seconds.')), 30000);
			chart.render();
		});
		if (wait)
			wait.textContent = 'Done!';
		return handle;
	}
	catch (error) {
		try { destroyChart(handle); }
		finally { throw error; }
	}
	finally {
		clearTimeout(timer);
		if (handle.chart) {
			for (const [name, listener] of listeners)
				handle.chart.removeEventListener(name, listener);
		}
	}
}

function destroyChart(handle) {
	const {chart, store} = handle;
	handle.chart = handle.store = null;
	try { chart?.dispose(); }
	finally { store?.dispose(); }
}

export {prepData, makeChart, destroyChart};
