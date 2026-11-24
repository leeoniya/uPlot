// align is the direction a cell extends from its source value in axis coordinates:
// -1 from the upper edge, +1 from the lower edge, or 0 around the center.
// heatmapPlugin always takes the upper X edge, regardless of the source alignment.
function checkTimes(times, interval) {
	if (!Number.isFinite(interval) || interval <= 0)
		throw new RangeError('Expected a positive finite interval in milliseconds');
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		if (!Number.isFinite(t) || !Number.isSafeInteger((t - times[0]) / interval))
			throw new RangeError('Expected finite timestamps on the interval grid');
		if (i > 0 && t <= times[i-1])
			throw new RangeError('Expected ascending timestamps');
	}
}

function checkColumns(columns) {
	if (!Array.isArray(columns) || !columns.length || !columns.every(c => Array.isArray(c) && c.length === columns[0].length))
		throw new TypeError('Expected equal-length data columns');
}

function populated(count) {
	return Number.isFinite(count) && count > 0;
}

export function heatmapCells(frameOrSnapshot) {
	let {interval, values, factor, schema} = frameOrSnapshot;
	if (schema) {
		const indices = ['xMax', 'yMin', 'yMax', 'count'].map(name => schema.fields.findIndex(f => f.name === name));
		interval = schema.fields[indices[0]]?.config?.interval;
		values = indices.map(i => frameOrSnapshot.data.values[i]);
	}
	// Sparse cells already follow the plugin contract. Only X needs unit conversion.
	const [times, lo, hi, counts] = values;
	const result = {data: [null, [times.map(ms => ms / 1000), lo, hi, counts]], xSize: interval / 1000};
	if (factor !== undefined) result.factor = factor;
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
		const interval = xField.config?.interval;
		checkTimes(domain, interval);
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
