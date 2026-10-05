// Requires mode: 2, ascending X runs, and ascending Y cells within each run.
// Data: [null, [xMax, yMin, yMax, count]]. Missing columns and rows remain sparse.
// Counts must be finite and positive; omit empty buckets rather than supplying zero/null counts.
// Both axes must follow an aligned, uniform progression in their grid transform.
// grid uses distr: 1 (linear), 3 (log), or 4 (asinh, with a fixed numeric threshold).
// Explicit grid.y {distr: 3, factor: >1} instead uses signed exponential rows:
// edges are factor ** integer, mirrored below zero. Each cell has nonzero, same-sign bounds.
// Grid transforms default to linear X and log Y, independently of the displayed uPlot scales.
// xSize is the bucket width in transformed X units. Implicit Y width comes from the first cell.
// colorIdx returns a palette index. onHover receives the original source index or null.
// onPrepare receives (u, minY, maxY, asinhThreshold), with null bounds for empty data.
// minAbs defaults to 0 and is fixed at initialization. The cutoff must align with Y bucket boundaries.
// Buckets entirely within [-minAbs, minAbs] do not draw or respond to hover. Source extrema remain unchanged.
// asinhThreshold is the smallest absolute source Y edge strictly greater than minAbs, with fallback 1.
export function heatmapPlugin({ xSize, grid = {}, minAbs = 0, colors = ['steelblue'], colorIdx = () => 0, onHover = () => {}, onPrepare }) {
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
	let exponent = 0;
	if (signed) {
		// Coordinates 0 and 1 bound the empty gap between the nearest mirrored edges.
		// Subtract exponents rather than dividing values, which can overflow at tiny edges.
		y.fwd = v => {
			const row = Math.max(0, Math.log(Math.abs(v)) / logFactor - exponent);
			return v < 0 ? -row : row + 1;
		};
		y.bwd = row => row <= 0 ? -(factor ** (exponent - row)) : factor ** (exponent + row - 1);
	}
	// Each axis caches one value and one projected position per grid edge, including missing buckets.
	// Preparation infers the progression. Drawing projects each edge only once.
	// Heights are shared across columns, so the cell loop needs no boundary arithmetic.
	const heights = [];
	// The excluded near-zero rows form one interval, including any missing rows between them.
	let hiddenMin = Infinity, hiddenMax = -Infinity;
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
		hiddenMin = Infinity;
		hiddenMax = -Infinity;
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
		let minY = Infinity, maxY = yMax[length - 1];
		let nearest = Infinity;
		let nextCol = 0;
		for (let i = 0; i < length;) {
			const col = Math.round((x.fwd(xs[i]) - x.origin) * x.invStep) - 1;
			while (nextCol <= col)
				starts[nextCol++] = i;
			x.values[col + 1] = xs[i];
			minY = Math.min(minY, yMin[i]);
			if (i > 0)
				maxY = Math.max(maxY, yMax[i - 1]);

			// Bracket the next run, then locate its start without scanning every repeated X.
			let stride = 1;
			while (i + stride < length && xs[i + stride] == xs[i])
				stride *= 2;
			let lo = i + (stride >>> 1) + 1, hi = Math.min(i + stride, length);
			while (lo < hi) {
				const mid = (lo + hi) >>> 1;
				if (xs[mid] == xs[i])
					lo = mid + 1;
				else
					hi = mid;
			}
			if (signed) {
				// Ordered runs need only a binary search for their nearest regular edges.
				let low = i, high = lo;
				while (low < high) {
					const mid = (low + high) >>> 1;
					if (yMin[mid] < 0)
						low = mid + 1;
					else
						high = mid;
				}
				if (low > i)
					nearest = Math.min(nearest, -yMax[low - 1]);
				if (low < lo)
					nearest = Math.min(nearest, yMin[low]);
			}
			i = lo;
		}
		while (nextCol <= x.count)
			starts[nextCol++] = length;

		if (signed) {
			exponent = Math.round(Math.log(nearest) / logFactor);
			y.origin = Math.round(y.fwd(minY));
			y.step = y.invStep = 1;
			y.count = Math.round(y.fwd(maxY)) - y.origin;
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
		if (cellRows.length < length)
			cellRows = new Uint32Array(Math.max(length, cellRows.length * 2));

		let asinhThreshold = Infinity;
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
				const absBottom = Math.abs(bottom), absTop = Math.abs(top);
				if (absBottom > minAbs)
					asinhThreshold = Math.min(asinhThreshold, absBottom);
				if (absTop > minAbs)
					asinhThreshold = Math.min(asinhThreshold, absTop);
				if (Math.max(absBottom, absTop) <= minAbs) {
					hiddenMin = Math.min(hiddenMin, row);
					hiddenMax = Math.max(hiddenMax, row);
				}
			}
			cellRows[i] = row;
		}
		onPrepare?.(u, minY, maxY, asinhThreshold == Infinity ? 1 : asinhThreshold);
	}

	function project(u, axis, key, offset, size) {
		const { values, pixels } = axis;
		for (let i = 0; i < values.length; i++)
			pixels[i] = Math.max(offset, Math.min(offset + size, Math.round(u.valToPos(values[i], key, true))));
		pixels.length = values.length;
	}

	// Increasing data values move right on X and up on Y. Searches use the rounded drawing bounds.
	function precedes(axis, id, pixel, inclusive) {
		const edge = axis.pixels[id];
		return (axis == x ? edge < pixel : edge > pixel) || inclusive && edge == pixel;
	}

	function bucketAt(axis, pixel, guess, inclusive) {
		const id = Math.max(-1, Math.min(axis.count - 1, Math.floor(guess)));
		if ((id < 0 || precedes(axis, id, pixel, inclusive)) &&
			(id + 1 == axis.count || !precedes(axis, id + 1, pixel, inclusive)))
			return id;

		// Rounding, clipping, or a different display transform can collapse many buckets onto one pixel.
		// A boundary search skips them without a linear correction loop or a pixel-to-cell index.
		let lo = 0, hi = axis.count;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (precedes(axis, mid, pixel, inclusive))
				lo = mid + 1;
			else
				hi = mid;
		}
		return lo - 1;
	}

	function sourceAt(col, row) {
		let lo = starts[col], hi = starts[col + 1];
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (cellRows[mid] < row)
				lo = mid + 1;
			else
				hi = mid;
		}
		return lo < starts[col + 1] && cellRows[lo] == row ? lo : -1;
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
			const gx = (x.fwd(u.posToVal(px, 'x', true)) - x.origin) * x.invStep;
			const gy = (y.fwd(u.posToVal(py, 'y', true)) - y.origin) * y.invStep;
			const firstRow = bucketAt(y, py, gy, true);
			let col = bucketAt(x, px, gx, true);
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
								return hit;
							}
						}
						if (y1 != py)
							break;
						row = bucketAt(y, py, gy, false);
					}
				}
				if (x0 != px)
					break;
				// Later source IDs win shared edges. The earlier column can match if the later cell is absent.
				col = bucketAt(x, px, gx, false);
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
		// Match the rounded canvas dimensions and the overlay's CSS origin, not nominal DPR.
		cssToCanX = Math.round(u.width * u.pxRatio) / u.width;
		cssToCanY = Math.round(u.height * u.pxRatio) / u.height;
		cssLeft = parseFloat(u.over.style.left);
		cssTop = parseFloat(u.over.style.top);
		invalidate();
		if (length > 0 && u.series[1].show) {
			project(u, x, 'x', bbox.left, bbox.width);
			project(u, y, 'y', bbox.top, bbox.height);
			heights.length = y.count;
			for (let row = 0; row < y.count; row++)
				heights[row] = row >= hiddenMin && row <= hiddenMax ? 0 : y.pixels[row] - y.pixels[row + 1];
			for (let i = 0; i < paths.length; i++)
				paths[i] = new Path2D();

			const counts = u.data[1][3];
			ctx.save();
			for (let col = 0; col < x.count; col++) {
				const left = x.pixels[col];
				const width = x.pixels[col + 1] - left;
				if (width <= 0)
					continue;
				for (let i = starts[col], end = starts[col + 1]; i < end; i++) {
					const row = cellRows[i];
					const height = heights[row];
					if (height > 0)
						paths[colorIdx(counts[i])].rect(left, y.pixels[row + 1], width, height);
				}
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
