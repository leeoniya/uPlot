// Final bar bounds, grouped by category for constant-time category lookup.
export function createBarHover(horizontal) {
	let over = null;
	let pointerInside = false;
	let rects = new Float64Array(0);
	let categoryCount = 0;
	let categoryStart = 0;
	let categoryStep = 0;
	let seriesCount = 0;
	const hovered = { seriesIdx: 0, dataIdx: null, left: 0, top: 0, width: 0, height: 0 };
	const emptyBox = { left: -10, top: -10, width: 0, height: 0 };

	function mouseEnter(e) {
		if (e.target == over)
			pointerInside = true;
	}

	function mouseLeave() {
		pointerInside = false;
		hovered.dataIdx = null;
	}

	function lookup(u) {
		hovered.dataIdx = null;
		if (categoryCount == 0 || seriesCount == 0)
			return;

		const pxRatio = u.pxRatio;
		const x = u.cursor.left * pxRatio;
		const y = u.cursor.top * pxRatio;
		if (!(x >= 0 && y >= 0 && x <= u.bbox.width && y <= u.bbox.height))
			return;

		// Edge categories also cover the outer margins; exact bounds below reject gaps.
		const position = categoryCount == 1 ? 0 : ((horizontal ? y : x) - categoryStart) / categoryStep;
		const di = Math.max(0, Math.min(categoryCount - 1, Math.round(position)));
		if (lookupCategory(di, x, y, pxRatio))
			return;

		// Touching categories share edges, and rounded distribution offsets can shift the boundary slightly.
		const adjacent = di + (position < di ? -1 : 1);
		if (adjacent >= 0 && adjacent < categoryCount)
			lookupCategory(adjacent, x, y, pxRatio);
	}

	function lookupCategory(di, x, y, pxRatio) {
		const start = di * seriesCount * 4;
		// Reverse order gives shared edges to the last-drawn series.
		for (let si = seriesCount; si > 0; si--) {
			const off = start + (si - 1) * 4;
			const left = rects[off], top = rects[off + 1];
			const right = rects[off + 2], bottom = rects[off + 3];
			if (right > left && bottom > top && x >= left && x <= right && y >= top && y <= bottom) {
				hovered.seriesIdx = si;
				hovered.dataIdx = di;
				hovered.left = left / pxRatio;
				hovered.top = top / pxRatio;
				hovered.width = (right - left) / pxRatio;
				hovered.height = (bottom - top) / pxRatio;
				return true;
			}
		}
		return false;
	}

	return {
		dataIdx(u, seriesIdx) {
			if (seriesIdx == 0)
				lookup(u);
			return seriesIdx == 0 || seriesIdx == hovered.seriesIdx ? hovered.dataIdx : null;
		},
		bbox: (u, seriesIdx) => hovered.dataIdx != null && seriesIdx == hovered.seriesIdx ? hovered : emptyBox,
		each(u, seriesIdx, dataIdx, left, top, width, height) {
			const off = (dataIdx * seriesCount + seriesIdx - 1) * 4;
			rects[off] = left - u.bbox.left;
			rects[off + 1] = top - u.bbox.top;
			rects[off + 2] = left + width - u.bbox.left;
			rects[off + 3] = top + height - u.bbox.top;
		},
		init(u) {
			over = u.over;
			over.addEventListener('mouseenter', mouseEnter, true);
			over.addEventListener('mouseleave', mouseLeave);
		},
		reset(u, paths, firstCenter, step) {
			categoryCount = u.data[0].length;
			const span = horizontal ? u.bbox.height : u.bbox.width;
			categoryStart = firstCenter * span;
			categoryStep = step * span;
			seriesCount = u.series.length - 1;
			for (let si = 1; si < u.series.length; si++) {
				const s = u.series[si];
				if (s.show && s.paths == paths) {
					// Cached paths do not call each(); refresh bounds and value-label geometry together.
					s._paths = null;
				}
			}
			const size = categoryCount * seriesCount * 4;
			if (rects.length < size)
				rects = new Float64Array(size);
			else
				rects.fill(0, 0, size);
			hovered.dataIdx = null;
		},
		draw(u) {
			// Geometry can change under a stationary pointer without changing scale bounds.
			if (pointerInside)
				u.setCursor(u.cursor, false, false);
		},
		destroy() {
			over.removeEventListener('mouseenter', mouseEnter, true);
			over.removeEventListener('mouseleave', mouseLeave);
			over = null;
			rects = new Float64Array(0);
			hovered.dataIdx = null;
			pointerInside = false;
			seriesCount = categoryCount = 0;
		},
	};
}
