// align is the direction a cell extends from its source value in axis coordinates:
// -1 from the upper edge, +1 from the lower edge, or 0 around the center.
// Time anchors are converted to upper edges; centered categories keep their zero-based IDs.
function timeInterval(times, configured) {
	let interval = configured;
	if (interval === undefined) {
		// Use an observed width. A smaller common divisor could invent a very fine grid from jitter.
		interval = Infinity;
		for (let i = 1; i < times.length; i++) {
			const step = times[i] - times[i-1];
			if (step > 0 && step < interval) interval = step;
		}
		if (!Number.isFinite(interval)) throw new RangeError('Cannot infer an interval without two distinct timestamps');
	}
	if (!Number.isFinite(interval) || interval <= 0)
		throw new RangeError('Expected a positive finite interval in milliseconds');

	return interval;
}

// For a known geometric grid, one regular bucket suffices, even if intervening rows are missing.
function bucketFactor(lo, hi) {
	for (let i = 0; i < lo.length; i++) {
		const a = lo[i], b = hi[i];
		const ratio = a > 0 ? b / a : b < 0 ? a / b : 0;
		// A zero bucket has no factor. Even finite bounds can give an infinite ratio.
		if (ratio > 1 && ratio < Infinity) return ratio;
	}
}

function checkColumns(columns) {
	if (!Array.isArray(columns) || !columns.length || !columns.every(c => Array.isArray(c) && c.length === columns[0].length))
		throw new TypeError('Expected equal-length data columns');
}


const cellFields = Object.freeze(['xMax', 'yMin', 'yMax', 'count']);

// Single-anchor extents include the first and last declared xMax, even when those cells are empty.
function xMaxGrid(step, first, last) {
	return first === undefined ? {step} : {step, extent: [first, last]};
}

// Unranked sparse bounds can have mixed widths. Only advertise a linear frame on request.
export function heatmapCells({schema, data}, {ordinal = false, geometric = false, linear = false} = {}) {
	if (linear && geometric) throw new TypeError('Choose linear or geometric cell geometry');
	const fieldIndex = name => schema.fields.findIndex(f => f.name === name);
	const indices = cellFields.map(fieldIndex);

	const values = indices.map(i => data.values[i]);
	// Sparse cells already follow the plugin contract. Only X needs unit conversion.
	const [times, lo, hi, counts] = values;
	const interval = timeInterval(times, schema.fields[indices[0]].config?.interval);
	const xSize = interval / 1000;

	if (!ordinal) {
		const result = {data: [null, [times.map(ms => ms / 1000), lo, hi, counts]], xSize};
		if (geometric) result.factor = bucketFactor(lo, hi);
		return linear ? {...result, fields: cellFields, grid: {x: {step: xSize}, y: {distr: 1}}} : result;
	}

	const layoutIdx = fieldIndex('yLayout');
	const layout = data.values[layoutIdx];
	checkColumns(layoutIdx < 0 ? values : [...values, layout]);
	if (!times.length) throw new RangeError('Time range needs at least one timestamp');

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
	let positive = counts;
	for (let i = 0; i < times.length; i++) {
		const count = counts[i];
		if (!(count > 0)) {
			// Reuse the source column unless a cell needs to be omitted.
			if (positive === counts) positive = counts.slice(0, i);
			continue;
		}
		if (positive !== counts) positive.push(count);
		const row = ranks.get(lo[i]);
		xs.push(times[i] / 1000);
		lows.push(row);
		highs.push(row + 1);
	}

	const lastX = times.at(-1) / 1000, yRange = [0, edges.length - 1];
	return {
		data: [null, [xs, lows, highs, positive]], xSize, fields: cellFields,
		grid: {x: xMaxGrid(xSize, times[0] / 1000, lastX), y: {distr: 1, extent: yRange}},
		scales: {x: {time: true, range: [(times[0] - interval) / 1000, lastX]}, y: {range: yRange, distr: 1}},
		axes: [null, {splits: edges.map((_, i) => i), values: edges.map(v => v === -Infinity ? '-Inf' : v === Infinity ? '+Inf' : String(v)), align: -1}],
	};
}

function alignment({align}, fallback) {
	if (align === undefined) return fallback;
	if (align !== -1 && align !== 0 && align !== 1)
		throw new RangeError('Axis align must be -1, 0 or 1');
	return align;
}

function axisValues(labels, n, align, outer) {
	const count = align === 0 ? n : n + 1;
	const values = Array.from(labels, String);
	if (align !== 0 && values.length === n) {
		if (outer === undefined)
			throw new RangeError('Edge-aligned labels need an outerValue or all n + 1 edge values');
		if (align === -1) values.unshift(String(outer));
		else values.push(String(outer));
	}
	if (values.length !== count)
		throw new RangeError(`Expected ${count} axis labels`);
	return values;
}

