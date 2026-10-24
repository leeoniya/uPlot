import assert from 'node:assert/strict';
import {epoch, minute, groupedLibraries} from '../../demos/reduction-accuracy-grouped.js';

const input = Object.freeze([
	Object.freeze([0, 0.25, 2, 1000]),
	Object.freeze([10, -20, 30, 40]),
]);
// Deliberately unlike the input: adapters must read vendor output, not copy or reduce input.
const processed = [[0.5, 77], [4.25, -33]];
const timestamps = processed.map(([x, y]) => [epoch + x * minute, y]);
const ids = ['amcharts', 'devextreme', 'anychart', 'fusiontime'];
const disposalOrder = {
	amcharts: ['chart'], devextreme: ['chart'],
	anychart: ['chart', 'mapping', 'table', 'scale'], fusiontime: ['chart', 'store'],
};
const forbidden = new Set([
	'groupCount', 'groupInterval', 'groupIntervals',
	'aggregationGroupWidth', 'aggregationInterval', 'interval',
	'maxVisiblePoints', 'levels', 'minPixPerPoint', 'binning', 'samples', 'threshold',
]);

function defaultBudgets(value, seen = new Set()) {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	for (const [key, child] of Object.entries(value)) {
		assert.ok(!forbidden.has(key), `Unexpected budget override: ${key}`);
		defaultBudgets(child, seen);
	}
}

function vendor(id, {sync = false, fail = false, extractionError = false, cleanupError = false, noIterator = false, noBin = false} = {}) {
	const s = {
		options: [], disposed: [], listeners: new Map(), reads: 0, ready: false,
		error: new Error('vendor failure'), cleanupError: new Error('cleanup failure'),
	};
	const resource = name => ({dispose() {
		assert.ok(!s.disposed.includes(name), `Double disposal: ${name}`);
		s.disposed.push(name);
		if (cleanupError && name === 'chart') throw s.cleanupError;
	}});
	const listen = (name, fn) => { s.listeners.set(name, fn); };
	const unlisten = (name, fn) => {
		assert.equal(s.listeners.get(name), fn);
		s.listeners.delete(name);
	};
	const start = fn => {
		s.complete = () => { s.ready = true; fn(); };
		if (fail) throw s.error;
		if (sync) s.complete();
	};
	const read = () => {
		assert.equal(s.ready, true, 'Do not extract before vendor readiness');
		s.reads++;
		if (extractionError) throw s.error;
	};
	const push = {push: value => value};

	if (id === 'amcharts') {
		const root = s.root = {
			...resource('chart'), container: {children: push}, animationTime: 1,
			events: {on(name, fn) { listen(name, fn); return {dispose: () => unlisten(name, fn)}; }},
		};
		const make = name => ({new(root, settings) {
			s.options.push({name, settings});
			return {
				children: push, xAxes: push, yAxes: push, series: push,
				strokes: {template: {setAll() {}}},
				dataItems: timestamps.map(row => ({get(field) {
					read();
					assert.ok(['valueX', 'valueY'].includes(field));
					return row[field === 'valueX' ? 0 : 1];
				}})),
				data: {setAll(rows) {
					s.rows = rows;
					start(() => {
						s.listeners.get('frameended')();
						root.animationTime = null;
					});
				}},
			};
		}});
		globalThis.am5 = {Root: {new: () => root}, color: value => value};
		globalThis.am5xy = Object.fromEntries(['XYChart', 'DateAxis', 'ValueAxis', 'AxisRendererX', 'AxisRendererY', 'LineSeries'].map(name => [name, make(name)]));
	}
	else if (id === 'devextreme') {
		globalThis.DevExpress = {viz: {dxChart: class {
			constructor(host, options) {
				s.options.push(options);
				s.rows = options.dataSource;
				const chart = {...resource('chart'), getAllSeries: () => [{getAllPoints() {
					read();
					return timestamps.map(([argument, value]) => ({argument: new Date(argument), value}));
				}}]};
				options.onInitialized({component: chart});
				start(() => options.onDone());
				return chart;
			}
		}}};
	}
	else if (id === 'anychart') {
		let cursor = -1;
		s.resets = 0;
		const iterator = {
			reset() { cursor = -1; s.resets++; },
			advance() { return ++cursor < timestamps.length; },
			getKey: () => timestamps[cursor][0],
			get(field) { read(); assert.equal(field, 'value'); return timestamps[cursor][1]; },
		};
		const markers = {markers: () => ({enabled() {}})};
		const series = {
			stroke() {}, normal: () => markers, hovered: () => markers, selected: () => markers,
			...(noIterator ? {} : {getIterator: () => iterator}),
		};
		const scale = {...resource('scale'), minimum(value) { s.min = value; }, maximum(value) { s.max = value; }};
		const grouping = key => ({
			enabled(value) { s[key] = value; },
			...Object.fromEntries(['maxVisiblePoints', 'levels', 'minPixPerPoint', 'forced'].map(name => [name, () => {
				assert.fail(`Unexpected Stock grouping override: ${name}`);
			}])),
		});
		const chart = {
			...resource('chart'), animation() {}, bounds(...args) { s.bounds = args; },
			xScale: () => ({minimumGap() {}, maximumGap() {}}),
			grouping(...args) { assert.equal(args.length, 0); return grouping('grouping'); },
			scrollerGrouping(...args) { assert.equal(args.length, 0); return grouping('scrollerGrouping'); },
			scroller: () => ({enabled() {}}),
			plot: () => ({yScale() {}, legend: () => ({enabled() {}}), line: () => series}),
			selectRange(...range) { s.range = range; }, container() {},
			listenOnce: listen, unlisten, draw() { start(() => s.listeners.get('chartDraw')()); },
		};
		const table = {...resource('table'), addData(rows) { s.rows = rows; }, mapAs(mapping) {
			s.mapping = mapping;
			return resource('mapping');
		}};
		globalThis.anychart = {scales: {linear: () => scale}, data: {table: () => table}, stock: () => chart};
	}
	else {
		globalThis.FusionCharts = class {
			constructor(options) {
				s.options.push(options);
				return {
					...resource('chart'), addEventListener: listen, removeEventListener: unlisten,
					render() { start(() => s.listeners.get('renderComplete')()); },
					getCurrentBin() {
						read();
						if (noBin) throw s.error;
						return {unit: 'hour', multiplier: 2};
					},
				};
			}
			static DataStore = class {
				constructor() {
					return {...resource('store'), createDataTable(rows, schema, options) {
						s.rows = rows;
						assert.equal(schema[0].format, '%Q');
						assert.equal(options.enableUTC, true);
						// Match the vendor's row-ID mutation, without touching the frozen fixture.
						rows.forEach((row, i) => row.push(i));
						return {rows};
					}};
				}
			};
		};
	}
	return s;
}

