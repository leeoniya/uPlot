import {
	copy,

	inf,
	abs,
	floor,
	round,
	round6,
	ceil,
	min,
	max,
	clamp,
	pow,
	log10,
	debounce,
	closestIdx,
	getMinMax,
	incrRoundUp,
	incrRoundDn,
	assign,
	isArr,
	fnOrSelf,
} from './utils';

import {
	WIDTH,
	HEIGHT,
	TOP,
	BOTTOM,
	LEFT,
	RIGHT,
	hexBlack,
	firstChild,
	nextSibling,

	mousemove,
	mousedown,
	mouseup,
	dblclick,
	resize,
	scroll,
} from './strings';

import {
	rAF,
	doc,
	win,
	pxRatio,

	addClass,
	remClass,
	setStylePx,
	setOriRotTrans,
	makeCanvas,
	placeTag,
	placeDiv,
	clearFrom,
	trans,
	on,
	off,
} from './dom';

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

	timeAxisTicks,
	numAxisTicks,

	timeAxisStamps,
	_timeAxisStamps,
} from './opts';

import {
	_sync,
	syncs,
} from './sync';

// TODO: reduce need to locate indexes for redraw or resetting / unzoom

function setDefaults(d, xo, yo) {
	return [].concat(d.x, d.y).map((o, i) => assign({}, (i == 0 ? xo : yo), o));
}

