import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {WIDTH, HEIGHT, SERIES, CHARTS, dashboardData} from '../../bench/dashboard/common.mjs';

const ids = ['anychart', 'anychart-sampled', 'fusiontime', 'fusiontime-sampled', 'amcharts', 'amcharts-sampled',
	'vega', 'g2', 'bokeh', 'bokeh-canvas', 'zingchart'];
const adapters = Object.fromEntries(await Promise.all(ids.map(async id => [id, await import(`../../bench/dashboard/${id}.mjs`)])));
const originals = Object.fromEntries(await Promise.all(ids.map(async id => [id, await import(`../../bench/${id}.mjs`)])));
const globals = ['anychart', 'FusionCharts', 'am5', 'am5xy', 'vega', 'G2', 'Bokeh', 'zingchart', 'devicePixelRatio'];
const turn = () => new Promise(resolve => setImmediate(resolve));
function freeze(value) {
	if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
	return value;
}
function list() {
	return {values: [], get length() { return this.values.length; },
		push(value) { this.values.push(value); return value; }, unshift(value) { this.values.unshift(value); return value; },
		getIndex(i) { return this.values[i]; }, each(fn) { this.values.forEach(fn); }};
}
function emitter() {
	const listeners = new Map();
	return {
		on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
		off(name, fn) { listeners.get(name)?.delete(fn); },
		emit(name, ...args) { for (const fn of listeners.get(name) ?? []) fn(...args); },
		listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
	};
}

