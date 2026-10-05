import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function tracked(values) {
	const reads = [];
	return {
		values,
		reads,
		data: new Proxy(values, {
			get(target, key, receiver) {
				if (typeof key == 'string' && /^(0|[1-9]\d*)$/.test(key))
					reads.push(+key);
				return Reflect.get(target, key, receiver);
			},
		}),
		reset() { reads.length = 0; },
	};
}

function toData(mode, values) {
	const pair = [Array.from({ length: values.length }, (_, i) => i), values];
	return mode == 1 ? pair : [null, pair];
}

function makePlot(mode, values, scale = {}, series = {}, extraFacets = []) {
	const data = toData(mode, values);
	if (mode == 2)
		data[1].push(...extraFacets);
	return new uPlot({
		width: 400,
		height: 200,
		mode,
		drawOrder: [],
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		scales: {
			x: { time: false },
			// A static range array defaults asinh to 1, bypassing adaptive selection.
			y: { distr: 4, range: () => [-100, 100], ...scale },
			other: { range: [-1000, 1000] },
		},
		series: [{}, { paths: () => null, points: { show: false }, ...series }],
	}, data, document.body);
}

function makeTogglePlot(mode, inputs, hidden = []) {
	const x = Array.from({ length: inputs[0].values.length }, (_, i) => i);
	return new uPlot({
		width: 400,
		height: 200,
		mode,
		drawOrder: [],
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		scales: {
			x: { time: false, range: (u, min, max) => [min, max] },
			y: { distr: 4, range: () => [-100, 100] },
		},
		series: [{}, ...inputs.map((_, i) => ({
			show: !hidden.includes(i + 1),
			paths: () => null,
			points: { show: false },
		}))],
	}, mode == 1 ? [x, ...inputs.map(input => input.data)] : [null, ...inputs.map(input => [x, input.data])], document.body);
}

const owner = u => u.mode == 1 ? u.series[1] : u.series[1].facets[1];
const bounds = s => [s.min, s.max];
const cacheSnapshot = u => u.series.flatMap(s => [s, ...(s.facets ?? [])]).map(s => ({
	min: s.min,
	max: s.max,
	minAbs: s._minAbs,
}));

function assertOnePass(input, i0 = 0, i1 = input.values.length - 1) {
	assert.deepEqual(input.reads.slice().sort((a, b) => a - b),
		Array.from({ length: Math.max(0, i1 - i0 + 1) }, (_, i) => i0 + i),
		'each requested value must be read exactly once');
}

function customScan(result) {
	return u => {
		[owner(u).min, owner(u).max] = result;
		[u.series[1].min, u.series[1].max] = result;
		return result;
	};
}

