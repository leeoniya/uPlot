import {
	getFullYear,
	getMonth,
	getDate,
	getDay,
	getHours,
	getMinutes,
	getSeconds,
	getMilliseconds,
} from './fmtDate';

import {
	inf,

	abs,
	floor,
	round,
	round6,
	ceil,
	min,
	max,
	pow,
	log10,
	debounce,
	closestIdx,
	rAF,
	doc,
	win,
	pxRatio,
	incrRoundUp,
	incrRoundDn,

	WIDTH,
	HEIGHT,
	TOP,
	BOTTOM,
	LEFT,
	RIGHT,
	firstChild,
	nextSibling,
	createElement,
	hexBlack,
	classList,

	mousemove,
	mousedown,
	mouseup,
	dblclick,
	resize,
	scroll,

	assign,
	isArr,

	fnOrSelf,
} from './utils';

import {
	xAxisOpts,
	yAxisOpts,
	xSeriesOpts,
	ySeriesOpts,

	timeIncrs,
	numIncrs,
	timeAxisVals,
	numAxisVals,

	timeSeriesVal,
	numSeriesVal,

	timeSeriesLabel,
	numSeriesLabel,

	getDateTicks,
	getNumTicks,
} from './opts';

import {
	_sync,
	syncs,
} from './sync';


function setDefaults(d, xo, yo) {
	return [d.x].concat(d.y).map((o, i) => assign({}, (i == 0 ? xo : yo), o));
}

function splitXY(d) {
	return {
		x: d[0],
		y: d.slice(1),
	};
}

