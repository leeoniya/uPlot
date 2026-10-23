// Loader asset: https://www.gstatic.com/charts/loader.js (not immutable).
// https://developers.google.com/chart/interactive/docs/basic_load_libs
// https://developers.google.com/chart/interactive/docs/gallery/linechart
// Frozen 52 is the documented current release; Google may apply critical fixes.
const runtimes = new WeakMap();
const prepared = new WeakSet();

// The parent must await this AFTER loading loader.js and BEFORE timing init.
// This only loads code: DataTable construction, ingestion, layout, and draw stay timed.
async function prepareRuntime() {
	const charts = globalThis.google?.charts;
	if (!charts?.load)
		throw new Error('Load https://www.gstatic.com/charts/loader.js before prepareRuntime().');
	if (!runtimes.has(charts)) {
		const pending = Promise.resolve().then(async () => {
			let timer;
			try {
				await Promise.race([
					charts.load('52', {packages: ['corechart'], language: 'en'}),
					new Promise((resolve, reject) => {
						timer = setTimeout(() => reject(new Error('Google Charts corechart loading timed out after 30 seconds.')), 30000);
					}),
				]);
				if (!globalThis.google?.visualization?.LineChart)
					throw new Error('Google Charts corechart did not provide the classic LineChart.');
				prepared.add(charts);
			}
			finally { clearTimeout(timer); }
		}).catch(error => {
			runtimes.delete(charts);
			throw error;
		});
		runtimes.set(charts, pending);
	}
	await runtimes.get(charts);
}

function prepData(packed) {
	const fields = packed[0];
	const rows = new Array((packed.length - fields - 1) / fields);
	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		rows[j] = [
			new Date(packed[i] * 60000),
			Math.round((100 - packed[i + 1]) * 1000) / 1000,
			Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			packed[i + 3],
		];
	}
	return rows;
}

async function makeChart(data, host, wait) {
	if (!prepared.has(globalThis.google?.charts))
		throw new Error('Await googlecharts.prepareRuntime() outside timed initialization before makeChart().');
	const {DataTable, LineChart, events} = google.visualization;
	let chart;
	let timer;
	const listeners = [];
	try {
		const table = new DataTable();
		table.addColumn('datetime', 'Time');
		for (const name of ['CPU', 'RAM', 'TCP Out'])
			table.addColumn('number', name);
		table.addRows(data);
		chart = new LineChart(host);
		await new Promise((resolve, reject) => {
			listeners.push(events.addListener(chart, 'ready', resolve));
			listeners.push(events.addListener(chart, 'error', event => reject(new Error(`Google Charts: ${event.message ?? event.id ?? 'draw failed'}`))));
			timer = setTimeout(() => reject(new Error('Google Charts did not become ready within 30 seconds.')), 30000);
			chart.draw(table, {
				width: 1920,
				height: 600,
				title: 'Server Events',
				colors: ['red', 'blue', 'green'],
				lineWidth: 1 / devicePixelRatio,
				pointSize: 0,
				pointsVisible: false,
				animation: {duration: 0, startup: false},
				legend: {position: 'bottom'},
				series: {0: {targetAxisIndex: 0}, 1: {targetAxisIndex: 0}, 2: {targetAxisIndex: 1}},
				// Quote the percent sign: values are already percentages, not fractions.
				vAxes: {0: {format: "0.##'%'"}, 1: {format: "0.##' MB'"}},
			});
		});
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
	finally {
		clearTimeout(timer);
		for (const listener of listeners)
			events.removeListener(listener);
	}
}

function destroyChart(chart) {
	try { google.visualization.events.removeAllListeners(chart); }
	finally { chart.clearChart(); }
}

export {prepData, prepareRuntime, makeChart, destroyChart};
