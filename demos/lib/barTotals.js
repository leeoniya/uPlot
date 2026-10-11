// Input: [categories, ...components]. visible uses raw series indices; index 0 is unused.
// Omitted visibility entries mean visible. The returned array shares all raw columns.
export function withBarTotals(data, visible) {
	const positive = Array(data[0].length).fill(null);
	const negative = Array(data[0].length).fill(null);
	for (let si = 1; si < data.length; si++) {
		if (visible?.[si] === false)
			continue;
		for (let di = 0; di < data[0].length; di++) {
			const value = data[si][di];
			if (!Number.isFinite(value) || value == 0)
				continue;
			const totals = value > 0 ? positive : negative;
			totals[di] = (totals[di] ?? 0) + value;
		}
	}
	return [data[0], positive, negative, ...data.slice(1)];
}
