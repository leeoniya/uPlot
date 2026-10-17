import { readCells, cellLookup, palette, colorPosition, cellText, setupControls } from './heatmap-cells-compare.js';

export function prepareData(frames) {
	const cells = readCells(frames);
	// Numeric indices let the series read the source columns without per-cell objects.
	// Use an ordinary array: D3FC maps it to floating-point count values internally.
	return { ...cells, indices: Array.from({ length: cells.times.length }, (_, i) => i) };
}

export function createDemo(root, frames, d3 = globalThis.d3, fc = globalThis.fc) {
	if (!d3 || !fc?.seriesCanvasHeatmap) throw new Error('D3 and D3FC did not load');
	const cells = prepareData(frames);
	const findCell = cellLookup(cells);
	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset.';
	const canvas = document.createElement('canvas');
	canvas.style.position = 'absolute';
	canvas.style.inset = '0';
	host.appendChild(canvas);
	const context = canvas.getContext('2d');
	const svg = d3.select(host).append('svg').style('position', 'absolute').style('inset', '0').style('touch-action', 'none');
	const xAxis = svg.append('g');
	const yAxis = svg.append('g');
	const brushLayer = svg.append('g');
	const x = d3.scaleUtc().domain([cells.minX, cells.maxX]);
	const y = d3.scaleLog().domain([cells.minY, cells.maxY]);
	const margin = { left: 85, right: 20, top: 30, bottom: 40 };
	let width, innerWidth, innerHeight;
	let mode = root.querySelector('#color-scale').value;
	let hoverIndex;
	const clearHover = () => { hoverIndex = undefined; readoutText.data = hint; };
	const series = fc.seriesCanvasHeatmap()
		.context(context).xScale(x).yScale(y)
		.xValue(i => cells.times[i] - cells.xSize / 2)
		.yValue(i => Math.sqrt(cells.yMin[i] * cells.yMax[i]))
		.colorValue(i => cells.counts[i])
		.xBandwidth(() => Math.abs(x(cells.minX + cells.xSize) - x(cells.minX)))
		.yBandwidth(i => Math.abs(y(cells.yMin[i]) - y(cells.yMax[i])))
		.colorInterpolate(t => palette[Math.round(31 * colorPosition(cells.minCount + t * (cells.maxCount - cells.minCount), cells.minCount, cells.maxCount, mode))]);
	const draw = () => {
		const ratio = window.devicePixelRatio || 1;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height.valueAsNumber);
		context.save();
		context.translate(margin.left, margin.top);
		context.beginPath();
		context.rect(0, 0, innerWidth, innerHeight);
		context.clip();
		series(cells.indices);
		context.restore();
		xAxis.attr('transform', `translate(${margin.left},${margin.top + innerHeight})`).call(d3.axisBottom(x).ticks(Math.max(2, innerWidth / 130)).tickSizeOuter(0));
		yAxis.attr('transform', `translate(${margin.left},${margin.top})`).call(d3.axisLeft(y).ticks(8, '~g').tickSizeOuter(0));
		clearHover();
	};
	const brush = d3.brush().on('end', event => {
		if (!event.sourceEvent || !event.selection) return;
		const [[x0, y0], [x1, y1]] = event.selection;
		brushLayer.call(brush.move, null);
		if (x1 - x0 < 2 || y1 - y0 < 2) return;
		x.domain([x.invert(x0 - margin.left), x.invert(x1 - margin.left)]);
		y.domain([y.invert(y1 - margin.top), y.invert(y0 - margin.top)]);
		draw();
	});
	const resize = () => {
		width = Math.max(140, host.clientWidth || 1000);
		innerWidth = width - margin.left - margin.right;
		innerHeight = height.valueAsNumber - margin.top - margin.bottom;
		host.style.height = `${height.value}px`;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height.valueAsNumber * ratio);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height.value}px`;
		svg.attr('width', width).attr('height', height.valueAsNumber);
		x.range([0, innerWidth]);
		y.range([innerHeight, 0]);
		brush.extent([[margin.left, margin.top], [margin.left + innerWidth, margin.top + innerHeight]]);
		brushLayer.call(brush);
		draw();
	};
	const onMove = event => {
		const px = event.offsetX - margin.left, py = event.offsetY - margin.top;
		const i = px < 0 || px >= innerWidth || py < 0 || py >= innerHeight ? -1 : findCell(+x.invert(px), y.invert(py));
		if (i === hoverIndex) return;
		hoverIndex = i;
		readoutText.data = i < 0 ? hint : cellText(cells.times[i] - cells.xSize, cells.times[i], cells.yMin[i], cells.yMax[i], cells.counts[i]);
	};
	const resetZoom = () => {
		x.domain([cells.minX, cells.maxX]);
		y.domain([cells.minY, cells.maxY]);
		brushLayer.call(brush.move, null);
		draw();
	};
	svg.on('pointermove.hover', onMove).on('pointerleave.hover', clearHover).on('dblclick.reset', resetZoom);
	resize();
	const cleanup = setupControls(root, cells, {
		resize, setData: draw,
		setColor(value) { mode = value; draw(); },
	}, hint);
	root.querySelector('#status').textContent = `${cells.times.length.toLocaleString()} cells · native Canvas heatmap series · UTC X / logarithmic Y · sparse input, no densification`;
	return {
		plot: svg.node(), x, y,
		destroy() {
			cleanup();
			svg.on('.hover', null).on('.reset', null);
			brushLayer.on('.brush', null);
			host.replaceChildren();
		},
	};
}
