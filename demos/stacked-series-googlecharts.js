import {
	createStackedSeriesData,
	stackLayers,
	stackDimensions,
	stackDomain,
	strokeWidth,
	fillOpacity,
} from './lib/stackedSeriesData.js';

// AreaChart 52 adds the negative base to the positive total. A second target axis
// separates the strokes but not the fill baselines, so the parent mounts one chart per sign.
function panelLayers(raw) {
	const dir = raw.slice(1).some(row => row.some(value => value < 0)) ? -1 : 1;
	return stackLayers(raw).filter(layer => layer.dir === dir);
}

export function prepareData(raw = createStackedSeriesData(), layers = panelLayers(raw)) {
	const [xs, ...values] = raw;
	return [
		['X', ...layers.map(series => series.label)].map(label => ({type: 'number', label})),
		...Array.from(xs, (x, i) => [x, ...values.map(row => row[i])]),
	];
}

export function chartOptions(data = createStackedSeriesData()) {
	const layers = panelLayers(data);
	const limit = stackDomain.y[1];
	const min = layers[0].dir < 0 ? -limit : 0;
	return {
		data: prepareData(data, layers),
		options: {
			width: stackDimensions.width,
			height: stackDimensions.height,
			chartArea: {left: 50, top: 45, width: stackDimensions.width - 70, height: stackDimensions.height - 85},
			backgroundColor: 'transparent',
			fontName: 'system-ui, sans-serif',
			colors: layers.map(layer => layer.stroke),
			isStacked: true,
			lineWidth: strokeWidth,
			curveType: 'none',
			areaOpacity: fillOpacity,
			pointSize: 0,
			pointsVisible: false,
			legend: {position: 'top'},
			tooltip: {trigger: 'none'},
			enableInteractivity: false,
			animation: {startup: false, duration: 0},
			hAxis: {
				viewWindowMode: 'explicit',
				viewWindow: {min: stackDomain.x[0], max: stackDomain.x[1]},
				ticks: Array.from({length: 11}, (_, i) => i * 2),
				minorGridlines: {count: 0},
			},
			vAxis: {
				viewWindowMode: 'explicit',
				viewWindow: {min, max: min + limit},
				ticks: Array.from({length: limit / 2 + 1}, (_, i) => min + i * 2),
				minorGridlines: {count: 0},
			},
		},
	};
}

export async function createDemo(host, data = createStackedSeriesData(), Library = globalThis.google) {
	if (typeof Library?.charts?.load !== 'function')
		throw new Error('Google Charts did not load');

	let loadTimer;
	try {
		// The loader promise avoids a permanent setOnLoadCallback registration.
		await Promise.race([
			Library.charts.load('52', {packages: ['corechart']}),
			new Promise((_, reject) => {
				loadTimer = setTimeout(() => reject(new Error('Google Charts did not load')), 15000);
			}),
		]);
	}
	catch (error) {
		throw new Error('Google Charts did not load', {cause: error});
	}
	finally {
		clearTimeout(loadTimer);
	}

	const visualization = Library.visualization;
	if (typeof visualization?.AreaChart !== 'function' || typeof visualization.arrayToDataTable !== 'function' || visualization.events == null)
		throw new Error('Google Charts did not load');

	const config = chartOptions(data);
	const table = visualization.arrayToDataTable(config.data);
	const plot = new visualization.AreaChart(host);
	const listeners = [];
	let renderTimer;

	try {
		await new Promise((resolve, reject) => {
			listeners.push(visualization.events.addListener(plot, 'ready', resolve));
			listeners.push(visualization.events.addListener(plot, 'error', error => {
				reject(new Error(error.message || 'Google Charts could not render'));
			}));
			renderTimer = setTimeout(() => reject(new Error('Google Charts did not finish rendering')), 15000);
			plot.draw(table, config.options);
		});

		return {
			plot,
			destroy() {
				plot.clearChart();
			},
		};
	}
	catch (error) {
		plot.clearChart();
		throw error;
	}
	finally {
		clearTimeout(renderTimer);
		for (const listener of listeners)
			visualization.events.removeListener(listener);
	}
}
