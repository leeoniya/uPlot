# Adaptive asinh scan: complexity and simplification

Date: 2026-10-05

## Status and scope

This document records the combined extrema and adaptive-asinh scan investigation on `sparse-heatmap`.
The core now uses the chosen scalar cache design described next.
The historical findings and benchmark results describe earlier implementations, not current recommendations.
The helper-placement benchmark changed temporary source snapshots, not the core implementation.

The goals are one data pass for asinh, cheap cached redraws, and no additional per-value work for non-asinh scales.
The public `uPlot.scan()` API is unreleased.
Its arguments remain `uPlot.scan(self, scaleKey, i0, i1, cache = false)`.

The investigation excludes dependent-scale-specific behavior.
The final design retains existing non-asinh sorted optimizations.
An uncached asinh scan uses one pass and ignores the sorted hint.

## Chosen final design

### Scan results and callbacks

The shared return type is:

```ts
[min: number | null, max: number | null, minAbs?: number | null]
```

- Non-asinh scans return `[min, max]`.
- All built-in asinh scans compute `[min, max, minAbs]`, including internal scans and fixed/custom thresholds.
- Custom asinh scanners must return all three elements.
- `minAbs` is the smallest absolute value strictly greater than the numeric `scale.clamp`.
- `minAbs` is `null` if no value qualifies. Adaptive threshold selection uses fallback `1` after aggregation.
- Asinh uses an immutable numeric clamp, with default `0`. Log clamp callbacks remain unchanged.

The numeric scanner computes extrema and `minAbs` in one pass.
It uses infinity sentinels internally and leaves fallback selection to the adaptive threshold consumer.
The core no longer has a `scanAsinh()` helper or an `asinhStats` argument.
All asinh scans use the same triple contract without a public/internal statistics distinction.

Custom threshold callbacks remain supported.
The heatmap plugin uses a prepared threshold.
A fixed/custom threshold still incurs the cost of the triple in a built-in asinh scan.
Sorted asinh data requires a full uncached scan, not an extrema-only endpoint scan.

### Private per-series and per-facet caches

Each series or facet stores a private scalar `_minAbs` alongside its existing `min` and `max` fields.
The public typings omit this cache field. The public scan tuple still exposes its third statistic.
There is no cached result tuple and no interval or cutoff metadata.

| `_minAbs` | Meaning | Cache behavior |
| --- | --- | --- |
| `undefined` | The statistic is invalid or uncomputed. | Compute the statistic on the next required scan. |
| `null` | The scan found no qualifying absolute value. | Reuse the empty result without another scan. |
| A number | The scan found a qualifying `minAbs`. | Reuse that value. |

The cache contract relies on caller-managed validity:

- With `cache = true`, callers must supply the correct current `i0` and `i1` for the managed interval.
- The cache does not compare query intervals or detect clamp changes. Asinh clamps are immutable.
- With `cache = false`, public scans do not reuse or modify the cached statistics.
- Data mutations require `setData`. The core does not detect direct mutations of `u.data`.
- Data or interval invalidation makes affected statistics uncomputed. The next required scan recomputes them.

Hide/show retains each series cache, including `_minAbs`.
Only uninitialized or invalid series require another data scan.
Each scale scan aggregates `minAbs` across participating series or facets alongside `min` and `max`.
The scale has no persistent aggregate `minAbs` cache.

Mode 1 invalidates asinh statistics after X-window changes, even if Y auto-ranging is suppressed.
Mode 2 scans full facets, so X-window changes do not invalidate their statistics.
Data changes through `setData` invalidate hidden series too.
Stacking changes can invalidate affected data, so stacked visibility toggles can require new scans.

Fallback selection occurs after aggregation.
An empty series must not contribute fallback `1` to another series with a real `minAbs` of `10`.
The transient handoff to adaptive threshold selection avoids another traversal.
Custom scanner results also avoid a fallback data scan.

### Shared X and skipped range scans

Shared X retains the existing endpoint reread for extrema on cache hits.
Its `series[0].min/max` fields can hold visible endpoints rather than extrema for the cached query.
The cache-hit path combines the reread extrema with cached `_minAbs`.
It does not restore the old `scanAsinh()` helper or store a separate extrema tuple.

