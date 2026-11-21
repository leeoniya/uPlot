import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1], [1, 2]];

describe('DOM factories and mounting', () => {
	const plots = [];

	function plot(options = {}, target = document.body) {
		return new uPlot({
			width: 300, height: 200, pxRatio: 1,
			axes: [{ show: false }, { show: false }],
			legend: { show: false },
			scales: { x: { time: false } },
			series: [{}, { stroke: 'blue', class: 'custom-series' }],
			plugins: [{ opts: self => { plots.push(self); } }],
			...options,
		}, data, target);
	}

	afterEach(() => {
		for (const u of plots)
			u.destroy?.();
		plots.length = 0;
	});

	it('creates default cursor points and mounts before init', () => {
		let initialized = 0;
		const u = plot({ hooks: { init: [self => {
			initialized++;
			assert.equal(self.root.parentNode, document.body);
		}] } });
		assert.equal(initialized, 1);
		assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 1);
	});

	for (const show of [false, true]) {
		it(`leaves cursor.points.show=${show} unwrapped and creates no points`, () => {
			const u = plot({ cursor: { points: { show } } });
			assert.equal(u.cursor.points.show, show);
			u.addSeries({ stroke: 'red' });
			u.setData([...data, [2, 3]]);
			assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 0);
		});
	}

	for (const value of [null, undefined]) {
		it(`accepts a cursor-point factory returning ${value}`, () => {
			const u = plot({ cursor: { points: { show: () => value } } });
			assert.equal(u.over.querySelectorAll('.u-cursor-pt').length, 0);
		});
	}

	it('calls cursor-point factories for construction and addSeries, not cursor updates or redraws', async () => {
		const calls = [];
		const show = (self, si) => {
			const point = document.createElement('div');
			calls.push({ self, si, point });
			return point;
		};
		const u = plot({ cursor: { points: { show } } });
		assert.equal(u.cursor.points.show, show);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].self, u);
		assert.equal(calls[0].si, 1);
		assert.equal(calls[0].point.parentNode, u.over);
		assert.ok(calls[0].point.classList.contains('custom-series'));
		await Promise.resolve();
		u.setCursor({ left: 20, top: 30 });
		u.redraw();
		await Promise.resolve();
		assert.equal(calls.length, 1);
		u.addSeries({ stroke: 'red' });
		u.setData([...data, [2, 3]]);
		await Promise.resolve();
		assert.equal(calls.length, 2);
		assert.equal(calls[1].si, 2);
		assert.equal(calls[1].point.parentNode, u.over);
	});

	it('accepts mount targets and cursor points without matching the global HTMLElement constructor', () => {
		const point = document.createElement('div');
		const original = globalThis.HTMLElement;
		// Happy DOM shares HTMLElement across windows; simulate the constructor mismatch.
		globalThis.HTMLElement = class HTMLElement {};
		try {
			assert.equal(document.body instanceof HTMLElement, false);
			assert.equal(point instanceof HTMLElement, false);
			const u = plot({ cursor: { points: { show: () => point } } });
			assert.equal(u.root.parentNode, document.body);
			assert.equal(u.over.querySelector('.u-cursor-pt'), point);
		}
		finally {
			globalThis.HTMLElement = original;
		}
	});

	it('lets a mounting callback defer init until after attachment', () => {
		let finish, initialized = 0, mounted = 0;
		const u = plot({ hooks: { init: [self => {
			initialized++;
			assert.equal(self.root.parentNode, document.body);
		}] } }, (self, init) => {
			mounted++;
			assert.equal(self.root.parentNode, null);
			finish = () => {
				document.body.appendChild(self.root);
				init();
			};
		});
		assert.equal(mounted, 1);
		assert.equal(initialized, 0);
		finish();
		assert.equal(initialized, 1);
		assert.equal(u.root.parentNode, document.body);
	});

	it('initializes without a mount target', () => {
		let initialized = 0;
		const u = plot({ hooks: { init: [() => initialized++] } }, null);
		assert.equal(initialized, 1);
		assert.equal(u.root.parentNode, null);
	});
});
