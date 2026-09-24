import { plotStep } from './renderDemo.js';
import { seriesBarsPlugin } from './grouped-bars.js';

function makeChart(o, data) {
	let ori = o.ori;
	let dir = o.dir;
	let stacked = o.stacked;
	let series = o.series;

	const opts = {
		width:  ori == 0 ? 800 : 400,
		height: ori == 0 ? 400 : 800,
		scales: {
			y: {
				range: {
					min: {soft: 0},
					max: {soft: 0},
				},
				ori: ori == 0 ? 1 : 0,
			}
		},
		axes: [
			{},
			{
				side: ori == 0 ? 3 : 0,
			},
		],
		legend: {
			live: false,
			markers: {
				width: 0,
			}
		},
		padding: [null, 0, null, 0],
		series,
		plugins: [
			seriesBarsPlugin({
				ori,
				dir,
			}),
		],
	};

	if (stacked) {
		opts.stack = {
			groups: [{
				series: series.slice(1).map((_, i) => i + 1),
				dir: 0,
			}],
		};
	}

	return new uPlot(opts, data, document.body);
}

function multiGroupMultiBar() {
	// multi group, multi bar
	let data = [
		["Group A", "Group B", "Group C", "Group D"],
		[1, 2, 3, 10],
		[3, 2, 1, 10],
		[5, 9, 3, 10],
	];

	let series = [
		{},
		{
			label: "Metric 1",
			fill: "#33BB55",
			width: 0,
		},
		{
			label: "Metric 2",
			fill: "#B56FAB",
			width: 0,
		},
		{
			label:	"Metric 3",
			fill: "#BB1133",
			width: 0,
		},
	];

	const plots = [
		makeChart({series, ori: 0, dir:  1}, data),
		makeChart({series, ori: 0, dir: 1, stacked: true}, data),
	];

	document.body.appendChild(document.createElement("div"));

	plots.push(
		makeChart({series, ori: 1, dir: -1}, data),
		makeChart({series, ori: 1, dir: -1, stacked: true}, data),
	);

	document.body.appendChild(document.createElement("div"));
	return plots;
}

function multiGroupOneBar() {
	// multi group, one bar
	let data = [
		["Group A", "Group B", "Group C", "Group D"],
		[1, 2, 3, 10],
	];

	let series = [
		{},
		{
			label: "Metric 1",
			fill: "#33BB55",
			width: 0,
		},
	];

	const plots = [
		makeChart({series, ori: 0, dir:  1}, data),
		makeChart({series, ori: 0, dir: 1, stacked: true}, data),
	];

	document.body.appendChild(document.createElement("div"));
	return plots;
}

function oneGroupMultiBar() {
	// one group, multi bar
	let data = [
		["Group A"],
		[1],
		[3],
		[5],
	];

	let series = [
		{},
		{
			label: "Metric 1",
			fill: "#33BB55",
			width: 0,
		},
		{
			label: "Metric 2",
			fill: "#B56FAB",
			width: 0,
		},
		{
			label:	"Metric 3",
			fill: "#BB1133",
			width: 0,
		},
	];

	const plots = [
		makeChart({series, ori: 0, dir:  1}, data),
		makeChart({series, ori: 0, dir: 1, stacked: true}, data),
	];

	document.body.appendChild(document.createElement("div"));
	return plots;
}

function oneGroupOneBar() {
	// one group, one bar
	let data = [
		["Group A"],
		[1],
	];

	let series = [
		{},
		{
			label: "Metric 1",
			fill: "#33BB55",
			width: 0,
		},
	];

	const plots = [
		makeChart({series, ori: 0, dir:  1}, data),
		makeChart({series, ori: 0, dir: 1, stacked: true}, data),
	];

	document.body.appendChild(document.createElement("div"));
	return plots;
}

export default [{
	steps: [
		plotStep(multiGroupMultiBar),
		plotStep(multiGroupOneBar),
		plotStep(oneGroupMultiBar),
		plotStep(oneGroupOneBar),
	],
}];
