# Scale Range Issue Review

Current state date: 2026-09-17.

## Scope

This report reviews seven issues about scale scanning, scale ranging, zoom, and reset behavior.

- [Issue 823](https://github.com/leeoniya/uPlot/issues/823)
- [Issue 808 comment](https://github.com/leeoniya/uPlot/issues/808#issuecomment-1474130071)
- [Issue 915](https://github.com/leeoniya/uPlot/issues/915)
- [Issue 1133](https://github.com/leeoniya/uPlot/issues/1133)
- [Issue 648](https://github.com/leeoniya/uPlot/issues/648)
- [Issue 650](https://github.com/leeoniya/uPlot/issues/650)
- [Issue 655](https://github.com/leeoniya/uPlot/issues/655)

The earlier audit compared source and the demo bundle with the pre-change bundle at `7074d27`.
That commit precedes `b63f56d` (`add scale.scan`). The audit includes all seven issue bodies and their comments.
This update includes the static-range fix, the X-range refactor, drag-bound refinement, public `setRange()`, and current generated bundles.
The latest npm release remains `1.6.32`. Issue 1136 remains open with state reason `reopened`.

The [review summary](scale-range-issue-review-summary.md) contains the consolidated demo findings and latest validation results.
Technical results and current GitHub states are reported separately.

## Final-pass findings

The reduced demos now use the reported drag, reset, legend, and backend-update interactions rather than substitute controls.
Visible configuration snippets use two-space indentation and keep the relevant setup on the page.

- Issue 823 uses built-in drag and legend toggles, with live status output.
- Issue 808 isolates the existing clipping fix with thick boundary strokes and no extrema scan.
- Issue 915 demonstrates successful mode-2 XY drag and double-click reset, without a reset-workaround button.
- Issue 1133 retains the three requested repeatable update scenarios with one configuration.
- Issue 648 uses the original direction-sensitive drag options and default range padding.
- Issue 650 demonstrates visibility changes while X is zoomed, without claiming a general reset simulation.
- Issue 655 uses built-in X drag/reset to verify the already-correct concrete Y bounds.

The implementation now updates source, declarations, and generated bundles.
Issue 915 is fixed and closed. Issue 650 remains open and still needs an accepted scope or a more complete calculation API.

## Result summary

| Issue | GitHub state | Technical result | Effect of Policy B |
| --- | --- | --- | --- |
| 823 | Closed, completed | Resolved | A custom scan callback can use `uPlot.scan()` without indices to scan the full X domain. |
| 808 | Closed, completed | Existing clipping fix preserved | Clipping works without scanning. The new option independently enables static-range extrema scans. |
| 915 | Closed, completed | Resolved | Double-click restores static Y. Concrete range arrays default to `scan: false` and retain `auto: true`. |
| 1133 | Closed, completed | Reported use case addressed | Automatic backend ranging already worked. `scan: false` avoids the unnecessary Y extrema scan. |
| 648 | Closed, completed | Already resolved upstream | The reported automatic-versus-manual zoom behavior works before and after Policy B. |
| 650 | Open | Partially addressed | Independent candidate ranges work with compatible, pure callbacks. General reset-equivalent calculation remains unsupported. |
| 655 | Closed, completed | Already resolved upstream | Initial concrete Y bounds remain valid when `auto` is false. Policy B formalizes this behavior. |

## Reproduction method

[test/scale-range-issues.mjs](../../test/scale-range-issues.mjs) contains focused API reproductions and the repeated-button test for issue 1133.
[test/issue-demos.mjs](../../test/issue-demos.mjs) executes the other HTML demos and their original interactions.
[test/scale-static-range.mjs](../../test/scale-static-range.mjs) adds **34 tests** across both modes.
The focused five-file run passes **74 tests** for static ranges, range policy, issues, HTML demos, and asinh.
The full `npm test` run passes **1,011 tests**.
The cursor-drag and range-policy files pass **50 tests** together.
Historical validation reported that the TypeScript consumer passed with `skipLibCheck` and that the full declaration check retained the preexisting `DateZoned` issue.
These TypeScript checks were not repeated because this checkout does not have `tsc` installed.

The audit also executed the seven demo scripts with the project's DOM/canvas mocks.
Targeted checks compared current behavior with the pre-change bundle and exercised the original drag interactions for issues 648 and 915.

The reproductions now cover the original drag and visibility interactions described in the summary.
The issue 915 tests now require successful reset. The issue 650 test remains limited to one independent scale.

No real-browser pixel validation was performed.
Passing these tests does not by itself establish issue closure.

## Issue 823: Full-domain Y range during X zoom

### Requested behavior

The Y scale must use extrema from the full X domain. X zoom and pan must not change that Y range.

Visible-series changes must update the full-domain Y range. The original workaround cached extrema in custom scale or series properties.

### Prior problem

`scale.auto` controlled two operations:

1. It controlled whether uPlot recalculated the scale.
2. It controlled whether uPlot scanned series data.

The callback returned false during explicit X zoom. The scan did not run, and `scale.range()` received null bounds.

The user could not call the internal `getMinMax()` function. Hidden series also had no cached extrema.

### Current behavior

`scale.scan` accepts a callback that runs once for the calculated scale. The callback returns one aggregate min/max tuple and must populate the final extrema caches of participating series or facets.

`uPlot.scan()` scans all visible automatic series or facets on one scale. Omitted indices select the full length of each data array. It is pure by default; `cache: true` explicitly enables cache reuse and mutation.

This configuration keeps Y on the full X domain:

```js
y: {
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
	scan: (u, scaleKey) => uPlot.scan(u, scaleKey, null, null, true),
	range: (u, min, max) => [min, max],
}
```

The initial automatic X range produces full-domain Y bounds. An explicit X zoom keeps those bounds because `auto` returns false.

A visible-series change requests Y recalculation. The custom scanner ignores the current indices and scans the full data arrays.

The reproduction starts with `[10, 50]`. It then zooms X and enables a series with a full-domain maximum of `500`.

The new Y range is `[10, 500]`. The scan callback runs once for each Y calculation.

### Result

The new scan callback and public aggregate scanner fully resolve the reported case.

`uPlot.scan()` includes visible automatic series. A hidden series starts contributing after it becomes visible, which matches the issue requirement.

The demo includes a series hidden at initialization and uses built-in X drag and legend toggles without custom buttons.
A draw hook keeps the status current. The HTML regression covers drag, show/hide/re-show, and double-click reset.
Pan and changed-data scenarios remain useful additional coverage.

## Issue 808: Static range and line clipping

### Requested behavior

A line at a fixed scale boundary must show its full stroke width.

The example uses a static range. Static ranges historically disabled data scans.

### Prior workaround

The issue used a function instead of an array:

```js
y: {
	range: () => [-12, 12],
}
```

A function range kept automatic scanning active. The scale then had the series extrema that the clipping logic required.

### Current behavior

The canvas clip rectangle already expands by half of the line width. This clipping correction exists in upstream before Policy B.

The new option independently enables extrema scanning for a static array:

```js
y: {
	range: [-12, 12],
	scan: true,
}
```

At initialization, the scale remains fixed at `[-12, 12]` and the series extrema become `[-12, 12]`.

Without `scan: true`, the scale remains fixed, but the series extrema stay null.
Clipping still works because the current clip rectangle does not depend on those extrema.

A fully concrete static range keeps the default `auto: true`.
With explicit `scan: true`, default `setData()` refreshes the extrema caches.
Explicit `auto: false` prevents this implicit refresh. The scan option itself does not schedule the scale.

### Result

The visual clipping defect was already fixed before this change.
The function-wrapper workaround was already unnecessary for clipping. The new capability is independent static-range scanning.

The revised demo uses flat boundary and middle segments with a 5px stroke and no point markers.
It intentionally uses a static range without scanning, so the rendering example does not depend on the new scan API.
The HTML regression verifies thick-stroke clip expansion with null extrema. Separate API tests retain scanning off/on coverage.

## Issue 915: Reset of a zoomed static Y scale

### Requested behavior

The report uses mode 2, faceted data, and a static Y range of `[1, 10]`.
An XY drag changes both scales. Double-click must restore X and the static Y range.

### Current behavior

A fully concrete `range: [1, 10]` defaults to `scan: false` and keeps the normal `auto: true` default.
A Y drag applies concrete bounds and bypasses `scale.range()`.
Double-click restores X and static Y without a Y scan.

With these defaults, X-only zoom, default `setData()`, and default `redraw()` also restore static Y.
Concrete X/Y bounds in the same batch remain explicit.
Explicit `auto: true`, `auto: false`, and callbacks remain effective, as do boolean and custom scan overrides.

The HTML demo uses only the reported mode-2 XY drag and double-click. It has no reset-workaround button.
Its regression now requires both scales to reset.

### Optional reset-sensitive callback

This configuration preserves manual Y during explicit X changes, default `redraw()`, and public null/null X reset:

```js
y: {
	range: [1, 10],
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

Double-click and automatic `setData()` restore static Y without a Y scan.
This callback is optional, not the default scheduling policy.
Explicit `auto: false` prevents implicit restoration. Explicit null Y bounds still request recalculation.

### Result

The reported issue is fixed in source and generated bundles. GitHub issue 915 is closed.
`test/scale-static-range.mjs` covers defaults, explicit overrides, concrete X/Y batches, and the callback behavior across both modes.
It also covers X/Y scan overrides and data scanning for partial Y arrays.
The public null/null X reset still differs from double-click for reset-sensitive callbacks, as documented for issue 924.

## Issue 1133: Dynamic backend range

### Requested behavior

A backend supplies new Y bounds every few seconds.
The discussion covers updates through both `redraw()` and `setData()`, without an unnecessary Y extrema scan.

### Current behavior

Keep the default `auto: true` scheduling policy. Disable only the scan:

```js
let backendRange = [0, 10];

const opts = {
	scales: {
		y: {
			// Use this callback to prevent Y auto-ranging after an explicit X range.
			// auto: (u, viaAutoScaleX) => viaAutoScaleX,
			scan: false,
			range: () => backendRange,
		},
	},
};

backendRange = [0, 20];
u.setData(replacementData);
```

`setData()` resets X and schedules Y. The Y scale calls `range()` and applies the new backend bounds without a Y extrema scan.

The pre-change bundle already invokes `range()` with default automatic scheduling.
The new benefit is avoiding the unnecessary Y extrema scan.
Targeted checks passed for replacement data with unchanged X values and for backend-only updates followed by `redraw()`.

An explicit X range also schedules Y because `auto` defaults to `true`. The commented callback prevents that behavior if necessary.

A `setData(data, false)` call does not reset scales. It does not call `range()`.

### Other explicit operations

Public `setRange()` sets concrete bounds and bypasses the callback:

```js
u.setRange('y', 0, 20);
```

`setScale()` remains compatible with concrete object bounds. Null or partial calculation requests still use `setScale()`.

Null bounds request a separate recalculation:

```js
u.setScale('y', {min: null, max: null});
```

These explicit operations remain useful when the backend range changes without a data update.
GitHub issue 1133 is closed.

With this configuration, `redraw()` also schedules Y and applies a changed backend range.
The demo now includes data-only, combined backend/data, and backend-only actions, each with a snippet.
The API regression confirms that all three scenarios supply null extrema to the ranger.
The HTML regression executes 18 repeated and mixed clicks against the actual button handlers.
It checks that data-only updates preserve bounds, range-only updates preserve data, and combined updates change both.
X remains unchanged, both shapes stay inside the bounds, and each click changes the plotted coordinates.
The displayed status matches the resulting chart state.

The optional `auto` callback suppresses Y recalculation during `redraw()` as well as explicit X zoom.
The three examples therefore keep the default `auto: true`.

`auto: false` still prevents implicit scheduling after initialization. It is not equivalent to `scan: false`.

## Issue 648: Automatic Y reset versus manual zoom

### Requested behavior

Y must recalculate after automatic X reset or new data. Y must not recalculate during explicit X zoom.

The issue uses this policy:

```js
y: {
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

### Current behavior

The initial automatic X range recalculates Y. A later explicit X zoom keeps the existing Y bounds.

A `setData()` call with scale reset enabled recalculates Y from the new data.

The reported behavior works in both the pre-change bundle and the current source.

The revised demo uses the original `drag: {x: true, y: true, dist: 8, uni: 15}` configuration and the default padded ranger.
The HTML regression covers X-only drag after manual Y zoom, repeated redraws, double-click, and data replacement.
Only the data-update button remains. Zoom and reset use the built-in interactions.

### Policy B effect

Policy B preserves the callback behavior. It also prevents old scale bounds from acting as new data extrema.

Calculated bounds now have explicit provenance. Therefore, `scale.range()` receives scanned extrema or null values, not stale scale bounds.

### Remaining gap

No gap remains for the reported behavior.

## Issue 650: Candidate extents without scale mutation

### Requested behavior

A plugin needs the complete automatic ranges for all visible series. It must get these ranges without changing the chart.

The result must include the configured range functions. Future layout-dependent range calculations can also need axis and plot dimensions.

### Current behavior

`uPlot.scan()` calculates aggregate extrema without changing scales, series extrema, paths, layout, or hooks when `cache` is omitted or false.

A caller can pass the result through the configured ranger:

```js
const [dataMin, dataMax] = uPlot.scan(u, 'y');
const scaleRange = u.scales.y.range(u, dataMin, dataMax, 'y');
```

Neither operation applies the result automatically. The demo's pure range callback leaves the current view unchanged.
An arbitrary user callback can have side effects, so scanner purity alone does not guarantee that the combined operation is read-only.

The helper supports aligned and faceted data, index bounds, sorted data, logarithmic filtering, and visible-series participation.

### Remaining gap

The helper/ranger composition does not generally calculate the same result as a full reset.
The default X ranger now handles singleton and repeated equal X extrema, so that former counterexample is resolved.

The remaining differences are:

- The helper scans built-in data instead of invoking a custom `scale.scan` callback.
- A dependent scale uses calculated parent bounds, not directly assigned series data.
- A callback sees the live chart layout, not a simulated reset layout.
- An arbitrary user callback can have side effects.

This is a functional scope gap, not merely the absence of a one-call API.
The [summary](scale-range-issue-review-summary.md#complete-dry-run-range-calculation) records concrete counterexamples.

The original request concerns pan limits after a hidden series becomes visible.
The revised demo starts with X zoomed and uses an initially hidden outlier outside the window, with the default ranger.
Its HTML regression compares candidate bounds with a separate full-domain chart for each visibility state.

The demo explicitly distinguishes the read-only query from recalculation caused by the visibility change.
It does not claim that this independent-scale example covers every reset calculation.

Keep issue 650 open unless its accepted scope explicitly excludes the unsupported cases.

## Issue 655: Initial `min` and `max` with `auto: false`

### Requested behavior

The chart starts with concrete Y bounds of `[-15, 15]`. X zoom and later data changes must not erase those bounds.

### Prior problem

Older code reset scale bounds to infinity before a scan. An `auto: false` scale did not scan data afterward.

The Y scale then became invalid. A static range array was the workaround.

### Current behavior

Initial `min` and `max` values become explicit pending bounds. They bypass `scale.range()` and apply exactly.

An X zoom does not schedule the Y scale because `auto` is false. A data change also preserves the Y bounds.

The reproduction passes against both upstream and the Policy B source. Therefore, upstream already fixed the reported failure.

### Policy B effect

Policy B formalizes the distinction:

- `min` and `max` define concrete bounds.
- `range()` derives calculated bounds.
- `auto` controls implicit recalculation.
- `scan` controls data scanning.

### Remaining gap

The original disappearing-scale defect is resolved, and the demo is a faithful reduced reproduction.
The initial bounds are not permanent constraints or a stored reset target.
Explicit Y changes remain possible, and a configured `range` supplies bounds on recalculation.
The reduced demo explains this distinction and verifies the original case through built-in X drag and reset.

## Consolidated gaps

### 1. Complete dry-run range calculation

The helper/ranger composition calculates an independent candidate range with a compatible, pure callback.
The default X ranger now includes singleton X expansion.
The composition still omits custom scan policies, dependent-scale evaluation, simulated layout, and callback side-effect isolation.
Issue 650 needs a scope decision or further implementation.

### 2. Public reset semantics

Issue 915 is fixed. Static range arrays now respect explicit `auto` and `scan` configuration.
Issue 924's callback distinction remains: public null/null X reset does not set `viaAutoScaleX`, but double-click does.

### 3. Recalculation naming

`u.setRange(scaleKey, min, max)` now identifies a concrete-bound operation.
A null-bound `setScale()` call still means “calculate this scale now.”
A dedicated recalculation name remains optional.

### 4. Explicit-bound interception

Concrete `setRange()` and `setScale()` bounds bypass `scale.range()`.
Built-in drag can adjust or reject X and Y bounds through `cursor.drag.setRange`.
This technically addresses issue 691 for built-in drag, while the GitHub issue remains open.
Programmatic setters do not call the drag callback.
A global hook is necessary only if programmatic operations need common interception.

## Recommended next steps

1. Agree on issue 650's supported scope or implement reset-equivalent candidate calculation.
2. Define the relationship between public resets and `viaAutoScaleX` for issue 924.
3. Add issue 823 pan and changed-data coverage.
4. Validate boundary strokes in a real browser.
5. If programmatic setters need common clamp or snap behavior, add a global concrete-bound hook.

The reduced demos and HTML interaction tests are complete for the scenarios listed in the [summary](scale-range-issue-review-summary.md#demo-and-regression-follow-up).

The issue 915 fix does not resolve issue 650's remaining scope gap.
