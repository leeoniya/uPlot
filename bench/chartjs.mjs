import {hoverTargets, nearHoverIndex} from './hover.mjs';

function round2(val) {
	return Math.round(val * 100) / 100;
}

function round3(val) {
	return Math.round(val * 1000) / 1000;
}

function prepData(packed) {
	// epoch,idl,recv,send,writ,used,free

	const numFields = packed[0];
	const start = numFields + 1;
	const rows = (packed.length - start) / numFields;

	var cpu = Array(rows);
	var ram = Array(rows);
	var tcp = Array(rows);

	for (let i = start, j = 0; i < packed.length; i += numFields, j++) {
		let date = packed[i] * 60 * 1000;
		cpu[j] = {x: date, y: round3(100 - packed[i+1])};
		ram[j] = {x: date, y: round2(100 * packed[i+5] / (packed[i+5] + packed[i+6]))};
		tcp[j] = {x: date, y: packed[i+3]};
	}

	return [cpu, ram, tcp];
}

function makeChart(data, host, wait) {
	var ctx = host.querySelector('#chart1').getContext('2d');
	var cfg = {
		data: {
			datasets: [
				{
					label: 'CPU',
					yAxisID: 'y',
					borderColor: 'rgb(255, 99, 132)',
					data: data[0],
					type: 'line',
					radius: 0,
					fill: false,
					borderWidth: 1
				},
				{
					label: 'RAM',
					yAxisID: 'y',
					borderColor: 'rgb(54, 162, 235)',
					data: data[1],
					type: 'line',
					radius: 0,
					fill: false,
					borderWidth: 1
				},
				{
					label: 'TCP Out',
					yAxisID: 'y2',
					borderColor: 'rgb(75, 192, 192)',
					data: data[2],
					type: 'line',
					radius: 0,
					fill: false,
					borderWidth: 1
				}
			]
		},
		options: {
			animation: false,
			maintainAspectRatio: false,
			parsing: false,
			spanGaps: true,
			normalized: true,
			interaction: {
				mode: 'nearest',
				axis: 'x',
				intersect: false
			},
			scales: {
				x: {
					type: 'time',
					stacked: false,
					ticks: {
						source: 'auto',
						maxRotation: 0,
						autoSkip: true,
						autoSkipPadding: 75,
						sampleSize: 1
					}
				},
				y: {
					type: 'linear',
					position: 'left',
					stacked: false,
					title: {
						display: true,
						text: '%'
					}
				},
				y2: {
					type: 'linear',
					stacked: false,
					position: 'right',
					title: {
						display: true,
						text: 'MB'
					}
				}
			},
			plugins: {
				// Shared x selection keeps nearly overlapping zero-valued series reachable.
				tooltip: {axis: 'x'},
				decimation: {
					enabled: true,
					algorithm: 'min-max'
				}
			}
		}
	};

	var chart = new Chart(ctx, cfg);

	wait.textContent = "Done!";
	return chart;
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], []], host, wait ?? {textContent: ''});
}

function updateChart(chart, input, host, wait) {
	for (let i = 0; i < 3; i++)
		// Assign through the decimation plugin's data setter, not its cached output.
		chart.data.datasets[i].data = input[i];
	chart.update('none');
	if (wait) wait.textContent = 'Done!';
}

export function resizeChart(chart, {width, height}, host, wait) {
	// The harness sizes the responsive canvas parent first. Animation and
	// maintainAspectRatio are disabled; the default resizeDelay is zero.
	chart.resize(width, height);
	if (wait) wait.textContent = 'Done!';
}

