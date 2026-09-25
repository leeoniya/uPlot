# barChartPlugin

`barChartPlugin(options)` creates a uPlot plugin for vertical or horizontal bars.
It supports single-line category labels and single-line tick labels on linear numeric Y scales.
Multiple Y series appear side by side at each category. Native uPlot stack groups share a category position.

## Usage

Call the plugin factory once per chart. The returned plugin exposes its demo methods through `_controls` and does not modify the factory options.
Use these imports from a module in `demos/`. Load the usual uPlot CSS in the page.

```js
import uPlot from '../src/uPlot.js';
import { barChartPlugin } from './lib/barChartPlugin.js';

const bars = barChartPlugin({
  labelRotation: -30,
  maxLabelLength: 16,
  ellipsis: 'end',
  bars: { size: [0.6, 100] },
});
const u = new uPlot({
  width: 640,
  height: 360,
  series: [{}, { label: 'Sales', fill: 'royalblue' }],
  plugins: [bars],
}, [
  ['North America', 'Europe', 'Asia Pacific'],
  [24, 18, 32],
], document.body);

bars._controls.setLabelRotation(-45);
bars._controls.setLabelTruncation(12, 'middle');
bars._controls.setLabelTruncation(10); // Keeps 'middle'.
bars._controls.setLabelTruncation(null); // Disables truncation.

u.setData([
  ['North America', 'Europe', 'Asia Pacific', 'Other'],
  [28, 21, 35, 9],
]);
u.setSize({ width: 800, height: 400 });
// Read bars._controls.getLabelMetrics() in a draw or ready hook.
```

For horizontal bars, use `orientation: 'horizontal'`:

```js
barChartPlugin({
  orientation: 'horizontal',
  maxLabelLength: 20,
});
```

The data format stays `[categoryLabels, firstSeriesValues, secondSeriesValues, ...]`. Categories run from top to bottom on the left X axis.
The numeric Y axis runs horizontally along the bottom. The widest category label determines the left axis width before numeric tick selection.
Horizontal bars do not support label rotation. A nonzero `labelRotation` or `_controls.setLabelRotation()` argument throws `RangeError`.

## Grouping and stacking

The plugin uses `distr()` from the grouped-bars demo to distribute category widths inside the plot.
The `distribution` option accepts constants from `demos/lib/distr.js`:

- `SPACE_BETWEEN`: gaps appear only between groups. For multiple categories, the outer groups reach the plot edges unless bar-width limits apply.
- `SPACE_AROUND` (default): each plot edge has half the gap between groups.
- `SPACE_EVENLY`: the gaps between groups and at the plot edges are equal.

The X range expands to align ordinal ticks with the distributed group centers.
Outer padding credits the space inside the plot and reserves additional space for label overhang.
Each visible series gets a separate slot, except members of a native stack group, which share one slot.
Hidden series do not reserve slots. Multiple independent stack groups appear side by side.

Set `stack` on the uPlot options, not on the plugin:

```js
stack: {
  groups: [{ series: [1, 2], dir: 0 }],
  percent: false, // Set true for percent stacking.
}
```

Omit `stack` for grouped bars. Recreate the chart to change its stack configuration.
Native uPlot stacking supplies the cumulative values, per-point baselines, and percent normalization. The plugin does not transform the data.
The bar pathbuilder supplies the final rectangle bounds to the hover index through `each()`.
Original data and legend values remain unchanged.

With `dir: 0`, positive and negative values stack separately from zero.
Percent stacking normalizes each sign separately to `1` or `-1`. The numeric axis can format these fractions as percentages.
The demo sets percent bounds to `[0, 1]`, `[-1, 0]`, or `[-1, 1]`, according to the visible values.
Grouped and value-stacked modes retain the tick-aware soft-zero range.

`bars.size[0]` sets the initial group width as a fraction greater than `0` and at most `1` (default `0.6`).
Each group occupies this fraction of the plot dimension divided by the category count. Visible slots share the group width equally.
The same control applies to single-bar groups and stacked groups. At `1`, no distribution gaps remain.
The maximum and minimum widths in `bars.size` still apply to each bar.
Explicit `bars.disp.x0` and `bars.disp.size` override the distribution.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `orientation` | `'vertical'` | Bar orientation: `'vertical'` or `'horizontal'`. |
| `distribution` | `SPACE_AROUND` (`2`) | `SPACE_BETWEEN`, `SPACE_AROUND` (`2`), or `SPACE_EVENLY` (`3`) from `distr.js`. |
| `labelRotation` | `0` | A finite angle in degrees, from `-90` through `90`. Horizontal bars require `0`. |
| `maxLabelLength` | `null` | No truncation, or an integer of at least `1`. The limit includes the ellipsis character (`…`). |
| `ellipsis` | `'end'` | The ellipsis position: `'end'` or `'middle'`. |
| `inset` | `8` | The minimum outer padding and extra axis space, in CSS pixels. |
| `bars` | `{}` | Options for `uPlot.paths.bars()`, except `each`, which the plugin supplies for hover indexing. |

