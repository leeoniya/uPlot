import { plotStep } from './renderDemo.js';

function render() {
	let vals7 = [];

	function round6(val) {
		return Math.round(val * 1e6) / 1e6;
	}

	let mags = [-3,-2,-1,0,1,2];

	mags.forEach(m => {
		for (let i = 1; i < 10; i++)
			vals7.push(round6(i * Math.pow(10, m)));
	});

	vals7.push(round6(10 * Math.pow(10, mags[mags.length - 1])));

	vals7 = vals7.slice().reverse().map(v => -v).concat(0, vals7);

	let data7 = [
		vals7.map((v, i) => i + 1),
		vals7,
	];

	const opts7 = {
		width: 1600,
		height: 600,
		title: "ArcSinh Y Scale",
		scales: {
			x: {
				time: false,
			},
			y: {
				distr: 4,
				log: 10,
				asinh: 1,
			},
		},
		series: [
			{},
			{
				stroke: "blue",
				fill: "rgba(0,0,255,0.1)",
			},
		],
	};

	let u7 = new uPlot(opts7, data7, document.body);

	let label = document.querySelector("#thresh-label");
	let input = document.querySelector("#linthresh");

	// The snapshot harness renders the chart without the page controls.
	if (input && label) {
		input.oninput = e => {
			let val = round6(Math.pow(10, +e.target.value));
			label.textContent = "Linear threshold: " + val;
			let sc = u7.scales.y;
			sc.asinh = val;
			sc._min = Math.asinh(sc.min / val);
			sc._max = Math.asinh(sc.max / val);
			u7.redraw(true, true);
		};
	}

	return u7;
}

export default [{
	steps: [plotStep(render)],
}];
