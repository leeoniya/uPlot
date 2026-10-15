import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function makePlot({ scale = {}, data = [[10], [1]], key = 'x', mode = 1, ms } = {}) {
	return new uPlot({
		width: 400,
		height: 300,
		mode,
		ms,
		scales: { [key]: { time: false, ...scale } },
		series: mode == 1 ? [{ scale: key }, { stroke: 'blue' }] : [
			{},
			{ stroke: 'blue', facets: [{ scale: key }, { scale: 'y' }] },
		],
	}, mode == 1 ? data : [null, data], document.body);
}

function bounds(u, key = 'x') {
	return [u.scales[key].min, u.scales[key].max];
}

function paddedRange(calls) {
	return (u, min, max, key) => {
		calls.push([min, max, key]);
		return min == null ? [-1, 1] : [min - 1, max + 1];
	};
}

describe('single-point X range', () => {
	// Captured from HEAD before moving equal-extrema expansion into the default rangers.
	const defaults = [
		{ name: 'positive numeric', x: 10, expected: [0, 20] },
		{ name: 'negative numeric', x: -10, expected: [-20, 0] },
		{ name: 'zero numeric', x: 0, expected: [0, 100] },
		{ name: 'positive log base 2', x: 8, scale: { distr: 3, log: 2 }, expected: [4, 16] },
		{ name: 'negative log base 2', x: -8, scale: { distr: 3, log: 2 }, expected: [-16, -4] },
		{ name: 'positive log base 10', x: 10, scale: { distr: 3, log: 10 }, expected: [1, 100] },
		{ name: 'negative log base 10', x: -10, scale: { distr: 3, log: 10 }, expected: [-100, -1] },
		{ name: 'positive asinh', x: 10, scale: { distr: 4 }, expected: [1, 100] },
		{ name: 'negative asinh', x: -10, scale: { distr: 4 }, expected: [-100, -1] },
		{ name: 'non-power log base 2', x: 5, scale: { distr: 3, log: 2 }, expected: [2, 16] },
		{ name: 'small log base 2', x: 1e-5, scale: { distr: 3, log: 2 }, expected: [0.000003814697265625, 0.000030517578125] },
		{ name: 'non-power log base 10', x: 5, scale: { distr: 3, log: 10 }, expected: [0.1, 100] },
		{ name: 'small log base 10', x: 1e-5, scale: { distr: 3, log: 10 }, expected: [1e-6, 1e-4] },
		{ name: 'non-power asinh', x: 5, scale: { distr: 4 }, expected: [0.1, 100] },
		{ name: 'small asinh', x: 1e-5, scale: { distr: 4 }, expected: [1e-6, 1e-4] },
		{ name: 'log with time enabled', x: 5, scale: { distr: 3, time: true }, expected: [0.5, 50] },
		{ name: 'asinh with time enabled', x: 5, scale: { distr: 4, time: true }, expected: [0.5, 50] },
		// Preserve round(86400 / (opts.ms || 1e-3)), not an assumed one-day interval.
		{ name: 'time with default ms', x: 1700000000, scale: { time: true }, expected: [1700000000, 1786400000] },
		{ name: 'time with ms 1', x: 1700000000000, scale: { time: true }, ms: 1, expected: [1700000000000, 1700000086400] },
		// Legacy construction gave [0, 1], but resets gave [0, 0]; both must now give [0, 1].
		{ name: 'ordinal', x: 10, scale: { distr: 2 }, expected: [0, 1] },
		{ name: 'ordinal with time enabled', x: 10, scale: { distr: 2, time: true }, expected: [0, 1] },
	];

	for (const { name, x, scale, ms, expected } of defaults) {
		it(`preserves default ${name} bounds across reranges`, async () => {
			const u = makePlot({ scale, ms, data: [[x], [1]] });
			try {
				await Promise.resolve();
				assert.deepStrictEqual(bounds(u), expected, 'constructor');

				u.setData([[x], [2]]);
				await Promise.resolve();
				assert.deepStrictEqual(bounds(u), expected, 'setData');

				for (let i = 0; i < 2; i++) {
					u.setScale('x', { min: null, max: null });
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), expected, 'repeated reset');
				}
			}
			finally {
				u.destroy();
			}
		});
	}

	for (const { name, scale = {}, key = 'x', mode = 1 } of [
		{ name: 'numeric' },
		{ name: 'scan true', scale: { scan: true } },
		{ name: 'time', scale: { time: true } },
		{ name: 'log base 2', scale: { distr: 3, log: 2 } },
		{ name: 'log base 10', scale: { distr: 3, log: 10 } },
		{ name: 'asinh', scale: { distr: 4 } },
		{ name: 'ordinal', scale: { distr: 2 } },
		{ name: 'custom primary key', key: 'distance' },
		{ name: 'mode 2 numeric', mode: 2 },
		{ name: 'mode 2 time', mode: 2, scale: { time: true } },
	]) {
		it(`passes raw ${name} extrema to a custom range on every rerange`, async () => {
			const calls = [];
			const u = makePlot({ scale: { ...scale, range: paddedRange(calls) }, key, mode });
			const raw = x => scale.distr == 2 ? 0 : x;
			try {
				await Promise.resolve();
				assert.deepStrictEqual(calls, [[raw(10), raw(10), key]], 'constructor');
				assert.deepStrictEqual(bounds(u, key), [raw(10) - 1, raw(10) + 1]);

				calls.length = 0;
				const data = [[20], [2]];
				u.setData(mode == 1 ? data : [null, data]);
				await Promise.resolve();
				assert.deepStrictEqual(calls, [[raw(20), raw(20), key]], 'setData');
				assert.deepStrictEqual(bounds(u, key), [raw(20) - 1, raw(20) + 1]);

				for (let i = 0; i < 2; i++) {
					calls.length = 0;
					u.setScale(key, { min: null, max: null });
					await Promise.resolve();
					assert.deepStrictEqual(calls, [[raw(20), raw(20), key]], 'repeated reset');
					assert.deepStrictEqual(bounds(u, key), [raw(20) - 1, raw(20) + 1]);
				}

				calls.length = 0;
				u.over.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
				await Promise.resolve();
				assert.deepStrictEqual(calls, [[raw(20), raw(20), key]], 'double-click reset');
			}
			finally {
				u.destroy();
			}
		});
	}

	for (const time of [false, true]) {
		const name = time ? 'time' : 'numeric';

		for (const customScan of [false, true]) {
			it(`default ${name} ranger expands equal ${customScan ? 'custom scan' : 'data'} bounds but leaves unequal bounds unchanged`, async () => {
				let scanned = [10, 10];
				const u = makePlot({
					scale: { time, ...(customScan ? { scan: () => scanned } : {}) },
					data: customScan ? [[5, 15], [1, 2]] : [[10], [1]],
				});
				try {
					await Promise.resolve();
					const equalBounds = time ? [10, 86400010] : [0, 20];
					assert.deepStrictEqual(bounds(u), equalBounds, 'equal constructor bounds');

					u.setScale('x', { min: null, max: null });
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), equalBounds, 'equal reset bounds');

					scanned = [5, 15];
					u.setData(customScan ? [[10], [1]] : [[5, 15], [1, 2]]);
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), [5, 15], 'unequal setData bounds');

					u.setScale('x', { min: null, max: null });
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), [5, 15], 'unequal reset bounds');
				}
				finally {
					u.destroy();
				}
			});
		}

		for (const customRange of [false, true]) {
			it(`${customRange ? 'custom' : 'default'} ${name} ranger handles repeated equal X entries without bypassing the explicit near-equal guard`, async () => {
				const calls = [];
				const u = makePlot({
					scale: { time, ...(customRange ? { range: paddedRange(calls) } : {}) },
					data: [[10, 10, 10], [1, 2, 3]],
				});
				const expected = x => customRange ? [x - 1, x + 1] : time ? [x, x + 86400000] : [0, 2 * x];
				try {
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), expected(10), 'constructor');
					assert.deepStrictEqual(calls, customRange ? [[10, 10, 'x']] : []);

					calls.length = 0;
					u.setData([[20, 20, 20], [4, 5, 6]]);
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), expected(20), 'setData');
					assert.deepStrictEqual(calls, customRange ? [[20, 20, 'x']] : []);

					for (const request of [{ min: 20, max: 20 }, { min: 0, max: 5e-17 }]) {
						calls.length = 0;
						u.setScale('x', request);
						await Promise.resolve();
						assert.deepStrictEqual(bounds(u), expected(20), 'explicit near-equal request is ignored');
						assert.deepStrictEqual(calls, []);
					}

					u.setScale('x', { min: null, max: null });
					await Promise.resolve();
					assert.deepStrictEqual(bounds(u), expected(20), 'reset');
					assert.deepStrictEqual(calls, customRange ? [[20, 20, 'x']] : []);
				}
				finally {
					u.destroy();
				}
			});
		}
	}

	for (const mode of [1, 2]) {
		it(`mode ${mode} bypasses custom range for explicit bounds and calculates partial bounds from raw data`, async () => {
			const calls = [];
			const u = makePlot({ mode, scale: { range: paddedRange(calls) } });
			try {
				await Promise.resolve();
				calls.length = 0;
				u.setScale('x', { min: 5, max: 30 });
				await Promise.resolve();
				assert.deepStrictEqual(calls, []);
				assert.deepStrictEqual(bounds(u), [5, 30]);

				for (const [request, expected] of [
					[{ min: 5, max: null }, [5, 11]],
					[{ min: undefined, max: 30 }, [9, 30]],
					[{ min: null, max: null }, [9, 11]],
				]) {
					calls.length = 0;
					u.setScale('x', request);
					await Promise.resolve();
					assert.deepStrictEqual(calls, [[10, 10, 'x']]);
					assert.deepStrictEqual(bounds(u), expected);
				}
			}
			finally {
				u.destroy();
			}
		});

		for (const { name, scanResult } of [
			{ name: 'disabled scan', scanResult: false },
			{ name: 'equal custom scan', scanResult: [40, 40] },
			{ name: 'unequal custom scan', scanResult: [30, 50] },
			{ name: 'empty custom scan', scanResult: [null, null] },
		]) {
			it(`mode ${mode} forwards ${name} results without preexpansion`, async () => {
				const calls = [];
				const scans = [];
				const scan = scanResult === false ? false : (u, key) => {
					scans.push([u, key]);
					return scanResult;
				};
				const raw = scanResult === false ? [null, null] : scanResult;
				const expected = raw[0] == null ? [-1, 1] : [raw[0] - 1, raw[1] + 1];
				const u = makePlot({ mode, scale: { scan, range: paddedRange(calls) } });
				try {
					await Promise.resolve();
					assert.deepStrictEqual(calls, [[...raw, 'x']]);
					assert.deepStrictEqual(bounds(u), expected);
					assert.deepStrictEqual(scans, scanResult === false ? [] : [[u, 'x']]);

					calls.length = scans.length = 0;
					u.setScale('x', { min: 5, max: 60 });
					await Promise.resolve();
					assert.deepStrictEqual(calls, []);
					assert.deepStrictEqual(scans, []);
					assert.deepStrictEqual(bounds(u), [5, 60]);

					u.setScale('x', { min: null, max: null });
					await Promise.resolve();
					assert.deepStrictEqual(calls, [[...raw, 'x']]);
					assert.deepStrictEqual(bounds(u), expected);
					assert.deepStrictEqual(scans, scanResult === false ? [] : [[u, 'x']]);
				}
				finally {
					u.destroy();
				}
			});
		}

		it(`mode ${mode} passes null extrema for empty data and raw extrema after refill`, async () => {
			const calls = [];
			const u = makePlot({ mode, data: [[], []], scale: { range: paddedRange(calls) } });
			try {
				await Promise.resolve();
				assert.deepStrictEqual(calls, [[null, null, 'x']]);
				assert.deepStrictEqual(bounds(u), [-1, 1]);

				for (const [data, expectedRaw, expectedBounds] of [
					[[[10], [1]], [10, 10], [9, 11]],
					[[[], []], [null, null], [-1, 1]],
				]) {
					calls.length = 0;
					u.setData(mode == 1 ? data : [null, data]);
					await Promise.resolve();
					assert.deepStrictEqual(calls, [[...expectedRaw, 'x']]);
					assert.deepStrictEqual(bounds(u), expectedBounds);
				}
			}
			finally {
				u.destroy();
			}
		});
	}
});
