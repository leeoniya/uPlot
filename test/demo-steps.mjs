import assert from 'node:assert/strict';
import { plotStep } from '../demos/renderDemo.js';
import { getDemoSteps, captureStep } from '../scripts/demoSteps.mjs';

function mockPlot(value, destroyed = []) {
	return {
		root: { outerHTML: `<plot>${value}</plot>` },
		ctx: { width: 10, height: 20, log: [['fillText', [value, 0, 0]]] },
		destroy: () => destroyed.push(value),
	};
}

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

	it('uses indexes by default and stable IDs when supplied', () => {
		const indexed = { render() {} };
		const named = { id: 'ready-memory', render() {} };
		assert.deepStrictEqual(getDemoSteps([
			{ steps: [indexed] },
			{ id: 'boxes', steps: [named] },
		]), [{ id: '0-0', step: indexed }, { id: 'boxes-ready-memory', step: named }]);
	});

	it('rejects unsafe IDs, duplicate IDs, and ambiguous combined IDs', () => {
		for (const id of ['', '../escape', 'a/b', 'a\\b', '.', 1])
			assert.throws(() => getDemoSteps([{ steps: [{ id }] }]), /Demo IDs/);
		assert.throws(() => getDemoSteps([{ id: 'same', steps: [] }, { id: 'same', steps: [] }]), /Duplicate/);
		assert.throws(() => getDemoSteps([{ steps: [{ id: 'same' }, { id: 'same' }] }]), /Duplicate/);
		assert.throws(() => getDemoSteps([{ steps: [{}, { id: '0' }] }]), /Duplicate/);
		assert.throws(() => getDemoSteps([
			{ id: 'a-b', steps: [{ id: 'c' }] },
			{ id: 'a', steps: [{ id: 'b-c' }] },
		]), /Duplicate/);
	});

	it('retains single-plot paths and captures every plot in multi-plot steps', async () => {
		const destroyed = [];
		const first = mockPlot('first', destroyed);
		const second = mockPlot('second', destroyed);
		const captured = [];
		await captureStep(plotStep(() => [first, second]), '0-pair', async (actual, id) => {
			await Promise.resolve();
			assert.deepStrictEqual(destroyed, []);
			captured.push({ actual, id });
		});
		assert.deepStrictEqual(captured.map(item => item.id), ['0-pair/0', '0-pair/1']);
		assert.deepStrictEqual(captured[1].actual, {
			html: '<plot>second</plot>', width: 10, height: 20,
			ctxlog: [['fillText', ['second', 0, 0]]],
		});
		assert.deepStrictEqual(destroyed, ['first', 'second']);
		await captureStep(plotStep(() => mockPlot('single')), '0-0', (actual, id) => {
			assert.equal(id, '0-0');
		});
	});

	it('detects a mismatch in the second plot and cleans up all plots', async () => {
		const destroyed = [];
		const step = plotStep(() => [mockPlot('first', destroyed), mockPlot('changed', destroyed)]);
		await assert.rejects(captureStep(step, '0-pair', (actual, id) => {
			if (id.endsWith('/1'))
				assert.equal(actual.html, '<plot>expected</plot>');
		}), assert.AssertionError);
		assert.deepStrictEqual(destroyed, ['first', 'changed']);
	});

	it('cleans up later plots when checking the first plot fails', async () => {
		const destroyed = [];
		const error = new Error('write failed');
		await assert.rejects(captureStep(plotStep(() => [mockPlot('first', destroyed), mockPlot('second', destroyed)]),
			'0-pair', () => { throw error; }), err => err === error);
		assert.deepStrictEqual(destroyed, ['first', 'second']);
	});

	it('rejects empty or non-array step results', async () => {
		for (const result of [[], undefined, {}])
			await assert.rejects(captureStep({ render: () => result }, '0-empty', () => {}), /nonempty plot array/);
	});
});
