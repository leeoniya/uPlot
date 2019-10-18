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

	mousemove,
	mousedown,
	mouseup,
	dblclick,

	assign,
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
	const axes = setDefaults(opts.axes, xAxisOpts, yAxisOpts);

	// set default value
	series.forEach(s => {
		let isTime = s.type == "t";

		s.value = s.value || (isTime ? timeSeriesVal : numSeriesVal);
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	let scales = {};

	const cursor = opts.cursor;

	let dataLen;

	// rendered data window
	let i0;
	let i1;

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

	const root = placeDiv("chart");

	const plot = placeDiv("plot", root);

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

		// also set defaults for incrs & values based on axis type
		let isTime = axis.type == "t";
		axis.incrs = axis.incrs || (isTime ? timeIncrs : numIncrs);
		axis.values = axis.values || (isTime ? timeAxisVals : numAxisVals);
	});

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	let off1 = fullCssWidth - plotLft;
	let off2 = fullCssHeight - plotTop;
	let off3 = plotLft + canCssWidth;
	let off0 = plotTop + canCssHeight;

	function placeAxis(axis, part, crossDim) {
		let side = axis.side;
		let isVt = side % 2;

		let el = placeDiv((isVt ? "y-" : "x-") + part + "-" + side, root);

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
	setStylePx(root, WIDTH, fullCssWidth);
	setStylePx(root, HEIGHT, fullCssHeight);

	const { can, ctx } = makeCanvas(canCssWidth, canCssHeight);

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
			div.className = cls;

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

	function reScale(min, max, incr) {
		return [min, max];
	}

	// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
	// setMinMax() serves the same purpose for non-temporal/numeric y-axes due to incr-snapped padding added above/below
	function snapMinDate(min, max, incr) {
		// get ts of 12am on day of i0 timestamp
		let minDate = new Date(min * 1000);
		let min00 = +(new Date(minDate[getFullYear](), minDate[getMonth](), minDate[getDate]())) / 1000;
		let offset = min - min00;
		let newMin = min00 + incrRoundUp(offset, incr);
		return [newMin, max];
	}

	function setScales(reset) {
		if (reset)
			scales = {};		// TODO: use original opts scales if they exist

		series.forEach((s, i) => {
			const key = s.scale;

			if (!(key in scales)) {
				scales[key] = {
					min:  inf,
					max: -inf,
				};
			}

			const sc = scales[key];

			sc.adj = sc.adj || (s.type == "t" ? snapMinDate : reScale);

			// fast-path for x axis, which is assumed ordered ASC and will not get padded
			if (i == 0) {
				sc.min = data[0][i0];
				sc.max = data[0][i1];
			}
			else if (s.shown)
				setMinMax(sc, data[i])
		});
	}

	function setMinMax(s, data) {
		for (let i = i0; i <= i1; i++) {
			s.min = min(s.min, data[i]);
			s.max = max(s.max, data[i]);
		}

		// auto-scale Y
		const delta = s.max - s.min;
		const mag = log10(delta || abs(s.max) || 1);
		const exp = floor(mag);
		const incr = pow(10, exp) / 2;
		const buf = delta == 0 ? incr : 0;

		const origMin = s.min;

		s.min = round6(incrRoundDn(s.min - buf, incr));
		s.max = round6(incrRoundUp(s.max + buf, incr));

		if (origMin >= 0 && s.min < 0)
			s.min = 0;
	}

	function drawSeries() {
		series.forEach((s, i) => {
			if (i > 0 && s.shown) {
				drawLine(
					data[0],
					data[i],
					scales[series[0].scale],
					scales[s.scale],
					s.color,
					s[WIDTH],
					s.dash,
					s.fill,
				);
			}
		});
	}

	function drawLine(xdata, ydata, scaleX, scaleY, color, width, dash, fill) {
		setCtxStyle(color, width, dash, fill);

		let gap = false;

		ctx.beginPath();

		let minY = inf,
			maxY = -inf,
			halfStroke = width/2,
			prevX = halfStroke,
			prevY, x, y;

		for (let i = i0; i <= i1; i++) {
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

	function drawAxesGrid() {
		axes.forEach((axis, i) => {
			let ori = i == 0 ? 0 : 1;
			let dim = ori == 0 ? WIDTH : HEIGHT;
			let xDim = ori == 0 ? HEIGHT : WIDTH;
			let scale = scales[axis.scale];

			// this will happen if all series using a specific scale are toggled off
			if (scale == null)
				return;

			let {min, max, adj} = scale;

			let [incr, space] = findIncr(max - min, axis.incrs, opts[dim], axis.space);

			[min, max] = adj(min, max, incr);

			let ticks = [];

			for (let val = min; val <= max; val = round6(val + incr))
				ticks.push(val);

			let labels = axis.values(ticks, space);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? LEFT : TOP;
			let canOffs = ticks.map(val => getPos(val, scale, can[dim]));		// bit of waste if we're not drawing a grid

			let ch = axis.vals[firstChild];

			canOffs.forEach((off, i) => {
				ch = gridLabel(ch, axis.vals, labels[i], cssProp, round(off/pxRatio))[nextSibling];
			});

			if (ch) {
				let next;
				while (next = ch[nextSibling])
					next.remove();
				ch.remove();
			}

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

	let vt;
	let hz;

	let x = null;
	let y = null;

	if (cursor) {
		vt = placeDiv("vt", plot);
		hz = placeDiv("hz", plot);
		x = canCssWidth/2;
		y = canCssHeight/2;
	}

	// zoom region
	const region = placeDiv("region", plot);

	const leg = placeDiv("legend", root);

	const labels = series.map((s, i) => {
		let label = placeDiv("label", leg);
		label.style.color = s.color;
		label.textContent = s.label + ': -';

		if (i > 0) {
			on("click", label, () => {
				s.shown = !s.shown;
				label.classList.toggle('off');
				setView(i0, i1);
			});
		}

		return label;
	});

	// series-intersection markers
	const pts = series.map((s, i) => {
		if (i > 0 && s.shown) {
			let dot = placeDiv("dot", plot);
			dot.style.background = s.color;
			return dot;
		}
	});

	let rafPending = false;

	function closestIdxFromXpos(x) {
		let pctX = x / canCssWidth;
		let d = data[0][i1] - data[0][i0];
		let t = data[0][i0] + pctX * d;
		let idx = closestIdx(t, data[0], i0, i1);
		return idx;
	}

	function trans(el, xPos, yPos) {
		el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
	}

	let self = this;

	function updatePointer(pub) {
		rafPending = false;

		if (cursor) {
			trans(vt,x,0);
			trans(hz,0,y);
		}

	//	let pctY = 1 - (y / rect[HEIGHT]);

		let idx = closestIdxFromXpos(x);

		let xPos = getXPos(data[0][idx], scales[series[0].scale], canCssWidth);

		for (let i = 0; i < series.length; i++) {
			let s = series[i];

			if (i > 0 && s.shown) {
				let yPos = getYPos(data[i][idx], scales[s.scale], canCssHeight);

				if (yPos == null)
					yPos = -10;

				trans(pts[i], xPos, yPos);
			}

			labels[i][firstChild].nodeValue = s.label + ': ' + s.value(data[i][idx]);
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
		on(ev, can, events[ev]);

	let deb = debounce(syncRect, 100);

	on("resize", win, deb);
	on("scroll", win, deb);

	this.root = root;

	let syncKey = opts.sync;

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