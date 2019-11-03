import {
	fmtDate,
	getFullYear,
	getMonth,
	getDate,
} from './fmtDate';

//export const series = [];

// default formatters:

const grid = {
	color: "#eee",
	width: 2,
//	dash: [],
};

let s = 1,
	m = 60,
	h = m * m,
	d = h * 24,
	y = d * 365;

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
	y,
	y * 2,
	y * 5,
	y * 10,
	y * 25,
	y * 50,
	y * 100,
]);

const md = '{M}/{D}';
const yr = '{YYYY}';
const hr = '{h}';
const mm = ':{mm}';
const ss = ':{ss}';
const ampm = '{aa}';

const year = fmtDate(yr);
const monthDate = fmtDate(md);
const monthDateYear = fmtDate(md + '\n' + yr);

const _hour   = hr +           ampm;
const _minute = hr + mm +      ampm;
const _second = hr + mm + ss + ampm;

const hour =   fmtDate(_hour);
const minute = fmtDate(_minute);
const second = fmtDate(_second);

const md2 = '\n' + md;

const hourDate	= fmtDate(_hour   + md2);
const minDate	= fmtDate(_minute + md2);
const secDate	= fmtDate(_second + md2);

export function timeAxisVals(vals, space) {
	let self = this;
	let incr = vals[1] - vals[0];

	// these track boundaries when a full label is needed again
	let prevYear = null;
	let prevDate = null;

	return vals.map((val, i) => {
		let date = self.tzDate(val);

		let newYear = date[getFullYear]();
		let newDate = date[getDate]();

		let diffYear = newYear != prevYear;
		let diffDate = newDate != prevDate;

		let stamp;

		if (incr >= y)
			stamp = year;
		else if (incr >= d)
			stamp = diffYear ? monthDateYear : monthDate;
		else if (incr >= h)
			stamp = diffDate ? hourDate : hour;
		else if (incr >= m)
			stamp = diffDate ? minDate : minute;
		else if (incr >= s)
			stamp = diffDate ? secDate :  second;

		prevYear = newYear;
		prevDate = newDate;

		return stamp(date);
	});
}

let longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

export function timeSeriesVal(val) {
	return longDateHourMin(this.tzDate(val));
}

export const xAxisOpts = {
//	type: "t",		// t, n
	scale: 'x',
	space: 50,
	height: 53,
	side: 0,
	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
	grid,
};

export const numSeriesLabel = "Value";
export const timeSeriesLabel = "Time";

export const xSeriesOpts = {
//	type: "t",
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
//	type: "n",		// t, n
	scale: 'y',
	space: 40,
	width: 50,
	side: 1,
	class: "y-vals",
//	incrs: numIncrs,
//	values: (vals, space) => vals,
	grid,
};

export const ySeriesOpts = {
//	type: "n",
	scale: "y",
	show: true,
	band: false,
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