const width = 1920;
const height = 600;
const pxRatio = devicePixelRatio;
const pxRound = value => (Math.round(value * pxRatio) + 0.5) / pxRatio;
const margin = {top: 10, right: 70, bottom: 30, left: 55};
const plotLeft = margin.left;
const plotRight = width - margin.right;
const plotTop = margin.top;
const plotBottom = height - margin.bottom;

function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	// epoch,idl,recv,send,writ,used,free
	const numFields = packed[0];
	const start = numFields + 1;

	const len = (packed.length - start) / numFields;
	const data = [Array(len), Array(len), Array(len), Array(len)];

	for (let i = start, j = 0; i < packed.length; i += numFields, j++) {
		data[0][j] = packed[i] * 60 * 1000;
		data[1][j] = round3(100 - packed[i + 1]);
		data[2][j] = round2(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]));
		data[3][j] = packed[i + 3];
	}

	return data;
}

function setupCanvas(canvas) {
	canvas.width = Math.round(width * pxRatio);
	canvas.height = Math.round(height * pxRatio);
	const ctx = canvas.getContext("2d");
	ctx.scale(pxRatio, pxRatio);
	return ctx;
}

function axisTicks(xScale, pctScale, mbScale) {
	const xFormat = xScale.tickFormat(12);
	return {
		pct: pctScale.ticks(10).map(tick => [pctScale(tick), `${+tick.toFixed(1)}%`]),
		mb: mbScale.ticks(10).map(tick => [mbScale(tick), `${+tick.toFixed(2)} MB`]),
		x: xScale.ticks(12).map(tick => [pxRound(xScale(tick)), xFormat(tick)]),
	};
}

function drawAxes(ctx, ticks) {
	ctx.font = "10px Arial";
	ctx.lineWidth = 1 / pxRatio;
	ctx.textBaseline = "middle";

	ctx.strokeStyle = "rgba(0,0,0,0.1)";
	ctx.beginPath();
	for (const [position] of ticks.pct) {
		const y = pxRound(position);
		ctx.moveTo(plotLeft, y);
		ctx.lineTo(plotRight, y);
	}
	ctx.stroke();

	ctx.fillStyle = "#000";
	ctx.strokeStyle = "#000";
	ctx.textAlign = "right";
	for (const [y, label] of ticks.pct)
		ctx.fillText(label, plotLeft - 8, y);

	ctx.textAlign = "left";
	for (const [y, label] of ticks.mb)
		ctx.fillText(label, plotRight + 8, y);

	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.beginPath();
	ctx.moveTo(plotLeft, plotBottom + 0.5);
	ctx.lineTo(plotRight, plotBottom + 0.5);
	for (const [x, label] of ticks.x) {
		ctx.moveTo(x, plotBottom);
		ctx.lineTo(x, plotBottom + 5);
		ctx.fillText(label, x, plotBottom + 7);
	}
	ctx.stroke();
}

function flushMinMax(ctx, x, first, min, max, last, scale) {
	if (min !== max) {
		if (min !== first && min !== last)
			ctx.lineTo(x, pxRound(scale(min)));
		if (max !== first && max !== last)
			ctx.lineTo(x, pxRound(scale(max)));
		ctx.lineTo(x, pxRound(scale(last)));
	}
}

// Sorted X values share a device-pixel column. Keep raw Y extrema until emission,
// with no sampled arrays or per-point objects. Gaps flush and restart the path.
function drawMinMax(ctx, xs, values, xScale, yScale) {
	let column, first, min, max, last;
	let active = false;
	let segmentLength = 0;

	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (value == null) {
			if (active)
				flushMinMax(ctx, column, first, min, max, last, yScale);
			if (segmentLength === 1)
				ctx.closePath();
			active = false;
			segmentLength = 0;
			continue;
		}

		const x = pxRound(xScale(xs[i]));
		if (!active || x !== column) {
			if (active)
				flushMinMax(ctx, column, first, min, max, last, yScale);
			if (segmentLength === 0)
				ctx.moveTo(x, pxRound(yScale(value)));
			else
				ctx.lineTo(x, pxRound(yScale(value)));
			column = x;
			first = min = max = value;
			active = true;
		}
		else {
			if (value < min) min = value;
			if (value > max) max = value;
		}
		last = value;
		segmentLength++;
	}

	if (active)
		flushMinMax(ctx, column, first, min, max, last, yScale);
	if (segmentLength === 1)
		ctx.closePath();
}

