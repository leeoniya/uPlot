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
	show: true,
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

const decIncrs = [
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

export const timeIncrs = decIncrs.concat([
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

export function timeAxisStamps(stampCfg) {
	return stampCfg.map(s => [
		s[0],
		fmtDate(s[1]),
		s[2],
		fmtDate(s[4] ? s[1] + s[3] : s[3]),
	]);
}

const yyyy = "{YYYY}";
const NLyyyy = "\n" + yyyy;
const md = "{M}/{D}";
const NLmd = "\n" + md;

// [0]: minimum num secs in the tick incr
// [1]: normal tick format
// [2]: when a differing <x> is encountered - 1: sec, 2: min, 3: hour, 4: day, 5: week, 6: month, 7: year
// [3]: use a longer more contextual format
// [4]: modes: 0: replace [1] -> [3], 1: concat [1] + [3]
export const _timeAxisStamps = timeAxisStamps([
	[y,        yyyy,                 7,   "",       1],
	[d * 28,   "{MMM}",              7,   NLyyyy,   1],
	[d,        md,                   7,   NLyyyy,   1],
	[h,        "{h}{aa}",            4,   NLmd,     1],
	[m,        "{h}:{mm}{aa}",       4,   NLmd,     1],
	[s,        "{h}:{mm}:{ss}{aa}",  4,   NLmd,     1],
]);

// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
export function timeAxisVals(tzDate, stamps) {
	return (self, ticks, space) => {
		let incr = ticks[1] - ticks[0];

		// these track boundaries when a full label is needed again
		let prevYear = null;
		let prevDate = null;

		return ticks.map((tick, i) => {
			let date = tzDate(tick);

			let newYear = date[getFullYear]();
			let newDate = date[getDate]();

			let diffYear = newYear != prevYear;
			let diffDate = newDate != prevDate;

			let s = stamps.find(e => incr >= e[0]);
			let stamp = s[2] == 7 && diffYear || s[2] == 4 && diffDate ? s[3] : s[1];

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
	return (self, scaleMin, scaleMax, incr, pctSpace) => {
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
	return (self, val) => longDateHourMin(tzDate(val));
}

export const xAxisOpts = {
	show: true,
	scale: "x",
	space: 50,
	size: 53,
	side: 2,
//	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
	grid,
};

export const numSeriesLabel = "Value";
export const timeSeriesLabel = "Time";

export const xSeriesOpts = {
	show: true,
	scale: "x",
//	label: "Time",
//	value: v => stamp(new Date(v * 1e3)),

	// internal caches
	min: inf,
	max: -inf,
};

export const intIncrs = [1,2,5,10,20,50,1e2,2e2,5e2,1e3,2e3,5e3,1e4,2e4,5e4,1e5,2e5,5e5,1e6,2e6,5e6,1e7,2e7,5e7,1e8,2e8,5e8,1e9];

export const numIncrs = decIncrs.concat(intIncrs);

export function numAxisVals(self, ticks, space) {
	return ticks;
}

export function numAxisTicks(self, scaleMin, scaleMax, incr, pctSpace, forceMin) {
	scaleMin = forceMin ? scaleMin : round6(incrRoundUp(scaleMin, incr));

	let ticks = [];

	for (let val = scaleMin; val <= scaleMax; val = round6(val + incr))
		ticks.push(val);

	return ticks;
}

export function numSeriesVal(self, val) {
	return val;
}

export const yAxisOpts = {
	show: true,
	scale: "y",
	space: 40,
	size: 50,
	side: 3,
//	class: "y-vals",
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