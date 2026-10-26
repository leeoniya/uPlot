import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as hover from '../../bench/hover.mjs';

const source = readFileSync(new URL('../../bench/d3.mjs', import.meta.url), 'utf8')
	.replace(/^import .* from '\.\/hover\.mjs';\s*$/gm, '')
	.replace(/^export \{[^\n]+\};\s*$/gm, '');

function recorder() {
	const segments = [];
	let closes = 0;
	return {
		segments,
		get closes() { return closes; },
		moveTo(x, y) { segments.push([[x, y]]); },
		lineTo(x, y) { segments.at(-1).push([x, y]); },
		closePath() { closes++; },
	};
}

function buckets(points) {
	const result = [];
	for (const [x, y] of points) {
		let bucket = result.at(-1);
		if (!bucket || bucket.x !== x)
			result.push(bucket = {x, first: y, min: y, max: y, last: y});
		bucket.min = Math.min(bucket.min, y);
		bucket.max = Math.max(bucket.max, y);
		bucket.last = y;
	}
	return result;
}

for (const ratio of [1, 1.5, 2]) describe(`D3 streaming min/max at DPR ${ratio}`, () => {
	const draw = runInNewContext(source + '\ndrawMinMax;', {devicePixelRatio: ratio, ...hover});
	const round = value => (Math.round(value * ratio) + 0.5) / ratio;
	const xScale = x => 55 + x * 0.01;
	const yScale = y => 570 - y * 5;

	function compare(xs, values) {
		const expected = recorder();
		let length = 0;
		for (let i = 0; i <= values.length; i++) {
			if (values[i] == null) {
				if (length === 1) expected.closePath();
				length = 0;
			}
			else {
				expected[length++ === 0 ? 'moveTo' : 'lineTo'](round(xScale(xs[i])), round(yScale(values[i])));
			}
		}
		const actual = recorder();
		draw(actual, Object.freeze(xs), Object.freeze(values), xScale, yScale);
		assert.deepEqual(actual.segments.map(buckets), expected.segments.map(buckets));
		assert.equal(actual.closes, expected.closes);
		for (const segment of actual.segments) {
			let count = 0, lastX;
			for (const [x] of segment) {
				count = x === lastX ? count + 1 : 1;
				assert.ok(count <= 4, 'at most first/min/max/last per pixel column');
				lastX = x;
			}
		}
		return actual;
	}

	it('preserves first, last and both extrema regardless of their order', () => {
		for (const values of [
			[4, -8, 12, 6], [4, 12, -8, 6], [-8, 4, 6, 12], [12, 4, 6, -8],
			[4, -8, 12, 4], [4, 4, 4, 4], [-8, 12, -8, 12], [0, -2, -9, -3],
		]) compare([0, 0, 0, 0], values);
	});

	it('preserves sparse columns, repeated X, singletons and gaps within the same column', () => {
		for (const values of [[], [null], [5], [undefined, 5, null], [5, null, 8],
			[null, 1, 4, null, -8, 9, 2, undefined, 7, null]]) {
			compare(values.map(() => 0), [...values]);
			compare(values.map((_, i) => i * 201), [...values]);
		}
	});

	it('uses device-pixel boundaries, including fractional DPR and half-pixel ties', () => {
		const xs = [-0.0001, 0, 0.0001, 0.4999, 0.5, 0.5001, 0.9999, 1, 1.0001, 4]
			.map(pixel => (pixel / ratio - 55) / 0.01);
		compare(xs, [5, 1, 9, 0, 4, 3, -7, 2, 8, 6]);
	});

	it('keeps dense spikes and the final column, converting Y only for emitted vertices', () => {
		const xs = Array.from({length: 20000}, (_, i) => i * 0.2);
		const values = xs.map((_, i) => i % 997 === 0 ? 100 : i % 991 === 0 ? -100 : Math.sin(i));
		compare(xs, values);
		const actual = recorder();
		let conversions = 0;
		draw(actual, xs, values, xScale, y => { conversions++; return yScale(y); });
		const vertices = actual.segments.flat().length;
		assert.equal(conversions, vertices);
		assert.ok(vertices < values.length / 20);
	});
});
