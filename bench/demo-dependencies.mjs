import {frameworkDependencies} from './framework-runtime.mjs';

export const demoDependencies = {
	uplot: [
		{path: '../dist/uPlot.iife.min.js'},
		{path: '../dist/uPlot.min.css', type: 'style'},
	],
	d3: [
		{name: 'd3', version: '7.9.0', path: 'dist/d3.min.js'},
	],
	chartjs: [
		{name: 'chart.js', version: '4.6.1', path: 'dist/chart.umd.min.js'},
		{name: '@date-fns/cdn', version: '4.4.0', path: 'cdn.min.js'},
		{name: 'chartjs-adapter-date-fns', version: '3.0.0', path: 'dist/chartjs-adapter-date-fns.min.js'},
	],
	echarts: [
		{name: 'echarts', version: '6.1.0', path: 'dist/echarts.min.js'},
	],
	flot: [
		// The production bundle includes the time plugin and requires jQuery 3.x.
		{name: 'jquery', version: '3.7.1', path: 'dist/jquery.min.js'},
		{name: 'flot', version: '4.2.6', path: 'dist/es5/jquery.flot.js'},
	],
	dygraphs: [
		{name: 'dygraphs', version: '2.2.2', path: 'dist/dygraph.min.js'},
		{name: 'dygraphs', version: '2.2.2', path: 'dist/dygraph.min.css', type: 'style'},
		{path: 'fmtDate.js'},
	],
	apexcharts: [
		{name: 'apexcharts', version: '8.4.1', path: 'dist/apexcharts.min.js'},
		{name: 'apexcharts', version: '8.4.1', path: 'dist/features/renderer-canvas.js'},
	],
	highcharts: [
		{name: 'highcharts', version: '13.1.1', path: 'highcharts.js'},
		{name: 'highcharts', version: '13.1.1', path: 'modules/boost.js'},
	],
	lightweight: [
		{name: 'lightweight-charts', version: '5.2.1', path: 'dist/lightweight-charts.standalone.production.js'},
	],
	plotly: [
		{name: 'plotly.js-dist-min', version: '4.1.2', path: 'plotly.min.js'},
	],
	canvasjs: [
		{name: '@canvasjs/charts', version: '3.17.8', path: 'canvasjs.min.js'},
	],
	zingchart: [
		{name: 'zingchart', version: '2.9.16-1', path: 'zingchart.min.js'},
	],
	amcharts: [
		{name: 'amcharts5-dist', version: '5.21.4', path: 'index.js', url: 'https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@5.21.4/index.js'},
		{name: 'amcharts5-dist', version: '5.21.4', path: 'xy.js', url: 'https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@5.21.4/xy.js'},
	],
	bokeh: [
		{name: '@bokeh/bokehjs', version: '3.10.1', path: 'build/js/bokeh.min.js'},
		{name: '@bokeh/bokehjs', version: '3.10.1', path: 'build/js/bokeh-gl.min.js'},
		{name: '@bokeh/bokehjs', version: '3.10.1', path: 'build/js/bokeh-api.min.js'},
	],
	d3fc: [
		{name: 'd3', version: '7.9.0', path: 'dist/d3.min.js'},
		{name: 'd3fc', version: '15.2.13', path: 'build/d3fc.min.js'},
	],
	deckgl: [
		{name: 'd3', version: '7.9.0', path: 'dist/d3.min.js'},
		{name: 'deck.gl', version: '9.4.0', path: 'dist.min.js'},
	],
	agcharts: [
		{name: 'ag-charts-community', version: '14.2.0', path: 'dist/umd/ag-charts-community.min.js'},
	],
	vega: [
		{name: 'vega', version: '6.4.0', path: 'build/vega.min.js'},
	],
	scichart: [
		{name: 'scichart', version: '6.0.14', path: 'index.min.js'},
		{name: 'scichart', version: '6.0.14', path: '_wasm/scichart.wasm', type: 'wasm', option: 'wasmBinary'},
		{name: 'scichart', version: '6.0.14', path: '_wasm/scichart-nosimd.wasm', type: 'wasm', option: 'wasmNoSimdBinary'},
	],
	lightningchart: [
		{name: '@lightningchart/lcjs', version: '9.0.0', path: 'dist/lcjs.iife.es2019.js'},
	],

	billboard: [
		{name: 'billboard.js', version: '4.1.3', path: 'dist/billboard.pkgd.min.js'},
		{name: 'billboard.js', version: '4.1.3', path: 'dist/billboard.min.css', type: 'style'},
	],
	g2: [
		{name: '@antv/g2', version: '5.4.8', path: 'dist/g2.min.js'},
	],
	syncfusion: [
		['base', '35.1.37'], ['data', '35.1.37'], ['svg-base', '35.1.37'],
		['buttons', '35.1.41'], ['popups', '35.1.39'], ['lists', '35.1.37'],
		['splitbuttons', '35.1.37'], ['inputs', '35.1.41'], ['calendars', '35.1.41'],
		['file-utils', '35.1.37'], ['compression', '35.1.37'], ['pdf-export', '35.1.37'],
		['notifications', '35.1.37'], ['navigations', '35.1.40'], ['excel-export', '35.1.37'],
		['charts', '35.1.41'],
	].map(([module, version]) => ({name: `@syncfusion/ej2-${module}`, version, path: `dist/global/ej2-${module}.min.js`})),
	devextreme: [
		{name: 'devextreme', version: '26.1.6', path: 'js/dx.viz.js', url: 'https://cdn3.devexpress.com/jslib/26.1.6/js/dx.viz.js'},
	],
	jscharting: [
		{name: 'jscharting', version: '3.4.0', path: 'dist/jscharting.js'},
	],
	kendo: [
		{name: 'jquery', version: '4.0.0', path: 'dist/jquery.min.js'},
		{name: '@progress/kendo-ui', version: '2026.3.1015', path: 'umd/kendo.dataviz.min.js'},
	],
	anychart: [
		{name: 'anychart', version: '9.0.0', path: 'dist/js/anychart-core.min.js'},
		{name: 'anychart', version: '9.0.0', path: 'dist/js/anychart-stock.min.js'},
	],
	fusiontime: [
		{name: 'fusioncharts', version: '4.2.3', path: 'fusioncharts.js'},
		{name: 'fusioncharts', version: '4.2.3', path: 'fusioncharts.timeseries.js'},
	],
	chartgpu: [
		{name: 'chartgpu', version: '0.4.0', path: 'index.mjs', type: 'module', global: 'benchmarkChartGPU',
			url: 'https://esm.sh/chartgpu@0.4.0?bundle&target=es2022'},
	],
	googlecharts: [
		// The loader is mutable; prepareRuntime requests frozen runtime release 52.
		{name: 'googlecharts', version: '52', path: 'loader.js', url: 'https://www.gstatic.com/charts/loader.js'},
	],
	...frameworkDependencies,
	idle: [],
};

