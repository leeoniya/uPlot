// Globals d3 and deck: d3@7.9.0/dist/d3.min.js and deck.gl@9.4.0/dist.min.js.
const replacements = new WeakMap();
const pendingRenders = new WeakMap();
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

async function makeChart(data, host, wait) {
	const width = 1920;
	const height = 600;
	const margin = {left: 70, right: 80, top: 60, bottom: 40};
	const plotWidth = width - margin.left - margin.right;
	const plotHeight = height - margin.top - margin.bottom;
	const ratio = globalThis.devicePixelRatio || 1;
	const element = host.ownerDocument.createElement('div');
	Object.assign(element.style, {position: 'relative', width: `${width}px`, height: `${height}px`});
	host.append(element);
	const chart = {
		element, context: null, deck: null, svg: null, canvas: null, destroyed: false, error: null,
		getWebGLContexts() {
			return this.context && !this.context.isContextLost() ? [this.context] : [];
		},
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

		// External contexts are not automatically resized by Deck's animation loop.
		const canvas = chart.canvas = d3.select(element).append('canvas')
			.attr('width', Math.round(plotWidth * ratio)).attr('height', Math.round(plotHeight * ratio))
			.style('position', 'absolute')
			.style('left', `${margin.left}px`).style('top', `${margin.top}px`)
			.style('width', `${plotWidth}px`).style('height', `${plotHeight}px`);
		const gl = chart.context = canvas.node().getContext('webgl2', {antialias: true, depth: false});
		if (!gl)
			throw new Error('deck.gl benchmark requires WebGL2.');

		const svg = chart.svg = d3.select(element).append('svg')
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

		// Project timestamps in double precision before uploading screen coordinates.
		// Leave PathLayer normalization and connected-line tessellation to deck.gl.
		const makeLayers = () => values.map((column, i) => {
			const path = new Float64Array(data.x.length * 2);
			for (let j = 0; j < data.x.length; j++) {
				path[j * 2] = x(data.x[j]);
				path[j * 2 + 1] = scales[i](column[j]);
			}
			const color = d3.color(colors[i]);
			return new deck.PathLayer({
				id: `series-${i}`, data: data.x.length ? [path] : [], getPath: path => path,
				positionFormat: 'XY', coordinateSystem: deck.COORDINATE_SYSTEM.CARTESIAN,
				getColor: [color.r, color.g, color.b, 255],
				widthUnits: 'pixels', getWidth: 1 / ratio, widthMinPixels: 0,
				pickable: false, parameters: {depthCompare: 'always', depthWriteEnabled: false},
			});
		});

		const layers = makeLayers();

		const cursor = axes.append('g').attr('display', 'none').attr('pointer-events', 'none');
		const rule = cursor.append('line').attr('y1', 0).attr('y2', plotHeight).attr('stroke', 'rgba(0,0,0,0.5)');
		const dots = cursor.selectAll('circle').data(values).join('circle')
			.attr('r', 3).attr('fill', (_, i) => colors[i]);
		svg.on('pointermove.benchmark', event => {
			const [sx, sy] = d3.pointer(event, svg.node());
			if (!data.x.length || sx < margin.left || sx > margin.left + plotWidth || sy < margin.top || sy > margin.top + plotHeight) {
				cursor.attr('display', 'none');
				return;
			}
			const j = d3.bisectCenter(data.x, +x.invert(sx - margin.left));
			const cx = x(data.x[j]);
			cursor.attr('display', null);
			rule.attr('x1', cx).attr('x2', cx);
			dots.attr('cx', cx).attr('cy', (column, i) => scales[i](column[j]));
			legend.text((name, i) => `${name}: ${values[i][j].toFixed(i === 0 ? 3 : 2)}${i === 2 ? ' MB' : '%'}`);
		}).on('pointerleave.benchmark', () => cursor.attr('display', 'none'));

		replacements.set(chart, input => {
			data = input;
			values = [data.cpu, data.ram, data.tcp];
			x.domain(data.x.length ? d3.extent(data.x) : [0, 1]);
			pct.domain(data.x.length ? [
				Math.min(d3.min(data.cpu), d3.min(data.ram)),
				Math.max(d3.max(data.cpu), d3.max(data.ram)),
			] : [0, 1]).nice();
			mb.domain(data.x.length ? d3.extent(data.tcp) : [0, 1]).nice();
			grid.call(d3.axisLeft(pct).ticks(10).tickSize(-plotWidth).tickFormat(''))
				.call(group => group.select('.domain').remove())
				.call(group => group.selectAll('line').attr('stroke', 'rgba(0,0,0,0.1)'));
			xAxis.call(d3.axisBottom(x).ticks(12));
			pctAxis.call(d3.axisLeft(pct).ticks(10).tickFormat(value => `${value}%`));
			mbAxis.call(d3.axisRight(mb).ticks(10).tickFormat(value => `${value} MB`));
			dots.data(values);
			cursor.attr('display', 'none');
			legend.text(name => name);
			// Stable layer IDs let Deck transfer native layer state on setProps.
			return makeLayers();
		});

		let ready = false;
		let initialError;
		await new Promise((resolve, reject) => {
			const onError = error => {
				if (chart.destroyed) return;
				chart.error ??= error;
				if (ready) {
					const pending = pendingRenders.get(chart);
					if (pending) { pending.reject(error); return; }
					throw error;
				}
				initialError ??= error;
				reject(error);
			};
			canvas.on('webglcontextlost.benchmark', () => onError(new Error('deck.gl WebGL2 context was lost.')));
			chart.deck = new deck.Deck({
				canvas: canvas.node(), width: plotWidth, height: plotHeight,
				// Public in 9.x, though deprecated: attaching gl prevents backend fallback.
				gl, useDevicePixels: ratio,
				views: new deck.OrthographicView({id: 'plot', flipY: true}),
				viewState: {target: [plotWidth / 2, plotHeight / 2, 0], zoom: 0},
				controller: false, layers,
				onError,
				onAfterRender({gl: renderedGL}) {
					if (chart.destroyed || (ready && !pendingRenders.has(chart))) return;
					try {
						if (renderedGL !== gl || gl.isContextLost())
							throw new Error('deck.gl did not render with the supplied WebGL2 context.');
						gl.flush();
						if (gl.getError() !== gl.NO_ERROR)
							throw new Error('deck.gl WebGL2 initial draw failed.');
						if (ready) pendingRenders.get(chart).resolve();
						else resolve();
					}
					catch (error) {
						onError(error);
					}
				},
			});
		});
		// Also catch an error reported in the same turn after the first render.
		if (initialError) throw initialError;
		ready = true;
		if (wait) wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try {
			destroyChart(chart);
		}
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'deck.gl rendering and cleanup failed.', {cause: error});
		}
		throw error;
	}
}

