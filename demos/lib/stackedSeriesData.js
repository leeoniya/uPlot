// Raw values shared by the stacked-series demo and the library comparisons.
export function createStackedSeriesData() {
	return [
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
		[4, 4, 5, 6, 5, 4, 4, 5, 6, 5,  4,  4,  5,  6,  5,  4,  5,  4,  4,  5,  4],
		[3, 3, 0, 0, 0, 3, 3, 3, 3, 3,  3,  3,  3,  3,  0,  0,  0,  3,  3,  3,  3],
		[3, 3, 3, 3, 3, 3, 0, 0, 0, 3,  3,  3,  3,  3,  0,  0,  0,  3,  3,  3,  3],
		[3, 3, 3, 3, 3, 3, 3, 3, 3, 3,  0,  0,  0,  3,  0,  0,  0,  3,  0,  3,  3],
	];
}

export const stackedSeries = [
	{label: 'A (base)', stroke: '#2563b8', fill: 'rgba(37, 99, 184, 0.18)'},
	{label: 'B (middle)', stroke: '#15803d', fill: 'rgba(21, 128, 61, 0.18)'},
	{label: 'C (middle)', stroke: '#d65c12', fill: 'rgba(214, 92, 18, 0.18)'},
	{label: 'D (top)', stroke: '#a21caf', fill: 'rgba(162, 28, 175, 0.18)'},
];

// Subtract from zero rather than using unary minus: a zero sample stays +0.
const negate = value => value == null ? value : 0 - value;
export function negativeStackData(data) {
	return [data[0].slice(), ...data.slice(1).map(row => row.map(negate))];
}

export function stackLayers(data) {
	return [1, -1].flatMap(dir => stackedSeries.map((series, i) => ({
		...series,
		label: dir > 0 ? series.label : `−${series.label}`,
		values: dir > 0 ? data[i + 1].slice() : data[i + 1].map(negate),
		dir,
		group: dir > 0 ? 'positive' : 'negative',
	})));
}

export const stackDimensions = {width: 1000, height: 440};
export const stackDomain = {x: [0, 20], y: [0, 16]};
export const strokeWidth = 3;
export const fillOpacity = 0.18;
