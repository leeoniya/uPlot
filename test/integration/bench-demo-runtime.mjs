import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import { demoDependencies, benchmarkVariants, benchmarkRestrictions, assertBenchmarkAvailable, dependencyUrl } from '../../bench/demo-dependencies.mjs';
import * as hover from '../../bench/hover.mjs';

let moduleId = 0;
const runtimeUrl = new URL('../../bench/demo-runtime.mjs', import.meta.url);
const runtimeSource = readFileSync(runtimeUrl, 'utf8')
	.replace("'./demo-dependencies.mjs'", JSON.stringify(new URL('../../bench/demo-dependencies.mjs', import.meta.url).href))
	.replaceAll('import.meta.url', JSON.stringify(runtimeUrl.href));
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(`// test=${++moduleId}\n${source}\nexport {};`).toString('base64');
const binary = (path, option = 'wasmBinary') => ({path, type: 'wasm', option});
const moduleDependency = (source, extra = {}) => Object.freeze({
	type: 'module', global: 'benchmarkTestModule',
	// Keep cache-busting inside the payload: Bun parses data-URL fragments as source.
	url: moduleUrl(source),
	...extra,
});

// Run only unmeasured startup, stopping before packed-data validation and lifecycle setup.
function traceStartup(variant, {fetch, prepareDemoRuntime, adapter, globals = {}}) {
	const source = readFileSync(new URL('../../scripts/benchmarks-trace-browser.mjs', import.meta.url), 'utf8');
	const start = source.indexOf("const {setupDemo} = await import('/bench/demo-fixture.mjs');");
	const end = source.indexOf('const ROWS =', start);
	assert.ok(start >= 0 && end > start);
	const context = {
		...globals, VARIANTS: [variant], selectedVariant: variant, demoDependencies, fetch,
		async importModule(url) {
			if (url === '/bench/demo-fixture.mjs') return {setupDemo() { assert.fail('startup must not create chart hosts'); }};
			if (url === '/bench/lifecycle-data.mjs') return {};
			if (url === '/bench/hover.mjs') return hover;
			if (url === '/bench/demo-runtime.mjs') return {prepareDemoRuntime: (...args) => prepareDemoRuntime(...args, context)};
			assert.equal(url, `/bench/${variant}.mjs`);
			return {

				updateChart() { assert.fail('startup must not update'); },
				resizeChart() { assert.fail('startup must not resize'); },
				getHoverPlan() { assert.fail('startup must not prepare hover'); },
				...adapter,
			};
		},
	};
	return runInNewContext(`(async () => {\n${source.slice(start, end).replace(/\bimport\(/g, 'importModule(')}\n})()`, context);
}

