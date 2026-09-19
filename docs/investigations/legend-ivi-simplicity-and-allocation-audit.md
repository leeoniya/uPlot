# ivi legend: simplicity and allocation audit

Recorded on 2026-09-18.

## Status and scope

This document records the original read-only audit of the legend renderer and its uPlot integration.

Sections 10 through 16 record the completed changes. Legend bindings now use registration-time directives. Remaining behavior decisions stay separate.

The comparison baseline is local `master` at `4aa4c1d801fe6f61c07881f037411807bdd3a26b`. The current source includes the migration and later working-tree changes.

Related investigations:

- [Migration findings](legend-ivi-migration.md)
- [Integration findings and completed changes](legend-ivi-integration-seams.md)

### Decision principles

Performance, simplicity, and bundle size take priority over robustness for narrow cases.

A stronger behavior guarantee does not automatically justify extra callbacks, allocations, scans, state, or generated code.

Existing tests are evidence, not the specification. Many tests encode incidental behavior or expectations from intermediate implementations.

The public API, master behavior, and actual demo usage provide stronger compatibility evidence. Absence from inspected demos does not prove absence from downstream code.

Existing master bugs remain separate unless a change is necessary for the legend migration. General scheduler and lifecycle repair remain outside this audit.

### Evidence and limits

The audit examined these sources:

- [`src/legend.js`](../../src/legend.js): authored renderer
- [`src/legend-ivi.js`](../../src/legend-ivi.js): generated renderer and bundled runtime
- [`src/uPlot.js`](../../src/uPlot.js): formatting, cursor flow, and legend integration
- [`dist/uPlot.d.ts`](../../dist/uPlot.d.ts): public API declarations
- [`docs/README.md`](../README.md): public documentation
- Demo and plugin usage, including insertion, binding, gradients, and tooltip consumers
- Installed `ivi@5.1.0` documentation, declarations, and runtime

The installed runtime sources are `node_modules/ivi/dist/lib/core.js` and `node_modules/ivi/dist/lib/core.d.ts`.

Allocation findings describe constructions in source and generated code. They are not heap profiles or elapsed-time measurements.

The audit ran no tests, demos, benchmarks, or builds. Bundle measurements used existing artifacts.

## 1. Value object allocation

### Original behavior

Core passes the existing `legend.values` array to the renderer without a copy. After the scheduler change, this occurs in `flushFrame()` through `legendView.render()`.

Before scalar record reuse, `setLegendValues()` replaced scalar entries:

```js
val = s.value(self, idx == null ? null : src[idx], sidx, idx);
val = val == null ? NULL_LEGEND_VALUES : {_: val};

legend.values[sidx] = val;
```

| Structure | Original behavior | Origin |
| --- | --- | --- |
| Outer `legend.values` array | Retained and mutated | Existing design |
| Scalar value entry | New `{_: val}` object for each non-null formatter result | Same on master |
| Null-result entry | Shared `NULL_LEGEND_VALUES` object | Same on master |
| Multi-value entry | The object returned by `series.values()` | Same on master |
| Renderer data reference | Stores the supplied array without copying | New integration |

This does not occur on every raw mousemove. It occurs when cursor processing requests a legend refresh, or an explicit call requests one.

Each applicable refresh formats all eligible series. Before record reuse, repeated non-null results allocated several generations of scalar records before one frame.

RAF coalesces DOM work only. Scalar record reuse now removes repeated wrapper allocations, but formatter calls and formatter-owned allocations remain.

Hidden legends no longer perform live formatting. The existing one-time multi-value schema call remains, including for a hidden live legend.

### Implemented: one mutable scalar record per series

A scalar entry retains its identity while its `_` property changes. Placeholder transitions update that same entry. Section 12 records implementation details and validation.

This removes the library-owned scalar-record allocation from subsequent refreshes. It needs no separate lookup cache.

Each series needs its own record. Mutating the shared `NULL_LEGEND_VALUES` object can incorrectly change several entries at once.

**Tradeoff:** A retained entry reference becomes live mutable state, rather than an old snapshot.

The public declaration describes `legend.values` as current readback data. It does not promise fresh entry identities or immutable snapshots.

Initialization and series addition retain null entries until the first formatting call allocates each record. Zero, empty strings, placeholders, and structural changes remain supported.

This is an optimization of existing master behavior, not a fix for a migration regression.

### Multi-value formatters remain caller-controlled

