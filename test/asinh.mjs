import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { asinhAxisSplits, log10AxisValsFilt, log2AxisValsFilt } from '../src/opts.js';

const data = [[1, 2, 3], [-100, 1, 100]];

function plot(scales, mode = 1) {
	return new uPlot({
		width: 600,
		height: 400,
		mode,
		scales: { x: { time: false }, ...scales },
		series: [{}, { stroke: 'blue' }],
	}, mode == 1 ? data : [null, data], document.body);
}

function checkTransform(u, key, threshold) {
	const sc = u.scales[key];
	assert.equal(sc._asinh, threshold);
	assert.equal(sc._min, Math.asinh(sc.min / threshold));
	assert.equal(sc._max, Math.asinh(sc.max / threshold));
	const value = 2;
	const pct = (Math.asinh(value / threshold) - sc._min) / (sc._max - sc._min);
	assert.equal(sc.valToPct(value), pct);
	assert.ok(Math.abs(u.posToVal(u.valToPos(value, key), key) - value) < 1e-10);
}

describe('asinh range safeguards', () => {
	it('gives all-zero data a symmetric nondegenerate range', () => {
		for (const base of [2, 10]) {
			for (const fullMags of [false, true]) {
				assert.deepEqual(uPlot.rangeAsinh(0, 0, base, fullMags), [-1, 1]);
				assert.deepEqual(uPlot.rangeAsinh(-0, 0, base, fullMags), [-1, 1]);
				assert.deepEqual(uPlot.rangeAsinh(0, base, base, fullMags), [0, base]);
				assert.deepEqual(uPlot.rangeAsinh(-base, 0, base, fullMags), [-base, 0]);
			}
		}
	});

	for (const mode of [1, 2]) {
		it(`renders and reranges all-zero asinh data (mode ${mode})`, async () => {
			const toData = values => mode == 1 ? values : [null, values];
			const zeros = toData([[0, 0, 0], [0, 0, 0]]);
			const u = new uPlot({
				width: 600,
				height: 400,
				mode,
				scales: { x: { time: false, distr: 4 }, y: { distr: 4 } },
				series: [{}, { paths: () => null }],
			}, zeros, document.body);
			try {
				await Promise.resolve();
				for (let pass = 0; pass < 2; pass++) {
					for (const key of ['x', 'y']) {
						assert.deepEqual([u.scales[key].min, u.scales[key].max], [-1, 1]);
						checkTransform(u, key, 1);
						assert.ok(Number.isFinite(u.valToPos(0, key)));
					}
					assert.ok(u.axes.every(axis => axis._splits.includes(0)));
					u.setData(toData([[1, 2, 3], [2, 4, 8]]));
					await Promise.resolve();
					u.setData(zeros);
					await Promise.resolve();
				}
			}
			finally { u.destroy(); }
		});
	}

	it('rejects nonfinite and invalid tick bounds without looping', () => {
		// A regression must not hang the test runner.
		execFileSync(process.execPath, ['--input-type=module', '-e', `
			import assert from 'node:assert/strict';
			import { asinhAxisSplits, logAxisSplits } from './src/opts.js';
			for (const base of [2, 10]) {
				const self = { axes: [{ scale: 'y' }], scales: { y: { log: base, _asinh: 1 } } };
				for (const [min, max] of [[1, Infinity], [-Infinity, 1], [-Infinity, Infinity], [Infinity, Infinity], [NaN, 1], [1, NaN], [2, 1]]) {
					assert.deepEqual(logAxisSplits(self, 0, min, max, 1, 30), []);
					assert.deepEqual(asinhAxisSplits(self, 0, min, max, 1, 30), []);
				}
				assert.deepEqual(logAxisSplits(self, 0, 0, 10, 1, 30), []);
				assert.deepEqual(logAxisSplits(self, 0, -1, 10, 1, 30), []);
			}
		`], { cwd: new URL('../', import.meta.url), timeout: 2000, env: { ...process.env, NODE_OPTIONS: '' } });
	});
});

