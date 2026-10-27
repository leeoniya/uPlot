import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {it as test} from 'node:test';
import * as hover from '../../bench/hover.mjs';

// These doubles exercise adapter geometry and completion contracts, not vendor rendering.
const source = name => readFileSync(new URL(`../../bench/${name}.mjs`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const target = {width: 1200, height: 400};
function load(name, globals = {}) {
	return runInNewContext(source(name).replace(/^import .* from '\.\/hover\.mjs';\s*$/gm, '').replace(/^export \{[^\n]+\};\s*$/gm, '') +
		'\n({makeChart, resizeChart, updateChart, destroyChart: typeof destroyChart === "function" ? destroyChart : c => c.destroy(), makeChartWithOptions: typeof makeChartWithOptions === "function" ? makeChartWithOptions : null});',
		{devicePixelRatio: 1, queueMicrotask, ...hover, ...globals});
}
function context2d() {
	const calls = [];
	return Object.fromEntries(['scale', 'setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'save', 'restore', 'rect', 'clip', 'fillText', 'arc', 'fill', 'closePath']
		.map(name => [name, (...args) => calls.push([name, ...args])]).concat([['calls', calls]]));
}
function node(tag = 'div') {
	const ctx = context2d();
	const n = {tag, attrs: {}, style: {}, children: [], handlers: {}, ctx,
		ownerDocument: {createElement: node},
		append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
		get lastElementChild() { return this.children.at(-1); },
		getContext(type) { return type === '2d' ? ctx : this.gl ??= glContext(this); },
		addEventListener(type, fn) { this.handlers[type] = fn; },
		removeEventListener(type) { delete this.handlers[type]; },
		remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); },
		querySelector(selector) { return descendants(this).find(child => matches(child, selector)); },
	};
	return n;
}
function glContext(canvas) {
	return {canvas, COLOR_BUFFER_BIT: 1, NO_ERROR: 0, error: 0, calls: [],
		get drawingBufferWidth() { return +canvas.attrs.width; },
		get drawingBufferHeight() { return +canvas.attrs.height; },
		viewport(...args) { this.calls.push(['viewport', ...args]); },
		clearColor() {}, clear() {}, flush() { this.calls.push(['flush']); },
		getError() { return this.error; }, isContextLost() { return false; },
		getExtension() { return {loseContext() {}}; },
	};
}
const descendants = n => n.children.flatMap(child => [child, ...descendants(child)]);
const matches = (n, s) => s[0] === '.' ? n.attrs.class?.split(' ').includes(s.slice(1)) : s[0] === '#' ? n.attrs.id === s.slice(1) : n.tag === s;
class Selection {
	constructor(nodes, parent) { this.nodes = nodes; this.parent = parent; }
	node() { return this.nodes[0]; }
	append(tag) { return new Selection(this.nodes.map(parent => { const child = node(tag); child.data = parent.data; parent.append(child); return child; })); }
	attr(key, value) { this.nodes.forEach((n, i) => { n.attrs[key] = typeof value === 'function' ? value(n.data, i) : value; }); return this; }
	style(key, value) { this.nodes.forEach(n => { n.style[key] = value; }); return this; }
	text(value) { this.nodes.forEach((n, i) => { n.textContent = typeof value === 'function' ? value(n.data, i) : value; }); return this; }
	select(selector) { return new Selection(this.nodes.map(n => n.querySelector(selector)).filter(Boolean)); }
	selectAll(selector) { return new Selection(this.nodes.flatMap(n => descendants(n).filter(child => matches(child, selector))), this.nodes[0]); }
	data(values) { this.values = Array.from(values); this.nodes.forEach((n, i) => { n.data = values[i]; }); return this; }
	join(tag) {
		while (this.nodes.length > this.values.length) this.nodes.pop().remove();
		while (this.nodes.length < this.values.length) { const child = node(tag); this.parent.append(child); this.nodes.push(child); }
		this.nodes.forEach((n, i) => { n.data = this.values[i]; }); return this;
	}
	call(fn) { fn(this); return this; }
	on(type, fn) { this.nodes.forEach(n => { n.handlers[type] = fn; }); return this; }
	remove() { this.nodes.forEach(n => n.remove()); return this; }
}
function scale() {
	let domain = [0, 1], range = [0, 1];
	const s = value => range[0] + (+value - +domain[0]) / (+domain[1] - +domain[0] || 1) * (range[1] - range[0]);
	s.domain = value => value ? (domain = value, s) : domain;
	s.range = value => value ? (range = value, s) : range;
	s.nice = () => s;
	s.copy = () => scale().domain(domain.slice()).range(range.slice());
	s.ticks = () => [domain[0], domain[1]];
	s.tickFormat = () => String;
	s.invert = value => +domain[0] + (value - range[0]) / (range[1] - range[0]) * (+domain[1] - +domain[0]);
	return s;
}
function path() {
	const points = [];
	return {points, moveTo(x, y) { points.push(['M', x, y]); }, lineTo(x, y) { points.push(['L', x, y]); }, closePath() {},
		toString() { return points.map(p => p.join(' ')).join(' '); }};
}
function line() {
	let x, y, defined = () => true, ctx = null;
	const draw = values => {
		const p = ctx ?? path(); let active = false;
		values.forEach((v, i) => { if (!defined(v)) active = false; else { p[active ? 'lineTo' : 'moveTo'](x(v, i), y(v, i)); active = true; } });
		return ctx ? undefined : p.toString();
	};
	for (const [key, setter] of Object.entries({x: v => { x = v; }, y: v => { y = v; }, defined: v => { defined = v; }, context: v => { ctx = v; }}))
		draw[key] = v => { setter(v); return draw; };
	draw.digits = () => draw;
	return draw;
}
function axis(s) {
	let tickSize;
	const a = selection => { selection.node().axis = {range: [...s.range()], tickSize}; };
	a.ticks = a.tickFormat = () => a;
	a.tickSize = value => { tickSize = value; return a; };
	return a;
}
const d3 = {select: n => new Selection([n]), scaleTime: scale, scaleLinear: scale, line, path,
	min: values => Math.min(...values), max: values => Math.max(...values), extent: values => [Math.min(...values), Math.max(...values)],
	axisLeft: axis, axisRight: axis, axisBottom: axis, pointer: event => event.point,
	bisectCenter: (xs, value) => xs.reduce((best, x, i) => Math.abs(x - value) < Math.abs(xs[best] - value) ? i : best, 0),
	color: () => ({r: 255, g: 0, b: 0}),
};
function fixture(svg) {
	const host = node(), surface = node(); surface.attrs.class = 'chart'; host.append(surface);
	for (const id of ['plot', ...(svg ? [] : ['overlay'])]) { const n = node(svg ? 'svg' : 'canvas'); n.attrs.id = id; surface.append(n); }
	for (const id of ['cpu-value', 'ram-value', 'tcp-value']) { const n = node(); n.attrs.id = id; host.append(n); }
	return host;
}
function data(count = 4) {
	const xs = Array.from({length: count}, (_, i) => i * 60000);
	return [xs, xs.map((_, i) => i % 2 ? 100 : 0), xs.map((_, i) => i % 3 ? 80 : 20), xs.map((_, i) => i % 2 ? 20 : 0)].map(Object.freeze);
}
const columns = values => Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map((key, i) => [key, values[i]]));

