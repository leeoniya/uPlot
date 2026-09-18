import { plotStep } from './renderDemo.js';

// Linear interpolation has zero thickness only between two consecutive zero values.
export function zeroIntervals(xs, values) {
	const intervals = [];
	for (let i = 1; i < values.length; i++) {
		if (values[i - 1] == 0 && values[i] == 0) {
			const last = intervals.at(-1);
			if (last && last[1] == xs[i - 1])
				last[1] = xs[i];
			else
				intervals.push([xs[i - 1], xs[i]]);
		}
	}
	return intervals;
}

export function zeroGaps(intervals) {
	return (u, seriesIdx, idx0, idx1, gaps) => {
		const scale = u.series[0].scale;
		const result = gaps.map(gap => gap.slice());
		for (const [from, to] of intervals) {
			const a = u.valToPos(from, scale, true);
			const b = u.valToPos(to, scale, true);
			result.push([Math.min(a, b), Math.max(a, b)]);
		}
		result.sort((a, b) => a[0] - b[0]);
		const merged = [];
		for (const gap of result) {
			const last = merged.at(-1);
			if (last && gap[0] <= last[1])
				last[1] = Math.max(last[1], gap[1]);
			else
				merged.push(gap);
		}
		return merged;
	};
}

export function zeroStrokePaths(intervals) {
	const linear = uPlot.paths.linear();
	const gaps = zeroGaps(intervals);
	return (u, seriesIdx, idx0, idx1) => {
		const paths = linear(u, seriesIdx, idx0, idx1);
		if (paths != null) {
			const ori = u.scales[u.series[0].scale].ori;
			const { left, top, width, height } = u.bbox;
			paths.clipStroke = uPlot.clipGaps(gaps(u, seriesIdx, idx0, idx1, []), ori,
				...(ori == 0 ? [left, top, width, height] : [top, left, height, width]));
		}
		return paths;
	};
}

export function createComparison() {
	const xs = Array.from({ length: 13 }, (_, i) => i);
	const raw = [
		[4, 5, 4, 5, 6, 5, 4, 5, 6, 5, 4, 5, 4],
		[2, 2, 0, 0, 0, 0, 2, 3, 0, 2, 2, 0, 0],
		[0, 0, 0, 3, 3, 0, 0, 2, 0, 0, 0, 0, 0],
	];
	const colors = ['#1769aa', '#d87500', '#b42b8b'];
	const fills = ['#1769aa33', '#d8750033', '#b42b8b33'];
	let sum = xs.map(() => 0);
	const stacked = raw.map(values => sum = values.map((value, i) => value + sum[i]));

	return ['ordinary', 'naive', 'overlay', 'clipStroke'].map(mode => {
		const series = [{}, ...stacked.map((_, i) => ({
			label: ['Bottom', 'Middle', 'Top'][i],
			stroke: colors[i],
			fill: fills[i],
			width: mode == 'overlay' ? 0 : 3,
			...(mode == 'naive' ? { gaps: zeroGaps(zeroIntervals(xs, raw[i])) } : {}),
			...(mode == 'clipStroke' ? { paths: zeroStrokePaths(zeroIntervals(xs, raw[i])) } : {}),
			points: { show: false },
		}))];
		const data = [xs, ...stacked];
		if (mode == 'overlay') {
			raw.forEach((values, i) => {
				data.push(stacked[i]);
				series.push({
					label: 'Stroke only',
					stroke: colors[i],
					width: 3,
					scan: false,
					spanGaps: false,
					gaps: zeroGaps(zeroIntervals(xs, values)),
					points: { show: false },
				});
			});
		}
		return new uPlot({
			title: {
				ordinary: '1. Ordinary stacked strokes',
				naive: '2. Naive series.gaps: holes in upper bands',
				overlay: '3. Separate stroke overlays: six series',
				clipStroke: '4. Paths.clipStroke: three series',
			}[mode],
			width: 800,
			height: 300,
			pxAlign: false,
			legend: { show: false },
			cursor: { points: { show: false } },
			scales: { x: { time: false }, y: { range: [0, 12] } },
			series,
			bands: [{ series: [2, 1] }, { series: [3, 2] }],
		}, data, document.body);
	});
}

export default [{ steps: [plotStep(createComparison)] }];
