/**
* Copyright (c) 2019, Leon Sorokin
* All rights reserved. (MIT Licensed)
*
* plotty.js (Plotty)
* An exceptionally fast, tiny time series chart
* https://github.com/leeoniya/plotty (v0.1.0)
*/

var Plotty = (function () {
	'use strict';

	var RGX = /([^{]*?)\w(?=\})/g;

	var MAP = {
		YYYY: 'getFullYear',
		YY: 'getYear',
		MM: function (d) {
			return d.getMonth() + 1;
		},
		DD: 'getDate',
		HH: 'getHours',
		mm: 'getMinutes',
		ss: 'getSeconds',
		fff: 'getMilliseconds'
	};

	function tinydate (str, custom) {
		var parts=[], offset=0;

		str.replace(RGX, function (key, _, idx) {
			// save preceding string
			parts.push(str.substring(offset, idx - 1));
			offset = idx += key.length + 1;
			// save function
			parts.push(custom && custom[key] || function (d) {
				return ('00' + (typeof MAP[key] === 'string' ? d[MAP[key]]() : MAP[key](d))).slice(-key.length);
			});
		});

		if (offset !== str.length) {
			parts.push(str.substring(offset));
		}

		return function (arg) {
			var out='', i=0, d=arg||new Date();
			for (; i<parts.length; i++) {
				out += (typeof parts[i]==='string') ? parts[i] : parts[i](d);
			}
			return out;
		};
	}

	function Plotty(opts) {
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
			var stamp = tinydate(opts.format);
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

	Plotty.tinydate = tinydate;

	return Plotty;

}());
