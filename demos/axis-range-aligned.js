import uPlot from '../src/uPlot.js';
import { createRandomWalk } from './lib/randomWalk.js';

function walk(start, spread) {
	const randomWalk = createRandomWalk();
	return [start, ...randomWalk(0, 500).map(value => start + value * spread)];
}

export function createDemo(root) {
	const form = root.querySelector('#walk-controls');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value');
	const randomize = root.querySelector('#randomize');
	const reset = root.querySelector('#reset-zoom');
	const stats = root.querySelector('#stats');
	const plot = root.querySelector('#plot');
	const controls = ['left', 'right'].map(key => ({
		start: root.querySelector(`#${key}-start`),
		spread: root.querySelector(`#${key}-spread`),
	}));
	const xs = Array.from({ length: 501 }, (_, i) => i);
	const width = () => Math.max(360, plot.clientWidth || 900);
	const fmt = value => value == null ? 'none' : Number(value.toPrecision(6)).toString();
	const getData = () => [xs, ...controls.map(({ start, spread }) => walk(start.valueAsNumber, spread.valueAsNumber))];

	function readout(u) {
		const lines = [`Plot height: ${fmt(u.bbox.height / u.pxRatio)}px`];
		for (const [i, key] of ['left', 'right'].entries()) {
			const scale = u.scales[key];
			const axis = u.axes[i + 1];
			lines.push(`${key}: ${axis._splits?.length ?? 0} ticks | ${fmt(scale.min)} … ${fmt(scale.max)} | increment ${fmt(axis._found?.[0])}`);
		}
		stats.textContent = lines.join('\n');
	}

	const u = new uPlot({
		width: width(),
		height: height.valueAsNumber,
		padding: [10, 0, 0, 0],
		cursor: { drag: { x: true, y: false } },
		scales: {
			x: { time: false },
			left: { axis: 1 },
			right: { axis: 2 },
		},
		axes: [
			{ size: 40 },
			{ scale: 'left', side: 3, size: 100, stroke: '#1769aa' },
			{ scale: 'right', side: 1, size: 100, stroke: '#b34a00', grid: { show: false } },
		],
		series: [
			{ label: 'Sample' },
			{ label: 'Left', scale: 'left', stroke: '#1769aa', points: { show: false } },
			{ label: 'Right', scale: 'right', stroke: '#b34a00', points: { show: false } },
		],
		hooks: {
			draw: [readout],
			destroy: [() => {
				window.removeEventListener('resize', resize);
				height.removeEventListener('input', resize);
				form.removeEventListener('submit', regenerate);
				randomize.removeEventListener('click', randomSettings);
				reset.removeEventListener('click', resetZoom);
			}],
		},
	}, getData(), plot);

	function resize() {
		heightValue.value = `${height.value}px`;
		u.setSize({ width: width(), height: height.valueAsNumber });
	}

	function regenerate(event) {
		event?.preventDefault();
		if (form.reportValidity())
			u.setData(getData());
	}

	function randomSettings() {
		const smallExp = Math.floor(Math.random() * 7) - 4;
		const exponents = [smallExp, smallExp + 3 + Math.floor(Math.random() * 3)];
		if (Math.random() < .5)
			exponents.reverse();
		controls.forEach(({ start, spread }, i) => {
			const magnitude = 10 ** exponents[i];
			start.value = Number(((Math.random() < .5 ? -1 : 1) * (1 + Math.random() * 8) * magnitude).toPrecision(4));
			spread.value = Number((magnitude * 10 ** (-2 + Math.random() * 2)).toPrecision(4));
		});
		regenerate();
	}

	function resetZoom() {
		u.setScale('x', { min: null, max: null });
	}

	height.addEventListener('input', resize);
	window.addEventListener('resize', resize);
	form.addEventListener('submit', regenerate);
	randomize.addEventListener('click', randomSettings);
	reset.addEventListener('click', resetZoom);
	return u;
}
