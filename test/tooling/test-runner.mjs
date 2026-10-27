import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCommand } from '../../scripts/test.mjs';

describe('native test runner arguments', () => {
	let cwd;
	const files = ['z.mjs', 'nested/c.mjs', 'nested/b.mjs', 'a.mjs', 'ignored.txt'];

	before(() => {
		cwd = mkdtempSync(join(tmpdir(), 'uplot test runner-'));
		for (const file of files) {
			const filename = join(cwd, file);
			mkdirSync(dirname(filename), { recursive: true });
			writeFileSync(filename, '');
		}
	});

	after(() => {
		if (cwd != null)
			rmSync(cwd, { recursive: true, force: true });
	});

	for (const bun of [false, true]) {
		describe(bun ? 'Bun' : 'Node', () => {
			const prefix = bun ? ['test', '--timeout=2000'] : ['--test', '--test-isolation=none', '--test-timeout=2000', '--test-reporter=spec'];
			const command = args => testCommand(args, { bun, cwd });
			const paths = names => names.map(name => join(cwd, name));

			it('expands recursive globs in sorted order without selecting other extensions', () => {
				assert.deepEqual(command(['**/*.mjs']), {
					args: [...prefix, ...paths(['a.mjs', 'nested/b.mjs', 'nested/c.mjs', 'z.mjs'])],
					coverage: true, coverageProvider: 'istanbul',
				});
			});

			it('preserves pattern order and deduplicates overlapping, relative and absolute paths', () => {
				const args = ['z.mjs', 'nested/*.mjs', '*.mjs', './a.mjs', join(cwd, 'z.mjs'), '**/*.mjs'];
				const original = [...args];
				assert.deepEqual(command(args).args, [...prefix, ...paths(['z.mjs', 'nested/b.mjs', 'nested/c.mjs', 'a.mjs'])]);
				assert.deepEqual(args, original);
			});

			it('accepts absolute files and globs independently of the caller directory', () => {
				const args = [join(cwd, 'z.mjs'), join(cwd, 'nested/*.mjs')];
				const expected = [...prefix, ...paths(['z.mjs', 'nested/b.mjs', 'nested/c.mjs'])];
				assert.deepEqual(testCommand(args, { bun, cwd: join(cwd, 'nested') }).args, expected);
				assert.deepEqual(testCommand(args, { bun }).args, expected);
			});

			for (const args of [[], ['--no-coverage'], ['--test-name-pattern', 'example']]) {
				it(`rejects a selection without files: ${JSON.stringify(args)}`, () => {
					assert.throws(() => command(args), /Specify at least one test file or glob/);
				});
			}

			for (const pattern of ['missing.mjs', 'missing/**/*.mjs']) {
				it(`rejects an unmatched pattern even after a valid file: ${pattern}`, () => {
					assert.throws(() => command(['a.mjs', pattern]), { message: 'No test files match: ' + pattern });
				});
			}

			it('disables coverage without adding instrumentation or reporting arguments', () => {
				assert.deepEqual(command(['--no-coverage', 'a.mjs']), {
					args: [...prefix, ...paths(['a.mjs'])], coverage: false, coverageProvider: 'istanbul',
				});
				assert.deepEqual(command(['a.mjs', '--no-coverage']), command(['--no-coverage', 'a.mjs']));
			});

			for (const flag of ['--grep', '-g', '--test-name-pattern']) {
				it(`forwards ${flag} as a literal test-name pattern`, () => {
					const pattern = '^(area-fill 0-0|multi-bars 0-variable-colors)$';
					assert.deepEqual(command(['a.mjs', flag, pattern]), {
						args: [...prefix, '--test-name-pattern', pattern, ...paths(['a.mjs'])], coverage: true, coverageProvider: 'istanbul',
					});
				});
			}

			it('preserves an empty pattern and gives --test-name-pattern precedence over --grep', () => {
				for (const flags of [
					['--grep', 'ignored', '--test-name-pattern', ''],
					['--test-name-pattern', '', '-g', 'ignored'],
				])
					assert.deepEqual(command([...flags, 'a.mjs']).args, [...prefix, '--test-name-pattern', '', ...paths(['a.mjs'])]);
			});

			for (const flag of ['--reporter', '-R', '--test-reporter']) {
				for (const reporter of ['spec', 'dot', 'dots']) {
					it(`maps ${flag} ${reporter} to the native reporter`, () => {
						const expected = bun
							? ['test', '--timeout=2000', ...(reporter === 'spec' ? [] : ['--reporter=dots'])]
							: ['--test', '--test-isolation=none', '--test-timeout=2000', '--test-reporter=' + (reporter === 'spec' ? 'spec' : 'dot')];
						assert.deepEqual(command([flag, reporter, 'a.mjs']).args, [...expected, ...paths(['a.mjs'])]);
					});
				}
			}

			it('gives --reporter precedence over --test-reporter', () => {
				for (const flags of [
					['--reporter', 'spec', '--test-reporter', 'dot'],
					['--test-reporter', 'dot', '--reporter', 'spec'],
				])
					assert.deepEqual(command([...flags, 'a.mjs']).args, [...prefix, ...paths(['a.mjs'])]);
			});

			for (const flag of ['--reporter', '--test-reporter']) {
				for (const reporter of ['tap', 'json', 'unknown']) {
					it(`rejects unsupported ${flag} ${reporter}`, () => {
						assert.throws(() => command([flag, reporter, 'a.mjs']), /Unsupported reporter:/);
					});
				}
			}

			for (const flag of ['--unknown', '--timeout', '--require', '--coverage']) {
				it(`rejects unsupported argument ${flag}`, () => {
					assert.throws(() => command(['a.mjs', flag]), /Unknown option/);
				});
			}

			it('selects the explicit Istanbul provider without changing runner arguments', () => {
				assert.deepEqual(command(['--coverage-provider=istanbul', 'a.mjs']), command(['a.mjs']));
			});

			it('allows the V8 prototype only under Node when coverage is enabled', () => {
				const args = ['--coverage-provider=v8', 'a.mjs'];
				if (bun)
					assert.throws(() => command(args), /V8 coverage prototype requires Node/);
				else
					assert.deepEqual(command(args), {
						args: [...prefix, ...paths(['a.mjs'])], coverage: true, coverageProvider: 'v8',
					});
				assert.deepEqual(command([...args, '--no-coverage']), {
					args: [...prefix, ...paths(['a.mjs'])], coverage: false, coverageProvider: 'v8',
				});
			});

			it('rejects an unknown coverage provider', () => {
				assert.throws(() => command(['--coverage-provider=unknown', 'a.mjs']), /Unsupported coverage provider/);
			});

			for (const flag of ['--grep', '-g', '--test-name-pattern', '--reporter', '--test-reporter', '--coverage-provider']) {
				it(`rejects a missing value for ${flag}`, () => {
					assert.throws(() => command(['a.mjs', flag]), /argument missing|requires an argument/i);
				});
			}
		});
	}
});

