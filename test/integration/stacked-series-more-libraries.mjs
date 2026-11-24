import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import {createStackedSeriesData, negativeStackData, stackLayers, stackDomain, stackDimensions, strokeWidth, fillOpacity} from '../../demos/lib/stackedSeriesData.js';
import * as recharts from '../../demos/stacked-series-recharts.js';
import * as agcharts from '../../demos/stacked-series-agcharts.js';
import * as amcharts from '../../demos/stacked-series-amcharts.js';
import * as googlecharts from '../../demos/stacked-series-googlecharts.js';

const layers = stackLayers(createStackedSeriesData());
const labels = layers.map(series => series.label);
const colors = layers.map(series => series.stroke);
const rechartsKeys = ['A', 'B', 'C', 'D', 'negA', 'negB', 'negC', 'negD'];
const args = mock => mock.mock.calls[0].arguments;

function rawData() {
	const raw = createStackedSeriesData();
	// Keep all zero runs, but detect adapters that substitute the default fixture.
	raw.slice(1).forEach((values, i) => { values[0] += (i + 1) / 10; });
	return Object.freeze(raw.map(values => Object.freeze(values)));
}

function assertRows(rows, raw, keys = labels) {
	const fields = ['x', ...keys];
	assert.equal(rows.length, raw[0].length);
	for (const row of rows) assert.deepEqual(Object.keys(row), fields);
	assert.deepEqual(fields.map(field => rows.map(row => row[field])), [...raw, ...negativeStackData(raw).slice(1)]);
}

function assertTable(table, raw, dir = 1) {
	const names = layers.filter(layer => layer.dir === dir).map(layer => layer.label);
	assert.deepEqual(table[0], ['X', ...names].map(label => ({type: 'number', label})));
	assert.equal(table.length, raw[0].length + 1);
	for (const row of table.slice(1)) assert.equal(row.length, raw.length);
	assert.deepEqual(raw.map((_, i) => table.slice(1).map(row => row[i])), raw);
}

function hostFor(t) {
	const host = document.createElement('div');
	host.innerHTML = '<span>Existing host content</span>';
	document.body.append(host);
	t.after(() => host.remove());
	return host;
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
}

async function assertPending(promise) {
	const marker = {};
	assert.equal(await Promise.race([
		promise.then(() => 'resolved early', () => 'rejected early'),
		new Promise(resolve => setImmediate(resolve, marker)),
	]), marker);
}

function clockFor(t, target = globalThis) {
	const pending = new Map();
	t.mock.method(target, 'setTimeout', (callback, delay) => {
		const token = {};
		pending.set(token, {callback, delay});
		return token;
	});
	t.mock.method(target, 'clearTimeout', token => pending.delete(token));
	return {
		pending,
		fire(delay) {
			assert.equal(pending.size, 1);
			const timer = [...pending.values()][0];
			assert.equal(timer.delay, delay);
			timer.callback();
		},
	};
}

function reactElements(t) {
	return {
		React: {createElement: t.mock.fn((type, props, ...children) => ({type, props, children}))},
		Recharts: Object.fromEntries(['AreaChart', 'CartesianGrid', 'XAxis', 'YAxis', 'Legend', 'Area'].map(name => [name, Symbol(name)])),
	};
}

function rechartsStub(t, host) {
	const win = host.ownerDocument.defaultView;
	const clock = clockFor(t, win);
	let check;
	const observer = {observe: t.mock.fn(), disconnect: t.mock.fn()};
	t.mock.method(win, 'MutationObserver', class {
		constructor(callback) { check = callback; return observer; }
	});
	const plot = {render: t.mock.fn(), unmount: t.mock.fn()};
	const Library = {
		...reactElements(t),
		ReactDOM: {flushSync: t.mock.fn(callback => callback())},
		ReactDOMClient: {createRoot: t.mock.fn(() => plot)},
	};
	return {Library, plot, observer, clock, check: () => check()};
}

function areaPath(element, className, d = 'M0,0 L1,1') {
	const path = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('class', className);
	path.setAttribute('d', d);
	element.append(path);
	return path;
}

