// based https://github.com/apache/incubator-echarts/blob/d4bf86c963feaa12d83e0d3bd9f9b2b6249233d7/test/sample-compare.html

function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	// epoch,idl,recv,send,writ,used,free

	const numFields = packed[0];
	const start = numFields + 1;
	const rows = (packed.length - start) / numFields;

	let data = new Float64Array(rows * 4);

	let off = 0;
	for (let i = start; i < packed.length; i += numFields) {
		data[off++] = packed[i] * 60 * 1000;
		data[off++] = round3(100 - packed[i + 1]);
		data[off++] = round2(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]));
		data[off++] = packed[i + 3];
	}

	return data;
}

function makeChart(data, host, wait) {
	let dom = host;

	let myChart = echarts.init(dom, null, {
		width: 1920,
		height: 600,
		devicePixelRatio
	});

	let opts = {
		animation: false,
		dataset: {
			source: data,
			dimensions: ["date", "cpu", "ram", "tcpout"]
		},
		tooltip: {
			trigger: "axis",
			transitionDuration: 0,
		},
		legend: {},
		grid: {
			containLabel: true,
			left: 0,
			top: 50,
			right: 0,
			bottom: 30
		},
		xAxis: {
			type: "time"
		},
		yAxis: [
			{
				type: "value",
				position: "left",
				axisLabel: {
					formatter: "{value} %"
				}
			},
			{
				type: "value",
				position: "right",
				axisLabel: {
					formatter: "{value} MB"
				}
			}
		],
		series: [
			{
				name: "CPU",
				yAxisIndex: 0,
				z: 0,
				type: "line",
				showSymbol: false,
				sampling: "minmax",
				lineStyle: { width: 1 },
				emphasis: {
					disabled: true,
				},
				encode: {
					x: "date",
					y: "cpu"
				}
			},
			{
				name: "RAM",
				z: 1,
				type: "line",
				yAxisIndex: 0,
				showSymbol: false,
				sampling: "minmax",
				lineStyle: { width: 1 },
				emphasis: {
					disabled: true,
				},
				encode: {
					x: "date",
					y: "ram"
				}
			},
			{
				name: "TCP Out",
				z: 2,
				type: "line",
				yAxisIndex: 1,
				showSymbol: false,
				sampling: "minmax",
				lineStyle: { width: 1 },
				emphasis: {
					disabled: true,
				},
				encode: {
					x: "date",
					y: "tcpout"
				}
			}
		]
	};

	myChart.setOption(opts, {
		notMerge: true
	});

	wait.textContent = "Done!";
	return myChart;
}

function updateChart(chart, input, host, wait) {
	// The configured line series are non-progressive and animation is disabled:
	// setOption flushes their render synchronously, just as in makeChart.
	chart.setOption({dataset: {source: input}}, {lazyUpdate: false});
	if (wait) wait.textContent = 'Done!';
}

export function resizeChart(chart, {width, height}, host, wait) {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			chart.off('finished', finished);
		};
		const finished = () => {
			cleanup();
			if (wait) wait.textContent = 'Done!';
			resolve();
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error('ECharts resize render completion timed out.'));
		}, 30000);
		// resize can paint the old display list before relaying out the series.
		// Wait for the subsequent finished event, not just the resize return.
		chart.on('finished', finished);
		try { chart.resize({width, height, animation: {duration: 0}}); }
		catch (error) { cleanup(); reject(error); }
	});
}

export {updateChart};
export {makeChart, prepData};
