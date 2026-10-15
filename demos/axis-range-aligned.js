import uPlot from '../src/uPlot.js';
import { createD3CanvasAligned } from './lib/d3CanvasAligned.js';
import { createRandomWalk } from './lib/randomWalk.js';

function walk(start, spread) {
	const randomWalk = createRandomWalk();
	return [start, ...randomWalk(0, 500).map(value => start + value * spread)];
}

export function createDemo(root) {
	const form = root.querySelector('#walk-controls');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value');
	const ramp = root.querySelector('#ramp');
	const rampValue = root.querySelector('#ramp-value');
	const exactCount = root.querySelector('#exact-count');
	const randomize = root.querySelector('#randomize');
	const precision = root.querySelector('#decimal-precision');
	const reset = root.querySelector('#reset-zoom');
	const stats = root.querySelector('#stats');
	const plot = root.querySelector('#plot');
	const d3Stats = root.querySelector('#d3-stats');
	const d3Plot = root.querySelector('#d3-plot');
	const d3Ranging = root.querySelector('#d3-ranging');
	const d3Options = () => ({ ramp: ramp.valueAsNumber, exact: exactCount.checked, useUplot: d3Ranging.checked });
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

	const data = getData();
	let d3Chart;
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
			{ scale: 'left', side: 3, size: 100, stroke: '#1769aa', ramp: ramp.valueAsNumber, exact: exactCount.checked },
			{ scale: 'right', side: 1, size: 100, stroke: '#b34a00', ramp: ramp.valueAsNumber, exact: exactCount.checked, grid: { show: false } },
		],
		series: [
			{ label: 'Sample' },
			{ label: 'Left', scale: 'left', stroke: '#1769aa', points: { show: false } },
			{ label: 'Right', scale: 'right', stroke: '#b34a00', points: { show: false } },
		],
		hooks: {
			draw: [readout],
			destroy: [() => {
				d3Chart?.destroy();
				window.removeEventListener('resize', resize);
				height.removeEventListener('input', resize);
				ramp.removeEventListener('input', setRamp);
				exactCount.removeEventListener('change', setRamp);
				d3Ranging.removeEventListener('change', setD3Ranging);
				form.removeEventListener('submit', regenerate);
				randomize.removeEventListener('click', randomSettings);
				precision.removeEventListener('click', decimalPrecision);
				reset.removeEventListener('click', resetZoom);
			}],
		},
	}, data, plot);

	if (globalThis.d3 != null && d3Plot != null)
		d3Chart = createD3CanvasAligned(globalThis.d3, d3Plot, d3Stats, data, { width: width(), height: height.valueAsNumber }, d3Options());

	function resize() {
		heightValue.value = `${height.value}px`;
		const size = { width: width(), height: height.valueAsNumber };
		u.setSize(size);
		d3Chart?.setSize(size);
	}

	function setRamp() {
		rampValue.value = ramp.value;
		u.axes[1].ramp = u.axes[2].ramp = ramp.valueAsNumber;
		u.axes[1].exact = u.axes[2].exact = exactCount.checked;
		u.redraw(false, true);
		setD3Ranging();
	}

	function setD3Ranging() {
		d3Chart?.setRanging(d3Options());
	}

	function regenerate(event) {
		event?.preventDefault();
		if (form.reportValidity()) {
			const data = getData();
			u.setData(data);
			d3Chart?.setData(data);
		}
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

	function decimalPrecision() {
		height.value = 450;
		ramp.value = 1;
		exactCount.checked = true;
		controls.forEach(({ start, spread }, i) => {
			start.value = i == 0 ? 1 : .0001;
			spread.value = 0;
		});
		resize();
		setRamp();
		regenerate();
	}

	function resetZoom() {
		u.setScale('x', { min: null, max: null });
	}

	height.addEventListener('input', resize);
	ramp.addEventListener('input', setRamp);
	exactCount.addEventListener('change', setRamp);
	d3Ranging.addEventListener('change', setD3Ranging);
	window.addEventListener('resize', resize);
	form.addEventListener('submit', regenerate);
	randomize.addEventListener('click', randomSettings);
	precision.addEventListener('click', decimalPrecision);
	reset.addEventListener('click', resetZoom);
	return u;
}
