# Benchmark library expansion

## Status and scope

The user approved the candidate decisions and implementation scope in this document.
The second expansion implements 13 adapters. Twelve join the existing 18 libraries, for 30 runnable defaults plus the idle control.
All 13 passed agent-reported direct browser smoke checks. JSCharting remains available as a standalone demo but fails the repeated-sample requirement.
All 12 runnable additions passed integrated combined measurements across the partial suite and separate workers.
The expanded suite did not complete as one run. The validation record distinguishes these results.
The successful 18-library run with Chrome Headless Shell 156.0.8078.47 is historical evidence for the first expansion only.
The [benchmark guide](../../scripts/benchmarks.md) describes commands, configuration, and measurement fields.

The workload remains 55,550 rows and three series at 1920 × 600 CSS pixels.
CPU and RAM share an automatic percentage axis. TCP Out uses a separate automatic MB axis.
Adapters retain every input row and the original time spacing. Native rendering reduction remains a documented library choice.
The comparison does not require identical interaction features or drawing algorithms.

## First expansion decisions

| Candidate | Decision | Implementation or limit |
| --- | --- | --- |
| Bokeh 3.10.1 | Add | WebGL lines through BokehJS. Canvas fallback causes an error. |
| d3fc 15.2.13 | Add | WebGL lines with D3 7.9.0 scales and SVG axes. |
| AG Charts Community 14.2.0 | Add | Community Canvas renderer and native line aggregation. No Enterprise modules. |
| Vega 6.4.0 | Add | Canvas renderer with independent percentage and MB scales. |
| SciChart 6.0.14 | Add | WebGL/WASM renderer with native automatic resampling. |
| LightningChart 9.0.0 | Update existing adapter | Current package is `@lightningchart/lcjs`. Remove the harness permission gate, but retain the runtime-key requirement. |
| Plotly GL | Already present | Existing `scattergl` adapter. No duplicate candidate. |
| Highcharts Boost | Already present | Existing Boost adapter. No duplicate candidate. |

The first expansion established 18 default libraries, plus the idle control.
The second expansion extends that default set to 30 runnable libraries.
`benchmarkRestrictions` blocks JSCharting repeated samples. The default suite reports an explicit skip, and explicit benchmark selection fails.
With `LIGHTNINGCHART_LICENSE`, the suite also includes LightningChart after those libraries.
Without a key, the suite reports an explicit LightningChart skip and its reason.
Explicit LightningChart selection without a key fails the availability check.

## Second expansion decisions

All 13 candidates in this table have implemented adapters and agent-reported direct browser smoke success.
Full-suite validation remains incomplete. JSCharting is excluded from repeated-sample benchmarks.

| Candidate and variant | Pin | Implementation |
| --- | --- | --- |
| Billboard (`billboard`) | `billboard.js` 4.1.3 | Packaged D3 bundle, Canvas lines, native `y`/`y2`, workers disabled. |
| AntV G2 (`g2`) | `@antv/g2` 5.4.8 | Canvas lines with shared percentage-scale keys and a separate TCP scale key. |
| Syncfusion (`syncfusion`) | `@syncfusion/ej2-charts` 35.1.41 | Canvas lines, Date input, native pixel-tolerance reduction. |
| DevExtreme (`devextreme`) | 26.1.6 `dx.viz.js` | Continuous datetime axis, native average aggregation, independent value axes. |
| JSCharting (`jscharting`) | `jscharting` 3.4.0 | Standalone only. Numeric XY pairs and native dual axes work, but vendor cleanup retains charts across samples. |
| Kendo (`kendo`) | `@progress/kendo-ui` 2026.3.1015 | Canvas `scatterLine`, Date input, and two native y axes. |
| AnyChart (`anychart`) | `anychart` 9.0.0 | AnyStock with continuous scatter time scale and native average grouping. |
| FusionTime (`fusiontime`) | `fusioncharts` 4.2.3 | Specialized timeseries renderer, native calendar bins, and two axes in one plot. |
| Google Charts (`googlecharts`) | Frozen `52`, mutable loader | Classic `LineChart`, datetime column, and native `targetAxisIndex`. |
| Recharts (`recharts`) | `recharts` 3.10.1, `d3-scale` 4.0.2 | SVG lines, public calendar ticks, continuous time scale, and independent `yAxisId` values. |
| MUI X Charts (`muicharts`) | `@mui/x-charts` 9.16.0 | Community SVG `LineChart` with independent y axes. |
| React Financial Charts (`financialcharts`) | `react-financial-charts` 2.0.1 | Canvas lines with two native Chart contexts at the same origin. |
| visx (`visx`) | `@visx/shape`, `axis`, `scale`, `grid` 4.0.0 | Custom SVG composition with native time and linear scales. |

