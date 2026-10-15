# Categorical band scales and nested bar slots

Status: design proposal, not implemented. Configuration names and new API signatures are illustrative.

## Goal

Give category axes, bars, and category hover one shared layout definition.
Keep ordinary numeric scales value-based.
Keep data domains separate from pixel geometry.

The proposed category bands are intervals along an axis.
They are not the existing fill bands between series.

## Current implementation

The scatter size mapping has two steps:

```text
raw size -> scale.valToPct(value) -> configured diameter range
```

The scale owns the data domain and transform.
The point builder uses `disp.size.range` as the visual output range.
This separation also suits other visual properties.

The bar plugin performs more work outside the scale:

- It distributes categories across the plot.
- It distributes visible series or stack groups within each category.
- It builds offset arrays for the participating series.
- It expands the ordinal X domain so axis ticks match the independently calculated category centers.

The bar builder previously converted fractional offsets back into data values before pixel projection:

```text
layout fraction -> canvas position -> posToVal() -> valToPos() -> canvas position
```

Two simplifications now use the existing public API:

- The bar builder projects `PixelPercent` positions directly with `offset + fraction * dimension`, without a converted array.
- The plugin calculates the inner slot distribution once per layout, rather than once per category.

These changes require no band-scale API or new layout cache.
The proposed band scale still targets the separate calculations of category centers and the per-slot geometry arrays.

Relevant source:

- [Bar plugin](../../demos/lib/barChartPlugin.js): `xRange()`, `distributeBars()`, and the `disp.x0`/`disp.size` descriptors.
- [Distribution helper](../../demos/lib/distr.js): normalized positions and widths.
- [Bar builder](../../src/paths/bars.js): fractional geometry conversion and column-width inference.
- [Point builder](../../src/paths/points.js): scale-backed size mapping.
- [Core scales](../../src/uPlot.js): `initValToPct()`, `valToPos()`, and `posToVal()`.
- [Bar hover](../../demos/lib/barHover.js): category lookup and final rectangle tests.

## Why not extend every scale transform with indices?

A numeric scale maps a value independently of the mark that uses it.
Axes, grid lines, cursor conversion, and path builders rely on that property.

A transform such as `transform(value, seriesIdx, dataIdx)` supplies context but leaves several questions unanswered:

- Which series position does an axis tick use?
- Does a position query return the category center or a bar center?
- How does the caller obtain the bar width?
- What does the inverse return in a gap?
- What does the inverse return for stacked series that share a slot?

The proposed design adds interval operations rather than index arguments to every numeric transform.
The spacing helper `distr()` and the scale distribution property `distr` represent different operations.

## Membership from data, spacing from configuration

| Layout input | Source |
| --- | --- |
| Category identity and order | Data indices, as in the existing ordinal representation |
| Category labels | Raw X values or axis formatting |
| Participating series | Bar setup |
| Shared slots for stacked series | Existing `stack.groups` |
| Active slots | Participating visible series or stack groups |
| Width and spacing rules | Band configuration |

Category count comes from the data, not a second configuration property.
Duplicate labels remain separate categories because category identity uses the data index.

Grouped bars use one slot per participating visible series.
Stacked bars use one slot per participating stack group that contains a visible series.
Hidden series do not reserve independent slots.
Group-wide backgrounds use the entire category band rather than an inner slot.

Stack membership remains in `stack.groups`.
The scale must not assume that every series sharing X is a bar.
A line overlay does not consume a slot.
The mechanism that registers participating series remains an open design question.

The initial scope uses the same active slot layout in every category.
A null bar value does not repack the other slots in its category.
Per-category slot packing is outside the initial scope.

## Proposed configuration

A category-only scale:

```js
scales: {
  x: {
    time: false,
    distr: 'band', // Illustrative name, not an existing enum value.
    band: {
      size: 0.6,
      justify: 'around',
    },
  },
}
```

`size` is the fraction of available space occupied by all bands together.
This matches the current distribution helper, rather than introducing a different padding formula.
`justify` accepts the proposed names `'between'`, `'around'`, and `'evenly'`.
Their meanings match `SPACE_BETWEEN`, `SPACE_AROUND`, and `SPACE_EVENLY` in the current demo.

Grouped bars add an inner distribution:

```js
scales: {
  x: {
    time: false,
    distr: 'band',
    band: {
      size: 0.6,
      justify: 'around',
      slots: {
        size: 1,
        justify: 'around',
      },
    },
  },
}
```

The outer distribution places categories.
The inner distribution places series or stack groups within each category.
The example does not prescribe the final enum representation or registration API.

## Layout composition

The logical structure is:

```text
category scale
  category band
    series or stack slot A
    series or stack slot B
    series or stack slot C
```

In normalized coordinates, the composition is:

```js
barStart = categoryStart(di) + categoryWidth * slotStart(slotForSeries[si]);
barWidth = categoryWidth * slotWidth;
```

The existing orientation, direction, and pixel projection follow this composition.
The scale domain remains categories or ordinal coordinates, not CSS or canvas pixels.

For uniform layouts, prepared starts, steps, widths, and a series-to-slot map are sufficient.
The path builder does not need an offset array for every series/category pair.
It also does not need a new rectangle object for every bar.

## Public API proposal

### Scalar coordinate conversion

The existing operations retain scalar meanings:

