// Native adapters for the versions pinned in bench/demo-dependencies.mjs.
// The parent loads vendors. No adapter computes or draws its own reduced series.
export const epoch = Date.UTC(2024, 0, 1);
export const minute = 60000;

const width = 580;
const height = 250;
const color = '#0066cc';
const timestamp = x => epoch + Math.round(x * minute);
const index = x => (+x - epoch) / minute;

// Register cleanup as resources are acquired, including on failed construction.
function resources() {
	const cleanups = [];
	return {
		add: cleanup => cleanups.push(cleanup),
		destroy() {
			let error;
			while (cleanups.length) {
				try { cleanups.pop()(); }
				catch (cause) { error ??= cause; }
			}
			if (error) throw error;
		},
	};
}

function readyGate(label) {
	let resolve, reject;
	const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
	// A vendor can report an incident synchronously before its constructor returns.
	promise.catch(() => {});
	const timer = setTimeout(() => reject(new Error(`${label} did not finish rendering within 15 seconds.`)), 15000);
	return {promise, resolve, reject, clear: () => clearTimeout(timer)};
}

function library(label, modes, note, render) {
	return {
		label, modes, note,
		async render(host, data, mode = modes[0].value) {
			if (!modes.some(item => item.value === mode))
				throw new Error(`${label}: unsupported mode ${mode}.`);
			const [xs, ys] = data;
			if (!xs?.length || xs.length !== ys?.length)
				throw new Error(`${label}: supply nonempty, equal-length x and y arrays.`);
			host.style.width = `${width}px`;
			host.style.height = `${height}px`;
			const owned = resources();
			try {
				const result = await render(host, xs, ys, mode, owned);
				return {...result, destroy: () => owned.destroy()};
			}
			catch (error) {
				try { owned.destroy(); }
				finally { throw error; }
			}
		},
	};
}

async function amcharts(host, xs, ys, mode, owned) {
	const {am5, am5xy} = globalThis;
	const root = am5.Root.new(host);
	owned.add(() => root.dispose());
	root.autoResize = false;
	root.utc = true;
	// No Animated theme or appear(). Keep the vendor's branding untouched.
	const chart = root.container.children.push(am5xy.XYChart.new(root, {
		panX: false, panY: false, wheelX: 'none', wheelY: 'none', pinchZoomX: false,
	}));
	const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
		// Input timestamp precision, not a grouping interval or sampling budget.
		baseInterval: {timeUnit: 'millisecond', count: 1},
		groupData: mode !== 'raw',
		min: timestamp(xs[0]), max: timestamp(xs[xs.length - 1]), strictMinMax: true,
		startLocation: 0, endLocation: 0, maxDeviation: 0,
		interpolationDuration: 0,
		renderer: am5xy.AxisRendererX.new(root, {minGridDistance: 90}),
	}));
	const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
		min: -120, max: 120, strictMinMax: true, maxDeviation: 0,
		interpolationDuration: 0,
		renderer: am5xy.AxisRendererY.new(root, {}),
	}));
	const series = chart.series.push(am5xy.LineSeries.new(root, {
		xAxis, yAxis, valueXField: 'x', valueYField: 'y',
		...(mode === 'average' ? {valueYGrouped: 'average'} : {}),
		stroke: am5.color(color), minDistance: 0, exactLocationX: true,
		interpolationDuration: 0, stateAnimationDuration: 0,
	}));
	series.strokes.template.setAll({strokeWidth: 1});
	const ready = readyGate('amCharts');
	let listener;
	try {
		listener = root.events.on('frameended', () => {
			// The pinned root clears animationTime after dispatching frameended.
			queueMicrotask(() => {
				if (root.animationTime === null) ready.resolve();
			});
		});
		series.data.setAll(Array.from(xs, (x, i) => ({x: timestamp(x), y: ys[i]})));
		await ready.promise;
		return {points: series.dataItems.map(item => [index(item.get('valueX')), item.get('valueY')])};
	}
	finally {
		ready.clear();
		listener?.dispose();
	}
}

