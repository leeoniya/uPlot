import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { fmtNum, fmtNumDec } from '../src/utils.js';
import { numAxisVals, numSeriesVal } from '../src/opts.js';

const labels = splits => numAxisVals(null, splits, 0, 50, 1);

// Fixed seed and raw IEEE-754 bits cover the exponent range without Math.random().
function samples(count) {
	let seed = 0x12345678;
	const next = () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return seed >>> 0;
	};
	const view = new DataView(new ArrayBuffer(8));
	return Array.from({ length: count }, () => {
		view.setUint32(0, next());
		view.setUint32(4, next());
		return view.getFloat64(0);
	});
}

describe('English number formatting', () => {
	it('groups integers and trims optional fraction digits', () => {
		for (const [value, expected] of [
			[0, '0'], [12, '12'], [999, '999'], [1000, '1,000'],
			[1234567.89, '1,234,567.89'], [-1234567.89, '-1,234,567.89'],
			[1.2, '1.2'], [1.2344, '1.234'], [.0004, '0'], [.0005, '0.001'],
		]) {
			assert.equal(fmtNumDec(value), expected);
			assert.equal(fmtNum(value), expected);
			assert.equal(uPlot.fmtNum(value), expected);
		}
	});

	it('rounds shortest-decimal ties away from zero and carries across groups', () => {
		for (const [value, dec, expected] of [
			[1.005, 2, '1.01'], [1.015, 2, '1.02'], [2.675, 2, '2.68'],
			[10.075, 2, '10.08'], [.000125, 5, '0.00013'],
			[1.0049999999999997, 2, '1.00'], [1.0050000000000001, 2, '1.01'],
			[.5, 0, '1'], [9.5, 0, '10'], [999.5, 0, '1,000'],
			[9.995, 2, '10.00'], [999.9995, 3, '1,000.000'],
			[999999.9995, 3, '1,000,000.000'],
		]) {
			assert.equal(fmtNumDec(value, dec, dec), expected, `${value}, ${dec} places`);
			assert.equal(fmtNumDec(-value, dec, dec), '-' + expected, `${-value}, ${dec} places`);
		}
		assert.equal(fmtNumDec(999.9995), '1,000');
	});

	it('preserves signed zero and formats nonfinite numbers without padding', () => {
		for (const [value, expected] of [
			[0, '0'], [-0, '-0'], [-.0004, '-0'],
			[Number.MIN_VALUE, '0'], [-Number.MIN_VALUE, '-0'],
			[NaN, 'NaN'], [Infinity, '∞'], [-Infinity, '-∞'],
		])
			assert.equal(fmtNumDec(value), expected);

		assert.equal(fmtNumDec(-0, 2, 2), '-0.00');
		assert.equal(fmtNumDec(-.004, 2, 2), '-0.00');
		for (const [value, expected] of [[NaN, 'NaN'], [Infinity, '∞'], [-Infinity, '-∞']])
			assert.equal(fmtNumDec(value, 100, 100), expected);
	});

	it('honors minimum and maximum precision through 100 places', () => {
		for (const [value, min, max, expected] of [
			[1234.567, 0, 0, '1,235'], [12, 2, 4, '12.00'],
			[1.2, 2, 4, '1.20'], [1.23456, 2, 4, '1.2346'],
			[1.99996, 2, 4, '2.00'], [1.23, 0, 100, '1.23'],
			[1.1, 21, 21, '1.1' + '0'.repeat(20)],
			[1.1, 100, 100, '1.1' + '0'.repeat(99)],
			[0, 100, 100, '0.' + '0'.repeat(100)],
			[-0, 100, 100, '-0.' + '0'.repeat(100)],
			[1e-100, 0, 100, '0.' + '0'.repeat(99) + '1'],
			[5e-101, 100, 100, '0.' + '0'.repeat(99) + '1'],
			[4e-101, 100, 100, '0.' + '0'.repeat(100)],
			[Number.MIN_VALUE, 100, 100, '0.' + '0'.repeat(100)],
		])
			assert.equal(fmtNumDec(value, min, max), expected, `${value}, ${min}..${max} places`);

		assert.equal(fmtNumDec(1.2, 2), '1.20');
		assert.equal(fmtNumDec(1.23456, 2), '1.235');
	});

	it('expands scientific notation and large integers without binary residue', () => {
		assert.equal(fmtNumDec(1e21), '1,000,000,000,000,000,000,000');
		assert.equal(fmtNumDec(1.25e21, 2, 2), '1,250,000,000,000,000,000,000.00');
		assert.equal(fmtNumDec(Number.MAX_SAFE_INTEGER), '9,007,199,254,740,991');
		assert.equal(fmtNumDec(1000000000000000100), '1,000,000,000,000,000,100');
		assert.equal(fmtNumDec(1.25e-7, 0, 9), '0.000000125');
		assert.equal(fmtNumDec(1e-6, 0, 6), '0.000001');

		const largest = ('17976931348623157' + '0'.repeat(292)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		assert.equal(fmtNumDec(Number.MAX_VALUE), largest);
		assert.equal(fmtNumDec(-Number.MAX_VALUE, 2, 2), '-' + largest + '.00');
	});

	it('keeps both one-argument wrappers safe as Array.map callbacks', () => {
		const values = [1234.5678, 2, .0005, -0, 999.9995, NaN, Infinity];
		const expected = ['1,234.568', '2', '0.001', '-0', '1,000', 'NaN', '∞'];
		for (const format of [fmtNum, uPlot.fmtNum]) {
			assert.equal(format.length, 1);
			assert.deepEqual(values.map(format), expected);
			assert.equal(format(1.23456, 0, 0), '1.235', 'extra callback arguments are ignored');
		}
	});

	it('matches explicit en-US Intl for deterministic values and precision pairs', () => {
		const values = [
			0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE,
			Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_SAFE_INTEGER,
			1.005, -1.005, 999.9995, -999.9995, 1.1, 1e21, 1e-100, 5e-101,
			...samples(96),
		];
		for (const [min, max] of [[0, 0], [0, 3], [2, 2], [2, 6], [0, 20], [21, 21], [0, 100], [100, 100]]) {
			const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
			for (const value of values)
				assert.equal(fmtNumDec(value, min, max), format.format(value), `${Object.is(value, -0) ? '-0' : value}, ${min}..${max} places`);
		}
	});
});

describe('numeric axis and legend formatting', () => {
	it('uses visible split precision, preserves filtered labels, and normalizes axis negative zero', () => {
		assert.deepEqual(labels([]), []);
		assert.deepEqual(labels([null, undefined]), ['', '']);
		assert.deepEqual(labels([null, -0, undefined, 1000.25, 1001]), ['', '0.00', '', '1,000.25', '1,001.00']);
		assert.deepEqual(labels([0, null, 1]), ['0', '', '1']);
		assert.deepEqual(labels([0, 1e-100]), ['0.' + '0'.repeat(100), '0.' + '0'.repeat(99) + '1']);

		for (const value of [1e-101, 1e-200, Number.MIN_VALUE])
			assert.deepEqual(labels([null, -value, -0, undefined, value]), ['', (-value).toExponential(), '0e+0', '', value.toExponential()]);
	});

	it('keeps legend placeholders, signed zero, and default three-place rounding', () => {
		assert.equal(numSeriesVal(null, 1234.5678, 1, null), '--');
		assert.equal(numSeriesVal(null, null, 1, 0), '');
		assert.equal(numSeriesVal(null, undefined, 1, 0), '');
		assert.equal(numSeriesVal(null, -0, 1, 0), '-0');
		assert.equal(numSeriesVal(null, 1234.5678, 1, 0), '1,234.568');
	});

	it('renders default axes and legend without constructing Intl.NumberFormat', async () => {
		const NumberFormat = Intl.NumberFormat;
		let u;
		try {
			// Patch after imports: date/time Intl initialization is outside this contract.
			Intl.NumberFormat = function() { throw new Error('unexpected Intl.NumberFormat construction'); };
			assert.equal(uPlot.fmtNum(1234.5678), '1,234.568');
			assert.equal(fmtNumDec(1.1, 37, 37), '1.1' + '0'.repeat(36));
			assert.deepEqual(labels([-0, 1e-37]), ['0.' + '0'.repeat(37), '0.' + '0'.repeat(36) + '1']);
			u = new uPlot({
				width: 500, height: 400, padding: [0, 0, 0, 0],
				cursor: { show: false },
				scales: { x: { time: false }, y: { range: [1000, 1001] } },
				axes: [{ incrs: [1] }, { incrs: [.25], space: 30 }],
				series: [{}, {}],
			}, [[0, 1], [1000.125, 1000.875]], document.body);
			await Promise.resolve();
			assert.deepEqual(u.axes[0]._values, ['0', '1']);
			assert.deepEqual(u.axes[1]._values, ['1,000.00', '1,000.25', '1,000.50', '1,000.75', '1,001.00']);
			u.setLegend({ idx: 0 });
			assert.deepEqual(u.legend.values.map(record => record._), ['0', '1,000.125']);
			u.setLegend({ idx: 1 });
			assert.deepEqual(u.legend.values.map(record => record._), ['1', '1,000.875']);
			u.axes[1].incrs = () => [.5];
			u.redraw(false, true);
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, ['1,000.0', '1,000.5', '1,001.0']);
		}
		finally {
			Intl.NumberFormat = NumberFormat;
			u?.destroy();
		}
	});

	it('allows explicit locale callbacks for axes and series values', async () => {
		const format = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format;
		const u = new uPlot({
			width: 500, height: 400, padding: [0, 0, 0, 0],
			cursor: { show: false },
			scales: { x: { time: false }, y: { range: [1000, 1001] } },
			axes: [{ show: false }, {
				incrs: [.25], space: 30,
				filter: (self, splits) => splits.map(v => v == 1000.5 ? null : v),
				values: (self, splits) => splits.map(v => v == null ? '' : format(v)),
			}],
			series: [{}, { value: (self, value, si, idx) => idx == null ? '--' : value == null ? '' : format(value) }],
		}, [[0, 1], [1000.25, 1000.75]], document.body);
		try {
			await Promise.resolve();
			assert.deepEqual(u.axes[1]._values, ['1.000,00', '1.000,25', '', '1.000,75', '1.001,00']);
			u.setLegend({ idx: 0 });
			assert.equal(u.legend.values[1]._, '1.000,25');
			u.setLegend({ idx: 1 });
			assert.equal(u.legend.values[1]._, '1.000,75');
			assert.equal(uPlot.fmtNum(1000.25), '1,000.25');
		}
		finally { u.destroy(); }
	});
});
