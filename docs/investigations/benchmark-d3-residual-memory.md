# Residual uPlot–D3 memory difference

## Conclusion

The earlier 0.700–0.774 MB difference is not a reproducible fixed allocation in these additional runs.

A controlled intervention identifies one contributor: first-use Grid-related CSS parsing, style, and layout leave native Chrome executable pages resident. uPlot already uses these browser features. The D3 canvas fixture does not.

This is not an exact attribution of the original difference. The original minimum checkpoints lack detailed memory mappings. Native allocator variation and blank-baseline uncertainty also affect the net difference.

No production code or normal benchmark report changed. These files contain diagnostic controls, not proposed changes to chart behavior.

## Production-protocol reruns

The runner uses `captureBenchmarkTrace()` and `summarizeAdjustedProcessMemory()` without tracing. Each variant uses a fresh browser, three warmups, and seven measured sessions.

All values are decimal MB. Each value is the minimum across measured sessions, after the production blank and idle adjustments.

| Run | uPlot retained | D3 canvas retained | uPlot minus D3 | uPlot peak | D3 canvas peak |
|---|---:|---:|---:|---:|---:|
| A | 9.244 | 8.897 | +0.347 | 12.633 | 14.225 |
| B | 9.828 | 9.337 | +0.492 | 13.413 | 14.871 |
| C | 10.551 | 11.739 | −1.188 | 14.226 | 17.129 |
| D | 10.258 | 8.649 | +1.610 | 13.867 | 14.215 |

Run A uses the normal chart order. Run B reverses that order. Runs C and D include a control without Grid declarations, in opposite orders.

The idle adjustment cancels in each uPlot–D3 difference. Each variant still has its own single blank checkpoint. Separate minima do not form a paired observation.

The retained difference changes sign across runs. The sampled peak remains lower for uPlot in all four runs. These peaks are sampling lower bounds, not exact allocation peaks.

Run A has an invalid blank checkpoint for `uplot:arial`. The analyzer excludes that variant instead of treating missing memory as zero. Its ordinary uPlot and D3 measurements remain valid.

An additional reverse-order attempt failed during the Chrome connection. It produced no usable measurements. Run D is the successful retry.

## Controlled Grid intervention

The probe keeps the chart and its data unchanged. It creates a tiny temporary element outside the viewport, forces layout, and removes the element.

The sequence has these controls:

1. No operation.
2. A plain block and three empty children.
3. The same block with Grid declarations and child area names.
4. The same element with `display:grid`.
5. A repeat of the Grid operation.
6. No operation.

Each checkpoint follows two animation frames, a 200 ms delay, and forced garbage collection. Measurements include process PSS, live JS heap, and mapping PSS by process role.

The following differences use the plain-block checkpoint as the baseline. These final runs record the hash of the current probe source.

| Variant | Executable PSS after Grid declarations | Executable PSS after Grid layout | Final tree PSS difference | Live JS heap difference |
|---|---:|---:|---:|---:|
| D3, first run | +0.309 MB | +0.375 MB | +0.434 MB | 0 bytes |
| uPlot control | +0.059 MB | +0.059 MB | +0.086 MB | 0 bytes |
| D3, second run | +0.262 MB | +0.393 MB | +0.553 MB | 0 bytes |

The executable column is renderer PSS for the Chrome binary's `r-xp` mappings. It is not additional JS code or retained chart data.

Earlier repetitions produced +0.328 and +0.512 MB of executable PSS on D3. The corresponding uPlot control produced approximately zero. The repeated Grid operation did not increase executable residency in the final runs.

Most executable growth occurs with Grid declarations on the block, before actual Grid layout. Thus, this result concerns Grid-related CSS parsing and style code as well as layout code.

The temporary elements do not remain in the document. Nevertheless, the native executable pages remain resident. Chart destruction and JS garbage collection do not require Chrome to discard these pages.

PSS does not measure exact code size. Shared-page accounting, page fault-around, and non-atomic reads affect the result. These measurements identify a browser-feature contribution, not exclusive library ownership.

## Jointly warmed browser control

A separate probe loads both libraries into one page. It alternates chart construction and destruction, with only one live chart at a time.

Each run includes three warmup rounds and seven measured rounds per variant. The order alternates each round. The reverse run changes the initial order.

| Run | Mean live PSS difference | Median live PSS difference | Mean live JS heap difference |
|---|---:|---:|---:|
| Initial order A | −0.019 MB | −0.041 MB | +28,666 bytes |
| Initial order B | −0.132 MB | −0.123 MB | +26,500 bytes |
| Final order A | +0.215 MB | −0.066 MB | +27,767 bytes |
| Final order B | −0.181 MB | −0.094 MB | +26,547 bytes |

