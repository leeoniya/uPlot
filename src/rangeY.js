import { abs, floor, max, min, round, roundDec, incrRound, incrRoundDn, incrRoundUp, fixedDec, isFinite, rangePad } from './utils.js';
import { numIncrs } from './opts.js';

export function rangeYCount(height) {
	if (!(height > 0) || !isFinite(height))
		return 0;

	let x = min(1, (height - 50) / 950);
	let space = height < 50 ? height : 25 + (x == 1 ? 1 : 1 - 2 ** (-10 * x)) * 25;
	return max(1, floor(height / space));
}

const autoLimit = Object.freeze({ pad: 0, soft: 0, mode: 3, affinity: rangePad });
export const rangeYAuto = Object.freeze({ min: autoLimit, max: autoLimit });
const emptyPolicy = Object.freeze({});

function limitPolicy(limit, side) {
	limit ??= emptyPolicy;

	let hardDefault = side == 0 ? -Infinity : Infinity;
	let softDefault = -hardDefault;
	let pad = limit.pad ?? 0;
	let hard = limit.hard ?? hardDefault;
	let soft = limit.soft ?? softDefault;
	let mode = limit.mode ?? 0;
	let affinity = limit.affinity ?? 0;

	if (pad < 0 || !isFinite(pad) || affinity < 0 || !isFinite(affinity) ||
		(!isFinite(hard) && hard != hardDefault) || (!isFinite(soft) && soft != softDefault) || !(mode >= 0 && mode <= 3))
		return null;

	return { pad, hard, soft, mode, affinity };
}

function atMostWithEpsilon(value, limit) {
	return value <= limit || value - limit <= max(abs(value), abs(limit)) * Number.EPSILON * 2;
}

function softAnchor(data, target, span, policy, side) {
	let { soft, mode, affinity } = policy;
	let beyond = side == 0 ? data >= soft : data <= soft;
	let inside = side == 0 ? target >= soft : target <= soft;
	let reached = side == 0 ? target <= soft : target >= soft;

	if (soft == 0 && affinity > 0)
		reached = reached || (side == 0 ? data >= 0 && atMostWithEpsilon(data, span * affinity) : data <= 0 && atMostWithEpsilon(-data, span * affinity));

	let active = mode == 1 || mode == 2 && inside || mode == 3 && reached;
	return beyond && active ? soft : null;
}

function incrAligned(value, incr) {
	return incrRound(value, incr) == value;
}

function prepareRangeY(dataMin, dataMax, range) {
	range ??= rangeYAuto;

	let minPolicy = limitPolicy(range.min, 0);
	let maxPolicy = limitPolicy(range.max, 1);
	if (minPolicy == null || maxPolicy == null || minPolicy.hard >= maxPolicy.hard)
		return null;

	let rawSpan = dataMax - dataMin;
	let fallbackMin = dataMin;
	let fallbackMax = dataMax;

	if (dataMin == dataMax) {
		fallbackMin = dataMin - abs(dataMin);
		fallbackMax = dataMax == 0 ? 100 : dataMax + abs(dataMax);
	}

	let fallbackSpan = fallbackMax - fallbackMin;
	let targetMin = fallbackMin - rawSpan * minPolicy.pad;
	let targetMax = fallbackMax + rawSpan * maxPolicy.pad;
	if (!isFinite(fallbackSpan))
		return null;

	let minAnchor = softAnchor(dataMin, targetMin, rawSpan, minPolicy, 0);
	let maxAnchor = softAnchor(dataMax, targetMax, rawSpan, maxPolicy, 1);

	// Preserve the existing positive fallback for data that is flat at zero.
	if (rawSpan == 0 && dataMin == 0 && minAnchor == 0 && maxAnchor == 0)
		maxAnchor = null;

	let hardMin = minPolicy.hard;
	let hardMax = maxPolicy.hard;
	if ((minAnchor ?? targetMin) < hardMin)
		minAnchor = hardMin;
	if ((maxAnchor ?? targetMax) > hardMax)
		maxAnchor = hardMax;

	let boundedMin = max(fallbackMin, hardMin);
	let boundedMax = min(fallbackMax, hardMax);
	let requiredMin = minAnchor ?? targetMin;
	let requiredMax = maxAnchor ?? targetMax;
	if (boundedMin > boundedMax || minAnchor != null && minAnchor > boundedMin || maxAnchor != null && maxAnchor < boundedMax ||
		!isFinite(requiredMin) || !isFinite(requiredMax))
		return null;

	return {
		span: fallbackSpan,
		targetMin,
		targetMax,
		boundedMin,
		boundedMax,
		hardMin,
		hardMax,
		minAnchor,
		maxAnchor,
		requiredMin,
		requiredMax,
	};
}

