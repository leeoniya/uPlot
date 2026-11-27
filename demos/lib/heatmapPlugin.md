# Update a heatmap with `setFrame(frame)`

Create one plugin instance per mode-2 plot. `fields` lists the distinct column names in `frame.data[1]`, in source order. The names stay fixed for that instance. The initial plot data can be `null`. Call `setFrame(frame)` only while the plot is mounted.

```js
import { heatmapPlugin } from './lib/heatmapPlugin.js';

const fields = ['xMax', 'yMin', 'yMax', 'count'];
const colors = ['steelblue', 'gold'];
const heatmap = heatmapPlugin({ fields, colors });
const u = new uPlot({
  mode: 2, width: 600, height: 320,
  legend: { show: false }, series: [{}, {}], plugins: [heatmap],
}, null, host);

const frame = {
  data: [null, [[12, 16], [0, 1], [1, 2], [3, 8]]],
  grid: { x: { step: 2, extent: [10, 18] }, y: { extent: [0, 4] } },
};
heatmap.setFrame(frame);
```

With `fields`, use `setFrame` for every update, even if the column arrays stay the same. The constructor accepts initial columns with inferred geometry. To supply grid metadata, use `setFrame`. It calls `u.setData(frame.data)` once, synchronously. No separate redraw is necessary. Without `fields`, update the legacy plot directly with `u.setData(data)`.

`u.data` keeps the original columns in field order. `onHover(u, i)` receives the source index, or `null` for no hit.

The plugin and adapters trust the producer to meet the contracts below. Validate untrusted input before passing it to either one. Malformed input has no guaranteed result: the plugin need not throw or keep the previous frame on screen.

## Grafana frame adapters

`heatmapRows()` and `heatmapCells()` take raw Grafana columns as ordinary JSON arrays of equal length. Time columns use one time grid. A timestamp can skip empty intervals. If the producer supplies `config.interval`, the adapters use that positive interval in milliseconds. Otherwise, they need at least two distinct timestamps and use the smallest observed gap between them. A gap can hide empty intervals, so producers that know the interval must supply it.

- **Rows:** X can contain increasing timestamps or category names. The Y fields define the row order, including empty rows. For numeric bounds, use `le` throughout for upper edges or `ge` throughout for lower edges. Both use increasing numeric order. By default, `le` adds `-Inf` before the first label, and `ge` adds `+Inf` after the last. Without bound labels, the adapter uses field names as centered categories.
- **Cells:** Cells with the same timestamp form one run. Timestamps increase between runs. Within a run, Y buckets increase strictly, without duplicates or overlap. A run can omit buckets. Unranked sparse cells contain only finite, positive counts.
- **Ordinal cells:** Each bucket spans adjacent edges from a common set. Bounds represent `(lo, hi]`, with `null` for an open end. This requires `yLayout` 0, or 3 with an open lower end, if the frame includes `yLayout`. The adapter collects distinct edges across all timestamps, even from empty cells, before it assigns row indices.

In raw row and ordinal-cell frames, only positive counts produce cells. Zero and `null` counts leave gaps. Neither the adapters nor `setFrame()` sort cells or check each cell for order and alignment.

Row and ordinal-cell adapters return `time` for the X scale, not a `scales` object. After `setFrame()`, the plot's scale scanners return the outer bucket bounds. A raw `grid.x.extent` can describe anchors rather than outer bounds.

## Fields and grid metadata

Each axis takes a center (`x` or `y`), a lower edge (`xMin` or `yMin`), an upper edge (`xMax` or `yMax`), or both edges. The axes can use different forms. For example, `['count', 'yMax', 'xMin']` supplies counts, upper Y edges, and lower X edges in that order. `count` is mandatory. Supply `frame.data` as `[null, columns]`. All columns must have the same length. Cells in one X run have exactly equal X anchors. X increases between runs, and Y increases strictly within each run. Each grid location has at most one cell. Missing rows and empty columns are valid. Every coordinate and count must be a finite JavaScript number. Counts must be positive. Both ordinary arrays of numbers and number-valued typed arrays are valid. To represent a gap, omit the cell instead of supplying `null`, `undefined`, `NaN`, or an array hole.

With `fields`, supply grid geometry on the frame, not in the plugin options. Both axes must have uniform, positive steps with finite reciprocals and distinct, finite outer edges. Extents must align to the grid and contain the occupied cells. The full grid, including empty bins, must fit within `2**24` cells.

`grid.x` and `grid.y` describe **this frame only**. Omitted metadata never carries over from the previous frame. Without an extent or categories, the plugin uses the occupied range. It reads the X endpoints and the first and last Y bucket in each X run. An empty axis without an extent returns `[null, null]`. The scale ranges use outer cell edges:

| Fields on one axis | Cell width | Meaning of `extent` |
| --- | --- | --- |
| One anchor (center, lower edge, or upper edge) | Explicit `step`, or the smallest positive gap between distinct anchors | First and last **anchors**, inclusive. The scan extends each endpoint to its outer cell edge. |
| Both edges (`Min` and `Max`) | Width from the edge pair. All widths must match. Do not supply `step`. | Outer **edges**. The scan does not add a cell. |

In the example, the first possible `xMax` is `10`, so the X scan returns `[8, 18]`. The Y scan returns `[0, 4]`. The plot’s range policy can expand these bounds.

On a numeric axis, a single distinct anchor needs an explicit `step`, even with an extent. Without a Y step, the plugin must combine anchors from different X runs to find the smallest observed gap. Sparse anchors can hide a smaller step, and observations cannot reveal missing bins at either end. For a known sparse grid, supply `step` for each single-anchor axis and `extent` for missing end bins. For a centered category axis, `categories` supplies the ordered string labels instead of an extent. Coordinates are zero-based label indices with unit width. The plugin places ticks at these indices and updates their labels. Explicit axis splits and label formatters take precedence.

Frames support uniform linear grids only. For log, asinh, or signed exponential buckets, use the [legacy plugin options](../heatmap-cells.js) (`xSize` and `grid`, without `fields`). The [aggregation example](../heatmap-aggregation.js) passes the result of `aggregateHeatmap()` directly to `setFrame()`.

## Display options

- `cellGap` and `zeroHeight` take finite, nonnegative sizes in CSS pixels. Each accepts a number or a function of the plot that returns a number.
- `colors` takes a nonempty array of CSS color strings. `colorScale` takes `linear`, `sqrt`, `cbrt`, or `log`. Both options also accept a function of the plot. Return a new array when the colors change.
- `colorDomain` takes `[min, max]`. Use finite endpoints in ascending order, or `null` to infer an endpoint from the counts. Equal endpoints or a single color produce a solid legend.
  - For a nonconstant log domain with multiple colors, `min` must be positive. The relative span `r = (max - min) / min` and `Math.expm1(Math.log1p(r))` must both be finite.
  - For nonconstant linear, square-root, and cube-root scales with multiple colors, both `max - min` and the [lookup multiplier](../../docs/investigations/heatmap-color-luts.md#definitions-and-existing-exact-modes) must be finite.
