import { readCells, gridShape, cellLookup, palette, colorBoundary, cellText, setupControls } from './heatmap-cells-compare.js';

export function prepareData(frames) {
	const cells = readCells(frames);
	// Source-derived detail, not a documented performance tip: Plot 0.6.17 src/options.js coerceDate reuses existing Dates (but still maps the array).
	const xCenters = Array.from(cells.times, time => new Date(time - cells.xSize / 2));
	// Source-derived detail, not a documented performance tip: Plot 0.6.17 src/options.js coerceNumbers skips conversion for numeric typed arrays.
	const yCenters = Float64Array.from(cells.yMin, (lo, i) => Math.sqrt(lo * cells.yMax[i]));
	// Source-derived detail, not a documented performance tip: the same coerceNumbers fast path avoids copying the count channel on each rebuild.
	const countValues = Float64Array.from(cells.counts);
	return { ...cells, ...gridShape(cells), xCenters, yCenters, countValues };
}

export function rasterOptions(cells) {
	// Documented user optimization: channel arrays improve efficiency (https://observablehq.com/plot/features/marks#mark-options); reuse them across rebuilds.
	return {
		x: cells.xCenters,
		y: cells.yCenters,
		fill: cells.countValues,
		x1: cells.minX, x2: cells.maxX, y1: cells.minY, y2: cells.maxY,
		width: cells.nx, height: cells.ny,
		// One raster pixel per original grid position, not per screen pixel.
		interpolate: 'none', imageRendering: 'pixelated', blur: 0, clip: true,
	};
}

export function createDemo(root, frames, Plot = globalThis.Plot, d3 = globalThis.d3) {
	if (!Plot?.raster || !d3) throw new Error('Observable Plot and D3 did not load');
	const cells = prepareData(frames);
	const findCell = cellLookup(cells);
	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset.';
	const margin = { marginLeft: 85, marginRight: 20, marginTop: 30, marginBottom: 40 };
	let xDomain = [cells.minX, cells.maxX], yDomain = [cells.minY, cells.maxY];
	let mode = root.querySelector('#color-scale').value;
	let plot, hoverIndex, renderedWidth, renderedHeight;
	const getWidth = () => Math.max(140, host.clientWidth || 1000);
	const clearHover = () => { hoverIndex = undefined; readoutText.data = hint; };
	const draw = () => {
		const width = getWidth();
		const chartHeight = height.valueAsNumber;
		host.style.height = `${chartHeight}px`;
		const domain = cells.minCount == cells.maxCount ? [] : Array.from({ length: palette.length - 1 }, (_, i) => colorBoundary((i + .5) / (palette.length - 1), cells.minCount, cells.maxCount, mode));
		plot = Plot.plot({
			width, height: chartHeight, ...margin,
			style: { background: '#181b1f', color: '#b7bdc5', fontFamily: 'system-ui, sans-serif' },
			x: { type: 'utc', domain: xDomain, label: null, nice: false, ticks: Math.max(2, width / 130) },
			y: { type: 'log', domain: yDomain, label: null, nice: false, ticks: 8 },
			color: { type: 'threshold', domain, range: domain.length ? palette : [palette[0]], unknown: null },
			marks: [Plot.raster(cells.counts, rasterOptions(cells))],
		});
		host.replaceChildren(plot);
		const x = plot.scale('x'), y = plot.scale('y');
		const svg = d3.select(plot);
		const brushLayer = svg.append('g');
		const brush = d3.brush()
			.extent([[margin.marginLeft, margin.marginTop], [width - margin.marginRight, chartHeight - margin.marginBottom]])
			.on('end', event => {
				if (!event.sourceEvent || !event.selection) return;
				const [[x0, y0], [x1, y1]] = event.selection;
				brushLayer.call(brush.move, null);
				if (x1 - x0 < 2 || y1 - y0 < 2) return;
				xDomain = [+x.invert(x0), +x.invert(x1)];
				yDomain = [y.invert(y1), y.invert(y0)];
				draw();
			});
		brushLayer.call(brush);
		svg.style('touch-action', 'none')
			.on('pointermove.hover', event => {
				const px = event.offsetX, py = event.offsetY;
				const i = px < margin.marginLeft || px >= width - margin.marginRight || py < margin.marginTop || py >= chartHeight - margin.marginBottom ? -1 : findCell(+x.invert(px), y.invert(py));
				if (i === hoverIndex) return;
				hoverIndex = i;
				readoutText.data = i < 0 ? hint : cellText(cells.times[i] - cells.xSize, cells.times[i], cells.yMin[i], cells.yMax[i], cells.counts[i]);
			})
			.on('pointerleave.hover', clearHover)
			.on('dblclick.reset', () => {
				xDomain = [cells.minX, cells.maxX];
				yDomain = [cells.minY, cells.maxY];
				draw();
			});
		renderedWidth = width;
		renderedHeight = chartHeight;
		clearHover();
	};
	draw();
	const cleanup = setupControls(root, cells, {
		resize() {
			clearHover();
			if (getWidth() != renderedWidth || height.valueAsNumber != renderedHeight)
				draw();
		},
		setData: draw,
		setColor(value) { mode = value; draw(); },
	}, hint);
	root.querySelector('#status').textContent = `${cells.times.length.toLocaleString()} cells · native ${cells.nx} × ${cells.ny} raster from sparse samples · no interpolation · UTC X / logarithmic Y`;
	return {
		get plot() { return plot; },
		destroy() { cleanup(); host.replaceChildren(); },
	};
}
