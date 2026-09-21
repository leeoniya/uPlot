import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { numAxisVals } from '../src/opts.js';
import { fixedDec } from '../src/utils.js';

const labels = (splits, incr) => numAxisVals(null, splits, 0, 50, incr);
const localized = (values, dec) => {
	const fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
	return values.map(value => fmt.format(value));
};

describe('public decimal precision helper', () => {
	it('accepts omitted increments, empty input, and filtered values', () => {
		assert.equal(uPlot.numDec([]), 0);
		assert.equal(uPlot.numDec([], .25), 2);
		assert.equal(uPlot.numDec([null, undefined, -0, 1000]), 0);
		assert.equal(uPlot.numDec([null, undefined, -.025, .5]), 3);
	});

	it('uses the finest precision from values and the increment', () => {
		assert.equal(uPlot.numDec([0, 1], .00025), 5);
		assert.equal(uPlot.numDec([2.25, 3.25], 1), 2);
		assert.equal(uPlot.numDec([1, 1.125, 2], 1), 3);
		assert.equal(uPlot.numDec([.003, .006, .009], .003), 3);
	});

	it('uses registered increment precision without changing it', () => {
		const incr = .125;
		const previous = fixedDec.get(incr);
		fixedDec.set(incr, 4);
		try {
			assert.equal(uPlot.numDec([0, incr], incr), 4);
			assert.equal(uPlot.numDec([.00001], incr), 5);
			assert.equal(fixedDec.get(incr), 4);
		}
		finally {
			if (previous == null)
				fixedDec.delete(incr);
			else
				fixedDec.set(incr, previous);
		}
	});

	it('handles scientific notation without formatter precision limits', () => {
		for (const [value, dec] of [[2.5e-24, 25], [1e-32, 32], [1e-200, 200], [Number.MIN_VALUE, 324], [1e21, 0]]) {
			assert.equal(uPlot.numDec([value]), dec);
			assert.equal(uPlot.numDec([], value), dec);
		}
	});

	it('does not mutate input or require a chart instance', () => {
		const values = Object.freeze([null, -0, .25, undefined]);
		assert.equal(uPlot.numDec(values, .25), 2);
		assert.deepEqual(values, [null, -0, .25, undefined]);
		const seconds = [0, 250, 500].map(v => v / 1000);
		assert.equal(uPlot.numDec(seconds, 250 / 1000), 2);
	});

	it('supports a custom axis formatter as the increment changes', async () => {
		const u = new uPlot({
			width: 500, height: 400, padding: [0, 0, 0, 0],
			legend: {show: false}, cursor: {show: false},
			scales: {x: {time: false}, y: {range: [2, 3]}},
			axes: [{show: false}, {
				incrs: [.25], space: 30,
				filter: (u, splits) => splits.map(v => v == 2.5 ? null : v),
				values: (u, splits, axisIdx, space, incr) => {
					const dec = uPlot.numDec(splits, incr);
					return splits.map(v => v == null ? '' : `${v.toFixed(dec)} ms`);
				},
			}],
			series: [{}, {}],
		}, [[0, 1], [2, 3]], document.body);
		try {
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, ['2.00 ms', '2.25 ms', '', '2.75 ms', '3.00 ms']);
			u.axes[1].incrs = () => [.5];
			u.redraw(false, true);
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, ['2.0 ms', '', '3.0 ms']);
		}
		finally { u.destroy(); }
	});
});

describe('numeric axis label precision', () => {
	for (const [incr, values, dec] of [
		[.25, [2, 2.25, 2.5, 2.75, 3], 2],
		[.00025, [0, .00025, .0005, .00075, .001], 5],
		[2.5, [0, 2.5, 5], 1],
		[1, [1000, 1001, 1002], 0],
		[1e-12, [-1e-12, 0, 1e-12, 2e-12], 12],
	]) {
		it(`uses consistent decimal places for increment ${incr}`, () => {
			assert.equal(uPlot.numDec(values, incr), dec);
			const actual = labels(values, incr);
			assert.deepEqual(actual, localized(values, dec));
			assert.equal(new Set(actual).size, values.length);
		});
	}

	it('preserves filtered labels and normalizes negative zero', () => {
		assert.deepEqual(labels([null, -0, undefined, .25], .25), ['', ...localized([0], 2), '', ...localized([.25], 2)]);
		assert.deepEqual(labels([], .25), []);
	});

	it('preserves fractional endpoints and custom splits finer than their increment', () => {
		assert.deepEqual(labels([2.25, 3.25], 1), localized([2.25, 3.25], 2));
		assert.deepEqual(labels([1, 1.125, 2], 1), localized([1, 1.125, 2], 3));
		assert.deepEqual(labels([.003, .006, .009], .003), localized([.003, .006, .009], 3));
	});

	it('retains tiny increments beyond the portable Intl fraction-digit limit', () => {
		for (const [incr, dec] of [[2.5e-24, 25], [1e-32, 32]]) {
			const values = [-incr, 0, incr, incr * 2];
			const actual = labels(values, incr);
			assert.deepEqual(actual, values.map(value => value.toFixed(dec)));
			assert.equal(new Set(actual).size, values.length);
		}
	});

	it('uses scientific notation rather than zeros beyond toFixed precision', () => {
		const values = [0, 1e-200, 2e-200];
		assert.deepEqual(labels(values, 1e-200), values.map(value => value.toExponential()));
	});

	it('does not change the public number formatter or legend formatting', () => {
		const fmt = new Intl.NumberFormat();
		assert.equal(uPlot.fmtNum(.00025), fmt.format(.00025));
		assert.equal(uPlot.fmtNum(2.5), fmt.format(2.5));
	});

	it('updates default labels when the selected increment changes', async () => {
		const u = new uPlot({
			width: 500, height: 400, padding: [0, 0, 0, 0],
			legend: { show: false }, cursor: { show: false },
			scales: { x: { time: false }, y: { range: [2, 3] } },
			axes: [{ show: false }, { incrs: [.25], space: 30 }],
			series: [{}, {}],
		}, [[0, 1], [2, 3]], document.body);
		try {
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, localized([2, 2.25, 2.5, 2.75, 3], 2));
			u.axes[1].incrs = () => [.5];
			u.redraw(false, true);
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, localized([2, 2.5, 3], 1));
		}
		finally { u.destroy(); }
	});

	for (const exact of [true, false]) {
		it(`formats tiny tick-aware ranges without duplicate labels (exact ${exact})`, async () => {
			const u = new uPlot({
				width: 500, height: 400, padding: [0, 0, 0, 0],
				legend: { show: false }, cursor: { show: false },
				scales: { x: { time: false }, y: { axis: 1 } },
				axes: [{ show: false }, { exact }], series: [{}, {}],
			}, [[0, 1], [.00013, .00087]], document.body);
			try {
				await Promise.resolve();
				const axis = u.axes[1];
				assert.equal(new Set(axis._values).size, axis._splits.length);
				assert.deepEqual(axis._values, localized(axis._splits, 4));
				let calls = 0;
				axis.values = (self, splits, idx, space, incr) => {
					calls++;
					assert.equal(incr, axis._found[0]);
					return splits.map(value => `custom:${value}`);
				};
				u.redraw(false, true);
				await Promise.resolve();
				assert.equal(calls, 1);
				assert.deepEqual(axis._values, axis._splits.map(value => `custom:${value}`));
			}
			finally { u.destroy(); }
		});
	}
});
