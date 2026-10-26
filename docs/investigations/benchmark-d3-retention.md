# D3 min/max and uPlot memory investigation

This report records the pre-change investigation. The [post-change comparison](benchmark-d3-memory-rerun.md) measures the new number formatter and lazy timezone lookup.

## Conclusion

Two eager `Intl` initializations explain the main retained-memory difference in this benchmark. They initialize native ICU resources before uPlot draws a chart.

The paired experiment added 3.949 MB to a live D3 canvas chart without a redraw or data changes. Live JavaScript heap usage did not increase. This closely matches the reported retained-memory difference of approximately 3.9 MB.

D3 SVG has a separate peak-memory cost from SVG path-string construction. Neither finding indicates that D3 discards its original data.

No production library or benchmark implementation changed during this investigation.

## Source of the retained cost

[`src/utils.js`](../../src/utils.js) initializes a shared number formatter at module load:

```js
const numFormatter = new Intl.NumberFormat();
export const fmtNum = val => numFormatter.format(val);
```

[`src/fmtDate.js`](../../src/fmtDate.js) also resolves the local timezone at module load:

```js
const localTz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
```

Either initialization can activate ICU. Deferral of only the timezone lookup did not remove the overhead. Both eager initializations must be absent to avoid this startup cost in the benchmark.

The benchmark uses custom formatting and does not require these eager operations. The diagnostic lazy number formatter recorded zero format calls.

## Paired experiment: unchanged live chart

Each run used a fresh browser, three warmups, and one live chart. The probe forced garbage collection before each measurement. Between measurements, it ran only:

```js
new Intl.NumberFormat();
new Intl.DateTimeFormat().resolvedOptions().timeZone;
void 0
```

The probe did not retain either formatter. It did not redraw the chart or change its data.

| Existing chart | Process-tree PSS increase | Live JS heap increase |
| --- | ---: | ---: |
| D3 canvas min/max | 3.948544 MB | 0 bytes |
| D3 SVG min/max | 3.987456 MB | 0 bytes |
| uPlot, negative control | 0.040960 MB | 0 bytes |

The uPlot control already initialized ICU before the intervention. An earlier paired D3 canvas run added 3.805 MB, also without additional live JS heap.

Linux memory mappings attributed the latest D3 canvas increase as follows:

| Mapping | Process-tree PSS increase |
| --- | ---: |
| ICU data (`icudtl.dat`) | 2.095104 MB |
| Native allocator (`partition_alloc`) | 1.606656 MB |
| Chrome executable | 0.245760 MB |
| C runtime | 0.001024 MB |

These are resident native allocations and file-backed pages, not extra live data arrays. Garbage collection does not necessarily release these resources.

Renderer PSS increased by 5.675 MB, but process-tree PSS increased by 3.949 MB. Shared-page accounting redistributes PSS across processes. The renderer and tree scopes overlap and are not additive.

## Independent startup controls

The broader diagnostic changed only the served source in memory:

- `uplot:lazyintl` removed the eager timezone lookup and deferred number formatter construction.
- `d3-minmax:numberintl` added an unused `Intl.NumberFormat` construction to D3.

The following run used three warmups and three measured rounds. Values are minima of process-tree PSS above each browser's blank baseline. They do **not** include the benchmark table's idle adjustment.

| Variant | Peak above blank | Live above blank |
| --- | ---: | ---: |
| uPlot | 47.544 MB | 41.814 MB |
| uPlot, both eager initializations absent | 41.217 MB | 37.453 MB |
| D3 canvas min/max | 43.786 MB | 38.212 MB |
| D3 canvas min/max + NumberFormat | 47.879 MB | 41.725 MB |
| D3 SVG min/max | 48.874 MB | 38.278 MB |

The cost moved in both directions with the intervention. The lazy uPlot variant was a diagnostic, not a production-ready timezone implementation.

