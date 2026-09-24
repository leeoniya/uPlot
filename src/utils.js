// binary search for index of closest value
export function closestIdx(num, arr, lo, hi) {
	let mid;
	lo = lo || 0;
	hi = hi || arr.length - 1;
	let bitwise = hi <= 2147483647;

	while (hi - lo > 1) {
		mid = bitwise ? (lo + hi) >> 1 : floor((lo + hi) / 2);

		if (arr[mid] < num)
			lo = mid;
		else
			hi = mid;
	}

	if (num - arr[lo] <= arr[hi] - num)
		return lo;

	return hi;
}

function makeIndexOfs(predicate) {
	 let indexOfs = (data, _i0, _i1) => {
		let i0 = -1;
		let i1 = -1;

		for (let i = _i0; i <= _i1; i++) {
			if (predicate(data[i])) {
				i0 = i;
				break;
			}
		}

		for (let i = _i1; i >= _i0; i--) {
			if (predicate(data[i])) {
				i1 = i;
				break;
			}
		}

		return [i0, i1];
	 };

	 return indexOfs;
}

const notNullish = v => v != null;
const isPositive = v => v != null && v > 0;

export const nonNullIdxs = makeIndexOfs(notNullish);
export const positiveIdxs = makeIndexOfs(isPositive);

export function getMinMax(data, _i0, _i1, sorted = 0, log = false) {
//	console.log("getMinMax()");

	let getEdgeIdxs = log ? positiveIdxs : nonNullIdxs;
	let predicate = log ? isPositive : notNullish;

	[_i0, _i1] = getEdgeIdxs(data, _i0, _i1);

	let _min = data[_i0];
	let _max = data[_i0];

	if (_i0 > -1) {
		if (sorted == 1) {
			_min = data[_i0];
			_max = data[_i1];
		}
		else if (sorted == -1) {
			_min = data[_i1];
			_max = data[_i0];
		}
		else {
			for (let i = _i0; i <= _i1; i++) {
				let v = data[i];

				if (predicate(v)) {
					if (v < _min)
						_min = v;
					else if (v > _max)
						_max = v;
				}
			}
		}
	}

	return [_min ?? inf, _max ?? -inf]; // todo: fix to return nulls
}

export function rangeLog(min, max, base, fullMags) {
	if (base == 2)
		fullMags = true;

	let minSign = sign(min);
	let maxSign = sign(max);

	if (min == max) {
		if (minSign == -1) {
			min *= base;
			max /= base;
		}
		else {
			min /= base;
			max *= base;
		}
	}

	let logFn = base == 10 ? log10 : log2;

	let growMinAbs = minSign == 1 ? floor : ceil;
	let growMaxAbs = maxSign == 1 ? ceil : floor;

	let minLogAbs = logFn(abs(min))
	let maxLogAbs = logFn(abs(max));

	let minExp = growMinAbs(minLogAbs);
	let maxExp = growMaxAbs(maxLogAbs);

	let minIncr = pow(base, minExp);
	let maxIncr = pow(base, maxExp);

	// fix values like Math.pow(10, -5) === 0.000009999999999999999
	if (base == 10) {
		if (minExp < 0)
			minIncr = roundDec(minIncr, -minExp);
		if (maxExp < 0)
			maxIncr = roundDec(maxIncr, -maxExp);
	}

	if (fullMags) {
		min = minIncr * minSign;
		max = maxIncr * maxSign;
	}
	else {
		min = incrRoundDn(min, pow(base, floor(minLogAbs)), false);
		max = incrRoundUp(max, pow(base, floor(maxLogAbs)), false);
	}

	return [min, max];
}

export function rangeAsinh(min, max, base, fullMags) {
	let minMax = rangeLog(min, max, base, fullMags);

	if (min == 0)
		minMax[0] = 0;

	if (max == 0)
		minMax[1] = 0;

	return minMax;
}

export const rangePad = 0.1;
export const rangeZeroIf = 0.1;

function atMostWithEpsilon(value, limit) {
	return value <= limit || value - limit <= max(abs(value), abs(limit)) * Number.EPSILON * 2;
}