// Only record the native factories, settings, and lifecycle calls used by this demo.
function amchartsStub(t) {
	const target = () => ({setAll: t.mock.fn()});
	const list = () => ({values: [], push(value) { this.values.push(value); return value; }});
	const factory = (create = (root, settings) => ({root, settings})) => ({new: t.mock.fn(create)});
	const chart = {children: list(), xAxes: list(), yAxes: list(), series: list(), zoomOutButton: target(), plotContainer: target()};
	let frame;
	const listener = {dispose: t.mock.fn()};
	const plot = {
		container: {children: list()}, animationTime: 1, dispose: t.mock.fn(),
		events: {on: t.mock.fn((event, callback) => { assert.equal(event, 'frameended'); frame = callback; return listener; })},
	};
	const Library = {
		am5: {Root: factory(() => plot), Legend: factory(() => ({data: target()})), color: t.mock.fn(value => ({color: value}))},
		am5xy: {
			XYChart: factory((root, settings) => Object.assign(chart, {root, settings})),
			ValueAxis: factory(), AxisRendererX: factory(), AxisRendererY: factory(),
			LineSeries: factory((root, settings) => ({root, settings, strokes: {template: target()}, fills: {template: target()}, data: target()})),
		},
	};
	return {Library, chart, plot, listener, frame: () => frame()};
}

function googleStub(t) {
	const loaded = deferred(), listeners = new Map(), table = {};
	const plot = {draw: t.mock.fn(), clearChart: t.mock.fn()};
	const events = {
		addListener: t.mock.fn((target, event, callback) => {
			assert.equal(target, plot);
			const listener = {event, callback};
			listeners.set(event, listener);
			return listener;
		}),
		removeListener: t.mock.fn(listener => {
			assert.equal(listeners.get(listener.event), listener);
			listeners.delete(listener.event);
		}),
	};
	const Library = {
		charts: {load: t.mock.fn(() => loaded.promise)},
		visualization: {
			AreaChart: t.mock.fn(function() { return plot; }),
			arrayToDataTable: t.mock.fn(() => table), events,
		},
	};
	return {Library, loaded, listeners, table, plot, events, emit: (event, value) => listeners.get(event).callback(value)};
}

function assertGoogleCleanup(stub, clock) {
	assert.equal(clock.pending.size, 0);
	assert.equal(stub.listeners.size, 0);
	assert.deepEqual(stub.events.removeListener.mock.calls.map(call => call.arguments[0]),
		stub.events.addListener.mock.calls.map(call => call.result));
	assert.equal(stub.events.removeListener.mock.callCount(), 2);
}

