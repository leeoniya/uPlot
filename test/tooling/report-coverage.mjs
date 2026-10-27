import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const script = fileURLToPath(new URL('../../scripts/report-coverage.mjs', import.meta.url));

function location(line, column = 0) {
	return { start: { line, column }, end: { line, column: column + 1 } };
}

function coverage(path, statements, functions, branches) {
	return {
		path,
		statementMap: Object.fromEntries([1, 2, 3, 4].map((line, id) => [id, location(line)])),
		fnMap: Object.fromEntries([1, 3].map((line, id) => [id, {
			name: 'fn' + id, decl: location(line), loc: location(line), line,
		}])),
		branchMap: Object.fromEntries([2, 4].map((line, id) => [id, {
			type: 'cond-expr', loc: location(line), line,
			locations: [location(line), location(line, 2)],
		}])),
		s: Object.fromEntries(statements.map((count, id) => [id, count])),
		f: Object.fromEntries(functions.map((count, id) => [id, count])),
		b: { 0: branches.slice(0, 2), 1: branches.slice(2) },
	};
}

function writeCoverage(filename, ...files) {
	mkdirSync(dirname(filename), { recursive: true });
	writeFileSync(filename, JSON.stringify(Object.fromEntries(files.map(file => [file.path, file]))));
}

function row(output, name) {
	const matches = output.split('\n').map(line => line.split('|').map(cell => cell.trim()))
		.filter(cells => cells[0] === name);
	assert.equal(matches.length, 1, output);
	return matches[0].slice(1);
}

describe('coverage text report', function() {
	let cwd;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), 'uplot-report-coverage-'));
	}, { timeout: 15000 });

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	}, { timeout: 15000 });

	function run(args = []) {
		const result = spawnSync(process.execPath, [script, ...args], {
			cwd, env: { ...process.env, NODE_OPTIONS: '' },
			encoding: 'utf8', timeout: 10000,
		});
		assert.ifError(result.error);
		assert.equal(result.signal, null, result.stdout + result.stderr);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return stripVTControlCharacters(result.stdout);
	}

	it('merges root and nested JSON coverage, including repeated and distinct source files', { timeout: 15000 }, () => {
		const input = join(cwd, 'coverage');
		const a = join(cwd, 'a.js');
		const b = join(cwd, 'b.js');
		writeCoverage(join(input, 'root.json'), coverage(a, [1, 0, 0, 0], [1, 0], [1, 0, 0, 0]));
		writeCoverage(join(input, 'worker/part.json'), coverage(a, [0, 1, 0, 0], [0, 1], [0, 1, 0, 0]));
		writeCoverage(join(input, 'worker/deep/part.json'),
			coverage(a, [0, 0, 1, 0], [0, 0], [0, 0, 1, 0]),
			coverage(b, [1, 1, 1, 1], [1, 1], [1, 1, 1, 1]),
		);
		writeFileSync(join(input, 'worker/ignored.txt'), 'not JSON');

		const output = run([input]);
		assert.deepEqual(row(output, 'File'), ['% Stmts', '% Branch', '% Funcs', '% Lines', 'Uncovered Line #s']);
		assert.deepEqual(row(output, 'All files'), ['87.5', '87.5', '100', '87.5', '']);
		assert.deepEqual(row(output, 'a.js'), ['75', '75', '100', '75', '4']);
		assert.deepEqual(row(output, 'b.js'), ['100', '100', '100', '100', '']);
	});

	it('defaults to .nyc_output in the working directory and reports uncovered line ranges', { timeout: 15000 }, () => {
		writeCoverage(join(cwd, '.nyc_output/part.json'),
			coverage(join(cwd, 'a.js'), [1, 0, 0, 1], [1, 0], [1, 0, 0, 0]),
		);

		const output = run();
		assert.deepEqual(row(output, 'All files'), ['50', '25', '50', '50', '']);
		assert.deepEqual(row(output, 'a.js'), ['50', '25', '50', '50', '2-3']);
	});

	it('reports branch-only gaps when every statement and line is covered', { timeout: 15000 }, () => {
		writeCoverage(join(cwd, 'coverage/part.json'),
			coverage(join(cwd, 'a.js'), [1, 1, 1, 1], [1, 1], [1, 0, 1, 1]),
		);

		const output = run(['coverage']);
		assert.deepEqual(row(output, 'a.js'), ['100', '75', '100', '100', '2']);
	});

	it('reports core and plugin coverage separately after merging worker output', { timeout: 15000 }, () => {
		const input = join(cwd, 'coverage');
		const core = join(cwd, 'src/uPlot.js');
		const plugin = join(cwd, 'demos/lib/barChartPlugin.js');
		const dependency = join(cwd, 'demos/lib/barHover.js');
		writeCoverage(join(input, 'main.json'),
			coverage(core, [1, 1, 1, 1], [1, 1], [1, 1, 1, 1]),
			coverage(plugin, [1, 0, 0, 0], [1, 0], [1, 0, 0, 0]),
		);
		writeCoverage(join(input, 'worker/part.json'),
			coverage(plugin, [0, 1, 0, 0], [0, 1], [0, 1, 0, 0]),
			coverage(dependency, [0, 0, 0, 0], [0, 0], [0, 0, 0, 0]),
		);

		const output = run([input]);
		const [coreTable, pluginTable] = output.split('\nPlugins\n');
		assert.match(coreTable, /uPlot core/);
		assert.deepEqual(row(coreTable, 'All files'), ['100', '100', '100', '100', '']);
		assert.deepEqual(row(pluginTable, 'All files'), ['25', '25', '50', '25', '']);
		assert.deepEqual(row(pluginTable, 'barChartPlugin.js'), ['50', '50', '100', '50', '3-4']);
		assert.deepEqual(row(pluginTable, 'barHover.js'), ['0', '0', '0', '0', '1-4']);
		assert.doesNotMatch(coreTable, /barChartPlugin|barHover/);
		assert.doesNotMatch(pluginTable, /uPlot\.js/);
	});

	it('reports a plugin-only run without an empty core table', { timeout: 15000 }, () => {
		writeCoverage(join(cwd, 'coverage/part.json'),
			coverage(join(cwd, 'demos/lib/scatterPlugin.js'), [1, 1, 1, 1], [1, 1], [1, 1, 1, 1]),
		);
		const output = run(['coverage']);
		assert.match(output, /Plugins/);
		assert.doesNotMatch(output, /uPlot core/);
		assert.deepEqual(row(output, 'All files'), ['100', '100', '100', '100', '']);
	});

	for (const emptyMaps of [false, true]) {
		it(`exits successfully without a table for ${emptyMaps ? 'empty coverage maps' : 'an empty input directory'}`, { timeout: 15000 }, () => {
			const input = join(cwd, '.nyc_output');
			mkdirSync(input);
			if (emptyMaps) {
				writeCoverage(join(input, 'empty.json'));
				writeCoverage(join(input, 'worker/empty.json'));
			}

			assert.equal(run().trim(), '');
		});
	}
});
