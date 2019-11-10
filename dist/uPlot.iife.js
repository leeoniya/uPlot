/**
* Copyright (c) 2019, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* uPlot.js (μPlot)
* An exceptionally fast, tiny time series chart
* https://github.com/leeoniya/uPlot (v0.1.0)
*/

var uPlot = (function (exports) {
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

	var rAF = requestAnimationFrame;
	var doc = document;
	var win = window;
	var pxRatio = devicePixelRatio;

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

	var assign = Object.assign;

	var isArr = Array.isArray;

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

	var md = '{M}/{D}';
	var MMM = '{MMM}';
	var yr = '{YYYY}';
	var hr = '{h}';
	var mm = ':{mm}';
	var ss = ':{ss}';
	var ampm = '{aa}';

	var year = fmtDate(yr);
	var monthDate = fmtDate(md);
	var monthDateYear = fmtDate(md + '\n' + yr);
	var month = fmtDate(MMM);
	var monthYear = fmtDate(MMM + '\n' + yr);

	var _hour   = hr +           ampm;
	var _minute = hr + mm +      ampm;
	var _second = hr + mm + ss + ampm;

	var hour =   fmtDate(_hour);
	var minute = fmtDate(_minute);
	var second = fmtDate(_second);

	var md2 = '\n' + md;

	var hourDate	= fmtDate(_hour   + md2);
	var minDate	= fmtDate(_minute + md2);
	var secDate	= fmtDate(_second + md2);

	// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
	// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
	function timeAxisVals(vals, space) {
		var self = this;
		var incr = vals[1] - vals[0];

		// these track boundaries when a full label is needed again
		var prevYear = null;
		var prevDate = null;

		return vals.map(function (val, i) {
			var date = self.tzDate(val);

			var newYear = date[getFullYear]();
			var newDate = date[getDate]();

			var diffYear = newYear != prevYear;
			var diffDate = newDate != prevDate;

			var stamp;

			if (incr >= y)
				{ stamp = year; }
			else if (incr >= d * 28)
				{ stamp = diffYear ? monthYear : month; }
			else if (incr >= d)
				{ stamp = diffYear ? monthDateYear : monthDate; }
			else if (incr >= h)
				{ stamp = diffDate ? hourDate : hour; }
			else if (incr >= m)
				{ stamp = diffDate ? minDate : minute; }
			else if (incr >= s)
				{ stamp = diffDate ? secDate :  second; }

			prevYear = newYear;
			prevDate = newDate;

			return stamp(date);
		});
	}

	function mkDate(y, m, d) {
		return new Date(y, m, d);
	}

	// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
	function getDateTicks(scaleMin, scaleMax, incr) {
		var ticks = [];
		var isMo = incr >= mo && incr < y;

		// get the timezone-adjusted date
		var minDate = this.tzDate(scaleMin);
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
				ticks.push(tick = next / 1e3);
			}
		}
		else {
			var tzOffset = scaleMin - minDateTs;
			var tick$1 = minMinTs + tzOffset + incrRoundUp(minDateTs - minMinTs, incr);

			for (; tick$1 <= scaleMax; tick$1 += incr)
				{ ticks.push(tick$1); }
		}

		return ticks;
	}

	var longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

	function timeSeriesVal(val) {
		return longDateHourMin(this.tzDate(val));
	}

	var xAxisOpts = {
	//	type: "t",		// t, n
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

	function numAxisVals(vals, space) {
		return vals;
	}

	function getNumTicks(scaleMin, scaleMax, incr) {
		scaleMin = round6(incrRoundUp(scaleMin, incr));

		var ticks = [];

		for (var val = scaleMin; val <= scaleMax; val = round6(val + incr))
			{ ticks.push(val); }

		return ticks;
	}

	function numSeriesVal(val) {
		return val;
	}

	var yAxisOpts = {
	//	type: "n",		// t, n
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

	function setDefaults(d, xo, yo) {
		return [d.x].concat(d.y).map(function (o, i) { return assign({}, (i == 0 ? xo : yo), o); });
	}

	function splitXY(d) {
		return {
			x: d[0],
			y: d.slice(1),
		};
	}

	function Line(opts, data) {
		var self = this;

		var series  = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
		var axes    = setDefaults(opts.axes || {}, xAxisOpts, yAxisOpts);
		var scales  = (opts.scales = opts.scales || {});

		self.tzDate = opts.tzDate || (function (ts) { return new Date(ts * 1e3); });

		self.series = splitXY(series);
		self.axes = splitXY(axes);
		self.scales = scales;

		var legend = assign({}, {show: true}, opts.legend);

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
			sc.range = fnOrSelf(sc.range || (i > 0 && !sc.time ? snapHalfMag : snapNone));

			if (s.time == null)
				{ s.time = sc.time; }

			var isTime = s.time;

			s.value = s.value || (isTime ? timeSeriesVal : numSeriesVal);
			s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
			s.width = s.width || 1;
		});

		var cursor = assign({}, {show: true}, opts.cursor);		// focus: {alpha, prox}

		var dataLen;

		// rendered data window
		self.i0 = null;
		self.i1 = null;

		function setData(_data, _i0, _i1) {
			data = _data;
			dataLen = data[0].length;
			resetSeries();
			setView(_i0 != null ? _i0 : self.i0, _i1 != null ? _i1 : self.i1);
		}

		self.setData = setData;

		function setStylePx(el, name, value) {
			el.style[name] = value + "px";
		}

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
			{ root[classList].add(opts.class); }

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

		// accumulate axis offsets, reduce canvas width
		axes.forEach(function (axis, i) {
			var side = axis.side;
			var isVt = side % 2;
			var lab = axis.label != null ? LABEL_HEIGHT : 0;

			if (isVt) {
				var w = axis[WIDTH] + lab;
				canCssWidth -= w;

				if (side == 1)
					{ plotLft += w; }
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

			axis.incrs = axis.incrs || (isTime && sc.type == 1 ? timeIncrs : numIncrs);
			axis.values = axis.values || (isTime ? timeAxisVals : numAxisVals);
			axis.ticks = fnOrSelf(axis.ticks || (isTime && sc.type == 1 ? getDateTicks : getNumTicks));
			axis.space = fnOrSelf(axis.space);
		});

		if (!hasRightAxis)
			{ canCssWidth -= yAxisOpts.width; }

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

		function setOriRotTrans(style, origin, rot, trans) {
			style.transformOrigin = origin;
			style.transform = "rotate(" + rot + "deg) translateY(" + trans + "px)";
		}

		// init axis containers, set axis positions
		axes.forEach(function (axis, i) {
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

		function addClass(el, c) {
			el[classList].add(c);
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

		function placeDiv(cls, targ) {
			var div = doc[createElement]("div");

			if (cls != null)
				{ addClass(div, cls); }

			if (targ != null)
				{ targ.appendChild(div); }		// TODO: chart.appendChild()

			return div;
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
		function snapHalfMag(dataMin, dataMax) {
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

		function setScales() {
			// original scales' min/maxes
			var minMaxes = {};

			series.forEach(function (s, i) {
				var k = s.scale;
				var sc = scales[k];

				if (minMaxes[k] == null) {
					minMaxes[k] = {min: sc.min, max: sc.max};
					sc.min = inf;
					sc.max = -inf;
				}

				// fast-path for x axis, which is assumed ordered ASC and will not get padded
				if (i == 0) {
					var minMax = sc.range(
						sc.type == 2 ? self.i0 : data[0][self.i0],
						sc.type == 2 ? self.i1 : data[0][self.i1]
					);
					sc.min = s.min = minMax[0];
					sc.max = s.max = minMax[1];
				}
				else if (s.show) {
					// only run getMinMax() for invalidated series data, else reuse
					var minMax$1 = s.min == inf ? (sc.auto ? getMinMax(data[i], self.i0, self.i1) : [0,100]) : [s.min, s.max];

					// initial min/max
					sc.min = min(sc.min, s.min = minMax$1[0]);
					sc.max = max(sc.max, s.max = minMax$1[1]);
				}
			});

			// snap non-derived scales
			for (var k in scales) {
				var sc = scales[k];

				if (sc.base == null && sc.min != inf) {
					var minMax = sc.range(sc.min, sc.max);

					sc.min = minMax[0];
					sc.max = minMax[1];
				}
			}

			// snap derived scales
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

		// TODO: ability to get only min or only max
		function getMinMax(data, _i0, _i1) {
			var _min = inf;
			var _max = -inf;

			for (var i = _i0; i <= _i1; i++) {
				_min = min(_min, data[i]);
				_max = max(_max, data[i]);
			}

			return [_min, _max];
		}

		var dir = 1;

		function drawSeries() {
			series.forEach(function (s, i) {
				if (i > 0 && s.show && s.path == null)
					{ buildPath(i, data[0], data[i], scales[series[0].scale], scales[s.scale]); }
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
				else
					{ ctx.stroke(path); }

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
			var offset = (width % 2) / 2;

			var gap = false;

			var minY = inf,
				maxY = -inf,
				prevX = dir == 1 ? offset : can[WIDTH] + offset,
				prevY, x, y;

			for (var i = dir == 1 ? self.i0 : self.i1; dir == 1 ? i <= self.i1 : i >= self.i0; i += dir) {
				x = getXPos(scaleX.type == 2 ? i : xdata[i], scaleX, can[WIDTH]);
				y = getYPos(ydata[i],                         scaleY, can[HEIGHT]);

				if (dir == -1 && i == self.i1)
					{ path.lineTo(x, y); }

				// bug: will break filled areas due to moveTo
				if (y == null) {				// data gaps
					gap = true;
					path.moveTo(x, prevY);
				}
				else {
					if ((dir == 1 ? x - prevX : prevX - x) >= width) {
						if (gap) {
							path.moveTo(x, y);
							gap = false;
						}
						else if (dir == 1 ? i > self.i0 : i < self.i1) {
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

		function clearFrom(ch) {
			var next;
			while (next = ch[nextSibling])
				{ next.remove(); }
			ch.remove();
		}

		function drawAxesGrid() {
			axes.forEach(function (axis, i) {
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

				var ref = findIncr(max - min, axis.incrs, canDim, axis.space(min, max, canDim));
				var incr = ref[0];
				var space = ref[1];

				var ticks = axis.ticks.call(self, min, max, incr);

				var getPos = ori == 0 ? getXPos : getYPos;
				var cssProp = ori == 0 ? LEFT : TOP;

				// TODO: filter ticks & offsets that will end up off-canvas
				var canOffs = ticks.map(function (val) { return getPos(val, scale, can[dim]); });		// bit of waste if we're not drawing a grid

				var labels = axis.values.call(self, scale.type == 2 ? ticks.map(function (i) { return data[0][i]; }) : ticks, space);		// BOO this assumes a specific data/series

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
			series.forEach(function (s) {
				s.min = inf;
				s.max = -inf;
				s.path = null;
			});
		}

		var didPaint;

		function paint() {
		//	console.log("paint!");
			ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
			drawAxesGrid();
			drawSeries();
			didPaint = true;
		}

		function setView(_i0, _i1) {
			didPaint = false;

			if (_i0 != self.i0 || _i1 != self.i1)
				{ resetSeries(); }

			self.i0 = _i0;
			self.i1 = _i1;

			setScales();
			cursor.show && updatePointer();
			!didPaint && paint();
			didPaint = false;
		}

		self.setView = setView;

	//	INTERACTION

		var vt;
		var hz;

		var x = null;
		var y = null;

		if (cursor.show) {
			vt = placeDiv("vt", plot);
			hz = placeDiv("hz", plot);
			x = canCssWidth/2;
			y = canCssHeight/2;
		}

		// zoom region
		var region = placeDiv("region", plot);

		var leg = placeDiv("legend", root);

		function toggleDOM(i, onOff) {
			var s = series[i];
			var label = legendLabels[i];

			if (s.show)
				{ label[classList].remove("off"); }
			else {
				label[classList].add("off");
				trans(cursorPts[i], 0, -10);
			}
		}

		function toggle(idxs, onOff) {
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

			setView(self.i0, self.i1);
		}

		self.toggle = toggle;

		function _alpha(i, value) {
			series[i].alpha = legendLabels[i].style.opacity = value;
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

		var focus = cursor.focus;

		// y-distance
		var distsToCursor = Array(series.length);

		var focused = null;

		function setFocus(i, alpha) {
			if (i != focused) {
				series.forEach(function (s, i2) {
					_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : alpha);
				});

				focused = i;
				paint();
			}
		}

		self.focus = setFocus;

		var legendLabels = legend.show ? series.map(function (s, i) {
			var label = placeDiv(null, leg);
			label.style.color = s.color;
			label.style.borderBottom = (s.width + "px ") + (s.dash == null ? "solid " : "dashed ") + s.color;
			label.textContent = s.label + ': -';

			if (i > 0) {
				on("click", label, function (e) {
					filtMouse(e) && toggle(i);
				});

				if (focus) {
					on("mouseenter", label, function (e) {
						setFocus(i, focus.alpha);
					});
				}
			}

			return label;
		}) : null;

		if (focus) {
			on("mouseleave", leg, function (e) {
			//	setFocus(null, 1);
				updatePointer();
			});
		}

		// series-intersection markers
		var cursorPts = series.map(function (s, i) {
			if (i > 0 && s.show) {
				var pt = placeDiv("point", plot);
				pt.style.background = s.color;
				return pt;
			}
		});

		var rafPending = false;

		function closestIdxFromXpos(x) {
			var pctX = x / canCssWidth;
			var xsc = scales[series[0].scale];
			var d = xsc.max - xsc.min;
			var t = xsc.min + pctX * d;
			var idx = xsc.type == 2 ? round(t) : closestIdx(t, data[0], self.i0, self.i1);
			return idx;
		}

		function trans(el, xPos, yPos) {
			el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
		}

		function updatePointer(pub) {
			rafPending = false;

			if (cursor.show) {
				trans(vt,x,0);
				trans(hz,0,y);
			}

		//	let pctY = 1 - (y / rect[HEIGHT]);

			var idx = closestIdxFromXpos(x);

			var scX = scales[series[0].scale];

			var xPos = getXPos(scX.type == 2 ? idx : data[0][idx], scX, canCssWidth);

			for (var i = 0; i < series.length; i++) {
				var s = series[i];

				if (i > 0 && s.show) {
					var yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

					if (yPos == null)
						{ yPos = -10; }

					distsToCursor[i] = yPos > 0 ? abs(yPos - y) : inf;

					trans(cursorPts[i], xPos, yPos);
				}
				else
					{ distsToCursor[i] = inf; }

				if (legend.show)
					{ legendLabels[i][firstChild].nodeValue = s.label + ': ' + s.value.call(self, data[i][idx]); }
			}

			if (dragging) {
				var minX = min(x0, x);
				var maxX = max(x0, x);

				setStylePx(region, LEFT, minX);
				setStylePx(region, WIDTH, maxX - minX);
			}

			pub !== false && sync.pub(mousemove, self, x, y, canCssWidth, canCssHeight, idx);

			if (focus) {
				var minDist = min.apply(null, distsToCursor);

				var fi = null;

				if (minDist <= focus.prox) {
					distsToCursor.some(function (dist, i) {
						if (dist == minDist)
							{ return fi = i; }
					});
				}

				if (fi != focused)
					{ setFocus(fi, focus.alpha); }

				// TODO: pub
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
			if (rect == null)
				{ syncRect(); }

			if (e != null) {
				x = e.clientX - rect.left;
				y = e.clientY - rect.top;

				if (!rafPending) {
					rafPending = true;
					rAF(updatePointer);
				}
			}
			else {
				x = canCssWidth * (_x/_w);
				y = canCssHeight * (_y/_h);
				updatePointer(false);
			}
		}

		var evOpts = {passive: true};

		function on(ev, el, cb) {
			el.addEventListener(ev, cb, evOpts);
		}

		function off(ev, el, cb) {
			el.removeEventListener(ev, cb, evOpts);
		}

		function mouseDown(e, src, _x, _y, _w, _h, _i) {
			if (e == null || filtMouse(e)) {
				dragging = true;

				if (e != null) {
					x0 = e.clientX - rect.left;
					y0 = e.clientY - rect.top;

					on(mouseup, doc, mouseUp);
					sync.pub(mousedown, self, x0, y0, canCssWidth, canCssHeight, null);
				}
				else {
					x0 = canCssWidth * (_x/_w);
					y0 = canCssHeight * (_y/_h);
				}
			}
		}

		function mouseUp(e, src, _x, _y, _w, _h, _i) {
			if ((e == null || filtMouse(e)) && dragging) {
				dragging = false;

				if (x != x0 || y != y0) {
					setStylePx(region, LEFT, 0);
					setStylePx(region, WIDTH, 0);

					var minX = min(x0, x);
					var maxX = max(x0, x);

					setView(
						closestIdxFromXpos(minX),
						closestIdxFromXpos(maxX)
					);
				}

				if (e != null) {
					off(mouseup, doc, mouseUp);
					sync.pub(mouseup, self, x, y, canCssWidth, canCssHeight, null);
				}
			}
		}

		function dblClick(e, src, _x, _y, _w, _h, _i) {
			if (self.i0 == 0 && self.i1 == dataLen - 1)
				{ return; }

			setView(0, dataLen - 1);

			if (e != null)
				{ sync.pub(dblclick, self, x, y, canCssWidth, canCssHeight, null); }
		}

		var events = {};

		events[mousemove] = mouseMove;
		events[mousedown] = mouseDown;
		events[mouseup] = mouseUp;
		events[dblclick] = dblClick;

		for (var ev in events)
			{ ev != mouseup && on(ev, can, events[ev]); }

		var deb = debounce(syncRect, 100);

		on(resize, win, deb);
		on(scroll, win, deb);

		self.root = root;

		var syncKey = cursor.sync;

		var sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

		sync.sub(self);

		function pub(type, src, x, y, w, h, i) {
			events[type](null, src, x, y, w, h, i);
		}

		self.pub = pub;

		setData(data, 0, data[0].length - 1);

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

	return exports;

}({}));
