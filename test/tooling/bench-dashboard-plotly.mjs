import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as plotly from '../../bench/dashboard/plotly.mjs';
import * as svg from '../../bench/dashboard/plotly-svg.mjs';
import {CHARTS, WIDTH, HEIGHT, SERIES, dashboardData} from '../../bench/dashboard/common.mjs';

const globals = ['Plotly', 'HTMLCanvasElement', 'virtualWebGL', 'benchmarkWebGL', 'devicePixelRatio'];
const input = plotly.prepData(dashboardData(2)[0]);
const replacement = plotly.prepData(dashboardData()[0]);
const deferred = () => {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return {promise, resolve, reject};
};

function fixture() {
	const env = {events: [], resources: [], acquisitions: [], hosts: []};
	class Canvas {
		constructor(parentNode, context) { Object.assign(this, {parentNode, context}); }
		getContext(...args) {
			env.acquisitions.push({canvas: this, args});
			if (this.error) throw this.error;
			return this.context;
		}
	}
	globalThis.HTMLCanvasElement = Canvas;
	globalThis.virtualWebGL = {};
	Object.defineProperty(globalThis, 'devicePixelRatio', {configurable: true, writable: true, value: 2});
	delete globalThis.benchmarkWebGL;
	env.host = () => {
		const host = {index: env.hosts.length, parentNode: null, fallback: false,
			querySelector(selector) { assert.equal(selector, '.no-webgl'); return this.fallback ? {} : null; }};
		env.hosts.push(host);
		return host;
	};
	env.resource = (host, {acquire = true, virtual = true} = {}) => {
		const id = env.resources.length;
		const gl = {lost: false, disposed: 0, isContextLost() { return this.lost; }};
		if (virtual) gl.dispose = function() {
			env.events.push(`dispose:${id}`);
			this.disposed++;
			if (this.error) throw this.error;
		};
		const canvas = new Canvas({parentNode: host}, gl);
		const regl = Object.assign(() => {}, {_gl: gl, destroyed: 0, destroy() {
			env.events.push(`destroy:${id}`);
			this.destroyed++;
			if (this.error) throw this.error;
		}});
		const resource = {id, host, canvas, gl, regl};
		env.resources.push(resource);
		if (acquire) {
			assert.equal(canvas.getContext('webgl', {preserveDrawingBuffer: true}), gl);
			assert.equal(canvas.getContext('experimental-webgl'), gl);
		}
		return resource;
	};
	env.entries = (host, resources) => {
		host._fullLayout = {_glcanvas: {data: () => [...resources.map(({regl}) => ({regl})), {pick: true}]}};
	};
	env.populate = host => {
		const resources = [env.resource(host), env.resource(host)];
		env.entries(host, resources);
		return resources;
	};
	globalThis.Plotly = {
		async newPlot(host, data, layout, config) {
			Object.assign(host, {data, layout, config});
			if (env.create) await env.create(host);
			else if (data[0].type === 'scattergl') env.populate(host);
			return host;
		},
		async react(host, data, layout) {
			Object.assign(host, {data, layout});
			if (env.update) await env.update(host);
			return host;
		},
		purge(host) {
			env.events.push(`purge:${host.index}`);
			delete host._fullLayout;
			delete host.data;
			if (env.purgeError) throw env.purgeError;
		},
	};
	return env;
}

function cleaned(resources) {
	for (const {regl, gl} of resources) {
		assert.equal(regl.destroyed, 1);
		assert.equal(gl.disposed, 1);
	}
}

