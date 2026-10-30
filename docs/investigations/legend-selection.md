# Live legend selection

## Status and scope

This document defines the core contract and implementation plan for live legend selection.
Core implementation, typings, tests, documentation, and the demo are part of this change.
Runtime and build results appear in the validation section.
The full runtime suite and distribution build pass with synchronous legend updates.
Browser layout and performance validation remain pending.
The consumer type check encounters an existing declaration syntax error, described in the validation section.

The [demo](../../demos/legend-selection.html) uses the core API directly with four selectable behaviors on one chart.
It does not emulate selection, patch core methods, or replace the legend template.
New legend UI controls remain outside this change.

## Rationale

A live legend can contain hundreds of series, but a reader often needs only a small subset.
A proximity filter can reduce that subset before a value sort and a page limit.
Separate callbacks let applications choose these policies without new legend controls.

Selection changes the legend rows, not the chart series or their data.
The existing legend markup, row bindings, markers, labels, and value cells remain unchanged.
The initial scope excludes search fields, sort buttons, sort indicators, page buttons, and virtual scrolling.

## API contract

The signatures below summarize the public contract.

```ts
legend: {
  filter?: (u: uPlot, si: number) => boolean;
  sort?: (u: uPlot, a: number, b: number) => number;
  limit?: (
    u: uPlot,
    filteredSortedIndices: readonly number[],
  ) => readonly [start: number, end: number];

  // Public readback, owned by core.
  order: readonly number[];
  count: number;
  range: readonly [start: number, end: number];
}

cursor: {
  trackDists?: boolean; // Defaults to false.
  dists?: readonly number[] | null;
}
```

### Pipeline

1. Start with all Y-series indices in original series order.
2. Apply `legend.filter(u, si)` to each Y-series index.
3. Sort the retained indices with `legend.sort(u, a, b)`.
4. Call `legend.limit(u, filteredSortedIndices)` with the complete sorted subset.
5. Select the effective half-open range `[start, end)`.

An omitted filter retains every Y series.
An omitted sort preserves original series order.
An omitted limit selects `[0, count)`.
When a comparator returns zero, original series order resolves the tie, not the previous legend order.
Callback indices always refer to `u.series`, never to a row position.

Hidden series remain eligible unless the custom filter excludes them.
For example, `(u, si) => u.series[si].show` explicitly excludes hidden series.
A proximity filter also excludes hidden series because their distance is `Infinity`.

The X row never enters the pipeline and never consumes the limit.
It stays first under the existing eligibility rules: mode 1, a live legend, and no multi-value legend.
Mode 2 and multi-value legends keep their existing X-row behavior.

### Range normalization

The limit returns two slice boundaries, not a page number or a row count.
Core converts the boundaries to nonnegative integers and clamps them to the filtered count.
Negative boundaries do not count backward from the end.
A reversed range becomes an empty range at the effective start.

The range calculation is equivalent to:

```js
function bound(value, count) {
  return Number.isNaN(value) ? 0 : Math.min(count, Math.max(0, Math.trunc(value)));
}

const start = bound(requestedStart, count);
const end = Math.max(start, bound(requestedEnd, count));
const range = [start, end];
const order = filteredSortedIndices.slice(start, end);
```

Thus, `Infinity` clamps to `count`, and `-Infinity` clamps to zero.
The callback must return the declared numeric tuple.
The readonly input is borrowed data. The callback must not mutate it or depend on its identity across updates.

Readonly arrays are a contract, not a requirement for runtime freezing.
Core reuses its buffers for callback input, `legend.order`, `legend.range`, and `cursor.dists`.
Clients must not mutate these buffers. Clients that need snapshots must copy the arrays.

### Public readback

| Field | Meaning |
| --- | --- |
| `legend.order` | Final selected Y-series indices, after all three stages. |
| `legend.count` | Number of Y series after the filter, before the page limit. |
| `legend.range` | Effective clamped range within the filtered, sorted indices. |

