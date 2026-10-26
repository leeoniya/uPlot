import {SERIES} from './common.mjs';
import {handle, live, trackGL, checkGL, destroy, failedCreation, done, pixelRatio, countSeries, valuesEqual} from './custom-common.mjs';
import {frame, domains, canvas, PLOT_WIDTH, PLOT_HEIGHT} from './custom-d3-frame.mjs';

export const prepData = input => ({x: [...input.x], ys: input.ys.map(ys => [...ys])});

const pxRound = (value, ratio = pixelRatio()) => (Math.round(value * ratio) + 0.5) / ratio;

// Preserve first/min/max/last in each device-pixel column, including gap boundaries.
export function minmax(path, xs, ys, xScale, yScale, ratio) {
	const px = value => pxRound(value, ratio);
	let column, first, min, max, last, active = false, length = 0;
	const flush = () => {
		if (min !== max) {
			if (min !== first && min !== last) path.lineTo(column, px(yScale(min)));
			if (max !== first && max !== last) path.lineTo(column, px(yScale(max)));
			path.lineTo(column, px(yScale(last)));
		}
	};
	for (let i = 0; i < ys.length; i++) {
		const value = ys[i];
		if (value == null) {
			if (active) flush();
			if (length === 1) path.closePath();
			active = false; length = 0;
			continue;
		}
		const x = px(xScale(xs[i]));
		if (!active || x !== column) {
			if (active) flush();
			if (length === 0) path.moveTo(x, px(yScale(value)));
			else path.lineTo(x, px(yScale(value)));
			column = x; first = min = max = value; active = true;
		}
		else { min = Math.min(min, value); max = Math.max(max, value); }
		last = value; length++;
	}
	if (active) flush();
	if (length === 1) path.closePath();
}

export function family({renderer = 'canvas', useMinMax = false, fc: useFC = false} = {}) {
	function makeChart(input, host, wait) {
		const chart = handle(host, useFC ? `d3fc-${renderer}` : `d3-${renderer}`);
		Object.assign(chart, {renderer, useMinMax, series: []});
		try {
			frame(chart);
			if (renderer === 'svg') {
				const clip = `${chart.element.id}-clip`;
				chart.svg.append('defs').append('clipPath').attr('id', clip).append('rect')
					.attr('width', PLOT_WIDTH).attr('height', PLOT_HEIGHT);
				chart.paths = chart.axes.append('g').attr('clip-path', `url(#${clip})`).selectAll('path')
					.data(SERIES).join('path').attr('fill', 'none').attr('stroke', s => s.color).attr('stroke-width', 1 / pixelRatio());
			}
			else {
				const node = canvas(chart);
				chart.context = node.getContext(renderer === 'webgl' ? 'webgl' : '2d', {antialias: true, depth: false});
				if (!chart.context) throw new Error(`${chart.name}: ${renderer} context unavailable; check browser graphics/context limits.`);
				if (renderer === 'webgl') {
					trackGL(chart, chart.context, node, true);
					if (!chart.context.getExtension('ANGLE_instanced_arrays')) throw new Error('d3fc requires ANGLE_instanced_arrays.');
					chart.context.viewport(0, 0, node.width, node.height);
					chart.context.clearColor(0, 0, 0, 0);
				}
				else chart.context.scale(pixelRatio(), pixelRatio());
			}
			for (const {color} of SERIES) {
				let line;
				if (useFC) {
					if (!globalThis.fc) throw new Error('Dashboard requires d3fc@15.2.13.');
					if (renderer === 'canvas') line = fc.seriesCanvasLine().decorate(ctx => { ctx.strokeStyle = color; ctx.lineWidth = 1 / pixelRatio(); });
					else {
						const c = d3.color(color);
						const stroke = fc.webglStrokeColor().value([c.r / 255, c.g / 255, c.b / 255, 1]);
						line = fc.seriesWebglLine().pixelRatio(pixelRatio()).lineWidth(1 / pixelRatio())
							.scaleMapper(scale => ({scale: scale.copy(), webglScale: fc.webglScaleLinear().domain(scale.range())}))
							.equals((a, b) => a === b).decorate(program => stroke(program));
					}
					line.context(chart.context).xScale(chart.x).yScale(chart.y).mainValue(v => v);
				}
				else line = d3.line().defined(v => v != null).y(v => pxRound(chart.y(v)));
				chart.series.push(line);
			}
			updateChart(chart, input, host, wait);
			return chart;
		}
		catch (error) { failedCreation(chart, error, destroyChart); }
	}

	function updateChart(chart, input, host, wait) {
		live(chart);
		try {
			domains(chart, input);
			const bound = input.ys.map(values => ({x: input.x, values}));
			if (renderer === 'svg') chart.paths.data(bound);
			else d3.select(chart.canvas).datum(bound);
			if (renderer === 'webgl') chart.context.clear(chart.context.COLOR_BUFFER_BIT);
			else if (renderer === 'canvas') chart.context.clearRect(0, 0, PLOT_WIDTH, PLOT_HEIGHT);
			const draw = (data, i, path) => {
				const line = chart.series[i];
				if (useFC) line.crossValue((_, j) => data.x[j])(data.values);
				else if (useMinMax) minmax(path, data.x, data.values, chart.x, chart.y, pixelRatio());
				else line.x((_, j) => pxRound(chart.x(data.x[j]))).context(path)(data.values);
			};
			if (renderer === 'svg') chart.paths.attr('d', (data, i) => {
				const path = d3.path(); draw(data, i, path); return path.toString();
			});
			else d3.select(chart.canvas).datum().forEach((data, i) => {
				if (!useFC) { chart.context.beginPath(); chart.context.strokeStyle = SERIES[i].color; chart.context.lineWidth = 1 / pixelRatio(); }
				draw(data, i, chart.context);
				if (!useFC) chart.context.stroke();
			});
			if (renderer === 'webgl') { chart.context.flush(); checkGL(chart.context, chart.name); }
			done(wait);
		}
		catch (error) { chart.fail(error); throw error; }
	}

	function validateChart(chart, input, {rows}) {
		live(chart);
		// D3 and d3fc are immediate renderers: inspect the actual bound draw arguments.
		const bound = renderer === 'svg' ? chart.paths.data() : d3.select(chart.canvas).datum();
		countSeries(chart.series, rows, (_, i) => bound[i]?.values.length);
		countSeries(bound, rows, data => data.x.length);
		bound.forEach((data, i) => valuesEqual(data.values.length, j => data.x[j], j => data.values[j], input.x, input.ys[i]));
		return true;
	}
	function destroyChart(chart) {
		destroy(chart, chart.series.map(line => () => line.context(null)));
	}
	return {prepData, makeChart, updateChart, validateChart, destroyChart};
}
