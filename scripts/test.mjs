import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getInstrumentCacheNamespace } from './instrument-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hooks = fileURLToPath(new URL('./register-hooks.mjs', import.meta.url));
const coverageReporter = fileURLToPath(new URL('./report-coverage.mjs', import.meta.url));

export function testCommand(args, { bun = !!process.versions.bun, cwd = process.cwd() } = {}) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			'no-coverage': { type: 'boolean' },
			'test-name-pattern': { type: 'string' },
			grep: { type: 'string', short: 'g' },
			reporter: { type: 'string', short: 'R' },
			'test-reporter': { type: 'string' },
		},
	});

	if (positionals.length === 0)
		throw new Error('Specify at least one test file or glob.');

	const files = new Set();
	for (const pattern of positionals) {
		const matches = globSync(pattern, { cwd }).sort();
		if (matches.length === 0)
			throw new Error('No test files match: ' + pattern);
		for (const file of matches)
			files.add(resolve(cwd, file));
	}

	const reporter = values.reporter ?? values['test-reporter'] ?? 'spec';
	if (!['spec', 'dot', 'dots'].includes(reporter))
		throw new Error('Unsupported reporter: ' + reporter + '. Use spec or dot.');

	// The recorder shares its failure list and output directory across test files.
	const command = bun ? ['test', '--timeout=2000'] : ['--test', '--test-isolation=none', '--test-timeout=2000'];
	if (bun) {
		if (reporter !== 'spec')
			command.push('--reporter=dots');
	}
	else
		command.push('--test-reporter=' + (reporter === 'dots' ? 'dot' : reporter));

	const pattern = values['test-name-pattern'] ?? values.grep;
	if (pattern != null)
		command.push('--test-name-pattern', pattern);

	return { args: [...command, ...files], coverage: !values['no-coverage'] };
}

function run(args, env, cwd = process.cwd()) {
	const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });

	if (result.error)
		throw result.error;

	if (result.signal)
		console.error('Test process terminated by ' + result.signal);

	return result.status ?? 1;
}

function main() {
	const bun = !!process.versions.bun;
	const command = testCommand(process.argv.slice(2));
	const env = { ...process.env };
	console.log('Test runtime: ' + (bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node));

	if (bun) {
		env.NODE_OPTIONS = '';
		// bun test defaults to UTC; retain the caller's timezone.
		env.TZ ??= new Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	if (!command.coverage) {
		process.exitCode = run(command.args, env);
		return;
	}

	const namespace = getInstrumentCacheNamespace(root);
	env.UPLOT_INSTRUMENT_CACHE_DIR ??= resolve(root, '.cache/test-instrument', namespace);
	mkdirSync(resolve(env.UPLOT_INSTRUMENT_CACHE_DIR), { recursive: true });
	const coverageDir = resolve(root, bun ? '.nyc_output/bun' : '.nyc_output');
	const testEnv = { ...env, UPLOT_COVERAGE_DIR: coverageDir };
	if (bun)
		command.args.splice(1, 0, '--preload', hooks);
	else
		testEnv.NODE_OPTIONS = [env.NODE_OPTIONS, '--import ' + JSON.stringify(hooks)].filter(Boolean).join(' ');

	rmSync(coverageDir, { recursive: true, force: true });
	// Empty or entirely skipped selections still produce a successful empty report.
	mkdirSync(coverageDir, { recursive: true });
	const testStatus = run(command.args, testEnv);
	const reportStatus = run([coverageReporter, coverageDir], env, root);
	process.exitCode = testStatus || reportStatus;
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	main();
