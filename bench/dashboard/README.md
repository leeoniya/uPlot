# Dashboard benchmark

The dashboard benchmark measures 20 independent charts of one selected variant in one page.
It uses the existing benchmark runner, pinned vendors, trace accounting, and process-memory methodology.
The single-chart workload and its output filenames remain unchanged.

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
| `bun run bench:dash --variant uplot` | Idle control and local uPlot |
| `bun run bench:dash --variant chartjs --dpr 2` | Idle control and Chart.js at DPR 2 |
| `bun run bench:dash --verbose` | Include `main ms` and `gpu ms` in the trace table |
| `bun run bench:dash --summarize-only` | Recompute the saved combined summary without Chrome |
| `bun run bench:dash --memory --summarize-only` | Recompute the saved memory-only summary |
| `bun run bench:dash --no-vulkan` | Disable automatic Vulkan selection, but retain `--gpu` |

`--trace --memory` explicitly selects combined mode. `--raf` cannot combine with either flag.
`--verbose` changes the table, not the measurements or saved metrics.
`--summarize-only` uses the saved DPR. It rejects `--dpr`, `--variant`, `--worker`, and `--install-only`.

Combined and memory-only modes require Linux `/proc`. The runner uses Chrome Headless Shell and local production uPlot assets.
If the uPlot assets are absent or stale, run `bun run build` first.

On Linux, the default suite includes ChartGPU and automatically requests Vulkan for every worker, including idle.
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
Pointer interaction is enabled, but each adapter retains its benchmark configuration. For example, uPlot keeps its cursor disabled.
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
The lifecycle validates and freezes the canonical frames at fixture load, before capture and the memory baseline.
Each chart has five same-unit signals on one Y axis, with time on the X axis.
The source timestamps use milliseconds at one-minute intervals. Adapters convert timestamps to their native input formats.
This workload does not use the original packed data in `bench/data.json`.

Charts have no point markers or animation. Adapters use native legends where the library supplies them.
Custom drawing adapters and some framework adapters supply a small legend where necessary.
Each tile contains its axes and legend within the fixed tile size.

Each session has only two operations:

1. `small-init` creates all 20 hosts and charts with two rows per series: the first and last source rows.
2. `data-update` updates the same chart instances to all 300 rows per series.

The two-row input retains the full time range. No resize or hover operation occurs.
The idle control creates the same 20 empty hosts and uses the same operation schedule, without charts or data preparation.

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
`update ms` describes update readiness, and `next rAF` describes the callback latency after update readiness.
The rAF mode does not perform graphics completion checks or measure presentation.

## Memory

Memory capture uses `through-update-v1`, as in the single-chart benchmark.
The runner records one blank-page checkpoint and one loaded-library checkpoint before warmups.
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
The historical `dataDelta` field includes small initialization. It does not isolate input preparation.

Idle adjustment uses the same-run dashboard control with 20 empty hosts and matching dimensions.
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

The existing skip policy remains unchanged:

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

### Plotly virtual WebGL

The existing `plotly` dashboard loads `virtual-webgl@1.0.7/src/virtual-webgl.js` before Plotly.
Both automated capture and `plotly.html` use this pinned WebGL1 build. Single-chart Plotly and dashboard `plotly-svg` remain unchanged.
The package default is a different WebGL2 build, so the dependency specifies the full path.

The 20 charts use 40 virtual contexts over one shared native WebGL context.
The adapter retains `scattergl`. It rejects missing, lost, or nonvirtual contexts and the Plotly no-WebGL fallback.
Chrome retains its normal context limit. Virtualization adds context-switch and canvas-compositing costs, and its antialiasing behavior differs from native WebGL.
These costs belong to the dashboard result, not to a separate variant.

The WebGL observer reinstalls after virtualization, before capture starts. It observes virtual acquisitions and retains its integrity checks.
Completion uses the existing WebGL1 `finish()` checks and settling interval. These checks do not prove compositor presentation.
The vendor creates its shared native context during library loading, before the loaded-library checkpoint and session baselines.
That initial allocation belongs to loaded-library memory, not the per-session chart delta.

