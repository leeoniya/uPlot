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

The default set contains 29 libraries and 34 variants. The idle control is separate.
G2 WebGL and Google Charts are disabled for benchmarks after timeouts. Their standalone demos remain available.
The renderer alternatives are `d3-svg`, `plotly-svg`, `highcharts-svg`, `bokeh-canvas`, `d3fc-canvas`, and `g2-webgl`.
All 13 adapters passed agent-reported direct browser smoke checks. JSCharting remains standalone-only because vendor cleanup leaks across repeated samples.
All 12 then-runnable additions passed integrated combined measurements across a partial suite and separate workers, not one complete suite.
The previous 18-library validation remains historical.
The [candidate review](../docs/investigations/benchmark-library-expansion.md) records decisions, adapter caveats, and validation status.
Each module exports `prepData(packed)` and `makeChart(data, host, wait)`.
The added modules also export `destroyChart(chart)`. The harness uses this optional hook for library-specific cleanup.
`makeChart` returns a chart or a promise that resolves after the library completes initialization.

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
| `d3`, `d3-svg` | `d3` 7.9.0 |
| `echarts` | `echarts` 6.1.0 |
| `flot` | `flot` 4.2.6, `jquery` 3.7.1 |
| `dygraphs` | `dygraphs` 2.2.2 |
| `apexcharts` | `apexcharts` 8.4.1, including `dist/features/renderer-canvas.js` |
| `highcharts`, `highcharts-svg` | `highcharts` 13.1.1, including `modules/boost.js` |
| `lightweight` | `lightweight-charts` 5.2.1 |
| `plotly`, `plotly-svg` | `plotly.js-dist-min` 4.1.2 |
| `canvasjs` | `@canvasjs/charts` 3.17.8 |
| `zingchart` | `zingchart` 2.9.16-1 |
| `amcharts` | GitHub `amcharts/amcharts5-dist` tag 5.21.4, `index.js` and `xy.js` |
| `bokeh`, `bokeh-canvas` | `@bokeh/bokehjs` 3.10.1, core, GL, and plotting API bundles |
| `d3fc`, `d3fc-canvas` | `d3fc` 15.2.13 and `d3` 7.9.0 |
| `agcharts` | `ag-charts-community` 14.2.0, Community UMD bundle |
| `vega` | `vega` 6.4.0, `build/vega.min.js` |
| `scichart` | `scichart` 6.0.14, `index.min.js` and SIMD/non-SIMD WASM assets |
| `lightningchart` | `@lightningchart/lcjs` 9.0.0, `dist/lcjs.iife.es2019.js` |
| `billboard` | `billboard.js` 4.1.3, packaged D3 bundle and CSS |
| `g2` | `@antv/g2` 5.4.8, Canvas bundle |
| `g2-webgl` | `@antv/g2` 5.4.8, `@antv/g-lite` 2.7.2, `@antv/g-webgl` 2.1.3, production UMD bundles in that order |
| `syncfusion` | `@syncfusion/ej2-charts` 35.1.41 and its global dependencies |
| `devextreme` | DevExpress 26.1.6, production `dx.viz.js` |
| `jscharting` | `jscharting` 3.4.0, minified `dist/jscharting.js`, reported build `3.4.0.20230215`. Standalone only. |
| `kendo` | `@progress/kendo-ui` 2026.3.1015, `umd/kendo.dataviz.min.js`, with jQuery |
| `anychart` | `anychart` 9.0.0, core and stock bundles |
| `fusiontime` | `fusioncharts` 4.2.3, core and timeseries bundles |
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
| `d3-svg` | The same aligned columns, scales, ticks, and pixel rounding. Three full-data SVG paths, SVG axes/grid, and an SVG cursor. No sampling or Canvas layer. |
| `chartjs` | Numeric points, `parsing: false`, `normalized: true`, native min/max sampling, and no animation or point markers. |
| `echarts` | One interleaved typed buffer, explicit dimensions, native min/max sampling, and no animation or point markers. |
| `flot` | Native XY pairs and canvas lines, with automatic ranges on two y axes. |
| `dygraphs` | Numeric timestamp rows and `Dygraph.dateTicker`, without per-row Date objects or CSV parsing. |
| `apexcharts` | Native Canvas addon with `dataReducer.enabled: false`. The pinned scalar-line reducer only supports LTTB, so all input values reach rendering. |
| `highcharts` | Boost with typed data columns. `useGPUTranslations: false` avoids Float32 precision loss for epoch-millisecond timestamps. |
| `lightweight` | Native line conflation (`enableConflation: true`), two automatic axes, and a custom legend with visibility controls and attribution. |
| `plotly` | WebGL `scattergl` line traces with typed arrays. |
| `plotly-svg` | SVG `scatter` line traces with the same typed arrays. Native line simplification keeps its default. |
| `highcharts-svg` | SVG lines with the same typed data columns and `boost.enabled: false`. |
| `canvasjs` | Native canvas line chart, without animation or point markers. |
| `zingchart` | Canvas output, fast mode, `sampling-step: 1`, no trackers, no point markers, and no tooltips. |
| `amcharts` | `groupData: false` disables date grouping. `minDistance: 0` disables distance-based line simplification. `exactLocationX: true` uses original timestamps. |
| `bokeh` | WebGL lines, Float64 columns, separate automatic y ranges, and no level-of-detail sampling. Canvas fallback causes an error. |
| `bokeh-canvas` | The same full Float64 columns and automatic axes, with `output_backend: 'canvas'`. No WebGL contexts. |
| `d3fc` | WebGL lines and SVG axes. Public `scaleMapper` projects timestamps in double precision before upload. No sampling. |
| `d3fc-canvas` | Native `seriesCanvasLine`, the same SVG axes and cursor, and full Float64 columns. One-physical-pixel lines, with DPR 1 for validation. No sampling. |
| `agcharts` | Community Canvas lines, native line aggregation, keyed axes, no point markers, and no Enterprise modules. |
| `vega` | Canvas lines from one wide dataset, independent y scales, and no sampling or fold transform. |
| `scichart` | WebGL/WASM lines, Float64 input, native automatic min/max resampling, and full native data retention. |
| `lightningchart` | Progressive Float64 x data, native zoom-dependent grouping, no automatic sorting, and full input retention. |
| `billboard` | Canvas lines, named columns, native `y`/`y2`, no animation or markers, and `boost.useWorker: false`. |
| `g2` | Canvas lines from wide rows, shared percentage-scale keys, a separate TCP scale key, explicit `fill: 'none'`, and no animation. |
| `g2-webgl` | The same G2 configuration with `G.WebGL.Renderer`, three native GPU path checks, and renderer-owned context capture. Full-data validation timed out. |
| `syncfusion` | Canvas lines, Date input, native pixel-tolerance reduction, and no animation or markers. |
| `devextreme` | Continuous datetime axis, `aggregation: {enabled: false}`, and `synchronizeMultiAxes: false`. |
| `jscharting` | Standalone only. Ordinary lines, numeric XY pairs, time axis, independent y axes, and no adapter decimator. |
| `kendo` | Canvas `scatterLine`, Date-valued XY pairs, independent y axes, and no transitions or markers. |
| `anychart` | AnyStock, continuous `scatter` time scale, main and scroller grouping disabled, and independent linear y scales. The average mapping remains configured but inactive. |
| `fusiontime` | Specialized timeseries renderer, only one-minute bins, average aggregation, and `multiCanvas: false` for both axes in one plot. |
| `googlecharts` | Classic `LineChart`, datetime column, native `targetAxisIndex`, and no startup animation or markers. |
| `recharts` | SVG lines, public calendar ticks from `d3-scale`, continuous time scale, independent `yAxisId` values, and no animation or markers. |
| `muicharts` | Community SVG `LineChart`, continuous time scale, independent y axes, and no animation or markers. |
| `financialcharts` | Canvas lines, continuous `scaleTime()`, `plotFull: true`, and two native Chart contexts at the same origin. |
| `visx` | Custom SVG composition with native lines, axes, grid, and independent scales. Domain scans and component construction remain inside initialization. |

