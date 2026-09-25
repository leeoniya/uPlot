# Open scale issue review

## Scope

Review date: 2026-09-17. Original source checkpoint: `b52bd96`, with the local issue-demo reductions.
This update includes the static-range fix, the X-range refactor, drag-bound refinement, public `setRange()`, declarations, and generated bundles.

The layout assessments in this review predate `scale.axis` support for independent linear numeric Y scales in either physical orientation.
The [current ranging policy](minimal-axis-ranging-plan.md#scope) defines support and exclusions. This note does not update GitHub issue states.

The [GitHub search](https://github.com/leeoniya/uPlot/issues?q=is%3Aissue%20state%3Aopen%20scale) now returns **61 open issues**.
The API returned all 61 results with `incomplete_results: false`.
The original review covered 65 results. Issues 648, 655, 915, and 1133 closed after that snapshot.

The search includes incidental mentions of scales, not only ranging defects.
Issues 823 and 808 are outside these search results because both are closed. Their assessments remain in the [seven-issue review](scale-range-issue-review.md).

Historical before/after comparisons use `7074d27` as the baseline before `b63f56d` (`add scale.scan`).
A passing related test does not establish resolution of an original report.
Technical closure candidates do not establish release availability or change the GitHub issue state.

## Main findings

### Additional closure candidates from the new behavior

| Issue | Resolved scope | Qualification |
| --- | --- | --- |
| [924](https://github.com/leeoniya/uPlot/issues/924) | `setScale('x', {min: null, max: null})` resets the reported configuration, including its automatic named Y scale. | This is not universally equivalent to double-click reset. An `auto` callback that requires `viaAutoScaleX` behaves differently. |
| [883](https://github.com/leeoniya/uPlot/issues/883) | Mode-2 ranging includes every matching X/Y facet, not only the first two facets. | This resolves the ranging requirement. Arbitrary-facet rendering and cursor behavior remain application responsibilities. |
| [878](https://github.com/leeoniya/uPlot/issues/878) | Explicit X zoom works with a static X range, including synchronized mouse zoom. | Static Y reset is now fixed too. The broader streaming application remains unverified. |

Issues 924 and 883 are the strongest additional closure candidates.
Issue 878 needs a closure statement limited to its original static-X zoom defect, or a separate issue for the remaining requirements.

### Additional partial benefits

- **678:** `uPlot.scan()` provides raw aggregate extrema for a scale. It does not provide stored scale extrema, averages, or sums.
- **725:** the helper can refresh data-derived zoom limits. It does not repair the wheel plugin's stale limits automatically.
- **634:** a custom scanner can range transformed data. It does not add the requested general path-builder transform API.

The assessment of **650** remains partial: scanning plus a ranger is not a general reset-equivalent calculation.
Singleton X expansion now occurs in the default X ranger, so that former counterexample is resolved.
Custom scan policies, dependent scales, and simulated layout remain outside the helper/ranger composition.

Issue **1133** is closed. Automatic backend ranging already worked, and `scan: false` removes unnecessary Y extrema scans.

The current public API also exposes `u.setRange(scaleKey, min, max)` for concrete bounds.
It bypasses `scale.range()`. Null or partial calculation requests still use `u.setScale()`.

### Existing solutions, not new scan fixes

- **620:** equal custom ranges no longer hang in the reproduced cases. This does not guarantee useful zero-span geometry.
- **1008:** functional `scale.asinh` thresholds already exist and update after data changes.
- **648 and 655:** the original ranging defects were already resolved before the scan changes. Both GitHub issues are now closed.
- **568, 783, 786, 833, and 1057:** existing APIs or answers cover the reported support questions.

These are separate closure candidates. They must not appear as fixes caused by `scale.scan`.

## Important remaining gaps

### Built-in drag constraints and programmatic bounds: issue 691

Concrete public bounds still bypass `scale.range()` on both axes.
Built-in drag zoom now calls `cursor.drag.setRange` before it applies each independent scale.
The callback receives ordered bounds, can return an adjusted `[min, max]` tuple, or can return `null` to reject one scale change.
This technically addresses issue 691 for built-in X and Y drag zoom. The GitHub issue remains open.

Programmatic `setRange()` and `setScale()` calls do not call the drag callback.
Wheel and pan plugins must apply constraints before they call `setRange()`.
A separate global hook is necessary only if all concrete setters must share one policy.

### Reset semantics: issues 915, 924, and 878

Issue 915 is fixed in source and generated bundles, and the GitHub issue is closed.
Fully concrete range arrays default to `scan: false` and retain the normal `auto: true` default.
Double-click restores a manually zoomed static Y range without a Y scan.
Default X-only zoom, `setData()`, and `redraw()` also restore static Y. Concrete X/Y batches preserve both explicit ranges.
Explicit `auto` and `scan` configuration remains effective.

The optional callback preserves manual Y during explicit X changes, default redraw, and public null/null X reset:

```js
y: {
	range: [1, 10],
	auto: (u, viaAutoScaleX) => viaAutoScaleX,
}
```

Double-click and automatic `setData()` restore static Y without a Y scan.
`test/scale-static-range.mjs` covers these cases in both modes.

An explicit null/null X reset does not set `viaAutoScaleX`.
With `y.auto: (u, viaAutoScaleX) => viaAutoScaleX`, that reset preserves manual Y bounds.
Double-click instead recalculates Y. This distinction occurs in both data modes.

Thus, issue 924's reported `auto: true` configuration works, but a universal programmatic double-click equivalent remains absent.

### Named mode-2 scale invalidation: issue 1107

Changing a non-default Y facet scale updates its bounds and coordinate conversions, but can retain the old series path.
The invalidation branch in `src/uPlot.js` still checks `changed.y`, rather than the series' Y facet scale key.

A probe with `y2` changing from `[0, 10]` to `[0, 20]` records zero path rebuilds.
The cached path object remains identical. This defect occurs before and after the scan changes.
Tests that inspect only scale bounds can miss this rendering defect.

### Data limits versus view limits: issues 650, 678, and 725

The wheel demo captures full-domain bounds once in its `ready` hook.
After data changes, its clamp limits remain stale.
The [issue 725 workaround](https://github.com/leeoniya/uPlot/issues/725#issuecomment-1196518662) reads bounds in `setData`, before scale recalculation.

A targeted probe extends X from `[0, 2]` to `[0, 4]`:

| Observation | Bounds |
| --- | --- |
| `setData` hook reads current X bounds | `[0, 2]` |
| Committed X bounds after the update | `[0, 4]` |
| Pure `uPlot.scan(u, 'x')` after the update | `[0, 4]` |

A plugin needs an explicit policy for data limits, padded limits, and current view limits.
It also needs to refresh those limits after relevant data or visibility changes.
The alternative plugin in the discussion permits zoom from current bounds without the original full-domain clamp.

Pure `uPlot.scan()` provides fresh raw extrema for participating data.
It does not call the configured scan callback or calculate every dependent-scale and layout consequence.
With `cache: true`, existing extrema remain authoritative, regardless of requested indices.
That cache mode is not suitable for a guaranteed fresh full-domain query.

### Layout and numeric domains remain separate concerns

Issues 790 and 864 require coordination between ranges, ticks, and layout.
The ordered layout refactor does not make scale calculation depend on final tick layout.
Issues 713 and 944 still require tick-spacing or label-padding policies.

Issue 944 has an accepted padding-callback workaround.
The current `axis-autosize.html` demo also removes position feedback from its padding calculation.
It does not provide automatic per-edge label alignment or prove the original CodeSandbox's pixel output.

Invalid logarithmic domains remain unsafe.
The reported log10 zero-minimum case no longer hangs, but can still produce invalid transforms.
A log2 zero-minimum probe and a non-finite-bound probe still fail to terminate within bounded runs.
These results do not establish the cause of every historical wheel-zoom hang.

### Declaration, bundles, and release status

`dist/uPlot.d.ts` now includes `Scale.scan`, static `uPlot.scan`, public `setRange()`, `Cursor.DragSetRange`, and the corrected `auto` description.
Historical validation reported that the TypeScript consumer passed with `skipLibCheck` and that the full declaration check retained the preexisting `DateZoned` issue.
These TypeScript checks were not repeated because this checkout does not have `tsc` installed.

Source, declarations, and generated CJS, ESM, IIFE, and minified bundles contain the static-range and drag-refinement changes.
The current working-tree bundles also contain public `setRange()`.
These changes are not published to npm. The latest npm release remains `1.6.32`.
Issue 1136 remains open with GitHub state reason `reopened`.

## Complete inventory

Technical status meanings:

- **New:** the new behavior resolves the stated scope.
- **Existing:** an older fix, configuration, or answer covers the stated scope.
- **Partial:** part of the request works, but the whole issue does not qualify for closure as implemented.
- **Open:** the requested behavior or defect remains.
- **Needs repro:** available evidence does not establish the original result.
- **Release:** completion depends on publication, not only implementation.

These labels are technical assessments, not GitHub states.
In this 65-issue inventory, issues 648, 655, 915, and 1133 are closed with reason `completed`.
The other 61 inventory issues remain open. Issues 734, 786, 924, and 1136 have state reason `reopened`.
Issues 808 and 823 are also closed with reason `completed`, but they are outside this inventory.

Descriptions summarize the reports. They are not exact issue titles.

| Issue | Area / use case | Technical status | Assessment |
| --- | --- | --- | --- |
| [62](https://github.com/leeoniya/uPlot/issues/62) | Incremental data append | Open | No incremental `addData()` or path-append API. |
| [107](https://github.com/leeoniya/uPlot/issues/107) | Scatter plots | Partial | Mode 2 supports independent XY data. Custom rendering and spatial lookup remain application concerns. |
| [119](https://github.com/leeoniya/uPlot/issues/119) | Weekend interval highlights | Partial | Drawing and coordinate APIs exist. No ready-made efficient weekend-interval plugin. |
| [184](https://github.com/leeoniya/uPlot/issues/184) | Generic non-line patterns | Partial | Grouped-bar patterns exist, but no general composite-point abstraction. |
| [318](https://github.com/leeoniya/uPlot/issues/318) | Configuration-driven pan mode | Open | Panning still needs plugin code. |
| [340](https://github.com/leeoniya/uPlot/issues/340) | Hide X after all Y series become hidden | Open | X range, ticks, and grid remain active. |
| [351](https://github.com/leeoniya/uPlot/issues/351) | Cull offscreen Y series | Open | No whole-series culling based on Y extrema. Paths and drawing hooks still run. |
| [393](https://github.com/leeoniya/uPlot/issues/393) | Arbitrary logarithmic bases | Open | Public support remains bases 10 and 2. |
| [463](https://github.com/leeoniya/uPlot/issues/463) | Unordered connected XY data | Partial | Mode 2 helps, but default dense linear decimation retains ordered-X assumptions. |
| [482](https://github.com/leeoniya/uPlot/issues/482) | Singleton box plot | Open | A singleton probe with the boxes plugin reads a missing next entry and throws. The external JSBin was not replayed exactly. |
| [489](https://github.com/leeoniya/uPlot/issues/489) | Mixed stacked bars and lines | Open | Stacking and band omission still need separate policies. This is not the fixed boundary-stroke clipping case from issue 808. |
| [510](https://github.com/leeoniya/uPlot/issues/510) | Automatic shared Y sync scale | Open | No automatic selection of the first shared Y scale. |
| [555](https://github.com/leeoniya/uPlot/issues/555) | Ordinal X callback bounds | Existing | Ordinal bounds are indices by design. Calendar ticks need custom splits and values. No new range fix. |
| [568](https://github.com/leeoniya/uPlot/issues/568) | Moving Y annotation | Existing | `setCursor` and `posToVal` cover the support question. |
| [601](https://github.com/leeoniya/uPlot/issues/601) | Dashed legend markers | Partial | CSS patterns work. Arbitrary dash arrays and automatic stroke matching remain absent. |
| [610](https://github.com/leeoniya/uPlot/issues/610) | Highlight individual axis ticks | Partial | Custom highlighting is possible. Per-tick font control remains absent. |
| [620](https://github.com/leeoniya/uPlot/issues/620) | Equal-range browser hang | Existing | Reproduced `[1, 1]` and `[2, 2]` custom ranges terminate before and after scan changes. |
| [634](https://github.com/leeoniya/uPlot/issues/634) | Path-builder Y transforms | Partial | Bars support `disp.y0/y1`. Custom scans help extrema, not general path transforms. |
| [640](https://github.com/leeoniya/uPlot/issues/640) | Empty-window nice-scale hang | Needs repro | Historical demo is removed. A reconstructed empty-window case terminates, but original bounds are unavailable. |
| [648](https://github.com/leeoniya/uPlot/issues/648) | Auto reset versus explicit zoom | Existing | The original drag configuration passes before and after the scan changes. |
| [650](https://github.com/leeoniya/uPlot/issues/650) | Extents without view reset | Partial | Pure extrema queries work. Complete reset-equivalent candidate calculation remains unsupported. |
| [655](https://github.com/leeoniya/uPlot/issues/655) | Fixed initial Y bounds and X zoom | Existing | Concrete Y bounds with `auto: false` already survive zoom and data replacement. |
| [678](https://github.com/leeoniya/uPlot/issues/678) | Scale extrema and series statistics | Partial | New aggregate scan covers raw extrema. Stored extrema, sums, and averages remain separate requirements. |
| [691](https://github.com/leeoniya/uPlot/issues/691) | Reject excessive zoom | New / partial | `cursor.drag.setRange` can adjust or reject built-in X and Y drag bounds. Programmatic wheel and pan code must constrain bounds before `setRange()`. |
| [707](https://github.com/leeoniya/uPlot/issues/707) | Shared tooltip | Partial | Cursor synchronization exists. Cross-chart tooltip aggregation remains custom. |
| [708](https://github.com/leeoniya/uPlot/issues/708) | Custom statistical legend | Partial | Legend APIs exist. Scale scans do not supply per-series statistics or a complete legend UI. |
| [713](https://github.com/leeoniya/uPlot/issues/713) | Tick label collisions | Open | Default tick selection does not measure label widths for collision avoidance. |
| [715](https://github.com/leeoniya/uPlot/issues/715) | Mode-2 default cursor sync keys | Open | Default Y key selection still assumes `series[1].scale`, rather than its facet scale. |
| [725](https://github.com/leeoniya/uPlot/issues/725) | Wheel limits after data append | Partial | New scans can supply fresh data limits. The demo still caches initial bounds, and the proposed hook reads old bounds. |
| [734](https://github.com/leeoniya/uPlot/issues/734) | CSS-transformed pointer coordinates | Open | Scale scanning does not correct pointer coordinates under CSS transforms. The previous offset fix was reverted. |
| [751](https://github.com/leeoniya/uPlot/issues/751) | Gradient boundaries after zoom | Needs repro | Timestamp color-stop data and custom gradient construction are missing. Native-browser validation is necessary. |
| [769](https://github.com/leeoniya/uPlot/issues/769) | Logarithmic soft bounds | Open | Numeric range configuration can produce zero bounds and invalid log geometry. The original CodePen was not replayed exactly. |
| [775](https://github.com/leeoniya/uPlot/issues/775) | Very small axis values | Partial | Earlier precision fixes preserve distinct coordinates. Default labels can still become `0`. Original screenshot data is missing. |
| [781](https://github.com/leeoniya/uPlot/issues/781) | CSS-transform selection sizing | Open | No implementation of the requested transform-based selection sizing. |
| [783](https://github.com/leeoniya/uPlot/issues/783) | Rotated box plots | Existing | The reporter accepted the orientation-based solution. The stock demo remains vertical. |
| [786](https://github.com/leeoniya/uPlot/issues/786) | Integer Y ticks | Existing | The reporter accepted integer `axis.incrs`. This does not add native ordinal Y. |
| [790](https://github.com/leeoniya/uPlot/issues/790) | Range/tick dependency order | Open | Scales still settle before axis splits. |
| [813](https://github.com/leeoniya/uPlot/issues/813) | Log scale with zero minimum | Partial | Posted log10 configuration terminates but yields invalid transforms. A log2 zero-minimum case still hangs. |
| [832](https://github.com/leeoniya/uPlot/issues/832) | Preserve zoom while changing series | Partial | Existing `setData(data, false)` plus `redraw(false)` preserves zoom and draws. `setData` alone does not draw. |
| [833](https://github.com/leeoniya/uPlot/issues/833) | Enumeration Y axis | Existing | Fixed splits and values, padded numeric bounds, and stepped paths cover the example. Native categorical Y remains absent. |
| [849](https://github.com/leeoniya/uPlot/issues/849) | Wheel-triggered log splitter hang | Needs repro | Original bounds and event sequence are missing. A non-finite-bound hang remains, but is not proof of the original cause. |
| [864](https://github.com/leeoniya/uPlot/issues/864) | Align independent Y grids | Open | Automatic tick alignment and layout-dependent ranging remain absent. |
| [878](https://github.com/leeoniya/uPlot/issues/878) | Zoom static X range | New / partial | Original synchronized X zoom works, and static Y reset is now fixed. The broader streaming application remains unverified. |
| [883](https://github.com/leeoniya/uPlot/issues/883) | Multiple X/Y facets for ranging | New | Scanner includes every matching facet. Rendering and cursor support for arbitrary extra facets are separate. |
| [894](https://github.com/leeoniya/uPlot/issues/894) | Native ordinal Y scales | Open | Not implemented. |
| [915](https://github.com/leeoniya/uPlot/issues/915) | Static Y double-click reset | New | Default static Y now resets after XY drag and double-click. Both modes have regression coverage. |
| [922](https://github.com/leeoniya/uPlot/issues/922) | Separate interaction canvas | Partial | Application overlays are possible. A separate core interaction canvas is not implemented. |
| [924](https://github.com/leeoniya/uPlot/issues/924) | Programmatic scale reset | New | X null/null reset fixes the reported automatic-Y configuration. Reset-sensitive `auto` callbacks remain a limitation. |
| [926](https://github.com/leeoniya/uPlot/issues/926) | Rotate non-bottom tick labels | Open | Rotation remains restricted to the bottom axis. |
| [928](https://github.com/leeoniya/uPlot/issues/928) | Justified categorical scale | Open | No distributed-category scale API. |
| [933](https://github.com/leeoniya/uPlot/issues/933) | Binary linear ranges and ticks | Open | No built-in binary linear tick/range policy. |
| [944](https://github.com/leeoniya/uPlot/issues/944) | Edge label clipping | Partial | Padding callbacks and the autosize demo cover a workaround. Automatic per-edge alignment remains absent. Not a scan fix. |
| [954](https://github.com/leeoniya/uPlot/issues/954) | Keyboard accessibility | Open | No complete keyboard focus/navigation implementation. |
| [978](https://github.com/leeoniya/uPlot/issues/978) | Sparse unaligned points | Partial | Join, mode 2, and overlays offer alternatives. Sparse storage with standard interactions remains unsupported as requested. |
| [1008](https://github.com/leeoniya/uPlot/issues/1008) | Functional asinh threshold | Existing | Adaptive callbacks already update thresholds, transforms, ticks, and paths. |
| [1057](https://github.com/leeoniya/uPlot/issues/1057) | Columnar data rationale | Existing | Answered design question, not an implementation defect. |
| [1063](https://github.com/leeoniya/uPlot/issues/1063) | `setScale` followed by `redraw` | Open | Immediate default `redraw()` can replace pending X bounds with committed bounds. Omitting that redraw avoids the conflict. |
| [1079](https://github.com/leeoniya/uPlot/issues/1079) | Grouped-bars plugin | Needs repro | Supplied data draws with explicit styles. The unavailable TypeScript port and package request need separate assessment. |
| [1105](https://github.com/leeoniya/uPlot/issues/1105) | Fast transient pan/zoom | Open | No transform-only interaction API. |
| [1107](https://github.com/leeoniya/uPlot/issues/1107) | Named mode-2 Y scale changes | Open | Bounds change but paths can stay cached because invalidation checks `changed.y`. |
| [1113](https://github.com/leeoniya/uPlot/issues/1113) | Nearest Y among equal X values | Partial | `cursor.dataIdx` permits a workaround. Default equal-X nearest-Y search remains absent. |
| [1116](https://github.com/leeoniya/uPlot/issues/1116) | Nice-scale resize feedback | Open | A historical-demo replay produces invalid bounds and repeated rescaling. Exact reported dimensions are unavailable. |
| [1124](https://github.com/leeoniya/uPlot/issues/1124) | Zero-copy data API | Partial | Typed-array identity works. Arrow accessors and NaN-gap parity remain separate requirements. |
| [1133](https://github.com/leeoniya/uPlot/issues/1133) | Dynamic backend ranges | New benefit | Default auto scheduling already works. `scan: false` avoids the redundant Y scan for all three demo update scenarios. |
| [1136](https://github.com/leeoniya/uPlot/issues/1136) | New release | Release | npm remains at `1.6.32`. The issue is open with state reason `reopened`. |

## Reproduction evidence

### Issue 924

The probe uses the linked fiddle's scale, axis, drag, and data configuration.
Its X data is `[0, 1, 2]`, and its named Y series is `[2, 3, 5]`.
After explicit XY zoom, the probe requests null/null X bounds.

| Version | X after reset | Named Y after reset |
| --- | --- | --- |
| `7074d27` | `[0.25, 1.75]` | `[0, 6]` |
| Current source | `[0, 2]` | `[1.7, 5.3]` |

A separate probe uses `auto: (u, viaAutoScaleX) => viaAutoScaleX` in modes 1 and 2.
The null/null X call preserves manual Y `[2.5, 4]`. Double-click restores Y `[1.7, 5.3]`.

### Issue 878

Two charts use static X `[0, 5]`, static Y `[-2, 4]`, and synchronized X mouse selection.
The probe retains the reported drag and sync configuration, with deterministic reduced data.

In the historical baseline, both charts remain at X `[0, 5]` after a drag.
Current source changes both charts to X `[1, 3]`.

The earlier XY zoom/reset probe exposed a static-Y defect: double-click restored X but left Y zoomed.
The later static-range fix resolves that reset defect, with regression coverage in both modes.
The expanded streaming application from the later discussion remains unverified.

### Issue 883

A requirement-derived mode-2 probe uses four columns: `[xMin, yMin, xMax, yMax]`.
Their scale keys are `['x', 'y', 'x', 'y']`.
Identity rangers remove padding, and disabled paths isolate the ranging behavior.

| Operation | Bounds `[xMin, xMax, yMin, yMax]` |
| --- | --- |
| Historical baseline initial range | `[1, 3, 10, 30]` |
| Current initial range | `[1, 9, 10, 90]` |
| Hide second series | `[1, 8, 10, 80]` |
| Show second series | `[1, 9, 10, 90]` |
| Replace data with larger extra facets | `[1, 90, 10, 900]` |
| Explicit X zoom | `[2, 4, 10, 900]` |
| Null/null X reset | `[1, 90, 10, 900]` |

Direct pure scans also return the initial X/Y extrema without changing facet caches.
Only the initial case was compared against the baseline for this issue.

## Validation and limits

The original audit used source inspection, issue discussions, existing tests, and temporary in-memory reproductions.
Current validation produced these results:

- Full `npm test`: **1,011 passing**.
- Focused five-file static-range, range-policy, issue, HTML demo, and asinh run: **74 passing**.
- [Static-range tests](../../test/scale-static-range.mjs): **34 passing** across both modes, included in the focused total.
- Cursor-drag plus range-policy tests: **50 passing**.
- Historical TypeScript consumer with `skipLibCheck`: passed.
- Historical full declaration check: the preexisting `DateZoned` issue remained.
- Current TypeScript checks: not repeated because this checkout does not have `tsc` installed.

The static-range tests cover default resets, concrete X/Y batches, `auto` overrides, scan overrides, and partial Y arrays.
Existing asinh tests retain the static default threshold of `1`.
The listed Node tests were run against the current working tree.
Current generated JavaScript contains the reviewed runtime changes.

Additional earlier audit runs covered cursor dragging, layout, precision, and the issue-specific probes described here.
Those suite counts overlap and are not a combined total.

The probes use `scripts/instrument.mjs` with DOM/canvas mocks.
They establish state changes, event behavior, recorded geometry, and path-cache behavior, not native-browser pixels.
Numeric hang probes used bounded runs.
External reproductions that were unavailable or incomplete remain qualified in the inventory.
The broader issue-specific probes are not all persistent regression tests. Static-range reset cases now have dedicated regression coverage.

## Recommended follow-up

1. Add persistent regressions for issues 924, 883, and the original scope of 878.
2. Publish the rebuilt artifacts when the release is ready, and resolve the preexisting `DateZoned` declaration issue.
3. Fix named mode-2 path invalidation for issue 1107.
4. Define the relationship between public resets and `viaAutoScaleX` for issue 924.
5. Add an issue-specific minimum-span regression for issue 691. Generic drag-callback coverage already exists.
6. Add a global concrete-bound hook only if programmatic setters need the same policy as built-in drag.
7. Define data-limit refresh behavior for wheel and pan plugins without claiming a general solution to issue 650.
8. Review older closure candidates separately from the scan release notes.