async function devextreme(host, xs, ys, mode, owned) {
	const ready = readyGate('DevExtreme');
	let chart;
	owned.add(() => chart?.dispose());
	try {
		const range = {startValue: new Date(timestamp(xs[0])), endValue: new Date(timestamp(xs[xs.length - 1]))};
		chart = new globalThis.DevExpress.viz.dxChart(host, {
			size: {width, height},
			dataSource: Array.from(xs, (x, i) => ({x: new Date(timestamp(x)), y: ys[i]})),
			animation: {enabled: false},
			dataPrepareSettings: {sortingMethod: false},
			commonSeriesSettings: {
				type: 'line', argumentField: 'x', width: 1,
				point: {visible: false}, label: {visible: false},
				aggregation: {enabled: mode !== 'raw'},
			},
			series: [{valueField: 'y', color}],
			argumentAxis: {
				argumentType: 'datetime', type: 'continuous',
				wholeRange: {...range}, visualRange: {...range}, valueMarginsEnabled: false,
			},
			valueAxis: {
				wholeRange: {startValue: -120, endValue: 120},
				visualRange: {startValue: -120, endValue: 120}, valueMarginsEnabled: false,
			},
			legend: {visible: false}, tooltip: {enabled: false},
			onInitialized: e => { chart = e.component; },
			onDone: () => ready.resolve(),
			onIncidentOccurred: ({target}) => {
				// Keep evaluation warnings; only E-codes reject rendering.
				if (target.id?.startsWith('E'))
					ready.reject(new Error(`DevExtreme ${target.id}: ${target.text}`));
			},
		});
		await ready.promise;
		return {points: chart.getAllSeries()[0].getAllPoints().map(point => [index(point.argument), point.value])};
	}
	finally {
		ready.clear();
	}
}

function stockPoints(series) {
	// In AnyStock 9.0.0 the series iterator uses its active selectable, not the
	// source table. getKey() and get('value') read grouped rows when grouping runs.
	const iterator = series.getIterator?.();
	if (!iterator?.reset || !iterator.advance || !iterator.getKey || !iterator.get)
		return {points: null, note: 'The active AnyStock series iterator is unavailable; processed points are not reported.'};
	const points = [];
	try {
		iterator.reset();
		while (iterator.advance())
			points.push([index(iterator.getKey()), iterator.get('value')]);
	}
	finally {
		iterator.reset();
	}
	return {points};
}

async function anychart(host, xs, ys, mode, owned) {
	const vendor = globalThis.anychart;
	const scale = vendor.scales.linear();
	owned.add(() => scale.dispose());
	scale.minimum(-120);
	scale.maximum(120);
	const table = vendor.data.table(0);
	owned.add(() => table.dispose());
	table.addData(Array.from(xs, (x, i) => [timestamp(x), ys[i]]));
	const mapping = table.mapAs({value: mode === 'average' ? {column: 1, type: 'average'} : 1});
	owned.add(() => mapping.dispose());
	const chart = vendor.stock();
	owned.add(() => chart.dispose());
	chart.animation(false);
	chart.bounds(0, 0, width, height);
	// Scatter time preserves gaps; the ordinal stock scale does not.
	chart.xScale('scatter');
	chart.xScale().minimumGap(0);
	chart.xScale().maximumGap(0);
	if (mode === 'raw') {
		chart.grouping().enabled(false);
		chart.scrollerGrouping().enabled(false);
	}
	chart.scroller().enabled(false);
	const plot = chart.plot(0);
	plot.yScale(scale);
	plot.legend().enabled(false);
	const series = plot.line(mapping);
	series.stroke({color, thickness: 1});
	series.normal().markers().enabled(false);
	series.hovered().markers().enabled(false);
	series.selected().markers().enabled(false);
	chart.selectRange(timestamp(xs[0]), timestamp(xs[xs.length - 1]));
	chart.container(host);
	const ready = readyGate('AnyStock');
	try {
		chart.listenOnce('chartDraw', ready.resolve);
		chart.draw();
		await ready.promise;
		return stockPoints(series);
	}
	finally {
		ready.clear();
		chart.unlisten('chartDraw', ready.resolve);
	}
}

