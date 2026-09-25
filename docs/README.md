### Documentation

- [Installation](#installation)
- [Data Format](#data-format)
- [Basics](#basics)
- [Optional DOM](#optional-dom)
- [High/Low Bands](#highlow-bands)
- [Series, Scales, Axes, Grid](#series-scales-axes-grid)
- [Multiple Scales & Axes](#multiple-scales--axes)
- [Scale Opts](#scale-opts)
  - [Numeric Range Policy](#numeric-range-policy)
  - [Soft-limit Migration](#soft-limit-migration)
- [Axis & Grid Opts](#axis--grid-opts)
- [Axis Layout & Padding](#axis-layout--padding)
- WIP: [#48](https://github.com/leeoniya/uPlot/issues/48)

---
#### Installation

```html
<link rel="stylesheet" href="dist/uPlot.min.css">
<script src="dist/uPlot.iife.min.js"></script>
```

---
#### Data Format

```js
let data = [
  [1546300800, 1546387200],    // x-values (timestamps)
  [        35,         71],    // y-values (series 1)
  [        90,         15],    // y-values (series 2)
];
```

uPlot expects a columnar data format as shown above.

- x-values must be numbers, unique, and in ascending order.
- y-values must be numbers (or `null`s for missing data).
- x-values and y-values arrays must be of equal lengths >= 2.

By default, x-values are assumed to be [unix timestamps](https://en.wikipedia.org/wiki/Unix_time) (seconds since 1970-01-01 00:00:00) but can be treated as plain numbers via `scales.x.time = false`.
JavaScript uses millisecond-precision timestamps, but this precision is rarely necessary on calendar-aware `time: true` scales/plots, which honor DST, timezones, leap years, etc.
For sub-second periods, it's recommended to set `time: false` and simply use ms offsets from 0.
If you truly need calendar-aware ms level precision, simply provide the timestamps as floats, e.g. `1575354886.419`.
[More info...](https://github.com/leeoniya/uPlot/issues/60#issuecomment-561158077).

This format has implications that can make uPlot an awkward choice for multi-series datasets which cannot be easily aligned along their x-values.
If one series is data-dense and the other is sparse, then the latter will need to be filled in with mostly `null` y-values.
If each series has data at arbitrary x-values, then the x-values array must be augmented with all x-values, and all y-values arrays must be augmented with `null`s, potentially leading to exponential growth in dataset size, and a structure consisting of mostly `null`s.

This does not mean that all series must have identical x-values - just that they are alignable.
For instance, it is possible to plot [series that express different time periods](https://leeoniya.github.io/uPlot/demos/time-periods.html), because the data is equally spaced.

**Before choosing uPlot, ensure your data can conform to these requirements.**

---
#### Basics

```js
let opts = {
  title: "My Chart",
  id: "chart1",
  class: "my-chart",
  width: 800,
  height: 600,
  series: [
    {},
    {
      // initial toggled state (optional)
      show: true,

      spanGaps: false,

      // in-legend display
      label: "RAM",
      value: (self, rawValue) => rawValue == null ? '' : "$" + rawValue.toFixed(2),

      // series style
      stroke: "red",
      width: 1,
      fill: "rgba(255, 0, 0, 0.3)",
      dash: [10, 5],
    }
  ],
};

let uplot = new uPlot(opts, data, document.body);
```

- `id` and `class` are optional HTML attributes to set on the chart's container `<div>` (`uplot.root`).
- `width` and `height` are required dimensions in plotting area, axes & ticks, but **excluding** `title` or `legend` dimensions (which can be variable based on user CSS).
- `spanGaps` can be set to `true` to connect `null` data points.
- For a series to be rendered, it **must** be specified in the opts; simply having it in the data is insufficient.
- All series' options are optional; `label` will default to "Value" and `stroke` will default to "black".
- `width` is the series' line width in CSS pixels.
- `stroke`, `width`, `fill`, and `dash` map directly to Canvas API's [ctx.strokeStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/strokeStyle), [ctx.lineWidth](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineWidth), [ctx.fillStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillStyle), and [ctx.setLineDash](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setLineDash).

---
#### Optional DOM

The `dom` options control which chart elements uPlot creates. All flags default to `true` and apply only during construction.

| Option | Effect of `false` |
| --- | --- |
| `dom.over` | Omits `.u-over`. Disables the built-in cursor, hover points, local plot mouse interaction, and over-layer selection. |
| `dom.under` | Omits `.u-under` and disables under-layer selection. |
| `dom.uplot` | Makes the canvas the root. Suppresses all other built-in DOM, including the title, legend, cursor, selection, and axis rectangles. |
| `axes[i].dom` | Omits that axis's `.u-axis` rectangle. Preserves axis drawing and layout. |

Selection requires its chosen layer: `select.over: true` uses `.u-over`, and `false` uses `.u-under`. uPlot does not move selection to another layer.
Cursor and series synchronization remain available without `.u-over`. Existing synchronization filters still apply.

A canvas-only chart can still show axes:

```js
const opts = {
  width: 300,
  height: 120,
  dom: { uplot: false },
  scales: { x: { time: false } },
  series: [{}, { stroke: "blue" }],
};
```

For a sparkline without axes, the additional option is `axes: [{ show: false }, { show: false }]`.
With `dom.uplot: false`, `u.root === u.ctx.canvas`. The canvas retains the `.uplot` class, `id`, and custom class.
`setSize()`, `setPxRatio()`, and `destroy()` operate on that canvas.

An interactive sparkline can retain only the root, canvas, and overlay:

```js
const opts = {
  width: 150,
  height: 30,
  dom: { under: false },
  legend: { show: false },
  select: { show: false },
  axes: [{ show: false }, { show: false }],
  scales: { x: { time: false } },
  series: [{}, { stroke: "blue" }],
};
```

When no title or visible legend exists, the root div also serves as `.u-wrap`. This removes the nested wrapper even without explicit `dom` options.
A missing overlay or underlay has the value `null` in `u.over` or `u.under`.

Without `.u-over`, `u.rect` returns `null` without measuring the canvas or firing a `syncRect` hook.
With `.u-over`, rectangle measurement is unchanged. Only cursor-enabled charts expose `u.syncRect()` and invalidate the rectangle cache on scroll and window resize.

Plugin `opts` callbacks receive the root, canvas context, and any enabled layers. The constructor options determine this DOM before plugins run.
For a merged root, `u.root.querySelector(".u-wrap")` returns `null` because the root itself is the wrapper.
A root-inclusive lookup is `u.root.matches(".u-wrap") ? u.root : u.root.querySelector(".u-wrap")`.
Borders and padding belong on an external host, not the merged root or canvas.

---
#### High/Low Bands

High/Low bands are defined by two adjacent `data` series in low,high order and matching opts with `series.band = true`.

```js
const opts = {
  series: [
    {},
    {
      label: "Low",
      fill: "rgba(0, 255, 0, .2)",
      band: true,

    },
    {
      label: "High",
      fill: "rgba(0, 255, 0, .2)",
      band: true,
    },
  ],
};
```

---
#### Series, Scales, Axes, Grid

uPlot's API strives for brevity, uniformity and logical consistency.
Understanding the roles and processing order of `data`, `series`, `scales`, and `axes` will help with the remaining topics.
The high-level rendering flow is this:

1. `data` is the first input into the system.
0. `series` holds the config of each dataset, such as visibility, styling, labels & value display in the legend, and the `scale` key along which they should be drawn. Implicit scale keys are `x` for the `data[0]` series and `y` for `data[1..N]`.
0. `scales` reflect the min/max ranges visible within the view. All view range adjustments such as zooming and pagination are done here. If not explicitly set via opts, `scales` are automatically initialized using the `series` config and auto-ranged using the provided `data`.
0. `axes` render the ticks, values, labels and grid along their `scale`. Tick & grid spacing, value granularity & formatting, timezone & DST handling is done here.

You may have noticed in the previous examples that `series` and `axes` arrays begin with `{}`.
This represents options/overrides for the `x` series and axis.
They are required due to the way uPlot sets defaults:

- `data[0]`, `series[0]` and `axes[0]` represent & inherit `x` defaults, e.g:

  - `"x"` scale w/ `auto: false`
  - temporal
  - hz orientation, bottom position
  - larger minimum tick spacing

- `data[1..N]`, `series[1..N]` and `axes[1..N]` represent & inherit `y` defaults, e.g:

  - `"y"` scale w/ `auto: true`
  - numeric
  - vt orientation, left position
  - smaller minimum tick spacing

While somewhat unusual, keeping x & y opts in flat arrays [rather than splitting them] serves several purposes:

- API & structural uniformity. e.g. `series[i]` maps to `data[i]`
- Hooks receive an unambiguous `i` into the arrays without needing further context
- Internals don't need added complexity to conceal the fact that everything is merged & DRY

More thoughts in [#76](https://github.com/leeoniya/uPlot/pull/76) & [#77](https://github.com/leeoniya/uPlot/issues/77).

---
#### Multiple Scales & Axes

Series with differing units can be plotted along additional scales and display corresponding y-axes.

1. Use the same `series.scale` key.
2. Optionally, specify an additional `axis` with the `scale` key.

```js
let opts = {
  series: [
    {},
    {
      label: "CPU",
      stroke: "red",
      scale: "%",
      value: (self, rawValue) => rawValue == null ? '' : rawValue.toFixed(1) + "%",
    }
    {
      label: "RAM",
      stroke: "blue",
      scale: "%",
      value: (self, rawValue) => rawValue == null ? '' : rawValue.toFixed(1) + "%",
    },
    {
      label: "TCP",
      stroke: "green",
      scale: "mb",
      value: (self, rawValue) => rawValue == null ? '' : rawValue.toFixed(2) + "MB",
    },
  ],
  axes: [
    {},
    {
      scale: "%",
      values: (self, ticks) => ticks.map(rawValue => rawValue.toFixed(1) + "%"),
    },
    {
      scale: "mb",
      values: (self, ticks) => ticks.map(rawValue => rawValue.toFixed(2) + "MB"),
      side: 1,
      grid: {show: false},
    },
  ],
};
```

- `side` is the where to place the axis (0: top, 1: right, 2: bottom, 3: left).


#### Axes for Alternate Units

Sometimes it's useful to provide an additional axis to display alternate units, e.g. °F / °C.
This is done using dependent scales.

```js
let opts = {
  series: [
    {},
    {
      label: "Temp",
      stroke: "red",
      scale: "F",
    },
  ],
  axes: [
    {},
    {
      scale: "F",
      values: (self, ticks) => ticks.map(rawValue => rawValue + "° F"),
    },
    {
      scale: "C",
      values: (self, ticks) => ticks.map(rawValue => rawValue + "° C"),
      side: 1,
      grid: {show: false},
    }
  ],
  scales: {
    "C": {
      from: "F",
      range: (self, fromMin, fromMax) => [
        (fromMin - 32) * 5/9,
        (fromMax - 32) * 5/9,
      ],
    }
  },
```

- `from` specifies the scale on which this one depends.
- `range` converts `from`'s min/max into this one's min/max.

---
#### Scale Opts

If a scale does not need auto-ranging from the visible data, you can provide static min/max values.
This is also a performance optimization, since the data does not need to be scanned on every view change.

```js
let opts = {
  scales: {
    "%": {
      auto: false,
      range: [0, 100],
    }
  },
}
```

`u.setRange(scaleKey, min, max)` sets concrete bounds and bypasses `scale.range()`.
`u.setScale()` accepts object bounds. Null bounds request scale calculation.

A `cursor.drag.setRange` callback can adjust the bounds from built-in drag zoom.
It receives ordered `min` and `max` bounds. Return an adjusted `[min, max]` tuple, or return `null` to cancel the scale change.
Other scale operations do not call this callback.

```js
let opts = {
  cursor: {
    drag: {
      x: true,
      setRange: (u, scaleKey, min, max) => {
        if (scaleKey != "x")
          return [min, max];

        return [
          Math.floor(min / 10) * 10,
          Math.ceil(max / 10) * 10,
        ];
      },
    },
  },
};
```

The default x scale is temporal, but can be switched to plain numbers. This can be used to plot functions.

```js
let opts = {
  scales: {
    "x": {
      time: false,
    }
  },
}
```

A scale's default distribution is linear `distr: 1`, but can be switched to indexed/evenly-spaced.
This is useful when you'd like to squash periods with no data, such as weekends.
Keep in mind that this will prevent logical temporal tick baselines such as start of day or start of month.

```js
let opts = {
  scales: {
    "x": {
      distr: 2,
    }
  },
}
```

##### Numeric Range Policy

`Range.Config` controls ordinary numeric ranging through `uPlot.rangeNum()` and tick-aware numeric ranging through `scale.axis`.
Both rangers use the same anchor precedence:

1. Hard limits.
2. Active explicit soft anchors.
3. Zero-proximity anchors from `zeroIf`.
4. Padding.

Each side accepts `hard`, `soft`, and `pad`. There is no `mode` property or implicit `soft: 0`.
An omitted or null `soft` supplies no soft anchor. Each side defaults to `pad: 0.1`.

An explicit `soft` is an exact preferred endpoint, subject to hard limits:

- `min.soft` is active exactly when `rawMin >= min.soft`.
- `max.soft` is active exactly when `rawMax <= max.soft`.

If data crosses a soft endpoint, that anchor becomes inactive and normal padding applies, subject to hard limits and `zeroIf`.
An active anchor overrides padding on its side. Soft activation does not depend on padded bounds or tick positions.
For example, `min.soft: 10` anchors the minimum at `10` for raw data `[20, 100]`.
For raw data `[5, 100]`, the same soft anchor is inactive.

The top-level `zeroIf` defaults to `0.1` when omitted or null. A value of `0` disables proximity anchoring.
The proximity rule uses raw extrema and `rawSpan = rawMax - rawMin`, before padding, hard clipping, or flat-range normalization:

- For nonnegative data, zero qualifies when `rawMin <= zeroIf * rawSpan`.
- For nonpositive data, zero qualifies when `-rawMax <= zeroIf * rawSpan`.

Hard limits and active explicit soft anchors take precedence over zero proximity.
Null soft limits do not disable `zeroIf`. Zero can still occur through ordinary padding or tick selection when proximity anchoring is disabled.

```js
const range = {
  min: { soft: null, pad: 0.1 },
  max: { soft: 100, pad: 0.1 },
  zeroIf: 0.1,
};
```

Tick-aware ranging resolves anchors before one tick-grid selection. It has no natural-grid prepass or retry to determine soft activation.
Anchored sides ignore even huge padding values whose multiplication by the raw span overflows. Unanchored padding requirements still apply.
Active endpoints must align with the selected built-in increment for tick-aware ranging.
For flat zero data, an explicit upper zero endpoint uses a negative fallback. Explicit zero endpoints on both sides retain the positive fallback.
The positional `rangeNum(min, max, mult, zeroAffinity)` form uses `mult` as padding. Its `zeroAffinity` flag enables or disables the default zero affinity.
The [axis-ranging policy](investigations/minimal-axis-ranging-plan.md#minimum-range-padding) explains tick-aware padding and unsupported inputs.

##### Soft-limit Migration

`Range.SoftMode` and `Range.Limit.mode` are removed. The following changes apply to range configuration:

| Previous configuration | Migration |
| --- | --- |
| `mode: 0` | Remove `mode` and omit `soft`, or set `soft: null`. |
| `mode: 1` | Remove `mode` and retain `soft`. |
| `mode: 2` or `mode: 3`, with nonzero `soft` | There is no direct equivalent. If the old conditional behavior is necessary, use a custom range function. |
| Old default `soft: 0, mode: 3` | Remove both fields. The default `zeroIf: 0.1` replaces this policy. |

The new zero-proximity policy uses raw data, not padded bounds or a natural tick grid. It does not promise identical legacy bounds.
An explicit `soft: 0` now requests a preferred zero endpoint whenever data stays on that side of zero, regardless of distance.

If the old configuration used `mode: 0` to avoid zero anchoring, also set `zeroIf: 0`.
This disables proximity anchoring, but does not forbid a zero endpoint from padding or tick selection.

---
#### Axis & Grid Opts

Most options are self-explanatory:

```js
let opts = {
  axes: [
    {},
    {
      show: true,
      label: "Population",
      labelSize: 30,
      labelFont: "bold 12px Arial",
      font: "12px Arial",
      gap: 5,
      size: 50,
      stroke: "red",
      grid: {
        show: true,
        stroke: "#eee",
        width: 2,
        dash: [],
      },
      ticks: {
        show: true,
        stroke: "#eee",
        width: 2,
        dash: [],
        size: 10,
      }
    }
  ]
}
```

- `size` & `labelSize` represent the perpendicular dimensions assigned to `values` and `labels` DOM elements, respectively. In the above example, the full width of this y-axis would be 30 + 50; for an x-axis, it would be its height.
- `gap` is the space between axis ticks and `values`.

Customizing the tick/grid spacing, value formatting and granularity is somewhat more involved:

```js
let opts = {
  axes: [
    {
      space: 40,
      incrs: [
         // minute divisors (# of secs)
         1,
         5,
         10,
         15,
         30,
         // hour divisors
         60,
         60 * 5,
         60 * 10,
         60 * 15,
         60 * 30,
         // day divisors
         3600,
      // ...
      ],
      // [0]:   minimum num secs in found axis split (tick incr)
      // [1]:   default tick format
      // [2-7]: rollover tick formats
      // [8]:   mode: 0: replace [1] -> [2-7], 1: concat [1] + [2-7]
      values: [
      // tick incr          default           year                             month    day                        hour     min                sec       mode
        [3600 * 24 * 365,   "{YYYY}",         null,                            null,    null,                      null,    null,              null,        1],
        [3600 * 24 * 28,    "{MMM}",          "\n{YYYY}",                      null,    null,                      null,    null,              null,        1],
        [3600 * 24,         "{M}/{D}",        "\n{YYYY}",                      null,    null,                      null,    null,              null,        1],
        [3600,              "{h}{aa}",        "\n{M}/{D}/{YY}",                null,    "\n{M}/{D}",               null,    null,              null,        1],
        [60,                "{h}:{mm}{aa}",   "\n{M}/{D}/{YY}",                null,    "\n{M}/{D}",               null,    null,              null,        1],
        [1,                 ":{ss}",          "\n{M}/{D}/{YY} {h}:{mm}{aa}",   null,    "\n{M}/{D} {h}:{mm}{aa}",  null,    "\n{h}:{mm}{aa}",  null,        1],
        [0.001,             ":{ss}.{fff}",    "\n{M}/{D}/{YY} {h}:{mm}{aa}",   null,    "\n{M}/{D} {h}:{mm}{aa}",  null,    "\n{h}:{mm}{aa}",  null,        1],
      ],
  //  splits:
    }
  ],
}
```

- `space` is the tick selection target in CSS pixels. A smaller target selects smaller divisors. It also accepts `(self, axisIdx, scaleMin, scaleMax, dim) => space`, where `dim` is the plot dimension along the axis in CSS pixels. Horizontal selection uses the provisional width. Final spacing can be smaller after overflow padding.
- `incrs` are divisors available for segmenting the axis to produce ticks. can also be a function of the form `(self) => divisors`.
- `nice` controls calendar adjustments in the built-in time-axis splits. Its defaults are `{dst: true, first: false}`.
  - `dst: true` realigns multi-hour ticks to a local-midnight cadence across DST transitions. `false` keeps uniform elapsed-time intervals. Day-based ticks retain their local-midnight correction with either setting.
  - `first: true` enforces month-start ticks for multi-day increments and removes a preceding tick if the spacing is too small. `false` continues the cadence across month boundaries without forcing a tick on the first. Monthly and yearly increments are unchanged.
- `values` can be:
  - a function with the form `(self, ticks, space) => values` where `ticks` is an array of raw values along the axis' scale, `space` is the determined tick spacing in CSS pixels and `values` is an array of formatted tick labels.
  - array of tick formatters with breakpoints.

---
#### Axis Layout & Padding

Layout uses a fixed, height-first order without convergence cycles. Scale ranges currently precede layout. This order retains insertion points for future scale ranging after the plot height or width becomes available.

1. Each horizontal `axis.size` callback receives `(self, null, axisIdx)` once before ticks. It reserves the full axis height, including space for rotation, truncation, and multiline labels. Vertical axes have no preliminary reservation call.
2. Padding callbacks on all sides receive the `Layout` (0) phase to establish baseline padding before vertical ticks. The horizontal axis heights and baseline padding determine the fixed plot height.
3. uPlot selects and formats vertical ticks at that height. Each vertical `axis.size` callback receives `(self, values, axisIdx)` once to determine its width. `values` contains the formatted labels, or `[]` if there are no ticks. Vertical size callbacks never receive `null`.
4. uPlot selects and formats horizontal ticks at the provisional width, which includes vertical axis sizes and baseline padding.
5. Only left and right padding callbacks receive the `Overflow` (1) phase. Both callbacks see the same baseline padding and geometry. Each callback returns its final total padding in CSS pixels, not a delta. uPlot then applies both totals to determine the final width.

Top and bottom padding stay fixed after ticks. Horizontal `axis.size` callbacks never receive actual labels. Overflow does not select or format ticks again, so final horizontal spacing can be smaller than the `axis.space` target.

Plot dimensions must remain positive after axis sizes and padding. Behavior for nonpositive plot dimensions is undefined.

**Side participation:** `sidesWithAxes` derives from axis configuration at initialization, not from size callback results. Hidden or inactive axes do not participate. For visible, active axes:

- A positive numeric `size` or a size callback makes the axis participate.
- A size callback still makes the axis participate if it returns zero.
- Numeric `size: 0` does not make the axis participate, unless an axis title has nonzero `labelSize`.

A zero return from a size callback no longer changes side occupancy for default padding.

For a grid-only axis, use numeric `size: 0` without an axis title reservation. To hide the axis fully, including its grid, use `show: false`. For other padding behavior, set explicit `padding` values or callbacks.

**Compatibility:** `axis.size` no longer receives `cycleNum`. Its signature remains `(self, values: Axis.StaticValues | null, axisIdx) => number` because horizontal callbacks receive `null`. `Axis.StaticValues` can contain strings, numbers, and null entries. Padding callbacks receive `(self, side, sidesWithAxes, phase)`, where `phase` is `PaddingPhase`, instead of a cycle number.

The numeric TypeScript const enum `PaddingPhase` defines `Layout` (0) and `Overflow` (1). It has no JavaScript runtime object. JavaScript callbacks use `0` and `1`.

Custom callbacks must handle these phases without convergence counters or position feedback. A conservative overflow total reserves at least half the maximum measured horizontal label width, plus an optional inset. The [axis autosize demo](../demos/axis-autosize.html) measures each non-null value as a string and converts canvas widths with `self.pxRatio`.

**Layout commit:** `setSize()` updates `self.width` and `self.height` immediately. Until commit, `self.bbox`, coordinate transforms, and DOM geometry retain the previous completed layout. Before the initial commit, all `self.bbox` fields are zero. `batch()` completes its pending layout synchronously before it returns. A previously queued commit does not draw again after this flush.

`setPxRatio()` updates `self.pxRatio` immediately. Font scaling and path invalidation use the final requested ratio at commit. Cancelled ratio changes retain the existing fonts and paths unless another change invalidates them.

Identical `setSize()` or `setPxRatio()` requests are no-ops. For an explicit axis and layout refresh, call `redraw(false, true)`. The `setSize` hook still reports outer size updates and internal plot geometry or axis changes. Identical requests do not trigger this hook.

`redraw(true, true)` also rebuilds series paths and refreshes automatic ranges. Built-in scanners reuse valid extrema caches when data and the visible window are unchanged. Pending data or X-range updates retain their normal invalidation behavior. Custom scanner and range callbacks still run. After any data change, including in-place array edits, call `setData()` rather than only `redraw()`.

Multiple size changes before a commit produce one `setSize` notification, even if the final size matches the previous layout.

**Canvas state:** uPlot invalidates its canvas state cache only when it resets the canvas backing store. Callbacks must preserve `self.ctx` state. The demo saves and restores the canvas state around font changes to preserve the font cache.

#### Cache Retention

`cache` selects which categories to retain after rendering. Omitted categories default to `true`.

```js
cache: { paths: false, data: false }
```

This configuration discards both categories after rendering. `cache: { data: false }` discards data but retains paths.

`clearCache()` discards all categories immediately without scheduling a redraw. An explicit selector discards only categories set to `true`:

```js
u.clearCache({ paths: true }); // Paths only.
u.clearCache({ data: true });  // Data only.
u.clearCache({});              // Nothing.
```

Data disposal replaces retained columns with empty arrays while preserving the dataset structure, including mode-2 facets. It also releases ordinal index arrays and the internal `opts.data` copy. It does not mutate caller-owned arrays, clear the canvas, or reset scale bounds and extrema. A later `setData()` can supply new data for another render.

Data disposal is for non-interactive charts such as sparklines. Cursor interaction, legend toggling, resize, pixel-ratio updates, and other data-dependent features must be disabled. The implementation does not enforce these restrictions yet.

Manual data disposal must occur after rendering. Automatic disposal normally completes before `ready`, but retains data needed by pending render work. With `cache.data: false`, hooks must not call `setData()`. Plugins and callbacks can retain their own references, which this API cannot release.

#### Cursor Marker Alignment

Default DOM hover markers share the built-in canvas marker position calculation. This calculation uses the bitmap plot rectangle, `series.pxAlign`, and the canvas point stroke offset.

The DOM position uses the completed canvas-to-CSS scale, without another CSS-pixel rounding step. Hover centers can therefore have fractional CSS coordinates.
Stationary markers update after external resize, axis layout changes, and pixel-ratio changes. Pending size or pixel-ratio requests do not change their displayed geometry before commit.

The alignment target is the canvas marker center, not the series line. Different point and line stroke widths can produce different drawing offsets.
CSS circles and canvas arcs can still differ in antialiasing and border appearance.

`cursor.points.bbox` overrides automatic center alignment and size. Its existing CSS positioning behavior remains unchanged.
Custom point paths with different placement require an explicit bounding-box callback. The default calculation cannot infer arbitrary path geometry.

This change addresses the coordinate mismatch reported in [#1108](https://github.com/leeoniya/uPlot/issues/1108) and [#779](https://github.com/leeoniya/uPlot/issues/779).
