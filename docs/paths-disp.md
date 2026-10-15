# Bar and point display values

`uPlot.paths.bars({disp})` and `uPlot.paths.points({disp})` accept per-datapoint colors through `disp.fill` and `disp.stroke`.
Each color descriptor has this form:

```ts
{
  unit?: 3;
  kind?: uPlot.Series.BarsPathBuilderFacetKind;
  values(u, seriesIdx, idx0, idx1): uPlot.Series.PathBuilderColorValues;
}
```

The `kind` selects the return format, independently of `unit`:

| `kind` | Return format | Meaning |
| --- | --- | --- |
| `1` (Unary) | `T` | One value for the entire series |
| `2` (Discrete) | `[enum, idxs]` | Enum lookup by original data index |
| `3` (Continuous), or omitted | `ArrayLike<T>` | One value per original data index |

Colors, point sizes, and bar `x0`, `y0`, and `y1` use this contract.
Bar `size` supports only Unary.
The builders select readers once per rebuild, without return-shape checks or per-value kind checks.
Unary values do not require data-length arrays.
Colors accept CSS color strings, `CanvasGradient`, and `CanvasPattern`.
A `null` or `undefined` color suppresses that channel for the datapoint.
Points use their normal style for an omitted color descriptor.
Bars retain the existing color-channel rule: `disp.fill` requires `disp.stroke` when the series has a nonzero stroke width.

The types accept readonly color arrays and other `ArrayLike` color collections.
Bar and point colors use `PathBuilderColorFacet`, whose return type depends on `kind`.
The former `{palette, indices}` return shape is no longer supported.

## Color arrays

Each array entry corresponds to the original data index, not the visible range.
This example assigns three bar fills and suppresses the second fill:

```js
const fills = ["#4677cc", null, "#cc6644"];
const fill = {
  values: (u, seriesIdx, idx0, idx1) => fills,
};

const barSeries = {
  width: 0,
  paths: uPlot.paths.bars({disp: {fill}}),
  points: {show: false},
};
```

The same descriptor works with `uPlot.paths.points({disp: {fill}})`.
`disp.stroke` accepts the same formats as `disp.fill`.

## Discrete values

The generic `PathBuilderDiscreteValues<T>` type defines the tuple as `[enum: readonly T[], idxs: ArrayLike<number>]`.
For colors, the enum is a palette of colors, `null`, or `undefined`.
The indices correspond to original data indices and can use ordinary or typed arrays.
The cache retains the tuple without conversion or copying.
The descriptor requires `kind: 2`.

```js
const colors = [
  ["#4677cc", "#cc6644", null, "#4677cc"],
  new Uint8Array([0, 1, 2, 3, 9]),
];

const fill = {
  unit: 3,
  kind: 2,
  values: (u, seriesIdx, idx0, idx1) => colors,
};

const barPaths = uPlot.paths.bars({disp: {fill}});
```

Index `2` selects `null`, so that datapoint has no fill.
Index `9` is outside the palette.
The palette lookup returns `undefined`, so that datapoint also has no fill.
For bars, palette entries `0` and `3` contain the same color and share one `Path2D`.
Points with `disp` do not group colors into shared paths.
Point sizes and bar `x0`, `y0`, and `y1` accept the same tuple format with numeric enum values.
Bar Y endpoints also retain their null semantics: null `y1` skips a bar, and nullish `y0` means zero.
Discrete indices must select valid numeric entries for point sizes and bar X positions.

## Bar gaps

The bar builder accepts a CSS-pixel `gap` as a number or a `[leading, trailing]` tuple.
A number is equivalent to `[0, gap]` and preserves existing placement.
Both gaps reduce the bar width.

For `align: 1` or `-1`, the leading gap insets the anchored edge, and the trailing gap insets the opposite edge.
These sides follow the bar direction, including reversed and rotated scales.
With `align: 0`, bars remain centered and use the sum of both gaps.
Size-based spacing retains its existing alignment.

For histogram buckets, equal gaps inset both edges without custom `disp` geometry:

```js
const barPaths = uPlot.paths.bars({
  align: 1,
  size: [1, Infinity],
  gap: [1.5, 1.5],
});
```

## Bar geometry units

Bar `disp.size` requires `kind: 1` and a scalar return:

```js
const disp = {
  x0: {unit: 2, values: () => [0.1, 0.4, 0.7]},
  size: {kind: 1, unit: 2, values: () => 0.2},
};
```

