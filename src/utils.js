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

export function nonNullIdx(data, _i0, _i1, dir) {
	for (let i = dir == 1 ? _i0 : _i1; i >= _i0 && i <= _i1; i += dir) {
		if (data[i] != null)
			return i;
	}

	return -1;
}

export function getMinMax(data, _i0, _i1, sorted) {
//	console.log("getMinMax()");

	let _min = inf;
	let _max = -inf;

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
			if (data[i] != null) {
				_min = min(_min, data[i]);
				_max = max(_max, data[i]);
			}
		}
	}

	return [_min, _max];
}

export function getMinMaxLog(data, _i0, _i1) {
//	console.log("getMinMax()");

	let _min = inf;
	let _max = -inf;

	for (let i = _i0; i <= _i1; i++) {
		if (data[i] > 0) {
			_min = min(_min, data[i]);
			_max = max(_max, data[i]);
		}
	}

	return [
		_min ==  inf ?  1 : _min,
		_max == -inf ? 10 : _max,
	];
}

const _fixedTuple = [0, 0];

function fixIncr(minIncr, maxIncr, minExp, maxExp) {
	_fixedTuple[0] = minExp < 0 ? roundDec(minIncr, -minExp) : minIncr;
	_fixedTuple[1] = maxExp < 0 ? roundDec(maxIncr, -maxExp) : maxIncr;
	return _fixedTuple;
}

