import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkModuleSyntax, demos } from '../helpers/bench-demo-evaluator.mjs';
import { loadBenchDemoSources } from '../../scripts/bench-demo-sources.mjs';
import { demoDependencies } from '../../bench/demo-dependencies.mjs';

const root = new URL('../../', import.meta.url);
const shared = ['/bench/demo-fixture.mjs', '/bench/demo-dependencies.mjs', '/bench/demo.css'];

function remoteDependencies(variants) {
	return variants.flatMap(id => demoDependencies[id].filter(dep => dep.name).map(({name, version, path, type}) => {
		const cacheName = `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}-${path.replaceAll('/', '-')}`;
		return {name, version, url: `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`,
			route: '/bench/vendor/' + cacheName, cacheName, ...(type === 'style' ? {type} : {})};
	}));
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
		for (const route of [...shared, ...demos.map(([id]) => `/bench/${id}.mjs`), '/bench/fmtDate.js'])
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

	it('loads all six literal modules, shared assets, and manifest dependencies by default or null', () => {
		const variants = demos.map(([id]) => id);
		checkAssets(loadBenchDemoSources(root), variants);
		assert.deepEqual(loadBenchDemoSources(root, null), loadBenchDemoSources(root));
		assert.deepEqual(loadBenchDemoSources(root.href), loadBenchDemoSources(root));
	});

	for (const [id] of demos) {
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

	it('idle loads only shared fixture, manifest, and CSS assets', () => {
		checkAssets(loadBenchDemoSources(root, 'idle'), []);
	});

	it('preserves pinned production dependency order, style types, and unique vendor routes', () => {
		const {dependencies} = loadBenchDemoSources(root);
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

	it('does not require HTML or derive dependencies from HTML script and style tags', () => {
		withAssets((assetRoot, dir) => {
			const original = loadBenchDemoSources(assetRoot);
			checkAssets(original, demos.map(([id]) => id), assetRoot);
			for (const [, html] of demos)
				writeFileSync(join(dir, 'bench', html), '<script src="https://invalid.test/unpinned.js"></script><link rel="stylesheet" href="missing.css">');
			assert.deepEqual(loadBenchDemoSources(assetRoot), original);
		});
	});

	it('reads literal module, fixture, script, and stylesheet contents afresh without extraction or execution', () => {
		withAssets((assetRoot, dir) => {
			const routes = ['/bench/d3.mjs', '/bench/demo-fixture.mjs', '/bench/demo-dependencies.mjs',
				'/bench/demo.css', '/bench/fmtDate.js', '/dist/uPlot.iife.min.js', '/dist/uPlot.min.css'];
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
			for (const [id] of demos) {
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
