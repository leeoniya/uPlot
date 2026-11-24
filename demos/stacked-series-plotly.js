import {stackLayers, stackDimensions, stackDomain, strokeWidth} from './lib/stackedSeriesData.js';

export function chartOptions(data) {
	const layers = stackLayers(data);
	return {
		data: layers.map((series, i) => ({
			name: series.label,
			type: 'scatter',
			mode: 'lines',
			x: Array.from(data[0]),
			y: Array.from(series.values),
			stackgroup: series.group,
			groupnorm: '',
			orientation: 'v',
			line: {color: series.stroke, width: strokeWidth, shape: 'linear', simplify: false},
			fill: layers[i - 1]?.group === series.group ? 'tonexty' : 'tozeroy',
			fillcolor: series.fill,
			hoverinfo: 'skip',
		})),
		layout: {
			width: stackDimensions.width,
			height: stackDimensions.height,
			autosize: false,
			margin: {l: 50, r: 20, t: 20, b: 40},
			showlegend: true,
						legend: {orientation: 'h', traceorder: 'normal'},
			hovermode: false,
			dragmode: false,
			transition: {duration: 0},
			xaxis: {
				type: 'linear',
				range: stackDomain.x.slice(),
				fixedrange: true,
				tick0: stackDomain.x[0],
				dtick: 2,
			},
			yaxis: {
				type: 'linear',
				range: [-stackDomain.y[1], stackDomain.y[1]],
				fixedrange: true,
				tick0: 0,
				dtick: 4,
			},
		},
		config: {
			staticPlot: true,
			displayModeBar: false,
			displaylogo: false,
			responsive: false,
			scrollZoom: false,
			doubleClick: false,
		},
	};
}

export async function createDemo(host, data, Plotly = globalThis.Plotly) {
	if (Plotly == null)
		throw new Error('Plotly.js did not load');

	const options = chartOptions(data);
	await Plotly.newPlot(host, options.data, options.layout, options.config);

	return {
		plot: host,
		destroy() {
			Plotly.purge(host);
		},
	};
}
