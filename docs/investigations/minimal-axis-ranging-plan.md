# Minimal axis-aware Y ranging

## Baseline and references

- Working branch: `poc/axis-ranging-chart`.
- Numeric checkpoint: `7fb26d10`, committed before chart integration.
- One-axis chart checkpoint: `2560b093`, committed before multi-Y validation.
- Pre-audit-fix checkpoint: `ad725b06`, including multi-Y validation, the demo, and its server.
- Initial baseline branch: `poc/axis-ranging-minimal`.
- Baseline: `e66ee61f` (the locally recorded `origin/master`).
- Previous implementation and tests: `6aea79c7`, preserved on local `master`.
- Original prototype: `d338e8cd44931e98c5ecef1b530758fe54baf0d5`.

This branch starts from the baseline, not from the larger implementation. The earlier tests provide reference cases, not an obligation to retain every feature.

## Agreed goal

Independent Y scales have matching tick positions through X zoom, resize, and data changes.

Tick count depends on available height and the original spacing ramp. Data determines each scale's increment and bounds, not its count.

This changes the original prototype's independent count selection. It retains the spacing formula, dimension thresholds, and small-axis endpoint policy.

## Scope

- Mode 1 only.
- Physical left/right Y axes, not X or rotated horizontal Y axes.
- Independent linear numeric scales only.
- Automatic ranging only.
- Built-in numeric increments only. Custom increment lists and callbacks are deferred.
- Built-in scanners only for the MVP guarantee. General custom-scanner support is deferred.
- No derived scales or parents of derived scales.
- Declarative `Range.Config` objects and partial range arrays can participate when active limits align with built-in tick increments.
- Fixed arrays, range functions, and concrete setter requests remain on the ordinary path.
- No convergence or repeated label measurement.
- Normal asynchronous rendering and automatic microtask batching only.
- Legacy synchronous `batch()` behavior and its reentrancy are outside this experiment.

### Activation

The tick-aware path requires `scale.axis`. Its value must identify the visible vertical axis that owns the scale.

All of these conditions must also apply:

- The chart uses mode 1.
- The scale is an independent linear numeric Y scale.
- The scale is not a derived scale or a parent of one.
- The scale uses a physical left or right Y axis.
- The scale does not use `auto: false`.
- The axis uses the built-in `space`, `incrs`, and `splits` policies.
- The range is omitted, a supported `Range.Config`, or a partial range array.

A supported `Range.Config` can contain the top-level `zeroIf` threshold and per-side `pad`, `soft`, and `hard` values.
A configuration with an explicit `flat` policy uses the ordinary path.

A partial range array uses hard-plus-soft normalization. For example, `[0, null]` fixes the lower endpoint and automatically ranges the upper endpoint.

A fixed range array or a range function uses the ordinary path. A concrete `setScale()` request also uses the ordinary path.

An automatic reset with null bounds returns the scale to the tick-aware path.

### Default numeric range policy

Ordinary and tick-aware numeric rangers share these defaults:

- The top-level `zeroIf` threshold is `0.1`.
- Neither side has an implicit soft anchor.
- No hard limit applies.
- Each side defaults to `pad: 0.1`.

Zero proximity anchors zero when its distance from one-sided data is at most `zeroIf * rawSpan`.
For nonnegative data, the distance is `rawMin`. For nonpositive data, the distance is `-rawMax`.
The rule uses raw extrema and `rawSpan = rawMax - rawMin`, before padding, hard clipping, or flat-range normalization.
A value of `0` disables this proximity rule. An omitted or null `zeroIf` retains the default `0.1`.

A declarative `Range.Config` overrides the specified fields. Omitted per-side fields retain their defaults.
A null side in a partial range array also retains the default policy.

An explicit `soft` is an exact preferred endpoint, subject to hard limits:

- `min.soft` is active exactly when `rawMin >= min.soft`.
- `max.soft` is active exactly when `rawMax <= max.soft`.

An omitted or null `soft` supplies no soft anchor. There is no implicit `soft: 0`.
If data crosses a soft endpoint, that anchor becomes inactive and normal padding applies, subject to hard limits and `zeroIf`.
Soft activation does not depend on padding or tick selection.