export function Line(opts, data) {
	const self = this;

	const series  = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
	const axes    = setDefaults(opts.axes || {}, xAxisOpts, yAxisOpts);
	const scales  = (opts.scales = opts.scales || {});

	self.tzDate = opts.tzDate || (ts => new Date(ts * 1e3));

	self.series = splitXY(series);
	self.axes = splitXY(axes);
	self.scales = scales;

	const legend = assign({}, {show: true}, opts.legend);

	// set default value
	series.forEach((s, i) => {
		// init scales & defaults
		const key = s.scale;

		const sc = scales[key] = assign({
			type: 1,
			time: i == 0,
			auto: true,
			min:  inf,
			max: -inf,
		}, scales[key]);

		// by default, numeric y scales snap to half magnitude of range
		sc.range = fnOrSelf(sc.range || (i > 0 && !sc.time ? snapHalfMag : snapNone));

		if (s.time == null)
			s.time = sc.time;

		let isTime = s.time;

		s.value = s.value || (isTime ? timeSeriesVal : numSeriesVal);
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	const cursor = assign({}, {show: true}, opts.cursor);		// focus: {alpha, prox}

	let dataLen;

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

	const root = placeDiv("uplot");

	if (opts.id != null)
		root.id = opts.id;

	if (opts.class != null)
		root[classList].add(opts.class);

	if (opts.title != null) {
		let title = placeDiv("title", root);
		title.textContent = opts.title;
	}

	const wrap = placeDiv("wrap", root);

	const plot = placeDiv("plot", wrap);

	let fullCssWidth = opts[WIDTH];
	let fullCssHeight = opts[HEIGHT];

	let canCssWidth = fullCssWidth;
	let canCssHeight = fullCssHeight;

	// plot margins to account for axes
	let plotLft = 0;
	let plotTop = 0;

	const LABEL_HEIGHT = 30;

	// easement for rightmost x label if no right y axis exists
	let hasRightAxis = false;

	// accumulate axis offsets, reduce canvas width
	axes.forEach((axis, i) => {
		let side = axis.side;
		let isVt = side % 2;
		let lab = axis.label != null ? LABEL_HEIGHT : 0;

		if (isVt) {
			let w = axis[WIDTH] + lab;
			canCssWidth -= w;

			if (side == 1)
				plotLft += w;
			else
				hasRightAxis = true;
		}
		else {
			let h = axis[HEIGHT] + lab;
			canCssHeight -= h;

			if (side == 2)
				plotTop += h;
		}

		if (axis.time == null)
			axis.time = scales[axis.scale].time;

		let sc = scales[axis.scale];

		// also set defaults for incrs & values based on axis type
		let isTime = axis.time;

		axis.incrs = axis.incrs || (isTime && sc.type == 1 ? timeIncrs : numIncrs);
		axis.values = axis.values || (isTime ? timeAxisVals : numAxisVals);
		axis.ticks = fnOrSelf(axis.ticks || (isTime && sc.type == 1 ? getDateTicks : getNumTicks));
		axis.space = fnOrSelf(axis.space);
	});

	if (!hasRightAxis)
		canCssWidth -= yAxisOpts.width;

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	let off1 = fullCssWidth - plotLft;
	let off2 = fullCssHeight - plotTop;
	let off3 = plotLft + canCssWidth;
	let off0 = plotTop + canCssHeight;

	function placeAxis(axis, part, crossDim) {
		let side = axis.side;
		let isVt = side % 2;

		let el = placeDiv((isVt ? "y-" : "x-") + part + "-" + side, wrap);

		el.style.color = axis.color;
		addClass(el, axis.class);

		if (isVt) {
			let w = crossDim || axis[WIDTH];
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
			let h = crossDim || axis[HEIGHT];
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
	axes.forEach((axis, i) => {
		axis.vals = placeAxis(axis, "values");

		if (axis.label != null) {
			let side = axis.side;
			let isVt = side % 2;

			let lbl = placeAxis(axis, "labels", LABEL_HEIGHT);
			let txt = placeDiv("label", lbl);
			txt.textContent = axis.label;
			setStylePx(txt, HEIGHT, LABEL_HEIGHT);

			if (isVt) {
				setStylePx(txt, WIDTH, canCssHeight);

				let style = txt.style;

				if (side == 3)
					setOriRotTrans(style, "0 0", 90, -LABEL_HEIGHT);
				else
					setOriRotTrans(style, "100% 0", -90, -canCssHeight);
			}
		}
	});

	setStylePx(plot, TOP, plotTop);
	setStylePx(plot, LEFT, plotLft);
	setStylePx(wrap, WIDTH, fullCssWidth);
	setStylePx(wrap, HEIGHT, fullCssHeight);

	const { can, ctx } = makeCanvas(canCssWidth, canCssHeight);

	function addClass(el, c) {
		el[classList].add(c);
	}

	function makeCanvas(wid, hgt) {
		const can = doc[createElement]("canvas");
		const ctx = can.getContext("2d");

		can[WIDTH] = round(wid * pxRatio);
		can[HEIGHT] = round(hgt * pxRatio);
		setStylePx(can, WIDTH, wid);
		setStylePx(can, HEIGHT, hgt);

		return {
			can,
			ctx,
		};
	}

	function placeDiv(cls, targ) {
		let div = doc[createElement]("div");

		if (cls != null)
			addClass(div, cls);

		if (targ != null)
			targ.appendChild(div);		// TODO: chart.appendChild()

		return div;
	}

	function getYPos(val, scale, hgt) {
		if (val == null)
			return val;

		let pctY = (val - scale.min) / (scale.max - scale.min);
		return round((1 - pctY) * hgt);
	}

	function getXPos(val, scale, wid) {
		let pctX = (val - scale.min) / (scale.max - scale.min);
		return round(pctX * wid);
	}

	function snapNone(dataMin, dataMax) {
		return [dataMin, dataMax];
	}

	// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
	// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
	function snapHalfMag(dataMin, dataMax) {
		// auto-scale Y
		const delta = dataMax - dataMin;
		const mag = log10(delta || abs(dataMax) || 1);
		const exp = floor(mag);
		const incr = pow(10, exp) / 5;
		const buf = delta == 0 ? incr : 0;

		let snappedMin = round6(incrRoundDn(dataMin - buf, incr));
		let snappedMax = round6(incrRoundUp(dataMax + buf, incr));

		// for flat data, always use 0 as one chart extreme
		if (delta == 0) {
			if (dataMax > 0)
				snappedMin = 0;
			else if (dataMax < 0)
				snappedMax = 0;
		}
		else {
			// if buffer is too small, increase it
			if (snappedMax - dataMax < incr)
				snappedMax += incr;

			if (dataMin - snappedMin < incr)
				snappedMin -= incr;

			// if original data never crosses 0, use 0 as one chart extreme
			if (dataMin >= 0 && snappedMin < 0)
				snappedMin = 0;

			if (dataMax <= 0 && snappedMax > 0)
				snappedMax = 0;
		}

		return [snappedMin, snappedMax];
	}

	function setScales() {
		// original scales' min/maxes
		let minMaxes = {};

		series.forEach((s, i) => {
			let k = s.scale;
			let sc = scales[k];

			if (minMaxes[k] == null) {
				minMaxes[k] = {min: sc.min, max: sc.max};
				sc.min = inf;
				sc.max = -inf;
			}

			// fast-path for x axis, which is assumed ordered ASC and will not get padded
			if (i == 0) {
				let minMax = sc.range(
					sc.type == 2 ? self.i0 : data[0][self.i0],
					sc.type == 2 ? self.i1 : data[0][self.i1]
				);
				sc.min = s.min = minMax[0];
				sc.max = s.max = minMax[1];
			}
			else if (s.show) {
				// only run getMinMax() for invalidated series data, else reuse
				let minMax = s.min == inf ? (sc.auto ? getMinMax(data[i], self.i0, self.i1) : [0,100]) : [s.min, s.max];

				// initial min/max
				sc.min = min(sc.min, s.min = minMax[0]);
				sc.max = max(sc.max, s.max = minMax[1]);
			}
		});

		// snap non-derived scales
		for (let k in scales) {
			let sc = scales[k];

			if (sc.base == null && sc.min != inf) {
				let minMax = sc.range(sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}
		}

		// snap derived scales
		for (let k in scales) {
			let sc = scales[k];

			if (sc.base != null) {
				let base = scales[sc.base];

				if (base.min != inf) {
					let minMax = sc.range(base.min, base.max);
					sc.min = minMax[0];
					sc.max = minMax[1];
				}
			}
		}

		// invalidate paths of all series on changed scales
		series.forEach((s, i) => {
			let k = s.scale;
			let sc = scales[k];

			if (sc.min != minMaxes[k].min || sc.max != minMaxes[k].max)
				s.path = null;
		});
	}

	// TODO: ability to get only min or only max
	function getMinMax(data, _i0, _i1) {
		let _min = inf;
		let _max = -inf;

		for (let i = _i0; i <= _i1; i++) {
			_min = min(_min, data[i]);
			_max = max(_max, data[i]);
		}

		return [_min, _max];
	}

	let dir = 1;

	function drawSeries() {
		series.forEach((s, i) => {
			if (i > 0 && s.show && s.path == null)
				buildPath(i, data[0], data[i], scales[series[0].scale], scales[s.scale]);
		});

		series.forEach((s, i) => {
			if (i > 0 && s.show)
				drawPath(i);
		});
	}

	function drawPath(is) {
		const s = series[is];

		if (dir == 1) {
			const path = s.path;
			const width = s[WIDTH];
			const offset = (width % 2) / 2;

			setCtxStyle(s.color, width, s.dash, s.fill);

			ctx.globalAlpha = s.alpha;

			ctx.translate(offset, offset);

			if (s.band)
				ctx.fill(path);
			else
				ctx.stroke(path);

			ctx.translate(-offset, -offset);

			ctx.globalAlpha = 1;
		}

		if (s.band)
			dir *= -1;
	}

	function buildPath(is, xdata, ydata, scaleX, scaleY) {
		const s = series[is];
		const path = s.path = dir == 1 ? new Path2D() : series[is-1].path;
		const width = s[WIDTH];
		const offset = (width % 2) / 2;

		let gap = false;

		let minY = inf,
			maxY = -inf,
			prevX = dir == 1 ? offset : can[WIDTH] + offset,
			prevY, x, y;

		for (let i = dir == 1 ? self.i0 : self.i1; dir == 1 ? i <= self.i1 : i >= self.i0; i += dir) {
			x = getXPos(scaleX.type == 2 ? i : xdata[i], scaleX, can[WIDTH]);
			y = getYPos(ydata[i],                         scaleY, can[HEIGHT]);

			if (dir == -1 && i == self.i1)
				path.lineTo(x, y);

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
				path.closePath();

			dir *= -1;
		}
	}

	// dim is logical (getClientBoundingRect) pixels, not canvas pixels
	function findIncr(valDelta, incrs, dim, minSpace) {
		let pxPerUnit = dim / valDelta;

		for (var i = 0; i < incrs.length; i++) {
			let space = incrs[i] * pxPerUnit;

			if (space >= minSpace)
				return [incrs[i], space];
		}
	}

	function gridLabel(el, par, val, side, pxVal) {
		let div = el || placeDiv(null, par);
		div.textContent = val;
		setStylePx(div, side, pxVal);
		return div;
	}

	function filtMouse(e) {
		return e.button == 0;
	}

	function clearFrom(ch) {
		let next;
		while (next = ch[nextSibling])
			next.remove();
		ch.remove();
	}

	function drawAxesGrid() {
		axes.forEach((axis, i) => {
			let ori = i == 0 ? 0 : 1;
			let dim = ori == 0 ? WIDTH : HEIGHT;
			let canDim = ori == 0 ? canCssWidth : canCssHeight;
			let xDim = ori == 0 ? HEIGHT : WIDTH;
			let scale = scales[axis.scale];

			let ch = axis.vals[firstChild];

			// this will happen if all series using a specific scale are toggled off
			if (scale.min == inf) {
				ch && clearFrom(ch);
				return;
			}

			let {min, max} = scale;

			let [incr, space] = findIncr(max - min, axis.incrs, canDim, axis.space(min, max, canDim));

			let ticks = axis.ticks.call(self, min, max, incr);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? LEFT : TOP;

			// TODO: filter ticks & offsets that will end up off-canvas
			let canOffs = ticks.map(val => getPos(val, scale, can[dim]));		// bit of waste if we're not drawing a grid

			let labels = axis.values.call(self, scale.type == 2 ? ticks.map(i => data[0][i]) : ticks, space);		// BOO this assumes a specific data/series

			canOffs.forEach((off, i) => {
				ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
			});

			ch && clearFrom(ch);

			let grid = axis.grid;

			if (grid) {
				// note: the grid is cheap to build & redraw unconditionally, so does not
				// use the retained Path2D optimization or additional invalidation logic
				let offset = (grid[WIDTH] % 2) / 2;
				ctx.translate(offset, offset);

				setCtxStyle(grid.color || "#eee", grid[WIDTH], grid.dash);

				ctx.beginPath();

				canOffs.forEach((off, i) => {
					let mx, my, lx, ly;

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
		series.forEach(s => {
			s.min = inf;
			s.max = -inf;
			s.path = null;
		});
	}

	let didPaint;

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
			resetSeries();

		self.i0 = _i0;
		self.i1 = _i1;

		setScales();
		cursor.show && updatePointer();
		!didPaint && paint();
		didPaint = false;
	}

	self.setView = setView;

//	INTERACTION

	let vt;
	let hz;

	let x = null;
	let y = null;

	if (cursor.show) {
		vt = placeDiv("vt", plot);
		hz = placeDiv("hz", plot);
		x = canCssWidth/2;
		y = canCssHeight/2;
	}

	// zoom region
	const region = placeDiv("region", plot);

	const leg = placeDiv("legend", root);

	function toggleDOM(i, onOff) {
		let s = series[i];
		let label = legendLabels[i];

		if (s.show)
			label[classList].remove("off")
		else {
			label[classList].add("off");
			trans(cursorPts[i], 0, -10)
		}
	}

	function toggle(idxs, onOff) {
		(isArr(idxs) ? idxs : [idxs]).forEach(i => {
			let s = series[i];

			s.show = onOff != null ? onOff : !s.show;
			toggleDOM(i, onOff);

			if (s.band) {
				// not super robust, will break if two bands are adjacent
				let ip = series[i+1].band ? i+1 : i-1;
				series[ip].show = s.show;
				toggleDOM(ip, onOff);
			}
		});

		setView(self.i0, self.i1);
	}

	self.toggle = toggle;

	function _alpha(i, value) {
		series[i].alpha = legendLabels[i].style.opacity = value;
	}

	function _setAlpha(i, value) {
		let s = series[i];

		_alpha(i, value);

		if (s.band) {
			// not super robust, will break if two bands are adjacent
			let ip = series[i+1].band ? i+1 : i-1;
			_alpha(ip, value);
		}
	}

	let focus = cursor.focus;

	// y-distance
	const distsToCursor = Array(series.length);

	let focused = null;

	function setFocus(i, alpha) {
		if (i != focused) {
			series.forEach((s, i2) => {
				_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : alpha);
			});

			focused = i;
			paint();
		}
	}

	self.focus = setFocus;

	const legendLabels = legend.show ? series.map((s, i) => {
		let label = placeDiv(null, leg);
		label.style.color = s.color;
		label.style.borderBottom = (s.width + "px ") + (s.dash == null ? "solid " : "dashed ") + s.color;
		label.textContent = s.label + ': -';

		if (i > 0) {
			on("click", label, e => {
				filtMouse(e) && toggle(i);
			});

			if (focus) {
				on("mouseenter", label, e => {
					setFocus(i, focus.alpha);
				});
			}
		}

		return label;
	}) : null;

	if (focus) {
		on("mouseleave", leg, e => {
		//	setFocus(null, 1);
			updatePointer();
		});
	}

	// series-intersection markers
	const cursorPts = series.map((s, i) => {
		if (i > 0 && s.show) {
			let pt = placeDiv("point", plot);
			pt.style.background = s.color;
			return pt;
		}
	});

	let rafPending = false;

	function closestIdxFromXpos(x) {
		let pctX = x / canCssWidth;
		let xsc = scales[series[0].scale];
		let d = xsc.max - xsc.min;
		let t = xsc.min + pctX * d;
		let idx = xsc.type == 2 ? round(t) : closestIdx(t, data[0], self.i0, self.i1);
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

		let idx = closestIdxFromXpos(x);

		let scX = scales[series[0].scale];

		let xPos = getXPos(scX.type == 2 ? idx : data[0][idx], scX, canCssWidth);

		for (let i = 0; i < series.length; i++) {
			let s = series[i];

			if (i > 0 && s.show) {
				let yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

				if (yPos == null)
					yPos = -10;

				distsToCursor[i] = yPos > 0 ? abs(yPos - y) : inf;

				trans(cursorPts[i], xPos, yPos);
			}
			else
				distsToCursor[i] = inf;

			if (legend.show)
				legendLabels[i][firstChild].nodeValue = s.label + ': ' + s.value.call(self, data[i][idx]);
		}

		if (dragging) {
			let minX = min(x0, x);
			let maxX = max(x0, x);

			setStylePx(region, LEFT, minX);
			setStylePx(region, WIDTH, maxX - minX);
		}

		pub !== false && sync.pub(mousemove, self, x, y, canCssWidth, canCssHeight, idx);

		if (focus) {
			let minDist = min.apply(null, distsToCursor);

			let fi = null;

			if (minDist <= focus.prox) {
				distsToCursor.some((dist, i) => {
					if (dist == minDist)
						return fi = i;
				});
			}

			if (fi != focused)
				setFocus(fi, focus.alpha);

			// TODO: pub
		}
	}

	let x0 = null;
	let y0 = null;

	let dragging = false;

	let rect = null;

	function syncRect() {
		rect = can.getBoundingClientRect();
	}

	function mouseMove(e, src, _x, _y, _w, _h, _i) {
		if (rect == null)
			syncRect();

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

	const evOpts = {passive: true};

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

				let minX = min(x0, x);
				let maxX = max(x0, x);

				setView(
					closestIdxFromXpos(minX),
					closestIdxFromXpos(maxX),
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
			return;

		setView(0, dataLen - 1);

		if (e != null)
			sync.pub(dblclick, self, x, y, canCssWidth, canCssHeight, null);
	}

	let events = {};

	events[mousemove] = mouseMove;
	events[mousedown] = mouseDown;
	events[mouseup] = mouseUp;
	events[dblclick] = dblClick;

	for (let ev in events)
		ev != mouseup && on(ev, can, events[ev]);

	let deb = debounce(syncRect, 100);

	on(resize, win, deb);
	on(scroll, win, deb);

	self.root = root;

	let syncKey = cursor.sync;

	let sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

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