export function rangeAnchors(dataMin, dataMax, softMin, softMax, zeroIf = rangeZeroIf) {
	zeroIf ??= rangeZeroIf;

	if (!isFinite(zeroIf) || zeroIf < 0)
		return [null, null];

	let minAnchor = softMin != null && dataMin >= softMin ? softMin : null;
	let maxAnchor = softMax != null && dataMax <= softMax ? softMax : null;
	let rawSpan = dataMax - dataMin;

	if (zeroIf > 0) {
		if (minAnchor == null && dataMin >= 0 && atMostWithEpsilon(dataMin, rawSpan * zeroIf))
			minAnchor = 0;
		if (maxAnchor == null && dataMax <= 0 && atMostWithEpsilon(-dataMax, rawSpan * zeroIf))
			maxAnchor = 0;
	}

	// Prefer an explicit max zero over implicit affinity; ties keep the positive fallback.
	if (dataMin == 0 && dataMax == 0 && minAnchor == 0 && maxAnchor == 0) {
		if (softMax === 0 && softMin !== 0)
			minAnchor = null;
		else
			maxAnchor = null;
	}

	return [minAnchor, maxAnchor];
}

export const autoRangePart = {
	pad: rangePad,
};

const _eqRangePart = {
	pad: 0,
};

const _eqRange = {
	zeroIf: rangeZeroIf,
	min: _eqRangePart,
	max: _eqRangePart,
};

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
export function rangeNum(_min, _max, mult, extra) {
	if (isObj(mult))
		return _rangeNum(_min, _max, mult);

	_eqRangePart.pad = mult;
	_eqRange.zeroIf = extra ? rangeZeroIf : 0;

	return _rangeNum(_min, _max, _eqRange);
}

// checks if given index range in an array contains a non-null value
// aka a range-bounded Array.some()
export function hasData(data, idx0, idx1) {
	idx0 ??= 0;
	idx1 ??= data.length - 1;

	while (idx0 <= idx1) {
		if (data[idx0] != null)
			return true;
		idx0++;
	}

	return false;
}

function _rangeNum(_min, _max, cfg) {
	let cmin = cfg.min ?? autoRangePart;
	let cmax = cfg.max ?? autoRangePart;
	let zeroIf = cfg.zeroIf ?? rangeZeroIf;

	if (!isFinite(zeroIf) || zeroIf < 0)
		return [null, null];

	let padMin = cmin.pad ?? rangePad;
	let padMax = cmax.pad ?? rangePad;

	let hardMin = cmin.hard ?? -inf;
	let hardMax = cmax.hard ??  inf;

	let [minAnchor, maxAnchor] = rangeAnchors(_min, _max, cmin.soft, cmax.soft, zeroIf);

	let delta = _max - _min;
	let scalarMax = max(abs(_min), abs(_max));

	let flat = scalarMax * (cfg.flat ?? 1e-7);

	if (delta < 1e-24 || delta <= flat) {
		// Normalize only relatively flat data, so padding does not amplify residue.
		if (delta > 0 && delta <= flat) {
			_min = _max = incrRound(_min + delta / 2, pow10(floor(log10(flat))));
			scalarMax = abs(_min);
		}

		delta = 0;
	}

	let nonZeroDelta = delta || scalarMax || 1e3;
	let mag          = log10(nonZeroDelta);
	let incr         = pow10(floor(mag) - 1);

	let _padMin  = nonZeroDelta * (delta == 0 ? (_min == 0 ? .1 : 1) : padMin);
	let _newMin  = incrRoundDn(_min - _padMin, incr);
	let minLim   = min(hardMax, max(hardMin, minAnchor ?? _newMin));

	let _padMax  = nonZeroDelta * (delta == 0 ? (_max == 0 ? .1 : 1) : padMax);
	let _newMax  = incrRoundUp(_max + _padMax, incr);
	let maxLim   = max(hardMin, min(hardMax, maxAnchor ?? _newMax));

	// Retain a usable range if padding cannot separate the bounds.
	if (minLim == maxLim) {
		if (minLim == 0) {
			if (hardMax == 0) {
				if (hardMin == 0)
					return [null, null];
				minLim = -100;
			}
			else
				maxLim = 100;
		}
		else if (minLim < 0) {
			minLim *= 2;
			maxLim = 0;
		}
		else {
			minLim = 0;
			maxLim *= 2;
		}
	}

	return [max(hardMin, minLim), min(hardMax, maxLim)];
}

// alternative: https://stackoverflow.com/a/2254896
const numFormatter = new Intl.NumberFormat();
export const fmtNum = val => numFormatter.format(val);

const M = Math;

export const rand = M.random;
export const PI = M.PI;
export const abs = M.abs;
export const floor = M.floor;
export const round = M.round;
export const ceil = M.ceil;
export const min = M.min;
export const max = M.max;
export const pow = M.pow;
export const sqrt = M.sqrt;
export const sign = M.sign;
export const log10 = M.log10;
export const log2 = M.log2;
// TODO: seems like this needs to match asinh impl if the passed v is tweaked?
export const sinh =  (v, linthresh = 1) => M.sinh(v) * linthresh;
export const asinh = (v, linthresh = 1) => M.asinh(v / linthresh);

