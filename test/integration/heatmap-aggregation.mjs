import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Window} from 'happy-dom';
import {aggregateHeatmap, getSampleBounds} from '../../demos/lib/heatmapAggregation.js';
import {bindBucketControls} from '../../demos/lib/heatmapBucketControls.js';

import {generatePoints} from '../../demos/lib/heatmapSamples.js';

it('generates the requested number of seeded XY samples', () => {
	for (const name of ['cloud', 'annulus', 'clusters', 'moons', 'spiral', 'checkerboard']) {
		const [xs, ys] = generatePoints(name, 9);
		assert.ok(xs instanceof Float64Array && ys instanceof Float64Array);
		assert.equal(xs.length, 9);
		assert.equal(ys.length, 9);
		assert.deepEqual(generatePoints(name, 4), [xs.subarray(0, 4), ys.subarray(0, 4)]);
	}
	assert.deepEqual(generatePoints('cloud', 0), [new Float64Array(0), new Float64Array(0)]);
});

it('reproduces each distribution by seed and resamples it with a different seed', () => {
	for (const name of ['cloud', 'annulus', 'clusters', 'moons', 'spiral', 'checkerboard']) {
		const points = generatePoints(name, 16, 0);
		assert.deepEqual(generatePoints(name, 16, 0), points);
		assert.notDeepEqual(generatePoints(name, 16, 0xffffffff), points);
	}
});

it('coalesces sample and bucket changes without locking the sample count to either axis', () => {
	const win = new Window();
	const doc = win.document;
	doc.body.innerHTML = readFileSync(new URL('../../demos/heatmap-aggregation.html', import.meta.url), 'utf8');
	const x = doc.getElementById('nx'), y = doc.getElementById('ny');
	const samples = doc.getElementById('samples'), sampleValue = doc.getElementById('samples-value');
	assert.deepEqual([samples.min, samples.max, samples.step, samples.value], ['5000', '250000', '5000', '100000']);
	const frames = [], updates = [];
	win.requestAnimationFrame = fn => frames.push(fn);
	bindBucketControls(doc.getElementById('grid'), () => updates.push([x.value, y.value]));

	function move(input, value) {
		input.value = value;
		input.dispatchEvent(new win.Event('input', {bubbles: true}));
	}
	move(x, '32');
	assert.equal(y.value, '32');
	move(y, '64');
	assert.equal(samples.value, '100000');
	move(samples, '105000');
	assert.equal(sampleValue.value, (105000).toLocaleString());
	assert.equal(x.value, '64');
	assert.equal(y.value, '64');
	assert.deepEqual(updates, []);
	assert.equal(frames.length, 1);
	frames.shift()();
	assert.deepEqual(updates, [['64', '64']]);
	assert.equal(frames.length, 0);

	const lock = doc.querySelector('button#lock-grid');
	assert.equal(lock.getAttribute('aria-pressed'), 'true');
	lock.click();
	assert.equal(lock.getAttribute('aria-pressed'), 'false');
	assert.equal(frames.length, 0);
	move(y, '48');
	frames.shift()();
	assert.deepEqual(updates.at(-1), ['64', '48']);

	lock.click();
	assert.equal(lock.getAttribute('aria-pressed'), 'true');
	assert.equal(frames.length, 1);
	frames.shift()();
	assert.deepEqual(updates.at(-1), ['48', '48']);
});

const edgeXs = [4, -0.5, 0, -2, 2, 0, 1.5, 4];
const edgeYs = [14, 12, 10, 10, 12, 12, 11.5, 10];

function cells({data, grid, xSize, xRange, yRange, scratchBytes}) {
	assert.equal(data.length, 2);
	assert.equal(data[0], null);
	assert.equal(data[1].length, 4);
	assert.equal(grid.x.step, xSize);
	assert.deepEqual(grid.x.extent, [xRange[0] + xSize, xRange[1]]);
	assert.deepEqual(grid.y.extent, yRange);
	assert.ok(Number.isSafeInteger(scratchBytes) && scratchBytes >= 0);
	return data[1].map(column => [...column]);
}

