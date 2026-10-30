/**
* Copyright (c) 2026, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* uPlot.js (μPlot)
* A small, fast chart for time series, lines, areas, ohlc & bars
* https://github.com/leeoniya/uPlot (v1.6.32)
*/

var uPlot = (function() {

// uPlot
	function closestIdx(num, arr, lo, hi) {
		let mid;
		lo = lo || 0;
		hi = hi || arr.length - 1;
		let bitwise = hi <= 2147483647;
		while (hi - lo > 1) {
			mid = bitwise ? lo + hi >> 1 : floor((lo + hi) / 2);
			if (arr[mid] < num) lo = mid;
			else hi = mid;
		}
		if (num - arr[lo] <= arr[hi] - num) return lo;
		return hi;
	}
	function makeIndexOfs(predicate) {
		let indexOfs = (data, _i0, _i1) => {
			let i0 = -1;
			let i1 = -1;
			for (let i = _i0; i <= _i1; i++) if (predicate(data[i])) {
				i0 = i;
				break;
			}
			for (let i = _i1; i >= _i0; i--) if (predicate(data[i])) {
				i1 = i;
				break;
			}
			return [i0, i1];
		};
		return indexOfs;
	}
	const notNullish = (v) => v != null;
	const isPositive = (v) => v != null && v > 0;
	const nonNullIdxs = makeIndexOfs(notNullish);
	const positiveIdxs = makeIndexOfs(isPositive);
	function getMinMax(data, _i0, _i1, sorted = 0, log = false) {
		let getEdgeIdxs = log ? positiveIdxs : nonNullIdxs;
		let predicate = log ? isPositive : notNullish;
		[_i0, _i1] = getEdgeIdxs(data, _i0, _i1);
		let _min = data[_i0];
		let _max = data[_i0];
		if (_i0 > -1) {
			if (sorted == 1) {
				_min = data[_i0];
				_max = data[_i1];
			} else if (sorted == -1) {
				_min = data[_i1];
				_max = data[_i0];
			} else for (let i = _i0; i <= _i1; i++) {
				let v = data[i];
				if (predicate(v)) {
					if (v < _min) _min = v;
					else if (v > _max) _max = v;
				}
			}
		}
		return [_min ?? Infinity, _max ?? -Infinity];
	}
	function getMinMaxAsinh(data, i0, i1, sorted = 0, cutoff = 0) {
		let _min = inf;
		let _max = -inf;
		let minAbs = inf;
		for (let i = i0; i <= i1; i++) {
			let v = data[i];
			if (v != null) {
				if (v < _min) _min = v;
				if (v > _max) _max = v;
				let a = abs(v);
				if (a > cutoff && a < minAbs) minAbs = a;
			}
		}
		return [
			_min,
			_max,
			minAbs
		];
	}
	function rangeLog(min, max, base, fullMags) {
		if (base == 2) fullMags = true;
		let minSign = sign(min);
		let maxSign = sign(max);
		if (min == max) {
			if (minSign == -1) {
				min *= base;
				max /= base;
			} else {
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
		if (base == 10) {
			if (minExp < 0) minIncr = roundDec(minIncr, -minExp);
			if (maxExp < 0) maxIncr = roundDec(maxIncr, -maxExp);
		}
		if (fullMags) {
			min = minIncr * minSign;
			max = maxIncr * maxSign;
		} else {
			min = incrRoundDn(min, pow(base, floor(minLogAbs)), false);
			max = incrRoundUp(max, pow(base, floor(maxLogAbs)), false);
		}
		return [min, max];
	}
	function rangeAsinh(min, max, base, fullMags) {
		if (min == 0 && max == 0) return [-1, 1];
		let minMax = rangeLog(min, max, base, fullMags);
		if (min == 0) minMax[0] = 0;
		if (max == 0) minMax[1] = 0;
		return minMax;
	}
	const rangePad = .1;
	const rangeZeroIf = .1;
	function atMostWithEpsilon(value, limit) {
		return value <= limit || value - limit <= max(abs(value), abs(limit)) * Number.EPSILON * 2;
	}
	function rangeAnchors(dataMin, dataMax, softMin, softMax, zeroIf = rangeZeroIf) {
		zeroIf ??= rangeZeroIf;
		if (!isFinite$1(zeroIf) || zeroIf < 0) return [null, null];
		let minAnchor = softMin != null && dataMin >= softMin ? softMin : null;
		let maxAnchor = softMax != null && dataMax <= softMax ? softMax : null;
		let rawSpan = dataMax - dataMin;
		if (zeroIf > 0) {
			if (minAnchor == null && dataMin >= 0 && atMostWithEpsilon(dataMin, rawSpan * zeroIf)) minAnchor = 0;
			if (maxAnchor == null && dataMax <= 0 && atMostWithEpsilon(-dataMax, rawSpan * zeroIf)) maxAnchor = 0;
		}
		if (dataMin == 0 && dataMax == 0 && minAnchor == 0 && maxAnchor == 0) {
			if (softMax === 0 && softMin !== 0) minAnchor = null;
			else maxAnchor = null;
		}
		return [minAnchor, maxAnchor];
	}
	const autoRangePart = { pad: rangePad };
	const _eqRangePart = { pad: 0 };
	const _eqRange = {
		zeroIf: rangeZeroIf,
		min: _eqRangePart,
		max: _eqRangePart
	};
	function rangeNum(_min, _max, mult, zeroAffinity) {
		if (isObj(mult)) return _rangeNum(_min, _max, mult);
		_eqRangePart.pad = mult;
		_eqRange.zeroIf = zeroAffinity ? rangeZeroIf : 0;
		return _rangeNum(_min, _max, _eqRange);
	}
	function hasData(data, idx0, idx1) {
		idx0 ??= 0;
		idx1 ??= data.length - 1;
		while (idx0 <= idx1) {
			if (data[idx0] != null) return true;
			idx0++;
		}
		return false;
	}
	function _rangeNum(_min, _max, cfg) {
		let cmin = cfg.min ?? autoRangePart;
		let cmax = cfg.max ?? autoRangePart;
		let zeroIf = cfg.zeroIf ?? .1;
		if (!isFinite$1(zeroIf) || zeroIf < 0) return [null, null];
		let padMin = cmin.pad ?? .1;
		let padMax = cmax.pad ?? .1;
		let hardMin = cmin.hard ?? -Infinity;
		let hardMax = cmax.hard ?? Infinity;
		let [minAnchor, maxAnchor] = rangeAnchors(_min, _max, cmin.soft, cmax.soft, zeroIf);
		let delta = _max - _min;
		let scalarMax = max(abs(_min), abs(_max));
		let flat = scalarMax * (cfg.flat ?? 1e-7);
		if (delta < 1e-24 || delta <= flat) {
			if (delta > 0 && delta <= flat) {
				_min = _max = incrRound(_min + delta / 2, pow10(floor(log10(flat))));
				scalarMax = abs(_min);
			}
			delta = 0;
		}
		let nonZeroDelta = delta || scalarMax || 1e3;
		let mag = log10(nonZeroDelta);
		let incr = pow10(floor(mag) - 1);
		let _padMin = nonZeroDelta * (delta == 0 ? _min == 0 ? .1 : 1 : padMin);
		let _newMin = incrRoundDn(_min - _padMin, incr);
		let minLim = min(hardMax, max(hardMin, minAnchor ?? _newMin));
		let _padMax = nonZeroDelta * (delta == 0 ? _max == 0 ? .1 : 1 : padMax);
		let _newMax = incrRoundUp(_max + _padMax, incr);
		let maxLim = max(hardMin, min(hardMax, maxAnchor ?? _newMax));
		if (minLim == maxLim) {
			if (minLim == 0) {
				if (hardMax == 0) {
					if (hardMin == 0) return [null, null];
					minLim = -100;
				} else maxLim = 100;
			} else if (minLim < 0) {
				minLim *= 2;
				maxLim = 0;
			} else {
				minLim = 0;
				maxLim *= 2;
			}
		}
		return [max(hardMin, minLim), min(hardMax, maxLim)];
	}
	const fmtNum = (val) => fmtNumDec(val);
	function fmtNumDec(value, min = 0, max = 3) {
		const sign = value < 0 || Object.is(value, -0) ? "-" : "";
		if (!isFinite$1(value)) return isNaN(value) ? "NaN" : sign + "∞";
		let digits = "" + abs(value);
		const exp = digits.indexOf("e");
		const dot = digits.indexOf(".");
		let point = dot < 0 ? exp < 0 ? digits.length : exp : dot;
		if (exp >= 0) {
			point += +digits.slice(exp + 1);
			digits = digits.slice(0, exp);
		}
		if (dot >= 0) digits = digits.slice(0, dot) + digits.slice(dot + 1);
		if (point < 1) {
			digits = "0".repeat(1 - point) + digits;
			point = 1;
		}
		let end = point + max;
		if (digits.length > end) {
			if (digits[end] >= "5") {
				while (end && digits[end - 1] === "9") end--;
				digits = end ? digits.slice(0, end - 1) + (+digits[end - 1] + 1) : "1";
				if (!end) point++;
			} else digits = digits.slice(0, end);
		}
		end = digits.length;
		const stop = point + min;
		while (end > stop && digits[end - 1] === "0") end--;
		digits = digits.slice(0, end).padEnd(stop, "0");
		let out = digits.length > point ? "." + digits.slice(point) : "";
		while (point > 3) {
			out = "," + digits.slice(point - 3, point) + out;
			point -= 3;
		}
		return sign + digits.slice(0, point) + out;
	}
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
	M.sqrt;
	const cos = M.cos;
	const sin = M.sin;
	const sign = M.sign;
	const log10 = M.log10;
	const log2 = M.log2;
	const sinh = (v, linthresh = 1) => M.sinh(v) * linthresh;
	const asinh = (v, linthresh = 1) => M.asinh(v / linthresh);
	const inf = Infinity;
	const isFinite$1 = Number.isFinite;
	const decPows = Array.from({ length: 65 }, (_, i) => +`1e${i - 32}`);
	const pow10 = (exp) => decPows[exp + 32] ?? +`1e${exp}`;
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
	const retArg0 = (_0) => _0;
	const retArg1 = (_0, _1) => _1;
	const retNull = (_) => null;
	const retTrue = (_) => true;
	const retEq = (a, b) => a == b;
	function roundIncr(num, incr, mode) {
		let q = num / incr;
		if (abs(q) >= 0x38d7ea4c68000) return num;
		let dec = fixedDec.get(incr);
		if (dec == null) fixedDec.set(incr, dec = guessDec(incr));
		let nearest = round(q);
		let candidate = roundDec(nearest * incr, dec);
		if (candidate == num || abs(candidate - num) <= min(abs(incr) * 1e-7, abs(num) * Number.EPSILON * 2)) return candidate;
		let index;
		if (mode == roundDec) {
			let whole = floor(abs(q));
			let midpoint = roundDec((whole + .5) * abs(incr), dec + 1);
			index = sign(q) * (whole + (abs(num) >= midpoint ? 1 : 0));
		} else index = mode(q);
		return index == nearest ? candidate : roundDec(index * incr, dec);
	}
	function incrRound(num, incr, _fixFloat = true) {
		return _fixFloat ? roundIncr(num, incr, roundDec) : roundDec(num / incr) * incr;
	}
	function incrRoundUp(num, incr, _fixFloat = true) {
		return _fixFloat ? roundIncr(num, incr, ceil) : ceil(num / incr) * incr;
	}
	function incrRoundDn(num, incr, _fixFloat = true) {
		return _fixFloat ? roundIncr(num, incr, floor) : floor(num / incr) * incr;
	}
	function roundDec(val, dec = 0) {
		if (isInt(val)) return val;
		let p = pow10(dec);
		let n = abs(val) * p;
		if (dec > 0 && (n >= 0x38d7ea4c68000 || dec > 32)) return val;
		let int = floor(n);
		let midpoint = (int + .5) / p;
		if (dec > 22 && abs(n - int - .5) <= n * Number.EPSILON * 2) midpoint = +midpoint.toFixed(dec + 1);
		let result = sign(val) * (int + (abs(val) >= midpoint ? 1 : 0)) / p;
		return dec > 22 ? +result.toFixed(dec) : result;
	}
	const fixedDec = /* @__PURE__ */ new Map();
	function guessDec(num) {
		if (isInt(num)) return 0;
		let str = "" + num;
		let dot = str.indexOf(".");
		let exp = str.indexOf("e");
		let dec = dot < 0 ? 0 : (exp < 0 ? str.length : exp) - dot - 1;
		return max(0, dec - (exp < 0 ? 0 : +str.slice(exp + 1)));
	}
	function numDec(splits) {
		let dec = 0;
		for (let v of splits) if (v != null) dec = max(dec, guessDec(v));
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
	const EMPTY_OBJ = {};
	const EMPTY_ARR = [];
	const nullNullTuple = [null, null];
	const isArr = Array.isArray;
	const isInt = Number.isInteger;
	const isUndef = (v) => v === void 0;
	function isStr(v) {
		return typeof v == "string";
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
		return v != null && typeof v == "object";
	}
	const TypedArray = Object.getPrototypeOf(Uint8Array);
	const __proto__ = "__proto__";
	function copy(o, _isObj = isObj) {
		let out;
		if (isArr(o)) {
			let val = o.find((v) => v != null);
			if (isArr(val) || _isObj(val)) {
				out = Array(o.length);
				for (let i = 0; i < o.length; i++) out[i] = copy(o[i], _isObj);
			} else out = o.slice();
		} else if (o instanceof TypedArray) out = o.slice();
		else if (_isObj(o)) {
			out = {};
			for (let k in o) if (k != __proto__) out[k] = copy(o[k], _isObj);
		} else out = o;
		return out;
	}
	function assign(targ) {
		let args = arguments;
		for (let i = 1; i < args.length; i++) {
			let src = args[i];
			for (let key in src) if (key != __proto__) {
				if (isObj(targ[key])) assign(targ[key], copy(src[key]));
				else targ[key] = copy(src[key]);
			}
		}
		return targ;
	}
	const NULL_REMOVE = 0;
	const NULL_RETAIN = 1;
	const NULL_EXPAND = 2;
	function nullExpand(yVals, nullIdxs, alignedLen) {
		for (let i = 0, xi, lastNullIdx = -1; i < nullIdxs.length; i++) {
			let nullIdx = nullIdxs[i];
			if (nullIdx > lastNullIdx) {
				xi = nullIdx - 1;
				while (xi >= 0 && yVals[xi] == null) yVals[xi--] = null;
				xi = nullIdx + 1;
				while (xi < alignedLen && yVals[xi] == null) yVals[lastNullIdx = xi++] = null;
			}
		}
	}
	function mergeXVals(tables) {
		let xRows = tables.map((t) => t[0]);
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
						while (i0 < xs0.length) xs.push(xs0[i0++]);
						break;
					}
					if (xs1[xs1.length - 1] < xs0[i0]) {
						while (i1 < xs1.length) xs.push(xs1[i1++]);
						break;
					}
					let x0 = xs0[i0];
					let x1 = xs1[i1];
					if (x0 < x1) {
						xs.push(x0);
						i0++;
					} else if (x0 > x1) {
						xs.push(x1);
						i1++;
					} else {
						xs.push(x0);
						i0++;
						i1++;
					}
				}
				while (i0 < xs0.length) xs.push(xs0[i0++]);
				while (i1 < xs1.length) xs.push(xs1[i1++]);
				merged.push(xs);
			}
			xRows = merged;
		}
		return xRows[0] ?? [];
	}
	function join(tables, nullModes) {
		if (allHeadersSame(tables)) {
			let table = tables[0].slice();
			for (let i = 1; i < tables.length; i++) table.push(...tables[i].slice(1));
			if (!isAsc(table[0])) table = sortCols(table);
			return table;
		}
		tables = tables.map((table) => isAsc(table[0]) ? table : sortCols(table));
		let aligned = mergeXVals(tables);
		let xIdxs = /* @__PURE__ */ new Map();
		for (let i = 0; i < aligned.length; i++) xIdxs.set(aligned[i], i);
		let data = [aligned];
		let alignedLen = aligned.length;
		for (let ti = 0; ti < tables.length; ti++) {
			let t = tables[ti];
			let xs = t[0];
			let alignedIdxs = t.length > 2 ? Array(xs.length) : null;
			if (alignedIdxs != null) for (let i = 0; i < xs.length; i++) alignedIdxs[i] = xIdxs.get(xs[i]);
			for (let si = 1; si < t.length; si++) {
				let ys = t[si];
				let yVals = Array(alignedLen).fill(void 0);
				let nullMode = nullModes ? nullModes[ti][si] : NULL_RETAIN;
				let nullIdxs = [];
				for (let i = 0; i < ys.length; i++) {
					let yVal = ys[i];
					let alignedIdx = alignedIdxs == null ? xIdxs.get(xs[i]) : alignedIdxs[i];
					if (yVal === null) {
						if (nullMode != NULL_REMOVE) {
							yVals[alignedIdx] = yVal;
							if (nullMode == NULL_EXPAND) nullIdxs.push(alignedIdx);
						}
					} else yVals[alignedIdx] = yVal;
				}
				nullExpand(yVals, nullIdxs, alignedLen);
				data.push(yVals);
			}
		}
		return data;
	}
	function sortCols(table) {
		let head = table[0];
		let rlen = head.length;
		let idxs = Array(rlen);
		for (let i = 0; i < idxs.length; i++) idxs[i] = i;
		idxs.sort((i0, i1) => head[i0] - head[i1]);
		let table2 = [];
		for (let i = 0; i < table.length; i++) {
			let row = table[i];
			let row2 = Array(rlen);
			for (let j = 0; j < rlen; j++) row2[j] = row[idxs[j]];
			table2.push(row2);
		}
		return table2;
	}
	function allHeadersSame(tables) {
		let vals0 = tables[0][0];
		let len0 = vals0.length;
		for (let i = 1; i < tables.length; i++) {
			let vals1 = tables[i][0];
			if (vals1.length != len0) return false;
			if (vals1 != vals0) {
				for (let j = 0; j < len0; j++) if (vals1[j] != vals0[j]) return false;
			}
		}
		return true;
	}
	function isAsc(vals, samples = 100) {
		const len = vals.length;
		if (len <= 1) return true;
		let firstIdx = 0;
		let lastIdx = len - 1;
		while (firstIdx <= lastIdx && vals[firstIdx] == null) firstIdx++;
		while (lastIdx >= firstIdx && vals[lastIdx] == null) lastIdx--;
		if (lastIdx <= firstIdx) return true;
		const stride = max(1, floor((lastIdx - firstIdx + 1) / samples));
		for (let prevVal = vals[firstIdx], i = firstIdx + stride; i <= lastIdx; i += stride) {
			const v = vals[i];
			if (v != null) {
				if (v <= prevVal) return false;
				prevVal = v;
			}
		}
		return true;
	}
	const WIDTH = "width";
	const HEIGHT = "height";
	const BOTTOM = "bottom";
	const LEFT = "left";
	const RIGHT = "right";
	const hexBlack = "#000";
	const transparent = "#0000";
	const mousemove = "mousemove";
	const mousedown = "mousedown";
	const mouseup = "mouseup";
	const mouseenter = "mouseenter";
	const mouseleave = "mouseleave";
	const dblclick = "dblclick";
	const resize = "resize";
	const scroll = "scroll";
	const change = "change";
	const dppxchange = "dppxchange";
	const UPLOT = "uplot";
	const ORI_HZ = "u-hz";
	const ORI_VT = "u-vt";
	const TITLE = "u-title";
	const WRAP = "u-wrap";
	const UNDER = "u-under";
	const OVER = "u-over";
	const AXIS = "u-axis";
	const OFF = "u-off";
	const SELECT = "u-select";
	const CURSOR_X = "u-cursor-x";
	const CURSOR_Y = "u-cursor-y";
	const CURSOR_PT = "u-cursor-pt";
	const LEGEND_EXCLUDE = "u-excl";
	const LEGEND_SIDES = [
		"u-top",
		"u-rgt",
		"u-btm",
		"u-lft"
	];
	const LEGEND_SERIES = "u-series";
	const LEGEND_LABEL = "u-label";
	const LEGEND_VALUE = "u-value";
	const domEnv = typeof window != "undefined";
	const doc = domEnv ? document : null;
	const win = domEnv ? window : null;
	let pxRatio;
	let query;
	function setPxRatio() {
		let _pxRatio = devicePixelRatio;
		if (pxRatio != _pxRatio) {
			pxRatio = _pxRatio;
			query && off("change", query, setPxRatio);
			query = matchMedia(`(min-resolution: ${pxRatio - .001}dppx) and (max-resolution: ${pxRatio + .001}dppx)`);
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
		if (cls != null) addClass(el, cls);
		targ?.insertBefore(el, refEl);
		return el;
	}
	function placeDiv(cls, targ) {
		return placeTag("div", cls, targ);
	}
	const xformCache = /* @__PURE__ */ new WeakMap();
	function elTrans(el, xPos, yPos, xMax, yMax, off) {
		let xform = "translate(" + xPos + "px," + yPos + "px)";
		let xformOld = xformCache.get(el);
		if (xform != xformOld) {
			el.style.transform = xform;
			xformCache.set(el, xform);
		}
		if (xform != xformOld || off != null) {
			if (off ?? (xPos < 0 || yPos < 0 || xPos > xMax || yPos > yMax)) addClass(el, OFF);
			else remClass(el, OFF);
		}
	}
	const colorCache = /* @__PURE__ */ new WeakMap();
	function elColor(el, background, borderColor) {
		let newColor = background + borderColor;
		if (newColor != colorCache.get(el)) {
			colorCache.set(el, newColor);
			el.style.background = background;
			el.style.borderColor = borderColor;
		}
	}
	const sizeCache = /* @__PURE__ */ new WeakMap();
	function elSize(el, newWid, newHgt, centered) {
		let newSize = newWid + "" + newHgt;
		if (newSize != sizeCache.get(el)) {
			sizeCache.set(el, newSize);
			el.style.height = newHgt + "px";
			el.style.width = newWid + "px";
			el.style.marginLeft = centered ? -newWid / 2 + "px" : 0;
			el.style.marginTop = centered ? -newHgt / 2 + "px" : 0;
		}
	}
	const evOpts = { passive: true };
	const evOpts2 = {
		...evOpts,
		capture: true
	};
	function on(ev, el, cb, capt) {
		el.addEventListener(ev, cb, capt ? evOpts2 : evOpts);
	}
	function off(ev, el, cb, capt) {
		el.removeEventListener(ev, cb, capt ? evOpts2 : evOpts);
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
		"December"
	];
	const days = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday"
	];
	function slice3(str) {
		return str.slice(0, 3);
	}
	const days3 = days.map(slice3);
	const engNames = {
		MMMM: months,
		MMM: months.map(slice3),
		WWWW: days,
		WWW: days3
	};
	function zeroPad2(int) {
		return (int < 10 ? "0" : "") + int;
	}
	function zeroPad3(int) {
		return (int < 10 ? "00" : int < 100 ? "0" : "") + int;
	}
	const subs = {
		YYYY: (d) => d.getFullYear(),
		YY: (d) => (d.getFullYear() + "").slice(2),
		MMMM: (d, names) => names.MMMM[d.getMonth()],
		MMM: (d, names) => names.MMM[d.getMonth()],
		MM: (d) => zeroPad2(d.getMonth() + 1),
		M: (d) => d.getMonth() + 1,
		DD: (d) => zeroPad2(d.getDate()),
		D: (d) => d.getDate(),
		WWWW: (d, names) => names.WWWW[d.getDay()],
		WWW: (d, names) => names.WWW[d.getDay()],
		HH: (d) => zeroPad2(d.getHours()),
		H: (d) => d.getHours(),
		h: (d) => {
			let h = d.getHours();
			return h == 0 ? 12 : h > 12 ? h - 12 : h;
		},
		AA: (d) => d.getHours() >= 12 ? "PM" : "AM",
		aa: (d) => d.getHours() >= 12 ? "pm" : "am",
		a: (d) => d.getHours() >= 12 ? "p" : "a",
		mm: (d) => zeroPad2(d.getMinutes()),
		m: (d) => d.getMinutes(),
		ss: (d) => zeroPad2(d.getSeconds()),
		s: (d) => d.getSeconds(),
		fff: (d) => zeroPad3(d.getMilliseconds())
	};
	function fmtDate(tpl, names) {
		names = names || engNames;
		let parts = [];
		let R = /\{([a-z]+)\}|[^{]+/gi, m;
		while (m = R.exec(tpl)) parts.push(m[0][0] == "{" ? subs[m[1]] : m[0]);
		return (d) => {
			let out = "";
			for (let i = 0; i < parts.length; i++) out += typeof parts[i] == "string" ? parts[i] : parts[i](d, names);
			return out;
		};
	}
	let localTz;
	function tzDate(dateOrTs, tz) {
		if (tz == null || tz == (localTz ??= new Intl.DateTimeFormat().resolvedOptions().timeZone)) return typeof dateOrTs == "number" ? new Date(dateOrTs) : dateOrTs;
		let d = new DateZoned(dateOrTs);
		d.setTimeZone(tz);
		return d;
	}
	const twoDigit = "2-digit";
	const fmtrOpts = {
		weekday: "short",
		year: "numeric",
		month: twoDigit,
		day: twoDigit,
		hour: twoDigit,
		minute: twoDigit,
		second: twoDigit,
		fractionalSecondDigits: 3,
		timeZoneName: "longOffset"
	};
	const tzFmt = {};
	function getFormatter(tz) {
		return tzFmt[tz] ??= new Intl.DateTimeFormat("sv", {
			...fmtrOpts,
			timeZone: tz
		}).format;
	}
	var DateZoned = class DateZoned extends Date {
		tz = null;
		#utc = false;
		#str = null;
		constructor(...args) {
			super(...args);
			if (args[0] instanceof DateZoned) {
				this.tz = args[0].tz;
				this.#str = args[0].#str;
				this.#utc = args[0].#utc;
			}
		}
		#get(utcMeth, locMeth, fr, to, add = 0) {
			let s = this.#str;
			return this.#utc ? utcMeth.call(this) : s == null ? locMeth.call(this) : Number(s.slice(fr, to)) + add;
		}
		setTimeZone(tz) {
			this.tz = tz;
			if (tz == "UTC" || tz == "Etc/UTC") this.#utc = true;
			else {
				let f = getFormatter(tz)(this);
				if (f.endsWith("GMT")) f += "+00:00";
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
			return this.#utc ? this.getUTCDay() : s == null ? super.getDay() : s[0] == "s" ? 0 : s[0] == "m" ? 1 : s[1] == "i" ? 2 : s[0] == "o" ? 3 : s[1] == "o" ? 4 : s[0] == "f" ? 5 : s[0] == "l" ? 6 : -1;
		}
		getTimezoneOffset() {
			let s = this.#str;
			return this.#utc ? 0 : s == null ? super.getTimezoneOffset() : (60 * Number(s.slice(-5, -3)) + Number(s.slice(-2))) * (s.at(-6) == "-" ? -1 : 1);
		}
	};
	function getDayOfYear(date) {
		let y = date.getFullYear();
		let m = date.getMonth() + 1;
		let d = date.getDate();
		return --m * 31 - (m > 1 ? (1054267675 >> m * 3 - 6 & 7) - (y & 3 || !(y % 25) && y & 15 ? 0 : 1) : 0) + d;
	}
	function floorSOP(dz, per) {
		let ts2 = dz.getTime() - (dz.getMilliseconds() + dz.getSeconds() * 1e3 + dz.getMinutes() * 60 * 1e3 + dz.getHours() * 3600 * 1e3 + (per == 4 ? dz.getDate() - 1 : per == 5 ? getDayOfYear(dz) - 1 : 0) * 24 * 3600 * 1e3);
		let dz2 = tzDate(ts2, dz.tz);
		let h2 = dz2.getHours();
		if (h2 > 0) dz2 = tzDate(ts2 + (h2 > 12 ? 24 - h2 : -h2) * 3600 * 1e3, dz.tz);
		return dz2;
	}
	const onlyWhole = (v) => v % 1 == 0;
	const allMults = [
		1,
		2,
		2.5,
		5
	];
	const decIncrs = genIncrs(10, -32, 0, allMults);
	const oneIncrs = genIncrs(10, 0, 32, allMults);
	const wholeIncrs = oneIncrs.filter(onlyWhole);
	const numIncrs = decIncrs.concat(oneIncrs);
	const NL = "\n";
	const yyyy = "{YYYY}";
	const NLyyyy = NL + yyyy;
	const md = "{M}/{D}";
	const NLmd = NL + md;
	const NLmdyy = NLmd + "/{YY}";
	const aa = "{aa}";
	const hmmaa = "{h}:{mm}" + aa;
	const NLhmmaa = NL + hmmaa;
	const ss = ":{ss}";
	const _ = null;
	function genTimeStuffs(ms) {
		let s = ms * 1e3, m = s * 60, h = m * 60, d = h * 24, mo = d * 30, y = d * 365;
		let timeIncrs = (ms == 1 ? genIncrs(10, 0, 3, allMults).filter(onlyWhole) : genIncrs(10, -3, 0, allMults)).concat([
			s,
			s * 5,
			s * 10,
			s * 15,
			s * 30,
			m,
			m * 5,
			m * 10,
			m * 15,
			m * 30,
			h,
			h * 2,
			h * 3,
			h * 4,
			h * 6,
			h * 8,
			h * 12,
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
			mo,
			mo * 2,
			mo * 3,
			mo * 4,
			mo * 6,
			y,
			y * 2,
			y * 5,
			y * 10,
			y * 25,
			y * 50,
			y * 100
		]);
		const _timeAxisStamps = [
			[
				y,
				yyyy,
				_,
				_,
				_,
				_,
				_,
				_,
				1
			],
			[
				d * 28,
				"{MMM}",
				NLyyyy,
				_,
				_,
				_,
				_,
				_,
				1
			],
			[
				d,
				md,
				NLyyyy,
				_,
				_,
				_,
				_,
				_,
				1
			],
			[
				h,
				"{h}" + aa,
				NLmdyy,
				_,
				NLmd,
				_,
				_,
				_,
				1
			],
			[
				m,
				hmmaa,
				NLmdyy,
				_,
				NLmd,
				_,
				_,
				_,
				1
			],
			[
				s,
				ss,
				NLmdyy + " " + hmmaa,
				_,
				NLmd + " " + hmmaa,
				_,
				NLhmmaa,
				_,
				1
			],
			[
				ms,
				ss + ".{fff}",
				NLmdyy + " " + hmmaa,
				_,
				NLmd + " " + hmmaa,
				_,
				NLhmmaa,
				_,
				1
			]
		];
		function timeAxisSplits(tzDate) {
			return (self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
				let nice = self.axes[axisIdx].nice;
				let splits = [];
				let isYr = foundIncr >= y;
				let isMo = foundIncr >= mo && foundIncr < y;
				let isDays = foundIncr >= d && foundIncr < mo;
				let isHours = foundIncr > h && foundIncr < d;
				let minDate = tzDate(scaleMin);
				let minDateTs = roundDec(minDate * ms, 3);
				let minMinTs = roundDec(floorSOP(minDate, isYr || isMo ? 5 : isDays ? 4 : 3) * ms, 3);
				if (isDays) {
					let incrDays = foundIncr / d;
					let skip = floor((minDate.getDate() - 1) / incrDays);
					let split = minMinTs + foundIncr * skip;
					do {
						let date = tzDate(split);
						let hour = date.getHours();
						if (hour != 0) {
							split += hour > 12 ? h : -h;
							date = tzDate(split);
						}
						if (nice.first && (date.getDate() - 1) % incrDays > 0) {
							date = floorSOP(date, 4);
							split = date.getTime() * ms;
							if (split - splits[splits.length - 1] < foundIncr * .7) splits.pop();
						}
						if (split > scaleMax) break;
						if (split >= scaleMin) splits.push(split);
						split += foundIncr;
					} while (1);
				} else if (isMo || isYr) {
					let subIncrs = 1;
					let subIncrDays = 1;
					let periodType = 0;
					let periodMin = 0;
					if (isMo) {
						subIncrs = foundIncr / mo;
						subIncrDays = 32;
						periodType = 4;
						periodMin = minDate.getMonth();
					} else if (isYr) {
						subIncrs = foundIncr / y;
						subIncrDays = 366;
						periodType = 5;
						periodMin = minDate.getYear();
					}
					foundIncr = subIncrs * subIncrDays * d;
					let skip = floor(periodMin / subIncrDays);
					let split = minMinTs + foundIncr * skip;
					do {
						split = floorSOP(tzDate(split), periodType).getTime() * ms;
						if (split > scaleMax) break;
						if (split >= scaleMin) splits.push(split);
						split += foundIncr;
					} while (1);
				} else if (isHours) {
					let incrHours = foundIncr / h;
					let skip = floor(minDate.getHours() / incrHours);
					let split = minMinTs + foundIncr * skip;
					do {
						let hour = tzDate(split).getHours();
						if (nice.dst && hour % incrHours > 0) {
							let hour2 = tzDate(split - h).getHours();
							split += hour2 % incrHours == 0 ? -h : h;
						}
						if (split > scaleMax) break;
						if (split >= scaleMin) splits.push(split);
						split += foundIncr;
					} while (1);
				} else {
					let split = minMinTs + incrRoundUp(minDateTs - minMinTs, foundIncr);
					do {
						if (split > scaleMax) break;
						if (split >= scaleMin) splits.push(split);
						split += foundIncr;
					} while (1);
				}
				return splits;
			};
		}
		return [
			timeIncrs,
			_timeAxisStamps,
			timeAxisSplits
		];
	}
	const [timeIncrsMs, _timeAxisStampsMs, timeAxisSplitsMs] = genTimeStuffs(1);
	const [timeIncrsS, _timeAxisStampsS, timeAxisSplitsS] = genTimeStuffs(.001);
	genIncrs(2, -53, 53, [1]);
	function timeAxisStamps(stampCfg, fmtDate) {
		return stampCfg.map((s) => s.map((v, i) => i == 0 || i == 8 || v == null ? v : fmtDate(i == 1 || s[8] == 0 ? v : s[1] + v)));
	}
	function timeAxisVals(tzDate, stamps) {
		return (self, splits, axisIdx, foundSpace, foundIncr) => {
			let s = stamps.find((s) => foundIncr >= s[0]) || stamps[stamps.length - 1];
			let prevYear;
			let prevMnth;
			let prevDate;
			let prevHour;
			let prevMins;
			let prevSecs;
			return splits.map((split) => {
				let date = tzDate(split);
				let newYear = date.getFullYear();
				let newMnth = date.getMonth();
				let newDate = date.getDate();
				let newHour = date.getHours();
				let newMins = date.getMinutes();
				let newSecs = date.getSeconds();
				let stamp = newYear != prevYear && s[2] || newMnth != prevMnth && s[3] || newDate != prevDate && s[4] || newHour != prevHour && s[5] || newMins != prevMins && s[6] || newSecs != prevSecs && s[7] || s[1];
				prevYear = newYear;
				prevMnth = newMnth;
				prevDate = newDate;
				prevHour = newHour;
				prevMins = newMins;
				prevSecs = newSecs;
				return stamp(date);
			});
		};
	}
	function timeAxisVal(tzDate, dateTpl) {
		let stamp = fmtDate(dateTpl);
		return (self, splits, axisIdx, foundSpace, foundIncr) => splits.map((split) => stamp(tzDate(split)));
	}
	function timeSeriesStamp(stampCfg, fmtDate) {
		return fmtDate(stampCfg);
	}
	function timeSeriesVal(tzDate, stamp) {
		return (self, val, seriesIdx, dataIdx) => dataIdx == null ? "--" : stamp(tzDate(val));
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
		mode: null,
		side: 2,
		isolate: false,
		filter: null,
		sort: null,
		limit: null,
		mount: noop,
		markers: {
			show: true,
			width: 2,
			stroke: legendStroke,
			fill: legendFill,
			dash: "solid"
		},
		idx: null,
		idxs: null,
		values: []
	};
	const tooltipOpts = {
		show: false,
		mode: "table",
		gap: 5,
		markers: legendOpts.markers,
		mount: legendOpts.mount,
		filter: null,
		sort: null,
		limit: null,
		idx: null,
		idxs: null,
		values: []
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
		return self.series[si].points.size;
	}
	const moveTuple = [0, 0];
	function cursorMove(self, mouseLeft1, mouseTop1) {
		moveTuple[0] = mouseLeft1;
		moveTuple[1] = mouseTop1;
		return moveTuple;
	}
	function filtBtn0(self, targ, handle, onlyTarg = true) {
		return (e) => {
			e.button == 0 && (!onlyTarg || e.target == targ) && handle(e);
		};
	}
	function filtTarg(self, targ, handle, onlyTarg = true) {
		return (e) => {
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
			one: false,
			show: cursorPointShow,
			size: cursorPointSize,
			width: 0,
			stroke: cursorPointStroke,
			fill: cursorPointFill
		},
		bind: {
			mousedown: filtBtn0,
			mouseup: filtBtn0,
			click: filtBtn0,
			dblclick: filtBtn0,
			mousemove: filtTarg,
			mouseleave: filtTarg,
			mouseenter: filtTarg
		},
		drag: {
			setRange: true,
			setScale: null,
			x: true,
			y: false,
			dist: 0,
			uni: null,
			click: (self, e) => {
				e.stopPropagation();
				e.stopImmediatePropagation();
			},
			_x: false,
			_y: false
		},
		focus: {
			dist: (self, seriesIdx, dataIdx, valPos, curPos) => valPos - curPos,
			prox: -1,
			bias: 0
		},
		hover: {
			skip: [void 0],
			prox: null,
			bias: 0
		},
		left: -10,
		top: -10,
		idx: null,
		dataIdx: null,
		idxs: null,
		trackDists: false,
		dists: null,
		event: null
	};
	const axisLines = {
		show: true,
		stroke: "rgba(0,0,0,0.07)",
		width: 2
	};
	const grid = assign({}, axisLines, { filter: retArg1 });
	const ticks = assign({}, grid, { size: 10 });
	const border = assign({}, axisLines, { show: false });
	const font = "12px system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, \"Noto Sans\", sans-serif, \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Segoe UI Symbol\", \"Noto Color Emoji\"";
	const labelFont = "bold " + font;
	const lineGap = 1.5;
	const nice = {
		dst: true,
		first: false
	};
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
		grid,
		ticks,
		border,
		font,
		lineGap,
		rotate: 0
	};
	const xSeriesOpts = {
		show: true,
		scale: "x",
		sorted: 1,
		min: inf,
		max: -Infinity,
		idxs: []
	};
	function numAxisVals(self, splits, axisIdx, foundSpace, foundIncr) {
		let dec = numDec(splits);
		return splits.map((v) => v == null ? "" : dec > 100 ? v.toExponential() : fmtNumDec(v == 0 ? 0 : v, dec, dec));
	}
	function numAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
		let splits = [];
		let numDec = fixedDec.get(foundIncr);
		if (numDec == null) fixedDec.set(foundIncr, numDec = guessDec(foundIncr));
		if (forceMin) numDec = max(numDec, guessDec(scaleMin));
		else scaleMin = roundDec(incrRoundUp(scaleMin, foundIncr), numDec);
		for (let val = scaleMin; val <= scaleMax;) {
			splits.push(Object.is(val, -0) ? 0 : val);
			if (val == scaleMax) break;
			let next = roundDec(val + foundIncr, numDec);
			if (!(next > val)) return [];
			val = next;
		}
		return splits;
	}
	function logAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
		if (!isFinite$1(scaleMin) || !isFinite$1(scaleMax) || scaleMin <= 0 || scaleMin > scaleMax) return [];
		const splits = [];
		const logBase = self.scales[self.axes[axisIdx].scale].log;
		const exp = floor((logBase == 10 ? log10 : log2)(scaleMin));
		foundIncr = pow(logBase, exp);
		if (logBase == 10) foundIncr = numIncrs[closestIdx(foundIncr, numIncrs)];
		let split = foundIncr;
		let nextMagIncr = foundIncr * logBase;
		if (logBase == 10) nextMagIncr = numIncrs[closestIdx(nextMagIncr, numIncrs)];
		do {
			if (split >= scaleMin) splits.push(split);
			split = split + foundIncr;
			if (logBase == 10 && !fixedDec.has(split)) split = roundDec(split, fixedDec.get(foundIncr));
			if (split >= nextMagIncr) {
				foundIncr = split;
				nextMagIncr = foundIncr * logBase;
				if (logBase == 10) nextMagIncr = numIncrs[closestIdx(nextMagIncr, numIncrs)];
			}
		} while (split <= scaleMax);
		return splits;
	}
	function asinhAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
		if (!isFinite$1(scaleMin) || !isFinite$1(scaleMax) || scaleMin > scaleMax) return [];
		let linthresh = self.scales[self.axes[axisIdx].scale]._asinh;
		if (scaleMin >= -linthresh && scaleMax <= linthresh) return numAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin);
		let posSplits = scaleMax >= linthresh ? logAxisSplits(self, axisIdx, max(linthresh, scaleMin), scaleMax, foundIncr, foundSpace, forceMin) : [];
		let zero = scaleMax >= 0 && scaleMin <= 0 ? [0] : [];
		return (scaleMin <= -linthresh ? logAxisSplits(self, axisIdx, max(linthresh, -scaleMax), -scaleMin, foundIncr, foundSpace, forceMin) : []).reverse().map((v) => -v).concat(zero, posSplits);
	}
	const RE_ALL = /./;
	const RE_12357 = /[12357]/;
	const RE_125 = /[125]/;
	const RE_1 = /1/;
	const _filt = (splits, distr, re, keepMod, logFn) => {
		let asinh = distr == 4;
		let mag = asinh && keepMod > 1 ? floor(logFn(max(abs(splits[0]), abs(splits.at(-1))))) : null;
		return splits.map((v, i) => asinh && v == 0 || re.test(v.toExponential()[v < 0 ? 1 : 0]) && (mag == null ? i : mag - round(logFn(abs(v)))) % keepMod == 0 ? v : null);
	};
	function log10AxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
		let axis = self.axes[axisIdx];
		let scaleKey = axis.scale;
		let sc = self.scales[scaleKey];
		if (sc.distr == 4 && sc.min >= -sc._asinh && sc.max <= sc._asinh) return splits;
		let valToPos = self.valToPos;
		let minSpace = axis._space;
		let linthresh = sc.distr == 4 ? sc._asinh : 1;
		let _10 = valToPos(10 * linthresh, scaleKey);
		let re = abs(valToPos(9 * linthresh, scaleKey) - _10) >= minSpace ? RE_ALL : abs(valToPos(7 * linthresh, scaleKey) - _10) >= minSpace ? RE_12357 : abs(valToPos(5 * linthresh, scaleKey) - _10) >= minSpace ? RE_125 : RE_1;
		if (re == RE_1) {
			let magSpace = abs(valToPos(linthresh, scaleKey) - _10);
			if (magSpace < minSpace) return _filt(splits.slice().reverse(), sc.distr, re, ceil(minSpace / magSpace), log10).reverse();
		}
		return _filt(splits, sc.distr, re, 1);
	}
	function log2AxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
		let axis = self.axes[axisIdx];
		let scaleKey = axis.scale;
		let sc = self.scales[scaleKey];
		if (sc.distr == 4 && sc.min >= -sc._asinh && sc.max <= sc._asinh) return splits;
		let minSpace = axis._space;
		let valToPos = self.valToPos;
		let linthresh = sc.distr == 4 ? sc._asinh : 1;
		let magSpace = abs(valToPos(linthresh, scaleKey) - valToPos(2 * linthresh, scaleKey));
		if (magSpace < minSpace) return _filt(splits.slice().reverse(), sc.distr, RE_ALL, ceil(minSpace / magSpace), log2).reverse();
		return splits;
	}
	function numSeriesVal(self, val, seriesIdx, dataIdx) {
		return dataIdx == null ? "--" : val == null ? "" : fmtNum(val);
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
		grid,
		ticks,
		border,
		font,
		lineGap,
		rotate: 0
	};
	function ptDia(width, mult) {
		return roundDec((3 + (width || 1) * 2) * mult, 3);
	}
	function seriesPointsShow(self, si) {
		let { scale, idxs } = self.series[0];
		let xData = self._data[0];
		let p0 = self.valToPos(xData[idxs[0]], scale, true);
		let p1 = self.valToPos(xData[idxs[1]], scale, true);
		let maxPts = abs(p1 - p0) / (self.series[si].points.space * self.pxRatio);
		return idxs[1] - idxs[0] <= maxPts;
	}
	const facet = {
		scale: null,
		sorted: 0,
		min: inf,
		max: -Infinity
	};
	const gaps = (self, seriesIdx, idx0, idx1, nullGaps) => nullGaps;
	const xySeriesOpts = {
		show: true,
		sorted: 0,
		gaps,
		alpha: 1,
		facets: [assign({}, facet, { scale: "x" }), assign({}, facet, { scale: "y" })]
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
			filter: null
		},
		values: null,
		min: inf,
		max: -Infinity,
		idxs: [],
		path: null,
		clip: null
	};
	function clampScale(self, val, scaleMin, scaleMax, scaleKey) {
		return scaleMin / 10;
	}
	const xScaleOpts = {
		time: true,
		auto: true,
		distr: 1,
		log: 10,
		asinh: null,
		min: null,
		max: null,
		dir: 1,
		ori: 0
	};
	const yScaleOpts = assign({}, xScaleOpts, {
		time: false,
		ori: 1
	});
	function rangeYCount(dim, ramp = 1, space = 50) {
		if (!(dim > 0) || !isFinite$1(dim) || !(space > 0) || !isFinite$1(space) || !(ramp >= 0) || !isFinite$1(ramp)) return 0;
		let target = dim / space;
		target += Math.exp(-target / 3);
		return max(1, round(1 + (target - 1) * ramp));
	}
	const autoLimit = Object.freeze({ pad: rangePad });
	const rangeYAuto = Object.freeze({
		zeroIf: rangeZeroIf,
		min: autoLimit,
		max: autoLimit
	});
	function limitPolicy(limit, side) {
		limit ??= autoLimit;
		let hardDefault = side == 0 ? -Infinity : Infinity;
		let softDefault = -hardDefault;
		let hard = limit.hard ?? hardDefault;
		let soft = limit.soft ?? softDefault;
		let pad = limit.pad ?? autoLimit.pad;
		if (!isFinite$1(hard) && hard != hardDefault || !isFinite$1(soft) && soft != softDefault || !isFinite$1(pad) || pad < 0) return null;
		return {
			hard,
			soft,
			pad
		};
	}
	function incrAligned(value, incr) {
		return incrRound(value, incr) == value;
	}
	function incrStart(minimum) {
		let lo = 0;
		let hi = numIncrs.length;
		while (lo < hi) {
			let mid = lo + hi >> 1;
			if (numIncrs[mid] < minimum) lo = mid + 1;
			else hi = mid;
		}
		return max(0, lo - 1);
	}
	function prepareRangeY(dataMin, dataMax, range) {
		range ??= rangeYAuto;
		let zeroIf = range.zeroIf ?? rangeYAuto.zeroIf;
		let minPolicy = limitPolicy(range.min, 0);
		let maxPolicy = limitPolicy(range.max, 1);
		if (!isFinite$1(zeroIf) || zeroIf < 0 || minPolicy == null || maxPolicy == null || minPolicy.hard >= maxPolicy.hard) return null;
		let rawSpan = dataMax - dataMin;
		let [minAnchor, maxAnchor] = rangeAnchors(dataMin, dataMax, minPolicy.soft, maxPolicy.soft, zeroIf);
		if (minAnchor != null) minAnchor = max(minAnchor, minPolicy.hard);
		if (maxAnchor != null) maxAnchor = min(maxAnchor, maxPolicy.hard);
		let fallbackMin = dataMin;
		let fallbackMax = dataMax;
		if (dataMin == dataMax) {
			fallbackMin = dataMin - abs(dataMin);
			fallbackMax = dataMax == 0 ? 100 : dataMax + abs(dataMax);
			if (dataMin == 0 && (maxAnchor == 0 && minAnchor == null || maxPolicy.hard == 0)) {
				fallbackMin = -100;
				fallbackMax = 0;
				if (minPolicy.soft != 0) minAnchor = null;
			}
		}
		let span = fallbackMax - fallbackMin;
		if (!isFinite$1(span)) return null;
		let boundedMin = max(dataMin, minPolicy.hard);
		let boundedMax = min(dataMax, maxPolicy.hard);
		if (boundedMin > boundedMax) return null;
		return {
			minAnchor,
			maxAnchor,
			span,
			boundedMin,
			boundedMax,
			paddedMin: max(fallbackMin - rawSpan * minPolicy.pad, minPolicy.hard),
			paddedMax: min(fallbackMax + rawSpan * maxPolicy.pad, maxPolicy.hard),
			minPolicy,
			maxPolicy
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
		if (!isFinite$1(requiredMin) || !isFinite$1(requiredMax) || !isFinite$1(requiredSpan)) return null;
		let start = incrStart(requiredSpan / count);
		let approximate = !exactCount && count > 1;
		let requiredMagnitude = max(abs(requiredMin), abs(requiredMax));
		let best = null;
		for (let i = start; i < numIncrs.length; i++) {
			let incr = numIncrs[i];
			let dec = fixedDec.get(incr);
			let tickSpan = count * incr;
			let magnitude = requiredMagnitude + tickSpan;
			if (dec > 32 || magnitude / incr >= 0x38d7ea4c68000 || magnitude > Number.MAX_SAFE_INTEGER || dec > 0 && magnitude * 10 ** dec >= 0x38d7ea4c68000) continue;
			if (minAnchor != null && !incrAligned(minAnchor, incr) || maxAnchor != null && !incrAligned(maxAnchor, incr)) continue;
			let lo;
			let hi;
			let foundCount = count;
			if (approximate) {
				lo = minAnchor ?? incrRoundDn(boundedMin, incr);
				hi = maxAnchor ?? incrRoundUp(boundedMax, incr);
				if (minAnchor == null && lo > boundedMin) lo = roundDec(lo - incr, dec);
				if (maxAnchor == null && hi < boundedMax) hi = roundDec(hi + incr, dec);
				foundCount = round((hi - lo) / incr);
				if (!Number.isSafeInteger(foundCount) || foundCount < 1) continue;
			} else if (minAnchor != null) {
				lo = minAnchor;
				hi = roundDec(lo + tickSpan, dec);
				if (maxAnchor != null && hi != maxAnchor) continue;
			} else if (maxAnchor != null) {
				hi = maxAnchor;
				lo = roundDec(hi - tickSpan, dec);
			} else {
				let baseLo = incrRoundDn(boundedMin, incr);
				let baseHi = incrRoundUp(boundedMax, incr);
				if (baseLo > boundedMin) baseLo = roundDec(baseLo - incr, dec);
				if (baseHi < boundedMax) baseHi = roundDec(baseHi + incr, dec);
				let used = round((baseHi - baseLo) / incr);
				if (count == 1 && baseLo < 0 && baseHi > 0 && incr >= span) {
					lo = baseLo;
					hi = baseHi;
				} else {
					if (used > count) continue;
					let minLo = roundDec(baseHi - tickSpan, dec);
					let maxLo = baseLo;
					if (isFinite$1(hardMin)) minLo = max(minLo, incrRoundUp(hardMin, incr));
					if (isFinite$1(hardMax)) maxLo = min(maxLo, incrRoundDn(hardMax - tickSpan, incr));
					if (boundedMin >= 0) minLo = max(0, minLo);
					if (boundedMax <= 0) maxLo = min(-tickSpan, maxLo);
					if (minLo > maxLo) continue;
					lo = roundDec(baseLo - floor((count - used) / 2) * incr, dec);
					lo = min(max(lo, minLo), maxLo);
					hi = roundDec(lo + tickSpan, dec);
				}
			}
			magnitude = max(abs(lo), abs(hi));
			if (magnitude <= Number.MAX_SAFE_INTEGER && (dec == 0 || magnitude * 10 ** dec < 0x38d7ea4c68000) && lo >= hardMin && hi <= hardMax && lo <= boundedMin && hi >= boundedMax && hi > lo) {
				if (best == null || abs(foundCount - count) <= abs(best.count - count)) best = {
					min: lo == 0 ? 0 : lo,
					max: hi == 0 ? 0 : hi,
					incr: foundCount == 1 ? hi - lo : incr,
					count: foundCount
				};
				if (foundCount <= count) return best;
			}
		}
		return best;
	}
	function rangeY(dataMin, dataMax, dim, range = rangeYAuto, ramp = 1, exactCount = false, space = 50) {
		if (dataMin == null && dataMax == null) return {
			min: null,
			max: null,
			incr: 0,
			count: 0
		};
		let count = rangeYCount(dim, ramp, space);
		if (!Number.isSafeInteger(count) || count < 1 || dataMin == null || dataMax == null || !isFinite$1(dataMin) || !isFinite$1(dataMax) || dataMax < dataMin) return null;
		let request = prepareRangeY(dataMin, dataMax, range);
		if (request == null) return null;
		return selectRangeY(request, count, exactCount);
	}
	function createKeyedList(parent, getKey, mount, before = null) {
		const records = /* @__PURE__ */ new Map();
		let ordered = [];
		let next = [];
		function remove(record) {
			const { instance } = record;
			const { node } = instance;
			instance.destroy();
			if (node.parentNode === parent) parent.removeChild(node);
		}
		function update(entries) {
			for (let i = 0; i < ordered.length; i++) ordered[i].active = false;
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				const key = getKey(entry);
				let record = records.get(key);
				if (record === void 0) {
					record = {
						key,
						instance: mount(entry),
						active: true
					};
					records.set(key, record);
				} else record.active = true;
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
					if (node.parentNode === parent && node.isConnected && typeof parent.moveBefore === "function") parent.moveBefore(node, anchor);
					else parent.insertBefore(node, anchor);
				}
				anchor = node;
			}
			const previous = ordered;
			ordered = next;
			next = previous;
		}
		function destroy() {
			for (let i = 0; i < ordered.length; i++) remove(ordered[i]);
			records.clear();
			ordered.length = 0;
			next.length = 0;
		}
		return {
			update,
			destroy
		};
	}
	function h(tag, props, ...children) {
		const node = document.createElement(tag);
		for (const key in props) {
			const value = props[key];
			if (value != null) {
				if (key == "style") {
					for (const name in value) if (value[name] != null) node.style[name] = value[name];
				} else node[key] = value;
			}
		}
		append(node, children);
		return node;
	}
	function append(parent, child) {
		if (isArr(child)) for (const item of child) append(parent, item);
		else if (child != null && child !== false && child !== "") parent.append(child);
	}
	function textValue(value) {
		return value == null || value === false ? "" : String(value);
	}
	function setText(node, text) {
		if (node.firstChild != null) node.firstChild.nodeValue = text;
		else node.textContent = text;
	}
	function createValueCells(keys) {
		const nodes = keys.map(() => h("td", { className: LEGEND_VALUE }));
		const previous = Array(keys.length).fill("");
		return {
			nodes,
			update(values) {
				for (let i = 0; i < keys.length; i++) {
					const text = textValue(values == null ? "--" : values[keys[i]]);
					if (text !== previous[i]) {
						setText(nodes[i], text);
						previous[i] = text;
					}
				}
			}
		};
	}
	function createLegendTemplate(self, opts, keys, markersShow) {
		const { legend, cursorFocus, bind, emit, interactive = true } = opts;
		let multi = opts.multi;
		let inline;
		const sideClass = LEGEND_SIDES[opts.side ?? legend.side ?? 2];
		const rowMeta = /* @__PURE__ */ new WeakMap();
		const body = h("tbody");
		const node = h("table", null, body);
		let head;
		function setColumns(nextKeys, nextMulti) {
			keys = nextKeys;
			multi = nextMulti;
			inline = legend.mode == null ? !multi : legend.mode == "inline";
			head?.remove();
			head = multi ? h("thead", null, h("tr", null, h("th"), keys.map((key) => h("th", { className: LEGEND_LABEL }, key)))) : null;
			if (head) node.insertBefore(head, body);
		}
		setColumns(keys, multi);
		let values = [];
		let focused = null;
		let tableClass;
		function bindEvent(el, type, series, onlyTarget) {
			const bindType = type == "focus" ? mouseenter : type == "leave" ? mouseleave : type;
			const listener = bind[bindType](self, el, (e) => emit(type, series, e), onlyTarget);
			if (listener) on(bindType, el, listener);
			return listener;
		}
		function createRowEvents(header, series) {
			let bound = false;
			let click, focus;
			function unbind() {
				if (click) off("click", header, click);
				if (focus) off(mouseenter, header, focus);
				click = focus = null;
				bound = false;
			}
			return {
				update(eligible) {
					if (eligible !== bound) {
						if (eligible) {
							click = bindEvent(header, "click", series, false);
							if (cursorFocus) focus = bindEvent(header, "focus", series, false);
							bound = true;
						} else unbind();
					}
				},
				destroy: unbind
			};
		}
		let leave = interactive && cursorFocus ? bindEvent(node, "leave", null, true) : null;
		function prepare({ series, index }) {
			let state = rowMeta.get(series);
			if (state == null) {
				const markers = legend.markers;
				let border = null, background = null, color = null;
				if (index > 0) {
					if (markersShow) {
						const width = markers.width(self, index);
						if (width) border = width + "px " + markers.dash(self, index) + " " + markers.stroke(self, index);
						background = markers.fill(self, index);
					} else color = series.width > 0 ? markers.stroke(self, index) : markers.fill(self, index);
				}
				const label = series.label;
				state = {
					label: label instanceof HTMLElement ? interactive ? label : label.cloneNode(true) : textValue(label),
					border,
					background,
					color
				};
				rowMeta.set(series, state);
			}
			return state;
		}
		function createRow(entry) {
			const state = prepare(entry);
			const cells = createValueCells(keys);
			let header, label;
			const row = h("tr", null, header = h("th", null, markersShow && h("div", {
				className: "u-marker",
				style: {
					border: state.border,
					background: state.background
				}
			}), label = h("div", {
				className: LEGEND_LABEL,
				style: { color: state.color }
			}, state.label)), cells.nodes);
			const events = interactive ? createRowEvents(header, entry.series) : null;
			let className;
			return {
				node: row,
				update({ series, index }) {
					const nextClass = LEGEND_SERIES + (series.class ? " " + series.class : "") + (series.show ? "" : " " + OFF) + (index > 0 && series == focused ? " u-focus" : "");
					if (nextClass !== className) row.className = className = nextClass;
					events?.update(index > 0);
					cells.update(values[index]);
				},
				destroy() {
					events?.destroy();
					if (state.label instanceof HTMLElement && state.label.parentNode === label) label.removeChild(state.label);
				}
			};
		}
		return {
			node,
			body,
			createRow,
			setColumns,
			update(data, focusedSeries) {
				values = data;
				focused = focusedSeries;
				const className = "u-legend " + sideClass + (inline ? " u-inline" + (legend.live || keys.length > 0 ? " u-live" : "") : "");
				if (className !== tableClass) {
					if (tableClass != null) node.classList.remove(...tableClass.split(" "));
					node.classList.add(...className.split(" "));
					tableClass = className;
				}
			},
			destroy() {
				if (leave) off(mouseleave, node, leave);
				leave = null;
			}
		};
	}
	const seriesKey = (entry) => entry.series;
	function columnKeys(columns) {
		const keys = [];
		for (const key in columns) keys.push(key);
		return keys;
	}
	function createLegend(self, parent, opts, selectRows) {
		const { series, legend, mode } = opts;
		const markersShow = legend.markers.show;
		let keys = columnKeys(opts.columns);
		let multi = opts.multi;
		const entriesBySeries = /* @__PURE__ */ new WeakMap();
		const entries = [];
		let template, rows;
		let destroyed = false;
		function select(data) {
			let count = 0;
			const order = legend.order;
			const length = order == null ? series.length - 1 : order.length;
			const start = multi || !legend.live || mode == 2 ? 0 : -1;
			for (let i = start; i < length; i++) {
				const index = i == -1 ? 0 : order == null ? i + 1 : order[i];
				const s = series[index];
				let entry = entriesBySeries.get(s);
				if (entry == null) {
					entry = {
						series: s,
						index
					};
					entriesBySeries.set(s, entry);
				} else entry.index = index;
				entries[count++] = entry;
			}
			entries.length = count;
			return selectRows ? selectRows(entries, data) : entries;
		}
		return {
			setColumns(columns, nextMulti) {
				if (destroyed) return;
				const nextKeys = columnKeys(columns);
				if (multi === nextMulti && keys.length === nextKeys.length && keys.every((key, i) => key === nextKeys[i])) return;
				keys = nextKeys;
				multi = nextMulti;
				rows?.destroy();
				template?.setColumns(keys, multi);
			},
			render(data, focus) {
				if (destroyed) return;
				const mount = template == null;
				if (mount) {
					template = createLegendTemplate(self, {
						...opts,
						multi
					}, keys, markersShow);
					rows = createKeyedList(template.body, seriesKey, template.createRow);
				}
				const selected = select(data);
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
			}
		};
	}
	function createTooltip(self, options) {
		const { gap } = options;
		let node, observer;
		let width = 0, height = 0;
		function update(rect) {
			if (node == null) return;
			rect ??= self.rect;
			const { left, top } = self.cursor;
			const x = rect.left + left;
			const y = rect.top + top;
			const viewportWidth = document.documentElement.clientWidth;
			const viewportHeight = document.documentElement.clientHeight;
			const visible = self.tooltip.order.length > 0 && self.tooltip.idxs.some((idx) => idx != null) && left >= 0 && top >= 0 && left <= rect.width && top <= rect.height && x >= 0 && y >= 0 && x <= viewportWidth && y <= viewportHeight;
			node.style.display = visible ? "" : "none";
			if (visible) {
				const tx = x + width + gap > viewportWidth ? x - width - gap : x + gap;
				const ty = y + height + gap > viewportHeight ? y - height - gap : y + gap;
				node.style.transform = `translate(${tx}px, ${ty}px)`;
			}
		}
		const syncRect = () => self.syncRect();
		return {
			mount(u, el) {
				node = el;
				node.classList.add("u-tooltip");
				self.over.appendChild(node);
				window.addEventListener("scroll", syncRect, true);
				window.addEventListener("resize", syncRect);
				observer = new ResizeObserver(([entry]) => {
					const { inlineSize, blockSize } = entry.borderBoxSize[0];
					if (inlineSize > 0 && blockSize > 0) {
						width = inlineSize;
						height = blockSize;
						update();
					}
				});
				observer.observe(node, { box: "border-box" });
				update();
			},
			update,
			destroy() {
				observer?.disconnect();
				window.removeEventListener("scroll", syncRect, true);
				window.removeEventListener("resize", syncRect);
				node = observer = null;
			}
		};
	}
	const measureContexts = /* @__PURE__ */ new Map();
	function measureContext(font) {
		let ctx = measureContexts.get(font);
		if (ctx == null) {
			ctx = new OffscreenCanvas(1, 1).getContext("2d");
			ctx.font = font;
			measureContexts.set(font, ctx);
		}
		return ctx;
	}
	function measureAxisLabels(axis, pxRatio) {
		let values = axis._values;
		let prev = axis._labelValues;
		if (!(values === prev || prev != null && values.length == prev.length && values.every((value, i) => value === prev[i]))) {
			let ctx = measureContext(axis.font[0]);
			axis._labelWidths = values.map((value) => {
				if (value == null) return 0;
				let text = "" + value;
				if (text.indexOf("\n") == -1) return ctx.measureText(text).width / pxRatio;
				let width = 0;
				for (let line of text.split("\n")) width = max(width, ctx.measureText(line).width);
				return width / pxRatio;
			});
		}
		axis._labelValues = values;
	}
	function rotationCos(rotate) {
		let value = cos(-rotate * PI / 180);
		return rotate % 90 == 0 ? round(value) : value;
	}
	function rotationSin(rotate) {
		let value = sin(-rotate * PI / 180);
		return rotate % 90 == 0 ? round(value) : value;
	}
	function labelHeight(axis, height) {
		let lines = -1;
		for (let value of axis._values) if (value != null) {
			if (axis.side == 0) return height;
			let text = "" + value;
			let count = 0;
			for (let pos = text.indexOf("\n"); pos != -1; pos = text.indexOf("\n", pos + 1)) count++;
			lines = max(lines, count);
		}
		return lines < 0 ? 0 : height + lines * height * axis.lineGap;
	}
	function autoAxisSize(self, values, axisIdx) {
		let { pxRatio } = self;
		let axis = self.axes[axisIdx];
		let rotate = axis._rotate || 0;
		let vertical = axis.side % 2 == 1;
		let height = axis.font[1] / pxRatio;
		let extent = 0;
		if (vertical || rotate != 0) {
			measureAxisLabels(axis, pxRatio);
			let { _labelValues, _labelWidths } = axis;
			let width = -1;
			for (let i = 0; i < _labelWidths.length; i++) if (_labelValues[i] != null) width = max(width, _labelWidths[i]);
			if (width >= 0) extent = vertical ? width : width * abs(rotationSin(rotate)) + height / 2 * rotationCos(rotate);
		} else extent = labelHeight(axis, height);
		return (axis.ticks.show ? axis.ticks.size : 0) + axis.gap + extent;
	}
	function axisOverflow(axis, scale, pxRatio, minWidth, leftBase, rightBase, padding) {
		let { _labelValues, _labelWidths, _splits } = axis;
		let rotate = axis._rotate || 0;
		let cos = rotationCos(rotate);
		let leftFactor = rotate == 0 ? .5 : rotate > 0 ? cos : 0;
		let rightFactor = rotate == 0 ? .5 : rotate < 0 ? cos : 0;
		let heightExtent = axis.font[1] / pxRatio / 2 * abs(rotationSin(rotate));
		for (let i = 0; i < _labelWidths.length; i++) {
			if (_labelValues[i] == null) continue;
			let fraction = minWidth > 0 ? scale.valToPct(_splits[i]) : 0;
			if (scale.dir == -1) fraction = 1 - fraction;
			let width = _labelWidths[i];
			padding[3] = max(padding[3], leftBase + width * leftFactor + heightExtent - fraction * minWidth);
			padding[1] = max(padding[1], rightBase + width * rightFactor + heightExtent - (1 - fraction) * minWidth);
		}
	}
	function autoPad(self, padding, leftSize, rightSize, leftMax, rightMax) {
		let { axes, scales, pxRatio, _padding } = self;
		let leftMin = padding[3];
		let rightMin = padding[1];
		let leftBase = leftMin - leftSize;
		let rightBase = rightMin - rightSize;
		for (let axis of axes) if (axis._show && axis.side % 2 == 0) {
			measureAxisLabels(axis, pxRatio);
			axisOverflow(axis, scales[axis.scale], pxRatio, 0, leftBase, rightBase, padding);
		}
		let minWidth = max(0, self.width - leftSize - rightSize - ceil(padding[3]) - ceil(padding[1]));
		padding[3] = leftMin;
		padding[1] = rightMin;
		for (let axis of axes) if (axis._show && axis.side % 2 == 0) axisOverflow(axis, scales[axis.scale], pxRatio, minWidth, leftBase, rightBase, padding);
		_padding[3] = clamp(ceil(padding[3]), leftMin, leftMax);
		_padding[1] = clamp(ceil(padding[1]), rightMin, rightMax);
	}
	function resolvePadding(self, leftSize, rightSize) {
		let { padding, _padding } = self;
		let left = padding[3];
		let right = padding[1];
		let leftMax = isArr(left) ? left[1] : _padding[3];
		let rightMax = isArr(right) ? right[1] : _padding[1];
		if (leftMax > _padding[3] || rightMax > _padding[1]) autoPad(self, _padding.slice(), leftSize, rightSize, leftMax, rightMax);
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
					s.plots = s.plots.filter((c) => c != plot);
				},
				pub(type, self, x, y, w, h, i) {
					for (let j = 0; j < s.plots.length; j++) s.plots[j] != self && s.plots[j].pub(type, self, x, y, w, h, i);
				}
			};
			if (key != null) syncs[key] = s;
		}
		return s;
	}
	function orient(u, seriesIdx, cb) {
		const mode = u.mode;
		const series = u.series[seriesIdx];
		const data = mode == 2 ? u._data[seriesIdx] : u._data;
		const scales = u.scales;
		const bbox = u.bbox;
		let dx = data[0], dy = mode == 2 ? data[1] : data[seriesIdx], sx = mode == 2 ? scales[series.facets[0].scale] : scales[u.series[0].scale], sy = mode == 2 ? scales[series.facets[1].scale] : scales[series.scale], l = bbox.left, t = bbox.top, w = bbox.width, h = bbox.height, H = u.valToPosH, V = u.valToPosV;
		return sx.ori == 0 ? cb(series, dx, dy, sx, sy, H, V, l, t, w, h, moveToH, lineToH, rectH, arcH, bezierCurveToH) : cb(series, dx, dy, sx, sy, V, H, t, l, h, w, moveToV, lineToV, rectV, arcV, bezierCurveToV);
	}
	function bandFillClipDirs(self, seriesIdx) {
		let fillDir = 0;
		let clipDirs = 0;
		let bands = self.bands ?? EMPTY_ARR;
		for (let i = 0; i < bands.length; i++) {
			let b = bands[i];
			if (b.series[0] == seriesIdx) fillDir = b.dir;
			else if (b.series[1] == seriesIdx) {
				if (b.dir == 1) clipDirs |= 1;
				else clipDirs |= 2;
			}
		}
		return [fillDir, clipDirs == 1 ? -1 : clipDirs == 2 ? 1 : clipDirs == 3 ? 2 : 0];
	}
	function seriesFillTo(self, seriesIdx, dataMin, dataMax, bandFillDir) {
		let mode = self.mode;
		let series = self.series[seriesIdx];
		let scaleKey = mode == 2 ? series.facets[1].scale : series.scale;
		let scale = self.scales[scaleKey];
		return bandFillDir == -1 ? scale.min : bandFillDir == 1 ? scale.max : scale.distr == 3 ? scale.dir == 1 ? scale.min : scale.max : 0;
	}
	function clipBandLine(self, seriesIdx, idx0, idx1, strokePath, clipDir) {
		return orient(self, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
			let pxRound = series.pxRound;
			const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
			const lineTo = scaleX.ori == 0 ? lineToH : lineToV;
			let frIdx, toIdx;
			if (dir == 1) {
				frIdx = idx0;
				toIdx = idx1;
			} else {
				frIdx = idx1;
				toIdx = idx0;
			}
			let x0 = pxRound(valToPosX(dataX[frIdx], scaleX, xDim, xOff));
			let y0 = pxRound(valToPosY(dataY[frIdx], scaleY, yDim, yOff));
			let x1 = pxRound(valToPosX(dataX[toIdx], scaleX, xDim, xOff));
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
			let maxStrokeWidth = 10;
			w > 0 && rect(clip, prevGapEnd, plotTop - maxStrokeWidth / 2, w, plotTop + plotHgt + maxStrokeWidth);
		}
		return clip;
	}
	function addGap(gaps, fromX, toX) {
		let prevGap = gaps[gaps.length - 1];
		if (prevGap && prevGap[0] == fromX) prevGap[1] = toX;
		else gaps.push([fromX, toX]);
	}
	function findGaps(xs, ys, idx0, idx1, dir, pixelForX, align) {
		let gaps = [];
		let len = xs.length;
		for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) if (ys[i] === null) {
			let fr = i, to = i;
			if (dir == 1) while (++i <= idx1 && ys[i] === null) to = i;
			else while (--i >= idx0 && ys[i] === null) to = i;
			let frPx = pixelForX(xs[fr]);
			let toPx = to == fr ? frPx : pixelForX(xs[to]);
			let fri2 = fr - dir;
			frPx = align <= 0 && fri2 >= 0 && fri2 < len ? pixelForX(xs[fri2]) : frPx;
			let toi2 = to + dir;
			toPx = align >= 0 && toi2 >= 0 && toi2 < len ? pixelForX(xs[toi2]) : toPx;
			if (toPx >= frPx) gaps.push([frPx, toPx]);
		}
		return gaps;
	}
	function pointPos(val, scale, dim, off, valToPos, pxRound) {
		return pxRound(valToPos(val, scale, dim, off));
	}
	function pxOffset(width, pxAlign) {
		let offset = width % 2 / 2;
		return pxAlign == 1 && offset > 0 ? offset : 0;
	}
	function pxRoundGen(pxAlign) {
		return pxAlign == 0 ? retArg0 : pxAlign == 1 ? round : (v) => incrRound(v, pxAlign);
	}
	function rect(ori) {
		let roundRect = ori == 0 ? (p, x, y, w, h, endRad, baseRad) => {
			p.roundRect(x, y, w, h, [
				endRad,
				endRad,
				baseRad,
				baseRad
			]);
		} : (p, x, y, w, h, endRad, baseRad) => {
			p.roundRect(y, x + w, h, -w, [
				endRad,
				baseRad,
				baseRad,
				endRad
			]);
		};
		let rect = ori == 0 ? (p, x, y, w, h) => {
			p.rect(x, y, w, h);
		} : (p, y, x, h, w) => {
			p.rect(x, y, w, h);
		};
		return (p, x, y, w, h, endRad = 0, baseRad = 0) => {
			if (endRad == 0 && baseRad == 0) rect(p, x, y, w, h);
			else {
				endRad = min(endRad, w / 2, h / 2);
				baseRad = min(baseRad, w / 2, h / 2);
				roundRect(p, x, y, w, h, endRad, baseRad);
			}
		};
	}
	const moveToH = (p, x, y) => {
		p.moveTo(x, y);
	};
	const moveToV = (p, y, x) => {
		p.moveTo(x, y);
	};
	const lineToH = (p, x, y) => {
		p.lineTo(x, y);
	};
	const lineToV = (p, y, x) => {
		p.lineTo(x, y);
	};
	const rectH = rect(0);
	const rectV = rect(1);
	const arcH = (p, x, y, r, startAngle, endAngle) => {
		p.arc(x, y, r, startAngle, endAngle);
	};
	const arcV = (p, y, x, r, startAngle, endAngle) => {
		p.arc(x, y, r, startAngle, endAngle);
	};
	const bezierCurveToH = (p, bp1x, bp1y, bp2x, bp2y, p2x, p2y) => {
		p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y);
	};
	const bezierCurveToV = (p, bp1y, bp1x, bp2y, bp2x, p2y, p2x) => {
		p.bezierCurveTo(bp1x, bp1y, bp2x, bp2y, p2x, p2y);
	};
	function arrayValue(values, i) {
		return values[i];
	}
	function discreteValue(values, i) {
		return values[0][values[1][i]];
	}
	function dispReader(kind) {
		return kind == 1 ? retArg0 : kind == 2 ? discreteValue : arrayValue;
	}
	function cacheDisp(u, seriesIdx, facet, prepare) {
		const cache = u.series[seriesIdx]._disp ??= /* @__PURE__ */ new WeakMap();
		let entry = cache.get(facet);
		if (entry == null) {
			const data = u.mode == 2 ? u.data[seriesIdx] : u.data;
			let value = facet.values(u, seriesIdx, 0, data[0].length - 1);
			if (prepare != null) value = prepare(value);
			entry = { value };
			cache.set(facet, entry);
		}
		return entry.value;
	}
	function unaryColor(color) {
		return [[color], 0];
	}
	function indexColors(colors) {
		const palette = [null];
		const indices = new Uint32Array(colors.length);
		const unique = /* @__PURE__ */ new Map();
		for (let i = 0; i < colors.length; i++) {
			const color = colors[i];
			if (color != null) {
				let idx = unique.get(color);
				if (idx == null) {
					idx = palette.length;
					unique.set(color, idx);
					palette.push(color);
				}
				indices[i] = idx;
			}
		}
		return [palette, indices];
	}
	function cacheColors(u, seriesIdx, facet) {
		return cacheDisp(u, seriesIdx, facet, facet.kind == 1 ? unaryColor : facet.kind == 2 ? null : indexColors);
	}
	function colorPaths(u, seriesIdx, disp, fillStyle, strokeStyle, stroke = true) {
		const fills = disp.fill == null ? null : cacheColors(u, seriesIdx, disp.fill);
		const strokes = disp.stroke == null || !stroke && fills != null ? null : cacheColors(u, seriesIdx, disp.stroke);
		const fillIndex = dispReader(disp.fill?.kind == 1 ? 1 : 3);
		const strokeIndex = dispReader(disp.stroke?.kind == 1 ? 1 : 3);
		const primary = fills ?? strokes;
		const index = fills == null ? strokeIndex : fillIndex;
		const groups = /* @__PURE__ */ new Map();
		primary?.[0].forEach((color) => groups.set(color ?? null, null));
		return {
			groups,
			path(i) {
				const color = primary == null ? fillStyle : primary[0][index(primary[1], i)];
				const key = color ?? null;
				let group = groups.get(key);
				if (group == null) {
					const fill = fills == null ? fillStyle : color;
					const strokeColor = !stroke ? null : strokes == null ? strokeStyle : fills == null ? color : strokes[0][strokeIndex(strokes[1], i)];
					group = {
						fill,
						stroke: strokeColor,
						path: fill == null && strokeColor == null ? null : new Path2D()
					};
					groups.set(key, group);
				}
				return group.path;
			}
		};
	}
	function paintPaths(groups, channel) {
		const paths = /* @__PURE__ */ new Map();
		groups.forEach((group) => {
			if (group != null && group.path != null && group[channel] != null) {
				const color = group[channel];
				const prev = paths.get(color);
				if (prev == null) paths.set(color, group.path);
				else if (Array.isArray(prev)) prev.push(group.path);
				else paths.set(color, [prev, group.path]);
			}
		});
		return paths;
	}
	function circle(path, x, y, rad) {
		path.moveTo(x + rad, y);
		path.arc(x, y, rad, 0, PI * 2);
	}
	function square(path, x, y, rad) {
		path.rect(x - rad, y - rad, rad * 2, rad * 2);
	}
	function points(opts) {
		opts = opts || EMPTY_OBJ;
		const disp = opts.disp;
		const batch = opts.batch ?? disp == null;
		const singlePath = batch && disp == null;
		const each = opts.each;
		return (u, seriesIdx, idx0, idx1, filtIdxs) => {
			let { pxRatio } = u;
			return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
				let { pxRound, points } = series;
				const horizontal = scaleX.ori == 0;
				const drawShape = points.shape == 2 ? square : circle;
				const width = roundDec(points.width * pxRatio, 3);
				const sizes = disp?.size == null ? null : cacheDisp(u, seriesIdx, disp.size);
				const fills = batch || disp?.fill == null ? null : cacheColors(u, seriesIdx, disp.fill);
				const strokes = batch || width <= 0 || disp?.stroke == null ? null : cacheColors(u, seriesIdx, disp.stroke);
				const sizeValue = dispReader(disp?.size?.kind);
				const fillIndex = dispReader(disp?.fill?.kind == 1 ? 1 : 3);
				const strokeIndex = dispReader(disp?.stroke?.kind == 1 ? 1 : 3);
				const sizeScale = disp?.size?.scale == null ? null : u.scales[disp.size.scale];
				const sizeRange = sizeScale == null ? null : disp.size.range;
				if (sizeScale != null && (sizeScale.min == null || sizeScale.max == null)) return null;
				const sizeSpan = sizeRange == null ? 0 : sizeRange[1] - sizeRange[0];
				const cullPad = sizeRange == null ? 0 : sizeRange[1] * pxRatio / 2;
				let rad = (points.size - points.width) / 2 * pxRatio;
				const clipPad = sizes != null ? 0 : disp == null ? roundDec(rad * 2, 3) : points.size * pxRatio / 2;
				let fill = singlePath ? new Path2D() : null;
				let clip = new Path2D();
				let { left: lft, top, width: wid, height: hgt } = u.bbox;
				rectH(clip, lft - clipPad, top - clipPad, wid + clipPad * 2, hgt + clipPad * 2);
				const ctx = u.ctx;
				const offset = pxOffset(width, points.pxAlign);
				const xMin = xOff - cullPad - offset;
				const xMax = xOff + xDim + cullPad - offset;
				const yMin = yOff - cullPad - offset;
				const yMax = yOff + yDim + cullPad - offset;
				const strokeStyle = points._stroke;
				const fillStyle = points._fill ?? (width > 0 ? "#fff" : strokeStyle);
				const colors = !singlePath && batch ? colorPaths(u, seriesIdx, disp, fillStyle, strokeStyle, width > 0) : null;
				if (!singlePath) {
					ctx.save();
					if (sizes != null) ctx.clip(clip);
					ctx.translate(offset, offset);
					if (sizes == null) ctx.clip(clip);
					if (width > 0) ctx.lineWidth = width;
					ctx.lineCap = points.cap ?? "butt";
					ctx.lineJoin = "round";
					ctx.setLineDash(points.dash ?? EMPTY_ARR);
				}
				const drawPoint = (pi) => {
					const xVal = dataX[pi];
					const yVal = dataY[pi];
					if (xVal == null || yVal == null || sizeRange == null && (xVal < scaleX.min || xVal > scaleX.max || yVal < scaleY.min || yVal > scaleY.max)) return;
					let x = pointPos(xVal, scaleX, xDim, xOff, valToPosX, pxRound);
					let y = pointPos(yVal, scaleY, yDim, yOff, valToPosY, pxRound);
					if (sizeRange != null && (x < xMin || x > xMax || y < yMin || y > yMax)) return;
					if (sizes != null) {
						let size = sizeValue(sizes, pi);
						if (sizeScale != null) {
							const pct = Math.max(0, Math.min(1, sizeScale.valToPct(size)));
							size = sizeRange[0] + pct * sizeSpan;
						}
						if (size <= points.width) return;
						rad = (size - points.width) / 2 * pxRatio;
					}
					const cx = horizontal ? x : y;
					const cy = horizontal ? y : x;
					if (colors != null) {
						const path = colors.path(pi);
						if (path == null) return;
						drawShape(path, cx, cy, rad);
					} else if (!singlePath) {
						const colorFill = fills == null ? fillStyle : fills[0][fillIndex(fills[1], pi)];
						const colorStroke = strokes == null ? strokeStyle : strokes[0][strokeIndex(strokes[1], pi)];
						if (colorFill == null && (width <= 0 || colorStroke == null)) return;
						ctx.beginPath();
						drawShape(ctx, cx, cy, rad);
						if (colorFill != null) {
							ctx.fillStyle = colorFill;
							ctx.fill();
						}
						if (width > 0 && colorStroke != null) {
							ctx.strokeStyle = colorStroke;
							ctx.stroke();
						}
					} else drawShape(fill, cx, cy, rad);
					if (each != null) {
						const outer = rad + width / 2;
						each(u, seriesIdx, pi, cx + offset - outer, cy + offset - outer, outer * 2, outer * 2);
					}
				};
				if (filtIdxs) filtIdxs.forEach(drawPoint);
				else for (let pi = idx0; pi <= idx1; pi++) drawPoint(pi);
				if (!singlePath) {
					if (colors != null) {
						colors.groups.forEach((group) => {
							if (group?.fill != null) {
								ctx.fillStyle = group.fill;
								ctx.fill(group.path);
							}
						});
						colors.groups.forEach((group) => {
							if (group?.stroke != null) {
								ctx.strokeStyle = group.stroke;
								ctx.stroke(group.path);
							}
						});
					}
					ctx.restore();
					return null;
				}
				return {
					stroke: width > 0 ? fill : null,
					fill,
					clip,
					flags: 3
				};
			});
		};
	}
	function _drawAcc(lineTo) {
		return (stroke, accX, minY, maxY, inY, outY) => {
			if (minY != maxY) {
				if (inY != minY && outY != minY) lineTo(stroke, accX, minY);
				if (inY != maxY && outY != maxY) lineTo(stroke, accX, maxY);
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
				if (idx0 == -1) return null;
				let pxRound = series.pxRound;
				let alignGaps = opts?.alignGaps ?? series.alignGaps ?? 0;
				let pixelForX = (val) => pxRound(valToPosX(val, scaleX, xDim, xOff));
				let pixelForY = (val) => pxRound(valToPosY(val, scaleY, yDim, yOff));
				let lineTo, drawAcc;
				if (scaleX.ori == 0) {
					lineTo = lineToH;
					drawAcc = drawAccH;
				} else {
					lineTo = lineToV;
					drawAcc = drawAccV;
				}
				const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
				const _paths = {
					stroke: new Path2D(),
					fill: null,
					clip: null,
					band: null,
					gaps: null,
					flags: 1
				};
				const stroke = _paths.stroke;
				let hasGap = false;
				if (idx1 - idx0 >= xDim * 4) {
					let xForPixel = (pos) => u.posToVal(pos, scaleX.key, true);
					let minY = null, maxY = null, inY, outY, drawnAtX;
					let accX = pixelForX(dataX[dir == 1 ? idx0 : idx1]);
					let idx0px = pixelForX(dataX[idx0]);
					let idx1px = pixelForX(dataX[idx1]);
					let nextAccXVal = xForPixel(dir == 1 ? idx0px + 1 : idx1px - 1);
					for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
						let xVal = dataX[i];
						let x = (dir == 1 ? xVal < nextAccXVal : xVal > nextAccXVal) ? accX : pixelForX(xVal);
						let yVal = dataY[i];
						if (x == accX) {
							if (yVal != null) {
								outY = yVal;
								if (minY == null) {
									lineTo(stroke, x, pixelForY(outY));
									inY = minY = maxY = outY;
								} else if (outY < minY) minY = outY;
								else if (outY > maxY) maxY = outY;
							} else if (yVal === null) hasGap = true;
						} else {
							if (minY != null) drawAcc(stroke, accX, pixelForY(minY), pixelForY(maxY), pixelForY(inY), pixelForY(outY));
							if (yVal != null) {
								outY = yVal;
								lineTo(stroke, x, pixelForY(outY));
								minY = maxY = inY = outY;
							} else {
								minY = maxY = null;
								if (yVal === null) hasGap = true;
							}
							accX = x;
							nextAccXVal = xForPixel(accX + dir);
						}
					}
					if (minY != null && minY != maxY && drawnAtX != accX) drawAcc(stroke, accX, pixelForY(minY), pixelForY(maxY), pixelForY(inY), pixelForY(outY));
				} else for (let i = dir == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += dir) {
					let yVal = dataY[i];
					if (yVal === null) hasGap = true;
					else if (yVal != null) lineTo(stroke, pixelForX(dataX[i]), pixelForY(yVal));
				}
				let [bandFillDir, bandClipDir] = bandFillClipDirs(u, seriesIdx);
				if (series.fill != null || bandFillDir != 0) {
					let fill = _paths.fill = new Path2D(stroke);
					let fillToY = pixelForY(series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir));
					let frX = pixelForX(dataX[idx0]);
					let toX = pixelForX(dataX[idx1]);
					if (dir == -1) [toX, frX] = [frX, toX];
					lineTo(fill, toX, fillToY);
					lineTo(fill, frX, fillToY);
				}
				if (!series.spanGaps) {
					let gaps = hasGap ? findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps) : [];
					_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);
					_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
				}
				if (bandClipDir != 0) _paths.band = bandClipDir == 2 ? [clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1), clipBandLine(u, seriesIdx, idx0, idx1, stroke, 1)] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
				return _paths;
			});
		};
	}
	function stepped(opts) {
		const align = opts.align ?? 1;
		const ascDesc = opts.ascDesc ?? false;
		const extend = opts.extend ?? false;
		return (u, seriesIdx, idx0, idx1) => {
			let { pxRatio } = u;
			return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
				[idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);
				if (idx0 == -1) return null;
				let pxRound = series.pxRound;
				let alignGaps = opts?.alignGaps ?? series.alignGaps ?? 0;
				let { left, width } = u.bbox;
				let pixelForX = (val) => pxRound(valToPosX(val, scaleX, xDim, xOff));
				let pixelForY = (val) => pxRound(valToPosY(val, scaleY, yDim, yOff));
				let lineTo = scaleX.ori == 0 ? lineToH : lineToV;
				const _paths = {
					stroke: new Path2D(),
					fill: null,
					clip: null,
					band: null,
					gaps: null,
					flags: 1
				};
				const stroke = _paths.stroke;
				const dir = scaleX.dir * (scaleX.ori == 0 ? 1 : -1);
				let hasGap = false;
				let prevYPos = pixelForY(dataY[dir == 1 ? idx0 : idx1]);
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
						if (yVal1 === null) hasGap = true;
						continue;
					}
					let x1 = pixelForX(dataX[i]);
					let y1 = pixelForY(yVal1);
					if (align == 1) lineTo(stroke, x1, prevYPos);
					else lineTo(stroke, prevXPos, y1);
					lineTo(stroke, x1, y1);
					prevYPos = y1;
					prevXPos = x1;
				}
				let prevXPosExt = prevXPos;
				if (extend && align == 1) {
					prevXPosExt = left + width;
					lineTo(stroke, prevXPosExt, prevYPos);
				}
				let [bandFillDir, bandClipDir] = bandFillClipDirs(u, seriesIdx);
				if (series.fill != null || bandFillDir != 0) {
					let fill = _paths.fill = new Path2D(stroke);
					let fillToY = pixelForY(series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir));
					lineTo(fill, prevXPosExt, fillToY);
					lineTo(fill, firstXPosExt, fillToY);
				}
				if (!series.spanGaps) {
					let gaps = hasGap ? findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps) : [];
					let halfStroke = series.width * pxRatio / 2;
					let startsOffset = ascDesc || align == 1 ? halfStroke : -halfStroke;
					let endsOffset = ascDesc || align == -1 ? -halfStroke : halfStroke;
					gaps.forEach((g) => {
						g[0] += startsOffset;
						g[1] += endsOffset;
					});
					_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);
					_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
				}
				if (bandClipDir != 0) _paths.band = bandClipDir == 2 ? [clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1), clipBandLine(u, seriesIdx, idx0, idx1, stroke, 1)] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
				return _paths;
			});
		};
	}
	function percentToPos(pct, scale, dim, off) {
		return off + pct * dim;
	}
	function findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid = inf, xValue = dispReader()) {
		if (dataY.length > 1) {
			let prevIdx = null;
			for (let i = 0, minDelta = Infinity; i < dataY.length; i++) if (dataY[i] !== void 0) {
				if (prevIdx != null) {
					let delta = abs(xValue(dataX, i) - xValue(dataX, prevIdx));
					if (delta < minDelta) {
						minDelta = delta;
						colWid = abs(valToPosX(xValue(dataX, i), scaleX, xDim, xOff) - valToPosX(xValue(dataX, prevIdx), scaleX, xDim, xOff));
					}
				}
				prevIdx = i;
			}
		}
		return colWid;
	}
	function bars(opts) {
		opts = opts || EMPTY_OBJ;
		const size = opts.size ?? [
			.6,
			Infinity,
			1
		];
		const align = opts.align || 0;
		const gap = opts.gap ?? 0;
		const [gapLead, gapTrail] = typeof gap == "number" ? [0, gap] : gap;
		const _extraGap = gapLead + gapTrail;
		let ro = opts.radius;
		ro = ro == null ? [0, 0] : typeof ro == "number" ? [ro, 0] : ro;
		const radiusFn = fnOrSelf(ro);
		const gapFactor = 1 - size[0];
		const _maxWidth = size[1] ?? Infinity;
		const _minWidth = size[2] ?? 1;
		const disp = opts.disp ?? EMPTY_OBJ;
		const _each = opts.each ?? ((_) => {});
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
				let band = dataY0 == null ? (u.bands ?? EMPTY_ARR).find((b) => b.series[0] == seriesIdx) : null;
				let fillDir = band != null ? band.dir : 0;
				let fillTo = dataY0 == null ? series.fillTo(u, seriesIdx, series.min, series.max, fillDir) : 0;
				let fillToY = pxRound(valToPosY(fillTo, scaleY, yDim, yOff));
				let xShift, barWid, fullGap, colWid = xDim;
				let strokeWidth = pxRound(series.width * pxRatio);
				let { x0, size } = disp;
				let xToPos = valToPosX;
				let xValue = dispReader();
				if (x0 != null && size != null) {
					_align = 1;
					dataX = x0.values(u, seriesIdx, idx0, idx1);
					xValue = dispReader(x0.kind);
					if (x0.unit == 2) xToPos = percentToPos;
					let width = size.values(u, seriesIdx, idx0, idx1);
					if (size.unit == 2) barWid = width * xDim;
					else barWid = valToPosX(width, scaleX, xDim, xOff) - valToPosX(0, scaleX, xDim, xOff);
					colWid = findColWidth(dataX, dataY, xToPos, scaleX, xDim, xOff, colWid, xValue);
					fullGap = colWid - barWid + extraGap;
				} else {
					colWid = findColWidth(dataX, dataY, valToPosX, scaleX, xDim, xOff, colWid);
					fullGap = colWid * gapFactor + extraGap;
					barWid = colWid - fullGap;
				}
				if (fullGap < 1) fullGap = 0;
				if (strokeWidth >= barWid / 2) strokeWidth = 0;
				if (fullGap < 5) pxRound = retArg0;
				let insetStroke = fullGap > 0;
				let rawBarWid = colWid - fullGap - (insetStroke ? strokeWidth : 0);
				barWid = pxRound(clamp(rawBarWid, minWidth, maxWidth));
				xShift = (_align == 0 ? barWid / 2 : _align == _dirX ? 0 : barWid) - _align * _dirX * (insetStroke ? gapLead * pxRatio + strokeWidth / 2 : 0);
				const _paths = {
					stroke: null,
					fill: null,
					clip: null,
					band: null,
					gaps: null,
					flags: 0
				};
				const colors = dispFills != null || dispStrokes != null ? colorPaths(u, seriesIdx, disp, series._fill, series._stroke, strokeWidth > 0) : null;
				const stroke = colors == null ? new Path2D() : null;
				let yValue = dispReader();
				let y0Value = dispReader();
				let hasY0 = dataY0 != null || band?.series[1] != null;
				if (band != null) {
					if (hasY0) dataY0 = u._data[band.series[1]];
				} else if (dataY0 == null) {
					let { y0, y1 } = disp;
					if (y0 != null && y1 != null) {
						dataY = y1.values(u, seriesIdx, idx0, idx1);
						dataY0 = y0.values(u, seriesIdx, idx0, idx1);
						yValue = dispReader(y1.kind);
						y0Value = dispReader(y0.kind);
						hasY0 = true;
					}
				}
				let radVal = valRadius * barWid;
				let radBase = baseRadius * barWid;
				for (let i = _dirX == 1 ? idx0 : idx1; i >= idx0 && i <= idx1; i += _dirX) {
					let yVal = yValue(dataY, i);
					if (yVal == null) continue;
					if (hasY0) {
						let yVal0 = y0Value(dataY0, i) ?? 0;
						if (yVal - yVal0 == 0) continue;
						fillToY = valToPosY(yVal0, scaleY, yDim, yOff);
					}
					let xVal = xValue(dataX, i);
					let xPos = xToPos(xVal, scaleX, xDim, xOff);
					let yPos = valToPosY(yVal, scaleY, yDim, yOff);
					let lft = pxRound(xPos - xShift);
					let btm = pxRound(max(yPos, fillToY));
					let top = pxRound(min(yPos, fillToY));
					let barHgt = btm - top;
					if (yVal != fillTo) {
						let rv = yPos < fillToY ? radVal : radBase;
						let rb = yPos < fillToY ? radBase : radVal;
						const path = colors == null ? stroke : colors.path(i);
						if (path != null) rect(path, lft, top + floor(strokeWidth / 2), barWid, max(0, barHgt - strokeWidth), rv, rb);
						each(u, seriesIdx, i, lft - strokeWidth / 2, top, barWid + strokeWidth, barHgt);
					}
				}
				if (strokeWidth > 0) _paths.stroke = colors == null ? stroke : paintPaths(colors.groups, "stroke");
				else if (colors == null) {
					_paths._fill = series.width == 0 ? series._fill : series._stroke ?? series._fill;
					_paths.width = 0;
				}
				_paths.fill = colors == null ? stroke : paintPaths(colors.groups, "fill");
				return _paths;
			});
		};
	}
	function splineInterp(interp, opts) {
		return (u, seriesIdx, idx0, idx1) => {
			return orient(u, seriesIdx, (series, dataX, dataY, scaleX, scaleY, valToPosX, valToPosY, xOff, yOff, xDim, yDim) => {
				[idx0, idx1] = nonNullIdxs(dataY, idx0, idx1);
				if (idx0 == -1) return null;
				let pxRound = series.pxRound;
				let alignGaps = opts?.alignGaps ?? series.alignGaps ?? 0;
				let pixelForX = (val) => pxRound(valToPosX(val, scaleX, xDim, xOff));
				let pixelForY = (val) => pxRound(valToPosY(val, scaleY, yDim, yOff));
				let moveTo, bezierCurveTo, lineTo;
				if (scaleX.ori == 0) {
					moveTo = moveToH;
					lineTo = lineToH;
					bezierCurveTo = bezierCurveToH;
				} else {
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
					} else if (yVal === null) hasGap = true;
				}
				const _paths = {
					stroke: interp(xCoords, yCoords, moveTo, lineTo, bezierCurveTo, pxRound),
					fill: null,
					clip: null,
					band: null,
					gaps: null,
					flags: 1
				};
				const stroke = _paths.stroke;
				let [bandFillDir, bandClipDir] = bandFillClipDirs(u, seriesIdx);
				if (series.fill != null || bandFillDir != 0) {
					let fill = _paths.fill = new Path2D(stroke);
					let fillToY = pixelForY(series.fillTo(u, seriesIdx, series.min, series.max, bandFillDir));
					lineTo(fill, prevXPos, fillToY);
					lineTo(fill, firstXPos, fillToY);
				}
				if (!series.spanGaps) {
					let gaps = hasGap ? findGaps(dataX, dataY, idx0, idx1, dir, pixelForX, alignGaps) : [];
					_paths.gaps = gaps = series.gaps(u, seriesIdx, idx0, idx1, gaps);
					_paths.clip = clipGaps(gaps, scaleX.ori, xOff, yOff, xDim, yDim);
				}
				if (bandClipDir != 0) _paths.band = bandClipDir == 2 ? [clipBandLine(u, seriesIdx, idx0, idx1, stroke, -1), clipBandLine(u, seriesIdx, idx0, idx1, stroke, 1)] : clipBandLine(u, seriesIdx, idx0, idx1, stroke, bandClipDir);
				return _paths;
			});
		};
	}
	function monotoneCubic(opts) {
		return splineInterp(_monotoneCubic, opts);
	}
	function _monotoneCubic(xs, ys, moveTo, lineTo, bezierCurveTo, pxRound) {
		const n = xs.length;
		if (n < 2) return null;
		const path = new Path2D();
		moveTo(path, xs[0], ys[0]);
		if (n == 2) lineTo(path, xs[1], ys[1]);
		else {
			let ms = Array(n), ds = Array(n - 1), dys = Array(n - 1), dxs = Array(n - 1);
			for (let i = 0; i < n - 1; i++) {
				dys[i] = ys[i + 1] - ys[i];
				dxs[i] = xs[i + 1] - xs[i];
				ds[i] = dys[i] / dxs[i];
			}
			ms[0] = ds[0];
			for (let i = 1; i < n - 1; i++) if (ds[i] === 0 || ds[i - 1] === 0 || ds[i - 1] > 0 !== ds[i] > 0) ms[i] = 0;
			else {
				ms[i] = 3 * (dxs[i - 1] + dxs[i]) / ((2 * dxs[i] + dxs[i - 1]) / ds[i - 1] + (dxs[i] + 2 * dxs[i - 1]) / ds[i]);
				if (!isFinite(ms[i])) ms[i] = 0;
			}
			ms[n - 1] = ds[n - 2];
			for (let i = 0; i < n - 1; i++) bezierCurveTo(path, xs[i] + dxs[i] / 3, ys[i] + ms[i] * dxs[i] / 3, xs[i + 1] - dxs[i] / 3, ys[i + 1] - ms[i + 1] * dxs[i] / 3, xs[i + 1], ys[i + 1]);
		}
		return path;
	}
	const cursorPlots = /* @__PURE__ */ new Set();
	let mouseOwner = null;
	function invalidateRects() {
		for (let u of cursorPlots) u.syncRect(true);
	}
	if (domEnv) {
		on(resize, win, invalidateRects);
		on(scroll, win, invalidateRects, true);
		on(dppxchange, win, () => {
			uPlot.pxRatio = pxRatio;
		});
	}
	const linearPath = linear();
	const pointsPath = points();
	function setDefaults(d, xo, yo, initY) {
		return (initY ? [d[0], d[1]].concat(d.slice(2)) : [d[0]].concat(d.slice(1))).map((o, i) => setDefault(o, i, xo, yo));
	}
	function setDefaults2(d, xyo) {
		return d.map((o, i) => i == 0 ? {} : assign({}, xyo, o));
	}
	function setDefault(o, i, xo, yo) {
		return assign({}, i == 0 ? xo : yo, o);
	}
	function snapNumX(self, dataMin, dataMax, scaleKey) {
		if (dataMin == null) return nullNullTuple;
		if (dataMin == dataMax) return self.scales[scaleKey].distr == 2 ? [dataMin, dataMax + 1] : rangeNum(dataMin, dataMax, rangePad, true);
		return [dataMin, dataMax];
	}
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
	function findIncr(minVal, maxVal, incrs, dim, minSpace) {
		let minIncr = max(abs(minVal), abs(maxVal)) * (Number.EPSILON / 2);
		let delta = maxVal - minVal;
		let incrIdx = closestIdx(minSpace / dim * delta, incrs);
		do {
			let foundIncr = incrs[incrIdx];
			let foundSpace = dim * foundIncr / delta;
			if (foundSpace >= minSpace && foundIncr > minIncr) return [foundIncr, foundSpace];
		} while (++incrIdx < incrs.length);
		return [0, 0];
	}
	function pxRatioFont(font, pxRatio) {
		let fontSize, fontSizeCss;
		font = font.replace(/(\d+)px/, (m, p1) => (fontSize = round((fontSizeCss = +p1) * pxRatio)) + "px");
		return [
			font,
			fontSize,
			fontSizeCss
		];
	}
	function syncFontSize(axis, pxRatio) {
		if (axis.show) [axis.font, axis.labelFont].forEach((f) => {
			let size = roundDec(f[2] * pxRatio, 1);
			f[0] = f[0].replace(/[0-9.]+px/, size + "px");
			f[1] = size;
		});
	}
	function scanScaleInternal(self, scaleKey, i0, i1, cache, allValues) {
		let data = self._data;
		let series = self.series;
		let scale = self.scales[scaleKey];
		if (data == null || scale == null) return nullNullTuple;
		let scaleMin = inf;
		let scaleMax = -Infinity;
		let log = !allValues && scale.distr == 3;
		let asinh = scale.distr == 4;
		let minAbs = inf;
		function acc(si, data, facet, sorted, mirror) {
			if (data != null && data.length > 0) {
				let facetMin = facet.min;
				let facetMax = facet.max;
				let facetMinAbs = facet.minAbs;
				let scanAbs = asinh && (!cache || facetMinAbs === void 0);
				if (!cache || si == 0 || (asinh ? scanAbs : facetMin == null)) {
					facetMin = facetMax = null;
					let _i0 = max(0, ceil(i0 ?? 0));
					let _i1 = min(data.length - 1, floor(i1 ?? data.length - 1));
					if (scanAbs) [facetMin, facetMax, facetMinAbs] = getMinMaxAsinh(data, _i0, _i1, sorted, scale._minAbs);
					else if (_i0 <= _i1) [facetMin, facetMax] = getMinMax(data, _i0, _i1, sorted, log);
					if (facetMinAbs == Infinity) facetMinAbs = null;
					if (facetMin > facetMax) facetMin = facetMax = null;
					if (cache) {
						facet.min = facetMin;
						facet.max = facetMax;
						if (asinh) facet.minAbs = facetMinAbs;
					}
				}
				if (cache && mirror) {
					series[si].min = facetMin;
					series[si].max = facetMax;
					if (asinh) series[si].minAbs = facetMinAbs;
				}
				if (facetMin != null) scaleMin = min(scaleMin, facetMin);
				if (facetMax != null) scaleMax = max(scaleMax, facetMax);
				if (asinh && facetMinAbs != null) minAbs = min(minAbs, facetMinAbs);
			}
		}
		if (self.mode == 1) {
			if (series[0].scale == scaleKey) acc(0, data[0], series[0], series[0].sorted, false);
			else for (let i = 1; i < series.length; i++) {
				let s = series[i];
				if (s.show && s.scan && s.scale == scaleKey) acc(i, data[i], s, s.sorted, false);
			}
		} else for (let i = 1; i < series.length; i++) {
			let s = series[i];
			if (s.show && s.scan) for (let fi = 0; fi < s.facets.length; fi++) {
				let facet = s.facets[fi];
				if (facet.scan && facet.scale == scaleKey) acc(i, data[i][fi], facet, facet.sorted, fi == 1);
			}
		}
		let result = [scaleMin == Infinity ? null : scaleMin, scaleMax == -Infinity ? null : scaleMax];
		if (asinh) result.push(minAbs == Infinity ? null : minAbs);
		return result;
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
	function asinhScale(self, scaleKey) {
		if (self.scales[scaleKey].scan == scanNone) return 1;
		let idxs = self.mode == 1 && self.series[0].scale != scaleKey ? self.series[0].idxs : EMPTY_ARR;
		return scanCached(self, scaleKey, idxs[0], idxs[1])[2] ?? 1;
	}
	function scanNone() {
		return nullNullTuple;
	}
	function scanAuto(self, scaleKey, i0, i1, viaAutoScaleX) {
		return self.scales[scaleKey].auto(self, viaAutoScaleX) ? scanCached(self, scaleKey, i0, i1) : scanNone(self);
	}
	function uPlot(opts, data, then) {
		const self = {
			uid: rand().toString(36).slice(-6),
			status: 0
		};
		opts = copy(opts);
		(opts.plugins || []).forEach((p) => {
			if (p.opts) opts = p.opts(self, opts) || opts;
		});
		let pxRatio$1 = self.pxRatio = opts.pxRatio ?? pxRatio;
		const mode = self.mode = opts.mode ?? 1;
		function setPxRatio(_pxRatio) {
			_pxRatio ??= pxRatio;
			if (_pxRatio != self.pxRatio) {
				self.pxRatio = _pxRatio;
				shouldSetCanvas = shouldLayout = true;
				commit();
			}
		}
		self.setPxRatio = setPxRatio;
		function getHPos(val, scale, dim, off) {
			let pct = scale.valToPct(val);
			return off + dim * (scale.dir == -1 ? 1 - pct : pct);
		}
		function getVPos(val, scale, dim, off) {
			let pct = scale.valToPct(val);
			return off + dim * (scale.dir == -1 ? pct : 1 - pct);
		}
		function getPos(val, scale, dim, off) {
			return scale.ori == 0 ? getHPos(val, scale, dim, off) : getVPos(val, scale, dim, off);
		}
		self.valToPosH = getHPos;
		self.valToPosV = getVPos;
		let ready = false;
		const can = placeTag("canvas");
		const ctx = self.ctx = can.getContext("2d", opts.ctxAttrs);
		const domRoot = opts.dom?.uplot !== false;
		const root = self.root = domRoot ? placeTag("div") : can;
		if (opts.id != null) root.id = opts.id;
		addClass(root, UPLOT);
		addClass(root, opts.class);
		if (domRoot && opts.title) {
			let title = placeDiv(TITLE, root);
			title.textContent = opts.title;
		}
		const hasLegend = opts.legend?.show ?? legendOpts.show;
		const wrap = domRoot && (opts.title || hasLegend) ? placeDiv(WRAP, root) : root;
		if (domRoot && wrap == root) addClass(wrap, WRAP);
		const under = self.under = domRoot && opts.dom?.under !== false ? placeDiv(UNDER, wrap) : null;
		if (domRoot) wrap.appendChild(can);
		const over = self.over = domRoot && opts.dom?.over !== false ? placeDiv(OVER, wrap) : null;
		const usePathCache = opts.cache?.paths ?? true;
		const useDataCache = opts.cache?.data ?? true;
		const pxAlign = +(opts.pxAlign ?? 1);
		const pxRound = pxRoundGen(pxAlign);
		const ms = opts.ms || .001;
		function snapTimeX(self, dataMin, dataMax, scaleKey) {
			if (dataMin == null) return nullNullTuple;
			if (dataMin == dataMax) {
				let sc = self.scales[scaleKey];
				return sc.distr == 2 ? [dataMin, dataMax + 1] : sc.distr == 3 ? rangeLog(dataMin, dataMax, sc.log, false) : sc.distr == 4 ? rangeAsinh(dataMin, dataMax, sc.log, false) : [dataMin, dataMax + round(86400 / ms)];
			}
			return [dataMin, dataMax];
		}
		const series = self.series = mode == 1 ? setDefaults(opts.series || [], xSeriesOpts, ySeriesOpts, false) : setDefaults2(opts.series || [null], xySeriesOpts);
		const axes = self.axes = setDefaults(opts.axes || [], xAxisOpts, yAxisOpts, true);
		const scales = self.scales = {};
		const stackGroups = mode == 1 ? opts.stack?.groups || EMPTY_ARR : EMPTY_ARR;
		const stackPercent = mode == 1 && opts.stack?.percent === true;
		const bands = self.bands = stackGroups.length == 0 ? opts.bands || [] : [];
		function initBand(b) {
			b.fill = fnOrSelf(b.fill || null);
			b.dir = b.dir ?? -1;
		}
		bands.forEach(initBand);
		const stackedSeries = [];
		stackGroups.forEach((group) => {
			group.series.forEach((si) => {
				stackedSeries[si] = true;
			});
		});
		const xScaleKey = mode == 2 ? series[1].facets[0].scale : series[0].scale;
		const drawOrderMap = {
			axes: drawAxesGrid,
			series: drawSeries
		};
		const drawOrder = (opts.drawOrder || ["axes", "series"]).map((key) => drawOrderMap[key]);
		function initValToPct(sc) {
			const getVal = sc.distr == 3 ? (val) => log10(val > 0 ? val : sc.clamp(self, val, sc.min, sc.max, sc.key)) : sc.distr == 4 ? (val) => asinh(val, sc._asinh) : sc.distr == 100 ? (val) => sc.fwd(val) : (val) => val;
			return (val) => {
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
					initScale(scaleOpts.from);
					sc = assign({}, scales[scaleOpts.from], scaleOpts, { key: scaleKey });
					sc.valToPct = initValToPct(sc);
					scales[scaleKey] = sc;
				} else {
					sc = scales[scaleKey] = assign({}, scaleKey == xScaleKey ? xScaleOpts : yScaleOpts, scaleOpts);
					sc.key = scaleKey;
					let isTime = sc.time;
					let rn = sc.range;
					let rangeYPolicy = rn == null ? rangeYAuto : null;
					let rangeIsArr = isArr(rn);
					if (scaleKey != xScaleKey || mode == 2 && !isTime) {
						if (rangeIsArr && (rn[0] == null || rn[1] == null)) {
							let partial = rn;
							let min = partial[0] == null ? autoRangePart : {
								hard: partial[0],
								soft: partial[0]
							};
							let max = partial[1] == null ? autoRangePart : {
								hard: partial[1],
								soft: partial[1]
							};
							rangeYPolicy = {
								zeroIf: rangeYAuto.zeroIf,
								min: partial[0] == null ? rangeYAuto.min : min,
								max: partial[1] == null ? rangeYAuto.max : max
							};
							rn = {
								min,
								max
							};
							rangeIsArr = false;
						}
						if (!rangeIsArr && isObj(rn)) {
							let cfg = rn;
							if (rangeYPolicy == null && cfg.flat == null) rangeYPolicy = cfg;
							rn = (self, dataMin, dataMax) => dataMin == null ? nullNullTuple : rangeNum(dataMin, dataMax, cfg);
						}
					}
					sc.range = fnOrSelf(rn || (isTime ? snapTimeX : scaleKey == xScaleKey ? sc.distr == 3 ? snapLogX : sc.distr == 4 ? snapAsinhX : snapNumX : sc.distr == 3 ? snapLogY : sc.distr == 4 ? snapAsinhY : snapNumY));
					if (scaleOpts.asinh == null && (rangeIsArr || sc.auto === false)) sc.asinh = 1;
					sc.auto = fnOrSelf(sc.auto);
					sc._policyY = rangeYPolicy;
					sc.scan ??= rangeIsArr && rn[0] != null && rn[1] != null ? false : null;
					sc._min = sc._max = null;
					sc.valToPct = initValToPct(sc);
				}
				let scan = sc.scan;
				if (sc.from == null || scaleOpts.scan != null) sc._minAbs = isObj(scan) ? scan.minAbs ?? 0 : 0;
				sc.scan = scan == null ? scanAuto : scan === true || isObj(scan) ? scanCached : scan === false ? scanNone : scan;
				sc.clamp = fnOrSelf(sc.clamp ?? clampScale);
				sc.asinh = sc.asinh == null ? asinhScale : fnOrSelf(sc.asinh);
			}
		}
		initScale("x");
		initScale("y");
		if (mode == 1) series.forEach((s) => {
			initScale(s.scale);
		});
		axes.forEach((a) => {
			initScale(a.scale);
		});
		for (let k in opts.scales) initScale(k);
		const scaleX = scales[xScaleKey];
		const xScaleDistr = scaleX.distr;
		let valToPosX, valToPosY;
		if (scaleX.ori == 0) {
			addClass(root, ORI_HZ);
			valToPosX = getHPos;
			valToPosY = getVPos;
		} else {
			addClass(root, ORI_VT);
			valToPosX = getVPos;
			valToPosY = getHPos;
		}
		const pendScales = {};
		const redrawDirty = /* @__PURE__ */ new Set();
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
			} else {
				wsc.min = min;
				wsc.max = max;
			}
		}
		for (let k in scales) {
			let sc = scales[k];
			if (sc.min != null || sc.max != null) {
				pendScales[k] = {
					min: sc.min,
					max: sc.max
				};
				sc.min = sc.max = null;
			}
		}
		const _tzDate = opts.tzDate || ((ts) => new Date(round(ts / ms)));
		const _fmtDate = opts.fmtDate || fmtDate;
		const _timeAxisSplits = ms == 1 ? timeAxisSplitsMs(_tzDate) : timeAxisSplitsS(_tzDate);
		const _timeAxisVals = timeAxisVals(_tzDate, timeAxisStamps(ms == 1 ? _timeAxisStampsMs : _timeAxisStampsS, _fmtDate));
		const _timeSeriesVal = timeSeriesVal(_tzDate, timeSeriesStamp("{YYYY}-{MM}-{DD} {h}:{mm}{aa}", _fmtDate));
		const activeIdxs = [];
		const legend = self.legend = assign({}, legendOpts, opts.legend);
		const tooltip = self.tooltip = assign({}, tooltipOpts, opts.tooltip);
		const cursor = self.cursor = assign({}, cursorOpts, { drag: { y: mode == 2 } }, opts.cursor);
		const showLegend = legend.show = domRoot && (legend.show ?? legendOpts.show);
		const showCursor = cursor.show = over != null && cursor.show;
		const showTooltip = tooltip.show = showCursor && tooltip.show;
		if (showTooltip) legend.live = false;
		const liveLegend = showTooltip ? tooltip : legend;
		const live = showTooltip || legend.live;
		const showLive = live && liveLegend.show;
		const showStats = showLegend && !legend.live;
		for (let view of [legend, tooltip]) {
			view.idxs = view == liveLegend && live ? activeIdxs : [];
			view.order = [];
			view.count = 0;
			view.range = [0, 0];
			let markers = view.markers;
			markers.width = fnOrSelf(markers.width);
			markers.dash = fnOrSelf(markers.dash);
			markers.stroke = fnOrSelf(markers.stroke);
			markers.fill = fnOrSelf(markers.fill);
		}
		let legendView, tooltipView, tooltipPosition;
		let shouldRenderLegend = showLegend || showTooltip;
		let shouldRefreshStats = showStats;
		let shouldRenderStats = showStats;
		let shouldSetLegendColumns = false;
		let statsCols;
		let multiValStats = false;
		let legendCols;
		let multiValLegend = false;
		const legendValuesPrev = [];
		let legendCandidates = null;
		let statsCandidates = null;
		let shouldSelectLegend = true;
		function hasLegendSelection() {
			return live && (liveLegend.filter != null || liveLegend.sort != null || liveLegend.limit != null);
		}
		function compareLegendSeries(a, b) {
			return liveLegend.sort(self, a, b) || a - b;
		}
		function compareStatsSeries(a, b) {
			return legend.sort(self, a, b) || a - b;
		}
		function selectLegend(force = false, stats = false) {
			if (!stats && !force && !shouldSelectLegend) return false;
			if (!stats) {
				shouldSelectLegend = false;
				if (showStats && !live) return false;
			}
			const view = stats ? legend : liveLegend;
			let candidates = stats ? statsCandidates : legendCandidates;
			let count = max(0, series.length - 1);
			let start = 0, end = count;
			if (stats ? view.filter != null || view.sort != null || view.limit != null : hasLegendSelection()) {
				candidates ??= [];
				count = 0;
				for (let i = 1; i < series.length; i++) if (view.filter == null || view.filter(self, i)) candidates[count++] = i;
				candidates.length = count;
				if (view.sort != null) candidates.sort(stats ? compareStatsSeries : compareLegendSeries);
				end = count;
				if (view.limit != null) {
					const range = view.limit(self, candidates);
					start = clamp(floor(range[0]) || 0, 0, count);
					end = clamp(floor(range[1]) || 0, start, count);
				}
			} else candidates = null;
			if (stats) statsCandidates = candidates;
			else legendCandidates = candidates;
			const order = view.order;
			let changed = order.length != end - start;
			for (let i = start, j = 0; i < end; i++, j++) {
				const index = candidates == null ? i + 1 : candidates[i];
				changed = order[j] != index || changed;
				order[j] = index;
			}
			order.length = end - start;
			if (changed && (showLegend || showTooltip)) {
				shouldRenderLegend = true;
				if (stats) shouldRenderStats = true;
			}
			changed = changed || view.count != count || view.range[0] != start || view.range[1] != end;
			view.count = count;
			view.range[0] = start;
			view.range[1] = end;
			!stats && live && showCursor && syncCursorPointLegend(order);
			return changed;
		}
		let NULL_LEGEND_VALUES = {};
		function usesMultiValues(view) {
			return view.valueSrc == null ? series[1]?.values != null : view.valueSrc == "values";
		}
		function setLegendColumns() {
			shouldSetLegendColumns = false;
			const multi = usesMultiValues(liveLegend);
			if (multiValLegend != multi) liveLegend.values.fill(null);
			multiValLegend = multi;
			legendCols = multi ? series[1]?.values(self, 1, 0) : { _: 0 };
			if (showTooltip && multiValLegend) legendCols = assign({}, legendCols);
			NULL_LEGEND_VALUES = {};
			for (let k in legendCols) NULL_LEGEND_VALUES[k] = "--";
			legendValuesPrev.length = 0;
			(showTooltip ? tooltipView : legendView)?.setColumns(legendCols, multiValLegend);
		}
		if (live) setLegendColumns();
		function refreshStats() {
			shouldRefreshStats = false;
			const multi = usesMultiValues(legend);
			if (multiValStats != multi) legend.values.fill(null);
			multiValStats = multi;
			statsCols = multiValStats ? null : { _: 0 };
			legend.idx = null;
			legend.idxs.length = legend.values.length = series.length;
			legend.idxs.fill(null);
			for (let i = 1; i < series.length; i++) {
				let s = series[i];
				if (multiValStats) {
					let vals = s.values(self, i, null);
					if (i == 1) statsCols = assign({}, vals);
					legend.values[i] = vals != null ? assign({}, vals) : vals;
				} else {
					let vals = legend.values[i] ??= {};
					vals._ = s.value(self, null, i, null) ?? "--";
				}
			}
			selectLegend(true, true);
			legendView.setColumns(statsCols, multiValStats);
			shouldRenderStats = shouldRenderLegend = true;
		}
		const son = { show: true };
		const soff = { show: false };
		function handleLegendEvent(type, s, e) {
			let seriesIdx = s == null ? null : series.indexOf(s);
			if (cursor._lock || seriesIdx == -1) return;
			setCursorEvent(e);
			if (type == "click") {
				if ((e.ctrlKey || e.metaKey) != legend.isolate) {
					let isolate = series.some((s, i) => i > 0 && i != seriesIdx && s.show);
					series.forEach((s, i) => {
						i > 0 && setSeries(i, isolate ? i == seriesIdx ? son : soff : son, true, syncOpts.setSeries);
					});
				} else setSeries(seriesIdx, { show: !s.show }, true, syncOpts.setSeries);
			} else if (type == "focus") setSeries(seriesIdx, FOCUS_TRUE, true, syncOpts.setSeries);
			else if (focusedSeries != null) setSeries(null, FOCUS_TRUE, true, syncOpts.setSeries);
		}
		const mouseListeners = /* @__PURE__ */ new Map();
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
					if (mouseOwner == null || mouseOwner == self.uid) return listener.call(this, e);
				});
				mouseListeners.set(targ, targListeners);
			}
			return listener != null;
		}
		function offMouse(ev, targ, fn) {
			const targListeners = mouseListeners.get(targ) || {};
			for (let k in targListeners) if (ev == null || k == ev) {
				off(k, targ, targListeners[k]);
				delete targListeners[k];
			}
			if (ev == null) mouseListeners.delete(targ);
		}
		let fullWidCss = 0;
		let fullHgtCss = 0;
		let plotWidCss = 0;
		let plotHgtCss = 0;
		let plotLftCss = 0;
		let plotTopCss = 0;
		let plotLft = 0;
		let plotTop = 0;
		let plotWid = 0;
		let plotHgt = 0;
		let canToCssX = 1;
		let canToCssY = 1;
		self.bbox = {
			left: 0,
			top: 0,
			width: 0,
			height: 0
		};
		const stackDirty = /* @__PURE__ */ new Set();
		let shouldSetScales = false;
		let shouldSetCanvas = false;
		let shouldLayout = false;
		let shouldSetCursor = false;
		let shouldSetSelect = false;
		let shouldSetLegend = false;
		function setSize({ width, height }) {
			if (width != self.width || height != self.height) {
				self.width = fullWidCss = width;
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
		function reserveVerticalAxes(sizes) {
			for (let axis of axes) if (axis._show && axis.side % 2 == 1) sizes[axis.side] += max(0, axis._sizeHint + (axis.label != null ? axis.labelSize : 0));
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
				plotLft = bb.left = incrRound(off * pxRatio$1, .5);
				plotWid = bb.width = incrRound(dim * pxRatio$1, .5);
			} else {
				plotTopCss = off;
				plotHgtCss = dim;
				plotTop = bb.top = incrRound(off * pxRatio$1, .5);
				plotHgt = bb.height = incrRound(dim * pxRatio$1, .5);
			}
		}
		function resetScalePaths(changed) {
			series.forEach((s, i) => {
				if (mode == 2 ? i > 0 && s.facets.some((f) => changed[f.scale]) : changed[s.scale]) s._paths = null;
			});
		}
		function rangeYScales(ori, dim, changedY) {
			for (let k in scales) {
				let sc = scales[k];
				if (sc._rawY == null || sc.ori != ori) continue;
				let axis = axes[sc.axis];
				let [rawMin, rawMax] = sc._rawY;
				let space = ori == 0 && rawMin != null && rawMax != null ? axis.space(self, sc.axis, rawMin, rawMax, dim) : 50;
				let result = sc._rangeY = rangeY(rawMin, rawMax, dim, sc._policyY, axis.ramp, axis.exact, space);
				let min = result?.min ?? null;
				let max = result?.max ?? null;
				if (sc.min != min || sc.max != max) {
					sc.min = sc._min = min;
					sc.max = sc._max = max;
					changedY.push(k);
					resetScalePaths({ [k]: true });
					if ((showCursor || cursorDists != null || hasLegendSelection()) && cursor.left >= 0) shouldSetCursor = shouldSetLegend = true;
					shouldSelectLegend = shouldSelectLegend || hasLegendSelection();
				}
			}
		}
		function updateLayout() {
			let pxRatioChanged = pxRatio$1 != self.pxRatio;
			if (pxRatioChanged) {
				pxRatio$1 = self.pxRatio;
				axes.forEach((axis) => {
					syncFontSize(axis, pxRatio$1);
					axis._labelValues = axis._labelWidths = null;
				});
			}
			let prevLeft = plotLftCss;
			let prevTop = plotTopCss;
			let prevWidth = plotWidCss;
			let prevHeight = plotHgtCss;
			let axesChanged = false;
			let early = false;
			let sizes = [
				0,
				0,
				0,
				0
			];
			sidesWithAxes.fill(false);
			axes.forEach((axis) => {
				let sc = scales[axis.scale];
				let show = axis.show && (sc._rawY != null ? sc._rawY[0] : sc.min) != null;
				axesChanged = axesChanged || axis._show != show;
				axis._show = show;
				axis._splits = axis._values = null;
				early = early || show && axis.size === autoAxisSize && axis.side % 2 == 0;
				if (show && (axis._sizeHint > 0 || axis.label != null && axis.labelSize > 0)) sidesWithAxes[axis.side] = true;
			});
			let changedY = [];
			if (!early) axesChanged = sizeAxes(0, sizes) || axesChanged;
			padding.forEach((p, i) => {
				_padding[i] = isArr(p) ? p[0] : p ?? autoPadSide(i);
			});
			if (early) {
				reserveVerticalAxes(sizes);
				calcPlotDim(0, sizes);
				rangeYScales(0, plotWidCss, changedY);
				axesCalc(0);
				axesChanged = sizeAxes(0, sizes) || axesChanged;
				sizes[1] = sizes[3] = 0;
			}
			calcPlotDim(1, sizes);
			rangeYScales(1, plotHgtCss, changedY);
			axesCalc(1);
			axesChanged = sizeAxes(1, sizes) || axesChanged;
			if (!early) {
				calcPlotDim(0, sizes);
				rangeYScales(0, plotWidCss, changedY);
				axesCalc(0);
			}
			resolvePadding(self, sizes[3], sizes[1]);
			calcPlotDim(0, sizes);
			axesChanged = calcAxesRects() || axesChanged;
			let plotChanged = plotLftCss != prevLeft || plotTopCss != prevTop || plotWidCss != prevWidth || plotHgtCss != prevHeight;
			let resized = shouldSetCanvas;
			shouldSetCanvas = false;
			if (resized) setCanvasSize();
			if (plotChanged || pxRatioChanged) resetYSeries(false);
			if (plotChanged) resizeOverlays(prevWidth, prevHeight);
			if (showCursor && !shouldSetCursor && (plotChanged || resized)) syncCursorPoints();
			if (resized || plotChanged || axesChanged) {
				shouldSelectLegend = shouldSelectLegend || hasLegendSelection();
				applyLayout(plotChanged, axesChanged);
				fire("setSize");
			}
			return changedY;
		}
		function calcAxesRects() {
			let changed = false;
			let off1 = plotLftCss + plotWidCss;
			let off2 = plotTopCss + plotHgtCss;
			let off3 = plotLftCss;
			let off0 = plotTopCss;
			function incrOffset(side, size) {
				switch (side) {
					case 1:
						off1 += size;
						return off1 - size;
					case 2:
						off2 += size;
						return off2 - size;
					case 3:
						off3 -= size;
						return off3 + size;
					case 0:
						off0 -= size;
						return off0 + size;
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
			skip.add(void 0);
			let prox = hov.prox = fnOrSelf(hov.prox);
			let bias = hov.bias ??= 0;
			cursor.dataIdx = (self, seriesIdx, cursorIdx, valAtPosX) => {
				if (seriesIdx == 0) return cursorIdx;
				let idx2 = cursorIdx;
				let _prox = prox(self, seriesIdx, cursorIdx, valAtPosX) ?? Infinity;
				let withProx = _prox >= 0 && _prox < Infinity;
				let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss;
				let cursorLft = cursor.left;
				let xValues = data[0];
				let yValues = data[seriesIdx];
				if (skip.has(yValues[cursorIdx])) {
					idx2 = null;
					let nonNullLft = null, nonNullRgt = null, j;
					if (bias == 0 || bias == -1) {
						j = cursorIdx;
						while (nonNullLft == null && --j >= i0) if (!skip.has(yValues[j])) nonNullLft = j;
					}
					if (bias == 0 || bias == 1) {
						j = cursorIdx;
						while (nonNullRgt == null && ++j <= i1) if (!skip.has(yValues[j])) nonNullRgt = j;
					}
					if (nonNullLft != null || nonNullRgt != null) {
						if (withProx) {
							let lftPos = nonNullLft == null ? -Infinity : valToPosX(xValues[nonNullLft], scaleX, xDim, 0);
							let rgtPos = nonNullRgt == null ? Infinity : valToPosX(xValues[nonNullRgt], scaleX, xDim, 0);
							let lftDelta = cursorLft - lftPos;
							let rgtDelta = rgtPos - cursorLft;
							if (lftDelta <= rgtDelta) {
								if (lftDelta <= _prox) idx2 = nonNullLft;
							} else if (rgtDelta <= _prox) idx2 = nonNullRgt;
						} else idx2 = nonNullRgt == null ? nonNullLft : nonNullLft == null ? nonNullRgt : cursorIdx - nonNullLft <= nonNullRgt - cursorIdx ? nonNullLft : nonNullRgt;
					}
				} else if (withProx) {
					if (abs(cursorLft - valToPosX(xValues[cursorIdx], scaleX, xDim, 0)) > _prox) idx2 = null;
				}
				return idx2;
			};
		}
		const setCursorEvent = (e) => {
			cursor.event = e;
		};
		cursor.idxs = activeIdxs;
		const cursorDists = cursor.dists = cursor.trackDists ? [] : null;
		cursor._lock = false;
		let points = cursor.points;
		points.show = fnOrSelf(points.show);
		points.size = fnOrSelf(points.size);
		points.stroke = fnOrSelf(points.stroke);
		points.width = fnOrSelf(points.width);
		points.fill = fnOrSelf(points.fill);
		const focus = self.focus = assign({}, opts.focus || { alpha: .3 }, cursor.focus);
		const cursorFocus = focus.prox >= 0;
		const cursorOnePt = cursorFocus && points.one;
		let cursorPts = [];
		let cursorPtsLft = [];
		let cursorPtsTop = [];
		let cursorPtsWid = [];
		let cursorPtsHgt = [];
		let cursorPtSeries = null;
		let cursorPtMembers = null;
		function syncCursorPointLegend(order) {
			const restricted = order.length < series.length - 1;
			if (!restricted && !cursorPtMembers?.length) return;
			if (restricted) {
				cursorPtMembers ??= [];
				cursorPtMembers.length = series.length;
				cursorPtMembers.fill(false);
				for (let si of order) cursorPtMembers[si] = true;
			}
			for (let i = 0; i < cursorPts.length; i++) {
				let pt = cursorPts[i];
				if (pt != null) (restricted && !cursorPtMembers[cursorOnePt ? cursorPtSeries : i] ? addClass : remClass)(pt, LEGEND_EXCLUDE);
			}
			if (!restricted) cursorPtMembers.length = 0;
		}
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
			s.scan = s.scan ?? s.auto ?? (mode == 2 || i > 0);
			if (mode == 2 && i > 0) s.facets.forEach((f) => {
				f.scan = f.scan ?? f.auto ?? true;
			});
			if (mode == 1 || i > 0) {
				let isTime = mode == 1 && scales[s.scale].time;
				let sv = s.value;
				s.value = isTime ? isStr(sv) ? timeSeriesVal(_tzDate, timeSeriesStamp(sv, _fmtDate)) : sv || _timeSeriesVal : sv || numSeriesVal;
				s.label = s.label || (isTime ? "Time" : "Value");
			}
			if (cursorOnePt || i > 0) {
				s.width = s.width ?? 1;
				s.paths = s.paths || linearPath || retNull;
				s.fillTo = fnOrSelf(s.fillTo || seriesFillTo);
				s.pxAlign = +(s.pxAlign ?? pxAlign);
				s.pxRound = pxRoundGen(s.pxAlign);
				s.stroke = fnOrSelf(s.stroke || null);
				s.fill = fnOrSelf(s.fill || null);
				s._stroke = s._fill = s._paths = s._focus = null;
				let _ptDia = ptDia(max(1, s.width), 1);
				let points = s.points = assign({}, {
					shape: 1,
					size: _ptDia,
					width: max(1, _ptDia * .2),
					stroke: s.stroke,
					space: _ptDia * 2,
					paths: pointsPath,
					_stroke: null,
					_fill: null
				}, s.points);
				points.show = fnOrSelf(points.show);
				points.filter = fnOrSelf(points.filter);
				points.fill = fnOrSelf(points.fill);
				points.stroke = fnOrSelf(points.stroke);
				points.paths = fnOrSelf(points.paths);
				points.pxAlign = s.pxAlign;
			}
			activeIdxs.splice(i, 0, null);
			cursorDists?.splice(i, 0, inf);
			if (showCursor) {
				let pt = null;
				if (cursorOnePt) {
					if (i == 0) pt = initCursorPt(s, i);
				} else if (i > 0) pt = initCursorPt(s, i);
				cursorPts.splice(i, 0, pt);
				cursorPtsLft.splice(i, 0, 0);
				cursorPtsTop.splice(i, 0, 0);
				cursorPtsWid.splice(i, 0, 0);
				cursorPtsHgt.splice(i, 0, 0);
			}
			focusedSeries != null && setSeriesFocus(s, i);
		}
		function addSeries(opts, si) {
			if (stackGroups.length > 0) return;
			si ??= series.length;
			opts = mode == 1 ? setDefault(opts, si, xSeriesOpts, ySeriesOpts) : setDefault(opts, si, {}, xySeriesOpts);
			clearDispCache();
			series.splice(si, 0, opts);
			invalidateBandGroups();
			legend.values.splice(si, 0, null);
			showTooltip && tooltip.values.splice(si, 0, null);
			multiValLegend && legendValuesPrev.splice(si, 0, null);
			initSeries(series[si], si);
			if (cursorPtSeries != null && cursorPtSeries >= si) {
				cursorPtSeries++;
				shouldSetCursor = true;
			}
			shouldSelectLegend = true;
			shouldRenderLegend = showLegend || showTooltip;
			shouldSetLegendColumns = live;
			shouldRefreshStats = showStats;
			(showStats || showTooltip) && commit();
			fire("addSeries", si);
		}
		self.addSeries = addSeries;
		function delSeries(i) {
			if (stackGroups.length > 0) return;
			clearDispCache();
			series.splice(i, 1);
			invalidateBandGroups();
			legend.values.splice(i, 1);
			showTooltip && tooltip.values.splice(i, 1);
			multiValLegend && legendValuesPrev.splice(i, 1);
			shouldRenderLegend = showLegend || showTooltip;
			shouldSetLegendColumns = live;
			shouldRefreshStats = showStats;
			(showStats || showTooltip) && commit();
			activeIdxs.splice(i, 1);
			cursorDists?.splice(i, 1);
			shouldSelectLegend = true;
			if (showCursor) {
				cursorPts.splice(i, 1)[0]?.remove();
				cursorPtsLft.splice(i, 1);
				cursorPtsTop.splice(i, 1);
				cursorPtsWid.splice(i, 1);
				cursorPtsHgt.splice(i, 1);
			}
			if (cursorPtSeries != null && cursorPtSeries >= i) {
				cursorPtSeries = cursorPtSeries == i ? null : cursorPtSeries - 1;
				cursorPtSeries ?? syncCursorPoints();
				shouldSetCursor = true;
			}
			fire("delSeries", i);
		}
		self.delSeries = delSeries;
		const sidesWithAxes = [
			false,
			false,
			false,
			false
		];
		function initAxis(axis, i) {
			axis._show = axis.show;
			if (axis.show) {
				let isVt = axis.side % 2;
				let sc = scales[axis.scale];
				if (sc == null) {
					axis.scale = isVt ? series[1].scale : xScaleKey;
					sc = scales[axis.scale];
				}
				let cfg = opts.scales?.[axis.scale];
				sc._axisY = sc._axisY || sc.axis === i && (mode == 2 || axis.scale != xScaleKey) && sc.ori == isVt && sc.distr == 1 && !sc.time && cfg?.auto !== false && sc._policyY != null && sc.from == null && !Object.values(scales).some((s) => s.from == axis.scale) && axis.incrs == null && axis.splits == null && (!isVt || opts.axes?.[i]?.space == null);
				let isTime = sc.time;
				let autoSize = axis.size == "auto";
				axis._sizeHint = autoSize || isFn(axis.size) ? yAxisOpts.size : axis.size;
				axis.size = autoSize ? autoAxisSize : fnOrSelf(axis.size);
				axis.space = fnOrSelf(axis.space);
				axis.rotate = fnOrSelf(axis.rotate);
				if (isArr(axis.incrs)) axis.incrs.forEach((incr) => {
					!fixedDec.has(incr) && fixedDec.set(incr, guessDec(incr));
				});
				axis.incrs = fnOrSelf(axis.incrs || (sc.distr == 2 ? wholeIncrs : isTime ? ms == 1 ? timeIncrsMs : timeIncrsS : numIncrs));
				axis.splits = fnOrSelf(axis.splits || (isTime && sc.distr == 1 ? _timeAxisSplits : sc.distr == 3 ? logAxisSplits : sc.distr == 4 ? asinhAxisSplits : numAxisSplits));
				axis.stroke = fnOrSelf(axis.stroke);
				axis.grid.stroke = fnOrSelf(axis.grid.stroke);
				axis.ticks.stroke = fnOrSelf(axis.ticks.stroke);
				axis.border.stroke = fnOrSelf(axis.border.stroke);
				let av = axis.values;
				axis.values = isArr(av) && !isArr(av[0]) ? fnOrSelf(av) : isTime ? isArr(av) ? timeAxisVals(_tzDate, timeAxisStamps(av, _fmtDate)) : isStr(av) ? timeAxisVal(_tzDate, av) : av || _timeAxisVals : av || numAxisVals;
				axis.filter = fnOrSelf(axis.filter || (sc.distr >= 3 && sc.log == 10 ? log10AxisValsFilt : (sc.distr == 3 || sc.distr == 4) && sc.log == 2 ? log2AxisValsFilt : retArg1));
				axis.font = pxRatioFont(axis.font, pxRatio$1);
				axis.labelFont = pxRatioFont(axis.labelFont, pxRatio$1);
				axis._size = 0;
				axis._space = axis._rotate = axis._incrs = axis._found = axis._splits = axis._values = axis._labelValues = axis._labelWidths = null;
				if (domRoot && axis.dom && axis._sizeHint > 0) axis._el = placeDiv(AXIS, wrap);
			}
		}
		function autoPadSide(side) {
			let [hasTopAxis, hasRgtAxis, hasBtmAxis, hasLftAxis] = sidesWithAxes;
			let ori = side % 2;
			let size = 0;
			if (ori == 0 && (hasLftAxis || hasRgtAxis)) size = side == 0 && !hasTopAxis || side == 2 && !hasBtmAxis ? round(xAxisOpts.size / 3) : 0;
			if (ori == 1 && (hasTopAxis || hasBtmAxis)) size = side == 1 && !hasRgtAxis || side == 3 && !hasLftAxis ? round(yAxisOpts.size / 2) : 0;
			return size;
		}
		const padding = self.padding = (opts.padding || [
			null,
			null,
			null,
			null
		]).slice();
		const _padding = self._padding = [
			0,
			0,
			0,
			0
		];
		let dataLen;
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
			stackGroups.forEach((group) => {
				let mixed = group.dir == 0;
				let accum = Array(dataLen).fill(0);
				let negAccum = mixed ? Array(dataLen).fill(0) : null;
				let prevSeriesIdx = null;
				group.series.forEach((si) => {
					if (!series[si].show) return;
					let raw = rawData[si];
					if (raw != null) {
						let stacked = stackedData[si] = Array(raw.length);
						let base = mixed ? baseData[si] = Array(raw.length) : null;
						for (let i = 0; i < raw.length; i++) {
							let value = raw[i];
							let sums = mixed && value < 0 ? negAccum : accum;
							if (mixed) base[i] = value == null ? value : sums[i];
							stacked[i] = value == null ? value : sums[i] += value;
						}
					}
					if (!mixed && prevSeriesIdx != null) {
						let prevBand = bands[bandIdx];
						bandsChanged = bandsChanged || prevBand == null || prevBand.series[0] != si || prevBand.series[1] != prevSeriesIdx;
						bands[bandIdx++] = {
							series: [si, prevSeriesIdx],
							dir: -group.dir,
							fill: retNull
						};
					}
					prevSeriesIdx = si;
				});
				if (stackPercent) {
					let negTotals = mixed ? negAccum : group.dir == -1 ? accum : null;
					if (negTotals != null) for (let i = 0; i < negTotals.length; i++) negTotals[i] = abs(negTotals[i]);
					group.series.forEach((si) => {
						let stacked = stackedData[si];
						if (series[si].show && stacked != null) {
							for (let i = 0; i < stacked.length; i++) if (stacked[i] != null) {
								let total = mixed && stacked[i] < 0 ? negAccum[i] : accum[i];
								stacked[i] = total == 0 ? 0 : stacked[i] / total;
								if (mixed) baseData[si][i] = total == 0 ? 0 : baseData[si][i] / total;
							}
						}
					});
				}
			});
			bandsChanged = bandsChanged || bands.length != bandIdx;
			bands.length = bandIdx;
			if (bandsChanged) invalidateBandGroups();
			return stackedData;
		}
		function setScaleData(rawData) {
			let scaleData = stackGroups.length == 0 ? rawData : stackData(rawData);
			if (xScaleDistr == 2) {
				if (scaleData == rawData) scaleData = scaleData.slice();
				let _data0 = self._data?.[0];
				if (_data0?.length != dataLen) {
					_data0 = Array(dataLen);
					for (let i = 0; i < dataLen; i++) _data0[i] = i;
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
			if (rawData !== self.data) clearDispCache();
			if (mode == 2) {
				self.data = self._data = data = rawData;
				dataLen = 0;
				for (let i = 1; i < series.length; i++) dataLen += data[i][0].length;
			} else {
				if (rawData.length == 0) rawData = [[]];
				self.data = rawData;
				data0 = rawData[0];
				dataLen = data0.length;
				setScaleData(rawData);
			}
			resetYSeries(true);
			if (cursorDists != null || hasLegendSelection()) {
				shouldSetCursor = shouldSetCursor || cursor.left >= 0;
				shouldSetLegend = shouldSelectLegend = true;
			}
			shouldRefreshStats = showStats;
			showStats && commit();
			if (showTooltip) {
				shouldSetCursor = shouldSetCursor || cursor.left >= 0;
				shouldSetLegend = true;
				commit();
			}
			fire("setData");
			if (xScaleDistr == 2) shouldLayout = true;
			if (_resetScales !== false) {
				let xsc = scaleX;
				if (xsc.auto(self, viaAutoScaleX)) autoScaleX();
				else setRange(xScaleKey, xsc.min, xsc.max);
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
				} else {
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
			dash ??= EMPTY_ARR;
			cap ??= "butt";
			join ??= "round";
			if (stroke != ctxStroke) ctx.strokeStyle = ctxStroke = stroke;
			if (width != ctxWidth) ctx.lineWidth = ctxWidth = width;
			if (join != ctxJoin) ctx.lineJoin = ctxJoin = join;
			if (cap != ctxCap) ctx.lineCap = ctxCap = cap;
			if (dash != ctxDash) ctx.setLineDash(ctxDash = dash);
		}
		function setFontStyle(font, fill, align, baseline) {
			if (fill != ctxFill) ctx.fillStyle = ctxFill = fill;
			if (font != ctxFont) ctx.font = ctxFont = font;
			if (align != ctxAlign) ctx.textAlign = ctxAlign = align;
			if (baseline != ctxBaseline) ctx.textBaseline = ctxBaseline = baseline;
		}
		function applyScanRange(wsc, psc, minMax, key) {
			wsc._minAbs = minMax[2];
			if (wsc._axisY && isFullyImplicit(psc.min, psc.max)) {
				scales[key]._rawY = minMax;
				shouldLayout = true;
			} else applyCalculatedRange(wsc, psc, wsc.range(self, minMax[0], minMax[1], key), key);
		}
		const AUTOSCALE = {
			min: null,
			max: null
		};
		function setScales() {
			for (let k in scales) {
				let sc = scales[k];
				if (pendScales[k] == null && (sc.min == null || pendScales[xScaleKey] != null && sc.auto(self, viaAutoScaleX))) pendScales[k] = AUTOSCALE;
			}
			for (let k in scales) {
				let sc = scales[k];
				if (pendScales[k] == null && sc.from != null && pendScales[sc.from] != null) pendScales[k] = AUTOSCALE;
			}
			if (pendScales[xScaleKey] != null) {
				resetYSeries(false);
				for (let k in scales) {
					if (mode == 2 || k == xScaleKey) continue;
					if (!pendScales[xScaleKey].redraw) redrawDirty.add(k);
					let psc = pendScales[k];
					if (redrawDirty.has(k) && (scales[k].distr == 4 || psc != null && !isFullyExplicit(psc.min, psc.max))) resetScaleSeries(k);
				}
			}
			let wipScales = {};
			for (let k in pendScales) {
				let psc = pendScales[k];
				if (psc != null) {
					let wsc = wipScales[k] = copy(scales[k], fastIsObj);
					wsc._minAbs = void 0;
					if (scales[k]._rawY != null) {
						shouldLayout = true;
						scales[k]._rawY = null;
					}
					if (isFullyExplicit(psc.min, psc.max)) {
						wsc.min = psc.min;
						wsc.max = psc.max;
					} else if (dataLen == 0 && wsc.from == null) applyScanRange(wsc, psc, wsc.scan(self, k, void 0, void 0, viaAutoScaleX), k);
					else if (k != xScaleKey || mode == 2) {
						wsc.min = inf;
						wsc.max = -Infinity;
					}
				}
			}
			if (dataLen > 0) {
				series.forEach((s, i) => {
					if (mode == 1) {
						let k = s.scale;
						let psc = pendScales[k];
						if (psc == null) return;
						let wsc = wipScales[k];
						if (i == 0) {
							if (!isFullyExplicit(psc.min, psc.max)) {
								let minMax = wsc.scan == scanAuto || wsc.scan == scanCached ? scanCachedX(self, k) : wsc.scan(self, k, void 0, void 0, viaAutoScaleX);
								wsc._minAbs = minMax[2];
								applyCalculatedRange(wsc, psc, wsc.range(self, minMax[0], minMax[1], k), k);
							}
							i0 = closestIdx(wsc.min, data[0]);
							i1 = closestIdx(wsc.max, data[0]);
							if (i1 - i0 > 1) {
								if (data[0][i0] < wsc.min) i0++;
								if (data[0][i1] > wsc.max) i1--;
							}
							s.min = data0[i0];
							s.max = data0[i1];
						}
						s.idxs[0] = i0;
						s.idxs[1] = i1;
					}
				});
				for (let k in wipScales) {
					let wsc = wipScales[k];
					let psc = pendScales[k];
					if (wsc.from == null && !isFullyExplicit(psc.min, psc.max) && (mode == 2 || k != xScaleKey)) applyScanRange(wsc, psc, wsc.scan(self, k, i0, i1, viaAutoScaleX), k);
				}
			}
			for (let k in wipScales) {
				let wsc = wipScales[k];
				if (wsc.from != null) {
					let base = wipScales[wsc.from];
					if (base.min == null) wsc.min = wsc.max = null;
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
				if (sc._rawY != null) continue;
				if (sc.min != wsc.min || sc.max != wsc.max) {
					sc.min = wsc.min;
					sc.max = wsc.max;
					changed[k] = anyChanged = true;
				}
				if (distr == 4) {
					let linthresh = sc.asinh == asinhScale && wsc._minAbs !== void 0 ? wsc._minAbs ?? 1 : sc.asinh(self, k);
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
				resetScalePaths(changed);
				for (let k in changed) {
					shouldLayout = true;
					fire("setScale", k);
				}
				if ((showCursor || cursorDists != null || hasLegendSelection()) && cursor.left >= 0) shouldSetCursor = shouldSetLegend = true;
				shouldSelectLegend = shouldSelectLegend || hasLegendSelection();
			}
			for (let k in pendScales) pendScales[k] = null;
		}
		function getOuterIdxs(ydata) {
			let _i0 = clamp(i0 - 1, 0, dataLen - 1);
			let _i1 = clamp(i1 + 1, 0, dataLen - 1);
			while (ydata[_i0] == null && _i0 > 0) _i0--;
			while (ydata[_i1] == null && _i1 < dataLen - 1) _i1++;
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
				let shouldAlpha = series.some((s) => s._focus) && ctxAlpha != focus.alpha;
				if (shouldAlpha) ctx.globalAlpha = ctxAlpha = focus.alpha;
				series.forEach((s, i) => {
					if (i > 0 && s.show) {
						cacheStrokeFill(i, false);
						cacheStrokeFill(i, true);
						if (s._paths == null) {
							let _ctxAlpha = ctxAlpha;
							if (ctxAlpha != s.alpha) ctx.globalAlpha = ctxAlpha = s.alpha;
							let _idxs = mode == 2 ? [0, data[i][0].length - 1] : getOuterIdxs(data[i]);
							s._paths = s.paths(self, i, _idxs[0], _idxs[1]);
							if (ctxAlpha != _ctxAlpha) ctx.globalAlpha = ctxAlpha = _ctxAlpha;
						}
					}
				});
				if (bandGroupsDirty) {
					bandEnds.length = firstBand.length = bands.length > 0 ? series.length : 0;
					bandEnds.fill(0);
					firstBand.fill(-1);
					nextBand.length = bandHasData.length = bands.length;
					bandHasData.fill(false);
					for (let bi = bands.length - 1; bi >= 0; bi--) {
						let b = bands[bi];
						let si = b.series[0];
						nextBand[bi] = firstBand[si];
						firstBand[si] = bi;
						let to = b.series[1] ?? si;
						let lo = min(si, to);
						let hi = max(si, to);
						bandEnds[lo] = max(bandEnds[lo], hi);
					}
					for (let i = 1; i < bandEnds.length; i++) {
						let end = bandEnds[i];
						if (end > 0) {
							for (let j = i + 1; j <= end; j++) end = max(end, bandEnds[j]);
							bandEnds[i] = end;
							i = end;
						}
					}
					bandGroupsDirty = false;
				}
				for (let pass = 0; pass < 2; pass++) for (let i = 1; i < series.length; i++) {
					let end = bandEnds[i] || i;
					let focused = false;
					for (let j = i; j <= end && !focused; j++) focused = series[j].show && !!series[j]._focus;
					if (focused == (pass == 1)) {
						if (bandEnds[i] > 0) {
							for (let j = i; j <= end; j++) drawSeriesPart(j, 1, false);
							for (let j = i; j <= end; j++) drawSeriesPart(j, 2, false);
							for (let j = i; j <= end; j++) drawSeriesPart(j, 0, true);
						} else drawSeriesPart(i, CLIP_FILL_STROKE, true);
					}
					i = end;
				}
				if (shouldAlpha) ctx.globalAlpha = ctxAlpha = 1;
			}
		}
		function drawSeriesPart(i, draw, _points) {
			let s = series[i];
			if (s.show) {
				let _ctxAlpha = ctxAlpha;
				if (ctxAlpha != s.alpha) ctx.globalAlpha = ctxAlpha = s.alpha;
				draw != 0 && s._paths != null && drawPath(i, false, draw);
				if (_points && true) {
					let _gaps = s._paths != null ? s._paths.gaps : null;
					let idx0 = mode == 2 ? 0 : i0;
					let idx1 = mode == 2 ? data[i][0].length - 1 : i1;
					let show = s.points.show(self, i, idx0, idx1, _gaps);
					let idxs = s.points.filter(self, i, show, _gaps);
					if (show || idxs) {
						s.points._paths = s.points.paths(self, i, idx0, idx1, idxs);
						if (s.points._paths != null) drawPath(i, true);
					}
				}
				if (ctxAlpha != _ctxAlpha) ctx.globalAlpha = ctxAlpha = _ctxAlpha;
				_points && fire("drawSeries", i);
			}
		}
		function cacheStrokeFill(si, _points) {
			let s = _points ? series[si].points : series[si];
			s._stroke = s.stroke(self, si);
			s._fill = s.fill(self, si);
		}
		function drawPath(si, _points, draw = CLIP_FILL_STROKE) {
			let s = _points ? series[si].points : series[si];
			let { stroke, fill, clip: gapsClip, flags, _stroke: strokeStyle = s._stroke, _fill: fillStyle = s._fill, _width: width = s.width } = s._paths;
			if (!(draw & 2)) stroke = null;
			if (!(draw & 1)) fill = null;
			width = roundDec(width * pxRatio$1, 3);
			let offset = pxOffset(width, s.pxAlign);
			if (!(width > 0) || !hasPaint(stroke, strokeStyle)) stroke = null;
			if (!_points) {
				fillStroke(si, strokeStyle, width, s.dash, s.cap, fillStyle, stroke, fill, flags, gapsClip, draw, offset);
				return;
			}
			if (fillStyle == null) fillStyle = width > 0 ? "#fff" : strokeStyle;
			if (stroke == null && !hasPaint(fill, fillStyle)) return;
			offset != 0 && ctx.translate(offset, offset);
			strokeFill(strokeStyle, width, s.dash, s.cap, fillStyle, stroke, fill, flags, gapsClip);
			offset != 0 && ctx.translate(-offset, -offset);
		}
		function hasPaint(path, style) {
			return path instanceof Map ? path.size > 0 : path != null && style != null;
		}
		function fillStroke(si, strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, gapsClip, draw, offset) {
			if (!(draw & 1) && strokePath == null) return;
			let boundsClip = null;
			let bi = flags != 0 ? firstBand[si] ?? -1 : -1;
			do {
				let b = bi == -1 ? null : bands[bi];
				let bandClip = null;
				let gapsClip2;
				let _fillStyle = fillStyle;
				if (b != null && b.series[1] == null) {
					if (draw & 1) _fillStyle = b.fill(self, bi) || fillStyle;
				} else if (b != null) {
					let lowerEdge = series[b.series[1]];
					let lowerData = data[b.series[1]];
					bandClip = (lowerEdge._paths || EMPTY_OBJ).band;
					if (isArr(bandClip)) bandClip = b.dir == 1 ? bandClip[0] : bandClip[1];
					_fillStyle = null;
					if (draw & 1) bandHasData[bi] = lowerEdge.show && bandClip != null && hasData(lowerData, i0, i1);
					if (bandHasData[bi]) {
						if (draw & 1) _fillStyle = b.fill(self, bi) || fillStyle;
						gapsClip2 = lowerEdge._paths.clip;
					} else bandClip = null;
				}
				if (strokePath == null && !hasPaint(fillPath, _fillStyle)) continue;
				if (boundsClip == null) {
					boundsClip = new Path2D();
					boundsClip.rect(plotLft - lineWidth / 2, plotTop - lineWidth / 2, plotWid + lineWidth, plotHgt + lineWidth);
					offset != 0 && ctx.translate(offset, offset);
				}
				strokeFill(strokeStyle, lineWidth, lineDash, lineCap, _fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip, gapsClip2, bandClip);
			} while (bi != -1 && (bi = nextBand[bi]) != -1);
			boundsClip != null && offset != 0 && ctx.translate(-offset, -offset);
		}
		const CLIP_FILL_STROKE = 3;
		function strokeFill(strokeStyle, lineWidth, lineDash, lineCap, fillStyle, strokePath, fillPath, flags, boundsClip, gapsClip, gapsClip2, bandClip) {
			let canFill = hasPaint(fillPath, fillStyle);
			let canStroke = lineWidth > 0 && hasPaint(strokePath, strokeStyle);
			if (!canFill && !canStroke) return;
			if (!(canFill && flags & 1 || canStroke && flags & 2)) bandClip = null;
			if (canStroke) setCtxStroke(strokeStyle, lineWidth, lineDash, lineCap);
			if (canFill) {
				let fill = fillStyle ?? "#0000";
				if (fill != ctxFill) ctx.fillStyle = ctxFill = fill;
			}
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
				} else if (flags & 2) {
					doFill(fillStyle, fillPath);
					ctx.clip(bandClip);
					doStroke(strokeStyle, strokePath, lineWidth);
				} else if (flags & 1) {
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
			} else {
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
				if (strokePath instanceof Map) strokePath.forEach((strokePath, strokeStyle) => {
					ctx.strokeStyle = ctxStroke = strokeStyle;
					if (isArr(strokePath)) strokePath.forEach((path) => ctx.stroke(path));
					else ctx.stroke(strokePath);
				});
				else strokePath != null && strokeStyle != null && ctx.stroke(strokePath);
			}
		}
		function doFill(fillStyle, fillPath) {
			if (fillPath instanceof Map) fillPath.forEach((fillPath, fillStyle) => {
				ctx.fillStyle = ctxFill = fillStyle;
				if (isArr(fillPath)) fillPath.forEach((path) => ctx.fill(path));
				else ctx.fill(fillPath);
			});
			else fillPath != null && fillStyle != null && ctx.fill(fillPath);
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
			} else if (fullDim <= 0) incrSpace = [0, 0];
			else {
				let minSpace = axis._space = axis.space(self, axisIdx, min, max, fullDim);
				incrSpace = findIncr(min, max, axis._incrs = axis.incrs(self, axisIdx, min, max, fullDim, minSpace), fullDim, minSpace);
			}
			return axis._found = incrSpace;
		}
		function drawOrthoLines(offs, filts, ori, side, pos0, len, width, stroke, dash, cap) {
			let offset = width % 2 / 2;
			pxAlign == 1 && offset != 0 && ctx.translate(offset, offset);
			setCtxStroke(stroke, width, dash, cap);
			ctx.beginPath();
			let x0, y0, x1, y1, pos1 = pos0 + (side == 0 || side == 3 ? -len : len);
			if (ori == 0) {
				y0 = pos0;
				y1 = pos1;
			} else {
				x0 = pos0;
				x1 = pos1;
			}
			for (let i = 0; i < offs.length; i++) if (filts[i] != null) {
				if (ori == 0) x0 = x1 = offs[i];
				else y0 = y1 = offs[i];
				ctx.moveTo(x0, y0);
				ctx.lineTo(x1, y1);
			}
			ctx.stroke();
			pxAlign == 1 && offset != 0 && ctx.translate(-offset, -offset);
		}
		function axesCalc(ori) {
			axes.forEach((axis, i) => {
				if (!axis._show || axis.side % 2 != ori) return;
				let scale = scales[axis.scale];
				let { min, max } = scale;
				let [_incr, _space] = getIncrSpace(i, min, max, ori == 0 ? plotWidCss : plotHgtCss);
				if (_space == 0) {
					axis._splits = axis._values = [];
					axis._rotate = 0;
					return;
				}
				let rangedY = scale._rawY != null && scale.axis == i;
				let forceMin = scale.distr == 2 || rangedY;
				let _splits = axis._splits = rangedY && scale._rangeY.count == 1 ? [min, max] : axis.splits(self, i, min, max, _incr, _space, forceMin);
				let splits = scale.distr == 2 ? _splits.map((i) => data0[i]) : _splits;
				let incr = scale.distr == 2 ? data0[_splits[1]] - data0[_splits[0]] : _incr;
				let values = axis._values = axis.values(self, axis.filter(self, splits, i, _space, incr), i, _space, incr);
				axis._rotate = axis.side == 2 ? axis.rotate(self, values, i, _space) : 0;
			});
		}
		function drawAxesGrid() {
			for (let i = 0; i < axes.length; i++) {
				let axis = axes[i];
				if (!axis.show || !axis._show) continue;
				let side = axis.side;
				let ori = side % 2;
				let x, y;
				let fillStyle = axis.stroke(self, i);
				let shiftDir = side == 0 || side == 3 ? -1 : 1;
				let [_incr, _space] = axis._found;
				if (axis.label != null) {
					let shiftAmt = axis.labelGap * shiftDir;
					let baseLpos = round((axis._lpos + shiftAmt) * pxRatio$1);
					setFontStyle(axis.labelFont[0], fillStyle, "center", side == 2 ? "top" : BOTTOM);
					ctx.save();
					if (ori == 1) {
						x = y = 0;
						ctx.translate(baseLpos, round(plotTop + plotHgt / 2));
						ctx.rotate((side == 3 ? -PI : PI) / 2);
					} else {
						x = round(plotLft + plotWid / 2);
						y = baseLpos;
					}
					let _label = isFn(axis.label) ? axis.label(self, i, _incr, _space) : axis.label;
					ctx.fillText(_label, x, y);
					ctx.restore();
				}
				if (_space == 0) continue;
				let scale = scales[axis.scale];
				let plotDim = ori == 0 ? plotWid : plotHgt;
				let plotOff = ori == 0 ? plotLft : plotTop;
				let _splits = axis._splits;
				let splits = scale.distr == 2 ? _splits.map((i) => data0[i]) : _splits;
				let incr = scale.distr == 2 ? data0[_splits[1]] - data0[_splits[0]] : _incr;
				let ticks = axis.ticks;
				let border = axis.border;
				let _tickSize = ticks.show ? ticks.size : 0;
				let tickSize = round(_tickSize * pxRatio$1);
				let axisGap = round((axis.alignTo == 2 ? axis._size - _tickSize - axis.gap : axis.gap) * pxRatio$1);
				let angle = axis._rotate * -PI / 180;
				let basePos = pxRound(axis._pos * pxRatio$1);
				let finalPos = basePos + (tickSize + axisGap) * shiftDir;
				y = ori == 0 ? finalPos : 0;
				x = ori == 1 ? finalPos : 0;
				let font = axis.font[0];
				setFontStyle(font, fillStyle, axis.align == 1 ? LEFT : axis.align == 2 ? RIGHT : angle > 0 ? LEFT : angle < 0 ? RIGHT : ori == 0 ? "center" : side == 3 ? RIGHT : LEFT, angle || ori == 1 ? "middle" : side == 2 ? "top" : BOTTOM);
				let lineHeight = axis.font[1] * axis.lineGap;
				let canOffs = _splits.map((val) => pxRound(getPos(val, scale, plotDim, plotOff)));
				let _values = axis._values;
				for (let i = 0; i < _values.length; i++) {
					let val = _values[i];
					if (val != null) {
						if (ori == 0) x = canOffs[i];
						else y = canOffs[i];
						val = "" + val;
						let _parts = val.indexOf("\n") == -1 ? [val] : val.split(/\n/gm);
						for (let j = 0; j < _parts.length; j++) {
							let text = _parts[j];
							if (angle) {
								ctx.save();
								ctx.translate(x, y + j * lineHeight);
								ctx.rotate(angle);
								ctx.fillText(text, 0, 0);
								ctx.restore();
							} else ctx.fillText(text, x, y + j * lineHeight);
						}
					}
				}
				if (ticks.show) drawOrthoLines(canOffs, ticks.filter(self, splits, i, _space, incr), ori, side, basePos, tickSize, roundDec(ticks.width * pxRatio$1, 3), ticks.stroke(self, i), ticks.dash, ticks.cap);
				let grid = axis.grid;
				if (grid.show) drawOrthoLines(canOffs, grid.filter(self, splits, i, _space, incr), ori, ori == 0 ? 2 : 1, ori == 0 ? plotTop : plotLft, ori == 0 ? plotHgt : plotWid, roundDec(grid.width * pxRatio$1, 3), grid.stroke(self, i), grid.dash, grid.cap);
				if (border.show) drawOrthoLines([basePos], [1], ori == 0 ? 1 : 0, ori == 0 ? 1 : 2, ori == 1 ? plotTop : plotLft, ori == 1 ? plotHgt : plotWid, roundDec(border.width * pxRatio$1, 3), border.stroke(self, i), border.dash, border.cap);
			}
			fire("drawAxes");
		}
		function resetScaleSeries(scaleKey) {
			redrawDirty.delete(scaleKey);
			series.forEach((s, i) => {
				if (i > 0 && s.scale == scaleKey) {
					s.min = s.max = null;
					if (s.minAbs !== void 0) s.minAbs = void 0;
				}
			});
		}
		function resetYSeries(minMax) {
			if (minMax) redrawDirty.clear();
			series.forEach((s, i) => {
				if (minMax && s.minAbs !== void 0) s.minAbs = void 0;
				if (i > 0) {
					s._paths = null;
					if (minMax) {
						s.min = null;
						s.max = null;
						if (mode == 2) s.facets.forEach((f) => {
							f.min = null;
							f.max = null;
							if (f.minAbs !== void 0) f.minAbs = void 0;
						});
					}
				}
			});
		}
		let destroyed = false;
		let queuedCommit = false;
		function syncLegend() {
			if (ready && !destroyed && shouldRenderLegend && !shouldSelectLegend) {
				shouldRenderLegend = false;
				if (showLegend && (!showStats || shouldRenderStats)) {
					shouldRenderStats = false;
					legendView.render(legend.values, focusedSeries);
					syncRect(true);
				}
				tooltipView?.render(tooltip.values, focusedSeries);
				tooltipPosition?.update();
			}
		}
		let deferHooks = false;
		let hooksQueue = [];
		function flushHooks() {
			deferHooks = false;
			for (let i = 0; i < hooksQueue.length; i++) fire(...hooksQueue[i]);
			hooksQueue.length = 0;
		}
		function commit() {
			if (!destroyed && !queuedCommit) {
				let run = queuedCommit = () => {
					if (queuedCommit == run) _commit();
				};
				queueMicrotask(run);
			}
		}
		function batch(fn, _deferHooks = false) {
			queuedCommit = true;
			deferHooks = _deferHooks;
			fn(self);
			_commit();
			if (_deferHooks && hooksQueue.length > 0) queueMicrotask(flushHooks);
		}
		self.batch = batch;
		function setCanvasSize() {
			setStylePx(wrap, WIDTH, fullWidCss);
			setStylePx(wrap, HEIGHT, fullHgtCss);
			let width = round(fullWidCss * pxRatio$1);
			let height = round(fullHgtCss * pxRatio$1);
			canToCssX = fullWidCss / width;
			canToCssY = fullHgtCss / height;
			let reset = !ready || can.width != width || can.height != height;
			if (!ready || can.width != width) can.width = width;
			if (!ready || can.height != height) can.height = height;
			if (reset) {
				ctxStroke = ctxFill = ctxWidth = ctxJoin = ctxCap = ctxFont = ctxAlign = ctxBaseline = ctxDash = null;
				ctxAlpha = 1;
			}
		}
		function applyLayout(plotChanged, axesChanged) {
			if (plotChanged) {
				if (under != null) {
					setStylePx(under, LEFT, plotLftCss);
					setStylePx(under, "top", plotTopCss);
					setStylePx(under, WIDTH, plotWidCss);
					setStylePx(under, HEIGHT, plotHgtCss);
				}
				if (over != null) {
					setStylePx(over, LEFT, plotLftCss);
					setStylePx(over, "top", plotTopCss);
					setStylePx(over, WIDTH, plotWidCss);
					setStylePx(over, HEIGHT, plotHgtCss);
				}
			}
			if (plotChanged || axesChanged) axes.forEach(({ _el, _show, _size, _pos, side }) => {
				if (_el != null) {
					if (_show) {
						let posOffset = side == 3 || side == 0 ? _size : 0;
						let isVt = side % 2 == 1;
						setStylePx(_el, isVt ? "left" : "top", _pos - posOffset);
						setStylePx(_el, isVt ? "width" : "height", _size);
						setStylePx(_el, isVt ? "top" : "left", isVt ? plotTopCss : plotLftCss);
						setStylePx(_el, isVt ? "height" : "width", isVt ? plotHgtCss : plotWidCss);
						remClass(_el, OFF);
					} else addClass(_el, OFF);
				}
			});
			syncRect(true);
		}
		function resizeOverlays(prevWidth, prevHeight) {
			let pctWid = plotWidCss / prevWidth;
			let pctHgt = plotHgtCss / prevHeight;
			if ((showCursor || cursorDists != null || hasLegendSelection()) && !shouldSetCursor && cursor.left >= 0) {
				cursor.left *= pctWid;
				cursor.top *= pctHgt;
				if (cursorDists != null || hasLegendSelection()) {
					mouseLeft1 = cursor.left;
					mouseTop1 = cursor.top;
					shouldSetCursor = shouldSetLegend = true;
				} else {
					vCursor && elTrans(vCursor, round(cursor.left), 0, plotWidCss, plotHgtCss);
					hCursor && elTrans(hCursor, 0, round(cursor.top), plotWidCss, plotHgtCss);
					for (let i = 0; i < cursorPts.length; i++) if (cursorPts[i] != null) {
						cursorPtsLft[i] *= pctWid;
						cursorPtsTop[i] *= pctHgt;
					}
				}
			}
			if (select.show && !shouldSetSelect && select.left >= 0 && select.width > 0) {
				select.left *= pctWid;
				select.width *= pctWid;
				select.top *= pctHgt;
				select.height *= pctHgt;
				for (let prop in _hideProps) setStylePx(selectDiv, prop, select[prop]);
			}
		}
		function _commit() {
			if (destroyed) return;
			if (stackDirty.size > 0) {
				stackDirty.forEach(resetScaleSeries);
				setScaleData(self.data);
				resetYSeries(false);
				shouldSetScales = true;
			}
			if (shouldSetScales) {
				shouldRefreshStats = showStats;
				setScales();
				shouldSetScales = false;
				viaAutoScaleX = false;
			}
			if (shouldLayout) {
				let changedY = updateLayout();
				shouldLayout = false;
				for (let k of changedY) fire("setScale", k);
				shouldRefreshStats = shouldRefreshStats || showStats && changedY.length > 0;
			}
			if (shouldSetLegendColumns) {
				setLegendColumns();
				shouldSetLegend = true;
			}
			if (shouldRefreshStats) refreshStats();
			let didDraw = fullWidCss > 0 && fullHgtCss > 0;
			if (didDraw) {
				ctx.clearRect(0, 0, can.width, can.height);
				fire("drawClear");
				drawOrder.forEach((fn) => fn());
				fire("draw");
			}
			if (select.show && shouldSetSelect) {
				setSelect(select);
				shouldSetSelect = false;
			}
			queuedCommit = false;
			if ((showCursor || cursorDists != null || hasLegendSelection()) && shouldSetCursor) updateCursor(null, true, false);
			else if (shouldSetLegend && (showLive || hasLegendSelection())) setLegend();
			else {
				const selectionChanged = selectLegend() && hasLegendSelection();
				syncLegend();
				if (selectionChanged) fire("setLegend");
			}
			tooltipPosition?.update();
			if (stackDirty.size > 0 || shouldSetScales || shouldLayout || shouldRefreshStats || shouldSetLegendColumns) commit();
			if (!usePathCache) clearPathCache();
			if (!useDataCache && didDraw && !queuedCommit && stackDirty.size == 0 && !shouldSetScales && !shouldLayout) clearDataCache();
			if (!ready && !queuedCommit) {
				ready = true;
				self.status = 1;
				syncLegend();
				if (!destroyed) fire("ready");
			}
		}
		function clearPathCache() {
			series.forEach((s, i) => {
				if (i > 0) {
					s._paths = null;
					s.points._paths = null;
				}
			});
		}
		function clearDispCache() {
			series.forEach((s) => {
				s._disp = null;
			});
		}
		function clearDataCache() {
			clearDispCache();
			let emptyData = (src) => mode == 1 ? src.map(() => []) : src.map((facets) => facets == null ? facets : facets.map(() => []));
			self.data = self._data = data = emptyData(self.data ?? EMPTY_ARR);
			self._base = null;
			data0 = mode == 1 ? data[0] : null;
			dataLen = 0;
			if (opts.data != null) opts.data = emptyData(opts.data);
		}
		self.clearCache = (targets) => {
			if (targets == null || targets.paths === true || targets.data === true) invalidateBandGroups();
			if (targets == null || targets.paths === true) clearPathCache();
			if (targets == null || targets.data === true) clearDataCache();
		};
		self.redraw = (rebuildPaths, recalcAxes) => {
			shouldLayout = shouldLayout || recalcAxes || false;
			if (rebuildPaths !== false) {
				let ranged = scaleX._rawY != null;
				pendScales[xScaleKey] ??= {
					min: ranged ? null : scaleX.min,
					max: ranged ? null : scaleX.max,
					redraw: true
				};
				shouldSetScales = true;
			}
			commit();
		};
		function setRange(key, min, max) {
			let sc = scales[key];
			if (sc.from == null) {
				if (isFullyExplicit(min, max)) {
					if (min > max) return;
					if (dataLen > 1 && max - min < 1e-16) return;
				}
				if (key == xScaleKey && sc.distr == 2 && dataLen > 0) {
					if (min != null) min = closestIdx(min, data[0]);
					if (max != null) max = closestIdx(max, data[0]);
					if (min != null && min == max) max++;
				}
				pendScales[key] = {
					min,
					max
				};
				shouldSetScales = true;
				commit();
			}
		}
		self.setRange = setRange;
		function setScale(key, opts) {
			setRange(key, opts.min, opts.max);
		}
		self.setScale = setScale;
		let xCursor;
		let yCursor;
		let vCursor;
		let hCursor;
		let rawMouseLeft0;
		let rawMouseTop0;
		let mouseLeft0;
		let mouseTop0;
		let rawMouseLeft1;
		let rawMouseTop1;
		let mouseLeft1;
		let mouseTop1;
		let dragging = false;
		const drag = cursor.drag;
		drag.setRange = drag.setScale ?? drag.setRange;
		let dragX = drag.x;
		let dragY = drag.y;
		if (showCursor) {
			if (cursor.x) xCursor = placeDiv(CURSOR_X, over);
			if (cursor.y) yCursor = placeDiv(CURSOR_Y, over);
			if (scaleX.ori == 0) {
				vCursor = xCursor;
				hCursor = yCursor;
			} else {
				vCursor = yCursor;
				hCursor = xCursor;
			}
		}
		mouseLeft1 = cursor.left;
		mouseTop1 = cursor.top;
		const select = self.select = assign({
			show: true,
			over: true,
			left: 0,
			width: 0,
			top: 0,
			height: 0
		}, opts.select);
		const selectParent = select.over ? over : under;
		select.show = selectParent != null && select.show;
		const selectDiv = select.show ? placeDiv(SELECT, selectParent) : null;
		function setSelect(opts, _fire) {
			if (select.show) {
				for (let prop in opts) {
					select[prop] = opts[prop];
					if (prop in _hideProps) setStylePx(selectDiv, prop, opts[prop]);
				}
				_fire !== false && fire("setSelect");
			}
		}
		self.setSelect = setSelect;
		function hideCursorPoint(i) {
			if (!series[i].show && showCursor) {
				let pt = cursorOnePt ? cursorPts[0] : cursorPts[i];
				pt != null && elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
			}
		}
		function setSeriesShow(i, show) {
			let s = series[i];
			let showChanged = s.show != show;
			if ((showLegend || showTooltip) && showChanged) {
				shouldRenderLegend = true;
				shouldRenderStats = showStats;
			}
			s.show = show;
			hideCursorPoint(i);
			if (showChanged) {
				shouldSelectLegend = shouldSelectLegend || hasLegendSelection();
				if (cursorDists != null && !show) cursorDists[i] = inf;
				if (cursorDists != null || hasLegendSelection()) shouldSetCursor = cursor.left >= 0;
			}
			if (showChanged && stackedSeries[i]) stackDirty.add(s.scale);
			if (mode == 2) {
				setRange(s.facets[0].scale, null, null);
				setRange(s.facets[1].scale, null, null);
			} else setRange(s.scale, null, null);
			commit();
		}
		function setSeries(i, opts, _fire, _pub) {
			shouldRefreshStats = showStats;
			showStats && commit();
			if (opts.focus != null) setFocus(i);
			if (opts.show != null) {
				if (i == null) series.forEach((s, si) => {
					if (si > 0) setSeriesShow(si, opts.show);
				});
				else {
					let si = +i;
					if (si > 0 && si < series.length && si % 1 == 0) setSeriesShow(si, opts.show);
				}
			}
			syncLegend();
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
			if (bi == null) bands.length = 0;
			else bands.splice(bi, 1);
			invalidateBandGroups();
		}
		self.addBand = addBand;
		self.setBand = setBand;
		self.delBand = delBand;
		function setAlpha(i, value) {
			series[i].alpha = value;
			if (showCursor && cursorPts[i] != null) cursorPts[i].style.opacity = value;
		}
		let focusedSeries = null;
		const FOCUS_TRUE = { focus: true };
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
				focusedSeries = focused;
				series.forEach(setSeriesFocus);
				shouldSelectLegend = shouldSelectLegend || hasLegendSelection();
				shouldRenderLegend = showLegend || showTooltip;
				shouldRenderStats = showStats;
				commit();
				return true;
			}
			return false;
		}
		function posToVal(pos, scale, can) {
			let sc = scales[scale];
			if (can) pos -= sc.ori == 1 ? plotTop : plotLft;
			let dim = can ? plotWid : plotWidCss;
			if (sc.ori == 1) {
				dim = can ? plotHgt : plotHgtCss;
				pos = dim - pos;
			}
			if (sc.dir == -1) pos = dim - pos;
			let _min = sc._min, _max = sc._max, pct = pos / dim;
			let sv = _min + (_max - _min) * pct;
			let distr = sc.distr;
			return distr == 3 ? pow(10, sv) : distr == 4 ? sinh(sv, sc._asinh) : distr == 100 ? sc.bwd(sv) : sv;
		}
		function closestIdxFromXpos(pos, can) {
			return closestIdx(posToVal(pos, xScaleKey, can), data[0], i0, i1);
		}
		self.valToIdx = (val) => closestIdx(val, data[0]);
		self.posToIdx = closestIdxFromXpos;
		self.posToVal = posToVal;
		self.valToPos = (val, scale, can) => scales[scale].ori == 0 ? getHPos(val, scales[scale], can ? plotWid : plotWidCss, can ? plotLft : 0) : getVPos(val, scales[scale], can ? plotHgt : plotHgtCss, can ? plotTop : 0);
		self.setCursor = (opts, _fire, _pub) => {
			mouseLeft1 = opts.left;
			mouseTop1 = opts.top;
			updateCursor(null, _fire, _pub);
		};
		function setSelH(off, dim) {
			setStylePx(selectDiv, LEFT, select.left = off);
			setStylePx(selectDiv, WIDTH, select.width = dim);
		}
		function setSelV(off, dim) {
			setStylePx(selectDiv, "top", select.top = off);
			setStylePx(selectDiv, HEIGHT, select.height = dim);
		}
		let setSelX = scaleX.ori == 0 ? setSelH : setSelV;
		let setSelY = scaleX.ori == 1 ? setSelH : setSelV;
		function setLegend(opts, _fire) {
			if (shouldSetLegendColumns) setLegendColumns();
			if (opts != null) {
				if (opts.idxs) opts.idxs.forEach((idx, i) => activeIdxs[i] = idx);
				else if (!isUndef(opts.idx)) activeIdxs.fill(opts.idx);
				if (live) liveLegend.idx = activeIdxs[0];
			}
			if (showLive) {
				let changed = false;
				for (let sidx = 0; sidx < series.length; sidx++) if (sidx > 0 || mode == 1 && !multiValLegend) changed = setLegendValues(sidx, activeIdxs[sidx]) || changed;
				shouldRenderLegend = shouldRenderLegend || changed;
			}
			selectLegend(hasLegendSelection() || opts != null && legendCandidates != null);
			if (opts != null && showStats) selectLegend(true, true);
			shouldSetLegend = false;
			syncLegend();
			tooltipPosition?.update();
			_fire !== false && fire("setLegend");
		}
		self.setLegend = setLegend;
		function setLegendValues(sidx, idx) {
			let s = series[sidx];
			let src = self.data[sidx];
			if (multiValLegend) {
				let vals = s.values(self, sidx, idx) ?? NULL_LEGEND_VALUES;
				liveLegend.values[sidx] = showTooltip ? assign({}, vals) : vals;
				let prev = legendValuesPrev[sidx] ??= [];
				let changed = false;
				let i = 0;
				for (let key in legendCols) {
					let val = vals[key];
					changed = val !== prev[i] || changed;
					prev[i++] = val;
				}
				return changed;
			} else {
				let val = s.value(self, idx == null ? null : src[idx], sidx, idx) ?? "--";
				let vals = liveLegend.values[sidx] ??= {};
				let changed = val !== vals._;
				vals._ = val;
				return changed;
			}
		}
		function setCursorPointPos(pt, si, left, top, width, height) {
			let s = series[si];
			if (cursor.left < 0 || s == null || !s.show) {
				elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
				return;
			}
			if (points.bbox != null) {
				let off = width <= 0 || height <= 0 || left + width <= 0 || top + height <= 0 || left >= plotWidCss || top >= plotHgtCss;
				elTrans(pt, left, top, plotWidCss, plotHgtCss, off);
				return;
			}
			let idx = activeIdxs[si];
			let sx, sy, xVal, yVal;
			if (mode == 1) {
				sx = scaleX;
				sy = scales[s.scale];
				xVal = data[0]?.[idx];
				yVal = data[si]?.[idx];
			} else {
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
			let off = left < -1e-9 || top < -1e-9 || left > plotWidCss + 1e-9 || top > plotHgtCss + 1e-9;
			if (!off) {
				let sh, sv, hVal, vVal;
				if (sx.ori == 0) {
					sh = sx;
					sv = sy;
					hVal = xVal;
					vVal = yVal;
				} else {
					sh = sy;
					sv = sx;
					hVal = yVal;
					vVal = xVal;
				}
				let x = pointPos(hVal, sh, plotWid, plotLft, getHPos, s.pxRound);
				let y = pointPos(vVal, sv, plotHgt, plotTop, getVPos, s.pxRound);
				let sp = s.points;
				let offset = pxOffset(roundDec((sp._paths?._width ?? sp.width) * pxRatio$1, 3), sp.pxAlign);
				left = (x + offset) * canToCssX - plotLftCss;
				top = (y + offset) * canToCssY - plotTopCss;
			} else {
				left = ceil(left);
				top = ceil(top);
			}
			elTrans(pt, left, top, plotWidCss, plotHgtCss, off);
		}
		function syncCursorPoints() {
			cursorPts.forEach((pt, i) => {
				if (pt != null && cursorPtsLft[i] != null) setCursorPointPos(pt, cursorOnePt ? cursorPtSeries : i, cursorPtsLft[i], cursorPtsTop[i], cursorPtsWid[i], cursorPtsHgt[i]);
			});
		}
		function updateCursor(src, _fire, _pub) {
			const forceCursor = shouldSetCursor;
			shouldSetCursor = false;
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
			let noDataInRange = i0 > i1;
			let closestDist = inf;
			let closestSeries = null;
			let cursorHidden = mouseLeft1 < 0 || dataLen == 0 || noDataInRange;
			cursorDists?.fill(inf);
			let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss;
			let yDim = scaleX.ori == 1 ? plotWidCss : plotHgtCss;
			if (cursorHidden) {
				idx = cursor.idx = null;
				for (let i = 0; i < series.length; i++) {
					let pt = cursorPts[i];
					pt != null && elTrans(pt, -10, -10, plotWidCss, plotHgtCss);
				}
				if (cursorOnePt) cursorPtSeries = null;
				if (live || cursorDists != null || hasLegendSelection()) {
					activeIdxs.fill(idx);
					shouldSetLegend = true;
				}
			} else {
				let mouseXPos, valAtPosX, xPos;
				if (mode == 1) {
					mouseXPos = scaleX.ori == 0 ? mouseLeft1 : mouseTop1;
					valAtPosX = posToVal(mouseXPos, xScaleKey);
					idx = cursor.idx = closestIdx(valAtPosX, data[0], i0, i1);
					xPos = valToPosX(data[0][idx], scaleX, xDim, 0);
				}
				let _ptLft = -10;
				let _ptTop = -10;
				let _ptWid = 0;
				let _ptHgt = 0;
				let _centered = true;
				let _ptFill = "";
				let _ptStroke = "";
				for (let i = mode == 2 ? 1 : 0; i < series.length; i++) {
					let s = series[i];
					let idx1 = activeIdxs[i];
					let yVal1 = idx1 == null ? null : mode == 1 ? data[i][idx1] : data[i][1][idx1];
					let idx2 = cursor.dataIdx(self, i, idx, valAtPosX);
					let yVal2 = idx2 == null ? null : mode == 1 ? data[i][idx2] : data[i][1][idx2];
					shouldSetLegend = shouldSetLegend || yVal2 != yVal1 || idx2 != idx1;
					activeIdxs[i] = idx2;
					if (i > 0 && s.show) {
						let xPos2 = idx2 == null ? -10 : idx2 == idx ? xPos : valToPosX(mode == 1 ? data[0][idx2] : data[i][0][idx2], scaleX, xDim, 0);
						let yPos = yVal2 == null ? -10 : valToPosY(yVal2, mode == 1 ? scales[s.scale] : scales[s.facets[1].scale], yDim, 0);
						if ((cursorFocus || cursorDists != null) && yVal2 != null) {
							let mouseYPos = scaleX.ori == 1 ? mouseLeft1 : mouseTop1;
							let dist = abs(focus.dist(self, i, idx2, yPos, mouseYPos));
							if (cursorDists != null) cursorDists[i] = dist >= 0 ? dist : inf;
							if (cursorFocus && dist < closestDist) {
								let bias = focus.bias;
								if (bias != 0) {
									let mouseYVal = posToVal(mouseYPos, s.scale);
									let seriesYValSign = yVal2 >= 0 ? 1 : -1;
									let mouseYValSign = mouseYVal >= 0 ? 1 : -1;
									if (mouseYValSign == seriesYValSign && (mouseYValSign == 1 ? bias == 1 ? yVal2 >= mouseYVal : yVal2 <= mouseYVal : bias == 1 ? yVal2 <= mouseYVal : yVal2 >= mouseYVal)) {
										closestDist = dist;
										closestSeries = i;
									}
								} else {
									closestDist = dist;
									closestSeries = i;
								}
							}
						}
						if (shouldSetLegend || cursorOnePt || points.bbox != null) {
							let hPos, vPos;
							if (scaleX.ori == 0) {
								hPos = xPos2;
								vPos = yPos;
							} else {
								hPos = yPos;
								vPos = xPos2;
							}
							let ptWid, ptHgt, ptLft, ptTop, ptStroke, ptFill, centered = true, getBBox = points.bbox;
							if (getBBox != null) {
								centered = false;
								let bbox = getBBox(self, i);
								ptLft = bbox.left;
								ptTop = bbox.top;
								ptWid = bbox.width;
								ptHgt = bbox.height;
							} else {
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
							} else {
								let pt = cursorPts[i];
								if (pt != null) {
									cursorPtsLft[i] = ptLft;
									cursorPtsTop[i] = ptTop;
									cursorPtsWid[i] = ptWid;
									cursorPtsHgt[i] = ptHgt;
									elSize(pt, ptWid, ptHgt, centered);
									elColor(pt, ptFill, ptStroke);
									setCursorPointPos(pt, i, ptLft, ptTop, ptWid, ptHgt);
								}
							}
						}
					}
				}
				if (cursorOnePt) {
					let pointSeries = closestDist <= focus.prox ? closestSeries : null;
					if (forceCursor || shouldSetLegend || pointSeries != cursorPtSeries || points.bbox != null) {
						let pt = cursorPts[0];
						if (pt != null) {
							cursorPtsLft[0] = _ptLft;
							cursorPtsTop[0] = _ptTop;
							cursorPtsWid[0] = _ptWid;
							cursorPtsHgt[0] = _ptHgt;
							elSize(pt, _ptWid, _ptHgt, _centered);
							elColor(pt, _ptFill, _ptStroke);
							cursorPtSeries = pointSeries;
							if (cursorPtMembers?.length) (cursorPtMembers[cursorPtSeries] ? remClass : addClass)(pt, LEGEND_EXCLUDE);
							setCursorPointPos(pt, cursorPtSeries, _ptLft, _ptTop, _ptWid, _ptHgt);
						}
					}
				}
			}
			if (select.show && dragging) {
				if (src != null) {
					let [xKey, yKey] = syncOpts.scales;
					let [matchXKeys, matchYKeys] = syncOpts.match;
					let [xKeySrc, yKeySrc] = src.cursor.sync.scales;
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
							} else {
								sOff = top;
								sDim = height;
							}
							sc = scales[xKey];
							a = valToPosX(sPosToVal(sOff, xKeySrc), sc, xDim, 0);
							b = valToPosX(sPosToVal(sOff + sDim, xKeySrc), sc, xDim, 0);
							setSelX(min(a, b), abs(b - a));
						} else setSelX(0, xDim);
						if (matchingY && dragY) {
							if (sori == 1) {
								sOff = left;
								sDim = width;
							} else {
								sOff = top;
								sDim = height;
							}
							sc = scales[yKey];
							a = valToPosY(sPosToVal(sOff, yKeySrc), sc, yDim, 0);
							b = valToPosY(sPosToVal(sOff + sDim, yKeySrc), sc, yDim, 0);
							setSelY(min(a, b), abs(b - a));
						} else setSelY(0, yDim);
					} else hideSelect();
				} else {
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
						if (dragX && dragY) {
							dragX = rawDX >= uni;
							dragY = rawDY >= uni;
							if (!dragX && !dragY) {
								if (rawDY > rawDX) dragY = true;
								else dragX = true;
							}
						}
					} else if (drag.x && drag.y && (dragX || dragY)) dragX = dragY = true;
					let p0, p1;
					if (dragX) {
						if (scaleX.ori == 0) {
							p0 = mouseLeft0;
							p1 = mouseLeft1;
						} else {
							p0 = mouseTop0;
							p1 = mouseTop1;
						}
						setSelX(min(p0, p1), abs(p1 - p0));
						if (!dragY) setSelY(0, yDim);
					}
					if (dragY) {
						if (scaleX.ori == 1) {
							p0 = mouseLeft0;
							p1 = mouseLeft1;
						} else {
							p0 = mouseTop0;
							p1 = mouseTop1;
						}
						setSelY(min(p0, p1), abs(p1 - p0));
						if (!dragX) setSelX(0, xDim);
					}
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
				if (live) liveLegend.idx = idx;
				setLegend();
			} else {
				const selectionChanged = selectLegend(hasLegendSelection());
				syncLegend();
				if (selectionChanged) fire("setLegend");
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
				if (src == null && _pub && syncOpts.setSeries) pubSync("setSeries", self, focusIdx, FOCUS_TRUE);
			}
			tooltipPosition?.update();
			_fire !== false && fire("setCursor");
		}
		let rect = null;
		Object.defineProperty(self, "rect", { get() {
			if (rect == null) syncRect(false);
			return rect;
		} });
		function syncRect(defer = false) {
			if (over == null) return;
			if (defer) rect = null;
			else {
				rect = over.getBoundingClientRect();
				tooltipPosition?.update(rect);
				fire("syncRect", rect);
			}
		}
		function mouseMove(e, src, _l, _t, _w, _h, _i) {
			if (cursor._lock) return;
			if (dragging && e != null && e.movementX == 0 && e.movementY == 0) return;
			cacheMouse(e, src, _l, _t, _w, _h, _i, false, e != null);
			if (e != null) updateCursor(null, true, true);
			else updateCursor(src, true, false);
		}
		function cacheMouse(e, src, _l, _t, _w, _h, _i, initial, snap) {
			if (rect == null) syncRect(false);
			setCursorEvent(e);
			if (e != null) {
				_l = e.clientX - rect.left;
				_t = e.clientY - rect.top;
			} else {
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
				let xDim = scaleX.ori == 0 ? plotWidCss : plotHgtCss, yDim = scaleX.ori == 1 ? plotWidCss : plotHgtCss, _xDim = rotSrc ? _h : _w, _yDim = rotSrc ? _w : _h, _xPos = rotSrc ? _t : _l, _yPos = rotSrc ? _l : _t;
				if (xKeySrc != null) _l = matchXKeys(xKey, xKeySrc) ? getPos(xValSrc, scales[xKey], xDim, 0) : -10;
				else _l = xDim * (_xPos / _xDim);
				if (yKeySrc != null) _t = matchYKeys(yKey, yKeySrc) ? getPos(yValSrc, scales[yKey], yDim, 0) : -10;
				else _t = yDim * (_yPos / _yDim);
				if (scaleX.ori == 1) {
					let __l = _l;
					_l = _t;
					_t = __l;
				}
			}
			if (snap && (src == null || src.cursor.event.type == "mousemove")) {
				if (_l <= 1 || _l >= plotWidCss - 1) _l = _l <= 1 ? 0 : plotWidCss;
				if (_t <= 1 || _t >= plotHgtCss - 1) _t = _t <= 1 ? 0 : plotHgtCss;
			}
			if (initial) {
				rawMouseLeft0 = _l;
				rawMouseTop0 = _t;
				[mouseLeft0, mouseTop0] = cursor.move(self, _l, _t);
			} else {
				mouseLeft1 = _l;
				mouseTop1 = _t;
			}
		}
		const _hideProps = {
			width: 0,
			height: 0,
			left: 0,
			top: 0
		};
		function hideSelect() {
			setSelect(_hideProps, false);
		}
		let downSelectLeft;
		let downSelectTop;
		let downSelectWidth;
		let downSelectHeight;
		function mouseDown(e, src, _l, _t, _w, _h, _i) {
			if (e != null) mouseOwner = self.uid;
			dragging = true;
			dragX = dragY = drag._x = drag._y = false;
			cacheMouse(e, src, _l, _t, _w, _h, _i, true, false);
			if (e != null) {
				if ((drag.x || drag.y) && !globalMouseMove) globalMouseMove = onMouse(mousemove, doc, mouseMove, false);
				onMouse(mouseup, doc, mouseUp, false);
				pubSync(mousedown, self, mouseLeft0, mouseTop0, plotWidCss, plotHgtCss, null);
			}
			let { left, top, width, height } = select;
			downSelectLeft = left;
			downSelectTop = top;
			downSelectWidth = width;
			downSelectHeight = height;
		}
		function setDragRange(key, min, max) {
			if (min > max) [min, max] = [max, min];
			if (isFn(drag.setRange)) {
				let range = drag.setRange(self, key, min, max);
				if (range != null) setRange(key, range[0], range[1]);
			} else setRange(key, min, max);
		}
		function mouseUp(e, src, _l, _t, _w, _h, _i) {
			stopGlobalMouseMove();
			dragging = drag._x = drag._y = false;
			cacheMouse(e, src, _l, _t, _w, _h, _i, false, true);
			let hideCursor = e != null && (e.clientX < rect.left || e.clientX > rect.left + plotWidCss || e.clientY < rect.top || e.clientY > rect.top + plotHgtCss);
			let { left, top, width, height } = select;
			let hasSelect = width > 0 || height > 0;
			let chgSelect = downSelectLeft != left || downSelectTop != top || downSelectWidth != width || downSelectHeight != height;
			hasSelect && chgSelect && setSelect(select);
			if (drag.setRange && hasSelect && chgSelect) {
				let xOff = left, xDim = width, yOff = top, yDim = height;
				if (scaleX.ori == 1) xOff = top, xDim = height, yOff = left, yDim = width;
				if (dragX) setDragRange(xScaleKey, posToVal(xOff, xScaleKey), posToVal(xOff + xDim, xScaleKey));
				if (dragY) for (let k in scales) {
					let sc = scales[k];
					if (k != xScaleKey && sc.from == null && sc.min != Infinity) setDragRange(k, posToVal(yOff + yDim, k), posToVal(yOff, k));
				}
				hideSelect();
			} else if (cursor.lock) {
				cursor._lock = !cursor._lock;
				updateCursor(src, true, e != null);
			}
			if (e != null) {
				offMouse(mouseup, doc, mouseUp);
				pubSync(mouseup, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
			}
			if (hideCursor && !cursor._lock) {
				mouseLeft1 = mouseTop1 = -10;
				activeIdxs.fill(null);
				updateCursor(null, true, true);
			}
			if (mouseOwner == self.uid) mouseOwner = null;
		}
		function mouseLeave(e, src, _l, _t, _w, _h, _i) {
			if (cursor._lock) return;
			if (globalMouseMove) {
				cacheMouse(e, src, _l, _t, _w, _h, _i, false, true);
				updateCursor(null, true, true);
				return;
			}
			setCursorEvent(e);
			let _dragging = dragging;
			if (dragging) {
				let snapH = true;
				let snapV = true;
				let snapProx = 10;
				let dragH, dragV;
				if (scaleX.ori == 0) {
					dragH = dragX;
					dragV = dragY;
				} else {
					dragH = dragY;
					dragV = dragX;
				}
				if (dragH && dragV) {
					snapH = mouseLeft1 <= snapProx || mouseLeft1 >= plotWidCss - snapProx;
					snapV = mouseTop1 <= snapProx || mouseTop1 >= plotHgtCss - snapProx;
				}
				if (dragH && snapH) mouseLeft1 = mouseLeft1 < mouseLeft0 ? 0 : plotWidCss;
				if (dragV && snapV) mouseTop1 = mouseTop1 < mouseTop0 ? 0 : plotHgtCss;
				updateCursor(null, true, true);
				dragging = false;
			}
			mouseLeft1 = -10;
			mouseTop1 = -10;
			activeIdxs.fill(null);
			updateCursor(null, true, true);
			if (_dragging) dragging = _dragging;
		}
		function dblClick(e, src, _l, _t, _w, _h, _i) {
			if (cursor._lock) return;
			setCursorEvent(e);
			autoScaleX();
			hideSelect();
			if (e != null) pubSync(dblclick, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
		}
		function onDppxChange() {
			setPxRatio();
		}
		on(dppxchange, win, onDppxChange);
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
			on("click", wrap, (e) => {
				if (e.target === over) (mouseLeft1 != mouseLeft0 || mouseTop1 != mouseTop0) && drag.click(self, e);
			}, true);
			onMouse(mousedown, over, mouseDown);
			onMouse(mousemove, over, (e) => {
				if (!globalMouseMove) mouseMove(e);
			});
			onMouse(mouseenter, over, (e) => {
				setCursorEvent(e);
				syncRect(false);
			});
			onMouse(mouseleave, over, mouseLeave);
			onMouse(dblclick, over, dblClick);
			cursorPlots.add(self);
			self.syncRect = syncRect;
		}
		const hooks = self.hooks = opts.hooks || {};
		function fire(evName, a1, a2) {
			if (deferHooks) hooksQueue.push([
				evName,
				a1,
				a2
			]);
			else if (evName in hooks) hooks[evName].forEach((fn) => fn.call(null, self, a1, a2));
		}
		(opts.plugins || []).forEach((p) => {
			for (let evName in p.hooks) hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]);
		});
		const seriesIdxMatcher = (self, src, srcSeriesIdx) => srcSeriesIdx;
		const syncOpts = assign({
			key: null,
			setSeries: false,
			filters: {
				pub: retTrue,
				sub: retTrue
			},
			scales: [xScaleKey, series[1] ? series[1].scale : null],
			match: [
				retEq,
				retEq,
				seriesIdxMatcher
			],
			values: [null, null]
		}, cursor.sync);
		if (syncOpts.match.length == 2) syncOpts.match.push(seriesIdxMatcher);
		cursor.sync = syncOpts;
		const syncKey = syncOpts.key;
		const sync = _sync(syncKey);
		function pubSync(type, src, x, y, w, h, i) {
			if (syncOpts.filters.pub(type, src, x, y, w, h, i)) sync.pub(type, src, x, y, w, h, i);
		}
		sync.sub(self);
		function pub(type, src, x, y, w, h, i) {
			if (syncOpts.filters.sub(type, src, x, y, w, h, i)) events[type](null, src, x, y, w, h, i);
		}
		self.pub = pub;
		function destroy() {
			if (destroyed) return;
			destroyed = true;
			queuedCommit = false;
			sync.unsub(self);
			cursorPlots.delete(self);
			stopGlobalMouseMove();
			offMouse(null, doc);
			if (mouseOwner == self.uid) mouseOwner = null;
			off(dppxchange, win, onDppxChange);
			root.remove();
			legendView?.destroy();
			tooltipPosition?.destroy();
			tooltipView?.destroy();
			clearPathCache();
			clearDataCache();
			fire("destroy");
		}
		self.destroy = destroy;
		function _init() {
			fire("init", opts, data);
			setData(data || opts.data, false);
			if (pendScales[xScaleKey]) setScale(xScaleKey, pendScales[xScaleKey]);
			else autoScaleX();
			shouldSetSelect = select.show && (select.width > 0 || select.height > 0);
			shouldSetCursor = shouldSetLegend = true;
			setSize(opts);
		}
		series.forEach(initSeries);
		legend.values.length = series.length;
		legend.values.fill(null);
		if (showTooltip) {
			tooltip.values.length = series.length;
			tooltip.values.fill(null);
		}
		if (showLegend) legendView = createLegend(self, root, {
			legend,
			side: legend.side,
			series,
			columns: showStats ? statsCols : legendCols,
			multi: showStats ? multiValStats : multiValLegend,
			mode,
			cursorFocus,
			bind: cursor.bind,
			emit: handleLegendEvent
		});
		if (showTooltip) {
			tooltipPosition = createTooltip(self, tooltip);
			tooltipView = createLegend(self, over, {
				side: 2,
				legend: {
					...tooltip,
					live: true,
					mount: (u, table) => {
						tooltipPosition.mount(u, table);
						tooltip.mount(u, table);
					}
				},
				series,
				columns: legendCols,
				multi: multiValLegend,
				mode,
				interactive: false
			});
		}
		series.forEach((s, i) => {
			fire("addSeries", i);
		});
		axes.forEach(initAxis);
		if (then) {
			if (then instanceof HTMLElement) {
				then.appendChild(root);
				_init();
			} else then(self, _init);
		} else _init();
		return self;
	}
	uPlot.assign = assign;
	uPlot.fmtNum = fmtNum;
	uPlot.numDec = numDec;
	uPlot.rangeNum = rangeNum;
	uPlot.rangeLog = rangeLog;
	uPlot.rangeAsinh = rangeAsinh;
	uPlot.scan = scanScale;
	uPlot.orient = orient;
	uPlot.pxRatio = pxRatio;
	uPlot.join = join;
	uPlot.fmtDate = fmtDate;
	uPlot.tzDate = tzDate;
	uPlot.sync = _sync;
	{
		uPlot.addGap = addGap;
		uPlot.clipGaps = clipGaps;
		let paths = uPlot.paths = { points };
		paths.linear = linear;
		paths.stepped = stepped;
		paths.bars = bars;
		paths.spline = monotoneCubic;
	}

return uPlot;
})();