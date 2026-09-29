import Flatbush from './flatbush.js';

// Requires mode: 2, sorted X runs, and non-overlapping grid rows. Data: [null, [xMax, yMin, yMax, count]].
// X buckets end at xMax. Each yMin must have one yMax. Grid metadata is rebuilt on setData().
// colorIdx must return an integer index into colors for each positive finite count.
export function heatmapPlugin({ xSize, colors = ['steelblue'], colorIdx = () => 0, onHover = () => {} }) {
	let over = null;
	// One item per source cell, with clipped bounds in plot-relative canvas pixels.
	// Skipped cells retain zero-sized placeholders, so index IDs remain source indices.
	let index = null;
	// A draw prepares the bounds. Pointer entry or a draw inside the plot finishes the tree.
	let indexReady = false;
	let indexFinished = false;
	let pointerInside = false;
	// Cache the winning source index and query coordinates to avoid duplicate hover searches.
	let hit = null;
	let queryX = NaN, queryY = NaN;
	// Reuse the cursor boxes. lookup() converts the winning index bounds to CSS pixels.
	// The empty box hides the cursor point when no cell matches.
	const emptyBox = { left: -10, top: -10, width: 0, height: 0 };
	const box = { left: 0, top: 0, width: 0, height: 0 };
	// Caller-owned Flatbush result and traversal buffers avoid allocations on each hover query.
	const searchResults = [];
	const searchQueue = [];
	// Active source-cell count. cellRows can retain extra capacity after a smaller data update.
	let length = 0;

	// cellRows[i] identifies the shared Y row for source cell i.
	// Missing Y buckets prevent us from deriving the row ID from the position within an X run.
	// For columns [A, B, C], [A, C], and [B], cellRows contains [0, 1, 2, 0, 2, 1].
	let cellRows = new Uint32Array(0);

	// Each shared Y row stores [bottomBoundaryId, topBoundaryId] for its yMin and yMax.
	// These IDs reference y.values/y.pixels. Source cells share these pairs through cellRows.
	// Row IDs follow first occurrence, not necessarily Y order.
	let rows = [];

	// Each populated X run stores [sourceStart, leftBoundaryId, rightBoundaryId].
	// The next sourceStart is the exclusive end of the run. The last run ends at length.
	// Boundary IDs reference x.values/x.pixels. Missing X runs have no entries.
	// Consecutive source cells share a column, so no per-cell column IDs are necessary.
	let columns = [];

	// Preparation-only lookup from yMin to shared row ID. All columns reuse the same row geometry.
	const rowIds = new Map();
	// Each axis stores shared data-space boundaries and their projected positions at matching array indices.
	// Preparation builds values. Each draw projects each boundary once into clipped, plot-relative canvas pixels.
	const x = { values: [], pixels: [] };
	const y = { values: [], pixels: [] };
	// Preparation-only lookup from a Y boundary value to its ID. Adjacent rows can share an edge.
	const yIds = new Map();
	// One path per palette entry groups cells of the same color for a single fill call.
	// Each draw creates new paths but reuses this array. There is no per-cell color cache.
	const paths = new Array(colors.length);

	function internY(value) {
		let id = yIds.get(value);
		if (id == null) {
			id = y.values.push(value) - 1;
			yIds.set(value, id);
		}
		return id;
	}

	function invalidate() {
		indexReady = indexFinished = false;
		hit = null;
		queryX = queryY = NaN;
	}

	function prepare(u) {
		const [xs, yMin, yMax] = u.data[1];
		length = xs.length;
		if (cellRows.length < length)
			cellRows = new Uint32Array(Math.max(length, cellRows.length * 2));
		x.values.length = y.values.length = rows.length = columns.length = 0;
		yIds.clear();
		rowIds.clear();
		invalidate();

		let lastX = NaN;
		for (let i = 0; i < length; i++) {
			// Sorted X runs need no hash lookup. Dense neighbors share their edge.
			if (xs[i] != lastX) {
				const min = xs[i] - xSize;
				const left = x.values.length > 0 && x.values.at(-1) == min ? x.values.length - 1 : x.values.push(min) - 1;
				columns.push(i, left, x.values.push(xs[i]) - 1);
				lastX = xs[i];
			}

			let row = rowIds.get(yMin[i]);
			if (row == null) {
				row = rows.length / 2;
				rowIds.set(yMin[i], row);
				// Only new rows intern boundaries. Adjacent rows usually share the last edge.
				const bottom = y.values.length > 0 && y.values.at(-1) == yMin[i] ? y.values.length - 1 : internY(yMin[i]);
				rows.push(bottom, internY(yMax[i]));
			}
			else if (y.values[rows[row * 2 + 1]] != yMax[i])
				throw new Error('Heatmap grid rows must have the same yMax for each yMin');
			cellRows[i] = row;
		}
	}

	function project(u, axis, scale, offset, size) {
		const { values, pixels } = axis;
		for (let i = 0; i < values.length; i++)
			pixels[i] = Math.max(0, Math.min(size, Math.round(u.valToPos(values[i], scale, true)) - offset));
		pixels.length = values.length;
	}

	function finishIndex() {
		if (indexReady && !indexFinished) {
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
		hit = null;
		queryX = queryY = NaN;
	}

	function filter(id, x0, y0, x1, y1) {
		// Shared edges prefer the later source row; placeholders never match.
		if (x1 > x0 && y1 > y0 && (hit == null || id > hit)) {
			hit = id;
			box.left = x0;
			box.top = y0;
			box.width = x1 - x0;
			box.height = y1 - y0;
		}
		return false;
	}

	function lookup(u) {
		if (!indexFinished)
			return null;

		const ratio = u.pxRatio;
		const px = u.cursor.left * ratio;
		const py = u.cursor.top * ratio;
		// dataIdx and setCursor can request the same hit during one cursor update.
		if (px == queryX && py == queryY)
			return hit;
		queryX = px;
		queryY = py;
		hit = null;

		if (px >= 0 && py >= 0 && px <= u.bbox.width && py <= u.bbox.height) {
			index.search(px, py, px, py, filter, searchResults, searchQueue);
			if (hit != null) {
				box.left /= ratio;
				box.top /= ratio;
				box.width /= ratio;
				box.height /= ratio;
			}
		}

		return hit;
	}

	function draw(u) {
		const { ctx, bbox } = u;
		invalidate();

		if (length > 0 && u.series[1].show) {
			// Rounded edges minus uPlot's half-pixel offsets remain exact in Float32 at canvas sizes below 2^23.
			if (index == null || index.numItems != length)
				index = new Flatbush(length, 16, Float32Array);
			else
				index.reset();
			project(u, x, 'x', bbox.left, bbox.width);
			project(u, y, 'y', bbox.top, bbox.height);
			const xPixels = x.pixels;
			const yPixels = y.pixels;
			const counts = u.data[1][3];
			for (let i = 0; i < paths.length; i++)
				paths[i] = new Path2D();

			ctx.save();
			// Projected bounds are already clipped, so no canvas clip path is needed.
			for (let p = 0; p < columns.length; p += 3) {
				const x0 = xPixels[columns[p + 1]];
				const x1 = xPixels[columns[p + 2]];
				const left = bbox.left + x0;
				const width = x1 - x0;
				const end = p + 3 < columns.length ? columns[p + 3] : length;
				for (let i = columns[p]; i < end; i++) {
					const count = counts[i];
					if (width > 0 && count > 0 && Number.isFinite(count)) {
						const row = cellRows[i] * 2;
						const y0 = yPixels[rows[row + 1]];
						const y1 = yPixels[rows[row]];
						if (y1 > y0) {
							paths[colorIdx(count)].rect(left, bbox.top + y0, width, y1 - y0);
							index.add(x0, y0, x1, y1);
							continue;
						}
					}
					// Preserve source row IDs without a second lookup array.
					index.add(0, 0);
				}
			}

			for (let i = 0; i < paths.length; i++) {
				ctx.fillStyle = colors[i];
				ctx.fill(paths[i]);
			}

			ctx.restore();
			indexReady = true;
		}

		if (pointerInside) {
			finishIndex();
			// Refresh geometry even when the pointer did not move (zoom, resize, setData).
			u.setCursor(u.cursor, false, false);
		}
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
				points: {
					bbox: () => hit == null ? emptyBox : box,
					fill: 'transparent',
					stroke: 'white',
					width: 1,
				},
			};
		},
		hooks: {
			init: u => {
				over = u.over;
				// Finish before uPlot's non-capturing entry handler or caller hover handlers.
				over.addEventListener('mouseenter', mouseEnter, true);
				over.addEventListener('mouseleave', mouseLeave);
			},
			setData: prepare,
			draw,
			setCursor: u => onHover(u, lookup(u)),
			destroy: () => {
				over.removeEventListener('mouseenter', mouseEnter, true);
				over.removeEventListener('mouseleave', mouseLeave);
				over = index = cellRows = rows = columns = null;
				x.values = x.pixels = y.values = y.pixels = null;
				yIds.clear();
				rowIds.clear();
				paths.length = searchResults.length = searchQueue.length = 0;
				pointerInside = false;
				invalidate();
			},
		},
	};
}
