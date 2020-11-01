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

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
export function rangeNum(min, max, mult, extra) {
	const delta = max - min;
	const nonZeroDelta = delta || abs(max) || 1e3;
	const mag = log10(nonZeroDelta);
	const base = pow(10, floor(mag));

	const padding = nonZeroDelta * mult;
	const newMin = min - padding;
	const newMax = max + padding;

	let snappedMin = roundDec(incrRoundDn(newMin, base/100), 6);
	let snappedMax = roundDec(incrRoundUp(newMax, base/100), 6);

	if (extra) {
		// for flat data, always use 0 as one chart extreme & place data in center
		if (delta == 0) {
			if (max > 0)
				snappedMin = 0;
			else if (max < 0)
				snappedMax = 0;
		}
		else {
			// if original data never crosses 0, use 0 as one chart extreme
			if (min >= 0 && snappedMin < 0)
				snappedMin = 0;

			if (max <= 0 && snappedMax > 0)
				snappedMax = 0;
		}
	}

	return [snappedMin, snappedMax];
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

export function retArg1(_0, _1) {
	return _1;
}

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

export function genIncrs(base, minExp, maxExp, mults) {
	let incrs = [];

	for (let exp = minExp; exp < maxExp; exp++) {
		let mag = pow(base, exp);
		let expa = abs(exp);

		for (let i = 0; i < mults.length; i++) {
			let incr = roundDec(mults[i] * mag, expa);
			incrs.push(incr);
			fixedDec.set(incr, incr < 1 ? expa : 0);
		}
	}

	return incrs;
}

//export const assign = Object.assign;

export const EMPTY_OBJ = {};

export const isArr = Array.isArray;

export function isStr(v) {
	return typeof v === 'string';
}

function isObj(v) {
	return typeof v === 'object' && v !== null;
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