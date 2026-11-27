function axis(min, max, bins) {
	const constant = min === max;
	const lo = constant ? min - 0.5 : min;
	const hi = constant ? max + 0.5 : max;
	const span = constant ? 1 : hi - lo;
	const size = span / bins, inv = bins / span;

	const edge = constant
		? i => min + (i / bins - 0.5)
		: i => i === bins ? hi : lo + i * size;

	// Bucket lookup subtracts the observed minimum, so a constant axis has
	// zero displacement and starts at its center bin instead of bin zero.
	return {range: [lo, hi], min, size, inv, last: bins - 1, offset: constant ? bins >>> 1 : 0, edge};
}

function bucketId(xVal, yVal, x, y, ny, offset) {
	// The 2**24 cell limit keeps indices within int32. For nonnegative coordinates, truncation is floor.
	let col = ((xVal - x.min) * x.inv) | 0;
	let row = ((yVal - y.min) * y.inv) | 0;
	if (col > x.last) col = x.last;
	if (row > y.last) row = y.last;
	return offset + col * ny + row;
}

function extent(values) {
	let min = values[0], max = min;
	for (let i = 1; i < values.length; i++) {
		const v = values[i];
		if (v < min) min = v;
		else if (v > max) max = v;
	}
	return [min, max];
}

// xs and ys must be nonempty, equal-length arrays of finite coordinates.
export function getSampleBounds(xs, ys) {
	const [xmin, xmax] = extent(xs), [ymin, ymax] = extent(ys);
	return {xmin, xmax, ymin, ymax};
}

// Supply bounds from getSampleBounds only while the sample is unchanged.
// nx and ny must be positive integers with nx * ny <= 2**24.
// Each axis needs a finite positive step and inverse step, with distinct, increasing edges.
// A constant coordinate must have magnitude below 2**52 for the half-unit padding.
export function aggregateHeatmap(xs, ys, nx, ny, bounds = getSampleBounds(xs, ys)) {
	const n = xs.length, cells = nx * ny;
	const {xmin, xmax, ymin, ymax} = bounds;
	const x = axis(xmin, xmax, nx), y = axis(ymin, ymax, ny);
	const offset = x.offset * ny + y.offset;
	const dense = new Uint32Array(cells);
	let used = 0;
	for (let i = 0; i < n; i++) {
		const id = bucketId(xs[i], ys[i], x, y, ny, offset);
		used += dense[id]++ === 0;
	}

	return emitCells(dense, used, nx, ny, x, y);
}

function emitCells(dense, used, nx, ny, x, y) {
	const xMax = new Float64Array(used), yMin = new Float64Array(used), yMax = new Float64Array(used);
	const counts = new Uint32Array(used);
	const edges = new Float64Array(ny + 1);
	for (let row = 0; row <= ny; row++)
		edges[row] = y.edge(row);

	for (let col = 0, base = 0, pos = 0; col < nx; col++, base += ny) {
		const start = pos;
		for (let row = 0; row < ny; row++) {
			const count = dense[base + row];
			if (count === 0) continue;
			yMin[pos] = edges[row];
			yMax[pos] = edges[row + 1];
			counts[pos++] = count;
		}
		if (pos > start)
			xMax.fill(x.edge(col + 1), start, pos);
	}

	return {
		data: [null, [xMax, yMin, yMax, counts]],
		grid: {x: {step: x.size, extent: [x.edge(1), x.edge(nx)]}, y: {extent: y.range}},
		xSize: x.size, xRange: x.range, yRange: y.range,
				scratchBytes: dense.byteLength + edges.byteLength,
	};
}
