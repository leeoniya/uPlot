import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { checkModuleSyntax, demos, evaluate } from '../helpers/bench-demo-evaluator.mjs';

const root = new URL('../../', import.meta.url);
const files = new Map([...demos.map(([id]) => `/bench/${id}.mjs`), '/bench/fmtDate.js']
	.map(route => [route, readFileSync(new URL(route.slice(1), root), 'utf8')]));
const packed = [8, 'epoch', 'idl', 'recv', 'send', 'read', 'writ', 'used', 'free',
	10, 75, 2, 3, 4, 25, 75, 0,
	11, 50, 2, 6, 4, 50, 50, 0];

describe('benchmark demo sources', () => {
	it('parses all six literal ES modules with the shared export contract', () => {
		for (const [id] of demos) {
			const source = files.get(`/bench/${id}.mjs`);

			assert.match(source, /export \{makeChart, prepData\};\s*$/);
			checkModuleSyntax(source);
		}
	});

	for (const [id] of demos) {
		it(`${id}: defines callable functions without auto-fetching, rendering, or changing wait text`, () => {
			const {exports, calls, wait} = evaluate(files, id);
			assert.equal(typeof exports.makeChart, 'function');
			assert.equal(typeof exports.prepData, 'function');
			assert.deepEqual(calls, []);
			assert.equal(wait.textContent, 'not started');
		});
	}

	it('imports the actual ES modules without fetching or creating charts', () => {
		const urls = demos.map(([id]) => new URL(`bench/${id}.mjs`, root).href);
		execFileSync(process.execPath, ['--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			const wait = {textContent: 'not started'};
			globalThis.document = new Proxy({}, {get() { assert.fail('import must not access the DOM'); }});
			globalThis.devicePixelRatio = 2;
			globalThis.fetch = globalThis.setTimeout = globalThis.requestAnimationFrame = () => assert.fail('auto-start');
			for (const url of ${JSON.stringify(urls)}) {
				const demo = await import(url);
				assert.deepEqual(Object.keys(demo), ['makeChart', 'prepData']);
				assert.equal(typeof demo.makeChart, 'function');
				assert.equal(typeof demo.prepData, 'function');
			}
			assert.equal(wait.textContent, 'not started');
		`], {timeout: 10000, stdio: 'pipe'});
	});

	for (const [id] of demos) {
		it(id + ': prepares benchmark data', () => {
			const {exports} = evaluate(files, id);
			const data = exports.prepData(packed);
			const expected = id === 'uplot' ? [[600, 660], [25, 50], [25, 50], [3, 6]] :
							id === 'd3' ? [[600000, 660000], [25, 50], [25, 50], [3, 6]] :
				id === 'chartjs' ? [[{x: 600000, y: 25}, {x: 660000, y: 50}],
					[{x: 600000, y: 25}, {x: 660000, y: 50}], [{x: 600000, y: 3}, {x: 660000, y: 6}]] :
				id === 'flot' ? [[[600000, 25], [660000, 50]], [[600000, 25], [660000, 50]], [[600000, 3], [660000, 6]]] :
				id === 'dygraphs' ? [['1970-01-01T00:10:00.000Z', 25, 25, 3], ['1970-01-01T00:11:00.000Z', 50, 50, 6]] :
					[660000, 25, 25, 3, 720000, 50, 50, 6];
			assert.deepEqual(JSON.parse(JSON.stringify(Array.from(data))), expected);
		});
	}

	it('retains D3 devicePixelRatio at evaluation time rather than hardcoding a DPR', () => {
		assert.match(files.get('/bench/d3.mjs'), /const pxRatio = devicePixelRatio;/);
		for (const dpr of [1, 1.5, 2]) {
			const {exports, sandbox} = evaluate(files, 'd3', {devicePixelRatio: dpr});
			sandbox.devicePixelRatio = 3;
			const scales = [];
			const ctx = {scale: (...args) => scales.push(args)};
			const canvas = {getContext: kind => { assert.equal(kind, '2d'); return ctx; }};
			assert.equal(exports.setupCanvas(canvas), ctx);
			assert.equal(canvas.width, 1920 * dpr);
			assert.equal(canvas.height, 600 * dpr);
			assert.deepEqual(scales, [[dpr, dpr]]);
		}
	});

	for (const [id, method] of [['chartjs', 'destroy'], ['echarts', 'dispose']]) {
		it(`${id}: returns the created instance for ${method} cleanup`, () => {
			let created, configured = false, disposed = false;
			const wait = {};
			const ctx = {};
			const dom = {querySelector(selector) {
								assert.equal(selector, '#chart1');
								return {getContext: kind => { assert.equal(kind, '2d'); return ctx; }};
							}};
			const instance = {[method]() { disposed = true; }};
			const data = [[], [], []];
			const {exports} = evaluate(files, id, {

				Chart: function(context, config) {
					assert.equal(context, ctx);
					assert.equal(config.data.datasets[0].data, data[0]);
					assert.equal(config.options.animation, false);
					created = instance;
					return instance;
				},
				echarts: {init(element, theme, options) {
					assert.equal(element, dom);
					assert.equal(theme, null);
					assert.equal(options.width, 1920);
					instance.setOption = (config, opts) => {
						assert.equal(config.dataset.source, data);
						assert.equal(config.animation, false);
						assert.equal(opts.notMerge, true);
						configured = true;
					};
					created = instance;
					return instance;
				}},
			});
			const chart = exports.makeChart(data, dom, wait);
			assert.equal(chart, created);
			assert.equal(chart, instance);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(disposed, false);
			if (id === 'echarts') assert.equal(configured, true);
			chart[method]();
			assert.equal(disposed, true);
		});
	}

	for (const id of ['chartjs', 'echarts']) {
		it(`${id}: assigns CPU/RAM left and TCP right with automatic y ranges`, () => {
			let config;
			const {exports, wait} = evaluate(files, id, {
				Chart: function(ctx, options) { config = options; },
				echarts: {init: () => ({setOption(options) { config = options; }})},
			});
			exports.makeChart(exports.prepData(packed), {querySelector: () => ({getContext: () => ({})})}, wait);
			let axes;
			if (id === 'chartjs') {
				assert.deepEqual(Object.keys(config.options.scales), ['x', 'y', 'y2']);
				assert.deepEqual(Array.from(config.data.datasets, s => [s.label, s.yAxisID]),
					[['CPU', 'y'], ['RAM', 'y'], ['TCP Out', 'y2']]);
				axes = [config.options.scales.y, config.options.scales.y2];
			}
			else {
				assert.deepEqual(Array.from(config.series, s => [s.name, s.yAxisIndex]),
					[['CPU', 0], ['RAM', 0], ['TCP Out', 1]]);
				axes = Array.from(config.yAxis);
			}
			assert.deepEqual(axes.map(axis => axis.position), ['left', 'right']);
			for (const axis of axes) {
				for (const key of ['min', 'max', 'suggestedMin', 'suggestedMax', 'beginAtZero', 'grace', 'boundaryGap'])
					assert.equal(Object.hasOwn(axis, key), false, `${id}: leave ${key} to native autoranging`);
			}
		});
	}

	it('Flot returns the plot before its deferred overlay hook, without changing options', () => {
		let options, destroyed = false;
		const plot = {destroy() { destroyed = true; }};
		const data = [[], [], []];
		const placeholder = {}, wrapped = {};
		const host = {querySelector(selector) { assert.equal(selector, '#placeholder'); return placeholder; }};
		const $ = element => { assert.equal(element, placeholder); return wrapped; };
		$.plot = (element, input, config) => {
			assert.equal(element, wrapped);
			assert.equal(input, data);
			options = config;
			return plot;
		};
		const {exports, wait} = evaluate(files, 'flot', {$});
		assert.equal(exports.makeChart(data, host, wait), plot);
		assert.equal(wait.textContent, 'not started');
		assert.deepEqual(Object.keys(options), ['xaxis', 'hooks']);
		assert.deepEqual(JSON.parse(JSON.stringify(options.xaxis)), {mode: 'time', timeBase: 'milliseconds'});
		assert.equal(options.hooks.drawOverlay.length, 1);
		options.hooks.drawOverlay[0]();
		assert.equal(wait.textContent, 'Done!');
		assert.equal(destroyed, false);
		plot.destroy();
		assert.equal(destroyed, true);
	});

	it('Dygraphs returns its instance for destroy and uses the local formatter without changing options', () => {
		const formatter = {};
		runInNewContext(files.get('/bench/fmtDate.js'), {window: formatter});
		assert.equal(typeof formatter.fmtDate, 'function');
		const dom = {}, wait = {};
		let options, destroyed = false;
		const instance = {destroy() { destroyed = true; }};
		const {exports} = evaluate(files, 'dygraphs', {
			fmtDate: formatter.fmtDate,

			Dygraph: function(element, data, config) {
				assert.equal(element, dom);
				assert.equal(data, prepared);
				options = config;
				return instance;
			},
		});
		const prepared = exports.prepData(packed);
		assert.equal(Object.prototype.toString.call(prepared[0][0]), '[object Date]');
		assert.equal(+prepared[0][0], 600000);
		assert.equal(exports.makeChart(prepared, dom, wait), instance);
		assert.equal(wait.textContent, 'Done!');
		assert.deepEqual(Object.keys(options), ['width', 'height', 'labels', 'colors', 'axes']);
		assert.equal(options.width, 1920);
		assert.equal(options.height, 600);
		assert.deepEqual(Array.from(options.labels), ['Time', 'CPU', 'RAM', 'TCP Out']);
		assert.deepEqual(Array.from(options.colors), ['rgba(255,0,0,1)', 'rgba(0,0,255,1)', '#297f00']);
		const date = new Date(2026, 9, 22, 13, 5);
		assert.equal(options.axes.x.axisLabelFormatter(date), '10/22/26\n1:05pm');
		assert.equal(options.axes.x.valueFormatter(+date), '10/22/26\n1:05pm');
		assert.equal(options.axes.y.axisLabelFormatter(25), '25%');
		assert.equal(options.axes.y.valueFormatter(25.125), '25.13%');
		assert.equal(options.axes.y2.valueFormatter(6), '6 MB');
		assert.equal(options.axes.y2.independentTicks, true);
		assert.equal(destroyed, false);
		instance.destroy();
		assert.equal(destroyed, true);
	});

	it('passes fractional and high DPRs explicitly to ECharts instead of its minimum-one default', () => {
		for (const dpr of [0.75, 1, 1.5, 2]) {
			let effectiveDpr;
			const {exports, wait} = evaluate(files, 'echarts', {
				devicePixelRatio: dpr,
				echarts: {init(dom, theme, options) {
					effectiveDpr = options.devicePixelRatio;
					return {setOption() {}};
				}},
			});
			exports.makeChart([], {}, wait);
			assert.equal(effectiveDpr, dpr);
		}
	});

	it('uPlot retains seconds, native ranges, options, instance return, and microtask completion', async () => {
		for (const dpr of [0.75, 1, 1.5, 2]) {
			let options, destroyed = false;
			const host = {};
			const instance = {destroy() { destroyed = true; }};
			const {exports, sandbox, wait} = evaluate(files, 'uplot', {
				devicePixelRatio: 3,
				uPlot: function(config, data, target) {
					assert.equal(target, host);
					assert.equal(data, prepared);
					options = config;
					return instance;
				},
			});
			sandbox.devicePixelRatio = dpr;
			const original = [...packed];
			const prepared = exports.prepData(packed);
			assert.deepEqual(packed, original);
			assert.deepEqual(Array.from(prepared[0]), [600, 660]);
			assert.equal(exports.makeChart(prepared, host, wait), instance);
			assert.equal(wait.textContent, 'not started');
			assert.deepEqual(Object.keys(options), ['title', 'width', 'height', 'cache', 'series', 'axes']);
			assert.equal(options.title, 'Server Events');
			assert.equal(options.width, 1920);
			assert.equal(options.height, 600);
			assert.deepEqual(JSON.parse(JSON.stringify(options.cache)), {paths: false});
			assert.deepEqual(Array.from(options.series.slice(1), s => [s.label, s.scale, s.stroke, s.width]),
				[['CPU', '%', 'red', 1 / dpr], ['RAM', '%', 'blue', 1 / dpr], ['TCP Out', 'mb', 'green', 1 / dpr]]);
			for (const series of options.series.slice(1)) {
				assert.equal(series.value(null, null), null);
				assert.equal(series.value(null, 12.345), series.scale === '%' ? '12.3%' : '12.35 MB');
			}
			assert.deepEqual(Array.from(options.axes, axis => axis.scale), [undefined, '%', 'mb']);
			assert.equal(options.axes[2].side, 1);
			assert.equal(options.axes[2].size, 60);
			assert.equal(options.axes[2].grid.show, false);
			assert.deepEqual(options.axes[1].values(null, [12.345]), ['12.3%']);
			assert.deepEqual(options.axes[2].values(null, [12.345]), ['12.35 MB']);
			assert.equal(Object.hasOwn(options, 'scales'), false, 'keep native autoranges');
			assert.equal(destroyed, false);
			await Promise.resolve();
			assert.equal(wait.textContent, 'Done!');
			instance.destroy();
			assert.equal(destroyed, true);
		}
	});
});
