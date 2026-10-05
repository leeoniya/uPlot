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

const filterAxisSplits = (u, splits, axisIdx, space, incr) => u.axes[axisIdx].filter(u, splits, axisIdx, space, incr);

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

	for (let i = 0; i < times.length; i++) {
		xs[i] = times[i] / 1000;
		minCount = Math.min(minCount, counts[i]);
		maxCount = Math.max(maxCount, counts[i]);
	}
	const countRange = maxCount - minCount || 1;
	const countScale = (colorLookup.length - 1) / countRange;
	const linearScale = (colorCount - 1) / countRange;
	const logRange = Math.log(maxCount) - Math.log(minCount);
	const logThresholds = Array.from({ length: colorCount - 1 }, (_, i) => minCount * Math.exp(logRange * (i + .5) / (colorCount - 1)));
	const logLookup = new Uint8Array(colorLookup.length);
	for (let i = 0, color = 0; i < logLookup.length; i++) {
		const count = minCount + i / countScale;
		while (color < colorCount - 1 && count >= logThresholds[color]) color++;
		logLookup[i] = color;
	}
	const colorIndices = {
		sqrt: count => colorLookup[Math.floor((count - minCount) * countScale)],
		linear: count => Math.round((count - minCount) * linearScale),
		log: minCount == maxCount ? () => 0 : count => {
			let color = logLookup[Math.floor((count - minCount) * countScale)];
			// Log transitions do not align with uniform LUT bins. Correct boundary bins
			// with comparisons, without computing logarithms while drawing.
			while (color < colorCount - 1 && count >= logThresholds[color]) color++;
			while (color > 0 && count < logThresholds[color - 1]) color--;
			return color;
		},
	};
	const xRange = [0, xSize];
	const logYRange = [1, 2];
	const zeroYRange = [0, 1];
	const sourceData = [null, [xs, yMin, yMax, counts]];
	let data = sourceData;
	let signedData;

	const factor = yMax[0] / yMin[0];

	function mirroredData() {
		if (signedData == null) {
			const cells = Array.from({ length: 4 }, () => new Array(xs.length * 2));
			let index = 0;
			const add = (x, lo, hi, count) => {
				cells[0][index] = x;
				cells[1][index] = lo;
				cells[2][index] = hi;
				cells[3][index++] = count;
			};
			for (let start = 0; start < xs.length;) {
				let end = start + 1;
				while (end < xs.length && xs[end] == xs[start]) end++;
				for (let i = end - 1; i >= start; i--) add(xs[i], -yMax[i], -yMin[i], counts[i]);

				for (let i = start; i < end; i++) add(xs[i], yMin[i], yMax[i], counts[i]);
				start = end;
			}
			signedData = [null, cells];
		}
		return signedData;
	}
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
	const colorScale = root.querySelector('#color-scale');
	const colorScaleLabel = root.querySelector('#color-scale-label');
	let colorIdx;
	const updateColorScale = () => {
		colorIdx = colorIndices[colorScale.value];
		colorScaleLabel.textContent = `Count · ${colorScale.value == 'sqrt' ? '√' : colorScale.value} scale`;
	};
	updateColorScale();
	const signed = root.querySelector('#signed-data');
	const logOption = yScale.querySelector('option[value="log"]');
	if (signed.checked) data = mirroredData();
	heightValue.data = `${height.value}px`;

	function createPlot(width, plotHeight = height.valueAsNumber) {
		logOption.disabled = signed.checked;
		if (signed.checked && yScale.value == 'log') yScale.value = 'asinh';
		const mode = yScale.value;
		const yRange = mode == 'log' ? logYRange : zeroYRange;
		const scaleLabel = mode == 'log' ? 'log₂' : mode;
		let asinhThreshold = 1;

		return new uPlot({
			mode: 2,
			width,
			height: plotHeight,
			legend: { show: false },
			cursor: { drag: { x: true, y: true } },
			scales: {
				// Preparation supplies ranges and the adaptive threshold without core data scans.
				x: { scan: false, range: () => xRange },
				y: { scan: false, distr: mode == 'log' ? 3 : mode == 'asinh' ? 4 : 1, log: 2, asinh: () => asinhThreshold, range: () => yRange },
			},
			axes: [
				{ stroke: '#b7bdc5', grid: { stroke: '#252a30' }, ticks: { stroke: '#343a42' }, values: (u, splits) => splits.map(v => v == null ? null : time(v).slice(0, 5)) },
				{ stroke: '#b7bdc5', grid: { stroke: '#252a30', filter: filterAxisSplits }, ticks: { stroke: '#343a42', filter: filterAxisSplits }, size: 85, values: (u, splits) => splits.map(v => v == null ? null : format(v)) },
			],
			series: [{}, { label: 'Heatmap' }],
			plugins: [heatmapPlugin({
				xSize,
				minAbs: 2 ** -128,
				grid: { x: { distr: 1 }, y: signed.checked ? { distr: 3, factor } : { distr: 3 } },
				colors: palette,
				colorIdx: count => colorIdx(count),
				onPrepare(u, minY, maxY, threshold) {
					data = u.data;
					asinhThreshold = threshold;
					hoverIdx = undefined;
					const xs = data[1][0];
					if (xs.length > 0) {
						xRange[0] = xs[0] - xSize;
						xRange[1] = xs.at(-1);
						zeroYRange[0] = Math.min(0, minY);
						zeroYRange[1] = Math.max(0, maxY);

						if (minY > 0) {
							logYRange[0] = 2 ** Math.floor(Math.log2(minY));
							logYRange[1] = 2 ** Math.ceil(Math.log2(maxY));
						}
					}
					const intervals = xs.length == 0 ? 0 : Math.round((xRange[1] - xRange[0]) / xSize);
					status.textContent = `${xs.length.toLocaleString()} cells · ${intervals} one-minute intervals · ${scaleLabel} Y · uniform-grid hover · ${signed.checked ? 'mirrored example' : 'no densification or exemplars'}`;
				},
				onHover(u, i) {
					if (i === hoverIdx)
						return;
					hoverIdx = i;
					const [xs, yMin, yMax, counts] = u.data[1];
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
	const setData = () => plot.setData(plot.data);
	const setColorScale = () => {
		updateColorScale();
		plot.redraw(false, false);
	};
	const setYScale = () => {
		const { width, height: plotHeight } = plot;
		plot.destroy();
		hoverIdx = undefined;
		readoutText.data = hint;
		plot = createPlot(width, plotHeight);
	};
	const setSigned = () => {
		data = signed.checked ? mirroredData() : sourceData;
		setYScale();
	};
	height.addEventListener('input', setHeight);
	setDataButton.addEventListener('click', setData);
	yScale.addEventListener('change', setYScale);
	colorScale.addEventListener('change', setColorScale);
	signed.addEventListener('change', setSigned);
	window.addEventListener('resize', resize);
	height.disabled = setDataButton.disabled = yScale.disabled = colorScale.disabled = signed.disabled = false;
	return {
		get plot() { return plot; },
		destroy() {
			height.removeEventListener('input', setHeight);
			setDataButton.removeEventListener('click', setData);
			yScale.removeEventListener('change', setYScale);
			colorScale.removeEventListener('change', setColorScale);
			signed.removeEventListener('change', setSigned);
			window.removeEventListener('resize', resize);
			height.disabled = setDataButton.disabled = yScale.disabled = colorScale.disabled = signed.disabled = true;
			plot.destroy();
		},
	};
}
