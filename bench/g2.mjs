// @antv/g2@5.4.8/dist/g2.min.js exposes G2 and includes its Canvas renderer (MIT).
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

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {renderer} = {}) {
	let chart;
	try {
		// Omitting renderer preserves G2's built-in Canvas renderer.
		chart = new G2.Chart({container: host, width: 1920, height: 600, autoFit: false, ...(renderer ? {renderer} : {})});
		chart.options({
			type: 'view',
			title: 'Server Events',
			data,
			animate: false,
			scale: {
				x: {type: 'time', nice: false},
				color: {type: 'ordinal', domain: ['CPU', 'RAM', 'TCP Out'], range: ['red', 'blue', 'green']},
			},
			legend: {color: {position: 'bottom'}},
			children: ['cpu', 'ram', 'tcp'].map((key, i) => ({
				type: 'line',
				encode: {x: 'time', y: key, color: {type: 'constant', value: ['CPU', 'RAM', 'TCP Out'][i]}},
				// Explicit keys merge CPU/RAM domains without merging TCP into them.
				scale: {y: {type: 'linear', key: i === 2 ? 'tcp' : 'percent', nice: true, zero: false}},
				axis: {
					x: {title: false},
					y: {title: false, position: i === 2 ? 'right' : 'left', labelFormatter: value => i === 2 ? `${value} MB` : `${value}%`},
				},
				// An empty fill still triggers invisible polygon triangulation in WebGL.
				style: {lineWidth: 1 / devicePixelRatio, fill: 'none'},
				animate: false,
			})),
		});
		await chart.render();
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
}

async function updateChart(chart, input, host, wait) {
	await chart.changeData(input);
	if (wait) wait.textContent = 'Done!';
}

async function resizeChart(chart, {width, height}, host, wait) {
	await chart.changeSize(width, height);
	if (wait) wait.textContent = 'Done!';
}

function destroyChart(chart) {
	chart.destroy();
}

export {makeChartWithOptions};
export {prepData, makeChart, destroyChart, updateChart, resizeChart};