// Keep vendor loading identical within each renderer comparison.
demoDependencies['d3-svg'] = demoDependencies.d3;
demoDependencies['plotly-svg'] = demoDependencies.plotly;
demoDependencies['highcharts-svg'] = demoDependencies.highcharts;
demoDependencies['bokeh-canvas'] = demoDependencies.bokeh;
demoDependencies['d3fc-canvas'] = demoDependencies.d3fc;
demoDependencies['g2-webgl'] = [
	...demoDependencies.g2,
	{name: '@antv/g-lite', version: '2.7.2', path: 'dist/index.umd.min.js'},
	{name: '@antv/g-webgl', version: '2.1.3', path: 'dist/index.umd.min.js'},
];

for (const id of ['apexcharts', 'amcharts', 'devextreme', 'anychart', 'fusiontime'])
	demoDependencies[id + '-sampled'] = demoDependencies[id];

// Explicit local imports let the CLI serve shared adapters without source parsing.
export const demoModuleDependencies = {
	recharts: ['lifecycle-frameworks'],
	muicharts: ['lifecycle-frameworks'],
	financialcharts: ['lifecycle-frameworks'],
	visx: ['lifecycle-frameworks'],
	'apexcharts-sampled': ['apexcharts'],
	'amcharts-sampled': ['amcharts'],
	'devextreme-sampled': ['devextreme'],
	'anychart-sampled': ['anychart'],
	'fusiontime-sampled': ['fusiontime'],
	'd3-svg': ['d3'],
	'plotly-svg': ['plotly'],
	'highcharts-svg': ['highcharts'],
	'bokeh-canvas': ['bokeh'],
	'd3fc-canvas': ['d3fc'],
	'g2-webgl': ['g2'],
};

