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
Grouped charts give each visible series a separate slot. Stacked charts give each native stack group one shared slot.
Hidden series do not reserve slots. Multiple independent stack groups appear side by side.
Stack groups must include every value series, including hidden series. Mixed stacked and unstacked charts are not supported.
The plugin records series-to-group membership once during initialization, rather than searching the groups on each redraw.

Set `stack` on the uPlot options, not on the plugin:

```js
stack: {
  groups: [{ series: [1, 2], dir: 0 }],
  percent: false, // Set true for percent stacking.
}
```

Omit `stack` for grouped bars. Recreate the chart to change its stack configuration.
Native uPlot stacking supplies the cumulative values, per-point baselines, and percent normalization. The plugin does not transform the data.
The bar pathbuilder supplies the final rectangle bounds to the hover buffer through `each()`.
Original data and legend values remain unchanged.

With `dir: 0`, positive and negative values stack separately from zero.
Percent stacking normalizes each sign separately to `1` or `-1`. The numeric axis can format these fractions as percentages.
The demo sets percent bounds to `[0, 1]`, `[-1, 0]`, or `[-1, 1]`, according to the visible values.
Grouped and value-stacked modes retain the tick-aware soft-zero range.

`bars.size[0]` sets the initial group width as a fraction greater than `0` and at most `1` (default `0.6`).
Each group occupies this fraction of the plot dimension divided by the category count.
The same control applies to single-bar groups and stacked groups. At `1`, no gaps remain between category groups.

`barDistribution` accepts the same three distribution constants and applies them inside each group.
`barWidth` sets the fraction of the group width that all visible slots occupy together (default `1`).
Each bar or stack has width `groupWidth * barWidth / slotCount` within its category.
At `1`, the bars fill the group without gaps. Smaller fractions leave space for the selected distribution.
With one slot, `SPACE_BETWEEN` places it at the group start. The other modes center it.
Internal bar spacing does not change group centers, category ticks, or axis padding.
The maximum and minimum widths in `bars.size` still apply to each bar.
The plugin controls bar positions and widths through the distribution options. Custom `bars.disp` options are not supported.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `orientation` | `'vertical'` | Bar orientation: `'vertical'` or `'horizontal'`. |
| `distribution` | `SPACE_AROUND` (`2`) | Group distribution: `SPACE_BETWEEN` (`1`), `SPACE_AROUND` (`2`), or `SPACE_EVENLY` (`3`) from `distr.js`. |
| `barDistribution` | `SPACE_AROUND` (`2`) | Distribution of bars or stacks inside each category group, using the same constants. |
| `barWidth` | `1` | Fraction of each group occupied by its bars or stacks, greater than `0` and at most `1`. |
| `showValues` | `false` | Draw automatically sized bar values and value-stack totals. |
| `labelRotation` | `0` | A finite angle in degrees, from `-90` through `90`. Horizontal bars require `0`. |
| `maxLabelLength` | `null` | No truncation, or an integer of at least `1`. The limit includes the ellipsis character (`…`). |
| `ellipsis` | `'end'` | The ellipsis position: `'end'` or `'middle'`. |
| `inset` | `8` | The minimum outer padding and extra axis space, in CSS pixels. |
| `bars` | `{}` | Options for `uPlot.paths.bars()`, except `disp` and `each`, which the plugin supplies. |

Category labels come directly from `data[0]`. uPlot's ordinal scale assigns their numeric positions internally.
The plugin converts X values to strings for display. Null entries become empty strings.
The `setData` hook refreshes the displayed labels. Truncation does not change the original data or legend labels.

## Bar values

The **Show values** checkbox controls value labels without replacing the chart or data.
The `createBarValues()` helper in `demos/lib/barValues.js` adapts the sizing logic from `bars-values-autosize.html`.
It uses Arial at 10–25 CSS pixels and compact number formatting with up to three significant digits.

Grouped values appear outside the bar ends. Stacked values appear inside their segments.
Value stacks also show one accumulated total beyond the positive end and one beyond the negative end of each category stack.
Totals come from native cumulative endpoints in `u._data`, not a separate summation.
Percent stacks show segment shares from the native endpoints and baselines. They do not show totals.
Hidden series do not contribute labels or totals.

Stacked segment labels use black or white text, whichever gives greater contrast against the resolved solid fill.
The helper caches each series' contrast choice by resolved fill and series alpha.
A separate 1×1 canvas supplies the first sample when the series draws. Later draws sample again only when the fill or alpha changes.
Data updates, resizing, visibility changes, and pixel-ratio changes reuse the cached choice when the fill and alpha stay unchanged.
The calculation includes fill opacity and series alpha over a white plot background. Gradients and patterns use black text without sampling.
Grouped labels and stack totals remain black. Black and white labels draw in separate batches, with at most two text-color assignments.
Font and alpha assignments occur only when their values change. Label measurements and placement remain unchanged.