export function getHoverPlan(chart, input, host) {
	const canvas = chart.canvas;
	const rect = canvas.getBoundingClientRect();
	const sx = rect.width / chart.width, sy = rect.height / chart.height;
	const xScale = chart.scales.x;
	const length = input[0].length;
	const span = Math.abs(xScale.getPixelForValue(input[0][length - 1].x) - xScale.getPixelForValue(input[0][0].x)) * sx;
	const tolerance = (length - 1) / span;
	const sourceIndex = (seriesIndex, point) => {
		const points = input[seriesIndex];
		let lo = 0, hi = length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (points[mid].x < point.x) lo = mid + 1;
			else hi = mid;
		}
		if (points[lo] === point) return lo;
		// Min/max clones extrema at the bucket's average x. Locate only the
		// hovered bucket instead of allocating a full-input identity map.
		const first = points[0].x, range = points[length - 1].x - first;
		const bucket = x => Math.floor((x - first) / range * chart.width);
		const bin = bucket(point.x);
		lo = 0; hi = length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (bucket(points[mid].x) < bin) lo = mid + 1;
			else hi = mid;
		}
		for (let i = lo; i < length && bucket(points[i].x) === bin; i++)
			if (points[i].y === point.y) return i;
		return -1;
	};
	const targets = hoverTargets(length, (index, seriesIndex) => {
		// Min/max decimation can replace x with a bucket average. Aim at the
		// nearest rendered point, but retain the original requested row.
		const points = chart.data.datasets[seriesIndex].data;
		let nearest = 0;
		for (let i = 1; i < points.length; i++)
			if (Math.abs(points[i].x - input[seriesIndex][index].x) < Math.abs(points[nearest].x - input[seriesIndex][index].x)) nearest = i;
		const point = points[nearest];
		const yScale = chart.scales[seriesIndex === 2 ? 'y2' : 'y'];
		return {x: rect.left + xScale.getPixelForValue(point.x) * sx, y: rect.top + yScale.getPixelForValue(point.y) * sy};
	});
	return {targets, verify(target) {
		const tooltip = chart.tooltip;
		// Canvas text has no DOM node. The harness must cross a rendered-frame
		// barrier after mousemove before accepting this native tooltip model.
		if (!canvas.isConnected || !tooltip?.options.enabled || !(tooltip.opacity > 0) || !(tooltip.width > 0 && tooltip.height > 0)) return null;
		for (let node = canvas; node; node = node.parentElement) {
			const style = canvas.ownerDocument.defaultView.getComputedStyle(node);
			if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return null;
		}
		const bounds = canvas.getBoundingClientRect();
		if (!(bounds.width > 0 && bounds.height > 0)) return null;
		const seriesIndex = target.seriesIndex;
		const items = tooltip.dataPoints ?? [];
		const itemIndex = items.findIndex(item => item.datasetIndex === seriesIndex);
		const item = items[itemIndex];
		if (!item || !tooltip.getActiveElements().some(active => active.datasetIndex === seriesIndex && active.index === item.dataIndex)) return null;
		const raw = chart.data.datasets[seriesIndex].data[item.dataIndex];
		if (!raw || item.raw !== raw || item.parsed.x !== raw.x || item.parsed.y !== raw.y) return null;
		const index = sourceIndex(seriesIndex, raw);
		if (!nearHoverIndex(index, target, tolerance) || index < 0 || index >= length) return null;
		const desiredX = xScale.getPixelForValue(input[seriesIndex][target.index].x);
		if (Math.abs(xScale.getPixelForValue(raw.x) - desiredX) * sx > 1 || Math.abs(xScale.getPixelForValue(input[seriesIndex][index].x) - desiredX) * sx > 1) return null;
		const value = input[seriesIndex][index].y;
		const formatted = chart.scales[seriesIndex === 2 ? 'y2' : 'y'].getLabelForValue(value);
		const text = tooltip.body?.[itemIndex]?.lines?.join('\n') ?? '';
		if (item.formattedValue !== formatted || text !== `${chart.data.datasets[seriesIndex].label}: ${formatted}`) return null;
		return {index, seriesIndex, value, text};
	}};
}

export {makeEmptyChart, updateChart};
export {makeChart, prepData};
