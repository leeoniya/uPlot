import assert from 'node:assert/strict';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {benchmarkVariants} from '../../bench/demo-dependencies.mjs';

const variants = [
	'agcharts', 'anychart', 'anychart-sampled', 'fusiontime', 'fusiontime-sampled',
	'devextreme', 'devextreme-sampled', 'vega', 'billboard', 'zingchart',
	'syncfusion', 'amcharts', 'amcharts-sampled', 'kendo',
];
const adapters = Object.fromEntries(await Promise.all(variants.map(async id =>
	[id, await import(`../../bench/${id}.mjs`)])));
const target = Object.freeze({width: 1200, height: 400});
const resizeCalls = {
	agcharts: ['updateDelta'],
	anychart: ['stage.resize', 'bounds', 'draw'],
	fusiontime: ['resizeTo'],
	devextreme: ['option'],
	vega: ['width', 'height', 'resize', 'runAsync'],
	billboard: ['resize'],
	zingchart: ['exec'],
	syncfusion: ['dataBind'],
	amcharts: ['resize'],
	kendo: ['redraw'],
};
let restorers;

function replaceGlobal(name, value) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
	restorers.push(() => {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else delete globalThis[name];
	});
}

function events() {
	const listeners = new Map();
	return {
		on(name, fn) {
			if (!listeners.has(name)) listeners.set(name, new Set());
			listeners.get(name).add(fn);
		},
		off(name, fn) { listeners.get(name)?.delete(fn); },
		emit(name, ...args) {
			// Live iteration also catches adapters removing listeners during dispatch.
			for (const fn of listeners.get(name) ?? []) fn(...args);
		},
		count(name) { return listeners.get(name)?.size ?? 0; },
		total() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
	};
}

function deferred() {
	let resolve, reject;
	const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
	return {promise, resolve, reject};
}

async function pending(promise, wait) {
	let settled = false;
	promise.then(() => { settled = true; }, () => { settled = true; });
	for (let i = 0; i < 4; i++) await Promise.resolve();
	assert.equal(settled, false, 'must wait for this resize to finish');
	assert.equal(wait.textContent, 'waiting');
}

