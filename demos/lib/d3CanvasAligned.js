import { rangeY, rangeYCount } from '../../src/rangeY.js';
import { numAxisSplits, numAxisVals } from '../../src/opts.js';

const margins = {top: 10, right: 100, bottom: 40, left: 100};

export function createD3CanvasAligned(d3, host, stats, data, size, { ramp = 1, exact = false, useUplot = false } = {}) {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	host.appendChild(canvas);

	let width = size.width;
	let height = size.height;
	let chartData, leftExtent, rightExtent;

	function setData(data) {
		chartData = data;
		leftExtent = d3.extent(data[1]);
		rightExtent = d3.extent(data[2]);
		draw();
	}

	function draw() {
		const pxRatio = devicePixelRatio;
		const plotLeft = margins.left;
		const plotRight = width - margins.right;
		const plotTop = margins.top;
		const plotBottom = height - margins.bottom;
		const plotHeight = plotBottom - plotTop;
		const tickCount = useUplot ? rangeYCount(plotHeight, ramp) : Math.max(1, Math.floor(plotHeight / 50));
		const pxRound = value => (Math.round(value * pxRatio) + 0.5) / pxRatio;
		const [xs, left, right] = chartData;

		canvas.width = Math.round(width * pxRatio);
		canvas.height = Math.round(height * pxRatio);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		ctx.scale(pxRatio, pxRatio);

		const xScale = d3.scaleLinear()
			.domain([xs[0], xs[xs.length - 1]])
			.range([plotLeft, plotRight]);
		function yAxis(extent) {
			const scale = d3.scaleLinear().range([plotBottom, plotTop]);
			if (useUplot) {
				const result = rangeY(extent[0], extent[1], plotHeight, undefined, ramp, exact);
				const ticks = result?.count > 0 ? (result.count == 1 ? [result.min, result.max] :
					numAxisSplits(null, 0, result.min, result.max, result.incr, 0, true)) : [];
				scale.domain(result?.count > 0 ? [result.min, result.max] : extent);
				return { scale, ticks, labels: numAxisVals(null, ticks, 0, 0, result?.incr) };
			}
			scale.domain(extent).nice(tickCount);
			const ticks = scale.ticks(tickCount);
			return { scale, ticks, labels: ticks.map(scale.tickFormat(tickCount)) };
		}

		const { scale: leftScale, ticks: leftTicks, labels: leftLabels } = yAxis(leftExtent);
		const { scale: rightScale, ticks: rightTicks, labels: rightLabels } = yAxis(rightExtent);

		ctx.font = '12px system-ui, sans-serif';
		ctx.lineWidth = 1 / pxRatio;
		ctx.textBaseline = 'middle';
		ctx.strokeStyle = 'rgba(0,0,0,0.1)';
		ctx.beginPath();
		for (const tick of leftTicks) {
			const y = pxRound(leftScale(tick));
			ctx.moveTo(plotLeft, y);
			ctx.lineTo(plotRight, y);
		}
		ctx.stroke();

		ctx.fillStyle = '#1769aa';
		ctx.textAlign = 'right';
		leftTicks.forEach((tick, i) => ctx.fillText(leftLabels[i], plotLeft - 8, leftScale(tick)));

		ctx.fillStyle = '#b34a00';
		ctx.textAlign = 'left';
		rightTicks.forEach((tick, i) => ctx.fillText(rightLabels[i], plotRight + 8, rightScale(tick)));

		const xTicks = xScale.ticks(10);
		const xFormat = xScale.tickFormat(10);
		ctx.fillStyle = '#000';
		ctx.strokeStyle = '#000';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.beginPath();
		ctx.moveTo(plotLeft, pxRound(plotBottom));
		ctx.lineTo(plotRight, pxRound(plotBottom));
		for (const tick of xTicks) {
			const x = pxRound(xScale(tick));
			ctx.moveTo(x, plotBottom);
			ctx.lineTo(x, plotBottom + 5);
			ctx.fillText(xFormat(tick), x, plotBottom + 7);
		}
		ctx.stroke();

		const line = d3.line()
			.defined(Number.isFinite)
			.x((value, i) => pxRound(xScale(xs[i])))
			.context(ctx);

		ctx.save();
		ctx.beginPath();
		ctx.rect(plotLeft, plotTop, plotRight - plotLeft, plotBottom - plotTop);
		ctx.clip();
		ctx.lineWidth = 1 / pxRatio;
		for (const [values, scale, color] of [
			[left, leftScale, '#1769aa'],
			[right, rightScale, '#b34a00'],
		]) {
			line.y(value => pxRound(scale(value)));
			ctx.beginPath();
			line(values);
			ctx.strokeStyle = color;
			ctx.stroke();
		}
		ctx.restore();

		const fmt = value => value == null ? 'none' : Number(value.toPrecision(6)).toString();
		const lines = [`Plot height: ${plotHeight}px | ${useUplot ? 'uPlot ranging' : 'D3 nice()'} | tick count hint: ${tickCount}`];
		for (const [key, scale, ticks] of [['left', leftScale, leftTicks], ['right', rightScale, rightTicks]]) {
			const domain = scale.domain();
			lines.push(`${key}: ${ticks.length} ticks | ${fmt(domain[0])} … ${fmt(domain[1])} | increment ${fmt(ticks.length > 1 ? ticks[1] - ticks[0] : null)}`);
		}
		stats.textContent = lines.join('\n');
	}

	setData(data);

	return {
		setData,
		setSize(size) {
			width = size.width;
			height = size.height;
			draw();
		},
		setRanging(options) {
			const changed = options.useUplot != useUplot || options.useUplot && (options.ramp != ramp || options.exact != exact);
			({ ramp, exact, useUplot } = options);
			if (changed)
				draw();
		},
		destroy() {
			canvas.remove();
		},
	};
}
