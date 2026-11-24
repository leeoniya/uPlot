import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const builders = [
	['linear', uPlot.paths.linear()],
	['spline', uPlot.paths.spline()],
	['step-before', uPlot.paths.stepped({ align: -1 })],
	['step-after', uPlot.paths.stepped({ align: 1 })],
];

async function withPlot(raw, options, check) {
	const {
		xs = raw.map((_, i) => i), xRange = [xs[0], xs.at(-1)],
		paths = builders[0][1], ori = 0, dir = 1, spanGaps = false,
		width = 400, height = 240, padding = [0, 0, 0, 0],
	} = options;
	const u = new uPlot({
		width, height, pxRatio: 1, padding, axes: [],
		cursor: { show: false }, legend: { show: false },
		stack: { groups: [{ series: [1, 2], dir: 1 }] },
		scales: { x: { time: false, ori, dir, range: xRange }, y: { ori: 1 - ori, range: [0, 12] } },
		series: [{}, { paths: () => null, points: { show: false } }, {
			paths, spanGaps, width: 2, stroke: 'blue', fill: 'silver', points: { show: false },
		}],
	}, [xs, raw.map(() => 3), raw], document.body);
	try {
		await Promise.resolve();
		assert.equal('_hasZero' in u.series[2], false);
		for (const key of ['clipStroke', '_zero', '_zeroWidth'])
			assert.equal(key in u.series[2]._paths, false, 'paths do not carry zero-clipping metadata');
		await check(u);
	}
	finally { u.destroy(); }
}

const commands = (path, op) => path.log.flatMap(([name, ...args]) => name == op ? args : []);
const pixel = (u, value, scale = 'x') => u.series[2].pxRound(u.valToPos(value, scale, true));

describe('stack zero stroke paths', () => {
	for (const [name, paths] of builders) {
		it(`${name}: keeps signed zeros and null/undefined gap semantics`, async () => {
			for (const spanGaps of [false, true]) {
				for (const skipped of [[null], [undefined], [null, undefined]]) {
					const raw = [5, -0, ...skipped, 0, 5];
					await withPlot(raw, { paths, spanGaps }, u => {
						const p = u.series[2]._paths;
						assert.ok(Object.is(u.data[2][1], -0), 'stacking does not rewrite signed raw zero');
						assert.deepEqual(u._data[2], raw.map(v => v == null ? v : v + 3));
						assert.equal(p.clip != null, !spanGaps && skipped.includes(null), 'only null creates an ordinary gap');
						assert.equal(p.gaps?.length ?? null, spanGaps ? null : skipped.includes(null) ? 1 : 0);
					});
				}
				await withPlot([null, -0, undefined, 0, null], { paths, spanGaps, xRange: [-1, 5] }, u => {
					assert.deepEqual(u._data[2], [null, 3, undefined, 3, null]);
					assert.ok(u.series[2]._paths.stroke.log.length > 0, 'trimmed all-zero data retains its cumulative stroke');
				});
			}
		});

		it(`${name}: builds paths from cumulative data without scanning raw samples`, async () => {
			for (const raw of [[5, 5, 5], [5, 0, 0], [0, 0, 0]]) {
				await withPlot(raw, { paths }, u => {
					const original = u.series[2]._paths.stroke.log;
					u.data[2] = new Proxy(raw, { get() { throw new Error('unexpected raw-data scan'); } });
					try { assert.deepEqual(paths(u, 2, 0, 2).stroke.log, original); }
					finally { u.data[2] = raw; }
				});
			}
		});
	}

	it('linear: preserves an isolated zero and a same-pixel nonzero spike', async () => {
		for (const [xs, raw, ys] of [
			[[0, 1, 2], [5, 0, 5], [8, 3, 8]],
			[[0, 1.999, 2, 2.001, 4], [0, 0, 5, 0, 0], [3, 3, 8, 3, 3]],
		]) {
			await withPlot(raw, { xs }, u => {
				assert.deepEqual(commands(u.series[2]._paths.stroke, 'lineTo'), ys.map((y, i) => [pixel(u, xs[i]), pixel(u, y, 'y')]));
				if (xs.length == 5)
					assert.deepEqual(xs.slice(1, 4).map(x => pixel(u, x)), Array(3).fill(pixel(u, 2)), 'both zero neighbors round to the spike X pixel');
			});
		}
	});

	// Eight samples per pixel force decimation; index 405 is emitted in the preceding pixel bucket.
	for (const spike of [400, 405]) {
		it(`linear: decimation retains a nonzero excursion among zeros, index=${spike}`, async () => {
			const raw = Array(801).fill(0);
			raw[spike] = 5;
			await withPlot(raw, { width: 100 }, u => {
				const vertices = commands(u.series[2]._paths.stroke, 'lineTo');
				assert.ok(raw.length - 1 >= u.bbox.width * 4);
				assert.ok(vertices.length < raw.length / 2, 'the native path was decimated');
				assert.ok(vertices.some(([, y]) => y == pixel(u, 8, 'y')), 'decimation retains the nonzero excursion');
			});
		});
	}

	for (const dir of [-1, 1]) {
		for (const align of [-1, 1]) {
			it(`rotated stepped extension uses the independent-axis bounds, dir=${dir}, align=${align}`, async () => {
				const screenValues = align == 1 ? [5, 5, 0] : [0, 5, 5];
				const raw = dir == -1 ? screenValues : screenValues.slice().reverse();
				// Padding distinguishes top from left; unequal dimensions distinguish height from width.
				for (const padded of [false, true]) {
					await withPlot(raw, {
						xs: [1, 2, 3], xRange: [0, 4], ori: 1, dir,
						width: padded ? 115 : 100, height: padded ? 450 : 400,
						padding: padded ? [30, 10, 20, 5] : [0, 0, 0, 0],
						paths: uPlot.paths.stepped({ align, extend: true }),
					}, u => {
						const p = u.series[2]._paths;
						const vertices = commands(p.stroke, 'lineTo');
						const first = pixel(u, dir == -1 ? 1 : 3);
						const last = pixel(u, dir == -1 ? 3 : 1);
						const transition = align == -1 ? first : last;
						const edge = u.bbox.top + (align == 1 ? u.bbox.height : 0);
						const zero = pixel(u, 3, 'y'), nonzero = pixel(u, 8, 'y');
						assert.deepEqual(align == -1 ? vertices.slice(0, 2) : vertices.slice(-2),
							(align == -1 ? [edge, transition] : [transition, edge]).map(y => [zero, y]));
						assert.ok(vertices.some(([x, y]) => x == nonzero && y == transition), 'the endpoint retains its cross-axis transition');
						assert.deepEqual(commands(p.fill, 'lineTo').slice(-2), [
							[pixel(u, 0, 'y'), align == 1 ? edge : last],
							[pixel(u, 0, 'y'), align == -1 ? edge : first],
						], 'fill closure uses the same oriented extension bounds');
						const unextended = uPlot.paths.stepped({ align, extend: false })(u, 2, 0, 2);
						const unextendedVertices = commands(unextended.stroke, 'lineTo');
						assert.equal(unextendedVertices[0][1], first);
						assert.equal(unextendedVertices.at(-1)[1], last);
						assert.notDeepEqual(unextended.stroke.log, p.stroke.log, 'extend adds the endpoint plateau, not a clip');
					});
				}
			});
		}
	}
});
