import { plotStep } from './renderDemo.js';

function dataFor(yrs) {
	let mos = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(",");
	let ts = [];

	yrs.forEach(y => {
		mos.forEach(m => {
		//	ts.push(Date.parse('11 ' + m + ' ' + y + ' 17:30:00 UTC')/1000);
		//	ts.push(Date.parse('01 ' + m + ' ' + y + ' 23:30:00 UTC')/1000);
			ts.push(Date.parse('01 ' + m + ' ' + y + ' 00:00:00 UTC')/1000);
		});
	});

	let vals = [0,1,2,3,4,5,6,7,8,9,10];

	return [
		ts,
		ts.map((t, i) => i == 0 ? 5 : vals[Math.floor(Math.random() * vals.length)]),
	];
}

function createMonthsPlot(title, years) {
	const opts = {
		width: 1920,
		height: 200,
		title,
		tzDate: ts => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
		series: [
			{},
			{
				stroke: "red",
			},
		],
		axes: [
			{
				space: (self, axisIdx, scaleMin, scaleMax, plotDim) => {
					let rangeSecs = scaleMax - scaleMin;
					let rangeDays = rangeSecs / 86400;
					let pxPerDay = plotDim / rangeDays;
					// ensure min split space is 28 days worth of pixels
					return pxPerDay * 28;
				},
			},
		],
	};

	return new uPlot(opts, dataFor(years), document.body);
}

function noLeapYear() {
	return createMonthsPlot('No leap year', [2017,2018,2019]);
}

function leapYear() {
	return createMonthsPlot('2024 leap year', [2024,2025,2026]);
}

export default [{
	steps: [plotStep(noLeapYear), plotStep(leapYear)],
}];
