# Benchmark adapter constraints

The [benchmark guide](../../scripts/benchmarks.md) defines commands, dependency pins, lifecycle operations, measurement boundaries, and report fields.
The [dependency manifest](../../bench/demo-dependencies.mjs) defines execution order, metadata, and benchmark restrictions.
This document describes adapter constraints and the reasons for specific implementation choices.

The single-chart adapters use automatic percentage and MB axes and retain the full input.
Input retention does not guarantee full processed output, identical interaction features, or visual fidelity.
The [dashboard guide](../../bench/dashboard/README.md) describes its separate workload and graphics-resource limits.

## Renderer alternatives

Renderer wrappers share preparation, automatic axes, and cleanup through their base adapters.
D3, Plotly, Highcharts, Bokeh, and d3fc renderer pairs load identical vendor bundles.
The Highcharts SVG variant loads Boost but disables it through the public API.

Highcharts Boost changes data processing and interaction features as well as the drawing backend.
Plotly SVG and WebGL also use different algorithms and feature sets.
These pairs compare complete supported modes, not an isolated GPU-versus-CPU drawing operation.
Canvas and SVG can cause GPU rasterization and compositing. Non-WebGL does not mean zero GPU-process work.

### D3 and deck.gl

[`bench/d3.mjs`](../../bench/d3.mjs) shares scales, calendar ticks, pixel rounding, and pointer/legend behavior between Canvas and SVG.
The full-data SVG variant builds three paths without point objects or sampling.
The min/max variants use a shared reducer. Path construction belongs to chart work, not preparation.
Cleanup removes listeners and cancels pending cursor frames.

[`bench/deckgl.mjs`](../../bench/deckgl.mjs) composes deck.gl lines with D3 scales, SVG axes, a grid, a legend, and a cursor.
It is not a complete chart API from deck.gl.
Preparation creates Float64 columns without coordinate scaling.
Chart construction and updates scale coordinates in double precision before native `PathLayer` processing.
These costs remain inside chart work.

The adapter requires WebGL2 and exposes its owned context through `getWebGLContexts()`.
It does not select another backend on failure.
Cleanup removes listeners, finalizes deck.gl, releases the context, and removes the chart element.

### ChartGPU

[`bench/chartgpu.mjs`](../../bench/chartgpu.mjs) uses full typed columns, native automatic axes, disabled sampling, and strict LOD.
Time ticks use epoch-aligned duration steps rather than calendar-month boundaries.
Each chart creates its own WebGPU device. Retained updates reuse that device.
Initialization awaits the first frame submission and `queue.onSubmittedWorkDone()` before automatic rendering starts.
Cleanup disposes the chart and destroys its device.

