import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const mocha = fileURLToPath(import.meta.resolve('mocha/bin/mocha.js'));
const nyc = fileURLToPath(import.meta.resolve('nyc/bin/nyc.js'));
const args = process.argv.slice(2);

function run(args, env) {
	const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });

	if (result.error)
		throw result.error;

	if (result.signal)
		console.error('Test process terminated by ' + result.signal);

	return result.status ?? 1;
}

const env = { ...process.env };
let coverageDir;
let testArgs;
let testEnv;

if (process.versions.bun) {
	console.log('Test runtime: Bun ' + process.versions.bun);
	coverageDir = resolve(cwd, '.nyc_output/bun');
	env.NODE_OPTIONS = '';
	testArgs = ['--preload', './scripts2/register-hooks.mjs', mocha, ...args];
	testEnv = { ...env, UPLOT_COVERAGE_DIR: coverageDir };
}
else {
	console.log('Test runtime: Node ' + process.versions.node);
	coverageDir = resolve(cwd, '.nyc_output');
	testArgs = [mocha, ...args];
	testEnv = {
		...env,
		UPLOT_COVERAGE_DIR: coverageDir,
		NODE_OPTIONS: [env.NODE_OPTIONS, '--import ./scripts2/register-hooks.mjs'].filter(Boolean).join(' '),
	};
}

rmSync(coverageDir, { recursive: true, force: true });
const testStatus = run(testArgs, testEnv);
// Use NYC only for reporting: its spawn hooks override fixture opt-outs.
const reportStatus = run([
	nyc, 'report', '--temp-dir', coverageDir, '--reporter=text',
], env);

process.exitCode = testStatus || reportStatus;
