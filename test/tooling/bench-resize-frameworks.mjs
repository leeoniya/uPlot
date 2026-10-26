import assert from 'node:assert/strict';
import * as recharts from '../../bench/recharts.mjs';
import * as muicharts from '../../bench/muicharts.mjs';
import * as financialcharts from '../../bench/financialcharts.mjs';
import * as visx from '../../bench/visx.mjs';
import * as bokeh from '../../bench/bokeh.mjs';
import * as bokehCanvas from '../../bench/bokeh-canvas.mjs';
import * as g2 from '../../bench/g2.mjs';
import * as g2Webgl from '../../bench/g2-webgl.mjs';

const dimensions = {width: 1200, height: 400};
const data = Object.freeze([
	Object.freeze({time: 1000, cpu: 20, ram: 30, tcp: 100}),
	Object.freeze({time: 2000, cpu: 60, ram: 40, tcp: 200}),
]);
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
};
async function pending(promise, wait) {
	let done = false;
	promise.then(() => { done = true; });
	for (let i = 0; i < 5; i++) await Promise.resolve();
	assert.equal(done, false);
	assert.equal(wait.textContent, 'waiting');
}

// A small synchronous reconciler exercises the real adapter and lifecycle code
// without downloading React or launching a browser. Records survive only when
// the component type, key, and position stay the same, as in React reconciliation.
function reactFixture() {
	const records = new Map(), observers = new Set();
	const paths = Array.from({length: 3}, () => ({d: '', getAttribute() { return this.d; }}));
	let tree, active, dirty = false, deferGeometry = false;
	let roots = 0, renders = 0, unmounts = 0, mounts = 0;
	const element = {style: {}, querySelectorAll: () => paths, remove() {}};
	const host = {style: {width: '1920px', height: '600px'}, ownerDocument: {createElement: () => element}, append() {}};
	function reconcile(vnode, location = 'root') {
		if (!vnode || typeof vnode !== 'object') return;
		const {type, props} = vnode;
		let record = records.get(location);
		if (!record || record.type !== type || record.key !== props.key) {
			record = {type, key: props.key, native: {}};
			records.set(location, record); mounts++;
		}
		record.props = props;
		if (typeof type === 'function') {
			if (type.prototype.render) {
				record.component ??= new type();
				record.component.props = props;
				reconcile(record.component.render(), location + '/child');
			}
			else {
				active = record;
				reconcile(type(props), location + '/child');
			}
			return;
		}
		if (type === 'ChartCanvas') {
			record.native.props = props;
			record.native.state = {plotData: props.data, chartConfigs: [{}, {}]};
			record.native.getCanvasContexts ??= () => ({axes: {}});
			props.ref(record.native);
		}
		[props.children].flat(Infinity).forEach((child, i) => reconcile(child, location + '/' + (child?.props?.key ?? i)));
	}
	function geometry() {
		const surface = [...records.values()].find(r => r.type === 'LineChart' || r.type === 'svg' || r.type === 'ChartCanvas');
		paths.forEach((path, i) => { path.d = `M0,${i}L${surface.props.width},${surface.props.height - i}`; });
		for (const callback of observers) callback();
	}
	globalThis.benchmarkReact = {
		Component: class {}, Fragment: 'Fragment',
		createElement(type, props, ...children) { return {type, props: {...props, children: children.length === 1 ? children[0] : children}}; },
		useState(initial) {
			const record = active;
			if (!('state' in record)) record.state = initial;
			return [record.state, next => { record.state = next; dirty = true; }];
		},
	};
	globalThis.benchmarkReactDOM = {flushSync(fn) {
		fn();
		if (dirty) { dirty = false; reconcile(tree); if (!deferGeometry) geometry(); }
	}};
	globalThis.benchmarkReactDOMClient = {createRoot() {
		roots++;
		return {render(next) { renders++; tree = next; dirty = true; }, unmount() { unmounts++; }};
	}};
	globalThis.MutationObserver = class {
		constructor(callback) { this.callback = callback; }
		observe() { observers.add(this.callback); }
		disconnect() { observers.delete(this.callback); }
	};
	function scale({domain = [0, 1], range = [0, 1]} = {}) {
		const fn = value => range[0] + (Number(value) - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
		fn.domain = value => { domain = value; return fn; };
		fn.ticks = () => domain;
		return fn;
	}
	const components = names => Object.fromEntries(names.split(' ').map(name => [name, name]));
	globalThis.benchmarkRecharts = components('LineChart CartesianGrid XAxis YAxis Legend Tooltip Line');
	globalThis.benchmarkMuiCharts = components('LineChart');
	globalThis.benchmarkFinancialCharts = components('ChartCanvas Chart XAxis YAxis LineSeries');
	globalThis.benchmarkD3Scale = {scaleTime: scale};
	globalThis.benchmarkVisxScale = {scaleTime: scale, scaleLinear: scale};
	globalThis.benchmarkVisxShape = components('LinePath');
	globalThis.benchmarkVisxAxis = components('AxisBottom AxisLeft AxisRight');
	globalThis.benchmarkVisxGrid = components('GridRows');
	return {
		host, element, records, paths, observers,
		defer() { deferGeometry = true; },
		commitGeometry: geometry,
		props(type) { return [...records.values()].filter(r => r.type === type).map(r => r.props); },
		counts: () => ({roots, renders, unmounts, mounts}),
	};
}

const globals = ['benchmarkReact', 'benchmarkReactDOM', 'benchmarkReactDOMClient', 'MutationObserver',
	'benchmarkRecharts', 'benchmarkMuiCharts', 'benchmarkFinancialCharts', 'benchmarkD3Scale',
	'benchmarkVisxScale', 'benchmarkVisxShape', 'benchmarkVisxAxis', 'benchmarkVisxGrid', 'devicePixelRatio', 'G2'];

describe('retained framework resize hooks', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
		else delete globalThis[key];
	}));

	for (const [id, adapter] of Object.entries({recharts, muicharts, financialcharts, visx})) {
		for (const factory of ['makeChart', 'makeLifecycleChart', 'makeEmptyChart']) {
			it(`${id}/${factory}: retains root, boundary, components, data and keys while changing dimensions`, async () => {
				const fixture = reactFixture(), wait = {textContent: ''};
				const chart = factory === 'makeEmptyChart' ? await adapter[factory](fixture.host, wait) : await adapter[factory](data, fixture.host, wait);
				if (factory === 'makeEmptyChart') await adapter.updateChart(chart, data, fixture.host, wait);
				const root = chart.root, instance = chart.instance, counts = fixture.counts();
				const records = [...fixture.records.values()];
				const oldPaths = fixture.paths.map(p => p.d);
				globalThis.devicePixelRatio = 3; // Resizing must preserve ChartCanvas's original ratio.
				fixture.host.style.width = '1200px'; fixture.host.style.height = '400px';
				wait.textContent = 'waiting';
				assert.equal(await adapter.resizeChart(chart, dimensions, fixture.host, wait), undefined);
				assert.equal(wait.textContent, 'Done!');
				assert.equal(chart.root, root); assert.equal(chart.instance, instance);
				assert.deepEqual(fixture.counts(), counts);
				[...fixture.records.values()].forEach((record, i) => assert.equal(record, records[i]));
				assert.deepEqual(fixture.element.style, {width: '1200px', height: '400px', font: '12px Arial, sans-serif'});
				assert.notDeepEqual(fixture.paths.map(p => p.d), oldPaths);
				if (id === 'visx') {
					assert.equal(fixture.props('svg')[0].width, 1200);
					assert.equal(fixture.props('svg')[0].height, 400);
					assert.equal(fixture.props('text')[0].x, 600);
					assert.equal(fixture.props('GridRows')[0].width, 1040);
					assert.equal(fixture.props('AxisBottom')[0].top, 300);
					assert.equal(fixture.props('AxisRight')[0].left, 1040);
					fixture.props('LinePath').forEach(props => {
						assert.equal(props.data, data);
						assert.equal(props.x(data[1]), 1040);
					});
					assert.equal(fixture.props('LinePath')[2].y(data[0]), 300);
				}
				else {
					const props = fixture.props(id === 'financialcharts' ? 'ChartCanvas' : 'LineChart')[0];
					assert.equal(props.width, 1200);
					assert.equal(props.height, id === 'financialcharts' ? 350 : 360);
					assert.equal(props.data ?? props.dataset, data);
					if (id === 'financialcharts') assert.equal(props.ratio, 2);
				}
				// A data update after resize must not restore the initial dimensions.
				await adapter.updateChart(chart, data, fixture.host, wait);
				assert.equal(fixture.props(id === 'visx' ? 'svg' : id === 'financialcharts' ? 'ChartCanvas' : 'LineChart')[0].width, 1200);
				await adapter.resizeChart(chart, dimensions, fixture.host, wait);
				adapter.destroyChart(chart);
				await assert.rejects(adapter.resizeChart(chart, dimensions), /not live/);
			});
		}
		if (id !== 'financialcharts') it(`${id}: committed dimensions and old SVG lines are not resize readiness`, async () => {
			const fixture = reactFixture(), wait = {textContent: 'waiting'};
			const chart = await adapter.makeLifecycleChart(data, fixture.host);
			fixture.defer();
			const resize = adapter.resizeChart(chart, dimensions, fixture.host, wait);
			await pending(resize, wait);
			assert.equal(fixture.observers.size, 1);
			// A partial vendor commit still leaves one stale series.
			fixture.paths[0].d = 'M0,0L1200,400';
			for (const callback of fixture.observers) callback();
			await pending(resize, wait);
			fixture.commitGeometry();
			await resize;
			assert.equal(wait.textContent, 'Done!');
			assert.equal(fixture.observers.size, 0);
			adapter.destroyChart(chart);
		});
	}

	it('React: rejects an uncommitted dimension update even when complete paths exist', async () => {
		const fixture = reactFixture(), wait = {textContent: 'waiting'};
		const chart = await visx.makeLifecycleChart(data, fixture.host);
		const flushSync = chart.flushSync;
		chart.flushSync = () => {};
		await assert.rejects(visx.resizeChart(chart, dimensions, fixture.host, wait), /did not commit resized dimensions/);
		assert.equal(wait.textContent, 'waiting');
		chart.flushSync = flushSync;
		visx.destroyChart(chart);
	});

	it('React: propagates boundary failures during resize and does not report completion', async () => {
		const fixture = reactFixture(), wait = {textContent: 'waiting'};
		const chart = await visx.makeLifecycleChart(data, fixture.host);
		fixture.defer();
		const resize = visx.resizeChart(chart, dimensions, fixture.host, wait);
		const boundary = [...fixture.records.values()].find(record => record.component).component;
		boundary.componentDidCatch(new Error('vendor resize failed'));
		await assert.rejects(resize, /vendor resize failed/);
		assert.equal(wait.textContent, 'waiting');
		assert.equal(fixture.observers.size, 0);
		visx.destroyChart(chart);
	});

	for (const [id, adapter] of Object.entries({bokeh, 'bokeh-canvas': bokehCanvas})) {
		it(`${id}: sets dimensions on the retained model and waits for the stable ready chain and layout`, async () => {
			const first = deferred(), second = deferred(), source = {data}, renderers = [{data_source: source}];
			let bounds = {width: 1920, height: 600};
			const view = {ready: Promise.resolve(), is_destroyed: false, el: {getBoundingClientRect: () => bounds}};
			const model = view.model = {width: 1920, height: 600, renderers, setv(size) {
				Object.assign(this, size); view.ready = first.promise;
			}};
			const wait = {textContent: 'waiting'};
			const resize = adapter.resizeChart(view, dimensions, {}, wait);
			assert.equal(model.width, 1200); assert.equal(model.height, 400);
			await pending(resize, wait);
			view.ready = second.promise; first.resolve();
			await pending(resize, wait);
			bounds = dimensions; second.resolve();
			assert.equal(await resize, undefined);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(view.model, model); assert.equal(view.model.renderers, renderers);
			assert.equal(renderers[0].data_source, source); assert.equal(source.data, data);
			bounds = {width: 1920, height: 600}; wait.textContent = 'waiting';
			await assert.rejects(adapter.resizeChart(view, dimensions, {}, wait), /did not commit resized dimensions/);
			assert.equal(wait.textContent, 'waiting');
			model.setv = () => { view.ready = Promise.reject(new Error('Bokeh layout failed')); };
			await assert.rejects(adapter.resizeChart(view, dimensions, {}, wait), /Bokeh layout failed/);
			assert.equal(wait.textContent, 'waiting');
			view.is_destroyed = true;
			await assert.rejects(adapter.resizeChart(view, dimensions), /not live/);
		});
	}

	for (const [id, adapter] of Object.entries({g2, 'g2-webgl': g2Webgl})) {
		it(`${id}: awaits native changeSize without replacing options, data, renderer or chart`, async () => {
			const ready = deferred(), options = {data}, renderer = {}, calls = [];
			const chart = {options, renderer, changeSize(width, height) {
				calls.push([width, height]); return ready.promise;
			}};
			const wait = {textContent: 'waiting'};
			const resize = adapter.resizeChart(chart, dimensions, {}, wait);
			assert.deepEqual(calls, [[1200, 400]]);
			await pending(resize, wait);
			ready.resolve(); assert.equal(await resize, undefined);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(chart.options, options); assert.equal(options.data, data); assert.equal(chart.renderer, renderer);
			chart.changeSize = async () => { throw new Error('native resize failed'); };
			wait.textContent = 'waiting';
			await assert.rejects(adapter.resizeChart(chart, dimensions, {}, wait), /native resize failed/);
			assert.equal(wait.textContent, 'waiting');
		});
	}

	it('G2: constructs a fixed-size chart with autoFit disabled', async () => {
		let initial;
		globalThis.G2 = {Chart: class {
			constructor(options) { initial = options; }
			options(options) { this.spec = options; }
			async render() {}
		}};
		const host = {}, chart = await g2.makeChart(data, host);
		assert.deepEqual(initial, {container: host, width: 1920, height: 600, autoFit: false});
		assert.equal(chart.spec.data, data);
	});
});
