import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logApproxLut } from '../../demos/lib/heatmapColorLut.js';
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

	it('rejects unsupported domains and sizes before allocating large tables', () => {
		for (const [colors, min, max] of [
			[10, 1, 10], [33, 1, 10], [11.5, 1, 10], [24, 0, 10], [24, -1, 10], [24, 10, 1],
			[24, NaN, 10], [24, 1, Infinity], [24, Infinity, Infinity], [24, 1, 1e12],
			[24, Number.MIN_VALUE, 1], [24, Number.MIN_VALUE, Number.MIN_VALUE * 2],
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