ApexCharts 8.4.1 does not support `dataReducer.name: 'minmax'`.
Its scalar-line path calls LTTB directly, regardless of a supplied reducer name.
The demo disables reduction because LTTB can omit one of two opposite extrema in a bucket.
The harness checks that all three parsed series contain 55,550 values after initialization, outside the chart timing window.
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

FusionTime sets `minute: [1]` and empty arrays for `year`, `month`, `day`, `hour`, `second`, and `millisecond` in `xAxis.binning`.
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

The expanded suite did not complete. The default suite runs idle first, then 34 variants for 29 libraries.
Each renderer alternative follows its original in `bench/demo-dependencies.mjs`. The manifest defines this order:

1. uPlot
2. Chart.js
3. ApexCharts
4. ECharts
5. D3 Canvas (`d3`)
6. D3 SVG (`d3-svg`)
7. Flot
8. d3fc WebGL (`d3fc`)
9. d3fc Canvas (`d3fc-canvas`)
10. React Financial Charts (`financialcharts`)
11. AG Charts Community
12. Dygraphs
13. AnyChart (`anychart`)
14. visx (`visx`)
15. Bokeh WebGL (`bokeh`)
16. Bokeh Canvas (`bokeh-canvas`)
17. CanvasJS
18. Plotly WebGL (`plotly`)
19. Plotly SVG (`plotly-svg`)
20. Lightweight Charts
21. MUI X Charts (`muicharts`)
22. FusionTime (`fusiontime`)
23. DevExtreme (`devextreme`)
24. Vega
25. Highcharts Boost (`highcharts`)
26. Highcharts SVG (`highcharts-svg`)
27. SciChart
28. Billboard (`billboard`)
29. AntV G2 Canvas (`g2`)
30. Syncfusion (`syncfusion`)
31. ZingChart
32. amCharts
33. Recharts (`recharts`)
34. Kendo (`kendo`)

