import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

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

		// Cache hits do not need Babel or an instrumenter instance.
		instrumenter ??= require('istanbul-lib-instrument').createInstrumenter({
			...config,
			esModules: true,
			produceSourceMap: config.produceSourceMap ?? true,
		});
		let code = instrumenter.instrumentSync(source, filename);
		const map = instrumenter.lastSourceMap();

		if (map != null)
			code += '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');

		writeFileSync(cacheFile, code);
		return code;
	};
}