describe('additional stacked-series native options and raw data', () => {
	for (const [id, prepare, keys = labels] of [
		['recharts', recharts.prepareData, rechartsKeys],
		['agcharts', raw => agcharts.chartOptions(raw).data],
		['amcharts', amcharts.prepareData],
	]) {
		it(`${id}: preserves every raw zero and returns independently mutable rows`, () => {
			const raw = rawData(), snapshot = structuredClone(raw);
			const first = prepare(raw), second = prepare(raw);
			assertRows(first, raw, keys);
			assertRows(second, raw, keys);
			assert.notEqual(first, second);
			first.forEach((row, i) => {
				assert.notEqual(row, second[i]);
				for (const field of Object.keys(row)) row[field] = -100;
			});
			assertRows(second, raw, keys);
			assert.deepEqual(raw, snapshot);
		});
	}

	it('Recharts builds only native linear stacked Areas over raw data', t => {
		const raw = rawData(), {React, Recharts} = reactElements(t);
		const tree = recharts.buildChart(raw, React, Recharts);
		assert.equal(tree.type, Recharts.AreaChart);
		assert.deepEqual([tree.props.width, tree.props.height], [stackDimensions.width, stackDimensions.height]);
		assert.deepEqual([tree.props.stackOffset, tree.props.accessibilityLayer, tree.props.tabIndex], ['none', false, -1]);
		assertRows(tree.props.data, raw, rechartsKeys);
		assert.deepEqual(tree.children.map(child => child.type),
			[Recharts.CartesianGrid, Recharts.XAxis, Recharts.YAxis, Recharts.Legend, ...Array(8).fill(Recharts.Area)]);
		const [, xAxis, yAxis, legend, ...areas] = tree.children;
		assert.equal(legend.props.itemSorter, null);
		assert.equal(xAxis.props.dataKey, 'x');
		for (const [axis, domain] of [[xAxis, stackDomain.x], [yAxis, [-16, 16]]]) {
			assert.deepEqual([axis.props.type, axis.props.scale, axis.props.domain, axis.props.allowDataOverflow], ['number', 'linear', domain, true]);
			assert.notEqual(axis.props.domain, domain);
		}
		areas.forEach(({props}, i) => {
			assert.deepEqual([props.key, props.dataKey, props.name], [rechartsKeys[i], rechartsKeys[i], labels[i]]);
			assert.deepEqual([props.stackId, props.type, props.stroke, props.strokeWidth, props.fill, props.fillOpacity],
				[layers[i].group, 'linear', colors[i], strokeWidth, colors[i], fillOpacity]);
			assert.deepEqual([props.dot, props.activeDot, props.isAnimationActive], [false, false, false]);
			assert.equal(props.data, undefined, 'stacking belongs to Recharts, not per-area precomputed coordinates');
		});
		const second = recharts.buildChart(raw, React, Recharts);
		tree.props.data[0].A = -100;
		tree.children[1].props.domain[0] = -100;
		assertRows(second.props.data, raw, rechartsKeys);
		assert.deepEqual(second.children[1].props.domain, [0, 20]);
		assert.deepEqual(raw, rawData());
	});

	it('AG Charts uses native area stacks, numeric fixed axes, and no animation or interaction', () => {
		const raw = rawData(), options = agcharts.chartOptions(raw);
		assertRows(options.data, raw);
		assert.deepEqual([options.width, options.height], [1000, 440]);
		assert.equal(options.series.length, 8);
		options.series.forEach((series, i) => {
			assert.deepEqual([series.type, series.xKey, series.yKey, series.yName, series.xKeyAxis, series.yKeyAxis],
				['area', 'x', labels[i], labels[i], 'x', 'y']);
			assert.deepEqual([series.stacked, series.stackGroup, series.normalizedTo], [true, layers[i].group, undefined]);
			assert.deepEqual([series.stroke, series.fill, series.strokeWidth, series.fillOpacity], [colors[i], colors[i], 3, 0.18]);
			assert.deepEqual(series.interpolation, {type: 'linear'});
			assert.deepEqual([series.marker.enabled, series.label.enabled], [false, false]);
		});
		for (const [key, position] of [['x', 'bottom'], ['y', 'left']]) {
			const axis = options.axes[key];
			assert.deepEqual([axis.type, axis.position, axis.min, axis.max, axis.nice, axis.interval.step],
				['number', position, ...(key === 'x' ? stackDomain.x : [-16, 16]), false, 2]);
		}
		for (const key of ['animation', 'tooltip', 'highlight', 'keyboard', 'zoom'])
			assert.equal(options[key].enabled, false, key);
		assert.equal(options.legend.enabled, true);
		assert.equal(options.legend.toggleSeries, false);
		const second = agcharts.chartOptions(raw);
		options.axes.x.min = -100;
		options.series[0].marker.enabled = true;
		assert.equal(second.axes.x.min, 0);
		assert.equal(second.series[0].marker.enabled, false);
		assert.deepEqual(raw, rawData());
	});

	it('Google Charts uses a numeric table of raw zeros with native absolute stacking', () => {
		const raw = rawData(), snapshot = structuredClone(raw);
		const first = googlecharts.chartOptions(raw), second = googlecharts.chartOptions(raw);
		assertTable(first.data, raw);
		assertTable(googlecharts.prepareData(raw), raw);
		const options = first.options;
		assert.deepEqual([options.width, options.height, options.isStacked, options.curveType], [1000, 440, true, 'none']);
		assert.deepEqual(options.colors, colors.slice(0, 4));
		assert.deepEqual([options.lineWidth, options.areaOpacity, options.pointSize, options.pointsVisible], [3, 0.18, 0, false]);
		assert.deepEqual([options.legend.position, options.tooltip.trigger, options.enableInteractivity], ['top', 'none', false]);
		assert.deepEqual(options.animation, {startup: false, duration: 0});
		for (const [key, domain] of [['hAxis', stackDomain.x], ['vAxis', [0, 16]]]) {
			assert.equal(options[key].viewWindowMode, 'explicit');
			assert.deepEqual(options[key].viewWindow, {min: domain[0], max: domain[1]});
			assert.deepEqual(options[key].ticks, Array.from({length: domain[1] / 2 + 1}, (_, i) => i * 2));
		}
		first.data[0][0].label = 'changed';
		first.data.slice(1).forEach(row => row.fill(-100));
		options.hAxis.viewWindow.min = -100;
		options.colors[0] = 'black';
		assertTable(second.data, raw);
		assert.equal(second.options.hAxis.viewWindow.min, 0);
		assert.deepEqual(second.options.colors, colors.slice(0, 4));
		assert.deepEqual(raw, snapshot);
	});

	it('Google Charts uses the negative input unchanged with its own labels, colors and fixed range', () => {
		const raw = negativeStackData(rawData());
		const {data, options} = googlecharts.chartOptions(raw);
		assertTable(data, raw, -1);
		assert.deepEqual(options.colors, colors.slice(4));
		assert.deepEqual(options.vAxis.viewWindow, {min: -16, max: 0});
		assert.deepEqual(options.vAxis.ticks, [-16, -14, -12, -10, -8, -6, -4, -2, 0]);
	});
});

