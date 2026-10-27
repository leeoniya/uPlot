import { globSync, statSync } from 'node:fs';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';

const extensions = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'];
const defaultExcludes = [
	'coverage/**', 'packages/*/test{,s}/**', '**/*.d.ts', 'test{,s}/**',
	'test{,-*}.{js,cjs,mjs,ts,tsx,jsx}', '**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}',
	'**/__tests__/**', '**/{ava,babel,nyc}.config.{js,cjs,mjs}',
	'**/jest.config.{js,cjs,mjs,ts}', '**/{karma,rollup,webpack}.config.js',
	'**/.{eslint,mocha}rc.{js,cjs}',
];

function list(value, name) {
	const result = typeof value === 'string' ? [value] : value;
	if (!Array.isArray(result) || result.some(item => typeof item !== 'string'))
		throw new TypeError('Coverage ' + name + ' must be a string or an array of strings.');
	return result;
}

function patterns(values) {
	return values.flatMap(value => {
		const pattern = value.replace(/^\.\//, '').replace(/\/$/, '');
		return [pattern, pattern + '/**'];
	});
}

export function coverageFiles(config = {}) {
	const cwd = resolve(config.cwd ?? process.cwd());
	if (config.relativePath === false)
		throw new Error('Coverage paths must be relative to cwd.');
	const include = list(config.include ?? [], 'include');
	const exclude = list(config.exclude ?? defaultExcludes, 'exclude');
	const extension = list(config.extension ?? extensions, 'extension');
	const included = patterns(include.filter(pattern => !pattern.startsWith('!')));
	const excluded = patterns([
		...exclude.filter(pattern => !pattern.startsWith('!')),
		...include.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1)),
	]);
	const restored = patterns(exclude.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1)));
	const excludeNodeModules = config.excludeNodeModules !== false;
	const matches = (filename, rules) => rules.some(pattern => matchesGlob(filename, pattern));

	function shouldInstrument(filename) {
		const path = relative(cwd, resolve(filename));
		if (isAbsolute(path) || path === '..' || path.startsWith('..' + sep))
			return false;
		const name = path.split(sep).join('/');
		if (excludeNodeModules && name.split('/').includes('node_modules'))
			return false;
		if (extension.length > 0 && !extension.some(ext => name.endsWith(ext)))
			return false;
		return (include.length === 0 || matches(name, included)) &&
			(!matches(name, excluded) || matches(name, restored));
	}

	function files() {
		const selected = new Set();
		// Enumerate only include roots instead of scanning unrelated caches and demos.
		for (const filename of globSync(include.length === 0 ? '**/*' : included, {
			cwd,
			exclude: excludeNodeModules ? ['**/node_modules/**'] : [],
		})) {
			const absolute = resolve(cwd, filename);
			if (shouldInstrument(absolute) && statSync(absolute).isFile())
				selected.add(absolute);
		}
		return [...selected].sort();
	}

	return { shouldInstrument, files };
}
