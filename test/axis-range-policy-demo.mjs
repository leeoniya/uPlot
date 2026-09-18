import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import { withSeededRandom } from '../scripts/withSeededRandom.mjs';
import { createDemo } from '../demos/axis-range-policies.js';
import { rangeY, rangeYAuto, rangeYCount } from '../src/rangeY.js';
import { isArr } from '../src/utils.js';

const html = await readFile(new URL('../demos/axis-range-policies.html', import.meta.url), 'utf8');

function normalizePolicy(range) {
	if (range == null)
		return rangeYAuto;
	if (!isArr(range))
		return range;

	return {
		zeroIf: rangeYAuto.zeroIf,
		min: range[0] == null ? rangeYAuto.min : { mode: 1, hard: range[0], soft: range[0] },
		max: range[1] == null ? rangeYAuto.max : { mode: 1, hard: range[1], soft: range[1] },
	};
}

function assertPolicyPlot(u, scenario, policy) {
	assert.equal(u.data, scenario.data);
	assert.equal(u.scales.y._axisY, true);
	const height = u.bbox.height / u.pxRatio;
	const expected = rangeY(scenario.dataMin, scenario.dataMax, height, normalizePolicy(policy.range));
	const splits = u.axes[1]._splits ?? [];
	if (expected == null) {
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [null, null]);
		assert.deepEqual(splits, []);
	}
	else {
		assert.deepEqual([u.scales.y.min, u.scales.y.max], [expected.min, expected.max]);
		assert.equal(splits.length, rangeYCount(height) + 1);
		assert.deepEqual([splits[0], splits.at(-1)], [expected.min, expected.max]);
	}
}

