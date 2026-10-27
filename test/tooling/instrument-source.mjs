import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { createSourceInstrumenter, getInstrumentCacheNamespace } from '../../scripts/instrument-source.mjs';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const instrumentURL = new URL('../../scripts/instrument-source.mjs', import.meta.url).href;
const runtimeArgs = process.versions.bun ? [] : ['--max-old-space-size=256', '--input-type=module'];

const source = 'function value() { return 1; } globalThis.result = value();';

function execute(code) {
	const context = {};
	runInNewContext(code, context, { timeout: 1000 });
	return context;
}

describe('instrumentation cache namespace', () => {
	let root;
	const files = ['package-lock.json', 'bun.lock', 'scripts/instrument-source.mjs', 'scripts/register-hooks.mjs', 'scripts/coverage-files.mjs'];
	const vendorFiles = ['index.mjs', 'backend.mjs', 'source-coverage.cjs'].map(file => 'scripts/vendor/istanbul/' + file);

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'uplot-cache-namespace-'));
		mkdirSync(join(root, 'scripts/vendor/istanbul'), { recursive: true });
		for (const file of [...files, ...vendorFiles])
			writeFileSync(join(root, file), file);
	});
	afterEach(() => { rmSync(root, { recursive: true, force: true }); });

	it('uses contents rather than timestamps for every fingerprinted file', () => {
		const first = getInstrumentCacheNamespace(root);
		for (const file of [...files, ...vendorFiles])
			utimesSync(join(root, file), 1, 1);
		assert.equal(getInstrumentCacheNamespace(root), first);
	});

	for (const file of [...files, ...vendorFiles]) {
		it('invalidates on changes to ' + file, () => {
			const first = getInstrumentCacheNamespace(root);
			writeFileSync(join(root, file), file + ' changed');
			assert.notEqual(getInstrumentCacheNamespace(root), first);
			writeFileSync(join(root, file), file);
			assert.equal(getInstrumentCacheNamespace(root), first);
		});
	}

	for (const file of files.slice(0, 2)) {
		it('distinguishes missing and empty ' + file, () => {
			const first = getInstrumentCacheNamespace(root);
			rmSync(join(root, file));
			const missing = getInstrumentCacheNamespace(root);
			assert.notEqual(missing, first);
			writeFileSync(join(root, file), '');
			assert.notEqual(getInstrumentCacheNamespace(root), missing);
		});
	}

	for (const file of [...files.slice(2), ...vendorFiles]) {
		it('does not hide missing ' + file, () => {
			rmSync(join(root, file));
			assert.throws(() => getInstrumentCacheNamespace(root), { code: 'ENOENT' });
		});
	}
});