Explicit pending bounds and `scan: false` can suppress an extrema scan while the default threshold still needs data.
The adaptive threshold fallback obtains missing statistics through a cached scan.
A static range array defaults the threshold to `1` unless the caller supplies `asinh`.

### Relevant implementation

- [`src/utils.js`](../../src/utils.js): `getMinMaxAsinh()`.
- [`src/uPlot.js`](../../src/uPlot.js): scan dispatch, adaptive threshold selection, aggregation, and cache invalidation.
- [`dist/uPlot.d.ts`](../../dist/uPlot.d.ts): `ScanResult` and the scanner contracts.
- [`demos/lib/heatmapPlugin.js`](../../demos/lib/heatmapPlugin.js): the prepared heatmap threshold and numeric clamp.

Regression coverage is in [asinh-scan.mjs](../../test/asinh-scan.mjs) and [asinh-scan-utils.mjs](../../test/asinh-scan-utils.mjs).

## Historical findings and superseded proposals

These findings explain the earlier investigation.
The chosen final design supersedes its recommendations for a complete-result cache and interval/cutoff keys.

### Public and internal scan results

The earlier internal dispatch distinguished public scans from scans that only needed extrema:

```js
let asinh = scale.distr == 4 && (asinhStats || scale.asinh == asinhScale);
```

Public scans requested the third element even with an explicit threshold.
Internal scans omitted that work for explicit or custom thresholds.
This distinction required the `asinhStats` argument.
It also permitted extrema-only scans to overwrite fields associated with an existing asinh cache.

The investigation proposed a triple for every built-in asinh scan:

```js
let asinh = scale.distr == 4;
```

The final design adopts this proposal and accepts the fixed/custom-threshold cost.
Non-asinh scan paths retain their existing behavior.

### Split cache and complete-result proposal

The earlier cache split its result across these fields:

```js
facet.min
facet.max
facet._asinhScan = [i0, i1, cutoff, minAbs]
```

Other code had independent write access to the extrema fields.
An extrema-only scan required invalidation of the associated asinh cache.
Shared X also required an extrema reread because its fields sometimes held visible endpoints.

The investigation proposed a complete cached result:

```js
facet._asinhScan = [i0, i1, cutoff, min, max, minAbs]
```

That proposal added two values per cached series or facet and avoided the shared-X extrema reread.
The investigation favored it as a candidate for simpler bookkeeping, not as a measured performance improvement.
The final design rejects this proposal.
It stores only scalar `_minAbs`, retains the existing extrema fields, and keeps the shared-X endpoint reread.

### Callbacks, skipped scans, and empty results

The investigation favored custom scanner support, custom threshold callbacks, and the transient scan-result handoff.
It also favored the adaptive fallback scan for paths that skip an extrema scan.
An alternative proposal required explicit/custom thresholds or fallback `1` for those paths.
The final design retains the fallback scan rather than that stricter rule.

Null gaps, empty intervals, zero-only data, and values at or below the clamp remain normal chart states.
The investigation distinguished missing statistics from a computed empty result.
The final scalar cache preserves this distinction through `undefined` and `null`.
Fallback `1` remains a consumer decision after aggregation, not a per-series scan result.

### Interval and cutoff keys

The earlier `[i0, i1, cutoff]` key supported arbitrary cached query intervals and numeric clamp changes.
The investigation recommended retention of all three keys and inclusive-interval normalization.
The final design rejects the cache-key recommendation, not interval normalization.

The chosen contract assigns current-interval correctness to `cache = true` callers and treats asinh clamps as immutable.
It requires `setData` for data mutations instead of direct-mutation detection.
These constraints remove the need for interval/cutoff metadata.

## Historical helper-placement benchmark evidence

These measurements predate the final scalar cache design.
They do not measure its performance.

The first implementation kept the asinh cache branch inside the shared `acc()` closure.
Earlier measurements suggested an approximately 10% Node penalty in a large linear control.
The implementation then moved that branch into `scanAsinh()`.

A later comparison isolated function placement.
The inline variant moved the helper body from that snapshot directly into `acc()` without other algorithm changes.
It did not restore an older implementation with unrelated differences.