### Deferred, held, and removed candidates

These decisions concern this workload and delivery path. They do not declare entire libraries incompatible with benchmarking or dual-axis charts.

| Candidate | Decision | Reason and remaining work |
| --- | --- | --- |
| ChartGPU | User hold | WebGPU needs a different completion protocol and device accounting. Current WebGL checks do not cover it. No performance conclusion. |
| Perspective | User hold | Analytics and worker transforms need a fair workload definition. Current tracked totals do not account for worker CPU. No performance conclusion. |
| Observable Plot | Defer | The ordinary chart API lacks an independent second y scale for this workload. No fake scaling or relabeled substitute axis. |
| Vega-Lite | Separate workload | Compilation into Vega needs its own timing boundary and result label. The Vega adapter does not measure compilation. |
| LayerCake 11.0.0 | Defer | Raw Svelte components need a dedicated compiler and custom chart setup. This is not an impossible-dual-axis claim. |
| Nivo | Defer | The normal Canvas line chart uses one y scale. A right axis does not create an independent scale. |
| Victory | Lower priority | The native dual-axis and dense-line audit remains outstanding. No incompatibility conclusion. |
| Tremor | Defer | Determine the underlying renderer before implementation, to avoid a duplicate wrapper comparison. |
| Frappe Charts | Defer | A continuous-time, independent-dual-axis path is not established for this workload. |
| Cytoscape | Workload mismatch | The library targets network graphs, not this time-series line comparison. |
| FusionCharts ordinary line | No separate adapter | The specialized FusionTime adapter represents this family for the time-series workload. |
| dvxCharts | Removed | The upstream distribution was unavailable during the candidate review. No performance conclusion. |

The LayerCake review recorded version-specific evidence from the upstream package metadata and source linked in this document.
LayerCake 11.0.0 requires Svelte >=5.40 and exports raw Svelte components, not ready-made lines and axes.
The esm.sh request with Svelte 5.57.2 returned HTTP 500 and `esbuild: Expected ";" but found "Cake"`.
A future adapter needs compilation before timing, custom axes and line layers, and browser validation of continuous time and independent y scales.

## Adapter decisions and caveats

Dependency pins come from [`bench/demo-dependencies.mjs`](../../bench/demo-dependencies.mjs) and [`bench/framework-runtime.mjs`](../../bench/framework-runtime.mjs).
The second-expansion table also records pins from adapter comments.
Each HTML wrapper and benchmark uses the same adapter functions for preparation, initialization, and cleanup.
Preparation allocates fresh data from the packed fixture. No adapter caches prepared data across samples.

### Bokeh

Source: [`bench/bokeh.mjs`](../../bench/bokeh.mjs).

- The loader supplies the core, GL, and plotting API bundles in that order.
- `ColumnDataSource` receives four Float64 columns with millisecond timestamps.
- `output_backend: 'webgl'` selects WebGL. The adapter checks that each line renderer actually uses it.
- Separate `DataRange1d` objects restrict their renderer lists to the correct series. Otherwise, another named range can affect automatic bounds.
- `lod_threshold: null` disables interaction sampling. The initial draw also retains the full input.
- `Plotting.show()` resolves after document idle in the pinned version. This signal is not a GPU fence.
- `getWebGLContexts()` exposes Bokeh's shared context for later samples.
- Cleanup removes the document and views but preserves the shared WebGL context. It does not force context loss.

