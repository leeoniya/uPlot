import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import { plotStep } from '../../demos/renderDemo.js';

describe('demo step helpers', () => {
	it('awaits initial microtasks for synchronous construction', async () => {
		const plot = { ready: false };
		const step = plotStep(() => {
			queueMicrotask(() => { plot.ready = true; });
			return plot;
		});
		assert.deepStrictEqual(await step.render(), [plot]);
		assert.equal(plot.ready, true);
	});

	it('awaits asynchronous construction and preserves plot arrays', async () => {
		const plots = [{ ready: false }, { ready: false }];
		const step = plotStep(async () => {
			await Promise.resolve();
			queueMicrotask(() => plots.forEach(plot => { plot.ready = true; }));
			return plots;
		});
		assert.equal(await step.render(), plots);
		assert.ok(plots.every(plot => plot.ready));
	});

	it('propagates synchronous and asynchronous construction errors', async () => {
		const error = new Error('construction failed');
		await assert.rejects(plotStep(() => { throw error; }).render(), err => err === error);
		await assert.rejects(plotStep(async () => { throw error; }).render(), err => err === error);
	});
});
