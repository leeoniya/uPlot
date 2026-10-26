// Final bar bounds, grouped by category for constant-time category lookup.
export function createBarHover(horizontal, ignoreCount = 0) {
	let plot = null;
	let over = null;
	let band = null;
	let mode = 'bar';
	let pointerInside = false;
	let hasVisibleSeries = false;
	let bandVisible = false;
	let bandStart = -1;
	let bandSize = -1;
	let rects = new Float64Array(0);
	let categoryCount = 0;
	let categoryStart = 0;
	let categoryStep = 0;
	let seriesCount = 0;
	const hovered = { seriesIdx: 0, dataIdx: null, left: 0, top: 0, width: 0, height: 0 };
	const emptyBox = { left: -10, top: -10, width: 0, height: 0 };

	function mouseEnter(e) {
		if (e.target == over) {
			pointerInside = true;
			plot.setCursor(plot.cursor, false, false);
			updateBand(plot);
		}
	}

	function mouseLeave() {
		pointerInside = false;
		hovered.dataIdx = null;
		showBand(false);
	}

	function inPlot(u) {
		return u.cursor.left >= 0 && u.cursor.top >= 0 &&
			u.cursor.left * u.pxRatio <= u.bbox.width && u.cursor.top * u.pxRatio <= u.bbox.height;
	}

	function showBand(show) {
		if (bandVisible != show) {
			band.style.display = show ? '' : 'none';
			bandVisible = show;
		}
	}

	function updateBand(u) {
		if (band == null)
			return;
		const di = hovered.dataIdx;
		const show = mode == 'group' && pointerInside && di != null && inPlot(u);
		if (show) {
			const span = horizontal ? u.bbox.height : u.bbox.width;
			const start = (di == 0 ? 0 : Math.max(0, categoryStart + (di - .5) * categoryStep)) / u.pxRatio;
			const end = (di == categoryCount - 1 ? span : Math.min(span, categoryStart + (di + .5) * categoryStep)) / u.pxRatio;
			const size = end - start;
			if (start != bandStart) {
				band.style.transform = `${horizontal ? 'translateY' : 'translateX'}(${start}px)`;
				bandStart = start;
			}
			if (size != bandSize) {
				band.style[horizontal ? 'height' : 'width'] = `${size}px`;
				bandSize = size;
			}
		}
		showBand(show);
	}

	function lookup(u) {
		hovered.dataIdx = null;
		if (categoryCount == 0 || !hasVisibleSeries || !inPlot(u))
			return;

		const pxRatio = u.pxRatio;
		const x = u.cursor.left * pxRatio;
		const y = u.cursor.top * pxRatio;

		// Edge categories also cover the outer margins; exact bounds below reject gaps.
		const position = categoryCount == 1 ? 0 : ((horizontal ? y : x) - categoryStart) / categoryStep;
		const di = Math.max(0, Math.min(categoryCount - 1, Math.round(position)));
		if (mode == 'group') {
			hovered.dataIdx = di;
			return;
		}
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
		setMode(next) {
			if (next != 'bar' && next != 'group')
				throw new RangeError('Hover mode must be bar or group.');
			if (mode != next) {
				mode = next;
				if (plot != null) {
					plot.setCursor(plot.cursor, false, false);
					updateBand(plot);
				}
			}
		},
		update: updateBand,
		dataIdx(u, seriesIdx) {
			if (seriesIdx == 0)
				lookup(u);
			if (mode == 'group')
				return seriesIdx <= seriesCount && (seriesIdx == 0 || u.series[seriesIdx].show) ? hovered.dataIdx : null;
			return seriesIdx == 0 || seriesIdx == hovered.seriesIdx ? hovered.dataIdx : null;
		},
		bbox: (u, seriesIdx) => mode == 'bar' && hovered.dataIdx != null && seriesIdx == hovered.seriesIdx ? hovered : emptyBox,
		each(u, seriesIdx, dataIdx, left, top, width, height) {
			const off = (dataIdx * seriesCount + seriesIdx - 1) * 4;
			rects[off] = left - u.bbox.left;
			rects[off + 1] = top - u.bbox.top;
			rects[off + 2] = left + width - u.bbox.left;
			rects[off + 3] = top + height - u.bbox.top;
		},
		init(u) {
			plot = u;
			over = u.over;
			band = document.createElement('div');
			band.className = 'u-bar-group-hover';
			Object.assign(band.style, {
				position: 'absolute', pointerEvents: 'none', display: 'none',
				left: '0', top: '0', background: 'rgba(51,204,255,0.3)',
				[horizontal ? 'width' : 'height']: '100%',
			});
			u.under.appendChild(band);
			over.addEventListener('mouseenter', mouseEnter, true);
			over.addEventListener('mouseleave', mouseLeave);
		},
		reset(u, paths, firstCenter, step, groupPaths) {
			categoryCount = u.data[0].length;
			const span = horizontal ? u.bbox.height : u.bbox.width;
			categoryStart = firstCenter * span;
			categoryStep = step * span;
			seriesCount = u.series.length - 1 - ignoreCount;
			hasVisibleSeries = false;
			for (let si = 1; si <= seriesCount; si++) {
				const s = u.series[si];
				if (s.show && (s.paths == paths || groupPaths != null && s.paths == groupPaths)) {
					hasVisibleSeries = true;
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
			updateBand(u);
		},
		destroy() {
			over.removeEventListener('mouseenter', mouseEnter, true);
			over.removeEventListener('mouseleave', mouseLeave);
			band.remove();
			plot = over = band = null;
			rects = new Float64Array(0);
			hovered.dataIdx = null;
			pointerInside = bandVisible = hasVisibleSeries = false;
			bandStart = bandSize = -1;
			seriesCount = categoryCount = 0;
		},
	};
}
