import uPlot from '../src/uPlot.js';
import { barChartPlugin } from './lib/barChartPlugin.js';
import { createBarControls } from './lib/barControls.js';

export function createDemo(root) {
	const adjectives = ['Tiny', 'Bright', 'Quiet', 'Swift', 'Gentle', 'Bold', 'Silver', 'Merry'];
	const nouns = ['fox', 'owl', 'panda', 'otter', 'tiger', 'robin', 'badger', 'raven'];
	const verbs = ['runs', 'jumps', 'sings', 'rests', 'dances', 'glides', 'swims', 'plays'];
	const pick = words => words[Math.floor(Math.random() * words.length)];
	let bars;
	let u;
	const controls = createBarControls(root, {
		getPlot: () => u,
		getControls: () => bars._controls,
		rebuild(size) {
			const { data, pxRatio } = u;
			const shown = u.series.map(series => series.show);
			u.destroy();
			u = createPlot(data, size, pxRatio, shown);
		},
		regenerate: () => u.setData(newData()),
	});

	function newData() {
		const names = Array.from({ length: 3 + Math.floor(Math.random() * 13) }, () => {
			const count = 1 + Math.floor(Math.random() * 3);
			const words = count == 1 ? [pick(nouns)] : [pick(adjectives), pick(nouns)];
			if (count == 3)
				words.push(pick(verbs));
			return words.join(' ');
		});
		const magnitude = 10 ** (Math.floor(Math.random() * 13) - 5);
		const offset = magnitude * (Math.random() * 2 - 1);
		const spread = magnitude * (.5 + Math.random() * 1.5);
		return [names, names.map(() => offset + spread * Math.random()), names.map(() => offset + spread * Math.random())];
	}

	function createPlot(data, size, pxRatio, shown) {
		const mode = controls.stacking();
		const percent = mode == 'percent';
		bars = barChartPlugin(controls.options());
		return new uPlot({
			...size,
			pxRatio,
			stack: mode == 'grouped' ? undefined : { groups: [{ series: [1, 2], dir: 0 }], percent },
			...(percent ? {
				scales: { y: { range: (u, min, max) => min < 0 ? [-1, max > 0 ? 1 : 0] : [0, 1] } },
				axes: [{}, { values: (u, splits) => splits.map(value => `${Math.round(value * 100)}%`) }],
			} : {}),
			series: [
				{ label: 'Item' },
				{ label: 'Value', fill: 'royalblue' },
				{ label: 'Other value', fill: 'darkorange' },
			].map((series, i) => ({ ...series, show: shown?.[i] ?? true })),
			plugins: [bars],
			hooks: { draw: [controls.readout] },
		}, data, root.querySelector('#plot'));
	}

	u = createPlot(newData(), controls.initialSize());

	return {
		get plot() { return u; },
		destroy() {
			controls.destroy();
			u?.destroy();
			u = null;
		},
	};
}
