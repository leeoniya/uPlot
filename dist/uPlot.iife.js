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

	var floor = M.floor;
	var round = M.round;
	var ceil = M.ceil;
	var min = M.min;
	var max = M.max;
	var pow = M.pow;
	var log10 = M.log10;

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

	var WIDTH = "width";
	var HEIGHT = "height";
	var TOP = "top";
	var BOTTOM = "bottom";
	var LEFT = "left";
	var RIGHT = "right";
	var firstChild = "firstChild";
	var createElement = "createElement";
	var hexBlack = "#000";

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

	var timeIncrs = [
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
		d * 365 ];

	var xAxisOpts = {
		scale: 'x',
		space: 40,
		height: 30,
		side: 0,
		class: "x-time",
		incrs: timeIncrs,
		values: function (vals, space) {
			var incr = vals[1] - vals[0];

			var stamp = (
				incr >= d ? fmtDate('{M}/{D}') :
				// {M}/{DD}/{YY} should only be prepended at 12a?		// {YY} only at year boundaries?
				incr >= h ? fmtDate('{M}/{DD}\n{h}{aa}') :
				incr >= m ? fmtDate('{M}/{DD}\n{h}:{mm}{aa}') :
				fmtDate('{M}/{DD}\n{h}:{mm}:{ss}{aa}')
			);

			return vals.map(function (val) { return stamp(new Date(val * 1e3)); });
		},
		grid: grid,
	};

	var stamp = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

	var xSeriesOpts = {
		label: "Time",
		scale: "x",
		value: function (v) { return stamp(new Date(v * 1e3)); },
	};

	var numIncrs = [0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9];

	var yAxisOpts = {
		scale: 'y',
		space: 30,
		width: 50,
		side: 1,
		class: "y-vals",
		incrs: numIncrs,
		values: function (vals, space) { return vals; },
		grid: grid,
	};

	var ySeriesOpts = {
		shown: true,
		label: "Value",
		scale: "y",
		value: function (v) { return v; },
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

	function uPlot(opts) {
		function setDefaults(d, xo, yo) {
			return [d.x].concat(d.y).map(function (o, i) { return assign({}, (i == 0 ? xo : yo), o); });
		}

		var series = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
		var axes = setDefaults(opts.axes, xAxisOpts, yAxisOpts);
		var data = series.map(function (s) { return s.data; });
		var scales = {};

		var cursor = opts.cursor;

		var dataLen = data[0].length;

		// rendered data window
		var i0 = 0;
		var i1 = dataLen - 1;

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

		var AXIS_WIDTH = 40;
		var AXIS_HEIGHT = 30;

		// accumulate axis offsets, reduce canvas width
		axes.forEach(function (axis, i) {
			var side = axis.side;
			var isVt = side % 2;

			if (isVt) {
				var w = (axis[WIDTH] = axis[WIDTH] || AXIS_WIDTH);
				canCssWidth -= w;

				if (side == 1)
					{ plotLft += w; }
			}
			else {
				var h = (axis[HEIGHT] = axis[HEIGHT] || AXIS_HEIGHT);
				canCssHeight -= h;

				if (side == 2)
					{ plotTop += h; }
			}
		});

		// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
		var off1 = fullCssWidth - plotLft;
		var off2 = fullCssHeight - plotTop;
		var off3 = plotLft + canCssWidth;
		var off0 = plotTop + canCssHeight;

		// init axis containers, set axis positions
		axes.forEach(function (axis, i) {
			var side = axis.side;
			var isVt = side % 2;

			var el = axis.root = placeDiv((isVt ? "y" : "x") + "-labels-" + side, root);

			if (isVt) {
				var w = axis[WIDTH];
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
				var h = axis[HEIGHT];
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
			return round((1 - pctY) * hgt) + 0.5;
		}

		function getXPos(val, scale, wid) {
			var pctX = (val - scale.min) / (scale.max - scale.min);
			return round(pctX * wid) + 0.5;
		}

		function setScales(reset) {
			if (reset)
				{ scales = {}; }

			series.forEach(function (s, i) {
				// fast-path special case for time axis, which is assumed ordered ASC
				if (i == 0) {
					scales[s.scale] = {
						min: data[0][i0],
						max: data[0][i1],
					};
				}
				else if (s.shown)
					{ setScale(s.scale, data[i]); }
			});
		}

		function setScale(key, data) {
			if (!(key in scales)) {
				scales[key] = {
					min: Infinity,
					max: -Infinity,
				};
			}

			var s = scales[key];

			for (var i = i0; i <= i1; i++) {
				s.min = min(s.min, data[i]);
				s.max = max(s.max, data[i]);
			}

			// auto-scale Y
			var delta = s.max - s.min;
			var mag = log10(delta);
			var exp = floor(mag);
			var incr = pow(10, exp) / 2;

			s.min = min(incrRoundDn(s.min, incr), s.min);
			s.max = max(incrRoundUp(s.max, incr), s.max);
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

			var yOk;
			var gap = false;

			ctx.beginPath();

			for (var i = i0; i <= i1; i++) {
				var xPos = getXPos(xdata[i], scaleX, can[WIDTH]);
				var yPos = getYPos(ydata[i], scaleY, can[HEIGHT]);

				if (yPos == null) {				// data gaps
					gap = true;
					ctx.moveTo(xPos, yOk);
				}
				else {
					yOk = yPos;
					if (gap) {
						ctx.moveTo(xPos, yPos);
						gap = false;
					}
					else
						{ ctx.lineTo(xPos, yPos); }
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

		function reframeDateRange(min, max, incr) {
			// get ts of 12am on day of i0 timestamp
			var minDate = new Date(min * 1000);
			var min00 = +(new Date(minDate[getFullYear](), minDate[getMonth](), minDate[getDate]())) / 1000;
			var offset = min - min00;
			var newMin = min00 + incrRoundUp(offset, incr);
			return [newMin, max];
		}

		function gridLabel(par, val, side, pxVal) {
			var div = placeDiv(null, par);
			div.textContent = val;
			setStylePx(div, side, pxVal);
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

				var ref = findIncr(max - min, axis.incrs, opts[dim], axis.space);
				var incr = ref[0];
				var space = ref[1];

				if (i == 0)
					{ (assign = reframeDateRange(min, max, incr), min = assign[0], max = assign[1]); }

				var ticks = [];

				for (var val = min; val <= max; val += incr)
					{ ticks.push(val); }

				var labels = axis.values(ticks, space);

				var getPos = ori == 0 ? getXPos : getYPos;
				var cssProp = ori == 0 ? LEFT : TOP;
				var canOffs = ticks.map(function (val) { return getPos(val, scale, can[dim]); });		// bit of waste if we're not drawing a grid

				canOffs.forEach(function (off, i) {
					gridLabel(axis.root, labels[i], cssProp, round(off/pxRatio));
				});

				var grid = axis.grid;

				if (grid) {
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
				}
			});
		}

		function clearChildren(el) {
			while (el[firstChild])
				{ el[firstChild].remove(); }
		}

		function setWindow(_i0, _i1) {
			i0 = _i0;
			i1 = _i1;
			setScales(true);
			ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
			axes.forEach(function (axis) {
				clearChildren(axis.root);
			});
			drawAxesGrid();
			drawSeries();
		}

		setWindow(i0, i1);

		plot.appendChild(can);

	//	INTERACTION

		var vt;
		var hz;

		if (cursor) {
			// cursor
			vt = placeDiv("vt", plot);
			hz = placeDiv("hz", plot);
			trans(vt, canCssWidth/2, 0);
			trans(hz, 0, canCssHeight/2);
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
					setWindow(i0, i1);
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

		function update() {
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
		}

		var x0 = null;
		var y0 = null;

		var x = null;
		var y = null;

		var dragging = false;

		var rect = null;

		function syncRect() {
			rect = can.getBoundingClientRect();
		}

		function mouseMove(e) {
			if (rect == null)
				{ syncRect(); }

			x = e.clientX - rect.left;
			y = e.clientY - rect.top;

			if (!rafPending) {
				rafPending = true;
				rAF(update);
			}
		}

		function on(ev, el, cb) {
			el.addEventListener(ev, cb, {passive: true});
		}

		function mouseDown(e) {
			x0 = e.clientX - rect.left;
			y0 = e.clientY - rect.top;
			dragging = true;
		}

		function mouseUp(e) {
			dragging = false;

			if (x == x0 && y == y0)
				{ return; }

			setStylePx(region, LEFT, 0);
			setStylePx(region, WIDTH, 0);

			var minX = min(x0, x);
			var maxX = max(x0, x);

			setWindow(
				closestIdxFromXpos(minX),
				closestIdxFromXpos(maxX)
			);
		}

		function dblclick(e) {
			if (i0 == 0 && i1 == dataLen - 1)
				{ return; }

			setWindow(0, dataLen - 1);
		}

		on("mousemove", can, mouseMove);
		on("mousedown", can, mouseDown);
		on("mouseup", can, mouseUp);
		on("dblclick", can, dblclick);

		var deb = debounce(syncRect, 100);

		on("resize", win, deb);
		on("scroll", win, deb);

		this.root = root;
	}

	uPlot.fmtDate = fmtDate;

	return uPlot;

}());
