import { readCells, palette, colorPosition, cellText, setupControls } from './heatmap-cells-compare.js';

export function prepareData(frames) {
	const cells = readCells(frames);
	// Quads take explicit edges; the other columns can use the source arrays directly.
	const left = Float64Array.from(cells.times, t => t - cells.xSize);
	return { ...cells, left };
}

export async function createDemo(root, frames, Bokeh = globalThis.Bokeh) {
	if (!Bokeh?.Plotting)
		throw new Error('BokehJS and its plotting API did not load');
	const cells = prepareData(frames);
	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const readout = root.querySelector('#hover');
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click or use Reset to reset.';
	const colorValues = mode => Float64Array.from(cells.counts, v => 31 * colorPosition(v, cells.minCount, cells.maxCount, mode));
	const source = new Bokeh.ColumnDataSource({ data: {
		left: cells.left, right: cells.times, bottom: cells.yMin, top: cells.yMax,
		count: cells.counts, color: colorValues(root.querySelector('#color-scale').value),
	} });
	const mapper = new Bokeh.LinearColorMapper({ palette, low: -.5, high: 31.5 });
	const boxZoom = new Bokeh.BoxZoomTool();
	const plot = Bokeh.Plotting.figure({
		width: host.clientWidth || 1000, height: height.valueAsNumber,
		x_axis_type: 'datetime', y_axis_type: 'log', output_backend: 'webgl',
		x_range: new Bokeh.Range1d({ start: cells.minX, end: cells.maxX }),
		y_range: new Bokeh.Range1d({ start: cells.minY, end: cells.maxY }),
		tools: [boxZoom, new Bokeh.PanTool(), new Bokeh.WheelZoomTool(), new Bokeh.ResetTool()],
		active_drag: boxZoom, toolbar_location: 'above',
		background_fill_color: '#181b1f', border_fill_color: '#181b1f', outline_line_color: null,
		min_border_left: 85, min_border_right: 20, min_border_bottom: 40,
	});
	const renderer = plot.quad({
		left: { field: 'left' }, right: { field: 'right' }, bottom: { field: 'bottom' }, top: { field: 'top' },
		source, fill_color: { field: 'color', transform: mapper }, line_color: null,
		nonselection_fill_alpha: 1,
	});
	for (const axis of [...plot.xaxis, ...plot.yaxis]) {
		axis.major_label_text_color = '#b7bdc5';
		axis.axis_line_color = '#343a42';
		axis.major_tick_line_color = '#343a42';
		axis.minor_tick_line_color = null;
	}
	for (const grid of [...plot.xgrid, ...plot.ygrid]) grid.grid_line_color = null;
	let hoverIndex;
	plot.add_tools(new Bokeh.HoverTool({
		renderers: [renderer], tooltips: null,
		callback: (_, { index }) => {
			const i = index.indices[0];
			if (i === hoverIndex) return;
			hoverIndex = i;
			readout.textContent = i == null ? hint : cellText(cells.left[i], cells.times[i], cells.yMin[i], cells.yMax[i], cells.counts[i]);
		},
	}));
	const view = await Bokeh.Plotting.show(plot, host);
	const clearHover = () => { hoverIndex = undefined; readout.textContent = hint; };
	const resetZoom = () => {
		plot.x_range.setv({ start: cells.minX, end: cells.maxX });
		plot.y_range.setv({ start: cells.minY, end: cells.maxY });
		clearHover();
	};
	const cleanup = setupControls(root, cells, {
		resize() {
			host.style.height = `${height.value}px`;
			plot.setv({ width: host.clientWidth || 1000, height: height.valueAsNumber });
			clearHover();
		},
		setData() { clearHover(); source.change.emit(); },
		setColor(mode) {
			// Only color coordinates change; original counts remain available to hover.
			source.data = { ...source.data, color: colorValues(mode) };
		},
	}, hint);
	host.addEventListener('dblclick', resetZoom);
	root.querySelector('#status').textContent = `${cells.times.length.toLocaleString()} cells · native WebGL quads · datetime X / logarithmic Y · original cell edges · no densification`;
	return {
		plot, source, view,
		destroy() {
			cleanup();
			host.removeEventListener('dblclick', resetZoom);
			view.remove();
			plot.document?.remove_root(plot);
			host.replaceChildren();
		},
	};
}