function vendor(id) {
	const context = () => ({lost: false, isContextLost() { return this.lost; },
		getExtension() { throw new Error('Do not lose a vendor-owned Bokeh context.'); }});
	const env = {states: [], fail: false, context: context(), contexts: [], contextLimit: 16};
	const base = id.replace(/-sampled$|-canvas$/, '');
	function state(host, config) {
		const s = {...emitter(), host, config, destroyed: 0, pending: [], series: []};
		s.check = () => { if (env.fail || s.fail) throw new Error('native failure'); };
		s.promise = () => { s.check(); return new Promise(resolve => s.pending.push(resolve)); };
		s.complete = () => {
			s.chart.animationTime = null;
			for (const resolve of s.pending.splice(0)) resolve(s.chart);
			for (const name of ['chartDraw', 'renderComplete', 'frameended', 'complete']) s.emit(name);
		};
		s.dispose = () => { s.destroyed++; };
		env.states.push(s);
		return s;
	}
	const setting = () => {
		const obj = {values: {}};
		for (const name of ['enabled', 'position', 'orientation', 'scale']) obj[name] = function(value) {
			if (!arguments.length) return obj.values[name];
			obj.values[name] = value; return obj;
		};
		return obj;
	};
	if (base === 'anychart') {
		globalThis.anychart = {
			stock() {
				const s = state(), grouping = setting(), scrollerGrouping = setting(), legend = setting();
				const axes = [];
				const plot = {getSeriesCount: () => s.series.length, getSeriesAt: i => s.series[i],
					yScale(value) { this.scale = value; }, yAxis(i) { return axes[i] ??= setting(); }, legend: () => legend,
					line(mapping) {
						const states = Object.fromEntries(['normal', 'hovered', 'selected'].map(key => [key, setting()]));
						const line = {mapping, states, name(value) { if (value === undefined) return this.label; this.label = value; },
							stroke(value) { this.strokeValue = value; }, yScale(value) { this.scale = value; }};
						for (const key of Object.keys(states)) line[key] = () => ({markers: () => states[key]});
						s.series.push(line); return line;
					},
				};
				s.config = {axes, grouping, scrollerGrouping, legend, plot};
				s.chart = {dispose: s.dispose, plot: () => plot, grouping: () => grouping, scrollerGrouping: () => scrollerGrouping,
					scroller: setting, listenOnce: s.on, unlisten: s.off, draw: s.check, selectRange() {},
					animation(value) { s.config.animation = value; }, bounds(x, y, width, height) { Object.assign(s.config, {width, height}); },
					xScale(value) { s.config.xScale = value; }, container(host) { s.host = host; }};
				s.corruptSeries = () => s.series.pop();
				s.corruptRows = () => { s.table.rows = s.table.rows.slice(1); };
				return s.chart;
			},
			scales: {linear: () => ({dispose() { this.disposed = true; }})},
			data: {table() {
				const s = env.states.at(-1);
				const table = s.table = {rows: [], disposed: false, startTransaction() {}, commit() {}, rollback() {},
					remove() { s.check(); this.rows = []; }, addData(rows) { this.rows = this.rows.concat(rows); },
					dispose() { this.disposed = true; },
					mapAs(options) {
						return {options, dispose() {}, createSelectable() {
							return {selectAll() { return this; },
								getIterator() { let i = -1; return {advance: () => ++i < table.rows.length,
									get: () => table.rows[i][options.value.column], getKey: () => table.rows[i][0]}; }};
						}};
					},
				};
				return table;
			}},
		};
	}
	else if (base === 'fusiontime') {
		globalThis.FusionCharts = class {
			constructor(config) {
				const s = state(config.renderAt, config);
				s.store = config.dataSource.data.store;
				s.chart = this;
				// getJSONData() returns normalized keys, not the constructor's camelCase keys.
				const normalize = source => Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
				s.source = normalize(config.dataSource);
				Object.assign(this, {addEventListener: s.on, removeEventListener: s.off, dispose: s.dispose, render: s.check,
					getJSONData: () => s.source, setJSONData(source) { s.check(); s.source = normalize(source); }});
				s.corruptSeries = () => s.source.yaxis[0].plot.pop();
				s.corruptRows = () => { s.store.table.rows = s.store.table.rows.slice(1); };
			}
		};
		globalThis.FusionCharts.DataStore = class {
			createDataTable(rows, schema) {
				this.schema = schema;
				this.table = {rows, store: this, getData() { return {data: this.rows}; }};
				rows.forEach((row, i) => row.push(String(i)));
				return this.table;
			}
			getDataTable() { return this.table; }
			deleteRows(query) { assert.deepEqual(query, []); this.table.rows = []; }
			appendRows(rows) { rows.forEach((row, i) => row.push(String(i))); this.table.rows.push(...rows); }
			dispose() { this.disposed = true; }
		};
	}
	else if (base === 'amcharts') {
		const entity = {new(root, options) { return {options, get(key) { return options[key]; }, set(key, value) { options[key] = value; return value; }}; }};
		globalThis.am5 = {
			registry: {version: '5.21.4'}, color: value => value,
			Root: {new(host) {
				const s = state(host, {width: Number.parseInt(host.style.width), height: Number.parseInt(host.style.height)});
				const root = s.chart = {_state: s, container: {children: list()}, dispose: s.dispose,
					events: {on(name, fn) { s.on(name, fn); return {dispose() { s.off(name, fn); }}; }}};
				s.corruptSeries = () => root.container.children.getIndex(0).series.values.pop();
				s.corruptRows = () => { s.series[0].data.values = s.series[0].data.values.slice(1); };
				return root;
			}},
			Tooltip: entity,
			Legend: {new() { return {data: {setAll(values) { this.values = values; }}}; }},
		};
		globalThis.am5xy = {
			XYChart: {new(root, options) { return {...entity.new(root, options), xAxes: list(), yAxes: list(), series: list(), children: list()}; }},
			XYCursor: entity, DateAxis: entity, ValueAxis: entity, AxisRendererX: entity, AxisRendererY: entity,
			LineSeries: {new(root, options) {
				const s = root._state;
				const series = {...entity.new(root, options), strokes: {template: {setAll() {}}},
					data: {values: [], setAll(values) { s.check(); this.values = values; }}};
				s.series.push(series); return series;
			}},
		};
	}
	else if (base === 'vega') {
		globalThis.vega = {Warn: 2, logger: () => ({}), parse: spec => spec,
			changeset: () => ({remove() { return this; }, insert(values) { this.values = values; return this; }}),
			View: class {
				constructor(spec, options) {
					const s = this._state = state(null, {...spec, options}); s.chart = this;
					this.data = spec.data[0].values;
					this.marks = spec.marks;
					// Model tuple ownership: a frozen prepData row must never reach ingestion.
					this.data.forEach((row, i) => { row.tupleId = i; });
					s.corruptSeries = () => this.marks.pop();
					s.corruptRows = () => { this.data = this.data.slice(1); };
				}
				initialize(host) { this._state.host = host; }
				container() { return this._state.host; }
				runAsync() { return this._state.promise(); }
				change(name, changes) { assert.equal(name, 'table'); this.data = changes.values; this.data.forEach((row, i) => { row.tupleId = i; }); }
				scenegraph() { return {root: {items: [{items: this.marks.map(mark => ({marktype: 'line', name: mark.name, items: this.data.map(datum => ({datum}))}))}]}}; }
				finalize() { this._state.dispose(); }
			},
		};
	}
	else if (base === 'g2') {
		globalThis.G2 = {Chart: class {
			constructor(config) { this._state = state(config.container, config); this._state.chart = this; }
			options(options) { this.spec = options; }
			render() {
				const s = this._state;
				this.context = {views: [{markState: new Map(this.spec.children.map(mark => [
					{...mark, data: this.spec.data, encode: {y: {field: mark.encode.y}}},
					{data: [{seriesIndex: this.spec.data.map((_, i) => i)}]},
				]))}]};
				s.corruptSeries = () => { const marks = this.context.views[0].markState; marks.delete(marks.keys().next().value); };
				s.corruptRows = () => { this.context.views[0].markState.values().next().value.data[0].seriesIndex.pop(); };
				return s.promise();
			}
			changeData(input) { this.spec.data = input; return this.render(); }
			getContext() { return this.context; }
			destroy() { this._state.dispose(); }
		}};
	}
	else if (base === 'bokeh') {
		let sharedWebGL, regl;
		async function initWebGL() {
			if (sharedWebGL !== undefined) return sharedWebGL;
			const gl = env.coldWebGL ? context() : env.context;
			if (env.coldWebGL) {
				env.contexts.push(gl);
				const active = env.contexts.filter(context => !context.lost);
				if (active.length > env.contextLimit) active[0].lost = true;
			}
			// Bokeh 3.10.1 caches the result after module loading, while get_regl()
			// caches one wrapper synchronously, including failed initialization.
			await Promise.resolve();
			regl ??= {has_webgl: !gl.isContextLost()};
			return sharedWebGL = regl.has_webgl ? {canvas: {getContext: () => gl}} : null;
		}
		globalThis.Bokeh = {documents: [],
			HoverTool: class { constructor(options) { Object.assign(this, options); } },
			ColumnDataSource: class {
				constructor({data}) { this.data = data; }
				set data(value) { this._data = value; if (this.state) this.state.chart.ready = this.state.promise(); }
				get data() { return this._data; }
			},
			Plotting: {
				figure(config) {
					const legend = {items: []};
					return {...config, renderers: [], legend, center: [legend], below: [], above: [], addedTools: [],
						line(options) {
							const renderer = {data_source: options.source, glyph: {type: 'Line', x: options.x, y: options.y}, options};
							this.renderers.push(renderer); legend.items.push({label: options.legend_label}); return renderer;
						},
						add_layout(item, position) { assert.ok(item); this[position].push(item); },
						add_tools(...tools) { this.addedTools.push(...tools); },
					};
				},
				show(plot, host) {
					const s = state(host, plot);
					const doc = plot.document = {clear() { this.cleared = true; }, views_manager: {clear() { this.cleared = true; }}};
					Bokeh.documents.push(doc);
					const view = s.chart = {model: plot, is_destroyed: false, ready: Promise.resolve(),
						renderer_views: new Map(), canvas_view: {webgl: null},
						remove() { this.is_destroyed = true; s.dispose(); }};
					for (const renderer of plot.renderers) {
						const glyph = {has_webgl: () => view.canvas_view.webgl !== null && !env.fallback};
						view.renderer_views.set(renderer, {glyph, get has_webgl() { return glyph.has_webgl(); }});
					}
					const initialized = plot.output_backend === 'webgl'
						? initWebGL().then(webgl => { view.canvas_view.webgl = webgl; }) : Promise.resolve();
					plot.renderers[0].data_source.state = s;
					s.corruptSeries = () => plot.renderers.pop();
					s.corruptRows = () => { const source = plot.renderers[0].data_source; source._data = {...source.data, s0: source.data.s0.slice(1)}; };
					return Promise.all([initialized, s.promise()]).then(() => view);
				},
			},
		};
	}
	else {
		const byId = new Map();
		const get = id => {
			if (!byId.has(id)) { const s = state({id}); s.chart = s.host; byId.set(id, s); }
			return byId.get(id);
		};
		globalThis.zingchart = {
			bind(id, event, fn) { get(id).on(event, fn); }, unbind(id, event, fn) { get(id).off(event, fn); },
			render(config) {
				const s = get(config.id); s.config = config; s.check();
				s.series = config.data.series;
				s.corruptSeries = () => s.series.pop();
				s.corruptRows = () => { s.series[0].values = s.series[0].values.slice(1); };
			},
			exec(id, command, args) {
				const s = get(id);
				if (command === 'destroy') return s.dispose();
				if (command === 'getplotlength') return s.series.length;
				if (command === 'getseriesvalues') return s.series.map(line => line.values);
				assert.equal(command, 'setseriesvalues'); s.check();
				s.series.forEach((line, i) => { line.values = args.values[i]; });
			},
		};
	}
	return env;
}