// Presentation identity is independent of shared adapter/module dependencies.
const benchmarkLibraries = {
	'd3-svg': 'd3',
	'plotly-svg': 'plotly',
	'highcharts-svg': 'highcharts',
	'bokeh-canvas': 'bokeh',
	'd3fc-canvas': 'd3fc',
	'g2-webgl': 'g2',
	'apexcharts-sampled': 'apexcharts',
	'amcharts-sampled': 'amcharts',
	'devextreme-sampled': 'devextreme',
	'anychart-sampled': 'anychart',
	'fusiontime-sampled': 'fusiontime',
};

export function benchmarkLibraryName(variant) {
	return Object.hasOwn(benchmarkLibraries, variant) ? benchmarkLibraries[variant] : variant;
}

export const demoRestrictions = {
	lightningchart: 'Requires a vendor-issued runtime license key (LIGHTNINGCHART_LICENSE).',

};

export const benchmarkRestrictions = {
	'g2-webgl': 'Disabled after full-data benchmark timeouts, including with fill disabled. The standalone demo remains available.',
	googlecharts: 'Disabled after benchmark timeouts. The standalone demo remains available.',
	jscharting: 'JSCharting 3.4.0 retains destroyed charts and window listeners. Repeated samples accumulate hundreds of MB. The standalone demo remains available.',
};


// Keep execution order separate from the table, which sorts by measured total.
export const benchmarkVariants = [
	'uplot', 'chartjs', 'apexcharts', 'apexcharts-sampled', 'echarts', 'd3', 'd3-svg', 'flot', 'd3fc', 'd3fc-canvas', 'deckgl', 'financialcharts',
	'agcharts', 'dygraphs', 'anychart', 'anychart-sampled', 'visx', 'bokeh', 'bokeh-canvas', 'canvasjs', 'plotly', 'plotly-svg', 'lightweight',
	'muicharts', 'fusiontime', 'fusiontime-sampled', 'devextreme', 'devextreme-sampled', 'vega', 'highcharts', 'highcharts-svg', 'scichart', 'billboard',
	'g2', 'syncfusion', 'zingchart', 'amcharts', 'amcharts-sampled', 'recharts', 'kendo', 'chartgpu',
];

