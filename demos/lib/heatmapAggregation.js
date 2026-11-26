function axis(min, max, bins) {
	const constant = min === max;
	const lo = constant ? min - 0.5 : min;
	const hi = constant ? max + 0.5 : max;
	const span = constant ? 1 : hi - lo;
	const size = span / bins, inv = bins / span;
	// At magnitude 2**52 and above, a half-unit offset is no longer reliable.
	if (size === 0 || !Number.isFinite(size) || !Number.isFinite(inv) || (constant && Math.abs(min) >= 2 ** 52))
		throw new RangeError('axis range or inverse step is not representable');

	const edge = constant
		? i => min + (i / bins - 0.5)
		: i => i === bins ? hi : lo + i * size;

	// Near the precision limit even interior edges can round to the same value.
	if (size <= 2 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi))) {
		let prev = lo;
		for (let i = 1; i <= bins; i++) {
			const next = edge(i);
			if (!(next > prev))
				throw new RangeError('adjacent bucket edges are indistinguishable');
			prev = next;
		}
	}

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

export function aggregateHeatmap(xs, ys, nx, ny) {
	const n = xs?.length;
	if (!Number.isSafeInteger(n) || n < 1 || n !== ys?.length)
		throw new RangeError('xs and ys must be nonempty and have equal lengths');
	const cells = nx * ny;
	if (!Number.isInteger(nx) || nx < 1 || !Number.isInteger(ny) || ny < 1 || cells > 2 ** 24)
		throw new RangeError('nx and ny must be positive integers with nx * ny <= 2**24');


	// Callers supply finite coordinates.
	let xmin = xs[0], xmax = xmin, ymin = ys[0], ymax = ymin;
	for (let i = 1; i < n; i++) {
		const x = xs[i], y = ys[i];
		if (x < xmin) xmin = x;
		else if (x > xmax) xmax = x;
		if (y < ymin) ymin = y;
		else if (y > ymax) ymax = y;
	}

	const x = axis(xmin, xmax, nx), y = axis(ymin, ymax, ny);
	const offset = x.offset * ny + y.offset;
	const dense = new Uint32Array(cells);
	let used = 0;
	for (let i = 0; i < n; i++) {
		const id = bucketId(xs[i], ys[i], x, y, ny, offset);
		used += dense[id]++ === 0;
	}

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
