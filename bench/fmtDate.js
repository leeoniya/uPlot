(function(window) {
	"use strict";

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

	const days3 = days.map(slice3);

	const months3 = months.map(slice3);

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

	const year = 'getFullYear';
	const month = 'getMonth';
	const date = 'getDate';
	const day = 'getDay';
	const hrs = 'getHours';
	const mins = 'getMinutes';
	const secs = 'getSeconds';
	const msecs = 'getMilliseconds';

	const subs = {
		// 2019
		YYYY:	d => d[year](),
		// 19
		YY:		d => (d[year]()+'').slice(2),
		// July
		MMMM:	d => months[d[month]()],
		// Jul
		MMM:	d => months3[d[month]()],
		// 07
		MM:		d => zeroPad2(d[month]()+1),
		// 7
		M:		d => d[month]()+1,
		// 09
		DD:		d => zeroPad2(d[date]()),
		// 9
		D:		d => d[date](),
		// Monday
		WWWW:	d => days[d[day]()],
		// Mon
		WWW:	d => days3[d[day]()],
		// 03
		HH:		d => zeroPad2(d[hrs]()),
		// 3
		H:		d => d[hrs](),
		// 9 (12hr, unpadded)
		h:		d => {let h = d[hrs](); return h == 0 ? 12 : h > 12 ? h - 12 : h;},
		// AM
		AA:		d => d[hrs]() >= 12 ? 'PM' : 'AM',
		// am
		aa:		d => d[hrs]() >= 12 ? 'pm' : 'am',
		// 09
		mm:		d => zeroPad2(d[mins]()),
		// 9
		m:		d => d[mins](),
		// 09
		ss:		d => zeroPad2(d[secs]()),
		// 9
		s:		d => d[secs](),
		// 374
		fff:	d => zeroPad3(d[msecs]()),
	};

	window.fmtDate = function(tpl) {
		let parts = [];

		let R = /\{([a-z]+)\}|[^{]+/yi, m;

		while (m = R.exec(tpl))
			parts.push(m[0][0] == '{' ? subs[m[1]] : m[0]);

		return d => {
			let out = '';

			for (let i = 0; i < parts.length; i++)
				out += typeof parts[i] == "string" ? parts[i] : parts[i](d);

			return out;
		}
	}
})(window);