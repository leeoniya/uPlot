import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { checkModuleSyntax, demos } from '../helpers/bench-demo-evaluator.mjs';
import { loadBenchDemoSources } from '../../scripts/bench-demo-sources.mjs';
import { demoDependencies, benchmarkRestrictions, assertBenchmarkAvailable } from '../../bench/demo-dependencies.mjs';

const root = new URL('../../', import.meta.url);
const variants = Object.keys(demoDependencies).filter(id => id !== 'idle');
const shared = ['/bench/demo-fixture.mjs', '/bench/demo-dependencies.mjs', '/bench/demo-runtime.mjs', '/bench/framework-runtime.mjs', '/bench/demo.css'];

function remoteDependencies(variants) {
	const dependencies = variants.flatMap(id => demoDependencies[id].filter(dep => dep.name).map(({name, version, path, type, option, global, url}) => {
		const cacheName = `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}-${path.replaceAll('/', '-')}${type === 'module' ? '-' + id : ''}`;
		return {name, version, url: url ?? `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`,
			route: '/bench/vendor/' + cacheName, cacheName, ...(type ? {type} : {}), ...(option ? {option} : {}), ...(global ? {global} : {})};
	}));
	return [...new Map(dependencies.map(dep => [dep.cacheName, dep])).values()];
}

// Exercise the CLI's actual download/page/server code without installing Chrome,
// opening sockets, or starting a benchmark worker.
function workerAssets(cache, fetch, {variant = 'scichart', bundleModuleDependencies = () => assert.fail('unexpected module bundle')} = {}) {
	const source = readFileSync(new URL('scripts/benchmarks.mjs', root), 'utf8');
	const start = source.indexOf('const {files, dependencies, localScripts, localStyles} = loadBenchDemoSources(');
	const end = source.indexOf('const profile =', start);
	const serverStart = source.indexOf('const server = createServer(');
	const serverEnd = source.indexOf('const timeoutMs =', serverStart);
	assert.ok(start >= 0 && end > start && serverStart > end && serverEnd > serverStart);
	return runInNewContext(`(async () => {\n${source.slice(start, end)}\n${source.slice(serverStart, serverEnd)}\nreturn {files, dependencies, page, server};\n})()`, {
		root, cache, fetch, loadBenchDemoSources, bundleModuleDependencies, demoDependencies, values: {variant},
		join, existsSync, readFileSync, writeFileSync, createHash, Buffer, URL, AbortSignal,
		console: {log() {}}, createServer: handler => handler,
		rejectResult: error => assert.fail(error),
	});
}

function localRoutes(variants, type) {
	return variants.flatMap(id => demoDependencies[id]
		.filter(dep => !dep.name && (dep.type ?? 'script') === type)
		.map(dep => new URL(dep.path, 'https://example.test/bench/').pathname));
}

function withAssets(check, {dist = true} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'uplot-bench-demo-sources-'));
	try {
		mkdirSync(join(dir, 'bench'));
		for (const route of [...shared, ...variants.map(id => `/bench/${id}.mjs`), '/bench/fmtDate.js'])
			copyFileSync(new URL(route.slice(1), root), join(dir, route.slice(1)));
		if (dist) {
			mkdirSync(join(dir, 'dist'));
			for (const name of ['uPlot.iife.min.js', 'uPlot.min.css'])
				copyFileSync(new URL('dist/' + name, root), join(dir, 'dist', name));
		}
		check(pathToFileURL(dir + '/'), dir);
	}
	finally {
		rmSync(dir, {recursive: true, force: true});
	}
}

function checkAssets(result, variants, assetRoot = root) {
	const scripts = localRoutes(variants, 'script');
	const styles = ['/bench/demo.css', ...localRoutes(variants, 'style')];
	assert.ok(result.files instanceof Map);
	assert.deepEqual(new Set(result.files.keys()), new Set([
		...shared, ...variants.map(id => `/bench/${id}.mjs`), ...scripts, ...styles,
	]));
	assert.deepEqual(result.dependencies, remoteDependencies(variants));
	assert.deepEqual(result.localScripts, scripts);
	assert.deepEqual(new Set(result.localStyles), new Set(styles));
	assert.equal(result.localStyles.length, styles.length);
	for (const [route, source] of result.files) {
		assert.equal(source, readFileSync(new URL(route.slice(1), assetRoot), 'utf8'), route);
		assert.doesNotMatch(route, /-source\.mjs$/);
	}
}

