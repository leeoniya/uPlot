# Replacing Grafana bar-chart mechanics with the uPlot plugin

## Conclusion

The main opportunity is to remove a custom bar renderer from Grafana, not to replace its entire panel or visualization framework.

Native uPlot stacking replaces cumulative-data preparation and baseline bookkeeping. The plugin replaces category layout and rectangle hit testing.
Grafana retains field policy, formatting, colors, axes, tooltip content, and dashboard integration.

The current plugin is not a feature-equivalent replacement. The source comparison supports less Grafana-owned code, but does not yet demonstrate fewer shipped bytes.

This assessment uses Grafana commit `891f7973f81c6e4e0a24bed3120cca3b3cc93ebc` and the current local plugin and core.
The earlier [panel bundle report](grafana-bar-chart-size.md) answers a different question: total size within selected dependency boundaries.

## Measured replacement candidates

Bun 1.4.3 compiled each scope separately with browser ESM output, full minification, and production `NODE_ENV`.
No dependencies were installed. Sizes are bytes.

| Scope | Minified | gzip 9 | Brotli 11 |
| --- | ---: | ---: | ---: |
| Grafana `bars.ts` + `quadtree.ts` + `distribute.ts` | 7,091 | 3,454 | 3,162 |
| Isolated shared stacking helpers | 2,531 | 1,249 | 1,121 |
| Combined Grafana bars and stacking helpers | **9,618** | **4,510** | **4,125** |
| Current plugin and helpers, including control API | **14,617** | **6,470** | **5,843** |

The combined row is an actual bundle, not the sum of compressed module sizes.
The stacking slice exports `getStackingBands`, `getStackingGroups`, and `preparePlotData2`, with their local dependencies.
It excludes unrelated midpoint calculations, legend calculations, and logging initialization.

This boundary excludes external framework code, including `measureText`, `colorManipulator`, and `buildScaleKey` implementations.
It also excludes the panel, `prepConfig`, shared configuration builders, and all uPlot core code.
Some excluded layout glue becomes unnecessary with the plugin, but this experiment does not measure that change.

The current plugin exceeds this isolated legacy scope by **4,999 minified bytes**, or **1,960 gzip bytes**.
This difference is not an integrated migration result: the feature sets and dependency boundaries differ.
A production plugin also needs parity extensions and a Grafana adapter.

The current plugin includes label measurement, validation, multiple stack-group layout, stack totals, contrast selection, and control setters.
Grafana delegates some corresponding work to external shared utilities and implements different label policies.

The earlier initialization-only plugin measurement was 13,898 minified bytes with Rollup/Terser, not Bun.
Removing only the control API does not establish a bundle-size saving against this narrower Grafana scope.

## Source ownership

Physical source lines include whitespace, comments, and TypeScript declarations. They are not executable-line or complexity metrics.

| Source | Lines | Interpretation |
| --- | ---: | --- |
| Grafana `bars.ts` | 671 | Renderer, category layout, labels, hover, colors, and stack adapter |
| Grafana `quadtree.ts` | 148 | Spatial index and rectangle helpers |
| Grafana `distribute.ts` | 47 | Distribution helper |
| **Local renderer total** | **866** | Candidate for replacement after feature integration |
| Isolated shared stacking slice | 320 | Includes imports and types; not entirely removable policy |
| Grafana bar-chart `utils.ts` | 559 | Some glue disappears; substantial field and axis policy remains |
| Plugin + hover + values + distribution | 1,024 | Replacement implementation, including control machinery |

The opportunity is roughly 866 local renderer lines plus portions of configuration and shared stack mechanics.
It is not a claim that all these lines disappear immediately or that total implementation size decreases by the same amount.

Shared stacking helpers remain necessary for other Grafana panels until those panels migrate too.
Removing one bar-chart dependency does not remove the helper from every production bundle.

## Responsibility map

### 1. Native stacking: remove the cumulative-data pipeline

Grafana currently:

- Determines stack groups with field configuration and a sampled sign classification.
- Allocates cumulative arrays and records where each group has any values.
- Generates bands between adjacent series.
- Performs a second pass for percent normalization.
- Maps stack totals back to series for value labels.
- Passes stacking groups through `UPlotConfigBuilder` and its preparation callback.

