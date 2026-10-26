# barChartPlugin

`barChartPlugin(options)` creates a uPlot plugin for vertical or horizontal bars.
Core sizes the category labels and tick labels on linear numeric Y scales.
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
The numeric Y axis runs horizontally along the bottom. Core selects its ticks before final category measurements determine the left axis width.
Horizontal bars do not support label rotation. A nonzero `labelRotation` or `_controls.setLabelRotation()` argument throws `RangeError`.

## Grouping and stacking

The plugin uses `distr()` from `demos/lib/distr.js` to distribute category widths inside the plot.
The `distribution` option accepts constants from `demos/lib/distr.js`:

- `SPACE_BETWEEN`: gaps appear only between groups. For multiple categories, the outer groups reach the plot edges unless bar-width limits apply.
- `SPACE_AROUND` (default): each plot edge has half the gap between groups.
- `SPACE_EVENLY`: the gaps between groups and at the plot edges are equal.

The X range expands to align ordinal ticks with the distributed group centers.
Outer padding credits the space inside the plot and reserves additional space for label overhang.
Grouped charts give each visible component series a separate slot. Stacked charts give each native stack group one shared slot.
Hidden series do not reserve slots. Multiple independent stack groups appear side by side.
Stack groups must include every bar series, including hidden series, but must exclude ignored series. Mixed stacked and unstacked bars are not supported.
The plugin records series-to-group membership once during initialization, rather than searching the groups on each redraw.
Each layout calculates the category distribution once and the inner slot distribution once, then fills the per-slot offset arrays.
This avoids repeated slot-distribution calculations inside the category loop. It does not add a layout cache.

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
The plugin controls bar positions and widths through the distribution options. Custom `bars.disp` options support only `fill` and `stroke`.

## Group-wide series and external totals

The `groupSeries` option lists value-series indices that span the full category group instead of reserving individual bar slots.
These series use a second bar path builder with the group offsets and widths. They require stacking to be off.
The plugin preserves native series order. Put group-wide series before the component series to draw them behind the components.

Group distribution and group width control their geometry. Individual bar distribution, bar width, `bars.gap`, and bar-width limits do not shrink them.
Both orientations, normal autoscaling, and native legend toggles apply to group-wide series.
Bar hover selects the last-drawn rectangle under the pointer, so foreground components take priority over background totals.
Group hover shows values for all visible series, including totals.

`withBarTotals()` in `demos/lib/barTotals.js` calculates positive and negative totals outside the plugin and uPlot core.
It accepts `[categories, ...components]` and returns `[categories, positiveTotals, negativeTotals, ...components]`.
Only finite nonzero values contribute. Each absent sign produces `null`, rather than a zero bar.
The helper creates new total arrays and a new outer array without changing the original columns.

```js
import { withBarTotals } from './lib/barTotals.js';

const raw = [['A', 'B', 'C'], [4, -3, 2], [6, -5, -1]];
const bars = barChartPlugin({ groupSeries: [1, 2], showValues: true });
const u = new uPlot({
  width: 800,
  height: 450,
  series: [
    { label: 'Item' },
    { label: 'Positive total', fill: 'lightgray' },
    { label: 'Negative total', fill: 'silver' },
    { label: 'Value', fill: 'royalblue' },
    { label: 'Other value', fill: 'darkorange' },
  ],
  plugins: [bars],
}, withBarTotals(raw), document.body);

// Supply all five columns on each update.
u.setData(withBarTotals(raw));

// Optional visibility uses raw series indices; index 0 is unused.
// Omitted entries mean visible. Here only the second component contributes.
const visible = [true, false, true];
u.setData(withBarTotals(raw, visible));
```

The visibility argument controls calculation only. It does not change `u.series[].show`.
The plugin never derives or modifies supplied totals. A direct `u.setData()` call must include the total columns.
Recalculate totals before `setData()` when component data or visibility changes. Resizing and hover do not require new totals.

