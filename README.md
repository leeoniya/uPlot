## 📈 μPlot

An [exceptionally fast](#performance), tiny ([< 20 KB min](https://github.com/leeoniya/uPlot/tree/master/dist/uPlot.iife.min.js)) time series & line chart _(MIT Licensed)_

---
### Introduction

μPlot is a [fast, memory-efficient](#performance) [time series](https://en.wikipedia.org/wiki/Time_series) & line chart based on [Canvas 2D](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D); from a cold start it can create an interactive chart containing 150,000 data points in 40ms, scaling linearly at ~4,000 pts/ms. In addition to fast initial render, the zooming and cursor performance is by far the best of any similar charting lib; at < 20 KB, it's likely the smallest and fastest time series plotter that doesn't make use of WebGL shaders or WASM, both of which have much higher startup cost and code size.

<h3 align="center">166,650 point bench: <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">https://leeoniya.github.io/uPlot/bench/uPlot.html</a></h3>

---
![uPlot Chart](uPlot.png "uPlot Chart")

---
### 🚧 UNDER CONSTRUCTION 🚧

v1.0 and API stabilization are loosely targetted for sometime before 2020-01-01. Until then, feedback, feature suggestions and real use-cases can be submitted to the issue tracker for consideration & further discussion.

---
### Features

- Multiple series w/toggle
- Multiple y-axes, scales & grids
- Temporal or numeric x-axis
- Line & Area styles (color, fill, width, dash)
- Zoom with auto-rescale
- Legend with live values
- Support for [IANA Time Zone Names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) & DST
- [Support for missing data](https://leeoniya.github.io/uPlot/demos/missing-data.html)
- [Cursor sync for multiple charts](https://leeoniya.github.io/uPlot/demos/sync-cursor.html)
- [Focus closest series](https://leeoniya.github.io/uPlot/demos/focus-cursor.html)
- [Data streaming (live update)](https://leeoniya.github.io/uPlot/demos/stream-data.html)
- [High / Low bands](https://leeoniya.github.io/uPlot/demos/high-low-bands.html)

---
### Non-Features

In order to stay lean, fast and focused the following features will not be added:

- No data parsing, aggregation, summation or statistical processing - just do it in advance. e.g. https://simplestatistics.org/, https://www.papaparse.com/
- No transitions or animations - they're always pure distractions.
- No DOM measuring; uPlot does not know how much space your dynamic labels & values will occupy, so requires explicit sizing and/or some CSS authoring.
- No [stacked series](https://everydayanalytics.ca/2014/08/stacked-area-graphs-are-not-your-friend.html) or [line smoothing](http://www.vizwiz.com/2011/12/when-you-use-smoothed-line-chart-your.html). See links for how these are each terrible at actually communicating information.
- Probably no drag scrolling/panning. Maintaining good perf with huge datasets would require a lot of extra code & multiple `<canvas>` elements to avoid continuous redraw and rescaling on each dragged pixel. However, since uPlot's performance allows rendering of very wide canvases, they can be scrolled naturally with CSS's `overflow-x: auto` applied to a narrower containing element. Pagination of data also works well.

---
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
<link rel="stylesheet" href="src/uPlot.css">
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
  spanGaps: false,
  series: [
    {},
    {
      // initial toggled state (optional)
      show: true,

      // in-legend display
      label: "RAM",
      value: (self, rawValue) => "$" + rawValue.toFixed(2),

      // series style
      color: "red",
      width: 1,
      fill: "rgba(255, 0, 0, 0.3)",
      dash: [10, 5],
    }
  ],
};

let uplot = new uPlot.Line(opts, data);

document.body.appendChild(uplot.root);
```

- `id` and `class` are optional HTML attributes to set on the chart's container `<div>` (`uplot.root`).
- `width` and `height` are required dimensions in *logical* [CSS] pixels of the plotting area & axes, but **excluding** `title` or `legend` dimensions (which can be variable based on user CSS).
- `spanGaps` can be set to `true` to connect `null` data points.
- For a series to be rendered, it **must** be specified in the opts; simply having it in the data is insufficient.
- All series' options are optional; `label` will default to "Value" and `color` will default to "black".
- Series' line `width` is specified in *physical* [device] pixels (e.g. on high-DPI displays with a pixel ratio = 2, `width: 1` will draw a line with an effective width of 0.5 logical [CSS] pixels).
- `color`, `width`, `fill`, and `dash` map directly to Canvas API's [ctx.strokeStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/strokeStyle), [ctx.lineWidth](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineWidth), [ctx.fillStyle](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fillStyle), and [ctx.setLineDash](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setLineDash).

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
- Hooks recieve an unambiguous `i` into the arrays without needing futher context
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
      color: "red",
      scale: "%",
      value: (self, rawValue) => rawValue.toFixed(1) + "%",
    }
    {
      label: "RAM",
      color: "blue",
      scale: "%",
      value: (self, rawValue) => rawValue.toFixed(1) + "%",
    },
    {
      label: "TCP",
      color: "green",
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
      color: "red",
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

A scale's default distribution is linear `dstr: 1`, but can be switched to indexed/evenly-spaced.
This is useful when you'd like to squash periods with no data, such as weekends.
Keep in mind that this will prevent logical temporal tick baselines such as start of day or start of month.

```js
let opts = {
  scales: {
    "x": {
      dstr: 2,
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
      size: 50,
      class: "my-y",
      color: "red",
      grid: {
        show: true,
        color: "#eee",
        width: 2,
        dash: [],
      }
    }
  ]
}
```

- `size` & `labelSize` represent the perpendicular dimensions assigned to `values` and `labels` DOM elements, respectively. In the above example, the full width of this y-axis would be 30 + 50; for an x-axis, it would be its height.

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
      values: [
        [3600 * 24 * 365,    "{YYYY}",               7,   "{YYYY}"                    ],
        [3600 * 24 * 28,     "{MMM}",                7,   "{MMM}\n{YYYY}"             ],
        [3600 * 24,          "{M}/{D}",              7,   "{M}/{D}\n{YYYY}"           ],
        [3600,               "{h}{aa}",              4,   "{h}{aa}\n{M}/{D}"          ],
        [60,                 "{h}:{mm}{aa}",         4,   "{h}:{mm}{aa}\n{M}/{D}"     ],
        [1,                  "{h}:{mm}:{ss}{aa}",    4,   "{h}:{mm}:{ss}{aa}\n{M}/{D}"],
      ],
  //  ticks:
    }
  ],
}
```

- `space` is the minumum space between adjacent ticks; a smaller number will result in smaller selected divisors. can also be a function of the form `(self, scaleMin, scaleMax, dim) => space` where `dim` is the dimension of the plot along the axis in CSS pixels.
- `incrs` are divisors available for segmenting the axis to produce ticks. can also be a function of the form `(self) => divisors`.
- `values` can be:
  - a function with the form `(self, ticks, space) => values` where `ticks` is an array of raw values along the axis' scale, `space` is the determined tick spacing in CSS pixels and `values` is an array of formated tick labels.
  - array of tick formatters with breakpoints. more format details can be found in the source: https://github.com/leeoniya/uPlot/blob/master/src/opts.js#L110

---
### Performance

Benchmarks done on a ThinkPad T480S:

- Windows 10 x64, Chrome 79.0.3945.88
- Core i5-8350U @ 1.70GHz, 8GB RAM
- Intel HD 620 GPU, 2560x1440 res

<pre>
| lib            | size    | done    | js,rend,paint,sys | heap peak,final | interact (10s)      |
| -------------- | ------- | ------- | ----------------- | --------------- | ------------------- |
| <a href="https://leeoniya.github.io/uPlot/bench/uPlot.html">uPlot</a>          |   19 KB |   42 ms |   71   6   3   72 |  20 MB   4 MB   |  153  517  129  259 |
| <a href="https://leeoniya.github.io/uPlot/bench/Flot.html">Flot</a>           |  482 KB |  320 ms |  192   5   5  306 |  40 MB  17 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/dygraphs.html">dygraphs</a>       |  122 KB |  170 ms |  239   4   5  172 | 113 MB  64 MB   | 2365  260  316  328 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js-next.html">Chart.js-next</a>  |  247 KB |  290 ms |  368   6   4   81 |  56 MB  49 MB   | 3705   36   93 4553 |
| <a href="https://leeoniya.github.io/uPlot/bench/CanvasJS.html">CanvasJS</a>       |  450 KB |  321 ms |  398   5   4  103 |  48 MB  37 MB   | 2030  714  350  445 |
| <a href="https://leeoniya.github.io/uPlot/bench/LightningChart.html">LightningChart</a> |  883 KB |  --- ms |  472   3   3   78 |  67 MB  21 MB   | 9725   25   47   98 |
| <a href="https://leeoniya.github.io/uPlot/bench/jqChart.html">jqChart</a>        |  273 KB |  455 ms |  564   4   2   85 | 141 MB  97 MB   |  675  665  328  485 |
| <a href="https://leeoniya.github.io/uPlot/bench/Highcharts.html">Highcharts</a>     |  279 KB |  --- ms |  687   7   2   72 |  82 MB  28 MB   | 1150  581  194  276 |
| <a href="https://leeoniya.github.io/uPlot/bench/Chart.js.html">Chart.js</a>       |  239 KB |  680 ms |  726   6   4  175 | 113 MB  91 MB   | 5564    5   13 4067 |
| <a href="https://leeoniya.github.io/uPlot/bench/ECharts.html">ECharts</a>        |  734 KB |  505 ms |  778   5   9 1074 | 182 MB 124 MB   | 2472   51   52 7333 |
| <a href="https://leeoniya.github.io/uPlot/bench/ApexCharts.html">ApexCharts</a>     |  437 KB | 1265 ms | 2398  26 152   60 | 144 MB 123 MB   | 1815  205 8119   57 |
| <a href="https://leeoniya.github.io/uPlot/bench/ZingChart.html">ZingChart</a>      |  693 KB | 5858 ms | 6007   9   1   80 | 206 MB 174 MB   | ---                 |
| <a href="https://leeoniya.github.io/uPlot/bench/amCharts.html">amCharts</a>       | 1034 KB | 6915 ms | 6953  37  12  102 | 441 MB 441 MB   | 4522 1237 2977  518 |
</pre>

- `size` includes the lib itself plus any dependencies required to render the benchmark, e.g. Moment, jQuery, etc.
- Flot does not make available any minified assets and all their examples use the uncompressed sources; they also use an uncompressed version of jQuery :/

TODO (all of these use SVG, so performance should be similar to Highcharts):

- Chartist.js
- d3-based
  - C3.js
  - dc.js
  - Plotly
  - MetricsGraphics
  - rickshaw

---
### Acknowledgements

- Dan Vanderkam's [dygraphs](https://github.com/danvk/dygraphs) was a big inspiration; in fact, my stale [pull request #948](https://github.com/danvk/dygraphs/pull/948) was a primary motivator for μPlot's inception.
- Adam Pearce for [#15 - remove redundant lineTo commands](https://github.com/leeoniya/uPlot/issues/15).
