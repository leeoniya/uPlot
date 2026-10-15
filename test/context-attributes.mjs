import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

describe('canvas context attributes', () => {
	for (const [name, attrs] of [
		['omitted attributes', undefined],
		['empty attributes', Object.freeze({})],
		['wide-gamut color space', Object.freeze({ colorSpace: 'display-p3' })],
		['other native attributes', Object.freeze({ alpha: false, desynchronized: true, willReadFrequently: true })],
	]) {
		it(`forwards ${name} only at context creation`, async () => {
			const original = HTMLCanvasElement.prototype.getContext;
			const calls = [];
			let u;

			HTMLCanvasElement.prototype.getContext = function(...args) {
				const ctx = original.apply(this, args);
				calls.push({ args, ctx });
				return ctx;
			};

			try {
				const opts = {
					width: 400,
					height: 300,
					scales: { x: { time: false } },
					series: [{}, { stroke: 'red' }],
				};
				if (attrs !== undefined)
					opts.ctxAttrs = attrs;
				u = new uPlot(opts, [[0, 1], [1, 2]], document.body);
				await Promise.resolve();

				assert.equal(calls.length, 1);
				assert.equal(calls[0].args[0], '2d');
				assert.equal(calls[0].args[1], attrs);
				assert.equal(calls[0].ctx, u.ctx);

				u.setSize({ width: 500, height: 350 });
				u.setData([[0, 1], [2, 3]]);
				await Promise.resolve();
				assert.equal(calls.length, 1);
				assert.equal(u.ctx, calls[0].ctx);
			}
			finally {
				u?.destroy();
				HTMLCanvasElement.prototype.getContext = original;
			}
		});
	}
});
