import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import groups from '../demos/zoom-reset-range.js';

const bounds = (u, key) => [u.scales[key].min, u.scales[key].max];

// Happy DOM has no layout engine; provide the overlay's applied dimensions.
function mouse(u, type, fraction, target = u.over) {
	const rect = new DOMRect(0, 0, parseFloat(u.over.style.width), parseFloat(u.over.style.height));
	u.over.getBoundingClientRect = () => rect;
	const event = new MouseEvent(type, {
		bubbles: true,
		button: 0,
		buttons: type == 'mouseup' || type == 'dblclick' ? 0 : 1,
		clientX: rect.width * fraction,
		clientY: rect.height / 2,
	});
	Object.defineProperty(event, 'movementX', { value: type == 'mousemove' ? rect.width / 2 : 0 });
	target.dispatchEvent(event);
}

describe('zoom reset range demo', () => {
	let previousUPlot, originalScan, scans, u;

	beforeEach(async () => {
		previousUPlot = globalThis.uPlot;
		globalThis.uPlot = uPlot;
		originalScan = uPlot.scan;
		scans = [];
		uPlot.scan = (...args) => {
			scans.push(args.slice(1));
			return originalScan(...args);
		};
		[u] = await groups[0].steps[0].render();
		await Promise.resolve();
	});

	afterEach(() => {
		u?.destroy();
		u = null;
		uPlot.scan = originalScan;
		globalThis.uPlot = previousUPlot;
	});

	it('skips Y scans on initial load and double-click reset, but scans on each X-only zoom', async () => {
		assert.equal(u.cursor.drag.x, true);
		assert.equal(u.cursor.drag.y, false);
		assert.deepEqual(bounds(u, 'x'), [0, 100]);
		assert.deepEqual(bounds(u, 'y'), [0, 100]);
		assert.deepEqual(scans, []);
		assert.equal(u.series[1].min, null);
		assert.equal(u.series[1].max, null);

		for (let cycle = 0; cycle < 2; cycle++) {
			mouse(u, 'mousedown', .25);
			mouse(u, 'mousemove', .75);
			mouse(u, 'mouseup', .75, document);
			await Promise.resolve();

			assert.deepEqual(bounds(u, 'x'), [25, 75]);
			assert.equal(scans.length, cycle + 1);
			assert.deepEqual(scans[cycle], ['y', 25, 75, true]);
			const visible = u.data[1].slice(25, 76);
			const min = Math.min(...visible);
			const max = Math.max(...visible);
			assert.deepEqual([u.series[1].min, u.series[1].max], [min, max]);
			assert.deepEqual(bounds(u, 'y'), uPlot.rangeNum(min, max, .1, true));
			assert.notDeepEqual(bounds(u, 'y'), [0, 100]);

			mouse(u, 'dblclick', .5);
			await Promise.resolve();
			assert.deepEqual(bounds(u, 'x'), [0, 100]);
			assert.deepEqual(bounds(u, 'y'), [0, 100]);
			assert.equal(scans.length, cycle + 1, 'reset must not call the scanner');
		}
	});

	it('uses reset bounds when the zoomed interval has no usable Y data', async () => {
		u.setData([u.data[0], u.data[0].map(() => null)]);
		await Promise.resolve();
		assert.deepEqual(scans, []);
		u.setScale('x', { min: 25, max: 75 });
		await Promise.resolve();
		assert.deepEqual(scans, [['y', 25, 75, true]]);
		assert.deepEqual(bounds(u, 'y'), [0, 100]);
	});
});
