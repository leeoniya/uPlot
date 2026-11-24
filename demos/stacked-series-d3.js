import {
	createStackedSeriesData,
	stackLayers,
	stackDimensions,
	stackDomain,
	strokeWidth,
	fillOpacity,
} from './lib/stackedSeriesData.js';

export function createDemo(host, data = createStackedSeriesData(), Library = globalThis.d3) {
	if (Library == null)
		throw new Error('D3 did not load');

	const {width, height} = stackDimensions;
	const margin = {top: 20, right: 20, bottom: 40, left: 50};
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;
	const x = Library.scaleLinear().domain(stackDomain.x).range([0, innerWidth]);
	const limit = stackDomain.y[1];
	const y = Library.scaleLinear().domain([-limit, limit]).range([innerHeight, 0]);
	const xTicks = Library.range(stackDomain.x[0], stackDomain.x[1] + 1, 2);
	const yTicks = Library.range(-limit, limit + 1, 4);
	const samples = Array.from(data[0].keys());
	// Diverging offset puts a zero at [0, 0]; ordinary stacks keep it on its own boundary.
	const layers = Library.groups(stackLayers(data), layer => layer.group).flatMap(([, group]) =>
		Library.stack().keys(group).value((i, layer) => layer.values[i])
			.offset(Library.stackOffsetNone)(samples));

	const svg = Library.select(host).append('svg')
		.attr('width', width)
		.attr('height', height)
		.attr('viewBox', `0 0 ${width} ${height}`)
		.attr('role', 'img')
		.attr('aria-label', 'Mirrored stacked areas, with layers A through D on each side of zero');
	const frame = svg.append('g')
		.attr('transform', `translate(${margin.left},${margin.top})`);

	const xGrid = frame.append('g')
		.attr('transform', `translate(0,${innerHeight})`)
		.attr('color', '#e0e0e0')
		.call(Library.axisBottom(x).tickValues(xTicks).tickSize(-innerHeight).tickFormat(''));
	const yGrid = frame.append('g')
		.attr('color', '#e0e0e0')
		.call(Library.axisLeft(y).tickValues(yTicks).tickSize(-innerWidth).tickFormat(''));
	xGrid.select('.domain').remove();
	yGrid.select('.domain').remove();

	const area = Library.area()
		.x(point => x(data[0][point.data]))
		.y0(point => y(point[0]))
		.y1(point => y(point[1]))
		.curve(Library.curveLinear);
	const line = Library.line()
		.x(point => x(data[0][point.data]))
		.y(point => y(point[1]))
		.curve(Library.curveLinear);

	// Paint A through D, fill then outer edge, for each stack.
	const groups = frame.selectAll('.stacked-series-layer')
		.data(layers)
		.join('g')
		.attr('class', 'stacked-series-layer');
	groups.append('path')
		.attr('d', area)
		.attr('fill', layer => layer.key.stroke)
		.attr('fill-opacity', fillOpacity)
		.attr('stroke', 'none');
	groups.append('path')
		.attr('d', line)
		.attr('fill', 'none')
		.attr('stroke', layer => layer.key.stroke)
		.attr('stroke-width', strokeWidth);

	frame.append('g')
		.attr('transform', `translate(0,${innerHeight})`)
		.call(Library.axisBottom(x).tickValues(xTicks).tickFormat(Library.format('d')).tickSizeOuter(0));
	frame.append('g')
		.call(Library.axisLeft(y).tickValues(yTicks).tickFormat(Library.format('d')).tickSizeOuter(0));

	return {
		plot: svg.node(),
		destroy() {
			svg.remove();
		},
	};
}
