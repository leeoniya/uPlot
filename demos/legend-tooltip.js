import uPlot from '../src/uPlot.js';

export function createDemo(host, {stats = true, time = false} = {}) {
	const data = [[], [], [], []];
	const start = Date.UTC(2026, 0, 1) / 1000;
	for (let i = 0; i <= 100; i++) {
		data[0].push(time ? start + i * 60 : i);
		data[1].push(50 + 20 * Math.sin(i / 8));
		data[2].push(45 + 15 * Math.cos(i / 12));
		data[3].push(30 + 10 * Math.sin(i / 5));
	}

	const size = () => ({width: host.clientWidth, height: Math.max(240, window.innerHeight - host.getBoundingClientRect().top - 24)});
	const value = (u, value) => value?.toFixed(2);
	const values = (u, si) => {
		const {min, max} = u.scales.x;
		let low = Infinity, high = -Infinity, count = 0;
		for (let i = 0; i < u.data[0].length; i++) {
			if (u.data[0][i] >= min && u.data[0][i] <= max) {
				const value = u.data[si][i];
				low = Math.min(low, value);
				high = Math.max(high, value);

				count++;
			}
		}
		return {Min: count ? low.toFixed(2) : '--', Max: count ? high.toFixed(2) : '--', Last: u.data[si].at(-1)?.toFixed(2) ?? '--'};
	};
	const resize = () => u.setSize(size());
	const u = new uPlot({
		...size(),
		legend: {valueSrc: stats ? 'values' : undefined},
		tooltip: {show: true, mode: 'table', valueSrc: 'value', filter: (u, si) => u.series[si].show},
		cursor: {lock: true, focus: {prox: 30}},
		scales: {x: {time}},
		series: [
			{label: time ? 'Time' : 'Sample'},
			{label: 'North', stroke: '#e45858', value, values},
			{label: 'South', stroke: '#3484d2', value, values},
			{label: 'West', stroke: '#279965', value, values},
		],
		hooks: {destroy: [() => window.removeEventListener('resize', resize)]},
	}, data, host);

	window.addEventListener('resize', resize);
	return u;
}
