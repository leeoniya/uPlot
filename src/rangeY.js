import { abs, floor, max, min, round, roundDec, incrRound, incrRoundDn, incrRoundUp, fixedDec, isFinite } from './utils.js';
import { numIncrs } from './opts.js';

export function rangeYCount(height, ramp = 1) {
	if (!(height > 0) || !isFinite(height) || !(ramp >= 0) || !isFinite(ramp))
		return 0;

	let target = height / 50;
	target += Math.exp(-target / 3);
	return max(1, round(1 + (target - 1) * ramp));
}

/** @typedef {{pad?: number, hard?: number, soft?: number | null, mode?: number}} RangeYLimit */

const autoLimit = Object.freeze({ soft: 0, mode: 3 });
/** @type {Readonly<{zeroIf: number, min: Readonly<RangeYLimit>, max: Readonly<RangeYLimit>}>} */
export const rangeYAuto = Object.freeze({ zeroIf: 0.2, min: autoLimit, max: autoLimit });

function limitPolicy(limit, side) {
	limit ??= autoLimit;

	let hardDefault = side == 0 ? -Infinity : Infinity;
	let softDefault = -hardDefault;
	let hard = limit.hard ?? hardDefault;
	let soft = "soft" in limit ? limit.soft ?? softDefault : autoLimit.soft;
	let mode = limit.mode ?? autoLimit.mode;

	// pad is intentionally ignored: selected outer ticks provide the data clearance.
	if ((!isFinite(hard) && hard != hardDefault) || (!isFinite(soft) && soft != softDefault) ||
		!(mode == 0 || mode == 1 || mode == 2 || mode == 3))
		return null;

	return { hard, soft, mode };
}

function atMostWithEpsilon(value, limit) {
	return value <= limit || value - limit <= max(abs(value), abs(limit)) * Number.EPSILON * 2;
}

function softAnchor(data, endpoint, policy, side) {
	let { soft, mode } = policy;
	let beyond = side == 0 ? data >= soft : data <= soft;
	let inside = side == 0 ? endpoint >= soft : endpoint <= soft;
	let reached = side == 0 ? endpoint <= soft : endpoint >= soft;

	let active = mode == 1 || mode == 2 && inside || mode == 3 && reached;
	return beyond && active ? soft : null;
}

function incrAligned(value, incr) {
	return incrRound(value, incr) == value;
}

function incrStart(minimum) {
	let lo = 0;
	let hi = numIncrs.length;

	while (lo < hi) {
		let mid = (lo + hi) >> 1;

		if (numIncrs[mid] < minimum)
			lo = mid + 1;
		else
			hi = mid;
	}

	// Retain the preceding candidate for decimal-rounding tolerance.
	return max(0, lo - 1);
}

function prepareRangeY(dataMin, dataMax, range) {
	range ??= rangeYAuto;

	let zeroIf = range.zeroIf ?? rangeYAuto.zeroIf;
	let minPolicy = limitPolicy(range.min, 0);
	let maxPolicy = limitPolicy(range.max, 1);
	if (!isFinite(zeroIf) || zeroIf < 0 || minPolicy == null || maxPolicy == null || minPolicy.hard >= maxPolicy.hard)
		return null;

	let rawSpan = dataMax - dataMin;
	let fallbackMin = dataMin;
	let fallbackMax = dataMax;

	if (dataMin == dataMax) {
		fallbackMin = dataMin - abs(dataMin);
		fallbackMax = dataMax == 0 ? 100 : dataMax + abs(dataMax);
	}

	let span = fallbackMax - fallbackMin;
	if (!isFinite(span))
		return null;

	let boundedMin = max(fallbackMin, minPolicy.hard);
	let boundedMax = min(fallbackMax, maxPolicy.hard);
	if (boundedMin > boundedMax)
		return null;

	return {
		zeroIf,
		rawSpan,
		span,
		boundedMin,
		boundedMax,
		minPolicy,
		maxPolicy,
	};
}