Separate-browser minima varied between runs. A seven-round repeat showed live differences closer to 2 MB, despite the same ICU residency distinction. The paired experiment provides stronger quantitative evidence because it avoids separate startup baselines.

## Peak memory

ICU initialization adds a fixed cost to both retained and peak memory. The benchmark subtracts blank-browser and idle costs, not a library-loaded baseline.

SVG also constructs `d` attribute strings through `d3.path()`. Canvas emits drawing commands directly. Two SVG controls isolated the string-construction cost:

| Diagnostic control | Minimum peak above blank | Minimum live above blank |
| --- | ---: | ---: |
| Construct strings, skip SVG path assignment | 48.940 MB | 38.680 MB |
| Scan extrema, skip strings and series output | 42.184 MB | 36.474 MB |

String construction kept the high peak even without SVG path assignment. Removal of string construction reduced the sampled peak by 6.756 MB in this run.

This identifies temporary string allocations and associated heap growth as a substantial SVG peak cost. These controls omit series output. They are not equivalent benchmark implementations or proposed optimizations.

## Data, hover, and path caches

The earlier browser probe established the following facts for uPlot and both D3 min/max variants:

- All four original arrays remained live after forced garbage collection. Each array contained 55,550 values.
- Hover at index 12,345 returned values from the original data.
- The arrays became collectible after chart destruction.
- uPlot referenced the original data, with `chart._data === chart.data`.
- uPlot's live series path caches, point path caches, and `_disp` caches were empty.

Thus, `cache.paths: false` worked as expected. D3 did not gain its retained-memory advantage through loss of full-data hover support.

A D3 control that constructed temporary `Path2D` objects did not reproduce the uPlot gap. Font substitutions also failed to explain the gap. Temporary paths remain a possible small allocation cost, but they are not the established cause of the approximately 3.9 MB difference.

## Measurement limits

The benchmark table reports decimal MB of adjusted process-tree PSS. Its memory columns use the minimum across measured sessions, not the arithmetic mean. Peak memory is a sampled process peak, not an exact allocation peak.

The experiment did not replay every condition of the historical screenshot. It establishes the main cause, not an exact accounting of every historical peak byte. Process startup, allocator state, and shared-page residency affect separate-browser comparisons.

Detailed Chrome memory dumps also consume memory. The primary paired measurements and the comparison tables here did not use those dumps.

## Reproduction and evidence

The persistent probe requires Linux, Node with global WebSocket support, cached benchmark vendors, and the pinned Chrome binary. It uses Chrome `156.0.8078.47`, DPR 1, and Vulkan.

From the repository root, run these commands serially:

```sh
node docs/investigations/benchmark-d3-retention-probe.mjs d3-minmax
node docs/investigations/benchmark-d3-retention-probe.mjs d3-svg-minmax
node docs/investigations/benchmark-d3-retention-probe.mjs uplot
```

Each run writes its measurements to `/tmp/uplot-intl-memory-*/results.json`. The probe removes its browser profile after completion. It does not download dependencies or modify benchmark reports.

[Saved results](benchmark-d3-retention-results.json) contain the paired measurements and individual rounds from the startup and SVG controls. Temporary source paths identify the original local evidence. Large traces remain outside the repository.

The broader local harness remains at `.cache/benchmarks/retention-investigation/native-probe.mjs`. The earlier data and hover probe remains in the same directory as `probe.mjs` and `results.json`. These scratch files are not permanent repository artifacts.

Validation: the persistent probe passed its syntax check and completed all three variant runs serially.

## Recommended follow-up

Lazy initialization can avoid this cost when callers do not need the built-in formatters:

1. Construct the shared number formatter on the first `fmtNum()` call.
2. Resolve the local timezone only when `tzDate()` needs an explicit timezone comparison.
3. Preserve formatting and timezone behavior with regression tests.
4. Repeat the memory benchmark after both changes.

This defers the cost rather than removing ICU. Applications that use the formatters will still pay it. Applications that already initialize ICU can see a smaller incremental difference.
