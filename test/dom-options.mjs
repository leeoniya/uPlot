import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const data = [[0, 25, 50, 75, 100], [10, 30, 50, 70, 90]];
const cursorSelector = '.u-cursor-x, .u-cursor-y, .u-cursor-pt';
const boxKeys = ['left', 'top', 'width', 'height'];
const frame = async () => { await new Promise(requestAnimationFrame); };

function canvas(u) {
	return u.root instanceof HTMLCanvasElement ? u.root : u.root.querySelector('canvas');
}

function box(rect) {
	return Object.fromEntries(boxKeys.map(key => [key, rect[key]]));
}

function geometry(u) {
	return {
		bbox: { ...u.bbox },
		axes: u.axes.map(a => ({ size: a._size, pos: a._pos, splits: a._splits, values: a._values })),
		positions: ['x', 'y'].map(key => [0, 50, 100].map(value => [
			u.valToPos(value, key), u.valToPos(value, key, true),
		])),
	};
}

function assertSameDrawing(actual, expected) {
	assert.deepEqual(geometry(actual), geometry(expected));
	// Include the recorded Path2D commands, not just the number of draw calls.
	assert.deepEqual(JSON.parse(JSON.stringify(actual.ctx.log)), JSON.parse(JSON.stringify(expected.ctx.log)));
	assert.ok(actual.ctx.log.some(([name]) => name == 'fillText'), 'canvas axis labels still render');
	assert.ok(actual.ctx.log.some(([name]) => name == 'stroke'), 'canvas strokes still render');
}

function mouse(target, type, left, top) {
	const event = new MouseEvent(type, {
		bubbles: true, cancelable: true, button: 0,
		buttons: type == 'mouseup' || type == 'dblclick' ? 0 : 1,
		clientX: left, clientY: top,
	});
	Object.defineProperties(event, {
		movementX: { value: 10 },
		movementY: { value: 10 },
	});
	target.dispatchEvent(event);
}

