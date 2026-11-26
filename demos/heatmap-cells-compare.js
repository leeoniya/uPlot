// Shared data and controls for the native-library heatmap comparisons.
const stops = ['5e4fa2', '3288bd', '66c2a5', 'abdda4', 'e6f598', 'ffffbf', 'fee08b', 'fdae61', 'f46d43', 'd53e4f', '9e0142'];
const rgb = stops.map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
const colorCount = 24;
export const palette = Array.from({ length: colorCount }, (_, i) => {
	const t = i / (colorCount - 1) * (rgb.length - 1);
	const lo = Math.min(Math.floor(t), rgb.length - 2);
	return `rgb(${rgb[lo].map((v, c) => Math.round(v + (rgb[lo + 1][c] - v) * (t - lo))).join(',')})`;
});

export function readCells(frames) {
	const frame = frames.find(f => f.schema?.meta?.type == 'heatmap-cells');
	if (!frame)
		throw new Error('No heatmap-cells frame found');
	const field = name => frame.schema.fields.findIndex(f => f.name == name);
	const values = name => frame.data.values[field(name)];
	const times = values('xMax'), yMin = values('yMin'), yMax = values('yMax'), counts = values('count');
	const xSize = frame.schema.fields[field('xMax')]?.config?.interval;
	if (!(Number.isFinite(xSize) && xSize > 0) || !times?.length || [yMin, yMax, counts].some(a => a?.length != times.length))
		throw new Error('Expected nonempty xMax, yMin, yMax, and count arrays and a positive time interval');
	// The producer supplies finite numbers, increasing positive bucket bounds, and positive counts.
	let minTime = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minCount = Infinity, maxCount = -Infinity;
	for (let i = 0; i < times.length; i++) {
		const t = times[i], count = counts[i];
		minTime = Math.min(minTime, t);
		maxX = Math.max(maxX, t);
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
	if (!(nx > 0 && ny > 0 && Number.isSafeInteger(nx * ny)))
		throw new Error('Invalid heatmap grid dimensions');
	return { nx, ny, factor, logStep };
}

export function checkGridIndex(ix, iy, nx, ny) {
	if (!(ix >= 0 && ix < nx && iy >= 0 && iy < ny))
		throw new Error(`Heatmap cell index out of bounds: ${ix}, ${iy}`);
}

// Only the matrix renderer needs a dense input grid; NaN cells remain transparent.
export function gridCells(cells) {
	const { nx, ny, factor, logStep } = gridShape(cells);
	const { times, yMin, yMax, counts, xSize, minTime, minX, minY } = cells;
	if (Math.max(nx + 1, ny + 1, nx * ny) > 0xffffffff)
		throw new RangeError('Heatmap matrix or edge array is too large');
	const values = new Float64Array(nx * ny).fill(NaN);
	const xEdges = Float64Array.from({ length: nx + 1 }, (_, i) => minX + i * xSize);
	const yEdges = Float64Array.from({ length: ny + 1 }, (_, i) => minY * factor ** i);
	for (let i = 0; i < times.length; i++) {
		const ix = Math.round((times[i] - minTime) / xSize);
		const iy = Math.round(Math.log(yMin[i] / minY) / logStep);
		checkGridIndex(ix, iy, nx, ny);
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
	const order = Uint32Array.from({ length: times.length }, (_, i) => i);
	order.sort((a, b) => times[a] - times[b] || yMin[a] - yMin[b]);
	return (x, y) => {
		// Find the first time endpoint after x, then the last lower bucket edge <= y.
		let lo = 0, hi = order.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (times[order[mid]] <= x) lo = mid + 1;
			else hi = mid;
		}
		if (lo == order.length) return -1;
		const right = times[order[lo]];
		if (x < right - xSize) return -1;
		hi = order.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1, i = order[mid];
			if (times[i] == right && yMin[i] <= y) lo = mid + 1;
			else hi = mid;
		}
		const i = order[lo - 1];
		return i != null && times[i] == right && yMin[i] <= y && y < yMax[i] ? i : -1;
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
