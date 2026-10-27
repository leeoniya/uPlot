import {hoverTargets, nearHoverIndex, visibleText} from './hover.mjs';

// anychart@9.0.0: dist/js/anychart-core.min.js, then dist/js/anychart-stock.min.js.
// https://docs.anychart.com/Stock_Charts/Scales
// https://docs.anychart.com/Stock_Charts/Data_Grouping
function prepData(packed) {
	const fields = packed[0];
	const rows = new Array((packed.length - fields - 1) / fields);
	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		rows[j] = [
			packed[i] * 60000,
			Math.round((100 - packed[i + 1]) * 1000) / 1000,
			Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			packed[i + 3],
		];
	}
	return rows;
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {sampled = false} = {}) {
	const handle = {chart: null, table: null, mappings: [], scales: []};
	let timer;
	let drawn;
	try {
		const chart = handle.chart = anychart.stock();
		chart.animation(false);
		chart.bounds(0, 0, 1920, 600);
		chart.title('Server Events');
		// Ordinal stock scales collapse missing calendar intervals.
		chart.xScale('scatter');
		if (!sampled) {
			chart.grouping().enabled(false);
			chart.scrollerGrouping().enabled(false);
		}
		chart.scroller().enabled(false);
		const plot = chart.plot(0);
		const percent = anychart.scales.linear();
		handle.scales.push(percent);
		const tcp = anychart.scales.linear();
		handle.scales.push(tcp);
		plot.yScale(percent);
		plot.yAxis(0).orientation('left').scale(percent).labels().format('{%Value}%');
		plot.yAxis(1).orientation('right').scale(tcp).labels().format('{%Value} MB');
		plot.legend().enabled(true);
		plot.legend().position('bottom');

		const table = handle.table = anychart.data.table(0);
		table.addData(data);
		for (let i = 0; i < 3; i++) {
			// This average mapping is inactive while grouping is disabled.
			const mapping = table.mapAs({value: {column: i + 1, type: 'average'}});
			handle.mappings.push(mapping);
			const series = plot.line(mapping);
			series.name(['CPU', 'RAM', 'TCP Out'][i]);
			series.stroke({color: ['red', 'blue', 'green'][i], thickness: 1 / devicePixelRatio});
			series.yScale(i === 2 ? tcp : percent);
			series.normal().markers().enabled(false);
			series.hovered().markers().enabled(false);
			series.selected().markers().enabled(false);
		}
		chart.container(host);
		await new Promise((resolve, reject) => {
			drawn = resolve;
			chart.listenOnce('chartDraw', drawn);
			timer = setTimeout(() => reject(new Error('AnyStock did not finish drawing within 30 seconds.')), 30000);
			chart.draw();
		});
		if (wait)
			wait.textContent = 'Done!';
		return handle;
	}
	catch (error) {
		try { destroyChart(handle); }
		finally { throw error; }
	}
	finally {
		clearTimeout(timer);
		if (handle.chart && drawn)
			handle.chart.unlisten('chartDraw', drawn);
	}
}

async function updateChart(handle, input, host, wait) {
	const {chart, table} = handle;
	let drawn, timer;
	try {
		await new Promise((resolve, reject) => {
			drawn = resolve;
			chart.listenOnce('chartDraw', drawn);
			timer = setTimeout(() => reject(new Error('AnyStock did not finish drawing within 30 seconds.')), 30000);
			table.startTransaction();
			try {
				table.remove();
				table.addData(input);
				table.commit();
			}
			catch (error) {
				table.rollback();
				throw error;
			}
			chart.selectRange('max');
			chart.draw();
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally {
		clearTimeout(timer);
		chart.unlisten('chartDraw', drawn);
	}
}

async function resizeChart(handle, {width, height}, host, wait) {
	const {chart} = handle;
	let drawn, timer;
	try {
		await new Promise((resolve, reject) => {
			drawn = resolve;
			chart.listenOnce('chartDraw', drawn);
			timer = setTimeout(() => reject(new Error('AnyStock did not finish resizing within 30 seconds.')), 30000);
			// Batch stage and bounds changes so an intermediate draw cannot finish the wait.
			chart.suspendSignalsDispatching();
			try {
				chart.container().getStage().resize(width, height);
				chart.bounds(0, 0, width, height);
			}
			finally { chart.resumeSignalsDispatching(false); }
			chart.draw();
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally {
		clearTimeout(timer);
		chart.unlisten('chartDraw', drawn);
	}
}

export function getHoverPlan(handle, input, host) {
	const {chart} = handle;
	if (chart.grouping().enabled())
		throw new Error('AnyStock hover requires unsampled data.');
	const plot = chart.plot(0), bounds = plot.getPlotBounds();
	const stage = chart.container().getStage();
	const rect = stage.getDomWrapper().getBoundingClientRect();
	const sx = rect.width / stage.width(), sy = rect.height / stage.height();
	const length = input.length;
	const x = index => rect.left + (bounds.left + chart.xScale().transform(input[index][0]) * bounds.width) * sx;
	return {
		targets: hoverTargets(length, (index, seriesIndex) => ({
			x: x(index),
			y: rect.top + (bounds.top + (1 - plot.getSeriesAt(seriesIndex).yScale().transform(input[index][seriesIndex + 1])) * bounds.height) * sy,
		})),
		verify(target) {
			const seriesIndex = target.seriesIndex, series = plot.getSeriesAt(seriesIndex);
			// Pinned 9.0.0: Uea distinguishes hover from the last-visible-row fallback.
			// getPoint() is null for stock; getCurrentPoint() is the native hovered TableSelectable row.
			const point = series.Uea && series.getCurrentPoint();
			const index = point ? point.getIndex() : -1;
			if (!nearHoverIndex(index, target, length - 1) || index >= length || !(Math.abs(x(index) - target.x) <= 1))
				return false;
			const value = point.get('value');
			if (!Number.isFinite(value) || value !== input[index][seriesIndex + 1] || point.getKey() !== input[index][0])
				return false;
			// Stock's default union tooltip joins the per-series formatted lines with newlines.
			const content = chart.tooltip().contentInternal();
			const expected = `${series.name()}: ${anychart.format.number(value, series.defaultDecimalDigitsCount || undefined)}`;
			if (!content.text().split('\n').includes(expected)) return false;
			const root = content.container()?.domElement();
			const compact = text => text.replace(/\s/g, '');
			for (const node of root?.querySelectorAll('text') ?? []) {
				const text = visibleText(node);
				if (text && compact(text) === compact(content.text()))
					return {index, seriesIndex, value, text};
			}
			return false;
		},
	};
}

function destroyChart(handle) {
	const {chart, table, mappings, scales} = handle;
	handle.chart = handle.table = null;
	handle.mappings = [];
	handle.scales = [];
	try { chart?.dispose(); }
	finally {
		try { for (const mapping of mappings) mapping.dispose(); }
		finally {
			try { table?.dispose(); }
			finally { for (const scale of scales) scale.dispose(); }
		}
	}
}

export {prepData, makeChart, updateChart, resizeChart, destroyChart, makeChartWithOptions};
