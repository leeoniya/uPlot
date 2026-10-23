import { readFileSync } from 'node:fs';
import { demoDependencies } from '../bench/demo-dependencies.mjs';

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
	for (const route of ['/bench/demo-fixture.mjs', '/bench/demo-dependencies.mjs', '/bench/demo.css'])
		read(route);

	const variants = variant === null ? Object.keys(demoDependencies) : [variant];
	for (const id of variants) {
		if (id !== 'idle')
			read(`/bench/${id}.mjs`);
		for (const {name, version, path, type} of demoDependencies[id]) {
			if (name) {
				const cacheName = `${name.replace(/^@/, '').replaceAll('/', '-')}-${version}-${path.replaceAll('/', '-')}`;
				dependencies.push({name, version, url: `https://cdn.jsdelivr.net/npm/${name}@${version}/${path}`,
					route: '/bench/vendor/' + cacheName, cacheName, ...(type === 'style' ? {type} : {})});
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
