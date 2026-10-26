import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import barsGroupedStacked from '../../demos/bars-grouped-stacked.js';
import multiBars from '../../demos/multi-bars.js';
import { getDemoSteps } from '../../scripts/demoSteps.mjs';
import { withSeededRandom } from '../../scripts/withSeededRandom.mjs';

const rects = (plot, si) => plot.series[si]._paths.fill.log
	.filter(entry => entry[0] === 'rect').flatMap(entry => entry.slice(1));

function valueLabels(plot) {
	const { left, top, width, height } = plot.bbox;
	return plot.ctx.log.slice(plot.ctx.log.findLastIndex(entry => entry[0] === 'clearRect'))
		.filter(entry => entry[0] === 'fillText').flatMap(entry => entry.slice(1))
		.filter(([, x, y]) => x >= left && x <= left + width && y >= top && y <= top + height)
		.map(([text]) => String(text));
}

function assertColors(plot, statuses) {
	const palette = ['#33BB55', '#F79420', '#BB1133'];
	for (const channel of ['fill', 'stroke']) {
		const colors = [...new Set(statuses.map(status => palette[status] + (channel === 'fill' ? 'A0' : '')))];
		const paths = plot.series[1]._paths[channel];
		assert.ok(paths instanceof Map);
		assert.deepEqual([...paths.keys()].sort(), colors.sort());
		for (const [color, path] of paths) {
			assert.ok(path.log.length > 0);
			let style;
			let painted = false;
			for (const [name, ...args] of plot.ctx.log.slice(plot.ctx.log.findLastIndex(entry => entry[0] === 'clearRect'))) {
				if (name === `${channel}Style`)
					style = args.at(-1);
				if (name === channel && args.some(args => args[0] === path)) {
					assert.equal(style, color);
					painted = true;
				}
			}
			assert.ok(painted, `${channel} paints ${color}`);
		}
	}
}

