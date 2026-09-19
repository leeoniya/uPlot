import { plotStep } from './renderDemo.js';

function h1(text) {
	let el = document.createElement("h1");
	el.textContent = text;
	document.body.appendChild(el);
};

function baseOptions() {
	return {
		width: 400,
		height: 400,
		scales: {
			x: {time: false}
		},
		series: [
			{},
			{
				stroke: "blue",
				fill: "rgba(0,0,255,0.1)",
			},
		],
	};
}

function softMinimumModes() {
	const opts = baseOptions();

//	h1("");
	let data = [
		[0,10],
		[5,12],
	];

	let plots = [
		{
			title: "min: {soft: 0, mode: 0}",
			descr: "With min.mode: 0 or min.soft: null, the scaleMin will always be a constant % [of the full range] below dataMin.",
			scales: {
				y: {
					range: {
						min: {
							pad: 0.2,
							soft: 0,
							mode: 0,
						},
						max: {
							pad: 0.2,
							soft: 0,
							mode: 2,
						},
					}
				},
			},
		},
		{
			title: "min: {soft: 0, mode: 1}",
			descr: "With min.mode: 1, the scaleMin will be min.soft unless dataMin goes below it. This is probably how most would expect a softMin setting to behave.",
			scales: {
				y: {
					range: {
						min: {
							pad: 0.2,
							soft: 0,
							mode: 1,
						},
						max: {
							pad: 0.2,
							soft: 0,
							mode: 2,
						},
					}
				},
			},
		},
		{
			title: "min: {soft: 0, mode: 2}",
			descr: "With min.mode: 2, the scaleMin will be min.soft unless (dataMin - pad) goes below it.",
			scales: {
				y: {
					range: {
						min: {
							pad: 0.2,
							soft: 0,
							mode: 2,
						},
						max: {
							pad: 0.2,
							soft: 0,
							mode: 2,
						},
					}
				},
			},
		},
		{
			title: "min: {soft: 0, mode: 3}",
			descr: "With min.mode: 3, the scaleMin will be a constant % [of the full range] below dataMin until (dataMin - pad) goes below it. This is uPlot's default mode - it provides a conditioned softMin - keeping more vertical resolution when the value range is small and far from softMin.",
			scales: {
				y: {
					range: {
						min: {
							pad: 0.2,
							soft: 0,
							mode: 3,
						},
						max: {
							pad: 0.2,
							soft: 0,
							mode: 3,
						},
					}
				},
			},
		},
	];

	return plots.map(o => uPlot(uPlot.assign({}, opts, o, {
		legend: {
			mount(u) {
				let p = document.createElement("p");
				p.textContent = o.descr;
				u.root.appendChild(p);
			},
		},
	}), data, document.body));
}

function flatZero() {
	let opts = uPlot.assign({}, baseOptions(), {
		title: "min: {soft: -1, mode: 2}, max: {soft: 1, mode: 2}",
		scales: {
			y: {
				range: {
					min: {
						soft: -1,
						mode: 2,
						pad: 0.2,
					},
					max: {
						soft: 1,
						mode: 2,
						pad: 0.2,
					},
				}
			},
		}
	});

	return uPlot(opts, [
		[1,2],
		[0,0],
	], document.body);
}

// Accept the flattened renderDemo result; leave the independent zero plot unchanged.
export function incrementDataMax(plots) {
	const data = plots[0].data;
//	data[1][0] -= 0.1;
	data[1][1] += .1;
	plots.slice(0, 4).forEach(u => {
		u.setData(data);
	});
}

export default [{
	steps: [plotStep(softMinimumModes), plotStep(flatZero)],
}];