### Method

- Node 26.10.0 and Bun 1.4.3, with no browser runs.
- Two suites per engine, with reversed import and initial timing order in the second suite.
- A 60-second cooldown before the first suite and between every suite.
- Four warmup batches and twelve measured pairs per workload, with alternating AB/BA timing order.
- Minimum batch-average microseconds per update, not minimum individual update time.
- Real chart updates with drawing disabled and data preparation excluded.
- The 110-point adaptive demo model and expanded 100k/250k workloads.

### Selected results

The table shows the helper time change relative to inline at 250k points.
Each cell contains the normal-order result followed by the reversed-order result.
Negative values mean that the helper took less time.

| Scale | Operation | Node | Bun |
| --- | --- | ---: | ---: |
| Adaptive asinh | `setData` | -0.6% / -1.5% | -1.9% / -7.1% |
| Adaptive asinh | Pan/zoom | +0.6% / -0.8% | -2.8% / -7.6% |
| Adaptive asinh | Redraw | -1.5% / +0.7% | -1.9% / +6.8% |
| Linear | `setData` | -0.6% / +0.2% | -5.3% / -2.1% |
| Linear | Pan/zoom | +3.6% / +0.7% | -6.1% / +2.4% |
| Log | `setData` | +5.6% / +4.1% | +2.5% / +4.7% |
| Log | Pan/zoom | +4.4% / +1.8% | +2.7% / +1.2% |

The earlier Node linear penalty did not recur.
The helper reduced time for large Bun adaptive updates, but inline reduced time for large log updates in both engines.
The original 110-point demo remained mixed.
Node adaptive redraw changed from a 17% helper advantage to a 9.7% helper penalty after order reversal.

All four suites produced identical correctness hashes and data-read probes.
Source hashes showed that only `uPlot.js` differed between variants.
The helper snapshot matched the core source at the time of those runs.

**Historical conclusion:** these runs did not establish a general performance advantage for the helper.
Minimum timings and cooldowns did not remove all variation.
The measurements did not establish thermal throttling as the cause of earlier results.
The final design removes the helper without a claim of a measured performance improvement.

### Historical commands: no longer runnable

The following commands record the original experiment.
The current harness rejects `--inline` and `--reverse` because their mechanical transformation required the removed `scanAsinh()` helper.
These commands require the historical harness and matching source snapshots.

```sh
sleep 60
node scripts/bench-asinh-scan.mjs --inline --min
sleep 60
bun scripts/bench-asinh-scan.mjs --inline --min
sleep 60
node scripts/bench-asinh-scan.mjs --inline --reverse --min
sleep 60
bun scripts/bench-asinh-scan.mjs --inline --reverse --min
```

The original reports are local artifacts under `test/output/asinh-scan/`:

- `node-26.10.0-inline-helper-6ctPaB/report.json`
- `node-26.10.0-helper-inline-OsRJof/report.json`
- `bun-1.4.3-inline-helper-gXDj3C/report.json`
- `bun-1.4.3-helper-inline-k4ePHa/report.json`

These artifacts are not durable repository documentation.
The full test suite clears `test/output`.

## Current reproduction commands

The [benchmark script](../../scripts/bench-asinh-scan.mjs) retains temporary source snapshots, hashes, probes, and raw timing samples.
Its default mode compares the pinned baseline with current `src/`.
`--baseline` runs frozen-source A/A calibration without current source imports.
`--expect-fused` adds assertions for asinh triples, fewer `setData` reads, and zero cached adaptive-callback reads.
`--min` selects minimum batch timings instead of medians.
These modes do not extract or depend on the removed helper.

From the repository root, run:

```sh
node scripts/bench-asinh-scan.mjs --baseline --min
sleep 60
node scripts/bench-asinh-scan.mjs --expect-fused --min
sleep 60
bun scripts/bench-asinh-scan.mjs --baseline --min
sleep 60
bun scripts/bench-asinh-scan.mjs --expect-fused --min
```

These comparisons do not isolate helper placement or the scalar cache change.
The harness covers mode 1 with one Y series, not shared X, mode 2, hide/show, or custom callbacks.


## Validation of the scalar cache change