// Returns null when the built-in increments cannot support the requested range/count/policy.
export function rangeY(dataMin, dataMax, height, range = rangeYAuto) {
	let count = rangeYCount(height);
	if (dataMin == null && dataMax == null)
		return { min: null, max: null, incr: 0, count: 0 };

	if (!Number.isSafeInteger(count) || count < 1 || dataMin == null || dataMax == null ||
		!isFinite(dataMin) || !isFinite(dataMax) || dataMax < dataMin)
		return null;

	let request = prepareRangeY(dataMin, dataMax, range);
	if (request == null)
		return null;

	let {
		span, targetMin, targetMax, boundedMin, boundedMax,
		hardMin, hardMax, minAnchor, maxAnchor, requiredMin, requiredMax,
	} = request;

	for (let incr of numIncrs) {
		let dec = fixedDec.get(incr);
		let magnitude = max(abs(requiredMin), abs(requiredMax)) + count * incr;

		// Stay within baseline quotient/decimal budgets and exact integer arithmetic.
		if (dec > 32 || magnitude / incr >= 1e15 || magnitude > Number.MAX_SAFE_INTEGER || dec > 0 && magnitude * 10 ** dec >= 1e15)
			continue;

		if (minAnchor != null && !incrAligned(minAnchor, incr) || maxAnchor != null && !incrAligned(maxAnchor, incr))
			continue;

		let baseLo = incrRoundDn(requiredMin, incr);
		let baseHi = incrRoundUp(requiredMax, incr);

		// Baseline rounding tolerates residue; padding and enclosure must use the unrounded targets.
		if (baseLo > requiredMin)
			baseLo = roundDec(baseLo - incr, dec);
		if (baseHi < requiredMax)
			baseHi = roundDec(baseHi + incr, dec);

		let lo;
		let hi;

		if (minAnchor != null) {
			lo = minAnchor;
			hi = roundDec(lo + count * incr, dec);
			if (maxAnchor != null && hi != maxAnchor)
				continue;
		}
		else if (maxAnchor != null) {
			hi = maxAnchor;
			lo = roundDec(hi - count * incr, dec);
		}
		else {
			let used = round((baseHi - baseLo) / incr);

			// A one-interval mixed-sign range uses its rounded endpoints directly.
			if (count == 1 && baseLo < 0 && baseHi > 0 && incr >= span) {
				lo = baseLo;
				hi = baseHi;
			}
			else {
				if (used > count)
					continue;

				let minLo = roundDec(baseHi - count * incr, dec);
				let maxLo = baseLo;

				if (isFinite(hardMin))
					minLo = max(minLo, incrRoundUp(hardMin, incr));
				if (isFinite(hardMax))
					maxLo = min(maxLo, incrRoundDn(hardMax - count * incr, incr));
				if (boundedMin >= 0 && targetMin >= 0)
					minLo = max(0, minLo);
				if (boundedMax <= 0 && targetMax <= 0)
					maxLo = min(-count * incr, maxLo);
				if (minLo > maxLo)
					continue;

				lo = roundDec(baseLo - floor((count - used) / 2) * incr, dec);
				lo = min(max(lo, minLo), maxLo);
				hi = roundDec(lo + count * incr, dec);
			}
		}

		let minPadded = minAnchor != null || lo <= targetMin;
		let maxPadded = maxAnchor != null || hi >= targetMax;
		if (isFinite(lo) && isFinite(hi) && lo >= hardMin && hi <= hardMax &&
			lo <= boundedMin && hi >= boundedMax && minPadded && maxPadded && hi > lo)
			return { min: lo == 0 ? 0 : lo, max: hi == 0 ? 0 : hi, incr: count == 1 ? hi - lo : incr, count };
	}

	return null;
}
