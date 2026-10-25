# DevTools and headless initialization trace coverage

## Conclusion

The current analyzer accounts for the observed uPlot rendering pipeline during both initialization and the full-data update.
It does **not** account for every browser operation. Background GC worker intervals and some I/O activity are outside its selected thread totals.

The audit found no missing layout, paint, raster, commit, or GPU-task intervals inside the diagnostic phase windows.
This conclusion applies to these captures, not every library or future browser version.
No production benchmark code or measurement policy changed during this audit.

## Inputs and method

The supplied `trace2.b64` decodes to gzip-compressed Chrome trace JSON with 8,510 events.
Its metadata identifies a DevTools recording at DPR 1.5, starting at `2026-10-25T00:36:32.384Z`.
The embedded `bench/bench-test.html` matches the local page exactly.
Its timers create the two-point chart at load + 2 seconds and update it at load + 4 seconds.

The diagnostic used one cached Chrome Headless Shell 156.0.8078.47 browser at a time.
It loaded the same page at DPR 1.5 and a 1920×900 viewport, with the benchmark's Vulkan flags.
Chrome reported an AMD Radeon backend, enabled GPU compositing, enabled rasterization, and enabled 2D canvas acceleration.
These feature reports do not measure hardware GPU execution.

The headless capture added `devtools.timeline` and `blink.console` to the two production categories:

- `blink.user_timing`
- `disabled-by-default-devtools.timeline`

For each trace, the audit selected 250 ms windows from the two `TimerFire` starts.
Synthetic markers let the unchanged production analyzer process those windows.
The timer duration is a callback proxy, not an exact substitute for the benchmark's readiness marker.

The analyzer processed both the complete trace and a copy filtered to the production categories.
Metadata events remained available in the filtered copy.
Both inputs produced identical tracked totals for every audited phase.
This is an accounting comparison on identical events, not a measurement of tracing overhead.

The audit also compared detailed event intervals against the intervals included in those totals.
It used per-thread interval unions, so nested events did not inflate the totals.

## Observed event coverage

Both captures contain these rendering stages:

| Stage | Accounting in production traces |
| --- | --- |
| JavaScript callback and microtask work | Enclosing renderer-main `RunTask` intervals |
| `UpdateLayoutTree`, `Layout`, `PrePaint`, `Paint`, `Layerize` | Enclosing renderer-main `RunTask` intervals |
| `Commit`, `UpdateLayer` | Selected enclosing task intervals |
| `RasterTask` | Explicit raster intervals in renderer/GPU workers |
| Renderer compositor work | `RunTask` on the renderer's `Compositor` thread |
| GPU-process host work | `RunTask` on `CrGpuMain`, plus `GPUTask` intervals without double counting |
| Display compositor work | `RunTask` on `VizCompositorThread` |

The production categories omit separate layout/paint event labels, but retain their enclosing main-thread tasks.
Thus, absent detailed labels do not mean absent accounting.
The overlap check found zero uncovered microseconds for the listed observed rendering events within all four diagnostic windows.

## Diagnostic measurements

All values are milliseconds. These are single cold-page diagnostic windows, not benchmark minima.

| Capture | Phase | Timer callback | Renderer main | Raster | GPU main | Total tracked work |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Supplied DevTools | Init | 14.419 | 20.834 | 0.798 | 8.487 | 33.720 |
| Supplied DevTools | Update | 14.700 | 16.120 | 0.453 | 5.116 | 24.354 |
| Headless, same page | Init | 13.932 | 24.873 | 0.981 | 52.721 | 81.847 |
| Headless, same page | Update | 17.417 | 19.451 | 0.584 | 19.580 | 41.951 |

Total tracked work also includes renderer-compositor and display-compositor work.
The two captures use different machines and different tracing configurations. Their durations are not a performance comparison.

In the supplied trace, initialization paint and raster work continued until about 17.3 ms after the timer started.
Update paint and raster work continued until about 16.0 ms.
Both extend beyond the corresponding timer callbacks.