function canvasRenderer(host, line, series, ticks, drawSeries) {
	const plotCtx = setupCanvas(host.querySelector("#plot"));
	const overlay = host.querySelector("#overlay");
	const overlayCtx = setupCanvas(overlay);
	line.context(plotCtx);

	function redraw() {
	plotCtx.clearRect(0, 0, width, height);
	drawAxes(plotCtx, ticks);

	plotCtx.save();
	plotCtx.beginPath();
	plotCtx.rect(plotLeft, plotTop, plotRight - plotLeft, plotBottom - plotTop);
	plotCtx.clip();
	plotCtx.lineWidth = 1 / pxRatio;

	for (const [values, scale, color] of series) {
		plotCtx.beginPath();
		if (drawSeries)
			drawSeries(plotCtx, values, scale);
		else
			line.y(value => pxRound(scale(value)))(values);
		plotCtx.strokeStyle = color;
		plotCtx.stroke();
	}
	plotCtx.restore();
	}
	redraw();

	return {
		update(nextTicks) { ticks = nextTicks; redraw(); },
		overlay,
		pointer: event => event.offsetX,
		clearCursor: () => overlayCtx.clearRect(0, 0, width, height),
		drawCursor(x, points) {
			overlayCtx.strokeStyle = "rgba(0,0,0,0.5)";
			overlayCtx.lineWidth = 1 / pxRatio;
			overlayCtx.beginPath();
			overlayCtx.moveTo(x, plotTop);
			overlayCtx.lineTo(x, plotBottom);
			overlayCtx.stroke();

			for (const [y, color] of points) {
				if (y != null) {
					overlayCtx.beginPath();
					overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
					overlayCtx.fillStyle = color;
					overlayCtx.fill();
				}
			}
		},
		destroy() {},
	};
}

let nextClipId = 0;

