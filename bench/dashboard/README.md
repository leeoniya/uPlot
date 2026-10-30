# Dashboard benchmark

The dashboard benchmark measures 20 independent charts of one selected variant in one page.
It uses the existing benchmark runner, pinned vendors, trace accounting, and process-memory methodology.


## Commands

From the repository root, run the dashboard benchmark:

```sh
bun run bench:dash
```

The package script selects `--dashboard --gpu`. The default mode records trace timings and process memory on the same samples.
Bun forwards script arguments directly. No extra `--` separator is necessary.

| Command | Purpose |
| --- | --- |
| `bun run bench:dash --trace` | Trace only, without process polling or forced GC |
| `bun run bench:dash --memory` | Process memory only, without tracing |
| `bun run bench:dash --raf` | Untraced rAF latency, without process polling or forced GC |
| `bun run bench:dash --variant uplot` | Local uPlot only |
| `bun run bench:dash --variant chartjs --dpr 2` | Chart.js only, at DPR 2 |
| `bun run bench:dash --variant idle` | Explicit idle diagnostic only |
| `bun run bench:dash --verbose` | Include `main ms` and `gpu ms` in the trace table |
| `bun run bench:dash --summarize-only` | Recompute the saved combined summary without Chrome |
| `bun run bench:dash --memory --summarize-only` | Recompute the saved memory-only summary |
| `bun run bench:dash --no-vulkan` | Disable automatic Vulkan selection, but retain `--gpu` |

The default suite runs 44 chart variants, plus optional LightningChart with a runtime license key.
No mode runs `idle` automatically. `--variant NAME` selects only that variant.
Explicit `--variant idle` runs a diagnostic. No timing or memory result subtracts idle measurements.

`--trace --memory` explicitly selects combined mode. `--raf` cannot combine with either flag.
`--verbose` changes the table, not the measurements or saved metrics.
`--summarize-only` uses the saved DPR. It rejects `--dpr`, `--variant`, `--worker`, and `--install-only`.

Combined and memory-only modes require Linux `/proc`. The runner uses Chrome Headless Shell and local production uPlot assets.
If the uPlot assets are absent or stale, run `bun run build` first.

On Linux, the default suite includes ChartGPU and automatically requests Vulkan for every selected worker.
A focused run without ChartGPU uses the default Chrome backend unless `--vulkan` selects Vulkan explicitly.
`--vulkan` and `--no-vulkan` cannot combine. ChartGPU still requires hardware WebGPU support.
Saved summaries select the same backend policy and never substitute a report from another backend.

## Manual HTML pages

Start the existing demo server from the repository root:

```sh
bun run demos
```

