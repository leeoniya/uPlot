# Changelog

Release notes for 1.6.32 and earlier are on [GitHub Releases](https://github.com/leeoniya/uPlot/releases).

## Unreleased (1.7.0)

This is a large release. Read [Breaking Changes](#breaking-changes) and the [Migration Guide](#migration-guide) before upgrading.

### Highlights

- **Built-in stacking** through `opts.stack`. It supports line, area, and bar stacks, independent positive and negative stacks, and percent normalization. Bands and bar baselines are generated automatically, and legends show the raw values.
- **New legend renderer.** A self-contained keyed DOM renderer replaces the old legend. It has much less allocation churn during hover, and it skips work when nothing is hovered. (#1144, #1145)
- **Optional DOM** for sparkline-heavy pages. `opts.dom` can omit `.u-over`, `.u-under`, and even the `.uplot` wrapper, which makes the canvas the root. When there is no title or legend, the root also serves as `.u-wrap`. See [Optional DOM](docs/README.md#optional-dom).
- **Rewritten DST and time zone handling** (#1072). `uPlot.tzDate()` accepts ms timestamps and returns a `DateZoned`. New `axis.nice` options control calendar alignment.
- **Non-iterative axis layout.** A fixed, height-first layout order replaces the size and padding convergence cycles. See [Axis Layout & Padding](docs/README.md#axis-layout--padding).
- **New ranging and zoom APIs:** `u.setRange()`, `cursor.drag.setRange`, `scale.scan`, and `uPlot.scan()`.
- **Drag selection continues outside the plot area.** The zoom box keeps following and clamping when the mouse leaves `.u-over`. (#1126)
- **Memory control** through `opts.cache` and `u.clearCache()`.
- **Device pixel ratio control** through `opts.pxRatio`, `u.pxRatio`, and `u.setPxRatio()`. (#20)

### Added

- `opts.stack: {groups: [{series, dir}], percent?}` adds cumulative stacking.
- `opts.dom: {uplot?, over?, under?}` and `axes[i].dom` control which DOM elements are created.
- `opts.cache: {paths?, data?}` selects the caches to keep after rendering. `u.clearCache(targets?)` frees path and data caches on demand.
- `opts.pxRatio`, `u.pxRatio`, and `u.setPxRatio(ratio?)` set a pixel ratio that differs from `window.devicePixelRatio`.
- `opts.ctxAttrs` passes attributes through to `canvas.getContext('2d', attrs)`.
- `u.setRange(scaleKey, min, max)` sets concrete scale bounds and skips `scale.range()`.
- `cursor.drag.setRange` accepts a boolean or a callback `(u, scaleKey, min, max) => [min, max] | null`. The callback can snap or refine drag-zoom bounds, or return `null` to cancel the change for that scale.
- `scale.scan` (boolean or callback) controls how data extrema are computed for `range()`. `uPlot.scan(u, scaleKey, i0?, i1?, cache?)` exposes the built-in scanner.
- `Range.Config.zeroIf` sets the zero-affinity threshold, as a fraction of the data range. `Range.Config.flat` sets the threshold for flat ranges. See [Numeric Range Policy](docs/README.md#numeric-range-policy).
- Experimental tick-aware ranging through `scale.axis`, with `axis.ramp` and `axis.exact`. Endpoint ticks line up across independent linear Y scales, including horizontal ones (e.g. horizontal bars), and scale padding is supported. These scales are ranged during layout, once the plot dimension is known.
- Scales with `scale.asinh` get an adaptive linear threshold by default. `scale.asinh` also accepts a callback.
- `axis.nice: {dst?, first?}` controls calendar adjustments for time axes. `first: true` restores month-start ticks for multi-day increments.
- `series.alignGaps` (`-1 | 0 | 1`) controls how interpolation is cleared around null regions. (#1100, #1101)
- `uPlot.numDec(splits)` returns the number of decimal places a set of splits needs, for use in custom formatters.
- `u.uid` provides a unique instance id for debugging.
- `uPlot.DateZoned` type. `uPlot.tzDate(dateOrTs, tz)` accepts timestamps.
- Visual regression and unit test suite (`npm test`, `npm run test:update`) and a legend benchmark (`npm run bench:legend`).
- Many new demos: bars (grouped, stacked, horizontal, value labels), stacking, decimation, outliers, log time axis, mass spectrum, axis ranging policies, soft and hard limits, label rotation, and comparison benchmarks with d3, ECharts, and Chart.js.

### Changed

- Default numeric Y ranging now uses `zeroIf: 0.1` instead of the implicit `soft: 0, mode: 3`. Bounds can differ slightly from 1.6.x.
- Time axes no longer force a tick at the start of each month for multi-day increments (`axis.nice.first` defaults to `false`). As a result, a tick near the end of a month is no longer skipped. Set `nice: {first: true}` for the previous behavior.
- Fewer approximate ticks are drawn at small plot heights, and tick formatters now account for decimal places.
- Draw layers were reordered so that fills no longer bleed into band strokes.
- Expanding a single-point (flat) X range now happens inside the X ranging function, as it already did for Y scales.
- A static `range: [min, max]` no longer implies `auto: false`. It defaults to `scan: false`, so the range can be reset after an explicit zoom.
- The `setSize` hook also fires when plot geometry or axes change, not only when the chart is resized. Identical `setSize()` or `setPxRatio()` calls do nothing.
- `batch()` completes any pending layout synchronously before it returns.
- Cursor hover points now line up exactly with the markers drawn on the canvas. (#1108, #779)
- `Intl.NumberFormat` uses the implicit locale. (#1054)
- The `ready` hook fires at the correct point in initialization.
- Text is measured on a temporary canvas.
- Performance: `uPlot.join()` is 1.2x–1.6x faster, redraws reuse cached extrema, hovering nulls only scans data in the viewport, and paths are not built when there is no data.

### Fixed

- `uPlot.rangeLog()` handled partial magnitudes incorrectly. (#1052)
- An arbitrary `min` could not be set on log scales. (#1098)
- A stray `splits.push()` after a loop exit. (#1103)
- Decimal precision issues in tick generation. The internal `fixFloat` was removed.
- A "Maximum call stack size exceeded" error with very large numbers of gaps.
- The stepped and spline path builders did not check `hasGap`.
- Zero-height bars were rendered. Bar corner radii were misplaced on reversed scales and on nonzero baselines.
- Tiny-delta linear scale ranges now fall back to a flat range.
- `-0` translations.
- Axis split generation could loop without advancing.
- Typings: `setScale` accepts `null` bounds (#1097), the `setSeries` hook receives `{show?, focus?}` (#1106), and `MouseListener` returns `void` (#1047).

### Breaking Changes

| Area | Change |
| --- | --- |
| Range config | `Range.SoftMode` and `Range.Limit.mode` were removed. `Range.Config.min` and `max` are now optional. |
| Axis size callback | The signature is now `(self, values: StaticValues \| null, axisIdx)`. `cycleNum` was removed. Horizontal axes receive `null` before ticks are computed. |
| Padding callback | The 4th argument is now `phase: PaddingPhase` (`0` = Layout, `1` = Overflow) instead of `cycleNum`. |
| DOM | `u.over`, `u.under`, and `u.rect` can be `null`. When a chart has no title or legend, `.u-wrap` is the root itself, so `u.root.querySelector('.u-wrap')` returns `null`. |
| Time zones | `uPlot.tzDate()` and `opts.tzDate` now return `DateZoned`. Custom `tzDate` implementations should return the same type. |
| Ranging defaults | The implicit `soft: 0, mode: 3` default is gone. `zeroIf: 0.1` replaces it. |
| Time ticks | Month-start ticks for multi-day increments are now opt-in (`axis.nice.first`). |
| Drag zoom | Drag zoom now goes through `setRange`, which does **not** call `scale.range()`. Code that relied on `range()` to refine drag bounds must use `cursor.drag.setRange`. |
| Series min/max | `series.min` and `series.max` are now cached data extrema (they can be `null`), not the current rendered values. |
| Static ranges | A `range: [min, max]` array no longer forces `auto: false`. |
| TypeScript | `uPlot.d.ts` now uses `export default uPlot` instead of `export = uPlot`. |
| TypeScript | `u.syncRect` is now optional in the typings. At runtime it has only been defined on cursor-enabled charts since 1.6.23; `dom.over: false` now also disables the cursor. |
| Package | `package.json` now sets `"type": "module"`. |

### Deprecations

| Deprecated | Replacement |
| --- | --- |
| `cursor.drag.setScale` | `cursor.drag.setRange` |
| `series.auto` | `series.scan` |
| `series.facets[i].auto` | `series.facets[i].scan` |

## Migration Guide

### Soft limits and `mode`

| Before | After |
| --- | --- |
| `mode: 0` | Remove `mode`, and omit `soft` (or set `soft: null`). To also stop zero anchoring, set `zeroIf: 0`. |
| `mode: 1` | Remove `mode` and keep `soft`. |
| `mode: 2` or `mode: 3` with a nonzero `soft` | There is no direct equivalent. Use a custom `range` function. |
| Default `soft: 0, mode: 3` | Remove both. The default `zeroIf: 0.1` replaces them. |

```js
// before
range: { min: { soft: 0, mode: 2, pad: 0.1 }, max: { soft: 100, mode: 1 } }

// after
range: { min: { pad: 0.1 }, max: { soft: 100 }, zeroIf: 0.1 }
```

An explicit `soft: 0` now always anchors at zero whenever the data stays on that side of zero, no matter how far away the data is. Details are in [Soft-limit Migration](docs/README.md#soft-limit-migration).

### Drag zoom refinement

1.6.x applied drag bounds through `setScale`, which ran `scale.range()`. Some code used `range()` to snap the zoomed bounds. Drag zoom now bypasses `range()`, so move that logic to `cursor.drag.setRange`:

```js
// before
cursor: { drag: { setScale: true } },
scales: { x: { range: (u, min, max) => [Math.floor(min / 10) * 10, Math.ceil(max / 10) * 10] } },

// after
cursor: {
  drag: {
    setRange: (u, scaleKey, min, max) => scaleKey == "x"
      ? [Math.floor(min / 10) * 10, Math.ceil(max / 10) * 10]
      : [min, max],
  },
},
```

`drag.setScale: false` becomes `drag.setRange: false`. To set concrete bounds from code without running `range()`, use `u.setRange(key, min, max)`. `u.setScale(key, {min, max})` still works, and `null` bounds now request auto-ranging.

### `series.auto` → `series.scan`

```js
// before
series: [{}, { auto: false }]

// after
series: [{}, { scan: false }]
```

`scale.auto` still controls whether a scale re-ranges automatically. `scale.scan` controls how the data is scanned to find extrema.

### Axis `size` and `padding` callbacks

```js
// before
size: (u, values, axisIdx, cycleNum) => { if (cycleNum > 1) return u.axes[axisIdx]._size; ... }
padding: [null, (u, side, sidesWithAxes, cycleNum) => ..., null, null]

// after
size: (u, values, axisIdx) => values == null ? 30 : measure(values)  // null = horizontal axis, before ticks
padding: [null, (u, side, sidesWithAxes, phase) => phase == 1 ? overflowPad : basePad, null, null]
```

Remove convergence guards. Each callback runs once per layout pass. Padding callbacks return the total padding, not a delta. See [Axis Layout & Padding](docs/README.md#axis-layout--padding) and the [axis autosize demo](demos/axis-autosize.html).

### Nullable DOM

When using `opts.dom` (or a chart with no title or legend), guard any access to `u.over`, `u.under`, `u.rect`, and `.u-wrap`. `u.syncRect` is missing whenever the cursor is disabled (including via `dom.over: false`), and is now optional in the typings:

```js
const wrap = u.root.matches(".u-wrap") ? u.root : u.root.querySelector(".u-wrap");
u.over?.addEventListener("click", onClick);
u.syncRect?.();
```

### Time axes

To keep the 1.6.x month-start tick behavior:

```js
axes: [{ nice: { first: true } }]
```

Custom `opts.tzDate` functions should return a `uPlot.DateZoned`. The simplest way is `ts => uPlot.tzDate(ts, tzName)`.

### Stacking

Remove the `demos/stack.js` helper (manual cumulative data, bands, and value overrides) and declare stack groups instead. Pass raw data; legends show the raw values.

```js
new uPlot({
  ...opts,
  stack: { groups: [{ series: [1, 2, 3], dir: 1 }] }, // dir: 0 for bars (split by sign)
}, rawData, el);
```

### TypeScript

`uPlot.d.ts` now uses a default export:

```ts
// before
import uPlot = require("uplot");

// after
import uPlot from "uplot";
```

### Memory-constrained charts

For static sparklines, free memory after rendering:

```js
{ cache: { paths: false, data: false }, dom: { uplot: false }, legend: { show: false } }
```

Data disposal is only for non-interactive charts. See [Cache Retention](docs/README.md#cache-retention).