async function fixture(id) {
	const base = id.replace('-sampled', '');
	const adapter = adapters[id];
	const emitter = events();
	const timers = new Map();
	if (base === 'anychart' || base === 'fusiontime') {
		replaceGlobal('setTimeout', (fn, ms) => {
			assert.equal(ms, 30000);
			const timer = {};
			timers.set(timer, fn);
			return timer;
		});
		replaceGlobal('clearTimeout', timer => { timers.delete(timer); });
	}
	const source = Object.freeze([Object.freeze({time: 1, cpu: 2, ram: 3, tcp: 4})]);
	const host = {id: 'benchmark-' + id, style: Object.freeze({width: '1200px', height: '400px'})};
	const wait = {textContent: 'waiting'};
	const state = {fail: false, synchronous: false, calls: [], size: target};
	const chart = {};
	Object.defineProperty(chart, 'data', {value: source});
	let handle = chart, finish, stale = () => {}, barrier, originalLoaded;
	let refs = () => [handle, chart, chart.data];
	const globals = replaceGlobal;
	const attached = name => assert.ok(emitter.count(name) > 0, `${name} must be attached before mutation`);
	const mutate = (name, args) => {
		state.calls.push([name, args]);
		if (state.fail) throw new Error('native resize failed');
		if (state.synchronous) finish();
	};
	const apiEvents = (on, off) => {
		chart[on] = (name, fn) => emitter.on(name, fn);
		chart[off] = (name, fn) => emitter.off(name, fn);
	};

	switch (base) {
		case 'agcharts':
			chart.updateDelta = size => {
				assert.deepEqual(size, state.size);
				barrier = deferred();
				mutate('updateDelta', size);
				return barrier.promise;
			};
			finish = () => barrier.resolve();
			break;
		case 'vega':
			chart.width = width => { assert.equal(width, state.size.width); state.calls.push(['width', width]); return chart; };
			chart.height = height => { assert.equal(height, state.size.height); state.calls.push(['height', height]); return chart; };
			chart.resize = () => { state.calls.push(['resize']); return chart; };
			chart.runAsync = () => {
				barrier = deferred();
				mutate('runAsync');
				return barrier.promise;
			};
			finish = () => barrier.resolve();
			break;
		case 'anychart': {
			let suspended = false;
			chart.listenOnce = (name, fn) => {
				// Keep the callback until unlisten, to check explicit cleanup on all paths.
				emitter.on(name, fn);
			};
			chart.unlisten = (name, fn) => emitter.off(name, fn);
			chart.suspendSignalsDispatching = () => { attached('chartDraw'); suspended = true; };
			chart.resumeSignalsDispatching = dispatch => { assert.equal(dispatch, false); suspended = false; };
			const stage = {resize(width, height) {
				attached('chartDraw');
				assert.equal(suspended, true);
				assert.deepEqual({width, height}, state.size);
				state.calls.push(['stage.resize', {width, height}]);
				if (state.fail) throw new Error('native resize failed');
			}};
			chart.container = () => ({getStage: () => stage});
			chart.bounds = (x, y, width, height) => {
				assert.equal(suspended, true);
				assert.deepEqual([x, y], [0, 0]);
				assert.deepEqual({width, height}, state.size);
				state.calls.push(['bounds', {width, height}]);
				return chart;
			};
			chart.draw = () => { assert.equal(suspended, false); mutate('draw'); };
			finish = () => emitter.emit('chartDraw');
			handle = {chart, table: {data: source}, mappings: Object.freeze([{}]), scales: Object.freeze([{}])};
			refs = () => [handle, handle.chart, handle.table, handle.table.data, handle.mappings, handle.scales, stage];
			state.check = () => assert.equal(suspended, false);
			break;
		}
		case 'fusiontime':
			apiEvents('addEventListener', 'removeEventListener');
			chart.resizeTo = (width, height) => {
				for (const name of ['resized', 'resizecancelled', 'dataInvalid', 'dataLoadError']) attached(name);
				assert.deepEqual({width, height}, state.size);
				mutate('resizeTo', {width, height});
			};
			finish = () => emitter.emit('resized', {}, {width: String(state.size.width), height: String(state.size.height)});
			stale = () => {
				emitter.emit('renderComplete');
				emitter.emit('resized', {}, {width: 1920, height: 600});
			};
			handle = {chart, store: {table: {data: source}}};
			refs = () => [handle, handle.chart, handle.store, handle.store.table, handle.store.table.data];
			break;
		case 'devextreme':
			apiEvents('on', 'off');
			chart.option = (name, size) => {
				attached('drawn'); attached('incidentOccurred');
				assert.equal(name, 'size');
				assert.deepEqual(size, state.size);
				mutate('option', size);
			};
			finish = () => emitter.emit('drawn');
			stale = () => emitter.emit('done');
			break;
		case 'billboard': {
			let options, created = 0;
			globals('devicePixelRatio', 1);
			globals('bb', {generate(config) {
				created++;
				options = config;
				config.onbeforeinit.call(chart);
				config.onrendered.call(chart);
				return chart;
			}});
			chart.resize = size => { assert.deepEqual(size, state.size); mutate('resize', size); };
			finish = () => options.onrendered.call(chart);
			handle = await adapter.makeChart(source, host);
			state.check = () => {
				assert.equal(created, 1);
				assert.equal(options.data.columns, source);
				assert.equal(options.resize.auto, false);
			};
			break;
		}
		case 'zingchart':
			handle = host;
			globals('zingchart', {
				bind(id, name, fn) { assert.equal(id, host.id); emitter.on(name, fn); },
				unbind(id, name, fn) { assert.equal(id, host.id); emitter.off(name, fn); },
				exec(id, command, size) {
					assert.equal(id, host.id);
					attached('complete'); attached('error');
					assert.equal(command, 'resize');
					assert.deepEqual(size, state.size);
					mutate('exec', size);
				},
			});
			finish = () => emitter.emit('complete');
			break;
		case 'syncfusion':
			originalLoaded = chart.loaded = () => {};
			for (const key of ['width', 'height']) {
				let value;
				Object.defineProperty(chart, key, {
					get: () => value,
					set(next) {
						assert.notEqual(chart.loaded, originalLoaded);
						assert.equal(next, String(state.size[key]));
						value = next;
					},
				});
			}
			chart.series = Object.freeze([{dataSource: source}].map(Object.freeze));
			chart.dataBind = () => {
							assert.equal(chart.width, String(state.size.width));
							assert.equal(chart.height, String(state.size.height));
							mutate('dataBind', {width: chart.width, height: chart.height});
						};
			finish = () => chart.loaded({chart});
			refs = () => [handle, chart, chart.series, chart.series[0].dataSource];
			state.check = () => assert.equal(chart.loaded, originalLoaded);
			break;
		case 'amcharts': {
			const xy = {series: Object.freeze([Object.freeze({data: source})]), groupCount: 1920};
			chart.container = {children: {getIndex: () => xy}};
			refs = () => [handle, chart, chart.container.children.getIndex(0), xy.series, xy.series[0].data];
			chart.autoResize = false;
			chart.animationTime = null;
			chart.events = {on(name, fn) {
				emitter.on(name, fn);
				return {dispose() { emitter.off(name, fn); }};
			}};
			chart.resize = (...args) => {
				attached('frameended');
				assert.deepEqual(args, []);
				assert.deepEqual(host.style, {width: state.size.width + 'px', height: state.size.height + 'px'});
				mutate('resize');
			};
			finish = () => {
				chart.animationTime = 1;
				emitter.emit('frameended');
				// The pinned Root clears animationTime after dispatching frameended.
				chart.animationTime = null;
			};
			stale = () => { chart.animationTime = 1; emitter.emit('frameended'); };
			state.check = () => {
				assert.equal(chart.autoResize, false);
				assert.equal(xy.groupCount, 1920);
			};
			break;
		}
		case 'kendo':
			apiEvents('bind', 'unbind');
			chart.options = {chartArea: new Proxy({width: 1920, height: 600}, {
				set(area, key, value) { attached('render'); area[key] = value; return true; },
			}), series: Object.freeze([Object.freeze({data: source})])};
			chart._instance = {options: chart.options};
			chart.redraw = () => {
				assert.deepEqual(chart.options.chartArea, state.size);
				mutate('redraw');
			};
			finish = () => emitter.emit('render');
			refs = () => [handle, chart._instance, chart.options, chart.options.series, chart.options.series[0].data];
			break;
	}
	const retained = refs();
	return {
		base, chart, handle, state, emitter, timers, wait, finish, stale,
		reject: error => barrier.reject(error),
		resize: (status = wait) => {
					// Mirror the harness: host sizing precedes the adapter call.
					host.style = Object.freeze({width: state.size.width + 'px', height: state.size.height + 'px'});
					return adapter.resizeChart(handle, state.size, host, status);
				},
		check() {
			const current = refs();
			retained.forEach((value, i) => assert.equal(current[i], value));
			assert.deepEqual(source, [{time: 1, cpu: 2, ram: 3, tcp: 4}]);
			assert.equal(emitter.total(), 0, 'temporary listeners must be removed');
			assert.equal(timers.size, 0, 'deadline timers must be cleared');
			state.check?.();
		},
	};
}

