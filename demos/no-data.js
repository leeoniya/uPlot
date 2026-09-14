import { plotStep } from './renderDemo.js';

let onePoint = [
	[[-1], [  -1]],
	[[-1], [   0]],
	[[-1], [   1]],
	[[ 0], [  -1]],
	[[ 0], [   0]],
	[[ 0], [   1]],
	[[ 1], [  -1]],
	[[ 1], [   0]],
	[[ 1], [   1]],
];

let twoPointsFlatish = [
	[[0,1], [36,51]],
	[[0,1], [9.999999,10.000001]],
	[[0,1], [10,10]],
	[[0,1], [9.9999999,10.0000001]],
	[[0,1], [10000000.000027,9999999.999753]],
	[[0,1], [1,0.9999999]],
];

twoPointsFlatish.push(...twoPointsFlatish.map(data => [data[0], data[1].map(v => v * -1)]));

let twoPointsFlat = [
	[[0, 1], [-100, -100]],
	[[0, 1], [ -10,  -10]],
	[[0, 1], [  -1,   -1]],
	[[0, 1], [-0.1, -0.1]],
	[[0, 1], [   0,    0]],
	[[0, 1], [ 0.1,  0.1]],
	[[0, 1], [   1,    1]],
	[[0, 1], [  10,   10]],
	[[0, 1], [ 100,  100]],
];


const groups = [
	{
		steps: [
			plotStep(() => {
				let opts = {
					title: "Plot without data",
					width: 800,
					height: 400,
					scales: {
						x: {
							range(u, dataMin, dataMax) {
								if (dataMin == null)
									return [1566453600, 1566497660];

								return [dataMin, dataMax];
							}
						},
						y: {
							range(u, dataMin, dataMax) {
								if (dataMin == null)
									return [0, 100];

								return uPlot.rangeNum(dataMin, dataMax, 0.1, true);
							}
						},
					},
					series: [
						{},
						{},
					],
				};

				return new uPlot(opts, null, document.body);
			}),
			plotStep(() => {
				let opts2 = {
					title: "Plot without data 2",
					width: 800,
					height: 400,
					scales: {x: {time: false}},
					series: [{}, {stroke: "#000"}],
				};

				return new uPlot(opts2, [], document.body);
			}),
			plotStep(() => {
				return new uPlot({
					width: 800,
					height: 400,
					title: "1 point (time)",
					series: [{}, {stroke: "#000"}],
				}, [[1566453600],[1]], document.body);
			}),
			...[...onePoint, ...twoPointsFlatish, ...twoPointsFlat].map(data =>
				plotStep(() => new uPlot({
					width: 800,
					height: 400,
					title: "1 point - " + JSON.stringify(data),
					scales: {x: {time: false}},
					series: [{}, {stroke: "#000"}],
				}, data, document.body))
			),
			...[0, 0.015625].map(incr => ({
				id: incr == 0 ? 'large-flat-update' : 'large-near-flat-update',
				...plotStep(async () => {
					let x = Array.from({ length: 10 }, (_, i) => i);
					let u = new uPlot({
						width: 800,
						height: 400,
						title: `10 points updated to 1e14 + i * ${incr} (automatic Y range)`,
						scales: { x: { time: false } },
						series: [{}, { stroke: '#000' }],
					}, [x, x.map(i => 1e14 + i * 1e12)], document.body);
					await Promise.resolve();
					// 0.015625 is one representable step at 1e14, not a custom tick increment.
					u.setData([x, x.map(i => 1e14 + i * incr)]);
					return u;
				}),
			})),
		],
	},
];

export default groups;