describe('Recharts injected lifecycle', {timeout: 5000}, () => {
	it('waits for all eight valid fills and strokes, then disconnects and unmounts its own root', async t => {
		const host = hostFor(t), before = host.innerHTML, raw = rawData();
		const stub = rechartsStub(t, host);
		const pending = recharts.createDemo(host, raw, stub.Library);
		const [element, handlers] = args(stub.Library.ReactDOMClient.createRoot);
		assert.equal(element.ownerDocument, host.ownerDocument);
		assert.equal(element.parentNode, host);
		assert.equal(typeof handlers.onUncaughtError, 'function');
		assert.deepEqual(args(stub.observer.observe), [element, {subtree: true, childList: true, attributes: true}]);
		assertRows(args(stub.plot.render)[0].props.data, raw, rechartsKeys);
		await assertPending(pending);
		for (let i = 0; i < 8; i++) areaPath(element, 'recharts-area-area');
		for (let i = 0; i < 7; i++) areaPath(element, 'recharts-area-curve');
		stub.check();
		await assertPending(pending);
		const last = areaPath(element, 'recharts-area-curve');
		for (const invalid of ['', 'M0,0', 'M0,NaN L1,1', 'M0,0 LInfinity,1']) {
			last.setAttribute('d', invalid);
			stub.check();
			await assertPending(pending);
		}
		assert.equal(stub.observer.disconnect.mock.callCount(), 0);
		assert.equal(stub.clock.pending.size, 1);
		last.setAttribute('d', 'M0,0 L1,1');
		stub.check();
		const demo = await pending;
		assert.equal(demo.plot, stub.plot);
		assert.equal(stub.clock.pending.size, 0);
		assert.equal(stub.observer.disconnect.mock.callCount(), 1);
		assert.equal(stub.plot.unmount.mock.callCount(), 0);
		demo.destroy();
		demo.destroy();
		assert.equal(stub.plot.unmount.mock.callCount(), 1);
		assert.equal(stub.Library.ReactDOM.flushSync.mock.callCount(), 2);
		assert.equal(element.isConnected, false);
		assert.equal(host.innerHTML, before);
		assert.deepEqual(raw, rawData());
	});

	for (const failure of ['createRoot', 'render', 'uncaught error', 'timeout']) {
		it(`cleans its observer, timer, and host after ${failure}`, async t => {
			const host = hostFor(t), before = host.innerHTML, stub = rechartsStub(t, host);
			const error = new Error(failure === 'timeout' ? 'Recharts did not render eight stacked areas' : failure);
			if (failure === 'createRoot') t.mock.method(stub.Library.ReactDOMClient, 'createRoot', () => { throw error; });
			if (failure === 'render') {
				t.mock.method(stub.plot, 'render', () => { throw error; });
				t.mock.method(stub.plot, 'unmount', () => { throw new Error('cleanup failed'); });
			}
			const pending = recharts.createDemo(host, rawData(), stub.Library);
			if (failure === 'uncaught error') args(stub.Library.ReactDOMClient.createRoot)[1].onUncaughtError(error);
			if (failure === 'timeout') stub.clock.fire(10000);
			await assert.rejects(pending, actual => failure === 'timeout' ? actual.message === error.message : actual === error);
			assert.equal(stub.clock.pending.size, 0);
			assert.equal(stub.observer.disconnect.mock.callCount(), 1);
			assert.equal(stub.plot.unmount.mock.callCount(), failure === 'createRoot' ? 0 : 1);
			assert.equal(host.innerHTML, before);
		});
	}
});