describe('bar chart demos', () => {
	let plots;
	let bodyChildren;


	beforeEach(() => {
		plots = [];
		bodyChildren = new Set(document.body.children);

	});

	afterEach(() => {
		for (const plot of plots)
			plot.destroy();
		for (const child of [...document.body.children]) {
			if (!bodyChildren.has(child))
				child.remove();
		}
	});

	async function render(groups, index = 0) {
		let rendered;
		await withSeededRandom(async () => {
			rendered = await getDemoSteps(groups)[index].step.render();
			plots.push(...rendered);
		});
		await new Promise(requestAnimationFrame);
		return rendered;
	}

	for (const [index, name, data, orientations] of [
		[0, 'multiple categories and bars', [['Group A', 'Group B', 'Group C', 'Group D'], [1, 2, 3, 10], [3, 2, 1, 10], [5, 9, 3, 10]], [0, 0, 1, 1]],
		[1, 'multiple categories and one bar', [['Group A', 'Group B', 'Group C', 'Group D'], [1, 2, 3, 10]], [0, 0]],
		[2, 'one category and multiple bars', [['Group A'], [1], [3], [5]], [0, 0]],
		[3, 'one category and one bar', [['Group A'], [1]], [0, 0]],
	]) {
		it(`renders grouped and stacked demos with ${name}`, async () => {
			const rendered = await render(barsGroupedStacked, index);
			assert.equal(rendered.length, orientations.length);
			for (const [i, plot] of rendered.entries()) {
				const ori = orientations[i];
				const stacked = i % 2 === 1;

				assert.deepEqual(plot.data, data);
				assert.equal(plot.series.length, data.length);
				assert.equal(plot.scales.x.ori, ori);
				assert.equal(plot.scales.x.dir, ori === 0 ? 1 : -1);
				assert.equal(plot.scales.y.ori, ori === 0 ? 1 : 0);
				assert.deepEqual(plot.axes[0]._values, data[0]);
				assert.ok(Number.isFinite(plot.scales.x.min) && plot.scales.x.max > plot.scales.x.min);
				let totals = data[0].map(() => 0);
				for (let si = 1; si < data.length; si++) {
					totals = totals.map((total, di) => total + data[si][di]);
					assert.deepEqual(plot._data[si], stacked ? totals : data[si]);
					const bars = rects(plot, si);
					assert.equal(bars.length, data[0].length);
					assert.ok(bars.every(rect => rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0));
				}
				const labels = valueLabels(plot);
				const expected = new Set([...data.slice(1).flat(), ...(stacked ? totals : [])].map(String));
				assert.ok(labels.length > 0, 'the demo enables value labels');
				assert.ok(labels.every(label => expected.has(label)), 'labels use raw contributions or stack totals');
			}
		});
	}

	for (const [index, orientation] of [[1, 'vertical'], [3, 'horizontal']]) {
		it(`updates the native ${orientation} demo stack on hide, show, and data replacement`, async () => {
			const rendered = await render(barsGroupedStacked);
			const plot = rendered[index];
			const original = structuredClone(plot.data);
			const endpoints = plot._data.slice(1).map(values => values.slice());

			plot.setSeries(1, { show: false });
			await new Promise(requestAnimationFrame);
			assert.deepEqual(plot._data[2], original[2]);
			assert.deepEqual(plot._data[3], original[2].map((value, di) => value + original[3][di]));
			assert.deepEqual(plot._base[2], [0, 0, 0, 0]);
			assert.deepEqual(plot._base[3], original[2]);
			assert.equal(rects(plot, 3).length, 4);

			plot.setSeries(1, { show: true });
			await new Promise(requestAnimationFrame);
			assert.deepEqual(plot._data.slice(1), endpoints);
			assert.deepEqual(plot.data, original, 'visibility changes leave raw demo data intact');

			const replacement = [['New A', 'New B', 'Missing'], [-4, -6, null], [-7, -8, null], [-9, -10, null]];
			const expected = structuredClone(replacement);
			plot.setData(replacement);
			await new Promise(requestAnimationFrame);
			assert.deepEqual(replacement, expected);
			assert.deepEqual(plot.data, expected);
			assert.deepEqual(plot.axes[0]._values, replacement[0]);
			assert.deepEqual(plot._data[2], [-11, -14, null]);
			assert.deepEqual(plot._data[3], [-20, -24, null]);
			assert.deepEqual(plot._base[3], [-11, -14, null]);
			assert.ok(plot.scales.y.min <= -24 && plot.scales.y.max >= 0);
			for (let si = 1; si < plot.series.length; si++)
				assert.equal(rects(plot, si).length, 2, 'replacement drops old and missing bars');
			assert.ok(valueLabels(plot).some(label => label.startsWith('-')));
			for (const other of rendered.filter(other => other !== plot))
				assert.deepEqual(other.data, original, 'updating one variant leaves the other demos unchanged');
		});
	}

	for (const [index, ori] of [[1, 0], [2, 1]]) {
		it(`preserves benchmark metric ranges and orientation at the multi-bars call site (ori ${ori})`, async () => {
			const [plot] = await render(multiBars, index);
			assert.equal(plot.scales.x.ori, ori);
			assert.equal(plot.scales.x.dir, ori === 0 ? 1 : -1);
			assert.equal(plot.axes[1].scale, 'rend');
			assert.equal(plot.axes[1].side, ori === 0 ? 3 : 2);
			assert.deepEqual(plot.series.slice(1, 7).map(series => series.scale), ['size', 'rend', 'mem', 'mem', 'inter', 'toggle']);
			for (const key of ['rend', 'size', 'mem', 'inter', 'toggle']) {
				const scale = plot.scales[key];
				assert.equal(scale.ori, ori === 0 ? 1 : 0);
				assert.deepEqual(scale.range(plot, 1, 42), [0, uPlot.rangeNum(0, 42, 0.05, true)[1]]);
				assert.equal(scale.min, 0);
				assert.ok(scale.max > 0);
			}
		});
	}

	it('renders and updates status-based fill and stroke colors in the variable-color demo', async () => {
		const [plot, nonJustified] = await render(multiBars);
		assert.equal(plot.series.length, 2, 'status data is not a plotted series');
		assert.equal(plot.data[0].length, 26);
		assertColors(plot, plot.data[2]);
		const original = structuredClone(nonJustified.data);

		for (const statuses of [[0, 1, 2], [1, 1, 0]]) {
			plot.setData([['Build A', 'Build B', 'Build C'], [12, -24, 36], statuses]);
			await new Promise(requestAnimationFrame);
			assert.deepEqual(plot.axes[0]._values, ['Build A', 'Build B', 'Build C']);
			assertColors(plot, statuses);
			assert.deepEqual(plot.data[1], [12, -24, 36]);
			assert.equal(plot.series.length, 2);
		}
		assert.deepEqual(nonJustified.data, original);
	});
});
