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

export default groups;
