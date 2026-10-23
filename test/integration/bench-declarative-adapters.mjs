import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as agcharts from '../../bench/agcharts.mjs';
import * as vega from '../../bench/vega.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const adapters = {agcharts, vega};

function frozenData(adapter) {
	return Object.freeze(adapter.prepData(packed).map(Object.freeze));
}

function fixture(id) {
	let cleared = 0;
	return {
		host: Object.freeze({
			id: `benchmark-${id}`,
			style: Object.freeze({width: '1920px', height: '600px'}),
			replaceChildren() { cleared++; },
		}),
		get cleared() { return cleared; },
	};
}

function vendor(id, ready, failure) {
	const state = {destroyed: 0};
	if (id === 'agcharts') {
		state.chart = {
			waitForUpdate() { if (failure === 'setup') throw state.error; return ready; },
			destroy() { state.destroyed++; if (state.cleanupError) throw state.cleanupError; },
		};
		globalThis.agCharts = {AgCharts: {create(options) {
			state.options = options;
			return state.chart;
		}}};
	}
	else {
		globalThis.vega = {
			Warn: 2,
			logger(level) { assert.equal(level, 2); return state.logger = {}; },
			parse(spec) {
				state.spec = spec;
				return state.runtime = {};
			},
			View: class {
				constructor(runtime, options) {
					assert.equal(runtime, state.runtime);
					state.options = options;
					state.chart = this;
				}
				initialize(host) {
					state.host = host;
					if (failure === 'setup') throw state.error;
					return this;
				}
				async runAsync() {
					if (failure === 'logged') state.options.logger.error(state.error);
					return ready;
				}
				container() { return state.host; }
				finalize() { state.destroyed++; if (state.cleanupError) throw state.cleanupError; }
			},
		};
	}
	return state;
}

function autoDomain(axis) {
	for (const key of ['min', 'max', 'domainMin', 'domainMax', 'domainRaw'])
		assert.equal(axis[key], undefined);
}

