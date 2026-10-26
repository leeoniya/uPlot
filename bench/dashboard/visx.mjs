import {WIDTH, HEIGHT, SERIES, prepRows} from './common.mjs';
import {requireFramework, destroyReact, waitForLines, calendarLabel, committedReactProps} from '../framework-runtime.mjs';
import {mountLifecycleReact, updateReact as updateChart} from '../lifecycle-frameworks.mjs';

function buildChart(data, React, chart, {width, height}) {
	const {LinePath} = requireFramework('benchmarkVisxShape');
	const {AxisBottom, AxisLeft} = requireFramework('benchmarkVisxAxis');
	const {scaleTime, scaleLinear} = requireFramework('benchmarkVisxScale');
	const {GridRows} = requireFramework('benchmarkVisxGrid');
	const h = React.createElement;
	const margin = {left: 40, right: 12, top: 28, bottom: 30};
	const w = width - margin.left - margin.right, hgt = height - margin.top - margin.bottom;
	let ymin = Infinity, ymax = -Infinity;
	for (const row of data) for (const {id} of SERIES) {
		ymin = Math.min(ymin, row[id]); ymax = Math.max(ymax, row[id]);
	}
	const x = scaleTime({domain: [data[0].time, data[data.length - 1].time], range: [0, w]});
	const y = scaleLinear({domain: [ymin, ymax], range: [hgt, 0], nice: true});
	return h('svg', {width, height, role: 'img', 'aria-label': 'Dashboard metrics'},
		...SERIES.map(({id, label, color}, i) => h('text', {
			key: id, x: 12 + i * 94, y: 18, fill: color, fontSize: 11,
		}, label)),
		h('g', {transform: `translate(${margin.left},${margin.top})`},
			h(GridRows, {scale: y, width: w, numTicks: 4, stroke: 'rgba(0,0,0,0.1)'}),
			h(AxisBottom, {scale: x, top: hgt, numTicks: 4, tickFormat: calendarLabel}),
			h(AxisLeft, {scale: y, numTicks: 4}),
			...SERIES.map(({id, color}) => h(LinePath, {
				key: id, className: 'dashboard-line', data, x: row => x(row.time), y: row => y(row[id]),
				stroke: color, strokeWidth: 1, fill: 'none',
			})),
		),
	);
}

const ready = chart => waitForLines(chart, '.dashboard-line', undefined, SERIES.length);
export function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait, {width: WIDTH, height: HEIGHT});
}

export function validateChart(chart, input, {rows}) {
	const lines = committedReactProps(chart, requireFramework('benchmarkVisxShape').LinePath);
	const {AxisBottom, AxisLeft} = requireFramework('benchmarkVisxAxis');
	const xs = committedReactProps(chart, AxisBottom), ys = committedReactProps(chart, AxisLeft);
	// Axis labels contain nested SVGs; only the root plot owns these attributes.
	const surfaces = committedReactProps(chart, 'svg')
		.filter(props => props.role === 'img' && props['aria-label'] === 'Dashboard metrics');
	const legends = committedReactProps(chart, 'text').filter(props => SERIES.some(({label}) => props.children === label));
	const paths = [...chart.element.querySelectorAll('.dashboard-line')];
	if (surfaces.length !== 1 || surfaces[0].width !== WIDTH || surfaces[0].height !== HEIGHT ||
		xs.length !== 1 || ys.length !== 1 || legends.length !== SERIES.length || input.length !== rows ||
		lines.length !== SERIES.length || paths.length !== SERIES.length ||
		paths.some(path => !/L/.test(path.getAttribute('d')) || /NaN|Infinity/.test(path.getAttribute('d'))) ||
		SERIES.some(({id, color}, s) => lines[s].stroke !== color || lines[s].data?.length !== rows ||
			lines[s].data.some((row, i) => row.time !== input[i].time || row[id] !== input[i][id] ||
				lines[s].x(row) !== xs[0].scale(input[i].time) || lines[s].y(row) !== ys[0].scale(input[i][id]))))
		throw new Error('visx dashboard did not commit five complete, current series.');
	return true;
}

export {prepRows as prepData, updateChart, destroyReact as destroyChart};
