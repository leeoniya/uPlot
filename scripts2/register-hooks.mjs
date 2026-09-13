import { registerHooks } from 'node:module';
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
		let code = instrumenter.instrumentSync(source, filename);
		const map = instrumenter.lastSourceMap();

		if (map != null)
			code += '\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');

		return { ...result, source: code };
	},
});