The adapter uses internal view fields for renderer checks, context access, and cleanup.
Those fields need another check after a Bokeh version change.
The chart includes pan, wheel zoom, reset, and a vertical hover tool.

### d3fc

Source: [`bench/d3fc.mjs`](../../bench/d3fc.mjs).

- Four Float64 columns retain every input point and millisecond timestamp.
- `seriesWebglLine()` draws the lines. D3 constructs the SVG axes, title, legend, and hover cursor inside initialization.
- The adapter requires WebGL1 and `ANGLE_instanced_arrays`. It does not substitute Canvas.
- The public `scaleMapper` projects data through D3 in double precision before upload as screen coordinates.
- This projection avoids Float32 timestamp precision loss for the historical fixture. It does not change time spacing or emulate a second axis.
- Each y scale derives its domain from the corresponding full input columns.
- Initial drawing submits commands synchronously, then calls `gl.flush()`. A flush alone does not establish GPU completion.
- `getWebGLContexts()` exposes the chart-owned context. Cleanup removes handlers and releases that context through `WEBGL_lose_context` when available.

The adapter does not use the d3fc-element redraw queue or external sampling.
The custom SVG overlay adds hover values but not a full chart interaction system.
Its construction cost remains inside initialization.

### AG Charts Community

Source: [`bench/agcharts.mjs`](../../bench/agcharts.mjs).

- The Community UMD bundle registers the required modules, including native line aggregation.
- All three lines share one array of `{time, cpu, ram, tcp}` records.
- Keyed axes associate CPU/RAM with the left axis and TCP Out with the right axis.
- Point markers and labels are disabled. The Community bundle has no animation module.
- Native line aggregation remains enabled. The adapter does not reduce input rows before initialization.
- Initialization awaits `chart.waitForUpdate()`. Cleanup calls `chart.destroy()`.

This adapter measures the Community renderer, not an Enterprise configuration.
Its native aggregation can produce different visible detail from unsampled line renderers.

### Vega

Source: [`bench/vega.mjs`](../../bench/vega.mjs).

- One wide array of `{time, cpu, ram, tcp}` records supplies three Canvas line marks.
- Separate percentage and MB scales use automatic domains. Neither scale forces a zero baseline.
- No fold transform expands each input row into three tuples. No sampling removes input rows.
- Vega adds tuple identifiers, so initialization copies each prepared row before ingestion.
- Specification construction, parsing, tuple ingestion, domain calculation, layout, and Canvas rendering remain inside initialization.
- Initialization awaits `view.runAsync()`. A custom error logger converts dataflow errors into rejected initialization.
- Cleanup calls `view.finalize()` and removes the remaining DOM content.

The adapter has a title, axes, and legend, but no configured hover interaction.
Vega-Lite compilation is absent. A future Vega-Lite benchmark needs its own compilation boundary and result label.

### SciChart

Source: [`bench/scichart.mjs`](../../bench/scichart.mjs).

- Four Float64 columns retain the full input. `DateTimeNumericAxis` uses Unix seconds.
- The adapter selects 32-bit WASM, automatic SIMD selection, and native text rendering.
- `createSingle()` gives each chart its own WASM context. The chart starts suspended until all series exist.
- Each `XyDataSeries` reserves input capacity and declares sorted, evenly spaced data without NaNs.
- These declarations match this fixture. They are not assumptions for arbitrary input.
- `appendRange()` copies the full columns into native storage during initialization, not preparation.
- `FastLineRenderableSeries` uses `EResamplingMode.Auto`. Native min/max resampling changes drawing, not stored input.
- Initialization awaits `renderInstructionsCompleted` with no invalidation or animation. Render errors and timeouts reject initialization.
- Cleanup calls `delete()` to release the surface, series, native data, and its owned WASM context.