async function fusiontime(host, xs, ys, mode, owned) {
	const {FusionCharts} = globalThis;
	const store = new FusionCharts.DataStore();
	owned.add(() => store.dispose());
	// DataStore appends row IDs, so only pass newly allocated rows.
	const table = store.createDataTable(Array.from(xs, (x, i) => [timestamp(x), ys[i]]), [
		{name: 'Time', type: 'date', format: '%Q'},
		{name: 'Value', type: 'number'},
	], {enableUTC: true});
	const chart = new FusionCharts({
		type: 'timeseries', renderAt: host, width, height, dataFormat: 'json',
		dataSource: {
			chart: {animation: 0, multiCanvas: false, enableUTC: true, paletteColors: color},
			data: table,
			xAxis: {
				plot: 'Time',
				initialInterval: {from: timestamp(xs[0]), to: timestamp(xs[xs.length - 1])},

			},
			yAxis: [{plot: [{value: 'Value', type: 'line'}], min: -120, max: 120, strictPadding: true}],
			plotConfig: {line: {style: {
				line: {'stroke-width': 1},
				anchor: {opacity: 0},
				'anchor:hover': {opacity: 0},
				'anchor:highlight': {opacity: 0},
			}}},
			navigator: {enabled: false},
			extensions: {
				standardRangeSelector: {enabled: false},
				customRangeSelector: {enabled: false},
			},
			legend: {enabled: false},
		},
	});
	owned.add(() => chart.dispose());
	const ready = readyGate('FusionTime');
	const listeners = [];
	try {
		const on = (name, listener) => {
			listeners.push([name, listener]);
			chart.addEventListener(name, listener);
		};
		on('renderComplete', ready.resolve);
		for (const name of ['dataInvalid', 'dataLoadError'])
			on(name, (event, detail) => ready.reject(new Error(`FusionTime ${name}: ${detail?.error?.message ?? detail?.error ?? detail?.message ?? event?.eventType ?? 'chart initialization failed'}`)));
		chart.render();
		await ready.promise;
		let binNote;
		try {
			const bin = chart.getCurrentBin();
			binNote = `Current native bin: ${bin.multiplier} ${bin.unit}.`;
		}
		catch {
			binNote = 'Current native bin is unavailable.';
		}
		return {
			points: null,
			note: `${binNote} Processed points are not exposed by a verified public API; input rows are not reported as binned output.`,
		};
	}
	finally {
		ready.clear();
		for (const [name, listener] of listeners)
			chart.removeEventListener(name, listener);
	}
}

export const groupedLibraries = {
	amcharts: library('amCharts', [
		{value: 'default', label: 'Opt-in grouping (default close, default budget)'},
		{value: 'average', label: 'Opt-in grouping (explicit average, default budget)'},
		{value: 'raw', label: 'Raw (grouping off)'},
	], 'groupData is opt-in. Native interval selection and sampling budget remain unchanged; the default aggregator is close. Points come from active series.dataItems.', amcharts),
	devextreme: library('DevExtreme', [
		{value: 'default', label: 'Opt-in aggregation (default average, default budget)'},
		{value: 'raw', label: 'Raw (aggregation off)'},
	], 'Aggregation is opt-in. The line series keeps its native average method and automatic group width/interval. Points come from getAllPoints().', devextreme),
	anychart: library('AnyChart Stock', [
		{value: 'default', label: 'Default Stock grouping (last, default budget)' },
		{value: 'average', label: 'Stock grouping (explicit average, default budget)' },
		{value: 'raw', label: 'Raw (grouping off)'},
	], 'Stock grouping is enabled by default. Native intervals and budget remain unchanged. The value mapping defaults to last; average is explicit. Points come from the active series iterator.', anychart),
	fusiontime: library('FusionTime', [
		{value: 'default', label: 'Default average binning, default budget'},
	], 'FusionTime bins by default using average. Binning rules and budget remain untouched. No verified aggregation-off mode is available. Processed points are unavailable.', fusiontime),
};
