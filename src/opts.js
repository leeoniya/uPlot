import { fmtDate } from './fmtDate';

//export const series = [];

// default formatters:

const grid = {
	color: "#eee",
	width: 2,
//	dash: [],
};

let m = 60,
	h = m * m,
	d = h * 24;

const dec = [
	0.001,
	0.002,
	0.005,
	0.010,
	0.020,
	0.050,
	0.100,
	0.200,
	0.500,
];

export const timeIncrs = dec.concat([
	// minute divisors (# of secs)
	1,
	5,
	10,
	15,
	30,
	// hour divisors (# of mins)
	m,
	m * 5,
	m * 10,
	m * 15,
	m * 30,
	// day divisors (# of hrs)
	h,
	h * 2,
	h * 3,
	h * 4,
	h * 6,
	h * 8,
	h * 12,
	// month divisors TODO: need more?
	d,
	d * 2,
	d * 3,
	d * 4,
	d * 5,
	d * 6,
	d * 7,
	d * 8,
	d * 9,
	d * 10,
	// year divisors
	d * 365,
]);

const md = '{M}/{D}';
const hr = '{h}';
const mm = ':{mm}';
const ss = ':{ss}';
const ms = '.{fff}';
const ampm = '{aa}';

const mdhr = md + '\n' + hr;

const shortDate = fmtDate(md);
const shortDateHour = fmtDate(mdhr + ampm);
const shortDateHourMin = fmtDate(mdhr + mm + ampm);
const shortDateHourMinSec = fmtDate(mdhr + mm + ss + ampm);
const shortHourMinSecMilli = fmtDate(hr + mm + ss + ms + ampm);

export function timeAxisVals(vals, space) {
	let incr = vals[1] - vals[0];

	let stamp = (
		incr >= d ? shortDate :
		// {M}/{DD}/{YY} should only be prepended at 12a?		// {YY} only at year boundaries?
		incr >= h ? shortDateHour :
		incr >= m ? shortDateHourMin :
		incr >= 1 ? shortDateHourMinSec :
		shortHourMinSecMilli
	);

	return vals.map(val => stamp(new Date(val * 1e3)));
}

let longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

export function timeSeriesVal(val) {
	return longDateHourMin(new Date(val * 1e3));
}

export const xAxisOpts = {
	type: "t",		// t, n
	scale: 'x',
	space: 40,
	height: 30,
	side: 0,
	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
	grid,
};

export const numSeriesLabel = "Value";
export const timeSeriesLabel = "Time";

export const xSeriesOpts = {
	type: "t",
	scale: "x",
//	label: "Time",
//	value: v => stamp(new Date(v * 1e3)),
};

export const numIncrs = dec.concat([1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9]);

export function numAxisVals(vals, space) {
	return vals;
}

export function numSeriesVal(val) {
	return val;
}

export const yAxisOpts = {
	type: "n",		// t, n
	scale: 'y',
	space: 30,
	width: 50,
	side: 1,
	class: "y-vals",
//	incrs: numIncrs,
//	values: (vals, space) => vals,
	grid,
};

export const ySeriesOpts = {
	type: "n",
	scale: "y",
	shown: true,
//	label: "Value",
//	value: v => v,
};

/*
export const scales = {
	x: {
		min: Infinity,
		max: -Infinity,
	},
	y: {
		min: Infinity,
		max: -Infinity,
	},
};
*/