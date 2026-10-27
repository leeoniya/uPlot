import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createSourceInstrumenter } from './instrument-source.mjs';
import { coverageFiles } from './coverage-files.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const config = process.env.NYC_CONFIG == null
	? { ...JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).nyc, cwd }
	: JSON.parse(process.env.NYC_CONFIG);
const selection = coverageFiles(config);

// Share transformed source across the run, not module state or coverage counters.
// The process that creates the cache outlives its children and owns cleanup.
let cacheDir = process.env.UPLOT_INSTRUMENT_CACHE_DIR;
if (cacheDir == null) {
	cacheDir = process.env.UPLOT_INSTRUMENT_CACHE_DIR = mkdtempSync(resolve(tmpdir(), 'uplot-coverage-'));
	process.once('exit', () => { rmSync(cacheDir, { recursive: true, force: true }); });
}

const instrument = createSourceInstrumenter(config, cacheDir);

if (process.versions.bun) {
	const { plugin } = await import('bun');

	plugin({
		name: 'estree-coverage',
		setup(build) {
			// Bun's runtime onLoad hook cannot fall through for excluded files.
			const files = selection.files().map(path => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			const filter = new RegExp('^(?:' + files.join('|') + ')$');

			build.onLoad({ filter }, ({ path }) => ({
				contents: instrument(readFileSync(path, 'utf8'), path),
				loader: 'js',
			}));
		},
	});
}
else {
	const { registerHooks } = await import('node:module');

	registerHooks({
		load(url, context, nextLoad) {
			const result = nextLoad(url, context);

			if (result.format !== 'module' || !url.startsWith('file:'))
				return result;

			const filename = fileURLToPath(url);

			if (!selection.shouldInstrument(filename))
				return result;

			const source = typeof result.source === 'string'
				? result.source
				: new TextDecoder().decode(result.source);
			return { ...result, source: instrument(source, filename) };
		},
	});
}

const coverageDir = process.env.UPLOT_COVERAGE_DIR;

if (coverageDir != null) {
	process.on('exit', () => {
		if (globalThis.__coverage__ != null) {
			mkdirSync(coverageDir, { recursive: true });
			writeFileSync(resolve(coverageDir, process.pid + '.json'), JSON.stringify(globalThis.__coverage__));
		}
	});
}
