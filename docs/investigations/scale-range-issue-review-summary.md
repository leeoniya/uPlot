# Scale Range Issue Review Summary

Current state date: 2026-09-17.

## Documents and tests

The detailed review is in [scale-range-issue-review.md](scale-range-issue-review.md).
The closure assessment is in [scale-range-closure-assessment.md](scale-range-closure-assessment.md).
The [open scale issue review](open-scale-issue-review.md) records the original 65-result snapshot. The current open-issue search returns 61 results.

The reduced examples are in `demos/issues/`.

- [API reproductions and issue 1133 button tests](../../test/scale-range-issues.mjs)
- [HTML demo interaction and snippet tests](../../test/issue-demos.mjs)
- [Static-range tests across both data modes](../../test/scale-static-range.mjs)

Source, declarations, and generated JavaScript now include the static-range and drag-refinement changes.
The current working tree also includes public `setRange()`.

This assessment includes all seven issue discussions, the demos, and the regression tests.
Earlier targeted comparisons used source, the demo bundle, and the pre-change bundle from `7074d27`.
That commit precedes `b63f56d` (`add scale.scan`).

The report separates technical resolution from the current GitHub issue state.

## Implemented scan API

`scale.scan` accepts a boolean or a callback:

```ts
type Scan = boolean | ((
	self: uPlot,
	scaleKey: string,
	i0?: number | null,
	i1?: number | null,
) => Range.MinMax);
```

The callback runs once for each calculated scale. It returns one aggregate min/max tuple and must populate the final extrema caches of participating series or facets.

The public scanner also accepts an explicit cache option:

```ts
uPlot.scan(
	self: uPlot,
	scaleKey: string,
	i0?: number | null,
	i1?: number | null,
	cache?: boolean,
): Range.MinMax;
```

The helper is pure by default. A custom callback explicitly enables caching when the built-in data extrema are its final per-series values. This wrapper scans and caches the full domain:

```js
scan: (u, scaleKey) => uPlot.scan(u, scaleKey, null, null, true)
```

The helper scans visible automatic series or facets on the selected scale. It supports aligned, faceted, sorted, and logarithmic data.

Omitted indices use the full length of each participating data array. Supplied indices are clamped independently for each array.

With `cache: false`, direct helper calls are read-only. With `cache: true`, the helper reuses existing extrema and writes cache misses directly before returning the aggregate.

## Related scale APIs

`u.setRange(scaleKey, min, max)` sets concrete bounds and bypasses `scale.range()`.
`u.setScale(scaleKey, limits)` accepts concrete, partial, or null bounds.
`cursor.drag.setRange` can adjust or reject bounds from built-in X and Y drag zoom.
Programmatic scale operations do not call the drag callback.

## Results

