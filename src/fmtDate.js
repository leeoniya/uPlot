const months = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const days = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

function slice3(str) {
	return str.slice(0, 3);
}

const days3 = FEAT_TIME && days.map(slice3);

const months3 = FEAT_TIME && months.map(slice3);

const engNames = {
	MMMM: months,
	MMM:  months3,
	WWWW: days,
	WWW:  days3,
};

function zeroPad2(int) {
	return (int < 10 ? '0' : '') + int;
}

function zeroPad3(int) {
	return (int < 10 ? '00' : int < 100 ? '0' : '') + int;
}

/*
function suffix(int) {
	let mod10 = int % 10;

	return int + (
		mod10 == 1 && int != 11 ? "st" :
		mod10 == 2 && int != 12 ? "nd" :
		mod10 == 3 && int != 13 ? "rd" : "th"
	);
}
*/

export const getFullYear = 'getFullYear';
export const getMonth = 'getMonth';
export const getDate = 'getDate';
export const getDay = 'getDay';
export const getHours = 'getHours';
export const getMinutes = 'getMinutes';
export const getSeconds = 'getSeconds';
export const getMilliseconds = 'getMilliseconds';

const subs = {
	// 2019
	YYYY:	d => d[getFullYear](),
	// 19
	YY:		d => (d[getFullYear]()+'').slice(2),
	// July
	MMMM:	(d, names) => names.MMMM[d[getMonth]()],
	// Jul
	MMM:	(d, names) => names.MMM[d[getMonth]()],
	// 07
	MM:		d => zeroPad2(d[getMonth]()+1),
	// 7
	M:		d => d[getMonth]()+1,
	// 09
	DD:		d => zeroPad2(d[getDate]()),
	// 9
	D:		d => d[getDate](),
	// Monday
	WWWW:	(d, names) => names.WWWW[d[getDay]()],
	// Mon
	WWW:	(d, names) => names.WWW[d[getDay]()],
	// 03
	HH:		d => zeroPad2(d[getHours]()),
	// 3
	H:		d => d[getHours](),
	// 9 (12hr, unpadded)
	h:		d => {let h = d[getHours](); return h == 0 ? 12 : h > 12 ? h - 12 : h;},
	// AM
	AA:		d => d[getHours]() >= 12 ? 'PM' : 'AM',
	// am
	aa:		d => d[getHours]() >= 12 ? 'pm' : 'am',
	// a
	a:		d => d[getHours]() >= 12 ? 'p' : 'a',
	// 09
	mm:		d => zeroPad2(d[getMinutes]()),
	// 9
	m:		d => d[getMinutes](),
	// 09
	ss:		d => zeroPad2(d[getSeconds]()),
	// 9
	s:		d => d[getSeconds](),
	// 374
	fff:	d => zeroPad3(d[getMilliseconds]()),
};

export function fmtDate(tpl, names) {
	names = names || engNames;
	let parts = [];

	let R = /\{([a-z]+)\}|[^{]+/gi, m;

	while (m = R.exec(tpl))
		parts.push(m[0][0] == '{' ? subs[m[1]] : m[0]);

	return d => {
		let out = '';

		for (let i = 0; i < parts.length; i++)
			out += typeof parts[i] == "string" ? parts[i] : parts[i](d, names);

		return out;
	}
}

// https://stackoverflow.com/questions/15141762/how-to-initialize-a-javascript-date-to-a-particular-time-zone/53652131#53652131
export function tzDate(date, tz) {
	let date2;

	// perf optimization
	if (tz == 'Etc/UTC')
		date2 = new Date(+date + date.getTimezoneOffset() * 6e4);
	else {
		date2 = new Date(date.toLocaleString('en-US', {timeZone: tz}));
		date2.setMilliseconds(date[getMilliseconds]());
	}

	return date2;
}