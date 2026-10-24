import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {accuracyCases, libraries, referenceOptions, summarizePoints} from '../../demos/reduction-accuracy.js';
import {echartsOptions, chartjsOptions} from '../../demos/decimation-libs.js';
import {epoch, minute} from '../../demos/reduction-accuracy-grouped.js';

const pointsOf = ([xs, ys]) => xs.map((x, i) => [x, ys[i]]);

describe('reduction accuracy comparisons', () => {
	it('provides six deterministic, sorted datasets without custom reduction', () => {
		assert.deepEqual(accuracyCases.map(item => item.id), ['opposite', 'sparse', 'adjacent', 'isolated', 'pulse', 'gap']);
		for (const {data: [xs, ys], detail, description} of accuracyCases) {
			assert.equal(xs.length, 10002);
			assert.equal(ys.length, xs.length);
			assert.ok(xs.every((x, i) => Number.isFinite(x) && (i === 0 || x > xs[i - 1])));
			assert.ok(ys.every(y => y === null || Number.isFinite(y)));
			assert.ok(xs.every(x => Number.isInteger(epoch + x * minute)), 'Integer timestamp encoding for every vendor');
			assert.ok(detail[0] < detail[1] && detail[0] >= xs[0] && detail[1] <= xs.at(-1));
			assert.ok(description);
		}
	});

	it('distinguishes opposite extrema, two peaks, attenuation, plateau, and gaps', () => {
		const summaries = accuracyCases.map(item => summarizePoints(pointsOf(item.data)));
		assert.deepEqual(summaries.map(s => [s.min, s.max, s.positive, s.negative, s.gaps]), [
			[-100, 100, 1, 1, 0], [-100, 100, 1, 1, 0], [0, 100, 2, 0, 0],
			[0, 100, 1, 0, 0], [0, 100, 6, 0, 0], [40, 40, 0, 0, 6],
		]);
		assert.deepEqual(summarizePoints([[0, null], [1, NaN]]), {count: 2, min: null, max: null, positive: 0, negative: 0, gaps: 2});
		const sparse = accuracyCases.find(item => item.id === 'sparse').data[0];
		assert.equal(sparse[9980], 10);
		assert.equal(sparse.at(-1), 100);
	});

	it('uses the default uPlot pathbuilder without input reduction or pixel-ratio overrides', () => {
		for (const {data} of accuracyCases) {
			const opts = referenceOptions(data);
			assert.deepEqual(opts.scales.x.range(), [data[0][0], data[0].at(-1)]);
			assert.deepEqual(opts.scales.y.range(), [-120, 120]);
			assert.equal(opts.series[1].paths, undefined);
			assert.equal(opts.series[1].pxAlign, undefined);
			assert.equal(opts.pxRatio, undefined);
		}
	});

	it('leaves ECharts and Chart.js budgets and activation thresholds at native defaults', () => {
		for (const {data} of accuracyCases) {
			for (const {value} of libraries.echarts.modes) {
				const options = echartsOptions(data, value === 'raw' ? false : value);
				assert.equal(options.series[0].sampling, value === 'raw' ? 'none' : value);
				assert.deepEqual(options.series[0].data, pointsOf(data));
				assert.equal(options.grid, undefined);
			}
			for (const {value} of libraries.chartjs.modes) {
				const options = chartjsOptions(data, value === 'raw' ? false : value);
				const config = options.options.plugins.decimation;
				assert.equal(config.enabled, value !== 'raw');
				assert.equal(config.samples, undefined);
				assert.equal(config.threshold, undefined);
				assert.equal(options.options.devicePixelRatio, undefined);
				assert.deepEqual(options.data.datasets[0].data.map(({x, y}) => [x, y]), pointsOf(data));
			}
		}
	});

	it('reads ApexCharts reduced state, leaves reducer budgets untouched, and disposes errors', async () => {
		const original = globalThis.ApexCharts;
		let config, destroyed = 0, fail = false;
		globalThis.ApexCharts = class {
			constructor(host, options) { config = options; }
			async render() { if (fail) throw new Error('vendor failed'); }
			getState() { return {seriesX: [[0, 5005, 10001]], series: [[0, 100, 0]]}; }
			destroy() { destroyed++; }
		};
		try {
			const data = accuracyCases[0].data;
			const copy = structuredClone(data);
			for (const value of ['lttb', 'raw']) {
				const handle = await libraries.apexcharts.render({}, data, value);
				assert.deepEqual(config.chart.dataReducer, {enabled: value !== 'raw'});
				assert.deepEqual(config.series[0].data, pointsOf(data));
				assert.deepEqual(handle.points, [[0, 0], [5005, 100], [10001, 0]]);
				handle.destroy();
			}
			fail = true;
			await assert.rejects(libraries.apexcharts.render({}, data, 'lttb'), /vendor failed/);
			assert.equal(destroyed, 3);
			assert.deepEqual(data, copy);
		}
		finally { globalThis.ApexCharts = original; }
	});

	it('includes seven libraries and explicit opt-in and preservation alternatives', () => {
		assert.equal(Object.keys(libraries).length, 7);
		for (const id of ['echarts', 'chartjs', 'apexcharts', 'amcharts', 'devextreme'])
			assert.match(libraries[id].modes[0].label, /Opt-in/);
		assert.ok(libraries.echarts.modes.some(mode => mode.value === 'minmax'));
		assert.ok(libraries.chartjs.modes.some(mode => mode.value === 'min-max'));
		assert.deepEqual(libraries.fusiontime.modes.map(mode => mode.value), ['default']);
	});

	it('labels output limits, separate benchmark settings, and non-resampled detail views', async () => {
		const html = await readFile(new URL('../../demos/reduction-accuracy.html', import.meta.url), 'utf8');
		assert.match(html, /Opt-in settings are explicit/);
		assert.match(html, /No universal accuracy claim/);
		assert.match(html, /not speed tests/);
		assert.match(html, /before renderer-specific rounding/);
		assert.match(html, /benchmark uses separate accuracy-first settings/);
		assert.match(html, /id="reference-detail"/);
		assert.match(html, /id="vendor-detail"/);
	});

	it('collapses both diagnostic views without hiding charts or readouts', async () => {
		const {Window} = await import('happy-dom');
		const window = new Window();
		try {
			window.document.body.innerHTML = await readFile(new URL('../../demos/reduction-accuracy.html', import.meta.url), 'utf8');
			const document = window.document;
			const details = document.querySelector('details#developer-details');
			assert.ok(details);
			assert.equal(details.open, false);
			assert.match(details.querySelector('summary').textContent, /Developer details/);
			assert.match(details.textContent, /different rendering stages, not equivalent final images/);
			for (const id of ['reference-detail', 'vendor-detail', 'detail-range'])
				assert.ok(details.contains(document.getElementById(id)), id);
			for (const id of ['reference-chart', 'vendor-chart', 'reference-output', 'vendor-output']) {
				assert.ok(document.querySelector('#comparison').contains(document.getElementById(id)), id);
				assert.ok(!details.contains(document.getElementById(id)), id);
			}
		}
		finally { window.close(); }
	});
});
