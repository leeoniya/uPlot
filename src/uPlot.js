import {
	copy,
	assign,
	PI,
	inf,
	abs,
	floor,
	round,
	roundDec,
	ceil,
	min,
	max,
	clamp,
	pow,
	log10,
	debounce,
	closestIdx,
	getMinMax,
	rangeNum,
	rangeLog,
	incrRoundUp,
	incrRoundDn,
	incrRound,
	isArr,
	isStr,
	fnOrSelf,
	fmtNum,
	fixedDec,

	retArg1,
	EMPTY_OBJ,
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

	mousemove,
	mousedown,
	mouseup,
	mouseleave,
	mouseenter,
	dblclick,
	resize,
	scroll,
} from './strings';

import {
	UPLOT,
	TITLE,
	WRAP,
	UNDER,
	OVER,
	OFF,
	SELECT,
	CURSOR_X,
	CURSOR_Y,
	CURSOR_PT,
	LEGEND,
	LEGEND_LIVE,
	LEGEND_INLINE,
	LEGEND_THEAD,
	LEGEND_SERIES,
	LEGEND_MARKER,
	LEGEND_LABEL,
	LEGEND_VALUE,
} from './domClasses';

import {
	rAF,
	doc,
	win,
	pxRatio,

	addClass,
	remClass,
	setStylePx,
	placeTag,
	placeDiv,
	trans,
	on,
	off,
} from './dom';

import {
	fmtDate,
	tzDate,
} from './fmtDate';

import {
	lineMult,
	ptDia,
	cursorOpts,
	seriesFillTo,

	xAxisOpts,
	yAxisOpts,
	xSeriesOpts,
	ySeriesOpts,
	xScaleOpts,
	yScaleOpts,

	timeIncrs,
	intIncrs,
	numIncrs,
	timeAxisVal,
	timeAxisVals,
	numAxisVals,

	logAxisValsFilt,

	timeSeriesVal,
	numSeriesVal,

	timeSeriesLabel,
	numSeriesLabel,

	timeAxisSplits,
	numAxisSplits,
	logAxisSplits,

	timeAxisStamps,
	_timeAxisStamps,

	timeSeriesStamp,
	_timeSeriesStamp,
} from './opts';

import {
	_sync,
	syncs,
} from './sync';

function log(name, args) {
	console.log.apply(console, [name].concat(Array.prototype.slice.call(args)));
}

function setDefaults(d, xo, yo, initY) {
	let d2 = initY ? [d[0], d[1]].concat(d.slice(2)) : [d[0]].concat(d.slice(1));
	return d2.map((o, i) => setDefault(o, i, xo, yo));
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
	let pctY = getValPct(val, scale);
	return top + (1 - pctY) * hgt;
}

function getXPos(val, scale, wid, lft) {
	let pctX = getValPct(val, scale);
	return lft + pctX * wid;
}

function snapTimeX(self, dataMin, dataMax) {
	return [dataMin, dataMax > dataMin ? dataMax : dataMax + 86400];
}

function snapNumX(self, dataMin, dataMax) {
	const delta = dataMax - dataMin;

	return delta == 0 ? rangeNum(dataMin, dataMax, 0, true) : [dataMin, dataMax];
}

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
function snapNumY(self, dataMin, dataMax) {
	return rangeNum(dataMin, dataMax, 0.1, true);
}

function snapLogY(self, dataMin, dataMax, scale) {
	return rangeLog(dataMin, dataMax, self.scales[scale].log, false);
}

const snapLogX = snapLogY;

// dim is logical (getClientBoundingRect) pixels, not canvas pixels
function findIncr(min, max, incrs, dim, minSpace) {
	let pxPerUnit = dim / (max - min);

	let minDec = (""+floor(min)).length;

	for (var i = 0; i < incrs.length; i++) {
		let space = incrs[i] * pxPerUnit;

		let incrDec = incrs[i] < 1 ? fixedDec.get(incrs[i]) : 0;

		if (space >= minSpace && minDec + incrDec < 17)
			return [incrs[i], space];
	}
}

function pxRatioFont(font) {
	let fontSize;
	font = font.replace(/\d+/, m => (fontSize = round(m * pxRatio)));
	return [font, fontSize];
}

