import {
	FEAT_TIME,
} from './feats';
import { abs, floor } from './utils';

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

const subs = {
	// 2019
	YYYY:	d => d.getFullYear(),
	// 19
	YY:		d => (d.getFullYear()+'').slice(2),
	// July
	MMMM:	(d, names) => names.MMMM[d.getMonth()],
	// Jul
	MMM:	(d, names) => names.MMM[d.getMonth()],
	// 07
	MM:		d => zeroPad2(d.getMonth()+1),
	// 7
	M:		d => d.getMonth()+1,
	// 09
	DD:		d => zeroPad2(d.getDate()),
	// 9
	D:		d => d.getDate(),
	// Monday
	WWWW:	(d, names) => names.WWWW[d.getDay()],
	// Mon
	WWW:	(d, names) => names.WWW[d.getDay()],
	// 03
	HH:		d => zeroPad2(d.getHours()),
	// 3
	H:		d => d.getHours(),
	// 9 (12hr, unpadded)
	h:		d => {let h = d.getHours(); return h == 0 ? 12 : h > 12 ? h - 12 : h;},
	// AM
	AA:		d => d.getHours() >= 12 ? 'PM' : 'AM',
	// am
	aa:		d => d.getHours() >= 12 ? 'pm' : 'am',
	// a
	a:		d => d.getHours() >= 12 ? 'p' : 'a',
	// 09
	mm:		d => zeroPad2(d.getMinutes()),
	// 9
	m:		d => d.getMinutes(),
	// 09
	ss:		d => zeroPad2(d.getSeconds()),
	// 9
	s:		d => d.getSeconds(),
	// 374
	fff:	d => zeroPad3(d.getMilliseconds()),

	// this really only makes sense for DateZoned
	// -05:00
	tzo:    d => {
		let o = d.getTimezoneOffset();
		let s = o > 0 ? '-' : '+';
		o = abs(o);
		let hh = zeroPad2(floor(o / 60));
		let mm = zeroPad2(o % 60);
		return `${s}${hh}:${mm}`;
	}
};

// export const iso8601 = fmtDate('{YYYY}-{MM}-{DD}T{HH}:{mm}:{ss}.{fff}{tzo}');

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

const localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;

export function tzDate(date, tz) {
	if (tz == localTz)
		return date;

	let d = new DateZoned(date);
	d.setTimeZone(tz);
	return d;
}

const twoDigit = '2-digit';

const fmtrOpts = {
    weekday: "short",
    year: 'numeric',
    month: twoDigit,
    day: twoDigit,
    hour: twoDigit,
    minute: twoDigit,
    second: twoDigit,
    fractionalSecondDigits: 3,
    timeZoneName: 'longOffset',
};

const tzFmt = {};

function getFormatter(tz) {
    if (tzFmt[tz] == null)
        tzFmt[tz] = new Intl.DateTimeFormat("sv", {...fmtrOpts, timeZone: tz}).format;

    return tzFmt[tz];
}

export class DateZoned extends Date {
	tz = null;
	#utc = false;
	// sön, 1972-10-15 17:25:23,434 GMT+01:00
    #str = null;

	constructor(...args) {
		super(...args);

		if (args[0] instanceof DateZoned) {
			this.tz  = args[0].tz;
			this.#str = args[0].#str;
			this.#utc = args[0].#utc;
		}
	}

