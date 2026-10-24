# Chart lifecycle smoke investigation

## Purpose

At the time of this diagnostic, the suite measured new charts with data. It did not measure replacement in a retained chart.
This diagnostic examines whether separate initialization and update measurements provide useful information.
It does not change the published benchmark, its adapters, or its report format.

## Method

Runner: [`scripts/investigate-chart-lifecycle.mjs`](../../scripts/investigate-chart-lifecycle.mjs).
Diagnostic adapters: [`scripts/bench-lifecycle-adapters.mjs`](../../scripts/bench-lifecycle-adapters.mjs).

The cache-only runner uses Chrome Headless Shell 156.0.8078.47 with Vulkan requested for every library.
Each library gets a fresh browser. Later charts share that browser's vendor and graphics caches.
The run uses the full 55,550-row, three-series workload at 1920×600 and DPR 1.
Axes remain automatic and animations remain disabled.

Each of three sessions creates two charts:

1. A fresh chart with the full dataset, as a direct-startup control.
2. A fresh empty chart, followed by first population and four full-data replacements.

The two paths alternate order between sessions. Each path destroys its chart before the next path starts.
Session 1 is a warmup. The first replacement in each session is also a warmup.
Results are medians of the two measured session medians, not statistically robust estimates.
Each steady-update session median contains three replacements.

Every populated operation receives fresh columns and changed timestamps and values in all three series.
Data derivation and preparation occur outside operation timing, with separate measurements.
Validation checks native counts, three value samples per series, and chart/context/device identity outside operation timing.
ChartGPU validation reads its retained hit-test store, not GPU buffers. These checks do not establish raster equivalence.

Public update paths are uPlot `setData`, Plotly `react`, SciChart suspended `clear`/`appendRange`, and ChartGPU `setOption`.
Plotly uses automatic X ranges here, unlike the existing startup adapter's explicit data-derived X range.
ChartGPU can rebuild internal series resources through `setOption`, but retains the chart instance and device.
No dummy data initializes the empty charts. No forced GC, process-memory polling, or traces occur.
Each operation has a five-second external watchdog. The complete diagnostic has a three-minute limit.

## Timing boundaries

- `readyMs`: elapsed time until the adapter's library-ready operation resolves.
- `completeMs`: elapsed time from the same start through two animation frames and graphics completion checks.
- Context acquisition: durations of actual `getContext`, `requestAdapter`, and `requestDevice` calls, with no capability probes.

ChartGPU's adapter already awaits queue completion before readiness. GL completion occurs after the common settling interval.
These readiness boundaries therefore differ between libraries. Within-library phase comparisons are the main purpose.
The common two-frame wait adds a scheduling floor, especially for fast charts.
Neither metric is the suite's `total ms`, which sums selected host-thread work.
Neither metric measures hardware GPU execution or proves compositor presentation.
Acquisition call durations can overlap other work and do not explain all initialization cost.

## Observed results

The successful smoke run completed in 14.90 seconds on the local AMD graphics system.
Each table cell is `readyMs / completeMs`, in milliseconds.

| Library | Direct populated create | Empty create | First data | Steady replacement |
| --- | ---: | ---: | ---: | ---: |
| uPlot | 4.65 / 25.30 | 1.15 / 27.85 | 5.25 / 23.35 | 5.20 / 20.90 |
| Plotly GL | 270.10 / 304.90 | 15.60 / 28.00 | 243.70 / 293.95 | 147.15 / 168.90 |
| SciChart | 372.00 / 399.70 | 364.75 / 378.40 | 39.75 / 63.80 | 38.05 / 71.00 |
| ChartGPU | 100.35 / 121.35 | 95.85 / 109.45 | 44.85 / 60.85 | 38.85 / 58.65 |

All 84 operation phases passed validation. All 48 replacements retained their chart and graphics resources after first population.
Twenty-four replacements contributed to measured results. All 24 chart destructions completed, and temporary browser profiles were removed.

Plotly acquired two GL contexts during first population, not empty initialization.
Its measured GL acquisition sums were 52.05 ms for direct creation and 39.50 ms for first population.
SciChart acquired its GL context during creation: 19.95 ms for direct creation and 16.70 ms for empty creation.
Its much larger initialization duration includes work beyond the observed acquisition calls.
ChartGPU's direct-create adapter and device requests took 1.15 ms and 6.15 ms, respectively.
ChartGPU's remaining initialization cost is not attributable from this smoke alone.

## Conclusion

The split is useful, particularly for SciChart and ChartGPU. Repeated updates avoid substantial work that new-chart measurements include.
An empty-init/data split alone is insufficient: Plotly defers context acquisition until first population.
The lifecycle benchmark now separates empty initialization, first population, and steady replacement.
The direct-populated startup control also remains useful. Its cost need not equal the sum of the two initialization phases.
This smoke does not establish append-streaming performance, long-session memory behavior, or stable cross-library rankings.

## Production integration

The initial integration exposed empty construction and retained-chart updates for all 41 default variants.
The production protocol now uses two-point populated construction followed by one full-data update.
It measures small-to-full population, not the steady-state replacement measured by this historical smoke investigation.
The HTML demos retain direct construction with data.
The [update reference audit](benchmark-update-references.md) examines input-identity shortcuts and candidates for allocation reuse.
The [benchmark protocol](../../scripts/benchmarks.md#lifecycle-phases) defines the new columns, operation budgets, and session-wide memory measurements.

Validation after the original four-phase integration used serial processes and one browser at a time.
The uPlot combined worker completed 10 sessions and 40 distinct timing windows.
The ChartGPU memory worker completed seven measured sessions with Vulkan requested.
The Plotly memory worker exceeded its five-second operation budget with the default backend. No longer-timeout retry followed.
These runs do not establish a completed suite or a comparative performance result.

## Reproduction

The cached browser and vendor dependencies must already exist. The runner does not download missing assets.
The Linux runner requests Vulkan consistently across all four libraries.

```sh
node scripts/investigate-chart-lifecycle.mjs
node node_modules/mocha/bin/mocha.js test/tooling/bench-lifecycle-adapters.mjs
```

The runner writes `.cache/benchmarks/chart-lifecycle-smoke.json` with raw phases, warmups, acquisition calls, identity checks, and summaries.
A rerun replaces that diagnostic report. The published suite reports remain unchanged.
