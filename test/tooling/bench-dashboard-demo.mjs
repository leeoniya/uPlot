import assert from 'node:assert/strict';
import {access, readFile, readdir} from 'node:fs/promises';
import {checkModuleSyntax} from '../helpers/bench-demo-evaluator.mjs';
import {createDashboardDemo, runDashboardDemo} from '../../bench/dashboard/demo.mjs';
import {benchmarkVariants, demoDependencies} from '../../bench/demo-dependencies.mjs';

const deferred = () => Promise.withResolvers();
const turn = () => new Promise(resolve => setImmediate(resolve));

function harness({variant = 'uplot', overrides = {}} = {}) {
	const events = [], handles = [], waits = [];
	const document = {};
	class Element {
		constructor(tag) {
			this.tagName = tag; this.ownerDocument = document;
			this.children = []; this.style = {}; this.attributes = {};
		}
		append(...nodes) {
			for (const node of nodes) {
				node.remove(); node.parentNode = this; this.children.push(node);
			}
		}
		appendChild(node) { this.append(node); return node; }
		replaceChildren(...nodes) {
			for (const child of [...this.children]) child.remove();
			this.append(...nodes);
		}
		remove() {
			if (this.parentNode) {
				this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
				this.parentNode = null;
			}
		}
		setAttribute(name, value) { this.attributes[name] = value; }
		get isConnected() { return this === document.body || this === document.head || !!this.parentNode?.isConnected; }
		getBoundingClientRect() { throw new Error('Manual demos must not gate on geometry.'); }
	}
	document.createElement = tag => new Element(tag);
	document.body = new Element('body');
	document.head = new Element('head');
	document.fonts = {get ready() { events.push(['fonts']); return Promise.resolve(); }};
	const realm = {document, innerWidth: 1000, innerHeight: 700};
	for (const key of ['performance', 'setTimeout', 'requestAnimationFrame', 'benchmarkWebGL', 'benchmarkWebGPU'])
		Object.defineProperty(realm, key, {get() { throw new Error(`Unexpected capture hook: ${key}`); }});
	const source = {
		async prepareRuntime() { events.push(['source-runtime']); },
		prepData(frame) { events.push(['prep', frame.x.length]); return frame; },
		makeChart(input, host, wait) {
			assert.equal(host.parentNode.children.length, 20);
			assert.equal(wait.isConnected, false);
			assert.equal(input.x.length, 2);
			const chart = {input, host, index: handles.length};
			handles.push(chart); waits.push(wait); events.push(['make', chart.index]);
			const banner = document.createElement('div');
			banner.textContent = 'Native vendor license banner'; host.append(banner);
			return chart;
		},
		updateChart(chart, input, host, wait) {
			assert.equal(host, chart.host); assert.equal(wait, waits[chart.index]);
			assert.notEqual(input, chart.input); assert.equal(input.x.length, 300);
			assert.equal(input.ys.length, 5);
			chart.input = input; events.push(['update', chart.index]);
			return chart;
		},
		validateChart(chart, input, options) {
			assert.equal(chart.input, input); assert.deepEqual(options, {rows: 300});
			events.push(['validate', chart.index]); return true;
		},
		destroyChart(chart) { events.push(['destroy', chart.index]); chart.destroyed = true; },
		...overrides,
	};
	const options = {variant, realm,
		async load(dependency) { events.push(['load', dependency]); },
		async prepareRuntime(id) { assert.equal(id, variant); events.push(['runtime', id]); },
	};
	return {document, realm, events, handles, waits, source, options,
		run: () => createDashboardDemo(source, options),
		count: name => events.filter(([event]) => event === name).length,
	};
}

function assertFailureUI(h, pattern) {
	assert.equal(h.document.head.children.length, 0, 'layout style is removed');
	assert.equal(h.document.body.children.length, 1, 'only the error remains');
	const status = h.document.body.children[0];
	assert.equal(status.attributes.role, 'alert');
	assert.equal(status.style.position, 'fixed');
	assert.match(status.textContent, pattern);
}

