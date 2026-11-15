import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import groups from '../../demos/box-whisker.js';

const labels = ['Lib', 'Median', 'q1', 'q3', 'min', 'max'];

describe('box-whisker native tooltip', () => {
	let plots, restore;

	function replace(object, key, descriptor) {
		const previous = Object.getOwnPropertyDescriptor(object, key);
		Object.defineProperty(object, key, { configurable: true, ...descriptor });
		restore.push(() => previous ? Object.defineProperty(object, key, previous) : delete object[key]);
	}

	beforeEach(() => {
		plots = [];
		restore = [];
		replace(globalThis, 'uPlot', { value: uPlot });
		// Happy DOM has no layout; these bounds only support visibility assertions.
		replace(document.documentElement, 'clientWidth', { get: () => 1920 });
		replace(document.documentElement, 'clientHeight', { get: () => 1080 });
	});

	afterEach(async () => {
		await Promise.resolve();
		try {
			for (const u of plots)
				u.destroy();
		}
		finally {
			for (const undo of restore.reverse())
				undo();
		}
	});

	function mockGeometry(u) {
		replace(u.over, 'getBoundingClientRect', { value: () => ({
			left: 20, top: 30, width: u.bbox.width / u.pxRatio, height: u.bbox.height / u.pxRatio,
		}) });
		u.syncRect();
	}

	async function render() {
		const rendered = await groups[0].steps[0].render();
		plots.push(...rendered);
		assert.equal(rendered.length, 1);
		const [u] = rendered;
		await Promise.resolve();
		mockGeometry(u);
		return u;
	}

	function assertReadout(u, idx) {
		const table = u.over.querySelector('.u-tooltip');
		const lib = u.axes[0].values(u, [idx])[0];
		assert.equal(typeof lib, 'string');
		assert.ok(lib.length > 0);
		const values = [lib, ...u.data.slice(1, 6).map(column => column[idx] == null ? '' : uPlot.fmtNum(column[idx]))];
		assert.equal(u.cursor.idx, idx);
		assert.deepEqual([...table.querySelectorAll('tbody tr')].map(row =>
			[...row.querySelectorAll('.u-label, .u-value')].map(cell => cell.textContent)),
			labels.map((label, i) => [label, values[i]]));
		assert.equal(table.style.display, '');
		return table;
	}

	it('renders the real demo with one scalar table, no legend or markers, and live values', async () => {
		const u = await render();
		const table = u.over.querySelector('.u-tooltip');
		assert.equal(u.legend.show, false);
		assert.equal(u.tooltip.show, true);
		assert.equal(u.tooltip.markers.show, false);
		assert.equal(table.tagName, 'TABLE');
		assert.equal(table.classList.contains('u-table'), true);
		assert.equal(table.classList.contains('u-inline'), false);
		assert.equal(table.style.display, 'none');
		for (const idx of [0, 1]) {
			u.setCursor({ left: u.valToPos(idx, 'x'), top: 40 });
			assert.equal(assertReadout(u, idx), table);
			assert.deepEqual([...u.root.querySelectorAll('.u-tooltip')], [table]);
			assert.equal(u.root.querySelector('.u-legend'), null);
			assert.equal(table.querySelector('.u-marker'), null);
		}
	});

	it('shows and hides on hover without repainting or replacing the column highlight', async () => {
		const u = await render();
		const table = u.over.querySelector('.u-tooltip');
		const highlight = u.under.firstElementChild;
		const painted = structuredClone(u.ctx.log);
		assert.equal(highlight.style.display, 'none');
		assert.equal(highlight.style.pointerEvents, 'none');
		// Happy DOM ignores the highlight's display = null reset; check its position below.
		u.over.dispatchEvent(new MouseEvent('mouseenter'));
		u.over.dispatchEvent(new MouseEvent('mousemove', {
			clientX: u.rect.left + u.valToPos(0, 'x'), clientY: u.rect.top + 40,
		}));
		assertReadout(u, 0);
		const firstColumn = highlight.style.transform;
		u.setCursor({ left: u.valToPos(1, 'x'), top: 60 });
		assertReadout(u, 1);
		assert.notEqual(highlight.style.transform, firstColumn);
		assert.ok(parseFloat(highlight.style.width) > 0);
		u.setCursor({ left: -10, top: -10 });
		assert.equal(table.style.display, 'none');
		u.over.dispatchEvent(new MouseEvent('mouseleave'));
		assert.equal(highlight.style.display, 'none');
		u.over.dispatchEvent(new MouseEvent('mouseenter'));
		u.setCursor({ left: u.valToPos(0, 'x'), top: 40 });
		assertReadout(u, 0);
		u.over.dispatchEvent(new MouseEvent('mouseleave'));
		assert.equal(table.style.display, 'none');
		assert.equal(highlight.style.display, 'none');
		assert.equal(u.under.firstElementChild, highlight);
		await Promise.resolve();
		assert.deepEqual(u.ctx.log, painted, 'hover only changes DOM, not the box canvas');
		u.destroy();
		plots.splice(plots.indexOf(u), 1);
		assert.equal(table.isConnected, false);
		assert.equal(u.root.isConnected, false);
	});

	it('keeps the latest cursor values when the demo moves the cursor before ready', async () => {
		let early;
		replace(globalThis, 'uPlot', { value: new Proxy(uPlot, {
			construct(Target, args) {
				const opts = args[0];
				opts.hooks ??= {};
				(opts.hooks.draw ??= []).push(self => {
					if (early)
						return;
					early = { status: self.status, table: self.over.querySelector('.u-tooltip') };
					mockGeometry(self);
					self.setCursor({ left: self.valToPos(0, 'x'), top: 20 });
					self.setCursor({ left: self.valToPos(1, 'x'), top: 60 });
				});
				return Reflect.construct(Target, args);
			},
		}) });
		const u = await render();
		assert.deepEqual(early, { status: 0, table: null });
		assert.equal(u.status, 1);
		assertReadout(u, 1);
		assert.equal(u.root.querySelectorAll('.u-tooltip').length, 1);
		assert.equal(u.root.querySelector('.u-legend'), null);
	});
});