The demo performs this preparation on initialization, data randomization, and component visibility changes.
Its **Show group totals** checkbox rebuilds the chart with or without the two total series.
Normal and Percent stacking omit these series and disable the checkbox, but preserve its checked state for a return to Off.
Orientation changes preserve component and total visibility. Copy-link URLs continue to describe only the original component data.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `orientation` | `'vertical'` | Bar orientation: `'vertical'` or `'horizontal'`. |
| `distribution` | `SPACE_AROUND` (`2`) | Group distribution: `SPACE_BETWEEN` (`1`), `SPACE_AROUND` (`2`), or `SPACE_EVENLY` (`3`) from `distr.js`. |
| `barDistribution` | `SPACE_AROUND` (`2`) | Distribution of bars or stacks inside each category group, using the same constants. |
| `barWidth` | `1` | Fraction of each group occupied by its bars or stacks, greater than `0` and at most `1`. |
| `groupSeries` | `[]` | Unique bar-series indices that span the full group width without taking component slots. Not supported with stack groups. |
| `ignore` | `[]` | Ordered, contiguous indices of trailing non-bar series. For example, `[3, 4]` excludes the last two of four value series. |
| `showValues` | `false` | Draw automatically sized bar values and value-stack totals. |
| `hoverMode` | `'bar'` | Select an individual bar (`'bar'`) or an entire category (`'group'`). |
| `labelRotation` | `0` | A finite angle in degrees, from `-90` through `90`. Horizontal bars require `0`. |
| `minLabelSpacing` | `0` | Target minimum spacing for category tick selection in CSS pixels. Any finite nonnegative number is valid. Zero shows every label. |
| `maxLabelLength` | `null` | No truncation, or an integer of at least `1`. The limit includes the ellipsis character (`…`). |
| `ellipsis` | `'end'` | The ellipsis position: `'end'` or `'middle'`. |
| `inset` | `8` | The minimum outer padding in CSS pixels. Axis sizes do not include this padding. |
| `bars` | `{}` | Options for `uPlot.paths.bars()`. Custom `disp` accepts only `fill` and `stroke`. The plugin supplies positions, widths, and `each`. |

Ignored series retain their paths and point options. They do not occupy bar slots or participate in bar labels and hover selection.
All bar series must precede ignored series. An `ignore` list cannot contain gaps or include indices from `groupSeries` or stack groups.

Category labels come directly from `data[0]`. uPlot's ordinal scale assigns their numeric positions internally.
The plugin converts X values to strings for display. Null entries become empty strings.
The axis formatter truncates the selected raw category values. Truncation does not change the original data or legend labels.

## Category label density

The **Min spacing** slider ranges from 0 to 300 CSS pixels in steps of 5. Its default is 0.
The plugin supplies `axis.space` and category `axis.splits`. Core selects the increment, and the plugin returns integer category positions within the scale range.
Zero spacing selects every valid category. Blank category values remain visible empty strings.
The selected increment determines which category ticks, grid lines, and labels appear. Unselected categories do not produce hidden label entries.

The spacing applies along plot width for vertical bars and plot height for horizontal bars.

With an automatic horizontal axis, core selects all horizontal ticks once from a provisional plot width, then sizes all horizontal axes together.
The provisional width reserves explicit numeric vertical axis widths. Automatic vertical axes and vertical axes with size callbacks reserve 50px each.
These reservations also include axis titles. Core keeps the selected horizontal ticks through the rest of layout.

The final center-to-center spacing can differ from the requested spacing.
Resize, data, and group-layout changes recalculate the selection. Hover does not recalculate the selection.

In this early path, horizontal size callbacks run after tick selection and still receive `values: null`.
Early tick callbacks cannot depend on a newly calculated provisional height or fixed horizontal axis allocations.
Without an automatic horizontal axis, layout order does not change.

Core measures only selected labels. A different selection can change axis sizes, padding, and plot geometry.
The category data, hover behavior, and legend values remain unchanged.
This setting controls label density, not text overlap. Long labels can still overlap at small spacing values.

## Bar values

The **Show values** checkbox controls value labels without replacing the chart or data.
The `createBarValues()` helper in `demos/lib/barValues.js` adapts the sizing logic from `bars-values-autosize.html`.
It uses Arial at 10–25 CSS pixels and compact number formatting with up to three significant digits.

Grouped values appear outside the bar ends. Stacked values appear inside their segments.
Group-wide series use the same outside placement, centered across the group.
When a visible group-wide series has the same nonzero raw value at that category, the helper omits the component label.
This prevents duplicates and keeps the wider, group-centered label, even when the component is too narrow for its label.
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

In bar mode, the lookup calculates the nearest category from the group centers and spacing.
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

