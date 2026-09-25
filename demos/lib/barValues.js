const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });
const percentFormat = new Intl.NumberFormat('en', { style: 'percent', maximumSignificantDigits: 3 });

const font = size => `${size}px Arial`;

// Value labels use the final bar rectangles, including native stack baselines.
export function createBarValues(horizontal) {
	const minSize = 10;
	const maxSize = 25;
	const gapFactor = .4;
	const cacheLimit = 1024;

	const rawMetrics = new Map();
	const percentMetrics = new Map();
	const textMetrics = new Map();
	let measureCtx = null;
	let measureSize = 0;
	let groups = [];
	let percent = false;
	let enabled = false;
	const groupForSeries = [];
	const baselines = [];
	const totals = [];
	// Reuse flat records: series, data index, left, top, width, height, outward direction.
	// Direction zero marks an inside label. No rectangle objects are allocated per draw.
	const rects = [];
	const metrics = [];
	let count = 0;

	function measure(value, asPercent) {
		const cache = asPercent ? percentMetrics : rawMetrics;
		let metric = cache.get(value);
		if (metric == null) {
			const text = (asPercent ? percentFormat : compact).format(value);
			metric = textMetrics.get(text);
			if (metric == null) {
				if (measureCtx == null) {
					measureCtx = new OffscreenCanvas(1, 1).getContext('2d');
					measureCtx.font = font(measureSize);
					measureCtx.textBaseline = 'alphabetic';
				}
				// Bound retention across data updates without per-entry eviction bookkeeping.
				if (textMetrics.size >= cacheLimit) {
					textMetrics.clear();
					rawMetrics.clear();
					percentMetrics.clear();
				}
				const measured = measureCtx.measureText(text);
				metric = {
					text,
					width: measured.width,
					ascent: measured.actualBoundingBoxAscent ?? measureSize * .8,
					descent: measured.actualBoundingBoxDescent ?? measureSize * .2,
				};
				textMetrics.set(text, metric);
			}
			// Distinct numbers can format identically, especially native percent shares.
			if (cache.size >= cacheLimit)
				cache.clear();
			cache.set(value, metric);
		}
		return metric;
	}

	function add(si, di, left, top, width, height, direction, metric) {
		const off = count * 7;
		rects[off] = si;
		rects[off + 1] = di;
		rects[off + 2] = left;
		rects[off + 3] = top;
		rects[off + 4] = width;
		rects[off + 5] = height;
		rects[off + 6] = direction;
		metrics[count++] = metric;
		return off;
	}

	function direction(u, si, di) {
		return (u.data[si][di] < 0 ? -1 : 1) * u.scales[u.series[si].scale].dir * (horizontal ? 1 : -1);
	}

	function fitSize(u, i) {
		const off = i * 7;
		const metric = metrics[i];
		if (metric == null)
			return 0;
		const textHeight = metric.ascent + metric.descent || measureSize;
		let size = Math.min(measureSize, .8 * measureSize * (horizontal ? rects[off + 5] / textHeight : rects[off + 4] / metric.width));
		const dir = rects[off + 6];
		if (dir != 0) {
			const start = horizontal ? rects[off + 2] : rects[off + 3];
			const length = horizontal ? rects[off + 4] : rects[off + 5];
			const edge = horizontal ? u.bbox.left : u.bbox.top;
			const span = horizontal ? u.bbox.width : u.bbox.height;
			const available = dir < 0 ? start - edge : edge + span - start - length;
			size = Math.min(size, available / ((horizontal ? metric.width : textHeight) / measureSize + gapFactor));
		}
		return size;
	}

	return {
		configure(stackGroups, stackPercent) {
			groups = stackGroups;
			percent = stackPercent;
			groupForSeries.length = 0;
			for (let gi = 0; gi < groups.length; gi++) {
				for (const si of groups[gi].series)
					groupForSeries[si] = gi;
			}
		},
		invalidate() {
			rawMetrics.clear();
			percentMetrics.clear();
			metrics.length = baselines.length = count = 0;
		},
		reset(u, show) {
			enabled = show;
			count = 0;
			baselines.fill(null);
			if (!enabled) {
				metrics.length = 0;
				return;
			}
			// Measure at the largest draw size; scaling small-font ink bounds up magnifies rounding errors.
			const size = maxSize * u.pxRatio;
			if (measureSize != size) {
				measureSize = size;
				rawMetrics.clear();
				percentMetrics.clear();
				textMetrics.clear();
				metrics.length = 0;
				if (measureCtx != null)
					measureCtx.font = font(size);
			}
			totals.length = percent ? 0 : groups.length * u.data[0].length * 2;
			totals.fill(-1);
			if (percent) {
				// Sign-consistent stacks use bands rather than per-point _base arrays.
				for (const group of groups) {
					let previous = null;
					for (const si of group.series) {
						if (u.series[si].show) {
							baselines[si] = u._base?.[si] ?? previous;
							previous = u._data[si];
						}
					}
				}
			}
		},
		each(u, si, di, left, top, width, height) {
			if (!enabled || !Number.isFinite(u.data[si][di]))
				return;
			const gi = groupForSeries[si];
			const stacked = gi != null;
			const thickness = horizontal ? height : width;
			const length = horizontal ? width : height;
			// Subpixel segments still contribute to native stack totals.
			if (thickness <= 0 || length < 0 || length == 0 && (!stacked || percent))
				return;
			const end = u._data[si][di];
			const value = percent && stacked ? end - (baselines[si]?.[di] ?? 0) : u.data[si][di];
			const off = add(si, di, left, top, width, height, stacked ? 0 : direction(u, si, di), length == 0 ? null : measure(value, percent && stacked));
			if (stacked && !percent) {
				const slot = (gi * u.data[0].length + di) * 2 + (end < 0 ? 1 : 0);
				const prev = totals[slot];
				if (prev < 0 || Math.abs(end) > Math.abs(u._data[rects[prev]][di]))
					totals[slot] = off;
			}
		},
		draw(u) {
			if (!enabled || count == 0) {
				metrics.length = 0;
				return;
			}
			for (const off of totals) {
				if (off >= 0) {
					const si = rects[off], di = rects[off + 1];
					add(si, di, rects[off + 2], rects[off + 3], rects[off + 4], rects[off + 5], direction(u, si, di), measure(u._data[si][di], false));
				}
			}
			metrics.length = count;
			const minPxSize = minSize * u.pxRatio;
			let insideSize = measureSize;
			let outsideSize = insideSize;
			for (let i = 0; i < count; i++) {
				const size = fitSize(u, i);
				if (size >= minPxSize) {
					if (rects[i * 7 + 6] == 0)
						insideSize = Math.min(insideSize, size);
					else
						outsideSize = Math.min(outsideSize, size);
				}
			}
			const ctx = u.ctx;
			ctx.save();
			ctx.fillStyle = 'black';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'alphabetic';
			let lastSize = 0;
			for (let i = 0; i < count; i++) {
				if (fitSize(u, i) < minPxSize)
					continue;
				const off = i * 7;
				const left = rects[off + 2], top = rects[off + 3];
				const width = rects[off + 4], height = rects[off + 5];
				const dir = rects[off + 6];
				const size = dir == 0 ? insideSize : outsideSize;
				const scale = size / measureSize;
				const metric = metrics[i];
				const textWidth = metric.width * scale;
				const ascent = metric.ascent * scale, descent = metric.descent * scale;
				if (dir == 0 && (textWidth > width * .8 || ascent + descent > height * .8))
					continue;
				let x = left + width / 2;
				let y = top + height / 2 + (ascent - descent) / 2;
				const gap = gapFactor * size;
				if (dir != 0) {
					if (horizontal)
						x = dir < 0 ? left - gap - textWidth / 2 : left + width + gap + textWidth / 2;
					else
						y = dir < 0 ? top - gap - descent : top + height + gap + ascent;
				}
				if (x - textWidth / 2 < u.bbox.left || x + textWidth / 2 > u.bbox.left + u.bbox.width ||
					y - ascent < u.bbox.top || y + descent > u.bbox.top + u.bbox.height)
					continue;
				if (size != lastSize) {
					ctx.font = font(size);
					lastSize = size;
				}
				ctx.globalAlpha = u.series[rects[off]].alpha;
				ctx.fillText(metric.text, x, y);
			}
			ctx.restore();
		},
		destroy() {
			rawMetrics.clear();
			percentMetrics.clear();
			textMetrics.clear();
			rects.length = metrics.length = totals.length = baselines.length = groupForSeries.length = count = 0;
			groups = [];
			measureCtx = null;
			measureSize = 0;
		},
	};
}