describe('AG Charts injected lifecycle', {timeout: 5000}, () => {
	it('does not report ready before waitForUpdate resolves and destroys the same plot', async t => {
		const host = hostFor(t), raw = rawData(), update = deferred();
		const plot = {waitForUpdate: t.mock.fn(() => update.promise), destroy: t.mock.fn()};
		const Library = {AgCharts: {create: t.mock.fn(() => plot)}};
		const pending = agcharts.createDemo(host, raw, Library);
		assert.deepEqual(args(Library.AgCharts.create), [{container: host, ...agcharts.chartOptions(raw)}]);
		assert.equal(plot.waitForUpdate.mock.callCount(), 1);
		assert.equal(plot.waitForUpdate.mock.calls[0].this, plot);
		await assertPending(pending);
		assert.equal(plot.destroy.mock.callCount(), 0);
		update.resolve();
		const demo = await pending;
		assert.equal(demo.plot, plot);
		demo.destroy();
		assert.equal(plot.destroy.mock.callCount(), 1);
		assert.deepEqual(raw, rawData());
	});

	for (const failure of ['throw', 'reject', 'reject with failing destroy']) {
		it(`destroys the plot and preserves the waitForUpdate error: ${failure}`, async t => {
			const error = new Error('update failed');
			const plot = {
				waitForUpdate: t.mock.fn(() => { if (failure === 'throw') throw error; return Promise.reject(error); }),
				destroy: t.mock.fn(() => { if (failure.endsWith('failing destroy')) throw new Error('cleanup failed'); }),
			};
			await assert.rejects(agcharts.createDemo(hostFor(t), rawData(), {AgCharts: {create: () => plot}}), actual => actual === error);
			assert.equal(plot.destroy.mock.callCount(), 1);
		});
	}
});

