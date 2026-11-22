import { plotStep } from './renderDemo.js';

let ms = .001;
let msi = ms * 1e3;

// Jan 1 2024 UTC
let start = 1704067200 * msi;

let times = [];

for (let h = 0; h < 366 * 24 + 1; h++)
	times.push(start + h * 3600 * msi);

let values = Array(times.length);

for (let i = 0; i < times.length; i++)
	values[i] = i % 24 == 0 ? 1 : 0;

let data0 = [
	times,
	values,
];

function sliceRange(fromTs, numDays) {
	return [
		times.slice(fromTs, fromTs + 24 * numDays + 1),
		values.slice(fromTs, fromTs + 24 * numDays + 1),
	];
}


function genOpts(title, tz, syncKey) {
	return {
		title: title,
		tzDate: ts => uPlot.tzDate(ts / ms, tz),
		ms,
		cursor: {
			sync: {
				key: syncKey,
				setSeries: true,
			},
		},
		width: 600,
		height: 200,
		scales: {
			y: {
				range: [0, 1]
			}
		},
		axes: [
			{},
			{
				incrs: [0.5],
			},
		],
		series: [
			{},
			{
				label: "2024",
				stroke: "red",
			},
		],
	}
}

const sliceRange2 = (ts, days) => {
	let d = sliceRange(times.findIndex(v => v == ts * msi), days);
	d[1] = d[1].map(v => 0.5);
	return d;
};

function createStep(sectionId, createPlot) {
	return plotStep(() => {
		const container = document.getElementById(sectionId) ?? document.body;
		return createPlot(container);
	});
}

