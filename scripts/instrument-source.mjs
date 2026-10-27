import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export function getInstrumentCacheNamespace(cwd) {
	const files = ['package-lock.json', 'bun.lock', 'scripts/instrument-source.mjs', 'scripts/register-hooks.mjs', 'scripts/coverage-files.mjs',
		...['index.mjs', 'backend.mjs', 'source-coverage.cjs'].map(file => 'scripts/vendor/istanbul/' + file)];
	const contents = files.map(file => {
		try { return [file, readFileSync(resolve(cwd, file), 'utf8')]; }
		catch (error) {
			if (error.code != 'ENOENT' || file.startsWith('scripts/'))
				throw error;
			return [file, null];
		}
	});

	return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}

export function createSourceInstrumenter(config, cacheDir) {
	const cacheConfig = JSON.stringify(config);
	let instrumenter;

	return (source, filename) => {
		const cacheFile = resolve(cacheDir,
			createHash('sha256').update(JSON.stringify([filename, source, cacheConfig])).digest('hex') + '.js');

		try { return readFileSync(cacheFile, 'utf8'); }
		catch (error) {
			if (error.code != 'ENOENT')
				throw error;
		}

		// Cache hits do not need to load the instrumenter or its dependencies.
		instrumenter ??= require('./vendor/istanbul/index.mjs').createInstrumenter({
			...config,
			esModules: true,
			produceSourceMap: config.produceSourceMap ?? true,
		});
		let code = instrumenter.instrumentSync(source, filename);
		const map = instrumenter.lastSourceMap();

		if (map != null)
			code += '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');

		// Publish a complete entry even when independent runs share this cache.
		const temporary = cacheFile + '.' + process.pid + '.' + randomUUID() + '.tmp';
		try {
			writeFileSync(temporary, code, { flag: 'wx' });
			renameSync(temporary, cacheFile);
		}
		finally { rmSync(temporary, { force: true }); }
		return code;
	};
}
