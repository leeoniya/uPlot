/**
* Copyright (c) 2019, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* plotty.js (Plotty)
* An exceptionally fast, tiny time series chart
* https://github.com/leeoniya/plotty (v0.1.0)
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

	var year = 'getFullYear';
	var month = 'getMonth';
	var date = 'getDate';
	var day = 'getDay';
	var hrs = 'getHours';
	var mins = 'getMinutes';
	var secs = 'getSeconds';
	var msecs = 'getMilliseconds';

	var subs = {
		// 2019
		YYYY:	function (d) { return d[year](); },
		// 19
		YY:		function (d) { return (d[year]()+'').slice(2); },
		// July
		MMMM:	function (d) { return months[d[month]()]; },
		// Jul
		MMM:	function (d) { return months3[d[month]()]; },
		// 07
		MM:		function (d) { return zeroPad2(d[month]()+1); },
		// 7
		M:		function (d) { return d[month]()+1; },
		// 09
		DD:		function (d) { return zeroPad2(d[date]()); },
		// 9
		D:		function (d) { return d[date](); },
		// Monday
		WWWW:	function (d) { return days[d[day]()]; },
		// Mon
		WWW:	function (d) { return days3[d[day]()]; },
		// 03
		HH:		function (d) { return zeroPad2(d[hrs]()); },
		// 3
		H:		function (d) { return d[hrs](); },
		// 9 (12hr, unpadded)
		h:		function (d) {var h = d[hrs](); return h > 12 ? h - 12 : h;},
		// AM
		AA:		function (d) { return d[hrs]() >= 12 ? 'PM' : 'AM'; },
		// am
		aa:		function (d) { return d[hrs]() >= 12 ? 'pm' : 'am'; },
		// 09
		mm:		function (d) { return zeroPad2(d[mins]()); },
		// 9
		m:		function (d) { return d[mins](); },
		// 09
		ss:		function (d) { return zeroPad2(d[secs]()); },
		// 9
		s:		function (d) { return d[secs](); },
		// 374
		fff:	function (d) { return zeroPad3(d[msecs]()); },
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

	function uPlot(opts) {
		// todo shallow-copy opts?
		var doc = document;

		var rat = devicePixelRatio;
		var M = Math;
		var floor = M.floor;
		var round = M.round;
		var ceil = M.ceil;
		var min = M.min;
		var max = M.max;
		var pow = M.pow;
		var log10 = M.log10;

		// TODO: series[0].format
		if (typeof opts.format == "string") {
			var stamp = fmtDate(opts.format);
			opts.format = function (v) { return stamp(new Date(v * 1e3)); };
		}

		var cursor = opts.cursor;

		function incrRoundUp(num, incr) {
			return ceil(num/incr)*incr;
		}

		function incrRoundDn(num, incr) {
			return floor(num/incr)*incr;
		}

		var root = placeDiv("chart");

		var ref = makeCanvas(opts.width, opts.height);
		var can = ref.can;
		var ctx = ref.ctx;

		var data = opts.data;

		var dataLen = data[0].length;

		// rendered data window
		var i0 = 0;
		var i1 = dataLen - 1;

		var series = opts.series;

		var scales = {};

		function makeCanvas(wid, hgt) {
			var can = doc.createElement("canvas");
			var ctx = can.getContext("2d");

			can.width = round(wid * rat);
			can.height = round(hgt * rat);
			can.style.width = wid + "px";
			can.style.height = hgt + "px";

			return {
				can: can,
				ctx: ctx,
			};
		}

		function placeDiv(cls, targ) {
			var div = doc.createElement("div");

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

		function setScales(reset) {
			if (reset)
				{ scales = {}; }

			// fast-path special case for time axis, which is assumed ordered ASC
			scales['t'] = {
				min: data[0][i0],
				max: data[0][i1],
			};

			series.forEach(function (s, i) {
				setScale(s.scale, data[i+1]);
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
			var incr = pow(10, exp);

			s.min = min(incrRoundDn(s.min, incr), s.min);
			s.max = max(incrRoundUp(s.max, incr), s.max);
		}

		// with clear?
		function drawGraphs() {
			setScales();
			ctx.clearRect(0, 0, can.width, can.height);
			series.forEach(function (s, i) {
				drawGraph(
					data[0],
					data[i+1],
					s.color,
					scales['t'],
					scales[s.scale]
				);
			});
		}

		function drawGraph(xdata, ydata, stroke, scaleX, scaleY) {
			ctx.lineWidth = 1;
			ctx.strokeStyle = stroke;

			var yOk;
			var gap = false;

			ctx.beginPath();

			for (var i = i0; i <= i1; i++) {
				var xPos = getXPos(xdata[i], scaleX, can.width);
				var yPos = getYPos(ydata[i], scaleY, can.height);

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

		drawGraphs();

		root.appendChild(can);

	//	INTERACTION

		var rAF = requestAnimationFrame;

		var vt;
		var hz;

		if (cursor) {
			// cursor
			vt = placeDiv("vt", root);
			hz = placeDiv("hz", root);
		}

		// zoom region
		var region = placeDiv("region", root);

		var leg = placeDiv("legend", root);

		var labels = [{
			color: opts.color,
			label: opts.label,
		}].concat(series).map(function (s, i) {
			var label = placeDiv("label", leg);
			label.style.color = s.color;
			label.textContent = s.label + ': -';
			return label;
		});

		// series-intersection markers
		var pts = series.map(function (s) {
			var dot = placeDiv("dot", root);
			dot.style.background = s.color;
			return dot;
		});

		var rafPending = false;

		function closestIdxFromXpos(x) {
			var pctX = x / opts.width;
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

		//	let pctY = 1 - (y / rect.height);

			var idx = closestIdxFromXpos(x);

			var xPos = getXPos(data[0][idx], scales['t'], opts.width);

			labels[0].firstChild.nodeValue = opts.label + ': ' + opts.format(data[0][idx]);

			for (var i = 0; i < series.length; i++) {
				var yPos = getYPos(data[i+1][idx], scales[series[i].scale], opts.height);
				trans(pts[i], xPos, yPos);
				labels[i+1].firstChild.nodeValue = series[i].label + ': ' + series[i].format(data[i+1][idx]);
			}

			if (dragging) {
				var minX = min(x0, x);
				var maxX = max(x0, x);

				region.style.left = minX + "px";
				region.style.width = (maxX - minX) + "px";
			}
		}

		var x0 = null;
		var y0 = null;

		var x = null;
		var y = null;

		var dragging = false;

		var rect = can.getBoundingClientRect();

		function mouseMove(e) {
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

		function setWindow(_i0, _i1) {
			i0 = _i0;
			i1 = _i1;
			setScales(true);
			drawGraphs();
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

		function mouseDown(e) {
			x0 = e.clientX - rect.left;
			y0 = e.clientY - rect.top;
			dragging = true;
		}

		function mouseUp(e) {
			dragging = false;

			if (x == x0 && y == y0)
				{ return; }

			region.style.left = 0;
			region.style.width = 0;

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

			setWindow(
				0,
				dataLen - 1
			);
		}

		on("mousemove", can, mouseMove);
		on("mousedown", can, mouseDown);
		on("mouseup", can, mouseUp);
		on("dblclick", can, dblclick);

		this.root = root;
	}

	uPlot.fmtDate = fmtDate;

	return uPlot;

}());