function svgRenderer(host, line, series, ticks, drawSeries) {
	const svg = host.querySelector("#plot");
	const root = d3.select(svg).append("g").attr("class", "d3-svg-chart");
	const clipId = `d3-svg-clip-${++nextClipId}`;
	root.append("defs").append("clipPath")
		.attr("id", clipId)
		.attr("clipPathUnits", "userSpaceOnUse")
		.append("rect")
		.attr("x", plotLeft).attr("y", plotTop)
		.attr("width", plotRight - plotLeft).attr("height", plotBottom - plotTop);

	const axes = root.append("g")
		.attr("class", "axes")
		.attr("font-family", "Arial").attr("font-size", 10)
		.attr("fill", "#000").attr("stroke-width", 1 / pxRatio);
	const grid = axes.append("g").attr("class", "grid").attr("stroke", "rgba(0,0,0,0.1)");
	function drawGrid() {
		grid.selectAll('line').data(ticks.pct).join('line')
			.attr('x1', plotLeft).attr('x2', plotRight)
			.attr('y1', ([y]) => pxRound(y)).attr('y2', ([y]) => pxRound(y));
	}
	drawGrid();

	for (const [name, values, x, anchor] of [
		["pct", ticks.pct, plotLeft - 8, "end"],
		["mb", ticks.mb, plotRight + 8, "start"],
	]) {
		const axis = axes.append("g").attr("class", `axis-${name}`)
			.attr("text-anchor", anchor).attr("dominant-baseline", "central");
		for (const [y, label] of values)
			axis.append("text").attr("x", x).attr("y", y).text(label);
	}

	const xAxis = axes.append("g").attr("class", "axis-x").attr("text-anchor", "middle");
	xAxis.append("line").attr("stroke", "#000")
		.attr("x1", plotLeft).attr("x2", plotRight)
		.attr("y1", plotBottom + 0.5).attr("y2", plotBottom + 0.5);
	for (const [x, label] of ticks.x) {
		xAxis.append("line").attr("stroke", "#000")
			.attr("x1", x).attr("x2", x).attr("y1", plotBottom).attr("y2", plotBottom + 5);
		xAxis.append("text").attr("x", x).attr("y", plotBottom + 7)
			.attr("dominant-baseline", "text-before-edge").text(label);
	}

	const paths = root.append("g").attr("class", "series")
		.attr("clip-path", `url(#${clipId})`).attr("fill", "none").attr("stroke-width", 1 / pxRatio);
	// Keep the shared device-pixel coordinates, including fractional DPRs.
	line.digits(null);
	function seriesPath(values, scale) {
		if (!drawSeries)
			return line.y(value => pxRound(scale(value)))(values);
		const path = d3.path();
		drawSeries(path, values, scale);
		return path.toString() || null;
	}
	for (const [values, scale, color] of series)
		paths.append("path").attr("stroke", color)
			.attr("d", seriesPath(values, scale));

	const cursor = root.append("g").attr("class", "cursor").attr("display", "none")
		.attr("pointer-events", "none");
	const cursorLine = cursor.append("line").attr("stroke", "rgba(0,0,0,0.5)")
		.attr("stroke-width", 1 / pxRatio).attr("y1", plotTop).attr("y2", plotBottom);
	const markers = series.map(([, , color]) => cursor.append("circle").attr("r", 3).attr("fill", color));
	const overlay = root.append("rect").attr("class", "overlay")
		.attr("width", width).attr("height", height).attr("fill", "transparent")
		.attr("pointer-events", "all").node();

	return {
		update(nextTicks) {
			ticks = nextTicks;
			drawGrid();
			for (const [name, x] of [['pct', plotLeft - 8], ['mb', plotRight + 8]])
				axes.select(`.axis-${name}`).selectAll('text').data(ticks[name]).join('text')
					.attr('x', x).attr('y', ([y]) => y).text(([, label]) => label);
			xAxis.selectAll('line').data([[plotLeft, null], ...ticks.x]).join('line')
				.attr('stroke', '#000').attr('x1', ([x]) => x)
				.attr('x2', ([x], i) => i === 0 ? plotRight : x)
				.attr('y1', (_, i) => plotBottom + (i === 0 ? 0.5 : 0))
				.attr('y2', (_, i) => plotBottom + (i === 0 ? 0.5 : 5));
			xAxis.selectAll('text').data(ticks.x).join('text')
				.attr('x', ([x]) => x).attr('y', plotBottom + 7)
				.attr('dominant-baseline', 'text-before-edge').text(([, label]) => label);
			paths.selectAll('path').data(series)
				.attr('d', ([values, scale]) => seriesPath(values, scale));
		},
		overlay,
		// offsetX can be relative to an SVG child rather than the plotting surface.
		pointer: event => d3.pointer(event, svg)[0],
		clearCursor: () => cursor.attr("display", "none"),
		drawCursor(x, points) {
			cursor.attr("display", null);
			cursorLine.attr("x1", x).attr("x2", x);
			points.forEach(([y], i) => {
				markers[i].attr("display", y == null ? "none" : null)
					.attr("cx", x).attr("cy", y);
			});
		},
		destroy: () => root.remove(),
	};
}

const updates = new WeakMap();

