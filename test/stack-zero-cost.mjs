import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

// Preserve HEAD's drawSeries scheduler as an in-memory reference with no stroke mapping.
// Builders and paint helpers stay shared. Absolute budgets also catch common-path overhead.
const baselineDrawSeries = `
	function drawSeries() {
		if (dataLen > 0) {
			let shouldAlpha = series.some(s => s._focus) && ctxAlpha != focus.alpha;

			if (shouldAlpha)
				ctx.globalAlpha = ctxAlpha = focus.alpha;

			series.forEach((s, i) => {
				if (i > 0 && s.show) {
					FEAT_PATHS && cacheStrokeFill(i, false);
					FEAT_POINTS && cacheStrokeFill(i, true);

					if (s._paths == null) {
						let _ctxAlpha = ctxAlpha;

						if (ctxAlpha != s.alpha)
							ctx.globalAlpha = ctxAlpha = s.alpha;

						let _idxs = mode == 2 ? [0, data[i][0].length - 1] : getOuterIdxs(data[i]);
						s._paths = s.paths(self, i, _idxs[0], _idxs[1]);

						if (ctxAlpha != _ctxAlpha)
							ctx.globalAlpha = ctxAlpha = _ctxAlpha;
					}
				}
			});

			if (bandGroupsDirty) {
				bandEnds.length = firstBand.length = bands.length > 0 ? series.length : 0;
				bandEnds.fill(0);
				firstBand.fill(-1);
				nextBand.length = bandHasData.length = bands.length;
				bandHasData.fill(false);

				for (let bi = bands.length - 1; bi >= 0; bi--) {
					let b = bands[bi];
					let si = b.series[0];
					nextBand[bi] = firstBand[si];
					firstBand[si] = bi;

					let to = b.series[1] ?? si;
					let lo = min(si, to);
					let hi = max(si, to);
					bandEnds[lo] = max(bandEnds[lo], hi);
				}

				for (let i = 1; i < bandEnds.length; i++) {
					let end = bandEnds[i];

					if (end > 0) {
						for (let j = i + 1; j <= end; j++)
							end = max(end, bandEnds[j]);

						bandEnds[i] = end;
						i = end;
					}
				}

				bandGroupsDirty = false;
			}

			for (let pass = 0; pass < 2; pass++) {
				for (let i = 1; i < series.length; i++) {
					let end = bandEnds[i] || i;
					let focused = false;

					for (let j = i; j <= end && !focused; j++)
						focused = series[j].show && !!series[j]._focus;

					if (focused == (pass == 1)) {
						if (bandEnds[i] > 0) {
							for (let j = i; j <= end; j++)
								drawSeriesPart(j, BAND_CLIP_FILL, false);
							for (let j = i; j <= end; j++)
								drawSeriesPart(j, BAND_CLIP_STROKE, false);
							for (let j = i; j <= end; j++)
								drawSeriesPart(j, 0, true);
						}
						else
							drawSeriesPart(i, CLIP_FILL_STROKE, true);
					}

					i = end;
				}
			}

			if (shouldAlpha)
				ctx.globalAlpha = ctxAlpha = 1;
		}
	}
`;

async function referenceRenderer() {
	const url = new URL('../src/uPlot.js', import.meta.url);
	let source = readFileSync(url, 'utf8');
	const start = '\tfunction drawSeries() {';
	const end = '\tfunction drawSeriesPart(';
	for (const anchor of [start, end])
		assert.equal(source.split(anchor).length, 2, 'one renderer override anchor: ' + anchor);
	assert.ok(source.indexOf(end) > source.indexOf(start));
	source = source.slice(0, source.indexOf(start)) + baselineDrawSeries + '\n' + source.slice(source.indexOf(end));
	source = source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
		(_, quote, path) => 'from ' + JSON.stringify(new URL(path, url).href));
	return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
}

