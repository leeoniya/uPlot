import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cwd = fileURLToPath(new URL('../', import.meta.url));

function coverage(config, cacheDir) {
	const env = { ...process.env, NODE_OPTIONS: '' };
	delete env.NYC_CONFIG;
	delete env.NYC_CWD;
	delete env.UPLOT_INSTRUMENT_CACHE_DIR;
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
			await import('./scripts/register-hooks.mjs');
			const { domEnv, doc, win, setStylePx } = await import('./src/dom.js');
			const dom = { domEnv, doc, win };
			await import('./demos/renderDemo.js');
			setStylePx({ style: {} }, 'width', 1);
			console.log(JSON.stringify({ coverage: globalThis.__coverage__ || {}, cacheDir: process.env.UPLOT_INSTRUMENT_CACHE_DIR, dom }));
		`,
	], { cwd, env, encoding: 'utf8', timeout: 10000 }));
	assert.deepStrictEqual(result.dom, { domEnv: false, doc: null, win: null });
	assert.equal(typeof result.cacheDir, 'string');
	assert.equal(existsSync(result.cacheDir), cacheDir != null, 'only the cache owner removes the directory');
	return result.coverage;
}

describe('coverage loader', function() {
	this.timeout(15000);

	it('loads project config and instruments ESM without a DOM or deprecated APIs', () => {
		const result = coverage();
		const filename = fileURLToPath(new URL('../src/dom.js', import.meta.url));
		assert.ok(result[filename]);
		assert.ok(Object.values(result[filename].s).some(count => count > 0));
		assert.ok(Object.values(result[filename].f).some(count => count > 0));
		assert.ok(Object.keys(result).every(path => !path.includes('/demos/')));
	});

	it('honors NYC_CONFIG include and exclude rules', () => {
		const cacheDir = mkdtempSync(join(tmpdir(), 'uplot-shared-cache-test-'));
		try {
			const result = coverage({ cwd, include: ['src/dom.js'], exclude: ['src/dom.js'] }, cacheDir);
			assert.deepStrictEqual(result, {});
		}
		finally { rmSync(cacheDir, { recursive: true, force: true }); }
	});
});
