import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from './lib/heatmapPlugin.js';

// Spectral, cool to warm; interpolate once rather than for each cell.
const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'];
const rgb = stops.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
const colorCount = 32;
const palette = Array.from({ length: colorCount }, (_, i) => {
	const t = i / (colorCount - 1) * (rgb.length - 1);
	const lo = Math.min(Math.floor(t), rgb.length - 2);
	return `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
});

// For round(sqrt(t) * (colorCount - 1)), transitions occur at odd squares
// when t is scaled by 4 * (colorCount - 1)^2. This keeps the lookup bins aligned.
const colorLookup = new Array(4 * (colorCount - 1) ** 2 + 1);
for (let i = 0; i < colorCount; i++)
	colorLookup.fill(i, i == 0 ? 0 : (2 * i - 1) ** 2, (2 * i + 1) ** 2);

export function createDemo(root, dashboard) {
	const frames = JSON.parse(dashboard.panels[0].targets[0].rawFrameContent);
	const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
	const field = name => frame.schema.fields.findIndex(f => f.name == name);
	const values = name => frame.data.values[field(name)];
	const xSize = frame.schema.fields[field('xMax')].config.interval / 1000;
	const times = values('xMax');
	const xs = new Array(times.length);
	const yMin = values('yMin');
	const yMax = values('yMax');
	const counts = values('count');
	let minCount = Infinity, maxCount = -Infinity;
	let minY = Infinity, maxY = -Infinity;
	let xCount = 0;
	for (let i = 0; i < times.length; i++) {
		xs[i] = times[i] / 1000;
		if (i == 0 || times[i] != times[i - 1])
			xCount++;
		minCount = Math.min(minCount, counts[i]);
		maxCount = Math.max(maxCount, counts[i]);
		minY = Math.min(minY, yMin[i]);
		maxY = Math.max(maxY, yMax[i]);
	}
	const countScale = (colorLookup.length - 1) / (maxCount - minCount || 1);
	const xRange = [xs[0] - xSize, xs.at(-1)];
	const logYRange = [2 ** Math.floor(Math.log2(minY)), 2 ** Math.ceil(Math.log2(maxY))];
	const zeroYRange = [0, maxY];
	const data = [null, [xs, yMin, yMax, counts]];
	const format = value => Number(value.toPrecision(5)).toString();
	const time = seconds => new Date(seconds * 1000).toISOString().slice(11, 19);
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	let hoverIdx;
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset. Changing Y scale resets zoom.';
	const status = root.querySelector('#status');
	readoutText.data = hint;
	root.querySelector('#color-ramp').style.background = `linear-gradient(to right, ${palette.join(',')})`;
	root.querySelector('#color-min').textContent = format(minCount);
	root.querySelector('#color-max').textContent = format(maxCount);

	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value').firstChild;
	const setDataButton = root.querySelector('#set-data');
	const yScale = root.querySelector('#y-scale');
	heightValue.data = `${height.value}px`;

	function createPlot(width) {
		const mode = yScale.value;
		const yRange = mode == 'log' ? logYRange : zeroYRange;
		const scaleLabel = mode == 'log' ? 'log₂' : mode;
		let asinhThreshold = 1;
		status.textContent = `${counts.length.toLocaleString()} cells · ${xCount} one-minute intervals · ${scaleLabel} Y · uniform-grid hover · no densification or exemplars`;

		return new uPlot({
			mode: 2,
			width,
			height: height.valueAsNumber,
			legend: { show: false },
			cursor: { drag: { x: true, y: true } },
			scales: {
				// Ranges are precomputed; preparation refreshes the threshold without a core scan.
				x: { scan: false, range: () => xRange },
				y: { scan: false, distr: mode == 'log' ? 3 : mode == 'asinh' ? 4 : 1, log: 2, asinh: () => asinhThreshold, range: () => yRange },
			},
			axes: [
				{ stroke: '#b7bdc5', grid: { stroke: '#252a30' }, ticks: { stroke: '#343a42' }, values: (u, splits) => splits.map(v => v == null ? null : time(v).slice(0, 5)) },
				{ stroke: '#b7bdc5', grid: { stroke: '#252a30' }, ticks: { stroke: '#343a42' }, size: 85, values: (u, splits) => splits.map(v => v == null ? null : format(v)) },
			],
			series: [{}, { label: 'Heatmap' }],
			plugins: [heatmapPlugin({
				xSize,
				// Bucket progression stays geometric even when the display scale changes.
				grid: { x: { distr: 1 }, y: { distr: 3 } },
				colors: palette,
				colorIdx: count => colorLookup[Math.floor((count - minCount) * countScale)],
				// All demo buckets are positive, so their minimum edge is the adaptive threshold.
				onPrepare: (u, minY) => { asinhThreshold = minY ?? 1; },
				onHover(u, i) {
					if (i === hoverIdx)
						return;
					hoverIdx = i;
					readoutText.data = i == null ? hint : `${time(xs[i] - xSize)}–${time(xs[i])} UTC · Y: ${format(yMin[i])}–${format(yMax[i])} s · Count: ${format(counts[i])}`;
				},
			})],
		}, data, host);
	}

	let plot = createPlot(host.clientWidth || 1000);

	const resize = () => plot.setSize({ width: host.clientWidth || 1000, height: height.valueAsNumber });
	const setHeight = () => {
		heightValue.data = `${height.value}px`;
		resize();
	};
	const setData = () => plot.setData(data);
	const setYScale = () => {
		const width = plot.width;
		plot.destroy();
		hoverIdx = undefined;
		readoutText.data = hint;
		plot = createPlot(width);
	};
	height.addEventListener('input', setHeight);
	setDataButton.addEventListener('click', setData);
	yScale.addEventListener('change', setYScale);
	window.addEventListener('resize', resize);
	height.disabled = setDataButton.disabled = yScale.disabled = false;
	return {
		get plot() { return plot; },
		destroy() {
			height.removeEventListener('input', setHeight);
			setDataButton.removeEventListener('click', setData);
			yScale.removeEventListener('change', setYScale);
			window.removeEventListener('resize', resize);
			height.disabled = setDataButton.disabled = yScale.disabled = true;
			plot.destroy();
		},
	};
}
