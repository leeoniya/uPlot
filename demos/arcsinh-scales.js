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

	let linthresh = 1;

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
				asinh: () => linthresh,
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

	let u7 = new uPlot(opts7, data7, document.querySelector('#manual-plot') || document.body);

	let label = document.querySelector("#thresh-label");
	let input = document.querySelector("#linthresh");

	// The snapshot harness renders the chart without the page controls.
	if (input && label) {
		input.oninput = e => {
			linthresh = round6(Math.pow(10, +e.target.value));
			label.textContent = "Linear threshold: " + linthresh;
			u7.redraw(true, true);
		};
	}

	return u7;
}

function renderAdaptive() {
	let values = [];

	for (let exp = -3; exp < 3; exp++) {
		for (let i = 1; i < 10; i++)
			values.push(Number((i * 10 ** exp).toPrecision(6)));
	}

	values.push(1000);
	values = values.slice().reverse().map(v => -v).concat(values);

	let data = [values.map((v, i) => i + 1), values];
	let label = document.querySelector('#slice-label');
	let input = document.querySelector('#data-min');
	let threshold = document.querySelector('#adaptive-threshold');

	let u = new uPlot({
		width: 1600,
		height: 600,
		title: 'Adaptive ArcSinh Y Scale',
		scales: {
			x: { time: false },
			y: { distr: 4 },
		},
		series: [
			{},
			{ stroke: 'blue', fill: 'rgba(0,0,255,0.1)' },
		],
		hooks: {
			setScale: [(u, key) => {
				if (key == 'y' && threshold)
					threshold.textContent = 'Adaptive linear threshold: ' + u.scales.y._asinh;
			}],
		},
	}, data, document.querySelector('#adaptive-plot') || document.body);

	if (input && label) {
		input.oninput = e => {
			let min = 10 ** +e.target.value;
			let start = values.findIndex(v => v >= min);
			label.textContent = 'Minimum absolute Y value: ' + min;
			u.setData(data.map(values => values.slice(0, values.length - start).concat(values.slice(start))));
		};
	}

	return u;
}

export default [{
	steps: [plotStep(render)],
}, {
	steps: [plotStep(renderAdaptive)],
}];
