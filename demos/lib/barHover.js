import Flatbush from './flatbush.js';

// One hover index per chart, populated by the bar pathbuilder's each callback.
export function createBarHover() {
	let over = null;
	let index = null;
	let indexFinished = false;
	let pointerInside = false;
	const hovered = { seriesIdx: 0, dataIdx: null, left: 0, top: 0, width: 0, height: 0 };
	const emptyBox = { left: -10, top: -10, width: 0, height: 0 };
	const seriesOffsets = [];
	let nextItem = 0;
	let hitId = -1;
	let hitLeft, hitTop, hitRight, hitBottom;

	function skipItems(end) {
		// Keep item IDs aligned with data slots without a per-bar metadata array.
		while (nextItem < end) {
			index.add(0, 0);
			nextItem++;
		}
	}

	function finishIndex() {
		if (index != null && !indexFinished) {
			index.finish();
			indexFinished = true;
		}
	}

	function mouseEnter(e) {
		if (e.target == over) {
			pointerInside = true;
			finishIndex();
		}
	}

	function mouseLeave() {
		pointerInside = false;
		hovered.dataIdx = null;
	}

	function filter(id, x0, y0, x1, y1) {
		// Tree traversal order is not draw order. Prefer the last-drawn bar.
		if (id > hitId && x1 > x0 && y1 > y0) {
			hitId = id;
			hitLeft = x0;
			hitTop = y0;
			hitRight = x1;
			hitBottom = y1;
		}
		return false;
	}

	function lookup(u) {
		hovered.dataIdx = null;
		if (!indexFinished)
			return;

		const pxRatio = u.pxRatio;
		const x = u.cursor.left * pxRatio;
		const y = u.cursor.top * pxRatio;
		if (!(x >= 0 && y >= 0 && x <= u.bbox.width && y <= u.bbox.height))
			return;

		hitId = -1;
		index.search(x, y, x, y, filter);
		if (hitId < 0)
			return;

		let si = seriesOffsets.length - 1;
		while (seriesOffsets[si] < 0 || seriesOffsets[si] > hitId)
			si--;
		hovered.seriesIdx = si;
		hovered.dataIdx = hitId - seriesOffsets[si];
		hovered.left = hitLeft / pxRatio;
		hovered.top = hitTop / pxRatio;
		hovered.width = (hitRight - hitLeft) / pxRatio;
		hovered.height = (hitBottom - hitTop) / pxRatio;
	}

	return {
		dataIdx(u, seriesIdx) {
			if (seriesIdx == 0)
				lookup(u);
			return seriesIdx == 0 || seriesIdx == hovered.seriesIdx ? hovered.dataIdx : null;
		},
		bbox: (u, seriesIdx) => hovered.dataIdx != null && seriesIdx == hovered.seriesIdx ? hovered : emptyBox,
		each(u, seriesIdx, dataIdx, left, top, width, height) {
			skipItems(seriesOffsets[seriesIdx] + dataIdx);
			index.add(left - u.bbox.left, top - u.bbox.top, left + width - u.bbox.left, top + height - u.bbox.top);
			nextItem++;
		},
		init(u) {
			over = u.over;
			// Finish before uPlot's non-capturing entry handler or caller hover handlers.
			over.addEventListener('mouseenter', mouseEnter, true);
			over.addEventListener('mouseleave', mouseLeave);
		},
		reset(u, paths) {
			let numItems = 0;
			seriesOffsets.length = u.series.length;
			seriesOffsets.fill(-1);
			for (let si = 1; si < u.series.length; si++) {
				const series = u.series[si];
				if (series.show && series.paths == paths) {
					seriesOffsets[si] = numItems;
					numItems += u.data[0].length;
					// Cached paths do not call each(), so rebuild them with the index.
					series._paths = null;
				}
			}
			index = numItems > 0 ? new Flatbush(numItems) : null;
			hovered.dataIdx = null;
			indexFinished = false;
			nextItem = 0;
		},
		draw(u) {
			if (index != null)
				skipItems(index.numItems);
			if (pointerInside) {
				finishIndex();
				// Geometry can change under a stationary pointer without changing scale bounds.
				u.setCursor(u.cursor, false, false);
			}
		},
		destroy() {
			over.removeEventListener('mouseenter', mouseEnter, true);
			over.removeEventListener('mouseleave', mouseLeave);
			over = index = null;
			hovered.dataIdx = null;
			indexFinished = pointerInside = false;
			seriesOffsets.length = nextItem = 0;
		},
	};
}