An empty selection has an empty `order`. An empty filtered set has `count: 0` and `range: [0, 0]`.
A page beyond the end has `range: [count, count]` without an implicit page reset.
An external pager can use `count` and `range` without access to DOM rows.

Selection does not depend on `legend.show`.
Core updates selection before the associated `setLegend` and `setCursor` hooks observe it.
The initial legend mount follows completion of selection, data, layout, and pending initial commits.
Core sets its internal ready state to `true` and `status` to `1` before that mount, then calls the `ready` hook.
Core does not render the legend during constructor setup.
Cursor updates and explicit `setLegend` calls complete values and selection before the synchronous DOM update.
After initialization, the associated `setLegend` and `setCursor` hooks observe the completed DOM.
During initialization, these hooks can run before the initial mount.
Mutation methods can leave selection pending until the next normal update.

`legend.values`, `legend.idxs`, and cursor indices retain their original series indexing.
Core does not compact or reorder these arrays.
Existing `value` and `values` formatters remain compatible, including formatters for series outside the selected page.
Selection does not introduce lazy formatting or change existing formatting eligibility.

### Explicit refresh

Callbacks can read application state through closures.
Core cannot detect a change to that state.
An explicit `u.setLegend({})` refreshes the callbacks despite unchanged indices and formatted values.
Explicit `idx` or `idxs` overrides in `setLegend` update legend indices but do not recalculate physical cursor distances.
`cursor.dists` continues to describe the physical cursor state, not those legend overrides.

```js
let offset = 0;
const pageSize = 8;
const legend = {
  limit: () => [offset, offset + pageSize],
};

// After the application creates u with this legend configuration:
offset = 8;
u.setLegend({});
```

Callbacks must not mutate core selection inputs or chart state.
With selection callbacks configured, each cursor update or explicit refresh evaluates selection once.
Without another state change, the subsequent commit does not repeat that selection.
A cursor operation that changes focus and values renders the legend once, after both changes.

Selection changes emit `setLegend` without unnecessary value formatting.
The `setCursor` hook also observes current selection after every cursor update.

Standalone `addSeries()` and `delSeries()` only mark selection and rendering dirty, for both visible and hidden legends.
Neither method schedules a legend frame, a selection microtask, or a new canvas commit.
Selection and DOM rows remain unchanged until an explicit refresh or a normal chart commit.
This intentionally changes the previous behavior for visible legends.

The next cursor update, explicit `setLegend({})`, or normal commit consumes this work.
A normal commit can follow `setData(data)` or `redraw()`.
The refresh completes selection and updates the DOM synchronously before the associated `setLegend` hook.
The `addSeries` and `delSeries` hooks can observe the previous selection.
Structural changes inside a `setLegend` hook also remain pending until another refresh.

Before the next refresh, supply data columns that match the changed series array.
For a legend-only refresh, use this sequence:

```js
u.addSeries(newSeries, index);
u.setData(newData, false);
u.setLegend({});
```

This sequence keeps selection callbacks away from unaligned data and does not force a canvas commit.
Deletion requires the same data alignment before refresh.

Visibility and focus mutations also leave selection pending for the normal commit.
Several mutations in one synchronous sequence share one selection pass at the existing normal commit.
That commit updates the DOM synchronously, without a later legend frame.
The `setSeries` hook reports the new series state, but its selection readback can still reflect the previous update.

`setData(data, false)` preserves pending distance work for the next commit, such as `redraw()`.
It does not force an immediate cursor update.
With distance tracking or selection callbacks, active-cursor resize uses a normal cursor and legend-value refresh.
This can rerun formatters and emit `setLegend` even when indices are unchanged.
Cursor movement still avoids formatting when only selection changes.

## Legend layout and position

```js
legend: {
  mode: 'table',
  side: 1,
}
```

