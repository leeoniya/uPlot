import { readCells, gridCells, palette, colorBoundary, cellText, setupControls } from './heatmap-cells-compare.js';

export function prepareData(frames) {
	const cells = readCells(frames);
	const grid = gridCells(cells);
	// Plotly accepts typed rows; all rows share the grid's backing buffer.
	const z = Array.from({ length: grid.ny }, (_, y) => grid.values.subarray(y * grid.nx, (y + 1) * grid.nx));
	// Plotly interprets numeric dates in local time; ISO strings keep the axis in UTC.
		const xDates = Array.from(grid.xEdges, t => new Date(t).toISOString());
		return { ...cells, ...grid, z, xDates };
}

export function colorScale(min, max, mode) {
	if (min == max) return [[0, palette[0]], [1, palette[0]]];
	const stops = [[0, palette[0]]];
	for (let i = 0; i < palette.length - 1; i++) {
		const value = colorBoundary((i + .5) / (palette.length - 1), min, max, mode);
		const t = (value - min) / (max - min);
		stops.push([t, palette[i]], [t, palette[i + 1]]);
	}
	stops.push([1, palette.at(-1)]);
	return stops;
}

export async function createDemo(root, frames, Plotly = globalThis.Plotly) {
	if (!Plotly) throw new Error('Plotly.js did not load');
	const cells = prepareData(frames);
	const host = root.querySelector('#plot');
	const height = root.querySelector('#height');
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	const hint = 'Hover a cell for its bounds and count. Drag to zoom; double-click to reset.';
	const trace = {
		type: 'heatmap', x: cells.xDates, y: cells.yEdges, z: cells.z,
		zmin: cells.minCount, zmax: cells.maxCount == cells.minCount ? cells.minCount + 1 : cells.maxCount,
		colorscale: colorScale(cells.minCount, cells.maxCount, root.querySelector('#color-scale').value),
		showscale: false, zsmooth: false, connectgaps: false, hoverongaps: false,
		hoverinfo: 'none', xgap: 0, ygap: 0,
	};
	const layout = {
		width: host.clientWidth || 1000, height: height.valueAsNumber,
		margin: { l: 85, r: 20, t: 30, b: 40 },
		paper_bgcolor: '#181b1f', plot_bgcolor: '#181b1f',
		font: { color: '#b7bdc5', family: 'system-ui, sans-serif' },
		xaxis: { type: 'date', range: [cells.xDates[0], cells.xDates.at(-1)], showgrid: false, zeroline: false },
		yaxis: { type: 'log', range: [Math.log10(cells.minY), Math.log10(cells.maxY)], showgrid: false, zeroline: false },
		dragmode: 'zoom', uirevision: 'cells',
	};
	const config = { displaylogo: false, scrollZoom: false, doubleClick: 'reset', responsive: false };
	await Plotly.newPlot(host, [trace], layout, config);
	let hoverKey;
	const clearHover = () => { hoverKey = undefined; readoutText.data = hint; };
	const onHover = event => {
		const point = event.points[0];
		const [y, x] = point.pointNumber;
		const key = y * cells.nx + x;
		if (key === hoverKey) return;
		hoverKey = key;
		readoutText.data = cellText(cells.xEdges[x], cells.xEdges[x + 1], cells.yEdges[y], cells.yEdges[y + 1], cells.values[key]);
	};
	host.on('plotly_hover', onHover);
	host.on('plotly_unhover', clearHover);
	host.on('plotly_relayout', clearHover);
	const cleanup = setupControls(root, cells, {
		resize() {
			host.style.height = `${height.value}px`;
			return Plotly.relayout(host, { width: host.clientWidth || 1000, height: height.valueAsNumber });
		},
		setData() { return Plotly.restyle(host, { z: [cells.z] }); },
		setColor(mode) { return Plotly.restyle(host, { colorscale: [colorScale(cells.minCount, cells.maxCount, mode)] }); },
	}, hint);
	root.querySelector('#status').textContent = `${cells.times.length.toLocaleString()} cells · ${cells.nx} × ${cells.ny} dense matrix with transparent gaps · native raster heatmap · datetime X / logarithmic Y`;
	return {
		plot: host,
		destroy() {
			cleanup();
			host.removeListener('plotly_hover', onHover);
			host.removeListener('plotly_unhover', clearHover);
			host.removeListener('plotly_relayout', clearHover);
			Plotly.purge(host);
		},
	};
}
