# Grafana scale compatibility audit

Date: 2026-09-17.

## Scope and baseline

The supplied Grafana archive identifies itself as `13.3.0-pre`.
Its location is `/home/leeoniya/Downloads/grafana-latest/grafana-main`.
All Grafana file references in this report are relative to that directory.

Grafana declares `uplot: "1.6.32"` in its root `package.json`.
`packages/grafana-ui/package.json` declares `^1.6.32`.
The supplied `yarn.lock` resolves both to `1.6.32`.

The comparison uses:

- **Historical baseline:** the standalone ESM bundle at `e995b061e9fc5476a6d862cd2fb2ebc7452ca012`, the npm 1.6.32 release commit.
- **Candidate source:** the modified working-tree `src/uPlot.js`, based on repository `HEAD` `e27e409`.
- **Candidate distribution:** the modified working-tree `dist/uPlot.esm.js`, based on the same `HEAD`.

The generated CJS, IIFE, and minified IIFE bundles also contain the current range behavior.
The audit records hashes for those bundles and the public declarations.
The behavior matrix runs against the candidate source and ESM bundle.

The audit covers the scale/range contract, raw singleton X inputs, and relevant consumers of series extrema.
It is not a complete compatibility review of every change since 1.6.32.
External plugins and separately distributed packages are outside this source archive's scope.

## Release assessment

**The candidate is not a drop-in upgrade for this Grafana snapshot.**

| Priority | Consumer | Upgrade effect | Required decision or change |
| --- | --- | --- | --- |
| High | TimeSeries and TimelineChart | Same-configuration data updates can retain stale X bounds and pending-pan state. | Explicitly enable automatic X range calculation for the existing callbacks. |
| Medium | Histogram, one numeric bucket | Raw singleton extrema can produce equal or reversed bounds. | Derive the range from the actual bucket edges before generic snapping. |
| Medium | Histogram, native X zoom | The audited Grafana snapshot's deprecated `setScale: true` setting applies exact drag bounds. It bypasses bucket snapping and configured limits. | Accept exact zoom, or replace the alias with a `cursor.drag.setRange` callback that returns constrained bounds. |
| Conditional | Exported graveyard TimeSeries | Numeric singleton ranges become degenerate. Time callbacks also have the refresh risk. | Add an equal-bound fallback and update the time-scale policy if consumers still use this API. |

The first and third findings come from the current range policy.
The second and fourth include effects of the raw-X-extrema change.
The npm 1.6.32 results are historical evidence, not current candidate behavior.

## 1. Time range refresh and pan acknowledgement

### Source evidence

- `packages/grafana-ui/src/components/uPlot/config/UPlotScaleBuilder.ts:268–279` defaults time scales to `auto: false`.
- `public/app/core/components/TimeSeries/utils.ts:160–189` supplies the dashboard time range through an X callback.
- `public/app/core/components/TimelineChart/utils.ts:155–184` supplies a similar callback with timeline-specific bounds.
- Both callbacks clear `isPanning` after the dashboard time range acknowledges a pending pan.
- `public/app/core/components/GraphNG/GraphNG.tsx:224–258` can reuse the configuration for new data with the same structure.
- `packages/grafana-ui/src/components/uPlot/Plot.tsx:80–93` calls `setData(data)` when data changes without a configuration change.

These paths serve time series, candlestick, state timeline, and status history panels.

### Why the upgrade changes behavior

For `auto: false`, `setData()` submits the existing concrete X bounds again.
The old mode-1 X implementation still called `range()` with those bounds.
The candidate treats them as explicit bounds and skips `range()`.

Grafana therefore loses more than a transform of the supplied bounds.
It loses the callback that reads current dashboard bounds and acknowledges a pending pan.
Y auto-ranging can then use the retained, stale X window.

### Runtime results

The probes run the extracted TimeSeries and TimelineChart callbacks with the actual scale builder.
They supply small state and dashboard-range stubs.
The TimelineChart probe supplies a stub for `coreConfig.xRange()` rather than its sample-padding implementation.