The multi-value path already uses the object returned by the formatter without an extra copy.

A formatter can allocate a new object or return a reusable record. Stable outer-array identity cannot prevent allocation inside that callback.

Copying every result into library-owned records does not remove callback allocations. It adds property-copying work and another structure.

**Recommendation:** Leave this path unchanged. A caller that needs fewer allocations can return its own reusable per-series record.

This proposal does not add an output-parameter API. It also does not remove allocations for formatted strings or dates.

## 2. Renderer allocations: new work introduced by the migration

The renderer reconstructs a complete view on each requested frame.

At the original audit, the implementation constructed:

- A `rows` array and one `{s, i}` wrapper per included series
- A mapped value-cell array for each row, including zero-cell and single-cell rows
- Virtual nodes and property arrays for rows, labels, markers, and value cells
- A directive closure for each HTMLElement label
- An inline key-extractor closure
- A new callback for each scheduled frame

The ivi runtime also constructs list keys, rendered views, and reconciliation state. Keyed DOM identity does not memoize `rowView()`.

The `WeakMap` and its metadata records are different: they persist across frames. Their repeated cost is lookup and conditional work, not record allocation.

### 2.1 Pass `series` directly to `List`

**Implemented.** Section 11 records validation and bundle measurements.

The previous `{s, i}` wrapper preserved the original series index after filtering. Installed ivi already supplies that index to the render callback.

The implemented shape is:

```js
const seriesKey = s => s;

function rowView(s, i) {
    if (i == 0 && (multi || !legend.live || mode == 2))
        return null;

    // Construct the row from this series and its original index.
}

List(series, seriesKey, rowView)
```

The change removes the intermediate array, per-row wrapper objects, and per-frame key-extractor closure.

**Tradeoff:** An excluded series-zero row remains a keyed null slot. It costs one list entry and a small callback, but no DOM row.

The installed `List` implementation maps the supplied entries into fresh key and view arrays on each call. It does not memoize the input array.

Thus, a stable mutable `series` array works with fresh `List()` calls. No structural revision counter or index-cache maintenance is necessary.

### 2.2 Avoid arrays for zero or one value cell

**Implemented.** Section 14 records validation and bundle measurements.

The previous unconditional `keys.map(...)` created an array even when the row had no values or exactly one value.

The child expression now uses:

- `null` for no cells
- One value-cell node for one cell
- The existing mapped array for multiple cells

This removes an array and a mapping closure per ordinary scalar row and avoids an array layer during reconciliation.

**Tradeoff:** The short branch adds 64 minified bytes and 22 gzip bytes.

A separate scalar row template can avoid more virtual-node overhead, but it duplicates row markup and compiled template data.

**Recommendation:** Start with the child-expression branch, not a second complete row template.

The `.textContent` bindings remain useful. They avoid separate ivi text-state nodes.

### 2.3 Hoist the frame callback

A chart-local `flush()` function can replace the new closure inside each `requestAnimationFrame()` call.

This removes one callback allocation per scheduled frame without changing the scheduling model.

The core-scheduler change in section 10 implements this proposal through a stable `flushFrame()` callback.

Stable event handlers already avoid repeated allocation and listener replacement. Their creation occurs when metadata first appears, not on each frame.

### 2.4 Stable input is not mutable virtual output

The installed reconciler checks identity before it reconciles output. Reusing mutable input and reusing mutable output therefore have different effects.

| Operation | Assessment |
| --- | --- |
| Mutate `series`, then call `List(series, ...)` again | Supported by fresh key and view arrays |
| Mutate scalar value records, then construct fresh cell nodes | Compatible with the current data flow |
| Reuse an unchanged cached label or marker node | Valid identity-based reuse |
| Mutate and reuse the same child array or virtual node | Unsafe: reconciliation can skip the changes |

Fresh wrappers around mutated property arrays also lose the previous values needed for comparison.

A general output pool or shared scratch buffer is not a suitable shortcut here.

## 3. Narrow presentation behavior to reduce repeated work

Master creates row labels and marker presentation during row initialization. It does not continuously observe every presentation field.

The public API supports HTMLElement labels and marker callbacks. It does not specify automatic replacement or arbitrary dependency tracking after construction.

### 3.1 Cache initialization-time marker and label views

**Implemented.** Section 13 records the approved behavior changes and validation.

Metadata now retains immutable label and marker views instead of separate style fields. These views need no general invalidation system.

Subsequent renders reuse the views without repeated construction or index/mode checks.

