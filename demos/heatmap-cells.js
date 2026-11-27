import uPlot from '../src/uPlot.js';
import { rangeY } from '../src/rangeY.js';
import { snapshot1, snapshot2 } from './data/heatmap-snapshots.js';
import { heatmapCells, heatmapRows } from './lib/heatmapFrameAdapters.js';
import { heatmapPlugin } from './lib/heatmapPlugin.js';


// Spectral, cool to warm; interpolate when the palette size changes, not for each cell.
const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'];
const rgb = stops.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));

const exactRange = (u, min, max) => [min, max];
const filterAxisSplits = (u, splits, axisIdx, space, incr) => u.axes[axisIdx].filter(u, splits, axisIdx, space, incr);
const axisLines = { stroke: '#252a30', width: 2 };
const utcDate = seconds => uPlot.tzDate(seconds * 1000, 'Etc/UTC');

function formatSeconds(seconds) {
	const abs = Math.abs(seconds);
	const scale = abs == 0 || abs >= 1 ? 1 : abs >= 1e-3 ? 1e3 : 1e6;
	const unit = scale == 1 ? 's' : scale == 1e3 ? 'ms' : 'µs';
	return `${Number((seconds * scale).toPrecision(3))} ${unit}`;
}

// Each Y split is an edge rank, even after zoom hides earlier ticks.
function bucketEdgeLabels(axis) {
	if (!axis) return;
	const { splits, values, align } = axis;
	return {
		opts: {
			splits: (u, idx, min, max) => splits.slice(Math.max(0, Math.ceil(min)), Math.max(0, Math.floor(max) + 1)),
			values: (u, visible) => visible.map(v => v == null ? null : values[v]),
		},
		cell: (lo, hi) => align < 0 ? `(${values[lo]}, ${values[hi]}]` : `[${values[lo]}, ${values[hi]})`,
	};
}

const format = value => Number(value.toPrecision(5)).toString();
const geometricCells = frame => heatmapCells(frame, { geometric: true });
const snapshotDataset = frame => ({ ...geometricCells(frame), zeroHeight: 4, formatY: format });

export function createDemo(root, frames, { otelClassic, otelNhcb, parity, parityZero } = {}) {
	const frame = type => frames.find(f => f.schema.meta?.type == type);
	const sources = {
			classic: [frame('heatmap-rows'), heatmapRows],
			otelClassic: [otelClassic, heatmapRows],
			otelNhcb: [otelNhcb, f => heatmapCells(f, { ordinal: true })],
			parity: [parity, geometricCells],
			parityZero: [parityZero, f => ({ ...geometricCells(f), zeroHeight: 4 })],
		};
	const datasets = {
		synthetic: geometricCells(frame('heatmap-cells')),
		snapshot1: snapshotDataset(snapshot1),
		snapshot2: snapshotDataset(snapshot2),
		categorical: heatmapRows({
			schema: { fields: [{ name: 'Method', type: 'string' }, { name: '2xx' }, { name: '4xx' }, { name: '5xx' }] },
			data: { values: [['GET', 'POST', 'DELETE'], [25, 18, 6], [4, 3, 0], [1, 0, 2]] },
		}),
	};
	const select = root.querySelector('#dataset');
	for (const [name, [source]] of Object.entries(sources))
		select.querySelector(`option[value="${name}"]`).disabled = !source;
	select.value = 'synthetic';
	let view = createView(root, datasets.synthetic);
	function setDataset() {
		const name = select.value;
		if (datasets[name] == null) {
			const [source, adapt] = sources[name];
			datasets[name] = adapt(source);
		}
		view.destroy();
		view = createView(root, datasets[name]);
	}
	select.disabled = false;
	select.addEventListener('change', setDataset);
	return {
		get plot() { return view.plot; },
		destroy() {
			select.disabled = true;
			select.removeEventListener('change', setDataset);
			view.destroy();
		},
	};
}