const groups = [
	{
		steps: [
			createStep('london-spring-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1711800000 * msi), 2);
				let syncKey = 0;

				return new uPlot(
					genOpts("UTC (no DST)", 'Etc/UTC', syncKey),
					data,
					c
				);
			}),
			createStep('london-spring-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1711800000 * msi), 2);
				let syncKey = 0;

				return new uPlot(
					genOpts("Europe/London (Mar 31, 2024: 1am -> 2am)", 'Europe/London', syncKey),
					data,
					c
				);
			}),
			createStep('london-spring-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1711800000 * msi), 2);
				let syncKey = 0;

				return new uPlot(
					genOpts("America/Chicago (no DST switch in this range)", 'America/Chicago', syncKey),
					data,
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('london-fall-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1729944000 * msi), 2);
				let syncKey = 1;

				return new uPlot(
					genOpts("UTC (no DST)", 'Etc/UTC', syncKey),
					data,
					c
				);
			}),
			createStep('london-fall-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1729944000 * msi), 2);
				let syncKey = 1;

				return new uPlot(
					genOpts("Europe/London (Oct 27, 2024: 2am -> 1am)", 'Europe/London', syncKey),
					data,
					c
				);
			}),
			createStep('london-fall-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1729944000 * msi), 2);
				let syncKey = 1;

				return new uPlot(
					genOpts("America/Chicago (no DST switch in this range)", 'America/Chicago', syncKey),
					data,
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('chicago-spring-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1709985600 * msi), 2);
				let syncKey = 2;

				return new uPlot(
					genOpts("UTC (no DST)", 'Etc/UTC', syncKey),
					data,
					c
				);
			}),
			createStep('chicago-spring-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1709985600 * msi), 2);
				let syncKey = 2;

				return new uPlot(
					genOpts("America/Chicago (Mar 10, 2024: 2am -> 3am)", 'America/Chicago', syncKey),
					data,
					c
				);
			}),
			createStep('chicago-spring-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1709985600 * msi), 2);
				let syncKey = 2;

				return new uPlot(
					genOpts("Europe/London (no DST switch in this range)", 'Europe/London', syncKey),
					data,
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('chicago-fall-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1730548800 * msi), 2);
				let syncKey = 3;

				return new uPlot(
					genOpts("UTC (no DST)", 'Etc/UTC', syncKey),
					data,
					c
				);
			}),
			createStep('chicago-fall-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1730548800 * msi), 2);
				let syncKey = 3;

				return new uPlot(
					genOpts("America/Chicago (Nov 3, 2024: 2am -> 1am)", 'America/Chicago', syncKey),
					data,
					c
				);
			}),
			createStep('chicago-fall-range', c => {
				let data = sliceRange(times.findIndex(v => v == 1730548800 * msi), 2);
				let syncKey = 3;

				return new uPlot(
					genOpts("Europe/London (no DST switch in this range)", 'Europe/London', syncKey),
					data,
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("1h ticks", tz, syncKey),
					sliceRange2(start, 0.3),
					c
				);
			}),
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("2h ticks", tz, syncKey),
					sliceRange2(start, 0.5),
					c
				);
			}),
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("3h ticks", tz, syncKey),
					sliceRange2(start, 1),
					c
				);
			}),
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("4h ticks", tz, syncKey),
					sliceRange2(start, 1.5),
					c
				);
			}),
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("6h ticks", tz, syncKey),
					sliceRange2(start, 2),
					c
				);
			}),
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("8h ticks", tz, syncKey),
					sliceRange2(start, 3),
					c
				);
			}),
			createStep('london-spring-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1711843200;

				return new uPlot(
					genOpts("12h ticks", tz, syncKey),
					sliceRange2(start, 4),
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("1h ticks", tz, syncKey),
					sliceRange2(start, 0.3),
					c
				);
			}),
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("2h ticks", tz, syncKey),
					sliceRange2(start, 0.5),
					c
				);
			}),
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("3h ticks", tz, syncKey),
					sliceRange2(start, 1),
					c
				);
			}),
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("4h ticks", tz, syncKey),
					sliceRange2(start, 1.5),
					c
				);
			}),
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("6h ticks", tz, syncKey),
					sliceRange2(start, 2),
					c
				);
			}),
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("8h ticks", tz, syncKey),
					sliceRange2(start, 3),
					c
				);
			}),
			createStep('london-fall-ticks', c => {
				let syncKey = null;
				let tz = 'Europe/London';
				let start = 1729987200 - 3600;

				return new uPlot(
					genOpts("12h ticks", tz, syncKey),
					sliceRange2(start, 4),
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("1h ticks", tz, syncKey),
					sliceRange2(start, 0.3),
					c
				);
			}),
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("2h ticks", tz, syncKey),
					sliceRange2(start, 0.5),
					c
				);
			}),
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("3h ticks", tz, syncKey),
					sliceRange2(start, 1),
					c
				);
			}),
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("4h ticks", tz, syncKey),
					sliceRange2(start, 1.5),
					c
				);
			}),
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("6h ticks", tz, syncKey),
					sliceRange2(start, 2),
					c
				);
			}),
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("8h ticks", tz, syncKey),
					sliceRange2(start, 3),
					c
				);
			}),
			createStep('chicago-spring-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1710050400;

				return new uPlot(
					genOpts("12h ticks", tz, syncKey),
					sliceRange2(start, 4),
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("1h ticks", tz, syncKey),
					sliceRange2(start, 0.3),
					c
				);
			}),
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("2h ticks", tz, syncKey),
					sliceRange2(start, 0.5),
					c
				);
			}),
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("3h ticks", tz, syncKey),
					sliceRange2(start, 1),
					c
				);
			}),
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("4h ticks", tz, syncKey),
					sliceRange2(start, 1.5),
					c
				);
			}),
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("6h ticks", tz, syncKey),
					sliceRange2(start, 2),
					c
				);
			}),
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("8h ticks", tz, syncKey),
					sliceRange2(start, 3),
					c
				);
			}),
			createStep('chicago-fall-ticks', c => {
				let syncKey = null;
				let tz = 'America/Chicago';
				let start = 1730610000;

				return new uPlot(
					genOpts("12h ticks", tz, syncKey),
					sliceRange2(start, 4),
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('days', c => {
				return new uPlot(
					genOpts("1-Day", 'Etc/UTC'),
					sliceRange(0, 10),
					c
				);
			}),
			createStep('days', c => {
				return new uPlot(
					genOpts("2-Day", 'Etc/UTC'),
					sliceRange(0, 15),
					c
				);
			}),
			createStep('days', c => {
				return new uPlot(
					genOpts("3-Day", 'Etc/UTC'),
					sliceRange(0, 25),
					c
				);
			}),
			createStep('days', c => {
				return new uPlot(
					genOpts("4-Day", 'Etc/UTC'),
					sliceRange(0, 37),
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('months', c => {
				return new uPlot(
					genOpts("1-Month", 'Etc/UTC'),
					[[start,1719792000*msi],[0.5,0.5]],
					c
				);
			}),
			createStep('months', c => {
				return new uPlot(
					genOpts("2-Month", 'Etc/UTC'),
					[[start,1735689600*msi],[0.5,0.5]],
					c
				);
			}),
			createStep('months', c => {
				return new uPlot(
					genOpts("3-Month", 'Etc/UTC'),
					[[start,1767225600*msi],[0.5,0.5]],
					c
				);
			}),
			createStep('months', c => {
				return new uPlot(
					genOpts("4-Month", 'Etc/UTC'),
					[[start,1798761600*msi],[0.5,0.5]],
					c
				);
			}),
			createStep('months', c => {
				return new uPlot(
					genOpts("6-Month", 'Etc/UTC'),
					[[start,1830768000*msi],[0.5,0.5]],
					c
				);
			}),
		],
	},
	{
		steps: [
			createStep('start-offset', c => {
				return new uPlot(
					genOpts("3-Day (ensure Jan 1)", 'Etc/UTC'),
					[[1704240000*msi,1704240000*msi + 25 * 24 * 3600*msi],[0.5,0.5]],
					c
				);
			}),
			createStep('start-offset', c => {
				return new uPlot(
					genOpts("2-Month (ensure Jan 1)", 'Etc/UTC'),
					[[1722470400*msi,1754006400*msi],[0.5,0.5]],
					c
				);
			}),
		],
	},
];

export const calendarGroups = [
	{
		id: 'midnight-gaps',
		examples: [
			{
				id: 'santiago', title: 'America/Santiago (Sep 6, 2026)', zone: 'America/Santiago',
				min: '2026-09-02T00:00:00-04:00', max: '2026-09-10T00:00:00-03:00',
				note: 'September 6 starts at 01:00. Each date has one tick, with no extra tick at 23:00 on September 5.',
			},
			{
				id: 'sao-paulo', title: 'America/Sao_Paulo (Nov 4, 2018)', zone: 'America/Sao_Paulo',
				min: '2018-11-01T00:00:00-03:00', max: '2018-11-09T00:00:00-02:00',
				note: 'November 4 starts at 01:00. Later ticks return to midnight.',
			},
		],
	},
	{
		id: 'fractional-offsets',
		examples: [
			{
				id: 'lord-howe-back', title: 'Australia/Lord_Howe (Apr 7, 2024)', zone: 'Australia/Lord_Howe',
				min: '2024-04-04T00:00:00+11:00', max: '2024-04-12T00:00:00+10:30',
				note: 'The clock moves back 30 minutes. Daily ticks stay at midnight, including the tick at the range end.',
			},
			{
				id: 'lord-howe-forward', title: 'Australia/Lord_Howe (Oct 6, 2024)', zone: 'Australia/Lord_Howe',
				min: '2024-10-03T00:00:00+10:30', max: '2024-10-11T00:00:00+11:00',
				note: 'The clock moves forward 30 minutes. Daily ticks stay at midnight, including the tick at the range end.',
			},
			{
				id: 'lord-howe-two-day', title: 'Lord Howe: two-day ticks', zone: 'Australia/Lord_Howe',
				min: '2024-04-01T00:00:00+11:00', max: '2024-04-17T00:00:00+10:30',
				note: 'The 30-minute rollback does not shift the two-day ticks. April 17 remains visible at the range end.',
			},
			{
				id: 'norfolk', title: 'Pacific/Norfolk: seven-day month reset', zone: 'Pacific/Norfolk', first: true,
				min: '2015-09-29T00:00:00+11:30', max: '2015-12-07T00:00:00+11:00',
				note: 'nice.first resets the seven-day interval to October 1 at 00:00, not 00:30. The offset changes on October 4.',
			},
		],
	},
	{
		id: 'two-hour-dst',
		examples: [
			{
				id: 'troll-forward', title: 'Antarctica/Troll (Mar 31, 2024)', zone: 'Antarctica/Troll',
				min: '2024-03-27T00:00:00Z', max: '2024-04-04T00:00:00+02:00',
				note: 'The clock moves forward two hours. April 1 gets a midnight tick, not a 01:00 tick.',
			},
			{
				id: 'troll-back', title: 'Antarctica/Troll (Oct 27, 2024)', zone: 'Antarctica/Troll',
				min: '2024-10-23T00:00:00+02:00', max: '2024-10-31T00:00:00Z',
				note: 'The clock moves back two hours. October 28 gets a midnight tick, not a tick on the previous date.',
			},
		],
	},
	{
		id: 'kathmandu-gap',
		examples: [
			{
				id: 'daily', title: 'Asia/Kathmandu (Jan 1, 1986)', zone: 'Asia/Kathmandu',
				min: '1985-12-28T00:00:00+05:30', max: '1986-01-05T00:00:00+05:45',
				note: 'January 1 starts at 00:15. Later daily ticks return to 00:00, not 00:15.',
			},
			{
				id: 'ends-at-start', title: 'Kathmandu: range ends at 00:15', zone: 'Asia/Kathmandu',
				min: '1985-12-24T00:00:00+05:30', max: '1986-01-01T00:15:00+05:45',
				note: 'The range ends exactly at the first valid instant of January 1. The 00:15 tick remains visible.',
			},
			{
				id: 'ends-after-start', title: 'Kathmandu: range ends at 00:30', zone: 'Asia/Kathmandu',
				min: '1985-12-24T00:00:00+05:30', max: '1986-01-01T00:30:00+05:45',
				note: 'The range includes the 00:15 tick on January 1. A misplaced 01:00 tick is outside this range.',
			},
			{
				id: 'starts-at-start', title: 'Kathmandu: range starts at 00:15', zone: 'Asia/Kathmandu',
				min: '1986-01-01T00:15:00+05:45', max: '1986-01-09T00:00:00+05:45',
				note: 'The first tick is January 1 at 00:15. The range starts exactly at this tick.',
			},
			{
				id: 'starts-after-start', title: 'Kathmandu: range starts 1ms after 00:15', zone: 'Asia/Kathmandu',
				min: '1986-01-01T00:15:00.001+05:45', max: '1986-01-09T00:00:00+05:45',
				note: 'The January 1 tick is outside the range. The first visible tick is January 2 at 00:00, with no extra 01:00 tick.',
			},
			{
				id: 'monthly', title: 'Kathmandu: month boundaries', zone: 'Asia/Kathmandu',
				min: '1985-12-30T00:00:00+05:30', max: '1986-09-01T00:00:00+05:45',
				note: 'January starts at 00:15. Later months start at 00:00. These ticks use calendar months, not fixed 30-day steps.',
			},
			{
				id: 'yearly', title: 'Kathmandu: year boundaries', zone: 'Asia/Kathmandu',
				min: '1985-12-30T00:00:00+05:30', max: '1994-01-01T00:00:00+05:45',
				note: 'The year 1986 starts at 00:15. Later years start at 00:00. These ticks use calendar years.',
			},
		],
	},
	{
		id: 'large-rollback',
		examples: [
			{
				id: 'kanton', title: 'Pacific/Kanton (Aug 31, 1937)', zone: 'Pacific/Kanton',
				min: '1937-08-28T00:00:00Z', max: '1937-09-03T00:00:00-12:00',
				note: 'A 12-hour rollback puts a candidate tick at noon. The correction advances to midnight and avoids an infinite loop.',
			},
		],
	},
	{
		id: 'calendar-limitations',
		examples: [
			{
				id: 'kwajalein-prefix', title: 'Pacific/Kwajalein: partial ticks (1993)', zone: 'Pacific/Kwajalein', first: true,
				min: '1993-08-15T00:00:00-12:00', max: '1993-08-29T00:00:00+12:00',
				note: 'Known limitation: the date-line shift skips August 21. The generator stops after August 19 rather than repeat a month-reset loop.',
			},
			{
				id: 'kwajalein-empty', title: 'Pacific/Kwajalein: no visible ticks', zone: 'Pacific/Kwajalein', first: true,
				min: '1993-08-22T00:00:00+12:00', max: '1993-09-05T00:00:00+12:00',
				note: 'Known limitation: the same date-line shift stops the generator before any tick enters this range. The chart has no x-axis ticks.',
			},
			{
				id: 'havana-range', title: 'America/Havana: second midnight (2020)', zone: 'America/Havana',
				min: '2020-11-01T00:00:00-05:00', max: '2020-11-09T00:00:00-05:00',
				note: 'Known limitation: the range starts at the second November 1 midnight (05:00Z). The generator includes it instead of excluding that date.',
			},
			{
				id: 'havana-two-day', title: 'Havana: two-day month reset', zone: 'America/Havana', first: true,
				min: '2020-10-31T00:00:00-04:00', max: '2020-11-16T00:00:00-05:00',
				note: 'Known limitation: the reset selects the second November 1 midnight (05:00Z), not the first midnight (04:00Z).',
			},
			{
				id: 'havana-seven-day', title: 'Havana: seven-day month reset', zone: 'America/Havana', first: true,
				min: '2020-10-29T00:00:00-04:00', max: '2021-01-06T00:00:00-05:00',
				note: 'Known limitation: the seven-day reset also selects 05:00Z rather than the first midnight at 04:00Z.',
			},
			{
				id: 'synthetic-gap', title: 'Synthetic gap: 23:30 → 00:30', zone: 'UTC',
				min: '2023-12-29T00:00:00Z', max: '2024-01-06T00:00:00Z', transition: '2024-01-01T23:30:00Z',
				note: 'Known limitation: this synthetic clock moves forward one hour across midnight. The tick stays at 01:00 instead of the first valid 00:30.',
			},
		],
	},
];

for (const group of calendarGroups) {
	groups.push({
		id: group.id,
		steps: group.examples.map(example => ({
			id: example.id,
			...createStep(group.id, container => {
				const min = Date.parse(example.min) * ms;
				const max = Date.parse(example.max) * ms;
				const transition = example.transition ? Date.parse(example.transition) * ms : Infinity;
				const tzDate = ts => uPlot.tzDate(ts / ms + (ts >= transition ? 3600e3 : 0), example.zone);

				const plot = new uPlot({
					title: example.title,
					width: 600,
					height: 200,
					ms,
					tzDate,

					legend: { show: false },
					scales: {
						x: { range: [min, max] },
						y: { range: [0, 1] },
					},
					axes: [
						{
							size: 70,
							nice: { dst: true, first: example.first ?? false },
							values: (u, splits, axisIdx, space, incr) => {
								const date = incr >= 365 * 86400 * msi ? '{YYYY}' : incr >= 30 * 86400 * msi ? '{M}/{YY}' : '{M}/{D}';
								const fmt = uPlot.fmtDate(date + '\n{HH}:{mm}');
								return splits.map(ts => fmt(tzDate(ts)) + '\n' + new Date(ts / ms).toISOString().slice(11, 16) + 'Z');
							},
						},
						{ show: false },
					],
					series: [{}, { stroke: 'red', points: { show: false } }],
				}, [[min, max], [0.5, 0.5]], container);
				const note = document.createElement('p');
				note.className = 'dst-note';
				note.textContent = example.note;
				plot.root.appendChild(note);
				return plot;
			}),
		})),
	});
}

export default groups;