| Action | Historical npm 1.6.32 | Current source and ESM bundle |
| --- | --- | --- |
| Initialize with dashboard bounds `[0, 100]` | `[0, 100]` | `[0, 100]` |
| Change dashboard bounds to `[100, 200]`, then call `setData()` | `[100, 200]` | `[0, 100]` |
| Receive matching query data after a pending pan | Clears `isPanning` | Retains `isPanning: true` |

Direct pan movement still applies its concrete bounds.
The defect concerns the subsequent callback evaluation and state transition.

### Migration

The smallest behavioral change is `auto: true` on these specific X scales.
This restores callback evaluation during `setData()`.
It is also compatible with the old API.

The intended candidate configuration is:

```js
x: {
  time: true,
  auto: true,
  scan: false,
  range: existingTimeRangeCallback,
}
```

The probe verifies this configuration for both extracted callbacks.
It updates dashboard bounds and clears pending-pan state.
The callback receives `[null, null]` rather than scanned extrema.
Primary-X data access for the rendered window still occurs independently.

Grafana's `ScaleProps` does not currently expose `scan`.
The complete migration adds that property and forwards it through `UPlotScaleBuilder.getConfig()`.
The candidate typing can use `scan?: uPlot.Scale['scan']`.

A blanket change to every scale's `auto` default is unnecessary and risks unrelated behavior changes.

An alternative is an explicit update path that supplies the new concrete X bounds.
The candidate now exposes `u.setRange(scaleKey, min, max)` for this operation.
This method bypasses `scale.range()`.
The object-form `u.setScale()` remains available and delegates concrete bounds to `setRange()`.
Null `setScale()` bounds request range calculation.

The explicit update path also needs pan acknowledgement outside `scale.range()`.
It must preserve the sample padding in `public/app/core/components/TimelineChart/timeline.ts:508–530`.
Unmodified dashboard bounds lose the status-history column padding.
Neither `setRange()` nor programmatic `setScale()` calls `cursor.drag.setRange`.

### Test gap

`public/app/core/components/TimeSeries/utils.test.ts:618` starts direct callback tests for time ranges and panning.
Those tests call the callback themselves.
They do not verify that uPlot invokes it during a same-configuration `setData()` update.
The pan-plugin tests also mock `setScale()`.

## 2. Histogram singleton ranges

### Source evidence

`public/app/plugins/panel/histogram/Histogram.tsx:56–60` derives bucket width from the first bucket's start and end.
The data preparation removes the bucket-end field at `:294–312`.
A single numeric bucket therefore reaches uPlot with one X value, its start.

The custom X callback at `:122–146` contains two relevant operations:

1. For one bucket, it sets `wantedMax = bucketSize`, an absolute coordinate rather than the bucket end.
2. It snaps the remaining bounds to a grid with origin zero.

Old X pre-expansion masked some consequences of these operations.
The new callback receives the actual equal extrema instead.

### Runtime results

These probes run the extracted callback with a bucket size of `10` and no configured limit overrides.

| Actual bucket | Historical npm result | Current candidate result | Correct bucket-edge result |
| --- | --- | --- | --- |
| `[5, 15]` | `[0, 10]` | `[10, 10]` | `[5, 15]` |
| `[10, 20]` | `[0, 20]` | `[10, 20]` | `[10, 20]` |
| `[100, 110]` | `[0, 10]` | `[100, 10]` | `[100, 110]` |
| `[-10, 0]` | `[-20, 10]` | `[-10, 10]` | `[-10, 0]` |

The first case changes from an ordered range to a collapsed range.
The third changes from an ordered but incorrect range to reversed bounds.
Thus, the underlying callback defect is old, but the upgrade introduces additional invalid-range outcomes.

The offset case is reachable through one value `5`, bucket size `10`, and bucket offset `5`.
The panel exposes both bucket controls in `public/app/plugins/panel/histogram/module.tsx:49–70`.
Explicit prebucketed input is another route.

