import uPlot from '../src/uPlot.js';
import { heatmapPlugin } from './lib/heatmapPlugin.js';

// Spectral, cool to warm; interpolate when the palette size changes, not for each cell.
const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'];
const rgb = stops.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));

const filterAxisSplits = (u, splits, axisIdx, space, incr) => u.axes[axisIdx].filter(u, splits, axisIdx, space, incr);
const axisLines = { stroke: '#252a30', width: 2 };
const utcDate = seconds => uPlot.tzDate(seconds * 1000, 'Etc/UTC');

function formatSeconds(seconds) {
	const abs = Math.abs(seconds);
	const scale = abs == 0 || abs >= 1 ? 1 : abs >= 1e-3 ? 1e3 : 1e6;
	const unit = scale == 1 ? 's' : scale == 1e3 ? 'ms' : 'µs';
	return `${Number((seconds * scale).toPrecision(3))} ${unit}`;
}

export function createDemo(root, frames) {
	const frame = frames.find(f => f.schema.meta?.type == 'heatmap-cells');
	const field = name => frame.schema.fields.findIndex(f => f.name == name);
	const values = name => frame.data.values[field(name)];
	const xSize = frame.schema.fields[field('xMax')].config.interval / 1000;
	const intervalLabel = xSize == 60 ? 'one-minute' : xSize % 60 == 0 ? `${xSize / 60}-minute` : `${xSize}-second`;
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
	const logRange = Math.log(maxCount) - Math.log(minCount);
	const colorCountInput = root.querySelector('#color-count');
	const colorCountValue = root.querySelector('#color-count-value').firstChild;
	// Retain the array passed to the plugin, including when the palette shrinks or grows.
	const palette = [];
	let colorIndices;
	const colorRamps = {};

	function updatePalette() {
		const colorCount = colorCountInput.valueAsNumber;
		colorCountValue.data = `${colorCount}`;
		palette.length = colorCount;
		for (let i = 0; i < colorCount; i++) {
			const t = i / (colorCount - 1) * (rgb.length - 1);
			const lo = Math.min(Math.floor(t), rgb.length - 2);
			palette[i] = `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
		}

		// For round(sqrt(t) * (colorCount - 1)), transitions occur at odd squares
		// when t is scaled by 4 * (colorCount - 1)^2. This keeps the lookup bins aligned.
		const colorLookup = new Array(4 * (colorCount - 1) ** 2 + 1);
		for (let i = 0; i < colorCount; i++)
			colorLookup.fill(i, i == 0 ? 0 : (2 * i - 1) ** 2, (2 * i + 1) ** 2);
		const countScale = (colorLookup.length - 1) / countRange;
		const linearScale = (colorCount - 1) / countRange;
		const logThresholds = Array.from({ length: colorCount - 1 }, (_, i) => minCount * Math.exp(logRange * (i + .5) / (colorCount - 1)));
		const logLookup = new Uint8Array(colorLookup.length);
		for (let i = 0, color = 0; i < logLookup.length; i++) {
			const count = minCount + i / countScale;
			while (color < colorCount - 1 && count >= logThresholds[color]) color++;
			logLookup[i] = color;
		}
		colorIndices = {
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
		// Legend position is linear in count; invert each transform to place palette stops.
		for (const mode of ['linear', 'sqrt', 'log']) {
			colorRamps[mode] = minCount == maxCount ? palette[0] : `linear-gradient(to right, ${palette.map((color, i) => {
				const t = i / (colorCount - 1);
				const pos = mode == 'sqrt' ? t * t : mode == 'log' ? minCount * Math.expm1(logRange * t) / countRange : t;
				return `${color} ${i == colorCount - 1 ? 100 : pos * 100}%`;
			}).join(',')})`;
		}
	}
	updatePalette();
	const xRange = [0, xSize];

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

	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	let hoverIdx;
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset. Changing Y scale resets zoom.';
	const status = root.querySelector('#status');
	readoutText.data = hint;
	const colorRamp = root.querySelector('#color-ramp');
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
		colorRamp.style.background = colorRamps[colorScale.value];
		colorScaleLabel.textContent = `Count · ${colorScale.value == 'sqrt' ? '√' : colorScale.value} scale`;
	};
	updateColorScale();
	const signed = root.querySelector('#signed-data');
	const logOptions = yScale.querySelectorAll('option[value^="log"]');
	if (signed.checked) data = mirroredData();
	heightValue.data = `${height.value}px`;

	function createPlot(width, plotHeight = height.valueAsNumber) {
		for (const option of logOptions) option.disabled = signed.checked;
		if (signed.checked && yScale.value.startsWith('log')) yScale.value = 'asinh';
		const mode = yScale.value;
		const isLog = mode.startsWith('log');
		const logBase = mode == 'log10' ? 10 : 2;
		const yRange = isLog ? [1, logBase] : [0, 1];
		const scaleLabel = isLog ? (logBase == 10 ? 'log₁₀' : 'log₂') : mode;
		let asinhThreshold = 1;

		return new uPlot({
			mode: 2,
			tzDate: utcDate,
			width,
			height: plotHeight,
			legend: { show: false },
			cursor: { drag: { x: true, y: true } },
			scales: {
				// Preparation supplies bounds and the adaptive threshold without core data scans.
				x: { scan: false, range: () => xRange },
				y: {
					distr: isLog ? 3 : mode == 'asinh' ? 4 : 1,
					log: logBase,
					asinh: () => asinhThreshold,
					axis: mode == 'linear' ? 1 : undefined,
					scan: mode == 'linear' ? () => yRange.slice() : false,
					range: mode == 'linear' ? undefined : () => yRange,
				},
			},
			axes: [
				{ stroke: '#b7bdc5', grid: axisLines, ticks: axisLines },
				{
					stroke: '#b7bdc5',
					grid: { ...axisLines, filter: filterAxisSplits },
					ticks: { ...axisLines, filter: filterAxisSplits },
					size: 85,
					values: (u, splits) => splits.map(v => v == null ? null : formatSeconds(v)),
				},
			],
			series: [{}, { label: 'Heatmap' }],
			plugins: [heatmapPlugin({
				xSize,
				minAbs: 2 ** -128,
				grid: signed.checked ? { y: { distr: 3, factor } } : undefined,
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
						if (isLog)
							[yRange[0], yRange[1]] = uPlot.rangeLog(minY, maxY, logBase, true);
						else if (mode == 'asinh')
							[yRange[0], yRange[1]] = uPlot.rangeAsinh(Math.min(0, minY), Math.max(0, maxY), 2, true);
						else {
							yRange[0] = Math.min(0, minY);
							yRange[1] = Math.max(0, maxY);
						}
					}
					const intervals = xs.length == 0 ? 0 : Math.round((xRange[1] - xRange[0]) / xSize);
					status.textContent = `${xs.length.toLocaleString()} cells · ${intervals} ${intervalLabel} intervals · ${scaleLabel} Y · uniform-grid hover · ${signed.checked ? 'mirrored example' : 'no densification or exemplars'}`;
				},
				onHover(u, i) {
					if (i === hoverIdx)
						return;
					hoverIdx = i;
					const [xs, yMin, yMax, counts] = u.data[1];
					const timeRange = i == null ? '' : u.axes[0].values(u, [xs[i] - xSize, xs[i]], 0, 0, xSize).join('–').replace(/\n/g, ' ');
					readoutText.data = i == null ? hint : `${timeRange} UTC · Y: ${formatSeconds(yMin[i])}–${formatSeconds(yMax[i])} · Count: ${format(counts[i])}`;
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
	const setColorCount = () => {
		updatePalette();
		setColorScale();
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
	colorCountInput.addEventListener('input', setColorCount);
	signed.addEventListener('change', setSigned);
	window.addEventListener('resize', resize);
	height.disabled = setDataButton.disabled = yScale.disabled = colorScale.disabled = colorCountInput.disabled = signed.disabled = false;
	return {
		get plot() { return plot; },
		destroy() {
			height.removeEventListener('input', setHeight);
			setDataButton.removeEventListener('click', setData);
			yScale.removeEventListener('change', setYScale);
			colorScale.removeEventListener('change', setColorScale);
			colorCountInput.removeEventListener('input', setColorCount);
			signed.removeEventListener('change', setSigned);
			window.removeEventListener('resize', resize);
			height.disabled = setDataButton.disabled = yScale.disabled = colorScale.disabled = colorCountInput.disabled = signed.disabled = true;
			plot.destroy();
		},
	};
}
