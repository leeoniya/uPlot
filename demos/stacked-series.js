import { plotStep } from './renderDemo.js';

const signedStacks = {
	groups: [
		{series: [1, 3], dir: 1},
		{series: [2, 4], dir: -1},
	],
};

function stackedChart(title, series, data, {width = 800, height = 400, dir = 1} = {}) {
	return new uPlot(uPlot.assign({
		title,
		stack: {
			groups: [{
				series: series.slice(1).map((_, i) => i + 1),
				dir,
			}],
		},
	}, chartOpts(series, width, height)), data, document.body);
}

function paragraph(html) {
	const p = document.createElement('p');
	p.innerHTML = html;
	document.body.appendChild(p);
}

function stackingOrderComparison() {
	paragraph('So you think you want a stacked series chart? Trust me, <a href="https://web.archive.org/web/20221208193656/https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html"><strong>you don\'t</strong></a>. uPlot now provides integrated stacking, but this comparison still shows how stacking order can mislead.');
	paragraph('The two charts below <strong>show exactly the same data</strong> (did you notice?)');

	let xs = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],
		d1 = xs.map((t, i) => i < 15 ? 20 + i : i == 15 ? 15 : i == 16 ? 14 : i == 24 ? 20 : i == 28 ? 15 : i == 29 ? 0 : 30),
		d2 = xs.map((t, i) => i == 24 ? 20 : 10),
		d3 = Array(xs.length).fill(10),
		d4 = Array(xs.length).fill(5),
		d5 = Array(xs.length).fill(5);

	let series = [
		{
			fill: "rgba(165, 55, 253, 0.4)",
			stroke: "purple",
		},
		{
			fill: "rgba(255, 165, 0, 0.4)",
			stroke: "orange",
		},
		{
			fill: "rgba(0,0,255,0.3)",
			stroke: "blue",
		},
		{
			fill: "rgba(0,255,0,0.3)",
			stroke: "green",
		},
		{
			fill: "rgba(255,0,0,0.3)",
			stroke: "red",
		},
	];

	const plots = [stackedChart(
		"Stacked 1",
		[{}].concat(series),
		[xs, d1, d2, d3, d4, d5],
	)];

	plots.push(stackedChart(
		"Stacked 2",
		[{}].concat(series.reverse()),
		[xs, d5, d4, d3, d2, d1],
	));

	paragraph('In summary, <strong>JUST DON\'T.</strong>');
	return plots;
}

function stackedBars() {
	const { bars } = uPlot.paths;

	let data2 = [
		[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100],
		[109, 117, 122, 104, 105, 117, 119, 121, 117, 121, 122, 129, 119, 113, 113, 121, 108, 108, 100, 103, 113, 110, 107, 105, 99, 93, 87, 83, 91, 85, 81, 69, 76, 61, 63, 74, 76, 68, 55, 61, 48, 39, 54, 44, 37, 30, 22, 33, 29, 21, 22, 43, 47, 33, 47, 28, 29, 31, 32, 35, 37, 25, -5, -14, -7, -14, -7, -18, -18, -18, -16, -41, -22, -30, -27, -30, -47, -49, -47, -42, -55, -34, -27, -22, -23, -34, -23, -32, -36, -47, -33, -32, -18, -23, -21, -33, -39, -21, -18, -27, -5],
	];

	data2.push(data2[1].map(v => 100 + Math.round(v + Math.random() * 100)));
	data2.push(data2[2].map(v => 100 + Math.round(v + Math.random() * 100)));
	data2.push(data2[3].map(v => 100 + Math.round(v + Math.random() * 100)));

	data2[1] = data2[1].map(v => Math.max(0, v));
	data2[1].splice(22, 4, null, null, null, null);

	// generate bar builder with 60% bar (40% gap) & 100px max bar width
	const _bars60_100 = bars({size: [0.6, 100]});

	return stackedChart(
		"Bars Stacked",
		[
			{},
			{
				label:  "bars 1",
				stroke: "green",
				width:  2,
				fill:   "rgba(0, 255, 0, 0.3)",
				paths:  _bars60_100,
				points: {show: false},
			},
			{
				label:  "bars 2",
				stroke: "magenta",
				width:  2,
				fill:   "rgb(255, 0, 255, 0.3)",
				paths:  _bars60_100,
				points: {show: false},
			},
			{
				label:  "bars 3",
				stroke: "blue",
				width:  2,
				fill:   "rgba(0, 0, 255, 0.3)",
				paths:  _bars60_100,
				points: {show: false},
			},
			{
				label:  "bars 4",
				stroke: "red",
				width:  2,
				fill:   "rgba(255, 0, 0, 0.3)",
				paths:  _bars60_100,
				points: {show: false},
			},
		],
		data2,
		{width: 1600, dir: 0},
	);
}

function interpolatedStacking() {
	let _;

	let data3 = [
		[0, 1, 2, 3, 4, 5],
		[0, 1, 2, 3, 4, 5],
		[5, 4, 3, _, 1, 0],
	];

	// Complete the missing sample before plotting; it behaves like any other value.
	data3[2][3] = (data3[2][2] + data3[2][4]) / 2;

	const plot = stackedChart(
		"Stacked / Interpolated (at magenta x=3)",
		[
			{},
			{
				label:  "A",
				stroke: "green",
				fill:   "rgba(0, 255, 0, 0.3)",
				points:  {
					size: 8,
				}
			},
			{
				label:  "B",
				stroke: "magenta",
				fill:   "rgb(255, 0, 255, 0.3)",
				points:  {
					size: 8,
				}
			},
		],
		data3,
		{width: 1600},
	);

	document.body.appendChild(document.createElement('hr'));
	return plot;
}

