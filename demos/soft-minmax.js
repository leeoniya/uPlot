import { plotStep } from './renderDemo.js';

const fmt = value => Number(value.toPrecision(6)).toString();

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

function minimumPolicies() {
	const opts = baseOptions();

	let data = [
		[0,10],
		[5,12],
	];

	let plots = [
		{
			title: "Padding only",
			descr: "No limits or zero affinity. Each side adds 20% of the data span, then rounds the bounds. Compare this baseline with the other policies.",
			scales: {
				y: {
					range: {
						zeroIf: 0,
						min: {pad: 0.2},
						max: {pad: 0.2},
					}
				},
			},
		},
		{
			title: "Soft bounds: -10 to 10",
			descr: "Use -10 and 10 while the data stays inside those endpoints. When data crosses an endpoint, padding applies again on that side. No data is clipped.",
			scales: {
				y: {
					range: {
						zeroIf: 0,
						min: {pad: 0.2, soft: -10},
						max: {pad: 0.2, soft: 10},
					}
				},
			},
		},
		{
			title: "Hard bounds: -10 to 10",
			descr: "The range cannot extend below -10 or above 10. Data outside these limits is clipped. Unlike soft bounds, hard bounds do not expand a smaller range to the limits.",
			scales: {
				y: {
					range: {
						zeroIf: 0,
						min: {pad: 0.2, hard: -10},
						max: {pad: 0.2, hard: 10},
					}
				},
			},
		},
		{
			title: "Include nearby zero (25%)",
			descr: "Anchor zero when its distance from the data is at most 25% of the raw data span. With the first value at 5, increasing the second to 25 reaches this threshold: 5 = 0.25 × (25 − 5).",
			scales: {
				y: {
					range: {
						zeroIf: 0.25,
						min: {pad: 0.2},
						max: {pad: 0.2},
					}
				},
			},
		},
		{
			title: "Soft ±20, hard ±50",
			descr: "Each bound anchors at its soft limit until the data crosses it. Then 20% padding selects an outer tick, capped at the hard limit. Data beyond ±50 is clipped. Try 12, 30, 45, and 60, then negative values.",
			scales: {
				y: {
					axis: 1,
					range: {
						zeroIf: 0,
						min: {pad: 0.2, soft: -20, hard: -50},
						max: {pad: 0.2, soft: 20, hard: 50},
					}
				},
			},
		},
	];

	return plots.map(o => {
		const readout = document.createElement("output");
		readout.className = "range-readout";
		return uPlot(uPlot.assign({}, opts, o, {
			legend: {
				mount(u) {
					let p = document.createElement("p");
					p.textContent = o.descr;

					u.root.append(p, readout);
				},
			},
			hooks: {
				draw: [u => {
					const { min, max } = u.series[1];
					const scale = u.scales.y;
					const clipped = min < scale.min || max > scale.max;
					readout.value = `Data: [${fmt(min)}, ${fmt(max)}] | Scale: [${fmt(scale.min)}, ${fmt(scale.max)}]${clipped ? ' | clipped' : ''}`;
				}],
			},
		}), data, document.body);
	});
}

function flatZero() {
	let opts = uPlot.assign({}, baseOptions(), {
		title: "min: {soft: -1}, max: {soft: 1}",
		scales: {
			y: {
				range: {
					min: {
						soft: -1,
						pad: 0.2,
					},
					max: {
						soft: 1,
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

function tinyRange() {
	const data = [
		Array.from({length: 50}, (_, i) => i),
		Array.from({length: 50}, () => 10 + (Math.random() * 2 - 1) * 1e-7),
	];
	// Keep the span between the two thresholds for every random sample.
	data[1][0] = 10 - 1e-7;
	data[1][49] = 10 + 1e-7;

	return [
		[1e-7, "Default threshold treats the tiny variation as flat. The Y range expands to [0, 20]."],
		[1e-9, "The smaller threshold preserves the same tiny variation. The Y range fits the data with 20% padding."],
	].map(([flat, descr]) => {
		const readout = document.createElement("output");
		readout.className = "range-readout";
		return uPlot(uPlot.assign({}, baseOptions(), {
			title: `Tiny random range: flat = ${flat}`,
			width: 500,
			scales: {
				y: {
					range: {
						flat,
						min: {pad: 0.2},
						max: {pad: 0.2},
					},
				},
			},
			axes: [{}, {size: 140}],
			legend: {
				mount(u) {
					const p = document.createElement("p");
					p.textContent = descr;
					u.root.append(p, readout);
				},
			},
			hooks: {
				draw: [u => {
					const {min, max} = u.series[1];
					const scale = u.scales.y;
					readout.value = `Data: [${min.toPrecision(12)}, ${max.toPrecision(12)}] | Span: ${(max - min).toExponential(3)} | Scale: [${scale.min.toPrecision(12)}, ${scale.max.toPrecision(12)}]`;
				}],
			},
		}), data, document.body);
	});
}

// Leave the independent flat-data examples unchanged.
export function setDataValue(plots, value) {
	if (!Number.isFinite(value))
		return;

	const current = plots[0].data;
	const data = [current[0], [current[1][0], value]];
	plots.slice(0, 5).forEach(u => u.setData(data));
}

export function bindControls(plots, root = document) {
	const slider = root.querySelector('#data-value');
	const output = root.querySelector('#data-value-output');
	const update = () => {
		setDataValue(plots, slider.valueAsNumber);
		output.value = slider.value;
	};

	slider.addEventListener('input', update);
	update();
	return () => slider.removeEventListener('input', update);
}

export default [{
	steps: [plotStep(minimumPolicies), plotStep(flatZero)],
}, {
	name: "Tiny random data: flat thresholds",
	steps: [plotStep(tinyRange)],
}];