`legend.mode` accepts `'inline'`, `'table'`, or `null`.
The default is `null`, which preserves the existing inference from multi-value formatting.
Scalar legends use inline layout by default. Multi-value legends use table layout by default.
Explicit layout does not change value formatting, column keys, X-row eligibility, or selection.
`legend.valueSrc` selects `'value'` or `'values'` independently of `tooltip.valueSrc`.
An omitted source prefers `series[1].values` when present, as before.
A scalar table uses `series.value` and has no column header for the internal `_` key.
Multi-value legends retain their named column headers.
With `live: false`, both layouts show null-index stats without the X row.
Non-live legends apply their own selection callbacks after stats refreshes, or on explicit `setLegend` calls.
Their selection does not restrict hover points.
An enabled tooltip becomes the live selection owner. See [Tooltip and Stats Legend](../tooltip.md).

`legend.side` uses the same order as axes and padding:

| Value | Position | Legend class |
| --- | --- | --- |
| `0` | Top, below the title | `.u-top` |
| `1` | Right | `.u-rgt` |
| `2` (default) | Bottom | `.u-btm` |
| `3` | Left | `.u-lft` |

Mode and side are initialization options, not mutable layout controls.
Neither option implies the other. A right-side table requires both options.
The title spans the layout. Left and right legends align with the top of the chart wrapper, including axes.
Their default horizontal separation is 16px.

Every chart root uses one fixed grid, including the default bottom layout:

```text
title  title  title
  .     top     .
left   plot   right
  .    bottom   .
```

The side columns use `max-content`. The center column uses `auto`, so top and bottom inline legends can wrap.
Position classes belong to the legend table, not the root. The default legend also receives `.u-btm` for external CSS targeting.
The root no longer has a `data-legend-side` attribute.
A direct canvas occupies the plot area when the chart has no separate wrapper.

Chart `width` and `height` exclude the legend and title.
A side legend increases the component's outer size instead of reducing the chart dimensions.
Applications control available space, overflow, and maximum legend dimensions through CSS.
There is no automatic legend measurement or canvas resize.
A custom `legend.mount` callback can move the legend outside this layout.
Placement styles apply only to the root's direct children.

Every legend render invalidates the cached overlay rectangle because grid dimensions can move the plot, including with bottom placement.
The next pointer event or `u.rect` access refreshes it. Rendering does not read geometry eagerly.

## Cursor distances

`cursor.trackDists: true` opts into a stable, series-indexed `cursor.dists` array.
Core updates this array in place across cursor updates and adjusts its length after series changes.
The opt-in does not require focus dimming or an enabled focus proximity threshold.

For an available Y value, the distance is:

```js
Math.abs(focus.dist(u, si, dataIdx, seriesValuePos, cursorValuePos))
```

This reuses the existing focus distance callback and its arguments.
The default measures CSS-pixel distance along the value axis, not Euclidean distance to the line.
A custom callback can define different units. The 5px demo assumes the default callback.

Distances precede focus bias and focus threshold decisions.
The X entry, hidden series, missing values, unavailable distances, and inactive cursor positions use `Infinity`.
Core clears stale distances on cursor exit and series visibility changes.
Distance calculation respects the series scale, axis orientation, and selected data index.

Core must calculate requested distances even without hover point markers or focus dimming.
When both focus and distance tracking need a distance, core can reuse one callback result.
When tracking is off, `cursor.dists` is `null` and the feature adds no distance buffer or tracking-only scan.

## Invalidation and performance

Value invalidation and selection invalidation are separate concerns.
A cursor move along the value axis can change proximity without a new data index or formatted value.
A raw value change can alter sort order despite unchanged formatted text.

| Change | Required selection work |
| --- | --- |
| Active cursor move | Refresh distances and selection, including moves at the same data index. |
| Data or cursor-selected indices | Refresh relevant values, distances, and selection. |
| Explicit `setLegend` index overrides | Refresh legend values and selection without recalculation of physical cursor distances. |
| Scale, size, or orientation | Refresh distances and dependent selection. |
| Series visibility or focus | Mark selection dirty for the normal commit. |
| Series addition or removal | Align index buffers and mark selection and rendering dirty. Wait for an explicit refresh or normal commit. |
| Explicit `setLegend({})` | Refresh callbacks for external closure state. |
| Cursor exit | Clear distances and refresh selection. |

