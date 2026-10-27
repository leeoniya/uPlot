import {hoverTargets, visibleText, nearHoverIndex} from './hover.mjs';

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

	let data = Array(rows);

	for (let i = start, j = 0; i < packed.length; i += numFields, j++) {
		let rec = Array(4);
		rec[0] = packed[i] * 60 * 1000;
		rec[1] = round3(100 - packed[i+1]);
		rec[2] = round2(100 * packed[i+5] / (packed[i+5] + packed[i+6]))
		rec[3] = packed[i+3];

		data[j] = rec;
	}

	return data;
}

function makeChart(data, host, wait) {
	let dateFormat = fmtDate('{M}/{DD}/{YY}\n{h}:{mm}{aa}');

	var dyCpuMem = new Dygraph(host, data, {
		width: 1920,
		height: 600,
		labels: [
			'Time',
			'CPU',
			'RAM',
			'TCP Out',
		],
		series: {
			'TCP Out': {
				axis: 'y2'
			},
		},
		colors: [
			'rgba(255,0,0,1)',
			'rgba(0,0,255,1)',
		//	'#12007f',
			'#297f00',
		],
		axes: {
			x: {
				ticker: Dygraph.dateTicker,
				axisLabelFormatter: function (d, gran) {
					return dateFormat(d);
				},
				valueFormatter: function (d) {
					return dateFormat(new Date(d));
				}
			},
			y: {
				axisLabelFormatter: function (d, gran) {
					return d + "%";
				},
				valueFormatter: function (d) {
					return round2(d) + "%";
				}
			},
			y2: {
				axisLabelFormatter: function (d, gran) {
					return d + " MB";
				},
				valueFormatter: function (d) {
					return d + " MB";
				},
			//	labelsKMB: true,
			//	drawGrid: true,
				independentTicks: true
			}
		}
	});

	wait.textContent = "Done!";

	return dyCpuMem;
}

function updateChart(chart, input, host, wait) {
	// Inline array replacement parses and draws synchronously.
	chart.updateOptions({file: input.length ? input : '\n'});
	if (wait) wait.textContent = 'Done!';
	return chart;
}

export function resizeChart(chart, {width, height}, host, wait) {
	chart.resize(width, height);
	if (wait) wait.textContent = 'Done!';
	return chart;
}

export function getHoverPlan(chart, input, host) {
	const rect = host.getBoundingClientRect();
	const sx = rect.width / host.clientWidth, sy = rect.height / host.clientHeight;
	const length = input.length;
	const tolerance = (length - 1) / (Math.abs(chart.toDomXCoord(input[length - 1][0]) - chart.toDomXCoord(input[0][0])) * sx);
	return {
		targets: hoverTargets(length, (index, seriesIndex) => ({
			x: rect.left + chart.toDomXCoord(input[index][0]) * sx,
			y: rect.top + chart.toDomYCoord(input[index][seriesIndex + 1], seriesIndex === 2 ? 1 : 0) * sy,
		})),
		verify(target) {
			const index = chart.getSelection();
			if (!nearHoverIndex(index, target, tolerance) || index < 0 || index >= length) return null;
			const seriesIndex = target.seriesIndex;
			const name = ['CPU', 'RAM', 'TCP Out'][seriesIndex];
			const point = chart.selPoints_?.find(point => point.name === name);
			const value = input[index][seriesIndex + 1];
			if (!point || point.idx !== index || point.xval !== input[index][0] || point.yval !== value || Math.abs(chart.toDomXCoord(input[index][0]) - chart.toDomXCoord(input[target.index][0])) * sx > 1) return null;
			const text = visibleText(host.querySelector('.dygraph-legend'));
			const formatted = seriesIndex === 2 ? `${value} MB` : `${round2(value)}%`;
			if (!text.replace(/\s+/g, ' ').includes(`${name}: ${formatted}`)) return null;
			return {index, seriesIndex, value, text};
		},
	};
}

export {makeChart, prepData, updateChart};
