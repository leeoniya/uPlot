import { plotStep } from './renderDemo.js';

function makeChart() {
	console.time('chart');

	let opts = {
		title: "Derived Scale",
		width: 600,
		height: 400,
		scales: {
			x: {
				time: false
			},
			z: {
				from: 'y',
				range: (u, min, max) => [(min - 32) * 5/9, (max - 32) * 5/9],
			}
		},
		series: [
			{},
			{
				label: "blah",
				stroke: "green",
			},
		],
		axes: [
			{},
			{
				values: (u, vals, space) => vals.map(v => v + '° F'),
			},
			{
				scale: 'z',
				range: (u, min, max) => [Math.ceil(min), Math.ceil(max)],
				values: (u, vals, space) => vals.map(v => v + '° C'),
				side: 1,
				grid: {show: false},
				space: 20,
			}
		],
	};

	const data = [
		[ 1, 2, 3, 4, 5, 6, 7],
		[40,43,60,65,71,73,80],
	];

	let u = new uPlot(opts, data, document.body);

	console.timeEnd('chart');

	return u;
}

const groups = [
	{
		steps: [
			plotStep(makeChart)
		]
	},
];

export default groups;