**Tradeoff:** Assigning a replacement `series.label` does not automatically update an existing row.

The original HTMLElement label still remains a live DOM node. Its own text, attributes, and descendants can change without replacement of the label object.

Initial HTMLElement support remains required by the public API and master behavior. The optional feature is automatic label-object replacement.

The audit found no inspected demo that requires replacement after construction. That finding does not establish downstream absence.

### 3.2 Remove marker refresh for index and mode changes

The previous metadata stored `index` and `markersShow`. It refreshed marker callbacks after index shifts or marker-mode changes and cleared obsolete styles.

The implemented cache removes both fields and their refresh logic.

Master does not refresh surviving row markers after insertion or deletion. Its public marker types define callback arguments, not a refresh policy.

`demos/add-del-series.html` demonstrates middle insertion and deletion. It does not establish a requirement to recompute surviving marker presentation.

The gradient demos use marker callbacks but do not demonstrate dynamic marker-mode changes.

**Implemented:** Evaluate marker presentation once per series object and remove index/mode invalidation.

**Tradeoff:** Position-dependent marker callbacks retain their original presentation after an index shift, as on master.

Marker-mode handling must remain internally consistent. Removing cache refresh while still switching marker visibility dynamically can produce mismatched marker and label styles.

An initialization-time marker-mode policy avoids that partial implementation.

### 3.3 Registration-time bindings replace the lazy adapter

**Superseded proposal:** Bind once per lazy handler. The user instead approved element directives that restore registration-time factory calls.

The implementation removes the per-event target comparison and forwarding adapter. Stable directives call `cursor.bind` when elements render and attach returned listeners directly.

Ordinary keyed updates reuse their bindings. New or remounted targets get new bindings without a stale-target wrapper.

A `null` result attaches no listener. The browser supplies native listener `this` and `currentTarget`.

Section 16 records the implementation and validation.

## 4. Defensive integration code

### 4.1 Cursor supersession checks

The cursor path applies focus, updates legend values, publishes cursor movement, and then delivers a focus notification.

Callbacks between those phases can change focus or shift series indexes. The previous implementation checked for superseded state before notification and publication.

These checks support nested setters and structural changes during callbacks. The inspected demos and public declarations do not establish their exact latest-state guarantee.

However, the first check also compensates for a callback window introduced by the reordered integration. It is not purely a legacy bug fix.

The check after the focus hook also strengthens publication behavior beyond the general public `setSeries()` path, which has no equivalent guard.

**Implemented:** Keep ordinary hook-visible data preparation, but remove both supersession checks. Section 15 records validation.

**Tradeoff:** An outer cursor update can then deliver an obsolete focus notification or publish an outdated target after a nested change.

Restoring master notification order is another option, but it conflicts with the stronger ordinary hook-visible data contract adopted during this work.

This is an explicit behavior decision. A local deletion of checks does not preserve the current nested-callback guarantee.

The removed checks were not a complete transaction mechanism or a major allocation cost. Their former regression remains skipped as a historical reference.

### 4.2 Destruction from marker callbacks

The previous renderer checked root liveness around view construction and before mounting.

This supported a marker callback that destroyed the chart during view construction. The audit found no inspected demo or public guarantee requiring that exact case.

**Implemented:** Destruction inside marker callbacks is unsupported. The dedicated checks are removed.

Ordinary pending-frame cancellation and legend disposal state remain necessary. Deferred legend work is new and can outlive its chart without those protections.

The expected saving is code and a few branches, not a large reduction in frame allocations.

### 4.3 Native scheduling is not a direct replacement

`update(root, view)` reconciles synchronously. The native ivi scheduler operates through component invalidation.

Using that scheduler requires component plumbing. Its default microtask timing also differs from one pending animation frame per legend.

Multiple events can cause several microtask renders before a browser paint. A custom frame scheduler still needs a frame callback.

The later change moves the existing RAF scheduler into core and uses a stable callback. It does not adopt native ivi scheduling.

### 4.4 Chart-wide destruction guards

The added `destroyed` flag prevents new chart commits and blocks `_commit()` entry. This is broader than legend disposal and corrects legacy behavior.

Its runtime cost is small: one retained boolean and a few checks. It does not stop an already active commit.

A separate decision can remove those guards or retain only cancellation of already queued work.

**Tradeoff:** Removing them restores possible chart work after destruction. Narrow cancellation does not protect later setters or synchronous batches.

