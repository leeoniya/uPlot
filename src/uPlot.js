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
	firstChild,
	createElement,
} from './utils';

import { xOpts, yOpts } from './opts';

export default function uPlot(opts) {
	const series = opts.series;
	const axes = opts.axes;
	const cursor = opts.cursor;

	function setStyle(color, width, dash, fill) {
		if (color)
			ctx.strokeStyle = color;
		if (width)
			ctx.lineWidth = width;
		if (dash)
			ctx.setLineDash(dash);
		if (fill)
			ctx.fillStyle = fill;
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
		let pos = axis.pos;
		let isVt = pos % 2;

		if (isVt) {
			let w = (axis[WIDTH] = axis[WIDTH] || AXIS_WIDTH);
			canCssWidth -= w;

			if (pos == 1)
				plotLft += w;
		}
		else {
			let h = (axis[HEIGHT] = axis[HEIGHT] || AXIS_HEIGHT);
			canCssHeight -= h;

			if (pos == 2)
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
		let pos = axis.pos;
		let isVt = pos % 2;

		let el = axis.root = placeDiv((isVt ? "y" : "x") + "-labels", root);

		if (isVt) {
			let w = axis[WIDTH];
			el.style[WIDTH] = w + "px";
			el.style[HEIGHT] = canCssHeight + "px";
			el.style.top = plotTop + "px";

			if (pos == 1) {
				el.style.right = off1 + "px";
				off1 += w;
			}
			else {
				el.style.left = off3 + "px";
				off3 += w;
			}
		}
		else {
			let h = axis[HEIGHT];
			el.style[HEIGHT] = h + "px";
			el.style[WIDTH] = canCssWidth + "px";
			el.style.left = plotLft + "px";

			if (pos == 2) {
				el.style.bottom = off2 + "px";
				off2 += h;
			}
			else {
				el.style.top = off0 + "px";
				off0 += h;
			}

		}
	});

	plot.style.top = plotTop + "px";
	plot.style.left = plotLft + "px";
	root.style[WIDTH] = fullCssWidth + "px";
	root.style[HEIGHT] = fullCssHeight + "px";

	const { can, ctx } = makeCanvas(canCssWidth, canCssHeight);

	const data = opts.data;

	let dataLen = data[0].length;

	// rendered data window
	let i0 = 0;
	let i1 = dataLen - 1;

	let scales = {};

	function makeCanvas(wid, hgt) {
		const can = doc[createElement]("canvas");
		const ctx = can.getContext("2d");

		can[WIDTH] = round(wid * pxRatio);
		can[HEIGHT] = round(hgt * pxRatio);
		can.style[WIDTH] = wid + "px";
		can.style[HEIGHT] = hgt + "px";

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
			else
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
			if (i > 0) {
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
		setStyle(color, width, dash, fill);

		let yOk;
		let gap = false;

		ctx.beginPath();

		for (let i = i0; i <= i1; i++) {
			let xPos = getXPos(xdata[i], scaleX, can[WIDTH]);
			let yPos = getYPos(ydata[i], scaleY, can[HEIGHT]);

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
					ctx.lineTo(xPos, yPos);
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
		div.style[side] = pxVal + "px";
	}

	function drawAxesGrid() {
		axes.forEach((axis, i) => {
			let ori = i == 0 ? 0 : 1;
			let dim = ori == 0 ? WIDTH : HEIGHT;
			let xDim = ori == 0 ? HEIGHT : WIDTH;
			let scale = scales[axis.scale];
			let {min, max} = scale;

			let [incr, space] = findIncr(max - min, axis.incrs, opts[dim], axis.space);

			if (i == 0)
				[min, max] = reframeDateRange(min, max, incr);

			let ticks = [];

			for (let val = min; val <= max; val += incr)
				ticks.push(val);

			let labels = axis.values(ticks, space);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? "left" : "top";
			let canOffs = ticks.map(val => getPos(val, scale, can[dim]));		// bit of waste if we're not drawing a grid

			canOffs.forEach((off, i) => {
				gridLabel(axis.root, labels[i], cssProp, round(off/pxRatio));
			});

			let grid = axis.grid;

			if (grid) {
				setStyle(grid.color || "#eee", grid[WIDTH], grid.dash);

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
	}

	// zoom region
	const region = placeDiv("region", plot);

	const leg = placeDiv("legend", root);

	const labels = series.map((s, i) => {
		let label = placeDiv("label", leg);
		label.style.color = s.color;
		label.textContent = s.label + ': -';
		return label;
	});

	// series-intersection markers
	const pts = series.map((s, i) => {
		if (i > 0) {
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
			if (i > 0) {
				let yPos = getYPos(data[i][idx], scales[series[i].scale], canCssHeight);
				trans(pts[i], xPos, yPos);
			}

			labels[i][firstChild].nodeValue = series[i].label + ': ' + series[i].value(data[i][idx]);
		}

		if (dragging) {
			let minX = min(x0, x);
			let maxX = max(x0, x);

			region.style.left = minX + "px";
			region.style[WIDTH] = (maxX - minX) + "px";
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

		region.style.left = 0;
		region.style[WIDTH] = 0;

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

	on("resize", win, debounce(syncRect, 100));
	on("scroll", win, debounce(syncRect, 100));

	this.root = root;
}

uPlot.fmtDate = fmtDate;
uPlot.xOpts = xOpts;
uPlot.yOpts = yOpts;