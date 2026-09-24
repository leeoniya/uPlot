/**
* Copyright (c) 2026, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* uPlot.js (μPlot)
* A small, fast chart for time series, lines, areas, ohlc & bars
* https://github.com/leeoniya/uPlot (v1.6.32)
*/

'use strict';

const FEAT_TIME          = true;

const FEAT_POINTS        = true;

// binary search for index of closest value
function closestIdx(num, arr, lo, hi) {
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

const nonNullIdxs = makeIndexOfs(notNullish);
const positiveIdxs = makeIndexOfs(isPositive);

function getMinMax(data, _i0, _i1, sorted = 0, log = false) {
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

function rangeLog(min, max, base, fullMags) {
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

	let minLogAbs = logFn(abs(min));
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

function rangeAsinh(min, max, base, fullMags) {
	let minMax = rangeLog(min, max, base, fullMags);

	if (min == 0)
		minMax[0] = 0;

	if (max == 0)
		minMax[1] = 0;

	return minMax;
}

const rangePad = 0.1;
const rangeZeroIf = 0.1;

function atMostWithEpsilon(value, limit) {
	return value <= limit || value - limit <= max(abs(value), abs(limit)) * Number.EPSILON * 2;
}

function rangeAnchors(dataMin, dataMax, softMin, softMax, zeroIf = rangeZeroIf) {
	zeroIf ??= rangeZeroIf;

	if (!isFinite$1(zeroIf) || zeroIf < 0)
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

const autoRangePart = {
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
function rangeNum(_min, _max, mult, extra) {
	if (isObj(mult))
		return _rangeNum(_min, _max, mult);

	_eqRangePart.pad = mult;
	_eqRange.zeroIf = extra ? rangeZeroIf : 0;

	return _rangeNum(_min, _max, _eqRange);
}

// checks if given index range in an array contains a non-null value
// aka a range-bounded Array.some()
function hasData(data, idx0, idx1) {
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

	if (!isFinite$1(zeroIf) || zeroIf < 0)
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
const fmtNum = val => numFormatter.format(val);

const M = Math;

const rand = M.random;
const PI = M.PI;
const abs = M.abs;
const floor = M.floor;
const round = M.round;
const ceil = M.ceil;
const min = M.min;
const max = M.max;
const pow = M.pow;
const sign = M.sign;
const log10 = M.log10;
const log2 = M.log2;
// TODO: seems like this needs to match asinh impl if the passed v is tweaked?
const sinh =  (v, linthresh = 1) => M.sinh(v) * linthresh;
const asinh = (v, linthresh = 1) => M.asinh(v / linthresh);

const inf = Infinity;
const isFinite$1 = Number.isFinite;

// Canonical powers for the built-in decimal increment range.
const decPows = Array.from({length: 65}, (_, i) => +`1e${i - 32}`);
const pow10 = exp => decPows[exp + 32] ?? +`1e${exp}`;

function numIntDigits(x) {
	x = abs(x);
	if (x < 10)
		return 1;

	let exp = floor(log10(x));
	return exp + (x < pow10(exp) ? 0 : 1);
}

function clamp(num, _min, _max) {
	return min(max(num, _min), _max);
}

function isFn(v) {
	return typeof v == "function";
}

function fnOrSelf(v) {
	return isFn(v) ? v : () => v;
}

const noop = () => {};

// note: these identity fns may get deoptimized if reused for different arg types
// a TS version would enforce they stay monotyped and require making variants
const retArg0 = _0 => _0;

const retArg1 = (_0, _1) => _1;

const retNull = _ => null;

const retTrue = _ => true;

const retEq = (a, b) => a == b;

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

function incrRound(num, incr, _fixFloat = true) {
	return _fixFloat ? roundIncr(num, incr, roundDec) : roundDec(num/incr)*incr;
}

function incrRoundUp(num, incr, _fixFloat = true) {
	return _fixFloat ? roundIncr(num, incr, ceil) : ceil(num/incr)*incr;
}

function incrRoundDn(num, incr, _fixFloat = true) {
	return _fixFloat ? roundIncr(num, incr, floor) : floor(num/incr)*incr;
}


// Half away from zero, without biasing every value upward by a relative epsilon.
function roundDec(val, dec = 0) {
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

const fixedDec = new Map();

function guessDec(num) {
	if (isInt(num))
		return 0;

	let str = "" + num;
	let dot = str.indexOf(".");
	let exp = str.indexOf("e");
	let dec = dot < 0 ? 0 : (exp < 0 ? str.length : exp) - dot - 1;

	return max(0, dec - (exp < 0 ? 0 : +str.slice(exp + 1)));
}

function numDec(values, incr = 0) {
	let dec = fixedDec.get(incr) ?? guessDec(incr);

	// Values can require finer precision than their increment.
	for (let v of values) {
		if (v != null)
			dec = max(dec, guessDec(v));
	}

	return dec;
}

function genIncrs(base, minExp, maxExp, mults) {
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

const EMPTY_OBJ = {};
const EMPTY_ARR = [];

const nullNullTuple = [null, null];

const isArr = Array.isArray;
const isInt = Number.isInteger;
const isUndef = v => v === void 0;

function isStr(v) {
	return typeof v == 'string';
}

function isObj(v) {
	let is = false;

	if (v != null) {
		let c = v.constructor;
		is = c == null || c == Object;
	}

	return is;
}

function fastIsObj(v) {
	return v != null && typeof v == 'object';
}

const TypedArray = Object.getPrototypeOf(Uint8Array);

const __proto__ = "__proto__";

function copy(o, _isObj = isObj) {
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

function assign(targ) {
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
function join(tables, nullModes) {
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

const microTask = typeof queueMicrotask == "undefined" ? fn => Promise.resolve().then(fn) : queueMicrotask;

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

const WIDTH       = "width";
const HEIGHT      = "height";
const TOP         = "top";
const BOTTOM      = "bottom";
const LEFT        = "left";
const RIGHT       = "right";
const hexBlack    = "#000";
const transparent = hexBlack + "0";

const mousemove   = "mousemove";
const mousedown   = "mousedown";
const mouseup     = "mouseup";
const mouseenter  = "mouseenter";
const mouseleave  = "mouseleave";
const dblclick    = "dblclick";
const resize      = "resize";
const scroll      = "scroll";

const change      = "change";
const dppxchange  = "dppxchange";

const LEGEND_DISP = "--";

const pre = "u-";

const UPLOT          =       "uplot";
const ORI_HZ         = pre + "hz";
const ORI_VT         = pre + "vt";
const TITLE          = pre + "title";
const WRAP           = pre + "wrap";
const UNDER          = pre + "under";
const OVER           = pre + "over";
const AXIS           = pre + "axis";
const OFF            = pre + "off";
const SELECT         = pre + "select";
const CURSOR_X       = pre + "cursor-x";
const CURSOR_Y       = pre + "cursor-y";
const CURSOR_PT      = pre + "cursor-pt";
const LEGEND         = pre + "legend";
const LEGEND_LIVE    = pre + "live";
const LEGEND_INLINE  = pre + "inline";
const LEGEND_SERIES  = pre + "series";
const LEGEND_MARKER  = pre + "marker";
const LEGEND_LABEL   = pre + "label";
const LEGEND_VALUE   = pre + "value";

const domEnv = typeof window != 'undefined';

const doc = domEnv ? document  : null;
const win = domEnv ? window    : null;

let pxRatio;

//export const canHover = domEnv && !win.matchMedia('(hover: none)').matches;

let query;

function setPxRatio() {
	let _pxRatio = devicePixelRatio;

	// during print preview, Chrome fires off these dppx queries even without changes
	if (pxRatio != _pxRatio) {
		pxRatio = _pxRatio;

		query && off(change, query, setPxRatio);
		query = matchMedia(`(min-resolution: ${pxRatio - 0.001}dppx) and (max-resolution: ${pxRatio + 0.001}dppx)`);
		on(change, query, setPxRatio);

		win.dispatchEvent(new CustomEvent(dppxchange));
	}
}

function addClass(el, c) {
	if (c != null) {
		let cl = el.classList;
		!cl.contains(c) && cl.add(c);
	}
}

function remClass(el, c) {
	let cl = el.classList;
	cl.contains(c) && cl.remove(c);
}

function setStylePx(el, name, value) {
	el.style[name] = value + "px";
}

function placeTag(tag, cls, targ, refEl) {
	let el = doc.createElement(tag);

	if (cls != null)
		addClass(el, cls);

	targ?.insertBefore(el, refEl);

	return el;
}

function placeDiv(cls, targ) {
	return placeTag("div", cls, targ);
}

const xformCache = new WeakMap();

function elTrans(el, xPos, yPos, xMax, yMax, off) {
	let xform = "translate(" + xPos + "px," + yPos + "px)";
	let xformOld = xformCache.get(el);

	if (xform != xformOld) {
		el.style.transform = xform;
		xformCache.set(el, xform);
	}

	if (xform != xformOld || off != null) {
		if (off ?? (xPos < 0 || yPos < 0 || xPos > xMax || yPos > yMax))
			addClass(el, OFF);
		else
			remClass(el, OFF);
	}
}

const colorCache = new WeakMap();

function elColor(el, background, borderColor) {
	let newColor = background + borderColor;
	let oldColor = colorCache.get(el);

	if (newColor != oldColor) {
		colorCache.set(el, newColor);
		el.style.background = background;
		el.style.borderColor = borderColor;
	}
}

const sizeCache = new WeakMap();

function elSize(el, newWid, newHgt, centered) {
	let newSize = newWid + "" + newHgt;
	let oldSize = sizeCache.get(el);

	if (newSize != oldSize) {
		sizeCache.set(el, newSize);
		el.style.height = newHgt + "px";
		el.style.width = newWid + "px";
		el.style.marginLeft = centered ? -newWid/2 + "px" : 0;
		el.style.marginTop = centered ? -newHgt/2 + "px" : 0;
	}
}

const evOpts = {passive: true};
const evOpts2 = {...evOpts, capture: true};

function on(ev, el, cb, capt) {
	el.addEventListener(ev, cb, capt ? evOpts2 : evOpts);
}

function off(ev, el, cb, capt) {
	el.removeEventListener(ev, cb, evOpts);
}

domEnv && setPxRatio();

const months = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const days = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

function slice3(str) {
	return str.slice(0, 3);
}

const days3 = days.map(slice3);

const months3 = months.map(slice3);

const engNames = {
	MMMM: months,
	MMM:  months3,
	WWWW: days,
	WWW:  days3,
};

function zeroPad2(int) {
	return (int < 10 ? '0' : '') + int;
}

function zeroPad3(int) {
	return (int < 10 ? '00' : int < 100 ? '0' : '') + int;
}

/*
function suffix(int) {
	let mod10 = int % 10;

	return int + (
		mod10 == 1 && int != 11 ? "st" :
		mod10 == 2 && int != 12 ? "nd" :
		mod10 == 3 && int != 13 ? "rd" : "th"
	);
}
*/

const subs = {
	// 2019
	YYYY:	d => d.getFullYear(),
	// 19
	YY:		d => (d.getFullYear()+'').slice(2),
	// July
	MMMM:	(d, names) => names.MMMM[d.getMonth()],
	// Jul
	MMM:	(d, names) => names.MMM[d.getMonth()],
	// 07
	MM:		d => zeroPad2(d.getMonth()+1),
	// 7
	M:		d => d.getMonth()+1,
	// 09
	DD:		d => zeroPad2(d.getDate()),
	// 9
	D:		d => d.getDate(),
	// Monday
	WWWW:	(d, names) => names.WWWW[d.getDay()],
	// Mon
	WWW:	(d, names) => names.WWW[d.getDay()],
	// 03
	HH:		d => zeroPad2(d.getHours()),
	// 3
	H:		d => d.getHours(),
	// 9 (12hr, unpadded)
	h:		d => {let h = d.getHours(); return h == 0 ? 12 : h > 12 ? h - 12 : h;},
	// AM
	AA:		d => d.getHours() >= 12 ? 'PM' : 'AM',
	// am
	aa:		d => d.getHours() >= 12 ? 'pm' : 'am',
	// a
	a:		d => d.getHours() >= 12 ? 'p' : 'a',
	// 09
	mm:		d => zeroPad2(d.getMinutes()),
	// 9
	m:		d => d.getMinutes(),
	// 09
	ss:		d => zeroPad2(d.getSeconds()),
	// 9
	s:		d => d.getSeconds(),
	// 374
	fff:	d => zeroPad3(d.getMilliseconds()),

	/*
	// this really only makes sense for DateZoned
	// -05:00
	tzo:    d => {
		let o = d.getTimezoneOffset();
		let s = o > 0 ? '-' : '+';
		o = abs(o);
		let hh = zeroPad2(floor(o / 60));
		let mm = zeroPad2(o % 60);
		return `${s}${hh}:${mm}`;
	}
	*/
};

// export const iso8601 = fmtDate('{YYYY}-{MM}-{DD}T{HH}:{mm}:{ss}.{fff}{tzo}');

function fmtDate(tpl, names) {
	names = names || engNames;
	let parts = [];

	let R = /\{([a-z]+)\}|[^{]+/gi, m;

	while (m = R.exec(tpl))
		parts.push(m[0][0] == '{' ? subs[m[1]] : m[0]);

	return d => {
		let out = '';

		for (let i = 0; i < parts.length; i++)
			out += typeof parts[i] == "string" ? parts[i] : parts[i](d, names);

		return out;
	}
}

const localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;

function tzDate(dateOrTs, tz) {
	if (tz == null || tz == localTz)
		return typeof dateOrTs == 'number' ? new Date(dateOrTs) : dateOrTs;

	let d = new DateZoned(dateOrTs);
	d.setTimeZone(tz);
	return d;
}

const twoDigit = '2-digit';

const fmtrOpts = {
    weekday: "short",
    year: 'numeric',
    month: twoDigit,
    day: twoDigit,
    hour: twoDigit,
    minute: twoDigit,
    second: twoDigit,
    fractionalSecondDigits: 3,
    timeZoneName: 'longOffset',
};

/*
// this might be a bit easier to parse to avoid negative .slice() offsets
new Intl.DateTimeFormat('en-US', {
	hour12: false,
	timeZone: 'Europe/London',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	timeZoneName: 'longOffset',
	weekday: 'short',
	fractionalSecondDigits: 3,
}).format(new Date());

// Tue, 07/22/2025, 07:02:37.043 GMT+01:00
*/

const tzFmt = {};

function getFormatter(tz) {
    return tzFmt[tz] ??= new Intl.DateTimeFormat("sv", {...fmtrOpts, timeZone: tz}).format;
}

class DateZoned extends Date {
	tz = null;
	#utc = false;
	// sön, 1972-10-15 17:25:23,434 GMT+01:00
    #str = null;

	constructor(...args) {
		super(...args);

		if (args[0] instanceof DateZoned) {
			this.tz  = args[0].tz;
			this.#str = args[0].#str;
			this.#utc = args[0].#utc;
		}
	}

    #get(utcMeth, locMeth, fr, to, add = 0) {
        let s = this.#str;
        return this.#utc ? utcMeth.call(this) : s == null ? locMeth.call(this) : Number(s.slice(fr,to)) + add;
    }

    setTimeZone(tz) {
		this.tz = tz;

        if (tz == 'UTC' || tz == 'Etc/UTC')
            this.#utc = true;
        else {
            let fmt = getFormatter(tz);
			let f = fmt(this);

            if (f.endsWith('GMT'))
                f += '+00:00';

            this.#str = f;
        }
    }

	getFullYear() {
        return this.#get(this.getUTCFullYear, super.getFullYear, -33, -29);
    }

	getMonth() {
        return this.#get(this.getUTCMonth, super.getMonth, -28, -26, -1);
    }

	getDate() {
        return this.#get(this.getUTCDate, super.getDate, -25, -23);
    }

	getHours() {
        return this.#get(this.getUTCHours, super.getHours, -22, -20);
    }

	getMinutes() {
        return this.#get(this.getUTCMinutes, super.getMinutes, -19, -17);
    }

	getSeconds() {
        return this.#get(this.getUTCSeconds, super.getSeconds, -16, -14);
    }

	getMilliseconds() {
        return this.#get(this.getUTCMilliseconds, super.getMilliseconds, -13, -10);
    }

	getDay() {
		let s = this.#str;
        return this.#utc ? this.getUTCDay() : s == null ? super.getDay() : (
			s[0] == 's' ? 0 : // sön
			s[0] == 'm' ? 1 : // mån
			s[1] == 'i' ? 2 : // tis
			s[0] == 'o' ? 3 : // ons
			s[1] == 'o' ? 4 : // tors
			s[0] == 'f' ? 5 : // fre
			s[0] == 'l' ? 6 : // lör
			-1
		);
    }

    getTimezoneOffset() {
        let s = this.#str;
        return this.#utc ? 0 : s == null ? super.getTimezoneOffset() : (60 * Number(s.slice(-5,-3)) + Number(s.slice(-2))) * (s.at(-6) == '-' ? -1 : 1);
    }
}

function getDayOfYear(date) {
	let y = date.getFullYear();
	let m = date.getMonth() + 1;
	let d = date.getDate();

	// https://stackoverflow.com/a/27790471
	return --m*31-(m>1?(1054267675>>m*3-6&7)-(y&3||!(y%25)&&y&15?0:1):0)+d;
}

// these can be done through just incrRoundDn of 1e3 or 60 * 1e3
// export const PERIOD_SECOND = 0;
// export const PERIOD_MINUTE = 1;

// this might be needed for tzs where DST is not whole hours?
// otherwise incrRoundDn of 3600 * 1e3
// export const PERIOD_HOUR = 2;

// thse need special handling due to day length changing due to DST
const PERIOD_DAY = 3;
const PERIOD_MONTH = 4;
const PERIOD_YEAR = 5;
// export const PERIOD_WEEK;

// get start of period, requires DateZoned and period const
function floorSOP(dz, per) {
	let ts = dz.getTime();

	// initial guess (assumes no DST)
	let ts2 = ts - (
		dz.getMilliseconds()       +
		dz.getSeconds()      * 1e3 +
		dz.getMinutes() * 60 * 1e3 +
		dz.getHours() * 3600 * 1e3 +
		(
			(
				per == PERIOD_MONTH ? dz.getDate() - 1:
				per == PERIOD_YEAR  ? getDayOfYear(dz) - 1:
				0
			)
			* 24 * 3600 * 1e3
		)
	);

	// if (ts2 == ts)
		// return dz;

	let dz2 = new DateZoned(ts2);
	dz2.setTimeZone(dz.tz);

	let h2 = dz2.getHours();

	// we want hours to be 0
	if (h2 > 0) {
		let dstAdj = h2 > 12 ? 24 - h2 : -h2;
		dz2 = new DateZoned(ts2 + dstAdj * 3600 * 1e3);
		dz2.setTimeZone(dz.tz);
	}

	return dz2;
}

// tweaks the time by +/- 1hr to make sure it lands on 12am
// used for correcting optimistically-computed ticks from adding fixed increments
// export function sopNear(dz, per) {}

/*
let fmt = fmtDate('{YYYY}-{MM}-{DD}T{HH}:{mm}:{ss}.{fff}{tzo}');

{
	let d = new DateZoned(1554274800000); // post-roll date
	d.setTimeZone('Europe/London');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}

{
	let d = new DateZoned(1554274800000); // post-roll date
	d.setTimeZone('America/Chicago');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}

{
	let d = new DateZoned(1554004800000); // few hours after london spring forward
	d.setTimeZone('Europe/London');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}

{
	let d = new DateZoned(1572156000000); // few hours after london fall back
	d.setTimeZone('Europe/London');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}
*/


/*
TODO:

2024 - leap year
  start of year before feb vs after
  start of month in dst fwd month / bwd month
  start of day in dst fwd day / bwd day

Australia/Darwin
*/

//export const series = [];

// default formatters:

const onlyWhole = v => v % 1 == 0;

const allMults = [1,2,2.5,5];

// ...0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5
const decIncrs = genIncrs(10, -32, 0, allMults);

// 1, 2, 2.5, 5, 10, 20, 25, 50...
const oneIncrs = genIncrs(10, 0, 32, allMults);

// 1, 2,      5, 10, 20, 25, 50...
const wholeIncrs = oneIncrs.filter(onlyWhole);

const numIncrs = decIncrs.concat(oneIncrs);

const NL = "\n";

const yyyy    = "{YYYY}";
const NLyyyy  = NL + yyyy;
const md      = "{M}/{D}";
const NLmd    = NL + md;
const NLmdyy  = NLmd + "/{YY}";

const aa      = "{aa}";
const hmm     = "{h}:{mm}";
const hmmaa   = hmm + aa;
const NLhmmaa = NL + hmmaa;
const ss      = ":{ss}";

const _ = null;

function genTimeStuffs(ms) {
	let	s  = ms * 1e3,
		m  = s  * 60,
		h  = m  * 60,
		d  = h  * 24,
		mo = d  * 30,
		y  = d  * 365;

	// min of 1e-3 prevents setting a temporal x ticks too small since Date objects cannot advance ticks smaller than 1ms
	let subSecIncrs = ms == 1 ? genIncrs(10, 0, 3, allMults).filter(onlyWhole) : genIncrs(10, -3, 0, allMults);

	let timeIncrs = subSecIncrs.concat([
		// minute divisors (# of secs)
		s,
		s * 5,
		s * 10,
		s * 15,
		s * 30,
		// hour divisors (# of mins)
		m,
		m * 5,
		m * 10,
		m * 15,
		m * 30,
		// day divisors (# of hrs)
		h,
		h * 2,
		h * 3,
		h * 4,
		h * 6,
		h * 8,
		h * 12,
		// month divisors TODO: need more?
		d,
		d * 2,
		d * 3,
		d * 4,
		d * 5,
		d * 6,
		d * 7,
		d * 8,
		d * 9,
		d * 10,
		d * 15,
		// year divisors (# months, approx)
		mo,
		mo * 2,
		mo * 3,
		mo * 4,
		mo * 6,
		// century divisors
		y,
		y * 2,
		y * 5,
		y * 10,
		y * 25,
		y * 50,
		y * 100,
	]);

	// [0]:   minimum num secs in the tick incr
	// [1]:   default tick format
	// [2-7]: rollover tick formats
	// [8]:   mode: 0: replace [1] -> [2-7], 1: concat [1] + [2-7]
	const _timeAxisStamps = [
	//   tick incr    default          year                    month   day                   hour    min       sec   mode
		[y,           yyyy,            _,                      _,      _,                    _,      _,        _,       1],
		[d * 28,      "{MMM}",         NLyyyy,                 _,      _,                    _,      _,        _,       1],
		[d,           md,              NLyyyy,                 _,      _,                    _,      _,        _,       1],
		[h,           "{h}" + aa,      NLmdyy,                 _,      NLmd,                 _,      _,        _,       1],
		[m,           hmmaa,           NLmdyy,                 _,      NLmd,                 _,      _,        _,       1],
		[s,           ss,              NLmdyy + " " + hmmaa,   _,      NLmd + " " + hmmaa,   _,      NLhmmaa,  _,       1],
		[ms,          ss + ".{fff}",   NLmdyy + " " + hmmaa,   _,      NLmd + " " + hmmaa,   _,      NLhmmaa,  _,       1],
	];

	// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
	// https://www.timeanddate.com/time/dst/
	// https://www.timeanddate.com/time/dst/2019.html
	// https://www.epochconverter.com/timezones
	function timeAxisSplits(tzDate) {
		return (self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
			let nice = self.axes[axisIdx].nice;
			let splits = [];
			let isYr = foundIncr >= y;
			let isMo = foundIncr >= mo && foundIncr < y;
			let isDays = foundIncr >= d && foundIncr < mo;
			let isHours = foundIncr > h && foundIncr < d;

			// get the timezone-adjusted date
			let minDate = tzDate(scaleMin);
			let minDateTs = roundDec(minDate * ms, 3);

			// get ts of 12am (this lands us at or before the original scaleMin)
			let minMin = floorSOP(minDate, isYr || isMo ? PERIOD_YEAR : isDays ? PERIOD_MONTH : PERIOD_DAY); // should we do PERIOD_HOUR?
			let minMinTs = roundDec(minMin * ms, 3);

			if (isDays) {
				let incrDays = foundIncr / d;

				// incrs to add to month baseline
				let skip = floor((minDate.getDate() - 1) / incrDays);
				let split = minMinTs + (foundIncr * skip);

				do {
					let date = tzDate(split);
					// adjust for DST misses
					let hour = date.getHours();
					if (hour != 0) {
						split += hour > 12 ? h : -h;
						date = tzDate(split);
					}

					// rolled over into next month onto non-divisible incr, reset baseline
					if (nice.first && (date.getDate() - 1) % incrDays > 0) {
						date = floorSOP(date, PERIOD_MONTH);
						split = date.getTime() * ms;

						// make sure we're not rendering a collision between 31 and 1
						if (split - splits[splits.length - 1] < foundIncr * 0.7)
							splits.pop();
					}

					if (split > scaleMax)
						break;

					if (split >= scaleMin)
						splits.push(split);

					split += foundIncr;
				} while (1);
			}
			else if (isMo || isYr) {
				let subIncrs = 1;
				let subIncrDays = 1;
				let periodType = 0;
				let periodMin = 0;

				if (isMo) {
					subIncrs = foundIncr / mo;
					subIncrDays = 32;
					periodType = PERIOD_MONTH;
					periodMin = minDate.getMonth();
				}
				else if (isYr) {
					subIncrs = foundIncr / y;
					subIncrDays = 366;
					periodType = PERIOD_YEAR;
					periodMin = minDate.getYear();
				}

				foundIncr = subIncrs * subIncrDays * d;

				let skip = floor(periodMin / subIncrDays);
				let split = minMinTs + (foundIncr * skip);

				do {
					let date = floorSOP(tzDate(split), periodType);
					split = date.getTime() * ms;

					if (split > scaleMax)
						break;

					if (split >= scaleMin)
						splits.push(split);

					split += foundIncr;
				} while (1);
			}
			else if (isHours) {
				let incrHours = foundIncr / h;

				let skip = floor(minDate.getHours() / incrHours);
				let split = minMinTs + (foundIncr * skip);

				do {
					let date = tzDate(split);

					// adjust for DST misses
					let hour = date.getHours();
					if (nice.dst && hour % incrHours > 0) {
						let hour2 = tzDate(split - h).getHours();
						split += hour2 % incrHours == 0 ? -h : h;
					}

					if (split > scaleMax)
						break;

					if (split >= scaleMin)
						splits.push(split);

					split += foundIncr;
				} while (1);
			}
			else {
				let split = minMinTs + incrRoundUp(minDateTs - minMinTs, foundIncr);

				do {
					if (split > scaleMax)
						break;

					if (split >= scaleMin)
						splits.push(split);

					split += foundIncr;
				} while (1);
			}

			return splits;
		}
	}

	return [
		timeIncrs,
		_timeAxisStamps,
		timeAxisSplits,
	];
}

const [ timeIncrsMs, _timeAxisStampsMs, timeAxisSplitsMs ] = genTimeStuffs(1);
const [ timeIncrsS,  _timeAxisStampsS,  timeAxisSplitsS  ] = genTimeStuffs(1e-3);

// base 2
genIncrs(2, -53, 53, [1]);

/*
console.log({
	decIncrs,
	oneIncrs,
	wholeIncrs,
	numIncrs,
	timeIncrs,
	fixedDec,
});
*/

function timeAxisStamps(stampCfg, fmtDate) {
	return stampCfg.map(s => s.map((v, i) =>
		i == 0 || i == 8 || v == null ? v : fmtDate(i == 1 || s[8] == 0 ? v : s[1] + v)
	));
}

// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
function timeAxisVals(tzDate, stamps) {
	return (self, splits, axisIdx, foundSpace, foundIncr) => {
		let s = stamps.find(s => foundIncr >= s[0]) || stamps[stamps.length - 1];

		// these track boundaries when a full label is needed again
		let prevYear;
		let prevMnth;
		let prevDate;
		let prevHour;
		let prevMins;
		let prevSecs;

		return splits.map(split => {
			let date = tzDate(split);

			let newYear = date.getFullYear();
			let newMnth = date.getMonth();
			let newDate = date.getDate();
			let newHour = date.getHours();
			let newMins = date.getMinutes();
			let newSecs = date.getSeconds();

			let stamp = (
				newYear != prevYear && s[2] ||
				newMnth != prevMnth && s[3] ||
				newDate != prevDate && s[4] ||
				newHour != prevHour && s[5] ||
				newMins != prevMins && s[6] ||
				newSecs != prevSecs && s[7] ||
				                       s[1]
			);

			prevYear = newYear;
			prevMnth = newMnth;
			prevDate = newDate;
			prevHour = newHour;
			prevMins = newMins;
			prevSecs = newSecs;

			return stamp(date);
		});
	}
}

// for when axis.values is defined as a static fmtDate template string
function timeAxisVal(tzDate, dateTpl) {
	let stamp = fmtDate(dateTpl);
	return (self, splits, axisIdx, foundSpace, foundIncr) => splits.map(split => stamp(tzDate(split)));
}

function timeSeriesStamp(stampCfg, fmtDate) {
	return fmtDate(stampCfg);
}
const _timeSeriesStamp = '{YYYY}-{MM}-{DD} {h}:{mm}{aa}';

function timeSeriesVal(tzDate, stamp) {
	return (self, val, seriesIdx, dataIdx) => dataIdx == null ? LEGEND_DISP : stamp(tzDate(val));
}

function legendStroke(self, seriesIdx) {
	let s = self.series[seriesIdx];
	return s.width ? s.stroke(self, seriesIdx) : s.points.width ? s.points.stroke(self, seriesIdx) : null;
}

function legendFill(self, seriesIdx) {
	return self.series[seriesIdx].fill(self, seriesIdx);
}

const legendOpts = {
	show: true,
	live: true,
	isolate: false,
	mount: noop,
	markers: {
		show: true,
		width: 2,
		stroke: legendStroke,
		fill: legendFill,
		dash: "solid",
	},
	idx: null,
	idxs: null,
	values: [],
};

function cursorPointShow(self, si) {
	let o = self.cursor.points;

	let pt = placeDiv();

	let size = o.size(self, si);
	setStylePx(pt, WIDTH, size);
	setStylePx(pt, HEIGHT, size);

	let mar = size / -2;
	setStylePx(pt, "marginLeft", mar);
	setStylePx(pt, "marginTop", mar);

	let width = o.width(self, si, size);
	width && setStylePx(pt, "borderWidth", width);

	return pt;
}

function cursorPointFill(self, si) {
	let sp = self.series[si].points;
	return sp._fill || sp._stroke;
}

function cursorPointStroke(self, si) {
	let sp = self.series[si].points;
	return sp._stroke || sp._fill;
}

function cursorPointSize(self, si) {
	let sp = self.series[si].points;
	return sp.size;
}

const moveTuple = [0,0];

function cursorMove(self, mouseLeft1, mouseTop1) {
	moveTuple[0] = mouseLeft1;
	moveTuple[1] = mouseTop1;
	return moveTuple;
}

function filtBtn0(self, targ, handle, onlyTarg = true) {
	return e => {
		e.button == 0 && (!onlyTarg || e.target == targ) && handle(e);
	};
}

function filtTarg(self, targ, handle, onlyTarg = true) {
	return e => {
		(!onlyTarg || e.target == targ) && handle(e);
	};
}

const cursorOpts = {
	show: true,
	x: true,
	y: true,
	lock: false,
	move: cursorMove,
	points: {
		one:    false,
		show:   cursorPointShow,
		size:   cursorPointSize,
		width:  0,
		stroke: cursorPointStroke,
		fill:   cursorPointFill,
	},

	bind: {
		mousedown:   filtBtn0,
		mouseup:     filtBtn0,
		click:       filtBtn0, // legend clicks, not .u-over clicks
		dblclick:    filtBtn0,

		mousemove:   filtTarg,
		mouseleave:  filtTarg,
		mouseenter:  filtTarg,
	},

	drag: {
		setRange: true,
		setScale: null,
		x: true,
		y: false,
		dist: 0,
		uni: null,
		click: (self, e) => {
		//	e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		},
		_x: false,
		_y: false,
	},

	focus: {
		dist: (self, seriesIdx, dataIdx, valPos, curPos) => valPos - curPos,
		prox: -1,
		bias: 0,
	},

	hover: {
		skip: [void 0],
		prox: null,
		bias: 0,
	},

	left: -10,
	top: -10,
	idx: null,
	dataIdx: null,
	idxs: null,

	event: null,
};

const axisLines = {
	show: true,
	stroke: "rgba(0,0,0,0.07)",
	width: 2,
//	dash: [],
};

const grid = assign({}, axisLines, {
	filter: retArg1,
});

const ticks = assign({}, grid, {
	size: 10,
});

const border = assign({}, axisLines, {
	show: false,
});

const font      = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
const labelFont = "bold " + font;
const lineGap = 1.5;	// font-size multiplier
const nice = { dst: true, first: false };

const xAxisOpts = {
	show: true,
	dom: true,
	scale: "x",
	stroke: hexBlack,
	space: 50,
	nice,
	gap: 5,
	alignTo: 1,
	size: 50,
	labelGap: 0,
	labelSize: 30,
	labelFont,
	side: 2,
//	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
//	filter: retArg1,
	grid,
	ticks,
	border,
	font,
	lineGap,
	rotate: 0,
};

const numSeriesLabel = "Value";
const timeSeriesLabel = "Time";

const xSeriesOpts = {
	show: true,
	scale: "x",
	sorted: 1,
//	label: "Time",
//	value: v => stamp(new Date(v * 1e3)),

	// internal caches
	min: inf,
	max: -inf,
	idxs: [],
};

const numAxisFmts = new Map();

function numAxisVals(self, splits, axisIdx, foundSpace, foundIncr) {
	let dec = numDec(splits, foundIncr);

	let fmt = numAxisFmts.get(dec);
	if (fmt == null) {
		// Older Intl implementations support at most 20 fraction digits; toFixed supports 100.
		fmt = dec > 100 ? v => v.toExponential() : dec > 20 ? v => v.toFixed(dec) :
			new Intl.NumberFormat(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }).format;
		numAxisFmts.set(dec, fmt);
	}

	return splits.map(v => v == null ? "" : fmt(v == 0 ? 0 : v));
}

function numAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
	let splits = [];

	let numDec = fixedDec.get(foundIncr) || 0;

	scaleMin = forceMin ? scaleMin : roundDec(incrRoundUp(scaleMin, foundIncr), numDec);

	for (let val = scaleMin; val <= scaleMax;) {
		splits.push(Object.is(val, -0) ? 0 : val);		// coalesces -0

		if (val == scaleMax)
			break;

		let next = roundDec(val + foundIncr, numDec);
		if (!(next > val))
			return [];

		val = next;
	}

	return splits;
}

// this doesnt work for sin, which needs to come off from 0 independently in pos and neg dirs
function logAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
	const splits = [];

	const logBase = self.scales[self.axes[axisIdx].scale].log;

	const logFn = logBase == 10 ? log10 : log2;

	const exp = floor(logFn(scaleMin));

	foundIncr = pow(logBase, exp);

	// boo: 10 ** -24 === 1.0000000000000001e-24
	// this grabs the proper 1e-24 one
	if (logBase == 10)
		foundIncr = numIncrs[closestIdx(foundIncr, numIncrs)];

	let split = foundIncr;
	let nextMagIncr = foundIncr * logBase;

	if (logBase == 10)
		nextMagIncr = numIncrs[closestIdx(nextMagIncr, numIncrs)];

	do {
		if (split >= scaleMin)
			splits.push(split);

		split = split + foundIncr;

		if (logBase == 10 && !fixedDec.has(split))
			split = roundDec(split, fixedDec.get(foundIncr));

		if (split >= nextMagIncr) {
			foundIncr = split;
			nextMagIncr = foundIncr * logBase;

			if (logBase == 10)
				nextMagIncr = numIncrs[closestIdx(nextMagIncr, numIncrs)];
		}
	} while (split <= scaleMax);

	return splits;
}

function asinhAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
	let sc = self.scales[self.axes[axisIdx].scale];

	let linthresh = sc._asinh;

	let posSplits = scaleMax > linthresh ? logAxisSplits(self, axisIdx, max(linthresh, scaleMin), scaleMax, foundIncr) : [linthresh];
	let zero = scaleMax >= 0 && scaleMin <= 0 ? [0] : [];
	let negSplits = scaleMin < -linthresh ? logAxisSplits(self, axisIdx, max(linthresh, -scaleMax), -scaleMin, foundIncr): [linthresh];

	return negSplits.reverse().map(v => -v).concat(zero, posSplits);
}

const RE_ALL   = /./;
const RE_12357 = /[12357]/;
const RE_125   = /[125]/;
const RE_1     = /1/;

const _filt = (splits, distr, re, keepMod) => splits.map((v, i) => ((distr == 4 && v == 0) || i % keepMod == 0 && re.test(v.toExponential()[v < 0 ? 1 : 0])) ? v : null);

function log10AxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
	let axis = self.axes[axisIdx];
	let scaleKey = axis.scale;
	let sc = self.scales[scaleKey];

//	if (sc.distr == 3 && sc.log == 2)
//		return splits;

	let valToPos = self.valToPos;

	let minSpace = axis._space;

	let _10 = valToPos(10, scaleKey);

	let re = (
		valToPos(9, scaleKey) - _10 >= minSpace ? RE_ALL :
		valToPos(7, scaleKey) - _10 >= minSpace ? RE_12357 :
		valToPos(5, scaleKey) - _10 >= minSpace ? RE_125 :
		RE_1
	);

	if (re == RE_1) {
		let magSpace = abs(valToPos(1, scaleKey) - _10);

		if (magSpace < minSpace)
			return _filt(splits.slice().reverse(), sc.distr, re, ceil(minSpace / magSpace)).reverse(); // max->min skip
	}

	return _filt(splits, sc.distr, re, 1);
}

function log2AxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
	let axis = self.axes[axisIdx];
	let scaleKey = axis.scale;
	let minSpace = axis._space;
	let valToPos = self.valToPos;

	let magSpace = abs(valToPos(1, scaleKey) - valToPos(2, scaleKey));

	if (magSpace < minSpace)
		return _filt(splits.slice().reverse(), 3, RE_ALL, ceil(minSpace / magSpace)).reverse(); // max->min skip

	return splits;
}

function numSeriesVal(self, val, seriesIdx, dataIdx) {
	return dataIdx == null ? LEGEND_DISP : val == null ? "" : fmtNum(val);
}

const yAxisOpts = {
	show: true,
	dom: true,
	scale: "y",
	stroke: hexBlack,
	space: 30,
	ramp: 1,
	exact: false,
	nice,
	gap: 5,
	alignTo: 1,
	size: 50,
	labelGap: 0,
	labelSize: 30,
	labelFont,
	side: 3,
//	class: "y-vals",
//	incrs: numIncrs,
//	values: (vals, space) => vals,
//	filter: retArg1,
	grid,
	ticks,
	border,
	font,
	lineGap,
	rotate: 0,
};

// takes stroke width
function ptDia(width, mult) {
	let dia = 3 + (width || 1) * 2;
	return roundDec(dia * mult, 3);
}

function seriesPointsShow(self, si) {
	let { scale, idxs } = self.series[0];
	let xData = self._data[0];
	let p0 = self.valToPos(xData[idxs[0]], scale, true);
	let p1 = self.valToPos(xData[idxs[1]], scale, true);
	let dim = abs(p1 - p0);

	let s = self.series[si];
//	const dia = ptDia(s.width, self.pxRatio);
	let maxPts = dim / (s.points.space * self.pxRatio);
	return idxs[1] - idxs[0] <= maxPts;
}

const facet = {
	scale: null,
	sorted: 0,

	// internal caches
	min: inf,
	max: -inf,
};

const gaps = (self, seriesIdx, idx0, idx1, nullGaps) => nullGaps;

const xySeriesOpts = {
	show: true,
	sorted: 0,
	gaps,
	alpha: 1,
	facets: [
		assign({}, facet, {scale: 'x'}),
		assign({}, facet, {scale: 'y'}),
	],
};

const ySeriesOpts = {
	scale: "y",
	sorted: 0,
	show: true,
	spanGaps: false,
	gaps,
	alpha: 1,
	points: {
		show: seriesPointsShow,
		filter: null,
	//  paths:
	//	stroke: "#000",
	//	fill: "#fff",
	//	width: 1,
	//	size: 10,
	},
//	label: "Value",
//	value: v => v,
	values: null,

	// internal caches
	min: inf,
	max: -inf,
	idxs: [],

	path: null,
	clip: null,
};

function clampScale(self, val, scaleMin, scaleMax, scaleKey) {
/*
	if (val < 0) {
		let cssHgt = self.bbox.height / self.pxRatio;
		let absPos = self.valToPos(abs(val), scaleKey);
		let fromBtm = cssHgt - absPos;
		return self.posToVal(cssHgt + fromBtm, scaleKey);
	}
*/
	return scaleMin / 10;
}

function asinhScale(self, scaleKey) {
	let { series, data, mode } = self;
	let linthresh = inf;

	for (let i = 1; i < series.length; i++) {
		let s = series[i];
		let scale = mode == 1 ? s.scale : s.facets[1].scale;

		if (scale == scaleKey) {
			let yData = mode == 1 ? data[i] : data[i][1];
			let [i0, i1] = mode == 1 ? series[0].idxs : [0, yData.length - 1];

			for (let j = i0; j <= i1; j++) {
				if (yData[j] != null) {
					let val = abs(yData[j]);

					if (val < linthresh)
						linthresh = val;
				}
			}
		}
	}

	return linthresh == inf || linthresh == 0 ? 1 : linthresh;
}

const xScaleOpts = {
	time: FEAT_TIME,
	auto: true,
	distr: 1,
	log: 10,
	asinh: asinhScale,
	min: null,
	max: null,
	dir: 1,
	ori: 0,
};

const yScaleOpts = assign({}, xScaleOpts, {
	time: false,
	ori: 1,
});

function rangeYCount(height, ramp = 1) {
	if (!(height > 0) || !isFinite$1(height) || !(ramp >= 0) || !isFinite$1(ramp))
		return 0;

	let target = height / 50;
	target += Math.exp(-target / 3);
	return max(1, round(1 + (target - 1) * ramp));
}

/** @typedef {{pad?: number | null, hard?: number | null, soft?: number | null}} RangeYLimit */

const autoLimit = Object.freeze({ pad: rangePad });
/** @type {Readonly<{zeroIf: number, min: Readonly<RangeYLimit>, max: Readonly<RangeYLimit>}>} */
const rangeYAuto = Object.freeze({ zeroIf: rangeZeroIf, min: autoLimit, max: autoLimit });

function limitPolicy(limit, side) {
	limit ??= autoLimit;

	let hardDefault = side == 0 ? -Infinity : Infinity;
	let softDefault = -hardDefault;
	let hard = limit.hard ?? hardDefault;
	let soft = limit.soft ?? softDefault;
	let pad = limit.pad ?? autoLimit.pad;

	if ((!isFinite$1(hard) && hard != hardDefault) || (!isFinite$1(soft) && soft != softDefault) ||
		!isFinite$1(pad) || pad < 0)
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
	if (!isFinite$1(zeroIf) || zeroIf < 0 || minPolicy == null || maxPolicy == null || minPolicy.hard >= maxPolicy.hard)
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
	if (!isFinite$1(span))
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
	if (!isFinite$1(requiredMin) || !isFinite$1(requiredMax) || !isFinite$1(requiredSpan))
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

				if (isFinite$1(hardMin))
					minLo = max(minLo, incrRoundUp(hardMin, incr));
				if (isFinite$1(hardMax))
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
function rangeY(dataMin, dataMax, height, range = rangeYAuto, ramp = 1, exactCount = false) {
	if (dataMin == null && dataMax == null)
		return { min: null, max: null, incr: 0, count: 0 };

	let count = rangeYCount(height, ramp);
	if (!Number.isSafeInteger(count) || count < 1 || dataMin == null || dataMax == null ||
		!isFinite$1(dataMin) || !isFinite$1(dataMax) || dataMax < dataMin)
		return null;

	let request = prepareRangeY(dataMin, dataMax, range);
	if (request == null)
		return null;

	return selectRangeY(request, count, exactCount);
}

// entries is an array with unique keys from getKey(entry).
// mount(entry) returns {node, update(entry), destroy()} with one stable root node.
// Each update calls every current instance.update(entry) once, including new instances.
// The list owns root placement and removal. Instances own their root contents.
// before is null (the parent end) or a persistent child that bounds this list.
// Removed keys call instance.destroy() once. Later occurrences mount fresh instances.
// destroy() clears the list and can repeat. Callbacks must not reenter the list.
function createKeyedList(parent, getKey, mount, before = null) {
	const records = new Map();
	let ordered = [];
	let next = [];

	function remove(record) {
		const { instance } = record;
		const { node } = instance;
		instance.destroy();
		if (node.parentNode === parent)
			parent.removeChild(node);
	}

	function update(entries) {
		for (let i = 0; i < ordered.length; i++)
			ordered[i].active = false;

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const key = getKey(entry);
			let record = records.get(key);

			if (record === undefined) {
				record = { key, instance: mount(entry), active: true };
				records.set(key, record);
			}
			else
				record.active = true;

			next[i] = record;
			record.instance.update(entry);
		}
		next.length = entries.length;

		for (let i = 0; i < ordered.length; i++) {
			const record = ordered[i];
			if (!record.active) {
				records.delete(record.key);
				remove(record);
			}
			ordered[i] = null;
		}

		let anchor = before;
		for (let i = next.length - 1; i >= 0; i--) {
			const node = next[i].instance.node;
			if (node.parentNode !== parent || node.nextSibling !== anchor) {
				// Atomic moves preserve focus and other state in connected subtrees.
				if (node.parentNode === parent && node.isConnected && typeof parent.moveBefore === 'function')
					parent.moveBefore(node, anchor);
				else
					parent.insertBefore(node, anchor);
			}
			anchor = node;
		}

		const previous = ordered;
		ordered = next;
		next = previous;
	}

	function destroy() {
		for (let i = 0; i < ordered.length; i++)
			remove(ordered[i]);

		records.clear();
		ordered.length = 0;
		next.length = 0;
	}

	return { update, destroy };
}

// Construction only: DOM properties, style properties, and Node/text children.
// Null/false/empty children are omitted; arrays group children without wrapper nodes.
function h(tag, props, ...children) {
	const node = document.createElement(tag);
	for (const key in props) {
		const value = props[key];
		if (value != null) {
			if (key == 'style') {
				for (const name in value) {
					if (value[name] != null)
						node.style[name] = value[name];
				}
			}
			else
				node[key] = value;
		}
	}
	append(node, children);
	return node;
}

function append(parent, child) {
	if (isArr(child)) {
		for (const item of child)
			append(parent, item);
	}
	else if (child != null && child !== false && child !== '')
		parent.append(child);
}

function textValue(value) {
	return value == null || value === false ? '' : String(value);
}

function setText(node, text) {
	if (text == '') {
		if (node.firstChild != null)
			node.textContent = '';
	}
	else if (node.firstChild != null)
		node.firstChild.nodeValue = text;
	else
		node.textContent = text;
}

function createValueCells(keys) {
	const nodes = keys.map(() => h('td', {className: LEGEND_VALUE}));
	const previous = Array(keys.length).fill('');

	return {
		nodes,
		update(values) {
			for (let i = 0; i < keys.length; i++) {
				const text = textValue(values == null ? LEGEND_DISP : values[keys[i]]);
				if (text !== previous[i]) {
					setText(nodes[i], text);
					previous[i] = text;
				}
			}
		},
	};
}

// The adapter selects entries and prepares them in forward order before reconciliation.
// It also owns table placement, legend.mount, and removal; rows own only their contents.
function createLegendTemplate(self, opts, keys, markersShow) {
	const {legend, multi, focusAlpha, cursorFocus, bind, emit} = opts;
	const rowMeta = new WeakMap();
	let body;
	const node = h('table', null,
		multi && h('thead', null,
			h('tr', null,
				h('th'),
				keys.map(key => h('th', {className: LEGEND_LABEL}, key)),
			),
		),
		body = h('tbody'),
	);
	let values = [];
	let focused = null;
	let tableClass;

	function bindEvent(el, type, series, onlyTarget) {
		const bindType = type == 'focus' ? mouseenter : type == 'leave' ? mouseleave : type;
		const listener = bind[bindType](self, el, e => emit(type, series, e), onlyTarget);
		if (listener)
			on(bindType, el, listener);
		return listener;
	}

	function createRowEvents(header, series) {
		let bound = false;
		let click, focus;

		function unbind() {
			if (click)
				off('click', header, click);
			if (focus)
				off(mouseenter, header, focus);
			click = focus = null;
			bound = false;
		}

		return {
			update(eligible) {
				if (eligible !== bound) {
					if (eligible) {
						click = bindEvent(header, 'click', series, false);
						if (cursorFocus)
							focus = bindEvent(header, 'focus', series, false);
						// Null listeners still count as a completed binding transition.
						bound = true;
					}
					else
						unbind();
				}
			},
			destroy: unbind,
		};
	}

	let leave = cursorFocus ? bindEvent(node, 'leave', null, true) : null;

	function prepare({series, index}) {
		let state = rowMeta.get(series);
		if (state == null) {
			const markers = legend.markers;
			let border = null, background = null, color = null;
			if (index > 0) {
				if (markersShow) {
					const width = markers.width(self, index);
					if (width)
						border = width + 'px ' + markers.dash(self, index) + ' ' + markers.stroke(self, index);
					background = markers.fill(self, index);
				}
				else
					color = series.width > 0 ? markers.stroke(self, index) : markers.fill(self, index);
			}
			const label = series.label;
			state = { label: label instanceof HTMLElement ? label : textValue(label), border, background, color };
			rowMeta.set(series, state);
		}
		return state;
	}

	function createRow(entry) {
		const state = prepare(entry);
		const cells = createValueCells(keys);
		let header, label;
		const row = h('tr', null,
			header = h('th', null,
				markersShow && h('div', {
					className: LEGEND_MARKER,
					style: {border: state.border, background: state.background},
				}),
				label = h('div', {className: LEGEND_LABEL, style: {color: state.color}},
					state.label,
				),
			),
			cells.nodes,
		);
		const events = createRowEvents(header, entry.series);
		let className;
		let opacity = null;

		return {
			node: row,
			update({series, index}) {
				const nextClass = LEGEND_SERIES + (series.class ? ' ' + series.class : '') + (series.show ? '' : ' ' + OFF);
				if (nextClass !== className) {
					row.className = className = nextClass;
				}

				const nextOpacity = focusAlpha != 1 && focused != null && index > 0 && series != focused ? focusAlpha : null;
				if (nextOpacity !== opacity) {
					row.style.opacity = nextOpacity == null ? '' : nextOpacity;
					opacity = nextOpacity;
				}

				events.update(index > 0);
				cells.update(values[index]);
			},
			destroy() {
				events.destroy();
				// Keep the supplied label, not its discarded row and value cells.
				if (state.label instanceof HTMLElement && state.label.parentNode === label)
					label.removeChild(state.label);
			},
		};
	}

	return {
		node,
		body,
		prepare,
		createRow,
		update(data, focusedSeries) {
			values = data;
			focused = focusedSeries;
			const className = LEGEND + (!multi ? ' ' + LEGEND_INLINE + (legend.live ? ' ' + LEGEND_LIVE : '') : '');
			if (className !== tableClass)
				node.className = tableClass = className;
		},
		destroy() {
			if (leave)
				off(mouseleave, node, leave);
			leave = null;
		},
	};
}

const seriesKey = entry => entry.series;

// selectRows is an internal prototype seam, not a public uPlot option.
// Entries retain their core index regardless of display order or visibility.
function createLegend(self, parent, opts, selectRows) {
	const {series, legend, columns, multi, mode} = opts;
	const markersShow = legend.markers.show;
	const keys = [];
	for (const key in columns)
		keys.push(key);

	const entriesBySeries = new WeakMap();
	const entries = [];
	let template, rows;
	let destroyed = false;

	function select(data) {
		let count = 0;
		for (let index = 0; index < series.length; index++) {
			if (index == 0 && (multi || !legend.live || mode == 2))
				continue;

			const s = series[index];
			let entry = entriesBySeries.get(s);
			if (entry == null) {
				entry = {series: s, index};
				entriesBySeries.set(s, entry);
			}
			else
				entry.index = index;
			entries[count++] = entry;
		}
		entries.length = count;
		return entries;
	}

	return {
		render(data, focus) {
			if (destroyed)
				return;

			const mount = template == null;
			if (mount) {
				template = createLegendTemplate(self, opts, keys, markersShow);
				rows = createKeyedList(template.body, seriesKey, template.createRow);
			}

			const selected = select();
			for (let i = 0; i < selected.length; i++)
				template.prepare(selected[i]);
			template.update(data, focus);
			rows.update(selected);

			if (mount) {
				parent.appendChild(template.node);
				legend.mount(self, template.node);
			}
		},
		destroy() {
			if (!destroyed) {
				destroyed = true;
				rows?.destroy();
				template?.destroy();
				template?.node.remove();
				rows = template = null;
				entries.length = 0;
			}
		},
	};
}

const syncs = {};

function _sync(key, opts) {
	let s = syncs[key];

	if (!s) {
		s = {
			key,
			plots: [],
			sub(plot) {
				s.plots.push(plot);
			},
			unsub(plot) {
				s.plots = s.plots.filter(c => c != plot);
			},
			pub(type, self, x, y, w, h, i) {
				for (let j = 0; j < s.plots.length; j++)
					s.plots[j] != self && s.plots[j].pub(type, self, x, y, w, h, i);
			},
		};

		if (key != null)
			syncs[key] = s;
	}

	return s;
}

const BAND_CLIP_FILL   = 1 << 0;
const BAND_CLIP_STROKE = 1 << 1;

function orient(u, seriesIdx, cb) {
	const mode = u.mode;
	const series = u.series[seriesIdx];
	const data = mode == 2 ? u._data[seriesIdx] : u._data;
	const scales = u.scales;
	const bbox   = u.bbox;

	let dx = data[0],
		dy = mode == 2 ? data[1] : data[seriesIdx],
		sx = mode == 2 ? scales[series.facets[0].scale] : scales[u.series[0].scale],
		sy = mode == 2 ? scales[series.facets[1].scale] : scales[series.scale],
		l = bbox.left,
		t = bbox.top,
		w = bbox.width,
		h = bbox.height,
		H = u.valToPosH,
		V = u.valToPosV;

	return (sx.ori == 0
		? cb(
			series,
			dx,
			dy,
			sx,
			sy,
			H,
			V,
			l,
			t,
			w,
			h,
			moveToH,
			lineToH,
			rectH,
			arcH,
			bezierCurveToH,
		)
		: cb(
			series,
			dx,
			dy,
			sx,
			sy,
			V,
			H,
			t,
			l,
			h,
			w,
			moveToV,
			lineToV,
			rectV,
			arcV,
			bezierCurveToV,
		)
	);
}

function bandFillClipDirs(self, seriesIdx) {
	let fillDir = 0;

	// 2 bits, -1 | 1
	let clipDirs = 0;

	let bands = self.bands ?? EMPTY_ARR;

	for (let i = 0; i < bands.length; i++) {
		let b = bands[i];

		// is a "from" band edge
		if (b.series[0] == seriesIdx)
			fillDir = b.dir;
		// is a "to" band edge
		else if (b.series[1] == seriesIdx) {
			if (b.dir == 1)
				clipDirs |= 1;
			else
				clipDirs |= 2;
		}
	}

	return [
		fillDir,
		(
			clipDirs == 1 ? -1 : // neg only
			clipDirs == 2 ?  1 : // pos only
			clipDirs == 3 ?  2 : // both
			                 0   // neither
		)
	];
}

function seriesFillTo(self, seriesIdx, dataMin, dataMax, bandFillDir) {
	let mode = self.mode;
	let series = self.series[seriesIdx];
	let scaleKey = mode == 2 ? series.facets[1].scale : series.scale;
	let scale = self.scales[scaleKey];

	return (
		bandFillDir == -1 ? scale.min :
		bandFillDir ==  1 ? scale.max :
		scale.distr ==  3 ? (
			scale.dir == 1 ? scale.min :
			scale.max
		) : 0
	);
}

// creates inverted band clip path (from stroke path -> yMax || yMin)
// clipDir is always inverse of fillDir
// default clip dir is upwards (1), since default band fill is downwards/fillBelowTo (-1) (highIdx -> lowIdx)
function clipBandLine(self, seriesIdx, idx0, idx1, strokePath, clipDir) {
	return orient(self, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
		let pxRound = series.pxRound;

		const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
		const lineTo = scaleX.ori == 0 ? lineToH : lineToV;

		let frIdx, toIdx;

		if (dir == 1) {
			frIdx = idx0;
			toIdx = idx1;
		}
		else {
			frIdx = idx1;
			toIdx = idx0;
		}

		// path start
		let x0 = pxRound(valToPosX(dataX[frIdx], scaleX, xDim, xOff));
		let y0 = pxRound(valToPosY(dataY[frIdx], scaleY, yDim, yOff));
		// path end x
		let x1 = pxRound(valToPosX(dataX[toIdx], scaleX, xDim, xOff));
		// upper or lower y limit
		let yLimit = pxRound(valToPosY(clipDir == 1 ? scaleY.max : scaleY.min, scaleY, yDim, yOff));

		let clip = new Path2D(strokePath);

		lineTo(clip, x1, yLimit);
		lineTo(clip, x0, yLimit);
		lineTo(clip, x0, y0);

		return clip;
	});
}

function clipGaps(gaps, ori, plotLft, plotTop, plotWid, plotHgt) {
	let clip = null;

	// create clip path (invert gaps and non-gaps)
	if (gaps.length > 0) {
		clip = new Path2D();

		const rect = ori == 0 ? rectH : rectV;

		let prevGapEnd = plotLft;

		for (let i = 0; i < gaps.length; i++) {
			let g = gaps[i];

			if (g[1] > g[0]) {
				let w = g[0] - prevGapEnd;

				w > 0 && rect(clip, prevGapEnd, plotTop, w, plotTop + plotHgt);

				prevGapEnd = g[1];
			}
		}

		let w = plotLft + plotWid - prevGapEnd;

		// hack to ensure we expand the clip enough to avoid cutting off strokes at edges
		let maxStrokeWidth = 10;

		w > 0 && rect(clip, prevGapEnd, plotTop - maxStrokeWidth / 2, w, plotTop + plotHgt + maxStrokeWidth);
	}

	return clip;
}

function addGap(gaps, fromX, toX) {
	let prevGap = gaps[gaps.length - 1];

	if (prevGap && prevGap[0] == fromX)			// TODO: gaps must be encoded at stroke widths?
		prevGap[1] = toX;
	else
		gaps.push([fromX, toX]);
}

function findGaps(xs, ys, idx0, idx1, dir, pixelForX, align) {
	let gaps = [];
	let len = xs.length;

	for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
		let yVal = ys[i];

		if (yVal === null) {
			let fr = i, to = i;

			if (dir == 1) {
				while (++i <= idx1 && ys[i] === null)
					to = i;
			}
			else {
				while (--i >= idx0 && ys[i] === null)
					to = i;
			}

			let frPx = pixelForX(xs[fr]);
			let toPx = to == fr ? frPx : pixelForX(xs[to]);

			// if value adjacent to edge null is same pixel, then it's partially
			// filled and gap should start at next pixel
			let fri2 = fr - dir;
			let frPx2 = align <= 0 && fri2 >= 0 && fri2 < len ? pixelForX(xs[fri2]) : frPx;
		//	if (frPx2 == frPx)
		//		frPx++;
		//	else
				frPx = frPx2;

			let toi2 = to + dir;
			let toPx2 = align >= 0 && toi2 >= 0 && toi2 < len ? pixelForX(xs[toi2]) : toPx;
		//	if (toPx2 == toPx)
		//		toPx--;
		//	else
				toPx = toPx2;

			if (toPx >= frPx)
				gaps.push([frPx, toPx]); // addGap
		}
	}

	return gaps;
}

function pointPos(val, scale, dim, off, valToPos, pxRound) {
	return pxRound(valToPos(val, scale, dim, off));
}

function pxOffset(width, pxAlign) {
	let offset = (width % 2) / 2;
	return pxAlign == 1 && offset > 0 ? offset : 0;
}

function pxRoundGen(pxAlign) {
	return pxAlign == 0 ? retArg0 : pxAlign == 1 ? round : v => incrRound(v, pxAlign);
}

/*
// inefficient linear interpolation that does bi-directinal scans on each call
export function costlyLerp(i, idx0, idx1, _dirX, dataY) {
	let prevNonNull = nonNullIdx(dataY, _dirX == 1 ? idx0 : idx1, i, -_dirX);
	let nextNonNull = nonNullIdx(dataY, i, _dirX == 1 ? idx1 : idx0,  _dirX);

	let prevVal = dataY[prevNonNull];
	let nextVal = dataY[nextNonNull];

	return prevVal + (i - prevNonNull) / (nextNonNull - prevNonNull) * (nextVal - prevVal);
}
*/

function rect(ori) {
	let moveTo = ori == 0 ?
		moveToH :
		moveToV;

	let arcTo = ori == 0 ?
		(p, x1, y1, x2, y2, r) => { p.arcTo(x1, y1, x2, y2, r); } :
		(p, y1, x1, y2, x2, r) => { p.arcTo(x1, y1, x2, y2, r); };

	let rect = ori == 0 ?
		(p, x, y, w, h) => { p.rect(x, y, w, h); } :
		(p, y, x, h, w) => { p.rect(x, y, w, h); };

	// TODO (pending better browser support): https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/roundRect
	return (p, x, y, w, h, endRad = 0, baseRad = 0) => {
		if (endRad == 0 && baseRad == 0)
			rect(p, x, y, w, h);
		else {
			endRad  = min(endRad,  w / 2, h / 2);
			baseRad = min(baseRad, w / 2, h / 2);

			// adapted from https://stackoverflow.com/questions/1255512/how-to-draw-a-rounded-rectangle-using-html-canvas/7838871#7838871
			moveTo(p, x + endRad, y);
			arcTo(p, x + w, y, x + w, y + h, endRad);
			arcTo(p, x + w, y + h, x, y + h, baseRad);
			arcTo(p, x, y + h, x, y, baseRad);
			arcTo(p, x, y, x + w, y, endRad);
			p.closePath();
		}
	};
}

// orientation-inverting canvas functions
const moveToH = (p, x, y) => { p.moveTo(x, y); };
const moveToV = (p, y, x) => { p.moveTo(x, y); };
const lineToH = (p, x, y) => { p.lineTo(x, y); };
const lineToV = (p, y, x) => { p.lineTo(x, y); };
const rectH = rect(0);
const rectV = rect(1);
const arcH = (p, x, y, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); };
const arcV = (p, y, x, r, startAngle, endAngle) => { p.arc(x, y, r, startAngle, endAngle); };
const bezierCurveToH = (p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };
const bezierCurveToV = (p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) => { p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y); };

// TODO: drawWrap(seriesIdx, drawPoints) (save, restore, translate, clip)
function points(opts) {
	return (u, seriesIdx, idx0, idx1, filtIdxs) => {
	//	log("drawPoints()", arguments);
		let { pxRatio } = u;

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let { pxRound, points } = series;

			let moveTo, arc;

			if (scaleX.ori == 0) {
				moveTo = moveToH;
				arc = arcH;
			}
			else {
				moveTo = moveToV;
				arc = arcV;
			}

			const width = roundDec(points.width * pxRatio, 3);

			let rad = (points.size - points.width) / 2 * pxRatio;
			let dia = roundDec(rad * 2, 3);

			let fill = new Path2D();
			let clip = new Path2D();

			let { left: lft, top: top, width: wid, height: hgt } = u.bbox;

			rectH(clip,
				lft - dia,
				top - dia,
				wid + dia * 2,
				hgt + dia * 2,
			);

			const drawPoint = pi => {
				if (dataY[pi] != null) {
					let x = pointPos(dataX[pi], scaleX, xDim, xOff, valToPosX, pxRound);
					let y = pointPos(dataY[pi], scaleY, yDim, yOff, valToPosY, pxRound);

					moveTo(fill, x + rad, y);
					arc(fill, x, y, rad, 0, PI * 2);
				}
			};

			if (filtIdxs)
				filtIdxs.forEach(drawPoint);
			else {
				for (let pi = idx0; pi <= idx1; pi++)
					drawPoint(pi);
			}

			return {
				stroke: width > 0 ? fill : null,
				fill,
				clip,
				flags: BAND_CLIP_FILL | BAND_CLIP_STROKE,
			};
		});
	};
}