export const inf = Infinity;
export const isFinite = Number.isFinite;

// Canonical powers for the built-in decimal increment range.
const decPows = Array.from({length: 65}, (_, i) => +`1e${i - 32}`);
const pow10 = exp => decPows[exp + 32] ?? +`1e${exp}`;

export function numIntDigits(x) {
	x = abs(x);
	if (x < 10)
		return 1;

	let exp = floor(log10(x));
	return exp + (x < pow10(exp) ? 0 : 1);
}

export function clamp(num, _min, _max) {
	return min(max(num, _min), _max);
}

export function isFn(v) {
	return typeof v == "function";
}

export function fnOrSelf(v) {
	return isFn(v) ? v : () => v;
}

export const noop = () => {};

// note: these identity fns may get deoptimized if reused for different arg types
// a TS version would enforce they stay monotyped and require making variants
export const retArg0 = _0 => _0;

export const retArg1 = (_0, _1) => _1;

export const retNull = _ => null;

export const retTrue = _ => true;

export const retEq = (a, b) => a == b;

function roundIncr(num, incr, mode) {
	let q = num / incr;

	// Finer grids exceed the supported 15-digit rounding budget.
	if (abs(q) >= 1e15)
		return num;

	let dec = fixedDec.get(incr);
	if (dec == null)
		fixedDec.set(incr, dec = guessDec(incr));

	let nearest = round(q);
	let candidate = roundDec(nearest * incr, dec);

	// Correct at most two relative epsilons, capped at 1e-7 of a grid step.
	// The cap prevents large quotients from erasing genuine fractional positions.
	if (candidate == num || abs(candidate - num) <= min(abs(incr) * 1e-7, abs(num) * Number.EPSILON * 2))
		return candidate;

	let index;
	if (mode == roundDec) {
		let whole = floor(abs(q));
		let midpoint = roundDec((whole + 0.5) * abs(incr), dec + 1);
		index = sign(q) * (whole + (abs(num) >= midpoint ? 1 : 0));
	}
	else
		index = mode(q);

	return index == nearest ? candidate : roundDec(index * incr, dec);
}

export function incrRound(num, incr, _fixFloat = true) {
	return _fixFloat ? roundIncr(num, incr, roundDec) : roundDec(num/incr)*incr;
}

export function incrRoundUp(num, incr, _fixFloat = true) {
	return _fixFloat ? roundIncr(num, incr, ceil) : ceil(num/incr)*incr;
}

export function incrRoundDn(num, incr, _fixFloat = true) {
	return _fixFloat ? roundIncr(num, incr, floor) : floor(num/incr)*incr;
}


// Half away from zero, without biasing every value upward by a relative epsilon.
export function roundDec(val, dec = 0) {
	if (isInt(val))
		return val;

	let p = pow10(dec);
	let n = abs(val) * p;

	// Preserve the input beyond the decimal budget; integer rounding still applies.
	if (dec > 0 && (n >= 1e15 || dec > 32))
		return val;

	let int = floor(n);
	let midpoint = (int + 0.5) / p;
	// Decimal conversion can only affect the decision close to a half-step.
	if (dec > 22 && abs(n - int - 0.5) <= n * Number.EPSILON * 2)
		midpoint = +midpoint.toFixed(dec + 1);

	let result = sign(val) * (int + (abs(val) >= midpoint ? 1 : 0)) / p;
	return dec > 22 ? +result.toFixed(dec) : result;
}

// https://stackoverflow.com/questions/14879691/get-number-of-digits-with-javascript/28203456#28203456
export function numDigits(x) {
	return (log10((x ^ (x >> 31)) - (x >> 31)) | 0) + 1;
}

export const fixedDec = new Map();

export function guessDec(num) {
	if (isInt(num))
		return 0;

	let str = "" + num;
	let dot = str.indexOf(".");
	let exp = str.indexOf("e");
	let dec = dot < 0 ? 0 : (exp < 0 ? str.length : exp) - dot - 1;

	return max(0, dec - (exp < 0 ? 0 : +str.slice(exp + 1)));
}

export function numDec(values, incr = 0) {
	let dec = fixedDec.get(incr) ?? guessDec(incr);

	// Values can require finer precision than their increment.
	for (let v of values) {
		if (v != null)
			dec = max(dec, guessDec(v));
	}

	return dec;
}

