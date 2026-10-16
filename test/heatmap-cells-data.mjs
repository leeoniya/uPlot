import assert from 'node:assert/strict';
import { generateHeatmapCells } from '../demos/lib/heatmapCellsData.js';
import { readCells, gridShape } from '../demos/heatmap-cells-compare.js';

const defaults = {seed: 1, columns: 2569, interval: 1200000, start: Date.UTC(2026, 7, 20, 10, 20), xGapProbability: 0};
const edges = Array.from({length: 170}, (_, i) => 2 ** ((i - 139) / 8));
const bands = {
	micro: [10e-6, 25e-6],
	main: [0.004, 0.012],
	hundred: [0.06, 0.15],
	mid: [0.2, 0.45],
	slow: [1, 2],
	fast: [0.0004, 0.001],
	two: [0.0013, 0.003],
	quiet: [0.0001, 0.0004],
	tail: [2, Infinity],
	high: [6, Infinity],
};
const persistent = ['micro', 'main', 'hundred', 'mid', 'slow'];

function between(value, min, max, label) {
	assert.ok(value >= min && value <= max, `${label}: ${value} outside [${min}, ${max}]`);
}

function quantile(sorted, p) {
	return sorted[Math.round(p * (sorted.length - 1))];
}

function objectRefs(value, refs = new Set()) {
	if (value !== null && typeof value == 'object' && !refs.has(value)) {
		refs.add(value);
		for (const child of Object.values(value))
			objectRefs(child, refs);
	}
	return refs;
}

function validate(frames, options = {}) {
	const {seed, columns, interval, start, xGapProbability} = {...defaults, ...options};
	assert.ok(Array.isArray(frames));
	assert.equal(frames.length, 1);
	const {schema, data} = frames[0];
	assert.equal(schema.refId, 'A');
	assert.equal(schema.meta.type, 'heatmap-cells');
	assert.deepEqual(schema.meta.typeVersion, [0, 0]);
	assert.equal(schema.meta.custom.synthetic, true);
	assert.equal(schema.meta.custom.seed, seed);
	assert.equal(schema.meta.custom.xGapProbability, xGapProbability);
	assert.equal(schema.meta.custom.calculatedMinStep, interval);
	assert.deepEqual(schema.fields.map(f => [f.name, f.type]), [
		['xMax', 'time'], ['yMin', 'number'], ['yMax', 'number'],
		['count', 'number'], ['yLayout', 'number'],
	]);
	assert.equal(schema.fields[0].config.interval, interval);
	assert.equal(schema.fields[1].config.unit, 's');
	assert.equal(schema.fields[2].config.unit, 's');
	assert.ok(Array.isArray(data.values));
	assert.equal(data.values.length, 5);
	assert.equal(new Set(data.values).size, 5);
	const [times, lo, hi, counts, layout] = data.values;
	assert.ok(times.length > 0);
	for (const values of data.values) {
		assert.ok(Array.isArray(values));
		assert.equal(values.length, times.length);
	}

	const populated = new Uint16Array(columns);
	let previousCoord = -1;
	for (let i = 0; i < times.length; i++) {
		assert.ok(Number.isSafeInteger(times[i]));
		const col = (times[i] - start) / interval - 1;
		assert.ok(Number.isInteger(col) && col >= 0 && col < columns);
		assert.ok(Number.isFinite(lo[i]) && Number.isFinite(hi[i]) && lo[i] > 0 && hi[i] > lo[i]);
		const row = Math.round(Math.log2(lo[i]) * 8) + 139;
		assert.ok(row >= 0 && row < 169);
		assert.ok(Math.abs(lo[i] / edges[row] - 1) < 1e-12);
		assert.ok(Math.abs(hi[i] / edges[row + 1] - 1) < 1e-12);
		const coord = col * 169 + row;
		// Strict order also rejects duplicate coordinates without a large string-key Set.
		assert.ok(coord > previousCoord, `Cell ${i} is duplicated or out of order`);
		previousCoord = coord;
		assert.ok(Number.isFinite(counts[i]) && counts[i] > 0);
		assert.ok(Math.abs(counts[i] * 285 - Math.round(counts[i] * 285)) < 1e-9);
		assert.equal(layout[i], 0);
		populated[col]++;
	}
	assert.ok(populated.every(n => n <= 169));
	if (xGapProbability == 0)
		assert.ok(populated.every(n => n > 0), 'Every time column must contain cells without X gaps');
	if (xGapProbability == 1)
		assert.equal(populated.filter(n => n > 0).length, Math.min(columns, 2));
	assert.equal(times[0], start + interval);
	assert.equal(times.at(-1), start + columns * interval);

	const cells = readCells(frames);
	const shape = gridShape(cells);
	assert.equal(cells.minX, start);
	assert.equal(cells.maxX, start + columns * interval);
	assert.equal(cells.xSize, interval);
	assert.equal(shape.nx, columns);
	between(shape.ny, 1, 169, 'Observed grid height');
	assert.ok(Math.abs(shape.factor - 2 ** (1 / 8)) < 1e-12);
	return cells;
}

