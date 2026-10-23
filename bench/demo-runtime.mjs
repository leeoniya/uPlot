import {demoDependencies, dependencyUrl} from './demo-dependencies.mjs';

// Download bytes before timing. WASM compilation, instantiation, and ingestion
// remain in makeChart(). Reuse buffer identities so normal vendor caches work.
const binaries = new Map();
export async function prepareDemoRuntime(variant, dependencies = demoDependencies[variant]) {
	for (const dependency of dependencies) {
		const url = dependencyUrl(dependency, import.meta.url);
		if (dependency.type === 'module') {
			const namespace = await import(url);
			const value = dependency.export ? namespace[dependency.export] : namespace;
			if (!value || !dependency.global)
				throw new Error(`Missing module namespace for ${dependency.global}: ${url}`);
			globalThis[dependency.global] = value;
			continue;
		}
		if (dependency.type !== 'wasm')
			continue;
		if (!binaries.has(url)) {
			binaries.set(url, fetch(url).then(response => {
				if (!response.ok)
					throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
				return response.arrayBuffer();
			}).catch(error => {
				binaries.delete(url);
				throw error;
			}));
		}
		const binary = await binaries.get(url);
		if (variant !== 'scichart')
			throw new Error(`No binary runtime configuration for ${variant}.`);
		const options = globalThis.benchmarkSciChartOptions ??= {};
		options[dependency.option] = binary;
	}
}
