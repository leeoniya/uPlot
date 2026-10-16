import { prepareData, colorPieces } from './heatmap-cells-echarts.js';

const palette = colorPieces(0, 1, 'linear').map(piece => piece.color);
const grid = { left: 85, right: 20, top: 30, bottom: 40, outerBoundsMode: 'none' };

export function createCellLookup(data, rowCount) {
	// Sort source indices, not cells: hover retains raw row IDs with only four extra bytes per cell.
	const order = Uint32Array.from({ length: data.length / 3 }, (_, i) => i);
	const key = i => data[i * 3] * rowCount + data[i * 3 + 1];
	order.sort((a, b) => key(a) - key(b));
	return (x, y) => {
		if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || y >= rowCount)
			return;
		const target = x * rowCount + y;
		let lo = 0, hi = order.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (key(order[mid]) < target) lo = mid + 1;
			else hi = mid;
		}
		return lo < order.length && key(order[lo]) == target ? order[lo] : undefined;
	};
}

export function cellSize(plot, xCount, yCount) {
	const band = (axis, count, span) => {
		if (count < 2) return span;
		const finder = { [`${axis}AxisIndex`]: 0 };
		const distance = Math.abs(plot.convertToPixel(finder, count - 1) - plot.convertToPixel(finder, 0));
		// A zoom containing one category collapses the scale extent; its band fills the grid.
		return distance > 0 ? distance / (count - 1) : span;
	};
	return [
		band('x', xCount, Math.max(1, plot.getWidth() - grid.left - grid.right)),
		band('y', yCount, Math.max(1, plot.getHeight() - grid.top - grid.bottom)),
	];
}