Open [the dashboard index](http://127.0.0.1:3030/bench/dashboard/) in a browser.
Each adapter has a matching HTML page, such as `uplot.html`, `chartjs.html`, or `recharts.html`.

Pages reuse the benchmark adapters and grid layout. They initialize 20 charts with two rows, then update the retained charts to 300 rows.
The charts remain mounted for visual inspection. These pages do not record benchmark measurements or run warmup loops.

The grid retains its 1920×1080 CSS size. Smaller windows scroll rather than scale the charts.
Pages use the same chart configuration as the benchmark, with pointer interaction enabled.
Adapters retain native hover behavior and enable native tooltips or live legends where available.
Loading and error messages appear on the page. The loading message disappears after a successful update.

The pages use the existing demo dependency loader, including pinned CDN assets, ESM modules, and WASM assets where applicable.
They require HTTP serving, not `file://` URLs. They do not use the benchmark runner's disk cache.
WebGL context limits and vendor license requirements still apply. License banners remain visible.
Browser runtime keys use the existing globals, such as `benchmarkLightningChartOptions`, before the page starts. CLI environment variables are not browser globals.

After a page loads, inspect `dashboardDemo.charts`, `dashboardDemo.hosts`, or `dashboardDemo.inputs` in DevTools.
For explicit native-data diagnostics, run:

```js
await dashboardDemo.validate();
```

To release the charts and remove the grid, run:

```js
await dashboardDemo.destroy();
```

Reload the page to create another dashboard.

## Workload

| Property | Value |
| --- | --- |
| Workload protocol | `dashboard-v1` |
| Chart count | 20 independent charts |
| Grid | 4 columns × 5 rows |
| Tile size | 480 × 216 CSS pixels |
| Viewport | 1920 × 1080 CSS pixels |
| Gaps, margins, and borders between tiles | None |
| Series per chart | 5 |
| Rows per series after update | 300 |
| Total points after update | 20 × 5 × 300 = 30,000 |
| DPR | 1 by default, with `--dpr` support |
| Sessions per variant, in every mode | 3 warmups, then 7 measured sessions |

[`common.mjs`](common.mjs) generates deterministic signals with independent arrays for each chart.
The lifecycle validates and freezes the canonical frames at fixture load, before session capture and baselines.
In memory modes, the blank checkpoint precedes fixture load.
Each chart has five same-unit signals on one Y axis, with time on the X axis.
The source timestamps use milliseconds at one-minute intervals. Adapters convert timestamps to their native input formats.
This workload does not use the original packed data in `bench/data.json`.

Charts use native defaults except for the shared data, dimensions, colors, and necessary layout adjustments.
Adapters disable animation and persistent point markers where needed. uPlot retains its default point visibility.
Adapters use native legends where the library supplies them.
Custom drawing adapters and some framework adapters supply a small legend where necessary.
Each tile contains its axes and legend within the fixed tile size.

Native tooltips or live legends provide hover values where supported. D3, d3fc, deck.gl, and visx do not add custom hover implementations.
Flot provides native hover highlighting. Lightweight Charts provides native crosshair labels.
Local uPlot uses a native top legend. The pinned release lacks `legend.side` and retains its native bottom legend.

Each session has only two operations:

1. `small-init` creates all 20 hosts and charts with two rows per series: the first and last source rows.
2. `data-update` updates the same chart instances to all 300 rows per series.

The two-row input retains the full time range. No resize or hover operation occurs.
The explicit idle diagnostic creates the same 20 empty hosts and uses the same operation schedule, without charts or data preparation.

## Timing and watchdog

The runner starts all tile operations as one batch before it awaits their completion.
It does not await each chart before it starts the next chart.
Synchronous calls still use the browser thread. Batched starts do not imply parallel JavaScript execution.

Each dashboard operation has one shared five-second watchdog in every mode, including warmups.
The budget covers all 20 tiles, not five seconds per tile.
It includes preparation, readiness, settling, capture checks, and applicable process reads.
The first budget also includes session setup and the baseline checkpoint.

Post-update GC and the `live` checkpoint share a separate five-second budget. Final destruction has another five-second budget.
If synchronous renderer work blocks the page, the Node watchdog can still terminate Chrome.

Ordinary variant errors and timeouts leave unavailable metrics and do not stop the suite. This policy also applies to explicit idle diagnostics.
Cancellation and infrastructure failures still stop the suite.

Markers use `benchmark:<id>:start|js-end|end` for the whole dashboard operation.
Host creation belongs to `small-init`. Aggregate input preparation has a separate timer outside the chart markers.
Capture retains page/grid geometry checks, checks for 20 distinct chart handles, and graphics-health checks.
Trace and memory modes also retain graphics completion checks.

Deep native-data validation runs only through explicit `benchmarkLifecycle.validate()` calls in separate diagnostic fixtures.
Neither capture nor preflight calls this method.
This separation prevents validation-only allocations from contaminating peak memory, even after the timing markers end.

`jsMs` measures elapsed readiness time, including asynchronous adapter work. It is not exclusive JavaScript CPU time.
The complete operation window includes readiness, two animation frames, a 200 ms settling wait, and applicable graphics completion checks.
The settling wait alone does not prove completion.

Trace `init ms` and `update ms` describe tracked host-thread work for the whole dashboard.
They are neither per-chart averages nor true exclusive CPU time.
The tracked scopes include renderer-main, compositor, raster, GPU-process, and selected background-GC work.
`gpu ms` measures host-thread work in the GPU process, not hardware GPU execution time.
Completion checks do not prove presentation or complete coverage of worker-owned graphics resources.

Trace timing statistics use arithmetic means after warmups. Memory and rAF statistics retain minima.
The primary groups, preparation column, and verbose thread columns describe `data-update`.
`phaseGroups` contains only `small-init` and `data-update`.

In rAF mode, `init rAF ms` ends at the first callback after initialization readiness.
`update ms` describes elapsed update readiness. `next rAF ms` measures from operation start to the first callback after readiness.
The rAF mode does not perform graphics completion checks or measure presentation.

## Memory

Memory capture still uses `through-update-v1`, as in the single-chart benchmark. The raw capture lifecycle is unchanged.

The runner already records a settled, post-GC `/blank` checkpoint in each fresh browser, before library or fixture load.
The blank checkpoint uses the same viewport, DPR, and trace mode as that browser's chart samples.
Combined mode starts tracing before this checkpoint. Memory-only mode leaves tracing off.
The runner records the loaded-library checkpoint after fixture load, before warmups.

If a blank read is incomplete, the runner retries it before library load, with at most five total attempts.
Each attempt includes two animation frames, a 200 ms wait, and forced GC.
The first complete read supplies the baseline, not the smallest value. `blank.attempts` retains all attempts and their diagnostics.
If every attempt fails, adjusted memory remains unavailable. The table warning includes the final failure reason.
Loaded checkpoints and measured observations do not retry.

Each session then uses this sequence:

1. The runner establishes session state, requests GC, and records the baseline before host creation.
2. Process polling covers two-row preparation, small initialization, full-data preparation, and the retained update.
3. The `prepared` snapshot follows full-data preparation without forced GC. It still includes the small charts.
4. After update readiness, settling, and graphics completion, the runner requests GC and records `live`.
5. All 20 charts and their full prepared inputs remain alive at `live`.
6. Memory capture ends. The runner destroys the charts and releases the inputs without cleanup GC or a cleanup snapshot.

There is no post-update polling phase. The final GC and `live` checkpoint end memory capture.
No process reads or forced GC occur after `live`.
Peak memory covers the baseline through `live`, including initialization and preparation.
The `dataDelta` field includes small initialization. It does not isolate input preparation.

Each measured session uses only its own browser's blank checkpoint for adjustment:

```text
adjusted retained = raw live memory - own browser blank memory
adjusted peak = raw sampled peak - own browser blank memory
```

Each subtraction uses the same memory scope and metric. The table selects the minimum adjusted value for each column.
There is no extra idle offset, even if a saved report contains idle measurements.
The calculation does not subtract loaded-library checkpoints or warm session baselines. Library and fixture overhead therefore remain included.

Process churn and changes to shared mappings can still produce negative deltas. Negative estimates remain negative.
Missing or invalid blank observations make adjusted values unavailable, not zero. No other checkpoint or browser supplies a replacement.

Process measurements describe Linux process memory, not JS heap size or GPU device memory.
Sampled peaks are lower bounds. GC does not force native allocators or graphics caches to release memory.
Combined-mode tracing and process polling can affect the measured workload.

## Adapters and vendor policy

There are 45 matched dashboard variant modules: 44 default chart variants plus license-gated LightningChart.
Idle uses the shared lifecycle and has no chart module.
The dashboard reuses pinned vendors, native update methods, cleanup methods, and readiness helpers where applicable.
React adapters reuse `bench/framework-runtime.mjs` and `bench/lifecycle-frameworks.mjs` for committed roots, retained updates, and cleanup.

Each adapter exports `prepData`, `makeChart`, `updateChart`, `destroyChart`, and `validateChart`.
Preparation returns a separate synchronous input for each tile. Updates retain chart identity.
The diagnostic-only `benchmarkLifecycle.validate()` method checks the canonical frames and calls each adapter's `validateChart` for all 20 tiles.

In a separate diagnostic fixture, call `await benchmarkLifecycle.validate()` after each completed `benchmarkLifecycle.construct()`.
Do not call it during capture or preflight.

The suite applies these restrictions:

- `g2-webgl` and `googlecharts` remain disabled after benchmark timeouts.
- `jscharting` remains disabled because repeated samples retain destroyed charts and listeners.
- `lightningchart` requires `LIGHTNINGCHART_LICENSE`. Without a key, the suite records a skip and explicit selection fails.

The [`highcharts` adapter](highcharts.mjs) retains the native Boost thresholds.
At five series and 300 rows, it uses native SVG. Dashboard metadata records `context: 'svg'`, `sampling: 'none'`, and `lossy: false`.
This renderer choice is not a fallback after WebGL failure.

DevExtreme, Syncfusion, and Kendo can show vendor license banners that obscure charts.
The harness does not hide or dismiss these banners.
Vendor license checks and publication requirements remain separate from technical validation.
The [benchmark guide](../../scripts/benchmarks.md#license-and-availability-limits) describes license configuration and restrictions.

Twenty charts can exceed native WebGL context limits, including with `bokeh`, `d3fc`, `deckgl`, and `scichart`.
Bokeh caches its shared initializer result after module loading, not the pending promise. Concurrent first use can therefore allocate extra contexts.
The benchmark uses no context-limit overrides, renderer fallback, or prewarming. Only dashboard Plotly uses virtual WebGL.
ChartGPU creates one WebGPU device per chart and requires hardware WebGPU support.

### Plotly virtual WebGL

The `plotly` dashboard loads `virtual-webgl@1.0.7/src/virtual-webgl.js` before Plotly.
Both automated capture and `plotly.html` use this pinned WebGL1 build. Single-chart Plotly and dashboard `plotly-svg` do not use virtualization.
The package default is a different WebGL2 build, so the dependency specifies the full path.

The 20 charts use 40 virtual contexts over one shared native WebGL context.
The adapter retains `scattergl`. It rejects missing, lost, or nonvirtual contexts and the Plotly no-WebGL fallback.
Chrome retains its normal context limit. Virtualization adds context-switch and canvas-compositing costs, and its antialiasing behavior differs from native WebGL.
These costs belong to the dashboard result, not to a separate variant.

The WebGL observer reinstalls after virtualization, before capture starts. It observes virtual acquisitions and retains its integrity checks.
Completion uses the existing WebGL1 `finish()` checks and settling interval. These checks do not prove compositor presentation.
The vendor creates its shared native context during library loading, before the loaded-library checkpoint and session baselines.
That initial allocation belongs to loaded-library memory, not the per-session chart delta.
Blank-adjusted retained and peak memory include this allocation because they do not subtract the loaded-library checkpoint.

Cleanup calls `Plotly.purge()`, destroys retained regl instances, and disposes acquired virtual contexts, including contexts from partial construction failures.
Cleanup never acquires new contexts. The shared native context and compositor remain until the page closes.
Version 1.0.7 does not explicitly delete each virtual context's default VAO in `dispose()`.
This does not prove permanent driver leaks, but cleanup is not proven leak-free.
The benchmark does not patch vendor internals or measure GPU device memory.

Reports retain the case name `plotly` and record `virtualWebGL` version, path, and context type in the benchmark metadata.
Saved summaries require matching `virtualWebGL` metadata.
Virtualization does not remove the shared five-second operation budget or guarantee that a full capture completes.

## Saved results

Reports and compressed traces reside in `.cache/benchmarks/`. This cache is disposable.
The naming helpers in `scripts/benchmarks-suite.mjs` add `dashboard-` before the mode.
`MODE` is `combined`, `trace`, `memory`, or `raf`. Traces exist only for modes that enable tracing.

| Output | Default Chrome backend | Vulkan |
| --- | --- | --- |
| Suite | `results-chrome-dashboard-MODE.json` | `results-chrome-dashboard-MODE-vulkan.json` |
| Variant | `results-chrome-dashboard-MODE-VARIANT.json` | `results-chrome-dashboard-MODE-vulkan-VARIANT.json` |
| Trace | `trace-chrome-dashboard-MODE-VARIANT.json.gz` | `trace-chrome-dashboard-MODE-vulkan-VARIANT.json.gz` |

Suite and variant reports contain this workload snapshot:

```json
{
  "protocol": "dashboard-v1",
  "charts": 20,
  "series": 5,
  "rows": 300,
  "columns": 4,
  "gridRows": 5,
  "width": 480,
  "height": 216
}
```

Compatibility checks reject mixed single-chart and dashboard reports, or different dashboard dimensions, in every mode.
Saved summaries use the same checks.
Separate filenames prevent dashboard runs from replacing single-chart outputs.
They do not make different backends, DPRs, or diagnostic runs equivalent comparisons.

Older saved memory reports already contain each browser's blank checkpoint.
`--summarize-only` recalculates adjusted memory from saved raw observations with the new formula: raw live or peak minus its own browser blank.
It requires no new browser run or idle report. The raw `through-update-v1` lifecycle remains unchanged.
