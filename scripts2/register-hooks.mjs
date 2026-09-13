import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNycConfig } from '@istanbuljs/load-nyc-config';
import { createInstrumenter } from 'istanbul-lib-instrument';
import TestExclude from 'test-exclude';

const config = process.env.NYC_CONFIG == null
	? await loadNycConfig({ cwd: process.env.NYC_CWD || process.cwd() })
	: JSON.parse(process.env.NYC_CONFIG);
const exclude = new TestExclude(config);
const instrumenter = createInstrumenter({
	...config,
	esModules: true,
	produceSourceMap: config.produceSourceMap ?? true,
});

function instrument(source, filename) {
	let code = instrumenter.instrumentSync(source, filename);
	const map = instrumenter.lastSourceMap();

	if (map != null)
		code += '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');

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
