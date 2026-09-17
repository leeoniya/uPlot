# Hover marker performance

Recorded on 2026-09-15.

## Comparison

The benchmark compares these implementations:

- Baseline: `8c0bce3`, before the cursor marker alignment changes.
- Current: the working-tree build with shared bitmap-space marker positions and the mode/orientation setup refactor.

The current version has a measurable cost increase when the cursor selects a different data index.
The unchanged-index case shows no repeatable handler slowdown.

## Environment and method

- CPU: AMD Ryzen 7 PRO 5850U with Radeon Graphics.
- Platform: Linux x64.
- Browser: Firefox 155.0.1, headless, with an isolated temporary profile and one configured content process.
- Two complete runs, sequentially. Each run uses one browser instance.
- Seven measured samples per implementation and case, after three warmup samples.
- Each sample dispatches 128 synthetic `mousemove` events. Baseline/current order alternates between samples.
- Each series has 1,024 deterministic data points. The chart is 1,003 × 403 CSS pixels, with fractional padding.
- The pixel-ratio cases use chart `pxRatio` overrides, not OS display changes or browser zoom.
- All series have DOM hover markers. Canvas point drawing and series focus are disabled.
- Chart creation, data generation, event creation, and frame waits occur outside the timed regions.

The benchmark reports two measurements:

1. **Handler only:** event dispatch and synchronous uPlot work. Multiple events occur before the browser processes pending styles.
2. **Handler + flush:** the same work, plus a marker `getBoundingClientRect()` call after each event to force style/layout processing.

The flush measurement includes the geometry-read overhead. It does not represent a complete rendered frame.
Neither measurement includes painting, compositing, OS input handling, or frame delivery.

## Results

All times are median milliseconds per event. Each event updates the chart's hover markers, not only one marker.

### Run 1: 100 series

| Case | Handler baseline → current | Change | Handler + flush baseline → current | Change |
|---|---:|---:|---:|---:|
| DPR 1 | 0.2734 → 0.3828 | +40.0% | 1.1406 → 1.2891 | +13.0% |
| DPR 1.25 | 0.2422 → 0.3125 | +29.0% | 1.0156 → 1.0703 | +5.4% |
| DPR 2 | 0.2344 → 0.2891 | +23.3% | 1.1172 → 1.1484 | +2.8% |
| Inline legend, DPR 1 | 0.3516 → 0.4063 | +15.6% | 2.3359 → 2.4922 | +6.7% |
| Unchanged index, DPR 1 | 0.0234 → 0.0234 | 0.0% | 0.0469 → 0.0391 | -16.7% |

### Run 2: 100 series

| Case | Handler baseline → current | Change | Handler + flush baseline → current | Change |
|---|---:|---:|---:|---:|
| DPR 1 | 0.2969 → 0.3906 | +31.6% | 1.0000 → 1.1016 | +10.2% |
| DPR 1.25 | 0.2344 → 0.3281 | +40.0% | 0.9297 → 1.0703 | +15.1% |
| DPR 2 | 0.2422 → 0.2969 | +22.6% | 1.1641 → 1.2344 | +6.0% |
| Inline legend, DPR 1 | 0.3516 → 0.3984 | +13.3% | 2.6563 → 2.7891 | +5.0% |
| Unchanged index, DPR 1 | 0.0234 → 0.0234 | 0.0% | 0.0703 → 0.0625 | -11.1% |

The changed-index slowdown repeats across both runs. Without a legend, the additional handler cost is approximately 0.055–0.109 ms per event.
The additional handler-plus-flush cost is approximately 0.031–0.148 ms per event without a legend, and 0.133–0.156 ms with an inline legend.

The benchmark also covers 1 and 10 series. These short samples show substantial noise and timer quantization, so their percentage changes are not reliable.
The apparent improvement in the unchanged-index flush case is also too small to treat as an optimization.

At 60 updates per second, the extra handler cost corresponds to approximately 3.3–6.6 ms per second for one 100-series chart without a legend.
This arithmetic does not establish a 60 FPS guarantee. Painting, compositing, application callbacks, and other charts consume additional time.

## Confirmed extra work

An independent, untimed call-count probe used the existing Happy DOM setup and the two distribution modules.
It counted `scale.valToPct()` calls for one changed cursor index with 100 aligned series and no legend or focus.

| Scale conversions per update | Baseline | Current |
|---|---:|---:|
| X | 1 | 101 |
| Y | 100 | 200 |
| Total | 101 | 301 |

`updateCursor()` already calculates logical positions. The alignment helper then repeats scale conversion for each marker in bitmap coordinates.
This explains additional work, but does not quantify its share of the measured slowdown.

Fractional transform strings and their browser parsing can also contribute. The current benchmark does not isolate that cost from the extra calculations.

## Next optimization candidates

1. Reuse scale conversions between logical cursor positions and bitmap marker positions, while preserving the exact canvas operation order.
2. Share the unsnapped bitmap X position across aligned series with the same scale and selected index.
3. Cache point stroke offsets outside mouse movement, with explicit invalidation for width and pixel-ratio changes.

These are candidates, not measured improvements. The alignment regressions must remain the correctness reference.
The benchmark investigation made no additional changes to the runtime implementation.

## Run the benchmark

Firefox and the baseline commit must be available locally. No additional npm dependencies are required.
The runner uses loopback HTTP, removes its temporary profile, and terminates the browser after completion or a 120-second timeout.

Run these commands sequentially:

```sh
NODE_OPTIONS='--max-old-space-size=256' npm run build
node --max-old-space-size=128 scripts/bench-hover.mjs
```

The runner compares committed baseline code with `dist/uPlot.esm.js`. The build step prevents a stale current bundle from invalidating the comparison.
`FIREFOX_BIN` can specify a different Firefox executable. Process-group cleanup currently targets Unix-like systems.

The output includes medians and raw timing samples.
