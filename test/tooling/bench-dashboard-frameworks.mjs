import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as recharts from '../../bench/dashboard/recharts.mjs';
import * as muicharts from '../../bench/dashboard/muicharts.mjs';
import * as financialcharts from '../../bench/dashboard/financialcharts.mjs';
import * as visx from '../../bench/dashboard/visx.mjs';
import {WIDTH, HEIGHT, CHARTS, ROWS, SERIES, dashboardData} from '../../bench/dashboard/common.mjs';
import {mountReact, destroyReact, waitForLines, calendarLabel, committedReactProps} from '../../bench/framework-runtime.mjs';
import {mountLifecycleReact} from '../../bench/lifecycle-frameworks.mjs';

const adapters = {recharts, muicharts, financialcharts, visx};
const globals = ['benchmarkReact', 'benchmarkReactDOM', 'benchmarkReactDOMClient', 'MutationObserver',
	'benchmarkRecharts', 'benchmarkMuiCharts', 'benchmarkFinancialCharts', 'benchmarkD3Scale',
	'benchmarkVisxShape', 'benchmarkVisxAxis', 'benchmarkVisxScale', 'benchmarkVisxGrid', 'devicePixelRatio'];
const freeze = value => {
	if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
	return value;
};

// Synchronous reconciliation with independent hook state and committed fiber trees
// for every root. Vendor nodes remain observable; validation cannot read the inputs
// captured by this fixture instead of inspecting those committed nodes.
function fixture() {
	const roots = [], dirty = new Set(), observers = new Map();
	let active;
	const components = (prefix, names) => Object.fromEntries(names.split(' ').map(name => [name, prefix + name]));
	globalThis.benchmarkRecharts = components('recharts:', 'LineChart CartesianGrid XAxis YAxis Legend Line Tooltip');
	globalThis.benchmarkMuiCharts = components('mui:', 'LineChart');
	globalThis.benchmarkFinancialCharts = components('financial:', 'ChartCanvas Chart XAxis YAxis LineSeries HoverTooltip');
	globalThis.benchmarkFinancialCharts.HoverTooltip = Object.assign(function HoverTooltip() {}, {
		defaultProps: {origin: (_props, {mouseXY}) => mouseXY},
	});
	globalThis.benchmarkVisxShape = components('visx:', 'LinePath');
	globalThis.benchmarkVisxAxis = components('visx:', 'AxisBottom AxisLeft');
	globalThis.benchmarkVisxGrid = components('visx:', 'GridRows');
	function scale({domain = [0, 1], range = [0, 1]} = {}) {
		const fn = value => range[0] + (+value - +domain[0]) / (+domain[1] - +domain[0]) * (range[1] - range[0]);
		fn.domain = value => { domain = value; return fn; };
		fn.ticks = () => domain;
		return fn;
	}
	globalThis.benchmarkD3Scale = {scaleTime: scale};
	globalThis.benchmarkVisxScale = {scaleTime: scale, scaleLinear: scale};
	globalThis.benchmarkReact = {
		Component: class {}, Fragment: 'Fragment',
		createElement(type, props, ...children) {
			assert.ok(type, 'React elements must use a defined component');
			return {type, props: {...props, ...(children.length ? {children: children.length === 1 ? children[0] : children} : {})}};
		},
		useState(initial) {
			const {record, root} = active;
			if (!('state' in record)) record.state = initial;
			return [record.state, next => { record.state = next; dirty.add(root); }];
		},
	};
	function reconcile(root, vnode, location = 'root') {
		if (!vnode || typeof vnode !== 'object') return null;
		const {type, props} = vnode;
		let record = root.records.get(location);
		if (!record || record.type !== type) {
			record = {type, native: {}};
			root.records.set(location, record); root.mounts++;
		}
		const fiber = {type, memoizedProps: props, child: null, sibling: null};
		record.fiber = fiber;
		let children = props.children;
		if (typeof type === 'function') {
			if (type.prototype.render) {
				record.component ??= new type(); record.component.props = props;
				children = record.component.render();
			}
			else { active = {record, root}; children = type(props); }
		}
		// Native visx axis labels render nested SVGs through @visx/text.
		if (type === 'visx:AxisBottom' || type === 'visx:AxisLeft') {
			const h = globalThis.benchmarkReact.createElement;
			children = h('g', null, ...Array.from({length: 5}, (_, i) =>
				h('svg', {key: i, x: i * 20, width: '1em', height: '1em', overflow: 'visible'},
					h('text', null, String(i)))));
		}
		if (type === 'financial:ChartCanvas') {
			record.native.props = props;
			record.native.state = {plotData: props.data, chartConfigs: [{}]};
			record.native.getCanvasContexts = () => ({axes: {}});
			props.ref(record.native);
		}
		let previous;
		[children].flat(Infinity).forEach((child, i) => {
			const node = reconcile(root, child, location + '/' + (child?.props?.key ?? i));
			if (!node) return;
			if (previous) previous.sibling = node; else fiber.child = node;
			previous = node;
		});
		return fiber;
	}
	function geometry(root) {
		const props = type => [...root.records.values()].filter(record => record.type === type).map(record => record.fiber.memoizedProps);
		const makePaths = (data, lines, className) => lines.map(line => ({
			className,
			d: data.map((row, i) => `${i ? 'L' : 'M'}${row.time},${line.yAccessor ? line.yAccessor(row) : row[line.dataKey]}`).join(''),
			getAttribute(name) { return name === 'd' ? this.d : null; },
		}));
		if (props('recharts:LineChart').length)
			root.element.paths = makePaths(props('recharts:LineChart')[0].data, props('recharts:Line'), 'recharts-line-curve');
		else if (props('mui:LineChart').length) {
			const p = props('mui:LineChart')[0];
			root.element.paths = makePaths(p.dataset, p.series, 'dashboard-line');
		}
		else if (props('visx:LinePath').length) {
			const lines = props('visx:LinePath');
			root.element.paths = makePaths(lines[0].data, lines.map(p => ({yAccessor: p.y})), 'dashboard-line');
		}
		for (const [observer, element] of observers) if (element === root.element) observer.callback();
	}
	globalThis.benchmarkReactDOM = {flushSync(fn) {
		fn();
		for (const root of dirty) {
			dirty.delete(root);
			root._internalRoot.current = {child: reconcile(root, root.tree)};
			if (!root.defer) geometry(root);
		}
		dirty.clear();
	}};
	globalThis.benchmarkReactDOMClient = {createRoot(element) {
		const root = {element, records: new Map(), renders: 0, mounts: 0, unmounts: 0,
			_internalRoot: {current: null},
			render(tree) { this.tree = tree; this.renders++; dirty.add(this); },
			unmount() { this.unmounts++; this._internalRoot.current = null; },
		};
		roots.push(root); return root;
	}};
	globalThis.MutationObserver = class {
		constructor(callback) { this.callback = callback; }
		observe(element) { observers.set(this, element); }
		disconnect() { observers.delete(this); }
	};
	function host() {
		return {children: [], ownerDocument: {createElement() {
			return {style: {}, paths: [], querySelectorAll(selector) {
				return this.paths.filter(path => selector === 'path' || selector === '.' + path.className);
			}, remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }};
		}}, append(element) { element.parent = this; this.children.push(element); }};
	}
	return {host, roots, observers, geometry};
}

