import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {prepData, makeChart, destroyChart} from '../../bench/deckgl.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const data = Object.freeze(prepData(packed));

function vendor(options = {}) {
	const state = {nodes: [], scales: [], axes: [], layers: [], instances: [], finalized: 0, losses: 0, flushed: 0};
	const gl = {
		NO_ERROR: 0,
		isContextLost: () => !!state.lost,
		getError: () => state.glError || 0,
		flush() { state.flushed++; },
		getExtension(name) {
			assert.equal(name, 'WEBGL_lose_context');
			return {loseContext() { state.losses++; state.lost = true; }};
		},
	};
	function node(tag) {
		const element = {
			tag, style: {}, attrs: {}, children: [], handlers: {},
			append(child) { child.parent = this; this.children.push(child); },
			remove() {
				if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
				this.parent = null;
				this.removed = true;
			},
			getContext(type, attributes) {
				state.contextRequest = {type, attributes};
				return options.noContext ? null : gl;
			},
		};
		state.nodes.push(element);
		return element;
	}
	function selection(elements, parents = elements) {
		const each = fn => { elements.forEach(fn); return result; };
		const result = {
			append(tag) {
				return selection(elements.map(parent => {
					const child = node(tag); parent.append(child); return child;
				}));
			},
			attr(key, value) {
				return each((element, i) => {
					const resolved = typeof value === 'function' ? value(element.datum, i) : value;
					if (resolved == null) delete element.attrs[key];
					else element.attrs[key] = resolved;
				});
			},
			style(key, value) { return each(element => { element.style[key] = value; }); },
			text(value) { return each((element, i) => { element.text = typeof value === 'function' ? value(element.datum, i) : value; }); },
			call(fn) { fn(result); return result; },
			select(selector) {
				return selection(elements.flatMap(element => element.children.filter(child =>
					selector === '.domain' ? child.attrs.class === 'domain' : child.tag === selector).slice(0, 1)));
			},
			selectAll(tag) { return selection(elements.flatMap(element => element.children.filter(child => child.tag === tag)), elements); },
			data(values) {
				return {join(tag) {
					return selection(parents.flatMap(parent => values.map(datum => {
						const child = node(tag); child.datum = datum; parent.append(child); return child;
					})));
				}};
			},
			remove() { return each(element => element.remove()); },
			node: () => elements[0],
			on(name, handler) {
				return each(element => {
					if (name.startsWith('.') && handler === null) {
						for (const key of Object.keys(element.handlers))
							if (key.endsWith(name)) delete element.handlers[key];
					}
					else element.handlers[name] = handler;
				});
			},
		};
		return result;
	}
	function scale(type) {
		let domain = [0, 1], range = [0, 1];
		const fn = value => range[0] + (value - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);
		fn.domain = function(value) { if (!arguments.length) return domain; domain = value; return fn; };
		fn.range = function(value) { if (!arguments.length) return range; range = value; return fn; };
		fn.nice = () => { fn.niced = true; return fn; };
		fn.invert = value => domain[0] + (value - range[0]) / (range[1] - range[0]) * (domain[1] - domain[0]);
		fn.type = type;
		state.scales.push(fn);
		return fn;
	}
	function axis(side, scale) {
		const fn = group => {
			state.axes.push(fn);
			group.append('path').attr('class', 'domain');
			group.append('line');
		};
		Object.assign(fn, {side, scale});
		for (const key of ['ticks', 'tickSize', 'tickFormat']) fn[key] = value => { fn[key + 'Value'] = value; return fn; };
		return fn;
	}
	const d3 = {
		select: element => selection([element]),
		scaleTime: () => scale('time'), scaleLinear: () => scale('linear'),
		min: values => values.reduce((a, b) => Math.min(a, b), Infinity),
		max: values => values.reduce((a, b) => Math.max(a, b), -Infinity),
		extent: values => [d3.min(values), d3.max(values)],
		axisLeft: scale => axis('left', scale), axisRight: scale => axis('right', scale), axisBottom: scale => axis('bottom', scale),
		color: name => ({red: {r: 255, g: 0, b: 0}, blue: {r: 0, g: 0, b: 255}, green: {r: 0, g: 128, b: 0}}[name]),
		pointer: event => event.point,
		bisectCenter(values, target) {
			return values.reduce((best, value, i) => Math.abs(value - target) < Math.abs(values[best] - target) ? i : best, 0);
		},
	};
	const deck = {
		COORDINATE_SYSTEM: {CARTESIAN: 0},
		OrthographicView: class { constructor(props) { this.props = props; } },
		PathLayer: class {
			constructor(props) {
				if (options.pathError) throw options.pathError;
				this.props = props;
				state.layers.push(this);
			}
		},
		Deck: class {
			constructor(props) {
				state.props = this.props = props;
				if (options.constructorError) throw options.constructorError;
				state.instances.push(this);
				if (options.syncError) props.onError(options.syncError);
				if (options.syncRender) props.onAfterRender({gl});
			}
			finalize() {
				state.finalized++;
				if (options.cleanupError) throw options.cleanupError;
			}
		},
	};
	const host = node('host');
	host.ownerDocument = {createElement: node};
	Object.freeze(host.style);
	Object.assign(globalThis, {d3, deck});
	return Object.assign(state, {
		host, gl,
		render: (context = gl) => state.props.onAfterRender({gl: context}),
		fail: error => state.props.onError(error),
	});
}

