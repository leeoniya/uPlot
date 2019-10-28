/**
* Copyright (c) 2019, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* uPlot.js (μPlot)
* An exceptionally fast, tiny time series chart
* https://github.com/leeoniya/uPlot (v0.1.0)
*/

var uPlot = (function () {
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

	var assign = Object.assign;

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

	var m = 60,
		h = m * m,
		d = h * 24,
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
		// year divisors
		y,
		y * 2,
		y * 5,
		y * 10,
		y * 25,
		y * 50,
		y * 100 ]);

	var md = '{M}/{D}';
	var yr = '{YYYY}';
	var hr = '{h}';
	var mm = ':{mm}';
	var ss = ':{ss}';
	var ampm = '{aa}';

	var year = fmtDate(yr);
	var monthDate = fmtDate(md);
	var monthDateYear = fmtDate(md + '\n' + yr);

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

	function timeAxisVals(vals, space) {
		var incr = vals[1] - vals[0];

		// these track boundaries when a full label is needed again
		var prevYear = null;
		var prevDate = null;

		return vals.map(function (val, i) {
			var date = new Date(val * 1e3);

			var newYear = date[getFullYear]();
			var newDate = date[getDate]();

			var diffYear = newYear != prevYear;
			var diffDate = newDate != prevDate;

			var stamp;

			if (incr >= y)
				{ stamp = year; }
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

	var longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

	function timeSeriesVal(val) {
		return longDateHourMin(new Date(val * 1e3));
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
	};

	var numIncrs = dec.concat([1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9]);

	function numAxisVals(vals, space) {
		return vals;
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
	//	label: "Value",
	//	value: v => v,
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
			pub: function pub(type, self, x, y, w, h, i) {
				if (clients.length > 1) {
					clients.forEach(function (client) {
						client != self && client.pub(type, self, x, y, w, h, i);
					});
				}
			}
		};
	}

	function uPlot(opts, data) {
		function setDefaults(d, xo, yo) {
			return [d.x].concat(d.y).map(function (o, i) { return assign({}, (i == 0 ? xo : yo), o); });
		}

		var series = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
		var axes = setDefaults(opts.axes || {}, xAxisOpts, yAxisOpts);
		var scales = (opts.scales = opts.scales || {});

		var legend = assign({}, {show: true}, opts.legend);

		// set default value
		series.forEach(function (s, i) {
			// init scales & defaults
			var key = s.scale;

			if (!(key in scales)) {
				scales[key] = {
					auto: true,
					min:  inf,
					max: -inf,
				};
			}

			var sc = scales[key];

			sc.type = sc.type || (i == 0 ? "t" : "n");

			// by default, numeric y scales snap to half magnitude of range
			sc.range = fnOrSelf(sc.range || (i > 0 && sc.type == "n" ? snapHalfMag : snapNone));

			s.type = s.type || sc.type;

			var isTime = s.type == "t";

			s.value = s.value || (isTime ? timeSeriesVal : numSeriesVal);
			s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
			s.width = s.width || 1;
		});

		var cursor = assign({}, {show: true}, opts.cursor);

		var dataLen;

		// rendered data window
		var i0;
		var i1;

		function setData(_data, _i0, _i1) {
			data = _data;
			dataLen = data[0].length;
			setView(_i0 != null ? _i0 : i0, _i1 != null ? _i1 : i1);
		}

		this.setData = setData;

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
			}
			else {
				var h = axis[HEIGHT] + lab;
				canCssHeight -= h;

				if (side == 2)
					{ plotTop += h; }
			}

			axis.type = axis.type || scales[axis.scale].type;

			// also set defaults for incrs & values based on axis type
			var isTime = axis.type == "t";
			axis.incrs = axis.incrs || (isTime ? timeIncrs : numIncrs);
			axis.values = axis.values || (isTime ? timeAxisVals : numAxisVals);
			axis.range = fnOrSelf(axis.range || (isTime ? snapMinDate : snapMinNum));
			axis.space = fnOrSelf(axis.space);
		});

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

		// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
		function snapMinDate(scaleMin, scaleMax, incr) {
			// get ts of 12am on day of i0 timestamp
			var minDate = new Date(scaleMin * 1000);
			var min00 = +(new Date(minDate[getFullYear](), minDate[getMonth](), minDate[getDate]())) / 1000;
			var offset = scaleMin - min00;
			scaleMin = min00 + incrRoundUp(offset, incr);
			return [scaleMin, scaleMax];
		}

		function snapMinNum(scaleMin, scaleMax, incr) {
			return [round6(incrRoundUp(scaleMin, incr)), scaleMax];
		}

		function setScales() {
			for (var k in scales) {
				scales[k].min = inf;
				scales[k].max = -inf;
			}

			series.forEach(function (s, i) {
				var sc = scales[s.scale];

				// fast-path for x axis, which is assumed ordered ASC and will not get padded
				if (i == 0) {
					var minMax = sc.range(data[0][i0], data[0][i1]);
					sc.min = minMax[0];
					sc.max = minMax[1];
				}
				else if (s.show) {
					var minMax$1 = sc.auto ? getMinMax(data[i], i0, i1) : [0,100];

					// this is temp data min/max
					sc.min = min(sc.min, minMax$1[0]);
					sc.max = max(sc.max, minMax$1[1]);
				}
			});

			// snap non-derived scales
			for (var k$1 in scales) {
				var sc = scales[k$1];

				if (sc.base == null) {
					var minMax = sc.range(sc.min, sc.max);

					sc.min = minMax[0];
					sc.max = minMax[1];
				}
			}

			// snap derived scales
			for (var k$2 in scales) {
				var sc$1 = scales[k$2];

				if (sc$1.base != null) {
					var base = scales[sc$1.base];
					var minMax$1 = sc$1.range(base.min, base.max);
					sc$1.min = minMax$1[0];
					sc$1.max = minMax$1[1];
				}
			}
		}

		function getMinMax(data, _i0, _i1) {
			var _min = inf;
			var _max = -inf;

			for (var i = _i0; i <= _i1; i++) {
				_min = min(_min, data[i]);
				_max = max(_max, data[i]);
			}

			return [_min, _max];
		}

		function drawSeries() {
			series.forEach(function (s, i) {
				if (i > 0 && s.show) {
					drawLine(
						data[0],
						data[i],
						scales[series[0].scale],
						scales[s.scale],
						s.color,
						s[WIDTH],
						s.dash,
						s.fill,
						s.band
					);
				}
			});
		}

		var dir = 1;

		function drawLine(xdata, ydata, scaleX, scaleY, color, width, dash, fill, band) {
			setCtxStyle(color, width, dash, fill);

			var offset = (width % 2) / 2;
			ctx.translate(offset, offset);

			var gap = false;

			if (dir == 1)
				{ ctx.beginPath(); }

			var minY = inf,
				maxY = -inf,
				prevX = dir == 1 ? offset : can[WIDTH] + offset,
				prevY, x, y;

			for (var i = dir == 1 ? i0 : i1; dir == 1 ? i <= i1 : i >= i0; i += dir) {
				x = getXPos(xdata[i], scaleX, can[WIDTH]);
				y = getYPos(ydata[i], scaleY, can[HEIGHT]);

				if (dir == -1 && i == i1)
					{ ctx.lineTo(x, y); }

				// bug: will break filled areas due to moveTo
				if (y == null) {				// data gaps
					gap = true;
					ctx.moveTo(x, prevY);
				}
				else {
					if ((dir == 1 ? x - prevX : prevX - x) >= width) {
						if (gap) {
							ctx.moveTo(x, y);
							gap = false;
						}
						else if (dir == 1 ? i > i0 : i < i1) {
							ctx.lineTo(prevX, maxY);		// cannot be moveTo if we intend to fill the path
							ctx.lineTo(prevX, minY);
							ctx.lineTo(prevX, prevY);		// cannot be moveTo if we intend to fill the path
							ctx.lineTo(x, y);
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

			if (band) {
				if (dir == -1) {
					ctx.strokeStyle = "rgba(0,0,0,0)";
					ctx.closePath();
					ctx.fill();
					ctx.stroke();
				}

				dir *= -1;
			}
			else
				{ ctx.stroke(); }

			ctx.translate(-offset, -offset);
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
				var assign;

				var ori = i == 0 ? 0 : 1;
				var dim = ori == 0 ? WIDTH : HEIGHT;
				var xDim = ori == 0 ? HEIGHT : WIDTH;
				var scale = scales[axis.scale];

				var ch = axis.vals[firstChild];

				// this will happen if all series using a specific scale are toggled off
				if (isNaN(scale.min)) {
					clearFrom(ch);
					return;
				}

				var min = scale.min;
				var max = scale.max;

				var ref = findIncr(max - min, axis.incrs, can[dim], axis.space(min, max, can[dim]));
				var incr = ref[0];
				var space = ref[1];

				(assign = axis.range(min, max, incr), min = assign[0], max = assign[1]);

				var ticks = [];

				for (var val = min; val <= max; val = round6(val + incr))
					{ ticks.push(val); }

				var getPos = ori == 0 ? getXPos : getYPos;
				var cssProp = ori == 0 ? LEFT : TOP;

				// TODO: filter ticks & offsets that will end up off-canvas
				var canOffs = ticks.map(function (val) { return getPos(val, scale, can[dim]); });		// bit of waste if we're not drawing a grid

				var labels = axis.values(ticks, space);

				canOffs.forEach(function (off, i) {
					ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
				});

				ch && clearFrom(ch);

				var grid = axis.grid;

				if (grid) {
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

		function setView(_i0, _i1) {
			i0 = _i0;
			i1 = _i1;

			setScales();
			ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
			drawAxesGrid();
			drawSeries();
			updatePointer();
		}

		this.setView = setView;

		function getView() {
			return [i0, i1];
		}

		this.getView = getView;

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

		function toggle(i) {
			var s = series[i];
			var label = legendLabels[i];
			s.show = !s.show;
			label[classList].toggle('off');
			!s.show && trans(cursorPts[i], 0, -10);
		}

		var legendLabels = legend.show ? series.map(function (s, i) {
			var label = placeDiv(null, leg);
			label.style.color = s.color;
			label.style.borderBottom = (s.width + "px ") + (s.dash == null ? "solid " : "dashed ") + s.color;
			label.textContent = s.label + ': -';

			if (i > 0) {
				on("click", label, function (e) {
					if (filtMouse(e)) {
						toggle(i);

						if (s.band) {
							// not super robust, will break if two bands are adjacent
							var pairedSeries = series[i+1].band ? i+1 : i-1;
							toggle(pairedSeries);
						}

						setView(i0, i1);
					}
				});
			}

			return label;
		}) : null;

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
			var idx = closestIdx(t, data[0], i0, i1);
			return idx;
		}

		function trans(el, xPos, yPos) {
			el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
		}

		var self = this;

		function updatePointer(pub) {
			rafPending = false;

			if (cursor.show) {
				trans(vt,x,0);
				trans(hz,0,y);
			}

		//	let pctY = 1 - (y / rect[HEIGHT]);

			var idx = closestIdxFromXpos(x);

			var xPos = getXPos(data[0][idx], scales[series[0].scale], canCssWidth);

			for (var i = 0; i < series.length; i++) {
				var s = series[i];

				if (i > 0 && s.show) {
					var yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

					if (yPos == null)
						{ yPos = -10; }

					trans(cursorPts[i], xPos, yPos);
				}

				if (legend.show)
					{ legendLabels[i][firstChild].nodeValue = s.label + ': ' + s.value(data[i][idx]); }
			}

			if (dragging) {
				var minX = min(x0, x);
				var maxX = max(x0, x);

				setStylePx(region, LEFT, minX);
				setStylePx(region, WIDTH, maxX - minX);
			}

			pub !== false && sync.pub(mousemove, self, x, y, canCssWidth, canCssHeight, idx);
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

		function on(ev, el, cb) {
			el.addEventListener(ev, cb, {passive: true});
		}

		function mouseDown(e, src, _x, _y, _w, _h, _i) {
			if (e == null || filtMouse(e)) {
				dragging = true;

				if (e != null) {
					x0 = e.clientX - rect.left;
					y0 = e.clientY - rect.top;
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

				if (e != null)
					{ sync.pub(mouseup, self, x, y, canCssWidth, canCssHeight, null); }
			}
		}

		function dblClick(e, src, _x, _y, _w, _h, _i) {
			if (i0 == 0 && i1 == dataLen - 1)
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
			{ on(ev, ev == mouseup ? doc : can, events[ev]); }

		var deb = debounce(syncRect, 100);

		on("resize", win, deb);
		on("scroll", win, deb);

		this.root = root;

		var syncKey = cursor.sync;

		var sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

		sync.sub(this);

		function pub(type, src, x, y, w, h, i) {
			events[type](null, src, x, y, w, h, i);
		}

		this.pub = pub;

		setData(data, 0, data[0].length - 1);

		plot.appendChild(can);
	}

	uPlot.fmtDate = fmtDate;

	return uPlot;

}());
