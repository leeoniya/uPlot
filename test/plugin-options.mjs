import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 1, 2], [10, 20, 30]];

function options(extra = {}) {
	return {
		width: 403,
		height: 203,
		pxRatio: 1,
		padding: [0, 0, 0, 0],
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		select: { show: false },
		scales: { x: { time: false } },
		series: [{}, { stroke: 'blue', points: { show: false } }],
		...extra,
	};
}

const canvas = u => u.root.tagName == 'CANVAS' ? u.root : u.root.querySelector('canvas');

describe('plugin options', () => {
	const plots = [];
	function plot(opts, input = data) {
		const u = new uPlot(opts, input, document.body);
		plots.push(u);
		return u;
	}

	afterEach(() => {
		for (const u of plots)
			u.destroy();
		plots.length = 0;
	});

	it('chains copied mutations and replacements on one provisional self, then initializes that self', async () => {
		const events = [];
		const opts = options({
			title: 'Original', id: 'original', class: 'original-class',
			dom: { uplot: true, over: true, under: false },
		});
		const original = structuredClone(opts);
		let captured, uid, copied, replacement, finalOptions, initRoot;

		function provisional(self, event) {
			events.push(event);
			assert.deepEqual(Object.keys(self).sort(), ['status', 'uid']);
			assert.equal(self.status, 0);
			assert.equal(typeof self.uid, 'string');
			assert.ok(self.uid.length > 0);
			if (captured == null) {
				captured = self;
				uid = self.uid;
			}
			assert.equal(self, captured);
			assert.equal(self.uid, uid);
		}

		const plugins = opts.plugins = [
			{ opts(self, current) {
				provisional(self, 'mutate');
				copied = current;
				assert.notEqual(current, opts);
				assert.notEqual(current.dom, opts.dom);
				assert.notEqual(current.series[1].points, opts.series[1].points);
				current.title = 'Mutated';
				current.dom.over = false;
				current.series[1].points.show = true;
			} },
			{ opts(self, current) {
				provisional(self, 'replace');
				assert.equal(current, copied, 'undefined return keeps the mutated options');
				assert.equal(current.title, 'Mutated');
				assert.equal(current.dom.over, false);
				assert.equal(current.series[1].points.show, true);
				return replacement = { ...current, title: 'Replacement', id: 'plugin-id', class: 'plugin-class' };
			} },
			{
				opts(self, current) {
					provisional(self, 'mutate replacement');
					assert.equal(current, replacement);
					assert.equal(current.title, 'Replacement');
					current.title = 'Final title';
					current.dom.under = true;
				},
				hooks: {
					init: [(self, current) => {
						events.push('init');
						assert.equal(self, captured);
						assert.equal(current, replacement);
						finalOptions = current;
						initRoot = self.root;
						assert.equal(self.mode, 1);
						assert.equal(self.pxRatio, 1);
						for (const method of ['setData', 'setScale', 'setSize', 'setPxRatio', 'redraw', 'destroy'])
							assert.equal(typeof self[method], 'function', `${method} is available at init`);
						assert.equal(typeof self.ctx.stroke, 'function');
						assert.equal(self.root.parentElement, document.body);
						assert.equal(self.root.id, 'plugin-id');
						assert.ok(self.root.classList.contains('plugin-class'));
						assert.ok(!self.root.classList.contains('original-class'));
						assert.equal(self.root.querySelector('.u-title').textContent, 'Final title');
						assert.equal(self.over, null);
						assert.equal(self.root.querySelector('.u-over'), null);
						assert.equal(self.root.querySelector('.u-under'), self.under);
						assert.ok(self.under);
						self.root.classList.add('init-decoration');
					}],
					ready: [self => {
						events.push('ready');
						assert.equal(self, captured);
						assert.equal(self.root, initRoot);
						assert.ok(self.root.classList.contains('init-decoration'));
					}],
				},
			},
		];

		const u = plot(opts);
		await Promise.resolve();
		assert.deepEqual(events, ['mutate', 'replace', 'mutate replacement', 'init', 'ready']);
		assert.equal(u, captured);
		assert.equal(u.uid, uid);
		assert.equal(u.status, 1);
		assert.equal(finalOptions.title, 'Final title');
		assert.equal(opts.plugins, plugins);
		const { plugins: ignored, ...unchanged } = opts;
		assert.deepEqual(unchanged, original, 'nested caller options remain untouched');
	});

	it('uses the final mode for faceted data and scale initialization', async () => {
		const input = [null, [[0, 1, 2], [10, 20, 30]]];
		const u = plot(options({
			mode: 1,
			plugins: [{ opts: (self, opts) => ({
				...opts,
				mode: 2,
				scales: { time: { time: false, range: [0, 2] }, value: { range: [0, 40] } },
				series: [{}, { stroke: 'red', points: { show: false }, facets: [{ scale: 'time' }, { scale: 'value' }] }],
			}) }],
		}), input);
		await Promise.resolve();
		assert.equal(u.mode, 2);
		assert.equal(u.data, input);
		assert.deepEqual([u.scales.time.min, u.scales.time.max], [0, 2]);
		assert.deepEqual([u.scales.value.min, u.scales.value.max], [0, 40]);
		assert.equal(u.valToPos(1, 'time', true), u.bbox.left + u.bbox.width / 2);
		assert.ok(u.ctx.log.some(([name]) => name == 'stroke'), 'faceted data renders');
	});

	it('uses final pxRatio and ctxAttrs when creating the canvas', async () => {
		const getContext = HTMLCanvasElement.prototype.getContext;
		const calls = [];
		const attrs = { alpha: false, colorSpace: 'display-p3' };
		HTMLCanvasElement.prototype.getContext = function(...args) {
			const ctx = getContext.apply(this, args);
			calls.push({ args, ctx });
			return ctx;
		};
		try {
			const opts = options({
				ctxAttrs: { alpha: true },
				plugins: [{ opts(self, current) {
					assert.equal(calls.length, 0, 'context creation waits for plugin options');
					current.pxRatio = 2;
					current.ctxAttrs = attrs;
				} }],
			});
			const u = plot(opts);
			await Promise.resolve();
			assert.equal(calls.length, 1);
			assert.deepEqual(calls[0].args, ['2d', attrs]);
			assert.equal(calls[0].ctx, u.ctx);
			assert.equal(u.pxRatio, 2);
			assert.equal(canvas(u).width, opts.width * 2);
			assert.equal(canvas(u).height, opts.height * 2);
			u.setSize({ width: 301, height: 151 });
			await Promise.resolve();
			assert.equal(canvas(u).width, 602);
			assert.equal(canvas(u).height, 302);
			assert.equal(calls.length, 1);
			assert.equal(opts.pxRatio, 1);
			assert.deepEqual(opts.ctxAttrs, { alpha: true });
		}
		finally {
			HTMLCanvasElement.prototype.getContext = getContext;
		}
	});

	it('applies final pxAlign to rendered paths and axes', async () => {
		const drawingOptions = {
			axes: [{ size: 30 }, { size: 40 }],
			scales: { x: { time: false, range: [0, 3] }, y: { range: [0, 40] } },
		};
		const aligned = plot(options({ ...drawingOptions, pxAlign: 1 }));
		const unaligned = plot(options({ ...drawingOptions, pxAlign: 0 }));
		const plugin = plot(options({ ...drawingOptions, pxAlign: 1,
			plugins: [{ opts(self, opts) { opts.pxAlign = 0; } }],
		}));
		await Promise.resolve();
		const drawing = u => JSON.stringify(u.ctx.log);
		assert.notEqual(drawing(aligned), drawing(unaligned), 'fixture exercises pixel alignment');
		assert.equal(drawing(plugin), drawing(unaligned), 'plugin option matches direct unaligned rendering');
	});

	for (const retain of [false, true]) {
		it(`applies plugin cache.paths=${retain} on redraw`, async () => {
			let builds = 0;
			const linear = uPlot.paths.linear();
			const opts = options({
				cache: { paths: !retain },
				series: [{}, { stroke: 'blue', points: { show: false }, paths: (...args) => {
					builds++;
					return linear(...args);
				} }],
				plugins: [{ opts(self, current) { current.cache.paths = retain; } }],
			});
			const u = plot(opts);
			await Promise.resolve();
			assert.equal(builds, 1);
			u.redraw(false);
			await Promise.resolve();
			assert.equal(builds, retain ? 1 : 2, 'only discarded paths rebuild without invalidation');
			assert.equal(u.data, data, 'path policy does not discard data');
			assert.equal(opts.cache.paths, !retain);
		});

		it(`applies plugin cache.data=${retain} after drawing`, async () => {
			const draws = [];
			const input = structuredClone(data);
			const opts = options({
				cache: { data: !retain },
				plugins: [{ opts: (self, current) => ({ ...current, cache: { data: retain } }) }],
				hooks: { draw: [self => draws.push(structuredClone(self.data))] },
			});
			const u = plot(opts, input);
			await Promise.resolve();
			assert.deepEqual(draws, [data], 'draw hooks see the complete data before disposal');
			assert.deepEqual(u.data, retain ? data : [[], []]);
			assert.equal(u.data === input, retain);
			assert.deepEqual(input, data, 'disposal does not truncate caller data');
			u.setData(input);
			await Promise.resolve();
			assert.deepEqual(draws, [data, data], 'setData still renders after disposal');
			assert.deepEqual(u.data, retain ? data : [[], []]);
			assert.deepEqual(input, data);
			assert.equal(opts.cache.data, !retain);
		});
	}

	for (const show of [true, false]) {
		it(`uses plugin legend.show=${show} to choose the DOM wrapper`, async () => {
			const opts = options({ legend: { show: !show },
				plugins: [{ opts(self, current) { current.legend.show = show; } }],
			});
			const u = plot(opts);
			await Promise.resolve();
			assert.equal(u.legend.show, show);
			assert.equal(u.root.querySelector('.u-legend') != null, show);
			assert.equal(u.root.classList.contains('u-wrap'), !show);
			assert.equal(u.root.querySelectorAll('.u-wrap').length, show ? 1 : 0);
			const wrap = show ? u.root.querySelector('.u-wrap') : u.root;
			assert.equal(canvas(u).parentElement, wrap);
			assert.equal(u.over.parentElement, wrap);
			assert.equal(u.under.parentElement, wrap);
			assert.equal(opts.legend.show, !show);
		});
	}

	it('applies a replacement dom.uplot=false before creating any wrapper or layers', async () => {
		const u = plot(options({
			dom: { uplot: true, over: true, under: true },
			title: 'Suppressed', legend: { show: true },
			plugins: [{ opts: (self, opts) => ({ ...opts,
				dom: { uplot: false, over: true, under: true }, id: 'plugin-canvas', class: 'canvas-class',
			}) }],
		}));
		await Promise.resolve();
		assert.equal(u.root.tagName, 'CANVAS');
		assert.equal(u.root.id, 'plugin-canvas');
		assert.ok(u.root.classList.contains('canvas-class'));
		assert.equal(u.root.childNodes.length, 0);
		assert.equal(u.over, null);
		assert.equal(u.under, null);
		assert.equal(u.legend.show, false);
	});
});