LightningChart follows these libraries when `LIGHTNINGCHART_LICENSE` supplies a runtime key.
Without that key, the suite records an explicit skip rather than an empty benchmark row.
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

`benchmarkVariants` in `bench/demo-dependencies.mjs` controls execution order.
`benchmarkRestrictions` excludes G2 WebGL, Google Charts, and JSCharting without disabling their standalone demos.
Explicit benchmark selection also rejects these variants and reports the reason.
`idle` is also selectable. `lightningchart` requires a runtime key, not a harness permission flag.
Default suite reports include the skipped variants and their reasons.

### Current validation status

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
DevExtreme and FusionTime timed out under the unchanged five-second sample budget.
These results do not establish completed measurements for those two current configurations or universal visual fidelity.
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
| ChartGPU | User hold. WebGPU needs different completion checks and device accounting. |
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

## Timing and memory protocol

### Sample timeout

Each warmup and measured sample has a hard five-second budget in trace, memory, combined, and rAF modes.
The budget starts before sample setup and ends after cleanup. It includes preparation, drawing, settling, WebGL completion, and applicable memory checkpoints.
Library downloads, initial page loading, and final trace analysis are outside this budget. They retain separate command and worker limits.

The watchdog runs in Node, outside the renderer. A synchronous JavaScript loop cannot block this watchdog.
On timeout, the worker reports `<library>: timed out after 5s` and exits with code 124.
It kills Chrome and its discovered descendants, closes CDP connections, and skips chart teardown and trace download.
The suite records the timeout, shows `-` in every metric column, and continues with the next library.
Timing tables place timed-out libraries after measured results. Memory-only and rAF tables retain execution order.
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
The five-second budget resets for each sample, not each phase. It is not a five-second limit for all ten samples together.

### Measurement boundaries

