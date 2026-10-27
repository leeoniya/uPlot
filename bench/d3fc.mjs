import {hoverTargets, visibleText, nearHoverIndex} from './hover.mjs';

// d3@7.9.0/dist/d3.min.js then d3fc@15.2.13/build/d3fc.min.js; globals d3 and fc.
function prepData(packed) {
	const fields = packed[0];
	const count = (packed.length - fields - 1) / fields;
	const data = Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(count)]));

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data.x[j] = packed[i] * 60000;
		data.cpu[j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		data.ram[j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		data.tcp[j] = packed[i + 3];
	}

	return data;
}

const updates = new WeakMap();
const resizes = new WeakMap();
const hovers = new WeakMap();

function getHoverPlan(chart, input, host) {
	const hover = hovers.get(chart);
	if (!hover) throw new Error('d3fc chart is not live.');
	return hover(input);
}

function updateChart(chart, input, host, wait) {
	const update = updates.get(chart);
	if (!update) throw new Error('d3fc chart is not live.');
	update(input);
	if (wait) wait.textContent = 'Done!';
}

function resizeChart(chart, {width, height}, host, wait) {
	const resize = resizes.get(chart);
	if (!resize) throw new Error('d3fc chart is not live.');
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 150 || height <= 100)
		throw new Error('d3fc resize dimensions must leave a positive plot area.');
	resize({width, height});
	if (wait) wait.textContent = 'Done!';
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {renderer = 'webgl'} = {}) {
	const width = 1920;
	const height = 600;
	const margin = {left: 70, right: 80, top: 60, bottom: 40};
	let plotWidth = width - margin.left - margin.right;
	let plotHeight = height - margin.top - margin.bottom;
	const ratio = globalThis.devicePixelRatio || 1;
	const element = host.ownerDocument.createElement('div');
	Object.assign(element.style, {position: 'relative', width: `${width}px`, height: `${height}px`});
	host.append(element);
	const chart = {
		element, renderer, context: null, series: [],
		getWebGLContexts() { return this.renderer === 'webgl' && this.context ? [this.context] : []; },
	};

	try {
		const x = d3.scaleTime().domain(data.x.length ? d3.extent(data.x) : [0, 1]).range([0, plotWidth]);
		const pct = d3.scaleLinear().domain(data.x.length ? [
			Math.min(d3.min(data.cpu), d3.min(data.ram)),
			Math.max(d3.max(data.cpu), d3.max(data.ram)),
		] : [0, 1]).nice().range([plotHeight, 0]);
		const mb = d3.scaleLinear().domain(data.x.length ? d3.extent(data.tcp) : [0, 1]).nice().range([plotHeight, 0]);
		const colors = ['red', 'blue', 'green'];
		let values = [data.cpu, data.ram, data.tcp];
		const scales = [pct, pct, mb];

		const canvas = d3.select(element).append('canvas')
			.attr('width', Math.round(plotWidth * ratio))
			.attr('height', Math.round(plotHeight * ratio))
			.style('position', 'absolute')
			.style('left', `${margin.left}px`).style('top', `${margin.top}px`)
			.style('width', `${plotWidth}px`).style('height', `${plotHeight}px`);
		let gl;
		if (renderer === 'canvas') {
			const context = chart.context = canvas.node().getContext('2d');
			if (!context)
				throw new Error('d3fc Canvas benchmark requires a 2D canvas context.');
			context.scale(ratio, ratio);
		}
		else {
			gl = chart.context = canvas.node().getContext('webgl', {antialias: true, depth: false});
			if (!gl || !gl.getExtension('ANGLE_instanced_arrays'))
				throw new Error('d3fc benchmark requires WebGL with ANGLE_instanced_arrays.');
			gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
		}

		const svg = d3.select(element).append('svg')
			.attr('width', width).attr('height', height)
			.style('position', 'absolute').style('left', '0px').style('top', '0px')
			.style('font', '12px Arial, sans-serif');
		svg.append('text').attr('x', width / 2).attr('y', 20)
			.attr('text-anchor', 'middle').attr('font-weight', 'bold').text('Server Events');
		const legend = svg.append('g').selectAll('text').data(['CPU', 'RAM', 'TCP Out']).join('text')
			.attr('x', (_, i) => margin.left + i * 230).attr('y', 43)
			.attr('fill', (_, i) => colors[i]).text(name => name);
		const axes = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
		const grid = axes.append('g').call(d3.axisLeft(pct).ticks(10).tickSize(-plotWidth).tickFormat(''))
			.call(group => group.select('.domain').remove())
			.call(group => group.selectAll('line').attr('stroke', 'rgba(0,0,0,0.1)'));
		const xAxis = axes.append('g').attr('transform', `translate(0,${plotHeight})`).call(d3.axisBottom(x).ticks(12));
		const pctAxis = axes.append('g').call(d3.axisLeft(pct).ticks(10).tickFormat(value => `${value}%`));
		const mbAxis = axes.append('g').attr('transform', `translate(${plotWidth},0)`)
			.call(d3.axisRight(mb).ticks(10).tickFormat(value => `${value} MB`));

		// The default time mapper subtracts Date.now(), still too far from this
		// historical data for Float32. Project through D3 in double precision,
		// using d3fc's public scaleMapper API, then upload screen coordinates.
		const scaleMapper = scale => ({
			scale: scale.copy(),
			webglScale: fc.webglScaleLinear().domain(scale.range()),
		});
		for (let i = 0; i < values.length; i++) {
			let series;
			if (renderer === 'canvas') {
				series = fc.seriesCanvasLine().decorate(context => {
					context.strokeStyle = colors[i];
					context.lineWidth = 1 / ratio;
				});
			}
			else {
				const color = d3.color(colors[i]);
				const stroke = fc.webglStrokeColor().value([color.r / 255, color.g / 255, color.b / 255, 1]);
				series = fc.seriesWebglLine().pixelRatio(ratio).lineWidth(1 / ratio)
					.scaleMapper(scaleMapper).equals((previous, next) => previous === next)
					.decorate(program => stroke(program));
			}
			series.context(chart.context).xScale(x).yScale(scales[i])
				.crossValue((_, j) => data.x[j]).mainValue(value => value);
			chart.series.push(series);
			// WebGL line draws use length - 1 segments; zero points is not a draw.
			if (values[i].length) series(values[i]);
		}

		let displayedIndex = null;
		let hoverVersion = 0;
		const cursor = axes.append('g').attr('display', 'none').attr('pointer-events', 'none');
		const rule = cursor.append('line').attr('y1', 0).attr('y2', plotHeight).attr('stroke', 'rgba(0,0,0,0.5)');
		const dots = cursor.selectAll('circle').data(values).join('circle')
			.attr('r', 3).attr('fill', (_, i) => colors[i]);
		svg.on('pointermove.benchmark', event => {
			const [sx, sy] = d3.pointer(event, svg.node());
			if (!data.x.length || sx < margin.left || sx > margin.left + plotWidth || sy < margin.top || sy > margin.top + plotHeight) {
				displayedIndex = null;
				cursor.attr('display', 'none');
				return;
			}
			const j = d3.bisectCenter(data.x, +x.invert(sx - margin.left));
			const cx = x(data.x[j]);
			cursor.attr('display', null);
			rule.attr('x1', cx).attr('x2', cx);
			dots.attr('cx', cx).attr('cy', (column, i) => scales[i](column[j]));
			legend.text((name, i) => `${name}: ${values[i][j].toFixed(i === 0 ? 3 : 2)}${i === 2 ? ' MB' : '%'}`);
			displayedIndex = j;
			hoverVersion++;
		}).on('pointerleave.benchmark', () => {
			displayedIndex = null;
			cursor.attr('display', 'none');
		});

		hovers.set(chart, input => {
			const rect = svg.node().getBoundingClientRect();
			const previousVersion = hoverVersion;
			const tolerance = (data.x.length - 1) / plotWidth;
			const cells = legend.nodes();
			return {
				targets: hoverTargets(data.x.length, (index, seriesIndex) => ({
					x: Math.round(rect.left + margin.left + x(data.x[index])),
					y: Math.round(rect.top + margin.top + Math.max(1, Math.min(plotHeight - 1,
						scales[seriesIndex](values[seriesIndex][index])))),
				})),
				verify(target) {
					const {seriesIndex} = target;
					const index = displayedIndex;
					if (!hovers.has(chart) || input !== data || hoverVersion === previousVersion ||
						!nearHoverIndex(index, target, tolerance)) return null;
					const value = values[seriesIndex][index];
					if (!Number.isFinite(value)) return null;
					const expected = `${['CPU', 'RAM', 'TCP Out'][seriesIndex]}: ${value.toFixed(seriesIndex === 0 ? 3 : 2)}${seriesIndex === 2 ? ' MB' : '%'}`;
					const text = visibleText(cells[seriesIndex]);
					return text === expected ? {index, seriesIndex, value, text} : null;
				},
			};
		});

		updates.set(chart, input => {
			data = input;
			values = [data.cpu, data.ram, data.tcp];
			x.domain(data.x.length ? d3.extent(data.x) : [0, 1]);
			pct.domain(data.x.length ? [Math.min(d3.min(data.cpu), d3.min(data.ram)), Math.max(d3.max(data.cpu), d3.max(data.ram))] : [0, 1]).nice();
			mb.domain(data.x.length ? d3.extent(data.tcp) : [0, 1]).nice();
			redraw();
		});

		function redraw() {
			displayedIndex = null;
			grid.call(d3.axisLeft(pct).ticks(10).tickSize(-plotWidth).tickFormat(''))
				.call(group => group.select('.domain').remove())
				.call(group => group.selectAll('line').attr('stroke', 'rgba(0,0,0,0.1)'));
			xAxis.call(d3.axisBottom(x).ticks(12));
			pctAxis.call(d3.axisLeft(pct).ticks(10).tickFormat(value => `${value}%`));
			mbAxis.call(d3.axisRight(mb).ticks(10).tickFormat(value => `${value} MB`));
			cursor.attr('display', 'none');
			dots.data(values);
			legend.text(name => name);
			if (gl) gl.clear(gl.COLOR_BUFFER_BIT);
			else chart.context.clearRect(0, 0, plotWidth, plotHeight);
			chart.series.forEach((series, i) => { if (values[i].length) series(values[i]); });
			if (gl) {
				gl.flush();
				if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
					throw new Error('d3fc WebGL update failed.');
			}
		}

		resizes.set(chart, ({width, height}) => {
			plotWidth = width - margin.left - margin.right;
			plotHeight = height - margin.top - margin.bottom;
			Object.assign(element.style, {width: `${width}px`, height: `${height}px`});
			canvas.attr('width', Math.round(plotWidth * ratio)).attr('height', Math.round(plotHeight * ratio))
				.style('width', `${plotWidth}px`).style('height', `${plotHeight}px`);
			if (gl) gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
			else chart.context.setTransform(ratio, 0, 0, ratio, 0, 0);
			x.range([0, plotWidth]);
			pct.range([plotHeight, 0]);
			mb.range([plotHeight, 0]);
			svg.attr('width', width).attr('height', height);
			svg.select('text').attr('x', width / 2);
			xAxis.attr('transform', `translate(0,${plotHeight})`);
			mbAxis.attr('transform', `translate(${plotWidth},0)`);
			rule.attr('y2', plotHeight);
			redraw();
		});

		// Both native series draw synchronously. No d3fc-element redraw queue
		// or animation is used here.
		if (gl) {
			gl.flush();
			if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR)
				throw new Error('d3fc WebGL initial draw failed.');
		}
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		destroyChart(chart);
		throw error;
	}
}

function destroyChart(chart) {
	updates.delete(chart);
	resizes.delete(chart);
	hovers.delete(chart);
	d3.select(chart.element).select('svg').on('.benchmark', null);
	for (const series of chart.series) series.context(null);
	chart.series.length = 0;
	// d3fc has no chart-level disposer; this context belongs only to this chart.
	if (chart.renderer === 'webgl')
		chart.context?.getExtension('WEBGL_lose_context')?.loseContext();
	chart.context = null;
	chart.element.remove();
}

export {prepData, makeChart, destroyChart, makeChartWithOptions, updateChart, resizeChart, getHoverPlan};
