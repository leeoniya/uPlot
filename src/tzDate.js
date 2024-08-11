
const localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;

// https://stackoverflow.com/questions/15141762/how-to-initialize-a-javascript-date-to-a-particular-time-zone/53652131#53652131
export function tzDate(date, tz) {
	let date2;

	// perf optimization
	if (tz == 'UTC' || tz == 'Etc/UTC')
		date2 = new Date(+date + date.getTimezoneOffset() * 6e4);
	else if (tz == localTz)
		date2 = date;
	else {
		date2 = new Date(date.toLocaleString('en-US', {timeZone: tz}));
		date2.setMilliseconds(date.getMilliseconds());
	}

	return date2;
}
