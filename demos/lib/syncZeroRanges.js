// Linear scales with matching directions share zero when their normalized bounds match.
export function syncZeroRanges(extrema) {
	let lower = Infinity;
	let upper = -Infinity;
	const magnitudes = {};

	for (const key in extrema) {
		const bounds = extrema[key];
		if (bounds == null || bounds[0] == null || bounds[1] == null)
			continue;

		const [min, max] = bounds;
		const magnitude = magnitudes[key] = Math.max(Math.abs(min), Math.abs(max)) || 1;
		lower = Math.min(lower, min / magnitude);
		upper = Math.max(upper, max / magnitude);
	}

	// Identical normalized extrema still need a nonzero display span.
	if (lower == upper) {
		lower = Math.min(lower, 0);
		upper = Math.max(upper, 0);
		if (lower == upper) {
			lower = -1;
			upper = 1;
		}
	}

	const ranges = {};
	for (const key in extrema) {
		const magnitude = magnitudes[key];
		ranges[key] = magnitude == null ? [null, null] : [lower * magnitude, upper * magnitude];
	}
	return ranges;
}
