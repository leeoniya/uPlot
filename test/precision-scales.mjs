import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProbeWorker } from '../scripts/probe-worker.mjs';
import '../scripts/instrument.mjs';
import uPlot from '../src/uPlot.js';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const helper = fileURLToPath(new URL('../scripts/precision-probe.mjs', import.meta.url));

describe('precision: source scale ranging and axis splits', function() {
	this.timeout(15000); // Parent enforces separate startup, execution, and shutdown limits.
	let worker;
	let instrumentCacheDir;
	let ownsCache = false;

	before(() => {
		instrumentCacheDir = process.env.UPLOT_INSTRUMENT_CACHE_DIR;
		if (instrumentCacheDir == null) {
			instrumentCacheDir = mkdtempSync(join(tmpdir(), 'uplot-precision-'));
			ownsCache = true;
		}
		worker = createProbeWorker({
			cwd, helper,
			env: { ...process.env, UPLOT_INSTRUMENT_CACHE_DIR: instrumentCacheDir },
		});
	});
	after(async () => {
		try { await worker?.close(); }
		finally {
			if (ownsCache)
				rmSync(instrumentCacheDir, { recursive: true, force: true });
		}
	});

	// Source URLs, exact versus derived parameters, and numerical assertions are
	// next to the cases in scripts/precision-probe.mjs. No canvas snapshots.
	for (const [name, title] of [
		['demo-magnitude-sweep', 'demo active 1e-6 to 1e8 data produce finite linear/log10/log2 chart ticks'],
		['demo-wide-and-tiny-log', 'demo active wide log ranges and tiny data retain finite ticks and filtered labels'],
		['demo-partial-log-charts', 'demo active large and divided partial-log datasets retain their boundary ticks'],
		['472-millisecond-format', '#472 formats 100ms correctly in seconds and millisecond charts'],
		['b2433b4-tiny-log10', 'b2433b4 matches the decimal log grid from 1e-24 to 1e-22 within float precision'],
		['771-boundary', '#771 includes the exact negative-decimal boundary tick'],
		['805-custom-increment', '#805 generates custom 0.04 ticks through chart increment selection'],
		['324-zoom-batches', '#324 safely handles the exact zoom batches and rejects sub-limit zoom'],
		['760-built-in-range', '#760 built-in ranging safely expands nearly flat large values'],
		['657-tiny-extrema', '#657 tiny nonflat extrema remain inside the automatic range'],
		['1098-unsnapped-log', '#1098 unsnapped log minimum produces the exact finite decimal grid'],
		['1027-low-log10', '#1027 low log10 extrema produce finite decade ticks'],
		['826-low-log-filter', '#826 filters sub-1e-9 ticks consistently with log pixel spacing'],
		['f979884-log2-wide', 'f979884 log2 ranging preserves powers of two across 1e-6 to 1e8'],
		['1052-partial-log', '#1052 partial log ranges stop at 2M and 200K'],
		['827-auto-flat', '#827 built-in autoranging safely handles the reported flat 1e14 data'],
		['827-auto-updates', '#827 automatic ranges and ticks survive flat and near-flat data updates'],
		['1135-auto-y', '#1135 built-in autoranging safely handles the near-2.7 extrema'],
		['116559-lower-tick', 'Grafana #116559 retains the lower tick for the exact near-10 pair'],
		['1135-explicit-y', '#1135 terminates when a custom ranger returns the near-2.7 extrema'],
		['1135-explicit-x', '#1135 terminates for the attached explicit X zoom near 1e18'],
	])
		it(title, () => worker.run(name));

	// Low-level termination checks, not promises of valid rendering for custom equal bounds.
	for (const [name, title] of [
		['827-stalled-splits', '#827 terminates for the exact stalled numAxisSplits debugger state'],
		['620-equal-range', '#620 terminates for a custom [1, 1] range'],
		['1084-custom-flat', '#1084 terminates for the single-point custom padding ranger'],
	])
		it(title, () => worker.run(name, 100));
});

