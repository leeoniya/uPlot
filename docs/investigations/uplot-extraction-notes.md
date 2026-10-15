# Low-state extraction candidates in uPlot.js

## Scope and source basis

This assessment covers the working-tree [src/uPlot.js](../../src/uPlot.js) as audited on 2026-09-17.
The repository `HEAD` was `e27e4092cfc67c7c57d7b7e1c39a08fae1cfb143` from 2026-09-17.
The source file had uncommitted changes and the Git blob ID `feb327c5065eb593bca5f7e027cfb1f8c778fa30`.

The prior assessment used commit `9e66c19e6a77b2a429893b3a939f73a2914d047b` from 2026-09-13.
The current file has 3,728 lines, compared with 3,550 lines at that commit.
The working-tree diff from that commit has 582 insertions and 404 deletions.

All line references below use the audited working-tree blob, not `9e66c19` or `HEAD` alone.
The assessment includes no extraction, test result, or benchmark result.

The goal remains a smaller main file without a large shared-state interface.
A useful extraction keeps an existing callback signature or captures a few stable values once per chart.

Line counts are approximate and include comments and whitespace.
They describe moved code, not net bundle or source reductions after imports and call sites.

## Changes since the commit-9e66c19 assessment

- Scale scanning is now a top-level subsystem at lines 296–394.
  It replaces the old 13-line `accScale()` boundary and exposes `uPlot.scan` at line 3700.
- The old scale-accumulation candidate is therefore obsolete.
  The new subsystem is a stronger module boundary and appears below.
- Layout no longer uses the old convergence loop.
  `updateLayout()` now coordinates phased padding, axis sizing, and canvas updates at lines 959–1020.
- `paddingCalc()` is now only five lines at 2006–2010.
  It is no longer a useful extraction candidate by itself.
- Canvas cache invalidation moved into `setCanvasSize()` at lines 2287–2290.
  It occurs only when the canvas backing store resets.
- `snapTimeX()` is now distinct from `snapNumX()` at lines 481–495.
  It captures only the stable `ms` value.
- Partial and static scale ranges added new scan strategies and range-resolution rules.
  The initial-scale candidate must preserve those rules.

## Candidate summary

| Candidate | Current source lines | Required instance state | Approximate lines moved | Feasibility |
|---|---|---|---:|---|
| Scale scanning subsystem | 296–394 | Existing `self` argument | 99 | High |
| Defaults, range callbacks, increment selection, and font helpers | 220–294, 481–495 | `ms` only for the time-range factory | 90 | High |
| Position helpers | 418–430 | None | 13 | High |
| Calculated-range helpers | 675–698 | Current scale or its prior bounds | 24 | High |
| Mouse listener registry | 858–882 | `self`, `cursor`, and a private map | 25 | High, with small benefit |
| `autoPadSide()` | 1362–1374 | None beyond existing arguments | 13 | High |
| Initial scale setup | 518–624 | `self`, `opts`, `xScaleKey`, `mode`, and `snapTimeX` | 107 | Medium |
| Canvas painter factory | 1464–1497, 1854–1917, 1935–1970 | `ctx`, `pxAlign`, and private caches | 134 | Medium |

Ordinary module imports do not count as instance state in this table.
The proposed interfaces are internal unless the current API already exposes the function.

## 1. Scale scanning subsystem

Lines 296–394 already form one top-level subsystem:

- `scanScaleInternal()` owns traversal and optional cache mutation.
- `scanScale()` is the public scanner assigned to `uPlot.scan`.
- `scanCached()`, `scanCachedX()`, `scanNone()`, and `scanAuto()` are internal scale strategies.

A module can keep `scanScaleInternal()` private and export the five current entry points.
The imports in `uPlot.js` can keep the same function objects:

```js
import {
  scanScale,
  scanCached,
  scanCachedX,
  scanNone,
  scanAuto,
} from './scaleScan.js';
```

This identity is significant.
`setScales()` compares `wsc.scan` with `scanAuto` and `scanCached` at line 1581.
Do not wrap those imports at their call sites.

The subsystem reads `self._data`, `self.series`, `self.scales`, and `self.mode`.
Cached scans also update facet bounds and mirrored series bounds.
Its other dependencies are numeric and range utilities.

This candidate has a clear interface and direct regression coverage.
It is the best first module extraction in the current tree.

### Constraints

- Keep the public `uPlot.scan(self, scaleKey, i0, i1, cache)` signature and default cache behavior.
- Preserve clamping and defaulting of each data array's index range.
- Preserve positive-only scanning for logarithmic scales.
- Preserve visibility, `scan`, scale-key, and facet filters.
- Preserve the distinction between pure scans and cached scans.
- Preserve function identity for the internal scan strategies.

## 2. Existing independent helpers

The following functions already sit outside the constructor:

- Default helpers at 220–231: `setDefault()`, `setDefaults()`, and `setDefaults2()`.
- Numeric range callbacks at 233–259, including the logarithmic and asinh aliases.
- Increment selection at 261–278: `findIncr()`.
- Font helpers at 280–294: `pxRatioFont()` and `syncFontSize()`.

They can move with their current signatures.
Their dependencies are imports and explicit arguments.
Some helpers mutate objects, so constructor independence does not imply purity.

The nested `snapTimeX()` at 481–495 now needs only `ms` from its closure.
A factory preserves the callback signature used by scales:

```js
const snapTimeX = makeSnapTimeX(ms);
```

Keep these helpers in purpose-based modules.
Do not create one file for every small function or one unrelated utility collection.

### Constraints

- Preserve all callback arguments, including arguments that current implementations do not use.
- Preserve the equal-value behavior for numeric, ordinal, time, logarithmic, and asinh X scales.
- Preserve the shared `fixedDec` map used by increment selection.
- Preserve current font mutation and rounding behavior.
- Do not combine extraction with range or precision algorithm changes.

## 3. Small stateless nested helpers

The position helpers at 418–430 use only their arguments:

- `getHPos()`
- `getVPos()`
- `getPos()`

`self.valToPosH` and `self.valToPosV` expose the first two functions.
Keep those assignments and the current function identities.

`autoPadSide()` at 1362–1374 also uses only its arguments and imported axis defaults.
The padding call now supplies a fourth `phase` argument, but `autoPadSide()` intentionally ignores it.

These helpers have very low extraction risk.
Their small size makes them useful only in a coherent position, layout, or axis module.

## 4. Calculated-range helpers

Lines 675–698 contain two predicates and `applyCalculatedRange()`.
The first two functions depend only on their arguments.
`applyCalculatedRange()` mutates a work scale and reads prior bounds from `scales[key]` in one branch.

That hidden read can become an explicit argument:

```js
applyCalculatedRange(workScale, pendingScale, minMax, currentScale);
```

The helper must retain the current bounds when one explicit limit creates an inverted range.
For all other cases, it applies the explicit or calculated limit to the work scale.

This boundary is small, but it isolates policy that now appears in three scale-update paths.
It fits a scale-range module better than a general utility module.

## 5. Initial scale setup

`initValToPct()`, `initScale()`, and the initialization passes occupy lines 518–624.
They still form one startup operation, but their dependencies increased since `9e66c19`.

A possible entry point is:

```js
initScales(self, opts, xScaleKey, mode, snapTimeX);
```

Before this call, the constructor creates `self.series`, `self.axes`, and `self.scales`.
The helper uses those live objects and mutates `self.scales`.
It does not need a general constructor-state object.

The module also needs scale defaults, feature flags, range utilities, and scan strategies.
`initValToPct()` captures `self` for custom logarithmic clamps and keeps each scale object live.

This extraction remains feasible, but it has medium risk.
Scale initialization now defines static-range scan defaults, dynamic `asinh`, and dependent-scale behavior.

### Constraints

- Preserve recursive initialization of dependent scales.
- Preserve default scale selection and `mode: 2` behavior.
- Preserve initialization order for default, series, axis, and configured scales.
- Preserve `scan` values of `null`, `true`, `false`, and custom functions.
- Preserve the no-scan default for fully static range arrays.
- Preserve partial range-array conversion to range configuration objects.
- Preserve the `asinh` default for static ranges and `auto: false`.
- Keep scale objects live inside conversion callbacks.
- Keep the facet-initialization TODO unchanged.

## 6. Canvas painter factory

The following sections share a small set of stable inputs:

| Section | Current source lines |
|---|---|
| Style caches, `setCtxStyle()`, and `setFontStyle()` | 1464–1497 |
| `strokeFill()`, `doStroke()`, and `doFill()` | 1854–1917 |
| `drawOrthoLines()` | 1935–1970 |

A possible interface is:

```js
const {
  setCtxStyle,
  setFontStyle,
  strokeFill,
  drawOrthoLines,
  invalidate,
} = createCanvasPainter(ctx, pxAlign);
```

Both `ctx` and `pxAlign` remain constant for a chart instance.
The factory owns the style caches instead of passing them through each call.
`doStroke()` and `doFill()` remain private inside the factory.

### Constraints

- Create one painter per chart.
- Keep scalar arguments for drawing operations.
- Do not allocate a new state object for each path, tick, or text line.
- Keep both style setters and the Map-aware drawing helpers together.
- Replace the cache reset at 2288 with `invalidate()` inside the existing `reset` branch.
- Do not invalidate the painter for a layout pass that keeps the canvas backing store.
- Leave `ctxAlpha` in the main closure because series drawing manages it separately.
- Preserve style-change order and canvas `save()` and `restore()` order.
- Preserve the existing requirement that callbacks restore direct changes to `self.ctx` state.

The factory does not need `pxRatio`.
Unlike `pxAlign`, `pxRatio` can change during the chart lifetime.
Extraction alone does not prove a performance or bundle-size improvement.

