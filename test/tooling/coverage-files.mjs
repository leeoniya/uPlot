import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageFiles } from '../../scripts/coverage-files.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));

describe('coverage file selection', () => {
	let cwd;
	const fixture = [
		'src/a.js', 'src/deep/b.mjs', 'src/ignore.js', 'src/a.test.js', 'src/types.d.ts',
		'src/module.cjs', 'src/component.jsx', 'src/component.tsx', 'src/component.ts', 'src/data.json',
		'test/check.mjs', 'tests/check.js', 'coverage/out.js', 'packages/pkg/tests/sample.js',
		'node_modules/pkg/index.js', 'src/node_modules/pkg/index.js', 'other/out.js', 'webpack.config.js',
	];
	const write = name => {
		const filename = join(cwd, name);
		mkdirSync(dirname(filename), { recursive: true });
		writeFileSync(filename, 'export const value = 1;');
	};
	const select = config => coverageFiles({ cwd, ...config });
	const paths = names => names.map(name => join(cwd, name)).sort();

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), 'uplot-coverage-files-'));
		fixture.forEach(write);
	});
	afterEach(() => rmSync(cwd, { recursive: true, force: true }));

	it('enumerates only files and deduplicates overlapping include patterns', () => {
		mkdirSync(join(cwd, 'src/directory.js'));
		const selection = select({ include: ['src/**/*.js', 'src/a.js'], exclude: ['src/ignore.js', '**/*.test.js'] });
		assert.deepEqual(selection.files(), paths(['src/a.js']));
		assert.equal(selection.shouldInstrument(join(cwd, 'other/out.js')), false);
	});

	it('accepts string options, directory shorthand and leading ./', () => {
		const selection = select({ include: './src/', exclude: 'src/deep', extension: '.mjs' });
		assert.deepEqual(selection.files(), []);
		assert.deepEqual(select({ include: './src/', exclude: [], extension: '.cjs' }).files(), paths(['src/module.cjs']));
	});

	it('uses the existing source extensions and default test/config exclusions', () => {
		assert.deepEqual(select({}).files(), paths([
			'src/a.js', 'src/deep/b.mjs', 'src/ignore.js', 'src/module.cjs',
			'src/component.jsx', 'src/component.tsx', 'src/component.ts', 'other/out.js',
		]));
	});

	it('allows explicit empty exclusions and extension lists', () => {
		assert.deepEqual(select({ include: 'src/data.json', exclude: [], extension: [] }).files(), paths(['src/data.json']));
		assert.deepEqual(select({ include: ['test/check.mjs', 'src/types.d.ts'], exclude: [] }).files(), paths(['test/check.mjs', 'src/types.d.ts']));
	});

	it('applies negated includes and re-includes negated exclusions', () => {
		assert.deepEqual(select({ include: ['src/**', '!src/ignore.js'], exclude: ['src/**', '!src/a.js'] }).files(), paths(['src/a.js']));
		assert.deepEqual(select({ include: ['!src/**'], exclude: [] }).files(), []);
	});

	it('supports native brace patterns and single-character wildcards', () => {
		assert.deepEqual(select({ include: ['src/?.js', 'src/deep/*.{js,mjs}'], exclude: [] }).files(), paths(['src/a.js', 'src/deep/b.mjs']));
	});

	it('accepts explicit dotfile paths', () => {
		write('src/.explicit.js');
		assert.deepEqual(select({ include: 'src/.explicit.js', exclude: [] }).files(), paths(['src/.explicit.js']));
	});

	it('excludes nested dependencies unless explicitly enabled', () => {
		const config = { include: '**/node_modules/**/*.js', exclude: [] };
		assert.deepEqual(select(config).files(), []);
		assert.deepEqual(select({ ...config, excludeNodeModules: false }).files(), paths(['node_modules/pkg/index.js', 'src/node_modules/pkg/index.js']));
	});

	it('rejects paths outside cwd, including sibling directories with the same prefix', () => {
		const selection = select({ include: '**/*.js', exclude: [] });
		for (const filename of [resolve(cwd, '../outside.js'), cwd + '-other/file.js'])
			assert.equal(selection.shouldInstrument(filename), false);
		assert.equal(selection.shouldInstrument(join(cwd, 'src/../src/a.js')), true);
	});

	it('matches later-created files and returns an empty selection for missing paths', () => {
		const selection = select({ include: 'src/new.js', exclude: [] });
		assert.deepEqual(selection.files(), []);
		write('src/new.js');
		assert.equal(selection.shouldInstrument(join(cwd, 'src/new.js')), true);
		assert.deepEqual(selection.files(), paths(['src/new.js']));
	});

	it('does not modify the supplied configuration', () => {
		const config = Object.freeze({ cwd, include: Object.freeze(['src/a.js']), exclude: Object.freeze([]) });
		assert.deepEqual(coverageFiles(config).files(), paths(['src/a.js']));
	});

	it('rejects invalid pattern lists and non-relative matching', () => {
		for (const name of ['include', 'exclude', 'extension']) {
			for (const value of [1, {}, [null]])
				assert.throws(() => select({ [name]: value }), TypeError);
		}
		assert.throws(() => select({ relativePath: false }), /relative to cwd/);
	});

	it('selects the core and six plugins from the project coverage config', () => {
		const config = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).nyc;
		const selection = coverageFiles({ ...config, cwd: project });
		const files = selection.files();
		assert.ok(files.includes(join(project, 'src/uPlot.js')));
		assert.equal(files.some(file => file.startsWith(join(project, 'dist') + sep)), false);
		assert.equal(selection.shouldInstrument(join(project, 'dist/uPlot.esm.js')), false);
		assert.equal(files.includes(join(project, 'src/paths/catmullRomCentrip.js')), false);
		assert.equal(files.includes(join(project, 'demos/lib/flatbush.js')), false);
		assert.deepEqual(files.filter(file => file.startsWith(join(project, 'demos') + sep)),
			['barChartPlugin', 'barHover', 'barValues', 'distr', 'heatmapPlugin', 'scatterPlugin'].map(name => join(project, 'demos/lib', name + '.js')).sort());
		assert.ok(files.every(selection.shouldInstrument));
	});
});
