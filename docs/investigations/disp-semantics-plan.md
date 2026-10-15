# Display descriptors: units, projection, and cache semantics

## Status and scope

This investigation records the current bar and point `disp` implementation and the proposed cleanup.
The `kind` changes are implemented. The unit and cache recommendations below remain design proposals.
This document does not authorize further runtime changes.

Related files:

- [Current display API](../paths-disp.md)
- [Shared display helpers](../../src/paths/disp.js)
- [Bar pathbuilder](../../src/paths/bars.js)
- [Point pathbuilder](../../src/paths/points.js)
- [Public types](../../dist/uPlot.d.ts)
- [Display regression tests](../../test/path-disp.mjs)
- [Band-scale investigation](band-scale-plan.md)

## Implemented representation contract

`kind` selects the callback return format. It does not select a unit, projection, or paint strategy.

| `kind` | `values()` returns | Selected value |
| --- | --- | --- |
| `1` — Unary | `T` | The same value for every datum |
| `2` — Discrete | `[enum, idxs]` | `enum[idxs[dataIdx]]` |
| `3` — Continuous, or omitted | `ArrayLike<T>` | `values[dataIdx]` |

The generic discrete type is `readonly [enum: readonly T[], idxs: ArrayLike<number>]`.
It accepts typed index arrays. The former `{palette, indices}` shape is no longer supported.
Continuous describes the representation here, not a requirement for a mathematically continuous value domain.

Colors, point sizes, and bar `x0`, `y0`, and `y1` support all three kinds.
Bar `disp.size` supports only Unary and requires a scalar return.
The bar demos now return scalar widths instead of width arrays.
A source TODO records variable widths, including position-dependent widths on logarithmic X scales.

The builders select readers once per rebuild.
They do not inspect return shapes or check `kind` for every value.
Unary values do not require data-length arrays.
Array entries and discrete indices refer to original data indices, not the current visible range.

## Current unit inconsistencies

The current enum defines `ScaleValue = 1`, `PixelPercent = 2`, and `Color = 3`.
These names and accepted fields do not consistently describe runtime behavior.

| Channel | Declared unit | Runtime interpretation |
| --- | --- | --- |
| Bar and point colors | Optional `3` | Canvas style. The runtime ignores `unit`. |
| Direct point size | Optional `3` | CSS outer diameter, despite the enum name `Color`. |
| Scale-backed point size | Optional `1` | Raw scale value. The `scale` field selects the mapping, not `unit`. |
| Bar `x0` | Generic bar unit enum | `2` means plot fraction. Other values use the X scale. |
| Bar width | `1` or `2` | Scale-value delta or plot fraction. |
| Bar `y0` and `y1` | Generic bar unit enum | Always Y-scale values. The runtime ignores `unit`. |

The generic bar geometry type permits color units on X positions.
It also permits fractional and color units on Y endpoints without corresponding projections.
The shared kind enum still has the bar-specific name `BarsPathBuilderFacetKind`.

## Canvas pixels versus CSS pixels

Final path geometry and `each()` bounds already use canvas pixels.
The inconsistency concerns the inputs that the point builder accepts through `disp.size`.

Currently:

- Direct point sizes are CSS outer diameters, including stroke.
- Scale-backed `size.range` endpoints are CSS outer diameters.
- The builder converts the diameter to a canvas radius through `pxRatio`.
- The maximum-radius culling margin also multiplies the CSS range maximum by `pxRatio`.
- Bar fractions multiply canvas-sized plot dimensions.
- Bar scale values project into canvas coordinates.

Ordinary style options also use CSS pixels: `points.size`, stroke width, bar gap, and bar width limits.
Their existing conversion is distinct from the proposed `disp` contract.

The recommendation is **canvas pixels for pixel-valued display geometry**, not a new CSS-pixel display unit.
This does not require changing the ordinary style-option convention.

Under this proposal, point diameter calculations use the already-converted canvas stroke width:

```js
radius = (diameterPx - strokeWidthPx) / 2;
```

Direct diameters, size-range endpoints, and culling margins receive no additional `pxRatio` multiplier.
This change remains unimplemented and requires a DPR lifecycle decision.

## Separate representation, meaning, and projection

A descriptor answers three different questions:

1. How does the callback represent values? `kind` answers this question.
2. What does a selected value mean? The channel and its coordinate space answer this question.
3. How does that value become canvas geometry? The projection answers this question.

Colors need no geometric projection.
Numeric channels need projections, but not every channel needs every coordinate space.
Consistent meanings do not require identical fields on every descriptor.

### Colors

The channel already identifies a value as a canvas style.
A color unit adds no information.

Proposed form:

```js
fill: {
    kind: 2,
    values: () => [colors, indices],
}
```

Recommendation: remove `unit` from color descriptors.
CSS color strings, gradients, patterns, and null-channel suppression remain unchanged.

### Positions

Three coordinate spaces are useful for a position:

| Space | Meaning | Projection |
| --- | --- | --- |
| Scale value | A coordinate in the data domain | `project(value)` |
| Plot fraction | A fraction of the relevant plot dimension | `plotOffset + value * plotDimension` |
| Canvas pixel | A physical offset from the plot origin | `plotOffset + value` |

The pixel-offset convention is a proposal, not current bar pixel-position support.
It gives fractions and pixel offsets the same origin.
Absolute canvas coordinates are another possible convention. The API must choose and document one.
The existing `each()` callback can retain absolute canvas bounds under either convention.

Scale direction affects scale-value projection.
Physical fractions and pixel offsets do not need a second reversal through the scale direction.
Orientation selects the relevant plot dimension and offset.

The conceptual names `Value`, `Fraction`, and `Pixel` do not prescribe new public enum numbers or strings.

### Dimensions

A dimension has no positional offset:

| Space | Projection |
| --- | --- |
| Plot fraction | `value * plotDimension`, where a relevant dimension exists |
| Canvas pixel | `value` |
| Scale value | Requires a definition of the size operation |

Point diameter has no natural plot dimension for fractional sizing.
There is no current requirement to add that feature.

## Two different meanings of scale-backed size

### Bar width is an interval along an axis

A bar width in data units describes a delta relative to an X position.
For a nonlinear scale, the projected width depends on that position.
For a start-anchored interval, the signed pixel delta is:

```js
project(x + delta) - project(x)
```

The current implementation uses:

```js
project(delta) - project(0)
```

That shortcut assumes a linear scale.
It is not a general conversion, and zero is outside the logarithmic domain.

Variable widths alone do not resolve the ambiguity.
The contract also needs an anchor and interval convention, or explicit start/end coordinates.
Direction, alignment, and signed versus absolute widths then determine the final rectangle.

Two possible interim contracts remain open:

- Retain scale-value widths as an explicitly linear-only feature.
- Use fractional or canvas-pixel widths, then define data intervals as a separate extension.

The existing unary-only width restriction remains in force until that decision and implementation.

### Bubble diameter encodes a data value

Population is not a distance along a coordinate axis.
A size scale maps population into a normalized fraction, then a diameter range maps that fraction into pixels:

```js
const pct = Math.max(0, Math.min(1, sizeScale.valToPct(population)));
const diameterPx = minDiameterPx + pct * (maxDiameterPx - minDiameterPx);
```

The output range is necessary. A data domain cannot determine the desired visual diameter by itself.
This is a different operation from projecting an interval between two X positions.

The native scale can retain its data domain and transform.
The diameter range belongs to the display projection, not the scale domain.
No new scale distribution is necessary for this separation.

The current builder transforms each included point's selected size during each draw.
Transforming each distinct enum value once is a separate optimization, not part of the implemented kind contract.

## Recommended channel-specific design

The following table describes a proposal, not the current public API.

| Channel | Fields beyond `kind` and `values` |
| --- | --- |
| Fill and stroke | None |
| Bar `x0` | `unit` selects a supported coordinate space |
| Bar `y0` and `y1` | None while they support only series Y-scale values |
| Bar width | Unary only. `unit` selects a supported width interpretation. |
| Direct point diameter | None. Values are canvas pixels. |
| Scale-mapped point diameter | `scale` and a canvas-pixel `range` |

Proposed direct diameter:

```js
size: {
    kind: 2,
    values: () => [[8, 16, 24], indices],
}
```

In this proposal, the enum contains canvas-pixel diameters.
The current implementation still interprets these numbers as CSS pixels.

Proposed scale-mapped diameter:

```js
size: {
    kind: 3,
    scale: 'size',
    range: [minDiameterPx, maxDiameterPx],
    values: (u, si) => u.data[si][2],
}
```

The explicit `scale` field establishes that the source values belong to a scale domain.
A second `unit: Value` declaration repeats the same information.
The `range` endpoints always describe canvas-pixel diameters under this proposal.
Selection through explicit descriptor fields is not return-value probing.

Referencing a scale does not register display values for native domain scanning.
The bubble demo supplies a data facet for that purpose.
Explicit scale domains or a custom scanner remain alternatives.

## Cache lifetime and callback scope

Current behavior differs by channel:

| Channels | Callback range | Evaluation lifetime |
| --- | --- | --- |
| Colors and point sizes | Full series: `0..N-1` | Cached per series and descriptor |
| Bar geometry | Builder range | Every path rebuild |

Both groups use original data indices for array and discrete results.
Bar geometry can depend on plot dimensions and visibility, so its shorter lifetime is useful.
Identical callback signatures conceal the different range semantics.
Standardizing the range arguments or documenting the difference more prominently remains an open decision.

Core data replacement and series-index changes invalidate the display cache.
Resize, scale changes, and same-reference `setData()` calls retain cached values.
Descriptors and their callbacks must remain stable after construction.
The cache does not detect changes to descriptor properties or callback identity.
Data and callback results are immutable under the current contract.

