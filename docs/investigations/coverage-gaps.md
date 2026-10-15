# Coverage gap report

## Audit basis

This report describes the current working tree on 2026-09-17. The tree includes uncommitted source and test changes above `e27e4092cfc67c7c57d7b7e1c39a08fae1cfb143`.

The previous report described a 614-test snapshot. That snapshot is historical and does not describe the current test suite.

Current evidence comes from this command:

```sh
npm test
```

The command used Node 26.8.2. It completed with 1,011 passing tests in 14 seconds and generated a fresh Istanbul report.

The test runner removed `.nyc_output` before execution, so it did not reuse stored coverage. Bun validation was not run. This report makes no Bun compatibility or coverage claim.

Coverage shows execution, not assertion quality. The line references below identify code that the current Node suite did not execute.

## Current coverage

| Area | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| All files | 94.47% | 88.09% | 92.96% | 94.39% |
| `src` | 94.24% | 88.48% | 91.98% | 94.17% |
| `src/paths` | 95.62% | 85.82% | 98.36% | 95.54% |

The main source files have this coverage:

| File | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `src/uPlot.js` | 93.46% | 88.54% | 94.94% | 93.41% |
| `src/utils.js` | 95.57% | 91.25% | 92.59% | 95.60% |
| `src/fmtDate.js` | 82.17% | 59.55% | 71.42% | 81.81% |
| `src/opts.js` | 98.97% | 96.13% | 95.74% | 98.92% |
| `src/dom.js` | 100% | 93.33% | 100% | 100% |

The uncovered `src/opts.js` lines are `372` and `500-501`.

## Current summary

| Area | Current assessment | Main residual gaps | Priority |
| --- | --- | --- | --- |
| Built-in cursor selection | Large direct gap | Non-null search, hover bias, proximity rejection | High |
| Dynamic series | `addSeries()` is covered, but `delSeries()` is not | Deletion with legend and cursor state, plus indexed insertion | High |
| Drag and synchronization | Basic drag and one synchronized X case are covered | Synchronized Y, key mismatch, rotation, `drag.uni` | High |
| Date formatting and zones | Common paths are covered indirectly | Specific tokens and `DateZoned` branches | Medium |
| Path builders | High statement coverage with branch gaps | Decimation nulls, vertical paths, extension, short splines | Medium |
| Scale, layout, and bands | Much stronger than the old report stated | Dependent scales, band clips, axis borders, range guards | Medium to low |
| Data joining | Core behavior has direct tests | Null-padded X columns in the order check | Low |
| Browser lifecycle | Some state changes have Happy DOM tests | Native DPR, global resize or scroll, media queries | Browser integration |
| Debug and uncommon APIs | Small isolated gaps | IDs, logging, band mutation, rare callback forms | Low |

## Material changes since the old snapshot

The old report understated several areas that now have direct coverage:

- The 41 tests in `test/cursor-drag.mjs` cover mouse-driven X, Y, and XY drag at DPR 1 and DPR 2.
- The drag tests cover forward and reverse movement, inverted scales, thresholds, release outside the plot, double-click reset, the preferred `drag.setRange` API, and the deprecated boolean `drag.setScale` alias.
- One synchronized X-drag case now reaches the target chart and checks each chart callback.
- `test/cursor-points.mjs` covers shared and per-series points, DPR changes, hidden points, rotated axes, and mode 2.
- Mode 2 setup and scale scans have broad direct coverage in the scale, cursor, asinh, and issue tests.
- `addSeries()` runs in both aligned and faceted tests. Explicit insertion at a supplied index does not run.
- `test/join.mjs` now covers sorted and unsorted inputs, null modes, typed arrays, large merges, and input immutability.
- The layout and scale-range suites now cover many resize, range, scan, hidden-axis, and deferred-commit cases.

These additions remove the old broad claims about untested basic dragging, mode 2 initialization, data joining, and hidden-axis behavior.

## Built-in cursor selection

### Default non-null hover selection

The default `cursor.dataIdx` implementation is at `src/uPlot.js:1063-1132`.

The suite enters the missing-value path, but it does not execute most of its selection logic. Current uncovered statements are at:

- `src/uPlot.js:1087-1088`
- `src/uPlot.js:1095-1096`
- `src/uPlot.js:1101-1113`
- `src/uPlot.js:1117`
- `src/uPlot.js:1125`
- `src/uPlot.js:1127-1128`

The residual cases are:

- Search left for a non-null value.
- Search right for a non-null value.
- Select the nearest side when both sides contain values.
- Select the only side that contains a value.
- Apply `cursor.hover.bias` values of `-1`, `0`, and `1`.
- Accept or reject candidates through `cursor.hover.prox`.
- Reject a non-null nearest X point when its pixel distance exceeds the proximity limit.

The `nearest-non-null` demo tests use custom cursor behavior. They do not prove the default implementation above.

Use a small Happy DOM integration table. Drive the cursor through `setCursor()` or mouse events, then assert `cursor.idxs` and legend values.

### Nonzero focus bias

The normal `focus.bias: 0` path has coverage. The nonzero bias logic at `src/uPlot.js:2961-2988` does not.

The uncovered statements are at `src/uPlot.js:2969`, `2971-2972`, `2976`, and `2981-2982`.

Add focused cases for:

- Positive and negative series values.
- A cursor value on the same side of zero.
- A cursor value on the opposite side of zero.
- Bias toward zero and away from zero.

## Drag selection and synchronization

### Behavior that is now covered

`test/cursor-drag.mjs` provides substantial integration coverage through 41 tests. It includes:

- X-only, Y-only, and XY drag.
- Forward and backward drag.
- DPR 1 and DPR 2.
- Inverted scale directions.
- `drag.dist` and zero-movement handling.
- Retained selection when the preferred `drag.setRange` option is false.
- Refinement and cancellation through a preferred `drag.setRange` callback.
- Compatibility for the deprecated boolean-only `drag.setScale` alias with both true and false.
- Release outside the plot.
- Resize and axis-collapse geometry refresh.
- Double-click range reset.
- One synchronized X-only drag between two horizontal charts.

Basic drag is no longer a general coverage gap.

### Synchronized selection gaps

The synchronized selection projection is at `src/uPlot.js:3080-3144`. The existing synchronized test reaches the horizontal, matching-X path.

The current gaps include:

- A synchronized Y selection at `src/uPlot.js:3123-3138`.
- A rotated source selection at `src/uPlot.js:3109-3110` and `3124-3130`.
- A nonmatching X key and full-width reset at `src/uPlot.js:3121`.
- A source with no active drag dimension and selection clearing at `src/uPlot.js:3144`.
- Matching and nonmatching scale-key callbacks for both dimensions.

The synchronized cursor projection at `src/uPlot.js:3302-3349` also lacks rotated-source and no-scale-key cases.

### Rotated and unidirectional drag gaps

Horizontal drag paths have strong coverage. The current suite does not execute these branches:

- Rotated drag dimension exchange at `src/uPlot.js:3150-3153`.
- The under-threshold direction choice for `drag.uni` at `src/uPlot.js:3168-3172`.
- Rotated X selection at `src/uPlot.js:3188-3189`.
- Rotated Y selection at `src/uPlot.js:3200-3201`.
- Rotated drag-axis mapping at `src/uPlot.js:3511-3513` and vertical edge snapping at `src/uPlot.js:3525-3526` during `mouseLeave()`.

Extend the existing drag harness. It already supplies stable plot geometry and mouse events.

### Smaller cursor lifecycle gaps

The old report listed most cursor lifecycle functions as uncovered. That claim is no longer correct.

`mouseMove()`, `mouseUp()`, `mouseLeave()`, and `dblClick()` now run in integration tests. Remaining branches include:

- Locked-cursor early returns at `src/uPlot.js:3283-3284`, `3492-3493`, and `3546-3547`.
- Synchronized focus mapping at `src/uPlot.js:3572-3575`.
- The internal DPR listener at `src/uPlot.js:3559-3560`.

These branches are lower priority than default hover selection and synchronized drag projection.

## Faceted data and dynamic series

Mode 2 initialization is not a broad gap. Current tests construct faceted charts and cover scale scans, cursor points, ranges, and drag reset.

`addSeries()` at `src/uPlot.js:1247-1254` also has direct aligned and faceted coverage. The supplied-index branch at `src/uPlot.js:1248` remains uncovered.

`delSeries()` at `src/uPlot.js:1258-1280` has no coverage. This function removes:

- The series entry.
- Legend values, cells, rows, and listeners.
- Active cursor indices and cursor-point state.
- The cursor-point DOM element.
- The `delSeries` hook notification.

The function does not remove scales or perform separate facet cleanup. Tests must assert the implemented public behavior instead of assuming that cleanup.

