# ivi legend migration

Recorded on 2026-09-18.

## Scope

This investigation covers the replacement of the manual legend DOM code with the ivi library.

The work is on the `ivi-legend` branch. Commit `022507dc` contains the first migration snapshot.

The current work tree contains a later monolithic design. This design is not part of the snapshot commit.

The [migration scope review](legend-ivi-integration-seams.md#migration-scope-review) separates new breakage from master bugs and optional improvements.

The [completed-change review](legend-ivi-integration-seams.md#completed-change-review) records two approved reversions and the legend-only unchanged-visibility optimization. All three are implemented.

Candlestick option 1 and the inverted log consumer migration are implemented. Demo validation remains incomplete.

## CURRENT contract — authoritative

This section supersedes earlier promises about synchronous legend DOM, complete isolation state, and current hidden-legend values. Historical validation results describe previous implementations, not this contract.

Public methods still update their logical state synchronously. Hooks require updated data structures, not updated legend DOM.

In ordinary nonreentrant cursor flow, uPlot prepares cursor indexes and focus before callbacks. It refreshes `legend.values` only for a shown live legend. Each visibility setter applies its own change before its hook.

Visibility setters directly invalidate the shown legend only when `s.show != show`. Unchanged single-series and all-series requests, series 0, and invalid targets cause no direct legend invalidation.

An unchanged `show` setter does not guarantee an implicit legend refresh after direct label, class, or visibility mutations. Independent canvas work or hooks can still request a later legend render.

Legacy range invalidation, commit/draw behavior, cursor-point handling, hooks, and sync remain, including for unchanged visibility. Combined focus and visibility updates still work. Explicit `setLegend()` remains unchanged.

Isolation calls `setSeries()` sequentially for each Y series. Source hooks can observe intermediate visibility for other series, and sync publication occurs per setter.

Nested setters can change later series. The outer iteration can overwrite those changes when it reaches those series. Isolation is not a transaction.

This does not make every derived field current in every hook. Existing `setData()`, scale, and canvas derivation phases remain separate.

The renderer exposes independent `setData(values)` and `setFocus(series)` setters. The optional combined focus argument is removed.

Both setters share one pending `requestAnimationFrame` update per legend. Further requests update the latest state without another pending frame.

The first frame also follows this rule. It creates a complete table and calls `legend.mount()` once, possibly after `ready`.

No standalone method guarantees synchronous legend DOM. This includes `batch()`, initialization, `addSeries` hooks, and `ready`.

With synchronous initialization, the first pending frame absorbs the `_init` microtask value refresh. A custom delayed initializer can still mount placeholders.

The approved reversion restores the master formatting policy:

- `_commit()` uses `FEAT_LEGEND && legend.show && legend.live && shouldSetLegend`.
- `setLegend()` uses `showLegend && legend.live`. `showLegend` already includes `FEAT_LEGEND && legend.show`.
- With `legend.show=false`, live `value` and `values` formatter refreshes do not run. No renderer exists.
- Value arrays and `activeIdxs` remain independent of DOM visibility and track structural changes. Initial null value entries remain without live formatting.
- Explicit `setLegend()` still updates indexes and fires its hook for a hidden legend. Hidden values are not promised current.
- A hidden cursor does not suppress formatting for a shown live legend. Cursor hooks and focus remain intact.

The early multi-value schema call `series[1].values(self, 1, 0)` remains, including for a hidden live legend. This is master behavior, not a zero-total-call promise.

This policy concerns `legend.show=false`, not legends hidden through CSS.

Sequential sync messages share the pending frame. Data changes and hooks remain per-event, not atomic.

Renderer `destroy()` cancels its frame and sets `root=null`. The root guard makes queued callbacks and later renderer setters inert.

The chart `destroyed` flag invalidates pending `queuedCommit` work and blocks new scheduling and `_commit()` entry. It does not abort an active commit.

The listener leak and late-focus canvas problem remain unresolved. Cursor-point DOM currently updates synchronously, but that timing is not a contract.

A bounded comparison confirms the same stale-alpha failure on `master` at `4aa4c1d8` and the current working source.

This is a pre-existing scheduler bug, not a legend regression. Its fix is separate from the legend migration.

Finding 10 in [ivi legend integration seams](legend-ivi-integration-seams.md#10-focus-during-_commit-can-miss-a-canvas-redraw) records the evidence and the possible scheduler follow-up.

Some custom hit tests consume paint-produced geometry. A pre-paint cursor pass requires migrations for those providers, not just deferred marker DOM.

The previous cleanup passed 105 focused cases. The `test/cursor-focus.mjs` regression remains skipped pending the separate scheduler fix.

## Goals

The legend must use one ivi root.

The legend must receive complete state through these methods:

- `setData(values)` stores values and invalidates rows, visibility, and series structure.
- `setFocus(series)` stores focus and invalidates row opacity when necessary.

These independent setters share one deferred update. Neither setter synchronously reconciles the DOM.

The legend must emit these interactions:

- `click`
- `focus`
- `leave`

uPlot owns the chart effects of these interactions.

The templates must own classes, styles, event handlers, and child structure. uPlot must not update legend cells or rows directly.

The design must support future filtering, sorting, and pagination without a manual DOM implementation.

## Current architecture

`src/legend.js` contains the authored implementation.

`scripts/build-legend.mjs` compiles this file and bundles ivi into `src/legend-ivi.js`.

`src/uPlot.js` imports the generated module. Browser source imports do not require a package resolver.

The generated module initializes ivi on the first legend call. A module import does not require browser DOM globals.

The legend uses one `createRoot()` call. A keyed `List()` uses each series object as its key.

The compiled legend currently has these template groups:

- The table and body
- The multi-value header
- The header cell
- The shared row and header
- The optional marker
- The text label
- The HTMLElement label
- The value cell

Static and computed classes use `class` attributes. ivi compiles dynamic `class` bindings to its specialized class opcode.

Scalar value cells, text labels, and header cells use `.textContent`. This avoids separate ivi state nodes for their text children.

The fixed multi-value header is constructed once per legend. Stateless text helpers are shared across legend instances.

Computed styles use ivi style properties. These styles include opacity, border, background, and color.

The [ivi idiom review](legend-ivi-integration-seams.md#ivi-idiom-review) records the compiler findings and scheduler decision.

Native ivi scheduling operates on component invalidations. The stateless legend retains external frame scheduling so user marker callbacks run before reconciliation starts.

## uPlot integration

uPlot normalizes all initial series before it requests the first legend render.

uPlot initializes `legend.values`, creates the renderer when shown, and calls its `setData()` method.

Then uPlot fires each initial `addSeries` hook. These hooks can observe complete initial logical structures, but they do not require legend DOM.

A dynamic `addSeries()` call uses this order:

1. Insert the series and legend value state.
2. Normalize the new series.
3. Invalidate the shown renderer through `setData()`.
4. Fire the `addSeries` hook.

A series deletion removes its value state and invalidates the shown renderer.

In `src/uPlot.js`, `setSeriesShow()` reads current visibility, then calls `legendView.setData(legend.values)` under `if (showLegend && s.show != show)`. It then assigns `show`. The public `setSeries()` no longer calls `setData()` unconditionally.

The request precedes mutation safely because the deferred view reads the latest state. This change adds no cache, persistent flag, scan, or aggregate list. It adds no equality check on mutable values arrays.

The value arrays and `activeIdxs` track structural changes independently of DOM visibility. Live formatter refreshes require a shown live legend.

Chart `setFocus()` owns chart focus state and legend focus invalidation. The renderer receives the focused series object, or `null` to restore full opacity.

Public `setSeries()` has no special combined one-render branch. Independent value and focus invalidations share the renderer's pending frame.

Chart focus and renderer focus both use series identity. Inserted series receive current focus-dependent chart state during initialization.

The cursor path prepares data before its notifications in ordinary nonreentrant flow. Finding 11 records the current notification order.

## Findings and decisions

### 1. Initial mount used two renders

The first monolithic renderer created an empty table before `setData()` added the complete structure.

This sequence required `mounted`, nullable values, `tableClass`, and an empty initial render.

**Decision:** Create the complete initial table in the first deferred frame, then call `legend.mount()` once.

**Status:** Implemented with deferred initial mounting.

The first `setData()` call schedules that frame. Synchronous initialization and the `_init` microtask value refresh update its state before it runs.

This removes the forced placeholder render. A custom delayed initializer can still let the first frame mount placeholder values.

The callback receives the complete structure and standard classes. It can move the complete table to another container.

Mounting can follow `ready`. Initial hooks no longer require the table to exist.

Later ivi updates use the same table. Classes that the mount callback adds remain on the table.

### 2. `cursor.bind` starts on the first interaction

ivi event handlers do not provide their element before an event occurs.

The current adapter calls the applicable `cursor.bind` factory on the first event. It caches the returned listener for later events.

The adapter calls the listener with the target element as `this`.

The old implementation called each bind factory during DOM creation.

Registration-time binding requires a mount directive with cleanup. That directive creates an imperative island for each event target.

**Decision:** Keep lazy binding for now.

The tests must not require registration-time factory calls. They must still cover suppression, targets, `onlyTarget`, and original events.

A removed row can remain in the DOM until the next frame. The adapter ignores events when that row has `seriesIdx == -1`.

### 3. Isolation caused many complete legend renders

The first monolithic version called `setSeries()` for each affected series. Each call caused a complete legend update.

**Decision:** Revert only two-phase isolation. Keep sequential public setters and deferred DOM updates.

**Status:** Implemented with user approval. The targeted run reported 8 passing and 6 historical isolation cases pending.

Isolation uses `series.forEach` and calls `setSeries(i, isolate ? (i==seriesIdx ? son : soff) : son, true, syncOpts.setSeries)` for each `i > 0`.

Each source `setSeries` hook sees its own change applied. It can observe intermediate visibility for other series. Sync publication occurs per setter.

Receiving charts process individual sync messages. Their hooks can also observe intermediate visibility.

The renderer coalesces these requests into one pending frame per legend. This coalesces DOM work, not data mutations or hooks.

The direct-target setter remains. It avoids repeated complete-series selection scans without direct bulk helper use by isolation.

The reversion removes the `updates` array and isolation stale-record checks. The `deferLegend` flag remains unnecessary.

If a nested setter changes a later series, the outer iteration can overwrite that change when it reaches that series. Isolation is not a transaction.

The earlier complete-state and superseded-isolation-notification tests remain skipped as historical or optional contract references, not master bugs.

Active tests cover sequential hooks, per-setter sync, and frame coalescing. Neither source nor receiver hooks require current legend DOM.

### 4. Labels use current state without a metadata cache

ivi does not accept an `HTMLElement` as a virtual child.

**Decision:** Use separate text and HTMLElement label templates inside one shared row template.

The HTMLElement adapter replaces its children only when the supplied element differs from its first child. An unchanged element remains attached.

The original element retains its listeners, input state, and focus across ordinary updates. Replacing `series.label` removes the previous element on the next render.

Text/element transitions can replace the label wrapper. Row and header identity remain stable, including across marker-mode changes.

The cached label directive and no-operation directive are removed. Labels do not require a new cache or public refresh API.

### 5. Marker styles refresh when index or marker mode changes

The renderer keeps stable event handlers in a per-series `WeakMap`. Marker presentation has a separate invalidation condition within each entry.

**Decision:** Calculate marker styles on first use, changed rendered index, or changed `legend.markers.show`.

New and shifted rows recalculate after insertion, deletion, or reorder. Unchanged-index rows reuse their cached styles.

The frame uses the final coalesced state. Intermediate structural or mode changes do not require intermediate callback calls.

Ordinary value, focus, visibility, and label updates still skip marker callbacks. Refreshes clear obsolete styles and preserve zero-width callback suppression.

Event eligibility uses the current index. Marker refreshes do not replace the cached handlers or their lazy bindings.

This is not arbitrary dependency tracking. Changes to callback identities, closure state, series width, or total series count do not independently invalidate cached styles.

Mutating presentation alone does not schedule a frame. The next requested legend update applies current labels and checks the marker cache.

No public sorting or presentation-refresh API is added.

### 6. Value cells use declared columns

The first multi-value object defines the header columns.

Each row now reads values with the stable column keys. Formatter property order does not change the cell order.

Missing keys keep the cell count stable. Inherited declared keys remain accessible through normal property lookup.

This behavior is safer than enumeration of each result object.

### 7. Individual row reparenting is incompatible

The inverted log demo previously moved a row from one legend into another legend.

A monolithic ivi root owns the complete list structure. External row movement breaks that ownership.

Whole-table relocation remains supported through `legend.mount()`.

Both existing `log-scales2` cases in `test/demo-migrations.mjs` are re-enabled. The interaction case uses complete tables, waits for a frame before value reads, and checks each chart's controls independently.

The candlestick repeatability and tooltip interaction cases also remain enabled. No migration demo cases remain skipped in that file. These demo cases remain unexecuted under the safety restriction.

Candlestick option 1 uses an `opts` extension to set `legend.mount(u, el)` instead of a plugin `init` query. `demos/candlestick-ohlc.js` exposes the named export `legendAsTooltipPlugin` for focused tests.

The mount callback styles the table, hides existing markers, and moves the whole table to `u.over`. Marker appearance and the existing enter/leave listeners remain unchanged.

At mount, the plugin reads `over.matches(':hover')` once, then calls `update()` with the current cursor. Before the table exists, the update guard prevents DOM access. The mount callback uses the latest cursor position.

The repair changes no core, library, or distribution files. It adds no scheduler or cache and leaves `columnHighlight` untouched.

`renderInvertedLogScales` in `demos/log-scales2.js` now creates one shared `div` with `display: flex`, `justify-content: center`, and `gap: 16px`.

Both plots receive the same `legend` configuration. Its `legend.mount` callback sets each whole table's margin to `0` and appends the table to the shared host.

The consumer appends the host under the bottom chart root. Both complete tables appear side by side below the bottom plot. The duplicate `Time` row is deliberate.

The migration removes the `ready` hook, all row transfer, and the code that hides the top table. Each renderer retains all its rows. Each table's controls remain bound to the original chart.

The host shares the bottom chart's lifetime. This paired demo does not promise independent host survival after bottom-chart destruction.

The log repair changes no core or distribution files. It adds no public API, cache, scheduler, or per-cursor work.

### 8. Large templates use `innerHTML` factories

The ivi compiler uses template cloning for large static structures. The generated runtime assigns template strings through `innerHTML`.

Trusted Types enforcement rejects these string assignments without an accepting default policy.

Master creates the legend through DOM methods and `textContent`. This conditional compatibility loss comes from the migration, not an existing master bug.

The review established the difference through source inspection. It did not run a browser reproduction.

The first migration avoided this behavior with many small element factories and directives. That design conflicted with the monolithic template goal.

**Current implementation:** Large templates remain for this experiment. Trusted Types support requires an explicit migration compatibility decision.

### 9. Focus state and render allocation

Initial and cleared legend focus now use the same `null` state.

With `focus.alpha != 1`, both states write inline opacity `1`. The initial absence of inline opacity is no longer a compatibility target.

With `focus.alpha == 1`, focus changes do not reconcile the legend. Chart focus state and hooks still update.

A skipped focus render no longer refreshes unrelated in-place presentation changes. A later data or visibility update still refreshes those properties.

Each row now creates value-cell templates in one array pass. The renderer no longer creates a temporary array of cell values.

### 10. Empty-string test crash

A small empty-string test appeared to crash the machine.

The isolated test completed the ivi update before the process exhausted memory.

The failing assertion compared null with a Happy DOM `Text` node. Node tried to format the DOM graph for the error report.

This formatting operation exhausted the heap. The ivi update did not cause runaway allocation.

The test now compares primitive text and child counts. An earlier run passed with a 64 MB Node heap limit, before deferred rendering.

DOM identity helpers now compare boolean results. A failed assertion cannot format a complete DOM graph.

### 11. Cursor updates prepare data before callbacks and defer DOM

**Decision:** Keep logical updates synchronous and let independent renderer setters share one pending frame.

**Status:** Implemented. The combined focus argument and public `setSeries()` one-render branch are removed.

The private chart `setFocus()` method owns chart focus state and legend focus invalidation. It also reports whether focus changed.

In ordinary nonreentrant flow, `updateCursor()` uses this order:

1. Calculate cursor geometry, indexes, and focus.
2. Apply focus through chart `setFocus()`.
3. Call `setLegend()` for a requested legend update. Refresh values only for a shown live legend, then fire the hook.
4. Publish the requested mousemove sync event.
5. Fire the changed-focus `setSeries` hook, then publish its requested sync event.
6. Fire the requested `setCursor` hook.

Cursor indexes and focus are ready before these callbacks. Values are current only for a shown live legend. Legend DOM follows in a frame, with no standalone synchronous flush guarantee.

This does not make every field current in every hook. Existing `setData()`, scale, and canvas derivation phases remain separate.

Focus-only updates do not call value formatters. Nonlive legends retain their focus-only update path.

Repeated hidden-cursor updates do not emit unchanged focus-clear hooks. Programmatic cursor updates publish focus only when publication was requested.

The shared cursor point tracks its own target index. An index shift can refresh the point without a chart-focus notification.

Cursor-point DOM currently updates synchronously. That timing is not a contract.

Sequential sync messages share a pending renderer frame, but receiver data and hooks remain per-event. Formatters and hooks can call nested setters.

Cursor focus notifications retain checks for state that a nested callback supersedes. These guards prevent stale cursor focus publication.

Isolation no longer records notifications or checks for superseded isolation records. It uses ordinary sequential setters.

This change does not provide a general transaction across arbitrary callbacks. The late-focus canvas problem remains unresolved.

### 12. Destruction guards pending work

Renderer `destroy()` cancels the pending frame and sets `root=null`. The root guard makes queued callbacks and later renderer setters inert.

The frame also checks root liveness after view construction and before mounting. This covers destruction from a user marker callback.

The chart `destroyed` flag invalidates pending `queuedCommit` work. It also blocks new scheduling and `_commit()` entry.

If a user hook calls `destroy()` mid-commit, these guards do not abort the remaining active commit. The document-listener leak also remains unresolved.

### 13. Legend arrays remain independent of DOM visibility

Value arrays and `activeIdxs` exist and track insertion and deletion independently of DOM visibility. Hidden values retain their initial null entries without live formatting.

Scalar `setLegend({idx})` no longer depends on cursor DOM initialization. A hidden cursor still permits formatting for a shown live legend.

Explicit `setLegend()` updates indexes and fires its hook even with `legend.show=false`. It does not refresh hidden values or create a renderer.

**Decision: implemented.** Restore the master guards in `_commit()` and `setLegend()`. Remove the redundant shown-renderer guard inside the guarded `setLegend()` formatting block.

The early `series[1].values(self, 1, 0)` schema call remains for hidden live legends. This exception prevents a zero-total-call guarantee.

DOM-independent arrays, cursor hooks, focus, and sequential isolation remain. These changes do not make all data and scale derivation synchronous.

## Build and packaging

The package pins these development dependencies:

- `ivi@5.1.0`
- `@ivi/rollup-plugin@5.0.1`
- `@rollup/plugin-node-resolve@16.0.3`

`npm run build:legend` regenerates `src/legend-ivi.js`.

`npm run check:legend` compares the generated source hash with `src/legend.js`.

The normal build uses the checked-in generated module. It does not invoke the native ivi compiler.

This design lets unsupported native platforms build the distribution from the checked-in artifact.

The generated module and distribution files include the ivi MIT license notice from `LICENSE-ivi`.

## Test coverage

The focused tests cover these behaviors under the deferred-rendering contract:

- Value updates for shown live legends
- Visibility updates
- Focus updates
- Keyed row identity
- Series insertion and deletion
- Stable multi-value columns
- Marker presentation
- HTMLElement label identity and state
- External mounting of complete tables in a shared host
- Cursor synchronization and values after a frame in paired charts
- Independent controls and stable row identity in both tables
- Removal of only the top table after top-chart destruction, with continued bottom-chart updates
- Complete logical state in initial `addSeries` hooks
- `cursor.bind` suppression and wrapping
- Empty-string values

Tests that reparent owned rows do not apply to the monolithic model.

Four historical hidden-value cases remain skipped for reference, not as master bugs. Eight active formatter-cost tests cover the restored policy.

The focus test remains active. Its hidden-values expectation is now a separate skipped case.

Scalar-index coverage separates the active shown-legend case from the skipped historical hidden-value case. Hidden-legend index updates remain covered by the active formatter-cost tests.

## Remaining work

The [revised plan](legend-ivi-integration-seams.md#next-steps-and-scope) replaces the earlier five-item list.

A fix belongs in this migration when the branch introduced the failure or the agreed legend contract requires the change.

The remaining migration work is:

1. Make an explicit Trusted Types compatibility decision.
2. Validate the renderer and the agreed logical-state contract with bounded tests.

Both candlestick and inverted log consumer migrations are implemented. Their demo cases remain enabled but unexecuted under the safety restriction. No migration demo cases remain skipped in `test/demo-migrations.mjs`, but demo validation is not complete.

The previous item 2, structural deletion repair, is deferred outside migration scope. No implementation or test changes occurred for that item.

The narrow review and approved legend-only part of previous item 4 are complete. General canvas invalidation and multi-value schema redesign remain outside scope.

The single-target visibility optimization is complete. The completed-change review classifies it as optional, not regression repair.

Pre-existing scheduler and lifecycle problems remain separate follow-ups. Eleven skipped reproductions cover deletion, listener retention, batch state, active-commit destruction, and callback-generated requests.

Each failure reproduces on `master` at `4aa4c1d8` and the current source. The earlier late-focus regression remains skipped.

The [skipped master regression inventory](legend-ivi-integration-seams.md#skipped-master-regressions) records expected behavior, observed failures, reproduction limits, and the final pending-test result.

Stable event adapters, marker caching, HTMLElement label directives, and whole-table removal remain intentional. Cross-realm failure is not an established migration regression.

Stronger generated-file validation, atomic sync delivery, filtering, sorting, and pagination remain outside completion of the base migration.

## Completed changes under review

The [detailed review](legend-ivi-integration-seams.md#completed-change-review) records each classification, recommendation, dependency, and possible reversion boundary.

The user approved both reversions: two-phase isolation and hidden-legend formatting. Both are implemented. DOM-independent arrays, the direct-target setter, cursor notification guards, focus identity, and destruction guards stay.

The user also approved the legend-only unchanged-visibility optimization. It is implemented without changes to legacy canvas effects or notifications.

**Compatibility decision:** An unchanged `show` setter does not guarantee an implicit legend refresh after direct `label`, `class`, or `show` mutations. A static scan found no demo or plugin dependence on that behavior. This absence does not prove downstream compatibility.

The other review recommendations remain recorded here. They do not authorize further reversions or roadmap changes.

| Change | Scope and cost | Review recommendation or implemented decision |
| --- | --- | --- |
| Hidden-legend formatting | The earlier contract added live formatter calls without visible DOM. | Reversion implemented. Restore master formatting guards and remove the redundant shown-renderer guard inside `setLegend()`. Retain arrays, hooks, focus, and the early schema call. |
| Two-phase isolation | The earlier complete-state contract required notification records and stale-record checks. | Reversion implemented. Sequential setters expose intermediate visibility and publish sync per setter. DOM updates still share one frame. |
| Cursor notification order | Prepares indexes, focus, and shown live values before callbacks. Adds checks for superseded focus. | Retain the checks with the reordered flow. |
| Series-object focus | Aligns chart state with keyed renderer identity. Also initializes inserted-series alpha. | Keep for consistent structural rendering. Do not expand into deletion repair. |
| Chart destruction guards | Small, separable fix for pending chart work after destruction. | Keep or separate from the migration. Renderer disposal guards remain necessary independently. |
| DOM-independent arrays | Corrects hidden-cursor scalar indexes and indexed value insertion. | Keep. Array maintenance does not require hidden formatter execution. |
| Direct visibility target selection | Independent optimization with no cache. | Keep unless a strictly minimal migration patch takes priority. |
| Unchanged visibility | Narrow legend-only optimization without new persistent state or scans. | Approved and implemented. Preserve legacy range, commit/draw, cursor-point, hook, and sync behavior. General canvas invalidation remains outside scope. |
| Current labels, marker invalidation, fixed column lookup | Renderer-local improvements beyond static manual rows. | Keep without a new presentation or schema API. |

The hidden-formatting reversion removes live formatter refreshes for hidden legends. The earlier isolation reversion removes the largest optional notification structure.

The pending-commit callback-identity check already exists on master. The migration did not introduce that mechanism.

Generated files repeat source changes, and renderer tests add substantial diff size. These line counts do not indicate equivalent production complexity.

Skipped master reproductions remain as requested. The Happy DOM correction and frame-aware helpers remain migration test support.

The original review changed documentation only. The isolation reversion included runtime code, tests, documentation, and generated distributions.

The hidden-formatting runtime reversion is limited to the formatting guards and redundant inner renderer guard.

## Validation status (current)

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

## Validation before the hidden-formatting reversion (historical)

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

## Validation before the isolation reversion (historical)

These results predate the isolation reversion. They do not validate the current sequential contract.

After the single-target visibility change, one bounded run passed 120 cases:

- 12 target-selection and behavior cases in `test/set-series.mjs`
- 20 existing legend cases
- 77 monolithic legend cases
- 10 helper cases with mock plots
- 1 test for the cached DOM text setter

The same run reported 12 known-bug cases pending. Their skips remain unchanged.

The run used a 128 MB V8 heap limit and a 15-second command timeout.

Those cases covered hook-visible data, frame coalescing, two-chart sync, superseded notifications, hidden DOM, and destruction during pending or active renderer work.

The generated legend build, source-hash check, distribution build, syntax checks, and `git diff --check` passed.

`src/legend.js` has no editor diagnostics. Known unrelated `src/uPlot.js` diagnostics remain.

Presentation tests cover shifted rows, coalesced changes, style cleanup, stable bindings, label replacement, and destruction during a mounted-row marker refresh.

New cases cover scalar text, holes, numeric zero, literal markup text, and text-node reuse.

The test harness corrects Happy DOM's no-operation base text setter for element targets. Production code does not need that correction.

Snapshot capture and initial demo-interaction helpers now wait for a frame. No demo execution, snapshot regeneration, benchmark, or complete project suite ran.

## Validation status (historical)

All results in this section describe previous synchronous renderer versions. They do not validate the current deferred implementation or its notification order.

The preceding sections separate current validation from historical deferred-renderer results.

The earlier generated-source hash check passed.

The earlier distribution build passed.

The earlier `git diff --check` passed.

The earlier monolithic pass reported no editor diagnostics in the new and modified legend files.

The first cleanup passed 8 targeted monolithic cases under a 128 MB V8 heap limit. These cover focus rendering and deferred isolation in both chart modes.

Six existing legend cases also passed. These cover isolation, restore, modifier inversion, and hover focus.

Five additional cases passed for empty strings, stable columns, and cached marker presentation. The three targeted runs total 19 passing cases.

The regenerated artifact, source-hash check, distribution build, syntax checks, and `git diff --check` passed after the cleanup.

That version reported no `src/legend.js` editor diagnostics. It still reported known unrelated diagnostics in `src/uPlot.js`.

The cursor-coalescing pass passed 14 new regression cases and all 20 existing cases in `test/legend.mjs`.

Twelve additional monolithic cases passed for alpha `1`, marker caching, initial hooks, table mounting, and isolation. The three runs total 46 passing cases.

These runs used a 128 MB V8 heap limit and a 15-second command timeout per run.

The generated artifact check and distribution build also passed after cursor coalescing.

The related [integration assessment](legend-ivi-integration-seams.md) records audit corrections, behavioral changes, validation scope, and remaining work.

The historical runs did not include the complete suite after the monolithic rewrite. Demo tests that manipulate legend DOM remained skipped.