function _drawAcc(lineTo) {
	return (stroke, accX, minY, maxY, inY, outY) => {
		if (minY != maxY) {
			if (inY != minY && outY != minY)
				lineTo(stroke, accX, minY);
			if (inY != maxY && outY != maxY)
				lineTo(stroke, accX, maxY);

			lineTo(stroke, accX, outY);
		}
	};
}

const drawAccH = _drawAcc(lineToH);
const drawAccV = _drawAcc(lineToV);

function linear(opts) {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			[idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);

			if (idx0 == -1)
				return null;

			let pxRound = series.pxRound;

			let alignGaps = opts?.alignGaps ?? series.alignGaps ?? 0;

			let pixelForX = val => pxRound(valToPosX(val, scaleX, xDim, xOff));
			let pixelForY = val => pxRound(valToPosY(val, scaleY, yDim, yOff));

			let lineTo, drawAcc;

			if (scaleX.ori == 0) {
				lineTo = lineToH;
				drawAcc = drawAccH;
			}
			else {
				lineTo = lineToV;
				drawAcc = drawAccV;
			}

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let hasGap = false;

			// decimate when number of points >= 4x available pixels
			const decimate = idx1 - idx0 >= xDim * 4;

			if (decimate) {
				let xForPixel = pos => u.posToVal(pos, scaleX.key, true);

				let minY = null,
					maxY = null,
					inY, outY, drawnAtX;

				let accX = pixelForX(dataX[dir == 1 ? idx0 : idx1]);

				let idx0px = pixelForX(dataX[idx0]);
				let idx1px = pixelForX(dataX[idx1]);

				// tracks limit of current x bucket to avoid having to get x pixel for every x value
				let nextAccXVal = xForPixel(dir == 1 ? idx0px + 1 : idx1px - 1);

				for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
					let xVal = dataX[i];
					let reuseAccX = dir == 1 ? (xVal < nextAccXVal) : (xVal > nextAccXVal);
					let x = reuseAccX ? accX :  pixelForX(xVal);

					let yVal = dataY[i];

					if (x == accX) {
						if (yVal != null) {
							outY = yVal;

							if (minY == null) {
								lineTo(stroke, x, pixelForY(outY));
								inY = minY = maxY = outY;
							} else {
								if (outY < minY)
									minY = outY;
								else if (outY > maxY)
									maxY = outY;
							}
						}
						else {
							if (yVal === null)
								hasGap = true;
						}
					}
					else {
						if (minY != null)
							drawAcc(stroke, accX, pixelForY(minY), pixelForY(maxY), pixelForY(inY), pixelForY(outY));

						if (yVal != null) {
							outY = yVal;
							lineTo(stroke, x, pixelForY(outY));
							minY = maxY = inY = outY;
						}
						else {
							minY = maxY = null;

							if (yVal === null)
								hasGap = true;
						}

						accX = x;
						nextAccXVal = xForPixel(accX + dir);
					}
				}

				if (minY != null && minY != maxY && drawnAtX != accX)
					drawAcc(stroke, accX, pixelForY(minY), pixelForY(maxY), pixelForY(inY), pixelForY(outY));
			}
			else {
				for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
					let yVal = dataY[i];

					if (yVal === null)
						hasGap = true;
					else if (yVal != null)
						lineTo(stroke, pixelForX(dataX[i]), pixelForY(yVal));
				}
			}

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillToVal = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pixelForY(fillToVal);

				let frX = pixelForX(dataX[idx0]);
				let toX = pixelForX(dataX[idx1]);

				if (dir == -1)
					[toX, frX] = [frX, toX];

				lineTo(fill, toX, fillToY);
				lineTo(fill, frX, fillToY);
			}

			if (!series.spanGaps) { // skip in mode: 2?
			//	console.time('gaps');
				let gaps = hasGap ? findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps) : [];

			//	console.timeEnd('gaps');

			//	console.log('gaps', JSON.stringify(gaps));

				_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
			}

			if (bandClipDir != 0) {
				_paths.band = bandClipDir == 2 ? [
					clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
					clipBandLine(u, seriesIdx, idx0, idx1, stroke,  1),
				] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
			}

			return _paths;
		});
	};
}

