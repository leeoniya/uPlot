function limits(u, key) {
	const { left, top, width, height } = u.bbox;
	return key == 'x' ? [left, left + width] : [top, top + height];
}

// Use full source intervals; clipping decides intersection, not the bucket's resolution.
export function minVisibleSpan(u, key, edges) {
	const [start, end] = limits(u, key);
	let previous, min = Infinity;
	for (const edge of edges) {
		const p = u.valToPos(edge, key, true);
		if (previous != null) {
			const lo = Math.min(previous, p), hi = Math.max(previous, p);
			if (Math.max(lo, start) < Math.min(hi, end)) min = Math.min(min, hi - lo);
		}
		previous = p;
	}
	return min;
}

export function paintedEdge(u, key, value, snap = true) {
	const [start, end] = limits(u, key);
	const pixel = u.valToPos(value, key, true);
	if (pixel <= start) return start;
	if (pixel >= end) return end;
	return Math.max(start, Math.min(end, snap ? Math.round(pixel) : pixel));
}
