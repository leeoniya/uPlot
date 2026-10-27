import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createDashboardLifecycle} from '../../bench/dashboard/lifecycle.mjs';
import {captureBenchmarkSamples} from '../../scripts/benchmarks-samples.mjs';

const deferred = () => Promise.withResolvers();
const turn = () => new Promise(resolve => setImmediate(resolve));
const unexpectedValidation = () => { throw new Error('Capture must not invoke diagnostic validation.'); };

function harness({variant = 'mock', overrides = {}} = {}) {
	const events = [], handles = [], tracked = new Set();
	let clock = 0, inWindow = false;
	const outside = () => assert.equal(inWindow, false, 'validation/preparation must be outside markers');
	const inside = () => assert.equal(inWindow, true, 'chart work must be inside markers');
	const document = {visibilityState: 'visible'};
	class Element {
		constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.ownerDocument = document; this.listeners = {}; }
		addEventListener(name, listener, capture) { assert.equal(capture, true); this.listeners[name] = listener; }
		append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
		appendChild(node) { this.append(node); return node; }
		replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
		get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
		matches(selector) { outside(); assert.equal(selector, 'canvas, svg'); return ['canvas', 'svg'].includes(this.tagName); }
		querySelector(selector) {
			outside();
			for (const child of this.children) {
				if (child.matches(selector)) return child;
				const descendant = child.querySelector(selector);
				if (descendant) return descendant;
			}
			return null;
		}
		attachShadow() {
			const root = this.shadowRoot = new Element('#shadow-root');
			root.matches = undefined;
			return root;
		}
		getBoundingClientRect() {
			outside();
			const i = this.parentNode.children.indexOf(this);
			return {left: i % 4 * 480, top: Math.floor(i / 4) * 216, width: 480, height: 216};
		}
	}
	document.createElement = tag => new Element(tag);
	document.body = new Element('body');
	document.head = new Element('head');
	const realm = {
		document, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
		navigator: {userAgent: 'mock'}, crypto: {randomUUID: () => 'capture-id'}, console: {},
		performance: {
			now() { return ++clock; },
			mark(name) {
				if (name.endsWith(':start')) { outside(); inWindow = true; }
				if (name.endsWith(':end')) { inside(); inWindow = false; }
				events.push(['mark', name]);
				return {startTime: ++clock};
			},
		},
		requestAnimationFrame(fn) { events.push(['raf']); queueMicrotask(() => { clock += 16; fn(clock - 5); }); },
		setTimeout(fn, ms) { assert.equal(ms, 200, 'fixture must add no timers beyond settling'); events.push(['timer', ms]); queueMicrotask(fn); },
		benchmarkMoveMouse(x, y) { outside(); events.push(['mouse', x, y]); },
		benchmarkSampleBoundary(json) { outside(); events.push(['boundary', JSON.parse(json)]); },
		benchmarkWebGL: {
			begin() { outside(); events.push(['gl-begin']); },
			track(gl) { inside(); tracked.add(gl); },
			async complete(options) {
				inside();
				assert.deepEqual(options, {webgl1Finish: true, retainContexts: true});
				events.push(['gl-complete', tracked.size]);
				return {status: tracked.size ? 'complete' : 'not-observed', contexts: [...tracked].map(() => ({status: 'complete'}))};
			},
			reset() { events.push(['gl-reset']); tracked.clear(); },
		},
		benchmarkWebGPU: {
			async complete(devices) {
				inside(); events.push(['gpu-complete', devices]);
				return {status: 'complete', devices: devices.map(() => ({status: 'complete'}))};
			},
		},
	};
	const source = {
		prepData(frame) { outside(); events.push(['prep', frame.x.length]); return {x: [...frame.x], ys: frame.ys.map(values => [...values])}; },
		makeChart(input, host) {
			inside();
			assert.equal(document.body.children[0].children.length, 20, 'all hosts exist before chart creation');
			assert.match(host.id, /^dashboard-sample-\d+-\d+$/);
			const chart = {input, host, index: handles.length};
			host.append(document.createElement('canvas'));
			handles.push(chart);
			events.push(['make', chart.index]);
			return chart;
		},
		updateChart(chart, input, host) { inside(); assert.equal(host, chart.host); chart.input = input; events.push(['update', chart.index]); },
		validateChart(chart, input, {rows}) {
			outside(); assert.equal(chart.input, input);
			assert.equal(input.x.length, rows);
			assert.deepEqual(input.ys.map(values => values.length), Array(5).fill(rows));
			events.push(['validate', rows]);
			return true;
		},
		destroyChart(chart) { events.push(['destroy', chart.index]); chart.destroyed = true; },
		...overrides,
	};
	const api = createDashboardLifecycle({variant, source, realm});
	return {...api, realm, source, events, handles, outside, inside,
		fixture: document.body.children[0]};
}

