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
		min: range[0] == null ? rangeYAuto.min : { mode: 1, hard: range[0], soft: range[0] },
		max: range[1] == null ? rangeYAuto.max : { mode: 1, hard: range[1], soft: range[1] },
	};
}

function assertPolicyPlot(u, scenario, policy) {
	assert.equal(u.data, scenario.data);
	assert.equal(u.scales.y._axisY, true);
	const height = u.bbox.height / u.pxRatio;
	const expected = rangeY(scenario.dataMin, scenario.dataMax, height, normalizePolicy(policy.range));
	assert.ok(expected);
	assert.deepEqual([u.scales.y.min, u.scales.y.max], [expected.min, expected.max]);
	assert.equal(u.axes[1]._splits.length, rangeYCount(height) + 1);
	assert.deepEqual([u.axes[1]._splits[0], u.axes[1]._splits.at(-1)], [expected.min, expected.max]);
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

	it('compares seven policies against one random walk', () => {
		assert.equal(demo.plots.length, 7);
		assert.equal(demo.state.policies.length, 7);
		assert.deepEqual(demo.state.policies.map(policy => policy.title), [
			'Default policy',
			'No zero affinity',
			'10% minimum padding',
			'Always-soft zero',
			'Conditioned-soft zero with padding',
			demo.state.scenario.sign > 0 ? 'Hard zero on the min side' : 'Hard zero on the max side',
			'Mixed hard zero and auto',
		]);
		assert.equal(demo.state.scenario.data[0].length, 401);
		assert.equal(demo.state.scenario.data[1].length, 401);
		assert.ok(new Set(demo.state.scenario.data[1]).size > 1);
		assert.ok(input('scenario').value.includes('default affinity'));
		demo.plots.forEach((u, i) => assertPolicyPlot(u, demo.state.scenario, demo.state.policies[i]));
		assert.equal(root.querySelectorAll('.policy').length, 7);
		assert.equal(root.querySelectorAll('.policy-stats').length, 7);
	});

	it('randomizes the shared walk and sign-dependent hard policies', async () => {
		await withSeededRandom(async () => {
			for (let i = 0; i < 5; i++) {
				const oldPlots = demo.plots.slice();
				const oldData = demo.state.scenario.data;
				input('randomize').click();
				await Promise.resolve();
				assert.equal(demo.plots.length, 7);
				assert.notEqual(demo.state.scenario.data, oldData);
				assert.ok(oldPlots.every(u => u.root.parentNode == null));
				demo.plots.forEach((u, j) => assertPolicyPlot(u, demo.state.scenario, demo.state.policies[j]));
				const hard = demo.state.policies[5];
				assert.ok(hard.title.endsWith(demo.state.scenario.sign > 0 ? 'min side' : 'max side'));
				assert.deepEqual(demo.state.policies[6].range, demo.state.scenario.sign > 0 ? [0, null] : [null, 0]);
			}
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
		demo.destroy();
		demo = null;
		assert.ok(plots.every(u => u.root.parentNode == null));
		input('randomize').click();
		window.dispatchEvent(new Event('resize'));
		assert.ok(plots.every(u => u.root.parentNode == null));
	});
});