function selectRangeY(request, count, minAnchor, maxAnchor, exactCount) {
	let { span, boundedMin, boundedMax, minPolicy, maxPolicy } = request;
	let hardMin = minPolicy.hard;
	let hardMax = maxPolicy.hard;
	let requiredMin = minAnchor ?? boundedMin;
	let requiredMax = maxAnchor ?? boundedMax;
	let requiredSpan = requiredMax - requiredMin;
	let start = incrStart(requiredSpan / count);
	let approximate = !exactCount && count > 1;
	let preferNext = approximate && start + 1 < numIncrs.length &&
		abs(requiredSpan / numIncrs[start + 1] - count) < abs(requiredSpan / numIncrs[start] - count);
	let requiredMagnitude = max(abs(requiredMin), abs(requiredMax));

	for (let i = start; i < numIncrs.length; i++) {
		// Swap the first two candidates, retaining the smaller one if limits reject the preferred one.
		let idx = preferNext && i < start + 2 ? (i == start ? i + 1 : i - 1) : i;
		let incr = numIncrs[idx];
		let dec = fixedDec.get(incr);
		let tickSpan = count * incr;
		let magnitude = requiredMagnitude + tickSpan;

		// Stay within baseline quotient/decimal budgets and exact integer arithmetic.
		if (dec > 32 || magnitude / incr >= 1e15 || magnitude > Number.MAX_SAFE_INTEGER || dec > 0 && magnitude * 10 ** dec >= 1e15)
			continue;

		if (minAnchor != null && !incrAligned(minAnchor, incr) || maxAnchor != null && !incrAligned(maxAnchor, incr))
			continue;

		let lo;
		let hi;
		let foundCount = count;

		if (approximate) {
			lo = minAnchor ?? incrRoundDn(boundedMin, incr);
			hi = maxAnchor ?? incrRoundUp(boundedMax, incr);
			if (minAnchor == null && lo > boundedMin)
				lo = roundDec(lo - incr, dec);
			if (maxAnchor == null && hi < boundedMax)
				hi = roundDec(hi + incr, dec);
			foundCount = round((hi - lo) / incr);
			if (!Number.isSafeInteger(foundCount) || foundCount < 1)
				continue;
		}
		else if (minAnchor != null) {
			lo = minAnchor;
			hi = roundDec(lo + tickSpan, dec);
			if (maxAnchor != null && hi != maxAnchor)
				continue;
		}
		else if (maxAnchor != null) {
			hi = maxAnchor;
			lo = roundDec(hi - tickSpan, dec);
		}
		else {
			let baseLo = incrRoundDn(boundedMin, incr);
			let baseHi = incrRoundUp(boundedMax, incr);

			// Baseline rounding tolerates residue; enclosure must use the unrounded extrema.
			if (baseLo > boundedMin)
				baseLo = roundDec(baseLo - incr, dec);
			if (baseHi < boundedMax)
				baseHi = roundDec(baseHi + incr, dec);

			let used = round((baseHi - baseLo) / incr);

			// A one-interval mixed-sign range uses its rounded endpoints directly.
			if (count == 1 && baseLo < 0 && baseHi > 0 && incr >= span) {
				lo = baseLo;
				hi = baseHi;
			}
			else {
				if (used > count)
					continue;

				let minLo = roundDec(baseHi - tickSpan, dec);
				let maxLo = baseLo;

				if (isFinite(hardMin))
					minLo = max(minLo, incrRoundUp(hardMin, incr));
				if (isFinite(hardMax))
					maxLo = min(maxLo, incrRoundDn(hardMax - tickSpan, incr));
				if (boundedMin >= 0)
					minLo = max(0, minLo);
				if (boundedMax <= 0)
					maxLo = min(-tickSpan, maxLo);
				if (minLo > maxLo)
					continue;

				lo = roundDec(baseLo - floor((count - used) / 2) * incr, dec);
				lo = min(max(lo, minLo), maxLo);
				hi = roundDec(lo + tickSpan, dec);
			}
		}

		magnitude = max(abs(lo), abs(hi));
		if (magnitude <= Number.MAX_SAFE_INTEGER && (dec == 0 || magnitude * 10 ** dec < 1e15) &&
			lo >= hardMin && hi <= hardMax &&
			lo <= boundedMin && hi >= boundedMax && hi > lo)
			return { min: lo == 0 ? 0 : lo, max: hi == 0 ? 0 : hi, incr: foundCount == 1 ? hi - lo : incr, count: foundCount };
	}

	return null;
}

// Returns null when the built-in increments cannot support the requested range/count/policy.
export function rangeY(dataMin, dataMax, height, range = rangeYAuto, ramp = 1, exactCount = true) {
	if (dataMin == null && dataMax == null)
		return { min: null, max: null, incr: 0, count: 0 };

	let count = rangeYCount(height, ramp);
	if (!Number.isSafeInteger(count) || count < 1 || dataMin == null || dataMax == null ||
		!isFinite(dataMin) || !isFinite(dataMax) || dataMax < dataMin)
		return null;

	let request = prepareRangeY(dataMin, dataMax, range);
	if (request == null)
		return null;

	let natural = selectRangeY(request, count, null, null, exactCount);
	if (natural == null)
		return null;

	let { zeroIf, rawSpan, minPolicy, maxPolicy } = request;
	let minAnchor = softAnchor(dataMin, natural.min, minPolicy, 0);
	let maxAnchor = softAnchor(dataMax, natural.max, maxPolicy, 1);

	if (zeroIf > 0) {
		if (minAnchor == null && dataMin >= 0 && atMostWithEpsilon(dataMin, rawSpan * zeroIf))
			minAnchor = 0;
		if (maxAnchor == null && dataMax <= 0 && atMostWithEpsilon(-dataMax, rawSpan * zeroIf))
			maxAnchor = 0;
	}

	// Preserve the existing positive fallback for data that is flat at zero.
	if (rawSpan == 0 && dataMin == 0 && minAnchor == 0 && maxAnchor == 0)
		maxAnchor = null;

	if (minAnchor != null && minAnchor < minPolicy.hard)
		minAnchor = minPolicy.hard;
	if (maxAnchor != null && maxAnchor > maxPolicy.hard)
		maxAnchor = maxPolicy.hard;

	return (minAnchor == null || minAnchor == natural.min) && (maxAnchor == null || maxAnchor == natural.max)
		? natural : selectRangeY(request, count, minAnchor, maxAnchor, exactCount);
}
