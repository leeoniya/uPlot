import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import { rangeY, rangeYCount } from '../src/rangeY.js';
import { numAxisSplits, numIncrs } from '../src/opts.js';

function exact(range, height) {
	const result = rangeY(...range, height);
	assert.ok(result, `unsupported: ${range}, height ${height}`);
	const { min, max, incr, count } = result;
	assert.equal(count, rangeYCount(height));
	assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max);
	assert.ok(min <= range[0] && max >= range[1], `${[min, max]} encloses ${range}`);
	if (range[0] >= 0) assert.ok(min >= 0);
	if (range[1] <= 0 && range[0] != 0) assert.ok(max <= 0);
	if (!(count == 1 && range[0] < 0 && range[1] > 0))
		assert.ok(numIncrs.includes(incr));

	// All count == 1 ranges use endpoints directly. Other grids use baseline tick generation.
	const ticks = count == 1 ? [min, max] : numAxisSplits(null, 0, min, max, incr, 0, true);
	assert.equal(ticks.length, count + 1);
	assert.deepEqual([ticks[0], ticks.at(-1)], [min, max]);
	const tolerance = Math.max(1e-12, Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON * 4 / (max - min));
	if (count == 1)
		assert.ok(Math.abs(incr / (max - min) - 1) < tolerance, 'endpoint increment matches span');
	const positions = ticks.map(v => (v - min) / (max - min));
	positions.forEach((p, i) => {
		assert.ok(Math.abs(p - i / count) < tolerance, `tick ${i} at ${p}, expected ${i / count}`);
		if (i > 0) assert.ok(ticks[i] > ticks[i - 1]);
	});
	return { ...result, ticks, positions };
}

describe('minimal Y range: height policy', () => {
	for (const [height, count] of [[.1, 1], [1, 1], [40, 1], [49.999, 1], [50, 2], [125, 3], [333, 7], [400, 8], [413, 8], [525, 10], [999, 19], [1000, 20], [1500, 30]]) {
		it(`${height}px selects ${count} intervals`, () => assert.equal(rangeYCount(height), count));
	}
	for (const height of [0, -1, NaN, Infinity])
		it(`rejects invalid height ${height}`, () => assert.equal(rangeYCount(height), 0));
});

describe('minimal Y range: prior numeric/count assertions with built-in increments', () => {
	for (const height of [40, 50, 125, 333, 400, 413, 525, 1000]) {
		for (const ranges of [[[9, 81], [137, 2789]], [[-81, -9], [-2789, -137]], [[-9, 71], [-2789, 137]]]) {
			it(`aligns unrelated ranges at ${height}px: ${ranges}`, () => {
				const a = exact(ranges[0], height);
				const b = exact(ranges[1], height);
				a.positions.forEach((p, i) => assert.ok(Math.abs(p - b.positions[i]) < 1e-12));
			});
		}
	}

	for (const [range, expected] of [
		[[9, 81], [0, 160]],
		[[113, 127], [112, 128]],
		[[-127, -113], [-128, -112]],
		[[-9, 71], [-40, 120]],
		[[1, 19], [0, 20]],
		[[-19, -1], [-20, 0]],
	]) {
		it(`balances spare intervals: ${range}`, () => {
			const r = exact(range, 400);
			assert.deepEqual([r.min, r.max], expected);
		});
	}

	for (const [range, expected] of [[[13, 87], [0, 100]], [[-87, -13], [-100, 0]], [[-13, 87], [-100, 100]], [[-.13, .87], [-1, 1]]]) {
		it(`permits one interval without ordinary spacing selection: ${range}`, () => {
			const r = exact(range, 40);
			assert.deepEqual(r.ticks, expected);
		});
	}

	for (const height of [40, 50, 400, 413, 525, 1000]) {
		for (const v of [38, 1300, -38, -1300, 0]) {
			it(`expands flat ${v} at ${height}px`, () => {
				const r = exact([v, v], height);
				const expanded = v == 0 ? [0, 100] : [v - Math.abs(v), v + Math.abs(v)];
				assert.ok(r.min <= expanded[0] && r.max >= expanded[1]);
			});
		}
	}

	it('matches the two flat extrema from X zoom [2.9, 3.4]', () => {
		const left = exact([38, 38], 413);
		const right = exact([1300, 1300], 413);
		assert.deepEqual([left.min, left.max, left.incr], [0, 80, 10]);
		assert.deepEqual([right.min, right.max, right.incr], [0, 4000, 500]);
		assert.deepEqual(left.positions, right.positions);
	});

	for (const [range, expected] of [
		[[.1, .4], [.1, .2, .3, .4]],
		[[.29999999999999993, .5], [.2, .3, .4, .5]],
		[[-.5, -.29999999999999993], [-.5, -.4, -.3, -.2]],
	]) {
		it(`preserves enclosure at decimal grid boundaries: ${range}`, () => {
			assert.deepEqual(exact(range, 150).ticks, expected);
		});
	}

	for (const sign of [1, -1]) {
		it(`preserves a large integer grid with sign ${sign}`, () => {
			const range = sign > 0 ? [1000000000000013, 1000000000000087] : [-1000000000000087, -1000000000000013];
			const r = exact(range, 400);
			assert.equal(r.incr, 10);
			assert.deepEqual([r.min, r.max], sign > 0 ? [1000000000000010, 1000000000000090] : [-1000000000000090, -1000000000000010]);
		});
	}

	for (const range of [[.13, .87], [-.87, -.13], [-.13, .87], [1.3e-12, 8.7e-12], [1e12 + .03, 1e12 + .47], [-1e12 - .47, -1e12 - .03]])
		it(`encloses fractional extrema: ${range}`, () => exact(range, 400));

	for (const range of [[999999999999998, 999999999999999], [99999999999999.8, 99999999999999.9], [1e14 + .03, 1e14 + .47]]) {
		for (const sign of [1, -1]) {
			it(`uses a coarser grid within baseline precision limits: ${range}, sign ${sign}`, () => {
				const input = sign > 0 ? range : [-range[1], -range[0]];
				const r = exact(input, 400);
				assert.ok(r.incr >= 1);
			});
		}
	}

	for (const sign of [1, -1]) {
		it(`uses a coarser grid within the 32-decimal limit, sign ${sign}`, () => {
			const range = [-1e-21, -1e-21 + 6e-32];
			const input = sign > 0 ? [-range[1], -range[0]] : range;
			assert.ok(exact(input, 150).incr > 2.5e-32);
		});
	}

	for (const range of [[1.3e-33, 8.7e-33], [1e-32, 8e-32]])
		it(`uses the smallest built-in increment for ${range}`, () => assert.equal(exact(range, 400).incr, 1e-32));
});

describe('minimal Y range: empty and unsupported inputs', () => {
	it('keeps empty data null', () => {
		assert.deepEqual(rangeY(null, null, 400), { min: null, max: null, incr: 0, count: 0 });
	});
	for (const range of [[null, 1], [1, null], [2, 1], [NaN, 1], [0, Infinity], [-Number.MAX_VALUE, Number.MAX_VALUE], [Number.MAX_VALUE, Number.MAX_VALUE], [-Number.MAX_VALUE, -Number.MAX_VALUE], [0, 1e40], [1e20, 1e20 + 16384]])
		it(`reports unsupported extrema ${range}`, () => assert.equal(rangeY(...range, 400), null));
	for (const height of [0, -1, NaN, Infinity])
		it(`reports unsupported height ${height}`, () => assert.equal(rangeY(0, 100, height), null));
});
