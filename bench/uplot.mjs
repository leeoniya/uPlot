import {hoverTargets, visibleText, nearHoverIndex} from './hover.mjs';

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

	return data;
}

function makeChart(data, host, wait, UPlot = uPlot) {
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

	let uplot = new UPlot(opts, data, host);

	Promise.resolve().then(() => {
		wait.textContent = "Done!";
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

async function resizeChart(chart, {width, height}, host, wait) {
	chart.setSize({width, height});
	await Promise.resolve();
	if (wait) wait.textContent = 'Done!';
}

function getHoverPlan(chart, input, host) {
	const rect = chart.over.getBoundingClientRect();
	const tolerance = (input[0].length - 1) / rect.width;
	const previousEvent = chart.cursor.event;
	const cells = chart.root.querySelectorAll('.u-legend .u-value');
	// Leave room for integer mouse hit testing at fractional plot boundaries.
	return {
		targets: hoverTargets(input[0].length, (index, seriesIndex) => ({
			x: Math.round(rect.left + chart.valToPos(input[0][index], 'x')),
			y: Math.round(rect.top + Math.max(2, Math.min(rect.height - 2,
				chart.valToPos(input[seriesIndex + 1][index], seriesIndex === 2 ? 'mb' : '%')))),
		})),
		verify(target) {
			const {seriesIndex} = target;
			const index = chart.cursor.idx;
			if (chart.data !== input || !chart.cursor.event || chart.cursor.event === previousEvent ||
				!nearHoverIndex(index, target, tolerance) || chart.legend.idx !== index ||
				chart.legend.idxs[seriesIndex + 1] !== index)
				return null;
			const value = input[seriesIndex + 1][index];
			if (!Number.isFinite(value)) return null;
			const expected = value.toFixed(seriesIndex === 2 ? 2 : 1) + (seriesIndex === 2 ? ' MB' : '%');
			const text = visibleText(cells[seriesIndex + 1]);
			return text === expected ? {index, seriesIndex, value, text} : null;
		},
	};
}

export {makeEmptyChart, updateChart, resizeChart, getHoverPlan};
export {makeChart, prepData};