describe('dashboard Plotly virtual WebGL ownership', () => {
	let saved, env;
	beforeEach(() => {
		saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		env = fixture();
	});
	afterEach(() => globals.forEach((key, i) => {
		if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
		else delete globalThis[key];
	}));

	it('shadows DPR without changing accessor-backed state', () => {
		let ratio = 1, writes = 0;
		Object.defineProperty(globalThis, 'devicePixelRatio', {
			configurable: true,
			get: () => ratio,
			set: value => { ratio = value; writes++; },
		});
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
		try {
			fixture();
			assert.equal(globalThis.devicePixelRatio, 2);
			globalThis.devicePixelRatio = 3;
			assert.equal(globalThis.devicePixelRatio, 3);
			assert.equal(ratio, 1);
			assert.equal(writes, 0);
		}
		finally {
			Object.defineProperty(globalThis, 'devicePixelRatio', descriptor);
		}
		assert.equal(globalThis.devicePixelRatio, 1);
		assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio'), descriptor);
	});

	it('requires preparation and the loaded WebGL1 runtime, without acquiring a probe context', async () => {
		await assert.rejects(plotly.makeChart(input, env.host()), /prepareRuntime/);
		delete globalThis.virtualWebGL;
		const original = HTMLCanvasElement.prototype.getContext;
		assert.throws(() => plotly.prepareRuntime(), /virtual-webgl WebGL1 1\.0\.7/);
		assert.equal(HTMLCanvasElement.prototype.getContext, original);
		assert.equal(env.acquisitions.length, 0);
		assert.deepEqual(env.events, []);
	});

	it('installs ownership after virtualization and reinstalls the completion observer once', async () => {
		const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
		const replacementObserver = {};
		let ownership, reinstalls = 0;
		globalThis.benchmarkWebGL = {reinstall() {
			reinstalls++;
			ownership = HTMLCanvasElement.prototype.getContext;
			assert.notEqual(ownership, original.value);
			HTMLCanvasElement.prototype.getContext = function(...args) {
				const gl = ownership.apply(this, args);
				env.events.push('observer');
				return gl;
			};
			return replacementObserver;
		}};
		plotly.prepareRuntime();
		assert.equal(globalThis.benchmarkWebGL, replacementObserver);
		const observer = HTMLCanvasElement.prototype.getContext;
		plotly.prepareRuntime();
		assert.equal(HTMLCanvasElement.prototype.getContext, observer);
		assert.equal(reinstalls, 1);
		const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
		for (const key of ['writable', 'configurable', 'enumerable']) assert.equal(descriptor[key], original[key]);
		assert.equal(env.acquisitions.length, 0);
		const host = env.host();
		await plotly.makeChart(input, host);
		assert.equal(env.events.filter(event => event === 'observer').length, 4);
		plotly.destroyChart(host);
		cleaned(env.resources);
	});

	it('preserves getContext receiver, arguments, results and exceptions', () => {
		plotly.prepareRuntime();
		const context = {}, canvas = new HTMLCanvasElement(null, context), options = {alpha: false};
		assert.equal(canvas.getContext('webgl', options, 42), context);
		assert.deepEqual(env.acquisitions[0], {canvas, args: ['webgl', options, 42]});
		assert.equal(canvas.getContext('2d'), context);
		canvas.context = null;
		assert.equal(canvas.getContext('webgl'), null);
		const error = canvas.error = new Error('getContext failed');
		assert.throws(() => canvas.getContext('webgl'), value => value === error);
	});

	it('isolates 20 concurrent newPlot calls by canvas ancestry and returns native handles', async () => {
		plotly.prepareRuntime();
		const gates = Array.from({length: CHARTS}, deferred);
		env.create = async host => {
			const first = env.resource(host);
			await gates[host.index].promise;
			env.entries(host, [first, env.resource(host)]);
		};
		const hosts = Array.from({length: CHARTS}, () => env.host());
		const waits = hosts.map(() => ({textContent: 'Wait'}));
		const creations = hosts.map((host, i) => plotly.makeChart(input, host, waits[i]));
		assert.equal(env.resources.length, CHARTS);
		const unrelated = env.resource(null);
		for (let i = CHARTS - 1; i >= 0; i--) {
			gates[i].resolve();
			assert.equal(await creations[i], hosts[i]);
			assert.equal(waits[i].textContent, 'Done!');
		}
		for (const host of hosts) {
			assert.deepEqual(host.getWebGLContexts(), env.resources.filter(r => r.host === host).map(r => r.gl));
			assert.equal(plotly.validateChart(host, input, {rows: 2}), true);
			assert.equal(host.layout.width, WIDTH);
			assert.equal(host.layout.height, HEIGHT);
			assert.equal(host.config.plotGlPixelRatio, 2);
			assert.deepEqual(host.data.map(trace => trace.type), SERIES.map(() => 'scattergl'));
			assert.deepEqual(host.data.map(trace => trace.line.width), SERIES.map(() => 0.5));
		}
		const acquired = env.acquisitions.length;
		for (const host of hosts) {
			plotly.destroyChart(host);
			assert.deepEqual(host.getWebGLContexts(), []);
			cleaned(env.resources.filter(r => r.host === host));
			for (const other of env.resources.filter(r => r.host && r.host.index > host.index)) {
				assert.equal(other.gl.disposed, 0);
				assert.equal(other.regl.destroyed, 0);
			}
		}
		assert.equal(env.acquisitions.length, acquired);
		assert.equal(unrelated.gl.disposed, 0);
		assert.equal(unrelated.regl.destroyed, 0);
	});

	it('never destroys a regl or context owned by another chart', async () => {
		plotly.prepareRuntime();
		const first = await plotly.makeChart(input, env.host());
		env.create = host => env.entries(host, env.resources);
		await assert.rejects(plotly.makeChart(input, env.host()), /belongs to another chart/);
		assert.deepEqual(env.events, ['purge:1']);
		for (const {regl, gl} of env.resources) {
			assert.equal(regl.destroyed, 0);
			assert.equal(gl.disposed, 0);
		}
		plotly.destroyChart(first);
		cleaned(env.resources);
		const events = [...env.events];
		plotly.destroyChart(first);
		assert.deepEqual(env.events, events);
	});

	it('cleans contexts acquired before regl assignment and preserves construction errors', async () => {
		plotly.prepareRuntime();
		const error = new Error('newPlot failed'), cleanupError = new Error('purge failed');
		env.purgeError = cleanupError;
		env.create = host => {
			const resource = env.resource(host);
			resource.gl.error = new Error('dispose failed');
			throw error;
		};
		const host = env.host(), wait = {textContent: 'Wait'};
		await assert.rejects(plotly.makeChart(input, host, wait), value => value === error);
		assert.equal(wait.textContent, 'Wait');
		assert.deepEqual(env.events, ['purge:0', 'dispose:0']);
		assert.equal(env.resources[0].regl.destroyed, 0);
		assert.equal(env.resources[0].gl.disposed, 1);
		assert.deepEqual(host.getWebGLContexts(), []);
		plotly.destroyChart(host);
		assert.deepEqual(env.events, ['purge:0', 'dispose:0']);
	});

	it('preserves a construction error when final collection and cleanup also fail', async () => {
		plotly.prepareRuntime();
		const error = new Error('construction'), collectError = new Error('collection');
		env.create = host => {
			env.resource(host);
			host._fullLayout = {_glcanvas: {data() { throw collectError; }}};
			throw error;
		};
		env.purgeError = new Error('purge');
		const host = env.host();
		await assert.rejects(plotly.makeChart(input, host), value => value === error);
		assert.deepEqual(env.events, ['purge:0', 'dispose:0']);
		assert.deepEqual(host.getWebGLContexts(), []);
	});

	it('collects regl contexts on rejected construction even without an observed acquisition', async () => {
		plotly.prepareRuntime();
		const error = new Error('late newPlot failure');
		env.create = async host => {
			const resources = [env.resource(host, {acquire: false}), env.resource(host, {acquire: false})];
			env.entries(host, resources);
			throw error;
		};
		await assert.rejects(plotly.makeChart(input, env.host()), value => value === error);
		assert.equal(env.acquisitions.length, 0);
		assert.deepEqual(env.events, ['purge:0', 'destroy:0', 'destroy:1', 'dispose:0', 'dispose:1']);
		cleaned(env.resources);
	});

	for (const failure of ['missing regl', 'missing context', 'native context', 'lost context', 'duplicate context', 'fallback']) {
		it(`rejects ${failure} instead of accepting a silent WebGL fallback`, async () => {
			plotly.prepareRuntime();
			env.create = host => {
				const resources = env.populate(host);
				if (failure === 'missing regl') resources[1].regl = null;
				if (failure === 'missing context') resources[1].regl._gl = null;
				if (failure === 'native context') delete resources[1].gl.dispose;
				if (failure === 'lost context') resources[1].gl.lost = true;
				if (failure === 'duplicate context') resources[1].regl._gl = resources[0].gl;
				if (failure === 'fallback') host.fallback = true;
			};
			const host = env.host(), wait = {textContent: 'Wait'};
			await assert.rejects(plotly.makeChart(input, host, wait), /two live virtual regl contexts/);
			assert.equal(wait.textContent, 'Wait');
			assert.deepEqual(host.getWebGLContexts(), []);
			assert.equal(env.events[0], 'purge:0');
			for (const resource of env.resources) {
				if (resource.regl) assert.equal(resource.regl.destroyed, 1);
				if (resource.gl.dispose) assert.equal(resource.gl.disposed, 1);
			}
		});
	}

	it('collects before and after react, retaining replaced regls but reporting only current contexts', async () => {
		plotly.prepareRuntime();
		const host = await plotly.makeChart(input, env.host());
		// Model a renderer replacement between operations, unseen by the wrapper.
		const between = [env.resource(host, {acquire: false}), env.resource(host, {acquire: false})];
		env.entries(host, between);
		env.update = chart => {
			env.entries(chart, [env.resource(chart, {acquire: false}), env.resource(chart, {acquire: false})]);
		};
		const wait = {textContent: 'Wait'};
		await plotly.updateChart(host, replacement, host, wait);
		assert.equal(wait.textContent, 'Done!');
		assert.equal(plotly.validateChart(host, replacement, {rows: 300}), true);
		assert.deepEqual(host.getWebGLContexts(), env.resources.slice(-2).map(r => r.gl));
		assert.equal(env.resources.length, 6);
		assert.deepEqual(env.events, []);
		const acquired = env.acquisitions.length;
		plotly.destroyChart(host);
		cleaned(env.resources);
		assert.equal(env.acquisitions.length, acquired);
		assert.deepEqual(env.events, ['purge:0', ...env.resources.map(r => `destroy:${r.id}`), ...env.resources.map(r => `dispose:${r.id}`)]);
	});

	it('retains resources from rejected react and preserves its error for later cleanup', async () => {
		plotly.prepareRuntime();
		const host = await plotly.makeChart(input, env.host()), error = new Error('react failed');
		env.update = chart => {
			env.entries(chart, [env.resource(chart, {acquire: false})]);
			env.resource(chart); // Acquired but never assigned to a regl entry.
			throw error;
		};
		const wait = {textContent: 'Wait'};
		await assert.rejects(plotly.updateChart(host, replacement, host, wait), value => value === error);
		assert.equal(wait.textContent, 'Wait');
		const acquired = env.acquisitions.length;
		plotly.destroyChart(host);
		cleaned(env.resources.slice(0, 3));
		assert.equal(env.resources[3].gl.disposed, 1);
		assert.equal(env.resources[3].regl.destroyed, 0);
		assert.equal(env.acquisitions.length, acquired);
	});

	it('rejects a fallback introduced by react and checks context loss during validation', async () => {
		plotly.prepareRuntime();
		const host = await plotly.makeChart(input, env.host());
		env.resources[0].gl.lost = true;
		assert.throws(() => plotly.validateChart(host, input, {rows: 2}), /two live virtual regl contexts/);
		env.resources[0].gl.lost = false;
		env.update = chart => { chart.fallback = true; };
		const wait = {textContent: 'Wait'};
		await assert.rejects(plotly.updateChart(host, replacement, host, wait), /fallback/);
		assert.equal(wait.textContent, 'Wait');
		plotly.destroyChart(host);
		cleaned(env.resources);
	});

	it('attempts all cleanup stages in order, releases bookkeeping, and is idempotent after errors', async () => {
		plotly.prepareRuntime();
		const host = await plotly.makeChart(input, env.host());
		const errors = [new Error('purge'), new Error('regl'), new Error('dispose')];
		env.purgeError = errors[0];
		env.resources[0].regl.error = errors[1];
		env.resources[0].gl.error = errors[2];
		// Cleanup must snapshot this late replacement before purge deletes its entries.
		env.entries(host, [env.resource(host, {acquire: false}), env.resource(host, {acquire: false})]);
		const acquired = env.acquisitions.length;
		assert.throws(() => plotly.destroyChart(host), error => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, errors);
			assert.equal(error.cause, errors[0]);
			return true;
		});
		assert.deepEqual(env.events, ['purge:0', 'destroy:0', 'destroy:1', 'destroy:2', 'destroy:3',
			'dispose:0', 'dispose:1', 'dispose:2', 'dispose:3']);
		cleaned(env.resources);
		assert.deepEqual(host.getWebGLContexts(), []);
		plotly.destroyChart(host);
		assert.equal(env.events.length, 9);
		assert.equal(env.acquisitions.length, acquired);
		delete env.purgeError;
		await plotly.makeChart(input, host);
		assert.equal(host.getWebGLContexts().length, 2);
		plotly.destroyChart(host);
		cleaned(env.resources);
	});

	it('does not scan trace data in measured creation or update paths', async () => {
		plotly.prepareRuntime();
		const guarded = {...input};
		for (const {id} of SERIES) guarded[id] = new Proxy(input[id], {get(target, key) {
			if (key === 'some' || key === Symbol.iterator) throw new Error('deep data check');
			return Reflect.get(target, key);
		}});
		const host = await plotly.makeChart(guarded, env.host());
		await plotly.updateChart(host, guarded, host);
		plotly.destroyChart(host);
	});

	it('keeps SVG imports, construction, updates, validation and purge independent of virtual WebGL', async () => {
		delete globalThis.virtualWebGL;
		const original = HTMLCanvasElement.prototype.getContext;
		const imported = await import('../../bench/dashboard/plotly-svg.mjs?ownership-test');
		assert.equal(imported.prepareRuntime, undefined);
		assert.equal(svg.prepareRuntime, undefined);
		assert.equal(HTMLCanvasElement.prototype.getContext, original);
		const host = env.host(), wait = {textContent: 'Wait'};
		assert.equal(await svg.makeChart(input, host, wait), host);
		assert.equal(host.getWebGLContexts, undefined);
		assert.equal(wait.textContent, 'Done!');
		assert.ok(host.data.every(trace => trace.type === 'scatter'));
		assert.equal(svg.validateChart(host, input, {rows: 2}), true);
		await svg.updateChart(host, replacement, host, wait);
		assert.equal(svg.validateChart(host, replacement, {rows: 300}), true);
		assert.ok(host.data.every(trace => trace.type === 'scatter'));
		svg.destroyChart(host);
		assert.deepEqual(env.events, ['purge:0']);
		assert.equal(env.acquisitions.length, 0);
		const error = new Error('SVG construction');
		env.create = () => { throw error; };
		env.purgeError = new Error('SVG purge');
		await assert.rejects(svg.makeChart(input, env.host()), value => value === error);
	});
});
