# Replacing disp with core capabilities

## Status, scope, and conclusion

This is a source-based investigation, not an API implementation or an approved replacement design.
Breaking changes are in scope for the design discussion.
The goal is to remove duplicated responsibilities, not merely rename `disp`.

**The current uses do not establish a need for one mixed-purpose `disp` API.**
They establish needs for data bindings, category layout, interval geometry, visual mappings, and geometry-aware interaction.
Native stacking already removes one original motivation.
It does not replace floating endpoints, grouped placement, colors, sizes, or hit testing.
Floating endpoint callbacks are not a blocker to retiring `disp`.
Their replacement is deferred to an explicit data-reference API for floating bars and related compound marks.

The largest missing foundation is a way to describe what each data column means to a mark.
Those bindings must participate in scale scanning, projection, invalidation, and selection before the pathbuilder runs.
A late renderer callback cannot reliably own all those operations.

This review extends the [unit and cache investigation](disp-semantics-plan.md).
That document describes cleanup within `disp`; this document questions the need for that API itself.
The [band-scale plan](band-scale-plan.md) remains a useful layout proposal, not a prerequisite specification.

### Inspected revisions

- uPlot: local checkpoint `40ecc14b506c1253f09edab20353b13c4392cd00`.
- Grafana: existing checkout at `/home/leeoniya/Downloads/grafana`.
- Grafana revision: `d0af4adcee29c8d2022eab47582aa56bebd5ce75`, dated September 25, 2026, with message `post-merge fix`.
- The Grafana tracked working tree was clean during inspection. Untracked local work was not modified.

This Grafana revision is not asserted to equal upstream main.
It differs from the October 10 snapshot in the earlier [Grafana replacement report](grafana-bar-chart-replacement.md).
Grafana declares uPlot `1.6.32`; that dependency is not equivalent to the local development checkpoint.

The review used source inspection, Git history, and the linked historical issue discussion.
No dependencies were installed. No builds, tests, benchmarks, or browser sessions were run for this review.

## 1. What history establishes

Dates below use commit author dates. Recent local commits are identified by hash without an assumption of public availability.

| Date | Commit | Finding |
| --- | --- | --- |
| July 13, 2021 | `0f3cbd4a` | Added `layout(seriesIdx) -> {offs, size}` and `each()`. The multi-bars demo retained external distribution and quadtree lookup while adopting native bar drawing. |
| July 15, 2021 | `fec7e0c9` | Replaced `layout` with `disp.x0` and `disp.size`, using scale values or plot fractions. Added Unary/Discrete/Continuous type metadata. |
| July 17, 2021 | `aecc3c4c`, `b7ba6535` | Made `each()` report absolute canvas bounds. The follow-up converted those bounds back to plot-relative coordinates in the demo index. |
| November 8, 2021 | `050a0624` | Added per-bar fill/stroke arrays and color-grouped paths. |
| November 30, 2021 | `7ebdb1e4`, `40fdfa17` | Allowed color descriptors without X-layout descriptors. X position and width remained a pair. |
| January 1, 2022 | `6d266593` | Added paired Y endpoints and a floating-bar sparkline demo. |
| December 11, 2023 | `dd72d5b9` | Replaced bar band-clipping geometry with explicit baseline-to-value rectangles. |
| September 21, 2026 | `e16c3651` | Added native stacking, raw-data preservation, and native bar baselines. |
| October 14, 2026 | `40ecc14b` | Added operational kinds, tuple-valued discrete descriptors, display caching, native variable point styling, and unary bar widths. |

### Why Y descriptors appeared

