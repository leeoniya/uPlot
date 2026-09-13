import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));

function coverage(config) {
	const env = { ...process.env, NODE_OPTIONS: '' };

	return JSON.parse(execFileSync(process.execPath, [
		...(process.versions.bun ? [] : [
			'--max-old-space-size=512',
			'--throw-deprecation',
			'--input-type=module',
		]),
		'-e', `
			// NYC rewrites child-process environments, so configure after its wrapper starts.
			delete process.env.NYC_CONFIG;
			delete process.env.NYC_CWD;
			const config = ${JSON.stringify(config ?? null)};
			if (config != null)
				process.env.NYC_CONFIG = JSON.stringify(config);
			await import('./scripts2/register-hooks.mjs');
			const { rangeNum } = await import('./src/utils.js');
			await import('./demos/renderDemo.js');
			rangeNum(0, 10, 0.1, true);
			console.log(JSON.stringify(globalThis.__coverage__ || {}));
		`,
	], { cwd, env, encoding: 'utf8', timeout: 10000 }));
}

describe('coverage loader', function() {
	this.timeout(15000);

	it('loads project config and instruments ESM without deprecated APIs', () => {
		const result = coverage();
		const filename = fileURLToPath(new URL('../src/utils.js', import.meta.url));
		assert.ok(result[filename]);
		assert.ok(Object.values(result[filename].s).some(count => count > 0));
		assert.ok(Object.keys(result).every(path => !path.includes('/demos/')));
	});

	it('honors NYC_CONFIG include and exclude rules', () => {
		const result = coverage({ cwd, include: ['src/**/*.js'], exclude: ['src/utils.js'] });
		assert.deepStrictEqual(result, {});
	});
});