describe('precision: numeric axis increment selection', () => {
	for (const magnitude of [1e17, 1e18]) {
		for (const sign of [1, -1]) {
			for (const axisIdx of [0, 1]) {
				it(`retains ticks at ${sign * magnitude} on the ${axisIdx == 0 ? 'X' : 'Y'} axis (PR #1157)`, async () => {
					const positiveTicks = Array.from({ length: 5 }, (_, i) => magnitude + i * (magnitude / 10));
					const ticks = sign > 0 ? positiveTicks : positiveTicks.map(value => -value).reverse();
					const range = () => [ticks[0], ticks[4]];
					const u = new uPlot({
						width: 800, height: 320, padding: [0, 0, 0, 0],
						legend: { show: false }, cursor: { show: false },
						scales: {
							x: { time: false, ...(axisIdx == 0 ? { range } : {}) },
							y: axisIdx == 1 ? { range } : {},
						},
						axes: [{ show: axisIdx == 0, space: 150 }, { show: axisIdx == 1, space: 50 }],
						series: [{}, {}],
					}, axisIdx == 0 ? [ticks, [0, 1, 2, 3, 4]] : [[0, 1, 2, 3, 4], ticks], document.body);
					try {
						await Promise.resolve();
						assert.equal(u.axes[axisIdx]._found[0], magnitude / 10);
						assert.deepEqual(u.axes[axisIdx]._splits, ticks);
					}
					finally { u.destroy(); }
				});
			}
		}
	}

	for (const [min, max] of [[1e-20, 1.4e-20], [-1.4e-20, -1e-20], [-2e-21, 2e-21]]) {
		it(`retains small increments without a decimal digit budget in [${min}, ${max}]`, async () => {
			const u = new uPlot({
				width: 800, height: 320, padding: [0, 0, 0, 0],
				legend: { show: false }, cursor: { show: false },
				scales: { x: { time: false }, y: { range: () => [min, max] } },
				axes: [{ show: false }, { space: 50 }],
				series: [{}, {}],
			}, [[0, 1], [min, max]], document.body);
			try {
				await Promise.resolve();
				assert.equal(u.axes[1]._found[0], 1e-21);
				const splits = u.axes[1]._splits;
				assert.equal(splits.length, 5);
				for (let i = 0; i < splits.length; i++) {
					const expected = min + i * 1e-21;
					assert.ok(Math.abs(splits[i] - expected) <= Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON);
					assert.ok(!Object.is(splits[i], -0));
					if (i > 0)
						assert.ok(splits[i] > splits[i - 1]);
				}
			}
			finally { u.destroy(); }
		});
	}

	for (const [name, positiveTicks, increment] of [
		['sub-ULP increments (PR #1154)', [4220788960490496, 4220788960490496.5, 4220788960490497], 0.5],
		// Adding 0.5 advances both bounds, but stalls at the even middle integer.
		['half-ULP ties', [4503599627370497, 4503599627370498, 4503599627370499], 1],
		['sub-ULP increments near 1', [1, 1 + Number.EPSILON, 1 + 2 * Number.EPSILON], 2e-16],
	]) {
		for (const sign of [1, -1]) {
			it(`skips ${name} for ${sign > 0 ? 'positive' : 'negative'} values`, async () => {
				const ticks = sign > 0 ? positiveTicks : positiveTicks.map(value => -value).reverse();
				const u = new uPlot({
					width: 800, height: 320, padding: [0, 0, 0, 0],
					legend: { show: false }, cursor: { show: false },
					scales: { x: { time: false }, y: { range: () => [ticks[0], ticks[2]] } },
					axes: [{ show: false }, { space: 50 }],
					series: [{}, {}],
				}, [[0, 1, 2], ticks], document.body);
				try {
					await Promise.resolve();
					assert.equal(u.axes[1]._found[0], increment);
					assert.deepEqual(u.axes[1]._splits, ticks);
				}
				finally { u.destroy(); }
			});
		}
	}
});