describe('bench-resize-vendors', () => {
	beforeEach(() => { restorers = []; });
	afterEach(() => { for (const restore of restorers.reverse()) restore(); });

	for (const id of variants) {
		it(`${id}: resize capability and sampled exports`, () => {
			assert.ok(benchmarkVariants.includes(id));
			for (const name of ['makeChart', 'makeEmptyChart', 'updateChart', 'resizeChart', 'destroyChart'])
				assert.equal(typeof adapters[id][name], 'function', name);
			if (id.endsWith('-sampled'))
				assert.equal(adapters[id].resizeChart, adapters[id.replace('-sampled', '')].resizeChart);
		});

		it(`${id}: waits for a fresh resize and retains the handle/data`, async () => {
			const f = await fixture(id);
			if (!['agcharts', 'vega'].includes(f.base)) f.finish(); // Old completed output is not readiness.
			for (const size of [target, {width: 1000, height: 350}]) {
				f.state.size = size;
				f.state.calls.length = 0;
				f.wait.textContent = 'waiting';
				const promise = f.resize();
				assert.deepEqual(f.state.calls.map(([name]) => name), resizeCalls[f.base]);
				await pending(promise, f.wait);
				f.stale();
				await pending(promise, f.wait);
				f.finish();
				const result = await promise;
				assert.ok(result === undefined || result === f.handle);
				assert.equal(f.wait.textContent, 'Done!');
				f.check();
			}
		});

		it(`${id}: supports an omitted status element`, async () => {
					const f = await fixture(id);
					f.state.synchronous = true;
					await f.resize(null);
					assert.equal(f.wait.textContent, 'waiting');
					f.check();
				});

				it(`${id}: observes synchronous completion`, async () => {
			const f = await fixture(id);
			f.state.synchronous = true;
			const result = await f.resize();
			assert.ok(result === undefined || result === f.handle);
			assert.equal(f.wait.textContent, 'Done!');
			f.check();
		});

		it(`${id}: propagates native throws, cleans up, and permits retry`, async () => {
			const f = await fixture(id);
			f.state.fail = true;
			await assert.rejects(f.resize(), /native resize failed/);
			assert.equal(f.wait.textContent, 'waiting');
			f.check();
			f.state.fail = false;
			f.state.synchronous = true;
			await f.resize();
			f.check();
		});
	}

	for (const id of ['agcharts', 'vega']) {
		it(`${id}: awaits and propagates native promise rejection`, async () => {
			const f = await fixture(id);
			const promise = f.resize();
			f.reject(new Error('render failed'));
			await assert.rejects(promise, /render failed/);
			assert.equal(f.wait.textContent, 'waiting');
			f.check();
		});
	}

	for (const id of ['anychart', 'fusiontime']) {
		it(`${id}: rejects on timeout and removes the listener and timer`, async () => {
			const f = await fixture(id);
			const promise = f.resize();
			assert.equal(f.timers.size, 1);
			for (const timeout of f.timers.values()) timeout();
			await assert.rejects(promise, /did not finish resizing within 30 seconds/);
			assert.equal(f.wait.textContent, 'waiting');
			f.check();
		});
	}

	for (const name of ['resizecancelled', 'dataInvalid', 'dataLoadError']) {
		it(`fusiontime: rejects ${name} without destroying the retained chart`, async () => {
			const f = await fixture('fusiontime');
			const promise = f.resize();
			f.emitter.emit(name, {eventType: name}, {message: 'resize failed'});
			await assert.rejects(promise, new RegExp(name));
			f.check();
		});
	}

	it('devextreme: ignores warning incidents and rejects error incidents', async () => {
		const f = await fixture('devextreme');
		const promise = f.resize();
		f.emitter.emit('incidentOccurred', {target: {id: 'W001', text: 'warning'}});
		await pending(promise, f.wait);
		f.emitter.emit('incidentOccurred', {target: {id: 'E001', text: 'resize failed'}});
		await assert.rejects(promise, /DevExtreme E001: resize failed/);
		f.check();
	});

	it('zingchart: rejects error events and keeps the registered chart', async () => {
		const f = await fixture('zingchart');
		const promise = f.resize();
		f.emitter.emit('error', {error: new Error('resize failed')});
		await assert.rejects(promise, /resize failed/);
		f.check();
	});

	it('zingchart: removes listeners after the complete dispatch, not during it', async () => {
		const f = await fixture('zingchart');
		const promise = f.resize();
		f.emitter.on('complete', () => {
			assert.equal(f.emitter.count('complete'), 2);
			assert.equal(f.emitter.count('error'), 1);
		});
		f.finish();
		await promise;
		assert.equal(f.emitter.count('complete'), 1, 'must preserve unrelated listeners');
		assert.equal(f.emitter.count('error'), 0);
	});

	it('billboard: refuses overlap without replacing the pending resize callback', async () => {
		const f = await fixture('billboard');
		const promise = f.resize();
		await assert.rejects(f.resize(), /already pending/);
		await pending(promise, f.wait);
		f.finish();
		await promise;
		f.check();
	});
});
