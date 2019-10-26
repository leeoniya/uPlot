import {
	fmtDate,
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

	assign,

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
} from './opts';

let syncs = {};

function _sync(opts) {
	let clients = [];

	return {
		sub(client) {
			clients.push(client);
		},
		pub(type, self, x, y, w, h, i) {
			if (clients.length > 1) {
				clients.forEach(client => {
					client != self && client.pub(type, self, x, y, w, h, i);
				});
			}
		}
	};
}

export default function uPlot(opts, data) {
	function setDefaults(d, xo, yo) {
		return [d.x].concat(d.y).map((o, i) => assign({}, (i == 0 ? xo : yo), o));
	}

	const series = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
	const axes = setDefaults(opts.axes || {}, xAxisOpts, yAxisOpts);
	const scales = (opts.scales = opts.scales || {});

	const legend = assign({}, {show: true}, opts.legend);

	// set default value
	series.forEach((s, i) => {
		// init scales & defaults
		const key = s.scale;

		if (!(key in scales)) {
			scales[key] = {
				auto: true,
				min:  inf,
				max: -inf,
			};
		}

		const sc = scales[key];

		sc.type = sc.type || (i == 0 ? "t" : "n");

		// by default, numeric y scales snap to half magnitude of range
		sc.range = fnOrSelf(sc.range || (i > 0 && sc.type == "n" ? snapHalfMag : snapNone));

		s.type = s.type || sc.type;

		let isTime = s.type == "t";

		s.value = s.value || (isTime ? timeSeriesVal : numSeriesVal);
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	const cursor = assign({}, {show: true}, opts.cursor);

	let dataLen;

	// rendered data window
	let i0;
	let i1;

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
		}
		else {
			let h = axis[HEIGHT] + lab;
			canCssHeight -= h;

			if (side == 2)
				plotTop += h;
		}

		axis.type = axis.type || scales[axis.scale].type;

		// also set defaults for incrs & values based on axis type
		let isTime = axis.type == "t";
		axis.incrs = axis.incrs || (isTime ? timeIncrs : numIncrs);
		axis.values = axis.values || (isTime ? timeAxisVals : numAxisVals);
		axis.range = fnOrSelf(axis.range || (isTime ? snapMinDate : snapMinNum));
		axis.space = fnOrSelf(axis.space);
	});

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

	// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
	function snapMinDate(scaleMin, scaleMax, incr) {
		// get ts of 12am on day of i0 timestamp
		let minDate = new Date(scaleMin * 1000);
		let min00 = +(new Date(minDate[getFullYear](), minDate[getMonth](), minDate[getDate]())) / 1000;
		let offset = scaleMin - min00;
		scaleMin = min00 + incrRoundUp(offset, incr);
		return [scaleMin, scaleMax];
	}

	function snapMinNum(scaleMin, scaleMax, incr) {
		return [round6(incrRoundUp(scaleMin, incr)), scaleMax];
	}

	function setScales() {
		for (let k in scales) {
			scales[k].min = inf;
			scales[k].max = -inf;
		}

		series.forEach((s, i) => {
			const sc = scales[s.scale];

			// fast-path for x axis, which is assumed ordered ASC and will not get padded
			if (i == 0) {
				let minMax = sc.range(data[0][i0], data[0][i1]);
				sc.min = minMax[0];
				sc.max = minMax[1];
			}
			else if (s.show) {
				let minMax = sc.auto ? getMinMax(data[i], i0, i1) : [0,100];

				// this is temp data min/max
				sc.min = min(sc.min, minMax[0]);
				sc.max = max(sc.max, minMax[1]);
			}
		});

		// snap non-derived scales
		for (let k in scales) {
			const sc = scales[k];

			if (sc.base == null) {
				let minMax = sc.range(sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}
		}

		// snap derived scales
		for (let k in scales) {
			const sc = scales[k];

			if (sc.base != null) {
				let base = scales[sc.base];
				let minMax = sc.range(base.min, base.max);
				sc.min = minMax[0];
				sc.max = minMax[1];
			}
		}
	}

	function getMinMax(data, _i0, _i1) {
		let _min = inf;
		let _max = -inf;

		for (let i = _i0; i <= _i1; i++) {
			_min = min(_min, data[i]);
			_max = max(_max, data[i]);
		}

		return [_min, _max];
	}

	function drawSeries() {
		series.forEach((s, i) => {
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
					s.band,
				);
			}
		});
	}

	let dir = 1;

	function drawLine(xdata, ydata, scaleX, scaleY, color, width, dash, fill, band) {
		setCtxStyle(color, width, dash, fill);

		let gap = false;

		if (dir == 1)
			ctx.beginPath();

		let minY = inf,
			maxY = -inf,
			halfStroke = width/2,
			prevX = dir == 1 ? halfStroke : can[WIDTH] - halfStroke,
			prevY, x, y;

		for (let i = dir == 1 ? i0 : i1; dir == 1 ? i <= i1 : i >= i0; i += dir) {
			x = getXPos(xdata[i], scaleX, can[WIDTH]) + halfStroke;
			y = getYPos(ydata[i], scaleY, can[HEIGHT]);

			if (dir == -1 && i == i1)
				ctx.lineTo(x, y);

			// bug: will break filled areas due to moveTo
			if (y == null) {				// data gaps
				gap = true;
				ctx.moveTo(x, prevY);
			}
			else {
				y += halfStroke;

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
			ctx.stroke();
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
			let xDim = ori == 0 ? HEIGHT : WIDTH;
			let scale = scales[axis.scale];

			let ch = axis.vals[firstChild];

			// this will happen if all series using a specific scale are toggled off
			if (isNaN(scale.min)) {
				clearFrom(ch);
				return;
			}

			let {min, max} = scale;

			let [incr, space] = findIncr(max - min, axis.incrs, can[dim], axis.space(min, max, can[dim]));

			[min, max] = axis.range(min, max, incr);

			let ticks = [];

			for (let val = min; val <= max; val = round6(val + incr))
				ticks.push(val);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? LEFT : TOP;

			// TODO: filter ticks & offsets that will end up off-canvas
			let canOffs = ticks.map(val => getPos(val, scale, can[dim]));		// bit of waste if we're not drawing a grid

			let labels = axis.values(ticks, space);

			canOffs.forEach((off, i) => {
				ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
			});

			ch && clearFrom(ch);

			let grid = axis.grid;

			if (grid) {
				let halfStroke = grid[WIDTH]/2;

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

					ctx.moveTo(mx + halfStroke, my + halfStroke);
					ctx.lineTo(lx + halfStroke, ly + halfStroke);
				});

				ctx.stroke();
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

	function toggle(i) {
		let s = series[i];
		let label = legendLabels[i];
		s.show = !s.show;
		label[classList].toggle('off');
		!s.show && trans(cursorPts[i], 0, -10);
	}

	const legendLabels = legend.show ? series.map((s, i) => {
		let label = placeDiv(null, leg);
		label.style.color = s.color;
		label.style.borderBottom = (s.width + "px ") + (s.dash == null ? "solid " : "dashed ") + s.color;
		label.textContent = s.label + ': -';

		if (i > 0) {
			on("click", label, e => {
				if (filtMouse(e)) {
					toggle(i);

					if (s.band) {
						// not super robust, will break if two bands are adjacent
						let pairedSeries = series[i+1].band ? i+1 : i-1;
						toggle(pairedSeries);
					}

					setView(i0, i1);
				}
			});
		}

		return label;
	}) : null;

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
		let idx = closestIdx(t, data[0], i0, i1);
		return idx;
	}

	function trans(el, xPos, yPos) {
		el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
	}

	let self = this;

	function updatePointer(pub) {
		rafPending = false;

		if (cursor.show) {
			trans(vt,x,0);
			trans(hz,0,y);
		}

	//	let pctY = 1 - (y / rect[HEIGHT]);

		let idx = closestIdxFromXpos(x);

		let xPos = getXPos(data[0][idx], scales[series[0].scale], canCssWidth);

		for (let i = 0; i < series.length; i++) {
			let s = series[i];

			if (i > 0 && s.show) {
				let yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

				if (yPos == null)
					yPos = -10;

				trans(cursorPts[i], xPos, yPos);
			}

			if (legend.show)
				legendLabels[i][firstChild].nodeValue = s.label + ': ' + s.value(data[i][idx]);
		}

		if (dragging) {
			let minX = min(x0, x);
			let maxX = max(x0, x);

			setStylePx(region, LEFT, minX);
			setStylePx(region, WIDTH, maxX - minX);
		}

		pub !== false && sync.pub(mousemove, self, x, y, canCssWidth, canCssHeight, idx);
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

				let minX = min(x0, x);
				let maxX = max(x0, x);

				setView(
					closestIdxFromXpos(minX),
					closestIdxFromXpos(maxX),
				);
			}

			if (e != null)
				sync.pub(mouseup, self, x, y, canCssWidth, canCssHeight, null);
		}
	}

	function dblClick(e, src, _x, _y, _w, _h, _i) {
		if (i0 == 0 && i1 == dataLen - 1)
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
		on(ev, ev == mouseup ? doc : can, events[ev]);

	let deb = debounce(syncRect, 100);

	on("resize", win, deb);
	on("scroll", win, deb);

	this.root = root;

	let syncKey = cursor.sync;

	let sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

	sync.sub(this);

	function pub(type, src, x, y, w, h, i) {
		events[type](null, src, x, y, w, h, i);
	}

	this.pub = pub;

	setData(data, 0, data[0].length - 1);

	plot.appendChild(can);
}

uPlot.fmtDate = fmtDate;