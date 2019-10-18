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
	d = h * 24;

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
	d * 365 ]);

var md = '{M}/{D}';
var hr = '{h}';
var mm = ':{mm}';
var ss = ':{ss}';
var ms = '.{fff}';
var ampm = '{aa}';

var mdhr = md + '\n' + hr;

var shortDate = fmtDate(md);
var shortDateHour = fmtDate(mdhr + ampm);
var shortDateHourMin = fmtDate(mdhr + mm + ampm);
var shortDateHourMinSec = fmtDate(mdhr + mm + ss + ampm);
var shortHourMinSecMilli = fmtDate(hr + mm + ss + ms + ampm);

function timeAxisVals(vals, space) {
	var incr = vals[1] - vals[0];

	var stamp = (
		incr >= d ? shortDate :
		// {M}/{DD}/{YY} should only be prepended at 12a?		// {YY} only at year boundaries?
		incr >= h ? shortDateHour :
		incr >= m ? shortDateHourMin :
		incr >= 1 ? shortDateHourMinSec :
		shortHourMinSecMilli
	);

	return vals.map(function (val) { return stamp(new Date(val * 1e3)); });
}

var longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

function timeSeriesVal(val) {
	return longDateHourMin(new Date(val * 1e3));
}

var xAxisOpts = {
	type: "t",		// t, n
	scale: 'x',
	space: 40,
	height: 30,
	side: 0,
	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
	grid: grid,
};

var numSeriesLabel = "Value";
var timeSeriesLabel = "Time";

var xSeriesOpts = {
	type: "t",
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
	type: "n",		// t, n
	scale: 'y',
	space: 30,
	width: 50,
	side: 1,
	class: "y-vals",
//	incrs: numIncrs,
//	values: (vals, space) => vals,
	grid: grid,
};

