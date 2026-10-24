# Benchmark library expansion

## Status and scope

The user approved the candidate decisions and implementation scope in this document.
The second expansion implements 13 adapters. The current default set contains 31 libraries and 41 variants, plus the idle control.
The manifest contains 46 demo IDs, including idle and the restricted variants.
Five sampled variants restore historical native reduction configurations. Their base configurations remain unchanged.
G2 WebGL and Google Charts are disabled for benchmarks after timeouts. Their standalone demos remain available.
Further G2 WebGL diagnostics stopped at the user's request.
ChartGPU is part of the default suite. No explicit selection is required for inclusion.
`benchmarkVariants` in `bench/demo-dependencies.mjs` defines their order, with `chartgpu` after `kendo`.
Each renderer alternative and sampled variant follows its base immediately.
The new `deckgl` variant follows `d3fc-canvas`. Its focused browser and worker validation appears in the deck.gl section below.
All 13 passed agent-reported direct browser smoke checks. JSCharting remains available as a standalone demo but fails the repeated-sample requirement.
Before the accuracy configuration changes, all 12 runnable additions passed integrated combined measurements across the partial suite and separate workers.
The expanded suite did not complete as one run. The validation record distinguishes these results.
The successful 18-library run with Chrome Headless Shell 156.0.8078.47 is historical evidence for the first expansion only.
The [benchmark guide](../../scripts/benchmarks.md) describes commands, configuration, and measurement fields.

The workload remains 55,550 rows and three series at 1920 × 600 CSS pixels.
CPU and RAM share an automatic percentage axis. TCP Out uses a separate automatic MB axis.
Adapters retain all 55,550 input rows and their original timestamps. No custom reduction replaces the native workload.
The deck.gl+D3 composition uses those timestamps in D3 scales, then supplies scaled coordinates to deck.gl inside initialization.
Native reduction can change processed output and visible time spacing. Full input retention does not guarantee full output or visual fidelity.
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
The second expansion initially extended that default set to 30 runnable libraries. Google Charts is now disabled.
`benchmarkRestrictions` blocks G2 WebGL, Google Charts, and JSCharting. The default suite reports explicit skips, and explicit benchmark selection fails.
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
| DevExtreme (`devextreme`) | 26.1.6 `dx.viz.js` | Continuous datetime axis, series aggregation disabled, independent value axes. |
| JSCharting (`jscharting`) | `jscharting` 3.4.0 | Standalone only. Numeric XY pairs and native dual axes work, but vendor cleanup retains charts across samples. |
| Kendo (`kendo`) | `@progress/kendo-ui` 2026.3.1015 | Canvas `scatterLine`, Date input, and two native y axes. |
| AnyChart (`anychart`) | `anychart` 9.0.0 | AnyStock with continuous scatter time scale and main and scroller grouping disabled. |
| FusionTime (`fusiontime`) | `fusioncharts` 4.2.3 | Specialized timeseries renderer, one-minute bins with average aggregation, and two axes in one plot. |
| Google Charts (`googlecharts`) | Frozen `52`, mutable loader | Classic `LineChart`, datetime column, and native `targetAxisIndex`. |
| Recharts (`recharts`) | `recharts` 3.10.1, `d3-scale` 4.0.2 | SVG lines, public calendar ticks, continuous time scale, and independent `yAxisId` values. |
| MUI X Charts (`muicharts`) | `@mui/x-charts` 9.16.0 | Community SVG `LineChart` with independent y axes. |
| React Financial Charts (`financialcharts`) | `react-financial-charts` 2.0.1 | Canvas lines with two native Chart contexts at the same origin. |
| visx (`visx`) | `@visx/shape`, `axis`, `scale`, `grid` 4.0.0 | Custom SVG composition with native time and linear scales. |

### Deferred, held, and removed candidates

These decisions concern this workload and delivery path. They do not declare entire libraries incompatible with benchmarking or dual-axis charts.

| Candidate | Decision | Reason and remaining work |
| --- | --- | --- |

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

### deck.gl+D3 default-suite inclusion

The shared [`bench/deckgl.mjs`](../../bench/deckgl.mjs) adapter supports the standalone [`deckgl.html`](../../bench/deckgl.html) demo and the default suite.
The manifest loads D3 7.9.0 before the deck.gl 9.4.0 production `dist.min.js` bundle.
The `deckgl` variant follows `d3fc-canvas` and counts as a separate library, not a D3 renderer alternative.

This adapter is a deck.gl+D3 composition. deck.gl does not supply a complete chart API for this workload.
D3 supplies automatic time bounds and calendar ticks, plus independent automatic percentage and MB scales.
D3 also supplies SVG axes, grid, legend, and cursor behavior.
CPU and RAM share the percentage scale. TCP Out uses the independent MB scale.

`prepData()` creates full Float64 columns without sampling or coordinate scaling.
Inside `makeChart()`, D3 scales every point in double precision before the adapter passes screen coordinates to deck.gl.
Three `PathLayer` objects each receive all 55,550 points. deck.gl performs native path normalization and connected-line tessellation.
Domain scans, coordinate scaling, path construction, and deck.gl initialization remain inside the initialization measurement.

The adapter explicitly creates a WebGL2 context and supplies it to deck.gl. It rejects a missing context rather than selecting another backend.
The adapter exposes that context through `getWebGLContexts()` for the existing completion protocol.
Cleanup removes listeners, finalizes deck.gl, releases the WebGL context, and removes the chart element.
The metadata is `{sampling: 'none', context: 'webgl2', lossy: false}`. These labels describe configuration, not measured visual accuracy.

The cache-only hardware test passed four samples: 200, 55,550, and 55,550 rows at DPR 1, then 200 rows at DPR 2.
Chrome Headless Shell 156.0.8078.47 used AMD hardware WebGL2 through ANGLE/OpenGL.
All three full native paths drew before adapter readiness. Initial and reused-context fences completed.
Cleanup removed the chart, lost the owned context, and stopped animation frames and draws.
The SVG matrix check permits 0.0001 CSS pixels of float32 rounding error. Full path-coordinate checks retain tighter tolerance.
A separate full-data screenshot showed all three series and axes, without a pixel-identity comparison.

The memory-only and combined workers each completed 3 warmups and 7 measured samples with Vulkan requested.
Every sample passed the five-second deadline and WebGL2 completion checks. The combined trace reported no data loss.
Reports are `.cache/benchmarks/results-chrome-memory-vulkan-deckgl.json` and `.cache/benchmarks/results-chrome-combined-vulkan-deckgl.json`.
The browser test report is `.cache/benchmarks/deckgl-browser-report.json`.
These runs had no fresh idle control. They do not establish adjusted memory, comparative performance, or a completed 41-variant suite.

### ChartGPU default-suite inclusion

