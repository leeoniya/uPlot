import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createSourceInstrumenter } from '../scripts/instrument-source.mjs';

const source = 'function value() { return 1; } globalThis.result = value();';

function execute(code) {
	const context = {};
	runInNewContext(code, context, { timeout: 1000 });
	return context;
}

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
		}
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