describe('dashboard manual demo', () => {
	it('has adapters for all 44 baseline variants plus LightningChart', async () => {
		assert.equal(benchmarkVariants.length, 44);
		for (const variant of [...benchmarkVariants, 'lightningchart']) {
			await access(new URL(`../../bench/dashboard/${variant}.mjs`, import.meta.url));
			assert.ok(Object.hasOwn(demoDependencies, variant));
		}
	});

	it('provides a matched HTML entry and index link for every dashboard adapter', async () => {
		const directory = new URL('../../bench/dashboard/', import.meta.url);
		const variants = [...benchmarkVariants, 'lightningchart'];
		const index = await readFile(new URL('index.html', directory), 'utf8');
		assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.html')).sort(),
			['index.html', ...variants.map(id => `${id}.html`)].sort());
		const links = [...index.matchAll(/href="([^"]+\.html)"/g)].map(match => match[1]);
		assert.deepEqual(links.sort(), variants.map(id => `${id}.html`).sort());
		for (const variant of variants) {
			const html = await readFile(new URL(`${variant}.html`, directory), 'utf8');
			assert.match(html, /<!doctype html>/i);
			assert.ok(html.includes(`<title>${variant} Dashboard</title>`));
			const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
			assert.equal(scripts.length, 1);
			checkModuleSyntax(scripts[0][1]);
			assert.ok(scripts[0][1].includes('from "./demo.mjs"'));
			assert.ok(scripts[0][1].includes(`runDashboardDemo("${variant}")`));
			assert.match(scripts[0][1], /globalThis\.dashboardDemo = demo/);
			assert.match(scripts[0][1], /\.catch\(console\.error\)/);
		}
	});

	it('loads scripts/styles in order, then runtime, source runtime, and fonts before data', async () => {
		const h = harness();
		const demo = await h.run();
		assert.deepEqual(h.events.slice(0, 5), [
			...demoDependencies.uplot.map(dependency => ['load', dependency]),
			['runtime', 'uplot'], ['source-runtime'], ['fonts'],
		]);
		assert.deepEqual(h.events.filter(([event]) => event === 'prep').map(([, rows]) => rows),
			[...Array(20).fill(2), ...Array(20).fill(300)]);
		assert.equal(h.count('validate'), 0);
		assert.equal(demo.variant, 'uplot');
		assert.deepEqual(demo.charts, h.handles);
		assert.deepEqual(demo.hosts, h.handles.map(chart => chart.host));
		assert.deepEqual(demo.inputs, h.handles.map(chart => chart.input));
		assert.equal(new Set(demo.inputs.map(input => input.x)).size, 20);
		assert.equal(new Set(demo.inputs.flatMap(input => input.ys)).size, 100);
		assert.equal(new Set(demo.hosts.map(host => host.id)).size, 20);
		assert.equal(h.document.body.children.length, 1, 'successful demo has no status overlay');
		assert.ok(demo.hosts.every(host => host.isConnected));
		assert.ok(demo.hosts.every(host => host.children[0].textContent === 'Native vendor license banner'));
		const css = h.document.head.children[0].textContent;
		assert.match(css, /pointer-events:\s*auto/);
		assert.doesNotMatch(css, /pointer-events:\s*none/);
		assert.match(css, /repeat\(4, 480px\)/);
		assert.match(css, /repeat\(5, 216px\)/);
		assert.equal(await demo.validate(), true);
		assert.equal(h.count('validate'), 20);
		await demo.destroy();
		assert.equal(h.count('destroy'), 20);
		assert.equal(h.document.body.children.length, 0);
		assert.equal(h.document.head.children.length, 0);
		await assert.rejects(demo.validate(), /destroyed dashboard/);
	});

	for (const variant of ['scichart', 'chartgpu', 'recharts']) {
		it(`delegates ${variant} WASM/modules to the normal demo runtime`, async () => {
			const h = harness({variant}), runtime = deferred();
			h.options.prepareRuntime = async id => { h.events.push(['runtime', id]); await runtime.promise; };
			const pending = h.run();
			await turn();
			assert.deepEqual(h.events.filter(([event]) => event === 'load').map(([, dependency]) => dependency),
				demoDependencies[variant].filter(dependency => !['wasm', 'module'].includes(dependency.type)));
			assert.equal(h.count('runtime'), 1);
			assert.equal(h.count('source-runtime'), 0);
			assert.equal(h.count('make'), 0);
			runtime.resolve();
			const demo = await pending;
			assert.equal(h.count('source-runtime'), 1);
			await demo.destroy();
		});
	}

	it('waits for source runtime and fonts before constructing any charts', async () => {
		const h = harness(), runtime = deferred(), fonts = deferred();
		h.source.prepareRuntime = () => runtime.promise;
		h.document.fonts = {ready: fonts.promise};
		const pending = h.run();
		await turn(); assert.equal(h.count('make'), 0);
		runtime.resolve(); await turn(); assert.equal(h.count('make'), 0);
		fonts.resolve(); const demo = await pending;
		assert.equal(h.count('make'), 20);
		await demo.destroy();
	});

	it('starts all 20 constructors and then all 20 updates concurrently, retaining identity', async () => {
		const h = harness(), made = Array.from({length: 20}, deferred), updated = Array.from({length: 20}, deferred);
		const make = h.source.makeChart, update = h.source.updateChart;
		h.source.makeChart = async (...args) => {
			const chart = make(...args); await made[chart.index].promise; return chart;
		};
		h.source.updateChart = async (...args) => { update(...args); await updated[args[0].index].promise; };
		const pending = h.run();
		await turn(); assert.equal(h.count('make'), 20); assert.equal(h.count('update'), 0);
		for (const gate of made.slice(1)) gate.resolve();
		await turn(); assert.equal(h.count('update'), 0);
		made[0].resolve(); await turn(); assert.equal(h.count('update'), 20);
		assert.equal(h.count('validate'), 0);
		for (const gate of updated) gate.resolve();
		const demo = await pending;
		assert.deepEqual(demo.charts, h.handles); assert.equal(h.count('make'), 20);
		await demo.destroy();
	});

	it('retains late successful constructors and cleans them up after a sibling throws', async () => {
		const h = harness(), late = deferred(), cleanup = deferred(), native = new Error('native allocation failed');
		const make = h.source.makeChart;
		let calls = 0;
		h.source.makeChart = (...args) => {
			if (calls++ === 0) throw native;
			const chart = make(...args);
			return late.promise.then(() => chart);
		};
		h.source.destroyChart = async chart => { h.events.push(['destroy', chart.index]); await cleanup.promise; };
		const pending = h.run();
		const rejection = assert.rejects(pending, error => error.cause === native);
		await turn(); assert.equal(calls, 20); assert.equal(h.count('destroy'), 0);
		late.resolve(); await turn(); assert.equal(h.count('destroy'), 19);
		assert.equal(h.count('update'), 0); assert.equal(h.count('validate'), 0);
		assert.equal(h.document.body.children.length, 2, 'cleanup completes before removing the grid');
		cleanup.resolve(); await rejection;
		assertFailureUI(h, /native allocation failed/);
	});

	it('waits for sibling updates and preserves the native error even if cleanup also fails', async () => {
		const h = harness(), late = deferred(), native = new Error('GPU device lost'), cleanup = new Error('dispose failed');
		const update = h.source.updateChart;
		h.source.updateChart = async (...args) => {
			update(...args);
			if (args[0].index === 0) throw native;
			await late.promise;
		};
		h.source.destroyChart = chart => {
			h.events.push(['destroy', chart.index]);
			if (chart.index === 0) throw cleanup;
		};
		const rejection = assert.rejects(h.run(), error => {
			assert.equal(error.cause.cause, native);
			assert.equal(error.errors[1].cause, cleanup);
			return true;
		});
		await turn(); assert.equal(h.count('update'), 20); assert.equal(h.count('destroy'), 0);
		late.resolve(); await rejection;
		assert.equal(h.count('destroy'), 20);
		assertFailureUI(h, /GPU device lost.*dispose failed/);
	});

	it('makes destroy idempotent, awaits all cleanups, and removes layout even on failure', async () => {
		const h = harness(), late = deferred(), native = new Error('native destroy failed');
		h.source.destroyChart = async chart => {
			h.events.push(['destroy', chart.index]);
			if (chart.index === 0) throw native;
			await late.promise;
		};
		const demo = await h.run(), first = demo.destroy();
		assert.equal(demo.destroy(), first);
		const rejection = assert.rejects(first, error => error.cause === native);
		await turn(); assert.equal(h.count('destroy'), 20);
		assert.ok(demo.hosts.every(host => host.isConnected));
		late.resolve(); await rejection;
		assert.equal(demo.destroy(), first);
		assert.equal(h.document.head.children.length, 0); assert.equal(h.document.body.children.length, 0);
	});

	for (const phase of ['load', 'prepareRuntime', 'sourceRuntime', 'fonts', 'prepData']) {
		it(`cleans the layout and displays ${phase} errors`, async () => {
			const h = harness(), native = new Error(`${phase} native failure`);
			const fail = () => { throw native; };
			if (phase === 'load' || phase === 'prepareRuntime') h.options[phase] = fail;
			else if (phase === 'fonts') Object.defineProperty(h.document.fonts, 'ready', {get: fail});
			else h.source[phase === 'sourceRuntime' ? 'prepareRuntime' : phase] = fail;
			await assert.rejects(h.run(), error => error === native);
			assert.equal(h.count('make'), 0);
			assertFailureUI(h, new RegExp(`${phase} native failure`));
		});
	}

	it('rejects missing handles, replacement handles, and explicit validation failures', async () => {
		const missing = harness({overrides: {makeChart() { return null; }}});
		await assert.rejects(missing.run(), /returned no handle/);
		assert.equal(missing.count('update'), 0);
		const replacement = harness({overrides: {updateChart() { return {}; }}});
		await assert.rejects(replacement.run(), /retain chart identity/);
		assert.equal(replacement.count('destroy'), 20);
		const invalid = harness({overrides: {validateChart() { return false; }}});
		const demo = await invalid.run();
		await assert.rejects(demo.validate(), /failed validation/);
		assert.ok(demo.hosts.every(host => host.isConnected), 'explicit validation does not destroy the visual');
		await demo.destroy();
	});

	it('uses demo license availability and allows LightningChart when configured', async () => {
		const h = harness({variant: 'lightningchart'});
		await assert.rejects(h.run(), /vendor-issued runtime license/);
		assert.equal(h.count('load'), 0);
		h.realm.benchmarkLightningChartOptions = {license: 'test-only-license'};
		const demo = await h.run();
		assert.equal(h.count('make'), 20);
		await demo.destroy();
	});

	it('requires a real dashboard adapter, not just a single-chart dependency entry', async () => {
		for (const variant of ['googlecharts', 'jscharting', 'g2-webgl']) {
			const h = harness({variant});
			await assert.rejects(createDashboardDemo(null, h.options), /Cannot find module/);
			assertFailureUI(h, /Cannot find module/);
		}
	});

	it('rejects unknown and unsafe facade variants with a visible error', async () => {
		const h = harness(), previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
		Object.defineProperty(globalThis, 'document', {configurable: true, value: h.document});
		try {
			for (const variant of ['idle', '../uplot', 'constructor', 'missing']) {
				await assert.rejects(runDashboardDemo(variant), /Unknown .*variant/);
				assertFailureUI(h, /Unknown .*variant/);
			}
		}
		finally {
			if (previous) Object.defineProperty(globalThis, 'document', previous);
			else delete globalThis.document;
		}
	});

	it('does not install measurement capture, timers, viewport gates, or benchmark restrictions', async () => {
		const text = await readFile(new URL('../../bench/dashboard/demo.mjs', import.meta.url), 'utf8');
		assert.doesNotMatch(text, /assertBenchmarkAvailable|benchmarkRestrictions|performance\.|setTimeout|setInterval|requestAnimationFrame|innerWidth|innerHeight|benchmarkWebGL|benchmarkWebGPU/);
	});
});
