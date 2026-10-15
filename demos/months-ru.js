import { plotStep } from './renderDemo.js';

function russianMonths() {
	let yrs = [2017,2018,2019];
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

	let data = [
		ts,
		ts.map((t, i) => i == 0 ? 5 : vals[Math.floor(Math.random() * vals.length)]),
	];

	const ruNames = {
		MMMM: ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"],
		MMM:  ["Янв","Февр","Март","Апр","Май","Июнь","Июль","Авг","Сент","Окт","Нояб","Дек"],
		WWWW: ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"],
		WWW:  ["Вск","Пнд","Втр","Срд","Чтв","Птн","Сбт"],
	};

	const opts = {
		width: 1920,
		height: 600,
		title: "Months",
		tzDate: ts => uPlot.tzDate(new Date(ts * 1e3), 'Etc/UTC'),
		fmtDate: tpl => uPlot.fmtDate(tpl, ruNames),
		series: [
			{},
			{
				stroke: "red",
			},
		]
	};

	return new uPlot(opts, data, document.body);
}

export default [{
	steps: [plotStep(russianMonths)],
}];