function makeChartWithOptions(data, host, wait, runtimeOptions, {renderer = "canvas", minmax = false} = {}) {
	let [xs, cpu, ram, tcp] = data;
	const xScale = d3.scaleTime()
		.domain(xs.length ? [xs[0], xs[xs.length - 1]] : [0, 1])
		.range([plotLeft, plotRight]);
	const pctScale = d3.scaleLinear()
		.domain(xs.length ? [
			Math.min(d3.min(cpu), d3.min(ram)),
			Math.max(d3.max(cpu), d3.max(ram)),
		] : [0, 1])
		.nice()
		.range([plotBottom, plotTop]);
	const mbScale = d3.scaleLinear()
		.domain(xs.length ? d3.extent(tcp) : [0, 1])
		.nice()
		.range([plotBottom, plotTop]);
	const series = [[cpu, pctScale, "red"], [ram, pctScale, "blue"], [tcp, mbScale, "green"]];
	const line = d3.line()
		.defined(value => value != null)
		.x((value, i) => pxRound(xScale(xs[i])));
	const drawSeries = minmax ? (ctx, values, scale) => {
		if (values.length - 1 >= (plotRight - plotLeft) * pxRatio * 4)
			drawMinMax(ctx, xs, values, xScale, scale);
		else
			line.context(ctx).y(value => pxRound(scale(value)))(values);
	} : null;
	const surface = (renderer === "svg" ? svgRenderer : canvasRenderer)(
		host, line, series, axisTicks(xScale, pctScale, mbScale), drawSeries);
	const overlay = surface.overlay;

	const cpuValue = host.querySelector("#cpu-value");
	const ramValue = host.querySelector("#ram-value");
	const tcpValue = host.querySelector("#tcp-value");
	let pointerX = -1;
	let cursorFrame = null;
	let destroyed = false;

	function drawCursor() {
		cursorFrame = null;
		surface.clearCursor();

		if (!xs.length || pointerX < plotLeft || pointerX > plotRight)
			return;

		const idx = d3.bisectCenter(xs, +xScale.invert(pointerX));
		const x = pxRound(xScale(xs[idx]));
		surface.drawCursor(x, series.map(([values, scale, color]) => [
			values[idx] == null ? null : pxRound(scale(values[idx])), color,
		]));

		cpuValue.textContent = `CPU: ${cpu[idx] == null ? "--" : cpu[idx].toFixed(1) + "%"}`;
		ramValue.textContent = `RAM: ${ram[idx] == null ? "--" : ram[idx].toFixed(1) + "%"}`;
		tcpValue.textContent = `TCP Out: ${tcp[idx] == null ? "--" : tcp[idx].toFixed(2) + " MB"}`;
	}

	function pointerMove(event) {
		pointerX = surface.pointer(event);
		if (cursorFrame == null)
			cursorFrame = requestAnimationFrame(drawCursor);
	}

	function pointerLeave() {
		pointerX = -1;
		if (cursorFrame != null) {
			cancelAnimationFrame(cursorFrame);
			cursorFrame = null;
		}
		surface.clearCursor();
	}

	overlay.addEventListener("pointermove", pointerMove);
	overlay.addEventListener("pointerleave", pointerLeave);

	Promise.resolve().then(() => {
		if (!destroyed && wait)
			wait.textContent = "Done!";
	});

	const chart = {
		destroy() {
			updates.delete(chart);
			if (destroyed)
				return;
			destroyed = true;
			overlay.removeEventListener("pointermove", pointerMove);
			overlay.removeEventListener("pointerleave", pointerLeave);
			pointerLeave();
			surface.destroy();
		},
	};
	updates.set(chart, input => {
		[xs, cpu, ram, tcp] = input;
		xScale.domain(xs.length ? [xs[0], xs[xs.length - 1]] : [0, 1]);
		pctScale.domain(xs.length ? [Math.min(d3.min(cpu), d3.min(ram)), Math.max(d3.max(cpu), d3.max(ram))] : [0, 1]).nice();
		mbScale.domain(xs.length ? d3.extent(tcp) : [0, 1]).nice();
		[cpu, ram, tcp].forEach((values, i) => { series[i][0] = values; });
		pointerLeave();
		surface.update(axisTicks(xScale, pctScale, mbScale));
	});
	return chart;
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], [], []], host, wait);
}

function updateChart(chart, input, host, wait) {
	const update = updates.get(chart);
	if (!update) throw new Error('D3 chart is not live.');
	update(input);
	if (wait) wait.textContent = 'Done!';
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

export {makeChartWithOptions};
export {makeChart, prepData, makeEmptyChart, updateChart};
