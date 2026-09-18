import { abs, floor, max, min, round, roundDec, incrRoundDn, incrRoundUp, fixedDec, isFinite } from './utils.js';
import { numIncrs } from './opts.js';

export function rangeYCount(height) {
	if (!(height > 0) || !isFinite(height))
		return 0;

	let x = min(1, (height - 50) / 950);
	let space = height < 50 ? height : 25 + (x == 1 ? 1 : 1 - 2 ** (-10 * x)) * 25;
	return max(1, floor(height / space));
}

// Returns null when the built-in increments cannot support the requested range/count.
export function rangeY(dataMin, dataMax, height) {
	let count = rangeYCount(height);
	if (dataMin == null && dataMax == null)
		return { min: null, max: null, incr: 0, count: 0 };

	if (!Number.isSafeInteger(count) || count < 1 || dataMin == null || dataMax == null ||
		!isFinite(dataMin) || !isFinite(dataMax) || dataMax < dataMin)
		return null;

	if (dataMin == dataMax) {
		let v = dataMin;
		dataMin = v - abs(v);
		dataMax = v == 0 ? 100 : v + abs(v);
	}

	let span = dataMax - dataMin;
	if (!isFinite(span))
		return null;

	for (let incr of numIncrs) {
		let dec = fixedDec.get(incr);
		let magnitude = max(abs(dataMin), abs(dataMax)) + count * incr;

		// Stay within baseline quotient/decimal budgets and exact integer arithmetic.
		if (dec > 32 || magnitude / incr >= 1e15 || magnitude > Number.MAX_SAFE_INTEGER || dec > 0 && magnitude * 10 ** dec >= 1e15)
			continue;

		let lo = incrRoundDn(dataMin, incr);
		let hi = incrRoundUp(dataMax, incr);

		// Baseline rounding tolerates residue; range enclosure must use the raw extrema.
		if (lo > dataMin)
			lo = roundDec(lo - incr, dec);
		if (hi < dataMax)
			hi = roundDec(hi + incr, dec);

		let used = round((hi - lo) / incr);

		// The prototype's tiny mixed-sign exception uses only the rounded endpoints.
		if (count == 1 && dataMin < 0 && dataMax > 0 && incr >= span)
			return { min: lo, max: hi, incr: hi - lo, count };

		if (used > count)
			continue;

		lo = roundDec(lo - floor((count - used) / 2) * incr, dec);
		if (dataMin >= 0)
			lo = max(0, lo);
		if (dataMax <= 0)
			lo = min(-count * incr, lo);
		hi = roundDec(lo + count * incr, dec);

		if (isFinite(lo) && isFinite(hi) && lo <= dataMin && hi >= dataMax && hi > lo)
			return { min: lo == 0 ? 0 : lo, max: hi == 0 ? 0 : hi, incr, count };
	}

	return null;
}
