import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { legendAsTooltipPlugin as candlestickTooltip } from '../demos/candlestick-ohlc.js';
import { legendAsTooltipPlugin as boxWhiskerTooltip } from '../demos/box-whisker.js';

const frame = () => new Promise(requestAnimationFrame);

for (const [name, legendAsTooltipPlugin] of [['candlestick', candlestickTooltip], ['box-whisker', boxWhiskerTooltip]])
describe(`${name} legend tooltip mounting`, () => {
	let previousUPlot;
	let u;

	beforeEach(() => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
	});

	afterEach(() => {
		u?.destroy();
		u = null;
		globalThis.uPlot = previousUPlot;
	});

	function plot() {
		u = new uPlot({
			width: 240, height: 160, pxRatio: 1,
			padding: [0, 0, 0, 0],
			axes: [{ show: false }, { show: false }],
			scales: { x: { time: false, range: [0, 1] }, y: { range: [0, 30] } },
			cursor: { focus: { prox: -1 }, points: { show: false } },
			series: [{ label: 'Time' }, { label: 'Open', value: (self, value) => value == null ? '--' : `USD ${value}` }],
			plugins: [legendAsTooltipPlugin({ className: 'tooltip' })],
		}, [[0, 1], [10, 20]], document.body);
	}

	it('mounts the complete legend as a tooltip and retains deferred value updates', async () => {
		plot();
		assert.equal(u.root.querySelector('.u-legend') === null, true);
		await frame();
		const legend = u.over.querySelector('.u-legend');
		assert.equal(legend !== null, true);
		assert.equal(u.root.querySelectorAll('.u-legend').length, 1);
		assert.equal(legend.classList.contains('tooltip'), true);
		assert.equal(legend.classList.contains('u-inline'), false);
		assert.equal(legend.style.display, 'none');
		assert.equal(legend.style.pointerEvents, 'none');
		assert.equal(u.over.style.overflow, 'visible');
		assert.equal(legend.querySelectorAll('.u-marker').length, 2);
		assert.deepEqual([...legend.querySelectorAll('.u-marker')].map(el => el.style.display), ['none', 'none']);

		u.over.dispatchEvent(new MouseEvent('mouseenter'));
		assert.equal(legend.style.display, '');
		u.setCursor({ left: u.valToPos(1, 'x'), top: 40 });
		assert.equal(u.legend.values[1]._, 'USD 20');
		await frame();
		assert.equal(legend.style.transform, `translate(${u.cursor.left}px, 40px)`);
		assert.equal(legend.querySelectorAll('.u-value')[1].textContent, 'USD 20');
		assert.equal(u.over.querySelector('.u-legend') === legend, true);
		assert.equal(legend.classList.contains('u-inline'), false);
		assert.deepEqual([...legend.querySelectorAll('.u-marker')].map(el => el.style.display), ['none', 'none']);
		u.over.dispatchEvent(new MouseEvent('mouseleave'));
		assert.equal(legend.style.display, 'none');
	});

	it('accepts cursor updates before mounting and initializes from current hover and position', async () => {
		plot();
		await Promise.resolve();
		let hoverReads = 0;
		// Happy DOM does not reproduce native pointer hover state.
		u.over.matches = selector => {
			assert.equal(selector, ':hover');
			hoverReads++;
			return true;
		};
		assert.equal(u.root.querySelector('.u-legend') === null, true);
		u.setCursor({ left: u.valToPos(0, 'x'), top: 20 });
		u.setCursor({ left: u.valToPos(1, 'x'), top: 60 });
		await frame();
		const legend = u.over.querySelector('.u-legend');
		assert.equal(legend !== null, true);
		assert.equal(legend.style.display, '');
		assert.equal(legend.style.transform, `translate(${u.cursor.left}px, 60px)`);
		assert.equal(legend.querySelectorAll('.u-value')[1].textContent, 'USD 20');
		assert.equal(hoverReads, 1);
		u.setCursor({ left: u.valToPos(0, 'x'), top: 30 });
		await frame();
		assert.equal(hoverReads, 1, 'hover detection runs only at mount');
	});
});