export function genIncrs(base, minExp, maxExp, mults) {
	let incrs = [];

	let multDec = mults.map(guessDec);

	for (let exp = minExp; exp < maxExp; exp++) {
		let expa = abs(exp);
		let mag = base == 10 ? 0 : pow(base, exp);

		for (let i = 0; i < mults.length; i++) {
			let incr = base == 10 ? +`${mults[i]}e${exp}` : mults[i] * mag;
			let dec = base == 10 ? max(0, multDec[i] - exp) : (exp >= 0 ? 0 : expa) + (exp >= multDec[i] ? 0 : multDec[i]);
			incrs.push(incr);
			fixedDec.set(incr, dec);
		}
	}

	return incrs;
}

//export const assign = Object.assign;

export const EMPTY_OBJ = {};
export const EMPTY_ARR = [];

export const nullNullTuple = [null, null];

export const isArr = Array.isArray;
export const isInt = Number.isInteger;
export const isUndef = v => v === void 0;

export function isStr(v) {
	return typeof v == 'string';
}

export function cmpObj(a, b) {
	for (let k in a) {
		if (b[k] != a[k])
			return false;
	}

	return true;
}

export function isObj(v) {
	let is = false;

	if (v != null) {
		let c = v.constructor;
		is = c == null || c == Object;
	}

	return is;
}

export function fastIsObj(v) {
	return v != null && typeof v == 'object';
}

const TypedArray = Object.getPrototypeOf(Uint8Array);

const __proto__ = "__proto__";

export function copy(o, _isObj = isObj) {
	let out;

	if (isArr(o)) {
		let val = o.find(v => v != null);

		if (isArr(val) || _isObj(val)) {
			out = Array(o.length);
			for (let i = 0; i < o.length; i++)
				out[i] = copy(o[i], _isObj);
		}
		else
			out = o.slice();
	}
	else if (o instanceof TypedArray) // also (ArrayBuffer.isView(o) && !(o instanceof DataView))
		out = o.slice();
	else if (_isObj(o)) {
		out = {};
		for (let k in o) {
			if (k != __proto__)
				out[k] = copy(o[k], _isObj);
		}
	}
	else
		out = o;

	return out;
}

export function assign(targ) {
	let args = arguments;

	for (let i = 1; i < args.length; i++) {
		let src = args[i];

		for (let key in src) {
			if (key != __proto__) {
				if (isObj(targ[key]))
					assign(targ[key], copy(src[key]));
				else
					targ[key] = copy(src[key]);
			}
		}
	}

	return targ;
}

// nullModes
const NULL_REMOVE = 0;  // nulls are converted to undefined (e.g. for spanGaps: true)
const NULL_RETAIN = 1;  // nulls are retained, with alignment artifacts set to undefined (default)
const NULL_EXPAND = 2;  // nulls are expanded to include any adjacent alignment artifacts

// sets undefined values to nulls when adjacent to existing nulls (minesweeper)
function nullExpand(yVals, nullIdxs, alignedLen) {
	for (let i = 0, xi, lastNullIdx = -1; i < nullIdxs.length; i++) {
		let nullIdx = nullIdxs[i];

		if (nullIdx > lastNullIdx) {
			xi = nullIdx - 1;
			while (xi >= 0 && yVals[xi] == null)
				yVals[xi--] = null;

			xi = nullIdx + 1;
			while (xi < alignedLen && yVals[xi] == null)
				yVals[lastNullIdx = xi++] = null;
		}
	}
}

function mergeXVals(tables) {
	let xRows = tables.map(t => t[0]);

	while (xRows.length > 1) {
		let merged = [];

		for (let ti = 0; ti < xRows.length; ti += 2) {
			if (ti == xRows.length - 1) {
				merged.push(xRows[ti]);
				continue;
			}

			let xs0 = xRows[ti];
			let xs1 = xRows[ti + 1];
			let xs = [];
			let i0 = 0;
			let i1 = 0;

			while (i0 < xs0.length && i1 < xs1.length) {
				if (xs0[xs0.length - 1] < xs1[i1]) {
					while (i0 < xs0.length)
						xs.push(xs0[i0++]);
					break;
				}

				if (xs1[xs1.length - 1] < xs0[i0]) {
					while (i1 < xs1.length)
						xs.push(xs1[i1++]);
					break;
				}

				let x0 = xs0[i0];
				let x1 = xs1[i1];

				if (x0 < x1) {
					xs.push(x0);
					i0++;
				}
				else if (x0 > x1) {
					xs.push(x1);
					i1++;
				}
				else {
					xs.push(x0);
					i0++;
					i1++;
				}
			}

			while (i0 < xs0.length)
				xs.push(xs0[i0++]);

			while (i1 < xs1.length)
				xs.push(xs1[i1++]);
			merged.push(xs);
		}

		xRows = merged;
	}

	return xRows[0] ?? [];
}


