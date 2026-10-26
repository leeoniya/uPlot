import {prepRows, requireFramework, destroyReact, waitForLines, calendarLabel} from './framework-runtime.mjs';

import {mountEmptyReact, mountLifecycleReact, updateReact as updateChart, resizeReact as resizeChart} from './lifecycle-frameworks.mjs';

function buildChart(data, React, chart, {width, height}) {
	const {LinePath} = requireFramework('benchmarkVisxShape');
	const {AxisBottom, AxisLeft, AxisRight} = requireFramework('benchmarkVisxAxis');
	const {scaleTime, scaleLinear} = requireFramework('benchmarkVisxScale');
	const {GridRows} = requireFramework('benchmarkVisxGrid');
		const h = React.createElement;
		const margin = {left: 75, right: 85, top: 60, bottom: 40};
		const w = width - margin.left - margin.right, hgt = height - margin.top - margin.bottom;
		let xmin = Infinity, xmax = -Infinity, pmin = Infinity, pmax = -Infinity, tmin = Infinity, tmax = -Infinity;
		for (const row of data) {
			xmin = Math.min(xmin, row.time); xmax = Math.max(xmax, row.time);
			pmin = Math.min(pmin, row.cpu, row.ram); pmax = Math.max(pmax, row.cpu, row.ram);
			tmin = Math.min(tmin, row.tcp); tmax = Math.max(tmax, row.tcp);
		}
		if (!data.length) { xmin = pmin = tmin = 0; xmax = pmax = tmax = 1; }
		const x = scaleTime({domain: [xmin, xmax], range: [0, w]});
		const percent = scaleLinear({domain: [pmin, pmax], range: [hgt, 0], nice: true});
		const mb = scaleLinear({domain: [tmin, tmax], range: [hgt, 0], nice: true});
		return h('svg', {width, height, role: 'img', 'aria-label': 'Server Events'},
			h('text', {x: width / 2, y: 20, textAnchor: 'middle', fontWeight: 'bold'}, 'Server Events'),
			...['CPU', 'RAM', 'TCP Out'].map((label, i) => h('text', {
				key: label, x: margin.left + i * 230, y: 43, fill: ['red', 'blue', 'green'][i],
			}, label)),
			h('g', {transform: `translate(${margin.left},${margin.top})`},
				h(GridRows, {scale: percent, width: w, numTicks: 10, stroke: 'rgba(0,0,0,0.1)'}),
				h(AxisBottom, {scale: x, top: hgt, numTicks: 12, tickFormat: calendarLabel}),
				h(AxisLeft, {scale: percent, numTicks: 10, tickFormat: value => `${value}%`}),
				h(AxisRight, {scale: mb, left: w, numTicks: 10, tickFormat: value => `${value} MB`}),
				...['cpu', 'ram', 'tcp'].map((key, i) => h(LinePath, {
					key, className: 'benchmark-line', data, x: row => x(row.time),
					y: row => (i === 2 ? mb : percent)(row[key]), stroke: ['red', 'blue', 'green'][i],
					strokeWidth: 1, fill: 'none',
				})),
			));
}

const ready = (chart, data, dimensions, previousPaths) => data.length ? waitForLines(chart, '.benchmark-line', previousPaths) : undefined;

function makeChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait);
}

export function makeLifecycleChart(data, host, wait) {
	return mountLifecycleReact(data, host, buildChart, ready, wait);
}

function makeEmptyChart(host, wait) {
	return mountEmptyReact(host, buildChart, ready, wait);
}

export {prepRows as prepData, makeChart, destroyReact as destroyChart, makeEmptyChart, updateChart, resizeChart};
