import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe, it} from 'node:test';

const source = name => readFileSync(new URL(`../../bench/${name}.mjs`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const size = {width: 1200, height: 400};
const origin = {left: 37.25, top: 81.75};
// Contract doubles keep these adapter tests independent of the parent's hover utility.
const helpers = {
	hoverTargets: (length, project) => Array.from({length: 10}, (_, i) => {
		const index = Math.round((i + 1) * (length - 1) / 11), seriesIndex = i % 3;
		return {index, seriesIndex, ...project(index, seriesIndex)};
	}),
	nearHoverIndex: (actual, target, tolerance) => Number.isInteger(actual) && Math.abs(actual - target.index) <= tolerance,
	visibleText(element) {
		if (!element?.isConnected) return '';
		for (let n = element; n; n = n.parent) {
			if (n.style.display === 'none' || n.style.visibility === 'hidden' || n.style.opacity === '0') return '';
		}
		const rect = element.getBoundingClientRect();
		return rect.width && rect.height ? (element.textContent ?? '').trim() : '';
	},
};
function load(name, globals = {}) {
	return runInNewContext(source(name)
		.replace(/^import .* from '\.\/hover\.mjs';\n/m, '')
		.replace(/^export \{[^\n]+\};\s*$/gm, '') +
		'\n({makeChart, getHoverPlan, resizeChart, updateChart, destroyChart: typeof destroyChart === "function" ? destroyChart : c => c.destroy(), makeChartWithOptions: typeof makeChartWithOptions === "function" ? makeChartWithOptions : null});',
		{devicePixelRatio: 1, queueMicrotask, ...helpers, ...globals});
}
function node(tag = 'div') {
	const ctx = Object.fromEntries(['scale', 'setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'save', 'restore', 'rect', 'clip', 'fillText', 'arc', 'fill', 'closePath'].map(key => [key, () => {}]));
	return {tag, attrs: {}, style: {}, children: [], handlers: {}, isConnected: true, textContent: '',
		ownerDocument: {createElement: node},
		getBoundingClientRect() { return this.rect ?? {left: origin.left, top: origin.top, width: 1200, height: 400}; },
		append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
		getContext(type) { return type === '2d' ? ctx : this.gl ??= {NO_ERROR: 0, COLOR_BUFFER_BIT: 1, viewport() {}, clearColor() {}, clear() {}, flush() {}, getError: () => 0, isContextLost: () => false, getExtension: () => ({loseContext() {}})}; },
		addEventListener(type, fn) { this.handlers[type] = fn; },
		removeEventListener(type) { delete this.handlers[type]; },
		remove() { this.isConnected = false; this.parent?.children.splice(this.parent.children.indexOf(this), 1); },
		querySelector(selector) { return this.querySelectorAll(selector)[0]; },
		querySelectorAll(selector) { return descendants(this).filter(n => selector[0] === '#' ? n.attrs.id === selector.slice(1) : selector[0] === '.' ? n.attrs.class === selector.slice(1) : n.tag === selector); },
	};
}
const descendants = n => n.children.flatMap(child => [child, ...descendants(child)]);
class Selection {
	constructor(nodes, parent) { this.items = nodes; this.parent = parent; }
	node() { return this.items[0]; }
	nodes() { return this.items; }
	append(tag) { return new Selection(this.items.map(parent => { const child = node(tag); child.data = parent.data; parent.append(child); return child; })); }
	attr(key, value) { this.items.forEach((n, i) => { n.attrs[key] = typeof value === 'function' ? value(n.data, i) : value; }); return this; }
	style(key, value) { this.items.forEach(n => { n.style[key] = value; }); return this; }
	text(value) { this.items.forEach((n, i) => { n.textContent = typeof value === 'function' ? value(n.data, i) : value; }); return this; }
	select(selector) { return new Selection(this.items.map(n => n.querySelector(selector)).filter(Boolean)); }
	selectAll(selector) { return new Selection(this.items.flatMap(n => n.querySelectorAll(selector)), this.node()); }
	data(values) { this.values = Array.from(values); this.items.forEach((n, i) => { n.data = values[i]; }); return this; }
	join(tag) {
		while (this.items.length > this.values.length) this.items.pop().remove();
		while (this.items.length < this.values.length) { const child = node(tag); this.parent.append(child); this.items.push(child); }
		this.items.forEach((n, i) => { n.data = this.values[i]; }); return this;
	}
	call(fn) { fn(this); return this; }
	on(type, fn) { this.items.forEach(n => { n.handlers[type] = fn; }); return this; }
	remove() { this.items.forEach(n => n.remove()); return this; }
}
function scale() {
	let domain = [0, 1], range = [0, 1];
	const s = v => range[0] + (+v - +domain[0]) / (+domain[1] - +domain[0] || 1) * (range[1] - range[0]);
	s.domain = v => v ? (domain = v, s) : domain;
	s.range = v => v ? (range = v, s) : range;
	s.nice = () => s;
	s.copy = () => scale().domain(domain.slice()).range(range.slice());
	s.ticks = () => domain;
	s.tickFormat = () => String;
	s.invert = v => +domain[0] + (v - range[0]) / (range[1] - range[0]) * (+domain[1] - +domain[0]);
	return s;
}
function line() {
	const draw = () => '';
	for (const key of ['defined', 'x', 'y', 'context', 'digits']) draw[key] = () => draw;
	return draw;
}
function axis() {
	const a = () => {};
	a.ticks = a.tickFormat = a.tickSize = () => a;
	return a;
}
const d3 = {
	select: n => new Selection([n]), scaleTime: scale, scaleLinear: scale, line,
	path: () => ({moveTo() {}, lineTo() {}, closePath() {}, toString: () => ''}),
	min: xs => Math.min(...xs), max: xs => Math.max(...xs), extent: xs => [Math.min(...xs), Math.max(...xs)],
	axisLeft: axis, axisRight: axis, axisBottom: axis, color: () => ({r: 255, g: 0, b: 0}),
	pointer: event => event.point,
	bisectCenter: (xs, value) => Math.max(0, Math.min(xs.length - 1, Math.round((value - xs[0]) / (xs[1] - xs[0])))),
};
function fcMock() {
	function series() {
		const s = () => {};
		for (const key of ['context', 'xScale', 'yScale', 'crossValue', 'mainValue', 'decorate', 'pixelRatio', 'lineWidth', 'scaleMapper', 'equals']) s[key] = () => s;
		return s;
	}
	return {seriesCanvasLine: series, seriesWebglLine: series, webglScaleLinear: scale, webglStrokeColor: () => ({value: () => () => {}})};
}
function deckMock() {
	return {Deck: class {
		constructor(props) {
			this.props = props; this.width = props.width; this.height = props.height;
			this.device = {getDefaultCanvasContext: () => ({setDrawingBufferSize() {}})};
			queueMicrotask(() => this.redraw());
		}
		setProps(props) { Object.assign(this.props, props); this.width = props.width ?? this.width; this.height = props.height ?? this.height; }
		redraw() { this.props.onAfterRender({gl: this.props.gl}); }
		finalize() {}
	}, PathLayer: class {}, OrthographicView: class {}, COORDINATE_SYSTEM: {CARTESIAN: 0}};
}
function data() {
	const xs = Array.from({length: 55550}, (_, i) => 1600000000000 + i * 60000);
	return [xs, xs.map((_, i) => (i % 971) / 10), xs.map((_, i) => 20 + (i % 739) / 10), xs.map((_, i) => (i % 811) / 100)];
}
function checkTargets(plan, xs, left, width) {
	assert.equal(typeof plan.then, 'undefined');
	assert.equal(plan.targets.length, 10);
	assert.deepEqual(plan.targets.map(t => t.seriesIndex), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
	plan.targets.forEach((t, i) => {
		assert.equal(t.index, Math.round((i + 1) * (xs.length - 1) / 11));
		assert.equal(t.x, Math.round(origin.left + left + t.index / (xs.length - 1) * width));
		assert(Number.isFinite(t.y) && t.y > origin.top && t.y < origin.top + 400);
	});
}
function checkVisibility(plan, target, cell) {
	const text = cell.textContent;
	cell.textContent = 'wrong value'; assert.equal(plan.verify(target), null); cell.textContent = text;
	for (const [key, value] of [['display', 'none'], ['visibility', 'hidden'], ['opacity', '0']]) {
		cell.style[key] = value; assert.equal(plan.verify(target), null); delete cell.style[key];
	}
	cell.isConnected = false; assert.equal(plan.verify(target), null); cell.isConnected = true;
	cell.rect = {width: 0, height: 20}; assert.equal(plan.verify(target), null); delete cell.rect;
	assert.equal(cell.textContent, text, 'verification must not change the legend');
}

describe('custom benchmark hover plans (unit doubles, no browser)', () => {
	for (const variant of ['d3', 'd3-minmax', 'd3-svg', 'd3-svg-minmax', 'd3fc', 'd3fc-canvas', 'deckgl']) {
		for (const ratio of [1, 1.5, 2]) it(`${variant}, DPR=${ratio}: resized viewport targets and fresh visible evidence`, async () => {
			const custom = variant.startsWith('d3') && !variant.startsWith('d3fc');
			const base = custom ? 'd3' : variant.startsWith('d3fc') ? 'd3fc' : 'deckgl';
			const frames = new Map(); let nextFrame = 0;
			const adapter = load(base, {d3, fc: fcMock(), deck: deckMock(), devicePixelRatio: ratio,
				requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id)});
			const raw = data(), input = custom ? raw : Object.fromEntries(['x', 'cpu', 'ram', 'tcp'].map((key, i) => [key, raw[i]]));
			const host = node();
			if (custom) {
				const surface = node(); surface.attrs.class = 'chart'; host.append(surface);
				for (const id of ['plot', ...(variant.includes('svg') ? [] : ['overlay'])]) { const n = node(variant.includes('svg') ? 'svg' : 'canvas'); n.attrs.id = id; surface.append(n); }
				for (const id of ['cpu-value', 'ram-value', 'tcp-value']) { const n = node(); n.attrs.id = id; host.append(n); }
			}
			const chart = base === 'deckgl' ? await adapter.makeChart(input, host) : await adapter.makeChartWithOptions(input, host, null, null,
				{renderer: custom ? variant.includes('svg') ? 'svg' : 'canvas' : variant.endsWith('canvas') ? 'canvas' : 'webgl', minmax: variant.includes('minmax')});
			await adapter.resizeChart(chart, size, host);
			const plan = adapter.getHoverPlan(chart, input, host);
			const left = custom ? 55 : 70, width = custom ? 1075 : 1050;
			checkTargets(plan, raw[0], left, width);
			const surface = custom ? host.querySelector(variant.includes('svg') ? '.overlay' : '#overlay') : chart.element.querySelector('svg');
			const cells = custom ? ['cpu', 'ram', 'tcp'].map(id => host.querySelector(`#${id}-value`)) : surface.children[1].children;
			const actualIndices = new Set();
			for (const target of plan.targets) {
				assert.equal(plan.verify(target), null, 'previous legend is not evidence for the next target');
				const localX = target.x - origin.left;
				// Feed the listener a pointer double only in this unit test. The hook must never do this.
				surface.handlers[custom ? 'pointermove' : 'pointermove.benchmark']({offsetX: localX, point: [localX, target.y - origin.top]});
				if (custom) {
					assert.equal(plan.verify(target), null, 'queued cursor work is not displayed evidence');
					for (const [id, fn] of frames) { frames.delete(id); fn(); }
				}
				const actual = Math.round((localX - left) / width * (raw[0].length - 1));
				const evidence = plain(plan.verify(target));
				assert(evidence, 'native callback must have written the expected legend value');
				assert.equal(evidence.index, actual);
				assert.equal(evidence.seriesIndex, target.seriesIndex);
				assert.equal(evidence.value, raw[target.seriesIndex + 1][actual]);
				const precision = custom ? target.seriesIndex === 2 ? 2 : 1 : target.seriesIndex === 0 ? 3 : 2;
				const expected = `${['CPU', 'RAM', 'TCP Out'][target.seriesIndex]}: ${evidence.value.toFixed(precision)}${target.seriesIndex === 2 ? ' MB' : '%'}`;
				assert.equal(evidence.text, expected);
				assert.equal(evidence.text, cells[target.seriesIndex].textContent);
				assert(Math.abs(actual - target.index) <= (raw[0].length - 1) / width);
				assert.equal(plan.verify({...target, index: actual + Math.ceil((raw[0].length - 1) / width) + 1}), null);
				checkVisibility(plan, target, cells[target.seriesIndex]);
				assert.deepEqual(plain(plan.verify(target)), evidence, 'verification is read-only');
				actualIndices.add(actual);
			}
			assert.equal(actualIndices.size, 10);
			const last = plan.targets.at(-1);
			assert.equal(adapter.getHoverPlan(chart, input, host).verify(last), null, 'new plans need a fresh pointer update');
			surface.handlers[custom ? 'pointerleave' : 'pointerleave.benchmark']();
			assert.equal(plan.verify(last), null, 'a retained legend after pointerleave is stale');
			await adapter.updateChart(chart, input, host);
			assert.equal(plan.verify(last), null);
			adapter.destroyChart(chart);
			assert.equal(plan.verify(last), null);
			assert.throws(() => adapter.getHoverPlan(chart, input, host), /not live/);
		});
	}

	it('uPlot: uses actual cursor row and checks live legend cells without setting the cursor', () => {
		const adapter = load('uplot'), input = data(), cells = Array.from({length: 4}, () => node());
		const width = 1080, height = 300;
		const chart = {data: input, cursor: {idx: null, event: null}, legend: {idx: null, idxs: []},
			over: {getBoundingClientRect: () => ({...origin, width, height})},
			root: {querySelectorAll: selector => { assert.equal(selector, '.u-legend .u-value'); return cells; }},
			valToPos: (value, key) => key === 'x' ? (value - input[0][0]) / (input[0].at(-1) - input[0][0]) * width : height / 2,
		};
		const plan = adapter.getHoverPlan(chart, input, {});
		checkTargets(plan, input[0], 0, width);
		const actualIndices = new Set();
		for (const target of plan.targets) {
			assert.equal(plan.verify(target), null);
			const index = Math.round((target.x - origin.left) / width * (input[0].length - 1));
			const {seriesIndex} = target, value = input[seriesIndex + 1][index];
			chart.cursor = {idx: index, event: {type: 'mousemove'}};
			chart.legend = {idx: index, idxs: [index, index, index, index]};
			assert.equal(plan.verify(target), null, 'internal cursor state alone is not visible evidence');
			const text = value.toFixed(seriesIndex === 2 ? 2 : 1) + (seriesIndex === 2 ? ' MB' : '%');
			cells[seriesIndex + 1].textContent = text;
			assert.deepEqual(plain(plan.verify(target)), {index, seriesIndex, value, text});
			checkVisibility(plan, target, cells[seriesIndex + 1]);
			chart.legend.idxs[seriesIndex + 1] = index + 1;
			assert.equal(plan.verify(target), null); chart.legend.idxs[seriesIndex + 1] = index;
			chart.legend.idx = index + 1;
			assert.equal(plan.verify(target), null); chart.legend.idx = index;
			assert.equal(plan.verify({...target, index: index + 100}), null);
			assert.equal(adapter.getHoverPlan(chart, input, {}).verify(target), null);
			actualIndices.add(index);
		}
		assert.equal(actualIndices.size, 10);
		for (const edge of [0, height]) {
			chart.valToPos = (value, key) => key === 'x' ? width / 2 : edge;
			for (const target of adapter.getHoverPlan(chart, input, {}).targets) {
				assert(target.y > origin.top + 1);
				assert(target.y < origin.top + height - 1);
			}
		}
	});

	it('all wrapper variants forward the same hook; hooks do not dispatch events or set cursor state', () => {
		for (const [variant, base] of [['uplot-release', 'uplot'], ['d3-minmax', 'd3'], ['d3-svg', 'd3'], ['d3-svg-minmax', 'd3'], ['d3fc-canvas', 'd3fc']])
			assert.match(source(variant), new RegExp(`export \\{[^}]*getHoverPlan[^}]*\\} from '\\./${base}\\.mjs'`));
		for (const base of ['uplot', 'd3', 'd3fc', 'deckgl']) {
			assert.doesNotMatch(source(base), /dispatchEvent|\.setCursor\(|new (?:Mouse|Pointer)Event/);
			assert.match(source(base), /import \{hoverTargets, visibleText, nearHoverIndex\} from '\.\/hover\.mjs'/);
		}
	});
});
