import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import groups, { bindControls, setDataValue } from '../demos/soft-minmax.js';
import { renderDemo } from '../demos/renderDemo.js';

const html = await readFile(new URL('../demos/soft-minmax.html', import.meta.url), 'utf8');
const initialBounds = [[3.6, 13.4], [-10, 13.4], [3.6, 10], [3.6, 13.4]];
const transitions = [
	[-100, [-130, 30]],
	[-10, [-13, 8]],
	[0, [-1, 6]],
	[5, [0, 10]],
	[9, [4.2, 9.8]],
	[10, [4, 11]],
	[12, [3.6, 13.4]],
	[24, [1, 28]],
	[25, [1, 29]],
	[100, [-14, 119]],
];

const bounds = plot => [plot.scales.y.min, plot.scales.y.max];

function assertReadout(plot) {
	const readouts = plot.root.querySelectorAll('.range-readout');
	assert.equal(readouts.length, 1);
	const text = readouts[0].textContent;
	assert.match(text, /data/i);
	assert.match(text, /scale/i);
	assert.deepEqual(text.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number),
		[plot.series[1].min, plot.series[1].max, ...bounds(plot)], text);
}

describe('soft minmax demo', () => {
	let previousUPlot, bodyChildren, root, plots, cleanup, zeroData;
	const input = id => root.querySelector(`#${id}`);

	beforeEach(async () => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		bodyChildren = new Set(document.body.children);
		plots = [];
		cleanup = null;
		root = document.createElement('div');
		const controls = html.match(/<section\b[^>]*\bid="controls"[^>]*>[^]*?<\/section>/);
		assert.ok(controls, 'the page contains the controls section');
		root.innerHTML = controls[0];
		document.body.appendChild(root);
		plots = (await renderDemo(groups)).flat();
		await new Promise(requestAnimationFrame);
		zeroData = plots[4].data;
	});

	afterEach(() => {
		cleanup?.();
		for (const plot of plots)
			plot.destroy();
		for (const child of [...document.body.children]) {
			if (!bodyChildren.has(child))
				child.remove();
		}
		globalThis.uPlot = previousUPlot;
	});

	function assertZeroUnchanged() {
		assert.equal(plots[4].data, zeroData);
		assert.deepEqual(zeroData, [[1, 2], [0, 0]]);
		assert.deepEqual([plots[4].series[1].min, plots[4].series[1].max], [0, 0]);
		assert.deepEqual(bounds(plots[4]), [-1, 1]);
	}

	function assertSharedData(value) {
		for (const plot of plots.slice(0, 4)) {
			assert.equal(plot.data, plots[0].data);
			assert.deepEqual(plot.data, [[0, 10], [5, value]]);
			assert.deepEqual([plot.series[1].min, plot.series[1].max],
				[Math.min(5, value), Math.max(5, value)]);
		}
		assertZeroUnchanged();
	}

	it('starts below the zero-affinity threshold on shared data with an independent flat-zero plot', () => {
		assert.equal(plots.length, 5);
		assertSharedData(12);
		assert.notEqual(zeroData, plots[0].data);
		assert.deepEqual(plots.slice(0, 4).map(bounds), initialBounds);
		assert.equal(new Set(plots.slice(0, 4).map(plot => JSON.stringify(bounds(plot)))).size, 3);
				assert.match(plots[3].root.querySelector('.u-title').textContent, /Include nearby zero \(25%\)/);
		plots.slice(0, 4).forEach(assertReadout);
	});

	it('provides a bounded decimal slider instead of a button or interval', () => {
		const slider = input('data-value');
		assert.equal(slider.type, 'range');
		assert.equal(slider.min, '-100');
		assert.equal(slider.max, '100');
		assert.equal(Number(slider.step), 0.1);
		assert.equal(slider.value, '12');
		assert.equal(slider.getAttribute('list'), 'data-thresholds');
		assert.equal(input('data-thresholds').querySelector('option').value, '25');
		assert.equal(slider.getAttribute('aria-describedby'), 'zero-threshold');
		assert.match(input('zero-threshold').textContent, /25.*zero-affinity threshold/);
		assert.equal(input('data-value-output').tagName, 'OUTPUT');
		assert.equal(input('data-value-output').value, '12');
		assert.doesNotMatch(html, /<button\b|\bsetInterval\s*\(/i);
		assert.match(html, /\bbindControls\(\s*plots\s*\)/);
	});

	it('replaces the shared dataset for arbitrary finite values without mutating previous data', async () => {
		for (const value of [12.1, -123.456, 123.456, 0.125, 12]) {
			const previous = plots[0].data;
			const saved = structuredClone(previous);
			setDataValue(plots, value);
			await Promise.resolve();
			assert.notEqual(plots[0].data, previous);
			assert.deepEqual(previous, saved);
			assertSharedData(value);
		}
		assert.deepEqual(plots.slice(0, 4).map(bounds), initialBounds);
	});

	it('applies soft anchors, hard clipping, and raw-span zero affinity in both slider directions', async () => {
		cleanup = bindControls(plots, root);
		assert.equal(typeof cleanup, 'function');
		const slider = input('data-value');
		for (const [value, padded] of [...transitions, ...transitions.slice().reverse(), transitions[6]]) {
			const previous = plots[0].data;
			const saved = structuredClone(previous);
			slider.value = String(value);
			slider.dispatchEvent(new Event('input', { bubbles: true }));
			await Promise.resolve();
			assert.equal(input('data-value-output').value, slider.value);
			assert.notEqual(plots[0].data, previous);
			assert.deepEqual(previous, saved);
			assertSharedData(value);

			const min = Math.min(5, value);
			const max = Math.max(5, value);
			const soft = [min >= -10 ? -10 : padded[0], max <= 10 ? 10 : padded[1]];
			const hard = [Math.max(-10, padded[0]), Math.min(10, padded[1])];
			const zero = [min >= 0 && min <= .25 * (max - min) ? 0 : padded[0], padded[1]];
			assert.deepEqual(plots.slice(0, 4).map(bounds), [padded, soft, hard, zero], `second y = ${value}`);
			if (value === 24)
				assert.equal(plots[3].scales.y.min, 1, '[5, 24] does not qualify for zero affinity');
			if (value === 25) {
				assert.equal(plots[3].scales.y.min, 0, '[5, 25] qualifies at the 25% raw-span boundary');
				assert.equal(plots[0].scales.y.min, 1, 'padding alone does not reach zero at this threshold');
			}
			plots.slice(0, 4).forEach(assertReadout);
		}
		assert.deepEqual(plots.slice(0, 4).map(bounds), initialBounds);
	});

	it('refreshes range readouts on draws without a slider event', async () => {
		plots[0].setScale('y', { min: -20, max: 20 });
		await Promise.resolve();
		assert.deepEqual(bounds(plots[0]), [-20, 20]);
		assertReadout(plots[0]);
		assertSharedData(12);
	});

	it('binds to document by default and removes the input listener on cleanup', async () => {
		cleanup = bindControls(plots);
		assert.equal(typeof cleanup, 'function');
		const slider = input('data-value');
		slider.value = '12.1';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await Promise.resolve();
		assertSharedData(12.1);
		assert.equal(input('data-value-output').value, slider.value);

		const data = plots.map(plot => plot.data);
		const ranges = plots.map(bounds);
		const readouts = plots.slice(0, 4).map(plot => plot.root.querySelector('.range-readout').textContent);
		cleanup();
		cleanup = null;
		slider.value = '-100';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await Promise.resolve();
		plots.forEach((plot, i) => assert.equal(plot.data, data[i]));
		assert.deepEqual(plots.map(bounds), ranges);
		assert.deepEqual(plots.slice(0, 4).map(plot => plot.root.querySelector('.range-readout').textContent), readouts);
		assert.equal(input('data-value-output').value, '12.1');
		assertSharedData(12.1);
	});
});
