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
	console.time("prep");

	// epoch,idl,recv,send,read,writ,used,free
	const numFields = packed[0];
	packed = packed.slice(numFields + 1);

	const len = packed.length / numFields;
	const data = [Array(len), Array(len), Array(len), Array(len)];

	for (let i = 0, j = 0; i < packed.length; i += numFields, j++) {
		data[0][j] = packed[i] * 60 * 1000;
		data[1][j] = round3(100 - packed[i + 1]);
		data[2][j] = round2(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]));
		data[3][j] = packed[i + 3];
	}

	console.timeEnd("prep");
	return data;
}

function setupCanvas(canvas) {
	canvas.width = Math.round(width * pxRatio);
	canvas.height = Math.round(height * pxRatio);
	const ctx = canvas.getContext("2d");
	ctx.scale(pxRatio, pxRatio);
	return ctx;
}

function drawAxes(ctx, xScale, pctScale, mbScale) {
	ctx.font = "10px Arial";
	ctx.lineWidth = 1 / pxRatio;
	ctx.textBaseline = "middle";

	const pctTicks = pctScale.ticks(10);
	ctx.strokeStyle = "rgba(0,0,0,0.1)";
	ctx.beginPath();
	for (const tick of pctTicks) {
		const y = pxRound(pctScale(tick));
		ctx.moveTo(plotLeft, y);
		ctx.lineTo(plotRight, y);
	}
	ctx.stroke();

	ctx.fillStyle = "#000";
	ctx.strokeStyle = "#000";
	ctx.textAlign = "right";
	for (const tick of pctTicks) {
		const y = pctScale(tick);
		ctx.fillText(`${+tick.toFixed(1)}%`, plotLeft - 8, y);
	}

	ctx.textAlign = "left";
	for (const tick of mbScale.ticks(10))
		ctx.fillText(`${+tick.toFixed(2)} MB`, plotRight + 8, mbScale(tick));

	const xTicks = xScale.ticks(12);
	const xFormat = xScale.tickFormat(12);
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.beginPath();
	ctx.moveTo(plotLeft, plotBottom + 0.5);
	ctx.lineTo(plotRight, plotBottom + 0.5);
	for (const tick of xTicks) {
		const x = pxRound(xScale(tick));
		ctx.moveTo(x, plotBottom);
		ctx.lineTo(x, plotBottom + 5);
		ctx.fillText(xFormat(tick), x, plotBottom + 7);
	}
	ctx.stroke();
}

function makeChart(data, host, wait) {
	console.time("chart");

	const [xs, cpu, ram, tcp] = data;
	const xScale = d3.scaleTime()
		.domain([xs[0], xs[xs.length - 1]])
		.range([plotLeft, plotRight]);
	const pctScale = d3.scaleLinear()
		.domain([
			Math.min(d3.min(cpu), d3.min(ram)),
			Math.max(d3.max(cpu), d3.max(ram)),
		])
		.nice()
		.range([plotBottom, plotTop]);
	const mbScale = d3.scaleLinear()
		.domain(d3.extent(tcp))
		.nice()
		.range([plotBottom, plotTop]);

	const plotCtx = setupCanvas(host.querySelector("#plot"));
	const overlay = host.querySelector("#overlay");
	const overlayCtx = setupCanvas(overlay);
	const line = d3.line()
		.defined(value => value != null)
		.x((value, i) => pxRound(xScale(xs[i])))
		.context(plotCtx);

	drawAxes(plotCtx, xScale, pctScale, mbScale);

	plotCtx.save();
	plotCtx.beginPath();
	plotCtx.rect(plotLeft, plotTop, plotRight - plotLeft, plotBottom - plotTop);
	plotCtx.clip();
	plotCtx.lineWidth = 1 / pxRatio;

	for (const [values, scale, color] of [
		[cpu, pctScale, "red"],
		[ram, pctScale, "blue"],
		[tcp, mbScale, "green"],
	]) {
		line.y(value => pxRound(scale(value)));
		plotCtx.beginPath();
		line(values);
		plotCtx.strokeStyle = color;
		plotCtx.stroke();
	}
	plotCtx.restore();

	const cpuValue = host.querySelector("#cpu-value");
	const ramValue = host.querySelector("#ram-value");
	const tcpValue = host.querySelector("#tcp-value");
	let pointerX = -1;
	let framePending = false;

	function drawCursor() {
		framePending = false;
		overlayCtx.clearRect(0, 0, width, height);

		if (pointerX < plotLeft || pointerX > plotRight)
			return;

		const idx = d3.bisectCenter(xs, +xScale.invert(pointerX));
		const x = pxRound(xScale(xs[idx]));
		overlayCtx.strokeStyle = "rgba(0,0,0,0.5)";
		overlayCtx.lineWidth = 1 / pxRatio;
		overlayCtx.beginPath();
		overlayCtx.moveTo(x, plotTop);
		overlayCtx.lineTo(x, plotBottom);
		overlayCtx.stroke();

		for (const [value, scale, color] of [
			[cpu[idx], pctScale, "red"],
			[ram[idx], pctScale, "blue"],
			[tcp[idx], mbScale, "green"],
		]) {
			if (value != null) {
				overlayCtx.beginPath();
				overlayCtx.arc(x, pxRound(scale(value)), 3, 0, Math.PI * 2);
				overlayCtx.fillStyle = color;
				overlayCtx.fill();
			}
		}

		cpuValue.textContent = `CPU: ${cpu[idx] == null ? "--" : cpu[idx].toFixed(1) + "%"}`;
		ramValue.textContent = `RAM: ${ram[idx] == null ? "--" : ram[idx].toFixed(1) + "%"}`;
		tcpValue.textContent = `TCP Out: ${tcp[idx] == null ? "--" : tcp[idx].toFixed(2) + " MB"}`;
	}

	overlay.addEventListener("pointermove", event => {
		pointerX = event.offsetX;
		if (!framePending) {
			framePending = true;
			requestAnimationFrame(drawCursor);
		}
	});
	overlay.addEventListener("pointerleave", () => {
		pointerX = -1;
		overlayCtx.clearRect(0, 0, width, height);
	});

	Promise.resolve().then(() => {
		wait.textContent = "Done!";
		console.timeEnd("chart");
	});
}

export {makeChart, prepData};