for (const ratio of [1, 1.5, 2]) for (const renderer of ['canvas', 'svg']) for (const minmax of [false, true]) {
	test(`D3 ${renderer}, minmax=${minmax}, DPR=${ratio}: in-place resize, isolation and update`, async () => {
		const frames = new Map(); let nextFrame = 0;
		const adapter = load('d3', {d3, devicePixelRatio: ratio,
			requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id)});
		const input = data(6000 * ratio), host = fixture(renderer === 'svg'), otherHost = fixture(renderer === 'svg');
		const chart = adapter.makeChartWithOptions(input, host, null, null, {renderer, minmax});
		const other = adapter.makeChartWithOptions(data(), otherHost, null, null, {renderer, minmax});
		await Promise.resolve();
		const plot = host.querySelector('#plot'), overlay = renderer === 'svg' ? host.querySelector('.overlay') : host.querySelector('#overlay');
		const originalNodes = descendants(host).slice(), otherState = renderer === 'svg' ? otherHost.querySelector('.series').children[0].attrs.d : otherHost.querySelector('#plot').width;
		overlay.handlers.pointermove({offsetX: 100, point: [100, 50]}); assert.equal(frames.size, 1);
		plot.ctx.calls.length = 0;
		const wait = {textContent: 'waiting'};
		assert.equal(adapter.resizeChart(chart, target, host, wait), undefined);
		assert.equal(frames.size, 0); assert.equal(wait.textContent, 'Done!');
		assert.deepEqual(descendants(host), originalNodes, 'surfaces and SVG nodes must survive');
		assert.equal(host.querySelector('.chart').style.width, '1200px');
		assert.equal(plot.style.height, '400px');
		if (renderer === 'canvas') {
			assert.equal(plot.width, 1200 * ratio); assert.equal(plot.height, 400 * ratio);
			assert.equal(overlay.width, plot.width); assert.equal(overlay.height, plot.height);
			assert.ok(plot.ctx.calls.some(c => c[0] === 'rect' && c[1] === 55 && c[3] === 1075 && c[4] === 360));
			assert.deepEqual(plot.ctx.calls.find(c => c[0] === 'scale'), ['scale', ratio, ratio]);
			const vertices = plot.ctx.calls.filter(c => c[0] === 'lineTo');
			assert.ok(minmax ? vertices.length < input[0].length * 3 : vertices.length >= (input[0].length - 1) * 3);
		}
		else {
			assert.equal(plot.attrs.width, 1200); assert.equal(overlay.attrs.height, 400);
			const clip = host.querySelector('clipPath').children[0];
			assert.equal(clip.attrs.width, 1075); assert.equal(clip.attrs.height, 360);
			assert.equal(host.querySelector('.cursor').children[0].attrs.y2, 370);
			const p = host.querySelector('.series').children[0].attrs.d;
			assert.ok(p.includes(String((Math.round(1130 * ratio) + 0.5) / ratio)));
			const vertices = (p.match(/L/g) ?? []).length;
			assert.ok(minmax ? vertices < input[0].length - 1 : vertices === input[0].length - 1);
		}
		assert.equal(renderer === 'svg' ? otherHost.querySelector('.series').children[0].attrs.d : otherHost.querySelector('#plot').width, otherState);
		adapter.updateChart(chart, data(8), host);
		adapter.resizeChart(chart, {width: 1600, height: 500}, host);
		adapter.resizeChart(chart, target, host);
		assert.throws(() => adapter.resizeChart(chart, {width: 100, height: 400}, host), /positive plot area/);
		adapter.destroyChart(chart); adapter.destroyChart(other);
		assert.throws(() => adapter.resizeChart(chart, target, host), /not live/);
	});
}