var ySeriesOpts = {
	type: "n",
	scale: "y",
	shown: true,
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
	var axes = setDefaults(opts.axes, xAxisOpts, yAxisOpts);

	// set default value
	series.forEach(function (s) {
		var isTime = s.type == "t";

		s.value = s.value || (isTime ? timeSeriesVal : numSeriesVal);
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	var scales = {};

	var cursor = opts.cursor;

	var dataLen;

	// rendered data window
	var i0;
	var i1;

	function setData(_data, _i0, _i1, rel) {
		data = _data;
		dataLen = data[0].length;
		setView(_i0, _i1, rel);
	}

	this.setData = setData;

	function setStylePx(el, name, value) {
		el.style[name] = value + "px";
	}

	function setCtxStyle(color, width, dash, fill) {
		ctx.strokeStyle = color || hexBlack;
		ctx.lineWidth = width || 1;
		ctx.setLineDash(dash || []);
		ctx.fillStyle = fill || hexBlack;
	}

	var root = placeDiv("chart");

	var plot = placeDiv("plot", root);

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

		// also set defaults for incrs & values based on axis type
		var isTime = axis.type == "t";
		axis.incrs = axis.incrs || (isTime ? timeIncrs : numIncrs);
		axis.values = axis.values || (isTime ? timeAxisVals : numAxisVals);
	});

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	var off1 = fullCssWidth - plotLft;
	var off2 = fullCssHeight - plotTop;
	var off3 = plotLft + canCssWidth;
	var off0 = plotTop + canCssHeight;

	function placeAxis(axis, part, crossDim) {
		var side = axis.side;
		var isVt = side % 2;

		var el = placeDiv((isVt ? "y-" : "x-") + part + "-" + side, root);

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
	setStylePx(root, WIDTH, fullCssWidth);
	setStylePx(root, HEIGHT, fullCssHeight);

	var ref = makeCanvas(canCssWidth, canCssHeight);
	var can = ref.can;
	var ctx = ref.ctx;

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
			{ div.className = cls; }

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

	function reScale(min, max, incr) {
		return [min, max];
	}

	// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
	// setMinMax() serves the same purpose for non-temporal/numeric y-axes due to incr-snapped padding added above/below
	function snapMinDate(min, max, incr) {
		// get ts of 12am on day of i0 timestamp
		var minDate = new Date(min * 1000);
		var min00 = +(new Date(minDate[getFullYear](), minDate[getMonth](), minDate[getDate]())) / 1000;
		var offset = min - min00;
		var newMin = min00 + incrRoundUp(offset, incr);
		return [newMin, max];
	}

	function setScales(reset) {
		if (reset)
			{ scales = {}; }		// TODO: use original opts scales if they exist

		series.forEach(function (s, i) {
			var key = s.scale;

			if (!(key in scales)) {
				scales[key] = {
					min:  inf,
					max: -inf,
				};
			}

			var sc = scales[key];

			sc.adj = sc.adj || (s.type == "t" ? snapMinDate : reScale);

			// fast-path for x axis, which is assumed ordered ASC and will not get padded
			if (i == 0) {
				sc.min = data[0][i0];
				sc.max = data[0][i1];
			}
			else if (s.shown)
				{ setMinMax(sc, data[i]); }
		});
	}

	function setMinMax(s, data) {
		for (var i = i0; i <= i1; i++) {
			s.min = min(s.min, data[i]);
			s.max = max(s.max, data[i]);
		}

		// auto-scale Y
		var delta = s.max - s.min;
		var mag = log10(delta || abs(s.max) || 1);
		var exp = floor(mag);
		var incr = pow(10, exp) / 2;
		var buf = delta == 0 ? incr : 0;

		var origMin = s.min;

		s.min = round6(incrRoundDn(s.min - buf, incr));
		s.max = round6(incrRoundUp(s.max + buf, incr));

		if (origMin >= 0 && s.min < 0)
			{ s.min = 0; }
	}

	function drawSeries() {
		series.forEach(function (s, i) {
			if (i > 0 && s.shown) {
				drawLine(
					data[0],
					data[i],
					scales[series[0].scale],
					scales[s.scale],
					s.color,
					s[WIDTH],
					s.dash,
					s.fill
				);
			}
		});
	}

	function drawLine(xdata, ydata, scaleX, scaleY, color, width, dash, fill) {
		setCtxStyle(color, width, dash, fill);

		var gap = false;

		ctx.beginPath();

		var minY = inf,
			maxY = -inf,
			halfStroke = width/2,
			prevX = halfStroke,
			prevY, x, y;

		for (var i = i0; i <= i1; i++) {
			x = getXPos(xdata[i], scaleX, can[WIDTH]) + halfStroke;
			y = getYPos(ydata[i], scaleY, can[HEIGHT]);

			if (y == null) {				// data gaps
				gap = true;
				ctx.moveTo(x, prevY);
			}
			else {
				y += halfStroke;

				if (x - prevX >= width) {
					if (gap) {
						ctx.moveTo(x, y);
						gap = false;
					}
					else if (i > i0) {
						ctx.moveTo(prevX, maxY);
						ctx.lineTo(prevX, minY);
						ctx.moveTo(prevX, prevY);
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

		ctx.stroke();
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

	function drawAxesGrid() {
		axes.forEach(function (axis, i) {
			var assign;

			var ori = i == 0 ? 0 : 1;
			var dim = ori == 0 ? WIDTH : HEIGHT;
			var xDim = ori == 0 ? HEIGHT : WIDTH;
			var scale = scales[axis.scale];

			// this will happen if all series using a specific scale are toggled off
			if (scale == null)
				{ return; }

			var min = scale.min;
			var max = scale.max;
			var adj = scale.adj;

			var ref = findIncr(max - min, axis.incrs, opts[dim], axis.space);
			var incr = ref[0];
			var space = ref[1];

			(assign = adj(min, max, incr), min = assign[0], max = assign[1]);

			var ticks = [];

			for (var val = min; val <= max; val = round6(val + incr))
				{ ticks.push(val); }

			var labels = axis.values(ticks, space);

			var getPos = ori == 0 ? getXPos : getYPos;
			var cssProp = ori == 0 ? LEFT : TOP;
			var canOffs = ticks.map(function (val) { return getPos(val, scale, can[dim]); });		// bit of waste if we're not drawing a grid

			var ch = axis.vals[firstChild];

			canOffs.forEach(function (off, i) {
				ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
			});

			if (ch) {
				var next;
				while (next = ch[nextSibling])
					{ next.remove(); }
				ch.remove();
			}

			var grid = axis.grid;

			if (grid) {
				var halfStroke = grid[WIDTH]/2;

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

					ctx.moveTo(mx + halfStroke, my + halfStroke);
					ctx.lineTo(lx + halfStroke, ly + halfStroke);
				});

				ctx.stroke();
			}
		});
	}

	function setView(_i0, _i1, rel) {
		i0 = _i0 != null ? _i0 + (rel ? i0 : 0) : i0;
		i1 = _i1 != null ? _i1 + (rel ? i1 : 0) : i1;

		setScales(true);
		ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
	//	axes.forEach(axis => {
	//		clearChildren(axis.root);
	//	});
		drawAxesGrid();
		drawSeries();
		updatePointer();
	}

	this.setView = setView;

//	INTERACTION

	var vt;
	var hz;

	var x = null;
	var y = null;

	if (cursor) {
		vt = placeDiv("vt", plot);
		hz = placeDiv("hz", plot);
		x = canCssWidth/2;
		y = canCssHeight/2;
	}

	// zoom region
	var region = placeDiv("region", plot);

	var leg = placeDiv("legend", root);

	var labels = series.map(function (s, i) {
		var label = placeDiv("label", leg);
		label.style.color = s.color;
		label.textContent = s.label + ': -';

		if (i > 0) {
			on("click", label, function () {
				s.shown = !s.shown;
				label.classList.toggle('off');
				setView(i0, i1);
			});
		}

		return label;
	});

	// series-intersection markers
	var pts = series.map(function (s, i) {
		if (i > 0 && s.shown) {
			var dot = placeDiv("dot", plot);
			dot.style.background = s.color;
			return dot;
		}
	});

	var rafPending = false;

	function closestIdxFromXpos(x) {
		var pctX = x / canCssWidth;
		var d = data[0][i1] - data[0][i0];
		var t = data[0][i0] + pctX * d;
		var idx = closestIdx(t, data[0], i0, i1);
		return idx;
	}

	function trans(el, xPos, yPos) {
		el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
	}

	var self = this;

	function updatePointer(pub) {
		rafPending = false;

		if (cursor) {
			trans(vt,x,0);
			trans(hz,0,y);
		}

	//	let pctY = 1 - (y / rect[HEIGHT]);

		var idx = closestIdxFromXpos(x);

		var xPos = getXPos(data[0][idx], scales[series[0].scale], canCssWidth);

		for (var i = 0; i < series.length; i++) {
			var s = series[i];

			if (i > 0 && s.shown) {
				var yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

				if (yPos == null)
					{ yPos = -10; }

				trans(pts[i], xPos, yPos);
			}

			labels[i][firstChild].nodeValue = s.label + ': ' + s.value(data[i][idx]);
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

	function mouseUp(e, src, _x, _y, _w, _h, _i) {
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
		{ on(ev, can, events[ev]); }

	var deb = debounce(syncRect, 100);

	on("resize", win, deb);
	on("scroll", win, deb);

	this.root = root;

	var syncKey = opts.sync;

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

module.exports = uPlot;
