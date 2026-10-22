import uPlot from '../../src/uPlot.js';
import Flatbush from './flatbush.js';

// One instance per mode-2 chart. Scales, facets, styles, and legend formatting belong to the caller.
export function scatterPlugin({points = {}, disp, batch = false, hover = false} = {}) {
	const hit = hover ? pointHover() : null;
	const pointPaths = uPlot.paths.points({batch, disp, each: hit?.each});
		const paths = hit == null ? pointPaths : (u, si, i0, i1, indices) => {
			hit.setFilter(si, indices);
			return pointPaths(u, si, i0, i1, indices);
		};

	return {
		opts(u, opts) {

			for (let si = 1; si < opts.series.length; si++) {
				const series = opts.series[si];
				series.paths = () => null;
				series.pxAlign ??= opts.pxAlign ?? 0;
				series.points = {show: true, fill: series.fill, ...points, ...series.points, paths};
			}

			if (hit != null) {
				opts.cursor = uPlot.assign({}, hit.cursor, opts.cursor, {
					dataIdx: hit.cursor.dataIdx,
					points: {size: hit.cursor.points.size},
					focus: {dist: hit.cursor.focus.dist},
				});
			}
		},
		hooks: hit?.hooks ?? {},
	};
}

// Unordered mode-2 data needs a spatial lookup, independently of point rendering.
function pointHover() {
	let hoverIndex = null;
	let indexReady = false;
	let hoverSeries = null;
	let hoverDataIdx = null;
	let hoverDiameter = 0;
	const slots = [];
	let nextSlot = 0;
	let slotEnd = 0;

	function cursorInside(u) {
		return u.cursor.left >= 0 && u.cursor.top >= 0;
	}

	function finishHoverIndex() {
		if (hoverIndex != null && nextSlot == hoverIndex.numItems && !indexReady) {
			hoverIndex.finish();
			indexReady = true;
		}
	}

	function clearHoverIndex() {
		hoverIndex = hoverSeries = hoverDataIdx = null;
		hoverDiameter = 0;
		indexReady = false;
		slots.length = 0;
		nextSlot = slotEnd = 0;
	}

	function resetHoverIndex(u) {
		clearHoverIndex();
		let count = 0;
		for (let si = 1; si < u.series.length; si++) {
			const length = u.series[si].show ? u.data[si][0].length : 0;
			slots[si] = {start: -1, length, indices: null};
			count += length;
		}
		if (count > 0)
			hoverIndex = new Flatbush(count);
	}

	function padSlots(end) {
		while (nextSlot < end) {
			hoverIndex.add(0, 0, 0, 0);
			nextSlot++;
		}
	}

	function buildHoverIndex(u) {
		if (hoverIndex != null)
			padSlots(hoverIndex.numItems);

		if (cursorInside(u)) {
			finishHoverIndex();
			// Geometry can change beneath a stationary pointer.
			u.setCursor(u.cursor, false, false);
		}
	}

	return {
		setFilter(seriesIdx, indices) {
			// Reserve each series in paint order, after padding the previous series.
			padSlots(slotEnd);
			const slot = slots[seriesIdx];
			slot.start = nextSlot;
			slotEnd = nextSlot + slot.length;
			slot.indices = indices;
		},
		each: (u, seriesIdx, dataIdx, lft, top, wid, hgt) => {
			const slot = slots[seriesIdx];
			const offset = slot.indices == null ? dataIdx : slot.indices.indexOf(dataIdx, Math.max(0, nextSlot - slot.start));
			// Empty slots preserve data indices when the point builder skips a point.
			padSlots(slot.start + offset);

			hoverIndex.add(lft, top, lft + wid, top + hgt);
			nextSlot++;
		},
		cursor: {
			dataIdx: (u, seriesIdx) => {
				if (seriesIdx == 1) {
					hoverSeries = hoverDataIdx = null;
					hoverDiameter = 0;
					let dist = Infinity;
					let diameter = Infinity;
					let bestId = -1;
					let cx = u.cursor.left * u.pxRatio;
					let cy = u.cursor.top * u.pxRatio;

					if (hoverIndex != null && nextSlot == hoverIndex.numItems && cursorInside(u) && cx <= u.bbox.width && cy <= u.bbox.height) {
						finishHoverIndex();
						cx += u.bbox.left;
						cy += u.bbox.top;
						hoverIndex.search(cx, cy, cx, cy, (id, x0, y0, x1, y1) => {
							const w = x1 - x0;

							if (w == 0)
								return false;
							const d = (x0 + w / 2 - cx) ** 2 + ((y0 + y1) / 2 - cy) ** 2;

							// Prefer the smallest circle, then nearest center, then last-painted point.
							if (d <= w * w / 4 && (w < diameter || w == diameter && (d < dist || d == dist && id > bestId))) {
								diameter = w;
								dist = d;
								bestId = id;
							}

							// Select here without collecting a result array of candidate IDs.
							return false;
						});

						if (bestId != -1) {
							for (let si = 1; si < slots.length; si++) {
								const slot = slots[si];
								if (slot.start != -1 && bestId >= slot.start && bestId < slot.start + slot.length) {
									hoverSeries = si;
									const offset = bestId - slot.start;
									hoverDataIdx = slot.indices == null ? offset : slot.indices[offset];
									hoverDiameter = diameter;
									break;
								}
							}
						}
					}
				}

				return seriesIdx == hoverSeries ? hoverDataIdx : null;
			},
			points: {
				size: (u, seriesIdx) => seriesIdx == hoverSeries ? hoverDiameter / u.pxRatio : 0,
			},
			focus: {
				prox: 1e3,
				alpha: 0.3,
				dist: (u, seriesIdx) => seriesIdx == hoverSeries ? 0 : Infinity,
			},
		},
		hooks: {
			init: u => u.over.addEventListener('mouseenter', finishHoverIndex),
			destroy: u => {
				u.over.removeEventListener('mouseenter', finishHoverIndex);
				clearHoverIndex();
			},
			drawClear: resetHoverIndex,
			draw: buildHoverIndex,
		},
	};
}
