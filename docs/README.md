### Documentation

- [Installation](#installation)
- [Data Format](#data-format)
- [Basics](#basics)
- [High/Low Bands](#highlow-bands)
- [Series, Scales, Axes, Grid](#series-scales-axes-grid)
- [Multiple Scales & Axes](#multiple-scales--axes)
- [Scale Opts](#scale-opts)
- [Axis & Grid Opts](#axis--grid-opts)
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
      value: (self, rawValue) => "$" + rawValue.toFixed(2),

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
      value: (self, rawValue) => rawValue.toFixed(1) + "%",
    }
    {
      label: "RAM",
      stroke: "blue",
      scale: "%",
      value: (self, rawValue) => rawValue.toFixed(1) + "%",
    },
    {
      label: "TCP",
      stroke: "green",
      scale: "mb",
      value: (self, rawValue) => rawValue.toFixed(2) + "MB",
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

- `space` is the minimum space between adjacent ticks; a smaller number will result in smaller selected divisors. can also be a function of the form `(self, scaleMin, scaleMax, dim) => space` where `dim` is the dimension of the plot along the axis in CSS pixels.
- `incrs` are divisors available for segmenting the axis to produce ticks. can also be a function of the form `(self) => divisors`.
- `values` can be:
  - a function with the form `(self, ticks, space) => values` where `ticks` is an array of raw values along the axis' scale, `space` is the determined tick spacing in CSS pixels and `values` is an array of formatted tick labels.
  - array of tick formatters with breakpoints.