Core RAF now uses the same `destroyed` flag. Any canvas-only reversion must retain that flag and its frame guards.

This remains a lower-priority size decision, not the main performance opportunity.

## 5. Behavior worth retaining

| Behavior | Evidence and reason |
| --- | --- |
| Keyed series rows | Middle insertion/deletion exists in demos. HTMLElement labels can contain DOM-local state. |
| Series-object focus | Small representation that agrees with keyed rows. Numeric focus requires coordination after index shifts. |
| Separate shared-point target | Local point selection and programmatic or synced chart focus are not always the same. |
| Stale-row event rejection | Deferred removal creates a new period where obsolete DOM can still receive events. |
| Whole-table relocation | Public `legend.mount` contract and real demo usage |
| Registration-time binding directives | Public `cursor.bind` behavior, real target elements, and direct returned-listener registration |
| Initial series notifications | Public hooks explicitly include initial and subsequent additions |
| Scalar `.textContent` bindings | Avoid separate text-state nodes in the compiled renderer |

Replacing keyed lists with positional arrays can remove list overhead. It also repurposes DOM rows after insertion and deletion.

That affects HTMLElement state and target-specific binding. Direct `series` input preserves identity with less implementation complexity than a positional conversion.

Removing the `List` import does not prove that the bundled keyed reconciler disappears. Generic runtime dispatch still references it.

## 6. Bundle-size baseline

The audit measured `dist/uPlot.iife.min.js` from the checked-in master artifact and the current built artifact.

| Artifact | Minified bytes | Gzip bytes |
| --- | ---: | ---: |
| Master | 61,086 | 26,202 |
| Current | 70,374 | 30,440 |
| Increase | **9,288** | **4,238** |

Gzip measurements used Python `gzip.compress(data, mtime=0)` with its default compression level.

This comparison includes runtime, integration, and license changes. It does not isolate optional robustness code.

Master was not rebuilt with the current toolchain. These numbers are an artifact baseline, not a controlled attribution of every added byte.

Each implemented candidate needs a generated-size comparison. Fewer authored lines do not guarantee a smaller bundle.

No proposed candidate has a measured byte saving or elapsed-time result yet.

## 7. Additional concrete demo consumer — repaired

[`demos/box-whisker.js`](../../demos/box-whisker.js) previously queried `.u-legend` during `init` and immediately dereferenced the result.

The tooltip now installs `legend.mount()` through plugin `opts`, like the repaired candlestick tooltip. The mount callback receives and relocates the complete table.

Cursor updates before mounting do nothing. Mounting initializes the current cursor position and checks hover state once.

Marker hiding, tooltip styling, and enter/leave behavior remain. Column highlighting, data loading, and box drawing are unchanged.

The plugin has a named export for focused tests. `test/candlestick-tooltip.mjs` now runs the same tiny fixture against both tooltip plugins.

All four tooltip cases passed with a 128 MiB Node heap limit and a 15-second timeout. The tests cover deferred values and pre-mount cursor updates.

No full demo execution, fixture loading, box drawing, or benchmark ran. Core and distributions did not change, so no library rebuild was necessary.

This repairs a concrete deferred-mount consumer. It does not establish that every downstream consumer supports deferred legend DOM.

## 8. Recommended implementation sequence

The proposed sequence separates allocation reductions from behavior decisions:

1. **Complete:** Pass `series` directly to `List` and remove row wrappers.
2. **Complete:** Reuse scalar legend value records, with explicit placeholder and identity behavior.
3. **Complete:** Cache initialization-time label and marker views under the approved narrower presentation contract.
4. **Complete:** Remove zero/single-cell array overhead. The separate core-scheduler change also hoisted the scheduled callback.
5. **Complete:** Remove cursor supersession checks and marker-callback destruction protection under the approved narrower contract.

The separate box-whisker consumer repair is complete. It required no renderer redesign.

Work stops between implementation items. This audit does not propose renewed deletion repair, schema redesign, or general scheduler work.

## 9. Validation plan for approved changes

- Use bounded, targeted tests with primitive assertions.
- Separate allocation identity checks from behavior checks.
- Retain relevant historical expectations as skipped references when the user relaxes a contract.
- Do not retain an incidental behavior solely because an existing test asserts it.
- Preserve initial HTMLElement support, zero values, placeholders, and public structural operations.
- Measure generated minified and gzip sizes after each candidate.
- Report allocation reductions separately from measured timing improvements.
- Keep demo execution, benchmarks, and uncontrolled suites outside the existing safety limits.