describe('declarative benchmark adapters', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['agCharts', 'vega', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: preserves all 55,550 rows and three series without source mutation`, () => {
			assert.deepEqual(Object.keys(adapter), ['destroyChart', 'makeChart', 'prepData']);
			const data = adapter.prepData(packed);
			const again = adapter.prepData(packed);
			assert.equal(data.length, 55550);
			assert.notEqual(data, again);
			for (let j = 0, i = packed[0] + 1; j < data.length; j++, i += packed[0]) {
				assert.deepEqual(data[j], {
					time: packed[i] * 60000,
					cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
					ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
					tcp: packed[i + 3],
				});
				assert.notEqual(data[j], again[j]);
			}
		});

		it(`${id}: preserves irregular timestamps and rounding`, () => {
			const input = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
				10, 75, 2, 3, 4, 25, 75,
				17, 50, 2, 6, 4, 50, 50,
				31, 87.6543, 2, 9, 4, 1, 2]);
			assert.deepEqual(adapter.prepData(input), [
				{time: 600000, cpu: 25, ram: 25, tcp: 3},
				{time: 1020000, cpu: 50, ram: 50, tcp: 6},
				{time: 1860000, cpu: 12.346, ram: 33.33, tcp: 9},
			]);
		});

		it(`${id}: waits for vendor rendering and cleans up without changing fixture dimensions`, async () => {
			const {promise, resolve} = Promise.withResolvers();
			const state = vendor(id, promise);
			const target = fixture(id);
			const wait = {textContent: 'Rendering...'};
			const data = frozenData(adapter);
			let finished = false;
			const pending = adapter.makeChart(data, target.host, wait).then(chart => { finished = true; return chart; });
			await Promise.resolve();
			assert.equal(finished, false);
			assert.equal(wait.textContent, 'Rendering...');
			resolve();
			assert.equal(await pending, state.chart);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(state.destroyed, 0);
			adapter.destroyChart(state.chart);
			assert.equal(state.destroyed, 1);
			assert.equal(target.cleared, id === 'vega' ? 1 : 0);
		});

		for (const failure of ['setup', 'async']) {
			it(`${id}: cleans up ${failure} failures and preserves the original error`, async () => {
				const {promise, reject} = Promise.withResolvers();
				const state = vendor(id, promise, failure);
				state.error = new Error('draw failed');
				state.cleanupError = new Error('cleanup failed');
				const target = fixture(id);
				const wait = {textContent: 'Rendering...'};
				const pending = adapter.makeChart([], target.host, wait);
				if (failure === 'async') reject(state.error);
				await assert.rejects(pending, error => error === state.error);
				assert.equal(state.destroyed, 1);
				assert.equal(wait.textContent, 'Rendering...');
				assert.equal(target.cleared, id === 'vega' ? 1 : 0);
			});
		}
	}

	it('AG Charts: uses native aggregation defaults, calendar time, and named dual axes', async () => {
		const state = vendor('agcharts', Promise.resolve());
		const data = frozenData(agcharts);
		const target = fixture('agcharts');
		await agcharts.makeChart(data, target.host);
		const options = state.options;
		assert.equal(options.container, target.host);
		assert.equal(options.data, data);
		assert.equal(options.width, 1920);
		assert.equal(options.height, 600);
		assert.equal(options.axes.x.type, 'time');
		assert.equal(options.axes.x.position, 'bottom');
		assert.equal(options.axes.percent.position, 'left');
		assert.equal(options.axes.tcp.position, 'right');
		assert.equal(options.axes.percent.label.formatter({value: 42}), '42%');
		assert.equal(options.axes.tcp.label.formatter({value: 7}), '7 MB');
		Object.values(options.axes).forEach(autoDomain);
		assert.deepEqual(options.series.map(s => s.yKeyAxis), ['percent', 'percent', 'tcp']);
		assert.deepEqual(options.series.map(s => s.yKey), ['cpu', 'ram', 'tcp']);
		assert.deepEqual(options.series.map(s => s.yName), ['CPU', 'RAM', 'TCP Out']);
		assert.deepEqual(options.series.map(s => s.stroke), ['red', 'blue', 'green']);
		for (const series of options.series) {
			assert.equal(series.xKey, 'time');
			assert.equal(series.xKeyAxis, 'x');
			assert.equal(series.type, 'line');
			assert.equal(series.marker.enabled, false);
			assert.equal(series.label.enabled, false);
			assert.equal(series.strokeWidth, 0.5);
		}
	});

	it('Vega: keeps the complete wide dataset, domains, parsing, and Canvas dataflow in makeChart', async () => {
		const state = vendor('vega', Promise.resolve());
		const data = frozenData(vega);
		await vega.makeChart(data, fixture('vega').host);
		assert.deepEqual(state.options, {renderer: 'canvas', logger: state.logger});
		const spec = state.spec;
		assert.equal(spec.width, 1920);
		assert.equal(spec.height, 600);
		assert.deepEqual(spec.autosize, {type: 'fit', contains: 'padding'});
		assert.equal(spec.data.length, 1);
		assert.equal(spec.data[0].transform, undefined);
		assert.deepEqual(spec.data[0].values, data);
		assert.notEqual(spec.data[0].values, data);
		for (let i = 0; i < data.length; i++) assert.notEqual(spec.data[0].values[i], data[i]);
		// Simulate Vega's tuple ingestion without altering any prepared record.
		spec.data[0].values[0][Symbol('vega_id')] = 1;
		assert.equal(Reflect.ownKeys(data[0]).length, 4);
		assert.equal(spec.scales[0].type, 'time');
		assert.deepEqual(spec.scales[0].domain, {data: 'table', field: 'time'});
		assert.deepEqual(spec.scales[1].domain, {data: 'table', fields: ['cpu', 'ram']});
		assert.deepEqual(spec.scales[2].domain, {data: 'table', field: 'tcp'});
		spec.scales.forEach(autoDomain);
		assert.deepEqual(spec.axes.map(a => [a.scale, a.orient]), [['x', 'bottom'], ['percent', 'left'], ['tcp', 'right']]);
		assert.deepEqual(spec.marks.map(m => m.encode.update.y), [
			{scale: 'percent', field: 'cpu'}, {scale: 'percent', field: 'ram'}, {scale: 'tcp', field: 'tcp'},
		]);
		for (const mark of spec.marks) {
			assert.equal(mark.type, 'line');
			assert.deepEqual(mark.from, {data: 'table'});
			assert.deepEqual(mark.encode.update.x, {scale: 'x', field: 'time'});
			assert.equal(mark.encode.update.strokeWidth.value, 0.5);
		}
	});

	it('Vega: rejects logged dataflow errors instead of reporting a successful draw', async () => {
		for (const error of [new Error('dataflow failed'), 'dataflow failed']) {
			const state = vendor('vega', Promise.resolve(), 'logged');
			state.error = error;
			const target = fixture('vega');
			const wait = {textContent: 'Rendering...'};
			await assert.rejects(vega.makeChart([], target.host, wait), actual =>
				error instanceof Error ? actual === error : actual.message === error);
			assert.equal(wait.textContent, 'Rendering...');
			assert.equal(state.destroyed, 1);
			assert.equal(target.cleared, 1);
		}
	});

	it('HTML entry points use only the shared runner', () => {
		for (const [id, file] of [['agcharts', 'AGCharts.html'], ['vega', 'Vega.html']]) {
			const html = readFileSync(new URL('../../bench/' + file, import.meta.url), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.equal(scripts[0][2].trim(), `import {runDemo} from './demo.mjs';\n\t\t\trunDemo('${id}').catch(console.error);`);
			assert.doesNotMatch(html, /<style\b|<link\b|<canvas\b|fetch\(|https?:|style=/);
		}
	});
});