Arbitrary callbacks are opaque. Core cannot infer their dependencies from their source or result.
A selection-dirty flag records pending work from data, layout, and series mutations.
With selection callbacks configured, cursor updates and explicit refreshes evaluate selection regardless of that flag.
The normal commit evaluates selection only when work remains pending.
The render helper consumes a separate render-dirty flag and updates only the DOM.
It does not evaluate selection, format values, or schedule work.
This separation avoids duplicate callback passes without tying selection to formatted value changes.
There is no legend animation-frame scheduler, replacement microtask scheduler, or `legend.rAF` option.
An unrelated redraw does not refresh external closure state. That state requires `setLegend({})`.

For `N` Y series and `M` filter matches, filtering costs `O(N)` callback calls.
Sorting then costs `O(M log M)` comparisons, rather than a full `O(N log N)` sort.
These bounds assume constant-time callbacks. Applications control callback costs.
The final slice costs up to the selected page size.

The page limit bounds the number of Y rows in the DOM, not the formatting work or the distance scan.
Core reuses selection buffers and compares the final order before it requests structural DOM updates.
The existing keyed renderer can retain row identity without template changes.

Without selection callbacks, core fills `legend.order` directly with the Y-series indices in one pass.
It does not allocate a candidate buffer for this path.
Repeated `setLegend({idx})`, `setLegend({idxs})`, and `setLegend({})` calls reuse the existing order unless selection is dirty.
Value formatting and hook delivery remain unchanged.
Series insertion and removal still mark selection dirty.

Core allocates the candidate buffer only when selection callbacks require it.
After callers remove all callbacks, `setLegend({})` restores identity order once and releases the buffer.
These changes remove unnecessary selection passes.
The sort comparator wrapper is created once per chart and reads the current `legend.sort` callback.
Hook dispatch and explicit legend-index copies retain `forEach` for readability.
Native sorting, value formatters, and DOM membership changes can still allocate memory.
Wall-clock performance measurements remain pending.
Removal of animation-frame scheduling does not guarantee a performance gain.
Synchronous DOM updates remove that delay but do not combine separate operations into one frame.
Callback costs, formatting, DOM changes, layout, and paint still determine runtime cost.

## Experiment: hover points follow legend membership

Status: implemented as an uncommitted experiment after checkpoint `8ba7e46` (`Add live legend selection and layout controls`).
The demo now restricts hover points to the final legend membership.

### Scope and default behavior

Hover points always follow the final legend membership. There is no `followLegend` option or escape hatch.
This changes point visibility only, not which series the chart plots.
All configured per-series point elements remain initialized in the DOM.
Core retains its existing point-position and style calculations.
Legend membership adds one visibility condition, without lazy point creation, pooling, or another scheduler.

Legends without membership restrictions retain the existing hover-point behavior.
The unrestricted path must remain near-free, without a membership scan, buffer allocation, or DOM writes.

### Lifecycle and visibility

The current cursor loop calculates active indices, distances, and point presentation before it resolves legend selection.
Point callbacks can therefore observe the previous `legend.order` or an incomplete distance array.
`cursor.points.show` is an element factory, not a per-update visibility predicate.

The internal visibility step runs after the final `legend.order` is available.
It first determines whether the final order excludes any Y series.
When membership is unrestricted and no previous restriction needs cleanup, it returns immediately.

For restricted membership, the step uses this sequence:

1. Mark the selected Y-series indices in a reusable membership buffer.
2. Visit the existing point elements.
3. Apply a separate visibility class to points outside the selected set.

The effective rule is:

```text
point visible = normal cursor-point visibility AND legend membership
```

The membership class, `.u-excl`, remains separate from `.u-off`.
Core already uses `.u-off` for missing values, hidden series, cursor exit, and points outside the plot.
Membership must not override those conditions or disappear during ordinary point positioning.

Core updates membership before public hooks, not in a public `setLegend` hook.
Suppressed hook delivery does not suppress point visibility updates.
The source of membership is `legend.order`, not legend DOM rows.
Selection completes before the synchronous DOM update.

