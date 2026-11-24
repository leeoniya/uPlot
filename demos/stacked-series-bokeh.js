import {stackLayers, stackDimensions, stackDomain, strokeWidth, fillOpacity} from './lib/stackedSeriesData.js';

export function chartOptions(raw) {
	const layers = stackLayers(raw);
	const fields = {positive: [], negative: []};
	return {
		data: {x: Array.from(raw[0]), ...Object.fromEntries(layers.map(layer => [layer.label, Array.from(layer.values)]))},
		figure: {
			width: stackDimensions.width,
			height: stackDimensions.height,
			sizing_mode: 'fixed',
			output_backend: 'canvas',
			x_axis_type: 'linear',
			y_axis_type: 'linear',
			x_range: [...stackDomain.x],
			y_range: [-stackDomain.y[1], stackDomain.y[1]],
			tools: '',
			toolbar_location: null,
			lod_threshold: null,
		},
		layers: layers.map(({group, label, stroke}) => {
			fields[group].push(label);
			return {
				fields: fields[group].slice(),
				area: {name: label, fill_color: stroke, fill_alpha: fillOpacity},
				line: {name: label, line_color: stroke, line_width: strokeWidth, line_alpha: 1, line_dash: []},
			};
		}),
	};
}

export async function createDemo(host, data, Library = globalThis.Bokeh) {
	if (typeof Library?.Plotting?.figure !== 'function' || typeof Library?.Plotting?.show !== 'function' ||
		typeof Library?.ColumnDataSource !== 'function' || typeof Library?.Stack !== 'function' ||
				typeof Library?.Legend !== 'function' || typeof Library?.LegendItem !== 'function')
		throw new Error('Bokeh did not load');

	const root = host.ownerDocument.createElement('div');
	host.appendChild(root);
	let model, plot;
	function destroy() {
		const doc = model?.document;
		try {
			try { doc?.clear(); }
			finally {
				try { doc?.views_manager?.clear(); }
				finally {
					// show() owns a document and a notifications view, not only the plot view.
					const index = Library.documents?.indexOf(doc) ?? -1;
					if (index !== -1) Library.documents.splice(index, 1);
					if (plot && !plot.is_destroyed) plot.remove();
				}
			}
		}
		finally { root.remove(); }
	}

	try {
		const options = chartOptions(data);
		const source = new Library.ColumnDataSource({data: options.data});
		model = Library.Plotting.figure(options.figure);
		const items = [];
		for (const layer of options.layers) {
			const y1 = {expr: new Library.Stack({fields: layer.fields.slice(0, -1)})};
			const y2 = {expr: new Library.Stack({fields: layer.fields})};
			const area = model.varea({source, x: {field: 'x'}, y1, y2, ...layer.area});
			// Bokeh 3.10.1 VArea has fill/hatch visuals only. Use the same native Stack for its upper-edge line.
			const line = model.line({source, x: {field: 'x'}, y: y2, ...layer.line});
			items.push(new Library.LegendItem({label: {value: layer.area.name}, renderers: [area, line]}));
		}
		model.add_layout(new Library.Legend({items, orientation: 'horizontal', ncols: 4, location: 'center'}), 'below');
		// In 3.10.1 show() resolves after the document becomes idle, not just after view creation.
		plot = await Library.Plotting.show(model, root);
	}
	catch (error) {
		try { destroy(); }
		finally { throw error; }
	}

	return {plot, destroy};
}
