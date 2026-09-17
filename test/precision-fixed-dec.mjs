import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';
import { fixedDec, genIncrs, guessDec } from '../src/utils.js';
import { decIncrs, oneIncrs, numIncrs, wholeIncrs } from '../src/opts.js';


const multipliers = [
	[1, 1n, 0],
	[2, 2n, 0],
	[2.5, 25n, -1],
	[5, 5n, 0],
];

// Exact decimal coefficient/exponent arithmetic, with a plain-decimal parse only
// at the end. Do not use genIncrs, guessDec, roundDec, or float multiplication as an oracle.
function decimal(coefficient, exponent) {
	while (coefficient % 10n == 0n) {
		coefficient /= 10n;
		exponent++;
	}
	const digits = coefficient.toString();
	const point = digits.length + exponent;
	const text = point <= 0 ? '0.' + '0'.repeat(-point) + digits :
		point >= digits.length ? digits + '0'.repeat(point - digits.length) :
		digits.slice(0, point) + '.' + digits.slice(point);
	return [Number(text), Math.max(0, -exponent)];
}

function decimalGrid(minExp, maxExp, mults = multipliers) {
	const entries = [];
	for (let exp = minExp; exp < maxExp; exp++)
		for (const [, coefficient, shift] of mults)
			entries.push(decimal(coefficient, exp + shift));
	return entries;
}

function assertLookup(entries) {
	for (const [value, places] of entries) {
		assert.ok(Number.isFinite(value) && value > 0, `invalid expected increment ${value}`);
		assert.ok(fixedDec.has(value), `missing canonical key ${value}`);
		assert.equal(fixedDec.get(value), places, `decimal count for ${value}`);
	}
}

function assertGenerated(base, minExp, maxExp, mults, entries) {
	fixedDec.clear();
	const actual = genIncrs(base, minExp, maxExp, mults);
	assert.deepEqual(actual, entries.map(([value]) => value));
	assertLookup(entries);
	assert.equal(fixedDec.size, new Map(entries).size, 'unexpected aliases or missing keys');
	assert.deepEqual([...fixedDec], [...new Map(entries)]);
}

async function registerCustom(increments, check) {
	const u = new uPlot({
		width: 400,
		height: 200,
		scales: { x: { time: false } },
		series: [{}, {}],
		// Registration is under test, not tick generation. Avoid unsafe split loops
		// when a custom increment receives an incorrect decimal count.
		axes: [{ incrs: [...increments, 1].sort((a, b) => a - b), splits: () => [] }, { show: false }],
	}, [[0, 1], [0, 1]], document.body);
	try {
		await Promise.resolve();
		check();
	}
	finally { u.destroy(); }
}

