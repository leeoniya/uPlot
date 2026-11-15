import { it } from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import groups from '../../demos/candlestick-ohlc.js';

it('candlestick demo shows formatted values and moves the column highlight without repainting', async () => {
	const previousUPlot = globalThis.uPlot;
	globalThis.uPlot = uPlot;
	let u;
	try {
		[u] = await groups[0].steps[0].render();
		const table = u.over.querySelector('.u-tooltip');
		assert.ok(table);
		assert.equal(u.root.querySelector('.u-legend'), null);
		assert.equal(table.querySelector('.u-marker'), null);
		assert.deepEqual([...table.querySelectorAll('tbody .u-label')].map(el => el.textContent), ['Open', 'High', 'Low', 'Close', 'Volume']);

		const highlight = u.under.firstElementChild;
		const painted = structuredClone(u.ctx.log);
		assert.equal(highlight.style.display, 'none');
		u.over.dispatchEvent(new MouseEvent('mouseenter'));
		assert.equal(highlight.style.display, '');
		let previousColumn;
		for (const idx of [0, 1, 20]) {
			u.setCursor({ left: u.valToPos(idx, 'x'), top: 40 });
			assert.equal(u.cursor.idx, idx);
			assert.equal(table.querySelector('thead th').textContent, new Date(u.data[0][idx] * 1e3).toISOString().slice(0, 10));
			assert.deepEqual([...table.querySelectorAll('tbody .u-value')].map(el => el.textContent), [
				...u.data.slice(1, 5).map(column => '$' + column[idx].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
				uPlot.fmtNum(u.data[5][idx]),
			]);
			assert.notEqual(highlight.style.transform, previousColumn);
			assert.ok(parseFloat(highlight.style.width) > 0);
			previousColumn = highlight.style.transform;
		}
		u.over.dispatchEvent(new MouseEvent('mouseleave'));
		assert.equal(highlight.style.display, 'none');
		await Promise.resolve();
		assert.deepEqual(u.ctx.log, painted);
	}
	finally {
		u?.destroy();
		globalThis.uPlot = previousUPlot;
	}
});