export function createDemo(root, frames, echarts = globalThis.echarts) {
	if (echarts == null)
		throw new Error('ECharts did not load from the CDN');
	const { data, times, yMin, yMax, counts, xSize, xCategories, yCategories, minCount, maxCount } = prepareData(frames);
	const findCell = createCellLookup(data, yCategories.length);
	const format = value => Number(value.toPrecision(5)).toString();
	const time = ms => new Date(ms).toISOString().slice(11, 19);
	const axisDateSlice = xCategories.length * xSize >= 86400000 ? [5, 10] : [11, 16];
	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const heightValue = root.querySelector('#height-value').firstChild;
	const setDataButton = root.querySelector('#set-data');
	const colorScale = root.querySelector('#color-scale');
	const colorScaleLabel = root.querySelector('#color-scale-label');
	const renderNote = root.querySelector('#render-note');
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	const hint = 'Hover a grid cell for its bounds and count. Drag to zoom; double-click to reset. Y labels mark bucket centers.';
	readoutText.data = hint;
	heightValue.data = `${height.value}px`;
	root.querySelector('#status').textContent = `${times.length.toLocaleString()} cells · ${xCategories.length} time intervals · ${yCategories.length} exponential buckets · scatterGL rectangles · sparse-grid hover`;
	root.querySelector('#color-ramp').style.background = `linear-gradient(to right, ${palette.join(',')})`;
	root.querySelector('#color-min').textContent = format(minCount);
	root.querySelector('#color-max').textContent = format(maxCount);
	const updateColorLabel = () => {
		colorScaleLabel.textContent = `Count · ${colorScale.value == 'sqrt' ? '√' : colorScale.value} scale`;
	};
	updateColorLabel();

	host.style.height = `${height.value}px`;
	const width = host.clientWidth || 1000;
	let symbolSize = [Math.max(1, width - grid.left - grid.right) / xCategories.length, (height.valueAsNumber - grid.top - grid.bottom) / yCategories.length];
	const plot = echarts.init(host, null, { renderer: 'canvas', width, height: height.valueAsNumber });
	const axis = {
		type: 'category',
		boundaryGap: true,
		axisLine: { lineStyle: { color: '#343a42' } },
		axisTick: { show: false },
		splitLine: { show: false },
	};
	try {
		plot.setOption({
			animation: false,
			textStyle: { color: '#b7bdc5', fontFamily: 'system-ui, sans-serif' },
			grid,
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
				id: 'cells', name: 'Heatmap', type: 'scatterGL', data,
				dimensions: ['x', 'y', 'value'],
				encode: { x: 0, y: 1, value: 2 },
				symbol: 'rect', symbolSize,
				// GL 2.1.0 reads chunk-local visual indices in progressive chunks after the first.
				progressive: 0,
				// Large mode uses one color; native picking scans every point with square hitboxes.
				large: false, silent: true,
				blendMode: 'source-over',
				label: { show: false },
				emphasis: { disabled: true },
				itemStyle: { opacity: 1, borderWidth: 0 },
				postEffect: { enable: false },
			}],
		});
	}
	catch (error) {
		plot.dispose();
		throw error;
	}
	plot.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: true });

	const updateRenderNote = () => {
		renderNote.textContent = `Cell size: ${symbolSize.map(v => v.toFixed(2)).join(' × ')} CSS px. ` +
			(Math.max(...symbolSize) <= 2 ? 'GL uses square points at this size; increase the height or zoom in.' : 'Thin symbols and GPU point-size limits can change cell coverage.');
	};
	const syncSymbolSize = () => {
		const next = cellSize(plot, xCategories.length, yCategories.length);
		if (next.some((v, i) => Math.abs(v - symbolSize[i]) > 1e-6)) {
			symbolSize = next;
			plot.setOption({ series: [{ id: 'cells', symbolSize }] });
		}
		updateRenderNote();
	};
	updateRenderNote();

	let hoverIdx;
	const clearHover = () => {
		hoverIdx = undefined;
		readoutText.data = hint;
	};
	const onHover = event => {
		const point = [event.offsetX, event.offsetY];
		if (!plot.containPixel({ gridIndex: 0 }, point)) {
			clearHover();
			return;
		}
		const [x, y] = plot.convertFromPixel({ gridIndex: 0 }, point);
		const i = findCell(x, y);
		if (i === hoverIdx) return;
		hoverIdx = i;
		readoutText.data = i == null ? hint : `${time(times[i] - xSize)}–${time(times[i])} UTC · Y: ${format(yMin[i])}–${format(yMax[i])} s · Count: ${format(counts[i])}`;
	};
	const onZoom = () => {
		clearHover();
		syncSymbolSize();
	};
	const resetZoom = () => plot.dispatchAction({ type: 'dataZoom', batch: [{ dataZoomId: 'x', start: 0, end: 100 }, { dataZoomId: 'y', start: 0, end: 100 }] });
	const resize = () => {
		clearHover();
		host.style.height = `${height.value}px`;
		plot.resize({ width: host.clientWidth || 1000, height: height.valueAsNumber });
		syncSymbolSize();
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
	plot.on('datazoom', onZoom);
	const zr = plot.getZr();
	zr.on('mousemove', onHover);
	zr.on('globalout', clearHover);
	zr.on('dblclick', resetZoom);
	height.addEventListener('input', setHeight);
	setDataButton.addEventListener('click', setData);
	colorScale.addEventListener('change', setColorScale);
	window.addEventListener('resize', resize);
	height.disabled = setDataButton.disabled = colorScale.disabled = false;
	return {
		plot,
		destroy() {
			height.removeEventListener('input', setHeight);
			setDataButton.removeEventListener('click', setData);
			colorScale.removeEventListener('change', setColorScale);
			window.removeEventListener('resize', resize);
			plot.off('datazoom', onZoom);
			zr.off('mousemove', onHover);
			zr.off('globalout', clearHover);
			zr.off('dblclick', resetZoom);
			clearHover();
			height.disabled = setDataButton.disabled = colorScale.disabled = true;
			plot.dispose();
		},
	};
}