describe('precision: fixedDec generation and lookup', () => {
	let previous;
	beforeEach(() => { previous = new Map(fixedDec); });
	afterEach(() => {
		// Restore the shared registry even after an assertion fails.
		fixedDec.clear();
		for (const entry of previous)
			fixedDec.set(...entry);
	});

	it('contains canonical keys and counts for all 256 built-in decimal increments', () => {
		const entries = decimalGrid(-32, 32);
		assert.deepEqual(numIncrs, entries.map(([value]) => value));
		assert.deepEqual(decIncrs, entries.slice(0, 128).map(([value]) => value));
		assert.deepEqual(oneIncrs, entries.slice(128).map(([value]) => value));
		assert.deepEqual(wholeIncrs, entries.slice(128).filter(([, places]) => places == 0).map(([value]) => value));
		assertLookup(entries);
		assert.equal(new Set(numIncrs).size, 256);
		for (let i = 1; i < numIncrs.length; i++)
			assert.ok(numIncrs[i] > numIncrs[i - 1]);
	});

	// b2433b4 replaced arithmetic-generated decimal keys with canonical values.
	it('generates a fresh decimal registry without rounded aliases across exponents -32 through 31', () => {
		assertGenerated(10, -32, 32, multipliers.map(([value]) => value), decimalGrid(-32, 32));
	});

	it('records integral multipliers and overlapping decades consistently', () => {
		const mults = [[1, 1n, 0], [2, 2n, 0], [5, 5n, 0], [10, 10n, 0], [25, 25n, 0]];
		assertGenerated(10, -32, 32, mults.map(([value]) => value), decimalGrid(-32, 32, mults));
	});

	it('generates the seconds and milliseconds increment registries with correct 2.5 precision', () => {
		assertGenerated(10, -3, 0, multipliers.map(([value]) => value), decimalGrid(-3, 0));
		assertGenerated(10, 0, 3, multipliers.map(([value]) => value), decimalGrid(0, 3));
	});

	// db2c897 changed registry initialization order. Shared decimal/binary keys
	// such as 0.5, 0.25, 2 and 4 must retain their decimal precision.
	it('preserves decimal entries when numeric, time, and binary generation overlap', () => {
		fixedDec.clear();
		genIncrs(10, -32, 0, [1, 2, 2.5, 5]);
		genIncrs(10, 0, 32, [1, 2, 2.5, 5]);
		genIncrs(10, -3, 0, [1, 2, 2.5, 5]);
		genIncrs(10, 0, 3, [1, 2, 2.5, 5]);
		genIncrs(2, -53, 53, [1]);
		assertLookup(decimalGrid(-32, 32));
	});

	it('preserves exactly representable binary powers from 2^-21 through 2^52', () => {
		const entries = Array.from({ length: 74 }, (_, i) => [2 ** (i - 21), Math.max(0, 21 - i)]);
		assertGenerated(2, -21, 53, [1], entries);
	});

	it('does not add aliases or change counts on repeated generation', () => {
		fixedDec.clear();
		genIncrs(10, -32, 32, [1, 2, 2.5, 5]);
		const expected = [...fixedDec];
		genIncrs(10, -32, 32, [1, 2, 2.5, 5]);
		assert.deepEqual([...fixedDec], expected);
	});

	// #805 custom registration must populate missing entries, not corrupt known ones.
	it('registers custom decimal increments without overwriting known tiny increments', async () => {
		fixedDec.delete(0.04);
		fixedDec.delete(0.125);
		assertLookup([[1e-24, 24], [2.5e-24, 25]]);
		await registerCustom([0.04, 0.125, 1e-24, 2.5e-24], () => {
			assertLookup([[0.04, 2], [0.125, 3], [1e-24, 24], [2.5e-24, 25]]);
		});
	});

	it('preserves all binary powers and canonical lookup keys from 2^-53 through 2^52', () => {
		const entries = Array.from({ length: 106 }, (_, i) => [2 ** (i - 53), Math.max(0, 53 - i)]);
		assertGenerated(2, -53, 53, [1], entries);
	});

	it('contains the canonical small binary keys in the initialized lookup', () => {
		assertLookup(Array.from({ length: 32 }, (_, i) => [2 ** (i - 53), 53 - i]));
	});

	it('reduces the decimal count when positive exponents shift fractional multipliers', () => {
		// 0.125 * 10 -> 1.25 needs 2 places, not 3; 1.25 * 10 -> 12.5 needs 1, not 2.
		for (const mult of [[0.125, 125n, -3], [1.25, 125n, -2]])
			assertGenerated(10, -3, 4, [mult[0]], decimalGrid(-3, 4, [mult]));
	});

	it('counts decimal places across signs and plain/exponent notation boundaries', () => {
		for (const [value, places] of [
			[0, 0], [1, 0], [0.04, 2], [0.125, 3], [0.000001, 6],
			[4e-7, 7], [1.25e-7, 9], [7e-20, 20], [1.234e-20, 23],
			[1e-24, 24], [2.5e-24, 25], [1e21, 0], [1.25e21, 0],
		]) {
			assert.equal(guessDec(value), places, `decimal count for ${value}`);
			assert.equal(guessDec(-value), places, `decimal count for ${-value}`);
		}
	});

	it('registers scientific-notation custom increments with their actual decimal counts', async () => {
		const entries = [[4e-7, 7], [1.25e-7, 9], [7e-20, 20], [1.234e-20, 23]];
		for (const [value] of entries)
			fixedDec.delete(value);
		await registerCustom(entries.map(([value]) => value), () => assertLookup(entries));
	});
});
