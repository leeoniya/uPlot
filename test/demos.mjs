const demos = [
	'axis-control',
	'area-fill',
	'missing-data',
	'line-paths',
	'points',
	'path-gap-clip',
	'thin-bars-stroke-fill',
	'high-low-bands',
	'custom-scales',
	'decimation',
	'dependent-scale',
	'sparklines-bars',
	'wind-direction',
	'trendlines',
	'gradients',
	'scale-padding',
	'scales-dir-ori',
	'no-data',
	'arcsinh-scales',
	'multi-bars',
	'box-whisker',
	'timezones-dst',
	'months',
	'months-ru',
	'grid-over-series',
	'bars-grouped-stacked',
	'candlestick-ohlc',
	'annotations',
	'soft-minmax',
	'nearest-non-null',
	'log-scales2',
	'stacked-series',
];

export const pluginDemos = [
	'multi-bars',
	'box-whisker',
	'bars-grouped-stacked',
	'candlestick-ohlc',
	'annotations',
];

export const coreDemos = demos.filter(name => !pluginDemos.includes(name));

export default demos;