Required update paths include new X indices, Y-only proximity changes, explicit `setLegend({})`, and data, layout, visibility, or structural changes.
The implementation refreshes the membership gate whenever selection evaluates, without another dirty flag.
This includes structural changes even when the selected numeric indices remain unchanged.

### Semantics

- Hidden series, missing values, and points outside the plot retain normal point-visibility rules.
- The X row does not create a hover point.
- Cursor exit hides points even when the idle legend shows all series or final-sample values.
- With `legend.show: false`, membership still uses `legend.order` for external legends and tooltips.
- With `points.one: true`, core keeps its existing closest-point choice and hides that point if its series is excluded.

The single-point gate also updates inside the existing point-position block when the chosen series changes.
This handles updates that do not evaluate legend selection.
Series insertion and deletion adjust the shared marker's existing owner index. Deletion of its owner hides the marker until a cursor update.
Index changes also set the existing cursor-refresh flag, so the next cursor update refreshes index-dependent point styles.
Choosing the closest point among legend members remains outside scope.
Markers for idle fallback values also remain outside scope because those formatters do not change physical cursor indices.

### Complexity and performance

Restriction depends on actual selected membership, not merely the presence of callbacks.
Core produces unique Y-series indices, so this constant-time check identifies a restricted order:

```js
const restricted = legend.order.length < series.length - 1;
```

The unrestricted fast path covers:

- No selection callbacks.
- Sorting without membership reduction.
- Filters that currently retain every Y series.
- Limits that currently include every Y series.

With no legend feature, hover points also retain their existing behavior.
The implementation performs the check in the selection path, not inside the ordinary per-series point-update loop.
No restriction means no membership scan, buffer allocation, or DOM writes, except when a previous restriction needs cleanup.
This is near-free behavior, not a claim of zero additional instructions.

When membership changes from restricted to unrestricted, core removes the membership-hiding class once.
This restores normal point visibility without changing `.u-off` or overriding other visibility conditions.
Examples include removing callbacks, selecting Per page: 0, or leaving the plot in the Nearby demo.
Subsequent unrestricted updates return immediately. A chart that never restricts membership needs no cleanup.

For N series and K selected entries, a restricted membership pass costs `O(N + K)`.
Core allocates membership storage only when restriction first requires it and reuses that storage for later restricted updates.
Class changes occur only when membership visibility changes.
Repeated `legend.order.includes(si)` calls inside the series loop can cost `O(N × K)` and are unnecessary.

This approach reduces visual clutter, not point-element count or existing position/style calculations.
It requires no new microtask, animation frame, or selection cache.
These are structural cost estimates, not benchmark results.

The production diff adds 41 net lines across `src/uPlot.js`, `src/domClasses.js`, and `src/uPlot.css`.
It adds one helper, one visibility class, and one lazy array, `cursorPtMembers`.
A null buffer means that membership was never restricted. An empty buffer means that restriction ended and cleanup completed.
An active buffer has one entry per series. Its length also indicates whether the single-point gate needs an update.
There is no additional dirty flag, scheduler, or cached copy of `legend.order`.
No public option or type declaration changes. Existing point-position and style calculations remain in place.

### Bundle measurements before the fixed-grid layout change

These figures isolate the hover-point experiment and predate the position-class and fixed-grid changes.
Both measurements use `npm run build` and Python `gzip.compress(data, compresslevel=9, mtime=0)`.
The baseline is the checkpoint build, not the older generated distributions stored in Git.

| Artifact | Baseline bytes | Experiment bytes | Change | Baseline gzip-9 | Experiment gzip-9 | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `dist/uPlot.esm.js` | 210,195 | 211,363 | +1,168 | 60,493 | 60,793 | +300 |
| `dist/uPlot.iife.min.js` | 75,187 | 75,569 | +382 | 31,629 | 31,792 | +163 |
| `dist/uPlot.min.css` | 2,794 | 2,815 | +21 | 979 | 982 | +3 |

