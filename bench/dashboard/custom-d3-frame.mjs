import {WIDTH} from './common.mjs';
import {pixelRatio} from './custom-common.mjs';

export const LEFT = 40, TOP = 4, PLOT_WIDTH = WIDTH - LEFT - 12, PLOT_HEIGHT = 162;

export function frame(chart) {
	if (!globalThis.d3) throw new Error('Dashboard requires d3@7.9.0.');
	chart.x = d3.scaleTime().range([0, PLOT_WIDTH]);
	chart.y = d3.scaleLinear().range([PLOT_HEIGHT, 0]);
	chart.svg = d3.select(chart.plot).append('svg').attr('width', WIDTH).attr('height', 192)
		.style('position', 'absolute').style('left', '0px').style('top', '0px').style('font', '10px Arial, sans-serif');
	chart.axes = chart.svg.append('g').attr('transform', `translate(${LEFT},${TOP})`);
	chart.xAxis = chart.axes.append('g').attr('transform', `translate(0,${PLOT_HEIGHT})`);
	chart.yAxis = chart.axes.append('g');
}

export function domains(chart, input) {
	chart.x.domain(d3.extent(input.x));
	chart.y.domain([Math.min(...input.ys.map(ys => d3.min(ys))), Math.max(...input.ys.map(ys => d3.max(ys)))]).nice();
	chart.xAxis.call(d3.axisBottom(chart.x).ticks(4));
	chart.yAxis.call(d3.axisLeft(chart.y).ticks(4));
}

export function canvas(chart) {
	const canvas = chart.plot.ownerDocument.createElement('canvas');
	canvas.width = Math.round(PLOT_WIDTH * pixelRatio());
	canvas.height = Math.round(PLOT_HEIGHT * pixelRatio());
	Object.assign(canvas.style, {position: 'absolute', left: `${LEFT}px`, top: `${TOP}px`, width: `${PLOT_WIDTH}px`, height: `${PLOT_HEIGHT}px`});
	chart.plot.prepend(canvas);
	return chart.canvas = canvas;
}
