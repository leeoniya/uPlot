# Benchmarks

The benchmarks compare chart libraries, including their data preparation and sampling or decimation choices.
They use Chrome Headless Shell, pinned demo dependencies, and `bench/data.json`.

The six HTML demos and benchmark import the same `bench/{uplot,d3,chartjs,echarts,flot,dygraphs}.mjs` modules.
Each module exports `prepData(packed)` and `makeChart(data, host, wait)`.
Chart configuration and data preparation have one implementation per library. No HTML parsing or source extraction occurs.
`bench/demo-fixture.mjs` and `bench/demo.css` provide shared hosts, markup, and styles.
`bench/demo-dependencies.mjs` defines the dependency versions and production paths for both entry points.
The HTML pages use `bench/demo.mjs` to load dependencies and start the demo.
The benchmark loads cached dependencies and calls the shared functions within its measurement lifecycle.

The standalone HTML pages require an HTTP server because they import ES modules.
uPlot uses `dist/uPlot.iife.min.js` and `dist/uPlot.min.css`, not source modules.
The benchmark records SHA-256 hashes of these assets in `runner.sourceSha256`.
If the assets are missing or source changes need a new bundle, run `npm run build` before the benchmark.
The benchmark does not rebuild them automatically.
The uPlot demo and benchmark set `cache: {paths: false}`. Data caching keeps its default behavior.
Path construction remains measured, but uPlot releases the cached paths after each commit.
The benchmark checks that series and point paths are no longer retained after drawing.

The other libraries and CDN dependencies use minified production builds.
Flot uses its published `dist/es5/jquery.flot.js` bundle, which is minified despite its filename and includes the time plugin.
This bundle also includes other Flot plugins, unlike the previous core-and-time source selection.
The local Dygraphs date formatter remains demo code, not a third-party library bundle.
Dependency cache filenames include the package path so source and distribution files cannot share a cache entry.
Each chart contains 55,550 rows and three data series, at 1920 × 600 CSS pixels.
DPR defaults to 1.

## Commands

Run the combined trace and process-memory benchmark:

```sh
npm run bench
```

For separate measurements, use:

```sh
npm run bench:trace
npm run bench:memory
npm run bench:raf
```

| Command | Measurements |
| --- | --- |
| `bench` | Trace timings and process memory on the same chart samples |
| `bench:trace` | Trace timings, without process polling or forced GC |
| `bench:memory` | Process memory, without tracing |
| `bench:raf` | Untraced next-rAF latency, without process polling or forced GC |

There is no JS-heap benchmark or heap-usage sampling.
The memory modes still use CDP to request GC and identify process roles.
Process memory values come from Linux `/proc/<pid>/smaps_rollup`.

To select a different DPR, append `-- --dpr NUMBER`:

```sh
npm run bench -- --dpr 2
```

## Library scope and progress

The default order is idle, uPlot, Chart.js, D3, ECharts, Flot, then Dygraphs.
Each variant uses a fresh browser with only its library and required demo dependencies.
The idle control runs first so the first completed library can show adjusted memory values.
The main table omits the idle row.

Each library has 3 warmups and 7 measured rounds.
There is no 30-second pause between libraries.
The benchmark retains its rendering-settling waits and command timeouts.
An interactive terminal shows one table that updates in place after each library finishes.
Trace and combined tables sort completed libraries by ascending `total ms`, before display rounding, with unavailable totals last.
Ties retain execution order. The sort does not change execution order or raw report order.
Saved summaries use the same sort. Memory-only and rAF tables retain execution order.
The current progress status appears below the table.
Worker output is captured and shown only on failure, so it cannot interrupt the table.
Redirected output contains plain-text progress and one final table, without cursor-control sequences.
Interactive terminals always receive the incremental table, regardless of their reported width or height.
Oversized tables can leave earlier rows in scrollback because cursor movement cannot erase that region.
After a terminal resize, the display starts a fresh block to avoid erasing unrelated output.
The suite saves partial results after each variant, including the idle control.
A failed run keeps its completed results and marks the suite report incomplete.

To select one library plus the idle control, use:

```sh
npm run bench -- --variant chartjs
```

Supported variants are `uplot`, `chartjs`, `d3`, `echarts`, `flot`, `dygraphs`, and `idle`.
All six libraries run by default.

## Timing and memory protocol

Library loading, raw JSON parsing, and fixture setup occur outside the chart timers.
Each sample times the actual demo preparation function separately from chart initialization.
uPlot uses its own shared preparation function, with timestamps in seconds and the default time scale.
Other libraries use millisecond timestamps, including Date objects for Dygraphs.
The benchmark does not convert uPlot data to milliseconds or override its chart configuration.
Chart initialization includes options construction, the constructor, and its initial microtask commit.
Validation occurs outside both timers.

The trace window starts at chart construction and ends after rendering settles.
It includes deferred rendering but excludes data preparation, forced GC, and teardown.
Settling uses two animation frames and a 200 ms wait.
This wait is a heuristic, not a GPU completion fence.

The trace enables only `blink.user_timing` and `disabled-by-default-devtools.timeline`.
These categories supply sample markers, thread tasks, raster tasks, and GPU task events.
The main-thread total includes style, layout, and paint work, but the trace omits their separate breakdown.
The JSON field `styleLayoutPaintMs` is therefore unavailable (`null`), not zero.
Chrome Headless Shell 156 captures all required thread roles and work events with these categories.
Browser upgrades require another event-coverage check.

