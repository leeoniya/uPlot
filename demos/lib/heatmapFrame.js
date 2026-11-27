// Cap spare row-buffer capacity at the largest supported named grid.
export const maxHeatmapCells = 2 ** 24;

function axisFields(fields, name) {
	const center = fields.indexOf(name), min = fields.indexOf(name + 'Min'), max = fields.indexOf(name + 'Max');
	return {name, center, min, max, anchor: center >= 0 ? center : min >= 0 ? min : max};
}

// Bracket the next distinct X, then bisect. Long runs need only logarithmic reads.
export function heatmapRunEnd(xs, start) {
	const x = xs[start], n = xs.length;
	let stride = 1;
	while (start + stride < n && xs[start + stride] === x) stride *= 2;
	let lo = start + Math.floor(stride / 2) + 1, hi = Math.min(start + stride, n);
	while (lo < hi) {
		const mid = lo + Math.floor((hi - lo) / 2);
		if (xs[mid] === x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function occupiedRange(values, ends, xs) {
	if (values === xs) return [values[0], ends[ends.length - 1]];
	let min = Infinity, max = -Infinity;
	for (let start = 0; start < xs.length;) {
		const end = heatmapRunEnd(xs, start);
		min = Math.min(min, values[start]);
		max = Math.max(max, ends[end - 1]);
		start = end;
	}
	return [min, max];
}

// Only width inference needs global Y order. Y can decrease only between X runs.
function orderedRows(xs, ys) {
	const cuts = [0];
	for (let end = 0; end < xs.length;) {
		end = heatmapRunEnd(xs, end);
		if (end < xs.length && ys[end] < ys[end - 1]) cuts.push(end);
	}
	if (cuts.length === 1) return ys;
	cuts.push(ys.length);
	return merge(0, cuts.length - 1);

	function merge(lo, hi) {
		if (hi - lo === 1) return ys.slice(cuts[lo], cuts[hi]);
		const mid = (lo + hi) >>> 1;
		const a = merge(lo, mid), b = merge(mid, hi), rows = [];
		let i = 0, j = 0;
		while (i < a.length || j < b.length) {
			const value = j === b.length || (i < a.length && a[i] <= b[j]) ? a[i++] : b[j++];
			if (rows.length === 0 || value !== rows[rows.length - 1]) rows.push(value);
		}
		return rows;
	}
}

// Use an observed width, not a common divisor that could turn jitter into a fine grid.
export function smallestGap(values, xRuns) {
	let gap = Infinity;
	for (let i = 0; i < values.length;) {
		const next = xRuns ? heatmapRunEnd(values, i) : i + 1;
		if (next === values.length) break;
		const diff = values[next] - values[i];
		if (diff > 0 && diff < gap) gap = diff;
		i = next;
	}
	return gap;
}

function precision(values) {
	switch (Object.prototype.toString.call(values)) {
		case '[object Float16Array]': return 2 ** -10;
		case '[object Float32Array]': return 2 ** -23;
		default: return Number.EPSILON;
	}
}

// A longer baseline can recover bits lost to cancellation in an observed cell width.
// Never adjust a supplied step or accept a correction larger than the measurement error.
function refineStep(step, span, intervals, tolerance, widthError) {
	if (intervals > 1 && Math.abs(span - intervals * step) > tolerance) {
		const fitted = span / intervals;
		if (Math.abs(fitted - step) <= widthError) return fitted;
	}
	return step;
}

function prepareAxis({name, center, min, max, anchor}, columns, xs, {step, extent, categories} = {}) {
	const both = min >= 0 && max >= 0;
	const values = columns[anchor], highs = columns[max];
	if (categories !== undefined) {
		if (categories.length) extent = [0, categories.length - 1];
		step = 1;
	}

	let observed;
	const occupied = () => observed ??= occupiedRange(values, both ? highs : values, xs);
	const [first, last] = extent ?? (values.length ? occupied() : []);
	if (step === undefined && values.length) {
		const ascending = () => name === 'x' ? values : orderedRows(xs, values);
		let anchors, measuredScale;
		if (both) {
			const lo = values[0], hi = highs[0];
			step = hi - lo;
			measuredScale = Math.max(Math.abs(lo), Math.abs(hi));
		}
		else {
			anchors = ascending();
			step = smallestGap(anchors, name === 'x');
			measuredScale = Math.max(Math.abs(anchors[0]), Math.abs(anchors[anchors.length - 1]));
		}

		const span = last - first;
		const magnitude = Math.max(Math.abs(first), Math.abs(last), span, step);
		const epsilon = 4 * Math.max(precision(values), precision(highs));
		const tolerance = Math.min(step / 16, epsilon * magnitude);
		// Use the precision of the measurement, not that of a distant declared extent.
		let widthError = Math.min(step / 16, epsilon * Math.max(measuredScale, step));
		if (Math.round(span / step) * widthError >= step / 2) {
			// Cancellation can make the rounded bin count ambiguous. Count shorter gaps instead.
			const ordered = anchors ?? ascending();
			let intervals = both ? 1 : 0;
			for (let i = 1; i < ordered.length; i++)
				intervals += Math.round((ordered[i] - ordered[i - 1]) / step);
			const [low, high] = occupied();
			step = refineStep(step, high - low, intervals, widthError, widthError);
			widthError /= intervals;
		}
		step = refineStep(step, span, Math.round(span / step), tolerance, widthError);
	}
	// Empty bounds have no measured width. The neutral size is never used to place a cell.
	step ??= 1;
	const lowOffset = min >= 0 ? 0 : center >= 0 ? -step / 2 : -step;
	const highOffset = max >= 0 ? 0 : center >= 0 ? step / 2 : step;
	const range = first === undefined ? [null, null] : [first + lowOffset, last + highOffset];
	return {step, range, lowOffset, highOffset};
}

function shiftEdges(values, offset) {
	const edges = new Float64Array(values.length);
	for (let i = 0; i < values.length; i++) edges[i] = values[i] + offset;
	return edges;
}

// Compile column positions once. Frame-specific geometry never survives a call to resolve.
export function compileHeatmapFields(fields) {
	const xFields = axisFields(fields, 'x'), yFields = axisFields(fields, 'y');
	const count = fields.indexOf('count');
	const canonical = fields.length === 4 && xFields.max === 0 && yFields.min === 1 && yFields.max === 2 && count === 3;

	return function resolve({data, grid = {}}) {
		const columns = data[1];
		const xs = columns[xFields.anchor], ys = columns[yFields.anchor];
		const x = prepareAxis(xFields, columns, xs, grid.x), y = prepareAxis(yFields, columns, xs, grid.y);

		const cells = canonical ? columns : [
			columns[xFields.max] ?? shiftEdges(xs, x.highOffset),
			columns[yFields.min] ?? shiftEdges(ys, y.lowOffset),
			columns[yFields.max] ?? shiftEdges(ys, y.highOffset), columns[count],
		];
		return {cells, xSize: x.step, ySize: y.step, xRange: x.range, yRange: y.range};
	};
}