In the headless diagnostic, initialization raster work ended at about 25.8 ms, followed by GPU-process tasks through about 76.9 ms.
The update's corresponding GPU-task sequence ended at about 38.5 ms.
All these events fall inside the 250 ms diagnostic windows.

Neither capture shows additional renderer layout, paint, commit, or raster events between +250 ms and +1,000 ms after either phase starts.
The supplied trace does show recurring GPU tasks in those later intervals.
Similar recurring GPU tasks occur before chart creation, so their presence does not establish unfinished chart rendering.

## Work outside the current totals

The richer traces expose additional renderer/GPU thread intervals outside the production accounting:

| Capture and phase | Background worker intervals | Child I/O thread intervals |
| --- | ---: | ---: |
| Supplied DevTools init | 7.111 ms | 0.156 ms |
| Supplied DevTools update | 0.131 ms | 0.105 ms |
| Headless init | None observed | 0.534 ms |
| Headless update | 7.002 ms | 0.289 ms |

Background worker events include V8 and CppGC concurrent marking, sweeping, scavenging, and GC-related unpark scopes.
Their durations are instrumented thread-wall intervals, not necessarily active CPU time.
In particular, an unpark scope can include synchronization costs.
The audit does not establish that every such interval belongs exclusively to the chart operation.

Small trace-service intervals also occur. The benchmark excludes them rather than treat tracing overhead as chart work.
Browser-process activity remains outside the selected renderer/GPU totals.
Hardware GPU execution, compositor presentation, and uninstrumented worker activity remain unmeasured.

A broader accounting policy needs explicit worker and GC coverage, with interval unions to prevent double counting.
It also needs a decision about attribution and synchronization waits.
Adding layout/paint durations to existing main-thread totals would instead double-count work that is already included.

## Actual benchmark-window check

A separate serial worker run used the normal production categories and protocol:

```sh
node scripts/benchmarks.mjs --worker --variant uplot --trace --vulkan --dpr 1.5
```

It completed three warmup sessions and seven measured sessions, with no trace data loss.
The report identifies `chart-population` and `settled-work-v1`.

| Phase | Minimum readiness | Minimum tracked work |
| --- | ---: | ---: |
| Small init | 3.635 ms | 12.610 ms |
| Full-data update | 6.839 ms | 11.847 ms |

In the measured sessions, the latest observed commit/raster/GPU-task ends were 9.1–16.7 ms after their phase starts.
The corresponding windows ended 209.0–214.6 ms after their starts.
No observed raster or GPU-task interval crossed those end markers.

Renderer-main tasks crossed the end markers because validation and result delivery follow the marker within the same task.
The analyzer clips those task intervals at the marker, as intended.
Unmatched trace begin events belonged to an I/O thread or trace shutdown, not a selected rendering task spanning a measured window.

The earlier saved DPR-1 headless trace used SwiftShader. Its very small GPU-process timings were not directly comparable to this Vulkan capture.
Cold manual-page results also differ from the suite's minima after three warmup sessions.

## Artifacts and limits

Diagnostic artifacts are in `.cache/benchmarks/trace2-audit/`:

- `capture.mjs`: Cache-only, serial capture of the manual page.
- `analyze.mjs`: Synthetic-window analysis and event-coverage checks.
- `headless-manual-rich.json.gz`: Rich headless trace.
- `headless-manual-metadata.json`: Browser, backend, and completion evidence.
- `coverage.json`: Per-phase metrics, event coverage, and omitted intervals.

The production worker report is `.cache/benchmarks/results-chrome-trace-vulkan-uplot.json`.
These cache files can be replaced by later diagnostic runs.
The diagnostic capture had no downloads, screenshots, pixel readbacks, or parallel browsers.

The evidence supports coverage of the observed rendering pipeline, not a claim that `total ms` measures all work caused by a chart.
`init ms` and `total ms` remain selected host-thread work totals. `update ms` remains readiness elapsed time.
