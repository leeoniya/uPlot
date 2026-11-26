# Update a heatmap with `setFrame(frame)`

Create one plugin instance per mode-2 plot. `fields` names the columns in `frame.data[1]`, in order, and stays fixed for that instance. Once the plot mounts, call `setFrame(frame)` on the plugin, without a plot argument. The initial plot data can be `null`. Calls before mount or after `u.destroy()` throw.

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

Use `setFrame` for every data update, even when you reuse the column arrays. Each valid call makes one synchronous `u.setData(frame.data)` call. No separate redraw is necessary. `u.data` remains the original frame data in field order. `onHover(u, i)` receives the source index (`u.data[1][3][i]` is the count here), or `null` for no hit. `setFrame()` checks the frame shape, grid metadata, and grid size before it calls `setData()`. If these checks fail, the previous frame stays on screen. The plugin trusts the producer to supply valid cells. It does not guarantee rejection or preserve the previous frame for malformed cell values.

## Grafana frame adapters

`heatmapRows()` and `heatmapCells()` trust the producer to supply equal-length columns on one time grid. A timestamp can skip empty intervals. If the producer supplies `config.interval`, the adapters use it without checking each timestamp. Otherwise, they use the smallest positive gap between timestamps. A gap can hide empty intervals, so producers that know the interval must supply it.

- **Rows:** Timestamps increase strictly. The Y fields define the row order, including empty rows. The producer supplies `le` or `ge` fields in increasing numeric order. The adapter keeps their labels and counts in that order. In raw row and ordinal-cell frames, only positive counts produce cells. Zero and `null` counts leave gaps.
- **Cells:** Cells with the same timestamp form one run. Timestamps increase between runs. Within a run, Y buckets increase strictly, without duplicates or overlap. A run can omit buckets. Unranked sparse cells contain only finite, positive counts.
- **Ordinal cells:** Each bucket spans adjacent edges from a common set. Bounds represent `(lo, hi]`, with `null` for an open end. This requires `yLayout` 0, or 3 with an open lower end, if the frame includes `yLayout`. The adapter collects distinct edges across all timestamps, even from empty cells, before it assigns row indices.

Neither the adapters nor `setFrame()` sort cells or check each cell for order and alignment.

## Fields and grid metadata

Each axis takes a center (`x` or `y`), a lower edge (`xMin` or `yMin`), an upper edge (`xMax` or `yMax`), or both edges. `count` is mandatory. The producer supplies equal-length numeric columns on a uniform grid. Cells in one X run have exactly equal X anchors. X increases between runs, and Y increases strictly within each run. Each grid location has at most one cell. Missing rows and empty columns are valid. Every coordinate and count must be a finite JavaScript number. Counts must be positive. Numeric arrays and numeric typed arrays are both valid. To represent a gap, omit the cell instead of supplying `null`, `undefined`, `NaN`, or an array hole.

`grid.x` and `grid.y` describe **this frame only**. Omitted metadata never carries over from the previous frame. Without an extent or categories, the plugin uses the occupied range. It reads the X endpoints and the first and last Y bucket in each X run. An empty axis without an extent returns `[null, null]`. The scale ranges use outer cell edges:

| Fields on one axis | Cell width | Meaning of `extent` |
| --- | --- | --- |
| One anchor (center, lower edge, or upper edge) | Explicit `step`, or the smallest positive gap between distinct anchors | First and last **anchors**, inclusive. The scan extends each endpoint to its outer cell edge. |
| Both edges (`Min` and `Max`) | Width from the edge pair. All widths must match. Do not supply `step`. | Outer **edges**. The scan does not add a cell. |

In the example, the first possible `xMax` is `10`, so the X scan returns `[8, 18]`. The Y scan returns `[0, 4]`. The plot’s range policy can expand these bounds.

On a numeric axis, a single distinct anchor needs an explicit `step`, even with an extent. Without a Y step, the plugin must combine anchors from different X runs to find the smallest observed gap. Sparse anchors can hide a smaller step, and observations cannot reveal missing bins at either end. For a known sparse grid, supply `step` for each single-anchor axis and `extent` for missing end bins. For a centered category axis, `categories` supplies the ordered labels instead of an extent. Coordinates are zero-based label indices with unit width. The plugin places ticks at these indices and updates their labels. Explicit axis splits and label formatters take precedence.

Frames support uniform linear grids only. For log, asinh, or signed exponential buckets, use the [legacy plugin options](../heatmap-cells.js) (`xSize` and `grid`, without `fields`). The [aggregation example](../heatmap-aggregation.js) passes the result of `aggregateHeatmap()` directly to `setFrame()`.
