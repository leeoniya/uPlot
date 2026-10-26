export const WIDTH = 480;
export const HEIGHT = 216;
export const CHARTS = 20;
export const ROWS = 300;
export const SERIES = ['#e15759', '#4e79a7', '#59a14f', '#f28e2b', '#b07aa1']
	.map((color, i) => ({id: `s${i}`, label: `Metric ${i + 1}`, color}));

// A repeatable five-hour signal, independent for each tile. Timestamps are milliseconds.
export function dashboardData(rows = ROWS) {
	if (rows !== ROWS && rows !== 2) throw new Error('Dashboard input requires two or 300 rows.');
	return Array.from({length: CHARTS}, (_, chart) => {
		const indices = rows === 2 ? [0, ROWS - 1] : Array.from({length: ROWS}, (_, i) => i);
		return {
			x: indices.map(i => 1704067200000 + i * 60000),
			ys: SERIES.map((_, series) => indices.map(i => {
				const phase = i * (0.035 + series * 0.009) + chart * 0.37;
				return Math.round((50 + 20 * Math.sin(phase) + 10 * Math.cos(i * 0.13 + series + chart)) * 1000) / 1000;
			})),
		};
	});
}

export const prepRows = frame => frame.x.map((time, i) => ({time,
	...Object.fromEntries(SERIES.map(({id}, s) => [id, frame.ys[s][i]])),
}));
export const prepColumns = frame => ({x: [...frame.x],
	...Object.fromEntries(SERIES.map(({id}, s) => [id, [...frame.ys[s]]])),
});
export const prepPairs = frame => frame.ys.map(values => frame.x.map((x, i) => [x, values[i]]));
export const prepPoints = frame => frame.ys.map(values => frame.x.map((x, i) => ({x, y: values[i]})));
export const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

export function assertSeries(series, rows) {
	if (series.length !== SERIES.length || series.some(values => values.length !== rows))
		throw new Error(`Dashboard requires five series of ${rows} points per chart.`);
}