describe('asinh splits', () => {
	for (const base of [2, 10]) {
		const self = { axes: [{ scale: 'y' }], scales: { y: { log: base, _asinh: 1 } } };

		it(`keeps base-${base} logarithmic splits within the visible range`, () => {
			const positive = base == 2 ? [4, 8, 16] : [4, 5, 6, 7, 8, 9, 10];
			const nearZero = base == 2 ? [1, 2, 4] : [1, 2, 3, 4];
			const negative = nearZero.slice().reverse().map(v => -v);
			for (const [min, max, expected] of [
				[4, 16, positive],
				[-16, -4, positive.slice().reverse().map(v => -v)],
				[0, 4, [0, ...nearZero]],
				[-4, 0, [...negative, 0]],
				[-4, 0.5, [...negative, 0]],
				[0.5, 4, nearZero],
				[-4, 1, [...negative, 0, 1]],
				[-1, 4, [-1, 0, ...nearZero]],
			])
				assert.deepEqual(asinhAxisSplits(self, 0, min, max, 1, 30), expected);
		});

		it(`uses numeric splits inside the base-${base} linear region`, () => {
			for (const [min, max, incr, forceMin, expected] of [
				[-0.1, 0.1, 0.05, false, [-0.1, -0.05, 0, 0.05, 0.1]],
				[0.02, 0.09, 0.02, false, [0.02, 0.04, 0.06, 0.08]],
				[-0.09, -0.02, 0.02, false, [-0.08, -0.06, -0.04, -0.02]],
				[-1, 1, 0.5, false, [-1, -0.5, 0, 0.5, 1]],
				[0.03, 0.1, 0.02, true, [0.03, 0.05, 0.07, 0.09]],
			])
				assert.deepEqual(asinhAxisSplits(self, 0, min, max, incr, 30, forceMin), expected);
		});

		it(`retains numeric labels when zooming into the base-${base} linear region`, async () => {
			const u = plot({ y: { distr: 4, log: base, asinh: 1, range: [-100, 100] } });
			try {
				await Promise.resolve();
				const axis = u.axes[1];
				const initialSplits = axis._splits.slice();
				const initialValues = axis._values.slice();
				u.setScale('y', { min: -1, max: 1 });
				await Promise.resolve();
				assert.deepEqual(axis._splits, [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]);
				assert.ok(axis._values.every(v => v != null && v !== ''));
				u.setScale('y', { min: -100, max: 100 });
				await Promise.resolve();
				assert.deepEqual(axis._splits, initialSplits);
				assert.deepEqual(axis._values, initialValues);
			}
			finally { u.destroy(); }
		});
	}
});