function makeEmptyChart(host, wait) {
	return makeChart(Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(0)])), host, wait);
}

async function updateChart(chart, input, host, wait) {
	if (chart.error) throw chart.error;
	if (chart.destroyed) throw new Error('deck.gl is disposed.');
	try {
		await new Promise((resolve, reject) => {
			pendingRenders.set(chart, {resolve, reject});
			chart.deck.setProps({layers: replacements.get(chart)(input)});
			chart.deck.redraw(true);
		});
		if (chart.error) throw chart.error;
		if (wait) wait.textContent = 'Done!';
	}
	finally { pendingRenders.delete(chart); }
}

function destroyChart(chart) {
	if (!chart || chart.destroyed) return;
	chart.destroyed = true;
	pendingRenders.get(chart)?.reject(new Error('deck.gl was disposed before replacement completed.'));
	pendingRenders.delete(chart);
	replacements.delete(chart);
	const errors = [];
	const cleanup = fn => { try { fn(); } catch (error) { errors.push(error); } };
	cleanup(() => chart.svg?.on('.benchmark', null));
	cleanup(() => chart.canvas?.on('.benchmark', null));
	cleanup(() => chart.deck?.finalize());
	cleanup(() => chart.context?.getExtension('WEBGL_lose_context')?.loseContext());
	cleanup(() => chart.element.remove());
	chart.deck = chart.context = chart.svg = chart.canvas = null;
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'deck.gl cleanup failed.');
}

export {makeEmptyChart, updateChart};
export {prepData, makeChart, destroyChart};