describe('amCharts injected factories and lifecycle', {timeout: 5000}, () => {
	it('configures native stacked LineSeries and waits for the final frame before disposing readiness resources', async t => {
		const host = hostFor(t), raw = rawData(), stub = amchartsStub(t), clock = clockFor(t);
		const {Library, plot, chart} = stub;
		const pending = amcharts.createDemo(host, raw, Library);
		assert.deepEqual(args(Library.am5.Root.new), [host]);
		assert.equal(plot.autoResize, false);
		assert.deepEqual([host.style.width, host.style.height], ['1000px', '440px']);
		assert.deepEqual(plot.container.children.values, [chart]);
		assert.equal(chart.root, plot);
		assert.deepEqual([chart.settings.panX, chart.settings.panY, chart.settings.wheelX, chart.settings.wheelY,
			chart.settings.pinchZoomX, chart.settings.pinchZoomY, chart.settings.stateAnimationDuration],
			[false, false, 'none', 'none', false, false, 0]);
		for (const key of ['interactive', 'interactiveChildren', 'focusable']) {
			assert.equal(chart.settings[key], false, key);
			assert.equal(args(chart.plotContainer.setAll)[0][key], false, key);
		}
		assert.deepEqual(args(chart.zoomOutButton.setAll), [{forceHidden: true, interactive: false, focusable: false}]);
		assert.equal(Library.am5xy.ValueAxis.new.mock.callCount(), 2);
		const [xAxis] = chart.xAxes.values, [yAxis] = chart.yAxes.values;
		for (const [axis, domain, renderer] of [[xAxis, stackDomain.x, Library.am5xy.AxisRendererX], [yAxis, [-16, 16], Library.am5xy.AxisRendererY]]) {
			assert.equal(axis.root, plot);
			assert.deepEqual([axis.settings.min, axis.settings.max, axis.settings.strictMinMax, axis.settings.extraMin, axis.settings.extraMax], [...domain, true, 0, 0]);
			assert.deepEqual([axis.settings.zoomable, axis.settings.interpolationDuration, axis.settings.stateAnimationDuration,
				axis.settings.interactive, axis.settings.focusable], [false, 0, 0, false, false]);
			assert.equal(axis.settings.renderer, renderer.new.mock.calls[0].result);
			assert.equal(axis.settings.renderer.settings.pan, 'none');
		}
		assert.equal(chart.series.values.length, 8);
		const [legend] = chart.children.values;
		assert.equal(legend, Library.am5.Legend.new.mock.calls[0].result);
		assert.deepEqual(args(legend.data.setAll), [chart.series.values]);
		chart.series.values.forEach((series, i) => {
			const settings = series.settings;
			assert.equal(series.root, plot);
			assert.deepEqual([settings.name, settings.valueXField, settings.valueYField, settings.stacked], [labels[i], 'x', labels[i], i % 4 !== 0]);
			assert.equal(settings.stackToNegative, false);
			assert.equal(settings.xAxis, xAxis);
			assert.equal(settings.yAxis, yAxis);
			assert.equal(settings.baseAxis, xAxis);
			assert.deepEqual([settings.stroke, settings.fill], [{color: colors[i]}, {color: colors[i]}]);
			assert.deepEqual([settings.minDistance, settings.interpolationDuration, settings.stateAnimationDuration, settings.interactive, settings.focusable], [0, 0, 0, false, false]);
			assert.deepEqual(args(series.strokes.template.setAll), [{strokeWidth: 3, interactive: false, focusable: false}]);
			assert.deepEqual(args(series.fills.template.setAll), [{visible: true, fillOpacity: 0.18, interactive: false, focusable: false}]);
			assertRows(args(series.data.setAll)[0], raw);
		});
		await assertPending(pending);
		stub.frame();
		await assertPending(pending);
		assert.equal(stub.listener.dispose.mock.callCount(), 0);
		assert.equal(clock.pending.size, 1);
		stub.frame();
		// The pinned root clears animationTime after emitting its final frame event.
		plot.animationTime = null;
		const demo = await pending;
		assert.equal(demo.plot, plot);
		assert.equal(clock.pending.size, 0);
		assert.equal(stub.listener.dispose.mock.callCount(), 1);
		assert.equal(plot.dispose.mock.callCount(), 0);
		demo.destroy();
		assert.equal(plot.dispose.mock.callCount(), 1);
		assert.deepEqual(raw, rawData());
	});

	for (const failure of ['series factory', 'frame registration', 'render timeout']) {
		it(`disposes the root and readiness resources after ${failure}`, async t => {
			const stub = amchartsStub(t), clock = clockFor(t);
			const error = new Error('native render failed');
			if (failure === 'series factory') t.mock.method(stub.Library.am5xy.LineSeries, 'new', () => { throw error; });
			if (failure === 'frame registration') t.mock.method(stub.plot.events, 'on', () => { throw error; });
			const pending = amcharts.createDemo(hostFor(t), rawData(), stub.Library);
			if (failure === 'render timeout') clock.fire(15000);
			await assert.rejects(pending, actual => failure === 'render timeout' ? actual.message === 'amCharts did not finish rendering' : actual === error);
			assert.equal(stub.plot.dispose.mock.callCount(), 1);
			assert.equal(clock.pending.size, 0);
			assert.equal(stub.listener.dispose.mock.callCount(), failure === 'render timeout' ? 1 : 0);
		});
	}
});