These are verified range results, not browser screenshots.
The probes disable axes and paths to avoid undefined drawing behavior for invalid domains.

### Migration

A numeric-singleton branch can return the actual bucket start and end before generic snapping.
The probe verifies this approach for all four examples.

Changing only `wantedMax` to `start + bucketSize` is insufficient.
The zero-origin snapping still collapses the offset bucket `[5, 15]` to `[10, 10]`.

A production migration must also preserve configured limit overrides.
The tested branch covers numeric linear buckets without overrides, not ordinal or logarithmic bucket policies.

## 3. Histogram explicit zoom and drag refinement

In the audited Grafana snapshot, `Histogram.tsx:211–217` enables native X dragging with the deprecated `setScale: true` alias.
That historical setting applies concrete drag bounds without `scale.range()`.

| Requested zoom | Configuration | Historical npm 1.6.32 | Current source and ESM bundle |
| --- | --- | --- | --- |
| `[3, 27]` | Bucket size `10` | `[10, 20]` | `[3, 27]` |
| `[3, 27]` | Configured limits `[0, 30]` | `[0, 30]` | `[3, 27]` |

The first case loses bucket snapping.
The second case loses configured-limit enforcement.
The logarithmic callback also loses its chance to expand explicit zoom bounds by the bucket factor.
That logarithmic case remains source-derived.

The programmatic probes retain `u.setScale()` to isolate the concrete-bound contract.
Separate drag probes use the built-in mouse path and mocked overlay geometry.
They confirm that the `cursor.drag.setRange` callback can return `[10, 20]` and `[0, 30]` for these cases.

Exact, unsnapped zoom can be acceptable.
If Grafana requires constraints, replace the deprecated `cursor.drag.setScale: true` alias with a `cursor.drag.setRange` callback.
The callback receives ordered `min` and `max` bounds for each changed scale.
It must return an adjusted `[min, max]` tuple, or `null` to cancel the scale change.

For example, Grafana can share its numeric range calculation:

```js
setRange: (u, scaleKey, min, max) => {
  if (scaleKey != 'x')
    return [min, max];

  return calculateHistogramRange(u, min, max);
},
```

Only built-in drag zoom calls this callback.
Programmatic `setScale()`, public `setRange()`, automatic calculation, and reset do not call it.

## 4. Exported legacy components

`packages/grafana-ui/src/graveyard/TimeSeries/utils.ts:170–175` returns numeric X extrema with optional configured overrides.
Without overrides, a singleton at `10` now produces `[10, 10]` instead of the old `[0, 20]`.
The probe runs that extracted callback with an empty field configuration.

The legacy time callback at `:118–121` also reads the dashboard range through `range()`.
It has the same `auto: false` refresh dependency.

These components remain exported from `packages/grafana-ui/src/index.ts:400–407`.
The audit found no active built-in panel caller outside the graveyard/export chain.
External plugin usage remains unknown.

## Consumers without a confirmed new regression

| Consumer | Evidence and assessment |
| --- | --- |
| Heatmap, time X | `public/app/plugins/panel/heatmap/utils.ts:114–129` already queues concrete dashboard bounds from a `setData` hook. It does not need the callback for that update. |
| Heatmap, numeric X | `utils.ts:149–169` expands extrema using the bucket size. A positive size already gives equal extrema a nonzero span. |
| Bar chart | `public/app/plugins/panel/barchart/bars.ts:212–237` computes ordinal bounds from the data length and handles one group. Native dragging is disabled at `:473–479`. |
| Sparkline | `packages/grafana-ui/src/components/Sparkline/utils.ts:133–140` rejects fewer than two values. Its X callback at `:191–200` derives bounds from its input, not callback extrema. |
| Active numeric TimeSeries | The shared `UPlotScaleBuilder` uses range utilities and invalid-range guards instead of an identity callback. Singleton bounds can change without becoming degenerate. |
| XY chart | `public/app/plugins/panel/xychart/scatter.ts:300–325` uses mode 2 and explicitly enables X auto-ranging. Its time identity callback already lacked an equal-bound fallback before this change. |
| Series/facet participation | Existing facet `auto` properties retain compatibility through the deprecated alias. Their rename is not an immediate upgrade requirement. |
| Gradient caches | `packages/grafana-ui/src/components/uPlot/config/gradientFills.ts:185–206` has a manual extrema fallback. No new cache-consumption failure was established. |
| Ready hooks | No production `ready` setter in the audited plugin scope depends on the old commit-cleanup ordering. |