Previous width callbacks that returned `[width]` must now return `width` and specify `kind: 1`.
Variable bar widths are not supported yet.
A source TODO covers variable widths, including position-dependent widths on logarithmic X scales.

Bar `disp.x0` positions and `disp.size` widths have independent units.
`unit: 1` supplies scale values. `unit: 2` supplies fractions of the plot dimension along the X scale.

For fractional positions, the builder calculates `offset + fraction * dimension` directly.
It uses that projection for bar positions and column-spacing calculations.
It does not create a converted position array or call the inverse scale transform.
Fractions refer to physical plot coordinates, so the X scale transform does not change them.

Scale-value positions still use the ordinary scale projection.
Scale-value widths retain the existing linear-scale assumption and use the difference between the projected width value and zero.
Bar geometry callbacks still run on each path rebuild.
The `x0` and `size` descriptors work together.
The `y0` and `y1` descriptors work together and always supply Y-scale values.
Native stack baselines and fill bands take precedence over these Y descriptors.

## Point sizes and bounds

Point options accept `disp.fill`, `disp.stroke`, `disp.size`, and `each`.
They do not add `disp.x` or `disp.y` channels.
Point positions still come from the series data.

Assign the point builder to `series.points.paths`, not `series.paths`.

The point builder reads the `series.points` options.

For direct CSS sizes, the size descriptor accepts `unit?: 3` and any of the three kinds.
Each size is the outer diameter in CSS pixels, including the stroke.

```js
const uniformSize = {kind: 1, values: () => 12};
const discreteSize = {kind: 2, values: () => [[8, 14, 20], new Uint8Array([0, 2, 1, 2])]};
const continuousSize = {kind: 3, values: () => new Float32Array([8, 20, 14, 20])};
```
Each returned entry must be a finite number.
A diameter no greater than the configured stroke width skips the point.
Without a size descriptor, points use the normal `series.points.size`.

The stroke width remains `series.points.width` for all points in the series.
There is no per-point stroke width.

With `disp.size`, the builder clips fills and strokes strictly to the plot rectangle.
This rule applies to direct CSS sizes and scale-backed sizes, even when all returned sizes are equal.
Stroke pixel alignment does not move the clip boundary.
Without `disp.size`, uniform markers retain the expanded clip that lets edge markers extend beyond the plot.
Color-only `disp` also retains this expanded clip.

The `each(u, seriesIdx, idx, left, top, width, height)` callback reports each drawn point during a point builder call.
The bounds use canvas coordinates and include the stroke.
For partially visible points, `each` reports the full bounds, not their intersection with the plot.
For scale-backed `disp.size`, the builder expands the center-culling window by `disp.size.range[1] / 2` CSS pixels on each side.
This includes bubbles with centers just outside the plot, while strict clipping hides their outside portions.
The builder compares mapped centers, including pixel alignment, so nonlinear scales and reversed axes use the same pixel margin.
This window does not change the displayed scale ranges.
Uniform markers, color-only `disp`, and direct CSS sizes still skip centers outside the X or Y scale range.
Points with centers exactly on a scale boundary remain eligible.
The callback has the same arguments as the bar `each` callback.
These bounds support a spatial index for hit detection.

```js
const bounds = new Map();
const diameters = new Float32Array([8, 14, 20]);
const fill = {
  values: () => ["#4677cc", "#cc6644", "#4677cc"],
};

const pointPaths = uPlot.paths.points({
  disp: {
    fill,
    size: {values: () => diameters},
  },
  each: (u, seriesIdx, idx, left, top, width, height) => {
    bounds.set(idx, {left, top, width, height});
  },
});

const pointSeries = {
  paths: () => null,
  points: {
    show: true,
    width: 2,
    stroke: "#222",
    paths: (u, seriesIdx, idx0, idx1, filtIdxs) => {
      bounds.clear();
      return pointPaths(u, seriesIdx, idx0, idx1, filtIdxs);
    },
  },
};
```

This example uses one point series and three datapoints.
The wrapper removes stale bounds before each point builder call.
With `disp`, that call draws the points immediately and returns `null`.
An application can replace the map with its spatial index.

## Scale-backed point sizes

