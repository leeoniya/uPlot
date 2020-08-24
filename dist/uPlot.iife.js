/**
* Copyright (c) 2020, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* uPlot.js (μPlot)
* A small, fast chart for time series, lines, areas, ohlc & bars
* https://github.com/leeoniya/uPlot (v1.1.2)
*/

var uPlot = (function () {
	'use strict';

	function debounce(fn, time) {
		var pending = null;

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
	function closestIdx(num, arr, lo, hi) {
		var mid;
		lo = lo || 0;
		hi = hi || arr.length - 1;
		var bitwise = hi <= 2147483647;

		while (hi - lo > 1) {
			mid = bitwise ? (lo + hi) >> 1 : floor((lo + hi) / 2);

			if (arr[mid] < num)
				{ lo = mid; }
			else
				{ hi = mid; }
		}

		if (num - arr[lo] <= arr[hi] - num)
			{ return lo; }

		return hi;
	}

	function getMinMax(data, _i0, _i1, sorted) {
	//	console.log("getMinMax()");

		var _min = inf;
		var _max = -inf;

		if (sorted == 1) {
			_min = data[_i0];
			_max = data[_i1];
		}
		else if (sorted == -1) {
			_min = data[_i1];
			_max = data[_i0];
		}
		else {
			for (var i = _i0; i <= _i1; i++) {
				if (data[i] != null) {
					_min = min(_min, data[i]);
					_max = max(_max, data[i]);
				}
			}
		}

		return [_min, _max];
	}

	function rangeLog(min, max, fullMags) {
		if (min == max) {
			min /= 10;
			max *= 10;
		}

		var minIncr, maxIncr;

		if (fullMags) {
			min = minIncr = pow(10, floor(log10(min)));
			max = maxIncr = pow(10,  ceil(log10(max)));
		}
		else {
			minIncr       = pow(10, floor(log10(min)));
			maxIncr       = pow(10, floor(log10(max)));

			min           = incrRoundDn(min, minIncr);
			max           = incrRoundUp(max, maxIncr);
		}

		return [
			+min.toFixed(fixedDec.get(minIncr)),
			+max.toFixed(fixedDec.get(maxIncr)) ];
	}

	// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
	// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
	function rangeNum(min, max, mult, extra) {
		// auto-scale Y
		var delta = max - min;
		var nonZeroDelta = delta || abs(max) || 1e3;
		var mag = log10(nonZeroDelta);
		var base = pow(10, floor(mag));

		var padding = nonZeroDelta * mult;
		var newMin = min - padding;
		var newMax = max + padding;

		var snappedMin = round6(incrRoundDn(newMin, base/100));
		var snappedMax = round6(incrRoundUp(newMax, base/100));

		if (extra) {
			// for flat data, always use 0 as one chart extreme & place data in center
			if (delta == 0) {
				if (max > 0)
					{ snappedMin = 0; }
				else if (max < 0)
					{ snappedMax = 0; }
			}
			else {
				// if original data never crosses 0, use 0 as one chart extreme
				if (min >= 0 && snappedMin < 0)
					{ snappedMin = 0; }

				if (max <= 0 && snappedMax > 0)
					{ snappedMax = 0; }
			}
		}

		return [snappedMin, snappedMax];
	}

	// alternative: https://stackoverflow.com/a/2254896
	var fmtNum = new Intl.NumberFormat(navigator.language).format;

	var M = Math;

	var abs = M.abs;
	var floor = M.floor;
	var round = M.round;
	var ceil = M.ceil;
	var min = M.min;
	var max = M.max;
	var pow = M.pow;
	var log10 = M.log10;
	var PI = M.PI;

	var inf = Infinity;

	function incrRound(num, incr) {
		return round(num/incr)*incr;
	}

	function clamp(num, _min, _max) {
		return min(max(num, _min), _max);
	}

	function fnOrSelf(v) {
		return typeof v == "function" ? v : function () { return v; };
	}

	function incrRoundUp(num, incr) {
		return ceil(num/incr)*incr;
	}

	function incrRoundDn(num, incr) {
		return floor(num/incr)*incr;
	}

	function round3(val) {
		return round(val * 1e3) / 1e3;
	}

	function round6(val) {
		return round(val * 1e6) / 1e6;
	}

	var fixedDec = new Map();

	function genIncrs(minExp, maxExp, mults) {
		var incrs = [];

		for (var exp = minExp; exp < maxExp; exp++) {
			var mag = pow(10, exp);
			var expa = abs(exp);

			for (var i = 0; i < mults.length; i++) {
				var incr = +(mults[i] * mag).toFixed(expa);
				incrs.push(incr);
				fixedDec.set(incr, incr < 1 ? expa : 0);
			}
		}

		return incrs;
	}

	//export const assign = Object.assign;

	var isArr = Array.isArray;

	function isStr(v) {
		return typeof v === 'string';
	}

	function isObj(v) {
		return typeof v === 'object' && v !== null;
	}

	function copy(o) {
		var out;

		if (isArr(o))
			{ out = o.map(copy); }
		else if (isObj(o)) {
			out = {};
			for (var k in o)
				{ out[k] = copy(o[k]); }
		}
		else
			{ out = o; }

		return out;
	}

	function assign(targ) {
		var args = arguments;

		for (var i = 1; i < args.length; i++) {
			var src = args[i];

			for (var key in src) {
				if (isObj(targ[key]))
					{ assign(targ[key], copy(src[key])); }
				else
					{ targ[key] = copy(src[key]); }
			}
		}

		return targ;
	}

	var WIDTH = "width";
	var HEIGHT = "height";
	var TOP = "top";
	var BOTTOM = "bottom";
	var LEFT = "left";
	var RIGHT = "right";
	var firstChild = "firstChild";
	var createElement = "createElement";
	var hexBlack = "#000";
	var classList = "classList";

	var mousemove = "mousemove";
	var mousedown = "mousedown";
	var mouseup = "mouseup";
	var mouseenter = "mouseenter";
	var mouseleave = "mouseleave";
	var dblclick = "dblclick";
	var resize = "resize";
	var scroll = "scroll";

	var pre = "u-";

	var UPLOT          =       "uplot";
	var TITLE          = pre + "title";
	var WRAP           = pre + "wrap";
	var UNDER          = pre + "under";
	var OVER           = pre + "over";
	var OFF            = pre + "off";
	var SELECT         = pre + "select";
	var CURSOR_X       = pre + "cursor-x";
	var CURSOR_Y       = pre + "cursor-y";
	var CURSOR_PT      = pre + "cursor-pt";
	var LEGEND         = pre + "legend";
	var LEGEND_LIVE    = pre + "live";
	var LEGEND_INLINE  = pre + "inline";
	var LEGEND_THEAD   = pre + "thead";
	var LEGEND_SERIES  = pre + "series";
	var LEGEND_MARKER  = pre + "marker";
	var LEGEND_LABEL   = pre + "label";
	var LEGEND_VALUE   = pre + "value";

	var rAF = requestAnimationFrame;
	var doc = document;
	var win = window;
	var pxRatio = devicePixelRatio;

	function addClass(el, c) {
		c != null && el[classList].add(c);
	}

	function remClass(el, c) {
		el[classList].remove(c);
	}

	function setStylePx(el, name, value) {
		el.style[name] = value + "px";
	}

	function placeTag(tag, cls, targ, refEl) {
		var el = doc[createElement](tag);

		if (cls != null)
			{ addClass(el, cls); }

		if (targ != null)
			{ targ.insertBefore(el, refEl); }

		return el;
	}

	function placeDiv(cls, targ) {
		return placeTag("div", cls, targ);
	}

	function trans(el, xPos, yPos) {
		el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
	}

	var evOpts = {passive: true};

	function on(ev, el, cb) {
		el.addEventListener(ev, cb, evOpts);
	}

	function off(ev, el, cb) {
		el.removeEventListener(ev, cb, evOpts);
	}

	var months = [
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
		"December" ];

	var days = [
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday" ];

	function slice3(str) {
		return str.slice(0, 3);
	}

	var days3 =  days.map(slice3);

	var months3 =  months.map(slice3);

	var engNames = {
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

	var getFullYear = 'getFullYear';
	var getMonth = 'getMonth';
	var getDate = 'getDate';
	var getDay = 'getDay';
	var getHours = 'getHours';
	var getMinutes = 'getMinutes';
	var getSeconds = 'getSeconds';
	var getMilliseconds = 'getMilliseconds';

	var subs = {
		// 2019
		YYYY:	function (d) { return d[getFullYear](); },
		// 19
		YY:		function (d) { return (d[getFullYear]()+'').slice(2); },
		// July
		MMMM:	function (d, names) { return names.MMMM[d[getMonth]()]; },
		// Jul
		MMM:	function (d, names) { return names.MMM[d[getMonth]()]; },
		// 07
		MM:		function (d) { return zeroPad2(d[getMonth]()+1); },
		// 7
		M:		function (d) { return d[getMonth]()+1; },
		// 09
		DD:		function (d) { return zeroPad2(d[getDate]()); },
		// 9
		D:		function (d) { return d[getDate](); },
		// Monday
		WWWW:	function (d, names) { return names.WWWW[d[getDay]()]; },
		// Mon
		WWW:	function (d, names) { return names.WWW[d[getDay]()]; },
		// 03
		HH:		function (d) { return zeroPad2(d[getHours]()); },
		// 3
		H:		function (d) { return d[getHours](); },
		// 9 (12hr, unpadded)
		h:		function (d) {var h = d[getHours](); return h == 0 ? 12 : h > 12 ? h - 12 : h;},
		// AM
		AA:		function (d) { return d[getHours]() >= 12 ? 'PM' : 'AM'; },
		// am
		aa:		function (d) { return d[getHours]() >= 12 ? 'pm' : 'am'; },
		// a
		a:		function (d) { return d[getHours]() >= 12 ? 'p' : 'a'; },
		// 09
		mm:		function (d) { return zeroPad2(d[getMinutes]()); },
		// 9
		m:		function (d) { return d[getMinutes](); },
		// 09
		ss:		function (d) { return zeroPad2(d[getSeconds]()); },
		// 9
		s:		function (d) { return d[getSeconds](); },
		// 374
		fff:	function (d) { return zeroPad3(d[getMilliseconds]()); },
	};

	function fmtDate(tpl, names) {
		names = names || engNames;
		var parts = [];

		var R = /\{([a-z]+)\}|[^{]+/gi, m;

		while (m = R.exec(tpl))
			{ parts.push(m[0][0] == '{' ? subs[m[1]] : m[0]); }

		return function (d) {
			var out = '';

			for (var i = 0; i < parts.length; i++)
				{ out += typeof parts[i] == "string" ? parts[i] : parts[i](d, names); }

			return out;
		}
	}

	var localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;

	// https://stackoverflow.com/questions/15141762/how-to-initialize-a-javascript-date-to-a-particular-time-zone/53652131#53652131
	function tzDate(date, tz) {
		var date2;

		// perf optimization
		if (tz == 'Etc/UTC')
			{ date2 = new Date(+date + date.getTimezoneOffset() * 6e4); }
		else if (tz == localTz)
			{ date2 = date; }
		else {
			date2 = new Date(date.toLocaleString('en-US', {timeZone: tz}));
			date2.setMilliseconds(date[getMilliseconds]());
		}

		return date2;
	}

	//export const series = [];

	// default formatters:

	var incrMults = [1,2,5];

	var decIncrs = genIncrs(-16, 0, incrMults);

	var intIncrs = genIncrs(0, 16, incrMults);

	var numIncrs = decIncrs.concat(intIncrs);

	var s = 1,
		m = 60,
		h = m * m,
		d = h * 24,
		mo = d * 30,
		y = d * 365;

	// starting below 1e-3 is a hack to allow the incr finder to choose & bail out at incr < 1ms
	var timeIncrs =  [5e-4].concat(genIncrs(-3, 0, incrMults), [
		// minute divisors (# of secs)
		1,
		5,
		10,
		15,
		30,
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
		y * 100 ]);

	function timeAxisStamps(stampCfg, fmtDate) {
		return stampCfg.map(function (s) { return [
			s[0],
			fmtDate(s[1]),
			s[2],
			fmtDate(s[4] ? s[1] + s[3] : s[3]) ]; });
	}

	var yyyy = "{YYYY}";
	var NLyyyy = "\n" + yyyy;
	var md = "{M}/{D}";
	var NLmd = "\n" + md;

	var aa = "{aa}";
	var hmm = "{h}:{mm}";
	var hmmaa = hmm + aa;
	var ss = ":{ss}";

	// [0]: minimum num secs in the tick incr
	// [1]: normal tick format
	// [2]: when a differing <x> is encountered - 1: sec, 2: min, 3: hour, 4: day, 5: week, 6: month, 7: year
	// [3]: use a longer more contextual format
	// [4]: modes: 0: replace [1] -> [3], 1: concat [1] + [3]
	var _timeAxisStamps = [
		[y,        yyyy,            7,   "",                    1],
		[d * 28,   "{MMM}",         7,   NLyyyy,                1],
		[d,        md,              7,   NLyyyy,                1],
		[h,        "{h}" + aa,      4,   NLmd,                  1],
		[m,        hmmaa,           4,   NLmd,                  1],
		[s,        ss,              2,   NLmd  + " " + hmmaa,   1],
		[1e-3,     ss + ".{fff}",   2,   NLmd  + " " + hmmaa,   1] ];

	// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
	// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
	function timeAxisVals(tzDate, stamps) {
		return function (self, splits, axisIdx, foundSpace, foundIncr) {
			var s = stamps.find(function (e) { return foundIncr >= e[0]; }) || stamps[stamps.length - 1];

			// these track boundaries when a full label is needed again
			var prevYear = null;
			var prevDate = null;
			var prevMinu = null;

			return splits.map(function (split, i) {
				var date = tzDate(split);

				var newYear = date[getFullYear]();
				var newDate = date[getDate]();
				var newMinu = date[getMinutes]();

				var diffYear = newYear != prevYear;
				var diffDate = newDate != prevDate;
				var diffMinu = newMinu != prevMinu;

				var stamp = s[2] == 7 && diffYear || s[2] == 4 && diffDate || s[2] == 2 && diffMinu ? s[3] : s[1];

				prevYear = newYear;
				prevDate = newDate;
				prevMinu = newMinu;

				return stamp(date);
			});
		}
	}

	function mkDate(y, m, d) {
		return new Date(y, m, d);
	}

	// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
	// https://www.timeanddate.com/time/dst/
	// https://www.timeanddate.com/time/dst/2019.html
	// https://www.epochconverter.com/timezones
	function timeAxisSplits(tzDate) {
		return function (self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) {
			var splits = [];
			var isMo = foundIncr >= mo && foundIncr < y;

			// get the timezone-adjusted date
			var minDate = tzDate(scaleMin);
			var minDateTs = minDate / 1e3;

			// get ts of 12am (this lands us at or before the original scaleMin)
			var minMin = mkDate(minDate[getFullYear](), minDate[getMonth](), isMo ? 1 : minDate[getDate]());
			var minMinTs = minMin / 1e3;

			if (isMo) {
				var moIncr = foundIncr / mo;
			//	let tzOffset = scaleMin - minDateTs;		// needed?
				var split = minDateTs == minMinTs ? minDateTs : mkDate(minMin[getFullYear](), minMin[getMonth]() + moIncr, 1) / 1e3;
				var splitDate = new Date(split * 1e3);
				var baseYear = splitDate[getFullYear]();
				var baseMonth = splitDate[getMonth]();

				for (var i = 0; split <= scaleMax; i++) {
					var next = mkDate(baseYear, baseMonth + moIncr * i, 1);
					var offs = next - tzDate(next / 1e3);

					split = (+next + offs) / 1e3;

					if (split <= scaleMax)
						{ splits.push(split); }
				}
			}
			else {
				var incr0 = foundIncr >= d ? d : foundIncr;
				var tzOffset = floor(scaleMin) - floor(minDateTs);
				var split$1 = minMinTs + tzOffset + incrRoundUp(minDateTs - minMinTs, incr0);
				splits.push(split$1);

				var date0 = tzDate(split$1);

				var prevHour = date0[getHours]() + (date0[getMinutes]() / m) + (date0[getSeconds]() / h);
				var incrHours = foundIncr / h;

				var minSpace = self.axes[axisIdx].space();		// TOFIX: only works for static space:
				var pctSpace = foundSpace / minSpace;

				while (1) {
					split$1 = round3(split$1 + foundIncr);

					if (split$1 > scaleMax)
						{ break; }

					if (incrHours > 1) {
						var expectedHour = floor(round6(prevHour + incrHours)) % 24;
						var splitDate$1 = tzDate(split$1);
						var actualHour = splitDate$1.getHours();

						var dstShift = actualHour - expectedHour;

						if (dstShift > 1)
							{ dstShift = -1; }

						split$1 -= dstShift * h;

						prevHour = (prevHour + incrHours) % 24;

						// add a tick only if it's further than 70% of the min allowed label spacing
						var prevSplit = splits[splits.length - 1];
						var pctIncr = round3((split$1 - prevSplit) / foundIncr);

						if (pctIncr * pctSpace >= .7)
							{ splits.push(split$1); }
					}
					else
						{ splits.push(split$1); }
				}
			}

			return splits;
		}
	}

	function timeSeriesStamp(stampCfg, fmtDate) {
		return fmtDate(stampCfg);
	}
	var _timeSeriesStamp = '{YYYY}-{MM}-{DD} {h}:{mm}{aa}';

	function timeSeriesVal(tzDate, stamp) {
		return function (self, val) { return stamp(tzDate(val)); };
	}

	function cursorPoint(self, si) {
		var s = self.series[si];

		var pt = placeDiv();

		pt.style.background = s.stroke || hexBlack;

		var dia = ptDia(s.width, 1);
		var mar = (dia - 1) / -2;

		setStylePx(pt, WIDTH, dia);
		setStylePx(pt, HEIGHT, dia);
		setStylePx(pt, "marginLeft", mar);
		setStylePx(pt, "marginTop", mar);

		return pt;
	}

	function dataIdx(self, seriesIdx, cursorIdx) {
		return cursorIdx;
	}

	var moveTuple = [0,0];

	function cursorMove(self, mouseLeft1, mouseTop1) {
		moveTuple[0] = mouseLeft1;
		moveTuple[1] = mouseTop1;
		return moveTuple;
	}

	var cursorOpts = {
		show: true,
		x: true,
		y: true,
		lock: false,
		move: cursorMove,
		points: {
			show: cursorPoint,
		},

		drag: {
			setScale: true,
			x: true,
			y: false,
			dist: 0,
			uni: null,
			_x: false,
			_y: false,
		},

		focus: {
			prox: -1,
		},

		locked: false,
		left: -10,
		top: -10,
		idx: null,
		dataIdx: dataIdx,
	};

	var grid = {
		show: true,
		stroke: "rgba(0,0,0,0.07)",
		width: 2,
	//	dash: [],
	};

	var ticks = assign({}, grid, {size: 10});

	var font      = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
	var labelFont = "bold " + font;
	var lineMult = 1.5;		// font-size multiplier

	var xAxisOpts = {
		show: true,
		scale: "x",
		space: 50,
		gap: 5,
		size: 50,
		labelSize: 30,
		labelFont: labelFont,
		side: 2,
	//	class: "x-vals",
	//	incrs: timeIncrs,
	//	values: timeVals,
		grid: grid,
		ticks: ticks,
		font: font,
		rotate: 0,
	};

	var numSeriesLabel = "Value";
	var timeSeriesLabel = "Time";

	var xSeriesOpts = {
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

	function numAxisVals(self, splits, axisIdx, foundSpace, foundIncr) {
		return splits.map(fmtNum);
	}

	function numAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
		var splits = [];

		var numDec = fixedDec.get(foundIncr);

		scaleMin = forceMin ? scaleMin : +incrRoundUp(scaleMin, foundIncr).toFixed(numDec);

		for (var val = scaleMin; val <= scaleMax; val = +(val + foundIncr).toFixed(numDec))
			{ splits.push(val); }

		return splits;
	}

	function logAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
		var splits = [];

		foundIncr = pow(10, floor(log10(scaleMin)));

		var split = scaleMin;

		do {
			splits.push(split);
			split = +(split + foundIncr).toFixed(fixedDec.get(foundIncr));
			if (split >= foundIncr * 10)
				{ foundIncr = split; }
		} while (split <= scaleMax);

		return splits;
	}

	var RE_ALL   = /./;
	var RE_12357 = /[12357]/;
	var RE_125   = /[125]/;
	var RE_1     = /1/;

	function logAxisVals(self, splits, axisIdx, foundSpace, foundIncr) {
		var axis = self.axes[axisIdx];
		var scaleKey = axis.scale;
		var valToPos = self.valToPos;

		var minSpace = axis.space();			// TOFIX: only works for static space:

		var _10 = valToPos(10, scaleKey);

		var re = (
			valToPos(9,  scaleKey) - _10 >= minSpace ? RE_ALL :
			valToPos(7,  scaleKey) - _10 >= minSpace ? RE_12357 :
			valToPos(5,  scaleKey) - _10 >= minSpace ? RE_125 :
			RE_1
		);

		return splits.map(function (v) { return re.test(v) ? fmtNum(v) : ""; });
	}

	function numSeriesVal(self, val) {
		return fmtNum(val);
	}

	var yAxisOpts = {
		show: true,
		scale: "y",
		space: 40,
		gap: 5,
		size: 50,
		labelSize: 30,
		labelFont: labelFont,
		side: 3,
	//	class: "y-vals",
	//	incrs: numIncrs,
	//	values: (vals, space) => vals,
		grid: grid,
		ticks: ticks,
		font: font,
		rotate: 0,
	};

	// takes stroke width
	function ptDia(width, mult) {
		var dia = 3 + (width || 1) * 2;
		return round3(dia * mult);
	}

	function seriesPoints(self, si) {
		var dia = ptDia(self.series[si].width, pxRatio);
		var maxPts = self.bbox.width / dia / 2;
		var idxs = self.series[0].idxs;
		return idxs[1] - idxs[0] <= maxPts;
	}

	var ySeriesOpts = {
		scale: "y",
		sorted: 0,
		show: true,
		band: false,
		spanGaps: false,
		alpha: 1,
		points: {
			show: seriesPoints,
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

	var xScaleOpts = {
		time: true,
		auto: true,
		distr: 1,
		min: null,
		max: null,
	};

	var yScaleOpts = assign({}, xScaleOpts, {
		time: false,
	});

	var syncs = {};

	function _sync(opts) {
		var clients = [];

		return {
			sub: function sub(client) {
				clients.push(client);
			},
			unsub: function unsub(client) {
				clients = clients.filter(function (c) { return c != client; });
			},
			pub: function pub(type, self, x, y, w, h, i) {
				if (clients.length > 1) {
					clients.forEach(function (client) {
						client != self && client.pub(type, self, x, y, w, h, i);
					});
				}
			}
		};
	}

	function setDefaults(d, xo, yo, initY) {
		var d2 = initY ? [d[0], d[1]].concat(d.slice(2)) : [d[0]].concat(d.slice(1));
		return d2.map(function (o, i) { return setDefault(o, i, xo, yo); });
	}

	function setDefault(o, i, xo, yo) {
		return assign({}, (i == 0 || o && o.side % 2 == 0 ? xo : yo), o);
	}

	function getValPct(val, scale) {
		return (
			scale.distr == 3
			? log10(val / scale.min) / log10(scale.max / scale.min)
			: (val - scale.min) / (scale.max - scale.min)
		);
	}

	function getYPos(val, scale, hgt, top) {
		var pctY = getValPct(val, scale);
		return top + (1 - pctY) * hgt;
	}

	function getXPos(val, scale, wid, lft) {
		var pctX = getValPct(val, scale);
		return lft + pctX * wid;
	}

	function snapTimeX(self, dataMin, dataMax) {
		return [dataMin, dataMax > dataMin ? dataMax : dataMax + 86400];
	}

	function snapNumX(self, dataMin, dataMax) {
		var delta = dataMax - dataMin;

		if (delta == 0) {
			var mag = log10(delta || abs(dataMax) || 1);
			var exp = floor(mag) + 1;
			return [dataMin, incrRoundUp(dataMax, pow(10, exp))];
		}
		else
			{ return [dataMin, dataMax]; }
	}

	// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
	// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
	function snapNumY(self, dataMin, dataMax) {
		return rangeNum(dataMin, dataMax, 0.1, true);
	}

	function snapLogX(self, dataMin, dataMax) {
		return rangeLog(dataMin, dataMax);
	}

	function snapLogY(self, dataMin, dataMax) {
		return rangeLog(dataMin, dataMax);
	}

	// dim is logical (getClientBoundingRect) pixels, not canvas pixels
	function findIncr(min, max, incrs, dim, minSpace) {
		var pxPerUnit = dim / (max - min);

		for (var i = 0; i < incrs.length; i++) {
			var space = incrs[i] * pxPerUnit;

			if (space >= minSpace && min + incrs[i] > min)
				{ return [incrs[i], space]; }
		}
	}

	function filtMouse(e) {
		return e.button == 0;
	}

	function pxRatioFont(font) {
		var fontSize;
		font = font.replace(/\d+/, function (m) { return (fontSize = round(m * pxRatio)); });
		return [font, fontSize];
	}

	function uPlot(opts, data, then) {
		var self = {};

		var root = self.root = placeDiv(UPLOT);

		if (opts.id != null)
			{ root.id = opts.id; }

		addClass(root, opts.class);

		if (opts.title) {
			var title = placeDiv(TITLE, root);
			title.textContent = opts.title;
		}

		var can = placeTag("canvas");
		var ctx = self.ctx = can.getContext("2d");

		var wrap = placeDiv(WRAP, root);
		var under = placeDiv(UNDER, wrap);
		wrap.appendChild(can);
		var over = placeDiv(OVER, wrap);

		opts = copy(opts);

		(opts.plugins || []).forEach(function (p) {
			if (p.opts)
				{ opts = p.opts(self, opts) || opts; }
		});

		var ready = false;

		var series  = self.series = setDefaults(opts.series || [], xSeriesOpts, ySeriesOpts, false);
		var axes    = self.axes   = setDefaults(opts.axes   || [], xAxisOpts,   yAxisOpts,    true);
		var scales  = self.scales = assign({}, {x: xScaleOpts, y: yScaleOpts}, opts.scales);

		var gutters = assign({
			x: round(yAxisOpts.size / 2),
			y: round(xAxisOpts.size / 3),
		}, opts.gutters);

	//	self.tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
		var _tzDate  =  (opts.tzDate || (function (ts) { return new Date(ts * 1e3); }));
		var _fmtDate =  (opts.fmtDate || fmtDate);

		var _timeAxisSplits =  timeAxisSplits(_tzDate);
		var _timeAxisVals   =  timeAxisVals(_tzDate, timeAxisStamps(_timeAxisStamps, _fmtDate));
		var _timeSeriesVal  =  timeSeriesVal(_tzDate, timeSeriesStamp(_timeSeriesStamp, _fmtDate));

		var pendScales = {};

		// explicitly-set initial scales
		for (var k in scales) {
			var sc = scales[k];

			if (sc.min != null || sc.max != null)
				{ pendScales[k] = {min: sc.min, max: sc.max}; }
		}

		var legend     =  assign({show: true, live: true}, opts.legend);
		var showLegend =  legend.show;

		var legendEl;
		var legendRows = [];
		var legendCols;
		var multiValLegend = false;

		if (showLegend) {
			legendEl = placeTag("table", LEGEND, root);

			var getMultiVals = series[1] ? series[1].values : null;
			multiValLegend = getMultiVals != null;

			if (multiValLegend) {
				var head = placeTag("tr", LEGEND_THEAD, legendEl);
				placeTag("th", null, head);
				legendCols = getMultiVals(self, 1, 0);

				for (var key in legendCols)
					{ placeTag("th", LEGEND_LABEL, head).textContent = key; }
			}
			else {
				legendCols = {_: 0};
				addClass(legendEl, LEGEND_INLINE);
				legend.live && addClass(legendEl, LEGEND_LIVE);
			}
		}

		function initLegendRow(s, i) {
			if (i == 0 && (multiValLegend || !legend.live))
				{ return null; }

			var _row = [];

			var row = placeTag("tr", LEGEND_SERIES, legendEl, legendEl.childNodes[i]);

			addClass(row, s.class);

			if (!s.show)
				{ addClass(row, OFF); }

			var label = placeTag("th", null, row);

			var indic = placeDiv(LEGEND_MARKER, label);
			s.width && (indic.style.borderColor = s.stroke);
			indic.style.backgroundColor = s.fill;

			var text = placeDiv(LEGEND_LABEL, label);
			text.textContent = s.label;

			if (i > 0) {
				on("click", label, function (e) {
					if ( cursor.locked)
						{ return; }

					filtMouse(e) && setSeries(series.indexOf(s), {show: !s.show},  syncOpts.setSeries);
				});

				if (cursorFocus) {
					on(mouseenter, label, function (e) {
						if (cursor.locked)
							{ return; }

						setSeries(series.indexOf(s), {focus: true}, syncOpts.setSeries);
					});
				}
			}

			for (var key in legendCols) {
				var v = placeTag("td", LEGEND_VALUE, row);
				v.textContent = "--";
				_row.push(v);
			}

			return _row;
		}

		var cursor =  (self.cursor = assign({}, cursorOpts, opts.cursor));

		 (cursor.points.show = fnOrSelf(cursor.points.show));

		var focus = self.focus = assign({}, opts.focus || {alpha: 0.3},  cursor.focus);
		var cursorFocus =  focus.prox >= 0;

		// series-intersection markers
		var cursorPts = [null];

		function initCursorPt(s, si) {
			if (si > 0) {
				var pt = cursor.points.show(self, si);

				if (pt) {
					addClass(pt, CURSOR_PT);
					addClass(pt, s.class);
					trans(pt, -10, -10);
					over.insertBefore(pt, cursorPts[si]);

					return pt;
				}
			}
		}

		function initSeries(s, i) {
			// init scales & defaults
			var scKey = s.scale;

			var sc = scales[scKey] = assign({}, (i == 0 ? xScaleOpts : yScaleOpts), scales[scKey]);

			var isTime =  sc.time;
			var isLog  = sc.distr == 3;

			sc.range = fnOrSelf(sc.range || (isTime ? snapTimeX : i == 0 ? (isLog ? snapLogX : snapNumX) : (isLog ? snapLogY : snapNumY)));

			var sv = s.value;
			s.value = isTime ? (isStr(sv) ? timeSeriesVal(_tzDate, timeSeriesStamp(sv, _fmtDate)) : sv || _timeSeriesVal) : sv || numSeriesVal;
			s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);

			if (i > 0) {
				s.width = s.width == null ? 1 : s.width;
				s.paths = s.paths || ( buildPaths);
				s.fillTo = fnOrSelf(s.fillTo || 0);
				var _ptDia = ptDia(s.width, 1);
				s.points = assign({}, {
					size: _ptDia,
					width: max(1, _ptDia * .2),
				}, s.points);
				s.points.show = fnOrSelf(s.points.show);
				s._paths = null;
			}

			if (showLegend)
				{ legendRows.splice(i, 0, initLegendRow(s, i)); }

			if ( cursor.show) {
				var pt = initCursorPt(s, i);
				pt && cursorPts.splice(i, 0, pt);
			}
		}

		function addSeries(opts, si) {
			si = si == null ? series.length : si;

			opts = setDefault(opts, si, xSeriesOpts, ySeriesOpts);
			series.splice(si, 0, opts);
			initSeries(series[si], si);
		}

		self.addSeries = addSeries;

		function delSeries(i) {
			series.splice(i, 1);
			 showLegend && legendRows.splice(i, 1)[0][0].parentNode.remove();
			 cursorPts.length > 1 && cursorPts.splice(i, 1)[0].remove();

			// TODO: de-init no-longer-needed scales?
		}

		self.delSeries = delSeries;

		series.forEach(initSeries);

		var xScaleKey = series[0].scale;
		var xScaleDistr = scales[xScaleKey].distr;

		// dependent scales inherit
		for (var k$1 in scales) {
			var sc$1 = scales[k$1];

			if (sc$1.from != null)
				{ scales[k$1] = assign({}, scales[sc$1.from], sc$1); }
		}

		function initAxis(axis, i) {
			if (axis.show) {
				var isVt = axis.side % 2;

				var sc = scales[axis.scale];

				// this can occur if all series specify non-default scales
				if (sc == null) {
					axis.scale = isVt ? series[1].scale : xScaleKey;
					sc = scales[axis.scale];
				}

				// also set defaults for incrs & values based on axis distr
				var isTime =  sc.time;

				axis.space = fnOrSelf(axis.space);
				axis.rotate = fnOrSelf(axis.rotate);
				axis.incrs  = fnOrSelf(axis.incrs  || (          sc.distr == 2 ? intIncrs : (isTime ? timeIncrs : numIncrs)));
				axis.splits = fnOrSelf(axis.splits || (isTime && sc.distr == 1 ? _timeAxisSplits : sc.distr == 3 ? logAxisSplits : numAxisSplits));
				var av = axis.values;
				axis.values = isTime ? (isArr(av) ? timeAxisVals(_tzDate, timeAxisStamps(av, _fmtDate)) : av || _timeAxisVals) : av || (sc.distr == 3 ? logAxisVals : numAxisVals);

				axis.font      = pxRatioFont(axis.font);
				axis.labelFont = pxRatioFont(axis.labelFont);
			}
		}

		// set axis defaults
		axes.forEach(initAxis);

		var dataLen;

		// rendered data window
		var i0 = null;
		var i1 = null;
		var idxs = series[0].idxs;

		var data0 = null;

		var forceUpdateLegend = false;

		function setData(_data, _resetScales) {
			_data = _data || [];
			_data[0] = _data[0] || [];

			self.data = _data;
			data = _data.slice();
			data0 = data[0];
			dataLen = data0.length;

			if (xScaleDistr == 2)
				{ data[0] = data0.map(function (v, i) { return i; }); }

			resetYSeries();

			fire("setData");

			forceUpdateLegend = true;

			if (_resetScales !== false) {
				var xsc = scales[xScaleKey];

				if (xsc.auto)
					{ autoScaleX(); }
				else
					{ _setScale(xScaleKey, xsc.min, xsc.max); }
			}
		}

		self.setData = setData;

		function autoScaleX() {
			i0 = idxs[0] = 0;
			i1 = idxs[1] = dataLen - 1;

			var _min = xScaleDistr == 2 ? i0 : data[0][i0],
				_max = xScaleDistr == 2 ? i1 : data[0][i1];

			_min != null && _max != null && _setScale(xScaleKey, _min, _max);
		}

		function setCtxStyle(stroke, width, dash, fill) {
			ctx.strokeStyle = stroke || hexBlack;
			ctx.lineWidth = width;
			ctx.lineJoin = "round";
			ctx.setLineDash(dash || []);
			ctx.fillStyle = fill || hexBlack;
		}

		var fullWidCss;
		var fullHgtCss;

		var plotWidCss;
		var plotHgtCss;

		// plot margins to account for axes
		var plotLftCss;
		var plotTopCss;

		var plotLft;
		var plotTop;
		var plotWid;
		var plotHgt;

		self.bbox = {};

		function _setSize(width, height) {
			self.width  = fullWidCss = plotWidCss = width;
			self.height = fullHgtCss = plotHgtCss = height;
			plotLftCss  = plotTopCss = 0;

			calcPlotRect();
			calcAxesRects();

			var bb = self.bbox;

			plotLft = bb[LEFT]   = incrRound(plotLftCss * pxRatio, 0.5);
			plotTop = bb[TOP]    = incrRound(plotTopCss * pxRatio, 0.5);
			plotWid = bb[WIDTH]  = incrRound(plotWidCss * pxRatio, 0.5);
			plotHgt = bb[HEIGHT] = incrRound(plotHgtCss * pxRatio, 0.5);

			setStylePx(under, LEFT,   plotLftCss);
			setStylePx(under, TOP,    plotTopCss);
			setStylePx(under, WIDTH,  plotWidCss);
			setStylePx(under, HEIGHT, plotHgtCss);

			setStylePx(over, LEFT,    plotLftCss);
			setStylePx(over, TOP,     plotTopCss);
			setStylePx(over, WIDTH,   plotWidCss);
			setStylePx(over, HEIGHT,  plotHgtCss);

			setStylePx(wrap, WIDTH,   fullWidCss);
			setStylePx(wrap, HEIGHT,  fullHgtCss);

			can[WIDTH]  = round(fullWidCss * pxRatio);
			can[HEIGHT] = round(fullHgtCss * pxRatio);

			syncRect();

			ready && _setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);

			ready && fire("setSize");
		}

		function setSize(ref) {
			var width = ref.width;
			var height = ref.height;

			_setSize(width, height);
		}

		self.setSize = setSize;

		// accumulate axis offsets, reduce canvas width
		function calcPlotRect() {
			// easements for edge labels
			var hasTopAxis = false;
			var hasBtmAxis = false;
			var hasRgtAxis = false;
			var hasLftAxis = false;

			axes.forEach(function (axis, i) {
				if (axis.show) {
					var side = axis.side;
					var size = axis.size;
					var isVt = side % 2;
					var labelSize = axis.labelSize = (axis.label != null ? (axis.labelSize || 30) : 0);

					var fullSize = size + labelSize;

					if (fullSize > 0) {
						if (isVt) {
							plotWidCss -= fullSize;

							if (side == 3) {
								plotLftCss += fullSize;
								hasLftAxis = true;
							}
							else
								{ hasRgtAxis = true; }
						}
						else {
							plotHgtCss -= fullSize;

							if (side == 0) {
								plotTopCss += fullSize;
								hasTopAxis = true;
							}
							else
								{ hasBtmAxis = true; }
						}
					}
				}
			});

			// hz gutters
			if (hasTopAxis || hasBtmAxis) {
				if (!hasRgtAxis)
					{ plotWidCss -= gutters.x; }
				if (!hasLftAxis) {
					plotWidCss -= gutters.x;
					plotLftCss += gutters.x;
				}
			}

			// vt gutters
			if (hasLftAxis || hasRgtAxis) {
				if (!hasBtmAxis)
					{ plotHgtCss -= gutters.y; }
				if (!hasTopAxis) {
					plotHgtCss -= gutters.y;
					plotTopCss += gutters.y;
				}
			}
		}

		function calcAxesRects() {
			// will accum +
			var off1 = plotLftCss + plotWidCss;
			var off2 = plotTopCss + plotHgtCss;
			// will accum -
			var off3 = plotLftCss;
			var off0 = plotTopCss;

			function incrOffset(side, size) {

				switch (side) {
					case 1: off1 += size; return off1 - size;
					case 2: off2 += size; return off2 - size;
					case 3: off3 -= size; return off3 + size;
					case 0: off0 -= size; return off0 + size;
				}
			}

			axes.forEach(function (axis, i) {
				var side = axis.side;

				axis._pos = incrOffset(side, axis.size);

				if (axis.label != null)
					{ axis._lpos = incrOffset(side, axis.labelSize); }
			});
		}

		function setScales() {
			if (inBatch) {
				shouldSetScales = true;
				return;
			}

		//	log("setScales()", arguments);

			if (dataLen > 0) {
				// wip scales
				var wipScales = copy(scales);

				for (var k in wipScales) {
					var wsc = wipScales[k];
					var psc = pendScales[k];

					if (psc != null) {
						assign(wsc, psc);

						// explicitly setting the x-scale invalidates everything (acts as redraw)
						if (k == xScaleKey)
							{ resetYSeries(); }
					}
					else if (k != xScaleKey) {
						wsc.min = inf;
						wsc.max = -inf;
					}
				}

				// pre-range y-scales from y series' data values
				series.forEach(function (s, i) {
					var k = s.scale;
					var wsc = wipScales[k];

					// setting the x scale invalidates everything
					if (i == 0) {
						var minMax = wsc.range(self, wsc.min, wsc.max, k);

						wsc.min = minMax[0];
						wsc.max = minMax[1];

						i0 = closestIdx(wsc.min, data[0]);
						i1 = closestIdx(wsc.max, data[0]);

						// closest indices can be outside of view
						if (data[0][i0] < wsc.min)
							{ i0++; }
						if (data[0][i1] > wsc.max)
							{ i1--; }

						s.min = data0[i0];
						s.max = data0[i1];
					}
					else if (s.show && pendScales[k] == null) {
						// only run getMinMax() for invalidated series data, else reuse
						var minMax$1 = s.min == inf ? (wsc.auto ? getMinMax(data[i], i0, i1, s.sorted) : [0,100]) : [s.min, s.max];

						// initial min/max
						wsc.min = min(wsc.min, s.min = minMax$1[0]);
						wsc.max = max(wsc.max, s.max = minMax$1[1]);
					}

					s.idxs[0] = i0;
					s.idxs[1] = i1;
				});

				// range independent scales
				for (var k$1 in wipScales) {
					var wsc$1 = wipScales[k$1];

					if (wsc$1.from == null && wsc$1.min != inf && pendScales[k$1] == null) {
						var minMax = wsc$1.range(self, wsc$1.min, wsc$1.max, k$1);
						wsc$1.min = minMax[0];
						wsc$1.max = minMax[1];
					}
				}

				// range dependent scales
				for (var k$2 in wipScales) {
					var wsc$2 = wipScales[k$2];

					if (wsc$2.from != null) {
						var base = wipScales[wsc$2.from];

						if (base.min != inf) {
							var minMax$1 = wsc$2.range(self, base.min, base.max, k$2);
							wsc$2.min = minMax$1[0];
							wsc$2.max = minMax$1[1];
						}
					}
				}

				var changed = {};

				for (var k$3 in wipScales) {
					var wsc$3 = wipScales[k$3];
					var sc = scales[k$3];

					if (sc.min != wsc$3.min || sc.max != wsc$3.max) {
						sc.min = wsc$3.min;
						sc.max = wsc$3.max;
						changed[k$3] = true;
					}
				}

				// invalidate paths of all series on changed scales
				series.forEach(function (s) {
					if (changed[s.scale])
						{ s._paths = null; }
				});

				for (var k$4 in changed)
					{ fire("setScale", k$4); }
			}

			for (var k$5 in pendScales)
				{ pendScales[k$5] = null; }

			 cursor.show && updateCursor();
		}

		// TODO: drawWrap(si, drawPoints) (save, restore, translate, clip)

		function drawPoints(si) {
		//	log("drawPoints()", arguments);

			var s = series[si];
			var p = s.points;

			var width = round3(p.width * pxRatio);
			var offset = (width % 2) / 2;
			var isStroked = p.width > 0;

			var rad = (p.size - p.width) / 2 * pxRatio;
			var dia = round3(rad * 2);

			ctx.translate(offset, offset);

			ctx.save();

			ctx.beginPath();
			ctx.rect(
				plotLft - dia,
				plotTop - dia,
				plotWid + dia * 2,
				plotHgt + dia * 2
			);
			ctx.clip();

			ctx.globalAlpha = s.alpha;

			var path = new Path2D();

			for (var pi = i0; pi <= i1; pi++) {
				if (data[si][pi] != null) {
					var x = round(getXPos(data[0][pi],  scales[xScaleKey], plotWid, plotLft));
					var y = round(getYPos(data[si][pi], scales[s.scale],   plotHgt, plotTop));

					path.moveTo(x + rad, y);
					path.arc(x, y, rad, 0, PI * 2);
				}
			}

			setCtxStyle(
				p.stroke || s.stroke || hexBlack,
				width,
				null,
				p.fill || (isStroked ? "#fff" : s.stroke || hexBlack)
			);

			ctx.fill(path);
			isStroked && ctx.stroke(path);

			ctx.globalAlpha = 1;

			ctx.restore();

			ctx.translate(-offset, -offset);
		}

		// grabs the nearest indices with y data outside of x-scale limits
		function getOuterIdxs(ydata) {
			var _i0 = clamp(i0 - 1, 0, dataLen - 1);
			var _i1 = clamp(i1 + 1, 0, dataLen - 1);

			while (ydata[_i0] == null && _i0 > 0)
				{ _i0--; }

			while (ydata[_i1] == null && _i1 < dataLen - 1)
				{ _i1++; }

			return [_i0, _i1];
		}

		var dir = 1;

		function drawSeries() {
			// path building loop must be before draw loop to ensure that all bands are fully constructed
			series.forEach(function (s, i) {
				if (i > 0 && s.show && dataLen > 0 && s._paths == null) {
					var _idxs = getOuterIdxs(data[i]);
					s._paths = s.paths(self, i, _idxs[0], _idxs[1]);
				}
			});

			series.forEach(function (s, i) {
				if (i > 0 && s.show) {
					if (s._paths)
						 { drawPath(i); }

					if (s.points.show(self, i, i0, i1))
						 { drawPoints(i); }

					fire("drawSeries", i);
				}
			});
		}

		function drawPath(si) {
			var s = series[si];

			if (dir == 1) {
				var ref = s._paths;
				var stroke = ref.stroke;
				var fill = ref.fill;
				var clip = ref.clip;
				var width = round3(s[WIDTH] * pxRatio);
				var offset = (width % 2) / 2;

				setCtxStyle(s.stroke, width, s.dash, s.fill);

				ctx.globalAlpha = s.alpha;

				ctx.translate(offset, offset);

				ctx.save();

				var lft = plotLft,
					top = plotTop,
					wid = plotWid,
					hgt = plotHgt;

				var halfWid = width * pxRatio / 2;

				if (s.min == 0)
					{ hgt += halfWid; }

				if (s.max == 0) {
					top -= halfWid;
					hgt += halfWid;
				}

				ctx.beginPath();
				ctx.rect(lft, top, wid, hgt);
				ctx.clip();

				if (clip != null)
					{ ctx.clip(clip); }

				if (s.band) {
					ctx.fill(stroke);
					width && ctx.stroke(stroke);
				}
				else {
					width && ctx.stroke(stroke);

					if (s.fill != null)
						{ ctx.fill(fill); }
				}

				ctx.restore();

				ctx.translate(-offset, -offset);

				ctx.globalAlpha = 1;
			}

			if (s.band)
				{ dir *= -1; }
		}

		function buildClip(is, gaps, nullHead, nullTail) {
			var s = series[is];

			var clip = null;

			// create clip path (invert gaps and non-gaps)
			if (gaps.length > 0) {
				if (s.spanGaps) {
					var headGap = gaps[0];
					var tailGap = gaps[gaps.length - 1];
					gaps = [];

					if (nullHead)
						{ gaps.push(headGap); }
					if (nullTail)
						{ gaps.push(tailGap); }
				}

				clip = new Path2D();

				var prevGapEnd = plotLft;

				for (var i = 0; i < gaps.length; i++) {
					var g = gaps[i];

					clip.rect(prevGapEnd, plotTop, g[0] - prevGapEnd, plotTop + plotHgt);

					prevGapEnd = g[1];
				}

				clip.rect(prevGapEnd, plotTop, plotLft + plotWid - prevGapEnd, plotTop + plotHgt);
			}

			return clip;
		}

		function addGap(gaps, outX, x) {
			var prevGap = gaps[gaps.length - 1];

			if (prevGap && prevGap[0] == outX)			// TODO: gaps must be encoded at stroke widths?
				{ prevGap[1] = x; }
			else
				{ gaps.push([outX, x]); }
		}

		function buildPaths(self, is, _i0, _i1) {
			var s = series[is];

			var xdata  = data[0];
			var ydata  = data[is];
			var scaleX = scales[xScaleKey];
			var scaleY = scales[s.scale];

			var _paths = dir == 1 ? {stroke: new Path2D(), fill: null, clip: null} : series[is-1]._paths;
			var stroke = _paths.stroke;
			var width = round3(s[WIDTH] * pxRatio);

			var minY = inf,
				maxY = -inf,
				outY, outX;

			// todo: don't build gaps on dir = -1 pass
			var gaps = [];

			var accX = round(getXPos(xdata[dir == 1 ? _i0 : _i1], scaleX, plotWid, plotLft));

			// the moves the shape edge outside the canvas so stroke doesnt bleed in
			if (s.band && dir == 1 && _i0 == i0) {
				if (width)
					{ stroke.lineTo(-width, round(getYPos(ydata[_i0], scaleY, plotHgt, plotTop))); }

				if (scaleX.min < xdata[0])
					{ gaps.push([plotLft, accX - 1]); }
			}

			for (var i = dir == 1 ? _i0 : _i1; i >= _i0 && i <= _i1; i += dir) {
				var x = round(getXPos(xdata[i], scaleX, plotWid, plotLft));

				if (x == accX) {
					if (ydata[i] != null) {
						outY = round(getYPos(ydata[i], scaleY, plotHgt, plotTop));
						minY = min(outY, minY);
						maxY = max(outY, maxY);
					}
				}
				else {
					var _addGap = false;

					if (minY != inf) {
						stroke.lineTo(accX, minY);
						stroke.lineTo(accX, maxY);
						stroke.lineTo(accX, outY);
						outX = accX;
					}
					else
						{ _addGap = true; }

					if (ydata[i] != null) {
						outY = round(getYPos(ydata[i], scaleY, plotHgt, plotTop));
						stroke.lineTo(x, outY);
						minY = maxY = outY;

						// prior pixel can have data but still start a gap if ends with null
						if (x - accX > 1 && ydata[i-1] == null)
							{ _addGap = true; }
					}
					else {
						minY = inf;
						maxY = -inf;
					}

					_addGap && addGap(gaps, outX, x);

					accX = x;
				}
			}

			// extend or insert rightmost gap if no data exists to the right
			if (ydata[_i1] == null)
				{ addGap(gaps, outX, accX); }

			if (s.band) {
				var overShoot = width * 100, _iy, _x;

				// the moves the shape edge outside the canvas so stroke doesnt bleed in
				if (dir == -1 && _i0 == i0) {
					_x = plotLft - overShoot;
					_iy = _i0;
				}

				if (dir == 1 && _i1 == i1) {
					_x = plotLft + plotWid + overShoot;
					_iy = _i1;

					if (scaleX.max > xdata[dataLen - 1])
						{ gaps.push([accX, plotLft + plotWid]); }
				}

				stroke.lineTo(_x, round(getYPos(ydata[_iy], scaleY, plotHgt, plotTop)));
			}

			if (dir == 1) {
				_paths.clip = buildClip(is, gaps, ydata[_i0] == null, ydata[_i1] == null);

				if (s.fill != null) {
					var fill = _paths.fill = new Path2D(stroke);

					var fillTo = round(getYPos(s.fillTo(self, is, s.min, s.max), scaleY, plotHgt, plotTop));
					fill.lineTo(plotLft + plotWid, fillTo);
					fill.lineTo(plotLft, fillTo);
				}
			}

			if (s.band)
				{ dir *= -1; }

			return _paths;
		}

		function getIncrSpace(axisIdx, min, max, fullDim) {
			var axis = axes[axisIdx];

			var incrSpace;

			if (fullDim <= 0)
				{ incrSpace = [0, 0]; }
			else {
				var minSpace = axis.space(self, axisIdx, min, max, fullDim);
				var incrs = axis.incrs(self, axisIdx, min, max, fullDim, minSpace);
				incrSpace = findIncr(min, max, incrs, fullDim, minSpace);
			}

			return incrSpace;
		}

		function drawOrthoLines(offs, ori, side, pos0, len, width, stroke, dash) {
			var offset = (width % 2) / 2;

			ctx.translate(offset, offset);

			setCtxStyle(stroke, width, dash);

			ctx.beginPath();

			var x0, y0, x1, y1, pos1 = pos0 + (side == 0 || side == 3 ? -len : len);

			if (ori == 0) {
				y0 = pos0;
				y1 = pos1;
			}
			else {
				x0 = pos0;
				x1 = pos1;
			}

			offs.forEach(function (off, i) {
				if (ori == 0)
					{ x0 = x1 = off; }
				else
					{ y0 = y1 = off; }

				ctx.moveTo(x0, y0);
				ctx.lineTo(x1, y1);
			});

			ctx.stroke();

			ctx.translate(-offset, -offset);
		}

		function drawAxesGrid() {
			axes.forEach(function (axis, i) {
				if (!axis.show)
					{ return; }

				var scale = scales[axis.scale];

				// this will happen if all series using a specific scale are toggled off
				if (scale.min == inf)
					{ return; }

				var side = axis.side;
				var ori = side % 2;

				var min = scale.min;
				var max = scale.max;

				var ref = getIncrSpace(i, min, max, ori == 0 ? plotWidCss : plotHgtCss);
				var incr = ref[0];
				var space = ref[1];

				// if we're using index positions, force first tick to match passed index
				var forceMin = scale.distr == 2;

				var splits = axis.splits(self, i, min, max, incr, space, forceMin);

				var getPos  = ori == 0 ? getXPos : getYPos;
				var plotDim = ori == 0 ? plotWid : plotHgt;
				var plotOff = ori == 0 ? plotLft : plotTop;

				var canOffs = splits.map(function (val) { return round(getPos(val, scale, plotDim, plotOff)); });

				var axisGap  = round(axis.gap * pxRatio);

				var ticks = axis.ticks;
				var tickSize = ticks.show ? round(ticks.size * pxRatio) : 0;

				// tick labels
				// BOO this assumes a specific data/series
				var values = axis.values(
					self,
					scale.distr == 2 ? splits.map(function (i) { return data0[i]; }) : splits,
					i,
					space,
					scale.distr == 2 ? data0[splits[1]] -  data0[splits[0]] : incr
				);

				// rotating of labels only supported on bottom x axis
				var angle = side == 2 ? axis.rotate(self, values, i, space) * -PI/180 : 0;

				var basePos  = round(axis._pos * pxRatio);
				var shiftAmt = tickSize + axisGap;
				var shiftDir = ori == 0 && side == 0 || ori == 1 && side == 3 ? -1 : 1;
				var finalPos = basePos + shiftAmt * shiftDir;
				var y        = ori == 0 ? finalPos : 0;
				var x        = ori == 1 ? finalPos : 0;

				ctx.font         = axis.font[0];
				ctx.fillStyle    = axis.stroke || hexBlack;									// rgba?
				ctx.textAlign    = angle > 0 ? LEFT :
				                   angle < 0 ? RIGHT :
				                   ori == 0 ? "center" : side == 3 ? RIGHT : LEFT;
				ctx.textBaseline = angle ||
				                   ori == 1 ? "middle" : side == 2 ? TOP   : BOTTOM;

				var lineHeight   = axis.font[1] * lineMult;

				values.forEach(function (val, i) {
					if (ori == 0)
						{ x = canOffs[i]; }
					else
						{ y = canOffs[i]; }

					(""+val).split(/\n/gm).forEach(function (text, j) {
						if (angle) {
							ctx.save();
							ctx.translate(x, y + j * lineHeight);
							ctx.rotate(angle);
							ctx.fillText(text, 0, 0);
							ctx.restore();
						}
						else
							{ ctx.fillText(text, x, y + j * lineHeight); }
					});
				});

				// axis label
				if (axis.label) {
					ctx.save();

					var baseLpos = round(axis._lpos * pxRatio);

					if (ori == 1) {
						x = y = 0;

						ctx.translate(
							baseLpos,
							round(plotTop + plotHgt / 2)
						);
						ctx.rotate((side == 3 ? -PI : PI) / 2);

					}
					else {
						x = round(plotLft + plotWid / 2);
						y = baseLpos;
					}

					ctx.font         = axis.labelFont[0];
				//	ctx.fillStyle    = axis.labelStroke || hexBlack;						// rgba?
					ctx.textAlign    = "center";
					ctx.textBaseline = side == 2 ? TOP : BOTTOM;

					ctx.fillText(axis.label, x, y);

					ctx.restore();
				}

				// ticks
				if (ticks.show) {
					drawOrthoLines(
						canOffs,
						ori,
						side,
						basePos,
						tickSize,
						round3(ticks[WIDTH] * pxRatio),
						ticks.stroke
					);
				}

				// grid
				var grid = axis.grid;

				if (grid.show) {
					drawOrthoLines(
						canOffs,
						ori,
						ori == 0 ? 2 : 1,
						ori == 0 ? plotTop : plotLft,
						ori == 0 ? plotHgt : plotWid,
						round3(grid[WIDTH] * pxRatio),
						grid.stroke,
						grid.dash
					);
				}
			});

			fire("drawAxes");
		}

		function resetYSeries() {
		//	log("resetYSeries()", arguments);

			series.forEach(function (s, i) {
				if (i > 0) {
					s.min = inf;
					s.max = -inf;
					s._paths = null;
				}
			});
		}

		var didPaint;

		function paint() {
			if (inBatch) {
				shouldPaint = true;
				return;
			}

		//	log("paint()", arguments);

			ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
			fire("drawClear");
			drawAxesGrid();
			drawSeries();
			didPaint = true;
			fire("draw");
		}

		self.redraw = function (rebuildPaths) {
			if (rebuildPaths !== false)
				{ _setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max); }
			else
				{ paint(); }
		};

		// redraw() => setScale('x', scales.x.min, scales.x.max);

		// explicit, never re-ranged (is this actually true? for x and y)
		function setScale(key, opts) {
			var sc = scales[key];

			if (sc.from == null) {
				if (key == xScaleKey) {
					if (sc.distr == 2) {
						opts.min = closestIdx(opts.min, data[0]);
						opts.max = closestIdx(opts.max, data[0]);
					}

					// prevent setting a temporal x scale too small since Date objects cannot advance ticks smaller than 1ms
					if ( sc.time && axes[0].show && opts.max > opts.min) {
						// since scales and axes are loosly coupled, we have to make some assumptions here :(
						var incr = getIncrSpace(0, opts.min, opts.max, plotWidCss)[0];

						if (incr < 1e-3)
							{ return; }
					}
				}

				if (opts.max - opts.min < 1e-16)
					{ return; }

			//	log("setScale()", arguments);

				pendScales[key] = opts;

				didPaint = false;
				setScales();
				!didPaint && paint();
				didPaint = false;
			}
		}

		self.setScale = setScale;

	//	INTERACTION

		var vt;
		var hz;

		// starting position before cursor.move
		var rawMouseLeft0;
		var rawMouseTop0;

		// starting position
		var mouseLeft0;
		var mouseTop0;

		// current position before cursor.move
		var rawMouseLeft1;
		var rawMouseTop1;

		// current position
		var mouseLeft1;
		var mouseTop1;

		var dragging = false;

		var drag =  cursor.drag;

		var dragX =  drag.x;
		var dragY =  drag.y;

		if ( cursor.show) {
			if (cursor.x) {
				mouseLeft1 = cursor.left;
				vt = placeDiv(CURSOR_X, over);
			}

			if (cursor.y) {
				mouseTop1 = cursor.top;
				hz = placeDiv(CURSOR_Y, over);
			}
		}

		var select = self.select = assign({
			show:   true,
			left:	0,
			width:	0,
			top:	0,
			height:	0,
		}, opts.select);

		var selectDiv = select.show ? placeDiv(SELECT, over) : null;

		function setSelect(opts, _fire) {
			if (select.show) {
				for (var prop in opts)
					{ setStylePx(selectDiv, prop, select[prop] = opts[prop]); }

				_fire !== false && fire("setSelect");
			}
		}

		self.setSelect = setSelect;

		function toggleDOM(i, onOff) {
			var s = series[i];
			var label = showLegend ? legendRows[i][0].parentNode : null;

			if (s.show)
				{ label && remClass(label, OFF); }
			else {
				label && addClass(label, OFF);
				 cursorPts.length > 1 && trans(cursorPts[i], 0, -10);
			}
		}

		function _setScale(key, min, max) {
			setScale(key, {min: min, max: max});
		}

		function setSeries(i, opts, pub) {
		//	log("setSeries()", arguments);

			var s = series[i];

		//	batch(() => {
				// will this cause redundant paint() if both show and focus are set?
				if (opts.focus != null)
					{ setFocus(i); }

				if (opts.show != null) {
					s.show = opts.show;
					 toggleDOM(i, opts.show);

					if (s.band) {
						// not super robust, will break if two bands are adjacent
						var ip = series[i+1] && series[i+1].band ? i+1 : i-1;
						series[ip].show = s.show;
						 toggleDOM(ip, opts.show);
					}

					_setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);		// redraw
				}
		//	});

			// firing setSeries after setScale seems out of order, but provides access to the updated props
			// could improve by predefining firing order and building a queue
			fire("setSeries", i, opts);

			 pub && sync.pub("setSeries", self, i, opts);
		}

		self.setSeries = setSeries;

		function _alpha(i, value) {
			series[i].alpha = value;

			if ( cursor.show && cursorPts[i])
				{ cursorPts[i].style.opacity = value; }

			if ( showLegend && legendRows[i])
				{ legendRows[i][0].parentNode.style.opacity = value; }
		}

		function _setAlpha(i, value) {
			var s = series[i];

			_alpha(i, value);

			if (s.band) {
				// not super robust, will break if two bands are adjacent
				var ip = series[i+1].band ? i+1 : i-1;
				_alpha(ip, value);
			}
		}

		// y-distance
		var closestDist;
		var closestSeries;
		var focusedSeries;

		function setFocus(i) {
			if (i != focusedSeries) {
			//	log("setFocus()", arguments);

				series.forEach(function (s, i2) {
					_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : focus.alpha);
				});

				focusedSeries = i;
				paint();
			}
		}

		if (showLegend && cursorFocus) {
			on(mouseleave, legendEl, function (e) {
				if (cursor.locked)
					{ return; }
				setSeries(null, {focus: false}, syncOpts.setSeries);
				updateCursor();
			});
		}

		function scaleValueAtPos(pos, scale) {
			var dim = plotWidCss;

			if (scale != xScaleKey) {
				dim = plotHgtCss;
				pos = dim - pos;
			}

			var pct = pos / dim;

			var sc = scales[scale],
				_min = sc.min,
				_max = sc.max;

			if (sc.distr == 3) {
				_min = log10(_min);
				_max = log10(_max);
				return pow(10, _min + (_max - _min) * pct);
			}
			else
				{ return _min + (_max - _min) * pct; }
		}

		function closestIdxFromXpos(pos) {
			var v = scaleValueAtPos(pos, xScaleKey);
			return closestIdx(v, data[0], i0, i1);
		}

		self.valToIdx = function (val) { return closestIdx(val, data[0]); };
		self.posToIdx = closestIdxFromXpos;
		self.posToVal = scaleValueAtPos;
		self.valToPos = function (val, scale, can) { return (
			scale == xScaleKey ?
			getXPos(val, scales[scale],
				can ? plotWid : plotWidCss,
				can ? plotLft : 0
			) :
			getYPos(val, scales[scale],
				can ? plotHgt : plotHgtCss,
				can ? plotTop : 0
			)
		); };

		var inBatch = false;
		var shouldPaint = false;
		var shouldSetScales = false;
		var shouldUpdateCursor = false;

		// defers calling expensive functions
		function batch(fn) {
			inBatch = true;
			fn(self);
			inBatch = false;
			shouldSetScales && setScales();
			 shouldUpdateCursor && updateCursor();
			shouldPaint && !didPaint && paint();
			shouldSetScales = shouldUpdateCursor = shouldPaint = didPaint = inBatch;
		}

		self.batch = batch;

		 (self.setCursor = function (opts) {
			mouseLeft1 = opts.left;
			mouseTop1 = opts.top;
		//	assign(cursor, opts);
			updateCursor();
		});

		var cursorRaf = 0;

		function updateCursor(ts, src) {
			var assign;

			if (inBatch) {
				shouldUpdateCursor = true;
				return;
			}

		//	ts == null && log("updateCursor()", arguments);

			cursorRaf = 0;

			rawMouseLeft1 = mouseLeft1;
			rawMouseTop1 = mouseTop1;

			(assign = cursor.move(self, mouseLeft1, mouseTop1), mouseLeft1 = assign[0], mouseTop1 = assign[1]);

			if (cursor.show) {
				cursor.x && trans(vt,round(mouseLeft1),0);
				cursor.y && trans(hz,0,round(mouseTop1));
			}

			var idx;

			// when zooming to an x scale range between datapoints the binary search
			// for nearest min/max indices results in this condition. cheap hack :D
			var noDataInRange = i0 > i1;

			closestDist = inf;

			// if cursor hidden, hide points & clear legend vals
			if (mouseLeft1 < 0 || dataLen == 0 || noDataInRange) {
				idx = null;

				for (var i = 0; i < series.length; i++) {
					if (i > 0) {
						 cursorPts.length > 1 && trans(cursorPts[i], -10, -10);
					}

					if (showLegend && legend.live) {
						if (i == 0 && multiValLegend)
							{ continue; }

						for (var j = 0; j < legendRows[i].length; j++)
							{ legendRows[i][j][firstChild].nodeValue = '--'; }
					}
				}

				if (cursorFocus)
					{ setSeries(null, {focus: true}, syncOpts.setSeries); }
			}
			else {
			//	let pctY = 1 - (y / rect[HEIGHT]);

				idx = closestIdxFromXpos(mouseLeft1);

				var scX = scales[xScaleKey];

				var xPos = round3(getXPos(data[0][idx], scX, plotWidCss, 0));

				for (var i$1 = 0; i$1 < series.length; i$1++) {
					var s = series[i$1];

					var idx2 = cursor.dataIdx(self, i$1, idx);
					var xPos2 = idx2 == idx ? xPos : round3(getXPos(data[0][idx2], scX, plotWidCss, 0));

					if (i$1 > 0 && s.show) {
						var valAtIdx = data[i$1][idx2];

						var yPos = valAtIdx == null ? -10 : round3(getYPos(valAtIdx, scales[s.scale], plotHgtCss, 0));

						if (yPos > 0) {
							var dist = abs(yPos - mouseTop1);

							if (dist <= closestDist) {
								closestDist = dist;
								closestSeries = i$1;
							}
						}

						 cursorPts.length > 1 && trans(cursorPts[i$1], xPos2, yPos);
					}

					if (showLegend && legend.live) {
						if ((idx2 == cursor.idx && !forceUpdateLegend) || i$1 == 0 && multiValLegend)
							{ continue; }

						var src$1 = i$1 == 0 && xScaleDistr == 2 ? data0 : data[i$1];

						var vals = multiValLegend ? s.values(self, i$1, idx2) : {_: s.value(self, src$1[idx2], i$1, idx2)};

						var j$1 = 0;

						for (var k in vals)
							{ legendRows[i$1][j$1++][firstChild].nodeValue = vals[k]; }
					}
				}

				forceUpdateLegend = false;
			}

			// nit: cursor.drag.setSelect is assumed always true
			if (select.show && dragging) {
				if (src != null) {
					var ref = syncOpts.scales;
					var xKey = ref[0];
					var yKey = ref[1];

					// match the dragX/dragY implicitness/explicitness of src
					var sdrag = src.cursor.drag;
					dragX = sdrag._x;
					dragY = sdrag._y;

					if (xKey) {
						var sc = scales[xKey];
						var srcLeft = src.posToVal(src.select[LEFT], xKey);
						var srcRight = src.posToVal(src.select[LEFT] + src.select[WIDTH], xKey);

						select[LEFT] = getXPos(srcLeft, sc, plotWidCss, 0);
						select[WIDTH] = abs(select[LEFT] - getXPos(srcRight, sc, plotWidCss, 0));

						setStylePx(selectDiv, LEFT, select[LEFT]);
						setStylePx(selectDiv, WIDTH, select[WIDTH]);

						if (!yKey) {
							setStylePx(selectDiv, TOP, select[TOP] = 0);
							setStylePx(selectDiv, HEIGHT, select[HEIGHT] = plotHgtCss);
						}
					}

					if (yKey) {
						var sc$1 = scales[yKey];
						var srcTop = src.posToVal(src.select[TOP], yKey);
						var srcBottom = src.posToVal(src.select[TOP] + src.select[HEIGHT], yKey);

						select[TOP] = getYPos(srcTop, sc$1, plotHgtCss, 0);
						select[HEIGHT] = abs(select[TOP] - getYPos(srcBottom, sc$1, plotHgtCss, 0));

						setStylePx(selectDiv, TOP, select[TOP]);
						setStylePx(selectDiv, HEIGHT, select[HEIGHT]);

						if (!xKey) {
							setStylePx(selectDiv, LEFT, select[LEFT] = 0);
							setStylePx(selectDiv, WIDTH, select[WIDTH] = plotWidCss);
						}
					}
				}
				else {
					var rawDX = abs(rawMouseLeft1 - rawMouseLeft0);
					var rawDY = abs(rawMouseTop1 - rawMouseTop0);

					dragX = drag.x && rawDX >= drag.dist;
					dragY = drag.y && rawDY >= drag.dist;

					var uni = drag.uni;

					if (uni != null) {
						// only calc drag status if they pass the dist thresh
						if (dragX && dragY) {
							dragX = rawDX >= uni;
							dragY = rawDY >= uni;

							// force unidirectionality when both are under uni limit
							if (!dragX && !dragY) {
								if (rawDY > rawDX)
									{ dragY = true; }
								else
									{ dragX = true; }
							}
						}
					}
					else if (drag.x && drag.y && (dragX || dragY))
						// if omni with no uni then both dragX / dragY should be true if either is true
						{ dragX = dragY = true; }

					if (dragX) {
						var minX = min(mouseLeft0, mouseLeft1);
						var dx = abs(mouseLeft1 - mouseLeft0);

						setStylePx(selectDiv, LEFT,  select[LEFT] = minX);
						setStylePx(selectDiv, WIDTH, select[WIDTH] = dx);

						if (!dragY) {
							setStylePx(selectDiv, TOP, select[TOP] = 0);
							setStylePx(selectDiv, HEIGHT, select[HEIGHT] = plotHgtCss);
						}
					}

					if (dragY) {
						var minY = min(mouseTop0, mouseTop1);
						var dy = abs(mouseTop1 - mouseTop0);

						setStylePx(selectDiv, TOP,    select[TOP] = minY);
						setStylePx(selectDiv, HEIGHT, select[HEIGHT] = dy);

						if (!dragX) {
							setStylePx(selectDiv, LEFT, select[LEFT] = 0);
							setStylePx(selectDiv, WIDTH, select[WIDTH] = plotWidCss);
						}
					}

					if (!dragX && !dragY) {
						// the drag didn't pass the dist requirement
						setStylePx(selectDiv, HEIGHT, select[HEIGHT] = 0);
						setStylePx(selectDiv, WIDTH,  select[WIDTH]  = 0);
					}
				}
			}

			cursor.idx = idx;
			cursor.left = mouseLeft1;
			cursor.top = mouseTop1;
			drag._x = dragX;
			drag._y = dragY;

			// if ts is present, means we're implicitly syncing own cursor as a result of debounced rAF
			if (ts != null) {
				// this is not technically a "mousemove" event, since it's debounced, rename to setCursor?
				// since this is internal, we can tweak it later
				sync.pub(mousemove, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, idx);

				if (cursorFocus) {
					setSeries(closestDist <= focus.prox ? closestSeries : null, {focus: true}, syncOpts.setSeries);
				}
			}

			ready && fire("setCursor");
		}

		var rect = null;

		function syncRect() {
			rect = over.getBoundingClientRect();
		}

		function mouseMove(e, src, _x, _y, _w, _h, _i) {
			if (cursor.locked)
				{ return; }

			cacheMouse(e, src, _x, _y, _w, _h, _i, false, e != null);

			if (e != null) {
				if (cursorRaf == 0)
					{ cursorRaf = rAF(updateCursor); }
			}
			else
				{ updateCursor(null, src); }
		}

		function cacheMouse(e, src, _x, _y, _w, _h, _i, initial, snap) {
			var assign;

			if (e != null) {
				_x = e.clientX - rect.left;
				_y = e.clientY - rect.top;
			}
			else {
				if (_x < 0 || _y < 0) {
					mouseLeft1 = -10;
					mouseTop1 = -10;
					return;
				}

				var ref = syncOpts.scales;
				var xKey = ref[0];
				var yKey = ref[1];

				if (xKey != null)
					{ _x = getXPos(src.posToVal(_x, xKey), scales[xKey], plotWidCss, 0); }
				else
					{ _x = plotWidCss * (_x/_w); }

				if (yKey != null)
					{ _y = getYPos(src.posToVal(_y, yKey), scales[yKey], plotHgtCss, 0); }
				else
					{ _y = plotHgtCss * (_y/_h); }
			}

			if (snap) {
				if (_x <= 1 || _x >= plotWidCss - 1)
					{ _x = incrRound(_x, plotWidCss); }

				if (_y <= 1 || _y >= plotHgtCss - 1)
					{ _y = incrRound(_y, plotHgtCss); }
			}

			if (initial) {
				rawMouseLeft0 = _x;
				rawMouseTop0 = _y;

				(assign = cursor.move(self, _x, _y), mouseLeft0 = assign[0], mouseTop0 = assign[1]);
			}
			else {
				mouseLeft1 = _x;
				mouseTop1 = _y;
			}
		}

		function hideSelect() {
			setSelect({
				width: 0,
				height: 0,
			}, false);
		}

		function mouseDown(e, src, _x, _y, _w, _h, _i) {
			if (src != null || filtMouse(e)) {
				dragging = true;
				dragX = dragY = drag._x = drag._y = false;

				cacheMouse(e, src, _x, _y, _w, _h, _i, true, false);

				if (e != null) {
					on(mouseup, doc, mouseUp);
					sync.pub(mousedown, self, mouseLeft0, mouseTop0, plotWidCss, plotHgtCss, null);
				}
			}
		}

		function mouseUp(e, src, _x, _y, _w, _h, _i) {
			if (src != null || filtMouse(e)) {
				dragging = drag._x = drag._y = false;

				cacheMouse(e, src, _x, _y, _w, _h, _i, false, true);

				var hasSelect = select[WIDTH] > 0 || select[HEIGHT] > 0;

				hasSelect && setSelect(select);

				if (drag.setScale && hasSelect) {
				//	if (syncKey != null) {
				//		dragX = drag.x;
				//		dragY = drag.y;
				//	}

					batch(function () {
						if (dragX) {
							_setScale(xScaleKey,
								scaleValueAtPos(select[LEFT], xScaleKey),
								scaleValueAtPos(select[LEFT] + select[WIDTH], xScaleKey)
							);
						}

						if (dragY) {
							for (var k in scales) {
								var sc = scales[k];

								if (k != xScaleKey && sc.from == null) {
									_setScale(k,
										scaleValueAtPos(select[TOP] + select[HEIGHT], k),
										scaleValueAtPos(select[TOP], k)
									);
								}
							}
						}
					});

					hideSelect();
				}
				else if (cursor.lock) {
					cursor.locked = !cursor.locked;

					if (!cursor.locked)
						{ updateCursor(); }
				}
			}

			if (e != null) {
				off(mouseup, doc, mouseUp);
				sync.pub(mouseup, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
			}
		}

		function mouseLeave(e, src, _x, _y, _w, _h, _i) {
			if (!cursor.locked) {
				var _dragging = dragging;

				if (dragging) {
					// handle case when mousemove aren't fired all the way to edges by browser
					var snapX = true;
					var snapY = true;
					var snapProx = 10;

					if (dragX && dragY) {
						// maybe omni corner snap
						snapX = mouseLeft1 <= snapProx || mouseLeft1 >= plotWidCss - snapProx;
						snapY = mouseTop1  <= snapProx || mouseTop1  >= plotHgtCss - snapProx;
					}

					if (dragX && snapX) {
						var dLft = mouseLeft1;
						var dRgt = plotWidCss - mouseLeft1;

						var xMin = min(dLft, dRgt);

						if (xMin == dLft)
							{ mouseLeft1 = 0; }
						if (xMin == dRgt)
							{ mouseLeft1 = plotWidCss; }
					}

					if (dragY && snapY) {
						var dTop = mouseTop1;
						var dBtm = plotHgtCss - mouseTop1;

						var yMin = min(dTop, dBtm);

						if (yMin == dTop)
							{ mouseTop1 = 0; }
						if (yMin == dBtm)
							{ mouseTop1 = plotHgtCss; }
					}

					updateCursor(1);

					dragging = false;
				}

				mouseLeft1 = -10;
				mouseTop1 = -10;

				// passing a non-null timestamp to force sync/mousemove event
				updateCursor(1);

				if (_dragging)
					{ dragging = _dragging; }
			}
		}

		function dblClick(e, src, _x, _y, _w, _h, _i) {
			autoScaleX();

			hideSelect();

			if (e != null)
				{ sync.pub(dblclick, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null); }
		}

		// internal pub/sub
		var events = {};

		events[mousedown] = mouseDown;
		events[mousemove] = mouseMove;
		events[mouseup] = mouseUp;
		events[dblclick] = dblClick;
		events["setSeries"] = function (e, src, idx, opts) {
			setSeries(idx, opts);
		};

		var deb;

		if ( cursor.show) {
			on(mousedown, over, mouseDown);
			on(mousemove, over, mouseMove);
			on(mouseenter, over, syncRect);
			// this has to be rAF'd so it always fires after the last queued/rAF'd updateCursor
			on(mouseleave, over, function (e) { rAF(mouseLeave); });

			on(dblclick, over, dblClick);

			deb = debounce(syncRect, 100);

			on(resize, win, deb);
			on(scroll, win, deb);

			self.syncRect = syncRect;
		}

		// external on/off
		var hooks = self.hooks = opts.hooks || {};

		function fire(evName, a1, a2) {
			if (evName in hooks) {
				hooks[evName].forEach(function (fn) {
					fn.call(null, self, a1, a2);
				});
			}
		}

		(opts.plugins || []).forEach(function (p) {
			for (var evName in p.hooks)
				{ hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]); }
		});

		var syncOpts =  assign({
			key: null,
			setSeries: false,
			scales: [xScaleKey, null]
		}, cursor.sync);

		var syncKey =  syncOpts.key;

		var sync =  (syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync());

		 sync.sub(self);

		function pub(type, src, x, y, w, h, i) {
			events[type](null, src, x, y, w, h, i);
		}

		 (self.pub = pub);

		function destroy() {
			 sync.unsub(self);
			 off(resize, win, deb);
			 off(scroll, win, deb);
			root.remove();
			fire("destroy");
		}

		self.destroy = destroy;

		function _init() {
			_setSize(opts[WIDTH], opts[HEIGHT]);

			fire("init", opts, data);

			setData(data || opts.data, false);

			if (pendScales[xScaleKey])
				{ setScale(xScaleKey, pendScales[xScaleKey]); }
			else
				{ autoScaleX(); }

			setSelect(select, false);

			ready = true;

			fire("ready");
		}

		if (then) {
			if (then instanceof HTMLElement) {
				then.appendChild(root);
				_init();
			}
			else
				{ then(self, _init); }
		}
		else
			{ _init(); }

		return self;
	}

	uPlot.assign = assign;
	uPlot.fmtNum = fmtNum;
	uPlot.rangeNum = rangeNum;
	uPlot.rangeLog = rangeLog;

	{
		uPlot.fmtDate = fmtDate;
		uPlot.tzDate  = tzDate;
	}

	return uPlot;

}());