Group mode selects the nearest category anywhere inside the plot, including gaps between bars and the outer margins.
The legend shows that category's values for all visible series. Individual bar highlights remain hidden.
One `.u-bar-group-hover` element in `u.under` highlights the category behind the canvas without changing bar colors or value labels.
The band spans the plot height for vertical bars or the plot width for horizontal bars.
Midpoints between category centers define its bounds. The outer bounds stop at the plot edges, and a single category fills the plot.

The band appears only while the pointer is inside the plot and a category is selected.
Empty data or charts with no visible value series hide the band. Categories with missing or zero values remain selectable.
Pointer movement updates the band without a canvas redraw. Unchanged bounds and visibility cause no style writes.
Layout changes refresh the band even when the selected category stays the same. Chart destruction removes the band and pointer listeners.

## Demo controls

The plugin owns category formatting, truncation, validation, and rotation. Core owns axis sizing, label measurement, and overflow padding.
The plugin exposes demo methods through `_controls`.
The demo imports `createBarControls()` from `demos/lib/barControls.js` to connect these methods to its HTML form.
This helper reads form values, updates readouts, and attaches or removes event listeners. The plugin does not import or depend on it.

- `_controls.setShowValues(show)` changes value-label visibility. The argument must be a boolean. A changed value redraws the chart without recalculating axes.
- `_controls.setHoverMode(mode)` switches between `'bar'` and `'group'`. It refreshes the selection and legend without a canvas redraw or chart rebuild.
- `_controls.setDistribution(mode)` changes the group distribution mode.
- `_controls.setGroupWidth(fraction)` changes the group width. The fraction must be greater than `0` and at most `1`.
  Both methods update the X range, bar paths, hover bounds, and label padding without replacing the chart or data.
- `_controls.setBarDistribution(mode)` changes the distribution inside each group.
- `_controls.setBarWidth(fraction)` changes the bar width. The fraction must be greater than `0` and at most `1`.
  Both methods update bar paths, value labels, and hover bounds without recalculating axes or replacing the chart or data.
- `_controls.setLabelRotation(degrees)` changes the angle. A new angle requests layout.
- `_controls.setMinLabelSpacing(pixels)` changes category label density without rebuilding the chart. A changed value requests layout and redraw.
- `_controls.setLabelTruncation(maxLength, position)` changes truncation. The optional `position` retains the current ellipsis position.
  A change to either setting requests layout, even if the displayed labels do not change.
  Repeated settings do not request a redraw. Both `null` and `undefined` disable truncation.
- `_controls.getLabelMetrics()` returns `{ label, width }` for the widest selected X label after layout.
  It reads core's cached widths and uses the widest line for multiline labels.
  The width is the unrotated text width in CSS pixels. Before measurement, the result is `{ label: '', width: 0 }`.

The methods are available before chart initialization. After chart destruction, they do not request redraws.
The former top-level methods (`_setLabelRotation`, `_setLabelTruncation`, and `_getLabelMetrics`) now belong to `_controls`, without their individual `_` prefixes.
Invalid orientations, hover modes, distributions, widths, angles, label spacings, lengths, or ellipsis positions throw `RangeError`.
A non-boolean `showValues` or `setShowValues()` argument throws `TypeError`.
A non-array `groupSeries` throws `TypeError`. Duplicate or invalid indices and combinations with stack groups throw `RangeError`.
The demo has separate distribution selectors and width sliders for groups and bars, plus a value-label toggle and Bar/Group hover radios.
Both width sliders range from 1% to 100%. Bar width defaults to 100% to preserve the original gapless layout inside groups.
Orientation and stack changes preserve these values.
The sections appear in two columns: Geometry and Axis labels first, then Rendering and Data. Narrow screens use one column.
Geometry contains stacking, bar orientation, and group/bar layout controls.
**Bars orientation** uses Vertical/Horizontal radios and preserves the current chart dimensions.
**Ellipsis** uses End/Middle radios. **Max chars** ranges from 0 to 20, with 0 shown as Off and passed to the plugin as `null`.

The **Series** slider selects 1–5 component series, with a default of 2. The two optional total series do not count toward this limit.
A count change rebuilds the chart at its current dimensions with the same seed. Existing seeded columns retain their values.
Orientation, stacking, totals, and randomization use the selected count. All component series participate in the native stack when stacking is enabled.