export default function uPlot(opts, data, then) {
	const self = {};

	const root = self.root = placeDiv(UPLOT);

	if (opts.id != null)
		root.id = opts.id;

	addClass(root, opts.class);

	if (opts.title) {
		let title = placeDiv(TITLE, root);
		title.textContent = opts.title;
	}

	const can = placeTag("canvas");
	const ctx = self.ctx = can.getContext("2d");

	const wrap = placeDiv(WRAP, root);
	const under = placeDiv(UNDER, wrap);
	wrap.appendChild(can);
	const over = placeDiv(OVER, wrap);

	opts = copy(opts);

	(opts.plugins || []).forEach(p => {
		if (p.opts)
			opts = p.opts(self, opts) || opts;
	});

	let ready = false;

	const series  = self.series = setDefaults(opts.series || [], xSeriesOpts, ySeriesOpts, false);
	const axes    = self.axes   = setDefaults(opts.axes   || [], xAxisOpts,   yAxisOpts,    true);
	const scales  = self.scales = {};

	const xScaleKey = series[0].scale;

	function initScale(scaleKey) {
		let sc = scales[scaleKey];

		if (sc == null) {
			let scaleOpts = (opts.scales || EMPTY_OBJ)[scaleKey] || EMPTY_OBJ;

			if (scaleOpts.from != null) {
				// ensure parent is initialized
				initScale(scaleOpts.from);
				// dependent scales inherit
				scales[scaleKey] = assign({}, scales[scaleOpts.from], scaleOpts);
			}
			else {
				sc = scales[scaleKey] = assign({}, (scaleKey == xScaleKey ? xScaleOpts : yScaleOpts), scaleOpts);

				let isTime = FEAT_TIME && sc.time;
				let isLog  = sc.distr == 3;

				sc.range = fnOrSelf(sc.range || (isTime ? snapTimeX : scaleKey == xScaleKey ? (isLog ? snapLogX : snapNumX) : (isLog ? snapLogY : snapNumY)));
			}
		}
	}

	initScale("x");
	initScale("y");

	series.forEach((s, i) => {
		initScale(s.scale);
	});

	for (let k in opts.scales)
		initScale(k);

	const xScaleDistr = scales[xScaleKey].distr;

	const pendScales = {};

	// explicitly-set initial scales
	for (let k in scales) {
		let sc = scales[k];

		if (sc.min != null || sc.max != null)
			pendScales[k] = {min: sc.min, max: sc.max};
	}

	const gutters = assign({
		x: round(yAxisOpts.size / 2),
		y: round(xAxisOpts.size / 3),
	}, opts.gutters);

//	self.tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
	const _tzDate  = FEAT_TIME && (opts.tzDate || (ts => new Date(ts * 1e3)));
	const _fmtDate = FEAT_TIME && (opts.fmtDate || fmtDate);

	const _timeAxisSplits = FEAT_TIME && timeAxisSplits(_tzDate);
	const _timeAxisVals   = FEAT_TIME && timeAxisVals(_tzDate, timeAxisStamps(_timeAxisStamps, _fmtDate));
	const _timeSeriesVal  = FEAT_TIME && timeSeriesVal(_tzDate, timeSeriesStamp(_timeSeriesStamp, _fmtDate));

	const legend     = FEAT_LEGEND && assign({show: true, live: true}, opts.legend);
	const showLegend = FEAT_LEGEND && legend.show;

	let legendEl;
	let legendRows = [];
	let legendCols;
	let multiValLegend = false;

	if (showLegend) {
		legendEl = placeTag("table", LEGEND, root);

		const getMultiVals = series[1] ? series[1].values : null;
		multiValLegend = getMultiVals != null;

		if (multiValLegend) {
			let head = placeTag("tr", LEGEND_THEAD, legendEl);
			placeTag("th", null, head);
			legendCols = getMultiVals(self, 1, 0);

			for (var key in legendCols)
				placeTag("th", LEGEND_LABEL, head).textContent = key;
		}
		else {
			legendCols = {_: 0};
			addClass(legendEl, LEGEND_INLINE);
			legend.live && addClass(legendEl, LEGEND_LIVE);
		}
	}

	function initLegendRow(s, i) {
		if (i == 0 && (multiValLegend || !legend.live))
			return null;

		let _row = [];

		let row = placeTag("tr", LEGEND_SERIES, legendEl, legendEl.childNodes[i]);

		addClass(row, s.class);

		if (!s.show)
			addClass(row, OFF);

		let label = placeTag("th", null, row);

		let indic = placeDiv(LEGEND_MARKER, label);
		let borderColor = s.width ? s.stroke : i > 0 && s.points.width ? s.points.stroke : null;
		indic.style.borderColor = borderColor || hexBlack;
		indic.style.backgroundColor = s.fill || null;

		let text = placeDiv(LEGEND_LABEL, label);
		text.textContent = s.label;

		if (i > 0) {
			onMouse("click", label, e => {
				if (FEAT_CURSOR && cursor.locked)
					return;

				setSeries(series.indexOf(s), {show: !s.show}, FEAT_CURSOR && syncOpts.setSeries);
			});

			if (cursorFocus) {
				onMouse(mouseenter, label, e => {
					if (cursor.locked)
						return;

					setSeries(series.indexOf(s), {focus: true}, syncOpts.setSeries);
				});
			}
		}

		for (var key in legendCols) {
			let v = placeTag("td", LEGEND_VALUE, row);
			v.textContent = "--";
			_row.push(v);
		}

		return _row;
	}

	const mouseListeners = new Map();

	function onMouse(ev, targ, fn) {
		const targListeners = mouseListeners.get(targ) || {};
		const listener = cursor.bind[ev](self, targ, fn);

		if (listener) {
			on(ev, targ, targListeners[ev] = listener);
			mouseListeners.set(targ, targListeners);
		}
	}

	function offMouse(ev, targ, fn) {
		const targListeners = mouseListeners.get(targ) || {};
		off(ev, targ, targListeners[ev]);
		targListeners[ev] = null;
	}

	let fullWidCss = 0;
	let fullHgtCss = 0;

	let plotWidCss = 0;
	let plotHgtCss = 0;

	// plot margins to account for axes
	let plotLftCss = 0;
	let plotTopCss = 0;

	let plotLft = 0;
	let plotTop = 0;
	let plotWid = 0;
	let plotHgt = 0;

	self.bbox = {};

	function _setSize(width, height) {
		self.width  = fullWidCss = plotWidCss = width;
		self.height = fullHgtCss = plotHgtCss = height;
		plotLftCss  = plotTopCss = 0;

		calcPlotRect();
		calcAxesRects();

		let bb = self.bbox;

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

	function setSize({width, height}) {
		_setSize(width, height);
	}

	self.setSize = setSize;

	// accumulate axis offsets, reduce canvas width
	function calcPlotRect() {
		// easements for edge labels
		let hasTopAxis = false;
		let hasBtmAxis = false;
		let hasRgtAxis = false;
		let hasLftAxis = false;

		axes.forEach((axis, i) => {
			if (axis.show) {
				let {side, size} = axis;
				let isVt = side % 2;
				let labelSize = axis.labelSize = (axis.label != null ? (axis.labelSize || 30) : 0);

				let fullSize = size + labelSize;

				if (fullSize > 0) {
					if (isVt) {
						plotWidCss -= fullSize;

						if (side == 3) {
							plotLftCss += fullSize;
							hasLftAxis = true;
						}
						else
							hasRgtAxis = true;
					}
					else {
						plotHgtCss -= fullSize;

						if (side == 0) {
							plotTopCss += fullSize;
							hasTopAxis = true;
						}
						else
							hasBtmAxis = true;
					}
				}
			}
		});

		// hz gutters
		if (hasTopAxis || hasBtmAxis) {
			if (!hasRgtAxis)
				plotWidCss -= gutters.x;
			if (!hasLftAxis) {
				plotWidCss -= gutters.x;
				plotLftCss += gutters.x;
			}
		}

		// vt gutters
		if (hasLftAxis || hasRgtAxis) {
			if (!hasBtmAxis)
				plotHgtCss -= gutters.y;
			if (!hasTopAxis) {
				plotHgtCss -= gutters.y;
				plotTopCss += gutters.y;
			}
		}
	}

	function calcAxesRects() {
		// will accum +
		let off1 = plotLftCss + plotWidCss;
		let off2 = plotTopCss + plotHgtCss;
		// will accum -
		let off3 = plotLftCss;
		let off0 = plotTopCss;

		function incrOffset(side, size) {
			let ret;

			switch (side) {
				case 1: off1 += size; return off1 - size;
				case 2: off2 += size; return off2 - size;
				case 3: off3 -= size; return off3 + size;
				case 0: off0 -= size; return off0 + size;
			}
		}

		axes.forEach((axis, i) => {
			let side = axis.side;

			axis._pos = incrOffset(side, axis.size);

			if (axis.label != null)
				axis._lpos = incrOffset(side, axis.labelSize);
		});
	}

	const cursor = FEAT_CURSOR && (self.cursor = assign({}, cursorOpts, opts.cursor));

	FEAT_CURSOR && (cursor.points.show = fnOrSelf(cursor.points.show));

	const focus = self.focus = assign({}, opts.focus || {alpha: 0.3}, FEAT_CURSOR && cursor.focus);
	const cursorFocus = FEAT_CURSOR && focus.prox >= 0;

	// series-intersection markers
	let cursorPts = [null];

	function initCursorPt(s, si) {
		if (si > 0) {
			let pt = cursor.points.show(self, si);

			if (pt) {
				addClass(pt, CURSOR_PT);
				addClass(pt, s.class);
				trans(pt, -10, -10, plotWidCss, plotHgtCss);
				over.insertBefore(pt, cursorPts[si]);

				return pt;
			}
		}
	}

	function initSeries(s, i) {
		let isTime = FEAT_TIME && scales[s.scale].time;

		let sv = s.value;
		s.value = isTime ? (isStr(sv) ? timeSeriesVal(_tzDate, timeSeriesStamp(sv, _fmtDate)) : sv || _timeSeriesVal) : sv || numSeriesVal;
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);

		if (i > 0) {
			s.width = s.width == null ? 1 : s.width;
			s.paths = s.paths || (FEAT_PATHS && buildPaths);
			s.fillTo = s.fillTo || seriesFillTo;
			let _ptDia = ptDia(s.width, 1);
			s.points = assign({}, {
				size: _ptDia,
				width: max(1, _ptDia * .2),
				stroke: s.stroke,
				space: _ptDia * 2,
			}, s.points);
			s.points.show = fnOrSelf(s.points.show);
			s._paths = null;
		}

		if (showLegend)
			legendRows.splice(i, 0, initLegendRow(s, i));

		if (FEAT_CURSOR && cursor.show) {
			let pt = initCursorPt(s, i);
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
		FEAT_LEGEND && showLegend && legendRows.splice(i, 1)[0][0].parentNode.remove();
		FEAT_CURSOR && cursorPts.length > 1 && cursorPts.splice(i, 1)[0].remove();

		// TODO: de-init no-longer-needed scales?
	}

	self.delSeries = delSeries;

	series.forEach(initSeries);

	function initAxis(axis, i) {
		if (axis.show) {
			let isVt = axis.side % 2;

			let sc = scales[axis.scale];

			// this can occur if all series specify non-default scales
			if (sc == null) {
				axis.scale = isVt ? series[1].scale : xScaleKey;
				sc = scales[axis.scale];
			}

			// also set defaults for incrs & values based on axis distr
			let isTime = FEAT_TIME && sc.time;

			axis.space = fnOrSelf(axis.space);
			axis.rotate = fnOrSelf(axis.rotate);
			axis.incrs  = fnOrSelf(axis.incrs  || (          sc.distr == 2 ? intIncrs : (isTime ? timeIncrs : numIncrs)));
			axis.splits = fnOrSelf(axis.splits || (isTime && sc.distr == 1 ? _timeAxisSplits : sc.distr == 3 ? logAxisSplits : numAxisSplits));

			let av = axis.values;
			axis.values = (
				isTime ? (
					isArr(av) ?
						timeAxisVals(_tzDate, timeAxisStamps(av, _fmtDate)) :
					isStr(av) ?
						timeAxisVal(_tzDate, av) :
					av || _timeAxisVals
				) : av || numAxisVals
			);

			axis.filter = fnOrSelf(axis.filter || (          sc.distr == 3 ? logAxisValsFilt : retArg1));

			axis.font      = pxRatioFont(axis.font);
			axis.labelFont = pxRatioFont(axis.labelFont);
		}
	}

	// set axis defaults
	axes.forEach(initAxis);

	let dataLen;

	// rendered data window
	let i0 = null;
	let i1 = null;
	const idxs = series[0].idxs;

	let data0 = null;

	let forceUpdateLegend = false;

	function setData(_data, _resetScales) {
		_data = _data || [];
		_data[0] = _data[0] || [];

		self.data = _data;
		data = _data.slice();
		data0 = data[0];
		dataLen = data0.length;

		if (xScaleDistr == 2)
			data[0] = data0.map((v, i) => i);

		resetYSeries();

		fire("setData");

		forceUpdateLegend = true;

		if (_resetScales !== false) {
			let xsc = scales[xScaleKey];

			if (xsc.auto)
				autoScaleX();
			else
				_setScale(xScaleKey, xsc.min, xsc.max);
		}
	}

	self.setData = setData;

	function autoScaleX() {
		let _min, _max;

		if (dataLen > 0) {
			i0 = idxs[0] = 0;
			i1 = idxs[1] = dataLen - 1;

			_min = xScaleDistr == 2 ? i0 : data[0][i0];
			_max = xScaleDistr == 2 ? i1 : data[0][i1];
		}
		else {
			i0 = idxs[0] = _min = null;
			i1 = idxs[1] = _max = null;
		}

		_setScale(xScaleKey, _min, _max);
	}

	function setCtxStyle(stroke, width, dash, fill) {
		ctx.strokeStyle = stroke || hexBlack;
		ctx.lineWidth = width;
		ctx.lineJoin = "round";
		ctx.setLineDash(dash || []);
		ctx.fillStyle = fill || hexBlack;
	}

	function setScales() {
		if (inBatch) {
			shouldSetScales = true;
			return;
		}

	//	log("setScales()", arguments);

		// wip scales
		let wipScales = copy(scales);

		for (let k in wipScales) {
			let wsc = wipScales[k];
			let psc = pendScales[k];

			if (psc != null) {
				assign(wsc, psc);

				// explicitly setting the x-scale invalidates everything (acts as redraw)
				if (k == xScaleKey)
					resetYSeries();
			}
			else if (k != xScaleKey) {
				if (dataLen == 0 && wsc.from == null) {
					let minMax = wsc.range(self, null, null, k);
					wsc.min = minMax[0];
					wsc.max = minMax[1];
				}
				else {
					wsc.min = inf;
					wsc.max = -inf;
				}
			}
		}

		if (dataLen > 0) {
			// pre-range y-scales from y series' data values
			series.forEach((s, i) => {
				let k = s.scale;
				let wsc = wipScales[k];

				if (i == 0) {
					let minMax = wsc.range(self, wsc.min, wsc.max, k);

					wsc.min = minMax[0];
					wsc.max = minMax[1];

					i0 = closestIdx(wsc.min, data[0]);
					i1 = closestIdx(wsc.max, data[0]);

					// closest indices can be outside of view
					if (data[0][i0] < wsc.min)
						i0++;
					if (data[0][i1] > wsc.max)
						i1--;

					s.min = data0[i0];
					s.max = data0[i1];
				}
				else if (s.show && pendScales[k] == null) {
					// only run getMinMax() for invalidated series data, else reuse
					let minMax = s.min == inf ? (wsc.auto && s.auto ? getMinMax(data[i], i0, i1, s.sorted) : [null,null]) : [s.min, s.max];

					// initial min/max
					wsc.min = min(wsc.min, s.min = minMax[0]);
					wsc.max = max(wsc.max, s.max = minMax[1]);
				}

				s.idxs[0] = i0;
				s.idxs[1] = i1;
			});

			// range independent scales
			for (let k in wipScales) {
				let wsc = wipScales[k];

				if (wsc.from == null && wsc.min != inf && pendScales[k] == null) {
					let minMax = wsc.range(self, wsc.min, wsc.max, k);
					wsc.min = minMax[0];
					wsc.max = minMax[1];
				}
			}
		}

		// range dependent scales
		for (let k in wipScales) {
			let wsc = wipScales[k];

			if (wsc.from != null) {
				let base = wipScales[wsc.from];

				if (base.min != inf) {
					let minMax = wsc.range(self, base.min, base.max, k);
					wsc.min = minMax[0];
					wsc.max = minMax[1];
				}
			}
		}

		let changed = {};

		for (let k in wipScales) {
			let wsc = wipScales[k];
			let sc = scales[k];

			if (sc.min != wsc.min || sc.max != wsc.max) {
				sc.min = wsc.min;
				sc.max = wsc.max;
				changed[k] = true;
			}
		}

		// invalidate paths of all series on changed scales
		series.forEach(s => {
			if (changed[s.scale])
				s._paths = null;
		});

		for (let k in changed)
			fire("setScale", k);

		for (let k in pendScales)
			pendScales[k] = null;

		FEAT_CURSOR && cursor.show && updateCursor();
	}

	// TODO: drawWrap(si, drawPoints) (save, restore, translate, clip)

	function drawPoints(si) {
	//	log("drawPoints()", arguments);

		let s = series[si];
		let p = s.points;

		const width = roundDec(p.width * pxRatio, 3);
		const offset = (width % 2) / 2;
		const isStroked = p.width > 0;

		let rad = (p.size - p.width) / 2 * pxRatio;
		let dia = roundDec(rad * 2, 3);

		ctx.translate(offset, offset);

		ctx.save();

		ctx.beginPath();
		ctx.rect(
			plotLft - dia,
			plotTop - dia,
			plotWid + dia * 2,
			plotHgt + dia * 2,
		);
		ctx.clip();

		ctx.globalAlpha = s.alpha;

		const path = new Path2D();

		for (let pi = i0; pi <= i1; pi++) {
			if (data[si][pi] != null) {
				let x = round(getXPos(data[0][pi],  scales[xScaleKey], plotWid, plotLft));
				let y = round(getYPos(data[si][pi], scales[s.scale],   plotHgt, plotTop));

				path.moveTo(x + rad, y);
				path.arc(x, y, rad, 0, PI * 2);
			}
		}

		setCtxStyle(
			p.stroke || hexBlack,
			width,
			null,
			p.fill || (isStroked ? "#fff" : s.stroke || hexBlack),
		);

		ctx.fill(path);
		isStroked && ctx.stroke(path);

		ctx.globalAlpha = 1;

		ctx.restore();

		ctx.translate(-offset, -offset);
	}

	// grabs the nearest indices with y data outside of x-scale limits
	function getOuterIdxs(ydata) {
		let _i0 = clamp(i0 - 1, 0, dataLen - 1);
		let _i1 = clamp(i1 + 1, 0, dataLen - 1);

		while (ydata[_i0] == null && _i0 > 0)
			_i0--;

		while (ydata[_i1] == null && _i1 < dataLen - 1)
			_i1++;

		return [_i0, _i1];
	}

	let dir = 1;

	function drawSeries() {
		// path building loop must be before draw loop to ensure that all bands are fully constructed
		series.forEach((s, i) => {
			if (i > 0 && s.show && s._paths == null) {
				let _idxs = getOuterIdxs(data[i]);
				s._paths = s.paths(self, i, _idxs[0], _idxs[1]);
			}
		});

		series.forEach((s, i) => {
			if (i > 0 && s.show) {
				if (s._paths)
					FEAT_PATHS && drawPath(i);

				if (s.points.show(self, i, i0, i1))
					FEAT_POINTS && drawPoints(i);

				fire("drawSeries", i);
			}
		});
	}

	function drawPath(si) {
		const s = series[si];

		if (dir == 1) {
			const { stroke, fill, clip } = s._paths;
			const width = roundDec(s[WIDTH] * pxRatio, 3);
			const offset = (width % 2) / 2;

			setCtxStyle(s.stroke, width, s.dash, s.fill);

			ctx.globalAlpha = s.alpha;

			ctx.translate(offset, offset);

			ctx.save();

			let lft = plotLft,
				top = plotTop,
				wid = plotWid,
				hgt = plotHgt;

			let halfWid = width * pxRatio / 2;

			if (s.min == 0)
				hgt += halfWid;

			if (s.max == 0) {
				top -= halfWid;
				hgt += halfWid;
			}

			ctx.beginPath();
			ctx.rect(lft, top, wid, hgt);
			ctx.clip();

			if (clip != null)
				ctx.clip(clip);

			if (s.band) {
				ctx.fill(stroke);
				width && ctx.stroke(stroke);
			}
			else {
				width && ctx.stroke(stroke);

				if (s.fill != null)
					ctx.fill(fill);
			}

			ctx.restore();

			ctx.translate(-offset, -offset);

			ctx.globalAlpha = 1;
		}

		if (s.band)
			dir *= -1;
	}

	function buildClip(is, gaps, nullHead, nullTail) {
		let s = series[is];

		let clip = null;

		// create clip path (invert gaps and non-gaps)
		if (gaps.length > 0) {
			if (s.spanGaps) {
				let headGap = gaps[0];
				let tailGap = gaps[gaps.length - 1];
				gaps = [];

				if (nullHead)
					gaps.push(headGap);
				if (nullTail)
					gaps.push(tailGap);
			}

			clip = new Path2D();

			let prevGapEnd = plotLft;

			for (let i = 0; i < gaps.length; i++) {
				let g = gaps[i];

				clip.rect(prevGapEnd, plotTop, g[0] - prevGapEnd, plotTop + plotHgt);

				prevGapEnd = g[1];
			}

			clip.rect(prevGapEnd, plotTop, plotLft + plotWid - prevGapEnd, plotTop + plotHgt);
		}

		return clip;
	}

	function addGap(gaps, outX, x) {
		let prevGap = gaps[gaps.length - 1];

		if (prevGap && prevGap[0] == outX)			// TODO: gaps must be encoded at stroke widths?
			prevGap[1] = x;
		else
			gaps.push([outX, x]);
	}

	function buildPaths(self, is, _i0, _i1) {
		const s = series[is];

		const xdata  = data[0];
		const ydata  = data[is];
		const scaleX = scales[xScaleKey];
		const scaleY = scales[s.scale];

		const _paths = dir == 1 ? {stroke: new Path2D(), fill: null, clip: null} : series[is-1]._paths;
		const stroke = _paths.stroke;
		const width = roundDec(s[WIDTH] * pxRatio, 3);

		let minY = inf,
			maxY = -inf,
			outY, outX;

		// todo: don't build gaps on dir = -1 pass
		let gaps = [];

		let accX = round(getXPos(xdata[dir == 1 ? _i0 : _i1], scaleX, plotWid, plotLft));

		// the moves the shape edge outside the canvas so stroke doesnt bleed in
		if (s.band && dir == 1 && _i0 == i0) {
			if (width)
				stroke.lineTo(-width, round(getYPos(ydata[_i0], scaleY, plotHgt, plotTop)));

			if (scaleX.min < xdata[0])
				gaps.push([plotLft, accX - 1]);
		}

		for (let i = dir == 1 ? _i0 : _i1; i >= _i0 && i <= _i1; i += dir) {
			let x = round(getXPos(xdata[i], scaleX, plotWid, plotLft));

			if (x == accX) {
				if (ydata[i] != null) {
					outY = round(getYPos(ydata[i], scaleY, plotHgt, plotTop));
					minY = min(outY, minY);
					maxY = max(outY, maxY);
				}
			}
			else {
				let _addGap = false;

				if (minY != inf) {
					stroke.lineTo(accX, minY);
					stroke.lineTo(accX, maxY);
					stroke.lineTo(accX, outY);
					outX = accX;
				}
				else
					_addGap = true;

				if (ydata[i] != null) {
					outY = round(getYPos(ydata[i], scaleY, plotHgt, plotTop));
					stroke.lineTo(x, outY);
					minY = maxY = outY;

					// prior pixel can have data but still start a gap if ends with null
					if (x - accX > 1 && ydata[i-1] == null)
						_addGap = true;
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
			addGap(gaps, outX, accX);

		if (s.band) {
			let overShoot = width * 100, _iy, _x;

			// the moves the shape edge outside the canvas so stroke doesnt bleed in
			if (dir == -1 && _i0 == i0) {
				_x = plotLft - overShoot;
				_iy = _i0;
			}

			if (dir == 1 && _i1 == i1) {
				_x = plotLft + plotWid + overShoot;
				_iy = _i1;

				if (scaleX.max > xdata[dataLen - 1])
					gaps.push([accX, plotLft + plotWid]);
			}

			stroke.lineTo(_x, round(getYPos(ydata[_iy], scaleY, plotHgt, plotTop)));
		}

		if (dir == 1) {
			_paths.clip = buildClip(is, gaps, ydata[_i0] == null, ydata[_i1] == null);

			if (s.fill != null) {
				let fill = _paths.fill = new Path2D(stroke);

				let fillTo = round(getYPos(s.fillTo(self, is, s.min, s.max), scaleY, plotHgt, plotTop));
				fill.lineTo(plotLft + plotWid, fillTo);
				fill.lineTo(plotLft, fillTo);
			}
		}

		if (s.band)
			dir *= -1;

		return _paths;
	}

	self.paths = buildPaths;

	function getIncrSpace(axisIdx, min, max, fullDim) {
		let axis = axes[axisIdx];

		let incrSpace;

		if (fullDim <= 0)
			incrSpace = [0, 0];
		else {
			let minSpace = axis.space(self, axisIdx, min, max, fullDim);
			let incrs = axis.incrs(self, axisIdx, min, max, fullDim, minSpace);
			incrSpace = findIncr(min, max, incrs, fullDim, minSpace);
		}

		return incrSpace;
	}

	function drawOrthoLines(offs, filts, ori, side, pos0, len, width, stroke, dash) {
		let offset = (width % 2) / 2;

		ctx.translate(offset, offset);

		setCtxStyle(stroke, width, dash);

		ctx.beginPath();

		let x0, y0, x1, y1, pos1 = pos0 + (side == 0 || side == 3 ? -len : len);

		if (ori == 0) {
			y0 = pos0;
			y1 = pos1;
		}
		else {
			x0 = pos0;
			x1 = pos1;
		}

		offs.forEach((off, i) => {
			if (filts[i] == null)
				return;

			if (ori == 0)
				x0 = x1 = off;
			else
				y0 = y1 = off;

			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
		});

		ctx.stroke();

		ctx.translate(-offset, -offset);
	}

	function drawAxesGrid() {
		axes.forEach((axis, i) => {
			if (!axis.show)
				return;

			let scale = scales[axis.scale];

			// this will happen if all series using a specific scale are toggled off
			if (scale.min == inf)
				return;

			let side = axis.side;
			let ori = side % 2;

			let {min, max} = scale;

			let [incr, space] = getIncrSpace(i, min, max, ori == 0 ? plotWidCss : plotHgtCss);

			// if we're using index positions, force first tick to match passed index
			let forceMin = scale.distr == 2;

			let splits = axis.splits(self, i, min, max, incr, space, forceMin);

			let getPos  = ori == 0 ? getXPos : getYPos;
			let plotDim = ori == 0 ? plotWid : plotHgt;
			let plotOff = ori == 0 ? plotLft : plotTop;

			let canOffs = splits.map(val => round(getPos(val, scale, plotDim, plotOff)));

			let axisGap  = round(axis.gap * pxRatio);

			let ticks = axis.ticks;
			let tickSize = ticks.show ? round(ticks.size * pxRatio) : 0;

			// tick labels
			// BOO this assumes a specific data/series
			let _splits = scale.distr == 2 ? splits.map(i => data0[i]) : splits;
			let _incr   = scale.distr == 2 ? data0[splits[1]] - data0[splits[0]] : incr;

			let values = axis.values(self, axis.filter(self, _splits, i, space, _incr), i, space, _incr);

			// rotating of labels only supported on bottom x axis
			let angle = side == 2 ? axis.rotate(self, values, i, space) * -PI/180 : 0;

			let basePos  = round(axis._pos * pxRatio);
			let shiftAmt = tickSize + axisGap;
			let shiftDir = ori == 0 && side == 0 || ori == 1 && side == 3 ? -1 : 1;
			let finalPos = basePos + shiftAmt * shiftDir;
			let y        = ori == 0 ? finalPos : 0;
			let x        = ori == 1 ? finalPos : 0;

			ctx.font         = axis.font[0];
			ctx.fillStyle    = axis.stroke || hexBlack;									// rgba?
			ctx.textAlign    = angle > 0 ? LEFT :
			                   angle < 0 ? RIGHT :
			                   ori == 0 ? "center" : side == 3 ? RIGHT : LEFT;
			ctx.textBaseline = angle ||
			                   ori == 1 ? "middle" : side == 2 ? TOP   : BOTTOM;

			let lineHeight   = axis.font[1] * lineMult;

			values.forEach((val, i) => {
				if (val == null)
					return;

				if (ori == 0)
					x = canOffs[i];
				else
					y = canOffs[i];

				(""+val).split(/\n/gm).forEach((text, j) => {
					if (angle) {
						ctx.save();
						ctx.translate(x, y + j * lineHeight);
						ctx.rotate(angle);
						ctx.fillText(text, 0, 0);
						ctx.restore();
					}
					else
						ctx.fillText(text, x, y + j * lineHeight);
				});
			});

			// axis label
			if (axis.label) {
				ctx.save();

				let baseLpos = round(axis._lpos * pxRatio);

				if (ori == 1) {
					x = y = 0;

					ctx.translate(
						baseLpos,
						round(plotTop + plotHgt / 2),
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
					ticks.filter(self, _splits, i, space, _incr),
					ori,
					side,
					basePos,
					tickSize,
					roundDec(ticks[WIDTH] * pxRatio, 3),
					ticks.stroke,
				);
			}

			// grid
			let grid = axis.grid;

			if (grid.show) {
				drawOrthoLines(
					canOffs,
					grid.filter(self, _splits, i, space, _incr),
					ori,
					ori == 0 ? 2 : 1,
					ori == 0 ? plotTop : plotLft,
					ori == 0 ? plotHgt : plotWid,
					roundDec(grid[WIDTH] * pxRatio, 3),
					grid.stroke,
					grid.dash,
				);
			}
		});

		fire("drawAxes");
	}

	function resetYSeries() {
	//	log("resetYSeries()", arguments);

		series.forEach((s, i) => {
			if (i > 0) {
				s.min = inf;
				s.max = -inf;
				s._paths = null;
			}
		});
	}

	let didPaint;

	function paint() {
		if (inBatch) {
			shouldPaint = true;
			return;
		}

	//	log("paint()", arguments);

		ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
		fire("drawClear");
		drawAxesGrid();
		dataLen > 0 && drawSeries();
		didPaint = true;
		fire("draw");
	}

	self.redraw = rebuildPaths => {
		if (rebuildPaths !== false)
			_setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);
		else
			paint();
	};

	// redraw() => setScale('x', scales.x.min, scales.x.max);

	// explicit, never re-ranged (is this actually true? for x and y)
	function setScale(key, opts) {
		let sc = scales[key];

		if (sc.from == null) {
			if (dataLen == 0) {
				let minMax = sc.range(self, opts.min, opts.max, key);
				opts.min = minMax[0];
				opts.max = minMax[1];
			}

			if (dataLen > 1 && opts.max - opts.min < 1e-16)
				return;

			if (key == xScaleKey) {
				if (sc.distr == 2 && dataLen > 0) {
					opts.min = closestIdx(opts.min, data[0]);
					opts.max = closestIdx(opts.max, data[0]);
				}
			}

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

	let vt;
	let hz;

	// starting position before cursor.move
	let rawMouseLeft0;
	let rawMouseTop0;

	// starting position
	let mouseLeft0;
	let mouseTop0;

	// current position before cursor.move
	let rawMouseLeft1;
	let rawMouseTop1;

	// current position
	let mouseLeft1;
	let mouseTop1;

	let dragging = false;

	const drag = FEAT_CURSOR && cursor.drag;

	let dragX = FEAT_CURSOR && drag.x;
	let dragY = FEAT_CURSOR && drag.y;

	if (FEAT_CURSOR && cursor.show) {
		if (cursor.x) {
			mouseLeft1 = cursor.left;
			vt = placeDiv(CURSOR_X, over);
		}

		if (cursor.y) {
			mouseTop1 = cursor.top;
			hz = placeDiv(CURSOR_Y, over);
		}
	}

	const select = self.select = assign({
		show:   true,
		over:   true,
		left:	0,
		width:	0,
		top:	0,
		height:	0,
	}, opts.select);

	const selectDiv = select.show ? placeDiv(SELECT, select.over ? over : under) : null;

	function setSelect(opts, _fire) {
		if (select.show) {
			for (let prop in opts)
				setStylePx(selectDiv, prop, select[prop] = opts[prop]);

			_fire !== false && fire("setSelect");
		}
	}

	self.setSelect = setSelect;

	function toggleDOM(i, onOff) {
		let s = series[i];
		let label = showLegend ? legendRows[i][0].parentNode : null;

		if (s.show)
			label && remClass(label, OFF);
		else {
			label && addClass(label, OFF);
			FEAT_CURSOR && cursorPts.length > 1 && trans(cursorPts[i], -10, -10, plotWidCss, plotHgtCss);
		}
	}

	function _setScale(key, min, max) {
		setScale(key, {min, max});
	}

	function setSeries(i, opts, pub) {
	//	log("setSeries()", arguments);

		let s = series[i];

	//	batch(() => {
			// will this cause redundant paint() if both show and focus are set?
			if (opts.focus != null)
				setFocus(i);

			if (opts.show != null) {
				s.show = opts.show;
				FEAT_LEGEND && toggleDOM(i, opts.show);

				if (s.band) {
					// not super robust, will break if two bands are adjacent
					let ip = series[i+1] && series[i+1].band ? i+1 : i-1;
					series[ip].show = s.show;
					FEAT_LEGEND && toggleDOM(ip, opts.show);
				}

				_setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);		// redraw
			}
	//	});

		// firing setSeries after setScale seems out of order, but provides access to the updated props
		// could improve by predefining firing order and building a queue
		fire("setSeries", i, opts);

		FEAT_CURSOR && pub && sync.pub("setSeries", self, i, opts);
	}

	self.setSeries = setSeries;

	function _alpha(i, value) {
		series[i].alpha = value;

		if (FEAT_CURSOR && cursor.show && cursorPts[i])
			cursorPts[i].style.opacity = value;

		if (FEAT_LEGEND && showLegend && legendRows[i])
			legendRows[i][0].parentNode.style.opacity = value;
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
	let closestDist;
	let closestSeries;
	let focusedSeries;

	function setFocus(i) {
		if (i != focusedSeries) {
		//	log("setFocus()", arguments);

			series.forEach((s, i2) => {
				_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : focus.alpha);
			});

			focusedSeries = i;
			paint();
		}
	}

	if (showLegend && cursorFocus) {
		on(mouseleave, legendEl, e => {
			if (cursor.locked)
				return;
			setSeries(null, {focus: false}, syncOpts.setSeries);
			updateCursor();
		});
	}

	function scaleValueAtPos(pos, scale) {
		let dim = plotWidCss;

		if (scale != xScaleKey) {
			dim = plotHgtCss;
			pos = dim - pos;
		}

		let pct = pos / dim;

		let sc = scales[scale],
			_min = sc.min,
			_max = sc.max;

		if (sc.distr == 3) {
			_min = log10(_min);
			_max = log10(_max);
			return pow(10, _min + (_max - _min) * pct);
		}
		else
			return _min + (_max - _min) * pct;
	}

	function closestIdxFromXpos(pos) {
		let v = scaleValueAtPos(pos, xScaleKey);
		return closestIdx(v, data[0], i0, i1);
	}

	self.valToIdx = val => closestIdx(val, data[0]);
	self.posToIdx = closestIdxFromXpos;
	self.posToVal = scaleValueAtPos;
	self.valToPos = (val, scale, can) => (
		scale == xScaleKey ?
		getXPos(val, scales[scale],
			can ? plotWid : plotWidCss,
			can ? plotLft : 0,
		) :
		getYPos(val, scales[scale],
			can ? plotHgt : plotHgtCss,
			can ? plotTop : 0,
		)
	);

	let inBatch = false;
	let shouldPaint = false;
	let shouldSetScales = false;
	let shouldUpdateCursor = false;

	// defers calling expensive functions
	function batch(fn) {
		inBatch = true;
		fn(self);
		inBatch = false;
		shouldSetScales && setScales();
		FEAT_CURSOR && shouldUpdateCursor && updateCursor();
		shouldPaint && !didPaint && paint();
		shouldSetScales = shouldUpdateCursor = shouldPaint = didPaint = inBatch;
	}

	self.batch = batch;

	FEAT_CURSOR && (self.setCursor = opts => {
		mouseLeft1 = opts.left;
		mouseTop1 = opts.top;
	//	assign(cursor, opts);
		updateCursor();
	});

	let cursorRaf = 0;

	function updateCursor(ts, src) {
		if (inBatch) {
			shouldUpdateCursor = true;
			return;
		}

	//	ts == null && log("updateCursor()", arguments);

		cursorRaf = 0;

		rawMouseLeft1 = mouseLeft1;
		rawMouseTop1 = mouseTop1;

		[mouseLeft1, mouseTop1] = cursor.move(self, mouseLeft1, mouseTop1);

		if (cursor.show) {
			cursor.x && trans(vt, round(mouseLeft1), 0, plotWidCss, plotHgtCss);
			cursor.y && trans(hz, 0, round(mouseTop1), plotWidCss, plotHgtCss);
		}

		let idx;

		// when zooming to an x scale range between datapoints the binary search
		// for nearest min/max indices results in this condition. cheap hack :D
		let noDataInRange = i0 > i1;

		closestDist = inf;

		// if cursor hidden, hide points & clear legend vals
		if (mouseLeft1 < 0 || dataLen == 0 || noDataInRange) {
			idx = null;

			for (let i = 0; i < series.length; i++) {
				if (i > 0) {
					FEAT_CURSOR && cursorPts.length > 1 && trans(cursorPts[i], -10, -10, plotWidCss, plotHgtCss);
				}

				if (showLegend && legend.live) {
					if (i == 0 && multiValLegend)
						continue;

					for (let j = 0; j < legendRows[i].length; j++)
						legendRows[i][j][firstChild].nodeValue = '--';
				}
			}

			if (cursorFocus)
				setSeries(null, {focus: true}, syncOpts.setSeries);
		}
		else {
		//	let pctY = 1 - (y / rect[HEIGHT]);

			let valAtPos = scaleValueAtPos(mouseLeft1, xScaleKey);

			idx = closestIdx(valAtPos, data[0], i0, i1);

			let scX = scales[xScaleKey];

			let xPos = roundDec(getXPos(data[0][idx], scX, plotWidCss, 0), 3);

			for (let i = 0; i < series.length; i++) {
				let s = series[i];

				let idx2  = cursor.dataIdx(self, i, idx, valAtPos);
				let xPos2 = idx2 == idx ? xPos : roundDec(getXPos(data[0][idx2], scX, plotWidCss, 0), 3);

				if (i > 0 && s.show) {
					let valAtIdx = data[i][idx2];

					let yPos = valAtIdx == null ? -10 : roundDec(getYPos(valAtIdx, scales[s.scale], plotHgtCss, 0), 3);

					if (yPos > 0) {
						let dist = abs(yPos - mouseTop1);

						if (dist <= closestDist) {
							closestDist = dist;
							closestSeries = i;
						}
					}

					FEAT_CURSOR && cursorPts.length > 1 && trans(cursorPts[i], xPos2, yPos, plotWidCss, plotHgtCss);
				}

				if (showLegend && legend.live) {
					if ((idx2 == cursor.idx && !forceUpdateLegend) || i == 0 && multiValLegend)
						continue;

					let src = i == 0 && xScaleDistr == 2 ? data0 : data[i];

					let vals = multiValLegend ? s.values(self, i, idx2) : {_: s.value(self, src[idx2], i, idx2)};

					let j = 0;

					for (let k in vals)
						legendRows[i][j++][firstChild].nodeValue = vals[k];
				}
			}

			forceUpdateLegend = false;
		}

		// nit: cursor.drag.setSelect is assumed always true
		if (select.show && dragging) {
			if (src != null) {
				let [xKey, yKey] = syncOpts.scales;

				// match the dragX/dragY implicitness/explicitness of src
				let sdrag = src.cursor.drag;
				dragX = sdrag._x;
				dragY = sdrag._y;

				if (xKey) {
					let sc = scales[xKey];
					let srcLeft = src.posToVal(src.select[LEFT], xKey);
					let srcRight = src.posToVal(src.select[LEFT] + src.select[WIDTH], xKey);

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
					let sc = scales[yKey];
					let srcTop = src.posToVal(src.select[TOP], yKey);
					let srcBottom = src.posToVal(src.select[TOP] + src.select[HEIGHT], yKey);

					select[TOP] = getYPos(srcTop, sc, plotHgtCss, 0);
					select[HEIGHT] = abs(select[TOP] - getYPos(srcBottom, sc, plotHgtCss, 0));

					setStylePx(selectDiv, TOP, select[TOP]);
					setStylePx(selectDiv, HEIGHT, select[HEIGHT]);

					if (!xKey) {
						setStylePx(selectDiv, LEFT, select[LEFT] = 0);
						setStylePx(selectDiv, WIDTH, select[WIDTH] = plotWidCss);
					}
				}
			}
			else {
				let rawDX = abs(rawMouseLeft1 - rawMouseLeft0);
				let rawDY = abs(rawMouseTop1 - rawMouseTop0);

				dragX = drag.x && rawDX >= drag.dist;
				dragY = drag.y && rawDY >= drag.dist;

				let uni = drag.uni;

				if (uni != null) {
					// only calc drag status if they pass the dist thresh
					if (dragX && dragY) {
						dragX = rawDX >= uni;
						dragY = rawDY >= uni;

						// force unidirectionality when both are under uni limit
						if (!dragX && !dragY) {
							if (rawDY > rawDX)
								dragY = true;
							else
								dragX = true;
						}
					}
				}
				else if (drag.x && drag.y && (dragX || dragY))
					// if omni with no uni then both dragX / dragY should be true if either is true
					dragX = dragY = true;

				if (dragX) {
					let minX = min(mouseLeft0, mouseLeft1);
					let dx = abs(mouseLeft1 - mouseLeft0);

					setStylePx(selectDiv, LEFT,  select[LEFT] = minX);
					setStylePx(selectDiv, WIDTH, select[WIDTH] = dx);

					if (!dragY) {
						setStylePx(selectDiv, TOP, select[TOP] = 0);
						setStylePx(selectDiv, HEIGHT, select[HEIGHT] = plotHgtCss);
					}
				}

				if (dragY) {
					let minY = min(mouseTop0, mouseTop1);
					let dy = abs(mouseTop1 - mouseTop0);

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

	let rect = null;

	function syncRect() {
		rect = over.getBoundingClientRect();
	}

	function mouseMove(e, src, _x, _y, _w, _h, _i) {
		if (cursor.locked)
			return;

		cacheMouse(e, src, _x, _y, _w, _h, _i, false, e != null);

		if (e != null) {
			if (cursorRaf == 0)
				cursorRaf = rAF(updateCursor);
		}
		else
			updateCursor(null, src);
	}

	function cacheMouse(e, src, _x, _y, _w, _h, _i, initial, snap) {
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

			let [xKey, yKey] = syncOpts.scales;

			if (xKey != null)
				_x = getXPos(src.posToVal(_x, xKey), scales[xKey], plotWidCss, 0);
			else
				_x = plotWidCss * (_x/_w);

			if (yKey != null)
				_y = getYPos(src.posToVal(_y, yKey), scales[yKey], plotHgtCss, 0);
			else
				_y = plotHgtCss * (_y/_h);
		}

		if (snap) {
			if (_x <= 1 || _x >= plotWidCss - 1)
				_x = incrRound(_x, plotWidCss);

			if (_y <= 1 || _y >= plotHgtCss - 1)
				_y = incrRound(_y, plotHgtCss);
		}

		if (initial) {
			rawMouseLeft0 = _x;
			rawMouseTop0 = _y;

			[mouseLeft0, mouseTop0] = cursor.move(self, _x, _y);
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
		dragging = true;
		dragX = dragY = drag._x = drag._y = false;

		cacheMouse(e, src, _x, _y, _w, _h, _i, true, false);

		if (e != null) {
			onMouse(mouseup, doc, mouseUp);
			sync.pub(mousedown, self, mouseLeft0, mouseTop0, plotWidCss, plotHgtCss, null);
		}
	}

	function mouseUp(e, src, _x, _y, _w, _h, _i) {
		dragging = drag._x = drag._y = false;

		cacheMouse(e, src, _x, _y, _w, _h, _i, false, true);

		let hasSelect = select[WIDTH] > 0 || select[HEIGHT] > 0;

		hasSelect && setSelect(select);

		if (drag.setScale && hasSelect) {
		//	if (syncKey != null) {
		//		dragX = drag.x;
		//		dragY = drag.y;
		//	}

			batch(() => {
				if (dragX) {
					_setScale(xScaleKey,
						scaleValueAtPos(select[LEFT], xScaleKey),
						scaleValueAtPos(select[LEFT] + select[WIDTH], xScaleKey)
					);
				}

				if (dragY) {
					for (let k in scales) {
						let sc = scales[k];

						if (k != xScaleKey && sc.from == null && sc.min != inf) {
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
				updateCursor();
		}

		if (e != null) {
			offMouse(mouseup, doc, mouseUp);
			sync.pub(mouseup, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
		}
	}

	function mouseLeave(e, src, _x, _y, _w, _h, _i) {
		if (!cursor.locked) {
			let _dragging = dragging;

			if (dragging) {
				// handle case when mousemove aren't fired all the way to edges by browser
				let snapX = true;
				let snapY = true;
				let snapProx = 10;

				if (dragX && dragY) {
					// maybe omni corner snap
					snapX = mouseLeft1 <= snapProx || mouseLeft1 >= plotWidCss - snapProx;
					snapY = mouseTop1  <= snapProx || mouseTop1  >= plotHgtCss - snapProx;
				}

				if (dragX && snapX) {
					let dLft = mouseLeft1;
					let dRgt = plotWidCss - mouseLeft1;

					let xMin = min(dLft, dRgt);

					if (xMin == dLft)
						mouseLeft1 = 0;
					if (xMin == dRgt)
						mouseLeft1 = plotWidCss;
				}

				if (dragY && snapY) {
					let dTop = mouseTop1;
					let dBtm = plotHgtCss - mouseTop1;

					let yMin = min(dTop, dBtm);

					if (yMin == dTop)
						mouseTop1 = 0;
					if (yMin == dBtm)
						mouseTop1 = plotHgtCss;
				}

				updateCursor(1);

				dragging = false;
			}

			mouseLeft1 = -10;
			mouseTop1 = -10;

			// passing a non-null timestamp to force sync/mousemove event
			updateCursor(1);

			if (_dragging)
				dragging = _dragging;
		}
	}

	function dblClick(e, src, _x, _y, _w, _h, _i) {
		autoScaleX();

		hideSelect();

		if (e != null)
			sync.pub(dblclick, self, mouseLeft1, mouseTop1, plotWidCss, plotHgtCss, null);
	}

	// internal pub/sub
	const events = {};

	events[mousedown] = mouseDown;
	events[mousemove] = mouseMove;
	events[mouseup] = mouseUp;
	events[dblclick] = dblClick;
	events["setSeries"] = (e, src, idx, opts) => {
		setSeries(idx, opts);
	};

	let deb;

	if (FEAT_CURSOR && cursor.show) {
		onMouse(mousedown, over, mouseDown);
		onMouse(mousemove, over, mouseMove);
		onMouse(mouseenter, over, syncRect);
		// this has to be rAF'd so it always fires after the last queued/rAF'd updateCursor
		onMouse(mouseleave, over, e => { rAF(mouseLeave); });

		onMouse(dblclick, over, dblClick);

		deb = debounce(syncRect, 100);

		on(resize, win, deb);
		on(scroll, win, deb);

		self.syncRect = syncRect;
	}

	// external on/off
	const hooks = self.hooks = opts.hooks || {};

	function fire(evName, a1, a2) {
		if (evName in hooks) {
			hooks[evName].forEach(fn => {
				fn.call(null, self, a1, a2);
			});
		}
	}

	(opts.plugins || []).forEach(p => {
		for (let evName in p.hooks)
			hooks[evName] = (hooks[evName] || []).concat(p.hooks[evName]);
	});

	const syncOpts = FEAT_CURSOR && assign({
		key: null,
		setSeries: false,
		scales: [xScaleKey, null]
	}, cursor.sync);

	const syncKey = FEAT_CURSOR && syncOpts.key;

	const sync = FEAT_CURSOR && (syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync());

	FEAT_CURSOR && sync.sub(self);

	function pub(type, src, x, y, w, h, i) {
		events[type](null, src, x, y, w, h, i);
	}

	FEAT_CURSOR && (self.pub = pub);

	function destroy() {
		FEAT_CURSOR && sync.unsub(self);
		FEAT_CURSOR && off(resize, win, deb);
		FEAT_CURSOR && off(scroll, win, deb);
		root.remove();
		fire("destroy");
	}

	self.destroy = destroy;

	function _init() {
		_setSize(opts[WIDTH], opts[HEIGHT]);

		fire("init", opts, data);

		setData(data || opts.data, false);

		if (pendScales[xScaleKey])
			setScale(xScaleKey, pendScales[xScaleKey]);
		else
			autoScaleX();

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
			then(self, _init);
	}
	else
		_init();

	return self;
}

uPlot.assign = assign;
uPlot.fmtNum = fmtNum;
uPlot.rangeNum = rangeNum;
uPlot.rangeLog = rangeLog;

if (FEAT_TIME) {
	uPlot.fmtDate = fmtDate;
	uPlot.tzDate  = tzDate;
}
