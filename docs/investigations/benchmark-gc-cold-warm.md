# Background GC and cold versus warm initialization

## Result

The first chart costs substantially more than the best warm chart in these captures.
This result supports a cold/warm explanation for a large gap, but it does not reproduce the earlier 33.72-versus-5.2 comparison.
That comparison used different recordings. The report behind the 5.2 ms table value remains unavailable.

The new accounting includes selected background GC in thread-work totals.
On the supplied DevTools recording, initialization increases from **33.720 ms to 40.831 ms** in the same 250 ms audit window.
The additional **7.111 ms** is background collector work, not elapsed initialization latency.

## Accounting change

The capture enables two additional categories: `disabled-by-default-v8.gc` and `cppgc`.
`scripts/bench-trace-policy.mjs` defines an explicit allowlist of collector scopes.
It includes background marking, sweeping, evacuation, weak-reference clearing, and pointer-table sweeping.
It excludes generic worker wrappers, unpark scopes, safepoint scopes, and join scopes.
Unknown scope names require review before inclusion.

Selection covers workers in the chart renderer and GPU processes.
It excludes unrelated renderer processes and browser UI threads.
Main-thread GC remains part of existing main-thread task totals.
Per-thread interval unions remove overlaps between nested collectors and existing selected work.
All intervals stop at the phase boundaries.

JSON includes two additional metrics:

- `backgroundGcMs`: the sum of selected collector unions across threads.
- `gcAddedThreadWorkMs`: the increase in total tracked work after overlap removal.

The new protocol is `thread-work-gc-v2` in capture and analysis metadata.
Reports without this metadata retain legacy `thread-work-v1` accounting.
Saved summaries reject mixed accounting protocols and mismatched capture/analysis versions.
The initialization boundary remains `settled-work-v1`.
No new table column is necessary.

GC attribution is temporal, not causal. A collection can reclaim allocations from an earlier phase.
Collector wall durations can include preemption or internal waits, despite exclusion of explicit wait scopes.
These metrics do not measure exclusive CPU usage or hardware GPU execution.

## Experiment

Ten fresh-browser captures ran serially. No full benchmark suite ran.
Each browser completed three warmup sessions and seven measured sessions.
Each session created a two-point chart, then updated that retained chart to the full dataset.
The artifacts preserve all 100 sessions, including their initialization and update windows.

Configuration:

- uPlot, with the shared benchmark adapter and existing fixture.
- Chrome Headless Shell 156.0.8078.47.
- AMD Ryzen 7 PRO 5850U and Radeon graphics.
- Linux, Vulkan enabled, DPR 1.5, viewport 1920 × 900.
- The same ANGLE/AMD renderer string across all captures.
- Enabled GPU compositing, Canvas2D acceleration, and rasterization in Chrome feature status.

“First” means round `-3`: the first chart after library loading, font readiness, and raw-data loading.
It does not include browser startup, network transfer, or library parsing.
“Warm” includes measured rounds `0..6`, not the other two warmups.
The benchmark still excludes all three warmups from its normal summary.

Three captures used combined trace/memory mode with GC capture.
Three used trace-only mode with GC capture.
Three trace-only controls used the previous categories and accounting.
One combined control used the previous categories and accounting.
The trace-only order was legacy, GC, GC, legacy, legacy, GC.
The combined controls were not interleaved, so they provide only a limited instrumentation check.

Control captures used a cache-only Node loader to remove the GC categories and select legacy accounting.
They used the same production timing boundaries and browser configuration.
No production CLI switch or timing change was necessary.

## Initialization work

All values are milliseconds of tracked thread work.
Each summary cell is the median of its corresponding browser-level statistic.
Thus, “warm minimum” is the median of three per-browser minima, not the minimum across all 21 warm sessions.

| Capture | Browsers | First init | Warm median | Warm minimum |
| --- | ---: | ---: | ---: | ---: |
| Trace-only, with background GC | 3 | 64.233 | 43.489 | 10.104 |
| Combined trace/memory, with background GC | 3 | 137.878 | 63.994 | 48.079 |
| Trace-only, previous categories/accounting | 3 | 66.840 | 11.709 | 8.610 |
| Combined, previous categories/accounting | 1 | 121.575 | 29.322 | 25.789 |

Under the new accounting, first initialization is **6.4× the warm minimum** in the trace-only summary.
The corresponding combined-mode ratio is **2.9×**.
These ratios use the summary medians. They are not universal cold-start multipliers.

The warm median is much higher than the warm minimum because some warm windows contain substantial GC or GPU-process work.
Warmup does not eliminate collection or guarantee monotonically decreasing work.
Combined mode also includes memory polling and forced-GC checkpoints outside chart windows.
Its timing results are not interchangeable with trace-only results.

Per-browser results preserve the variation:

| Capture | First init | Warm median | Warm minimum |
| --- | ---: | ---: | ---: |
| `combined-1` | 137.878 | 61.561 | 39.239 |
| `combined-2` | 151.697 | 63.994 | 48.079 |
| `combined-3` | 119.703 | 66.292 | 55.604 |
| `trace-gc-1` | 64.233 | 50.887 | 10.882 |
| `trace-gc-2` | 95.318 | 13.265 | 8.404 |
| `trace-gc-3` | 61.771 | 43.489 | 10.104 |
| `trace-legacy-1` | 76.737 | 10.974 | 8.610 |
| `trace-legacy-2` | 64.154 | 11.709 | 7.796 |
| `trace-legacy-3` | 66.840 | 21.429 | 9.766 |
| `combined-legacy-1` | 121.575 | 29.322 | 25.789 |

Readiness latency also shows a cold/warm difference, independently of the added GC arithmetic:

| Capture | First readiness | Warm median readiness | Warm minimum readiness |
| --- | ---: | ---: | ---: |
| Trace-only, GC capture | 20.772 | 2.179 | 1.865 |
| Combined, GC capture | 27.471 | 7.765 | 5.270 |

These readiness values are `jsIntervalMs`, not the current trace table's `init ms`.
The 5.270 ms readiness minimum must not be mistaken for reproduction of the earlier 5.2 ms work value.

## GC contribution and category coverage

Each recorded trace also passed through the analyzer under legacy accounting.
For every phase, the total difference matched `gcAddedThreadWorkMs` within floating-point tolerance.
This comparison isolates the arithmetic contribution, not tracing overhead.

In combined captures, the median first-init GC addition was 25.493 ms.
The median of the per-browser warm-median GC additions was 30.744 ms.
The trace-only first initializations had no selected GC overlap.
Their warm sessions varied: one browser's median addition was zero, while the other two exceeded 22 ms.

The richer manual recordings also passed a category-filter comparison:

| Recording | Phase | Previous total | Added GC | New total |
| --- | --- | ---: | ---: | ---: |
| DevTools `trace2.b64` | Init | 33.720 | 7.111 | 40.831 |
| DevTools `trace2.b64` | Update | 24.354 | 0.131 | 24.485 |
| Headless manual page | Init | 81.847 | 0.000 | 81.847 |
| Headless manual page | Update | 41.951 | 3.367 | 45.318 |

These comparisons retain the earlier audit's synthetic 250 ms windows.
They do not replace the benchmark's actual phase markers.
Rich and targeted-category totals matched in all four windows.
The headless update excludes the previously identified 3.635 ms unpark interval.
The policy accounts for all 7.111 ms of previously omitted collector work in the external initialization window.

Actual targeted captures emitted V8 collector scopes through `devtools.timeline,disabled-by-default-v8.gc` and CppGC scopes through `cppgc`.
No capture reported trace data loss.
The new captures had no invalid intervals, unmatched ends, or mismatched ends.
Unmatched begins were task wrappers, not collector scopes.
GC flow events remain diagnostics, not duration intervals.

## Instrumentation limits

The trace-only controls do not establish zero overhead from the added categories.
Median first readiness was 20.366 ms with previous categories and 20.772 ms with GC categories.
The corresponding warm-median readiness values were 2.326 ms and 2.179 ms.
These small, variable differences do not support a precise overhead estimate.

Whole-window work varied more substantially.
Even without the added GC arithmetic, the GC captures' representative warm median was 21.589 ms versus 11.709 ms in controls.
Thus, the increase cannot all be described as newly counted worker time.
GC scheduling, GPU-process work, tracing, and shared-machine variation remain confounded in these short runs.

Median compressed trace size increased from 129,196 bytes to 215,282 bytes in trace-only mode.
The three combined GC traces were approximately 0.76 MB each, versus 0.17 MB for the single combined control.
More recorded events can also affect process-memory results in combined mode.
No correction or baseline subtraction was applied to timing totals.

The evidence establishes a real first-chart versus best-warm-chart difference under controlled workload and backend choices.
It does not establish the cause of every difference between the external DevTools recording and the earlier benchmark table.
The original table's raw report remains necessary to verify its protocol, backend, DPR, and selected round.

## Artifacts and validation

Local artifacts are in `.cache/benchmarks/gc-cold-warm/`:

- `<capture>.json`: raw report, current analysis, command, backend, and source hashes.
- `<capture>.json.gz`: original trace, unchanged by reanalysis.
- `assessment.json`: per-session metrics, browser-level statistics, and rich-trace comparisons.
- `run-one.mjs`: serial capture and immediate archive helper.
- `legacy-categories.mjs`: control loader, used only in this investigation.
- `assess.mjs`: reanalysis, accounting checks, and statistical summary.
- `prior-trace-report.json` and `prior-trace.json.gz`: the previous production capture, preserved before replacement.

The normal per-variant cache filenames contain the latest GC-enabled reports, not the diagnostic controls.
These focused workers did not regenerate a suite report or an idle-adjusted memory table.
The cache artifacts are local and are not repository source files.

The selected tooling tests and manual-page integration tests passed: **749 passing**.
The tests cover interval clipping, nested scopes, overlap removal, process selection, exclusions, synchronous pairs, availability, and protocol compatibility.
All ten browser captures completed. No parallel browser execution occurred.
