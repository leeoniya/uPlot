import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const flush = () => Promise.resolve();

const makeOpts = extra => ({
	width: 400,
	height: 300,
	scales: { x: { time: false } },
	series: [{}, { stroke: 'red' }],
	...extra,
});

const data = [[0, 1, 2], [1, 3, 2]];

const loseContext = ctx => { ctx.isContextLost = () => true; };
const logged = (ctx, name) => ctx.log.some(([n]) => n === name);
const strokeStyles = ctx => ctx.log.filter(([n]) => n === 'strokeStyle').flatMap(([, ...v]) => v);

// Make contexts of canvases created from now on report being lost.
async function withFreshContextsLost(fn) {
	const CanProto = HTMLCanvasElement.prototype;
	const original = CanProto.getContext;
	let created = 0;
	CanProto.getContext = function(...args) {
		const ctx = original.apply(this, args);
		created++;
		loseContext(ctx);
		return ctx;
	};
	try {
		return await fn(() => created);
	}
	finally {
		CanProto.getContext = original;
	}
}

describe('canvas context loss', () => {
	it('replaces a lost canvas on the next draw', async () => {
		const u = new uPlot(makeOpts(), data, document.body);
		await flush();

		const oldCtx = u.ctx;
		const oldCan = oldCtx.canvas ?? u.root.querySelector('canvas');
		const parent = oldCan.parentNode;
		const next = oldCan.nextSibling;
		oldCan.setAttribute('part', 'chart-canvas');

		loseContext(oldCtx);
		u.setData([[0, 1, 2], [2, 1, 3]]);
		await flush();

		const newCan = u.root.querySelector('canvas');
		assert.notEqual(u.ctx, oldCtx);
		assert.notEqual(newCan, oldCan);
		assert.equal(oldCan.isConnected, false);
		assert.equal(newCan.parentNode, parent);
		assert.equal(newCan.nextSibling, next);
		assert.equal(newCan.getAttribute('part'), 'chart-canvas');
		assert.equal(newCan.width, oldCan.width);
		assert.equal(newCan.height, oldCan.height);
		assert.ok(logged(u.ctx, 'clearRect'), 'drew on the new context');
		assert.ok(strokeStyles(u.ctx).includes('red'), 'styles are re-applied on the new context');

		u.destroy();
	});

	it('keeps the lost canvas while fresh contexts are lost too', async () => {
		const u = new uPlot(makeOpts(), data, document.body);
		await flush();

		const oldCtx = u.ctx;
		loseContext(oldCtx);

		await withFreshContextsLost(async created => {
			u.setData(data);
			await flush();
			assert.equal(created(), 1, 'one probe per draw');
		});

		assert.equal(u.ctx, oldCtx);
		assert.equal(u.root.querySelectorAll('canvas').length, 1);

		// Once contexts work again, the next draw recovers.
		u.setData(data);
		await flush();
		assert.notEqual(u.ctx, oldCtx);

		u.destroy();
	});

	it('redraws with fresh styles when the context is restored', async () => {
		const u = new uPlot(makeOpts(), data, document.body);
		await flush();

		const ctx = u.ctx;
		const can = u.root.querySelector('canvas');
		ctx.log.length = 0;

		can.dispatchEvent(new Event('contextrestored'));
		await flush();

		assert.equal(u.ctx, ctx);
		assert.ok(logged(ctx, 'clearRect'), 'redrew');
		assert.ok(strokeStyles(ctx).includes('red'), 'style cache was reset');

		u.destroy();
	});

	it('redraws, replacing the canvas, on contextlost', async () => {
		const u = new uPlot(makeOpts(), data, document.body);
		await flush();

		const oldCtx = u.ctx;
		const oldCan = u.root.querySelector('canvas');
		loseContext(oldCtx);
		oldCan.dispatchEvent(new Event('contextlost'));
		await flush();

		assert.notEqual(u.ctx, oldCtx);
		assert.ok(logged(u.ctx, 'clearRect'));

		// Listeners follow the canvas.
		const ctx2 = u.ctx;
		ctx2.log.length = 0;
		oldCan.dispatchEvent(new Event('contextrestored'));
		await flush();
		assert.ok(!logged(ctx2, 'clearRect'), 'old canvas is unbound');

		u.root.querySelector('canvas').dispatchEvent(new Event('contextrestored'));
		await flush();
		assert.ok(logged(ctx2, 'clearRect'), 'new canvas is bound');

		u.destroy();
	});

	it('keeps root === ctx.canvas with dom.uplot: false', async () => {
		const host = document.createElement('div');
		document.body.appendChild(host);

		const u = new uPlot(makeOpts({ dom: { uplot: false }, id: 'c1', class: 'mine' }), data, host);
		await flush();

		const oldRoot = u.root;
		loseContext(u.ctx);
		u.setData(data);
		await flush();

		assert.notEqual(u.root, oldRoot);
		assert.equal(u.root.tagName, 'CANVAS');
		assert.equal(u.root.parentNode, host);
		assert.equal(u.root.id, 'c1');
		assert.ok(u.root.classList.contains('uplot'));
		assert.ok(u.root.classList.contains('mine'));
		assert.equal(u.root.style.width, oldRoot.style.width);

		u.destroy();
		assert.equal(host.childNodes.length, 0, 'destroy removes the replacement');
		host.remove();
	});

	it('unbinds context listeners on destroy', async () => {
		const u = new uPlot(makeOpts(), data, document.body);
		await flush();

		const can = u.root.querySelector('canvas');
		const ctx = u.ctx;
		u.destroy();
		ctx.log.length = 0;

		can.dispatchEvent(new Event('contextrestored'));
		await flush();
		assert.ok(!logged(ctx, 'clearRect'));
	});
});