    #get(utcMeth, locMeth, fr, to, add = 0) {
        let s = this.#str;
        return this.#utc ? utcMeth.call(this) : s == null ? locMeth.call(this) : Number(s.slice(fr,to)) + add;
    }

    setTimeZone(tz) {
		this.tz = tz;

        if (tz == 'UTC' || tz == 'Etc/UTC')
            this.#utc = true;
        else {
            let fmt = getFormatter(tz);
			let f = fmt(this);

            if (f.endsWith('GMT'))
                f += '+00:00';

            this.#str = f;
        }
    }

	getFullYear() {
        return this.#get(this.getUTCFullYear, super.getFullYear, -33, -29);
    }

	getMonth() {
        return this.#get(this.getUTCMonth, super.getMonth, -28, -26, -1);
    }

	getDate() {
        return this.#get(this.getUTCDate, super.getDate, -25, -23);
    }

	getHours() {
        return this.#get(this.getUTCHours, super.getHours, -22, -20);
    }

	getMinutes() {
        return this.#get(this.getUTCMinutes, super.getMinutes, -19, -17);
    }

	getSeconds() {
        return this.#get(this.getUTCSeconds, super.getSeconds, -16, -14);
    }

	getMilliseconds() {
        return this.#get(this.getUTCMilliseconds, super.getMilliseconds, -13, -10);
    }

	getDay() {
		let s = this.#str;
        return this.#utc ? this.getUTCDay() : s == null ? super.getDay() : (
			s[0] == 's' ? 0 : // sön
			s[0] == 'm' ? 1 : // mån
			s[1] == 'i' ? 2 : // tis
			s[0] == 'o' ? 3 : // ons
			s[1] == 'o' ? 4 : // tors
			s[0] == 'f' ? 5 : // fre
			s[0] == 'l' ? 6 : // lör
			-1
		);
    }

    getTimezoneOffset() {
        let s = this.#str;
        return this.#utc ? 0 : s == null ? super.getTimezoneOffset() : (60 * Number(s.slice(-5,-3)) + Number(s.slice(-2))) * (s.at(-6) == '-' ? -1 : 1);
    }

	getDayOfYear() {
		let y = this.getFullYear();
		let m = this.getMonth() + 1;
		let d = this.getDate();

		// https://stackoverflow.com/a/27790471
		return --m*31-(m>1?(1054267675>>m*3-6&7)-(y&3||!(y%25)&&y&15?0:1):0)+d;
	}
}

// these can be done through just incrRoundDn of 1e3 or 60 * 1e3
// export const PERIOD_SECOND = 0;
// export const PERIOD_MINUTE = 1;

// this might be needed for tzs where DST is not whole hours?
// otherwise incrRoundDn of 3600 * 1e3
// export const PERIOD_HOUR = 2;

// thse need special handling due to day length changing due to DST
export const PERIOD_DAY = 3;
export const PERIOD_MONTH = 4;
export const PERIOD_YEAR = 5;
// export const PERIOD_WEEK;

// get start of period, requires DateZoned and period const
export function getSOP(dz, per) {
	let ts = dz.getTime();

	// initial guess (assumes no DST)
	let ts2 = ts - (
		dz.getMilliseconds()       +
		dz.getSeconds()      * 1e3 +
		dz.getMinutes() * 60 * 1e3 +
		dz.getHours() * 3600 * 1e3 +
		(
			(
				per == PERIOD_MONTH ? dz.getDate() - 1:
				per == PERIOD_YEAR  ? dz.getDayOfYear() - 1:
				0
			)
			* 24 * 3600 * 1e3
		)
	);

	let dz2 = new DateZoned(ts2);
	dz2.setTimeZone(dz.tz);

	let h2 = dz2.getHours();

	// we want hours to be 0
	if (h2 > 0) {
		let dstAdj = h2 > 12 ? 24 - h2 : -h2;
		dz2 = new DateZoned(ts2 + dstAdj * 3600 * 1e3);
		dz2.setTimeZone(dz.tz);
	}

	return dz2;
}

/*
let fmt = fmtDate('{YYYY}-{MM}-{DD}T{HH}:{mm}:{ss}.{fff}{tzo}');

{
	let d = new DateZoned(1554274800000); // post-roll date
	d.setTimeZone('Europe/London');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}

{
	let d = new DateZoned(1554274800000); // post-roll date
	d.setTimeZone('America/Chicago');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}

{
	let d = new DateZoned(1554004800000); // few hours after london spring forward
	d.setTimeZone('Europe/London');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}

{
	let d = new DateZoned(1572156000000); // few hours after london fall back
	d.setTimeZone('Europe/London');
	let sod = getSOP(d, PERIOD_DAY);
	console.log(sod.getTime() / 1e3);
	console.log(fmt(sod));
}
*/


/*
TODO:

2024 - leap year
  start of year before feb vs after
  start of month in dst fwd month / bwd month
  start of day in dst fwd day / bwd day

Australia/Darwin

variable month widths

simplify dstShift ?
handle isYr, isMo properly

ensure ms 0.001 is accounted for
*/