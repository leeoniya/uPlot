import fmtDate from './fmtDate';

export default function uPlot(opts) {
	// todo shallow-copy opts?
	const doc = document;

	const rat = devicePixelRatio;
	const M = Math;
	const floor = M.floor;
	const round = M.round;
	const ceil = M.ceil;
	const min = M.min;
	const max = M.max;
	const pow = M.pow;
	const log10 = M.log10;

	// TODO: series[0].format
	if (typeof opts.format == "string") {
		let stamp = fmtDate(opts.format);
		opts.format = v => stamp(new Date(v * 1e3));
	}

	const cursor = opts.cursor;

	function incrRoundUp(num, incr) {
		return ceil(num/incr)*incr;
	}

	function incrRoundDn(num, incr) {
		return floor(num/incr)*incr;
	}

	const root = placeDiv("chart");

	const { can, ctx } = makeCanvas(opts.width, opts.height);

	const xlabels = placeDiv("x-labels", root);
	xlabels.style.top = opts.height + "px";

	const ylabels = placeDiv("y-labels", root);

	const data = opts.data;

	let dataLen = data[0].length;

	// rendered data window
	let i0 = 0;
	let i1 = dataLen - 1;

	const series = opts.series;

	let scales = {};

	function makeCanvas(wid, hgt) {
		const can = doc.createElement("canvas");
		const ctx = can.getContext("2d");

		can.width = round(wid * rat);
		can.height = round(hgt * rat);
		can.style.width = wid + "px";
		can.style.height = hgt + "px";

		return {
			can,
			ctx,
		};
	}

	function placeDiv(cls, targ) {
		let div = doc.createElement("div");

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

		// fast-path special case for time axis, which is assumed ordered ASC
		scales['t'] = {
			min: data[0][i0],
			max: data[0][i1],
		};

		series.forEach((s, i) => {
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

	function drawGraphs() {
		series.forEach((s, i) => {
			drawGraph(
				data[0],
				data[i+1],
				s.color,
				scales['t'],
				scales[s.scale],
			);
		});
	}

	function drawGraph(xdata, ydata, stroke, scaleX, scaleY) {
		ctx.lineWidth = 1;
		ctx.strokeStyle = stroke;

		let yOk;
		let gap = false;

		ctx.beginPath();

		for (let i = i0; i <= i1; i++) {
			let xPos = getXPos(xdata[i], scaleX, can.width);
			let yPos = getYPos(ydata[i], scaleY, can.height);

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

	function findIncr(min, max, incrs, dim, minSpace) {
		let pxPerUnit = dim / (max - min);

		for (var i = 0; i < incrs.length; i++) {
			if (incrs[i] * pxPerUnit >= minSpace)
				return incrs[i];
		}
	}

	// dim is logical (getClientBoundingRect) pixels, not canvas pixels
	function gridVals(min, max, incr) {
		let vals = [];

		for (let val = min; val <= max; val += incr)
			vals.push(val);

		return vals;
	}

	// returns array of labels
	function gridLabels(vals) {


	}

	function gridValsY(min, max) {
		let minSpace = 30;
		let incrs = [
			0.01,
			0.02,
			0.05,
			0.1,
			0.2,
			0.5,
			1,
			2,
			5,
			10,
			20,
			50,
			1e2,
			2e2,
			5e2,
			1e3,
			2e3,
			5e3,
			1e4,
			2e4,
			5e4,
			1e5,
			2e5,
			5e5,
			1e6,
			2e6,
			5e6,
			1e7,
			2e7,
			5e7,
			1e8,
			2e8,
			5e8,
			1e9,
		];

		let incr = findIncr(min, max, incrs, opts.height, minSpace);

		return gridVals(min, max, incr);
	}

	let minSecs = 60,
		hourSecs = minSecs * minSecs,
		daySecs = hourSecs * 24;

	function gridValsX(min, max) {
		let minSpace = 40;
		let incrs = [
			1,
			5,
			10,
			15,
			30,
			minSecs,
			minSecs * 5,
			minSecs * 10,
			minSecs * 15,
			minSecs * 30,
			hourSecs,
			hourSecs * 2,
			hourSecs * 3,
			hourSecs * 4,
			hourSecs * 6,
			hourSecs * 8,
			hourSecs * 12,
			daySecs,
			// TODO?: weeks
			// TODO: months
			// TODO: years
			daySecs * 365,
		];

		let incr = findIncr(min, max, incrs, opts.width, minSpace);

		// get ts of 12am on day of i0 timestamp
		let minDate = new Date(min * 1000);
		let min00 = +(new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) / 1000;
		let offset = min - min00;
		let newMin = min00 + incrRoundUp(offset, incr);

		return gridVals(newMin, max, incr);
	}

	function gridLabel(par, val, side, pxVal) {
		let div = placeDiv(null, par);
		div.textContent = val;
		div.style[side] = pxVal + "px";
	}

	function xValFmtr(incr) {
		let stamp = (
			incr >= daySecs ? fmtDate('{M}/{DD}') :
			// {M}/{DD}/{YY} should only be prepended at 12a?		// {YY} only at year boundaries?
			incr >= hourSecs ? fmtDate('{M}/{DD}\n{h}{aa}') :
			incr >= minSecs ? fmtDate('{M}/{DD}\n{h}:{mm}{aa}') :
			fmtDate('{M}/{DD}\n{h}:{mm}:{ss}{aa}')
		);

		return val => stamp(new Date(val * 1e3));
	}

	function yValFmtr(incr) {
		return val => val + '%';
	}

	function drawGrid() {
		let xScale = scales['t'];
		let xVals = gridValsX(data[0][i0], data[0][i1]);
		let xIncr = xVals[1] - xVals[0];
		let xFmt = xValFmtr(xIncr);

		let yScale = scales['%'];
		let yVals = gridValsY(yScale.min, yScale.max);
		let yIncr = yVals[1] - yVals[0];
		let yFmt = yValFmtr(yIncr);

		ctx.lineWidth = 1;
		ctx.strokeStyle = "#eee";

		ctx.beginPath();

		for (let i = 0; i < xVals.length; i++) {
			let val = xVals[i];
			let xPos = getXPos(val, xScale, can.width);

			gridLabel(xlabels, xFmt(val), "left", round(xPos/rat));

			ctx.moveTo(xPos, 0);
			ctx.lineTo(xPos, can.height);
		}

		for (let i = 0; i < yVals.length; i++) {
			let val = yVals[i];
			let yPos = getYPos(val, yScale, can.height);

			gridLabel(ylabels, yFmt(val), "top", round(yPos/rat));

			ctx.moveTo(0, yPos);
			ctx.lineTo(can.width, yPos);
		}

		ctx.stroke();
	}

	function clearChildren(el) {
		while (el.firstChild)
			el.firstChild.remove();
	}

	function setWindow(_i0, _i1) {
		i0 = _i0;
		i1 = _i1;
		setScales(true);
		ctx.clearRect(0, 0, can.width, can.height);
		clearChildren(xlabels);
		clearChildren(ylabels);
		drawGrid();
		drawGraphs();
	}

	setWindow(i0, i1);

	root.appendChild(can);

//	INTERACTION

	const rAF = requestAnimationFrame;

	let vt;
	let hz;

	if (cursor) {
		// cursor
		vt = placeDiv("vt", root);
		hz = placeDiv("hz", root);
	}

	// zoom region
	const region = placeDiv("region", root);

	const leg = placeDiv("legend", root);

	const labels = [{
		color: opts.color,
		label: opts.label,
	}].concat(series).map((s, i) => {
		let label = placeDiv("label", leg);
		label.style.color = s.color;
		label.textContent = s.label + ': -';
		return label;
	});

	// series-intersection markers
	const pts = series.map(s => {
		let dot = placeDiv("dot", root);
		dot.style.background = s.color;
		return dot;
	});

	let rafPending = false;

	function closestIdxFromXpos(x) {
		let pctX = x / opts.width;
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

	//	let pctY = 1 - (y / rect.height);

		let idx = closestIdxFromXpos(x);

		let xPos = getXPos(data[0][idx], scales['t'], opts.width);

		labels[0].firstChild.nodeValue = opts.label + ': ' + opts.format(data[0][idx]);

		for (let i = 0; i < series.length; i++) {
			let yPos = getYPos(data[i+1][idx], scales[series[i].scale], opts.height);
			trans(pts[i], xPos, yPos);
			labels[i+1].firstChild.nodeValue = series[i].label + ': ' + series[i].format(data[i+1][idx]);
		}

		if (dragging) {
			let minX = min(x0, x);
			let maxX = max(x0, x);

			region.style.left = minX + "px";
			region.style.width = (maxX - minX) + "px";
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

	// binary search for index of closest value
	function closestIdx(num, arr, lo, hi) {
		let mid;
		lo = lo || 0;
		hi = hi || arr.length - 1;
		let bitwise = hi <= 2147483647;

		while (hi - lo > 1) {
			mid = bitwise ? (lo + hi) >> 1 : floor((lo + hi) / 2);

			if (arr[mid] < num)
				lo = mid;
			else
				hi = mid;
		}

		if (num - arr[lo] <= arr[hi] - num)
			return lo;

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
			return;

		region.style.left = 0;
		region.style.width = 0;

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

		setWindow(
			0,
			dataLen - 1,
		);
	}

	const win = window;

	function debounce(fn, time) {
		let pending = null;

		function run() {
			pending = null;
			fn();
		}

		return function() {
			clearTimeout(pending);
			pending = setTimeout(run, time);
		}
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