```js
u.valToPos(categoryIdx, 'x'); // Category center in plot-relative CSS pixels.
u.posToVal(position, 'x');   // Continuous ordinal coordinate.
```

The existing `can: true` argument selects absolute canvas coordinates.
Inputs use category indices, not label strings.
An integer category coordinate maps to its center.
A position between centers can map to a fractional coordinate such as `1.4`.

`posToVal()` remains a coordinate conversion, not a containment test.
This distinction separates axis location from category or slot membership.

### Forward interval lookup

The proposed interval operation is:

```js
u.valToBand(categoryIdx, 'x');
// -> {start, end} for the category band.

u.valToBand(categoryIdx, 'x', seriesIdx);
// -> {start, end} for the series slot within that category.
```

Without series context, the result describes the category band.
With series context, the operation resolves the series to its prepared slot.
Stacked series return the same interval.

`start` and `end` use increasing physical coordinates, regardless of scale direction.
Scale orientation determines whether those coordinates refer to horizontal or vertical positions.
The default coordinate space is plot-relative CSS pixels.
An explicit canvas-coordinate form is required, but its argument position remains undecided.

Object results are a convenience API, not a requirement for the rendering loop.
Internal scalar operations or prepared layout state avoid per-bar allocations.

### Inverse interval lookup

The proposed inverse operation is:

```js
u.posToBand(position, 'x');
// -> {dataIdx, slotIdx} or null.
```

| Position | Proposed result |
| --- | --- |
| Outside category bands, including gaps between categories | `null` |
| Inside a category but in an inner slot gap | `{dataIdx, slotIdx: null}` |
| Inside a slot | `{dataIdx, slotIdx}` |
| Inside a category without nested slots | `{dataIdx, slotIdx: null}` |

The result identifies a slot, not a unique series.
Several stacked series share one slot.
The Y coordinate or final rectangle bounds identify the painted stack segment.

Nearest-category selection remains distinct from strict band containment.
Group hover that includes gaps can use the continuous ordinal coordinate or a separate nearest-category operation.
Shared-edge ownership needs an explicit rule before implementation.

## Responsibility boundaries

| Layer | Responsibility |
| --- | --- |
| Band layout and scale projection | Category/slot membership, normalized intervals, centers, widths, orientation, and direction |
| Numeric Y scale and native stacking | Value projection, cumulative values, baselines, and percent normalization |
| Bar path builder | Final rectangles, stroke insets, width limits, pixel alignment, and corner radii |
| Axis layout | Label formatting, measurement, rotation, and overflow padding |
| Hover implementation | Category/slot lookup and exact tests against final painted bounds |

A band interval describes allocated space, not necessarily the final painted bar bounds.
Bar width limits and stroke treatment can change the final rectangle.
The builder's `each()` callback remains useful for exact hover geometry and labels.

`disp` remains available for arbitrary custom geometry.
Ordinary linear, logarithmic, asinh, and custom numeric transforms remain value-based.
The current scatter size-scale mapping does not need to change.

## Expected simplifications

The target is to remove or reduce:

- The `xRange()` algebra that aligns ordinal ticks with separately distributed groups.
- `groupOffsets` and `barOffsets`. Uniform widths already use scalar Unary display values.

- Column-width inference for layouts that already supply a bandwidth.
- Separate calculations of category centers and steps for group hover.

The distribution and membership logic still exists, but it has one owner.
The implementation must not reproduce the same calculations inside the scale and plugin.
Performance gains require measurement. This proposal does not claim a measured speedup.

## Implementation sequence

1. Define category identity, participant registration, slot membership, and shared-edge ownership.
2. Specify empty-category, single-category, zoom, and range behavior.
3. Implement normalized category bands and nested slots without per-mark allocations.
4. Add center conversion and interval lookup APIs.
5. Connect axis centers and bar paths to the same prepared layout.
6. Replace the demo's offset arrays and range-alignment workaround.
7. Connect category hover to the shared layout while retaining exact rectangle tests.
8. Compare geometry, memory use, and draw cost with the current implementation.

## Validation plan

Coverage must include:

- Grouped bars, one stack, multiple stacks, and group-wide backgrounds.
- Hidden series, hidden stack groups, and line overlays that do not consume slots.
- Duplicate labels and data replacement.
- All three distribution modes for outer bands and inner slots.
- Empty data, one category, one slot, and no active slots.
- Both orientations, both directions, nonzero plot offsets, and fractional DPR.
- Category-center conversion and continuous ordinal inverse conversion.
- Strict containment in bands, outer gaps, inner gaps, and shared edges.
- CSS and canvas coordinate forms of the APIs.
- Width limits, stroke insets, and pixel alignment without axis-center drift.
- Layout invalidation after data, visibility, distribution, or plot-size changes.
- Existing numeric scales and custom `disp` geometry without regressions.

## Open decisions

- Numeric `distr` enum value versus another discriminator for band scales.
- Final names for band configuration and interval operations.
- Participant registration and the ownership of nested slot preparation.
- Canvas-coordinate arguments for the new public APIs.
- Behavior for hidden or nonparticipating series in `valToBand()`.
- Shared-edge ownership and nearest-category lookup semantics.
- Category-range and zoom semantics, including partially visible categories.
- Scope for aligned mode versus faceted mode with independent X data.
- Support for nonuniform category widths or per-category slot layouts after the initial implementation.