function createView(root, dataset) {
	const { fields, grid, xSize, data: sourceData, axes, zeroHeight = 0, formatY = formatSeconds } = dataset;
	const hasZeroBucket = zeroHeight > 0;
	const labeledY = bucketEdgeLabels(axes?.[1]);
	const centeredX = grid?.x?.categories != null, centeredY = grid?.y?.categories != null;
	const ordinalY = centeredY || !!labeledY;
	const intervalLabel = xSize == 60 ? 'one-minute' : xSize % 60 == 0 ? `${xSize / 60}-minute` : `${xSize}-second`;


	const colorCountInput = root.querySelector('#color-count');
	const colorCountValue = root.querySelector('#color-count-value').firstChild;
	let palette;

	function updatePalette() {
		const colorCount = colorCountInput.valueAsNumber;
		colorCountValue.data = `${colorCount}`;
		palette = Array.from({ length: colorCount }, (_, i) => {
			const t = i / (colorCount - 1) * (rgb.length - 1);
			const lo = Math.min(Math.floor(t), rgb.length - 2);
			return `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
		});
	}
	updatePalette();
	const xRange = [0, xSize];

	let data = sourceData;
	let signedData, heatmap;


	function mirroredData() {
		if (signedData == null) {
			const [xs, yMin, yMax, counts] = sourceData[1];
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


	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	let hoverIdx;
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset. Changing Y scale resets zoom.';
	const status = root.querySelector('#status');
	readoutText.data = hint;
	const colorRamp = root.querySelector('#color-ramp');
	const colorMin = root.querySelector('#color-min');
	const colorMax = root.querySelector('#color-max');

	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value').firstChild;
	const cellGap = root.querySelector('#cell-gap');
	const cellGapValue = root.querySelector('#cell-gap-value').firstChild;
	let gap = cellGap.valueAsNumber;
	cellGapValue.data = `${gap}px`;

	const setDataButton = root.querySelector('#set-data');
	const yScale = root.querySelector('#y-scale');
	const colorScale = root.querySelector('#color-scale');
	const colorScaleLabel = root.querySelector('#color-scale-label');

	const signed = root.querySelector('#signed-data');
	const logOptions = yScale.querySelectorAll('option[value^="log"]');
	if (hasZeroBucket || ordinalY) signed.checked = false;
	const previousScale = yScale.value;
	if (ordinalY) yScale.value = 'linear';
	if (signed.checked) data = mirroredData();
	heightValue.data = `${height.value}px`;

	function applyFrame(u) {
		heatmap.setFrame(dataset);
		const [x0, x1] = u.scales.x.scan(u, 'x'), [y0, y1] = u.scales.y.scan(u, 'y');
		status.textContent = `${u.data[1][0].length.toLocaleString()} cells · ${Math.round((x1 - x0) / xSize)} columns · ${y1 - y0} ordinal rows`;
	}

	function createPlot(width, plotHeight = height.valueAsNumber) {
		const nonpositive = signed.checked || hasZeroBucket;
		for (const option of logOptions) option.disabled = nonpositive;
		if (nonpositive && yScale.value.startsWith('log')) yScale.value = 'asinh';
		const mode = yScale.value;
		const isLog = mode.startsWith('log');
		const logBase = mode == 'log10' ? 10 : 2;
		const yRange = isLog ? [1, logBase] : [0, 1];
		const scaleLabel = isLog ? (logBase == 10 ? 'log₁₀' : 'log₂') : mode;
		let asinhThreshold = 1;

		let zeroEdge = 0, autoBounds;

		function zeroBucketRange(u) {
			const { height } = u.bbox;
			let [min, max] = yRange;
			if (mode == 'linear') {
				const ticks = rangeY(min, max, height / u.pxRatio || plotHeight);
				if (ticks != null) ({ min, max } = ticks);
			}
			if (zeroEdge != 0 && height > 0) {
				const pad = zeroHeight / 2 * Math.round(u.height * u.pxRatio) / u.height;
				if (pad < height) {
					const far = zeroEdge < 0 ? max : min;
					const ratio = -pad / (height - pad);
					const edge = mode == 'asinh' ? asinhThreshold * Math.sinh(Math.asinh(far / asinhThreshold) * ratio) : far * ratio;
					if (zeroEdge < 0) min = Math.min(min, zeroEdge, edge);
					else max = Math.max(max, zeroEdge, edge);
				}
			}
			return [min, max];
		}

		const geometry = fields ? {fields} : {
			xSize, grid: grid ?? (hasZeroBucket || signed.checked ? { y: { distr: 3, factor: dataset.factor } } : undefined),
		};
		const opts = {
			mode: 2,
			tzDate: utcDate,
			width,
			height: plotHeight,
			legend: { show: false },
			cursor: { drag: { x: true, y: true } },
			scales: fields ? {
				x: { time: dataset.time ?? true, range: exactRange },
				y: { range: exactRange },
			} : {
				// Legacy transformed grids supply their own display bounds and adaptive threshold.
				x: { scan: false, range: () => xRange },
				y: {
					distr: isLog ? 3 : mode == 'asinh' ? 4 : 1,
					log: logBase,
					asinh: () => asinhThreshold,
					axis: !hasZeroBucket && mode == 'linear' ? 1 : undefined,
					scan: !hasZeroBucket && mode == 'linear' ? () => yRange.slice() : false,
					range: hasZeroBucket ? u => autoBounds = zeroBucketRange(u) : mode == 'linear' ? undefined : () => yRange,
				},
			},
			axes: [
				// Canvas-only axes keep their DOM hit targets from intercepting edge-cell hover in Chrome.
				{ dom: false, stroke: '#b7bdc5', grid: axisLines, ticks: axisLines },
				{
					dom: false,
					stroke: '#b7bdc5',
					grid: { ...axisLines, filter: filterAxisSplits },
					ticks: { ...axisLines, filter: filterAxisSplits },
					size: 85,
					...(ordinalY ? labeledY?.opts : {values: (u, splits) => splits.map(v => v == null ? null : formatY(v))}),
				},
			],
			hooks: hasZeroBucket ? { setSize: [u => {
				// Range callbacks precede layout. Refresh only automatic bounds once the plot height changes.
				const y = u.scales.y;
				if (autoBounds != null && y.min === autoBounds[0] && y.max === autoBounds[1]) {
					const [min, max] = zeroBucketRange(u);
					if (y.min !== min || y.max !== max) u.setRange('y', null, null);
				}
			}] } : {},
			series: [{}, { label: 'Heatmap' }],
			plugins: [heatmap = heatmapPlugin({
				...geometry,
				cellGap: () => gap,
				zeroHeight,
				colors: () => palette,
				colorScale: () => colorScale.value,
				onColorScale({ min, max, stops, scale }) {
					colorMin.textContent = format(min);
					colorMax.textContent = format(max);
					colorScaleLabel.textContent = `Count · ${scale == 'sqrt' ? '√' : scale == 'cbrt' ? '∛' : scale} scale`;
					colorRamp.style.background = min == max ? stops[0][1] :
						`linear-gradient(to right, ${stops.map(([offset, color]) => `${color} ${offset * 100}%`).join(', ')})`;
				},
				onPrepare(u, minY, maxY, threshold, zeroMin, zeroMax) {
					hoverIdx = undefined;
					if (fields) return;
					data = u.data;
					asinhThreshold = threshold;
					const xs = data[1][0];
					if (xs.length > 0) {
						xRange[0] = xs[0] - xSize;
						xRange[1] = xs.at(-1);
						// A zero row at just one end needs room on the side without regular buckets.
						zeroEdge = minY === zeroMin && maxY !== zeroMax ? minY : maxY === zeroMax && minY !== zeroMin ? maxY : 0;
						if (isLog)
							[yRange[0], yRange[1]] = uPlot.rangeLog(minY, maxY, logBase, true);
						else if (mode == 'asinh')
							[yRange[0], yRange[1]] = uPlot.rangeAsinh(Math.min(0, minY), Math.max(0, maxY), 2, true);
						else {
							yRange[0] = zeroEdge < 0 ? 0 : Math.min(0, minY);
							yRange[1] = zeroEdge > 0 ? 0 : Math.max(0, maxY);
						}
					}
					const intervals = xs.length == 0 ? 0 : Math.round((xRange[1] - xRange[0]) / xSize);
					status.textContent = `${xs.length.toLocaleString()} cells · ${intervals} ${intervalLabel} intervals · ${scaleLabel} Y · uniform-grid hover · ${signed.checked ? 'mirrored example' : 'no densification or exemplars'}`;
				},
				onHover(u, i) {
					if (i === hoverIdx)
						return;
					hoverIdx = i;
					if (i == null) { readoutText.data = hint; return; }
					const cols = u.data[1], xVal = cols[0][i], yVal = cols[1][i];
					const x = centeredX ? u.axes[0].values(u, [xVal], 0, 0, 1)[0] :
						u.axes[0].values(u, [xVal - xSize, xVal], 0, 0, xSize).join('–').replace(/\n/g, ' ') + ' UTC';
					const y = centeredY ? u.axes[1].values(u, [yVal], 1, 0, 1)[0] : labeledY ? labeledY.cell(yVal, cols[2][i]) :
						`${formatY(yVal)}–${formatY(cols[2][i])}`;
					readoutText.data = `${x} · Y: ${y} · Count: ${format(cols.at(-1)[i])}`;
				},
			})],
		};
		const plot = new uPlot(opts, fields ? null : data, host);
		if (fields) applyFrame(plot);
		return plot;
	}

	let plot = createPlot(host.clientWidth || 1000);

	const resize = () => plot.setSize({ width: host.clientWidth || 1000, height: height.valueAsNumber });
	const setHeight = () => {
		heightValue.data = `${height.value}px`;
		resize();
	};
	const setGap = () => {
		gap = cellGap.valueAsNumber;
		cellGapValue.data = `${gap}px`;
		plot.redraw(false, false);
	};

	const setData = () => fields ? applyFrame(plot) : plot.setData(plot.data);
	const setColorScale = () => plot.redraw(false, false);
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
	cellGap.addEventListener('input', setGap);

	setDataButton.addEventListener('click', setData);
	yScale.addEventListener('change', setYScale);
	colorScale.addEventListener('change', setColorScale);
	colorCountInput.addEventListener('input', setColorCount);
	signed.addEventListener('change', setSigned);
	window.addEventListener('resize', resize);
	height.disabled = setDataButton.disabled = yScale.disabled = colorScale.disabled = colorCountInput.disabled = cellGap.disabled = false;
	signed.disabled = hasZeroBucket || ordinalY;
	yScale.disabled = ordinalY;

	return {
		get plot() { return plot; },
		destroy() {
			if (ordinalY) yScale.value = previousScale;
			height.removeEventListener('input', setHeight);
			cellGap.removeEventListener('input', setGap);

			setDataButton.removeEventListener('click', setData);
			yScale.removeEventListener('change', setYScale);
			colorScale.removeEventListener('change', setColorScale);
			colorCountInput.removeEventListener('input', setColorCount);
			signed.removeEventListener('change', setSigned);
			window.removeEventListener('resize', resize);
			height.disabled = setDataButton.disabled = yScale.disabled = colorScale.disabled = colorCountInput.disabled = cellGap.disabled = signed.disabled = true;
			plot.destroy();
		},
	};
}