function configuration(id, s, mode) {
	s.options.forEach(options => defaultBudgets(options));
	if (id === 'amcharts') {
		const axis = s.options.find(o => o.name === 'DateAxis').settings;
		const series = s.options.find(o => o.name === 'LineSeries').settings;
		assert.equal(axis.groupData, mode !== 'raw');
		assert.equal(Object.hasOwn(series, 'valueYGrouped'), mode === 'average');
		if (mode === 'average') assert.equal(series.valueYGrouped, 'average');
		assert.equal(axis.min, epoch);
		assert.equal(axis.max, epoch + 1000 * minute);
		assert.equal(s.root.utc, true);
	}
	else if (id === 'devextreme') {
		const options = s.options[0];
		assert.deepEqual(options.commonSeriesSettings.aggregation, {enabled: mode !== 'raw'});
		assert.deepEqual(options.size, {width: 580, height: 250});
		assert.deepEqual(options.argumentAxis.visualRange, {startValue: new Date(epoch), endValue: new Date(epoch + 1000 * minute)});
		assert.deepEqual(options.valueAxis.visualRange, {startValue: -120, endValue: 120});
	}
	else if (id === 'anychart') {
		assert.equal(s.grouping, mode === 'raw' ? false : undefined);
		assert.equal(s.scrollerGrouping, mode === 'raw' ? false : undefined);
		assert.deepEqual(s.mapping, {value: mode === 'average' ? {column: 1, type: 'average'} : 1});
		assert.deepEqual(s.range, [epoch, epoch + 1000 * minute]);
		assert.deepEqual(s.bounds, [0, 0, 580, 250]);
		assert.deepEqual([s.min, s.max], [-120, 120]);
	}
	else {
		const source = s.options[0].dataSource;
		assert.deepEqual(source.xAxis, {plot: 'Time', initialInterval: {from: epoch, to: epoch + 1000 * minute}});
		assert.deepEqual(source.yAxis[0].plot, [{value: 'Value', type: 'line'}]);
		assert.deepEqual([source.yAxis[0].min, source.yAxis[0].max], [-120, 120]);
	}
}