The last implementation validation reported 136 passing and 22 pending cases. That result predates this audit and does not validate the proposed changes.

## 10. Implemented: core-owned legend frame scheduling

The user approved this change separately after the audit.

### Ownership and behavior

`src/uPlot.js` now owns one pending frame handle and one legend-dirty flag. `invalidateLegend()` requests a frame only when none is pending.

A stable `flushFrame()` callback reads current values, focus, and series state. It clears pending state before rendering so callbacks can request another frame.

`src/legend.js` exposes synchronous `render(values, focusedSeries)` and `destroy()` methods. It no longer owns data setters, focus setters, RAF requests, or cancellation.

Chart destruction cancels the pending frame. Core ignores callbacks after destruction, and the renderer retains its existing root-liveness checks.

The first render still creates a complete table before `legend.mount()`. Hooks and formatters keep their existing timing.

The microtask commit and synchronous `batch()` remain separate. Cursor and hover-point DOM updates do not use the frame scheduler yet.

### Cost and scope

The stable callback removes one closure allocation per scheduled legend frame. This is a source-level observation, not a measured timing improvement.

Formatting and scalar-record allocations remain synchronous. Moving the scheduler does not coalesce them.

Core uses no task collection, subscriber system, or new public API. Future cursor phases can use this frame boundary through separate approved changes.

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,374 | 70,316 | -58 |
| Gzip bytes | 30,440 | 30,455 | +15 |

Gzip uses the same measurement method as section 6. The earlier master comparison remains an audit baseline.

### Validation

The generated renderer and all four distributions were rebuilt with a 256 MiB Node heap limit and 15-second command timeouts.

The initial scheduler-focused run passed 24 tests. Coverage includes synchronous renderer calls, coalesced core frames, cancellation, mount-callback invalidation, and hook-visible data.

The first broader focused run exposed two invalid test setups introduced during conversion. A temporary series lacked data and a multi-value formatter.

Removing an unnecessary `setLegend()` call corrected those setups. `addSeries()` already invalidates the legend before the temporary series is removed.

The final focused run passed 135 tests, with 10 historical expectations still skipped. It covered `legend-ivi`, `legend`, `set-series`, and `candlestick-tooltip`.

Diagnostics reported no errors or warnings in `src/legend.js` and `src/uPlot.js`.

No demos, benchmarks, or full repository suite ran. Test commands used a 128 MiB Node heap limit and 15-second timeouts.

These limits bound command duration and Node heap size. They do not establish a total process-memory limit or explain the reported machine freeze.

## 11. Implemented: direct series input to `List`

`src/legend.js` now passes `series` directly to `List`, with a stable module-level key function. `rowView(s, i)` receives the original series index.

An excluded series-zero entry returns `null` before row metadata or virtual nodes are constructed. It occupies one keyed list slot without a DOM row.

The installed ivi implementation uses `entries.map(getKey)` and `entries.map(render)`. Each call creates fresh arrays even when the input array retains its identity.

### Allocation and behavior changes

Each render avoids one intermediate array, one `{s, i}` object per included row, and one key-extractor closure.

The change retains keyed DOM identity, index-dependent markers, HTMLElement labels, and existing row visibility rules. It adds no cache or structural revision counter.

The extra null slot is the accepted tradeoff for nonlive, multi-value, and mode 2 legends. Cell arrays and scalar value records remain unchanged.

These savings describe source allocations. No elapsed-time or heap-profile measurement ran.

### Bundle measurements

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,316 | 70,267 | -49 |
| Gzip bytes | 30,455 | 30,435 | -20 |

Gzip uses the same measurement method as section 6.

### Validation

A new renderer test covers transitions between zero and multiple Y rows with the same input array. Both inline and multi-value legends pass.

Existing tests cover middle insertion, deletion, reorder, marker indexes, HTMLElement labels, nonlive legends, and mode 2 legends.

The initial targeted run passed 10 tests. The broader focused run passed 137 tests, with 10 historical expectations still skipped.

The generated renderer and all four distributions were rebuilt. Source diagnostics reported no errors or warnings.

Commands used 15-second timeouts and Node heap limits of 128 MiB for tests and 256 MiB for builds. No demos or full repository suite ran.

Scalar value-record reuse followed this change. Section 12 records its implementation.

## 12. Implemented: stable scalar value records