const nativeData = (id, chart) => id === 'financialcharts' ? chart.instance.state.plotData :
	id === 'recharts' ? committedReactProps(chart, globalThis.benchmarkRecharts.LineChart)[0].data :
	id === 'muicharts' ? committedReactProps(chart, globalThis.benchmarkMuiCharts.LineChart)[0].dataset :
	committedReactProps(chart, globalThis.benchmarkVisxShape.LinePath)[0].data;

function replaceNativeData(id, chart, data) {
	if (id === 'financialcharts') chart.instance.state.plotData = data;
	else if (id === 'recharts') committedReactProps(chart, globalThis.benchmarkRecharts.LineChart)[0].data = data;
	else if (id === 'muicharts') committedReactProps(chart, globalThis.benchmarkMuiCharts.LineChart)[0].dataset = data;
	else for (const props of committedReactProps(chart, globalThis.benchmarkVisxShape.LinePath)) props.data = data;
}

describe('dashboard React adapters', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 2});
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]); else delete globalThis[key];
	}));

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: batches 20 independent roots at final size, retaining each root through full data replacement`, async () => {
			const f = fixture(), hosts = Array.from({length: CHARTS}, () => f.host());
			const small = freeze(dashboardData(2)).map(frame => freeze(adapter.prepData(frame)));
			const full = freeze(dashboardData()).map(frame => freeze(adapter.prepData(frame)));
			const waits = hosts.map(() => ({textContent: 'waiting'}));
			const handles = await Promise.all(hosts.map((host, i) => adapter.makeChart(small[i], host, waits[i])));
			assert.equal(new Set(handles.map(chart => chart.element)).size, CHARTS);
			assert.equal(new Set(handles.map(chart => chart.root)).size, CHARTS);
			assert.equal(f.roots.length, CHARTS);
			const instances = handles.map(chart => chart.instance), mounts = f.roots.map(root => root.mounts);
			for (let i = 0; i < CHARTS; i++) {
				assert.equal(adapter.validateChart(handles[i], small[i], {rows: 2}), true);
				assert.equal(waits[i].textContent, 'Done!');
				assert.deepEqual(handles[i].element.style, {width: `${WIDTH}px`, height: `${HEIGHT}px`, font: '12px Arial, sans-serif'});
				assert.equal(hosts[i].children.length, 1);
				assert.equal(small[i][0].time, dashboardData(2)[i].x[0]);
				SERIES.forEach(({id}, s) => assert.equal(small[i][1][id], dashboardData(2)[i].ys[s][1]));
			}
			await Promise.all(handles.map((chart, i) => adapter.updateChart(chart, full[i], hosts[i], waits[i])));
			for (let i = 0; i < CHARTS; i++) {
				assert.equal(adapter.validateChart(handles[i], full[i], {rows: ROWS}), true);
				assert.equal(nativeData(id, handles[i]), full[i]);
				assert.equal(handles[i].root, f.roots[i]);
				assert.equal(handles[i].instance, instances[i]);
				assert.equal(f.roots[i].renders, 1);
				assert.equal(f.roots[i].mounts, mounts[i]);
			}
			// Same-length updates must replace values, not just satisfy a point count.
			const changed = full.map(data => freeze(data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value + 7])))));
			await Promise.all(handles.map((chart, i) => adapter.updateChart(chart, changed[i], hosts[i])));
			handles.forEach((chart, i) => {
				assert.equal(adapter.validateChart(chart, changed[i], {rows: ROWS}), true);
				assert.throws(() => adapter.validateChart(chart, full[i], {rows: ROWS}), /current series/);
				adapter.destroyChart(chart);
				assert.equal(hosts[i].children.length, 0);
				assert.equal(f.roots[i].unmounts, 1);
			});
			await assert.rejects(adapter.updateChart(handles[0], full[0], hosts[0]), /not live/);
		});

		it(`${id}: validates all native rows and series, not a saved input or only endpoints`, async () => {
			const f = fixture(), host = f.host();
			const input = freeze(adapter.prepData(dashboardData()[0]));
			const chart = await adapter.makeChart(input, host);
			for (const {id: key} of SERIES) {
				const bad = input.map(row => ({...row}));
				bad[149][key] += 1;
				replaceNativeData(id, chart, bad);
				assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /current series/);
			}
			const bad = input.map(row => ({...row})); bad[149].time++;
			replaceNativeData(id, chart, bad);
			assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /current series/);
			replaceNativeData(id, chart, input);
			assert.throws(() => adapter.validateChart(chart, input, {rows: 2}), /current series/);
			assert.equal(adapter.validateChart(chart, input, {rows: ROWS}), true);
			if (id === 'financialcharts') {
				committedReactProps(chart, globalThis.benchmarkFinancialCharts.LineSeries)[4].yAccessor = row => row.s0;
				assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /current series/);
			}
			else {
				chart.element.paths[4].d = 'M0,0LNaN,0';
				assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /current series/);
				chart.element.paths.pop();
				assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /current series/);
			}
			adapter.destroyChart(chart);
			assert.throws(() => adapter.validateChart(chart, input, {rows: ROWS}), /unavailable/);
		});

		it(`${id}: does not accept missing native series even if data and geometry survive`, async () => {
			const f = fixture(), chart = await adapter.makeChart(adapter.prepData(dashboardData(2)[0]), f.host());
			const input = nativeData(id, chart);
			if (id === 'muicharts') committedReactProps(chart, globalThis.benchmarkMuiCharts.LineChart)[0].series.pop();
			else {
				const type = id === 'recharts' ? globalThis.benchmarkRecharts.Line : id === 'financialcharts' ?
					globalThis.benchmarkFinancialCharts.LineSeries : globalThis.benchmarkVisxShape.LinePath;
				[...chart.root.records.values()].find(record => record.type === type).fiber.type = 'missing';
			}
			assert.throws(() => adapter.validateChart(chart, input, {rows: 2}), /current series/);
			adapter.destroyChart(chart);
		});
	}

	for (const id of ['recharts', 'muicharts', 'financialcharts']) it(`${id}: retains native hover configuration through data replacement`, async () => {
		const f = fixture(), adapter = adapters[id], host = f.host();
		const inputs = [dashboardData(2)[0], dashboardData()[0]].map(adapter.prepData);
		const chart = await adapter.makeChart(inputs[0], host);
		try {
			for (const [i, input] of inputs.entries()) {
				if (i) await adapter.updateChart(chart, input, host);
				if (id === 'recharts') {
					const C = globalThis.benchmarkRecharts;
					const tooltips = committedReactProps(chart, C.Tooltip);
					assert.equal(tooltips.length, 1);
					assert.equal(tooltips[0].isAnimationActive, false);
					assert.notEqual(tooltips[0].cursor, false);
					assert.equal(tooltips[0].labelFormatter(input[0].time), calendarLabel(input[0].time));
					assert.equal(committedReactProps(chart, C.Legend)[0].verticalAlign, 'top');
					for (const line of committedReactProps(chart, C.Line)) {
						assert.equal(line.dot, false);
						assert.equal(line.isAnimationActive, false);
						assert.notEqual(line.activeDot, false);
					}
				}
				else if (id === 'muicharts') {
					const props = committedReactProps(chart, globalThis.benchmarkMuiCharts.LineChart)[0];
					assert.equal(props.skipAnimation, true);
					assert.notEqual(props.slotProps.tooltip?.trigger, 'none');
					assert.equal(props.slots?.tooltip, undefined, 'use the native tooltip');
					assert.equal(props.slotProps.legend.position.vertical, 'top');
					assert.equal(props.xAxis[0].height, 35);
					for (const series of props.series) {
						assert.equal(series.showMark, false);
						assert.notEqual(series.disableHighlight, true);
					}
				}
				else {
					const tooltips = committedReactProps(chart, globalThis.benchmarkFinancialCharts.HoverTooltip);
					assert.equal(tooltips.length, 1);
					const size = {width: 125, height: 124};
					for (const [nativeY, expectedY] of [[-20, 0], [10, 10], [120, 30]]) {
						assert.deepEqual(tooltips[0].origin(tooltips[0], {height: 154, mouseXY: [75, nativeY]}, size, 1),
							[75, expectedY], 'clamp vertically without changing native horizontal placement');
					}
					for (const index of new Set([0, Math.floor(input.length / 2), input.length - 1])) {
						const currentItem = input[index];
						assert.deepEqual(tooltips[0].tooltip.content({currentItem}), {
							x: calendarLabel(currentItem.time),
							y: SERIES.map(({id, label, color}) => ({label, value: String(currentItem[id]), stroke: color})),
						});
					}
				}
			}
		}
		finally { adapter.destroyChart(chart); }
	});

	it('visx: validates the root plot dimensions independently of nested axis-label SVGs', async () => {
		const f = fixture(), input = visx.prepData(dashboardData()[0]);
		const chart = await visx.makeChart(input, f.host());
		try {
			const svgs = committedReactProps(chart, 'svg');
			assert.equal(svgs.length, 11, 'one plot SVG and ten nested axis-label SVGs');
			assert.equal(chart.element.querySelectorAll('.dashboard-line').length, 5);
			assert.equal(visx.validateChart(chart, input, {rows: ROWS}), true);
			const plot = svgs.find(props => props.role === 'img');
			for (const dimension of ['width', 'height']) {
				const previous = plot[dimension];
				plot[dimension] = previous - 1;
				assert.throws(() => visx.validateChart(chart, input, {rows: ROWS}), /current series/);
				plot[dimension] = previous;
			}
			delete plot.role;
			assert.throws(() => visx.validateChart(chart, input, {rows: ROWS}), /current series/);
		}
		finally { visx.destroyChart(chart); }
	});

	it('keeps original helper defaults and supports explicit initial dimensions', async () => {
		const f = fixture();
		for (const size of [undefined, {width: WIDTH, height: HEIGHT}]) {
			let committed;
			const chart = await mountLifecycleReact([], f.host(), (data, React, handle, state) => {
				committed = state; return React.createElement('svg', {width: state.width, height: state.height});
			}, () => {}, undefined, size);
			assert.equal(committed.width, size?.width ?? 1920);
			assert.equal(committed.height, size?.height ?? 600);
			assert.equal(chart.element.style.width, `${committed.width}px`);
			assert.equal(chart.element.style.height, `${committed.height}px`);
			destroyReact(chart);
		}
	});

	it('waitForLines defaults to three, but five-line readiness rejects partial output and handles aborts', async () => {
		const f = fixture();
		const chart = await mountReact(f.host(), React => React.createElement('div'), () => {});
		const path = () => ({className: 'line', getAttribute: () => 'M0,0L1,1'});
		chart.element.paths = Array.from({length: 3}, path);
		assert.equal(waitForLines(chart, '.line'), undefined);
		let done = false;
		const pending = waitForLines(chart, '.line', undefined, 5).then(() => { done = true; });
		await Promise.resolve(); assert.equal(done, false); assert.equal(f.observers.size, 1);
		chart.element.paths.push(path(), path());
		for (const observer of f.observers.keys()) observer.callback();
		await pending; assert.equal(f.observers.size, 0);
		chart.element.paths.pop();
		const failed = waitForLines(chart, '.line', undefined, 5);
		const boundary = [...chart.root.records.values()].find(record => record.component).component;
		boundary.componentDidCatch(new Error('native failed'));
		await assert.rejects(failed, /native failed/); assert.equal(f.observers.size, 0);
		destroyReact(chart);
	});

	it('cleans up a failed mount without disturbing another dashboard root', async () => {
		const f = fixture(), host = f.host(), input = recharts.prepData(dashboardData(2)[0]);
		const good = await recharts.makeChart(input, host);
		const failedHost = f.host(), wait = {textContent: 'waiting'};
		delete globalThis.benchmarkMuiCharts;
		await assert.rejects(muicharts.makeChart(input, failedHost, wait), /Load benchmarkMuiCharts/);
		assert.equal(failedHost.children.length, 0); assert.equal(wait.textContent, 'waiting');
		assert.equal(f.roots[1].unmounts, 1);
		assert.equal(recharts.validateChart(good, input, {rows: 2}), true);
		recharts.destroyChart(good);
	});
});
