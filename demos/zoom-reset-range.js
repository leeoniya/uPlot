import { plotStep } from './renderDemo.js';

function createPlot() {
	const xs = Array.from({ length: 101 }, (_, i) => i);
	const ys = xs.map(x => 50 + 30 * Math.sin(x / 8));

	const opts = {
		title: 'Fit Y on zoom, reset Y to [0, 100]',
		width: 800,
		height: 400,
		scales: {
			x: { time: false },
			y: {
				scan: (u, scaleKey, i0, i1, viaAutoScaleX) =>
					viaAutoScaleX
						? [null, null]
						: uPlot.scan(u, scaleKey, i0, i1, true),

				range: (u, min, max) =>
					min == null || max == null
						? [0, 100]
						: uPlot.rangeNum(min, max, 0.1, true),
			},
		},
		series: [{}, { label: 'Value', stroke: 'royalblue' }],
	};

	return new uPlot(opts, [xs, ys], document.body);
}

export default [{ steps: [plotStep(createPlot)] }];
