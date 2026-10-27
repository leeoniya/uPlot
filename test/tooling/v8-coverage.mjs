import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertV8Coverage } from '../../scripts/v8-coverage.mjs';

const script = fileURLToPath(new URL('../../scripts/v8-coverage.mjs', import.meta.url));
const source = [
	'function choose(flag) {',
	'  if (flag) {',
	'    const missed = 1;',
	'    return missed;',
	'  }',
	'  return 2;',
	'}',
	'choose(process.argv[2] === "yes");',
	'',
].join('\n');

function isolatedEnv(extra = {}) {
	const env = { ...process.env };
	for (const name of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NYC_CONFIG', 'UPLOT_COVERAGE_DIR'])
		delete env[name];
	return { ...env, ...extra };
}

function record(filename, text, functions = [{
	functionName: '', isBlockCoverage: true,
	ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }],
}]) {
	return { scriptId: '1', url: pathToFileURL(filename).href, functions };
}

function functionCount(file, name) {
	const ids = Object.keys(file.fnMap).filter(id => file.fnMap[id].name === name);
	assert.equal(ids.length, 1, `expected one function named ${name}`);
	return file.f[ids[0]];
}

function sourceMap(original, text) {
	return {
		version: 3, sources: [pathToFileURL(original).href], sourcesContent: [text], names: [],
		mappings: ';;' + text.trimEnd().split('\n').map((_, index) => index === 0 ? 'AAAA' : 'AACA').join(';'),
	};
}