Minified JavaScript and CSS together add 403 bytes before compression, or 166 bytes with separate gzip compression.
These measurements include the shared-marker index adjustment for series insertion and deletion.
These bundle measurements do not measure runtime cost or browser layout.

### Validation coverage

- Filtering, sorting with a limit, pagination, empty selection, and removal of selection callbacks.
- Y-only membership changes without a new data index or formatter call.
- Explicit refresh with hook delivery suppressed.
- Hidden/missing/out-of-bounds points and cursor exit without accidental visibility restoration.
- Data, resize, and add/delete updates, including unchanged selected numeric indices after structural edits.
- Hidden built-in legends with external selection consumers.
- Single-point series changes with unchanged legend membership.
- Selection-only refresh after insertion or deletion before the shared-marker owner, and deletion of the owner itself.
- Unchanged point behavior without membership restrictions, initialized point count, and DOM identity.
- No membership scan, allocation, or DOM writes for initially unrestricted legends, including sort-only and retain-all callbacks.
- One-time visibility restoration after restrictions disappear, followed by the unrestricted fast path.
- Repeated restricted/unrestricted transitions without stale membership classes or interference with `.u-off`.

## Compatibility and implementation plan

With all stages omitted, the legend keeps its current membership and order.
Series toggles, isolation, focus, custom labels, markers, and destruction retain their existing behavior.
The initial mount occurs after pending initial commits finish, before the `ready` hook.
Standalone structural changes require an explicit refresh or a normal commit, including for visible legends.
Rows continue to bind events to their original series, not their selected position.

The implementation plan for this change is:

1. Trace initialization, cursor updates, `setLegend`, and series lifecycle paths in `src/uPlot.js`.
2. Add distance tracking without an additional focus callback call for the same calculation.
3. Add selection state and separate selection invalidation from value invalidation.
4. Update readback before hooks, including with `legend.show: false`.
5. Pass the selected indices to `src/legend-dom.js` without changes to `src/legend-dom-template.js`.
6. Preserve full series-indexed values and existing formatter behavior.
7. Add public declarations and contract tests.

## Demo configurations

The demo shares the log-scale demo's historical dataset through `demos/data/log-scales.js`.
It contains 24 hours of player counts for 12 named Minecraft servers, from July 17–18, 2020.
The logarithmic Y axis separates clusters of smaller servers from outliers such as Hypixel.
Zero counts use 1, as in the log-scale demo.

One chart starts with a scalar table legend through `legend.mode: 'table'` and a right-side position through `legend.side: 1`.
A mode selector offers inline and table layouts. A position selector offers top, right, bottom, and left.
Mode and position changes recreate the chart because `legend.mode` and `legend.side` are initialization options.
The demo preserves behavior, control values, cursor position, scale bounds, and series visibility.
An external behavior selector starts with a simple five-server limit, without filtering or sorting.
The other behaviors show top servers, select nearby servers, or rank all servers.
Behavior changes replace all three callbacks and call `setLegend({})`, without chart recreation or cursor movement.

A Per page selector appears for Limit only and Top servers. It offers 0 and 5–50 in steps of five, with a default of five.
Zero shows all eligible series. Values above the available count also show all eligible series.
Limit changes call `setLegend({})` without chart recreation. The selected limit persists across behavior and position changes.
A proximity dropdown appears only for the nearby behavior: 5px, 10px, 15px, 20px, or Infinity.
The default is 20px. The selected proximity persists across behavior changes.
Proximity changes update callback state and call `setLegend({})` without cursor movement.

| Configuration | Pipeline |
| --- | --- |
| Limit only (default) | No filter or sort → first N Y series, with N from Per page (0 selects all). All series remain plotted. |
| Top servers: latest when idle | No filter → descending player count → first N matches. Idle values use the final sample. |
| Nearby servers | All visible series while idle. During hover: finite distance within the threshold → descending player count, without a page limit. |
| All servers | No filter → descending player count, without a page limit. |


