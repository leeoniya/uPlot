import {WIDTH, HEIGHT, SERIES, prepColumns, assertSeries} from './common.mjs';
import {destroyChart} from '../bokeh.mjs';
export {updateChart, destroyChart} from '../bokeh.mjs';
export const prepData = prepColumns;

function requireWebGL(view, renderers) {
	const webgl = view.canvas_view.webgl;
	// In 3.10.1 the shared initializer caches its result after awaiting module loading,
	// not its pending promise. Batched first-use can exhaust the context limit.
	if (!webgl)
		throw new Error('Bokeh dashboard WebGL initialization failed; concurrent first-use can exceed the browser context limit. Canvas fallback is not allowed.');
	const context = webgl.canvas.getContext('webgl');
	if (!context || context.isContextLost())
		throw new Error('Bokeh dashboard WebGL context is lost or unavailable; the dashboard may exceed the browser context limit.');
	if (renderers.some(renderer => !view.renderer_views.get(renderer)?.has_webgl))
		throw new Error('Bokeh dashboard requires WebGL lines; Canvas fallback is not allowed.');
}

export function makeChart(input, host, wait) {
	return makeChartWithOptions(input, host, wait);
}

export async function makeChartWithOptions(input, host, wait, {outputBackend = 'webgl'} = {}) {
	const source = new Bokeh.ColumnDataSource({data: input});
	const plot = Bokeh.Plotting.figure({
		width: WIDTH, height: HEIGHT, sizing_mode: 'fixed', output_backend: outputBackend,
		x_axis_type: 'datetime', lod_threshold: null,
	});
	let view;
	try {
		const renderers = SERIES.map(({id, label, color}) => plot.line({
			x: {field: 'x'}, y: {field: id}, source, legend_label: label,
			line_color: color, line_width: 1 / (globalThis.devicePixelRatio || 1),
		}));
		plot.add_tools(new Bokeh.HoverTool({
			renderers: [renderers[0]], mode: 'vline',
			tooltips: [['Time', '@x{%F %T}'], ...SERIES.map(({id, label}) => [label, `@${id}`])],
			formatters: {'@x': 'datetime'},
		}));
		plot.legend.orientation = 'horizontal';
		// Default-size labels need two rows at this tile width.
		plot.legend.ncols = 3;
		// Move the automatically created native legend out of the plot area.
		const legend = plot.legend;
		plot.center = plot.center.filter(item => item !== legend);
		plot.add_layout(legend, 'above');
		view = await Bokeh.Plotting.show(plot, host);
		if (outputBackend === 'webgl') requireWebGL(view, renderers);
		view.getWebGLContexts = () => outputBackend !== 'webgl' || view.is_destroyed ? [] : [view.canvas_view.webgl.canvas.getContext('webgl')];
		if (wait) wait.textContent = 'Done!';
		return view;
	}
	catch (error) {
		// The original teardown clears only this document/view, never the shared GL context.
		try { destroyChart(view ?? {model: plot, is_destroyed: true}); }
		finally { throw error; }
	}
}

export function validateChart(view, input, {rows}) {
	const renderers = view.model.renderers.filter(renderer => renderer.data_source);
	assertSeries(renderers.map(renderer => renderer.data_source.data[renderer.glyph.y.field]), rows);
	for (const {id} of SERIES) {
		const renderer = renderers.find(renderer => renderer.glyph.y.field === id);
		const data = renderer?.data_source.data;
		if (!data || renderer.glyph.type !== 'Line' || data.x.length !== rows || data[id].some((value, i) => data.x[i] !== input.x[i] || value !== input[id][i]))
			throw new Error('Bokeh dashboard data differs from its input.');
	}
	if (view.model.output_backend === 'webgl') requireWebGL(view, renderers);
}