Copied data links include `series` when the count differs from 2. A valid `series=1` through `series=5` URL parameter sets the initial count.
The link preserves the seed and component count, not layout or visibility settings.

The chart container supports resizing in both directions. A `ResizeObserver` watches its flexible plot slot and calls `u.setSize()` with whole CSS-pixel dimensions.
The native legend mounts in a separate grid row, so its height does not consume the plot's assigned size.
The observer ignores unchanged, nonfinite, and nonpositive dimensions. Rebuilds reuse the observer and resize the current chart only.
Data changes use the normal `u.setData(...)` method.

## Cleanup

`demo.destroy()` destroys the current chart, removes form listeners, and disconnects the resize observer. It releases references to the chart, plugin, controls, and root element.
The plugin clears its hover buffer and value geometry. It also releases its references to the chart, stack groups, and native bar path builder.
Core's global font contexts persist after chart destruction.
Caller-owned data, stack groups, and bar options remain unchanged. Repeated destroy calls have no effect.
Orientation and stack rebuilds retain the data before they destroy the old chart.

## Layout and scope

The plugin manages ordinal X spacing and the full-category X range. It disables drag zoom.
Vertical bars use bottom-X/left-Y axes. Horizontal bars use left-X/bottom-Y axes with inverted scale orientations.
It manages primary axes `0` and `1`, padding, axis sizes, and paths for each bar series. It hides bar-series points.
It preserves axis styles, fonts, Y-axis value formatters, and explicit series fills.
The numeric axis preserves `opts.axes[1].scale`, with `'y'` as the default.
Its scale defaults to `axis: 1` and soft-zero limits. Explicit scale options override these defaults, except for orientation.
The plugin sets the orientation of each numeric scale used by bars and preserves its other options, including custom ranges.
Tick-aware `axis: 1` ranging uses plot height for vertical numeric axes and available plot width for horizontal numeric axes.
Horizontal numeric axes default to `space: 100` CSS pixels. `opts.axes[1].space` can override this target spacing.
Fixed ranges and custom range functions retain standard ranging. Automatic label fitting is not implemented.
The plugin does not support general top-axis or custom-alignment layouts.

Both primary axes use `size: 'auto'`. Core reserves the tick size, gap, and selected label extent without extra axis padding.

Automatic sizing and tuple overflow support default alignment (`align: 0`) and `alignTo: 1` only.
They support unrotated multiline labels. Rotation support is limited to single-line labels on bottom axes.
Explicit numeric sizes and size callbacks retain custom alignment support. The renderer still draws rotated multiline labels, but automatic layout does not support them.

The plugin uses `padding: [inset, [inset, Infinity], inset, [inset, Infinity]]` in top/right/bottom/left order.
Each side accepts only a number, `null`, or `[min, max]` bounds.
Before tick selection, core reserves numeric padding, heuristic padding for `null`, or tuple minima.
Top and bottom tuples use only their minima. A finite maximum can allow label clipping.

After horizontal label selection and formatting, core resolves left and right tuple overflow together with the final axis widths.
It credits existing axis space. Overflow adjustment does not select or format ticks again.
Default or `null` padding retains the original heuristic, even with `size: 'auto'`. Overflow adjustment requires explicit `[min, max]` tuples.

Padding callbacks and public padding phases no longer exist. There is no tick-aware custom padding callback, `sizePadding` option, or public overflow helper.

For migration, replace padding callbacks with numbers or `[min, max]` bounds.

Core shares one `OffscreenCanvas` context per font across axes and charts. The plugin requires browser support for `OffscreenCanvas`.
Each context keeps its font. Measurement does not change the chart context.
Unrotated horizontal autosizing reads the current label strings for height without measurement of their widths.
Core measures widths only for vertical or rotated sizing, or automatic padding.
Core retains the measured array in `axis._labelValues` and a `number[]` of widths in `axis._labelWidths`.
If layout skips measurement, `axis._labelValues` can differ from the current formatted array.
Each width is the maximum unrotated line width for that label. Hidden `null` labels have width zero.

Unchanged selected labels reuse their measurements after truncation changes, rotation, and resize.
If a resize selects different labels, core measures them when layout needs their widths.
Core invalidates measurements centrally when the pixel ratio changes.
Runtime changes to axis fonts, `lineGap`, or sides are unsupported. In-place mutation of the formatted values array is also unsupported.
