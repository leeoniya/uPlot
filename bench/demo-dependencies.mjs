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
	lightningchart: [
		{name: '@lightningchart/lcjs', version: '9.0.0', path: 'dist/lcjs.iife.es2019.js'},
	],

	idle: [],
};

export const demoRestrictions = {
	lightningchart: 'Requires a vendor license and prior written permission for performance comparisons (EULA Article XXIV).',

};

// Keep execution order separate from the table, which sorts by measured total.
export const benchmarkVariants = ['uplot', 'chartjs', 'd3', 'echarts', 'flot', 'dygraphs',
	'apexcharts', 'highcharts', 'lightweight', 'plotly', 'canvasjs', 'zingchart', 'amcharts'];

export function dependencyUrl(dependency, base) {
	return dependency.url ?? (dependency.name
		? `https://cdn.jsdelivr.net/npm/${dependency.name}@${dependency.version}/${dependency.path}`
		: new URL(dependency.path, base).href);
}

export function assertDemoAvailable(variant, lightningOptions) {
	if (!Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unknown demo variant: ${variant}`);

	if (variant === 'lightningchart' && (typeof lightningOptions?.license !== 'string' ||
		!lightningOptions.license.trim() || lightningOptions.benchmarkPermission !== true))
		throw new Error(`lightningchart: ${demoRestrictions.lightningchart} Supply a license and explicit benchmark permission before running.`);
}