## 7. Mouse listener registry

The listener map and `onMouse()` and `offMouse()` functions occupy lines 858–882.
They form a small factory:

```js
const { onMouse, offMouse, clearRegistry } =
  createMouseListeners(self, cursor);
```

The map stays private.
Only the chart and cursor references cross the boundary.
The current `mouseListeners.clear()` call in `destroy()` becomes `clearRegistry()`.

### Constraints

- Read `cursor.bind[ev]` when each listener is bound.
- Preserve listener replacement and event-target behavior.
- Preserve the unused `fn` parameter of `offMouse()` unless a separate cleanup change removes it.
- Preserve current destruction behavior.
  Registry clearing does not call `off()` for every registered target.
- Do not combine this extraction with listener-lifecycle changes.

This boundary is clean, but it moves only about 25 lines.

## Secondary candidates

These helpers remain feasible, but their benefit is smaller or their interfaces need many values.

| Candidate | Current source lines | Possible interface or boundary | Caveat |
|---|---|---|---|
| Outer data indices | 1692–1704 | `getOuterIdxs(ydata, i0, i1, dataLen)` | Pass current indices and length, not initial values |
| Increment spacing | 1919–1933 | `getIncrSpace(self, axis, axisIdx, min, max, fullDim)` | Mutates axis caches and calls user callbacks |
| Tick-label drawing loop | 2108–2135 | One helper for the complete loop | Needs context, values, offsets, orientation, position, angle, and line height |

For tick labels, the complete loop is a better boundary than one call per text line.
The multiline offset and rotation order must remain unchanged.

The prior padding-calculation entry is removed because the current helper is only five lines.
The prior scale-accumulation entry is replaced by the scale scanning subsystem in section 1.

## Sections to leave in the main closure

These sections coordinate too much live state for a cheap extraction:

- Layout orchestration at 912–1053, especially `updateLayout()`.
- `setScales()` at 1505–1690.
- The main `drawSeries()` and `drawAxesGrid()` orchestration.
- Commit scheduling and `_commit()` at 2234–2410.
- Cursor-point placement and `updateCursor()` at 2795–3270.
- Rectangle caching and mouse or drag handlers at 3271–3555.
- Complete legend management, which is split across initialization and interaction sections.

Their dependencies include geometry, indices, scheduling flags, caches, callbacks, and other closure functions.
Passing `self` alone does not expose all of those dependencies.

A large shared-state object only relocates this coupling.
It also adds mutation and synchronization risks.

## Recommended sequence

1. Move the scale scanning subsystem without wrappers or behavior changes.
2. Move the top-level helpers into purpose-based modules.
3. Move the position, automatic-padding, and calculated-range helpers with explicit arguments.
4. Extract initial scale setup after its scan and range dependencies have stable module locations.
5. Extract the canvas painter with private caches and exact invalidation timing.
6. Extract the listener registry only if the separation improves readability.
7. Reassess the three secondary candidates after the main boundaries settle.

The listed primary groups contain approximately 500 source lines before new imports and call sites.
This estimate is not a target for extra fragmentation.

## Validation plan

Perform and review each extraction separately.
Do not update snapshots during extraction validation.

1. Record source, minified, gzip, and Brotli sizes before each change.
2. Run the direct scan suites after the scan-module extraction:
   - `test/scale-scan.mjs`
   - `test/scale-scan-cost.mjs`
   - `test/scale-range-issues.mjs`
   - `test/scale-static-range.mjs`
3. Run the scale, asinh, logarithmic-time, precision, and layout suites after range or scale-initialization changes.
4. Run the consumer type fixture documented in `test/README.md` after moving the public `uPlot.scan` implementation.
5. Run demo snapshots, `test/layout.mjs`, and `test/cursor-points.mjs` after the painter extraction.
6. Run `test/legend.mjs`, `test/cursor-drag.mjs`, and demo migrations after the listener extraction.
7. Run the full Node suite with `npm test`.
8. Run the same Mocha suite under native Bun with `bun run test`.
9. Build all distributions with `npm run build`.
10. Compare generated API assignments, feature-flag builds, and output sizes with the baseline.
11. Inspect the module graph for new cycles, especially between scale defaults, scan code, and `uPlot.js`.
12. Benchmark representative initial renders and redraws after scan or painter changes.

The focused scale validation must cover these cases:

- Aligned and faceted data.
- Pure and cached scans.
- Hidden or excluded series and facets.
- Linear, logarithmic, asinh, custom, dependent, partial, static, and `mode: 2` scales.
- Empty data, null data, equal values, reversed partial limits, and custom clamps.

The painter validation must cover backing-store resets after size and pixel-ratio changes.
It must also cover passes where layout changes without a backing-store reset.
Recorded canvas commands and DOM snapshots must remain unchanged.

Coverage locations will change after functions move between files.
Compare behavior and covered branches, not only source line numbers.

These are proposed validation steps.
No extraction or validation run accompanied this assessment.
