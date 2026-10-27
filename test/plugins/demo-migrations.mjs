import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { captureStep, getDemoSteps } from '../../scripts/demoSteps.mjs';
import { withSeededRandom } from '../../scripts/withSeededRandom.mjs';
import barsGroupedStacked from '../../demos/bars-grouped-stacked.js';
import candlestick from '../../demos/candlestick-ohlc.js';
import annotations from '../../demos/annotations.js';
import multiBars from '../../demos/multi-bars.js';

function click(label) {
	label.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

describe('demo migrations', () => {
	let previousUPlot;
	let bodyChildren;
	let livePlots;

	beforeEach(() => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		bodyChildren = new Set(document.body.children);
		livePlots = [];
	});

	afterEach(() => {
		for (const plot of livePlots)
			plot.destroy();
		// Some demos also insert page prose and separators outside plot roots.
		for (const child of [...document.body.children]) {
			if (!bodyChildren.has(child))
				child.remove();
		}
		globalThis.uPlot = previousUPlot;
	});

	async function render(groups, index = 0) {
		let plots;
		await withSeededRandom(async () => {
			plots = await getDemoSteps(groups)[index].step.render();
		});
		livePlots.push(...plots);
		await new Promise(requestAnimationFrame);
		return plots;
	}

	it('places multi-bars controls below the explicit grid with spacing between charts', async () => {
		const html = await readFile(new URL('../../demos/multi-bars.html', import.meta.url), 'utf8');
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(html.match(/<style>([^]*?)<\/style>/)[1]);
		const rules = [...sheet.cssRules];
		const toggles = rules.find(rule => rule.selectorText == '.lib-toggles').style;
		assert.equal(toggles.gridColumn, '1 / -1');
		assert.equal(toggles.gridRow, '-1');
		assert.equal(toggles.marginTop, '');
		assert.equal(rules.find(rule => rule.selectorText == '.uplot').style.marginBottom, '20px');
	});

	for (const [index, orientation] of [[1, 'horizontal'], [2, 'vertical']]) {
		it(`keeps ${orientation} multi-bars controls as a separate grid item`, async () => {
			const [plot] = await render(multiBars, index);
			const legend = plot.root.querySelector('.u-legend');
			const toggles = plot.root.querySelector('.lib-toggles');
			assert.equal(legend.parentElement, plot.root);
			assert.equal(toggles.parentElement, plot.root);
			const button = toggles.firstElementChild;
			const count = plot.data[0].length;
			for (const hidden of [true, false]) {
				click(button);
				await new Promise(requestAnimationFrame);
				assert.equal(button.classList.contains('hidden'), hidden);
				assert.equal(plot.data[0].length, count - (hidden ? 1 : 0));
				assert.equal(toggles.parentElement, plot.root);
				assert.equal(plot.root.querySelector('.u-legend'), legend);
				assert.deepEqual([...plot.root.querySelectorAll('.lib-toggles')], [toggles]);
			}
		});
	}

	it('removes grouped-bars pixel-ratio listeners when plots are destroyed', async () => {
		const add = window.addEventListener;
		const remove = window.removeEventListener;
		const active = new Set();
		let added = 0;
		window.addEventListener = function(type, callback, ...args) {
			if (type === 'dppxchange') {
				active.add(callback);
				added++;
			}
			return add.call(this, type, callback, ...args);
		};
		window.removeEventListener = function(type, callback, ...args) {
			if (type === 'dppxchange')
				active.delete(callback);
			return remove.call(this, type, callback, ...args);
		};
		try {
			await captureStep(getDemoSteps(barsGroupedStacked)[0].step, '0-0', () => {});
			assert.ok(added > 0);
			assert.equal(active.size, 0);
		}
		finally {
			for (const callback of active)
				remove.call(window, 'dppxchange', callback);
			window.addEventListener = add;
			window.removeEventListener = remove;
		}
	});

	it('disables grouped-bar drag zoom', async () => {
		const plots = await render(barsGroupedStacked);
		for (const plot of plots)
			assert.equal(plot.cursor.drag.setScale, false);
	});

	it('uses explicit baselines without bands in every grouped-bar stack', async () => {
		for (let index = 0; index < getDemoSteps(barsGroupedStacked).length; index++) {
			const plots = await render(barsGroupedStacked, index);
			for (let i = 1; i < plots.length; i += 2) {
				const plot = plots[i];
				assert.deepStrictEqual(plot.bands, []);
				for (let si = 1; si < plot.series.length; si++)
					assert.deepStrictEqual(plot._base[si], si === 1 ? plot.data[si].map(() => 0) : plot._data[si - 1]);
			}
		}
	});

	it('replaces annotations on scale changes without retaining offscreen or duplicate marks', async () => {
		const [plot] = await render(annotations);
		const labels = () => [...plot.over.querySelectorAll('.u-mark-x-label')].map(el => el.textContent);
		assert.deepStrictEqual(labels(), ['eqk_01', 'tor_20']);
		for (const [min, max, expected] of [
			[10, 15, ['tor_20']],
			[20, 25, []],
			[1, 30, ['eqk_01', 'tor_20']],
		]) {
			plot.setScale('x', { min, max });
			await Promise.resolve();
			assert.deepStrictEqual(labels(), expected);
		}
	});

	it('updates the candlestick tooltip and column highlight on hover', async () => {
		const [plot] = await render(candlestick);
		const legend = plot.over.querySelector('.u-legend');
		const highlight = plot.under.firstElementChild;
		assert.equal(legend.style.display, 'none');
		assert.equal(highlight.style.display, 'none');
		plot.over.dispatchEvent(new MouseEvent('mouseenter'));
		assert.notEqual(legend.style.display, 'none');
		assert.notEqual(highlight.style.display, 'none');
		const left = plot.valToPos(10, 'x');
		plot.setCursor({ left, top: 50 });
		assert.equal(plot.cursor.idx, 10);
		await new Promise(requestAnimationFrame);
		assert.equal(legend.style.transform, `translate(${plot.cursor.left}px, 50px)`);
		assert.ok(parseFloat(highlight.style.width) > 0);
		const transform = highlight.style.transform;
		const value = legend.querySelectorAll('.u-value')[1].textContent;
		assert.equal(value, plot.data[1][10].toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
		plot.setCursor({ left: plot.valToPos(11, 'x'), top: 60 });
		assert.equal(plot.cursor.idx, 11);
		assert.notEqual(highlight.style.transform, transform);
		plot.over.dispatchEvent(new MouseEvent('mouseleave'));
		assert.equal(legend.style.display, 'none');
		assert.equal(highlight.style.display, 'none');
	});
});