describe('V8 coverage conversion', () => {
	let cwd;
	let rawDir;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), 'uplot-v8-coverage-'));
		rawDir = join(cwd, 'raw');
		mkdirSync(rawDir);
	});

	afterEach(() => rmSync(cwd, { recursive: true, force: true }));

	function write(name, text) {
		const filename = join(cwd, name);
		mkdirSync(dirname(filename), { recursive: true });
		writeFileSync(filename, text);
		return filename;
	}

	function raw(name, value) {
		writeFileSync(join(rawDir, name + '.json'), JSON.stringify(value));
	}

	function convert(config = {}) {
		return convertV8Coverage(rawDir, { cwd, include: ['src/**/*.js', 'src/**/*.mjs'], exclude: [], ...config });
	}

	function run(executable, args, env = {}) {
		const result = spawnSync(executable, args, {
			cwd, env: isolatedEnv(env), encoding: 'utf8', timeout: 10000,
		});
		assert.ifError(result.error);
		assert.equal(result.signal, null, result.stdout + result.stderr);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return result;
	}

	function collect(filename, args = []) {
		// Bun runs the conversion tests too, but only Node produces V8 coverage.
		run('node', [filename, ...args], { NODE_V8_COVERAGE: rawDir });
	}

	it('returns a CoverageMap containing only loaded files by default', async () => {
		const text = 'export const value = 1;\n';
		const loaded = write('src/loaded.mjs', text);
		write('src/not-loaded.mjs', text);
		raw('loaded', { result: [record(loaded, text)] });
		const map = await convert();
		assert.deepEqual(map.files(), [loaded]);
		assert.equal(map.fileCoverageFor(loaded).getLineCoverage()[1], 1);
		assert.equal(map.getCoverageSummary().lines.pct, 100);
	});

	it('accepts a valid empty result and ignores non-JSON files', async () => {
		raw('empty', { result: [] });
		write('raw/readme.txt', 'not coverage JSON');
		assert.deepEqual((await convert()).files(), []);
	});

	it('rejects a missing raw directory', async () => {
		rmSync(rawDir, { recursive: true });
		await assert.rejects(convert());
	});

	it('rejects a directory without raw JSON even if other files exist', async () => {
		await assert.rejects(convert());
		write('raw/readme.txt', 'not coverage JSON');
		await assert.rejects(convert());
	});

	it('rejects malformed JSON instead of silently ignoring it', async () => {
		raw('valid', { result: [] });
		write('raw/broken.json', '{"result":');
		await assert.rejects(convert());
	});

	for (const [name, value] of [
		['null document', null],
		['missing result', {}],
		['non-array result', { result: {} }],
		['null script', { result: [null] }],
	]) {
		it(`rejects an invalid raw schema: ${name}`, async () => {
			raw('invalid', value);
			await assert.rejects(convert());
		});
	}

	it('rejects invalid function data for an included script', async () => {
		const filename = write('src/invalid.mjs', 'export const value = 1;\n');
		raw('invalid', { result: [{ scriptId: '1', url: pathToFileURL(filename).href, functions: null }] });
		await assert.rejects(convert());
	});

	it('filters excluded paths and non-file URLs before reading source files', async () => {
		const text = 'export const value = 1;\n';
		const included = write('src/included.mjs', text);
		const excluded = ['src/ignored.mjs', 'other/outside.mjs', 'src/node_modules/pkg/index.mjs'];
		const records = [record(included, text), ...excluded.map(name => record(join(cwd, name), text))];
		for (const url of ['node:fs', 'https://example.invalid/source.mjs', 'data:text/javascript,void 0', ''])
			records.push({ ...record(included, text), url });
		raw('filtered', { result: records });
		assert.deepEqual((await convert({ exclude: ['src/ignored.mjs'] })).files(), [included]);
	});

	it('decodes spaces and removes query strings and fragments from file URLs', async () => {
		const text = 'export const value = 1;\n';
		const filename = write('src/file with spaces.mjs', text);
		const entry = record(filename, text);
		entry.url += '?instance=one#fragment';
		raw('query', { result: [entry] });
		const map = await convert();
		assert.deepEqual(map.files(), [filename]);
		assert.equal(map.fileCoverageFor(filename).getLineCoverage()[1], 1);
	});

	it('merges inherited V8 counts before converting dissimilar range trees', async () => {
		const text = 'function work() {\n  const value = 1;\n  return value;\n}\nwork();\n';
		const filename = write('src/inherited.mjs', text);
		const endOffset = text.indexOf('\nwork();');
		const childStart = text.indexOf('  const');
		const childEnd = text.indexOf('\n}');
		function processRecord(count, child) {
			return record(filename, text, [
				{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: text.length, count: 1 }] },
				{ functionName: 'work', isBlockCoverage: true, ranges: [
					{ startOffset: 0, endOffset, count },
					...(child ? [{ startOffset: childStart, endOffset: childEnd, count: 0 }] : []),
				] },
			]);
		}
		raw('first', { result: [processRecord(1, true)] });
		raw('second', { result: [processRecord(2, false)] });
		const file = (await convert()).fileCoverageFor(filename);
		assert.equal(functionCount(file, 'work'), 3);
		assert.equal(file.getLineCoverage()[2], 2);
		assert.equal(file.getLineCoverage()[3], 2);
		const childBranches = Object.keys(file.branchMap).filter(id => file.branchMap[id].loc.start.line === 2);
		assert.equal(childBranches.length, 1);
		// The second process has no explicit child range: its parent count still applies.
		assert.deepEqual(file.b[childBranches[0]], [2]);
	});

	it('preserves an unexecuted multiline branch and a named function from Node', { timeout: 15000 }, async () => {
		const filename = write('src/branch.mjs', source);
		collect(filename, ['no']);
		const file = (await convert()).fileCoverageFor(filename);
		assert.equal(functionCount(file, 'choose'), 1);
		assert.equal(file.getLineCoverage()[3], 0);
		assert.equal(file.getLineCoverage()[4], 0);
		assert.equal(file.getLineCoverage()[6], 1);
		assert.ok(Object.values(file.b).some(counts => counts.includes(0)));
	});

	it('merges complementary branches collected from multiple Node processes', { timeout: 15000 }, async () => {
		const filename = write('src/complementary.mjs', source);
		collect(filename, ['no']);
		collect(filename, ['yes']);
		assert.ok(readdirSync(rawDir).filter(name => name.endsWith('.json')).length >= 2);
		const map = await convert();
		assert.deepEqual(map.files(), [filename]);
		const file = map.fileCoverageFor(filename);
		assert.equal(functionCount(file, 'choose'), 2);
		for (const line of [3, 4, 6])
			assert.equal(file.getLineCoverage()[line], 1, `line ${line}`);
		assert.ok(Object.values(file.b).flat().every(count => count > 0));
	});

	it('includes coverage emitted by child processes and worker threads', { timeout: 15000 }, async () => {
		const child = write('src/child.mjs', 'function childTask() { return 1; }\nchildTask();\n');
		const worker = write('src/worker.mjs', 'function workerTask() { return 2; }\nworkerTask();\n');
		const runner = write('runner.mjs', [
			'import { spawnSync } from "node:child_process";',
			'import { Worker } from "node:worker_threads";',
			`const child = spawnSync(process.execPath, [${JSON.stringify(child)}], { env: process.env });`,
			'if (child.error || child.status !== 0) throw child.error || new Error(String(child.stderr));',
			'await new Promise((resolve, reject) => {',
			`  const worker = new Worker(new URL(${JSON.stringify(pathToFileURL(worker).href)}));`,
			'  worker.on("error", reject);',
			'  worker.on("exit", code => code === 0 ? resolve() : reject(new Error("worker exit " + code)));',
			'});',
		].join('\n'));
		collect(runner);
		const map = await convert();
		assert.deepEqual(map.files().sort(), [child, worker].sort());
		assert.equal(functionCount(map.fileCoverageFor(child), 'childTask'), 1);
		assert.equal(functionCount(map.fileCoverageFor(worker), 'workerTask'), 1);
	});

	it('uses Node inline source-map-cache data and line lengths to remap coverage', { timeout: 15000 }, async () => {
		const original = join(cwd, 'src/original.mjs');
		const generated = '// generated\n// header\n' + source;
		const mapping = sourceMap(original, source);
		const filename = write('src/generated.mjs', generated + '//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(mapping)).toString('base64') + '\n');
		collect(filename, ['no']);
		const entries = readdirSync(rawDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(rawDir, name), 'utf8')));
		const cache = entries.map(entry => entry['source-map-cache']?.[pathToFileURL(filename).href]).find(Boolean);
		assert.ok(cache?.data, 'Node must emit parsed source map data');
		assert.ok(Array.isArray(cache.lineLengths), 'Node must emit generated line lengths');
		const map = await convert();
		assert.deepEqual(map.files(), [original]);
		const file = map.fileCoverageFor(original);
		assert.equal(file.getLineCoverage()[3], 0);
		assert.equal(file.getLineCoverage()[4], 0);
		assert.equal(file.getLineCoverage()[6], 1);
		assert.equal(functionCount(file, 'choose'), 1);
	});

	it('preserves unexecuted functions in multi-source Node maps with file URLs', { timeout: 15000 }, async () => {
		const unused = join(cwd, 'src/unused.mjs');
		const used = join(cwd, 'src/used.mjs');
		const unusedSource = 'function unused() {\n  return 1;\n}\n';
		const usedSource = 'function used() {\n  return 2;\n}\nused();\n';
		const mapping = {
			version: 3,
			sources: [pathToFileURL(unused).href, pathToFileURL(used).href],
			sourcesContent: [unusedSource, usedSource], names: [],
			// The fourth generated line switches sources and resets the original line to zero.
			mappings: 'AAAA;AACA;AACA;ACFA;AACA;AACA;AACA',
		};
		const filename = write('src/bundle.mjs', unusedSource + usedSource +
			'//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(mapping)).toString('base64') + '\n');
		collect(filename);
		const entries = readdirSync(rawDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(rawDir, name), 'utf8')));
		const cache = entries.map(entry => entry['source-map-cache']?.[pathToFileURL(filename).href]).find(Boolean);
		assert.deepEqual(cache?.data.sources, mapping.sources);
		assert.ok(Array.isArray(cache.lineLengths));

		const map = await convert();
		assert.deepEqual(map.files().sort(), [unused, used].sort());
		const unexecuted = map.fileCoverageFor(unused);
		assert.equal(functionCount(unexecuted, 'unused'), 0);
		assert.equal(unexecuted.getLineCoverage()[2], 0);
		const executed = map.fileCoverageFor(used);
		assert.equal(functionCount(executed, 'used'), 1);
		assert.equal(executed.getLineCoverage()[2], 1);
	});

	it('applies file selection both before and after source-map remapping', async () => {
		const text = 'export const value = 1;\n';
		const generated = '// generated\n// header\n' + text;
		const allowed = write('src/allowed.mjs', generated);
		const excluded = write('src/excluded.mjs', generated);
		const original = join(cwd, 'src/original.mjs');
		raw('mapped', {
			result: [record(allowed, generated), record(excluded, generated)],
			'source-map-cache': Object.fromEntries([
				[allowed, excluded], [excluded, original],
			].map(([filename, target]) => [pathToFileURL(filename).href, {
				lineLengths: generated.split('\n').map(line => line.length),
				data: sourceMap(target, text), url: null,
			}])),
		});
		assert.deepEqual((await convert({ exclude: ['src/excluded.mjs'] })).files(), []);
	});

	it('writes CLI coverage.json to the requested output directory', { timeout: 15000 }, async () => {
		const text = 'export const value = 1;\n';
		const filename = write('src/cli.mjs', text);
		raw('cli', { result: [record(filename, text)] });
		const output = join(cwd, 'output/nested');
		run(process.execPath, [script, rawDir, output], {
			NYC_CONFIG: JSON.stringify({ cwd, include: ['src/**/*.mjs'], exclude: [] }),
		});
		assert.deepEqual(JSON.parse(readFileSync(join(output, 'coverage.json'), 'utf8')), JSON.parse(JSON.stringify((await convert()).toJSON())));
	});
});