describe('asinh label thinning', () => {
	for (const [base, filter] of [[2, log2AxisValsFilt], [10, log10AxisValsFilt]]) {
		it(`thins base-${base} labels independently of threshold magnitude and direction`, async () => {
			let expectedMask;
			for (const threshold of [1, base ** -3, base ** 3]) {
				for (const dir of [1, -1]) {
					const limit = threshold * base ** 12;
					const u = new uPlot({
						width: 600,
						height: 150,
						scales: {
							x: { time: false },
							y: { distr: 4, log: base, asinh: threshold, dir, range: [-limit, limit] },
						},
						series: [{}, { paths: () => null }],
					}, [[1, 2], [-limit, limit]], document.body);
					try {
						await Promise.resolve();
						const axis = u.axes[1];
						assert.equal(axis.filter, filter);
						const mask = axis._values.map(v => v != null && v !== '');
						const kept = axis._splits.filter((v, i) => mask[i]);
						assert.ok(kept.length < axis._splits.length);
						assert.ok(kept.includes(0));
						assert.ok(kept.some(v => v < 0));
						assert.ok(kept.some(v => v > 0));
						assert.deepEqual(kept, kept.slice().reverse().map(v => v == 0 ? 0 : -v));
						expectedMask ??= mask;
						assert.deepEqual(mask, expectedMask);
					}
					finally { u.destroy(); }
				}
			}
		});

		function select(min, max, threshold = 1, keepMod = 3, dir = 1) {
			const magSpace = Math.asinh(base) - Math.asinh(1);
			const self = {
				axes: [{ scale: 'y', _space: magSpace * (keepMod - 0.5) }],
				scales: { y: { distr: 4, log: base, _asinh: threshold, min, max } },
				valToPos: v => dir * Math.asinh(v / threshold),
			};
			const splits = asinhAxisSplits(self, 0, min, max, 1, 30);
			return filter(self, splits, 0).filter(v => v != null);
		}

		it(`selects matching base-${base} magnitudes in symmetric and asymmetric ranges`, () => {
			const outer = (base == 10 ? 9 : 1.75) * base ** 12;
			const inner = (base == 10 ? 9 : 1.75) * base ** 8;
			for (const threshold of [base ** -3, 1, 3, base ** 3]) {
				const positive = [-3, 0, 3, 6, 9, 12].map(e => base ** e).filter(v => v >= threshold);
				const symmetric = [...positive.slice().reverse().map(v => -v), 0, ...positive];
				for (const dir of [1, -1]) {
					for (const [min, max] of [[-outer, outer], [-inner, outer], [-outer, inner]]) {
						assert.deepEqual(select(min, max, threshold, 3, dir), symmetric.filter(v => v >= min && v <= max));
					}
				}
			}
		});

		it(`mirrors base-${base} labels in positive-only and negative-only ranges`, () => {
			const outer = (base == 10 ? 9 : 1.75) * base ** 12;
			for (const threshold of [base ** -3, 1, 3, base ** 3]) {
				for (const min of [-threshold / 2, 0, threshold / 2, threshold, 1.25 * base ** 4]) {
					const expected = [0, ...[-3, 0, 3, 6, 9, 12].map(e => base ** e).filter(v => v >= threshold)].filter(v => v >= min);
					for (const dir of [1, -1]) {
						assert.deepEqual(select(min, outer, threshold, 3, dir), expected);
						assert.deepEqual(select(-outer, -min, threshold, 3, dir), expected.slice().reverse().map(v => v == 0 ? 0 : -v));
					}
				}
			}
		});

		it(`handles empty and single-split base-${base} label lists`, () => {
			const self = {
				axes: [{ scale: 'y', _space: 30 }],
				scales: { y: { distr: 4, _asinh: 1 } },
				valToPos: v => Math.asinh(v),
			};
			for (const splits of [[], [0], [base ** 3], [-(base ** 3)]])
				assert.deepEqual(filter(self, splits, 0), splits);
		});

		it(`preserves ordinary base-${base} log index-based thinning`, () => {
			const splits = base == 2 ? [1, 2, 4, 8, 16, 32, 64] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
			for (const dir of [1, -1]) {
				const self = {
					axes: [{ scale: 'y', _space: 2.5 }],
					scales: { y: { distr: 3, log: base } },
					valToPos: v => dir * Math.log(v) / Math.log(base),
				};
				assert.deepEqual(filter(self, splits, 0), splits.map((v, i) =>
					(splits.length - 1 - i) % 3 == 0 && (base == 2 || v.toExponential()[0] == '1') ? v : null));
			}
		});

		if (base == 10) {
			it('counts skipped decades rather than mantissas, including multiples of nine', () => {
				for (const keepMod of [2, 3, 9, 18]) {
					const positive = [];
					for (let e = 18; e >= -18; e -= keepMod)
						positive.unshift(10 ** e);
					const expected = [...positive.slice().reverse().map(v => -v), 0, ...positive];
					assert.deepEqual(select(-9e18, 9e18, 1e-18, keepMod), expected);
				}
			});
		}

		it(`uses a constant number of position samples for base ${base}`, () => {
			for (const count of [10, 100]) {
				let calls = 0;
				const self = {
					axes: [{ scale: 'y', _space: 30 }],
					scales: { y: { distr: 4, _asinh: 128 } },
					valToPos: v => { calls++; return Math.asinh(v / 128) * 10; },
				};
				const splits = [0, ...Array.from({ length: count }, (v, i) => base ** i)];
				assert.equal(filter(self, splits, 0)[0], 0);
				assert.equal(calls, base == 2 ? 2 : 5);
			}
		});
	}

	it('retains the base-10 digit filters in either axis direction', () => {
		const splits = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
		for (const [space, digits] of [[1, [1, 2, 3, 4, 5, 6, 7, 8, 9]], [2, [1, 2, 3, 5, 7]], [5, [1, 2, 5]], [10, [1]]]) {
			for (const dir of [1, -1]) {
				const self = {
					axes: [{ scale: 'y', _space: space }],
					scales: { y: { distr: 4, _asinh: 100 } },
					valToPos: v => dir * Math.asinh(v / 100) * 10,
				};
				assert.deepEqual(log10AxisValsFilt(self, splits, 0),
					splits.map(v => v == 0 || digits.includes(Number(v.toExponential()[0])) ? v : null));
			}
		}
	});
});