const ReferencePlot = await referenceRenderer();
const builders = [
	{ name: 'linear', paths: uPlot.paths.linear() },
	{ name: 'spline', paths: uPlot.paths.spline() },
	{ name: 'step-before', paths: uPlot.paths.stepped({ align: -1 }) },
	{ name: 'step-after', paths: uPlot.paths.stepped({ align: 1 }) },
];
const phases = () => ({ beforeDraw: 0, build: 0, draw: 0 });
const numericKey = key => typeof key == 'string' && /^(0|[1-9]\d*)$/.test(key);

function normalized(value) {
	if (Array.isArray(value))
		return value.map(normalized);
	if (value instanceof Map)
		return [...value].map(normalized);
	if (value?.log != null)
		return ['Path2D', normalized(value.log)];
	return value;
}
const geometry = f => f.u.series.slice(1).map(s => ['stroke', 'fill', 'clip', 'band'].map(key => normalized(s._paths?.[key])));

// The mock batches consecutive operations, including across redraws.
function observeCanvas(ctx, record) {
	function observeEntry(entry) {
		Object.defineProperty(entry, 'push', {
			configurable: true,
			value(...values) {
				values.forEach(value => record(entry[0], value));
				return Array.prototype.push.apply(this, values);
			},
		});
	}
	if (ctx.log.length > 0)
		observeEntry(ctx.log.at(-1));
	ctx.log.push = function(...entries) {
		for (const entry of entries) {
			entry.slice(1).forEach(value => record(entry[0], value));
			observeEntry(entry);
		}
		return Array.prototype.push.apply(this, entries);
	};
}

function makeFixture({
	raw = [5, 0, -0, 5], xs = raw.map((_, i) => i),
	xRange = [xs[0] ?? 0, xs.at(-1) || 1], paths = builders[0].paths,
	stacked = true, dir = 1, order = [1, 2], bands = [], Plot = uPlot, show = true,
	width = 400, strokeWidth = 2, stroke = 'blue', pxRatio = 1, spanGaps = false, decorate,
} = {}) {
	const f = { active: null, phase: 'beforeDraw', raw: raw.slice() };
	function tracked(values, si) {
		return new Proxy(values, {
			get(target, key, receiver) {
				if (f.active != null && numericKey(key))
					f.active.reads[si][f.phase]++;
				return Reflect.get(target, key, receiver);
			},
		});
	}
	function build(u, si, i0, i1) {
		const previousPhase = f.phase;
		f.phase = 'build';
		try {
			const p = paths(u, si, i0, i1);
			f.active?.builds.push({ si, i0, i1, path: p });
			if (p != null && si == 2)
				decorate?.(p);
			return p;
		}
		finally { f.phase = previousPhase; }
	}
	f.u = new Plot({
		width, height: 240, pxRatio, padding: [0, 0, 0, 0], axes: [{ show: false }, { show: false }],
		cursor: { show: false }, legend: { show: false },
		stack: stacked ? { groups: [{ series: order, dir }] } : undefined,
		bands,
		scales: { x: { time: false, range: xRange }, y: { range: [-12, 12] } },
		series: [{}, {
			paths: build, width: 2, stroke: 'red', fill: 'silver', points: { show: false },
		}, {
			paths: build, show, spanGaps, width: strokeWidth, stroke, fill: 'silver', points: { show: false },
		}],
		hooks: {
			init: [u => observeCanvas(u.ctx, (name, value) => f.active?.ops.push([name, value]))],
			drawClear: [() => { f.phase = 'draw'; }],
			drawSeries: [(u, si) => f.active?.hooks.push(si)],
		},
	}, [xs.slice(), tracked(raw.map(() => dir == -1 ? -3 : 3), 1), tracked(f.raw, 2)], document.body);
	return f;
}

async function withPair(options, check, referenceOptions = { Plot: ReferencePlot }) {
	const actual = makeFixture(options);
	let reference;
	try {
		await Promise.resolve();
		reference = makeFixture({ ...options, ...referenceOptions });
		await Promise.resolve();
		await check(actual, reference);
	}
	finally {
		reference?.u.destroy();
		actual.u.destroy();
	}
}

