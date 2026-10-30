import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/instrument.mjs';
import uPlot from '../../src/uPlot.js';
import { legendTooltipPlugin } from '../../demos/legend-tooltip.js';


describe('legend tooltip', () => {
	let plots, observers;

	beforeEach(t => {
		plots = [];
		observers = [];
		t.mock.method(globalThis, 'ResizeObserver', function(callback) {
			const observer = {
				observe: t.mock.fn(),
				disconnect: t.mock.fn(),
				resize(inlineSize, blockSize) {
					const target = observer.observe.mock.calls[0].arguments[0];
					callback([{ target, borderBoxSize: [{ inlineSize, blockSize }] }]);
				},
			};
			observers.push(observer);
			return observer;
		});
		for (const method of ['requestAnimationFrame', 'cancelAnimationFrame'])
			t.mock.method(globalThis, method, () => assert.fail(`unexpected ${method}`));
		// Happy DOM does not lay out the viewport or overlay.
		t.mock.getter(document.documentElement, 'clientWidth', () => 1920);
		t.mock.getter(document.documentElement, 'clientHeight', () => 1080);
	});

	afterEach(() => {
		for (const u of plots)
			u.destroy();
	});

	async function plot(onMount = () => {}) {
		const u = new uPlot({
			width: 240, height: 160, pxRatio: 1,
			padding: [0, 0, 0, 0],
			axes: [{ show: false }, { show: false }],
			scales: { x: { time: false, range: [0, 1] }, y: { range: [0, 30] } },
			cursor: { focus: { prox: -1 }, points: { show: false } },
			legend: { show: false, live: false, mode: 'inline' },
			series: [{ label: 'Time' }, { label: 'Open', value: (self, value) => value == null ? '--' : `USD ${value}` }],
			plugins: [legendTooltipPlugin(), { opts: (self, opts) => {
				const mount = opts.legend.mount;
				opts.legend.mount = (u, el) => {
					for (const method of ['getBoundingClientRect', 'getClientRects'])
						el[method] = () => assert.fail(`tooltip geometry read: ${method}`);
					for (const prop of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'])
						Object.defineProperty(el, prop, { get: () => assert.fail(`tooltip geometry read: ${prop}`) });
					onMount(u, el);
					mount(u, el);
				};
			} }],
			hooks: { init: [self => {
				self.over.getBoundingClientRect = () => new DOMRect(100, 200, 240, 160);
				self.syncRect();
			}] },
		}, [[0, 1], [10, 20]], document.body);
		plots.push(u);
		await Promise.resolve();
		return u;
	}

	it('moves the same live table legend into the overlay, updates values and hides on exit', async () => {
		let mounted, mounts = 0;
		const u = await plot((self, el) => {
			mounted = el;
			mounts++;
			assert.equal(self.root.querySelector('.u-legend') === el, true);
			assert.equal(el.parentNode === self.over, false);
		});
		const legend = u.over.querySelector('.u-legend');
		assert.equal(legend === mounted, true);
		assert.equal(u.root.querySelectorAll('.u-legend').length, 1);
		assert.equal(u.legend.show, true);
		assert.equal(u.legend.live, true);
		assert.equal(u.legend.mode, 'table');
		assert.equal(legend.classList.contains('u-inline'), false);
		assert.equal(legend.classList.contains('u-tooltip'), true);
		assert.equal(legend.style.display, 'none');

		assert.equal(observers.length, 1);
		assert.deepEqual(observers[0].observe.mock.calls.map(call => call.arguments), [[legend, { box: 'border-box' }]]);

		for (const [x, top, value] of [[1, 40, 'USD 20'], [0, 60, 'USD 10']]) {
			u.setCursor({ left: u.valToPos(x, 'x'), top });
			assert.equal(legend.style.display, '');
			assert.equal(u.legend.values[1]._, value);
			assert.equal(legend.querySelectorAll('.u-value')[1].textContent, value);
			assert.equal(legend.style.transform, `translate(${105 + u.cursor.left}px, ${205 + top}px)`);
			assert.equal(u.over.querySelector('.u-legend') === legend, true);
		}
		assert.equal(mounts, 1);
		u.setCursor({ left: -10, top: -10 });
		assert.equal(u.cursor.idx, null);
		assert.equal(legend.style.display, 'none');
	});

	it('uses independent sizes and cursor state for two charts', async t => {
		t.mock.getter(document.documentElement, 'clientWidth', () => 400);
		t.mock.getter(document.documentElement, 'clientHeight', () => 400);
		const a = await plot();
		const b = await plot();

		const legendA = a.over.querySelector('.u-legend');
		const legendB = b.over.querySelector('.u-legend');
		observers[0].resize(101, 81);
		observers[1].resize(50, 40);

		a.setCursor({ left: 195, top: 115 });
		assert.equal(legendA.style.display, '');
		assert.equal(legendB.style.display, 'none');
		b.setCursor({ left: 200, top: 70 });
		assert.equal(legendA.style.transform, 'translate(189px, 229px)');
		assert.equal(legendB.style.transform, 'translate(305px, 275px)');
		observers[0].resize(100, 80);
		assert.equal(legendA.style.transform, 'translate(300px, 320px)');
		assert.equal(legendB.style.transform, 'translate(305px, 275px)');
		a.setCursor({ left: -10, top: -10 });
		assert.equal(legendA.style.display, 'none');
		assert.equal(legendB.style.display, '');
	});

	it('translates synchronously into all four quadrants at the exact 5px-fit thresholds', async t => {
		t.mock.getter(document.documentElement, 'clientWidth', () => 400);
		t.mock.getter(document.documentElement, 'clientHeight', () => 400);
		const u = await plot();
		const legend = u.over.querySelector('.u-legend');

		observers[0].resize(100, 80);

		// Viewport coordinates (295, 315) fit exactly with one 5px gap.
		for (const [left, top, tx, ty] of [
			[195, 115, 300, 320],
			[196, 115, 191, 320],
			[196, 116, 191, 231],
			[195, 116, 300, 231],
			[194, 114, 299, 319],
			[195, 115, 300, 320],
		]) {
			u.setCursor({ left, top });
			assert.equal(legend.style.transform, `translate(${tx}px, ${ty}px)`);
		}
	});

	it('repositions on size growth and shrink with a stationary cursor and retains size through hiding', async t => {
		t.mock.getter(document.documentElement, 'clientWidth', () => 400);
		t.mock.getter(document.documentElement, 'clientHeight', () => 400);
		const u = await plot();
		const legend = u.over.querySelector('.u-legend');
		const observer = observers[0];
		u.setCursor({ left: 195, top: 115 });
		for (const [width, height, tx, ty] of [
			[100, 80, 300, 320],
			[101, 80, 189, 320],
			[101, 81, 189, 229],
			[100, 81, 300, 229],
			[100, 80, 300, 320],
			[101, 81, 189, 229],
		]) {
			observer.resize(width, height);
			assert.equal(legend.style.transform, `translate(${tx}px, ${ty}px)`);
		}

		for (const [width, height] of [[0, 0], [0, 80], [100, 0]]) {
			u.setCursor({ left: -10, top: -10 });
			assert.equal(legend.style.display, 'none');
			observer.resize(width, height);
			assert.equal(legend.style.display, 'none');
			u.setCursor({ left: 195, top: 115 });
			assert.equal(legend.style.display, '');
			assert.equal(legend.style.transform, 'translate(189px, 229px)');
		}
		observer.resize(100, 80);
		assert.equal(legend.style.transform, 'translate(300px, 320px)');
	});

	it('refreshes the transform on scroll and resize and cleans up on destroy', async t => {
		const add = t.mock.method(window, 'addEventListener');
		const remove = t.mock.method(window, 'removeEventListener');
		const u = await plot();

		const legend = u.over.querySelector('.u-legend');
		const sync = t.mock.method(u, 'syncRect');
		let rect = new DOMRect(100, 200, 240, 160);
		t.mock.method(u.over, 'getBoundingClientRect', () => rect);
		u.setCursor({ left: 50, top: 40 });

		// A non-bubbling descendant scroll must reach the capture listener.
		rect = new DOMRect(150, 250, 240, 160);
		u.over.dispatchEvent(new Event('scroll'));
		assert.equal(legend.style.transform, 'translate(205px, 295px)');
		assert.equal(legend.style.display, '');
		rect = new DOMRect(300, 400, 240, 160);
		window.dispatchEvent(new Event('resize'));
		assert.equal(legend.style.transform, 'translate(355px, 445px)');
		assert.equal(legend.style.display, '');

		rect = new DOMRect(-100, 400, 240, 160);
		window.dispatchEvent(new Event('scroll'));
		assert.equal(legend.style.display, 'none');
		rect = new DOMRect(100, 200, 240, 160);
		window.dispatchEvent(new Event('resize'));
		assert.equal(legend.style.display, '');
		assert.equal(legend.style.transform, 'translate(155px, 245px)');

		const listeners = add.mock.calls.map(call => call.arguments).filter(([type]) => type == 'scroll' || type == 'resize');
		assert.equal(listeners.length, 2);
		assert.deepEqual(listeners.map(([type, , capture]) => [type, capture]), [['scroll', true], ['resize', undefined]]);
		u.destroy();
		plots.splice(plots.indexOf(u), 1);

		assert.equal(observers[0].disconnect.mock.callCount(), 1);
		for (const args of listeners)
			assert.ok(remove.mock.calls.some(call => args.every((arg, i) => call.arguments[i] === arg)));
		const calls = sync.mock.callCount();
		window.dispatchEvent(new Event('scroll'));
		window.dispatchEvent(new Event('resize'));
		assert.equal(sync.mock.callCount(), calls);
	});
});
