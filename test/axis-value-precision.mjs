import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { numAxisVals } from '../src/opts.js';

const labels = (splits, incr) => numAxisVals(null, splits, 0, 50, incr);
const localized = (values, dec) => {
	const fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
	return values.map(value => fmt.format(value));
};

describe('public decimal precision helper', () => {
	it('returns zero for empty, filtered, or integer-only splits', () => {
		assert.equal(uPlot.numDec([]), 0);
		assert.equal(uPlot.numDec([null, undefined]), 0);
		assert.equal(uPlot.numDec([null, -0, 1, 1000]), 0);
	});

	it('uses the highest precision across the splits', () => {
		assert.equal(uPlot.numDec([0, .25, .5]), 2);
		assert.equal(uPlot.numDec([0, .00025, .0005]), 5);
		assert.equal(uPlot.numDec([-.5, .5]), 1);
		assert.equal(uPlot.numDec([2.25, 3.25]), 2);
		assert.equal(uPlot.numDec([1, 1.125, 2]), 3);
		assert.equal(uPlot.numDec([null, undefined, -.025, .5]), 3);
	});

	it('provides one precision for uniformly padded labels', () => {
		const splits = [0, .125, .25, .375];
		const dec = uPlot.numDec(splits);
		assert.equal(dec, 3);
		assert.deepEqual(splits.map(v => v.toFixed(dec)), ['0.000', '0.125', '0.250', '0.375']);
	});

	it('handles scientific notation without formatter precision limits', () => {
		for (const [value, dec] of [[2.5e-24, 25], [1e-32, 32], [1e-200, 200], [Number.MIN_VALUE, 324], [1e21, 0]]) {
			assert.equal(uPlot.numDec([-value, 0, value]), dec);
		}
	});

	it('does not mutate splits or require a chart instance', () => {
		const splits = Object.freeze([null, -0, .25, .5]);
		assert.equal(uPlot.numDec(splits), 2);
		assert.deepEqual(splits, [null, -0, .25, .5]);
	});

	it('supports a custom axis formatter as the increment changes', async () => {
		const u = new uPlot({
			width: 500, height: 400, padding: [0, 0, 0, 0],
			legend: {show: false}, cursor: {show: false},
			scales: {x: {time: false}, y: {range: [2, 3]}},
			axes: [{show: false}, {
				incrs: [.25], space: 30,
				filter: (u, splits) => splits.map(v => v == 2.5 ? null : v),
				values: (u, splits) => {
					const dec = uPlot.numDec(splits);
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
			assert.deepEqual(u.axes[1]._values, ['2 ms', '', '3 ms']);
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
			assert.equal(uPlot.numDec(values), dec);
			const actual = labels(values, incr);
			assert.deepEqual(actual, localized(values, dec));
			assert.equal(new Set(actual).size, values.length);
		});
	}

	it('preserves filtered labels and normalizes negative zero', () => {
		assert.deepEqual(labels([null, -0, undefined, .25], .25), ['', ...localized([0], 2), '', ...localized([.25], 2)]);
		assert.deepEqual(labels([], .25), []);
	});

	it('uses only visible split precision, not increment precision', () => {
		assert.deepEqual(labels([0, null, 1], .00025), localized([0], 0).concat('', localized([1], 0)));
		assert.deepEqual(labels([0, .125, .25, .375], 1), localized([0, .125, .25, .375], 3));
	});

	it('preserves fractional endpoints and custom splits finer than their increment', () => {
		assert.deepEqual(labels([-.5, .5], 1), localized([-.5, .5], 1));
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
		it(`preserves fractional edge labels for one tick-aware interval (exact ${exact})`, async () => {
			const u = new uPlot({
				width: 500, height: 20, padding: [0, 0, 0, 0],
				legend: { show: false }, cursor: { show: false },
				scales: { x: { time: false }, y: { axis: 1 } },
				axes: [{ show: false }, { exact }], series: [{}, {}],
			}, [[0, 1], [-.2, .2]], document.body);
			try {
				await Promise.resolve();
				assert.equal(u.axes[1]._found[0], 1);
				assert.deepEqual(u.axes[1]._splits, [-.5, .5]);
				assert.deepEqual(u.axes[1]._values, localized([-.5, .5], 1));
			}
			finally { u.destroy(); }
		});

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
