import {demoDependencies, dependencyUrl, assertDemoAvailable} from './demo-dependencies.mjs';
import {applyDemoStyles, setupDemo} from './demo-fixture.mjs';
import {prepareDemoRuntime} from './demo-runtime.mjs';

const dependencyLoads = new Map();
export function loadDependency(dependency) {
	const url = dependencyUrl(dependency, import.meta.url);

	if (!dependencyLoads.has(url)) {
		dependencyLoads.set(url, new Promise((resolve, reject) => {
			const style = dependency.type === 'style';
			const element = document.createElement(style ? 'link' : 'script');
			if (style) {
				element.rel = 'stylesheet';
				element.href = url;
			}
			else
				element.src = url;
			element.onload = () => {
				if (dependency.alias)
					globalThis[dependency.alias] = globalThis[dependency.global];
				resolve();
			};
			element.onerror = () => reject(new Error(`Failed to load ${url}`));
			document.head.append(element);
		}));
	}

	return dependencyLoads.get(url);
}

export async function runDemo(variant) {
	if (!Object.hasOwn(demoDependencies, variant))
		throw new Error(`Unknown demo variant: ${variant}`);

	const parent = document.body;
	const wait = document.createElement('h2');
	wait.id = 'wait';
	wait.textContent = 'Loading lib....';
	parent.append(wait);

	try {
		assertDemoAvailable(variant, globalThis.benchmarkLightningChartOptions);
		for (const dependency of demoDependencies[variant]) {
			if (dependency.type !== 'wasm' && dependency.type !== 'module')
				await loadDependency(dependency);
		}
		await prepareDemoRuntime(variant);

		await applyDemoStyles();
		const source = variant === 'idle' ? null : await import(`./${variant}.mjs`);
		await source?.prepareRuntime?.();
		const host = setupDemo(variant, parent);
		if (!source) {
			wait.textContent = 'Done!';
			return;
		}

		wait.textContent = 'Fetching data.json (2.07MB)....';
		const response = await fetch(new URL('./data.json', import.meta.url));
		if (!response.ok)
			throw new Error(`Failed to load data.json: ${response.status} ${response.statusText}`);
		const packed = await response.json();
		wait.textContent = 'Rendering...';
		const data = source.prepData(packed);
		return await new Promise((resolve, reject) => {
			setTimeout(() => {
				try {
					resolve(source.makeChart(data, host, wait));
				}
				catch (error) {
					reject(error);
				}
			}, 0);
		});
	}
	catch (error) {
		wait.textContent = `Error: ${error.message}`;
		throw error;
	}
}
