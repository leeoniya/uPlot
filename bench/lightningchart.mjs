// @lightningchart/lcjs 9.0.0 (replaces @arction/lcjs); browser global: lcjs.
// Minified production bundle: dist/lcjs.iife.es2019.js.
// https://lightningchart.com/js-charts/docs/licenses/
// https://cdn.jsdelivr.net/npm/@lightningchart/lcjs@9.0.0/LICENSE (Article XXIV)
// Before makeChart(), supply globalThis.benchmarkLightningChartOptions with:
// - license: your valid vendor-issued license key (never committed here)
// - licenseInformation: vendor-required metadata, if your license needs it
// - benchmarkPermission: true ONLY after obtaining prior written vendor permission
//   to run performance comparisons and, separately as applicable, publish results.
// No automatic community-license fallback; do not remove vendor branding.

const owners = new WeakMap();

export function prepData(packed) {
	const fields = packed[0];
	const start = fields + 1;
	const count = (packed.length - start) / fields;
	const x = new Float64Array(count);
	const cpu = new Float64Array(count);
	const ram = new Float64Array(count);
	const tcp = new Float64Array(count);

	for (let i = start, j = 0; i < packed.length; i += fields, j++) {
		x[j] = packed[i] * 60000;
		cpu[j] = Math.round((100 - packed[i + 1]) * 1000) / 1000;
		ram[j] = Math.round(100 * packed[i + 5] / (packed[i + 5] + packed[i + 6]) * 100) / 100;
		tcp[j] = packed[i + 3];
	}

	return {x, cpu, ram, tcp};
}

export async function makeChart(data, host, wait) {

	const options = globalThis.benchmarkLightningChartOptions;
	if (typeof options?.license !== 'string' || !options.license.trim())
		throw new Error('LightningChart 9.0.0 requires a user-supplied license in globalThis.benchmarkLightningChartOptions.license.');
	if (options.benchmarkPermission !== true)
		throw new Error('LightningChart EULA Article XXIV requires prior written vendor permission for performance comparisons. Set benchmarkLightningChartOptions.benchmarkPermission only after obtaining permission.');
	if (!globalThis.lcjs)
		throw new Error('Load @lightningchart/lcjs 9.0.0 dist/lcjs.iife.es2019.js before makeChart().');

	const {lightningChart, AxisTickStrategies, AxisScrollStrategies, Themes, disableThemeEffects, SolidLine, SolidFill, ColorRGBA} = globalThis.lcjs;
	const lc = lightningChart({license: options.license, licenseInformation: options.licenseInformation});
	try {
		const chart = lc.ChartXY({container: host, theme: disableThemeEffects(Themes.light)});
		owners.set(chart, lc);
		chart.setAnimationsEnabled(false);
		const xAxis = chart.getDefaultAxisX()
			.setTickStrategy(AxisTickStrategies.DateTime)
			.setScrollStrategy(AxisScrollStrategies.fitting);
		const percentAxis = chart.getDefaultAxisY()
			.setTitle('CPU / RAM (%)')
			.setScrollStrategy(AxisScrollStrategies.fitting);
		const tcpAxis = chart.addAxisY({opposite: true})
			.setTitle('TCP Out (MB)')
			.setScrollStrategy(AxisScrollStrategies.fitting);
		for (const axis of [xAxis, percentAxis, tcpAxis])
			axis.setAnimationsEnabled(false);

		for (const [name, values, yAxis, color] of [
			['CPU', data.cpu, percentAxis, ColorRGBA(255, 0, 0)],
			['RAM', data.ram, percentAxis, ColorRGBA(0, 0, 255)],
			['TCP Out', data.tcp, tcpAxis, ColorRGBA(0, 128, 0)],
		]) {
			// v9 schema replaces the old dataPattern API. Keep every input sample.
			// addLineSeries disables point markers and area fill.
			chart.addLineSeries({
				xAxis,
				yAxis,
				schema: {
					x: {pattern: 'progressive', storage: Float64Array},
					y: {pattern: null, storage: Float64Array},
				},
				autoSortingEnabled: false,
				// Recommended v9 default: native zoom-dependent grouping of dense data.
				// All samples remain stored; setMaxSampleCount below retains the full input.
				allowDataGrouping: true,
			})
				.setName(name)
				.setMaxSampleCount(data.x.length)
				.setStrokeStyle(new SolidLine({thickness: 1, fillStyle: new SolidFill({color})}))
				.appendSamples({x: data.x, y: values});
		}

		await new Promise((resolve, reject) => {
			const cleanup = () => {
				chart.engine.removeEventListener('renderframe', rendered);
				chart.removeEventListener('dispose', disposed);
			};
			const rendered = event => {
				if (!event.asyncRenderingPending) {
					cleanup();
					resolve();
				}
			};
			const disposed = () => {
				cleanup();
				reject(new Error('LightningChart was disposed before rendering completed.'));
			};
			chart.engine.addEventListener('renderframe', rendered);
			chart.addEventListener('dispose', disposed);
		});

		if (wait)
			wait.textContent = 'Done!';
		return chart;
	}
	catch (error) {
		lc.dispose();
		throw error;
	}
}

export function destroyChart(chart) {
	const lc = owners.get(chart);
	if (lc) {
		owners.delete(chart);
		// Chart disposal alone does not release the shared rendering engine.
		lc.dispose();
	}
}