function ordinalAxis(labels, options, defaultAlign, defaultOuter) {
	const align = alignment(options, defaultAlign);
	const outer = options.outerValue ?? (align === defaultAlign ? defaultOuter : undefined);
	const values = axisValues(options.values ?? labels, labels.length, align, outer);
	return align === 0 ? {categories: values} : {splits: values.map((_, i) => i), values, align};
}


// The first field supplies X anchors. Each remaining field is one Y bucket's values.
// x/y.values override tick text in display order. For edge alignment, supply all n+1
// labels or the n anchor labels and outerValue. Skip empty cells, not empty axis labels.
export function heatmapRows(frame, {x = {}, y = {}} = {}) {
	const [xField, ...fields] = frame.schema.fields;
	const columns = frame.data.values;
	checkColumns(columns);
	if (columns.length !== fields.length + 1 || !fields.length)
		throw new TypeError('Expected an X field and a column for each Y field');
	const domain = columns[0];
	const time = xField.type === 'time';
	let xAxis = null, xSize = 1, xRange, rightEdges;
	if (time) {
		const interval = timeInterval(domain, xField.config?.interval);
		if (!domain.length) throw new RangeError('Time range needs at least one timestamp');
		xSize = interval / 1000;
		const align = alignment(x, -1);
		const offset = (1 + align) * interval / 2;
		rightEdges = domain.map(t => (t + offset) / 1000);
		xRange = [(domain[0] + offset - interval) / 1000, rightEdges.at(-1)];
		if (x.outerValue !== undefined && (x.values === undefined || align === 0))
			throw new RangeError('Time X outerValue requires edge-aligned x.values');
		if (x.values !== undefined) {
			// Gaps have two distinct facing edges, so n + 1 labels cannot cover them.
			if (align !== 0 && domain.at(-1) - domain[0] !== (domain.length - 1) * interval)
				throw new RangeError('Edge-aligned time X labels require contiguous intervals');
			const values = axisValues(x.values, domain.length, align, x.outerValue);
			const splits = domain.map(t => t / 1000);
			if (align === -1) splits.unshift(xRange[0]);
			if (align === 1) splits.push(xRange[1]);
			xAxis = {splits, values, align};
		}
	}
	else {
		if (xField.type !== 'string') throw new TypeError('Expected a time or string X field');
		xAxis = ordinalAxis(domain, x, 0);
		if (xAxis.categories)
			xRange = domain.length ? [-0.5, domain.length - 0.5] : [null, null];
		else {
			xRange = [0, domain.length];
			rightEdges = domain.map((_, i) => i + 1);
		}
	}

	const rows = fields.map(({name, labels}, i) => {
		const le = labels?.le != null, ge = labels?.ge != null;
		if (le && ge) throw new TypeError('A bucket cannot have both le and ge bounds');
		const kind = le ? 'le' : ge ? 'ge' : null;
		const label = kind ? labels[kind] : name;
		return {kind, label, counts: columns[i+1]};
	});
	const {kind} = rows[0];
	if (rows.some(r => r.kind !== kind)) throw new TypeError('Expected consistent Y bucket labels');

	const yAxis = ordinalAxis(rows.map(r => r.label), y, kind === 'le' ? -1 : kind === 'ge' ? 1 : 0, kind === 'le' ? '-Inf' : '+Inf');

	const centeredX = xAxis?.categories != null, centeredY = yAxis.categories != null;
	const xs = [], ys = [], hi = centeredY ? null : [], counts = [];
	for (let col = 0; col < domain.length; col++) {
		for (let row = 0; row < rows.length; row++) {
			const count = rows[row].counts[col];
			if (!(count > 0)) continue;
			xs.push(centeredX ? col : rightEdges[col]);
			ys.push(row);
			hi?.push(row + 1);
			counts.push(count);
		}
	}
	const yRange = centeredY ? [-0.5, rows.length - 0.5] : [0, rows.length];
	return {
		fields: [centeredX ? 'x' : 'xMax', ...(centeredY ? ['y'] : ['yMin', 'yMax']), 'count'],
		data: [null, centeredY ? [xs, ys, counts] : [xs, ys, hi, counts]], xSize,
		grid: {
			x: centeredX ? xAxis : xMaxGrid(xSize, rightEdges[0], rightEdges.at(-1)),
			y: centeredY ? yAxis : {distr: 1, extent: yRange},
		},
		scales: {x: {time, range: xRange}, y: {range: yRange, distr: 1}},
		axes: [centeredX ? null : xAxis, centeredY ? null : yAxis],
	};
}