const runner = fileURLToPath(new URL('../../scripts/test.mjs', import.meta.url));
const timezone = `({
	name: new Intl.DateTimeFormat().resolvedOptions().timeZone,
	offset: new Date('2026-01-01T00:00:00Z').getTimezoneOffset(),
})`;

describe('native test runner subprocesses', () => {
	let cwd, env;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), 'uplot test runner process-'));
		env = { ...process.env, NODE_OPTIONS: '' };
		for (const key of ['NODE_V8_COVERAGE', 'NYC_CONFIG', 'NYC_CWD', 'UPLOT_COVERAGE_DIR', 'UPLOT_INSTRUMENT_CACHE_DIR'])
			delete env[key];

		// Keep the runner unchanged, but isolate its root-relative coverage paths from other test processes.
		mkdirSync(join(cwd, 'scripts'));
		copyFileSync(runner, join(cwd, 'scripts/test.mjs'));
		writeFileSync(join(cwd, 'scripts/instrument-source.mjs'), `
			export function getInstrumentCacheNamespace() { throw new Error('Unexpected source instrumentation'); }
		`);
		writeFileSync(join(cwd, 'fixture.mjs'), `
			import { it } from 'node:test';
			import assert from 'node:assert/strict';
			import { writeFileSync } from 'node:fs';
			it('temporary runner fixture', () => {
				assert.equal(globalThis.__coverage__, undefined);
				writeFileSync('observed.json', JSON.stringify({ timezone: ${timezone}, tz: process.env.TZ ?? null }));
			});
		`);
	});

	afterEach(() => {
		if (cwd != null)
			rmSync(cwd, { recursive: true, force: true });
	});

	function run(args = ['scripts/test.mjs', '--no-coverage', 'fixture.mjs']) {
		const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 10000 });
		assert.ifError(result.error);
		assert.equal(result.signal, null, result.stdout + result.stderr);
		return result;
	}

	function passed(result) {
		assert.equal(result.status, 0, result.stdout + result.stderr);
	}

	const observed = () => JSON.parse(readFileSync(join(cwd, 'observed.json'), 'utf8'));

	it('preserves an explicit TZ in the child test process', { timeout: 15000 }, () => {
		env.TZ = 'Pacific/Honolulu';
		passed(run());
		assert.deepEqual(observed(), { timezone: { name: 'Pacific/Honolulu', offset: 600 }, tz: 'Pacific/Honolulu' });
	});

	it('preserves the caller timezone when TZ is absent', { timeout: 15000 }, () => {
		delete env.TZ;
		// Probe a normal runtime, not this test process: bun test itself defaults to UTC.
		const caller = run(['-e', `console.log(JSON.stringify(${timezone}));`]);
		passed(caller);
		const expected = JSON.parse(caller.stdout);
		passed(run());
		assert.deepEqual(observed().timezone, expected);
		assert.equal(observed().tz, process.versions.bun ? expected.name : null);
	});

	it('leaves existing coverage output untouched with --no-coverage', { timeout: 15000 }, () => {
		const coverage = join(cwd, '.nyc_output');
		mkdirSync(join(coverage, 'bun'), { recursive: true });
		for (const name of ['node.json', 'bun/bun.json'])
			writeFileSync(join(coverage, name), JSON.stringify({ sentinel: name }));
		const snapshot = () => readdirSync(coverage, { recursive: true }).sort().map(name => {
			const filename = join(coverage, name), stat = statSync(filename);
			return [name, stat.mtimeMs, stat.isFile() ? readFileSync(filename, 'utf8') : null];
		});
		const before = snapshot();
		passed(run());
		assert.deepEqual(snapshot(), before);
		assert.deepEqual(readdirSync(cwd).sort(), ['.nyc_output', 'fixture.mjs', 'observed.json', 'scripts']);
	});

	it('times out an unresolved async test after the default 2000ms and runs cleanup', { timeout: 15000 }, () => {
		writeFileSync(join(cwd, 'fixture.mjs'), `
			import { it, after } from 'node:test';
			import { writeFileSync } from 'node:fs';
			let active, safety;
			after(() => {
				clearInterval(active);
				clearTimeout(safety);
				writeFileSync('timeout-cleanup.txt', 'cleaned');
			});
			it('unresolved async test', async () => {
				active = setInterval(() => {}, 100);
				// Bound the active handle even if the runner loses its default timeout.
				safety = setTimeout(() => clearInterval(active), 6000);
				safety.unref();
				await new Promise(() => {});
			});
		`);
		const result = run();
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /timed out after 2000ms/);
		assert.equal(readFileSync(join(cwd, 'timeout-cleanup.txt'), 'utf8'), 'cleaned');
	});

	it('allows aggregate suite duration above 2000ms when each test stays below the default', { timeout: 15000 }, () => {
		writeFileSync(join(cwd, 'fixture.mjs'), `
			import { describe, it, after } from 'node:test';
			import { setTimeout as delay } from 'node:timers/promises';
			import { writeFileSync } from 'node:fs';
			describe('long suite of short tests', () => {
				const completed = [], start = performance.now();
				for (let i = 0; i < 3; i++) {
					it('short test ' + i, async () => {
						await delay(900);
						completed.push(i);
					});
				}
				after(() => writeFileSync('duration.json', JSON.stringify({ completed, elapsed: performance.now() - start })));
			});
		`);
		passed(run());
		const result = JSON.parse(readFileSync(join(cwd, 'duration.json'), 'utf8'));
		assert.deepEqual(result.completed, [0, 1, 2]);
		assert.ok(result.elapsed > 2000, JSON.stringify(result));
	});

	it('honors an explicit per-test timeout longer than the 2000ms default', { timeout: 15000 }, () => {
		writeFileSync(join(cwd, 'fixture.mjs'), `
			import { describe, it } from 'node:test';
			import { setTimeout as delay } from 'node:timers/promises';
			import { writeFileSync } from 'node:fs';
			describe('suite with a longer test', () => {
				it('explicit timeout override', { timeout: 5000 }, async () => {
					const start = performance.now();
					await delay(2500);
					writeFileSync('duration.json', JSON.stringify({ elapsed: performance.now() - start }));
				});
			});
		`);
		passed(run());
		const result = JSON.parse(readFileSync(join(cwd, 'duration.json'), 'utf8'));
		assert.ok(result.elapsed > 2000, JSON.stringify(result));
	});

	it('returns a nonzero exit status when a child test fails', { timeout: 15000 }, () => {
		writeFileSync(join(cwd, 'fixture.mjs'), `
			import { it } from 'node:test';
			it('intentional runner failure', () => { throw new Error('runner failure sentinel'); });
		`);
		const result = run();
		assert.notEqual(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /runner failure sentinel/);
	});
});

