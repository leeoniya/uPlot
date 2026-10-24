import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as canvas from '../../bench/g2.mjs';
import * as webgl from '../../bench/g2-webgl.mjs';

const packed = Object.freeze(JSON.parse(readFileSync(new URL('../../bench/data.json', import.meta.url))));
const data = Object.freeze(webgl.prepData(packed).map(Object.freeze));

function vendor({ready = Promise.resolve(), failure, cleanupError} = {}) {
	const state = {destroyed: 0, renderers: [], charts: [], error: new Error('vendor failure')};
	class InstancedPathDrawcall {}
	class InstancedLineDrawcall {}
	state.gl = {isContextLost: () => false};
	state.elements = Array.from({length: 3}, () => ({
		nodeName: 'path', renderable3D: {drawcalls: [new InstancedPathDrawcall()]},
	}));
	globalThis.G = {WebGL: {
		DeviceRenderer: {InstancedPathDrawcall, InstancedLineDrawcall},
		Renderer: class {
			constructor(...args) {
				if (failure === 'renderer') throw state.error;
				state.rendererArgs = args;
				state.renderers.push(this);
			}
			getPlugin(name) {
				assert.equal(name, 'device-renderer');
				return {getDevice: () => ({gl: state.gl})};
			}
		},
	}};
	globalThis.G2 = {Chart: class {
		constructor(options) {
			state.constructorOptions = options;
			if (failure === 'constructor') throw state.error;
			state.charts.push(this);
			this.listeners = new Map();
			state.surface = {
				getConfig: () => ({renderer: options.renderer}),
				getContextService: () => ({getContext: () => state.gl}),
				document: {getElementsByClassName(name) {
					assert.equal(name, 'element');
					return state.elements;
				}},
			};
		}
		options(options) {
			state.options = options;
			if (failure === 'setup') throw state.error;
		}
		render() {
			if (failure === 'render') throw state.error;
			return ready;
		}
		getContext() { return {canvas: state.surface}; }
		on(name, callback) { this.listeners.set(name, callback); }
		destroy() {
			this.listeners.get('beforedestroy')?.();
			state.destroyed++;
			if (cleanupError) throw cleanupError;
		}
	}};
	return state;
}

function autoDomain(scale) {
	for (const key of ['min', 'max', 'domain', 'domainMin', 'domainMax'])
		assert.equal(scale[key], undefined);
}

function checkConfig(state, host) {
	assert.equal(state.constructorOptions.container, host);
	assert.equal(state.constructorOptions.width, 1920);
	assert.equal(state.constructorOptions.height, 600);
	assert.equal(state.constructorOptions.autoFit, false);
	const o = state.options;
	assert.equal(o.data, data);
	assert.equal(o.title, 'Server Events');
	assert.equal(o.type, 'view');
	assert.equal(o.animate, false);
	assert.equal(o.transform, undefined);
	assert.deepEqual(o.scale.x, {type: 'time', nice: false});
	autoDomain(o.scale.x);
	assert.deepEqual(o.scale.color, {type: 'ordinal', domain: ['CPU', 'RAM', 'TCP Out'], range: ['red', 'blue', 'green']});
	assert.deepEqual(o.legend, {color: {position: 'bottom'}});
	assert.deepEqual(o.children.map(mark => mark.encode.y), ['cpu', 'ram', 'tcp']);
	assert.deepEqual(o.children.map(mark => mark.encode.color), ['CPU', 'RAM', 'TCP Out'].map(value => ({type: 'constant', value})));
	assert.deepEqual(o.children.map(mark => mark.scale.y.key), ['percent', 'percent', 'tcp']);
	assert.deepEqual(o.children.map(mark => mark.axis.y.position), ['left', 'left', 'right']);
	assert.deepEqual(o.children.map(mark => mark.axis.y.labelFormatter(7)), ['7%', '7%', '7 MB']);
	for (const mark of o.children) {
		assert.equal(mark.type, 'line');
		assert.equal(mark.encode.x, 'time');
		assert.equal(mark.scale.y.type, 'linear');
		assert.equal(mark.scale.y.zero, false);
		assert.equal(mark.scale.y.nice, true);
		assert.equal(mark.axis.x.title, false);
		assert.equal(mark.axis.y.title, false);
		assert.equal(mark.style.lineWidth, 0.5);
		assert.equal(mark.style.fill, 'none');
		assert.equal(mark.animate, false);
		assert.equal(mark.data, undefined);
		assert.equal(mark.transform, undefined);
		assert.equal(mark.labels, undefined);
		autoDomain(mark.scale.y);
	}
}

