import { fmtDate } from './fmtDate';

//export const series = [];

// default formatters:

const grid = {
	color: "#eee",
	width: 1,
//	dash: [],
};

let m = 60,
	h = m * m,
	d = h * 24;

const timeIncrs = [
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
	// year divisors
	d * 365,
];

export const xOpts = {
	scale: 'x',
	space: 40,
	class: "x-time",
	incrs: timeIncrs,
	values: (vals, space) => {
		let incr = vals[1] - vals[0];

		let stamp = (
			incr >= d ? fmtDate('{M}/{DD}') :
			// {M}/{DD}/{YY} should only be prepended at 12a?		// {YY} only at year boundaries?
			incr >= h ? fmtDate('{M}/{DD}\n{h}{aa}') :
			incr >= m ? fmtDate('{M}/{DD}\n{h}:{mm}{aa}') :
			fmtDate('{M}/{DD}\n{h}:{mm}:{ss}{aa}')
		);

		return vals.map(val => stamp(new Date(val * 1e3)));
	},
	grid,
};

const numIncrs = [0.01,0.02,0.05,0.1,0.2,0.5,1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9];

export const yOpts = {
	scale: 'y',
	space: 30,
	class: "y-vals",
	incrs: numIncrs,
	values: (vals, space) => vals,
	grid,
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