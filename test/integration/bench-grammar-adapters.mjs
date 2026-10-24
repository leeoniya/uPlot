import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as billboard from '../../bench/billboard.mjs';
import * as g2 from '../../bench/g2.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const adapters = {billboard, g2};

function frozenData(adapter) {
	return Object.freeze(adapter.prepData(packed).map(Object.freeze));
}

function fixture() {
	return Object.freeze({style: Object.freeze({width: '1920px', height: '600px'})});
}

function vendor(id, ready = Promise.resolve(), failure) {
	const state = {destroyed: 0, error: new Error('draw failed')};
	if (id === 'billboard') {
		state.chart = {destroy() {
			state.destroyed++;
			if (state.cleanupError) throw state.cleanupError;
		}};
		globalThis.bb = {generate(options) {
			state.options = options;
			if (failure === 'constructor') throw state.error;
			options.onbeforeinit.call(state.chart);
			if (failure === 'setup') throw state.error;
			if (failure === 'after-render') {
				options.onrendered.call(state.chart);
				throw state.error;
			}
			if (failure === 'sync') options.onrendered.call(state.chart);
			else ready.then(() => options.onrendered.call(state.chart));
			return state.chart;
		}};
	}
	else {
		globalThis.G2 = {Chart: class {
			constructor(options) {
				state.constructorOptions = options;
				if (failure === 'constructor') throw state.error;
				state.chart = this;
			}
			options(options) {
				state.options = options;
				if (failure === 'setup') throw state.error;
			}
			render() {
				if (failure === 'render') throw state.error;
				return ready;
			}
			destroy() {
				state.destroyed++;
				if (state.cleanupError) throw state.cleanupError;
			}
		}};
	}
	return state;
}

function autoDomain(axis) {
	for (const key of ['min', 'max', 'domain', 'domainMin', 'domainMax'])
		assert.equal(axis[key], undefined);
}

function expectedRows(input) {
	const rows = [];
	for (let i = input[0] + 1; i < input.length; i += input[0]) rows.push({
		time: input[i] * 60000,
		cpu: Math.round((100 - input[i + 1]) * 1000) / 1000,
		ram: Math.round(100 * input[i + 5] / (input[i + 5] + input[i + 6]) * 100) / 100,
		tcp: input[i + 3],
	});
	return rows;
}

function rowsOf(id, data) {
	return id === 'g2' ? data : data[0].slice(1).map((time, i) => ({
		time, cpu: data[1][i + 1], ram: data[2][i + 1], tcp: data[3][i + 1],
	}));
}