function bucketMetadata(bands) {
	const entries = Object.entries(bands);
	return new Map(edges.slice(0, -1).map((lo, row) => {
		const y = Math.sqrt(lo * edges[row + 1]);
		return [lo, {row, names: entries.filter(([, [min, max]]) => y >= min && y < max).map(([name]) => name)}];
	}));
}

function aggregate(cells) {
	const zeroBands = Object.fromEntries(Object.keys(bands).map(name => [name, 0]));
	const keys = ['rows', 'total', ...Object.keys(bands)];
	const totals = Object.fromEntries(keys.map(key => [key, new Float64Array(defaults.columns)]));
	const bandRows = {...zeroBands};
	const mass = new Float64Array(169);
	const buckets = bucketMetadata(bands);
	for (let i = 0; i < cells.times.length; i++) {
		const col = (cells.times[i] - defaults.start) / defaults.interval - 1;
		const bucket = buckets.get(cells.yMin[i]);
		const count = cells.counts[i];
		totals.rows[col]++;
		totals.total[col] += count;
		mass[bucket.row] += count;
		for (const name of bucket.names) {
			totals[name][col] += count;
			bandRows[name]++;
		}
	}
	const perColumn = Array.from({length: defaults.columns}, (_, col) =>
		Object.fromEntries(keys.map(key => [key, totals[key][col]])));
	const total = mass.reduce((a, b) => a + b, 0);
	return {
		perColumn, bandRows,
		weightedQuantile(p) {
			let sum = 0;
			for (let row = 0; row < mass.length; row++) {
				sum += mass[row];
				if (sum >= p * total)
					return Math.sqrt(edges[row] * edges[row + 1]);
			}
			assert.fail(`No weighted quantile for ${p}`);
		},
		window(from, to) {
			const sums = {...zeroBands, rows: 0, total: 0};
			const keys = Object.keys(sums);
			let length = 0;
			for (let i = 0; i < perColumn.length; i++) {
				const t = i / (defaults.columns - 1);
				if (t >= from && t < to) {
					length++;
					for (const key of keys)
						sums[key] += perColumn[i][key];
				}
			}
			assert.ok(length > 0, `Empty time window [${from}, ${to})`);
			for (const key of keys)
				sums[key] /= length;
			return sums;
		},
	};
}