Font sizing reserves 20% of the bar thickness and a gap outside the bar ends.
Inside and outside labels each use a common font size. Labels that cannot fit at the minimum size are omitted.
Labels stay inside the plot. This feature does not expand explicit scale ranges or reserve additional layout space.

The helper shares number formatters across charts and measures text lazily at 25 CSS pixels × DPR.
It scales these metrics down for smaller labels without additional measurements. Ink placement is exact at the measurement size and approximate at smaller sizes.
Different values with the same formatted text share one metric object. Text metrics survive data, size, and visibility changes. DPR changes clear the caches.
Numeric lookups avoid repeated formatting and reset on data changes. Each cache holds at most 1,024 entries and clears when another entry exceeds this limit.
A reusable flat geometry buffer receives the final rectangles from the bar pathbuilder. The helper does not allocate rectangle objects per draw.
Zero-length segments contribute to totals without measurement of their inside labels. When values are disabled, the helper does not collect geometry or measure text.

## Bar hover

The `createBarHover()` closure in `demos/lib/barHover.js` owns a reusable rectangle buffer, lookup state, and pointer listeners.
The bar pathbuilder calls `each()` to store final bounds in a flat numeric buffer, grouped by category.
Each value series has a fixed buffer slot within each category. Hidden series and skipped bars leave zero-sized rectangles, which cannot produce a hit.
Redraws rebuild the bar paths and refill the buffer. The buffer grows only when the required capacity increases.

The lookup calculates the nearest category from the group centers and spacing.
It scans that category's series slots and checks the exact rectangle bounds.
If no rectangle contains the pointer, the lookup checks the nearest adjacent category for shared edges and distribution rounding.
The lookup checks at most two categories. Its cost depends on the total number of value series, not the number of categories.
Bars must stay within their assigned category regions. Width limits that extend bars across these regions are not supported by hover lookup.
The lookup scans series in reverse order so that shared edges select the last-drawn series.

Hover lookup works after a draw, without prior pointer entry or a spatial-index build.
Pointer entry and exit listeners track whether redraws must refresh a stationary cursor. The plugin removes these listeners on chart destruction.
After a hit, the helper converts the selected bounds to CSS pixels once.
The cursor highlight reuses one mutable hover object and one empty bounding box.
Only that bar supplies a Y legend value. Gaps do not select a nearby bar. Cursor crosshairs are disabled.
Hover bounds use CSS pixels and support both orientations and the chart's pixel ratio.

## Demo controls

The plugin owns label formatting, truncation, validation, rotation, layout, and measurement. It exposes demo methods through `_controls`.
The demo imports `createBarControls()` from `demos/lib/barControls.js` to connect these methods to its HTML form.
This helper reads form values, updates readouts, and attaches or removes event listeners. The plugin does not import or depend on it.

- `_controls.setShowValues(show)` changes value-label visibility. The argument must be a boolean. A changed value redraws the chart without recalculating axes.
- `_controls.setDistribution(mode)` changes the group distribution mode.
- `_controls.setGroupWidth(fraction)` changes the group width. The fraction must be greater than `0` and at most `1`.
  Both methods update the X range, bar paths, hover bounds, and label padding without replacing the chart or data.
- `_controls.setBarDistribution(mode)` changes the distribution inside each group.
- `_controls.setBarWidth(fraction)` changes the bar width. The fraction must be greater than `0` and at most `1`.
  Both methods update bar paths, value labels, and hover bounds without recalculating axes or replacing the chart or data.
- `_controls.setLabelRotation(degrees)` changes the angle. A new angle requests layout.
- `_controls.setLabelTruncation(maxLength, position)` changes truncation. The optional `position` retains the current ellipsis position.
  A change to the displayed labels requests layout. `null` disables truncation.
- `_controls.getLabelMetrics()` returns `{ label, width }` for the widest displayed X label after layout.
  The width is the unrotated text width in CSS pixels. Before measurement, the result is `{ label: '', width: 0 }`.

The methods are available before chart initialization. After chart destruction, they do not request redraws.
The former top-level methods (`_setLabelRotation`, `_setLabelTruncation`, and `_getLabelMetrics`) now belong to `_controls`, without their individual `_` prefixes.
Invalid orientations, distributions, widths, angles, lengths, or ellipsis positions throw `RangeError`.
A non-boolean `showValues` or `setShowValues()` argument throws `TypeError`.
The demo has separate distribution selectors and width sliders for groups and bars, plus a value-label toggle.
Both width sliders range from 1% to 100%. Bar width defaults to 100% to preserve the original gapless layout inside groups.
Orientation and stack changes preserve these values.
Data and size changes use the normal `u.setData(...)` and `u.setSize(...)` methods.

## Cleanup

`demo.destroy()` destroys the current chart, removes form listeners, and releases references to the chart, plugin, controls, and root element.
The plugin clears its hover buffer, label metrics, and value geometry. It also releases its references to stack groups and the native bar path builder.
Caller-owned data, stack groups, and bar options remain unchanged. Repeated destroy calls have no effect.
Orientation and stack rebuilds retain the data before they destroy the old chart.

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