describe('G2 WebGL benchmark adapter (no browser)', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries(['G', 'G2', 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		globalThis.devicePixelRatio = 2;
	});
	afterEach(() => {
		for (const [key, descriptor] of Object.entries(saved)) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});

	it('shares preparation and destruction, preserving all 55,550 rows and three series', () => {
		assert.equal(webgl.prepData, canvas.prepData);
		assert.equal(webgl.destroyChart, canvas.destroyChart);
		assert.equal(data.length, 55550);
		for (let j = 0; j < data.length; j++) {
			const i = packed[0] + 1 + j * packed[0];
			assert.deepEqual(data[j], {
				time: packed[i] * 60000,
				cpu: Math.round((100 - packed[i + 1]) * 1000) / 1000,
				ram: Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100,
				tcp: packed[i + 3],
			});
		}
		const again = webgl.prepData(packed);
		assert.deepEqual(again, data);
		assert.ok(again.every((row, i) => row !== data[i]));
		const irregular = Object.freeze([7, 'epoch', 'idl', 'recv', 'send', 'writ', 'used', 'free',
			10, 100, 2, 0, 4, 0, 75, 17, 87.6543, 2, 9, 4, 1, 2]);
		assert.deepEqual(webgl.prepData(irregular), [
			{time: 600000, cpu: 0, ram: 0, tcp: 0},
			{time: 1020000, cpu: 12.346, ram: 33.33, tcp: 9},
		]);
		assert.deepEqual(webgl.prepData(irregular.slice(0, 8)), []);
	});

	it('keeps Canvas as the default and shares the full calendar/dual-axis configuration', async () => {
		const host = Object.freeze({});
		const runtime = Object.freeze({renderer: 'ignored'});
		const plain = vendor();
		const original = await canvas.makeChart(data, host, undefined, runtime);
		checkConfig(plain, host);
		assert.deepEqual(plain.constructorOptions, {container: host, width: 1920, height: 600, autoFit: false});
		assert.equal(plain.renderers.length, 0);
		assert.equal(original.getWebGLContexts, undefined);
		canvas.destroyChart(original);
		const alternate = vendor();
		const chart = await webgl.makeChart(data, host, undefined, runtime);
		checkConfig(alternate, host);
		assert.equal(alternate.constructorOptions.renderer, alternate.renderers[0]);
		// Default targets are WebGL2 then WebGL1; do not force a software backend.
		assert.deepEqual(alternate.rendererArgs, []);
		assert.equal(JSON.stringify(alternate.options), JSON.stringify(plain.options));
		webgl.destroyChart(chart);
	});

	it('awaits rendering, captures existing and reused contexts, and releases capture on destruction', async () => {
		const {promise, resolve} = Promise.withResolvers();
		const state = vendor({ready: promise});
		const wait = {textContent: 'Rendering...'};
		let finished = false;
		const pending = webgl.makeChart(data, {}, wait).then(chart => { finished = true; return chart; });
		await Promise.resolve();
		assert.equal(finished, false);
		assert.equal(wait.textContent, 'Rendering...');
		resolve();
		const chart = await pending;
		assert.equal(chart, state.charts[0]);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(state.destroyed, 0);
		assert.deepEqual(chart.getWebGLContexts(), [state.gl]);
		assert.deepEqual(chart.getWebGLContexts(), [state.gl]);
		state.gl = {isContextLost: () => false};
		assert.deepEqual(chart.getWebGLContexts(), [state.gl]);
		state.gl.isContextLost = () => true;
		assert.deepEqual(chart.getWebGLContexts(), []);
		webgl.destroyChart(chart);
		state.surface.getContextService = () => assert.fail('must not access a destroyed renderer');
		assert.deepEqual(chart.getWebGLContexts(), []);
		assert.equal(state.destroyed, 1);
	});

	it('creates a fresh renderer for each chart while reusing frozen prepared data', async () => {
		const state = vendor();
		const first = await webgl.makeChart(data, {});
		webgl.destroyChart(first);
		const second = await webgl.makeChart(data, {});
		assert.notEqual(first, second);
		assert.equal(state.renderers.length, 2);
		assert.notEqual(state.renderers[0], state.renderers[1]);
		assert.equal(state.options.data, data);
		webgl.destroyChart(second);
		assert.equal(state.destroyed, 2);
	});

	for (const failure of ['renderer', 'constructor', 'setup', 'render', 'async']) {
		it(`preserves ${failure} failure even if chart cleanup throws`, async () => {
			const {promise, reject} = Promise.withResolvers();
			const state = vendor({ready: promise, failure, cleanupError: new Error('cleanup failed')});
			const wait = {textContent: 'Rendering...'};
			const pending = webgl.makeChart(data, {}, wait);
			if (failure === 'async') reject(state.error);
			await assert.rejects(pending, error => error === state.error);
			assert.equal(state.destroyed, ['renderer', 'constructor'].includes(failure) ? 0 : 1);
			assert.equal(wait.textContent, 'Rendering...');
		});
	}

	for (const failure of ['renderer mismatch', 'missing context', 'unused context', 'lost context', 'missing line', 'non-path', 'no GPU drawcall', 'Canvas texture']) {
		it(`rejects ${failure} instead of reporting successful WebGL rendering`, async () => {
			const {promise, resolve} = Promise.withResolvers();
			const state = vendor({ready: promise, cleanupError: new Error('cleanup failed')});
			const wait = {textContent: 'Rendering...'};
			const pending = webgl.makeChart(data, {}, wait);
			if (failure === 'renderer mismatch') state.surface.getConfig = () => ({renderer: {}});
			if (failure === 'missing context') state.surface.getContextService = () => ({getContext: () => null});
			if (failure === 'unused context') state.surface.getContextService = () => ({getContext: () => ({isContextLost: () => false})});
			if (failure === 'lost context') state.gl.isContextLost = () => true;
			if (failure === 'missing line') state.elements.pop();
			if (failure === 'non-path') state.elements[0].nodeName = 'image';
			if (failure === 'no GPU drawcall') delete state.elements[0].renderable3D;
			if (failure === 'Canvas texture') state.elements[0].renderable3D.drawcalls = [{}];
			resolve();
			await assert.rejects(pending, /G2 WebGL requires/);
			assert.equal(state.destroyed, 1);
			assert.equal(wait.textContent, 'Rendering...');
		});
	}

	it('keeps the legacy export declaration and exposes the shared factory on a separate line', () => {
		const source = readFileSync(new URL('../../bench/g2.mjs', import.meta.url), 'utf8');
		assert.match(source, /^export \{makeChartWithOptions\};$/m);
		assert.match(source, /export \{prepData, makeChart, destroyChart, makeEmptyChart, updateChart\};\s*$/);
		const legacy = runInNewContext(source.replace(/^export \{[^\n]+\};\s*$/gm, '') +
			'\n({prepData, makeChart, destroyChart, makeChartWithOptions})');
		assert.equal(typeof legacy.makeChart, 'function');
		assert.equal(typeof legacy.makeChartWithOptions, 'function');
	});

	it('uses only the shared runner in the HTML entry point', () => {
		const html = readFileSync(new URL('../../bench/G2-WebGL.html', import.meta.url), 'utf8');
		const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
		assert.equal(scripts.length, 1);
		assert.equal(scripts[0][1].trim(), 'type="module"');
		assert.equal(scripts[0][2].trim(), "import {runDemo} from './demo.mjs';\n\t\t\trunDemo('g2-webgl').catch(console.error);");
		assert.doesNotMatch(html, /<style\b|<link\b|<canvas\b|fetch\(|https?:|style=/);
	});
});
