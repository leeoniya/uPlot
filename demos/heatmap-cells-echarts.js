import { readCells, gridShape } from './heatmap-cells-compare.js';

// Spectral, cool to warm; matches the uPlot demo's default 24-color palette.
const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'];
const rgb = stops.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
const colorCount = 24;
const palette = Array.from({ length: colorCount }, (_, i) => {
	const t = i / (colorCount - 1) * (rgb.length - 1);
	const lo = Math.min(Math.floor(t), rgb.length - 2);
	return `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
});

export function prepareData(frames) {
	const cells = readCells(frames);
	const { times, yMin, yMax, counts, xSize, minTime, minY, minCount, maxCount } = cells;
	const { nx, ny, factor, logStep } = gridShape(cells);
	// Flat x/y/count triples avoid per-cell arrays and ECharts' ordinary-array option clones.
	const data = new Float64Array(times.length * 3);
	for (let i = 0; i < times.length; i++) {
		const x = Math.round((times[i] - minTime) / xSize);
		const y = Math.round(Math.log(yMin[i] / minY) / logStep);
		const offset = i * 3;
		data[offset] = x;
		data[offset + 1] = y;
		data[offset + 2] = counts[i];
	}

	// Populate axis categories, not missing cells: gaps must retain their grid positions.
	const xCategories = Array.from({ length: nx }, (_, i) => String(minTime + i * xSize));
	const yCategories = Array.from({ length: ny }, (_, i) => String(minY * factor ** (i + .5)));
	return { data, times, yMin, yMax, counts, xSize, xCategories, yCategories, minCount, maxCount };
}

export function colorPieces(min, max, mode) {
	if (min == max)
		return [{ value: min, color: palette[0] }];
	// Invert the color transform at palette boundaries; visualMap keeps the original counts.
	const boundaries = Array.from({ length: palette.length - 1 }, (_, i) => {
		const t = (i + .5) / (palette.length - 1);
		return mode == 'log' ? min * Math.exp(Math.log(max / min) * t) : min + (max - min) * (mode == 'sqrt' ? t * t : t);
	});
	return palette.map((color, i) => ({
		...(i > 0 ? { gt: boundaries[i - 1] } : {}),
		...(i < palette.length - 1 ? { lte: boundaries[i] } : {}),
		color,
	}));
}

export function createDemo(root, frames, echarts = globalThis.echarts) {
	if (echarts == null)
		throw new Error('ECharts did not load');
	const { data, times, yMin, yMax, counts, xSize, xCategories, yCategories, minCount, maxCount } = prepareData(frames);
	const format = value => Number(value.toPrecision(5)).toString();
	const time = ms => new Date(ms).toISOString().slice(11, 19);
	const axisDateSlice = xCategories.length * xSize >= 86400000 ? [5, 10] : [11, 16];
	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value').firstChild;
	const setDataButton = root.querySelector('#set-data');
	const colorScale = root.querySelector('#color-scale');
	const progressive = root.querySelector('#progressive');
	const colorScaleLabel = root.querySelector('#color-scale-label');
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset. Y labels mark bucket centers.';
	readoutText.data = hint;
	heightValue.data = `${height.value}px`;
	root.querySelector('#status').textContent = `${times.length.toLocaleString()} cells · ${xCategories.length} time intervals · ${yCategories.length} exponential buckets · native categorical heatmap · no cell densification`;
	root.querySelector('#color-ramp').style.background = `linear-gradient(to right, ${palette.join(',')})`;
	root.querySelector('#color-min').textContent = format(minCount);
	root.querySelector('#color-max').textContent = format(maxCount);
	const updateColorLabel = () => {
		colorScaleLabel.textContent = `Count · ${colorScale.value == 'sqrt' ? '√' : colorScale.value} scale`;
	};
	updateColorLabel();

	host.style.height = `${height.value}px`;
	const plot = echarts.init(host, null, { renderer: 'canvas', width: host.clientWidth || 1000, height: height.valueAsNumber });
	const axis = {
		type: 'category',
		boundaryGap: true,
		axisLine: { lineStyle: { color: '#343a42' } },
		axisTick: { show: false },
		splitLine: { show: false },
	};
	plot.setOption({
		animation: false,
		textStyle: { color: '#b7bdc5', fontFamily: 'system-ui, sans-serif' },
		grid: { left: 85, right: 20, top: 30, bottom: 40 },
		xAxis: { ...axis, data: xCategories, axisLabel: { color: '#b7bdc5', hideOverlap: true, formatter: value => new Date(Number(value) - xSize / 2).toISOString().slice(...axisDateSlice) } },
		yAxis: { ...axis, data: yCategories, axisLabel: { color: '#b7bdc5', hideOverlap: true, formatter: value => format(Number(value)) } },
		visualMap: { type: 'piecewise', show: false, dimension: 2, seriesIndex: 0, selectedMode: false, pieces: colorPieces(minCount, maxCount, colorScale.value) },
		toolbox: {
			right: 20,
			iconStyle: { borderColor: '#b7bdc5' },
			feature: { dataZoom: { xAxisIndex: 0, yAxisIndex: 0, title: { zoom: 'Rectangle zoom', back: 'Previous zoom' } } },
		},
		dataZoom: [
			{ id: 'x', type: 'inside', xAxisIndex: 0, filterMode: 'filter', zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false },
			{ id: 'y', type: 'inside', yAxisIndex: 0, filterMode: 'filter', zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false },
		],
		series: [{
			id: 'cells', name: 'Heatmap', type: 'heatmap', data,
			dimensions: ['x', 'y', 'value'],
			encode: { x: 0, y: 1, value: 2 },
			progressive: progressive.checked ? 5000 : 0, progressiveThreshold: 10000,
			label: { show: false },
			emphasis: { disabled: true },
			itemStyle: { borderWidth: 0 },
		}],
	});
	plot.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: true });

	let hoverIdx;
	const clearHover = () => {
		hoverIdx = undefined;
		readoutText.data = hint;
	};
	const onHover = params => {
		if (params.componentType != 'series' || params.seriesIndex != 0 || params.dataIndex === hoverIdx)
			return;
		const i = hoverIdx = params.dataIndex;
		readoutText.data = `${time(times[i] - xSize)}–${time(times[i])} UTC · Y: ${format(yMin[i])}–${format(yMax[i])} s · Count: ${format(counts[i])}`;
	};
	const resetZoom = () => plot.dispatchAction({ type: 'dataZoom', batch: [{ dataZoomId: 'x', start: 0, end: 100 }, { dataZoomId: 'y', start: 0, end: 100 }] });
	const resize = () => {
		clearHover();
		host.style.height = `${height.value}px`;
		plot.resize({ width: host.clientWidth || 1000, height: height.valueAsNumber });
	};
	const setHeight = () => {
		heightValue.data = `${height.value}px`;
		resize();
	};
	const setData = () => {
		clearHover();
		plot.setOption({ series: [{ id: 'cells', data }] });
	};
	const setColorScale = () => {
		updateColorLabel();
		plot.setOption({ visualMap: { pieces: colorPieces(minCount, maxCount, colorScale.value) } });
	};
	const setProgressive = () => {
		clearHover();
		plot.setOption({ series: [{ id: 'cells', progressive: progressive.checked ? 5000 : 0 }] });
	};
	plot.on('mouseover', onHover);
	plot.on('mouseout', clearHover);
	plot.on('datazoom', clearHover);
	const zr = plot.getZr();
	zr.on('dblclick', resetZoom);
	height.addEventListener('input', setHeight);
	setDataButton.addEventListener('click', setData);
	colorScale.addEventListener('change', setColorScale);
	progressive.addEventListener('change', setProgressive);
	window.addEventListener('resize', resize);
	height.disabled = setDataButton.disabled = colorScale.disabled = progressive.disabled = false;
	return {
		plot,
		destroy() {
			height.removeEventListener('input', setHeight);
			setDataButton.removeEventListener('click', setData);
			colorScale.removeEventListener('change', setColorScale);
			progressive.removeEventListener('change', setProgressive);
			window.removeEventListener('resize', resize);
			plot.off('mouseover', onHover);
			plot.off('mouseout', clearHover);
			plot.off('datazoom', clearHover);
			zr.off('dblclick', resetZoom);
			clearHover();
			height.disabled = setDataButton.disabled = colorScale.disabled = progressive.disabled = true;
			plot.dispose();
		},
	};
}