function assertClean(state, finalized = 1) {
	assert.equal(state.host.children.length, 0);
	assert.equal(state.finalized, finalized);
	assert.equal(state.losses, 1);
	for (const element of state.nodes) assert.deepEqual(element.handlers, {});
}

describe('deck.gl benchmark adapter (no browser)', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['d3', 'deck', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	it('prepares only normal columns, preserving all 55,550 rows, exact values, and irregular times', () => {
		delete globalThis.d3;
		delete globalThis.deck;
		const again = prepData(packed);
		assert.deepEqual(Object.keys(again), ['x', 'cpu', 'ram', 'tcp']);
		for (const key of Object.keys(again)) {
			assert.ok(again[key] instanceof Float64Array);
			assert.equal(again[key].length, 55550);
			assert.notEqual(again[key].buffer, data[key].buffer);
			assert.deepEqual(again[key], data[key]);
		}
		for (let j = 0, i = 8; i < packed.length; j++, i += 7) {
			assert.equal(again.x[j], packed[i] * 60000);
			assert.equal(again.cpu[j], Math.round((100 - packed[i + 1]) * 1000) / 1000);
			assert.equal(again.ram[j], Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100);
			assert.equal(again.tcp[j], packed[i + 3]);
		}
		const irregular = packed.slice(0, 8 + 3 * 7);
		irregular[8 + 2 * 7] += 9;
		const {x} = prepData(Object.freeze(irregular));
		assert.equal(x[1] - x[0], 60000);
		assert.equal(x[2] - x[1], 600000);
	});

	for (const ratio of [1, 1.5, 2]) {
		it(`renders every point as connected Cartesian paths at DPR ${ratio}, without mutating input`, async () => {
			globalThis.devicePixelRatio = ratio;
			const state = vendor();
			const before = structuredClone(data);
			const pending = makeChart(data, state.host);
			const {props, layers, scales: [x, pct, mb]} = state;
			assert.deepEqual(state.contextRequest, {type: 'webgl2', attributes: {antialias: true, depth: false}});
			assert.equal(props.gl, state.gl);
			assert.equal(props.device, undefined);
			assert.equal(props.useDevicePixels, ratio);
			assert.equal(props.width, 1770);
			assert.equal(props.height, 500);
			assert.deepEqual(props.canvas.attrs, {width: Math.round(1770 * ratio), height: Math.round(500 * ratio)});
			assert.equal(props.canvas.style.left, '70px');
			assert.equal(props.canvas.style.top, '60px');
			assert.equal(props.canvas.style.width, '1770px');
			assert.equal(props.canvas.style.height, '500px');
			assert.ok(props.views instanceof deck.OrthographicView);
			assert.deepEqual(props.views.props, {id: 'plot', flipY: true});
			assert.deepEqual(props.viewState, {target: [885, 250, 0], zoom: 0});
			assert.equal(props.controller, false);
			assert.equal(layers.length, 3);
			assert.deepEqual(props.layers, layers);
			const columns = [data.cpu, data.ram, data.tcp];
			for (let i = 0; i < 3; i++) {
				const p = layers[i].props;
				assert.equal(p.positionFormat, 'XY');
				assert.equal(p.coordinateSystem, deck.COORDINATE_SYSTEM.CARTESIAN);
				assert.equal(p.widthUnits, 'pixels');
				assert.equal(p.getWidth * ratio, 1);
				assert.equal(p.widthMinPixels, 0);
				assert.equal(p._pathType, undefined);
				assert.equal(p.data.attributes, undefined);
				assert.equal(p.pickable, false);
				assert.deepEqual(p.parameters, {depthCompare: 'always', depthWriteEnabled: false});
				assert.equal(p.data.length, 1);
				const path = p.getPath(p.data[0]);
				assert.ok(path instanceof Float64Array);
				assert.equal(path.length, 55550 * 2);
				for (let j = 0; j < data.x.length; j++) {
					assert.equal(path[j * 2], x(data.x[j]));
					assert.equal(path[j * 2 + 1], (i === 2 ? mb : pct)(columns[i][j]));
				}
			}
			assert.deepEqual(layers.map(layer => layer.props.getColor), [[255, 0, 0, 255], [0, 0, 255, 255], [0, 128, 0, 255]]);
			state.render();
			const chart = await pending;
			assert.equal(chart.deck, state.instances[0]);
			assert.deepEqual(chart.getWebGLContexts(), [state.gl]);
			assert.deepEqual(data, before);
			destroyChart(chart);
			destroyChart(chart);
			assert.deepEqual(chart.getWebGLContexts(), []);
			assertClean(state);
		});
	}

	it('derives native time/independent nice domains and tick generators inside makeChart', async () => {
		const state = vendor();
		prepData(packed);
		assert.equal(state.scales.length, 0);
		const input = {x: [100, 105, 190], cpu: [-5, 8, 3], ram: [2, 30, 11], tcp: [1000, 7000, 4000]};
		const pending = makeChart(input, state.host);
		const [x, pct, mb] = state.scales;
		assert.equal(state.scales.length, 3);
		assert.equal(x.type, 'time');
		assert.deepEqual(x.domain(), [100, 190]);
		assert.deepEqual(x.range(), [0, 1770]);
		assert.deepEqual(pct.domain(), [-5, 30]);
		assert.deepEqual(mb.domain(), [1000, 7000]);
		assert.ok(pct.niced && mb.niced);
		assert.deepEqual(pct.range(), [500, 0]);
		assert.deepEqual(mb.range(), [500, 0]);
		assert.deepEqual(state.axes.map(axis => [axis.side, axis.ticksValue]), [['left', 10], ['bottom', 12], ['left', 10], ['right', 10]]);
		assert.deepEqual(state.axes.map(axis => axis.scale), [pct, x, pct, mb]);
		assert.equal(state.axes[0].tickSizeValue, -1770);
		assert.equal(state.axes[0].tickFormatValue, '');
		assert.equal(state.axes[1].tickFormatValue, undefined);
		assert.equal(state.axes[2].tickFormatValue(7), '7%');
		assert.equal(state.axes[3].tickFormatValue(7), '7 MB');
		assert.ok(state.nodes.some(node => node.tag === 'line' && node.attrs.stroke === 'rgba(0,0,0,0.1)'));
		assert.ok(state.nodes.some(node => node.text === 'Server Events'));
		state.render();
		destroyChart(await pending);
	});

	it('uses SVG cursor/legend with nearest original points and removes all DOM listeners', async () => {
		const state = vendor();
		const input = {x: [100, 105, 190], cpu: [1, 2, 3], ram: [10, 20, 30], tcp: [100, 200, 300]};
		const pending = makeChart(input, state.host);
		state.render();
		const chart = await pending;
		const svg = chart.svg.node();
		const dots = state.nodes.filter(node => node.tag === 'circle');
		const cursor = dots[0].parent;
		const legend = state.nodes.filter(node => ['CPU', 'RAM', 'TCP Out'].includes(node.text));
		const [x, pct, mb] = state.scales;
		svg.handlers['pointermove.benchmark']({point: [70 + x(106), 100]});
		assert.equal(cursor.attrs.display, undefined);
		assert.deepEqual(dots.map(node => node.attrs.cx), [x(105), x(105), x(105)]);
		assert.deepEqual(dots.map(node => node.attrs.cy), [pct(2), pct(20), mb(200)]);
		assert.deepEqual(legend.map(node => node.text), ['CPU: 2.000%', 'RAM: 20.00%', 'TCP Out: 200.00 MB']);
		for (const point of [[0, 100], [1900, 100], [80, 0], [80, 599]]) {
			svg.handlers['pointermove.benchmark']({point});
			assert.equal(cursor.attrs.display, 'none');
		}
		svg.handlers['pointermove.benchmark']({point: [70, 60]});
		assert.equal(dots[0].attrs.cx, 0);
		svg.handlers['pointermove.benchmark']({point: [1840, 560]});
		assert.equal(dots[0].attrs.cx, 1770);
		svg.handlers['pointerleave.benchmark']();
		assert.equal(cursor.attrs.display, 'none');
		destroyChart(chart);
		assertClean(state);
	});

	it('waits for actual first render, not initialization, and surfaces later errors', async () => {
		const state = vendor();
		const wait = {textContent: 'Rendering...'};
		let finished = false;
		const pending = makeChart(data, state.host, wait).then(chart => { finished = true; return chart; });
		state.props.onLoad?.();
		state.props.onWebGLInitialized?.(state.gl);
		await Promise.resolve();
		assert.equal(finished, false);
		assert.equal(wait.textContent, 'Rendering...');
		assert.equal(state.flushed, 0);
		state.render();
		const chart = await pending;
		assert.equal(wait.textContent, 'Done!');
		assert.equal(state.flushed, 1);
		state.render();
		assert.equal(state.flushed, 1);
		const error = new Error('later render failure');
		assert.throws(() => state.fail(error), actual => actual === error);
		assert.equal(chart.error, error);
		const later = new Error('another failure');
		assert.throws(() => state.fail(later), actual => actual === later);
		assert.equal(chart.error, error);
		state.lost = true;
		assert.deepEqual(chart.getWebGLContexts(), []);
		destroyChart(chart);
		state.render();
		assertClean(state);
	});

	for (const mode of ['pathError', 'constructorError', 'syncError', 'async', 'after-render']) {
		it(`rejects ${mode} errors and cleans partially initialized charts`, async () => {
			const error = new Error(mode);
			const state = vendor({[mode]: error});
			const wait = {textContent: 'Rendering...'};
			const pending = makeChart(data, state.host, wait);
			if (mode === 'after-render') state.render();
			if (mode === 'async' || mode === 'after-render') state.fail(error);
			await assert.rejects(pending, actual => actual === error);
			assert.equal(wait.textContent, 'Rendering...');
			assertClean(state, ['pathError', 'constructorError'].includes(mode) ? 0 : 1);
		});
	}

	for (const mode of ['gl-error', 'lost', 'wrong-context', 'context-event']) {
		it(`rejects ${mode} rather than reporting a successful first draw`, async () => {
			const state = vendor();
			const pending = makeChart(data, state.host);
			if (mode === 'gl-error') state.glError = 1282;
			if (mode === 'lost') state.lost = true;
			if (mode === 'context-event') state.props.canvas.handlers['webglcontextlost.benchmark']();
			else state.render(mode === 'wrong-context' ? {} : state.gl);
			await assert.rejects(pending, /deck.gl.*(context|draw)/);
			assertClean(state);
		});
	}

	it('fails explicitly without WebGL2 and removes its canvas/container', async () => {
		const state = vendor({noContext: true});
		await assert.rejects(makeChart(data, state.host), /requires WebGL2/);
		assert.equal(state.host.children.length, 0);
		assert.equal(state.finalized, 0);
		assert.equal(state.losses, 0);
		assert.equal(state.instances.length, 0);
	});

	it('accepts a synchronous first render and creates fresh paths/contexts on repeat runs', async () => {
		const first = vendor({syncRender: true});
		const chart = await makeChart(data, first.host);
		destroyChart(chart);
		const second = vendor({syncRender: true});
		const next = await makeChart(data, second.host);
		assert.notEqual(chart, next);
		assert.notEqual(first.gl, second.gl);
		for (let i = 0; i < 3; i++) {
			assert.notEqual(first.layers[i].props.data[0], second.layers[i].props.data[0]);
			assert.deepEqual(first.layers[i].props.data[0], second.layers[i].props.data[0]);
		}
		destroyChart(next);
		assertClean(first);
		assertClean(second);
	});

	it('completes remaining cleanup and remains idempotent when finalize throws', async () => {
		const error = new Error('finalize failed');
		const state = vendor({syncRender: true, cleanupError: error});
		const chart = await makeChart(data, state.host);
		assert.throws(() => destroyChart(chart), actual => actual === error);
		destroyChart(chart);
		assertClean(state);
		assert.deepEqual(chart.getWebGLContexts(), []);
	});

	it('preserves both rendering and cleanup failures instead of swallowing either', async () => {
		const error = new Error('render failed');
		const cleanupError = new Error('finalize failed');
		const state = vendor({cleanupError});
		const pending = makeChart(data, state.host);
		state.fail(error);
		await assert.rejects(pending, actual => {
			assert.ok(actual instanceof AggregateError);
			assert.equal(actual.cause, error);
			assert.deepEqual(actual.errors, [error, cleanupError]);
			return true;
		});
		assertClean(state);
	});

	it('uses the shared HTML runner and retains a legacy-compatible export declaration', () => {
		const html = readFileSync(new URL('../../bench/deckgl.html', import.meta.url), 'utf8');
		const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
		assert.equal(scripts.length, 1);
		assert.equal(scripts[0][1].trim(), 'type="module"');
		assert.equal(scripts[0][2].trim(), "import {runDemo} from './demo.mjs';\n\t\t\trunDemo('deckgl').catch(console.error);");
		assert.doesNotMatch(html, /<style\b|<link\b|<canvas\b|fetch\(|https?:|style=/);
		const source = readFileSync(new URL('../../bench/deckgl.mjs', import.meta.url), 'utf8');
		assert.match(source, /export \{prepData, makeChart, destroyChart\};\s*$/);
		const legacy = runInNewContext(source.replace(/^export \{[^\n]+\};\s*$/gm, '') + '\n({prepData, makeChart, destroyChart})');
		assert.deepEqual(Object.keys(legacy), ['prepData', 'makeChart', 'destroyChart']);
	});
});
