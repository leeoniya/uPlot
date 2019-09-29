import fmtdate from './fmtdate';

export default function Plotty(opts) {
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
		let stamp = fmtdate(opts.format);
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
		const incr = pow(10, exp);

		s.min = min(incrRoundDn(s.min, incr), s.min);
		s.max = max(incrRoundUp(s.max, incr), s.max);
	}

	// with clear?
	function drawGraphs() {
		setScales();
		ctx.clearRect(0, 0, can.width, can.height);
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

	drawGraphs();

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

	let rect = can.getBoundingClientRect();

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

	on("mousemove", can, mouseMove);
	on("mousedown", can, mouseDown);
	on("mouseup", can, mouseUp);
	on("dblclick", can, dblclick);

	this.root = root;
}

Plotty.fmtdate = fmtdate;