The adapter uses `SCICHART_LICENSE` as an optional runtime key.
Without that key, it calls the vendor's `UseCommunityLicense()` API.
Vendor technical checks and branding remain intact. The chart does not add a legend or interaction modifiers.
The adapter checks the vendor license state before ingestion and after rendering. Invalid or expired states reject the sample, even if a canvas exists.

### LightningChart

Source: [`bench/lightningchart.mjs`](../../bench/lightningchart.mjs).

- Version 9 uses `@lightningchart/lcjs`, not `@arction/lcjs`.
- The progressive schema uses Float64 storage, no automatic sorting, and native zoom-dependent grouping.
- The series capacity retains all input samples. Grouping does not replace the original dataset.
- Initialization awaits `renderframe` with no pending async rendering. This engine signal is not a GPU fence or presentation acknowledgment.
- Cleanup disposes the owner, not only the chart, to release the shared rendering engine.

The version 9 browser bundle requires a runtime key despite the optional license field in its declarations.
`LIGHTNINGCHART_LICENSE` remains a technical requirement. `LIGHTNINGCHART_LICENSE_INFORMATION` supplies optional vendor-required metadata.
The harness no longer requires `benchmarkPermission` or `LIGHTNINGCHART_BENCHMARK_PERMISSION`.
No fabricated key or automatic Community fallback replaces the runtime key.

## Second expansion adapter caveats

### Billboard and G2

Sources: [`billboard.mjs`](../../bench/billboard.mjs) and [`g2.mjs`](../../bench/g2.mjs).

- Billboard receives four named columns and uses its Canvas renderer. Its packaged bundle includes D3.
- `boost.useWorker: false` keeps rendering work out of workers because current tracked totals omit worker CPU.
- Billboard awaits `onrendered`. G2 awaits `chart.render()`.
- G2 receives one wide dataset. Explicit scale keys share CPU/RAM domains without merging TCP into that scale.
- Both adapters disable animation and point markers. Cleanup calls the native `destroy()` method.

### Syncfusion, DevExtreme, JSCharting, and Kendo

Sources: [`syncfusion.mjs`](../../bench/syncfusion.mjs), [`devextreme.mjs`](../../bench/devextreme.mjs), [`jscharting.mjs`](../../bench/jscharting.mjs), and [`kendo.mjs`](../../bench/kendo.mjs).

- Syncfusion and DevExtreme receive wide rows with Date values. Kendo receives Date-valued XY pairs. JSCharting receives numeric XY pairs.
- Syncfusion uses Canvas and native pixel-tolerance reduction. Initialization awaits `loaded`.
- DevExtreme enables native average aggregation with `aggregationGroupWidth: 1`. `synchronizeMultiAxes: false` preserves independent axes.
- DevExtreme awaits `onDone` and rejects error incidents. Evaluation warnings remain visible.
- JSCharting uses the ordinary line renderer without an adapter decimator. Initialization awaits the chart-ready callback.
- Kendo uses Canvas `scatterLine`, not a date-category line chart. This choice preserves calendar spacing.
- Kendo awaits `render`. The pinned source completes the initial Canvas draw synchronously before this event.
- A direct pixel probe validated Kendo output. The adapter no longer adds an extra rAF wait.
- Native cleanup remains in each adapter. Syncfusion and Kendo also remove DOM content that their native cleanup leaves behind.

### JSCharting repeated-sample exclusion

