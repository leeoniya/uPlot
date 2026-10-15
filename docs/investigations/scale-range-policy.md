# Scale Range Policy

## Status

This document describes the Policy B scale-range model.

The implementation separates automatic recalculation from data scanning. It also applies one range policy to X and Y scales.

## Scale controls

`scale.auto`, `scale.scan`, and `scale.range` now have separate purposes.

| Control | Purpose |
| --- | --- |
| `scale.auto` | Controls implicit recalculation after data or X-scale changes. |
| `scale.scan` | Controls the data scan for minimum and maximum values during recalculation. |
| `scale.range` | Derives calculated bounds from the scanned values. |

`scale.scan` accepts a boolean or callback. For fully concrete range arrays, an omitted `scan` defaults to false. Other ranges retain the existing data-driven scan defaults.

The public callback contract receives `(self, scaleKey, i0, i1)` and returns one aggregate `[min, max]` tuple. It runs once for each calculated independent scale.

`u.setRange(scaleKey, min, max)` sets scale bounds. Concrete bounds bypass `scale.range()`, while null bounds request calculation.
`u.setScale(scaleKey, {min, max})` is the object-form API with the same bound rules.

## Static range arrays

A fully concrete `range: [min, max]` array defaults to `scan: false`. It keeps the standard `auto: true` default.
The array does not override an explicit `auto: false`, `auto: true`, or `auto` callback.
It also respects explicit `scan: true`, `scan: false`, and custom scan callbacks.

With the defaults, double-click restores a manually zoomed Y scale to its configured static range.
A later X-only zoom, default `setData()`, or default `redraw()` also restores that static Y range.
Concrete X and Y bounds in the same batch remain explicit. The static range does not replace the explicit Y bounds in that batch.

With explicit `auto: false`, implicit recalculation does not restore the range. Explicit null bounds can still request recalculation.
An `auto` callback controls scheduling by its return value, as it does for other ranges.
With explicit `scan: true`, default `setData()` refreshes the static scale's extrema. Explicit `auto: false` disables this implicit refresh.

This configuration preserves manual Y bounds during explicit X changes, default `redraw()`, and public null/null X reset:

```js
y: {
	range: [1, 10],
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

Double-click and automatic `setData()` restore the static Y range without a Y data scan.
This callback is optional. The default remains `auto: true`.

Static asinh scales retain their default threshold of `1`.
Partial Y range arrays still scan data. This change does not expand support for partial X range arrays.

## Bound rules

For requested bounds, a concrete bound is explicit. A null bound is calculated.
At runtime, JavaScript also treats an omitted or `undefined` bound as calculated.
The TypeScript `setRange()` and `setScale()` contracts accept `number | null`. They do not expose `undefined` as a supported bound type.
These rules describe bound requests, not new support for partial X `scale.range` arrays.

| Minimum | Maximum | Result |
| --- | --- | --- |
| Concrete | Concrete | Both bounds are explicit. `scale.range()` does not run. |
| Concrete | Null or undefined | The minimum stays exact. The maximum comes from `scale.range()`. |
| Null or undefined | Concrete | The minimum comes from `scale.range()`. The maximum stays exact. |
| Null or undefined | Null or undefined | Both bounds come from `scale.range()`. |

For a partial range, `scale.range()` receives the scanned data minimum and maximum. The implementation then restores the explicit side.

If the calculated side crosses the explicit side, uPlot rejects the update. The previous valid range remains active.


## Automatic and explicit X ranges

Automatic X bounds are calculated bounds. Therefore, automatic X bounds pass through `scale.range()`.
The scanner passes raw X extrema to the ranger. Default X rangers expand equal extrema for singleton or repeated X values.
Custom X rangers receive equal extrema unchanged and control their own expansion.

The following operations calculate the X range:

- Initial automatic scale setup.
- `setData()` when X autoscaling is active.
- Double-click scale reset.
- `setScale('x', {min: null, max: null})` or `setRange('x', null, null)`.
- A partial X range with one null bound.

The following operations use explicit X bounds:

- Public `setScale()` calls with two concrete bounds.
- Public `setRange()` calls with two concrete bounds.
- Cursor drag zoom.
- Internal redraw operations that preserve the current X bounds.

Explicit X bounds bypass `scale.range()`. This rule matches the Y-scale rule.

`cursor.drag.setRange` controls built-in drag zoom. Its callback receives `(self, scaleKey, min, max)`, with ordered candidate bounds for each changed independent scale.
It can return an adjusted `[min, max]` tuple or `null` to cancel that scale change. Programmatic, automatic, redraw, and double-click operations do not call it.

## Scanning behavior

`scale.scan` selects the scanner used during scale calculation. Series and facet `scan` flags control data participation.

For independent Y scales, `scan: true` uses the current visible indices. It updates participating extrema caches and returns their aggregate.
Built-in aligned X calculation scans the full X domain before it calls `scale.range()`.

The public `uPlot.scan(self, scaleKey, i0?, i1?, cache?)` helper returns one aggregate `[min, max]` tuple. Omitted indices select each full data array. The default `cache: false` performs a pure scan that neither reads nor writes extrema caches.

With `cache: true`, existing non-null participating Y and mode-2 facet caches are authoritative. The helper scans and stores extrema only for cache misses.
The supplied indices select data for those cache misses; they do not constrain existing caches. Mode-1 aligned X always reads its data.

This callback scans and caches the full domain:

```js
scan: (u, scaleKey) => uPlot.scan(u, scaleKey, null, null, true)
```

This callback scans and caches the current visible window:

```js
scan: (u, scaleKey, i0, i1) => uPlot.scan(u, scaleKey, i0, i1, true)
```

A custom `scale.scan` callback must populate the final extrema caches of every participating series or facet. Calling `uPlot.scan()` with `cache: true` satisfies this requirement only when the built-in data extrema are the callback's final per-series values.

If `scale.scan` is false, `scale.range()` can still run. In this case, the calculated data bounds are null.

If `scale.auto` is false, uPlot does not schedule implicit recalculation. A public call with null bounds can still request recalculation.

For example, this scale does not change after `setData()`:

```js
{
	auto: false,
	scan: true,
}
```

This call requests a new scan and range calculation:

```js
u.setScale('y', {min: null, max: null});
```

## Redraw and extrema caches

`redraw()` and `redraw(true, true)` rebuild series paths and retain the current X bounds. Automatic scale scheduling, scanner callbacks, and range callbacks still run.

For unchanged data and a valid cache, the built-in Y scanner aggregates cached extrema without reading data values again. Custom scanners still control their own data access. Empty caches remain cache misses.

A redraw does not replace an existing pending X request. Data updates, zooms, and automatic resets retain their normal invalidation behavior when they share a commit with redraw.

An X request can leave a Y scale uncalculated because its bounds are explicit or its `auto` callback suppresses recalculation. The private `redrawDirty` set records these deferred invalidations without immediately discarding public extrema caches. A later redraw clears the affected caches before recalculating that scale. This preserves custom full-domain caches while automatic recalculation remains suppressed.

`setData()` invalidates extrema even with `resetScales: false`. After an in-place data change, callers must still call `setData()`. Mutating data and calling only `redraw()` is unsupported.

`redraw(false, true)` remains an axes-and-layout refresh without scale processing. `redraw(false, false)` retains cached paths unless other pending work invalidates them.

## Empty data

With empty data, a custom scan callback runs once with undefined indices. Boolean and default scans produce null extrema.

The default range returns null bounds. As a result, automatic X and Y axes become inactive with empty data.

Fully concrete bounds still bypass `scale.range()` with empty data. Partial bounds preserve their explicit side after the callback runs.

## Ordinal and faceted data

Ordinal X conversion applies only to concrete bounds. A null bound does not pass through `closestIdx()`.

The partial-bound rules also apply in mode 2. Each faceted scale scans its data and preserves its explicit side.

Dependent scales keep their existing behavior. Their `scale.range()` callback receives the final bounds of the base scale.

## Compatibility effects

The new X behavior affects demos that used `scale.range()` to modify explicit zoom bounds. These demos now share their range policy with `cursor.drag.setRange` to preserve the intended built-in drag behavior.

### `demos/trendlines.js`

This demo uses one X-range helper for automatic ranges and built-in drag zoom. The drag callback restores snapping to exact data values without routing explicit bounds through `scale.range()`.

### `demos/grouped-bars.js`

The X-range helper always returns the full category range. The drag callback uses that helper to prevent built-in X drag zoom, as the old `scale.range()` behavior did.

### `demos/bars-values-autosize.html`

The X-range helper adds `0.5` of padding to both sides. Both chart configurations use the helper for automatic ranges and built-in drag zoom.

### Empty-data layout

Aligned empty data previously retained the old X range while the automatic Y range became null. Both automatic ranges now become null.

`test/layout.mjs` records the new uniform behavior. Both automatic axis reservations disappear until data returns.

This separation is intentional. Use `cursor.drag.setRange` to clamp, snap, or reject bounds from built-in drag zoom.
Programmatic `setScale()` and `setRange()` calls with two concrete bounds bypass both `scale.range()` and `cursor.drag.setRange`. Callers must adjust explicit bounds before those calls.

## Implementation

The main implementation is in `src/uPlot.js`.

- Pending requests contain `{min, max}`. Internal redraw-only requests also carry `redraw: true`.
- `redrawDirty` records deferred cache invalidation after X requests. Scale-specific or full extrema resets clear the corresponding entries.
- `isFullyExplicit()` and `isFullyImplicit()` classify pending requests.
- `applyCalculatedRange()` restores explicit sides and rejects crossed partial ranges.
- `resetAutoScaleXIdxs()` resets aligned X indices before automatic X calculation.
- `setRange()` normalizes bounds and handles public and internal requests.
- `setScale()` is the object-form wrapper around `setRange()`.
- `scanScaleInternal()` performs pure or cache-aware scanning and returns one scale aggregate.
- `scanCached()` handles cached independent scans. `scanCachedX()` handles full-domain aligned X scans.
- `setDragScale()` applies `cursor.drag.setRange` before it calls `setRange()`.
- Custom scanners return an aggregate and own their participating extrema caches.

The public TypeScript contract is in `dist/uPlot.d.ts`.
It includes `Scale.scan`, static `uPlot.scan`, `u.setRange()`, and `cursor.drag.setRange`.
The declaration names the second `Scale.Auto` callback argument `resetScales`; runtime behavior and these documents use `viaAutoScaleX`.

The static-range fix is present in generated JavaScript. Commit `e75c8b4` changed source, declarations, tests, and all generated bundles.
The current working-tree bundles also contain later source changes, but those bundle files are unstaged. This state does not establish npm release availability.

## Tests

`test/scale-scan.mjs` covers the scan matrix:

- `auto: true` with the default scan value.
- `auto: false` with the default scan value.
- `auto: false` with `scan: true`.
- `auto: true` with `scan: false`.
- Explicit recalculation when automatic recalculation is off.
- Once-per-scale callback invocation.
- Explicitly caching public scanner callbacks.
- Full and indexed aggregate scans.
- Pure public scans and explicit cache mutation.
- Cache reuse independent of the rendered index window.
- Distinct faceted extrema and logarithmic data.
- Empty data.

`test/scale-range-policy.mjs` covers the range policy:

- Concrete X and Y bounds.
- Null and runtime-undefined bounds.
- Partial bounds on each side.
- Crossed partial ranges.
- Initial and `setData()` X autoscaling.
- Explicit X zoom.
- Concrete and null `setRange()` bounds on X and Y, with `auto: true` and `auto: false`.
- Double-click reset.
- Empty data.
- Ordinal X data.
- Faceted Y data.

[test/scale-static-range.mjs](../../test/scale-static-range.mjs) covers static ranges with 34 tests across both data modes:

- Default static Y restoration after X zoom, `setData()`, `redraw()`, and double-click.
- Concrete X/Y batches that preserve both explicit ranges.
- Explicit `auto: true`, `auto: false`, and callback scheduling.
- Callback preservation of manual Y during explicit X changes, redraw, and public null/null X reset.
- Callback restoration of static Y after double-click and automatic `setData()`, without a Y scan.
- Explicit X/Y scan overrides, including custom callbacks.
- Data scanning for partial Y range arrays.

`test/scale-x-range.mjs` covers singleton X ranges, raw custom-ranger inputs, partial bounds, custom scans, and empty data.
`test/scale-scan-cost.mjs` covers scan cost, sorted endpoints, and full-domain aligned X calculation.
`test/redraw-scan.mjs` covers redraw cache reuse, callback refresh, deferred invalidation, pending requests, notified data changes, and ordinal bounds.
`test/cursor-drag.mjs` covers drag-bound refinement, cancellation, synchronization, and callback scope.

The existing asinh tests retain the static default threshold of `1`.
`test/layout.mjs` covers the empty-data layout behavior.

## Latest validation results

Current working-tree validation reports:

- Full Node suite (`npm test`): **1,011 passing**.
- Focused five-file scale-range command: **74 passing**.
- Static-range suite alone: **34 passing** across both modes.
- Cursor-drag and range-policy suites: **50 passing**.

The focused five-file command includes static-range, range-policy, issue, HTML demo, and asinh tests.
The TypeScript checks were not repeated because this checkout does not have `tsc` installed.
