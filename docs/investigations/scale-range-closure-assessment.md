# Scale Range Issue Closure Assessment

## Scope

This document records the technical assessment and current GitHub state of these scale-range issues:

- [Issue 823](https://github.com/leeoniya/uPlot/issues/823)
- [Issue 808 comment](https://github.com/leeoniya/uPlot/issues/808#issuecomment-1474130071)
- [Issue 915](https://github.com/leeoniya/uPlot/issues/915)
- [Issue 1133](https://github.com/leeoniya/uPlot/issues/1133)
- [Issue 648](https://github.com/leeoniya/uPlot/issues/648)
- [Issue 650](https://github.com/leeoniya/uPlot/issues/650)
- [Issue 655](https://github.com/leeoniya/uPlot/issues/655)

## Closure matrix

The issue states below are current for this review.
Historical targeted comparisons used the pre-change bundle at `7074d27`, source, and the demo bundle.
The static-range fix is present in source, declarations, tests, and generated JavaScript.

| Issue | Current state | Technical assessment |
| --- | --- | --- |
| 823 | Closed as completed | Full-domain scanning includes an initially hidden series after it becomes visible. |
| 808 | Closed as completed | Clipping works without scanning. `scale.scan` independently enables static-range extrema scans. |
| 915 | Closed as completed | Double-click restores static Y after XY zoom. Both data modes have regression coverage. |
| 1133 | Closed as completed | Automatic backend ranging works. `scan: false` removes the unnecessary Y extrema scan. |
| 648 | Closed as completed | The original drag configuration works with the documented automatic-ranging policy. |
| 650 | Open | Independent candidate ranges work, but the helper/ranger composition is not generally equivalent to a full reset. |
| 655 | Closed as completed | Initial concrete Y bounds survive X zoom and data replacement with `auto: false`. |

The [review summary](scale-range-issue-review-summary.md#demo-and-regression-follow-up) records the reduced demos, their regression coverage, and remaining follow-up work.

## Issue 823: full-domain Y range

### Result

The issue is closed as completed.

A full-domain configuration is:

```js
y: {
	auto: (u, viaAutoScaleX) => viaAutoScaleX,

	scan: (u, scaleKey) => {
		return uPlot.scan(u, scaleKey, null, null, true);
	},

	range: (u, min, max) => {
		return uPlot.rangeNum(min, max, 0.1, true);
	},
}
```

The scan callback passes null indices instead of the current X window.
On cache misses, `uPlot.scan()` scans the full length of each participating data array.

The behavior is:

1. Initial setup scans the full X domain.
2. Explicit X zoom does not change Y.
3. A series toggle requests Y recalculation.
4. The custom scan ignores the current X window.
5. The newly visible series contributes its full-domain extrema.

The demo uses an identity ranger for exact bounds. It starts with `[10, 50]` and reaches `[10, 500]` after a series toggle.

`uPlot.scan()` returns one aggregate `[min, max]` tuple. With `cache: true`, it reuses non-null participating Y and mode-2 facet caches and writes cache misses directly. Mode-1 aligned X always reads its data.
The custom callback uses explicit cache mode because the built-in data extrema are its final per-series values.

## Issue 808: static range and line clipping

### Result

The issue is closed as completed.

The reduced HTML demo verifies the original boundary-stroke case without scanning.
Independent extrema scanning is a separate capability, retained in the API tests:

```js
y: {
	range: [-12, 12],
	scan: true,
}
```

The scale remains fixed at `[-12, 12]`. Initial ranging populates the series extrema.

The canvas clip rectangle expands by half the stroke width without scanning.
Historical comparison: the range-function workaround was already unnecessary for clipping before the `scale.scan` change.
The regression verifies clip expansion without `scan: true`, but it does not validate rendered pixels.

`scan: true` controls scans during scale calculation. It does not independently schedule the static scale.
Fully concrete range arrays retain the normal `auto: true` default, so default `setData()` refreshes the extrema caches.
Explicit `auto: false` prevents this implicit refresh.

## Issue 915: reset of a static Y range

### Result

The issue is closed as completed. The fix is present in source and generated JavaScript.
This repository state does not establish npm release availability.

This configuration now restores static Y after manual zoom and double-click:

```js
y: {
	range: [1, 10],
}
```

The fully concrete range array defaults to `scan: false` and retains the normal `auto: true` default.
The original report and HTML demo use mode 2 and XY drag.
The demo now has only drag and double-click, without a reset-workaround button.
`test/issue-demos.mjs` requires successful restoration of both scales.

### Implemented scheduling policy

Static range arrays no longer force `auto: false`.
The defaults give these results:

- Initial setup applies the static range without a Y scan.
- Manual Y zoom remains possible.
- Concrete X/Y bounds in the same batch remain explicit.
- Later X-only zoom, default `setData()`, default `redraw()`, and double-click restore static Y.

Explicit `auto: true`, `auto: false`, and callbacks remain effective.
Explicit `scan: true`, `scan: false`, and custom callbacks also remain effective.

This optional callback preserves manual Y during explicit X changes, default redraw, and public null/null X reset:

```js
y: {
	range: [1, 10],
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

Double-click and automatic `setData()` restore static Y without a Y scan.
This callback is not the default scheduling policy.
With explicit `auto: false`, implicit recalculation does not restore static Y. Explicit null Y bounds still request recalculation.

### Regression coverage

[test/scale-static-range.mjs](../../test/scale-static-range.mjs) passes 34 tests across both data modes:

- Default static Y resets after X zoom, `setData()`, `redraw()`, and double-click.
- Concrete X/Y batches that preserve both explicit ranges.
- Explicit `auto: true`, `auto: false`, and the reset-sensitive callback.
- No Y scan for default static ranges or the callback configuration.
- Explicit X/Y scan overrides, including custom callbacks.
- Data scanning for partial Y range arrays.

Existing asinh tests retain the static default threshold of `1`.
The issue 924 distinction between public null/null X reset and double-click remains for reset-sensitive callbacks.

## Issue 1133: dynamic backend range

### Result

The issue is closed as completed.

The Y scale keeps the default `auto: true` scheduling policy. It disables only the Y extrema scan:

```js
y: {
	// Use this callback to prevent Y auto-ranging after an explicit X range.
	// auto: (u, viaAutoScaleX) => viaAutoScaleX,
	scan: false,
	range: () => backendRange,
}
```

Update the backend range before the data:

```js
backendRange = [0, 20];
u.setData(replacementData);
```

`setData()` resets X and schedules Y. The Y scale calls `range()` without a Y extrema scan and applies the new backend bounds.

Historical comparison: automatic backend ranging through `setData()` and `redraw()` also worked in the pre-change bundle at `7074d27`.
The `scale.scan` benefit is avoiding the Y extrema scan.
The demo now has three repeatable buttons and snippets for data-only, combined backend/data, and backend-only updates.
The issue regression covers all three with unchanged X values and null ranger inputs.
The backend-only action uses `redraw()` without replacing the data.

These examples rely on default automatic scheduling.
The optional `auto` callback suppresses Y recalculation during `redraw()` as well as explicit X zoom.

Because `auto` keeps its default `true` value, an explicit X range also schedules Y. The commented callback prevents that behavior if necessary.

A `setData(data, false)` call does not reset scales. It does not call `range()`.

Concrete `setScale()` and `setRange()` bounds bypass `range()` and apply exact values. Explicit null bounds through `setScale()` request a separate recalculation.

## Issue 648: automatic reset versus explicit zoom

### Result

The issue is closed as completed.

This policy works:

```js
y: {
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

Current behavior is:

- Initial automatic X setup recalculates Y.
- `setData(data, true)` recalculates Y.
- Explicit X zoom preserves Y.
- Explicit Y zoom applies exact Y bounds.

Historical comparison: the pre-change bundle at `7074d27` also passed this reproduction. This is an existing fix, not a new `scale.scan` fix.

The revised demo uses the original `drag: {x: true, y: true, dist: 8, uni: 15}` configuration and default padded ranger.
The new HTML regression covers X-only drag after manual Y zoom, repeated redraws, double-click reset, and replacement data.
Historical comparison: the original audit also verified these behaviors in the pre-change bundle at `7074d27`.

## Issue 650: candidate extents without mutation

### Result

The issue remains open. Its accepted scope must exclude the unsupported cases before the current helper can resolve it.
The original request asks for extents as if zoom were reset, including after a hidden series becomes visible.

For an ordinary independent scale with a compatible, pure ranger, a plugin can calculate candidate bounds without changing the chart:

```js
const [dataMin, dataMax] = uPlot.scan(u, 'y');
const scaleRange = u.scales.y.range(u, dataMin, dataMax, 'y');
```

The simple API regression verifies these values:

```text
Current applied range: [15, 25]
Scanned data range:    [10, 30]
Candidate scale range: [9, 31]
Range after scan:      [15, 25]
```

The helper returns `uPlot.Range.MinMax`. Direct calls are pure unless the caller explicitly passes `cache: true`.

With `cache` omitted or false, `uPlot.scan()` is read-only. It does not change:

- Scale bounds.
- Series extrema.
- Paths.
- Layout.
- Hooks.

Singleton X expansion now occurs inside the default X ranger. Direct calls to the initialized ranger reproduce that default expansion.
Custom rangers receive raw equal extrema and control their own singleton behavior.

This helper/ranger composition still does not reproduce all automatic range calculations:

- Direct `uPlot.scan()` calls bypass custom `scale.scan` policies.
- Dependent scales use calculated parent bounds, not data directly assigned to the dependent scale.
- A range callback sees the live chart, not a simulated reset layout.

The helper is read-only by default, but an arbitrary user range callback is not necessarily pure.

`u.setRange(scaleKey, min, max)` applies concrete programmatic bounds and bypasses `scale.range()`.
`cursor.drag.setRange` can refine or cancel built-in drag bounds. It does not provide a reset-equivalent candidate-range query.

The revised demo starts with X zoomed and includes an initially hidden outlier series and default padding.
Its HTML regression compares candidate bounds with a separate full-domain reference chart.
The candidates are `[8, 32]` with Outlier hidden and `[0, 330]` with Outlier shown.

The query leaves bounds and caches unchanged. The demo explicitly distinguishes this from recalculation caused by a series toggle.

The original configuration is not detailed enough to assume that these restrictions are acceptable.
This is a functional scope gap, not merely a missing convenience method.

## Issue 655: initial concrete bounds

### Result

The issue is closed as completed.

This configuration remains stable:

```js
y: {
	auto: false,
	min: -15,
	max: 15,
}
```

The initial concrete bounds:

- Apply without `scale.range()`.
- Survive explicit X zoom.
- Survive data replacement.
- Do not prevent later explicit Y changes.

Historical comparison: the pre-change bundle at `7074d27` also passed this reproduction. The original disappearing-scale defect was already fixed.

Initial `min/max` are not permanent constraints or a stored reset target.
A configured `range` supplies bounds when recalculation is requested. Concrete explicit Y bounds still bypass it.
The reduced demo explains this distinction and uses only built-in X drag and reset.

## Required work

Issue 915's static-range reset fix and regressions are complete in source and generated JavaScript.
Issue 650 remains open and requires a scope decision or further implementation. The static-range fix does not resolve its remaining scope.

The [review summary](scale-range-issue-review-summary.md#demo-and-regression-follow-up) records the reduced demos and their HTML interaction tests.
Additional issue 823 pan/data-update coverage and real-browser stroke validation remain follow-up work.

The static-range fix was built in commit `e75c8b4`. The current working-tree bundles also contain later source changes, but those bundle files are unstaged.
This repository state does not establish npm release availability.

## Optional work

These improvements do not resolve issue 650's remaining scope gap:

- Add a named scale recalculation method.
- Add a general interceptor for programmatic explicit bounds, if that contract is required.

`cursor.drag.setRange` already provides clamp, snap, and cancellation behavior for built-in drag zoom only.

A complete candidate-range calculation API is not automatically optional for issue 650. Its necessity depends on the accepted scope.

## Latest validation

Current working-tree validation reports:

- Full Node suite (`npm test`): **1,011 passing**.
- Focused five-file scale-range command: **74 passing**.
- Static-range suite: **34 passing** across both modes.
- Cursor-drag and range-policy suites: **50 passing**.

The focused five-file command includes static-range, range-policy, issue, HTML demo, and asinh tests.
The TypeScript checks were not repeated because this checkout does not have `tsc` installed.

Current declarations include `Scale.scan`, static `uPlot.scan`, `u.setRange()`, and `cursor.drag.setRange`.
Historical validation reported that the TypeScript consumer passed with `skipLibCheck` and that the `DateZoned` declaration issue remained.

Historical demo validation checked all seven HTML scripts, snippet syntax, indentation, whitespace, and documentation links.
The historical audit reviewed the seven issue discussions available at that time and compared targeted cases with pre-change `7074d27`.
Current tests include the original issue 648 and 915 mouse interactions and issue 650's independent reference chart.
Issue 915 tests require successful reset.

Real-browser pixel validation remains pending.