describe('axis range policy demo', () => {
	let root, demo;
	const input = id => root.querySelector(`#${id}`);

	beforeEach(async () => {
		root = document.createElement('div');
		root.innerHTML = html.match(/<main\b[^]*?<\/main>/)[0];
		document.body.appendChild(root);
		await withSeededRandom(() => { demo = createDemo(root); });
		await Promise.resolve();
	});

	afterEach(() => {
		demo?.destroy();
		root.remove();
	});

	it('has a complete document shell', () => {
		assert.match(html, /<meta name="viewport"/);
		assert.match(html, /<style>[^]*<\/style>/);
		assert.match(html, /<body>[^]*<main id="demo">[^]*<\/main>[^]*<\/body>/);
		assert.match(html, /<script type="module">[^]*axis-range-policies\.js[^]*<\/script>/);
	});

	it('compares eight policies against one compact controlled walk', () => {
		assert.equal(demo.plots.length, 8);
		assert.equal(demo.state.policies.length, 8);
		assert.deepEqual(demo.state.policies.map(policy => policy.title), [
			'Default policy',
			'No zero affinity',
			'10% zero affinity',
			'Padding ignored',
			'Always-soft zero',
			'Mode 2 soft zero',
			'Hard zero on the min side',
			'Mixed hard zero and auto',
		]);
		assert.equal(input('preset').querySelectorAll('button').length, 6);
		assert.equal(input('preset').querySelector('[aria-pressed="true"]').value, '0');
		assert.match(input('preset-description').textContent, /20%|default affinity/);
		assert.equal(input('height').valueAsNumber, 300);
		assert.ok(demo.plots.every(u => rangeYCount(u.bbox.height / u.pxRatio) == 5));
		assert.equal(demo.state.scenario.data[0].length, 401);
		assert.equal(demo.state.scenario.data[1].length, 401);
		assert.ok(new Set(demo.state.scenario.data[1]).size > 1);
		assert.equal(Math.min(...demo.state.scenario.data[1]), 20);
		assert.equal(Math.max(...demo.state.scenario.data[1]), 120);
		assert.equal(demo.state.scenario.gapRatio, .2);
		assert.match(input('scenario').value, /start 20 \| spread 100 .* zero gap 20\.00% of span/);
		assert.deepEqual(demo.state.policies[1].range, { zeroIf: 0, min: {}, max: {} });
		assert.deepEqual(demo.state.policies[2].range, { zeroIf: .1, min: {}, max: {} });
		demo.plots.forEach((u, i) => assertPolicyPlot(u, demo.state.scenario, demo.state.policies[i]));
		assert.ok(demo.plots[1].scales.y.min > 0);
		assert.equal(demo.plots[0].scales.y.min, 0);
		assert.ok(demo.plots[2].scales.y.min > 0);
		assert.equal(root.querySelectorAll('.policy').length, 8);
		assert.equal(root.querySelectorAll('.policy-stats').length, 8);
	});

	it('remaps the same walk through representative presets without replacing charts or policies', async () => {
		const plots = demo.plots.slice();
		const policies = demo.state.policies.slice();
		const oldData = demo.state.scenario.data;
		const oldYs = oldData[1];

		const extrema = [[20, 120], [25, 125], [1000, 1100], [.002, .012], [-120, -20], [-40, 60]];
		for (const [index, expected] of extrema.entries()) {
			input('preset').querySelectorAll('button')[index].click();
			assert.equal(input('preset').querySelectorAll('[aria-pressed="true"]').length, 1);
			assert.equal(input('preset').querySelector('[aria-pressed="true"]').value, String(index));
			await Promise.resolve();
			const { data, dataMin, dataMax } = demo.state.scenario;
			assert.deepEqual([dataMin, dataMax], expected);
			assert.equal(Math.min(...data[1]), dataMin);
			assert.equal(Math.max(...data[1]), dataMax);
			for (let i = 0; i < oldYs.length; i++)
				assert.ok(Math.abs((data[1][i] - dataMin) / (dataMax - dataMin) - (oldYs[i] - 20) / 100) < 1e-12);
			demo.plots.forEach((u, j) => {
				assert.equal(u, plots[j]);
				assert.equal(demo.state.policies[j], policies[j]);
				assertPolicyPlot(u, demo.state.scenario, policies[j]);
			});
			const scales = demo.plots.map(u => u.scales.y);
			if (index == 0 || index == 3) {
				assert.equal(scales[0].min, 0);
				assert.ok(scales[1].min > 0 && scales[2].min > 0);
			}
			if (index == 1 || index == 2) {
				assert.ok(scales[0].min > 0);
				assert.equal(scales[4].min, 0);
				assert.equal(scales[5].min, 0);
				assert.equal(scales[7].min, 0);
			}
			if (index == 2)
				assert.ok(scales[6].min > 0);
			if (index == 4) {
				assert.equal(scales[0].max, 0);
				assert.ok(scales[1].max < 0);
				assert.equal(scales[6].min, null);
				assert.equal(scales[7].min, null);
			}
			if (index == 5) {
				assert.ok(scales[0].min < 0 && scales[0].max > 0);
				assert.equal(scales[6].min, 0);
				assert.equal(scales[7].min, 0);
			}
		}

		input('preset').querySelectorAll('button')[0].click();
		await Promise.resolve();
		assert.deepEqual(demo.state.scenario.data, oldData);

		const { data, dataMin, dataMax } = demo.state.scenario;
		assert.notEqual(data, oldData);
		assert.equal(data[0], oldData[0]);
		assert.equal(Math.min(...data[1]), dataMin);
		assert.equal(Math.max(...data[1]), dataMax);
		for (let i = 0; i < oldYs.length; i++) {
			const normalized = (data[1][i] - dataMin) / (dataMax - dataMin);
			assert.ok(Math.abs(normalized - (oldYs[i] - 20) / 100) < 1e-12);
		}
		demo.plots.forEach((u, i) => {
			assert.equal(u, plots[i]);
			assert.equal(demo.state.policies[i], policies[i]);
			assert.equal(u.data, demo.state.scenario.data);
			assertPolicyPlot(u, demo.state.scenario, demo.state.policies[i]);
		});
	});

	it('resizes every chart without replacing data', async () => {
		const data = demo.state.scenario.data;
		input('height').value = 420;
		input('height').dispatchEvent(new Event('input'));
		await Promise.resolve();
		assert.equal(input('height-value').value, '420px');
		for (const [i, u] of demo.plots.entries()) {
			assert.equal(u.height, 420);
			assert.equal(u.data, data);
			assertPolicyPlot(u, demo.state.scenario, demo.state.policies[i]);
		}
	});

	it('removes controls and destroys every chart', () => {
		const plots = demo.plots.slice();
		const scenario = demo.state.scenario;
		demo.destroy();
		assert.ok(plots.every(u => u.root.parentNode == null));

		input('preset').querySelectorAll('button')[1].click();
		window.dispatchEvent(new Event('resize'));
		assert.equal(demo.state.scenario, scenario);
		assert.ok(plots.every(u => u.root.parentNode == null));
		demo = null;
	});
});