export function rangeLog(min, max, base, fullMags) {
	let minSign = sign(min);
	let maxSign = sign(max);

	let logFn = base == 10 ? log10 : log2;

	if (min == max) {
		min /= base;
		max *= base;
	}

	let minIncr, maxIncr, minExp, maxExp, minMaxIncrs;

	if (fullMags) {
		minExp = floor(logFn(min));
		maxExp =  ceil(logFn(max));

		minMaxIncrs = fixIncr(pow(base, minExp), pow(base, maxExp), minExp, maxExp);

		min = minMaxIncrs[0];
		max = minMaxIncrs[1];
	}
	else {
		minExp = floor(logFn(abs(min)));
		maxExp = floor(logFn(abs(max)));

		minMaxIncrs = fixIncr(pow(base, minExp), pow(base, maxExp), minExp, maxExp);

		min = incrRoundDn(min, minMaxIncrs[0]);
		max = incrRoundUp(max, minMaxIncrs[1]);
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

const _eqRangePart = {
	pad:  0,
	soft: null,
	mode: 0,
};

const _eqRange = {
	min: _eqRangePart,
	max: _eqRangePart,
};

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
export function rangeNum(_min, _max, mult, extra) {
	if (isObj(mult))
		return _rangeNum(_min, _max, mult);

	_eqRangePart.pad  = mult;
	_eqRangePart.soft = extra ? 0 : null;
	_eqRangePart.mode = extra ? 3 : 0;

	return _rangeNum(_min, _max, _eqRange);
}

// nullish coalesce
export function ifNull(lh, rh) {
	return lh == null ? rh : lh;
}

function _rangeNum(_min, _max, cfg) {
	let cmin = cfg.min;
	let cmax = cfg.max;

	let padMin = ifNull(cmin.pad, 0);
	let padMax = ifNull(cmax.pad, 0);

	let hardMin = ifNull(cmin.hard, -inf);
	let hardMax = ifNull(cmax.hard,  inf);

	let softMin = ifNull(cmin.soft,  inf);
	let softMax = ifNull(cmax.soft, -inf);

	let softMinMode = ifNull(cmin.mode, 0);
	let softMaxMode = ifNull(cmax.mode, 0);

	let delta        = _max - _min;
	let nonZeroDelta = delta || abs(_max) || 1e3;
	let mag          = log10(nonZeroDelta);
	let base         = pow(10, floor(mag));

	let _padMin  = nonZeroDelta * (delta == 0 ? (_min == 0 ? .1 : 1) : padMin);
	let _newMin  = roundDec(incrRoundDn(_min - _padMin, base/10), 6);
	let _softMin = _min >= softMin && (softMinMode == 1 || softMinMode == 3 && _newMin <= softMin || softMinMode == 2 && _newMin >= softMin) ? softMin : inf;
	let minLim   = max(hardMin, _newMin < _softMin && _min >= _softMin ? _softMin : min(_softMin, _newMin));

	let _padMax  = nonZeroDelta * (delta == 0 ? (_max == 0 ? .1 : 1) : padMax);
	let _newMax  = roundDec(incrRoundUp(_max + _padMax, base/10), 6);
	let _softMax = _max <= softMax && (softMaxMode == 1 || softMaxMode == 3 && _newMax >= softMax || softMaxMode == 2 && _newMax <= softMax) ? softMax : -inf;
	let maxLim   = min(hardMax, _newMax > _softMax && _max <= _softMax ? _softMax : max(_softMax, _newMax));

	if (minLim == maxLim && minLim == 0)
		maxLim = 100;

	return [minLim, maxLim];
}

// alternative: https://stackoverflow.com/a/2254896
export const fmtNum = new Intl.NumberFormat(navigator.language).format;

const M = Math;

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
export const sinh =  (v, linthresh = 1) => M.sinh(v / linthresh);
export const asinh = (v, linthresh = 1) => M.asinh(v / linthresh);

export const inf = Infinity;

export function incrRound(num, incr) {
	return round(num/incr)*incr;
}

export function clamp(num, _min, _max) {
	return min(max(num, _min), _max);
}

export function fnOrSelf(v) {
	return typeof v == "function" ? v : () => v;
}

export const retArg0 = _0 => _0;

export const retArg1 = (_0, _1) => _1;

export const retNull = _ => null;

export const retTrue = _ => true;

export function incrRoundUp(num, incr) {
	return ceil(num/incr)*incr;
}

export function incrRoundDn(num, incr) {
	return floor(num/incr)*incr;
}

export function roundDec(val, dec) {
	return round(val * (dec = 10**dec)) / dec;
}

export const fixedDec = new Map();

export function guessDec(num) {
	return ((""+num).split(".")[1] || "").length;
}

export function genIncrs(base, minExp, maxExp, mults) {
	let incrs = [];

	let multDec = mults.map(guessDec);

	for (let exp = minExp; exp < maxExp; exp++) {
		let expa = abs(exp);
		let mag = roundDec(pow(base, exp), expa);

		for (let i = 0; i < mults.length; i++) {
			let _incr = mults[i] * mag;
			let dec = (_incr >= 0 && exp >= 0 ? 0 : expa) + (exp >= multDec[i] ? 0 : multDec[i]);
			let incr = roundDec(_incr, dec);
			incrs.push(incr);
			fixedDec.set(incr, dec);
		}
	}

	return incrs;
}

//export const assign = Object.assign;

export const EMPTY_OBJ = {};

export const nullNullTuple = [null, null];

export const isArr = Array.isArray;

export function isStr(v) {
	return typeof v == 'string';
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

export function copy(o, _isObj) {
	_isObj = _isObj || isObj;

	let out;

	if (isArr(o))
		out = o.map(v => copy(v, _isObj));
	else if (_isObj(o)) {
		out = {};
		for (var k in o)
			out[k] = copy(o[k], _isObj);
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
			if (isObj(targ[key]))
				assign(targ[key], copy(src[key]));
			else
				targ[key] = copy(src[key]);
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

// nullModes is a tables-matched array indicating how to treat nulls in each series
// output is sorted ASC on the joined field (table[0]) and duplicate join values are collapsed
export function join(tables, nullModes) {
	let xVals = new Set();

	for (let ti = 0; ti < tables.length; ti++) {
		let t = tables[ti];
		let xs = t[0];
		let len = xs.length;

		for (let i = 0; i < len; i++)
			xVals.add(xs[i]);
	}

	let data = [Array.from(xVals).sort((a, b) => a - b)];

	let alignedLen = data[0].length;

	let xIdxs = new Map();

	for (let i = 0; i < alignedLen; i++)
		xIdxs.set(data[0][i], i);

	for (let ti = 0; ti < tables.length; ti++) {
		let t = tables[ti];
		let xs = t[0];

		for (let si = 1; si < t.length; si++) {
			let ys = t[si];

			let yVals = Array(alignedLen).fill(undefined);

			let nullMode = nullModes ? nullModes[ti][si] : NULL_RETAIN;

			let nullIdxs = [];

			for (let i = 0; i < ys.length; i++) {
				let yVal = ys[i];
				let alignedIdx = xIdxs.get(xs[i]);

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