describe('adaptive asinh', () => {
	it('normalizes numeric settings, including dependent overrides', async () => {
		const u = plot({
			x: { time: false, distr: 4 },
			y: { distr: 4, asinh: 10 },
			other: { from: 'y', asinh: 2, range: (u, min, max) => [min, max] },
		});
		try {
			await Promise.resolve();
			assert.equal(typeof u.scales.x.asinh, 'function');
			assert.equal(typeof u.scales.y.asinh, 'function');
			assert.equal(u.scales.y.asinh(u, 'y'), 10);
			assert.equal(typeof u.scales.other.asinh, 'function');
			assert.equal(u.scales.other.asinh(u, 'other'), 2);
			checkTransform(u, 'other', 2);
			checkTransform(u, 'x', 1);
			checkTransform(u, 'y', 10);
		}
		finally { u.destroy(); }
	});

	for (const mode of [1, 2]) {
		it(`scans ${mode == 1 ? 'in-view' : 'full-array'} matching Y data by default (mode ${mode})`, async () => {
			const x = [0.001, 1, 2];
			const aligned = [x, [0, null, 5], [0.001, -0.25, 4], [0, 0.01, 0.02]];
			const toData = values => mode == 1 ? values : [null, ...values.slice(1).map(y => [values[0], y])];
			const series = [{}, { stroke: 'blue' }, {}, mode == 1
				? { scale: 'other' }
				: { facets: [{ scale: 'x' }, { scale: 'other' }] }];
			const u = new uPlot({
				width: 600,
				height: 400,
				mode,
				series,
				scales: {
					x: { time: false, min: 1, max: 2, auto: false, range: (u, min, max) => [min, max] },
					y: { distr: 4, range: () => [-10, 10] },
					other: {},
				},
			}, toData(aligned), document.body);
			try {
				await Promise.resolve();
				checkTransform(u, 'y', mode == 1 ? 0.25 : 0.001);
				const asinh = u.scales.y.asinh;
				u.setScale('x', { min: 0.001, max: 2 });
				await Promise.resolve();
				checkTransform(u, 'y', 0.001);
				u.setScale('x', { min: 1, max: 2 });
				await Promise.resolve();
				checkTransform(u, 'y', mode == 1 ? 0.25 : 0.001);
				u.setData(toData([x, [-0.125, 2, 3], [4, 5, 6], aligned[3]]), false);
				u.redraw();
				await Promise.resolve();
				checkTransform(u, 'y', mode == 1 ? 2 : 0.125);
				assert.equal(u.scales.y.asinh, asinh);
				for (const [values, threshold] of [[[-0.01, 0, 2], mode == 1 ? 2 : 0.01], [[null, undefined, null], 1], [[], 1]]) {
					u.setData(toData([x, values, [], aligned[3]]), false);
					u.redraw();
					await Promise.resolve();
					checkTransform(u, 'y', threshold);
				}
			}
			finally { u.destroy(); }
		});

		it(`respects series visibility and scan participation (mode ${mode})`, async () => {
			const aligned = [[1, 2, 3], [2, 4, 8], [-0.25, 1, 2], [0.001, 0.002, 0.003]];
			const u = new uPlot({
				width: 600,
				height: 400,
				mode,
				scales: { x: { time: false }, y: { distr: 4, range: () => [-10, 10] } },
				series: [{}, { paths: () => null }, { show: false, scan: true, paths: () => null }, { scan: false, paths: () => null }],
			}, mode == 1 ? aligned : [null, ...aligned.slice(1).map(y => [aligned[0], y])], document.body);
			try {
				await Promise.resolve();
				checkTransform(u, 'y', 2);
				u.setSeries(2, { show: true });
				await Promise.resolve();
				checkTransform(u, 'y', 0.25);
				u.setSeries(2, { show: false });
				await Promise.resolve();
				checkTransform(u, 'y', 2);
				u.series[3].scan = true;
				u.redraw();
				await Promise.resolve();
				checkTransform(u, 'y', 0.001);
				u.series[1].scan = u.series[3].scan = false;
				u.redraw();
				await Promise.resolve();
				checkTransform(u, 'y', 1);
			}
			finally { u.destroy(); }
		});

		it(`ignores absolute values at or below scan.minAbs: 1e-128 when adapting (mode ${mode})`, async () => {
			const u = plot({ y: { distr: 4, scan: { minAbs: 1e-128 }, range: () => [-10, 10] } }, mode);
			const aboveCutoff = 1e-128 * (1 + Number.EPSILON);
			try {
				await Promise.resolve();
				for (const [values, threshold] of [
					[[0, -0, 2, -0.25], 0.25],
					[[-1e-128, 1e-128, -1e-129, 1e-129, 0.125, -2], 0.125],
					[[1e-128, aboveCutoff, 2], aboveCutoff],
					[[-1e-128, -aboveCutoff, -2], aboveCutoff],
					[[0, -0], 1],
					[[-1e-128, 1e-128, -1e-129, 1e-129], 1],
					[[null, undefined], 1],
					[[], 1],
					[[0, -0.5, 2], 0.5],
				]) {
					const next = [values.map((v, i) => i + 1), values];
					u.setData(mode == 1 ? next : [null, next]);
					await Promise.resolve();
					checkTransform(u, 'y', threshold);
				}
			}
			finally { u.destroy(); }
		});

		for (const fixed of [{ range: [-100, 100] }, { auto: false, min: -100, max: 100 }]) {
			for (const asinh of [undefined, 10]) {
				it(`keeps a static threshold with ${fixed.range ? 'fixed range' : 'auto: false'} and asinh ${asinh} (mode ${mode})`, async () => {
					const y = { distr: 4, ...fixed };
					if (asinh != null)
						y.asinh = asinh;
					const u = plot({ y }, mode);
					try {
						await Promise.resolve();
						checkTransform(u, 'y', asinh ?? 1);
						const next = [[1, 2, 3], [-100, 0.01, 100]];
						u.setData(mode == 1 ? next : [null, next]);
						await Promise.resolve();
						checkTransform(u, 'y', asinh ?? 1);
						u.setScale('x', { min: 2, max: 3 });
						await Promise.resolve();
						checkTransform(u, 'y', asinh ?? 1);
					}
					finally { u.destroy(); }
				});
			}
		}

		for (const resetScales of [true, false]) {
			it(`updates transforms, ticks, and paths with unchanged auto-range bounds (mode ${mode}, reset ${resetScales})`, async () => {
				const calls = [];
				const asinh = (u, key) => {
					calls.push([u.data, key]);
					return mode == 1 ? u.data[1][1] : u.data[1][1][1];
				};
				const u = plot({ y: { distr: 4, range: () => [-100, 100], asinh } }, mode);
				try {
					await Promise.resolve();
					assert.equal(u.scales.y.asinh, asinh);
					assert.equal(calls.length, 1);
					checkTransform(u, 'y', 1);
					const paths = u.series[1]._paths;
					const splits = u.axes[1]._splits.slice();
					const next = mode == 1 ? [[1, 2, 3], [-100, 10, 100]] : [null, [[1, 2, 3], [-100, 10, 100]]];
					u.setData(next, resetScales);
					if (!resetScales)
						u.redraw();
					await Promise.resolve();
					assert.equal(calls.length, 2);
					assert.deepEqual(calls[1], [next, 'y']);
					checkTransform(u, 'y', 10);
					assert.equal(u.scales.y.min, -100);
					assert.equal(u.scales.y.max, 100);
					assert.notEqual(u.series[1]._paths, paths);
					assert.notDeepEqual(u.axes[1]._splits, splits);
					u.redraw(true, true);
					await Promise.resolve();
					assert.equal(calls.length, 3);
				}
				finally { u.destroy(); }
			});
		}
	}

	for (const ori of [0, 1]) {
		it(`scans all matching mode-2 facets independently of orientation (ori ${ori})`, async () => {
			const x = [0.001, 1, 2];
			const cells = [x, [-8, -4, -2], [-4, -2, -0.25], [1e-6, 1e-6, 1e-6], [1e-12, 1e-12, 1e-12]];
			const otherSeries = [x, [-0.5, 3, 6]];
			const u = new uPlot({
				width: 600,
				height: 400,
				mode: 2,
				scales: {
					x: { time: false, ori: 1 - ori },
					y_heatmap: { distr: 4, scan: { minAbs: 1e-128 }, ori, range: () => [-10, 10] },
					other: { ori, range: () => [-10, 10] },
				},
				axes: [{ scale: 'x' }, { scale: 'y_heatmap' }],
				series: [{}, {
					paths: () => null,
					facets: [{ scale: 'x' }, { scale: 'y_heatmap' }, { scale: 'y_heatmap' }, { scale: 'other' }],
				}, {
					paths: () => null,
					facets: [{ scale: 'x' }, { scale: 'y_heatmap' }],
				}],
			}, [null, cells, otherSeries], document.body);
			try {
				await Promise.resolve();
				checkTransform(u, 'y_heatmap', 0.25);
				for (const [upperBounds, threshold] of [
					[[-4, -2, -0.125], 0.125],
					[[0, -1e-128, 1e-128], 0.5],
				]) {
					u.setData([null, [x, cells[1], upperBounds, cells[3], cells[4]], otherSeries]);
					await Promise.resolve();
					checkTransform(u, 'y_heatmap', threshold);
				}
			}
			finally { u.destroy(); }
		});
	}

	it('respects scan participation on individual mode-2 facets', async () => {
		const u = new uPlot({
			width: 600,
			height: 400,
			mode: 2,
			scales: { x: { time: false }, y: { distr: 4, range: () => [-10, 10] } },
			series: [{}, {
				paths: () => null,
				facets: [{ scale: 'x' }, { scale: 'y', scan: false }, { scale: 'y' }, { scale: 'y', scan: false }],
			}],
		}, [null, [[1, 2, 3], [0.01, 0.02, 0.03], [-0.5, 1, 2], [0.001, 0.002, 0.003]]], document.body);
		try {
			await Promise.resolve();
			checkTransform(u, 'y', 0.5);
			u.series[1].facets[2].scan = false;
			u.redraw();
			await Promise.resolve();
			checkTransform(u, 'y', 1);
			u.series[1].facets[1].scan = true;
			u.redraw();
			await Promise.resolve();
			checkTransform(u, 'y', 0.01);
		}
		finally { u.destroy(); }
	});

	it('scans the matching X facet in mode 2', async () => {
		const u = new uPlot({
			width: 600,
			height: 400,
			mode: 2,
			scales: { x: { time: false, distr: 4, range: () => [0, 10] } },
			series: [{}, { paths: () => null }],
		}, [null, [[0, 0.25, 2], [0.001, 1, 2]]], document.body);
		try {
			await Promise.resolve();
			checkTransform(u, 'x', 0.25);
		}
		finally { u.destroy(); }
	});

	it('updates x and dependent scales, including empty data', async () => {
		const calls = [];
		const asinh = (u, key) => {
			calls.push(key);
			return u.data[0].length || 1;
		};
		const u = plot({
			x: { time: false, distr: 4, asinh },
			y: { distr: 4, asinh },
			other: { from: 'y', range: (u, min, max) => [min, max] },
		});
		try {
			await Promise.resolve();
			assert.deepEqual(calls, ['x', 'y', 'other']);
			for (const key of calls)
				checkTransform(u, key, 3);
			u.setData([]);
			await Promise.resolve();
			assert.deepEqual(calls, ['x', 'y', 'other', 'x', 'y', 'other']);
			for (const key of ['x', 'y', 'other'])
				assert.equal(u.scales[key]._asinh, 1);
		}
		finally { u.destroy(); }
	});
});