describe('shared benchmark binary and module runtime', () => {
	let prepareDemoRuntime, saved;
	const keys = ['fetch', 'benchmarkSciChartOptions', 'WebAssembly',
			'benchmarkTestModule', 'benchmarkTestSecond', 'benchmarkTestGate', 'benchmarkTestEvents', 'benchmarkTestError'];

	beforeEach(async () => {
		saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
		delete globalThis.benchmarkSciChartOptions;
		globalThis.fetch = () => assert.fail('unexpected download');
		globalThis.WebAssembly = new Proxy({}, {get() { assert.fail('prefetch must not compile or instantiate WASM'); }});
		// Bun reuses query-only cache keys at a dynamic import call site. Unique
		// payloads isolate the runtime cache while retaining its original URL base.
		({prepareDemoRuntime} = await import(moduleUrl(runtimeSource)));
	});

	afterEach(() => {
		keys.forEach((key, i) => {
			if (saved[i]) Object.defineProperty(globalThis, key, saved[i]);
			else delete globalThis[key];
		});
	});

	it('imports without side effects and skips scripts and styles without importing remote modules', async () => {
		assert.equal(Object.hasOwn(globalThis, 'benchmarkSciChartOptions'), false);
		for (const variant of Object.keys(demoDependencies))
			await prepareDemoRuntime(variant, demoDependencies[variant].filter(dep => dep.type !== 'wasm' && dep.type !== 'module'));
		await prepareDemoRuntime('scichart', [
			{path: 'vendor.js'}, {path: 'vendor.css', type: 'style'},
		]);
		assert.equal(Object.hasOwn(globalThis, 'benchmarkSciChartOptions'), false);
	});

	it('assigns the complete ESM namespace, including default, without unwrapping it or changing metadata', async () => {
		const dependency = moduleDependency('export default {kind: "default"}; export const named = {kind: "named"};');
		const dependencies = Object.freeze([dependency]);
		const original = {...dependency};
		await prepareDemoRuntime('recharts', dependencies);
		const namespace = await import(dependency.url);
		assert.equal(globalThis.benchmarkTestModule, namespace);
		assert.deepEqual(namespace.default, {kind: 'default'});
		assert.deepEqual(namespace.named, {kind: 'named'});
		assert.deepEqual(dependency, original);
		assert.equal(Object.hasOwn(globalThis, 'benchmarkSciChartOptions'), false);
	});

	it('selects named bundle exports while sharing a single evaluated module and React identity', async () => {
		globalThis.benchmarkTestEvents = [];
		const first = moduleDependency(`
			globalThis.benchmarkTestEvents.push('evaluate');
			const react = {};
			export const reactNamespace = {react};
			export const chartNamespace = {react};
		`, {export: 'reactNamespace'});
		const second = Object.freeze({...first, global: 'benchmarkTestSecond', export: 'chartNamespace'});
		await Promise.all([
			prepareDemoRuntime('recharts', [first, second]),
			prepareDemoRuntime('recharts', [first, second]),
		]);
		assert.deepEqual(globalThis.benchmarkTestEvents, ['evaluate']);
		assert.equal(globalThis.benchmarkTestModule, (await import(first.url)).reactNamespace);
		assert.equal(globalThis.benchmarkTestSecond, (await import(first.url)).chartNamespace);
		assert.equal(globalThis.benchmarkTestModule.react, globalThis.benchmarkTestSecond.react);
		delete globalThis.benchmarkTestModule;
		await prepareDemoRuntime('recharts', [first]);
		assert.equal(globalThis.benchmarkTestModule.react, globalThis.benchmarkTestSecond.react);
		assert.deepEqual(globalThis.benchmarkTestEvents, ['evaluate']);
	});

	it('awaits module evaluation and assigns globals in dependency order', async () => {
		const {promise, resolve} = Promise.withResolvers();
		globalThis.benchmarkTestGate = promise;
		globalThis.benchmarkTestEvents = [];
		const original = globalThis.benchmarkTestModule = {};
		const first = moduleDependency('globalThis.benchmarkTestEvents.push("start"); await globalThis.benchmarkTestGate; export const ready = true;');
		const second = moduleDependency('export const first = globalThis.benchmarkTestModule;', {global: 'benchmarkTestSecond'});
		let finished = false;
		const pending = prepareDemoRuntime('recharts', [first, second]).then(() => { finished = true; });
		for (let i = 0; globalThis.benchmarkTestEvents.length === 0 && i < 100; i++) await new Promise(setImmediate);
		assert.deepEqual(globalThis.benchmarkTestEvents, ['start']);
		assert.equal(globalThis.benchmarkTestModule, original);
		assert.equal(finished, false);
		resolve();
		await pending;
		assert.equal(globalThis.benchmarkTestModule.ready, true);
		assert.equal(globalThis.benchmarkTestSecond.first, globalThis.benchmarkTestModule);
	});

	for (const extra of [{export: 'absent'}, {export: 'empty'}, {global: ''}, {global: undefined}]) {
		it(`rejects invalid namespace configuration ${JSON.stringify(extra)} without overwriting globals`, async () => {
			const dependency = moduleDependency('export const empty = null;', extra);
			const original = globalThis.benchmarkTestModule = {};
			await assert.rejects(prepareDemoRuntime('recharts', [dependency]), error =>
				error.message === `Missing module namespace for ${dependency.global}: ${dependency.url}`);
			assert.equal(globalThis.benchmarkTestModule, original);
		});
	}

	it('propagates module evaluation errors and stops before later imports or binary downloads', async () => {
		const error = globalThis.benchmarkTestError = new Error('module evaluation failed');
		const original = globalThis.benchmarkTestModule = {};
		const good = moduleDependency('export const ready = true;', {global: 'benchmarkTestSecond'});
		const bad = moduleDependency('throw globalThis.benchmarkTestError;');
		await assert.rejects(prepareDemoRuntime('recharts', [good, bad, binary('never.wasm')]), actual => actual === error);
		assert.equal(globalThis.benchmarkTestSecond.ready, true);
		assert.equal(globalThis.benchmarkTestModule, original);
		assert.equal(Object.hasOwn(globalThis, 'benchmarkSciChartOptions'), false);
		const invalid = moduleDependency('export const = ;');
		const parseError = await import(invalid.url).catch(error => error);
		assert.ok(parseError instanceof Error);
		// Node reports SyntaxError; Bun can aggregate multiple parser diagnostics.
		await assert.rejects(prepareDemoRuntime('recharts', [invalid]), {
			name: parseError.name, message: parseError.message,
		});
	});

	it('downloads both manifest WASM files as buffers and preserves existing SciChart options', async () => {
		const licenseInformation = Object.freeze({appTitle: 'benchmark'});
		const options = {runtimeLicenseKey: 'test', licenseInformation, timeoutMs: 1234};
		globalThis.benchmarkSciChartOptions = options;
		const dependencies = demoDependencies.scichart.filter(dep => dep.type === 'wasm');
		assert.deepEqual(dependencies.map(dep => dep.option), ['wasmBinary', 'wasmNoSimdBinary']);
		const buffers = dependencies.map((_, i) => Uint8Array.of(0, 97, 115, 109, 128, 255, i).buffer);
		const downloads = [], reads = [];
		globalThis.fetch = async url => {
			const index = downloads.length;
			downloads.push(url);
			return {ok: true, arrayBuffer: async () => { reads.push(url); return buffers[index]; }};
		};
		await prepareDemoRuntime('scichart');
		assert.deepEqual(downloads, dependencies.map(dep => dependencyUrl(dep)));
		assert.deepEqual(reads, downloads);
		assert.equal(globalThis.benchmarkSciChartOptions, options);
		assert.deepEqual(options, {runtimeLicenseKey: 'test', licenseInformation, timeoutMs: 1234,
			wasmBinary: buffers[0], wasmNoSimdBinary: buffers[1]});
		assert.equal(options.licenseInformation, licenseInformation);
		for (let i = 0; i < dependencies.length; i++)
			assert.equal(options[dependencies[i].option], buffers[i]);

		globalThis.fetch = () => assert.fail('cached bytes must not be downloaded again');
		delete globalThis.benchmarkSciChartOptions;
		await prepareDemoRuntime('scichart');
		assert.notEqual(globalThis.benchmarkSciChartOptions, options);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmBinary, buffers[0]);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmNoSimdBinary, buffers[1]);
	});

	it('awaits the full body and deduplicates concurrent downloads by resolved URL, not option name', async () => {
		let finishBody, downloads = 0, reads = 0, completed = 0;
		const body = new Promise(resolve => { finishBody = resolve; });
		globalThis.fetch = async () => {
			downloads++;
			return {ok: true, arrayBuffer() { reads++; return body; }};
		};
		const first = prepareDemoRuntime('scichart', [binary('./shared.wasm')]).then(() => { completed++; });
		const second = prepareDemoRuntime('scichart', [binary('shared.wasm', 'wasmNoSimdBinary')]).then(() => { completed++; });
		await Promise.resolve();
		assert.equal(downloads, 1);
		assert.equal(reads, 1);
		assert.equal(completed, 0);
		assert.equal(Object.hasOwn(globalThis, 'benchmarkSciChartOptions'), false);
		const bytes = Uint8Array.of(0, 255, 128).buffer;
		finishBody(bytes);
		await Promise.all([first, second]);
		assert.equal(completed, 2);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmBinary, bytes);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmNoSimdBinary, bytes);
	});

	it('uses rewritten worker URLs and option names without mutating dependency metadata', async () => {
		const dependency = Object.freeze({name: 'scichart', version: '6.0.14', path: '_wasm/scichart.wasm',
			type: 'wasm', option: 'wasmBinary', url: '/bench/vendor/scichart-6.0.14-_wasm-scichart.wasm',
			route: '/bench/vendor/scichart-6.0.14-_wasm-scichart.wasm', cacheName: 'scichart-6.0.14-_wasm-scichart.wasm'});
		const bytes = new ArrayBuffer(8);
		globalThis.fetch = async url => {
			assert.equal(url, dependency.route);
			return {ok: true, arrayBuffer: async () => bytes};
		};
		await prepareDemoRuntime('scichart', Object.freeze([dependency]));
		assert.equal(globalThis.benchmarkSciChartOptions.wasmBinary, bytes);
	});

	for (const failure of ['HTTP', 'network', 'body']) {
		it(`evicts a failed ${failure} download so a retry can succeed without losing options`, async () => {
			const dependency = binary('retry.wasm');
			const url = new URL(dependency.path, runtimeUrl).href;
			const original = new ArrayBuffer(1);
			const options = {wasmBinary: original, runtimeLicenseKey: 'test'};
			globalThis.benchmarkSciChartOptions = options;
			const error = new Error(`${failure} failure`);
			let downloads = 0;
			globalThis.fetch = async requested => {
				assert.equal(requested, url);
				downloads++;
				if (failure === 'network') throw error;
				return {ok: failure !== 'HTTP', status: 503, arrayBuffer: async () => {
					assert.notEqual(failure, 'HTTP', 'do not read an unsuccessful response body');
					throw error;
				}};
			};
			const results = await Promise.allSettled([
				prepareDemoRuntime('scichart', [dependency]), prepareDemoRuntime('scichart', [dependency]),
			]);
			assert.equal(downloads, 1);
			for (const result of results) {
				assert.equal(result.status, 'rejected');
				if (failure === 'HTTP') assert.equal(result.reason.message, `Failed to load ${url}: HTTP 503`);
				else assert.equal(result.reason, error);
			}
			assert.equal(globalThis.benchmarkSciChartOptions, options);
			assert.deepEqual(options, {wasmBinary: original, runtimeLicenseKey: 'test'});
			const bytes = new ArrayBuffer(8);
			globalThis.fetch = async () => { downloads++; return {ok: true, arrayBuffer: async () => bytes}; };
			await prepareDemoRuntime('scichart', [dependency]);
			await prepareDemoRuntime('scichart', [dependency]);
			assert.equal(downloads, 2);
			assert.equal(options.wasmBinary, bytes);
			assert.equal(options.runtimeLicenseKey, 'test');
		});
	}

	it('retains a successful binary when a later dependency fails and retries only the failed URL', async () => {
		const dependencies = [binary('first.wasm'), binary('second.wasm', 'wasmNoSimdBinary')];
		const urls = dependencies.map(dep => dependencyUrl(dep, runtimeUrl));
		const buffers = [new ArrayBuffer(1), new ArrayBuffer(2)];
		const downloads = [];
		let failing = true;
		globalThis.fetch = async url => {
			downloads.push(url);
			const index = urls.indexOf(url);
			return {ok: index === 0 || !failing, status: 404, arrayBuffer: async () => buffers[index]};
		};
		await assert.rejects(prepareDemoRuntime('scichart', dependencies), /HTTP 404/);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmBinary, buffers[0]);
		assert.equal(Object.hasOwn(globalThis.benchmarkSciChartOptions, 'wasmNoSimdBinary'), false);
		failing = false;
		await prepareDemoRuntime('scichart', dependencies);
		assert.deepEqual(downloads, [urls[0], urls[1], urls[1]]);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmBinary, buffers[0]);
		assert.equal(globalThis.benchmarkSciChartOptions.wasmNoSimdBinary, buffers[1]);
	});

	it('rejects unsupported binary runtime configuration instead of assigning SciChart options', async () => {
		globalThis.fetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(1)});
		await assert.rejects(prepareDemoRuntime('d3', [binary('unsupported.wasm')]), /No binary runtime configuration for d3/);
		assert.equal(Object.hasOwn(globalThis, 'benchmarkSciChartOptions'), false);
	});
});

