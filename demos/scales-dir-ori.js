import { plotStep } from './renderDemo.js';

let xs = [-3,-2,-1,0,1,2,3,4,5,6];
let vals = [-10,-4,-2,-1,0,2,3,null,5,6];
let vals2 = [-2,2,-2,2,-2,2,-2,2,-2,2];

let data = [
	xs,
	vals,
	vals2,
];

function chart(opts) {
	opts = uPlot.assign({
		scales: {
			x: {
				time: false,
			},
		},
		focus: {
			alpha: 0.3,
		},
		cursor: {
			lock: true,
			drag: {
				x: true,
				y: true,
			},
			sync: {
				key: 1,
				scales: ["x", "y"],
			},
			focus: {
				prox: 30,
			}
		},
		series: [
			{},
			{
				stroke: "red",
				fill: "rgba(255,0,0,0.1)",
			},
			{
				stroke: "blue",
				fill: "rgba(0,0,255,0.1)"
			}
		],
	}, opts);

	return new uPlot(opts, data, document.body);
}

function createStep(opts, index) {
	return {
		breakAfter: index === 3 ? 1 : 0,
		...plotStep(() => chart(opts)),
	};
}

const groups = [
	{
		name: "Direction Inversion",
		steps: [
			{
				width: 600,
				height: 300,
				title: "+x bottom, +y left",
				scales: {
					x: {
						dir: 1,
						ori: 0,
					},
					y: {
						dir: 1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 2
					},
					{
						side: 3
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "+x bottom, -y left",
				scales: {
					x: {
						dir: 1,
						ori: 0,
					},
					y: {
						dir: -1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 2
					},
					{
						side: 3
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "-x bottom, -y left",
				scales: {
					x: {
						dir: -1,
						ori: 0,
					},
					y: {
						dir: -1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 2
					},
					{
						side: 3
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "-x bottom, +y left",
				scales: {
					x: {
						dir: -1,
						ori: 0,
					},
					y: {
						dir: 1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 2
					},
					{
						side: 3
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "+x top, +y right",
				scales: {
					x: {
						dir: 1,
						ori: 0,
					},
					y: {
						dir: 1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 0
					},
					{
						side: 1
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "+x top, -y right",
				scales: {
					x: {
						dir: 1,
						ori: 0,
					},
					y: {
						dir: -1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 0
					},
					{
						side: 1
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "-x top, -y right",
				scales: {
					x: {
						dir: -1,
						ori: 0,
					},
					y: {
						dir: -1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 0
					},
					{
						side: 1
					}
				],
			},
			{
				width: 600,
				height: 300,
				title: "-x top, +y right",
				scales: {
					x: {
						dir: -1,
						ori: 0,
					},
					y: {
						dir: 1,
						ori: 1,
					}
				},
				axes: [
					{
						side: 0
					},
					{
						side: 1
					}
				],
			},
		].map(createStep),
	},
	{
		name: "Orientation Inversion",
		steps: [
			{
				width: 320,
				height: 600,
				title: "+x left, +y top",
				scales: {
					x: {
						dir: 1,
						ori: 1,
					},
					y: {
						dir: 1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 3
					},
					{
						side: 0
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "+x left, -y top",
				scales: {
					x: {
						dir: 1,
						ori: 1,
					},
					y: {
						dir: -1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 3
					},
					{
						side: 0
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "-x left, -y top",
				scales: {
					x: {
						dir: -1,
						ori: 1,
					},
					y: {
						dir: -1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 3
					},
					{
						side: 0
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "-x left, +y top",
				scales: {
					x: {
						dir: -1,
						ori: 1,
					},
					y: {
						dir: 1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 3
					},
					{
						side: 0
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "+x right, +y bottom",
				scales: {
					x: {
						dir: 1,
						ori: 1,
					},
					y: {
						dir: 1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 1
					},
					{
						side: 2
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "+x right, -y bottom",
				scales: {
					x: {
						dir: 1,
						ori: 1,
					},
					y: {
						dir: -1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 1
					},
					{
						side: 2
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "-x right, -y bottom",
				scales: {
					x: {
						dir: -1,
						ori: 1,
					},
					y: {
						dir: -1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 1
					},
					{
						side: 2
					}
				],
			},
			{
				width: 320,
				height: 600,
				title: "-x right, +y bottom",
				scales: {
					x: {
						dir: -1,
						ori: 1,
					},
					y: {
						dir: 1,
						ori: 0,
					}
				},
				axes: [
					{
						side: 1
					},
					{
						side: 2
					}
				],
			},
		].map(createStep),
	},
];

export default groups;