- Full Node suite: 2,726 passing and 44 pending.
- Targeted Bun suites for asinh scans, numeric scanning, clamps, and redraws: 228 passing.
- JavaScript syntax and diff whitespace checks passed.
- Type assertions keep the private cache out of the public series and facet declarations.
- TypeScript compilation was unavailable because `tsc` was not installed.

Regression tests cover cache reuse for numeric and empty results, visibility toggles, supported `setData` updates, and deferred adaptive updates.
Tests no longer require interval-key matching, direct clamp mutation detection, or endpoint-only scans for explicit asinh thresholds.

### Cache-benefit reevaluation

A subsequent run compared the scalar-cache implementation with baseline `3ab577c266d9890401be1f875fcc190e1afd5bbd` in Node 26.10.0 and Bun 1.4.3.
Each engine ran one comparison suite with `--expect-fused --min`.
A 60-second cooldown preceded the first suite and separated the two suites.
No core source changed during these runs.
The targeted suites also passed again in both engines, with 228 tests each.

#### Data-read counts

Both engines produced the same counts for the 4,096-point probe.
The pan/zoom operation selected 1,434 visible values.

| Adaptive operation | Baseline Y reads | Scalar-cache Y reads |
| --- | ---: | ---: |
| `setData` | 12,292 | 4,096 |
| Uncached public scan | 4,100 | 4,096 |
| Cached public scan | 0 | 0 |
| Cached adaptive callback | 8,192 | 0 |
| Pan/zoom | 4,306 | 1,434 |
| Cached redraw | 2,868 | 0 |
| Repeated cached redraw | 2,868 | 0 |

All read probes matched the previous tuple-cache evaluation exactly.
Linear and log read counts also matched their baseline counts.
The scalar cache therefore retains the fused scan and avoids additional data reads for adaptive threshold selection.

#### Adaptive update timings

Times are minimum batch-average microseconds per update.
Each batch includes chart updates, ranging, layout, legend updates, and the scheduled microtask, but excludes drawing and data preparation.
Speedup is the baseline minimum divided by the scalar-cache minimum.

| Points | Operation | Node baseline → scalar, µs | Speedup | Bun baseline → scalar, µs | Speedup |
| ---: | --- | ---: | ---: | ---: | ---: |
| 110 | `setData` | 41.85 → 42.28 | 0.99× | 45.03 → 45.30 | 0.99× |
| 110 | Pan/zoom | 44.94 → 40.63 | 1.11× | 39.36 → 34.61 | 1.14× |
| 110 | Redraw | 49.87 → 48.14 | 1.04× | 40.69 → 39.48 | 1.03× |
| 100k | `setData` | 245.08 → 238.44 | 1.03× | 1,480.91 → 213.32 | 6.94× |
| 100k | Pan/zoom | 223.44 → 213.82 | 1.04× | 1,236.73 → 174.34 | 7.09× |
| 100k | Redraw | 204.61 → 47.16 | 4.34× | 921.42 → 41.32 | 22.30× |
| 250k | `setData` | 544.85 → 525.11 | 1.04× | 3,866.58 → 422.34 | 9.16× |
| 250k | Pan/zoom | 470.59 → 447.54 | 1.05× | 3,458.97 → 459.64 | 7.53× |
| 250k | Redraw | 431.43 → 46.26 | 9.33× | 2,216.85 → 41.37 | 53.58× |

Large-data redraw gains remain clear.
The original 110-point demo shows small changes rather than a large speedup.

Control timings remain variable despite unchanged read counts.
Node 250k linear `setData` and pan/zoom took approximately 7.3% and 7.1% longer than baseline in this run.
These single-suite measurements do not establish a repeatable regression or isolate the scalar-cache change.
The exact read counts provide stronger evidence for retained cache behavior than comparisons between timing runs.

Source hashes matched across engines and matched the unchanged working-tree source.
The correctness checksum matched all previous evaluations:

```text
57e1b4838c1c0cfc3e5dfa0ba994d2d7065cb4921dd8cf76037dba7c782dd7cd
```

Local reports under `test/output/asinh-scan/`:

- `node-26.10.0-compare-iYVy32/report.json`
- `bun-1.4.3-compare-FBzffq/report.json`