The shared [`bench/chartgpu.mjs`](../../bench/chartgpu.mjs) adapter now supports the standalone [`ChartGPU.html`](../../bench/ChartGPU.html) demo.
The manifest pins `chartgpu` 0.4.0 through the existing production ESM loader.
The adapter uses native time and independent y axes, full typed columns, disabled sampling, and strict LOD.
Each chart creates a fresh device, submits an initial frame, and awaits `queue.onSubmittedWorkDone()` before enabling automatic rendering.
Cleanup disposes the chart and destroys the device. Native axes retain automatic domains and ticks without custom data scaling.
Time ticks use epoch-aligned duration steps rather than true calendar-month boundaries.

The cached Chrome Headless Shell 156.0.8078.47 exposed `navigator.gpu` in a secure localhost context.
Its `requestAdapter()` returned `null`, and Chrome reported `No available adapters.`
The opt-in browser test stopped before chart creation and recorded one pending test, not a successful rendering sample.
This baseline result remains separate from the subsequent Vulkan probe.

The adapter unit tests passed all 31 cases. The pinned production module bundle also built successfully.
The later Vulkan configuration passed native draw, queue completion, and device cleanup checks. Visual equivalence remains unverified.
The benchmark includes ChartGPU by default and checks WebGPU queue completion after settling.
ChartGPU still requires hardware WebGPU. Explicit single-variant selection remains available, but is not required for inclusion.
The [benchmark guide](../../scripts/benchmarks.md#chartgpu-demo-and-default-suite-benchmark) records the configuration and smoke-test commands.

For the full default suite, run:

```sh
bun run bench
```

On Linux, the harness automatically requests Vulkan for runs that include ChartGPU, including the default suite.
Every worker, including idle, receives the same resolved backend flags. Other platforms and focused runs without ChartGPU retain Chrome's default backend.
`--vulkan` forces Vulkan, while `--no-vulkan` disables automatic selection. Vulkan reports remain separate from older default-backend results.
Plain Linux `--summarize-only` selects the Vulkan report. `--summarize-only --no-vulkan` selects the older default-backend report.
LightningChart remains optional and requires `LIGHTNINGCHART_LICENSE`.

#### Headless WebGPU backend investigation

`vulkaninfo --summary` found AMD Radeon Graphics (RADV RENOIR), Mesa 26.2.5, and Vulkan API 1.4.354.
The installed driver exposes `VK_EXT_headless_surface`. Missing driver installation or render-device permissions did not explain the null adapter.

The cached browser uses Chromium revision `1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775`.
Its headless Ozone platform disables WebGPU Vulkan/GL interop.
The Linux adapter-selection path then needs a Vulkan shared context, which `--enable-gpu` alone does not select.
A separate launch added only `--enable-features=Vulkan` and obtained a non-fallback AMD adapter.
A GPU compute dispatch returned the expected `[7, 10, 13, 16]` after queue completion and readback, with no validation error.

| Observation | Baseline `--enable-gpu` | With `--enable-features=Vulkan` |
| --- | --- | --- |
| WebGPU service | Enabled | Enabled |
| Vulkan | Disabled | Enabled |
| WebGPU Vulkan/GL interop | Disabled | Disabled |
| Skia backend | GaneshGL | GaneshVulkan |
| WebGL renderer | AMD ANGLE/OpenGL | AMD ANGLE/OpenGL |
| WebGPU adapter | None | AMD `gcn-5`, `isFallbackAdapter: false` |

The flag explicitly selects native Vulkan and bypasses normal Vulkan compatibility selection. It is not a neutral benchmark configuration change.
No unsafe-WebGPU, broad blocklist override, software backend, ANGLE override, or sandbox-disabling flag was added.
The initial investigation left the browser backend defaults unchanged. The harness now automatically requests Vulkan for Linux runs that include ChartGPU.

The opt-in ChartGPU smoke then passed a 200-row chart and a fresh 55,550-row chart, each within the existing five-second limit.
The full chart submitted three `lineRenderer/pipeline` draws, each with six vertices and 55,549 segment instances.
The queue fence covered those submissions before readiness. Sampling remained disabled and LOD remained strict.
Both devices reported `reason: 'destroyed'` after explicit cleanup. No canvases or exposed device references remained.

| Instrumented sample | Ready ms, including preparation | External ms, including cleanup |
| --- | ---: | ---: |
| 200 rows × 3 | 175.7 | 181.6 |
| 55,550 rows × 3 | 77.1 | 81.6 |

These are single smoke observations, not benchmark minima. The full sample followed the small sample in the same browser.
Browser and driver caches can persist despite fresh devices. No controlled ranking or pixel-equivalence claim follows from these timings.

The reusable hardware probe is `scripts/investigate-webgpu.mjs`. It uses a five-second GPU probe limit and a twenty-second overall limit.
It saves separate `webgpu-probe-baseline.json` and `webgpu-probe-vulkan.json` reports under `.cache/benchmarks/`.
The ChartGPU smoke saves `chartgpu-browser-vulkan-report.json` without replacing the baseline report.

To reproduce the hardware-only comparison, run:

```sh
node scripts/investigate-webgpu.mjs baseline
node scripts/investigate-webgpu.mjs vulkan
```

Pinned Chromium sources:
- [Headless GPU and Ozone initialization](https://github.com/chromium/chromium/blob/1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775/headless/lib/headless_content_main_delegate.cc#L259-L272).
- [Linux WebGPU backend selection](https://github.com/chromium/chromium/blob/1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775/gpu/command_buffer/service/webgpu_decoder_impl.cc#L1756-L1764).
- [Ozone interop gate](https://github.com/chromium/chromium/blob/1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775/gpu/ipc/service/gpu_init.cc#L730-L749).
- [Explicit Vulkan selection](https://github.com/chromium/chromium/blob/1d17a2e2ee147bb7d6ae2ab6abdb3a2510c17775/gpu/command_buffer/service/service_utils.cc#L272-L369).

#### Integrated Vulkan benchmark

The runner now accepts `--vulkan`, which adds `--enable-gpu` and `--enable-features=Vulkan` to every worker, including idle.
It records the requested backend and rejects mismatched worker reports. Vulkan filenames preserve the separate default-backend results.

The following command completed the full workload on 2026-10-24:

```sh
node --max-old-space-size=512 scripts/benchmarks.mjs --variant chartgpu --vulkan
```

Idle and ChartGPU each completed three warmups and seven measured rounds, at DPR 1 and the unchanged five-second sample deadline.
All ten ChartGPU samples recorded successful device-queue completion. No sample timed out, and neither trace reported data loss.
Both workers reported Vulkan enabled and Skia GaneshVulkan. The prior hardware probe identified the non-fallback AMD adapter.
The dependency pin remains 0.4.0, despite the package's exported `version` value of 1.0.0.

| Variant | prep ms | init ms | main ms | gpu ms | total ms | peak MB | retained MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ChartGPU | 5.2 | 116.7 | 41.8 | 82.3 | 130.4 | 41.8 | 37.3 |

These are per-metric minima, not one representative sample. Initialization is elapsed time and includes asynchronous device creation and initial queue completion.
`gpu ms` and `total ms` cover selected traced host-thread wall intervals, not hardware GPU execution or complete CPU work.
Memory is baseline/idle-adjusted browser-tree PSS in decimal MB, not device memory.
The suite report is `.cache/benchmarks/results-chrome-combined-vulkan.json`. No controlled ranking against older non-Vulkan measurements follows from this run.

The trace audit found 17.353 ms of omitted renderer/GPU I/O work across seven measured ChartGPU rounds.
This equals 1.59% of the aggregate tracked work. Its inclusion would change the minimum tracked total from 130.372 to 134.754 ms.
The analyzer remains unchanged. Other omitted service-thread work was less than one millisecond across the measured rounds, excluding tracing instrumentation.
The enabled categories exposed no identifiable Dawn/Vulkan worker intervals. Queue completion does not establish complete host-work coverage.

Three construction polls encountered `/proc` entries that disappeared during discovery or verification: one idle observation and two ChartGPU observations.
The analyzer excluded their incomplete aggregates. Every selected memory minimum came from an unaffected sample.
One affected ChartGPU observation was a warmup. The missing measured poll can hide a higher round-specific peak, but cannot lower the selected minimum here.
Chrome also logged `Timeout while waiting for ACKs for tracing session 1`. This was not a benchmark sample timeout.
Unmatched trace begins occurred outside the measured chart windows or on another renderer. All measured windows retained valid timing metrics.

Focused regression tests passed 473 cases across suite selection, sample lifecycle, WebGPU completion, ChartGPU behavior, and process-memory accounting.

## Renderer alternatives

The renderer audit covers the pinned versions and this connected-line workload, not all chart types.
Six renderer alternatives are implemented. Five remain enabled.
With ChartGPU, deck.gl, and the five sampled variants, the default set contains 41 variants across 31 libraries, plus idle.
The renderer alternatives are `d3-svg`, `plotly-svg`, `highcharts-svg`, `bokeh-canvas`, `d3fc-canvas`, and `g2-webgl`.
Each thin wrapper uses its original adapter through `makeChartWithOptions` and shares preparation, automatic axes, and cleanup.
All retain 55,550 rows across three series. No custom sampling replaces the full workload.

The D3, Plotly, Highcharts, Bokeh, and d3fc pairs load identical vendor bundles.
The Highcharts SVG variant loads Boost but disables it through its public API.
G2 WebGL adds production renderer bundles to the original G2 dependency.

| Library | Current adapter | Alternative and decision |
| --- | --- | --- |
| D3 7.9.0 | Canvas lines | Added `d3-svg` with three full-data SVG paths and SVG axes, grid, and cursor. Shared automatic ranges and calendar ticks. |
| Plotly 4.1.2 | WebGL `scattergl` | Added `plotly-svg` with SVG `scatter`. Native SVG line simplification remains enabled by default. |
| Highcharts 13.1.1 | WebGL Boost | Added `highcharts-svg` with `boost.enabled: false`. Typed columns and automatic dual axes remain unchanged. |
| Bokeh 3.10.1 | WebGL lines | Added `bokeh-canvas` through `output_backend: 'canvas'`, with identical bundles and no WebGL contexts. SVG remains a candidate. |
| d3fc 15.2.13 | `seriesWebglLine` | Added `d3fc-canvas` through native `seriesCanvasLine`, with shared scales, SVG axes, and cursor. SVG remains a candidate. |
| AntV G2 5.4.8 | Canvas | Added `g2-webgl` through `@antv/g-webgl`. The 200-row smoke passed, but the full-data sample timed out. SVG remains a candidate. |
| ECharts 6.1.0 | Canvas `line` with minmax sampling | SVG is a direct renderer choice. ECharts GL is not a renderer switch for ordinary `line` series. |
| ApexCharts 8.4.1 | Canvas series with SVG decorations | SVG is another comparison candidate. The pinned implementation does not provide a WebGL renderer. |
| MUI X Charts 9.16.0 | Community SVG lines | Premium WebGL supports Bar, Scatter, and Heatmap, not Line. No GL substitution for this workload. |
| AG Charts Community 14.2.0 | Canvas lines with native aggregation | No supported WebGL or alternate SVG renderer found in the pinned implementation. |
| SciChart and LightningChart | GPU-oriented implementations | No interchangeable Canvas or SVG line backend verified in this audit. |

Highcharts Boost changes more than the drawing backend. It also changes data processing and interaction features.
Plotly SVG and GL have different internal algorithms and feature support.
These pairs compare supported end-to-end modes, not an isolated GPU-versus-CPU drawing operation.
Canvas and SVG can still cause GPU rasterization and compositing. Non-WebGL does not mean zero GPU-process work.

D3 Canvas and SVG share preparation, scale construction, ticks, pixel rounding, and pointer/legend behavior through `bench/d3.mjs`.
The SVG wrapper uses D3's native line-string generator without sampling or point objects.
Each series retains all 55,550 points. SVG string precision preserves the shared device-pixel coordinates, including fractional DPRs.
The fixture contains no Canvas element. Path generation and DOM construction occur inside initialization.
Cleanup removes listeners and cancels pending cursor frames.

### Renderer validation

The latest direct combined trace/memory workers ran sequentially in this order:
`idle`, `bokeh-canvas`, `bokeh`, `d3fc-canvas`, `d3fc`, and `g2`.
Each passed 3 warmups and 7 measured samples with all 55,550 rows and three series at DPR 1.
The current reports remain cached in `.cache/benchmarks/results-chrome-combined-VARIANT.json`.
The runs used hardware GPU acceleration. The Canvas alternatives added no WebGL contexts.
All ten samples of each WebGL counterpart passed completion checks.

| Variant | Minimum init ms | Minimum GPU thread ms | Minimum total ms | Peak MB | Retained MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| `d3fc` | 100.3 | 17.7 | 131.6 | 20.9 | 18.6 |
| `d3fc-canvas` | 111.4 | 18.4 | 147.1 | 26.3 | 22.9 |
| `bokeh` | 215.3 | 26.2 | 271.6 | 68.4 | 61.8 |
| `bokeh-canvas` | 215.2 | 59.9 | 317.0 | 66.6 | 57.4 |
| `g2` | 1304.6 | 13.3 | 1397.6 | 380.1 | 128.7 |
| `g2-webgl` | - | - | - | - | - |

These are per-metric minima from seven measured rounds, not one common best round.
Memory uses the existing browser-tree PSS calculation with the fresh idle worker and per-sample blank baselines.
Peak MB is the minimum of sampled per-round peaks. GPU thread time is host-thread work, not hardware GPU execution time.
The focused adapter and harness regression run passed 381 tests, with 13 opt-in tests skipped.

The first full-data `g2-webgl` combined sample exceeded the unchanged five-second budget. The worker exited with code 124.
The variant now has a benchmark restriction because of these timeouts. Its standalone demo remains available.
No timeout increase or reduced benchmark workload replaces this result. No full-workload G2 WebGL performance result is available.

The separate opt-in `test/integration/bench-g2-webgl-browser.mjs` passed one 200-row sample in 857 ms on AMD hardware WebGL2.
It checked three native GPU line paths, real GL draws, initial and reused-context fences, and cleanup.
Cleanup removed the canvas and cleared the exposed context.
Some resources had no observed explicit delete call. This observation does not prove a leak or complete resource release.
The smoke result validates the small workload only. It does not measure full-workload performance.

No full-suite rerun followed this batch. No cooldown separated the workers, and the runs did not reproduce controlled idle-machine conditions.
These results do not establish a controlled performance ranking. This documentation update did not rerun benchmarks or browser tests.

To rerun the enabled Canvas alternatives with the idle control, run the corresponding command:

```sh
npm run bench -- --variant bokeh-canvas
npm run bench -- --variant d3fc-canvas
```

For the separate 200-row smoke, run:

```sh
TEST_G2_WEBGL_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/bench-g2-webgl-browser.mjs
```

The smoke requires cached Chrome and vendor bundles. It downloads neither and does not retry the full workload.

The following results describe earlier renderer validation.

D3 SVG completed combined trace/memory and untraced rAF runs with 3 warmups and 7 measured rounds each.
The refactored D3 Canvas adapter also completed a combined worker run.
All used Chrome Headless Shell 156.0.8078.47, DPR 1, and the unchanged five-second sample budget.
The SVG combined run reported 8 incomplete idle process reads and 1 incomplete SVG process read. Details remain in its JSON reports.
The focused adapter, fixture, source-loader, and harness tests passed: 376 tests, including full-path and fractional-DPR checks with real cached D3.

All four Plotly and Highcharts variants completed 3 warmups and 7 measured rounds with Chrome Headless Shell 156.0.8078.47 at DPR 1.
These combined trace/memory workers used the unchanged five-second sample budget.
Both SVG variants reported no observed WebGL contexts in all samples.
Plotly used two WebGL1 contexts. Highcharts Boost used one. All GL completion checks passed with AMD hardware-backed ANGLE.

| Variant | Minimum init ms | Minimum total ms |
| --- | ---: | ---: |
| `plotly` | 349.9 | 417.5 |
| `plotly-svg` | 293.6 | 317.5 |
| `highcharts` | 640.9 | 663.0 |
| `highcharts-svg` | 951.0 | 1002.4 |

These local validation measurements do not reproduce the user's idle-machine conditions.
No fresh idle control accompanied these direct workers, so this table does not report adjusted memory.
The full expanded suite was not rerun. Renderer alternatives outside the implemented set remain source-audited, not browser-validated.

### G2 WebGL invisible-fill investigation

A source audit and bounded browser diagnostic identified unnecessary fill geometry for stroke-only G2 lines.
G2 5.4.8 sets the line theme’s `fill` to an empty string. The parsed style retains that empty string.
The WebGL path renderer tests `fill?.isNone`, not whether the fill is empty or transparent.
It therefore creates an `InstancedFillDrawcall` for each series and triangulates the open path with Earcut.
The uploaded fill color is fully transparent, but the renderer still constructs the geometry.

The diagnostic compared the unchanged adapter with the public line style `fill: 'none'`.
At both 200 and 2,000 rows, explicit `none` removed all three unique series fill drawcalls.
Both configurations retained one shared native stroke drawcall for the three series.
Path hashes, stroke colors, and widths matched. No pixel-by-pixel or interaction comparison was performed.
Both configurations completed hardware WebGL2 fences and chart cleanup.

| Rows per series | Default sample ms | Explicit `none` sample ms | Default fill count-calculation ms | Explicit `none` fill count-calculation ms |
| --- | ---: | ---: | ---: | ---: |
| 200 | 782 | 357 | 109.2 | 19.3 |
| 2,000 | 1467 | 452 | 966.1 | 8.9 |

These are single instrumented observations, not benchmark minima or representative timings.
Method times include nested work and must not be added together.
The count calculation also runs during batching merge checks, which repeatedly triangulate candidate paths.
Other chart components still need fill geometry, so scene-wide fill work does not reach zero.

This confirms unnecessary invisible-fill work in the theme/renderer interaction.
The shared G2 adapter now sets `style.fill: 'none'` for both Canvas and WebGL lines.
A subsequent full-data WebGL combined worker still timed out after five seconds and exited with code 124.
The change removes unnecessary work but does not resolve the full-workload timeout.
Neither the five-second sample budget nor the dataset size changed. No further full-data retry followed.

The updated 200-row browser smoke passed in 518 ms, including fences and cleanup.
All three rendered series reported `fill.isNone: true` and zero fill drawcalls, with native stroke drawcalls intact.
The focused G2 and grammar-adapter tests passed: 38 tests.
The earlier full-data Canvas measurements predate this configuration change. Canvas was not rebenchmarked in this follow-up.

Reproduce the four bounded samples with cached vendor bundles and Chrome:

```sh
node scripts/investigate-g2-webgl-fill.mjs
```

The script records `.cache/benchmarks/g2-webgl-fill-diagnostic.json` and uses a hard five-second limit per sample.
It adds temporary instrumentation only to the diagnostic page, restores the hooks, and removes its browser profile.
The script downloads no dependencies and does not retry the full dataset.
Its control explicitly restores the original empty fill, so the diagnostic remains reproducible after the adapter correction.

Pinned source references:

- [G2 5.4.8 line theme](https://unpkg.com/@antv/g2@5.4.8/lib/theme/create.js).
- [G2 5.4.8 line shape](https://unpkg.com/@antv/g2@5.4.8/lib/shape/line/curve.js).
- [g-webgl 2.1.3 source map](https://unpkg.com/@antv/g-webgl@2.1.3/dist/index.umd.min.js.map), including the path renderer and Earcut implementation.

### ECharts GL

The published `echarts-gl@2.1.0` package supports ECharts `^5.1.2 || ^6.0.0`.
Its README still describes the older ECharts 5 requirement. The published peer dependency is the current compatibility evidence.
The package exports `linesGL`, `scatterGL`, and 3D chart types, but no ordinary `lineGL` series.

`linesGL` supports Cartesian coordinates, polylines, and axis indices.
However, its series stores path coordinates separately from its one-dimensional `value` list.
That list does not expose the path coordinates as x/y dimensions for automatic axis ranges.
This source audit does not establish a fair automatic-range replacement for the existing `line` adapter.
No hardcoded bounds, invisible helper series, or manual domain workaround was added.
An ECharts GL variant remains deferred pending a supported automatic-range solution and browser validation.

### Remaining renderer candidates

Bokeh Canvas, d3fc Canvas, and G2 WebGL are implemented. Their validation results appear in [Renderer validation](#renderer-validation).
ECharts SVG and ApexCharts SVG remain lower-cost additional comparisons.
Bokeh SVG, d3fc SVG, and G2 SVG also remain candidates.
MUI Pro line sampling is a possible separate paid-feature comparison, not a WebGL line variant.
The experimental G2 WebGPU renderer remains separate from this WebGL audit and requires a different completion protocol.

### Renderer audit references

- [Plotly WebGL and SVG](https://plotly.com/javascript/webgl-vs-svg/).
- [Highcharts Boost configuration and limits](https://www.highcharts.com/docs/advanced-chart-features/boost-module).
- [Bokeh WebGL glyph support](https://docs.bokeh.org/en/latest/docs/user_guide/output/webgl.html).
- [d3fc Canvas, SVG, and WebGL series](https://github.com/d3fc/d3fc/blob/master/packages/d3fc-series/README.md).
- [G2 5.4.8 renderer guide](https://github.com/antvis/G2/blob/v5.4.8/site/docs/manual/extra-topics/plugin/renderer.en.md) and [WebGL example](https://github.com/antvis/G2/blob/v5.4.8/site/examples/renderer/renderer/demo/webgl.ts).
- [ECharts Canvas and SVG](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/).
- [ECharts GL 2.1.0 package](https://cdn.jsdelivr.net/npm/echarts-gl@2.1.0/package.json), [chart exports](https://cdn.jsdelivr.net/npm/echarts-gl@2.1.0/lib/export/charts.js), and [LinesGLSeries](https://cdn.jsdelivr.net/npm/echarts-gl@2.1.0/lib/chart/linesGL/LinesGLSeries.js).
- [ApexCharts 8.4.1 renderer controller](https://github.com/apexcharts/apexcharts.js/blob/v8.4.1/src/modules/RendererController.js).
- [MUI X 9.16.0 performance guide](https://github.com/mui/mui-x/blob/v9.16.0/docs/data/charts/performance/performance.md).
- [AG Charts large-dataset guidance](https://www.ag-grid.com/charts/javascript/large-dataset-interactivity/).

## ApexCharts spike preservation

The base demo disables `chart.dataReducer` in ApexCharts 8.4.1 to avoid the loss of opposite extrema within one LTTB bucket.
`apexcharts-sampled` restores native LTTB with `targetPoints: 1920` and `threshold: 3840`.
The pinned [Data.js implementation](https://github.com/apexcharts/apexcharts.js/blob/v8.4.1/src/modules/Data.js) calls `Data.lttbDownsample()` directly for scalar-y lines.
The [type declarations](https://github.com/apexcharts/apexcharts.js/blob/v8.4.1/types/apexcharts.d.ts) provide no `name: 'minmax'` selection.
The deprecated `algorithm: 'lttb'` field also has no effect.
Range and OHLC inputs use different aggregators, but changing the chart's data shape would change this workload.

Both variants keep the Canvas renderer, full input, and automatic dual axes.
For the base variant, a runtime check rejects series shorter than 55,550 values.
The check uses public `getState()` after the chart timing window. The sampled variant permits native reduction of processed output.
Earlier ApexCharts results used LTTB and are not directly comparable to the base configuration.
Those results do not validate the new sampled wrapper. Legacy reports without metadata cannot identify their sampling configuration from the variant name alone.
The revised base adapter passed 3 warmups and 7 measured rounds in Chrome Headless Shell 156 at DPR 1, within the five-second sample budget.
Every round passed the full-series check. The run reported two incomplete process-memory reads, retained as warnings in its JSON report.
The focused adapter and sample-lifecycle tests passed: 113 tests.

For a future native min/max reducer, the bucket count must track the visible plot width and intended pixel resolution.
An output-point target is not necessarily a bucket count. Each bucket can require two extrema, or first/min/max/last in time order.
Min/max preserves the bucket's range, not every oscillation inside it.
No width-derived LTTB target can guarantee preservation of both opposite extrema.

## Grouping and accuracy limits

The amCharts base sets `groupData: false`, `minDistance: 0`, and `exactLocationX: true`.
These controls disable date grouping and distance-based line simplification and use original timestamps.
The DevExtreme base disables series aggregation. The AnyChart base disables both main and scroller grouping, so its average mapping remains inactive.
The sampled variants restore native reduction separately, without changes to these bases.

The FusionTime base permits only `minute: [1]` bins. All other binning units use empty arrays.
Average aggregation remains enabled. The current minute-aligned fixture has one observation per bin, so the average does not combine observations.
Multiple observations within a minute can merge and hide peaks. This configuration does not preserve arbitrary sub-minute data.

The ApexCharts base disables its LTTB-only reducer. Its sampled variant enables LTTB. ECharts still uses `sampling: 'minmax'`.
ECharts 6.1.0 ends the visible time range three minutes early for this fixture at DPR 1, despite full raw input retention.
Input retention and disabled reducers do not guarantee identical output or preservation of every visible feature.
Native reduction in other adapters and differences in ranges, pixel resolution, and rendering remain relevant limits.

The previous agent reported 63 passing tests and 3 skipped opt-in tests for the four grouping-related adapter changes.
Sequential combined trace/memory workers passed 7 measured samples each for amCharts and AnyChart.
The DevExtreme and FusionTime bases timed out under the unchanged five-second sample budget.
Those timeouts do not establish completed measurements or visual fidelity for their base configurations.
This documentation update did not rerun tests or workers and did not change the timeout.

## Sampled variants

Five new default variants follow their bases immediately:

| Base | Sampled variant | Restored native configuration |
| --- | --- | --- |
| `apexcharts` | `apexcharts-sampled` | LTTB through `dataReducer: {enabled: true, targetPoints: 1920, threshold: 3840}`. |
| `amcharts` | `amcharts-sampled` | `groupData: true`, `groupCount: 1920`, and intervals of one minute, ten minutes, and one hour. Series use `valueYGrouped: 'average'` and `minDistance: 1`. The configuration omits `exactLocationX`. |
| `devextreme` | `devextreme-sampled` | `aggregation: {enabled: true, method: 'avg'}` with `argumentAxis.aggregationGroupWidth: 1`. |
| `anychart` | `anychart-sampled` | Native main and scroller grouping defaults instead of explicit grouping-disable calls. The average mapping and `xScale('scatter')` remain unchanged. The visible scroller remains disabled. |
| `fusiontime` | `fusiontime-sampled` | Omission of `xAxis.binning` restores default calendar bins. Average aggregation remains enabled, as in the base with restricted one-minute bins. |

The wrappers reuse their base adapters through `makeChartWithOptions`. Each pair shares dependency pins, preparation, automatic dual axes, and cleanup.
Both variants supply all 55,550 rows across three series to the library. No custom reducer or pre-reduced input changes this workload.
The base configurations remain unchanged.

LTTB can lose one of two opposite extrema in a bucket. Average aggregation can attenuate or remove peaks.
Grouping and distance-based simplification can also change timestamps and visible detail.
The sampling labels describe configuration, not an accuracy guarantee or a measured output count.

All five sampled variants passed sequential trace-only workers with cached Chrome Headless Shell 156.0.8078.47 and Vulkan.
Each worker completed three warmups and seven measured samples. No sample timed out, and no trace reported data loss.
The harness validated all 55,550 prepared rows and the rendered surface and lifecycle checks. ApexCharts also passed its sampled-output check.
Reports use `results-chrome-trace-vulkan-VARIANT.json` under `.cache/benchmarks/` and contain the new metadata snapshots.
The workers did not measure memory or establish visual accuracy. They do not establish comparative performance or a completed run of the then-current 40-variant suite.
The five-second timeout, Google Charts and G2 WebGL restrictions, and ChartGPU automatic Vulkan selection remain unchanged.

For a comparison with the full Linux suite, use `--vulkan` for both variants:

```sh
npm run bench -- --variant apexcharts --vulkan
npm run bench -- --variant apexcharts-sampled --vulkan
```

For another pair, use the identifiers in the table.
For Chrome's default backend, omit `--vulkan` from both commands.
Focused runs without ChartGPU do not automatically request Vulkan.
The [benchmark guide](../../scripts/benchmarks.md#compare-sampled-and-base-variants) lists commands for all five pairs.

## Sampling and context metadata

The tables start with `variant`, `context`, `sampling`, and `lossy`, followed by the measurements.
The `variant` column repeats compact library names. Renderer and sampled alternatives stay together, while JSON and CLI selection retain full variant IDs.
Trace and combined tables rank groups by their fastest implementation's `total ms`. rAF tables use `next rAF ms`.
Implementations appear fastest first within each group, with failed or unavailable entries last. Memory-only tables preserve execution order with library groups together.
`benchmarkMetadata` in `bench/demo-dependencies.mjs` defines these labels.
Per-variant reports save snapshots in `runner.benchmark`. Suite reports save snapshots in `variantMetadata`.
Saved summaries use the snapshots, not today's manifest. Legacy reports without sampling snapshots show `unavailable`, without guesses about historical configuration.

The table leaves sampling cells blank for `sampling: 'none'`. Reports retain that value to distinguish no configured reduction from missing metadata.
A blank cell does not guarantee visual fidelity or the absence of internal processing.
Existing labels cover `minmax`, `pixel-distance`, `pixel-tolerance`, `conflation`, `simplify`, `aggregation`, `grouping`, and `avg (1min)`.
SciChart `Auto` resampling uses the same `minmax` label as uPlot, Chart.js, and ECharts, based on the native-output tests below.
The sampled labels are `LTTB (1920)`, `avg+distance`, `avg (1px)`, and `avg (calendar)`.
These labels do not guarantee accuracy, peak preservation, or identical algorithms across libraries.

`lossy` marks potentially lossy reduction with `*`. This includes LTTB, averaging, closing-value conflation, distance/tolerance reduction, and line simplification.
No configured reduction and verified min/max strategies have blank markers. This exemption concerns bucket extrema, not identical rasterization or every oscillation.
The pinned AG Charts line aggregator retains first/last and min/max indices, including its coarser levels, so it also has a blank marker.
SciChart `Auto` matched explicit `MinMax` in the pinned accuracy matrix and receives a blank marker.
LightningChart grouping remains `?` because final-bucket preservation lacks licensed runtime confirmation.
FusionTime's one-minute averaging receives `*` for its ability to merge sub-minute observations, despite the current fixture's one-observation-per-minute spacing.
New reports save `lossy` as `true`, `false`, or `null` with the other metadata. Historical reports without this field show `?`.

`context` identifies the primary-series backend, not axes, support probes, or export canvases.
`webgl` means WebGL1 exactly. `webgl2` is distinct.
Static `svg`, `2d`, `webgl`, and `webgpu` labels describe configured backends, not measured hardware acceleration.
Support GL contexts do not establish that Canvas or SVG series use WebGL.

SciChart, LightningChart, and G2 WebGL use measured GL evidence for conditional context labels. Warmup evidence does not count.
Missing or ambiguous evidence produces `unavailable`, including rAF reports without GL capture.
Legacy reports can use unambiguous measured context evidence for known WebGL series, but cannot infer historical sampling configuration.
The five sampled workers saved the expected `sampling` and `context` labels. None reported an observed WebGL context.
The focused regression run passed 810 tests, with three optional browser tests skipped, including coverage for metadata snapshots, legacy reports, and table formatting.

## Adapter decisions and caveats

Dependency pins come from [`bench/demo-dependencies.mjs`](../../bench/demo-dependencies.mjs) and [`bench/framework-runtime.mjs`](../../bench/framework-runtime.mjs).
The second-expansion table also records pins from adapter comments.
Each HTML wrapper and benchmark uses the same adapter functions for preparation, initialization, and cleanup.
Preparation allocates fresh data from the packed fixture. No adapter caches prepared data across samples.

### Bokeh

Sources: [`bench/bokeh.mjs`](../../bench/bokeh.mjs) and [`bench/bokeh-canvas.mjs`](../../bench/bokeh-canvas.mjs).

Both modes share `makeChartWithOptions`, preparation, automatic axes, full Float64 columns, and cleanup.
The Canvas wrapper selects `output_backend: 'canvas'` and creates no WebGL contexts.
It loads the same core, GL, and plotting API bundles as the original to control library-load costs.
The WebGL checks and shared-context behavior below apply to the original mode.

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

Sources: [`bench/d3fc.mjs`](../../bench/d3fc.mjs) and [`bench/d3fc-canvas.mjs`](../../bench/d3fc-canvas.mjs).

The Canvas wrapper uses shared `makeChartWithOptions` with native `seriesCanvasLine` and no custom sampling.
Both modes share full Float64 columns, automatic scales, SVG axes, and the SVG cursor.
Both use `lineWidth(1 / DPR)` or its Canvas equivalent for one-physical-pixel lines. The validation runs used DPR 1.
The Canvas mode returns no WebGL contexts. The WebGL requirements and projection below apply to the original mode.

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
- `FastLineRenderableSeries` uses `EResamplingMode.Auto`. Native resampling changes drawing, not stored input.
- Initialization awaits `renderInstructionsCompleted` with no invalidation or animation. Render errors and timeouts reject initialization.
- Cleanup calls `delete()` to release the surface, series, native data, and its owned WASM context.

The adapter uses `SCICHART_LICENSE` as an optional runtime key.
Without that key, it calls the vendor's `UseCommunityLicense()` API.
Vendor technical checks and branding remain intact. The chart does not add a legend or interaction modifiers.
The adapter checks the vendor license state before ingestion and after rendering. Invalid or expired states reject the sample, even if a canvas exists.

#### SciChart reduction accuracy

The cache-only diagnostic is [`test/integration/scichart-reduction-browser.mjs`](../../test/integration/scichart-reduction-browser.mjs).
It compares native `Auto`, explicit `MinMax`, and `None` without changing precision or reduction thresholds.
The benchmark adapter retains `Auto`. Diagnostic mode changes do not affect benchmark configuration or timings.
The diagnostic uses public Community licensing and retains vendor checks and branding.

After settled rendering, the diagnostic copies `getCurrentRenderPassData().pointSeries` X/Y/index vectors before another render or disposal.
These are the line renderer's data-space inputs, not the original stored data or screenshot pixels.
The drawing-provider range limits apply to unresampled vectors. The diagnostic never deletes borrowed WASM vectors.
Pinned JavaScript forwards `Auto` unchanged into WASM, so output equality does not identify every possible native selection branch.

The matrix contains 42 configurations and 46 series comparisons:

- The full 55,550-row, three-series benchmark at 1920×600, at DPR 1 and 2.
- All six existing accuracy cases: opposite spikes, nonuniform spacing, adjacent spikes, isolated spike, short plateau, and missing interval.
- Four additional edge cases, with spike offsets of 0, 1, 4, and 16 samples from the ends.
- Each adversarial case at widths 580 and 1920, at DPR 1 and 2.

Sparse and missing-value cases use truthful distribution and NaN flags, rather than the benchmark's uniform, finite-data declarations.
All 46 comparisons produced exactly equal X, Y, and index arrays for `Auto` and `MinMax`.
Native reduction was active in 36 comparisons. Ten dense-display configurations retained the full input.
`None` matched the complete input in every comparison.

| Full benchmark output points | CPU | RAM | TCP Out |
| --- | ---: | ---: | ---: |
| DPR 1 | 6,512 | 6,512 | 4,888 |
| DPR 2 | 13,022 | 12,998 | 8,692 |

No global extrema or adversarial spikes were lost. Adversarial spikes retained their exact X/Y locations.
No gap runs were lost in these vectors, but that does not establish visible gap preservation.
Strict physical-pixel buckets had 1,753 envelope differences. None remained when the comparison included adjacent buckets.
This tolerance allows bucket-boundary differences. It is not a pixel-identity test.
Exact endpoints were omitted in 29 series observations, with a maximum horizontal edge shortfall of 0.347 physical pixels.
Dense local oscillations and plateau interiors can still disappear, as with other min/max reducers.

This evidence supports `lossy: false` under the benchmark's existing min/max exemption, not a universal losslessness guarantee.
New reports use this classification. Saved reports retain their original snapshots and can still show `?`.
Chrome Headless Shell 156.0.8078.47 completed the diagnostic without render failures or browser exceptions.
The report, including source hashes and discrepancy examples, is `.cache/benchmarks/scichart-reduction-report.json`.

```sh
TEST_SCICHART_REDUCTION_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/scichart-reduction-browser.mjs
```

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

The reduction investigation found no `LIGHTNINGCHART_LICENSE` in the environment, so it performed no licensed rendering test.
The pinned production bundle's `Cb` reducer selects column minima and maxima in sample-index order.
Its synchronous path appears to omit the final accumulated column when input ends, without a final flush.
For example, a unique final-sample peak can remain in that column when the visible range contains the entire input.
The inspected `Tb` output and `Lb` upload path did not reveal an endpoint append that resolves this concern.
This is a source-level concern, not an observed rendering failure or a claim about the benchmark dataset.
The `lossy` classification remains unknown until a licensed runtime test or vendor clarification resolves final-bucket preservation.

Source: [9.0.0 production bundle](https://cdn.jsdelivr.net/npm/@lightningchart/lcjs@9.0.0/dist/lcjs.iife.es2019.js), 1,536,497 bytes.
SHA-256: `0812870f4a0be16a495dba6a5db1fe8cf5e586ce885fa23bd795bcd5b50125b4`.
The public `readBack()` API returns stored input, not grouped rendering output, so input retention cannot resolve this question.

## Second expansion adapter caveats

### Billboard and G2

Sources: [`billboard.mjs`](../../bench/billboard.mjs) and [`g2.mjs`](../../bench/g2.mjs).

- Billboard receives four named columns and uses its Canvas renderer. Its packaged bundle includes D3.
- `boost.useWorker: false` keeps rendering work out of workers because current tracked totals omit worker CPU.
- Billboard awaits `onrendered`. G2 awaits `chart.render()`.
- G2 receives one wide dataset. Explicit scale keys share CPU/RAM domains without merging TCP into that scale.
- Both adapters disable animation and point markers. Cleanup calls the native `destroy()` method.

The [`g2-webgl.mjs`](../../bench/g2-webgl.mjs) wrapper uses shared G2 `makeChartWithOptions` with a `G.WebGL.Renderer`.
Preparation, full wide rows, automatic dual axes, and chart configuration remain shared with G2 Canvas.
The loader supplies these production UMD bundles in order:

1. `@antv/g2` 5.4.8, `dist/g2.min.js`, with global `G2`.
2. `@antv/g-lite` 2.7.2, `dist/index.umd.min.js`, with global `G`.
3. `@antv/g-webgl` 2.1.3, `dist/index.umd.min.js`, with global `G.WebGL`.

The adapter requires an active renderer-owned context and rejects Canvas fallback.
It checks that all three line elements are native GPU paths with `InstancedPathDrawcall` or `InstancedLineDrawcall` instances.
It exposes the renderer-owned context through `getWebGLContexts()` for capture and completion checks, including WebGL2 fences.
It creates no probe context. Cleanup calls native `destroy()` and clears the context hook.
These internal path checks require review after a version change.

The [validation record](#renderer-validation) separates the successful 200-row smoke from the full-data timeout.

### Syncfusion, DevExtreme, JSCharting, and Kendo

Sources: [`syncfusion.mjs`](../../bench/syncfusion.mjs), [`devextreme.mjs`](../../bench/devextreme.mjs), [`jscharting.mjs`](../../bench/jscharting.mjs), and [`kendo.mjs`](../../bench/kendo.mjs).

- Syncfusion and DevExtreme receive wide rows with Date values. Kendo receives Date-valued XY pairs. JSCharting receives numeric XY pairs.
- Syncfusion uses Canvas and native pixel-tolerance reduction. Initialization awaits `loaded`.
- The DevExtreme base sets `aggregation: {enabled: false}` in `commonSeriesSettings`. The sampled variant enables average aggregation with a one-pixel group width.
- Both variants use `synchronizeMultiAxes: false` to preserve independent axes.
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
- Its table receives all rows. In the base, `grouping().enabled(false)` and `scrollerGrouping().enabled(false)` disable grouping. The average mapping remains inactive.
- The sampled variant retains native grouping defaults and the same average mapping. Both variants disable the visible scroller and use two linear y scales.
- AnyChart awaits `chartDraw`. Cleanup disposes the chart, table, mappings, and scales.
- FusionTime receives numeric timestamp rows. DataStore construction and ingestion remain inside initialization.
- DataStore appends row identifiers, so the adapter copies rows inside initialization before ingestion.
- In the FusionTime base, `xAxis.binning` sets `minute: [1]` and empty arrays for `year`, `month`, `day`, `hour`, `second`, and `millisecond`.
- The sampled variant omits `xAxis.binning` to retain native default calendar bins. Both variants keep average aggregation.
- The base has one observation per bin for the current minute-aligned fixture. Multiple observations within a minute can merge and hide peaks.
- `multiCanvas: false` puts both y axes in one plot.
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

## Visual reduction accuracy

[`demos/reduction-accuracy.html`](../../demos/reduction-accuracy.html) compares uPlot with seven libraries, one pair at a time.
Both charts receive the same input. The demo uses native reducers, not a custom implementation or pre-reduced data.
It shares vendor version pins and the dependency loader with the benchmark demos.

The datasets cover opposite spikes, nonuniform spacing, adjacent peaks, an isolated peak, a short plateau, and a missing interval.
Each dataset has 10,002 samples. All libraries receive the same millisecond-grid fixture.
Date-based libraries receive integer timestamps from January 1, 2024 (UTC).
The nonuniform fixture quantizes generated timestamps by less than 0.5 ms, without changing sample count, order, or values.
This avoids FusionTime’s `%Q` parser rejecting fractional milliseconds and silently replacing them with epoch zero.
Chart dimensions and axis bounds are fixed for comparison. Native plot areas can differ because axis layouts differ.

The labels distinguish default behavior from opt-in algorithms:

- ECharts: opt-in LTTB, average, minimum, maximum, or min/max. A sampling-disabled mode supplies a control.
- Chart.js: opt-in LTTB or the plugin’s default min/max. A decimation-disabled mode supplies a control.
- ApexCharts: opt-in scalar-line LTTB, or the disabled reducer.
- amCharts: opt-in grouping with default close or explicit average. Grouping-disabled mode supplies a control.
- DevExtreme: opt-in aggregation with the default average method, or aggregation disabled.
- AnyStock: default grouping with last-value mapping, explicit average mapping, or grouping disabled.
- FusionTime: default average binning. No verified aggregation-off mode is available.

The demo does not override sampling targets, activation thresholds, group counts, or grouping intervals.
The benchmark keeps separate base and sampled configurations, including FusionTime's fixture-specific one-minute bins in the base.
The visual demo includes only default FusionTime binning, not the base benchmark's fixture-specific bin restriction.
Its results do not validate the new benchmark wrappers or their explicit reduction budgets.

### Output and interpretation

Readouts use actual processed output for ECharts, Chart.js, ApexCharts, amCharts, DevExtreme, and AnyStock.
FusionTime reports its current bin and states that processed points are unavailable. Input rows are not substituted for processed output.
uPlot reports input statistics separately from its rendered path.

The uPlot detail magnifies the cached path, including pixel rounding and gap clipping.
The other detail draws a polyline through processed output, before any further renderer simplification or rounding.
Neither detail changes the viewport or runs another sampling pass.

At DPR 1, the opposite-spike case lost its negative spike under default-budget LTTB in ECharts, Chart.js, and ApexCharts.
ECharts and Chart.js min/max retained both extrema in the same case.
ECharts average, amCharts grouping, and DevExtreme average removed both extrema.
AnyStock average attenuated them to approximately −3.333 and +3.333.
At DPR 2, ECharts LTTB retained both extrema in this case, with 912 processed points instead of 437.
These observations describe the pinned libraries at this chart size, not every viewport or dataset.

The short missing interval also demonstrates a uPlot limit: its rounded, subpixel gap disappears at DPR 1.
Pixel-column extrema preservation does not guarantee gap boundaries, precise timestamps, pulse shape, or every signal statistic.
The demo makes no universal fidelity or performance claim. Timing remains the responsibility of the separate benchmark.

The opt-in browser regression uses cached Headless Shell 156 and cached vendor assets, without downloads or tracing:

```sh
TEST_REDUCTION_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/reduction-accuracy-browser.mjs
```

Validation passed all 120 dataset/mode combinations in Headless Shell 156, plus dropdown interactions and a DPR 2 UI check.
The test checks input preservation and verifies FusionTime’s parsed timestamps and values before assessing its native bin.
The corrected nonuniform fixture selects a one-minute FusionTime bin over the expected 100-minute domain.
Results and screenshots go to `.cache/benchmarks/reduction-accuracy-*`.
The offline test blocks uncached external assets, including AnyChart’s logo image. The production demo does not block or remove branding.

## Publication and vendor requirements

The user decides whether to publish results. The harness does not enforce a publication-policy acknowledgment.
This decision is not a legal conclusion, a vendor agreement, or a claim of publication permission.
Applicable vendor terms remain separate from benchmark configuration.
Vendor technical checks, runtime keys, and branding remain intact.

License keys belong in the local environment or a secret manager, not source files, manifests, or reports.
Vendor validation can require network access even with cached dependencies.
SciChart Community startup and LightningChart runtime-key startup remain distinct paths.

## Known limits and validation status

The `deckgl` variant passed the focused hardware-browser checks and memory-only/combined workers described in its inclusion section.

Browser and performance validation for the five sampled variants and metadata columns remains pending.
This documentation update runs no browser tests or benchmark workers. It does not establish a completed 41-variant suite or new performance results.

The latest [renderer validation](#renderer-validation) covers Bokeh Canvas, d3fc Canvas, their originals, G2 Canvas, and the G2 WebGL timeout.
It includes a separate 200-row G2 WebGL smoke, not a successful full-workload measurement or a full-suite rerun.
The following expansion results are historical.

### Second expansion: partial suite and separate workers

These historical results predate the grouping-related changes described in [Grouping and accuracy limits](#grouping-and-accuracy-limits).
The DevExtreme and FusionTime base configurations timed out under the five-second sample budget.

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