describe('benchmark trace availability checks', () => {
	function check(variant, lightningOptions) {
		const source = readFileSync(new URL('../../scripts/benchmarks-trace-browser.mjs', import.meta.url), 'utf8');
		const start = source.indexOf('const selectedVariant =');
		const end = source.indexOf('const WARMUPS =', start);
		assert.ok(start >= 0 && end > start);
		return runInNewContext(`(async () => {\n${source.slice(start, end).replace(/\bimport\(/g, 'importModule(')}\nreturn VARIANTS;\n})()`, {
			URL, location: {href: 'https://example.test/' + (variant ? '?variant=' + variant : '')},
			devicePixelRatio: 1, uPlot() {}, benchmarkLightningChartOptions: lightningOptions,
			async importModule(url) {
				assert.equal(url, '/bench/demo-dependencies.mjs');
				return {demoDependencies, benchmarkVariants, assertBenchmarkAvailable};
			},
			fetch() { assert.fail('availability checks must precede data or runtime requests'); },
			document: new Proxy({}, {get() { assert.fail('availability checks must precede fixture creation'); }}),
		});
	}

	it('rejects JSCharting before fixture/runtime setup', async () => {
		await assert.rejects(check('jscharting'), error =>
			error.message === `jscharting: ${benchmarkRestrictions.jscharting}`);
	});

	it('requires a nonblank LightningChart license and permits an explicitly licensed run', async () => {
		for (const options of [undefined, {}, {license: ''}, {license: '  '}])
			await assert.rejects(check('lightningchart', options), /LIGHTNINGCHART_LICENSE/);
		assert.deepEqual([...await check('lightningchart', {license: 'test'})], ['lightningchart']);
	});

	for (const id of ['apexcharts', 'amcharts', 'devextreme', 'anychart', 'fusiontime']) {
		it(`permits explicitly selected ${id}-sampled`, async () => {
			assert.deepEqual([...await check(id + '-sampled')], [id + '-sampled']);
		});
	}

	it('checks both base and sampled ApexCharts/amCharts dependencies before fixture setup', () => {
		const source = readFileSync(new URL('../../scripts/benchmarks-trace-browser.mjs', import.meta.url), 'utf8');
		const checks = source.slice(source.indexOf("if (typeof Path2D"), source.indexOf('const fixture ='));
		for (const id of ['apexcharts', 'amcharts']) {
			const runtime = id === 'apexcharts' ? {ApexCharts() {}} : {am5: {Root: {}}, am5xy: {XYChart: {}}};
			for (const variant of [id, id + '-sampled']) {
				const context = {VARIANTS: [variant], Path2D() {}};
				assert.throws(() => runInNewContext(checks, context), /Load the selected demo libraries/);
				assert.doesNotThrow(() => runInNewContext(checks, {...context, ...runtime}));
				if (id === 'amcharts') {
					for (const key of ['am5', 'am5xy'])
						assert.throws(() => runInNewContext(checks, {...context, ...runtime, [key]: undefined}), /Load the selected demo libraries/);
				}
			}
		}
	});

	for (const id of ['chartgpu', 'deckgl']) {
		it(`permits explicitly selected ${id}`, async () => {
			assert.deepEqual([...await check(id)], [id]);
		});
	}

	it('rejects timeout-prone variants before fixture/runtime setup', async () => {
		for (const variant of ['g2-webgl', 'googlecharts'])
			await assert.rejects(check(variant), error =>
				error.message === `${variant}: ${benchmarkRestrictions[variant]}`);
	});

	it('defaults to the 44 runnable variants plus idle, without restricted adapters', async () => {
		const selected = [...await check(null)];
		assert.deepEqual(selected, [...benchmarkVariants, 'idle']);
		assert.equal(selected.length, 45);
		assert.equal(selected.includes('g2-webgl'), false);
		assert.equal(selected.includes('googlecharts'), false);
		assert.equal(selected.includes('jscharting'), false);
		assert.equal(selected.includes('lightningchart'), false);
		assert.equal(selected.includes('chartgpu'), true);
		assert.equal(selected.includes('deckgl'), true);
	});
});