[Issue #634](https://github.com/leeoniya/uPlot/issues/634) originally proposed a display Y transform for stacked and shifted data.
The concern was that preprocessing changed `u.data`, so legends and plugins lost convenient access to raw values.

The [December 13 discussion](https://github.com/leeoniya/uPlot/issues/634#issuecomment-992147547) identified the ordering problem: scales must be calculated before paths.
Stacking only inside a renderer happens too late for correct autoscaling.
A [December 31 comment](https://github.com/leeoniya/uPlot/issues/634#issuecomment-1003416165) also proposed floating bars or rectangles.

The implementation commit introduced floating low/high bars, not a stacking engine.
Thus, stacking and raw-data preservation motivated the discussion, while floating bars demonstrated the first implementation.
Native stacking now addresses the former problem at the correct lifecycle stage.
Measured low/high intervals still need their own representation.

### What caching and quantization originally meant

The original layout API explicitly described a caller-owned layout cache getter.
The renderer did not cache `values()` results separately from paths.
A later color demo retained a TODO to prepare colors on data changes rather than every redraw.

Before the checkpoint, `kind` was type metadata rather than runtime behavior.
Exact `Set`/`Map` color grouping was implemented, but it was not quantization.
It neither classified raw values nor reduced continuous values into approximate color bins.
The checkpoint adds dictionary/index representation and caching, not a general classifier or quantizer.

## 2. Current uPlot demo inventory

Executable display contracts occur in seven demo files.
The shared plugins account for additional indirect chart instances.
The unrelated patched ECharts bundle, data files, documentation examples, and commented code are excluded from this count.

| Executable source | Builder and channels | Actual requirement |
| --- | --- | --- |
| `grouped-bars.js` (removed; demos now use `barChartPlugin.js`) | Native bars: fractional `x0`, unary fractional `size`; forwarded caller descriptors | Category distribution and nested series slots |
| [multi-bars.js](../../demos/multi-bars.js), lines 134–265 | Native bars: `fill` and `stroke`, directly and through the grouped plugin | Status code to per-bar color |
| [sparklines-bars.js](../../demos/sparklines-bars.js), lines 87–211 | Native bars: `y0`, `y1`; optional per-bar `fill` | Floating intervals and a derived color rule |
| [latency-heatmap.html](../../demos/latency-heatmap.html), lines 436–650 | Custom heatmap: `fill.lookup` plus palette-index callback | Grid cells and count quantization |
| Same file, lines 754–831 | Native bars: scale-value `x0` and unary `size` | Histogram bin placement and gap centering |
| [scatter.html](../../demos/scatter.html), lines 119–202 | Native points through plugin: scale-backed `size` | Population-to-diameter mapping |
| [scatterPlugin.js](../../demos/lib/scatterPlugin.js), lines 4–32 | Forwards optional descriptors to native points | Reusable point setup, with optional spatial hover |
| [barChartPlugin.js](../../demos/lib/barChartPlugin.js), lines 431–449 | Two native bar builders: fractional positions and scalar widths | Nested visible slots and full-category bars |

The table has eight rows because the latency page has two distinct contracts.
The custom heatmap contract is not the native `[enum, idxs]` contract.

### Grouped bars

The older grouped plugin prepares category offsets and series widths outside core.
It adjusts the ordinal X range to make ticks agree with that independently calculated layout.
Its `each()` callback inserts rectangles into a quadtree.
Value labels reconstruct positions from layout arrays instead of using the final bounds.

The newer bar plugin prepares category bands and visible series or stack slots.
It also supports full-category total/background bars that do not consume an inner slot.
Its `each()` callback feeds both labels and hover.
Its hover helper uses category arithmetic and local rectangle checks, not a spatial tree.

Both plugins force path rebuilds to repopulate external geometry after `drawClear`.
That lifecycle coupling is independent of `disp` and is a good target for core ownership.

Native stacking already supplies Y accumulation in the current stacked demos.
Their remaining descriptors control X placement and width.
A band scale must supply nested slots and stack membership, not only category centers, to remove this layout code.

### Per-bar colors

The build-duration examples bind color to an auxiliary status column, not to Y height:

- Status `0`: green.
- Status `1`: orange.
- Other statuses: red.

Fill and stroke use related palettes with different opacity.
This is categorical classification, not numeric quantization.
The direct native-bar version needs no layout override or spatial index.

### Floating bars

The sparkline derives low/high values around a center and passes them through `y0`/`y1`.
One variant uses a CanvasGradient, whose color can change inside a single bar.
The other assigns one color to the whole bar based on its endpoints.
Those variants are not interchangeable.

The high endpoint column is read by the renderer without its own configured mode-1 series.
A first-class interval binding can make both endpoints participate in autoscaling.
Replacing only the renderer callback does not address that extent issue.

#### Deferred TODO: explicit endpoint references

The floating-bar implementation needs reevaluation rather than preservation of its display callbacks.
Lower and upper edges must come from explicit references to the min and max data series:

- Mode 2: references to the lower and upper facets.
- Aligned data: an explicit `seriesIdx` reference for each edge.

These are per-datum endpoint arrays, not the cached `series.min` and `series.max` extrema.
A `disp` callback must not be necessary to retrieve either baseline or endpoint values.
Core can use the references for domain scanning, projection, and invalidation.

The API can develop alongside the more extensive candlestick/OHLC and box-plot demos.
Those marks need several endpoint roles, not merely one low/high pair.
The exact syntax and compound-mark composition remain open.

This is a deferred design and migration task, not a requirement to retain `disp.y0`/`disp.y1`.
It does not block the broader `disp` redesign or removal.
No renderer or demo changes are part of this decision.

### Histograms and heatmaps

The shifted histogram converts a pixel gap back into data units and offsets bin starts.
Its width is the difference between the first two X values.
For this regular linear histogram, bin centers and ordinary centered bars are a possible existing-API replacement.
Deleting the descriptors and using start alignment is not automatically equivalent for gap placement.

The custom heatmap infers regular grid dimensions and spacing from repeated X/Y coordinates.
It quantizes positive counts across a global min/max into an explicit palette.
Zero counts use a sentinel index and do not paint.
There is no active spatial hover for this custom heatmap.

Earlier custom renderers on the same page normalize counts separately within each X column.
A shared color scale must not silently change per-column normalization into global normalization.

### Scatter and bubbles

The first scatter chart has no configured `disp` and no spatial hover.
The bubble chart uses only `disp.size`; its colors are ordinary per-series styles.
The plugin exposes color descriptors, but the running scatter demo does not supply them.

The bubble population column already has a native mode-2 facet and a shared square-root scale.
The missing semantic connection is that this facet controls point size.
Its current callback repeats that connection manually.

The bubble plugin additionally owns Flatbush construction, identity mapping, circle containment, and cursor integration.
It prefers the smallest containing circle, then the closest center, then the last-painted point.
Those policies are separate from point-size projection.

### Indirect demo pages

| Demo page | Indirect use |
| --- | --- |
| `multi-bars.html` | Benchmark charts in both orientations, plus grouped and ordinary status-colored bars |
| `bars-grouped-stacked.html` | Ten orientation/grouping/stacking/category-count variants through `barChartPlugin.js` |
| `sparklines-bars.html` | Gradient and per-bar-color floating-bar variants |
| `scatter.html` | One plain scatter chart without descriptors, and one size-encoded bubble chart |
| `axis-label-rotation.html` | Interactive bar plugin, including grouping, native stacks, percent values, and optional full-group totals |
| `latency-heatmap.html` | Custom heatmap descriptor and shifted native histogram descriptors |

### Adjacent custom renderers

These are not additional `disp` consumers, but they reveal capabilities that a replacement must not accidentally exclude.

- [Box-and-whisker](../../demos/box-whisker.js), lines 123–254: several interval endpoints, a median, nested outlier observations, and multiple primitives per datum.
- [Candlestick/OHLC](../../demos/candlestick-ohlc.js), lines 134–295: wick/body intervals, direction-derived colors, and volume on another scale.
- [High/low bands](../../demos/high-low-bands.js), lines 599–699: existing band-backed bar geometry that can express some floating intervals today.

These examples support reusable channel and interval primitives.
They do not require adding a built-in chart type for every compound glyph.

## 3. Grafana inventory

All paths in this section are relative to the inspected Grafana checkout.
They identify local source evidence, not a claim about current upstream main.

Three different meanings of `disp` occur in that codebase:

1. Native uPlot pathbuilder descriptors.
2. Custom Grafana renderer options with the same name.
3. Local aliases for field configuration or display processors, unrelated to pathbuilder descriptors.

Only the first two are rendering contracts relevant to this review.

| Consumer | Native `disp`? | Main requirements | Spatial strategy |
| --- | --- | --- | --- |
| Bar chart | Yes: X layout, width, optional colors | Category/subgroup layout, field-driven styles, labels, stacks | Quadtree rectangles and category grouping |
| Histogram | Yes, in linear numeric branch | Bucket starts/widths, final edge extents, stacks | X-bucket selection |
| Ordinary time-series bars | No | Standard bar geometry, series paint/gradients, external stacks | Native X/proximity selection |
| XY scatter/bubbles | Custom `disp` | Size/color fields, circles/squares, ordered paint, optional connecting lines | Quadtree plus center/radius filter |
| Heatmap | Custom `disp` | Dense/sparse cells, palette quantization, interval extents, exemplars | Quadtree rectangles |
| State timeline/status history | No rendering `disp` | Lanes, intervals or samples, state mappings, labels | Lazy quadtree and cross-lane X-strip selection |
| Candlestick/volume | No | Compound interval geometry and direction-derived styles | Shared time-series interaction |

No native `disp.y0`/`disp.y1` use was found in the inspected Grafana frontend.
No Flatbush use was found there.

### Native bar chart

`public/app/plugins/panel/barchart/bars.ts` owns nested distribution, ordinal range adjustment, color arrays, quadtree geometry, labels, and hover.
Its native descriptors pass already-calculated fractional positions/widths and resolved colors.
The same rectangle callback supports labels and interaction.

Color can come from another field, thresholds, or value mappings.
It must remain independent of cumulative stack height.
Unstacked bars can expand their highlight across the full value-axis dimension.
Multi-hover selects bars sharing the same category index.

`drawClear` rebuilds layout/color arrays, clears the tree, and assigns private `series._paths = null`.
Core-owned geometry can remove that forced-rebuild pattern.
An index alone does not remove layout, style policy, or label placement.

### Histogram

`public/app/plugins/panel/histogram/Histogram.tsx` supplies native scale-value starts and an array-returning uniform width in the linear branch.
Ordinal and inferred-logarithmic branches use ordinary bars without descriptors.
The frame retains bucket minimum and maximum, but plot preparation removes the maximum column and infers width.
Grafana separately expands X extents to include the final bucket.

A direct interval binding can replace width inference and extent expansion together.
Native stacking replaces count accumulation, not bucket geometry.
The current bucket-based hover does not need a two-dimensional index.

### Ordinary time-series bars

The active TimeSeries route uses shared `UPlotConfigBuilder` and `UPlotSeriesBuilder` machinery.
It calls native bars with size/alignment options, not `disp`.
External stack preparation and band generation remain substantial replacement candidates.

Series colors and CanvasGradients are already ordinary paint options.
Threshold gradients can change color inside one bar.
Per-datum color classification is not an equivalent replacement.
Native proximity interaction remains useful and must not become strict rectangle containment by default.

### XY scatter

Grafana uses a custom renderer rather than the local native point builder.
It supports circles, squares, optional lines, stroke, opacity, and data-order painting.
Preparation converts a size field into CSS diameters and caches classified color indices separately.
The active color renderer bypasses the nominal color callback and uses that side cache.

Size mapping interpolates squared diameter endpoints before taking a square root.
That is not generally equivalent to interpolating diameters after a square-root source transform.
A replacement must define area versus diameter semantics and the stroke convention.

Color compilation covers exact/range/special-value mappings and absolute thresholds.
Its continuous-color path uses a finite palette.
Regex mappings and percentage thresholds have unfinished branches in this checkout.
This compiler is not a substitute for every Grafana field-display policy.

Hover selects the closest accepted center after a radius check.
That differs from the [local bubble plugin](../../demos/lib/scatterPlugin.js), lines 122–137, which prefers the smallest containing circle.
The inspected Grafana code applies the radius test even to square points.
A migration must choose intended shape semantics rather than inherit either implementation accidentally.

### Heatmap

Dense data uses X/Y/count columns. Sparse data supplies X maximum, Y minimum, Y maximum, and count.
Palette generation, count normalization, and indices live in a separate color cache.
The custom descriptor mainly transports that prepared result.

Dense rendering infers grid spacing and supports gaps, alignment, minimum dimensions, and logarithmic handling.
Sparse rendering uses explicit Y intervals and inferred uniform X width.
Grafana separately adjusts scale ranges for bin edges.
Grafana's range callback compensates for auto-ranging from the first Y facet by accounting for the upper bucket boundary.
The [local development scanner](../../src/uPlot.js), lines 358–369, supports all registered mode-2 facets that participate in scanning.
That does not establish that Grafana registers its upper endpoint as such a facet.
A migration still needs explicit endpoint bindings.

Count filters, palette opacity, configurable palette size, and exemplar layers also affect behavior.
Overlapping rectangle selection currently depends on traversal behavior.
A new index needs a deliberate tie/layer policy.

### Timeline and status history

These renderers do not use native `disp`, yet they contain much of the same external machinery.
They position series in lanes while the data value controls color or text, not Y position.
Changes mode renders intervals and can merge repeated states.
Samples mode renders centered sample columns.

States can be numeric, enum, boolean, or string. Mapped null/NaN states can be visible.
Explicit end timestamps become interval boundaries during preparation.
Labels use retained rectangles and fill colors.
Lazy indexing supports direct containment, multi-hover, and synchronized cross-lane selection at the same X.

A generic numeric Y transform does not describe this behavior.
A lane layout plus interval geometry and payload/style bindings can.

### Grafana source anchors

| Source | Relevant lines |
| --- | --- |
| `public/app/plugins/panel/barchart/bars.ts` | 212–320 layout/descriptors; 322–460 geometry/labels; 473–565 hover/lifecycle; 646–652 stacks |
| `public/app/plugins/panel/barchart/utils.ts` | 221–262 raw/color inputs; 305–314 and 386–428 configuration |
| `public/app/plugins/panel/histogram/Histogram.tsx` | 70–146, 211–247, 265–312 |
| `packages/grafana-ui/src/components/uPlot/config/UPlotSeriesBuilder.ts` | 92–106, 154–230, 244–274 |
| `packages/grafana-ui/src/components/uPlot/config/UPlotConfigBuilder.ts` | 258–265 |
| `packages/grafana-ui/src/components/uPlot/config/gradientFills.ts` | 97–176 |
| `packages/grafana-ui/src/components/uPlot/utils.ts` | 68–291 external stack preparation |
| `public/app/core/components/TimeSeries/utils.ts` | 132–140, 581–635, 726–756 |
| `public/app/plugins/panel/xychart/scatter.ts` | 28–298 renderer/interaction; 416–514 preparation; 522–704 ranges/classification |
| `public/app/plugins/panel/heatmap/fields.ts` | 35–45, 261–301, 368–425 |
| `public/app/plugins/panel/heatmap/utils.ts` | 149–390 extents; 452–585 setup; 592–895 renderers; 925–971 quantization |
| `public/app/core/components/TimelineChart/timeline.ts` | 142–385 boxes/labels; 402–479 index/interaction; 482–540 axes/ranges |
| `public/app/core/components/TimelineChart/utils.ts` | 103–151, 248–454 preparation |
| `public/app/plugins/panel/barchart/quadtree.ts` | 1–147 shared spatial structure |
| `packages/grafana-data/src/field/displayProcessor.ts` | 90–205 field display policy |
| `packages/grafana-data/src/field/fieldOverrides.ts` | 222–231, 341–378 display-result caching |

## 4. What can disappear without a new generalized API

These are migration candidates from source inspection, not validated visual equivalence claims.

| Existing work | Existing or small replacement | Limitation |
| --- | --- | --- |
| External cumulative arrays and generated stack bands | Native `stack.groups` and baselines | Grafana grouping/null/percent/band semantics need comparison |
| Regular linear histogram start/width descriptors | Center-valued X data and ordinary bars | Preserve bucket edges, empty bins, gap placement, and extents |
| Floating Y descriptors | High/low series with a band-backed baseline | Helper series remain; explicit range binding is clearer |
| Repeated status-to-color arrays | Already-supported palette/index tuples | Simplifies transport but does not eliminate style mapping |
| One-slot category layout | Ordinary centered bars with matching range/width | Not a general grouped-layout replacement |
| Duplicate label-position projection | Final geometry from `each()` | Geometry still needs a useful lifecycle |

### Native stacking is not a drop-in Grafana migration

The local implementation preserves nulls; Grafana preparation can substitute accumulated values at joined-null positions.
Local `stack.percent` applies to all stack groups in the plot.
Grafana can mix normal and percent groups within one plot.
Native stacks take ownership of bands, so explicit `fillBelowTo` bands need a coexistence decision.
Grafana field transforms, compatible-group selection, formatting, and theme policy remain application responsibilities.

These are compatibility decisions, not evidence that stacking belongs in `disp`.

## 5. The missing common foundation: semantic data bindings

Today, mode 1 associates each rendered value series with one Y column.
Mode 2 permits more facets and the local scanner visits all registered facets.
Neither arrangement fully connects arbitrary source columns to mark roles.

Concrete examples:

- Bubble size repeats a facet-to-size binding in a callback.
- Floating high endpoints can affect drawing without affecting the scale domain.
- Histogram maximum edges are removed, then reconstructed through width/range code.
- Status values control color but must not create extra plotted Y series.
- Timeline state values are payloads, while a series-to-lane layout supplies Y geometry.

A useful binding describes source identity, semantic role, scale association, and extent participation.
It also identifies whether a source is raw, derived, constant, or externally encoded.
The original data index remains available for legends and application metadata.

This does not require a new row-object data format or a general expression language.
Existing column arrays and mode-2 facets are a starting point.
A small mapping from roles to existing columns can remove many opaque callback dependencies.
Derived arrays can remain caller-owned immutable data.

Merely moving `disp.values()` into a `channels` object would not solve extent calculation or invalidation.
Bindings must become visible to core before scales and geometry are prepared.

## 6. Separate three kinds of scale-like operation

### Numeric normalization and projection

Existing scales supply data domains and transforms.
They can continue to normalize numeric inputs and project X/Y coordinates.
The scale domain remains data, not pixels.
Canvas output projection and public CSS-coordinate conversions remain separate concerns.

Size mappings need an explicit visual range and diameter/area semantics.
They do not need to pretend that population is an X-axis distance.
Output-range refresh and DPR dependence must be defined before changing display sizes from CSS to canvas pixels.

### Band and lane layout

Category layout depends on category identity plus participating series or stack groups.
It needs centers, intervals, steps, and nested slots—not just another scalar `distr` function.

Required decisions include:

- Visible-series membership and stable slot order.
- Stack groups sharing slots.
- Full-category backgrounds and nonparticipating line overlays.
- Category gaps, inner gaps, and single-category behavior.
- Axis tick centers and range ownership.
- Strict band containment versus nearest-category selection.
- Lane placement by series identity rather than numeric Y payload.

A dedicated contextual operation can resolve `(seriesIdx, dataIdx)` to an interval.
Ordinary `valToPos(value)` need not gain series/data indices for every scale.
Axes still need context-free category centers.
An inverse interval lookup can identify a category/slot without claiming to identify a unique stacked segment.

A uniform band layout can retain starts, steps, widths, and a series-to-slot map.
It need not materialize a position array for every series/category pair.

### Discrete mappings and quantizers

A discrete tuple is a storage representation, not a scale definition.
A scale maps inputs to outputs. It can produce dictionary indices, but does not need to own a data-length index array.

The surveyed consumers need different operations:

| Operation | Example | Additional policy |
| --- | --- | --- |
| Categorical lookup | Build status to color | Domain order, unknown values, palette stability |
| Explicit thresholds | Numeric state to color class | Boundary inclusion and absolute/relative thresholds |
| Quantization | Count range to finite heatmap palette | Domain, bin count, clamp behavior, empty/constant domains |
| Derived rule | Either endpoint negative; open greater than close | Inputs or a caller-derived class column |
| Numeric size encoding | Population to diameter/area | Shared domain, transform, visual range |
| Pre-encoded lookup | External palette plus index column | Identity, lifetime, and invalidation only |

These mappings are often many-to-one.
They do not have a unique `posToVal()` inverse.
A threshold mapping can expose a source interval; a categorical mapping can expose members.
Neither is an ordinary numeric inverse.

Recommendation: distinguish coordinate scales, contextual layouts, and value mappings even if they share registration or domain-scanning infrastructure.
Extending every numeric scale with categorical outputs, fake extrema, and inverse stubs would add complexity rather than remove it.

Grafana must retain the option to supply preclassified indices and palettes.
Core does not need to implement regex rules, field overrides, formatting, or every application threshold policy.
CanvasGradients also remain distinct from selecting one color per datum.

## 7. Interval geometry is more important than variable scalar widths

Floating bars, histograms, sparse heatmaps, timelines, and OHLC all need intervals.
They differ in layout and paint, but they share endpoint projection and extent contribution.

For a logarithmic X axis, an interval width is position-dependent:

```js
const startPx = project(x0);
const endPx = project(x1);
const widthPx = Math.abs(endPx - startPx);
```

A scalar data delta converted through `project(delta) - project(0)` cannot express this generally.
A unary data delta can still produce variable pixel widths when anchored at each datum.
Thus the future width TODO needs an interval contract, not only an array of widths.

A rectangle primitive can combine X/Y intervals with category/lane layout.
A regular grid can supply interval edges through shared metadata rather than duplicate endpoint arrays.
Sparse cells can supply explicit edges.
Both endpoints must contribute to the appropriate domain when scanning is enabled.

Anchoring, gaps, stroke inset, minimum dimensions, clipping, and partial-cell inclusion remain geometry responsibilities.
Stack-derived baselines and user-supplied low/high intervals can feed the same rectangle construction without sharing the same data semantics.

## 8. Core-owned interaction and Flatbush

Including Flatbush is feasible as an optional core interaction implementation.
The main benefit is ownership of geometry and invalidation, not merely replacing one search algorithm.

The local [Flatbush copy](../../demos/lib/flatbush.js) comes from the `leeoniya/smol` branch and includes a nearest-neighbor queue.
Its [ISC notice](../../demos/lib/flatbush.LICENSE) must accompany a vendored core copy.
It requires an item count, inserts bounds, and finalizes a packed static index with `finish()`.
The `search()` filter receives both identity and bounds.
Returning false avoids collected candidate IDs, but the implementation still allocates traversal/result arrays.
It is not an allocation-free query API.

### Interaction policies are not interchangeable

| Data/mark structure | Suitable lookup | Selection policy still needed |
| --- | --- | --- |
| Sorted time series | Existing X search/proximity | Nearest values, null handling, cursor synchronization |
| Uniform grouped bars | Category arithmetic plus local rectangles | Exact segment versus category hover, shared edges |
| Histogram buckets | Interval lookup | Boundary ownership, missing buckets |
| Regular grid | Row/column lookup | Gaps, filtering, partially visible cells |
| Unordered bubbles or sparse rectangles | Flatbush candidates | Exact shape, nearest/smallest/topmost priority |
| Timeline lanes | Interval or X-strip query | Single lane versus synchronized multi-lane results |

Recommendation: centralize the interaction contract without requiring a tree for every chart.
Flatbush can serve unordered or arbitrary geometry while specialized layouts retain cheaper direct lookup.
Index construction can remain disabled when interaction is disabled.

### A useful core geometry contract

Core needs more than `{seriesIdx, dataIdx}` and an index:

- Stable source identity through filters, gaps, hidden series, and reordered paint.
- Painted bounds, interactive bounds, and clip restrictions.
- Shape containment after bounding-box search.
- Deterministic tie-breaking independent of index traversal order.
- Layer or primitive identity for compound glyphs and exemplars.
- Bounds for cursor overlays and label placement.
- Queries for one mark, nearest marks, or all marks in a category/X strip.
- A way for custom builders to register geometry.

The current cursor code still derives Y position from the primary numeric Y value.
It explicitly notes that this does not work for state timelines, heatmaps, and status history.
A core index must connect to cursor/legend/focus state without that assumption.
See [uPlot cursor handling](../../src/uPlot.js), lines 3243–3342.

### Geometry lifetime

Geometry belongs alongside the geometry/path cache, not in a tree cleared on every canvas repaint.
A style-only repaint need not invalidate positions.
Data, scale, layout, plot dimensions, DPR, visibility, size, and filtering can invalidate geometry.
Queries also need to refresh selection beneath a stationary cursor after geometry changes.

The existing bubble plugin defers `finish()` until mouseenter or an in-plot cursor query.
That postpones packing, but it does not avoid bounds insertion and storage during drawing.
A fully lazy build requires retained geometry or another geometry pass.

Packed-index capacity remains a design choice:

- Fixed source slots plus placeholders preserve simple data-index mapping but include skipped slots in capacity and packing.
- Compact drawn-mark storage saves slots but requires identity mapping and an item count before packing.

Moving the index into core does not make that tradeoff disappear.
It can make the choice consistent and prevent each plugin from solving it separately.

### Do not remove all geometry observation

`each()` serves labels and custom extensions as well as spatial indexing.
Core hover can remove application-owned index setup without eliminating legitimate geometry consumers.
A retained geometry query, observer, or custom-mark registration interface still has a role.
The exact public replacement for `each()` is open.

## 9. Cache ownership without an external display cache

A useful conceptual pipeline is:

```text
source columns and bindings
  -> derived data and stack baselines
  -> domains and value mappings
  -> category/lane/interval layout
  -> canvas geometry
  -> ordered painting and optional interaction
```

This is an ownership model, not a proposal to allocate an intermediate array at every arrow.

| State | Typical dependencies |
| --- | --- |
| Raw columns or externally encoded indices | Data replacement |
| Stack endpoints/baselines | Data, membership, visibility, percent policy |
| Classified colors or quantized indices | Source data, mapping, domain, palette/theme |
| Band/lane membership | Participants, order, visibility, stack groups |
| Pixel geometry | Data/layout, scale ranges, dimensions, DPR, sizes, clipping/filter policy |
| Spatial index | Registered interactive geometry |
| Paint styles | Palette/theme, opacity, stroke/fill options |

Mappings based on raw values can survive zoom when their domain remains fixed.
A viewport-derived domain cannot use the same lifetime.
Size and color domains can be shared across series or local to a series/column.
These dependencies need explicit ownership rather than accidental callback timing.

Opaque callbacks can remain an escape hatch, but core cannot infer their dependencies.
Immutable derived inputs with an explicit replacement/refresh boundary are simpler than a general reactive expression system.
Caller-owned theme and field-policy adapters remain appropriate.

## 10. What elimination of disp actually means

| Current descriptor responsibility | Proposed owner | Does the work disappear? |
| --- | --- | --- |
| Stack-related Y rewriting | Native stack transform | Application accumulation and baseline plumbing can disappear |
| Grouped fractional X arrays | Native band/slot layout | Duplicate arrays and tick/range alignment can disappear |
| Floating Y endpoints | Explicit min/max facet or `seriesIdx` references and rectangle geometry | Deferred API/migration TODO, not a blocker to retiring `disp` |
| Histogram/cell widths | Interval/grid bindings | Width inference and repeated extent compensation can disappear |
| Per-item colors | Standard style channel plus mapping or encoded data | Classification remains necessary, but transport/caching can be shared |
| Bubble sizes | Size binding plus native numeric mapping | Renderer callback disappears; visual range remains necessary |
| Quantized palette transport | Common encoded-column representation | No need for a special builder-only tuple contract |
| External quadtree plumbing | Core geometry interaction | Application index lifecycle and cursor overrides can largely disappear |
| Geometry callbacks for labels | Geometry access/observer | Still useful; not inherently a workaround |

A shared encoded-column representation can retain dictionary/index storage without retaining `disp`.
The key difference is that core knows the source and semantic role before it scans domains and builds paths.

## 11. Recommended implementation order

1. Define source bindings and extent participation for position, size, and style channels, with room for explicit endpoint references.
2. Define a small internal geometry/identity contract that native and custom builders can share.
3. Add band/slot layout with native-stack membership and category queries.
4. Add opt-in core hit testing, including Flatbush where direct lookup is insufficient.
5. Promote point size and per-item styles to standard series/mark bindings.
6. Add reusable categorical, threshold, and quantized mappings while accepting external encoded columns.
7. Add interval/grid bindings for histograms and heatmaps.
8. Retire `disp` as consumers move to the appropriate core capabilities, without waiting for the deferred floating/compound-mark API.

Separate TODO: design explicit endpoint references and migrate floating bars, candlestick/OHLC, and box-plot examples as that API develops.
Their existing implementations inform the design but do not make display callbacks a requirement.

These steps need not ship as one large framework.
Band layout plus core bar interaction offers the clearest first vertical slice through a real demo.
Bubble size/color bindings plus unordered interaction provide a second slice with different requirements.

A prototype is successful only if it removes plugin state, callbacks, or repeated projection—not if it merely relocates them.

## 12. Open decisions and validation gates

### Decisions before committing to public APIs

- How do mode-1 auxiliary columns and mode-2 facets bind to named mark roles without fake visible series?
- Which inputs contribute to scale extents, and how do hidden marks affect shared size/color domains?
- Is band/lane membership owned by a scale, a layout object, or a small mark-registration layer?
- Which public operations return category centers, slot intervals, or exact mark hits?
- Where do mappings live, and how do externally encoded columns share that path?
- How are diameter versus area mappings and DPR-dependent visual ranges expressed?
- How do custom/compound marks register identity, geometry, and exact-hit policy?
- Does the build make Flatbush optional, and what cost applies to ordinary line charts?
- Which existing callback, legend, band, and stack behaviors intentionally change?

### Concrete migration checks

- The inventoried demo pages as their migrations land, including grouped/stacked orientations and full-group totals.
- Duplicate category labels, hidden slot membership, empty categories, and line overlays.
- Histogram final edges included in autoscaling.
- Deferred endpoint API: explicit lower/upper facet or series references, with both edges included in autoscaling.
- Nonlinear interval widths without a delta-from-zero projection.
- Raw-value colors preserved under stacking and independent-field color bindings.
- Palette/rule/quantizer equivalence, including domain scope and boundary behavior.
- CanvasGradients preserved where color varies inside a mark.
- Bubble diameter/area semantics, stroke inclusion, opacity overlap, squares, and clipping.
- Single-mark versus category/multi-lane hover and synchronized cursor behavior.
- Deterministic overlap selection, filtered-point identity, DPR changes, and stationary-pointer refresh.
- No forced path rebuild merely to reconstruct an external index.
- Custom geometry registration and label access remain possible.

Future measurements must compare complete migrated scopes, not isolated helper sizes.
They need baseline line-chart bundle cost, index memory/build/query cost, repaint behavior, and application code removed.
The earlier Grafana size reports do not establish savings for this proposed architecture.

## Summary

The evidence supports retiring `disp` as a mixed-purpose pathbuilder interface.
Its capabilities need appropriate owners rather than equivalent display callbacks.
The explicit endpoint API for floating and compound marks remains a separate TODO, not a blocker to retiring `disp`.

The simplifying foundation is **semantic data binding plus shared geometry ownership**.
Band/interval layouts, discrete mappings, native stacking, and optional spatial lookup then have clear responsibilities.
Without that foundation, more scale types and a core Flatbush dependency can still leave the same application bookkeeping in place.
