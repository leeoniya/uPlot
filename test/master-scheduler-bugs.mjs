import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const initial = [[0, 1, 2], [10, 20, 30], [30, 20, 10]];

async function settle() {
	// These cases request at most two commits, never a self-repeating hook.
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function plot(legendShow = false) {
	const u = new uPlot({
		width: 200, height: 200, pxRatio: 1,
		padding: [0, 0, 0, 0],
		axes: [{ show: false }, { show: false }],
		legend: { show: legendShow },
		cursor: { focus: { prox: -1 } },
		scales: { x: { time: false, range: [0, 2] }, y: { range: [0, 100] } },
		series: [{}, ...['red', 'blue'].map(stroke => ({
			stroke, value: (u, value) => value, points: { show: false },
		}))],
	}, initial, document.body);
	await settle();
	return u;
}

function clearCount(u) {
	return u.ctx.log.filter(entry => entry[0] == 'clearRect').reduce((count, entry) => count + entry.length - 1, 0);
}

function throwFromBatch(u, deferHooks) {
	let message = '';
	try {
		u.batch(() => { throw new Error('expected batch failure'); }, deferHooks);
	}
	catch (error) {
		message = error.message;
	}
	assert.equal(message, 'expected batch failure', 'the caller receives the original callback error');
}

// Reproduced on master 4aa4c1d801fe6f61c07881f037411807bdd3a26b and current source.
// Skipped until separate scheduler fixes land. Assertions describe the intended
// behavior; no runtime fix is part of the legend migration.
describe('known master scheduler bugs', () => {
	// batch() leaves queuedCommit occupied when its callback throws.
	for (const deferHooks of [false, true]) {
		it.skip(`schedules later canvas work after a batch callback throws (deferHooks=${deferHooks})`, async () => {
			const u = await plot();
			try {
				const before = clearCount(u);
				throwFromBatch(u, deferHooks);
				u.setSize({ width: 240, height: 200 });
				await settle();
				assert.equal(clearCount(u) - before, 1, 'a thrown batch must not leave commit ownership occupied');
				assert.equal(u.root.querySelector('canvas').width, 240);
			}
			finally { u.destroy(); }
		});
	}

	// The same exception path also leaves deferHooks enabled.
	it.skip('restores ordinary hook delivery after a deferred batch callback throws', async () => {
		const u = await plot();
		let calls = 0;
		u.hooks.setLegend = [() => calls++];
		try {
			throwFromBatch(u, true);
			u.setLegend();
			assert.equal(calls, 1, 'later public calls must not enter an abandoned deferred queue');
		}
		finally { u.destroy(); }
	});

	it.skip('preserves outer hook deferral across an inner nondeferred batch', async () => {
		const u = await plot();
		const delivered = [];
		u.hooks.setSeries = [(u, i) => delivered.push(i)];
		try {
			// No delivered hook starts a batch. This exposes lost nesting state
			// without entering the separate live-queue nontermination scenario.
			u.batch(() => {
				u.setSeries(1, { show: false });
				u.batch(() => u.setSeries(2, { show: false }), false);
				u.setSeries(1, { show: true });
			}, true);
			const beforeFlush = delivered.slice();
			await settle();
			assert.deepEqual(beforeFlush, [], 'the inner batch must not cancel the outer deferral');
			assert.deepEqual(delivered, [1, 2, 1], 'notifications retain their operation order');
		}
		finally { u.destroy(); }
	});

	// _commit clears shouldSetCursor after the hook requests another refresh.
	it.skip('retains a cursor refresh requested by setData in a setCursor hook with unchanged ranges', async () => {
		const u = await plot(true);
		let requested = false;
		const replacement = [[0, 0.25, 1], [7, 8, 9], [9, 8, 7]];
		try {
			u.setCursor({ left: u.valToPos(1, 'x'), top: u.valToPos(20, 'y') });
			await settle();
			assert.equal(u.cursor.idx, 1);
			u.hooks.setCursor = [u => {
				if (!requested) {
					requested = true;
					u.setData(replacement);
				}
			}];
			u.setData([initial[0], [40, 50, 60], initial[2]]);
			await settle();
			assert.equal(requested, true);
			assert.deepEqual(u.data[0], replacement[0]);
			assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], [0, 2, 0, 100]);
			assert.deepEqual(u.cursor.idxs.slice(), [2, 2, 2], 'the hook-requested commit must resolve indices against the replacement X data');
			assert.equal(u.cursor.idx, 2);
			assert.equal(u.legend.values[1]._, 9);
		}
		finally { u.destroy(); }
	});

	// The redundant outer shouldSetLegend reset erases the hook's request.
	it.skip('retains a legend refresh requested by setData in a setLegend hook with unchanged ranges', async () => {
		// Keep the cursor hidden by position, not cursor.show, so master also
		// allocates its index array. A shown legend avoids hidden-legend changes.
		const u = await plot(true);
		let requested = false;
		const replacement = [initial[0], [70, 80, 90], initial[2]];
		try {
			u.setLegend({ idx: 1 });
			assert.equal(u.legend.values[1]._, 20);
			u.hooks.setLegend = [u => {
				if (!requested) {
					requested = true;
					u.setData(replacement);
				}
			}];
			u.setData([initial[0], [40, 50, 60], initial[2]]);
			await settle();
			assert.equal(requested, true);
			assert.equal(u.cursor.left < 0, true);
			assert.deepEqual(u.data[1], replacement[1]);
			assert.deepEqual([u.scales.x.min, u.scales.x.max, u.scales.y.min, u.scales.y.max], [0, 2, 0, 100]);
			assert.equal(u.legend.values[1]._, 80, 'the hook-requested commit must refresh values even when ranges do not change');
		}
		finally { u.destroy(); }
	});
});