Relevant Grafana source:

- [Shared stack helpers, lines 52–292](https://github.com/grafana/grafana/blob/891f7973f81c6e4e0a24bed3120cca3b3cc93ebc/packages/grafana-ui/src/components/uPlot/utils.ts#L52-L292)
- [Sign classification, lines 350–403](https://github.com/grafana/grafana/blob/891f7973f81c6e4e0a24bed3120cca3b3cc93ebc/packages/grafana-ui/src/components/uPlot/utils.ts#L350-L403)
- [Bar label totals adapter, lines 646–653](https://github.com/grafana/grafana/blob/891f7973f81c6e4e0a24bed3120cca3b3cc93ebc/public/app/plugins/panel/barchart/bars.ts#L646-L653)

Current [uPlot core](../../src/uPlot.js) accepts raw values with `stack.groups` and `stack.percent`.
For bars, `dir: 0` gives each point separate positive and negative baselines.
Core recomputes the derived arrays after data or visibility changes. Grafana no longer needs to stack the values before it calls `setData()`.

`u.data` remains raw. Internal `_data` and `_base` supply endpoints and baselines to the renderer.
The plugin label helper already uses this distinction, so the old `alignedTotals` callback is unnecessary for its labels.

**Policy that remains:** Grafana must map compatible fields to groups, preserve field-to-series indices, and apply field transforms.
Core does not understand Grafana units, field overrides, `NegativeY`, `Constant`, or invalid-number cleanup.
Percent axis formatting also remains application policy.

**Behavior changes:** the old sign heuristic classifies a series; native bar stacking classifies each value.
Native stacks preserve null values rather than substituting an accumulated value at those positions.
Percent stacks normalize positive and negative totals independently. These changes need regression coverage, not an assumption of identical output.

### 2. Quadtree: replace the data structure, not hover semantics

Grafana inserts each rendered rectangle into a quadtree. A cursor query finds rectangles at the pointer.
For multi-series hover, `findRects()` recursively searches the tree for rectangles with the same category index.

The [plugin hover helper](../../demos/lib/barHover.js) exploits uniform category spacing:

1. Calculate the nearest category directly.
2. Examine that category's series rectangles for exact bar containment.
3. Examine the adjacent category if a shared edge requires it.

Category selection takes constant time. Exact bar selection examines up to two categories, with work proportional to the series count.
The helper stores four `Float64` coordinates per category and series instead of tree nodes and rectangle objects.
Its rectangle storage therefore needs approximately `32 × categories × series` bytes, excluding other state.

This replaces the quadtree, its insertion/query lifecycle, and category-wide recursive searches.
It does not prove faster performance for every series count or dataset.
Both implementations still invalidate bar paths on redraw to refresh the geometry collected through `each()`.

**Compatibility work:** Grafana multi-hover starts from a rectangle hit and highlights matching rectangles.
Plugin group-hover selects the nearest category, including gaps, and draws a category band.
Grafana `fullHighlight` expands an individual unstacked series rectangle across the value dimension, not the whole category.
These are separate policies that need explicit mappings.

Grafana also supplies a rectangle-based `cursor.focus.dist` callback.
`TooltipPlugin2` uses series-focus and legend hooks to track the selected series and indices.
The plugin needs a compatible focus/event bridge, not only a matching `cursor.dataIdx` return value.

### 3. Bar layout: replace the local machinery

The plugin takes over these responsibilities from `bars.ts`:

- One-level versus two-level distribution
- Percentage offsets and widths for each series
- Category scale expansion and tick positions
- Horizontal and vertical orientation
- Bar path configuration and geometry collection
- Label spacing and category truncation

It also replaces the manual rotation-padding calculation in Grafana's `utils.ts`, subject to axis compatibility.
The plugin's distribution helper becomes the common implementation instead of Grafana's private copy.

The existing width policy still needs translation. Grafana swaps group/bar width for stacks and applies a special case for a single numeric field.
The plugin's public fractions do not automatically reproduce that policy.

### 4. Labels and colors: retain policy, expose extension points

The plugin handles value-label geometry, but its current behavior differs from Grafana:

- Grafana supports `Never`, `Auto`, and `Always`; the plugin accepts a boolean.
- Grafana uses display processors and the theme font; the plugin uses English compact formatting and Arial.
- Grafana has its own collision and placement policy; the plugin uses fit checks, inside stack labels, and stack totals.
- Plugin contrast calculation assumes a white plot background.

Grafana's `bars.ts` also supplies per-bar fill/stroke arrays for color fields, thresholds, and value mappings.
Core supports those arrays, but the plugin currently rejects `bars.disp` and supplies its own display configuration.

Small extension points can preserve these policies without another renderer:

- Allow per-bar fill/stroke channels while reserving layout channels for the plugin.
- Accept value formatters, theme text styles, visibility policy, and a totals toggle.
- Expose or compose geometry callbacks for an external label renderer.
- Preserve explicit hover selection, focus, and notification policies.

These are proposed changes, not existing APIs or measured additions.

### 5. Keep the Grafana adapter and surrounding UI

These responsibilities do not disappear:

- Frame alignment, field selection, hidden-field handling, and validation
- Display processors, palette assignment, color mappings, and thresholds
- Multiple scales, field overrides, axis labels, units, and range policy
- Automatic time-label formatting
- React lifecycle, panel sizing, and orientation selection
- Tooltip content, legends, links, actions, filtering, and assistant integration

The plugin hardcodes the primary `x`/`y` scales and axis positions in its configuration.
Core supports multiple scales, but the plugin does not replace Grafana's multi-axis policy.
The integration must preserve named scales and configure their orientation and sizing.

The current plugin also requires every value series to belong to a stack group once stacking is enabled.
Stack membership is initialization-time configuration, and core disables `addSeries()`/`delSeries()` while stack groups exist.
Changing the field set or stack configuration requires chart recreation or additional API work.

## Suggested migration order

1. Add a native-stack path to the Grafana builder while preserving its existing axis and series policy.
2. Replace bar data preparation with raw aligned columns and compatible stack groups.
3. Adapt the plugin's colors, label policy, axis composition, and hover/focus integration.
4. Replace `bars.ts`, distribution, and quadtree usage on the bar-chart path.
5. Compare the integrated old/new bundles with identical dependencies and feature coverage.

Native stacking can migrate independently of the full plugin. This separates core arithmetic changes from hover, layout, and label changes.

The intended architecture is **Grafana field policy → thin chart adapter → shared bar plugin + native uPlot stacking**.
That removes rendering algorithms from the panel without reimplementing the Grafana framework inside the plugin.

## Reproduction and validation

- [Measurement script](grafana-bar-chart-replacement.mjs)
- [Sizes, source counts, and external imports](grafana-bar-chart-replacement-results.json)

The input directory contains these files from the pinned Grafana revision:

| Local input name | Grafana source path |
| --- | --- |
| `bars.ts` | `public/app/plugins/panel/barchart/bars.ts` |
| `quadtree.ts` | `public/app/plugins/panel/barchart/quadtree.ts` |
| `distribute.ts` | `public/app/plugins/panel/barchart/distribute.ts` |
| `utils.ts` | `public/app/plugins/panel/barchart/utils.ts` |
| `uplot-utils.ts` | `packages/grafana-ui/src/components/uPlot/utils.ts` |

The script accepts the input directory, output directory, and uPlot root as positional arguments.
It extracts original stacking declarations at pinned line ranges and verifies the expected function names.
It redirects the legacy bar module's stacking import to that slice only for the combined measurement.
All other unavailable dependencies remain external.

Validation included successful sequential Bun builds, output parsing, and Terser syntax/scope analysis of the generated bundles.
Only expected JavaScript and browser globals remained. Terser did not produce the measured bytes.

No Grafana migration, browser test, or performance benchmark forms part of this assessment.
Local stacking and plugin tests supplied evidence through source inspection only; they were not run.
Downloaded sources and generated bundles were temporary. The report, script, and JSON results remain in this repository.
