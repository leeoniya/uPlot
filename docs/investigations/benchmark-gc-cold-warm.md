# Background GC accounting

The [benchmark guide](../../scripts/benchmarks.md#measurement-boundaries) defines the measurement windows and reported metrics.
This document explains the collector-selection policy and its limits.

## Collector selection

[`scripts/bench-trace-policy.mjs`](../../scripts/bench-trace-policy.mjs) defines `thread-work-gc-v2` and the `BACKGROUND_GC_EVENTS` allowlist.
Capture enables `disabled-by-default-v8.gc` and `cppgc` alongside the task and marker categories.
The allowlist includes background marking, sweeping, evacuation, weak-reference clearing, and pointer-table sweeping.

The policy selects collector scopes rather than generic worker tasks or every event with a GC-related name.
It excludes explicit unpark, safepoint, join, and synchronization scopes because those scopes do not identify collector work.
GC flow events describe relationships, not duration intervals.
Unknown collector names require review before they can change measured totals.
Browser upgrades require another event-coverage check.

Selection covers background threads in the chart renderer and GPU processes.
It excludes unrelated renderers, browser UI threads, and known main/compositor threads.
Main-thread GC already belongs to main-thread task totals.
The policy does not provide complete worker accounting.

## Overlap and availability

[`scripts/analyze-benchmarks-trace.mjs`](../../scripts/analyze-benchmarks-trace.mjs) clips intervals to each phase window and forms per-thread unions.
Nested collectors and overlaps with selected raster, task, or GPU intervals count once on each thread.
Concurrent work on different threads contributes separately to total thread work.

- `backgroundGcMs` measures the selected collector unions across threads.
- `gcAddedThreadWorkMs` measures their addition to total tracked work after overlap removal.

Both fields are `null` without valid relevant recorded collector intervals.
A zero `backgroundGcMs` means relevant intervals exist but do not overlap the phase window.
A zero `gcAddedThreadWorkMs` means selected GC adds no duration after overlap removal.
Neither zero proves that no collection occurred.

Trace timing means use each round's deduplicated total. The analyzer does not add an averaged GC breakdown again.
GC work contributes to the existing phase totals, without a separate table column.

## Interpretation limits

GC attribution is temporal, not causal. A collection can reclaim allocations from an earlier phase.
Work outside the phase windows does not contribute to their totals.
These totals therefore do not establish allocation ownership or the full amortized cost of an application.

Collector wall durations can include preemption and internal waits, despite the exclusion of explicit wait scopes.
They do not measure exclusive CPU usage, elapsed chart readiness, or hardware GPU execution.
Warmup does not eliminate collection or guarantee decreasing work across samples.

Tracing can affect scheduling and buffer memory. More recorded events can also affect process-memory measurements in combined mode.
Combined mode adds process polling and forced-GC checkpoints outside timing windows.
Its timing results are not interchangeable with trace-only results.
