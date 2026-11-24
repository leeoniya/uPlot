// Requires mode: 2, ascending X runs, and ascending Y cells within each run.
// Data: [null, [xMax, yMin, yMax, count]]. Missing columns and rows remain sparse.
// Counts must be finite and positive; omit empty buckets rather than supplying zero/null counts.
// Both axes must follow an aligned, uniform progression in their grid transform.
// grid uses distr: 1 (linear), 3 (log), or 4 (asinh, with a fixed numeric threshold).
// Explicit grid.y {distr: 3, factor: >1} instead uses signed exponential rows:
// Regular edges are factor ** integer, mirrored below zero. One shared bucket may straddle zero.
// zeroHeight is its minimum projected height in CSS pixels (number or (u) => number, default 0).
// Expand around zero, clipping at regular rows or the plot edge.
// Grid transforms default to linear X and log Y, independently of the displayed uPlot scales.
// xSize is the bucket width in transformed X units. Implicit Y width comes from the first cell.
// cellGap is a CSS-pixel number or (u) => number, read once per draw; it defaults to 0.
// Omit gaps globally if they remove over 10% of the area formed by the smallest visible grid width/height.
// Measure intersecting buckets before clipping; a sliver at the viewport edge must not set the minimum.
// Drawing and hover share fractional canvas coordinates for both axes.
// Half the effective gap is inset from each clipped cell edge.
// Gaps affect drawing, not hit testing. Cells too small for the gap stay hoverable with full-cell outlines.
// An effective positive gap disables adjacent-row merging. Fractional gaps are not rounded to device pixels.
// colorIdx returns a palette index. onHover receives the original source index or null.
// onPrepare receives (u, minY, maxY, asinhThreshold, zeroMin, zeroMax). Empty data has null extrema.
// zeroMin and zeroMax are the source bounds of the straddling bucket, or undefined if absent.
// asinhThreshold is the smallest nonzero absolute edge of a regular Y bucket, with fallback 1.
export function heatmapPlugin({ xSize, grid = {}, cellGap = 0, zeroHeight = 0, colors = ['steelblue'], colorIdx = () => 0, onHover = () => {}, onPrepare }) {
	const gapOption = cellGap;
	function cssSize(option, name, u) {
		const size = typeof option == 'function' ? option(u) : option;
		if (!Number.isFinite(size) || size < 0)
			throw new RangeError(`${name} must be a finite, nonnegative number of CSS pixels`);
		return size;
	}
	if (typeof gapOption != 'function') cssSize(gapOption, 'cellGap');
	if (typeof zeroHeight != 'function') cssSize(zeroHeight, 'zeroHeight');

	function axis(options, distr) {
		distr = options?.distr ?? distr;
		const threshold = options?.asinh ?? 1;
		return {
			fwd: distr == 3 ? Math.log : distr == 4 ? v => Math.asinh(v / threshold) : v => v,
			bwd: distr == 3 ? Math.exp : distr == 4 ? v => Math.sinh(v) * threshold : v => v,
			origin: 0, step: 0, invStep: 0, count: 0,
			values: [], pixels: [],
		};
	}

	const x = axis(grid.x, 1);
	const y = axis(grid.y, 3);
	const signed = grid.y?.distr == 3 && grid.y.factor != null;
	const factor = grid.y?.factor;
	const logFactor = signed ? Math.log(factor) : 0;
	let exponent = 0, positiveStart = 1, zeroRow = -1;
	if (signed) {
		// When a zero bucket is present, coordinates 1 and 2 are its edges; positive rows start at 3.
		// Subtract exponents rather than dividing values, which can overflow at tiny edges.
		y.fwd = v => {
			const row = Math.max(0, Math.log(Math.abs(v)) / logFactor - exponent);
			return v < 0 ? -row : row + positiveStart;
		};
		y.bwd = row => row <= 0 ? -(factor ** (exponent - row)) : factor ** (exponent + row - positiveStart);
	}
	// Each axis caches one value and one projected position per grid edge, including missing buckets.
	// Preparation infers the progression. Drawing projects each edge only once.
	// Heights are shared across columns, so the cell loop needs no boundary arithmetic.
	const heights = [];

	// starts[col] and starts[col + 1] delimit a source run. Missing columns have equal offsets.
	const starts = [];
	// Preparation-only dedupe: repeated Y bounds reuse a row ID without another grid transform.
	const rowIds = new Map();
	// Each source cell retains only its inferred Y bucket ID. Missing Y buckets prevent offset-only lookup.
	let cellRows = new Uint32Array(0);
	let length = 0;
	// Paths group source cells by color. Each draw replaces the paths but reuses the array.
	const paths = new Array(colors.length);

	let over = null;
	let ready = false;
	let pointerInside = false;
	let hit = null;
	let queryX = NaN, queryY = NaN;
	let cssToCanX = 1, cssToCanY = 1, cssLeft = 0, cssTop = 0;
	// Cursor boxes use CSS pixels. The empty box hides the cursor point after a miss.
	const emptyBox = { left: -10, top: -10, width: 0, height: 0 };
	const box = { left: 0, top: 0, width: 0, height: 0 };

	function invalidate() {
		ready = false;
		hit = null;
		queryX = queryY = NaN;
	}

	function prepare(u) {
		const [xs, yMin, yMax] = u.data[1];
		length = xs.length;
		rowIds.clear();
		zeroRow = -1;

		invalidate();
		if (length == 0) {
			x.count = y.count = 0;
			x.values.length = x.pixels.length = y.values.length = y.pixels.length = starts.length = heights.length = 0;
			onPrepare?.(u, null, null, 1);
			return;
		}

		x.step = xSize;
		x.invStep = 1 / x.step;
		x.origin = x.fwd(xs[0]) - x.step;
		x.count = Math.round((x.fwd(xs[length - 1]) - x.origin) * x.invStep);
		x.values.length = x.count + 1;
		starts.length = x.count + 1;
		for (let col = 0; col <= x.count; col++)
			x.values[col] = x.bwd(x.origin + col * x.step);

		// Ascending Y within each run makes its endpoints sufficient for the full grid extent.
		let minY = Infinity, maxY = -Infinity;
		let minAbsEdge = Infinity, zeroMin, zeroMax;
		let nextCol = 0;
		for (let start = 0; start < length;) {
			const xMax = xs[start];
			const col = Math.round((x.fwd(xMax) - x.origin) * x.invStep) - 1;
			while (nextCol <= col)
				starts[nextCol++] = start;
			x.values[col + 1] = xMax;

			// Bracket the next run, then locate its start without scanning every repeated X.
			let stride = 1;
			while (start + stride < length && xs[start + stride] == xMax)
				stride *= 2;
			const end = bisect(xs, xMax, start + (stride >>> 1) + 1, Math.min(start + stride, length), false, true);
			minY = Math.min(minY, yMin[start]);
			maxY = Math.max(maxY, yMax[end - 1]);
			if (signed) {
				const split = bisect(yMin, 0, start, end);
				if (split > start) {
					let edge = yMax[split - 1];
					if (edge > 0) {
						zeroMin = yMin[split - 1];
						zeroMax = edge;
						edge = split - 1 > start ? yMax[split - 2] : -Infinity;
					}
					minAbsEdge = Math.min(minAbsEdge, -edge);
				}
				if (split < end)
					minAbsEdge = Math.min(minAbsEdge, yMin[split]);
			}
			start = end;
		}
		while (nextCol <= x.count)
			starts[nextCol++] = length;

		if (signed) {
			positiveStart = zeroMin == null ? 1 : 3;
			exponent = minAbsEdge == Infinity ? 0 : Math.round(Math.log(minAbsEdge) / logFactor);
			y.origin = minY === zeroMin ? 1 : Math.round(y.fwd(minY));
			y.step = y.invStep = 1;
			y.count = (maxY === zeroMax ? 2 : Math.round(y.fwd(maxY))) - y.origin;
		}
		else {
			y.origin = y.fwd(minY);
			y.step = y.fwd(yMax[0]) - y.fwd(yMin[0]);
			y.invStep = 1 / y.step;
			y.count = Math.round((y.fwd(maxY) - y.origin) * y.invStep);
		}
		y.values.length = y.count + 1;
		for (let row = 0; row <= y.count; row++)
			y.values[row] = y.bwd(y.origin + row * y.step);
		if (zeroMin != null) {
			zeroRow = 1 - y.origin;
			rowIds.set(zeroMin, zeroRow);

			y.values[zeroRow] = zeroMin;
			y.values[zeroRow + 1] = zeroMax;
		}
		if (cellRows.length < length)
			cellRows = new Uint32Array(Math.max(length, cellRows.length * 2));

		for (let i = 0; i < length; i++) {
			const bottom = yMin[i];
			let row = rowIds.get(bottom);
			if (row == null) {
				row = Math.round((y.fwd(bottom) - y.origin) * y.invStep);
				rowIds.set(bottom, row);
				// Preserve exact source edges and collect the display threshold once per distinct row.
				const top = yMax[i];
				y.values[row] = bottom;
				y.values[row + 1] = top;
				if (!signed) {
					const absBottom = Math.abs(bottom), absTop = Math.abs(top);
					if (absBottom > 0)
						minAbsEdge = Math.min(minAbsEdge, absBottom);
					if (absTop > 0)
						minAbsEdge = Math.min(minAbsEdge, absTop);
				}
			}
			cellRows[i] = row;
		}
		onPrepare?.(u, minY, maxY, minAbsEdge == Infinity ? 1 : minAbsEdge, zeroMin, zeroMax);
	}

	function project(u, axis, key, offset, size) {
		const { values, pixels } = axis;
		const end = offset + size;

		let previous, minSize = Infinity;
		for (let i = 0; i < values.length; i++) {
			const pixel = u.valToPos(values[i], key, true);
			pixels[i] = Math.max(offset, Math.min(end, pixel));
			// The zero row gets its final height below; its two spacer rows have no cells.
			if (cellGap > 0 && i > 0 && pixels[i] != pixels[i - 1] &&
				(axis != y || zeroRow < 0 || i < zeroRow || i > zeroRow + 2))
				minSize = Math.min(minSize, Math.abs(pixel - previous));
			previous = pixel;
		}
		pixels.length = values.length;
		return minSize;
	}

	// Adjust only the two shared edges. Drawing and hit testing both use these pixels.
	function projectZero(u, row) {
		const p = y.pixels, top = p[row + 1], bottom = p[row];
		const actual = bottom - top;
		const height = cssSize(zeroHeight, 'zeroHeight', u) * cssToCanY;
		if (height <= actual || u.scales.y.min > 0 || u.scales.y.max < 0) return;
		const lo = p[row + 2] ?? u.bbox.top;
		const hi = p[row - 1] ?? (u.bbox.top + u.bbox.height);
		const center = u.valToPos(0, 'y', true);
		p[row + 1] = Math.max(lo, Math.min(top, center - height / 2));
		p[row] = Math.min(hi, Math.max(bottom, center + height / 2));

	}

	// Search drawing bounds directly, including collapsed edges. Y pixels descend as values increase.
	function bucketAt(axis, pixel, inclusive) {
		return bisect(axis.pixels, pixel, 0, axis.count, axis == y, inclusive) - 1;
	}

	function sourceAt(col, row) {
		const end = starts[col + 1];
		const i = bisect(cellRows, row, starts[col], end);
		return i < end && cellRows[i] == row ? i : -1;
	}

	function lookup(u) {
		if (!ready)
			return null;

		const { left, top, width, height } = u.bbox;
		const px = (cssLeft + u.cursor.left) * cssToCanX;
		const py = (cssTop + u.cursor.top) * cssToCanY;
		// dataIdx and setCursor can request the same hit during one cursor update.
		if (px == queryX && py == queryY)
			return hit;
		queryX = px;
		queryY = py;
		hit = null;

		if (px >= left && py >= top && px <= left + width && py <= top + height) {
			const firstRow = bucketAt(y, py, true);
			let col = bucketAt(x, px, true);
			for (let c = 0; c < 2 && col >= 0; c++) {
				const x0 = x.pixels[col], x1 = x.pixels[col + 1];
				if (x1 > x0 && px <= x1 && starts[col] < starts[col + 1]) {
					let row = firstRow;
					for (let r = 0; r < 2 && row >= 0; r++) {
						const y0 = y.pixels[row + 1], y1 = y.pixels[row];
						if (heights[row] > 0 && py >= y0) {
							const i = sourceAt(col, row);
							if (i >= 0) {
								hit = i;
								box.left = x0 / cssToCanX - cssLeft;
								box.top = y0 / cssToCanY - cssTop;
								box.width = (x1 - x0) / cssToCanX;
								box.height = (y1 - y0) / cssToCanY;
								if (cellGap > 0 && x1 - x0 > cellGap * cssToCanX && y1 - y0 > cellGap * cssToCanY) {
									box.left += cellGap / 2;
									box.top += cellGap / 2;
									box.width -= cellGap;
									box.height -= cellGap;
								}
								return hit;
							}
						}
						if (y1 != py)
							break;
						row = bucketAt(y, py, false);
					}
				}
				if (x0 != px)
					break;
				// Later source IDs win shared edges. The earlier column can match if the later cell is absent.
				col = bucketAt(x, px, false);
			}
		}
		return hit;
	}

	function mouseEnter(e) {
		if (e.target == over)
			pointerInside = true;
	}

	function mouseLeave() {
		pointerInside = false;
		hit = null;
		queryX = queryY = NaN;
	}

	function draw(u) {
		const { ctx, bbox } = u;
		cellGap = typeof gapOption == 'function' ? cssSize(gapOption, 'cellGap', u) : gapOption;
		// Match the rounded canvas dimensions and the overlay's CSS origin, not nominal DPR.
		cssToCanX = Math.round(u.width * u.pxRatio) / u.width;
		cssToCanY = Math.round(u.height * u.pxRatio) / u.height;
		cssLeft = parseFloat(u.over.style.left);
		cssTop = parseFloat(u.over.style.top);
		invalidate();
		if (length > 0 && u.series[1].show) {
			const minWidth = project(u, x, 'x', bbox.left, bbox.width);
			let minHeight = project(u, y, 'y', bbox.top, bbox.height);
			if (zeroRow >= 0) projectZero(u, zeroRow);
			heights.length = y.count;
			for (let row = 0; row < y.count; row++)
				heights[row] = y.pixels[row] - y.pixels[row + 1];
			if (cellGap > 0 && zeroRow >= 0 && heights[zeroRow] > 0 && y.values[zeroRow] >= u.scales.y.min && y.values[zeroRow + 1] <= u.scales.y.max)
				minHeight = Math.min(minHeight, heights[zeroRow]);
			if (cellGap > 0) {
				// Projection collects both minima; this decision needs no source-cell scan or extra traversal.
				const gapX = cellGap * cssToCanX, gapY = cellGap * cssToCanY;
				if (minWidth == Infinity || minHeight == Infinity || minWidth <= gapX || minHeight <= gapY ||
					(minWidth - gapX) * (minHeight - gapY) < .9 * minWidth * minHeight)
					cellGap = 0;
			}
			paths.length = colors.length;
			for (let i = 0; i < paths.length; i++)
				paths[i] = new Path2D();

			const counts = u.data[1][3];
			const gapX = cellGap * cssToCanX, gapY = cellGap * cssToCanY;
			ctx.save();
			for (let col = 0; col < x.count; col++) {
				const left = x.pixels[col];
				const width = x.pixels[col + 1] - left;
				if (width <= 0)
					continue;
				if (cellGap > 0) {
					if (width > gapX) {
						for (let i = starts[col], end = starts[col + 1]; i < end; i++) {
							const row = cellRows[i];
							const height = heights[row] - gapY;
							if (height > 0)
								paths[colorIdx(counts[i])].rect(left + gapX / 2, y.pixels[row + 1] + gapY / 2, width - gapX, height);
						}
					}
					continue;
				}
				// Consecutive same-color rows share X bounds; missing rows break the run.
				let runColor = -1, lastRow = -2, top = 0, bottom = 0;
				for (let i = starts[col], end = starts[col + 1]; i < end; i++) {
					const row = cellRows[i];
					if (heights[row] > 0) {
						const color = colorIdx(counts[i]);
						if (color != runColor || row != lastRow + 1) {
							if (runColor >= 0)
								paths[runColor].rect(left, top, width, bottom - top);
							runColor = color;
							bottom = y.pixels[row];
						}
						top = y.pixels[row + 1];
						lastRow = row;
					}
				}
				if (runColor >= 0)
					paths[runColor].rect(left, top, width, bottom - top);
			}
			for (let i = 0; i < paths.length; i++) {
				ctx.fillStyle = colors[i];
				ctx.fill(paths[i]);
			}
			ctx.restore();
			ready = true;
		}
		if (pointerInside)
			u.setCursor(u.cursor, false, false);
		onHover(u, lookup(u));
	}

	return {
		opts: (u, opts) => {
			Object.assign(opts.series[1], {
				facets: [{ scale: 'x', sorted: 1 }, { scale: 'y' }, { scale: 'y' }],
				paths: () => null,
				points: { show: false },
			});
			opts.cursor = {
				...opts.cursor,
				x: false,
				y: false,
				dataIdx: lookup,
				points: { bbox: () => hit == null ? emptyBox : box, fill: 'transparent', stroke: 'white', width: 1 },
			};
		},
		hooks: {
			init: u => {
				over = u.over;
				over.addEventListener('mouseenter', mouseEnter, true);
				over.addEventListener('mouseleave', mouseLeave);
			},
			setData: prepare,
			draw,
			setCursor: u => onHover(u, lookup(u)),
			destroy: () => {
				over.removeEventListener('mouseenter', mouseEnter, true);
				over.removeEventListener('mouseleave', mouseLeave);
				over = cellRows = null;
				rowIds.clear();
				x.values.length = x.pixels.length = y.values.length = y.pixels.length = starts.length = heights.length = paths.length = 0;
				pointerInside = false;
				invalidate();
			},
		},
	};
}

// Searches [lo, hi) for an insertion index. inclusive skips equal values, so shared edges select the later bucket.
function bisect(values, value, lo, hi, descending = false, inclusive = false) {
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const edge = values[mid];
		if ((descending ? edge > value : edge < value) || inclusive && edge == value)
			lo = mid + 1;
		else
			hi = mid;
	}
	return lo;
}
