import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { seriesBarsPlugin } from '../demos/grouped-bars.js';
import multiBars from '../demos/multi-bars.js';
import { getDemoSteps } from '../scripts/demoSteps.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';

function labels(plot, sidx) {
	const start = plot.ctx.log.length;
	plot.series[sidx].points.show(plot, sidx, 0, plot.data[0].length - 1);
	return plot.ctx.log.slice(start)
		.filter(entry => entry[0] === 'fillText')
		.flatMap(entry => entry.slice(1));
}

describe('grouped-bars plugin', () => {
	let previousUPlot;
	let plots;

	beforeEach(() => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		plots = [];
	});

	afterEach(() => {
		for (const plot of plots)
			plot.destroy();
		globalThis.uPlot = previousUPlot;
	});

	function makePlot(ori, stack, ignore = []) {
		const plot = new uPlot({
			width: 600,
			height: 400,
			axes: [{ show: false }, { show: false }],
			scales: { y: { range: [0, 10], ori: ori === 0 ? 1 : 0 } },
			series: [{}, { fill: 'red', width: 0 }, { fill: 'blue', width: 0 }],
			stack,
			plugins: [seriesBarsPlugin({ ori, dir: ori === 0 ? 1 : -1, ignore })],
		}, [['A', 'B', 'C'], [1, 2, null], [3, 4, null]], document.body);
		plots.push(plot);
		return plot;
	}

	function layout(groupCount, barCount, stacked) {
		let disp;
		let plugin;
		globalThis.uPlot = {
			...uPlot,
			paths: {
				...uPlot.paths,
				bars: opts => {
					disp = opts.disp;
					return uPlot.paths.bars(opts);
				},
			},
		};
		try {
			plugin = seriesBarsPlugin({ ori: 0, dir: 1 });
		}
		finally {
			globalThis.uPlot = uPlot;
		}

		const opts = {
			axes: [{}],
			series: Array.from({ length: barCount + 1 }, () => ({})),
			stack: { groups: stacked ? [{ series: [1, 2], dir: 0 }] : [] },
		};
		plugin.opts({}, opts);
		const u = {
			series: opts.series,
			data: [Array(groupCount)],
			bbox: { width: 600, height: 400 },
		};
		plugin.hooks.drawClear(u);
		return opts.series.slice(1).map((_, i) => ({
			offs: disp.x0.values(u, i + 1),
			size: disp.size.values(u, i + 1),
		}));
	}

	it('shares category offsets and sizes across every stacked series', () => {
		for (const [groupCount, offs, size] of [
			[0, [], []],
			[1, [0], [0.9]],
			[3, [0, 0.35, 0.7], [0.3, 0.3, 0.3]],
		]) {
			const layouts = layout(groupCount, 4, true);
			assert.equal(layouts.length, 4);
			assert.deepEqual(layouts[0], { offs, size });
			for (const other of layouts.slice(1)) {
				assert.strictEqual(other.offs, layouts[0].offs);
				assert.strictEqual(other.size, layouts[0].size);
			}
		}
	});

	it('keeps independent offsets and sizes for normal grouped series', () => {
		for (const [groupCount, offs, size, shift] of [
			[0, [], [], 0],
			[1, [0], [0.45], 0.45],
			[3, [0, 0.35, 0.7], [0.15, 0.15, 0.15], 0.15],
		]) {
			const [first, second] = layout(groupCount, 2, false);
			assert.notStrictEqual(first.offs, second.offs);
			assert.notStrictEqual(first.size, second.size);
			assert.deepEqual(first, { offs, size });
			assert.deepEqual(second, { offs: offs.map(off => off + shift), size });
		}
	});

	it('handles zero bar series in grouped and stacked layouts', () => {
		for (const stacked of [false, true]) {
			for (const groupCount of [0, 3])
				assert.deepEqual(layout(groupCount, 0, stacked), []);
		}
	});

	for (const ori of [0, 1]) {
		it(`infers stacked layout from chart stack option and labels raw contributions (ori ${ori})`, async () => {
			const plot = makePlot(ori, { groups: [{ series: [1, 2], dir: 0 }] });
			await Promise.resolve();

			assert.deepEqual(plot.bands, []);
			assert.deepEqual(plot._base[1], [0, 0, null]);
			assert.deepEqual(plot._base[2], [1, 2, null]);
			assert.deepEqual(plot._data[2].slice(0, 2), [4, 6]);
			const first = labels(plot, 1);
			const second = labels(plot, 2);
			assert.deepEqual(first.map(label => label[0]), [1, 2]);
			assert.deepEqual(second.map(label => label[0]), [3, 4]);

			const categoryCoord = ori === 0 ? 1 : 2;
			const valueCoord = ori === 0 ? 2 : 1;
			for (let ix = 0; ix < second.length; ix++) {
				assert.equal(second[ix][categoryCoord], first[ix][categoryCoord]);
				assert.equal(second[ix][valueCoord], Math.round(plot.valToPos(plot._data[2][ix], 'y', true)));
				assert.notEqual(second[ix][valueCoord], Math.round(plot.valToPos(plot.data[2][ix], 'y', true)));
			}

			plot.setSeries(1, { show: false });
			await Promise.resolve();
			assert.deepEqual(labels(plot, 2).map(label => label[0]), [3, 4]);
			assert.deepEqual(plot._data[2].slice(0, 2), [3, 4]);
			assert.deepEqual(plot._base[2], [0, 0, null]);

			plot.setSeries(1, { show: true });
			plot.setData([['A', 'B', 'C'], [-1, -2, null], [-3, -4, null]]);
			plot.setScale('y', { min: -10, max: 0 });
			await Promise.resolve();
			assert.deepEqual(plot.bands, []);
			assert.deepEqual(plot._base[1], [0, 0, null]);
			assert.deepEqual(plot._base[2], [-1, -2, null]);
			assert.deepEqual(plot._data[2], [-4, -6, null]);
			const negative = labels(plot, 2);
			assert.deepEqual(negative.map(label => label[0]), [-3, -4]);
			for (let ix = 0; ix < negative.length; ix++) {
				assert.equal(negative[ix][categoryCoord], second[ix][categoryCoord]);
				assert.equal(negative[ix][valueCoord], Math.round(plot.valToPos(plot._data[2][ix], 'y', true)));
			}
		});

		it(`keeps bars separated without a stack group (ori ${ori})`, async () => {
			for (const stack of [undefined, { groups: [] }]) {
				const plot = makePlot(ori, stack);
				await Promise.resolve();
				const categoryCoord = ori === 0 ? 1 : 2;
				assert.notEqual(labels(plot, 1)[0][categoryCoord], labels(plot, 2)[0][categoryCoord]);
			}
		});
	}

	it('does not add metric scales or replace caller range and orientation settings', () => {
		const range = () => [-10, 20];
		const scales = {
			y: { range: [-5, 15], ori: 0 },
			rend: { range, ori: 0 },
		};
		const opts = { axes: [{}], series: [{}, {}], scales: uPlot.assign({}, scales) };
		seriesBarsPlugin({ ori: 0, dir: 1 }).opts({}, opts);
		assert.deepEqual(Object.keys(opts.scales).sort(), ['rend', 'x', 'y']);
		assert.deepEqual(opts.scales.y, scales.y);
		assert.deepEqual(opts.scales.rend, scales.rend);
		assert.equal(opts.scales.rend.range, range);
	});

	it('rebuilds bar hit regions on redraw and resize without invalidating ignored line paths', async () => {
		const plot = makePlot(0, undefined, [2]);
		await Promise.resolve();

		function assertHover() {
			const [, x] = labels(plot, 1)[0];
			plot.setCursor({
				left: (x - plot.bbox.left) / plot.pxRatio,
				top: plot.valToPos(0.5, 'y'),
			});
			assert.equal(plot.legend.idxs[1], 0);
		}

		assertHover();
		const linePaths = plot.series[2]._paths;
		assert.ok(linePaths);
		plot.redraw(false);
		await Promise.resolve();
		assert.equal(plot.series[2]._paths, linePaths);
		assertHover();
		plot.setSize({ width: 900, height: 500 });
		await Promise.resolve();
		assertHover();
	});

	for (const [index, ori] of [[1, 0], [2, 1]]) {
		it(`configures benchmark metric ranges and orientation at the multi-bars call site (ori ${ori})`, async () => {
			await withSeededRandom(async () => {
				plots.push(...await getDemoSteps(multiBars)[index].step.render());
			});
			await Promise.resolve();
			const [plot] = plots;
			for (const key of ['rend', 'size', 'mem', 'inter', 'toggle']) {
				const scale = plot.scales[key];
				assert.equal(scale.ori, ori === 0 ? 1 : 0);
				assert.deepEqual(scale.range(plot, 1, 42), [0, uPlot.rangeNum(0, 42, 0.05, true)[1]]);
				assert.equal(scale.min, 0);
				assert.ok(scale.max > 0);
			}
		});
	}
});