### Canvas pixels require an explicit dependency policy

Source values and projected geometry have different dependencies:

- Raw population values can survive resize, scale changes, and DPR changes.
- Projected positions can depend on plot dimensions, scale ranges, orientation, and direction.
- A literal diameter of `12` canvas pixels remains twelve canvas pixels after a DPR change.
- A callback result of `12 * u.pxRatio` depends on DPR and cannot use an unconditional data-only cache.

A canvas-pixel diameter range also needs an update if the caller wants constant CSS size across DPR changes.
Invalidating a cached callback does not update a literal range array by itself.

The unresolved policy covers both callback results and projection parameters.
Possible approaches include caller-managed refresh, broader invalidation, or a separate evaluation phase for geometry-dependent inputs.
No new cache option or range callback is selected here.

The simplest contract keeps cached values data-derived and evaluates projection-dependent quantities during geometry rebuilds.
The missing piece is a clear owner and refresh lifecycle for those projection parameters.
Adding CSS units to `disp` merely hides that lifecycle question.

## Other remaining inconsistencies

### Coupled bar channels

Bar fill and stroke do not behave independently:

- A fill descriptor requires a stroke descriptor when the series has a nonzero stroke width.
- A stroke descriptor alone does nothing.
- Points allow either descriptor independently and retain the ordinary style for an omitted channel.

Recommendation: give bars the same independent-channel behavior.

Bar geometry also has paired requirements:

- `x0` and `size` only take effect together.
- `y0` and `y1` only take effect together.
- Native stack baselines and fill bands take precedence over display Y endpoints.

Removing the pairing requires explicit fallback semantics.
That decision is separate from color independence and unit cleanup.

### Point colors use bar-oriented preparation

Both builders currently use `cacheColors()`.
It converts Continuous color arrays into palettes and index arrays.
It represents Unary colors internally as `[[color], 0]`.
Discrete tuples pass through unchanged.

Bars use the palette to group colors into paths.
Points paint individually and do not need that deduplication.

Recommendation: let points cache raw color results and use the same kind-selected reader as sizes.
Palette preparation can remain specific to bars.
The cache currently stores prepared values by descriptor identity, so different consumers need a compatible cache arrangement.
A raw-value cache with separate bar preparation is one possible approach, not an implemented design.

### Shared names and restricted types

Recommendation: rename the shared kind enum to a builder-neutral name such as `PathBuilderFacetKind`.
Channel types can expose only supported units and mappings.
This removes false promises without adding runtime validation for unsupported options.
Compatibility aliases and the migration policy remain open.

## Intentional differences to preserve

Not every difference between bars and points is an inconsistency:

- Bars group equal colors into paths. Display-driven points paint individually to preserve translucent overlap and data order.
- Bar geometry callbacks can depend on layout. Cached colors and sizes currently describe immutable source values.
- Bar width remains unary-only until variable-width semantics are defined.
- Null colors suppress a paint channel. Null bar endpoints retain their existing baseline and gap behavior.
- Point sizes must be finite numbers. Null or undefined sizes are unsupported.
- A point size descriptor currently selects strict plot clipping, including Unary sizes.
- Scale-backed sizes expand center inclusion through the maximum diameter. Direct sizes retain the existing center-culling rule.

This investigation does not propose new defensive checks, expanded per-value arrays, or a generic projection framework.
Reader and projector selection can occur once per rebuild.
No performance improvement is claimed without measurement.

## Recommended sequence and open decisions

1. Rename shared types and remove meaningless color-unit declarations.
2. Restrict geometry types to implemented projections without adding new unit behavior.
3. Decide the canvas-pixel and DPR lifecycle for direct sizes and output ranges.
4. Migrate point display sizes to canvas pixels, with examples and migration notes.
5. Make bar fill and stroke independent.
6. Separate raw point-color access from bar palette preparation.
7. Resolve callback-range semantics and geometry-channel fallbacks.
8. Define anchored intervals before implementing variable bar widths.

Before a pixel-position extension, choose plot-relative offsets or absolute canvas coordinates.
Before changing width units, choose whether to retain the linear-only scale-delta contract.
Public enum values, defaults, compatibility aliases, and new projection capabilities remain undecided.

## Validation for a future implementation

The existing display tests cover kinds, caching, orientation, scale direction, DPR, clipping, and paint order.
Unit and lifecycle changes need additional cases for:

- Pixel position origin and orientation, without duplicate direction reversal.
- Direct and scale-backed diameters at multiple DPR values and after an in-place DPR change.
- Constant canvas size versus constant CSS size, with explicit refresh expectations.
- Independent bar fill and stroke, including null suppression and ordinary-style fallback.
- Shared descriptors across consumers with different preparation needs.
- Width intervals on linear and logarithmic scales, after their semantics are defined.
- Type rejection of unsupported units and callback return formats.

This document changes no runtime behavior and requires no bundle rebuild.