function fcMock() {
	const created = [];
	function series() {
		const state = {}, draws = [];
		const s = values => { draws.push({values, x: [...state.xScale.range()], y: [...state.yScale.range()], lastX: state.xScale(state.crossValue(null, values.length - 1))}); };
		for (const key of ['context', 'xScale', 'yScale', 'crossValue', 'mainValue', 'decorate', 'pixelRatio', 'lineWidth', 'scaleMapper', 'equals'])
			s[key] = value => { state[key] = value; return s; };
		s.draws = draws; s.state = state; created.push(s); return s;
	}
	return {created, seriesCanvasLine: series, seriesWebglLine: series, webglScaleLinear: scale,
		webglStrokeColor: () => ({value: () => () => {}})};
}
for (const renderer of ['canvas', 'webgl']) test(`d3fc ${renderer}: backing size, scales, axes, cursor and retained series`, async () => {
	const fc = fcMock(), adapter = load('d3fc', {d3, fc, devicePixelRatio: 2}), input = columns(data());
	const host = node(), chart = await adapter.makeChartWithOptions(input, host, null, null, {renderer});
	const canvas = chart.element.querySelector('canvas'), svg = chart.element.querySelector('svg'), originalNodes = descendants(chart.element).slice();
	const originalSeries = chart.series.slice();
	const wait = {textContent: 'waiting'};
	assert.equal(adapter.resizeChart(chart, target, host, wait), undefined);
	assert.equal(wait.textContent, 'Done!'); assert.equal(canvas.attrs.width, 2100); assert.equal(canvas.attrs.height, 600);
	assert.equal(canvas.style.width, '1050px'); assert.equal(svg.attrs.width, 1200); assert.equal(svg.children[0].attrs.x, 600);
	assert.deepEqual(chart.series, originalSeries); assert.deepEqual(descendants(chart.element), originalNodes);
	chart.series.forEach((s, i) => { assert.equal(s.draws.at(-1).values, input[['cpu', 'ram', 'tcp'][i]]); assert.deepEqual(s.draws.at(-1).x, [0, 1050]); assert.deepEqual(s.draws.at(-1).y, [300, 0]); });
	const axes = svg.children[2];
	assert.equal(axes.children[0].axis.tickSize, -1050);
	assert.equal(axes.children[1].attrs.transform, 'translate(0,300)');
	assert.equal(axes.children[3].attrs.transform, 'translate(1050,0)');
	assert.equal(axes.children[4].children[0].attrs.y2, 300);
	svg.handlers['pointermove.benchmark']({point: [1500, 100]}); assert.equal(axes.children[4].attrs.display, 'none');
	if (renderer === 'webgl') assert.deepEqual(chart.context.calls.find(c => c[0] === 'viewport' && c[3] === 2100), ['viewport', 0, 0, 2100, 600]);
	else assert.deepEqual(chart.context.calls.at(-2), ['setTransform', 2, 0, 0, 2, 0, 0]);
	const next = columns(data(8)); adapter.updateChart(chart, next); adapter.resizeChart(chart, {width: 1500, height: 500});
	chart.series.forEach((s, i) => assert.equal(s.draws.at(-1).values, next[['cpu', 'ram', 'tcp'][i]]));
	assert.equal(fc.created.length, 3);
	adapter.destroyChart(chart); assert.throws(() => adapter.resizeChart(chart, target), /not live/);
});

