// @bokeh/bokehjs@3.10.1: build/js/bokeh{,-gl,-api}.min.js, in that order; global Bokeh.
import {hoverTargets, nearHoverIndex, visibleText} from './hover.mjs';
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

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {outputBackend = 'webgl'} = {}) {
	const source = new Bokeh.ColumnDataSource({data});
	const pctRange = new Bokeh.DataRange1d();
	const mbRange = new Bokeh.DataRange1d();
	const plot = Bokeh.Plotting.figure({
		width: 1920,
		height: 600,
		sizing_mode: 'fixed',
		title: 'Server Events',
		output_backend: outputBackend,
		x_axis_type: 'datetime',
		y_axis_label: '%',
		y_range: pctRange,
		extra_y_ranges: {mb: mbRange},
		tools: 'pan,wheel_zoom,reset',
		// Draw complete lines; do not sample during interaction either.
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
		if (outputBackend === 'webgl' && (!view.canvas_view.webgl || renderers.some(renderer => !view.renderer_views.get(renderer)?.has_webgl)))
			throw new Error('Bokeh benchmark requires WebGL line rendering; Canvas fallback is not allowed.');
		// Expose the shared context for per-sample capture, including reused plots.
		view.getWebGLContexts = () => outputBackend !== 'webgl' || view.is_destroyed ? [] : [view.canvas_view.webgl.canvas.getContext('webgl')];
		if (wait) wait.textContent = 'Done!';
		return view;
	}
	catch (error) {
		disposePlot(plot, view);
		throw error;
	}
}

function makeEmptyChart(host, wait) {
	return makeChart(Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map(key => [key, new Float64Array(0)])), host, wait);
}

async function updateChart(view, input, host, wait) {
	if (view.is_destroyed) throw new Error('Bokeh chart is not live.');
	const renderer = view.model.renderers.find(renderer => renderer.data_source);
	renderer.data_source.data = input;
	await waitForReady(view);
	if (wait) wait.textContent = 'Done!';
}

async function resizeChart(view, {width, height}, host, wait) {
	if (view.is_destroyed) throw new Error('Bokeh chart is not live.');
	view.model.setv({width, height});
	await waitForReady(view);
	const bounds = view.el.getBoundingClientRect();
	if (view.model.width !== width || view.model.height !== height || bounds.width !== width || bounds.height !== height)
		throw new Error('Bokeh chart did not commit resized dimensions.');
	if (wait) wait.textContent = 'Done!';
}

async function waitForReady(view) {
	// 3.10.1 chains async glyph ingestion and throttled paints onto root.ready.
	// Ingestion can extend that chain while an earlier ready promise resolves.
	let ready;
	do {
		ready = view.ready;
		await ready;
	} while (ready !== view.ready);
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

// visibleText stops at a shadow root; tooltip hosts can be hidden independently.
function tooltipText(element) {
	for (let node = element; node; node = node.parentElement ?? node.getRootNode()?.host) {
		if (!node.isConnected) return '';
		const style = node.ownerDocument.defaultView.getComputedStyle(node);
		if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0)
			return '';
	}
	return visibleText(element);
}

export function getHoverPlan(chart, input, host) {
	if (chart.model.lod_threshold !== null)
		throw new Error('Bokeh hover requires unsampled lines.');
	const fields = ['cpu', 'ram', 'tcp'], names = ['CPU', 'RAM', 'TCP Out'];
	const renderers = fields.map(field => chart.model.renderers.find(renderer => renderer.glyph?.y.field === field));
	const views = renderers.map(renderer => chart.renderer_views.get(renderer));
	const hover = [...chart.tool_views.values()].find(view => view.model.type === 'HoverTool');
	const canvas = chart.canvas_view, rect = canvas.el.getBoundingClientRect();
	const sx = rect.width / canvas.bbox.width, sy = rect.height / canvas.bbox.height;
	const length = input.x.length, xScale = views[0].coordinates.x_scale;
	const tolerance = (length - 1) / (Math.abs(xScale.compute(input.x[length - 1]) - xScale.compute(input.x[0])) * sx);
	return {
		targets: hoverTargets(length, (index, seriesIndex) => ({
			x: rect.left + views[seriesIndex].coordinates.x_scale.compute(input.x[index]) * sx,
			y: rect.top + views[seriesIndex].coordinates.y_scale.compute(input[fields[seriesIndex]][index]) * sy,
		})),
		verify(target) {
			const {seriesIndex} = target, renderer = renderers[seriesIndex], glyph = views[seriesIndex].glyph;
			const selection = renderer.get_selection_manager().inspectors.get(renderer);
			const tooltip = hover.ttmodels.get(renderer), mouse = hover._current_sxy;
			if (chart.is_destroyed || !hover.model.active || !mouse || !tooltip?.visible || !tooltip.position || !selection?.line_indices.length)
				return null;
			// vline/nearest selects the closer x endpoint (ties go to the next).
			// With no filters, the last hit segment supplies the tooltip position.
			const segment = selection.line_indices.at(-1);
			const index = Math.abs(glyph.sx[segment] - mouse[0]) < Math.abs(glyph.sx[segment + 1] - mouse[0]) ? segment : segment + 1;
			const value = input[fields[seriesIndex]][index], data = renderer.data_source.data;
			if (!nearHoverIndex(index, target, tolerance) || !Number.isFinite(value) ||
				data.x[index] !== input.x[index] || data[fields[seriesIndex]][index] !== value ||
				glyph.x[index] !== input.x[index] || glyph.y[index] !== value ||
				tooltip.position[0] !== glyph.sx[index] || tooltip.position[1] !== glyph.sy[index])
				return null;
			// Each native tooltip entry is a table with Time, CPU, RAM, TCP rows.
			const table = tooltip.content.lastElementChild;
			const row = table?.children[seriesIndex + 1];
			const label = row?.querySelector('.bk-tooltip-row-label');
			const displayed = row?.querySelector('[data-value]');
			const expected = value.toFixed(seriesIndex === 0 ? 3 : 2) + (seriesIndex === 2 ? ' MB' : '%');
			if (!displayed || tooltipText(label) !== names[seriesIndex] + ':' || tooltipText(displayed) !== expected)
				return null;
			return {index, seriesIndex, value, text: tooltipText(row)};
		},
	};
}

export {prepData, makeChart, destroyChart, makeChartWithOptions, makeEmptyChart, updateChart, resizeChart};