describe('V8 test runner pipeline', () => {
	let cwd, env;

	function write(name, text) {
		const filename = join(cwd, name);
		mkdirSync(dirname(filename), { recursive: true });
		writeFileSync(filename, text);
	}

	const read = name => JSON.parse(readFileSync(join(cwd, name), 'utf8'));

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), 'uplot v8 runner-'));
		env = { ...process.env };
		for (const key of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NYC_CONFIG', 'NYC_CWD', 'UPLOT_COVERAGE_DIR', 'UPLOT_INSTRUMENT_CACHE_DIR'])
			delete env[key];
		Object.assign(env, { FIXTURE_FAIL: '0', CONVERT_STATUS: '0', REPORT_STATUS: '0' });
		mkdirSync(join(cwd, 'scripts'));
		copyFileSync(runner, join(cwd, 'scripts/test.mjs'));
		write('scripts/instrument-source.mjs', `
			export function getInstrumentCacheNamespace() { throw new Error('Unexpected source instrumentation'); }
		`);
		write('scripts/register-hooks.mjs', `throw new Error('Unexpected instrumentation hooks');`);
		write('fixture.mjs', `
			import { it } from 'node:test';
			import assert from 'node:assert/strict';
			import { existsSync, writeFileSync } from 'node:fs';
			import { resolve } from 'node:path';
			it('V8 pipeline fixture', () => {
				assert.equal(globalThis.__coverage__, undefined);
				assert.equal(process.env.NODE_V8_COVERAGE, resolve('.cache/test-v8/raw'));
				assert.equal(process.env.UPLOT_COVERAGE_DIR, undefined);
				assert.equal(process.env.UPLOT_INSTRUMENT_CACHE_DIR, undefined);
				assert.equal(process.env.NODE_OPTIONS, undefined);
				for (const name of ['stale.txt', 'raw/stale.json', 'istanbul/coverage.json'])
					assert.equal(existsSync(resolve('.cache/test-v8', name)), false, name);
				writeFileSync('fixture-observed.json', JSON.stringify({ rawDir: process.env.NODE_V8_COVERAGE }));
				assert.equal(process.env.FIXTURE_FAIL, '0', 'intentional V8 fixture failure');
			});
		`);
		write('scripts/v8-coverage.mjs', `
			import assert from 'node:assert/strict';
			import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
			import { resolve } from 'node:path';
			import { pathToFileURL } from 'node:url';
			const [rawDir, outputDir] = process.argv.slice(2);
			assert.equal(process.env.NODE_V8_COVERAGE, undefined);
			assert.equal(process.env.NODE_OPTIONS, undefined);
			assert.deepEqual([rawDir, outputDir], [resolve('.cache/test-v8/raw'), resolve('.cache/test-v8/istanbul')]);
			assert.ok(existsSync('fixture-observed.json'), 'tests must run before conversion');
			assert.equal(existsSync(resolve(outputDir, 'coverage.json')), false, 'stale converted output');
			const raw = readdirSync(rawDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(resolve(rawDir, name), 'utf8')));
			assert.ok(raw.some(entry => entry.result.some(script => script.url === pathToFileURL(resolve('fixture.mjs')).href)), 'Node must flush fixture coverage before conversion');
			writeFileSync('conversion-observed.json', JSON.stringify({ rawDir, outputDir }));
			if (process.env.CONVERT_STATUS !== '0')
				process.exit(Number(process.env.CONVERT_STATUS));
			mkdirSync(outputDir, { recursive: true });
			writeFileSync(resolve(outputDir, 'coverage.json'), JSON.stringify({ converted: true }));
		`);
		write('scripts/report-coverage.mjs', `
			import assert from 'node:assert/strict';
			import { readFileSync, writeFileSync } from 'node:fs';
			import { resolve } from 'node:path';
			const [outputDir] = process.argv.slice(2);
			assert.equal(process.env.NODE_V8_COVERAGE, undefined);
			assert.equal(process.env.NODE_OPTIONS, undefined);
			assert.equal(outputDir, resolve('.cache/test-v8/istanbul'));
			assert.deepEqual(JSON.parse(readFileSync(resolve(outputDir, 'coverage.json'), 'utf8')), { converted: true });
			writeFileSync('report-observed.json', JSON.stringify({ outputDir }));
			process.exitCode = Number(process.env.REPORT_STATUS);
		`);
		write('.cache/test-v8/stale.txt', 'stale');
		write('.cache/test-v8/raw/stale.json', 'stale raw JSON');
		write('.cache/test-v8/istanbul/coverage.json', 'stale Istanbul JSON');
		write('.nyc_output/node.json', '{"sentinel":"node"}');
		write('.nyc_output/bun/bun.json', '{"sentinel":"bun"}');
		write('.cache/unrelated/sentinel.txt', 'keep');
	});

	afterEach(() => {
		if (cwd != null)
			rmSync(cwd, { recursive: true, force: true });
	});

	function run(overrides = {}) {
		// Exercise the Node-only pipeline even when Bun runs this test file.
		const result = spawnSync('node', ['scripts/test.mjs', '--coverage-provider=v8', 'fixture.mjs'], {
			cwd, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000,
		});
		assert.ifError(result.error);
		assert.equal(result.signal, null, result.stdout + result.stderr);
		return result;
	}

	function assertStages(reported = true) {
		const rawDir = join(cwd, '.cache/test-v8/raw');
		const outputDir = join(cwd, '.cache/test-v8/istanbul');
		assert.deepEqual(read('fixture-observed.json'), { rawDir });
		assert.deepEqual(read('conversion-observed.json'), { rawDir, outputDir });
		if (reported)
			assert.deepEqual(read('report-observed.json'), { outputDir });
		else {
			assert.equal(existsSync(join(cwd, 'report-observed.json')), false);
			assert.equal(existsSync(join(outputDir, 'coverage.json')), false);
		}
	}

	it('collects without instrumentation, cleans only its own output and reports converted coverage', { timeout: 15000 }, () => {
		const snapshot = () => readdirSync(join(cwd, '.nyc_output'), { recursive: true }).sort().map(name => {
			const filename = join(cwd, '.nyc_output', name), stat = statSync(filename);
			return [name, stat.mtimeMs, stat.isFile() ? readFileSync(filename, 'utf8') : null];
		});
		const before = snapshot();
		const result = run();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assertStages();
		assert.deepEqual(snapshot(), before);
		assert.equal(readFileSync(join(cwd, '.cache/unrelated/sentinel.txt'), 'utf8'), 'keep');
		assert.equal(existsSync(join(cwd, '.cache/test-instrument')), false);
	});

	for (const [name, overrides, status, reported] of [
		['reports after test failure and preserves the test status', { FIXTURE_FAIL: '1' }, 1, true],
		['propagates conversion failure and skips reporting', { CONVERT_STATUS: '23' }, 23, false],
		['propagates reporting failure', { REPORT_STATUS: '24' }, 24, true],
		['preserves test failure when reporting also fails', { FIXTURE_FAIL: '1', REPORT_STATUS: '24' }, 1, true],
		['preserves test failure when conversion also fails', { FIXTURE_FAIL: '1', CONVERT_STATUS: '23' }, 1, false],
	]) {
		it(name, { timeout: 15000 }, () => {
			const result = run(overrides);
			assert.equal(result.status, status, result.stdout + result.stderr);
			assertStages(reported);
			if (overrides.FIXTURE_FAIL === '1')
				assert.match(result.stdout + result.stderr, /intentional V8 fixture failure/);
		});
	}
});
