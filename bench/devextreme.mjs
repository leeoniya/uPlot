import {hoverTargets, nearHoverIndex, visibleText} from './hover.mjs';

// https://cdn3.devexpress.com/jslib/26.1.6/js/dx.viz.js is the minified production bundle.
// https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxChart/
// Evaluation warnings remain intact. Licensed runs must configure a valid v26.1 runtime key.
function prepData(packed) {
	const fields = packed[0];
	const data = new Array((packed.length - fields - 1) / fields);

	for (let i = fields + 1, j = 0; i < packed.length; i += fields, j++) {
		data[j] = {
			time: new Date(packed[i] * 60000),
			cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
			ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
			tcp: packed[i + 3],
		};
	}

	return data;
}

function makeChart(data, host, wait, runtimeOptions) {
	return makeChartWithOptions(data, host, wait, runtimeOptions);
}

async function makeChartWithOptions(data, host, wait, runtimeOptions, {sampled = false} = {}) {
	let chart;
	try {
		let resolve, reject;
		const ready = new Promise((done, fail) => { resolve = done; reject = fail; });
		// Observe synchronous incidents even if construction subsequently throws.
		ready.catch(() => {});
		chart = new DevExpress.viz.dxChart(host, {
			size: {width: 1920, height: 600},
			title: 'Server Events',
			dataSource: data,
			animation: {enabled: false},
			// Shared argument hover avoids choosing the wrong overlapping line.
			...(sampled ? {} : {tooltip: {enabled: true, shared: true}}),
			dataPrepareSettings: {sortingMethod: false},
			commonSeriesSettings: {
				type: 'line', argumentField: 'time',
				width: 1 / devicePixelRatio,
				point: {visible: false},
				label: {visible: false},
				aggregation: sampled ? {enabled: true, method: 'avg'} : {enabled: false},
			},
			series: ['cpu', 'ram', 'tcp'].map((valueField, i) => ({
				valueField,
				axis: i === 2 ? 'tcp' : 'percent',
				name: ['CPU', 'RAM', 'TCP Out'][i],
				color: ['red', 'blue', 'green'][i],
			})),
			argumentAxis: {argumentType: 'datetime', type: 'continuous', ...(sampled ? {aggregationGroupWidth: 1} : {})},
			valueAxis: [
				{name: 'percent', position: 'left', label: {customizeText: ({valueText}) => `${valueText}%`}},
				{name: 'tcp', position: 'right', label: {customizeText: ({valueText}) => `${valueText} MB`}},
			],
			synchronizeMultiAxes: false,
			legend: {visible: true, verticalAlignment: 'bottom', horizontalAlignment: 'center'},
			onInitialized: e => { chart = e.component; },
			onDone: () => resolve(),
						// Empty series never emit done in 26.1.6; drawn still reports the axes render.
						onDrawn: () => { if (data.length === 0) resolve(); },
			onIncidentOccurred: ({target}) => {
				// W-codes include vendor evaluation notices; do not suppress them.
				if (target.id?.startsWith('E'))
					reject(new Error(`DevExtreme ${target.id}: ${target.text}`));
			},
		});
		await ready;
		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		try { if (chart) destroyChart(chart); }
		finally { throw error; }
	}
}

function makeEmptyChart(host, wait) {
	return makeChart([], host, wait);
}

async function updateChart(chart, input, host, wait) {
	let done, incident;
	try {
		await new Promise((resolve, reject) => {
			done = resolve;
			incident = ({target}) => {
				if (target.id?.startsWith('E'))
					reject(new Error(`DevExtreme ${target.id}: ${target.text}`));
			};
			chart.on(input.length === 0 ? 'drawn' : 'done', done);
			chart.on('incidentOccurred', incident);
			chart.option('dataSource', input);
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally {
		chart.off(input.length === 0 ? 'drawn' : 'done', done);
		chart.off('incidentOccurred', incident);
	}
}

async function resizeChart(chart, {width, height}, host, wait) {
	let drawn, incident;
	try {
		await new Promise((resolve, reject) => {
			drawn = resolve;
			incident = ({target}) => {
				if (target.id?.startsWith('E'))
					reject(new Error(`DevExtreme ${target.id}: ${target.text}`));
			};
			// Animations are disabled; drawn also covers charts with no series points.
			chart.on('drawn', drawn);
			chart.on('incidentOccurred', incident);
			chart.option('size', {width, height});
		});
		if (wait) wait.textContent = 'Done!';
	}
	finally {
		chart.off('drawn', drawn);
		chart.off('incidentOccurred', incident);
	}
}

function destroyChart(chart) {
	chart.dispose();
}

function getHoverPlan(chart, input, host) {
	if (chart.option('commonSeriesSettings.aggregation.enabled'))
		throw new Error('DevExtreme hover requires unsampled points.');
	const rect = host.getBoundingClientRect();
	const size = chart.option('size');
	const sx = rect.width / size.width, sy = rect.height / size.height;
	const pointAt = (index, s) => chart.getSeriesByPos(s).getPointByPos(index);
	const span = Math.abs(pointAt(input.length - 1, 0).getCoords().x - pointAt(0, 0).getCoords().x) * sx;
	const tolerance = Math.ceil(input.length / span) + 1;
	return {
		targets: hoverTargets(input.length, (index, s) => {
			const {x, y} = pointAt(index, s).getCoords();
			return {x: rect.left + x * sx, y: rect.top + y * sy};
		}),
		verify(target) {
			// 26.1.6 keeps the tooltipShown target and its formatted model here.
			// Read only during diagnostics; no event subscription or hover setter.
			const tooltip = chart._tooltip;
			const selected = chart._tracker?.pointAtShownTooltip;
			const index = selected?.index, seriesIndex = target.seriesIndex;
			if (!nearHoverIndex(index, target, tolerance) || index >= input.length ||
				tooltip?._eventData?.target !== selected || tooltip?._state?.eventData?.target !== selected) return null;
			const row = input[index], keys = ['cpu', 'ram', 'tcp'];
			const model = tooltip._state.formatObject, entries = model?.points;
			const textElement = tooltip._text?.element;
			const lines = [...(textElement?.querySelectorAll('tspan') ?? [])].map(visibleText);
			if (model?.point !== selected || model.value !== selected.value || +model.argument !== +selected.argument ||
				model.seriesName !== selected.series.name || !entries || entries.length !== 3 || lines.length !== 3 ||
				!entries.some(entry => entry.point === selected) ||
				!entries.every((entry, s) => {
					const point = pointAt(index, s), value = row[keys[s]];
					return entry.point === point && point.series === chart.getSeriesByPos(s) &&
						point.value === value && +point.argument === +row.time && entry.value === value &&
						+entry.argument === +row.time && entry.seriesName === point.series.name &&
						lines[s] === `${entry.seriesName}: ${entry.valueText}`;
				}) || lines.join('\n') !== model.valueText ||
				Math.abs(pointAt(index, seriesIndex).getCoords().x - pointAt(target.index, seriesIndex).getCoords().x) * sx > 1) return null;
			const text = visibleText(textElement);
			return text && text === lines.join('') ? {index, seriesIndex, value: row[keys[seriesIndex]], text} : null;
		},
	};
}

export {prepData, makeChart, makeEmptyChart, updateChart, resizeChart, destroyChart, makeChartWithOptions, getHoverPlan};