A size descriptor can reference a native scale instead of returning CSS diameters.
Its `values` callback returns raw scale values in the format that `kind` selects.
For Discrete sizes, the enum contains raw scale values, not CSS diameters.
The builder still transforms each included point's selected value during each draw.
Its `range` gives the CSS outer diameters at the scale minimum and maximum.
The scale uses its normal distribution, including custom `fwd` and `bwd` transforms.

This mode-2 configuration shares a population scale across all participating series:

```js
const bubblePaths = uPlot.paths.points({
  disp: {
    size: {
      scale: 'size',
      range: [1, 61],
      values: (u, seriesIdx) => u.data[seriesIdx][2],
    },
  },
});

const sizeScale = {
  time: false,
  distr: 100,
  fwd: Math.sqrt,
  bwd: v => v * v,
  range: (u, min, max) => [0, max > 0 ? max : 1],
};

const bubbleSeries = {
  facets: [{scale: 'x'}, {scale: 'y'}, {scale: 'size'}],
  paths: () => null,
  points: {show: true, width: 1, paths: bubblePaths},
};
```

Here, `sizeScale` belongs in `options.scales.size`.
Each bubble series uses the third data column for population and binds that column to the `size` facet.
The native scanner finds the shared domain across visible series.
The `values` callback alone does not bind data to a scale for scanning.
In mode 1, a size scale can use an explicit domain or a custom scanner.

The zero-based square-root transform makes circle area proportional to population.
The diameter range includes the 1px outline, so circle diameters span 0–60 CSS pixels before the outline.
A zero population produces no point because its outer diameter equals the stroke width.
The domain fallback avoids division by zero for empty or all-zero data.

The builder maps each raw value through `scale.valToPct()` and clamps the fraction to `[0, 1]`.
It interpolates between the two diameter limits, independently of plot dimensions, scale direction, and scale orientation.
The diameter limits use ascending order: `[minDiameter, maxDiameter]`.
Each returned raw size must be a finite number. Null and undefined sizes are unsupported.
Numeric data, display sizes, and transform results must be finite.
Values must be within the domain of each transform, and options must be valid.
The drawing loops do not validate these inputs.

The descriptor accepts `unit: 1`, or no `unit`, for scale values.
Scale changes update diameters without another `values` call.
Resize and position-scale changes preserve the CSS diameter mapping unless they also change the size domain.
Native autoscaling excludes hidden series, so visibility changes can change bubble sizes.

## Cache contract

Each series owns a display cache keyed by descriptor identity.
Core lifecycle operations clear this cache when `setData()` replaces the raw data object or when series insertion or deletion changes indices.
Descriptors and their callbacks must remain stable after construction.
The cache does not detect changes to descriptor properties or callback identity.
Color and point-size callbacks evaluate the full series range, with `idx0 = 0` and `idx1 = N - 1`.
Here, `N` is the number of datapoints in the series.
The returned collections use original data indices.

A `setData()` call with a new data object refreshes the values on the next path rebuild.
Resize, scale changes, redraws, and `setData()` with the same data object reuse cached values.
Direct assignment to `u.data` does not invalidate the cache.
For scale-backed sizes, the cache retains raw values, not the final CSS diameters.
The builder applies the current size scale during each draw, after center culling.
Culled points do not require size lookup or mapping.
The builder calculates full callback bounds only when `each` exists.
In-place changes to the data, returned arrays, palettes, or indices do not request a refresh.
Bar geometry callbacks still evaluate on every path rebuild.

Callbacks can read mutable application state without callback replacement.
Changes to that state alone do not invalidate cached colors or point sizes.
A later data replacement evaluates the same callbacks with the current state.

`u.clearCache({paths: true})` does not discard cached display values.
Data disposal and plot destruction release the display cache.

**CAUTION:** Do not use `u.clearCache({data: true})` to refresh display values.
That call disposes the source data.

## Paint order and overlap

The bar builder groups matching colors into shared paths, including duplicate colors in a palette.
Bar color batches can change draw order and the alpha result where same-color bars overlap.
They do not guarantee the result of separate paint calls for each bar.

With `disp`, the point builder draws each point immediately in data order.
It makes one fill call, then one stroke call, for each point with both channels enabled.
A suppressed channel has no paint call.
There is no color batching for these points, even with an indexed palette.
This preserves per-point alpha accumulation at overlaps and the data-order paint sequence.
The builder returns `null`, not a path or a color map.

Without `disp`, the default point builder retains its original single-path behavior.
