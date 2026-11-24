// align is the direction a cell extends from its source value in axis coordinates:
// -1 from the upper edge, +1 from the lower edge, or 0 around the center.
// heatmapPlugin always takes the upper X edge, regardless of the source alignment.
function timeInterval(times, configured, allowRepeats = false, trusted = false) {
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
	if (trusted && configured !== undefined) return interval;
	if (!times.length) throw new RangeError('Time range needs at least one timestamp');
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		if (!Number.isFinite(t) || !Number.isSafeInteger((t - times[0]) / interval))
			throw new RangeError('Expected finite timestamps on the interval grid');
		if (i > 0 && (allowRepeats ? t < times[i-1] : t <= times[i-1]))
			throw new RangeError('Expected ascending timestamps');
	}
	return interval;
}

// For a known geometric grid, one regular bucket suffices, even if intervening rows are missing.
function bucketFactor(lo, hi) {
	for (let i = 0; i < lo.length; i++) {
		const a = lo[i], b = hi[i];
		if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) continue;
		const ratio = a > 0 ? b / a : b < 0 ? a / b : NaN;
		if (Number.isFinite(ratio) && ratio > 1) return ratio;
	}
}

function checkColumns(columns) {
	if (!Array.isArray(columns) || !columns.length || !columns.every(c => Array.isArray(c) && c.length === columns[0].length))
		throw new TypeError('Expected equal-length data columns');
}

function populated(count) {
	return Number.isFinite(count) && count > 0;
}

export function heatmapCells({schema, data}, {ordinal = false, geometric = false} = {}) {
	const fieldIndex = name => schema.fields.findIndex(f => f.name === name);
	const indices = ['xMax', 'yMin', 'yMax', 'count'].map(fieldIndex);

	const values = indices.map(i => data.values[i]);
	// Sparse cells already follow the plugin contract. Only X needs unit conversion.
	const [times, lo, hi, counts] = values;
	const interval = timeInterval(times, schema.fields[indices[0]].config?.interval, true, !ordinal);
	const xs = times.map(ms => ms / 1000);
	const result = {data: [null, [xs, lo, hi, counts]], xSize: interval / 1000};

	if (!ordinal) {
		if (geometric) result.factor = bucketFactor(lo, hi);
		return result;
	}

	const layoutIdx = fieldIndex('yLayout');
	const layout = data.values[layoutIdx];
	checkColumns(layoutIdx < 0 ? values : [...values, layout]);


	// Rank the union of observed edges, not just the edges present at the first timestamp.
	const ranks = new Map();
	let allPositive = true;
	for (let i = 0; i < times.length; i++) {
		const lower = lo[i] === null ? -Infinity : lo[i];
		const upper = hi[i] === null ? Infinity : hi[i];
		if (typeof lower !== 'number' || typeof upper !== 'number' || !(lower < upper))
			throw new RangeError('Expected increasing numeric Y bounds or null open ends');
		// Hover shows (lo, hi]. Layout 3 is equivalent only for an unbounded lower edge.
		if (layout && layout[i] !== 0 && !(layout[i] === 3 && lo[i] === null))
			throw new RangeError('Unsupported yLayout for ordinal cells');
		ranks.set(lower, 0);
		ranks.set(upper, 0);
		if (!populated(counts[i])) allPositive = false;
	}
	const edges = Array.from(ranks.keys()).sort((a, b) => a - b);
	edges.forEach((edge, i) => ranks.set(edge, i));

	const lows = [], highs = [];
	const positive = allPositive ? counts : [];
	let prevRow = -1;
	for (let i = 0; i < times.length; i++) {
		const row = ranks.get(lo[i] ?? -Infinity);
		if (ranks.get(hi[i] ?? Infinity) !== row + 1)
			throw new RangeError('Ordinal cell bounds must have adjacent ranks');
		if (times[i] === times[i-1] && row <= prevRow)
			throw new RangeError('Expected ascending row IDs within each timestamp');
		prevRow = row;
		if (!allPositive) {
			if (!populated(counts[i])) continue;
			xs[lows.length] = xs[i];
			positive.push(counts[i]);
		}
		lows.push(row);
		highs.push(row + 1);
	}
	xs.length = lows.length;
	result.data[1] = [xs, lows, highs, positive];
	result.grid = {y: {distr: 1}};
	result.scales = {x: {time: true, range: [(times[0] - interval) / 1000, times.at(-1) / 1000]}, y: {range: [0, edges.length - 1], distr: 1}};
	result.axes = [null, {splits: edges.map((_, i) => i), values: edges.map(v => v === -Infinity ? '-Inf' : v === Infinity ? '+Inf' : String(v)), align: -1}];
	return result;
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
	return {splits: values.map((_, i) => align === 0 ? i + 0.5 : i), values, align};
}

function bound(label) {
	const text = String(label).trim();
	const number = /^[+-]?Inf$/.test(text) ? (text[0] === '-' ? -Infinity : Infinity) : Number(text);
	if (!text || Number.isNaN(number)) throw new TypeError(`Invalid bucket bound: ${label}`);
	return number;
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
		xRange = [0, domain.length];
		rightEdges = domain.map((_, i) => i + 1);
	}

	const rows = fields.map(({name, labels}, i) => {
		const le = labels?.le != null, ge = labels?.ge != null;
		if (le && ge) throw new TypeError('A bucket cannot have both le and ge bounds');
		const kind = le ? 'le' : ge ? 'ge' : null;
		const label = kind ? labels[kind] : name;
		return {kind, label, order: kind ? bound(label) : i, counts: columns[i+1]};
	});
	const {kind} = rows[0];
	if (rows.some(r => r.kind !== kind)) throw new TypeError('Expected consistent Y bucket labels');
	if (kind) rows.sort((a, b) => a.order - b.order);
	const yAxis = ordinalAxis(rows.map(r => r.label), y, kind === 'le' ? -1 : kind === 'ge' ? 1 : 0, kind === 'le' ? '-Inf' : '+Inf');

	const xs = [], lo = [], hi = [], counts = [];
	for (let col = 0; col < domain.length; col++) {
		for (let row = 0; row < rows.length; row++) {
			const count = rows[row].counts[col];
			if (!populated(count)) continue;
			xs.push(rightEdges[col]);
			lo.push(row);
			hi.push(row + 1);
			counts.push(count);
		}
	}
	return {
		data: [null, [xs, lo, hi, counts]], xSize, grid: {y: {distr: 1}},
		scales: {x: {time, range: xRange}, y: {range: [0, rows.length], distr: 1}}, axes: [xAxis, yAxis],
	};
}
