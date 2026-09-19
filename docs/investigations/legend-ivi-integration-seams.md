# ivi legend integration seams

Recorded on 2026-09-18.

## Scope

This assessment covers the current monolithic ivi legend and its integration with uPlot.

The assessment examines these areas:

- Legend construction and destruction
- Cursor interaction
- Focus updates
- Legend value updates
- Series visibility changes
- Series insertion and deletion
- Hooks and synchronization
- Deferred canvas commits
- New caches and generated runtime state

The original assessment was static. A later audit checked each finding against the source.

The validation sections record the current source-suite and tooltip results. Earlier test and build results remain historical.

The candlestick, inverted log, and box-whisker consumer migrations are implemented. Full demo validation remains incomplete.

The box-whisker tooltip now uses the same deferred `legend.mount()` approach as candlestick. Four shared tiny-fixture tooltip tests passed without full demo execution.

The [migration scope review](#migration-scope-review) separates migration regressions from existing bugs and optional improvements.

The [completed-change review](#completed-change-review) records two approved reversions and the legend-only unchanged-visibility optimization. All three are implemented.

## CURRENT contract — authoritative

This section supersedes earlier promises about synchronous DOM, complete isolation state, and current hidden-legend values, including historical validation expectations.

Public methods still update their logical state synchronously. Hooks require updated data structures, not updated legend DOM.

In ordinary nonreentrant cursor flow, uPlot prepares cursor indexes and focus before callbacks. It refreshes `legend.values` only for a shown live legend. Each visibility setter applies its own change before its hook.

Visibility setters directly invalidate the shown legend only when `s.show != show`. Unchanged single-series and all-series requests, series 0, and invalid targets cause no direct legend invalidation.

An unchanged `show` setter does not guarantee an implicit legend refresh after direct label, class, or visibility mutations. Independent canvas work or hooks can still request a later legend render.

Legacy range invalidation, commit/draw behavior, cursor-point handling, hooks, and sync remain, including for unchanged visibility. Combined focus and visibility updates still work. Explicit `setLegend()` remains unchanged.

Isolation calls `setSeries()` sequentially for each Y series. Source hooks can observe intermediate visibility for other series, and sync publication occurs per setter.

Nested setters can change later series. The outer iteration can overwrite those changes when it reaches those series. Isolation is not a transaction.

This contract does not make every derived field current in every hook. Existing `setData()`, scale, and canvas derivation phases remain separate.

Nested callbacks no longer suppress an outer cursor-focus notification or publication after they change focus or series indexes. Ordinary hook-visible data preparation remains unchanged.

Destruction inside marker callbacks is unsupported. Ordinary destruction still cancels the pending frame, and later renderer calls remain inert.

`src/legend.js` exposes synchronous `render(values, focusedSeries)` and `destroy()` methods. The renderer owns no frame scheduling.

The renderer uses `defineRoot(() => {})`. Core requests every update explicitly, and the view has no stateful component invalidations.

`npm run build` regenerates `src/legend-ivi.js` before Rollup builds the distributions. A lazy `createLegend(self, parent, opts)` wrapper preserves DOM-free imports.

The generated module supports direct browser imports of uPlot source without a package resolver.

Each distribution header places the ivi repository link directly after the uPlot link. The full license remains in the packaged `LICENSE-ivi` file.

Legend `cursor.bind` factories run during element rendering, before `legend.mount()`, not on first interaction. Stable directives avoid rebinding during ordinary value and focus updates.

Returned listeners attach directly with `addEventListener()`. Returning `null` suppresses registration. Only `legend.mount()` guarantees the complete table, not an individual binding directive.

Core owns one pending `requestAnimationFrame` request per chart and a legend-dirty flag. Further legend invalidations share that request.

Core clears the frame handle and dirty flag before rendering. A callback can therefore request a later frame without losing its invalidation.

The frame renders current values, focus, visibility, and row classes. Each series captures its label and marker presentation on its first render.

`legend.markers.show` is an initialization-only chart setting. Later label assignments, marker-mode changes, and index shifts do not refresh existing presentation.

Supplied HTMLElement labels remain live DOM nodes. Their contents, attributes, listeners, and input state can change without replacing the supplied element.

The first frame creates a complete table, then calls `legend.mount()` once. Mounting can follow `ready`.

No standalone method guarantees synchronous legend DOM. This also applies to `batch()`, initialization, `addSeries` hooks, and `ready`.

With synchronous initialization, the first pending frame absorbs the `_init` microtask value refresh. A custom delayed initializer can still mount placeholder values.

The approved reversion restores the master formatting policy:

- `_commit()` uses `FEAT_LEGEND && legend.show && legend.live && shouldSetLegend`.
- `setLegend()` uses `showLegend && legend.live`. `showLegend` already includes `FEAT_LEGEND && legend.show`.
- With `legend.show=false`, live `value` and `values` formatter refreshes do not run. No renderer exists.
- Value arrays and `activeIdxs` remain independent of DOM visibility and track structural changes. Initial null value entries remain without live formatting.
- Explicit `setLegend()` still updates indexes and fires its hook for a hidden legend. Hidden values are not promised current.
- A hidden cursor does not suppress formatting for a shown live legend. Cursor hooks and focus remain intact.

The early multi-value schema call `series[1].values(self, 1, 0)` remains, including for a hidden live legend. This is master behavior, not a zero-total-call promise.

This policy concerns `legend.show=false`, not legends hidden through CSS.

Scalar legend records now allocate on the first formatting call and update in place, including placeholder transitions. Retained references show current values, not old snapshots.

Multi-value formatter results remain caller-owned. Formatting frequency and hook timing remain unchanged.

Sequential sync messages share the pending core frame. Their data changes and hooks remain per-event, not atomic.

Chart destruction cancels the pending frame. Core ignores a frame callback after destruction.

Renderer `destroy()` sets `root=null`. The root guard makes later render calls inert.

A chart `destroyed` flag invalidates pending `queuedCommit` work and blocks new scheduling and `_commit()` entry. It does not abort an active commit.

The document-listener leak and late-focus canvas problem remain unresolved. Cursor-point DOM currently updates synchronously, but that timing is not a contract.

## Audit and earlier cleanups (historical)

The findings fall into three groups:

- Incidental behavior that we can relax without a new public API
- Useful optimizations or extension points that need an explicit contract
- Separate correctness problems that need their own regressions

The first cleanup covered findings 7 and 12.

- Initial and cleared legend focus now use the same state and opacity.
- Focus changes do not render the legend when `focus.alpha` is `1`.
- Isolation uses a shared visibility helper instead of repeated public setter calls.
- The `deferLegend` flag and its restoration block are gone.
- Each row creates its value cells with one array pass instead of two.

That version retained synchronous public setters and performed one direct synchronous isolation render before notifications. It also permitted additional renders from hooks and later commits.

The earlier tests covered complete visibility state inside deferred hooks, including mode 2. The results did not establish elapsed-time improvements.

The second cleanup combined cursor focus and value renders (9). That version delivered cursor-induced focus hooks after the combined render.

It also replaced numeric chart focus with series identity. That identity remains part of the current design.

The current renderer replaces these synchronous render guarantees with one pending frame per legend. Findings 15 and 18 describe the related lifecycle corrections.

Whole-table mounting (4), HTMLElement labels (3), and lazy binding (2) remain deliberate adapters, not immediate cleanup targets.

## Main timing models

The current implementation combines these update models:

1. Logical setters and ordinary hook delivery are synchronous. Existing deferred-hook batching remains separate.
2. Legend DOM updates use one pending animation frame per legend.
3. Canvas work uses a deferred `commit()` microtask.
4. Cursor-point DOM currently updates synchronously, without a timing guarantee.

Most integration complexity occurs when one operation crosses these models. A frame coalesces DOM work, not data mutations or notifications.

## ivi idiom review

The review used the installed `ivi@5.1.0` documentation and runtime, not assumptions about another framework's scheduler.

Sources include `node_modules/ivi/README.md`, `dist/lib/core.js`, and `dist/template/compiler.js` within that package.

### Template simplifications implemented

- Dynamic table and row classes now use `class=${...}`, not `.className=${...}`.
- Scalar value cells, text labels, and header cells now use `.textContent=${...}`.
- Stateless text helpers now live outside `createLegend()`.
- The fixed multi-value header is constructed once per legend, not once per render.

The compiler gives `class` a specialized opcode. For HTML elements, that opcode calls the cached native class setter rather than a generic property lookup.

The `.textContent` path still creates a DOM text node for nonempty text. It avoids a separate ivi state node for that child.

Nonempty-to-nonempty updates reuse the text node. Null, undefined, false, and empty strings leave no text child. Numeric zero remains visible.

These bindings expect scalar values, not arrays or ivi virtual nodes. HTMLElement labels retain their separate directive.

### Scheduler review: retain external scheduling

The README documents `createRoot()` as a microtask scheduler for component invalidations. `update(root, view)` itself reconciles synchronously.

The current legend has no stateful components to invalidate. It constructs one stateless view and passes that view to `update()`.

The renderer now uses `defineRoot(() => {})` instead of the default `createRoot()` scheduler. Core retains its animation-frame scheduling and cancellation.

| ivi API | Role | Consequence for this renderer |
| --- | --- | --- |
| `component()` and `invalidate()` | Schedule component updates through the root. | A conversion moves marker callbacks inside active reconciliation. |
| `defineRoot()` | Customize the root invalidation handler. | Frame scheduling still needs an external callback. |
| `useAnimationFrameEffect()` | Schedule component effects before a frame. | It does not defer component reconciliation itself. |

A component conversion is not a direct scheduler substitution. It adds component invalidation plumbing and can change update timing.

The earlier review also protected destruction inside marker callbacks. The user explicitly removed that guarantee and its in-render root checks.

The renderer now calls `update(root, view())`, then mounts the complete table on its first render.

Core owns the pending-frame handle and cancellation. Renderer entry still ignores calls after disposal, without another component, root, render snapshot, or reentrancy flag.

Microtask batching also differs from frame batching. Separate events can produce multiple microtask updates before the browser paints.

This decision is not a general rejection of native ivi scheduling. Native invalidation fits stateful components with render functions that do not destroy their active tree.

### Other patterns retained

- `List` receives the `series` array directly and keys entries by series identity. Its row callback receives the original index and returns `null` for excluded series zero.
- `for...in` retains the existing schema behavior for inherited enumerable keys.
- Stable binding directives preserve `cursor.bind`, event suppression, target identity, and native listener `this`.
- The HTMLElement directive avoids reattaching an unchanged supplied label.
- Table capture stays separate from `legend.mount()`. Directives run before all dynamic children and insertion finish.
- Cached label and marker views retain their first presentation for each series object. New series receive new views.

These patterns serve existing contracts. Replacing them with fewer expressions alone does not make the integration simpler.

### Test DOM correction

The first focused run exposed a Happy DOM mismatch, not a production renderer fault.

ivi caches `Node.prototype.textContent` and calls its setter on elements. Happy DOM's base setter does nothing, although its element setter works.

A direct probe reproduced the difference: the cached setter produced zero children, while ordinary assignment produced one text child.

`scripts/instrument.mjs` now delegates that cached setter to Happy DOM's element implementation for element targets. It also converts numeric zero to a DOM string.

This correction affects only the test harness. It does not patch ivi, browser globals in production, or generated runtime code.

`test/instrument-dom.mjs` covers the cached setter. Legend tests cover scalar transitions, empty children, literal markup text, and retained text-node identity.

No elapsed-time performance improvement is claimed. The compiler and source establish the removed state nodes and repeated header construction.

## Legend renderer seams

### 1. `rowMeta` retains immutable presentation views

`src/legend.js` retains one `WeakMap` per legend. Each entry stores stable binding directives and immutable label and marker views.

**Audit status: simplified again.** The cache no longer stores the rendered index, marker mode, or separate style fields.

Marker callbacks run once, on the first rendered appearance of each series object. A zero-width border skips the dash and stroke callbacks.

Insertion creates presentation for the new series. Deletion and reorder do not refresh surviving rows, even when their indexes change.

`markers.show` is captured when core creates the renderer. Later mutations do not switch markers or label coloring, including for newly added series.

Each row captures the applicable callback results on its first render. Existing rows do not track callback identity, closure state, or series width.

The cache also ignores replacement `series.label` assignments after first render. Values, visibility, focus, row classes, and structure remain dynamic.

Stable directives register listeners during element rendering. The current index selects the bind or unbind directive, preserving series-zero event eligibility.

A removed and reused series object reuses its presentation views. A remounted event target still initializes its binding again.

This change adds no invalidation API or revision counter. It removes repeated decoration construction and index/mode checks.

### 2. `cursor.bind` uses element directives

The public bind factory requires its target element:

```js
cursor.bind[type](self, target, handler, onlyTarget)
```

Master already had the element during listener registration. The earlier declarative adapter instead waited for an event to supply `currentTarget`.

The user rejected that timing difference. Stable directives now receive the actual element during rendering and invoke the factory immediately.

A returned listener attaches directly with `addEventListener()`. The browser supplies its `this` and `currentTarget`, and callers can remove it directly.

A `null` result attaches nothing. Stable directive identity prevents repeated factory calls for unchanged elements, including factories that return `null`.

New and remounted elements bind during rendering. Ordinary value, focus, visibility, class, and Y-index updates do not rebind retained elements.

Each row has a paired unbind directive for series-zero eligibility changes. It removes the stored click and enter listeners from that header.

The table capture directive also installs its leave listener when cursor focus is enabled. No new listener map or per-event adapter remains.

ivi directives do not supply automatic unmount cleanup. Normal row removal removes the subtree, and chart disposal removes the table.

Individual directives run during reconciliation, before all children and insertion finish. `legend.mount()` still receives the complete table after all bindings exist.

The runtime also passes `onlyTarget` as a fourth argument. The current TypeScript factory declaration lists only three arguments.

A removed row can remain in the DOM until the next frame. Core rejects its events when the current `seriesIdx` is `-1`.

### 3. HTMLElement labels require a directive

ivi does not accept a raw `HTMLElement` as a virtual child.

**Audit status: simplified again.** The label helper reads `series.label` once, when the series first renders.

Text and HTMLElement labels use separate small templates. The resulting view remains in the existing metadata record.

The HTMLElement template has one adapter. It attaches the original supplied element when the label mounts. Cached view reuse avoids repeated directive construction.

The supplied element remains live. External changes to its contents, listeners, attributes, and input state survive ordinary legend updates.

Replacement `series.label` assignments do not replace the displayed label. Text-to-element and element-to-text transitions are no longer part of the supported contract.

The renderer retains one row template. Values, focus, visibility, and row classes remain dynamic around the cached marker and label children.

Each supplied element needs exclusive ownership by one label. External mutation of the label wrapper's children remains unsupported.

A cross-realm element can fail the global `instanceof HTMLElement` test. This limitation also existed in the manual implementation.

### 4. Whole-table mounting has unusual ownership

The renderer creates its ivi root under the chart root.

Core schedules the first legend frame during chart construction. That frame creates the complete table, then calls `legend.mount()` once.

The mount callback can run after `ready`. Initial hooks receive prepared data structures, not a guarantee that the table exists.

The mount callback can move the table to another container. The ivi root still records the original parent.

Destruction therefore uses this sequence:

```js
unmount(root, false);
table?.remove();
```

`unmount(root, true)` can remove the table through the wrong parent after relocation.

This unusual lifecycle is necessary because whole-table relocation is public behavior.

A different API can provide the final host before `createRoot()` runs. That change requires a new mounting contract.

Core cancels the pending frame on chart destruction. Renderer destruction sets `root=null`, which prevents later render calls from accessing the disposed root.

### 5. The generated runtime caches one DOM realm

`src/legend-ivi.js` initializes the ivi runtime on the first legend call.

This lazy initialization preserves DOM-free module imports.

The runtime then caches these items from the first DOM realm:

- `document`
- DOM constructors
- DOM prototypes
- Template elements
- Native DOM methods

The module reuses this singleton for later charts.

One imported uPlot module can therefore have problems with multiple windows or iframe realms.

The cache exists because ivi reads browser globals during module initialization.

### 6. `setData()` updates more than values

`setData(values)` stores the latest values and schedules a frame for these parts of the legend:

- Values
- Series insertion and deletion
- Row order
- Visibility classes
- Marker rows
- Labels

The renderer reads the mutable `series` array through its closure. It stores only current values and the focused series.

This API is small, but its name hides a complete state invalidation.

The current private API keeps `setData(values)` separate from `setFocus(series)`. The earlier optional focus argument is removed.

Each setter independently invalidates the renderer. Both setters share one pending frame, so their calls do not require a combined API.

The frame reads the latest state rather than a snapshot from the first request. Focus retains its alpha-`1` fast path.

The mutable values arrays have no equality check. The visibility comparison in `setSeriesShow()` does not change this renderer contract.

The value arrays exist even without legend DOM. Live formatter refreshes require a shown live legend.

### 7. Focus uses an implicit sentinel

Before the cleanup, the renderer gave three meanings to the focused value:

- `undefined` means that focus never ran.
- `null` means that focus was cleared.
- A series object identifies the focused series.

The initial state had no inline opacity. A cleared focus wrote opacity `1`.

This distinction preserved an incidental DOM difference.

**Audit status: simplified.** The renderer now initializes focus to `null`. Initial and cleared focus both use opacity `1` when `focus.alpha != 1`.

This changes the initial inline style. Custom CSS can no longer supply initial row opacity through an ordinary stylesheet declaration in that configuration.

When `focus.alpha == 1`, the renderer leaves opacity unset and skips focus reconciliation. Chart focus state and hooks still update.

Repeated requests for the same focused series also skip reconciliation.

These skipped renders no longer refresh unrelated in-place label, class, or value changes. A later data or visibility update still refreshes those properties.

The initial opacity change also applies with cursor focus disabled. Programmatic focus remains available in that configuration.

## Initialization and update flow

### 8. Initial construction uses the first deferred frame

**Current status: changed contract.** The renderer no longer forces a synchronous placeholder render.

The first `setData()` call schedules a frame. Synchronous initialization and the `_init` microtask value refresh complete before that pending frame runs.

The frame uses the latest state, creates the complete table, and calls `legend.mount()` once. It can run after `ready`.

Initial `addSeries`, `init`, and `ready` hooks do not require legend DOM. They receive the logical state available at their existing initialization phase.

A default cursor outside the plot can still produce placeholder values. A custom delayed `then(self, init)` can let the frame mount placeholders before data installation.

Earlier tests required mounting before `init`. Those expectations describe a previous version, not the current contract.

### 9. Cursor data precedes notifications, while DOM follows later

**Current status: deferred renderer.** The local cursor update uses this order in ordinary nonreentrant flow:

1. Calculate cursor geometry, indexes, and the closest series.
2. Apply chart focus through `setFocus()`, which also invalidates legend focus.
3. Call `setLegend()` for a requested legend update. Refresh values only for a shown live legend, then fire the hook.
4. Publish the requested mousemove sync event.
5. Fire the changed-focus `setSeries` hook, then publish its requested sync event.
6. Fire the requested `setCursor` hook.

Data preparation precedes these callbacks. They can inspect current cursor indexes and focus without a legend DOM update. Values are current only for a shown live legend.

This guarantee concerns the cursor path, not every derived field in every hook. Existing data, scale, and canvas phases remain unchanged.

Chart `setFocus()` owns chart focus state and legend focus invalidation. Public `setSeries()` has no special combined one-render branch.

Independent renderer setters coalesce values and focus through the pending frame. A focus-only update does not call value formatters.

Shown nonlive legends retain the focus-only path. Hidden legends skip live formatter refreshes and have no renderer. Cursor hooks and focus remain intact.

The focused series uses object identity in chart state and the renderer. Hook and sync arguments remain numeric indexes.

Closest-series calculations remain local to each cursor call. The single cursor point tracks its target independently of chart focus.

These notification behaviors remain:

- Repeated hidden-cursor updates do not emit unchanged focus-clear hooks.
- Programmatic cursor updates publish focus clears only when publication was requested.
- Public `setSeries()` still notifies for unchanged requests.
- Received visible mousemoves retain focus. Received hidden mousemoves clear focus without automatic republication.

Sequential mousemove and focus messages share the receiver's pending frame. Receiver data updates and hooks still occur separately for each event.

A formatter or hook can call a nested setter. This flow does not provide atomic notification delivery across reentrant callbacks.

The user approved removal of both focus supersession checks. An outer cursor call can notify or publish its original focus index after nested state changes.

Isolation likewise provides no supersession checks across its sequential setters.

This is not a general transaction across arbitrary callbacks. For example, sync filters can themselves mutate state during publication.

The frame reads the latest renderer state. Neither outer nor nested setters promise an immediate DOM update.

The late-focus canvas problem in finding 10 remains unresolved.

### 10. Focus during `_commit()` can miss a canvas redraw

`_commit()` performs these phases:

1. Resolve scales.
2. Apply layout.
3. Draw the canvas.
4. Update the cursor.
5. Update the legend.

`updateCursor()` can select a new focused series after drawing finishes.

`setFocus()` changes series alpha and calls `commit()`.

The active commit still owns `queuedCommit`. The new `commit()` call does not queue another draw.

Logical focus changes immediately, and legend opacity follows in a frame. The canvas can keep the previous alpha until another operation schedules work.

**Classification: pre-existing scheduler bug, not a legend regression.** The same failure occurs on `master` before the ivi migration.

This issue is separate from the legend cleanup. A fix and any custom-renderer migrations are not prerequisites for that work.

`_commit()` already schedules follow-up work for pending scale or layout changes. A pure focus change does not set those flags.

Other pending work can therefore hide the problem.

**Reproduction status: confirmed.** `test/cursor-focus.mjs` retains the regression for the proposed single-draw contract with `it.skip` pending the separate scheduler fix.

The chart has two Y series, three points, fixed ranges, and a stationary cursor. Replacing the Y data switches the closest series.

| State after the data commit | Series 1 alpha | Series 2 alpha |
| --- | --- | --- |
| Logical series state | `0.25` | `1` |
| Actual canvas stroke calls | `1` | `0.25` |

The test observes actual `stroke()` calls through a local context wrapper. It does not change the shared canvas recorder.

The logical indexes and legend values update correctly. Two additional microtask waits produce no corrective draw.

The regression uses primitive snapshots, a 128 MB Node heap limit, and a 15-second command timeout. This is not a stress test.

#### Comparison with `master`

Local `master` and the local `origin/master` ref both identify commit `4aa4c1d801fe6f61c07881f037411807bdd3a26b` (`improve y-sync-zero demo, single-pass`). No remote fetch ran.

That commit is also the merge base with `ivi-legend`. The only committed change after it is `022507dc` (`Rewrite legend rendering with ivi`).

The comparison used an isolated archive of the complete `master` source tree. The working branch and its source files remained unchanged.

Both versions ran the same temporary copy of `test/cursor-focus.mjs` with the existing canvas mock. Only the selected source import differed between runs.

The comparison enabled the legend on both versions. At that time, the branch refreshed hidden values, unlike `master`. The approved reversion removes that difference.

| Version | Logical alpha | Stroke alpha | Draws after replacement |
| --- | --- | --- | --- |
| `master` at `4aa4c1d8` | `[0.25, 1]` | `[1, 0.25]` | `1` |
| Current working source | `[0.25, 1]` | `[1, 0.25]` | `1` |

Both runs passed the logical-state and draw-count assertions, then failed the same stroke-alpha assertion. Neither run scheduled a corrective draw during two additional microtask waits.

Each run used a 128 MB Node heap limit and a 15-second command timeout. The temporary archive and comparison test were removed afterward.

The relevant `master:src/uPlot.js` code already has this sequence:

- Lines 2457–2463 paint the canvas.
- Lines 2470–2472 update the cursor before releasing commit ownership.
- Lines 2740–2757 update focus and request a commit.
- Lines 2327–2335 suppress that request while another commit owns the queue.
- Lines 2480–2484 release ownership and reschedule only pending scale or layout work.

`demos/grouped-bars.js` and `demos/scatter.html` also match `master` exactly. Their draw-derived hit testing is not a new legend dependency.

This comparison establishes that the bug predates the legend migration. It does not identify the original introducing commit.

#### Why a phase reorder alone is unsafe

Final layout must precede cursor calculation. Layout can change Y ranges, plot bounds, and pixel ratios.

Cursor-marker callbacks also require current drawing results:

- Default colors read `series.points._fill` and `_stroke`, which `drawSeries()` refreshes.
- Pixel alignment reads the current point path's `_width`.
- Custom marker size and bounding-box callbacks can consume path-generated geometry.

Deferring only the DOM writes does not solve these dependencies. The marker callbacks themselves must run after their inputs exist.

A separate marker pass can preserve these inputs without another cursor move, hit test, focus search, or notification.

#### Custom hit testing creates a stronger dependency

Two existing demo providers calculate logical indexes from geometry that drawing produces:

- `demos/grouped-bars.js` clears a quadtree in `drawClear`. Its bar path builder inserts rectangles, and `cursor.dataIdx` queries them.
- `demos/scatter.html` also fills a quadtree during path generation. Its hit rectangle controls the index, focus distance, marker size, and legend values.

The scatter path callback paints directly before it finishes the hit geometry. Moving path generation earlier does not make that callback geometry-only.

These providers need current geometry, not synchronous DOM. The relaxed DOM contract does not remove this dependency.

A pre-paint cursor pass cannot transparently preserve arbitrary paint-produced hit tests and guarantee one correctly focused draw.

#### Separate follow-up: possible runtime change

This decision belongs to a scheduler follow-up, not the legend migration.

The proposed single-draw contract is geometry first, then interaction, then painting:

1. Finalize scales and layout.
2. Resolve cursor indexes, focus, alpha, and legend values from data and current geometry.
3. Paint once with the resolved alpha.
4. Evaluate draw-dependent marker callbacks and update marker DOM.

Applicable interaction notifications require prepared logical state. Their placement does not need to preserve incidental DOM timing.

This contract requires hit-test providers to supply geometry independently of painting. The grouped-bars and scatter providers need explicit migrations.

Rebuilding all hit geometry on every mousemove is not an acceptable performance assumption. A migration needs shared geometry preparation or a defined invalidation policy.

The alternative preserves existing paint-produced hit tests and schedules a second draw after a late focus change. That approach retains the feedback loop.

No runtime reorder, compatibility fallback, or public API was added in this investigation. The single-draw regression remains skipped pending the separate scheduler fix.

#### Callback-generated refresh requests

`_commit()` clears `shouldSetCursor` after cursor callbacks. A callback can request new data, then lose its new cursor request to that assignment.

The outer `shouldSetLegend = false` assignment can similarly erase a request from a legend hook.

A phase split must preserve requests made during callbacks. Existing ready and range-hook tests also need to pass.

Two bounded cases in `test/master-scheduler-bugs.mjs` now reproduce lost cursor and legend refresh requests on `master` and the current source.

Each hook requests replacement data once, with unchanged scale ranges. The later commit leaves cursor indexes or legend values stale.

Both cases remain skipped pending scheduler fixes. Dynamic marker colors, custom point widths, and demo compatibility remain separate validation requirements.

### 11. Sync rendering coalesces, but sync data and hooks remain per-event

Isolation uses sequential public setters on the source chart. The first cleanup removed `deferLegend`, which remains unnecessary.

For each Y series, the source chart uses this sequence:

1. Apply that series visibility through `setSeries()`.
2. Invalidate legend data through `setData()`.
3. Fire that setter's hook, then publish its requested sync event.

Each source hook sees its own change applied, but other series can retain intermediate visibility. Hooks do not require current legend DOM.

Each sync event still describes one series. A receiving chart handles each event with an ordinary `setSeries()` call.

Sequential messages share one pending renderer frame. No bulk protocol or receiver-side buffering is necessary to coalesce DOM work.

Source and receiver data mutations and hooks remain per-event. Hooks and sync filters can observe intermediate visibility, while DOM can reflect an earlier frame.

If a nested setter changes a later series, the outer isolation iteration can overwrite that change when it reaches that series.

The receiver uses `_pub = false`, so it does not automatically publish the event again. User hooks can still publish new changes.

Atomic receiver data and hook delivery remain a separate contract decision. Renderer scheduling alone does not provide that behavior.

A future bulk protocol must retain or redefine per-series matching and pub/sub filters. Buffering also requires an explicit notification contract.

### 12. Isolation used an overly broad `setSeries()` contract

`setSeries()` performs these tasks:

- Change focus
- Change visibility
- Hide cursor points
- Invalidate ranges
- Schedule canvas work
- Invalidate legend data
- Fire hooks
- Publish sync state

The earlier implementation required complete local visibility before isolation notifications. The approved contract now permits intermediate visibility for other series.

Originally, isolation called `setSeries()` once per Y series, and each call scanned the complete series array.

The suppression flag avoided repeated legend renders, but not quadratic series visitation. `commit()` already coalesced canvas requests.

**Current status: two-phase isolation reverted.** Isolation uses `series.forEach` and calls the public setter for each `i > 0`.

The call is `setSeries(i, isolate ? (i==seriesIdx ? son : soff) : son, true, syncOpts.setSeries)`.

The direct-target setter remains, so each call avoids a complete-series selection scan. All-series requests still iterate over the series array.

The private `setSeriesShow(i, show)` helper still owns visibility mutation, cursor-point hiding, range invalidation, and commit requests inside the setter.

Isolation no longer calls that helper directly for bulk mutation. The `updates` array and isolation stale-record checks are removed.

Each source hook sees its own setter change applied. Sync publication occurs per setter, and other series can retain intermediate visibility.

The outer iteration can overwrite nested setter writes to later series. No transaction preserves those writes against later outer setters.

The renderer coalesces legend DOM updates into one pending frame independently of `batch()`. The `deferLegend` flag and its restoration block remain unnecessary.

Unchanged visibility retains notifications and legacy canvas invalidation, but no longer causes direct legend invalidation. The approved optimization affects only legend invalidation.

The earlier complete-isolation-state and superseded-isolation-notification tests remain skipped as historical or optional contract references, not master bugs.

Active tests cover sequential hooks, per-setter sync, and frame coalescing. The four new cases failed before the change and passed afterward.

Neither isolation nor a standalone setter promises a synchronous DOM flush.

### 13. Dynamic series operations update only structural state

`addSeries()` and `delSeries()` immediately update these structures:

- The series array
- Legend value arrays and row invalidation
- Cursor index arrays
- Cursor-point arrays
- Hooks

They do not automatically invalidate scales or redraw the canvas.

Legend rows change in the next renderer frame. That frame is not a guarantee of a corresponding canvas redraw.

Callers need a later data or redraw operation for canvas changes. A redraw alone does not repair mismatched data arrays.

The second cleanup replaced numeric `focusedSeries` with series identity. Insertion no longer changes which series receives focus during a render.

An inserted series receives current focus-dependent alpha, `_focus`, and cursor-point opacity during initialization.

`cursorPtSeries` remains numeric. The next cursor update refreshes its target independently of chart focus identity, including after insertion.

Immediate focus clearing after deletion and immediate point-index maintenance remain structural lifecycle decisions.

The legend schema is also frozen from the original `series[1]`.

Adding or deleting a schema-defining series does not rebuild these values:

- `multiValLegend`
- `legendCols`
- `NULL_LEGEND_VALUES`

This is incidental legacy behavior.

### 14. Multi-value columns come from an early formatter call

uPlot calls this formatter during construction:

```js
series[1].values(self, 1, 0)
```

Normal chart data can be unavailable at that time. With `legend.live=true`, the call also occurs with `legend.show=false`.

This early schema call remains after the hidden-formatting reversion. It preserves master behavior, so the policy does not promise zero total formatter calls.

The result acts as a schema. The renderer stores its keys for all later rows.

This gives stable headers and stable cell order.

These details are incidental:

- Series 1 defines all columns.
- Index 0 is the schema request.
- The formatter runs before ordinary data setup.
- Inherited enumerable properties become columns.

An explicit legend-column configuration can remove this synthetic formatter call. It adds a new public API.

## Broader lifecycle hazards

These hazards are not caused by ivi. They can affect legend behavior.

### 15. Destruction invalidates pending work, not an active commit

**Current status: pending-work guards implemented.** A chart `destroyed` flag invalidates pending `queuedCommit` work.

The flag also blocks new commit scheduling and `_commit()` entry. A queued callback cannot start a commit after destruction.

Renderer `destroy()` cancels its pending animation frame and sets `root=null`. Queued renderer callbacks and later renderer setters become inert.

These guards do not interrupt an active `_commit()`. If a user hook calls `destroy()` mid-commit, the remaining active code can still run.

A skipped regression now reproduces continued painting after destruction in `drawClear` on both `master` and the current source.

This change does not fix the document-listener leak in finding 16.

### 16. Document listeners can survive destruction

During a drag, uPlot can attach `mouseup` to `document`.

`destroy()` clears `mouseListeners`, but it does not detach every registered listener first.

The document can retain the plot closure after chart destruction.

Destruction must detach each stored listener before it clears the map.

The skipped drag regression observes one document `mouseup` callback after destruction on both versions. Test cleanup explicitly removes the leaked listener.

### 17. Deferred hook batching can extend its own queue

`flushHooks()` iterates the live `hooksQueue` array.

A delivered hook can start another deferred batch. New hook entries can then enter the same array during iteration.

The loop can continue to consume entries that it adds itself.

A nested deferred batch can leave `deferHooks=true`. Subsequent `fire()` calls can then append queue entries instead of delivering them.

This is a static nontermination risk. A detached queue alone does not resolve deferral-state restoration.

`batch()` also has no `try/finally`. A thrown callback can leave batching state active.

Bounded regressions now reproduce lost canvas scheduling and lost hook delivery after an exception on both `master` and the current source.

Another case reproduces premature hook delivery from an inner nondeferred batch. No delivered hook starts another batch in that test.

These tests remain skipped. They do not execute the separate live-queue nontermination scenario.

A safer design uses these elements:

- A nesting counter
- State restoration in `finally`
- A detached queue snapshot for each flush

Nested batches need a defined notification order.

### 18. Scalar `setLegend()` no longer depends on cursor DOM

**Current status: resolved.** `legend.idxs` and `cursor.idxs` share `activeIdxs`.

Previously, cursor DOM initialization controlled the array length. With a hidden cursor, `activeIdxs.fill(opts.idx)` did not extend an empty array.

The current implementation allocates and structurally maintains `activeIdxs` independently of `cursor.show`. Scalar `setLegend({idx})` no longer depends on visible cursor DOM.

Legend value arrays also exist and track insertion and deletion independently of `legend.show`. Without live formatting, hidden values retain their initial null entries.

Explicit `setLegend()` still updates indexes and fires its hook for hidden legends. It does not refresh hidden values or create a renderer.

A hidden cursor still permits formatting for a shown live legend. The DOM-independent array correction remains separate from the restored master formatting policy.

Scalar-index coverage separates the active shown-legend case from the skipped historical hidden-value case. Active formatter-cost tests cover hidden-legend index updates and explicit hooks.

The historical hidden-value cases remain skipped for reference, not as master bugs.

### 19. `delSeries()` assumes a cursor-point element exists

`initSeries()` can store a null or undefined cursor-point slot.

This occurs with one shared cursor point or a custom point callback that returns no element.

`delSeries()` still uses this operation:

```js
cursorPts.splice(i, 1)[0].remove();
```

A valid series deletion can throw after partial array mutation and before its hook runs.

Shared-point mode requires enabled focus as well as `points.one`. Custom point callbacks can independently produce empty slots.

Conditional removal fixes the immediate error. Shared-point index state also needs a defined update policy.

Two skipped regressions now reproduce the null-slot and undefined-slot exceptions on `master` and the current source.

## Feedback-loop assessment

The normal legend path has no direct infinite feedback loop.

`_pub = false` prevents a receiving sync event from publishing itself again.

Sequential visibility setters apply their own changes before hooks. Deferred rendering coalesces DOM work for both source and receiver charts.

The notable feedback risks are indirect:

- A focus change requests a commit during an active commit.
- A deferred hook can add work to the queue that currently flushes.
- A synced isolate action expands one user action into many receiver data updates and hooks.
- Destruction from a mid-commit hook does not abort the active commit.

Pending commits and renderer frames now have destruction guards.

## Migration scope review

The previous plan mixed migration work with existing bugs and optional improvements. In particular, structural deletion repair does not belong to migration completion.

A fix belongs here when this branch introduced the failure or the agreed legend contract requires the change.

An existing bug does not enter scope merely because the migration changes nearby code.

The baseline is local `master` at `4aa4c1d801fe6f61c07881f037411807bdd3a26b`. The review compares that baseline with the current working tree, not only commit `022507dc`.

### Candlestick tooltip repair — implemented

Option 1 changes only the demo consumer and tests. `demos/candlestick-ohlc.js` exposes the named export `legendAsTooltipPlugin` for focused tests.

The plugin replaces its `init` query with an `opts` extension that sets `legend.mount(u, el)`. The mount callback styles the table, hides existing markers, and moves the whole table to `u.over`. Marker appearance remains unchanged.

The existing enter/leave listeners remain unchanged. At mount, the plugin reads `over.matches(':hover')` once, then calls `update()` with the current cursor. Before the table exists, the update guard prevents DOM access. The mount callback therefore uses the latest cursor position without a new cache.

This repair changes no core, library, or distribution files. It adds no scheduler or cache and leaves `columnHighlight` untouched.

### Inverted log consumer migration — implemented

`renderInvertedLogScales` in `demos/log-scales2.js` creates one shared `div` with `display: flex`, `justify-content: center`, and `gap: 16px`.

Both plots receive the same `legend` configuration. Its `legend.mount` callback sets each whole table's margin to `0` and appends the table to the shared host.

The consumer appends the host under the bottom chart root. Both complete tables appear side by side below the bottom plot. The duplicate `Time` row is deliberate.

The migration removes the `ready` hook, all row transfer, and the code that hides the top table. Each renderer retains all its rows. Each table's controls remain bound to the original chart.

The host shares the bottom chart's lifetime. This paired demo does not promise independent host survival after bottom-chart destruction.

The repair changes no core or distribution files. It adds no public API, cache, scheduler, or per-cursor work.

`test/demo-migrations.mjs` re-enables both existing log cases. The interaction case uses complete tables, waits for a frame before value reads, and checks each chart's controls independently.

The candlestick cases also remain enabled. No migration demo cases remain skipped in that file. These cases, demo execution, and snapshots remain unexecuted under the safety restriction. Demo validation is not complete.

### Outstanding migration compatibility decision

| Finding | Evidence | Migration action |
| --- | --- | --- |
| Strict Trusted Types enforcement rejects template creation without an accepting default policy. | `src/legend-ivi.js` assigns strings to `template.innerHTML`. Master creates legend elements without an HTML-parsing sink. | Make an explicit compatibility decision. This is source-established conditional breakage, not a browser reproduction. |

Deferred DOM is intentional. Both consumer migrations now support that contract. Whole-table relocation remains supported, but cross-root row transfer does not.

### Existing bugs excluded from migration completion

The recorded reproductions establish these failures on both master and the working source:

- Null and undefined cursor-point removal during series deletion
- Retained focus opacity after deletion
- Late-focus canvas alpha
- Retained document listeners
- Continued painting after destruction during an active commit
- Batch exception and nesting failures
- Lost cursor and legend requests from callbacks

Master also omits immediate `cursorPtSeries` maintenance during insertion and deletion. This conclusion comes from source inspection, not the proposed resize reproductions.

The live hook-queue nontermination concern remains a static risk. No stress test establishes it as a migration regression.

The skipped reproductions remain as documentation. None of these findings requires a runtime fix in this migration.

### Intentional changes and unproven risks

Deferred mounting and deferred initial series notifications remain deliberate compatibility changes. Lazy `cursor.bind` timing was removed in favor of registration-time directives.

Initial inline opacity and DOM-independent legend arrays also differ from master. These retained changes do not require hidden formatter refreshes.

Returned listeners now register directly. A focused test verifies that `removeEventListener()` removes the actual factory result.

Cross-realm failure is not an established migration regression. Master already captures a document and uses a realm-sensitive HTMLElement check.

Marker styles without arbitrary dependency tracking are also not a new limitation. Master calculates marker styles during row creation.

The empty-string crash came from DOM assertion formatting, not runaway ivi reconciliation. Primitive assertions address the test-reporting problem.

## Completed-change review

This review separates a strict renderer replacement from the later contract changes and optional fixes.

The original review described possible decisions. The user later approved two reversions: two-phase isolation and hidden-legend formatting. Both are implemented.

DOM-independent arrays, the direct-target setter, focus identity, and ordinary destruction guards stay. Later approved changes removed cursor supersession checks and marker-callback destruction protection.

### 1. Hidden-legend formatting: reversion implemented

**Classification:** The earlier contract expanded behavior beyond master. ivi does not require hidden formatter refreshes.

The earlier implementation calculated live values without the `legend.show` condition. That work called user formatters and added possible value-object allocations for hidden legends.

**Decision: implemented.** The user approved restoration of the master formatting policy:

- `_commit()` uses `FEAT_LEGEND && legend.show && legend.live && shouldSetLegend`.
- `setLegend()` uses `showLegend && legend.live`. `showLegend` already includes `FEAT_LEGEND && legend.show`.
- The guarded `setLegend()` formatting block no longer needs a second shown-renderer guard.

The reversion changes only hidden formatting and that redundant inner guard. DOM-independent `activeIdxs` and value arrays remain, including structural maintenance and initial null entries.

With `legend.show=false`, live `value` and `values` refreshes do not run, and no renderer exists. Hidden values are not promised current.

Explicit `setLegend()` still updates indexes and fires its hook even for a hidden legend. `_commit()` again skips the hidden-legend phase, as on master.

A hidden cursor still permits formatting for a shown live legend. Cursor hooks, focus, and the earlier sequential isolation decision remain intact.

The early `series[1].values(self, 1, 0)` schema call remains for hidden live legends. This is master behavior, not a zero-total-call promise.

CSS-hidden legends are outside this decision. Four historical hidden-value tests remain skipped for reference, not as master bugs.

Eight formatter-cost tests failed before this reversion and passed afterward. The combined suite reported 126 passing and 22 pending. The build passed.

Syntax and whitespace checks passed. The previous 118-passing, 18-pending result is historical.

### 2. Two-phase isolation: reversion implemented

**Classification:** The earlier design added a stronger notification contract and an optimization. Frame coalescing alone does not require two phases.

Master calls `setSeries()` for each Y series. Each hook can observe an intermediate visibility state.

The two-phase version first applied every visibility change, then delivered notifications from an `updates` array.

Those records stored an index, series identity, and requested visibility. Checks rejected records that nested callbacks superseded before hook delivery or sync publication.

**Decision: implemented.** This earlier reversion changes only two-phase isolation. Source hooks now require their own change, not complete isolation state across all series.

Isolation again calls public setters sequentially for each Y series. Sync publication occurs per setter. The pending frame still coalesces legend DOM.

The reversion removes the `updates` array, isolation stale-record checks, and direct bulk helper use. Direct target selection still avoids repeated full-series selection scans.

Nested setters can write to later series, but the outer iteration can overwrite those writes. This flow provides no transaction.

Complete-isolation-state tests and superseded isolation notification tests remain skipped as historical or optional contract references. They are not master-bug regressions.

Active tests cover sequential source hooks, per-setter sync publication, and frame coalescing. The targeted run reported 8 passing and 6 historical isolation cases pending.

Cursor notification guards and the other retained changes remain outside this reversion.

### 3. Cursor supersession checks: removal implemented

**Decision:** Retain the current data preparation order, but remove both checks for superseded focus and series indexes.

The cursor path applies focus before its focus notification. It refreshes values only for a shown live legend. Local closest-series variables remain.

An outer cursor call now delivers its focus notification and requested publication even if nested callbacks changed focus or shifted series indexes.

This deliberately drops the stronger nested-callback guarantee. Its former test remains skipped as a historical expectation, not a master bug reproduction.

Ordinary hook-visible data and publication conditions remain unchanged. This does not solve the separate master bug in late-focus canvas painting.

Repeated hidden-cursor updates also no longer deliver unchanged focus-clear hooks. Publication now obeys the caller's request on that path.

These notification differences are not requirements of ivi. They are small parts of the unified focus path, not separate caches or scheduling machinery.

### 4. Focus identity and inserted-series alpha: retain for consistent rendering

**Classification:** A broader state refactor with an adjacent insertion correction.

Master stores chart focus as an index. The current chart and keyed renderer use the same series object identity.

This prevents a structural legend render from assigning focus to a different object after an index shift.

`setSeriesFocus()` also initializes an inserted series with the current alpha and focus state. This corrects behavior beyond a direct DOM replacement.

**Recommendation:** Keep the identity model and the shared helper. Restoring numeric chart focus requires coordination with keyed renderer focus.

The shared cursor point still tracks a numeric target independently. Its next-update presentation check must not depend on chart focus changing.

The active insertion regression covers that distinction. Immediate point-index repair and deleted-focus cleanup remain excluded follow-ups.

### 5. Chart destruction guards: small, separable legacy fix

**Classification:** An existing lifecycle correction, not a requirement of the new renderer.

The change adds one boolean, two guards, and state assignments in `destroy()`. It cancels pending chart work but does not interrupt an active commit.

The callback-identity check in `commit()` already exists on master. That check is not added migration complexity.

**Recommendation:** Keep this small fix, or separate it from the migration if a minimal patch is more important.

After the scheduler move, core RAF also uses `destroyed`. A canvas-only reversion must retain that flag, frame cancellation, and post-destruction frame guards.

Renderer entry and disposal checks remain independent. The pending-chart-commit test and lifecycle contract require adjustment after a canvas-guard reversion.

### 6. DOM-independent arrays: small adjacent corrections

**Classification:** Logical-state separation with fixes for existing array behavior.

`activeIdxs` no longer depends on `cursor.show`. This fixes scalar `setLegend({idx})` with a hidden cursor, including a visible legend.

Legend value arrays no longer depend on legend DOM. Indexed insertion uses `splice()` instead of the previous row-initialization `push()`.

**Recommendation:** Keep this state separation. It removes visibility-dependent bookkeeping and gives initial hooks complete structural arrays.

Restoring cursor-dependent allocation reintroduces the scalar-index bug. The approved hidden-formatting reversion retains these arrays and their structural maintenance.

### 7. Direct single-target visibility selection: optional, low complexity

**Classification:** An independent optimization, not a migration regression fix.

`setSeries(i, {show})` selects one eligible Y series directly. All-series requests retain iteration.

Direct selection adds a branch, numeric coercion, and index validation. It adds no cache. The separate approved optimization now skips direct legend invalidation for unchanged visibility.

**Recommendation:** Keep the optimization unless the patch must contain only migration requirements.

A reversion can restore the filtered traversal while retaining `setSeriesShow()` and renderer invalidation. Only the zero-unrelated-read assertions inherently require direct selection.

**Narrow review: approved legend-only optimization implemented.** In `src/uPlot.js`, `setSeriesShow()` reads the current series visibility before assignment.

It calls `legendView.setData(legend.values)` under `if (showLegend && s.show != show)`, then assigns `show`. The public `setSeries()` no longer calls `setData()` unconditionally.

The request precedes mutation safely because the deferred view reads the latest state. No cache, new persistent flag, new scan, or aggregate list is necessary.

No-op single-series and all-series requests, series 0, and invalid targets cause no direct legend invalidation. Focus plus visibility still works. Explicit `setLegend()` remains unchanged.

Legacy range invalidation, commit/draw behavior, cursor-point handling, hooks, and sync remain, including for unchanged visibility. Independent canvas work or hooks can still request a later legend render.

**Compatibility decision:** An unchanged `show` setter does not guarantee an implicit legend refresh after direct `label`, `class`, or `show` mutations. A static scan found no demo or plugin dependence on that behavior. This absence does not prove downstream compatibility.

The optimization adds no equality check on mutable values arrays. Only the legend part of previous item 4 is complete. General canvas invalidation remains outside scope.

The setter suite expanded from 12 to 18 cases. The current validation section records the results. No elapsed-time benchmark claim follows from these results.

### 8. Renderer presentation improvements: limited expansion, little removable complexity

**Classification:** Renderer-local simplification with some behavior beyond master.

Current labels refresh without a label cache. Marker metadata refreshes on index or marker-mode changes, rather than only initial row construction.

Fixed column keys also replace enumeration of each formatter result. This keeps values aligned with the declared headers without a new schema API.

**Recommendation:** Keep these changes. Restoring frozen labels adds cached state, while removing marker invalidation leaves stale presentation under the current declarative model.

These changes do not establish arbitrary dependency tracking, public reorder support, or schema refresh. Those features remain outside scope.

### Diff size and review priority

Generated runtime and distribution files repeat the renderer changes. Their line counts do not measure independent lifecycle complexity.

The new renderer tests also contribute substantial diff size. Skipped master reproductions add no production behavior and remain at the user's request.

The Happy DOM setter correction and frame-aware test helpers support the migration. They are not production compatibility fixes.

The original review prioritized hidden formatting, two-phase isolation, and the small chart destruction fix with direct target selection.

The hidden-formatting reversion restores master guards without removing arrays. The isolation reversion removes the largest optional notification structure. Chart destruction guards and direct target selection remain.

Both approved reversions and the legend-only unchanged-visibility optimization are implemented. General canvas invalidation remains outside scope.

No new cache, scheduler rewrite, deletion repair, or broad reentrant transaction is necessary to complete this review.

## Next steps and scope

This plan supersedes the earlier five-item plan. Both approved reversions and both consumer migrations are implemented. Demo validation remains incomplete.

### Migration completion

1. Make an explicit Trusted Types compatibility decision.
2. Validate renderer behavior and the agreed logical-state contract with bounded tests.

The demo cases remain enabled but unexecuted under the safety restriction. Their status does not establish complete consumer validation.

The narrow review and approved legend-only unchanged-visibility optimization are complete. General canvas invalidation remains outside scope.

### Disposition of the previous plan

| Previous item | Current disposition |
| --- | --- |
| 1. Optimize single-target visibility selection | Complete. Optional optimization under the completed-change review. |
| 2. Repair structural deletion state | Deferred outside the migration. No item-2 runtime or test changes occurred. |
| 3. Migrate legend DOM consumers | Both candlestick and inverted log migrations are implemented. Demo validation remains incomplete. |
| 4. Skip unchanged visibility invalidation | Approved legend-only part complete. General canvas invalidation remains outside scope. |
| 5. Define the multi-value schema contract | Separate API work. The migration does not require it. |

### Separate scheduler and lifecycle follow-ups

| Issue | Evidence and scope | Next action |
| --- | --- | --- |
| Late-focus canvas alpha | Reproduced on `master` and the current source. | Keep `test/cursor-focus.mjs` skipped until a separate scheduler fix. |
| Retained document listeners | A skipped test reproduces post-destruction dispatch on both versions. | Detach stored listeners and enable the regression with the fix. |
| Deferred batching | Skipped tests reproduce exception and nesting failures on both versions. Nontermination remains a static risk. | Define nested delivery, restore state in `finally`, and separate queue snapshots from new entries. |
| Destruction during an active commit | A skipped test reproduces painting and draw hooks after destruction on both versions. | Define cancellation boundaries before adding more guards. |
| Callback-generated requests | Skipped tests reproduce lost cursor and legend refreshes on both versions. | Preserve requests made during callbacks when changing phase ownership. |

These findings do not justify a broad scheduler rewrite within the legend migration.

### Adapters and lower-priority decisions

The remaining adapters in `src/legend.js` have specific purposes:

- `rowMeta` retains stable binding directives and immutable presentation views. It does not track arbitrary callback dependencies.
- `cursor.bind` directives obtain real targets during rendering and attach returned listeners directly.
- HTMLElement labels require a small DOM directive.
- Whole-table relocation requires `unmount(root, false)` and explicit table removal.

These adapters are not cleanup targets unless their supported contracts change.

Cross-realm support and stronger generated-file validation remain deferred. The current hash check covers authored source, not generator changes or generated-body integrity.

Strict Trusted Types is a migration-specific compatibility decision, as recorded in the scope review.

Atomic sync data and hook delivery also remain optional. DOM coalescing does not require a bulk protocol.

Filtering, sorting, and pagination remain later renderer features.

### Validation policy

The initial next-step review used source inspection only. The bounded reproductions in the next section now establish specific failures on both versions.

Before the isolation reversion, the last focused run passed 120 cases, with 12 master-bug cases pending. Those results are historical.

After the isolation reversion, the bounded combined suite reported 118 passing and 18 pending. Those results predate the hidden-formatting reversion and are historical.

The 18 pending cases comprised 12 master bugs and 6 historical isolation expectations.

After the hidden-formatting reversion, the same combined suite reported 126 passing and 22 pending. This result is historical. The four additional pending cases preserve historical hidden-value expectations.

That build, syntax checks, and whitespace checks passed. The later result of 128 passing and 22 pending is also historical.

The previous result of 130 passing and 22 pending is historical. The current combined suite reports 136 passing and 22 pending, including 18 setter cases.

The scope and completed-change reviews used source inspection. They did not run tests, demos, benchmarks, or builds.

- Use bounded, targeted tests with primitive assertions.
- Keep known unresolved regressions skipped rather than failing or removed.
- Avoid benchmarks, uncontrolled full-suite runs, and nontermination stress tests.
- Update generated artifacts only when their inputs change.

## Skipped master regressions

Eleven new regression cases reproduce failures on local `master` at `4aa4c1d801fe6f61c07881f037411807bdd3a26b` and the current working source.

The comparison used an isolated archive of the complete `master` source tree. It did not switch branches, fetch a remote, or change runtime code.

Each new case ran with its skip disabled before the final `it.skip` change. Assertions describe the intended corrected behavior, not the observed bug.

### Lifecycle cases

`test/master-lifecycle-bugs.mjs` retains five cases:

| Case | Intended behavior | Observed on both versions |
| --- | --- | --- |
| Delete a Y series in shared-point mode | Delete the series without removing the shared point or throwing. | `TypeError` from `.remove()` on `null`. |
| Delete a series whose point callback returns no element | Delete the series without throwing and deliver its hook. | `TypeError` from `.remove()` on `undefined`. |
| Delete the focused Y series, then supply matching data | Restore remaining series alpha and eventual legend opacity to `1`. | Both remain `0.25` after commits and a frame. |
| Destroy during a drag | Detach the document listener before any later mouseup. | One bound callback runs after destruction. |
| Destroy inside `drawClear` | Stop subsequent series painting and draw hooks in that commit. | One stroke, one `drawSeries` hook, and one `draw` hook follow destruction. |

The focus-deletion case uses ordinary cursor points and disables cursor-driven focus. A later hover cannot hide the retained focus state.

The listener test counts leaked dispatch without forwarding it to the destroyed chart. Its `finally` block explicitly detaches the listener.

### Scheduler cases

`test/master-scheduler-bugs.mjs` retains six cases:

| Case | Intended behavior | Observed on both versions |
| --- | --- | --- |
| Throw from `batch()` with hook deferral disabled | A later resize schedules one canvas draw. | Zero draws. |
| Throw from `batch()` with hook deferral enabled | A later resize schedules one canvas draw. | Zero draws. |
| Deliver a hook after a deferred batch throws | A later public call delivers its hook normally. | Zero hook calls. |
| Enter a nondeferred batch inside a deferred batch | Preserve the outer deferral until its flush. | Series notifications `[2, 1]` arrive before the flush. |
| Request replacement X data from a `setCursor` hook | Refresh indexes against the new data despite unchanged ranges. | Indexes remain `[1, 1, 1]` instead of `[2, 2, 2]`. |
| Request replacement Y data from a `setLegend` hook | Refresh values despite unchanged ranges. | The legend retains `50` instead of `80`. |

The refresh cases use one-shot hooks. The nested-batch case records notifications but never starts a batch from a delivered hook.

The separate live-queue nontermination risk remains unexecuted. These finite cases do not establish its runtime behavior.

### Reproduction and final validation

Each active reproduction used a 128 MB Node heap limit and a 15-second command timeout. Every new case failed on both versions as recorded.

All assertions use primitives or arrays of primitives. DOM identity checks use booleans, not DOM graphs.

The final files retain all eleven cases as skipped. The earlier skipped alpha regression in `test/cursor-focus.mjs` remains unchanged.

This bounded command reports **0 passing, 12 pending, 0 failing**:

```sh
node --max-old-space-size=128 node_modules/mocha/bin/mocha.js --no-config test/master-lifecycle-bugs.mjs test/master-scheduler-bugs.mjs test/cursor-focus.mjs
```

The pending result establishes that normal targeted runs do not execute these known failures. It does not indicate that any bug is fixed.

For a future fix:

1. Change only the relevant `it.skip` call to `it`.
2. Run that case with the same heap limit and a 15-second command timeout.
3. Implement the fix separately from unrelated legend work.
4. Retain the active regression after it passes.

Syntax and whitespace checks passed. Temporary source archives and active test copies were removed after comparison.

No benchmark, demo execution, complete project suite, or nontermination stress test ran.

## Current tradeoffs

The current design intentionally accepts these tradeoffs:

- One monolithic root does not support external row reparenting.
- Whole-table relocation requires manual final removal.
- Large compiled templates use `innerHTML` factories.
- Lazy runtime initialization caches the first DOM realm.
- HTMLElement labels require an element directive. Text/element transitions can replace the label wrapper.
- Marker presentation remains cached per series object, rendered index, and marker mode. Arbitrary callback dependencies are not tracked.
- `cursor.bind` factories run on first legend interaction.
- Legend DOM can lag logical state, including during hooks and after standalone setters or `batch()`.
- Initial mounting can follow `ready`. Custom delayed initialization can mount placeholders.
- Hidden legends retain index and array maintenance, not current formatted values. The early multi-value schema call remains.
- Isolation hooks can observe intermediate visibility. Sync publication occurs per setter, while DOM updates share one pending frame per legend.
- The outer isolation iteration can overwrite nested setter writes to later series. Isolation provides no transaction.
- Destruction guards reject pending work but do not abort an active commit.

These tradeoffs preserve the main migration goals. They need public documentation or later API changes before release.

## Deferred-renderer validation (current)

Eight new formatter-cost tests failed before the hidden-formatting reversion and passed afterward. They cover all combinations of these settings:

- Inline and table legends
- Modes 1 and 2
- `cursor.show=true` and `cursor.show=false`

Each table case requires exactly one initial schema formatter call. Each scalar case requires zero initial formatter calls.

After initialization, setters, cursor updates, and data commits cause zero additional formatter calls. The tests also cover explicit `setLegend()` hooks and index updates.

The focus test remains active, with its hidden-values expectation in a separate skipped case. Scalar-index coverage separates active shown-legend behavior from skipped historical hidden-value behavior.

The targeted run used `--grep 'hidden legend|hidden cursor|cursor focus with nonlive'` and reported **12 passing, 4 pending**.

The earlier bounded combined suite reported **126 passing, 22 pending** after the hidden-formatting reversion. That result is historical.

The previous results of **128 passing, 22 pending** and **130 passing, 22 pending** are historical.

For the legend-only optimization, `test/set-series.mjs` expanded from 12 to 18 cases. A class-read counter and fixed ranges isolate direct legend invalidation. Twelve cases failed before the implementation. All 18 passed afterward.

The same combined suite now reports **136 passing, 22 pending**:

- `test/legend-ivi.mjs`: 85 passing monolithic legend cases
- `test/legend.mjs`: 20 passing legend cases
- `test/set-series.mjs`: 18 passing setter cases
- `test/demo-steps.mjs`: 10 passing helper cases with mock plots
- `test/instrument-dom.mjs`: 1 passing DOM harness case
- `test/candlestick-tooltip.mjs`: 2 passing tooltip cases

The tooltip cases use tiny chart fixtures, not the candlestick drawing workload. They cover mounted DOM, eventual value updates, hover behavior, and cursor updates before mount with the latest position.

The tests also require one hover read at mount. Happy DOM uses a mocked `matches` method here. These results do not validate browser hover behavior.

Two new active cases in `test/legend-ivi.mjs` use small chart fixtures, not the actual log demo. The focused run reported **2 passing**.

These cases cover a shared host, cursor synchronization, values after a frame, independent controls, and stable row identity. Destruction of the top chart removes only its own table, while the bottom chart continues to update.

The earlier consumer migration passed syntax and whitespace checks with no editor diagnostics in its three changed files. That step required no build.

The re-enabled demo cases, demo execution, and snapshots remain unexecuted under the safety restriction. Fixture results do not establish complete demo validation.

The 22 pending cases comprise 12 master bugs, 6 historical isolation expectations, and 4 historical hidden-value expectations. The historical expectations are skipped references, not master bugs.

The build for the legend-only optimization passed, including `check:legend`. It regenerated all four distribution files. The authored `src/legend.js` and generated `src/legend-ivi.js` remained unchanged.

Actual minified IIFE size increased from 70,364 to 70,374 bytes (+10). Gzip size increased from 30,432 to 30,440 bytes (+8), measured with Python `gzip.compress` and `mtime=0`.

The test diagnostics were clean. Known `src/uPlot.js` diagnostics remain at lines 389, 722, 2234, and 2236. The last two concern `queuedCommit` inference.

Syntax checks passed: `node --check src/uPlot.js` and `node --check test/set-series.mjs`. `git diff --check` and trailing-whitespace checks for both investigation docs also passed.

No demos, benchmarks, or complete project suite ran. These results support no elapsed-time performance claim.

### Before the hidden-formatting reversion (historical)

These results validate the earlier sequential isolation change, not the restored hidden-formatting policy.

The targeted run used `test/legend-ivi.mjs test/legend.mjs --grep 'isola|restore-all'` and reported **8 passing, 6 pending**.

Four new sequential tests failed before the change and passed afterward. They cover inline and table legends in modes 1 and 2.

These tests cover source hooks, publication filters, peer hooks, and one render per chart per frame.

The bounded combined suite reported **118 passing, 18 pending**:

- `test/legend-ivi.mjs`: 75 passing monolithic legend cases
- `test/legend.mjs`: 20 passing legend cases
- `test/set-series.mjs`: 12 passing setter cases
- `test/demo-steps.mjs`: 10 passing helper cases with mock plots
- `test/instrument-dom.mjs`: 1 passing DOM harness case

The 18 pending cases comprise 12 master bugs and 6 historical isolation expectations.

The complete-isolation-state and superseded isolation notification tests remain skipped as historical or optional contract references. These six cases are not master bugs.

`NODE_OPTIONS=--max-old-space-size=256 npm run build` passed within 15 seconds, including `check:legend`.

The build regenerated all four distribution files. The authored legend source and generated legend module remained unchanged.

That run reported no editor diagnostics in `test/legend-ivi.mjs`. It reported existing `src/uPlot.js` errors at lines 389 and 722, plus `queuedCommit` inference errors at lines 2234 and 2236.

Syntax checks for `src/uPlot.js` and `test/legend-ivi.mjs` passed. Documentation whitespace checks and `git diff --check` also passed.

No demos, benchmarks, or complete project suite ran.

### Before the isolation reversion (historical)

These results predate the isolation reversion. They do not validate the current sequential contract.

After the single-target visibility change, one bounded run passed 120 cases:

- `test/set-series.mjs`: 12 target-selection and behavior cases
- `test/instrument-dom.mjs`: 1 test-harness case
- `test/legend.mjs`: 20 cases
- `test/legend-ivi.mjs`: 77 cases
- `test/demo-steps.mjs`: 10 helper cases with mock plots

The run also reported 12 pending cases from the three known-bug regression files. Those skips remain unchanged.

The run used a 128 MB V8 heap limit and a 15-second command timeout. No benchmark or complete project suite ran.

Those cases covered data in hooks, frame coalescing, real two-chart sync, hidden DOM, structural changes, and callback-driven state changes.

Destruction cases cover pending chart commits, pending frames, and a marker callback that destroys the renderer during view construction.

The frame rechecks root liveness after view construction and before mounting. A marker callback cannot cause a table to mount after destruction.

The generated legend build, source-hash check, distribution build, syntax checks, and `git diff --check` passed.

`src/legend.js` has no editor diagnostics. Known unrelated `src/uPlot.js` diagnostics remain.

Snapshot capture and initial demo-interaction helpers now wait for a frame. Demo execution and snapshot regeneration did not run.

At that stage, some demos still depended on legend DOM in `init` or `ready`, and their migration cases remained skipped.

Tests assert hook-visible data and eventual DOM. They do not require a fixed cross-hook order.

Presentation cases cover index-sensitive callback counts, final coalesced state, style cleanup, stable bindings, and label replacement without marker recalculation.

An unchanged supplied label retains its input state, listeners, and focus. Marker callbacks can destroy the renderer during initial creation or a mounted-row refresh.

Callback-count checks do not require a fixed traversal order. No elapsed-time performance improvement is claimed.

## First-cleanup validation (historical)

These results describe the earlier synchronous renderer. They do not validate the current implementation or define its DOM timing contract.

The targeted monolithic tests passed with a 128 MB V8 heap limit and a 15-second command timeout: 8 passing.

The cases cover these behaviors:

- Initial and cleared focus have the same opacity.
- Focus with alpha `1` changes chart state without legend reconciliation.
- Later value updates still reconcile the legend.
- Isolation and restore each perform one synchronous legend reconciliation.
- Deferred hooks see final chart visibility and final legend classes in modes 1 and 2.

The render-count checks use a row-property read counter. They do not measure elapsed-time performance.

Six existing legend cases also passed under the same heap and timeout limits. They cover isolation, restore, modifier inversion, and hover focus.

Five additional cases passed for empty strings, stable columns, and cached marker presentation. The three targeted runs total 19 passing cases.

The generated legend build, source-hash check, distribution build, syntax checks, and `git diff --check` passed.

That version reported no `src/legend.js` editor diagnostics. `src/uPlot.js` reported the known argument-count, time-axis callable-union, and commit-queue inference errors.

The heap limit is not a complete process-memory limit. No benchmark or complete test suite ran.

## Cursor-coalescing validation (historical)

These results describe the previous combined-setter implementation. Synchronous DOM and notification-order assertions from that version do not define the current contract.

The deferred-renderer validation section separates current validation from historical results recorded before each reversion.

Fourteen new regression cases passed under a 128 MB V8 heap limit and a 15-second command timeout.

The cases cover these behaviors in inline and table legends:

- Combined focus and value rendering before hooks
- Focus-only updates without formatter calls
- Value-only updates and unchanged cursor positions
- Notification order and unchanged hidden-focus suppression
- Hidden and nonlive legends
- Single cursor-point movement, disappearance, and reappearance
- Combined public focus and visibility setters
- Synchronous nested setters without an outer stale render
- Final source DOM during focus publication
- Nonpublishing programmatic cursor updates
- Direct received mousemoves without local focus selection or automatic echo
- Mode 2 values and focus
- Retained focus identity and inserted-series alpha
- Shared-point index refresh after insertion without a false focus notification

The sync regression inspects publication filters and directly delivers mousemoves. It does not establish atomic two-chart delivery or mapped focus-message behavior.

The existing `test/legend.mjs` suite also passed: 20 cases. These cover legend values, toggles, isolation, focus, and cursor locking.

Twelve additional monolithic cases passed for alpha `1`, marker caching, initial hooks, table mounting, and isolation.

These three bounded runs total 46 passing cases.

The generated artifact check and distribution build passed. That version still reported the known unrelated `src/uPlot.js` diagnostics.

No benchmark or complete project test suite ran.