describe('unmeasured benchmark trace startup', () => {
	const noChartWork = {
		prepData() { assert.fail('startup must not prepare chart data'); },
		makeChart() { assert.fail('startup must not construct a chart'); },
	};

	it('awaits the Google preparation hook before raw data fetch and any measured lifecycle work', async () => {
		const {promise, resolve} = Promise.withResolvers();
		const order = [];
		const pending = traceStartup('googlecharts', {
			prepareDemoRuntime() { assert.fail('Google uses its adapter hook, not binary/module prefetch'); },
			adapter: {...noChartWork, async prepareRuntime() {
				order.push('prepare-runtime');
				await promise;
				order.push('runtime-ready');
			}},
			async fetch(url) {
				assert.equal(url, '/bench/data.json');
				order.push('data');
				return {ok: true, json: async () => []};
			},
		});
		for (let i = 0; order.length === 0 && i < 100; i++) await Promise.resolve();
		try { assert.deepEqual(order, ['prepare-runtime']); }
		finally { resolve(); await pending; }
		assert.deepEqual(order, ['prepare-runtime', 'runtime-ready', 'data']);
	});

	it('propagates Google hook rejection without fetching data', async () => {
		const error = new Error('corechart preparation failed');
		await assert.rejects(traceStartup('googlecharts', {
			prepareDemoRuntime() { assert.fail('unexpected runtime prefetch'); },
			adapter: {...noChartWork, async prepareRuntime() { throw error; }},
			fetch() { assert.fail('data must wait for successful preparation'); },
		}), actual => actual === error);
	});

	it('checks the ChartGPU namespace only after awaited module assignment', async () => {
		const {promise, resolve} = Promise.withResolvers();
		const order = [];
		const pending = traceStartup('chartgpu', {
			adapter: noChartWork,
			async fetch(url) {
				order.push(url);
				return {ok: true, json: async () => []};
			},
			async prepareDemoRuntime(variant, assets, realm) {
				assert.equal(variant, 'chartgpu');
				order.push('module-import');
				await promise;
				realm.benchmarkChartGPU = {ChartGPU: {create() { assert.fail('startup must not create charts'); }}};
				order.push('module-ready');
			},
		});
		for (let i = 0; !order.includes('module-import') && i < 100; i++) await Promise.resolve();
		try { assert.deepEqual(order, ['/bench/module-assets.json', 'module-import']); }
		finally { resolve(); await pending; }
		assert.deepEqual(order, ['/bench/module-assets.json', 'module-import', 'module-ready', '/bench/data.json']);
	});

	for (const namespace of [undefined, {}, {ChartGPU: {}}, {default: {ChartGPU: {create() {}}}}]) {
		it('rejects a missing or invalid ChartGPU export before adapter/data work', async () => {
			await assert.rejects(traceStartup('chartgpu', {
				globals: {benchmarkChartGPU: namespace},
				adapter: {...noChartWork, prepareRuntime() { assert.fail('invalid runtime'); }},
				async prepareDemoRuntime() {},
				async fetch(url) {
					assert.equal(url, '/bench/module-assets.json');
					return {ok: true, json: async () => []};
				},
			}), /benchmarkChartGPU.ChartGPU.create/);
		});
	}

	it('loads rewritten module assets and awaits module assignment before data fetch', async () => {
		const assets = Object.freeze([{type: 'module', global: 'benchmarkReact', export: 'benchmarkReact', url: '/bench/vendor/modules-test.mjs'}]);
		const {promise, resolve} = Promise.withResolvers();
		const order = [];
		const pending = traceStartup('recharts', {
			adapter: noChartWork,
			async fetch(url) {
				order.push(url);
				if (url === '/bench/module-assets.json') return {ok: true, json: async () => assets};
				assert.equal(url, '/bench/data.json');
				return {ok: true, json: async () => []};
			},
			async prepareDemoRuntime(variant, dependencies) {
				assert.equal(variant, 'recharts');
				assert.equal(dependencies, assets);
				order.push('module-import');
				await promise;
				order.push('module-ready');
			},
		});
		for (let i = 0; !order.includes('module-import') && i < 100; i++) await Promise.resolve();
		try { assert.deepEqual(order, ['/bench/module-assets.json', 'module-import']); }
		finally { resolve(); await pending; }
		assert.deepEqual(order, ['/bench/module-assets.json', 'module-import', 'module-ready', '/bench/data.json']);
	});

	for (const failure of ['HTTP', 'body', 'import']) {
		it(`stops trace startup on module ${failure} failure before fetching data`, async () => {
			const error = new Error(`module ${failure} failed`);
			await assert.rejects(traceStartup('recharts', {
				adapter: noChartWork,
				async fetch(url) {
					assert.equal(url, '/bench/module-assets.json');
					return {ok: failure !== 'HTTP', status: 503, async json() {
						assert.notEqual(failure, 'HTTP', 'failed responses must not be parsed');
						if (failure === 'body') throw error;
						return [];
					}};
				},
				async prepareDemoRuntime() { assert.equal(failure, 'import'); throw error; },
			}), actual => failure === 'HTTP' ? /HTTP 503/.test(actual.message) : actual === error);
		});
	}

	it('does not fetch module assets for a script-only adapter', async () => {
		const requests = [];
		await traceStartup('d3', {
			adapter: noChartWork,
			prepareDemoRuntime() { assert.fail('unexpected runtime prefetch'); },
			async fetch(url) { requests.push(url); return {ok: true, json: async () => []}; },
		});
		assert.deepEqual(requests, ['/bench/data.json']);
	});
});
