import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

function checkBackend(backend) {
	if (!['istanbul', 'estree'].includes(backend))
		throw new Error('Unsupported UPLOT_INSTRUMENTER: ' + backend + '. Use istanbul or estree.');
}

export function getInstrumentCacheNamespace(cwd, instrumentVersion, backend = 'istanbul') {
	checkBackend(backend);
	instrumentVersion ??= backend === 'istanbul' ? require('istanbul-lib-instrument/package.json').version : 'estree-1';
	const files = ['package-lock.json', 'bun.lock', 'scripts/instrument-source.mjs', 'scripts/register-hooks.mjs', 'scripts/coverage-files.mjs'];
	if (backend === 'estree')
		files.push(...['index.mjs', 'backend.mjs', 'source-coverage.cjs'].map(file => 'scripts/vendor/istanbul/' + file));
	const contents = files.map(file => {
		try { return [file, readFileSync(resolve(cwd, file), 'utf8')]; }
		catch (error) {
			if (error.code != 'ENOENT' || file.startsWith('scripts/'))
				throw error;
			return [file, null];
		}
	});

	return createHash('sha256').update(JSON.stringify([backend, instrumentVersion, contents])).digest('hex');
}

export function createSourceInstrumenter(config, cacheDir, backend = 'istanbul') {
	checkBackend(backend);
	const cacheConfig = JSON.stringify([backend, config]);
	let instrumenter;

	return (source, filename) => {
		const cacheFile = resolve(cacheDir,
			createHash('sha256').update(JSON.stringify([filename, source, cacheConfig])).digest('hex') + '.js');

		try { return readFileSync(cacheFile, 'utf8'); }
		catch (error) {
			if (error.code != 'ENOENT')
				throw error;
		}

		// Cache hits do not need Babel or an instrumenter instance.
		instrumenter ??= require(backend === 'istanbul' ? 'istanbul-lib-instrument' : './vendor/istanbul/index.mjs').createInstrumenter({
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
