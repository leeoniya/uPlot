# barChartPlugin

`barChartPlugin(options)` creates a uPlot plugin for vertical or horizontal bars.
It supports single-line category labels and single-line tick labels on linear numeric Y scales.
Multiple Y series overlap at each category. The plugin does not arrange grouped or stacked bars.

## Usage

Call the plugin factory once per chart. Use a separate `controls` object for each chart.
Use these imports from a module in `demos/`. Load the usual uPlot CSS in the page.

```js
import uPlot from '../src/uPlot.js';
import { barChartPlugin } from './lib/barChartPlugin.js';

const controls = {};
const u = new uPlot({
  width: 640,
  height: 360,
  series: [{}, { label: 'Sales', fill: 'royalblue' }],
  plugins: [barChartPlugin({
    labelRotation: -30,
    maxLabelLength: 16,
    ellipsis: 'end',
    bars: { size: [0.6, 100] },
    controls,
  })],
}, [
  ['North America', 'Europe', 'Asia Pacific'],
  [24, 18, 32],
], document.body);

controls.setLabelRotation(-45);
controls.setLabelTruncation(12, 'middle');
controls.setLabelTruncation(10); // Keeps 'middle'.
controls.setLabelTruncation(null); // Disables truncation.

u.setData([
  ['North America', 'Europe', 'Asia Pacific', 'Other'],
  [28, 21, 35, 9],
]);
u.setSize({ width: 800, height: 400 });
// Read controls.getLabelMetrics() in a draw or ready hook.
```

For horizontal bars, use `orientation: 'horizontal'`:

```js
barChartPlugin({
  orientation: 'horizontal',
  maxLabelLength: 20,
  controls,
});
```

The data format stays `[categoryLabels, numericValues]`. Categories run from top to bottom on the left X axis.
The numeric Y axis runs horizontally along the bottom. The widest category label determines the left axis width before numeric tick selection.
Horizontal bars do not support label rotation. A nonzero `labelRotation` or `setLabelRotation()` argument throws `RangeError`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `orientation` | `'vertical'` | Bar orientation: `'vertical'` or `'horizontal'`. |
| `labelRotation` | `0` | A finite angle in degrees, from `-90` through `90`. Horizontal bars require `0`. |
| `maxLabelLength` | `null` | No truncation, or an integer of at least `1`. The limit includes the ellipsis character (`…`). |
| `ellipsis` | `'end'` | The ellipsis position: `'end'` or `'middle'`. |
| `inset` | `8` | The minimum outer padding and extra axis space, in CSS pixels. |
| `bars` | `{}` | Options that the plugin passes to `uPlot.paths.bars(bars)`. |
| `controls` | `{}` | An object that receives the methods below. |

Category labels come directly from `data[0]`. uPlot's ordinal scale assigns their numeric positions internally.
The plugin converts X values to strings for display. Null entries become empty strings.
The `setData` hook refreshes the displayed labels. Truncation does not change the original data or legend labels.

## Controls

- `setLabelRotation(degrees)` changes the angle. A new angle requests layout.
- `setLabelTruncation(maxLength, position)` changes truncation. The optional `position` retains the current ellipsis position.
  A change to the displayed labels requests layout. `null` disables truncation.
- `getLabelMetrics()` returns `{ label, width }` for the widest displayed X label after layout.
  The width is the unrotated text width in CSS pixels. Before measurement, the result is `{ label: '', width: 0 }`.

Invalid orientations, angles, lengths, or ellipsis positions throw `RangeError`.
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
Rotation and size changes reuse text widths. Padding uses a conservative plot-width bound, not previous layout results, to avoid layout feedback.
