export function debounce(fn, time) {
	let pending = null;

	function run() {
		pending = null;
		fn();
	}

	return function() {
		clearTimeout(pending);
		pending = setTimeout(run, time);
	}
}

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
		minExp = floor(logFn(min));
		maxExp = floor(logFn(max));

		minMaxIncrs = fixIncr(pow(base, minExp), pow(base, maxExp), minExp, maxExp);

		min = incrRoundDn(min, minMaxIncrs[0]);
		max = incrRoundUp(max, minMaxIncrs[1]);
	}

	return [min, max];
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

export const abs = M.abs;
export const floor = M.floor;
export const round = M.round;
export const ceil = M.ceil;
export const min = M.min;
export const max = M.max;
export const pow = M.pow;
export const sqrt = M.sqrt;
export const log10 = M.log10;
export const log2 = M.log2;
export const PI = M.PI;

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

export const retArg1 = (_0, _1) => _1;

export const retNull = _ => null;

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

export function copy(o) {
	let out;

	if (isArr(o))
		out = o.map(copy);
	else if (isObj(o)) {
		out = {};
		for (var k in o)
			out[k] = copy(o[k]);
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
const NULL_IGNORE = 0;  // all nulls are ignored by isGap
const NULL_GAP    = 1;  // alignment nulls are ignored by isGap (default)
const NULL_EXPAND = 2;  // nulls are expand to include adjacent alignment nulls

// nullModes is a tables-matched array indicating how to treat nulls in each series
export function join(tables, nullModes) {
	if (tables.length == 1) {
		return {
			data: tables[0],
			isGap: nullModes ? (u, seriesIdx, dataIdx) => nullModes[0][seriesIdx] != NULL_IGNORE : () => true,
		};
	}

	let xVals = new Set();
	let xNulls = [new Set()];

	for (let ti = 0; ti < tables.length; ti++) {
		let t = tables[ti];
		let xs = t[0];
		let len = xs.length;

		for (let i = 0; i < len; i++)
			xVals.add(xs[i]);

		for (let si = 1; si < t.length; si++) {
			let nulls = new Set();

			// cache original nulls for isGap lookup
			if (nullModes == null || nullModes[ti][si] == NULL_GAP || nullModes[ti][si] == NULL_EXPAND) {
				let ys = t[si];

				for (let i = 0; i < len; i++) {
					if (ys[i] == null)
						nulls.add(xs[i]);
				}
			}

			xNulls.push(nulls);
		}
	}

	let data = [Array.from(xVals).sort((a, b) => a - b)];

	let alignedLen = data[0].length;

	let xIdxs = new Map();

	for (let i = 0; i < alignedLen; i++)
		xIdxs.set(data[0][i], i);

	let gsi = 1;

	for (let ti = 0; ti < tables.length; ti++) {
		let t = tables[ti];
		let xs = t[0];

		for (let si = 1; si < t.length; si++) {
			let ys = t[si];

			let yVals = Array(alignedLen).fill(null);

			for (let i = 0; i < ys.length; i++)
				yVals[xIdxs.get(xs[i])] = ys[i];

			// mark all filler nulls as explicit when adjacent to existing explicit nulls (minesweeper)
			if (nullModes && nullModes[ti][si] == NULL_EXPAND) {
				let nulls = xNulls[gsi];
				let size = nulls.size;
				let	i = 0;
				let xi;

				let lastAddedX = -inf;

				for (let xVal of nulls.values()) {
					if (i++ == size)
						break;

					if (xVal > lastAddedX) {
						let xIdx = xIdxs.get(xVal);

						xi = xIdx - 1;
						while (yVals[xi] === null) {
							nulls.add(data[0][xi]);
							xi--;
						}

						xi = xIdx + 1;
						while (yVals[xi] === null) {
							nulls.add(lastAddedX = data[0][xi]);
							xi++;
						}
					}
				}
			}

			data.push(yVals);

			gsi++;
		}
	}

	return {
		data: data,
		isGap(u, seriesIdx, dataIdx) {
			let xVal = u._data[0][dataIdx];
			return xNulls[seriesIdx].has(xVal);
		},
	};
}

export const microTask = typeof queueMicrotask == "undefined" ? fn => Promise.resolve().then(fn) : queueMicrotask;