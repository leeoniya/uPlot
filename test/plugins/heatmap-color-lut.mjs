import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logApproxLut, prepareHeatmapColorScale } from '../../demos/lib/heatmapColorLut.js';
import { generateHeatmapCells } from '../../demos/lib/heatmapCellsData.js';

describe('approximate log color LUT', () => {
	for (const ratio of [1.01, 100, 1000, 10000, 100000, 1000000]) {
		it(`bounds error by one color at ${ratio}:1 for every palette size`, () => {
			for (let colors = 11; colors <= 32; colors++) {
				const min = 1, max = ratio;
				const table = logApproxLut(colors, min, max);
				assert.ok(table);
				const { intervals, directory, blocks, lookup } = table;
				assert.ok(directory instanceof Uint8Array && blocks instanceof Uint8Array);
				assert.equal(directory.length, Math.ceil((intervals + 1) / 64));
				assert.ok(blocks.length <= (2 * colors - 1) * 64);
				assert.equal(lookup(min), 0);
				assert.equal(lookup(max), colors - 1);
				const logRange = Math.log(max / min);
				const step = logRange / (colors - 1);
				const gap = Math.exp(step / 2) * Math.expm1(step) / (ratio - 1);
				assert.ok(intervals * gap >= 4 - 1e-12, 'four subdivisions of a sufficient grid');
				// Match setup rounding when a transition lies exactly on an integer grid point.
								const positions = Array.from({ length: colors - 1 }, (_, i) => Math.expm1(step * (i + .5)) / Math.expm1(logRange));
				const transitions = positions.map(t => Math.ceil(t * intervals));
				const at = i => blocks[(directory[i >>> 6] << 6) | (i & 63)];
				for (let i = 0; i < blocks.length; i++) {
					assert.ok(blocks[i] < colors);
					if (i % 64) assert.ok(blocks[i] >= blocks[i - 1]);
				}
				// Every directory entry must cover the expected range of colors.
				for (let b = 0, color = 0; b < directory.length; b++) {
					const start = b * 64;
					while (start >= transitions[color]) color++;
					assert.equal(at(start), color);
					while (start + 63 >= transitions[color]) color++;
					assert.equal(at(start + 63), color);
				}
				const check = count => {
					const exact = Math.round(Math.log(count / min) / logRange * (colors - 1));
					assert.ok(Math.abs(lookup(count) - exact) <= 1, `${colors} colors, count ${count}`);
				};
				transitions.forEach((edge, i) => {
					assert.equal(at(edge - 1), i);
					assert.equal(at(edge), i + 1);
					if (i) assert.ok(edge > transitions[i - 1]);
					const threshold = min * Math.exp(step * (i + .5));
					for (const delta of [-1e-12, 0, 1e-12]) check(threshold * (1 + delta));
					for (const delta of [-1e-6, 0, 1e-6]) check(min + (max - min) * (edge + delta) / intervals);
				});
				for (let i = 1; i < 257; i++) {
					check(min + (max - min) * i / 257);
					check(min * Math.exp(logRange * i / 257));
				}
			}
		});
	}

	it('retains the error bound across absolute count magnitudes', () => {
		for (const min of [1e-9, 1e9]) {
			for (const ratio of [1.01, 392, 1e6]) {
				for (let colors = 11; colors <= 32; colors++) {
					const max = min * ratio;
					const table = logApproxLut(colors, min, max);
					assert.ok(table);
					assert.equal(table.lookup(min), 0);
					assert.equal(table.lookup(max), colors - 1);
					for (let i = 1; i < 257; i++) {
						const count = min * Math.exp(Math.log(ratio) * i / 257);
						const exact = Math.round(Math.log(count / min) / Math.log(ratio) * (colors - 1));
						assert.ok(Math.abs(table.lookup(count) - exact) <= 1);
					}
				}
			}
		}
	});

	it('matches the measured generated-data errors and compressed size', () => {
		const frame = generateHeatmapCells({ xGapProbability: .02 })[0];
		const counts = frame.data.values[frame.schema.fields.findIndex(field => field.name == 'count')];
		const min = counts.reduce((a, b) => Math.min(a, b), Infinity);
		const max = counts.reduce((a, b) => Math.max(a, b), -Infinity);
		const table = logApproxLut(24, min, max);
		assert.equal(table.intervals, 8464);
		assert.equal(table.directory.byteLength + table.blocks.byteLength, 2053);
		let errors = 0;
		for (const count of counts) {
			const exact = Math.round((Math.log(count) - Math.log(min)) / (Math.log(max) - Math.log(min)) * 23);
			const error = table.lookup(count) - exact;
			assert.ok(error == 0 || error == -1);
			if (error) errors++;
		}
		assert.equal(errors, 4);
	});

	it('maps constant domains to zero without large tables', () => {
		for (const count of [-1, 0, 3, 1e100]) {
			const table = logApproxLut(24, count, count);
			assert.equal(table.lookup(count), 0);
			assert.equal(table.intervals, 0);
			assert.equal(table.directory.byteLength + table.blocks.byteLength, 65);
		}
	});

	it('falls back for palettes outside 11–32 colors and domains without a usable bounded grid', () => {
		for (const [colors, min, max] of [
			[10, 1, 10], [33, 1, 10], [24, 1, 1e12], [24, 1e300, 1e300 * (1 + 2e-14)],
			[24, Number.MIN_VALUE, Number.MIN_VALUE * 2],
		]) assert.equal(logApproxLut(colors, min, max), null);
	});

	it('does no nonlinear math or typed-array allocation during lookup', () => {
		const table = logApproxLut(24, 1, 392);
		const counts = [1, 2, 3, 50, 120, 392];
		const expected = counts.map(table.lookup);
		const names = ['log', 'log1p', 'exp', 'expm1', 'sqrt', 'cbrt', 'pow'];
		const originals = names.map(name => Math[name]);
		const Uint8 = globalThis.Uint8Array;
		try {
			for (const name of names) Math[name] = () => assert.fail(`lookup called Math.${name}`);
			globalThis.Uint8Array = function() { assert.fail('lookup allocated a typed array'); };
			counts.forEach((count, i) => assert.equal(table.lookup(count), expected[i]));
		}
		finally {
			names.forEach((name, i) => { Math[name] = originals[i]; });
			globalThis.Uint8Array = Uint8;
		}
	});
});

