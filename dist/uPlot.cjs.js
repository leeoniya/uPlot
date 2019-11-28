/**
* Copyright (c) 2019, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* uPlot.js (μPlot)
* An exceptionally fast, tiny time series chart
* https://github.com/leeoniya/uPlot (v0.1.0)
*/

'use strict';

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

var days3 = days.map(slice3);

var months3 = months.map(slice3);

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
	MMMM:	function (d) { return months[d[getMonth]()]; },
	// Jul
	MMM:	function (d) { return months3[d[getMonth]()]; },
	// 07
	MM:		function (d) { return zeroPad2(d[getMonth]()+1); },
	// 7
	M:		function (d) { return d[getMonth]()+1; },
	// 09
	DD:		function (d) { return zeroPad2(d[getDate]()); },
	// 9
	D:		function (d) { return d[getDate](); },
	// Monday
	WWWW:	function (d) { return days[d[getDay]()]; },
	// Mon
	WWW:	function (d) { return days3[d[getDay]()]; },
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

function fmtDate(tpl) {
	var parts = [];

	var R = /\{([a-z]+)\}|[^{]+/yi, m;

	while (m = R.exec(tpl))
		{ parts.push(m[0][0] == '{' ? subs[m[1]] : m[0]); }

	return function (d) {
		var out = '';

		for (var i = 0; i < parts.length; i++)
			{ out += typeof parts[i] == "string" ? parts[i] : parts[i](d); }

		return out;
	}
}

// https://stackoverflow.com/questions/15141762/how-to-initialize-a-javascript-date-to-a-particular-time-zone/53652131#53652131
function tzDate(date, tz) {
	return new Date(date.toLocaleString('en-US', {timeZone: tz}));
}

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

function getMinMax(data, _i0, _i1) {
//	console.log("getMinMax()");

	var _min = inf;
	var _max = -inf;

	for (var i = _i0; i <= _i1; i++) {
		_min = min(_min, data[i]);
		_max = max(_max, data[i]);
	}

	return [_min, _max];
}

var M = Math;

var abs = M.abs;
var floor = M.floor;
var round = M.round;
var ceil = M.ceil;
var min = M.min;
var max = M.max;
var pow = M.pow;
var log10 = M.log10;

var inf = Infinity;

/*
export function incrRound() {
	return round(num/incr)*incr;
}
*/

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

function round6(val) {
	return round(val * 1e6) / 1e6;
}

var assign = Object.assign;

var isArr = Array.isArray;

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

/*
function isObj(v) {
	return typeof v === 'object' && v !== null;
}

// https://stackoverflow.com/a/34624648
function copy(o) {
	var _out, v, _key;
	_out = Array.isArray(o) ? [] : {};
	for (_key in o) {
		v = o[_key];
		_out[_key] = isObj(v) ? copy(v) : v;
	}
	return _out;
}

// https://github.com/jaredreich/tread
function merge(oldObject, newObject) {
	var obj = oldObject
	for (var key in newObject) {
		if (isObj(obj[key]))
			merge(obj[key], newObject[key]);
		else
			obj[key] = newObject[key];
	}
	return obj;
}
*/

var WIDTH = "width";
var HEIGHT = "height";
var TOP = "top";
var BOTTOM = "bottom";
var LEFT = "left";
var RIGHT = "right";
var firstChild = "firstChild";
var nextSibling = "nextSibling";
var createElement = "createElement";
var hexBlack = "#000";
var classList = "classList";

var mousemove = "mousemove";
var mousedown = "mousedown";
var mouseup = "mouseup";
var dblclick = "dblclick";
var resize = "resize";
var scroll = "scroll";

var rAF = requestAnimationFrame;
var doc = document;
var win = window;
var pxRatio = devicePixelRatio;

function addClass(el, c) {
	el[classList].add(c);
}

function remClass(el, c) {
	el[classList].remove(c);
}

function setStylePx(el, name, value) {
	el.style[name] = value + "px";
}

function setOriRotTrans(style, origin, rot, trans) {
	style.transformOrigin = origin;
	style.transform = "rotate(" + rot + "deg) translateY(" + trans + "px)";
}

function makeCanvas(wid, hgt) {
	var can = doc[createElement]("canvas");
	var ctx = can.getContext("2d");

	can[WIDTH] = round(wid * pxRatio);
	can[HEIGHT] = round(hgt * pxRatio);
	setStylePx(can, WIDTH, wid);
	setStylePx(can, HEIGHT, hgt);

	return {
		can: can,
		ctx: ctx,
	};
}

function placeTag(tag, cls, targ) {
	var el = doc[createElement](tag);

	if (cls != null)
		{ addClass(el, cls); }

	if (targ != null)
		{ targ.appendChild(el); }

	return el;
}

function placeDiv(cls, targ) {
	return placeTag("div", cls, targ);
}

function clearFrom(ch) {
	var next;
	while (next = ch[nextSibling])
		{ next.remove(); }
	ch.remove();
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

//export const series = [];

// default formatters:

var grid = {
	color: "#eee",
	width: 2,
//	dash: [],
};

var s = 1,
	m = 60,
	h = m * m,
	d = h * 24,
	mo = d * 30,
	y = d * 365;

var dec = [
	0.001,
	0.002,
	0.005,
	0.010,
	0.020,
	0.050,
	0.100,
	0.200,
	0.500 ];

var timeIncrs = dec.concat([
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

function timeAxisStamps(stampCfg) {
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

// [0]: minimum num secs in the tick incr
// [1]: normal tick format
// [2]: when a differing <x> is encountered - 1: sec, 2: min, 3: hour, 4: day, 5: week, 6: month, 7: year
// [3]: use a longer more contextual format
// [4]: modes: 0: replace [1] -> [3], 1: concat [1] + [3]
var _timeAxisStamps = timeAxisStamps([
	[y,        yyyy,                 7,   "",       1],
	[d * 28,   "{MMM}",              7,   NLyyyy,   1],
	[d,        md,                   7,   NLyyyy,   1],
	[h,        "{h}{aa}",            4,   NLmd,     1],
	[m,        "{h}:{mm}{aa}",       4,   NLmd,     1],
	[s,        "{h}:{mm}:{ss}{aa}",  4,   NLmd,     1] ]);

// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
function timeAxisVals(tzDate, stamps) {
	return function (ticks, space) {
		var incr = ticks[1] - ticks[0];

		// these track boundaries when a full label is needed again
		var prevYear = null;
		var prevDate = null;

		return ticks.map(function (tick, i) {
			var date = tzDate(tick);

			var newYear = date[getFullYear]();
			var newDate = date[getDate]();

			var diffYear = newYear != prevYear;
			var diffDate = newDate != prevDate;

			var s = stamps.find(function (e) { return incr >= e[0]; });
			var stamp = s[2] == 7 && diffYear || s[2] == 4 && diffDate ? s[3] : s[1];

			prevYear = newYear;
			prevDate = newDate;

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
function timeAxisTicks(tzDate) {
	return function (scaleMin, scaleMax, incr, pctSpace) {
		var ticks = [];
		var isMo = incr >= mo && incr < y;

		// get the timezone-adjusted date
		var minDate = tzDate(scaleMin);
		var minDateTs = minDate / 1e3;

		// get ts of 12am (this lands us at or before the original scaleMin)
		var minMin = mkDate(minDate[getFullYear](), minDate[getMonth](), isMo ? 1 : minDate[getDate]());
		var minMinTs = minMin / 1e3;

		if (isMo) {
			var moIncr = incr / mo;
		//	let tzOffset = scaleMin - minDateTs;		// needed?
			var tick = minDateTs == minMinTs ? minDateTs : mkDate(minMin[getFullYear](), minMin[getMonth]() + moIncr, 1) / 1e3;
			var tickDate = new Date(tick * 1e3);
			var baseYear = tickDate[getFullYear]();
			var baseMonth = tickDate[getMonth]();

			for (var i = 0; tick <= scaleMax; i++) {
				var next = mkDate(baseYear, baseMonth + moIncr * i, 1);
				tick = next / 1e3;

				if (tick <= scaleMax)
					{ ticks.push(tick); }
			}
		}
		else {
			var incr0 = incr >= d ? d : incr;
			var tzOffset = scaleMin - minDateTs;
			var tick$1 = minMinTs + tzOffset + incrRoundUp(minDateTs - minMinTs, incr0);
			ticks.push(tick$1);

			var date0 = tzDate(tick$1);

			var prevHour = date0[getHours]() + (date0[getMinutes]() / m) + (date0[getSeconds]() / h);
			var incrHours = incr / h;

			while (1) {
				tick$1 += incr;

				var expectedHour = floor(prevHour + incrHours) % 24;
				var tickDate$1 = tzDate(tick$1);
				var actualHour = tickDate$1.getHours();

				var dstShift = actualHour - expectedHour;

				if (dstShift > 1)
					{ dstShift = -1; }

				tick$1 -= dstShift * h;

				if (tick$1 > scaleMax)
					{ break; }

				prevHour = (prevHour + incrHours) % 24;

				// add a tick only if it's further than 70% of the min allowed label spacing
				var prevTick = ticks[ticks.length - 1];
				var pctIncr = (tick$1 - prevTick) / incr;

				if (pctIncr * pctSpace >= .7)
					{ ticks.push(tick$1); }
			}
		}

		return ticks;
	}
}

var longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

function timeSeriesVal(tzDate) {
	return function (val) { return longDateHourMin(tzDate(val)); };
}

var xAxisOpts = {
	show: true,
	scale: 'x',
	space: 50,
	height: 53,
	side: 0,
	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
	grid: grid,
};

var numSeriesLabel = "Value";
var timeSeriesLabel = "Time";

var xSeriesOpts = {
//	type: "t",
	scale: "x",
//	label: "Time",
//	value: v => stamp(new Date(v * 1e3)),

	// internal caches
	min: inf,
	max: -inf,
};

var numIncrs = dec.concat([1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9]);

function numAxisVals(ticks, space) {
	return ticks;
}

function numAxisTicks(scaleMin, scaleMax, incr, pctSpace, forceMin) {
	scaleMin = forceMin ? scaleMin : round6(incrRoundUp(scaleMin, incr));

	var ticks = [];

	for (var val = scaleMin; val <= scaleMax; val = round6(val + incr))
		{ ticks.push(val); }

	return ticks;
}

function numSeriesVal(val) {
	return val;
}

var yAxisOpts = {
	show: true,
	scale: 'y',
	space: 40,
	width: 50,
	side: 1,
	class: "y-vals",
//	incrs: numIncrs,
//	values: (vals, space) => vals,
	grid: grid,
};

var ySeriesOpts = {
//	type: "n",
	scale: "y",
	show: true,
	band: false,
	alpha: 1,
//	label: "Value",
//	value: v => v,
	values: null,

	// internal caches
	min: inf,
	max: -inf,

	path: null,
};

/*
export const scales = {
	x: {
		min: Infinity,
		max: -Infinity,
	},
	y: {
		min: Infinity,
		max: -Infinity,
	},
};
*/

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

// TODO: reduce need to locate indexes for redraw or resetting / unzoom

function setDefaults(d, xo, yo) {
	return [].concat(d.x, d.y).map(function (o, i) { return assign({}, (i == 0 ? xo : yo), o); });
}

function splitXY(d) {
	return {
		x: d[0],
		y: d.slice(1),
	};
}

function getYPos(val, scale, hgt) {
	if (val == null)
		{ return val; }

	var pctY = (val - scale.min) / (scale.max - scale.min);
	return round((1 - pctY) * hgt);
}

function getXPos(val, scale, wid) {
	var pctX = (val - scale.min) / (scale.max - scale.min);
	return round(pctX * wid);
}

function snapNone(dataMin, dataMax) {
	return [dataMin, dataMax];
}

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
function snapFifthMag(dataMin, dataMax) {
	// auto-scale Y
	var delta = dataMax - dataMin;
	var mag = log10(delta || abs(dataMax) || 1);
	var exp = floor(mag);
	var incr = pow(10, exp) / 5;
	var buf = delta == 0 ? incr : 0;

	var snappedMin = round6(incrRoundDn(dataMin - buf, incr));
	var snappedMax = round6(incrRoundUp(dataMax + buf, incr));

	// for flat data, always use 0 as one chart extreme
	if (delta == 0) {
		if (dataMax > 0)
			{ snappedMin = 0; }
		else if (dataMax < 0)
			{ snappedMax = 0; }
	}
	else {
		// if buffer is too small, increase it
		if (snappedMax - dataMax < incr)
			{ snappedMax += incr; }

		if (dataMin - snappedMin < incr)
			{ snappedMin -= incr; }

		// if original data never crosses 0, use 0 as one chart extreme
		if (dataMin >= 0 && snappedMin < 0)
			{ snappedMin = 0; }

		if (dataMax <= 0 && snappedMax > 0)
			{ snappedMax = 0; }
	}

	return [snappedMin, snappedMax];
}

// dim is logical (getClientBoundingRect) pixels, not canvas pixels
function findIncr(valDelta, incrs, dim, minSpace) {
	var pxPerUnit = dim / valDelta;

	for (var i = 0; i < incrs.length; i++) {
		var space = incrs[i] * pxPerUnit;

		if (space >= minSpace)
			{ return [incrs[i], space]; }
	}
}

function gridLabel(el, par, val, side, pxVal) {
	var div = el || placeDiv(null, par);
	div.textContent = val;
	setStylePx(div, side, pxVal);
	return div;
}

function filtMouse(e) {
	return e.button == 0;
}

function Line(opts, data) {
	opts = copy(opts);

	var self = this;

	var series  = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
	var axes    = setDefaults(opts.axes || {}, xAxisOpts, yAxisOpts);
	var scales  = (opts.scales = opts.scales || {});

	var spanGaps = opts.spanGaps || false;

//	self.tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
	var tzDate = opts.tzDate || (function (ts) { return new Date(ts * 1e3); });

	var _timeAxisTicks = timeAxisTicks(tzDate);
	var _timeAxisVals = timeAxisVals(tzDate, _timeAxisStamps);
	var _timeSeriesVal = timeSeriesVal(tzDate);

	self.series = splitXY(series);
	self.axes = splitXY(axes);
	self.scales = scales;

	var legendOpts = assign({show: true}, opts.legend);

	// set default value
	series.forEach(function (s, i) {
		// init scales & defaults
		var key = s.scale;

		var sc = scales[key] = assign({
			type: 1,
			time: i == 0,
			auto: true,
			min:  inf,
			max: -inf,
		}, scales[key]);

		// by default, numeric y scales snap to half magnitude of range
		sc.range = fnOrSelf(sc.range || (i > 0 && !sc.time ? snapFifthMag : snapNone));

		if (s.time == null)
			{ s.time = sc.time; }

		var isTime = s.time;

		s.value = s.value || (isTime ? _timeSeriesVal  : numSeriesVal);
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	var xScaleKey = series[0].scale;
	var xScaleType = scales[xScaleKey].type;

	var cursor = assign({show: true, cross: true}, opts.cursor);		// focus: {alpha, prox}

	var focus = cursor.focus;

	var dataLen;

	// rendered data window
	var i0 = null;
	var i1 = null;

	var data0 = null;

	function setData(_data, _min, _max) {
		data = _data.slice();
		data0 = data[0];
		dataLen = data0.length;

		if (xScaleType == 2)
			{ data[0] = data0.map(function (v, i) { return i; }); }

		resetSeries();

		setScale(
			xScaleKey,
			_min != null ? _min : data[0][0],
			_max != null ? _max : data[0][dataLen - 1]
		);
	}

	self.setData = setData;

	function setCtxStyle(color, width, dash, fill) {
		ctx.strokeStyle = color || hexBlack;
		ctx.lineWidth = width || 1;
		ctx.lineJoin = "round";
		ctx.setLineDash(dash || []);
		ctx.fillStyle = fill || hexBlack;
	}

	var root = placeDiv("uplot");

	if (opts.id != null)
		{ root.id = opts.id; }

	if (opts.class != null)
		{ addClass(root, opts.class); }

	if (opts.title != null) {
		var title = placeDiv("title", root);
		title.textContent = opts.title;
	}

	var wrap = placeDiv("wrap", root);

	var plot = placeDiv("plot", wrap);

	var fullCssWidth = opts[WIDTH];
	var fullCssHeight = opts[HEIGHT];

	var canCssWidth = fullCssWidth;
	var canCssHeight = fullCssHeight;

	// plot margins to account for axes
	var plotLft = 0;
	var plotTop = 0;

	var LABEL_HEIGHT = 30;

	// easement for rightmost x label if no right y axis exists
	var hasRightAxis = false;
	var hasLeftAxis = false;

	// accumulate axis offsets, reduce canvas width
	axes.forEach(function (axis, i) {
		if (!axis.show)
			{ return; }

		var side = axis.side;
		var isVt = side % 2;
		var lab = axis.label != null ? LABEL_HEIGHT : 0;

		if (isVt) {
			var w = axis[WIDTH] + lab;
			canCssWidth -= w;

			if (side == 1) {
				plotLft += w;
				hasLeftAxis = true;
			}
			else
				{ hasRightAxis = true; }
		}
		else {
			var h = axis[HEIGHT] + lab;
			canCssHeight -= h;

			if (side == 2)
				{ plotTop += h; }
		}

		if (axis.time == null)
			{ axis.time = scales[axis.scale].time; }

		var sc = scales[axis.scale];

		// also set defaults for incrs & values based on axis type
		var isTime = axis.time;

		axis.space = fnOrSelf(axis.space);
		axis.incrs = axis.incrs          || (isTime && sc.type == 1 ? timeIncrs      : numIncrs);
		axis.ticks = fnOrSelf(axis.ticks || (isTime && sc.type == 1 ? _timeAxisTicks : numAxisTicks));
		var av = axis.values;
		axis.values = isTime ? (isArr(av) ? timeAxisVals(tzDate, timeAxisStamps(av)) : av || _timeAxisVals) : av || numAxisVals;
	});

	if (hasLeftAxis || hasRightAxis) {
		if (!hasRightAxis)
			{ canCssWidth -= yAxisOpts[WIDTH]; }
		if (!hasLeftAxis) {
			canCssWidth -= yAxisOpts[WIDTH];
			plotLft += yAxisOpts[WIDTH];
		}
	}

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	var off1 = fullCssWidth - plotLft;
	var off2 = fullCssHeight - plotTop;
	var off3 = plotLft + canCssWidth;
	var off0 = plotTop + canCssHeight;

	function placeAxis(axis, part, crossDim) {
		var side = axis.side;
		var isVt = side % 2;

		var el = placeDiv((isVt ? "y-" : "x-") + part + "-" + side, wrap);

		el.style.color = axis.color;
		addClass(el, axis.class);

		if (isVt) {
			var w = crossDim || axis[WIDTH];
			setStylePx(el, WIDTH, w);
			setStylePx(el, HEIGHT, canCssHeight);
			setStylePx(el, TOP, plotTop);

			if (side == 1) {
				setStylePx(el, RIGHT, off1);
				off1 += w;
			}
			else {
				setStylePx(el, LEFT, off3);
				off3 += w;
			}
		}
		else {
			var h = crossDim || axis[HEIGHT];
			setStylePx(el, HEIGHT, h);
			setStylePx(el, WIDTH, canCssWidth);
			setStylePx(el, LEFT, plotLft);

			if (side == 2) {
				setStylePx(el, BOTTOM, off2);
				off2 += h;
			}
			else {
				setStylePx(el, TOP, off0);
				off0 += h;
			}
		}

		return el;
	}

	// init axis containers, set axis positions
	axes.forEach(function (axis, i) {
		if (!axis.show)
			{ return; }

		axis.vals = placeAxis(axis, "values");

		if (axis.label != null) {
			var side = axis.side;
			var isVt = side % 2;

			var lbl = placeAxis(axis, "labels", LABEL_HEIGHT);
			var txt = placeDiv("label", lbl);
			txt.textContent = axis.label;
			setStylePx(txt, HEIGHT, LABEL_HEIGHT);

			if (isVt) {
				setStylePx(txt, WIDTH, canCssHeight);

				var style = txt.style;

				if (side == 3)
					{ setOriRotTrans(style, "0 0", 90, -LABEL_HEIGHT); }
				else
					{ setOriRotTrans(style, "100% 0", -90, -canCssHeight); }
			}
		}
	});

	setStylePx(plot, TOP, plotTop);
	setStylePx(plot, LEFT, plotLft);
	setStylePx(wrap, WIDTH, fullCssWidth);
	setStylePx(wrap, HEIGHT, fullCssHeight);

	var ref = makeCanvas(canCssWidth, canCssHeight);
	var can = ref.can;
	var ctx = ref.ctx;

	var pendScales = {};

	function setScales() {
		if (inBatch) {
			shouldSetScales = true;
			return;
		}

	//	console.log("setScales()");

		// original scales' min/maxes
		var minMaxes = {};

		series.forEach(function (s, i) {
			var k = s.scale;
			var sc = scales[k];

			if (minMaxes[k] == null) {
				minMaxes[k] = {min: sc.min, max: sc.max};

				if (pendScales[k] != null)
					{ assign(sc, pendScales[k]); }
				else {
					sc.min = inf;
					sc.max = -inf;
				}
			}

			// fast-path for x axis, which is assumed ordered ASC and will not get padded
			if (i == 0) {
				i0 = closestIdx(sc.min, data[0]);
				i1 = closestIdx(sc.max, data[0]);

				// closest indices can be outside of view
				if (data[0][i0] < sc.min)
					{ i0++; }
				if (data[0][i1] > sc.max)
					{ i1--; }

				s.min = data0[i0];
				s.max = data0[i1];

				var minMax = sc.range(sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}
			else if (s.show) {
				// only run getMinMax() for invalidated series data, else reuse
				var minMax$1 = s.min == inf ? (sc.auto ? getMinMax(data[i], i0, i1) : [0,100]) : [s.min, s.max];

				// initial min/max
				sc.min = min(sc.min, s.min = minMax$1[0]);
				sc.max = max(sc.max, s.max = minMax$1[1]);
			}
		});

		// snap non-derived scales
		for (var k in scales) {
			var sc = scales[k];

			if (sc.base == null && sc.min != inf && pendScales[k] == null) {
				var minMax = sc.range(sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}

			pendScales[k] = null;
		}

		// range derived scales
		for (var k$1 in scales) {
			var sc$1 = scales[k$1];

			if (sc$1.base != null) {
				var base = scales[sc$1.base];

				if (base.min != inf) {
					var minMax$1 = sc$1.range(base.min, base.max);
					sc$1.min = minMax$1[0];
					sc$1.max = minMax$1[1];
				}
			}
		}

		// invalidate paths of all series on changed scales
		series.forEach(function (s, i) {
			var k = s.scale;
			var sc = scales[k];

			if (sc.min != minMaxes[k].min || sc.max != minMaxes[k].max)
				{ s.path = null; }
		});
	}

	var dir = 1;

	function drawSeries() {
		series.forEach(function (s, i) {
			if (i > 0 && s.show && s.path == null)
				{ buildPath(i, data[0], data[i], scales[xScaleKey], scales[s.scale]); }
		});

		series.forEach(function (s, i) {
			if (i > 0 && s.show)
				{ drawPath(i); }
		});
	}

	function drawPath(is) {
		var s = series[is];

		if (dir == 1) {
			var path = s.path;
			var width = s[WIDTH];
			var offset = (width % 2) / 2;

			setCtxStyle(s.color, width, s.dash, s.fill);

			ctx.globalAlpha = s.alpha;

			ctx.translate(offset, offset);

			if (s.band)
				{ ctx.fill(path); }
			else {
				ctx.stroke(path);

				if (s.fill != null) {
					var zeroY = getYPos(0, scales[s.scale], can[HEIGHT]);

					path.lineTo(can[WIDTH], zeroY);
					path.lineTo(0, zeroY);
					ctx.fill(path);
				}
			}

			ctx.translate(-offset, -offset);

			ctx.globalAlpha = 1;
		}

		if (s.band)
			{ dir *= -1; }
	}

	function buildPath(is, xdata, ydata, scaleX, scaleY) {
		var s = series[is];
		var path = s.path = dir == 1 ? new Path2D() : series[is-1].path;
		var width = s[WIDTH];

		var gap = false;

		var minY = inf,
			maxY = -inf,
			x, y;

		var _i0 = clamp(i0 - 1, 0, dataLen - 1);
		var _i1 = clamp(i1 + 1, 0, dataLen - 1);

		var prevX = getXPos(xdata[dir == 1 ? _i0 : _i1], scaleX, can[WIDTH]),
			prevY;

		for (var i = dir == 1 ? _i0 : _i1; dir == 1 ? i <= _i1 : i >= _i0; i += dir) {
			x = getXPos(xdata[i], scaleX, can[WIDTH]);
			y = getYPos(ydata[i], scaleY, can[HEIGHT]);

			if (dir == -1 && i == _i1)
				{ path.lineTo(x, y); }

			if (y == null)
				{ gap = true; }
			else {
				if ((dir == 1 ? x - prevX : prevX - x) >= width) {
					if (gap) {
						spanGaps ? path.lineTo(x, y) : path.moveTo(x, y);	// bug: will break filled areas due to moveTo
						gap = false;
					}
					else if (dir == 1 ? i > _i0 : i < _i1) {
						path.lineTo(prevX, maxY);		// cannot be moveTo if we intend to fill the path
						path.lineTo(prevX, minY);
						path.lineTo(prevX, prevY);		// cannot be moveTo if we intend to fill the path
						path.lineTo(x, y);
					}

					minY = maxY = y;
					prevX = x;
				}
				else {
					minY = min(y, minY);
					maxY = max(y, maxY);
				}

				prevY = y;
			}
		}

		if (s.band) {
			if (dir == -1)
				{ path.closePath(); }

			dir *= -1;
		}
	}

	function drawAxesGrid() {
		axes.forEach(function (axis, i) {
			if (!axis.show)
				{ return; }

			var ori = i == 0 ? 0 : 1;
			var dim = ori == 0 ? WIDTH : HEIGHT;
			var canDim = ori == 0 ? canCssWidth : canCssHeight;
			var xDim = ori == 0 ? HEIGHT : WIDTH;
			var scale = scales[axis.scale];

			var ch = axis.vals[firstChild];

			// this will happen if all series using a specific scale are toggled off
			if (scale.min == inf) {
				ch && clearFrom(ch);
				return;
			}

			var min = scale.min;
			var max = scale.max;

			var minSpace = axis.space(min, max, canDim);

			var ref = findIncr(max - min, axis.incrs, canDim, minSpace);
			var incr = ref[0];
			var space = ref[1];

			// if we're using index positions, force first tick to match passed index
			var forceMin = scale.type == 2;

			var ticks = axis.ticks(min, max, incr, space/minSpace, forceMin);

			var getPos = ori == 0 ? getXPos : getYPos;
			var cssProp = ori == 0 ? LEFT : TOP;

			// TODO: filter ticks & offsets that will end up off-canvas
			var canOffs = ticks.map(function (val) { return getPos(val, scale, can[dim]); });		// bit of waste if we're not drawing a grid

			var labels = axis.values(scale.type == 2 ? ticks.map(function (i) { return data0[i]; }) : ticks, space);		// BOO this assumes a specific data/series

			canOffs.forEach(function (off, i) {
				ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
			});

			ch && clearFrom(ch);

			var grid = axis.grid;

			if (grid) {
				// note: the grid is cheap to build & redraw unconditionally, so does not
				// use the retained Path2D optimization or additional invalidation logic
				var offset = (grid[WIDTH] % 2) / 2;
				ctx.translate(offset, offset);

				setCtxStyle(grid.color || "#eee", grid[WIDTH], grid.dash);

				ctx.beginPath();

				canOffs.forEach(function (off, i) {
					var mx, my, lx, ly;

					if (ori == 0) {
						my = 0;
						ly = can[xDim];
						mx = lx = off;
					}
					else {
						mx = 0;
						lx = can[xDim];
						my = ly = off;
					}

					ctx.moveTo(mx, my);
					ctx.lineTo(lx, ly);
				});

				ctx.stroke();

				ctx.translate(-offset, -offset);
			}
		});
	}

	function resetSeries() {
	//	console.log("resetSeries()");

		series.forEach(function (s) {
			s.min = inf;
			s.max = -inf;
			s.path = null;
		});
	}

	var didPaint;

	function paint() {
		if (inBatch) {
			shouldPaint = true;
			return;
		}

	//	console.log("paint()");

		ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
		drawAxesGrid();
		drawSeries();
		didPaint = true;
	}

	// redraw() => setScale('x', scales.x.min, scales.x.max);

	// explicit, never re-ranged
	function setScale(key, min, max) {
		var sc = scales[key];

		if (sc.base == null) {
			pendScales[key] = {min: min, max: max};

			if (key == xScaleKey && (min != sc.min || max != sc.max))
				{ resetSeries(); }

			didPaint = false;
			setScales();
			cursor.show && updatePointer();
			!didPaint && paint();
			didPaint = false;
		}
	}

	self.setScale = setScale;

//	INTERACTION

	var vt;
	var hz;

	var x = null;
	var y = null;

	if (cursor.show && cursor.cross) {
		var c = "cursor-";

		vt = placeDiv(c + "vt", plot);
		hz = placeDiv(c + "hz", plot);
		x = canCssWidth/2;
		y = canCssHeight/2;
	}

	var zoom = cursor.show ? placeDiv("zoom", plot) : null;

	var legend = null;
	var legendLabels = null;	// TODO: legendValues?
	var multiValLegend = false;

	if (legendOpts.show) {
		legend = placeTag("table", "legend", root);

		var vals = series[1].values;
		multiValLegend = vals != null;

		var keys;

		if (multiValLegend) {
			var head = placeTag("tr", "labels", legend);
			placeTag("th", null, head);
			keys = vals(0);

			for (var key in keys)
				{ placeTag("th", null, head).textContent = key; }
		}
		else {
			keys = {_: 0};
			addClass(legend, "inline");
		}

		legendLabels = series.map(function (s, i) {
			if (i == 0 && multiValLegend)
				{ return null; }

			var _row = [];

			var row = placeTag("tr", "series", legend);

			var label = placeTag("th", null, row);
			label.textContent = s.label;

			label.style.color = s.color;
		//	label.style.borderLeft = "4px " + (s.dash == null ? "solid " : "dashed ") + s.color;
		//	label.style.borderBottom = (s.width + "px ") + (s.dash == null ? "solid " : "dashed ") + s.color;

			if (i > 0) {
				on("click", label, function (e) {
					if (locked)
						{ return; }

					filtMouse(e) && toggle(i, null, syncOpts.toggle);
				});

				if (focus) {
					on("mouseenter", label, function (e) {
						if (locked)
							{ return; }

						setFocus(i, focus.alpha, syncOpts.focus);
					});
				}
			}

			for (var key in keys) {
				var v = placeTag("td", null, row);
				v.textContent = "--";
				_row.push(v);
			}

			return _row;
		});
	}

	function toggleDOM(i, onOff) {
		var s = series[i];
		var label = legendLabels[i][0].parentNode;

		if (s.show)
			{ remClass(label, "off"); }
		else {
			addClass(label, "off");
			cursor.show && trans(cursorPts[i], 0, -10);
		}
	}

	function toggle(idxs, onOff, pub) {
		(isArr(idxs) ? idxs : [idxs]).forEach(function (i) {
			var s = series[i];

			s.show = onOff != null ? onOff : !s.show;
			toggleDOM(i);

			if (s.band) {
				// not super robust, will break if two bands are adjacent
				var ip = series[i+1].band ? i+1 : i-1;
				series[ip].show = s.show;
				toggleDOM(ip);
			}
		});

		setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);		// redraw

		pub && sync.pub("toggle", self, idxs, onOff);
	}

	self.toggle = toggle;

	function _alpha(i, value) {
		series[i].alpha = legendLabels[i][0].parentNode.style.opacity = value;
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
	var distsToCursor = Array(series.length);

	var focused = null;

	// kill alpha?
	function setFocus(i, alpha, pub) {
		if (i != focused) {
		//	console.log("setFocus()");

			series.forEach(function (s, i2) {
				_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : alpha);
			});

			focused = i;
			paint();

			pub && sync.pub("focus", self, i);
		}
	}

	self.focus = setFocus;

	if (focus) {
		on("mouseleave", legend, function (e) {
			if (locked)
				{ return; }
		//	setFocus(null, 1);
			updatePointer();
		});
	}

	// series-intersection markers
	var cursorPts = cursor.show ? series.map(function (s, i) {
		if (i > 0 && s.show) {
			var pt = placeDiv("point", plot);
			pt.style.background = s.color;
			return pt;
		}
	}) : null;

	var rafPending = false;

	function scaleValueAtPos(scale, pos) {
		var dim = scale == xScaleKey ? canCssWidth : canCssHeight;
		var pct = clamp(pos / dim, 0, 1);

		var sc = scales[scale];
		var d = sc.max - sc.min;
		return sc.min + pct * d;
	}

	function closestIdxFromXpos(pos) {
		var v = scaleValueAtPos(xScaleKey, pos);
		return closestIdx(v, data[0], i0, i1);
	}

	var inBatch = false;
	var shouldPaint = false;
	var shouldSetScales = false;
	var shouldUpdatePointer = false;

	// defers calling expensive functions
	function batch(fn) {
		inBatch = true;
		fn(self);
		inBatch = false;
		shouldSetScales && setScales();
		shouldUpdatePointer && updatePointer();
		shouldPaint && !didPaint && paint();
		shouldSetScales = shouldUpdatePointer = shouldPaint = didPaint = inBatch;
	}

	self.batch = batch;

	function updatePointer(pub) {
		if (inBatch) {
			shouldUpdatePointer = true;
			return;
		}

	//	console.log("updatePointer()");

		rafPending = false;

		if (cursor.show && cursor.cross) {
			trans(vt,x,0);
			trans(hz,0,y);
		}

	//	let pctY = 1 - (y / rect[HEIGHT]);

		var idx = closestIdxFromXpos(x);

		var scX = scales[xScaleKey];

		var xPos = getXPos(data[0][idx], scX, canCssWidth);

		for (var i = 0; i < series.length; i++) {
			var s = series[i];

			if (i > 0 && s.show) {
				var yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

				if (yPos == null)
					{ yPos = -10; }

				distsToCursor[i] = yPos > 0 ? abs(yPos - y) : inf;

				cursor.show && trans(cursorPts[i], xPos, yPos);
			}
			else
				{ distsToCursor[i] = inf; }

			if (legendOpts.show) {
				if (i == 0 && multiValLegend)
					{ continue; }

				var src = i == 0 && xScaleType == 2 ? data0 : data[i];

				var vals = multiValLegend ? s.values(idx) : {_: s.value(src[idx])};

				var j = 0;

				for (var k in vals)
					{ legendLabels[i][j++][firstChild].nodeValue = vals[k]; }
			}
		}

		if (dragging) {
			var minX = min(x0, x);
			var maxX = max(x0, x);

			setStylePx(zoom, LEFT, minX);
			setStylePx(zoom, WIDTH, maxX - minX);
		}

		if (pub !== false) {
			sync.pub(mousemove, self, x, y, canCssWidth, canCssHeight, idx);

			if (focus) {
				var minDist = min.apply(null, distsToCursor);

				var fi = null;

				if (minDist <= focus.prox) {
					distsToCursor.some(function (dist, i) {
						if (dist == minDist)
							{ return fi = i; }
					});
				}

				setFocus(fi, focus.alpha, syncOpts.focus);
			}
		}
	}

	var x0 = null;
	var y0 = null;

	var dragging = false;

	var rect = null;

	function syncRect() {
		rect = can.getBoundingClientRect();
	}

	function mouseMove(e, src, _x, _y, _w, _h, _i) {
		if (locked)
			{ return; }

		if (rect == null)
			{ syncRect(); }

		syncPos(e, src, _x, _y, _w, _h, _i, false);

		if (e != null) {
			if (!rafPending) {
				rafPending = true;
				rAF(updatePointer);
			}
		}
		else
			{ updatePointer(false); }
	}

	function syncPos(e, src, _x, _y, _w, _h, _i, initial) {
		if (e != null) {
			_x = e.clientX - rect.left;
			_y = e.clientY - rect.top;
		}
		else {
			_x = canCssWidth * (_x/_w);
			_y = canCssHeight * (_y/_h);
		}

		if (initial) {
			x0 = _x;
			y0 = _y;
		}
		else {
			x = _x;
			y = _y;
		}
	}

	function mouseDown(e, src, _x, _y, _w, _h, _i) {
		if (e == null || filtMouse(e)) {
			dragging = true;

			syncPos(e, src, _x, _y, _w, _h, _i, true);

			if (e != null) {
				on(mouseup, doc, mouseUp);
				sync.pub(mousedown, self, x0, y0, canCssWidth, canCssHeight, null);
			}
		}
	}

	var locked = false;

	function mouseUp(e, src, _x, _y, _w, _h, _i) {
		if ((e == null || filtMouse(e))) {
			dragging = false;

			syncPos(e, src, _x, _y, _w, _h, _i, false);

			if (x != x0 || y != y0) {
				setStylePx(zoom, LEFT, 0);
				setStylePx(zoom, WIDTH, 0);

				var minX = min(x0, x);
				var maxX = max(x0, x);

				setScale(xScaleKey,
					xScaleType == 2 ? closestIdxFromXpos(minX) : scaleValueAtPos(xScaleKey, minX),
					xScaleType == 2 ? closestIdxFromXpos(maxX) : scaleValueAtPos(xScaleKey, maxX)
				);
			}
			else {
				locked = !locked;

				if (!locked)
					{ updatePointer(); }
			}

			if (e != null) {
				off(mouseup, doc, mouseUp);
				sync.pub(mouseup, self, x, y, canCssWidth, canCssHeight, null);
			}
		}
	}

	function dblClick(e, src, _x, _y, _w, _h, _i) {
		setScale(xScaleKey, data[0][0], data[0][dataLen - 1]);

		if (e != null)
			{ sync.pub(dblclick, self, x, y, canCssWidth, canCssHeight, null); }
	}

	var events = {};

	events[mousedown] = mouseDown;
	events[mousemove] = mouseMove;
	events[mouseup] = mouseUp;
	events[dblclick] = dblClick;
	events["focus"] = function (e, src, i) {
		setFocus(i, focus.alpha);
	};
	events["toggle"] = function (e, src, idxs, onOff) {
		toggle(idxs, onOff);
	};

	if (cursor.show) {
		on(mousedown, can, mouseDown);
		on(mousemove, can, mouseMove);
		on(dblclick, can, dblClick);

		var deb$1 = debounce(syncRect, 100);

		on(resize, win, deb$1);
		on(scroll, win, deb$1);
	}

	self.root = root;

	var syncOpts = assign({
		key: null,
		toggle: false,
		focus: false,
	}, cursor.sync);

	var syncKey = syncOpts.key;

	var sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

	sync.sub(self);

	function pub(type, src, x, y, w, h, i) {
		events[type](null, src, x, y, w, h, i);
	}

	self.pub = pub;

	var _i0 = 0,
		_i1 = data[0].length - 1;

	setData(data,
		xScaleType == 2 ? _i0 : data[0][_i0],
		xScaleType == 2 ? _i1 : data[0][_i1]
	);

	function destroy() {
		sync.unsub(self);
		off(resize, win, deb);
		off(scroll, win, deb);
		root.remove();
	}

	self.destroy = destroy;

	plot.appendChild(can);
}

exports.Line = Line;
exports.fmtDate = fmtDate;
exports.tzDate = tzDate;