describe('benchmark demo asset loader', () => {
	it('checks module syntax without executing it and rejects invalid syntax', () => {
		assert.doesNotThrow(() => checkModuleSyntax('throw new Error("must not execute"); export const value = 1;'));
		assert.throws(() => checkModuleSyntax('export const = ;'));
	});

	it('loads all literal modules including license-gated adapters, shared assets, and manifest dependencies by default or null', () => {
		checkAssets(loadBenchDemoSources(root), variants);
		assert.deepEqual(loadBenchDemoSources(root, null), loadBenchDemoSources(root));
		assert.deepEqual(loadBenchDemoSources(root.href), loadBenchDemoSources(root));
	});

	for (const id of variants) {
		it(`${id}: loads only its module, shared assets, and ordered manifest dependencies`, () => {
			checkAssets(loadBenchDemoSources(root, id), [id]);
		});
	}

	it('uPlot loads its own module and distribution JS/CSS, never D3', () => {
		const result = loadBenchDemoSources(root, 'uplot');
		assert.deepEqual(result.dependencies, []);
		assert.deepEqual(result.localScripts, ['/dist/uPlot.iife.min.js']);
		assert.ok(result.localStyles.includes('/dist/uPlot.min.css'));
		assert.ok(result.files.has('/bench/uplot.mjs'));
		assert.equal(result.files.has('/bench/d3.mjs'), false);
	});

	it('idle loads only shared fixture, manifest, binary/module and framework runtimes, and CSS assets', () => {
		checkAssets(loadBenchDemoSources(root, 'idle'), []);
	});

	it('preserves the old six pinned production dependency order and style types', () => {
		const dependencies = demos.flatMap(([id]) => loadBenchDemoSources(root, id).dependencies);
		assert.deepEqual(dependencies.map(({name, version}) => [name, version]), [
			['d3', '7.9.0'], ['chart.js', '4.6.1'], ['@date-fns/cdn', '4.4.0'],
			['chartjs-adapter-date-fns', '3.0.0'], ['echarts', '6.1.0'],
			['jquery', '3.7.1'], ['flot', '4.2.6'],
			['dygraphs', '2.2.2'], ['dygraphs', '2.2.2'],
		]);
		assert.equal(new Set(dependencies.map(dep => dep.route)).size, dependencies.length);
		assert.equal(new Set(dependencies.map(dep => dep.cacheName)).size, dependencies.length);
		for (const dep of dependencies) {
			assert.match(dep.cacheName, dep.type === 'style' ? /^[\w.-]+\.css$/ : /^[\w.-]+\.js$/);
			assert.equal(dep.route, '/bench/vendor/' + dep.cacheName);
		}
		assert.ok(dependencies[2].url.endsWith('/cdn.min.js'));
		assert.ok(dependencies[3].url.endsWith('/dist/chartjs-adapter-date-fns.min.js'));
		assert.doesNotMatch(dependencies[3].url, /bundle/);
		assert.equal(dependencies.find(dep => dep.name === 'flot').cacheName, 'flot-4.2.6-dist-es5-jquery.flot.js');
		assert.deepEqual(dependencies.filter(dep => dep.type), [dependencies.at(-1)]);
		assert.equal(dependencies.at(-1).type, 'style');
		assert.ok(dependencies.every(dep => !dep.url.includes('/source/')));
	});

	it('keeps all vendor routes unique and honors explicit amCharts GitHub distribution URLs', () => {
		const {dependencies} = loadBenchDemoSources(root);
		assert.equal(new Set(dependencies.map(dep => dep.route)).size, dependencies.length);
		assert.equal(new Set(dependencies.map(dep => dep.cacheName)).size, dependencies.length);
		const amcharts = loadBenchDemoSources(root, 'amcharts').dependencies;
		assert.deepEqual(amcharts.map(dep => dep.url), [
			'https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@5.21.4/index.js',
			'https://cdn.jsdelivr.net/gh/amcharts/amcharts5-dist@5.21.4/xy.js',
		]);
		for (const dep of dependencies) {
			assert.equal(dep.route, '/bench/vendor/' + dep.cacheName);
			if (dep.type === 'module')
				assert.match(dep.cacheName, /^[\w.-]+\.mjs-(?:recharts|muicharts|financialcharts|visx)$/);
			else {
				const extension = dep.type === 'wasm' ? 'wasm' : dep.type === 'style' ? 'css' : 'js';
				assert.match(dep.cacheName, new RegExp('^[\\w.-]+\\.' + extension + '$'));
			}
		}
	});

	it('deduplicates the shared D3 dependency while preserving d3fc dependency order', () => {
		const d3 = loadBenchDemoSources(root, 'd3').dependencies;
		const d3fc = loadBenchDemoSources(root, 'd3fc').dependencies;
		assert.deepEqual(d3fc.map(dep => dep.name), ['d3', 'd3fc']);
		assert.deepEqual(d3fc[0], d3[0]);
		const all = loadBenchDemoSources(root).dependencies;
		assert.deepEqual(all.filter(dep => dep.name === 'd3'), d3);
		assert.ok(all.findIndex(dep => dep.name === 'd3') < all.findIndex(dep => dep.name === 'd3fc'));
	});

	it('keeps framework modules variant-scoped with explicit namespace globals and pinned remote URLs', () => {
		const all = loadBenchDemoSources(root).dependencies;
		for (const id of ['recharts', 'muicharts', 'financialcharts', 'visx']) {
			const {dependencies, files, localScripts, localStyles} = loadBenchDemoSources(root, id);
			assert.deepEqual(localScripts, []);
			assert.deepEqual(localStyles, ['/bench/demo.css']);
			assert.ok(files.has('/bench/framework-runtime.mjs'));
			assert.equal(dependencies.length, demoDependencies[id].length);
			assert.deepEqual(dependencies.map(dep => dep.global), demoDependencies[id].map(dep => dep.global));
			assert.equal(new Set(dependencies.map(dep => dep.global)).size, dependencies.length);
			dependencies.forEach((dep, i) => {
				assert.equal(dep.type, 'module');
				assert.equal(dep.url, demoDependencies[id][i].url);
				assert.match(dep.url, /^https:\/\/esm\.sh\/.+@\d+\.\d+\.\d+/);
				assert.ok(dep.cacheName.endsWith('.mjs-' + id));
				assert.equal(files.has(dep.route), false, 'bundling belongs to worker setup');
				assert.equal(all.filter(other => other.cacheName === dep.cacheName).length, 1);
			});
		}
		const react = all.filter(dep => dep.global === 'benchmarkReact');
		assert.equal(react.length, 4, 'shared package URLs must not merge variant bundles');
		assert.equal(new Set(react.map(dep => dep.route)).size, 4);
	});

	it('preserves both SciChart binary types and runtime option names without treating them as scripts or styles', () => {
		const {dependencies, localScripts, localStyles, files} = loadBenchDemoSources(root, 'scichart');
		assert.deepEqual(dependencies.map(dep => [dep.name, dep.version, dep.type, dep.option]), [
			['scichart', '6.0.14', undefined, undefined],
			['scichart', '6.0.14', 'wasm', 'wasmBinary'],
			['scichart', '6.0.14', 'wasm', 'wasmNoSimdBinary'],
		]);
		assert.deepEqual(localScripts, []);
		assert.deepEqual(localStyles, ['/bench/demo.css']);
		assert.ok(files.has('/bench/demo-runtime.mjs'));
		for (const dep of dependencies.filter(dep => dep.type === 'wasm')) {
			assert.ok(dep.route.endsWith('.wasm'));
			assert.ok(dep.url.endsWith('.wasm'));
			assert.equal(files.has(dep.route), false, 'loader leaves remote downloads to the worker');
		}
	});

	it('rejects explicit JSCharting in CLI and worker modes before browser setup or suite side effects', async () => {
		const source = readFileSync(new URL('scripts/benchmarks.mjs', root), 'utf8');
		const start = source.indexOf('const lightningOptions =');
		const browser = source.indexOf('const binary = await chromeBinary(', start);
		const end = source.indexOf('\n', browser);
		assert.ok(start >= 0 && browser > start && end > browser);
		for (const worker of [false, true]) {
			for (const installOnly of [false, true]) {
				const effects = [];
				await assert.rejects(runInNewContext(`(async () => {\n${source.slice(start, end)}\n})()`, {
					values: {variant: 'jscharting', worker, 'install-only': installOnly}, dpr: 1,
					measurements: {trace: true, memory: false, raf: false},
					assertBenchmarkAvailable,
					process: {env: {LIGHTNINGCHART_LICENSE: 'test', LIGHTNINGCHART_LICENSE_INFORMATION: '{invalid'}, exit: code => effects.push(['exit', code])},
					console: {log: () => effects.push('log')},
					runBenchmarkSuite: async () => effects.push('suite'),
					chromeVersion: 'test', chromeBinary: async () => effects.push('browser'),
				}), error => error.message === `jscharting: ${benchmarkRestrictions.jscharting}`);
				assert.deepEqual(effects, []);
			}
		}
	});

	it('ignores malformed LightningChart metadata for explicit uPlot but validates it for default and LightningChart runs', async () => {
		const source = readFileSync(new URL('scripts/benchmarks.mjs', root), 'utf8');
		const start = source.indexOf('const lightningOptions =');
		const end = source.indexOf('const binary = await chromeBinary(', start);
		assert.ok(start >= 0 && end > start);
		const env = Object.freeze({
			LIGHTNINGCHART_LICENSE: 'test-license-not-a-vendor-key',
			LIGHTNINGCHART_LICENSE_INFORMATION: '{"private-metadata":',
		});
		for (const variant of ['uplot', undefined, 'lightningchart']) {
			const requests = [], exits = [], logs = [];
			const pending = runInNewContext(`(async () => {\n${source.slice(start, end)}\n})()`, {
				values: {variant, gpu: false}, dpr: 1,
				measurements: {trace: true, memory: false, raf: false},
				assertBenchmarkAvailable,
				process: {env, exit: code => exits.push(code)},
				console: {log: (...args) => logs.push(args)},
				runBenchmarkSuite: async options => { requests.push(options); },
			});
			if (variant === 'uplot') {
				await pending;
				assert.equal(requests.length, 1);
				assert.equal(requests[0].variant, 'uplot');
				assert.equal(requests[0].lightningOptions, undefined);
				assert.deepEqual(exits, [0]);
				for (const secret of Object.values(env))
					assert.equal(JSON.stringify(requests).includes(secret), false, 'unrelated suite must not receive license secrets');
			}
			else {
				await assert.rejects(pending, error => error.name === 'SyntaxError');
				assert.deepEqual(requests, [], 'invalid metadata must fail before the suite can write reports');
				assert.deepEqual(exits, []);
			}
			assert.deepEqual(logs, []);
		}
	});

	it('downloads, caches, hashes, and serves exact binary bytes with WASM metadata and MIME type', async () => {
		const cache = mkdtempSync(join(tmpdir(), 'uplot-bench-binaries-'));
		try {
			const dependencies = loadBenchDemoSources(root, 'scichart').dependencies;
			const bytes = dependencies.map((dep, i) => dep.type === 'wasm' ?
				Buffer.from([0, 97, 115, 109, 255, 128, 0, i]) : Buffer.from('/* vendor script */'));
			const downloads = [];
			const first = await workerAssets(cache, async (url, options) => {
				const index = downloads.length;
				assert.equal(url, dependencies[index].url);
				assert.ok(options.signal instanceof AbortSignal);
				downloads.push(url);
				return {ok: true, arrayBuffer: async () => Uint8Array.from(bytes[index]).buffer};
			});
			assert.deepEqual(downloads, dependencies.map(dep => dep.url));
			const second = await workerAssets(cache, () => assert.fail('cached dependency must not download'));
			for (const result of [first, second]) {
				for (let i = 0; i < dependencies.length; i++) {
					const dep = result.dependencies[i];
					assert.deepEqual(readFileSync(join(cache, dep.cacheName)), bytes[i]);
					assert.ok(Buffer.isBuffer(result.files.get(dep.route)));
					assert.deepEqual(result.files.get(dep.route), bytes[i]);
					assert.equal(dep.sha256, createHash('sha256').update(bytes[i]).digest('hex'));
					const headers = {};
					let body;
					result.server({url: dep.route}, {
						setHeader(name, value) { headers[name] = value; },
						end(value) { body = value; },
						writeHead() { assert.fail('unexpected HTTP error'); },
					});
					assert.deepEqual(body, bytes[i]);
					assert.equal(headers['Content-Type'], dep.type === 'wasm' ? 'application/wasm' : 'text/javascript');
					assert.equal(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
					assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
					assert.equal(result.page.includes(dep.route), dep.type !== 'wasm');
				}
				assert.deepEqual(JSON.parse(result.files.get('/bench/runtime-assets.json')),
					result.dependencies.filter(dep => dep.type === 'wasm').map(dep => ({...dep, url: dep.route})));
			}
		}
		finally {
			rmSync(cache, {recursive: true, force: true});
		}
	});

	it('bundles a complete framework variant once, serves local ESM, and never downloads modules as scripts', async () => {
		const cache = mkdtempSync(join(tmpdir(), 'uplot-bench-modules-'));
		try {
			const variant = 'recharts';
			const entries = demoDependencies[variant].filter(dep => dep.type === 'module');
			const before = JSON.stringify(entries);
			const code = entries.map(dep => `export const ${dep.global} = {};`).join('\n');
			const sha256 = createHash('sha256').update(code).digest('hex');
			const bundle = {code, cacheName: `modules-${sha256}.mjs`, sha256, bytes: Buffer.byteLength(code),
				schema: 3, rolldown: 'test', globals: entries.map(dep => dep.global), dependencies: entries,
				sources: [{url: entries[0].url, sha256, bytes: Buffer.byteLength(code)}]};
			const calls = [];
			const result = await workerAssets(cache, () => assert.fail('module entry must not use the script downloader'), {
				variant,
				async bundleModuleDependencies(dependencies, options) {
					calls.push(dependencies);
					assert.deepEqual(dependencies, entries);
					assert.equal(options.cacheDir, join(cache, 'modules'));
					return bundle;
				},
			});
			assert.equal(calls.length, 1);
			assert.equal(JSON.stringify(entries), before);
			const route = '/bench/vendor/' + bundle.cacheName;
			assert.equal(String(result.files.get(route)), code);
			assert.deepEqual([...result.files.keys()].filter(path => path.startsWith('/bench/vendor/')), [route]);
			assert.equal(result.dependencies.length, entries.length);
			for (const dep of result.dependencies) {
				assert.equal(dep.type, 'module');
				assert.equal(dep.route, route);
				assert.equal(dep.sha256, sha256);
				assert.equal(result.page.includes(dep.route), false);
				assert.equal(result.page.includes(dep.url), false);
			}
			const metadata = result.dependencies.filter(dep => dep.bundle);
			assert.equal(metadata.length, 1, 'store shared bundle provenance once');
			assert.deepEqual(metadata[0].bundle.sources, bundle.sources);
			assert.equal(JSON.stringify(metadata[0].bundle).includes(code), false, 'reports must not embed bundle code');
			const assets = JSON.parse(result.files.get('/bench/module-assets.json'));
			assert.deepEqual(assets, JSON.parse(JSON.stringify(result.dependencies.map(dep => ({...dep, url: dep.route, export: dep.global})))));
			assert.deepEqual(JSON.parse(result.files.get('/bench/runtime-assets.json')), []);
			assert.match(result.page, /<script type="module" src="\/bench\.mjs"><\/script>/);
			for (const [path, mime, expected] of [[route, 'text/javascript', code],
				['/bench/module-assets.json', 'application/json', JSON.stringify(assets)]]) {
				const headers = {};
				let body;
				result.server({url: path}, {
					setHeader(name, value) { headers[name] = value; },
					end(value) { body = value; },
					writeHead() { assert.fail('unexpected HTTP error'); },
				});
				assert.equal(String(body), expected);
				assert.equal(headers['Content-Type'], mime);
			}
		}
		finally { rmSync(cache, {recursive: true, force: true}); }
	});

	it('propagates a module bundle failure before downloads or benchmark page creation', async () => {
		const cache = mkdtempSync(join(tmpdir(), 'uplot-bench-modules-'));
		try {
			const error = new Error('bundle failed');
			let calls = 0;
			await assert.rejects(workerAssets(cache, () => assert.fail('unexpected download'), {
				variant: 'visx',
				async bundleModuleDependencies() { calls++; throw error; },
			}), actual => actual === error);
			assert.equal(calls, 1);
		}
		finally { rmSync(cache, {recursive: true, force: true}); }
	});

	for (const failure of ['HTTP', 'network', 'body']) {
		it(`does not cache a failed ${failure} binary download and retries it on the next worker load`, async () => {
			const cache = mkdtempSync(join(tmpdir(), 'uplot-bench-binaries-'));
			try {
				const [script, wasm, noSimd] = loadBenchDemoSources(root, 'scichart').dependencies;
				writeFileSync(join(cache, script.cacheName), '/* cached script */');
				const error = new Error('synthetic download failure');
				await assert.rejects(workerAssets(cache, async url => {
					assert.equal(url, wasm.url);
					if (failure === 'network') throw error;
					return {ok: failure !== 'HTTP', status: 503, arrayBuffer: async () => {
						assert.notEqual(failure, 'HTTP');
						throw error;
					}};
				}), caught => failure === 'HTTP' ? caught.message === 'scichart download: HTTP 503' : caught === error);
				assert.equal(existsSync(join(cache, wasm.cacheName)), false);
				assert.equal(existsSync(join(cache, noSimd.cacheName)), false);
				assert.equal(readFileSync(join(cache, script.cacheName), 'utf8'), '/* cached script */');
				const downloads = [];
				await workerAssets(cache, async url => {
					downloads.push(url);
					return {ok: true, arrayBuffer: async () => Uint8Array.of(0, 255, 128).buffer};
				});
				assert.deepEqual(downloads, [wasm.url, noSimd.url]);
			}
			finally {
				rmSync(cache, {recursive: true, force: true});
			}
		});
	}

	it('does not require HTML or derive dependencies from HTML script and style tags', () => {
		withAssets((assetRoot, dir) => {
			const original = loadBenchDemoSources(assetRoot);
			checkAssets(original, variants, assetRoot);
			for (const [, html] of demos)
				writeFileSync(join(dir, 'bench', html), '<script src="https://invalid.test/unpinned.js"></script><link rel="stylesheet" href="missing.css">');
			assert.deepEqual(loadBenchDemoSources(assetRoot), original);
		});
	});

	it('reads literal module, fixture, script, and stylesheet contents afresh without extraction or execution', () => {
		withAssets((assetRoot, dir) => {
			const routes = [...variants.map(id => `/bench/${id}.mjs`), ...shared,
				'/bench/fmtDate.js', '/dist/uPlot.iife.min.js', '/dist/uPlot.min.css'];
			for (const route of routes) {
				const path = join(dir, route.slice(1));
				const original = readFileSync(path, 'utf8');
				const changed = original + (route.endsWith('.css') ? '\n/* fresh asset */\n' : '\nthrow new Error("loader must not execute assets");\n');
				writeFileSync(path, changed);
				assert.equal(loadBenchDemoSources(assetRoot).files.get(route), changed);
			}
		});
	});

	it('does not read unrelated modules or local library assets for an isolated variant', () => {
		withAssets((assetRoot, dir) => {
			for (const id of variants) {
				if (id !== 'd3') rmSync(join(dir, `bench/${id}.mjs`));
			}
			rmSync(join(dir, 'bench/fmtDate.js'));
			checkAssets(loadBenchDemoSources(assetRoot, 'd3'), ['d3'], assetRoot);
			rmSync(join(dir, 'bench/d3.mjs'));
			checkAssets(loadBenchDemoSources(assetRoot, 'idle'), [], assetRoot);
		}, {dist: false});
	});

	it('requires distribution assets instead of falling back to uPlot source modules', () => {
		withAssets((assetRoot, dir) => {
			assert.throws(() => loadBenchDemoSources(assetRoot, 'uplot'), /requires dist\/uPlot\.iife\.min\.js\. Run npm run build first/);
			mkdirSync(join(dir, 'dist'));
			writeFileSync(join(dir, 'dist/uPlot.iife.min.js'), 'var uPlot = function() {};');
			assert.throws(() => loadBenchDemoSources(assetRoot, 'uplot'), /requires dist\/uPlot\.min\.css\. Run npm run build first/);
			writeFileSync(join(dir, 'dist/uPlot.min.css'), '.uplot {}');
			checkAssets(loadBenchDemoSources(assetRoot, 'uplot'), ['uplot'], assetRoot);
		}, {dist: false});
	});

	it('reports missing selected modules and shared assets rather than synthesizing them from HTML', () => {
		for (const route of ['/bench/d3.mjs', ...shared]) {
			withAssets((assetRoot, dir) => {
				rmSync(join(dir, route.slice(1)));
				assert.throws(() => loadBenchDemoSources(assetRoot, 'd3'), error =>
									error.code === 'ENOENT' && error.path === join(dir, route.slice(1)));
			});
		}
	});

	it('rejects unknown variants and roots that are not repository directory file URLs', () => {
		assert.throws(() => loadBenchDemoSources(root, 'unknown'), /Unknown demo variant/);
		for (const invalid of [new URL('https://example.com/'), new URL('?query', root), new URL('#hash', root)])
			assert.throws(() => loadBenchDemoSources(invalid), /repository directory file: URL/);
		assert.throws(() => loadBenchDemoSources(root.href.slice(0, -1)), /trailing slash/);
	});
});
