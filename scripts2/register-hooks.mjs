import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNycConfig } from '@istanbuljs/load-nyc-config';
import { createRequire } from 'node:module';
import TestExclude from 'test-exclude';

const config = process.env.NYC_CONFIG == null
	? await loadNycConfig({ cwd: process.env.NYC_CWD || process.cwd() })
	: JSON.parse(process.env.NYC_CONFIG);
const exclude = new TestExclude(config);
const require = createRequire(import.meta.url);
let instrumenter;

// Optional per-run cache shared by isolated precision probes. Only transformed
// source is shared; each process still owns and reports its coverage counters.
const cacheDir = process.env.UPLOT_INSTRUMENT_CACHE_DIR;
const cacheConfig = JSON.stringify(config);

function instrument(source, filename) {
	const cacheFile = cacheDir == null ? null : resolve(cacheDir,
		createHash('sha256').update(JSON.stringify([filename, source, cacheConfig])).digest('hex') + '.js');

	if (cacheFile != null) {
		try { return readFileSync(cacheFile, 'utf8'); }
		catch (error) {
			if (error.code != 'ENOENT')
				throw error;
		}
	}

	// Cache hits do not need to load Babel or construct an instrumenter.
	instrumenter ??= require('istanbul-lib-instrument').createInstrumenter({
		...config,
		esModules: true,
		produceSourceMap: config.produceSourceMap ?? true,
	});
	let code = instrumenter.instrumentSync(source, filename);
	const map = instrumenter.lastSourceMap();

	if (map != null)
		code += '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');

	if (cacheFile != null)
		writeFileSync(cacheFile, code);

	return code;
}

if (process.versions.bun) {
	const { plugin } = await import('bun');

	plugin({
		name: 'istanbul-coverage',
		setup(build) {
			// Bun's runtime onLoad hook cannot fall through for excluded files.
			const files = exclude.globSync().map(path => resolve(exclude.cwd, path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			const filter = new RegExp('^(?:' + files.join('|') + ')$');

			build.onLoad({ filter }, ({ path }) => ({
				contents: instrument(readFileSync(path, 'utf8'), path),
				loader: 'js',
			}));
		},
	});

	const coverageDir = process.env.UPLOT_COVERAGE_DIR;

	if (coverageDir != null) {
		process.on('exit', () => {
			if (globalThis.__coverage__ != null) {
				mkdirSync(coverageDir, { recursive: true });
				writeFileSync(resolve(coverageDir, process.pid + '.json'), JSON.stringify(globalThis.__coverage__));
			}
		});
	}
}
else {
	const { registerHooks } = await import('node:module');

	registerHooks({
		load(url, context, nextLoad) {
			const result = nextLoad(url, context);

			if (result.format !== 'module' || !url.startsWith('file:'))
				return result;

			const filename = fileURLToPath(url);

			if (!exclude.shouldInstrument(filename))
				return result;

			const source = typeof result.source === 'string'
				? result.source
				: new TextDecoder().decode(result.source);
			return { ...result, source: instrument(source, filename) };
		},
	});
}