The precedence is hard limits, active explicit soft anchors, `zeroIf` anchors, then padding.
Null soft limits do not disable zero proximity. All active anchors override padding on their side.

`Range.SoftMode` and `Range.Limit.mode` are removed.
The [migration guide](../README.md#soft-limit-migration) explains each old mode and the replacement for the default soft-zero policy.

An active limit must align with the selected built-in tick increment.

Concrete setter requests remain outside the alignment guarantee. This experiment does not change global setter semantics.

### Minimum range padding

Each side's `pad` specifies minimum clearance between its raw data extremum and the outer tick. It is a fraction of the original data span, not the tick range or an anchored range:

```js
rawSpan = dataMax - dataMin;
requiredMin = dataMin - min.pad * rawSpan;
requiredMax = dataMax + max.pad * rawSpan;
```

Unanchored outer ticks enclose these requirements. Tick rounding can provide more clearance. Active soft anchors and `zeroIf` anchors override padding on their side. Hard limits cap padding and can clip data. Inactive soft limits do not suppress padding.

For data `[20, 100]`, `max.pad: 0.1` requires an unanchored maximum tick of at least `108`. A minimum anchor at zero does not change that requirement to `110`.

The ranger resolves anchors from raw extrema before one tick-grid selection. There is no natural-grid prepass or retry for soft activation.
Anchored sides ignore even huge padding values whose multiplication by the raw span overflows. No padding-overflow fallback is necessary on those sides.
Unanchored padding requirements still apply.

Padding defaults to `0.1`, as in ordinary numeric ranging. Explicit `pad: 0` disables padding on that side. Tick-aware padding must be finite and nonnegative. Invalid padding returns no supported range. Flat data has zero raw span, so padding leaves the existing flat-data fallback unchanged. Neither padding nor anchors alter scan results or extrema caches.

## Numeric policy

The dimension is plot height in CSS pixels, after horizontal-axis reservations and baseline padding.

The default spacing ramp is:

```js
if (height < 50)
  space = height;
else {
  const x = Math.min(1, (height - 50) / 950);
  space = 25 + (x == 1 ? 1 : 1 - 2 ** (-10 * x)) * 25;
}

const intervals = Math.max(1, Math.floor(height / space));
```

- Below 50px, the policy requests one interval and two endpoint ticks.
- At 50px, it requests two intervals and three ticks.
- Between 50px and 1000px, spacing increases from 25px toward 50px.
- At 1000px and beyond, spacing stays at 50px.

Each scale selects an allowed increment that encloses its extrema within the interval budget. Spare intervals expand the range without clipping data.

For one-sided data, zero qualifies as an anchor when its distance from the nearest raw extremum is at most `zeroIf * rawSpan`.
Hard limits and active explicit soft anchors take precedence. Zero can still occur outside this threshold when the selected grid requires it.

The range limits normally lie on increment multiples. One-sided data avoids unnecessary zero crossing when possible.

Mixed-sign data cannot fit one zero-aligned interval. The tiny-axis case uses two endpoint ticks on a grid offset from the lower bound.

Empty data retains null bounds. Flat data needs a nonzero candidate span before increment selection. The original prototype uses `[v - abs(v), v + abs(v)]`, or `[0, 100]` for zero.

The first experiment reuses the baseline rounding helpers. Numeric failures must be recorded before more precision machinery is added.

## Computation flow

This comparison describes mode 1 charts with independent, linear, vertical Y scales. The ordinary path means automatic ranging without the `scale.axis` opt-in.

Both paths use the existing height-first layout. The difference is when Y bounds become final and how those bounds relate to tick selection.

The sequences show a data-window update that requires layout. `_commit()` skips scale processing or layout when the corresponding work flag is clear.

### Ordinary automatic ranging

```text
Setters record pending work
  -> commit() queues one microtask
  -> _commit()
       setScales()
         Resolve X bounds and visible indices i0/i1
         Scan Y extrema for the visible window
         Apply scale.range() to produce Y display bounds
         Publish bounds and invalidate paths on changed scales
         Fire setScale hooks for changed scales

       updateLayout()
         Determine visible axes from display bounds
         Reserve horizontal-axis heights: sizeAxes(0)
         Calculate baseline padding: paddingCalc("layout")
         Establish final plot height: calcPlotDim(1)
         Choose Y increments and generate ticks/labels: axesCalc(1)
         Measure vertical-axis widths once: sizeAxes(1)
         Complete horizontal layout, canvas, and DOM updates

       Draw, update interaction state, and finish the commit
```

The ordinary numeric ranger applies its padding and zero policy before layout. Each axis then selects an increment using those display bounds and its spacing requirements.

Tick selection does not revise the display bounds. Endpoint ticks and matching counts across independent Y scales are therefore not guaranteed.

### Tick-aware automatic Y ranging

```text
Setters record pending work
  -> commit() queues one microtask
  -> _commit()
       setScales()
         Resolve X bounds and visible indices i0/i1
         Scan Y extrema for the visible window
         Cache eligible automatic Y extrema in _rawY
         Skip ordinary padding and Y bounds publication
         Publish ordinary scale changes, including X, and notify hooks

       updateLayout()
         Determine eligible Y-axis visibility from raw-data availability
         Reserve horizontal-axis heights: sizeAxes(0)
         Calculate baseline padding: paddingCalc("layout")
         Establish final plot height: calcPlotDim(1)
         For each active scale, call rangeY(rawMin, rawMax, plotHgtCss)
           Resolve hard limits, explicit soft anchors, and zero-proximity anchors
           Apply padding requirements only on unanchored sides
           Select the height-derived count, increment, and enclosing bounds once
           Store the result in _rangeY and publish Y display bounds
           Invalidate paths on changed Y scales and collect changedY
         Generate Y ticks/labels from the retained increments: axesCalc(1)
         Measure vertical-axis widths once: sizeAxes(1)
         Complete horizontal layout, canvas, and DOM updates
         Return changedY

       Fire setScale hooks for changed tick-aware Y scales
       Draw, update interaction state, and finish the commit
```

`applyScanRange()` selects the ordinary or deferred path during `setScales()`. The Y-ranging phase is currently inline in `updateLayout()`, not a separate helper.

All active Y bounds become final before vertical tick generation and measurement. Each scale receives the same plot height, so supported, nonempty ranges have the same interval count.

Empty data produces null bounds and no ticks. Unsupported numeric inputs also produce null bounds and no ticks, rather than an ordinary-range fallback.

`getIncrSpace()` reuses the retained increment instead of performing ordinary increment selection. For one interval, `axesCalc()` uses the two endpoints directly. Otherwise, the baseline split generator starts at the lower bound.

### Shared layout completion

Both paths complete layout in this order:

```text
Measured vertical-axis widths
  -> calcPlotDim(0): provisional plot width
  -> axesCalc(0): horizontal ticks and labels
  -> paddingCalc("overflow"): horizontal padding adjustments
  -> calcPlotDim(0): final plot width, without another tick-selection pass
  -> calcAxesRects(): axis positions
  -> update canvas dimensions when requested
  -> invalidate all Y paths if plot geometry or pixel ratio changed
  -> update overlays and DOM geometry
  -> fire setSize when size or layout changed
```

Vertical labels and horizontal overflow padding can change width, but cannot change the height already used for Y ranging. Horizontal-axis reservation receives `null` labels, rather than depending on the subsequent X tick selection.

For tick-aware scales, `setScale` notifications follow layout completion and precede drawing. Ordinary scale notifications occur earlier, during `setScales()`.

In a mixed chart, an ordinary X hook can therefore observe previous tick-aware Y bounds. Tick-aware Y hooks observe all finalized Y bounds and ticks.

### Differences at a glance

| Computation | Ordinary automatic Y | Tick-aware automatic Y |
| --- | --- | --- |
| Input to the ranger | Scanner extrema | Cached scanner extrema in `_rawY` |
| When Y bounds become final | During `setScales()`, before layout | During `updateLayout()`, after final plot height |
| Bounds policy | Existing `scale.range()`, including default numeric padding | Tick-aligned enclosure, zero affinity, and declarative limits from `rangeY()` |
| Increment selection | Axis selects an increment after ranging | Ranger selects an increment together with bounds |
| Tick count | Depends on each range and selected increment | Depends on plot height and the common ramp for supported, nonempty ranges |
| Endpoint ticks | Not guaranteed | Both endpoints are ticks for supported inputs |
| Resize without new data | Keeps bounds and selects ticks for the new dimension | Reuses extrema and recalculates bounds and ticks |
| Y `setScale` notifications | Before layout | After layout, before drawing |

### Work and cache lifetime

| Update | Scale processing | Layout work |
| --- | --- | --- |
| X zoom | Resolves the visible window and refreshes affected automatic Y extrema | Ranges active Y scales, then selects ticks and measures axes |
| `setData()` with default scale reset | Resets series extrema and refreshes required scales | Uses the new extrema, not previous rounded bounds |
| Series visibility | Refreshes the affected scale aggregate | Recalculates ranges and visible axes |
| `setSize()` | No data scan | Ordinary bounds remain unchanged. Tick-aware bounds use cached extrema and the new height |
| `redraw(false, true)` | No data scan | Recalculates axes. Unchanged geometry and bounds retain series paths |
| Concrete Y setter request | Clears the tick-aware cache and uses ordinary setter semantics | Restores ordinary tick selection, even when bounds are unchanged |

These rows describe the requested update without additional work requested by callbacks. Resize never feeds display bounds back into the raw-extrema cache.

`_axisY` records eligibility. A non-null `_rawY` activates deferred ranging, including `[null, null]` for empty data. `_rangeY` holds the result for the current layout.

### End of commit and follow-up work

After scale processing, `_commit()` clears the completed `viaAutoScaleX` flag. A later hook can then request a new automatic reset without losing its flag.

After drawing, the commit updates pending selection, cursor, and legend state. It then releases `queuedCommit`.

If scale or layout work remains pending, `commit()` schedules a follow-up microtask. Multiple requests share that microtask. A no-op setter does not create pending work.

This is a new requested update, not a convergence pass. The ranger does not repeat layout to search for stable bounds or label sizes.

The commit also clears uncached paths when configured and fires `ready` once. Legacy synchronous `batch()` handling remains outside the MVP guarantee.

## Incremental milestones

### 1. Numeric proof of concept

Implement a small standalone calculation without changing chart execution order or existing defaults.

Return the display bounds, increment, and interval count. Exercise the result with selected numeric cases from the earlier tests.

Acceptance targets:

- Both endpoints are ticks.
- Tick count follows the dimension policy.
- Unrelated data ranges have matching normalized tick positions.
- Bounds enclose the input extrema.
- Existing rounding helpers handle ordinary signed and fractional data.
- The implementation reports unsupported inputs instead of hiding them with another ranging policy.

### 2. Minimal chart proof of concept

Connect the calculation to one eligible automatic vertical Y scale after height becomes available. Reuse its selected increment during tick generation.

Keep X resolution, scanner behavior, and ordinary rangers unchanged. Add the smallest necessary cache for raw Y extrema.

### 3. MVP

Extend the same path to multiple Y scales, X zoom, resize, data replacement, empty data, and series visibility changes.

Verify one scan per required data-window update, no scans on resize, and one tick-selection/measurement pass per axis.

Check final-range hooks and selective path invalidation. Do not import a general publication framework unless a concrete test requires it.

## Test accounting

Reference tests are available with `git show 6aea79c7:test/<file>`:

- `axis-range-alignment.mjs`: counts, geometry, enclosure, independent increment lists, and floating-point boundaries.
- `axis-range-defaults.mjs`: ramp thresholds, empty/flat data, scan caching, and resize.
- `axis-range-precision.mjs`: large integer offsets, fractional precision, and rejected increments.
- `layout.mjs`: layout order, cache reuse, and callback counts.

Port applicable assertions into focused tests. Record omitted categories rather than marking excluded behavior as passing.

Out-of-scope categories include mode 2, horizontal Y ranging, concrete partial setter alignment, fixed ranges, range functions, derived scales, and composition with custom callbacks.

Passing numeric tests does not establish chart-level cache or lifecycle correctness. Those require integration tests in milestones 2 and 3.

## Progress

- Baseline branch created. Previous work remains recoverable on `master` and the existing backup branches.
- Numeric proof of concept: complete and preserved in checkpoint `7fb26d10`.
- One-axis chart proof of concept: complete and preserved in checkpoint `2560b093`.
- Scoped multi-Y MVP: validated for the tested microtask update paths.

### Numeric POC results

`rangeY(min, max, height)` returns bounds, an increment, and an interval count. It uses only the built-in `numIncrs` list.

Empty data returns null bounds with no ticks. Unsupported inputs return `null`, without a fallback count or range policy.

`test/range-y-poc.mjs` has 116 passing cases:

- 17 height-policy cases, including the 50px and 1000px thresholds.
- 84 numeric cases, including alignment, flat data, enclosure, spare intervals, decimal boundaries, and large integer offsets.
- 15 empty-data and unsupported-input cases.

These are selected assertions from earlier tests, plus direct checks for this POC. They are not 116 unchanged integration tests from the earlier implementation.

The prior custom-increment cases now use built-in increments. Some expected bounds therefore differ. Custom spacing, increment callbacks, and metadata-cache assertions remain deferred.

The flat extrema from the zoom regression produce eight intervals at 413px:

| Extrema | Bounds | Increment |
| --- | --- | --- |
| `[38, 38]` | `[0, 80]` | `10` |
| `[1300, 1300]` | `[0, 4000]` | `500` |

The tests use the baseline tick generator for counts greater than one. Tiny axes use the two returned endpoints directly.

### Numeric findings and limits

The first focused run passed 103 cases and failed four. One failure was an incorrect test expectation: 333px requests seven intervals, not six.

Two failures came from applying the mixed-sign endpoint exception before selecting a suitable increment. The exception now requires an increment at least as large as the data span.

The remaining failure came from tolerant rounding at `0.29999999999999993`. Two outward corrections preserve strict enclosure without changes to the baseline helpers.

Additional probes found wrong counts and missing endpoint ticks near large offsets. Examples included `[999999999999998, 999999999999999]` and `[99999999999999.8, 99999999999999.9]`.

A conservative candidate check now enforces the baseline quotient and decimal budgets. It also limits arithmetic to safe integer magnitudes.

- Fine grids near large offsets can select a coarser built-in increment.
- Inputs beyond the safe integer magnitude remain unsupported, even when some larger grids are representable.
- Inputs smaller than `1e-32` can use the smallest built-in increment, with a wider display range.
- Overflow, invalid extrema, and unavailable increments return `null`.
- No indexed tick generator, arbitrary-precision arithmetic, or custom-increment machinery was added.

The POC does not establish precision correctness for every finite JavaScript number. The current tests define the verified cases.

### Numeric checkpoint size and validation

- Numeric module: 72 lines, including comments and blank lines.
- Focused tests: 133 lines.
- No changes to `uPlot.js`, baseline rounding helpers, public types, or chart defaults.
- Focused command: `node ./scripts/test.mjs test/range-y-poc.mjs --reporter dot` — 116 passing.
- Full command: `npm test -- --reporter dot` — 1,129 passing.
- Git whitespace checks reported no errors, including checks of the new files.

These results describe the numeric checkpoint, before chart integration. `lux.patch` remains untouched.

### One-axis chart POC

The experimental opt-in links a scale to its axis index:

```js
scales: {
  x: { time: false },
  y: { axis: 1 },
}
```

The linked axis must be visible and vertical. The scale must meet the agreed mode, distribution, and independence constraints.

Configured `scale.range`, `auto: false`, custom increments, custom splits, and custom spacing retain the ordinary path. Charts without the opt-in remain unchanged.

This opt-in is experimental. Public types and distributed bundles do not expose it yet.

The chart retains three pieces of internal state:

- `_axisY`: eligibility for the experimental path.
- `_rawY`: cached scanner extrema. `null` means ordinary ranging. `[null, null]` means active automatic ranging with empty data.
- `_rangeY`: the numeric result for the current plot height.

The scanner runs at the existing point after X resolution. The selected Y scale bypasses ordinary padding and waits for final plot height.

The layout calculates Y bounds before vertical tick generation and label measurement. The existing tick generator consumes the selected increment without another selection pass.

Resize reuses `_rawY`. Changed bounds invalidate paths on that scale and notify its `setScale` hooks after layout.

Unsupported numeric inputs produce null display bounds and no ticks. The POC does not replace them with ordinary ranging.

Concrete setter requests clear `_rawY` and restore ordinary tick selection. Even an identical explicit range requires layout, because its tick-selection policy changes.

### Chart tests and size

`test/range-y-chart-poc.mjs` adds 48 cases:

- Left/right axes, both directions, and pixel ratios of 1 and 2.
- Height thresholds, horizontal reservations, padding, and one vertical measurement per layout.
- X zoom to flat 38, repeated resize, raw-extrema preservation, and scan counts.
- Empty data, flat data, data replacement, and series visibility.
- Explicit setters, automatic reset, eligibility exclusions, and custom-range precedence.
- Unsupported numeric inputs and recovery.
- Final Y bounds in hooks and no notification for unchanged bounds.
- Real line drawing, path-cache reuse, and invalidation at fixed geometry.

The initial 44 chart cases passed. An additional same-bounds setter case exposed stale ticks. Cache clearing now requests layout, and all four additional cases pass.

The chart integration adds 68 lines and removes seven lines from `src/uPlot.js`. It adds no new layout pass, numeric helper, or publication framework.

Validation:

- Numeric, chart, layout, range-policy, and scanner suites: 426 passing.
- Full command: `npm test -- --reporter dot` — 1,177 passing.
- Git whitespace check: no errors.

Chart integration is preserved in checkpoint `2560b093` on `poc/axis-ranging-chart`. The numeric checkpoint remains recoverable at `7fb26d10`.

### Multi-Y validation

`test/range-y-multi.mjs` adds 14 cases. The tests use the normal microtask update path, not the legacy synchronous `batch()` API.

The original zoom regression now has chart-level coverage. At 413px, the left scale uses `[0, 80]`, and the right scale uses `[0, 4000]`. Both scales have nine aligned ticks.

Coverage includes:

- Two and three independent Y scales, with real line paths.
- Pixel ratios of 1 and 2, with matching and opposite scale directions.
- Plot heights of 40, 50, 125, 333, 413, 525, and 1000px.
- One scan per affected scale after a required update, and no scans on resize or axis-only redraw.
- One values callback and one size callback per visible Y axis per layout.
- Data replacement, empty and all-null data, and recovery.
- Visibility changes with independent scales and multiple series on one scale.
- Selective path invalidation at fixed geometry.
- All participating Y bounds and ticks finalized before Y notifications.
- No Y notification when bounds remain unchanged.
- Multiple data, zoom, visibility, and size updates combined into one microtask render.
- Multiple resize requests combined into one layout and draw, without data scans.

All new cases passed without runtime changes. This step adds tests and documentation only.

Validation:

- Numeric, one-axis, and multi-Y suites: 178 passing.
- Full command: `npm test -- --reporter dot` — 1,191 passing.

The implementation still consists of the 72-line numeric module and 61 net lines of chart integration. No convergence loop or general notification framework was necessary.

Legacy synchronous `batch()` handling is not an MVP requirement. Its existing implementation remains unchanged. Ordinary scale hooks still run before layout-stage Y notifications.

These results establish the scoped MVP for the tested inputs and update paths. The documented numeric limits and experimental API status still apply.

### Interactive demo

`demos/axis-range-aligned.html` provides two independent random walks on left and right Y scales. The demo index includes a link.

Controls include:

- Chart height from 60px to 1200px, updated through `setSize()` without new data scans.
- Separate start values and step deviations for each 501-sample walk.
- New walks with the current settings, or randomized starts and spreads across different magnitudes.
- Horizontal drag zoom, double-click reset, and a Reset zoom button.
- A readout of plot height, tick counts, display bounds, and increments.

The right Y grid is disabled. Its ticks align with the horizontal grid from the left Y scale.

The demo imports the current source and stylesheet directly. No bundle rebuild is necessary.

Run `bun run demos` or `npm run demos` from the repository root. Open `http://127.0.0.1:3000/demos/` and select the aligned-ticks demo.

The dependency-free server in `scripts/demos.mjs` serves local demo assets under Node or Bun. `PORT` overrides the default port of 3000.

`test/axis-range-demo.mjs` adds seven passing control tests. These cover resize scan reuse, randomization, flat data, zoom/reset, invalid input, and listener cleanup.

Full command: `npm test -- --reporter dot` — 1,198 passing. The DOM/canvas test harness validates behavior, not browser appearance.

Public types and distributed bundles remain deferred until the experimental API is accepted.

## Audit assessment and follow-ups

Checkpoint `ad725b06` preserves the state before these fixes. The audit retains the directed layout and separate raw-extrema cache. It does not introduce a general range or notification framework.

### Fixed: unsupported decimal precision

The built-in increment `2.5e-32` needs 33 decimal places. The baseline rounding helper supports at most 32.

For `[-1e-21, -1e-21 + 6e-32]` at 150px, the ranger selected three intervals, but tick generation produced only three ticks.

The candidate guard now rejects increments beyond 32 decimal places and continues to a coarser increment. Regressions cover both signs and preserve strict enclosure.

Before the fix, both new numeric tests failed. After the fix, all 118 numeric tests passed. The obsolete comment about unused chart integration was removed.

### Fixed: work requested by late Y hooks

A Y `setScale` hook can call an asynchronous setter after the relevant commit phase finishes. Previously, the active commit prevented another microtask from being queued.

The commit now queues a follow-up microtask when scale or layout work remains pending. The completed automatic-range flag resets after scale processing, before late hooks.

This preserves a new automatic reset from a hook without retaining the flag from the previous update. It does not repeat measurement inside a commit.

Seven regressions cover resize, pixel ratio, X zoom, data replacement, explicit Y bounds, combined hook requests, and no-op setters. Before the fix, six failed. All seven now pass.

Legacy synchronous `batch()` remains outside the MVP requirements. Its implementation and pre-existing tests remain unchanged.

### Strengthened test assertions

Retained-path checks now inspect strokes after the latest canvas clear, not the entire draw history. Two regressions reject historical strokes as evidence of a current draw.

The demo also has a seeded regression for independent spread controls. It checks proportional changes in deviations and distinct normalized walks.

### Deferred: custom-scanner result ownership

`applyScanRange()` retains the array returned by the scanner until layout. A custom scanner can reuse one scratch array across scales.

The audit reproduced scans of `[13, 87]` and `[1300, 8700]` that both became `[1300, 8700]` in the deferred cache. Ordinary ranging consumed each result immediately and avoided this aliasing problem.

General custom-scanner support is not an MVP requirement. This behavior remains unchanged and is not covered by the MVP guarantee.

Before adding that support, the cache must snapshot the two extrema or require explicit ownership of returned arrays. A shared-scratch-array regression must cover both scales.

Existing custom-scan probes remain useful tests of particular cases. They do not establish a general ownership contract, and the eligibility gate does not currently reject custom scanners.

### Validation after audit fixes

- Numeric, hook, one-axis, multi-Y, demo, and existing ready suites: 206 passing.
- Main suite: `npm test -- --reporter dot` — 1,210 passing.
- The separate `test:server` suite was not run for these changes.
- No pre-existing test files were modified. Changes to existing test files affect only tests added during this POC.

The new regression tests and fixes remain uncommitted after checkpoint `ad725b06`.

## Follow-up questions and future work

The original follow-up list is retained verbatim below. Zero affinity, minimum percentage padding, and tick-aligned declarative hard and soft limits are now implemented. The existing relative `flat` policy remains ordinary.

Policy regressions must cover zero-proximity thresholds, minimum padding, anchor precedence, soft-endpoint crossings, hard clipping, limit alignment, partial-range normalization, and one-interval axes.
The earlier `test/range-y-policy.mjs` coverage of all four soft modes is historical, not the current API contract.

```text
see what we can retain from existing rangers
  zero affinity (data extrema where 0 is within 10% of range should snap to 0)
  hard and soft limits, mixed hard + auto?
  minimum scale padding in px? prolly not needed due to already-large padding
  how does this work for smooth dragging?
  matched 0 between axes?
  explicit range uses normal path, reset/auto goes back to bound ticks. this might work already?
```
