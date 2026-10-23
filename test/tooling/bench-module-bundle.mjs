import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bundleModuleDependencies} from '../../scripts/bench-module-bundle.mjs';

const dependency = (name, global = name) => ({name, version: '1.0.0', type: 'module', global, url: `https://esm.sh/${name}@1.0.0?bundle`});

describe('benchmark module delivery', () => {
	let cacheDir;
	beforeEach(async () => { cacheDir = await mkdtemp(join(tmpdir(), 'uplot-module-test-')); });
	afterEach(async () => { await rm(cacheDir, {recursive: true, force: true}); });

	it('bundles a shared module graph once, exports namespaces, and reuses the cache offline', async () => {
		const sources = new Map([
			['https://esm.sh/first@1.0.0?bundle', 'export {shared} from "/shared@1.0.0/index.mjs"; export const mode = process.env.NODE_ENV;'],
			['https://esm.sh/second@1.0.0?bundle', 'import {shared} from "./shared@1.0.0/index.mjs"; export {shared}; export const lazy = () => import("/shared@1.0.0/index.mjs");'],
			['https://esm.sh/shared@1.0.0/index.mjs', 'export const shared = {};'],
		]);
		const seen = [];
		const fetchImpl = async (url, options) => {
			seen.push(url);
			assert.equal(options.redirect, 'error');
			assert.ok(options.signal);
			assert.ok(sources.has(url), url);
			return new Response(sources.get(url));
		};
		const dependencies = [dependency('first'), dependency('second')];
		const bundle = await bundleModuleDependencies(dependencies, {cacheDir, fetchImpl});
		assert.equal(seen.length, 3);
		assert.equal(bundle.sources.length, 3);
		assert.match(bundle.sha256, /^[0-9a-f]{64}$/);
		assert.deepEqual(bundle.globals, ['first', 'second']);
		const namespaces = await import('data:text/javascript;base64,' + Buffer.from(bundle.code).toString('base64'));
		assert.equal(namespaces.first.shared, namespaces.second.shared);
		assert.equal(namespaces.first.shared, (await namespaces.second.lazy()).shared);
		assert.equal(namespaces.first.mode, 'production');
		const offline = await bundleModuleDependencies(dependencies, {cacheDir, fetchImpl() { assert.fail('Network used for cached graph'); }});
		assert.equal(offline.code, bundle.code);
		assert.equal(offline.sha256, bundle.sha256);
		// Rebuild from cached source bytes if only the output is removed.
		await rm(bundle.path); await rm(bundle.path + '.json');
		const rebuilt = await bundleModuleDependencies(dependencies, {cacheDir, fetchImpl() { assert.fail('Network used for cached sources'); }});
		assert.equal(rebuilt.sha256, bundle.sha256);
	});

	it('rejects failed downloads, then retries without caching an error response', async () => {
		const deps = [dependency('first')];
		await assert.rejects(bundleModuleDependencies(deps, {cacheDir, fetchImpl: async () => new Response('bad', {status: 503})}), /HTTP 503/);
		const bundle = await bundleModuleDependencies(deps, {cacheDir, fetchImpl: async () => new Response('export const ok = true;')});
		assert.ok(bundle.code.includes('true') || bundle.code.includes('!0'));
	});

	it('rejects mutable top-level pins, development builds, duplicate globals, and remote escapes', async () => {
		for (const deps of [
			[{...dependency('first'), url: 'https://esm.sh/first@latest'}],
			[{...dependency('first'), url: 'https://esm.sh/first@1.0.0?dev'}],
			[dependency('first'), dependency('second', 'first')],
			[{...dependency('first'), global: 'bad-name'}],
			[{...dependency('first'), url: 'https://other.example/first@1.0.0'}],
		]) await assert.rejects(bundleModuleDependencies(deps, {cacheDir}));
		for (const source of ['import "https://other.example/code.mjs";', 'import "bare-module";']) {
			const dir = join(cacheDir, String(source.length));
			await assert.rejects(bundleModuleDependencies([dependency('first')], {
				cacheDir: dir, fetchImpl: async () => new Response(source),
			}), /Unsupported remote|Unresolved bare/);
		}
	});

	it('rejects non-literal runtime imports rather than leaving network work for init', async () => {
		await assert.rejects(bundleModuleDependencies([dependency('first')], {
			cacheDir, fetchImpl: async () => new Response('export const load = url => import(url);'),
		}), /Unresolved runtime import/);
	});

	it('detects modified output bytes instead of silently trusting a cache entry', async () => {
		const deps = [dependency('first')];
		const bundle = await bundleModuleDependencies(deps, {cacheDir, fetchImpl: async () => new Response('export const value = 1;')});
		const metadata = JSON.parse(await readFile(bundle.path + '.json', 'utf8'));
		assert.equal(metadata.sha256, bundle.sha256);
		await writeFile(bundle.path, 'export const corrupted = true;');
		await assert.rejects(bundleModuleDependencies(deps, {cacheDir}), /checksum mismatch/);
	});
});
