# Benchmarks

The benchmarks compare chart libraries, including their data preparation and sampling or decimation choices.
They use Chrome Headless Shell, pinned demo dependencies, and `bench/data.json`.

The HTML demos and benchmark import the same `bench/<variant>.mjs` modules.
The original modules are `uplot`, `d3`, `chartjs`, `echarts`, `flot`, and `dygraphs`.
The existing additions are `apexcharts`, `highcharts`, `lightweight`, `plotly`, `canvasjs`, `zingchart`, `amcharts`, and `lightningchart`.
The first expansion added `bokeh`, `d3fc`, `agcharts`, `vega`, and `scichart`.
The second expansion adds 13 adapters:

- `billboard`, `g2`, `syncfusion`, `devextreme`, `jscharting`, and `kendo`.
- `anychart`, `fusiontime`, `googlecharts`, `recharts`, `muicharts`, `financialcharts`, and `visx`.

The default set contains 31 libraries and 43 variants, including ChartGPU and deck.gl. The idle control is separate.
The manifest contains 48 demo IDs, including idle and the restricted variants.
Five sampled variants follow their bases immediately: `apexcharts-sampled`, `amcharts-sampled`, `devextreme-sampled`, `anychart-sampled`, and `fusiontime-sampled`.
The `d3-minmax` and `d3-svg-minmax` variants share streaming, device-pixel min/max reduction for the D3 canvas and SVG renderers.
The base configurations remain unchanged.
G2 WebGL and Google Charts are disabled for benchmarks after timeouts. Their standalone demos remain available.
The renderer alternatives are `d3-svg`, `plotly-svg`, `highcharts-svg`, `bokeh-canvas`, `d3fc-canvas`, and `g2-webgl`.
All 13 adapters passed agent-reported direct browser smoke checks. JSCharting remains standalone-only because vendor cleanup leaks across repeated samples.
All 12 then-runnable additions passed integrated combined measurements across a partial suite and separate workers, not one complete suite.
The previous 18-library validation remains historical.
The [candidate review](../docs/investigations/benchmark-library-expansion.md) records decisions, adapter caveats, and validation status.
Each module exports `prepData(packed)` and `makeChart(data, host, wait)`.
The added modules also export `destroyChart(chart)`. The harness uses this optional hook for library-specific cleanup.
`makeChart` returns a chart or a promise that resolves after the library completes initialization.
Runnable benchmark adapters also export `updateChart(chart, data, host, wait)`.
The benchmark uses `makeChart` for populated initialization, or optional `makeLifecycleChart(data, host, wait)` for retained update state and readiness.
`updateChart` returns either nothing or the same chart. Its promise covers library readiness.
Historical diagnostics can still use the adapters' `makeEmptyChart` exports.
The HTML runner still calls `makeChart(data, host, wait)` once with populated data.
The lifecycle benchmark does not change that demo sequence.

Chart configuration and data preparation have one implementation per library. No HTML parsing or source extraction occurs.
`scripts/bench-demo-sources.mjs` reads the shared files, and the browser imports each selected module directly.
`bench/demo-fixture.mjs` and `bench/demo.css` provide shared hosts, markup, and styles.
`bench/demo-dependencies.mjs` defines central dependency versions and production paths.
Its `demoModuleDependencies` map lists shared adapter imports for the CLI server. No import extraction occurs.
`bench/framework-runtime.mjs` defines the new React package and peer pins.
Every HTML demo uses the shared `bench/demo.mjs` to load dependencies and start the demo.
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
Each runnable chart receives 55,550 rows and three data series: 166,650 input points, at 1920 × 600 CSS pixels.
The runnable demos share a left percentage axis for CPU and RAM, with TCP Out on a right MB axis.
Both y-axis ranges are automatic. No fixed y-axis bounds force the percentage series to use 0–100.
DPR defaults to 1.

## Pinned dependencies and chart configuration

The tables record pins from `bench/demo-dependencies.mjs`, `bench/framework-runtime.mjs`, and the adapter comments.
Google Charts is an exception: frozen version `52` uses a mutable loader and remote packages.

| Variant | Dependency versions |
| --- | --- |
| `uplot` | Local production assets in `dist/` |
| `chartjs` | `chart.js` 4.6.1, `@date-fns/cdn` 4.4.0, `chartjs-adapter-date-fns` 3.0.0 |
| `d3`, `d3-minmax`, `d3-svg`, `d3-svg-minmax` | `d3` 7.9.0 |
| `echarts` | `echarts` 6.1.0 |
| `flot` | `flot` 4.2.6, `jquery` 3.7.1 |
| `dygraphs` | `dygraphs` 2.2.2 |
| `apexcharts`, `apexcharts-sampled` | `apexcharts` 8.4.1, including `dist/features/renderer-canvas.js` |
| `highcharts`, `highcharts-svg` | `highcharts` 13.1.1, including `modules/boost.js` |
| `lightweight` | `lightweight-charts` 5.2.1 |
| `plotly`, `plotly-svg` | `plotly.js-dist-min` 4.1.2 |
| `canvasjs` | `@canvasjs/charts` 3.17.8 |
| `zingchart` | `zingchart` 2.9.16-1 |
| `amcharts`, `amcharts-sampled` | GitHub `amcharts/amcharts5-dist` tag 5.21.4, `index.js` and `xy.js` |
| `bokeh`, `bokeh-canvas` | `@bokeh/bokehjs` 3.10.1, core, GL, and plotting API bundles |
| `d3fc`, `d3fc-canvas` | `d3fc` 15.2.13 and `d3` 7.9.0 |
| `deckgl` | `d3` 7.9.0, then `deck.gl` 9.4.0, `dist.min.js` |
| `agcharts` | `ag-charts-community` 14.2.0, Community UMD bundle |
| `vega` | `vega` 6.4.0, `build/vega.min.js` |
| `scichart` | `scichart` 6.0.14, `index.min.js` and SIMD/non-SIMD WASM assets |
| `lightningchart` | `@lightningchart/lcjs` 9.0.0, `dist/lcjs.iife.es2019.js` |
| `billboard` | `billboard.js` 4.1.3, packaged D3 bundle and CSS |
| `g2` | `@antv/g2` 5.4.8, Canvas bundle |
| `g2-webgl` | `@antv/g2` 5.4.8, `@antv/g-lite` 2.7.2, `@antv/g-webgl` 2.1.3, production UMD bundles in that order |
| `syncfusion` | `@syncfusion/ej2-charts` 35.1.41 and its global dependencies |
| `devextreme`, `devextreme-sampled` | DevExpress 26.1.6, production `dx.viz.js` |
| `jscharting` | `jscharting` 3.4.0, minified `dist/jscharting.js`, reported build `3.4.0.20230215`. Standalone only. |
| `kendo` | `@progress/kendo-ui` 2026.3.1015, `umd/kendo.dataviz.min.js`, with jQuery |
| `chartgpu` | `chartgpu` 0.4.0, production ESM through esm.sh |
| `anychart`, `anychart-sampled` | `anychart` 9.0.0, core and stock bundles |
| `fusiontime`, `fusiontime-sampled` | `fusioncharts` 4.2.3, core and timeseries bundles |
| `googlecharts` | Frozen `52`, `corechart`, mutable `https://www.gstatic.com/charts/loader.js` |
| `recharts` | `recharts` 3.10.1, `d3-scale` 4.0.2 |
| `muicharts` | `@mui/x-charts` 9.16.0, `LineChart` entry |
| `financialcharts` | `react-financial-charts` 2.0.1, `d3-scale` 4.0.2 |
| `visx` | `@visx/shape`, `@visx/axis`, `@visx/scale`, and `@visx/grid` 4.0.0 |

### Production ESM and remote runtime delivery

The React adapters use production esm.sh entries with exact entry and peer versions, targeting ES2022.
Recharts, MUI, and visx pin React, React DOM, and `react-is` to 19.3.1.
React Financial Charts pins those packages to 18.3.1.
MUI also pins `@mui/material` and `@mui/system` to 9.5.0, `@emotion/react` to 11.14.0, and `@emotion/styled` to 11.14.1.

The CLI integration uses `scripts/bench-module-bundle.mjs` and the existing Rolldown/cache path before browser startup and chart timers.
It bundles all module dependencies for a variant together. Separate dependency bundles can duplicate React and break shared hooks or context identity.
The browser imports the resulting local production ESM bundle.
The cache records dependency URLs, source SHA-256 hashes, byte counts, the bundle hash, and the Rolldown version.
Version pins identify requested versions. Source hashes identify captured bytes, not a guarantee that CDN output never changes.
React root creation, component construction, and commits remain inside chart initialization. Dependency loading does not mount a hidden warmup root.

Google Charts loads frozen version `52` and remote `corechart` code through `prepareRuntime()` before chart timers start.
DataTable construction, ingestion, layout, and drawing remain inside initialization.
The loader is mutable, and Google can apply critical fixes to frozen releases.
Network access remains necessary. A cached loader does not make the remote packages fully offline or reproducible.
Recorded dependency hashes do not establish an immutable Google runtime.

### Renderer configuration

LightningChart 9 uses `@lightningchart/lcjs`, not the former `@arction/lcjs` package.
amCharts uses the tagged GitHub browser distribution through jsDelivr, not npm entry points that require a bundler.

The modules use these performance choices:

| Variant | Chart configuration |
| --- | --- |
| `uplot` | Aligned columns, native pixel-level path reduction, and `cache.paths: false`. |
| `d3` | Aligned columns and a canvas line generator, without point objects or external sampling. |
| `d3-minmax` | The same canvas renderer, with streaming min/max reduction at roughly four samples per device pixel. No intermediate sampled arrays. |
| `d3-svg` | The same aligned columns, scales, ticks, and pixel rounding. Three full-data SVG paths, SVG axes/grid, and an SVG cursor. No sampling or Canvas layer. |
| `d3-svg-minmax` | The same SVG renderer, with the shared min/max reducer and density threshold. `d3.path()` receives reduced commands and builds SVG path strings. |
| `chartjs` | Numeric points, `parsing: false`, `normalized: true`, native min/max sampling, and no animation or point markers. |
| `echarts` | One interleaved typed buffer, explicit dimensions, native min/max sampling, and no animation or point markers. |
| `flot` | Native XY pairs and canvas lines, with automatic ranges on two y axes. |
| `dygraphs` | Numeric timestamp rows and `Dygraph.dateTicker`, without per-row Date objects or CSV parsing. |
| `apexcharts` | Native Canvas addon with `dataReducer.enabled: false`. The pinned scalar-line reducer only supports LTTB. |
| `apexcharts-sampled` | The same Canvas addon with native LTTB enabled, `targetPoints: 1920`, and `threshold: 3840`. |
| `highcharts` | Boost with typed data columns. `useGPUTranslations: false` avoids Float32 precision loss for epoch-millisecond timestamps. |
| `lightweight` | Native line conflation (`enableConflation: true`), two automatic axes, and a custom legend with visibility controls and attribution. |
| `plotly` | WebGL `scattergl` line traces with typed arrays. |
| `plotly-svg` | SVG `scatter` line traces with the same typed arrays. Native line simplification keeps its default. |
| `highcharts-svg` | SVG lines with the same typed data columns and `boost.enabled: false`. |
| `canvasjs` | Native canvas line chart, without animation or point markers. |
| `zingchart` | Canvas output, fast mode, `sampling-step: 1`, no trackers, no point markers, and no tooltips. |
| `amcharts` | `groupData: false` disables date grouping. `minDistance: 0` disables distance-based line simplification. `exactLocationX: true` uses original timestamps. |
| `amcharts-sampled` | Native date grouping with `groupCount: 1920`, average values, and one-minute, ten-minute, and one-hour intervals. `minDistance: 1`. No `exactLocationX` override. |
| `bokeh` | WebGL lines, Float64 columns, separate automatic y ranges, and no level-of-detail sampling. Canvas fallback causes an error. |
| `bokeh-canvas` | The same full Float64 columns and automatic axes, with `output_backend: 'canvas'`. No WebGL contexts. |
| `d3fc` | WebGL lines and SVG axes. Public `scaleMapper` projects timestamps in double precision before upload. No sampling. |
| `d3fc-canvas` | Native `seriesCanvasLine`, the same SVG axes and cursor, and full Float64 columns. One-physical-pixel lines, with DPR 1 for validation. No sampling. |
| `deckgl` | D3 automatic time and independent y axes, with full-data deck.gl `PathLayer` lines. Scaling occurs inside initialization. No sampling. Explicit WebGL2. |
| `agcharts` | Community Canvas lines, native line aggregation, keyed axes, no point markers, and no Enterprise modules. |
| `vega` | Canvas lines from one wide dataset, independent y scales, and no sampling or fold transform. |
| `scichart` | WebGL/WASM lines, Float64 input, native `Auto` resampling (observed MinMax-equivalent), and full native data retention. |
| `lightningchart` | Progressive Float64 x data, native zoom-dependent grouping, no automatic sorting, and full input retention. |
| `billboard` | Canvas lines, named columns, native `y`/`y2`, no animation or markers, and `boost.useWorker: false`. |
| `g2` | Canvas lines from wide rows, shared percentage-scale keys, a separate TCP scale key, explicit `fill: 'none'`, and no animation. |
| `g2-webgl` | The same G2 configuration with `G.WebGL.Renderer`, three native GPU path checks, and renderer-owned context capture. Full-data validation timed out. |
| `syncfusion` | Canvas lines, Date input, native pixel-tolerance reduction, and no animation or markers. |
| `devextreme` | Continuous datetime axis, `aggregation: {enabled: false}`, and `synchronizeMultiAxes: false`. |
| `devextreme-sampled` | Native average aggregation with `aggregationGroupWidth: 1`. The continuous datetime axis and independent value axes remain unchanged. |
| `jscharting` | Standalone only. Ordinary lines, numeric XY pairs, time axis, independent y axes, and no adapter decimator. |
| `kendo` | Canvas `scatterLine`, Date-valued XY pairs, independent y axes, and no transitions or markers. |
| `anychart` | AnyStock, continuous `scatter` time scale, main and scroller grouping disabled, and independent linear y scales. The average mapping remains configured but inactive. |
| `anychart-sampled` | Native grouping defaults with the same average mapping and `scatter` time scale. The visible scroller remains disabled in both variants. |
| `fusiontime` | Specialized timeseries renderer, only one-minute bins, average aggregation, and `multiCanvas: false` for both axes in one plot. |
| `fusiontime-sampled` | Native default calendar bins through omission of `xAxis.binning`. Average aggregation and `multiCanvas: false` remain unchanged. |
| `googlecharts` | Classic `LineChart`, datetime column, native `targetAxisIndex`, and no startup animation or markers. |
| `recharts` | SVG lines, public calendar ticks from `d3-scale`, continuous time scale, independent `yAxisId` values, and no animation or markers. |
| `muicharts` | Community SVG `LineChart`, continuous time scale, independent y axes, and no animation or markers. |
| `financialcharts` | Canvas lines, continuous `scaleTime()`, `plotFull: true`, and two native Chart contexts at the same origin. |
| `visx` | Custom SVG composition with native lines, axes, grid, and independent scales. Domain scans and component construction remain inside initialization. |

The standalone `bench/d3-minmax.html` demo and `bun run bench --variant d3-minmax` use the same adapter.
The SVG equivalent is `bench/d3-svg-minmax.html`, also available through `bun run bench --variant d3-svg-minmax`.
Both variants use the same reducer, without intermediate sampled arrays. SVG allocates its output path strings.

The reducer scans each series once during rendering and keeps only the current pixel column's first, minimum, maximum, and last values.
It projects X for each sample and projects Y only for emitted vertices. Null gaps restart the path, including gaps within one column.
Full-resolution data remains available for cursor lookup and automatic axis ranges.
Reduction costs belong to chart initialization and updates, not data preparation. This reduction preserves column extrema, not necessarily identical rasterized pixels.

ApexCharts 8.4.1 does not support `dataReducer.name: 'minmax'`.
Its scalar-line path calls LTTB directly, regardless of a supplied reducer name.
The base demo disables reduction because LTTB can omit one of two opposite extrema in a bucket.
For the base variant, the harness checks that all three parsed series contain 55,550 values after initialization, outside the chart timing window.
The sampled variant enables native LTTB instead. Full input does not imply full processed output.
No custom decimator, manual plot-width estimate, or second initialization pass replaces the native reducer.

The D3, Plotly, and Highcharts SVG wrappers reuse their original adapters through `makeChartWithOptions`.
D3 shares preparation, automatic dual-axis ranges, calendar ticks, and pointer/legend behavior between its Canvas and SVG modes.
SVG path generation and DOM construction remain inside initialization. Cleanup removes listeners and cancels pending cursor frames.
Each pair loads identical vendor bundles, including the disabled Boost module for `highcharts-svg`.
Both modes retain automatic y ranges and full input. Preparation and cleanup use the same functions.
Highcharts Boost also changes data processing and interaction features. This comparison does not isolate only the drawing backend.
The Bokeh Canvas, d3fc Canvas, and G2 WebGL variants are thin wrappers around shared `makeChartWithOptions` functions.
Each pair shares preparation, automatic dual axes, cleanup, and all 55,550 rows across three series. No custom sampling reduces the workload.

Bokeh Canvas loads the same core, GL, and plotting API bundles as Bokeh WebGL to control library-load costs.
The Canvas backend does not create WebGL contexts, despite the loaded GL bundle.
d3fc Canvas shares the original SVG axes, cursor, and full Float64 columns. Both modes use one-physical-pixel line widths.

The `deckgl` adapter is a deck.gl+D3 composition, not a complete chart API from deck.gl.
D3 supplies the automatic time scale, calendar ticks, independent percentage and MB scales, SVG axes, grid, legend, and cursor.
Inside `makeChart()`, D3 scales every point in double precision before the adapter passes screen coordinates to three deck.gl `PathLayer` objects.
Each path contains all 55,550 points. Path construction, scaling, and native deck.gl tessellation remain inside initialization, not data preparation.
The adapter applies no sampling. It explicitly creates and supplies a WebGL2 context, without a backend fallback.
The metadata is `{sampling: 'none', context: 'webgl2', lossy: false}`. These labels describe configuration, not measured visual accuracy.

The hardware-browser test passed 200 and 55,550-row samples, including repeated full-data creation and a DPR 2 check.
It verified all three native path draws before readiness, automatic axes, GPU fences, and cleanup on AMD WebGL2.
A separate screenshot showed all three series and axes. This check does not establish pixel identity with other libraries.
The memory-only and combined workers each passed 3 warmups and 7 measured rounds with Vulkan requested, within the five-second sample budget.
All samples completed WebGL2 fences. The combined trace reported no data loss.
These focused runs had no fresh idle control and do not establish adjusted memory, comparative performance, or a completed suite.

```sh
bun run bench --variant deckgl
# Cache-only browser validation after the dependencies are available:
TEST_DECKGL_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/bench-deckgl-browser.mjs
```

An explicit deck.gl-only run uses Chrome's default backend unless `--vulkan` is supplied.
The default Linux suite still requests Vulkan for every worker because it includes ChartGPU.