describe('DOM options', () => {
	const plots = new Set();

	function plot(options = {}, mount) {
		return new uPlot({
			width: 600,
			height: 400,
			pxRatio: 1,
			padding: [10, 20, 10, 20],
			series: [{}, { stroke: 'blue', points: { show: false } }],
			scales: { x: { time: false, range: [0, 100] }, y: { range: [0, 100] } },
			axes: [{ size: 30 }, { size: 60 }],
			...options,
		}, data.map(values => values.slice()), (self, init) => {
			plots.add(self);
			self.ctx.measureText = text => ({ width: String(text).length * 8 * self.pxRatio });
			if (mount)
				mount(self, init);
			else {
				document.body.appendChild(self.root);
				init();
			}
		});
	}

	afterEach(() => {
		for (const u of plots)
			u.destroy();
		plots.clear();
	});

	for (const [name, dom] of [
		['omitted flags', undefined],
		['empty flags', {}],
		['explicit true flags', { uplot: true, over: true, under: true }],
	]) {
		it(`defaults to the full DOM with ${name}`, async () => {
			const u = plot({ ...(dom === undefined ? {} : { dom }), title: 'Title', id: 'dom-default', class: 'custom' });
			await frame();
			assert.equal(u.root.tagName, 'DIV');
			assert.equal(u.root.id, 'dom-default');
			assert.ok(u.root.classList.contains('uplot'));
			assert.ok(u.root.classList.contains('custom'));
			assert.equal(u.root.querySelector('.u-title').textContent, 'Title');
			assert.ok(u.root.querySelector('.u-legend'));
			const wrap = u.root.querySelector('.u-wrap');
			assert.equal(wrap.parentElement, u.root);
			[u.under, canvas(u), u.over].forEach((el, i) => assert.equal(wrap.children[i], el));
			assert.equal(u.over.className, 'u-over');
			assert.equal(u.under.className, 'u-under');
			assert.equal(u.root.querySelectorAll('.u-axis').length, 2);
			assert.ok(u.axes.every(a => a._el?.parentElement === wrap));
			assert.equal(u.cursor.show, true);
			assert.equal(u.select.show, true);
			assert.ok(u.over.querySelector('.u-cursor-pt'));
			assert.equal(u.over.querySelector('.u-select').parentElement, u.over);
		});
	}

	for (const [name, options, compact, legendShown] of [
		['no title or legend', { legend: { show: false } }, true, false],
		['empty title', { title: '', legend: { show: false } }, true, false],
		['title only', { title: 'Title', legend: { show: false } }, false, false],
		['default legend', {}, false, true],
		['empty legend options', { legend: {} }, false, true],
		['explicit legend', { legend: { show: true } }, false, true],
		['explicitly undefined legend.show', { legend: { show: undefined } }, false, true],
	['explicitly null legend.show', { legend: { show: null } }, false, true],
	]) {
		it(`uses the correct wrap with ${name}`, async () => {
			const u = plot(options);
			await frame();
			assert.equal(u.root.querySelector('.u-legend') != null, legendShown);
			assert.equal(!!u.legend.show, legendShown);
			assert.equal(u.root.tagName, 'DIV');
			assert.ok(u.root.classList.contains('uplot'));
			assert.equal(u.root.classList.contains('u-wrap'), compact);
			assert.equal(u.root.querySelectorAll('.u-wrap').length, compact ? 0 : 1);
			const wrap = compact ? u.root : u.root.querySelector('.u-wrap');
			assert.equal(canvas(u).parentElement, wrap);
			assert.equal(u.over.parentElement, wrap);
			assert.equal(u.under.parentElement, wrap);
			assert.ok(u.axes.every(a => a._el.parentElement === wrap));
		});
	}

	for (const returnsOptions of [false, true]) {
		it(`applies non-DOM options from a plugin that ${returnsOptions ? 'returns options' : 'mutates options'}`, async () => {
			let calls = 0;
			let mountedLegend;
			const mounts = [];
			const mount = (self, el) => {
				mounts.push(self);
				mountedLegend = el;
				assert.equal(el.parentElement, self.root);
				el.classList.add('plugin-legend');
			};
			const input = { legend: { show: true }, series: [{}, { stroke: 'blue', points: { show: false } }] };
			const original = structuredClone(input);
			const u = plot({
				...input,
				plugins: [{ opts(self, opts) {
					calls++;
					if (returnsOptions)
						return { ...opts, legend: { ...opts.legend, mount },
							series: opts.series.map((s, i) => i == 1 ? { ...s, stroke: 'red' } : s) };
					opts.legend.mount = mount;
					opts.series[1].stroke = 'red';
				} }],
			});
			await frame();
			assert.equal(calls, 1);
			assert.equal(mounts.length, 1);
			assert.equal(mounts[0], u);
			assert.equal(u.legend.mount, mount);
			assert.equal(u.root.querySelector('.u-legend'), mountedLegend);
			assert.ok(mountedLegend.classList.contains('plugin-legend'));
			assert.equal(u.series[1].stroke(u, 1), 'red');
			assert.equal(u.series[1]._stroke, 'red');
			assert.deepEqual(input, original, 'plugin mutations use copied input options');
		});
	}

	for (const [name, options, nested] of [
		['default nested wrap', {}, true],
		['title-only nested wrap', { title: 'Input title', legend: { show: false } }, true],
		['merged root', { legend: { show: false } }, false],
		['missing over', { dom: { over: false } }, true],
		['missing under', { dom: { under: false } }, true],
		['missing both layers', { dom: { over: false, under: false } }, true],
		['merged root without layers', { dom: { over: false, under: false }, legend: { show: false } }, false],
		['canvas-only root', { dom: { uplot: false, over: true, under: true }, title: 'Suppressed', legend: { show: true } }, false],
	]) {
		it(`exposes final DOM to plugin opts and preserves its mutations with ${name}`, async () => {
			const canvasOnly = options.dom?.uplot === false;
			const events = [];
			const additions = [];
			let refs;
			let can;
			let wrap;

			function assertDOM(self) {
				assert.equal(self.root.tagName, canvasOnly ? 'CANVAS' : 'DIV');
				assert.equal(canvas(self), can);
				assert.equal(can.getContext('2d'), self.ctx);
				assert.equal(typeof self.ctx.fillText, 'function');
				assert.equal(self.root.classList.contains('u-wrap'), !canvasOnly && !nested);
				assert.equal(self.root.querySelectorAll('.u-wrap').length, nested ? 1 : 0);
				assert.equal(self.root.querySelector('.u-title')?.textContent ?? '', canvasOnly ? '' : options.title ?? '');
				if (canvasOnly) {
					assert.equal(can, self.root);
					assert.equal(self.root.childNodes.length, 0);
				}
				else {
					assert.equal(can.parentElement, wrap);
					assert.equal(nested ? wrap.parentElement : wrap, self.root);
				}
				for (const key of ['under', 'over']) {
					const enabled = !canvasOnly && options.dom?.[key] !== false;
					assert.equal(self.root.querySelectorAll(`.u-${key}`).length, enabled ? 1 : 0);
					if (enabled) {
						assert.equal(self[key].parentElement, wrap);
						assert.equal(self.root.querySelector(`.u-${key}`), self[key]);
					}
					else
						assert.equal(self[key], null);
				}
				if (!canvasOnly) {
					const layers = [self.under, can, self.over].filter(Boolean);
					layers.forEach((el, i) => assert.equal(wrap.children[i], el));
				}
			}

			function assertPreserved(self, event) {
				events.push(event);
				for (const key of ['root', 'over', 'under', 'ctx'])
					assert.equal(self[key], refs[key], `${key} identity survives plugin opts`);
				assertDOM(self);
				assert.equal(self.root.parentElement, document.body);
				for (const el of new Set([self.root, can, self.over, self.under].filter(Boolean)))
					assert.ok(el.classList.contains('plugin-dom'));
				for (const [parent, child] of additions) {
					assert.equal(child.parentElement, parent);
					assert.ok(self.root.contains(child));
				}
			}

			const u = plot({
				...options,
				plugins: [{
					opts(self) {
						events.push('opts');
						assert.ok(self.root, 'root exists before plugin opts');
						refs = { root: self.root, over: self.over, under: self.under, ctx: self.ctx };
						can = canvas(self);
						wrap = nested ? self.root.querySelector('.u-wrap') : self.root;
						assertDOM(self);
						assert.equal(self.root.parentElement, null, 'internal hierarchy exists before mounting');
						for (const el of new Set([self.root, can, self.over, self.under].filter(Boolean))) {
							el.classList.add('plugin-dom');
							if (el !== can) {
								const child = document.createElement('span');
								el.appendChild(child);
								additions.push([el, child]);
							}
						}
					},
					hooks: {
						init: [self => assertPreserved(self, 'init')],
						ready: [self => assertPreserved(self, 'ready')],
					},
				}],
			});
			await frame();
			assert.deepEqual(events, ['opts', 'init', 'ready']);
			assert.equal(u.status, 1);
		});
	}

	it('does not normalize DOM or effective show flags into caller-owned options', async () => {
		const opts = {
			width: 600, height: 400, title: 'Original title',
			dom: { uplot: false, over: true, under: true },
			axes: [{ dom: true, size: 30 }, { dom: true, size: 60 }],
			cursor: { show: true, focus: { prox: Infinity }, points: { one: true } },
			legend: { show: true }, select: { show: true, over: false },
			series: [{}, { stroke: 'blue' }], scales: { x: { time: false } },
		};
		const original = structuredClone(opts);
		const u = new uPlot(opts, data.map(values => values.slice()), (self, init) => {
			plots.add(self);
			self.ctx.measureText = text => ({ width: String(text).length * 8 * self.pxRatio });
			document.body.appendChild(self.root);
			init();
		});
		await frame();
		assert.equal(u.cursor.show, false);
		assert.equal(u.legend.show, false);
		assert.equal(u.select.show, false);
		assert.ok(u.axes.every(axis => axis._el == null));
		assert.deepEqual(opts, original);
	});

	it('uses only the canvas as root when dom.uplot is false, despite explicit DOM requests', async () => {
		let pointCalls = 0;
		let legendMounts = 0;
		const u = plot({
			dom: { uplot: false, over: true, under: true },
			id: 'canvas-root', class: 'custom', title: 'Suppressed',
			legend: { show: true, mount: () => legendMounts++ }, select: { show: true },
			cursor: { show: true, points: { show: () => { pointCalls++; return document.createElement('div'); } } },
			axes: [{ size: 30, dom: true }, { size: 60, dom: true }],
		});
		await frame();
		assert.ok(u.root instanceof HTMLCanvasElement);
		assert.equal(u.root.getContext('2d'), u.ctx);
		assert.equal(u.root.parentElement, document.body);
		assert.equal(u.root.id, 'canvas-root');
		assert.ok(u.root.classList.contains('uplot'));
		assert.ok(u.root.classList.contains('custom'));
		assert.equal(u.root.childNodes.length, 0);
		assert.equal(u.over, null);
		assert.equal(u.under, null);
		assert.equal(u.legend.show, false);
		assert.equal(u.cursor.show, false);
		assert.equal(u.select.show, false);
		assert.ok(u.axes.every(a => a._el == null));
		assert.ok(u.axes.every(a => a.show && a._show));
		assert.equal(pointCalls, 0);
		assert.equal(legendMounts, 0);
		assert.ok(u.ctx.log.some(([name]) => name == 'fillText'));
	});

	for (const one of [false, true]) {
		it(`disables cursor points and mouse handling without an overlay (one=${one})`, async () => {
			let pointCalls = 0;
			let cursorCalls = 0;
			const bindings = [];
			const bind = Object.fromEntries(['mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave', 'dblclick', 'click'].map(type => [type,
				(self, target, handler) => { bindings.push(type); return handler; },
			]));
			const u = plot({
				dom: { over: false }, legend: { show: false },
				cursor: { show: true, bind, focus: { prox: one ? Infinity : -1 }, points: { one, show: () => { pointCalls++; return document.createElement('div'); } } },
				hooks: { setCursor: [() => cursorCalls++] },
			});
			await Promise.resolve();
			assert.equal(u.over, null);
			assert.ok(u.under);
			assert.equal(u.cursor.show, false);
			assert.equal(u.root.querySelector(cursorSelector), null);
			assert.equal(pointCalls, 0);
			assert.deepEqual(bindings, []);
			const before = [u.cursor.left, u.cursor.top, u.cursor.idx, cursorCalls];
			for (const target of new Set([u.root, canvas(u), u.under, document])) {
				for (const type of ['mouseenter', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'mouseleave'])
					mouse(target, type, 180, 100);
			}
			await Promise.resolve();
			assert.deepEqual([u.cursor.left, u.cursor.top, u.cursor.idx, cursorCalls], before);
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 100]);
			assert.equal(pointCalls, 0);
		});
	}

	for (const over of [false, true]) {
		for (const under of [false, true]) {
			for (const selectOver of [false, true]) {
				it(`enables selection only on its chosen layer (over=${over}, under=${under}, select.over=${selectOver})`, async () => {
					let calls = 0;
					const u = plot({
						dom: { over, under }, legend: { show: false },
						select: { show: true, over: selectOver },
						hooks: { setSelect: [() => calls++] },
					});
					await Promise.resolve();
					const enabled = selectOver ? over : under;
					assert.equal(u.select.show, enabled);
					assert.equal(u.cursor.show, over);
					assert.equal(u.over != null, over);
					assert.equal(u.under != null, under);
					const el = u.root.querySelector('.u-select');
					assert.equal(el != null, enabled);
					if (enabled)
						assert.equal(el.parentElement, selectOver ? u.over : u.under);
					const before = box(u.select);
					const expected = { left: 12, top: 14, width: 80, height: 60 };
					calls = 0;
					u.setSelect(expected);
					assert.deepEqual(box(u.select), enabled ? expected : before);
					assert.equal(calls, enabled ? 1 : 0);
					if (enabled) {
						for (const key of boxKeys)
							assert.equal(parseFloat(el.style[key]), expected[key]);
					}
				});
			}
		}
	}

	it('preserves explicit cursor.show=false and select.show=false with available layers', async () => {
		const u = plot({ cursor: { show: false }, select: { show: false } });
		await Promise.resolve();
		assert.ok(u.over && u.under);
		assert.equal(u.cursor.show, false);
		assert.equal(u.select.show, false);
		assert.equal(u.root.querySelector(cursorSelector), null);
		assert.equal(u.root.querySelector('.u-select'), null);
	});

	it('keeps mouse cursor, points, and over-selection working when only under is disabled', async () => {
		const u = plot({ dom: { under: false }, legend: { show: false }, cursor: { drag: { x: true, y: true, setRange: false } } });
		await Promise.resolve();
		assert.equal(u.under, null);
		assert.ok(u.over);
		assert.equal(u.cursor.show, true);
		assert.equal(u.select.show, true);
		const rect = new DOMRect(101, 203, 500, 350);
		u.over.getBoundingClientRect = () => rect;
		u.syncRect();
		mouse(u.over, 'mousemove', 351, 378);
		assert.equal(u.cursor.idx, 2);
		assert.equal(u.cursor.left, 250);
		assert.equal(u.cursor.top, 175);
		const point = u.over.querySelector('.u-cursor-pt');
		assert.ok(point && !point.classList.contains('u-off'));
		mouse(u.over, 'mousedown', 201, 273);
		mouse(u.over, 'mousemove', 401, 413);
		mouse(document, 'mouseup', 401, 413);
		await Promise.resolve();
		assert.deepEqual(box(u.select), { left: 100, top: 70, width: 200, height: 140 });
		assert.equal(u.root.querySelector('.u-select').parentElement, u.over);
		assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 100]);
	});

	it('preserves mouse and series sync without over', async () => {
		const key = 'dom-options-no-over-sync';
		const source = plot({ legend: { show: false }, cursor: {
			drag: { x: true, y: true, setRange: false },
			sync: { key, setSeries: true },
		} });
		const subscriptions = [];
		let allowPub = true;
		let allowSub = true;
		const receivers = [{ over: false }, { uplot: false }].map(dom => plot({
			dom, legend: { show: false }, select: { over: false },
			cursor: {
				drag: { setRange: false },
				sync: { key, setSeries: true, filters: {
					pub: () => allowPub,
					sub: type => { subscriptions.push(type); return allowSub; },
				} },
			},
		}));
		await Promise.resolve();
		source.over.getBoundingClientRect = () => new DOMRect(101, 203, 500, 350);
		source.syncRect();
		for (const u of receivers) {
			assert.equal(u.over, null);
			canvas(u).getBoundingClientRect = () => { throw new Error('sync must not measure the canvas'); };
		}
		mouse(source.over, 'mousemove', 351, 378);
		for (const u of receivers) {
			assert.deepEqual([u.cursor.left, u.cursor.top, u.cursor.idx], [250, 175, 2]);
			assert.equal(u.rect, null);
			assert.equal(u.root.querySelector(cursorSelector), null);
		}
		mouse(source.over, 'mousedown', 201, 273);
		mouse(source.over, 'mousemove', 401, 413);
		mouse(document, 'mouseup', 401, 413);
		for (const [prop, value] of Object.entries({ left: 100, top: 70, width: 200, height: 140 }))
			assert.ok(Math.abs(receivers[0].select[prop] - value) < 1e-9, `synchronized selection ${prop}`);
		assert.equal(receivers[1].select.show, false);
		for (const u of receivers)
			u.setScale('x', { min: 20, max: 80 });
		await Promise.resolve();
		mouse(source.over, 'dblclick', 401, 413);
		await Promise.resolve();
		for (const u of receivers)
			assert.deepEqual([u.scales.x.min, u.scales.x.max], [0, 100]);
		for (const type of ['mousemove', 'mousedown', 'mouseup', 'dblclick'])
			assert.equal(subscriptions.filter(t => t == type).length >= 2, true, `${type} reaches both no-over recipients`);

		let peerMoves = 0;
		source.hooks.setCursor = [() => peerMoves++];
		for (const u of receivers) {
			u.setCursor({ left: 125, top: 100 }, true, true);
			assert.deepEqual([source.cursor.left, source.cursor.top, source.cursor.idx], [125, 100, 1]);
		}
		assert.equal(peerMoves, 2, 'no-over charts can publish cursor movement');
		allowPub = false;
		receivers[0].setCursor({ left: 375, top: 100 }, true, true);
		assert.equal(source.cursor.left, 125, 'publication filters still apply');
		allowSub = false;
		source.setCursor({ left: 250, top: 175 }, true, true);
		assert.equal(receivers[0].cursor.left, 375, 'subscription filters still apply');
		assert.equal(receivers[1].cursor.left, 125);
		allowPub = allowSub = true;

		source.setSeries(1, { show: false }, true, true);
		await Promise.resolve();
		assert.ok(receivers.every(u => !u.series[1].show));
		receivers[1].setSeries(1, { show: true }, true, true);
		await Promise.resolve();
		assert.ok([source, ...receivers].every(u => u.series[1].show), 'canvas-only charts can publish series changes too');
	});

	it('allows programmatic cursor movement and hiding with missing layers', async () => {
		for (const dom of [{ over: false }, { under: false }, { over: false, under: false }, { uplot: false }]) {
			const u = plot({ dom, legend: { show: false } });
			await Promise.resolve();
			for (const position of [{ left: 250, top: 175 }, { left: -10, top: -10 }]) {
				assert.doesNotThrow(() => u.setCursor(position));
				assert.equal(u.cursor.left, position.left);
				assert.equal(u.cursor.top, position.top);
				if (u.over == null)
					assert.equal(u.root.querySelector(cursorSelector), null);
			}
			u.setSize({ width: 640, height: 420 });
			await Promise.resolve();
			assert.doesNotThrow(() => u.setCursor({ left: 100, top: 100 }, false));
		}
	});

	it('cancels the click after a drag on a merged root without swallowing ordinary clicks', async () => {
		const u = plot({ legend: { show: false }, cursor: { drag: { setRange: false } } });
		await Promise.resolve();
		assert.ok(u.root.classList.contains('u-wrap'));
		assert.equal(u.root.querySelector('.u-wrap'), null);
		u.over.getBoundingClientRect = () => new DOMRect(101, 203, 500, 350);
		u.syncRect();
		const clicks = [];
		u.over.addEventListener('click', () => clicks.push('over'));
		u.root.addEventListener('click', () => clicks.push('root'));
		mouse(u.over, 'mousedown', 201, 273);
		mouse(u.over, 'mousemove', 401, 273);
		mouse(document, 'mouseup', 401, 273);
		mouse(u.over, 'click', 401, 273);
		assert.deepEqual(clicks, [], 'capture-phase drag cancellation precedes target and bubble listeners');
		mouse(u.root, 'click', 401, 273);
		assert.deepEqual(clicks, ['root'], 'only clicks targeting over are cancelled');
		clicks.length = 0;
		mouse(u.over, 'mousedown', 301, 273);
		mouse(document, 'mouseup', 301, 273);
		mouse(u.over, 'click', 301, 273);
		assert.deepEqual(clicks, ['over', 'root']);
	});

	const variants = [
		['nested wrap', {}],
		['compact root', { legend: { show: false } }],
		['no over', { dom: { over: false } }],
		['no under', { dom: { under: false } }],
		['no layers', { dom: { over: false, under: false }, legend: { show: false } }],
		['canvas root', { dom: { uplot: false } }],
	];

	for (const [name, options] of variants) {
		it(`preserves sizing, DPR, and canvas layout with ${name}`, async () => {
			const control = plot();
			const u = plot(options);
			for (const [width, height, pxRatio] of [[600, 400, 1], [641, 421, 1.5], [480, 320, 2]]) {
				for (const p of [control, u]) {
					p.setSize({ width, height });
					p.setPxRatio(pxRatio);
				}
				await Promise.resolve();
				assert.equal(u.width, width);
				assert.equal(u.height, height);
				assert.equal(u.pxRatio, pxRatio);
				const can = canvas(u);
				assert.equal(can.width, Math.round(width * pxRatio));
				assert.equal(can.height, Math.round(height * pxRatio));
				const sized = can === u.root ? can : can.parentElement;
				assert.equal(parseFloat(sized.style.width), width);
				assert.equal(parseFloat(sized.style.height), height);
				for (const key of ['over', 'under']) {
					if (u[key]) {
						for (const prop of boxKeys)
							assert.equal(u[key].style[prop], control[key].style[prop]);
					}
				}
				assertSameDrawing(u, control);
			}
		});
	}

	for (const disabled of [[0], [1], [0, 1]]) {
		it(`suppresses only axis DOM for axes ${disabled.join(', ')}`, async () => {
			const control = plot();
			const u = plot({ axes: [30, 60].map((size, i) => ({ size, dom: !disabled.includes(i) })) });
			for (const width of [600, 720]) {
				control.setSize({ width, height: 400 });
				u.setSize({ width, height: 400 });
				await Promise.resolve();
				assert.equal(u.root.querySelectorAll('.u-axis').length, 2 - disabled.length);
				u.axes.forEach((axis, i) => {
					assert.equal(axis.show, true);
					assert.equal(axis._show, true);
					if (disabled.includes(i))
						assert.ok(axis._el == null);
					else {
						assert.ok(u.root.contains(axis._el));
						assert.equal(axis._el.style.cssText, control.axes[i]._el.style.cssText);
					}
				});
				assert.ok(u.over && u.under);
				assertSameDrawing(u, control);
			}
		});
	}

	for (const [name, dom] of [
		['missing over', { over: false }],
		['missing both layers', { over: false, under: false }],
		['canvas root', { uplot: false }],
	]) {
		it(`keeps rect null and syncRect absent with ${name}`, async () => {
			let synced = 0;
			let reads = 0;
			const u = plot({ dom, pxRatio: 2, hooks: { syncRect: [() => synced++] } }, (self, init) => {
				for (const el of [canvas(self), self.under]) {
					if (el)
						el.getBoundingClientRect = () => { reads++; return new DOMRect(101, 203, 600, 400); };
				}
				document.body.appendChild(self.root);
				init();
			});
			await Promise.resolve();
			assert.equal(u.over, null);
			assert.equal(u.cursor.show, false);
			const assertInert = () => {
				assert.equal(u.syncRect, undefined);
				assert.equal('syncRect' in u, false);
				assert.equal(u.rect, null);
				assert.equal(u.rect, null);
				assert.equal(reads, 0, 'neither canvas nor under provides fallback bounds');
				assert.equal(synced, 0, 'no overlay means no syncRect hook');
			};
			assertInert();
			for (const [width, height, ratio] of [[700, 460, 2], [700, 460, 1]]) {
				u.setSize({ width, height });
				u.setPxRatio(ratio);
				await Promise.resolve();
				assertInert();
			}
			for (const invalidate of [
				() => document.body.dispatchEvent(new Event('scroll', { bubbles: false })),
				() => window.dispatchEvent(new Event('resize')),
			]) {
				invalidate();
				assertInert();
			}
		});
	}

	for (const showCursor of [true, false]) {
		it(`uses cursor-only rect invalidation with cursor.show=${showCursor}`, async () => {
			let synced = 0;
			const u = plot({ cursor: { show: showCursor }, pxRatio: 2, legend: { show: false }, hooks: { syncRect: [() => synced++] } });
			await Promise.resolve();
			let left = 101;
			let top = 203;
			let reads = 0;
			let invalidations = 0;
			if (showCursor) {
				assert.equal(typeof u.syncRect, 'function');
				const syncRect = u.syncRect;
				u.syncRect = defer => {
					if (defer)
						invalidations++;
					syncRect(defer);
				};
			}
			else {
				assert.equal(u.syncRect, undefined);
				assert.equal('syncRect' in u, false);
			}
			for (const el of [canvas(u), u.under])
				el.getBoundingClientRect = () => { throw new Error('rect must measure only the overlay'); };
			// Supply page coordinates independently of u.rect; Happy DOM has no layout engine.
			u.over.getBoundingClientRect = () => {
				reads++;
				return new DOMRect(left, top, 500, 350);
			};
			const scroll = () => document.body.dispatchEvent(new Event('scroll', { bubbles: false }));
			const resize = () => window.dispatchEvent(new Event('resize'));
			scroll();
			resize();
			assert.equal(invalidations, showCursor ? 2 : 0, 'only visible-cursor charts register, before any rect measurement');
			assert.equal(reads, 0);
			assert.equal(synced, 0);

			const initial = u.rect;
			assert.deepEqual(box(initial), { left, top, width: 500, height: 350 });
			assert.equal(u.rect, initial, 'subsequent reads reuse the cache');
			assert.equal(reads, 1);
			assert.equal(synced, 1);
			if (showCursor) {
				u.syncRect(false);
				u.syncRect(false);
				assert.equal(reads, 3);
				assert.equal(synced, 3);
			}
			for (const invalidate of [scroll, resize]) {
				const prevReads = reads;
				const prevSynced = synced;
				const prevInvalidations = invalidations;
				const prevRect = u.rect;
				left += 17;
				top += 23;
				invalidate();
				assert.equal(invalidations, prevInvalidations + (showCursor ? 1 : 0), 'measurements do not change registry membership');
				assert.equal(reads, prevReads, 'invalidation must not read bounds immediately');
				assert.equal(synced, prevSynced, 'invalidation must not fire the measurement hook');
				const rect = u.rect;
				if (showCursor)
					assert.deepEqual(box(rect), { left, top, width: 500, height: 350 });
				else
					assert.equal(rect, prevRect, 'hidden-cursor charts are not globally invalidated');
				assert.equal(reads, prevReads + (showCursor ? 1 : 0));
				assert.equal(synced, prevSynced + (showCursor ? 1 : 0));
				assert.equal(u.rect, rect, 'subsequent reads reuse the cache');
				assert.equal(reads, prevReads + (showCursor ? 1 : 0));
			}
			if (!showCursor) {
				const prevReads = reads;
				const prevSynced = synced;
				u.setSize({ width: 700, height: 460 });
				await Promise.resolve();
				assert.equal(reads, prevReads, 'layout invalidates without measuring the overlay');
				assert.equal(synced, prevSynced, 'layout invalidation does not fire the measurement hook');
				const rect = u.rect;
				assert.deepEqual(box(rect), { left, top, width: 500, height: 350 });
				assert.equal(u.rect, rect, 'the internally refreshed rect is cached');
				assert.equal(reads, prevReads + 1);
				assert.equal(synced, prevSynced + 1);
				assert.equal(u.syncRect, undefined);
				assert.equal('syncRect' in u, false);
			}
			u.destroy();
			plots.delete(u);
			const afterDestroy = [invalidations, reads, synced];
			scroll();
			resize();
			assert.deepEqual([invalidations, reads, synced], afterDestroy, 'destroy removes the chart from global invalidation');
		});
	}

	it('refreshes the overlay rect eagerly or on demand through syncRect', async () => {
		const synced = [];
		const u = plot({ pxRatio: 2, hooks: { syncRect: [(self, rect) => synced.push(box(rect))] } });
		await Promise.resolve();
		let left = 101;
		let top = 203;
		let reads = 0;
		u.over.getBoundingClientRect = () => { reads++; return new DOMRect(left, top, 500, 350); };
		for (const el of [canvas(u), u.under])
			el.getBoundingClientRect = () => { throw new Error('rect must measure only the overlay'); };
		synced.length = 0;
		const initial = { left: 101, top: 203, width: 500, height: 350 };
		assert.deepEqual(box(u.rect), initial);
		assert.equal(reads, 1);
		assert.deepEqual(synced, [initial]);
		left = 151;
		top = 253;
		assert.deepEqual(box(u.rect), initial, 'page movement alone does not invalidate the cache');
		u.syncRect();
		const moved = { left: 151, top: 253, width: 500, height: 350 };
		assert.equal(reads, 2, 'default syncRect refreshes immediately');
		assert.deepEqual(synced, [initial, moved]);
		assert.deepEqual(box(u.rect), moved);
		assert.equal(reads, 2, 'rect reuses the eagerly refreshed cache');
		left = 171;
		top = 283;
		u.syncRect(true);
		assert.equal(reads, 2, 'deferred syncRect does not read layout');
		assert.equal(synced.length, 2, 'deferred syncRect does not notify before the read');
		const deferred = { left: 171, top: 283, width: 500, height: 350 };
		assert.deepEqual(box(u.rect), deferred);
		assert.equal(reads, 3);
		assert.deepEqual(synced, [initial, moved, deferred]);
		assert.deepEqual(box(u.rect), deferred);
		assert.equal(reads, 3);
	});

	for (const [name, options] of variants) {
		it(`supports deferred mount and destroy with ${name}`, async () => {
			const events = [];
			let start;
			let mountedRoot;
			const u = plot({
				...options,
				hooks: {
					init: [() => events.push('init')],
					ready: [() => events.push('ready')],
					destroy: [self => { assert.equal(self.root.isConnected, false); events.push('destroy'); }],
				},
			}, (self, init) => {
				events.push('mount');
				assert.equal(self.root.isConnected, false);
				assert.equal(self.root instanceof HTMLCanvasElement, options.dom?.uplot === false);
				mountedRoot = self.root;
				self.root.classList.add('mounted');
				document.body.appendChild(self.root);
				start = init;
			});
			await Promise.resolve();
			assert.deepEqual(events, ['mount']);
			assert.equal(u.status, 0);
			start();
			await Promise.resolve();
			assert.equal(u.root, mountedRoot);
			assert.ok(u.root.classList.contains('mounted'));
			assert.equal(u.status, 1);
			assert.deepEqual(events, ['mount', 'init', 'ready']);
			u.setSize({ width: 700, height: 450 });
			u.destroy();
			plots.delete(u);
			const recording = JSON.stringify(u.ctx.log);
			await Promise.resolve();
			assert.equal(u.root.parentNode, null);
			assert.deepEqual(events, ['mount', 'init', 'ready', 'destroy']);
			assert.equal(JSON.stringify(u.ctx.log), recording, 'destroy cancels the pending resize');
		});
	}
});
