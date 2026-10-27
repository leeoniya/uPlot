import {assertDemoAvailable} from '../demo-dependencies.mjs';
import {dashboardDependencies} from './dependencies.mjs';
import {loadDependency} from '../demo.mjs';
import {prepareDemoRuntime} from '../demo-runtime.mjs';
import {dashboardData, ROWS} from './common.mjs';
import {createDashboardLayout, createDashboardHosts} from './layout.mjs';

let nextId = 0;

function errorMessage(error) {
	const messages = [], seen = new Set();
	while (error != null && !seen.has(error)) {
		seen.add(error);
		const message = error.message ?? String(error);
		if (!messages.includes(message)) messages.push(message);
		error = error.cause;
	}
	return messages.join(': ');
}

function checkResults(results, variant, phase) {
	const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
	if (errors.length)
		throw new AggregateError(errors, `${variant}: dashboard ${phase} failed: ${errorMessage(errors[0])}`, {cause: errors[0]});
}

// The optional source and loading functions let tooling exercise the native
// lifecycle without downloading vendors or replacing browser globals.
export async function createDashboardDemo(source, {
	variant, realm = globalThis, load = loadDependency, prepareRuntime = prepareDemoRuntime,
} = {}) {
	const {document} = realm;
	const status = document.createElement('div');
	status.setAttribute('role', 'status');
	status.textContent = 'Loading dashboard…';
	Object.assign(status.style, {position: 'fixed', top: '8px', left: '8px', zIndex: '2147483647',
		padding: '8px', background: 'white', color: 'black', font: '14px sans-serif',
		maxWidth: 'calc(100vw - 32px)', whiteSpace: 'pre-wrap', pointerEvents: 'none'});
	let fixture, style, hosts = [], inputs = [], destruction;
	const charts = [];

	function destroy() {
		return destruction ??= (async () => {
			try {
				const results = await Promise.allSettled([...new Set(charts)].filter(chart => chart != null)
					.map(async chart => source.destroyChart(chart)));
				checkResults(results, variant, 'destruction');
			}
			finally {
				fixture?.remove();
				style?.remove();
			}
		})();
	}

	try {
		({fixture, style} = createDashboardLayout(document, {interactive: true}));
		document.body.append(status);
		if (typeof variant !== 'string' || !/^[a-z0-9-]+$/.test(variant) || variant === 'idle')
			throw new Error(`Unknown dashboard demo variant: ${variant}`);
		assertDemoAvailable(variant, realm.benchmarkLightningChartOptions);
		for (const dependency of dashboardDependencies(variant)) {
			if (dependency.type !== 'wasm' && dependency.type !== 'module')
				await load(dependency);
		}
		await prepareRuntime(variant);
		source ??= await import(`./${variant}.mjs`);
		for (const method of ['prepData', 'makeChart', 'updateChart', 'validateChart', 'destroyChart']) {
			if (typeof source[method] !== 'function')
				throw new Error(`${variant}: dashboard adapter requires ${method}().`);
		}
		await source.prepareRuntime?.();
		await document.fonts.ready;

		const tiles = createDashboardHosts(fixture, `demo-${++nextId}`);
		hosts = tiles.map(({host}) => host);
		inputs = dashboardData(2).map(frame => source.prepData(frame));
		status.textContent = 'Rendering dashboard…';
		// Await every tile, including late successes after a sibling fails, so
		// all acquired native handles remain available for cleanup.
		checkResults(await Promise.allSettled(tiles.map(async ({host, wait}, i) => {
			const chart = charts[i] = await source.makeChart(inputs[i], host, wait);
			if (chart == null) throw new Error(`${variant}: chart ${i} returned no handle.`);
		})), variant, 'small-init');

		inputs = dashboardData(ROWS).map(frame => source.prepData(frame));
		checkResults(await Promise.allSettled(tiles.map(async ({host, wait}, i) => {
			const result = await source.updateChart(charts[i], inputs[i], host, wait);
			if (result !== undefined && result !== charts[i])
				throw new Error(`${variant}: updateChart must retain chart identity.`);
		})), variant, 'data-update');
		status.remove();
		return {
			variant, charts, hosts, inputs, destroy,
			async validate() {
				if (destruction) throw new Error('Cannot validate a destroyed dashboard.');
				checkResults(await Promise.allSettled(charts.map(async (chart, i) => {
					if (await source.validateChart(chart, inputs[i], {rows: ROWS}) === false)
						throw new Error(`${variant}: chart ${i} failed validation.`);
				})), variant, 'validation');
				return true;
			},
		};
	}
	catch (error) {
		try { await destroy(); }
		catch (cleanupError) {
			error = new AggregateError([error, cleanupError], `${errorMessage(error)}; cleanup failed: ${errorMessage(cleanupError)}`, {cause: error});
		}
		status.setAttribute('role', 'alert');
		status.textContent = `Error: ${errorMessage(error)}`;
		if (!status.isConnected) document.body.append(status);
		throw error;
	}
}

export function runDashboardDemo(variant) {
	return createDashboardDemo(null, {variant});
}
