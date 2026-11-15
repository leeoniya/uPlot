import { it } from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import groups from '../../demos/box-whisker.js';

it('box-whisker demo shows formatted values and moves the column highlight without repainting', async () => {
	const previousUPlot = globalThis.uPlot;
	globalThis.uPlot = uPlot;
	let u;
	try {
		[u] = await groups[0].steps[0].render();
		const table = u.over.querySelector('.u-tooltip');
		assert.ok(table);
		assert.equal(u.root.querySelector('.u-legend'), null);
		assert.equal(table.querySelector('.u-marker'), null);
		assert.deepEqual([...table.querySelectorAll('tbody .u-label')].map(el => el.textContent), ['Lib', 'Median', 'q1', 'q3', 'min', 'max']);

		const highlight = u.under.firstElementChild;
		const painted = structuredClone(u.ctx.log);
		let previousColumn;
		for (const idx of [0, 1]) {
			u.setCursor({ left: u.valToPos(idx, 'x'), top: 40 });
			assert.equal(u.cursor.idx, idx);
			assert.deepEqual([...table.querySelectorAll('tbody .u-value')].map(el => el.textContent), [
				u.axes[0].values(u, [idx])[0],
				...u.data.slice(1, 6).map(column => column[idx] == null ? '' : uPlot.fmtNum(column[idx])),
			]);
			assert.notEqual(highlight.style.transform, previousColumn);
			assert.ok(parseFloat(highlight.style.width) > 0);
			previousColumn = highlight.style.transform;
		}
		await Promise.resolve();
		assert.deepEqual(u.ctx.log, painted);
	}
	finally {
		u?.destroy();
		globalThis.uPlot = previousUPlot;
	}
});