function deckMock() {
	const instances = [];
	class Deck {
		constructor(props) {
			this.props = props; this.width = props.width; this.height = props.height; this.buffers = [];
			this.device = {getDefaultCanvasContext: () => ({setDrawingBufferSize: (...size) => this.buffers.push(size)})};
			instances.push(this); queueMicrotask(() => this.redraw());
		}
		setProps(props) { Object.assign(this.props, props); }
		redraw() { this.props.onAfterRender({gl: this.props.gl}); }
		finishResize() { this.width = this.props.width; this.height = this.props.height; this.redraw(); }
		finalize() {}
	}
	return {instances, Deck, PathLayer: class { constructor(props) { this.props = props; } }, OrthographicView: class {}, COORDINATE_SYSTEM: {CARTESIAN: 0}};
}
test('Deck: retains wrapper/context, rebuilds paths and waits for the resized viewport draw', async () => {
	const deck = deckMock(), adapter = load('deckgl', {d3, deck, devicePixelRatio: 2}), input = columns(data()), host = node();
	const chart = await adapter.makeChart(input, host), instance = chart.deck, canvas = chart.canvas.node(), originalNodes = descendants(chart.element).slice();
	const ids = instance.props.layers.map(l => l.props.id), before = instance.props.layers[0].props.data[0].at(-2);
	const wait = {textContent: 'waiting'}; let done = false;
	const resizing = adapter.resizeChart(chart, target, host, wait).then(value => { done = true; return value; });
	await Promise.resolve(); assert.equal(done, false); assert.equal(wait.textContent, 'waiting');
	assert.equal(instance.props.width, 1050); assert.equal(instance.props.height, 300);
	assert.equal(canvas.attrs.width, 2100); assert.equal(canvas.attrs.height, 600);
	assert.deepEqual(instance.buffers, [[2100, 600]]);
	assert.deepEqual(plain(instance.props.viewState.target), [525, 150, 0]);
	assert.equal(instance.props.layers[0].props.data[0].at(-2), 1050); assert.notEqual(before, 1050);
	assert.deepEqual(instance.props.layers.map(l => l.props.id), ids);
	assert.equal(instance.props.layers[0].props.data[0].length, input.x.length * 2);
	instance.finishResize(); assert.equal(await resizing, undefined); assert.equal(wait.textContent, 'Done!');
	assert.equal(chart.deck, instance); assert.equal(chart.canvas.node(), canvas); assert.deepEqual(descendants(chart.element), originalNodes);
	await adapter.updateChart(chart, columns(data(8)), host);
	await adapter.resizeChart(chart, target, host);
	assert.equal(instance.props.layers[0].props.data[0].length, 16);
	assert.equal(deck.instances.length, 1);
	chart.context.error = 1;
	await assert.rejects(adapter.resizeChart(chart, target, host), /WebGL2 initial draw failed/);
	adapter.destroyChart(chart);
	await assert.rejects(adapter.resizeChart(chart, target, host), /WebGL2 initial draw failed|disposed/);
});