describe('source instrumentation cache', () => {
	let cacheDir;
	let filename;

	beforeEach(() => {
		cacheDir = mkdtempSync(join(tmpdir(), 'uplot-instrument-test-'));
		filename = join(cacheDir, 'source.mjs');
	});
	afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }); });

	it('reuses transformed source without sharing runtime coverage counters', () => {
		const first = createSourceInstrumenter({}, cacheDir)(source, filename);
		const [entry] = readdirSync(cacheDir);
		const cached = join(cacheDir, entry);
		utimesSync(cached, 1, 1);
		const timestamp = statSync(cached).mtimeMs;

		const second = createSourceInstrumenter({}, cacheDir)(source, filename);
		assert.equal(second, first);
		assert.equal(statSync(cached).mtimeMs, timestamp, 'a cache hit must not rewrite the entry');
		assert.equal(readdirSync(cacheDir).length, 1);

		for (const code of [first, second]) {
			const context = execute(code);
			assert.equal(context.result, 1);
			assert.equal(context.__coverage__[filename].f[0], 1);
			context.__coverage__[filename].f[0] = 100;
		}
	});

	it('keys entries by filename, source and the serialized configuration', () => {
		const config = { coverageVariable: '__alternateCoverage__', produceSourceMap: false };
		const code = createSourceInstrumenter(config, cacheDir)(source, filename);
		const entry = createHash('sha256').update(JSON.stringify([filename, source, JSON.stringify(config)])).digest('hex') + '.js';
		assert.deepEqual(readdirSync(cacheDir), [entry]);
		assert.equal(readFileSync(join(cacheDir, entry), 'utf8'), code);
		utimesSync(join(cacheDir, entry), 1, 1);
		assert.equal(createSourceInstrumenter({ ...config }, cacheDir)(source, filename), code);
		assert.equal(statSync(join(cacheDir, entry)).mtimeMs, 1000);
	});

	it('publishes complete entries when processes share a cold cache', { timeout: 15000 }, async function() {
		const script = `
			const { createSourceInstrumenter } = await import(${JSON.stringify(instrumentURL)});
			console.log(JSON.stringify(createSourceInstrumenter({}, ${JSON.stringify(cacheDir)})(${JSON.stringify(source)}, ${JSON.stringify(filename)})));
		`;
		const results = await Promise.all([0, 1].map(() => promisify(execFile)(process.execPath, [...runtimeArgs, '-e', script], {
			env: { ...process.env, NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 10000,
		})));
		const [entry] = readdirSync(cacheDir);
		assert.equal(readdirSync(cacheDir).length, 1, 'no temporary files remain');
		for (const { stdout } of results)
			assert.equal(readFileSync(join(cacheDir, entry), 'utf8'), JSON.parse(stdout));
		assert.equal(execute(readFileSync(join(cacheDir, entry), 'utf8')).result, 1);
	});

	it('reuses ESTree source across loader processes with fresh coverage and lazy instrumenter loads', { timeout: 15000 }, function() {
		const shared = join(cacheDir, 'source');
		mkdirSync(shared);
		const target = join(cwd, 'src/dom.js');
		const run = calls => {
			const coverageDir = join(cacheDir, 'coverage-' + calls);
			const env = {
				...process.env,
				NODE_OPTIONS: '',
				NYC_CONFIG: JSON.stringify({ cwd, include: ['src/dom.js'], exclude: [] }),
				UPLOT_INSTRUMENT_CACHE_DIR: shared,
				UPLOT_COVERAGE_DIR: coverageDir,
			};
			delete env.NYC_CWD;

			const stdout = execFileSync(process.execPath, [...runtimeArgs, '-e', `
				const { createRequire } = await import('node:module');
				const require = createRequire(${JSON.stringify(instrumentURL)});
				await import('./scripts/register-hooks.mjs');
				const before = Object.keys(require.cache);
				const { setStylePx } = await import('./src/dom.js');
				for (let i = 0; i < ${calls}; i++)
					setStylePx({ style: {} }, 'width', 1);
				console.log(JSON.stringify({ before, loaded: Object.keys(require.cache), coverage: globalThis.__coverage__ }));
			`], { cwd, env, encoding: 'utf8', timeout: 10000 });
			const result = JSON.parse(stdout);
			const output = readdirSync(coverageDir);
			assert.equal(output.length, 1);
			assert.deepEqual(JSON.parse(readFileSync(join(coverageDir, output[0]), 'utf8')), result.coverage);
			const coverage = result.coverage[target];
			const id = Object.keys(coverage.fnMap).find(id => coverage.fnMap[id].name == 'setStylePx');
			assert.equal(coverage.f[id], calls);
			const vendor = paths => paths.filter(path => /[/\\]vendor[/\\]istanbul[/\\]/.test(path));
			assert.deepEqual(vendor(result.before), [], 'registering hooks must not load the instrumenter');
			return vendor(result.loaded);
		};

		assert.deepEqual(readdirSync(shared), []);
		assert.ok(run(3).some(path => path.endsWith('/source-coverage.cjs')), 'a cold miss must load the vendored ESTree instrumenter');
		const entries = readdirSync(shared);
		assert.ok(entries.length > 0);
		for (const entry of entries)
			utimesSync(join(shared, entry), 1, 1);
		assert.deepEqual(run(1), [], 'warm loaders must not load the instrumenter');
		assert.deepEqual(readdirSync(shared), entries);
		for (const entry of entries)
			assert.equal(statSync(join(shared, entry)).mtimeMs, 1000, 'a warm process must not rewrite source');
	});

	it('invalidates entries when source or filename changes', () => {
		const instrument = createSourceInstrumenter({}, cacheDir);
		const first = execute(instrument(source, filename));
		const changed = execute(instrument(source.replace('return 1', 'return 2'), filename));
		const otherFilename = join(cacheDir, 'other.mjs');
		const other = execute(instrument(source, otherFilename));

		assert.equal(first.result, 1);
		assert.equal(changed.result, 2);
		assert.deepStrictEqual(Object.keys(other.__coverage__), [otherFilename]);
		assert.equal(readdirSync(cacheDir).length, 3);
	});

	it('keeps different instrumentation configurations separate on cold and warm caches', () => {
		const configs = [{}, { coverageVariable: '__alternateCoverage__' }];
		const codes = configs.map(config => createSourceInstrumenter(config, cacheDir)(source, filename));
		assert.notEqual(codes[0], codes[1]);
		const entries = readdirSync(cacheDir);
		assert.equal(entries.length, 2);
		for (const entry of entries)
			utimesSync(join(cacheDir, entry), 1, 1);

		for (const index of [1, 0]) {
			const config = configs[index];
			const warm = createSourceInstrumenter({ ...config }, cacheDir)(source, filename);
			assert.equal(warm, codes[index]);
			for (const code of [codes[index], warm]) {
				const context = execute(code);
				assert.equal(context.result, 1);
				const variable = config.coverageVariable ?? '__coverage__';
				const otherVariable = index === 0 ? '__alternateCoverage__' : '__coverage__';
				assert.equal(context[otherVariable], undefined);
				assert.equal(context[variable][filename].f[0], 1);
				context[variable][filename].f[0] = 100;
			}
		}
		assert.deepEqual(readdirSync(cacheDir), entries);
		for (const entry of entries)
			assert.equal(statSync(join(cacheDir, entry)).mtimeMs, 1000, 'a warm config must not rewrite source');
	});

	it('preserves source maps on cache hits and honors disabled source maps', () => {
		const instrument = createSourceInstrumenter({}, cacheDir);
		const first = instrument(source, filename);
		const cached = createSourceInstrumenter({}, cacheDir)(source, filename);
		assert.equal(cached, first);
		const encoded = cached.split('sourceMappingURL=data:application/json;charset=utf-8;base64,')[1];
		const map = JSON.parse(Buffer.from(encoded, 'base64').toString());
		assert.equal(map.sources[0], filename);
		assert.equal(map.sourcesContent[0], source);

		const withoutMap = createSourceInstrumenter({ produceSourceMap: false }, cacheDir)(source, filename);
		assert.ok(!withoutMap.includes('sourceMappingURL='));
		assert.equal(execute(withoutMap).result, 1);
	});
});