function preservedInput(s) {
	assert.equal(s.rows.length, input[0].length);
	s.rows.forEach((row, i) => {
		assert.equal(Array.isArray(row) ? row[0] : +row.x, epoch + input[0][i] * minute);
		assert.equal(Array.isArray(row) ? row[1] : row.y, input[1][i]);
	});
	assert.deepEqual(input, [[0, 0.25, 2, 1000], [10, -20, 30, 40]]);
}

describe('reduction accuracy grouped adapters (mock vendors only)', () => {
	let saved, timers, nextTimer;
	beforeEach(() => {
		saved = Object.fromEntries(['am5', 'am5xy', 'DevExpress', 'anychart', 'FusionCharts', 'setTimeout', 'clearTimeout']
			.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		timers = new Map();
		nextTimer = 0;
		globalThis.setTimeout = (fn, ms) => {
			assert.equal(ms, 15000);
			timers.set(++nextTimer, fn);
			return nextTimer;
		};
		globalThis.clearTimeout = id => timers.delete(id);
	});
	afterEach(() => {
		try { assert.equal(timers.size, 0, 'Readiness timers must be cleared'); }
		finally {
			for (const [key, descriptor] of Object.entries(saved)) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else delete globalThis[key];
			}
		}
	});

	it('exports the expected modes, with FusionTime default-only', () => {
		assert.equal(epoch, Date.UTC(2024, 0, 1));
		assert.equal(minute, 60000);
		assert.deepEqual(Object.keys(groupedLibraries), ids);
		for (const id of ids) {
			const lib = groupedLibraries[id];
			assert.equal(typeof lib.label, 'string');
			assert.equal(typeof lib.note, 'string');
			assert.equal(typeof lib.render, 'function');
			assert.deepEqual(lib.modes.map(m => m.value), id === 'fusiontime' ? ['default'] :
				id === 'devextreme' ? ['default', 'raw'] : ['default', 'average', 'raw']);
			lib.modes.forEach(m => assert.equal(typeof m.label, 'string'));
		}
	});

	for (const id of ids) {
		const lib = groupedLibraries[id];
		for (const {value: mode} of lib.modes) {
			for (const sync of [false, true]) {
				it(`${id}/${mode}: default budgets, processed output, and ${sync ? 'synchronous' : 'deferred'} readiness`, async () => {
					const s = vendor(id, {sync});
					const host = {style: {}};
					const pending = lib.render(host, input, mode);
					if (!sync) {
						let finished = false;
						pending.then(() => { finished = true; });
						await Promise.resolve();
						assert.equal(finished, false);
						assert.equal(s.reads, 0);
						s.complete();
					}
					const result = await pending;
					assert.deepEqual(host.style, {width: '580px', height: '250px'});
					configuration(id, s, mode);
					preservedInput(s);
					assert.deepEqual(result.points, id === 'fusiontime' ? null : processed);
					assert.ok(s.reads > 0);
					if (id === 'fusiontime') {
						assert.match(result.note, /Current native bin: 2 hour/);
						assert.match(result.note, /Processed points are not exposed/);
					}
					if (id === 'anychart') assert.equal(s.resets, 2);
					assert.equal(s.listeners.size, 0);
					assert.equal(timers.size, 0);
					assert.deepEqual(s.disposed, []);
					result.destroy();
					result.destroy();
					assert.deepEqual(s.disposed, disposalOrder[id]);
				});
			}
		}

		it(`${id}: omitted mode uses native defaults, not explicit average`, async () => {
			const s = vendor(id, {sync: true});
			const result = await lib.render({style: {}}, input);
			configuration(id, s, 'default');
			result.destroy();
		});

		for (const cleanupError of [false, true]) {
			it(`${id}: render failure cleans up${cleanupError ? ' even when disposal throws' : ''}`, async () => {
				const s = vendor(id, {fail: true, cleanupError});
				await assert.rejects(lib.render({style: {}}, input), error => error === s.error);
				assert.deepEqual(s.disposed, disposalOrder[id]);
				assert.equal(s.listeners.size, 0);
			});
		}

		it(`${id}: readiness timeout rejects and releases all resources`, async () => {
			const s = vendor(id);
			const pending = lib.render({style: {}}, input);
			assert.equal(timers.size, 1);
			for (const expire of timers.values()) expire();
			await assert.rejects(pending, /did not finish rendering within 15 seconds/);
			assert.deepEqual(s.disposed, disposalOrder[id]);
			assert.equal(s.listeners.size, 0);
			assert.equal(s.reads, 0);
		});

		it(`${id}: destroy drains cleanup once even if chart disposal throws`, async () => {
			const s = vendor(id, {sync: true, cleanupError: true});
			const result = await lib.render({style: {}}, input);
			assert.throws(() => result.destroy(), error => error === s.cleanupError);
			assert.doesNotThrow(() => result.destroy());
			assert.deepEqual(s.disposed, disposalOrder[id]);
		});

		it(`${id}: rejects invalid mode and data before constructing a vendor`, async () => {
			for (const mode of ['unsupported', 'fixture-minute'])
				await assert.rejects(lib.render({style: {}}, input, mode), /unsupported mode/);
			for (const data of [[[], []], [[0], []]])
				await assert.rejects(lib.render({style: {}}, data), /nonempty, equal-length/);
		});

		if (id !== 'fusiontime') {
			it(`${id}: extraction failure releases the chart, listeners, and timer`, async () => {
				const s = vendor(id, {sync: true, extractionError: true});
				await assert.rejects(lib.render({style: {}}, input), error => error === s.error);
				assert.deepEqual(s.disposed, disposalOrder[id]);
				assert.equal(s.listeners.size, 0);
				if (id === 'anychart') assert.equal(s.resets, 2);
			});
		}
	}

	it('amCharts: waits for render-loop completion, not just frameended', async () => {
		const s = vendor('amcharts');
		const pending = groupedLibraries.amcharts.render({style: {}}, input);
		s.listeners.get('frameended')();
		await Promise.resolve();
		assert.equal(s.reads, 0);
		s.complete();
		(await pending).destroy();
	});

	it('DevExtreme: ignores warning incidents but rejects errors and cleans up', async () => {
		const s = vendor('devextreme');
		const pending = groupedLibraries.devextreme.render({style: {}}, input);
		const incident = s.options[0].onIncidentOccurred;
		incident({target: {id: 'W0019', text: 'Evaluation warning'}});
		await Promise.resolve();
		assert.deepEqual(s.disposed, []);
		assert.equal(s.reads, 0);
		incident({target: {id: 'E123', text: 'Invalid data'}});
		await assert.rejects(pending, /DevExtreme E123: Invalid data/);
		assert.deepEqual(s.disposed, ['chart']);
	});

	it('AnyStock: returns null with an honest note when its active iterator is unavailable', async () => {
		const s = vendor('anychart', {sync: true, noIterator: true});
		const result = await groupedLibraries.anychart.render({style: {}}, input);
		assert.equal(result.points, null);
		assert.match(result.note, /iterator is unavailable/);
		assert.equal(s.reads, 0);
		result.destroy();
	});

	for (const event of ['dataInvalid', 'dataLoadError']) {
		it(`FusionTime: ${event} rejects and removes every listener`, async () => {
			const s = vendor('fusiontime');
			const pending = groupedLibraries.fusiontime.render({style: {}}, input);
			s.listeners.get(event)({}, {error: {message: 'Invalid data'}});
			await assert.rejects(pending, new RegExp(`FusionTime ${event}: Invalid data`));
			assert.equal(s.listeners.size, 0);
			assert.deepEqual(s.disposed, ['chart', 'store']);
		});
	}

	it('FusionTime: missing bin metadata never substitutes input for processed output', async () => {
		const s = vendor('fusiontime', {sync: true, noBin: true});
		const result = await groupedLibraries.fusiontime.render({style: {}}, input);
		assert.equal(result.points, null);
		assert.match(result.note, /Current native bin is unavailable/);
		assert.match(result.note, /input rows are not reported as binned output/);
		result.destroy();
		assert.deepEqual(s.disposed, ['chart', 'store']);
	});
});