### Implementation and ownership

`setLegendValues()` now mutates the scalar record in `legend.values[sidx]`. A nullish assignment creates the record on its first formatting call:

```js
let val = s.value(self, idx == null ? null : src[idx], sidx, idx);
(legend.values[sidx] ??= {})._ = val ?? LEGEND_DISP;
```

Each formatted scalar series owns a separate record. Null and undefined formatter results write `LEGEND_DISP` into that record instead of selecting a shared placeholder object.

Zero and empty strings remain valid values. The outer array and existing records retain identity across subsequent updates.

Existing splices keep records aligned with public series insertion and deletion. Removed records receive no later updates.

The change stays inside `setLegendValues()`. Initialization and insertion still create null entries, and hidden or nonlive legends allocate no scalar records.

Lazy initialization adds one nullish check per scalar refresh. It avoids eager allocation, separate caches, and additional initialization code.

### Observable behavior

A retained scalar record is a live reference, not a snapshot. `dist/uPlot.d.ts` now documents that callers must copy records to retain snapshots.

Formatting and hook timing remain unchanged. This change removes repeated wrapper allocations, not formatter calls or allocations inside formatters.

Multi-value formatters retain ownership of their returned objects. Core neither copies nor mutates those objects, and their shared null-result placeholder remains unchanged.

This optimizes an allocation pattern present on master. It does not repair an unrelated lifecycle or deletion bug.

### Bundle measurements

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,267 | 70,281 | +14 |
| Gzip bytes | 30,435 | 30,438 | +3 |

Gzip uses the same measurement method as section 6. These small increases accompany the removal of repeated scalar-record allocations.

### Validation

Three new tests cover scalar identity, distinct placeholder records, hook readback, zero, empty strings, cursor updates, and structural changes.

They also cover caller-owned multi-value objects, including frozen results and reusable records. All three tests passed.

The broader focused run passed 140 tests, with 10 historical expectations still skipped. It covered `legend-ivi`, `legend`, `set-series`, and `candlestick-tooltip`.

All four distributions were rebuilt. The authored renderer did not change, so its generated module required no regeneration.

Diagnostics reported previously noted errors outside the changed function: argument count, callable-union inference, and `queuedCommit` type inference. Those errors remain outside this task.

Commands used 15-second timeouts and Node heap limits of 128 MiB for tests and 256 MiB for builds.

No demos, benchmarks, or full repository suite ran. Allocation savings follow from source inspection, not elapsed-time or heap-profile measurements.

Cached initialization-time labels and markers followed this change. Section 13 records the approved contract and implementation.

## 13. Implemented: cached label and marker views

### Implementation

`src/legend.js` now constructs label and marker views once per series object, on its first render. The existing metadata record retains those views.

The row template reuses both views on later renders. Values, focus, visibility, row classes, and current-index event eligibility remain dynamic.

The metadata no longer stores `index`, `markersShow`, border, background, or label color. Style values are local variables during initial view construction.

`markers.show` is captured when core creates the renderer. Newly added series use that same marker mode.

The existing HTMLElement directive remains. Its closure now belongs to the cached label view instead of each render.

### Approved behavior changes

- Replacement `series.label` assignments do not update existing labels.
- Insertions, deletions, and reorder do not refresh surviving marker styles.
- Runtime `legend.markers.show` changes do not switch marker visibility or label coloring.
- Newly rendered series evaluate marker callbacks using their first rendered index.

The original HTMLElement label remains live. Its contents, attributes, listeners, and input state can change directly without renderer invalidation.

The public declarations now document initial presentation and label capture. No new update method, dependency tracking, or revision counter was added.

The lazy binding adapter remains unchanged. A remounted target still invokes `cursor.bind` for that new DOM target.

Destruction guards remain unchanged. Marker callbacks can still destroy the renderer during initial or new-row view construction.

### Allocation and bundle effects

Subsequent renders avoid label VNodes, enabled marker VNodes, their property arrays, and HTMLElement directive closures. They also avoid index/mode refresh checks.

ivi can skip cached child views by identity. These views are immutable, unlike changing value cells and row properties.

The metadata retains view references instead of separate style fields. No extra map or chart-wide cache was added.

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,281 | 70,184 | -97 |
| Gzip bytes | 30,438 | 30,402 | -36 |

Gzip uses the same measurement method as section 6. Allocation savings follow from source inspection, not a measured timing improvement.

### Validation

