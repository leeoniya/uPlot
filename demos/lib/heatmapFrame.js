// Same dense-grid budget as aggregateHeatmap, including unoccupied edge bins.
export const maxHeatmapCells = 2 ** 24;
const names = ['x', 'xMin', 'xMax', 'y', 'yMin', 'yMax', 'count'];

function column(value) {
	return Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number' &&
		!Object.prototype.toString.call(value).startsWith('[object Big'));
}

function options(value, keys, name) {
	if (Object.prototype.toString.call(value) !== '[object Object]')
		throw new TypeError(`Expected ${name} options`);
	for (const key of Object.keys(value)) {
		if (!keys.includes(key)) throw new TypeError(`Unknown ${name} option: ${key}`);
	}
}

function axisFields(fields, name) {
	const center = fields.indexOf(name), min = fields.indexOf(name + 'Min'), max = fields.indexOf(name + 'Max');
	if (center >= 0 ? min >= 0 || max >= 0 : min < 0 && max < 0)
		throw new TypeError(`Expected ${name} center or bounds, not both`);
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
	if (!values.length) return [Infinity, -Infinity];
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

function smallestGap(values, xRuns) {
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

function prepareAxis({name, center, min, max, anchor}, columns, xs, config = {}) {
	options(config, ['step', 'extent', 'categories', 'distr'], name);
	let {step, extent, categories} = config;
	const both = min >= 0 && max >= 0;
	const values = columns[anchor], lows = columns[min], highs = columns[max], n = values.length;
	const fail = message => { throw new RangeError(`${name}: ${message}`); };

	if (config.distr !== undefined && config.distr !== 1) fail('only linear grids are supported');
	if (step !== undefined && (both || !Number.isFinite(step) || step <= 0))
		fail('step must be positive and finite and is only valid for a single anchor');
	if (extent !== undefined && (!column(extent) || extent.length !== 2 || !Number.isFinite(extent[0]) ||
		!Number.isFinite(extent[1]) || (both ? extent[1] <= extent[0] : extent[1] < extent[0])))
		fail('invalid extent');
	if (categories !== undefined) {
		if (center < 0 || !Array.isArray(categories) || extent !== undefined || (step !== undefined && step !== 1))
			fail('categories require a centered axis without numeric extent and with unit step');
		if (categories.length > maxHeatmapCells) fail('too many categories');
		for (const label of categories) {
			if (typeof label !== 'string') fail('category labels must be strings');
		}
		if (categories.length) extent = [0, categories.length - 1];
		step = 1;
	}

	let observed;
	const occupied = () => observed ??= occupiedRange(values, both ? highs : values, xs);
	const [first, last] = extent ?? occupied();
	const span = last - first;
	let bins = 0;
	if (n > 0 || (extent !== undefined && !both)) {
		const inferred = step === undefined;
		const ascending = () => name === 'x' ? values : orderedRows(xs, values);
		let anchors, measuredScale;
		if (inferred) {
			if (both) {
				const lo = lows[0], hi = highs[0];
				step = hi - lo;
				measuredScale = Math.max(Math.abs(lo), Math.abs(hi));
			}
			else {
				anchors = ascending();
				step = smallestGap(anchors, name === 'x');
				measuredScale = Math.max(Math.abs(anchors[0]), Math.abs(anchors[anchors.length - 1]));
			}
		}
		if (!Number.isFinite(step) || step <= 0) fail('cannot infer step without a cell width or two distinct anchors');
		if (!Number.isFinite(span)) fail('extent span is not finite');
		const magnitude = Math.max(Math.abs(first), Math.abs(last), span, step);
		// Allow a few rounding errors at the coordinate scale, never a substantial fraction of a bin.
		const epsilon = 4 * Math.max(precision(values), precision(highs));
		const tolerance = Math.min(step / 16, epsilon * magnitude);
		if (inferred) {
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
		const intervals = Math.round(span / step);
		if (Math.abs(span - intervals * step) > tolerance) fail('extent is off the grid');
		bins = intervals + (both ? 0 : 1);
		if (!(bins >= 1 && bins <= maxHeatmapCells)) fail('excessive or invalid grid dimension');
	}
	// Empty bounds have no measured width. The neutral size is never used to place a cell.
	step ??= 1;
	if (!Number.isFinite(1 / step)) fail('inverse step is not finite');
	const lowOffset = min >= 0 ? 0 : center >= 0 ? -step / 2 : -step;
	const highOffset = max >= 0 ? 0 : center >= 0 ? step / 2 : step;
	const range = n || extent !== undefined ? [first + lowOffset, last + highOffset] : [null, null];
	if (range[0] !== null && (!(range[0] < range[1]) || !Number.isFinite(range[1] - range[0])))
		fail('outer cell extent is not representable');

	return {step, bins, range, lowOffset, highOffset};
}

function shiftEdges(values, offset) {
	const edges = new Float64Array(values.length);
	for (let i = 0; i < values.length; i++) edges[i] = values[i] + offset;
	return edges;
}

// Compile column positions once. Frame-specific geometry never survives a call to resolve.
export function compileHeatmapFields(fields) {
	if (!Array.isArray(fields)) throw new TypeError('Expected field names');
	for (const field of fields) {
		if (!names.includes(field)) throw new TypeError(`Unknown heatmap field: ${field}`);
		if (fields.indexOf(field) !== fields.lastIndexOf(field)) throw new TypeError('Expected distinct field names');
	}
	const xFields = axisFields(fields, 'x'), yFields = axisFields(fields, 'y');
	const count = fields.indexOf('count'), length = fields.length;
	if (count < 0) throw new TypeError('Missing count field');
	const canonical = length === 4 && xFields.max === 0 && yFields.min === 1 && yFields.max === 2 && count === 3;

	return function resolve(frame) {
		const data = frame?.data, columns = data?.[1];
		if (!Array.isArray(data) || data.length !== 2 || data[0] !== null || !Array.isArray(columns) || columns.length !== length)
			throw new TypeError('Expected data: [null, columns] in compiled field order');
		for (const c of columns) {
			if (!column(c) || c.length !== columns[0].length) throw new TypeError('Expected equal-length numeric columns');
		}
		const counts = columns[count];
		if (counts.length > maxHeatmapCells) throw new RangeError('Too many heatmap cells');
		const {grid = {}} = frame;
		options(grid, ['x', 'y'], 'grid');
		const xs = columns[xFields.anchor], ys = columns[yFields.anchor];
		const x = prepareAxis(xFields, columns, xs, grid.x), y = prepareAxis(yFields, columns, xs, grid.y);
		if (x.bins * y.bins > maxHeatmapCells) throw new RangeError('Dense heatmap exceeds 2**24 cells');
		const cells = canonical ? columns : [
			columns[xFields.max] ?? shiftEdges(xs, x.highOffset),
			columns[yFields.min] ?? shiftEdges(ys, y.lowOffset),
			columns[yFields.max] ?? shiftEdges(ys, y.highOffset), counts,
		];
		return {cells, xSize: x.step, ySize: y.step, xRange: x.range, yRange: y.range};
	};
}
