import { plotStep } from './renderDemo.js';
import { getStackedOpts, stack2 } from './stack.js';

function stackedChart(title, series, _data, interp, width = 800, height = 400) {
	let { opts, data } = getStackedOpts(title, series, _data, interp);
	opts.title = title;
	opts.width = width;
	opts.height = height;
/*
	Object.assign(opts.scales.x, {
		ori: 1,
		dir: -1,
	});
	Object.assign(opts.scales.y, {
		ori: 0,
		dir: 1,
	});
*/
	return new uPlot(opts, data, document.body);
}

function paragraph(html) {
	const p = document.createElement('p');
	p.innerHTML = html;
	document.body.appendChild(p);
}

function stackingOrderComparison() {
	paragraph('So you think you want a stacked series chart? Trust me, <a href="https://web.archive.org/web/20221208193656/https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html"><strong>you don\'t</strong></a>. uPlot does not provide this functionality in the core, both out of principle and because it requires inter-series data aggregation. However, if you really need to mislead people with shitty charts, you can still technically get it done.');
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
		null,
		1600,
		400,
	);
}

function interpolatedStacking() {
	let _;

	let data3 = [
		[0, 1, 2, 3, 4, 5],
		[0, 1, 2, 3, 4, 5],
		[5, 4, 3, _, 1, 0],
	];

	// interpolator takes raw data, returns data without nulls or undefineds (mock impl)
	function lerp(data) {
		let _data = data.slice();
		_data[2] = data[2].slice();
		_data[2][3] = 2;  // interpolated value (undefined -> 2)
		return _data;
	}

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
		lerp,
		1600,
		400,
	);

	document.body.appendChild(document.createElement('hr'));
	return plot;
}

function signedStackingOpts() {
	return {
		width: 400,
		height: 300,
		scales: {
			x: {
				time: false,
			}
		},
		series: [
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
			}
		],
	};
}

function signedStackingComparison() {
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10, -10, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,  -5,  -5,  -5],
	];

	const plots = [new uPlot(uPlot.assign({title: 'unstacked'}, opts5), data5, document.body)];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	plots.push(new uPlot(uPlot.assign({
		title: 'stacked',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body));
	return plots;
}

function undefinedStacking() {
	let _;
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10,   _, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,   _,  -5,  -5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacked, red=undef, green=undef',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function redNullStacking() {
	const n = null;
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10, -10, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,   n,  -5,  -5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacked, red=null',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function greenNullStacking() {
	const n = null;
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10,   n, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,  -5,  -5,  -5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacked, green=null',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function bothNullStacking() {
	const n = null;
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10,   n, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,   n,  -5,  -5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacked, red=null, green=null',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function zeroStacking() {
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-10, -10,   0, -10, -10],
		[ 10,  10,  10,  10,  10],
		[ -5,  -5,   0,  -5,  -5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacked, red=0, green=0',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function negatedNullStacking() {
	const n = null;
	let opts5 = {
		width: 400,
		height: 300,
		scales: {
			x: {
				time: false,
			}
		},
		series: [
			{},
			{
				stroke: 'green',
				fill: "rgba(0, 255, 0, 0.3)",
			},
			{
				stroke: 'red',
				fill: 'rgba(255, 0, 0, 0.3)',
			}
		],
	};

	let data5 = [
		[  0,   1,   2,   3,   4,   5],
		[  5,   5,   5,   n,   5,   5],
		[ 10,  10,   n,  10,  10,  10],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: true,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'unstacked, green negY, green=null, red=null',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function negatedZeroStacking() {
	let opts5 = {
		width: 400,
		height: 300,
		scales: {
			x: {
				time: false,
			}
		},
		series: [
			{},
			{
				stroke: 'green',
				fill: "rgba(0, 255, 0, 0.3)",
			},
			{
				stroke: 'red',
				fill: 'rgba(255, 0, 0, 0.3)',
			}
		],
	};

	let data5 = [
		[  0,   1,   2,   3,   4,   5],
		[  5,   5,   5,   0,   5,   5],
		[ 10,  10,   0,  10,  10,  10],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: true,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'unstacked, green negY, green=0, red=0',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function percentStacking() {
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[-25,  -8,  -1,  -3, -10],
		[ 10,  35, 100,  10,  10],
		[ -5,  -5,  -5,  -5,  -5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'percent',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'percent',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'percent',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'percent',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'neg percent stacked',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function stackingGroups() {
	let opts5 = signedStackingOpts();
	let data5 = [
		[  0,   1,   2,   3,   4],
		[  5,   5,   5,   5,   5],
		[ 25,   8,   1,   3,  10],
		[ 10,  35,  50,  10,  10],
		[  5,   5,   5,   5,   5],
	];

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'B',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'B',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[4],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacking groups',
		bands,
	}, opts5), [
		data5[0],
		...stackedData,
	], document.body);
}

function joinedMixedStacking() {
	let opts5 = signedStackingOpts();
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

	let series2 = [
		{
			scaleKey: 'axis-x1345',
			values: data5[1],
			negY: false,
			stacking: {
				mode: 'none',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[2],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
		{
			scaleKey: 'axis-x1345',
			values: data5[3],
			negY: false,
			stacking: {
				mode: 'normal',
				group: 'A',
			},
		},
	];

	let { data: stackedData, bands } = stack2(series2);

	return new uPlot(uPlot.assign({
		title: 'stacked joined/mixed',
		bands,
	}, opts5, {
		series: [
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
		],
	}), [
		data5[0],
		...stackedData,
	], document.body);
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
		plotStep(negatedNullStacking),
		plotStep(negatedZeroStacking),
		plotStep(percentStacking),
		plotStep(stackingGroups),
		plotStep(joinedMixedStacking),
	],
}];
