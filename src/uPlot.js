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
	floor,
	round,
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
	createElement,
	hexBlack,

	assign,
} from './utils';

import { xAxisOpts, yAxisOpts, xSeriesOpts, ySeriesOpts } from './opts';

export default function uPlot(opts) {
	function setDefaults(d, xo, yo) {
		return [d.x].concat(d.y).map((o, i) => assign({}, (i == 0 ? xo : yo), o));
	}

	const series = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
	const axes = setDefaults(opts.axes, xAxisOpts, yAxisOpts);
	const data = series.map(s => s.data);
	let scales = {};

	const cursor = opts.cursor;

	let dataLen = data[0].length;

	// rendered data window
	let i0 = 0;
	let i1 = dataLen - 1;

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

	const AXIS_WIDTH = 40;
	const AXIS_HEIGHT = 30;

	// accumulate axis offsets, reduce canvas width
	axes.forEach((axis, i) => {
		let side = axis.side;
		let isVt = side % 2;

		if (isVt) {
			let w = (axis[WIDTH] = axis[WIDTH] || AXIS_WIDTH);
			canCssWidth -= w;

			if (side == 1)
				plotLft += w;
		}
		else {
			let h = (axis[HEIGHT] = axis[HEIGHT] || AXIS_HEIGHT);
			canCssHeight -= h;

			if (side == 2)
				plotTop += h;
		}
	});

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	let off1 = fullCssWidth - plotLft;
	let off2 = fullCssHeight - plotTop;
	let off3 = plotLft + canCssWidth;
	let off0 = plotTop + canCssHeight;

	// init axis containers, set axis positions
	axes.forEach((axis, i) => {
		let side = axis.side;
		let isVt = side % 2;

		let el = axis.root = placeDiv((isVt ? "y" : "x") + "-labels-" + side, root);

		if (isVt) {
			let w = axis[WIDTH];
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
			let h = axis[HEIGHT];
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
		return round((1 - pctY) * hgt) + 0.5;
	}

	function getXPos(val, scale, wid) {
		let pctX = (val - scale.min) / (scale.max - scale.min);
		return round(pctX * wid) + 0.5;
	}

	function setScales(reset) {
		if (reset)
			scales = {};

		series.forEach((s, i) => {
			// fast-path special case for time axis, which is assumed ordered ASC
			if (i == 0) {
				scales[s.scale] = {
					min: data[0][i0],
					max: data[0][i1],
				};
			}
			else if (s.shown)
				setScale(s.scale, data[i]);
		});
	}

	function setScale(key, data) {
		if (!(key in scales)) {
			scales[key] = {
				min: Infinity,
				max: -Infinity,
			};
		}

		const s = scales[key];

		for (let i = i0; i <= i1; i++) {
			s.min = min(s.min, data[i]);
			s.max = max(s.max, data[i]);
		}

		// auto-scale Y
		const delta = s.max - s.min;
		const mag = log10(delta);
		const exp = floor(mag);
		const incr = pow(10, exp) / 2;

		s.min = min(incrRoundDn(s.min, incr), s.min);
		s.max = max(incrRoundUp(s.max, incr), s.max);
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

		let prevX, minY, maxY, prevY, x, y;

		for (let i = i0; i <= i1; i++) {
			x = getXPos(xdata[i], scaleX, can[WIDTH]);
			y = getYPos(ydata[i], scaleY, can[HEIGHT]);

			if (y == null) {				// data gaps
				gap = true;
				ctx.moveTo(x, prevY);
			}
			else {
				// maybe should be (x - prevX >= width), but doesnt seem to make much perf difference.
				// visual difference is slight at width = 2
				if (x != prevX) {
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

	function reframeDateRange(min, max, incr) {
		// get ts of 12am on day of i0 timestamp
		let minDate = new Date(min * 1000);
		let min00 = +(new Date(minDate[getFullYear](), minDate[getMonth](), minDate[getDate]())) / 1000;
		let offset = min - min00;
		let newMin = min00 + incrRoundUp(offset, incr);
		return [newMin, max];
	}

	function gridLabel(par, val, side, pxVal) {
		let div = placeDiv(null, par);
		div.textContent = val;
		setStylePx(div, side, pxVal);
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

			let {min, max} = scale;

			let [incr, space] = findIncr(max - min, axis.incrs, opts[dim], axis.space);

			if (i == 0)
				[min, max] = reframeDateRange(min, max, incr);

			let ticks = [];

			for (let val = min; val <= max; val += incr)
				ticks.push(val);

			let labels = axis.values(ticks, space);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? LEFT : TOP;
			let canOffs = ticks.map(val => getPos(val, scale, can[dim]));		// bit of waste if we're not drawing a grid

			canOffs.forEach((off, i) => {
				gridLabel(axis.root, labels[i], cssProp, round(off/pxRatio));
			});

			let grid = axis.grid;

			if (grid) {
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
			}
		});
	}

	function clearChildren(el) {
		while (el[firstChild])
			el[firstChild].remove();
	}

	function setWindow(_i0, _i1) {
		i0 = _i0;
		i1 = _i1;
		setScales(true);
		ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
		axes.forEach(axis => {
			clearChildren(axis.root);
		});
		drawAxesGrid();
		drawSeries();
	}

	setWindow(i0, i1);

	plot.appendChild(can);

//	INTERACTION

	let vt;
	let hz;

	if (cursor) {
		// cursor
		vt = placeDiv("vt", plot);
		hz = placeDiv("hz", plot);
		trans(vt, canCssWidth/2, 0);
		trans(hz, 0, canCssHeight/2);
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
				setWindow(i0, i1);
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

	function update() {
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
	}

	let x0 = null;
	let y0 = null;

	let x = null;
	let y = null;

	let dragging = false;

	let rect = null;

	function syncRect() {
		rect = can.getBoundingClientRect();
	}

	function mouseMove(e) {
		if (rect == null)
			syncRect();

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
			return;

		setStylePx(region, LEFT, 0);
		setStylePx(region, WIDTH, 0);

		let minX = min(x0, x);
		let maxX = max(x0, x);

		setWindow(
			closestIdxFromXpos(minX),
			closestIdxFromXpos(maxX),
		);
	}

	function dblclick(e) {
		if (i0 == 0 && i1 == dataLen - 1)
			return;

		setWindow(0, dataLen - 1);
	}

	on("mousemove", can, mouseMove);
	on("mousedown", can, mouseDown);
	on("mouseup", can, mouseUp);
	on("dblclick", can, dblclick);

	let deb = debounce(syncRect, 100);

	on("resize", win, deb);
	on("scroll", win, deb);

	this.root = root;
}

uPlot.fmtDate = fmtDate;