Memory modes record blank-page and loaded-library/raw-data checkpoints before warmups.
These checkpoints are single observations, not round aggregates.
Each memory sample then has this sequence:

1. Create the static host and allow rendering to settle.
2. Force JS GC and record the process-memory baseline.
3. Prepare fresh input data while process polling runs.
4. Record the prepared snapshot without forced GC.
5. Construct the chart and allow rendering to settle while process polling runs.
6. End the chart timing window.
7. Force JS GC and record retained process memory.
8. Destroy the chart, release input references, and allow rendering to settle.
9. Force JS GC and record cleanup memory.

No forced GC occurs between preparation and construction.
The prepared snapshot can include temporary allocations, so its deltas do not isolate retained data or chart ownership.
The retained checkpoint includes both the chart and the prepared input.
GC does not force native allocators or graphics caches to return pages to the operating system.

The combined mode records a trace during the memory checkpoints and chart samples.
Tracing starts before the blank-page checkpoint.
Trace buffers can grow later, and process polling also affects the workload.
Combined results therefore describe an instrumented run, not independent timing and footprint measurements.
The separate commands provide measurements without the other instrumentation.

## Output table

The combined table shows minimum measured values for:

- Data preparation time.
- Chart initialization time.
- Renderer main-thread work in the chart window.
- `gpu ms`: GPU-process main-thread work in the chart window.
- `total ms`: total tracked thread work in the chart window.
- Baseline-adjusted sampled peak browser-tree PSS.
- Baseline-adjusted retained browser-tree PSS.

Each column uses its minimum finite value across measured rounds, excluding warmups.
These values describe best observed performance, not typical latency or a guarantee of fully warmed JIT or GC-free execution.
Columns can come from different rounds.
`total ms` uses the minimum per-round total, not the sum of component minima.
`peak MB` uses the minimum per-round peak. Each round's peak remains the maximum sampled observation.
Trace and rAF timings do not subtract idle timings.

The table omits the index, sample-count, and DPR columns. Sample counts and DPR remain in JSON.
Library names have no quotes and align left. Numeric columns align right and show one decimal place.
The JSON retains full measurement precision.
Terminal dimensions and line wrapping affect cursor erasure, not whether an interactive table is shown.
Explanatory notes do not appear above the table. Measurement warnings appear below it.
Times use milliseconds.
Thread work is wall duration, not exclusive CPU time or hardware GPU execution time.
Tracked work excludes data preparation and can overlap across threads.
Initialization time and renderer thread work are not additive.
Memory uses decimal MB: 1 MB = 1,000,000 bytes.

Each measured library sample uses this adjustment:

```text
idle overhead = min(idle retained memory - idle browser blank memory)
adjusted retained = library retained memory - library browser blank memory - idle overhead
adjusted peak = library sampled peak - library browser blank memory - idle overhead
```

The idle control has the same DPR and measurement mode as the library.
Controls come only from the current run.
Both memory columns subtract the minimum measured settled idle overhead, not the idle peak.
The table then selects the minimum adjusted value for each column.
Negative estimates remain negative.
Missing observations produce unavailable values, not zero.

The JSON retains renderer measurements, RSS, private memory, swap, absolute checkpoints, and raw observations.
The `live` JSON field represents retained memory and keeps its existing name.
Renderer memory is part of browser-tree memory.
PSS apportions shared resident mappings, while summed RSS can count shared pages multiple times.
These metrics do not exactly reproduce Chrome Task Manager's Memory footprint column.

## Measurement limits

Process polling requests a 50 ms delay after each completed read, plus phase endpoints.
It runs independently of renderer evaluation, but reads are not atomic.
Process identity checks reject detected exits, PID reuse, and unavailable fields.
Processes that exist entirely between scans can escape detection.
Restricted `/proc` access can also hide processes or prevent measurements.

Peaks are sampled lower bounds for this measurement protocol, not exact peaks of an uninterrupted run.
Warmup can leave allocator pages resident, and shared-page accounting can change without a local allocation.
Adjusted statistics hold the chosen blank and idle baselines fixed.
Their ranges do not include baseline uncertainty or establish exclusive library ownership.
Cleanup growth alone is not proof of a leak.

Browser-tree PSS includes CPU-resident mappings in the GPU helper process.
It does not measure GPU-specific allocations or complete device memory.
The benchmark uses no heap snapshots, canvas readbacks, or screenshots.
rAF latency does not prove GPU completion or presentation.

## Saved results

Reports and compressed traces are in `.cache/benchmarks/`.
Each mode has its own suite report:

- `results-chrome-combined.json`
- `results-chrome-trace.json`
- `results-chrome-memory.json`
- `results-chrome-raf.json`

Per-variant reports use `results-chrome-MODE-VARIANT.json`.
Traces use `trace-chrome-MODE-VARIANT.json.gz`.
Each run replaces its default output files.
Suite reports retain raw per-variant reports, adjusted statistics, progress, and completion status.

To summarize the saved combined report without starting Chrome, use:

```sh
npm run bench -- --summarize-only
```

Saved tables use the same minimum-value aggregation as live tables.
The same option applies to each separate command and selects its matching saved report.
It uses the saved DPR and rejects `--dpr`, `--variant`, `--worker`, and `--install-only`.
The internal `--worker` option captures one variant for the suite runner.
