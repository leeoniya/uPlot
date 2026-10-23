// @bokeh/bokehjs@3.10.1: build/js/bokeh{,-gl,-api}.min.js, in that order; global Bokeh.
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
	const source = new Bokeh.ColumnDataSource({data});
	const pctRange = new Bokeh.DataRange1d();
	const mbRange = new Bokeh.DataRange1d();
	const plot = Bokeh.Plotting.figure({
		width: 1920,
		height: 600,
		sizing_mode: 'fixed',
		title: 'Server Events',
		output_backend: 'webgl',
		x_axis_type: 'datetime',
		y_axis_label: '%',
		y_range: pctRange,
		extra_y_ranges: {mb: mbRange},
		tools: 'pan,wheel_zoom,reset',
		// WebGL draws the complete lines; do not sample during interaction either.
		lod_threshold: null,
	});
	plot.yaxis.formatter = new Bokeh.PrintfTickFormatter({format: '%g%%'});
	plot.add_layout(new Bokeh.LinearAxis({
		y_range_name: 'mb',
		axis_label: 'MB',
		formatter: new Bokeh.PrintfTickFormatter({format: '%g MB'}),
	}), 'right');

	const renderers = ['cpu', 'ram', 'tcp'].map((field, i) => plot.line({
		x: {field: 'x'},
		y: {field},
		source,
		legend_label: ['CPU', 'RAM', 'TCP Out'][i],
		line_color: ['red', 'blue', 'green'][i],
		line_width: 1 / (globalThis.devicePixelRatio || 1),
		y_range_name: i === 2 ? 'mb' : 'default',
	}));
	// DataRange1d otherwise considers renderers on the other named range too.
	pctRange.renderers = renderers.slice(0, 2);
	mbRange.renderers = renderers.slice(2);
	plot.add_tools(new Bokeh.HoverTool({
		renderers,
		mode: 'vline',
		line_policy: 'nearest',
		tooltips: [
			['Time', '@x{%F %T}'],
			['CPU', '@cpu{0.000}%'],
			['RAM', '@ram{0.00}%'],
			['TCP Out', '@tcp{0.00} MB'],
		],
		formatters: {'@x': 'datetime'},
	}));

	let view;
	try {
		// In 3.10.1 show() resolves only after the document becomes idle.
		view = await Bokeh.Plotting.show(plot, host);
		if (!view.canvas_view.webgl || renderers.some(renderer => !view.renderer_views.get(renderer)?.has_webgl))
			throw new Error('Bokeh benchmark requires WebGL line rendering; Canvas fallback is not allowed.');
		// Expose the shared context for per-sample capture, including reused plots.
		view.getWebGLContexts = () => view.is_destroyed ? [] : [view.canvas_view.webgl.canvas.getContext('webgl')];
		if (wait) wait.textContent = 'Done!';
		return view;
	}
	catch (error) {
		disposePlot(plot, view);
		throw error;
	}
}

function disposePlot(plot, view) {
	const doc = plot.document;
	if (doc) {
		// show() creates a dedicated document, including a notifications view.
		doc.clear();
		doc.views_manager?.clear();
		const index = Bokeh.documents.indexOf(doc);
		if (index !== -1) Bokeh.documents.splice(index, 1);
	}
	if (view && !view.is_destroyed) view.remove();
	// Bokeh owns a shared WebGL context. Do not lose it or break other plots.
}

function destroyChart(view) {
	disposePlot(view.model, view);
}

export {prepData, makeChart, destroyChart};