// Never measure concurrently: Path2D is global in the instrumented DOM.
async function measure(f, rebuild = false, action = () => f.u.redraw(rebuild)) {
	const m = { reads: [null, phases(), phases()], allocations: phases(), builds: [], ops: [], hooks: [] };
	const Path = globalThis.Path2D;
	f.active = m;
	f.phase = 'beforeDraw';
	globalThis.Path2D = new Proxy(Path, {
		construct(target, args, newTarget) {
			m.allocations[f.phase]++;
			return Reflect.construct(target, args, newTarget);
		},
	});
	try {
		action();
		await Promise.resolve();
		return m;
	}
	finally {
		globalThis.Path2D = Path;
		f.active = null;
	}
}

const totalReads = m => m.reads.slice(1).reduce((sum, counts) => sum + Object.values(counts).reduce((a, b) => a + b, 0), 0);
const operations = m => normalized(m.ops);
function operationTotals(m) {
	const totals = {};
	for (const [name] of m.ops)
		totals[name] = (totals[name] ?? 0) + 1;
	return totals;
}
function paintOrder(f, m, kind) {
	return m.ops.filter(([name]) => name == kind).map(([, [path]]) => {
		const si = f.u.series.findIndex(s => s._paths?.[kind] === path);
		assert.ok(si > 0, 'each paint uses the original series path');
		return si;
	});
}
function assertSameCost(actual, reference) {
	assert.deepEqual(actual.reads, reference.reads, 'no additional raw sample reads in any phase');
	assert.deepEqual(actual.allocations, reference.allocations, 'no additional Path2D allocations in any phase');
	assert.deepEqual(operationTotals(actual), operationTotals(reference), 'all canvas operation totals match, including styles and clips');
	assert.deepEqual(actual.hooks, reference.hooks, 'drawSeries hooks keep their order');
}
function assertNoZeroMetadata(f) {
	for (const s of f.u.series.slice(1)) {
		assert.ok(!Object.hasOwn(s, '_hasZero'), 'series need no zero flags');
		for (const key of ['clipStroke', '_zero', '_zeroWidth'])
			assert.ok(s._paths == null || !Object.hasOwn(s._paths, key), 'paths need no ' + key);
	}
}
function assertOrdinaryBudget(m, grouped = true, targetStroke = true, extraOps = {}) {
	const saves = grouped ? (targetStroke ? 4 : 3) : 2;
	assert.equal(m.allocations.beforeDraw, 0);
	assert.equal(m.allocations.build, m.builds.length == 0 ? 0 : grouped ? 5 : 4,
		'only stroke/fill pairs and the ordinary lower band edge allocate');
	assert.equal(m.allocations.draw, saves, 'only ordinary bounds clips allocate during drawing');
	assert.deepEqual(operationTotals(m), {
		clearRect: 1, save: saves, restore: saves, clip: saves + (grouped ? 1 : 0),
		fill: 2, stroke: targetStroke ? 2 : 1,
		...(targetStroke ? { strokeStyle: 2 } : {}), ...extraOps,
	}, 'the complete canvas operation budget has no extra calls or style writes');
}
async function assertCached(a, r, sameOrder = false, rawReads = 0) {
	const cached = a.u.series.slice(1).map(s => [s._paths, s._paths?.stroke, s._paths?.fill]);
	const am = await measure(a), rm = await measure(r);
	for (const [i, paths] of cached.entries()) {
		const s = a.u.series[i + 1];
		assert.equal(s._paths, paths[0]);
		assert.equal(s._paths?.stroke, paths[1]);
		assert.equal(s._paths?.fill, paths[2]);
	}
	assert.ok(am.builds.every(({ si }) => cached[si - 1][0] == null), 'cached non-null paths never rerun builders');
	assert.deepEqual(am.builds.map(({ si }) => si), rm.builds.map(({ si }) => si),
		'null-path retries match the reference count and series');
	assert.equal(totalReads(am), rawReads, 'cached redraw has only ordinary band-data checks, not zero scans');
	assertSameCost(am, rm);
	if (sameOrder)
		assert.deepEqual(operations(am), operations(rm), 'cached canvas operations stay identical');
	assertNoZeroMetadata(a);
	return am;
}