describe('aggregateHeatmap', () => {

	it('reuses sample bounds across grids without changing the result or rescanning extrema', () => {
		const xs = edgeXs.slice();
		let firstReads = 0;
		Object.defineProperty(xs, 0, {get() { firstReads++; return edgeXs[0]; }});
		const bounds = getSampleBounds(xs, edgeYs);

		for (const [nx, ny] of [[3, 2], [5, 7]]) {
			firstReads = 0;
			assert.deepEqual(aggregateHeatmap(xs, edgeYs, nx, ny, bounds), aggregateHeatmap(edgeXs, edgeYs, nx, ny));
			assert.equal(firstReads, 1, 'only the binning pass should read the first point');
		}
	});

	it('fills dense column runs without changing fractional edges or skipping a sparse row', () => {
		const xs = [0.1, 0.1, 0.1, 0.7, 0.9, 0.9], ys = [-1.3, 0.2, 2.1, 0.1, -1.3, 2.1];
		const nx = 17, ny = 11;
		const result = aggregateHeatmap(xs, ys, nx, ny);
		const dx = (0.9 - 0.1) / nx, dy = (2.1 - -1.3) / ny;
		assert.deepEqual(cells(result), [
			[0.1 + dx, 0.1 + dx, 0.1 + dx, 0.1 + 13 * dx, 0.9, 0.9],
			[-1.3, -1.3 + 4 * dy, -1.3 + 10 * dy, -1.3 + 4 * dy, -1.3, -1.3 + 10 * dy],
			[-1.3 + dy, -1.3 + 5 * dy, 2.1, -1.3 + 5 * dy, -1.3 + dy, 2.1],
			[1, 1, 1, 1, 1, 1],
		]);
		assert.equal(result.scratchBytes, nx * ny * Uint32Array.BYTES_PER_ELEMENT + (ny + 1) * Float64Array.BYTES_PER_ELEMENT);
	});

	it('puts interior edges in the upper bin and includes the exact maxima in the last bin', () => {
		const result = aggregateHeatmap(edgeXs, edgeYs, 3, 2);
		assert.equal(result.xSize, 2);
		assert.deepEqual([...result.xRange], [-2, 4]);
		assert.deepEqual([...result.yRange], [10, 14]);
		assert.deepEqual(cells(result), [
			[0, 0, 2, 2, 4, 4],
			[10, 12, 10, 12, 10, 12],
			[12, 14, 12, 14, 12, 14],
			[1, 1, 2, 1, 1, 2],
		]);
	});

	it('clamps scaled coordinates that round up to the bucket count', () => {
		const nearMax = 1 - Number.EPSILON / 2;
		const result = aggregateHeatmap([-1, -1, nearMax, 1], [-1, nearMax, 0, 1], 4, 2);
		assert.deepEqual(cells(result), [[-0.5, -0.5, 1], [-1, 0, 0], [0, 1, 1], [1, 1, 2]]);
	});

	it('skips empty rows and columns without losing counts or changing cell order', () => {
		const xs = [257, 64.5, 0, 256, 64, 0.5, 64.75, 0];
		const ys = [0, 17.5, 33, 0, 32.5, 1.5, 17, 33];
		const result = aggregateHeatmap(xs, ys, 257, 33);
		const columns = cells(result);
		assert.equal(columns[3].reduce((sum, count) => sum + count, 0), xs.length);
		assert.deepEqual(columns, [
			[1, 1, 65, 65, 257],
			[1, 32, 17, 32, 0],
			[2, 33, 18, 33, 1],
			[1, 2, 2, 1, 2],
		]);
	});

	it('keeps repeated coordinates together on constant axes', () => {
		for (const [xs, ys, expectedCounts] of [
			[[7, 7, 7], [2, 0, 0], [2, 1]],
			[[2, 0, 0], [-3, -3, -3], [2, 1]],
			[[7, 7, 7], [-3, -3, -3], [3]],
		]) {
			const result = aggregateHeatmap(xs, ys, 4, 2);
			const [right, low, high, counts] = cells(result);
			assert.deepEqual(counts, expectedCounts);
			assert.ok(Number.isFinite(result.xSize) && result.xSize > 0);
			for (const [range, values] of [[result.xRange, xs], [result.yRange, ys]]) {
				assert.ok(Number.isFinite(range[0]) && range[0] <= Math.min(...values));
				assert.ok(Number.isFinite(range[1]) && range[1] >= Math.max(...values));
			}
			for (const bounds of [right, low, high]) {
				assert.equal(bounds.length, counts.length);
				assert.ok(bounds.every(Number.isFinite));
			}
			// The repeated minimum sorts first; both axes can be constant.
			for (let i = 0; i < counts.length; i++) {
				const x = i === 0 ? xs[1] : xs[0];
				const y = i === 0 ? ys[1] : ys[0];
				assert.ok(right[i] - result.xSize <= x && x <= right[i]);
				assert.ok(low[i] <= y && y <= high[i] && low[i] < high[i]);
			}
		}
	});

	it('keeps distinct quarter-unit edges at a large coordinate offset', () => {
		const base = 2 ** 50;
		const result = aggregateHeatmap([base, base + 0.25, base + 0.75], [base, base, base], 3, 4);
		assert.deepEqual(cells(result), [
			[base + 0.25, base + 0.5, base + 0.75],
			[base, base, base],
			[base + 0.25, base + 0.25, base + 0.25],
			[1, 1, 1],
		]);
	});

	it('derives both ranges from a single point', () => {
		const result = aggregateHeatmap([-3], [7], 2, 2);
		assert.deepEqual(result.xRange, [-3.5, -2.5]);
		assert.deepEqual(result.yRange, [6.5, 7.5]);
		assert.deepEqual(cells(result), [[-2.5], [7], [7.5], [1]]);
	});
});
