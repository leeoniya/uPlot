import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.versions.bun)
	throw new Error('Run this script with Bun: bun run test:bun');

const cwd = fileURLToPath(new URL('../', import.meta.url));
const coverageDir = resolve(cwd, '.nyc_output/bun');

rmSync(coverageDir, { recursive: true, force: true });

function run(args, env) {
	const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });

	if (result.error)
		throw result.error;

	if (result.signal)
		console.error('Bun process terminated by ' + result.signal);

	return result.status ?? 1;
}

const env = { ...process.env, NODE_OPTIONS: '' };
const testStatus = run([
	'--preload', './scripts2/register-hooks.mjs',
	fileURLToPath(import.meta.resolve('mocha/bin/mocha.js')),
	...process.argv.slice(2),
], { ...env, UPLOT_COVERAGE_DIR: coverageDir });

const reportStatus = run([
	fileURLToPath(import.meta.resolve('nyc/bin/nyc.js')),
	'report', '--temp-dir', coverageDir, '--reporter=text',
], env);

process.exitCode = testStatus || reportStatus;
