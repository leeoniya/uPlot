// Node: node scripts/bench-heatmap-flatbush.mjs
// Browser: import { runBenchmark } from './scripts/bench-heatmap-flatbush.mjs';
// Serve this module and ../demos/lib/flatbush.js; importing does not run or post results.
import Flatbush from '../demos/lib/flatbush.js';

const NUM_ITEMS = 250_000;
const NODE_SIZE = 16;
const X_RUNS = 1000;
const ROWS_PER_RUN = 250;
const Y_BUCKETS = 1024;
const SEED = 0x51f15e;
const EPSILON = 2 ** -20;
const TYPES = [Float64Array, Float32Array];

function assert(condition, message) {
	if (!condition)
		throw new Error(message);
}

function random(seed) {
	return () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function treeMemory() {
	const levels = [NUM_ITEMS];
	do {
		levels.push(Math.ceil(levels[levels.length - 1] / NODE_SIZE));
	} while (levels[levels.length - 1] > 1);
	const nodes = levels.reduce((a, b) => a + b, 0);
	const indicesBytes = nodes * (nodes < 16384 ? 2 : 4);
	const hilbertBytes = NUM_ITEMS * Int32Array.BYTES_PER_ELEMENT;
	const byType = Object.fromEntries(TYPES.map(Type => {
		const boxesBytes = nodes * 4 * Type.BYTES_PER_ELEMENT;
		return [Type.name, { boxesBytes, indicesBytes, hilbertBytes,
			constructorBytes: boxesBytes + indicesBytes,
			afterFirstFinishBytes: boxesBytes + indicesBytes + hilbertBytes }];
	}));
	const savedBytes = byType.Float64Array.afterFirstFinishBytes - byType.Float32Array.afterFirstFinishBytes;
	return { levels, nodes, byType, savedBytes,
		savedPercentAfterFinish: savedBytes / byType.Float64Array.afterFirstFinishBytes * 100,
		method: 'Calculated from Flatbush tree shape, including retained Hilbert scratch; not a heap measurement.' };
}

function projectCase(dpr, zoomed) {
	const half = v => Math.round(v * 2) / 2;
	// calcPlotDim rounds both offsets and dimensions to 0.5 canvas pixels.
	const bbox = { left: half(53.25 * dpr), top: half(17.25 * dpr),
		width: half(959.25 * dpr), height: half(479.25 * dpr) };
	const xRange = zoomed ? [250.25, 750.75] : [0, X_RUNS];
	const yRange = zoomed ? [192.25, 832.75] : [0, Y_BUCKETS];
	const project = (value, range, offset, size, reverse) => {
		const fraction = (value - range[0]) / (range[1] - range[0]);
		return Math.max(0, Math.min(size, Math.round(offset + (reverse ? 1 - fraction : fraction) * size) - offset));
	};
	const xs = Float64Array.from({ length: X_RUNS + 1 }, (_, i) => project(i, xRange, bbox.left, bbox.width, false));
	const ys = Float64Array.from({ length: Y_BUCKETS + 1 }, (_, i) => project(i, yRange, bbox.top, bbox.height, true));
	const bounds = new Float64Array(NUM_ITEMS * 4);
	const visibleIds = [];
	const rand = random(SEED);
	let offscreen = 0, zeroPixel = 0, clipped = 0, halfIntegerCoordinates = 0;
	let fingerprint = 2166136261;
	for (let id = 0; id < NUM_ITEMS; id++) {
		const run = Math.floor(id / ROWS_PER_RUN);
		// One selected bucket per group of four: sorted, sparse, non-overlapping Y.
		const bucket = id % ROWS_PER_RUN * 4 + Math.floor(rand() * 4);
		const x0 = xs[run], x1 = xs[run + 1];
		const y0 = ys[bucket + 1], y1 = ys[bucket];
		const outside = run + 1 <= xRange[0] || run >= xRange[1] || bucket + 1 <= yRange[0] || bucket >= yRange[1];
		if (x1 > x0 && y1 > y0) {
			bounds.set([x0, y0, x1, y1], id * 4);
			visibleIds.push(id);
			if (run < xRange[0] || run + 1 > xRange[1] || bucket < yRange[0] || bucket + 1 > yRange[1])
				clipped++;
		}
		else if (outside)
			offscreen++;
		else
			zeroPixel++;
		// Invalid cells retain four zeros, preserving every source row ID.
		for (let j = 0; j < 4; j++) {
			const value = bounds[id * 4 + j];
			assert(Number.isInteger(value * 2) && Math.fround(value) === value, 'Non-exact projected coordinate');
			if (!Number.isInteger(value)) halfIntegerCoordinates++;
			fingerprint = Math.imul(fingerprint ^ (value * 2), 16777619) >>> 0;
		}
	}
	assert(visibleIds.length > 0 && zeroPixel + offscreen > 0, 'Fixture must contain cells and placeholders');
	return { bounds, visibleIds, metadata: {
		name: `dpr-${dpr}${zoomed ? '-zoomed-clipped' : '-full'}`, dpr, zoomed, bbox, xRange, yRange,
		visible: visibleIds.length, placeholders: zeroPixel + offscreen, offscreen, zeroPixel, clipped,
		halfIntegerCoordinates, boundsFingerprint: fingerprint.toString(16).padStart(8, '0'),
	} };
}

function resetAdd(index, bounds) {
	index.reset();
	for (let p = 0; p < bounds.length; p += 4)
		index.add(bounds[p], bounds[p + 1], bounds[p + 2], bounds[p + 3]);
}

function hoverState(index) {
	const state = { index, results: [], scratch: [], hit: -1, x0: 0, y0: 0, x1: 0, y1: 0 };
	state.filter = (id, x0, y0, x1, y1) => {
		// Match heatmapPlugin: reject placeholders and prefer the later source ID.
		if (x1 > x0 && y1 > y0 && id > state.hit) {
			state.hit = id;
			state.x0 = x0; state.y0 = y0; state.x1 = x1; state.y1 = y1;
		}
		return false;
	};
	return state;
}

function hoverBatch(state, points, passes) {
	let checksum = 0;
	for (let pass = 0; pass < passes; pass++) {
		for (let p = 0; p < points.length; p += 2) {
			state.hit = -1;
			const x = points[p], y = points[p + 1];
			state.index.search(x, y, x, y, state.filter, state.results, state.scratch);
			checksum += state.hit + 1;
			if (state.hit >= 0)
				checksum += state.x0 + state.y0 + state.x1 + state.y1;
		}
	}
	return checksum;
}

function hoverPoints(fixture, count) {
	const { bounds, visibleIds, metadata: { bbox } } = fixture;
	const rand = random(SEED ^ 0xabcdef);
	const points = new Float64Array(count * 2);
	// Alternate guaranteed cell centers and uniform plot points (hits or misses).
	for (let p = 0; p < points.length; p += 2) {
		if (p % 4 === 0) {
			const id = visibleIds[Math.floor(rand() * visibleIds.length)] * 4;
			points[p] = (bounds[id] + bounds[id + 2]) / 2;
			points[p + 1] = (bounds[id + 1] + bounds[id + 3]) / 2;
		}
		else {
			points[p] = (0.0001 + rand() * 0.9998) * bbox.width;
			points[p + 1] = (0.0001 + rand() * 0.9998) * bbox.height;
		}
	}
	return points;
}

function validationPoints({ bounds, visibleIds, metadata: { bbox } }) {
	const probes = [];
	const add = (kind, x, y) => probes.push({ kind, x, y });
	const selected = new Set();
	for (let i = 0; i < 8; i++)
		selected.add(visibleIds[Math.floor(i * (visibleIds.length - 1) / 7)]);
	// Include cells on each clamped plot edge, when present.
	for (let side = 0; side < 4; side++) {
		const edge = [0, 0, bbox.width, bbox.height][side];
		const id = visibleIds.find(id => bounds[id * 4 + side] === edge);
		if (id !== undefined) selected.add(id);
	}
	for (const id of selected) {
		const p = id * 4;
		const [x0, y0, x1, y1] = bounds.subarray(p, p + 4);
		const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
		add('center', cx, cy);
		for (const delta of [0, EPSILON, -EPSILON]) {
			const kind = delta === 0 ? 'edge' : delta > 0 ? 'just-inside' : 'just-outside';
			add(kind, x0 + delta, cy); add(kind, x1 - delta, cy);
			add(kind, cx, y0 + delta); add(kind, cx, y1 - delta);
		}
		for (const x of [x0, x1])
			for (const y of [y0, y1]) add('corner', x, y);
	}
	for (const x of [-EPSILON, 0, EPSILON])
		for (const y of [-EPSILON, 0, EPSILON]) add('placeholder-origin', x, y);
	return probes;
}

function validate(fixture, states) {
	const { bounds } = fixture;
	let callbackChecks = 0;
	const checkBounds = (id, x0, y0, x1, y1) => {
		assert(Number.isInteger(id) && id >= 0 && id < NUM_ITEMS, `Invalid source ID ${id}`);
		const p = id * 4;
		assert(x0 === bounds[p] && y0 === bounds[p + 1] && x1 === bounds[p + 2] && y1 === bounds[p + 3], `Stored bounds differ for source ID ${id}`);
		callbackChecks++;
	};
	// Check every stored leaf, not just those reached by the point probes.
	for (const state of states) {
		const seen = new Uint8Array(NUM_ITEMS);
		state.index.search(-Infinity, -Infinity, Infinity, Infinity, (id, x0, y0, x1, y1) => {
			checkBounds(id, x0, y0, x1, y1);
			assert(seen[id] === 0, `Duplicate source ID ${id}`);
			seen[id] = 1;
			return false;
		}, state.results, state.scratch);
		assert(seen.every(value => value === 1), 'Missing stored source IDs');
	}
	const probes = validationPoints(fixture);
	const kinds = {};
	let originPlaceholders = 0;
	for (const { kind, x, y } of probes) {
		kinds[kind] = (kinds[kind] ?? 0) + 1;
		const expected = [];
		let expectedHit = -1;
		for (let id = 0, p = 0; id < NUM_ITEMS; id++, p += 4) {
			if (bounds[p] <= x && bounds[p + 1] <= y && bounds[p + 2] >= x && bounds[p + 3] >= y) {
				expected.push(id);
				if (bounds[p + 2] > bounds[p] && bounds[p + 3] > bounds[p + 1])
					expectedHit = id;
				else if (kind === 'placeholder-origin' && x === 0 && y === 0)
					originPlaceholders++;
			}
		}
		for (const state of states) {
			const result = state.index.search(x, y, x, y, (id, x0, y0, x1, y1) => {
				checkBounds(id, x0, y0, x1, y1);
				return true;
			}, state.results, state.scratch);
			assert(result === state.results, 'Search did not reuse results');
			result.sort((a, b) => a - b);
			assert(result.length === expected.length && result.every((id, i) => id === expected[i]), `Source hits differ at ${kind} (${x}, ${y})`);
			state.hit = -1;
			state.index.search(x, y, x, y, state.filter, state.results, state.scratch);
			assert(state.hit === expectedHit, `Hover winner differs at ${kind}`);
			if (state.hit >= 0)
				checkBounds(state.hit, state.x0, state.y0, state.x1, state.y1);
			assert(state.results.length === 0 && state.scratch.length === 0, 'Reusable arrays not cleared');
		}
	}
	assert(originPlaceholders === fixture.metadata.placeholders, 'Origin placeholder count differs');
	return { passed: true, allStoredLeavesCheckedPerType: NUM_ITEMS, pointProbes: probes.length,
		probeKinds: kinds, callbackChecks, originPlaceholders, epsilonCanvasPixels: EPSILON,
		oracle: 'Brute-force inclusive source intersections, exact callback bounds, highest non-placeholder source ID; both storage types.' };
}

export function runBenchmark({ samples = 7, warmups = 3, addPasses = 8, queryCount = 2048, queryPasses = 4 } = {}) {
	for (const [name, value, min, max] of [['samples', samples, 3, 20], ['warmups', warmups, 2, 10],
		['addPasses', addPasses, 1, 32], ['queryCount', queryCount, 32, 8192], ['queryPasses', queryPasses, 1, 16]])
		assert(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer in [${min}, ${max}]`);
	const start = performance.now();
	const cases = [];
	for (const [caseNumber, [dpr, zoomed]] of [[1, false], [1.25, false], [2, false], [1.25, true]].entries()) {
		const fixture = projectCase(dpr, zoomed);
		const points = hoverPoints(fixture, queryCount);
		const states = TYPES.map(Type => hoverState(new Flatbush(NUM_ITEMS, NODE_SIZE, Type)));
		const rows = [];
		// Constructors, first finish's Hilbert allocation, and JIT warmup are untimed.
		for (let round = 0; round < warmups; round++) {
			const order = (round + caseNumber) % 2 ? [1, 0] : [0, 1];
			for (const i of order) {
				resetAdd(states[i].index, fixture.bounds);
				states[i].index.finish();
				hoverBatch(states[i], points, queryPasses);
			}
		}
		for (let round = 0; round < samples; round++) {
			const order = (round + caseNumber) % 2 ? [1, 0] : [0, 1];
			for (let position = 0; position < order.length; position++) {
				const i = order[position], state = states[i];
				const t0 = performance.now();
				for (let pass = 0; pass < addPasses; pass++)
					resetAdd(state.index, fixture.bounds);
				const t1 = performance.now();
				state.index.finish();
				const t2 = performance.now();
				const checksum = hoverBatch(state, points, queryPasses);
				const t3 = performance.now();
				rows.push({ round, position, type: TYPES[i].name, resetAddMs: (t1 - t0) / addPasses,
					finishMs: t2 - t1, hoverBatchMs: t3 - t2, checksum });
			}
		}
		assert(rows.every(row => row.checksum === rows[0].checksum), 'Hover checksums differ');
		const measurements = Object.fromEntries(TYPES.map(Type => {
			const raw = rows.filter(row => row.type === Type.name);
			const resetAddMs = median(raw.map(row => row.resetAddMs));
			const finishMs = median(raw.map(row => row.finishMs));
			const hoverBatchMs = median(raw.map(row => row.hoverBatchMs));
			return [Type.name, { median: { resetAddMs, finishMs,
				buildMs: median(raw.map(row => row.resetAddMs + row.finishMs)), hoverBatchMs,
				hoverNsPerQuery: hoverBatchMs * 1e6 / (queryCount * queryPasses) } }];
		}));
		const ratio = Object.fromEntries(Object.keys(measurements.Float64Array.median).map(key =>
			[key, measurements.Float32Array.median[key] / measurements.Float64Array.median[key]]));
		cases.push({ ...fixture.metadata, measurements, float32OverFloat64: ratio, rawSamples: rows,
			validation: validate(fixture, states) });
	}
	const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && !!process.versions?.node;
	return {
		benchmark: 'heatmap-flatbush-storage', schemaVersion: 1,
		environment: isNode ? { runtime: 'Node', node: process.versions.node, v8: process.versions.v8,
			platform: process.platform, arch: process.arch } : { runtime: 'browser', userAgent: globalThis.navigator?.userAgent ?? null },
		config: { numItems: NUM_ITEMS, nodeSize: NODE_SIZE, xRuns: X_RUNS, rowsPerRun: ROWS_PER_RUN,
			yBuckets: Y_BUCKETS, seed: SEED, samples, warmups, addPasses, queryCount, queryPasses,
			queriesPerSample: queryCount * queryPasses },
		method: {
			coordinates: 'Sorted X runs; one seeded Y bucket per group of four. Round absolute canvas edges, subtract half-pixel bbox offsets, clamp; invalid cells become (0,0,0,0).',
			resetAdd: 'Pointer-outside index work only: batch addPasses reset/add rebuilds per timed phase to reduce timer-granularity effects. Raw resetAddMs is elapsed batch time divided by addPasses. Projection and drawing are excluded.',
			finish: 'Finish only the final rebuild in each batch, measured separately with retained Hilbert scratch.',
			build: 'buildMs is the median of normalized per-rebuild resetAddMs plus finishMs for each sample.',
			warmup: 'One reset/add, one finish, and one hover batch per type per warmup round, regardless of addPasses.',
			hover: 'Warmed point searches with reusable results/scratch and plugin-style callback; half cell centers, half uniform plot points. Batch includes loop, winner bounds and checksum.',
			order: 'Alternate storage type first on each paired round and each case; raw samples record execution order.',
			validation: 'Outside timing, after measured rebuilds; compare each type with the same source oracle, not only with each other.',
		},
		memory: treeMemory(), cases, elapsedMs: performance.now() - start,
		limitations: [
			'Synthetic fixed source and linear projections, not a captured application workload. DPR cases simulate coordinates without a canvas.',
			'No plugin, DOM, Path2D, paint, projection, first allocation, or first-finish latency is timed; reset/add is not total draw time.',
			'Float32 exactness here follows from bounded integer/half-integer coordinates (all below 2^23). It does not establish safety for unrounded data coordinates or huge canvases.',
			'Every stored leaf is checked, but point intersections are sampled at centers, edges, corners, nearby points and the origin; not exhaustive over all possible queries.',
			'Timed hover excludes the exact origin where placeholders accumulate; origin correctness is validated, but its pathological query cost is not represented.',
			'Buffer totals exclude JS objects/arrays, benchmark fixtures, allocator overhead and GC. Timing includes incidental GC, JIT, scheduling and timer noise; no forced GC.',
			'Fixed warmup and a small sample count do not prove JIT convergence or statistical significance. Node results do not predict Firefox performance.',
		],
	};
}

if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node && process.argv[1]) {
	const { pathToFileURL } = await import('node:url');
	if (import.meta.url === pathToFileURL(process.argv[1]).href)
		console.log(JSON.stringify(runBenchmark(), null, 2));
}
