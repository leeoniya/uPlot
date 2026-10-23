// anychart@9.0.0: dist/js/anychart-core.min.js, then dist/js/anychart-stock.min.js.
// https://docs.anychart.com/Stock_Charts/Scales
// https://docs.anychart.com/Stock_Charts/Data_Grouping
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
	const handle = {chart: null, table: null, mappings: [], scales: []};
	let timer;
	let drawn;
	try {
		const chart = handle.chart = anychart.stock();
		chart.animation(false);
		chart.bounds(0, 0, 1920, 600);
		chart.title('Server Events');
		// Ordinal stock scales collapse missing calendar intervals.
		chart.xScale('scatter');
		chart.scroller().enabled(false);
		const plot = chart.plot(0);
		const percent = anychart.scales.linear();
		handle.scales.push(percent);
		const tcp = anychart.scales.linear();
		handle.scales.push(tcp);
		plot.yScale(percent);
		plot.yAxis(0).orientation('left').scale(percent).labels().format('{%Value}%');
		plot.yAxis(1).orientation('right').scale(tcp).labels().format('{%Value} MB');
		plot.legend().enabled(true);
		plot.legend().position('bottom');

		const table = handle.table = anychart.data.table(0);
		table.addData(data);
		for (let i = 0; i < 3; i++) {
			// Native calendar grouping remains enabled; average each gauge, not sum it.
			const mapping = table.mapAs({value: {column: i + 1, type: 'average'}});
			handle.mappings.push(mapping);
			const series = plot.line(mapping);
			series.name(['CPU', 'RAM', 'TCP Out'][i]);
			series.stroke({color: ['red', 'blue', 'green'][i], thickness: 1 / devicePixelRatio});
			series.yScale(i === 2 ? tcp : percent);
			series.normal().markers().enabled(false);
			series.hovered().markers().enabled(false);
			series.selected().markers().enabled(false);
		}
		chart.container(host);
		await new Promise((resolve, reject) => {
			drawn = resolve;
			chart.listenOnce('chartDraw', drawn);
			timer = setTimeout(() => reject(new Error('AnyStock did not finish drawing within 30 seconds.')), 30000);
			chart.draw();
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
		if (handle.chart && drawn)
			handle.chart.unlisten('chartDraw', drawn);
	}
}

function destroyChart(handle) {
	const {chart, table, mappings, scales} = handle;
	handle.chart = handle.table = null;
	handle.mappings = [];
	handle.scales = [];
	try { chart?.dispose(); }
	finally {
		try { for (const mapping of mappings) mapping.dispose(); }
		finally {
			try { table?.dispose(); }
			finally { for (const scale of scales) scale.dispose(); }
		}
	}
}

export {prepData, makeChart, destroyChart};