The comparator reads raw data, not formatted legend text.
Active hover uses `u.data[si][u.legend.idxs[si]]`.
Top servers uses each series' final sample when `u.cursor.idx` is null.
Its value formatters use the same fallback, including the final timestamp for the Time row.
The demo preserves the default time formatter and does not override cursor indices or distances.
A missing or nonfinite final sample displays `--` and sorts last. The demo does not search backward for a valid sample.
Other behaviors retain their existing idle placeholders.
Missing and nonfinite values sort last. Equal values retain original series order.
During hover, Infinity removes the distance threshold but still excludes hidden series and missing hover values.
Without a hover, Nearby servers shows all visible series in original series order, with placeholder values, regardless of the proximity threshold.
Cursor exit restores these rows. Active hover in an empty gap can still produce no matches.
Pagination remains covered by core regression tests, rather than a fixed-page demo.
External text shows `count`, `range`, and `order`.
The `setLegend` hook refreshes this text, including selection-only moves along the Y axis without a new data index.
The demo does not repeat the same string construction and DOM write in a `setCursor` hook.

Nearest N series followed by a value sort is outside the initial scope.
That operation needs a distance rank before the value sort, unlike the distance-threshold filter in this demo.

## Future UI ownership

A future UI owns declarative state for search, filters, sort columns, direction, and pagination.
It compiles that state into the core callbacks.
Core does not infer a sort indicator from an arbitrary comparator.
Multiple sort rules compile into one comparator that evaluates each rule until a comparison is nonzero.
The UI derives sort direction and priority from its own state, not from callback inspection.

A generic UI can label an opaque callback as “Custom filter” or “Custom order.”
Application metadata can supply a description, such as “Within 5px of cursor.”
A description does not make the callback editable through generic controls.
Declarative state and callback descriptions remain separate contracts.

UI filters and application filters compose with logical AND.
Sort precedence between UI state and an application comparator remains unresolved.
A later design must choose override rules or an explicit comparator chain.
An external pager owns its offset and uses `legend.count` and `legend.range` for its display.
One component must own the effective range.
A later demo can add Previous and Next buttons, name search, sort indicators, and a multi-sort control outside the legend.

## Validation

Current validation after removal of legend animation-frame scheduling:

- `npm test -- test/legend-selection.mjs --reporter dot`: 72 passing, with no failures.
- The selection suite covers pending structural changes, explicit refresh, hook-created structural changes, and synchronous DOM updates at the existing commit.
- `npm run build`: all four JavaScript distributions and the minified stylesheet built successfully.
- `npm test -- --reporter dot`: 3,902 passing, 44 pending, and no failures. The tests completed in 50 seconds.
- Regression tests cover hook-created focus updates during initialization and later commits, including disabled data and path caches.
- `git diff --check`: no whitespace errors.
- These checks do not validate browser layout or performance.

Historical validation results before removal of legend animation-frame scheduling:

These results do not validate the synchronous legend changes.

- `npm run build`: all four JavaScript distributions and the minified stylesheet built successfully.
- `npm test -- --reporter dot`: 3,843 passing, 44 pending, and a clean exit. The tests completed in 47 seconds.
- `npm test -- test/legend-layout.mjs test/legend-selection-demo.mjs test/legend-dom.mjs test/legend-contracts.mjs test/legend-selection.mjs test/legend-cursor-points.mjs test/dom-options.mjs --reporter dot`: 356 passing, 26 pending.
- Demo snapshots: 282 passing. Updates to 298 snapshot files add only the default `.u-btm` class, with drawing data unchanged.
- `git diff --check`: no whitespace errors.

The new membership fixture contains 18 cases, including visible and hidden legends and selection-only structural updates.
An earlier full-suite run timed out after coverage output. The latest run completed within the same 120-second limit.

