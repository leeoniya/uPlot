import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {rollup} from 'rollup';

// Expose internal helpers only in the test bundle.
const bundle = await rollup({
	input: new URL('../src/uPlot.js', import.meta.url).pathname,
	plugins: [{
		name: 'axis-test-exports',
		transform(code, id) {
			if (id.endsWith('/src/uPlot.js'))
				return code + '\nexport {findIncr}; export {numAxisSplits, numIncrs} from "./opts";';
		},
	}],
});
const {output} = await bundle.generate({format: 'es'});
await bundle.close();
const {findIncr, numAxisSplits, numIncrs} = await import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));

function splits(min, max, incr, forceMin = false) {
	return vm.runInNewContext('numAxisSplits(null, 0, min, max, incr, 50, forceMin)', {
		numAxisSplits, min, max, incr, forceMin,
	}, {timeout: 100});
}

test('selects a representable increment for large positive and negative values', () => {
	for (const min of [4220788960490496, -4220788960490496, 1e18, -1e18]) {
		const max = min + (Math.abs(min) > 1e17 ? 256 : 1);
		const [incr] = findIncr(min, max, numIncrs, 320, 50);
		assert.ok(min + incr > min);
		assert.ok(max + incr > max);
		const ticks = splits(min, max, incr);
		assert.ok(ticks.length >= 1, `no ticks for ${min} with increment ${incr}`);
		assert.ok(ticks.every(value => value >= min && value <= max));
		assert.ok(ticks.every((value, i) => i === 0 || value > ticks[i - 1]));
	}
});

test('terminates when a custom increment cannot advance the value', () => {
	const min = 4220788960490496;
	assert.deepEqual(splits(min, min + 1, 0.2, true), [min]);
});

test('preserves ordinary fractional ticks and coalesces negative zero', () => {
	assert.deepEqual(splits(0, 1, 0.2), [0, 0.2, 0.4, 0.6, 0.8, 1]);
	assert.deepEqual(splits(-1, 1, 0.5), [-1, -0.5, 0, 0.5, 1]);
	assert.equal(Object.is(splits(-0, 1, 1, true)[0], -0), false);
});