The gradient fallback scans the entire series when cached extrema are absent.
A broad migration to `scan: false` can therefore change gradient domains.
The proposed migration disables scanning only for X callbacks that already ignore extrema.

## Historical evidence and existing defects

These npm 1.6.32 controls separate existing behavior from current upgrade effects:

- **Concrete Y zoom:** nonempty-data Y zoom already bypassed `range()` in 1.6.32.
- **Fixed Y zoom on data refresh:** both versions retain `[30, 70]` after a manual zoom of an `auto: false` scale.
- **Tooltip zoom tracking:** clearing `yZoomed` on `setData()` without resetting fixed scales is an existing inconsistency.
- **Candlestick volume with `auto: false`:** both versions pass null extrema to `(u, min, max) => [0, max * 7]`.
  Both produce `[0, 0]` in the isolated probe.
- **XY time singleton:** the mode-2 identity ranger already received raw equal extrema.

The historical empty-data setter called `range()` even for explicit Y bounds.
The current candidate does not.
The audit did not establish a meaningful empty-data zoom failure in Grafana's existing consumers.
These controls provide historical context and are not current Grafana migration requirements.

## Reproduction and limits

The standalone artifact is [`scripts/audit-grafana-scales.mjs`](../../scripts/audit-grafana-scales.mjs).

From the uPlot repository, run:

```sh
node scripts/audit-grafana-scales.mjs /home/leeoniya/Downloads/grafana-latest/grafana-main
```

The script uses Node 26, existing uPlot test dependencies, and the local Git history.
It extracts actual callbacks and the scale builder from the Grafana archive.
It tests the historical ESM bundle, candidate source, and candidate ESM bundle.
It prints the candidate `HEAD`, working-tree state, artifact hashes, results, and stub boundaries.
No network requests, package installs, or Grafana edits are necessary.
Node emits an experimental warning for `stripTypeScriptTypes`.

**Result: 64 of 64 probes passed.**
A passing probe means that the expected difference or migration result occurred.
It does not mean that the unchanged Grafana configuration is compatible.

The script uses the repository's Happy DOM and canvas instrumentation.
General probes disable axes, cursor, legend, points, and paths.
The drag probes enable the cursor and use mocked overlay geometry.
The script does not run React, Grafana's full test suite, or a browser.
The extracted Grafana directory has no `node_modules` installation.

The current behavior matrix covers `src/uPlot.js` and `dist/uPlot.esm.js`.
The script records hashes for the other generated bundles and `dist/uPlot.d.ts`.
It does not run the full behavior matrix against those additional artifacts.

## Checks before the dependency update

1. Add `auto: true` to the affected time X scales.
2. Add and forward `ScaleProps.scan` for the candidate API.
3. Use `scan: false` for the callbacks that supply dashboard bounds.
4. Correct numeric-singleton histogram ranges, including offset buckets and configured limits.
5. Decide whether histogram zoom must retain bucket snapping and fixed-limit enforcement.
6. If it must, use a `cursor.drag.setRange` callback for the shared constraint calculation.
7. Add real-uPlot tests for same-configuration data refresh and pending-pan acknowledgement.
8. Include time series, candlestick, state timeline, and status history in those tests.
9. Include status-history sample padding in the pan tests.
10. Include histogram drag, reset, singleton offset buckets, and logarithmic buckets in browser tests.
11. Audit exported legacy component consumers before removing their compatibility coverage.
12. Update the root dependency, the UI package range, and the lockfile together.
13. If source changes again, rebuild all distribution bundles before dependency testing.
