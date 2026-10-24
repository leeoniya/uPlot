# Benchmark update reference audit

## Subsequent protocol change

This audit describes the former four-phase lifecycle benchmark.
The suite now initializes with two points per series and updates once with the original full dataset.
Separate preparation calls produce distinct small and full inputs, without synthetic value changes or a full-fixture copy.
The reference findings remain relevant to future full-to-full update experiments.
The [current protocol](../../scripts/benchmarks.md#lifecycle-phases) documents the small-to-full workload and its allocation costs.

## Scope and conclusion

This static audit examines the retained-chart update APIs in the current benchmark adapters and their cached vendor implementations.
It covers the 31 default library families, including their sampled and renderer variants. Optional LightningChart appears separately.
No benchmark behavior changed. No browsers, downloads, or benchmarks ran for this audit.

**Some adapters can reuse prepared arrays without an input-reference shortcut. A blanket removal of fresh inputs is not safe.**

Three separate questions matter:

1. Does the library skip ingestion when an input reference stays unchanged?
2. Does the library skip work when input values stay unchanged, even with new references?
3. Does the library retain or modify caller-owned data?

An unconditional ingestion path answers the first question only. It does not establish mutation safety or identical downstream rendering work.

## Current allocations

`bench/lifecycle-data.mjs::freshLifecycleData` copies the packed fixture with `packed.slice()` and changes timestamps and Y values.
Then `prepData` creates the representation that each adapter needs.
`assertFreshLifecycleInput` rejects reused nested objects and typed-array buffers.

There is no extra deep copy after `prepData`. Fixture generation and freshness validation occur outside chart timing. Preparation has its own measurement.

Two different reductions are possible:

- Reuse a packed scratch buffer, while each `prepData` call still produces fresh prepared data.
- Reuse prepared arrays or buffers, after adapter-specific validation and a change to the freshness contract.

The first reduction preserves fresh library inputs. It is the lower-risk starting point, subject to validation that preparation retains no scratch-buffer references.
Neither reduction establishes that unchanged-data submissions represent changed-data updates.

## Reference-sensitive update paths

| Library | Current API | Source finding | Consequence |
| --- | --- | --- | --- |
| Plotly 4.1.2, GL and SVG | `Plotly.react` | The diff skips identical values and identical original `_input_*` arrays. No `layout.datarevision` is supplied. | Fresh trace objects alone do not invalidate reused X/Y columns. |
| Bokeh 3.10.1, GL and Canvas | `data_source.data = input` | `_setv` uses `Comparator.eq`. The comparator accepts identical references and recursively compares contents. | Reused columns can suppress the change signal. Fresh equal-value copies can also suppress it. |
| Recharts, MUI X Charts, React Financial Charts, visx | React state setter inside `flushSync` | The shared adapter uses `useState` and `setData(input)`. React compares state with `Object.is`. | The same outer reference can suppress the component update before the chart library receives it. |
| Syncfusion 35.1.41 | Assign `series.dataSource`, then `dataBind()` | The base `Property` setter records changes only when `this.properties[name] !== value`. | The same data-source reference does not register a data-source change. |

The React adapters use React 19.3.1, except React Financial Charts, which uses React 18.3.1.
A fresh outer array avoids the React state shortcut. It does not prove that every nested reference is safe to reuse.
Readiness checks can observe previous output after a skipped update.

Potential alternatives include Plotly `layout.datarevision` and Bokeh explicit change signals or `setv` with `check_eq: false`.
These alternatives need validation. They change the benchmark update path, not just its allocations.

## Partial and content-based shortcuts

### d3fc 15.2.13

The WebGL adapter explicitly sets `.equals((previous, next) => previous === next)`.
The WebGL line implementation uses this result to decide whether to regenerate the defined mask.
It also refreshes coordinate attributes when the mapped scale reference changes.

The current adapter returns `scale.copy()` from its custom `scaleMapper` on every draw.
Thus, reused input skips defined-mask regeneration, but the new mapped scales still trigger X/Y attribute updates.
This is **not a complete geometry-upload or draw shortcut** in the current adapter.
The Canvas variant draws the supplied arrays without this WebGL equality gate.

### ChartGPU 0.4.0

The native implementation can reuse resolved series, normalization, hashes, and bounds when series or raw-data references match.
However, the adapter creates fresh series objects and fresh `{x, y}` wrappers on every `setOption` call.
Those wrappers prevent these identity shortcuts, even if their underlying buffers stay unchanged.

A separate content hash controls buffer updates in `DataStore.setSeries`.
Equal values can skip GPU buffer writes even with fresh input references.
Changed values therefore matter independently of fresh references.

Reused buffers with fresh wrappers are a candidate for validation, not an established equivalent workload.

### Chart.js 4.6.1

`_dataCheck` has a reference-sensitive branch for array listeners and parsed-state reset.
However, the current minmax plugin processes raw `_data` in `beforeElementsUpdate` and produces a new `_decimated` array on each update.
The current minmax path therefore repeats decimation. The reference check does not establish a decimation shortcut.

This finding applies to the configured benchmark path, not every Chart.js configuration.

### uPlot

`setData` always calls `resetYSeries(true)` and resets scales and drawing for this benchmark.
It also calls `clearDispCache()` only when `rawData !== self.data`.
That cache contains display-facet data and does not serve the simple-line benchmark path.
The adapter also sets `cache.paths: false`.

Reused input is a candidate for this benchmark. This finding does not mean that all uPlot paths ignore input identity.

## Paths that explicitly re-ingest data

The table identifies candidates for prepared-storage reuse.
It does not certify caller-data mutation safety or equivalent rendering work for unchanged values.
Variants share the finding unless a row states otherwise.

| Library | Current update path | Evidence from the selected path |
| --- | --- | --- |
| uPlot | `setData` | Resets series paths and scales. The unused display-facet cache is the exception described above. |
| D3, Canvas and SVG | Retained adapter redraw | Traverses the supplied arrays and regenerates the chart geometry. |
| d3fc Canvas | Retained adapter redraw | Draws the supplied arrays. It does not use the WebGL equality gate. |
| Chart.js 4.6.1 | Assign data, then update | The configured minmax plugin regenerates decimated data on each update. |
| ECharts 6.1.0 | `setOption({dataset: {source: input}}, {lazyUpdate: false})` | Dataset `optionUpdated` calls `SourceManager.dirty()`. This clears source/store lists and forces source reconstruction. |
| Highcharts 13.1.1, Boost and SVG | `setData(input, false, false, false)` | The fourth argument disables point matching. Table ingestion copies columns and changes the table version. |
| AG Charts 14.2.0 | `updateDelta({data: input})` | The explicit data delta constructs a new DataSet. Processed-data cache matching requires the same DataSet object. |
| DevExtreme 26.1.6 | `option('dataSource', input)` | Its equality helper treats non-DOM objects as unequal, even with identical references. The data-source path disposes and rebuilds the source. |
| SciChart 6.0.14 | Suspend, `clear`, `appendRange`, resume | Clears the retained native series and explicitly appends every supplied range. |
| Vega 6.4.0 | Remove all tuples, insert copied rows, `runAsync` | Replaces tuples. The adapter creates fresh row objects to protect caller data from tuple-ID mutation. |
| deck.gl 9.4.0 + D3 | Reproject data, replace layers | The adapter creates new `Float64Array` paths and new data arrays. Stable layer IDs retain layer state, not data identity. |
| Billboard 4.1.3 | `load({columns: input})` | Resets caches, converts all records to new target values, and redraws. The optional `cacheIds` path is unused. |
| ApexCharts 8.4.1 | `updateSeries` | Resets parsing flags and sampled-data caches, then parses all pairs. Fast rendering-path selection occurs after parsing. |
| CanvasJS 3.17.8 | Assign `dataPoints`, then `render` | Reinitializes series and regenerates point event arrays. |
| ZingChart 2.9.16-1 | `setseriesvalues` | Assigns values, then clears, parses, and paints the graph. Plot parsing recreates plots. |
| amCharts 5.21.4 | `series.data.setAll` | Clears old list values and pushes every input. Data events dispose and rebuild data items. |
| AnyChart 9.0.0 | Remove, `addData`, commit | Iterates input rows and copies each array row. Removal flags a full rebuild on commit. |
| FusionTime/FusionCharts 4.2.3 | `deleteRows`, `appendRows`, `setJSONData` | Parses and indexes appended rows, then flushes results. Adapter row copies protect against native `_row_id` mutation. |
| Flot 4.2.6 | `setData`, `setupGrid`, `draw` | Rebuilds wrappers and processes all points. It reuses an output points buffer but overwrites its contents. |
| Dygraphs 2.2.2 | `updateOptions({file: input})` | Numeric parsing can retain the raw array. `predraw` still rebuilds `rolledSeries_` and extracts every Y series. |
| Lightweight Charts 5.2.1 | `setData` per series | Removes previous mappings and maps every input to a new plot row. Time caches and conflation are separate. |
| Kendo UI 2026.3.1015 | Assign series data, then argumentless `redraw()` | Rebuilds the model and plot area. The new plot area gets a new point-binding WeakMap. |
| G2 5.4.8 | `changeData` | Reruns transforms and encodings. The field encoder maps every row, even though inline raw data can retain its reference. |

Optional LightningChart 9.0.0 clears series and calls `appendSamples`.
That API explicitly ingests samples. No licensed runtime validation occurred.

## Copies with a separate purpose

Vega and FusionTime need special care because their ingestion paths modify row objects.
Their adapter copies protect ownership, rather than force reference invalidation.
Removing those copies requires an explicit ownership policy and mutation checks.

deck.gl creates projected paths in the measured adapter operation.
Reusing its prepared input does not remove those allocations or submit identical path references to deck.gl.

Flot illustrates another distinction: reuse of an output allocation does not imply skipped ingestion.
Avoiding allocation and avoiding data processing are separate optimizations.

## Recommended next step

The lowest-risk change is a reusable packed scratch buffer, with fresh `prepData` outputs for all libraries.
This removes one fixture copy per generation without relying on native reference behavior.
It does not remove preparation allocations or the corresponding `prep ms` cost.

Prepared-storage reuse needs a separate experiment for each candidate adapter:

1. Keep chart instances, array lengths, and axis domains unchanged.
2. Change interior values in every series, including peaks, troughs, and validity masks where supported.
3. Submit the same prepared references through the current update API.
4. Validate native values and completed output against a fresh-input control.
5. Inspect ingestion or upload counters where the library exposes them.
6. Validate caller-data mutations and asynchronous retention before the next mutation.
7. Run each library serially before changing its freshness policy.

These checks distinguish a real update from an axis-only redraw or a stale-output readiness signal.
A fresh outer wrapper alone is insufficient for Plotly and Bokeh.
Unchanged values are insufficient for a full-upload workload in ChartGPU.

Until those experiments pass, fresh prepared inputs with changed values remain the consistent suite policy.

## Source anchors and limitations

The audit follows the adapter APIs, not general claims about library behavior.
Vendor sources came from `.cache/benchmarks`, as selected by `loadBenchDemoSources(...).dependencies[].cacheName`.
The React state boundary is in `bench/lifecycle-frameworks.mjs`.
The uPlot cache distinction is visible in `src/uPlot.js::setData` and `src/paths/disp.js`.

Useful native source anchors include:

- Plotly: the `datarevision === undefined` immutable flag, the data diff, and `_input_` array comparisons.
- Bokeh: `_setv` and `Comparator.eq`.
- Syncfusion base 35.1.37: the `Property` setter used by chart `series.dataSource`.
- d3fc: WebGL line `Oe`, its equality predicate, and mapped-scale comparisons.
- ChartGPU: `Oi`, `Ai`, `ki`, and the `hash32` comparison in `DataStore.setSeries`.
- Chart.js: `_dataCheck` and the decimation plugin `beforeElementsUpdate`.
- AG Charts: `updateUserDelta`, `userDeltaKeys`, `createDataSet`, and DataSet identity in cache matching.
- DevExtreme: `_setPreparedValue`, `equals`, `_change_DATA_SOURCE`, and `_refreshDataSource`.

Selected SHA-256 fingerprints identify the audited cache contents:

| Artifact | SHA-256 |
| --- | --- |
| `dist/uPlot.iife.min.js` | `329af668720df79337a3d9d8d387ffe9ae0be8f630cc0d75dc045b2ecbc36668` |
| `bokeh-bokehjs-3.10.1-build-js-bokeh.min.js` | `879c5e26951a2dbf564238e2adfc6e3ec5c6f5417085bd923f29934868de0435` |
| `plotly.js-dist-min-4.1.2-plotly.min.js` | `2f645d1bade8182fce161b7f10f89402f8b315805250ff4a94672a28d23c390a` |
| `d3fc-15.2.13-build-d3fc.min.js` | `74794a33a7b32846932e454eea68971c09ce370a5b218c9870a6216f9b01df12` |
| `chart.js-4.6.1-dist-chart.umd.min.js` | `87364cc2b2a76a6684929e7d6b80b18a897794db38400caff1fcf1791c6925d2` |
| `ag-charts-community-14.2.0-dist-umd-ag-charts-community.min.js` | `156ccaa9b67221a0b1739112ba8120629357cfa51654b36eaa2cedc17dc90d69` |
| `devextreme-26.1.6-js-dx.viz.js` | `85ef99e2e072942866b39df0548dd458b97c389d5d871e620063a3cba1d7d52a` |
| `syncfusion-ej2-base-35.1.37-dist-global-ej2-base.min.js` | `257b53d16628beb7b01371bec9530fcb7daa9f5ba0932264946478447872f758` |
| ChartGPU compiled module | `4d2c6eda6fed94fa0a8af72763d9e0a6d29ced42656b4313a4a545a379aca173` |

The ChartGPU module is `.cache/benchmarks/modules/modules-a14f772a6d5fea184035a9357bb2ea3b2ef7d3efd06a1c336b8e79a7fd70fb51.mjs`.
Its metadata pins `chartgpu@0.4.0` and Rolldown 1.2.15.
Minified symbol names are specific to these artifacts.

Static source inspection does not establish timing, raster equivalence, or ownership safety for every adapter.
No runtime result in this report establishes that prepared-storage reuse is ready for the benchmark suite.
