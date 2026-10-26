// @canvasjs/charts@3.17.8/canvasjs.min.js exposes CanvasJS; retain its credits.
import {hoverTargets, nearHoverIndex, visibleText} from './hover.mjs';
function prepData(packed) {
	const fields = packed[0];
	const count = (packed.length - fields - 1) / fields;
	const data = Array.from({length: 3}, () => Array(count));

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		const x = packed[i] * 60000;
		data[0][j] = {x, y: Math.round((100 - packed[i + 1]) * 1000) / 1000};
		data[1][j] = {x, y: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100};
		data[2][j] = {x, y: packed[i + 3]};
	}

	return data;
}

function makeChart(data, host, wait) {
	const chart = new CanvasJS.Chart(host, {
		width: 1920,
		height: 600,
		title: {text: 'Server Events'},
		animationEnabled: false,
		zoomEnabled: true,

		axisY: {includeZero: false, suffix: '%'},
		axisY2: {includeZero: false, suffix: ' MB', gridThickness: 0},
		data: ['CPU', 'RAM', 'TCP Out'].map((name, i) => ({
			name,
			showInLegend: true,
			type: 'line',
			xValueType: 'dateTime',
			axisYType: i === 2 ? 'secondary' : 'primary',
			yValueFormatString: i === 2 ? "0.00' MB'" : "0.00'%'",
			color: ['red', 'blue', 'green'][i],
			lineThickness: 1 / devicePixelRatio,
			markerSize: 0,
			dataPoints: data[i],
		})),
	});

	try {
		// With animation disabled, render draws the chart synchronously.
		chart.render();
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { destroyChart(chart); }
		finally { throw error; }
	}
}

function destroyChart(chart) {
	chart.destroy();
}

function makeEmptyChart(host, wait) {
	return makeChart([[], [], []], host, wait);
}

function updateChart(chart, input, host, wait) {
	chart.options.data.forEach((series, i) => { series.dataPoints = input[i]; });
	chart.render();
	if (wait) wait.textContent = 'Done!';
	return chart;
}

export function resizeChart(chart, {width, height}, host, wait) {
	chart.options.width = width;
	chart.options.height = height;
	chart.render();
	if (wait) wait.textContent = 'Done!';
	return chart;
}

export function getHoverPlan(chart, input, host) {
	const rect = chart.canvas.getBoundingClientRect();
	const sx = rect.width / chart.width, sy = rect.height / chart.height;
	const length = input[0].length, xAxis = chart.data[0].axisX;
	const tolerance = (length - 1) / (Math.abs(xAxis.convertValueToPixel(input[0][length - 1].x) - xAxis.convertValueToPixel(input[0][0].x)) * sx);
	return {
		targets: hoverTargets(length, (index, seriesIndex) => ({
			x: rect.left + chart.data[seriesIndex].axisX.convertValueToPixel(input[seriesIndex][index].x) * sx,
			// Native hover excludes the plot border; zero TCP values lie on it.
			y: rect.top + Math.max(chart.plotArea.y1 + 1 / sy, Math.min(chart.plotArea.y2 - 1 / sy,
				chart.data[seriesIndex].axisY.convertValueToPixel(input[seriesIndex][index].y))) * sy,
		})),
		verify(target) {
			const {seriesIndex} = target, series = chart.data[seriesIndex], tooltip = chart.toolTip;
			const entry = tooltip?._entries?.find(entry => entry.dataSeries === series && entry.dataSeries._index === seriesIndex);
			if (!tooltip?.enabled || !entry || !nearHoverIndex(entry.index, target, tolerance)) return null;
			const index = entry.index, point = input[seriesIndex][index];
			if (!point || !Number.isFinite(point.y) || entry.dataPoint.x !== point.x || entry.dataPoint.y !== point.y ||
				series.dataPoints[index]?.x !== point.x || series.dataPoints[index]?.y !== point.y)
				return null;
			const text = visibleText(tooltip.contentDiv).replace(/\s+/g, ' ');
			// The default unshared tooltip displays x and y, not the series name.
			const expected = chart.replaceKeywordsWithValue('{x}: {y}', entry.dataPoint, series, index).replace(/\s+/g, ' ');
			return text && text === expected ? {index, seriesIndex, value: point.y, text} : null;
		},
	};
}

export {prepData, makeChart, destroyChart, makeEmptyChart, updateChart};