// BUG: align: -1 behaves like align: 1 when scale.dir: -1
function stepped(opts) {
	const align = opts.align ?? 1;
	// whether to draw ascenders/descenders at null/gap bondaries
	const ascDesc = opts.ascDesc ?? false;
	const extend = opts.extend ?? false;

	return (u, seriesIdx, idx0, idx1) => {
		let { pxRatio } = u;

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			[idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);

			if (idx0 == -1)
				return null;

			let pxRound = series.pxRound;

			let alignGaps = opts?.alignGaps ?? series.alignGaps ?? 0;

			let { left, width } = u.bbox;

			let pixelForX = val => pxRound(valToPosX(val, scaleX, xDim, xOff));
			let pixelForY = val => pxRound(valToPosY(val, scaleY, yDim, yOff));

			let lineTo = scaleX.ori == 0 ? lineToH : lineToV;

			const _paths = {stroke: new Path2D(), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			let hasGap = false;

			let prevYPos  = pixelForY(dataY[dir == 1 ? idx0 : idx1]);
			let firstXPos = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
			let prevXPos = firstXPos;

			let firstXPosExt = firstXPos;

			if (extend && align == -1) {
				firstXPosExt = left;
				lineTo(stroke, firstXPosExt, prevYPos);
			}

			lineTo(stroke, firstXPos, prevYPos);

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let yVal1 = dataY[i];

				if (yVal1 == null) {
					if (yVal1 === null)
						hasGap = true;

					continue;
				}

				let x1 = pixelForX(dataX[i]);
				let y1 = pixelForY(yVal1);

				if (align == 1)
					lineTo(stroke, x1, prevYPos);
				else
					lineTo(stroke, prevXPos, y1);

				lineTo(stroke, x1, y1);

				prevYPos = y1;
				prevXPos = x1;
			}

			let prevXPosExt = prevXPos;

			if (extend && align == 1) {
				prevXPosExt = left + width;
				lineTo(stroke, prevXPosExt, prevYPos);
			}

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pixelForY(fillTo);

				lineTo(fill, prevXPosExt, fillToY);
				lineTo(fill, firstXPosExt, fillToY);
			}

			if (!series.spanGaps) {
			//	console.time('gaps');
				let gaps = hasGap ? findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps) : [];

			//	console.timeEnd('gaps');

			//	console.log('gaps', JSON.stringify(gaps));

				// expand/contract clips for ascenders/descenders
				let halfStroke = (series.width * pxRatio) / 2;
				let startsOffset = (ascDesc || align ==  1) ?  halfStroke : -halfStroke;
				let endsOffset   = (ascDesc || align == -1) ? -halfStroke :  halfStroke;

				gaps.forEach(g => {
					g[0] += startsOffset;
					g[1] += endsOffset;
				});

				_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
			}

			if (bandClipDir != 0) {
				_paths.band = bandClipDir == 2 ? [
					clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
					clipBandLine(u, seriesIdx, idx0, idx1, stroke,  1),
				] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
			}

			return _paths;
		});
	};
}

function findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid = inf) {
	if (dataX.length > 1) {
		// prior index with non-undefined y data
		let prevIdx = null;

		// scan full dataset for smallest adjacent delta
		// will not work properly for non-linear x scales, since does not do expensive valToPosX calcs till end
		for (let i = 0, minDelta = Infinity; i < dataX.length; i++) {
			if (dataY[i] !== undefined) {
				if (prevIdx != null) {
					let delta = abs(dataX[i] - dataX[prevIdx]);

					if (delta < minDelta) {
						minDelta = delta;
						colWid = abs(valToPosX(dataX[i], scaleX, xDim, xOff) - valToPosX(dataX[prevIdx], scaleX, xDim, xOff));
					}
				}

				prevIdx = i;
			}
		}
	}

	return colWid;
}

