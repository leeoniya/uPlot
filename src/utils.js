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

export function rangeLog(min, max, fullMags) {
	if (fullMags) {
		min = pow(10, floor(log10(min)));
		max = pow(10,  ceil(log10(max)));
	}
	else {
		let minMag = pow(10, floor(log10(min)));
		min = incrRoundDn(min, minMag);
		let maxMag = pow(10, floor(log10(max)));
		max = incrRoundUp(max, maxMag);
	}

	return [+min.toFixed(12), +max.toFixed(12)];
}

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
export function rangeNum(min, max, mult, extra) {
	// auto-scale Y
	const delta = max - min;
	const mag = log10(delta || abs(max) || 1);
	const exp = floor(mag);
	const base = pow(10, exp);
	const incr = base * mult;
	const buf = delta == 0 ? incr : 0;

	let snappedMin = round6(incrRoundDn(min - buf, incr));
	let snappedMax = round6(incrRoundUp(max + buf, incr));

	if (extra) {
		// for flat data, always use 0 as one chart extreme & place data in center
		if (delta == 0) {
			if (max > 0) {
				snappedMin = 0;
				snappedMax = max * 2;
			}
			else if (max < 0) {
				snappedMax = 0;
				snappedMin = min * 2;
			}
		}
		else {
			// if buffer is too small, increase it
			if (snappedMax - max < incr)
				snappedMax += incr;

			if (min - snappedMin < incr)
				snappedMin -= incr;

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

export function incrRoundUp(num, incr) {
	return ceil(num/incr)*incr;
}

export function incrRoundDn(num, incr) {
	return floor(num/incr)*incr;
}

export function round2(val) {
	return round(val * 1e2) / 1e2;
}

export function round3(val) {
	return round(val * 1e3) / 1e3;
}

export function round6(val) {
	return round(val * 1e6) / 1e6;
}

export function genIncrs(minExp, maxExp, mults) {
	let incrs = [];

	for (let exp = minExp; exp < maxExp; exp++) {
		let mag = pow(10, exp);
		for (let i = 0; i < mults.length; i++) {
			let incr = mults[i] * mag;
			incrs.push(+incr.toFixed(abs(exp)));
		}
	}

	return incrs;
}

//export const assign = Object.assign;

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