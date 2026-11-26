# Vertical axis size: hot, paced, and sporadic updates

With 15 of 16 labels unchanged, the automatic default measured one label per update. The old `'auto'` measured all 16. This change reduced axis sizing time but did not consistently reduce total update time.

The original measurements below used a map that marked live entries and removed stale ones. See [Cache simplification](#cache-simplification) for the comparison with the current implementation.

## Update time

Each pair shows the median update time in microseconds: **hot / paced**. The last column shows the 95th percentile for the final paced pass.

| Update | Y labels | Old `50` | Old `'auto'` | Final default | Final paced p95 (µs) |
|---|---|---:|---:|---:|---:|
| Zoom | All unchanged | 90 / 650 | 95 / 600 | 105 / 610 | 1,235 |
| Zoom | One new | 105 / 590 | 110 / 665 | 115 / 840 | 1,245 |
| Zoom | All new | 200 / 820 | 225 / 860 | 235 / 865 | 1,665 |
| `setData` | All unchanged | 90 / 425 | 90 / 615 | 105 / 835 | 1,100 |
| `setData` | One new | 90 / 640 | 105 / 915 | 105 / 690 | 1,200 |
| `setData` | All new | 135 / 645 | 165 / 795 | 195 / 930 | 1,355 |
| `setData` | All new, alternating label width | 140 / 550 | 250 / 1,255 | 280 / 1,190 | 2,380 |
| `setData` | Fixed range, no layout | 70 / 610 | 75 / 605 | 85 / 665 | 960 |

## Sporadic updates after 500 ms idle

A fresh browser rotated the three sizes across three blocks of 12 updates. Each size used the same mounted chart for all 36 updates in its case. Only one chart updated at a time. The timer excluded the idle interval. Across 540 updates, the median interval was 500.37 ms and the shortest was 500.16 ms.

Each pair shows **p50 / p95** in microseconds for the 36 individual updates (nearest rank).

| Update | Y labels | Old `50` | Old `'auto'` | Final default |
|---|---|---:|---:|---:|
| Zoom | One new | 635 / 1,215 | 990 / 1,585 | 960 / 1,635 |
| Zoom | All new | 980 / 1,315 | 820 / 1,865 | 950 / 1,615 |
| `setData` | One new | 705 / 1,525 | 795 / 1,315 | 740 / 1,430 |
| `setData` | All new | 810 / 1,710 | 790 / 1,400 | 920 / 1,800 |
| `setData` | Fixed range, no layout | 750 / 1,055 | 610 / 980 | 575 / 1,560 |

With one new label, the final median fell by 30 µs for zoom and 55 µs for `setData` relative to old `'auto'`. The spread was larger: the three old `'auto'` block medians for this zoom ranged from 735 to 1,235 µs. Even the no-layout control had different total times in all three passes without any axis sizing. The total time alone does not isolate the cost of axis sizing.

## Where the time went

In a separate hot pass, the profiler counted native `measureText` calls. Both automatic sizes made zero calls for unchanged labels and 16 calls for 16 new labels. The fixed size made no calls. The fixed-range control drew once per update without axis layout.

For zoom with one new label, text measurement fell from 30 to 5 µs per update. Vertical sizing fell from 43 to 14 µs, and chart layout fell from 60 to 33 µs. Chart layout includes vertical sizing, which includes text measurement. Draw time was 125 µs for both versions. These times are medians of three block averages, not parts of the uninstrumented percentiles.

Over 512 updates with all new labels, old `'auto'` used 512 distinct width arrays. The final default reused one array and kept 16 cache entries after each update. Forced garbage collection left one width array per live automatic axis. After chart destruction, no sampled width array remained. This check measures array retention, not total heap use. A cache miss still allocates an entry. Stable labels reuse the entries and the width array.

With 16 new labels on each `setData`, text measurement took 35 µs of the final 58 µs in vertical sizing. With alternating widths, text measurement took 44 µs of 126 µs in layout. Drawing took another 258 µs. A fixed vertical width avoids both measurement and plot resizing when label widths change.

## Method

The chart used one line, 16 vertical labels, and an 820 × 470 pixel canvas at DPR 1. Zoom changed only the x range over fixed data. Each `setData` call used a prebuilt 256-point dataset. The horizontal axis stayed at 50 pixels. Both automatic vertical axes used 59 pixels except during the alternating-width case.

The hot pass ran 12 blocks of 96 consecutive updates per case and size. The paced pass ran six blocks of 16 updates. After warmup, each paced update waited for two `requestAnimationFrame` callbacks. The first frame had no chart update. The median gap between updates was 32.6 ms. Neither pass measured chart startup.

The timer covered the API call, the chart commit, canvas draw submission, and a DOM layout read. It excluded the frame wait and screen presentation. Each pass used a fresh browser and rotated the order of the three sizes. These results describe one VM, not a frame rate or a guaranteed speedup.

**Environment (2026-11-26):** Chrome Headless Shell 158.0.8127.88, GPU disabled, Linux 7.3.5 x64, Ryzen 7 PRO 5850U, four virtual CPUs, Node 26.13.1. Baseline: git `d3eefe61`, bundle SHA-256 prefix `f3936a83fb2b`. Final: isolated production build, bundle SHA-256 prefix `11336dc998f1`.

## Cache simplification

The current cache keeps two arrays per measured axis: label text and width, in tick order. If the text matches at the same index, the width is already in place. At the first mismatch, the code indexes the previous view in a temporary map before it overwrites any slots. This lookup also serves duplicate new labels. Both arrays end at the current tick count. No map survives the call. Unchanged text and a shorter matching prefix need no map.

We compared the original cache (`11336dc998f1`) directly with the array cache (`e32dc871f14e`) in Chrome Headless Shell 158. The table shows microseconds per `autoAxisSize` call, using medians of batch means. Each of four fresh browsers ran six paired blocks after warmup, alternating the order of the two builds.

| Y ticks | Labels per update | Original cache (µs) | Array cache (µs) | `measureText` calls, both |
|---:|---|---:|---:|---:|
| 16 | Unchanged | 0.38 | 0.32 | 0 |
| 16 | Shift by one tick | 1.42 | 2.56 | 1 |
| 16 | All new | 13.80 | 15.02 | 16 |
| 128 | Unchanged | 2.22 | 1.53 | 0 |
| 128 | Shift by one tick | 4.56 | 10.92 | 1 |
| 128 | All new | 157.01 | 160.20 | 128 |

A one-tick shift moved every retained label to another index. The temporary map cost a median extra 1.12 µs at 16 ticks and 6.34 µs at 128 ticks, using paired differences. With 16 ticks, whole-chart `setData` took 136.7 µs before and 134.9 µs after on this workload. Zoom took 130.4 µs before and 130.3 µs after. The middle half of the paired whole-chart differences included zero in every case. The direct timings show a tradeoff, not a reliable whole-chart speedup or slowdown.

## Reproduce

With the final source in the working tree and no tests in progress, run:

```sh
node scripts/bench-axis-size.mjs --final
```

To repeat the recorded run with the same cached bundle, run:

```sh
node scripts/bench-axis-size.mjs --final .cache/bench-axis-size/final-11336dc998f1a89db5818da2af0fe94bd1aa410115cbfaae38d873b346e218b2.iife.js
```

To run only the sporadic pass, add `--idle-ms 500` to either command. This pass writes a separate `results-idle-500ms-*.json` report.

The script reads the baseline from git and leaves the working `dist` unchanged. The JSON report contains individual update times, frame gaps, profile counters, and retention counts under `.cache/bench-axis-size/`.
