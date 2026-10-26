// Served as /bench.mjs. The parent loads demoDependencies scripts/styles first,
// installs graphics observers in trace/memory mode, and sets a 1920x1080 viewport.
import {demoDependencies, assertDemoAvailable} from '/bench/demo-dependencies.mjs';
import {prepareDemoRuntime} from '/bench/demo-runtime.mjs';
import {createDashboardLifecycle} from '/bench/dashboard/lifecycle.mjs';

const variant = new URL(location.href).searchParams.get('variant');
if (!variant || !/^[a-z0-9-]+$/.test(variant))
	throw new Error('Dashboard requires ?variant=<id>.');
// Single-chart benchmark restrictions do not establish dashboard support.
// The selected dashboard adapter must exist and satisfy the lifecycle contract.
assertDemoAvailable(variant, globalThis.benchmarkLightningChartOptions);

async function runtimeAssets(path) {
	const response = await fetch(path);
	if (!response.ok) throw new Error(`Runtime assets: HTTP ${response.status}`);
	return response.json();
}
if (variant === 'scichart')
	await prepareDemoRuntime(variant, await runtimeAssets('/bench/runtime-assets.json'));
if (demoDependencies[variant].some(dependency => dependency.type === 'module'))
	await prepareDemoRuntime(variant, await runtimeAssets('/bench/module-assets.json'));
if (variant === 'chartgpu' && typeof globalThis.benchmarkChartGPU?.ChartGPU?.create !== 'function')
	throw new Error('ChartGPU runtime must expose benchmarkChartGPU.ChartGPU.create.');
if (variant === 'chartjs' && globalThis.Chart?._adapters?._date?.prototype._id !== 'date-fns')
	throw new Error('Load the Chart.js date-fns adapter before this module.');
if ((variant === 'uplot' || variant === 'uplot-release') &&
	typeof globalThis[variant === 'uplot' ? 'uPlot' : 'uPlotRelease'] !== 'function')
	throw new Error('Expected the selected uPlot IIFE to load before the benchmark fixture.');

const source = variant === 'idle' ? null : await import(`/bench/dashboard/${variant}.mjs`);
await source?.prepareRuntime?.();
const {benchmarkLifecycle, runBenchmarkTrace} = createDashboardLifecycle({variant, source});
await document.fonts.ready;
globalThis.benchmarkLifecycle = benchmarkLifecycle;
globalThis.runBenchmarkTrace = runBenchmarkTrace;
globalThis.benchmarkTraceReady = true;
