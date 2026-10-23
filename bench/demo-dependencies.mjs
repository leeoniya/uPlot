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
	idle: [],
};