describe('Google Charts injected loader and lifecycle', {timeout: 5000}, () => {
	it('requests frozen 52, waits for load then native ready, and removes both listeners before returning', async t => {
		const stub = googleStub(t), clock = clockFor(t), host = hostFor(t), raw = rawData();
		t.mock.method(stub.plot, 'draw', () => {
			assert.deepEqual([...stub.listeners.keys()], ['ready', 'error'], 'listeners precede draw');
		});
		const pending = googlecharts.createDemo(host, raw, stub.Library);
		assert.deepEqual(args(stub.Library.charts.load), ['52', {packages: ['corechart']}]);
		await assertPending(pending);
		assert.equal(stub.Library.visualization.arrayToDataTable.mock.callCount(), 0);
		assert.equal(stub.Library.visualization.AreaChart.mock.callCount(), 0);
		stub.loaded.resolve();
		await assertPending(pending);
		assertTable(args(stub.Library.visualization.arrayToDataTable)[0], raw);
		assert.equal(stub.Library.visualization.arrayToDataTable.mock.callCount(), 1);
		assert.deepEqual(args(stub.Library.visualization.AreaChart), [host]);
		assert.deepEqual(args(stub.plot.draw), [stub.table, googlecharts.chartOptions(raw).options]);
		assert.equal(clock.pending.size, 1);
		assert.equal(stub.plot.clearChart.mock.callCount(), 0);
		stub.emit('ready');
		const demo = await pending;
		assert.equal(demo.plot, stub.plot);
		assertGoogleCleanup(stub, clock);
		demo.destroy();
		assert.equal(stub.plot.clearChart.mock.callCount(), 1);
		assert.deepEqual(raw, rawData());
	});

	for (const failure of ['throw', 'reject', 'timeout']) {
		it(`clears the loader timer without constructing a chart after load ${failure}`, async t => {
			const stub = googleStub(t), clock = clockFor(t), error = new Error('loader failed');
			if (failure === 'throw') t.mock.method(stub.Library.charts, 'load', () => { throw error; });
			const pending = googlecharts.createDemo(hostFor(t), rawData(), stub.Library);
			if (failure === 'reject') stub.loaded.reject(error);
			if (failure === 'timeout') clock.fire(15000);
			await assert.rejects(pending, actual => {
				assert.equal(actual.message, 'Google Charts did not load');
				if (failure === 'timeout') assert.equal(actual.cause.message, 'Google Charts did not load');
				else assert.equal(actual.cause, error);
				return true;
			});
			assert.equal(clock.pending.size, 0);
			assert.equal(stub.Library.visualization.AreaChart.mock.callCount(), 0);
			assert.equal(stub.events.addListener.mock.callCount(), 0);
			assert.equal(stub.plot.clearChart.mock.callCount(), 0);
		});
	}

	it('rejects a loaded but incomplete visualization API without changing the host', async t => {
		const stub = googleStub(t), clock = clockFor(t), host = hostFor(t), before = host.innerHTML;
		stub.Library.visualization = {};
		const pending = googlecharts.createDemo(host, rawData(), stub.Library);
		stub.loaded.resolve();
		await assert.rejects(pending, {message: 'Google Charts did not load'});
		assert.equal(clock.pending.size, 0);
		assert.equal(host.innerHTML, before);
	});

	for (const failure of ['draw', 'error event', 'empty error event', 'timeout']) {
		it(`clears the chart, timer, and event listeners after render ${failure}`, async t => {
			const stub = googleStub(t), clock = clockFor(t), error = new Error('draw failed');
			if (failure === 'draw') t.mock.method(stub.plot, 'draw', () => { throw error; });
			const pending = googlecharts.createDemo(hostFor(t), rawData(), stub.Library);
			const rejected = assert.rejects(pending, actual => {
				if (failure === 'draw') assert.equal(actual, error);
				else assert.equal(actual.message, failure === 'timeout' ? 'Google Charts did not finish rendering'
					: failure === 'empty error event' ? 'Google Charts could not render' : 'native error');
				return true;
			});
			stub.loaded.resolve();
			if (failure !== 'draw') {
				await assertPending(pending);
				if (failure === 'timeout') clock.fire(15000);
				else stub.emit('error', failure === 'empty error event' ? {} : {message: 'native error'});
			}
			await rejected;
			assertGoogleCleanup(stub, clock);
			assert.equal(stub.plot.clearChart.mock.callCount(), 1);
		});
	}
});
