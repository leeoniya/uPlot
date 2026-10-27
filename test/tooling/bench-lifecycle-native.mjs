import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as flot from '../../bench/flot.mjs';
import * as dygraphs from '../../bench/dygraphs.mjs';
import * as canvasjs from '../../bench/canvasjs.mjs';
import * as lightweight from '../../bench/lightweight.mjs';
import * as zingchart from '../../bench/zingchart.mjs';
import * as kendo from '../../bench/kendo.mjs';
import * as lightningchart from '../../bench/lightningchart.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const adapters = {flot, dygraphs, canvasjs, lightweight, zingchart, kendo, lightningchart};
const globals = ['$', 'Dygraph', 'fmtDate', 'CanvasJS', 'LightweightCharts', 'zingchart', 'kendo', 'devicePixelRatio', 'requestAnimationFrame'];

function events() {
	const handlers = new Map();
	return {
		bind(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
		unbind(type, callback) { const list = handlers.get(type); list.splice(list.indexOf(callback), 1); },
		emit(type, event) { for (const callback of handlers.get(type) ?? []) callback(event); },
		count(type) { return handlers.get(type)?.length ?? 0; },
	};
}

async function pending(promise, wait) {
	let done = false;
	promise.then(() => { done = true; });
	await Promise.resolve();
	assert.equal(done, false);
	assert.equal(wait.textContent, 'waiting');
}

describe('bench-lifecycle-native contracts', () => {
	let saved;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 1});
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
		else delete globalThis[key];
	}));

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: adds lifecycle exports without removing the direct entry point`, () => {
			for (const name of ['prepData', 'makeChart', 'makeEmptyChart', 'updateChart']) assert.equal(typeof adapter[name], 'function');
			const first = adapter.prepData(packed), second = adapter.prepData(packed);
			assert.notEqual(first, second);
			assert.deepEqual(first, second);
		});
	}

	it('Flot: waits for overlays, replaces all data, retains labels/axes, and removes its hook', async () => {
		const log = [];
		let created = 0;
		const chart = {hooks: {drawOverlay: []}, getData() { return this.data; },
			setData(data) { log.push('data'); this.data = data; },
			setupGrid() { log.push('grid'); }, draw() { log.push('draw'); }, triggerRedrawOverlay() { log.push('overlay'); }};
		globalThis.$ = Object.assign(value => value, {plot(host, data, options) {
			created++;
			chart.data = data;
			assert.equal(options.yaxes.length, 2);
			assert.deepEqual(options.hooks.drawOverlay, []);
			return chart;
		}});
		const wait = {textContent: 'waiting'};
		const initial = flot.makeEmptyChart({querySelector() { return {}; }}, wait);
		assert.ok(chart.data.every(s => s.data.length === 0));
		await pending(initial, wait);
		chart.hooks.drawOverlay.forEach(fn => fn(chart));
		assert.equal(await initial, chart);
		assert.equal(chart.hooks.drawOverlay.length, 0);
		for (let pass = 0; pass < 2; pass++) {
			const input = flot.prepData(packed);
			wait.textContent = 'waiting'; log.length = 0;
			const update = flot.updateChart(chart, input, {}, wait);
			await pending(update, wait);
			assert.deepEqual(log, ['data', 'grid', 'draw', 'overlay']);
			chart.hooks.drawOverlay.forEach(fn => fn(chart));
			assert.equal(await update, chart);
			assert.deepEqual(chart.data.map(s => [s.label, s.yaxis]), [['CPU', 1], ['RAM', 1], ['TCP Out', 2]]);
			chart.data.forEach((s, i) => assert.equal(s.data, input[i]));
			assert.equal(chart.hooks.drawOverlay.length, 0);
		}
		assert.equal(created, 1);
		chart.draw = () => { throw new Error('draw failed'); };
		await assert.rejects(flot.updateChart(chart, flot.prepData(packed)), /draw failed/);
		assert.equal(chart.hooks.drawOverlay.length, 0);
	});

	it('Dygraphs: blank CSV has no dummy point; updates use the original row arrays', () => {
		let created = 0;
		globalThis.fmtDate = () => () => '';
		globalThis.Dygraph = class {
			constructor(host, data, options) { created++; this.data = data; this.options = options; }
			updateOptions(options) { this.data = options.file; }
		};
		const chart = dygraphs.makeEmptyChart({});
		assert.equal(chart.data, '\n');
		assert.equal(chart.options.labels.length, 4);
		assert.equal(chart.options.series['TCP Out'].axis, 'y2');
		for (let pass = 0; pass < 2; pass++) {
			const input = dygraphs.prepData(packed);
			assert.equal(dygraphs.updateChart(chart, input), chart);
			assert.equal(chart.data, input);
		}
		assert.equal(created, 1);
	});

	it('CanvasJS: retains series and chart, replaces dataPoints, and renders before readiness', () => {
		let created = 0, renders = 0;
		globalThis.CanvasJS = {Chart: class {
			constructor(host, options) { created++; this.options = options; }
			render() { renders++; }
			destroy() { this.destroyed = true; }
		}};
		const chart = canvasjs.makeEmptyChart({});
		const series = chart.options.data.slice();
		assert.ok(series.every(s => s.dataPoints.length === 0));
		for (let pass = 0; pass < 2; pass++) {
			const input = canvasjs.prepData(packed), wait = {textContent: 'waiting'};
			assert.equal(canvasjs.updateChart(chart, input, {}, wait), chart);
			series.forEach((s, i) => { assert.equal(chart.options.data[i], s); assert.equal(s.dataPoints, input[i]); });
			assert.equal(wait.textContent, 'Done!');
		}
		assert.equal(renders, 3); assert.equal(created, 1);
		canvasjs.destroyChart(chart); assert.equal(chart.destroyed, true);
	});

	it('Lightweight: retains native series, waits for the queued frame, updates legend closures, and cleans up', async () => {
		const frames = [], lines = [], children = [];
		let created = 0, crosshair, fits = 0;
		const node = () => ({style: {}, children: [], append(child) { this.children.push(child); }, setAttribute() {}, remove() { this.removed = true; }});
		const host = {style: {position: 'static'}, ownerDocument: {createElement: node}, append(child) { children.push(child); }};
		const chart = {
			addSeries(type, options) { const line = {options, setData(data) { this.data = data; }}; lines.push(line); return line; },
			timeScale() { return {fitContent() { fits++; }}; },
			subscribeCrosshairMove(fn) { crosshair = fn; }, unsubscribeCrosshairMove(fn) { assert.equal(fn, crosshair); crosshair = null; },
			remove() { this.removed = true; },
		};
		globalThis.LightweightCharts = {createChart() { created++; return chart; }, LineSeries: {}, LastPriceAnimationMode: {Disabled: 0}};
		globalThis.requestAnimationFrame = fn => frames.push(fn);
		const wait = {textContent: 'waiting'}, initial = lightweight.makeEmptyChart(host, wait);
		await pending(initial, wait);
		assert.equal(lines.length, 3); assert.ok(lines.every(line => line.data.length === 0));
		frames.shift()(); assert.equal(await initial, chart);
		for (let pass = 0; pass < 2; pass++) {
			const input = lightweight.prepData(packed);
			wait.textContent = 'waiting';
			const update = lightweight.updateChart(chart, input, host, wait);
			await pending(update, wait);
			lines.forEach((line, i) => assert.equal(line.data, input[i]));
			crosshair({time: null});
			assert.equal(children[0].children[0].textContent, `CPU: ${Number(input[0].at(-1).value.toFixed(2))} %`);
			frames.shift()(); assert.equal(await update, chart);
		}
		assert.equal(fits, 3); assert.equal(created, 1); assert.equal(lines.length, 3);
		lightweight.destroyChart(chart);
		assert.equal(crosshair, null); assert.equal(chart.removed, true); assert.equal(children[0].removed, true);
		assert.equal(host.style.position, 'static');
	});

	for (const id of ['zingchart', 'kendo']) {
		it(`${id}: waits for native completion, keeps the handle, and cleans listeners after dispatch/failure`, async () => {
			const adapter = adapters[id], emitter = events(), host = {id: 'benchmark-' + id};
			const event = id === 'kendo' ? 'render' : 'complete';
			let created = 0, destroyed = 0, options, values, fail = false;
			const chart = id === 'zingchart' ? host : {...emitter,
				element: {empty() {}}, destroy() { destroyed++; },
				redraw() { if (fail) throw new Error('native update failed'); },
			};
			if (id === 'zingchart') globalThis.zingchart = {
				bind(id, type, fn) { emitter.bind(type, fn); }, unbind(id, type, fn) { emitter.unbind(type, fn); },
				render(config) { created++; options = config.data; },
				exec(id, command, args) {
					if (command === 'destroy') { destroyed++; return; }
					assert.equal(command, 'setseriesvalues');
					if (fail) throw new Error('native update failed');
					values = args.values;
				},
			};
			else globalThis.kendo = {dataviz: {ui: {Chart: class {
				constructor(host, config) { created++; options = chart.options = config; return chart; }
			}}}};
			const wait = {textContent: 'waiting'};
			const initial = adapter.makeEmptyChart(host, wait);
			await pending(initial, wait);
			assert.ok(options.series.every(s => (s.values ?? s.data).length === 0));
			if (id === 'kendo') options.render({sender: chart}); else emitter.emit(event);
			assert.equal(await initial, chart);
			for (let pass = 0; pass < 2; pass++) {
				const input = adapter.prepData(packed);
				wait.textContent = 'waiting';
				const update = adapter.updateChart(chart, input, host, wait);
				await pending(update, wait);
				assert.equal(emitter.count(event), 1);
				emitter.emit(event);
				assert.equal(emitter.count(event), 1, 'must not splice a live dispatch array');
				assert.equal(await update, chart);
				assert.equal(emitter.count(event), 0);
				if (id === 'zingchart') assert.equal(values, input);
				else options.series.forEach((s, i) => assert.equal(s.data, input[i]));
			}
			fail = true;
			wait.textContent = 'waiting';
			await assert.rejects(adapter.updateChart(chart, adapter.prepData(packed), host, wait), /native update failed/);
			assert.equal(emitter.count(event), 0); assert.equal(emitter.count('error'), 0);
			assert.equal(wait.textContent, 'waiting');
			assert.equal(created, 1); assert.equal(destroyed, 0);
			if (id === 'zingchart') {
				fail = false;
				const update = adapter.updateChart(chart, adapter.prepData(packed), host, wait);
				emitter.emit('error', {error: new Error('vendor error')});
				await assert.rejects(update, /vendor error/);
				assert.equal(emitter.count(event), 0); assert.equal(emitter.count('error'), 0);
			}
			adapter.destroyChart(chart); assert.equal(destroyed, 1);
		});
	}
});