const palette = n => Array.from({ length: n }, (_, i) => `hsl(${i} 80% 50%)`);
const modes = ['linear', 'sqrt', 'cbrt', 'log'];

describe('prepared heatmap color scale', () => {
	it('uses a solid first color for single colors and constant domains, including empty data', () => {
		for (const scale of modes) {
			for (const [colors, min, max] of [[['red'], 1, 10], [['red', 'blue'], 0, 0], [['red', 'blue'], -3, -3]]) {
				const { lookup, stops } = prepareHeatmapColorScale(colors, scale, min, max);
				assert.deepEqual(stops, [[0, 'red'], [1, 'red']]);
				assert.deepEqual([-Infinity, min, max, Infinity].map(lookup), [0, 0, 0, 0]);
			}
		}
	});

	it('inverts each transform for the legend and clamps both ends of the lookup', () => {
		const colors = ['#abc', 'var(--mid)', 'steelblue'];
		for (const [scale, mid] of [['linear', .5], ['sqrt', .25], ['cbrt', .125], ['log', 1 / 11]]) {
			const { lookup, stops } = prepareHeatmapColorScale(colors, scale, 1, 100);
			assert.deepEqual(stops.map(s => s[1]), colors);
			assert.equal(stops[0][0], 0);
			assert.equal(stops[2][0], 1);
			assert.ok(Math.abs(stops[1][0] - mid) < 1e-15);
			assert.deepEqual([-Infinity, .5, 1, 1 + mid * 99, 100, 101, Infinity].map(lookup), [0, 0, 0, 1, 2, 2, 2]);
		}
	});

	it('switches exactly at every odd-square and odd-cube boundary', () => {
		for (let n = 2; n <= 32; n++) {
			for (const [scale, power] of [['sqrt', 2], ['cbrt', 3]]) {
				const min = -8, max = min + (2 * (n - 1)) ** power;
				const { lookup } = prepareHeatmapColorScale(palette(n), scale, min, max);
				for (let i = 1; i < n; i++) {
					const edge = min + (2 * i - 1) ** power;
					assert.equal(lookup(edge - .25), i - 1);
					assert.equal(lookup(edge), i);
				}
			}
		}
	});

	it('builds only the requested root table and reuses it across domains and palettes', () => {
		const colors = palette(9);
		for (const scale of ['sqrt', 'cbrt']) prepareHeatmapColorScale(palette(8), scale, 0, 1);
		const Uint8 = globalThis.Uint8Array;
		let allocations = 0;
		try {
			globalThis.Uint8Array = class extends Uint8 { constructor(...args) { super(...args); allocations++; } };
			prepareHeatmapColorScale(colors, 'linear', 0, 1);
			prepareHeatmapColorScale(colors, 'log', 1, 2);
			assert.equal(allocations, 0);
			const sqrt = prepareHeatmapColorScale(colors, 'sqrt', 0, 1);
			assert.equal(allocations, 1);
			prepareHeatmapColorScale(colors, 'cbrt', 0, 1);
			assert.ok(allocations > 1);
			const built = allocations;
			for (const scale of ['sqrt', 'cbrt']) {
				const { lookup } = prepareHeatmapColorScale(colors.slice().reverse(), scale, 1, 5);
				assert.equal(lookup(2), scale == 'sqrt' ? 4 : 5);
			}
			assert.equal(sqrt.lookup(.25), 4);
			assert.equal(allocations, built);
		}
		finally { globalThis.Uint8Array = Uint8; }
	});

	it('uses approximate log where supported and direct log outside the LUT limits', () => {
		const approx = logApproxLut(24, 1, 392);
		const { lookup } = prepareHeatmapColorScale(palette(24), 'log', 1, 392);
		// The first true log transition is slightly before its LUT grid point.
		const edge = 392 ** (.5 / 23) + 1e-10;
		assert.equal(lookup(edge), approx.lookup(edge));
		assert.equal(lookup(edge), 0);
		for (const [n, max] of [[9, 100], [24, 1e12]]) {
			const direct = prepareHeatmapColorScale(palette(n), 'log', 1, max);
			assert.equal(direct.lookup(max ** .75), Math.round(.75 * (n - 1)));
		}
	});

	it('maps direct log counts and legend stops without checking finiteness during lookup', () => {
		const colors = palette(9);
		for (const [lo, hi] of [[0, 8], [-500, 500]]) {
			const min = 2 ** lo, max = 2 ** hi;
			const { lookup, stops } = prepareHeatmapColorScale(colors, 'log', min, max);
			const isFinite = Number.isFinite;
			try {
				Number.isFinite = () => assert.fail('lookup called Number.isFinite');
				for (let i = 0; i < colors.length; i++) {
					const count = 2 ** (lo + (hi - lo) * i / (colors.length - 1));
					assert.equal(lookup(count), i);
					assert.equal(lookup(min + (max - min) * stops[i][0]), i);
				}
			}
			finally { Number.isFinite = isFinite; }
		}
	});

	it('keeps indices above 255 for large palettes without allocating root grids', () => {
		const colors = palette(2049);
		const Uint8 = globalThis.Uint8Array;
		try {
			globalThis.Uint8Array = function() { assert.fail('large palette allocated a LUT'); };
			for (const [scale, count] of [['linear', 5], ['sqrt', 3], ['cbrt', 2], ['log', 3]]) {
				const { lookup, stops } = prepareHeatmapColorScale(colors, scale, 1, 9);
				assert.equal(lookup(count), 1024);
				assert.equal(stops.length, colors.length);
			}
		}
		finally { globalThis.Uint8Array = Uint8; }
	});

	it('keeps log indices and stops across subnormal, wide, and near-equal positive domains', () => {
		const tiny = Number.MIN_VALUE;
		for (const [min, mid, max] of [[1e300, 1e300 * (1 + 1e-14), 1e300 * (1 + 2e-14)], [1e-150, 1, 1e150], [tiny, 2 * tiny, 4 * tiny]]) {
			const { lookup, stops } = prepareHeatmapColorScale(palette(25), 'log', min, max);
			assert.equal(lookup(mid), 12);
			assert.equal(stops[0][0], 0);
			assert.equal(stops.at(-1)[0], 1);
			for (let i = 1; i < stops.length; i++) assert.ok(stops[i][0] >= stops[i - 1][0]);
			assert.ok(stops[12][0] > 0 && stops[12][0] < 1);
		}
	});
});
