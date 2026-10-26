// Differential checks against en-US decimal Intl.NumberFormat, not other Intl styles/options.
// Run: node docs/investigations/number-format-parity.mjs [variant from number-format-variants.mjs]
import assert from 'node:assert/strict';
const {fmtNumEn} = process.argv[2] ?
	{fmtNumEn: (await import('./number-format-variants.mjs')).variants[process.argv[2]]} :
	{fmtNumEn: (await import('../../src/utils.js')).fmtNumDec};
assert.equal(typeof fmtNumEn, 'function', 'Unknown formatter variant');

const precisions = [[0, 0], [0, 2], [0, 3], [1, 3], [2, 2], [6, 6], [0, 20], [20, 20], [0, 100], [100, 100]];
const formatters = precisions.map(([min, max]) => new Intl.NumberFormat('en-US', {
	minimumFractionDigits: min, maximumFractionDigits: max,
}).format);
let comparisons = 0;
const failures = [];
function check(value) {
	for (let i = 0; i < precisions.length; i++) {
		const [min, max] = precisions[i];
		const expected = formatters[i](value);
		const actual = fmtNumEn(value, min, max);
		comparisons++;
		if (expected !== actual && failures.length < 20)
			failures.push({value: Object.is(value, -0) ? '-0' : String(value), min, max, expected, actual});
	}
}

for (const value of [0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE,
	Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, 1000000000000000128,
	1.005, -1.005, 2.675, -2.675, 1.2345, 9.995, 99.995, 999.995, 9999.9995,
	0.0005, -0.0005, 1e-7, 1e20, 1e21, 1e100]) check(value);

const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
function neighbors(value) {
	check(value);
	view.setFloat64(0, value);
	const bits = view.getBigUint64(0);
	if (bits > 0n) {
		view.setBigUint64(0, bits - 1n);
		check(view.getFloat64(0));
	}
	view.setBigUint64(0, bits + 1n);
	check(view.getFloat64(0));
}
for (let exp = -323; exp <= 308; exp++) {
	neighbors(10 ** exp);
	neighbors(-(10 ** exp));
}
// Decimal ties, carry boundaries, and their adjacent binary representations.
for (let dec = 0; dec <= 6; dec++) {
	for (let i = 0; i < 1000; i++) {
		const value = (i + 0.5) / 10 ** dec;
		neighbors(value);
		neighbors(-value);
	}
}

let seed = 0x12345678;
function randomUint() {
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return seed >>> 0;
}
for (let i = 0; i < 50000; i++) {
	view.setUint32(0, randomUint());
	view.setUint32(4, randomUint());
	check(view.getFloat64(0));
	check((randomUint() - 0x80000000) / 10 ** (i % 10));
}

// Cover every valid precision pair, not just the ten broad-sample configurations.
const precisionValues = [0, -0, NaN, Infinity, -Infinity, Number.MIN_VALUE, Number.MAX_VALUE,
	1.005, -1.005, 2.675, 9.995, 99.9995, 999.995, 9999.9995, 0.0005, -0.0005,
	1e-7, 1e21, 1e100, 1e-100, 1.2345678901234567, 1.0000000000000002,
	1000000000000000128, Number.MAX_SAFE_INTEGER];
let precisionPairs = 0;
for (let min = 0; min <= 100; min++) {
	for (let max = min; max <= 100; max++) {
		precisionPairs++;
		const format = new Intl.NumberFormat('en-US', {minimumFractionDigits: min, maximumFractionDigits: max}).format;
		for (const value of precisionValues) {
			const expected = format(value), actual = fmtNumEn(value, min, max);
			comparisons++;
			if (expected !== actual && failures.length < 20)
				failures.push({value: String(value), min, max, expected, actual});
		}
	}
}

console.log(JSON.stringify({node: process.version, v8: process.versions.v8, comparisons, precisionPairs, failures}, null, 2));
assert.equal(failures.length, 0, 'English decimal formatting differs from Intl');

// The candidate itself must not depend on Intl, including its special-value paths.
const originalIntl = globalThis.Intl;
try {
	globalThis.Intl = undefined;
	assert.equal(fmtNumEn(1.005, 2, 2), '1.01');
	assert.equal(fmtNumEn(1e21, 2, 2), '1,000,000,000,000,000,000,000.00');
	assert.equal(fmtNumEn(-0, 2, 2), '-0.00');
	assert.equal(fmtNumEn(Infinity), '∞');
}
finally {
	globalThis.Intl = originalIntl;
}