The pinned [production source](https://cdn.jsdelivr.net/npm/jscharting@3.4.0/dist/jscharting.js) reports build `3.4.0.20230215`.
Readiness works. The vendor `destroy()` leaves references through a global validate queue, window pointer listeners, and anonymous `beforeprint`/`afterprint` listeners.
The probe recorded post-GC memory of 415 MB, 818 MB, and 1,221 MB after successive samples.
Diagnostic removal through private APIs and CDP reduced those observations to 8.6 MB, 8.9 MB, and 9.3 MB.
That diagnostic cleanup is not shipped. The adapter retains native cleanup rather than private vendor patches.

[`jscharting.mjs`](../../bench/jscharting.mjs) and [`JSCharting.html`](../../bench/JSCharting.html) remain available.
`benchmarkRestrictions` blocks repeated samples and produces an explicit default-suite skip.
Re-entry requires a vendor fix or a future fresh-page sample protocol, not another readiness delay.

### AnyChart, FusionTime, and Google Charts

Sources: [`anychart.mjs`](../../bench/anychart.mjs), [`fusiontime.mjs`](../../bench/fusiontime.mjs), and [`googlecharts.mjs`](../../bench/googlecharts.mjs).

- AnyChart uses AnyStock with `xScale('scatter')`, not ordinal spacing that collapses calendar gaps.
- Its table receives all rows. Native grouping averages values, and two linear scales supply the y axes.
- AnyChart awaits `chartDraw`. Cleanup disposes the chart, table, mappings, and scales.
- FusionTime receives numeric timestamp rows. DataStore construction and ingestion remain inside initialization.
- DataStore appends row identifiers, so the adapter copies rows inside initialization before ingestion.
- Native calendar bins average each series. `multiCanvas: false` puts both y axes in one plot.
- FusionTime awaits `renderComplete`. Cleanup disposes the chart and DataStore.
- Google Charts prepares Date-valued rows. DataTable construction, ingestion, layout, and draw remain inside initialization.
- Its classic `LineChart` assigns CPU/RAM to axis 0 and TCP Out to axis 1. Initialization awaits `ready` and rejects chart errors.
- Google cleanup removes listeners and calls `clearChart()`.

Google Charts is an exception to fully pinned dependency delivery.
`prepareRuntime()` loads frozen version `52` and the remote `corechart` package before chart timers start.
The loader at `https://www.gstatic.com/charts/loader.js` is mutable. Google can apply critical fixes to frozen releases.
The runtime still needs network access. Cached loader bytes do not make remote packages fully offline or reproducible.
Recorded source hashes identify captured bytes, not a permanently immutable Google dependency graph.

### React adapters

Sources: [`recharts.mjs`](../../bench/recharts.mjs), [`muicharts.mjs`](../../bench/muicharts.mjs), [`financialcharts.mjs`](../../bench/financialcharts.mjs), and [`visx.mjs`](../../bench/visx.mjs).

- All four adapters prepare fresh wide rows with numeric millisecond timestamps.
- Recharts and MUI use native independent y axes and continuous time scales. Animation and point markers are disabled.
- Recharts generates calendar ticks with `d3-scale` inside `makeChart()` and supplies them through public `XAxis.ticks`. All input rows remain intact.
- Financial Charts uses a continuous `scaleTime()`, not its discontinuous financial time provider.
- `plotFull: true` prevents its default density threshold from trimming history.
- Two native Chart contexts share the same origin and x scale. Their y extents come from the full corresponding input series.
- visx composes SVG lines, axes, grid, title, and legend. Domain scans and component construction remain inside initialization.
- visx measures a custom chart composition, not a complete built-in interaction system.
- React root creation and `flushSync` commits remain inside initialization. Cleanup unmounts the root and removes its host.
- Recharts, MUI, and visx await three complete line paths. Financial Charts checks the committed Canvas chart and full `plotData` length.

## Production ESM delivery and framework pins

[`framework-runtime.mjs`](../../bench/framework-runtime.mjs) declares production esm.sh entries with exact package and peer versions.
The entries target ES2022 and do not request development builds.

| Adapter | Runtime and peer pins |
| --- | --- |
| Recharts, MUI, visx | React, React DOM, and `react-is` 19.3.1 |
| Recharts | `d3-scale` 4.0.2 for calendar ticks |
| React Financial Charts | React, React DOM, and `react-is` 18.3.1, plus `d3-scale` 4.0.2 |
| MUI | `@mui/material` and `@mui/system` 9.5.0, `@emotion/react` 11.14.0, `@emotion/styled` 11.14.1 |

The CLI integration uses [`scripts/bench-module-bundle.mjs`](../../scripts/bench-module-bundle.mjs) and the existing Rolldown/cache path before browser startup and chart timers.
It bundles the whole variant together, not each dependency separately. This preserves one shared React identity across the variant.
The browser imports the resulting local production ESM bundle.
Module loading does not mount a hidden React root or move chart construction outside initialization.
The cache records dependency URLs, source SHA-256 hashes, byte counts, the bundle hash, and the Rolldown version.
These records identify the captured source bytes. Version pins alone do not guarantee immutable CDN output.

## WASM timing and cache policy

[`bench/demo-runtime.mjs`](../../bench/demo-runtime.mjs) downloads WASM bytes before the chart timers start.
SciChart receives both SIMD and non-SIMD assets before initialization.
Stable Blob URLs and stable buffer identities allow normal browser compiler-cache and vendor-cache reuse across samples.
Chart teardown does not revoke URLs that later samples still need.

Compilation and instantiation initially occur in `makeChart()`, not hidden setup. Native ingestion also remains in initialization.
Later samples can reuse normal compilation caches. The benchmark does not force recompilation through artificial cache busting.
Warmup and minimum-value aggregation therefore do not represent a guaranteed cold compiler run.
Network download cost remains outside chart timing.

## WebGL completion protocol

Trace and memory modes use [`scripts/bench-webgl.mjs`](../../scripts/bench-webgl.mjs).
The protocol separates library readiness, rendering settle time, and WebGL command completion.
The sample order is:

1. Start context capture before sample preparation.
2. Time preparation separately.
3. Start the chart window and initialize the chart, including its library readiness signal.
4. Record `js-end` after initialization and its initial microtask commit.
5. Register reused contexts through adapter `getWebGLContexts()` hooks.
6. Allow rendering to settle with the existing frame waits and delay.
7. Run completion checks and query context metadata.
8. Record the sample `end` marker before forced GC or teardown.

WebGL2 uses `fenceSync()` and `flush()`, followed by timer-based `clientWaitSync()` polling with zero timeout.
WebGL1 uses blocking `gl.finish()` because it lacks WebGL2 sync objects.
The polling timeout cannot interrupt a blocking GL call. An external browser watchdog remains necessary.

The observer wraps current-realm `HTMLCanvasElement.getContext()` and `OffscreenCanvas.getContext()` before library loading.
It captures acquisitions during each sample and explicit contexts from adapter hooks.
This includes reused contexts only when an adapter exposes them or calls `getContext()` again.
Workers and other realms need their own observer. The current observer does not cover them automatically.

After completion checks, the observer queries raw `RENDERER`, `VERSION`, and optional `UNMASKED_RENDERER_WEBGL` strings.
Unavailable strings remain `null`. Strings can be masked and do not prove hardware acceleration.
No observed context is not proof that the library performed no GPU work.

Completion checks occur after `js-end` but before `end`: outside initialization, inside the chart window.
Thread-wall totals include fence submission/polling, blocking finish waits, and context-info queries.
This overhead can change scheduling. Completion latency is not hardware GPU busy time or exclusive CPU-active time.
Successful checks cover commands before each fence or finish call, not later draws or compositor presentation.

The rAF mode remains uninstrumented by these checks and context-info queries.
The trace still uses only `blink.user_timing` and `disabled-by-default-devtools.timeline`.
No arbitrary broad GPU tracing categories substitute for completion evidence.
The protocol adds no screenshots, canvas readbacks, or hardware timer queries.
Results from older unfenced runs do not use an equivalent measurement protocol.

## Trace storage and Recharts investigation

The full Recharts trace attempt failed with `ENOSPC` after a raw intermediate reached about 225 MiB.
The incomplete trace was removed. Compression solved disk exhaustion, but the next attempt still reported `dataLoss` with the 128 MiB trace buffer.
Before the calendar-axis fix, a diagnostic single-sample trace contained 55,504,254 bytes and 254,491 events.
`InvalidateLayout` and `ScheduleStyleRecalculation` accounted for 98.35% of those events.
The diagnostic probe counted 126,146 text-measurement `getBoundingClientRect()` calls, about 63,000 distinct strings, and a 2,000-entry cache.
No React profiler was active. These figures describe the faulty pre-fix axis, not the corrected adapter.

Recharts 3.10.1 automatically computes `niceTicks` only for linear scales.
For this time axis, `combineAxisTicks` selected every data timestamp before `scale.ticks()`, so `tickCount` did not produce calendar ticks.
The corrected adapter generates `scaleTime().domain([data[0].time, data[data.length - 1].time]).ticks(12).map(Number)` inside `makeChart()`.
It supplies these values through public `XAxis.ticks`, with `d3-scale` 4.0.2 as an explicit dependency.
This changes axis ticks, not input rows or chart bounds. It uses no custom grid generator, cache, measurement-span patch, or internal override.

Browser validation retained all 55,550 points per series and showed full-fixture labels at local midnight.
An irregular 03:07–07:59 range produced calendar ticks from 03:30 through 07:30.
The final combined worker passed 3 warmups and 7 measured samples under a 512 MiB Node heap limit.
Its gzip archive reported no `dataLoss`.

The capture path now requests Chrome `streamCompression: 'gzip'` and writes directly to the archive, without a raw intermediate.
The JSON analyzer streams the trace instead of loading the full document into memory.
The archive retains the full trace. Trace validation and `dataLoss` checks remain in place.
`trace.bytes` now counts saved gzip bytes and equals `trace.compressedBytes`, not the uncompressed JSON size.
A 690 MiB synthetic trace test used 189 MiB peak RSS with a 512 MiB Node heap limit.
The synthetic test validates trace handling separately from the successful final Recharts worker.

## Publication and vendor requirements

The user decides whether to publish results. The harness does not enforce a publication-policy acknowledgment.
This decision is not a legal conclusion, a vendor agreement, or a claim of publication permission.
Applicable vendor terms remain separate from benchmark configuration.
Vendor technical checks, runtime keys, and branding remain intact.

License keys belong in the local environment or a secret manager, not source files, manifests, or reports.
Vendor validation can require network access even with cached dependencies.
SciChart Community startup and LightningChart runtime-key startup remain distinct paths.

## Known limits and validation status

### Second expansion: partial suite and separate workers

All 13 new adapters passed agent-reported direct browser smoke checks. JSCharting is now excluded from repeated-sample benchmarks.
The suite attempt reached its 600-second timeout after idle and 22 libraries, through DevExtreme. The suite report remains incomplete.
No full-suite rerun followed this attempt.

| Validation | Result |
| --- | --- |
| Billboard, G2, Syncfusion, DevExtreme | Passed in the partial suite run, with 3 warmups and 7 measured samples each. |
| Kendo, AnyChart, FusionTime, Google Charts, MUI, React Financial Charts, visx | Separate workers passed, each with 3 warmups and 7 measured samples. |
| Recharts | Final combined worker passed 3 warmups and 7 measured samples under a 512 MiB Node heap limit. Gzip archive, no `dataLoss`. |
| JSCharting | Readiness passed, but vendor cleanup leaks prevent repeated-sample use. |
| Focused tests | 758 passed, 20 optional browser tests pending in this invocation. `git diff --check` passed. |

Google Charts added no observed WebGL context. These results establish no new hardware-GPU measurement claim.
The Kendo pixel probe was a separate diagnostic, not a readback inside benchmark timers.
All 12 runnable additions passed integrated combined measurements across these runs.
These results do not establish a completed 30-library suite or a performance ranking.

The separate untraced rAF pass completed 11 additions, each with 3 warmups and 7 measured samples.
Google Charts exceeded the 120-second CDP command limit for its entire ten-sample rAF batch. No rAF report was saved for Google Charts.
Its successful combined run used separate phase commands. Chart windows alone totaled approximately 120 seconds across that run.
These results predate the five-second per-sample watchdog. The current runner stops Chrome when any sample exceeds that budget.
No automatic longer-timeout retry followed the failure.
Successful rAF reports contain no trace, process-memory observations, or WebGL capture fields.
The harness does not force GC in rAF mode. Automatic browser GC remains possible.

### First expansion: historical validation

The live ECharts endpoint caveat remains: native min/max sampling ends the visible time range three minutes early for this fixture at DPR 1.
All 55,550 raw rows remain available. The adapter does not force a range to hide this difference.
Native aggregation, grouping, resampling, and interaction features also differ across libraries.

`npm run bench` completed all 18 default libraries and the idle control, with three warmups and seven measured rounds per library.
All five WebGL variants reported completion for every sample. Context metadata identified AMD Radeon through ANGLE/OpenGL, not SwiftShader.
LightningChart remained skipped because no runtime key was available.

The separate rAF pass completed the five first-expansion libraries without the context observer or completion checks.
Browser adapter checks also covered Bokeh, d3fc, AG Charts, and Vega at DPR 1 and 2.
SciChart rejected a deliberately invalid runtime key and rendered all source values through Community startup.

The first full run stopped on a D3 trace/report duration mismatch. A D3 retry and a complete suite retry passed without relaxing validation.
Some process-memory reads were incomplete. Reports retain those warnings and valid-sample counts, including one missing SciChart retained-memory sample.
The focused benchmark tests passed: 534 passing and 13 optional browser tests pending in the default invocation.
`git diff --check` passed. The SciChart combined worker also passed after the license-state fix.
These runs validate execution, not a publication-ready performance ranking.

## Upstream references

The first-expansion review recorded these upstream references:

- [Bokeh WebGL acceleration](https://docs.bokeh.org/en/latest/docs/user_guide/output/webgl.html): line support and automatic Canvas fallback. The adapter rejects that fallback.
- [d3fc series API](https://github.com/d3fc/d3fc/tree/master/packages/d3fc-series): WebGL lines, `scaleMapper`, `equals`, and pixel-ratio configuration.
- [AG Charts secondary axes](https://www.ag-grid.com/charts/javascript/axes-secondary/): keyed axes and series association in the 14.2.0 documentation.
- [Vega View API](https://vega.github.io/vega/docs/api/view/): Canvas selection, `runAsync()` completion, and `finalize()` cleanup.

The second-expansion adapter comments supply these additional references. This documentation update did not recheck their network availability.

- [Syncfusion Chart API](https://ej2.syncfusion.com/javascript/documentation/api/chart/): Canvas selection and `loaded`.
- [DevExtreme dxChart API](https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxChart/): chart configuration and lifecycle.
- [JSCharting 3.4.0 declarations](https://cdn.jsdelivr.net/npm/jscharting@3.4.0/dist/jscharting.d.ts): point formats and chart API.
- [Kendo Chart API](https://www.telerik.com/kendo-jquery-ui/documentation/api/javascript/dataviz/ui/chart): native axes, rendering, and lifecycle.
- [AnyStock scales](https://docs.anychart.com/Stock_Charts/Scales) and [data grouping](https://docs.anychart.com/Stock_Charts/Data_Grouping).
- [FusionTime y axes](https://www.fusioncharts.com/dev/fusiontime/fusiontime-component/y-axis-in-fusiontime) and [data-engine methods](https://www.fusioncharts.com/dev/fusiontime/fusiontime-data-engine/fusiontime-methods).
- [Google Charts loading](https://developers.google.com/chart/interactive/docs/basic_load_libs) and [classic LineChart](https://developers.google.com/chart/interactive/docs/gallery/linechart).
- [LayerCake 11.0.0 package metadata](https://cdn.jsdelivr.net/npm/layercake@11.0.0/package.json) and [source entry](https://cdn.jsdelivr.net/npm/layercake@11.0.0/dist/index.js).

The LightningChart adapter also links the [vendor license documentation](https://lightningchart.com/js-charts/docs/licenses/).
These references describe APIs and vendor requirements. They do not establish publication permission.
Version-specific implementation details in this record come from the linked local adapters, not an assumption about future library versions.