function chartOpts(series, width = 400, height = 300) {
	series ??= [
		{},
		{
			stroke: 'blue',
			fill: "rgba(0, 0, 255, 0.3)",
		},
		{
			stroke: 'green',
			fill: "rgba(0, 255, 0, 0.3)",
		},
		{
			stroke: 'orange',
			fill: "rgba(255, 165, 0, 0.4)",
		},
		{
			stroke: 'red',
			fill: 'rgba(255, 0, 0, 0.3)',
		},
	];

	return {
		width,
		height,
		scales: {
			x: {
				time: false,
			},
			y: {
				range: {
					min: {mode: 1, soft: 0},
					max: {mode: 1, soft: 0},
				},
			},
		},
		series,
	};
}

function signedStackedChart(title, data, stack = signedStacks) {
	return new uPlot(uPlot.assign({title, stack}, chartOpts()), data, document.body);
}

function signedData(value, series = []) {
	const data = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10, -10, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,  -5,  -5,  -5],
	];

	for (const si of series)
		data[si][2] = value;

	return data;
}

function signedStackingComparison() {
	const data = signedData();
	return [
		new uPlot(uPlot.assign({title: 'unstacked'}, chartOpts()), data, document.body),
		signedStackedChart('stacked', data),
	];
}

function undefinedStacking() {
	return signedStackedChart('stacked, red=undef, green=undef', signedData(undefined, [2, 4]));
}

function redNullStacking() {
	return signedStackedChart('stacked, red=null', signedData(null, [4]));
}

function greenNullStacking() {
	return signedStackedChart('stacked, green=null', signedData(null, [2]));
}

function bothNullStacking() {
	return signedStackedChart('stacked, red=null, green=null', signedData(null, [2, 4]));
}

function zeroStacking() {
	return signedStackedChart('stacked, red=0, green=0', signedData(0, [2, 4]));
}

function percentStacking() {
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-25,  -8,  -1,  -3, -10],
		[ 10,  35, 100,  10,  10],
		[ -5,  -5,  -5,  -5,  -5],
	];

	return signedStackedChart('neg percent stacked', data5, {
		groups: signedStacks.groups,
		percent: true,
	});
}

function stackingGroups() {
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[ 25,   8,   1,   3,  10],
		[ 10,  35,  50,  10,  10],
		[  5,   5,   5,   5,   5],
	];

	return signedStackedChart('stacking groups', data5, {
		groups: [
			{series: [1, 4], dir: 1},
			{series: [2, 3], dir: 1},
		],
	});
}

function joinedMixedStacking() {
	let data5 = uPlot.join([
		[
			[  0,   1,   2,   3,   4],
			[  5,   5,   5,   5,   5],
		],
		[
			[  0.5,   1.5,   2.5],
			[    1,     2,     3],
			[    6,     7,     8],
		]
	]);

	let series = [
		{},
		{
			stroke: 'blue',
			fill: "rgba(0, 0, 255, 0.3)",
		},
		{
			stroke: 'green',
			fill: "rgba(0, 255, 0, 0.3)",
			paths: uPlot.paths.bars(),
		},
		{
			stroke: 'orange',
			fill: "rgba(255, 165, 0, 0.4)",
			paths: uPlot.paths.bars(),
		},
	];

	return new uPlot(uPlot.assign({
		title: 'stacked joined/mixed',
		stack: {
			groups: [{series: [2, 3], dir: 0}],
		},
	}, chartOpts(series)), data5, document.body);
}

function mixedSignBars(percent = false) {
	const data = [
		[ 0,  1,  2,  3,  4,    5],
		[ 3, -2,  4, -3,  3,    2],
		[ 2,  3, -2, -1,  0, null],
		[-4, -1,  2,  2, -2,   -3],
		[-1,  2, -3,  1, undefined, 1],
	];
	const paths = uPlot.paths.bars({size: [0.6, 60]});
	const opts = chartOpts(undefined, 600, 350);

	opts.series.slice(1).forEach((series, i) => Object.assign(series, {
		label: String.fromCharCode(65 + i),
		paths,
		points: {show: false},
	}));

	return new uPlot(uPlot.assign({
		title: percent ? 'Mixed-sign bars / percent' : 'Mixed-sign bars',
		stack: {
			groups: [{series: [1, 2, 3, 4], dir: 0}],
			percent,
		},
	}, opts), data, document.body);
}

export default [{
	steps: [
		plotStep(stackingOrderComparison),
		plotStep(stackedBars),
		plotStep(interpolatedStacking),
	],
}, {
	steps: [
		plotStep(signedStackingComparison),
		plotStep(undefinedStacking),
		plotStep(redNullStacking),
		plotStep(greenNullStacking),
		plotStep(bothNullStacking),
		plotStep(zeroStacking),
		plotStep(percentStacking),
		plotStep(stackingGroups),
		plotStep(joinedMixedStacking),
		plotStep(() => mixedSignBars()),
		plotStep(() => mixedSignBars(true)),
	],
}];