// Explicit serial execution protects the temporary global constructor wrapper.
describe('stack reverse stroke order cost', { concurrency: false }, () => {
	for (const { name, paths } of builders) {
		for (const dir of [-1, 1]) {
			for (const size of [8, 1024]) {
				it(`${name}: dir=${dir}, ${size} zero-bearing samples match the unmapped reference`, async () => {
					const raw = Array.from({ length: size }, (_, i) => i % 8 == 0 || i % 8 == 7 ? 5 * dir : i % 2 ? 0 : -0);
					await withPair({ paths, dir, raw, width: 100 }, async (a, r) => {
						const am = await measure(a, true), rm = await measure(r, true);
						assert.equal(am.builds.length, 2);
						assert.equal(totalReads(am), 0, 'neither builders nor strokes scan raw stacked data');
						assertSameCost(am, rm);
						assertOrdinaryBudget(am);
						assert.deepEqual(geometry(a), geometry(r), 'stroke mapping does not change native paths');
						assert.deepEqual(paintOrder(a, am, 'fill'), [1, 2]);
						assert.deepEqual(paintOrder(a, am, 'stroke'), [2, 1]);
						assert.deepEqual(paintOrder(r, rm, 'stroke'), [1, 2], 'the reference has no stroke mapping');
						assertOrdinaryBudget(await assertCached(a, r));
					});
				});

				it(`${name}: dir=${dir}, ${size} zeros cost the same as nonzeros with identical pixel geometry`, async () => {
					const raw = Array(size).fill(0);
					await withPair({ paths, dir, raw, width: 100 }, async (a, r) => {
						assert.ok(r.raw.every(value => value !== 0));
						assert.deepEqual(geometry(a), geometry(r), 'tiny nonzeros round to the same native geometry');
						for (const rebuild of [true, false]) {
							const am = await measure(a, rebuild), rm = await measure(r, rebuild);
							assert.equal(totalReads(am), 0);
							assertSameCost(am, rm);
							assertOrdinaryBudget(am);
							assert.deepEqual(operations(am), operations(rm), 'zeros add no canvas operations or geometry');
						}
						assertNoZeroMetadata(a);
					}, { raw: raw.map(() => dir * 1e-8) });
				});
			}
		}

		for (const grouped of [false, true]) {
			it(`${name}: ${grouped ? 'explicit bands' : 'plain series'} match baseline operations exactly`, async () => {
				await withPair({ paths, stacked: false, bands: grouped ? [{ series: [2, 1], dir: -1 }] : [] }, async (a, r) => {
					const am = await measure(a, true), rm = await measure(r, true);
					assert.ok(am.reads[2].build > 0, 'unstacked builders read their raw geometry');
					assertSameCost(am, rm);
					assertOrdinaryBudget(am, grouped);
					assert.deepEqual(operations(am), operations(rm), 'no change to paint order, geometry, clips, or styles');
					assert.deepEqual(paintOrder(a, am, 'stroke'), [1, 2]);
					assertOrdinaryBudget(await assertCached(a, r, true, grouped ? 1 : 0), grouped);
				});
			});
		}

		for (const variant of [
			{ name: 'zero width', strokeWidth: 0 },
			{ name: 'rounded zero width', strokeWidth: 0.0002 },
			{ name: 'null stroke', stroke: null },
			{ name: 'custom zero width', decorate: p => { p._width = 0; } },
			{ name: 'custom null stroke', decorate: p => { p._stroke = null; } },
			{ name: 'empty stroke Map', decorate: p => { p.stroke = new Map(); } },
		]) {
			it(`${name}: ${variant.name} adds no zero work`, async () => {
				await withPair({ paths, ...variant }, async (a, r) => {
					const am = await measure(a, true), rm = await measure(r, true);
					assert.equal(totalReads(am), 0);
					assertSameCost(am, rm);
					assertOrdinaryBudget(am, true, false);
					assertOrdinaryBudget(await assertCached(a, r), true, false);
				});
			});
		}

		for (const variant of [
			{ name: 'null and undefined gaps', raw: [5, 0, null, undefined, -0, 5] },
			{ name: 'spanned gaps', raw: [5, 0, null, undefined, -0, 5], spanGaps: true },
			{ name: 'padded viewport', raw: Array(1024).fill(0), xRange: [500, 504] },
			{ name: 'hidden series', show: false },
			{ name: 'empty data', raw: [] },
			{ name: 'all-nullish data', raw: [null, undefined, null, undefined] },
			{ name: 'reverse declaration', order: [2, 1] },
			{ name: 'stroke Map', decorate: p => { p.stroke = new Map([['blue', p.stroke]]); } },
		]) {
			it(`${name}: ${variant.name} matches reference costs`, async () => {
				await withPair({ paths, ...variant }, async (a, r) => {
					const am = await measure(a, true), rm = await measure(r, true);
					assert.equal(totalReads(am), 0);
					assertSameCost(am, rm);
					assert.deepEqual(geometry(a), geometry(r));
					await assertCached(a, r);
				});
			});
		}

		it(`${name}: cached width and color changes need no zero scans or new geometry`, async () => {
			await withPair({ paths }, async (a, r) => {
				const cached = a.u.series[2]._paths;
				const original = geometry(a);
				for (const [width, color] of [[0, null], [1, 'green'], [7, 'blue'], [2, 'blue']]) {
					for (const f of [a, r]) {
						f.u.series[2].width = width;
						f.u.series[2].stroke = () => color;
					}
					// Warm each paint order's style cache before comparing steady-state costs.
					const changed = await measure(a), reference = await measure(r);
					assert.equal(totalReads(changed), 0);
					assert.equal(changed.builds.length, 0);
					assert.deepEqual(changed.allocations, reference.allocations);
					assert.equal(operationTotals(changed).clip, operationTotals(reference).clip);
					assertOrdinaryBudget(await assertCached(a, r), true, width > 0,
											width == 1 || width == 7 ? { lineWidth: 2, translate: 4 } : {});
					assert.equal(a.u.series[2]._paths, cached);
					assert.deepEqual(geometry(a), original);
				}
			});
		});
	}

	for (const dir of [-1, 0, 1]) {
		for (const size of [8, 1024]) {
			it(`stackData dir=${dir}, ${size} samples: one accumulation pass and no zero scan`, async () => {
				const paths = dir == 0 ? uPlot.paths.bars() : builders[0].paths;
				const raw = Array.from({ length: size }, (_, i) => dir == 0 && i % 2 ? -5 : 5 * (dir || 1));
					await withPair({ dir, paths, raw, width: 100 }, async (a, r) => {
					for (const zeros of [true, false]) {
						for (const f of [a, r]) {
							for (let i = 0; i < size; i++)
								f.raw[i] = raw[i];
							if (zeros) {
								f.raw.fill(0, 1, size - 1);
								f.raw[2] = -0;
							}
						}
						const update = f => measure(f, false, () => { f.u.setData(f.u.data, false); f.u.redraw(false); });
						const am = await update(a), rm = await update(r);
						for (const si of [1, 2])
							assert.deepEqual(am.reads[si], { beforeDraw: size, build: 0, draw: 0 }, 'one raw read per sample during accumulation only');
						assert.equal(totalReads(am), 2 * size);
						assert.equal(am.builds.length, 2);
						assertSameCost(am, rm);
						assertNoZeroMetadata(a);
						if (dir == 0) {
							assert.deepEqual(a.u.bands, []);
							assert.deepEqual(operations(am), operations(rm), 'mixed bars keep the baseline paint order and operations');
						}
						await assertCached(a, r, dir == 0);
					}
				});
			});
		}
	}
});
