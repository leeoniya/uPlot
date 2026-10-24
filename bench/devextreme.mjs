// https://cdn3.devexpress.com/jslib/26.1.6/js/dx.viz.js is the minified production bundle.
// https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxChart/
// Evaluation warnings remain intact. Licensed runs must configure a valid v26.1 runtime key.
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

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {sampled = false} = {}) {
	let chart;
	try {
		let resolve, reject;
		const ready = new Promise((done, fail) => { resolve = done; reject = fail; });
		// Observe synchronous incidents even if construction subsequently throws.
		ready.catch(() => {});
		chart = new DevExpress.viz.dxChart(host, {
			size: {width: 1920, height: 600},
			title: 'Server Events',
			dataSource: data,
			animation: {enabled: false},
			dataPrepareSettings: {sortingMethod: false},
			commonSeriesSettings: {
				type: 'line', argumentField: 'time',
				width: 1 / devicePixelRatio,
				point: {visible: false},
				label: {visible: false},
				aggregation: sampled ? {enabled: true, method: 'avg'} : {enabled: false},
			},
			series: ['cpu', 'ram', 'tcp'].map((valueField, i) => ({
				valueField,
				axis: i === 2 ? 'tcp' : 'percent',
				name: ['CPU', 'RAM', 'TCP Out'][i],
				color: ['red', 'blue', 'green'][i],
			})),
			argumentAxis: {argumentType: 'datetime', type: 'continuous', ...(sampled ? {aggregationGroupWidth: 1} : {})},
			valueAxis: [
				{name: 'percent', position: 'left', label: {customizeText: ({valueText}) => `${valueText}%`}},
				{name: 'tcp', position: 'right', label: {customizeText: ({valueText}) => `${valueText} MB`}},
			],
			synchronizeMultiAxes: false,
			legend: {visible: true, verticalAlignment: 'bottom', horizontalAlignment: 'center'},
			onInitialized: e => { chart = e.component; },
			onDone: () => resolve(),
						// Empty series never emit done in 26.1.6; drawn still reports the axes render.
						onDrawn: () => { if (data.length === 0) resolve(); },
			onIncidentOccurred: ({target}) => {
				// W-codes include vendor evaluation notices; do not suppress them.
				if (target.id?.startsWith('E'))
					reject(new Error(`DevExtreme ${target.id}: ${target.text}`));
			},
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

function makeEmptyChart(host, wait) {
	return makeChart([], host, wait);
}

async function updateChart(chart, input, host, wait) {
	let done, incident;
	try {
		await new Promise((resolve, reject) => {
			done = resolve;
			incident = ({target}) => {
				if (target.id?.startsWith('E'))
					reject(new Error(`DevExtreme ${target.id}: ${target.text}`));
			};
			chart.on(input.length === 0 ? 'drawn' : 'done', done);
			chart.on('incidentOccurred', incident);
			chart.option('dataSource', input);
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally {
		chart.off(input.length === 0 ? 'drawn' : 'done', done);
		chart.off('incidentOccurred', incident);
	}
}

function destroyChart(chart) {
	chart.dispose();
}

export {prepData, makeChart, makeEmptyChart, updateChart, destroyChart, makeChartWithOptions};
