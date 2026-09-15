import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProbeWorker } from '../scripts2/probe-worker.mjs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const helper = fileURLToPath(new URL('../scripts2/precision-probe.mjs', import.meta.url));

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
	// next to the cases in scripts2/precision-probe.mjs. No canvas snapshots.
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