// nullModes is a tables-matched array indicating how to treat nulls in each series
// input join fields (table[0]) are sampled for ASC order and sorted when needed
// output is sorted ASC and matching join values across tables are collapsed
export function join(tables, nullModes) {
	if (allHeadersSame(tables)) {
	//	console.log('cheap join!');

		let table = tables[0].slice();

		for (let i = 1; i < tables.length; i++)
			table.push(...tables[i].slice(1));

		if (!isAsc(table[0]))
			table = sortCols(table);

		return table;
	}

	tables = tables.map(table => isAsc(table[0]) ? table : sortCols(table));

	let aligned = mergeXVals(tables);

	let xIdxs = new Map();

	for (let i = 0; i < aligned.length; i++)
		xIdxs.set(aligned[i], i);

	let data = [aligned];
	let alignedLen = aligned.length;

	for (let ti = 0; ti < tables.length; ti++) {
		let t = tables[ti];
		let xs = t[0];
		let alignedIdxs = t.length > 2 ? Array(xs.length) : null;

		if (alignedIdxs != null) {
			for (let i = 0; i < xs.length; i++)
				alignedIdxs[i] = xIdxs.get(xs[i]);
		}

		for (let si = 1; si < t.length; si++) {
			let ys = t[si];

			let yVals = Array(alignedLen).fill(undefined);

			let nullMode = nullModes ? nullModes[ti][si] : NULL_RETAIN;

			let nullIdxs = [];

			for (let i = 0; i < ys.length; i++) {
				let yVal = ys[i];
				let alignedIdx = alignedIdxs == null ? xIdxs.get(xs[i]) : alignedIdxs[i];

				if (yVal === null) {
					if (nullMode != NULL_REMOVE) {
						yVals[alignedIdx] = yVal;

						if (nullMode == NULL_EXPAND)
							nullIdxs.push(alignedIdx);
					}
				}
				else
					yVals[alignedIdx] = yVal;
			}

			nullExpand(yVals, nullIdxs, alignedLen);

			data.push(yVals);
		}
	}

	return data;
}

export const microTask = typeof queueMicrotask == "undefined" ? fn => Promise.resolve().then(fn) : queueMicrotask;

// TODO: https://github.com/dy/sort-ids (~2x faster for 1e5+ arrays)
function sortCols(table) {
	let head = table[0];
	let rlen = head.length;

	let idxs = Array(rlen);
	for (let i = 0; i < idxs.length; i++)
		idxs[i] = i;

	idxs.sort((i0, i1) => head[i0] - head[i1]);

	let table2 = [];
	for (let i = 0; i < table.length; i++) {
		let row = table[i];
		let row2 = Array(rlen);

		for (let j = 0; j < rlen; j++)
			row2[j] = row[idxs[j]];

		table2.push(row2);
	}

	return table2;
}

// test if we can do cheap join (all join fields same)
function allHeadersSame(tables) {
	let vals0 = tables[0][0];
	let len0 = vals0.length;

	for (let i = 1; i < tables.length; i++) {
		let vals1 = tables[i][0];

		if (vals1.length != len0)
			return false;

		if (vals1 != vals0) {
			for (let j = 0; j < len0; j++) {
				if (vals1[j] != vals0[j])
					return false;
			}
		}
	}

	return true;
}

function isAsc(vals, samples = 100) {
	const len = vals.length;

	// empty or single value
	if (len <= 1)
		return true;

	// skip leading & trailing nullish
	let firstIdx = 0;
	let lastIdx = len - 1;

	while (firstIdx <= lastIdx && vals[firstIdx] == null)
		firstIdx++;

	while (lastIdx >= firstIdx && vals[lastIdx] == null)
		lastIdx--;

	// all nullish or one value surrounded by nullish
	if (lastIdx <= firstIdx)
		return true;

	const stride = max(1, floor((lastIdx - firstIdx + 1) / samples));

	for (let prevVal = vals[firstIdx], i = firstIdx + stride; i <= lastIdx; i += stride) {
		const v = vals[i];

		if (v != null) {
			if (v <= prevVal)
				return false;

			prevVal = v;
		}
	}

	return true;
}