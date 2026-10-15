# Scatter and bubble plugin

`scatterPlugin()` configures native point rendering for a mode-2 chart.
It disables connecting lines and optionally adds Flatbush hover selection.
The caller supplies data, scales, facets, styles, axes, and legend formatting.
Each chart needs a separate plugin instance.

## Uniform scatter points

This example belongs in a module under `demos/`:

```js
import uPlot from '../dist/uPlot.esm.js';
import { scatterPlugin } from './lib/scatterPlugin.js';

const chart = new uPlot({
  mode: 2,
  width: 600,
  height: 400,
  legend: {live: false},
  scales: {x: {time: false}},
  series: [null, {stroke: 'red', fill: 'red'}],
  plugins: [scatterPlugin({points: {size: 5, width: 0}})],
}, [null, [[1, 2, 3], [3, 1, 4]]], document.body);
```

## Configuration

- `points` supplies common `series.points` defaults. Per-series point configuration takes precedence, except for `points.paths`.
- `disp` passes native display descriptors to `uPlot.paths.points()`. It supports colors, CSS sizes, and scale-backed sizes.
- `hover` defaults to `false`. This setting adds no spatial index or hover hooks.
- With `hover: true`, the plugin supplies point selection, cursor marker sizes, and series focus.

The plugin owns `series.paths` and `series.points.paths` for the initial series.
It defaults `points.show` to `true` and point fill to the series fill.
Pixel alignment defaults to zero unless the chart or series specifies it.
The caller must set `mode: 2` before chart construction.

## Bubbles

This plugin configuration uses the third data column for size:

```js
scatterPlugin({
  hover: true,
  points: {width: 1},
  disp: {
    size: {
      scale: 'size',
      range: [1, 61],
      values: (u, seriesIdx) => u.data[seriesIdx][2],
    },
  },
});
```

The caller defines `scales.size` and binds the size column through `series.facets[2]`.
The [scatter demo](../scatter.html) uses a square-root scale so circle area is proportional to population.
Native `disp.size` clips bubbles strictly to the plot.
Native per-point painting preserves translucent overlaps.

## Hover lifecycle

The plugin reserves one Flatbush slot per data point in each visible series before drawing.
Drawn point bounds go directly into the index in absolute canvas coordinates.
Each hover query converts the CSS cursor position to canvas coordinates once.
Skipped points receive zero-sized `(0, 0, 0, 0)` placeholders, which cannot produce hover hits.
The point builder culls by center coordinates, not individual circle bounds.
For scale-backed `disp.size`, its center window extends beyond each plot edge by half the largest configured diameter.
This includes partially visible edge bubbles without changing the displayed scale ranges.
Strict plot clipping still applies, and hover selects only the visible portion inside the plot.

Per-series offsets map Flatbush IDs back to data indices.
There is no temporary bounds array or per-point ID map.
Custom point filters retain their index-array references, including their drawing order.
A filter can return at most as many entries as the series has data points.
Filter arrays must remain unchanged until the next draw.
The index includes placeholder slots, so its capacity depends on visible-series data lengths rather than the number of drawn points.
It defers `finish()` until plot entry, unless both cursor coordinates are already nonnegative.
A programmatic cursor update inside the plot also finishes a pending index.
The plugin refreshes selection after a redraw beneath a stationary pointer.
Chart destruction removes the entry listener and releases the index.

Selection compares circle diameters, then center distances, then paint order.
It prefers the smallest circle, then the closest center, then the last-painted point.
The retained hover state contains only the series index, data index, and diameter.
The plugin owns `cursor.dataIdx`, `cursor.points.size`, and `cursor.focus.dist` when hover is enabled.
Other cursor configuration and caller hooks remain available.
For hover markers without series dimming, the chart can set `cursor.focus: {prox: -1, alpha: 1}`.
