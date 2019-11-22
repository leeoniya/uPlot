import {
	fmtDate,
	getFullYear,
	getMonth,
	getDate,
	getHours,
	getMinutes,
	getSeconds,
} from './fmtDate';

import {
	inf,
	incrRoundUp,
	round6,
	floor,
} from './utils';

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
	mo = d * 30,
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
	d * 15,
	// year divisors (# months, approx)
	mo,
	mo * 2,
	mo * 3,
	mo * 4,
	mo * 6,
	// century divisors
	y,
	y * 2,
	y * 5,
	y * 10,
	y * 25,
	y * 50,
	y * 100,
]);

const timeAxisStamps = [
	[y,        "{YYYY}",               1,   "{YYYY}",                     ],
	[d * 28,   "{MMM}",                1,   "{MMM}\n{YYYY}",              ],
	[d,        "{M}/{D}",              1,   "{M}/{D}\n{YYYY}",            ],
	[h,        "{h}{aa}",              2,   "{h}{aa}\n{M}/{D}",           ],
	[m,        "{h}:{mm}{aa}",         2,   "{h}:{mm}{aa}\n{M}/{D}",      ],
	[s,        "{h}:{mm}:{ss}{aa}",    2,   "{h}:{mm}:{ss}{aa}\n{M}/{D}", ],
];

timeAxisStamps.forEach(s => {
	s[1] = fmtDate(s[1]);
	s[3] = fmtDate(s[3]);
});

// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
export function timeAxisVals(tzDate) {
	return (vals, space) => {
		let incr = vals[1] - vals[0];

		// these track boundaries when a full label is needed again
		let prevYear = null;
		let prevDate = null;

		return vals.map((val, i) => {
			let date = tzDate(val);

			let newYear = date[getFullYear]();
			let newDate = date[getDate]();

			let diffYear = newYear != prevYear;
			let diffDate = newDate != prevDate;

			let s = timeAxisStamps.find(e => incr >= e[0]);
			let stamp = s[2] == 1 && diffYear || s[2] == 2 && diffDate ? s[3] : s[1];

			prevYear = newYear;
			prevDate = newDate;

			return stamp(date);
		});
	}
}

function mkDate(y, m, d) {
	return new Date(y, m, d);
}

// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
// https://www.timeanddate.com/time/dst/
// https://www.timeanddate.com/time/dst/2019.html
export function timeAxisTicks(tzDate) {
	return (scaleMin, scaleMax, incr, pctSpace) => {
		let ticks = [];
		let isMo = incr >= mo && incr < y;

		// get the timezone-adjusted date
		let minDate = tzDate(scaleMin);
		let minDateTs = minDate / 1e3;

		// get ts of 12am (this lands us at or before the original scaleMin)
		let minMin = mkDate(minDate[getFullYear](), minDate[getMonth](), isMo ? 1 : minDate[getDate]());
		let minMinTs = minMin / 1e3;

		if (isMo) {
			let moIncr = incr / mo;
		//	let tzOffset = scaleMin - minDateTs;		// needed?
			let tick = minDateTs == minMinTs ? minDateTs : mkDate(minMin[getFullYear](), minMin[getMonth]() + moIncr, 1) / 1e3;
			let tickDate = new Date(tick * 1e3);
			let baseYear = tickDate[getFullYear]();
			let baseMonth = tickDate[getMonth]();

			for (let i = 0; tick <= scaleMax; i++) {
				let next = mkDate(baseYear, baseMonth + moIncr * i, 1);
				tick = next / 1e3;

				if (tick <= scaleMax)
					ticks.push(tick);
			}
		}
		else {
			let incr0 = incr >= d ? d : incr;
			let tzOffset = scaleMin - minDateTs;
			let tick = minMinTs + tzOffset + incrRoundUp(minDateTs - minMinTs, incr0);
			ticks.push(tick);

			let date0 = tzDate(tick);

			let prevHour = date0[getHours]() + (date0[getMinutes]() / m) + (date0[getSeconds]() / h);
			let incrHours = incr / h;

			while (1) {
				tick += incr;

				let expectedHour = floor(prevHour + incrHours) % 24;
				let tickDate = tzDate(tick);
				let actualHour = tickDate.getHours();

				let dstShift = actualHour - expectedHour;

				if (dstShift > 1)
					dstShift = -1;

				tick -= dstShift * h;

				if (tick > scaleMax)
					break;

				prevHour = (prevHour + incrHours) % 24;

				// add a tick only if it's further than 70% of the min allowed label spacing
				let prevTick = ticks[ticks.length - 1];
				let pctIncr = (tick - prevTick) / incr;

				if (pctIncr * pctSpace >= .7)
					ticks.push(tick);
			}
		}

		return ticks;
	}
}

let longDateHourMin = fmtDate('{YYYY}-{MM}-{DD} {h}:{mm}{aa}');

export function timeSeriesVal(tzDate) {
	return (val) => longDateHourMin(tzDate(val));
}

export const xAxisOpts = {
	show: true,
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

	// internal caches
	min: inf,
	max: -inf,
};

export const numIncrs = dec.concat([1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9]);

export function numAxisVals(vals, space) {
	return vals;
}

export function numAxisTicks(scaleMin, scaleMax, incr, pctSpace, forceMin) {
	scaleMin = forceMin ? scaleMin : round6(incrRoundUp(scaleMin, incr));

	let ticks = [];

	for (let val = scaleMin; val <= scaleMax; val = round6(val + incr))
		ticks.push(val);

	return ticks;
}

export function numSeriesVal(val) {
	return val;
}

export const yAxisOpts = {
	show: true,
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
	alpha: 1,
//	label: "Value",
//	value: v => v,
	values: null,

	// internal caches
	min: inf,
	max: -inf,

	path: null,
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