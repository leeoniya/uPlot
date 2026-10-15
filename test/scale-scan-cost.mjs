import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

function tracked(values) {
	let count = 0;
	const indices = new Set();
	const data = new Proxy(values, {
		get(target, key, receiver) {
			if (typeof key == 'string' && /^(0|[1-9]\d*)$/.test(key)) {
				count++;
				indices.add(+key);
			}
			return Reflect.get(target, key, receiver);
		},
	});

	return {
		data,
		reset() {
			count = 0;
			indices.clear();
		},
		snapshot: () => ({ count, indices: [...indices].sort((a, b) => a - b) }),
	};
}

function assertReads(actual, allowed, limit) {
	assert.ok(actual.count <= limit, `${actual.count} element reads exceed the budget of ${limit}`);
	assert.deepEqual(actual.indices, [...allowed].sort((a, b) => a - b), 'only the requested edges are read');
}

function makePlot(values, { mode = 1, key = 'y', sorted, log = false, time = false } = {}) {
	const other = Array.from({ length: values.length }, (_, i) => i + 1);
	const data = key == 'x' ? [values, other] : [other, values];
	const series = [{}, { paths: () => null, points: { show: false } }];

	if (mode == 1) {
		if (sorted != null)
			series[key == 'x' ? 0 : 1].sorted = sorted;
	}
	else {
		series[1].facets = [{ scale: 'x' }, { scale: 'y' }];
		if (sorted != null)
			series[1].facets[key == 'x' ? 0 : 1].sorted = sorted;
	}

	return new uPlot({
		width: 400,
		height: 200,
		mode,
		ms: 1,
		axes: [],
		cursor: { show: false },
		legend: { show: false },
		// Fixed ranges prevent initialization from populating the extrema caches.
		scales: {
			x: { time: key == 'x' && time, range: [1, values.length + 1] },
			y: { range: [1, values.length + 1] },
			[key]: { time, distr: log ? 3 : 1, range: [1, values.length + 1] },
		},
		series,
	}, mode == 1 ? data : [null, data], document.body);
}

const sizes = [32, 65536];