Hardware WebGPU support is required. Vulkan selection cannot supply missing GPU access or driver support.
Queue completion covers submitted commands, not compositor presentation or complete trace coverage of GPU-related host work.
The [ChartGPU guide](../../scripts/benchmarks.md#chartgpu-demo-and-default-suite-benchmark) describes invocation and backend selection.

### ECharts GL

ECharts GL is not a renderer switch for ordinary `line` series.
The published `echarts-gl@2.1.0` package supports ECharts `^5.1.2 || ^6.0.0`.
It exports `linesGL`, `scatterGL`, and 3D chart types, but no ordinary `lineGL` series.

`linesGL` supports Cartesian coordinates, polylines, and axis indices.
Its series stores path coordinates separately from its one-dimensional `value` list.
That list does not expose the path coordinates as x/y dimensions for automatic axis ranges.
A replacement for the benchmark's ordinary line adapter needs automatic ranges without hardcoded bounds, invisible helper series, or manual domain calculations.

References: [package metadata](https://cdn.jsdelivr.net/npm/echarts-gl@2.1.0/package.json), [chart exports](https://cdn.jsdelivr.net/npm/echarts-gl@2.1.0/lib/export/charts.js), and [LinesGLSeries](https://cdn.jsdelivr.net/npm/echarts-gl@2.1.0/lib/chart/linesGL/LinesGLSeries.js).

## Reduction and accuracy limits

The [sampled configurations](../../scripts/benchmarks.md#sampled-variants) use native reducers with full input.
Sampling labels describe configuration, not an accuracy guarantee or a measured output count.
Min/max preserves bucket extrema, not every oscillation, endpoint, gap boundary, timestamp, or rasterized pixel.
Average aggregation can attenuate or remove peaks. LTTB can omit one of two opposite extrema in a bucket.

### ApexCharts

The base adapter disables `chart.dataReducer`. The sampled adapter enables scalar-line LTTB.
ApexCharts 8.4.1 calls `Data.lttbDownsample()` directly for scalar-y lines and supplies no `name: 'minmax'` selection.
Range and OHLC inputs use different aggregators, but those data shapes change the workload.
No width-derived LTTB target guarantees preservation of opposite extrema.

References: [Data.js](https://github.com/apexcharts/apexcharts.js/blob/v8.4.1/src/modules/Data.js) and [type declarations](https://github.com/apexcharts/apexcharts.js/blob/v8.4.1/types/apexcharts.d.ts).

### Grouping

The amCharts base disables date grouping and distance-based line simplification and uses original timestamps.
The DevExtreme base disables series aggregation.
The AnyChart base disables main and scroller grouping, so its average mapping remains inactive.

The FusionTime base permits only one-minute bins and retains average aggregation.
The minute-aligned benchmark fixture has one observation per bin, so the average does not combine observations.
Multiple observations within a minute can merge and hide peaks. This configuration does not preserve arbitrary sub-minute data.
Its sampled variant uses default calendar bins.

Native reduction can also change automatic ranges without removing raw input.
The adapters do not force ranges to conceal native behavior.

## Adapter implementation constraints

### Bokeh

Sources: [`bokeh.mjs`](../../bench/bokeh.mjs) and [`bokeh-canvas.mjs`](../../bench/bokeh-canvas.mjs).

- The loader supplies the core, GL, and plotting API bundles in that order.
- `ColumnDataSource` receives four Float64 columns with millisecond timestamps.
- Separate `DataRange1d` objects restrict their renderer lists to the correct series. Another named range can otherwise affect automatic bounds.
- `lod_threshold: null` disables interaction sampling.
- The WebGL adapter requires native WebGL lines. It rejects Canvas fallback.
- The Canvas variant loads the same bundles but creates no WebGL contexts.
- `Plotting.show()` resolves after document idle. This signal is not a GPU fence.
- `getWebGLContexts()` exposes the shared context.
- Cleanup removes the document and views but preserves the shared WebGL context.

Renderer checks, context access, and cleanup use internal view fields. These fields require review after a Bokeh version change.

### d3fc

Sources: [`d3fc.mjs`](../../bench/d3fc.mjs) and [`d3fc-canvas.mjs`](../../bench/d3fc-canvas.mjs).

Both modes use full Float64 columns, automatic scales, SVG axes, and an SVG cursor.
They use one-physical-pixel lines and no custom sampling.
The Canvas variant uses native `seriesCanvasLine` and returns no WebGL contexts.

The WebGL variant requires WebGL1 and `ANGLE_instanced_arrays`. It does not substitute Canvas.
The public `scaleMapper` projects timestamps in double precision before upload, which avoids Float32 timestamp precision loss.
Each y scale derives its domain from the corresponding full input columns.
The adapter submits its initial draw synchronously and calls `gl.flush()`. A flush alone does not establish GPU completion.

The adapter does not use the d3fc-element redraw queue.
Its SVG overlay supplies hover values, not a complete chart interaction system.
Cleanup removes handlers and releases the owned context through `WEBGL_lose_context` where available.

### AG Charts Community and Vega

Sources: [`agcharts.mjs`](../../bench/agcharts.mjs) and [`vega.mjs`](../../bench/vega.mjs).

AG Charts uses the Community bundle, including native line aggregation, without Enterprise modules.
All series share wide records. Keyed axes associate CPU/RAM with the percentage axis and TCP Out with the MB axis.
Native aggregation can change visible detail without reducing prepared input.
Initialization awaits `chart.waitForUpdate()`. Cleanup calls `chart.destroy()`.

Vega uses one wide dataset for three Canvas line marks, without a fold transform or sampling.
Vega adds tuple identifiers, so the adapter copies prepared rows before ingestion inside chart work.
Specification construction, parsing, ingestion, domain calculation, layout, and drawing belong to chart initialization.
Initialization awaits `view.runAsync()`. A custom logger converts dataflow errors into rejected initialization.
Cleanup calls `view.finalize()` and removes remaining DOM content.
Vega-Lite compilation is not part of this adapter.

### SciChart

Source: [`scichart.mjs`](../../bench/scichart.mjs).

- Four Float64 columns retain the full input. `DateTimeNumericAxis` uses Unix seconds.
- The adapter selects 32-bit WASM, automatic SIMD selection, and native text rendering.
- `createSingle()` gives each chart its own WASM context. Construction starts suspended until all series exist.
- `XyDataSeries` declares sorted, evenly spaced data without NaNs. These declarations describe the benchmark fixture, not arbitrary input.
- `appendRange()` copies columns into native storage inside chart work, not preparation.
- `FastLineRenderableSeries` uses `EResamplingMode.Auto`. Resampling changes drawing, not stored input.
- Initialization awaits `renderInstructionsCompleted` without invalidation or animation.
- Cleanup calls `delete()` to release the surface, series, native data, and owned WASM context.

`SCICHART_LICENSE` supplies an optional runtime key. Without it, the adapter calls `UseCommunityLicense()`.
Vendor technical checks and branding remain intact.
The adapter checks the license state before ingestion and after rendering. A visible canvas alone does not establish valid startup.

#### SciChart reduction accuracy

The manifest classifies SciChart `Auto` as `minmax` with `lossy: false` under the benchmark's bucket-extrema exemption.
This classification does not assert that `Auto` always selects `MinMax` or that the output preserves every feature.
Pinned JavaScript forwards `Auto` into WASM. Equal outputs do not identify every possible native selection branch.

The [native-output diagnostic](../../test/integration/scichart-reduction-browser.mjs) compares `Auto`, explicit `MinMax`, and `None`.
It covers the full fixture, opposite and adjacent spikes, nonuniform spacing, isolated peaks, plateaus, missing intervals, and endpoint spikes.
Its cases use multiple widths and DPRs. Sparse and missing-value cases use matching distribution and NaN declarations.

The diagnostic copies `getCurrentRenderPassData().pointSeries` X/Y/index vectors after settled rendering, before another render or disposal.
These vectors are renderer inputs, not screenshot pixels or the original stored data.
Drawing-provider ranges limit unresampled vectors. Borrowed WASM vectors must not be deleted by the diagnostic.
Output counts, extrema, spike locations, gap runs, and endpoint coverage describe different aspects of reduction.
Adjacent-bucket tolerance permits bucket-boundary differences. It does not establish pixel identity or visible gap preservation.

### LightningChart

Source: [`lightningchart.mjs`](../../bench/lightningchart.mjs).

The progressive schema uses Float64 storage, no automatic sorting, and native zoom-dependent grouping.
Series capacity retains the full input. Grouping does not replace stored samples.
Initialization awaits `renderframe` without pending asynchronous rendering.
Cleanup disposes the owner, not only the chart, to release the shared engine.

`LIGHTNINGCHART_LICENSE` is required. `LIGHTNINGCHART_LICENSE_INFORMATION` supplies optional vendor-required metadata.
There is no automatic Community fallback.
The `lossy` classification remains unknown because final-bucket preservation needs licensed runtime confirmation or vendor clarification.
The public `readBack()` API returns stored input, not grouped output. Input retention cannot resolve this question.

### Billboard and G2

Sources: [`billboard.mjs`](../../bench/billboard.mjs), [`g2.mjs`](../../bench/g2.mjs), and [`g2-webgl.mjs`](../../bench/g2-webgl.mjs).

Billboard receives named columns and uses Canvas. Its packaged bundle includes D3.
`boost.useWorker: false` keeps rendering out of workers because the trace totals omit general worker CPU.
Billboard awaits `onrendered`. G2 awaits `chart.render()`.

G2 receives wide rows. Explicit scale keys share CPU/RAM domains without merging TCP into that scale.
Both renderer modes set `style.fill: 'none'`.
An empty fill still triggers transparent polygon triangulation in the pinned WebGL renderer.
The explicit `none` avoids that work without changing line input.

G2 WebGL loads `G2`, `G`, then `G.WebGL` from the pinned production UMD bundles.
It requires an active renderer-owned context and three native GPU line paths. It rejects Canvas fallback and creates no probe context.
`getWebGLContexts()` exposes the renderer context for completion checks.
Internal path checks require review after a version change.
The manifest excludes G2 WebGL from benchmarks because of full-data timeouts. Its standalone demo remains available.

### Syncfusion, DevExtreme, JSCharting, and Kendo

Sources: [`syncfusion.mjs`](../../bench/syncfusion.mjs), [`devextreme.mjs`](../../bench/devextreme.mjs), [`jscharting.mjs`](../../bench/jscharting.mjs), and [`kendo.mjs`](../../bench/kendo.mjs).

- Syncfusion and DevExtreme receive wide rows with Date values. Kendo receives Date-valued XY pairs. JSCharting receives numeric XY pairs.
- Syncfusion uses Canvas and native pixel-tolerance reduction. Initialization awaits `loaded`.
- DevExtreme uses `synchronizeMultiAxes: false` for independent axes. It awaits `onDone` and rejects error incidents.
- JSCharting uses ordinary lines without an adapter decimator. Initialization awaits its chart-ready callback.
- Kendo uses Canvas `scatterLine`, not a date-category chart, to preserve calendar spacing.
- Kendo completes its initial Canvas draw synchronously before the `render` event that the adapter awaits.
- Syncfusion and Kendo remove DOM content that native cleanup leaves behind.

JSCharting 3.4.0 retains destroyed charts through a global validate queue, window pointer listeners, and anonymous print listeners.
The adapter retains native cleanup rather than private vendor patches.
The manifest excludes repeated samples. The [standalone demo](../../bench/JSCharting.html) remains available.

### AnyChart, FusionTime, and Google Charts

Sources: [`anychart.mjs`](../../bench/anychart.mjs), [`fusiontime.mjs`](../../bench/fusiontime.mjs), and [`googlecharts.mjs`](../../bench/googlecharts.mjs).

AnyChart uses AnyStock with `xScale('scatter')`, not ordinal spacing that collapses calendar gaps.
Both base and sampled variants disable the visible scroller and use independent linear y scales.
The adapter awaits `chartDraw`. Cleanup disposes the chart, table, mappings, and scales.

FusionTime DataStore appends row identifiers, so chart work copies prepared rows before ingestion.
`multiCanvas: false` puts both y axes in one plot.
The adapter awaits `renderComplete`. Cleanup disposes the chart and DataStore.

Google Charts prepares Date-valued rows. DataTable construction, ingestion, layout, and drawing belong to chart initialization.
Classic `LineChart` assigns CPU/RAM to axis 0 and TCP Out to axis 1.
Initialization awaits `ready` and rejects chart errors. Cleanup removes listeners and calls `clearChart()`.
The manifest excludes Google Charts from benchmarks because of timeouts. Its standalone demo remains available.

`prepareRuntime()` loads frozen version `52` and remote `corechart` code before chart timers start.
The loader is mutable, and Google can apply critical fixes to frozen releases.
Cached loader bytes do not make remote packages offline or immutable. Network access remains necessary.

### React adapters

Sources: [`recharts.mjs`](../../bench/recharts.mjs), [`muicharts.mjs`](../../bench/muicharts.mjs), [`financialcharts.mjs`](../../bench/financialcharts.mjs), and [`visx.mjs`](../../bench/visx.mjs).

All four adapters prepare fresh wide rows with numeric millisecond timestamps.
Recharts and MUI use independent y axes and continuous time scales.
Recharts supplies calendar ticks from `d3-scale` through public `XAxis.ticks` inside chart construction.
The pinned Recharts implementation computes automatic `niceTicks` only for linear scales.
Explicit calendar ticks do not reduce input rows or override data-derived bounds.

Financial Charts uses continuous `scaleTime()`, not its discontinuous financial time provider.
`plotFull: true` prevents density-based input trimming.
Two native Chart contexts share the same origin and x scale, with y extents from their corresponding full input series.

visx composes SVG lines, axes, grid, title, and legend. It is not a complete built-in interaction system.
Domain scans, component construction, React root creation, and `flushSync` commits belong to chart initialization.
Recharts, MUI, and visx await complete line paths. Financial Charts checks its committed Canvas chart and full `plotData` length.
Cleanup unmounts the root and removes its host.

## Dependency delivery

[`framework-runtime.mjs`](../../bench/framework-runtime.mjs) defines exact production ESM and peer pins.
[`scripts/bench-module-bundle.mjs`](../../scripts/bench-module-bundle.mjs) bundles each variant's dependencies together before browser startup.
Separate dependency bundles can duplicate React and break shared hooks or context identity.
Module loading does not mount a hidden React root or move chart construction outside initialization.
Version pins alone do not guarantee immutable CDN output.

[`bench/demo-runtime.mjs`](../../bench/demo-runtime.mjs) downloads WASM bytes before chart timers start.
SciChart receives both SIMD and non-SIMD assets.
Stable Blob URLs and buffer identities permit normal browser and vendor cache reuse.
Chart teardown does not revoke URLs that later samples need.
Compilation, instantiation, and native ingestion belong to chart initialization, subject to normal cache reuse.
Warmup does not establish a cold compiler measurement. The benchmark does not force recompilation through artificial cache busting.

## Visual reduction demo

[`demos/reduction-accuracy.html`](../../demos/reduction-accuracy.html) compares uPlot with another library, one pair at a time.
Both charts receive the same input and use native reducers.
The cases include opposite spikes, nonuniform spacing, adjacent peaks, an isolated peak, a short plateau, and a missing interval.
Fixed dimensions and axis bounds aid comparison, but native plot areas can differ.

Date-based libraries receive integer millisecond timestamps.
Fractional milliseconds can cause the FusionTime `%Q` parser to substitute epoch zero.
The demo does not override reduction budgets, thresholds, group counts, or grouping intervals.
Its FusionTime configuration uses default bins, not the benchmark base's one-minute restriction.
The demo does not validate benchmark timings or explicit sampling budgets.

Readouts use processed output where available. FusionTime reports its bin instead of substituting input counts for processed output.
uPlot detail magnifies its cached path, including pixel rounding and gap clipping.
Other detail views draw processed polylines before further renderer simplification or rounding.
Neither view changes the viewport or runs another sampling pass.
Pixel-column extrema preservation does not guarantee gap boundaries, precise timestamps, pulse shape, or every signal statistic.

## Vendor requirements

The [license guide](../../scripts/benchmarks.md#license-and-availability-limits) describes runtime-key configuration and vendor restrictions.
Vendor technical checks, evaluation notices, and branding remain intact.
Successful rendering does not establish publication permission or license compliance for every use.
Vendor validation can require network access even with cached dependencies.
License keys belong in a local environment or secret manager, not source files, manifests, or reports.

## Upstream references

- [Bokeh WebGL acceleration](https://docs.bokeh.org/en/latest/docs/user_guide/output/webgl.html): glyph support and Canvas fallback.
- [d3fc series API](https://github.com/d3fc/d3fc/tree/master/packages/d3fc-series): renderer choices and `scaleMapper`.
- [AG Charts secondary axes](https://www.ag-grid.com/charts/javascript/axes-secondary/): keyed axes and series association.
- [Vega View API](https://vega.github.io/vega/docs/api/view/): readiness and cleanup.
- [Highcharts Boost](https://www.highcharts.com/docs/advanced-chart-features/boost-module) and [Plotly WebGL/SVG](https://plotly.com/javascript/webgl-vs-svg/): renderer limits.
- [Syncfusion Chart API](https://ej2.syncfusion.com/javascript/documentation/api/chart/).
- [DevExtreme dxChart API](https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxChart/).
- [JSCharting declarations](https://cdn.jsdelivr.net/npm/jscharting@3.4.0/dist/jscharting.d.ts).
- [Kendo Chart API](https://www.telerik.com/kendo-jquery-ui/documentation/api/javascript/dataviz/ui/chart).
- [AnyStock scales](https://docs.anychart.com/Stock_Charts/Scales) and [grouping](https://docs.anychart.com/Stock_Charts/Data_Grouping).
- [FusionTime axes](https://www.fusioncharts.com/dev/fusiontime/fusiontime-component/y-axis-in-fusiontime) and [data-engine methods](https://www.fusioncharts.com/dev/fusiontime/fusiontime-data-engine/fusiontime-methods).
- [Google Charts loading](https://developers.google.com/chart/interactive/docs/basic_load_libs) and [LineChart](https://developers.google.com/chart/interactive/docs/gallery/linechart).
- [LightningChart licenses](https://lightningchart.com/js-charts/docs/licenses/).
