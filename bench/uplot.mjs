function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	console.time("prep");

	// epoch,idl,recv,send,writ,used,free

	const numFields = packed[0];

	const start = numFields + 1;
	const len = (packed.length - start) / numFields;

	// 55,550 data points x 3 series = 166,650
	let data = [
		Array(len),
		Array(len),
		Array(len),
		Array(len),
	];

	for (let i = start, j = 0; i < packed.length; i += numFields, j++) {
		data[0][j] = packed[i] * 60;	// * 1e3
		data[1][j] = round3(100 - packed[i+1]);
		data[2][j] = round2(100 * packed[i+5] / (packed[i+5] + packed[i+6]));
		data[3][j] = packed[i+3];
	}

/*
	function filter(d) {
		return d.filter((d, i) => Math.round(i/1000) % 5 != 2);
	}

	data[0] = filter(data[0]);
	data[1] = filter(data[1]);
	data[2] = filter(data[2]);
	data[3] = filter(data[3]);
*/
/*
	data[0] = data[0].slice(0, 1000);
	data[1] = data[1].slice(0, 1000);
	data[2] = data[2].slice(0, 1000);
	data[3] = data[3].slice(0, 1000);

	data[1][35] = null;
	data[1][36] = null;
	data[2][730] = null;
*/
	console.timeEnd("prep");

	return data;
}

function makeChart(data, host, wait) {
	console.time("chart");

	const opts = {
		title: "Server Events",
		width: 1920,
		height: 600,
		cache: {paths: false},
	//	ms:     1,
	//	cursor: {
	//		x: false,
	//		y: false,
	//	},
		series: [
			{},
			{
				label: "CPU",
				scale: "%",
				value: (u, v) => v == null ? null : v.toFixed(1) + "%",
				stroke: "red",
				width: 1/devicePixelRatio,
			},
			{
				label: "RAM",
				scale: "%",
				value: (u, v) => v == null ? null : v.toFixed(1) + "%",
				stroke: "blue",
				width: 1/devicePixelRatio,
			},
			{
				label: "TCP Out",
				scale: "mb",
				value: (u, v) => v == null ? null : v.toFixed(2) + " MB",
				stroke: "green",
				width: 1/devicePixelRatio,
			}
		],
		axes: [
			{},
			{
				scale: "%",
				values: (u, vals, space) => vals.map(v => +v.toFixed(1) + "%"),
			},
			{
				side: 1,
				scale: "mb",
				size: 60,
				values: (u, vals, space) => vals.map(v => +v.toFixed(2) + " MB"),
				grid: {show: false},
			},
		],
	};

	let uplot = new uPlot(opts, data, host);

	Promise.resolve().then(() => {
		wait.textContent = "Done!";
		console.timeEnd("chart");
	});

	return uplot;
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], [], []], host, wait ?? {textContent: ''});
}

async function updateChart(chart, input, host, wait) {
	chart.setData(input, true);
	// uPlot batches its commit in a microtask, as in makeChart.
	await Promise.resolve();
	if (wait) wait.textContent = 'Done!';
}

export {makeEmptyChart, updateChart};
export {makeChart, prepData};