G2 WebGL loads production UMD bundles in global order `G2`, `G`, then `G.WebGL`.
Its adapter requires three native GPU line paths and exposes the renderer-owned context through `getWebGLContexts()` without a probe context.
The harness captures this context and applies its existing completion protocol, including WebGL2 fences.
The [renderer audit](../docs/investigations/benchmark-library-expansion.md#renderer-alternatives) records validation, other candidates, and the ECharts GL limitation.

Recharts generates `scaleTime().domain([data[0].time, data[data.length - 1].time]).ticks(12).map(Number)` inside `makeChart()` and supplies public `XAxis.ticks`.
In Recharts 3.10.1, automatic `niceTicks` applies only to linear scales.
For this time axis, `combineAxisTicks` selected all timestamps before `scale.ticks()`, so `tickCount` alone did not produce calendar ticks.

The correction retains all input rows and uses data-derived bounds, not sampling or hardcoded bounds.
It adds no custom grid generator, cache, measurement-span patch, or internal override.
Browser checks retained all 55,550 points per series, with full-fixture labels at local midnight.
For irregular input from 03:07 to 07:59, calendar ticks ran from 03:30 through 07:30.

The FusionTime base sets `minute: [1]` and empty arrays for `year`, `month`, `day`, `hour`, `second`, and `millisecond` in `xAxis.binning`.
Average aggregation remains enabled. The current minute-aligned fixture has one observation per bin, so the average does not combine observations.
Multiple observations within a minute can merge and hide peaks. This configuration does not preserve arbitrary sub-minute data.

These configurations do not provide identical rendering or interaction features.
Input retention and disabled reducers do not guarantee preservation of every visible feature.
Other native reduction and grouping can change displayed detail without removing the full input.
Lightweight Charts uses grouped closing values for lines, not a min/max envelope, and can hide peaks at wide zoom levels.
Native sampling can also change automatic ranges.

For example, ECharts 6.1.0 min/max sampling ends the visible time range three minutes early for this fixture at DPR 1.
All 55,550 raw rows remain available. The adapter does not override the range to conceal this behavior.
These results compare the configured demos, not identical drawing algorithms.

### Sampled variants

The five sampled wrappers restore historical native reduction configurations through shared `makeChartWithOptions` functions.
Each pair shares dependency pins, data preparation, automatic dual axes, and cleanup.
Both variants receive all 55,550 rows across three series. No custom reduction or pre-reduced input replaces the native workload.
The base configurations remain unchanged.

| Sampled variant | Restored native configuration | Sampling label |
| --- | --- | --- |
| `apexcharts-sampled` | `dataReducer: {enabled: true, targetPoints: 1920, threshold: 3840}` selects the pinned scalar-line LTTB path. | `LTTB (1920)` |
| `amcharts-sampled` | `groupData: true`, `groupCount: 1920`, and intervals of one minute, ten minutes, and one hour. Series use `valueYGrouped: 'average'` and `minDistance: 1`. The configuration omits `exactLocationX`. | `avg+distance` |
| `devextreme-sampled` | `aggregation: {enabled: true, method: 'avg'}` and `argumentAxis.aggregationGroupWidth: 1`. | `avg (1px)` |
| `anychart-sampled` | Native main and scroller grouping defaults, without the base grouping-disable calls. Average mappings and `xScale('scatter')` remain unchanged. The visible scroller stays disabled. | `avg (calendar)` |
| `fusiontime-sampled` | Omission of `xAxis.binning` restores default calendar bins. Average aggregation remains enabled. The base restricts bins to one minute. | `avg (calendar)` |

LTTB can lose one of two opposite extrema within a bucket. Average aggregation can attenuate or remove peaks.
Grouping and distance-based simplification can also change timestamps and visible detail.
Sampling labels describe configured behavior, not an accuracy guarantee or a measured output count.
Full input retention does not guarantee full native output or visual fidelity.

All five new variants passed sequential trace-only workers with Chrome Headless Shell 156.0.8078.47 and Vulkan.
Each completed three warmups and seven measured samples under the unchanged five-second limit, with no trace data loss.
The checks validated full prepared input, rendered surfaces, and cleanup. ApexCharts also passed its sampled-output check.
The focused regression run passed 810 tests, with three optional browser tests skipped.
These workers did not measure memory or establish visual accuracy. The then-current 40-variant suite was not rerun.

## Data formats and performance audit

The audit covers the registered adapters, including LightningChart with a supplied runtime key.
Each preparation function reads the packed input directly and allocates fresh output.
No adapter rewrites the input, caches prepared data between samples, or removes rows before library initialization.
The six original adapters no longer copy the packed input with `slice()`.
That removes one temporary array of 388,850 values per preparation.

| Library | Prepared representation | Reason |
| --- | --- | --- |
| uPlot, D3 | Four aligned numeric arrays | Shared timestamps, without point records. |
| Highcharts | Four Float64 columns in three data-table configurations | Boost supports typed columns. All tables share the prepared x column. |
| Plotly | Four Float64 columns | `scattergl` accepts separate x and y arrays. All traces share x. |
| LightningChart | Four Float64 columns | The progressive dataset API accepts typed columns without row objects. |
| Bokeh, d3fc | Four Float64 columns | Bokeh uses `ColumnDataSource`. d3fc uses accessors over the columns. |
| SciChart | Four Float64 columns, with timestamps in seconds | `appendRange()` copies full input into native storage during initialization. |
| AG Charts Community, Vega | One array of `{time, cpu, ram, tcp}` rows | All three series share the wide dataset. Vega copies rows during initialization before tuple ingestion. |
| ECharts | One interleaved Float64 buffer | A supported typed-data path, without row objects. Keyed columns are not necessarily faster. |
| amCharts | One array of `{date, cpu, ram, tcp}` rows | All three series share the prepared records. |
| Dygraphs | Rows of `[timestamp, cpu, ram, tcp]` | The native numeric format avoids Date allocation and date-input conversion copies. |
| Chart.js | Three arrays of `{x, y}` | The skipped-parsing and sampling path needs the internal point format. |
| ApexCharts | Three arrays of `[x, y]` | Native reduction needs explicit x values, unlike scalar series with shared labels. |
| Flot, ZingChart | Three arrays of `[x, y]` | Ordinary supported XY input, without custom ingestion hooks or index-based time spacing. |
| CanvasJS | Three arrays of `{x, y}` | The documented point format, with numeric timestamps rather than Date objects. |
| Lightweight Charts | Three arrays of `{time, value}` | The public `setData()` contract uses point records. |
| Billboard | Four named columns | Native `data.columns` input shares numeric timestamps. |
| G2, Recharts, MUI, React Financial Charts, visx | One array of `{time, cpu, ram, tcp}` rows | Shared wide input with numeric millisecond timestamps. |
| Syncfusion, DevExtreme | Wide rows with Date-valued `time` | Native datetime input. Date allocation remains in preparation. |
| JSCharting | Three arrays of numeric `[x, y]` pairs | Native point input on a continuous time axis. |
| Kendo | Three arrays of `[Date, y]` pairs | `scatterLine` preserves calendar spacing without category aggregation. |
| AnyChart, FusionTime | Rows of `[timestamp, cpu, ram, tcp]` | Native table input. FusionTime copies rows during initialization before DataStore adds row identifiers. |
| Google Charts | Rows of `[Date, cpu, ram, tcp]` | DataTable construction and ingestion remain inside initialization. |

Each four-column Float64 representation contains 1,777,600 bytes of numeric data, excluding wrappers and library allocations.
Columnar preparation does not imply zero-copy initialization.
Highcharts copies columns internally. Plotly converts date-axis data and allocates rendering structures.
Library-owned copies remain part of the measured initialization and memory costs.

The adapters retain automatic y ranges and original timestamp values.
Dygraphs uses the public date ticker to preserve calendar ticks with numeric timestamps.
The audit did not add fixed y bounds, manual sampling, input-mutation switches, hidden HTML, or custom ingestion hooks.
Normal chart and legend construction still creates DOM elements inside initialization.

The existing amCharts static-logo override is a private-API exception, requested separately to stop its entrance animation.
It preserves the logo and link, but needs a version and license review before publication.
Interaction features still differ: ZingChart disables trackers and tooltips, while other adapters provide different hover and legend behavior.
Highcharts completion awaits its Boost canvas events, not a guarantee that all deferred hover-tree work has finished.
These limits prevent a claim of identical output or interaction costs across libraries.

### Audit references

The audit used the pinned distributions as well as these public API references:

- [uPlot data contract](https://github.com/leeoniya/uPlot/blob/master/docs/README.md#data-format) and [D3 canvas line generators](https://d3js.org/d3-shape/line#line_context).
- [Chart.js performance](https://www.chartjs.org/docs/latest/general/performance.html) and [sampling requirements](https://www.chartjs.org/docs/latest/configuration/decimation.html).
- [ECharts dataset formats](https://echarts.apache.org/handbook/en/concepts/dataset/) and [6.1.0 typed-data implementation](https://github.com/apache/echarts/blob/6.1.0/src/data/helper/dataProvider.ts).
- [Flot data and axis API](https://www.flotcharts.org/flot/docs/API/) and [Dygraphs native formats](https://dygraphs.com/data.html).
- [ApexCharts canvas renderer](https://apexcharts.com/docs/options/chart/renderer/) and [8.4.1 data-reduction implementation](https://cdn.jsdelivr.net/npm/apexcharts@8.4.1/src/modules/Data.js).
- [Highcharts Boost guidance](https://www.highcharts.com/docs/advanced-chart-features/boost-module) and [Plotly initialization API](https://plotly.com/javascript/plotlyjs-function-reference/).
- [CanvasJS data formats](https://canvasjs.com/docs/charts/basics-of-creating-html5-chart/working-with-data/) and [Lightweight Charts time-scale configuration](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/TimeScaleOptions).
- [amCharts grouping guidance](https://www.amcharts.com/docs/v5/charts/xy-chart/axes/date-axis/#Performance_implications).
- [LightningChart 9 declarations](https://cdn.jsdelivr.net/npm/@lightningchart/lcjs@9.0.0/dist/lcjs.d.ts).

ZingChart documentation was unreachable during the audit. Its pinned bundle and browser probes provided the format evidence.
LightningChart runtime validation requires a valid user-supplied key. API checks alone do not establish a successful browser run.
The expansion review links upstream references from adapter comments and records validation results.
The first expansion passed the full 18-library trace-and-memory suite and separate rAF runs for its five additions.
All 13 second-expansion adapters passed agent-reported direct browser smoke checks, but JSCharting is excluded from repeated samples.
The expanded suite timed out after partial success. Separate worker results do not establish a completed full suite.

## License and availability limits

Runnable code does not establish permission for every use. The applicable vendor terms remain separate from benchmark configuration.

| Library | Terms relevant to these demos |
| --- | --- |
| ApexCharts | Custom Community, Commercial, and OEM terms, not MIT. The competing-product restriction requires review for use in this repository. |
| Highcharts | Proprietary license terms. |
| CanvasJS | Branded noncommercial or evaluation use. Commercial use requires a license. |
| ZingChart | Branded evaluation distribution. The demo supplies no license keys and no longer uses the old copied `ZC.LICENSE` keys. |
| amCharts | Linkware terms require the original license and prohibit disabling, hiding, or altering the branding link. The demo retains the logo and link, but removes its entrance animation. |
| Lightweight Charts | Apache-2.0 with attribution requirements. The demo retains the attribution logo and adds a TradingView notice and link. |
| Plotly | MIT. |
| AG Charts Community | MIT Community bundle only. No Enterprise modules. |
| Vega | BSD-3-Clause. |
| SciChart | Vendor Community startup or a supplied runtime key. Vendor technical checks and branding remain intact. |
| LightningChart | Vendor-issued runtime key required. Vendor technical checks and branding remain intact. |

The new adapters retain vendor technical checks, evaluation notices, and license branding.
Successful browser rendering does not establish license or publication permission for Syncfusion, DevExtreme, JSCharting, Kendo, AnyChart, or FusionTime.
DevExtreme evaluation warnings remain visible. Licensed v26.1 use requires the appropriate vendor runtime key.
No new adapter removes branding to improve timing or appearance.

The user approved removal of the harness publication-policy gate, not removal of vendor license enforcement.
The harness no longer requires `benchmarkPermission` or `LIGHTNINGCHART_BENCHMARK_PERMISSION`.
Publication remains the user's decision. This documentation states no legal conclusion and claims no vendor agreement or publication permission.

### JSCharting benchmark restriction

The adapter and `bench/JSCharting.html` remain available, with the pinned source `https://cdn.jsdelivr.net/npm/jscharting@3.4.0/dist/jscharting.js`.
Build `3.4.0.20230215` becomes ready correctly, but vendor `destroy()` retains charts and listeners.
The references include a global validate queue, window pointer listeners, and anonymous `beforeprint`/`afterprint` listeners.
Post-GC memory reached 415 MB, 818 MB, and 1,221 MB after three successive samples.
Diagnostic private-API/CDP removal reduced those observations to 8.6 MB, 8.9 MB, and 9.3 MB. That cleanup is not shipped.

`benchmarkRestrictions` blocks repeated samples. The default suite emits an explicit JSCharting skip, and explicit benchmark selection fails.
A vendor fix or a future fresh-page sample protocol is necessary before re-entry.

### LightningChart and SciChart runtime configuration

Do not commit license keys or put them in manifests, reports, or shared command examples.
Supply these environment variables through your local environment or secret manager:

| Variable | Value |
| --- | --- |
| `LIGHTNINGCHART_LICENSE` | Required vendor-issued LightningChart runtime key |
| `LIGHTNINGCHART_LICENSE_INFORMATION` | Optional JSON containing vendor-required license metadata |
| `SCICHART_LICENSE` | Optional SciChart runtime key. Without it, the adapter calls the vendor's `UseCommunityLicense()`. |

With `LIGHTNINGCHART_LICENSE`, the default suite includes LightningChart after the 30 runnable default libraries.
Without a key, the suite reports an explicit LightningChart skip. Explicit selection without a key fails the availability check.

To select LightningChart plus idle, use:

```sh
npm run bench -- --variant lightningchart
```

The harness supplies the license configuration to the browser through CDP before tracing starts.
The manifest and report JSON contain no supplied license secrets.
Vendor license validation can require network access. A local dependency cache does not guarantee offline operation or prevent vendor network traffic.

For a standalone demo, supply `globalThis.benchmarkLightningChartOptions` before `runDemo('lightningchart')`.
The object requires `license`, with optional `licenseInformation`. There is no fabricated key or automatic Community fallback for LightningChart 9.
SciChart accepts `globalThis.benchmarkSciChartOptions.runtimeLicenseKey`. Its Community path does not bypass vendor validation or branding.

## Commands

Run the combined trace and process-memory benchmark:

```sh
npm run bench
```

To include `main ms` and `gpu ms` in the live table, use:

```sh
npm run bench -- --verbose
```

`--verbose` defaults to false. It changes only the table, not the measurements, full rows, or saved JSON.
The flag applies to live tables and saved summaries. Memory-only and rAF-only tables have no `main ms` or `gpu ms` columns.

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

For the full default suite with Bun, run:

```sh
bun run bench
```

ChartGPU is part of the default suite. On Linux, runs that include ChartGPU automatically request Vulkan.
The harness adds `--enable-gpu` and `--enable-features=Vulkan` to every worker, including idle.
This changes the Linux default-suite backend. Vulkan reports and traces retain separate filenames from older default-backend results.
Other platforms and single-variant runs without ChartGPU retain Chrome's default backend unless explicitly overridden.
ChartGPU still requires hardware WebGPU. Automatic Vulkan selection cannot supply missing GPU access or driver support.

To run only ChartGPU and idle, use:

```sh
bun run bench --variant chartgpu
```

`--vulkan` explicitly requests Vulkan on any platform. `--no-vulkan` disables automatic Vulkan selection without disabling `--gpu`.
These flags cannot be combined. A focused run of another library needs `--vulkan` to match a Linux default-suite run.

### Compare sampled and base variants

For a comparison with the full Linux suite, use `--vulkan` for both variants.
Each command includes the idle control. These commands do not change the five-second sample budget.

```sh
npm run bench -- --variant apexcharts --vulkan
npm run bench -- --variant apexcharts-sampled --vulkan
npm run bench -- --variant amcharts --vulkan
npm run bench -- --variant amcharts-sampled --vulkan
npm run bench -- --variant devextreme --vulkan
npm run bench -- --variant devextreme-sampled --vulkan
npm run bench -- --variant anychart --vulkan
npm run bench -- --variant anychart-sampled --vulkan
npm run bench -- --variant fusiontime --vulkan
npm run bench -- --variant fusiontime-sampled --vulkan
```

For a comparison with Chrome's default backend, omit `--vulkan` from both commands in a pair.
Focused runs without ChartGPU do not automatically select Vulkan. Reports from different requested backends are not equivalent comparisons.

## Library scope and progress

The expanded suite did not complete. The default suite runs idle first, then 43 variants for 31 libraries.
Renderer alternatives and sampled variants follow their base in `bench/demo-dependencies.mjs`. The manifest defines this order:

1. uPlot
2. Chart.js
3. ApexCharts
4. ApexCharts sampled (`apexcharts-sampled`)
5. ECharts
6. D3 Canvas (`d3`)
7. D3 Canvas min/max (`d3-minmax`)
8. D3 SVG (`d3-svg`)
9. D3 SVG min/max (`d3-svg-minmax`)
10. Flot
11. d3fc WebGL (`d3fc`)
12. d3fc Canvas (`d3fc-canvas`)
13. deck.gl+D3 WebGL2 (`deckgl`)
14. React Financial Charts (`financialcharts`)
15. AG Charts Community
16. Dygraphs
17. AnyChart (`anychart`)
18. AnyChart sampled (`anychart-sampled`)
19. visx (`visx`)
20. Bokeh WebGL (`bokeh`)
21. Bokeh Canvas (`bokeh-canvas`)
22. CanvasJS
23. Plotly WebGL (`plotly`)
24. Plotly SVG (`plotly-svg`)
25. Lightweight Charts
26. MUI X Charts (`muicharts`)
27. FusionTime (`fusiontime`)
28. FusionTime sampled (`fusiontime-sampled`)
29. DevExtreme (`devextreme`)
30. DevExtreme sampled (`devextreme-sampled`)
31. Vega
32. Highcharts Boost (`highcharts`)
33. Highcharts SVG (`highcharts-svg`)
34. SciChart
35. Billboard (`billboard`)
36. AntV G2 Canvas (`g2`)
37. Syncfusion (`syncfusion`)
38. ZingChart
39. amCharts
40. amCharts sampled (`amcharts-sampled`)
41. Recharts (`recharts`)
42. Kendo (`kendo`)
43. ChartGPU (`chartgpu`)

LightningChart follows these libraries when `LIGHTNINGCHART_LICENSE` supplies a runtime key.
Without that key, the suite records an explicit skip rather than an empty benchmark row.
Each variant uses a fresh browser with only its library and required demo dependencies.
The idle control runs first so the first completed library can show adjusted memory values.
The main table omits the idle row.

Each library has 3 warmup sessions and 7 measured sessions.
Each session creates a two-point chart, updates it with the full dataset, then resizes it to 1200×400.
Supported variants then measure ten mouse moves with 50 ms between each acknowledgment and the next move.
There is no 30-second pause between libraries.
The benchmark retains its rendering-settling waits and command timeouts.
An interactive terminal shows one table that updates in place after each library finishes.
All implementations of a library stay together in the table.
Trace and combined tables rank each library group by its lowest implementation-level mean `update ms`, before display rounding.
Within each group, implementations appear from fastest to slowest. Failed or unavailable implementations appear last within their group.
rAF tables use `next rAF ms` for both group and implementation order. Memory-only tables retain execution order, with library groups together.
Groups without a finite timing appear last in timed tables. Ties retain execution order, or first-seen order for reports without an execution list.
Saved summaries use the same ordering. Display order does not change execution order or raw report order.
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

`benchmarkVariants` in `bench/demo-dependencies.mjs` controls execution order.
`benchmarkRestrictions` excludes G2 WebGL, Google Charts, and JSCharting without disabling their standalone demos.
Explicit benchmark selection also rejects these variants and reports the reason.
`benchmarkVariants` includes `chartgpu` after `kendo`. ChartGPU also remains available through explicit selection.
`idle` is also selectable. `lightningchart` requires a runtime key, not a harness permission flag.
Default suite reports include the skipped variants and their reasons.

### Current validation status

The `deckgl` addition passed focused hardware-browser checks and memory-only/combined workers, as described in its renderer configuration.
No completed run of the 41-variant suite is available.

Browser and performance validation for the five sampled variants and the new metadata columns remains pending.
The results in this section predate these additions. This documentation update runs no browser tests or benchmark workers.

Direct combined trace/memory workers ran sequentially for `idle`, `bokeh-canvas`, `bokeh`, `d3fc-canvas`, `d3fc`, and `g2`.
Each passed 3 warmups and 7 measured samples with full input at DPR 1. The current results remain cached in `.cache/benchmarks/`.
The runs used hardware GPU acceleration. No cooldown separated workers, and these local checks do not establish a controlled performance ranking.
No full-suite rerun followed these checks. This documentation update did not rerun workers or browser tests.

The first full-data `g2-webgl` combined sample exceeded five seconds. Its worker exited with code 124.
G2 WebGL and Google Charts now have benchmark restrictions because of observed timeouts. Further diagnostics stopped at the user's request.
The shared adapter now uses `fill: 'none'` to avoid invisible fill triangulation in WebGL.
A full-data retry with that setting also timed out after five seconds and exited with code 124.
The five-second budget remains unchanged. No full-workload G2 WebGL performance result is available.
The updated 200-row browser smoke passed and confirmed zero fill drawcalls for all three line series.
Earlier Canvas measurements predate this setting. Canvas was not rebenchmarked in this follow-up.

The separate opt-in `test/integration/bench-g2-webgl-browser.mjs` passed one 200-row sample in 857 ms on AMD hardware WebGL2.
It checked three native GPU paths, initial and reused-context fences, and cleanup.
Cleanup removed the canvas and cleared the exposed context. Some resources had no observed explicit delete call, which does not prove a leak.
This smoke result establishes execution for 200 rows, not performance for the full workload.

To rerun the enabled Canvas alternatives with the idle control, run the corresponding command:

```sh
npm run bench -- --variant bokeh-canvas
npm run bench -- --variant d3fc-canvas
```

The [renderer validation record](../docs/investigations/benchmark-library-expansion.md#renderer-validation) includes the separate opt-in smoke command.

The previous agent reported 63 passing tests and 3 skipped opt-in tests for the amCharts, DevExtreme, AnyChart, and FusionTime changes.
Sequential combined trace/memory workers passed 7 measured samples each for amCharts and AnyChart.
The DevExtreme and FusionTime base configurations timed out under the unchanged five-second sample budget.
These results do not establish completed measurements for those two base configurations or universal visual fidelity.
This documentation update did not rerun tests or workers and did not change the timeout.

The following expansion results predate those configuration changes.
The suite attempt timed out after 600 seconds, after idle and 22 libraries through DevExtreme. Its partial report is not a completed suite.
Billboard, G2, Syncfusion, and DevExtreme passed with 3 warmups and 7 measured samples each in that run.
Separate workers for Kendo, AnyChart, FusionTime, Google Charts, MUI, React Financial Charts, and visx passed the same sample counts.
The final Recharts combined worker passed 3 warmups and 7 measured samples under a 512 MiB Node heap limit.
Its gzip archive reported no `dataLoss` after the calendar-axis correction.
All 12 runnable additions therefore passed integrated combined measurements across these runs, not one complete suite.
No full-suite rerun followed the timeout, and these results establish no performance ranking.

The focused benchmark and manual-profiler tests passed: 758 passing, with 20 optional browser tests pending in that invocation.
`git diff --check` passed.

The separate rAF pass completed 11 additions with 3 warmups and 7 measured samples each.
Google Charts exceeded the 120-second CDP limit for its entire ten-sample rAF batch. Its combined worker passed with separate phase commands.
No Google Charts rAF report was saved. These runs preceded the five-second sample deadline described below.
The [investigation](../docs/investigations/benchmark-library-expansion.md#trace-storage-and-recharts-investigation) records the Recharts trace diagnosis and JSCharting cleanup evidence.

### Candidates outside the default set

The [candidate review](../docs/investigations/benchmark-library-expansion.md#deferred-held-and-removed-candidates) records each decision and its limits.
These are workload, delivery, or priority decisions, not blanket incompatibility claims.

| Candidate | Decision |
| --- | --- |

| Perspective | User hold. Analytics and worker transforms need a fair workload. Current tracked totals omit worker CPU. |
| Observable Plot | Defer. The ordinary API lacks an independent second y scale for this workload. |
| Vega-Lite | Separate compile workload. The Vega result does not include Vega-Lite compilation. |
| LayerCake 11.0.0 | Defer. Raw Svelte components require a dedicated compiler and custom chart setup. |
| Nivo | Defer. The normal Canvas line chart has one y scale. A right axis is not an independent scale. |
| Victory | Lower priority. Native dual-axis and dense-line audits remain outstanding. |
| Tremor | Defer until its underlying renderer is clear, to avoid a duplicate wrapper comparison. |
| Frappe Charts | Defer. A continuous-time, independent-dual-axis path is not established. |
| Cytoscape | Network graphs do not match this time-series workload. |
| FusionCharts ordinary line | No separate adapter. Specialized FusionTime represents this family for this workload. |
| dvxCharts | Removed because the upstream distribution was unavailable during review. |

LayerCake 11.0.0 requires Svelte >=5.40. The pinned esm.sh request with Svelte 5.57.2 returned HTTP 500.
The recorded error was `esbuild: Expected ";" but found "Cake"`.
A dedicated Svelte compiler and custom chart components remain possible. The deferral does not mean that independent dual axes are impossible.

### ChartGPU demo and default-suite benchmark

[`bench/ChartGPU.html`](../bench/ChartGPU.html) uses the shared runner and pinned `chartgpu` 0.4.0 production ESM through esm.sh.
The published package exports `version: '1.0.0'`, despite the 0.4.0 dependency pin. Saved dependency provenance identifies the loaded package.
The adapter retains all 55,550 rows in typed columns, with native time and independent percentage/TCP axes.
It uses `sampling: 'none'`, `performance.lod: 'strict'`, no animation, default antialiasing, and one-physical-pixel lines.
Time ticks use native duration steps, not true calendar-month boundaries.

Each chart creates its own WebGPU device during initialization.
Lifecycle updates retain that chart and device. Sessions do not share an adapter-owned device cache.
The adapter submits its first frame in external mode, awaits the submission microtask, then awaits `queue.onSubmittedWorkDone()`.
It then enables automatic rendering for interaction. Cleanup disposes the chart and destroys its owned device.
These completion checks do not measure hardware GPU execution time or establish browser presentation completion.

The baseline Chrome Headless Shell 156.0.8078.47 probe exposed `navigator.gpu`, but `requestAdapter()` returned `null`.
Chrome reported `No available adapters.` The baseline report remains `.cache/benchmarks/chartgpu-browser-report.json`.
A separate launch with `--enable-features=Vulkan` exposed a non-fallback AMD adapter and passed the 200-row and full-data smoke samples.
Its report is `.cache/benchmarks/chartgpu-browser-vulkan-report.json`.
The benchmark checks every adapter-exposed device queue after settling, with a one-second completion bound inside the five-second sample deadline.
It records per-sample `webgpu` status and rejects device loss, GPU errors, incomplete queues, and failed cleanup.
No probe devices or pixel readbacks enter the benchmark. The rAF mode adds no post-render fence but retains the adapter's initial queue wait.

For the standalone demo, open `bench/ChartGPU.html` through localhost or HTTPS in a hardware-WebGPU-capable browser.
The page downloads the pinned module from esm.sh.

For the cache-only browser smoke, first cache the pinned module:

```sh
node --input-type=module -e 'import {bundleModuleDependencies} from "./scripts/bench-module-bundle.mjs"; import {demoDependencies} from "./bench/demo-dependencies.mjs"; await bundleModuleDependencies(demoDependencies.chartgpu, {cacheDir: ".cache/benchmarks/framework-modules"});'
```

Then run the opt-in test:

```sh
TEST_CHARTGPU_BROWSER=1 node node_modules/mocha/bin/mocha.js test/integration/bench-chartgpu-browser.mjs
```

For the verified Linux headless Vulkan configuration, run:

```sh
TEST_CHARTGPU_BROWSER=1 TEST_CHARTGPU_VULKAN=1 node node_modules/mocha/bin/mocha.js test/integration/bench-chartgpu-browser.mjs
```

This smoke-test opt-in adds only `--enable-features=Vulkan`. The separate benchmark harness now selects Vulkan automatically for Linux runs that include ChartGPU.
Explicit Vulkan enablement bypasses normal Vulkan compatibility selection and changes Chrome's compositor from GaneshGL to GaneshVulkan on this machine.
WebGL retained ANGLE/OpenGL. No `--enable-unsafe-webgpu`, `--ignore-gpu-blocklist`, software backend, or sandbox-disabling flag was added.
Results from this configuration must not be mixed silently with the existing OpenGL-compositor results.

The hardware smoke observed three submitted native line draws, each with 55,549 segment instances, covered by a completed queue fence.
Both samples had no reported GPU errors. Cleanup removed canvases and references, and each device reported intentional destruction.
The full-data sample took about 82 ms externally, including instrumentation, preparation, initialization, queue completion, and cleanup.
It followed the small sample in the same browser. This single observation is not a benchmark minimum or a visual-equivalence result.

The test requires the existing cached Chrome. It probes hardware before it loads vendor modules.
With a hardware adapter, it checks fresh 200-row and 55,550-row charts, with a hard five-second limit per sample.
The sample limit includes preparation, GPU completion, and cleanup. The test does not produce ranked benchmark results.

The combined Vulkan benchmark completed on 2026-10-24 at DPR 1, with a fresh same-backend idle control.
Both variants completed three warmups and seven measured rounds. All ten ChartGPU samples passed queue completion, with no sample timeout or trace data loss.

| Variant | prep ms | init ms | main ms | gpu ms | total ms | peak MB | retained MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ChartGPU | 5.2 | 116.7 | 41.8 | 82.3 | 130.4 | 41.8 | 37.3 |

This historical table uses separate measured minima, not the current arithmetic means.
Its memory values predate `through-update-v1` and retain their original measurement boundary. The numbers remain unchanged.
`total ms` covers selected traced host threads, not complete CPU work or hardware GPU execution.
The trace audit found omitted renderer/GPU I/O work of 0.61–4.38 ms per measured round.
Its inclusion would change the minimum tracked total to 134.8 ms. The current metrics remain unchanged.
These trace categories expose no identifiable Dawn/Vulkan worker intervals, so complete worker coverage remains unverified.

One idle poll and two ChartGPU polls encountered missing `/proc` entries during construction. The analyzer excluded these incomplete observations.
All selected memory minima came from unaffected samples. Memory remains sampled browser-tree PSS, not device memory.
Chrome also logged a tracing-session ACK timeout, but both traces reported `dataLoss: false` and retained all measured windows.
The saved suite is `.cache/benchmarks/results-chrome-combined-vulkan.json`. This run establishes no ranking against earlier non-Vulkan results.

## Timing and memory protocol

### Lifecycle phases

The benchmark measures three operations on one retained chart, plus hover for supported variants:

1. `small-init`: Create the chart-specific host and the chart with two points per series, from the first and last fixture rows.
2. `data-update`: Replace that input with the full dataset: 55,550 rows and 166,650 total series points.
3. `resize`: Resize the same chart from 1920×600 to 1200×400, without replacing its data.
4. `hover-10`: Move the mouse over ten distinct datapoints, with CPU, RAM, and TCP Out as alternating targets.

Each session starts with a new small chart. It never shrinks a full chart before measurement.
The small fixture preserves the full timestamp range. Y-axis ranges remain automatic and can change during the update.

Initialization and data update call the shared `prepData` function separately. The small and full inputs have different references, lengths, and contents.
Resize and hover retain the full input and record zero data-preparation time.
Hover target preparation includes geometry reads outside its marker window. The `prep ms` column still measures only full-data conversion.
The harness uses the original full fixture without a packed copy or synthetic value changes.
JSON parsing and small-fixture selection occur outside the preparation and chart timers.
The `prep ms` column measures full-data conversion. Small-data preparation remains in the initialization phase's JSON record.
Adapter copies that protect caller data from library mutation remain unchanged.

A session retains the chart, framework root, and available graphics resources across operations.
Memory-enabled sessions force GC after the settled data update, before resize. No forced GC occurs between initialization and data update.
The update includes buffer growth, geometry allocation, and work that the library defers until it receives substantial data.
This protocol measures small-to-full population, not steady-state full-to-full replacement or direct populated startup.

Each session contains three independent marker windows, or four with hover. Reports retain `phase: 'chart-population'` and `resizeProtocol: 'retained-resize-v1'`.
The `lifecycle.resizeSize` field records `{width: 1200, height: 400}`.
New reports identify `hoverProtocol: 'hover-ten-v3'` and store the supported variants in `hover.variants`.
Both v2 and v3 require `count: 10` and numeric `intervalMs: 50`.
The report stores each window in `samples[].phases`. The outer sample describes the full-data update and holds memory observations through the post-update `live` checkpoint.
New memory-enabled lifecycle reports identify `memoryProtocol: 'through-update-v1'`.
Timing analyzers expose all operation summaries in `phaseGroups`. Their ordinary `groups` contain update results only.

The HTML demos still construct directly with the full dataset.
Historical results in this document describe their original protocols, not small-to-full population or `through-update-v1`.
Their numbers and table layouts remain unchanged. They do not establish measurements under the current memory boundary.
Reports with `initProtocol: 'settled-work-v1'` include chart-specific DOM setup and report full-window initialization work in trace modes.
Saved summaries preserve readiness-based initialization for older reports. A summary rejects mixed initialization boundaries and mixed population, legacy lifecycle, or startup protocols.
Legacy two-operation reports remain readable without a resize column. All modes reject comparisons between reports with and without the resize protocol.
Saved summaries also reject mixed hover protocols, capability lists, or interval snapshots, including memory-only reports.
Legacy `hover-ten-v1` and `hover-ten-v2` reports remain readable and use the same `hover10 ms` column independently of v3.
A summary cannot combine different hover protocols, including v2 with v3. This rule also applies to memory-only reports.
Reports without hover remain readable without the hover column.
Legacy memory reports remain readable under their original boundaries. Summaries reject mixed memory boundaries, including legacy reports combined with `through-update-v1`.

### Resize adapter contract

Each runnable adapter exports `resizeChart(chart, {width, height}, host, wait)`.
The hook retains the chart and source data. It returns `undefined` or the same chart, directly or through a promise.
A replacement chart causes the benchmark to fail.

The harness changes the host dimensions inside the resize markers, before the adapter call.
The adapter resizes its internal containers, native surfaces, scales, and axes through the library API or retained component state.
Existing title and margin conventions remain unchanged. The browser viewport remains 1920×900.
Fixed sampling targets remain unchanged, but pixel-dependent geometry can change with the width.

Async adapters await a fresh completion signal for the resized chart. Existing SVG paths alone do not establish completion.
FusionTime waits for `resized`, rather than its data-update `renderComplete` event. SciChart waits for a fresh, settled CPU `rendered` event.
React adapters retain the root and await geometry for the new dimensions. ChartGPU waits for command submission and queue completion.
The harness then applies the same settling and graphics completion checks as data updates.

Serial smoke tests covered all 44 default chart variants with cached Chrome 156.0.8078.47 and Vulkan at DPR 1.
Forty-two variants completed within the normal five-second operation budget. Unsampled FusionTime and DevExtreme exceeded that budget during data update, before resize.
Both completed resize in diagnostic runs with a 20-second budget. FusionTime resize also exceeded five seconds in that diagnostic.
The production timeout remains unchanged. These single-session checks establish adapter coverage, not comparative performance.

Additional checks covered uPlot, D3 min/max, Deck.gl, and ChartGPU at DPR 2.
uPlot also completed untraced rAF, combined trace/memory, and production-count captures with 30 operation windows.
The optional licensed LightningChart adapter has unit coverage, but no resize browser check.

### Hover protocol and adapter contract

In trace modes, `hover10 ms` measures cumulative work for ten mouse moves, not the average cost of one hover.
The hover phase follows resize, so it uses the full dataset at 1200×400.
The pointer starts outside the chart. Chrome receives trusted `Input.dispatchMouseEvent` mouse moves at data-derived coordinates through `scripts/benchmarks-mouse.mjs`.
The benchmark never calls a tooltip API or dispatches synthetic DOM events to bypass normal hit testing.

The ten targets span the time range and cycle through series indices `0, 1, 2`.
In `hover-ten-v3`, one browser binding sends all ten coordinate targets to Node.
Node sends ten `Input.dispatchMouseEvent` calls in order.
After each of the first nine CDP acknowledgments, Node waits 50 ms before the next dispatch.
These nine waits give at least 50 ms between moves. There is no catch-up schedule or wait after the tenth acknowledgment.

After the tenth CDP acknowledgment, Node sends one browser `Runtime.evaluate` completion acknowledgment.
The measured sequence has no per-point renderer timer, renderer acknowledgment, or rAF.

Hover phases still record `hover: {count: 10, intervalMs: 50}` without verification evidence.
No value verification or harness DOM/canvas reads occur in this measured sequence.

The entire sequence uses one marker window.
After the batch completion acknowledgment, the window includes the unchanged two rAF callbacks, 200 ms wait, and graphics completion checks.
Trace totals include observed layout, paint, raster, compositor, GPU-process, and GC work within this window.

Batching reduces input-bridge overhead but does not eliminate it. Browser work for the binding, input dispatch, and completion acknowledgment remains in the window.
Node scheduling is outside measured browser threads. Idle spacing does not count as thread work. This change adds no CPU profiling.

rAF wall latency includes at least 450 ms of spacing plus input-bridge and timer overhead.
It excludes the final settling interval and graphics fences.
These completion checks do not establish compositor presentation or coverage of every worker and delayed task.

Legacy `hover-ten-v1` used frame-paced moves and value verification inside the window.
Its reports describe ten verified displays, unlike the fixed-delay v2 and v3 input sequences.
Legacy `hover-ten-v2` used a browser binding, renderer timer, and browser completion acknowledgment for each point.
Current v3 moves the nine waits to Node and batches the browser binding and completion acknowledgment.
The protocols are not interchangeable.

Supported adapters export `getHoverPlan(chart, input, host)`.
This read-only preparation hook returns ten viewport targets and a diagnostic `verify(target)` function.
Each target contains `x`, `y`, `index`, and `seriesIndex`.
Browser preparation computes the plan and validates target bounds outside the marker window.
Production retains only target coordinates. It neither retains nor calls the verifier.

The separate `verifyHover(plan, ...)` helper supports harness-development diagnostics outside the benchmark.
It checks each target after 50 ms and requires a matching visible tooltip or legend value.
Diagnostic verification never runs during capture or preflight and never prewarms the measured chart.
Successful diagnostic evidence contains the actual `index`, `seriesIndex`, `value`, and `text`.
Production hover phases record the count and interval, not per-point verification evidence.

Pixel rounding can select a nearby source row. Diagnostic adapters permit at most one CSS pixel of horizontal data displacement and record the actual row.
A tooltip container, date header, static legend, or native selection without matching value text does not pass diagnostic verification.
Diagnostic DOM checks include visibility, ancestor visibility, and nonzero geometry.
Chart.js diagnostic verification uses active points, formatted tooltip text, opacity, and dimensions.
No harness value, DOM, canvas, screenshot, or pixel-readback checks occur during measured hover.

The supported set contains 23 chart variants:

| Library | Supported variants | Display |
| --- | --- | --- |
| uPlot | `uplot`, `uplot-release` | Live legend |
| D3 | `d3`, `d3-minmax`, `d3-svg`, `d3-svg-minmax` | Live legend |
| d3fc | `d3fc`, `d3fc-canvas` | Live legend |
| Deck.gl | `deckgl` | D3-based live legend |
| Chart.js | `chartjs` | Native Canvas tooltip |
| Dygraphs | `dygraphs` | Live legend |
| Highcharts | `highcharts-svg` | Shared tooltip |
| Plotly | `plotly`, `plotly-svg` | Shared-x hover labels |
| Lightweight Charts | `lightweight` | Live legend |
| Bokeh | `bokeh`, `bokeh-canvas` | Native nearest-point tooltips |
| CanvasJS | `canvasjs` | Native tooltip |
| ApexCharts | `apexcharts` | Native shared-x tooltip |
| Billboard | `billboard` | Native grouped tooltip |
| AnyChart | `anychart` | Native union tooltip |
| Recharts | `recharts` | Native axis tooltip |
| DevExtreme | `devextreme` | Native shared tooltip |

The idle control uses ten mouse moves and the same nine 50 ms waits, but requires no chart values.
Unimplemented variants omit the hover phase and leave the column blank, rather than report zero.
Production target-preparation or input errors fail the session. Diagnostic value failures belong to separate harness-development checks.

Chart.js explicitly selects tooltips along x. Plotly uses shared-x hover so overlapping near-zero series remain reachable.
Unsampled ApexCharts and DevExtreme also use native shared tooltips to keep overlapping series accessible.
Their sampled variants retain their previous tooltip configuration and remain outside the hover capability list.
Recharts uses a small scale-only component to expose native coordinates. No new per-hover state or custom tooltip component is necessary.
Highcharts SVG builds its first search tree synchronously inside mouse handling and suppresses hover markers that can trigger tracker mouseout.
Highcharts Boost keeps its previous configuration and remains unsupported: its table-backed hover points lack the required y-value and index in the pinned release.
ECharts also remains unsupported: pixel rounding can make another independently sampled series win axis-tooltip selection.
Kendo remains unchanged and unsupported. Its pinned scatter-line tooltip has a fixed 100 ms delay that cancels nine displays at the 50 ms cadence.
Native shared-tooltip configuration does not change that behavior for this series type.
These exclusions do not mean that the libraries lack hover support.

Historical v1 browser checks passed all supported variants and the idle control with pinned Chrome 156.0.8078.47 at DPR 1.
Additional DPR 2 checks covered uPlot release, D3 min/max, Chart.js, Plotly, Highcharts SVG, and Lightweight Charts.
uPlot also passed untraced rAF and a production-count combined capture with 40 operation windows.
Unsupported visx, ECharts, and Highcharts Boost retained three windows and blank hover cells.
These historical checks establish v1 input and value-display coverage, not comparative performance or pixel-level presentation proof.
They do not validate legacy v2 pacing, current v3 batching, or the separate 50 ms diagnostics.
These historical results do not establish browser validation for v3.

Separate v3 diagnostics verified ten distinct source rows, requested series values, and visible native tooltip text for all eight additions.
Bokeh and Recharts diagnostics observed native DOM mutations and animation frames throughout the batch and final settle.
Fixed-delay checks alone can miss their visible updates when native work delays the diagnostic timer.
These observers ran only in diagnostic fixtures. Measured fixtures rejected any verifier call and retained all four operation windows.
DPR 2 checks covered Bokeh Canvas, CanvasJS, and Recharts. CanvasJS and Recharts also completed production-count captures.
DevExtreme passed hover diagnostics with an extended diagnostic timeout, but its data update exceeded the normal five-second budget in measured runs.
The production watchdog remains unchanged. These checks do not establish compositor presentation or comparative performance.

### Operation timeout

Each operation has a hard five-second budget in trace, memory, combined, and rAF modes.
The budget includes preparation, drawing, settling, completion checks, and process polling.
The first budget also includes host setup and the baseline memory checkpoint.
The post-update live checkpoint occurs before resize. Chart destruction retains a separate five-second budget.
Library downloads, initial page loading, and final trace analysis are outside this budget. They retain separate command and worker limits.

The watchdog runs in Node, outside the renderer. A synchronous JavaScript loop cannot block this watchdog.
On timeout, the worker reports `<library>: timed out after 5s` and exits with code 124.
It kills Chrome and its discovered descendants, closes CDP connections, and skips chart teardown and trace download.
The suite records the timeout, shows `-` in every metric column, and continues with the next library.
Timing tables place timed-out implementations last within their library group. Groups without measured timings appear after groups with measured timings.
Memory-only tables retain execution order, with library groups together.
Library errors also produce `-` rows without stopping later libraries. These include crashes, dependency errors, and missing or invalid worker reports.
The suite exits successfully after every library produces measurements, times out, or fails.
User cancellation, idle-control failures, worker-launch failures, unsafe process cleanup, and suite-report write failures still stop the suite.
The suite does not save the timed-out library's incomplete trace or replace its previous successful trace.

The suite JSON stores timeout details in `timeouts` and other library errors in `failures`.
Both remain separate from successful `reports` and `progress.completed` entries. Error details include the captured worker output when available.
`complete: true` means every selected variant was attempted, not that every library produced measurements.
Saved summaries preserve timeout and failure rows. Failed samples do not contribute to timing or memory statistics.
Linux process-tree discovery uses a non-atomic `/proc` snapshot. Newly created or already-reparented descendants can escape discovery.

The rAF runner sends sample-boundary notifications to the Node watchdog. These notifications are outside the measured chart interval.
The five-second budget resets for each operation and final cleanup. A session is not subject to one shared five-second limit.

### Measurement boundaries

Library loading, raw JSON parsing, and the shared page shell occur outside the chart timers.
Chart-specific DOM creation and insertion occur inside initialization markers.
This includes D3 titles, legends, and canvases, the Chart.js canvas, other chart hosts, and library-created DOM.
`bench/demo-runtime.mjs` downloads WASM bytes before timing. Stable Blob URLs permit normal compiler-cache reuse across samples.
WASM compilation, instantiation, and native ingestion initially occur inside chart initialization, subject to normal browser and vendor cache reuse.
The benchmark does not force repeated compilation through artificial cache busting.
Each populated operation times the actual demo preparation function separately from chart work.
uPlot uses its own shared preparation function, with timestamps in seconds and the default time scale.
Lightweight Charts and SciChart also use timestamps in seconds.
Syncfusion, DevExtreme, Kendo, and Google Charts prepare Date values.
The other adapters prepare numeric millisecond timestamps. Financial Charts constructs Date values through its x accessor during initialization.
The benchmark does not convert uPlot data to milliseconds or override its chart configuration.
Small initialization includes host setup, configuration construction, chart construction with two points per series, async library completion, and the initial microtask commit.
Data operations include the native update call, any ingestion work, and adapter readiness.
Resize includes the host-size change, native resize call, geometry changes, and adapter readiness.
The `jsMs` field measures elapsed readiness time for its operation, including async waits. It does not measure exclusive JavaScript CPU time.
Trace `init ms` instead uses total tracked thread work through the end of the initialization window, after settling and graphics completion checks.
The readiness interval remains available in JSON. Chart validation occurs outside both timers.
Current v3 and legacy v2 keep hover value verification in separate harness-development diagnostics, outside capture and preflight.
The measured sequence performs no per-point verification or harness DOM/canvas reads.

Async completion follows each module's library-specific promise or event.
Highcharts also waits for Boost hover-point processing. amCharts waits for an idle render loop after `frameended`.
The amCharts adapter shows the logo immediately in its final state, with its link, tooltip, and hover behavior intact.
A version-specific override gives only its entrance animations zero duration. The vendor's delayed callback remains, but no longer starts an animation.
This override uses `root._logo` and requires review when the pinned version changes.
LightningChart waits for `renderframe` without pending async rendering.
Bokeh awaits `Plotting.show()` and document idle. AG Charts awaits `waitForUpdate()`. Vega awaits `runAsync()`.
SciChart awaits `renderInstructionsCompleted` with no invalidation or animation. d3fc submits its initial draw synchronously and calls `gl.flush()`.
Billboard awaits `onrendered`, G2 awaits `render()`, Syncfusion awaits `loaded`, and DevExtreme awaits `onDone`.
The standalone JSCharting adapter awaits its chart-ready callback.
Kendo awaits `render`. Its pinned source completes initial Canvas drawing synchronously before this event.
A separate pixel probe validated Kendo output. The adapter no longer adds an extra rAF wait.
AnyChart awaits `chartDraw`, FusionTime awaits `renderComplete`, and Google Charts awaits `ready`.
The React helper creates and commits roots through `flushSync` inside initialization.
Recharts, MUI, and visx await three complete SVG line paths. Financial Charts checks its committed Canvas chart and full `plotData` length.
These library signals do not establish GPU completion or presentation. Trace and memory modes add the completion checks described next.

The rAF mode aligns chart start with an animation-frame callback.
`raf1Ms` ends at the first rAF callback requested after the operation reaches readiness.
Async operations can span earlier frames, so this callback is not necessarily the next frame after chart start.
`postJsRaf1Ms` measures only the interval from readiness to that callback.
The rAF mode remains uninstrumented by the WebGL observer, completion checks, and context-info queries.

Each chart window starts at its operation call and ends after settling and the graphics completion checks.
It includes deferred rendering but excludes data preparation, forced GC, and teardown.
Settling uses two animation frames and a 200 ms wait. This wait alone is a heuristic, not a completion guarantee.

Trace and memory modes run WebGL completion checks after library readiness and settling, after `js-end` but before the sample `end` marker.
WebGL2 uses async fences: `fenceSync()`, `flush()`, and timer-based `clientWaitSync()` polling with zero timeout.
WebGL1 uses blocking `gl.finish()`. The fence timeout cannot interrupt a blocking GL call, so the browser watchdog remains necessary.
The observer then queries raw renderer/version strings and the optional unmasked renderer string. Unavailable strings remain `null`.
These strings can be masked. They do not prove hardware acceleration.

`scripts/bench-webgl.mjs` observes current-realm `HTMLCanvasElement` and `OffscreenCanvas` context acquisition.
The observer retains observed contexts until session cleanup. Later operations fence those contexts even without another `getContext()` call.
Adapter `getWebGLContexts()` hooks also expose reused contexts.
A small chart can defer full-size allocations or renderer selection until the full-data update.
Workers and other realms remain outside this coverage unless they install their own observer.
Completion covers only commands before each fence or finish call, not later draws or compositor presentation.
No observed context is not proof that a library performed no GPU work.

Completion checks occur after constructor readiness but inside the chart window. Their tracked work contributes to trace `init ms` for initialization.
Thread-wall totals include blocking finish waits, fence submission/polling, and context-info queries.
This overhead can change scheduling. Neither these totals nor completion latency measures hardware GPU busy time.

The trace enables `blink.user_timing`, `disabled-by-default-devtools.timeline`, `disabled-by-default-v8.gc`, and `cppgc`.
These categories supply sample markers, thread tasks, raster tasks, GPU tasks, and collector scopes.
The completion protocol does not add arbitrary broad GPU tracing categories.
The main-thread total includes style, layout, and paint work, but the trace omits their separate breakdown.
The JSON field `styleLayoutPaintMs` is therefore unavailable (`null`), not zero.
Browser upgrades require another event-coverage check.

The `thread-work-gc-v2` accounting protocol adds selected background V8 and Blink/C++ collector scopes.
The allowlist in `scripts/bench-trace-policy.mjs` excludes unpark scopes, synchronization scopes, and generic worker wrappers.
Selection covers workers in the chart renderer and GPU processes, not unrelated renderers or browser UI threads.
Per-thread interval unions remove overlaps between nested collectors, raster tasks, and GPU tasks.
Main-thread GC already belongs to main-thread task totals.

JSON includes `backgroundGcMs` and `gcAddedThreadWorkMs` for each phase.
The first field measures selected collector intervals. The second measures their addition to the total after overlap removal.
Both fields are `null` without relevant recorded scopes or under legacy accounting.
Zero means recorded scopes exist but add no duration in that window. It does not prove that no collection occurred.
GC has no separate table column. GC additions affect initialization work, `update ms`, `resize ms`, and `hover10 ms`.
Collection during a phase can reclaim allocations from earlier phases. Temporal overlap does not establish allocation ownership.
Collector wall durations can include preemption and internal waits. They do not measure exclusive CPU usage.

Capture and analysis metadata record `accountingProtocol` separately from `initProtocol`.
Reports without accounting metadata retain legacy `thread-work-v1` totals during analysis.
Saved summaries reject mixed accounting protocols. New results require fresh captures for all compared variants.
The [GC and cold/warm assessment](../docs/investigations/benchmark-gc-cold-warm.md) records focused measurements, category coverage, and instrumentation limits.

Memory modes record blank-page and loaded-library/raw-data checkpoints before warmups.
These checkpoints are single observations, not round aggregates.
Each memory sample then has this sequence:

1. Establish session state without a chart host and allow previous rendering to settle.
2. Force JS GC and record the process-memory baseline.
3. Prepare the two-point input while process polling runs.
4. Create the chart-specific host and small chart while process polling runs.
5. Prepare the full input while process polling runs.
6. Record the prepared snapshot without forced GC.
7. Update the retained chart with the full input while process polling runs.
8. After the data update settles and graphics completion checks finish, force JS GC.
9. Record retained process memory at the `live` checkpoint. End memory collection.
10. Resize the retained chart to 1200×400 without process polling or memory observations.
11. For supported variants, hover ten datapoints without process polling or memory observations.
12. Destroy the chart and release input references as usual.
13. Allow rendering to settle without cleanup GC or a cleanup memory observation.

Each chart operation retains its full settling interval and graphics completion checks. Memory collection does not shorten any timing phase.
Within each session, forced GC occurs only at baseline and after the settled data update.
No forced GC occurs between initialization and data update. Trace-only and rAF modes request no memory GC.
The prepared snapshot includes the small chart and temporary allocations.
Consequently, the historical `dataDelta` field also includes small initialization. It does not isolate preparation from chart initialization.

The retained checkpoint includes the live chart and full prepared input at the original 1920×600 size, before resize or tooltip interaction.
Process polling covers only preparation, small initialization, and data update.
Peak memory includes the baseline, initialization, preparation, update, and post-update `live` checkpoint.
It excludes resize, hover preparation, hover execution, and teardown.
No process polling, memory observations, or cleanup GC occur after `live`. Normal chart destruction still runs.

GC does not force native allocators or graphics caches to return pages to the operating system.

The combined mode records a trace during the memory checkpoints and chart samples.
Tracing starts before the blank-page checkpoint.
The post-update forced GC occurs before resize, outside all timing windows. It can still affect later combined-mode timings.
Trace buffers can grow during memory collection, and process polling also affects the workload.
Combined results therefore describe an instrumented run, not independent timing and footprint measurements.
The separate commands provide measurements without the other instrumentation.

## Output table

All measurement modes start with `variant`, `context`, `sampling`, and `lossy`, followed by the measurements.
These columns describe the configuration, primary-series backend, and potential sampling loss. They are not performance measurements.
The `variant` column repeats the compact library name instead of renderer or sampling suffixes.
For example, `bokeh` and `bokeh-canvas` both display as `bokeh`, with separate context values.
`benchmarkLibraryName()` defines the known library groups. Unknown variant names remain unchanged.
CLI selection, filenames, progress, warnings, and JSON retain full variant IDs.

`benchmarkMetadata` in `bench/demo-dependencies.mjs` defines the metadata.
Per-variant reports save a snapshot in `runner.benchmark`. Suite reports save snapshots in `variantMetadata`.
Saved summaries use these snapshots, not the current manifest, so later configuration changes do not relabel historical results.
Legacy reports without a sampling snapshot show `unavailable`. The summary does not guess historical sampling configuration.

A blank sampling cell means no configured reduction. Reports retain `sampling: 'none'` to distinguish this from missing metadata.
A blank cell does not guarantee visual fidelity or the absence of internal processing.
The labels also cover existing native reduction:

| Sampling label | Configuration |
| --- | --- |
| `minmax` | uPlot pixel-level path reduction, Chart.js/ECharts native min/max sampling, and SciChart `Auto` resampling (observed MinMax-equivalent). |
| `pixel-distance` | Highcharts Boost reduction. |
| `pixel-tolerance` | Syncfusion line reduction. |
| `conflation` | Lightweight Charts line conflation. |
| `simplify` | Plotly SVG line simplification. |
| `aggregation` | AG Charts native line aggregation. |
| `grouping` | LightningChart native zoom-dependent grouping. |
| `avg (1min)` | FusionTime base average aggregation with one-minute bins. |

The [sampled variants](#sampled-variants) have separate labels for LTTB, average aggregation, and distance-based simplification.
Labels do not guarantee accuracy, peak preservation, or identical algorithms across libraries.

The `lossy` column indicates potential loss or attenuation of extrema from the configured reduction:

- `*`: LTTB, averaging, closing-value conflation, distance/tolerance reduction, or line simplification can remove or attenuate extrema.
- Blank: no configured reduction, or a verified bucket-extrema-preserving strategy such as min/max.
- `?`: unverified classification or a saved report without `lossy` metadata.

A blank marker does not promise identical pixels, exact timing, or preservation of every oscillation within a bucket.
AG Charts line aggregation retains first/last and min/max indices per bucket, so it uses the same exemption as min/max.
SciChart still uses `EResamplingMode.Auto`. Native-output tests found exact agreement with explicit `MinMax` across the pinned workload and adversarial matrix.
It therefore receives the min/max exemption and a blank marker. This evidence does not prove that `Auto` always selects `MinMax`.
The [accuracy investigation](../docs/investigations/benchmark-library-expansion.md#scichart-reduction-accuracy) records the cases, output counts, and limitations.
LightningChart grouping remains `?`. Its source suggests min/max selection, but final-bucket preservation needs licensed runtime confirmation.
FusionTime's one-minute average bins receive `*` because multiple observations in one minute can merge.
The current fixture has one observation per minute, so this marker does not claim observed loss in that fixture.
Reports store `lossy` as `true`, `false`, or `null`. Saved summaries preserve the recorded classification rather than infer one from the current manifest.

`context` means the primary-series backend, not axes, support probes, or export canvases.
`webgl` means WebGL1 exactly. `webgl2` is a distinct value, not an alias.
Static `svg`, `2d`, `webgl`, and `webgpu` labels describe configured backends, not measured hardware acceleration.
A support GL context cannot turn a Canvas or SVG series into a WebGL series.

SciChart, LightningChart, and G2 WebGL have conditional context labels from measured GL evidence, excluding warmups.
Missing or ambiguous evidence produces `unavailable`. This rule also applies to rAF reports, which do not capture GL contexts.
Legacy reports can use unambiguous measured context evidence for known WebGL series, but cannot infer historical sampling configuration.

By default, the combined table shows these measurements in this order:

- `prep ms`: Preparation of the full dataset.
- `init ms`: Total tracked thread work for host setup and two-point chart initialization, including deferred rendering and graphics completion checks.
- `update ms`: Total tracked thread work for the full-data update and rendering, including deferred work and graphics completion checks.
- `peak MB`: Baseline-adjusted sampled peak browser-tree PSS through the post-update `live` checkpoint.
- `retained MB`: Baseline-adjusted retained browser-tree PSS at that checkpoint, before resize or tooltip interaction.
- `resize ms`: Total tracked thread work for resize, including host sizing, deferred work, and graphics completion checks.
- `hover10 ms`: Cumulative tracked thread work for ten mouse moves, including deferred work and graphics completion checks.

With `--verbose`, current trace and combined tables also show these columns between `init ms` and `update ms`:

- `main ms`: Renderer main-thread work in the update window.
- `gpu ms`: GPU-process main-thread work in the update window.

The flag does not remove metrics from full rows or JSON. It does not change sorting, aggregation, warnings, or capture.
Trace-only tables omit the memory columns. Memory-only tables show `peak MB` and `retained MB` after the four metadata columns.

A double boundary follows `retained MB` only when the next column is `resize ms`, `resize rAF ms`, or `hover10 ms`.
This boundary separates memory through the data update from later timing-only operations.
Tables without a following resize or hover column have no extra boundary.

Trace and combined timing columns use arithmetic means across the seven measured rounds, excluding the three warmups.
This applies to `prep ms`, `init ms`, `main ms`, `gpu ms`, `update ms`, `resize ms`, and `hover10 ms`.
Zero values contribute to the mean. Missing or invalid values do not become zero, and incomplete metrics produce warnings.
JSON retains `min`, `max`, `mean`, valid counts, missing counts, and individual phase samples.

`update ms` averages each round's deduplicated update-window total.
Main-thread GC and selected background GC already contribute to those totals. The analyzer does not add averaged GC again.
The JSON GC breakdowns also include arithmetic means, with zero-GC windows included.
These means account for observed work within the phase windows, not collection between windows or full amortized application cost.
The update total excludes small initialization and preparation. The sorting and color thresholds apply to mean full-data update work.
`init ms`, `resize ms`, and `hover10 ms` use the same thread-work metric as `update ms`, but for their separate windows.
It includes captured main-thread work, raster tasks, compositor work, GPU-process work, and selected background GC.
Idle gaps in the fixed settling wait do not count as work. Actual harness work within that window still counts.
Trace and combined tables omit update readiness. JSON retains it as `jsMs` and `jsIntervalMs` for the `data-update` phase.
`main ms` and `gpu ms` remain update-window components, useful for comparing downsampling costs. They do not describe initialization, resize, or hover.
The JSON metric remains `totalTrackedThreadWorkMs` for every phase.
Legacy startup-only reports retain `total ms` because they contain no separate data update.

rAF tables use `init rAF ms` for the first callback after initialization readiness, rather than imply a settled thread-work measurement.
They retain update readiness in `update ms` and update callback latency in `next rAF ms`.
The `resize rAF ms` column shows the minimum resize `raf1Ms`.
In rAF mode, `hover10 ms` shows minimum latency from sequence start to the first callback after readiness.
Current v3 readiness follows one browser completion acknowledgment after all ten CDP dispatch acknowledgments.
Current v3 and legacy v2 latency includes nine 50 ms waits, or at least 450 ms, plus input-bridge and timer overhead.
Legacy v1 latency includes per-point frame waits and value verification instead.
All three exclude final settling and fences. None is comparable to trace-mode hover thread work.
Unlike trace tables, rAF-only tables do not measure total thread work.
rAF-only timing columns still use minima. Memory columns also retain their existing minimum-value aggregation.
Neither rAF callbacks nor the settling heuristic prove compositor presentation or completion of every delayed library task.
Trace totals cover selected host threads, not hardware GPU execution or all worker activity.
Memory columns end at the post-update `live` checkpoint, before resize or hover. Peak memory also includes baseline, preparation, and small initialization.
`peak MB` uses the minimum per-round peak. Each round's peak remains the maximum sampled observation.
Trace and rAF timings do not subtract idle timings.

The table omits the index, sample-count, and DPR columns. Sample counts and DPR remain in JSON.
Variant names and the `context`, `sampling`, and `lossy` columns align left without quotes. Numeric columns align right and show one decimal place.
The JSON retains full measurement precision.

Interactive terminals color `init ms`, `update ms`, `resize ms`, and `hover10 ms` in trace tables.
These columns use the same shades. Initialization reaches red at 100 ms, while the other three reach red at more than 100 ms.
Legacy startup-only tables also color `init ms` and `total ms`.
The display leaves `main ms`, `gpu ms`, and rAF-only timings uncolored.
Fixed bands use unrounded values. Extreme outliers do not change the colors of other rows.
The frame reference is `F = 1000/60 ms` (about 16.67 ms), so green ends at `2F` (about 33.33 ms).

The graded columns use these ranges. Context colors are categorical and appear separately below.

| Column | Green shades | Orange shades | Red shades |
| --- | --- | --- | --- |
| `init ms` | `0–2F` (about 33.33 ms) | `2F < ms < 100` | `≥100 ms` |
| `update ms`, `resize ms`, `hover10 ms` | `0–2F` (about 33.33 ms) | `>2F–100 ms` | `>100 ms` |
| `peak MB` | `0–35 MB` | `35 < MB < 50` | `≥50 MB` |
| `retained MB` | `0–35 MB` | `35 < MB < 50` | `≥50 MB` |

The following table gives each shade's upper limit. Limits are inclusive unless marked `<`.
Each shade starts after the previous used range. Darkest green starts at zero.
An excluded boundary belongs to the next shade: exactly 50 MB is light red in both memory columns.
The final row gives the lower boundary for darkest red.
Fractions are exact thresholds. Decimal approximations are for reference only.

| Shade | `init ms` | `update ms` / `resize ms` / `hover10 ms` | `peak MB` | `retained MB` |
| --- | ---: | ---: | ---: | ---: |
| Darkest green | `F ≈ 16.67` | `F ≈ 16.67` | 20 | 20 |
| Medium green (yellow-green) | 25 | 25 | 27.5 | 27.5 |
| Light green (pale lime) | `2F ≈ 33.33` | `2F ≈ 33.33` | 35 | 35 |
| Light orange | 50 | 50 | 40 | 40 |
| Medium orange | 75 | 75 | 45 | 45 |
| Strong orange | `<100` | 100 | `<50` | `<50` |
| Light red | 500 | 500 | 100 | 100 |
| Strong red | 1000 | 1000 | 200 | 200 |
| Deep red | 2000 | 2000 | 400 | 400 |
| Darkest red | `>2000` | `>2000` | `>400` | `>400` |

Memory colors apply in combined and memory-only tables.
Peak and retained memory use the same ranges and shades, so equal values have equal colors.
Both columns use darkest green through 20 MB, then lighter greens through 35 MB.
The orange range has three equal-width bands.
Negative baseline-adjusted estimates and unavailable values remain uncolored.
Color changes do not change measurements or aggregation: trace timings use arithmetic means, while memory columns use minima.

The `context` column uses categorical colors, not performance ratings:

| Context | Color |
| --- | --- |
| `2d` | Blue |
| `svg` | Orange |
| `webgl` | Yellow |
| `webgl2` | Pink |
| `webgpu` | Purple |

Unknown or unavailable contexts remain uncolored.

The display uses truecolor or distinct 256-color approximations, according to terminal support.
Redirected output, basic-color terminals, `TERM=dumb`, and any `NO_COLOR` value disable colors. JSON remains uncolored.
The frame thresholds are references, not frame-latency claims.
Trace `update ms` sums selected host-thread wall work, not elapsed frame latency.

Terminal dimensions and line wrapping affect cursor erasure, not whether an interactive table is shown.
Explanatory notes do not appear above the table. Measurement warnings appear below it without a three-warning limit.
Live tables and saved summaries omit warnings for libraries excluded before execution, even with `--verbose`.
The library investigations and suite JSON retain the exclusion reasons. Runtime failures, timeouts, and incomplete measurements still produce warnings.
Interactive output also shows warnings before the first result. Non-interactive output shows warnings in the final summary.
Times use milliseconds.
Thread work is wall duration, not exclusive CPU time or hardware GPU execution time.
Tracked work excludes data preparation and can overlap across threads.
Initialization time and renderer thread work are not additive.
Trace `update ms` remains independent of the initialization and rAF elapsed spans.
It sums per-thread unions of tracked work intervals within each chart window. Overlapping intervals on one thread count once.
Async waits do not become tracked work merely because they occur inside initialization.
Memory uses decimal MB: 1 MB = 1,000,000 bytes.

Each measured library sample uses this adjustment:

```text
idle overhead = min(idle retained memory - idle browser blank memory)
adjusted retained = library retained memory - library browser blank memory - idle overhead
adjusted peak = library sampled peak - library browser blank memory - idle overhead
```

The idle control has the same DPR, measurement mode, memory boundary, and requested backend as the library.
The suite rejects worker reports with a different requested backend.
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

Process polling requests a 50 ms delay after each completed read, plus endpoints for preparation, small initialization, and data update.
Memory collection ends with the post-update forced-GC `live` snapshot, before resize or hover.
Process polling runs independently of renderer evaluation, but reads are not atomic.
Process identity checks reject detected exits, PID reuse, and unavailable fields.
Processes that exist entirely between scans can escape detection.
Restricted `/proc` access can also hide processes or prevent measurements.

Peaks are sampled lower bounds for this measurement protocol, not exact peaks of an uninterrupted run.
Warmup can leave allocator pages resident, and shared-page accounting can change without a local allocation.
Adjusted statistics hold the chosen blank and idle baselines fixed.
Their ranges do not include baseline uncertainty or establish exclusive library ownership.
Legacy cleanup observations remain historical. Cleanup growth alone is not proof of a leak.

Tracked totals cover selected renderer-main, compositor, raster, GPU-process, and background-GC scopes, not all host threads or uninstrumented work.
They omit general worker CPU and renderer/GPU I/O threads. Billboard therefore disables its worker path.
WebGL completion checks do not cover WebGPU. ChartGPU uses separate device-queue completion checks, which establish neither complete trace coverage nor hardware execution time.
Perspective needs a fair analytics workload and worker accounting before comparison with these chart adapters.

Google Charts added no observed WebGL context. Its historical validation establishes no hardware-GPU measurement claim.
Browser-tree PSS includes CPU-resident mappings in the GPU helper process.
It does not measure GPU-specific allocations or complete device memory.
The benchmark uses no heap snapshots, canvas readbacks, or screenshots. Separate diagnostic probes do not change this measurement protocol.
rAF latency does not prove GPU completion or presentation.
WebGL completion evidence also does not prove presentation, hardware acceleration, or full coverage of worker-owned contexts.
Results with completion checks include overhead absent from older unfenced runs. They are not directly equivalent measurement protocols.

## Saved results

Reports and compressed traces are in `.cache/benchmarks/`.
With Chrome's default backend, each mode has its own suite report:

- `results-chrome-combined.json`
- `results-chrome-trace.json`
- `results-chrome-memory.json`
- `results-chrome-raf.json`

Per-variant reports use `results-chrome-MODE-VARIANT.json`.
Traces use `trace-chrome-MODE-VARIANT.json.gz`.
With Vulkan (automatic or explicit), suite reports use `results-chrome-MODE-vulkan.json`.
Variant reports and traces use `results-chrome-MODE-vulkan-VARIANT.json` and `trace-chrome-MODE-vulkan-VARIANT.json.gz`.
Each run replaces only its selected backend's output files. Reports record `requestedBackend: 'default'` or `'vulkan'`.
This field describes the request. Chrome system information records the observed configuration.
Suite reports retain raw per-variant reports, adjusted statistics, progress, and completion status.

Chrome supplies `streamCompression: 'gzip'`, and capture writes directly to the archive without a raw intermediate file.
The JSON analyzer streams the trace instead of loading the complete document into memory.
The archive retains the full trace, and trace validation and `dataLoss` checks remain intact.
`trace.bytes` now measures saved gzip bytes and equals `trace.compressedBytes`. It no longer represents uncompressed JSON size.

The first Recharts trace attempt exhausted disk space after about 225 MiB of raw output. The incomplete trace was removed.
Compression solved disk exhaustion, but the next attempt still reported `dataLoss` with the 128 MiB trace buffer.

Before the calendar-axis correction, a diagnostic single-sample trace contained 55,504,254 bytes and 254,491 events.
`InvalidateLayout` and `ScheduleStyleRecalculation` accounted for 98.35% of those events.
The probe counted 126,146 text-measurement `getBoundingClientRect()` calls, about 63,000 distinct strings, and a 2,000-entry cache. No React profiler was active.
These are pre-fix diagnostics, not measurements of the corrected adapter. The final combined worker passed without `dataLoss`.

A 690 MiB synthetic trace test used 189 MiB peak RSS with a 512 MiB Node heap limit.
That test validates trace handling separately from the final Recharts worker.

To summarize the saved combined report without starting Chrome, use:

```sh
npm run bench -- --summarize-only
```

To include `main ms` and `gpu ms` in the saved summary, use:

```sh
npm run bench -- --summarize-only --verbose
```

Without `--verbose`, saved summaries hide these two columns, just like live tables. Both forms retain all metrics in JSON.

Summary-only mode selects the default-suite backend: Vulkan on Linux and Chrome's default elsewhere.
It does not fall back to another backend's report when the selected report is missing.

For an older default-backend report on Linux, use:

```sh
npm run bench -- --summarize-only --no-vulkan
```

`--summarize-only --vulkan` explicitly selects the saved Vulkan report on any platform.

Saved tables use the same aggregation as live tables: arithmetic means for trace timings and minima for rAF timings and memory.
Summary-only mode recomputes trace statistics from saved analyzed phase samples, without another browser run or trace read.
It preserves each sample's existing work-accounting policy. It cannot recover GC that the original capture omitted.
Legacy memory reports retain their original boundaries. Summaries reject mixed memory boundaries rather than relabel historical observations as `through-update-v1`.
Reports without phase samples or stored means show unavailable trace means, rather than substitute historical minima.
The same option applies to each separate command and selects its matching saved report.
It uses the saved DPR and rejects `--dpr`, `--variant`, `--worker`, and `--install-only`.
The internal `--worker` option captures one variant for the suite runner.