Differences are uPlot minus D3. Final order A contains a +1.995 MB paired observation, which raises its mean. The evidence retains that observation.

These results show no consistent +0.7 MB live-PSS difference in the jointly warmed fixture. They do not establish equal isolated footprints or absence of leaks.

Both libraries can reuse resident native code, fonts, and allocator capacity in this control. Seven rounds within one browser are not seven independent browser replications.

## Fresh-process mapping evidence

Two isolated mapping comparisons used normal charts and identical data. At the minimum tree-PSS sample, the renderer mapping contrasts were:

| Mapping category | Pair 1 | Pair 2 |
|---|---:|---:|
| Chrome binary, live minus blank | +0.839 MB | +0.990 MB |
| Font files, live minus blank | −0.282 MB | −0.282 MB |
| V8 sandbox, live minus blank | −0.258 MB | −0.283 MB |

The table shows uPlot minus D3. It identifies a native binary-residency difference, with offsets in other categories.

Anonymous mappings varied substantially between runs. For example, the renderer's `[anon:v8]` contrast changed from +1.430 MB to −1.262 MB. The second uPlot run also had +1.126 MB in `[heap]`.

Consequently, the total tree-PSS contrasts in these two isolated pairs were +1.420 MB and +0.036 MB. A binary mapping difference does not predict a fixed total difference.

At those minimum samples, uPlot used about 7.420 MB of live JS heap. D3 used about 7.472 MB. The DOM counters reported 66 nodes and 14 listeners for uPlot, versus 37 nodes and two listeners for D3.

These mapping captures are attribution probes. They use additional heap and mapping observations, not the exact production peak protocol.

## Other controls

- **Fonts:** reciprocal family changes did not consistently close the production gap. Native font caches have measurable costs, but fonts do not explain a fixed residual.
- **Canvas paths:** `beginPath()` did not release a comparable amount of PSS from either live chart.
- **Canvas reset:** resetting canvas widths did not release a comparable amount. This destructive control does not establish native allocation ownership.
- **Cursor promotion:** removing `will-change:transform` did not release the residual. The initial cursor elements were hidden.
- **Grid removal:** removing nine Grid declarations reduced production retained PSS by about 1.72–1.74 MB in runs C and D.

The Grid-removal result is not a clean allocation estimate. It changes actual chart layout and uses separate browser baselines. Geometry equivalence was not established.

Grid removal also removes support for alternative legend placement. It is not a production recommendation.

Earlier retention probes established that both adapters keep the original data arrays and provide data-sourced hover values. This investigation does not repeat those checks. See `benchmark-d3-retention.md`.

## Reproduction

Requirements are the cached Chrome 156.0.8078.47 binary, the built distribution files, and the cached D3 dependency. The scripts do not download dependencies.

The browser configuration uses Vulkan, DPR 1, and a 1920×900 viewport. Browser profiles and raw measurements use `/tmp`. The scripts remove their profiles after each run.

Run these commands serially from the repository root:

```sh
node docs/investigations/benchmark-d3-residual-rerun.mjs
node docs/investigations/benchmark-d3-residual-rerun.mjs d3-minmax:systemfont uplot:arial d3-minmax uplot
node docs/investigations/benchmark-d3-residual-rerun.mjs uplot d3-minmax uplot:nogrid
node docs/investigations/benchmark-d3-residual-rerun.mjs uplot:nogrid d3-minmax uplot

node docs/investigations/benchmark-d3-residual-probe.mjs d3-minmax grid
node docs/investigations/benchmark-d3-residual-probe.mjs uplot grid
node docs/investigations/benchmark-d3-residual-probe.mjs d3-minmax grid

node docs/investigations/benchmark-d3-shared-probe.mjs
node docs/investigations/benchmark-d3-shared-probe.mjs --reverse
node docs/investigations/benchmark-d3-shared-probe.mjs --isolated=uplot
node docs/investigations/benchmark-d3-shared-probe.mjs --isolated=d3-minmax
```

## Evidence and limits

`benchmark-d3-residual-results.json` contains the measurement summaries, raw-result paths, hashes, and exclusions. Large raw measurements remain in `/tmp`.

Earlier exploratory runs used earlier probe revisions. Their stored hashes differ from the current scripts where available. Final shared-browser and Grid runs record the current probe hashes.

All browsers ran serially. Native memory dumps were disabled. Renderer and tree PSS overlap and must not be added together. These measurements exclude GPU device memory.

The strongest supported explanation is a combination of first-use browser-native residency and process-memory variability. The evidence does not assign every byte of the original 0.700–0.774 MB difference.