Add one aligned test with the legend and cursor enabled. Add one mode 2 smoke test, and include deletion from the middle of the series array.

Also cover indexed `addSeries()` insertion. Assert the series order, legend order, cursor arrays, hooks, and behavior after `setData()`.

Mode 2 visibility reranging at `src/uPlot.js:2574-2576` is a separate small gap.

## Data joining and ordering

`test/join.mjs` directly covers the main `join()` behavior:

- Identical X columns and retained column references.
- Identical and differing unsorted X columns.
- Typed X and Y columns.
- Partial and disjoint overlap.
- Multiple Y series per table.
- Explicit `null` and `undefined` values.
- `NULL_REMOVE`, `NULL_RETAIN`, and `NULL_EXPAND`.
- Empty tables and series.
- Input immutability.
- The shared sorted-merge path with 100 tables.
- Randomized comparison with the previous algorithm.

The core join behavior is covered. Do not keep this area at high priority.

A small residual gap remains in `isAsc()` at `src/utils.js:749-783`. The suite does not execute:

- Leading nullish X values at `src/utils.js:760-761`.
- Trailing nullish X values at `src/utils.js:763-764`.
- The all-nullish or single-surrounded-value return at `src/utils.js:766-768`.

Add a compact test only if null-padded X columns are supported input. Otherwise, document or reject that input instead of adding percentage-only tests.

## Date formatting and time zones

`src/fmtDate.js` has 82.17% statement, 59.55% branch, 71.42% function, and 81.81% line coverage.

Common formatting and timezone paths run through demos and chart tests. The uncovered token callbacks are more specific than the old report stated:

- `{MMMM}` at `src/fmtDate.js:72`.
- `{WWWW}` and `{WWW}` at `src/fmtDate.js:84-86`.
- `{HH}` and `{H}` at `src/fmtDate.js:88-90`.
- `{AA}` at `src/fmtDate.js:94`.
- `{a}` at `src/fmtDate.js:98`.
- `{m}` at `src/fmtDate.js:102`.
- `{s}` at `src/fmtDate.js:106`.

The `{fff}` fractional token is covered. Custom names and general template assembly also have coverage, so they are not broad gaps.

The remaining timezone gaps are:

- Passing a `Date` through the local-zone fast path at `src/fmtDate.js:147-150`.
- Copy construction at `src/fmtDate.js:207-210`.
- UTC-backed getters in `DateZoned.#get()` at `src/fmtDate.js:214-216`.
- The zero-offset `GMT` normalization at `src/fmtDate.js:228-229`.
- Zoned `getDay()` at `src/fmtDate.js:263-275`.
- Zoned `getTimezoneOffset()` at `src/fmtDate.js:277-279`.

`leapYear()` at `src/fmtDate.js:292-294` is private and has no caller. `mkDate()` at `src/opts.js:371-373` also has no caller; its uncovered statement is at `src/opts.js:372`.

Do not add tests that can reach these dead helpers only through artificial means. Remove or reconnect them in a separate source change if they are still required.

Use table-driven unit tests for the public date tokens and `DateZoned` methods. These tests do not need a chart.

## Path builders

Path statement coverage is high, but branch coverage is 85.82%. Keep path tests small and compare recorded `Path2D` commands.

### Linear paths

`src/paths/linear.js` has 93.68% statement and 80.76% branch coverage.

The uncovered statements are `93-94`, `107`, `109-110`, and `119`. They belong to the decimation path, not the normal non-decimated path.

Target these cases:

- A `null` inside a reused pixel bucket.
- A `null` at the start of a new pixel bucket.
- A final bucket that still needs its min/max accumulator drawn.
- Reverse or vertical decimation, whose direction branches remain uncovered.

The old broad claim about all `spanGaps`, fill, and clipping behavior was too strong.

### Stepped paths

`src/paths/stepped.js` has 92.64% statement and 72.54% branch coverage.

The uncovered statements are `18`, `45-46`, and `78-79`. The main targets are:

- Empty or all-null input.
- `extend: true` with `align: -1`.
- `extend: true` with `align: 1`.
- Vertical or reversed orientation.
- `spanGaps: true`.

### Splines

`src/paths/monotoneCubic.js` has uncovered statements at `13`, `20`, and `48`.

These lines represent:

- Fewer than two points.
- Exactly two points.
- A non-finite computed slope, such as a repeated X coordinate.

