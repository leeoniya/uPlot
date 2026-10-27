import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cwd = fileURLToPath(new URL('../../', import.meta.url));

function coverage(backend, config, cacheDir, runCwd = cwd, modules = []) {
	const env = { ...process.env, NODE_OPTIONS: '', UPLOT_INSTRUMENTER: backend };
	delete env.NYC_CONFIG;
	delete env.NYC_CWD;
	delete env.UPLOT_INSTRUMENT_CACHE_DIR;
	delete env.UPLOT_COVERAGE_DIR;
	if (cacheDir != null)
		env.UPLOT_INSTRUMENT_CACHE_DIR = cacheDir;
	if (config != null)
		env.NYC_CONFIG = JSON.stringify(config);

	const args = [];
	if (!process.versions.bun)
		args.push('--max-old-space-size=256', '--throw-deprecation', '--input-type=module');

	const result = JSON.parse(execFileSync(process.execPath, [
		...args,
		'-e', `
			await import(${JSON.stringify(new URL('../../scripts/register-hooks.mjs', import.meta.url).href)});
			const { domEnv, doc, win, setStylePx } = await import(${JSON.stringify(new URL('../../src/dom.js', import.meta.url).href)});
			const dom = { domEnv, doc, win };
			await import(${JSON.stringify(new URL('../../demos/renderDemo.js', import.meta.url).href)});
			for (const url of ${JSON.stringify(modules.map(path => new URL('../../' + path, import.meta.url).href))})
				await import(url);
			setStylePx({ style: {} }, 'width', 1);
			console.log(JSON.stringify({ coverage: globalThis.__coverage__ || {}, cacheDir: process.env.UPLOT_INSTRUMENT_CACHE_DIR, dom }));
		`,
	], { cwd: runCwd, env, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 }));
	assert.deepStrictEqual(result.dom, { domEnv: false, doc: null, win: null });
	assert.equal(typeof result.cacheDir, 'string');
	assert.equal(existsSync(result.cacheDir), cacheDir != null, 'only the cache owner removes the directory');
	return result.coverage;
}

for (const backend of ['istanbul', 'estree'])
describe('coverage loader (' + backend + ')', function() {

	it('loads project config and instruments ESM without a DOM or deprecated APIs', { timeout: 15000 }, () => {
		const result = coverage(backend);
		const filename = fileURLToPath(new URL('../../src/dom.js', import.meta.url));
		assert.ok(result[filename]);
		assert.ok(Object.values(result[filename].s).some(count => count > 0));
		assert.ok(Object.values(result[filename].f).some(count => count > 0));
		assert.ok(Object.keys(result).every(path => !path.includes('/demos/')));
	});

	it('loads project config when launched outside the project', { timeout: 15000 }, () => {
		const runCwd = mkdtempSync(join(tmpdir(), 'uplot-coverage-cwd-'));
		try {
			const result = coverage(backend, undefined, undefined, runCwd);
			const filename = fileURLToPath(new URL('../../src/dom.js', import.meta.url));
			assert.ok(result[filename]);
			assert.ok(Object.keys(result).every(path => !path.includes('/demos/')));
		}
		finally { rmSync(runCwd, { recursive: true, force: true }); }
	});

	it('instruments the selected plugins and their dependencies but not Flatbush or demo scaffolding', { timeout: 15000 }, () => {
		const result = coverage(backend, undefined, undefined, cwd, [
			'demos/lib/barChartPlugin.js', 'demos/lib/heatmapPlugin.js', 'demos/lib/scatterPlugin.js',
		]);
		const pluginFiles = Object.keys(result).filter(path => path.includes('/demos/')).sort();
		assert.deepEqual(pluginFiles, [
			'barChartPlugin.js', 'barHover.js', 'barValues.js', 'distr.js', 'heatmapPlugin.js', 'scatterPlugin.js',
		].map(name => fileURLToPath(new URL('../../demos/lib/' + name, import.meta.url))).sort());
		for (const filename of pluginFiles)
			assert.ok(Object.keys(result[filename].fnMap).length > 0, filename);
	});

	it('honors NYC_CONFIG include and exclude rules', { timeout: 15000 }, () => {
		const cacheDir = mkdtempSync(join(tmpdir(), 'uplot-shared-cache-test-'));
		try {
			const result = coverage(backend, { cwd, include: ['src/dom.js'], exclude: ['src/dom.js'] }, cacheDir);
			assert.deepStrictEqual(result, {});
		}
		finally { rmSync(cacheDir, { recursive: true, force: true }); }
	});
});