function gpuMock() {
	const log = []; let finish, rejectFence, failSubmit = false, submitFrame = true;
	const queue = {submit() { log.push('submit'); if (failSubmit) throw new Error('submit failed'); },
		onSubmittedWorkDone() { log.push('fence'); return new Promise((resolve, reject) => { finish = resolve; rejectFence = reject; }); }};
	const device = {queue, addEventListener() {}, removeEventListener() {}, lost: new Promise(() => {}), destroy() {}};
	const gpuAdapter = {requestDevice: async () => device};
	let instance, created = 0;
	const benchmarkChartGPU = {ChartGPU: {async create(plot, options) {
		created++; let mode = 'external', dirty = true, width = plot.style.width, height = plot.style.height;
		instance = {options, setOption(next) { this.options = next; dirty = true; },
			resize() { log.push('resize'); dirty ||= width !== plot.style.width || height !== plot.style.height; width = plot.style.width; height = plot.style.height; },
			getRenderMode: () => mode, setRenderMode(value) { mode = value; log.push(value); }, needsRender: () => dirty,
			renderFrame() { assert.equal(mode, 'external'); log.push('frame'); if (!dirty) return false; dirty = false; if (submitFrame) queueMicrotask(() => queue.submit([{}])); return true; }, dispose() {},
		}; return instance;
	}}};
	return {log, device, benchmarkChartGPU, navigator: {gpu: {requestAdapter: async () => gpuAdapter}},
		get instance() { return instance; }, get created() { return created; }, finish: () => finish(), rejectFence: () => rejectFence(new Error('fence failed')),
		failSubmit: () => { failSubmit = true; }, omitSubmit: () => { submitFrame = false; }};
}
async function microtasksUntil(predicate) {
	for (let i = 0; i < 30 && !predicate(); i++) await Promise.resolve();
	assert.ok(predicate(), 'expected asynchronous work was not scheduled');
}
async function createGPU() {
	const gpu = gpuMock(), adapter = load('chartgpu', gpu), host = node();
	const initial = adapter.makeChart(columns(data()), host);
	await microtasksUntil(() => gpu.log.includes('fence')); gpu.finish();
	const chart = await initial; gpu.log.length = 0;
	return {gpu, adapter, host, chart};
}
test('ChartGPU: retains options/data, resizes title/plot, awaits deferred submit then GPU fence', async () => {
	const {gpu, adapter, host, chart} = await createGPU(), instance = chart.instance, options = instance.options, plot = chart.element.lastElementChild;
	const descriptor = Object.getOwnPropertyDescriptor(gpu.device.queue, 'submit'), wait = {textContent: 'waiting'};
	let done = false;
	const resizing = adapter.resizeChart(chart, target, host, wait).then(value => { done = true; return value; });
	await microtasksUntil(() => gpu.log.includes('fence'));
	assert.equal(done, false); assert.equal(wait.textContent, 'waiting');
	assert.deepEqual(gpu.log, ['external', 'resize', 'frame', 'submit', 'fence']);
	assert.equal(chart.element.style.width, '1200px'); assert.equal(chart.element.style.height, '400px');
	assert.equal(plot.style.width, '1200px'); assert.equal(plot.style.height, '376px');
	assert.equal(chart.instance, instance); assert.equal(instance.options, options);
	assert.deepEqual(Object.getOwnPropertyDescriptor(gpu.device.queue, 'submit'), descriptor);
	gpu.finish(); assert.equal(await resizing, undefined); assert.equal(wait.textContent, 'Done!'); assert.equal(instance.getRenderMode(), 'auto');
	gpu.log.length = 0;
	const again = adapter.resizeChart(chart, target, host);
	await microtasksUntil(() => gpu.log.includes('fence')); assert.ok(!gpu.log.includes('frame'), 'same-size clean resize does not fabricate a frame');
	gpu.finish(); await again; assert.equal(gpu.created, 1);
	adapter.destroyChart(chart); await assert.rejects(adapter.resizeChart(chart, target, host), /disposed/);
});
for (const failure of ['failSubmit', 'omitSubmit', 'rejectFence']) test(`ChartGPU: ${failure} rejects and restores render mode/submit`, async () => {
	const {gpu, adapter, chart, host} = await createGPU(), submit = gpu.device.queue.submit, wait = {textContent: 'waiting'};
	if (failure !== 'rejectFence') gpu[failure]();
	const resizing = adapter.resizeChart(chart, target, host, wait);
	if (failure === 'rejectFence') { await microtasksUntil(() => gpu.log.includes('fence')); gpu.rejectFence(); }
	await assert.rejects(resizing, /submit failed|did not submit|fence failed/);
	assert.equal(gpu.device.queue.submit, submit); assert.equal(chart.instance.getRenderMode(), 'auto'); assert.equal(wait.textContent, 'waiting');
	adapter.destroyChart(chart);
});

test('variant forwarding and resize source contracts', () => {
	for (const name of ['d3-minmax', 'd3-svg', 'd3-svg-minmax', 'd3fc-canvas'])
		assert.match(source(name), /export \{[^}]*resizeChart[^}]*\} from '\.\/d3(?:fc)?\.mjs'/);
	for (const name of ['d3', 'd3fc', 'deckgl', 'chartgpu']) {
		assert.match(source(name), /function resizeChart\(chart, \{width, height\}, host, wait\)/);
		assert.doesNotMatch(source(name).split('function resizeChart')[1].split('\nfunction ')[0].split('\nasync function ')[0], /makeChart\(|setTimeout\(|requestAnimationFrame\(/);
	}
});
