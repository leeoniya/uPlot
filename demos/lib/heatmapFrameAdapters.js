import { smallestGap } from './heatmapFrame.js';

// For a known geometric grid, one regular bucket suffices, even if intervening rows are missing.
function bucketFactor(lo, hi) {
	for (let i = 0; i < lo.length; i++) {
		const a = lo[i], b = hi[i];
		const ratio = a > 0 ? b / a : b < 0 ? a / b : 0;
		// A zero bucket has no factor. Even finite bounds can give an infinite ratio.
		if (ratio > 1 && ratio < Infinity) return ratio;
	}
}

const cellFields = Object.freeze(['xMax', 'yMin', 'yMax', 'count']);

// Single-anchor extents include the first and last declared xMax, even when those cells are empty.
function xMaxGrid(step, first, last) {
	return first === undefined ? {step} : {step, extent: [first, last]};
}

// Unranked sparse bounds can have mixed widths. Only advertise a linear frame on request.
export function heatmapCells({schema, data}, {ordinal = false, geometric = false, linear = false} = {}) {
	const indices = cellFields.map(name => schema.fields.findIndex(f => f.name === name));
	// Sparse cells already follow the plugin contract. Only X needs unit conversion.
	const [times, lo, hi, counts] = indices.map(i => data.values[i]);
	const interval = schema.fields[indices[0]].config?.interval ?? smallestGap(times, true);
	const xSize = interval / 1000;

	if (!ordinal) {
		const result = {data: [null, [times.map(ms => ms / 1000), lo, hi, counts]], xSize};
		if (geometric) result.factor = bucketFactor(lo, hi);
		return linear ? {...result, fields: cellFields, grid: {x: {step: xSize}, y: {distr: 1}}} : result;
	}

	// Rank the union of observed edges, not just the edges present at the first timestamp.
	const ranks = new Map();
	// The same JSON null means a different open end in each column. Translate it once per column.
	for (const [bounds, open] of [[lo, -Infinity], [hi, Infinity]]) {
		for (let i = 0; i < bounds.length; i++) ranks.set(bounds[i], 0);
		if (ranks.delete(null)) ranks.set(open, 0);
	}
	const edges = Array.from(ranks.keys()).sort((a, b) => a - b);
	edges.forEach((edge, i) => ranks.set(edge, i));
	if (ranks.has(-Infinity)) ranks.set(null, 0); // Lower-edge lookup uses the source column.

	const xs = [], lows = [], highs = [];
	let compactCounts;
	for (let i = 0; i < times.length; i++) {
		const count = counts[i];
		if (!(count > 0)) {
			// Reuse the source column unless a cell needs to be omitted.
			compactCounts ??= counts.slice(0, i);
			continue;
		}
		compactCounts?.push(count);
		const row = ranks.get(lo[i]);
		xs.push(times[i] / 1000);
		lows.push(row);
		highs.push(row + 1);
	}

	return {
		data: [null, [xs, lows, highs, compactCounts ?? counts]], xSize, fields: cellFields, time: true,
		grid: {x: xMaxGrid(xSize, times[0] / 1000, times.at(-1) / 1000), y: {distr: 1, extent: [0, edges.length - 1]}},
		axes: [null, {splits: edges.map((_, i) => i), values: edges.map(v => v === -Infinity ? '-Inf' : v === Infinity ? '+Inf' : String(v)), align: -1}],
	};
}

function axisValues(labels, n, align, outer) {
	const values = Array.from(labels, String);
	if (align !== 0 && values.length === n) {
		if (align === -1) values.unshift(String(outer));
		else values.push(String(outer));
	}
	return values;
}

function ordinalAxis(labels, options, defaultAlign, defaultOuter) {
	const align = options.align ?? defaultAlign;
	const values = axisValues(options.values ?? labels, labels.length, align, options.outerValue ?? defaultOuter);
	return align === 0 ? {categories: values} : {splits: values.map((_, i) => i), values, align};
}

// align is the direction a cell extends from its source value in axis coordinates:
// -1 from the upper edge, +1 from the lower edge, or 0 around the center.
// Time anchors are converted to upper edges; centered categories keep their zero-based IDs.
// The first field supplies X anchors. Each remaining field is one Y bucket's values.
// x/y.values override tick text in display order. For edge alignment, supply all n+1
// labels or the n anchor labels and outerValue. Skip empty cells, not empty axis labels.
export function heatmapRows(frame, {x = {}, y = {}} = {}) {
	const [xField, ...fields] = frame.schema.fields;
	const columns = frame.data.values;
	const domain = columns[0];
	const time = xField.type === 'time';
	let xAxis = null, xSize = 1, rightEdges;
	if (time) {
		const interval = xField.config?.interval ?? smallestGap(domain, false);
		xSize = interval / 1000;
		const align = x.align ?? -1;
		const offset = (1 + align) * interval / 2;
		rightEdges = domain.map(t => (t + offset) / 1000);


		if (x.values !== undefined) {
			const values = axisValues(x.values, domain.length, align, x.outerValue);
			const splits = domain.map(t => t / 1000);
			if (align === -1) splits.unshift((domain[0] - interval) / 1000);
			if (align === 1) splits.push(rightEdges.at(-1));
			xAxis = {splits, values, align};
		}
	}
	else {
		xAxis = ordinalAxis(domain, x, 0);
		if (!xAxis.categories)
			rightEdges = domain.map((_, i) => i + 1);
	}

	const labels = fields[0].labels;
	const kind = labels?.le != null ? 'le' : labels?.ge != null ? 'ge' : null;
	const rowLabels = kind ? fields.map(f => f.labels[kind]) : fields.map(f => f.name);
	const yAxis = ordinalAxis(rowLabels, y, kind === 'le' ? -1 : kind === 'ge' ? 1 : 0, kind === 'le' ? '-Inf' : '+Inf');

	const centeredX = xAxis?.categories != null, centeredY = yAxis.categories != null;
	const xs = [], ys = [], hi = centeredY ? null : [], counts = [];
	for (let col = 0; col < domain.length; col++) {
		for (let row = 0; row < fields.length; row++) {
			const count = columns[row+1][col];
			if (!(count > 0)) continue;
			xs.push(centeredX ? col : rightEdges[col]);
			ys.push(row);
			hi?.push(row + 1);
			counts.push(count);
		}
	}

	return {
		fields: [centeredX ? 'x' : 'xMax', ...(centeredY ? ['y'] : ['yMin', 'yMax']), 'count'],
		data: [null, centeredY ? [xs, ys, counts] : [xs, ys, hi, counts]], xSize, time,
		grid: {
			x: centeredX ? xAxis : xMaxGrid(xSize, rightEdges[0], rightEdges.at(-1)),
			y: centeredY ? yAxis : {distr: 1, extent: [0, fields.length]},
		},

		axes: [centeredX ? null : xAxis, centeredY ? null : yAxis],
	};
}