describe('asinh scale scan', () => {
	for (const mode of [1, 2]) {
		for (const [name, values, cutoff, expected] of [
			['signed and nullish', [null, -9, undefined, -2, 0, 3, 8], 0, [-9, 8, 2]],
			['positive', [8, 2, 4], 0, [2, 8, 2]],
			['negative', [-8, -2, -4], 0, [-8, -2, 2]],
			['strict cutoff', [-8, -2, 0, 2, 3], 2, [-8, 3, 3]],
			['just above cutoff', [-2, 2, 2 * (1 + Number.EPSILON)], 2, [-2, 2 * (1 + Number.EPSILON), 2 * (1 + Number.EPSILON)]],
			['tiny values', [-1e-129, 0, 1e-128], 0, [-1e-129, 1e-128, 1e-129]],
			['no qualifying value', [-2, 0, 2], 2, [-2, 2, null]],
			['zero only', [0, 0], 0, [0, 0, null]],
			['nullish only', [null, undefined], 0, [null, null, null]],
			['empty', [], 0, [null, null, null]],
		]) {
			it(`mode ${mode}: returns a triple for ${name}, with fallback only in the adaptive threshold`, async () => {
				const u = makePlot(mode, values, { clamp: cutoff });
				try {
					await Promise.resolve();
					assert.deepEqual(uPlot.scan(u, 'y'), expected);
					assert.deepEqual(uPlot.scan(u, 'y', null, null, true), expected);
					assert.equal(u.scales.y._asinh, expected[2] ?? 1);
					assert.deepEqual(uPlot.scan(u, 'missing'), [null, null]);
				}
				finally { u.destroy(); }
			});
		}

		for (const asinh of [2, () => 2]) {
			it(`mode ${mode}: public scans include minAbs with ${typeof asinh} asinh`, async () => {
				const u = makePlot(mode, [-9, -2, 0, 3, 8], { asinh, clamp: 2 });
				try {
					await Promise.resolve();
					assert.equal(u.scales.y._asinh, 2);
					assert.deepEqual(uPlot.scan(u, 'y'), [-9, 8, 3]);
					assert.deepEqual(uPlot.scan(u, 'y', null, null, true), [-9, 8, 3]);
					assert.deepEqual(uPlot.scan(u, 'y', 1, 3, false), [-2, 3, 3]);
				}
				finally { u.destroy(); }
			});
		}

		it(`mode ${mode}: pure scans do not mutate extrema, minAbs caches, bounds, or data`, async () => {
			const values = [-9, -2, 0, 3, 8];
			const u = makePlot(mode, values, { asinh: 2 });
			try {
				await Promise.resolve();
				u.setData(toData(mode, values), false);
				for (const warm of [false, true]) {
					if (warm) {
						u.redraw();
						await Promise.resolve();
						assert.deepEqual(uPlot.scan(u, 'y', null, null, true), [-9, 8, 2]);
					}
					assert.equal(owner(u)._minAbs, warm ? 2 : undefined);
					const before = cacheSnapshot(u);
					const scale = { ...u.scales.y };
					assert.deepEqual(uPlot.scan(u, 'y', 3, 4), [3, 8, 3]);
					assert.deepEqual(uPlot.scan(u, 'y', 4, 2), [null, null, null]);
					assert.deepEqual(cacheSnapshot(u), before);

					assert.deepEqual(u.scales.y, scale);
					assert.deepEqual(values, [-9, -2, 0, 3, 8]);
				}
			}
			finally { u.destroy(); }
		});

		for (const [name, values, cutoff, expected] of [
			['numeric minAbs', [-9, -2, 0, 3, 8], 2, [-9, 8, 3]],
			['no qualifying value', [-2, 0, 2], 2, [-2, 2, null]],
			['null extrema', [null, undefined], 0, [null, null, null]],
		]) {
			it(`mode ${mode}: reuses a matching scalar cache with ${name}`, async () => {
				const input = tracked(values);
				const u = makePlot(mode, input.data, { clamp: cutoff });
				try {
					await Promise.resolve();
					assertOnePass(input);
					assert.equal(owner(u)._minAbs, expected[2]);
					assert.deepEqual(bounds(owner(u)), expected.slice(0, 2));
					assert.deepEqual(bounds(u.series[1]), expected.slice(0, 2));
					input.reset();
					for (let repeat = 0; repeat < 2; repeat++) {
						assert.deepEqual(uPlot.scan(u, 'y', 0, values.length - 1, true), expected);
						u.redraw();
						await Promise.resolve();
						assert.deepEqual(input.reads, [], 'computed null is reusable even when extrema are null');
						assert.equal(u.scales.y._asinh, expected[2] ?? 1);
					}
				}
				finally { u.destroy(); }
			});
		}

		it(`mode ${mode}: normalizes inclusive intervals and returns an empty triple outside them`, async () => {
			const u = makePlot(mode, [-9, -2, 0, 3, 8]);
			try {
				await Promise.resolve();
				assert.deepEqual(uPlot.scan(u, 'y', -10, 100, false), [-9, 8, 2]);
				assert.deepEqual(uPlot.scan(u, 'y', 0.2, 3.8, false), [-2, 3, 2]);
				assert.deepEqual(uPlot.scan(u, 'y', 2, 2, false), [0, 0, null]);
				for (const [i0, i1] of [[4, 2], [5, 10], [-5, -1]])
					assert.deepEqual(uPlot.scan(u, 'y', i0, i1, false), [null, null, null]);
			}
			finally { u.destroy(); }
		});

		for (const asinh of [undefined, 2, () => 2]) {
			for (const sorted of [0, 1, -1]) {
				it(`mode ${mode}: fuses ${typeof asinh} asinh extrema and minAbs into N reads, ignoring sort hint ${sorted}`, async () => {
					const input = tracked(Array.from({ length: 257 }, (_, i) => i % 7 == 0 ? null : i % 2 ? -i : i));
					const series = mode == 1 ? { sorted } : { facets: [{ scale: 'x' }, { scale: 'y', sorted }] };
					const u = makePlot(mode, input.data, { asinh, clamp: 2 }, series);
					try {
						await Promise.resolve();
						assertOnePass(input);
						assert.deepEqual(bounds(owner(u)), [-255, 256]);
						assert.equal(owner(u)._minAbs, 3);
						assert.equal(u.scales.y._asinh, asinh === undefined ? 3 : 2);
						input.reset();
						assert.deepEqual(uPlot.scan(u, 'y', null, null, true), [-255, 256, 3]);
						u.redraw();
						await Promise.resolve();
						assert.deepEqual(input.reads, [], 'internal triples must be reusable for every threshold type');
						assert.deepEqual(uPlot.scan(u, 'y'), [-255, 256, 3]);
						assertOnePass(input);
					}
					finally { u.destroy(); }
				});
			}
		}

		it(`mode ${mode}: invalidates on replacement and in-place setData(false) plus redraw`, async () => {
			let input = tracked([-8, -2, 0, 3, 8]);
			const u = makePlot(mode, input.data);
			try {
				await Promise.resolve();
				assert.equal(u.scales.y._asinh, 2);
				input = tracked([-8, -4, 0, 5, 8]);
				const data = toData(mode, input.data);
				u.setData(data);
				await Promise.resolve();
				assertOnePass(input);
				assert.equal(u.scales.y._asinh, 4);
				input.values[1] = -6;
				input.values[3] = 7;
				input.reset();
				u.setData(data, false);
				assert.equal(owner(u)._minAbs, undefined, 'min/max invalidation also invalidates minAbs');
				assert.deepEqual(input.reads, [], 'setData(false) defers the scan');
				u.redraw();
				await Promise.resolve();
				assertOnePass(input);
				assert.equal(u.scales.y._asinh, 6);
				assert.deepEqual(bounds(owner(u)), [-8, 8]);
				input.reset();
				u.redraw(true, true);
				await Promise.resolve();
				assert.deepEqual(input.reads, []);
				u.setData(toData(mode, []));
				await Promise.resolve();
				assert.equal(u.scales.y._asinh, 1);
				assert.deepEqual(uPlot.scan(u, 'y', null, null, true), [null, null, null]);
			}
			finally { u.destroy(); }
		});

		for (const scale of [{ min: -20, max: 20 }, { scan: false }, { scan: false, min: -20, max: 20 }]) {
			it(`mode ${mode}: default adaptive asinh works with ${JSON.stringify(scale)}`, async () => {
				const input = tracked([-8, -2, 0, 3, 8]);
				const u = makePlot(mode, input.data, scale);
				try {
					await Promise.resolve();
					assert.equal(u.scales.y._asinh, 2);
					assertOnePass(input);
					u.setScale('y', { min: -30, max: 30 });
					await Promise.resolve();
					assert.equal(u.scales.y._asinh, 2);
					input.reset();
					u.redraw();
					await Promise.resolve();
					assert.equal(u.scales.y._asinh, 2);
					assert.deepEqual(input.reads, [], 'unchanged data reuses the scalar cache');
				}
				finally { u.destroy(); }
			});
		}

		for (const minAbs of [4, null]) {
			it(`mode ${mode}: consumes custom scan minAbs ${minAbs} without fallback reads`, async () => {
				const input = tracked([-8, -2, 0, 3, 8]);
				const result = [-8, 8, minAbs];
				const u = makePlot(mode, input.data, { scan: customScan(result) });
				try {
					await Promise.resolve();
					assert.equal(u.scales.y._asinh, minAbs ?? 1);
					assert.deepEqual(input.reads, []);
					result[2] = minAbs == null ? 5 : null;
					u.redraw();
					await Promise.resolve();
					assert.equal(u.scales.y._asinh, result[2] ?? 1);
					assert.deepEqual(input.reads, [], 'custom null is a result, not a missing threshold');
				}
				finally { u.destroy(); }
			});
		}

		it(`mode ${mode}: preserves custom triple extrema on initialization and redraw without reading data`, async () => {
			const input = tracked([-8, -2, 0, 3, 8]);
			const u = makePlot(mode, input.data, {
				scan: customScan([-100, 100, 3]),
				range: (u, min, max) => [min, max],
			});
			try {
				for (const redraw of [false, true]) {
					if (redraw)
						u.redraw();
					await Promise.resolve();
					assert.deepEqual(bounds(owner(u)), [-100, 100]);
					assert.deepEqual(bounds(u.series[1]), [-100, 100]);
					assert.deepEqual(bounds(u.scales.y), [-100, 100]);
					assert.equal(u.scales.y._asinh, 3);
					assert.deepEqual(input.reads, [], 'custom extrema and minAbs must not trigger a data scan');
				}
			}
			finally { u.destroy(); }
		});


		for (const distr of [1, 3]) {
			for (const sorted of [1, -1]) {
				it(`mode ${mode}: distr ${distr} preserves pairs, sorted ${sorted} shortcuts, and matching caches`, async () => {
					const values = Array.from({ length: 1024 }, (_, i) => sorted == 1 ? i + 1 : 1024 - i);
					const input = tracked(values);
					const series = mode == 1 ? { sorted } : { facets: [{ scale: 'x' }, { scale: 'y', sorted }] };
					const u = makePlot(mode, input.data, { distr, range: [1, 1024] }, series);
					try {
						await Promise.resolve();
						input.reset();
						assert.deepEqual(uPlot.scan(u, 'y', 0, 1023, true), [1, 1024]);
						assert.deepEqual([...new Set(input.reads)].sort((a, b) => a - b), [0, 1023]);
						assert.ok(input.reads.length <= 8);
						input.reset();
						assert.deepEqual(uPlot.scan(u, 'y', 0, 1023, true), [1, 1024]);
						assert.deepEqual(input.reads, [], 'non-asinh cache semantics remain unchanged');
						assert.deepEqual(uPlot.scan(u, 'y', 1, 1022), [2, 1023]);
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	it('aligned zoom refreshes adaptive minAbs for the visible interval', async () => {
		const input = tracked([-9, -2, 0, 3, 8]);
		const u = makePlot(1, input.data);
		try {
			await Promise.resolve();
			for (const [min, max, expected] of [[2, 4, [0, 8, 3]], [0, 1, [-9, -2, 2]], [0, 4, [-9, 8, 2]]]) {
				input.reset();
				u.setScale('x', { min, max });
				await Promise.resolve();
				assertOnePass(input, min, max);
				assert.deepEqual(bounds(owner(u)), expected.slice(0, 2));
				assert.equal(u.scales.y._asinh, expected[2]);
				input.reset();
				assert.deepEqual(uPlot.scan(u, 'y', min, max, true), expected);
				assert.deepEqual(input.reads, [], 'the refreshed current-window cache requires no Y reads');
			}
		}
		finally { u.destroy(); }
	});

	it('mode 1: explicit Y update refreshes minAbs after an X zoom suppresses automatic Y ranging', async () => {
		const input = tracked([-9, -2, 0, 3, 8]);
		const u = makePlot(1, input.data, { auto: (u, viaAutoScaleX) => viaAutoScaleX });
		try {
			await Promise.resolve();
			assertOnePass(input);
			assert.equal(u.scales.y._asinh, 2);
			assert.equal(owner(u)._minAbs, 2);
			assert.deepEqual(bounds(owner(u)), [-9, 8]);
			const yBounds = bounds(u.scales.y);

			input.reset();
			u.setScale('x', { min: 2, max: 4 });
			await Promise.resolve();
			assert.deepEqual(bounds(u.scales.x), [2, 4]);
			assert.deepEqual(bounds(u.scales.y), yBounds, 'suppressed Y ranging leaves the scale unchanged');
			assert.equal(u.scales.y._asinh, 2);
			assert.equal(owner(u)._minAbs, undefined, 'X zoom invalidates minAbs even without a pending Y update');
			assert.deepEqual(bounds(owner(u)), [null, null]);
			assert.deepEqual(input.reads, [], 'suppressed Y ranging must not read Y data');

			u.setScale('y', { min: -20, max: 20 });
			await Promise.resolve();
			assert.deepEqual(bounds(u.scales.y), [-20, 20]);
			assert.equal(u.scales.y._asinh, 3);
			assert.equal(owner(u)._minAbs, 3);
			assert.deepEqual(bounds(owner(u)), [0, 8]);
			assertOnePass(input, 2, 4);
			input.reset();
			assert.deepEqual(uPlot.scan(u, 'y', 2, 4, true), [0, 8, 3]);
			assert.deepEqual(input.reads, [], 'the explicit Y update caches the current-window triple');
		}
		finally { u.destroy(); }
	});

	for (const asinh of [undefined, 2]) {
		it(`shared X preserves full cached extrema after zoom and auto reset (asinh ${asinh ?? 'adaptive'})`, async () => {
			const input = tracked([-9, -2, 0, 3, 8]);
			const u = new uPlot({
				width: 400,
				height: 200,
				drawOrder: [],
				axes: [],
				cursor: { show: false },
				legend: { show: false },
				scales: {
					x: { time: false, distr: 4, asinh, range: (u, min, max) => [min, max] },
					y: { range: [0, 10] },
				},
				series: [{}, { paths: () => null, points: { show: false } }],
			}, [input.data, [1, 2, 3, 4, 5]], document.body);
			try {
				await Promise.resolve();
				assert.deepEqual(uPlot.scan(u, 'x', null, null, true), [-9, 8, 2]);
				for (const scanBeforeReset of [false, true]) {
					u.setScale('x', { min: -2, max: 3 });
					await Promise.resolve();
					assert.deepEqual(bounds(u.scales.x), [-2, 3]);

					const before = cacheSnapshot(u);
					assert.deepEqual(uPlot.scan(u, 'x'), [-9, 8, 2]);
					assert.deepEqual(cacheSnapshot(u), before, 'pure full-X scans must leave caches unchanged');
					if (scanBeforeReset) {
						input.reset();
						assert.deepEqual(uPlot.scan(u, 'x', null, null, true), [-9, 8, 2]);
						assert.deepEqual([...new Set(input.reads)].sort((a, b) => a - b), [0, 4]);
						assert.ok(input.reads.length <= 8, 'cached nearest must not require another absolute-value pass');
						assert.equal(u.series[0]._minAbs, 2);
					}
					// Reset must also work without a preceding cached scan repairing the extrema.
					u.setScale('x', { min: null, max: null });
					await Promise.resolve();
					assert.deepEqual(bounds(u.scales.x), [-9, 8]);
					assert.equal(u.scales.x._asinh, 2);
					assert.deepEqual(uPlot.scan(u, 'x', null, null, true), [-9, 8, 2]);
				}
				for (const [i0, i1] of [[4, 2], [5, 10], [-5, -1]]) {
					input.reset();
					assert.deepEqual(uPlot.scan(u, 'x', i0, i1, false), [null, null, null]);
					assert.deepEqual(input.reads, [], 'pure invalid intervals must not read endpoints');
				}
			}
			finally { u.destroy(); }
		});
	}

	for (const mode of [1, 2]) {
		it(`mode ${mode}: public X scans include minAbs even with an explicit threshold`, async () => {
			const data = [[-9, -2, 0, 3, 8], [1, 2, 3, 4, 5]];
			const u = new uPlot({
				width: 400,
				height: 200,
				mode,
				drawOrder: [],
				axes: [],
				cursor: { show: false },
				legend: { show: false },
				scales: {
					x: { time: false, distr: 4, asinh: 2, clamp: 2, range: () => [-10, 10] },
					y: { range: [0, 10] },
				},
				series: [{ scan: false }, { paths: () => null, points: { show: false } }],
			}, mode == 1 ? data : [null, data], document.body);
			try {
				await Promise.resolve();
				for (const cache of [false, true])
					assert.deepEqual(uPlot.scan(u, 'x', null, null, cache), [-9, 8, 3]);
				assert.deepEqual(uPlot.scan(u, 'x', 0, 2, false), [-9, 0, 9]);
			}
			finally { u.destroy(); }
		});

		for (const [name, values, expected] of [
			['numeric minAbs', [-20, -2, 0, 3, 20], [-20, 20, 2]],
			['null minAbs', [0, 0, 0, 0, 0], [-8, 8, 4]],
			['null extrema and minAbs', [null, null, null, null, null], [-8, 8, 4]],
		]) {
			it(`mode ${mode}: toggles cached series with ${name} without Y reads and scans only an initially hidden series`, async () => {
				const inputs = [tracked([-8, -4, 0, 5, 8]), tracked(values), tracked([-30, -1, 0, 2, 30])];
				const u = makeTogglePlot(mode, inputs, [3]);
				try {
					await Promise.resolve();
					assertOnePass(inputs[0]);
					assertOnePass(inputs[1]);
					assert.deepEqual(inputs[2].reads, []);
					const cached = mode == 1 ? u.series[2] : u.series[2].facets[1];
					const hidden = mode == 1 ? u.series[3] : u.series[3].facets[1];
					const minAbs = name == 'numeric minAbs' ? 2 : null;
					assert.equal(cached._minAbs, minAbs);
					assert.equal(hidden._minAbs, undefined);
					for (const show of [false, true, false, true]) {
						for (const input of inputs) input.reset();
						u.setSeries(2, { show });
						await Promise.resolve();
						assert.deepEqual(uPlot.scan(u, 'y', null, null, true), show ? expected : [-8, 8, 4]);
						assert.equal(u.scales.y._asinh, show ? expected[2] : 4);
						assert.equal(cached._minAbs, minAbs, 'visibility changes must preserve computed caches');
						for (const input of inputs)
							assert.deepEqual(input.reads, [], 'toggling a cached series must not read any Y array');
					}

					u.setSeries(3, { show: true });
					await Promise.resolve();
					assert.deepEqual(uPlot.scan(u, 'y', null, null, true), [-30, 30, 1]);
					assert.equal(u.scales.y._asinh, 1);
					assert.equal(hidden._minAbs, 1);
					assert.deepEqual(inputs[0].reads, [], 'showing a cold series must not rescan visible series');
					assert.deepEqual(inputs[1].reads, []);
					assertOnePass(inputs[2]);

					for (const show of [false, true]) {
						for (const input of inputs) input.reset();
						u.setSeries(3, { show });
						await Promise.resolve();
						assert.deepEqual(uPlot.scan(u, 'y', null, null, true), show ? [-30, 30, 1] : expected);
						assert.equal(u.scales.y._asinh, show ? 1 : expected[2]);
						for (const input of inputs) assert.deepEqual(input.reads, []);
					}
				}
				finally { u.destroy(); }
			});
		}

		for (const change of ['replacement', 'in-place', 'window']) {
			const retainsCache = mode == 2 && change == 'window';
			it(`mode ${mode}: ${retainsCache ? 'retains hidden caches across window changes and reshow' : `invalidates hidden caches after ${change} changes and scans them only on reshow`}`, async () => {
				const visible = tracked([-8, -4, 0, 5, 8]);
				let hidden = tracked(change == 'replacement' ? [0, 0, 0, 0, 0] : [-20, -2, 0, 3, 20]);
				const u = makeTogglePlot(mode, [visible, hidden]);
				try {
					await Promise.resolve();
					const facet = mode == 1 ? u.series[2] : u.series[2].facets[1];
					assert.equal(facet._minAbs, change == 'replacement' ? null : 2);
					u.setSeries(2, { show: false });
					await Promise.resolve();
					visible.reset();
					hidden.reset();

					if (change == 'window')
						u.setScale('x', { min: 2, max: 4 });
					else {
						if (change == 'replacement')
							hidden = tracked([-30, -1, 0, 6, 30]);
						else {
							hidden.values[0] = -30;
							hidden.values[1] = -1;
							hidden.values[3] = 6;
							hidden.values[4] = 30;
						}
						const x = [0, 1, 2, 3, 4];
						const data = mode == 1 ? [x, visible.data, hidden.data] : [null, [x, visible.data], [x, hidden.data]];
						u.setData(data, change == 'replacement');
						assert.equal(facet._minAbs, undefined);
						if (change == 'in-place') {
							assert.deepEqual(visible.reads, [], 'setData(false) defers all scans');
							assert.deepEqual(hidden.reads, []);
							u.redraw();
						}
					}
					await Promise.resolve();
					const i0 = change == 'window' && mode == 1 ? 2 : 0;
					if (retainsCache) {
						assert.deepEqual(visible.reads, [], 'mode 2 window changes reuse full-facet Y caches');
						assert.equal(owner(u)._minAbs, 4);
						assert.deepEqual(bounds(owner(u)), [-8, 8]);
						assert.equal(facet._minAbs, 2, 'mode 2 window changes also retain hidden caches');
						assert.deepEqual(bounds(facet), [-20, 20]);
					}
					else {
						assertOnePass(visible, i0, 4);
						assert.equal(facet._minAbs, undefined, 'hidden minAbs remains uncomputed until reshow');
						assert.deepEqual(bounds(facet), [null, null]);
					}
					assert.deepEqual(hidden.reads, [], 'data and window changes must not scan hidden data');

					visible.reset();
					u.setSeries(2, { show: true });
					await Promise.resolve();
					// Mode 2 scans full facets even when the X display window changes.
					const expected = change != 'window' ? [-30, 30, 1] : mode == 1 ? [0, 20, 3] : [-20, 20, 2];
					assert.deepEqual(uPlot.scan(u, 'y', i0, 4, true), expected);
					assert.equal(u.scales.y._asinh, expected[2]);
					assert.equal(facet._minAbs, expected[2]);
					assert.deepEqual(bounds(facet), expected.slice(0, 2));
					assert.deepEqual(bounds(u.series[2]), expected.slice(0, 2));
					if (retainsCache)
						assert.deepEqual(hidden.reads, [], 'mode 2 reshow reuses the hidden full-facet cache after zoom');
					else
						assertOnePass(hidden, i0, 4);
					assert.deepEqual(visible.reads, [], 'reshow must not rescan the valid visible series');
					hidden.reset();
					for (const show of [false, true]) {
						u.setSeries(2, { show });
						await Promise.resolve();
						assert.deepEqual(visible.reads, []);
						assert.deepEqual(hidden.reads, [], 'the refreshed hidden cache is reusable');
					}
				}
				finally { u.destroy(); }
			});
		}

		it(`mode ${mode}: excludes hidden, scan:false, and nonmatching series from all three results`, async () => {
			const u = makePlot(mode, [-8, 4]);
			try {
				await Promise.resolve();
				const excluded = [tracked([-100, 0.1]), tracked([-200, 0.2]), tracked([-300, 0.3])];
				u.addSeries({ show: false, paths: () => null, points: { show: false } });
				u.addSeries({ scan: false, paths: () => null, points: { show: false } });
				u.addSeries({ paths: () => null, points: { show: false }, ...(mode == 1 ? { scale: 'other' } : {
					facets: [{ scale: 'x' }, { scale: 'other' }],
				}) });
				u.setData([...toData(mode, [-8, 4]), ...excluded.map(input => mode == 1 ? input.data : [[0, 1], input.data])]);
				await Promise.resolve();
				for (const input of excluded) input.reset();
				for (const cache of [false, true])
					assert.deepEqual(uPlot.scan(u, 'y', null, null, cache), [-8, 4, 4]);
				assert.equal(u.scales.y._asinh, 4);
				for (const input of excluded) assert.deepEqual(input.reads, []);
				u.setSeries(2, { show: true });
				await Promise.resolve();
				assert.equal(u.scales.y._asinh, 0.1);
				assert.deepEqual(uPlot.scan(u, 'y'), [-100, 4, 0.1]);
				u.setSeries(2, { show: false });
				await Promise.resolve();
				assert.equal(u.scales.y._asinh, 4);
				assert.deepEqual(uPlot.scan(u, 'y', null, null, true), [-8, 4, 4]);
			}
			finally { u.destroy(); }
		});
	}

	it('mode 2 aggregates matching participating facets and mirrors only the primary Y facet extrema', async () => {
		const excluded = tracked([-100, 0.01]);
		const other = tracked([-200, 0.02]);
		const u = makePlot(2, [-8, 4], {}, {
			facets: [{ scale: 'x' }, { scale: 'y' }, { scale: 'y' }, { scale: 'y', scan: false }, { scale: 'other' }],
		}, [[-2, 10], excluded.data, other.data]);
		try {
			await Promise.resolve();
			excluded.reset();
			other.reset();
			const excludedFacet = u.series[1].facets[3];
			excludedFacet.min = -100;
			excludedFacet.max = 0.01;
			excludedFacet._minAbs = 0.01;
			for (const cache of [false, true])
				assert.deepEqual(uPlot.scan(u, 'y', null, null, cache), [-8, 10, 2]);
			assert.equal(u.scales.y._asinh, 2);
			assert.deepEqual(bounds(u.series[1]), [-8, 4]);
			assert.deepEqual(bounds(u.series[1].facets[2]), [-2, 10]);
			assert.deepEqual(excluded.reads, []);
			assert.deepEqual(other.reads, []);
			assert.deepEqual(bounds(excludedFacet), [-100, 0.01]);
			assert.equal(excludedFacet._minAbs, 0.01);
		}
		finally { u.destroy(); }
	});
});