describe('grammar benchmark adapters', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['bb', 'G2', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	for (const [id, adapter] of Object.entries(adapters)) {
		it(`${id}: preserves every value in all 55,550 rows and three series`, () => {
			assert.deepEqual(Object.keys(adapter), id === 'g2'
								? ['destroyChart', 'makeChart', 'makeChartWithOptions', 'prepData']
								: ['destroyChart', 'makeChart', 'prepData']);
			const data = adapter.prepData(packed);
			const again = adapter.prepData(packed);
			assert.equal(rowsOf(id, data).length, 55550);
			assert.deepEqual(rowsOf(id, data), expectedRows(packed));
			assert.deepEqual(again, data);
			assert.notEqual(again, data);
			for (let i = 0; i < data.length; i++) assert.notEqual(again[i], data[i]);
			if (id === 'billboard') {
				assert.deepEqual(data.map(column => column[0]), ['time', 'cpu', 'ram', 'tcp']);
				assert.deepEqual(data.map(column => column.length), [55551, 55551, 55551, 55551]);
			}
		});

		it(`${id}: preserves irregular timestamps, zeros, and rounding`, () => {
			const input = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
				10, 100, 2, 0, 4, 0, 75,
				17, 50, 2, 6, 4, 50, 50,
				31, 87.6543, 2, 9, 4, 1, 2]);
			assert.deepEqual(rowsOf(id, adapter.prepData(input)), [
				{time: 600000, cpu: 0, ram: 0, tcp: 0},
				{time: 1020000, cpu: 50, ram: 50, tcp: 6},
				{time: 1860000, cpu: 12.346, ram: 33.33, tcp: 9},
			]);
			assert.deepEqual(rowsOf(id, adapter.prepData(input.slice(0, 8))), []);
		});

		it(`${id}: waits for vendor completion and destroys only its chart`, async () => {
			const {promise, resolve} = Promise.withResolvers();
			const state = vendor(id, promise);
			const wait = {textContent: 'Rendering...'};
			const data = frozenData(adapter);
			let finished = false;
			const pending = adapter.makeChart(data, fixture(), wait).then(chart => { finished = true; return chart; });
			await Promise.resolve();
			assert.equal(finished, false);
			assert.equal(wait.textContent, 'Rendering...');
			resolve();
			assert.equal(await pending, state.chart);
			assert.equal(wait.textContent, 'Done!');
			assert.equal(state.destroyed, 0);
			adapter.destroyChart(state.chart);
			assert.equal(state.destroyed, 1);
		});

		it(`${id}: reuses frozen prepared data across fresh chart instances without a wait element`, async () => {
			const data = frozenData(adapter);
			const target = fixture();
			const charts = [];
			for (let i = 0; i < 2; i++) {
				const state = vendor(id);
				charts.push(await adapter.makeChart(data, target));
				assert.equal(id === 'billboard' ? state.options.data.columns : state.options.data, data);
				adapter.destroyChart(charts[i]);
				assert.equal(state.destroyed, 1);
			}
			assert.notEqual(charts[0], charts[1]);
			assert.deepEqual(rowsOf(id, data), expectedRows(packed));
		});

		for (const failure of ['constructor', 'setup', ...(id === 'billboard' ? ['after-render'] : ['render', 'async'])]) {
			it(`${id}: preserves ${failure} errors even when cleanup throws`, async () => {
				const {promise, reject} = Promise.withResolvers();
				const state = vendor(id, promise, failure);
				state.cleanupError = new Error('cleanup failed');
				const wait = {textContent: 'Rendering...'};
				const pending = adapter.makeChart([], fixture(), wait);
				if (failure === 'async') reject(state.error);
				await assert.rejects(pending, error => error === state.error);
				assert.equal(state.destroyed, failure === 'constructor' ? 0 : 1);
				assert.equal(wait.textContent, 'Rendering...');
			});
		}
	}

	it('Billboard: handles synchronous onrendered before generate returns', async () => {
		const state = vendor('billboard', undefined, 'sync');
		assert.equal(await billboard.makeChart(frozenData(billboard), fixture()), state.chart);
	});

	it('Billboard: uses main-thread Canvas, continuous calendar time, and native dual axes', async () => {
		const state = vendor('billboard');
		const host = fixture();
		const data = frozenData(billboard);
		await billboard.makeChart(data, host);
		const o = state.options;
		assert.equal(o.bindto, host);
		assert.deepEqual(o.size, {width: 1920, height: 600});
		assert.deepEqual(o.render, {mode: 'canvas', lazy: false, observe: false});
		assert.deepEqual(o.boost, {useWorker: false});
		assert.equal(o.resize.auto, false);
		assert.equal(o.transition.duration, 0);
		assert.equal(o.data.columns, data);
		assert.equal(o.data.type, 'line');
		assert.equal(o.data.x, 'time');
		assert.equal(o.data.xSort, false);
		assert.equal(o.data.order, null);
		assert.equal(o.data.labels, false);
		assert.equal(o.data.filter, undefined);
		assert.deepEqual(o.data.axes, {cpu: 'y', ram: 'y', tcp: 'y2'});
		assert.deepEqual(o.data.names, {cpu: 'CPU', ram: 'RAM', tcp: 'TCP Out'});
		assert.deepEqual(o.data.colors, {cpu: 'red', ram: 'blue', tcp: 'green'});
		assert.equal(o.axis.x.type, 'timeseries');
		assert.equal(o.axis.x.tick.fit, false);
		assert.equal(o.axis.y2.show, true);
		assert.equal(o.axis.y.tick.format(42), '42%');
		assert.equal(o.axis.y2.tick.format(7), '7 MB');
		Object.values(o.axis).forEach(autoDomain);
		assert.equal(o.point.show, false);
		assert.equal(o.canvas.theme.selectors['.bb-line']['stroke-width'], 0.5);
		assert.deepEqual(o.legend, {show: true, position: 'bottom'});
	});

	it('G2: uses a shared full dataset, automatic named scales, and only three Canvas line marks', async () => {
		const state = vendor('g2');
		const host = fixture();
		const data = frozenData(g2);
		await g2.makeChart(data, host);
		assert.deepEqual(state.constructorOptions, {container: host, width: 1920, height: 600, autoFit: false});
		const o = state.options;
		assert.equal(o.data, data);
		assert.equal(o.type, 'view');
		assert.equal(o.animate, false);
		assert.equal(o.transform, undefined);
		assert.deepEqual(o.scale.x, {type: 'time', nice: false});
		autoDomain(o.scale.x);
		assert.deepEqual(o.scale.color, {type: 'ordinal', domain: ['CPU', 'RAM', 'TCP Out'], range: ['red', 'blue', 'green']});
		assert.deepEqual(o.legend, {color: {position: 'bottom'}});
		assert.deepEqual(o.children.map(s => s.encode.y), ['cpu', 'ram', 'tcp']);
		assert.deepEqual(o.children.map(s => s.encode.color), ['CPU', 'RAM', 'TCP Out'].map(value => ({type: 'constant', value})));
		assert.deepEqual(o.children.map(s => s.scale.y.key), ['percent', 'percent', 'tcp']);
		assert.deepEqual(o.children.map(s => s.axis.y.position), ['left', 'left', 'right']);
		assert.deepEqual(o.children.map(s => s.axis.y.labelFormatter(7)), ['7%', '7%', '7 MB']);
		for (const mark of o.children) {
			assert.equal(mark.type, 'line');
			assert.equal(mark.encode.x, 'time');
			assert.equal(mark.scale.y.type, 'linear');
			assert.equal(mark.scale.y.zero, false);
			assert.equal(mark.animate, false);
			assert.equal(mark.style.lineWidth, 0.5);
			assert.equal(mark.style.fill, 'none');
			assert.equal(mark.data, undefined);
			assert.equal(mark.transform, undefined);
			assert.equal(mark.labels, undefined);
			autoDomain(mark.scale.y);
		}
	});

	it('HTML entry points use only the shared runner', () => {
		for (const [id, file] of [['billboard', 'Billboard.html'], ['g2', 'G2.html']]) {
			const html = readFileSync(new URL('../../bench/' + file, import.meta.url), 'utf8');
			const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1);
			assert.match(scripts[0][1], /^\s+type="module"\s*$/);
			assert.equal(scripts[0][2].trim(), `import {runDemo} from './demo.mjs';\n\t\t\trunDemo('${id}').catch(console.error);`);
			assert.doesNotMatch(html, /<style\b|<link\b|<canvas\b|fetch\(|https?:|style=/);
		}
	});
});