The targeted run passed 18 tests. It covered initial capture, both marker modes, structural changes, live HTMLElement contents, and dynamic row state.

The broader focused run passed 140 tests, with 20 skipped. Ten additional skipped cases preserve superseded presentation expectations, not master bug reproductions.

An initial targeted failure came from an incorrect test edit that expected fewer remount binding calls. Restoring the original expectation resolved it without production changes.

The generated renderer and all four distributions were rebuilt. Renderer diagnostics reported no errors or warnings.

Commands used 15-second timeouts and Node heap limits of 128 MiB for tests and 256 MiB for builds. No demos or benchmarks ran.

The zero/single-cell fast path followed this change. Section 14 records its implementation.

## 14. Implemented: zero/single-cell fast path

`rowView()` now selects its value children by column count:

- Zero columns: `null`
- One column: one cell VNode
- Multiple columns: the existing mapped array

The one-column branch uses `keys[0]`, so it also supports single-column multi-value legends. It does not assume the scalar `_` key.

Zero- and one-column rows avoid one array and one mapping callback per render. Changing values still need fresh cell VNodes.

The change adds only a short branch. It adds no cache, helper, alternate row template, or public behavior change. `.textContent` bindings remain unchanged.

### Bundle measurements

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,184 | 70,248 | +64 |
| Gzip bytes | 30,402 | 30,424 | +22 |

Gzip uses the same measurement method as section 6. No elapsed-time improvement was measured.

### Validation

The targeted run passed eight tests across zero, scalar, single named, and multiple columns. Coverage includes zero values, empty strings, placeholders, and retained cells.

The broader focused run passed 141 tests, with 20 historical cases still skipped. No additional expectations were skipped for this change.

The generated renderer and all four distributions were rebuilt. Renderer diagnostics reported no errors or warnings.

Commands used 15-second timeouts and Node heap limits of 128 MiB for tests and 256 MiB for builds. No demos or benchmarks ran.

The recommended allocation changes are complete. Section 15 records the later removal of cursor supersession checks and marker-callback destruction protection.

## 15. Implemented: remove two optional callback guarantees

### Cursor focus notifications

`updateCursor()` no longer captures a focus snapshot or checks whether nested callbacks superseded its focus index.

Both checks are removed: the check before the focus hook and the check before synchronization publication.

Ordinary data preparation and notification order remain unchanged. Publication still requires a local source, the publication flag, and `syncOpts.setSeries`.

If a nested callback changes focus or series indexes, the outer operation can deliver an obsolete notification or publication. This is an accepted limitation.

### Marker callback destruction

The renderer now calls `update(root, view())` directly and mounts the complete table on its first render.

The intermediate view variable and root-liveness checks around construction and mounting are removed. Marker callbacks must not destroy the chart.

Core still cancels pending frames on destruction and rejects later frame work. Renderer entry still ignores calls after disposal, and disposal remains guarded.

The change does not remove ordinary `legend.mount()` support or add work after its callback returns.

### Bundle measurements

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,248 | 70,164 | -84 |
| Gzip bytes | 30,424 | 30,381 | -43 |

Gzip uses the same measurement method as section 6. No timing or allocation benchmark ran.

### Validation

The targeted run passed 18 tests for ordinary hook readback, synchronization, frame cancellation, and renderer disposal.

The broader focused run passed 135 tests, with 27 skipped. It included the existing skipped `cursor-focus` case.

Six newly skipped cases preserve superseded focus and marker-destruction guarantees across inline and table legends. They are historical expectations, not master bug reproductions.

The generated renderer and all four distributions were rebuilt. Renderer diagnostics reported no errors or warnings.

Core diagnostics still report the previously documented argument-count, callable-union, and commit-inference errors outside this change.

Commands used 15-second timeouts and Node heap limits of 128 MiB for tests and 256 MiB for builds. No demos or full suite ran.

The later binding change appears in section 16. A possible canvas-only destruction-guard reversion remains unimplemented.

## 16. Implemented: registration-time `cursor.bind` directives

### Timing and listener ownership

The legend no longer waits for the first DOM event to invoke a binding factory. Each eligible header invokes its factories during rendering.

The table capture directive also binds `mouseleave` when cursor focus is enabled. All applicable factories run before `legend.mount()` receives the complete table.

Factories receive real elements during reconciliation. They do not require interaction, value changes, or a focus trigger.

The returned listeners attach directly with `addEventListener()`. Native event dispatch supplies listener `this`, and `removeEventListener()` can remove the returned function.