async function prepared(h, {raf = false} = {}) {
	h.benchmarkLifecycle.begin({raf});
	await h.benchmarkLifecycle.setup('mock', 'sample-0');
	await h.benchmarkLifecycle.prepare('small-init', 'sample-0');
}

async function updated(h) {
	await prepared(h);
	await h.benchmarkLifecycle.construct();
	await h.benchmarkLifecycle.prepare('data-update', 'sample-1');
	return h.benchmarkLifecycle.construct();
}

describe('dashboard browser lifecycle', () => {
	it('reports the dashboard contract without resize/hover protocols', () => {
		const h = harness(), report = h.benchmarkLifecycle.begin();
		assert.equal(report.phase, 'chart-population');
		assert.equal(report.initProtocol, 'settled-work-v1');
		assert.deepEqual(report.workload, {protocol: 'dashboard-v1', charts: 20, series: 5, rows: 300,
			columns: 4, gridRows: 5, width: 480, height: 216});
		assert.deepEqual(report.config, {variants: ['mock'], dpr: 1, warmups: 3, rounds: 7,
			lifecycle: true, operations: ['small-init', 'data-update']});
		assert.deepEqual(report.viewport, [1920, 1080]);
		assert.equal(report.expectedInstances.chartCreations, 200);
		assert.equal(report.expectedInstances.operationWindows, 20);
		for (const field of ['resizeProtocol', 'hoverProtocol', 'memoryProtocol']) assert.equal(field in report, false);
		assert.throws(() => h.benchmarkLifecycle.begin(), /exclusive/);
		assert.match(h.realm.document.head.children[0].textContent, /repeat\(4, 480px\)/);
		assert.match(h.realm.document.head.children[0].textContent, /repeat\(5, 216px\)/);
	});

	it('prepares all inputs outside markers and updates the same 20 charts', async () => {
		const h = harness();
		await prepared(h);
		assert.equal(h.fixture.children.length, 0);
		assert.equal(h.events.filter(([event]) => event === 'prep').length, 20);
		const initial = await h.benchmarkLifecycle.construct();
		assert.equal(initial.operation, 'small-init');
		assert.equal(h.events.filter(([event]) => event === 'validate').length, 0);
		await h.benchmarkLifecycle.validate();
		const hosts = [...h.fixture.children], charts = [...h.handles];
		assert.equal(new Set(hosts.map(host => host.id)).size, 20);
		assert.equal(new Set(charts.map(chart => chart.input.x)).size, 20);
		await h.benchmarkLifecycle.prepare('data-update', 'sample-1');
		const update = await h.benchmarkLifecycle.construct();
		assert.deepEqual(h.fixture.children, hosts);
		assert.deepEqual(h.handles, charts);
		assert.equal(update.operation, 'data-update');
		assert.equal(update.prepAndInitMs, update.dataPrepMs + update.jsMs);
		assert.ok(update.windowMs > update.jsMs);
		assert.equal(h.events.filter(([event]) => event === 'update').length, 20);
		assert.equal(h.events.filter(([event]) => event === 'validate').length, 20);
		await h.benchmarkLifecycle.validate();
		assert.equal(h.events.filter(([event]) => event === 'validate').length, 40);
		assert.deepEqual(h.events.filter(([event]) => event === 'mark').map(([, name]) => name), [
			'benchmark:capture:capture-id', 'benchmark:sample-0:start', 'benchmark:sample-0:js-end', 'benchmark:sample-0:end',
			'benchmark:sample-1:start', 'benchmark:sample-1:js-end', 'benchmark:sample-1:end',
		]);
		await h.benchmarkLifecycle.destroy();
		assert.ok(charts.every(chart => chart.destroyed));
		assert.equal(h.fixture.children.length, 0);
	});

	for (const surface of ['canvas', 'svg']) for (const raf of [false, true]) {
		it(`finds nested shadow-DOM ${surface} surfaces outside markers (${raf ? 'rAF' : 'trace'})`, async () => {
			const h = harness(), make = h.source.makeChart;
			h.source.makeChart = (...args) => {
				const chart = make(...args), host = chart.host, document = host.ownerDocument;
				host.replaceChildren();
				const wrapper = document.createElement('div');
				// Exercise both a shadow root on the tile and one on a light-DOM descendant.
				const parent = chart.index % 2 ? host.attachShadow() : host;
				parent.append(wrapper);
				const inner = document.createElement('div');
				wrapper.attachShadow().append(inner);
				const root = inner.attachShadow();
				for (let i = 0; i < 7; i++) root.append(document.createElement(surface));
				return chart;
			};
			await prepared(h, {raf});
			await h.benchmarkLifecycle.construct();
			assert.ok(h.fixture.children.every(host => host.querySelector('canvas, svg') === null));
			await h.benchmarkLifecycle.prepare('data-update', 'sample-1');
			await h.benchmarkLifecycle.construct();
			assert.equal(h.events.filter(([event]) => event === 'validate').length, 0);
			await h.benchmarkLifecycle.destroy();
			assert.ok(h.handles.every(chart => chart.destroyed));
		});
	}

	it('still rejects shadow trees without a chart surface', async () => {
		const h = harness(), make = h.source.makeChart;
		h.source.makeChart = (...args) => {
			const chart = make(...args);
			chart.host.replaceChildren();
			chart.host.attachShadow().append(chart.host.ownerDocument.createElement('div'));
			return chart;
		};
		await prepared(h);
		await assert.rejects(h.benchmarkLifecycle.construct(), /unexpected chart surface/);
		await h.benchmarkLifecycle.destroy();
	});

	for (const operation of ['small-init', 'data-update']) it(`starts every ${operation} before awaiting any tile`, async () => {
		const h = harness(), gate = deferred();
		const method = operation === 'small-init' ? 'makeChart' : 'updateChart';
		const original = h.source[method];
		let calls = 0;
		h.source[method] = async (...args) => { calls++; const result = original(...args); await gate.promise; return result; };
		await prepared(h);
		if (operation === 'data-update') {
			await h.benchmarkLifecycle.construct();
			await h.benchmarkLifecycle.prepare(operation, 'sample-1');
		}
		let finished = false;
		const pending = h.benchmarkLifecycle.construct().then(() => { finished = true; });
		await turn();
		assert.equal(calls, 20);
		assert.equal(finished, false);
		await assert.rejects(h.benchmarkLifecycle.destroy(), /inactive/);
		gate.resolve();
		await pending;
		await h.benchmarkLifecycle.destroy();
	});

	for (const asyncFailure of [false, true]) it(`retains successful handles after a ${asyncFailure ? 'rejected' : 'throwing'} creation`, async () => {
		const h = harness(), original = h.source.makeChart, gate = deferred();
		let calls = 0;
		h.source.makeChart = (...args) => {
			const i = calls++;
			if (i === 3) {
				if (asyncFailure) return Promise.reject(new Error('tile failed'));
				throw new Error('tile failed');
			}
			const handle = original(...args);
			return i === 19 ? gate.promise.then(() => handle) : handle;
		};
		await prepared(h);
		let finished = false;
		const failure = assert.rejects(h.benchmarkLifecycle.construct(), error => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.errors[0].message, 'tile failed');
			assert.equal(error.message, 'mock: dashboard small-init failed: tile failed');
			assert.equal(error.cause, error.errors[0]);
			finished = true;
			return true;
		});
		await turn();
		assert.equal(calls, 20);
		assert.equal(finished, false, 'wait for late successful handles before cleanup');
		gate.resolve();
		await failure;
		await h.benchmarkLifecycle.destroy();
		assert.equal(h.handles.length, 19);
		assert.ok(h.handles.every(chart => chart.destroyed));
		assert.equal(h.fixture.children.length, 0);
	});

	it('includes non-Error rejection details in the main batch error', async () => {
		const h = harness({overrides: {makeChart() { return Promise.reject('native renderer unavailable'); }}});
		await prepared(h);
		await assert.rejects(h.benchmarkLifecycle.construct(), error => {
			assert.equal(error.message, 'mock: dashboard small-init failed: native renderer unavailable');
			assert.equal(error.cause, 'native renderer unavailable');
			assert.equal(error.errors.length, 20);
			return true;
		});
		await h.benchmarkLifecycle.destroy();
	});

	it('awaits every asynchronous destruction even when one rejects', async () => {
		const h = harness(), gate = deferred();
		await updated(h);
		let calls = 0, finished = false;
		h.source.destroyChart = async chart => {
			calls++;
			if (chart.index === 0) throw new Error('destroy failed');
			await gate.promise;
			chart.destroyed = true;
		};
		const failure = assert.rejects(h.benchmarkLifecycle.destroy(), error => {
					assert.equal(error.message, 'mock: dashboard destruction failed: destroy failed');
					assert.equal(error.cause, error.errors[0]);
					return true;
				}).then(() => { finished = true; });
		await turn();
		assert.equal(calls, 20);
		assert.equal(finished, false);
		assert.equal(h.fixture.children.length, 20);
		gate.resolve();
		await failure;
		assert.ok(h.handles.slice(1).every(chart => chart.destroyed));
		assert.equal(h.fixture.children.length, 0);
	});

	it('enforces phase order, chronological IDs and protocol exclusivity', async () => {
		const h = harness(), lifecycle = h.benchmarkLifecycle;
		await assert.rejects(lifecycle.setup('mock', 'sample-0'), /begin/);
		lifecycle.begin();
		await assert.rejects(lifecycle.setup('other', 'sample-0'), /Unknown/);
		await assert.rejects(lifecycle.setup('mock', 'sample-1'), /Expected sample-0/);
		await lifecycle.setup('mock', 'sample-0');
		await assert.rejects(lifecycle.construct(), /prepared/);
		await assert.rejects(lifecycle.prepare('data-update', 'sample-0'), /Unexpected/);
		await assert.rejects(lifecycle.prepare('small-init', 'sample-7'), /Expected sample-0/);
		await lifecycle.prepare('small-init', 'sample-0');
		await lifecycle.construct();
		await assert.rejects(lifecycle.prepare('data-update', 'sample-0'), /Expected sample-1/);
		await lifecycle.prepare('data-update', 'sample-1');
		await lifecycle.construct();
		await assert.rejects(lifecycle.prepare('resize', 'sample-2'), /Unexpected/);
		await assert.rejects(h.runBenchmarkTrace({raf: true}), /exclusive/);
		await lifecycle.destroy();
		await lifecycle.setup('mock', 'sample-2');
		await lifecycle.destroy();
	});

	it('keeps idle hosts empty and never prepares or constructs data', async () => {
		const h = harness({variant: 'idle'}), lifecycle = h.benchmarkLifecycle;
		lifecycle.begin();
		await lifecycle.setup('idle', 'sample-0');
		for (const [i, operation] of ['small-init', 'data-update'].entries()) {
			await lifecycle.prepare(operation, `sample-${i}`);
			const sample = await lifecycle.construct();
			assert.equal(sample.dataPrepMs, 0);
			assert.equal(h.fixture.children.length, 20);
			assert.ok(h.fixture.children.every(host => host.children.length === 0));
		}
		await lifecycle.destroy();
		assert.ok(!h.events.some(([event]) => ['prep', 'make', 'update', 'validate', 'destroy'].includes(event)));
	});

	it('completes every actual graphics resource across both operations', async () => {
		const h = harness(), original = h.source.makeChart;
		const devices = Array.from({length: 20}, () => ({}));
		h.source.makeChart = (...args) => {
			const chart = original(...args), gl = {isContextLost: () => false};
			chart.getWebGLContexts = () => [gl, gl];
			chart.getWebGPUDevices = () => [devices[chart.index], devices[chart.index]];
			return chart;
		};
		await updated(h);
		assert.deepEqual(h.events.filter(([event]) => event === 'gl-complete').map(([, count]) => count), [20, 20]);
		assert.deepEqual(h.events.filter(([event]) => event === 'gpu-complete').map(([, actual]) => actual), [devices, devices]);
		await h.benchmarkLifecycle.destroy();
	});

	for (const mode of ['lost', 'incomplete', 'missing-observer', 'device-lost']) it(`rejects graphics failure: ${mode}`, async () => {
		const h = harness(), original = h.source.makeChart;
		h.source.makeChart = (...args) => {
			const chart = original(...args);
			chart.getWebGLContexts = () => [{isContextLost: () => mode === 'lost'}];
			if (mode === 'device-lost') chart.getWebGPUDevices = () => [{}];
			return chart;
		};
		if (mode === 'incomplete') h.realm.benchmarkWebGL.complete = async () => ({status: 'incomplete', contexts: [{status: 'context-lost'}]});
		if (mode === 'missing-observer') delete h.realm.benchmarkWebGL;
		if (mode === 'device-lost') h.realm.benchmarkWebGPU.complete = async () => ({status: 'incomplete', devices: [{status: 'device-lost'}]});
		await prepared(h);
		await assert.rejects(h.benchmarkLifecycle.construct(), /WebGL|WebGPU/);
		await h.benchmarkLifecycle.destroy();
		assert.ok(h.handles.every(chart => chart.destroyed));
	});

	it('rejects context-loss events without a handle getter, even in rAF mode', async () => {
		const h = harness(), make = h.source.makeChart;
		h.source.makeChart = (...args) => {
			const chart = make(...args);
			h.fixture.listeners.webglcontextlost();
			return chart;
		};
		await prepared(h, {raf: true});
		await assert.rejects(h.benchmarkLifecycle.construct(), /lost WebGL context/);
		await h.benchmarkLifecycle.destroy();
		assert.ok(h.handles.every(chart => chart.destroyed));
	});

	it('cleans all retained handles after an update rejects or returns a different identity', async () => {
		for (const replacement of [false, true]) {
			const h = harness();
			await prepared(h);
			await h.benchmarkLifecycle.construct();
			const update = h.source.updateChart;
			let calls = 0;
			h.source.updateChart = (...args) => {
				calls++;
				update(...args);
				if (args[0].index === 7) {
					if (replacement) return {};
					return Promise.reject(new Error('update failed'));
				}
			};
			await h.benchmarkLifecycle.prepare('data-update', 'sample-1');
			await assert.rejects(h.benchmarkLifecycle.construct(), error => {
				assert.equal(error.message, 'mock: dashboard data-update failed: ' +
					(replacement ? 'mock: updateChart must retain chart identity.' : 'update failed'));
				assert.equal(error.cause, error.errors[0]);
				return true;
			});
			assert.equal(calls, 20);
			await h.benchmarkLifecycle.destroy();
			assert.ok(h.handles.every(chart => chart.destroyed));
		}
	});

	it('runs deep adapter validation only on explicit inactive-constructed diagnostic calls', async () => {
		const h = harness(), lifecycle = h.benchmarkLifecycle, validate = h.source.validateChart;
		await assert.rejects(lifecycle.validate(), /inactive constructed/);
		await prepared(h);
		await assert.rejects(lifecycle.validate(), /inactive constructed/);
		await lifecycle.construct();
		const nativeError = new Error('native series mismatch');
		h.source.validateChart = async () => { h.outside(); throw nativeError; };
		await assert.rejects(lifecycle.validate(), error => error === nativeError);
		h.source.validateChart = async () => false;
		await assert.rejects(lifecycle.validate(), /chart 0 failed validation/);
		const gate = deferred();
		h.source.validateChart = async (...args) => { await gate.promise; return validate(...args); };
		const before = h.events.length;
		const pending = lifecycle.validate();
		await turn();
		await assert.rejects(lifecycle.validate(), /inactive constructed/);
		await assert.rejects(lifecycle.prepare('data-update', 'sample-1'), /inactive constructed/);
		await assert.rejects(lifecycle.destroy(), /inactive/);
		gate.resolve();
		assert.equal(await pending, true);
		assert.deepEqual(h.events.slice(before), Array.from({length: 20}, () => ['validate', 2]));
		await lifecycle.prepare('data-update', 'sample-1');
		await lifecycle.construct();
		assert.equal(await lifecycle.validate(), true);
		assert.equal(h.events.filter(([event]) => event === 'validate').length, 40);
		await lifecycle.destroy();
		await assert.rejects(lifecycle.validate(), /inactive constructed/);
	});

	it('prepares mutable inputs from canonical frames frozen before capture', async () => {
		const h = harness(), prep = h.source.prepData;
		h.source.prepData = frame => {
			for (const value of [frame, frame.x, frame.ys, ...frame.ys]) assert.ok(Object.isFrozen(value));
			const input = prep(frame);
			assert.equal(Object.isFrozen(input.x), false);
			return input;
		};
		await updated(h);
		await h.benchmarkLifecycle.destroy();
	});

	it('runs browser-driven trace captures without diagnostic verification', async () => {
		const h = harness({overrides: {validateChart: unexpectedValidation}});
		h.benchmarkLifecycle.validate = unexpectedValidation;
		const report = await h.runBenchmarkTrace();
		assert.equal(report.samples.length, 10);
		assert.equal(h.handles.length, 200);
		assert.ok(h.handles.every(chart => chart.destroyed));
	});

	it('checks viewport, visibility, source contract, input and host geometry outside timing', async () => {
		for (const change of [realm => { realm.innerWidth = 1900; }, realm => { realm.innerHeight = 900; },
			realm => { realm.devicePixelRatio = 2; }, realm => { realm.document.visibilityState = 'hidden'; }]) {
			const h = harness();
			change(h.realm);
			assert.throws(() => h.benchmarkLifecycle.begin(), /viewport|DPR|visible/);
		}
		assert.throws(() => harness({overrides: {validateChart: null}}), /requires validateChart/);
		const badInput = harness({overrides: {prepData: () => null}});
		await assert.rejects(prepared(badInput), /prepared input/);
		await badInput.benchmarkLifecycle.destroy();
		const mutated = harness({overrides: {prepData(frame) { frame.x[0] = NaN; return frame; }}});
		await assert.rejects(prepared(mutated), TypeError);
		await mutated.benchmarkLifecycle.destroy();
		const h = harness();
		await prepared(h);
		const make = h.source.makeChart;
		h.source.makeChart = (...args) => {
			const chart = make(...args);
			chart.host.getBoundingClientRect = () => { h.outside(); return {left: 0, top: 0, width: 1920, height: 600}; };
			return chart;
		};
		await assert.rejects(h.benchmarkLifecycle.construct(), /480x216/);
		await h.benchmarkLifecycle.destroy();
	});

	it('runs the shared rAF shape without diagnostics or graphics fences', async () => {
		const h = harness({overrides: {validateChart: unexpectedValidation}});
		h.benchmarkLifecycle.validate = unexpectedValidation;
		const report = await h.runBenchmarkTrace({raf: true});
		assert.equal(report.samples.length, 10);
		assert.equal(report.samples.filter(sample => sample.warmup).length, 3);
		assert.deepEqual(report.samples.flatMap(sample => sample.phases.map(phase => phase.id)), Array.from({length: 20}, (_, i) => `sample-${i}`));
		assert.deepEqual(report.lifecycle.operations, ['small-init', 'data-update']);
		assert.equal(report.raf.frameIntervalsMs.length, 16);
		assert.ok(report.samples.every(sample => sample.raf1Ms >= sample.jsMs && sample.postJsRaf1Ms > 0));
		assert.equal(h.events.filter(([event]) => event === 'timer').length, 60);
		assert.equal(h.events.filter(([event]) => event === 'raf').length, 157);
		assert.equal(h.events.some(([event]) => event.startsWith('gl-') || event === 'gpu-complete'), false);
		const boundaries = h.events.filter(([event]) => event === 'boundary').map(([, value]) => value);
		assert.deepEqual(boundaries, Array.from({length: 60}, (_, i) => ({phase: i % 2 ? 'end' : 'start', variant: 'mock'})));
		assert.equal(h.handles.length, 200);
		assert.ok(h.handles.every(chart => chart.destroyed));
	});

	it('captures memory without diagnostic verification and stops memory/GC before destruction', async () => {
		const h = harness({overrides: {validateChart: unexpectedValidation}});
		h.benchmarkLifecycle.validate = unexpectedValidation;
		let destroyed = false, gc = 0, reads = 0;
		const setup = h.benchmarkLifecycle.setup, destroy = h.benchmarkLifecycle.destroy;
		h.benchmarkLifecycle.setup = async (...args) => { destroyed = false; return setup(...args); };
		h.benchmarkLifecycle.destroy = async () => { destroyed = true; return destroy(); };
		const report = await captureBenchmarkSamples({send(method) {
			assert.equal(method, 'HeapProfiler.collectGarbage');
			assert.equal(destroyed, false);
			gc++;
		}}, (page, expression) => runInNewContext(expression, {benchmarkLifecycle: h.benchmarkLifecycle}), {
			processRead() { assert.equal(destroyed, false); reads++; return {rssBytes: 1000}; },
		});
		assert.equal(report.samples.length, 10);
		assert.equal(report.memoryProtocol, 'through-update-v1');
		assert.equal(report.workload.protocol, 'dashboard-v1');
		assert.equal(gc, 20);
		assert.ok(reads > 20);
		assert.ok(report.samples.every(sample => sample.phases.length === 2 && sample.processObservations.at(-1).phase === 'live'));
		assert.ok(report.samples.every(sample => !sample.processObservations.some(observation => observation.phase === 'cleanup')));
		assert.ok(h.handles.every(chart => chart.destroyed));
	});
});
