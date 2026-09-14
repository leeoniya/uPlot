import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import groups from '../demos/decimation.js';
import { libraryCases, echartsOptions, chartjsOptions } from '../demos/decimation-libs.js';

describe('decimation examples', () => {
	it('provides sorted finite fixtures with the intended spike spacing', () => {
		for (const {id, data: [xs, ys]} of libraryCases) {
			assert.equal(xs.length, 10002);
			assert.equal(ys.length, xs.length);
			assert.ok(xs.every((x, i) => Number.isFinite(x) && (i === 0 || x > xs[i - 1])));
			assert.ok(ys.every(Number.isFinite));
			const spikes = ys.flatMap((y, i) => y === 0 ? [] : [i]);
			assert.equal(spikes.length, 2);
			assert.equal(spikes[1] - spikes[0], id === 'adjacent' ? 20 : id === 'sparse' ? 10 : 5);
			assert.deepEqual(spikes.map(i => ys[i]), id === 'adjacent' ? [100, 100] : [100, -100]);
			if (id === 'sparse') {
				assert.equal(xs[9980], 10);
				assert.equal(xs.at(-1), 100);
			}
		}
	});

	it('configures native library selection rather than pre-sampling their inputs', () => {
		for (const {data} of libraryCases) {
			for (const sampled of [false, true]) {
				const ec = echartsOptions(data, sampled);
				const cj = chartjsOptions(data, sampled);
				assert.equal(ec.series[0].data.length, 10002);
				assert.equal(cj.data.datasets[0].data.length, 10002);
				assert.deepEqual(ec.series[0].data, cj.data.datasets[0].data.map(({x, y}) => [x, y]));
				assert.equal(ec.series[0].sampling, sampled ? 'lttb' : 'none');
				assert.ok(!Object.hasOwn(ec, 'grid'));
				assert.ok(!Object.hasOwn(cj.options, 'devicePixelRatio'));
				assert.equal(cj.options.parsing, false);
				assert.equal(cj.options.plugins.decimation.enabled, sampled);
				assert.equal(cj.options.plugins.decimation.algorithm, 'lttb');
				assert.ok(!Object.hasOwn(cj.options.plugins.decimation, 'samples'));
				assert.ok(!Object.hasOwn(cj.options.plugins.decimation, 'threshold'));
			}
		}
	});

	it('contains all static library figures inside the section moved below uPlot', async () => {
		await import('../scripts2/instrument.mjs');
		const html = await readFile(new URL('../demos/decimation.html', import.meta.url), 'utf8');
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html;
		const section = wrapper.querySelector('#library-comparisons');
		assert.equal(section.querySelectorAll('figure').length, 12);
		assert.equal(section.querySelectorAll('.detail').length, 8);
		assert.equal(section.querySelector('h2').textContent, 'Native ECharts and Chart.js downsampling');
		for (const {id, detail} of libraryCases) {
			for (const library of ['echarts', 'chartjs']) {
				for (const sampled of [false, true]) {
					const figure = section.querySelector(`#${library}-${id}-${sampled ? 'lttb' : 'raw'}`);
					assert.ok(figure.querySelector('.chart'));
					assert.ok(figure.querySelector('output'));
					assert.equal(figure.querySelectorAll('.detail').length, detail ? 1 : 0);
					assert.ok(figure.querySelector('figcaption').textContent.includes(library === 'echarts' ? 'ECharts' : 'Chart.js'));
				}
			}
		}
		for (const node of section.querySelectorAll('h2, h3, p, code, strong, figcaption'))
			assert.ok(node.textContent.trim(), `Empty ${node.tagName}`);
	});

	it('retains both extrema in native linear references at DPR 1, 2, and 3', async () => {
		await import('../scripts2/instrument.mjs');
		const { default: uPlot } = await import('../src/uPlot.js');
		const previous = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		try {
			for (const group of groups.slice(1)) {
				const plots = await group.steps[0].render();
				try {
					assert.equal(plots.length, 1);
					const [u] = plots;
					assert.equal(u.data[0].length, 10002);
					for (const ratio of [1, 2, 3]) {
						u.setPxRatio(ratio);
						await Promise.resolve();
						const series = u.series[1];
						const ys = series._paths.stroke.log
							.filter(cmd => cmd[0] === 'lineTo')
							.flatMap(cmd => cmd.slice(1).map(point => point[1]));
						for (const value of [-100, 100])
							assert.ok(ys.includes(series.pxRound(u.valToPos(value, 'y', true))), `${group.id}, DPR ${ratio}`);
						assert.ok(u.data[0].length - 1 >= u.bbox.width * 4);
					}
				}
				finally {
					plots.forEach(u => u.destroy());
				}
			}
		}
		finally {
			globalThis.uPlot = previous;
		}
	});
});