describe('procedural heatmap cells data', function() {
	this.timeout(15000);
	let frames, cells, stats;

	before(() => {
		frames = generateHeatmapCells();
		cells = readCells(frames);
		stats = aggregate(cells);
	});

	it('repeats a seed independently of intervening calls and does not mutate options', () => {
		const options = Object.freeze({seed: 42, columns: 64, interval: 60000, start: -60000});
		const first = generateHeatmapCells(options);
		generateHeatmapCells({seed: 7, columns: 13});
		assert.deepEqual(generateHeatmapCells(options), first);
		assert.deepEqual(options, {seed: 42, columns: 64, interval: 60000, start: -60000});
		assert.deepEqual(generateHeatmapCells({columns: 8}), generateHeatmapCells({...defaults, columns: 8}));
	});

	it('returns fresh nested objects and arrays on every call', () => {
		const options = {seed: 42, columns: 24};
		const first = generateHeatmapCells(options);
		const second = generateHeatmapCells(options);
		const snapshot = structuredClone(second);
		const refs = objectRefs(first);
		for (const ref of objectRefs(second))
			assert.ok(!refs.has(ref), 'Outputs must not share mutable objects');
		first[0].schema.meta.typeVersion[0] = 99;
		first[0].schema.meta.custom.seed = 99;
		first[0].schema.fields[0].config.interval = 1;
		for (const values of first[0].data.values)
			values[0] = -1;
		assert.deepEqual(second, snapshot);
		assert.deepEqual(generateHeatmapCells(options), snapshot);
	});

	it('changes generated values, not just metadata, for different seeds', () => {
		const first = generateHeatmapCells({seed: 0, columns: 64});
		const second = generateHeatmapCells({seed: 0xffffffff, columns: 64});
		assert.notDeepEqual(first[0].data.values, second[0].data.values);
		validate(first, {seed: 0, columns: 64});
		validate(second, {seed: 0xffffffff, columns: 64});
	});

	it('emits the default frame schema, positive quantized rates, sorted unique cells, and a uniform fine grid', () => {
		validate(frames);
	});

	for (const options of [
		{columns: 1},
		{columns: 2, seed: 0, interval: 1, start: 0},
		{columns: 3, seed: 0xffffffff, interval: 750, start: -3000},
		{columns: 17, interval: 60000, start: Date.UTC(2000, 0, 1)},
		{columns: 1, interval: 1, start: Number.MAX_SAFE_INTEGER - 1},
		{columns: 1, interval: 1, start: Number.MIN_SAFE_INTEGER},
	]) {
		it(`supports small and boundary options ${JSON.stringify(options)}`, () => {
			validate(generateHeatmapCells(options), options);
		});
	}

	it('changes only timestamps and interval metadata when the time origin or step changes', () => {
		const original = generateHeatmapCells({seed: 9, columns: 32});
		const options = {seed: 9, columns: 32, start: -1000, interval: 137};
		const shifted = generateHeatmapCells(options);
		validate(shifted, options);
		assert.deepEqual(shifted[0].data.values.slice(1), original[0].data.values.slice(1));
		assert.deepEqual(shifted[0].data.values[0], original[0].data.values[0].map(time => {
			const columnEnd = (time - defaults.start) / defaults.interval;
			return options.start + columnEnd * options.interval;
		}));
	});

	it('omits whole columns deterministically without changing surviving cells', () => {
		const options = Object.freeze({seed: 42, columns: 64, xGapProbability: 0.25});
		const sparse = generateHeatmapCells(options);
		validate(sparse, options);
		generateHeatmapCells({seed: 7, columns: 10, xGapProbability: 0.5});
		assert.deepEqual(generateHeatmapCells(options), sparse);
		assert.deepEqual(options, {seed: 42, columns: 64, xGapProbability: 0.25});
		const kept = new Set(sparse[0].data.values[0]);
		between(kept.size, 2, 63, 'Retained columns');
		const full = generateHeatmapCells({...options, xGapProbability: 0})[0].data.values;
		assert.deepEqual(sparse[0].data.values, full.map(a => a.filter((_, i) => kept.has(full[0][i]))));
		const moreGaps = generateHeatmapCells({...options, xGapProbability: 0.75})[0].data.values[0];
		assert.ok(moreGaps.every(x => kept.has(x)), 'Increasing probability must only remove additional columns');
		const shifted = generateHeatmapCells({...options, start: 0, interval: 17})[0].data.values;
		assert.deepEqual(shifted.slice(1), sparse[0].data.values.slice(1));
		assert.deepEqual(shifted[0], sparse[0].data.values[0].map(x => (x - defaults.start) / defaults.interval * 17));
		const otherSeed = generateHeatmapCells({...options, seed: 43})[0].data.values[0];
		assert.notDeepEqual(new Set(otherSeed), kept);
	});

	for (const columns of [1, 2, 3, 32]) {
		it(`retains endpoint columns with xGapProbability=1 and ${columns} columns`, () => {
			const options = {columns, xGapProbability: 1};
			const sparse = generateHeatmapCells(options);
			validate(sparse, options);
			const full = generateHeatmapCells({columns})[0].data.values;
			assert.deepEqual(sparse[0].data.values, full.map(a => a.filter((_, i) => full[0][i] == full[0][0] || full[0][i] == full[0].at(-1))));
		});
	}

	it('keeps the sparse-X demo near 250k cells while omitting whole time columns', () => {
		const options = {xGapProbability: 0.02};
		const sparse = validate(generateHeatmapCells(options), options);
		between(sparse.counts.length, 225000, 275000, 'Sparse demo cell count');
		between(defaults.columns - new Set(sparse.times).size, 20, 100, 'Missing columns');
	});

	for (const [name, invalid] of [
		['xGapProbability', [-1, 1.01, NaN, Infinity, -Infinity, '0.5', null, true]],
		['seed', [-1, 0x100000000, 1.5, NaN, Infinity, -Infinity, '1', null, true]],
		['columns', [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, '2', null, true]],
		['interval', [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, '1000', null, true]],
		['start', [0.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, NaN, Infinity, -Infinity, '0', null, true]],
	]) {
		it(`rejects invalid ${name} values`, () => {
			for (const value of invalid) {
				assert.throws(() => generateHeatmapCells({columns: 2, [name]: value}),
					{ name: 'RangeError', message: new RegExp(name) }, `${name}=${String(value)}`);
			}
		});
	}

	it('rejects an unsafe final timestamp before allocating or generating cells', () => {
		for (const options of [
			{columns: 1, interval: 1, start: Number.MAX_SAFE_INTEGER},
			{columns: 2, interval: Number.MAX_SAFE_INTEGER, start: 0},
			{columns: Number.MAX_SAFE_INTEGER, interval: 2, start: 0},
		])
			assert.throws(() => generateHeatmapCells(options), {name: 'RangeError', message: /timestamp/});
		assert.throws(() => generateHeatmapCells(null), TypeError);
	});

	// Broad envelopes protect the visual character, not a particular mixture fit or seed snapshot.
	it('keeps the default size near 250k cells with a sparse, low-rate distribution', () => {
		between(cells.counts.length, 225000, 275000, 'Default cell count');
		between(cells.counts.length / (defaults.columns * 169), 0.5, 0.65, 'Grid occupancy');
		const counts = Float64Array.from(cells.counts).sort();
		between(quantile(counts, 0.05), 1 / 285, 3 / 285, 'Rate p05');
		between(quantile(counts, 0.5), 0.008, 0.04, 'Rate p50');
		between(quantile(counts, 0.95), 0.06, 0.2, 'Rate p95');
		between(quantile(counts, 0.99), 0.12, 0.6, 'Rate p99');
		const rows = stats.perColumn.map(c => c.rows).sort((a, b) => a - b);
		between(quantile(rows, 0.5), 75, 125, 'Cells per column p50');
		between(quantile(rows, 0.95), 90, 145, 'Cells per column p95');
		between(stats.weightedQuantile(0.05), 10e-6, 25e-6, 'Weighted latency p05');
		between(stats.weightedQuantile(0.5), 0.004, 0.03, 'Weighted latency p50');
		between(stats.weightedQuantile(0.95), 0.8, 2.5, 'Weighted latency p95');
		between(stats.weightedQuantile(0.99), 1.8, 5, 'Weighted latency p99');
	});

	it('keeps the quiet latency region and upper tail sparse rather than filling the grid', () => {
		const all = stats.window(0, 1.001);
		between(stats.bandRows.quiet / cells.counts.length, 0, 0.005, 'Quiet-region cell fraction');
		between(all.quiet / all.total, 0, 0.002, 'Quiet-region weight fraction');
		between(stats.bandRows.tail / cells.counts.length, 0.01, 0.15, 'Tail cell fraction');
		between(all.tail / all.total, 0.003, 0.06, 'Tail weight fraction');
		between(stats.bandRows.high, 1, cells.counts.length * 0.01, 'Rare cells beyond six seconds');
		between(all.high / all.total, 0, 0.003, 'Weight fraction beyond six seconds');
	});

	it('retains all five major latency bands across early, middle, and late windows', () => {
		for (const [from, to] of [[0.02, 0.18], [0.3, 0.7], [0.81, 0.92], [0.93, 0.965], [0.98, 1.001]]) {
			const window = stats.window(from, to);
			const presence = Object.fromEntries(persistent.map(name => [name, 0]));
			let length = 0;
			for (let i = 0; i < stats.perColumn.length; i++) {
				const t = i / (defaults.columns - 1);
				if (t >= from && t < to) {
					length++;
					for (const name of persistent)
						presence[name] += stats.perColumn[i][name] > 0;
				}
			}
			for (const name of persistent) {
				between(window[name] / window.total, 0.02, 0.4, `${name} weight share in [${from}, ${to})`);
				between(presence[name] / length, 0.95, 1, `${name} presence in [${from}, ${to})`);
			}
		}
	});

	it('adds substantial fast traffic at the late breakpoint without removing the original bands', () => {
		const before = stats.window(0.785, 0.795);
		const onset = stats.window(0.797, 0.807);
		const late = stats.window(0.81, 0.92);
		for (const window of [onset, late]) {
			between(window.total / before.total, 1.4, 2.5, 'Late total increase');
			assert.ok(window.fast > before.fast * 10, 'Sub-millisecond traffic must increase');
			assert.ok(window.two > before.two * 5, 'Two-millisecond traffic must increase');
			between((window.fast + window.two) / window.total, 0.25, 0.65, 'Late fast-band share');
			for (const name of persistent)
				between(window[name] / before[name], 0.5, 1.6, `Persistent ${name} rate`);
		}
	});

	it('has a brief partial outage at the structural breakpoint, with recovery and no missing columns', () => {
		const before = stats.window(0.25, 0.26);
		const outage = stats.window(0.263, 0.268);
		const after = stats.window(0.27, 0.28);
		between(outage.total / before.total, 0.03, 0.3, 'Outage total rate');
		between(outage.rows / before.rows, 0.05, 0.4, 'Outage populated cells');
		assert.ok(outage.micro > 0 && outage.main > 0, 'The two low-latency bands must survive');
		for (const name of ['hundred', 'mid', 'slow'])
			assert.ok(outage[name] < before[name] * 0.05, `${name} must disappear during the outage`);
		between(after.total / before.total, 0.7, 1.4, 'Recovery');
		let low = 0;
		for (const column of stats.perColumn)
			low += column.total < before.total * 0.3;
		between(low / defaults.columns, 0.002, 0.015, 'Brief outage duration');
		assert.ok(stats.perColumn.every(c => c.rows > 0 && c.total > 0));
	});

	it('suppresses the sub-millisecond band during the fast gap, then restores it', () => {
		const before = stats.window(0.90, 0.923);
		const gap = stats.window(0.925, 0.970);
		const after = stats.window(0.973, 1.001);
		assert.ok(gap.fast < before.fast * 0.1, 'Fast traffic must largely disappear in the gap');
		assert.ok(after.fast > gap.fast * 10, 'Fast traffic must return after the gap');
		assert.ok(after.fast > before.fast * 0.15, 'Restored fast traffic must be substantial');
		assert.ok(gap.two > before.two * 1.4, 'Traffic must move toward the two-millisecond band');
		between(gap.total / before.total, 0.7, 1.4, 'Total traffic through the gap');
		between(after.total / gap.total, 0.7, 1.4, 'Total traffic after the gap');
	});

	describe('daily cycles and broad late heat', () => {
		const rateBands = {
			micro: [10e-6, 25e-6],
			millis: [0.001, 0.01],
			broadMillis: [0.003, 0.01],
			tens: [0.01, 0.1],
			subsecond: [0.1, 1],
			seconds: [1, 4],
			broad: [0.003, Infinity],
		};
		const names = Object.keys(rateBands);
		const pulsed = ['millis', 'tens', 'subsecond'];

		let buckets, zeroRates;

		function summarize(columns, from, to, tails) {
			const rates = {...zeroRates};
			const mass = tails ? new Float64Array(edges.length - 1) : null;
			const heights = tails ? [] : null;
			let length = 0;
			for (const column of columns) {
				if (column.phase >= from && column.phase < to) {
					length++;
					for (const name of names)
						rates[name] += column[name];
					if (tails) {
						for (let row = 0; row < mass.length; row++)
							mass[row] += column.mass[row];
						heights.push(column.height);
					}
				}
			}
			assert.ok(length > 0, 'Statistical windows must contain columns');
			for (const name of names)
				rates[name] /= length;
			if (!tails)
				return rates;
			const total = mass.reduce((a, b) => a + b, 0);
			const weighted = p => {
				let sum = 0;
				for (let row = 0; row < mass.length; row++) {
					sum += mass[row];
					if (sum >= p * total)
						return Math.sqrt(edges[row] * edges[row + 1]);
				}
				assert.fail(`No phase-weighted quantile for ${p}`);
			};
			heights.sort((a, b) => a - b);
			return {
				...rates, q99: weighted(0.99), q999: weighted(0.999),
				height: quantile(heights, 0.5),
				meanHeight: heights.reduce((a, b) => a + b, 0) / heights.length,
			};
		}

		const phaseWindow = (columns, from, to, tails = true) => summarize(columns, from, to, tails);
		const peakPhase = (profile, value) => {
			const peak = profile.reduce((best, column, i) => value(column) > value(profile[best]) ? i : best, 0);
			return (peak + 0.5) / profile.length;
		};

		for (const seed of [1, 42]) {
			describe(`seed ${seed}`, () => {
				let columns, baseline, profile;

				before(() => {
					// Build shared grid metadata inside the timed hooks, not during test registration.
					buckets ??= bucketMetadata(rateBands);
					zeroRates ??= Object.fromEntries(names.map(name => [name, 0]));
					// Different timestamps must not change the normalized-day phase measurements.
					const source = seed == 1 ? cells : readCells(generateHeatmapCells({seed, start: 0, interval: 137}));
					const rates = Object.fromEntries(names.map(name => [name, new Float64Array(defaults.columns)]));
					const heights = new Float64Array(defaults.columns);
					columns = Array.from({length: defaults.columns}, (_, col) => {
						const t = col / (defaults.columns - 1);
						const day = t * 35.7;
						return Object.assign({
							t, day, phase: day % 1, height: 0, mass: new Float64Array(edges.length - 1),
						}, zeroRates);
					});
					for (let i = 0; i < source.times.length; i++) {
						const col = (source.times[i] - source.minX) / source.xSize - 1;
						const bucket = buckets.get(source.yMin[i]);
						const count = source.counts[i];
						heights[col] = Math.max(heights[col], source.yMax[i]);
						columns[col].mass[bucket.row] += count;
						for (const name of bucket.names)
							rates[name][col] += count;
					}
					for (let col = 0; col < columns.length; col++) {
						columns[col].height = heights[col];
						for (const name of names)
							columns[col][name] = rates[name][col];
					}
					// Complete mature days exclude both the outage and the late traffic regimes.
					baseline = columns.filter(c => c.day >= 11 && c.day < 26);
					profile = Array.from({length: 36}, (_, bin) => phaseWindow(baseline, bin / 36, (bin + 1) / 36));
				});

				it('brightens the millisecond-to-subsecond bands together each day without pulsing the microband', () => {
					const pulse = phaseWindow(baseline, 0.67, 0.72, false);
					const quiet = phaseWindow(baseline, 0.85, 0.95, false);
					for (const name of pulsed) {
						between(pulse[name] / quiet[name], 1.25, 2.1, `${name} pulse/off rate`);
						between(peakPhase(profile, c => c[name]), 0.65, 0.75, `${name} daily peak phase`);
					}
					between(pulse.micro / quiet.micro, 0.9, 1.1, 'Microband pulse/off rate');

					let coherent = 0;
					for (let day = 11; day < 26; day++) {
						const daily = baseline.filter(c => Math.floor(c.day) == day);
						const on = phaseWindow(daily, 0.67, 0.72, false);
						const off = phaseWindow(daily, 0.85, 0.95, false);
						if (pulsed.every(name => on[name] > off[name] * 1.2))
							coherent++;
					}
					between(coherent / 15, 0.85, 1, 'Days with simultaneous increases in all three bands');
				});

				it('raises the upper-tail quantiles and occupied height before the count pulse, then contracts rapidly', () => {
					const quiet = phaseWindow(baseline, 0.85, 0.95);
					const peak = phaseWindow(baseline, 0.62, 0.66);
					const post = phaseWindow(baseline, 0.73, 0.78);
					for (const name of ['q99', 'q999', 'height']) {
						between(peak[name] / quiet[name], 1.4, 3, `${name} tail peak/quiet`);
						between(post[name] / peak[name], 0.3, 0.75, `${name} rapid postpeak contraction`);
					}
					const tailPhase = peakPhase(profile, c => c.meanHeight);
					const countPhase = peakPhase(profile, c => c.millis + c.tens + c.subsecond);
					between(tailPhase, 0.58, 0.68, 'Occupied-height hump phase');
					between(countPhase - tailPhase, 0.015, 0.14, 'Tail lead in normalized days');
				});

				it('elevates phase-matched populations above three milliseconds throughout the late heat streak', () => {
					const before = columns.filter(c => c.t >= 0.6 && c.t < 0.79);
					// Match the phase distribution of each window, including its partial days.
					const phaseRates = Array.from({length: 72}, (_, bin) => phaseWindow(before, bin / 72, (bin + 1) / 72, false));
					const ratios = (from, to) => {
						const actual = {...zeroRates};
						const reference = {...zeroRates};
						let length = 0;
						for (const column of columns) {
							if (column.t >= from && column.t < to) {
								length++;
								const matched = phaseRates[Math.floor(column.phase * 72)];
								for (const name of names) {
									actual[name] += column[name];
									reference[name] += matched[name];
								}
							}
						}
						assert.ok(length > 0, 'Heat comparison must contain columns');
						for (const name of names)
							actual[name] /= reference[name];
						return actual;
					};
					for (const [from, to] of [[0.796, 0.84], [0.84, 0.924]]) {
						const heat = ratios(from, to);
						const label = `Heat [${from}, ${to})`;
						between(heat.broad, 1.1, 1.4, `${label} >=3ms rate`);
						between(heat.broadMillis, 0.95, 1.3, `${label} 3–10ms rate`);
						between(heat.tens, 1.2, 1.7, `${label} 10–100ms rate`);
						between(heat.subsecond, 1.07, 1.35, `${label} 0.1–1s rate`);
						between(heat.seconds, 1.05, 1.3, `${label} 1–4s rate`);
						between(heat.micro, 0.9, 1.1, `${label} microband rate`);
					}
					const after = ratios(0.925, 0.970);
					for (const name of ['broad', 'tens', 'subsecond', 'seconds'])
						between(after[name], 0.9, 1.1, `Post-heat ${name} returns near its phase-matched baseline`);
				});
			});
		}
	});
});