The runtime fixtures include `test/legend-selection.mjs`, `test/legend-selection-demo.mjs`, `test/legend-layout.mjs`, and `test/legend-cursor-points.mjs`.
They use Happy DOM and the existing canvas instrumentation.
Demo checks cover cluster selection, isolated outliers, empty gaps, and changing server rankings across the day.
They also cover every proximity setting, stationary-cursor refresh, unavailable distances at Infinity, and control cleanup.
Top-server tests cover idle fallback, hover transitions, timestamps, limits, missing samples, and unchanged cursor indices.
Behavior-switch tests cover the initial limit, callback replacement, preserved cursor position, and chart reuse.
Control tests cover limit changes, both layouts, all four positions, state preservation during chart recreation, and listener cleanup.
The extracted history exactly matches the original log-scale dataset.
Layout tests cover explicit modes, all four sides, stats legends, custom mounting, resize, and deferred overlay-rectangle refresh.
These tests use mocked geometry, not browser layout.
The full suite also covers existing legend contracts, cursor behavior, layout, and keyed row interactions.

The consumer type fixture is `test/legend-selection-types.ts`.
This command reaches an existing syntax error in `dist/uPlot.d.ts`:

```sh
npm exec --offline --package=typescript@5.9.3 -- tsc --strict --noEmit --skipLibCheck --target es2020 --module commonjs test/legend-selection-types.ts
```

`PathBuilderDiscreteValues` uses the reserved word `enum` as a tuple element name.
TypeScript reports six parser errors, which `--skipLibCheck` cannot suppress.
This change leaves that unrelated declaration unchanged.
The consumer type check remains blocked.

The validation checklist covers these contracts:

- Omitted stages preserve existing behavior, including hidden series and X-row eligibility.
- No-callback legend updates reuse identity selection across explicit index changes, while add/delete still invalidates it.
- Removal of all callbacks restores identity order and permits later callback use.
- Comparator ties use original series order across repeated cursor updates.
- Empty filters, fractional bounds, negative bounds, reversed bounds, and oversized pages produce the documented range.
- `legend.order` never contains X or changes series-indexed values and indices.
- `legend.show: false` still updates selection before hooks.
- `setLegend({})` observes closure changes without changes to values or indices.
- Cursor and explicit updates select once, then update the DOM synchronously before the associated hooks.
- Cursor focus and value changes share one legend render per operation.
- Visible and hidden structural edits remain pending without a new frame, selection microtask, or canvas commit.
- Structural changes inside hooks require another refresh after data alignment.
- `addSeries(); setData(newData, false); setLegend({})` resolves structural work without a canvas commit.
- Visibility and focus mutations share one selection pass at the existing commit, including with focus alpha equal to one.
- That commit completes the DOM update without a later legend frame.
- Initial mount observes initialized data and layout, with ready state and `status` true, before the `ready` hook.
- Explicit `setLegend` index overrides leave physical cursor distances unchanged.
- Core buffer reuse preserves the readonly contract, and copied snapshots retain their values.
- Cursor movement at one X index updates a proximity filter without unnecessary formatting.
- Rounded display values do not hide raw-value sort changes.
- Distance tracking works without focus dimming and before bias or threshold decisions.
- Missing values, hidden series, cursor exit, and series removal clear stale distances.
- Rotated axes, reversed scales, mode 2, custom distances, and multiple pixel ratios retain distance semantics.
- Multi-value formatting and custom labels remain compatible across page changes.
- Row toggles and isolation still target the correct series after reorder.
- Mount, destroy, and repeated demo creation leave no listeners or pending frames.

Measurements must separate callback costs, full formatting, DOM reconciliation, and browser layout.
The existing legend benchmark provides a starting point, not evidence for this implementation.
A temporary Firefox 157.0.1 headless harness checked physical grid placement, dimensions, wrapping, custom mounting, and the actual demo.
The final run passed 911 assertions across 89 current geometry snapshots and 32 checkpoint comparisons.
Left/right legend dimensions matched checkpoint CSS. Top/bottom inline legends wrapped across resize, and unused tracks collapsed without spacing.
The direct canvas matched the root's size and offset when the root also served as the chart wrapper.
The harness and its isolated browser profile were removed after validation.
Long unbreakable top/bottom values can exceed the plot width and lose plot-centered alignment. The same behavior occurred with checkpoint CSS.
This validation does not cover Chromium, WebKit, or browser performance.