A factory that returns `null` attaches nothing. Stable directive identity prevents repeated calls on ordinary updates.

### Structure and cost

Existing row metadata retains bind and unbind directives. The unbind directive removes header listeners when the series moves into index zero.

Values, visibility, focus, class changes, and Y-index shifts do not rebind retained headers. New and remounted headers bind when they render.

Normal row removal removes the subtree. There is no new listener map, unmount registry, or per-event forwarding closure.

This moves factory execution from first interaction to initial rendering, including for rows that receive no events. It restores registration-time behavior without synchronous legend DOM.

| `dist/uPlot.iife.min.js` | Before | After | Change |
| --- | ---: | ---: | ---: |
| Minified bytes | 70,164 | 70,143 | -21 |
| Gzip bytes | 30,381 | 30,360 | -21 |

Gzip uses the same measurement method as section 6. No elapsed-time benchmark ran.

### Validation

The targeted run passed 18 tests. Coverage includes eager registration, update stability, remounts, series-zero unbinding, null factories, native listener context, and direct listener removal.

The broader focused run passed 147 tests, with 26 historical expectations still skipped. It includes both candlestick and box-whisker tooltip fixtures.

The generated renderer and all four distributions were rebuilt. Renderer diagnostics reported no errors or warnings.

Commands used 15-second timeouts and Node heap limits of 128 MiB for tests and 256 MiB for builds. No demos or full suite ran.

## 17. Implemented: simpler build integration and explicit root updates

### Build changes

`scripts/build-legend.mjs` now has fixed input and output paths. It emits one explicit `createLegend(self, parent, opts)` export.

The generator no longer creates generic export proxies or an unused idle-callback fallback. It retains the self-contained chunk check and source hash.

The lazy wrapper delays DOM prototype and template initialization until chart construction. Source and distribution imports still work without DOM globals.

`npm run build` now regenerates the legend before Rollup builds the distributions. `check:legend` remains a cheap source-hash check for direct source workflows.

The initial change emitted one preserved `/*! ... */` notice from `LICENSE-ivi`. Rollup no longer removed and reinserted that notice.

The later header reduction replaces the embedded notice with a repository link, as recorded in section 18.

### Explicit root updates

The renderer uses one module-level `defineRoot(() => {})` factory instead of the default microtask-scheduled root factory.

The view has no stateful components or native invalidations. Core already schedules every explicit `update()` call, so the root needs no invalidation scheduler.

Header-binding directives and their timing remain unchanged. The Happy DOM text-content adapter also remains unchanged.

### Bundle measurements

Measurements cover `dist/uPlot.iife.min.js` after each separate build:

| Stage | Minified bytes | Gzip bytes |
| --- | ---: | ---: |
| Before items 1–4 | 70,143 | 30,360 |
| Generator, automatic build, and license changes | 70,134 | 30,373 |
| Explicit root updates | 70,101 | 30,361 |

The managed root saves 33 minified bytes and 12 gzip bytes relative to the preceding stage.

The total change saves 42 minified bytes and adds one gzip byte. Gzip uses `gzip.compress(bytes, mtime=0)`. No elapsed-time benchmark ran.

### Validation

The initial `test/legend-build.mjs` checks covered the complete license notice in the generated module and all four distributions.

A bounded fresh Node subprocess loads source and every distribution without DOM globals. It also checks public utility exports and small utility results.

The focused suite passed 154 tests, with 26 historical expectations still skipped. It includes renderer, legend, series, tooltip, build, and instrumented-DOM tests.

Both normal builds completed within their 15-second timeouts. The generated-source check, whitespace check, and renderer diagnostics passed.

Tests used 128 MiB Node heap limits, and builds used 256 MiB limits. No full suite, demos, or performance benchmarks ran.

## 18. Implemented: compact repository attribution

Each distribution header now places `https://github.com/localvoid/ivi` directly after the uPlot link. The generated module no longer embeds the full license.

The repository and npm package retain the full `LICENSE-ivi` file. Distribution of standalone bundles also requires the accompanying license notice.

The minified bundle decreased from 70,101 to 69,006 bytes. Gzip size decreased from 30,361 to 29,624 bytes with the same measurement method.

All six build-artifact tests passed. They cover link placement, separate license-file inclusion, and DOM-free imports.

The bounded normal build, generated-source check, and whitespace check passed. No runtime code changed.