function configuration(id, s) {
	const sampled = id.endsWith('-sampled');
	assert.equal(s.config.width, WIDTH); assert.equal(s.config.height, HEIGHT);
	if (id.startsWith('anychart')) {
		assert.equal(s.config.animation, false);
		assert.equal(s.config.axes.length, 1);
		assert.equal(s.config.grouping.enabled(), sampled ? undefined : false);
		assert.equal(s.config.scrollerGrouping.enabled(), sampled ? undefined : false);
		assert.notEqual(s.config.legend.enabled(), false, 'retain the native live legend default');
		assert.deepEqual(s.series.map(line => line.label), SERIES.map(s => s.label));
		for (const line of s.series) {
			assert.equal(line.scale, s.config.plot.scale);
			for (const state of Object.values(line.states)) assert.equal(state.enabled(), false);
		}
	}
	else if (id.startsWith('fusiontime')) {
		const source = s.config.dataSource;
		assert.equal(source.chart.animation, 0); assert.equal(source.yAxis.length, 1);
		assert.equal(source.xAxis.binning === undefined, sampled);
		assert.equal(source.legend.enabled, true);
		assert.equal(source.legend.position, 'top');
		assert.notEqual(source.tooltip?.enabled, false);
		assert.equal(s.store.schema.length, 6);
		assert.deepEqual(source.yAxis[0].plot.map(p => p.value), SERIES.map(s => s.label));
		assert.ok(source.yAxis[0].plot.every(p => p.type === 'line'));
		assert.equal(source.plotConfig.line.style.anchor.opacity, 0);
	}
	else if (id.startsWith('amcharts')) {
		const chart = s.chart.container.children.getIndex(0);
		assert.equal(chart.yAxes.length, 1);
		assert.equal(chart.xAxes.getIndex(0).get('groupData'), sampled);
		assert.equal(s.chart.autoResize, false);
		assert.deepEqual(chart.children.getIndex(0).data.values, chart.series.values);
		assert.ok(chart.get('cursor'));
		for (const series of chart.series.values) {
			assert.equal(series.get('tooltip').get('labelText'), '{name}: {valueY}');
			assert.equal(series.get('yAxis'), chart.yAxes.getIndex(0));
			assert.equal(series.get('minDistance'), sampled ? 1 : 0);
			assert.equal(series.get('interpolationDuration'), 0);
		}
	}
	else if (id === 'vega') {
		assert.equal(s.config.options.renderer, 'canvas');
		assert.equal(s.config.marks.length, 5);
		assert.ok(s.config.marks.every(mark => mark.type === 'line' && mark.encode.update.y.scale === 'y'));
		assert.equal(s.config.axes.filter(axis => axis.orient === 'left').length, 1);
		assert.equal(s.config.legends.length, 1);
		assert.equal(s.config.legends[0].orient, 'top');
		SERIES.forEach(({id, label}, i) => {
			const signal = s.config.marks[i].encode.update.tooltip.signal;
			assert.ok(signal.includes('timeFormat(datum.time,'));
			assert.ok(signal.includes(`'${label}': datum.${id}`));
		});
	}
	else if (id === 'g2') {
		assert.equal(s.config.renderer, undefined);
		assert.equal(s.chart.spec.animate, false);
		assert.equal(s.chart.spec.children.length, 5);
		assert.ok(s.chart.spec.children.every(mark => mark.type === 'line' && mark.scale.y.key === 'y' && mark.animate === false));
		assert.equal(s.chart.spec.scale.color.domain.length, 5);
		assert.equal(s.chart.spec.legend.color.position, 'top');
		for (const options of [s.chart.spec, ...s.chart.spec.children]) {
			assert.notEqual(options.tooltip, false);
			assert.notEqual(options.interaction?.tooltip, false);
		}
	}
	else if (id.startsWith('bokeh')) {
		assert.equal(s.config.output_backend, id === 'bokeh' ? 'webgl' : 'canvas');
		assert.equal(s.config.lod_threshold, null);
		assert.equal(s.config.extra_y_ranges, undefined);
		assert.equal(s.config.legend.items.length, 5);
		assert.ok(s.config.above.includes(s.config.legend));
		assert.ok(!s.config.below.includes(s.config.legend));
		assert.ok(!s.config.center.includes(s.config.legend));
		assert.equal(s.config.legend.orientation, 'horizontal');
		assert.equal(s.config.legend.ncols, 3);
		assert.notEqual(s.config.tools, '');
		assert.notEqual(s.config.toolbar_location, null);
		assert.equal(s.config.addedTools.length, 1);
		const hover = s.config.addedTools[0];
		assert.ok(hover instanceof Bokeh.HoverTool);
		assert.deepEqual(hover.renderers, [s.config.renderers[0]]);
		assert.equal(hover.mode, 'vline');
		assert.deepEqual(hover.tooltips, [['Time', '@x{%F %T}'], ...SERIES.map(({id, label}) => [label, `@${id}`])]);
		assert.deepEqual(hover.formatters, {'@x': 'datetime'});
		assert.equal(s.config.renderers.length, 5);
		assert.ok(s.config.renderers.every(r => r.glyph.type === 'Line'));
	}
	else {
		assert.equal(s.config.output, 'canvas');
		assert.equal(s.config.data.plot['sampling-step'], 1);
		assert.equal(s.config.data.plot.marker.visible, false);
		assert.equal(s.config.data.plot.animation.speed, 0);
		assert.equal(s.config.data['scale-y-2'], undefined);
		assert.equal(s.config.data.legend.layout, '1x5');
		assert.equal(s.config.data.legend['vertical-align'], 'top');
		assert.notEqual(s.config.data.tooltip?.visible, false);
		assert.notEqual(s.config.data.plot.tooltip?.visible, false);
		assert.notEqual(s.config.data.plot['hover-state']?.visible, false);
		assert.deepEqual(s.series.map(line => line.text), SERIES.map(s => s.label));
	}
}