function bars(opts) {
	opts = opts || EMPTY_OBJ;
	const size = opts.size ?? [0.6, inf, 1];
	const align = opts.align || 0;
	const _extraGap = (opts.gap || 0);

	let ro = opts.radius;

	ro =
		// [valueRadius, baselineRadius]
		ro == null ? [0, 0] :
		typeof ro == 'number' ? [ro, 0] : ro;

	const radiusFn = fnOrSelf(ro);

	const gapFactor = 1 - size[0];
	const _maxWidth  = size[1] ?? inf;
	const _minWidth  = size[2] ?? 1;

	const disp = opts.disp ?? EMPTY_OBJ;
	const _each = opts.each ?? (_ => {});

	const { fill: dispFills, stroke: dispStrokes } = disp;

	return (u, seriesIdx, idx0, idx1) => {
		let { pxRatio } = u;

		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;
			let _align = align;

			let extraGap = _extraGap * pxRatio;
			let maxWidth = _maxWidth * pxRatio;
			let minWidth = _minWidth * pxRatio;

			let [valRadius, baseRadius] = radiusFn(u, seriesIdx);

			const _dirX = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			let rect = scaleX.ori == 0 ? rectH : rectV;

			let each = scaleX.ori == 0 ? _each : (u, seriesIdx, i, top, lft, hgt, wid) => {
				_each(u, seriesIdx, i, lft, top, wid, hgt);
			};

			let dataY0 = u._base?.[seriesIdx];

			// band where this series is the "from" edge
			let band = dataY0 == null ? (u.bands ?? EMPTY_ARR).find(b => b.series[0] == seriesIdx) : null;

			let fillDir = band != null ? band.dir : 0;
			let fillTo = dataY0 == null ? series.fillTo(u, seriesIdx, series.min, series.max, fillDir) : 0;
			let fillToY = pxRound(valToPosY(fillTo, scaleY, yDim, yOff));

			// barWid is to center of stroke
			let xShift, barWid, fullGap, colWid = xDim;

			let strokeWidth = pxRound(series.width * pxRatio);

			let multiPath = false;

			let fillColors = null;
			let fillPaths = null;
			let strokeColors = null;
			let strokePaths = null;

			if (dispFills != null && (strokeWidth == 0 || dispStrokes != null)) {
				multiPath = true;

				fillColors = dispFills.values(u, seriesIdx, idx0, idx1);
				fillPaths = new Map();
				(new Set(fillColors)).forEach(color => {
					if (color != null)
						fillPaths.set(color, new Path2D());
				});

				if (strokeWidth > 0) {
					strokeColors = dispStrokes.values(u, seriesIdx, idx0, idx1);
					strokePaths = new Map();
					(new Set(strokeColors)).forEach(color => {
						if (color != null)
							strokePaths.set(color, new Path2D());
					});
				}
			}

			let { x0, size } = disp;

			if (x0 != null && size != null) {
				_align = 1;
				dataX = x0.values(u, seriesIdx, idx0, idx1);

				if (x0.unit == 2)
					dataX = dataX.map(pct => u.posToVal(xOff + pct * xDim, scaleX.key, true));

				// assumes uniform sizes, for now
				let sizes = size.values(u, seriesIdx, idx0, idx1);

				if (size.unit == 2)
					barWid = sizes[0] * xDim;
				else
					barWid = valToPosX(sizes[0], scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff); // assumes linear scale (delta from 0)

				colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);

				let gapWid = colWid - barWid;
				fullGap = gapWid + extraGap;
			}
			else {
				colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);

				let gapWid = colWid * gapFactor;

				fullGap = gapWid + extraGap;
				barWid = colWid - fullGap;
			}

			if (fullGap < 1)
				fullGap = 0;

			if (strokeWidth >= barWid / 2)
				strokeWidth = 0;

			// for small gaps, disable pixel snapping since gap inconsistencies become noticible and annoying
			if (fullGap < 5)
				pxRound = retArg0;

			let insetStroke = fullGap > 0;

			let rawBarWid = colWid - fullGap - (insetStroke ? strokeWidth : 0);

			barWid = pxRound(clamp(rawBarWid, minWidth, maxWidth));

			xShift = (_align == 0 ? barWid / 2 : _align == _dirX ? 0 : barWid) - _align * _dirX * ((_align == 0 ? extraGap / 2 : 0) + (insetStroke ? strokeWidth / 2 : 0));


			const _paths = {stroke: null, fill: null, clip: null, band: null, gaps: null, flags: 0};  // disp, geom

			const stroke = multiPath ? null : new Path2D();

			if (band != null)
				dataY0 = u._data[band.series[1]];
			else if (dataY0 == null) {
				let { y0, y1 } = disp;

				if (y0 != null && y1 != null) {
					dataY = y1.values(u, seriesIdx, idx0, idx1);
					dataY0 = y0.values(u, seriesIdx, idx0, idx1);
				}
			}

			let radVal = valRadius * barWid;
			let radBase = baseRadius * barWid;

			for (let i = _dirX == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dirX) {
				let yVal = dataY[i];

				if (yVal == null)
					continue;

				if (dataY0 != null) {
					let yVal0 = dataY0[i] ?? 0;

					if (yVal - yVal0 == 0)
						continue;

					fillToY = valToPosY(yVal0, scaleY, yDim, yOff);
				}

				let xVal = dataX[i];

				// TODO: all xPos can be pre-computed once for all series in aligned set
				let xPos = valToPosX(xVal, scaleX, xDim, xOff);
				let yPos = valToPosY(yVal, scaleY, yDim, yOff);

				let lft = pxRound(xPos - xShift);
				let btm = pxRound(max(yPos, fillToY));
				let top = pxRound(min(yPos, fillToY));
				// this includes the stroke
				let barHgt = btm - top;

				if (yVal != fillTo) {
					let rv = yPos < fillToY ? radVal : radBase;
					let rb = yPos < fillToY ? radBase : radVal;

					if (multiPath) {
						if (strokeWidth > 0 && strokeColors[i] != null)
							rect(strokePaths.get(strokeColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);

						if (fillColors[i] != null)
							rect(fillPaths.get(fillColors[i]), lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);
					}
					else
						rect(stroke, lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);

					each(u, seriesIdx, i,
						lft    - strokeWidth / 2,
						top,
						barWid + strokeWidth,
						barHgt,
					);
				}
			}

			if (strokeWidth > 0)
				_paths.stroke = multiPath ? strokePaths : stroke;
			else if (!multiPath) {
				_paths._fill = series.width == 0 ? series._fill : series._stroke ?? series._fill;
				_paths.width = 0;
			}

			_paths.fill = multiPath ? fillPaths : stroke;

			return _paths;
		});
	};
}

function splineInterp(interp, opts) {
	return (u, seriesIdx, idx0, idx1) => {
		return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			[idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);

			if (idx0 == -1)
				return null;

			let pxRound = series.pxRound;

			let alignGaps = opts?.alignGaps ?? series.alignGaps ?? 0;

			let pixelForX = val => pxRound(valToPosX(val, scaleX, xDim, xOff));
			let pixelForY = val => pxRound(valToPosY(val, scaleY, yDim, yOff));

			let moveTo, bezierCurveTo, lineTo;

			if (scaleX.ori == 0) {
				moveTo = moveToH;
				lineTo = lineToH;
				bezierCurveTo = bezierCurveToH;
			}
			else {
				moveTo = moveToV;
				lineTo = lineToV;
				bezierCurveTo = bezierCurveToV;
			}

			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);

			let firstXPos = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
			let prevXPos = firstXPos;

			let xCoords = [];
			let yCoords = [];

			let hasGap = false;

			for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
				let yVal = dataY[i];

				if (yVal != null) {
					let xVal = dataX[i];
					let xPos = pixelForX(xVal);

					xCoords.push(prevXPos = xPos);
					yCoords.push(pixelForY(dataY[i]));
				}
				else if (yVal === null)
					hasGap = true;
			}

			const _paths = {stroke: interp(xCoords, yCoords, moveTo, lineTo, bezierCurveTo, pxRound), fill: null, clip: null, band: null, gaps: null, flags: BAND_CLIP_FILL};
			const stroke = _paths.stroke;

			let [ bandFillDir, bandClipDir ] = bandFillClipDirs(u, seriesIdx);

			if (series.fill != null || bandFillDir != 0) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir);
				let fillToY = pixelForY(fillTo);

				lineTo(fill, prevXPos, fillToY);
				lineTo(fill, firstXPos, fillToY);
			}

			if (!series.spanGaps) {
			//	console.time('gaps');
				let gaps = hasGap ? findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps) : [];

			//	console.timeEnd('gaps');

			//	console.log('gaps', JSON.stringify(gaps));

				_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);

				_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
			}

			if (bandClipDir != 0) {
				_paths.band = bandClipDir == 2 ? [
					clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1),
					clipBandLine(u, seriesIdx, idx0, idx1, stroke,  1),
				] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
			}

			return _paths;

			//  if FEAT_PATHS: false in rollup.config.js
			//	u.ctx.save();
			//	u.ctx.beginPath();
			//	u.ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
			//	u.ctx.clip();
			//	u.ctx.strokeStyle = u.series[sidx].stroke;
			//	u.ctx.stroke(stroke);
			//	u.ctx.fillStyle = u.series[sidx].fill;
			//	u.ctx.fill(fill);
			//	u.ctx.restore();
			//	return null;
		});
	};
}

function monotoneCubic(opts) {
	return splineInterp(_monotoneCubic, opts);
}

// Monotone Cubic Spline interpolation, adapted from the Chartist.js implementation:
// https://github.com/gionkunz/chartist-js/blob/e7e78201bffe9609915e5e53cfafa29a5d6c49f9/src/scripts/interpolation.js#L240-L369
function _monotoneCubic(xs, ys, moveTo, lineTo, bezierCurveTo, pxRound) {
	const n = xs.length;

	if (n < 2)
		return null;

	const path = new Path2D();

	moveTo(path, xs[0], ys[0]);

	if (n == 2)
		lineTo(path, xs[1], ys[1]);
	else {
		let ms  = Array(n),
			ds  = Array(n - 1),
			dys = Array(n - 1),
			dxs = Array(n - 1);

		// calc deltas and derivative
		for (let i = 0; i < n - 1; i++) {
			dys[i] = ys[i + 1] - ys[i];
			dxs[i] = xs[i + 1] - xs[i];
			ds[i]  = dys[i] / dxs[i];
		}

		// determine desired slope (m) at each point using Fritsch-Carlson method
		// http://math.stackexchange.com/questions/45218/implementation-of-monotone-cubic-interpolation
		ms[0] = ds[0];

		for (let i = 1; i < n - 1; i++) {
			if (ds[i] === 0 || ds[i - 1] === 0 || (ds[i - 1] > 0) !== (ds[i] > 0))
				ms[i] = 0;
			else {
				ms[i] = 3 * (dxs[i - 1] + dxs[i]) / (
					(2 * dxs[i] + dxs[i - 1]) / ds[i - 1] +
					(dxs[i] + 2 * dxs[i - 1]) / ds[i]
				);

				if (!isFinite(ms[i]))
					ms[i] = 0;
			}
		}

		ms[n - 1] = ds[n - 2];

		for (let i = 0; i < n - 1; i++) {
			bezierCurveTo(
				path,
				xs[i] + dxs[i] / 3,
				ys[i] + ms[i] * dxs[i] / 3,
				xs[i + 1] - dxs[i] / 3,
				ys[i + 1] - ms[i + 1] * dxs[i] / 3,
				xs[i + 1],
				ys[i + 1],
			);
		}
	}

	return path;
}

const cursorPlots = new Set();
let mouseOwner = null;

function invalidateRects() {
	for (let u of cursorPlots)
		u.syncRect(true);
}

if (domEnv) {
	on(resize, win, invalidateRects);
	on(scroll, win, invalidateRects, true);
	on(dppxchange, win, () => { uPlot.pxRatio = pxRatio; });
}

const linearPath = linear() ;
const pointsPath = points() ;

function setDefaults(d, xo, yo, initY) {
	let d2 = initY ? [d[0], d[1]].concat(d.slice(2)) : [d[0]].concat(d.slice(1));
	return d2.map((o, i) => setDefault(o, i, xo, yo));
}

function setDefaults2(d, xyo) {
	return d.map((o, i) => i == 0 ? {} : assign({}, xyo, o));  // todo: assign() will not merge facet arrays
}

function setDefault(o, i, xo, yo) {
	return assign({}, (i == 0 ? xo : yo), o);
}

function snapNumX(self, dataMin, dataMax, scaleKey) {
	if (dataMin == null)
		return nullNullTuple;

	if (dataMin == dataMax)
		return self.scales[scaleKey].distr == 2 ? [dataMin, dataMax + 1] : rangeNum(dataMin, dataMax, rangePad, true);

	return [dataMin, dataMax];
}

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
function snapNumY(self, dataMin, dataMax) {
	return dataMin == null ? nullNullTuple : rangeNum(dataMin, dataMax, rangePad, true);
}

function snapLogY(self, dataMin, dataMax, scale) {
	return dataMin == null ? nullNullTuple : rangeLog(dataMin, dataMax, self.scales[scale].log, true);
}

const snapLogX = snapLogY;

function snapAsinhY(self, dataMin, dataMax, scale) {
	return dataMin == null ? nullNullTuple : rangeAsinh(dataMin, dataMax, self.scales[scale].log, true);
}

const snapAsinhX = snapAsinhY;

// dim is logical (getClientBoundingRect) pixels, not canvas pixels
function findIncr(minVal, maxVal, incrs, dim, minSpace) {
	let intDigits = max(numIntDigits(minVal), numIntDigits(maxVal));

	let delta = maxVal - minVal;

	let incrIdx = closestIdx((minSpace / dim) * delta, incrs);

	do {
		let foundIncr = incrs[incrIdx];
		let foundSpace = dim * foundIncr / delta;

		if (foundSpace >= minSpace && intDigits + (foundIncr < 5 ? fixedDec.get(foundIncr) : 0) <= 17)
			return [foundIncr, foundSpace];
	} while (++incrIdx < incrs.length);

	return [0, 0];
}

function pxRatioFont(font, pxRatio) {
	let fontSize, fontSizeCss;
	font = font.replace(/(\d+)px/, (m, p1) => (fontSize = round((fontSizeCss = +p1) * pxRatio)) + 'px');
	return [font, fontSize, fontSizeCss];
}

function syncFontSize(axis, pxRatio) {
	if (axis.show) {
		[axis.font, axis.labelFont].forEach(f => {
			let size = roundDec(f[2] * pxRatio, 1);
			f[0] = f[0].replace(/[0-9.]+px/, size + 'px');
			f[1] = size;
		});
	}
}

function scanScaleInternal(self, scaleKey, i0, i1, cache, allValues) {
	let data = self._data;
	let series = self.series;
	let scale = self.scales[scaleKey];

	if (data == null || scale == null)
		return nullNullTuple;

	let scaleMin = inf;
	let scaleMax = -inf;
	let log = !allValues && scale.distr == 3;

	function acc(si, data, facet, sorted, mirror) {
		if (data != null && data.length > 0) {
			let facetMin = facet.min;
			let facetMax = facet.max;

			if (!cache || self.mode == 1 && si == 0 || facetMin == null) {
				facetMin = facetMax = null;

				let _i0 = max(0, ceil(i0 ?? 0));
				let _i1 = min(data.length - 1, floor(i1 ?? data.length - 1));

				if (_i0 <= _i1)
					[facetMin, facetMax] = getMinMax(data, _i0, _i1, sorted, log);

				if (facetMin > facetMax)
					facetMin = facetMax = null;

				if (cache) {
					facet.min = facetMin;
					facet.max = facetMax;
				}
			}

			if (cache && mirror) {
				series[si].min = facetMin;
				series[si].max = facetMax;
			}

			if (facetMin != null)
				scaleMin = min(scaleMin, facetMin);
			if (facetMax != null)
				scaleMax = max(scaleMax, facetMax);
		}
	}

	if (self.mode == 1) {
		if (series[0].scale == scaleKey)
			acc(0, data[0], series[0], series[0].sorted, false);
		else {
			for (let i = 1; i < series.length; i++) {
				let s = series[i];

				if (s.show && s.scan && s.scale == scaleKey)
					acc(i, data[i], s, s.sorted, false);
			}
		}
	}
	else {
		for (let i = 1; i < series.length; i++) {
			let s = series[i];

			if (s.show && s.scan) {
				for (let fi = 0; fi < s.facets.length; fi++) {
					let facet = s.facets[fi];

					if (facet.scan && facet.scale == scaleKey)
						acc(i, data[i][fi], facet, facet.sorted, fi == 1);
				}
			}
		}
	}

	return [
		scaleMin ==  inf ? null : scaleMin,
		scaleMax == -inf ? null : scaleMax,
	];
}

function scanScale(self, scaleKey, i0, i1, cache = false) {
	return scanScaleInternal(self, scaleKey, i0, i1, cache, false);
}

function scanCached(self, scaleKey, i0, i1) {
	return scanScaleInternal(self, scaleKey, i0, i1, true, false);
}

function scanCachedX(self, scaleKey) {
	return scanScaleInternal(self, scaleKey, null, null, true, true);
}

function scanNone() {
	return nullNullTuple;
}

function scanAuto(self, scaleKey, i0, i1, viaAutoScaleX) {
	return self.scales[scaleKey].auto(self, viaAutoScaleX) ? scanCached(self, scaleKey, i0, i1) : scanNone();
}

