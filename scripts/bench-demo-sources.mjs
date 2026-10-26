import { readFileSync } from 'node:fs';
import { demoDependencies, demoModuleDependencies, dependencyUrl } from '../bench/demo-dependencies.mjs';

// Serve the same modules and styles as the standalone demos, without parsing HTML.
export function loadBenchDemoSources(root, variant = null) {
	if (variant !== null && !Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unknown demo variant: ${variant}`);
	root = new URL(root);
	if (root.protocol !== 'file:' || !root.pathname.endsWith('/') || root.search || root.hash)
		throw new Error('Expected a repository directory file: URL with a trailing slash.');

	const files = new Map();
	const dependencies = [];
	const localScripts = [];
	const localStyles = ['/bench/demo.css'];
	const read = route => {
		try {
			files.set(route, readFileSync(new URL(route.slice(1), root), 'utf8'));
		}
		catch (error) {
			if (error.code === 'ENOENT' && route.startsWith('/dist/'))
				throw new Error(`uPlot benchmark requires ${route.slice(1)}. Run npm run build first.`, {cause: error});
			throw error;
		}
	};
	for (const route of ['/bench/demo-fixture.mjs', '/bench/demo-dependencies.mjs', '/bench/demo-runtime.mjs', '/bench/framework-runtime.mjs', '/bench/lifecycle-data.mjs', '/bench/demo.css'])
		read(route);

	const variants = variant === null ? Object.keys(demoDependencies) : [variant];
	for (const id of variants) {
		if (id !== 'idle') {
			for (const module of [id, ...(demoModuleDependencies[id] ?? [])])
				read(`/bench/${module}.mjs`);
		}
		for (const dependency of demoDependencies[id]) {
			const {name, version, path, type, option, global, alias} = dependency;
			if (name) {
				const cacheName = `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}-${path.replaceAll('/', '-')}${type === 'module' ? '-' + id : ''}`;
				if (!dependencies.some(existing => existing.cacheName === cacheName))
					dependencies.push({name, version, url: dependencyUrl(dependency),
						route: '/bench/vendor/' + cacheName, cacheName, ...(type ? {type} : {}), ...(option ? {option} : {}), ...(global ? {global} : {}), ...(alias ? {alias} : {})});
			}
			else {
				const route = new URL(path, 'http://localhost/bench/').pathname;
				read(route);
				(type === 'style' ? localStyles : localScripts).push(route);
			}
		}
	}
	return {files, dependencies, localScripts, localStyles};
}