Library loading, raw JSON parsing, and fixture setup occur outside the chart timers.
`bench/demo-runtime.mjs` downloads WASM bytes before timing. Stable Blob URLs permit normal compiler-cache reuse across samples.
WASM compilation, instantiation, and native ingestion initially occur inside chart initialization, subject to normal browser and vendor cache reuse.
The benchmark does not force repeated compilation through artificial cache busting.
Each sample times the actual demo preparation function separately from chart initialization.
uPlot uses its own shared preparation function, with timestamps in seconds and the default time scale.
Lightweight Charts and SciChart also use timestamps in seconds.
Syncfusion, DevExtreme, Kendo, and Google Charts prepare Date values.
The other adapters prepare numeric millisecond timestamps. Financial Charts constructs Date values through its x accessor during initialization.
The benchmark does not convert uPlot data to milliseconds or override its chart configuration.
Chart initialization includes configuration construction, chart construction, async library completion, and the initial microtask commit.
If `makeChart` returns a promise, the harness awaits it inside the initialization span, then awaits one microtask.
The `jsMs` field therefore measures elapsed initialization time, including async waits, not exclusive JavaScript CPU time.
Validation occurs outside both timers.

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
`raf1Ms` ends at the first rAF callback requested after initialization completes.
Async initialization can span earlier frames, so this callback is not necessarily the next frame after chart start.
`postJsRaf1Ms` measures only the interval from completed initialization to that callback.
The rAF mode remains uninstrumented by the WebGL observer, completion checks, and context-info queries.

The chart window starts at chart construction and ends after settling and the WebGL completion checks.
It includes deferred rendering but excludes data preparation, forced GC, and teardown.
Settling uses two animation frames and a 200 ms wait. This wait alone is a heuristic, not a completion guarantee.

Trace and memory modes run WebGL completion checks after library readiness and settling, after `js-end` but before the sample `end` marker.
WebGL2 uses async fences: `fenceSync()`, `flush()`, and timer-based `clientWaitSync()` polling with zero timeout.
WebGL1 uses blocking `gl.finish()`. The fence timeout cannot interrupt a blocking GL call, so the browser watchdog remains necessary.
The observer then queries raw renderer/version strings and the optional unmasked renderer string. Unavailable strings remain `null`.
These strings can be masked. They do not prove hardware acceleration.

`scripts/bench-webgl.mjs` observes current-realm `HTMLCanvasElement` and `OffscreenCanvas` context acquisition.
Adapter `getWebGLContexts()` hooks also expose reused contexts that do not call `getContext()` during a sample.
Workers and other realms remain outside this coverage unless they install their own observer.
Completion covers only commands before each fence or finish call, not later draws or compositor presentation.
No observed context is not proof that a library performed no GPU work.

Completion checks occur outside initialization but inside the chart window.
Thread-wall totals include blocking finish waits, fence submission/polling, and context-info queries.
This overhead can change scheduling. Neither these totals nor completion latency measures hardware GPU busy time.

The trace enables only `blink.user_timing` and `disabled-by-default-devtools.timeline`.
These categories supply sample markers, thread tasks, raster tasks, and GPU task events.
The completion protocol does not add arbitrary broad GPU tracing categories.
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
6. Run the WebGL completion checks and context-info queries, then end the chart timing window.
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
`total ms` remains independent of the initialization and rAF elapsed spans.
It sums per-thread unions of tracked work intervals within each chart window. Overlapping intervals on one thread count once.
Async waits do not become tracked work merely because they occur inside initialization.
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

Tracked thread totals do not account for worker CPU. Billboard therefore disables its worker path.
WebGL completion checks do not cover WebGPU. A future ChartGPU adapter needs a separate completion protocol and device-accounting review.
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
Each mode has its own suite report:

- `results-chrome-combined.json`
- `results-chrome-trace.json`
- `results-chrome-memory.json`
- `results-chrome-raf.json`

Per-variant reports use `results-chrome-MODE-VARIANT.json`.
Traces use `trace-chrome-MODE-VARIANT.json.gz`.
Each run replaces its default output files.
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

Saved tables use the same minimum-value aggregation as live tables.
The same option applies to each separate command and selects its matching saved report.
It uses the saved DPR and rejects `--dpr`, `--variant`, `--worker`, and `--install-only`.
The internal `--worker` option captures one variant for the suite runner.