function splitXY(d) {
	return {
		x: d[0],
		y: d.slice(1),
	};
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
function snapFifthMag(dataMin, dataMax) {
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

export function Line(opts, data) {
	opts = copy(opts);

	const self = this;

	const series  = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
	const axes    = setDefaults(opts.axes || {}, xAxisOpts, yAxisOpts);
	const scales  = (opts.scales = opts.scales || {});

	const spanGaps = opts.spanGaps || false;

	const gutters = assign({x: yAxisOpts[WIDTH], y: xAxisOpts[HEIGHT]}, opts.gutters);

//	self.tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
	const tzDate = opts.tzDate || (ts => new Date(ts * 1e3));

	const _timeAxisTicks = timeAxisTicks(tzDate);
	const _timeAxisVals = timeAxisVals(tzDate, _timeAxisStamps);
	const _timeSeriesVal = timeSeriesVal(tzDate);

	self.series = splitXY(series);
	self.axes = splitXY(axes);
	self.scales = scales;

	const legendOpts = assign({show: true}, opts.legend);

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
		sc.range = fnOrSelf(sc.range || (i > 0 && !sc.time ? snapFifthMag : snapNone));

		if (s.time == null)
			s.time = sc.time;

		let isTime = s.time;

		s.value = s.value || (isTime ? _timeSeriesVal  : numSeriesVal);
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	const xScaleKey = series[0].scale;
	const xScaleType = scales[xScaleKey].type;

	const cursor = self.cursor = assign({
		show: true,
		cross: true,
		locked: false,
		left: 0,
		top: 0,
	}, opts.cursor);

	const focus = cursor.focus;		// focus: {alpha, prox}

	let dataLen;

	// rendered data window
	let i0 = null;
	let i1 = null;

	let data0 = null;

	function setData(_data, _min, _max) {
		data = _data.slice();
		data0 = data[0];
		dataLen = data0.length;

		if (xScaleType == 2)
			data[0] = data0.map((v, i) => i);

		resetSeries();

		setScale(
			xScaleKey,
			_min != null ? _min : data[0][0],
			_max != null ? _max : data[0][dataLen - 1],
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

	const root = placeDiv("uplot");

	if (opts.id != null)
		root.id = opts.id;

	if (opts.class != null)
		addClass(root, opts.class);

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
	let hasLeftAxis = false;

	// accumulate axis offsets, reduce canvas width
	axes.forEach((axis, i) => {
		if (!axis.show)
			return;

		let side = axis.side;
		let isVt = side % 2;
		let lab = axis.label != null ? LABEL_HEIGHT : 0;

		if (isVt) {
			let w = axis[WIDTH] + lab;
			canCssWidth -= w;

			if (side == 1) {
				plotLft += w;
				hasLeftAxis = true;
			}
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

		axis.space = fnOrSelf(axis.space);
		axis.incrs = fnOrSelf(axis.incrs || (isTime && sc.type == 1 ? timeIncrs      : numIncrs));
		axis.ticks = fnOrSelf(axis.ticks || (isTime && sc.type == 1 ? _timeAxisTicks : numAxisTicks));
		let av = axis.values;
		axis.values = isTime ? (isArr(av) ? timeAxisVals(tzDate, timeAxisStamps(av)) : av || _timeAxisVals) : av || numAxisVals;
	});

	// hz gutters
	if (hasLeftAxis || hasRightAxis) {
		if (!hasRightAxis)
			canCssWidth -= gutters.x;
		if (!hasLeftAxis) {
			canCssWidth -= gutters.x;
			plotLft += gutters.x;
		}
	}

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	let off1 = fullCssWidth - plotLft;
	let off2 = fullCssHeight - plotTop;
	let off3 = plotLft + canCssWidth;
	let off0 = plotTop + canCssHeight;

	function placeAxis(axis, prefix, crossDim) {
		let side = axis.side;
		let isVt = side % 2;

		let el = placeDiv(prefix + "-" + (isVt ? "y-" : "x-") + side, wrap);

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

	// init axis containers, set axis positions
	axes.forEach((axis, i) => {
		if (!axis.show)
			return;

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

	const pendScales = {};

	function setScales() {
		if (inBatch) {
			shouldSetScales = true;
			return;
		}

	//	console.log("setScales()");

		// original scales' min/maxes
		let minMaxes = {};

		series.forEach((s, i) => {
			let k = s.scale;
			let sc = scales[k];

			if (minMaxes[k] == null) {
				minMaxes[k] = {min: sc.min, max: sc.max};

				if (pendScales[k] != null)
					assign(sc, pendScales[k]);
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
					i0++;
				if (data[0][i1] > sc.max)
					i1--;

				s.min = data0[i0];
				s.max = data0[i1];

				let minMax = sc.range(sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}
			else if (s.show) {
				// only run getMinMax() for invalidated series data, else reuse
				let minMax = s.min == inf ? (sc.auto ? getMinMax(data[i], i0, i1) : [0,100]) : [s.min, s.max];

				// initial min/max
				sc.min = min(sc.min, s.min = minMax[0]);
				sc.max = max(sc.max, s.max = minMax[1]);
			}
		});

		// snap non-derived scales
		for (let k in scales) {
			let sc = scales[k];

			if (sc.base == null && sc.min != inf && pendScales[k] == null) {
				let minMax = sc.range(sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}

			pendScales[k] = null;
		}

		// range derived scales
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

	let dir = 1;

	function drawSeries() {
		series.forEach((s, i) => {
			if (i > 0 && s.show && s.path == null)
				buildPath(i, data[0], data[i], scales[xScaleKey], scales[s.scale]);
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
			else {
				ctx.stroke(path);

				if (s.fill != null) {
					let zeroY = getYPos(0, scales[s.scale], can[HEIGHT]);

					path.lineTo(can[WIDTH], zeroY);
					path.lineTo(0, zeroY);
					ctx.fill(path);
				}
			}

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

		let gap = false;

		let minY = inf,
			maxY = -inf,
			x, y;

		let _i0 = clamp(i0 - 1, 0, dataLen - 1);
		let _i1 = clamp(i1 + 1, 0, dataLen - 1);

		let prevX = getXPos(xdata[dir == 1 ? _i0 : _i1], scaleX, can[WIDTH]),
			prevY;

		for (let i = dir == 1 ? _i0 : _i1; dir == 1 ? i <= _i1 : i >= _i0; i += dir) {
			x = getXPos(xdata[i], scaleX, can[WIDTH]);
			y = getYPos(ydata[i], scaleY, can[HEIGHT]);

			if (dir == -1 && i == _i1)
				path.lineTo(x, y);

			if (y == null)
				gap = true;
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
				path.closePath();

			dir *= -1;
		}
	}

	function drawAxesGrid() {
		axes.forEach((axis, i) => {
			if (!axis.show)
				return;

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

			let minSpace = axis.space(min, max, canDim);

			let [incr, space] = findIncr(max - min, axis.incrs(), canDim, minSpace);

			// if we're using index positions, force first tick to match passed index
			let forceMin = scale.type == 2;

			let ticks = axis.ticks(min, max, incr, space/minSpace, forceMin);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? LEFT : TOP;

			// TODO: filter ticks & offsets that will end up off-canvas
			let canOffs = ticks.map(val => getPos(val, scale, can[dim]));		// bit of waste if we're not drawing a grid

			let labels = axis.values(scale.type == 2 ? ticks.map(i => data0[i]) : ticks, space);		// BOO this assumes a specific data/series

			canOffs.forEach((off, i) => {
				ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
			});

			ch && clearFrom(ch);

			let grid = axis.grid;

			if (grid.show) {
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
	//	console.log("resetSeries()");

		series.forEach(s => {
			s.min = inf;
			s.max = -inf;
			s.path = null;
		});
	}

	let didPaint;

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
		let sc = scales[key];

		if (sc.base == null) {
			pendScales[key] = {min, max};

			if (key == xScaleKey && (min != sc.min || max != sc.max))
				resetSeries();

			didPaint = false;
			setScales();
			cursor.show && updatePointer();
			!didPaint && paint();
			didPaint = false;
		}
	}

	self.setScale = setScale;

//	INTERACTION

	let vt;
	let hz;

	if (cursor.show && cursor.cross) {
		cursor.left = -10;
		cursor.top = -10;

		let c = "cursor-";

		vt = placeDiv(c + "x", plot);
		hz = placeDiv(c + "y", plot);

	//	x = canCssWidth/2;
	//	y = canCssHeight/2;
	}

	const zoom = cursor.show ? placeDiv("zoom", plot) : null;

	let legend = null;
	let legendLabels = null;	// TODO: legendValues?
	let multiValLegend = false;

	if (legendOpts.show) {
		legend = placeTag("table", "legend", root);

		let vals = series[1].values;
		multiValLegend = vals != null;

		let keys;

		if (multiValLegend) {
			let head = placeTag("tr", "labels", legend);
			placeTag("th", null, head);
			keys = vals(0);

			for (var key in keys)
				placeTag("th", null, head).textContent = key;
		}
		else {
			keys = {_: 0};
			addClass(legend, "inline");
		}

		legendLabels = series.map((s, i) => {
			if (i == 0 && multiValLegend)
				return null;

			let _row = [];

			let row = placeTag("tr", "series", legend);

			if (!s.show)
				addClass(row, "off");

			let label = placeTag("th", null, row);
			label.textContent = s.label;

			label.style.color = s.color;
		//	label.style.borderLeft = "4px " + (s.dash == null ? "solid " : "dashed ") + s.color;
		//	label.style.borderBottom = (s.width + "px ") + (s.dash == null ? "solid " : "dashed ") + s.color;

			if (i > 0) {
				on("click", label, e => {
					if (cursor.locked)
						return;

					filtMouse(e) && toggle(i, null, syncOpts.toggle);
				});

				if (focus) {
					on("mouseenter", label, e => {
						if (cursor.locked)
							return;

						setFocus(i, focus.alpha, syncOpts.focus);
					});
				}
			}

			for (var key in keys) {
				let v = placeTag("td", null, row);
				v.textContent = "--";
				_row.push(v);
			}

			return _row;
		});
	}

	function toggleDOM(i, onOff) {
		let s = series[i];
		let label = legendLabels[i][0].parentNode;

		if (s.show)
			remClass(label, "off");
		else {
			addClass(label, "off");
			cursor.show && trans(cursorPts[i], 0, -10)
		}
	}

	function toggle(idxs, onOff, pub) {
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

		setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);		// redraw

		pub && sync.pub("toggle", self, idxs, onOff);
	}

	self.toggle = toggle;

	function _alpha(i, value) {
		series[i].alpha = legendLabels[i][0].parentNode.style.opacity = value;
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

	// y-distance
	const distsToCursor = Array(series.length);

	let focused = null;

	// kill alpha?
	function setFocus(i, alpha, pub) {
		if (i != focused) {
		//	console.log("setFocus()");

			series.forEach((s, i2) => {
				_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : alpha);
			});

			focused = i;
			paint();

			pub && sync.pub("focus", self, i);
		}
	}

	self.focus = setFocus;

	if (focus) {
		on("mouseleave", legend, e => {
			if (cursor.locked)
				return;
		//	setFocus(null, 1);
			updatePointer();
		});
	}

	// series-intersection markers
	const cursorPts = cursor.show ? series.map((s, i) => {
		if (i > 0) {
			let pt = placeDiv("point", plot);
			pt.style.background = s.color;
			return pt;
		}
	}) : null;

	let rafPending = false;

	function scaleValueAtPos(pos, scale) {
		let dim = scale == xScaleKey ? canCssWidth : canCssHeight;
		let pct = clamp(pos / dim, 0, 1);

		let sc = scales[scale];
		let d = sc.max - sc.min;
		return sc.min + pct * d;
	}

	function closestIdxFromXpos(pos) {
		let v = scaleValueAtPos(pos, xScaleKey);
		return closestIdx(v, data[0], i0, i1);
	}

	self.idxAt = closestIdxFromXpos;
	self.valAt = (val, scale) => scaleValueAtPos(scale == xScaleKey ? val : canCssHeight - val, scale);
	self.posOf = (val, scale) => (scale == xScaleKey ? getXPos(val, scales[scale], canCssWidth) : getYPos(val, scales[scale], canCssHeight));

	let inBatch = false;
	let shouldPaint = false;
	let shouldSetScales = false;
	let shouldUpdatePointer = false;

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

	self.moveCursor = (left, top) => {
		cursor.left = left;
		cursor.top = top;
		updatePointer(true);
	};

	function updatePointer(pub) {
		if (inBatch) {
			shouldUpdatePointer = true;
			return;
		}

	//	console.log("updatePointer()");

		rafPending = false;

		if (cursor.show && cursor.cross) {
			trans(vt,cursor.left,0);
			trans(hz,0,cursor.top);
		}

		let idx;

		// if cursor hidden, hide points & clear legend vals
		if (cursor.left < 0) {
			idx = null;

			for (let i = 0; i < series.length; i++) {
				if (i > 0) {
					distsToCursor[i] = inf;
					trans(cursorPts[i], -10, -10);
				}

				if (legendOpts.show) {
					if (i == 0 && multiValLegend)
						continue;

					for (let j = 0; j < legendLabels[i].length; j++)
						legendLabels[i][j][firstChild].nodeValue = '--';
				}
			}
		}
		else {
		//	let pctY = 1 - (y / rect[HEIGHT]);

			idx = closestIdxFromXpos(cursor.left);

			let scX = scales[xScaleKey];

			let xPos = getXPos(data[0][idx], scX, canCssWidth);

			for (let i = 0; i < series.length; i++) {
				let s = series[i];

				if (i > 0 && s.show) {
					let yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

					if (yPos == null)
						yPos = -10;

					distsToCursor[i] = yPos > 0 ? abs(yPos - cursor.top) : inf;

					cursor.show && trans(cursorPts[i], xPos, yPos);
				}
				else
					distsToCursor[i] = inf;

				if (legendOpts.show) {
					if (i == 0 && multiValLegend)
						continue;

					let src = i == 0 && xScaleType == 2 ? data0 : data[i];

					let vals = multiValLegend ? s.values(idx) : {_: s.value(src[idx])};

					let j = 0;

					for (let k in vals)
						legendLabels[i][j++][firstChild].nodeValue = vals[k];
				}
			}

			if (dragging) {
				let minX = min(x0, cursor.left);
				let maxX = max(x0, cursor.left);

				setStylePx(zoom, LEFT, minX);
				setStylePx(zoom, WIDTH, maxX - minX);
			}
		}

		fire("cursormove", cursor.left, cursor.top, idx);

		if (pub !== false) {
			sync.pub(mousemove, self, cursor.left, cursor.top, canCssWidth, canCssHeight, idx);

			if (focus) {
				let minDist = min.apply(null, distsToCursor);

				let fi = null;

				if (minDist <= focus.prox) {
					distsToCursor.some((dist, i) => {
						if (dist == minDist)
							return fi = i;
					});
				}

				setFocus(fi, focus.alpha, syncOpts.focus);
			}
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
		if (cursor.locked)
			return;

		if (rect == null)
			syncRect();

		syncPos(e, src, _x, _y, _w, _h, _i, false);

		if (e != null) {
			if (!rafPending) {
				rafPending = true;
				rAF(updatePointer);
			}
		}
		else
			updatePointer(false);
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
			cursor.left = _x;
			cursor.top = _y;
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

	function mouseUp(e, src, _x, _y, _w, _h, _i) {
		if ((e == null || filtMouse(e))) {
			dragging = false;

			syncPos(e, src, _x, _y, _w, _h, _i, false);

			if (cursor.left != x0 || cursor.top != y0) {
				setStylePx(zoom, LEFT, 0);
				setStylePx(zoom, WIDTH, 0);

				let minX = min(x0, cursor.left);
				let maxX = max(x0, cursor.left);

				let fn = xScaleType == 2 ? closestIdxFromXpos : scaleValueAtPos;

				setScale(xScaleKey,
					fn(minX, xScaleKey),
					fn(maxX, xScaleKey),
				);
			}
			else {
				cursor.locked = !cursor.locked

				if (!cursor.locked)
					updatePointer();
			}

			if (e != null) {
				off(mouseup, doc, mouseUp);
				sync.pub(mouseup, self, cursor.left, cursor.top, canCssWidth, canCssHeight, null);
			}
		}
	}

	function dblClick(e, src, _x, _y, _w, _h, _i) {
		setScale(xScaleKey, data[0][0], data[0][dataLen - 1]);

		if (e != null)
			sync.pub(dblclick, self, cursor.left, cursor.top, canCssWidth, canCssHeight, null);
	}

	// internal pub/sub
	const events = {};

	events[mousedown] = mouseDown;
	events[mousemove] = mouseMove;
	events[mouseup] = mouseUp;
	events[dblclick] = dblClick;
	events["focus"] = (e, src, i) => {
		setFocus(i, focus.alpha);
	};
	events["toggle"] = (e, src, idxs, onOff) => {
		toggle(idxs, onOff);
	};

	if (cursor.show) {
		on(mousedown, can, mouseDown);
		on(mousemove, can, mouseMove);
		on(dblclick, can, dblClick);

		let deb = debounce(syncRect, 100);

		on(resize, win, deb);
		on(scroll, win, deb);
	}

	self.root = root;

	// external on/off
	const events2 = opts.events || {};

	const evArg0 = [self];

	function fire(evName) {
		if (evName in events2) {
			let args = evArg0.concat(Array.prototype.slice.call(arguments, 1));

			events2[evName].forEach(fn => {
				fn.apply(null, args);
			});
		}
	}

	self.on = (evName, fn) => {
		events2[evName] = new Set(events2[evName]);		// bit of waste but meh
		events2[evName].add(fn);
	};

	self.off = (evName, fn) => {
		events2[evName].delete(fn);
	};

	const syncOpts = assign({
		key: null,
		toggle: false,
		focus: false,
	}, cursor.sync);

	const syncKey = syncOpts.key;

	const sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

	sync.sub(self);

	function pub(type, src, x, y, w, h, i) {
		events[type](null, src, x, y, w, h, i);
	}

	self.pub = pub;

	let _i0 = 0,
		_i1 = data[0].length - 1;

	function destroy() {
		sync.unsub(self);
		off(resize, win, deb);
		off(scroll, win, deb);
		root.remove();
	}

	self.destroy = destroy;

	// this is wrapped in batch to prevent "cursormove" event from firing
	// ahead of init() in case there's setup there that expects to catch them
	batch(() => {
		setData(data,
			xScaleType == 2 ? _i0 : data[0][_i0],
			xScaleType == 2 ? _i1 : data[0][_i1],
		);

		plot.appendChild(can);

		opts.init && opts.init(self, opts, data);
	});
}