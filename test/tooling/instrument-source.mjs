import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

	it('uses contents rather than timestamps and includes the installed instrumenter version', () => {
		const version = createRequire(import.meta.url)('istanbul-lib-instrument/package.json').version;
		const first = getInstrumentCacheNamespace(root);
		assert.equal(first, getInstrumentCacheNamespace(root, version));
		for (const file of files)
			utimesSync(join(root, file), 1, 1);
		assert.equal(getInstrumentCacheNamespace(root), first);
		assert.notEqual(getInstrumentCacheNamespace(root, version + '-changed'), first);
	});

	it('separates backends even with the same instrumenter version', () => {
		assert.notEqual(getInstrumentCacheNamespace(root), getInstrumentCacheNamespace(root, undefined, 'estree'));
		assert.notEqual(getInstrumentCacheNamespace(root, 'same', 'istanbul'), getInstrumentCacheNamespace(root, 'same', 'estree'));
	});

	for (const file of vendorFiles) {
		it('invalidates only ESTree on changes to ' + file, () => {
			const istanbul = getInstrumentCacheNamespace(root);
			const estree = getInstrumentCacheNamespace(root, undefined, 'estree');
			utimesSync(join(root, file), 1, 1);
			assert.equal(getInstrumentCacheNamespace(root, undefined, 'estree'), estree);
			writeFileSync(join(root, file), file + ' changed');
			assert.notEqual(getInstrumentCacheNamespace(root, undefined, 'estree'), estree);
			assert.equal(getInstrumentCacheNamespace(root), istanbul);
			writeFileSync(join(root, file), file);
			assert.equal(getInstrumentCacheNamespace(root, undefined, 'estree'), estree);
			rmSync(join(root, file));
			assert.throws(() => getInstrumentCacheNamespace(root, undefined, 'estree'), { code: 'ENOENT' });
			assert.equal(getInstrumentCacheNamespace(root), istanbul);
		});
	}

	for (const file of files) {
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

	it('does not hide missing instrumentation implementations', () => {
		rmSync(join(root, 'scripts/instrument-source.mjs'));
		assert.throws(() => getInstrumentCacheNamespace(root), { code: 'ENOENT' });
	});
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

	for (const backends of [['istanbul', 'estree'], ['estree', 'istanbul']]) {
		it('separates backend source in a shared cold and warm cache: ' + backends.join(' then '), () => {
			const codes = backends.map(backend => createSourceInstrumenter({}, cacheDir, backend)(source, filename));
			assert.notEqual(codes[0], codes[1], 'each backend must produce its own source');
			const entries = readdirSync(cacheDir);
			assert.equal(entries.length, 2);
			for (const entry of entries)
				utimesSync(join(cacheDir, entry), 1, 1);

			for (const [index, backend] of backends.entries()) {
				const warm = createSourceInstrumenter({}, cacheDir, backend)(source, filename);
				assert.equal(warm, codes[index], backend + ' must reuse only its own source');
				for (const code of [codes[index], warm]) {
					const context = execute(code);
					assert.equal(context.result, 1);
					assert.equal(context.__coverage__[filename].f[0], 1);
					context.__coverage__[filename].f[0] = 100;
				}
			}
			assert.deepEqual(readdirSync(cacheDir), entries);
			for (const entry of entries)
				assert.equal(statSync(join(cacheDir, entry)).mtimeMs, 1000, 'warm backends must not rewrite source');
		});
	}

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

	for (const backend of ['istanbul', 'estree']) {
		it('reuses ' + backend + ' source across loader processes with fresh coverage and no warm Babel loads', { timeout: 15000 }, function() {
			const shared = join(cacheDir, 'source');
			mkdirSync(shared);
			const target = join(cwd, 'src/dom.js');
			const run = calls => {
				const coverageDir = join(cacheDir, 'coverage-' + calls);
				const env = {
					...process.env,
					NODE_OPTIONS: '',
					NYC_CONFIG: JSON.stringify({ cwd, include: ['src/dom.js'], exclude: [] }),
					UPLOT_INSTRUMENTER: backend,
					UPLOT_INSTRUMENT_CACHE_DIR: shared,
					UPLOT_COVERAGE_DIR: coverageDir,
				};
				delete env.NYC_CWD;
				const stdout = execFileSync(process.execPath, [...runtimeArgs, '-e', `
					await import('./scripts/register-hooks.mjs');
					const { setStylePx } = await import('./src/dom.js');
					for (let i = 0; i < ${calls}; i++)
						setStylePx({ style: {} }, 'width', 1);
					const { createRequire } = await import('node:module');
					const require = createRequire(${JSON.stringify(instrumentURL)});
					console.log(JSON.stringify({ loaded: Object.keys(require.cache), coverage: globalThis.__coverage__ }));
				`], { cwd, env, encoding: 'utf8', timeout: 10000 });
				const result = JSON.parse(stdout);
				const output = readdirSync(coverageDir);
				assert.equal(output.length, 1);
				assert.deepEqual(JSON.parse(readFileSync(join(coverageDir, output[0]), 'utf8')), result.coverage);
				const coverage = result.coverage[target];
				const id = Object.keys(coverage.fnMap).find(id => coverage.fnMap[id].name == 'setStylePx');
				assert.equal(coverage.f[id], calls);
				return result.loaded.filter(path => /[/\\]node_modules[/\\](?:@babel[/\\]|istanbul-lib-instrument[/\\])/.test(path));
			};

			assert.deepEqual(readdirSync(shared), []);
			const cold = run(3);
			if (backend === 'istanbul') {
				assert.ok(cold.some(path => path.includes('/istanbul-lib-instrument/')));
				assert.ok(cold.some(path => path.includes('/@babel/')));
			}
			else
				assert.deepEqual(cold, [], 'cold ESTree must not load Babel or istanbul-lib-instrument');
			const entries = readdirSync(shared);
			assert.ok(entries.length > 0);
			for (const entry of entries)
				utimesSync(join(shared, entry), 1, 1);
			assert.deepEqual(run(1), [], 'warm loaders must not load Babel or istanbul-lib-instrument');
			assert.deepEqual(readdirSync(shared), entries);
			for (const entry of entries)
				assert.equal(statSync(join(shared, entry)).mtimeMs, 1000, 'a warm process must not rewrite source');
		});
	}

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

	it('keeps different instrumentation configurations separate', () => {
		const first = execute(createSourceInstrumenter({}, cacheDir)(source, filename));
		const second = execute(createSourceInstrumenter({ coverageVariable: '__alternateCoverage__' }, cacheDir)(source, filename));

		assert.equal(first.__coverage__[filename].f[0], 1);
		assert.equal(second.__coverage__, undefined);
		assert.equal(second.__alternateCoverage__[filename].f[0], 1);
		assert.equal(readdirSync(cacheDir).length, 2);
	});

	it('preserves source maps on cache hits and honors disabled source maps', () => {
		const instrument = createSourceInstrumenter({}, cacheDir);
		const first = instrument(source, filename);
		const cached = createSourceInstrumenter({}, cacheDir)(source, filename);
		assert.equal(cached, first);
		const encoded = cached.split('sourceMappingURL=data:application/json;charset=utf-8;base64,')[1];
		const map = JSON.parse(Buffer.from(encoded, 'base64').toString());
		assert.equal(map.sources[0], 'source.mjs');
		assert.equal(map.sourcesContent[0], source);

		const withoutMap = createSourceInstrumenter({ produceSourceMap: false }, cacheDir)(source, filename);
		assert.ok(!withoutMap.includes('sourceMappingURL='));
		assert.equal(execute(withoutMap).result, 1);
	});
});