| Issue | GitHub state | Technical assessment | Finding |
| --- | --- | --- | --- |
| [823](https://github.com/leeoniya/uPlot/issues/823) | Closed, completed | Reported use case addressed | Full-domain Y bounds survive X zoom and include an initially hidden series after it becomes visible. |
| [808](https://github.com/leeoniya/uPlot/issues/808#issuecomment-1474130071) | Closed, completed | Existing clipping fix preserved | Clipping no longer depends on extrema scans. `scan: true` adds independent static-range scanning. |
| [915](https://github.com/leeoniya/uPlot/issues/915) | Closed, completed | Resolved | Double-click restores static Y after XY zoom. Concrete range arrays default to `scan: false` and retain `auto: true`. |
| [1133](https://github.com/leeoniya/uPlot/issues/1133) | Closed, completed | Reported use case addressed | Automatic backend ranging already worked. `scan: false` removes the unnecessary Y extrema scan. |
| [648](https://github.com/leeoniya/uPlot/issues/648) | Closed, completed | Already resolved before this change | Automatic X reset recalculates Y. Explicit X zoom retains Y, including with the reported drag configuration. |
| [650](https://github.com/leeoniya/uPlot/issues/650) | Open | Partially addressed | Independent candidate ranges work with compatible, pure callbacks. Complete reset-equivalent calculation remains unsupported. |
| [655](https://github.com/leeoniya/uPlot/issues/655) | Closed, completed | Already resolved before this change | Initial concrete Y bounds survive X zoom and data replacement with `auto: false`. |

Issue 915 is fixed in source and generated bundles, and its GitHub issue is closed.
Issue 650 remains open and still needs a scope decision or further implementation.
The static-range fix alone does not establish that all seven issues can close.

## Changes caused by Policy B

The scan API adds independent data scanning and a public extrema helper.
It does not introduce the existing clipping or initial fixed-bound behavior.
The later static-range fix restores normal automatic scheduling for fully concrete range arrays.

### Issue 823

In the historical baseline, a series toggle after X zoom changed the Y range to `[null, null]`.

A scale callback can now use the public aggregate scanner with explicit cache mutation:

```js
scan: (u, scaleKey) => uPlot.scan(u, scaleKey, null, null, true)
```

Omitted indices scan the full length of each visible automatic series. The reproduction now returns the required `[10, 500]` range.

The scan callback runs once during each Y calculation. After a series becomes visible, the helper includes its complete data array.

### Issue 808

A static range array previously disabled series scans. Series extrema stayed null.

The new option supports a fixed range and a scan:

```js
y: {
	range: [-12, 12],
	scan: true,
}
```

The clip rectangle already expands by half the stroke width without an extrema scan.
The function-wrapper workaround was unnecessary for clipping before this change.

`scan: true` populates extrema during scale calculation. The fully concrete range array keeps the default `auto: true`.
Default `setData()` therefore refreshes its extrema caches. Explicit `auto: false` prevents that implicit refresh.
The scan option itself does not schedule the scale.

### Issue 915

A fully concrete range array defaults to `scan: false`, not `auto: false`.
With the normal `auto: true` default, double-click restores static Y after manual zoom.
X-only zoom, default `setData()`, and default `redraw()` also restore static Y.
Concrete X/Y bounds in the same batch remain explicit.
Explicit `auto: true`, `auto: false`, and callbacks remain effective, as do boolean and custom scan overrides.

This optional callback preserves manual Y during explicit X changes, default redraw, and public null/null X reset:

```js
y: {
	range: [1, 10],
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

Double-click and automatic `setData()` restore static Y without a Y scan.
Explicit `auto: false` prevents implicit restoration. Explicit null Y bounds still request recalculation.

`test/scale-static-range.mjs` covers these policies with 34 tests across both modes.
It also covers X/Y scan overrides and data scanning for partial Y range arrays.
Existing asinh tests retain the static default threshold of `1`.

### Issue 1133

The revised demo uses the default `auto: true`, `scan: false`, and a backend range callback.
Three buttons demonstrate data-only updates through `setData()`, combined backend/data updates through `setData()`, and backend-only updates through `redraw()`.
Each button has a displayed snippet and supports repeated use with the same configuration.

| Action | Data | Y bounds | Operation |
| --- | --- | --- | --- |
| Data only | Alternates between two shapes | Unchanged backend bounds | `setData(nextData)` |
| Backend range and data | Alternates between two shapes | Alternates between `[0, 10]` and `[0, 20]` | Assign `backendRange`, then `setData(nextData)` |
| Backend range only | Unchanged | Alternates between `[0, 10]` and `[0, 20]` | Assign `backendRange`, then `redraw()` |

X values remain identical, and both data shapes fit inside both Y ranges.
The HTML test checks 18 repeated and mixed button clicks, including current status output and changed plot coordinates.

These examples keep default `auto: true`. The optional `auto` callback also suppresses Y recalculation during `redraw()`, not only during explicit X zoom.

Targeted checks confirmed that unchanged X values still permit Y recalculation.
A backend-only update followed by `redraw()` also works. `setData(data, false)` does not recalculate the scale.

Automatic `range()` calls already worked in the pre-change bundle. The new benefit is avoiding the Y extrema scan, not all data access.

### Issue 650

The public helper calculates aggregate data extrema without changing the current view or extrema caches:

```js
const [dataMin, dataMax] = uPlot.scan(u, 'y');
const scaleRange = u.scales.y.range(u, dataMin, dataMax, 'y');
```

The reduced HTML demo uses the default padded ranger and compares its candidate with a separate full-domain chart.
The query leaves the active scale and series extrema unchanged.
The earlier API regression also retains the simple custom-ranger case.
The helper does not call the configured `scale.scan` callback or reproduce every step of automatic range calculation.
Calling an arbitrary user `range()` callback does not guarantee purity.

## Remaining gaps

### Public reset semantics

Issue 915 is fixed, but issue 924's reset-sensitive callback distinction remains.
Public null/null X reset does not set `viaAutoScaleX`. Double-click does.
The callback example therefore preserves manual Y during the public X reset and restores static Y during double-click.

### Complete dry-run range calculation

The public helper calculates aggregate extrema without applying them. A caller can invoke `scale.range()` as shown above.

The gap is not merely the absence of a one-call API.
The default X ranger now converts singleton extrema `[5, 5]` to `[0, 10]`, so that historical counterexample is resolved.

Current counterexamples remain:

| Configuration | Direct helper followed by ranger | Automatic range |
| --- | --- | --- |
| Custom Y scan returns `[-100, 100]`, data `[10, 20, 30]`, identity ranger | `[10, 30]` | `[-100, 100]` |
| Derived `y2` doubles parent Y bounds, with no series directly on `y2` | `[0, 0]` | `[16, 64]` |

Custom scan policies and dependent scales require steps outside the direct helper/ranger composition.
A live range callback also sees the current chart, not a simulated reset layout.

The original request concerns pan limits after a visibility change.
Its configuration is not detailed enough to assume that the independent-scale restrictions are acceptable.

### Recalculation naming

Public `setRange()` now provides a named concrete-bound operation.
A null-bound `setScale()` call still requests recalculation:

```js
u.setScale('y', {min: null, max: null});
```

Issue 1133 does not require this call when `setData()` schedules the backend range.
A dedicated recalculation name remains optional.

### Explicit-bound interception

Concrete bounds bypass `scale.range()`.
Built-in drag can adjust or reject X and Y bounds through `cursor.drag.setRange`.
Programmatic `setRange()` and `setScale()` calls do not call the drag callback.
A global hook is necessary only if programmatic operations need common interception.

## Demo and regression follow-up

The final demo pass removes unrelated controls and uses the original reported interactions.
`test/issue-demos.mjs` executes the HTML scripts directly, in addition to the focused API tests.

| Demo | Reduced interaction | Regression coverage |
| --- | --- | --- |
| [823](../../demos/issues/issue-823-full-domain-scan.html) | Drag X, then show initially hidden B through the legend. Plot hooks keep the status current. | Mouse-event drag, show/hide/re-show, full-domain bounds, and double-click reset. |
| [808](../../demos/issues/issue-808-static-range-scan.html) | Static range with flat boundary and middle segments, a 5px stroke, and no point markers or scans. | Thick-stroke clip expansion with null extrema. Separate scan tests retain scanning off/on coverage. |
| [915](../../demos/issues/issue-915-static-range-reset.html) | Mode-2 XY drag and double-click with default `range: [1, 10]`. No reset-workaround button. | Both scales after drag and successful restoration of X and static Y on double-click. |
| [1133](../../demos/issues/issue-1133-dynamic-backend-range.html) | The requested data-only, combined, and backend-only buttons share one configuration. | Repeated and mixed clicks change only the intended state. No Y extrema scan occurs. |
| [648](../../demos/issues/issue-648-auto-reset-vs-zoom.html) | Original direction-sensitive drag configuration, default padded ranger, and one data-update button. | X-only drag preserves manual Y zoom, redraws do not expand bounds, and reset/data updates restore automatic ranges. |
| [650](../../demos/issues/issue-650-candidate-range.html) | X starts zoomed. The legend toggles a hidden outlier outside the window. The read-only query uses the default ranger. | Query preserves bounds/caches. Candidate bounds match a separate full-domain reference chart for this independent scale. |
| [655](../../demos/issues/issue-655-fixed-auto-false.html) | Built-in X drag and reset retain the initial concrete Y bounds. No extra buttons are needed. | Bounds, Y-axis visibility, stroke path, and current status after drag/reset. |

The issue 650 demo distinguishes toggle-driven recalculation from the read-only query.
The candidates are `[8, 32]` with Outlier hidden and `[0, 330]` with Outlier shown.
This example does not claim a general reset-equivalent API.

Additional issue 823 pan and changed-data cases remain useful follow-up coverage.
The demos do not replace unresolved library behavior with application workarounds.

## Latest validation

Current validation produced these results:

| Check | Result |
| --- | --- |
| Static-range suite across both modes | **34 passing** |
| Focused five-file static-range, range-policy, issue, HTML demo, and asinh run | **74 passing**, including the static-range suite |
| Full Node suite (`npm test`) | **1,011 passing** |
| Cursor-drag plus range-policy tests | **50 passing** |
| Historical TypeScript consumer with `skipLibCheck` | Passed |
| Historical full declaration check | Preexisting `DateZoned` issue remained |
| Current TypeScript checks | Not repeated because this checkout does not have `tsc` installed |

The earlier demo pass also checked snippet syntax, two-space indentation, whitespace, and documentation links.

The preceding audit reviewed all seven issue bodies and comments and compared targeted cases with pre-change `7074d27`.
The HTML tests execute the actual demo scripts and mouse/legend/button interactions with DOM/canvas mocks.
They check scale values, status output, cache behavior, and canvas geometry—not rendered pixels.

Real-browser pixel validation remains pending.
Current generated JavaScript contains the reviewed runtime changes.
The listed Node tests were run against the current working tree.
Issue 915 tests require successful reset. Their results do not resolve the separate issue 650 scope gap.

## Additional findings from the open-issue review

The broader review includes all bodies and comments from the original 65-result snapshot.
The current search returns 61 open issues because issues 648, 655, 915, and 1133 are now closed.
Across all 67 issues linked by these reviews, issues 648, 655, 808, 823, 915, and 1133 are closed with reason `completed`.
The other 61 issues remain open. Issues 734, 786, 924, and 1136 have state reason `reopened`.

- **924:** null/null X reset now resolves the reported automatic-Y configuration. Reset-sensitive `auto` callbacks still differ from double-click.
- **883:** mode-2 ranging now includes every matching facet. This does not add rendering or cursor support for arbitrary extra facets.
- **878:** static-X synchronized zoom works, and static-Y reset is now fixed. The broader streaming application remains unverified.
- **678:** the public scanner adds raw aggregate extrema, but not sums, averages, or stored scale extrema.
- **691:** `cursor.drag.setRange` can clamp, snap, or reject built-in X and Y drag bounds. Programmatic wheel and pan code still needs its own constraints.
- **1107:** a named mode-2 Y scale can change without invalidating its series path. The `changed.y` invalidation defect remains.
- **725:** wheel limits need refresh after data changes. Reading scale bounds in `setData` observes the previous bounds.

Issues 620 and 1008 are older implementation closure candidates, not new scan fixes.
Several support questions also have existing solutions. The broader report separates these from new behavior.

`dist/uPlot.d.ts` now includes `Scale.scan`, static `uPlot.scan`, public `setRange()`, `Cursor.DragSetRange`, and the corrected `auto` description.
Current generated JavaScript contains these runtime changes.
The latest npm release remains `1.6.32`. Issue 1136 remains open with state reason `reopened`.

## Recommended order

1. Agree on issue 650's supported scope or implement reset-equivalent candidate calculation.
2. Define the relationship between public resets and `viaAutoScaleX` for issue 924.
3. Add pan and changed-data coverage for issue 823.
4. Validate boundary strokes in a real browser.
5. If programmatic setters require common interception, add a global concrete-bound hook.
