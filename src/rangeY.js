import { abs, floor, max, min, round, roundDec, incrRound, incrRoundDn, incrRoundUp, fixedDec, isFinite, rangePad, rangeZeroIf, rangeAnchors } from './utils.js';
import { numIncrs } from './opts.js';

export function rangeYCount(height, ramp = 1) {
	if (!(height > 0) || !isFinite(height) || !(ramp >= 0) || !isFinite(ramp))
		return 0;

	let target = height / 50;
	target += Math.exp(-target / 3);
	return max(1, round(1 + (target - 1) * ramp));
}

/** @typedef {{pad?: number | null, hard?: number | null, soft?: number | null}} RangeYLimit */

const autoLimit = Object.freeze({ pad: rangePad });
/** @type {Readonly<{zeroIf: number, min: Readonly<RangeYLimit>, max: Readonly<RangeYLimit>}>} */
export const rangeYAuto = Object.freeze({ zeroIf: rangeZeroIf, min: autoLimit, max: autoLimit });

function limitPolicy(limit, side) {
	limit ??= autoLimit;

	let hardDefault = side == 0 ? -Infinity : Infinity;
	let softDefault = -hardDefault;
	let hard = limit.hard ?? hardDefault;
	let soft = limit.soft ?? softDefault;
	let pad = limit.pad ?? autoLimit.pad;

	if ((!isFinite(hard) && hard != hardDefault) || (!isFinite(soft) && soft != softDefault) ||
		!isFinite(pad) || pad < 0)
		return null;

	return { hard, soft, pad };
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
	let [minAnchor, maxAnchor] = rangeAnchors(dataMin, dataMax, minPolicy.soft, maxPolicy.soft, zeroIf);
	if (minAnchor != null)
		minAnchor = max(minAnchor, minPolicy.hard);
	if (maxAnchor != null)
		maxAnchor = min(maxAnchor, maxPolicy.hard);

	let fallbackMin = dataMin;
	let fallbackMax = dataMax;

	if (dataMin == dataMax) {
		fallbackMin = dataMin - abs(dataMin);
		fallbackMax = dataMax == 0 ? 100 : dataMax + abs(dataMax);

		if (dataMin == 0 && (maxAnchor == 0 && minAnchor == null || maxPolicy.hard == 0)) {
			fallbackMin = -100;
			fallbackMax = 0;
			if (minPolicy.soft != 0)
				minAnchor = null;
		}
	}

	let span = fallbackMax - fallbackMin;
	if (!isFinite(span))
		return null;

	let boundedMin = max(dataMin, minPolicy.hard);
	let boundedMax = min(dataMax, maxPolicy.hard);
	if (boundedMin > boundedMax)
		return null;

	return {
		minAnchor,
		maxAnchor,
		span,
		boundedMin,
		boundedMax,
		// Padding uses raw extrema, never the fallback span or selected ticks.
		paddedMin: max(fallbackMin - rawSpan * minPolicy.pad, minPolicy.hard),
		paddedMax: min(fallbackMax + rawSpan * maxPolicy.pad, maxPolicy.hard),
		minPolicy,
		maxPolicy,
	};
}

function selectRangeY(request, count, exactCount) {
	let { span, minAnchor, maxAnchor, minPolicy, maxPolicy } = request;
	let boundedMin = minAnchor == null ? request.paddedMin : request.boundedMin;
	let boundedMax = maxAnchor == null ? request.paddedMax : request.boundedMax;
	let hardMin = minPolicy.hard;
	let hardMax = maxPolicy.hard;
	let requiredMin = minAnchor ?? boundedMin;
	let requiredMax = maxAnchor ?? boundedMax;
	let requiredSpan = requiredMax - requiredMin;
	if (!isFinite(requiredMin) || !isFinite(requiredMax) || !isFinite(requiredSpan))
		return null;

	let start = incrStart(requiredSpan / count);
	let approximate = !exactCount && count > 1;
	let requiredMagnitude = max(abs(requiredMin), abs(requiredMax));
	let best = null;

	for (let i = start; i < numIncrs.length; i++) {
		let incr = numIncrs[i];
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
			lo <= boundedMin && hi >= boundedMax && hi > lo) {
			// Compare rounded counts, retaining a denser fallback when limits reject coarser increments.
			if (best == null || abs(foundCount - count) <= abs(best.count - count))
				best = { min: lo == 0 ? 0 : lo, max: hi == 0 ? 0 : hi, incr: foundCount == 1 ? hi - lo : incr, count: foundCount };

			// Stop at the first valid sparse grid; ties favor fewer ticks.
			if (foundCount <= count)
				return best;
		}
	}

	return best;
}

// Returns null when the built-in increments cannot support the requested range/count/policy.
export function rangeY(dataMin, dataMax, height, range = rangeYAuto, ramp = 1, exactCount = false) {
	if (dataMin == null && dataMax == null)
		return { min: null, max: null, incr: 0, count: 0 };

	let count = rangeYCount(height, ramp);
	if (!Number.isSafeInteger(count) || count < 1 || dataMin == null || dataMax == null ||
		!isFinite(dataMin) || !isFinite(dataMax) || dataMax < dataMin)
		return null;

	let request = prepareRangeY(dataMin, dataMax, range);
	if (request == null)
		return null;

	return selectRangeY(request, count, exactCount);
}
