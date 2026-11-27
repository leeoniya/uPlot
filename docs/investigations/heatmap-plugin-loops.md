# Heatmap count scan and row lookup in Chrome

**Use conditional updates for the count minimum and maximum. Keep `Map` for row IDs.** The count scan took 61% less time. The median time for `setData` plus draw did not change.

## Measurements

Chrome Headless Shell 158.0.8127.88 ran on Linux x86-64 with an AMD Ryzen 7 PRO 5850U. The benchmark used the synthetic `heatmap-cells` demo dataset: seed 1, `xGapProbability: 0.02`, 246,053 cells, 2,516 occupied columns, and 169 distinct rows.

Each row compares one change against `b708302d`. Times are median milliseconds per operation. The last column gives the median percentage change **within each paired round**, not the percentage difference between the two medians.

| Change | Operation | Baseline (ms) | Candidate (ms) | Paired change |
|---|---|---:|---:|---:|
| Conditional count extrema (working plugin) | Automatic color-domain scan | 0.731 | 0.281 | −61.3% |
| Same change | Whole `setData` hook | 7.59 | 7.43 | −3.9% |
| Same change | `u.setData` plus draw | 26.75 | 26.75 | 0.0% |
| Conditional column Y extrema | Column scan | 0.246 | 0.235 | −3.4% |
| Same change | Whole `setData` hook | 7.59 | 7.74 | +1.3% |
| Conditional absolute-edge minimum | Whole `setData` hook | 7.59 | 7.79 | +1.0% |
| Same change, mirrored cells | Signed column scan | 0.358 | 0.335 | −2.7% |
| Conditional projected minimum size | Project both axes, 0.25 px gap | 0.107 | 0.105 | −1.9% |
| Plain object, read once and check for null | Whole `setData` hook | 7.59 | 35.61 | +369% |
| Plain object, `key in obj` then read | Whole `setData` hook | 7.59 | 52.46 | +581% |
| Predict the next row, fall back to `Map` | Whole `setData` hook | 7.59 | 6.51 | −15.7% |

## Decisions

- **Count extrema:** The plugin reads each count once and assigns each extremum only when it changes. The input contract requires finite, positive counts. A fixed color domain still skips the scan.
- **Other extrema:** The column loop checks endpoints rather than every cell. The unsigned threshold loop checks only distinct rows. Neither change gave a repeatable preparation improvement. The projection result also changed direction across runs. Clamps on individual coordinates are not accumulators and stayed unchanged.
- **Row IDs:** The CPU profile attributed 1,058 of 1,744 baseline samples to the `rowIds.get(bottom)` line. The keys are numbers, not strings. The geometric dataset has fractional edges, which an object must convert to property keys. Both object variants took much longer than `Map` on this dataset.
- **Integer keys:** With the same cells converted to ordinal rows, the baseline took 5.61 ms. The single object read took 4.70 ms, and the `in` check took 6.44 ms. The integer result does not justify replacing `Map` for all grids.
- **Row prediction:** This variant tried the row after the previous cell before searching the map. With every other occupied cell omitted, preparation rose from 4.09 to 5.03 ms. The sparse regression ruled it out.

## Reproduce

Run all variants from the repository root:

```sh
node scripts/bench-heatmap-chrome.mjs
```

For the shipped change alone, run `node scripts/bench-heatmap-chrome.mjs baseline working`. Use `CHROME_BIN` to select a specific Chrome Headless Shell binary. Without an override, the runner uses the project cache or downloads Chrome on a cache miss.

The benchmark excludes data generation, frame adaptation, and chart setup. It checks color domains, axis edges, column offsets, row IDs, and projection results against the baseline. Each stage uses five warm-up rounds and 21 timed rounds with rotating variant order. The full update uses a 1,000 × 560 chart, 24 colors, and one draw per update. This measures the chart update on the main thread, not time to screen presentation.

After timing, the runner records separate CPU profiles of 240 preparation calls for the baseline and working plugin. Each run writes the raw timings and `.cpuprofile` files to a new directory under `.cache/heatmap-loops/`.