`src/paths/spline.js` has uncovered statements at `10` and `27-29`. Add all-null and vertical-orientation wrapper cases.

### Bars and shared path utilities

`src/paths/bars.js:135` is the value-unit width branch for custom bar display geometry.

The remaining shared utility statements are:

- Reverse band clipping at `src/paths/utils.js:131-132`.
- Coalescing a repeated gap start at `src/paths/utils.js:190-191`.
- Reverse gap scanning at `src/paths/utils.js:210-212`.
- The vertical Bézier helper function at `src/paths/utils.js:310`.

These are focused branch tests. A large path-option matrix is not necessary.

## Scale, layout, and utility edges

The current layout and range suites make the old broad gap list obsolete. They cover many resize, hidden-axis, scan, range-policy, and deferred-commit paths.

Residual `src/uPlot.js` clusters include:

- Axis fallback to a series scale at `src/uPlot.js:1295-1297`.
- A non-auto X range after `setData()` at `src/uPlot.js:1432-1435`.
- Dependent-scale propagation at `src/uPlot.js:1524-1529`.
- Null searches outside the visible window at `src/uPlot.js:1692-1701`.
- Band clip combinations at `src/uPlot.js:1859-1892`.
- A nonpositive axis dimension at `src/uPlot.js:1919-1925`.
- Axis-border drawing at `src/uPlot.js:2171-2183`.
- Deferred initial selection at `src/uPlot.js:2381-2383`.
- Reversed, tiny, and one-index ordinal range guards at `src/uPlot.js:2434-2450`.
- Faceted visibility reranging at `src/uPlot.js:2574-2576`.

Residual `src/utils.js` statements include:

- Zero endpoints in `rangeAsinh()` at `src/utils.js:146-150`.
- The all-null result in `hasData()` at `src/utils.js:197-203`.
- Nonzero collapsed-range fallbacks at `src/utils.js:264-273`.
- `numDigits()` at `src/utils.js:411-412`.
- `cmpObj()` at `src/utils.js:464-470`.
- Typed-array copying at `src/utils.js:506-507`.

Add tests for documented contracts or previous faults. Do not build a broad combination matrix only to increase coverage.

## Browser lifecycle behavior

`src/dom.js` has full statement and line coverage. Its remaining branch locations are `25-28` and `123`.

The untested cases are:

- A DPR notification with no DPR change.
- Removal of the previous media-query listener after a DPR change.
- `off()` with capture enabled.

Related `src/uPlot.js` gaps are:

- Global rectangle invalidation at `src/uPlot.js:206-208`.
- Global DPR propagation at `src/uPlot.js:214`.
- The chart DPR listener at `src/uPlot.js:3559-3560`.

Current tests cover explicit resize, direct `setPxRatio()`, cursor rectangle refresh, and chart removal from `cursorPlots`. The old report incorrectly listed cursor-tracking removal as uncovered.

Happy DOM does not reproduce native media-query and layout behavior. Use a real-browser integration test for global resize, scroll, and DPR changes.

## Debug and uncommon API paths

Lower-value gaps include:

- Internal `log()` at `src/uPlot.js:200-202`.
- An explicit root `opts.id` at `src/uPlot.js:440-441`.
- The post-drag click callback at `src/uPlot.js:455-458`.
- The default `cursor.drag.click` propagation suppression at `src/opts.js:500-501`.
- `setBand()` at `src/uPlot.js:2593-2595`.
- Indexed `addBand()` and indexed `delBand()` branches at `src/uPlot.js:2600` and `2608`.
- Constructor initialization without a mount target at `src/uPlot.js:3692`.

Leave debug and defensive paths uncovered unless a reported fault reaches them. Public band mutation is a reasonable exception when band behavior changes.

## Recommended order

1. Add table-driven integration tests for the built-in non-null `cursor.dataIdx` behavior.
2. Add aligned and faceted `delSeries()` tests, plus indexed `addSeries()` coverage.
3. Extend the drag harness for synchronized Y, key mismatch, rotation, and `drag.uni`.
4. Add unit tests for uncovered public date tokens and `DateZoned` methods.
5. Add focused path tests for decimation nulls, stepped extension, vertical splines, and reverse utilities.
6. Add scale, band, or layout tests only for documented behavior or known regressions.
7. Keep native DPR, resize, and scroll behavior in a browser-integration suite.

Do not target dead helpers, debug paths, or defensive branches only to increase the coverage percentage.
