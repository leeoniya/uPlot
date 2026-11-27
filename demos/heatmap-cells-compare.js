// Shared data and controls for the native-library heatmap comparisons.
const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'];
const rgb = stops.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
const colorCount = 24;
export const palette = Array.from({ length: colorCount }, (_, i) => {
	const t = i / (colorCount - 1) * (rgb.length - 1);
	const lo = Math.min(Math.floor(t), rgb.length - 2);
	return `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
});

// Comparison demos require nonempty cells sorted by xMax, then by yMin within each timestamp.
export function readCells(frames) {
	const frame = frames.find(f => f.schema?.meta?.type == 'heatmap-cells');
	const field = name => frame.schema.fields.findIndex(f => f.name == name);
	const values = name => frame.data.values[field(name)];
	const times = values('xMax'), yMin = values('yMin'), yMax = values('yMax'), counts = values('count');
	const xSize = frame.schema.fields[field('xMax')].config.interval;
	const minTime = times[0], maxX = times[times.length - 1];
	let minY = Infinity, maxY = -Infinity, minCount = Infinity, maxCount = -Infinity;
	for (let i = 0; i < times.length; i++) {
		const count = counts[i];
		minY = Math.min(minY, yMin[i]);
		maxY = Math.max(maxY, yMax[i]);
		minCount = Math.min(minCount, count);
		maxCount = Math.max(maxCount, count);
	}
	return { times, yMin, yMax, counts, xSize, minTime, minX: minTime - xSize, maxX, minY, maxY, minCount, maxCount };
}

// Grid consumers expect uniform time intervals, exponential buckets, and unique locations.
export function gridShape(cells) {
	const { yMin, yMax, xSize, minTime, maxX, minY, maxY } = cells;
	const factor = yMax[0] / yMin[0];
	const logStep = Math.log(factor);
	const nx = Math.round((maxX - minTime) / xSize) + 1;
	const ny = Math.round(Math.log(maxY / minY) / logStep);
	return { nx, ny, factor, logStep };
}

// Only the matrix renderer needs a dense input grid; NaN cells remain transparent.
export function gridCells(cells) {
	const { nx, ny, factor, logStep } = gridShape(cells);
	const { times, yMin, yMax, counts, xSize, minTime, minX, minY } = cells;
	const values = new Float64Array(nx * ny).fill(NaN);
	const xEdges = Float64Array.from({ length: nx + 1 }, (_, i) => minX + i * xSize);
	const yEdges = Float64Array.from({ length: ny + 1 }, (_, i) => minY * factor ** i);
	for (let i = 0; i < times.length; i++) {
		const ix = Math.round((times[i] - minTime) / xSize);
		const iy = Math.round(Math.log(yMin[i] / minY) / logStep);
		values[iy * nx + ix] = counts[i];
		// Retain the supplied bucket edges rather than their reconstructed approximations.
		yEdges[iy] = yMin[i];
		yEdges[iy + 1] = yMax[i];
	}
	return { nx, ny, values, xEdges, yEdges };
}

// Sparse hit testing for renderers without a native cell-hover API.
export function cellLookup(cells) {
	const { times, yMin, yMax, xSize } = cells;

	return (x, y) => {
		let lo = 0, hi = times.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1, right = times[mid];
			// Skip earlier columns and buckets ending at or below y in the hovered column.
			if (right <= x || (right - xSize <= x && yMax[mid] <= y)) lo = mid + 1;
			else hi = mid;
		}
		// The next populated cell can be across a time or bucket gap.
		return lo < times.length && times[lo] - xSize <= x && yMin[lo] <= y ? lo : -1;
	};
}

export function colorPosition(value, min, max, mode) {
	if (min == max) return 0;
	const t = mode == 'log' ? Math.log(value / min) / Math.log(max / min) : (value - min) / (max - min);
	return Math.max(0, Math.min(1, mode == 'sqrt' ? Math.sqrt(t) : t));
}

// Count at a normalized color position; useful for native piecewise color scales.
export function colorBoundary(t, min, max, mode) {
	return mode == 'log' ? min * (max / min) ** t : min + (max - min) * (mode == 'sqrt' ? t * t : t);
}

export const format = value => Number(value.toPrecision(5)).toString();
export const time = ms => new Date(ms).toISOString().slice(11, 19);
export const cellText = (left, right, bottom, top, count) => `${time(left)}–${time(right)} UTC · Y: ${format(bottom)}–${format(top)} s · Count: ${format(count)}`;

export function setupControls(root, cells, { resize, setData, setColor }, hint) {
	const height = root.querySelector('#height');
	const mode = root.querySelector('#color-scale');
	const button = root.querySelector('#set-data');
	const readout = root.querySelector('#hover');
	const readoutText = readout.firstChild ?? readout.appendChild(document.createTextNode(''));
	readoutText.data = hint;
	root.querySelector('#color-ramp').style.background = `linear-gradient(to right, ${palette.join(',')})`;
	root.querySelector('#color-min').textContent = format(cells.minCount);
	root.querySelector('#color-max').textContent = format(cells.maxCount);
	const label = () => root.querySelector('#color-scale-label').textContent = `Count · ${mode.value == 'sqrt' ? '√' : mode.value} scale`;
	const onResize = () => {
		root.querySelector('#height-value').textContent = `${height.value}px`;
		readoutText.data = hint;
		resize();
	};
	const onColor = () => { label(); setColor(mode.value); };
	const onData = () => { readoutText.data = hint; setData(); };
	label();
	height.addEventListener('input', onResize);
	mode.addEventListener('change', onColor);
	button.addEventListener('click', onData);
	window.addEventListener('resize', onResize);
	height.disabled = mode.disabled = button.disabled = false;
	return () => {
		height.removeEventListener('input', onResize);
		mode.removeEventListener('change', onColor);
		button.removeEventListener('click', onData);
		window.removeEventListener('resize', onResize);
		height.disabled = mode.disabled = button.disabled = true;
	};
}
