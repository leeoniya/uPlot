import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { bundlePath } from '../../scripts/patch-echarts-heatmap.mjs';

describe('ECharts heatmap patch script', () => {
	it('disables rectangle incremental flags in the generated library without breaking progressive rendering', async function() {
		this.timeout(10000);
		let bundle;
		try { bundle = await readFile(new URL(`../../${bundlePath}`, import.meta.url), 'utf8'); }
		catch (error) {
			if (error.code == 'ENOENT') return this.skip(); // Run the download script to enable this integration check.
			throw error;
		}
		const exports = {};
		const context = { module: { exports }, exports, console, setTimeout, clearTimeout };
		context.global = context;
		runInNewContext(bundle, context);
		const echarts = exports;
		assert.equal(echarts.version, '6.1.0');
		echarts.setPlatformAPI({ measureText: text => ({ width: String(text).length * 7 }) });
		const plot = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 400 });
		try {
			plot.setOption({
				animation: false,
				xAxis: { type: 'category', data: ['a', 'b'] },
				yAxis: { type: 'category', data: ['a', 'b'] },
				visualMap: { min: 1, max: 3, show: false },
				series: [{ type: 'heatmap', progressive: 0, data: [[0, 0, 1], [1, 0, 2], [1, 1, 3]] }],
			});
			const model = plot.getModel(), series = model.getSeriesByIndex(0);
			const flags = () => [0, 1, 2].map(i => series.getData().getItemGraphicEl(i).incremental);
			assert.equal(series.get('progressive'), 0);
			assert.ok(!series.pipelineContext.progressiveRender);
			assert.deepEqual(flags(), [0, 0, 0]);
			// SVG SSR does not schedule progressive tasks; invoke the actual heatmap view's other path directly.
			const view = plot.getViewOfSeriesModel(series);
			view.incrementalPrepareRender(series, model, plot._api);
			view.incrementalRender({ start: 0, end: 3 }, series, model, plot._api);
			assert.deepEqual(flags(), [2, 2, 2]);
		}
		finally { plot.dispose(); }
	});
});