Category labels come directly from `data[0]`. uPlot's ordinal scale assigns their numeric positions internally.
The plugin converts X values to strings for display. Null entries become empty strings.
The `setData` hook refreshes the displayed labels. Truncation does not change the original data or legend labels.

## Bar hover

The `createBarHover()` closure in `demos/lib/barHover.js` owns the spatial index, lookup state, and pointer listeners.
It imports [Flatbush](https://github.com/leeoniya/flatbush/tree/leeoniya/smol) from `demos/lib/flatbush.js`.
The bar pathbuilder calls `each()` to add bounds directly to the index, without temporary rectangle arrays or per-bar metadata objects.
An internal offset table records the starting item ID for each indexed series. Hidden series do not occupy index slots.
The lookup uses these offsets to derive the series index and subtracts the series offset to obtain the data index.
Skipped bars within a series use zero-sized points at `(0, 0)` to preserve data indices. The search filter excludes these points.

A capturing `mouseenter` listener on `.u-over` calls `index.finish()` before non-capturing hover handlers.
Charts without mouse entry do not finish their index. Redraws replace the index and finish it only while the pointer remains inside.
Each index finishes at most once. The plugin removes its listeners on chart destruction.

Each chart reuses one search filter to select the last-drawn bar under the pointer.
After the search, the helper resolves the series and converts the winning bounds to CSS pixels once.
The cursor highlight reuses one mutable hover object and one empty bounding box.
Only that bar supplies a Y legend value. Gaps do not select a nearby bar. Cursor crosshairs are disabled.
Hover bounds use CSS pixels and support both orientations and the chart's pixel ratio.

## Demo controls

The plugin owns label formatting, truncation, validation, rotation, layout, and measurement. It exposes five methods through `_controls`.
The demo imports `createBarControls()` from `demos/lib/barControls.js` to connect these methods to its HTML form.
This helper reads form values, updates readouts, and attaches or removes event listeners. The plugin does not import or depend on it.

- `_controls.setDistribution(mode)` changes the distribution mode.
- `_controls.setGroupWidth(fraction)` changes the group width. The fraction must be greater than `0` and at most `1`.
  Both methods update the X range, bar paths, hover bounds, and label padding without replacing the chart or data.
- `_controls.setLabelRotation(degrees)` changes the angle. A new angle requests layout.
- `_controls.setLabelTruncation(maxLength, position)` changes truncation. The optional `position` retains the current ellipsis position.
  A change to the displayed labels requests layout. `null` disables truncation.
- `_controls.getLabelMetrics()` returns `{ label, width }` for the widest displayed X label after layout.
  The width is the unrotated text width in CSS pixels. Before measurement, the result is `{ label: '', width: 0 }`.

The methods are available before chart initialization. After chart destruction, they do not request redraws.
The former top-level methods (`_setLabelRotation`, `_setLabelTruncation`, and `_getLabelMetrics`) now belong to `_controls`, without their individual `_` prefixes.
Invalid orientations, distributions, widths, angles, lengths, or ellipsis positions throw `RangeError`.
The demo has a distribution selector and a group-width slider from 1% to 100%. Orientation and stack changes preserve both values.
Data and size changes use the normal `u.setData(...)` and `u.setSize(...)` methods.

## Layout and scope

The plugin manages ordinal X spacing and the full-category X range. It disables drag zoom.
Vertical bars use bottom-X/left-Y axes. Horizontal bars use left-X/bottom-Y axes with inverted scale orientations.
It manages primary axes `0` and `1`, padding, axis sizes, and bar paths for every Y series. It hides series points.
It preserves axis styles, fonts, Y-axis value formatters, and explicit series fills.
The Y scale defaults to `axis: 1` and soft-zero limits. `opts.scales.y` can override these defaults, except for orientation.
Tick-aware `axis: 1` ranging uses plot height for vertical numeric axes and available plot width for horizontal numeric axes.
Horizontal numeric axes default to `space: 100` CSS pixels. `opts.axes[1].space` can override this target spacing.
Fixed ranges and custom range functions retain standard ranging. Automatic label fitting is not implemented.
The plugin does not support general top-axis or custom-alignment layouts.

Text measurement uses one `OffscreenCanvas` per unique font, shared across axes within each plugin instance.
The plugin requires browser support for `OffscreenCanvas`.
Each context keeps its font. Measurement does not change the chart context.

The measurement cache depends on label text, axis font, and pixel ratio.
Rotation and size changes reuse text widths. Padding uses each label's width and position in the expanded scale to protect the chart edges.
Padding credits existing axis space and uses a conservative plot-width bound, not previous layout results, to avoid layout feedback.