function host(i) { return {id: `dashboard-${i}`, style: {}, replaceChildren() { this.cleared = true; }}; }

describe('dashboard stock/native adapters', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 2});
	});
	afterEach(() => {
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const id of ids) {
		const adapter = adapters[id];
		it(`${id}: reuses compatible update/destroy functions and prepares owned five-series data`, () => {
			assert.equal(adapter.updateChart, originals[id].updateChart);
			assert.equal(adapter.destroyChart, originals[id].destroyChart);
			const frame = freeze(dashboardData()[0]);
			assert.deepEqual(adapter.prepData(frame), adapter.prepData(frame));
			assert.notEqual(adapter.prepData(frame), adapter.prepData(frame));
			const input = adapter.prepData(frame);
			if (id === 'zingchart') assert.deepEqual(input, frame.ys.map(ys => frame.x.map((x, i) => [x, ys[i]])));
			else if (id.startsWith('anychart') || id.startsWith('fusiontime')) assert.deepEqual(input, frame.x.map((x, i) => [x, ...frame.ys.map(ys => ys[i])]));
			else if (id.startsWith('bokeh')) {
				assert.deepEqual(input.x, frame.x); assert.notEqual(input.x, frame.x);
				SERIES.forEach(({id}, s) => { assert.deepEqual(input[id], frame.ys[s]); assert.notEqual(input[id], frame.ys[s]); });
			}
			else frame.x.forEach((time, i) => assert.deepEqual(input[i], {time, ...Object.fromEntries(SERIES.map(({id}, s) => [id, frame.ys[s][i]]))}));
		});

		it(`${id}: batches 20 independent charts, waits for native readiness, replaces 2→300→2 rows, and tears down locally`, async () => {
			const env = vendor(id), hosts = Array.from({length: CHARTS}, (_, i) => host(i));
			let inputs = dashboardData(2).map(frame => freeze(adapter.prepData(frame)));
			const waits = hosts.map(() => ({textContent: 'waiting'}));
			let settled = 0;
			const creating = hosts.map((host, i) => adapter.makeChart(inputs[i], host, waits[i]).then(handle => { settled++; return handle; }));
			await turn();
			assert.equal(env.states.length, CHARTS); assert.equal(settled, 0);
			assert.ok(waits.every(wait => wait.textContent === 'waiting'));
			env.states.forEach(s => s.complete());
			const handles = await Promise.all(creating);
			assert.equal(new Set(handles).size, CHARTS);
			for (let i = 0; i < CHARTS; i++) {
				const s = env.states[i]; configuration(id, s);
				assert.equal(s.host.id, hosts[i].id); assert.equal(s.listenerCount(), 0);
				adapter.validateChart(handles[i], inputs[i], {rows: 2});
			}
			for (const rows of [300, 2]) {
				inputs = dashboardData(rows).map(frame => freeze(adapter.prepData(frame)));
				waits.forEach(wait => { wait.textContent = 'waiting'; });
				settled = 0;
				const updating = handles.map((handle, i) => Promise.resolve(adapter.updateChart(handle, inputs[i], hosts[i], waits[i])).then(() => { settled++; }));
				await turn(); assert.equal(settled, 0);
				env.states.forEach(s => s.complete()); await Promise.all(updating);
				assert.equal(env.states.length, CHARTS);
				for (let i = 0; i < CHARTS; i++) {
					adapter.validateChart(handles[i], inputs[i], {rows});
					assert.equal(env.states[i].listenerCount(), 0);
					assert.equal(waits[i].textContent, 'Done!');
				}
			}
			if (id === 'bokeh') assert.ok(handles.every(handle => handle.getWebGLContexts()[0] === env.context));
			adapter.destroyChart(handles[0]);
			for (let i = 1; i < CHARTS; i++) adapter.validateChart(handles[i], inputs[i], {rows: 2});
			if (id === 'bokeh') assert.equal(handles[1].getWebGLContexts()[0], env.context);
			handles.slice(1).forEach(adapter.destroyChart);
			assert.ok(env.states.every(s => s.destroyed === 1));
			if (id.startsWith('fusiontime')) assert.ok(env.states.every(s => s.store.disposed));
			if (id.startsWith('anychart')) assert.ok(env.states.every(s => s.table.disposed));
			if (id.startsWith('bokeh')) assert.equal(Bokeh.documents.length, 0);
			if (id === 'vega') assert.ok(hosts.every(host => host.cleared));
		});

		it(`${id}: validation reads native series/rows, not just prepared input`, async () => {
			const env = vendor(id), input = freeze(adapter.prepData(dashboardData()[0]));
			for (const corrupt of ['corruptRows', 'corruptSeries']) {
				const creating = adapter.makeChart(input, host(env.states.length));
				const s = env.states.at(-1); s.complete(); const handle = await creating;
				adapter.validateChart(handle, input, {rows: 300});
				s[corrupt]();
				assert.throws(() => adapter.validateChart(handle, input, {rows: 300}));
				adapter.destroyChart(handle);
			}
		});

		it(`${id}: rejects update failures without replacing the handle or leaking listeners`, async () => {
			const env = vendor(id), input = adapter.prepData(dashboardData(2)[0]), element = host(0);
			const creating = adapter.makeChart(input, element); env.states[0].complete(); const handle = await creating;
			const s = env.states[0]; s.fail = true;
			await assert.rejects(async () => adapter.updateChart(handle, input, element), /native failure/);
			assert.equal(s.listenerCount(), 0); assert.equal(s.destroyed, 0);
			adapter.destroyChart(handle); assert.equal(s.destroyed, 1);
		});
	}

	it('Bokeh rejects Canvas fallback and preserves the shared context during failure cleanup', async () => {
		const env = vendor('bokeh'); env.fallback = true;
		const creating = adapters.bokeh.makeChart(adapters.bokeh.prepData(dashboardData()[0]), host(0));
		env.states[0].complete();
		await assert.rejects(creating, /Canvas fallback/);
		assert.equal(env.states[0].destroyed, 1); assert.equal(Bokeh.documents.length, 0);
	});

	for (const id of ['anychart', 'anychart-sampled', 'fusiontime', 'fusiontime-sampled']) {
		it(`${id}: validates the recorded native API shape before and after update`, async () => {
			const adapter = adapters[id], env = vendor(id), element = host(0);
			let input = freeze(adapter.prepData(dashboardData(2)[0]));
			const creating = adapter.makeChart(input, element); env.states[0].complete();
			const handle = await creating;
			if (id.startsWith('anychart')) assert.equal(typeof handle.mappings[0].createSelectable().dispose, 'undefined');
			else {
				const source = handle.chart.getJSONData();
				assert.equal(source.yAxis, undefined); assert.equal(source.yaxis[0].plot.length, 5);
			}
			adapter.validateChart(handle, input, {rows: 2});
			input = freeze(adapter.prepData(dashboardData()[0]));
			const updating = adapter.updateChart(handle, input, element); env.states[0].complete(); await updating;
			adapter.validateChart(handle, input, {rows: 300});
			adapter.destroyChart(handle);
		});
	}

	it('Bokeh rejects a cold 20-chart initialization race without serialization, fallback, or context-limit changes', async () => {
		const env = vendor('bokeh'); env.coldWebGL = true;
		const creating = dashboardData(2).map((frame, i) => adapters.bokeh.makeChart(adapters.bokeh.prepData(frame), host(i)));
		const results = Promise.allSettled(creating);
		await turn();
		assert.equal(env.states.length, CHARTS);
		assert.equal(env.contexts.length, CHARTS, 'native async cache does not deduplicate in-flight initialization');
		assert.equal(env.contexts.filter(context => context.isContextLost()).length, 4);
		env.states.forEach(s => s.complete());
		for (const result of await results) {
			assert.equal(result.status, 'rejected');
			assert.match(result.reason.message, /WebGL initialization failed.*context limit.*Canvas fallback is not allowed/);
		}
		assert.ok(env.states.every(s => s.chart.canvas_view.webgl === null && s.destroyed === 1));
		assert.equal(Bokeh.documents.length, 0);
	});

	it('Bokeh rejects a lost context even when native line support remains true', async () => {
		const env = vendor('bokeh'), input = adapters.bokeh.prepData(dashboardData(2)[0]);
		const creating = adapters.bokeh.makeChart(input, host(0));
		env.states[0].complete();
		const handle = await creating;
		assert.equal([...handle.renderer_views.values()][0].has_webgl, true);
		env.context.lost = true;
		assert.throws(() => adapters.bokeh.validateChart(handle, input, {rows: 2}), /WebGL context is lost/);
		adapters.bokeh.destroyChart(handle);
		const retry = adapters.bokeh.makeChart(input, host(1)); env.states[1].complete();
		await assert.rejects(retry, /WebGL context is lost/);
		assert.ok(env.states.every(s => s.destroyed === 1));
	});

	it('Bokeh accepts native two-point WebGL lines; Canvas does not initialize WebGL', async () => {
		for (const id of ['bokeh', 'bokeh-canvas']) {
			const env = vendor(id); env.coldWebGL = true;
			const input = adapters[id].prepData(dashboardData(2)[0]);
			const creating = adapters[id].makeChart(input, host(0)); env.states[0].complete();
			const handle = await creating;
			adapters[id].validateChart(handle, input, {rows: 2});
			const renderer = [...handle.renderer_views.values()][0];
			assert.equal(typeof renderer.glyph.has_webgl, 'function');
			assert.equal(renderer.has_webgl, id === 'bokeh');
			assert.equal(env.contexts.length, id === 'bokeh' ? 1 : 0);
			adapters[id].destroyChart(handle);
		}
	});

	for (const id of ids.filter(id => !id.startsWith('bokeh'))) it(`${id}: constructor failure cleans its native resources`, async () => {
		const env = vendor(id); env.fail = true;
		await assert.rejects(adapters[id].makeChart(adapters[id].prepData(dashboardData(2)[0]), host(0)), /native failure/);
		assert.equal(env.states.length, 1); assert.equal(env.states[0].destroyed, 1);
		// Disposed AnyStock/FusionTime charts own their remaining event listeners.
		if (!id.startsWith('anychart') && !id.startsWith('fusiontime')) assert.equal(env.states[0].listenerCount(), 0);
		if (id.startsWith('fusiontime')) assert.equal(env.states[0].store.disposed, true);
	});
});