function uPlot(opts, data, then) {
	let pxRatio$1 = opts.pxRatio ?? pxRatio;

	function setPxRatio(_pxRatio) {
		_pxRatio ??= pxRatio;

		if (_pxRatio != self.pxRatio) {
			self.pxRatio = _pxRatio;
			shouldSetCanvas = shouldLayout = true;
			commit();
		}
	}
	const self = {
		uid: rand().toString(36).slice(-6),
		mode: opts.mode ?? 1,
		pxRatio: pxRatio$1,
		setPxRatio,
	};

	self.setPxRatio = setPxRatio;
	const mode = self.mode;

	function getHPos(val, scale, dim, off) {
		let pct = scale.valToPct(val);
		return off + dim * (scale.dir == -1 ? (1 - pct) : pct);
	}

	function getVPos(val, scale, dim, off) {
		let pct = scale.valToPct(val);
		return off + dim * (scale.dir == -1 ? pct : (1 - pct));
	}

	function getPos(val, scale, dim, off) {
		return scale.ori == 0 ? getHPos(val, scale, dim, off) : getVPos(val, scale, dim, off);
	}

	self.valToPosH = getHPos;
	self.valToPosV = getVPos;

	let ready = false;
	self.status = 0;

	const can = placeTag("canvas");
	const ctx = self.ctx = can.getContext("2d", opts.ctxAttrs);

	const domRoot = opts.dom?.uplot !== false;
	const root = self.root = domRoot ? placeTag("div") : can;

	if (opts.id != null)
		root.id = opts.id;

	addClass(root, UPLOT);
	addClass(root, opts.class);

	if (domRoot && opts.title) {
		let title = placeDiv(TITLE, root);
		title.textContent = opts.title;
	}

	const hasLegend = (opts.legend?.show ?? legendOpts.show);
	const wrap = domRoot && (opts.title || hasLegend) ? placeDiv(WRAP, root) : root;

	if (domRoot && wrap == root)
		addClass(wrap, WRAP);

	const under = self.under = domRoot && opts.dom?.under !== false ? placeDiv(UNDER, wrap) : null;
	if (domRoot)
		wrap.appendChild(can);
	const over = self.over = domRoot && opts.dom?.over !== false ? placeDiv(OVER, wrap) : null;

	opts = copy(opts);

	const usePathCache = opts.cache?.paths ?? true;
	const useDataCache = opts.cache?.data ?? true;

	const pxAlign = +(opts.pxAlign ?? 1);

	const pxRound = pxRoundGen(pxAlign);

	(opts.plugins || []).forEach(p => {
		if (p.opts)
			opts = p.opts(self, opts) || opts;
	});

	const ms = opts.ms || 1e-3;

	function snapTimeX(self, dataMin, dataMax, scaleKey) {
		if (dataMin == null)
			return nullNullTuple;

		if (dataMin == dataMax) {
			let sc = self.scales[scaleKey];

			return sc.distr == 2 ? [dataMin, dataMax + 1] :
				sc.distr == 3 ? rangeLog(dataMin, dataMax, sc.log, false) :
				sc.distr == 4 ? rangeAsinh(dataMin, dataMax, sc.log, false) :
				[dataMin, dataMax + round(86400 / ms)];
		}

		return [dataMin, dataMax];
	}

	const series  = self.series = mode == 1 ?
		setDefaults(opts.series || [], xSeriesOpts, ySeriesOpts, false) :
		setDefaults2(opts.series || [null], xySeriesOpts);
	const axes    = self.axes   = setDefaults(opts.axes   || [], xAxisOpts,   yAxisOpts,    true);
	const scales  = self.scales = {};
	const stackGroups = mode == 1 ? opts.stack?.groups || EMPTY_ARR : EMPTY_ARR;
	const stackPercent = mode == 1 && opts.stack?.percent === true;
	const bands   = self.bands  = stackGroups.length == 0 ? opts.bands || [] : [];

	function initBand(b) {
		b.fill = fnOrSelf(b.fill || null);
		b.dir = b.dir ?? -1;
	}

	bands.forEach(initBand);

	const stackedSeries = [];

	stackGroups.forEach(group => {
		group.series.forEach(si => { stackedSeries[si] = true; });
	});

	const xScaleKey = mode == 2 ? series[1].facets[0].scale : series[0].scale;

	const drawOrderMap = {
		axes: drawAxesGrid,
		series: drawSeries,
	};

	const drawOrder = (opts.drawOrder || ["axes", "series"]).map(key => drawOrderMap[key]);

	function initValToPct(sc) {
		const getVal = (
			sc.distr == 3   ? val => log10(val > 0 ? val : sc.clamp(self, val, sc.min, sc.max, sc.key)) :
			sc.distr == 4   ? val => asinh(val, sc._asinh) :
			sc.distr == 100 ? val => sc.fwd(val) :
			val => val
		);

		return val => {
			let _val = getVal(val);
			let { _min, _max } = sc;
			let delta = _max - _min;
			return (_val - _min) / delta;
		};
	}

	function initScale(scaleKey) {
		let sc = scales[scaleKey];

		if (sc == null) {
			let scaleOpts = opts.scales?.[scaleKey] || EMPTY_OBJ;

			if (scaleOpts.from != null) {
				// ensure parent is initialized
				initScale(scaleOpts.from);
				// dependent scales inherit
				sc = assign({}, scales[scaleOpts.from], scaleOpts, {key: scaleKey});
				sc.valToPct = initValToPct(sc);
				scales[scaleKey] = sc;
			}
			else {
				sc = scales[scaleKey] = assign({}, (scaleKey == xScaleKey ? xScaleOpts : yScaleOpts), scaleOpts);

				sc.key = scaleKey;

				let isTime = sc.time;

				let rn = sc.range;
				let rangeYPolicy = rn == null ? rangeYAuto : null;

				let rangeIsArr = isArr(rn);

				if (scaleKey != xScaleKey || (mode == 2 && !isTime)) {
					// if range array has null limits, it should be auto
					if (rangeIsArr && (rn[0] == null || rn[1] == null)) {
						let partial = rn;
						let min = partial[0] == null ? autoRangePart : {
							hard: partial[0],
							soft: partial[0],
						};
						let max = partial[1] == null ? autoRangePart : {
							hard: partial[1],
							soft: partial[1],
						};
						rangeYPolicy = {
							zeroIf: rangeYAuto.zeroIf,
							min: partial[0] == null ? rangeYAuto.min : min,
							max: partial[1] == null ? rangeYAuto.max : max,
						};
						rn = {min, max};
						rangeIsArr = false;
					}

					if (!rangeIsArr && isObj(rn)) {
						let cfg = rn;
						// Keep the tick-aware policy assembled above for a partial range.
						if (rangeYPolicy == null && cfg.flat == null)
							rangeYPolicy = cfg;
						// this is similar to snapNumY
						rn = (self, dataMin, dataMax) => dataMin == null ? nullNullTuple : rangeNum(dataMin, dataMax, cfg);
					}
				}

				sc.range = fnOrSelf(rn || (isTime ? snapTimeX : scaleKey == xScaleKey ?
					(sc.distr == 3 ? snapLogX : sc.distr == 4 ? snapAsinhX : snapNumX) :
					(sc.distr == 3 ? snapLogY : sc.distr == 4 ? snapAsinhY : snapNumY)
				));

				if (scaleOpts.asinh == null && (rangeIsArr || sc.auto === false))
					sc.asinh = 1;

				sc.auto = fnOrSelf(sc.auto);
				sc._rangeYPolicy = rangeYPolicy;

				let scan = sc.scan ?? (rangeIsArr && rn[0] != null && rn[1] != null ? false : null);
				sc.scan = scan == null ? scanAuto : scan === true ? scanCached : scan === false ? scanNone : scan;

				sc.clamp = fnOrSelf(sc.clamp || clampScale);

				// caches for expensive ops like asinh() & log()
				sc._min = sc._max = null;

				sc.valToPct = initValToPct(sc);
			}

			sc.asinh = fnOrSelf(sc.asinh);
		}
	}

	initScale("x");
	initScale("y");

	// TODO: init scales from facets in mode: 2
	if (mode == 1) {
		series.forEach(s => {
			initScale(s.scale);
		});
	}

	axes.forEach(a => {
		initScale(a.scale);
	});

	for (let k in opts.scales)
		initScale(k);

	const scaleX = scales[xScaleKey];

	const xScaleDistr = scaleX.distr;

	let valToPosX, valToPosY;

	if (scaleX.ori == 0) {
		addClass(root, ORI_HZ);
		valToPosX = getHPos;
		valToPosY = getVPos;
		/*
		updOriDims = () => {
			xDimCan = plotWid;
			xOffCan = plotLft;
			yDimCan = plotHgt;
			yOffCan = plotTop;

			xDimCss = plotWidCss;
			xOffCss = plotLftCss;
			yDimCss = plotHgtCss;
			yOffCss = plotTopCss;
		};
		*/
	}
	else {
		addClass(root, ORI_VT);
		valToPosX = getVPos;
		valToPosY = getHPos;
		/*
		updOriDims = () => {
			xDimCan = plotHgt;
			xOffCan = plotTop;
			yDimCan = plotWid;
			yOffCan = plotLft;

			xDimCss = plotHgtCss;
			xOffCss = plotTopCss;
			yDimCss = plotWidCss;
			yOffCss = plotLftCss;
		};
		*/
	}

	const pendScales = {};
	const redrawDirty = new Set();

	let isFullyExplicit = (min, max) => min != null && max != null;
	let isFullyImplicit = (min, max) => min == null && max == null;

	function applyCalculatedRange(wsc, psc, minMax, key) {
		if (isFullyImplicit(psc.min, psc.max)) {
			wsc.min = minMax[0];
			wsc.max = minMax[1];
			return;
		}

		let minExplicit = psc.min != null;
		let maxExplicit = psc.max != null;
		let min = minExplicit ? psc.min : minMax[0];
		let max = maxExplicit ? psc.max : minMax[1];

		if (isFullyExplicit(min, max) && min > max && minExplicit != maxExplicit) {
			wsc.min = scales[key].min;
			wsc.max = scales[key].max;
		}
		else {
			wsc.min = min;
			wsc.max = max;
		}
	}

	// explicitly-set initial scales
	for (let k in scales) {
		let sc = scales[k];

		if (sc.min != null || sc.max != null) {
			pendScales[k] = {min: sc.min, max: sc.max};
			sc.min = sc.max = null;
		}
	}

//	self.tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
	const _tzDate  = (opts.tzDate || (ts => new Date(round(ts / ms))));
	const _fmtDate = (opts.fmtDate || fmtDate);

	const _timeAxisSplits = (ms == 1 ? timeAxisSplitsMs(_tzDate) : timeAxisSplitsS(_tzDate));
	const _timeAxisVals   = timeAxisVals(_tzDate, timeAxisStamps((ms == 1 ? _timeAxisStampsMs : _timeAxisStampsS), _fmtDate));
	const _timeSeriesVal  = timeSeriesVal(_tzDate, timeSeriesStamp(_timeSeriesStamp, _fmtDate));

	const activeIdxs = [];

	const legend     = (self.legend = assign({}, legendOpts, opts.legend));
	const cursor     =                (self.cursor = assign({}, cursorOpts, {drag: {y: mode == 2}}, opts.cursor));
	const showLegend = (legend.show = domRoot && (legend.show ?? legendOpts.show));
	const showCursor = cursor.show = over != null && cursor.show;
	const markers    = legend.markers;

	{
		legend.idxs = activeIdxs;

		markers.width  = fnOrSelf(markers.width);
		markers.dash   = fnOrSelf(markers.dash);
		markers.stroke = fnOrSelf(markers.stroke);
		markers.fill   = fnOrSelf(markers.fill);
	}

	let legendView;
	let legendCols;
	let multiValLegend = false;
	let NULL_LEGEND_VALUES = {};

	if (legend.live) {
		const getMultiVals = series[1] ? series[1].values : null;
		multiValLegend = getMultiVals != null;
		legendCols = multiValLegend ? getMultiVals(self, 1, 0) : {_: 0};

		for (let k in legendCols)
			NULL_LEGEND_VALUES[k] = LEGEND_DISP;
	}

	const son  = {show: true};
	const soff = {show: false};

	function handleLegendEvent(type, s, e) {
		let seriesIdx = s == null ? null : series.indexOf(s);
		if (cursor._lock || seriesIdx == -1)
			return;

		setCursorEvent(e);

		if (type == "click") {
			if ((e.ctrlKey || e.metaKey) != legend.isolate) {
				// if any other series is shown, isolate this one. else show all
				let isolate = series.some((s, i) => i > 0 && i != seriesIdx && s.show);

				series.forEach((s, i) => {
					i > 0 && setSeries(i, isolate ? (i == seriesIdx ? son : soff) : son, true, syncOpts.setSeries);
				});
			}
			else
				setSeries(seriesIdx, {show: !s.show}, true, syncOpts.setSeries);
		}
		else if (type == "focus")
			setSeries(seriesIdx, FOCUS_TRUE, true, syncOpts.setSeries);
		else if (focusedSeries != null)
			setSeries(null, FOCUS_TRUE, true, syncOpts.setSeries);
	}

	const mouseListeners = new Map();
	let globalMouseMove = false;

	function stopGlobalMouseMove() {
		if (globalMouseMove) {
			offMouse(mousemove, doc);
			globalMouseMove = false;
		}
	}

	function onMouse(ev, targ, fn, onlyTarg = true) {
		const targListeners = mouseListeners.get(targ) || {};
		const listener = cursor.bind[ev](self, targ, fn, onlyTarg);

		if (listener != null) {
			on(ev, targ, targListeners[ev] = function(e) {
				if (mouseOwner == null || mouseOwner == self.uid)
					return listener.call(this, e);
			});
			mouseListeners.set(targ, targListeners);
		}

		return listener != null;
	}

	function offMouse(ev, targ, fn) {
		const targListeners = mouseListeners.get(targ) || {};

		for (let k in targListeners) {
			if (ev == null || k == ev) {
				off(k, targ, targListeners[k]);
				delete targListeners[k];
			}
		}

		if (ev == null)
			mouseListeners.delete(targ);
	}

	let fullWidCss = 0;
	let fullHgtCss = 0;

	let plotWidCss = 0;
	let plotHgtCss = 0;

	// plot margins to account for axes
	let plotLftCss = 0;
	let plotTopCss = 0;


	let plotLft = 0;
	let plotTop = 0;
	let plotWid = 0;
	let plotHgt = 0;

	let canToCssX = 1;
	let canToCssY = 1;

	self.bbox = {left: 0, top: 0, width: 0, height: 0};

	const stackDirty = new Set();
	let shouldSetScales = false;
	let shouldSetCanvas = false;
	let shouldLayout = false;
	let shouldSetCursor = false;
	let shouldSetSelect = false;
	let shouldSetLegend = false;

	function setSize({width, height}) {
		if (width != self.width || height != self.height) {
			self.width  = fullWidCss = width;
			self.height = fullHgtCss = height;
			shouldSetCanvas = shouldLayout = true;
			commit();
		}
	}

	self.setSize = setSize;

	function sizeAxes(ori, sizes) {
		let changed = false;

		axes.forEach((axis, i) => {
			if (axis._show && axis.side % 2 == ori) {
				let size = ceil(axis.size(self, ori == 0 ? null : axis._values, i));
				changed = changed || size != axis._size;
				axis._size = size;
				sizes[axis.side] += max(0, size + (axis.label != null ? axis.labelSize : 0));
			}
		});

		return changed;
	}

	function calcPlotDim(ori, sizes) {
		let start = ori == 0 ? 3 : 0;
		let end = ori == 0 ? 1 : 2;
		let off = sizes[start] + _padding[start];
		let dim = (ori == 0 ? fullWidCss : fullHgtCss) - off - sizes[end] - _padding[end];
		let bb = self.bbox;

		if (ori == 0) {
			plotLftCss = off;
			plotWidCss = dim;
			plotLft = bb.left  = incrRound(off * pxRatio$1, 0.5);
			plotWid = bb.width = incrRound(dim * pxRatio$1, 0.5);
		}
		else {
			plotTopCss = off;
			plotHgtCss = dim;
			plotTop = bb.top    = incrRound(off * pxRatio$1, 0.5);
			plotHgt = bb.height = incrRound(dim * pxRatio$1, 0.5);
		}
	}

	function updateLayout() {
		let pxRatioChanged = pxRatio$1 != self.pxRatio;

		if (pxRatioChanged) {
			pxRatio$1 = self.pxRatio;
			axes.forEach(axis => syncFontSize(axis, pxRatio$1));
		}

		let prevLeft = plotLftCss;
		let prevTop = plotTopCss;
		let prevWidth = plotWidCss;
		let prevHeight = plotHgtCss;
		let axesChanged = false;
		let sizes = [0, 0, 0, 0];
		sidesWithAxes.fill(false);

		axes.forEach(axis => {
			let sc = scales[axis.scale];
			let show = axis.show && (sc._rawY != null ? sc._rawY[0] : sc.min) != null;
			axesChanged = axesChanged || axis._show != show;
			axis._show = show;
			axis._splits = axis._values = null;

			if (show && (axis._hasSize || axis.label != null && axis.labelSize > 0))
				sidesWithAxes[axis.side] = true;
		});

		// Height is final before vertical tick selection and measurement.
		axesChanged = sizeAxes(0, sizes) || axesChanged;
		paddingCalc("layout");
		calcPlotDim(1, sizes);

		let changedY = [];
		for (let k in scales) {
			let sc = scales[k];
			if (sc._rawY == null)
				continue;

			let result = sc._rangeY = rangeY(sc._rawY[0], sc._rawY[1], plotHgtCss, sc._rangeYPolicy, axes[sc.axis].ramp, axes[sc.axis].exact);
			// Unsupported numeric inputs have no display range or ticks, not a fallback count.
			let min = result?.min ?? null;
			let max = result?.max ?? null;
			if (sc.min != min || sc.max != max) {
				sc.min = sc._min = min;
				sc.max = sc._max = max;
				changedY.push(k);
				series.forEach(s => { if (s.scale == k) s._paths = null; });
				if (showCursor && cursor.left >= 0)
					shouldSetCursor = shouldSetLegend = true;
			}
		}

		axesCalc(1);

		axesChanged = sizeAxes(1, sizes) || axesChanged;
		calcPlotDim(0, sizes);
		axesCalc(0);

		// Overflow changes only width, not the selected ticks or axis sizes.
		paddingCalc("overflow");
		calcPlotDim(0, sizes);
		axesChanged = calcAxesRects() || axesChanged;

		let plotChanged = plotLftCss != prevLeft || plotTopCss != prevTop || plotWidCss != prevWidth || plotHgtCss != prevHeight;
		let resized = shouldSetCanvas;
		shouldSetCanvas = false;

		if (resized)
			setCanvasSize();

		if (plotChanged || pxRatioChanged)
			resetYSeries(false);

		if (plotChanged)
			resizeOverlays(prevWidth, prevHeight);

		if (showCursor && !shouldSetCursor && (plotChanged || resized))
			syncCursorPoints();

		if (resized || plotChanged || axesChanged) {
			applyLayout(plotChanged, axesChanged);
			fire("setSize");
		}

		return changedY;
	}

	function calcAxesRects() {
		let changed = false;
		// will accum +
		let off1 = plotLftCss + plotWidCss;
		let off2 = plotTopCss + plotHgtCss;
		// will accum -
		let off3 = plotLftCss;
		let off0 = plotTopCss;

		function incrOffset(side, size) {
			switch (side) {
				case 1: off1 += size; return off1 - size;
				case 2: off2 += size; return off2 - size;
				case 3: off3 -= size; return off3 + size;
				case 0: off0 -= size; return off0 + size;
			}
		}

		axes.forEach((axis, i) => {
			if (axis.show && axis._show) {
				let side = axis.side;

				let pos = incrOffset(side, axis._size);
				let lpos = axis.label != null ? incrOffset(side, axis.labelSize) : null;
				changed = changed || pos != axis._pos || lpos != axis._lpos;
				axis._pos = pos;
				axis._lpos = lpos;
			}
		});

		return changed;
	}

	if (cursor.dataIdx == null) {
		let hov = cursor.hover;

		let skip = hov.skip = new Set(hov.skip ?? []);
		skip.add(void 0); // alignment artifacts
		let prox = hov.prox = fnOrSelf(hov.prox);
		let bias = hov.bias ??= 0;

		cursor.dataIdx = (self, seriesIdx, cursorIdx, valAtPosX) => {
			if (seriesIdx == 0)
				return cursorIdx;

			let idx2 = cursorIdx;

			let _prox = prox(self, seriesIdx, cursorIdx, valAtPosX) ?? inf;
			let withProx = _prox >= 0 && _prox < inf;
			let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss;
			let cursorLft = cursor.left;

			let xValues = data[0];
			let yValues = data[seriesIdx];

			if (skip.has(yValues[cursorIdx])) {
				idx2 = null;

				let nonNullLft = null,
					nonNullRgt = null,
					j;

				if (bias == 0 || bias == -1) {
					j = cursorIdx;
					while (nonNullLft == null && --j >= i0) {
						if (!skip.has(yValues[j]))
							nonNullLft = j;
					}
				}

				if (bias == 0 || bias == 1) {
					j = cursorIdx;
					while (nonNullRgt == null && ++j <= i1) {
						if (!skip.has(yValues[j]))
							nonNullRgt = j;
					}
				}

				if (nonNullLft != null || nonNullRgt != null) {
					if (withProx) {
						let lftPos = nonNullLft == null ? -Infinity : valToPosX(xValues[nonNullLft], scaleX, xDim, 0);
						let rgtPos = nonNullRgt == null ?  Infinity : valToPosX(xValues[nonNullRgt], scaleX, xDim, 0);

						let lftDelta = cursorLft - lftPos;
						let rgtDelta = rgtPos - cursorLft;

						if (lftDelta <= rgtDelta) {
							if (lftDelta <= _prox)
								idx2 = nonNullLft;
						} else {
							if (rgtDelta <= _prox)
								idx2 = nonNullRgt;
						}
					}
					else {
						idx2 =
							nonNullRgt == null ? nonNullLft :
							nonNullLft == null ? nonNullRgt :
							cursorIdx - nonNullLft <= nonNullRgt - cursorIdx ? nonNullLft : nonNullRgt;
					}
				}
			}
			else if (withProx) {
				let dist = abs(cursorLft - valToPosX(xValues[cursorIdx], scaleX, xDim, 0));

				if (dist > _prox)
					idx2 = null;
			}

			return idx2;
		};
	}

	const setCursorEvent = e => { cursor.event = e; };

	cursor.idxs = activeIdxs;

	cursor._lock = false;

	let points = cursor.points;

	points.show   = fnOrSelf(points.show);
	points.size   = fnOrSelf(points.size);
	points.stroke = fnOrSelf(points.stroke);
	points.width  = fnOrSelf(points.width);
	points.fill   = fnOrSelf(points.fill);

	const focus = self.focus = assign({}, opts.focus || {alpha: 0.3}, cursor.focus);

	const cursorFocus = focus.prox >= 0;
	const cursorOnePt = cursorFocus && points.one;

	// series-intersection markers
	let cursorPts = [];
	// Unrounded CSS positions for visibility and resize, not the painted centers.
	let cursorPtsLft = [];
	let cursorPtsTop = [];
	let cursorPtSeries = null;

	function initCursorPt(s, si) {
		let pt = points.show(self, si);

		if (pt instanceof HTMLElement) {
			addClass(pt, CURSOR_PT);
			addClass(pt, s.class);
			elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
			over.insertBefore(pt, cursorPts[si]);

			return pt;
		}
	}

	function initSeries(s, i) {
		// auto is a deprecated name for scan.
		s.scan = s.scan ?? s.auto ?? (mode == 2 || i > 0);

		if (mode == 2 && i > 0) {
			// auto is a deprecated name for scan.
			s.facets.forEach(f => { f.scan = f.scan ?? f.auto ?? true; });
		}

		if (mode == 1 || i > 0) {
			let isTime = mode == 1 && scales[s.scale].time;

			let sv = s.value;
			s.value = isTime ? (isStr(sv) ? timeSeriesVal(_tzDate, timeSeriesStamp(sv, _fmtDate)) : sv || _timeSeriesVal) : sv || numSeriesVal;
			s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		}

		if (cursorOnePt || i > 0) {
			s.width  = s.width ?? 1;
			s.paths  = s.paths || linearPath || retNull;
			s.fillTo = fnOrSelf(s.fillTo || seriesFillTo);
			s.pxAlign = +(s.pxAlign ?? pxAlign);
			s.pxRound = pxRoundGen(s.pxAlign);

			s.stroke = fnOrSelf(s.stroke || null);
			s.fill   = fnOrSelf(s.fill || null);
			s._stroke = s._fill = s._paths = s._focus = null;

			let _ptDia = ptDia(max(1, s.width), 1);
			let points = s.points = assign({}, {
				size: _ptDia,
				width: max(1, _ptDia * .2),
				stroke: s.stroke,
				space: _ptDia * 2,
				paths: pointsPath,
				_stroke: null,
				_fill: null,
			}, s.points);
			points.show   = fnOrSelf(points.show);
			points.filter = fnOrSelf(points.filter);
			points.fill   = fnOrSelf(points.fill);
			points.stroke = fnOrSelf(points.stroke);
			points.paths  = fnOrSelf(points.paths);
			points.pxAlign = s.pxAlign;
		}


		activeIdxs.splice(i, 0, null);

		if (showCursor) {
			let pt = null;

			if (cursorOnePt) {
				if (i == 0)
					pt = initCursorPt(s, i);
			}
			else if (i > 0)
				pt = initCursorPt(s, i);

			cursorPts.splice(i, 0, pt);
			cursorPtsLft.splice(i, 0, 0);
			cursorPtsTop.splice(i, 0, 0);
		}

		focusedSeries != null && setSeriesFocus(s, i);
	}

	function addSeries(opts, si) {
		if (stackGroups.length > 0)
			return;

		si ??= series.length;

		opts = mode == 1 ? setDefault(opts, si, xSeriesOpts, ySeriesOpts) : setDefault(opts, si, {}, xySeriesOpts);

		series.splice(si, 0, opts);
		invalidateBandGroups();
		legend.values.splice(si, 0, null);
		initSeries(series[si], si);
		showLegend && invalidateLegend();
		fire("addSeries", si);
	}

	self.addSeries = addSeries;

	function delSeries(i) {
		if (stackGroups.length > 0)
			return;

		series.splice(i, 1);
		invalidateBandGroups();

		legend.values.splice(i, 1);
		showLegend && invalidateLegend();
		activeIdxs.splice(i, 1);

		if (showCursor) {
			cursorPts.splice(i, 1)[0].remove();
			cursorPtsLft.splice(i, 1);
			cursorPtsTop.splice(i, 1);
		}

		// TODO: de-init no-longer-needed scales?

		fire("delSeries", i);
	}

	self.delSeries = delSeries;

	const sidesWithAxes = [false, false, false, false];

	function initAxis(axis, i) {
		axis._show = axis.show;

		if (axis.show) {
			let isVt = axis.side % 2;

			let sc = scales[axis.scale];

			// this can occur if all series specify non-default scales
			if (sc == null) {
				axis.scale = isVt ? series[1].scale : xScaleKey;
				sc = scales[axis.scale];
			}

			// Experimental opt-in; custom and fixed range policies remain authoritative.
			let cfg = opts.scales?.[axis.scale];
			sc._axisY = sc._axisY || (sc.axis === i && mode == 1 && axis.scale != xScaleKey && isVt &&
				sc.ori == 1 && sc.distr == 1 && !sc.time && cfg?.auto !== false && sc._rangeYPolicy != null &&
				sc.from == null && !Object.values(scales).some(s => s.from == axis.scale) &&
				axis.incrs == null && axis.splits == null && opts.axes?.[i]?.space == null);

			// also set defaults for incrs & values based on axis distr
			let isTime = sc.time;

			axis._hasSize = isFn(axis.size) || axis.size > 0;

			axis.size   = fnOrSelf(axis.size);
			axis.space  = fnOrSelf(axis.space);
			axis.rotate = fnOrSelf(axis.rotate);

			if (isArr(axis.incrs)) {
				axis.incrs.forEach(incr => {
					!fixedDec.has(incr) && fixedDec.set(incr, guessDec(incr));
				});
			}

			axis.incrs  = fnOrSelf(axis.incrs  || (          sc.distr == 2 ? wholeIncrs : (isTime ? (ms == 1 ? timeIncrsMs : timeIncrsS) : numIncrs)));
			axis.splits = fnOrSelf(axis.splits || (isTime && sc.distr == 1 ? _timeAxisSplits : sc.distr == 3 ? logAxisSplits : sc.distr == 4 ? asinhAxisSplits : numAxisSplits));

			axis.stroke        = fnOrSelf(axis.stroke);
			axis.grid.stroke   = fnOrSelf(axis.grid.stroke);
			axis.ticks.stroke  = fnOrSelf(axis.ticks.stroke);
			axis.border.stroke = fnOrSelf(axis.border.stroke);

			let av = axis.values;

			axis.values = (
				// static array of tick values
				isArr(av) && !isArr(av[0]) ? fnOrSelf(av) :
				// temporal
				isTime ? (
					// config array of fmtDate string tpls
					isArr(av) ?
						timeAxisVals(_tzDate, timeAxisStamps(av, _fmtDate)) :
					// fmtDate string tpl
					isStr(av) ?
						timeAxisVal(_tzDate, av) :
					av || _timeAxisVals
				) : av || numAxisVals
			);

			axis.filter = fnOrSelf(axis.filter || (          sc.distr >= 3 && sc.log == 10 ? log10AxisValsFilt : sc.distr == 3 && sc.log == 2 ? log2AxisValsFilt : retArg1));

			axis.font      = pxRatioFont(axis.font, pxRatio$1);
			axis.labelFont = pxRatioFont(axis.labelFont, pxRatio$1);

			axis._size   = 0;

			axis._space  =
			axis._rotate =
			axis._incrs  =
			axis._found  =	// foundIncrSpace
			axis._splits =
			axis._values = null;

			if (domRoot && axis.dom && axis._hasSize)
				axis._el = placeDiv(AXIS, wrap);

			// debug
		//	axis._el.style.background = "#"  + Math.floor(Math.random()*16777215).toString(16) + '80';
		}
	}

	function autoPadSide(self, side, sidesWithAxes) {
		let [hasTopAxis, hasRgtAxis, hasBtmAxis, hasLftAxis] = sidesWithAxes;

		let ori = side % 2;
		let size = 0;

		if (ori == 0 && (hasLftAxis || hasRgtAxis))
			size = (side == 0 && !hasTopAxis || side == 2 && !hasBtmAxis ? round(xAxisOpts.size / 3) : 0);
		if (ori == 1 && (hasTopAxis || hasBtmAxis))
			size = (side == 1 && !hasRgtAxis || side == 3 && !hasLftAxis ? round(yAxisOpts.size / 2) : 0);

		return size;
	}

	const padding = self.padding = (opts.padding || [autoPadSide,autoPadSide,autoPadSide,autoPadSide]).map(p => fnOrSelf(p ?? autoPadSide));
	const _padding = self._padding = [0, 0, 0, 0];

	let dataLen;

	// rendered data window
	let i0 = null;
	let i1 = null;
	const idxs = mode == 1 ? series[0].idxs : null;

	let data0 = null;

	let viaAutoScaleX = false;

	function stackData(rawData) {
		let bandIdx = 0;
		let bandsChanged = false;

		let stackedData = rawData.slice();
		let baseData = self._base = Array(rawData.length).fill(null);

		stackGroups.forEach(group => {
			let mixed = group.dir == 0;
			let accum = Array(dataLen).fill(0);
			let negAccum = mixed ? Array(dataLen).fill(0) : null;
			let prevSeriesIdx = null;

			group.series.forEach(si => {
				let s = series[si];

				if (!s.show)
					return;

				let raw = rawData[si];

				if (raw != null) {
					let stacked = stackedData[si] = Array(raw.length);
					let base = mixed ? baseData[si] = Array(raw.length) : null;

					for (let i = 0; i < raw.length; i++) {
						let value = raw[i];
						let sums = mixed && value < 0 ? negAccum : accum;

						if (mixed)
							base[i] = value == null ? value : sums[i];

						stacked[i] = value == null ? value : (sums[i] += value);
					}
				}

				if (!mixed && prevSeriesIdx != null) {
					// Data values do not affect membership; compare edges before replacing the band.
					let prevBand = bands[bandIdx];
					bandsChanged = bandsChanged || prevBand == null || prevBand.series[0] != si || prevBand.series[1] != prevSeriesIdx;
					bands[bandIdx++] = {series: [si, prevSeriesIdx], dir: -group.dir, fill: retNull};
				}

				prevSeriesIdx = si;
			});

			if (stackPercent) {
				let negTotals = mixed ? negAccum : group.dir == -1 ? accum : null;
				if (negTotals != null) {
					for (let i = 0; i < negTotals.length; i++)
						negTotals[i] = abs(negTotals[i]);
				}

				group.series.forEach(si => {
					let stacked = stackedData[si];

					if (series[si].show && stacked != null) {
						for (let i = 0; i < stacked.length; i++) {
							if (stacked[i] != null) {
								let total = mixed && stacked[i] < 0 ? negAccum[i] : accum[i];
								stacked[i] = total == 0 ? 0 : stacked[i] / total;
								if (mixed)
									baseData[si][i] = total == 0 ? 0 : baseData[si][i] / total;
							}
						}
					}
				});
			}
		});

		bandsChanged = bandsChanged || bands.length != bandIdx;
		bands.length = bandIdx;
		if (bandsChanged)
			invalidateBandGroups();

		return stackedData;
	}

	function setScaleData(rawData) {
		let scaleData = stackGroups.length == 0 ? rawData : stackData(rawData);

		if (xScaleDistr == 2) {
			if (scaleData == rawData)
				scaleData = scaleData.slice();

			let _data0 = self._data?.[0];
			if (_data0?.length != dataLen) {
				_data0 = Array(dataLen);
				for (let i = 0; i < dataLen; i++)
					_data0[i] = i;
			}
			scaleData[0] = _data0;
		}

		self._data = data = scaleData;

		if (stackDirty.size > 0) {
			stackDirty.clear();
			shouldSetCursor = shouldSetCursor || cursor.left >= 0;
			shouldSetLegend = true;
		}
	}

	function setData(_data, _resetScales) {
		let rawData = _data ?? [];

		if (mode == 2) {
			self.data = self._data = data = rawData;
			dataLen = 0;
			for (let i = 1; i < series.length; i++)
				dataLen += data[i][0].length;
		}
		else {
			if (rawData.length == 0)
				rawData = [[]];

			self.data = rawData;
			data0 = rawData[0];
			dataLen = data0.length;
			setScaleData(rawData);
		}

		resetYSeries(true);

		fire("setData");

		// forces x axis tick values to re-generate when neither x scale nor y scale changes
		// in ordinal mode, scale range is by index, so will not change if new data has same length, but tick values are from data
		if (xScaleDistr == 2)
			shouldLayout = true;

		if (_resetScales !== false) {
			let xsc = scaleX;

			if (xsc.auto(self, viaAutoScaleX))
				autoScaleX();
			else
				setRange(xScaleKey, xsc.min, xsc.max);

			shouldSetCursor = shouldSetCursor || cursor.left >= 0;
			shouldSetLegend = true;
			commit();
		}
	}

	self.setData = setData;

	function resetAutoScaleXIdxs() {
		if (mode == 1) {
			if (dataLen > 0) {
				i0 = idxs[0] = 0;
				i1 = idxs[1] = dataLen - 1;
			}
			else {
				i0 = idxs[0] = null;
				i1 = idxs[1] = null;
			}
		}
	}

	function autoScaleX() {
		viaAutoScaleX = true;
		resetAutoScaleXIdxs();
		setRange(xScaleKey, null, null);
	}

	let ctxStroke, ctxFill, ctxWidth, ctxDash, ctxJoin, ctxCap, ctxFont, ctxAlign, ctxBaseline;
	let ctxAlpha;

	function setCtxStroke(stroke, width, dash, cap, join) {
		stroke ??= transparent;
		dash   ??= EMPTY_ARR;
		cap    ??= "butt"; // (‿|‿)
		join   ??= "round";

		if (stroke != ctxStroke)
			ctx.strokeStyle = ctxStroke = stroke;
		if (width != ctxWidth)
			ctx.lineWidth = ctxWidth = width;
		if (join != ctxJoin)
			ctx.lineJoin = ctxJoin = join;
		if (cap != ctxCap)
			ctx.lineCap = ctxCap = cap;
		if (dash != ctxDash)
			ctx.setLineDash(ctxDash = dash);
	}

	function setFontStyle(font, fill, align, baseline) {
		if (fill != ctxFill)
			ctx.fillStyle = ctxFill = fill;
		if (font != ctxFont)
			ctx.font = ctxFont = font;
		if (align != ctxAlign)
			ctx.textAlign = ctxAlign = align;
		if (baseline != ctxBaseline)
			ctx.textBaseline = ctxBaseline = baseline;
	}

	function getScan(wsc, scaleKey, i0, i1) {
		return wsc.scan(self, scaleKey, i0, i1, viaAutoScaleX);
	}

	function applyScanRange(wsc, psc, minMax, key) {
		if (wsc._axisY && isFullyImplicit(psc.min, psc.max)) {
			// Keep scanner extrema separate from rounded display bounds, including on resize.
			scales[key]._rawY = minMax;
			shouldLayout = true;
		}
		else
			applyCalculatedRange(wsc, psc, wsc.range(self, minMax[0], minMax[1], key), key);
	}

	const AUTOSCALE = {min: null, max: null};

	function setScales() {
	//	log("setScales()", arguments);

		// implicitly add auto scales, and unranged scales
		for (let k in scales) {
			let sc = scales[k];

			if (pendScales[k] == null &&
				(
					// scales that have never been set (on init)
					sc.min == null ||
					// or auto scales when the x scale has a pending update
					pendScales[xScaleKey] != null && sc.auto(self, viaAutoScaleX)
				)
			) {
				pendScales[k] = AUTOSCALE;
			}
		}

		// implicitly add dependent scales
		for (let k in scales) {
			let sc = scales[k];

			if (pendScales[k] == null && sc.from != null && pendScales[sc.from] != null)
				pendScales[k] = AUTOSCALE;
		}

		if (pendScales[xScaleKey] != null) {
			resetYSeries(false);

			for (let k in scales) {
				if (k == xScaleKey)
					continue;

				// Retain deferred invalidation when explicit bounds or auto suppress Y ranging.
				if (!pendScales[xScaleKey].redraw)
					redrawDirty.add(k);

				let psc = pendScales[k];
				if (redrawDirty.has(k) && psc != null && !isFullyExplicit(psc.min, psc.max))
					resetScaleSeries(k);
			}
		}

		let wipScales = {};

		for (let k in pendScales) {
			let psc = pendScales[k];

			if (psc != null) {
				let wsc = wipScales[k] = copy(scales[k], fastIsObj);
				if (scales[k]._rawY != null) {
					shouldLayout = true;
					scales[k]._rawY = null;
				}

				if (isFullyExplicit(psc.min, psc.max)) {
					wsc.min = psc.min;
					wsc.max = psc.max;
				}
				else if (dataLen == 0 && wsc.from == null) {
					let minMax = getScan(wsc, k);
					applyScanRange(wsc, psc, minMax, k);
				}
				else if (k != xScaleKey || mode == 2) {
					wsc.min = inf;
					wsc.max = -inf;
				}
			}
		}

		if (dataLen > 0) {
			// range the primary x-scale and set the rendered data window
			series.forEach((s, i) => {
				if (mode == 1) {
					let k = s.scale;
					let psc = pendScales[k];

					if (psc == null)
						return;

					let wsc = wipScales[k];

					if (i == 0) {
						if (!isFullyExplicit(psc.min, psc.max)) {
							let minMax = wsc.scan == scanAuto || wsc.scan == scanCached ? scanCachedX(self, k) : getScan(wsc, k);

							applyCalculatedRange(wsc, psc, wsc.range(self, minMax[0], minMax[1], k), k);
						}

						i0 = closestIdx(wsc.min, data[0]);
						i1 = closestIdx(wsc.max, data[0]);

						// don't try to contract same or adjacent idxs
						if (i1 - i0 > 1) {
							// closest indices can be outside of view
							if (data[0][i0] < wsc.min)
								i0++;
							if (data[0][i1] > wsc.max)
								i1--;
						}

						s.min = data0[i0];
						s.max = data0[i1];
					}

					s.idxs[0] = i0;
					s.idxs[1] = i1;
				}
			});

			// range independent scales
			for (let k in wipScales) {
				let wsc = wipScales[k];
				let psc = pendScales[k];

				if (wsc.from == null && !isFullyExplicit(psc.min, psc.max) && (mode == 2 || k != xScaleKey)) {
					let minMax = getScan(wsc, k, i0, i1);
					applyScanRange(wsc, psc, minMax, k);
				}
			}
		}

		// range dependent scales
		for (let k in wipScales) {
			let wsc = wipScales[k];

			if (wsc.from != null) {
				let base = wipScales[wsc.from];

				if (base.min == null)
					wsc.min = wsc.max = null;
				else {
					let minMax = wsc.range(self, base.min, base.max, k);
					wsc.min = minMax[0];
					wsc.max = minMax[1];
				}
			}
		}

		let changed = {};
		let anyChanged = false;

		for (let k in wipScales) {
			let wsc = wipScales[k];
			let sc = scales[k];
			let distr = sc.distr;

			if (sc._rawY != null)
				continue;

			if (sc.min != wsc.min || sc.max != wsc.max) {
				sc.min = wsc.min;
				sc.max = wsc.max;

				changed[k] = anyChanged = true;
			}

			if (distr == 4) {
				let linthresh = sc.asinh(self, k);

				if (sc._asinh != linthresh) {
					sc._asinh = linthresh;
					changed[k] = anyChanged = true;
				}
			}

			if (changed[k]) {
				sc._min = distr == 3 ? log10(sc.min) : distr == 4 ? asinh(sc.min, sc._asinh) : distr == 100 ? sc.fwd(sc.min) : sc.min;
				sc._max = distr == 3 ? log10(sc.max) : distr == 4 ? asinh(sc.max, sc._asinh) : distr == 100 ? sc.fwd(sc.max) : sc.max;
			}
		}

		if (anyChanged) {
			// invalidate paths of all series on changed scales
			series.forEach((s, i) => {
				if (mode == 2) {
					if (i > 0 && changed.y)
						s._paths = null;
				}
				else {
					if (changed[s.scale])
						s._paths = null;
				}
			});

			for (let k in changed) {
				shouldLayout = true;
				fire("setScale", k);
			}

			if (showCursor && cursor.left >= 0)
				shouldSetCursor = shouldSetLegend = true;
		}

		for (let k in pendScales)
			pendScales[k] = null;
	}

	// grabs the nearest indices with y data outside of x-scale limits
	function getOuterIdxs(ydata) {
		let _i0 = clamp(i0 - 1, 0, dataLen - 1);
		let _i1 = clamp(i1 + 1, 0, dataLen - 1);

		while (ydata[_i0] == null && _i0 > 0)
			_i0--;

		while (ydata[_i1] == null && _i1 < dataLen - 1)
			_i1++;

		return [_i0, _i1];
	}

	const bandEnds = [];
	const firstBand = [];
	const nextBand = [];
	const bandHasData = [];
	let bandGroupsDirty = true;

	function invalidateBandGroups() {
		bandGroupsDirty = true;
		bandEnds.length = firstBand.length = nextBand.length = bandHasData.length = 0;
	}

	function drawSeries() {
		if (dataLen > 0) {
			let shouldAlpha = series.some(s => s._focus) && ctxAlpha != focus.alpha;

			if (shouldAlpha)
				ctx.globalAlpha = ctxAlpha = focus.alpha;

			series.forEach((s, i) => {
				if (i > 0 && s.show) {
					cacheStrokeFill(i, false);
					cacheStrokeFill(i, true);

					if (s._paths == null) {
						let _ctxAlpha = ctxAlpha;

						if (ctxAlpha != s.alpha)
							ctx.globalAlpha = ctxAlpha = s.alpha;

						let _idxs = mode == 2 ? [0, data[i][0].length - 1] : getOuterIdxs(data[i]);
						s._paths = s.paths(self, i, _idxs[0], _idxs[1]);

						if (ctxAlpha != _ctxAlpha)
							ctx.globalAlpha = ctxAlpha = _ctxAlpha;
					}
				}
			});

			if (bandGroupsDirty) {
				bandEnds.length = firstBand.length = bands.length > 0 ? series.length : 0;
				bandEnds.fill(0);
				firstBand.fill(-1);
				nextBand.length = bandHasData.length = bands.length;
				bandHasData.fill(false);

				// Prepend in reverse to visit each owner's bands in their original order.
				for (let bi = bands.length - 1; bi >= 0; bi--) {
					let b = bands[bi];
					let si = b.series[0];
					nextBand[bi] = firstBand[si];
					firstBand[si] = bi;

					let lo = min(si, b.series[1]);
					let hi = max(si, b.series[1]);
					bandEnds[lo] = max(bandEnds[lo], hi);
				}

				for (let i = 1; i < bandEnds.length; i++) {
					let end = bandEnds[i];

					if (end > 0) {
						// Overlapping edge intervals include each chain's intervening series, even hidden ones.
						for (let j = i + 1; j <= end; j++)
							end = max(end, bandEnds[j]);

						bandEnds[i] = end;
						i = end;
					}
				}

				bandGroupsDirty = false;
			}

			for (let i = 1; i < series.length; i++) {
				let end = bandEnds[i] || 0;

				if (end > 0) {
					for (let j = i; j <= end; j++)
						drawSeriesPart(j, BAND_CLIP_FILL, false);
					for (let j = i; j <= end; j++)
						drawSeriesPart(j, BAND_CLIP_STROKE, false);
					for (let j = i; j <= end; j++)
						drawSeriesPart(j, 0, true);

					i = end;
				}
				else
					drawSeriesPart(i, CLIP_FILL_STROKE, true);
			}

			if (shouldAlpha)
				ctx.globalAlpha = ctxAlpha = 1;
		}
	}

	function drawSeriesPart(i, draw, _points) {
		let s = series[i];

		if (s.show) {
			let _ctxAlpha = ctxAlpha;

			if (ctxAlpha != s.alpha)
				ctx.globalAlpha = ctxAlpha = s.alpha;

			draw != 0 && s._paths != null && drawPath(i, false, draw);

			if (_points && FEAT_POINTS) {
				let _gaps = s._paths != null ? s._paths.gaps : null;

				let show = s.points.show(self, i, i0, i1, _gaps);
				let idxs = s.points.filter(self, i, show, _gaps);

				if (show || idxs) {
					s.points._paths = s.points.paths(self, i, i0, i1, idxs);
					drawPath(i, true);
				}
			}

			if (ctxAlpha != _ctxAlpha)
				ctx.globalAlpha = ctxAlpha = _ctxAlpha;

			// Group hooks run once per series, after its points and all group fills/strokes.
			_points && fire("drawSeries", i);
		}
	}

	function cacheStrokeFill(si, _points) {
		let s = _points ? series[si].points : series[si];

		s._stroke = s.stroke(self, si);
		s._fill   = s.fill(self, si);
	}

	function drawPath(si, _points, draw = CLIP_FILL_STROKE) {
		let s = _points ? series[si].points : series[si];

		let {
			stroke,
			fill,
			clip: gapsClip,
			flags,

			_stroke: strokeStyle = s._stroke,
			_fill:   fillStyle   = s._fill,
			_width:  width       = s.width,
		} = s._paths;

		// Mask paths, not styles: Map paths carry their own styles.
		if (!(draw & BAND_CLIP_STROKE))
			stroke = null;
		if (!(draw & BAND_CLIP_FILL))
			fill = null;

		width = roundDec(width * pxRatio$1, 3);

		let offset = pxOffset(width, s.pxAlign);

		if (!(width > 0) || !hasPaint(stroke, strokeStyle))
			stroke = null;

		if (!_points) {
			fillStroke(si, strokeStyle, width, s.dash, s.cap, fillStyle, stroke, fill, flags, gapsClip, draw, offset);
			return;
		}

		if (fillStyle == null)
			fillStyle = width > 0 ? "#fff" : strokeStyle;

		if (stroke == null && !hasPaint(fill, fillStyle))
			return;

		offset != 0 && ctx.translate(offset, offset);

		// the points pathbuilder's gapsClip is its boundsClip, since points dont need gaps clipping, and bounds depend on point size
		strokeFill(strokeStyle, width, s.dash, s.cap, fillStyle, stroke, fill, flags, gapsClip);

		offset != 0 && ctx.translate(-offset, -offset);
	}

	function hasPaint(path, style) {
		return path instanceof Map ? path.size > 0 : path != null && style != null;
	}

	function fillStroke(si, strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, gapsClip, draw, offset) {
		if (!(draw & BAND_CLIP_FILL) && strokePath == null)
			return;

		let boundsClip = null;
		let bi = flags != 0 ? firstBand[si] ?? -1 : -1;

		// With no owner or zero flags, paint once without band clipping.
		do {
			let b = bi == -1 ? null : bands[bi];
			let bandClip = null;
			let gapsClip2;
			let _fillStyle = fillStyle;

			if (b != null) {
				let lowerEdge = series[b.series[1]];
				let lowerData = data[b.series[1]];

				bandClip = (lowerEdge._paths || EMPTY_OBJ).band;

				if (isArr(bandClip))
					bandClip = b.dir == 1 ? bandClip[0] : bandClip[1];

				_fillStyle = null;

				// Reuse the lower-data check in the stroke pass.
				if (draw & BAND_CLIP_FILL)
					bandHasData[bi] = lowerEdge.show && bandClip != null && hasData(lowerData, i0, i1);

				if (bandHasData[bi]) {
					if (draw & BAND_CLIP_FILL)
						_fillStyle = b.fill(self, bi) || fillStyle;
					gapsClip2 = lowerEdge._paths.clip;
				}
				else
					bandClip = null;
			}

			if (strokePath == null && !hasPaint(fillPath, _fillStyle))
				continue;

			if (boundsClip == null) {
				boundsClip = new Path2D();
				boundsClip.rect(plotLft - lineWidth / 2, plotTop - lineWidth / 2, plotWid + lineWidth, plotHgt + lineWidth);
				offset != 0 && ctx.translate(offset, offset);
			}

			strokeFill(strokeStyle, lineWidth, lineDash, lineCap, _fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip, gapsClip2, bandClip);
		} while (bi != -1 && (bi = nextBand[bi]) != -1);

		boundsClip != null && offset != 0 && ctx.translate(-offset, -offset);
	}

	const CLIP_FILL_STROKE = BAND_CLIP_FILL | BAND_CLIP_STROKE;

	function strokeFill(strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip, gapsClip2, bandClip) {
		let canFill = hasPaint(fillPath, fillStyle);
		let canStroke = lineWidth > 0 && hasPaint(strokePath, strokeStyle);

		if (!canFill && !canStroke)
			return;

		// Keep the original flags: BOTH also clips strokes to the lower edge's gaps.
		if (!(canFill && (flags & BAND_CLIP_FILL) || canStroke && (flags & BAND_CLIP_STROKE)))
			bandClip = null;

		if (canStroke)
			setCtxStroke(strokeStyle, lineWidth, lineDash, lineCap);
		if (canFill) {
			let fill = fillStyle ?? transparent;
			if (fill != ctxFill)
				ctx.fillStyle = ctxFill = fill;
		}

		// Map paints change these shadows inside the saved canvas state.
		let _ctxFill = ctxFill;
		let _ctxStroke = ctxStroke;

		if (boundsClip || gapsClip || bandClip) {
			ctx.save();
			boundsClip && ctx.clip(boundsClip);
			gapsClip && ctx.clip(gapsClip);
		}

		if (bandClip) {
			if ((flags & CLIP_FILL_STROKE) == CLIP_FILL_STROKE) {
				ctx.clip(bandClip);
				gapsClip2 && ctx.clip(gapsClip2);
				doFill(fillStyle, fillPath);
				doStroke(strokeStyle, strokePath, lineWidth);
			}
			else if (flags & BAND_CLIP_STROKE) {
				doFill(fillStyle, fillPath);
				ctx.clip(bandClip);
				doStroke(strokeStyle, strokePath, lineWidth);
			}
			else if (flags & BAND_CLIP_FILL) {
				canStroke && ctx.save();
				ctx.clip(bandClip);
				gapsClip2 && ctx.clip(gapsClip2);
				doFill(fillStyle, fillPath);
				if (canStroke) {
					ctx.restore();
					ctxFill = _ctxFill;
					ctxStroke = _ctxStroke;
					doStroke(strokeStyle, strokePath, lineWidth);
				}
			}
		}
		else {
			doFill(fillStyle, fillPath);
			doStroke(strokeStyle, strokePath, lineWidth);
		}

		if (boundsClip || gapsClip || bandClip) {
			ctx.restore();
			ctxFill = _ctxFill;
			ctxStroke = _ctxStroke;
		}
	}

	function doStroke(strokeStyle, strokePath, lineWidth) {
		if (lineWidth > 0) {
			if (strokePath instanceof Map) {
				strokePath.forEach((strokePath, strokeStyle) => {
					ctx.strokeStyle = ctxStroke = strokeStyle;
					ctx.stroke(strokePath);
				});
			}
			else
				strokePath != null && strokeStyle != null && ctx.stroke(strokePath);
		}
	}

	function doFill(fillStyle, fillPath) {
		if (fillPath instanceof Map) {
			fillPath.forEach((fillPath, fillStyle) => {
				ctx.fillStyle = ctxFill = fillStyle;
				ctx.fill(fillPath);
			});
		}
		else
			fillPath != null && fillStyle != null && ctx.fill(fillPath);
	}

	function getIncrSpace(axisIdx, min, max, fullDim) {
		let axis = axes[axisIdx];

		let incrSpace;
		let sc = scales[axis.scale];

		if (sc._rawY != null && sc.axis == axisIdx) {
			let result = sc._rangeY;
			incrSpace = result?.count > 0 ? [result.incr, fullDim / result.count] : [0, 0];
			axis._space = incrSpace[1];
			axis._incrs = numIncrs;
		}
		else if (fullDim <= 0)
			incrSpace = [0, 0];
		else {
			let minSpace = axis._space = axis.space(self, axisIdx, min, max, fullDim);
			let incrs    = axis._incrs = axis.incrs(self, axisIdx, min, max, fullDim, minSpace);
			incrSpace    = findIncr(min, max, incrs, fullDim, minSpace);
		}

		return (axis._found = incrSpace);
	}

	function drawOrthoLines(offs, filts, ori, side, pos0, len, width, stroke, dash, cap) {
		let offset = (width % 2) / 2;

		pxAlign == 1 && offset != 0 && ctx.translate(offset, offset);

		setCtxStroke(stroke, width, dash, cap);

		ctx.beginPath();

		let x0, y0, x1, y1, pos1 = pos0 + (side == 0 || side == 3 ? -len : len);

		if (ori == 0) {
			y0 = pos0;
			y1 = pos1;
		}
		else {
			x0 = pos0;
			x1 = pos1;
		}

		for (let i = 0; i < offs.length; i++) {
			if (filts[i] != null) {
				if (ori == 0)
					x0 = x1 = offs[i];
				else
					y0 = y1 = offs[i];

				ctx.moveTo(x0, y0);
				ctx.lineTo(x1, y1);
			}
		}

		ctx.stroke();

		pxAlign == 1 && offset != 0 && ctx.translate(-offset, -offset);
	}

	function axesCalc(ori) {
		axes.forEach((axis, i) => {
			if (!axis._show || axis.side % 2 != ori)
				return;

			let scale = scales[axis.scale];
			let {min, max} = scale;

			let [_incr, _space] = getIncrSpace(i, min, max, ori == 0 ? plotWidCss : plotHgtCss);

			if (_space == 0) {
				axis._splits = axis._values = [];
				axis._rotate = 0;
				return;
			}

			// if we're using index positions, force first tick to match passed index
			let rangedY = scale._rawY != null && scale.axis == i;
			let forceMin = scale.distr == 2 || rangedY;

			let _splits = axis._splits = rangedY && scale._rangeY.count == 1 ? [min, max] :
				axis.splits(self, i, min, max, _incr, _space, forceMin);

			// tick labels
			// BOO this assumes a specific data/series
			let splits = scale.distr == 2 ? _splits.map(i => data0[i]) : _splits;
			let incr   = scale.distr == 2 ? data0[_splits[1]] - data0[_splits[0]] : _incr;

			let values = axis._values = axis.values(self, axis.filter(self, splits, i, _space, incr), i, _space, incr);

			// rotating of labels only supported on bottom x axis
			axis._rotate = axis.side == 2 ? axis.rotate(self, values, i, _space) : 0;

		});
	}

	function paddingCalc(phase) {
		// Both overflow callbacks see the same provisional geometry and padding.
		let next = padding.map((p, i) => phase == "layout" || i % 2 == 1 ? p(self, i, sidesWithAxes, phase) : _padding[i]);
		next.forEach((p, i) => { _padding[i] = p; });
	}

	function drawAxesGrid() {
		for (let i = 0; i < axes.length; i++) {
			let axis = axes[i];

			if (!axis.show || !axis._show)
				continue;

			let side = axis.side;
			let ori = side % 2;

			let x, y;

			let fillStyle = axis.stroke(self, i);

			let shiftDir = side == 0 || side == 3 ? -1 : 1;

			let [_incr, _space] = axis._found;

			// axis label
			if (axis.label != null) {
				let shiftAmt = axis.labelGap * shiftDir;
				let baseLpos = round((axis._lpos + shiftAmt) * pxRatio$1);

				setFontStyle(axis.labelFont[0], fillStyle, "center", side == 2 ? TOP : BOTTOM);

				ctx.save();

				if (ori == 1) {
					x = y = 0;

					ctx.translate(
						baseLpos,
						round(plotTop + plotHgt / 2),
					);
					ctx.rotate((side == 3 ? -PI : PI) / 2);

				}
				else {
					x = round(plotLft + plotWid / 2);
					y = baseLpos;
				}

				let _label = isFn(axis.label) ? axis.label(self, i, _incr, _space) : axis.label;

				ctx.fillText(_label, x, y);

				ctx.restore();
			}

			if (_space == 0)
				continue;

			let scale = scales[axis.scale];

			let plotDim = ori == 0 ? plotWid : plotHgt;
			let plotOff = ori == 0 ? plotLft : plotTop;

			let _splits = axis._splits;

			// tick labels
			// BOO this assumes a specific data/series
			let splits = scale.distr == 2 ? _splits.map(i => data0[i]) : _splits;
			let incr   = scale.distr == 2 ? data0[_splits[1]] - data0[_splits[0]] : _incr;

			let ticks = axis.ticks;
			let border = axis.border;
			let _tickSize = ticks.show ? ticks.size : 0;
			let tickSize = round(_tickSize * pxRatio$1);
			let axisGap = round((axis.alignTo == 2 ? axis._size - _tickSize - axis.gap : axis.gap) * pxRatio$1);

			// rotating of labels only supported on bottom x axis
			let angle = axis._rotate * -PI/180;

			let basePos  = pxRound(axis._pos * pxRatio$1);
			let shiftAmt = (tickSize + axisGap) * shiftDir;
			let finalPos = basePos + shiftAmt;
			    y        = ori == 0 ? finalPos : 0;
			    x        = ori == 1 ? finalPos : 0;

			let font         = axis.font[0];
			let textAlign    = axis.align == 1 ? LEFT :
			                   axis.align == 2 ? RIGHT :
			                   angle > 0 ? LEFT :
			                   angle < 0 ? RIGHT :
			                   ori == 0 ? "center" : side == 3 ? RIGHT : LEFT;
			let textBaseline = angle ||
			                   ori == 1 ? "middle" : side == 2 ? TOP   : BOTTOM;

			setFontStyle(font, fillStyle, textAlign, textBaseline);

			let lineHeight = axis.font[1] * axis.lineGap;

			let canOffs = _splits.map(val => pxRound(getPos(val, scale, plotDim, plotOff)));

			let _values = axis._values;

			for (let i = 0; i < _values.length; i++) {
				let val = _values[i];

				if (val != null) {
					if (ori == 0)
						x = canOffs[i];
					else
						y = canOffs[i];

					val = "" + val;

					let _parts = val.indexOf("\n") == -1 ? [val] : val.split(/\n/gm);

					for (let j = 0; j < _parts.length; j++) {
						let text = _parts[j];

						if (angle) {
							ctx.save();
							ctx.translate(x, y + j * lineHeight); // can this be replaced with position math?
							ctx.rotate(angle); // can this be done once?
							ctx.fillText(text, 0, 0);
							ctx.restore();
						}
						else
							ctx.fillText(text, x, y + j * lineHeight);
					}
				}
			}

			// ticks
			if (ticks.show) {
				drawOrthoLines(
					canOffs,
					ticks.filter(self, splits, i, _space, incr),
					ori,
					side,
					basePos,
					tickSize,
					roundDec(ticks.width * pxRatio$1, 3),
					ticks.stroke(self, i),
					ticks.dash,
					ticks.cap,
				);
			}

			// grid
			let grid = axis.grid;

			if (grid.show) {
				drawOrthoLines(
					canOffs,
					grid.filter(self, splits, i, _space, incr),
					ori,
					ori == 0 ? 2 : 1,
					ori == 0 ? plotTop : plotLft,
					ori == 0 ? plotHgt : plotWid,
					roundDec(grid.width * pxRatio$1, 3),
					grid.stroke(self, i),
					grid.dash,
					grid.cap,
				);
			}

			if (border.show) {
				drawOrthoLines(
					[basePos],
					[1],
					ori == 0 ? 1 : 0,
					ori == 0 ? 1 : 2,
					ori == 1 ? plotTop : plotLft,
					ori == 1 ? plotHgt : plotWid,
					roundDec(border.width * pxRatio$1, 3),
					border.stroke(self, i),
					border.dash,
					border.cap,
				);
			}
		}

		fire("drawAxes");
	}

	function resetScaleSeries(scaleKey) {
		redrawDirty.delete(scaleKey);
		series.forEach((s, i) => {
			if (i > 0) {
				if (mode == 1) {
					if (s.scale == scaleKey)
						s.min = s.max = null;
				}
				else {
					s.facets.forEach((facet, fi) => {
						if (facet.scale == scaleKey) {
							facet.min = facet.max = null;

							if (fi == 1)
								s.min = s.max = null;
						}
					});
				}
			}
		});
	}

	function resetYSeries(minMax) {
	//	log("resetYSeries()", arguments);

		if (minMax)
			redrawDirty.clear();

		series.forEach((s, i) => {
			if (i > 0) {
				s._paths = null;

				if (minMax) {
					if (mode == 1) {
						s.min = null;
						s.max = null;
					}
					else {
						s.facets.forEach(f => {
							f.min = null;
							f.max = null;
						});
					}
				}
			}
		});
	}

	let destroyed = false;
	let queuedCommit = false;
	let queuedFrame = null;
	let shouldRenderLegend = false;

	function invalidateLegend() {
		shouldRenderLegend = true;
		if (!destroyed && queuedFrame == null)
			queuedFrame = requestAnimationFrame(flushFrame);
	}

	function flushFrame() {
		queuedFrame = null;
		if (!destroyed && shouldRenderLegend) {
			// Clear before rendering so callbacks can request another frame.
			shouldRenderLegend = false;
			legendView.render(legend.values, focusedSeries);
		}
	}

	let deferHooks = false;
	let hooksQueue = [];

	function flushHooks() {
		deferHooks = false;

		for (let i = 0; i < hooksQueue.length; i++)
			fire(...hooksQueue[i]);

		hooksQueue.length = 0;
	}

	function commit() {
		if (!destroyed && !queuedCommit) {
			let run = queuedCommit = () => {
				// A synchronous batch invalidates this callback, not any later queued work.
				if (queuedCommit == run)
					_commit();
			};
			microTask(run);
		}
	}

	// manual batching (aka immediate mode), skips microtask queue
	function batch(fn, _deferHooks = false) {
		queuedCommit = true;
		deferHooks = _deferHooks;

		fn(self);
		_commit();

		if (_deferHooks && hooksQueue.length > 0)
			queueMicrotask(flushHooks);
	}

	self.batch = batch;

	function setCanvasSize() {
		setStylePx(wrap, WIDTH,  fullWidCss);
		setStylePx(wrap, HEIGHT, fullHgtCss);

		let width = round(fullWidCss * pxRatio$1);
		let height = round(fullHgtCss * pxRatio$1);
		canToCssX = fullWidCss / width;
		canToCssY = fullHgtCss / height;
		let reset = !ready || can.width != width || can.height != height;

		if (!ready || can.width != width)
			can.width = width;
		if (!ready || can.height != height)
			can.height = height;

		if (reset) {
			ctxStroke = ctxFill = ctxWidth = ctxJoin = ctxCap = ctxFont = ctxAlign = ctxBaseline = ctxDash = null;
			ctxAlpha = 1;
		}
	}

	function applyLayout(plotChanged, axesChanged) {
		if (plotChanged) {
			if (under != null) {
				setStylePx(under, LEFT,   plotLftCss);
				setStylePx(under, TOP,    plotTopCss);
				setStylePx(under, WIDTH,  plotWidCss);
				setStylePx(under, HEIGHT, plotHgtCss);
			}

			if (over != null) {
				setStylePx(over, LEFT,   plotLftCss);
				setStylePx(over, TOP,    plotTopCss);
				setStylePx(over, WIDTH,  plotWidCss);
				setStylePx(over, HEIGHT, plotHgtCss);
			}
		}

		if (plotChanged || axesChanged) {
			axes.forEach(({ _el, _show, _size, _pos, side }) => {
				if (_el != null) {
					if (_show) {
						let posOffset = (side == 3 || side == 0 ? _size : 0);
						let isVt = side % 2 == 1;

						setStylePx(_el, isVt ? "left"   : "top",    _pos - posOffset);
						setStylePx(_el, isVt ? "width"  : "height", _size);
						setStylePx(_el, isVt ? "top"    : "left",   isVt ? plotTopCss : plotLftCss);
						setStylePx(_el, isVt ? "height" : "width",  isVt ? plotHgtCss : plotWidCss);

						remClass(_el, OFF);
					}
					else
						addClass(_el, OFF);
				}
			});
		}

		syncRect(true);
	}

	function resizeOverlays(prevWidth, prevHeight) {
		let pctWid = plotWidCss / prevWidth;
		let pctHgt = plotHgtCss / prevHeight;

		if (showCursor && !shouldSetCursor && cursor.left >= 0) {
			cursor.left *= pctWid;
			cursor.top  *= pctHgt;

			vCursor && elTrans(vCursor, round(cursor.left), 0, plotWidCss, plotHgtCss);
			hCursor && elTrans(hCursor, 0, round(cursor.top), plotWidCss, plotHgtCss);

			for (let i = 0; i < cursorPts.length; i++) {
				let pt = cursorPts[i];

				if (pt != null) {
					cursorPtsLft[i] *= pctWid;
					cursorPtsTop[i] *= pctHgt;
				}
			}
		}

		if (select.show && !shouldSetSelect && select.left >= 0 && select.width > 0) {
			select.left   *= pctWid;
			select.width  *= pctWid;
			select.top    *= pctHgt;
			select.height *= pctHgt;

			for (let prop in _hideProps)
				setStylePx(selectDiv, prop, select[prop]);
		}
	}

	function _commit() {
	//	log("_commit()", arguments);

		if (destroyed)
			return;

		if (stackDirty.size > 0) {
			stackDirty.forEach(resetScaleSeries);
			setScaleData(self.data);
			resetYSeries(false);
			shouldSetScales = true;
		}

		if (shouldSetScales) {
			setScales();
			shouldSetScales = false;
			viaAutoScaleX = false;
		}

		if (shouldLayout) {
			let changedY = updateLayout();
			shouldLayout = false;
			for (let k of changedY)
				fire("setScale", k);
		}

		let didDraw = fullWidCss > 0 && fullHgtCss > 0;
		if (didDraw) {
			ctx.clearRect(0, 0, can.width, can.height);
			fire("drawClear");
			drawOrder.forEach(fn => fn());
			fire("draw");
		}

		if (select.show && shouldSetSelect) {
			setSelect(select);
			shouldSetSelect = false;
		}

		if (showCursor && shouldSetCursor) {
			updateCursor(null, true, false);
			shouldSetCursor = false;
		}

		if (legend.show && legend.live && shouldSetLegend) {
			setLegend();
			shouldSetLegend = false; // redundant currently
		}

		queuedCommit = false;

		// Late hooks can request work after its phase has already finished.
		if (stackDirty.size > 0 || shouldSetScales || shouldLayout)
			commit();

		if (!usePathCache)
			clearPathCache();

		// Keep data needed by a pending render.
		if (!useDataCache && didDraw && stackDirty.size == 0 && !shouldSetScales && !shouldLayout)
			clearDataCache();

		if (!ready) {
			ready = true;
			self.status = 1;

			// Setters in ready can schedule a follow-up commit.
			fire("ready");
		}
	}

	function clearPathCache() {
		series.forEach((s, i) => {
			if (i > 0)
				s._paths = null;
		});
	}

	function clearDataCache() {
		// TODO: Require all interactive/data-dependent features to be disabled (cursor, legend toggling, resize, DPR updates, etc.).
		let emptyData = src => mode == 1 ? src.map(() => []) : src.map(facets => facets == null ? facets : facets.map(() => []));
		self.data = self._data = data = emptyData(self.data);
		self._base = null;
		data0 = mode == 1 ? data[0] : null;
		dataLen = 0;

		if (opts.data != null)
			opts.data = emptyData(opts.data);
	}

	self.clearCache = targets => {
		if (targets == null || targets.paths === true || targets.data === true)
			invalidateBandGroups();
		if (targets == null || targets.paths === true)
			clearPathCache();
		if (targets == null || targets.data === true)
			clearDataCache();
	};

	self.redraw = (rebuildPaths, recalcAxes) => {
		shouldLayout = shouldLayout || recalcAxes || false;

		if (rebuildPaths !== false) {
			// Preserve real pending requests. Current ordinal bounds are already index values.
			pendScales[xScaleKey] ??= { min: scaleX.min, max: scaleX.max, redraw: true };
			shouldSetScales = true;
		}

		commit();
	};


	function setRange(key, min, max) {
		let sc = scales[key];

		if (sc.from == null) {
			if (isFullyExplicit(min, max)) {
				if (min > max)
					return;

				if (dataLen > 1 && max - min < 1e-16)
					return;
			}

			if (key == xScaleKey && sc.distr == 2 && dataLen > 0) {
				if (min != null)
					min = closestIdx(min, data[0]);
				if (max != null)
					max = closestIdx(max, data[0]);

				if (min != null && min == max)
					max++;
			}

		//	log("setRange()", arguments);

			pendScales[key] = {min, max};

			shouldSetScales = true;
			commit();
		}
	}

	self.setRange = setRange;

	function setScale(key, opts) {
		setRange(key, opts.min, opts.max);
	}

	self.setScale = setScale;

//	INTERACTION

	let xCursor;
	let yCursor;
	let vCursor;
	let hCursor;

	// starting position before cursor.move
	let rawMouseLeft0;
	let rawMouseTop0;

	// starting position
	let mouseLeft0;
	let mouseTop0;

	// current position before cursor.move
	let rawMouseLeft1;
	let rawMouseTop1;

	// current position
	let mouseLeft1;
	let mouseTop1;

	let dragging = false;

	const drag = cursor.drag;

	drag.setRange = drag.setScale ?? drag.setRange;

	let dragX = drag.x;
	let dragY = drag.y;

	if (showCursor) {
		if (cursor.x)
			xCursor = placeDiv(CURSOR_X, over);
		if (cursor.y)
			yCursor = placeDiv(CURSOR_Y, over);

		if (scaleX.ori == 0) {
			vCursor = xCursor;
			hCursor = yCursor;
		}
		else {
			vCursor = yCursor;
			hCursor = xCursor;
		}

		mouseLeft1 = cursor.left;
		mouseTop1 = cursor.top;
	}

	const select = self.select = assign({
		show:   true,
		over:   true,
		left:   0,
		width:  0,
		top:    0,
		height: 0,
	}, opts.select);

	const selectParent = select.over ? over : under;
	select.show = selectParent != null && select.show;
	const selectDiv = select.show ? placeDiv(SELECT, selectParent) : null;

	function setSelect(opts, _fire) {
		if (select.show) {
			for (let prop in opts) {
				select[prop] = opts[prop];

				if (prop in _hideProps)
					setStylePx(selectDiv, prop, opts[prop]);
			}

			_fire !== false && fire("setSelect");
		}
	}

	self.setSelect = setSelect;

	function hideCursorPoint(i) {
		let s = series[i];

		if (!s.show && showCursor) {
			let pt = cursorOnePt ? cursorPts[0] : cursorPts[i];
			pt != null && elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
		}
	}

	function setSeriesShow(i, show) {
		let s = series[i];
		let showChanged = s.show != show;
		if (showLegend && showChanged)
			invalidateLegend();
		s.show = show;
		hideCursorPoint(i);

		if (showChanged && stackedSeries[i])
			stackDirty.add(s.scale);

		if (mode == 2) {
			setRange(s.facets[0].scale, null, null);
			setRange(s.facets[1].scale, null, null);
		}
		else
			setRange(s.scale, null, null);

		commit();
	}

	function setSeries(i, opts, _fire, _pub) {
	//	log("setSeries()", arguments);

		if (opts.focus != null)
			setFocus(i);

		if (opts.show != null) {
			if (i == null) {
				series.forEach((s, si) => {
					if (si > 0)
						setSeriesShow(si, opts.show);
				});
			}
			else {
				let si = +i;
				if (si > 0 && si < series.length && si % 1 == 0)
					setSeriesShow(si, opts.show);
			}
		}

		_fire !== false && fire("setSeries", i, opts);

		_pub && pubSync("setSeries", self, i, opts);
	}

	self.setSeries = setSeries;

	function setBand(bi, opts) {
		assign(bands[bi], opts);
		invalidateBandGroups();
	}

	function addBand(opts, bi) {
		initBand(opts);
		bi = bi == null ? bands.length : bi;
		bands.splice(bi, 0, opts);
		invalidateBandGroups();
	}

	function delBand(bi) {
		if (bi == null)
			bands.length = 0;
		else
			bands.splice(bi, 1);
		invalidateBandGroups();
	}

	self.addBand = addBand;
	self.setBand = setBand;
	self.delBand = delBand;

	function setAlpha(i, value) {
		series[i].alpha = value;

		if (showCursor && cursorPts[i] != null)
			cursorPts[i].style.opacity = value;

	}

	let focusedSeries = null;
	const FOCUS_TRUE  = {focus: true};

	function setSeriesFocus(s, i) {
		if (mode == 1 || i > 0) {
			let allFocused = focusedSeries == null;
			let isFocused = allFocused || i == 0 || s == focusedSeries;
			s._focus = allFocused ? null : isFocused;
			focus.alpha != 1 && setAlpha(i, isFocused ? 1 : focus.alpha);
		}
	}

	function setFocus(i) {
		let focused = i == null ? null : series[i];
		if (focused != focusedSeries) {
		//	log("setFocus()", arguments);

			focusedSeries = focused;
			series.forEach(setSeriesFocus);
			if (focus.alpha != 1) {
				showLegend && invalidateLegend();
				commit();
			}
			return true;
		}
		return false;
	}


	function posToVal(pos, scale, can) {
		let sc = scales[scale];

		// Use the same rounded rectangle as valToPos(), including before a pending resize commits.
		if (can)
			pos -= sc.ori == 1 ? plotTop : plotLft;

		let dim = can ? plotWid : plotWidCss;

		if (sc.ori == 1) {
			dim = can ? plotHgt : plotHgtCss;
			pos = dim - pos;
		}

		if (sc.dir == -1)
			pos = dim - pos;

		let _min = sc._min,
			_max = sc._max,
			pct = pos / dim;

		let sv = _min + (_max - _min) * pct;

		let distr = sc.distr;

		return (
			distr == 3 ? pow(10, sv) :
			distr == 4 ? sinh(sv, sc._asinh) :
			distr == 100 ? sc.bwd(sv) :
			sv
		);
	}

	function closestIdxFromXpos(pos, can) {
		let v = posToVal(pos, xScaleKey, can);
		return closestIdx(v, data[0], i0, i1);
	}

	self.valToIdx = val => closestIdx(val, data[0]);
	self.posToIdx = closestIdxFromXpos;
	self.posToVal = posToVal;
	self.valToPos = (val, scale, can) => (
		scales[scale].ori == 0 ?
		getHPos(val, scales[scale],
			can ? plotWid : plotWidCss,
			can ? plotLft : 0,
		) :
		getVPos(val, scales[scale],
			can ? plotHgt : plotHgtCss,
			can ? plotTop : 0,
		)
	);

	self.setCursor = (opts, _fire, _pub) => {
		mouseLeft1 = opts.left;
		mouseTop1 = opts.top;
	//	assign(cursor, opts);
		updateCursor(null, _fire, _pub);
	};

	function setSelH(off, dim) {
		setStylePx(selectDiv, LEFT,  select.left = off);
		setStylePx(selectDiv, WIDTH, select.width = dim);
	}

	function setSelV(off, dim) {
		setStylePx(selectDiv, TOP,    select.top = off);
		setStylePx(selectDiv, HEIGHT, select.height = dim);
	}

	let setSelX = scaleX.ori == 0 ? setSelH : setSelV;
	let setSelY = scaleX.ori == 1 ? setSelH : setSelV;

	function setLegend(opts, _fire) {
		if (opts != null) {
			if (opts.idxs) {
				opts.idxs.forEach((didx, sidx) => {
					activeIdxs[sidx] = didx;
				});
			}
			else if (!isUndef(opts.idx))
				activeIdxs.fill(opts.idx);

			legend.idx = activeIdxs[0];
		}

		if (showLegend && legend.live) {
			for (let sidx = 0; sidx < series.length; sidx++) {
				if (sidx > 0 || mode == 1 && !multiValLegend)
					setLegendValues(sidx, activeIdxs[sidx]);
			}

			invalidateLegend();
		}

		shouldSetLegend = false;

		_fire !== false && fire("setLegend");
	}

	self.setLegend = setLegend;

	function setLegendValues(sidx, idx) {
		let s = series[sidx];
		let src = self.data[sidx];

		if (multiValLegend)
			legend.values[sidx] = s.values(self, sidx, idx) ?? NULL_LEGEND_VALUES;
		else {
			let val = s.value(self, idx == null ? null : src[idx], sidx, idx);
			(legend.values[sidx] ??= {})._ = val ?? LEGEND_DISP;
		}
	}

	function setCursorPointPos(pt, si, left, top) {
		let s = series[si];

		if (cursor.left < 0 || s == null || !s.show) {
			elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
			return;
		}

		if (points.bbox != null) {
			elTrans(pt, ceil(left), ceil(top), plotWidCss, plotHgtCss);
			return;
		}

		let idx = activeIdxs[si];
		let sx, sy, xVal, yVal;

		if (mode == 1) {
			sx = scaleX;
			sy = scales[s.scale];
			xVal = data[0]?.[idx];
			yVal = data[si]?.[idx];
		}
		else {
			let d = data[si];
			sx = scales[s.facets[0].scale];
			sy = scales[s.facets[1].scale];
			xVal = d?.[0]?.[idx];
			yVal = d?.[1]?.[idx];
		}

		if (idx == null || xVal == null || yVal == null) {
			elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
			return;
		}

		let off = left < 0 || top < 0 || left > plotWidCss || top > plotHgtCss;

		if (!off) {
			let sh, sv, hVal, vVal;

			if (sx.ori == 0) {
				sh = sx;
				sv = sy;
				hVal = xVal;
				vVal = yVal;
			}
			else {
				sh = sy;
				sv = sx;
				hVal = yVal;
				vVal = xVal;
			}

			let x = pointPos(hVal, sh, plotWid, plotLft, getHPos, s.pxRound);
			let y = pointPos(vVal, sv, plotHgt, plotTop, getVPos, s.pxRound);
			let sp = s.points;
			let offset = pxOffset(roundDec((sp._paths?._width ?? sp.width) * pxRatio$1, 3), sp.pxAlign);

			// Match the painted canvas center, without another CSS-pixel snap.
			left = (x + offset) * canToCssX - plotLftCss;
			top = (y + offset) * canToCssY - plotTopCss;
		}
		else {
			left = ceil(left);
			top = ceil(top);
		}

		// A painted center can extend past the plot edge after pixel alignment.
		elTrans(pt, left, top, plotWidCss, plotHgtCss, off);
	}

	function syncCursorPoints() {
		cursorPts.forEach((pt, i) => {
			if (pt != null && cursorPtsLft[i] != null)
				setCursorPointPos(pt, cursorOnePt ? cursorPtSeries : i, cursorPtsLft[i], cursorPtsTop[i]);
		});
	}

	function updateCursor(src, _fire, _pub) {
	//	ts == null && log("updateCursor()", arguments);

		rawMouseLeft1 = mouseLeft1;
		rawMouseTop1 = mouseTop1;

		[mouseLeft1, mouseTop1] = cursor.move(self, mouseLeft1, mouseTop1);

		cursor.left = mouseLeft1;
		cursor.top = mouseTop1;

		if (showCursor) {
			vCursor && elTrans(vCursor, round(mouseLeft1), 0, plotWidCss, plotHgtCss);
			hCursor && elTrans(hCursor, 0, round(mouseTop1), plotWidCss, plotHgtCss);
		}

		let idx;

		// when zooming to an x scale range between datapoints the binary search
		// for nearest min/max indices results in this condition. cheap hack :D
		let noDataInRange = i0 > i1; // works for mode 1 only

		let closestDist = inf;
		let closestSeries = null;
		let cursorHidden = mouseLeft1 < 0 || dataLen == 0 || noDataInRange;

		// TODO: extract
		let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss;
		let yDim = scaleX.ori == 1 ? plotWidCss : plotHgtCss;

		// if cursor hidden, hide points & clear legend vals
		if (cursorHidden) {
			idx = cursor.idx = null;

			for (let i = 0; i < series.length; i++) {
				let pt = cursorPts[i];
				pt != null && elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
			}


			if (cursorOnePt)
				cursorPtSeries = null;

			if (legend.live) {
				activeIdxs.fill(idx);
				shouldSetLegend = true;
			}
		}
		else {
		//	let pctY = 1 - (y / rect.height);

			let mouseXPos, valAtPosX, xPos;

			if (mode == 1) {
				mouseXPos = scaleX.ori == 0 ? mouseLeft1 : mouseTop1;
				valAtPosX = posToVal(mouseXPos, xScaleKey);
				idx = cursor.idx = closestIdx(valAtPosX, data[0], i0, i1);
				xPos = valToPosX(data[0][idx], scaleX, xDim, 0);
			}

			// closest pt values
			let _ptLft = -10;
			let _ptTop = -10;
			let _ptWid = 0;
			let _ptHgt = 0;
			let _centered = true;
			let _ptFill = '';
			let _ptStroke = '';

			for (let i = mode == 2 ? 1 : 0; i < series.length; i++) {
				let s = series[i];

				let idx1  = activeIdxs[i];
				let yVal1 = idx1 == null ? null : (mode == 1 ? data[i][idx1] : data[i][1][idx1]);

				let idx2  = cursor.dataIdx(self, i, idx, valAtPosX);
				let yVal2 = idx2 == null ? null : (mode == 1 ? data[i][idx2] : data[i][1][idx2]);

				shouldSetLegend = shouldSetLegend || yVal2 != yVal1 || idx2 != idx1;

				activeIdxs[i] = idx2;

				if (i > 0 && s.show) {
					let xPos2 = idx2 == null ? -10 : idx2 == idx ? xPos : valToPosX(mode == 1 ? data[0][idx2] : data[i][0][idx2], scaleX, xDim, 0);

					// this doesnt really work for state timeline, heatmap, status history (where the value maps to color, not y coords)
					let yPos = yVal2 == null ? -10 : valToPosY(yVal2, mode == 1 ? scales[s.scale] : scales[s.facets[1].scale], yDim, 0);

					if (cursorFocus && yVal2 != null) {
						let mouseYPos = scaleX.ori == 1 ? mouseLeft1 : mouseTop1;
						let dist = abs(focus.dist(self, i, idx2, yPos, mouseYPos));

						if (dist < closestDist) {
							let bias = focus.bias;

							if (bias != 0) {
								let mouseYVal = posToVal(mouseYPos, s.scale);

								let seriesYValSign = yVal2     >= 0 ? 1 : -1;
								let mouseYValSign  = mouseYVal >= 0 ? 1 : -1;

								// with a focus bias, we will never cross zero when prox testing
								// it's either closest towards zero, or closest away from zero
								if (mouseYValSign == seriesYValSign && (
									mouseYValSign == 1 ?
										(bias == 1 ? yVal2 >= mouseYVal : yVal2 <= mouseYVal) :  // >= 0
										(bias == 1 ? yVal2 <= mouseYVal : yVal2 >= mouseYVal)    //  < 0
								)) {
									closestDist = dist;
									closestSeries = i;
								}
							}
							else {
								closestDist = dist;
								closestSeries = i;
							}
						}
					}

					if (shouldSetLegend || cursorOnePt) {
						let hPos, vPos;

						if (scaleX.ori == 0) {
							hPos = xPos2;
							vPos = yPos;
						}
						else {
							hPos = yPos;
							vPos = xPos2;
						}

						let ptWid, ptHgt, ptLft, ptTop,
							ptStroke, ptFill,
							centered = true,
							getBBox = points.bbox;

						if (getBBox != null) {
							centered = false;

							let bbox = getBBox(self, i);

							ptLft = bbox.left;
							ptTop = bbox.top;
							ptWid = bbox.width;
							ptHgt = bbox.height;
						}
						else {
							ptLft = hPos;
							ptTop = vPos;
							ptWid = ptHgt = points.size(self, i);
						}

						ptFill = points.fill(self, i);
						ptStroke = points.stroke(self, i);

						if (cursorOnePt) {
							if (i == closestSeries && closestDist <= focus.prox) {
								_ptLft = ptLft;
								_ptTop = ptTop;
								_ptWid = ptWid;
								_ptHgt = ptHgt;
								_centered = centered;
								_ptFill = ptFill;
								_ptStroke = ptStroke;
							}
						}
						else {
							let pt = cursorPts[i];

							if (pt != null) {
								cursorPtsLft[i] = ptLft;
								cursorPtsTop[i] = ptTop;

								elSize(pt, ptWid, ptHgt, centered);
								elColor(pt, ptFill, ptStroke);
								setCursorPointPos(pt, i, ptLft, ptTop);
							}
						}
					}
				}
			}

			// if only using single hover point (at cursorPts[0])
			// we have trigger styling at last visible series (once closestSeries is settled)
			if (cursorOnePt) {
				let pointSeries = closestDist <= focus.prox ? closestSeries : null;

				if (shouldSetLegend || pointSeries != cursorPtSeries) {
					let pt = cursorPts[0];

					if (pt != null) {
						cursorPtsLft[0] = _ptLft;
						cursorPtsTop[0] = _ptTop;

						elSize(pt, _ptWid, _ptHgt, _centered);
						elColor(pt, _ptFill, _ptStroke);
						cursorPtSeries = pointSeries;
						setCursorPointPos(pt, cursorPtSeries, _ptLft, _ptTop);
					}
				}
			}
		}

		// nit: cursor.drag.setSelect is assumed always true
		if (select.show && dragging) {
			if (src != null) {
				let [xKey, yKey] = syncOpts.scales;
				let [matchXKeys, matchYKeys] = syncOpts.match;
				let [xKeySrc, yKeySrc] = src.cursor.sync.scales;

				// match the dragX/dragY implicitness/explicitness of src
				let sdrag = src.cursor.drag;
				dragX = sdrag._x;
				dragY = sdrag._y;

				if (dragX || dragY) {
					let { left, top, width, height } = src.select;

					let sori = src.scales[xKeySrc].ori;
					let sPosToVal = src.posToVal;

					let sOff, sDim, sc, a, b;

					let matchingX = xKey != null && matchXKeys(xKey, xKeySrc);
					let matchingY = yKey != null && matchYKeys(yKey, yKeySrc);

					if (matchingX && dragX) {
						if (sori == 0) {
							sOff = left;
							sDim = width;
						}
						else {
							sOff = top;
							sDim = height;
						}

						sc = scales[xKey];

						a = valToPosX(sPosToVal(sOff, xKeySrc),        sc, xDim, 0);
						b = valToPosX(sPosToVal(sOff + sDim, xKeySrc), sc, xDim, 0);

						setSelX(min(a,b), abs(b-a));
					}
					else
						setSelX(0, xDim);

					if (matchingY && dragY) {
						if (sori == 1) {
							sOff = left;
							sDim = width;
						}
						else {
							sOff = top;
							sDim = height;
						}

						sc = scales[yKey];

						a = valToPosY(sPosToVal(sOff, yKeySrc),        sc, yDim, 0);
						b = valToPosY(sPosToVal(sOff + sDim, yKeySrc), sc, yDim, 0);

						setSelY(min(a,b), abs(b-a));
					}
					else
						setSelY(0, yDim);
				}
				else
					hideSelect();
			}
			else {
				let rawDX = abs(rawMouseLeft1 - rawMouseLeft0);
				let rawDY = abs(rawMouseTop1 - rawMouseTop0);

				if (scaleX.ori == 1) {
					let _rawDX = rawDX;
					rawDX = rawDY;
					rawDY = _rawDX;
				}

				dragX = drag.x && rawDX >= drag.dist;
				dragY = drag.y && rawDY >= drag.dist;

				let uni = drag.uni;

				if (uni != null) {
					// only calc drag status if they pass the dist thresh
					if (dragX && dragY) {
						dragX = rawDX >= uni;
						dragY = rawDY >= uni;

						// force unidirectionality when both are under uni limit
						if (!dragX && !dragY) {
							if (rawDY > rawDX)
								dragY = true;
							else
								dragX = true;
						}
					}
				}
				else if (drag.x && drag.y && (dragX || dragY))
					// if omni with no uni then both dragX / dragY should be true if either is true
					dragX = dragY = true;

				let p0, p1;

				if (dragX) {
					if (scaleX.ori == 0) {
						p0 = mouseLeft0;
						p1 = mouseLeft1;
					}
					else {
						p0 = mouseTop0;
						p1 = mouseTop1;
					}

					setSelX(min(p0, p1), abs(p1 - p0));

					if (!dragY)
						setSelY(0, yDim);
				}

				if (dragY) {
					if (scaleX.ori == 1) {
						p0 = mouseLeft0;
						p1 = mouseLeft1;
					}
					else {
						p0 = mouseTop0;
						p1 = mouseTop1;
					}

					setSelY(min(p0, p1), abs(p1 - p0));

					if (!dragX)
						setSelX(0, xDim);
				}

				// the drag didn't pass the dist requirement
				if (!dragX && !dragY) {
					setSelX(0, 0);
					setSelY(0, 0);
				}
			}
		}

		drag._x = dragX;
		drag._y = dragY;

		let focusIdx = !cursorHidden && closestDist <= focus.prox ? closestSeries : null;
		let focusChanged = cursorFocus && (src == null || cursorHidden) && setFocus(focusIdx);

		if (shouldSetLegend) {
			legend.idx = idx;
			setLegend();
		}

		if (src == null && _pub) {
			if (syncKey != null) {
				let [xSyncKey, ySyncKey] = syncOpts.scales;

				syncOpts.values[0] = xSyncKey != null ? posToVal(scaleX.ori == 0 ? mouseLeft1 : mouseTop1, xSyncKey) : null;
				syncOpts.values[1] = ySyncKey != null ? posToVal(scaleX.ori == 1 ? mouseLeft1 : mouseTop1, ySyncKey) : null;
			}

			pubSync(mousemove, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, idx);
		}


		if (focusChanged) {
			fire("setSeries", focusIdx, FOCUS_TRUE);
			if (src == null && _pub && syncOpts.setSeries)
				pubSync("setSeries", self, focusIdx, FOCUS_TRUE);
		}

		_fire !== false && fire("setCursor");
	}

	let rect = null;

	Object.defineProperty(self, 'rect', {
		get() {
			if (rect == null)
				syncRect(false);

			return rect;
		},
	});

	function syncRect(defer = false) {
		if (over == null)
			return;

		if (defer)
			rect = null;
		else {
			rect = over.getBoundingClientRect();
			fire("syncRect", rect);
		}
	}

	function mouseMove(e, src, _l, _t, _w, _h, _i) {
		if (cursor._lock)
			return;

		// Chrome on Windows has a bug which triggers a stray mousemove event after an initial mousedown event
		// when clicking into a plot as part of re-focusing the browser window.
		// we gotta ignore it to avoid triggering a phantom drag / setSelect
		// However, on touch-only devices Chrome-based browsers trigger a 0-distance mousemove before mousedown
		// so we don't ignore it when mousedown has set the dragging flag
		if (dragging && e != null && e.movementX == 0 && e.movementY == 0)
			return;

		cacheMouse(e, src, _l, _t, _w, _h, _i, false, e != null);

		if (e != null)
			updateCursor(null, true, true);
		else
			updateCursor(src, true, false);
	}

	function cacheMouse(e, src, _l, _t, _w, _h, _i, initial, snap) {
		if (rect == null)
			syncRect(false);

		setCursorEvent(e);

		if (e != null) {
			_l = e.clientX - rect.left;
			_t = e.clientY - rect.top;
		}
		else {
			if (_l < 0 || _t < 0) {
				mouseLeft1 = -10;
				mouseTop1 = -10;
				return;
			}

			let [xKey, yKey] = syncOpts.scales;

			let syncOptsSrc = src.cursor.sync;
			let [xValSrc, yValSrc] = syncOptsSrc.values;
			let [xKeySrc, yKeySrc] = syncOptsSrc.scales;
			let [matchXKeys, matchYKeys] = syncOpts.match;

			let rotSrc = src.axes[0].side % 2 == 1;

			let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss,
				yDim = scaleX.ori == 1 ? plotWidCss : plotHgtCss,
				_xDim = rotSrc ? _h : _w,
				_yDim = rotSrc ? _w : _h,
				_xPos = rotSrc ? _t : _l,
				_yPos = rotSrc ? _l : _t;

			if (xKeySrc != null)
				_l = matchXKeys(xKey, xKeySrc) ? getPos(xValSrc, scales[xKey], xDim, 0) : -10;
			else
				_l = xDim * (_xPos/_xDim);

			if (yKeySrc != null)
				_t = matchYKeys(yKey, yKeySrc) ? getPos(yValSrc, scales[yKey], yDim, 0) : -10;
			else
				_t = yDim * (_yPos/_yDim);

			if (scaleX.ori == 1) {
				let __l = _l;
				_l = _t;
				_t = __l;
			}
		}

		if (snap && (src == null || src.cursor.event.type == mousemove)) {
			if (_l <= 1 || _l >= plotWidCss - 1)
				_l = _l <= 1 ? 0 : plotWidCss;

			if (_t <= 1 || _t >= plotHgtCss - 1)
				_t = _t <= 1 ? 0 : plotHgtCss;
		}

		if (initial) {
			rawMouseLeft0 = _l;
			rawMouseTop0 = _t;

			[mouseLeft0, mouseTop0] = cursor.move(self, _l, _t);
		}
		else {
			mouseLeft1 = _l;
			mouseTop1 = _t;
		}
	}

	const _hideProps = {
		width: 0,
		height: 0,
		left: 0,
		top: 0,
	};

	function hideSelect() {
		setSelect(_hideProps, false);
	}

	let downSelectLeft;
	let downSelectTop;
	let downSelectWidth;
	let downSelectHeight;

	function mouseDown(e, src, _l, _t, _w, _h, _i) {
		if (e != null)
			mouseOwner = self.uid;

		dragging = true;
		dragX = dragY = drag._x = drag._y = false;

		cacheMouse(e, src, _l, _t, _w, _h, _i, true, false);

		if (e != null) {
			if ((drag.x || drag.y) && !globalMouseMove)
				globalMouseMove = onMouse(mousemove, doc, mouseMove, false);
			onMouse(mouseup, doc, mouseUp, false);
			pubSync(mousedown, self, mouseLeft0, mouseTop0, plotWidCss, plotHgtCss, null);
		}

		let { left, top, width, height } = select;

		downSelectLeft   = left;
		downSelectTop    = top;
		downSelectWidth  = width;
		downSelectHeight = height;

	//	hideSelect();
	}

	function setDragRange(key, min, max) {
		if (min > max)
			[min, max] = [max, min];

		if (isFn(drag.setRange)) {
			let range = drag.setRange(self, key, min, max);

			if (range != null)
				setRange(key, range[0], range[1]);
		}
		else
			setRange(key, min, max);
	}

	function mouseUp(e, src, _l, _t, _w, _h, _i) {
		stopGlobalMouseMove();

		dragging = drag._x = drag._y = false;

		cacheMouse(e, src, _l, _t, _w, _h, _i, false, true);

		let hideCursor = e != null && (
			e.clientX < rect.left || e.clientX > rect.left + plotWidCss ||
			e.clientY < rect.top || e.clientY > rect.top + plotHgtCss
		);

		let { left, top, width, height } = select;

		let hasSelect = width > 0 || height > 0;
		let chgSelect = (
			downSelectLeft   != left   ||
			downSelectTop    != top    ||
			downSelectWidth  != width  ||
			downSelectHeight != height
		);

		hasSelect && chgSelect && setSelect(select);

		if (drag.setRange && hasSelect && chgSelect) {
		//	if (syncKey != null) {
		//		dragX = drag.x;
		//		dragY = drag.y;
		//	}

			let xOff = left,
				xDim = width,
				yOff = top,
				yDim = height;

			if (scaleX.ori == 1) {
				xOff = top,
				xDim = height,
				yOff = left,
				yDim = width;
			}

			if (dragX) {
				setDragRange(xScaleKey,
					posToVal(xOff, xScaleKey),
					posToVal(xOff + xDim, xScaleKey)
				);
			}

			if (dragY) {
				for (let k in scales) {
					let sc = scales[k];

					if (k != xScaleKey && sc.from == null && sc.min != inf) {
						setDragRange(k,
							posToVal(yOff + yDim, k),
							posToVal(yOff, k)
						);
					}
				}
			}

			hideSelect();
		}
		else if (cursor.lock) {
			cursor._lock = !cursor._lock;
			updateCursor(src, true, e != null);
		}

		if (e != null) {
			offMouse(mouseup, doc);
			pubSync(mouseup, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
		}

		if (hideCursor && !cursor._lock) {
			mouseLeft1 = mouseTop1 = -10;
			activeIdxs.fill(null);
			updateCursor(null, true, true);
		}

		if (mouseOwner == self.uid)
			mouseOwner = null;
	}

	function mouseLeave(e, src, _l, _t, _w, _h, _i) {
		if (cursor._lock)
			return;

		if (globalMouseMove) {
			cacheMouse(e, src, _l, _t, _w, _h, _i, false, true);
			updateCursor(null, true, true);
			return;
		}

		setCursorEvent(e);

		let _dragging = dragging;

		if (dragging) {
			// handle case when mousemove aren't fired all the way to edges by browser
			let snapH = true;
			let snapV = true;
			let snapProx = 10;

			let dragH, dragV;

			if (scaleX.ori == 0) {
				dragH = dragX;
				dragV = dragY;
			}
			else {
				dragH = dragY;
				dragV = dragX;
			}

			if (dragH && dragV) {
				// maybe omni corner snap
				snapH = mouseLeft1 <= snapProx || mouseLeft1 >= plotWidCss - snapProx;
				snapV = mouseTop1  <= snapProx || mouseTop1  >= plotHgtCss - snapProx;
			}

			if (dragH && snapH)
				mouseLeft1 = mouseLeft1 < mouseLeft0 ? 0 : plotWidCss;

			if (dragV && snapV)
				mouseTop1 = mouseTop1 < mouseTop0 ? 0 : plotHgtCss;

			updateCursor(null, true, true);

			dragging = false;
		}

		mouseLeft1 = -10;
		mouseTop1 = -10;

		activeIdxs.fill(null);

		// passing a non-null timestamp to force sync/mousemove event
		updateCursor(null, true, true);

		if (_dragging)
			dragging = _dragging;
	}

	function dblClick(e, src, _l, _t, _w, _h, _i) {
		if (cursor._lock)
			return;

		setCursorEvent(e);

		autoScaleX();

		hideSelect();

		if (e != null)
			pubSync(dblclick, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
	}

	function onDppxChange() {
		setPxRatio();
	}

	on(dppxchange, win, onDppxChange);

	// internal pub/sub
	const events = {};

	events.mousedown = mouseDown;
	events.mousemove = mouseMove;
	events.mouseup = mouseUp;
	events.dblclick = dblClick;
	events["setSeries"] = (e, src, idx, opts) => {
		let seriesIdxMatcher = syncOpts.match[2];
		idx = seriesIdxMatcher(self, src, idx);
		idx != -1 && setSeries(idx, opts, true, false);
	};

	if (showCursor) {
		on("click", wrap, e => {
			if (e.target === over) {
				let didDrag = mouseLeft1 != mouseLeft0 || mouseTop1 != mouseTop0;
				didDrag && drag.click(self, e);
			}
		}, true);

		onMouse(mousedown,  over, mouseDown);
		onMouse(mousemove,  over, e => {
			// Tracked drags handle the bubbling event on document instead.
			if (!globalMouseMove)
				mouseMove(e);
		});
		onMouse(mouseenter, over, e => {
			setCursorEvent(e);
			syncRect(false);
		});
		onMouse(mouseleave, over, mouseLeave);

		onMouse(dblclick, over, dblClick);

		cursorPlots.add(self);

		self.syncRect = syncRect;
	}

	// external on/off
	const hooks = self.hooks = opts.hooks || {};

	function fire(evName, a1, a2) {
		if (deferHooks)
			hooksQueue.push([evName, a1, a2]);
		else {
			if (evName in hooks) {
				hooks[evName].forEach(fn => {
					fn.call(null, self, a1, a2);
				});
			}
		}
	}

	(opts.plugins || []).forEach(p => {
		for (let evName in p.hooks)
			hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]);
	});

	const seriesIdxMatcher = (self, src, srcSeriesIdx) => srcSeriesIdx;

	const syncOpts = assign({
		key: null,
		setSeries: false,
		filters: {
			pub: retTrue,
			sub: retTrue,
		},
		scales: [xScaleKey, series[1] ? series[1].scale : null],
		match: [retEq, retEq, seriesIdxMatcher],
		values: [null, null],
	}, cursor.sync);

	if (syncOpts.match.length == 2)
		syncOpts.match.push(seriesIdxMatcher);

	cursor.sync = syncOpts;

	const syncKey = syncOpts.key;

	const sync = _sync(syncKey);

	function pubSync(type, src, x, y, w, h, i) {
		if (syncOpts.filters.pub(type, src, x, y, w, h, i))
			sync.pub(type, src, x, y, w, h, i);
	}

	sync.sub(self);

	function pub(type, src, x, y, w, h, i) {
		if (syncOpts.filters.sub(type, src, x, y, w, h, i))
			events[type](null, src, x, y, w, h, i);
	}

	self.pub = pub;

	function destroy() {
		destroyed = true;
		invalidateBandGroups();
		queuedCommit = false;
		if (queuedFrame != null)
			cancelAnimationFrame(queuedFrame);
		queuedFrame = null;
		sync.unsub(self);
		cursorPlots.delete(self);
		stopGlobalMouseMove();
		offMouse(null, doc);
		if (mouseOwner == self.uid)
			mouseOwner = null;
		mouseListeners.clear();
		off(dppxchange, win, onDppxChange);
		root.remove();
		legendView?.destroy();
		fire("destroy");
	}

	self.destroy = destroy;

	function _init() {
		fire("init", opts, data);

		setData(data || opts.data, false);

		if (pendScales[xScaleKey])
			setScale(xScaleKey, pendScales[xScaleKey]);
		else
			autoScaleX();

		shouldSetSelect = select.show && (select.width > 0 || select.height > 0);
		shouldSetCursor = shouldSetLegend = true;

		setSize(opts);
	}

	series.forEach(initSeries);

	{
		legend.values.length = series.length;
		legend.values.fill(null);
	}

	if (showLegend) {
		legendView = createLegend(self, root, {
			legend,
			series,
			columns: legendCols,
			multi: multiValLegend,
			mode,
			focusAlpha: focus.alpha,
			cursorFocus,
			bind: cursor.bind,
			emit: handleLegendEvent,
		});
		invalidateLegend();
	}

	series.forEach((s, i) => { fire("addSeries", i); });

	axes.forEach(initAxis);

	if (then) {
		if (then instanceof HTMLElement) {
			then.appendChild(root);
			_init();
		}
		else
			then(self, _init);
	}
	else
		_init();

	return self;
}

uPlot.assign = assign;
uPlot.fmtNum = fmtNum;
uPlot.numDec = numDec;
uPlot.rangeNum = rangeNum;
uPlot.rangeLog = rangeLog;
uPlot.rangeAsinh = rangeAsinh;
uPlot.scan = scanScale;
uPlot.orient   = orient;
uPlot.pxRatio = pxRatio;

{
	uPlot.join = join;
}

{
	uPlot.fmtDate = fmtDate;
	uPlot.tzDate  = tzDate;
}

uPlot.sync = _sync;

{
	uPlot.addGap = addGap;
	uPlot.clipGaps = clipGaps;

	let paths = uPlot.paths = {
		points,
	};

	(paths.linear  = linear);
	(paths.stepped = stepped);
	(paths.bars    = bars);
	(paths.spline  = monotoneCubic);
}

module.exports = uPlot;