Cleanup calls `Plotly.purge()`, destroys retained regl instances, and disposes acquired virtual contexts, including contexts from partial construction failures.
Cleanup never acquires new contexts. The shared native context and compositor remain until the page closes.
Version 1.0.7 does not explicitly delete each virtual context's default VAO in `dispose()`.
Separate diagnostics found increasing VAO creation counts without explicit deletion. This does not prove permanent driver leaks, but cleanup is not proven leak-free.
The benchmark does not patch vendor internals or measure GPU device memory.

Reports retain the case name `plotly` and record `virtualWebGL` version, path, and context type in the benchmark metadata.
Saved summaries reject old native-dashboard Plotly reports or mismatched virtual-WebGL metadata. A new capture is necessary for those reports.

## Saved results

Reports and compressed traces reside in `.cache/benchmarks/`.
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
These checks also cover idle controls and saved summaries.
Separate filenames prevent dashboard runs from replacing single-chart outputs.
They do not make different backends, DPRs, or diagnostic runs equivalent comparisons.

## Browser validation

The browser validation artifacts are local files outside the repository:

- `/tmp/dashboard-validation/REPORT.md`
- `/tmp/dashboard-validation/RECHECK.md`
- `/tmp/dashboard-validation/FINAL.md`
- `/tmp/dashboard-validation/LATEST.json` (authoritative artifact manifest)

The initial validation passed 32 chart variants plus idle.
After seven adapter fixes, rechecks passed seven more variants.
The resulting coverage is 39 of 44 default chart variants, plus idle.
LightningChart is license-gated and is outside that default count.

The initial failures included `bokeh`, `d3fc`, `deckgl`, `plotly`, and `scichart`.
Four still have unresolved context-capacity errors: `bokeh`, `d3fc`, `deckgl`, and `scichart`.
The virtualized Plotly dashboard no longer has the observed context-capacity error, but full capture remains unverified as described below.
Bokeh also has an asynchronous cache race: its shared initializer caches the result after module loading, not the pending promise.
Concurrent first use can therefore allocate extra contexts.

The benchmark uses no context-limit overrides, renderer fallback, or prewarming. Only dashboard Plotly explicitly uses virtual WebGL.
ChartGPU passed with 20 WebGPU devices. That result does not establish WebGL capacity for another adapter.

Full three-warmup, seven-measured-session runs passed for idle, uPlot, and Chart.js in combined and memory-only modes.
Explicit native-data diagnostics passed for uPlot, Chart.js, Bokeh Canvas, and visx at DPR 1 and DPR 2.
uPlot and Chart.js also passed checks for tile geometry and canvas backing dimensions.
These checks do not establish equivalent coverage for every variant, DPR, backend, or measurement mode.

Final captures passed after the validation-boundary correction and supersede the earlier measurement artifacts.
Separate guarded captures completed with throwing validators and zero validation calls during measurement.
The diagnostic runs were separate. This coverage record contains no comparative timing or memory numbers and establishes no performance ranking.

### Plotly follow-up

The actual manual HTML page passed separate DPR 1 and DPR 2 diagnostics with all 20 charts visible.
All charts passed native-data validation, tile-geometry checks, canvas-backing-size checks, and nonblank-pixel checks.
Completion reported 40 complete virtual contexts with an intact observer. Cleanup disposed all 40 contexts exactly once.
Three repeated diagnostic sessions created and disposed 120 virtual contexts. The vendor registry returned to empty after each session.
Native context acquisitions stayed at one. The VAO caveat described above still applies.

Combined capture exceeded the unchanged five-second watchdog during the first warmup's `small-init` on this machine.
A separate timing diagnostic observed approximately 5.8 seconds from budget start through construction completion.
Both the default backend and Vulkan-requested combined runs timed out. A default-backend memory-only run also timed out.
The default-backend trace-only run reached trace export but exceeded the external 180-second timeout without a usable trace or report.
No complete Plotly timing/memory result or DPR 2 capture is available. The idle combined control completed all three warmups and seven measured sessions.
No deep validation, screenshots, or pixel readbacks occurred during measured capture.

Follow-up artifacts reside under `/tmp/dashboard-validation/`:

- `plotly-validation-summary.json`: manual-page and cleanup diagnostics.
- `plotly-timeout-evidence.json`: first-warmup timing evidence.
- `plotly-default-summary.json`: default-backend capture results.
- `plotly-retry-combined-idle-dpr1.json`: completed idle control.

These follow-up artifacts supersede the earlier Plotly context-failure classification, not the successful captures for other variants.