describe('scale scan element-access cost', () => {
	for (const { name, mode, key, sorted, time } of [
		{ name: 'default ascending time X', mode: 1, key: 'x', time: true },
		{ name: 'ascending Y', mode: 1, key: 'y', sorted: 1 },
		{ name: 'descending Y', mode: 1, key: 'y', sorted: -1 },
		{ name: 'ascending time X facet', mode: 2, key: 'x', sorted: 1, time: true },
		{ name: 'descending time X facet', mode: 2, key: 'x', sorted: -1, time: true },
	]) {
		for (const size of sizes) {
			it(`${name}: reads only interval endpoints with ${size} values, including a fresh cached scan`, async () => {
				const values = Array.from({ length: size }, (_, i) => sorted == -1 ? size - i : i + 1);
				const reads = tracked(values);
				const u = makePlot(reads.data, { mode, key, sorted, time });
				try {
					await Promise.resolve();
					const owner = mode == 1 ? u.series[key == 'x' ? 0 : 1] : u.series[1].facets[key == 'x' ? 0 : 1];
					assert.equal(owner.sorted, sorted ?? 1);

					for (const [i0, i1] of [[undefined, undefined], [5, size - 6]]) {
						const first = i0 ?? 0;
						const last = i1 ?? size - 1;
						const expected = [values[first], values[last]].sort((a, b) => a - b);
						for (const cache of [false, true]) {
							owner.min = owner.max = null;
							reads.reset();
							assert.deepEqual(uPlot.scan(u, key, i0, i1, cache), expected);
							// Allow redundant endpoint reads, but never traversal of the interior.
							assertReads(reads.snapshot(), [first, last], 8);
							assert.deepEqual([owner.min, owner.max], cache ? expected : [null, null]);
						}
					}
				}
				finally {
					u.destroy();
				}
			});
		}
	}

	for (const sorted of [1, -1]) {
		for (const log of [false, true]) {
			it(`skips only invalid edges, not valid interiors (sorted ${sorted}, log ${log})`, async () => {
				const size = 65536;
				const prefix = log ? [null, undefined, -2, -1, 0] : [null, undefined];
				const values = [...prefix, ...Array.from({ length: size }, (_, i) => i + 1), undefined, null];
				const edgeIndices = [
					...Array.from({ length: prefix.length + 1 }, (_, i) => i),
					values.length - 3, values.length - 2, values.length - 1,
				];
				if (sorted == -1)
					values.reverse();
				const allowed = edgeIndices.map(i => sorted == -1 ? values.length - 1 - i : i);
				const reads = tracked(values);
				const u = makePlot(reads.data, { sorted, log });
				try {
					await Promise.resolve();
					reads.reset();
					assert.deepEqual(uPlot.scan(u, 'y'), [1, size]);
					assertReads(reads.snapshot(), allowed, allowed.length + 4);
				}
				finally {
					u.destroy();
				}
			});
		}
	}

	it('does not infer facet sorting from time:true', async () => {
		const values = Array(4096).fill(10);
		values[123] = 1;
		values[2048] = 100;
		const reads = tracked(values);
		const u = makePlot(reads.data, { mode: 2, key: 'x', time: true });
		try {
			await Promise.resolve();
			assert.equal(u.series[1].facets[0].sorted ?? 0, 0);
			reads.reset();
			assert.deepEqual(uPlot.scan(u, 'x'), [1, 100]);
			assert.equal(reads.snapshot().indices.length, values.length, 'unsorted extrema require interior reads');
		}
		finally {
			u.destroy();
		}
	});

	it('keeps endpoint work constant per participating facet across different data lengths', async () => {
		const ascending = tracked(Array.from({ length: 65536 }, (_, i) => i + 1));
		const descending = tracked(Array.from({ length: 32 }, (_, i) => 100000 - i));
		const hidden = tracked(Array(65536).fill(200000));
		const excluded = tracked(Array(65536).fill(300000));
		const inputs = [ascending, descending, hidden, excluded];
		const u = new uPlot({
			width: 400,
			height: 200,
			mode: 2,
			axes: [],
			cursor: { show: false },
			legend: { show: false },
			scales: {
				x: { time: true, range: [0, 400000] },
				y: { range: [0, 2] },
			},
			series: [{}, ...inputs.map((input, i) => ({
				show: i != 2,
				paths: () => null,
				points: { show: false },
				facets: [{ scale: 'x', sorted: i == 1 ? -1 : 1, scan: i != 3 }, { scale: 'y' }],
			}))],
		}, [null, ...inputs.map(input => [input.data, Array(input.data.length).fill(1)])], document.body);
		try {
			await Promise.resolve();
			inputs.forEach(input => input.reset());
			assert.deepEqual(uPlot.scan(u, 'x'), [1, 100000]);
			assertReads(ascending.snapshot(), [0, 65535], 8);
			assertReads(descending.snapshot(), [0, 31], 8);
			assertReads(hidden.snapshot(), [], 0);
			assertReads(excluded.snapshot(), [], 0);
		}
		finally {
			u.destroy();
		}
	});

	it('permits a full edge search when every value is nullish', async () => {
		const reads = tracked(Array.from({ length: 4096 }, (_, i) => i % 2 ? null : undefined));
		const u = makePlot(reads.data, { sorted: 1 });
		try {
			await Promise.resolve();
			reads.reset();
			assert.deepEqual(uPlot.scan(u, 'y'), [null, null]);
			const actual = reads.snapshot();
			assert.equal(actual.indices.length, 4096);
			assert.ok(actual.count <= 2 * 4096 + 4, 'at most two edge searches, not repeated rescans');
		}
		finally {
			u.destroy();
		}
	});

	for (const size of sizes) {
		for (const scan of [undefined, true]) {
			it(`built-in mode-1 time X ranging reads only endpoints before range() (${size} values, scan ${scan})`, async () => {
				const reads = tracked(Array.from({ length: size }, (_, i) => i + 1));
				const calls = [];
				const data = [reads.data, Array(size).fill(1)];
				const u = new uPlot({
					width: 400,
					height: 200,
					ms: 1,
					axes: [],
					cursor: { show: false },
					legend: { show: false },
					scales: {
						x: {
							scan,
							range: (u, min, max) => {
								calls.push({ extrema: [min, max], reads: reads.snapshot() });
								return [min, max];
							},
						},
						y: { range: [0, 2] },
					},
					series: [{}, { paths: () => null, points: { show: false } }],
				}, data, document.body);
				try {
					for (const action of [null, () => u.setData(data), () => u.setScale('x', { min: null, max: null })]) {
						if (action != null) {
							calls.length = 0;
							reads.reset();
							action();
						}
						await Promise.resolve();
						assert.equal(calls.length, 1);
						assert.deepEqual(calls[0].extrema, [1, size]);
						// Later window searches and rendering are not part of the extrema-scan budget.
						assertReads(calls[0].reads, [0, size - 1], 8);
					}
				}
				finally {
					u.destroy();
				}
			});
		}
	}
});