// Primary series renderer, not axes or support probes. Null contexts require runtime evidence.
// "none" means no configured sampling; it does not exclude undocumented vendor optimizations.
export const benchmarkMetadata = {
	uplot: {sampling: 'minmax', context: '2d', lossy: false},
	chartjs: {sampling: 'minmax', context: '2d', lossy: false},
	apexcharts: {sampling: 'none', context: '2d', lossy: false},
	'apexcharts-sampled': {sampling: 'LTTB (1920)', context: '2d', lossy: true},
	echarts: {sampling: 'minmax', context: '2d', lossy: false},
	d3: {sampling: 'none', context: '2d', lossy: false},
	'd3-svg': {sampling: 'none', context: 'svg', lossy: false},
	flot: {sampling: 'none', context: '2d', lossy: false},
	d3fc: {sampling: 'none', context: 'webgl', lossy: false},
	'd3fc-canvas': {sampling: 'none', context: '2d', lossy: false},
	deckgl: {sampling: 'none', context: 'webgl2', lossy: false},
	financialcharts: {sampling: 'none', context: '2d', lossy: false},
	agcharts: {sampling: 'aggregation', context: '2d', lossy: false},
	dygraphs: {sampling: 'none', context: '2d', lossy: false},
	anychart: {sampling: 'none', context: 'svg', lossy: false},
	'anychart-sampled': {sampling: 'avg (calendar)', context: 'svg', lossy: true},
	visx: {sampling: 'none', context: 'svg', lossy: false},
	bokeh: {sampling: 'none', context: 'webgl', lossy: false},
	'bokeh-canvas': {sampling: 'none', context: '2d', lossy: false},
	canvasjs: {sampling: 'none', context: '2d', lossy: false},
	plotly: {sampling: 'none', context: 'webgl', lossy: false},
	'plotly-svg': {sampling: 'simplify', context: 'svg', lossy: true},
	lightweight: {sampling: 'conflation', context: '2d', lossy: true},
	muicharts: {sampling: 'none', context: 'svg', lossy: false},
	fusiontime: {sampling: 'avg (1min)', context: 'svg', lossy: true},
	'fusiontime-sampled': {sampling: 'avg (calendar)', context: 'svg', lossy: true},
	devextreme: {sampling: 'none', context: 'svg', lossy: false},
	'devextreme-sampled': {sampling: 'avg (1px)', context: 'svg', lossy: true},
	vega: {sampling: 'none', context: '2d', lossy: false},
	highcharts: {sampling: 'pixel-distance', context: 'webgl', lossy: true},
	'highcharts-svg': {sampling: 'none', context: 'svg', lossy: false},
	// Auto matched explicit MinMax in the pinned native-output accuracy matrix.
		scichart: {sampling: 'minmax', context: null, lossy: false},
	billboard: {sampling: 'none', context: '2d', lossy: false},
	g2: {sampling: 'none', context: '2d', lossy: false},
	'g2-webgl': {sampling: 'none', context: null, lossy: false},
	syncfusion: {sampling: 'pixel-tolerance', context: '2d', lossy: true},
	zingchart: {sampling: 'none', context: '2d', lossy: false},
	amcharts: {sampling: 'none', context: '2d', lossy: false},
	'amcharts-sampled': {sampling: 'avg+distance', context: '2d', lossy: true},
	recharts: {sampling: 'none', context: 'svg', lossy: false},
	kendo: {sampling: 'none', context: '2d', lossy: false},
	chartgpu: {sampling: 'none', context: 'webgpu', lossy: false},
	googlecharts: {sampling: 'none', context: 'svg', lossy: false},
	jscharting: {sampling: 'none', context: 'svg', lossy: false},
	lightningchart: {sampling: 'grouping', context: null, lossy: null},
	idle: {sampling: 'none', context: null, lossy: false},
};

export function dependencyUrl(dependency, base) {
	return dependency.url ?? (dependency.name
		? `https://cdn.jsdelivr.net/npm/${dependency.name}@${dependency.version}/${dependency.path}`
		: new URL(dependency.path, base).href);
}

export function assertDemoAvailable(variant, lightningOptions) {
	if (!Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unknown demo variant: ${variant}`);

	if (variant === 'lightningchart' && (typeof lightningOptions?.license !== 'string' ||
		!lightningOptions.license.trim()))
		throw new Error(`lightningchart: ${demoRestrictions.lightningchart}`);
}

export function assertBenchmarkAvailable(variant, lightningOptions) {
	assertDemoAvailable(variant, lightningOptions);
	if (Object.hasOwn(benchmarkRestrictions, variant))
		throw new Error(`${variant}: ${benchmarkRestrictions[variant]}`);
}
